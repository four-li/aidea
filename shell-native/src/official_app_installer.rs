use crate::config::data_root;
use crate::error::{AppError, AppResult};
use crate::manifest::{AppIssue, AppManifest, AppStatus, ProcessConfig, UiConfig, UiMode};
use crate::official_market::{load_cached_official_apps, OfficialApp, OfficialAppDefinition};
use crate::process::check_official_source;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tar::{Archive, EntryType};
use tokio::time::Duration;
use uuid::Uuid;

const ARTIFACT_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstalledApp {
    pub id: String,
    pub version: String,
    pub status: String,
    /// 安装时保存的定义快照，市场离线时仍可启动和卸载。
    #[serde(default)]
    pub definition: Option<OfficialAppDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInstallProgress {
    pub id: String,
    pub phase: String,
    pub message: String,
}

pub struct UpdateRollback {
    backup_source: Option<PathBuf>,
    previous_record: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppUpdateStatus {
    Installed,
    UpdateAvailable,
}

pub fn app_update_status(installed_version: &str, market_version: &str) -> AppUpdateStatus {
    match (
        parse_version(installed_version),
        parse_version(market_version),
    ) {
        (Some(installed), Some(market)) if market > installed => AppUpdateStatus::UpdateAvailable,
        _ => AppUpdateStatus::Installed,
    }
}

fn parse_version(value: &str) -> Option<[u64; 3]> {
    let mut parts = value.split('.').map(str::parse::<u64>);
    match (parts.next()?, parts.next()?, parts.next()?, parts.next()) {
        (Ok(major), Ok(minor), Ok(patch), None) if major < 10 && minor < 10 && patch < 10 => {
            Some([major, minor, patch])
        }
        _ => None,
    }
}

fn install_root(id: &str) -> AppResult<PathBuf> {
    if !crate::official_market::is_kebab_case(id) {
        return Err(AppError::AppNotFound(id.to_string()));
    }
    Ok(data_root()?.join("apps/installed").join(id))
}

fn record_path(id: &str) -> AppResult<PathBuf> {
    // 安装状态不是可启动的 AppManifest，单独写入 install-state.yaml。
    Ok(install_root(id)?.join("install-state.yaml"))
}

fn install_log_path(id: &str) -> AppResult<PathBuf> {
    Ok(data_root()?.join("logs").join(id).join("install.log"))
}

fn app(id: &str) -> AppResult<OfficialApp> {
    load_cached_official_apps()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

fn read_log_tail(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::from("安装日志不存在"));
    }
    let content = fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().rev().take(200).collect();
    let mut result = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !result.is_empty() {
        result.push('\n');
    }
    Ok(result)
}

fn report_progress(
    def: &OfficialApp,
    on_progress: &mut (dyn FnMut(AppInstallProgress) + Send),
    phase: &str,
    message: &str,
) {
    on_progress(AppInstallProgress {
        id: def.id.clone(),
        phase: phase.into(),
        message: message.into(),
    });
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn verify_sha256(path: &Path, expected: &str) -> AppResult<()> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        return Ok(());
    }
    Err(AppError::Network(format!(
        "预编译包 SHA-256 校验失败（期望 {expected}，实际 {actual}）"
    )))
}

fn safe_archive_path(path: &Path) -> AppResult<Vec<String>> {
    let components = path.components().collect::<Vec<_>>();
    if components.is_empty()
        || components.iter().any(|component| {
            matches!(
                component,
                std::path::Component::Prefix(_)
                    | std::path::Component::RootDir
                    | std::path::Component::ParentDir
            )
        })
    {
        return Err(AppError::Config("预编译包包含不安全路径".into()));
    }
    components
        .into_iter()
        .map(|component| match component {
            std::path::Component::Normal(value) => value
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| AppError::Config("预编译包路径不是有效 UTF-8".into())),
            _ => Err(AppError::Config("预编译包包含不安全路径".into())),
        })
        .collect()
}

