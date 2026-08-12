use crate::config::app_data_dir;
use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MAX_AI_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

#[cfg(test)]
mod ai_http_tests {
    use super::validate_ai_url;

    #[test]
    fn reject_non_http_scheme() {
        assert!(validate_ai_url("file:///etc/passwd").is_err());
    }
}

#[derive(serde::Deserialize)]
pub struct AiHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
pub struct AiHttpResponse {
    pub status: u16,
    pub elapsed_ms: u128,
    pub body: serde_json::Value,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AiSavedConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AiConfigHistoryItem {
    pub id: String,
    pub base_url: String,
    pub model: String,
    pub key_hint: String,
    pub saved_at: u64,
}

fn open_database_at(app_dir: &Path) -> AppResult<Connection> {
    fs::create_dir_all(app_dir)?;
    let connection = Connection::open(app_dir.join("app.db"))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS ai_configs (
             id TEXT PRIMARY KEY,
             api_key TEXT NOT NULL,
             base_url TEXT NOT NULL,
             model TEXT NOT NULL,
             saved_at INTEGER NOT NULL
         );",
    )?;
    Ok(connection)
}

fn open_database() -> AppResult<Connection> {
    open_database_at(&app_data_dir("dev-tools")?)
}

fn ai_config_id(api_key: &str, base_url: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}\u{1f}{}", api_key, base_url))
    )
}

fn api_key_hint(api_key: &str) -> String {
    let suffix: String = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("...{}", suffix)
}

fn validate_ai_url(value: &str) -> AppResult<reqwest::Url> {
    let url =
        reqwest::Url::parse(value).map_err(|e| AppError::Config(format!("URL 无效: {}", e)))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Config("仅支持 HTTP(S) URL".to_string()));
    }
    Ok(url)
}

async fn read_ai_response_body(response: reqwest::Response, max_bytes: usize) -> AppResult<String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(AppError::Network(format!(
            "AI 响应体超过 {} MB 限制",
            max_bytes / 1024 / 1024
        )));
    }

    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| AppError::Network(error.to_string()))?;
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(AppError::Network(format!(
                "AI 响应体超过 {} MB 限制",
                max_bytes / 1024 / 1024
            )));
        }
        body.extend_from_slice(&chunk);
    }

    String::from_utf8(body).map_err(|error| AppError::Network(error.to_string()))
}

#[tauri::command]
pub async fn send_ai_http_request(request: AiHttpRequest) -> AppResult<AiHttpResponse> {
    let url = validate_ai_url(&request.url)?;
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|e| AppError::Config(format!("HTTP 方法无效: {}", e)))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let started = std::time::Instant::now();
    let mut builder = client.request(method, url);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status().as_u16();
    let text = read_ai_response_body(response, MAX_AI_RESPONSE_BYTES).await?;
    let body = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::Value::String(text));
    Ok(AiHttpResponse {
        status,
        elapsed_ms: started.elapsed().as_millis(),
        body,
    })
}

#[tauri::command]
pub async fn save_ai_config(config: AiSavedConfig) -> AppResult<()> {
    if config.api_key.trim().is_empty() || config.base_url.trim().is_empty() {
        return Err(AppError::Config("API Key 和 Base URL 不能为空".to_string()));
    }
    let id = ai_config_id(&config.api_key, &config.base_url);
    let saved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| AppError::Config(error.to_string()))?
        .as_secs();
    let connection = open_database()?;
    connection.execute(
        "INSERT INTO ai_configs (id, api_key, base_url, model, saved_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key, base_url = excluded.base_url,
             model = excluded.model, saved_at = excluded.saved_at",
        rusqlite::params![id, config.api_key, config.base_url, config.model, saved_at],
    )?;
    connection.execute(
        "DELETE FROM ai_configs WHERE id NOT IN
         (SELECT id FROM ai_configs ORDER BY saved_at DESC LIMIT 20)",
        [],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn delete_ai_config(id: String) -> AppResult<()> {
    let connection = open_database()?;
    if connection.execute("DELETE FROM ai_configs WHERE id = ?1", [&id])? == 0 {
        return Err(AppError::Config("历史配置不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_ai_configs() -> AppResult<Vec<AiConfigHistoryItem>> {
    let connection = open_database()?;
    let mut statement = connection.prepare(
        "SELECT id, base_url, model, api_key, saved_at FROM ai_configs ORDER BY saved_at DESC",
    )?;
    let items = statement
        .query_map([], |row| {
            let api_key: String = row.get(3)?;
            Ok(AiConfigHistoryItem {
                id: row.get(0)?,
                base_url: row.get(1)?,
                model: row.get(2)?,
                key_hint: api_key_hint(&api_key),
                saved_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

#[tauri::command]
pub fn load_ai_config(id: String) -> AppResult<AiSavedConfig> {
    let connection = open_database()?;
    let item = connection
        .query_row(
            "SELECT api_key, base_url, model FROM ai_configs WHERE id = ?1",
            [&id],
            |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::Config("历史配置不存在".to_string()))?;
    Ok(AiSavedConfig {
        api_key: item.0,
        base_url: item.1,
        model: item.2,
    })
}

#[cfg(test)]
mod tests {
    use super::{open_database_at, send_ai_http_request, AiHttpRequest};
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn ai配置使用_dev_tools自己的_app_db() {
        let root = std::env::temp_dir().join(format!("aidea-ai-{}", uuid::Uuid::new_v4()));
        let connection = open_database_at(&root).unwrap();
        assert!(root.join("app.db").exists());
        assert!(connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_configs'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .is_ok());
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai响应体超过限制时拒绝读取() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                super::MAX_AI_RESPONSE_BYTES + 1
            )
            .unwrap();
        });

        let result = send_ai_http_request(AiHttpRequest {
            url: format!("http://{address}"),
            method: "GET".to_string(),
            headers: HashMap::new(),
            body: None,
        })
        .await;

        assert!(
            matches!(result, Err(crate::error::AppError::Network(message)) if message.contains("超过"))
        );
    }
}
