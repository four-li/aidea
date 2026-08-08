use crate::error::{AppError, AppResult};
use crate::mail_keychain;
use crate::mail_store::{
    FolderSync, MailAccountRecord, MailFolderInput, MailMessageInput, MailStore,
};
use chrono::{Duration, Utc};
use imap::types::NameAttribute;
use mailparse::MailHeaderMap;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const METADATA_FETCH_QUERY: &str = "(UID FLAGS BODY.PEEK[HEADER] INTERNALDATE)";
pub const FULL_MESSAGE_FETCH_QUERY: &str = "(UID BODY.PEEK[])";
const FETCH_BATCH_SIZE: usize = 50;
static CANCEL_SYNC: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
mod folder_tests {
    use super::{choose_deleted_folder, special_use_kind_value};

    #[test]
    fn 唯一已删除目录才自动选择() {
        let names = vec!["INBOX".into(), "Deleted Messages".into(), "Junk".into()];
        assert_eq!(
            choose_deleted_folder(&names).unwrap(),
            Some("Deleted Messages".into())
        );
    }

    #[test]
    fn imap_trash特殊用途标记优先于目录名称() {
        assert_eq!(special_use_kind_value("\\Trash"), Some("deleted"));
        assert_eq!(special_use_kind_value("\\Junk"), Some("spam"));
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct SyncWindow {
    pub since: Option<i64>,
    pub until: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub accounts: Vec<SyncAccountResult>,
}

#[derive(Debug, Serialize)]
pub struct SyncAccountResult {
    pub account_id: String,
    pub synced: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncProgress {
    pub account_id: String,
    pub phase: String,
    pub processed: i64,
    pub total: Option<i64>,
    pub error: Option<String>,
}

pub async fn sync_accounts() -> AppResult<SyncResult> {
    tokio::task::spawn_blocking(sync_accounts_blocking)
        .await
        .map_err(|error| AppError::Mail(format!("邮件同步任务异常: {}", error)))?
}

pub async fn sync_accounts_with_progress(app: tauri::AppHandle) -> AppResult<SyncResult> {
    CANCEL_SYNC.store(false, Ordering::Relaxed);
    tokio::task::spawn_blocking(move || sync_accounts_blocking_with_progress(Some(app), None))
        .await
        .map_err(|error| AppError::Mail(format!("邮件同步任务异常: {}", error)))?
}

pub async fn sync_history(app: tauri::AppHandle, window: SyncWindow) -> AppResult<SyncResult> {
    CANCEL_SYNC.store(false, Ordering::Relaxed);
    tokio::task::spawn_blocking(move || {
        sync_accounts_blocking_with_progress(Some(app), Some(window))
    })
    .await
    .map_err(|error| AppError::Mail(format!("历史同步任务异常: {}", error)))?
}

pub fn cancel_sync() {
    CANCEL_SYNC.store(true, Ordering::Relaxed);
}

pub async fn load_message(message_id: i64) -> AppResult<crate::mail_store::MailMessageDetail> {
    tokio::task::spawn_blocking(move || load_message_blocking(message_id))
        .await
        .map_err(|error| AppError::Mail(format!("邮件正文读取任务异常: {}", error)))?
}

pub async fn mark_message_read(message_id: i64) -> AppResult<()> {
    tokio::task::spawn_blocking(move || mark_message_read_blocking(message_id))
        .await
        .map_err(|error| AppError::Mail(format!("邮件已读更新任务异常: {}", error)))?
}

pub async fn mark_message_unread(message_id: i64) -> AppResult<()> {
    tokio::task::spawn_blocking(move || mark_message_unread_blocking(message_id))
        .await
        .map_err(|error| AppError::Mail(format!("邮件未读更新任务异常: {}", error)))?
}

pub async fn move_message_to_deleted(message_id: i64) -> AppResult<()> {
    tokio::task::spawn_blocking(move || move_message_to_deleted_blocking(message_id))
        .await
        .map_err(|error| AppError::Mail(format!("邮件删除任务异常: {}", error)))?
}

/// 建立一次 IDLE 监听。返回时表示服务器已有变更并已完成对应文件夹的增量同步。
pub fn listen_folder_once(
    account: &MailAccountRecord,
    remote_name: &str,
    folder_kind: &str,
) -> AppResult<()> {
    let store = MailStore::open()?;
    let mut session = login(account)?;
    let result = (|| {
        let retention_days = if folder_kind == "inbox" { 90 } else { 30 };
        sync_folder(
            &store,
            &mut session,
            account,
            remote_name,
            folder_kind,
            retention_days,
            None,
            &None,
        )?;
        let mut idle = session
            .idle()
            .map_err(|error| AppError::Network(format!("启动 IDLE 监听失败: {error}")))?;
        idle.set_keepalive(crate::mail_runtime::idle_keepalive());
        idle.wait_keepalive()
            .map_err(|error| AppError::Network(format!("IDLE 监听中断: {error}")))?;
        sync_folder(
            &store,
            &mut session,
            account,
            remote_name,
            folder_kind,
            retention_days,
            None,
            &None,
        )
    })();
    let _ = session.logout();
    result
}

fn sync_accounts_blocking() -> AppResult<SyncResult> {
    sync_accounts_blocking_with_progress(None, None)
}

fn sync_accounts_blocking_with_progress(
    app: Option<tauri::AppHandle>,
    window: Option<SyncWindow>,
) -> AppResult<SyncResult> {
    let store = MailStore::open()?;
    let mut results = Vec::new();
    for account in store.list_enabled_accounts()? {
        if CANCEL_SYNC.load(Ordering::Relaxed) {
            break;
        }
        let task_id = store.begin_sync_task(&account.id, "incremental", "connect")?;
        emit_progress(
            &app,
            SyncProgress {
                account_id: account.id.clone(),
                phase: "connect".into(),
                processed: 0,
                total: None,
                error: None,
            },
        );
        match sync_account(&store, &account, window.as_ref(), &app) {
            Ok(()) => {
                store.finish_sync_task(&task_id, "completed", None)?;
                emit_progress(
                    &app,
                    SyncProgress {
                        account_id: account.id.clone(),
                        phase: "completed".into(),
                        processed: 0,
                        total: None,
                        error: None,
                    },
                );
                store.set_account_sync_success(&account.id, unix_seconds()?)?;
                results.push(SyncAccountResult {
                    account_id: account.id,
                    synced: true,
                    error: None,
                });
            }
            Err(error) => {
                let message = error.to_string();
                store.finish_sync_task(&task_id, "error", Some(&message))?;
                emit_progress(
                    &app,
                    SyncProgress {
                        account_id: account.id.clone(),
                        phase: "error".into(),
                        processed: 0,
                        total: None,
                        error: Some(message.clone()),
                    },
                );
                store.set_account_sync_error(&account.id, &message)?;
                results.push(SyncAccountResult {
                    account_id: account.id,
                    synced: false,
                    error: Some(message),
                });
            }
        }
    }
    Ok(SyncResult { accounts: results })
}

fn emit_progress(app: &Option<tauri::AppHandle>, progress: SyncProgress) {
    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit("mail-sync-progress", progress);
    }
}

fn sync_account(
    store: &MailStore,
    account: &MailAccountRecord,
    window: Option<&SyncWindow>,
    app: &Option<tauri::AppHandle>,
) -> AppResult<()> {
    if account.tls_mode != "tls" {
        return Err(AppError::Config("第一阶段仅支持 TLS IMAP".into()));
    }
    let secret = mail_keychain::load(&account.keychain_id)?;
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|error| AppError::Network(format!("创建 TLS 连接失败: {}", error)))?;
    let client = imap::connect(
        (account.imap_host.as_str(), account.imap_port as u16),
        account.imap_host.as_str(),
        &tls,
    )
    .map_err(|error| AppError::Network(format!("连接 IMAP 服务器失败: {}", error)))?;
    let mut session = client
        .login(&account.username, &secret)
        .map_err(|error| AppError::Network(format!("IMAP 登录失败: {}", error.0)))?;

    let result = (|| {
        sync_folder(
            store,
            &mut session,
            account,
            &account.inbox_folder,
            "inbox",
            90,
            window,
            app,
        )?;
        for (configured_name, folder_kind) in [
            (account.spam_folder.as_deref(), "spam"),
            (account.deleted_folder.as_deref(), "deleted"),
        ] {
            let discovered_name = configured_name.map(str::to_owned).or_else(|| {
                if folder_kind == "deleted" {
                    discover_deleted_folder(&mut session).ok().flatten()
                } else {
                    discover_folder(&mut session, folder_kind)
                }
            });
            if let Some(remote_name) = discovered_name.filter(|name| *name != account.inbox_folder)
            {
                sync_folder(
                    store,
                    &mut session,
                    account,
                    &remote_name,
                    folder_kind,
                    30,
                    window,
                    app,
                )?;
            }
        }
        Ok(())
    })();
    let _ = session.logout();
    result
}

fn discover_folder(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    folder_kind: &str,
) -> Option<String> {
    let names = session.list(None, Some("*")).ok()?;
    let keywords: &[&str] = match folder_kind {
        "spam" => &["spam", "junk", "垃圾", "广告"],
        "deleted" => &["trash", "deleted", "bin", "已删除", "删除"],
        _ => return None,
    };
    names
        .into_iter()
        .map(|name| name.name().to_owned())
        .find(|name| {
            let lower = name.to_lowercase();
            keywords.iter().any(|keyword| lower.contains(keyword))
        })
}

fn special_use_kind_value(value: &str) -> Option<&'static str> {
    match value.to_ascii_lowercase().as_str() {
        "\\trash" => Some("deleted"),
        "\\junk" | "\\spam" => Some("spam"),
        "\\inbox" => Some("inbox"),
        _ => None,
    }
}