fn extract_artifact(archive_path: &Path, destination: &Path) -> AppResult<()> {
    fs::create_dir_all(destination)?;
    let file = File::open(archive_path)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    let mut root_name: Option<String> = None;

    for item in archive.entries()? {
        let mut entry = item?;
        let components = safe_archive_path(&entry.path()?)?;
        let current_root = components
            .first()
            .ok_or_else(|| AppError::Config("预编译包缺少根目录".into()))?;
        if let Some(root) = &root_name {
            if root != current_root {
                return Err(AppError::Config("预编译包必须只有一个根目录".into()));
            }
        } else {
            root_name = Some(current_root.clone());
        }

        let entry_type = entry.header().entry_type();
        if entry_type != EntryType::Regular && entry_type != EntryType::Directory {
            return Err(AppError::Config("预编译包不允许符号链接或硬链接".into()));
        }
        let relative = components.iter().skip(1).collect::<PathBuf>();
        if relative.as_os_str().is_empty() {
            if entry_type != EntryType::Directory {
                return Err(AppError::Config("预编译包顶层必须是目录".into()));
            }
            continue;
        }
        let output = destination.join(&relative);
        if entry_type == EntryType::Directory {
            fs::create_dir_all(&output)?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            entry.unpack(&output)?;
        }
    }

    if root_name.is_none() {
        return Err(AppError::Config("预编译包为空".into()));
    }
    Ok(())
}

/// 只接受单架构 arm64 Mach-O，避免 Rosetta 或 universal 包绕过官方应用平台契约。
pub(crate) fn validate_arm64_binary(path: &Path, id: &str) -> AppResult<()> {
    let mut header = [0u8; 12];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|error| AppError::Config(format!("官方应用 {id} 启动文件无效: {error}")))?;
    let magic = u32::from_le_bytes(header[..4].try_into().unwrap());
    let cpu_type = u32::from_le_bytes(header[4..8].try_into().unwrap());
    let cpu_subtype = u32::from_le_bytes(header[8..].try_into().unwrap());
    if magic != 0xfeed_facf || cpu_type != 0x0100_000c || cpu_subtype != 0 {
        return Err(AppError::Config(format!(
            "官方应用 {id} 启动文件必须是单架构 arm64 Mach-O"
        )));
    }
    Ok(())
}

async fn download_artifact(url: &str, destination: &Path, log: &mut File) -> AppResult<()> {
    writeln!(log, "下载预编译包 {url}")?;
    let response = reqwest::Client::builder()
        .timeout(ARTIFACT_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| AppError::Network(format!("初始化预编译包下载失败: {error}")))?
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Network(format!("下载预编译包失败: {error}")))?
        .error_for_status()
        .map_err(|error| AppError::Network(format!("下载预编译包失败: {error}")))?;
    let mut stream = response.bytes_stream();
    let mut file = File::create(destination)?;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| AppError::Network(format!("读取预编译包失败: {error}")))?;
        file.write_all(&chunk)?;
    }
    file.flush()?;
    Ok(())
}

async fn install_inner(
    def: &OfficialApp,
    on_progress: &mut (dyn FnMut(AppInstallProgress) + Send),
    keep_backup: bool,
) -> AppResult<(InstalledApp, UpdateRollback)> {
    let root = install_root(&def.id)?;
    fs::create_dir_all(&root)?;
    let log_path = install_log_path(&def.id)?;
    let log_parent = log_path
        .parent()
        .ok_or_else(|| AppError::Config("无法定位官方应用安装日志目录".into()))?;
    fs::create_dir_all(log_parent)?;
    let mut log = File::create(&log_path)?;
    writeln!(log, "开始安装官方应用 {}", def.id)?;
    let staging = root.join(format!("staging-{}", Uuid::new_v4()));
    let old_source = root.join("source");
    let result = async {
        report_progress(def, on_progress, "downloading", "正在下载预编译包…");
        fs::create_dir_all(&staging)?;
        let archive_path = staging.join("artifact.tar.gz");
        download_artifact(&def.artifact.url, &archive_path, &mut log).await?;
        report_progress(def, on_progress, "checking", "正在校验预编译包…");
        verify_sha256(&archive_path, &def.artifact.sha256)?;
        let staged_source = staging.join("source");
        report_progress(def, on_progress, "extracting", "正在解压预编译包…");
        extract_artifact(&archive_path, &staged_source)?;
        report_progress(def, on_progress, "checking", "正在检查新版本健康状态…");
        validate_arm64_binary(&staged_source.join(&def.process.command[0]), &def.id)?;
        check_official_source(def, &staged_source).await?;
        let backup = old_source
            .exists()
            .then(|| root.join(format!("source-backup-{}", Uuid::new_v4())));
        if let Some(backup) = &backup {
            fs::rename(&old_source, backup)?;
        }
        if let Err(error) = fs::rename(&staged_source, &old_source) {
            if let Some(backup) = &backup {
                let _ = fs::rename(backup, &old_source);
            }
            return Err(error.into());
        }
        let installed = InstalledApp {
            id: def.id.clone(),
            version: def.version.clone(),
            status: "installed".into(),
            definition: Some(def.manifest_snapshot()),
        };
        // 安装记录写入失败时回滚源码，避免新源码与旧记录不一致。
        let previous_record = {
            let path = record_path(&def.id)?;
            path.exists().then(|| fs::read(path)).transpose()?
        };
        let record = serde_yaml::to_string(&installed)?;
        if let Err(error) = write_install_record(&def.id, record.as_bytes()) {
            let _ = fs::remove_dir_all(&old_source);
            if let Some(backup) = &backup {
                let _ = fs::rename(backup, &old_source);
            }
            return Err(error);
        }
        let rollback = UpdateRollback {
            backup_source: backup,
            previous_record,
        };
        let rollback = if keep_backup {
            rollback
        } else {
            commit_update(rollback)?;
            UpdateRollback {
                backup_source: None,
                previous_record: None,
            }
        };
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        writeln!(log, "安装完成")?;
        report_progress(def, on_progress, "completed", "安装完成");
        Ok((installed, rollback))
    }
    .await;
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if let Err(error) = &result {
        let _ = writeln!(log, "安装失败: {error}");
        report_progress(def, on_progress, "failed", "安装失败");
    }
    result
}

