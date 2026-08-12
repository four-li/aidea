// 子应用 Manifest 加载与解析模块
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const BUILTIN_MANIFESTS: &[&str] = &[include_str!("../../apps/builtin/dev-tools.yaml")];

/// UI 接入模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiMode {
    /// 嵌入外部 web 应用
    Webview,
    /// 壳内置页面，由 BuiltinPage 按 app id 显式注册
    Builtin,
    /// 无 UI，纯后台进程
    None,
}

/// 子应用生命周期状态
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

/// UI 配置段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub mode: UiMode,
    /// WebView 主页地址；官方应用由 process.ready_url 在运行时派生
    #[serde(default)]
    pub url: Option<String>,
    /// lucide-react 图标名或图片资源路径
    #[serde(default)]
    pub icon: Option<String>,
}

/// 应用设置能力。设置字段由应用自己定义，aIdea 只管理入口和重置授权。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SettingsConfig {
    #[serde(default)]
    pub reset_command: Option<Vec<String>>,
}

/// 进程配置段（无进程子应用不写此段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessConfig {
    /// 日志落盘位置
    #[serde(default)]
    pub log_file: Option<String>,
}

/// 单个应用的可恢复异常，不影响 aIdea 壳和其他应用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppIssue {
    pub level: String,
    pub message: String,
    pub updated_at: i64,
}

/// 子应用 Manifest 完整结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    /// 唯一标识
    pub id: String,
    /// 显示名
    pub name: String,
    /// 应用简介，旧 manifest 未声明时为空
    #[serde(default)]
    pub description: String,
    /// 版本
    pub version: String,
    /// 分类（侧边栏分组用，自由字符串）
    pub category: String,
    /// 状态
    pub status: AppStatus,
    /// UI 配置
    pub ui: UiConfig,
    /// 应用自带设置能力
    #[serde(default)]
    pub settings: Option<SettingsConfig>,
    /// 进程配置（可选）
    #[serde(default)]
    pub process: Option<ProcessConfig>,
    #[serde(default)]
    pub issue: Option<AppIssue>,
}

/// 加载编译进壳的内置 manifest 和已安装官方应用 manifest。
pub fn load_all_manifests() -> AppResult<Vec<AppManifest>> {
    let mut manifests = Vec::new();
    for content in BUILTIN_MANIFESTS {
        let manifest: AppManifest = serde_yaml::from_str(content)
            .map_err(|e| AppError::Config(format!("解析内置 manifest 失败: {}", e)))?;
        if manifest.status != AppStatus::Deprecated {
            manifests.push(manifest);
        }
    }

    crate::config::ensure_data_dirs()?;
    manifests.extend(crate::official_app_installer::list_installed_app_manifests()?);

    validate_unique_manifest_ids(&manifests)?;
    Ok(manifests)
}

fn validate_unique_manifest_ids(manifests: &[AppManifest]) -> AppResult<()> {
    let mut ids = BTreeSet::new();
    for manifest in manifests {
        if !ids.insert(&manifest.id) {
            return Err(AppError::Config(format!(
                "发现重复的应用 ID: {}",
                manifest.id
            )));
        }
    }
    Ok(())
}

/// 按 id 查找单个 manifest
pub fn find_manifest(id: &str) -> AppResult<AppManifest> {
    let manifests = load_all_manifests()?;
    manifests
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        validate_unique_manifest_ids, AppManifest, AppStatus, SettingsConfig, UiConfig, UiMode,
    };

    fn manifest(id: &str) -> AppManifest {
        AppManifest {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            version: "0.1.0".into(),
            category: "test".into(),
            status: AppStatus::Active,
            ui: UiConfig {
                mode: UiMode::None,
                url: None,
                icon: None,
            },
            settings: None,
            process: None,
            issue: None,
        }
    }

    #[test]
    fn rejects_duplicate_manifest_ids() {
        let error = validate_unique_manifest_ids(&[manifest("demo"), manifest("demo")])
            .expect_err("重复应用 ID 应被拒绝");

        assert!(error.to_string().contains("重复的应用 ID: demo"));
    }

    #[test]
    fn accepts_unique_manifest_ids() {
        validate_unique_manifest_ids(&[manifest("demo"), manifest("other")])
            .expect("不同应用 ID 应通过校验");
    }

    #[test]
    fn settings_config_supports_reset_command() {
        let settings: SettingsConfig =
            serde_yaml::from_str("reset_command: [node, scripts/reset-config.mjs]\n").unwrap();

        assert_eq!(settings.reset_command.unwrap()[0], "node");
    }
}
