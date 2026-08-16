use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::error::{AppError, AppResult};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temporary_path(destination: &Path) -> AppResult<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Storage("storage destination has no parent directory".into()))?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Storage("storage destination has an invalid file name".into()))?;
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        sequence
    )))
}

pub(crate) fn atomic_write(destination: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Storage("storage destination has no parent directory".into()))?;
    fs::create_dir_all(parent).map_err(|error| {
        AppError::Storage(format!("failed to create library directory: {error}"))
    })?;

    let mut temporary = temporary_path(destination)?;
    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            temporary = temporary_path(destination)?;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|retry_error| {
                    AppError::Storage(format!("failed to create temporary file: {retry_error}"))
                })?
        }
        Err(error) => {
            return Err(AppError::Storage(format!(
                "failed to create temporary file: {error}"
            )))
        }
    };

    let write_result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, destination)?;
        sync_parent_directory(parent)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Storage(format!(
            "failed to atomically replace {}: {error}",
            destination.display()
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    super::windows_atomic::replace_file(source, destination)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> std::io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> std::io::Result<()> {
    Ok(())
}