pub async fn install(id: &str) -> AppResult<InstalledApp> {
    install_with_progress(id, |_| {}).await
}

pub async fn install_with_progress(
    id: &str,
    mut on_progress: impl FnMut(AppInstallProgress) + Send,
) -> AppResult<InstalledApp> {
    install_inner(&app(id)?, &mut on_progress, false)
        .await
        .map(|(installed, _)| installed)
}

pub async fn install_update_with_progress(
    id: &str,
    mut on_progress: impl FnMut(AppInstallProgress) + Send,
) -> AppResult<(InstalledApp, UpdateRollback)> {
    install_inner(&app(id)?, &mut on_progress, true).await
}

pub fn commit_update(rollback: UpdateRollback) -> AppResult<()> {
    if let Some(backup) = rollback.backup_source {
        if let Err(error) = fs::remove_dir_all(&backup) {
            eprintln!(
                "清理旧官方应用安装包备份 {} 失败: {error}",
                backup.display()
            );
        }
    }
    Ok(())
}

pub fn rollback_update(id: &str, rollback: UpdateRollback) -> AppResult<()> {
    let source = source_dir(id)?;
    if source.exists() {
        fs::remove_dir_all(&source)?;
    }
    if let Some(backup) = rollback.backup_source {
        fs::rename(backup, source)?;
    }
    if let Some(record) = rollback.previous_record {
        write_install_record(id, &record)?;
    } else {
        let path = record_path(id)?;
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn write_install_record(id: &str, content: &[u8]) -> AppResult<()> {
    let path = record_path(id)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("无法定位官方应用安装记录目录".into()))?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".install-state-{}", Uuid::new_v4()));
    fs::write(&temporary, content)?;
    fs::rename(temporary, path)?;
    Ok(())
}

pub fn read_install_log(id: &str) -> AppResult<String> {
    if !record_path(id)?.exists() {
        return Err(AppError::AppNotFound(id.to_string()));
    }
    read_log_tail(&install_log_path(id)?)
}

pub fn list_installed() -> AppResult<Vec<InstalledApp>> {
    let root = data_root()?.join("apps/installed");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !crate::official_market::is_kebab_case(&id) {
            eprintln!("忽略无效官方应用安装目录: {}", entry.path().display());
            continue;
        }
        let path = entry.path().join("install-state.yaml");
        if path.exists() {
            match serde_yaml::from_str::<InstalledApp>(&fs::read_to_string(&path)?) {
                Ok(record) if record.id == id => result.push(record),
                Ok(_) => eprintln!("忽略安装记录 ID 与目录不一致: {}", path.display()),
                Err(error) => eprintln!("忽略无效官方应用安装记录 {}: {error}", path.display()),
            }
        }
    }
    result.sort_by(|a: &InstalledApp, b: &InstalledApp| a.id.cmp(&b.id));
    Ok(result)
}

