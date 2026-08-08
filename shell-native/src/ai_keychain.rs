use crate::error::{AppError, AppResult};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.aidea.ai-model-tester";

/// API Key 写入 macOS 登录钥匙串，由 app 层 LAContext 负责认证。
pub fn save(id: &str, api_key: &str) -> AppResult<()> {
    // 重建条目，确保旧的带生物识别访问控制的条目完成迁移。
    let _ = delete_generic_password(SERVICE, id);
    set_generic_password(SERVICE, id, api_key.as_bytes())
        .map_err(|error| AppError::Config(format!("保存到 macOS 钥匙串失败: {}", error)))
}

pub fn load(id: &str) -> AppResult<String> {
    let key = get_generic_password(SERVICE, id)
        .map_err(|error| AppError::Config(format!("读取 macOS 钥匙串失败: {}", error)))?;
    String::from_utf8(key).map_err(|error| AppError::Config(format!("钥匙串内容无效: {}", error)))
}

pub fn delete(id: &str) -> AppResult<()> {
    delete_generic_password(SERVICE, id)
        .map_err(|error| AppError::Config(format!("删除 macOS 钥匙串失败: {}", error)))
}
