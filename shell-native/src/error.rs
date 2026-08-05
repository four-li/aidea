// 统一错误类型，所有模块返回 Result<T, AppError>
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML 解析错误: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("子应用未找到: {0}")]
    AppNotFound(String),

    #[error("进程错误: {0}")]
    Process(String),

    #[error("网络错误: {0}")]
    Network(String),
}

// 让 AppError 能通过 Tauri IPC 序列化返回前端
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type AppResult<T> = Result<T, AppError>;
