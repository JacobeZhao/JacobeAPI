use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::account::AccountService;
use crate::cli_config::{BackupProtector, CliConfigPaths, ConfigEngine};
#[cfg(windows)]
use crate::cli_config::DpapiBackupProtector;
#[cfg(not(windows))]
use crate::cli_config::LocalKeyBackupProtector;
use crate::persistence::LibraryStore;

pub struct AppState {
    pub library: LibraryStore,
    pub account: AccountService,
    pub cli_config: Option<ConfigEngine>,
}

impl AppState {
    pub fn new(app_local_data_root: impl Into<PathBuf>) -> Self {
        let app_local_data_root = app_local_data_root.into();
        let cli_config = CliConfigPaths::discover_from_environment()
            .ok()
            .and_then(|paths| {
                let protector = backup_protector(&app_local_data_root)?;
                ConfigEngine::new(
                    paths,
                    app_local_data_root.join("cli-config-backups"),
                    protector,
                )
                .ok()
            });
        Self {
            library: LibraryStore::new(app_local_data_root.join("library")),
            account: AccountService::mock(),
            cli_config,
        }
    }

    pub fn with_library_root(library_root: impl Into<PathBuf>) -> Self {
        Self {
            library: LibraryStore::new(library_root),
            account: AccountService::mock(),
            cli_config: None,
        }
    }
}

#[cfg(windows)]
fn backup_protector(_app_local_data_root: &Path) -> Option<Arc<dyn BackupProtector>> {
    Some(Arc::new(DpapiBackupProtector))
}

#[cfg(not(windows))]
fn backup_protector(app_local_data_root: &Path) -> Option<Arc<dyn BackupProtector>> {
    let protector = LocalKeyBackupProtector::new(app_local_data_root).ok()?;
    Some(Arc::new(protector))
}
