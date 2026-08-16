use crate::config::project_root;
#[cfg(not(test))]
use crate::diagnostics::{self, LogChannel, LogOwner};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 随 aIdea 发布的官方应用收录项，不承载应用版本和运行命令。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialCatalogEntry {
    pub schema_version: u32,
    pub repository: String,
    pub enabled: bool,
}

/// 官方市场唯一的远端索引文件，避免依赖平台目录 API。
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialCatalogIndex {
    pub schema_version: u32,
    pub apps: BTreeMap<String, OfficialCatalogEntry>,
}

/// 开搞内置的官方市场仓库地址，用于获取可变的应用收录目录。
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct OfficialMarketSource {
    schema_version: u32,
    repository: String,
}

/// 官方应用仓库根目录 `aidea.yaml` 的声明。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialAppDefinition {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub icon: String,
    pub artifact: OfficialArtifact,
    pub process: OfficialProcess,
}

/// 已由官方目录收录，并从缓存读取到的应用定义。
#[derive(Debug, Clone, Serialize)]
pub struct CachedOfficialApp {
    pub repository: String,
    pub definition: OfficialAppDefinition,
}

#[derive(Debug, Clone)]
struct UnavailableOfficialApp {
    id: String,
    repository: String,
}

impl CachedOfficialApp {
    pub fn into_app(self) -> OfficialApp {
        self.definition.into_app(self.repository)
    }
}

impl OfficialAppDefinition {
    pub fn into_app(self, repository: String) -> OfficialApp {
        OfficialApp {
            id: self.id,
            name: self.name,
            description: self.description,
            category: self.category,
            version: self.version,
            icon: self.icon,
            repository,
            artifact: self.artifact,
            process: self.process,
            available: true,
            update_available: false,
        }
    }
}

impl OfficialApp {
    fn unavailable(id: String, repository: String) -> Self {
        Self {
            name: id.clone(),
            description: "当前网络无法访问应用仓库，暂不可安装".into(),
            category: "官方应用".into(),
            version: "-".into(),
            icon: "Package".into(),
            artifact: OfficialArtifact {
                url: String::new(),
                sha256: String::new(),
            },
            process: OfficialProcess {
                command: Vec::new(),
                working_directory: ".".into(),
                ready_url: String::new(),
            },
            id,
            repository,
            available: false,
            update_available: false,
        }
    }

