use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub(crate) const MAX_TOOL_OUTPUT_BYTES: usize = 100 * 1024;
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);
const TRUNCATED_MARKER: &str = "\n[输出已截断，最多 100 KiB]";
const OUTPUT_READ_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandDecision {
    Allow,
    RequireApproval,
    Deny,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct ExecOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

struct OutputChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

struct BoundedOutput {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

#[derive(Clone)]
pub(crate) struct AiTools {
    rg_path: PathBuf,
}

impl AiTools {
    pub(crate) fn new(rg_path: PathBuf) -> Self {
        Self { rg_path }
    }

    #[cfg(test)]
    fn for_tests() -> Self {
        Self::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/rg"))
    }

    #[cfg(test)]
    pub(crate) async fn exec(&self, command: &str, cwd: &Path) -> AppResult<ExecOutput> {
        match classify_command(command) {
            CommandDecision::Allow => self.exec_approved(command, cwd).await,
            CommandDecision::RequireApproval => Err(AppError::Process("该命令需要用户授权".into())),
            CommandDecision::Deny => Err(AppError::Process("该命令不允许执行".into())),
        }
    }

    pub(crate) async fn exec_approved(&self, command: &str, cwd: &Path) -> AppResult<ExecOutput> {
        validate_directory(cwd)?;
        if command.trim().is_empty() {
            return Err(AppError::Config("命令不能为空".into()));
        }
        let mut path_entries = vec![
            "/usr/bin".to_owned(),
            "/bin".to_owned(),
            "/usr/sbin".to_owned(),
            "/sbin".to_owned(),
        ];
        if let Some(parent) = self
            .rg_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            path_entries.insert(0, parent.to_string_lossy().into_owned());
        }
        let path = path_entries.join(":");
        let mut child = Command::new("/bin/zsh");
        child
            .args(["-f", "-c", command])
            .current_dir(cwd)
            .env_clear()
            .env("PATH", path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        child.process_group(0);
        let mut process = child.spawn()?;
        let output = match tokio::time::timeout(EXEC_TIMEOUT, capture_output(&mut process)).await {
            Ok(output) => output?,
            Err(_) => {
                let _ = terminate_process_group(&mut process).await;
                return Err(AppError::Process("命令执行超时（30 秒）".into()));
            }
        };
        let (stdout, stderr) = output_strings(&output);
        Ok(ExecOutput {
            exit_code: output.exit_code,
            stdout,
            stderr,
        })
    }

    pub(crate) async fn search(
        &self,
        path: &Path,
        pattern: &str,
        glob: Option<&str>,
        max_results: Option<usize>,
    ) -> AppResult<String> {
        validate_directory(path)?;
        if pattern.is_empty() {
            return Err(AppError::Config("搜索内容不能为空".into()));
        }
        if !self.rg_path.is_file() {
            return Err(AppError::Process("AI Service 内置 rg 不可用".into()));
        }
        let mut command = Command::new(&self.rg_path);
        command
            .args(["--line-number", "--no-heading", "--color", "never"])
            .arg("--max-count")
            .arg(max_results.unwrap_or(100).clamp(1, 1000).to_string());
        if let Some(glob) = glob.filter(|value| !value.is_empty()) {
            command.arg("--glob").arg(glob);
        }
        command
            .arg(pattern)
            .arg(path)
            .env_clear()
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut process = command.spawn()?;
        let output = capture_output(&mut process).await?;
        let (stdout, stderr) = output_strings(&output);
        match output.exit_code {
            0 | 1 => Ok(stdout),
            _ => Err(AppError::Process(stderr)),
        }
    }
}

async fn capture_output(child: &mut Child) -> AppResult<BoundedOutput> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("无法读取命令标准输出".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("无法读取命令错误输出".into()))?;
    let (sender, mut receiver) = mpsc::channel(2);
    let stdout_reader = tokio::spawn(read_stream(stdout, OutputStream::Stdout, sender.clone()));
    let stderr_reader = tokio::spawn(read_stream(stderr, OutputStream::Stderr, sender.clone()));
    drop(sender);

    let content_limit = MAX_TOOL_OUTPUT_BYTES.saturating_sub(TRUNCATED_MARKER.len());
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut channels_open = true;

    while exit_code.is_none() || channels_open {
        tokio::select! {
            status = child.wait(), if exit_code.is_none() => {
                exit_code = Some(status?.code().unwrap_or(-1));
            }
            chunk = receiver.recv(), if channels_open => {
                match chunk {
                    Some(chunk) => {
                        let remaining = content_limit.saturating_sub(stdout.len() + stderr.len());
                        let output = match chunk.stream {
                            OutputStream::Stdout => &mut stdout,
                            OutputStream::Stderr => &mut stderr,
                        };
                        output.extend_from_slice(&chunk.bytes[..chunk.bytes.len().min(remaining)]);
                        if chunk.bytes.len() > remaining {
                            let _ = terminate_process_group(child).await;
                            stdout_reader.abort();
                            stderr_reader.abort();
                            return Ok(BoundedOutput {
                                exit_code: child.wait().await?.code().unwrap_or(-1),
                                stdout,
                                stderr,
                                truncated: true,
                            });
                        }
                    }
                    None => channels_open = false,
                }
            }
        }
    }

    join_reader(stdout_reader).await?;
    join_reader(stderr_reader).await?;
    Ok(BoundedOutput {
        exit_code: exit_code.unwrap_or(-1),
        stdout,
        stderr,
        truncated: false,
    })
}

async fn read_stream<R: AsyncRead + Unpin>(
    mut stream: R,
    output_stream: OutputStream,
    sender: mpsc::Sender<OutputChunk>,
) -> io::Result<()> {
    let mut buffer = vec![0; OUTPUT_READ_CHUNK_BYTES];
    loop {
        let count = stream.read(&mut buffer).await?;
        if count == 0 {
            return Ok(());
        }
        if sender
            .send(OutputChunk {
                stream: output_stream,
                bytes: buffer[..count].to_vec(),
            })
            .await
            .is_err()
        {
            return Ok(());
        }
    }
}

async fn join_reader(reader: tokio::task::JoinHandle<io::Result<()>>) -> AppResult<()> {
    reader
        .await
        .map_err(|error| AppError::Process(format!("读取命令输出失败: {error}")))??;
    Ok(())
}

async fn terminate_process_group(child: &mut Child) -> io::Result<()> {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // 命令由独立进程组运行，超时或输出超限时一并结束 Shell 管道中的所有子进程。
        if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
    }
    if child.id().is_some() {
        child.start_kill()?;
    }
    let _ = child.wait().await?;
    Ok(())
}

