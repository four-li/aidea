use crate::config::data_root;
use crate::error::{AppError, AppResult};
use crate::manifest::{
    AppIssue, AppManifest, AppStatus, ProcessConfig, UiConfig, UiMode,
};
use crate::plugin_market::{load_cached_official_plugins, load_official_plugins, OfficialPlugin};
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub version: String,
    pub revision: String,
    pub status: String,
    /// 安装时保存的定义快照，市场离线时仍可启动和卸载。
    #[serde(default)]
    pub definition: Option<OfficialPlugin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInstallProgress {
    pub id: String,
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginUpdateStatus {
    Installed,
    UpdateAvailable,
}

pub fn plugin_update_status(installed_version: &str, market_version: &str) -> PluginUpdateStatus {
    match (
        parse_version(installed_version),
        parse_version(market_version),
    ) {
        (Some(installed), Some(market)) if market > installed => {
            PluginUpdateStatus::UpdateAvailable
        }
        _ => PluginUpdateStatus::Installed,
    }
}

fn parse_version(value: &str) -> Option<[u64; 3]> {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.').map(str::parse::<u64>);
    match (parts.next()?, parts.next()?, parts.next()?, parts.next()) {
        (Ok(major), Ok(minor), Ok(patch), None) => Some([major, minor, patch]),
        _ => None,
    }
}

fn install_root(id: &str) -> AppResult<PathBuf> {
    Ok(data_root()?.join("apps/installed").join(id))
}

fn record_path(id: &str) -> AppResult<PathBuf> {
    // 安装状态不是可启动的 AppManifest，不能放在 manifest.yaml。
    Ok(install_root(id)?.join("install-state.yaml"))
}

fn install_log_path(id: &str) -> AppResult<PathBuf> {
    Ok(data_root()?.join("logs").join(id).join("install.log"))
}

fn plugin(id: &str) -> AppResult<OfficialPlugin> {
    if let Some(plugin) = load_cached_official_plugins()
        .ok()
        .and_then(|plugins| plugins.into_iter().find(|item| item.id == id))
    {
        return Ok(plugin);
    }
    // 在官方应用仓库发布 aidea.yaml 前，保留旧收录定义以兼容已安装应用。
    load_official_plugins()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

fn clone_args(def: &OfficialPlugin, staging: &Path, use_http_1_1: bool) -> Vec<String> {
    let mut args = Vec::new();
    if use_http_1_1 {
        args.extend(["-c".into(), "http.version=HTTP/1.1".into()]);
    }
    args.extend([
        "clone".into(),
        "--no-checkout".into(),
        def.repository.clone(),
        staging.to_string_lossy().into_owned(),
    ]);
    args
}

fn is_http2_transport_error(error: &AppError) -> bool {
    matches!(error, AppError::Process(message) if message.contains("HTTP2 framing") || message.contains("HTTP/2 framing"))
}

fn read_log_tail(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::from("安装日志不存在"));
    }
    let content = fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().rev().take(200).collect();
    let mut result = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !result.is_empty() {
        result.push('\n');
    }
    Ok(result)
}

fn report_progress(
    def: &OfficialPlugin,
    on_progress: &mut (dyn FnMut(PluginInstallProgress) + Send),
    phase: &str,
    message: &str,
) {
    on_progress(PluginInstallProgress {
        id: def.id.clone(),
        phase: phase.into(),
        message: message.into(),
    });
}

