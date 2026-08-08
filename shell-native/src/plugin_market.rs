use crate::config::project_root;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    pub update_notes: String,
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

pub fn load_official_plugins() -> AppResult<Vec<OfficialPlugin>> {
    let development_dir = project_root()?.join("plugin-markets/official");
    if development_dir.exists() {
        return load_from_dir(&development_dir);
    }
    let resources = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .map(|path| path.join("Resources/plugin-markets/official"))
        .ok_or_else(|| AppError::Config("无法定位官方插件市场资源目录".into()))?;
    load_from_dir(&resources)
}

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
    use super::{load_from_dir, load_official_plugins};
    use std::fs;

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
    fn 官方市场包含股票助手() {
        let plugins = load_official_plugins().unwrap();
        assert!(plugins.iter().any(|plugin| plugin.id == "stock-assistant"));
    }
}
