use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::{
    atomic::{atomic_remove, atomic_write, read_limited},
    error::{ConfigError, ConfigErrorCode, ConfigResult},
    merge::{
        is_configured_for_netapi, merge_claude, merge_codex, validate_config_bytes,
        ClaudeDesiredConfig, CodexDesiredConfig, MergeResult,
    },
    CliConfigHealth, CliConfigPaths, CliConfigStatus, CliConfigTarget, ConfigApplyReceipt,
    ConfigBackupSummary, ConfigPlanPreview, ConfigRestoreReceipt, NetapiConfigIdentity,
    DEFAULT_PLAN_TTL_SECONDS,
};

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_BACKUP_BYTES: u64 = 8 * 1024 * 1024;
const BACKUP_FORMAT: &str = "jacobe-cli-config-backup-v1";
const MAX_ACTIVE_PLANS: usize = 32;

pub trait BackupProtector: Send + Sync + 'static {
    fn protect(&self, plaintext: &[u8]) -> ConfigResult<Vec<u8>>;
    fn unprotect(&self, ciphertext: &[u8]) -> ConfigResult<Vec<u8>>;
}

pub struct ConfigEngine {
    paths: CliConfigPaths,
    backup_dir: PathBuf,
    protector: Arc<dyn BackupProtector>,
    plans: Mutex<HashMap<String, StoredPlan>>,
}

struct StoredPlan {
    preview: ConfigPlanPreview,
    original_exists: bool,
    candidate: Zeroizing<Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupRecord {
    format: String,
    backup_id: String,
    target: CliConfigTarget,
    original_exists: bool,
    original_fingerprint: String,
    applied_fingerprint: String,
    created_at_unix_seconds: u64,
    ciphertext: Vec<u8>,
}

impl ConfigEngine {
    pub fn new(
        paths: CliConfigPaths,
        backup_dir: impl Into<PathBuf>,
        protector: Arc<dyn BackupProtector>,
    ) -> ConfigResult<Self> {
        let backup_dir = backup_dir.into();
        if !backup_dir.is_absolute() {
            return Err(ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "configuration backup directory must be absolute",
            ));
        }
        Ok(Self {
            paths,
            backup_dir,
            protector,
            plans: Mutex::new(HashMap::new()),
        })
    }

    pub fn plan_codex(&self, desired: CodexDesiredConfig) -> ConfigResult<ConfigPlanPreview> {
        self.plan_codex_at(desired, now_unix_seconds())
    }

    pub fn plan_claude(&self, desired: ClaudeDesiredConfig) -> ConfigResult<ConfigPlanPreview> {
        self.plan_claude_at(desired, now_unix_seconds())
    }

    pub fn apply(&self, plan_id: &str) -> ConfigResult<ConfigApplyReceipt> {
        self.apply_at(plan_id, now_unix_seconds())
    }

    pub fn scan(&self, identity: &NetapiConfigIdentity) -> Vec<CliConfigStatus> {
        [CliConfigTarget::Codex, CliConfigTarget::Claude]
            .into_iter()
            .map(|target| self.scan_target(target, identity))
            .collect()
    }

