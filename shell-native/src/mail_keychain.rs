use crate::error::{AppError, AppResult};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.aidea.mail-manager";

pub fn save(id: &str, secret: &str) -> AppResult<()> {
    set_generic_password(SERVICE, id, secret.as_bytes())
        .map_err(|error| AppError::Config(format!("保存邮件凭据到 macOS 钥匙串失败: {}", error)))
}

pub fn load(id: &str) -> AppResult<String> {
    let secret = get_generic_password(SERVICE, id)
        .map_err(|error| AppError::Config(format!("读取邮件凭据失败: {}", error)))?;
    String::from_utf8(secret).map_err(|error| AppError::Config(format!("邮件凭据无效: {}", error)))
}

pub fn delete(id: &str) -> AppResult<()> {
    delete_generic_password(SERVICE, id)
        .map_err(|error| AppError::Config(format!("删除邮件凭据失败: {}", error)))
}
