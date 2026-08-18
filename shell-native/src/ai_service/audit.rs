use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuditStatus {
    Running,
    Succeeded,
    Failed,
}

impl AuditStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditRunSummary {
    pub id: String,
    pub service: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub elapsed_ms: Option<u128>,
    pub loop_count: u32,
    pub usage: TokenUsage,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditEvent {
    pub sequence: u32,
    pub event_type: String,
    pub name: String,
    pub elapsed_ms: u128,
    pub usage: TokenUsage,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditRunDetail {
    pub run: AuditRunSummary,
    pub events: Vec<AuditEvent>,
}

pub struct AuditRun {
    id: String,
    db_path: PathBuf,
    started: Instant,
    next_sequence: AtomicU32,
    loop_count: AtomicU32,
}

#[derive(Clone)]
pub struct AuditRecorder {
    db_path: Option<PathBuf>,
}

impl AuditRecorder {
    pub fn new(enabled: bool, db_path: PathBuf) -> Self {
        Self {
            db_path: enabled.then_some(db_path),
        }
    }

    pub fn start_run(&self, service: &str) -> Option<AuditRun> {
        let db_path = self.db_path.as_ref()?.clone();
        let id = uuid::Uuid::new_v4().to_string();
        let started_at = unix_timestamp().ok()?;
        let connection = open_connection(&db_path).ok()?;
        let transaction = connection.unchecked_transaction().ok()?;
        transaction
            .execute(
                "INSERT INTO ai_service_audit_runs
                 (id, service, status, started_at, loop_count)
                 VALUES (?1, ?2, ?3, ?4, 0)",
                params![id, service, AuditStatus::Running.as_str(), started_at],
            )
            .ok()?;
        transaction
            .execute(
                "INSERT INTO ai_service_audit_events
                 (run_id, sequence, event_type, name, elapsed_ms)
                 VALUES (?1, 1, 'request', ?2, 0)",
                params![id, service],
            )
            .ok()?;
        transaction.commit().ok()?;
        Some(AuditRun {
            id,
            db_path,
            started: Instant::now(),
            next_sequence: AtomicU32::new(2),
            loop_count: AtomicU32::new(0),
        })
    }

    pub fn record_event(
        &self,
        run: &AuditRun,
        event_type: &str,
        name: &str,
        elapsed_ms: u128,
        usage: Option<TokenUsage>,
        summary: &str,
    ) {
        if self.db_path.is_none() {
            return;
        }
        if event_type == "model" {
            run.loop_count.fetch_add(1, Ordering::Relaxed);
        }
        let sequence = run.next_sequence.fetch_add(1, Ordering::Relaxed);
        let usage = usage.unwrap_or_default();
        let result = (|| -> rusqlite::Result<()> {
            let connection = open_connection(&run.db_path)?;
            connection.execute(
                "INSERT INTO ai_service_audit_events
                 (run_id, sequence, event_type, name, elapsed_ms, input_tokens, output_tokens,
                  total_tokens, summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    run.id,
                    sequence,
                    event_type,
                    name,
                    elapsed_ms as i64,
                    usage.input_tokens.map(|value| value as i64),
                    usage.output_tokens.map(|value| value as i64),
                    usage.total_tokens.map(|value| value as i64),
                    redact_summary(summary),
                ],
            )?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("AI Service 审计事件写入失败: {error}");
        }
    }

    pub fn finish_run(
        &self,
        run: &AuditRun,
        status: AuditStatus,
        error: Option<&str>,
        usage: TokenUsage,
    ) {
        if self.db_path.is_none() {
            return;
        }
        let result = (|| -> rusqlite::Result<()> {
            let connection = open_connection(&run.db_path)?;
            connection.execute(
                "UPDATE ai_service_audit_runs
                 SET status = ?1, finished_at = ?2, elapsed_ms = ?3, loop_count = ?4,
                   input_tokens = ?5, output_tokens = ?6, total_tokens = ?7, error_summary = ?8
                 WHERE id = ?9",
                params![
                    status.as_str(),
                    unix_timestamp().unwrap_or_default(),
                    run.started.elapsed().as_millis() as i64,
                    run.loop_count.load(Ordering::Relaxed) as i64,
                    usage.input_tokens.map(|value| value as i64),
                    usage.output_tokens.map(|value| value as i64),
                    usage.total_tokens.map(|value| value as i64),
                    error.map(redact_summary),
                    run.id,
                ],
            )?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("AI Service 审计结束写入失败: {error}");
        }
    }
}

pub(crate) fn initialize_tables(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_service_audit_runs (
             id TEXT PRIMARY KEY,
             service TEXT NOT NULL,
             status TEXT NOT NULL,
             started_at INTEGER NOT NULL,
             finished_at INTEGER NULL,
             elapsed_ms INTEGER NULL,
             loop_count INTEGER NOT NULL DEFAULT 0,
             input_tokens INTEGER NULL,
             output_tokens INTEGER NULL,
             total_tokens INTEGER NULL,
             error_summary TEXT NULL
         );
         CREATE TABLE IF NOT EXISTS ai_service_audit_events (
             run_id TEXT NOT NULL,
             sequence INTEGER NOT NULL,
             event_type TEXT NOT NULL,
             name TEXT NOT NULL,
             elapsed_ms INTEGER NOT NULL,
             input_tokens INTEGER NULL,
             output_tokens INTEGER NULL,
             total_tokens INTEGER NULL,
             summary TEXT NULL,
             PRIMARY KEY (run_id, sequence)
         );",
    )
}

pub(crate) fn load_run(
    connection: &Connection,
    id: &str,
) -> rusqlite::Result<Option<AuditRunDetail>> {
    let run = connection
        .query_row(
            "SELECT id, service, status, started_at, finished_at, elapsed_ms, loop_count,
             input_tokens, output_tokens, total_tokens, error_summary
             FROM ai_service_audit_runs WHERE id = ?1",
            [id],
            run_from_row,
        )
        .optional()?;
    let Some(run) = run else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT sequence, event_type, name, elapsed_ms, input_tokens, output_tokens,
         total_tokens, summary FROM ai_service_audit_events WHERE run_id = ?1 ORDER BY sequence",
    )?;
    let events = statement
        .query_map([id], event_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(AuditRunDetail { run, events }))
}

pub(crate) fn list_runs(connection: &Connection) -> rusqlite::Result<Vec<AuditRunSummary>> {
    let mut statement = connection.prepare(
        "SELECT id, service, status, started_at, finished_at, elapsed_ms, loop_count,
         input_tokens, output_tokens, total_tokens, error_summary
         FROM ai_service_audit_runs ORDER BY started_at DESC",
    )?;
    let runs = statement
        .query_map([], run_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(runs)
}

fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    }
    let connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
    initialize_tables(&connection)?;
    Ok(connection)
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditRunSummary> {
    Ok(AuditRunSummary {
        id: row.get(0)?,
        service: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        finished_at: row.get(4)?,
        elapsed_ms: row.get::<_, Option<i64>>(5)?.map(|value| value as u128),
        loop_count: row.get::<_, i64>(6)? as u32,
        usage: TokenUsage {
            input_tokens: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
            output_tokens: row.get::<_, Option<i64>>(8)?.map(|value| value as u64),
            total_tokens: row.get::<_, Option<i64>>(9)?.map(|value| value as u64),
        },
        error_summary: row.get(10)?,
    })
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditEvent> {
    Ok(AuditEvent {
        sequence: row.get::<_, i64>(0)? as u32,
        event_type: row.get(1)?,
        name: row.get(2)?,
        elapsed_ms: row.get::<_, i64>(3)? as u128,
        usage: TokenUsage {
            input_tokens: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
            output_tokens: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
            total_tokens: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        },
        summary: row.get(7)?,
    })
}

fn unix_timestamp() -> Result<i64, std::time::SystemTimeError> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64)
}

pub fn redact_summary(value: &str) -> String {
    let mut result = String::new();
    let mut redact_next = false;
    for token in value.split_whitespace() {
        if !result.is_empty() {
            result.push(' ');
        }
        if redact_next || token.contains("sk-") {
            result.push_str("***");
            redact_next = false;
        } else {
            result.push_str(token);
            redact_next = token.eq_ignore_ascii_case("bearer");
        }
        if result.chars().count() >= 240 {
            result = result.chars().take(240).collect();
            result.push_str("...（已截断）");
            break;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 关闭审计不创建数据库且启用时只保存脱敏元数据() {
        let root = std::env::temp_dir().join(format!("aidea-audit-{}", uuid::Uuid::new_v4()));
        let database = root.join("app.db");
        let disabled = AuditRecorder::new(false, database.clone());
        assert!(disabled.start_run("agent").is_none());
        assert!(!database.exists());

        let enabled = AuditRecorder::new(true, database.clone());
        let run = enabled.start_run("agent").unwrap();
        enabled.record_event(
            &run,
            "tool",
            "read_file",
            12,
            None,
            "read file Bearer secret sk-top-secret",
        );
        enabled.finish_run(&run, AuditStatus::Succeeded, None, TokenUsage::default());
        let connection = open_connection(&database).unwrap();
        let detail = load_run(&connection, &run.id).unwrap().unwrap();
        assert_eq!(detail.events.len(), 2);
        assert!(!serde_json::to_string(&detail).unwrap().contains("secret"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 摘要限制长度并替换常见凭据() {
        assert_eq!(redact_summary("Bearer abc sk-secret"), "Bearer *** ***");
        assert!(redact_summary(&"x ".repeat(500)).contains("已截断"));
    }
}
