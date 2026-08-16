#![cfg(windows)]

use std::{os::windows::ffi::OsStrExt, path::Path};

use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    let source = wide_path(source);
    let destination = wide_path(destination);
    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;
    // SAFETY: Both paths are owned, NUL-terminated UTF-16 buffers that remain alive for the call.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
