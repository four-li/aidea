// 壳全局设置加载模块
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[cfg(test)]
mod ai_history_tests {
    use super::{AiConfigHistory, AiConfigHistoryItem};

    #[test]
    fn history_replaces_matching_id_and_returns_evicted_ids() {
        let mut history = AiConfigHistory::default();
        for index in 0..20 {
            assert!(history
                .insert(AiConfigHistoryItem {
                    id: index.to_string(),
                    base_url: format!("https://api-{}.example.com", index),
                    model: "test".to_string(),
                    key_hint: "...test".to_string(),
                    saved_at: index,
                })
                .is_empty());
        }

        let evicted = history.insert(AiConfigHistoryItem {
            id: "20".to_string(),
            base_url: "https://api-20.example.com".to_string(),
            model: "test".to_string(),
            key_hint: "...test".to_string(),
            saved_at: 20,
        });

        assert_eq!(evicted, vec!["0"]);
        assert_eq!(history.items.len(), 20);
        assert_eq!(history.items[0].id, "20");

        let evicted = history.insert(AiConfigHistoryItem {
            id: "20".to_string(),
            base_url: "https://api-20.example.com".to_string(),
            model: "updated".to_string(),
            key_hint: "...test".to_string(),
            saved_at: 21,
        });
        assert_eq!(evicted, vec!["20"]);
        assert_eq!(history.items.len(), 20);
        assert_eq!(history.items[0].model, "updated");
    }

    #[test]
    fn history_uses_id_as_identity() {
        let mut history = AiConfigHistory::default();
        history.insert(AiConfigHistoryItem {
            id: "key-one".to_string(),
            base_url: "https://api.example.com".to_string(),
            model: "".to_string(),
            key_hint: "...-one".to_string(),
            saved_at: 1,
        });
        history.insert(AiConfigHistoryItem {
            id: "key-two".to_string(),
            base_url: "https://api.example.com".to_string(),
            model: "gpt-test".to_string(),
            key_hint: "...-two".to_string(),
            saved_at: 2,
        });

        assert_eq!(history.items.len(), 2);
        assert_eq!(history.items[0].model, "gpt-test");
    }
}

const AI_HISTORY_LIMIT: usize = 20;

/// AI 历史配置仅存元数据，API Key 保存在 macOS 钥匙串。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfigHistoryItem {
    pub id: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub key_hint: String,
    pub saved_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiConfigHistory {
    #[serde(default)]
    pub items: Vec<AiConfigHistoryItem>,
}

impl AiConfigHistory {
    /// 返回被替换或超出历史上限的钥匙串 ID，调用方负责同步删除。
    pub fn insert(&mut self, item: AiConfigHistoryItem) -> Vec<String> {
        let mut removed: Vec<String> = self
            .items
            .iter()
            .filter(|existing| existing.id == item.id)
            .map(|existing| existing.id.clone())
            .collect();
        self.items.retain(|existing| existing.id != item.id);
        self.items.insert(0, item);
        if self.items.len() > AI_HISTORY_LIMIT {
            removed.extend(
                self.items
                    .drain(AI_HISTORY_LIMIT..)
                    .map(|existing| existing.id),
            );
        }
        removed
    }
}

/// 单个子应用的用户覆盖配置
/// 只存放用户实际修改过的字段，其余字段保持 manifest 原值
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfig {
    /// 主题：强制 auto（跟随系统）
    #[serde(default = "default_theme")]
    pub theme: String,

    /// runtime 目录，相对项目根
    #[serde(default = "default_data_dir")]
    pub data_dir: String,

    /// 日志目录，相对项目根
    #[serde(default = "default_log_dir")]
    pub log_dir: String,

    /// 用户对子应用的覆盖配置，key = app id
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub overrides: BTreeMap<String, AppOverride>,

    /// AI 调试器历史配置，不含 API Key。
    #[serde(default)]
    pub ai_history: AiConfigHistory,
}

fn default_theme() -> String {
    "auto".to_string()
}
fn default_data_dir() -> String {
    ".runtime".to_string()
}
fn default_log_dir() -> String {
    ".runtime/logs".to_string()
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            data_dir: default_data_dir(),
            log_dir: default_log_dir(),
            overrides: BTreeMap::new(),
            ai_history: AiConfigHistory::default(),
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

/// 创建 aIdea 的用户数据目录。
pub fn ensure_data_dirs() -> AppResult<PathBuf> {
    let root = data_root()?;
    for path in [
        root.join("apps/local"),
        root.join("apps/installed"),
        root.join("runtime/processes"),
        root.join("runtime/state"),
        root.join("backups"),
    ] {
        fs::create_dir_all(path)?;
    }
    Ok(root)
}

/// 从旧源码目录迁移一次用户配置和本地 manifest。
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
        fs::copy(&legacy_config, &config_path)?;
    }

    let legacy_apps = legacy_root.join("apps");
    let local_apps = root.join("apps/local");
    if legacy_apps.exists() {
        for entry in fs::read_dir(legacy_apps)? {
            let entry = entry?;
            let source = entry.path();
            if source.extension().and_then(|value| value.to_str()) != Some("yaml") {
                continue;
            }
            let Some(name) = source.file_name() else {
                continue;
            };
            let target = local_apps.join(name);
            if !target.exists() {
                fs::copy(source, target)?;
            }
        }
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