fn output_strings(output: &BoundedOutput) -> (String, String) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let truncated = output.truncated || stdout.len() + stderr.len() > MAX_TOOL_OUTPUT_BYTES;
    if !truncated {
        return (stdout.into_owned(), stderr.into_owned());
    }

    let content_limit = MAX_TOOL_OUTPUT_BYTES.saturating_sub(TRUNCATED_MARKER.len());
    let stdout = output_prefix(&stdout, content_limit).to_owned();
    let stderr = output_prefix(&stderr, content_limit.saturating_sub(stdout.len())).to_owned();
    if stderr.is_empty() {
        (format!("{stdout}{TRUNCATED_MARKER}"), stderr)
    } else {
        (stdout, format!("{stderr}{TRUNCATED_MARKER}"))
    }
}

fn output_prefix(value: &str, limit: usize) -> &str {
    let mut end = value.len().min(limit);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub(crate) fn read_file(
    path: &Path,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> AppResult<String> {
    validate_file(path)?;
    let content = read_utf8(path)?;
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let start = start_line.unwrap_or(1);
    let end = end_line.unwrap_or(lines.len());
    if start == 0 || end < start {
        return Err(AppError::Config("读取行号范围无效".into()));
    }
    Ok(limit_output(
        lines
            .into_iter()
            .skip(start.saturating_sub(1))
            .take(end - start + 1)
            .collect(),
    ))
}

pub(crate) fn write_file(path: &Path, content: &str) -> AppResult<()> {
    validate_writable_file(path)?;
    atomic_write(path, content)
}

pub(crate) fn edit_file(path: &Path, old_text: &str, new_text: &str) -> AppResult<()> {
    validate_file(path)?;
    if old_text.is_empty() {
        return Err(AppError::Config("旧文本不能为空".into()));
    }
    let content = read_utf8(path)?;
    if content.match_indices(old_text).count() != 1 {
        return Err(AppError::Config("旧文本必须恰好匹配一次".into()));
    }
    atomic_write(path, &content.replacen(old_text, new_text, 1))
}

pub(crate) fn list_dir(path: &Path, depth: usize) -> AppResult<String> {
    validate_directory(path)?;
    let mut entries = Vec::new();
    collect_directory(path, path, depth, &mut entries)?;
    Ok(limit_output(entries.join("\n")))
}

pub(crate) fn classify_command(command: &str) -> CommandDecision {
    let mut requires_approval = false;
    for segment in command.split(|character| matches!(character, '|' | ';' | '&' | '\n' | '\r')) {
        let tokens: Vec<String> = segment
            .split_whitespace()
            .map(|token| token.to_ascii_lowercase())
            .collect();
        if tokens.is_empty() {
            continue;
        }
        if tokens.iter().any(|token| {
            matches!(
                token.as_str(),
                "sudo" | "su" | "doas" | "mkfs" | "shutdown" | "reboot"
            )
        }) || tokens.windows(2).any(|pair| pair == ["diskutil", "erase"])
        {
            return CommandDecision::Deny;
        }
        if is_recursive_remove(&tokens)
            || is_hard_reset(&tokens)
            || is_git_clean(&tokens)
            || is_force_push(&tokens)
            || is_git_delete(&tokens)
            || is_delete_request(&tokens)
        {
            requires_approval = true;
        }
    }
    if requires_approval {
        CommandDecision::RequireApproval
    } else {
        CommandDecision::Allow
    }
}

fn validate_file(path: &Path) -> AppResult<()> {
    validate_absolute(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::Config("路径必须是普通文件".into()));
    }
    Ok(())
}

fn validate_writable_file(path: &Path) -> AppResult<()> {
    validate_absolute(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("文件路径无效".into()))?;
    validate_directory(parent)?;
    if path.exists() {
        validate_file(path)?;
    }
    Ok(())
}

fn validate_directory(path: &Path) -> AppResult<()> {
    validate_absolute(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::Config("路径必须是普通目录".into()));
    }
    Ok(())
}

