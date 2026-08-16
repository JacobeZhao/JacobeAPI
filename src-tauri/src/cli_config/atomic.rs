use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use super::error::{ConfigError, ConfigErrorCode, ConfigResult};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn read_limited(path: &Path, max_bytes: u64) -> ConfigResult<(bool, Vec<u8>)> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((false, Vec::new()))
        }
        Err(error) => return Err(ConfigError::io("cannot inspect configuration", error)),
    };
    if !metadata.is_file() {
        return Err(ConfigError::new(
            ConfigErrorCode::UnsafePath,
            "configuration target is not a regular file",
        ));
    }
    if metadata.len() > max_bytes {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigInvalid,
            "configuration file exceeds the size limit",
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| ConfigError::io("cannot read configuration", error))?;
    if bytes.len() as u64 > max_bytes {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigInvalid,
            "configuration file exceeds the size limit",
        ));
    }
    Ok((true, bytes))
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> ConfigResult<()> {
    let parent = path.parent().ok_or_else(|| {
        ConfigError::new(
            ConfigErrorCode::UnsafePath,
            "configuration target has no parent directory",
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "configuration target has an invalid file name",
            )
        })?;
    let temporary = create_temporary(parent, file_name)?;
    let result = write_and_replace(&temporary, path, bytes);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| ConfigError::io("cannot atomically replace configuration", error))?;
    sync_parent(parent)
        .map_err(|error| ConfigError::io("cannot sync configuration directory", error))
}

pub(crate) fn atomic_remove(path: &Path) -> ConfigResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| {
        ConfigError::new(
            ConfigErrorCode::UnsafePath,
            "configuration target has no parent",
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::UnsafePath,
                "configuration file name is invalid",
            )
        })?;
    let tombstone = temporary_path(parent, file_name, "rollback-delete");
    fs::rename(path, &tombstone)
        .map_err(|error| ConfigError::io("cannot stage configuration removal", error))?;
    sync_parent(parent)
        .map_err(|error| ConfigError::io("cannot sync configuration removal", error))?;
    fs::remove_file(tombstone)
        .map_err(|error| ConfigError::io("cannot finish configuration removal", error))
}

fn create_temporary(parent: &Path, file_name: &str) -> ConfigResult<PathBuf> {
    for _ in 0..16 {
        let path = temporary_path(parent, file_name, "write");
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(ConfigError::io("cannot create temporary file", error)),
        }
    }
    Err(ConfigError::new(
        ConfigErrorCode::Io,
        "cannot allocate a temporary configuration file",
    ))
}

fn temporary_path(parent: &Path, file_name: &str, operation: &str) -> PathBuf {
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(
        ".{file_name}.{}.{}.{}.tmp",
        std::process::id(),
        sequence,
        operation
    ))
}

fn write_and_replace(temporary: &Path, destination: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(temporary)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_all()?;
    drop(file);
    replace_file(temporary, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
    };

    let destination_exists = destination.exists();
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        if destination_exists {
            ReplaceFileW(
                destination.as_ptr(),
                source.as_ptr(),
                ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                ptr::null(),
                ptr::null(),
            )
        } else {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        }
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> std::io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> std::io::Result<()> {
    Ok(())
}
