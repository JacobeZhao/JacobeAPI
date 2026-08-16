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
                "the user profile path is not safe",
            ));
        }
        Ok(Self {
            codex: user_profile.join(".codex").join("config.toml"),
            claude: user_profile.join(".claude").join("settings.json"),
            user_profile,
        })
    }

    pub fn discover_from_environment() -> ConfigResult<Self> {
        let profile = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .ok_or_else(|| {
                ConfigError::new(
                    ConfigErrorCode::UnsupportedPath,
                    "USERPROFILE/HOME is not available",
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
        match target {
            CliConfigTarget::Codex => {
                if cfg!(windows) {
                    r"~\.codex\config.toml".into()
                } else {
                    "~/.codex/config.toml".into()
                }
            }
            CliConfigTarget::Claude => {
                if cfg!(windows) {
                    r"~\.claude\settings.json".into()
                } else {
                    "~/.claude/settings.json".into()
                }
            }
        }
    }

    pub(crate) fn validate_target(&self, target: CliConfigTarget) -> ConfigResult<&Path> {
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
        validate_existing_component(&expected_parent)?;
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
}

fn has_unsafe_prefix(path: &Path) -> bool {
    matches!(path.components().next(), Some(Component::Prefix(prefix)) if !matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
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
    #[cfg(windows)]
    fn discovers_only_fixed_user_paths() {
        let paths = CliConfigPaths::discover(PathBuf::from(r"C:\Users\test"), None, None)
            .expect("fixed paths should be accepted");
        assert_eq!(
            paths.path_for(CliConfigTarget::Codex),
            Path::new(r"C:\Users\test\.codex\config.toml")
        );
        assert_eq!(
            paths.path_for(CliConfigTarget::Claude),
            Path::new(r"C:\Users\test\.claude\settings.json")
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn discovers_only_fixed_user_paths() {
        let paths = CliConfigPaths::discover(PathBuf::from("/Users/test"), None, None)
            .expect("fixed paths should be accepted");
        assert_eq!(
            paths.path_for(CliConfigTarget::Codex),
            Path::new("/Users/test/.codex/config.toml")
        );
        assert_eq!(
            paths.path_for(CliConfigTarget::Claude),
            Path::new("/Users/test/.claude/settings.json")
        );
    }
}
