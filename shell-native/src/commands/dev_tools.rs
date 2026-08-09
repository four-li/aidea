use crate::config::app_data_dir;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevToolsSettings {
    #[serde(default)]
    pub hidden_tabs: BTreeSet<String>,
}

fn open_database(root: &Path) -> AppResult<Connection> {
    fs::create_dir_all(root)?;
    let connection = Connection::open(root.join("app.db"))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS dev_tools_settings (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             hidden_tabs TEXT NOT NULL
         );",
    )?;
    Ok(connection)
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
    let connection = open_database(root)?;
    let hidden_tabs = connection
        .query_row(
            "SELECT hidden_tabs FROM dev_tools_settings WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(value) = hidden_tabs else {
        return Ok(DevToolsSettings::default());
    };
    let settings = serde_json::from_str(&value)?;
    validate_settings(&settings)?;
    Ok(settings)
}

fn save_settings_to(root: &Path, settings: DevToolsSettings) -> AppResult<()> {
    validate_settings(&settings)?;
    let connection = open_database(root)?;
    connection.execute(
        "INSERT INTO dev_tools_settings (id, hidden_tabs) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET hidden_tabs = excluded.hidden_tabs",
        [serde_json::to_string(&settings)?],
    )?;
    Ok(())
}

pub fn reset_dev_tools_settings() -> AppResult<()> {
    let connection = open_database(&app_data_dir("dev-tools")?)?;
    connection.execute("DELETE FROM dev_tools_settings WHERE id = 1", [])?;
    Ok(())
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
    use super::{load_settings_from, open_database, save_settings_to, DevToolsSettings};
    use std::collections::BTreeSet;

    fn temp_directory() -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("aidea-dev-tools-{}", uuid::Uuid::new_v4()));
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
        assert!(directory.join("app.db").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 损坏的配置返回错误且不会静默覆盖文件() {
        let directory = temp_directory();
        let connection = open_database(&directory).unwrap();
        connection
            .execute(
                "INSERT INTO dev_tools_settings (id, hidden_tabs) VALUES (1, ?1)",
                ["{invalid"],
            )
            .unwrap();

        assert!(load_settings_from(&directory).is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT hidden_tabs FROM dev_tools_settings WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "{invalid"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