/// 已安装的官方应用由市场定义派生为壳可展示的 WebView 应用。
pub fn list_installed_app_manifests() -> AppResult<Vec<AppManifest>> {
    let mut manifests = Vec::new();
    let root = data_root()?.join("apps/installed");
    if !root.exists() {
        return Ok(manifests);
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !crate::official_market::is_kebab_case(&id) {
            eprintln!("忽略无效官方应用安装目录: {}", entry.path().display());
            continue;
        }
        let path = entry.path().join("install-state.yaml");
        if !path.exists() {
            continue;
        }
        let record = match serde_yaml::from_str::<InstalledApp>(&fs::read_to_string(&path)?) {
            Ok(record) => record,
            Err(error) => {
                manifests.push(unavailable_app_manifest(
                    &InstalledApp {
                        id,
                        version: "未知".into(),
                        status: "invalid".into(),
                        definition: None,
                    },
                    AppError::Config(format!("读取安装记录失败: {error}")),
                ));
                continue;
            }
        };
        if record.id != id {
            manifests.push(unavailable_app_manifest(
                &InstalledApp {
                    id,
                    version: "未知".into(),
                    status: "invalid".into(),
                    definition: None,
                },
                AppError::Config("安装记录 ID 与目录不一致".into()),
            ));
            continue;
        }
        match installed_definition_from_record(&record) {
            Ok(definition) => {
                manifests.push(installed_app_manifest(&definition)?);
            }
            Err(error) => manifests.push(unavailable_app_manifest(&record, error)),
        }
    }
    Ok(manifests)
}

fn unavailable_app_manifest(record: &InstalledApp, error: AppError) -> AppManifest {
    AppManifest {
        id: record.id.clone(),
        name: record.id.clone(),
        description: String::new(),
        version: record.version.clone(),
        category: "官方应用".into(),
        status: AppStatus::Active,
        ui: UiConfig {
            mode: UiMode::None,
            url: None,
            icon: None,
            entry: None,
        },
        settings: None,
        process: None,
        issue: Some(AppIssue {
            level: "warning".into(),
            message: format!("应用定义不可用：{error}。请刷新市场后更新或卸载。"),
            updated_at: chrono::Utc::now().timestamp(),
        }),
    }
}

pub fn source_dir(id: &str) -> AppResult<PathBuf> {
    Ok(install_root(id)?.join("source"))
}

pub fn installed_definition(id: &str) -> AppResult<OfficialApp> {
    let record = list_installed()?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))?;
    let definition = installed_definition_from_record(&record)?;
    if !source_dir(id)?.is_dir() {
        return Err(AppError::Process(format!("官方应用 {id} 安装包目录不存在")));
    }
    Ok(definition)
}

fn installed_definition_from_record(record: &InstalledApp) -> AppResult<OfficialApp> {
    let definition = record.definition.as_ref().ok_or_else(|| {
        AppError::Config(format!(
            "官方应用 {} 的安装记录缺少 manifest 快照",
            record.id
        ))
    })?;
    crate::official_market::validate_definition(definition)?;
    if definition.id != record.id || definition.version != record.version {
        return Err(AppError::Config(format!(
            "官方应用 {} 的安装记录与 manifest 快照不一致",
            record.id
        )));
    }
    Ok(definition.clone().into_app(String::new()))
}

