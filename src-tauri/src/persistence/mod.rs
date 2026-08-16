mod atomic;
#[cfg(windows)]
mod windows_atomic;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    domain::{
        default_library_state, latest_seed_pack_version, migrate_to_latest_seed_pack, LibraryState,
        SeedPackMigration, MAX_SLOT_BYTES, SCHEMA_VERSION,
    },
    error::{AppError, AppResult},
};

use self::atomic::atomic_write;

const SLOT_A_FILE: &str = "slot-a.json";
const SLOT_B_FILE: &str = "slot-b.json";
const META_FILE: &str = "meta.json";
const SEED_PACK_STATE_FILE: &str = "seed-pack.json";
const SLOT_FORMAT: &str = "jacobe-library-slot";
const META_FORMAT: &str = "jacobe-library-meta";
const MAX_META_BYTES: usize = 16 * 1024;
const MAX_SEED_PACK_STATE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SlotName {
    A,
    B,
}

impl SlotName {
    fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSlot {
    format: String,
    schema_version: u32,
    revision: u64,
    checksum: String,
    state: LibraryState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredMeta {
    format: String,
    schema_version: u32,
    active_slot: SlotName,
    revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSeedPackState {
    format: String,
    version: u32,
}

#[derive(Debug)]
struct LoadedLibrary {
    state: LibraryState,
    active_slot: SlotName,
}

#[derive(Debug)]
pub struct LibraryStore {
    root: PathBuf,
    gate: Mutex<()>,
}

impl LibraryStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            gate: Mutex::new(()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load(&self) -> AppResult<LibraryState> {
        let _guard = self.lock()?;
        Ok(self.load_locked()?.state)
    }

    pub fn commit(&self, base_revision: u64, candidate: LibraryState) -> AppResult<LibraryState> {
        let _guard = self.lock()?;
        let current = self.load_locked()?;
        if current.state.revision != base_revision {
            return Err(AppError::Conflict {
                current: Box::new(current.state),
            });
        }
        candidate.validate_candidate(base_revision)?;

        let destination = current.active_slot.other();
        let slot = StoredSlot::from_state(candidate.clone())?;
        let slot_bytes = serialize_slot(&slot)?;
        atomic_write(&self.slot_path(destination), &slot_bytes)?;

        let verified_slot = self.read_slot(destination)?.ok_or_else(|| {
            AppError::Corruption("new library slot failed read-back validation".into())
        })?;
        if verified_slot.revision != candidate.revision || verified_slot.state != candidate {
            return Err(AppError::Corruption(
                "new library slot changed during read-back validation".into(),
            ));
        }

        let meta = StoredMeta::new(destination, candidate.revision);
        self.write_meta(&meta)?;
        let verified_meta = self.read_meta()?.ok_or_else(|| {
            AppError::Corruption("new library metadata failed read-back validation".into())
        })?;
        if verified_meta.active_slot != destination || verified_meta.revision != candidate.revision
        {
            return Err(AppError::Corruption(
                "new library metadata changed during read-back validation".into(),
            ));
        }
        Ok(candidate)
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.gate
            .lock()
            .map_err(|_| AppError::Storage("library commit lock is poisoned".into()))
    }

    fn load_locked(&self) -> AppResult<LoadedLibrary> {
        let loaded = self.load_stored_locked()?;
        self.ensure_seed_pack_locked(loaded)
    }

    fn load_stored_locked(&self) -> AppResult<LoadedLibrary> {
        fs::create_dir_all(&self.root).map_err(|error| {
            AppError::Storage(format!("failed to create library directory: {error}"))
        })?;

        let slot_a = self.read_slot(SlotName::A)?;
        let slot_b = self.read_slot(SlotName::B)?;
        let meta = self.read_meta()?;
        let has_data = self.slot_path(SlotName::A).exists()
            || self.slot_path(SlotName::B).exists()
            || self.meta_path().exists();

        if slot_a.is_none() && slot_b.is_none() {
            if has_data {
                return Err(AppError::Corruption(
                    "both library storage slots are damaged".into(),
                ));
            }
            return self.initialize_locked();
        }

        if let Some(meta) = meta {
            let active = match meta.active_slot {
                SlotName::A => slot_a.as_ref(),
                SlotName::B => slot_b.as_ref(),
            };
            if let Some(active) = active {
                if active.revision == meta.revision {
                    return Ok(LoadedLibrary {
                        state: active.state.clone(),
                        active_slot: meta.active_slot,
                    });
                }
            }
        }

        let (active_slot, recovered) = match (slot_a, slot_b) {
            (Some(a), Some(b)) if a.revision >= b.revision => (SlotName::A, a),
            (Some(_), Some(b)) => (SlotName::B, b),
            (Some(a), None) => (SlotName::A, a),
            (None, Some(b)) => (SlotName::B, b),
            (None, None) => unreachable!("handled above"),
        };
        let repaired_meta = StoredMeta::new(active_slot, recovered.revision);
        self.write_meta(&repaired_meta)?;
        let verified = self.read_meta()?.ok_or_else(|| {
            AppError::Corruption("recovered metadata failed read-back validation".into())
        })?;
        if verified.active_slot != active_slot || verified.revision != recovered.revision {
            return Err(AppError::Corruption(
                "recovered metadata changed during read-back validation".into(),
            ));
        }
        Ok(LoadedLibrary {
            state: recovered.state,
            active_slot,
        })
    }

    fn initialize_locked(&self) -> AppResult<LoadedLibrary> {
        let state = default_library_state();
        state.validate()?;
        let slot = StoredSlot::from_state(state.clone())?;
        atomic_write(&self.slot_path(SlotName::A), &serialize_slot(&slot)?)?;
        let verified_slot = self.read_slot(SlotName::A)?.ok_or_else(|| {
            AppError::Corruption("initial library slot failed read-back validation".into())
        })?;
        if verified_slot.state != state {
            return Err(AppError::Corruption(
                "initial library slot changed during read-back validation".into(),
            ));
        }

        let meta = StoredMeta::new(SlotName::A, state.revision);
        self.write_meta(&meta)?;
        let verified_meta = self.read_meta()?.ok_or_else(|| {
            AppError::Corruption("initial library metadata failed read-back validation".into())
        })?;
        if verified_meta.active_slot != SlotName::A || verified_meta.revision != state.revision {
            return Err(AppError::Corruption(
                "initial library metadata changed during read-back validation".into(),
            ));
        }
        self.write_seed_pack_state()?;
        Ok(LoadedLibrary {
            state,
            active_slot: SlotName::A,
        })
    }

    fn slot_path(&self, slot: SlotName) -> PathBuf {
        self.root.join(match slot {
            SlotName::A => SLOT_A_FILE,
            SlotName::B => SLOT_B_FILE,
        })
    }

    fn meta_path(&self) -> PathBuf {
        self.root.join(META_FILE)
    }

    fn seed_pack_state_path(&self) -> PathBuf {
        self.root.join(SEED_PACK_STATE_FILE)
    }

    fn ensure_seed_pack_locked(&self, current: LoadedLibrary) -> AppResult<LoadedLibrary> {
        if self
            .read_seed_pack_state()?
            .is_some_and(|marker| marker.version >= latest_seed_pack_version())
        {
            return Ok(current);
        }

        let migration = migrate_to_latest_seed_pack(&current.state)?;
        if migration == SeedPackMigration::Deferred {
            return Ok(current);
        }
        let migrated = if let SeedPackMigration::Applied(next_state) = migration {
            let destination = current.active_slot.other();
            let slot = StoredSlot::from_state(next_state.clone())?;
            atomic_write(&self.slot_path(destination), &serialize_slot(&slot)?)?;
            let verified_slot = self.read_slot(destination)?.ok_or_else(|| {
                AppError::Corruption("migrated library slot failed read-back validation".into())
            })?;
            if verified_slot.revision != next_state.revision || verified_slot.state != next_state {
                return Err(AppError::Corruption(
                    "migrated library slot changed during read-back validation".into(),
                ));
            }

            let meta = StoredMeta::new(destination, next_state.revision);
            self.write_meta(&meta)?;
            let verified_meta = self.read_meta()?.ok_or_else(|| {
                AppError::Corruption("migrated library metadata failed read-back validation".into())
            })?;
            if verified_meta.active_slot != destination
                || verified_meta.revision != next_state.revision
            {
                return Err(AppError::Corruption(
                    "migrated library metadata changed during read-back validation".into(),
                ));
            }
            LoadedLibrary {
                state: next_state,
                active_slot: destination,
            }
        } else {
            current
        };

        self.write_seed_pack_state()?;
        Ok(migrated)
    }

    fn read_slot(&self, slot: SlotName) -> AppResult<Option<StoredSlot>> {
        let Some(parsed) = read_limited_json::<StoredSlot>(&self.slot_path(slot), MAX_SLOT_BYTES)?
        else {
            return Ok(None);
        };
        if parsed.is_valid() {
            Ok(Some(parsed))
        } else {
            Ok(None)
        }
    }

    fn read_meta(&self) -> AppResult<Option<StoredMeta>> {
        let Some(parsed) = read_limited_json::<StoredMeta>(&self.meta_path(), MAX_META_BYTES)?
        else {
            return Ok(None);
        };
        if parsed.format == META_FORMAT
            && parsed.schema_version == SCHEMA_VERSION
            && parsed.revision <= crate::domain::MAX_SAFE_REVISION
        {
            Ok(Some(parsed))
        } else {
            Ok(None)
        }
    }

    fn read_seed_pack_state(&self) -> AppResult<Option<StoredSeedPackState>> {
        let Some(parsed) = read_limited_json::<StoredSeedPackState>(
            &self.seed_pack_state_path(),
            MAX_SEED_PACK_STATE_BYTES,
        )?
        else {
            return Ok(None);
        };
        if parsed.format == "jacobe-seed-pack-state" {
            Ok(Some(parsed))
        } else {
            Ok(None)
        }
    }

    fn write_meta(&self, meta: &StoredMeta) -> AppResult<()> {
        let bytes = serde_json::to_vec(meta)
            .map_err(|error| AppError::Storage(format!("failed to serialize metadata: {error}")))?;
        atomic_write(&self.meta_path(), &bytes)
    }

    fn write_seed_pack_state(&self) -> AppResult<()> {
        let marker = StoredSeedPackState {
            format: "jacobe-seed-pack-state".into(),
            version: latest_seed_pack_version(),
        };
        let bytes = serde_json::to_vec(&marker).map_err(|error| {
            AppError::Storage(format!("failed to serialize seed pack state: {error}"))
        })?;
        atomic_write(&self.seed_pack_state_path(), &bytes)?;
        let verified = self.read_seed_pack_state()?.ok_or_else(|| {
            AppError::Corruption("seed pack state failed read-back validation".into())
        })?;
        if verified.version != marker.version {
            return Err(AppError::Corruption(
                "seed pack state changed during read-back validation".into(),
            ));
        }
        Ok(())
    }
}

impl StoredSlot {
    fn from_state(state: LibraryState) -> AppResult<Self> {
        state.validate()?;
        let checksum = state_checksum(&state)?;
        Ok(Self {
            format: SLOT_FORMAT.into(),
            schema_version: SCHEMA_VERSION,
            revision: state.revision,
            checksum,
            state,
        })
    }

    fn is_valid(&self) -> bool {
        self.format == SLOT_FORMAT
            && self.schema_version == SCHEMA_VERSION
            && self.revision == self.state.revision
            && self.state.validate().is_ok()
            && state_checksum(&self.state).is_ok_and(|checksum| checksum == self.checksum)
    }
}

impl StoredMeta {
    fn new(active_slot: SlotName, revision: u64) -> Self {
        Self {
            format: META_FORMAT.into(),
            schema_version: SCHEMA_VERSION,
            active_slot,
            revision,
        }
    }
}

fn state_checksum(state: &LibraryState) -> AppResult<String> {
    let bytes = serde_json::to_vec(state).map_err(|error| {
        AppError::Storage(format!("failed to serialize library state: {error}"))
    })?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn serialize_slot(slot: &StoredSlot) -> AppResult<Vec<u8>> {
    let bytes = serde_json::to_vec(slot)
        .map_err(|error| AppError::Storage(format!("failed to serialize library slot: {error}")))?;
    if bytes.len() > MAX_SLOT_BYTES {
        return Err(AppError::StorageLimit { bytes: bytes.len() });
    }
    Ok(bytes)
}

fn read_limited_json<T: DeserializeOwned>(path: &Path, max_bytes: usize) -> AppResult<Option<T>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(AppError::Storage(format!(
                "failed to inspect {}: {error}",
                path.display()
            )))
        }
    };
    if metadata.len() > max_bytes as u64 {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::Storage(format!("failed to read {}: {error}", path.display()))
    })?;
    Ok(serde_json::from_slice(&bytes).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::MAX_CARDS;
    use uuid::Uuid;

    #[test]
    fn fresh_store_records_seed_version_and_deleted_presets_stay_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let store = LibraryStore::new(directory.path());
        let initial = store.load().unwrap();
        assert_eq!(initial.skills.len(), 2);
        assert_eq!(initial.mcps.len(), 3);
        assert_eq!(
            store.read_seed_pack_state().unwrap().unwrap().version,
            latest_seed_pack_version()
        );

        let mut candidate = initial.clone();
        let deleted_id = candidate.skills.remove(0).id;
        candidate.revision += 1;
        let committed = store.commit(initial.revision, candidate).unwrap();
        let loaded_again = store.load().unwrap();
        assert_eq!(loaded_again, committed);
        assert!(!loaded_again.skills.iter().any(|card| card.id == deleted_id));
    }

    #[test]
    fn full_library_remains_readable_and_migration_marker_is_deferred() {
        let directory = tempfile::tempdir().unwrap();
        let store = LibraryStore::new(directory.path());
        fs::create_dir_all(store.root()).unwrap();
        let mut full = default_library_state();
        let template = full.skills[0].clone();
        full.skills = (0..MAX_CARDS)
            .map(|_| {
                let mut card = template.clone();
                card.id = Uuid::new_v4().to_string();
                card
            })
            .collect();
        full.mcps.clear();
        let slot = StoredSlot::from_state(full.clone()).unwrap();
        fs::write(store.slot_path(SlotName::A), serialize_slot(&slot).unwrap()).unwrap();
        store
            .write_meta(&StoredMeta::new(SlotName::A, full.revision))
            .unwrap();

        assert_eq!(store.load().unwrap(), full);
        assert!(!store.seed_pack_state_path().exists());
    }
}
