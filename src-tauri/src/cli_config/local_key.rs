use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use zeroize::Zeroizing;

use super::{
    engine::BackupProtector,
    error::{ConfigError, ConfigErrorCode, ConfigResult},
};

const KEY_FILE: &str = "backup.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// 非 Windows 平台的备份保护器：AES-256-GCM 加密，密钥为首次使用时随机生成、
/// 存放于应用本地数据目录的 32 字节文件（Unix 下权限 0600）。
///
/// 与 Windows 的 DPAPI 一样，保护范围是「同用户下的静态数据」——密钥与密文同在
/// 用户目录，任何以该用户身份运行的代码理论上都可读取；这等价于 DPAPI 的
/// 用户级（而非进程级）保护边界，满足备份防误读/防随手翻看的本地化需求。
pub struct LocalKeyBackupProtector {
    key: Zeroizing<[u8; KEY_LEN]>,
}

impl LocalKeyBackupProtector {
    pub fn new(app_local_data_root: &Path) -> ConfigResult<Self> {
        let key_path = key_file_path(app_local_data_root);
        let key = load_or_create_key(&key_path)?;
        Ok(Self {
            key: Zeroizing::new(key),
        })
    }

    fn cipher(&self) -> ConfigResult<Aes256Gcm> {
        Aes256Gcm::new_from_slice(self.key.as_slice()).map_err(|error| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                format!("invalid local backup key: {error}"),
            )
        })
    }
}

impl BackupProtector for LocalKeyBackupProtector {
    fn protect(&self, plaintext: &[u8]) -> ConfigResult<Vec<u8>> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher()?
            .encrypt(nonce, plaintext)
            .map_err(|_| ConfigError::new(ConfigErrorCode::ProtectionFailed, "local backup encryption failed"))?;
        let mut output = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    fn unprotect(&self, ciphertext: &[u8]) -> ConfigResult<Vec<u8>> {
        if ciphertext.len() <= NONCE_LEN {
            return Err(ConfigError::new(
                ConfigErrorCode::BackupInvalid,
                "local backup payload is truncated",
            ));
        }
        let (nonce_bytes, sealed) = ciphertext.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher()?
            .decrypt(nonce, sealed)
            .map_err(|_| ConfigError::new(ConfigErrorCode::ProtectionFailed, "local backup decryption failed"))
    }
}

fn key_file_path(app_local_data_root: &Path) -> PathBuf {
    app_local_data_root.join(KEY_FILE)
}

fn load_or_create_key(key_path: &Path) -> ConfigResult<[u8; KEY_LEN]> {
    if let Ok(bytes) = fs::read(key_path) {
        let Ok(bytes) = <[u8; KEY_LEN]>::try_from(bytes.as_slice()) else {
            return Err(ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                format!(
                    "local backup key at {} has an invalid length; remove it to generate a fresh key (existing backups will no longer be restorable)",
                    key_path.display()
                ),
            ));
        };
        return Ok(bytes);
    }

    let mut key = [0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ConfigError::io("cannot create local backup key directory", error))?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(key_path)
        .map_err(|error| ConfigError::io("cannot create local backup key file", error))?;
    restrict_permissions(&file, key_path)?;
    file.write_all(&key)
        .and_then(|()| file.sync_all())
        .map_err(|error| ConfigError::io("cannot write local backup key file", error))?;
    Ok(key)
}

#[cfg(unix)]
fn restrict_permissions(file: &fs::File, key_path: &Path) -> ConfigResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = file
        .metadata()
        .map_err(|error| ConfigError::io("cannot inspect local backup key file", error))?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(key_path, permissions)
        .map_err(|error| ConfigError::io("cannot restrict local backup key file permissions", error))
}

#[cfg(not(unix))]
fn restrict_permissions(_file: &fs::File, _key_path: &Path) -> ConfigResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_key_protector_round_trips_and_is_non_deterministic() {
        let root = tempfile::tempdir().unwrap();
        let protector = LocalKeyBackupProtector::new(root.path()).unwrap();
        let plaintext = b"canary-cli-config-secret";
        let first = protector.protect(plaintext).unwrap();
        let second = protector.protect(plaintext).unwrap();
        assert_ne!(first, second, "每次加密应使用随机 nonce");
        assert_ne!(&first[NONCE_LEN..], plaintext);
        assert_eq!(protector.unprotect(&first).unwrap(), plaintext);
        assert_eq!(protector.unprotect(&second).unwrap(), plaintext);

        let reloaded = LocalKeyBackupProtector::new(root.path()).unwrap();
        assert_eq!(reloaded.unprotect(&first).unwrap(), plaintext);
    }

    #[test]
    fn local_key_protector_rejects_truncated_payload() {
        let root = tempfile::tempdir().unwrap();
        let protector = LocalKeyBackupProtector::new(root.path()).unwrap();
        assert!(protector.unprotect(&[0u8; NONCE_LEN]).is_err());
    }
}
