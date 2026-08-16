use std::{
    collections::BTreeMap,
    fmt,
    sync::{Mutex, MutexGuard},
};

use thiserror::Error;
use zeroize::Zeroizing;

use crate::netapi::SecretString;

#[cfg(windows)]
const MAX_CREDENTIAL_BYTES: usize = 2_560;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CredentialError {
    #[error("credential storage is unavailable: {0}")]
    Unavailable(String),
}

pub trait CredentialStore: Send + Sync {
    fn load(&self, key: &str) -> Result<Option<SecretString>, CredentialError>;
    fn save(&self, key: &str, value: &SecretString) -> Result<(), CredentialError>;
    fn delete(&self, key: &str) -> Result<(), CredentialError>;
}

#[derive(Default)]
pub struct MemoryCredentialStore {
    values: Mutex<BTreeMap<String, Zeroizing<String>>>,
}

impl MemoryCredentialStore {
    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<String, Zeroizing<String>>>, CredentialError> {
        self.values
            .lock()
            .map_err(|_| CredentialError::Unavailable("credential lock is poisoned".into()))
    }
}

impl fmt::Debug for MemoryCredentialStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let entry_count = self.values.lock().map(|values| values.len()).unwrap_or(0);
        formatter
            .debug_struct("MemoryCredentialStore")
            .field("entry_count", &entry_count)
            .finish()
    }
}

impl CredentialStore for MemoryCredentialStore {
    fn load(&self, key: &str) -> Result<Option<SecretString>, CredentialError> {
        Ok(self
            .lock()?
            .get(key)
            .map(|value| SecretString::new(value.as_str().to_owned())))
    }

    fn save(&self, key: &str, value: &SecretString) -> Result<(), CredentialError> {
        self.lock()?
            .insert(key.to_string(), Zeroizing::new(value.expose().to_owned()));
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), CredentialError> {
        self.lock()?.remove(key);
        Ok(())
    }
}

#[cfg(windows)]
pub struct WindowsCredentialStore {
    target_prefix: String,
}

#[cfg(windows)]
impl WindowsCredentialStore {
    pub fn new(target_prefix: impl Into<String>) -> Result<Self, CredentialError> {
        let target_prefix = target_prefix.into();
        if target_prefix.is_empty() || target_prefix.chars().any(char::is_control) {
            return Err(CredentialError::Unavailable(
                "credential target prefix is invalid".into(),
            ));
        }
        Ok(Self { target_prefix })
    }

    fn target(&self, key: &str) -> Result<Vec<u16>, CredentialError> {
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(CredentialError::Unavailable(
                "credential key is invalid".into(),
            ));
        }
        Ok(format!("{}:{key}\0", self.target_prefix)
            .encode_utf16()
            .collect())
    }

    fn windows_error(operation: &str, error: u32) -> CredentialError {
        CredentialError::Unavailable(format!(
            "Windows Credential Manager {operation} failed with error {error}"
        ))
    }
}

#[cfg(windows)]
fn validate_credential_blob_size(size: usize) -> Result<(), CredentialError> {
    if size == 0 || size > MAX_CREDENTIAL_BYTES {
        return Err(CredentialError::Unavailable(
            "stored credential has an invalid size".into(),
        ));
    }
    Ok(())
}

#[cfg(windows)]
impl fmt::Debug for WindowsCredentialStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WindowsCredentialStore")
            .field("target_prefix", &self.target_prefix)
            .finish_non_exhaustive()
    }
}

#[cfg(windows)]
impl CredentialStore for WindowsCredentialStore {
    fn load(&self, key: &str) -> Result<Option<SecretString>, CredentialError> {
        use std::ptr;
        use windows_sys::Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
        };

