use super::agent::{run_agent, AgentError};
use super::{AiServiceState, AI_SERVICE_URL};
use crate::diagnostics::{self, LogChannel, LogLevel, LogOwner};
use crate::error::AppResult;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentRequest {
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResponse {
    pub code: u32,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl AgentResponse {
    pub fn success(data: String) -> Self {
        Self {
            code: 0,
            data,
            message: None,
        }
    }

    pub fn error(code: u32, message: impl Into<String>) -> Self {
        Self {
            code,
            data: String::new(),
            message: Some(message.into()),
        }
    }
}

pub fn router(state: AiServiceState) -> Router {
    Router::new()
        .route("/api/agent", post(handle_agent))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

pub fn start_http_server(state: AiServiceState) {
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:43880").await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("AI Service 无法监听 {AI_SERVICE_URL}: {error}");
                state.mark_unavailable(message.clone());
                let _ = diagnostics::append_level(
                    &LogOwner::Aidea,
                    LogChannel::Platform,
                    LogLevel::Error,
                    "ai_service",
                    &message,
                );
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router(state.clone())).await {
            let message = format!("AI Service HTTP 服务已停止: {error}");
            state.mark_unavailable(message.clone());
            let _ = diagnostics::append_level(
                &LogOwner::Aidea,
                LogChannel::Platform,
                LogLevel::Error,
                "ai_service",
                &message,
            );
        }
    });
}

async fn handle_agent(
    State(state): State<AiServiceState>,
    headers: HeaderMap,
    request: Result<Json<AgentRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let status = state.status();
    if status.state != "ready" {
        return response(
            StatusCode::SERVICE_UNAVAILABLE,
            AgentResponse::error(
                1005,
                status.error.unwrap_or_else(|| "AI Service 不可用".into()),
            ),
        );
    }
    if !authorized(&headers, &state) {
        return response(
            StatusCode::UNAUTHORIZED,
            AgentResponse::error(1002, "访问令牌无效"),
        );
    }
    let request = match request {
        Ok(Json(request)) if !request.message.trim().is_empty() => request,
        Ok(_) | Err(_) => {
            return response(
                StatusCode::BAD_REQUEST,
                AgentResponse::error(1004, "请求必须包含非空 message"),
            );
        }
    };
    match run_service_agent(state, "agent", request.message).await {
        Ok(result) => response(StatusCode::OK, result),
        Err(error) => response(
            StatusCode::SERVICE_UNAVAILABLE,
            AgentResponse::error(1005, error.to_string()),
        ),
    }
}

pub(crate) async fn run_service_agent(
    state: AiServiceState,
    service_id: &str,
    message: String,
) -> AppResult<AgentResponse> {
    let model = state.select_model(service_id)?;
    Ok(
        match run_agent(state.clone(), model, message, state.audit_recorder()).await {
            Ok(output) => AgentResponse::success(output.text),
            Err(AgentError::Timeout) => AgentResponse::error(1001, AgentError::Timeout.message()),
            Err(AgentError::ApprovalDenied) => {
                AgentResponse::error(1003, AgentError::ApprovalDenied.message())
            }
            Err(error) => AgentResponse::error(1000, error.message()),
        },
    )
}

fn authorized(headers: &HeaderMap, state: &AiServiceState) -> bool {
    let Ok(token) = state.access_token() else {
        return false;
    };
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        == Some(token.as_str())
}

fn response(status: StatusCode, body: AgentResponse) -> Response {
    (status, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::extract::State;
    use axum::http::{Request, StatusCode};
    use axum::routing::post as route_post;
    use axum::{Json, Router};
    use serde_json::{json, Value};
    use std::future::IntoFuture;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tower::ServiceExt;

    fn state() -> (AiServiceState, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("aidea-ai-http-{}", uuid::Uuid::new_v4()));
        (AiServiceState::at(&root).unwrap(), root)
    }

    async fn post(
        state: &AiServiceState,
        path: &str,
        token: Option<&str>,
        body: &str,
    ) -> axum::response::Response {
        let mut builder = Request::post(path).header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        router(state.clone())
            .oneshot(builder.body(Body::from(body.to_owned())).unwrap())
            .await
            .unwrap()
    }

    async fn completion(
        State(calls): State<Arc<AtomicUsize>>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        assert!(body["messages"].is_array());
        calls.fetch_add(1, Ordering::SeqCst);
        Json(json!({
            "id":"test-1","object":"chat.completion","created":0,"model":"mock-model","system_fingerprint":"fp-test","choices":[{"index":0,"message":{"role":"assistant","content":"网关结果"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}
        }))
    }

    #[tokio::test]
    async fn 拒绝缺失令牌和空消息() {
        let (state, root) = state();
        let token = state.access_token().unwrap();
        assert_eq!(
            post(&state, "/api/agent", None, r#"{"message":"x"}"#)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post(&state, "/api/agent", Some("wrong"), r#"{"message":"x"}"#)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post(&state, "/api/agent", Some(&token), r#"{"message":"  "}"#)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn 只有固定_agent路径且未配置模型返回_503() {
        let (state, root) = state();
        let token = state.access_token().unwrap();
        assert_eq!(
            post(&state, "/api", Some(&token), r#"{"message":"x"}"#)
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        let response = post(&state, "/api/agent", Some(&token), r#"{"message":"x"}"#).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let body: AgentResponse = serde_json::from_slice(&body).unwrap();
        assert_ne!(body.code, 0);
        assert_eq!(body.data, "");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn ai_service不可用时_agent返回_503而不是认证错误() {
        let state = AiServiceState::unavailable("数据库初始化失败".into());
        let response = post(&state, "/api/agent", None, r#"{"message":"测试"}"#).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let body: AgentResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.code, 1005);
        assert_eq!(body.message.as_deref(), Some("数据库初始化失败"));
    }

    #[tokio::test]
    async fn 有效请求调用_agent并返回最终文本() {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/chat/completions", route_post(completion))
            .with_state(calls.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(axum::serve(listener, app).into_future());

        let (state, root) = state();
        state
            .save_model(crate::ai_service::ModelConfig {
                id: "mock".into(),
                provider: "openai".into(),
                base_url: format!("http://{address}/v1"),
                api_key: "test-key".into(),
                model: "mock-model".into(),
                sort_order: 0,
                enabled: true,
            })
            .unwrap();
        let token = state.access_token().unwrap();
        let response = post(&state, "/api/agent", Some(&token), r#"{"message":"测试"}"#).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let body: AgentResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.code, 0);
        assert_eq!(body.data, "网关结果");
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        server.abort();
        std::fs::remove_dir_all(root).unwrap();
    }
}
