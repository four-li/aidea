use crate::error::{AppError, AppResult};
use crate::mail_store::{
    MailAccountRecord, MailMessageDetail, MailMessagePage, MailStore, MessageQuery,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SaveMailAccountRequest {
    pub id: Option<String>,
    pub display_name: String,
    pub email: String,
    pub provider: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub tls_mode: String,
    pub username: String,
    pub auth_kind: String,
    pub secret: String,
    pub webmail_url: String,
    pub inbox_folder: String,
    pub trash_folder: Option<String>,
    pub spam_folder: Option<String>,
    pub deleted_folder: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MailAccount {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub provider: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub tls_mode: String,
    pub username: String,
    pub auth_kind: String,
    pub webmail_url: String,
    pub inbox_folder: String,
    pub trash_folder: Option<String>,
    pub spam_folder: Option<String>,
    pub deleted_folder: Option<String>,
    pub enabled: bool,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub inbox_total: i64,
    pub unread_total: i64,
}

pub fn validate_account_request(request: &SaveMailAccountRequest) -> AppResult<()> {
    if request.display_name.trim().is_empty()
        || request.email.trim().is_empty()
        || request.imap_host.trim().is_empty()
        || (request.secret.is_empty() && request.id.is_none())
        || request.inbox_folder.trim().is_empty()
    {
        return Err(AppError::Config("邮件账户必填字段不能为空".into()));
    }
    if !(1..=65535).contains(&request.imap_port) {
        return Err(AppError::Config("IMAP 端口必须在 1 到 65535 之间".into()));
    }
    validate_webmail_url(&request.webmail_url)
}

pub fn validate_connection_request(request: &SaveMailAccountRequest) -> AppResult<()> {
    if request.imap_host.trim().is_empty()
        || request.email.trim().is_empty()
        || request.secret.is_empty()
    {
        return Err(AppError::Config("IMAP 连接测试必填字段不能为空".into()));
    }
    if !(1..=65535).contains(&request.imap_port) {
        return Err(AppError::Config("IMAP 端口必须在 1 到 65535 之间".into()));
    }
    if request.tls_mode != "tls" {
        return Err(AppError::Config("第一阶段仅支持 TLS IMAP".into()));
    }
    Ok(())
}

pub fn validate_webmail_url(value: &str) -> AppResult<()> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| AppError::Config(format!("网页邮箱地址无效: {}", error)))?;
    if matches!(url.scheme(), "http" | "https") {
        Ok(())
    } else {
        Err(AppError::Config("网页邮箱地址仅支持 HTTP(S)".into()))
    }
}

#[tauri::command]
pub async fn save_mail_account(request: SaveMailAccountRequest) -> AppResult<MailAccount> {
    validate_account_request(&request)?;
    let id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let store = MailStore::open()?;
    let secret = if request.secret.is_empty() {
        store
            .account(&id)?
            .map(|account| account.secret)
            .ok_or_else(|| AppError::Config("新建邮件账户必须填写密码或授权码".into()))?
    } else {
        request.secret
    };
    let username = if request.username.trim().is_empty() {
        request.email.clone()
    } else {
        request.username
    };
    let account = MailAccountRecord {
        id: id.clone(),
        display_name: request.display_name,
        email: request.email,
        provider: request.provider,
        imap_host: request.imap_host,
        imap_port: request.imap_port,
        tls_mode: request.tls_mode,
        username,
        auth_kind: request.auth_kind,
        secret,
        webmail_url: request.webmail_url,
        inbox_folder: request.inbox_folder,
        trash_folder: request
            .trash_folder
            .clone()
            .filter(|folder| !folder.trim().is_empty()),
        spam_folder: request
            .spam_folder
            .filter(|folder| !folder.trim().is_empty()),
        deleted_folder: request
            .deleted_folder
            .or_else(|| request.trash_folder.clone())
            .filter(|folder| !folder.trim().is_empty()),
        enabled: true,
        last_sync_at: None,
        last_error: None,
    };
    store.save_account(account.clone())?;
    Ok(account.into())
}

