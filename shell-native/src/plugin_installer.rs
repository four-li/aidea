use crate::config::data_root;
use crate::error::{AppError, AppResult};
use crate::manifest::{AppManifest, AppStatus, ProcessConfig, UiConfig, UiMode};
use crate::plugin_market::{load_official_plugins, OfficialPlugin};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub version: String,
    pub revision: String,
    pub status: String,
}

fn install_root(id: &str) -> AppResult<PathBuf> {
    Ok(data_root()?.join("apps/installed").join(id))
}

fn record_path(id: &str) -> AppResult<PathBuf> {
    // 安装状态不是可启动的 AppManifest，不能放在 manifest.yaml。
    Ok(install_root(id)?.join("install-state.yaml"))
}

fn plugin(id: &str) -> AppResult<OfficialPlugin> {
    load_official_plugins()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

async fn run(program: &str, args: &[String], cwd: &Path) -> AppResult<()> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| AppError::Process(format!("执行 {program} 失败: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "{program} 执行失败: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

async fn install_inner(def: &OfficialPlugin) -> AppResult<InstalledPlugin> {
    let root = install_root(&def.id)?;
    fs::create_dir_all(&root)?;
    let staging = root.join(format!("staging-{}", Uuid::new_v4()));
    let old_source = root.join("source");
    let result = async {
        run(
            "git",
            &[
                "clone".into(),
                "--no-checkout".into(),
                def.repository.clone(),
                staging.to_string_lossy().into_owned(),
            ],
            &root,
        )
        .await?;
        run("git", &["checkout".into(), def.revision.clone()], &staging).await?;
        for command in &def.install {
            run(&command[0], &command[1..], &staging).await?;
        }
        let backup = root.join(format!("source-backup-{}", Uuid::new_v4()));
        if old_source.exists() {
            fs::rename(&old_source, &backup)?;
        }
        if let Err(error) = fs::rename(&staging, &old_source) {
            if backup.exists() {
                let _ = fs::rename(&backup, &old_source);
            }
            return Err(error.into());
        }
        if backup.exists() {
            fs::remove_dir_all(backup)?;
        }
        let installed = InstalledPlugin {
            id: def.id.clone(),
            version: def.version.clone(),
            revision: def.revision.clone(),
            status: "installed".into(),
        };
        fs::write(record_path(&def.id)?, serde_yaml::to_string(&installed)?)?;
        Ok(installed)
    }
    .await;
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub async fn install(id: &str) -> AppResult<InstalledPlugin> {
    install_inner(&plugin(id)?).await
}

pub fn list_installed() -> AppResult<Vec<InstalledPlugin>> {
    let root = data_root()?.join("apps/installed");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root)? {
        let id = entry?.file_name().to_string_lossy().into_owned();
        let path = record_path(&id)?;
        if path.exists() {
            result.push(serde_yaml::from_str(&fs::read_to_string(path)?)?);
        }
    }
    result.sort_by(|a: &InstalledPlugin, b: &InstalledPlugin| a.id.cmp(&b.id));
    Ok(result)
}

/// 已安装的官方插件由市场定义派生为壳可展示的 WebView 应用。
pub fn list_installed_app_manifests() -> AppResult<Vec<AppManifest>> {
    let definitions = load_official_plugins()?;
    let records = list_installed()?;
    records
        .iter()
        .filter_map(|record| {
            definitions
                .iter()
                .find(|definition| definition.id == record.id)
        })
        .map(|definition| installed_app_manifest(definition, &source_dir(&definition.id)?))
        .collect()
}

pub fn source_dir(id: &str) -> AppResult<PathBuf> {
    Ok(install_root(id)?.join("source"))
}

pub fn installed_definition(id: &str) -> AppResult<OfficialPlugin> {
    if !list_installed()?.iter().any(|record| record.id == id) {
        return Err(AppError::AppNotFound(id.to_string()));
    }
    let definition = plugin(id)?;
    if !source_dir(id)?.is_dir() {
        return Err(AppError::Process(format!("官方插件 {id} 源码目录不存在")));
    }
    Ok(definition)
}

fn installed_app_manifest(definition: &OfficialPlugin, source: &Path) -> AppResult<AppManifest> {
    let mut url = reqwest::Url::parse(&definition.process.ready_url)
        .map_err(|error| AppError::Config(format!("官方插件地址无效: {error}")))?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(AppManifest {
        id: definition.id.clone(),
        name: definition.name.clone(),
        version: definition.version.clone(),
        category: definition.category.clone(),
        path: source.to_string_lossy().into_owned(),
        status: AppStatus::Active,
        ui: UiConfig {
            mode: UiMode::Webview,
            url: Some(url.into()),
            icon: Some(definition.icon.clone()),
        },
        process: Some(ProcessConfig {
            start: "official-plugin".into(),
            stop: Default::default(),
            autostart: false,
            working_dir: Some(source.to_string_lossy().into_owned()),
            log_file: Some(
                data_root()?
                    .join("logs")
                    .join(&definition.id)
                    .join("plugin.log")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }),
    })
}

pub async fn uninstall(id: &str) -> AppResult<()> {
    // 只允许卸载市场中登记的官方插件，避免把任意路径当作安装目录。
    let _ = plugin(id)?;
    let root = install_root(id)?;
    if root.exists() {
        if root.join("source").exists() {
            fs::remove_dir_all(root.join("source"))?;
        }
        if root.join("install-state.yaml").exists() {
            fs::remove_file(root.join("install-state.yaml"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{installed_app_manifest, InstalledPlugin};
    use crate::plugin_market::{OfficialPlugin, OfficialProcess};
    use std::path::Path;

    #[test]
    fn 安装记录可序列化() {
        let value = InstalledPlugin {
            id: "demo".into(),
            version: "1".into(),
            revision: "abc".into(),
            status: "installed".into(),
        };
        let yaml = serde_yaml::to_string(&value).unwrap();
        assert!(yaml.contains("id: demo"));
    }

    #[test]
    fn 已安装官方插件转换为可显示的_webview_manifest() {
        let definition = OfficialPlugin {
            id: "demo".into(),
            name: "Demo".into(),
            description: "demo".into(),
            category: "test".into(),
            version: "1".into(),
            icon: "Package".into(),
            repository: "https://example.com/demo.git".into(),
            revision: "abc".into(),
            runtime: "node".into(),
            install: vec![],
            process: OfficialProcess {
                command: vec!["node".into(), "server.js".into()],
                working_directory: ".".into(),
                ready_url: "http://127.0.0.1:43120/health".into(),
            },
            update_notes: String::new(),
        };
        let manifest = installed_app_manifest(&definition, Path::new("/tmp/demo/source")).unwrap();
        assert_eq!(manifest.id, "demo");
        assert_eq!(manifest.ui.mode, crate::manifest::UiMode::Webview);
        assert!(manifest.process.is_some());
    }
}
