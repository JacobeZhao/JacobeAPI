mod atomic;
mod credential_helper;
#[cfg(not(windows))]
mod local_key;
#[cfg(windows)]
mod dpapi;
mod engine;
mod error;
mod merge;
mod paths;

pub use credential_helper::{parse_credential_helper_args, CredentialHelperMode};
#[cfg(windows)]
pub use dpapi::DpapiBackupProtector;
#[cfg(not(windows))]
pub use local_key::LocalKeyBackupProtector;
pub use engine::{BackupProtector, ConfigEngine};
pub use error::{ConfigError, ConfigErrorCode, ConfigResult};
pub use merge::{ClaudeDesiredConfig, CodexDesiredConfig};
pub use paths::CliConfigPaths;

use serde::{Deserialize, Serialize};

pub const DEFAULT_PLAN_TTL_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliConfigTarget {
    Codex,
    Claude,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPlanPreview {
    pub plan_id: String,
    pub target: CliConfigTarget,
    pub path: String,
    pub original_fingerprint: String,
    pub expires_at_unix_seconds: u64,
    pub changes: Vec<ConfigPreviewChange>,
    pub warnings: Vec<String>,
    pub backup_will_be_created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPreviewChange {
    pub key: String,
    pub action: ConfigChangeAction,
    pub before: PreviewValue,
    pub after: PreviewValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigChangeAction {
    Add,
    Update,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum PreviewValue {
    Absent,
    Redacted,
    Public(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigApplyReceipt {
    pub target: CliConfigTarget,
    pub path: String,
    pub backup_id: String,
    pub fingerprint: String,
    pub applied_at: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRestoreReceipt {
    pub target: CliConfigTarget,
    pub path: String,
    pub fingerprint: String,
    pub applied_at: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigStatus {
    pub target: CliConfigTarget,
    pub path: String,
    pub health: CliConfigHealth,
    pub configured_for_netapi: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliConfigHealth {
    Ready,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetapiConfigIdentity {
    pub base_url: String,
    pub codex_provider_id: String,
    pub codex_auth_command: String,
    #[serde(default)]
    pub codex_auth_args: Vec<String>,
    pub claude_api_key_helper: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBackupSummary {
    pub id: String,
    pub target: CliConfigTarget,
    pub path: String,
    pub created_at: String,
}

#[cfg(test)]
mod ipc_contract_tests {
    use super::*;

    #[test]
    fn preview_change_uses_the_frontend_ipc_shape() {
        let change = ConfigPreviewChange {
            key: "model_provider".into(),
            action: ConfigChangeAction::Add,
            before: PreviewValue::Absent,
            after: PreviewValue::Public("netapi-demo".into()),
        };

        assert_eq!(
            serde_json::to_value(change).unwrap(),
            serde_json::json!({
                "key": "model_provider",
                "action": "add",
                "before": { "kind": "absent" },
                "after": { "kind": "public", "value": "netapi-demo" }
            })
        );
    }
}
