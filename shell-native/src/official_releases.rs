use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseProvider {
    Gitee,
    GitHub,
    GitLab,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialRelease {
    pub version: String,
    pub title: String,
    pub body: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub url: String,
}

pub fn api_url_for(repository: &str) -> AppResult<(ReleaseProvider, String)> {
    let parsed = reqwest::Url::parse(repository)
        .map_err(|error| AppError::Config(format!("官方应用仓库地址无效: {error}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Config("官方应用仓库地址缺少域名".into()))?;
    let path = parsed.path().trim_matches('/').trim_end_matches(".git");
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() < 2 {
        return Err(AppError::Config("官方应用仓库路径无效".into()));
    }

    let (provider, endpoint) = match host {
        "gitee.com" => (
            ReleaseProvider::Gitee,
            format!(
                "https://gitee.com/api/v5/repos/{}/releases?per_page=20&page=1",
                segments.join("/")
            ),
        ),
        "github.com" => (
            ReleaseProvider::GitHub,
            format!(
                "https://api.github.com/repos/{}/releases?per_page=20&page=1",
                segments.join("/")
            ),
        ),
        _ => (
            ReleaseProvider::GitLab,
            format!(
                "{}://{}/api/v4/projects/{}/releases?per_page=20&page=1",
                parsed.scheme(),
                host_with_port(&parsed),
                encode_project_path(&segments.join("/"))
            ),
        ),
    };
    Ok((provider, endpoint))
}

fn host_with_port(url: &reqwest::Url) -> String {
    match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
        None => url.host_str().unwrap_or_default().to_string(),
    }
}

fn encode_project_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len() + 8);
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

pub async fn list_releases(repository: &str) -> AppResult<Vec<OfficialRelease>> {
    let (provider, endpoint) = api_url_for(repository)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("aIdea")
        .build()
        .map_err(|error| AppError::Network(format!("初始化 Release 请求失败: {error}")))?;
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|error| AppError::Network(format!("读取 Release 失败: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Network(format!(
            "读取 Release 失败: HTTP {status}"
        )));
    }
    let payload: Vec<Value> = response
        .json()
        .await
        .map_err(|error| AppError::Network(format!("解析 Release 响应失败: {error}")))?;
    payload
        .into_iter()
        .map(|release| map_release(provider, repository, release))
        .collect()
}

fn map_release(
    provider: ReleaseProvider,
    repository: &str,
    value: Value,
) -> AppResult<OfficialRelease> {
    let version = required_string(&value, "tag_name")?;
    let title = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(&version)
        .to_string();
    let body_key = if provider == ReleaseProvider::GitLab {
        "description"
    } else {
        "body"
    };
    let body = value
        .get(body_key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let published_at = value
        .get(if provider == ReleaseProvider::GitLab {
            "released_at"
        } else {
            "published_at"
        })
        .and_then(Value::as_str)
        .map(str::to_string);
    let prerelease = if provider == ReleaseProvider::GitLab {
        value
            .get("upcoming_release")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    } else {
        value
            .get("prerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };
    let url = release_page_url(repository, &version)?;
    Ok(OfficialRelease {
        version,
        title,
        body,
        published_at,
        prerelease,
        url,
    })
}

fn release_page_url(repository: &str, version: &str) -> AppResult<String> {
    let parsed = reqwest::Url::parse(repository)
        .map_err(|error| AppError::Config(format!("官方应用仓库地址无效: {error}")))?;
    let path = parsed.path().trim_matches('/').trim_end_matches(".git");
    let base = format!("{}://{}/{}", parsed.scheme(), host_with_port(&parsed), path);
    let tag = encode_project_path(version);
    if parsed.host_str() == Some("github.com") || parsed.host_str() == Some("gitee.com") {
        Ok(format!("{base}/releases/tag/{tag}"))
    } else {
        Ok(format!("{base}/-/releases/{tag}"))
    }
}

fn required_string(value: &Value, key: &str) -> AppResult<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Network(format!("Release 响应缺少 {key}")))
}

#[cfg(test)]
mod tests {
    use super::{api_url_for, map_release, ReleaseProvider};
    use serde_json::json;

    #[test]
    fn 根据仓库地址选择三个平台的_release_api() {
        assert_eq!(
            api_url_for("https://gitee.com/aidea-org/mail-manager.git").unwrap(),
            (
                ReleaseProvider::Gitee,
                "https://gitee.com/api/v5/repos/aidea-org/mail-manager/releases?per_page=20&page=1"
                    .into()
            )
        );
        assert_eq!(
            api_url_for("https://github.com/four-li/stock-assistant.git").unwrap(),
            (
                ReleaseProvider::GitHub,
                "https://api.github.com/repos/four-li/stock-assistant/releases?per_page=20&page=1"
                    .into()
            )
        );
        assert_eq!(
            api_url_for("http://dev03.ushopal.com:10083/ChenChuanFeng/atlas").unwrap(),
            (ReleaseProvider::GitLab, "http://dev03.ushopal.com:10083/api/v4/projects/ChenChuanFeng%2Fatlas/releases?per_page=20&page=1".into())
        );
    }

    #[test]
    fn 统一三个平台的_release字段() {
        let release = map_release(
            ReleaseProvider::GitLab,
            "http://gitlab.example/ChenChuanFeng/atlas",
            json!({
                "tag_name": "v1.2.0",
                "name": "版本 1.2.0",
                "description": "修复同步",
                "released_at": "2026-08-13T01:00:00Z",
                "upcoming_release": false,
                "_links": {"self": "http://gitlab.example/releases/v1.2.0"}
            }),
        )
        .unwrap();
        assert_eq!(release.version, "v1.2.0");
        assert_eq!(release.title, "版本 1.2.0");
        assert_eq!(release.body, "修复同步");
        assert!(!release.prerelease);
        assert_eq!(
            release.url,
            "http://gitlab.example/ChenChuanFeng/atlas/-/releases/v1.2.0"
        );
    }
}