    pub fn manifest_snapshot(&self) -> OfficialAppDefinition {
        OfficialAppDefinition {
            schema_version: 1,
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            category: self.category.clone(),
            version: self.version.clone(),
            icon: self.icon.clone(),
            artifact: self.artifact.clone(),
            process: self.process.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OfficialApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub icon: String,
    pub repository: String,
    pub artifact: OfficialArtifact,
    pub process: OfficialProcess,
    #[serde(default = "default_available")]
    pub available: bool,
    /// 仅用于市场 IPC 展示，不参与仓库定义和缓存。
    #[serde(default)]
    pub update_available: bool,
}

fn default_available() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialArtifact {
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OfficialAppListing {
    #[serde(flatten)]
    pub app: OfficialApp,
    pub installed_version: Option<String>,
}

pub fn add_install_status(apps: Vec<OfficialApp>) -> AppResult<Vec<OfficialAppListing>> {
    let installed = crate::official_app_installer::list_installed()?;
    Ok(apps
        .into_iter()
        .map(|mut app| {
            let installed_version = installed
                .iter()
                .find(|record| record.id == app.id)
                .map(|record| record.version.clone());
            app.update_available = installed_version.as_deref().is_some_and(|version| {
                crate::official_app_installer::app_update_status(version, &app.version)
                    == crate::official_app_installer::AppUpdateStatus::UpdateAvailable
            });
            OfficialAppListing {
                app,
                installed_version,
            }
        })
        .collect())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OfficialProcess {
    pub command: Vec<String>,
    pub working_directory: String,
    pub ready_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RepositoryProvider {
    Gitee,
    GitHub,
    GitLab,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RepositoryLocation {
    provider: RepositoryProvider,
    origin: String,
    project: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtifactLocation {
    provider: RepositoryProvider,
    origin: String,
    project: String,
    tag: String,
}

fn validate_catalog_entry(entry: &OfficialCatalogEntry) -> AppResult<()> {
    if entry.schema_version != 1 {
        return Err(AppError::Config(
            "官方应用目录 schema_version 必须为 1".into(),
        ));
    }
    parse_repository(&entry.repository)?;
    Ok(())
}

fn validate_catalog_index(index: &OfficialCatalogIndex) -> AppResult<()> {
    if index.schema_version != 1 {
        return Err(AppError::Config(
            "官方市场索引 schema_version 必须为 1".into(),
        ));
    }
    for (id, entry) in &index.apps {
        if !is_kebab_case(id) {
            return Err(AppError::Config(format!(
                "官方市场索引应用 ID 必须是 kebab-case: {id}"
            )));
        }
        validate_catalog_entry(entry)?;
    }
    Ok(())
}

fn load_market_source(path: &Path) -> AppResult<OfficialMarketSource> {
    let source: OfficialMarketSource = serde_yaml::from_str(&std::fs::read_to_string(path)?)
        .map_err(|error| {
            AppError::Config(format!("解析官方市场来源 {} 失败: {error}", path.display()))
        })?;
    if source.schema_version != 1 {
        return Err(AppError::Config("官方市场来源配置无效".into()));
    }
    parse_repository(&source.repository)?;
    Ok(source)
}

pub(crate) fn validate_definition(app: &OfficialAppDefinition) -> AppResult<()> {
    if app.schema_version != 1 {
        return Err(AppError::Config(
            "官方应用定义 schema_version 必须为 1".into(),
        ));
    }
    if !is_kebab_case(&app.id) {
        return Err(AppError::Config("官方应用 ID 必须是 kebab-case".into()));
    }
    for value in [&app.name, &app.description, &app.category, &app.version] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(AppError::Config(format!(
                "官方应用 {} 包含无效字段",
                app.id
            )));
        }
    }
    if !is_semantic_version(&app.version) {
        return Err(AppError::Config(format!(
            "官方应用 {} 版本格式无效",
            app.id
        )));
    }
    validate_binary_artifact(&app.artifact, &app.id, &app.version)?;
    validate_process(&app.process, &app.id)?;
    Ok(())
}

fn validate_binary_artifact(artifact: &OfficialArtifact, id: &str, version: &str) -> AppResult<()> {
    let location = parse_artifact(&artifact.url)?;
    if location.tag != format!("v{version}") {
        return Err(AppError::Config(format!(
            "官方应用 {id} binary Release tag 必须是 v{version}"
        )));
    }
    if artifact.sha256.len() != 64
        || !artifact
            .sha256
            .chars()
            .all(|value| value.is_ascii_digit() || ('a'..='f').contains(&value))
    {
        return Err(AppError::Config(format!(
            "官方应用 {id} binary sha256 必须是 64 位十六进制字符串"
        )));
    }
    Ok(())
}

fn validate_artifact_repository(
    repository: &str,
    definition: &OfficialAppDefinition,
) -> AppResult<()> {
    let repository = parse_repository(repository)?;
    let artifact = parse_artifact(&definition.artifact.url)?;
    if repository.provider != artifact.provider
        || repository.origin != artifact.origin
        || repository.project != artifact.project
    {
        return Err(AppError::Config(format!(
            "官方应用 {} 的 binary 附件必须来自收录的同一仓库",
            definition.id
        )));
    }
    Ok(())
}

fn validate_catalog_definition_id(
    cache_key: &str,
    definition: &OfficialAppDefinition,
) -> AppResult<()> {
    if cache_key != definition.id {
        return Err(AppError::Config(format!(
            "官方市场收录文件名 {cache_key} 与应用 ID {} 不一致",
            definition.id
        )));
    }
    Ok(())
}

fn parse_repository(value: &str) -> AppResult<RepositoryLocation> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| AppError::Config(format!("官方应用仓库地址无效: {error}")))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Config(
            "官方应用仓库必须是无凭据的 HTTP 或 HTTPS 地址".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Config("官方应用仓库地址缺少域名".into()))?;
    let project = url.path().trim_matches('/').trim_end_matches(".git");
    let segments = project
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let valid_segments = match host {
        "gitee.com" | "github.com" => segments.len() == 2,
        _ => segments.len() >= 2,
    };
    if !valid_segments
        || segments
            .iter()
            .any(|segment| *segment == "." || *segment == "..")
    {
        return Err(AppError::Config("官方应用仓库路径无效".into()));
    }
    let provider = match host {
        "gitee.com" => RepositoryProvider::Gitee,
        "github.com" => RepositoryProvider::GitHub,
        _ => RepositoryProvider::GitLab,
    };
    Ok(RepositoryLocation {
        provider,
        origin: url.origin().ascii_serialization(),
        project: segments.join("/"),
    })
}

fn parse_artifact(value: &str) -> AppResult<ArtifactLocation> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| AppError::Config(format!("官方应用 binary 下载地址无效: {error}")))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Config(
            "官方应用 binary 必须是 HTTP 或 HTTPS Release tar.gz 地址".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Config("官方应用 binary 下载地址缺少域名".into()))?;
    let path = url.path().trim_matches('/');
    let (provider, project, tag) = match host {
        "gitee.com" | "github.com" => {
            let parts = path.split('/').collect::<Vec<_>>();
            if parts.len() < 6 || parts[2] != "releases" || parts[3] != "download" {
                return Err(AppError::Config(
                    "官方应用 binary 必须使用 Gitee 或 GitHub Release 附件地址".into(),
                ));
            }
            (
                if host == "gitee.com" {
                    RepositoryProvider::Gitee
                } else {
                    RepositoryProvider::GitHub
                },
                format!("{}/{}", parts[0], parts[1]),
                parts[4].to_owned(),
            )
        }
        _ => {
            let Some((project, release_path)) = path.split_once("/-/releases/") else {
                return Err(AppError::Config(
                    "官方应用 binary 必须使用 GitLab Release 附件地址".into(),
                ));
            };
            let parts = release_path.split('/').collect::<Vec<_>>();
            if project.split('/').filter(|part| !part.is_empty()).count() < 2
                || parts.len() < 3
                || parts[1] != "downloads"
            {
                return Err(AppError::Config(
                    "官方应用 binary 必须使用 GitLab Release 附件地址".into(),
                ));
            }
            (
                RepositoryProvider::GitLab,
                project.to_owned(),
                parts[0].to_owned(),
            )
        }
    };
    if !path.ends_with(".tar.gz") {
        return Err(AppError::Config(
            "官方应用 binary 必须是 Release .tar.gz 附件".into(),
        ));
    }
    Ok(ArtifactLocation {
        provider,
        origin: url.origin().ascii_serialization(),
        project,
        tag,
    })
}

pub(crate) fn is_kebab_case(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn is_semantic_version(value: &str) -> bool {
    let mut parts = value.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if [major, minor, patch]
                .iter()
                .all(|part| part.len() == 1 && part.chars().all(|value| value.is_ascii_digit()))
    )
}

fn validate_process(process: &OfficialProcess, id: &str) -> AppResult<()> {
    validate_command(&process.command, id)?;
    if process.working_directory.trim().is_empty()
        || process.working_directory.starts_with('/')
        || process
            .working_directory
            .split('/')
            .any(|part| part == "..")
    {
        return Err(AppError::Config(format!("官方应用 {id} 工作目录无效")));
    }
    validate_ready_url(&process.ready_url, id)?;
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

fn load_definition(path: &Path) -> AppResult<OfficialAppDefinition> {
    let definition: OfficialAppDefinition = serde_yaml::from_str(&std::fs::read_to_string(path)?)
        .map_err(|error| {
        AppError::Config(format!("解析官方应用定义 {} 失败: {error}", path.display()))
    })?;
    validate_definition(&definition)?;
    Ok(definition)
}

fn validate_unique_definition_ids(definitions: &[CachedOfficialApp]) -> AppResult<()> {
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

fn market_catalog_cache_dir() -> AppResult<PathBuf> {
    Ok(market_cache_dir()?.join("catalog"))
}

fn repository_raw_url(repository: &RepositoryLocation, path: &str) -> String {
    match repository.provider {
        RepositoryProvider::Gitee => {
            format!("https://gitee.com/{}/raw/HEAD/{path}", repository.project)
        }
        RepositoryProvider::GitHub => format!(
            "https://raw.githubusercontent.com/{}/HEAD/{path}",
            repository.project
        ),
        RepositoryProvider::GitLab => {
            format!(
                "{}/{}/-/raw/HEAD/{path}",
                repository.origin, repository.project
            )
        }
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("aIdea")
        .build()
        .map_err(|error| AppError::Network(format!("初始化市场请求失败: {error}")))
}

fn record_market_warning(message: &str) {
    #[cfg(not(test))]
    let _ = diagnostics::append_level(
        &LogOwner::Aidea,
        LogChannel::Platform,
        diagnostics::LogLevel::Warn,
        "official-market",
        message,
    );
    #[cfg(test)]
    let _ = message;
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> AppResult<String> {
    let response = client.get(url).send().await.map_err(|error| {
        let message = format!("读取官方市场失败: {error}");
        record_market_warning(&message);
        AppError::Network(message)
    })?;
    if let Err(error) = response.error_for_status_ref() {
        let message = format!("读取官方市场失败: {error}");
        record_market_warning(&message);
        return Err(AppError::Network(message));
    }
    response.text().await.map_err(|error| {
        let message = format!("读取官方市场失败: {error}");
        record_market_warning(&message);
        AppError::Network(message)
    })
}

async fn fetch_manifest(client: &reqwest::Client, repository: &str) -> AppResult<String> {
    let repository = parse_repository(repository)?;
    fetch_text(client, &repository_raw_url(&repository, "aidea.yaml")).await
}

async fn fetch_market_catalog(repository: &str) -> AppResult<PathBuf> {
    let repository = parse_repository(repository)?;
    let client = http_client()?;
    let index: OfficialCatalogIndex = serde_yaml::from_str(
        &fetch_text(&client, &repository_raw_url(&repository, "market.yaml")).await?,
    )
    .map_err(|error| AppError::Network(format!("解析官方市场索引失败: {error}")))?;
    validate_catalog_index(&index)
        .map_err(|error| AppError::Network(format!("校验官方市场索引失败: {error}")))?;
    let staging = std::env::temp_dir().join(format!("aidea-catalog-{}", uuid::Uuid::new_v4()));
    let official = staging.join("official");
    std::fs::create_dir_all(&official)?;
    let result = async {
        for (id, entry) in index.apps {
            std::fs::write(
                official.join(format!("{id}.yaml")),
                serde_yaml::to_string(&entry).map_err(|error| {
                    AppError::Config(format!("序列化官方市场收录项失败: {error}"))
                })?,
            )?;
        }
        load_catalog_entries(&official)?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(staging)
}

fn cache_market_catalog(source: &Path, destination: &Path) -> AppResult<()> {
    load_catalog_entries(source)?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Config("官方市场缓存目录无效".into()))?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!("catalog-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)?;
    for entry in std::fs::read_dir(source)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) == Some("yaml") {
            std::fs::copy(&path, staging.join(path.file_name().unwrap()))?;
        }
    }

    replace_directory(&staging, destination)
}

fn replace_directory(staging: &Path, destination: &Path) -> AppResult<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Config("官方市场缓存目录无效".into()))?;

    // 新目录准备完毕后才替换，网络或解析失败时继续使用上一次成功缓存。
    let backup = parent.join(format!("catalog-backup-{}", uuid::Uuid::new_v4()));
    if destination.exists() {
        std::fs::rename(destination, &backup)?;
    }
    if let Err(error) = std::fs::rename(staging, destination) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, destination);
        }
        let _ = std::fs::remove_dir_all(staging);
        return Err(error.into());
    }
    if backup.exists() {
        std::fs::remove_dir_all(backup)?;
    }
    Ok(())
}