#[tauri::command]
pub fn load_mail_account_secret(id: String) -> AppResult<String> {
    let account = MailStore::open()?
        .account(&id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    Ok(account.secret)
}

#[tauri::command]
pub async fn test_mail_account_connection(request: SaveMailAccountRequest) -> AppResult<()> {
    validate_connection_request(&request)?;
    let username = if request.username.trim().is_empty() {
        request.email.as_str()
    } else {
        request.username.as_str()
    };
    let mut session = crate::mail_sync::login_with_credentials(
        &request.imap_host,
        request.imap_port,
        &request.tls_mode,
        username,
        &request.secret,
    )?;
    session
        .logout()
        .map_err(|error| AppError::Network(format!("退出 IMAP 测试连接失败: {error}")))
}

#[tauri::command]
pub async fn list_mail_accounts() -> AppResult<Vec<MailAccount>> {
    let store = MailStore::open()?;
    store
        .list_accounts()?
        .into_iter()
        .map(|account| {
            let counts = store.account_counts(&account.id)?;
            Ok(MailAccount::from_record(
                account,
                counts.inbox_total,
                counts.unread_total,
            ))
        })
        .collect()
}

#[tauri::command]
pub async fn delete_mail_account(id: String) -> AppResult<()> {
    let store = MailStore::open()?;
    store.delete_account(&id)?;
    Ok(())
}

#[tauri::command]
pub async fn sync_mail_accounts(app: tauri::AppHandle) -> AppResult<crate::mail_sync::SyncResult> {
    crate::mail_sync::sync_accounts_with_progress(app).await
}

#[derive(Debug, serde::Deserialize)]
pub struct MailHistoryRequest {
    pub since: i64,
    pub until: Option<i64>,
}

#[tauri::command]
pub async fn sync_mail_history(
    app: tauri::AppHandle,
    request: MailHistoryRequest,
) -> AppResult<crate::mail_sync::SyncResult> {
    crate::mail_sync::sync_history(
        app,
        crate::mail_sync::SyncWindow {
            since: Some(request.since),
            until: request.until,
        },
    )
    .await
}

#[tauri::command]
pub fn cancel_mail_sync() {
    crate::mail_sync::cancel_sync();
}

#[tauri::command]
pub async fn list_mail_sync_tasks() -> AppResult<Vec<crate::mail_store::MailSyncTask>> {
    MailStore::open()?.list_sync_tasks()
}

#[tauri::command]
pub async fn list_mail_messages(query: MessageQuery) -> AppResult<MailMessagePage> {
    MailStore::open()?.list_messages(query)
}

#[tauri::command]
pub async fn get_mail_message(id: i64) -> AppResult<MailMessageDetail> {
    crate::mail_sync::load_message(id).await
}

#[tauri::command]
pub async fn mark_mail_read(id: i64) -> AppResult<()> {
    crate::mail_sync::mark_message_read(id).await
}

#[tauri::command]
pub async fn mark_mail_unread(id: i64) -> AppResult<()> {
    crate::mail_sync::mark_message_unread(id).await
}

#[tauri::command]
pub async fn move_mail_to_deleted(id: i64) -> AppResult<()> {
    crate::mail_sync::move_message_to_deleted(id).await
}

#[tauri::command]
pub async fn open_mail_webmail(account_id: String) -> AppResult<()> {
    let account = MailStore::open()?
        .account(&account_id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    validate_webmail_url(&account.webmail_url)?;
    std::process::Command::new("/usr/bin/open")
        .arg(&account.webmail_url)
        .spawn()
        .map_err(|error| AppError::Process(format!("打开网页邮箱失败: {}", error)))?;
    Ok(())
}

impl From<MailAccountRecord> for MailAccount {
    fn from(account: MailAccountRecord) -> Self {
        Self::from_record(account, 0, 0)
    }
}

impl MailAccount {
    fn from_record(account: MailAccountRecord, inbox_total: i64, unread_total: i64) -> Self {
        Self {
            id: account.id,
            display_name: account.display_name,
            email: account.email,
            provider: account.provider,
            imap_host: account.imap_host,
            imap_port: account.imap_port,
            tls_mode: account.tls_mode,
            username: account.username,
            auth_kind: account.auth_kind,
            webmail_url: account.webmail_url,
            inbox_folder: account.inbox_folder,
            trash_folder: account.trash_folder,
            spam_folder: account.spam_folder,
            deleted_folder: account.deleted_folder,
            enabled: account.enabled,
            last_sync_at: account.last_sync_at,
            last_error: account.last_error,
            inbox_total,
            unread_total,
        }
    }
}
