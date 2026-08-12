// 子进程管理模块
// 负责官方应用启停、健康检查、异常恢复和日志；不做崩溃自动重启、资源监控、启动顺序/依赖。
use crate::error::{AppError, AppResult};
use crate::manifest::AppIssue;
use crate::official_market::OfficialApp;
use crate::{
    config::{load_config, StartupMode},
    official_app_installer,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration, Instant};

/// 进程状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    /// 启动中
    Starting,
    /// 运行中
    Running,
    /// 停止中
    Stopping,
    /// 已停止
    Stopped,
}

/// 单个应用进程的运行时状态
#[derive(Debug, Clone, Serialize)]
pub struct AppState {
    pub id: String,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    #[serde(default)]
    pub issue: Option<AppIssue>,
}

/// 受管官方应用的短期运行记录。aIdea 异常退出后用它验证并接管遗留进程。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeRecord {
    pub app_id: String,
    pub pid: u32,
    pub started_at: i64,
    #[serde(default)]
    pub process_started_at: String,
    pub command: Vec<String>,
    pub working_directory: String,
    pub ready_url: String,
    pub log_path: String,
    pub version: String,
    pub instance_id: String,
}

/// 全局进程表（id -> 子进程句柄）
struct ProcessTable {
    /// id -> ProcessEntry
    entries: HashMap<String, ProcessEntry>,
}

#[derive(Debug)]
struct ProcessEntry {
    /// 子进程的 PID（启动后填充）
    pid: u32,
    /// 停止任务时通过这个 channel 通知监控协程退出
    kill_tx: Option<oneshot::Sender<()>>,
}