async fn run(program: &str, args: &[String], cwd: &Path, log: &mut File) -> AppResult<()> {
    writeln!(log, "$ {program} {}", args.join(" "))?;
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| AppError::Process(format!("执行 {program} 失败: {error}")))?;
    if !output.stdout.is_empty() {
        writeln!(
            log,
            "{}",
            String::from_utf8_lossy(&output.stdout).trim_end()
        )?;
    }
    if !output.stderr.is_empty() {
        writeln!(
            log,
            "{}",
            String::from_utf8_lossy(&output.stderr).trim_end()
        )?;
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "{program} 执行失败: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

async fn install_inner(
    def: &OfficialPlugin,
    on_progress: &mut (dyn FnMut(PluginInstallProgress) + Send),
) -> AppResult<InstalledPlugin> {
    let root = install_root(&def.id)?;
    fs::create_dir_all(&root)?;
    let log_path = install_log_path(&def.id)?;
    let log_parent = log_path
        .parent()
        .ok_or_else(|| AppError::Config("无法定位插件安装日志目录".into()))?;
    fs::create_dir_all(log_parent)?;
    let mut log = File::create(&log_path)?;
    writeln!(log, "开始安装官方插件 {}", def.id)?;
    let staging = root.join(format!("staging-{}", Uuid::new_v4()));
    let old_source = root.join("source");
    let result = async {
        report_progress(def, on_progress, "cloning", "正在拉取源码…");
        let clone_result = run("git", &clone_args(def, &staging, false), &root, &mut log).await;
        if let Err(error) = clone_result {
            if !is_http2_transport_error(&error) {
                return Err(error);
            }
            writeln!(log, "检测到 HTTP/2 传输错误，使用 HTTP/1.1 重试一次")?;
            if staging.exists() {
                fs::remove_dir_all(&staging)?;
            }
            report_progress(
                def,
                on_progress,
                "cloning",
                "HTTP/2 连接异常，正在兼容重试…",
            );
            run("git", &clone_args(def, &staging, true), &root, &mut log).await?;
        }
        report_progress(def, on_progress, "checkout", "正在切换固定版本…");
        run(
            "git",
            &["checkout".into(), def.revision.clone()],
            &staging,
            &mut log,
        )
        .await?;
        for command in &def.install {
            report_progress(def, on_progress, "installing", "正在安装依赖…");
            run(&command[0], &command[1..], &staging, &mut log).await?;
        }
        let backup = root.join(format!("source-backup-{}", Uuid::new_v4()));
        if old_source.exists() {
            fs::rename(&old_source, &backup)?;
        }
        if let Err(error) = fs::rename(&staging, &old_source) {
            if backup.exists() {
                let _ = fs::rename(&backup, &old_source);
            }
            return Err(error.into());
        }
        if backup.exists() {
            fs::remove_dir_all(backup)?;
        }
        let installed = InstalledPlugin {
            id: def.id.clone(),
            version: def.version.clone(),
            revision: def.revision.clone(),
            status: "installed".into(),
            definition: Some(def.clone()),
        };
        fs::write(record_path(&def.id)?, serde_yaml::to_string(&installed)?)?;
        writeln!(log, "安装完成")?;
        report_progress(def, on_progress, "completed", "安装完成");
        Ok(installed)
    }
    .await;
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if let Err(error) = &result {
        let _ = writeln!(log, "安装失败: {error}");
        report_progress(def, on_progress, "failed", "安装失败");
    }
    result
}

pub async fn install(id: &str) -> AppResult<InstalledPlugin> {
    install_with_progress(id, |_| {}).await
}

pub async fn install_with_progress(
    id: &str,
    mut on_progress: impl FnMut(PluginInstallProgress) + Send,
) -> AppResult<InstalledPlugin> {
    install_inner(&plugin(id)?, &mut on_progress).await
}

pub fn read_install_log(id: &str) -> AppResult<String> {
    let _ = plugin(id)?;
    read_log_tail(&install_log_path(id)?)
}

pub fn list_installed() -> AppResult<Vec<InstalledPlugin>> {
    let root = data_root()?.join("apps/installed");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root)? {
        let id = entry?.file_name().to_string_lossy().into_owned();
        let path = record_path(&id)?;
        if path.exists() {
            result.push(serde_yaml::from_str(&fs::read_to_string(path)?)?);
        }
    }
    result.sort_by(|a: &InstalledPlugin, b: &InstalledPlugin| a.id.cmp(&b.id));
    Ok(result)
}

