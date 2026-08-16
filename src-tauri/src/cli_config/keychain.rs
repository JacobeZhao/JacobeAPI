use std::sync::{Mutex, MutexGuard};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use zeroize::Zeroizing;

use crate::{
    account::{CredentialStore, MacOsCredentialStore},
    netapi::SecretString,
};

use super::{
    engine::BackupProtector,
    error::{ConfigError, ConfigErrorCode, ConfigResult},
};

const KEY_ACCOUNT: &str = "cli-backup-key-v1";
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const ENVELOPE_MAGIC: &[u8] = b"JACOBE-MAC-BACKUP-V1\0";

#[derive(Debug)]
pub struct MacOsBackupProtector {
    credentials: MacOsCredentialStore,
    key_gate: Mutex<()>,
}

impl MacOsBackupProtector {
    pub fn new(service: impl Into<String>) -> ConfigResult<Self> {
        let credentials = MacOsCredentialStore::new(service).map_err(protection_error)?;
        Ok(Self {
            credentials,
            key_gate: Mutex::new(()),
        })
    }

    fn lock_key(&self) -> ConfigResult<MutexGuard<'_, ()>> {
        self.key_gate.lock().map_err(|_| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                "backup encryption key lock is unavailable",
            )
        })
    }

    fn load_or_create_key(&self) -> ConfigResult<Zeroizing<Vec<u8>>> {
        if let Some(value) = self
            .credentials
            .load(KEY_ACCOUNT)
            .map_err(protection_error)?
        {
            return decode_key(value.expose());
        }

        let mut key = Zeroizing::new(vec![0_u8; KEY_BYTES]);
        getrandom::fill(&mut key).map_err(|error| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                format!("cannot generate a backup encryption key: {error}"),
            )
        })?;
        let encoded = SecretString::new(hex::encode(key.as_slice()));
        self.credentials
            .save(KEY_ACCOUNT, &encoded)
            .map_err(protection_error)?;
        Ok(key)
    }

    fn load_key(&self) -> ConfigResult<Zeroizing<Vec<u8>>> {
        let value = self
            .credentials
            .load(KEY_ACCOUNT)
            .map_err(protection_error)?
            .ok_or_else(|| {
                ConfigError::new(
                    ConfigErrorCode::ProtectionFailed,
                    "the macOS Keychain backup key is missing",
                )
            })?;
        decode_key(value.expose())
    }
}

impl BackupProtector for MacOsBackupProtector {
    fn protect(&self, plaintext: &[u8]) -> ConfigResult<Vec<u8>> {
        let _gate = self.lock_key()?;
        let key = self.load_or_create_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(cipher_error)?;
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        getrandom::fill(&mut nonce_bytes).map_err(|error| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                format!("cannot generate a backup encryption nonce: {error}"),
            )
        })?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: plaintext,
                    aad: ENVELOPE_MAGIC,
                },
            )
            .map_err(cipher_error)?;
        let mut envelope =
            Vec::with_capacity(ENVELOPE_MAGIC.len() + NONCE_BYTES + ciphertext.len());
        envelope.extend_from_slice(ENVELOPE_MAGIC);
        envelope.extend_from_slice(&nonce_bytes);
        envelope.extend_from_slice(&ciphertext);
        Ok(envelope)
    }

    fn unprotect(&self, ciphertext: &[u8]) -> ConfigResult<Vec<u8>> {
        let payload = ciphertext.strip_prefix(ENVELOPE_MAGIC).ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                "configuration backup is not a macOS encrypted backup",
            )
        })?;
        let (nonce_bytes, encrypted) = payload.split_at_checked(NONCE_BYTES).ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::ProtectionFailed,
                "configuration backup encryption envelope is damaged",
            )
        })?;
        let _gate = self.lock_key()?;
        let key = self.load_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(cipher_error)?;
        cipher
            .decrypt(
                Nonce::from_slice(nonce_bytes),
                Payload {
                    msg: encrypted,
                    aad: ENVELOPE_MAGIC,
                },
            )
            .map_err(cipher_error)
    }
}

fn decode_key(encoded: &str) -> ConfigResult<Zeroizing<Vec<u8>>> {
    let key = Zeroizing::new(hex::decode(encoded).map_err(|_| {
        ConfigError::new(
            ConfigErrorCode::ProtectionFailed,
            "the macOS Keychain backup key is invalid",
        )
    })?);
    if key.len() != KEY_BYTES {
        return Err(ConfigError::new(
            ConfigErrorCode::ProtectionFailed,
            "the macOS Keychain backup key has an invalid size",
        ));
    }
    Ok(key)
}

fn protection_error(error: impl std::fmt::Display) -> ConfigError {
    ConfigError::new(
        ConfigErrorCode::ProtectionFailed,
        format!("macOS Keychain backup protection is unavailable: {error}"),
    )
}

fn cipher_error(error: impl std::fmt::Display) -> ConfigError {
    ConfigError::new(
        ConfigErrorCode::ProtectionFailed,
        format!("macOS backup encryption failed: {error}"),
    )
}