fn load_cached_definitions_from_dir(
    catalog_dir: &Path,
    cache_dir: &Path,
) -> AppResult<Vec<CachedOfficialApp>> {
    let mut definitions = Vec::new();
    for (cache_key, entry) in load_catalog_entries(catalog_dir)? {
        if !entry.enabled {
            continue;
        }
        let definition_path = cache_dir.join(&cache_key).join("aidea.yaml");
        if !definition_path.exists() {
            continue;
        }
        let definition = load_definition(&definition_path)?;
        validate_catalog_definition_id(&cache_key, &definition)?;
        validate_artifact_repository(&entry.repository, &definition)?;
        definitions.push(CachedOfficialApp {
            repository: entry.repository,
            definition,
        });
    }
    validate_unique_definition_ids(&definitions)?;
    Ok(definitions)
}

/// 只读取最近一次成功刷新后的定义，调用本函数绝不访问网络。
pub fn load_cached_official_definitions() -> AppResult<Vec<CachedOfficialApp>> {
    load_cached_definitions_from_dir(&market_catalog_cache_dir()?, &market_cache_dir()?)
}

/// 从本地缓存还原官方应用运行定义，不会触发网络请求。
pub fn load_cached_official_apps() -> AppResult<Vec<OfficialApp>> {
    Ok(load_cached_official_definitions()?
        .into_iter()
        .map(CachedOfficialApp::into_app)
        .collect())
}

