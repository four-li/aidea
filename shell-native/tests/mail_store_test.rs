use aidea_shell_lib::mail_store::{
    MailAccountRecord, MailFolderInput, MailMessageInput, MailStore, MessageQuery,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

static TEST_DIRECTORY_SEQUENCE: AtomicUsize = AtomicUsize::new(0);
static DATA_DIRECTORY_LOCK: Mutex<()> = Mutex::new(());

fn test_data_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "aidea-mail-{name}-{}-{}",
        std::process::id(),
        TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed),
    ))
}

#[test]
fn 邮件数据库首次打开会创建文件且列表为空() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("store");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);

    let store = MailStore::open().expect("应创建邮件数据库");

    assert!(store.database_path().exists());
    assert!(store
        .list_messages(MessageQuery::default())
        .expect("查询空列表")
        .items
        .is_empty());
}

#[test]
fn 同步任务记录阶段进度和错误() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("sync-task");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");
    store
        .save_account(MailAccountRecord {
            id: "sync-account".into(),
            display_name: "同步账户".into(),
            email: "sync@example.com".into(),
            provider: "manual".into(),
            imap_host: "imap.example.com".into(),
            imap_port: 993,
            tls_mode: "tls".into(),
            username: "sync@example.com".into(),
            auth_kind: "password".into(),
            keychain_id: "sync-key".into(),
            webmail_url: "https://mail.example.com".into(),
            inbox_folder: "INBOX".into(),
            trash_folder: None,
            spam_folder: None,
            deleted_folder: None,
            enabled: true,
            last_sync_at: None,
            last_error: None,
        })
        .expect("创建账户");
    let task_id = store
        .begin_sync_task("sync-account", "incremental", "connect")
        .expect("开始任务");
    store
        .update_sync_task(&task_id, "fetch", 3, Some(10))
        .expect("更新任务");
    store
        .finish_sync_task(&task_id, "error", Some("连接失败"))
        .expect("结束任务");
    let task = &store.list_sync_tasks().expect("读取任务")[0];
    assert_eq!(task.phase, "error");
    assert_eq!(task.processed, 3);
    assert_eq!(task.total, Some(10));
    assert_eq!(task.error.as_deref(), Some("连接失败"));
}

#[test]
fn 同一远程邮件重复同步会覆盖且过期邮件会被清理() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("upsert");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");
    store
        .save_account(MailAccountRecord {
            id: "account-1".into(),
            display_name: "测试账户".into(),
            email: "test@example.com".into(),
            provider: "manual".into(),
            imap_host: "imap.example.com".into(),
            imap_port: 993,
            tls_mode: "tls".into(),
            username: "test@example.com".into(),
            auth_kind: "password".into(),
            keychain_id: "test-keychain-id".into(),
            webmail_url: "https://mail.example.com".into(),
            inbox_folder: "INBOX".into(),
            trash_folder: Some("已删除".into()),
            spam_folder: None,
            deleted_folder: Some("已删除".into()),
            enabled: true,
            last_sync_at: None,
            last_error: None,
        })
        .expect("创建测试账户");
    let folder_id = store
        .upsert_folder(MailFolderInput {
            account_id: "account-1".into(),
            remote_name: "INBOX".into(),
            folder_kind: "inbox".into(),
        })
        .expect("创建测试文件夹");

    store
        .upsert_message(MailMessageInput {
            folder_id,
            remote_uid: 7,
            sender_name: None,
            sender_address: "sender@example.com".into(),
            subject: "初始主题".into(),
            received_at: 100,
            is_read: false,
            snippet: None,
        })
        .expect("首次保存邮件");
    store
        .upsert_message(MailMessageInput {
            folder_id,
            remote_uid: 7,
            sender_name: None,
            sender_address: "sender@example.com".into(),
            subject: "更新后的主题".into(),
            received_at: 100,
            is_read: true,
            snippet: None,
        })
        .expect("重复保存邮件");

    let messages = store
        .list_messages(MessageQuery::default())
        .expect("查询邮件");
    assert_eq!(messages.items.len(), 1);
    assert_eq!(messages.items[0].subject, "更新后的主题");

    store
        .delete_messages_before(folder_id, 101)
        .expect("清理过期邮件");
    assert!(store
        .list_messages(MessageQuery::default())
        .expect("查询清理结果")
        .items
        .is_empty());
}