/// 已安装的官方插件由市场定义派生为壳可展示的 WebView 应用。
pub fn list_installed_app_manifests() -> AppResult<Vec<AppManifest>> {
    let mut manifests = Vec::new();
    let root = data_root()?.join("apps/installed");
    if !root.exists() {
        return Ok(manifests);
    }
    for entry in fs::read_dir(root)? {
        let id = entry?.file_name().to_string_lossy().into_owned();
        let path = record_path(&id)?;
        if !path.exists() {
            continue;
        }
        let record = match serde_yaml::from_str(&fs::read_to_string(&path)?) {
            Ok(record) => record,
            Err(error) => {
                manifests.push(unavailable_app_manifest(
                    &InstalledPlugin {
                        id,
                        version: "未知".into(),
                        revision: String::new(),
                        status: "invalid".into(),
                        definition: None,
                    },
                    AppError::Config(format!("读取安装记录失败: {error}")),
                ));
                continue;
            }
        };
        match installed_definition_from_record(&record) {
            Ok(definition) => {
                manifests.push(installed_app_manifest(&definition, &source_dir(&definition.id)?)?);
            }
            Err(error) => manifests.push(unavailable_app_manifest(&record, error)),
        }
    }
    Ok(manifests)
}

fn unavailable_app_manifest(record: &InstalledPlugin, error: AppError) -> AppManifest {
    AppManifest {
        id: record.id.clone(),
        name: record.id.clone(),
        version: record.version.clone(),
        category: "官方应用".into(),
        path: install_root(&record.id)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        status: AppStatus::Active,
        ui: UiConfig {
            mode: UiMode::None,
            url: None,
            icon: None,
        },
        settings: None,
        process: None,
        issue: Some(AppIssue {
            level: "warning".into(),
            message: format!("应用定义不可用：{error}。请刷新市场后更新或卸载。"),
            updated_at: chrono::Utc::now().timestamp(),
        }),
    }
}

pub fn source_dir(id: &str) -> AppResult<PathBuf> {
    Ok(install_root(id)?.join("source"))
}

pub fn installed_definition(id: &str) -> AppResult<OfficialPlugin> {
    let record = list_installed()?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))?;
    let definition = installed_definition_from_record(&record)?;
    if !source_dir(id)?.is_dir() {
        return Err(AppError::Process(format!("官方插件 {id} 源码目录不存在")));
    }
    Ok(definition)
}

fn installed_definition_from_record(record: &InstalledPlugin) -> AppResult<OfficialPlugin> {
    if let Some(definition) = &record.definition {
        return Ok(definition.clone());
    }
    plugin(&record.id)
}

