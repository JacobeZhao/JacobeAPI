use serde::Serialize;
use thiserror::Error;

use crate::domain::LibraryState;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid library data: {0}")]
    Invalid(String),
    #[error("library revision conflict")]
    Conflict { current: Box<LibraryState> },
    #[error("library storage is damaged: {0}")]
    Corruption(String),
    #[error("library storage limit exceeded: {bytes} bytes")]
    StorageLimit { bytes: usize },
    #[error("library storage operation failed: {0}")]
    Storage(String),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Conflict,
    Invalid,
    Storage,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<LibraryState>,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Conflict { current } => Self {
                code: ErrorCode::Conflict,
                message: "资料库已在另一个窗口更新，请刷新后重试。".into(),
                state: Some(*current),
            },
            AppError::Invalid(_) => Self {
                code: ErrorCode::Invalid,
                message: "提交的数据格式不正确，请检查后重试。".into(),
                state: None,
            },
            AppError::Corruption(_) => Self {
                code: ErrorCode::Storage,
                message: "本地资料库无法读取，请使用备份恢复。".into(),
                state: None,
            },
            AppError::StorageLimit { .. } => Self {
                code: ErrorCode::Storage,
                message: "本地资料库空间不足，请导出备份并清理部分内容。".into(),
                state: None,
            },
            AppError::Storage(_) => Self {
                code: ErrorCode::Storage,
                message: "本地资料保存失败，请稍后重试。".into(),
                state: None,
            },
        }
    }
}
