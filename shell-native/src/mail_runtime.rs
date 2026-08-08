use crate::mail_store::{MailAccountRecord, MailStore};
use crate::mail_sync;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// IDLE 按 RFC 2177 的建议在服务端可能断开前重建。
pub fn idle_keepalive() -> Duration {
    Duration::from_secs(29 * 60)
}

/// 重连只在连接断开后发生，最长等待一分钟，不能替代 IDLE 收信。
pub fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_secs(1_u64.checked_shl(attempt.min(6)).unwrap_or(60).min(60))
}

/// 监听线程只保存运行态；应用重启后按 SQLite 中的 UID 游标自动补偿。
pub fn start_all(app: AppHandle) {
    let accounts = match MailStore::open().and_then(|store| store.list_enabled_accounts()) {
        Ok(accounts) => accounts,
        Err(error) => {
            eprintln!("启动邮件监听失败: {error}");
            return;
        }
    };
    for account in accounts {
        start_folder(
            app.clone(),
            account.clone(),
            account.inbox_folder.clone(),
            "inbox",
        );
        if let Some(folder) = account.spam_folder.clone() {
            start_folder(app.clone(), account.clone(), folder, "spam");
        }
        if let Some(folder) = account.deleted_folder.clone() {
            start_folder(app.clone(), account, folder, "deleted");
        }
    }
}

fn start_folder(
    app: AppHandle,
    account: MailAccountRecord,
    remote_name: String,
    folder_kind: &'static str,
) {
    std::thread::spawn(move || {
        let mut attempt = 0;
        loop {
            match mail_sync::listen_folder_once(&account, &remote_name, folder_kind) {
                Ok(()) => {
                    attempt = 0;
                    let _ = app.emit("mail-sync-completed", ());
                }
                Err(error) => {
                    eprintln!("邮件监听 {}/{} 断开: {error}", account.email, folder_kind);
                    std::thread::sleep(reconnect_delay(attempt));
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    });
}
