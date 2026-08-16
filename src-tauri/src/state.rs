use std::{path::PathBuf, sync::Arc};

use crate::account::AccountService;
#[cfg(target_os = "macos")]
use crate::account::MacOsCredentialStore;
#[cfg(windows)]
use crate::account::WindowsCredentialStore;
#[cfg(windows)]
use crate::cli_config::DpapiBackupProtector;
#[cfg(target_os = "macos")]
use crate::cli_config::MacOsBackupProtector;
use crate::cli_config::{CliConfigPaths, ConfigEngine};
use crate::persistence::LibraryStore;

#[cfg(target_os = "macos")]
const CREDENTIAL_SERVICE: &str = "com.jacobe.skills.JacobeAPI";

pub struct AppState {
    pub library: LibraryStore,
    pub account: AccountService,
    pub cli_config: Option<ConfigEngine>,
}

impl AppState {
    pub fn new(app_local_data_root: impl Into<PathBuf>) -> Self {
        let app_local_data_root = app_local_data_root.into();
        let cli_config = build_cli_config(&app_local_data_root);
        #[cfg(windows)]
        let account = AccountService::mock_with_credentials(Arc::new(
            WindowsCredentialStore::new("JacobeAPI:com.jacobe.skills")
                .expect("the fixed credential target must be valid"),
        ));
        #[cfg(target_os = "macos")]
        let account = AccountService::mock_with_credentials(Arc::new(
            MacOsCredentialStore::new(CREDENTIAL_SERVICE)
                .expect("the fixed Keychain service must be valid"),
        ));
        #[cfg(not(any(windows, target_os = "macos")))]
        let account = AccountService::mock();
        Self {
            library: LibraryStore::new(app_local_data_root.join("library")),
            account,
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
fn build_cli_config(app_local_data_root: &std::path::Path) -> Option<ConfigEngine> {
    CliConfigPaths::discover_from_environment()
        .and_then(|paths| {
            ConfigEngine::new(
                paths,
                app_local_data_root.join("cli-config-backups"),
                Arc::new(DpapiBackupProtector),
            )
        })
        .ok()
}

#[cfg(target_os = "macos")]
fn build_cli_config(app_local_data_root: &std::path::Path) -> Option<ConfigEngine> {
    CliConfigPaths::discover_from_environment()
        .and_then(|paths| {
            ConfigEngine::new(
                paths,
                app_local_data_root.join("cli-config-backups"),
                Arc::new(MacOsBackupProtector::new(CREDENTIAL_SERVICE)?),
            )
        })
        .ok()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn build_cli_config(_app_local_data_root: &std::path::Path) -> Option<ConfigEngine> {
    None
}
