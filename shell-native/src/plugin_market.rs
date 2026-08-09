use crate::config::project_root;
use crate::error::{AppError, AppResult};
use crate::manifest::SettingsConfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// 随 aIdea 发布的官方应用收录项，不承载应用版本和运行命令。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialCatalogEntry {
    pub schema_version: u32,
    pub repository: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

/// 官方应用仓库根目录 `aidea.yaml` 的声明。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialPluginDefinition {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub icon: String,
    pub revision: String,
    pub min_aidea_version: String,
    pub runtime: String,
    #[serde(default)]
    pub install: Vec<Vec<String>>,
    pub process: OfficialProcess,
    #[serde(default)]
    pub settings: Option<SettingsConfig>,
    #[serde(default)]
    pub update_notes: String,
}

/// 已由官方目录收录，并从缓存读取到的应用定义。
#[derive(Debug, Clone, Serialize)]
pub struct CachedOfficialPlugin {
    pub repository: String,
    pub definition: OfficialPluginDefinition,
}

impl CachedOfficialPlugin {
    pub fn into_plugin(self) -> OfficialPlugin {
        OfficialPlugin {
            id: self.definition.id,
            name: self.definition.name,
            description: self.definition.description,
            category: self.definition.category,
            version: self.definition.version,
            icon: self.definition.icon,
            repository: self.repository,
            revision: self.definition.revision,
            runtime: self.definition.runtime,
            install: self.definition.install,
            process: self.definition.process,
            settings: self.definition.settings,
            update_notes: self.definition.update_notes,
            update_available: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OfficialPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub icon: String,
    pub repository: String,
    pub revision: String,
    pub runtime: String,
    #[serde(default)]
    pub install: Vec<Vec<String>>,
    pub process: OfficialProcess,
    #[serde(default)]
    pub settings: Option<SettingsConfig>,
    #[serde(default)]
    pub update_notes: String,
    /// 仅用于市场 IPC 展示，不参与仓库定义和缓存。
    #[serde(default)]
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OfficialPluginListing {
    #[serde(flatten)]
    pub plugin: OfficialPlugin,
    pub installed_version: Option<String>,
}

pub fn add_install_status(plugins: Vec<OfficialPlugin>) -> AppResult<Vec<OfficialPluginListing>> {
    let installed = crate::plugin_installer::list_installed()?;
    Ok(plugins
        .into_iter()
        .map(|mut plugin| {
            let installed_version = installed
                .iter()
                .find(|record| record.id == plugin.id)
                .map(|record| record.version.clone());
            plugin.update_available = installed_version.as_deref().is_some_and(|version| {
                crate::plugin_installer::plugin_update_status(version, &plugin.version)
                    == crate::plugin_installer::PluginUpdateStatus::UpdateAvailable
            });
            OfficialPluginListing {
                plugin,
                installed_version,
            }
        })
        .collect())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OfficialProcess {
    pub command: Vec<String>,
    #[serde(default = "default_working_directory")]
    pub working_directory: String,
    pub ready_url: String,
}

fn default_working_directory() -> String {
    ".".into()
}

fn default_enabled() -> bool {
    true
}

fn validate_catalog_entry(entry: &OfficialCatalogEntry) -> AppResult<()> {
    if entry.schema_version != 1 {
        return Err(AppError::Config(
            "官方应用目录 schema_version 必须为 1".into(),
        ));
    }
    if entry.repository.trim().is_empty() || entry.repository.chars().any(char::is_control) {
        return Err(AppError::Config("官方应用目录 repository 无效".into()));
    }
    Ok(())
}

fn validate_definition(plugin: &OfficialPluginDefinition) -> AppResult<()> {
    if plugin.schema_version != 1 {
        return Err(AppError::Config(
            "官方应用定义 schema_version 必须为 1".into(),
        ));
    }
    if plugin.id.is_empty()
        || !plugin
            .id
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '-')
    {
        return Err(AppError::Config("官方应用 ID 必须是 kebab-case".into()));
    }
    for value in [
        &plugin.name,
        &plugin.description,
        &plugin.category,
        &plugin.version,
        &plugin.min_aidea_version,
        &plugin.runtime,
    ] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(AppError::Config(format!(
                "官方应用 {} 包含无效字段",
                plugin.id
            )));
        }
    }
    if !is_semantic_version(&plugin.version) || !is_semantic_version(&plugin.min_aidea_version) {
        return Err(AppError::Config(format!(
            "官方应用 {} 版本格式无效",
            plugin.id
        )));
    }
    if plugin.revision.len() != 40
        || !plugin
            .revision
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(AppError::Config(format!(
            "官方应用 {} revision 必须是完整 40 位 commit SHA",
            plugin.id
        )));
    }
    validate_process(&plugin.process, &plugin.id)?;
    for command in &plugin.install {
        validate_command(command, &plugin.id)?;
    }
    if let Some(settings) = &plugin.settings {
        if let Some(command) = &settings.reset_command {
            validate_command(command, &plugin.id)?;
        }
    }
    Ok(())
}