fn installed_app_manifest(definition: &OfficialPlugin, source: &Path) -> AppResult<AppManifest> {
    let mut url = reqwest::Url::parse(&definition.process.ready_url)
        .map_err(|error| AppError::Config(format!("官方插件地址无效: {error}")))?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(AppManifest {
        id: definition.id.clone(),
        name: definition.name.clone(),
        version: definition.version.clone(),
        category: definition.category.clone(),
        path: source.to_string_lossy().into_owned(),
        status: AppStatus::Active,
        ui: UiConfig {
            mode: UiMode::Webview,
            url: Some(url.into()),
            icon: Some(definition.icon.clone()),
        },
        settings: definition.settings.clone(),
        process: Some(ProcessConfig {
            start: "official-plugin".into(),
            stop: Default::default(),
            autostart: false,
            working_dir: Some(source.to_string_lossy().into_owned()),
            log_file: Some(
                data_root()?
                    .join("logs")
                    .join(&definition.id)
                    .join("plugin.log")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }),
        issue: None,
    })
}

pub async fn uninstall(id: &str) -> AppResult<()> {
    // 只允许卸载已有安装记录，市场离线时仍可清理已安装应用。
    if !list_installed()?.iter().any(|record| record.id == id) {
        return Err(AppError::AppNotFound(id.to_string()));
    }
    let root = install_root(id)?;
    if root.exists() {
        if root.join("source").exists() {
            fs::remove_dir_all(root.join("source"))?;
        }
        if root.join("install-state.yaml").exists() {
            fs::remove_file(root.join("install-state.yaml"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        clone_args, installed_app_manifest, is_http2_transport_error, list_installed_app_manifests,
        plugin_update_status, read_log_tail, InstalledPlugin, PluginUpdateStatus,
    };
    use crate::error::AppError;
    use crate::plugin_market::{OfficialPlugin, OfficialProcess};
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex;
    use uuid::Uuid;

    static DATA_DIR_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn 安装记录可序列化() {
        let value = InstalledPlugin {
            id: "demo".into(),
            version: "1".into(),
            revision: "abc".into(),
            status: "installed".into(),
            definition: None,
        };
        let yaml = serde_yaml::to_string(&value).unwrap();
        assert!(yaml.contains("id: demo"));
    }

    #[test]
    fn 安装记录保留应用定义快照() {
        let definition = OfficialPlugin {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1.0.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "a".repeat(40),
            runtime: "node".into(),
            install: vec![],
            process: OfficialProcess {
                command: vec!["node".into(), "server.js".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            settings: None,
            update_notes: String::new(),
            update_available: false,
        };
        let value = InstalledPlugin {
            id: definition.id.clone(),
            version: definition.version.clone(),
            revision: definition.revision.clone(),
            status: "installed".into(),
            definition: Some(definition),
        };

        let restored: InstalledPlugin =
            serde_yaml::from_str(&serde_yaml::to_string(&value).unwrap()).unwrap();

        assert_eq!(restored.definition.unwrap().name, "Demo");
    }

    #[test]
    fn 旧安装记录缺少定义快照会显示异常应用() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-plugin-{}", Uuid::new_v4()));
        let app_dir = directory.join("apps/installed/legacy-plugin");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join("install-state.yaml"),
            "id: legacy-plugin\nversion: 0.1.0\nrevision: abc\nstatus: installed\n",
        )
        .unwrap();

        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);
        let result = list_installed_app_manifests();
        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        fs::remove_dir_all(directory).unwrap();

        assert!(result.is_ok());
        let manifests = result.unwrap();
        assert_eq!(manifests[0].id, "legacy-plugin");
        assert!(manifests[0].issue.is_some());
    }

    #[test]
    fn 只有市场版本更高才显示更新() {
        assert_eq!(
            plugin_update_status("0.1.0", "0.1.0"),
            PluginUpdateStatus::Installed
        );
        assert_eq!(
            plugin_update_status("0.1.0", "0.1.1"),
            PluginUpdateStatus::UpdateAvailable
        );
        assert_eq!(
            plugin_update_status("0.1.1", "0.1.0"),
            PluginUpdateStatus::Installed
        );
    }

    #[test]
    fn 已安装官方插件转换为可显示的_webview_manifest() {
        let definition = OfficialPlugin {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "abc".into(),
            runtime: "node".into(),
            install: vec![],
            process: OfficialProcess {
                command: vec!["node".into(), "server.js".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            settings: None,
            update_notes: String::new(),
            update_available: false,
        };
        let manifest = installed_app_manifest(&definition, Path::new("/tmp/demo/source")).unwrap();
        assert_eq!(manifest.id, "demo");
        assert_eq!(manifest.ui.mode, crate::manifest::UiMode::Webview);
        assert!(manifest.process.is_some());
    }

    #[test]
    fn http_2_错误时才使用_http_1_1_重试() {
        let definition = OfficialPlugin {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "abc".into(),
            runtime: "node".into(),
            install: vec![],
            process: OfficialProcess {
                command: vec!["node".into(), "server.js".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            settings: None,
            update_notes: String::new(),
            update_available: false,
        };

        let default_args = clone_args(&definition, Path::new("/tmp/demo"), false);
        let retry_args = clone_args(&definition, Path::new("/tmp/demo"), true);

        assert_eq!(default_args[0], "clone");
        assert_eq!(retry_args[..3], ["-c", "http.version=HTTP/1.1", "clone"]);
        assert!(is_http2_transport_error(&AppError::Process(
            "git 执行失败: curl 16 Error in the HTTP2 framing layer".into()
        )));
        assert!(!is_http2_transport_error(&AppError::Process(
            "git 执行失败: repository not found".into()
        )));
    }

    #[test]
    fn 安装日志只读取末尾_200_行() {
        let path = std::env::temp_dir().join(format!("aidea-install-log-{}.log", Uuid::new_v4()));
        let content = (0..205)
            .map(|index| format!("line-{index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, content).unwrap();

        let log = read_log_tail(&path).unwrap();

        assert!(!log.contains("line-0\n"));
        assert!(log.contains("line-5"));
        assert!(log.contains("line-204"));
        fs::remove_file(path).unwrap();
    }
}
