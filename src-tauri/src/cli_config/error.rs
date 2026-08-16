use serde::Serialize;
use thiserror::Error;

pub type ConfigResult<T> = Result<T, ConfigError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigErrorCode {
    InvalidInput,
    UnsupportedPath,
    UnsafePath,
    ConfigMissing,
    ConfigInvalid,
    ConfigConflict,
    ExistingConfigConflict,
    ConcurrentModification,
    PlanMissing,
    PlanExpired,
    BackupInvalid,
    ProtectionFailed,
    Io,
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ConfigError {
    pub code: ConfigErrorCode,
    pub message: String,
}

impl ConfigError {
    pub(crate) fn new(code: ConfigErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn io(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new(ConfigErrorCode::Io, format!("{context}: {error}"))
    }
}