/// 通过 HTTPS Raw 地址读取每个已收录仓库默认分支的 `aidea.yaml`。
async fn refresh_official_definitions_from_dir(
    catalog_dir: &Path,
    cache_dir: &Path,
) -> AppResult<(Vec<CachedOfficialApp>, Vec<UnavailableOfficialApp>)> {
    let mut definitions = Vec::new();
    let mut unavailable = Vec::new();
    std::fs::create_dir_all(cache_dir)?;
    let client = http_client()?;
    for (cache_key, entry) in load_catalog_entries(catalog_dir)? {
        if !entry.enabled {
            continue;
        }
        let content = match fetch_manifest(&client, &entry.repository).await {
            Ok(content) => content,
            Err(error) => {
                record_market_warning(&format!("应用 {cache_key} manifest 不可用: {error}"));
                unavailable.push(UnavailableOfficialApp {
                    id: cache_key,
                    repository: entry.repository,
                });
                continue;
            }
        };
        let definition: OfficialAppDefinition = match serde_yaml::from_str(&content) {
            Ok(definition) => definition,
            Err(error) => {
                record_market_warning(&format!("应用 {cache_key} manifest 解析失败: {error}"));
                unavailable.push(UnavailableOfficialApp {
                    id: cache_key,
                    repository: entry.repository,
                });
                continue;
            }
        };
        let validation = validate_definition(&definition)
            .and_then(|_| validate_catalog_definition_id(&cache_key, &definition))
            .and_then(|_| validate_artifact_repository(&entry.repository, &definition));
        if let Err(error) = validation {
            record_market_warning(&format!("应用 {cache_key} manifest 校验失败: {error}"));
            unavailable.push(UnavailableOfficialApp {
                id: cache_key,
                repository: entry.repository,
            });
            continue;
        }
        let app_cache_dir = cache_dir.join(&cache_key);
        std::fs::create_dir_all(&app_cache_dir)?;
        let cache_definition = app_cache_dir.join("aidea.yaml");
        let temporary_definition =
            app_cache_dir.join(format!("aidea-{}.yaml", uuid::Uuid::new_v4()));
        std::fs::write(&temporary_definition, content)?;
        std::fs::rename(&temporary_definition, &cache_definition)?;
        std::fs::write(
            app_cache_dir.join("metadata.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "repository": entry.repository,
                "refreshed_at": chrono::Utc::now().timestamp(),
            }))?,
        )?;
        definitions.push(CachedOfficialApp {
            repository: entry.repository,
            definition,
        });
    }
    validate_unique_definition_ids(&definitions)?;
    Ok((definitions, unavailable))
}