fn is_semantic_version(value: &str) -> bool {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if [major, minor, patch]
                .iter()
                .all(|part| !part.is_empty() && part.chars().all(|value| value.is_ascii_digit()))
    )
}

fn validate_process(process: &OfficialProcess, id: &str) -> AppResult<()> {
    validate_command(&process.command, id)?;
    if process.working_directory.starts_with('/')
        || process
            .working_directory
            .split('/')
            .any(|part| part == "..")
    {
        return Err(AppError::Config(format!("官方应用 {id} 工作目录无效")));
    }
    let url = reqwest::Url::parse(&process.ready_url)
        .map_err(|error| AppError::Config(format!("官方应用健康检查地址无效: {error}")))?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return Err(AppError::Config(
            "官方应用健康检查必须是 127.0.0.1 HTTP 地址".into(),
        ));
    }
    Ok(())
}

fn load_catalog_entries(directory: &Path) -> AppResult<Vec<(String, OfficialCatalogEntry)>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for item in std::fs::read_dir(directory)? {
        let path = item?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("yaml") {
            continue;
        }
        let cache_key = path
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config(format!("官方应用目录文件名无效: {}", path.display())))?
            .to_owned();
        let entry: OfficialCatalogEntry = serde_yaml::from_str(&std::fs::read_to_string(&path)?)
            .map_err(|error| {
                AppError::Config(format!("解析官方应用目录 {} 失败: {error}", path.display()))
            })?;
        validate_catalog_entry(&entry)?;
        entries.push((cache_key, entry));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(entries)
}

fn load_definition(path: &Path) -> AppResult<OfficialPluginDefinition> {
    let definition: OfficialPluginDefinition =
        serde_yaml::from_str(&std::fs::read_to_string(path)?).map_err(|error| {
            AppError::Config(format!("解析官方应用定义 {} 失败: {error}", path.display()))
        })?;
    validate_definition(&definition)?;
    Ok(definition)
}

fn validate_unique_definition_ids(definitions: &[CachedOfficialPlugin]) -> AppResult<()> {
    let mut ids: Vec<&str> = definitions
        .iter()
        .map(|item| item.definition.id.as_str())
        .collect();
    ids.sort_unstable();
    if ids.windows(2).any(|items| items[0] == items[1]) {
        return Err(AppError::Config("官方应用定义 ID 重复".into()));
    }
    Ok(())
}

fn market_cache_dir() -> AppResult<PathBuf> {
    Ok(crate::config::ensure_data_dirs()?
        .join("runtime")
        .join("market-cache"))
}

fn load_cached_definitions_from_dir(
    catalog_dir: &Path,
    cache_dir: &Path,
) -> AppResult<Vec<CachedOfficialPlugin>> {
    let mut definitions = Vec::new();
    for (cache_key, entry) in load_catalog_entries(catalog_dir)? {
        if !entry.enabled {
            continue;
        }
        let definition_path = cache_dir.join(cache_key).join("aidea.yaml");
        if !definition_path.exists() {
            continue;
        }
        definitions.push(CachedOfficialPlugin {
            repository: entry.repository,
            definition: load_definition(&definition_path)?,
        });
    }
    validate_unique_definition_ids(&definitions)?;
    Ok(definitions)
}