        let target = self.target(key)?;
        let mut raw: *mut CREDENTIALW = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return if error == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(Self::windows_error("read", error))
            };
        }
        if raw.is_null() {
            return Err(CredentialError::Unavailable(
                "Windows Credential Manager returned an empty credential".into(),
            ));
        }
        let credential = unsafe { &*raw };
        let blob_size = credential.CredentialBlobSize as usize;
        if let Err(error) = validate_credential_blob_size(blob_size) {
            unsafe { CredFree(raw.cast()) };
            return Err(error);
        }
        let bytes = if credential.CredentialBlob.is_null() {
            unsafe { CredFree(raw.cast()) };
            return Err(CredentialError::Unavailable(
                "Windows Credential Manager returned an invalid credential".into(),
            ));
        } else {
            unsafe { std::slice::from_raw_parts(credential.CredentialBlob, blob_size) }
        };
        let copied = Zeroizing::new(bytes.to_vec());
        let value = std::str::from_utf8(copied.as_slice())
            .map(str::to_owned)
            .map_err(|_| {
                CredentialError::Unavailable("stored credential is not valid UTF-8".into())
            });
        unsafe { CredFree(raw.cast()) };
        value.map(|value| Some(SecretString::new(value)))
    }

    fn save(&self, key: &str, value: &SecretString) -> Result<(), CredentialError> {
        use std::ptr;
        use windows_sys::Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        };

        let target = self.target(key)?;
        let mut username = "JacobeAPI\0".encode_utf16().collect::<Vec<_>>();
        let mut blob = Zeroizing::new(value.expose().as_bytes().to_vec());
        if blob.is_empty() || blob.len() > MAX_CREDENTIAL_BYTES {
            return Err(CredentialError::Unavailable(
                "credential value has an invalid size".into(),
            ));
        }
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr().cast_mut(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            Comment: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            Attributes: ptr::null_mut(),
            ..CREDENTIALW::default()
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return Err(Self::windows_error("write", error));
        }
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), CredentialError> {
        use windows_sys::Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
        };

        let target = self.target(key)?;
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            if error != ERROR_NOT_FOUND {
                return Err(Self::windows_error("delete", error));
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub struct MacOsCredentialStore {
    service: String,
}

#[cfg(target_os = "macos")]
impl MacOsCredentialStore {
    pub fn new(service: impl Into<String>) -> Result<Self, CredentialError> {
        let service = service.into();
        if service.is_empty() || service.chars().any(char::is_control) {
            return Err(CredentialError::Unavailable(
                "Keychain service name is invalid".into(),
            ));
        }
        Ok(Self { service })
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, CredentialError> {
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(CredentialError::Unavailable(
                "credential key is invalid".into(),
            ));
        }
        keyring::Entry::new(&self.service, key).map_err(keychain_error)
    }
}

#[cfg(target_os = "macos")]
impl fmt::Debug for MacOsCredentialStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MacOsCredentialStore")
            .field("service", &self.service)
            .finish_non_exhaustive()
    }
}

#[cfg(target_os = "macos")]
impl CredentialStore for MacOsCredentialStore {
    fn load(&self, key: &str) -> Result<Option<SecretString>, CredentialError> {
        match self.entry(key)?.get_password() {
            Ok(value) => Ok(Some(SecretString::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    fn save(&self, key: &str, value: &SecretString) -> Result<(), CredentialError> {
        if value.expose().is_empty() {
            return Err(CredentialError::Unavailable(
                "credential value must not be empty".into(),
            ));
        }
        self.entry(key)?
            .set_password(value.expose())
            .map_err(keychain_error)
    }

    fn delete(&self, key: &str) -> Result<(), CredentialError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
}

#[cfg(target_os = "macos")]
fn keychain_error(error: keyring::Error) -> CredentialError {
    CredentialError::Unavailable(format!("macOS Keychain operation failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trips_and_redacts_credentials() {
        let store = MemoryCredentialStore::default();
        store
            .save("session", &SecretString::new("sensitive-token"))
            .unwrap();

        let loaded = store.load("session").unwrap().unwrap();
        assert_eq!(loaded.expose(), "sensitive-token");
        assert!(!format!("{store:?}").contains("sensitive-token"));
        store.delete("session").unwrap();
        assert!(store.load("session").unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_credential_blob_size_rejects_empty_and_oversized_values() {
        assert!(validate_credential_blob_size(0).is_err());
        assert!(validate_credential_blob_size(MAX_CREDENTIAL_BYTES).is_ok());
        assert!(validate_credential_blob_size(MAX_CREDENTIAL_BYTES + 1).is_err());
    }
}
