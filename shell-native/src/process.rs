// 子进程管理模块
// 档位：中量（启停 + 状态 + 自启 + 日志）
// 不做：健康检查、崩溃自动重启、资源监控、启动顺序/依赖
use crate::error::{AppError, AppResult};
use crate::manifest::{find_manifest, UiMode};
use crate::plugin_market::OfficialPlugin;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration, Instant};

/// 进程状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    /// 运行中
    Running,
    /// 已停止
    Stopped,
}

/// 单个应用进程的运行时状态
#[derive(Debug, Clone, Serialize)]
pub struct AppState {
    pub id: String,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
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
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self {
            table: Arc::new(Mutex::new(ProcessTable {
                entries: HashMap::new(),
            })),
        }
    }
}

impl ProcessManager {
    /// 启动官方插件。命令与参数由市场定义提供，不经 shell 解析。
    pub async fn start_official(&self, plugin: &OfficialPlugin) -> AppResult<u32> {
        if self.is_running(&plugin.id)? {
            return self
                .get_pid(&plugin.id)
                .ok_or_else(|| AppError::Process(format!("{} 已运行但 PID 丢失", plugin.id)));
        }

        let source = crate::plugin_installer::source_dir(&plugin.id)?;
        let working_dir = source.join(&plugin.process.working_directory);
        if !working_dir.starts_with(&source) || !working_dir.is_dir() {
            return Err(AppError::Process(format!("{} 工作目录无效", plugin.id)));
        }
        ensure_ready_port_available(&plugin.process.ready_url)?;
        let log_dir = crate::config::data_root()?.join("logs").join(&plugin.id);
        std::fs::create_dir_all(&log_dir)?;
        let log_path = log_dir.join("plugin.log");
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let app_data_dir = crate::config::data_root()?
            .join("app-data")
            .join(&plugin.id);
        std::fs::create_dir_all(&app_data_dir)?;

        let program = resolve_program(&plugin.process.command[0]);
        let mut child = Command::new(&program)
            .args(&plugin.process.command[1..])
            .current_dir(&working_dir)
            .env("AIDEA_APP_ID", &plugin.id)
            .env("AIDEA_APP_DATA_DIR", &app_data_dir)
            .env("AIDEA_APP_LOG_DIR", &log_dir)
            .stdout(Stdio::from(log_file.try_clone()?))
            .stderr(Stdio::from(log_file))
            .spawn()
            .map_err(|error| {
                AppError::Process(format!(
                    "启动 {} 失败（{}）: {}",
                    plugin.id,
                    program.display(),
                    error
                ))
            })?;
        let pid = child
            .id()
            .ok_or_else(|| AppError::Process(format!("获取 {} PID 失败", plugin.id)))?;
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let id = plugin.id.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => eprintln!("子应用 {} (pid={}) 已退出", id, pid),
                _ = kill_rx => {}
            }
        });
        self.table.lock().unwrap().entries.insert(
            plugin.id.clone(),
            ProcessEntry {
                pid,
                kill_tx: Some(kill_tx),
            },
        );
        if let Err(error) = wait_until_ready(&plugin.process.ready_url).await {
            let _ = self.stop(&plugin.id).await;
            return Err(AppError::Process(format!(
                "{} 服务未就绪: {}",
                plugin.id, error
            )));
        }
        Ok(pid)
    }

    /// 启动子应用
    pub async fn start(&self, id: &str) -> AppResult<u32> {
        // 已运行则直接返回 pid
        if self.is_running(id)? {
            return self
                .get_pid(id)
                .ok_or_else(|| AppError::Process(format!("{} 已运行但 PID 丢失", id)));
        }

        let manifest = find_manifest(id)?;
        let process_cfg = manifest
            .process
            .as_ref()
            .ok_or_else(|| AppError::Process(format!("{} 无 process 配置，不能启动", id)))?;

        let working_dir = process_cfg
            .working_dir
            .clone()
            .unwrap_or_else(|| manifest.path.clone());

        // 准备日志输出
        let log_path = process_cfg.log_file.as_ref();
        let (stdout, stderr) = if let Some(log_path) = log_path {
            // 确保日志目录存在
            let log_path_buf = PathBuf::from(log_path);
            let log_dir = log_path_buf
                .parent()
                .ok_or_else(|| AppError::Process(format!("日志路径无效: {}", log_path)))?;
            if !log_dir.exists() {
                std::fs::create_dir_all(log_dir)?;
            }
            let f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            (Stdio::from(f.try_clone()?), Stdio::from(f))
        } else {
            (Stdio::null(), Stdio::null())
        };

        // 解析启动命令（简单按空格切分，复杂场景后续再支持 shell 字符串）
        let mut parts = process_cfg.start.split_whitespace();
        let program = parts
            .next()
            .ok_or_else(|| AppError::Process(format!("{} 启动命令为空", id)))?;
        let args: Vec<&str> = parts.collect();

        let program_path = resolve_program(program);
        let mut child = Command::new(&program_path)
            .args(&args)
            .current_dir(&working_dir.as_str())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .map_err(|e| {
                AppError::Process(format!(
                    "启动 {} 失败（{}）: {}",
                    id,
                    program_path.display(),
                    e
                ))
            })?;

        let pid = child
            .id()
            .ok_or_else(|| AppError::Process(format!("获取 {} PID 失败", id)))?;

        // 起 tokio 任务等待子进程退出，退出后记录日志
        // 进程表的清理在 is_running 检查时按需做（pid 不存活则视作已退出）
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let id_owned = id.to_string();
        let pid_for_wait = pid;
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {
                    // 子进程自然退出
                    eprintln!("子应用 {} (pid={}) 已退出", id_owned, pid_for_wait);
                }
                _ = kill_rx => {
                    // 收到 kill 信号，实际 kill 由 stop 函数处理
                }
            }
        });

        // 记录到进程表
        {
            let mut table = self.table.lock().unwrap();
            table.entries.insert(
                id.to_string(),
                ProcessEntry {
                    pid,
                    kill_tx: Some(kill_tx),
                },
            );
        }

        if manifest.ui.mode == UiMode::Webview {
            if let Some(url) = manifest.ui.url.as_deref() {
                if let Err(error) = wait_until_ready(url).await {
                    let _ = self.stop(id).await;
                    return Err(AppError::Process(format!("{} 服务未就绪: {}", id, error)));
                }
            }
        }

        Ok(pid)
    }

    /// 停止子应用
    pub async fn stop(&self, id: &str) -> AppResult<()> {
        let entry = {
            let mut table = self.table.lock().unwrap();
            table.entries.remove(id)
        };

        let entry = entry.ok_or_else(|| AppError::Process(format!("{} 未在运行", id)))?;

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
                return Ok(());
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // 5 秒未退出，SIGKILL
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
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
        let mut states = Vec::new();
        for id in ids {
            let running = self.is_running(id)?;
            let pid = if running { self.get_pid(id) } else { None };
            states.push(AppState {
                id: id.clone(),
                status: if running {
                    ProcessStatus::Running
                } else {
                    ProcessStatus::Stopped
                },
                pid,
            });
        }
        Ok(states)
    }

    fn get_pid(&self, id: &str) -> Option<u32> {
        let table = self.table.lock().unwrap();
        table.entries.get(id).map(|e| e.pid)
    }

    fn pid_alive(&self, pid: i32) -> bool {
        // kill(pid, 0) 不发信号，仅检查进程是否存在
        // 返回 0 = 存在；返回 -1 且 errno=ESRCH = 不存在
        unsafe { libc::kill(pid, 0) == 0 }
    }
}

/// GUI 启动时通常不会加载 shell 配置，补查用户本地 bin 目录。
fn resolve_program(program: &str) -> PathBuf {
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
        let candidate = home.join(".local/bin").join(program);
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
                "端口 {host}:{port} 已被占用，无法启动插件: {error}"
            ))
        })
}

/// 启动所有 autostart=true 的子应用
pub async fn start_autostart_apps(manager: &ProcessManager) {
    let manifests = match crate::manifest::load_all_manifests() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("加载 manifest 失败，无法执行 autostart: {}", e);
            return;
        }
    };
    for m in manifests {
        if let Some(p) = &m.process {
            if p.autostart {
                if let Err(e) = manager.start(&m.id).await {
                    eprintln!("自启动 {} 失败: {}", m.id, e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_ready_port_available, ProcessManager};

    #[tokio::test]
    async fn 没有子进程时停止全部不会失败() {
        ProcessManager::default().stop_all().await;
    }

    #[test]
    fn 已占用的健康检查端口会在启动前报错() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let error = ensure_ready_port_available(&format!("http://127.0.0.1:{port}/health"))
            .unwrap_err()
            .to_string();

        assert!(error.contains(&format!("端口 127.0.0.1:{port} 已被占用")));
    }
}