fn installed_app_manifest(definition: &OfficialApp) -> AppResult<AppManifest> {
    let mut url = reqwest::Url::parse(&definition.process.ready_url)
        .map_err(|error| AppError::Config(format!("官方应用地址无效: {error}")))?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(AppManifest {
        id: definition.id.clone(),
        name: definition.name.clone(),
        description: definition.description.clone(),
        version: definition.version.clone(),
        category: definition.category.clone(),
        status: AppStatus::Active,
        ui: UiConfig {
            mode: UiMode::Webview,
            url: Some(url.into()),
            icon: Some(definition.icon.clone()),
            entry: None,
        },
        settings: None,
        process: Some(ProcessConfig {
            log_file: Some(
                data_root()?
                    .join("logs")
                    .join(&definition.id)
                    .join("app.log")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }),
        issue: None,
    })
}

pub async fn uninstall(id: &str) -> AppResult<()> {
    // 只允许卸载已有安装记录，市场离线时仍可清理已安装应用。
    if !record_path(id)?.exists() {
        return Err(AppError::AppNotFound(id.to_string()));
    }
    let root = install_root(id)?;
    if root.exists() {
        fs::remove_dir_all(root)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        app_update_status, commit_update, download_artifact, extract_artifact,
        installed_app_manifest, installed_definition_from_record, list_installed_app_manifests,
        read_log_tail, rollback_update, sha256_file, validate_arm64_binary, verify_sha256,
        AppUpdateStatus, InstalledApp, UpdateRollback,
    };
    use crate::official_market::{
        OfficialApp, OfficialAppDefinition, OfficialArtifact, OfficialProcess,
    };
    use std::fs;
    use std::sync::Mutex;
    use uuid::Uuid;

    static DATA_DIR_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn 安装记录可序列化() {
        let value = InstalledApp {
            id: "demo".into(),
            version: "1".into(),
            status: "installed".into(),
            definition: None,
        };
        let yaml = serde_yaml::to_string(&value).unwrap();
        assert!(yaml.contains("id: demo"));
    }

    #[test]
    fn 安装记录拒绝已删除的_revision字段() {
        let record = "id: demo\nversion: 1.0.0\nrevision: obsolete\nstatus: installed\n";

        assert!(serde_yaml::from_str::<InstalledApp>(record).is_err());
    }

    #[test]
    fn 安装记录保留应用定义快照() {
        let definition = OfficialAppDefinition {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1.0.0".into(),
            icon: "Package".into(),
            schema_version: 1,
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v1.0.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["demo".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
        };
        let value = InstalledApp {
            id: definition.id.clone(),
            version: definition.version.clone(),
            status: "installed".into(),
            definition: Some(definition),
        };

        let restored: InstalledApp =
            serde_yaml::from_str(&serde_yaml::to_string(&value).unwrap()).unwrap();

        assert_eq!(restored.definition.unwrap().name, "Demo");
    }

    #[test]
    fn 安装快照必须与安装记录一致且符合_manifest契约() {
        let definition = OfficialAppDefinition {
            schema_version: 1,
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1.0.0".into(),
            icon: "Package".into(),
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v1.0.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["../unsafe".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
        };
        let record = InstalledApp {
            id: "demo".into(),
            version: "1.0.0".into(),
            status: "installed".into(),
            definition: Some(definition),
        };

        assert!(installed_definition_from_record(&record).is_err());
    }

    #[test]
    fn 清理旧备份失败不否定已经成功的更新() {
        let backup = std::env::temp_dir().join(format!("aidea-backup-{}", Uuid::new_v4()));
        fs::write(&backup, "not a directory").unwrap();

        assert!(commit_update(UpdateRollback {
            backup_source: Some(backup.clone()),
            previous_record: None,
        })
        .is_ok());
        assert!(backup.exists());

        fs::remove_file(backup).unwrap();
    }

    #[test]
    fn 旧安装记录缺少定义快照会显示异常应用() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-app-{}", Uuid::new_v4()));
        let app_dir = directory.join("apps/installed/legacy-app");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join("install-state.yaml"),
            "id: legacy-app\nversion: 0.1.0\nrevision: abc\nstatus: installed\n",
        )
        .unwrap();

        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);
        let result = list_installed_app_manifests();
        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        fs::remove_dir_all(directory).unwrap();

        assert!(result.is_ok());
        let manifests = result.unwrap();
        assert_eq!(manifests[0].id, "legacy-app");
        assert!(manifests[0].issue.is_some());
    }

    #[test]
    fn 安装记录_id_与目录不一致时显示异常项() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-app-{}", Uuid::new_v4()));
        let app_dir = directory.join("apps/installed/legacy-app");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join("install-state.yaml"),
            "id: another-app\nversion: 0.1.0\nstatus: installed\n",
        )
        .unwrap();

        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);
        let result = list_installed_app_manifests();
        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        fs::remove_dir_all(directory).unwrap();

        let manifests = result.unwrap();
        assert_eq!(manifests[0].id, "legacy-app");
        assert!(manifests[0].issue.is_some());
    }

    #[tokio::test]
    async fn 旧安装记录不阻断其他应用并且卸载清理整个安装目录() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-app-{}", Uuid::new_v4()));
        let legacy = directory.join("apps/installed/legacy-app");
        let valid = directory.join("apps/installed/valid-app");
        fs::create_dir_all(legacy.join("source")).unwrap();
        fs::create_dir_all(legacy.join("staging-orphan")).unwrap();
        fs::create_dir_all(legacy.join("source-backup-orphan")).unwrap();
        fs::create_dir_all(&valid).unwrap();
        fs::write(
            legacy.join("install-state.yaml"),
            "id: legacy-app\nversion: 0.1.0\nrevision: obsolete\nstatus: installed\n",
        )
        .unwrap();
        fs::write(
            valid.join("install-state.yaml"),
            "id: valid-app\nversion: 0.1.0\nstatus: installed\n",
        )
        .unwrap();

        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);
        let installed = super::list_installed();
        let uninstall = super::uninstall("legacy-app").await;
        let legacy_removed = !legacy.exists();
        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        fs::remove_dir_all(directory).unwrap();

        assert_eq!(installed.unwrap().len(), 1);
        assert!(uninstall.is_ok());
        assert!(legacy_removed);
    }

    #[test]
    fn 只有市场版本更高才显示更新() {
        assert_eq!(
            app_update_status("0.1.0", "0.1.0"),
            AppUpdateStatus::Installed
        );
        assert_eq!(
            app_update_status("0.1.0", "0.1.1"),
            AppUpdateStatus::UpdateAvailable
        );
        assert_eq!(
            app_update_status("0.1.1", "0.1.0"),
            AppUpdateStatus::Installed
        );
    }

    #[test]
    fn 已安装官方应用转换为可显示的_webview_manifest() {
        let definition = OfficialApp {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1.0.0".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            artifact: OfficialArtifact {
                url: "https://gitee.com/aidea-org/demo/releases/download/v1.0.0/demo.tar.gz".into(),
                sha256: "a".repeat(64),
            },
            process: OfficialProcess {
                command: vec!["demo".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_available: false,
        };
        let manifest = installed_app_manifest(&definition).unwrap();
        assert_eq!(manifest.id, "demo");
        assert_eq!(manifest.ui.mode, crate::manifest::UiMode::Webview);
        assert!(manifest.process.is_some());
    }

    #[test]
    fn 安装日志只读取末尾_200_行() {
        let path = std::env::temp_dir().join(format!("aidea-install-log-{}.log", Uuid::new_v4()));
        let content = (0..205)
            .map(|index| format!("line-{index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, content).unwrap();

        let log = read_log_tail(&path).unwrap();

        assert!(!log.contains("line-0\n"));
        assert!(log.contains("line-5"));
        assert!(log.contains("line-204"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn binary包的_sha256_校验正确区分通过与失败() {
        let path = std::env::temp_dir().join(format!("aidea-artifact-{}.tar.gz", Uuid::new_v4()));
        fs::write(&path, b"mail-center-artifact").unwrap();

        assert!(verify_sha256(
            &path,
            "d4d3d7f1b2b6d29a4f5d6c2f2b7f8c9e1a0f5a5d4e0e6c7d8b9a0c1d2e3f4a5b"
        )
        .is_err());
        assert!(verify_sha256(&path, &sha256_file(&path).unwrap()).is_ok());

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn 启动文件必须是单架构_arm64_mach_o() {
        let path = std::env::temp_dir().join(format!("aidea-arm64-{}", Uuid::new_v4()));
        let mut arm64 = Vec::new();
        arm64.extend_from_slice(&0xfeed_facfu32.to_le_bytes());
        arm64.extend_from_slice(&0x0100_000cu32.to_le_bytes());
        arm64.extend_from_slice(&0u32.to_le_bytes());
        fs::write(&path, arm64).unwrap();

        assert!(validate_arm64_binary(&path, "demo").is_ok());
        let mut arm64e = Vec::new();
        arm64e.extend_from_slice(&0xfeed_facfu32.to_le_bytes());
        arm64e.extend_from_slice(&0x0100_000cu32.to_le_bytes());
        arm64e.extend_from_slice(&2u32.to_le_bytes());
        fs::write(&path, arm64e).unwrap();
        assert!(validate_arm64_binary(&path, "demo").is_err());
        fs::write(&path, b"#!/bin/sh\n").unwrap();
        assert!(validate_arm64_binary(&path, "demo").is_err());

        fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn binary包下载会完整写入响应内容() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nartifact",
                )
                .unwrap();
        });
        let archive =
            std::env::temp_dir().join(format!("aidea-download-{}.tar.gz", Uuid::new_v4()));
        let log_path = std::env::temp_dir().join(format!("aidea-download-{}.log", Uuid::new_v4()));
        let mut log = fs::File::create(&log_path).unwrap();

        download_artifact(
            &format!("http://{address}/artifact.tar.gz"),
            &archive,
            &mut log,
        )
        .await
        .unwrap();

        server.join().unwrap();
        assert_eq!(fs::read(&archive).unwrap(), b"artifact");
        fs::remove_file(archive).unwrap();
        fs::remove_file(log_path).unwrap();
    }

    #[test]
    fn binary包展开单层目录并拒绝路径穿越() {
        let archive = std::env::temp_dir().join(format!("aidea-archive-{}.tar.gz", Uuid::new_v4()));
        let source = std::env::temp_dir().join(format!("aidea-source-{}", Uuid::new_v4()));
        let file = fs::File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(5);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(
                &mut header,
                "mail-center-0.1.0-darwin-arm64/mail-center",
                &b"hello"[..],
            )
            .unwrap();
        let encoder = builder.into_inner().unwrap();
        encoder.finish().unwrap();

        extract_artifact(&archive, &source).unwrap();
        assert_eq!(fs::read(source.join("mail-center")).unwrap(), b"hello");

        fs::remove_file(&archive).unwrap();
        fs::remove_dir_all(&source).unwrap();

        let traversal =
            std::env::temp_dir().join(format!("aidea-traversal-{}.tar.gz", Uuid::new_v4()));
        let file = fs::File::create(&traversal).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.as_mut_bytes()[..9].copy_from_slice(b"../escape");
        header.set_size(4);
        header.set_cksum();
        builder.append(&header, &b"bad"[..]).unwrap();
        let encoder = builder.into_inner().unwrap();
        encoder.finish().unwrap();

        assert!(extract_artifact(&traversal, &source).is_err());
        assert!(!source.join("../escape").exists());
        fs::remove_file(traversal).unwrap();
    }

    #[test]
    fn binary包顶层必须是目录() {
        let archive =
            std::env::temp_dir().join(format!("aidea-root-file-{}.tar.gz", Uuid::new_v4()));
        let source = std::env::temp_dir().join(format!("aidea-source-{}", Uuid::new_v4()));
        let file = fs::File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(5);
        header.set_cksum();
        builder
            .append_data(&mut header, "mail-center", &b"hello"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();

        assert!(extract_artifact(&archive, &source).is_err());

        fs::remove_file(archive).unwrap();
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn 更新启动失败会恢复旧源码和安装记录() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-update-{}", Uuid::new_v4()));
        let root = directory.join("apps/installed/demo");
        let source = root.join("source");
        let backup = root.join("source-backup");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(source.join("new-marker"), "new").unwrap();
        fs::write(backup.join("old-marker"), "old").unwrap();
        fs::write(
            root.join("install-state.yaml"),
            "id: demo\nversion: 0.1.1\nstatus: installed\n",
        )
        .unwrap();
        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);

        rollback_update(
            "demo",
            UpdateRollback {
                backup_source: Some(backup),
                previous_record: Some(b"id: demo\nversion: 0.1.0\nstatus: installed\n".to_vec()),
            },
        )
        .unwrap();

        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        assert!(source.join("old-marker").exists());
        assert!(!source.join("new-marker").exists());
        assert_eq!(
            fs::read_to_string(root.join("install-state.yaml")).unwrap(),
            "id: demo\nversion: 0.1.0\nstatus: installed\n"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn 市场缓存不可用时仍可读取已安装应用日志() {
        let _guard = DATA_DIR_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!("aidea-app-{}", Uuid::new_v4()));
        let app_dir = directory.join("apps/installed/demo");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join("install-state.yaml"),
            "id: demo\nversion: 0.1.0\nstatus: installed\n",
        )
        .unwrap();
        let log_dir = directory.join("logs/demo");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("install.log"), "安装失败: 网络不可用\n").unwrap();

        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &directory);
        let result = super::read_install_log("demo");
        if let Some(value) = previous {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        fs::remove_dir_all(directory).unwrap();

        assert_eq!(result.unwrap(), "安装失败: 网络不可用\n");
    }
}