/// 刷新远程市场目录及其收录的官方应用定义，并更新本地缓存。
pub async fn refresh_official_definitions() -> AppResult<Vec<OfficialApp>> {
    let source = load_market_source(&market_source_path_or_development()?)?;
    let catalog_staging = fetch_market_catalog(&source.repository).await?;
    let cache_dir = market_cache_dir()?;
    let cache_staging = cache_dir
        .parent()
        .ok_or_else(|| AppError::Config("官方市场缓存目录无效".into()))?
        .join(format!("market-cache-{}", uuid::Uuid::new_v4()));
    let result = match refresh_official_definitions_from_dir(
        &catalog_staging.join("official"),
        &cache_staging,
    )
    .await
    {
        Ok((definitions, unavailable)) => match cache_market_catalog(
            &catalog_staging.join("official"),
            &cache_staging.join("catalog"),
        ) {
            Ok(()) => replace_directory(&cache_staging, &cache_dir).map(|_| {
                let mut apps: Vec<OfficialApp> = definitions
                    .into_iter()
                    .map(CachedOfficialApp::into_app)
                    .collect();
                apps.extend(
                    unavailable
                        .into_iter()
                        .map(|app| OfficialApp::unavailable(app.id, app.repository)),
                );
                apps
            }),
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_dir_all(catalog_staging);
    let _ = std::fs::remove_dir_all(cache_staging);
    result
}

fn market_source_path_or_development() -> AppResult<PathBuf> {
    let resources = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .map(|path| path.join("Resources"))
        .ok_or_else(|| AppError::Config("无法定位官方市场资源目录".into()))?;
    market_source_path_for_resources(&resources, cfg!(debug_assertions))
}

fn market_source_path_for_resources(
    resources: &Path,
    allow_development_path: bool,
) -> AppResult<PathBuf> {
    if allow_development_path {
        // 只在调试构建里回看源码树，打包版必须直接读应用资源，避免触发桌面权限。
        let development_path = project_root()?.join("market-source.yaml");
        if development_path.exists() {
            return Ok(development_path);
        }
    }
    bundled_market_source(resources)
}

fn bundled_market_source(resources: &Path) -> AppResult<PathBuf> {
    let direct = resources.join("market-source.yaml");
    if direct.exists() {
        return Ok(direct);
    }
    let tauri_resource = resources.join("_up_/market-source.yaml");
    if tauri_resource.exists() {
        return Ok(tauri_resource);
    }
    Err(AppError::Config("未找到官方市场来源配置".into()))
}

#[cfg(test)]
fn load_from_dir(directory: &Path) -> AppResult<Vec<OfficialApp>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut apps = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("yaml") {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let app: OfficialApp = serde_yaml::from_str(&content).map_err(|error| {
            AppError::Config(format!("解析官方应用定义 {} 失败: {error}", path.display()))
        })?;
        validate(&app)?;
        apps.push(app);
    }
    apps.sort_by(|left, right| left.id.cmp(&right.id));
    if apps.windows(2).any(|items| items[0].id == items[1].id) {
        return Err(AppError::Config("官方应用 ID 重复".into()));
    }
    Ok(apps)
}

#[cfg(test)]
fn validate(app: &OfficialApp) -> AppResult<()> {
    if !is_kebab_case(&app.id) {
        return Err(AppError::Config("官方应用 ID 必须是 kebab-case".into()));
    }
    for value in [
        &app.name,
        &app.description,
        &app.category,
        &app.version,
        &app.repository,
    ] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(AppError::Config(format!(
                "官方应用 {} 包含无效字段",
                app.id
            )));
        }
    }
    validate_command(&app.process.command, &app.id)?;
    validate_binary_artifact(&app.artifact, &app.id, &app.version)?;
    if app.process.working_directory.trim().is_empty()
        || app.process.working_directory.starts_with('/')
        || app
            .process
            .working_directory
            .split('/')
            .any(|part| part == "..")
    {
        return Err(AppError::Config(format!(
            "官方应用 {} 工作目录无效",
            app.id
        )));
    }
    validate_ready_url(&app.process.ready_url, &app.id)?;
    Ok(())
}

fn validate_ready_url(ready_url: &str, id: &str) -> AppResult<()> {
    let url = reqwest::Url::parse(ready_url)
        .map_err(|error| AppError::Config(format!("官方应用 {id} 健康检查地址无效: {error}")))?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/health"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Config(format!(
            "官方应用 {id} 健康检查必须是无查询参数的 127.0.0.1 HTTP /health 地址"
        )));
    }
    Ok(())
}

