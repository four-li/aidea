use crate::config::{load_config, save_config, AiConfigHistoryItem};
use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

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
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
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
    crate::ai_keychain::save(&id, &config.api_key)?;
    let saved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| AppError::Config(error.to_string()))?
        .as_secs();
    let mut shell_config = load_config()?;
    let item_id = id.clone();
    let removed_ids = shell_config.ai_history.insert(AiConfigHistoryItem {
        id,
        base_url: config.base_url,
        model: config.model,
        key_hint: api_key_hint(&config.api_key),
        saved_at,
    });
    save_config(&shell_config)?;
    for removed_id in removed_ids {
        if removed_id != item_id {
            crate::ai_keychain::delete(&removed_id)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_ai_config(id: String) -> AppResult<()> {
    let mut shell_config = load_config()?;
    if !shell_config
        .ai_history
        .items
        .iter()
        .any(|item| item.id == id)
    {
        return Err(AppError::Config("历史配置不存在".to_string()));
    }
    shell_config.ai_history.items.retain(|item| item.id != id);
    save_config(&shell_config)?;
    crate::ai_keychain::delete(&id)
}

#[tauri::command]
pub async fn list_ai_configs() -> AppResult<Vec<AiConfigHistoryItem>> {
    Ok(load_config()?.ai_history.items)
}

#[tauri::command]
pub fn load_ai_config(id: String) -> AppResult<AiSavedConfig> {
    let shell_config = load_config()?;
    let item = shell_config
        .ai_history
        .items
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::Config("历史配置不存在".to_string()))?;
    // 先通过 macOS 指纹认证（5 分钟内复用已认证的 LAContext），再读取钥匙串
    crate::mac_auth::authenticate_local_user("查看已保存的 AI 配置")?;
    Ok(AiSavedConfig {
        api_key: crate::ai_keychain::load(&item.id)?,
        base_url: item.base_url,
        model: item.model,
    })
}