/// 只读取最近一次成功刷新后的定义，调用本函数绝不访问网络。
pub fn load_cached_official_definitions() -> AppResult<Vec<CachedOfficialPlugin>> {
    load_cached_definitions_from_dir(&bundled_market_dir_or_development()?, &market_cache_dir()?)
}

/// 从本地缓存还原官方应用运行定义，不会触发网络请求。
pub fn load_cached_official_plugins() -> AppResult<Vec<OfficialPlugin>> {
    Ok(load_cached_official_definitions()?
        .into_iter()
        .map(CachedOfficialPlugin::into_plugin)
        .collect())
}

/// 刷新官方应用定义。clone 仅用于读取仓库默认分支的 `aidea.yaml`，不会修改用户 Git 配置。
pub async fn refresh_official_definitions_from_dir(
    catalog_dir: &Path,
    cache_dir: &Path,
) -> AppResult<Vec<CachedOfficialPlugin>> {
    let mut definitions = Vec::new();
    std::fs::create_dir_all(cache_dir)?;
    for (cache_key, entry) in load_catalog_entries(catalog_dir)? {
        if !entry.enabled {
            continue;
        }
        let staging = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let output = Command::new("git")
            .args(["clone", "--depth", "1", &entry.repository])
            .arg(&staging)
            .output()
            .await
            .map_err(|error| AppError::Process(format!("执行 git clone 失败: {error}")))?;
        if !output.status.success() {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(AppError::Network(format!(
                "读取官方应用仓库 {} 失败: {}",
                entry.repository,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        let source_definition = staging.join("aidea.yaml");
        let definition = load_definition(&source_definition)?;
        let app_cache_dir = cache_dir.join(&cache_key);
        std::fs::create_dir_all(&app_cache_dir)?;
        let cache_definition = app_cache_dir.join("aidea.yaml");
        let temporary_definition =
            app_cache_dir.join(format!("aidea-{}.yaml", uuid::Uuid::new_v4()));
        std::fs::copy(&source_definition, &temporary_definition)?;
        std::fs::rename(&temporary_definition, &cache_definition)?;
        std::fs::write(
            app_cache_dir.join("metadata.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "repository": entry.repository,
                "refreshed_at": chrono::Utc::now().timestamp(),
            }))?,
        )?;
        let _ = std::fs::remove_dir_all(&staging);
        definitions.push(CachedOfficialPlugin {
            repository: entry.repository,
            definition,
        });
    }
    validate_unique_definition_ids(&definitions)?;
    Ok(definitions)
}

/// 刷新发布包中收录的官方应用定义并更新本地缓存。
pub async fn refresh_official_definitions() -> AppResult<Vec<CachedOfficialPlugin>> {
    refresh_official_definitions_from_dir(
        &bundled_market_dir_or_development()?,
        &market_cache_dir()?,
    )
    .await
}

fn bundled_market_dir_or_development() -> AppResult<PathBuf> {
    let development_dir = project_root()?.join("plugin-markets/official");
    if development_dir.exists() {
        return Ok(development_dir);
    }
    let resources = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .map(|path| path.join("Resources"))
        .ok_or_else(|| AppError::Config("无法定位官方应用市场资源目录".into()))?;
    bundled_market_dir(&resources)
}

pub fn load_official_plugins() -> AppResult<Vec<OfficialPlugin>> {
    // 官方目录只保存仓库地址；完整定义必须来自最近一次成功刷新的本地缓存。
    load_cached_official_plugins()
}

fn bundled_market_dir(resources: &Path) -> AppResult<std::path::PathBuf> {
    let direct = resources.join("plugin-markets/official");
    if direct.exists() {
        return Ok(direct);
    }
    let tauri_resource = resources.join("_up_/plugin-markets/official");
    if tauri_resource.exists() {
        return Ok(tauri_resource);
    }
    Err(AppError::Config("未找到官方插件市场资源目录".into()))
}

#[cfg(test)]
fn load_from_dir(directory: &Path) -> AppResult<Vec<OfficialPlugin>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut plugins = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("yaml") {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let plugin: OfficialPlugin = serde_yaml::from_str(&content).map_err(|error| {
            AppError::Config(format!("解析官方插件定义 {} 失败: {error}", path.display()))
        })?;
        validate(&plugin)?;
        plugins.push(plugin);
    }
    plugins.sort_by(|left, right| left.id.cmp(&right.id));
    if plugins.windows(2).any(|items| items[0].id == items[1].id) {
        return Err(AppError::Config("官方插件 ID 重复".into()));
    }
    Ok(plugins)
}

#[cfg(test)]
fn validate(plugin: &OfficialPlugin) -> AppResult<()> {
    if plugin.id.is_empty()
        || !plugin
            .id
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '-')
    {
        return Err(AppError::Config("官方插件 ID 必须是 kebab-case".into()));
    }
    for value in [
        &plugin.name,
        &plugin.description,
        &plugin.category,
        &plugin.version,
        &plugin.repository,
        &plugin.revision,
        &plugin.runtime,
    ] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(AppError::Config(format!(
                "官方插件 {} 包含无效字段",
                plugin.id
            )));
        }
    }
    validate_command(&plugin.process.command, &plugin.id)?;
    for command in &plugin.install {
        validate_command(command, &plugin.id)?;
    }
    if plugin.process.working_directory.starts_with('/')
        || plugin
            .process
            .working_directory
            .split('/')
            .any(|part| part == "..")
    {
        return Err(AppError::Config(format!(
            "官方插件 {} 工作目录无效",
            plugin.id
        )));
    }
    let url = reqwest::Url::parse(&plugin.process.ready_url)
        .map_err(|error| AppError::Config(format!("官方插件健康检查地址无效: {error}")))?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return Err(AppError::Config(
            "官方插件健康检查必须是 127.0.0.1 HTTP 地址".into(),
        ));
    }
    Ok(())
}