/// 全局进程表（Tauri 状态管理用）
/// 用 Arc<Mutex> 包裹以便在 async task 中通过 clone 持有引用
#[derive(Clone)]
pub struct ProcessManager {
    table: Arc<Mutex<ProcessTable>>,
    issues: Arc<Mutex<HashMap<String, AppIssue>>>,
    /// 启停会跨越健康检查或进程退出等待；独立记录过渡态，供所有 UI 使用同一事实来源。
    transitions: Arc<Mutex<HashMap<String, ProcessStatus>>>,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self {
            table: Arc::new(Mutex::new(ProcessTable {
                entries: HashMap::new(),
            })),
            issues: Arc::new(Mutex::new(HashMap::new())),
            transitions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl ProcessManager {
    /// 从异常退出遗留的运行记录中恢复仍然存活的受管应用。
    pub async fn recover_managed_processes(&self) -> AppResult<Vec<AppState>> {
        self.recover_managed_processes_from_dir(&runtime_records_dir()?)
            .await
    }

    async fn recover_managed_processes_from_dir(
        &self,
        directory: &Path,
    ) -> AppResult<Vec<AppState>> {
        if !directory.exists() {
            return Ok(Vec::new());
        }

        let mut states = Vec::new();
        for entry in std::fs::read_dir(directory)? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(app_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            let record = match read_runtime_record_at(directory, app_id) {
                Ok(Some(record)) => record,
                Ok(None) => continue,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };
            if record.app_id != app_id
                || !self.pid_alive(record.pid as i32)
                || !process_matches_record(&record)
                || !is_ready(&record.ready_url).await
            {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            self.table.lock().unwrap().entries.insert(
                record.app_id.clone(),
                ProcessEntry {
                    pid: record.pid,
                    kill_tx: None,
                },
            );
            states.push(AppState {
                id: record.app_id,
                status: ProcessStatus::Running,
                pid: Some(record.pid),
                issue: None,
            });
        }
        Ok(states)
    }

    /// 启动官方应用。命令与参数由市场定义提供，不经 shell 解析。
    pub async fn start_official(&self, app: &OfficialApp) -> AppResult<u32> {
        if self.is_running(&app.id)? {
            return self
                .get_pid(&app.id)
                .ok_or_else(|| AppError::Process(format!("{} 已运行但 PID 丢失", app.id)));
        }

        self.set_transition(&app.id, ProcessStatus::Starting);
        let result = self.start_official_after_transition(app).await;
        self.clear_transition(&app.id);
        result
    }

    async fn start_official_after_transition(&self, app: &OfficialApp) -> AppResult<u32> {
        let source = crate::official_app_installer::source_dir(&app.id)?;
        let working_dir = source.join(&app.process.working_directory);
        if !working_dir.starts_with(&source) || !working_dir.is_dir() {
            return Err(AppError::Process(format!("{} 工作目录无效", app.id)));
        }
        if let Some(pid) = adoptable_process(&source, &app.process.ready_url).await {
            self.table
                .lock()
                .unwrap()
                .entries
                .insert(app.id.clone(), ProcessEntry { pid, kill_tx: None });
            self.clear_issue(&app.id);
            return Ok(pid);
        }
        ensure_ready_port_available(&app.process.ready_url)?;
        let log_dir = crate::config::data_root()?.join("logs").join(&app.id);
        std::fs::create_dir_all(&log_dir)?;
        let log_path = log_dir.join("app.log");
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let app_data_dir = crate::config::data_root()?.join("app-data").join(&app.id);
        std::fs::create_dir_all(&app_data_dir)?;

        let (program, path) = command_for_official_app(app, &source)?;
        let mut command = Command::new(&program);
        command
            .args(&app.process.command[1..])
            .current_dir(&working_dir)
            .env("AIDEA_APP_ID", &app.id)
            .env("AIDEA_APP_DATA_DIR", &app_data_dir)
            .env("AIDEA_APP_LOG_DIR", &log_dir)
            .stdout(Stdio::from(log_file.try_clone()?))
            .stderr(Stdio::from(log_file));
        if let Some(path) = path {
            command.env("PATH", path);
        }
        let mut child = command.spawn().map_err(|error| {
            AppError::Process(format!(
                "启动 {} 失败（{}）: {}",
                app.id,
                program.display(),
                error
            ))
        })?;
        let pid = child
            .id()
            .ok_or_else(|| AppError::Process(format!("获取 {} PID 失败", app.id)))?;
        write_runtime_record(&RuntimeRecord {
            app_id: app.id.clone(),
            pid,
            started_at: chrono::Utc::now().timestamp(),
            process_started_at: process_started_at(pid).unwrap_or_default(),
            command: app.process.command.clone(),
            working_directory: working_dir.to_string_lossy().into_owned(),
            ready_url: app.process.ready_url.clone(),
            log_path: log_path.to_string_lossy().into_owned(),
            version: app.version.clone(),
            instance_id: uuid::Uuid::new_v4().to_string(),
        })?;
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let id = app.id.clone();
        let manager = self.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {
                    manager.clear_exited_process(&id, pid);
                    eprintln!("子应用 {} (pid={}) 已退出", id, pid);
                }
                _ = kill_rx => {}
            }
        });
        self.table.lock().unwrap().entries.insert(
            app.id.clone(),
            ProcessEntry {
                pid,
                kill_tx: Some(kill_tx),
            },
        );
        if let Err(error) = wait_until_ready(&app.process.ready_url).await {
            let _ = self.stop(&app.id).await;
            return Err(AppError::Process(format!(
                "{} 服务未就绪: {}",
                app.id, error
            )));
        }
        Ok(pid)
    }

    /// 停止子应用
    pub async fn stop(&self, id: &str) -> AppResult<()> {
        self.set_transition(id, ProcessStatus::Stopping);
        let entry = {
            let mut table = self.table.lock().unwrap();
            table.entries.remove(id)
        };

        let Some(entry) = entry else {
            self.clear_transition(id);
            return Err(AppError::Process(format!("{} 未在运行", id)));
        };

        // 先发 kill_tx 通知监控协程退出 select 分支
        if let Some(tx) = entry.kill_tx {
            let _ = tx.send(());
        }

        // 直接发 SIGTERM，5 秒未退出则 SIGKILL
        let pid = entry.pid as i32;
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }

        // 等待最多 5 秒
        for _ in 0..50 {
            if !self.pid_alive(pid) {
                let _ = remove_runtime_record(id);
                self.clear_transition(id);
                return Ok(());
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // 5 秒未退出，SIGKILL
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
        let _ = remove_runtime_record(id);
        self.clear_transition(id);
        Ok(())
    }

    /// aIdea 退出时停止所有由壳启动的子进程，避免端口和后台服务残留。
    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.table.lock().unwrap().entries.keys().cloned().collect();
        for id in ids {
            let _ = self.stop(&id).await;
        }
    }

