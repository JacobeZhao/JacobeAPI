use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
};

use super::{
    error::{ConfigError, ConfigErrorCode, ConfigResult},
    CliConfigTarget,
};

#[derive(Debug, Clone)]
pub struct CliConfigPaths {
    user_profile: PathBuf,
    codex: PathBuf,
    claude: PathBuf,
}

impl CliConfigPaths {
    pub fn discover(
        user_profile: impl Into<PathBuf>,
        codex_home_override: Option<&OsStr>,
        claude_config_override: Option<&OsStr>,
    ) -> ConfigResult<Self> {
        if codex_home_override.is_some() || claude_config_override.is_some() {
            return Err(ConfigError::new(
                ConfigErrorCode::UnsupportedPath,
                "custom Codex or Claude configuration directories are not supported",
            ));
        }
        let user_profile = user_profile.into();
        if !user_profile.is_absolute() || has_unsafe_prefix(&user_profile) {
            return Err(ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "the user home path is not safe",
            ));
        }
        Ok(Self {
            codex: user_profile.join(".codex").join("config.toml"),
            claude: user_profile.join(".claude").join("settings.json"),
            user_profile,
        })
    }

    pub fn discover_from_environment() -> ConfigResult<Self> {
        #[cfg(windows)]
        const HOME_VARIABLE: &str = "USERPROFILE";
        #[cfg(not(windows))]
        const HOME_VARIABLE: &str = "HOME";

        let profile = std::env::var_os(HOME_VARIABLE).ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::UnsupportedPath,
                format!("{HOME_VARIABLE} is not available"),
            )
        })?;
        Self::discover(
            PathBuf::from(profile),
            std::env::var_os("CODEX_HOME").as_deref(),
            std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(),
        )
    }

    pub fn path_for(&self, target: CliConfigTarget) -> &Path {
        match target {
            CliConfigTarget::Codex => &self.codex,
            CliConfigTarget::Claude => &self.claude,
        }
    }

    pub fn display_path(target: CliConfigTarget) -> String {
        #[cfg(windows)]
        match target {
            CliConfigTarget::Codex => r"~\.codex\config.toml".into(),
            CliConfigTarget::Claude => r"~\.claude\settings.json".into(),
        }
        #[cfg(not(windows))]
        match target {
            CliConfigTarget::Codex => "~/.codex/config.toml".into(),
            CliConfigTarget::Claude => "~/.claude/settings.json".into(),
        }
    }

    pub(crate) fn validate_target_for_preview(
        &self,
        target: CliConfigTarget,
    ) -> ConfigResult<&Path> {
        let path = self.path_for(target);
        let expected_parent = match target {
            CliConfigTarget::Codex => self.user_profile.join(".codex"),
            CliConfigTarget::Claude => self.user_profile.join(".claude"),
        };
        if path.parent() != Some(expected_parent.as_path()) || has_unsafe_prefix(path) {
            return Err(ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "the configuration target is outside the approved path",
            ));
        }
        validate_existing_component(&self.user_profile)?;
        if expected_parent.exists() {
            validate_existing_component(&expected_parent)?;
            if !fs::metadata(&expected_parent)
                .map_err(|error| ConfigError::io("cannot inspect configuration directory", error))?
                .is_dir()
            {
                return Err(ConfigError::new(
                    ConfigErrorCode::UnsafePath,
                    "configuration parent is not a directory",
                ));
            }
        }
        if path.exists() {
            validate_existing_component(path)?;
            if !fs::metadata(path)
                .map_err(|error| ConfigError::io("cannot inspect configuration file", error))?
                .is_file()
            {
                return Err(ConfigError::new(
                    ConfigErrorCode::UnsafePath,
                    "the configuration target is not a regular file",
                ));
            }
        }
        Ok(path)
    }

    pub(crate) fn prepare_target_parent(&self, target: CliConfigTarget) -> ConfigResult<&Path> {
        let path = self.validate_target_for_preview(target)?;
        let parent = path.parent().ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "configuration target has no parent directory",
            )
        })?;
        match fs::create_dir(parent) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(ConfigError::io(
                    "cannot create configuration directory",
                    error,
                ))
            }
        }
        validate_existing_component(parent)?;
        if !fs::metadata(parent)
            .map_err(|error| ConfigError::io("cannot inspect configuration directory", error))?
            .is_dir()
        {
            return Err(ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "configuration parent is not a directory",
            ));
        }
        Ok(path)
    }

    pub(crate) fn validate_target(&self, target: CliConfigTarget) -> ConfigResult<&Path> {
        let path = self.validate_target_for_preview(target)?;
        let parent = path.parent().expect("approved target always has a parent");
        if !parent.exists() {
            return Err(ConfigError::new(
                ConfigErrorCode::ConfigMissing,
                "configuration directory does not exist",
            ));
        }
        Ok(path)
    }
}

#[cfg(windows)]
fn has_unsafe_prefix(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        || matches!(path.components().next(), Some(Component::Prefix(prefix)) if !matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
}

#[cfg(not(windows))]
fn has_unsafe_prefix(path: &Path) -> bool {
    !matches!(path.components().next(), Some(Component::RootDir))
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
}

fn validate_existing_component(path: &Path) -> ConfigResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| ConfigError::io("cannot inspect approved configuration path", error))?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(ConfigError::new(
            ConfigErrorCode::UnsafePath,
            "the configuration path contains a link or reparse point",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_configuration_directory_overrides() {
        let error = CliConfigPaths::discover(
            PathBuf::from(r"C:\Users\test"),
            Some(OsStr::new(r"D:\codex")),
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, ConfigErrorCode::UnsupportedPath);
    }

    #[test]
    fn discovers_only_fixed_user_paths() {
        #[cfg(windows)]
        let profile = PathBuf::from(r"C:\Users\test");
        #[cfg(not(windows))]
        let profile = PathBuf::from("/Users/test");
        let paths = CliConfigPaths::discover(profile.clone(), None, None)
            .expect("fixed paths should be accepted");
        assert_eq!(
            paths.path_for(CliConfigTarget::Codex),
            profile.join(".codex").join("config.toml")
        );
        assert_eq!(
            paths.path_for(CliConfigTarget::Claude),
            profile.join(".claude").join("settings.json")
        );
    }

    #[test]
    fn display_paths_use_the_platform_separator() {
        #[cfg(windows)]
        assert_eq!(
            CliConfigPaths::display_path(CliConfigTarget::Claude),
            r"~\.claude\settings.json"
        );
        #[cfg(not(windows))]
        assert_eq!(
            CliConfigPaths::display_path(CliConfigTarget::Claude),
            "~/.claude/settings.json"
        );
    }
}