#[test]
fn 账户保存手工垃圾箱目录供不支持特殊用途标记的服务使用() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("account-folders");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");

    store
        .save_account(MailAccountRecord {
            id: "account-folders".into(),
            display_name: "测试账户".into(),
            email: "test@example.com".into(),
            provider: "manual".into(),
            imap_host: "imap.example.com".into(),
            imap_port: 993,
            tls_mode: "tls".into(),
            username: "test@example.com".into(),
            auth_kind: "password".into(),
            keychain_id: "test-keychain-id".into(),
            webmail_url: "https://mail.example.com".into(),
            inbox_folder: "INBOX".into(),
            trash_folder: Some("已删除".into()),
            spam_folder: None,
            deleted_folder: Some("已删除".into()),
            enabled: true,
            last_sync_at: None,
            last_error: None,
        })
        .expect("保存账户");

    let account = store
        .account("account-folders")
        .expect("查询账户")
        .expect("账户存在");
    assert_eq!(account.inbox_folder, "INBOX");
    assert_eq!(account.trash_folder.as_deref(), Some("已删除"));
}

#[test]
fn 邮件详情读取已缓存正文并可更新本地已读状态() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("message-detail");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");
    store
        .save_account(MailAccountRecord {
            id: "account-detail".into(),
            display_name: "测试账户".into(),
            email: "test@example.com".into(),
            provider: "manual".into(),
            imap_host: "imap.example.com".into(),
            imap_port: 993,
            tls_mode: "tls".into(),
            username: "test@example.com".into(),
            auth_kind: "password".into(),
            keychain_id: "test-keychain-id".into(),
            webmail_url: "https://mail.example.com".into(),
            inbox_folder: "INBOX".into(),
            trash_folder: None,
            spam_folder: None,
            deleted_folder: None,
            enabled: true,
            last_sync_at: None,
            last_error: None,
        })
        .expect("创建账户");
    let folder_id = store
        .upsert_folder(MailFolderInput {
            account_id: "account-detail".into(),
            remote_name: "INBOX".into(),
            folder_kind: "inbox".into(),
        })
        .expect("创建文件夹");
    store
        .upsert_message(MailMessageInput {
            folder_id,
            remote_uid: 10,
            sender_name: Some("运维".into()),
            sender_address: "ops@example.com".into(),
            subject: "告警".into(),
            received_at: 100,
            is_read: false,
            snippet: Some("服务异常".into()),
        })
        .expect("创建邮件");
    let message_id = store
        .list_messages(MessageQuery::default())
        .expect("读取列表")
        .items[0]
        .id;
    store
        .save_body(message_id, Some("服务异常"), "<p>服务异常</p>")
        .expect("保存正文");

    let detail = store
        .message_detail(message_id)
        .expect("读取详情")
        .expect("详情存在");
    assert_eq!(detail.sanitized_html.as_deref(), Some("<p>服务异常</p>"));
    store.mark_message_read_local(message_id).expect("更新已读");
    assert!(
        store
            .message_detail(message_id)
            .expect("读取详情")
            .expect("详情存在")
            .is_read
    );
}