    /// 查询状态
    pub fn is_running(&self, id: &str) -> AppResult<bool> {
        let table = self.table.lock().unwrap();
        if let Some(entry) = table.entries.get(id) {
            // 进程表有记录，但可能已自然退出（监控协程未清理 table）
            if self.pid_alive(entry.pid as i32) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// 获取所有应用状态（包括未运行的）
    pub fn get_all_states(&self, ids: &[String]) -> AppResult<Vec<AppState>> {
        let issues = self.issues.lock().unwrap();
        let transitions = self.transitions.lock().unwrap();
        let mut states = Vec::new();
        for id in ids {
            let running = self.is_running(id)?;
            let pid = if running { self.get_pid(id) } else { None };
            states.push(AppState {
                id: id.clone(),
                status: transitions.get(id).cloned().unwrap_or(if running {
                    ProcessStatus::Running
                } else {
                    ProcessStatus::Stopped
                }),
                pid,
                issue: issues.get(id).cloned(),
            });
        }
        Ok(states)
    }

    pub fn record_issue(&self, id: &str, error: &AppError) {
        self.issues.lock().unwrap().insert(
            id.into(),
            AppIssue {
                level: "warning".into(),
                message: error.to_string(),
                updated_at: chrono::Utc::now().timestamp(),
            },
        );
    }

    pub fn clear_issue(&self, id: &str) {
        self.issues.lock().unwrap().remove(id);
    }

    fn get_pid(&self, id: &str) -> Option<u32> {
        let table = self.table.lock().unwrap();
        table.entries.get(id).map(|e| e.pid)
    }

    fn clear_exited_process(&self, id: &str, pid: u32) {
        let removed = {
            let mut table = self.table.lock().unwrap();
            if table.entries.get(id).is_some_and(|entry| entry.pid == pid) {
                table.entries.remove(id);
                true
            } else {
                false
            }
        };
        if removed {
            let _ = remove_runtime_record(id);
            self.clear_transition(id);
        }
    }

    fn set_transition(&self, id: &str, status: ProcessStatus) {
        self.transitions.lock().unwrap().insert(id.into(), status);
    }

    fn clear_transition(&self, id: &str) {
        self.transitions.lock().unwrap().remove(id);
    }

    fn pid_alive(&self, pid: i32) -> bool {
        // kill(pid, 0) 不发信号，仅检查进程是否存在
        // 返回 0 = 存在；返回 -1 且 errno=ESRCH = 不存在
        pid > 0 && unsafe { libc::kill(pid, 0) == 0 }
    }
}

/// 在替换安装目录前启动 staging 版本，只验证健康检查，不写入运行记录。
pub async fn check_official_source(app: &OfficialApp, source: &Path) -> AppResult<()> {
    let working_dir = source.join(&app.process.working_directory);
    if !working_dir.starts_with(source) || !working_dir.is_dir() {
        return Err(AppError::Process(format!("{} 工作目录无效", app.id)));
    }
    ensure_ready_port_available(&app.process.ready_url)?;

    let check_root = std::env::temp_dir().join(format!("aidea-health-{}", uuid::Uuid::new_v4()));
    let data_dir = check_root.join("data");
    let log_dir = check_root.join("logs");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&log_dir)?;

    let (program, path) = command_for_official_app(app, source)?;
    let mut command = Command::new(&program);
    command
        .args(&app.process.command[1..])
        .current_dir(&working_dir)
        .env("AIDEA_APP_ID", &app.id)
        .env("AIDEA_APP_DATA_DIR", &data_dir)
        .env("AIDEA_APP_LOG_DIR", &log_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(path) = path {
        command.env("PATH", path);
    }
    let child = command
        .spawn()
        .map_err(|error| AppError::Process(format!("启动 {} staging 版本失败: {error}", app.id)));
    let mut child = match child {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(check_root);
            return Err(error);
        }
    };

    let result = wait_until_ready(&app.process.ready_url).await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    let _ = std::fs::remove_dir_all(check_root);
    result.map_err(|error| AppError::Process(format!("{} staging 版本未就绪: {error}", app.id)))
}

fn command_for_official_app(
    app: &OfficialApp,
    source: &Path,
) -> AppResult<(PathBuf, Option<OsString>)> {
    if app.runtime != "binary" {
        return Ok((resolve_program(&app.process.command[0]), None));
    }

    let inherited_path = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::join_paths(
        std::iter::once(source.to_path_buf()).chain(std::env::split_paths(&inherited_path)),
    )
    .map_err(|error| AppError::Process(format!("{} PATH 无效: {error}", app.id)))?;
    Ok((PathBuf::from(&app.process.command[0]), Some(path)))
}

fn runtime_records_dir() -> AppResult<PathBuf> {
    Ok(crate::config::ensure_data_dirs()?.join("runtime/processes"))
}

fn runtime_record_path_at(directory: &Path, app_id: &str) -> PathBuf {
    directory.join(format!("{app_id}.json"))
}

fn write_runtime_record_at(directory: &Path, record: &RuntimeRecord) -> AppResult<()> {
    std::fs::create_dir_all(directory)?;
    let path = runtime_record_path_at(directory, &record.app_id);
    let temporary = directory.join(format!(".{}.{}.json", record.app_id, uuid::Uuid::new_v4()));
    std::fs::write(&temporary, serde_json::to_vec_pretty(record)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn read_runtime_record_at(directory: &Path, app_id: &str) -> AppResult<Option<RuntimeRecord>> {
    let path = runtime_record_path_at(directory, app_id);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&std::fs::read(path)?)?))
}

