export interface MailAccount {
  id: string;
  display_name: string;
  email: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  tls_mode: string;
  username: string;
  auth_kind: string;
  webmail_url: string;
  inbox_folder: string;
  trash_folder: string | null;
  spam_folder: string | null;
  deleted_folder: string | null;
  enabled: boolean;
  last_sync_at: number | null;
  last_error: string | null;
  inbox_total: number;
  unread_total: number;
}

export interface SaveMailAccountRequest {
  id?: string; display_name: string; email: string; provider: string; imap_host: string;
  imap_port: number; tls_mode: string; username: string; auth_kind: string; secret: string;
  webmail_url: string; inbox_folder: string; trash_folder?: string | null; spam_folder?: string | null; deleted_folder?: string | null;
}

export interface MailMessageSummary {
  id: number; account_id: string; folder_id: number; folder_kind: 'inbox' | 'spam' | 'deleted'; sender_name: string | null;
  sender_address: string; subject: string; received_at: number; is_read: boolean; snippet: string | null;
}

export interface MailMessagePage {
  items: MailMessageSummary[];
  total: number;
}

export interface MailMessageQuery {
  account_id?: string | null;
  folder_kind?: 'inbox' | 'spam' | 'deleted';
  read_state?: 'all' | 'read' | 'unread';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MailMessageDetail {
  id: number; account_id: string; folder_id: number; remote_uid: number; sender_name: string | null;
  sender_address: string; subject: string; received_at: number; is_read: boolean;
  text_body: string | null; sanitized_html: string | null;
}

export interface SyncResult {
  accounts: { account_id: string; synced: boolean; error: string | null }[];
}

export interface MailSyncTask {
  id: string; account_id: string; kind: string; phase: string; processed: number; total: number | null;
  started_at: number; finished_at: number | null; error: string | null;
}
