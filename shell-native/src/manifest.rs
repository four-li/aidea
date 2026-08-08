// 子应用 Manifest 加载与解析模块
use crate::config::{load_config, AppOverride};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const BUILTIN_MANIFESTS: &[&str] = &[
    include_str!("../../apps/builtin/dashboard.yaml"),
    include_str!("../../apps/builtin/dev-tools.yaml"),
    include_str!("../../apps/builtin/mail-manager.yaml"),
];

/// UI 接入模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiMode {
    /// 嵌入外部 web 应用
    Webview,
    /// 壳内置页面（path 指向 shell-frontend/src/builtin-apps/<name>）
    Builtin,
    /// 无 UI，纯后台进程
    None,
}

/// 子应用状态（合并 enabled/disabled 概念）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppStatus {
    /// 正常启用
    Active,
    /// 临时禁用
    Disabled,
    /// 永久废弃
    Deprecated,
}

/// 停止方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StopMethod {
    /// 信号名，如 "SIGTERM" / "SIGKILL"
    Signal(String),
    /// 自定义停止命令
    Command(String),
}

impl Default for StopMethod {
    fn default() -> Self {
        StopMethod::Signal("SIGTERM".to_string())
    }
}

/// UI 配置段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub mode: UiMode,
    /// mode=webview 时必填，子应用 web server URL
    #[serde(default)]
    pub url: Option<String>,
    /// 图标路径（绝对路径）
    #[serde(default)]
    pub icon: Option<String>,
}

/// 进程配置段（无进程子应用不写此段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessConfig {
    /// 启动命令
    pub start: String,
    /// 停止方式
    #[serde(default)]
    pub stop: StopMethod,
    /// Aidea 启动时是否自动拉起，默认 false
    #[serde(default)]
    pub autostart: bool,
    /// 执行目录，默认用 path
    #[serde(default)]
    pub working_dir: Option<String>,
    /// 日志落盘位置
    #[serde(default)]
    pub log_file: Option<String>,
}

/// 子应用 Manifest 完整结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    /// 唯一标识
    pub id: String,
    /// 显示名
    pub name: String,
    /// 版本
    pub version: String,
    /// 分类（侧边栏分组用，自由字符串）
    pub category: String,
    /// 子应用根目录（webview/none 模式为绝对路径，builtin 模式为相对项目根）
    pub path: String,
    /// 状态
    pub status: AppStatus,
    /// UI 配置
    pub ui: UiConfig,
    /// 进程配置（可选）
    #[serde(default)]
    pub process: Option<ProcessConfig>,
}

/// 加载内置 manifest 和用户目录中的第三方 manifest。
pub fn load_all_manifests() -> AppResult<Vec<AppManifest>> {
    // 加载用户覆盖配置，失败不致命，降级为无覆盖
    let overrides = load_config().map(|c| c.overrides).unwrap_or_default();

    let mut manifests = Vec::new();
    for content in BUILTIN_MANIFESTS {
        let manifest: AppManifest = serde_yaml::from_str(content)
            .map_err(|e| AppError::Config(format!("解析内置 manifest 失败: {}", e)))?;
        if let Some(manifest) = apply_manifest_override(manifest, &overrides) {
            manifests.push(manifest);
        }
    }

    let data_root = crate::config::ensure_data_dirs()?;
    for entry in std::fs::read_dir(data_root.join("apps/local"))? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let manifest: AppManifest = serde_yaml::from_str(&content)
            .map_err(|e| AppError::Config(format!("解析 {} 失败: {}", path.display(), e)))?;
        if let Some(manifest) = apply_manifest_override(manifest, &overrides) {
            manifests.push(manifest);
        }
    }

    for entry in std::fs::read_dir(data_root.join("apps/installed"))? {
        let path = entry?.path().join("manifest.yaml");
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let manifest: AppManifest = serde_yaml::from_str(&content)
            .map_err(|e| AppError::Config(format!("解析 {} 失败: {}", path.display(), e)))?;
        if let Some(manifest) = apply_manifest_override(manifest, &overrides) {
            manifests.push(manifest);
        }
    }

    Ok(manifests)
}

fn apply_manifest_override(
    mut manifest: AppManifest,
    overrides: &std::collections::BTreeMap<String, AppOverride>,
) -> Option<AppManifest> {
    // deprecated 不加载
    if manifest.status == AppStatus::Deprecated {
        return None;
    }
    // 应用用户覆盖
    if let Some(ovr) = overrides.get(&manifest.id) {
        apply_override(&mut manifest, ovr);
    }
    Some(manifest)
}

/// 将单个覆盖配置应用到 manifest
fn apply_override(manifest: &mut AppManifest, ovr: &AppOverride) {
    if let Some(name) = &ovr.name {
        manifest.name = name.clone();
    }
    if let Some(icon) = &ovr.icon {
        manifest.ui.icon = Some(icon.clone());
    }
    if let Some(url) = &ovr.url {
        manifest.ui.url = Some(url.clone());
    }
    if let Some(start) = &ovr.start {
        if let Some(p) = manifest.process.as_mut() {
            p.start = start.clone();
        }
    }
}

/// 按 id 查找单个 manifest
pub fn find_manifest(id: &str) -> AppResult<AppManifest> {
    let manifests = load_all_manifests()?;
    manifests
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

/// 获取 builtin 模式子应用的绝对路径（path 是相对项目根）
pub fn builtin_app_path(manifest: &AppManifest) -> AppResult<PathBuf> {
    let root = crate::config::project_root()?;
    Ok(root.join(&manifest.path))
}

/// 保存由设置页创建或编辑的本地应用 manifest。
pub fn save_manifest(manifest: &AppManifest) -> AppResult<()> {
    if manifest.id.is_empty()
        || !manifest
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Config(
            "应用 ID 只能包含字母、数字、- 和 _".into(),
        ));
    }
    if !std::path::Path::new(&manifest.path).is_dir() {
        return Err(AppError::Config(format!(
            "应用目录不存在: {}",
            manifest.path
        )));
    }
    if manifest.name.trim().is_empty() {
        return Err(AppError::Config("应用名称不能为空".into()));
    }
    if manifest.ui.mode == UiMode::Webview && manifest.ui.url.is_none() {
        return Err(AppError::Config("webview 应用必须配置 ui.url".into()));
    }
    if manifest
        .process
        .as_ref()
        .is_some_and(|process| process.start.trim().is_empty())
    {
        return Err(AppError::Config("启动命令不能为空".into()));
    }

    let apps_dir = crate::config::ensure_data_dirs()?.join("apps/local");
    std::fs::create_dir_all(&apps_dir)?;
    let content = serde_yaml::to_string(manifest)?;
    std::fs::write(apps_dir.join(format!("{}.yaml", manifest.id)), content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{save_manifest, AppManifest, AppStatus, UiConfig, UiMode};

    #[test]
    fn rejects_invalid_id_before_writing() {
        let manifest = AppManifest {
            id: "../atlas".into(),
            name: "Atlas".into(),
            version: "0.1.0".into(),
            category: "dev-workflow".into(),
            path: "/tmp".into(),
            status: AppStatus::Active,
            ui: UiConfig {
                mode: UiMode::Webview,
                url: Some("http://127.0.0.1:5317".into()),
                icon: None,
            },
            process: None,
        };

        assert!(save_manifest(&manifest).is_err());
    }
}