fn special_use_kind(attributes: &[NameAttribute<'_>]) -> Option<&'static str> {
    attributes.iter().find_map(|attribute| match attribute {
        NameAttribute::Custom(value) => special_use_kind_value(value),
        _ => None,
    })
}

fn discover_deleted_folder(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
) -> AppResult<Option<String>> {
    let names = session
        .list(None, Some("*"))
        .map_err(|error| AppError::Network(format!("读取远程文件夹失败: {error}")))?;
    if let Some(name) = names
        .iter()
        .find(|name| special_use_kind(name.attributes()) == Some("deleted"))
    {
        return Ok(Some(name.name().to_owned()));
    }
    let names = names
        .into_iter()
        .map(|name| name.name().to_owned())
        .collect::<Vec<_>>();
    choose_deleted_folder(&names)
}

fn choose_deleted_folder(names: &[String]) -> AppResult<Option<String>> {
    let candidates: Vec<String> = names
        .iter()
        .filter(|name| {
            let lower = name.to_lowercase();
            ["trash", "deleted", "bin", "已删除", "删除"]
                .iter()
                .any(|keyword| lower.contains(keyword))
                && !["spam", "junk", "垃圾", "广告"]
                    .iter()
                    .any(|keyword| lower.contains(keyword))
        })
        .cloned()
        .collect();
    match candidates.as_slice() {
        [] => Ok(None),
        [name] => Ok(Some(name.clone())),
        _ => Err(AppError::Config(
            "检测到多个已删除远程文件夹，请在账户设置中明确选择".into(),
        )),
    }
}

fn load_message_blocking(message_id: i64) -> AppResult<crate::mail_store::MailMessageDetail> {
    let store = MailStore::open()?;
    let detail = store
        .message_detail(message_id)?
        .ok_or_else(|| AppError::Mail("邮件不存在".into()))?;
    if detail.sanitized_html.is_some() {
        return Ok(detail);
    }
    let account = store
        .account(&detail.account_id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    let remote_name = store
        .folder_remote_name(detail.folder_id)?
        .ok_or_else(|| AppError::Mail("邮件文件夹不存在".into()))?;
    let mut session = login(&account)?;
    let result = (|| {
        select_folder(&mut session, &remote_name)?;
        let fetches = session
            .uid_fetch(detail.remote_uid.to_string(), FULL_MESSAGE_FETCH_QUERY)
            .map_err(|error| AppError::Network(format!("读取邮件正文失败: {}", error)))?;
        let raw = fetches
            .first()
            .and_then(|fetch| fetch.body())
            .ok_or_else(|| AppError::Mail("服务器未返回邮件正文".into()))?;
        let parsed = parse_message(raw)?;
        store.save_body(
            message_id,
            parsed.text_body.as_deref(),
            &parsed.sanitized_html,
        )?;
        store
            .message_detail(message_id)?
            .ok_or_else(|| AppError::Mail("邮件缓存保存失败".into()))
    })();
    let _ = session.logout();
    result
}

fn mark_message_read_blocking(message_id: i64) -> AppResult<()> {
    let store = MailStore::open()?;
    let detail = store
        .message_detail(message_id)?
        .ok_or_else(|| AppError::Mail("邮件不存在".into()))?;
    if detail.is_read {
        return Ok(());
    }
    let account = store
        .account(&detail.account_id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    let remote_name = store
        .folder_remote_name(detail.folder_id)?
        .ok_or_else(|| AppError::Mail("邮件文件夹不存在".into()))?;
    let mut session = login(&account)?;
    let result = (|| {
        select_folder(&mut session, &remote_name)?;
        session
            .uid_store(detail.remote_uid.to_string(), "+FLAGS.SILENT (\\Seen)")
            .map_err(|error| AppError::Network(format!("标记已读失败: {}", error)))?;
        store.mark_message_read_local(message_id)
    })();
    let _ = session.logout();
    result
}

fn mark_message_unread_blocking(message_id: i64) -> AppResult<()> {
    update_remote_read_state(message_id, "-FLAGS.SILENT (\\Seen)", false)
}

fn update_remote_read_state(message_id: i64, command: &str, is_read: bool) -> AppResult<()> {
    let store = MailStore::open()?;
    let detail = store
        .message_detail(message_id)?
        .ok_or_else(|| AppError::Mail("邮件不存在".into()))?;
    if detail.is_read == is_read {
        return Ok(());
    }
    let account = store
        .account(&detail.account_id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    let remote_name = store
        .folder_remote_name(detail.folder_id)?
        .ok_or_else(|| AppError::Mail("邮件文件夹不存在".into()))?;
    let mut session = login(&account)?;
    let result = (|| {
        select_folder(&mut session, &remote_name)?;
        session
            .uid_store(detail.remote_uid.to_string(), command)
            .map_err(|error| AppError::Network(format!("更新已读状态失败: {}", error)))?;
        if is_read {
            store.mark_message_read_local(message_id)
        } else {
            store.mark_message_unread_local(message_id)
        }
    })();
    let _ = session.logout();
    result
}

fn move_message_to_deleted_blocking(message_id: i64) -> AppResult<()> {
    let store = MailStore::open()?;
    let detail = store
        .message_detail(message_id)?
        .ok_or_else(|| AppError::Mail("邮件不存在".into()))?;
    let mut account = store
        .account(&detail.account_id)?
        .ok_or_else(|| AppError::Mail("邮件账户不存在".into()))?;
    let source_name = store
        .folder_remote_name(detail.folder_id)?
        .ok_or_else(|| AppError::Mail("邮件文件夹不存在".into()))?;
    let mut session = login(&account)?;
    let result = (|| {
        let deleted_name = if let Some(name) = account.deleted_folder.clone() {
            name
        } else {
            let name = discover_deleted_folder(&mut session)?.ok_or_else(|| {
                AppError::Config(
                    "该账户未配置已删除远程文件夹，且未能自动识别；请在账户设置中填写远程目录"
                        .into(),
                )
            })?;
            account.deleted_folder = Some(name.clone());
            store.save_account(account.clone())?;
            name
        };
        if source_name == deleted_name {
            return Ok(());
        }
        select_folder(&mut session, &source_name)?;
        session
            .uid_mv(detail.remote_uid.to_string(), &deleted_name)
            .map_err(|error| AppError::Network(format!("移入已删除失败: {}", error)))?;
        let deleted_folder = store
            .folder(&account.id, &deleted_name)?
            .ok_or_else(|| AppError::Mail("已删除文件夹尚未同步，请先同步账户".into()))?;
        store.move_message_to_folder(message_id, deleted_folder.id)
    })();
    let _ = session.logout();
    result
}

fn login(
    account: &MailAccountRecord,
) -> AppResult<imap::Session<native_tls::TlsStream<std::net::TcpStream>>> {
    let secret = mail_keychain::load(&account.keychain_id)?;
    login_with_credentials(
        &account.imap_host,
        account.imap_port,
        &account.tls_mode,
        &account.username,
        &secret,
    )
}

pub fn login_with_credentials(
    imap_host: &str,
    imap_port: i64,
    tls_mode: &str,
    username: &str,
    secret: &str,
) -> AppResult<imap::Session<native_tls::TlsStream<std::net::TcpStream>>> {
    if tls_mode != "tls" {
        return Err(AppError::Config("第一阶段仅支持 TLS IMAP".into()));
    }
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|error| AppError::Network(format!("创建 TLS 连接失败: {}", error)))?;
    let client = imap::connect((imap_host, imap_port as u16), imap_host, &tls)
        .map_err(|error| AppError::Network(format!("连接 IMAP 服务器失败: {}", error)))?;
    client
        .login(username, secret)
        .map_err(|error| AppError::Network(format!("IMAP 登录失败: {}", error.0)))
}

fn sync_folder(
    store: &MailStore,
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    account: &MailAccountRecord,
    remote_name: &str,
    folder_kind: &str,
    retention_days: i64,
    window: Option<&SyncWindow>,
    app: &Option<tauri::AppHandle>,
) -> AppResult<()> {
    if CANCEL_SYNC.load(Ordering::Relaxed) {
        return Err(AppError::Mail("同步已取消".into()));
    }
    emit_progress(
        app,
        SyncProgress {
            account_id: account.id.clone(),
            phase: format!("select:{folder_kind}"),
            processed: 0,
            total: None,
            error: None,
        },
    );
    let mailbox = select_folder(session, remote_name)?;
    let previous = store.folder(&account.id, remote_name)?;
    let uid_validity = mailbox.uid_validity.map(i64::from);
    let cursor = previous
        .filter(|folder| folder.uid_validity == uid_validity)
        .and_then(|folder| folder.last_uid);
    let cutoff = window
        .and_then(|range| range.since)
        .unwrap_or(unix_seconds()? - retention_days * 24 * 60 * 60);
    let uids = if window.is_none() {
        if let Some(last_uid) = cursor {
            session.uid_search(format!("UID {}:*", last_uid + 1))
        } else {
            session.uid_search(search_query(window, retention_days))
        }
    } else {
        session.uid_search(search_query(window, retention_days))
    }
    .map_err(|error| AppError::Network(format!("搜索文件夹 {remote_name} 失败: {error}")))?;
    let max_uid = uids.iter().copied().max().map(i64::from).or(cursor);
    let total = uids.len() as i64;
    emit_progress(
        app,
        SyncProgress {
            account_id: account.id.clone(),
            phase: format!("fetch:{folder_kind}"),
            processed: 0,
            total: Some(total),
            error: None,
        },
    );
    let messages = fetch_messages(session, uids, |processed| {
        emit_progress(
            app,
            SyncProgress {
                account_id: account.id.clone(),
                phase: format!("fetch:{folder_kind}"),
                processed,
                total: Some(total),
                error: None,
            },
        );
    })?;
    emit_progress(
        app,
        SyncProgress {
            account_id: account.id.clone(),
            phase: format!("store:{folder_kind}"),
            processed: messages.len() as i64,
            total: Some(total),
            error: None,
        },
    );
    store.apply_folder_sync(FolderSync {
        folder: MailFolderInput {
            account_id: account.id.clone(),
            remote_name: remote_name.into(),
            folder_kind: folder_kind.into(),
        },
        uid_validity,
        last_uid: max_uid,
        messages,
        cutoff,
    })
}

fn search_query(window: Option<&SyncWindow>, retention_days: i64) -> String {
    let since = window
        .and_then(|range| range.since)
        .and_then(|timestamp| chrono::DateTime::<Utc>::from_timestamp(timestamp, 0))
        .unwrap_or_else(|| Utc::now() - Duration::days(retention_days));
    let mut query = format!("SINCE {}", since.format("%d-%b-%Y"));
    if let Some(until) = window
        .and_then(|range| range.until)
        .and_then(|timestamp| chrono::DateTime::<Utc>::from_timestamp(timestamp, 0))
    {
        query.push_str(&format!(" BEFORE {}", until.format("%d-%b-%Y")));
    }
    query
}

fn select_folder(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    remote_name: &str,
) -> AppResult<imap::types::Mailbox> {
    session.select(remote_name).map_err(|error| match error {
        // 腾讯会在 SELECT 后返回额外状态行；仅在解析失败时回显该响应，便于识别协议扩展。
        imap::error::Error::Parse(imap::error::ParseError::Invalid(response)) => {
            let response = String::from_utf8_lossy(&response)
                .replace(['\r', '\n'], " ")
                .chars()
                .take(500)
                .collect::<String>();
            AppError::Network(format!(
                "打开文件夹 {remote_name} 失败：服务器返回了未识别的 IMAP 状态：{response}"
            ))
        }
        error => AppError::Network(format!("打开文件夹 {remote_name} 失败: {error}")),
    })
}

fn fetch_messages(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    uids: HashSet<u32>,
    mut on_progress: impl FnMut(i64),
) -> AppResult<Vec<MailMessageInput>> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let mut uids = uids.into_iter().collect::<Vec<_>>();
    uids.sort_unstable();
    let mut messages = Vec::with_capacity(uids.len());
    for batch in uid_batches(&uids, FETCH_BATCH_SIZE) {
        let uid_set = batch
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(uid_set, METADATA_FETCH_QUERY)
            .map_err(|error| AppError::Network(format!("读取邮件元数据失败: {error}")))?;
        for fetch in fetches.iter() {
            let uid = fetch
                .uid
                .ok_or_else(|| AppError::Mail("服务器返回的邮件缺少 UID".into()))?;
            let raw = fetch
                .header()
                .ok_or_else(|| AppError::Mail(format!("邮件 {uid} 缺少头信息")))?;
            let parsed = parse_message(raw)?;
            messages.push(MailMessageInput {
                folder_id: 0,
                remote_uid: i64::from(uid),
                sender_name: None,
                sender_address: parsed.sender_address,
                subject: parsed.subject,
                received_at: fetch
                    .internal_date()
                    .map(|date| date.timestamp())
                    .unwrap_or(unix_seconds().unwrap_or(0)),
                is_read: fetch
                    .flags()
                    .iter()
                    .any(|flag| matches!(flag, imap::types::Flag::Seen)),
                snippet: None,
            });
        }
        on_progress(messages.len() as i64);
    }
    Ok(messages)
}

fn uid_batches(uids: &[u32], batch_size: usize) -> Vec<&[u32]> {
    uids.chunks(batch_size).collect()
}

fn unix_seconds() -> AppResult<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Config(error.to_string()))?
        .as_secs() as i64)
}

