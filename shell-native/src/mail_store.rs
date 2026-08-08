use crate::config::ensure_data_dirs;
use crate::error::AppResult;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const INITIAL_MIGRATION: &str = include_str!("../migrations/mail-manager/001_initial.sql");
const ACCOUNT_FOLDERS_MIGRATION: &str =
    include_str!("../migrations/mail-manager/002_account_folders.sql");
const DEFAULT_MESSAGE_PAGE_SIZE: i64 = 30;
const MAX_MESSAGE_PAGE_SIZE: i64 = 200;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct MessageQuery {
    pub account_id: Option<String>,
    pub folder_kind: Option<String>,
    pub read_state: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailMessageSummary {
    pub id: i64,
    pub account_id: String,
    pub folder_id: i64,
    pub folder_kind: String,
    pub sender_name: Option<String>,
    pub sender_address: String,
    pub subject: String,
    pub received_at: i64,
    pub is_read: bool,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailMessagePage {
    pub items: Vec<MailMessageSummary>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailAccountCounts {
    pub inbox_total: i64,
    pub unread_total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailMessageDetail {
    pub id: i64,
    pub account_id: String,
    pub folder_id: i64,
    pub remote_uid: i64,
    pub sender_name: Option<String>,
    pub sender_address: String,
    pub subject: String,
    pub received_at: i64,
    pub is_read: bool,
    pub text_body: Option<String>,
    pub sanitized_html: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MailAccountRecord {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub provider: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub tls_mode: String,
    pub username: String,
    pub auth_kind: String,
    pub keychain_id: String,
    pub webmail_url: String,
    pub inbox_folder: String,
    pub trash_folder: Option<String>,
    pub spam_folder: Option<String>,
    pub deleted_folder: Option<String>,
    pub enabled: bool,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MailFolderInput {
    pub account_id: String,
    pub remote_name: String,
    pub folder_kind: String,
}

#[derive(Debug, Clone)]
pub struct MailMessageInput {
    pub folder_id: i64,
    pub remote_uid: i64,
    pub sender_name: Option<String>,
    pub sender_address: String,
    pub subject: String,
    pub received_at: i64,
    pub is_read: bool,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MailFolder {
    pub id: i64,
    pub account_id: String,
    pub remote_name: String,
    pub folder_kind: String,
    pub uid_validity: Option<i64>,
    pub last_uid: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct FolderSync {
    pub folder: MailFolderInput,
    pub uid_validity: Option<i64>,
    pub last_uid: Option<i64>,
    pub messages: Vec<MailMessageInput>,
    pub cutoff: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MailSyncTask {
    pub id: String,
    pub account_id: String,
    pub kind: String,
    pub phase: String,
    pub processed: i64,
    pub total: Option<i64>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

pub struct MailStore {
    database_path: PathBuf,
}

impl MailStore {
    pub fn open() -> AppResult<Self> {
        let database_path = ensure_data_dirs()?.join("databases/mail-manager.db");
        let mut connection = Connection::open(&database_path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        )?;
        run_migrations(&mut connection)?;
        Ok(Self { database_path })
    }

    pub fn database_path(&self) -> &PathBuf {
        &self.database_path
    }

    pub fn list_messages(&self, query: MessageQuery) -> AppResult<MailMessagePage> {
        let connection = self.connection()?;
        let MessageQuery {
            account_id,
            folder_kind,
            read_state,
            search,
            limit,
            offset,
        } = query;
        let search = search
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("%{}%", value.trim()));
        let total = connection.query_row(
            "SELECT COUNT(*) FROM mail_messages m JOIN mail_folders f ON f.id = m.folder_id
             WHERE (?1 IS NULL OR m.account_id = ?1)
               AND (?2 IS NULL OR f.folder_kind = ?2)
               AND (?3 IS NULL OR ?3 = 'all' OR (?3 = 'read' AND m.is_read = 1) OR (?3 = 'unread' AND m.is_read = 0))
               AND (?4 IS NULL OR COALESCE(m.sender_name, '') LIKE ?4
                    OR m.sender_address LIKE ?4
                    OR m.subject LIKE ?4
                    OR COALESCE(m.snippet, '') LIKE ?4)",
            rusqlite::params![&account_id, &folder_kind, &read_state, &search],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(
            "SELECT m.id, m.account_id, m.folder_id, f.folder_kind, m.sender_name, m.sender_address, m.subject, m.received_at,
                    m.is_read, m.snippet
             FROM mail_messages m JOIN mail_folders f ON f.id = m.folder_id
             WHERE (?1 IS NULL OR m.account_id = ?1)
               AND (?2 IS NULL OR f.folder_kind = ?2)
               AND (?3 IS NULL OR ?3 = 'all' OR (?3 = 'read' AND m.is_read = 1) OR (?3 = 'unread' AND m.is_read = 0))
               AND (?4 IS NULL OR COALESCE(m.sender_name, '') LIKE ?4
                    OR m.sender_address LIKE ?4
                    OR m.subject LIKE ?4
                    OR COALESCE(m.snippet, '') LIKE ?4)
             ORDER BY m.received_at DESC
             LIMIT ?5 OFFSET ?6",
        )?;
        // 列表页固定上限，避免历史邮件数量增长后阻塞前端主线程。
        let limit = limit
            .unwrap_or(DEFAULT_MESSAGE_PAGE_SIZE)
            .clamp(1, MAX_MESSAGE_PAGE_SIZE);
        let offset = offset.unwrap_or(0).max(0);
        let items = statement
            .query_map(
                rusqlite::params![account_id, folder_kind, read_state, search, limit, offset],
                |row| {
                    Ok(MailMessageSummary {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        folder_id: row.get(2)?,
                        folder_kind: row.get(3)?,
                        sender_name: row.get(4)?,
                        sender_address: row.get(5)?,
                        subject: row.get(6)?,
                        received_at: row.get(7)?,
                        is_read: row.get::<_, i64>(8)? != 0,
                        snippet: row.get(9)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(MailMessagePage { items, total })
    }

    pub fn save_account(&self, account: MailAccountRecord) -> AppResult<()> {
        let connection = self.connection()?;
        let now = unix_seconds()?;
        connection.execute(
            "INSERT INTO mail_accounts (id, display_name, email, provider, imap_host, imap_port, tls_mode, username, auth_kind, keychain_id, webmail_url, inbox_folder, trash_folder, spam_folder, deleted_folder, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)
             ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email, provider = excluded.provider, imap_host = excluded.imap_host, imap_port = excluded.imap_port, tls_mode = excluded.tls_mode, username = excluded.username, auth_kind = excluded.auth_kind, keychain_id = excluded.keychain_id, webmail_url = excluded.webmail_url, inbox_folder = excluded.inbox_folder, trash_folder = excluded.trash_folder, spam_folder = excluded.spam_folder, deleted_folder = excluded.deleted_folder, enabled = excluded.enabled, updated_at = excluded.updated_at",
            rusqlite::params![account.id, account.display_name, account.email, account.provider, account.imap_host, account.imap_port, account.tls_mode, account.username, account.auth_kind, account.keychain_id, account.webmail_url, account.inbox_folder, account.trash_folder, account.spam_folder, account.deleted_folder, account.enabled as i64, now],
        )?;
        Ok(())
    }

    pub fn list_accounts(&self) -> AppResult<Vec<MailAccountRecord>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, display_name, email, provider, imap_host, imap_port, tls_mode, username,
                    auth_kind, keychain_id, webmail_url, inbox_folder, trash_folder, spam_folder, deleted_folder, enabled, last_sync_at, last_error
             FROM mail_accounts
             ORDER BY created_at ASC",
        )?;
        let accounts = statement
            .query_map([], account_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(accounts)
    }

    pub fn list_enabled_accounts(&self) -> AppResult<Vec<MailAccountRecord>> {
        Ok(self
            .list_accounts()?
            .into_iter()
            .filter(|account| account.enabled)
            .collect())
    }

    pub fn account_counts(&self, account_id: &str) -> AppResult<MailAccountCounts> {
        self.connection()?
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0)
             FROM mail_messages m JOIN mail_folders f ON f.id = m.folder_id
             WHERE m.account_id = ?1 AND f.folder_kind = 'inbox'",
                [account_id],
                |row| {
                    Ok(MailAccountCounts {
                        inbox_total: row.get(0)?,
                        unread_total: row.get(1)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn folder(&self, account_id: &str, remote_name: &str) -> AppResult<Option<MailFolder>> {
        let connection = self.connection()?;
        Ok(connection.query_row(
            "SELECT id, account_id, remote_name, folder_kind, uid_validity, last_uid FROM mail_folders WHERE account_id = ?1 AND remote_name = ?2",
            rusqlite::params![account_id, remote_name],
            |row| Ok(MailFolder { id: row.get(0)?, account_id: row.get(1)?, remote_name: row.get(2)?, folder_kind: row.get(3)?, uid_validity: row.get(4)?, last_uid: row.get(5)? }),
        ).optional()?)
    }

    pub fn set_account_sync_success(&self, id: &str, timestamp: i64) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_accounts SET last_sync_at = ?2, last_error = NULL, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, timestamp],
        )?;
        Ok(())
    }

    pub fn set_account_sync_error(&self, id: &str, message: &str) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_accounts SET last_error = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, message, unix_seconds()?],
        )?;
        Ok(())
    }

    pub fn account(&self, id: &str) -> AppResult<Option<MailAccountRecord>> {
        let connection = self.connection()?;
        Ok(connection
            .query_row(
                "SELECT id, display_name, email, provider, imap_host, imap_port, tls_mode, username,
                        auth_kind, keychain_id, webmail_url, inbox_folder, trash_folder, spam_folder, deleted_folder, enabled, last_sync_at, last_error
                 FROM mail_accounts WHERE id = ?1",
                [id],
                account_from_row,
            )
            .optional()?)
    }

    pub fn delete_account(&self, id: &str) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM mail_accounts WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn begin_sync_task(&self, account_id: &str, kind: &str, phase: &str) -> AppResult<String> {
        let id = Uuid::new_v4().to_string();
        self.connection()?.execute(
            "INSERT INTO mail_sync_tasks (id, account_id, kind, phase, started_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, account_id, kind, phase, unix_seconds()?],
        )?;
        Ok(id)
    }

    pub fn update_sync_task(
        &self,
        id: &str,
        phase: &str,
        processed: i64,
        total: Option<i64>,
    ) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_sync_tasks SET phase = ?2, processed = ?3, total = ?4 WHERE id = ?1",
            rusqlite::params![id, phase, processed, total],
        )?;
        Ok(())
    }

    pub fn finish_sync_task(&self, id: &str, phase: &str, error: Option<&str>) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_sync_tasks SET phase = ?2, finished_at = ?3, error = ?4 WHERE id = ?1",
            rusqlite::params![id, phase, unix_seconds()?, error],
        )?;
        Ok(())
    }

    pub fn list_sync_tasks(&self) -> AppResult<Vec<MailSyncTask>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, account_id, kind, phase, processed, total, started_at, finished_at, error
             FROM mail_sync_tasks ORDER BY started_at DESC",
        )?;
        let tasks = statement
            .query_map([], |row| {
                Ok(MailSyncTask {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    kind: row.get(2)?,
                    phase: row.get(3)?,
                    processed: row.get(4)?,
                    total: row.get(5)?,
                    started_at: row.get(6)?,
                    finished_at: row.get(7)?,
                    error: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn upsert_folder(&self, folder: MailFolderInput) -> AppResult<i64> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO mail_folders (account_id, remote_name, folder_kind) VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id, remote_name) DO UPDATE SET folder_kind = excluded.folder_kind",
            rusqlite::params![folder.account_id, folder.remote_name, folder.folder_kind],
        )?;
        Ok(connection.query_row(
            "SELECT id FROM mail_folders WHERE account_id = ?1 AND remote_name = ?2",
            rusqlite::params![folder.account_id, folder.remote_name],
            |row| row.get(0),
        )?)
    }

    pub fn upsert_message(&self, message: MailMessageInput) -> AppResult<()> {
        let connection = self.connection()?;
        let account_id: String = connection.query_row(
            "SELECT account_id FROM mail_folders WHERE id = ?1",
            [message.folder_id],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO mail_messages (account_id, folder_id, remote_uid, sender_name, sender_address, subject, received_at, is_read, snippet, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?7)
             ON CONFLICT(folder_id, remote_uid) DO UPDATE SET sender_name = excluded.sender_name, sender_address = excluded.sender_address, subject = excluded.subject, received_at = excluded.received_at, is_read = excluded.is_read, snippet = excluded.snippet, synced_at = excluded.synced_at",
            rusqlite::params![account_id, message.folder_id, message.remote_uid, message.sender_name, message.sender_address, message.subject, message.received_at, message.is_read as i64, message.snippet],
        )?;
        Ok(())
    }

    pub fn delete_messages_before(&self, folder_id: i64, cutoff: i64) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM mail_messages WHERE folder_id = ?1 AND received_at < ?2",
            rusqlite::params![folder_id, cutoff],
        )?;
        Ok(())
    }

    pub fn message_detail(&self, id: i64) -> AppResult<Option<MailMessageDetail>> {
        let connection = self.connection()?;
        Ok(connection.query_row(
            "SELECT m.id, m.account_id, m.folder_id, m.remote_uid, m.sender_name, m.sender_address, m.subject, m.received_at, m.is_read, b.text_body, b.sanitized_html FROM mail_messages m LEFT JOIN mail_bodies b ON b.mail_message_id = m.id WHERE m.id = ?1",
            [id],
            |row| Ok(MailMessageDetail { id: row.get(0)?, account_id: row.get(1)?, folder_id: row.get(2)?, remote_uid: row.get(3)?, sender_name: row.get(4)?, sender_address: row.get(5)?, subject: row.get(6)?, received_at: row.get(7)?, is_read: row.get::<_, i64>(8)? != 0, text_body: row.get(9)?, sanitized_html: row.get(10)? }),
        ).optional()?)
    }

    pub fn save_body(
        &self,
        message_id: i64,
        text_body: Option<&str>,
        sanitized_html: &str,
    ) -> AppResult<()> {
        self.connection()?.execute(
            "INSERT INTO mail_bodies (mail_message_id, text_body, sanitized_html, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(mail_message_id) DO UPDATE SET text_body = excluded.text_body, sanitized_html = excluded.sanitized_html, updated_at = excluded.updated_at",
            rusqlite::params![message_id, text_body, sanitized_html, unix_seconds()?],
        )?;
        Ok(())
    }

    pub fn mark_message_read_local(&self, message_id: i64) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_messages SET is_read = 1 WHERE id = ?1",
            [message_id],
        )?;
        Ok(())
    }

    pub fn mark_message_unread_local(&self, message_id: i64) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_messages SET is_read = 0 WHERE id = ?1",
            [message_id],
        )?;
        Ok(())
    }

    pub fn move_message_to_folder(&self, message_id: i64, folder_id: i64) -> AppResult<()> {
        self.connection()?.execute(
            "UPDATE mail_messages SET folder_id = ?2 WHERE id = ?1",
            rusqlite::params![message_id, folder_id],
        )?;
        Ok(())
    }

    pub fn folder_remote_name(&self, folder_id: i64) -> AppResult<Option<String>> {
        Ok(self
            .connection()?
            .query_row(
                "SELECT remote_name FROM mail_folders WHERE id = ?1",
                [folder_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn finish_folder_sync(
        &self,
        folder_id: i64,
        uid_validity: Option<i64>,
        last_uid: Option<i64>,
        cutoff: i64,
    ) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE mail_folders SET uid_validity = ?2, last_uid = ?3, last_synced_at = ?4 WHERE id = ?1",
            rusqlite::params![folder_id, uid_validity, last_uid, unix_seconds()?],
        )?;
        transaction.execute(
            "DELETE FROM mail_messages WHERE folder_id = ?1 AND received_at < ?2",
            rusqlite::params![folder_id, cutoff],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn apply_folder_sync(&self, sync: FolderSync) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO mail_folders (account_id, remote_name, folder_kind) VALUES (?1, ?2, ?3) ON CONFLICT(account_id, remote_name) DO UPDATE SET folder_kind = excluded.folder_kind",
            rusqlite::params![sync.folder.account_id, sync.folder.remote_name, sync.folder.folder_kind],
        )?;
        let folder_id: i64 = transaction.query_row(
            "SELECT id FROM mail_folders WHERE account_id = ?1 AND remote_name = ?2",
            rusqlite::params![sync.folder.account_id, sync.folder.remote_name],
            |row| row.get(0),
        )?;
        for message in sync.messages {
            transaction.execute(
                "INSERT INTO mail_messages (account_id, folder_id, remote_uid, sender_name, sender_address, subject, received_at, is_read, snippet, synced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?7) ON CONFLICT(folder_id, remote_uid) DO UPDATE SET sender_name = excluded.sender_name, sender_address = excluded.sender_address, subject = excluded.subject, received_at = excluded.received_at, is_read = excluded.is_read, snippet = excluded.snippet, synced_at = excluded.synced_at",
                rusqlite::params![sync.folder.account_id, folder_id, message.remote_uid, message.sender_name, message.sender_address, message.subject, message.received_at, message.is_read as i64, message.snippet],
            )?;
        }
        transaction.execute(
            "UPDATE mail_folders SET uid_validity = ?2, last_uid = ?3, last_synced_at = ?4 WHERE id = ?1",
            rusqlite::params![folder_id, sync.uid_validity, sync.last_uid, unix_seconds()?],
        )?;
        transaction.execute(
            "DELETE FROM mail_messages WHERE folder_id = ?1 AND received_at < ?2",
            rusqlite::params![folder_id, sync.cutoff],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn connection(&self) -> AppResult<Connection> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        Ok(connection)
    }
}

fn account_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailAccountRecord> {
    Ok(MailAccountRecord {
        id: row.get(0)?,
        display_name: row.get(1)?,
        email: row.get(2)?,
        provider: row.get(3)?,
        imap_host: row.get(4)?,
        imap_port: row.get(5)?,
        tls_mode: row.get(6)?,
        username: row.get(7)?,
        auth_kind: row.get(8)?,
        keychain_id: row.get(9)?,
        webmail_url: row.get(10)?,
        inbox_folder: row.get(11)?,
        trash_folder: row.get(12)?,
        spam_folder: row.get(13)?,
        deleted_folder: row.get(14)?,
        enabled: row.get::<_, i64>(15)? != 0,
        last_sync_at: row.get(16)?,
        last_error: row.get(17)?,
    })
}

fn run_migrations(connection: &mut Connection) -> AppResult<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )?;
    for (version, sql) in [
        (1, INITIAL_MIGRATION),
        (2, ACCOUNT_FOLDERS_MIGRATION),
        (
            3,
            include_str!("../migrations/mail-manager/003_mail_center_v2.sql"),
        ),
    ] {
        let exists = connection
            .query_row(
                "SELECT 1 FROM _migrations WHERE version = ?1",
                [version],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if exists {
            continue;
        }

        let transaction = connection.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.execute(
            "INSERT INTO _migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, unix_seconds()?],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn unix_seconds() -> AppResult<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| crate::error::AppError::Config(error.to_string()))?
        .as_secs() as i64)
}
