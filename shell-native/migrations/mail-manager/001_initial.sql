CREATE TABLE mail_accounts (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    provider TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    tls_mode TEXT NOT NULL,
    username TEXT NOT NULL,
    auth_kind TEXT NOT NULL,
    keychain_id TEXT NOT NULL,
    webmail_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sync_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE mail_folders (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    remote_name TEXT NOT NULL,
    folder_kind TEXT NOT NULL CHECK (folder_kind IN ('inbox', 'trash', 'spam', 'deleted')),
    uid_validity INTEGER,
    last_uid INTEGER,
    last_synced_at INTEGER,
    UNIQUE(account_id, remote_name)
);

CREATE TABLE mail_messages (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
    remote_uid INTEGER NOT NULL,
    rfc_message_id TEXT,
    sender_name TEXT,
    sender_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    snippet TEXT,
    body_loaded INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    UNIQUE(folder_id, remote_uid)
);

CREATE TABLE mail_bodies (
    mail_message_id INTEGER PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE,
    text_body TEXT,
    sanitized_html TEXT,
    updated_at INTEGER NOT NULL
);

CREATE INDEX mail_messages_by_folder_received_at
    ON mail_messages(folder_id, received_at DESC);
CREATE INDEX mail_messages_by_account_received_at
    ON mail_messages(account_id, received_at DESC);