#[derive(Debug, Clone)]
pub struct ParsedMail {
    pub sender_address: String,
    pub subject: String,
    pub text_body: Option<String>,
    pub sanitized_html: String,
}

pub fn parse_message(raw: &[u8]) -> AppResult<ParsedMail> {
    let parsed = mailparse::parse_mail(raw)
        .map_err(|error| AppError::Config(format!("邮件解析失败: {}", error)))?;
    let sender_address = parsed
        .headers
        .get_first_value("From")
        .and_then(|value| mailparse::addrparse(&value).ok())
        .and_then(|addresses| addresses.extract_single_info())
        .map(|address| address.addr)
        .ok_or_else(|| AppError::Config("邮件缺少有效发件人".into()))?;
    let subject = parsed
        .headers
        .get_first_value("Subject")
        .unwrap_or_default();
    let mut text_body = None;
    let mut html_body = None;
    collect_bodies(&parsed, &mut text_body, &mut html_body)?;
    let sanitized_html = html_body
        .map(sanitize_html)
        .filter(|html| !html.trim().is_empty())
        .unwrap_or_else(|| text_body.clone().unwrap_or_default());

    Ok(ParsedMail {
        sender_address,
        subject,
        text_body: text_body.map(|body| body.trim().to_string()),
        sanitized_html,
    })
}