fn validate_command(command: &[String], id: &str) -> AppResult<()> {
    if command.is_empty()
        || command
            .iter()
            .any(|value| value.is_empty() || value.contains('\0'))
    {
        return Err(AppError::Config(format!("官方插件 {id} 命令不能为空")));
    }
    if command.first().is_some_and(|value| {
        let name = std::path::Path::new(value)
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or(value);
        name == "sh" || name == "bash"
    }) {
        return Err(AppError::Config(format!("官方插件 {id} 不允许 shell 命令")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_market_dir, load_cached_definitions_from_dir, load_from_dir, load_official_plugins,
        refresh_official_definitions_from_dir, validate_catalog_entry, validate_definition,
        CachedOfficialPlugin, OfficialCatalogEntry, OfficialPluginDefinition,
    };
    use crate::manifest::SettingsConfig;
    use std::fs;

    fn valid_definition(revision: &str) -> OfficialPluginDefinition {
        OfficialPluginDefinition {
            schema_version: 1,
            id: "demo-app".into(),
            name: "Demo".into(),
            description: "test".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Box".into(),
            revision: revision.into(),
            min_aidea_version: "0.1.0".into(),
            runtime: "system".into(),
            install: Vec::new(),
            process: super::OfficialProcess {
                command: vec!["python".into(), "-m".into(), "app".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            settings: None,
            update_notes: String::new(),
        }
    }

    #[test]
    fn 设置重置命令不能使用_shell_包装器() {
        let mut definition = valid_definition(
            "d351c25ac9a970abb1e13016dcf26128fa8e200b",
        );
        definition.settings = Some(SettingsConfig {
            enabled: true,
            reset_command: Some(vec!["sh".into(), "-c".into(), "echo bad".into()]),
        });

        assert!(validate_definition(&definition).is_err());
    }

    #[test]
    fn 收录项只允许仓库地址和启用状态() {
        let entry: OfficialCatalogEntry = serde_yaml::from_str(
            "schema_version: 1\nrepository: https://example.com/demo.git\nenabled: true\n",
        )
        .unwrap();

        assert!(validate_catalog_entry(&entry).is_ok());
    }

    #[test]
    fn 应用定义必须使用完整_sha与本地健康检查() {
        assert!(validate_definition(&valid_definition(
            "d351c25ac9a970abb1e13016dcf26128fa8e200b"
        ))
        .is_ok());
        assert!(validate_definition(&valid_definition("main")).is_err());
    }

    #[test]
    fn 缓存定义会合并收录仓库地址() {
        let cached = CachedOfficialPlugin {
            repository: "https://example.com/demo.git".into(),
            definition: valid_definition("d351c25ac9a970abb1e13016dcf26128fa8e200b"),
        };

        let plugin = cached.into_plugin();

        assert_eq!(plugin.id, "demo-app");
        assert_eq!(plugin.repository, "https://example.com/demo.git");
    }

    #[test]
    fn 缓存定义在离线时仍可读取() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let catalog_dir = directory.join("catalog");
        let cache_dir = directory.join("cache");
        fs::create_dir_all(cache_dir.join("demo")).unwrap();
        fs::create_dir_all(&catalog_dir).unwrap();
        fs::write(
            catalog_dir.join("demo.yaml"),
            "schema_version: 1\nrepository: https://example.com/demo.git\nenabled: true\n",
        )
        .unwrap();
        fs::write(
            cache_dir.join("demo/aidea.yaml"),
            serde_yaml::to_string(&valid_definition(
                "d351c25ac9a970abb1e13016dcf26128fa8e200b",
            ))
            .unwrap(),
        )
        .unwrap();

        let definitions = load_cached_definitions_from_dir(&catalog_dir, &cache_dir).unwrap();

        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].definition.id, "demo-app");
        assert_eq!(definitions[0].repository, "https://example.com/demo.git");
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn 刷新时从应用仓库读取定义并写入缓存() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let repository = directory.join("repository");
        let catalog_dir = directory.join("catalog");
        let cache_dir = directory.join("cache");
        fs::create_dir_all(&repository).unwrap();
        fs::create_dir_all(&catalog_dir).unwrap();
        fs::write(
            repository.join("aidea.yaml"),
            serde_yaml::to_string(&valid_definition(
                "d351c25ac9a970abb1e13016dcf26128fa8e200b",
            ))
            .unwrap(),
        )
        .unwrap();
        for args in [
            vec!["init"],
            vec!["add", "aidea.yaml"],
            vec![
                "-c",
                "user.name=aIdea Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "definition",
            ],
        ] {
            let status = std::process::Command::new("git")
                .args(args)
                .current_dir(&repository)
                .status()
                .unwrap();
            assert!(status.success());
        }
        fs::write(
            catalog_dir.join("demo.yaml"),
            format!(
                "schema_version: 1\nrepository: {}\nenabled: true\n",
                repository.display()
            ),
        )
        .unwrap();

        let refreshed = refresh_official_definitions_from_dir(&catalog_dir, &cache_dir)
            .await
            .unwrap();

        assert_eq!(refreshed.len(), 1);
        assert_eq!(refreshed[0].definition.id, "demo-app");
        assert!(cache_dir.join("demo/aidea.yaml").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 拒绝远程健康检查和_shell命令() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("bad.yaml"),
            "id: bad\nname: Bad\ndescription: test\ncategory: test\nversion: 1\nicon: Box\nrepository: https://example.com/bad.git\nrevision: v1\nruntime: system\nprocess:\n  command: [sh, -c, echo bad]\n  ready_url: http://example.com/health\n",
        ).unwrap();
        assert!(load_from_dir(&directory).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 加载合法官方插件定义() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("demo.yaml"),
            "id: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 1\nicon: Box\nrepository: https://example.com/demo.git\nrevision: v1\nruntime: system\nprocess:\n  command: [python, -m, app]\n  ready_url: http://127.0.0.1:43120/health\n",
        ).unwrap();
        assert_eq!(load_from_dir(&directory).unwrap()[0].id, "demo-app");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 官方市场收录文件不会当作完整定义解析() {
        assert!(load_official_plugins().is_ok());
    }

    #[test]
    fn dmg资源目录使用_tauri_up_路径() {
        let resources =
            std::env::temp_dir().join(format!("aidea-resources-{}", uuid::Uuid::new_v4()));
        let market = resources.join("_up_/plugin-markets/official");
        fs::create_dir_all(&market).unwrap();
        assert_eq!(bundled_market_dir(&resources).unwrap(), market);
        fs::remove_dir_all(resources).unwrap();
    }
}
