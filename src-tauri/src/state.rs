use std::{path::PathBuf, sync::Arc};

use crate::account::AccountService;
use crate::cli_config::{CliConfigPaths, ConfigEngine, DpapiBackupProtector};
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
            .and_then(|paths| {
                ConfigEngine::new(
                    paths,
                    app_local_data_root.join("cli-config-backups"),
                    Arc::new(DpapiBackupProtector),
                )
            })
            .ok();
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