fn collect_bodies(
    part: &mailparse::ParsedMail<'_>,
    text_body: &mut Option<String>,
    html_body: &mut Option<String>,
) -> AppResult<()> {
    if part.subparts.is_empty() {
        match part.ctype.mimetype.as_str() {
            "text/plain" if text_body.is_none() => {
                *text_body = Some(
                    part.get_body()
                        .map_err(|error| AppError::Config(error.to_string()))?,
                );
            }
            "text/html" if html_body.is_none() => {
                *html_body = Some(
                    part.get_body()
                        .map_err(|error| AppError::Config(error.to_string()))?,
                );
            }
            _ => {}
        }
        return Ok(());
    }
    for subpart in &part.subparts {
        collect_bodies(subpart, text_body, html_body)?;
    }
    Ok(())
}

fn sanitize_html(html: String) -> String {
    ammonia::Builder::default()
        .tags(std::collections::HashSet::from([
            "a", "b", "br", "code", "div", "em", "li", "ol", "p", "pre", "span", "strong", "ul",
        ]))
        .clean(&html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{search_query, uid_batches, SyncWindow};

    #[test]
    fn uid按固定大小分批() {
        let uids = (1..=101).collect::<Vec<u32>>();
        let batches = uid_batches(&uids, 50);

        assert_eq!(
            batches.iter().map(|batch| batch.len()).collect::<Vec<_>>(),
            [50, 50, 1]
        );
        assert!(uid_batches(&[], 50).is_empty());
    }

    #[test]
    fn 历史范围生成_imap_日期条件() {
        let query = search_query(
            Some(&SyncWindow {
                since: Some(1_754_000_000),
                until: Some(1_754_086_400),
            }),
            30,
        );
        assert!(query.starts_with("SINCE "));
        assert!(query.contains(" BEFORE "));
    }
}
