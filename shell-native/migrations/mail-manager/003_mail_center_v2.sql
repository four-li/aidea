ALTER TABLE mail_accounts ADD COLUMN spam_folder TEXT;
ALTER TABLE mail_accounts ADD COLUMN deleted_folder TEXT;
UPDATE mail_accounts SET deleted_folder = trash_folder WHERE deleted_folder IS NULL;

ALTER TABLE mail_bodies RENAME TO mail_bodies_old;
ALTER TABLE mail_messages RENAME TO mail_messages_old;
ALTER TABLE mail_folders RENAME TO mail_folders_old;
DROP INDEX mail_messages_by_folder_received_at;
DROP INDEX mail_messages_by_account_received_at;
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
INSERT INTO mail_folders (id, account_id, remote_name, folder_kind, uid_validity, last_uid, last_synced_at)
SELECT id, account_id, remote_name,
       CASE folder_kind WHEN 'trash' THEN 'deleted' ELSE folder_kind END,
       uid_validity, last_uid, last_synced_at
FROM mail_folders_old;
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
INSERT INTO mail_messages
SELECT * FROM mail_messages_old;
CREATE TABLE mail_bodies (
    mail_message_id INTEGER PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE,
    text_body TEXT,
    sanitized_html TEXT,
    updated_at INTEGER NOT NULL
);
INSERT INTO mail_bodies SELECT * FROM mail_bodies_old;
DROP TABLE mail_bodies_old;
DROP TABLE mail_messages_old;
DROP TABLE mail_folders_old;
CREATE INDEX mail_messages_by_folder_received_at
    ON mail_messages(folder_id, received_at DESC);
CREATE INDEX mail_messages_by_account_received_at
    ON mail_messages(account_id, received_at DESC);

CREATE TABLE mail_sync_tasks (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    phase TEXT NOT NULL,
    processed INTEGER NOT NULL DEFAULT 0,
    total INTEGER,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT
);

CREATE INDEX mail_sync_tasks_by_account_started_at
    ON mail_sync_tasks(account_id, started_at DESC);