    pub fn list_backups(&self) -> ConfigResult<Vec<ConfigBackupSummary>> {
        let entries = match fs::read_dir(&self.backup_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(ConfigError::io(
                    "cannot enumerate configuration backups",
                    error,
                ))
            }
        };
        let mut backups = Vec::new();
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() || file_type.is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if validate_id(id, "backup").is_err() {
                continue;
            }
            let Ok(record) = self.read_backup(id) else {
                continue;
            };
            backups.push(ConfigBackupSummary {
                id: record.backup_id,
                target: record.target,
                path: CliConfigPaths::display_path(record.target),
                created_at: iso_timestamp(record.created_at_unix_seconds),
            });
        }
        backups.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(backups)
    }

    pub fn restore(&self, backup_id: &str) -> ConfigResult<ConfigRestoreReceipt> {
        validate_id(backup_id, "backup")?;
        let record = self.read_backup(backup_id)?;
        let path = self.paths.validate_target(record.target)?;
        let (_, current) = read_limited(path, MAX_CONFIG_BYTES)?;
        let current = Zeroizing::new(current);
        if fingerprint(&current) != record.applied_fingerprint {
            return Err(ConfigError::new(
                ConfigErrorCode::ConfigConflict,
                "configuration changed after it was applied; restore was cancelled",
            ));
        }
        let original = Zeroizing::new(self.protector.unprotect(&record.ciphertext)?);
        if fingerprint(&original) != record.original_fingerprint {
            return Err(ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "configuration backup fingerprint does not match",
            ));
        }
        if record.original_exists {
            validate_config_bytes(record.target, &original)?;
            atomic_write(path, &original)?;
        } else {
            atomic_remove(path)?;
        }
        let (exists, restored) = read_limited(path, MAX_CONFIG_BYTES)?;
        let restored = Zeroizing::new(restored);
        if exists != record.original_exists || fingerprint(&restored) != record.original_fingerprint
        {
            return Err(ConfigError::new(
                ConfigErrorCode::Io,
                "configuration restore could not be verified",
            ));
        }
        Ok(ConfigRestoreReceipt {
            target: record.target,
            path: CliConfigPaths::display_path(record.target),
            fingerprint: record.original_fingerprint,
            applied_at: iso_timestamp(now_unix_seconds()),
            restart_required: true,
        })
    }

    fn plan_codex_at(
        &self,
        desired: CodexDesiredConfig,
        now: u64,
    ) -> ConfigResult<ConfigPlanPreview> {
        let target = CliConfigTarget::Codex;
        let path = self.paths.validate_target(target)?;
        let (exists, source) = read_limited(path, MAX_CONFIG_BYTES)?;
        let source = Zeroizing::new(source);
        let merged = merge_codex(&source, &desired)?;
        self.store_plan(target, exists, &source, merged, now)
    }

    fn plan_claude_at(
        &self,
        desired: ClaudeDesiredConfig,
        now: u64,
    ) -> ConfigResult<ConfigPlanPreview> {
        let target = CliConfigTarget::Claude;
        let path = self.paths.validate_target(target)?;
        let (exists, source) = read_limited(path, MAX_CONFIG_BYTES)?;
        let source = Zeroizing::new(source);
        let merged = merge_claude(&source, &desired)?;
        self.store_plan(target, exists, &source, merged, now)
    }

    fn store_plan(
        &self,
        target: CliConfigTarget,
        original_exists: bool,
        original: &[u8],
        merged: MergeResult,
        now: u64,
    ) -> ConfigResult<ConfigPlanPreview> {
        if merged.bytes.len() as u64 > MAX_CONFIG_BYTES {
            return Err(ConfigError::new(
                ConfigErrorCode::ConfigInvalid,
                "candidate configuration exceeds the size limit",
            ));
        }
        let plan_id = Uuid::new_v4().to_string();
        let preview = ConfigPlanPreview {
            plan_id: plan_id.clone(),
            target,
            path: CliConfigPaths::display_path(target),
            original_fingerprint: fingerprint(original),
            expires_at_unix_seconds: now.saturating_add(DEFAULT_PLAN_TTL_SECONDS),
            changes: merged.changes,
            warnings: merged.warnings,
            backup_will_be_created: true,
        };
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| ConfigError::new(ConfigErrorCode::Io, "configuration plan lock failed"))?;
        plans.retain(|_, plan| plan.preview.expires_at_unix_seconds >= now);
        if plans.len() >= MAX_ACTIVE_PLANS {
            return Err(ConfigError::new(
                ConfigErrorCode::Io,
                "too many active configuration plans",
            ));
        }
        plans.insert(
            plan_id,
            StoredPlan {
                preview: preview.clone(),
                original_exists,
                candidate: Zeroizing::new(merged.bytes),
            },
        );
        Ok(preview)
    }

    fn apply_at(&self, plan_id: &str, now: u64) -> ConfigResult<ConfigApplyReceipt> {
        validate_id(plan_id, "plan")?;
        let plan = self
            .plans
            .lock()
            .map_err(|_| ConfigError::new(ConfigErrorCode::Io, "configuration plan lock failed"))?
            .remove(plan_id)
            .ok_or_else(|| {
                ConfigError::new(
                    ConfigErrorCode::PlanMissing,
                    "configuration plan was not found",
                )
            })?;
        if now > plan.preview.expires_at_unix_seconds {
            return Err(ConfigError::new(
                ConfigErrorCode::PlanExpired,
                "configuration plan expired; create a new preview",
            ));
        }
        let path = self.paths.validate_target(plan.preview.target)?;
        let (current_exists, current) = read_limited(path, MAX_CONFIG_BYTES)?;
        let current = Zeroizing::new(current);
        if current_exists != plan.original_exists
            || fingerprint(&current) != plan.preview.original_fingerprint
        {
            return Err(ConfigError::new(
                ConfigErrorCode::ConfigConflict,
                "configuration changed after preview; apply was cancelled",
            ));
        }
        validate_config_bytes(plan.preview.target, &plan.candidate)?;
        let applied_fingerprint = fingerprint(&plan.candidate);
        let backup_id = Uuid::new_v4().to_string();
        self.write_backup(
            &backup_id,
            plan.preview.target,
            current_exists,
            &current,
            &applied_fingerprint,
            now,
        )?;
        atomic_write(path, &plan.candidate)?;
        let write_verification = (|| {
            let (exists, written) = read_limited(path, MAX_CONFIG_BYTES)?;
            let written = Zeroizing::new(written);
            if !exists || fingerprint(&written) != applied_fingerprint {
                return Err(ConfigError::new(
                    ConfigErrorCode::Io,
                    "written configuration fingerprint does not match",
                ));
            }
            validate_config_bytes(plan.preview.target, &written)
        })();
        if let Err(error) = write_verification {
            let rollback = if current_exists {
                atomic_write(path, &current)
            } else {
                atomic_remove(path)
            };
            return match rollback {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(ConfigError::new(
                    ConfigErrorCode::Io,
                    format!("configuration verification and rollback failed: {rollback_error}"),
                )),
            };
        }
        Ok(ConfigApplyReceipt {
            target: plan.preview.target,
            path: CliConfigPaths::display_path(plan.preview.target),
            backup_id,
            fingerprint: applied_fingerprint,
            applied_at: iso_timestamp(now),
            restart_required: true,
        })
    }

    fn write_backup(
        &self,
        backup_id: &str,
        target: CliConfigTarget,
        original_exists: bool,
        original: &[u8],
        applied_fingerprint: &str,
        now: u64,
    ) -> ConfigResult<()> {
        fs::create_dir_all(&self.backup_dir)
            .map_err(|error| ConfigError::io("cannot create encrypted backup directory", error))?;
        let ciphertext = self.protector.protect(original)?;
        if ciphertext.len() as u64 > MAX_BACKUP_BYTES {
            return Err(ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                "encrypted configuration backup exceeds the size limit",
            ));
        }
        let record = BackupRecord {
            format: BACKUP_FORMAT.into(),
            backup_id: backup_id.into(),
            target,
            original_exists,
            original_fingerprint: fingerprint(original),
            applied_fingerprint: applied_fingerprint.into(),
            created_at_unix_seconds: now,
            ciphertext,
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&record).map_err(|_| {
            ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "cannot serialize encrypted configuration backup",
            )
        })?);
        atomic_write(&self.backup_path(backup_id), &bytes)
    }

    fn read_backup(&self, backup_id: &str) -> ConfigResult<BackupRecord> {
        let path = self.backup_path(backup_id);
        let (exists, bytes) = read_limited(&path, MAX_BACKUP_BYTES)?;
        if !exists {
            return Err(ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "configuration backup was not found",
            ));
        }
        let record: BackupRecord = serde_json::from_slice(&bytes).map_err(|_| {
            ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "configuration backup is damaged",
            )
        })?;
        if record.format != BACKUP_FORMAT || record.backup_id != backup_id {
            return Err(ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "configuration backup identity does not match",
            ));
        }
        Ok(record)
    }

    fn backup_path(&self, backup_id: &str) -> PathBuf {
        self.backup_dir.join(format!("{backup_id}.json"))
    }

    fn scan_target(
        &self,
        target: CliConfigTarget,
        identity: &NetapiConfigIdentity,
    ) -> CliConfigStatus {
        let path = CliConfigPaths::display_path(target);
        let approved = match self.paths.validate_target(target) {
            Ok(path) => path,
            Err(_) => {
                return CliConfigStatus {
                    target,
                    path,
                    health: CliConfigHealth::Invalid,
                    configured_for_netapi: false,
                }
            }
        };
        match read_limited(approved, MAX_CONFIG_BYTES) {
            Ok((false, _)) => CliConfigStatus {
                target,
                path,
                health: CliConfigHealth::Missing,
                configured_for_netapi: false,
            },
            Ok((true, bytes)) => {
                let bytes = Zeroizing::new(bytes);
                match is_configured_for_netapi(target, &bytes, identity) {
                    Ok(configured) => CliConfigStatus {
                        target,
                        path,
                        health: CliConfigHealth::Ready,
                        configured_for_netapi: configured,
                    },
                    Err(_) => CliConfigStatus {
                        target,
                        path,
                        health: CliConfigHealth::Invalid,
                        configured_for_netapi: false,
                    },
                }
            }
            Err(_) => CliConfigStatus {
                target,
                path,
                health: CliConfigHealth::Invalid,
                configured_for_netapi: false,
            },
        }
    }
}

