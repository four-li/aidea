use crate::config::app_data_dir;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

pub const AI_SERVICE_ID: &str = "ai-service";
pub const AI_SERVICE_URL: &str = "http://127.0.0.1:43880";

pub mod agent;
pub mod audit;
pub mod http;
pub mod tools;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ModelConfigSummary {
    pub id: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub sort_order: i64,
    pub enabled: bool,
    pub key_hint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServiceDefinition {
    pub id: String,
    pub path: String,
    pub protocol: String,
    pub description: String,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServiceSummary {
    pub id: String,
    pub path: String,
    pub protocol: String,
    pub description: String,
    pub model_id: Option<String>,
}

#[derive(Clone)]
pub struct AiServiceState {
    db_path: PathBuf,
    rg_path: PathBuf,
    token: Arc<Mutex<String>>,
    audit_enabled: Arc<AtomicBool>,
    approvals: ApprovalManager,
    status: Arc<Mutex<AiServiceRuntimeStatus>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiServiceRuntimeStatus {
    pub state: String,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct ApprovalManager {
    pending: Arc<Mutex<std::collections::HashMap<uuid::Uuid, PendingApprovalEntry>>>,
}

struct PendingApprovalEntry {
    command: String,
    cwd: String,
    responder: oneshot::Sender<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PendingApproval {
    pub id: String,
    pub command: String,
    pub cwd: String,
}

impl Default for ApprovalManager {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

impl ApprovalManager {
    pub async fn request(&self, command: String, cwd: String) -> bool {
        let id = uuid::Uuid::new_v4();
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(
                id,
                PendingApprovalEntry {
                    command,
                    cwd,
                    responder: sender,
                },
            );
        } else {
            return false;
        }

        let approved = timeout(Duration::from_secs(120), receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        approved
    }

    pub fn list(&self) -> Vec<PendingApproval> {
        let Ok(pending) = self.pending.lock() else {
            return Vec::new();
        };
        pending
            .iter()
            .map(|(id, entry)| PendingApproval {
                id: id.to_string(),
                command: entry.command.clone(),
                cwd: entry.cwd.clone(),
            })
            .collect()
    }

    pub fn resolve(&self, id: &str, approved: bool) -> AppResult<()> {
        let id =
            uuid::Uuid::parse_str(id).map_err(|_| AppError::Config("授权请求 ID 无效".into()))?;
        let entry = self
            .pending
            .lock()
            .map_err(|_| AppError::Config("授权请求状态不可用".into()))?
            .remove(&id)
            .ok_or_else(|| AppError::Config("授权请求不存在或已结束".into()))?;
        let _ = entry.responder.send(approved);
        Ok(())
    }
}

impl AiServiceState {
    pub fn new() -> AppResult<Self> {
        Self::at(&app_data_dir(AI_SERVICE_ID)?)
    }

    pub fn at(root: &Path) -> AppResult<Self> {
        Self::at_with_rg_path(root, PathBuf::new())
    }

    pub fn at_with_rg_path(root: &Path, rg_path: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(root)?;
        let db_path = root.join("app.db");
        let connection = open_database_at(&db_path)?;
        let token = load_or_create_access_token_with_connection(&connection)?;
        let audit_enabled = connection.query_row(
            "SELECT audit_enabled FROM ai_service_settings WHERE id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )? != 0;
        Ok(Self {
            db_path,
            rg_path,
            token: Arc::new(Mutex::new(token)),
            audit_enabled: Arc::new(AtomicBool::new(audit_enabled)),
            approvals: ApprovalManager::default(),
            status: Arc::new(Mutex::new(AiServiceRuntimeStatus {
                state: "ready".into(),
                error: None,
            })),
        })
    }

    pub fn unavailable(error: String) -> Self {
        Self {
            db_path: PathBuf::new(),
            rg_path: PathBuf::new(),
            token: Arc::new(Mutex::new(String::new())),
            audit_enabled: Arc::new(AtomicBool::new(false)),
            approvals: ApprovalManager::default(),
            status: Arc::new(Mutex::new(AiServiceRuntimeStatus {
                state: "unavailable".into(),
                error: Some(error),
            })),
        }
    }

    pub fn status(&self) -> AiServiceRuntimeStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| AiServiceRuntimeStatus {
                state: "unavailable".into(),
                error: Some("AI Service 状态不可用".into()),
            })
    }

    pub fn mark_unavailable(&self, error: String) {
        if let Ok(mut status) = self.status.lock() {
            status.state = "unavailable".into();
            status.error = Some(error);
        }
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn set_rg_path(&mut self, rg_path: PathBuf) {
        self.rg_path = rg_path;
    }

    pub(crate) fn rg_path(&self) -> PathBuf {
        self.rg_path.clone()
    }

    pub fn access_token(&self) -> AppResult<String> {
        let status = self.status();
        if status.state != "ready" {
            return Err(AppError::Config(
                status.error.unwrap_or_else(|| "AI Service 不可用".into()),
            ));
        }
        self.token
            .lock()
            .map(|value| value.clone())
            .map_err(|_| AppError::Config("AI Service 令牌状态不可用".into()))
    }

    pub fn audit_enabled(&self) -> bool {
        self.audit_enabled.load(Ordering::Relaxed)
    }

    pub fn save_audit_enabled(&self, enabled: bool) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "UPDATE ai_service_settings SET audit_enabled = ?1 WHERE id = 1",
            [enabled as i64],
        )?;
        self.audit_enabled.store(enabled, Ordering::Relaxed);
        Ok(())
    }

    pub fn audit_recorder(&self) -> audit::AuditRecorder {
        audit::AuditRecorder::new(self.audit_enabled(), self.db_path.clone())
    }

    pub fn list_pending_approvals(&self) -> Vec<PendingApproval> {
        self.approvals.list()
    }

    pub fn resolve_approval(&self, id: &str, approved: bool) -> AppResult<()> {
        self.approvals.resolve(id, approved)
    }

    pub(crate) fn approvals(&self) -> ApprovalManager {
        self.approvals.clone()
    }

    pub fn list_audit_runs(&self) -> AppResult<Vec<audit::AuditRunSummary>> {
        Ok(audit::list_runs(&self.connection()?)?)
    }

    pub fn get_audit_run(&self, id: &str) -> AppResult<Option<audit::AuditRunDetail>> {
        Ok(audit::load_run(&self.connection()?, id)?)
    }

    pub fn list_models(&self) -> AppResult<Vec<ModelConfigSummary>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, provider, base_url, api_key, model, sort_order, enabled
             FROM ai_service_models ORDER BY sort_order, id",
        )?;
        let models = statement
            .query_map([], |row| {
                let key: String = row.get(3)?;
                Ok(ModelConfigSummary {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    base_url: row.get(2)?,
                    model: row.get(4)?,
                    sort_order: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    key_hint: api_key_hint(&key),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(models)
    }

    pub fn save_model(&self, model: ModelConfig) -> AppResult<()> {
        validate_model(&model)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO ai_service_models
             (id, provider, base_url, api_key, model, sort_order, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET provider = excluded.provider,
               base_url = excluded.base_url, api_key = excluded.api_key,
               model = excluded.model, sort_order = excluded.sort_order,
               enabled = excluded.enabled",
            params![
                model.id,
                model.provider,
                model.base_url,
                model.api_key,
                model.model,
                model.sort_order,
                model.enabled as i64
            ],
        )?;
        Ok(())
    }

    pub fn delete_model(&self, id: &str) -> AppResult<()> {
        let connection = self.connection()?;
        if connection.execute("DELETE FROM ai_service_models WHERE id = ?1", [id])? == 0 {
            return Err(AppError::Config("模型配置不存在".into()));
        }
        Ok(())
    }

    pub fn reorder_models(&self, ids: &[String]) -> AppResult<()> {
        let connection = self.connection()?;
        let stored: Vec<String> = {
            let mut statement = connection.prepare("SELECT id FROM ai_service_models")?;
            let ids = statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            ids
        };
        if ids.len() != stored.len()
            || ids
                .iter()
                .any(|id| !stored.iter().any(|stored_id| stored_id == id))
            || ids.windows(2).any(|pair| pair[0] == pair[1])
        {
            return Err(AppError::Config("模型排序列表与已配置模型不一致".into()));
        }
        let transaction = connection.unchecked_transaction()?;
        for (order, id) in ids.iter().enumerate() {
            transaction.execute(
                "UPDATE ai_service_models SET sort_order = ?1 WHERE id = ?2",
                params![order as i64, id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_services(&self) -> AppResult<Vec<ServiceSummary>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, path, protocol, description, model_id
             FROM ai_service_services ORDER BY id",
        )?;
        let services = statement
            .query_map([], |row| {
                Ok(ServiceSummary {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    protocol: row.get(2)?,
                    description: row.get(3)?,
                    model_id: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(services)
    }

    pub fn bind_service_model(&self, service_id: &str, model_id: Option<String>) -> AppResult<()> {
        let connection = self.connection()?;
        if let Some(model_id) = model_id.as_deref() {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM ai_service_models WHERE id = ?1",
                    [model_id],
                    |_| Ok(()),
                )
                .optional()?;
            if exists.is_none() {
                return Err(AppError::Config("绑定的模型不存在".into()));
            }
        }
        if connection.execute(
            "UPDATE ai_service_services SET model_id = ?1 WHERE id = ?2",
            params![model_id, service_id],
        )? == 0
        {
            return Err(AppError::Config("AI Service 服务不存在".into()));
        }
        Ok(())
    }

    pub fn select_model(&self, service_id: &str) -> AppResult<ModelConfig> {
        let connection = self.connection()?;
        let binding: Option<Option<String>> = connection
            .query_row(
                "SELECT model_id FROM ai_service_services WHERE id = ?1",
                [service_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(binding) = binding else {
            return Err(AppError::Config("AI Service 服务不存在".into()));
        };
        let model = if let Some(model_id) = binding {
            connection
                .query_row(
                    "SELECT id, provider, base_url, api_key, model, sort_order, enabled
                     FROM ai_service_models WHERE id = ?1 AND enabled = 1",
                    [model_id],
                    model_from_row,
                )
                .optional()?
                .ok_or_else(|| AppError::Config("服务绑定的模型不可用".into()))?
        } else {
            connection
                .query_row(
                    "SELECT id, provider, base_url, api_key, model, sort_order, enabled
                     FROM ai_service_models WHERE enabled = 1
                     ORDER BY sort_order, id LIMIT 1",
                    [],
                    model_from_row,
                )
                .optional()?
                .ok_or_else(|| AppError::Config("没有可用的 AI 模型".into()))?
        };
        Ok(model)
    }

    pub fn model_by_id(&self, id: &str) -> AppResult<ModelConfig> {
        self.connection()?
            .query_row(
                "SELECT id, provider, base_url, api_key, model, sort_order, enabled
                 FROM ai_service_models WHERE id = ?1 AND enabled = 1",
                [id],
                model_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::Config("模型不存在或已停用".into()))
    }

    pub fn model_config_by_id(&self, id: &str) -> AppResult<ModelConfig> {
        self.connection()?
            .query_row(
                "SELECT id, provider, base_url, api_key, model, sort_order, enabled
                 FROM ai_service_models WHERE id = ?1",
                [id],
                model_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::Config("模型配置不存在".into()))
    }

    fn connection(&self) -> AppResult<Connection> {
        let status = self.status();
        if status.state != "ready" {
            return Err(AppError::Config(
                status.error.unwrap_or_else(|| "AI Service 不可用".into()),
            ));
        }
        open_database_at(&self.db_path)
    }
}

fn open_database_at(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS ai_service_settings (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             access_token TEXT NOT NULL,
             audit_enabled INTEGER NOT NULL DEFAULT 1
         );
         CREATE TABLE IF NOT EXISTS ai_service_models (
             id TEXT PRIMARY KEY,
             provider TEXT NOT NULL,
             base_url TEXT NOT NULL,
             api_key TEXT NOT NULL,
             model TEXT NOT NULL,
             sort_order INTEGER NOT NULL,
             enabled INTEGER NOT NULL DEFAULT 1
         );
         CREATE TABLE IF NOT EXISTS ai_service_services (
             id TEXT PRIMARY KEY,
             path TEXT NOT NULL,
             protocol TEXT NOT NULL,
             description TEXT NOT NULL,
             model_id TEXT NULL
         );
         INSERT INTO ai_service_services (id, path, protocol, description)
         VALUES ('agent', '/api/agent', 'json', '带本机工具的一次性 Agent 任务')
         ON CONFLICT(id) DO NOTHING;",
    )?;
    audit::initialize_tables(&connection)?;
    Ok(connection)
}

fn load_or_create_access_token_with_connection(connection: &Connection) -> AppResult<String> {
    if let Some(token) = connection
        .query_row(
            "SELECT access_token FROM ai_service_settings WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(token);
    }
    let token = uuid::Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO ai_service_settings (id, access_token, audit_enabled) VALUES (1, ?1, 1)",
        [&token],
    )?;
    Ok(token)
}

pub fn load_or_create_access_token(root: &Path) -> AppResult<String> {
    let connection = open_database_at(&root.join("app.db"))?;
    load_or_create_access_token_with_connection(&connection)
}

pub fn access_token() -> AppResult<String> {
    AiServiceState::new()?.access_token()
}

fn model_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelConfig> {
    Ok(ModelConfig {
        id: row.get(0)?,
        provider: row.get(1)?,
        base_url: row.get(2)?,
        api_key: row.get(3)?,
        model: row.get(4)?,
        sort_order: row.get(5)?,
        enabled: row.get::<_, i64>(6)? != 0,
    })
}

fn validate_model(model: &ModelConfig) -> AppResult<()> {
    if [
        model.id.as_str(),
        model.provider.as_str(),
        model.base_url.as_str(),
        model.api_key.as_str(),
        model.model.as_str(),
    ]
    .iter()
    .any(|value| value.trim().is_empty() || value.chars().any(char::is_control))
    {
        return Err(AppError::Config(
            "模型配置字段不能为空或包含控制字符".into(),
        ));
    }
    if model.sort_order < 0 {
        return Err(AppError::Config("模型排序值无效".into()));
    }
    Ok(())
}

fn api_key_hint(value: &str) -> String {
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("...{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AiServiceState, PathBuf) {
        let root = std::env::temp_dir().join(format!("aidea-ai-service-{}", uuid::Uuid::new_v4()));
        let state = AiServiceState::at(&root).unwrap();
        (state, root)
    }

    fn model(id: &str, sort_order: i64) -> ModelConfig {
        ModelConfig {
            id: id.into(),
            provider: "openai".into(),
            base_url: "https://example.com".into(),
            api_key: format!("sk-{id}"),
            model: "test".into(),
            sort_order,
            enabled: true,
        }
    }

    #[test]
    fn 服务未绑定时使用排序第一的可用模型() {
        let (state, root) = state();
        state.save_model(model("second", 1)).unwrap();
        state.save_model(model("first", 0)).unwrap();
        assert_eq!(state.select_model("agent").unwrap().id, "first");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 绑定模型删除后拒绝请求() {
        let (state, root) = state();
        state.save_model(model("bound", 0)).unwrap();
        state
            .bind_service_model("agent", Some("bound".into()))
            .unwrap();
        state.delete_model("bound").unwrap();
        assert!(state.select_model("agent").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 重排序改变默认模型且摘要不返回_api_key() {
        let (state, root) = state();
        state.save_model(model("first", 0)).unwrap();
        state.save_model(model("second", 1)).unwrap();
        state
            .reorder_models(&["second".into(), "first".into()])
            .unwrap();
        assert_eq!(state.select_model("agent").unwrap().id, "second");
        let summary = serde_json::to_string(&state.list_models().unwrap()).unwrap();
        assert!(!summary.contains("sk-first"));
        assert!(!summary.contains("sk-second"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 保存模型时空_api_key会被拒绝() {
        let (state, root) = state();
        state.save_model(model("existing", 0)).unwrap();
        let mut updated = model("existing", 0);
        updated.api_key.clear();
        assert!(state.save_model(updated).is_err());
        assert!(state
            .save_model(ModelConfig {
                id: "new".into(),
                provider: "openai".into(),
                base_url: "https://example.com".into(),
                api_key: String::new(),
                model: "test".into(),
                sort_order: 1,
                enabled: true,
            })
            .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 访问令牌持久化稳定() {
        let root = std::env::temp_dir().join(format!("aidea-ai-token-{}", uuid::Uuid::new_v4()));
        let first = load_or_create_access_token(&root).unwrap();
        let second = load_or_create_access_token(&root).unwrap();
        assert_eq!(first, second);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 不可用状态不打开数据库并返回失败原因() {
        let state = AiServiceState::unavailable("数据库初始化失败".into());
        assert_eq!(state.status().state, "unavailable");
        assert_eq!(state.status().error.as_deref(), Some("数据库初始化失败"));
        assert!(state.list_models().is_err());
    }
}