fn validate_absolute(path: &Path) -> AppResult<()> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(AppError::Config("路径必须是绝对路径".into()))
    }
}

fn read_utf8(path: &Path) -> AppResult<String> {
    String::from_utf8(fs::read(path)?).map_err(|_| AppError::Config("文件不是 UTF-8 文本".into()))
}

fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("文件路径无效".into()))?;
    let temporary = parent.join(format!(".aidea-ai-service-{}", uuid::Uuid::new_v4()));
    // 同目录临时文件和 rename 保证目标文件不会处于只写了一半的状态。
    let result = (|| -> std::io::Result<()> {
        let mut file: File = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(())
}

fn collect_directory(
    root: &Path,
    current: &Path,
    depth: usize,
    entries: &mut Vec<String>,
) -> AppResult<()> {
    let mut children = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let path = child.path();
        let metadata = fs::symlink_metadata(&path)?;
        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::Config("目录路径无效".into()))?
            .to_string_lossy();
        if metadata.file_type().is_dir() {
            entries.push(format!("{relative}/"));
            if depth > 0 {
                collect_directory(root, &path, depth - 1, entries)?;
            }
        } else {
            entries.push(relative.into_owned());
        }
    }
    Ok(())
}

fn limit_output(value: String) -> String {
    if value.len() <= MAX_TOOL_OUTPUT_BYTES {
        return value;
    }
    let mut end = MAX_TOOL_OUTPUT_BYTES.saturating_sub(TRUNCATED_MARKER.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], TRUNCATED_MARKER)
}

fn is_recursive_remove(tokens: &[String]) -> bool {
    tokens.first().is_some_and(|token| token == "rm")
        && tokens[1..]
            .iter()
            .any(|token| token == "--recursive" || (token.starts_with('-') && token.contains('r')))
}

fn is_hard_reset(tokens: &[String]) -> bool {
    tokens.len() >= 3
        && tokens[0] == "git"
        && tokens[1] == "reset"
        && tokens[2..].iter().any(|token| token == "--hard")
}

fn is_git_clean(tokens: &[String]) -> bool {
    tokens.len() >= 2 && tokens[0] == "git" && tokens[1] == "clean"
}

fn is_force_push(tokens: &[String]) -> bool {
    tokens.len() >= 2
        && tokens[0] == "git"
        && tokens[1] == "push"
        && tokens[2..]
            .iter()
            .any(|token| token == "--force" || token == "-f")
}

