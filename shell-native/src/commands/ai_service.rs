use crate::ai_service::{AiServiceState, ModelConfig, PendingApproval, ServiceSummary};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize)]
pub struct ModelTestRequest {
    pub model_id: Option<String>,
    pub service_id: Option<String>,
    pub request: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelTestResult {
    pub data: String,
    pub elapsed_ms: u128,
    pub request: serde_json::Value,
    pub response: serde_json::Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderModelsRequest {
    pub base_url: String,
    pub api_key: String,
}

async fn fetch_provider_models(request: &ProviderModelsRequest) -> AppResult<Vec<String>> {
    if request.base_url.trim().is_empty() || request.api_key.trim().is_empty() {
        return Err(crate::error::AppError::Config(
            "Base URL 和 API Key 不能为空".into(),
        ));
    }
    let base_url = reqwest::Url::parse(request.base_url.trim())
        .map_err(|error| crate::error::AppError::Config(format!("Base URL 无效: {error}")))?;
    if !matches!(base_url.scheme(), "http" | "https") {
        return Err(crate::error::AppError::Config(
            "仅支持 HTTP(S) Base URL".into(),
        ));
    }
    let url = format!("{}/models", request.base_url.trim_end_matches('/'));
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?
        .get(url)
        .bearer_auth(&request.api_key)
        .send()
        .await
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?;
    if !status.is_success() {
        return Err(crate::error::AppError::Network(
            body.get("error")
                .and_then(|value| value.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("获取模型列表失败")
                .to_owned(),
        ));
    }
    Ok(body
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub fn list_ai_service_models(
    state: tauri::State<'_, AiServiceState>,
) -> AppResult<Vec<crate::ai_service::ModelConfigSummary>> {
    state.list_models()
}

#[tauri::command]
pub fn get_ai_service_model(
    state: tauri::State<'_, AiServiceState>,
    id: String,
) -> AppResult<ModelConfig> {
    state.model_config_by_id(&id)
}

#[tauri::command]
pub fn save_ai_service_model(
    state: tauri::State<'_, AiServiceState>,
    model: ModelConfig,
) -> AppResult<()> {
    state.save_model(model)
}

#[tauri::command]
pub fn delete_ai_service_model(
    state: tauri::State<'_, AiServiceState>,
    id: String,
) -> AppResult<()> {
    state.delete_model(&id)
}

#[tauri::command]
pub fn reorder_ai_service_models(
    state: tauri::State<'_, AiServiceState>,
    ids: Vec<String>,
) -> AppResult<()> {
    state.reorder_models(&ids)
}

#[tauri::command]
pub fn list_ai_service_services(
    state: tauri::State<'_, AiServiceState>,
) -> AppResult<Vec<ServiceSummary>> {
    state.list_services()
}

#[tauri::command]
pub fn save_ai_service_service_model(
    state: tauri::State<'_, AiServiceState>,
    service_id: String,
    model_id: Option<String>,
) -> AppResult<()> {
    state.bind_service_model(&service_id, model_id)
}

#[tauri::command]
pub async fn fetch_ai_service_provider_models(
    request: ProviderModelsRequest,
) -> AppResult<Vec<String>> {
    fetch_provider_models(&request).await
}

#[tauri::command]
pub async fn test_ai_service_model(
    state: tauri::State<'_, AiServiceState>,
    request: ModelTestRequest,
) -> AppResult<ModelTestResult> {
    let started = Instant::now();
    match (
        request.model_id.filter(|id| !id.trim().is_empty()),
        request.service_id.filter(|id| !id.trim().is_empty()),
    ) {
        (Some(model_id), None) => {
            if !request.request.is_object() {
                return Err(crate::error::AppError::Config(
                    "请求参数必须是 JSON 对象".into(),
                ));
            }
            test_model_request(state.model_by_id(&model_id)?, request.request, started).await
        }
        (None, Some(service_id)) => {
            let message = request
                .request
                .get("message")
                .and_then(Value::as_str)
                .filter(|message| !message.trim().is_empty())
                .ok_or_else(|| {
                    crate::error::AppError::Config("服务调用必须包含非空 message".into())
                })?
                .to_owned();
            let response = match crate::ai_service::http::run_service_agent(
                state.inner().clone(),
                &service_id,
                message,
            )
            .await
            {
                Ok(response) => response,
                Err(error) => {
                    crate::ai_service::http::AgentResponse::error(1005, error.to_string())
                }
            };
            Ok(ModelTestResult {
                data: response.data.clone(),
                elapsed_ms: started.elapsed().as_millis(),
                request: request.request,
                response: serde_json::to_value(&response).unwrap_or_else(|_| serde_json::json!({})),
                error: response.message.clone(),
            })
        }
        _ => Err(crate::error::AppError::Config(
            "模型请求或服务调用必须且只能指定一个目标".into(),
        )),
    }
}

async fn test_model_request(
    model: ModelConfig,
    body: Value,
    started: Instant,
) -> AppResult<ModelTestResult> {
    let url = format!("{}/chat/completions", model.base_url.trim_end_matches('/'));
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?
        .post(url)
        .bearer_auth(model.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| crate::error::AppError::Network(error.to_string()))?;
    let response_body =
        serde_json::from_str(&response_text).unwrap_or(Value::String(response_text));
    if !status.is_success() {
        return Ok(ModelTestResult {
            data: String::new(),
            elapsed_ms: started.elapsed().as_millis(),
            request: body,
            response: serde_json::json!({ "status": status.as_u16(), "body": response_body }),
            error: Some(format!("上游返回 HTTP {}", status.as_u16())),
        });
    }
    let data = response_body
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    Ok(ModelTestResult {
        data: data.clone().unwrap_or_default(),
        elapsed_ms: started.elapsed().as_millis(),
        request: body,
        response: serde_json::json!({ "status": status.as_u16(), "body": response_body }),
        error: data.is_none().then_some("模型响应缺少文本结果".into()),
    })
}

#[tauri::command]
pub fn get_ai_service_token(state: tauri::State<'_, AiServiceState>) -> AppResult<String> {
    state.access_token()
}

#[tauri::command]
pub fn get_ai_service_audit_settings(state: tauri::State<'_, AiServiceState>) -> bool {
    state.audit_enabled()
}

#[tauri::command]
pub fn save_ai_service_audit_settings(
    state: tauri::State<'_, AiServiceState>,
    enabled: bool,
) -> AppResult<()> {
    state.save_audit_enabled(enabled)
}

#[tauri::command]
pub fn list_ai_service_audit_runs(
    state: tauri::State<'_, AiServiceState>,
) -> AppResult<Vec<crate::ai_service::audit::AuditRunSummary>> {
    state.list_audit_runs()
}

#[tauri::command]
pub fn get_ai_service_audit_run(
    state: tauri::State<'_, AiServiceState>,
    id: String,
) -> AppResult<Option<crate::ai_service::audit::AuditRunDetail>> {
    state.get_audit_run(&id)
}

#[tauri::command]
pub fn list_ai_service_pending_approvals(
    state: tauri::State<'_, AiServiceState>,
) -> Vec<PendingApproval> {
    state.list_pending_approvals()
}

#[tauri::command]
pub fn resolve_ai_service_approval(
    state: tauri::State<'_, AiServiceState>,
    id: String,
    approved: bool,
) -> AppResult<()> {
    state.resolve_approval(&id, approved)
}

#[cfg(test)]
mod tests {
    use super::{fetch_provider_models, test_model_request, ProviderModelsRequest};
    use crate::ai_service::ModelConfig;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Instant;

    #[tokio::test]
    async fn 获取提供方模型列表解析_openai兼容响应() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with("GET /v1/models HTTP/1.1"));
            assert!(request.contains("authorization: Bearer sk-test"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"data\":[{\"id\":\"gpt-5\"},{\"id\":\"gpt-5-mini\"}]}")
                .unwrap();
        });

        let models = fetch_provider_models(&ProviderModelsRequest {
            base_url: format!("http://{address}/v1"),
            api_key: "sk-test".into(),
        })
        .await
        .unwrap();

        assert_eq!(models, vec!["gpt-5", "gpt-5-mini"]);
    }

    #[tokio::test]
    async fn 上游失败时仍保留响应体用于模型测试() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
            stream
                .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":{\"message\":\"invalid API key\"}}")
                .unwrap();
        });

        let result = test_model_request(
            ModelConfig {
                id: "test".into(),
                provider: "openai".into(),
                base_url: format!("http://{address}/v1"),
                api_key: "sk-test".into(),
                model: "gpt-5".into(),
                sort_order: 0,
                enabled: true,
            },
            json!({"model":"gpt-5","messages":[{"role":"user","content":"测试"}]}),
            Instant::now(),
        )
        .await
        .unwrap();

        assert_eq!(result.data, "");
        assert_eq!(result.error.as_deref(), Some("上游返回 HTTP 401"));
        assert_eq!(result.response["status"], 401);
        assert_eq!(
            result.response["body"]["error"]["message"],
            "invalid API key"
        );
    }
}
