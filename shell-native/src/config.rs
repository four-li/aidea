// 壳全局设置加载模块
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::{app_data_dir, AppUserSettings, StartupMode};

    #[test]
    fn 官方应用默认可见且手动启动() {
        let settings = AppUserSettings::default();
        assert!(settings.visible);
        assert_eq!(settings.startup_mode, StartupMode::Manual);
    }

    #[test]
    fn app_data_dir_rejects_path_segments() {
        assert!(app_data_dir("../escape").is_err());
        assert!(app_data_dir("nested/app").is_err());
        assert!(app_data_dir("dev-tools").is_ok());
    }
}

/// 官方应用的启动策略。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StartupMode {
    Manual,
    WithAidea,
}

impl Default for StartupMode {
    fn default() -> Self {
        Self::Manual
    }
}

/// 用户对单个应用的运行偏好，不写回应用 manifest 或市场定义。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppUserSettings {
    #[serde(default = "default_visible")]
    pub visible: bool,
    #[serde(default)]
    pub startup_mode: StartupMode,
}

fn default_visible() -> bool {
    true
}

impl Default for AppUserSettings {
    fn default() -> Self {
        Self {
            visible: true,
            startup_mode: StartupMode::Manual,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfig {
    /// 已安装或内置应用的用户级显示与启动偏好。
    #[serde(default)]
    pub app_settings: BTreeMap<String, AppUserSettings>,
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            app_settings: BTreeMap::new(),
        }
    }
}

/// 项目根目录（shell-native 的上一级）
/// 通过 CARGO_MANIFEST_DIR 推导，避免依赖运行时 cwd
pub fn project_root() -> AppResult<PathBuf> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    // shell-native -> 上一级 = aIdea 根
    let root = PathBuf::from(manifest_dir)
        .parent()
        .ok_or_else(|| crate::error::AppError::Config("无法定位项目根目录".into()))?
        .to_path_buf();
    Ok(root)
}

/// 用户数据根目录，不随 aIdea.app 更新而变化。
pub fn data_root() -> AppResult<PathBuf> {
    if let Ok(path) = std::env::var("AIDEA_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    dirs::data_dir()
        .map(|path| path.join("aIdea"))
        .ok_or_else(|| crate::error::AppError::Config("无法定位 macOS 用户数据目录".into()))
}

/// 返回应用自己的持久化目录，不允许应用 ID 逃出 aIdea 数据根目录。
pub fn app_data_dir(app_id: &str) -> AppResult<PathBuf> {
    if app_id.is_empty()
        || app_id == "."
        || app_id == ".."
        || app_id
            .chars()
            .any(|value| value.is_control() || value == '/' || value == '\\')
    {
        return Err(crate::error::AppError::Config("应用 ID 无效".into()));
    }
    Ok(data_root()?.join("app-data").join(app_id))
}

/// 创建 aIdea 的用户数据目录。
pub fn ensure_data_dirs() -> AppResult<PathBuf> {
    let root = data_root()?;
    for path in [
        root.join("apps/installed"),
        root.join("runtime/processes"),
        root.join("runtime/state"),
        root.join("backups"),
    ] {
        fs::create_dir_all(path)?;
    }
    Ok(root)
}

/// 从旧源码目录迁移一次用户配置。
pub fn migrate_legacy_data() -> AppResult<()> {
    let root = ensure_data_dirs()?;
    let marker = root.join(".migration-v1");
    if marker.exists() {
        return Ok(());
    }

    let legacy_root = project_root()?;
    let legacy_config = legacy_root.join("shell.config.json");
    let config_path = root.join("shell.config.json");
    if legacy_config.exists() && !config_path.exists() {
        let backup = root.join("backups/shell.config.legacy.json");
        fs::copy(&legacy_config, backup)?;
        let config: ShellConfig = serde_json::from_str(&fs::read_to_string(legacy_config)?)?;
        fs::write(config_path, serde_json::to_string_pretty(&config)?)?;
    }

    fs::write(marker, "1\n")?;
    Ok(())
}

/// 加载用户目录中的 shell.config.json，文件不存在则返回默认值。
pub fn load_config() -> AppResult<ShellConfig> {
    let root = ensure_data_dirs()?;
    let config_path = root.join("shell.config.json");
    if !config_path.exists() {
        return Ok(ShellConfig::default());
    }
    let content = std::fs::read_to_string(&config_path)?;
    let config: ShellConfig = serde_json::from_str(&content)?;
    Ok(config)
}

/// 保存 shell.config.json
pub fn save_config(config: &ShellConfig) -> AppResult<()> {
    let root = ensure_data_dirs()?;
    let config_path = root.join("shell.config.json");
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&config_path, content)?;
    Ok(())
}
