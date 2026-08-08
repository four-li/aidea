use crate::config::ensure_data_dirs;
use crate::error::{AppError, AppResult};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand_core::{OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 12;

pub fn save(app_id: &str, key: &str, value: &str) -> AppResult<()> {
    open_default()?.save(app_id, key, value)
}

pub fn load(app_id: &str, key: &str) -> AppResult<String> {
    open_default()?.load(app_id, key)
}

pub fn delete(app_id: &str, key: &str) -> AppResult<()> {
    open_default()?.delete(app_id, key)
}

pub fn exists(app_id: &str, key: &str) -> AppResult<bool> {
    open_default()?.exists(app_id, key)
}

struct SecretStore {
    connection: Connection,
    key: [u8; KEY_LENGTH],
}

impl SecretStore {
    fn open(root: &Path) -> AppResult<Self> {
        let database_path = root.join("databases/secrets.db");
        let key = load_or_create_key(&root.join("secrets.key"))?;
        let connection = Connection::open(database_path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS _migrations (
                 version TEXT PRIMARY KEY,
                 applied_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS secrets (
                 app_id TEXT NOT NULL,
                 key TEXT NOT NULL,
                 nonce BLOB NOT NULL,
                 ciphertext BLOB NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (app_id, key)
             );
             INSERT OR IGNORE INTO _migrations (version, applied_at)
             VALUES ('001_initial', unixepoch());",
        )?;
        Ok(Self { connection, key })
    }

    fn save(&self, app_id: &str, key: &str, value: &str) -> AppResult<()> {
        validate_name(app_id, "应用 ID")?;
        validate_name(key, "凭据 Key")?;
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|_| AppError::Config("本地加密密钥无效".into()))?;
        let mut nonce = [0_u8; NONCE_LENGTH];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
            .map_err(|_| AppError::Config("加密本地凭据失败".into()))?;
        let now = timestamp()?;
        self.connection.execute(
            "INSERT INTO secrets (app_id, key, nonce, ciphertext, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(app_id, key) DO UPDATE SET
                 nonce = excluded.nonce,
                 ciphertext = excluded.ciphertext,
                 updated_at = excluded.updated_at",
            params![app_id, key, nonce.as_slice(), ciphertext, now],
        )?;
        Ok(())
    }

    fn load(&self, app_id: &str, key: &str) -> AppResult<String> {
        validate_name(app_id, "应用 ID")?;
        validate_name(key, "凭据 Key")?;
        let row = self
            .connection
            .query_row(
                "SELECT nonce, ciphertext FROM secrets WHERE app_id = ?1 AND key = ?2",
                params![app_id, key],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()?;
        let Some((nonce, ciphertext)) = row else {
            return Err(AppError::Config("未找到已保存的凭据，请重新保存".into()));
        };
        if nonce.len() != NONCE_LENGTH {
            return Err(AppError::Config("本地凭据数据已损坏".into()));
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|_| AppError::Config("本地加密密钥无效".into()))?;
        let value = cipher
            .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
            .map_err(|_| AppError::Config("本地凭据数据已损坏".into()))?;
        String::from_utf8(value).map_err(|_| AppError::Config("本地凭据数据已损坏".into()))
    }

    fn delete(&self, app_id: &str, key: &str) -> AppResult<()> {
        validate_name(app_id, "应用 ID")?;
        validate_name(key, "凭据 Key")?;
        self.connection.execute(
            "DELETE FROM secrets WHERE app_id = ?1 AND key = ?2",
            params![app_id, key],
        )?;
        Ok(())
    }

    fn exists(&self, app_id: &str, key: &str) -> AppResult<bool> {
        validate_name(app_id, "应用 ID")?;
        validate_name(key, "凭据 Key")?;
        Ok(self
            .connection
            .query_row(
                "SELECT 1 FROM secrets WHERE app_id = ?1 AND key = ?2",
                params![app_id, key],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }
}

fn open_default() -> AppResult<SecretStore> {
    Ok(SecretStore::open(&ensure_data_dirs()?)?)
}

fn load_or_create_key(path: &Path) -> AppResult<[u8; KEY_LENGTH]> {
    if path.exists() {
        let bytes = fs::read(path)?;
        return bytes
            .try_into()
            .map_err(|_| AppError::Config("本地加密密钥无效".into()));
    }
    let mut key = [0_u8; KEY_LENGTH];
    OsRng.fill_bytes(&mut key);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(&key)?;
    }
    #[cfg(not(unix))]
    fs::write(path, key)?;
    Ok(key)
}

fn validate_name(value: &str, label: &str) -> AppResult<()> {
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(AppError::Config(format!("{}不能为空或包含控制字符", label)));
    }
    Ok(())
}

fn timestamp() -> AppResult<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Config(error.to_string()))?
        .as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn store() -> (SecretStore, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("aidea-secret-store-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("databases")).unwrap();
        let store = SecretStore::open(&root).unwrap();
        (store, root)
    }

    #[test]
    fn 保存读取覆盖删除并隔离命名空间() {
        let (store, root) = store();
        store.save("mail-manager", "account:one", "first").unwrap();
        store.save("shell", "account:one", "other").unwrap();
        assert_eq!(store.load("mail-manager", "account:one").unwrap(), "first");
        assert_eq!(store.load("shell", "account:one").unwrap(), "other");
        store.save("mail-manager", "account:one", "second").unwrap();
        assert_eq!(store.load("mail-manager", "account:one").unwrap(), "second");
        store.delete("mail-manager", "account:one").unwrap();
        assert!(!store.exists("mail-manager", "account:one").unwrap());
        assert!(store.exists("shell", "account:one").unwrap());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn 损坏密文不会返回明文() {
        let (store, root) = store();
        store.save("shell", "ai:one", "secret").unwrap();
        store
            .connection
            .execute(
                "UPDATE secrets SET ciphertext = X'00' WHERE app_id = 'shell' AND key = 'ai:one'",
                [],
            )
            .unwrap();
        assert!(store.load("shell", "ai:one").is_err());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
}
