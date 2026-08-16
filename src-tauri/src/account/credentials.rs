use std::{
    collections::BTreeMap,
    fmt,
    sync::{Mutex, MutexGuard},
};

use thiserror::Error;

use crate::netapi::SecretString;

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
    values: Mutex<BTreeMap<String, String>>,
}

impl MemoryCredentialStore {
    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<String, String>>, CredentialError> {
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
        Ok(self.lock()?.get(key).cloned().map(SecretString::new))
    }

    fn save(&self, key: &str, value: &SecretString) -> Result<(), CredentialError> {
        self.lock()?
            .insert(key.to_string(), value.expose().to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), CredentialError> {
        self.lock()?.remove(key);
        Ok(())
    }
}

// Production persistence intentionally remains behind CredentialStore. A Windows
// Credential Manager implementation must replace MemoryCredentialStore before
// live sessions are enabled; the in-memory store does not survive process exit.

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
}