fn write_runtime_record(record: &RuntimeRecord) -> AppResult<()> {
    write_runtime_record_at(&runtime_records_dir()?, record)
}

fn remove_runtime_record(app_id: &str) -> AppResult<()> {
    let path = runtime_record_path_at(&runtime_records_dir()?, app_id);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn command_matches(expected: &[String], actual: &str) -> bool {
    let mut actual_parts = actual.split_whitespace();
    let Some(actual_program) = actual_parts.next() else {
        return false;
    };
    let Some(expected_program) = expected.first() else {
        return false;
    };
    if Path::new(actual_program).file_name() != Path::new(expected_program).file_name() {
        return false;
    }
    let actual_arguments: Vec<&str> = actual_parts.collect();
    expected[1..]
        .iter()
        .all(|argument| actual_arguments.iter().any(|value| value == argument))
}

fn process_started_at(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let started_at = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!started_at.is_empty()).then_some(started_at)
}

fn process_matches_record(record: &RuntimeRecord) -> bool {
    let output = match std::process::Command::new("ps")
        .args(["-p", &record.pid.to_string(), "-o", "command="])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };
    let command = String::from_utf8_lossy(&output.stdout);
    process_started_at(record.pid).as_deref() == Some(record.process_started_at.as_str())
        && command_matches(&record.command, command.trim())
        && process_working_directory_matches(record.pid, &record.working_directory)
}

fn process_working_directory_matches(pid: u32, expected: &str) -> bool {
    let output = match std::process::Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('n'))
        .any(|working_directory| working_directory == expected)
}

/// GUI 启动时通常不会加载 shell 配置，补查用户本地 bin 目录。
pub(crate) fn resolve_program(program: &str) -> PathBuf {
    if program.contains('/') {
        return PathBuf::from(program);
    }

    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return candidate;
        }
    }

    if let Some(home) = dirs::home_dir() {
        for directory in [".local/bin", ".npm-global/bin", ".bun/bin"] {
            let candidate = home.join(directory).join(program);
            if candidate.is_file() {
                return candidate;
            }
        }
    }

    for directory in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let candidate = Path::new(directory).join(program);
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from(program)
}

async fn wait_until_ready(url: &str) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|e| AppError::Process(format!("创建就绪检查客户端失败: {}", e)))?;
    let deadline = Instant::now() + Duration::from_secs(15);

    loop {
        if let Ok(response) = client.get(url).send().await {
            if response.status().is_success() {
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            return Err(AppError::Process(format!(
                "{} 在 15 秒内未返回成功响应",
                url
            )));
        }
        sleep(Duration::from_millis(100)).await;
    }
}

