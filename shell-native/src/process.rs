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
    #[serde(default)]
    pub process_group: Option<u32>,
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
    /// 子进程独立进程组的 ID；没有该字段的旧记录不允许恢复接管。
    process_group: Option<u32>,
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
            // 旧运行记录不能绕过当前 binary-only 安装快照。
            let app = match official_app_installer::installed_definition(&record.app_id) {
                Ok(app) => app,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };
            let source = match official_app_installer::source_dir(&app.id) {
                Ok(source) => source,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };
            if record.app_id != app_id
                || !self.pid_alive(record.pid as i32)
                || !process_matches_record(&record)
                || !runtime_record_matches_app(&record, &app, &source)
                || !is_ready(&record.ready_url).await
            {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            self.table.lock().unwrap().entries.insert(
                record.app_id.clone(),
                ProcessEntry {
                    pid: record.pid,
                    process_group: record.process_group,
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
        let working_dir = canonical_working_directory(&source, &app.process.working_directory)?;
        let (program, path) = command_for_official_app(app, &source)?;
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

        let mut command = Command::new(&program);
        command
            .env_clear()
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
        #[cfg(unix)]
        command.process_group(0);
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
        let runtime_record = RuntimeRecord {
            app_id: app.id.clone(),
            pid,
            process_group: Some(pid),
            started_at: chrono::Utc::now().timestamp(),
            process_started_at: process_started_at(pid).unwrap_or_default(),
            command: runtime_command(&program, &app.process.command),
            working_directory: working_dir.to_string_lossy().into_owned(),
            ready_url: app.process.ready_url.clone(),
            log_path: log_path.to_string_lossy().into_owned(),
            version: app.version.clone(),
            instance_id: uuid::Uuid::new_v4().to_string(),
        };
        if let Err(error) = write_runtime_record(&runtime_record) {
            terminate_child_process_group(&mut child, pid).await;
            return Err(error);
        }
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
                process_group: Some(pid),
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

        // 每个官方应用在独立进程组中运行，停止时必须一并清理派生服务。
        if let Some(process_group) = entry.process_group {
            terminate_process_group(process_group as i32).await;
        } else {
            terminate_process(entry.pid as i32).await;
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
    let working_dir = canonical_working_directory(source, &app.process.working_directory)?;
    ensure_ready_port_available(&app.process.ready_url)?;

    let check_root = std::env::temp_dir().join(format!("aidea-health-{}", uuid::Uuid::new_v4()));
    let data_dir = check_root.join("data");
    let log_dir = check_root.join("logs");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&log_dir)?;

    let (program, path) = staging_command_for_official_app(app, source)?;
    let mut command = Command::new(&program);
    command
        .env_clear()
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
    #[cfg(unix)]
    command.process_group(0);
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
    let pid = child.id().map(|pid| pid as i32);
    if let Some(pid) = pid {
        terminate_process_group(pid).await;
    } else {
        let _ = child.kill().await;
    }
    let _ = child.wait().await;
    let _ = std::fs::remove_dir_all(check_root);
    result.map_err(|error| AppError::Process(format!("{} staging 版本未就绪: {error}", app.id)))
}

fn command_for_official_app(
    app: &OfficialApp,
    source: &Path,
) -> AppResult<(PathBuf, Option<OsString>)> {
    let (program, path) = staging_command_for_official_app(app, source)?;
    crate::official_app_installer::validate_arm64_binary(&program, &app.id)?;
    Ok((program, path))
}

fn staging_command_for_official_app(
    app: &OfficialApp,
    source: &Path,
) -> AppResult<(PathBuf, Option<OsString>)> {
    let program = source.join(&app.process.command[0]);
    if !program.is_file() {
        return Err(AppError::Process(format!(
            "{} 安装包缺少启动二进制 {}",
            app.id, app.process.command[0]
        )));
    }
    Ok((program, Some(source.as_os_str().to_owned())))
}

fn canonical_working_directory(source: &Path, value: &str) -> AppResult<PathBuf> {
    let source = source
        .canonicalize()
        .map_err(|error| AppError::Process(format!("无法定位官方应用安装目录: {error}")))?;
    let working_directory = source
        .join(value)
        .canonicalize()
        .map_err(|error| AppError::Process(format!("官方应用工作目录无效: {error}")))?;
    if !working_directory.starts_with(&source) || !working_directory.is_dir() {
        return Err(AppError::Process("官方应用工作目录无效".into()));
    }
    Ok(working_directory)
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

fn runtime_command(program: &Path, command: &[String]) -> Vec<String> {
    std::iter::once(program.to_string_lossy().into_owned())
        .chain(command[1..].iter().cloned())
        .collect()
}

fn command_matches(expected: &[String], actual: &str) -> bool {
    let Some(program) = expected.first() else {
        return false;
    };
    let actual = actual.trim();
    if actual == program {
        return expected.len() == 1;
    }
    let Some(arguments) = actual
        .strip_prefix(program)
        .and_then(|value| value.strip_prefix(' '))
    else {
        return false;
    };
    expected[1..]
        .iter()
        .map(String::as_str)
        .eq(arguments.split_whitespace())
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
        && process_group_matches_record(record)
        && command_matches(&record.command, command.trim())
        && process_working_directory_matches(record.pid, &record.working_directory)
}

fn process_group_matches_record(record: &RuntimeRecord) -> bool {
    let Some(expected) = record.process_group else {
        return false;
    };
    #[cfg(unix)]
    {
        let actual = unsafe { libc::getpgid(record.pid as i32) };
        return actual >= 0 && actual as u32 == expected;
    }
    #[cfg(not(unix))]
    {
        let _ = expected;
        false
    }
}

fn runtime_record_matches_app(record: &RuntimeRecord, app: &OfficialApp, source: &Path) -> bool {
    let Ok((program, _)) = command_for_official_app(app, source) else {
        return false;
    };
    let Ok(working_directory) = canonical_working_directory(source, &app.process.working_directory)
    else {
        return false;
    };
    record.app_id == app.id
        && record.process_group == Some(record.pid)
        && record.version == app.version
        && record.command == runtime_command(&program, &app.process.command)
        && record.ready_url == app.process.ready_url
        && record.working_directory == working_directory.to_string_lossy()
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

async fn terminate_child_process_group(child: &mut tokio::process::Child, pid: u32) {
    terminate_process_group(pid as i32).await;
    let _ = child.wait().await;
}

async fn terminate_process(pid: i32) {
    if pid <= 0 {
        return;
    }
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    for _ in 0..50 {
        if !process_alive(pid) {
            return;
        }
        sleep(Duration::from_millis(100)).await;
    }
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
}

fn process_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

async fn terminate_process_group(process_group: i32) {
    if process_group <= 0 {
        return;
    }
    unsafe {
        libc::kill(-process_group, libc::SIGTERM);
    }
    for _ in 0..50 {
        if !process_group_alive(process_group) {
            return;
        }
        sleep(Duration::from_millis(100)).await;
    }
    unsafe {
        libc::kill(-process_group, libc::SIGKILL);
    }
    for _ in 0..50 {
        if !process_group_alive(process_group) {
            return;
        }
        sleep(Duration::from_millis(100)).await;
    }
}

fn process_group_alive(process_group: i32) -> bool {
    unsafe { libc::kill(-process_group, 0) == 0 }
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
        canonical_working_directory, check_official_source, command_for_official_app,
        command_matches, ensure_ready_port_available, read_runtime_record_at,
        runtime_record_matches_app, write_runtime_record_at, ProcessManager, ProcessStatus,
        RuntimeRecord,
    };
    use crate::official_market::{OfficialApp, OfficialArtifact, OfficialProcess};
    use std::sync::Mutex;

    static NETWORK_TEST_LOCK: Mutex<()> = Mutex::new(());

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
    async fn staging_版本通过健康检查后会清理整个进程组() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap();
        let directory =
            std::env::temp_dir().join(format!("aidea-staging-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("demo-server");
        std::fs::write(
            &script,
            "#!/usr/bin/python3\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\nimport os, sys, time\nclass Handler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200 if self.path == '/health' else 404)\n        self.end_headers()\n    def log_message(self, *_): pass\nif os.fork() == 0:\n    HTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()\nwhile True:\n    time.sleep(1)\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
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
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["demo-server".into(), port.to_string()],
                working_directory: ".".into(),
                ready_url: format!("http://127.0.0.1:{port}/health"),
            },
            update_available: false,
        };

        check_official_source(&app, &directory).await.unwrap();
        let port_released = ensure_ready_port_available(&app.process.ready_url).is_ok();
        std::fs::remove_dir_all(&directory).unwrap();
        assert!(port_released);
    }

    #[test]
    fn 官方应用只执行包根目录中的裸二进制() {
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
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec![command.clone()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_available: false,
        };

        assert!(command_for_official_app(&app, &directory).is_err());
        std::fs::write(directory.join(&command), b"not a Mach-O binary").unwrap();
        assert!(command_for_official_app(&app, &directory).is_err());
        let mut arm64 = Vec::new();
        arm64.extend_from_slice(&0xfeed_facfu32.to_le_bytes());
        arm64.extend_from_slice(&0x0100_000cu32.to_le_bytes());
        arm64.extend_from_slice(&0u32.to_le_bytes());
        std::fs::write(directory.join(&command), arm64).unwrap();
        let (program, path) = command_for_official_app(&app, &directory).unwrap();

        std::fs::remove_dir_all(&directory).unwrap();
        assert_eq!(program, directory.join(command));
        assert_eq!(
            std::env::split_paths(&path.unwrap()).next(),
            Some(directory)
        );
    }

    #[test]
    fn 遗留进程必须匹配当前_arm64应用定义() {
        let directory = std::env::temp_dir().join(format!("aidea-binary-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let app = OfficialApp {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["demo".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_available: false,
        };
        let record = RuntimeRecord {
            app_id: app.id.clone(),
            pid: 1234,
            process_group: None,
            started_at: 1,
            process_started_at: String::new(),
            command: app.process.command.clone(),
            working_directory: directory
                .join(&app.process.working_directory)
                .to_string_lossy()
                .into_owned(),
            ready_url: app.process.ready_url.clone(),
            log_path: String::new(),
            version: app.version.clone(),
            instance_id: String::new(),
        };

        std::fs::write(directory.join("demo"), b"#!/bin/sh\n").unwrap();
        assert!(!runtime_record_matches_app(&record, &app, &directory));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 点号工作目录的运行记录使用规范路径匹配() {
        let directory =
            std::env::temp_dir().join(format!("aidea-runtime-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let program = directory.join("demo");
        let mut arm64 = Vec::new();
        arm64.extend_from_slice(&0xfeed_facfu32.to_le_bytes());
        arm64.extend_from_slice(&0x0100_000cu32.to_le_bytes());
        arm64.extend_from_slice(&0u32.to_le_bytes());
        std::fs::write(&program, arm64).unwrap();
        let app = OfficialApp {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["demo".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_available: false,
        };
        let record = RuntimeRecord {
            app_id: app.id.clone(),
            pid: 1234,
            process_group: Some(1234),
            started_at: 1,
            process_started_at: String::new(),
            command: super::runtime_command(&program, &app.process.command),
            working_directory: canonical_working_directory(&directory, ".")
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            ready_url: app.process.ready_url.clone(),
            log_path: String::new(),
            version: app.version.clone(),
            instance_id: String::new(),
        };

        assert!(runtime_record_matches_app(&record, &app, &directory));
        std::fs::remove_dir_all(directory).unwrap();
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
            process_group: None,
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
    fn 命令校验要求完整路径与有序参数完全匹配() {
        assert!(command_matches(
            &[
                "/apps/demo/source/demo".into(),
                "--port".into(),
                "43120".into(),
            ],
            "/apps/demo/source/demo --port 43120"
        ));
        assert!(!command_matches(
            &[
                "/apps/demo/source/demo".into(),
                "--port".into(),
                "43120".into(),
            ],
            "/other/demo --port 43120"
        ));
        assert!(!command_matches(
            &[
                "/apps/demo/source/demo".into(),
                "--port".into(),
                "43120".into(),
            ],
            "/apps/demo/source/demo --port 43120 --debug"
        ));
        assert!(!command_matches(
            &[
                "/apps/demo/source/demo".into(),
                "--port".into(),
                "43120".into(),
            ],
            "/apps/demo/source/demo 43120 --port"
        ));
        assert!(command_matches(
            &["/Applications/Application Support/demo".into()],
            "/Applications/Application Support/demo"
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
                process_group: None,
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
                process_group: None,
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
