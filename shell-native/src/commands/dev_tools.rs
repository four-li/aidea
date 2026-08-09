use crate::config::app_data_dir;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevToolsSettings {
    #[serde(default)]
    pub hidden_tabs: BTreeSet<String>,
}

fn settings_path(root: &Path) -> PathBuf {
    root.join(SETTINGS_FILE)
}

fn validate_settings(settings: &DevToolsSettings) -> AppResult<()> {
    if settings
        .hidden_tabs
        .iter()
        .any(|value| value.is_empty() || value.chars().any(char::is_control))
    {
        return Err(AppError::Config("DevTools 工具 ID 无效".into()));
    }
    Ok(())
}

fn load_settings_from(root: &Path) -> AppResult<DevToolsSettings> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(DevToolsSettings::default());
    }
    let settings = serde_json::from_str(&fs::read_to_string(path)?)?;
    validate_settings(&settings)?;
    Ok(settings)
}

fn save_settings_to(root: &Path, settings: DevToolsSettings) -> AppResult<()> {
    validate_settings(&settings)?;
    fs::create_dir_all(root)?;
    let content = serde_json::to_string_pretty(&settings)?;
    let temporary_path = root.join(format!("{SETTINGS_FILE}.tmp"));
    fs::write(&temporary_path, content)?;
    fs::rename(temporary_path, settings_path(root))?;
    Ok(())
}

pub fn reset_dev_tools_settings() -> AppResult<()> {
    let path = settings_path(&app_data_dir("dev-tools")?);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub fn get_dev_tools_settings() -> AppResult<DevToolsSettings> {
    load_settings_from(&app_data_dir("dev-tools")?)
}

#[tauri::command]
pub fn save_dev_tools_settings(settings: DevToolsSettings) -> AppResult<()> {
    save_settings_to(&app_data_dir("dev-tools")?, settings)
}

#[cfg(test)]
mod tests {
    use super::{load_settings_from, save_settings_to, DevToolsSettings};
    use std::collections::BTreeSet;

    fn temp_directory() -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!("aidea-dev-tools-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn 缺少配置时返回默认值并能保存隐藏工具() {
        let directory = temp_directory();
        let settings = load_settings_from(&directory).unwrap();
        assert!(settings.hidden_tabs.is_empty());

        save_settings_to(
            &directory,
            DevToolsSettings {
                hidden_tabs: BTreeSet::from(["unicode".to_string()]),
            },
        )
        .unwrap();

        assert!(load_settings_from(&directory)
            .unwrap()
            .hidden_tabs
            .contains("unicode"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 损坏的配置返回错误且不会静默覆盖文件() {
        let directory = temp_directory();
        std::fs::write(directory.join("settings.json"), "{invalid").unwrap();

        assert!(load_settings_from(&directory).is_err());
        assert_eq!(
            std::fs::read_to_string(directory.join("settings.json")).unwrap(),
            "{invalid"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
