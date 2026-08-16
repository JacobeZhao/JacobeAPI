fn main() {
    const COMMANDS: &[&str] = &[
        "get_library",
        "commit_library",
        "show_manager",
        "hide_manager",
        "begin_orb_drag",
        "toggle_quick_panel",
        "orb_drag_ended",
        "hide_quick_panel",
        "copy_text",
        "pick_json_file",
        "save_text_file",
        "get_desktop_preferences",
        "set_autostart",
        "set_orb_visible",
        "set_always_on_top",
        "get_account_session",
        "login_netapi",
        "logout_netapi",
        "get_dashboard",
        "get_account_summary",
        "get_leaderboard",
        "scan_cli_configs",
        "preview_cli_config",
        "apply_cli_config",
        "list_cli_config_backups",
        "restore_cli_config_backup",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri application metadata");
}