#[test]
fn 邮件列表可按账户文件夹和关键词筛选() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("message-query");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");

    for account_id in ["account-a", "account-b"] {
        store
            .save_account(MailAccountRecord {
                id: account_id.into(),
                display_name: account_id.into(),
                email: format!("{account_id}@example.com"),
                provider: "manual".into(),
                imap_host: "imap.example.com".into(),
                imap_port: 993,
                tls_mode: "tls".into(),
                username: format!("{account_id}@example.com"),
                auth_kind: "password".into(),
                keychain_id: account_id.into(),
                webmail_url: "https://mail.example.com".into(),
                inbox_folder: "INBOX".into(),
                trash_folder: Some("Trash".into()),
                spam_folder: None,
                deleted_folder: Some("Trash".into()),
                enabled: true,
                last_sync_at: None,
                last_error: None,
            })
            .expect("创建账户");
    }
    for (account_id, remote_name, folder_kind, subject) in [
        ("account-a", "INBOX", "inbox", "构建失败"),
        ("account-a", "Trash", "trash", "构建失败"),
        ("account-b", "INBOX", "inbox", "构建成功"),
        ("account-b", "Trash", "trash", "其他邮件"),
    ] {
        let folder_id = store
            .upsert_folder(MailFolderInput {
                account_id: account_id.into(),
                remote_name: remote_name.into(),
                folder_kind: folder_kind.into(),
            })
            .expect("创建文件夹");
        store
            .upsert_message(MailMessageInput {
                folder_id,
                remote_uid: 1,
                sender_name: None,
                sender_address: "alerts@example.com".into(),
                subject: subject.into(),
                received_at: 100,
                is_read: account_id == "account-b",
                snippet: None,
            })
            .expect("创建邮件");
    }

    let messages = store
        .list_messages(MessageQuery {
            account_id: Some("account-a".into()),
            folder_kind: Some("inbox".into()),
            search: Some("构建失败".into()),
            ..Default::default()
        })
        .expect("筛选邮件");

    assert_eq!(messages.items.len(), 1);
    assert_eq!(messages.items[0].subject, "构建失败");
    assert_eq!(messages.items[0].account_id, "account-a");
    assert_eq!(messages.items[0].folder_kind, "inbox");

    let unread = store
        .list_messages(MessageQuery {
            read_state: Some("unread".into()),
            ..Default::default()
        })
        .expect("筛选未读邮件");
    assert_eq!(unread.total, 2);

    let read = store
        .list_messages(MessageQuery {
            read_state: Some("read".into()),
            ..Default::default()
        })
        .expect("筛选已读邮件");
    assert_eq!(read.total, 2);
}

#[test]
fn 邮件列表按页返回最新邮件() {
    let _lock = DATA_DIRECTORY_LOCK.lock().expect("锁定测试数据目录");
    let data_dir = test_data_dir("message-page");
    std::fs::create_dir_all(&data_dir).expect("创建测试数据目录");
    std::env::set_var("AIDEA_DATA_DIR", &data_dir);
    let store = MailStore::open().expect("创建邮件数据库");
    store
        .save_account(MailAccountRecord {
            id: "account-page".into(),
            display_name: "测试账户".into(),
            email: "test@example.com".into(),
            provider: "manual".into(),
            imap_host: "imap.example.com".into(),
            imap_port: 993,
            tls_mode: "tls".into(),
            username: "test@example.com".into(),
            auth_kind: "password".into(),
            keychain_id: "test-keychain-id".into(),
            webmail_url: "https://mail.example.com".into(),
            inbox_folder: "INBOX".into(),
            trash_folder: None,
            spam_folder: None,
            deleted_folder: None,
            enabled: true,
            last_sync_at: None,
            last_error: None,
        })
        .expect("创建测试账户");
    let folder_id = store
        .upsert_folder(MailFolderInput {
            account_id: "account-page".into(),
            remote_name: "INBOX".into(),
            folder_kind: "inbox".into(),
        })
        .expect("创建文件夹");

    for (remote_uid, received_at) in [(1, 100), (2, 200), (3, 300)] {
        store
            .upsert_message(MailMessageInput {
                folder_id,
                remote_uid,
                sender_name: None,
                sender_address: "alerts@example.com".into(),
                subject: format!("邮件 {remote_uid}"),
                received_at,
                is_read: false,
                snippet: None,
            })
            .expect("保存邮件");
    }

    let page = store
        .list_messages(MessageQuery {
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
        })
        .expect("按页读取邮件");

    assert_eq!(page.total, 3);
    assert_eq!(
        page.items
            .iter()
            .map(|message| message.subject.as_str())
            .collect::<Vec<_>>(),
        ["邮件 2", "邮件 1"]
    );
}
