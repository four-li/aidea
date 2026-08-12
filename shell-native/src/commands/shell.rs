use crate::config::{
    app_data_dir, data_root, load_config, save_config, AppUserSettings, ShellConfig, StartupMode,
};
use crate::error::{AppError, AppResult};
use crate::manifest::{find_manifest, load_all_manifests, AppManifest};
use crate::process::{AppState, ProcessManager};
use tauri::{Emitter, State};
use tauri_plugin_updater::UpdaterExt;
use tokio::process::Command;

#[derive(serde::Serialize)]
pub struct AideaUpdate {
    version: String,
    body: Option<String>,
    date: Option<String>,
}

fn current_aidea_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_aidea_version() -> String {
    current_aidea_version()
}

#[tauri::command]
pub fn get_os_username() -> AppResult<String> {
    std::env::var("USER")
        .ok()
        .filter(|username| !username.trim().is_empty())
        .ok_or_else(|| AppError::Config("无法读取 macOS 短用户名".into()))
}

#[tauri::command]
pub async fn check_aidea_update(app: tauri::AppHandle) -> AppResult<Option<AideaUpdate>> {
    let update = app
        .updater()
        .map_err(|error| AppError::Network(format!("初始化更新检查失败: {error}")))?
        .check()
        .await
        .map_err(|error| AppError::Network(format!("检查更新失败: {error}")))?;

    Ok(update.map(|update| AideaUpdate {
        version: update.version,
        body: update.body,
        date: update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
pub async fn install_aidea_update(app: tauri::AppHandle) -> AppResult<()> {
    let update = app
        .updater()
        .map_err(|error| AppError::Network(format!("初始化更新失败: {error}")))?
        .check()
        .await
        .map_err(|error| AppError::Network(format!("检查更新失败: {error}")))?
        .ok_or_else(|| AppError::Config("当前没有可安装的更新".into()))?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| AppError::Network(format!("下载或验证更新失败: {error}")))?;
    app.restart();
}

fn reset_command_for(manifest: &AppManifest) -> AppResult<&[String]> {
    let settings = manifest
        .settings
        .as_ref()
        .ok_or_else(|| AppError::Config(format!("{} 不支持重置设置", manifest.name)))?;
    let command = settings
        .reset_command
        .as_deref()
        .ok_or_else(|| AppError::Config(format!("{} 不支持重置设置", manifest.name)))?;
    if command
        .first()
        .is_none_or(|program| program.trim().is_empty())
    {
        return Err(AppError::Config("重置设置命令为空".into()));
    }
    Ok(command)
}

fn should_restart_after_reset(was_running: bool) -> bool {
    was_running
}

async fn run_reset_command(
    command: &[String],
    working_directory: &std::path::Path,
    app_id: &str,
    app_data_directory: &std::path::Path,
    log_directory: &std::path::Path,
) -> AppResult<()> {
    let (program, args) = command
        .split_first()
        .ok_or_else(|| AppError::Config("重置设置命令为空".into()))?;
    if program.trim().is_empty() {
        return Err(AppError::Config("重置设置命令为空".into()));
    }
    std::fs::create_dir_all(app_data_directory)?;
    std::fs::create_dir_all(log_directory)?;
    let output = Command::new(program)
        .args(args)
        .current_dir(working_directory)
        .env("AIDEA_APP_ID", app_id)
        .env("AIDEA_APP_DATA_DIR", app_data_directory)
        .env("AIDEA_APP_LOG_DIR", log_directory)
        .output()
        .await
        .map_err(|error| AppError::Process(format!("执行重置设置命令失败: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(AppError::Process(format!(
        "重置设置命令失败: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

#[tauri::command]
pub async fn list_apps() -> AppResult<Vec<AppManifest>> {
    load_all_manifests()
}

#[tauri::command]
pub async fn list_official_apps() -> AppResult<Vec<crate::official_market::OfficialAppListing>> {
    crate::official_market::add_install_status(crate::official_market::load_cached_official_apps()?)
}

#[tauri::command]
pub async fn refresh_official_apps() -> AppResult<Vec<crate::official_market::OfficialAppListing>> {
    crate::official_market::add_install_status(
        crate::official_market::refresh_official_definitions()
            .await?
            .into_iter()
            .map(crate::official_market::CachedOfficialApp::into_app)
            .collect(),
    )
}

#[tauri::command]
pub async fn list_installed_official_apps(
) -> AppResult<Vec<crate::official_app_installer::InstalledApp>> {
    crate::official_app_installer::list_installed()
}

#[tauri::command]
pub async fn install_official_app(
    id: String,
    app: tauri::AppHandle,
) -> AppResult<crate::official_app_installer::InstalledApp> {
    crate::official_app_installer::install_with_progress(&id, move |progress| {
        let _ = app.emit("official-app-install-progress", progress);
    })
    .await
}

#[tauri::command]
pub async fn update_official_app(
    id: String,
    manager: State<'_, ProcessManager>,
    app: tauri::AppHandle,
) -> AppResult<crate::official_app_installer::InstalledApp> {
    let was_running = manager.is_running(&id)?;
    let previous_definition = if was_running {
        Some(crate::official_app_installer::installed_definition(&id)?)
    } else {
        None
    };
    if was_running {
        manager.stop(&id).await?;
    }
    if !was_running {
        return crate::official_app_installer::install_with_progress(&id, move |progress| {
            let _ = app.emit("official-app-install-progress", progress);
        })
        .await;
    }

    let (installed, rollback) =
        match crate::official_app_installer::install_update_with_progress(&id, move |progress| {
            let _ = app.emit("official-app-install-progress", progress);
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                let previous_definition = previous_definition.expect("运行中的应用必须有旧定义");
                if let Err(restart_error) = manager.start_official(&previous_definition).await {
                    manager.record_issue(&id, &restart_error);
                    return Err(AppError::Process(format!(
                        "官方应用 {} 更新失败，且恢复旧版本运行失败: {}; 原因: {}",
                        id, restart_error, error
                    )));
                }
                return Err(error);
            }
        };

    let updated_definition = crate::official_app_installer::installed_definition(&id)?;
    if let Err(error) = manager.start_official(&updated_definition).await {
        if let Err(rollback_error) = crate::official_app_installer::rollback_update(&id, rollback) {
            manager.record_issue(&id, &rollback_error);
            return Err(AppError::Process(format!(
                "官方应用 {} 更新后启动失败，且回滚失败: {}; 原因: {}",
                id, rollback_error, error
            )));
        }
        let previous_definition = previous_definition.expect("运行中的应用必须有旧定义");
        if let Err(restart_error) = manager.start_official(&previous_definition).await {
            manager.record_issue(&id, &restart_error);
            return Err(AppError::Process(format!(
                "官方应用 {} 更新后启动失败，旧版本恢复运行也失败: {}; 原因: {}",
                id, restart_error, error
            )));
        }
        return Err(AppError::Process(format!(
            "官方应用 {} 更新后启动失败，已恢复旧版本: {}",
            id, error
        )));
    }
    crate::official_app_installer::commit_update(rollback)?;
    Ok(installed)
}

#[tauri::command]
pub async fn read_official_app_install_log(id: String) -> AppResult<String> {
    crate::official_app_installer::read_install_log(&id)
}

#[tauri::command]
pub async fn uninstall_official_app(
    id: String,
    manager: State<'_, ProcessManager>,
) -> AppResult<()> {
    if manager.is_running(&id)? {
        manager.stop(&id).await?;
    }
    crate::official_app_installer::uninstall(&id).await
}

#[tauri::command]
pub async fn get_shell_config() -> AppResult<ShellConfig> {
    load_config()
}

#[tauri::command]
pub async fn save_app_user_settings(id: String, settings: AppUserSettings) -> AppResult<()> {
    let manifest = find_manifest(&id)?;
    if manifest.ui.mode == crate::manifest::UiMode::Builtin
        && settings.startup_mode != StartupMode::Manual
    {
        return Err(AppError::Config("内置应用不支持随 aIdea 启动".into()));
    }
    let mut config = load_config()?;
    if settings == AppUserSettings::default() {
        config.app_settings.remove(&id);
    } else {
        config.app_settings.insert(id, settings);
    }
    save_config(&config)
}

#[tauri::command]
pub async fn reset_app_settings(id: String, manager: State<'_, ProcessManager>) -> AppResult<()> {
    let manifest = find_manifest(&id)?;
    let command = reset_command_for(&manifest)?;
    if manifest.ui.mode == crate::manifest::UiMode::Builtin {
        return match id.as_str() {
            "dev-tools" => crate::commands::dev_tools::reset_dev_tools_settings(),
            _ => Err(AppError::Config(format!(
                "{} 未注册重置处理器",
                manifest.name
            ))),
        };
    }

    let app = crate::official_app_installer::installed_definition(&id)?;
    let was_running = manager.is_running(&id)?;
    if was_running {
        manager.stop(&id).await?;
    }

    let reset_result = run_reset_command(
        command,
        &crate::official_app_installer::source_dir(&id)?,
        &id,
        &app_data_dir(&id)?,
        &data_root()?.join("logs").join(&id),
    )
    .await;

    let restart_result = if should_restart_after_reset(was_running) {
        manager.start_official(&app).await.map(|_| ())
    } else {
        Ok(())
    };
    reset_result?;
    restart_result
}

#[cfg(test)]
mod tests {
    use super::{
        current_aidea_version, get_os_username, reset_command_for, run_reset_command,
        should_restart_after_reset,
    };
    use crate::manifest::{AppManifest, AppStatus, SettingsConfig, UiConfig, UiMode};

    #[test]
    fn 读取当前用户短用户名() {
        assert!(!get_os_username().expect("测试环境应提供 USER").is_empty());
    }

    fn manifest(settings: Option<SettingsConfig>) -> AppManifest {
        AppManifest {
            id: "demo".into(),
            name: "Demo".into(),
            description: String::new(),
            version: "1.0.0".into(),
            category: "test".into(),
            status: AppStatus::Active,
            ui: UiConfig {
                mode: UiMode::Webview,
                url: Some("http://127.0.0.1:43120".into()),
                icon: None,
            },
            settings,
            process: None,
            issue: None,
        }
    }

    #[test]
    fn 未声明重置命令的应用不能重置设置() {
        assert!(reset_command_for(&manifest(None)).is_err());
    }

    #[test]
    fn 空的重置程序会被拒绝() {
        assert!(reset_command_for(&manifest(Some(SettingsConfig {
            reset_command: Some(vec![String::new()]),
        })))
        .is_err());
    }

    #[test]
    fn 仅在原本运行时才需要重启() {
        assert!(!should_restart_after_reset(false));
        assert!(should_restart_after_reset(true));
    }

    #[test]
    fn 当前版本来自构建包版本() {
        assert_eq!(current_aidea_version(), env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn 重置命令失败会返回错误() {
        let directory = std::env::temp_dir().join(format!("aidea-reset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let result = run_reset_command(
            &["false".into()],
            &directory,
            "demo",
            &directory.join("data"),
            &directory.join("logs"),
        )
        .await;

        assert!(result.is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[tauri::command]
pub async fn start_app(id: String, manager: State<'_, ProcessManager>) -> AppResult<u32> {
    let app = crate::official_app_installer::installed_definition(&id)?;
    let result = manager.start_official(&app).await;
    match result {
        Ok(pid) => {
            manager.clear_issue(&id);
            Ok(pid)
        }
        Err(error) => {
            manager.record_issue(&id, &error);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn stop_app(id: String, manager: State<'_, ProcessManager>) -> AppResult<()> {
    manager.stop(&id).await
}

#[tauri::command]
pub async fn get_app_states(manager: State<'_, ProcessManager>) -> AppResult<Vec<AppState>> {
    let manifests = load_all_manifests()?;
    let ids: Vec<String> = manifests
        .into_iter()
        .filter_map(|m| m.process.map(|_| m.id))
        .collect();
    manager.get_all_states(&ids)
}

#[tauri::command]
pub async fn read_app_log(id: String) -> AppResult<String> {
    let manifest = find_manifest(&id)?;
    let log_path = manifest
        .process
        .and_then(|process| process.log_file)
        .unwrap_or(
            crate::config::data_root()?
                .join("logs")
                .join(&id)
                .join("app.log")
                .to_string_lossy()
                .into_owned(),
        );

    if !std::path::Path::new(&log_path).exists() {
        return Ok(String::from("日志文件不存在"));
    }

    let content = std::fs::read_to_string(&log_path)?;
    let lines: Vec<&str> = content.lines().rev().take(200).collect();
    let mut result = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !result.is_empty() {
        result.push('\n');
    }
    Ok(result)
}