async fn is_ready(url: &str) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
    else {
        return false;
    };
    matches!(client.get(url).send().await, Ok(response) if response.status().is_success())
}

/// 仅接管工作目录属于当前官方应用且健康检查已通过的遗留监听进程。
async fn adoptable_process(source: &Path, ready_url: &str) -> Option<u32> {
    let port = reqwest::Url::parse(ready_url).ok()?.port()?;
    let output = Command::new("lsof")
        .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .await
        .ok()?;
    let pid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())?;
    let cwd = Command::new("lsof")
        .args(["-nP", "-p", &pid.to_string(), "-a", "-d", "cwd", "-Fn"])
        .output()
        .await
        .ok()?;
    let cwd_output = String::from_utf8_lossy(&cwd.stdout);
    let cwd = cwd_output.lines().find_map(|line| line.strip_prefix('n'))?;
    if !Path::new(cwd).starts_with(source) || !is_ready(ready_url).await {
        return None;
    }
    Some(pid)
}

fn ensure_ready_port_available(url: &str) -> AppResult<()> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| AppError::Process(format!("健康检查地址无效: {error}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Process("健康检查地址缺少主机名".into()))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| AppError::Process("健康检查地址缺少端口".into()))?;
    std::net::TcpListener::bind((host, port))
        .map(|_| ())
        .map_err(|error| {
            AppError::Process(format!(
                "端口 {host}:{port} 已被占用，无法启动官方应用: {error}"
            ))
        })
}

/// 启动用户明确设置为随 aIdea 启动的官方应用。
pub async fn start_configured_official_apps(manager: &ProcessManager) {
    let config = match load_config() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("加载官方应用启动设置失败: {error}");
            return;
        }
    };
    for installed in official_app_installer::list_installed().unwrap_or_default() {
        if config
            .app_settings
            .get(&installed.id)
            .is_none_or(|settings| settings.startup_mode != StartupMode::WithAidea)
        {
            continue;
        }
        match official_app_installer::installed_definition(&installed.id) {
            Ok(app) => {
                if let Err(error) = manager.start_official(&app).await {
                    manager.record_issue(&installed.id, &error);
                } else {
                    manager.clear_issue(&installed.id);
                }
            }
            Err(error) => manager.record_issue(&installed.id, &error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        check_official_source, command_for_official_app, command_matches,
        ensure_ready_port_available, read_runtime_record_at, resolve_program,
        write_runtime_record_at, ProcessManager, ProcessStatus, RuntimeRecord,
    };
    use crate::official_market::{OfficialApp, OfficialArtifact, OfficialProcess};
    use std::sync::Mutex;

    static NETWORK_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn 解析系统程序路径() {
        assert!(resolve_program("git").is_file());
    }

    #[tokio::test]
    async fn 没有子进程时停止全部不会失败() {
        ProcessManager::default().stop_all().await;
    }

    #[test]
    fn 过渡状态优先于进程表返回() {
        let manager = ProcessManager::default();
        manager.set_transition("demo", ProcessStatus::Starting);

        let states = manager.get_all_states(&["demo".into()]).unwrap();

        assert_eq!(states[0].status, ProcessStatus::Starting);
    }

    #[tokio::test]
    async fn staging_版本通过健康检查后会退出() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap();
        let directory =
            std::env::temp_dir().join(format!("aidea-staging-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("server.py");
        std::fs::write(
            &script,
            "from http.server import BaseHTTPRequestHandler, HTTPServer\nimport sys\nclass Handler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200 if self.path == '/health' else 404)\n        self.end_headers()\n    def log_message(self, *_): pass\nHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()\n",
        )
        .unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let app = OfficialApp {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "a".repeat(40),
            runtime: "python".into(),
            install: vec![],
            artifact: None,
            process: OfficialProcess {
                command: vec![
                    "python3".into(),
                    script.to_string_lossy().into_owned(),
                    port.to_string(),
                ],
                working_directory: ".".into(),
                ready_url: format!("http://127.0.0.1:{port}/health"),
            },
            update_notes: String::new(),
            update_available: false,
        };

        check_official_source(&app, &directory).await.unwrap();
        assert!(ensure_ready_port_available(&app.process.ready_url).is_ok());
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn binary_命令使用包根目录前置的_path() {
        let directory = std::env::temp_dir().join(format!("aidea-binary-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let command = format!("test-server-{}", uuid::Uuid::new_v4());
        let app = OfficialApp {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "a".repeat(40),
            runtime: "binary".into(),
            install: vec![],
            artifact: Some(OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            }),
            process: OfficialProcess {
                command: vec![command.clone()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_notes: String::new(),
            update_available: false,
        };

        let (program, path) = command_for_official_app(&app, &directory).unwrap();

        std::fs::remove_dir_all(&directory).unwrap();
        assert_eq!(program, std::path::PathBuf::from(command));
        assert_eq!(
            std::env::split_paths(&path.unwrap()).next(),
            Some(directory)
        );
    }

    #[test]
    fn 已占用的健康检查端口会在启动前报错() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let error = ensure_ready_port_available(&format!("http://127.0.0.1:{port}/health"))
            .unwrap_err()
            .to_string();

        assert!(error.contains(&format!("端口 127.0.0.1:{port} 已被占用")));
    }

    #[test]
    fn 运行记录可原子写入并读取() {
        let directory =
            std::env::temp_dir().join(format!("aidea-runtime-{}", uuid::Uuid::new_v4()));
        let record = RuntimeRecord {
            app_id: "demo".into(),
            pid: 1234,
            started_at: 1,
            process_started_at: String::new(),
            command: vec!["node".into(), "server.js".into()],
            working_directory: "/tmp/demo".into(),
            ready_url: "http://127.0.0.1:43120/health".into(),
            log_path: "/tmp/demo.log".into(),
            version: "0.1.0".into(),
            instance_id: "instance".into(),
        };

        write_runtime_record_at(&directory, &record).unwrap();
        let loaded = read_runtime_record_at(&directory, "demo").unwrap().unwrap();

        assert_eq!(loaded.pid, 1234);
        assert_eq!(loaded.command, ["node", "server.js"]);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 命令校验要求程序和参数都匹配() {
        assert!(command_matches(
            &["node".into(), "server.js".into()],
            "/usr/local/bin/node server.js --host 127.0.0.1"
        ));
        assert!(!command_matches(
            &["node".into(), "server.js".into()],
            "/usr/local/bin/node other.js"
        ));
    }

    #[tokio::test]
    async fn 已失效的运行记录不会被接管() {
        let directory =
            std::env::temp_dir().join(format!("aidea-runtime-{}", uuid::Uuid::new_v4()));
        write_runtime_record_at(
            &directory,
            &RuntimeRecord {
                app_id: "demo".into(),
                pid: u32::MAX,
                started_at: 1,
                process_started_at: String::new(),
                command: vec!["node".into(), "server.js".into()],
                working_directory: "/tmp/demo".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
                log_path: "/tmp/demo.log".into(),
                version: "0.1.0".into(),
                instance_id: "instance".into(),
            },
        )
        .unwrap();

        let states = ProcessManager::default()
            .recover_managed_processes_from_dir(&directory)
            .await
            .unwrap();

        assert!(states.is_empty());
        assert!(!directory.join("demo.json").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn 存活但未通过健康检查的进程不会被接管() {
        let directory =
            std::env::temp_dir().join(format!("aidea-runtime-{}", uuid::Uuid::new_v4()));
        write_runtime_record_at(
            &directory,
            &RuntimeRecord {
                app_id: "demo".into(),
                pid: std::process::id(),
                started_at: 1,
                process_started_at: String::new(),
                command: vec!["test".into()],
                working_directory: "/tmp/demo".into(),
                ready_url: "http://127.0.0.1:1/health".into(),
                log_path: "/tmp/demo.log".into(),
                version: "0.1.0".into(),
                instance_id: "instance".into(),
            },
        )
        .unwrap();

        let states = ProcessManager::default()
            .recover_managed_processes_from_dir(&directory)
            .await
            .unwrap();

        assert!(states.is_empty());
        assert!(!directory.join("demo.json").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
