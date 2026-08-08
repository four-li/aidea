ALTER TABLE mail_accounts ADD COLUMN inbox_folder TEXT NOT NULL DEFAULT 'INBOX';
ALTER TABLE mail_accounts ADD COLUMN trash_folder TEXT;