fn validate_command(command: &[String], id: &str) -> AppResult<()> {
    if command.is_empty()
        || command.iter().any(|value| {
            value.is_empty() || value.contains('\0') || value.chars().any(char::is_whitespace)
        })
    {
        return Err(AppError::Config(format!("官方应用 {id} 命令不能为空")));
    }
    let program = &command[0];
    if program.contains('/') || program.contains('\\') || program == "." || program == ".." {
        return Err(AppError::Config(format!(
            "官方应用 {id} 启动程序必须是包根目录的裸文件名"
        )));
    }
    if matches!(program.as_str(), "sh" | "bash" | "zsh") {
        return Err(AppError::Config(format!("官方应用 {id} 不允许 shell 命令")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_market_source, load_cached_definitions_from_dir, load_from_dir,
        validate_catalog_entry, validate_definition, CachedOfficialApp, OfficialAppDefinition,
        OfficialCatalogEntry, OfficialCatalogIndex,
    };
    use std::fs;

    fn valid_definition() -> OfficialAppDefinition {
        OfficialAppDefinition {
            schema_version: 1,
            id: "demo-app".into(),
            name: "Demo".into(),
            description: "test".into(),
            category: "test".into(),
            version: "0.1.0".into(),
            icon: "Box".into(),
            artifact: super::OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: super::OfficialProcess {
                command: vec!["demo".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
        }
    }

    #[test]
    fn 官方应用定义只接受最小_binary_manifest() {
        let definition = "schema_version: 1\nid: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Box\nartifact:\n  url: https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz\n  sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nprocess:\n  command: [demo]\n  ready_url: http://127.0.0.1:43120/health\n";

        assert!(serde_yaml::from_str::<OfficialAppDefinition>(definition).is_err());
    }

    #[test]
    fn 官方应用定义不允许声明设置重置命令() {
        let definition = "schema_version: 1\nid: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Box\nartifact:\n  url: https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz\n  sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nprocess:\n  command: [demo]\n  ready_url: http://127.0.0.1:43120/health\nsettings:\n  reset_command: [builtin, dev-tools]\n";

        assert!(serde_yaml::from_str::<OfficialAppDefinition>(definition).is_err());
    }

    #[test]
    fn 收录项只允许仓库地址和启用状态() {
        let entry: OfficialCatalogEntry = serde_yaml::from_str(
            "schema_version: 1\nrepository: https://gitee.com/aidea-org/demo.git\nenabled: true\n",
        )
        .unwrap();

        assert!(validate_catalog_entry(&entry).is_ok());
        assert!(serde_yaml::from_str::<OfficialCatalogEntry>(
            "schema_version: 1\nrepository: https://gitee.com/aidea-org/demo.git\n"
        )
        .is_err());
    }

    #[test]
    fn 市场源配置必须声明仓库地址() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let source_path = directory.join("market-source.yaml");
        fs::write(
            &source_path,
            "schema_version: 1\nrepository: https://gitee.com/aidea-org/aidea-market.git\n",
        )
        .unwrap();

        assert_eq!(
            super::load_market_source(&source_path).unwrap().repository,
            "https://gitee.com/aidea-org/aidea-market.git"
        );
        fs::write(&source_path, "schema_version: 1\nrepository: \n").unwrap();
        assert!(super::load_market_source(&source_path).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 应用定义必须使用有效产物与本地健康检查() {
        assert!(validate_definition(&valid_definition()).is_ok());
        let mut definition = valid_definition();
        definition.version = "0.1.10".into();
        assert!(validate_definition(&definition).is_err());
        definition.version = "0.1.0".into();
        definition.process.ready_url = "http://localhost:43120/health".into();
        assert!(validate_definition(&definition).is_err());
        definition.process.ready_url = "http://127.0.0.1:43120/health".into();
        definition.id = "-demo".into();
        assert!(validate_definition(&definition).is_err());
        definition.id = "demo".into();
        definition.process.working_directory.clear();
        assert!(validate_definition(&definition).is_err());
    }

    #[test]
    fn binary定义可以声明单个_arm64_预编译产物和裸命令() {
        let definition: OfficialAppDefinition = serde_yaml::from_str(
            "schema_version: 1\nid: mail-center\nname: 邮件中心\ndescription: test\ncategory: productivity\nversion: 0.1.6\nicon: Mail\nartifact:\n  url: https://gitee.com/aidea-org/mail-center/releases/download/v0.1.6/mail-center-0.1.6-darwin-arm64.tar.gz\n  sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nprocess:\n  command: [mail-center]\n  working_directory: .\n  ready_url: http://127.0.0.1:43130/health\n",
        )
        .unwrap();

        assert!(validate_definition(&definition).is_ok());
    }

    #[test]
    fn 旧字段会被拒绝() {
        let definition = "schema_version: 1\nid: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Box\nrevision: obsolete\nartifact:\n  url: https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz\n  sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nprocess:\n  command: [demo]\n  ready_url: http://127.0.0.1:43120/health\n";

        assert!(serde_yaml::from_str::<OfficialAppDefinition>(definition).is_err());
    }

    #[test]
    fn binary产物必须来自同仓库的受支持_release_并使用有效哈希() {
        let mut definition: OfficialAppDefinition = serde_yaml::from_str(
            "schema_version: 1\nid: mail-center\nname: 邮件中心\ndescription: test\ncategory: productivity\nversion: 0.1.6\nicon: Mail\nartifact:\n  url: https://gitee.com/aidea-org/mail-center/releases/download/v0.1.6/mail-center-0.1.6-darwin-arm64.tar.gz\n  sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nprocess:\n  command: [mail-center]\n  working_directory: .\n  ready_url: http://127.0.0.1:43130/health\n",
        )
        .unwrap();

        assert!(validate_definition(&definition).is_ok());
        definition.artifact.url =
            "https://github.com/aidea-org/mail-center/releases/download/v0.1.6/mail-center.tar.gz"
                .into();
        assert!(validate_definition(&definition).is_ok());
        definition.artifact.url =
            "https://gitlab.com/aidea-org/mail-center/-/releases/v0.1.6/downloads/mail-center.tar.gz"
                .into();
        assert!(validate_definition(&definition).is_ok());
        definition.artifact.url = "https://example.com/mail-center.tar.gz".into();
        assert!(validate_definition(&definition).is_err());
        definition.artifact.url =
            "https://gitee.com/aidea-org/mail-center/releases/download/v0.1.6/mail-center.tar.gz"
                .into();
        definition.artifact.sha256 = "not-a-hash".into();
        assert!(validate_definition(&definition).is_err());
        definition.artifact.sha256 = "A".repeat(64);
        assert!(validate_definition(&definition).is_err());
    }

    #[test]
    fn process_不允许未声明字段或非裸二进制名() {
        let text = "schema_version: 1\nid: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Box\nartifact:\n  url: https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz\n  sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nprocess:\n  command: [./demo]\n  working_directory: .\n  ready_url: http://127.0.0.1:43120/health\n";
        let definition: OfficialAppDefinition = serde_yaml::from_str(text).unwrap();
        assert!(validate_definition(&definition).is_err());

        let definition = text.replace("command: [./demo]", "command: [demo]\n  path: ./demo");
        assert!(serde_yaml::from_str::<OfficialAppDefinition>(&definition).is_err());
    }

    #[test]
    fn 缓存定义会合并收录仓库地址() {
        let cached = CachedOfficialApp {
            repository: "https://example.com/demo.git".into(),
            definition: valid_definition(),
        };

        let app = cached.into_app();

        assert_eq!(app.id, "demo-app");
        assert_eq!(app.repository, "https://example.com/demo.git");
    }

    #[test]
    fn 缓存定义在离线时仍可读取() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let catalog_dir = directory.join("catalog");
        let cache_dir = directory.join("cache");
        fs::create_dir_all(cache_dir.join("demo-app")).unwrap();
        fs::create_dir_all(&catalog_dir).unwrap();
        fs::write(
            catalog_dir.join("demo-app.yaml"),
            "schema_version: 1\nrepository: https://gitee.com/aidea-org/demo.git\nenabled: true\n",
        )
        .unwrap();
        fs::write(
            cache_dir.join("demo-app/aidea.yaml"),
            serde_yaml::to_string(&valid_definition()).unwrap(),
        )
        .unwrap();

        let definitions = load_cached_definitions_from_dir(&catalog_dir, &cache_dir).unwrap();

        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].definition.id, "demo-app");
        assert_eq!(
            definitions[0].repository,
            "https://gitee.com/aidea-org/demo.git"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 市场收录文件名必须与应用_id_一致() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let catalog_dir = directory.join("catalog");
        let cache_dir = directory.join("cache");
        fs::create_dir_all(cache_dir.join("other-app")).unwrap();
        fs::create_dir_all(&catalog_dir).unwrap();
        fs::write(
            catalog_dir.join("other-app.yaml"),
            "schema_version: 1\nrepository: https://gitee.com/aidea-org/demo.git\nenabled: true\n",
        )
        .unwrap();
        fs::write(
            cache_dir.join("other-app/aidea.yaml"),
            serde_yaml::to_string(&valid_definition()).unwrap(),
        )
        .unwrap();

        assert!(load_cached_definitions_from_dir(&catalog_dir, &cache_dir).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 三个平台的仓库与_release_url_必须同源同项目() {
        let definition = valid_definition();
        assert!(super::validate_artifact_repository(
            "https://gitee.com/aidea-org/demo.git",
            &definition
        )
        .is_ok());
        assert!(super::validate_artifact_repository(
            "https://gitee.com/aidea-org/other.git",
            &definition
        )
        .is_err());

        let mut definition = valid_definition();
        definition.artifact.url =
            "https://github.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into();
        assert!(super::validate_artifact_repository(
            "https://github.com/aidea-org/demo.git",
            &definition
        )
        .is_ok());

        definition.artifact.url =
            "https://gitlab.com/aidea-org/demo/-/releases/v0.1.0/downloads/demo.tar.gz".into();
        assert!(super::validate_artifact_repository(
            "https://gitlab.com/aidea-org/demo.git",
            &definition
        )
        .is_ok());

        definition.artifact.url =
            "http://gitlab.intra.example/aidea-org/demo/-/releases/v0.1.0/downloads/demo.tar.gz"
                .into();
        assert!(super::validate_artifact_repository(
            "http://gitlab.intra.example/aidea-org/demo.git",
            &definition
        )
        .is_ok());
    }

    #[test]
    fn 市场_raw_url_不依赖_api() {
        let gitee =
            super::parse_repository("https://gitee.com/aidea-org/aidea-market.git").unwrap();
        assert_eq!(
            super::repository_raw_url(&gitee, "market.yaml"),
            "https://gitee.com/aidea-org/aidea-market/raw/HEAD/market.yaml"
        );
        let github = super::parse_repository("https://github.com/aidea-org/demo.git").unwrap();
        assert_eq!(
            super::repository_raw_url(&github, "aidea.yaml"),
            "https://raw.githubusercontent.com/aidea-org/demo/HEAD/aidea.yaml"
        );
        let gitlab = super::parse_repository("https://gitlab.com/group/demo.git").unwrap();
        assert_eq!(
            super::repository_raw_url(&gitlab, "aidea.yaml"),
            "https://gitlab.com/group/demo/-/raw/HEAD/aidea.yaml"
        );
        let private_gitlab =
            super::parse_repository("http://gitlab.intra.example/group/demo.git").unwrap();
        assert_eq!(
            super::repository_raw_url(&private_gitlab, "aidea.yaml"),
            "http://gitlab.intra.example/group/demo/-/raw/HEAD/aidea.yaml"
        );
    }

    #[test]
    fn 市场索引只维护一个_yaml文件() {
        let index: OfficialCatalogIndex = serde_yaml::from_str(
            "schema_version: 1\napps:\n  demo-app:\n    schema_version: 1\n    repository: https://gitee.com/aidea-org/demo.git\n    enabled: true\n",
        )
        .unwrap();

        assert_eq!(index.apps.len(), 1);
        assert!(index.apps.contains_key("demo-app"));
        assert!(super::validate_catalog_index(&index).is_ok());
    }

    #[test]
    fn 不可访问的官方应用只能作为不可安装占位项() {
        let app = super::OfficialApp::unavailable(
            "internal-tool".into(),
            "https://gitlab.intra.example/team/internal-tool.git".into(),
        );

        assert!(!app.available);
        assert_eq!(app.id, "internal-tool");
        assert!(app.artifact.url.is_empty());
    }

    #[tokio::test]
    async fn 单个应用无法访问不阻断其他市场应用() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let manifest = format!(
            "schema_version: 1\nid: available-app\nname: Available\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Package\nartifact:\n  url: {origin}/team/available/-/releases/v0.1.0/downloads/available.tar.gz\n  sha256: {}\nprocess:\n  command: [available]\n  working_directory: .\n  ready_url: http://127.0.0.1:43120/health\n",
            "a".repeat(64),
        );
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 2048];
                let read = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                if request.contains("/team/available/") {
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        manifest.len(),
                        manifest
                    )
                    .unwrap();
                } else {
                    stream
                        .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .unwrap();
                }
            }
        });
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let catalog = directory.join("catalog");
        let cache = directory.join("cache");
        fs::create_dir_all(&catalog).unwrap();
        fs::write(
            catalog.join("available-app.yaml"),
            format!("schema_version: 1\nrepository: {origin}/team/available.git\nenabled: true\n"),
        )
        .unwrap();
        fs::write(
            catalog.join("internal-app.yaml"),
            format!("schema_version: 1\nrepository: {origin}/team/internal.git\nenabled: true\n"),
        )
        .unwrap();

        let (definitions, unavailable) =
            super::refresh_official_definitions_from_dir(&catalog, &cache)
                .await
                .unwrap();

        server.join().unwrap();
        fs::remove_dir_all(directory).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].definition.id, "available-app");
        assert_eq!(unavailable.len(), 1);
        assert_eq!(unavailable[0].id, "internal-app");
    }

    #[test]
    fn 官方应用拒绝携带凭据或非_gitlab_release_格式的仓库地址() {
        let mut definition = valid_definition();
        definition.artifact.url =
            "https://token@example.com/group/demo/-/releases/v0.1.0/downloads/demo.tar.gz".into();

        assert!(validate_definition(&definition).is_err());
        assert!(super::parse_repository("https://token@example.com/group/demo.git").is_err());
    }

    #[test]
    fn binary附件拒绝携带凭据的下载地址() {
        let mut definition = valid_definition();
        definition.artifact.url =
            "https://token@gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz".into();

        assert!(validate_definition(&definition).is_err());
    }

    #[test]
    fn 完整市场缓存替换后包含新目录和定义() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        let destination = directory.join("market-cache");
        let staging = directory.join("market-cache-staging");
        fs::create_dir_all(destination.join("catalog")).unwrap();
        fs::create_dir_all(destination.join("old-app")).unwrap();
        fs::write(destination.join("catalog/old.yaml"), "old").unwrap();
        fs::write(destination.join("old-app/aidea.yaml"), "old").unwrap();
        fs::create_dir_all(staging.join("catalog")).unwrap();
        fs::create_dir_all(staging.join("new-app")).unwrap();
        fs::write(staging.join("catalog/new.yaml"), "new").unwrap();
        fs::write(staging.join("new-app/aidea.yaml"), "new").unwrap();

        super::replace_directory(&staging, &destination).unwrap();

        assert!(destination.join("catalog/new.yaml").exists());
        assert!(destination.join("new-app/aidea.yaml").exists());
        assert!(!destination.join("catalog/old.yaml").exists());
        assert!(!destination.join("old-app/aidea.yaml").exists());
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
    fn 健康检查必须是本机health路径() {
        let mut definition = valid_definition();

        definition.process.ready_url = "http://127.0.0.1:43120/status".into();
        assert!(validate_definition(&definition).is_err());

        definition.process.ready_url = "http://127.0.0.1:43120/health?ready=true".into();
        assert!(validate_definition(&definition).is_err());

        definition.process.ready_url = "http://127.0.0.1:43120/health".into();
        assert!(validate_definition(&definition).is_ok());
    }

    #[test]
    fn 加载合法官方应用定义() {
        let directory = std::env::temp_dir().join(format!("aidea-market-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let app = (CachedOfficialApp {
            repository: "https://example.com/demo.git".into(),
            definition: valid_definition(),
        })
        .into_app();
        fs::write(
            directory.join("demo.yaml"),
            serde_yaml::to_string(&app).unwrap(),
        )
        .unwrap();
        assert_eq!(load_from_dir(&directory).unwrap()[0].id, "demo-app");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 官方市场收录文件不会当作完整定义解析() {
        let catalog =
            "schema_version: 1\nrepository: https://example.com/demo.git\nenabled: true\n";
        assert!(serde_yaml::from_str::<OfficialAppDefinition>(catalog).is_err());
    }

    #[test]
    fn dmg资源文件使用_tauri_up_路径() {
        let resources =
            std::env::temp_dir().join(format!("aidea-resources-{}", uuid::Uuid::new_v4()));
        let source = resources.join("_up_/market-source.yaml");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(
            &source,
            "schema_version: 1\nrepository: https://example.com/market.git\n",
        )
        .unwrap();
        assert_eq!(bundled_market_source(&resources).unwrap(), source);
        fs::remove_dir_all(resources).unwrap();
    }

    #[test]
    fn release_模式只读资源目录_不回看源码树() {
        let resources =
            std::env::temp_dir().join(format!("aidea-resources-{}", uuid::Uuid::new_v4()));
        let source = resources.join("market-source.yaml");
        fs::create_dir_all(&resources).unwrap();
        fs::write(
            &source,
            "schema_version: 1\nrepository: https://example.com/market.git\n",
        )
        .unwrap();

        assert_eq!(
            super::market_source_path_for_resources(&resources, false).unwrap(),
            source
        );
        fs::remove_dir_all(resources).unwrap();
    }
}