fn fingerprint(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn validate_id(value: &str, kind: &str) -> ConfigResult<()> {
    let parsed = Uuid::parse_str(value).map_err(|_| {
        ConfigError::new(
            ConfigErrorCode::InvalidInput,
            format!("{kind} id is invalid"),
        )
    })?;
    if parsed.to_string() != value {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            format!("{kind} id must use canonical formatting"),
        ));
    }
    Ok(())
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn iso_timestamp(seconds: u64) -> String {
    DateTime::<Utc>::from_timestamp(seconds as i64, 0)
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::TempDir;

    use super::*;

    struct TestProtector;

    impl BackupProtector for TestProtector {
        fn protect(&self, plaintext: &[u8]) -> ConfigResult<Vec<u8>> {
            let mut protected = b"protected:".to_vec();
            protected.extend(plaintext.iter().rev());
            Ok(protected)
        }

        fn unprotect(&self, ciphertext: &[u8]) -> ConfigResult<Vec<u8>> {
            let payload = ciphertext.strip_prefix(b"protected:").ok_or_else(|| {
                ConfigError::new(
                    ConfigErrorCode::ProtectionFailed,
                    "test backup is not protected",
                )
            })?;
            Ok(payload.iter().rev().copied().collect())
        }
    }

    fn engine() -> (TempDir, ConfigEngine) {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join(".codex")).unwrap();
        fs::create_dir(temp.path().join(".claude")).unwrap();
        let paths = CliConfigPaths::discover(temp.path(), None, None).unwrap();
        let engine =
            ConfigEngine::new(paths, temp.path().join("backups"), Arc::new(TestProtector)).unwrap();
        (temp, engine)
    }

    fn codex_desired() -> CodexDesiredConfig {
        CodexDesiredConfig {
            provider_id: "netapi".into(),
            provider_name: "NetAPI".into(),
            base_url: "https://api.example/v1".into(),
            wire_api: "responses".into(),
            model: "model-a".into(),
            auth_command: r"C:\Program Files\Jacobe\jacobe-credential-helper.exe".into(),
            auth_args: vec!["codex".into(), "netapi".into()],
            allow_replace_existing_provider: false,
        }
    }

    #[test]
    fn plan_expires_without_writing() {
        let (temp, engine) = engine();
        let path = temp.path().join(".codex/config.toml");
        fs::write(&path, "approval_policy = \"never\"\n").unwrap();
        let plan = engine.plan_codex_at(codex_desired(), 100).unwrap();
        let error = engine
            .apply_at(&plan.plan_id, 100 + DEFAULT_PLAN_TTL_SECONDS + 1)
            .unwrap_err();
        assert_eq!(error.code, ConfigErrorCode::PlanExpired);
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "approval_policy = \"never\"\n"
        );
    }

    #[test]
    fn apply_detects_concurrent_change() {
        let (temp, engine) = engine();
        let path = temp.path().join(".codex/config.toml");
        fs::write(&path, "approval_policy = \"never\"\n").unwrap();
        let plan = engine.plan_codex_at(codex_desired(), 100).unwrap();
        fs::write(&path, "approval_policy = \"untrusted\"\n").unwrap();
        let error = engine.apply_at(&plan.plan_id, 101).unwrap_err();
        assert_eq!(error.code, ConfigErrorCode::ConfigConflict);
        assert!(fs::read_to_string(path).unwrap().contains("untrusted"));
    }

    #[test]
    fn encrypted_backup_restores_original_configuration() {
        let (temp, engine) = engine();
        let path = temp.path().join(".claude/settings.json");
        let original = r#"{"theme":"dark","env":{"ANTHROPIC_AUTH_TOKEN":"canary"}}"#;
        fs::write(&path, original).unwrap();
        let plan = engine
            .plan_claude_at(
                ClaudeDesiredConfig {
                    base_url: "https://api.example".into(),
                    api_key_helper: "jacobe-helper netapi".into(),
                    models: BTreeMap::from([("ANTHROPIC_MODEL".into(), "model-a".into())]),
                    remove_plaintext_auth_token: true,
                    allow_replace_existing_values: false,
                },
                100,
            )
            .unwrap();
        let receipt = engine.apply_at(&plan.plan_id, 101).unwrap();
        let applied = fs::read_to_string(&path).unwrap();
        assert!(!applied.contains("canary"));

        let backup = fs::read(
            temp.path()
                .join(format!("backups/{}.json", receipt.backup_id)),
        )
        .unwrap();
        assert!(!backup
            .windows(b"canary".len())
            .any(|window| window == b"canary"));

        let backups = engine.list_backups().unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].id, receipt.backup_id);
        assert_eq!(backups[0].path, CliConfigPaths::display_path(CliConfigTarget::Claude));
        assert!(backups[0].created_at.ends_with('Z'));

        let statuses = engine.scan(&NetapiConfigIdentity {
            base_url: "https://api.example".into(),
            codex_provider_id: "netapi".into(),
            codex_auth_command: r"C:\Program Files\Jacobe\jacobe-credential-helper.exe".into(),
            codex_auth_args: vec!["codex".into(), "netapi".into()],
            claude_api_key_helper: "jacobe-helper netapi".into(),
        });
        let claude = statuses
            .iter()
            .find(|status| status.target == CliConfigTarget::Claude)
            .unwrap();
        assert_eq!(claude.health, CliConfigHealth::Ready);
        assert!(claude.configured_for_netapi);

        engine.restore(&receipt.backup_id).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
}