fn is_git_delete(tokens: &[String]) -> bool {
    tokens.len() >= 3
        && tokens[0] == "git"
        && ((tokens[1] == "branch" && tokens[2..].iter().any(|token| token == "-d"))
            || (tokens[1] == "tag" && tokens[2..].iter().any(|token| token == "-d")))
}

fn is_delete_request(tokens: &[String]) -> bool {
    tokens.first().is_some_and(|token| token == "curl")
        && (tokens
            .windows(2)
            .any(|pair| pair[0] == "-x" && pair[1] == "delete")
            || tokens
                .iter()
                .any(|token| token == "-xdelete" || token == "--request=delete")
            || tokens
                .windows(2)
                .any(|pair| pair[0] == "--request" && pair[1] == "delete"))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_command, edit_file, list_dir, read_file, write_file, AiTools, CommandDecision,
        MAX_TOOL_OUTPUT_BYTES,
    };
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("aidea-ai-tools-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn 文件工具按行读取并拒绝含有多个旧文本的编辑() {
        let root = temporary_root();
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("notes.txt");
        write_file(&file, "line1\nline2\nline3\nsame\nsame\n").unwrap();

        assert_eq!(
            read_file(&file, Some(2), Some(3)).unwrap(),
            "line2\nline3\n"
        );
        assert!(edit_file(&file, "same", "new").is_err());
        assert!(read_file(Path::new("notes.txt"), None, None).is_err());
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "line1\nline2\nline3\nsame\nsame\n"
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 写入不创建父目录且目录工具只接受绝对目录() {
        let root = temporary_root();
        std::fs::create_dir_all(&root).unwrap();
        assert!(write_file(&root.join("missing/note.txt"), "x").is_err());
        assert!(list_dir(Path::new("."), 1).is_err());

        let nested = root.join("nested");
        std::fs::create_dir(&nested).unwrap();
        write_file(&nested.join("note.txt"), "x").unwrap();
        let entries = list_dir(&root, 2).unwrap();
        assert!(entries.contains("nested/"));
        assert!(entries.contains("nested/note.txt"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 命令保护区分拒绝授权和普通命令() {
        assert_eq!(classify_command("sudo rm -rf /"), CommandDecision::Deny);
        assert_eq!(
            classify_command("git push --force origin main"),
            CommandDecision::RequireApproval
        );
        assert_eq!(
            classify_command("curl -X DELETE https://example.test/x"),
            CommandDecision::RequireApproval
        );
        assert_eq!(
            classify_command("git commit -m test && git push origin main"),
            CommandDecision::Allow
        );
    }

    #[tokio::test]
    async fn 执行命令使用绝对工作目录且超长输出明确截断() {
        let root = temporary_root();
        std::fs::create_dir_all(&root).unwrap();
        let tools = AiTools::for_tests();

        let output = tools.exec("pwd", &root).await.unwrap();
        assert!(output.stdout.trim_end().ends_with(root.to_str().unwrap()));
        assert!(tools.exec("pwd", Path::new(".")).await.is_err());

        let output = tools
            .exec("/usr/bin/yes | /usr/bin/head -c 200000", &root)
            .await
            .unwrap();
        assert!(output.stdout.contains("输出已截断"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn 执行命令达到总输出上限后立即终止子进程() {
        let root = temporary_root();
        std::fs::create_dir_all(&root).unwrap();
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            AiTools::for_tests().exec("/usr/bin/yes", &root),
        )
        .await
        .expect("输出达到上限后不应等待 30 秒")
        .unwrap();

        assert!(output.stdout.contains("输出已截断") || output.stderr.contains("输出已截断"));
        assert!(output.stdout.len() + output.stderr.len() <= MAX_TOOL_OUTPUT_BYTES);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn 搜索使用随包_rg且支持文件_glob() {
        let root = temporary_root();
        std::fs::create_dir_all(&root).unwrap();
        write_file(&root.join("match.rs"), "let needle = true;\n").unwrap();
        write_file(&root.join("skip.txt"), "needle\n").unwrap();

        let result = AiTools::for_tests()
            .search(&root, "needle", Some("*.rs"), Some(10))
            .await
            .unwrap();
        assert!(result.contains("match.rs:1:let needle = true;"));
        assert!(!result.contains("skip.txt"));

        std::fs::remove_dir_all(root).unwrap();
    }
}
