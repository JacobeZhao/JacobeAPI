#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

const STARTUP_LOG_MAX_BYTES: usize = 8 * 1024;

fn startup_log_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|root| {
        PathBuf::from(root)
            .join("com.jacobe.skills")
            .join("startup-error.log")
    })
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }

    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn write_startup_error(error: &tauri::Error) {
    let Some(path) = startup_log_path() else {
        return;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let message = format!("timestamp_unix_seconds={timestamp}\nerror={error}\n");
    let message = truncate_utf8(&message, STARTUP_LOG_MAX_BYTES);

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, message);
}

fn main() {
    if let Err(error) = jacobe_skills_lib::run() {
        write_startup_error(&error);
        std::process::exit(1);
    }
}
