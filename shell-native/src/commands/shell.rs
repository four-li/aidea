use crate::config::{load_config, save_config, AppOverride, ShellConfig};
use crate::error::{AppError, AppResult};
use crate::manifest::{find_manifest, load_all_manifests, save_manifest, AppManifest};
use crate::process::{AppState, ProcessManager};
use tauri::State;

#[tauri::command]
pub async fn list_apps() -> AppResult<Vec<AppManifest>> {
    load_all_manifests()
}

#[tauri::command]
pub async fn save_app_manifest(manifest: AppManifest) -> AppResult<()> {
    save_manifest(&manifest)
}

#[tauri::command]
pub async fn get_shell_config() -> AppResult<ShellConfig> {
    load_config()
}

#[tauri::command]
pub async fn save_app_override(id: String, override_cfg: AppOverride) -> AppResult<()> {
    let mut config = load_config()?;
    if is_empty_override(&override_cfg) {
        config.overrides.remove(&id);
    } else {
        config.overrides.insert(id, override_cfg);
    }
    save_config(&config)
}

#[tauri::command]
pub async fn reset_app_override(id: String) -> AppResult<()> {
    let mut config = load_config()?;
    if config.overrides.remove(&id).is_none() {
        return Ok(());
    }
    save_config(&config)
}

fn is_empty_override(o: &AppOverride) -> bool {
    o.name.is_none() && o.icon.is_none() && o.url.is_none() && o.start.is_none()
}

#[tauri::command]
pub async fn start_app(id: String, manager: State<'_, ProcessManager>) -> AppResult<u32> {
    manager.start(&id).await
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
    let process_cfg = manifest
        .process
        .ok_or_else(|| AppError::Process(format!("{} 无 process 配置", id)))?;
    let log_path = process_cfg
        .log_file
        .ok_or_else(|| AppError::Process(format!("{} 未配置 log_file", id)))?;

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
