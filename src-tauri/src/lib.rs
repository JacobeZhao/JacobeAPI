pub mod account;
pub mod cli_config;
pub mod commands;
pub mod domain;
pub mod error;
pub mod netapi;
pub mod persistence;
pub mod state;
pub mod tray;
pub mod windows;

use tauri::{Manager, WindowEvent};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::handle_second_instance(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Jacobe Skills")
                .arg("--autostart")
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::commit_library,
            commands::show_manager,
            commands::hide_manager,
            commands::begin_orb_drag,
            commands::toggle_quick_panel,
            commands::orb_drag_ended,
            commands::hide_quick_panel,
            commands::copy_text,
            commands::pick_json_file,
            commands::save_text_file,
            commands::get_desktop_preferences,
            commands::set_autostart,
            commands::set_orb_visible,
            commands::set_always_on_top,
            commands::get_account_session,
            commands::login_netapi,
            commands::logout_netapi,
            commands::get_dashboard,
            commands::get_account_summary,
            commands::get_leaderboard,
            commands::scan_cli_configs,
            commands::preview_cli_config,
            commands::apply_cli_config,
            commands::list_cli_config_backups,
            commands::restore_cli_config_backup,
        ])
        .setup(|app| {
            let data_root = app.path().app_local_data_dir()?;
            let first_run = !data_root.join("library").exists();
            let state = AppState::new(data_root);
            state.library.load()?;
            app.manage(state);

            windows::setup_windows(app.handle())?;
            tray::setup_tray(app.handle())?;

            let launched_at_startup = std::env::args().any(|arg| arg == "--autostart");
            if first_run && !launched_at_startup {
                windows::show_manager_home(app.handle())?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => tray::handle_window_close(window, api),
            WindowEvent::Focused(false) if window.label() == windows::QUICK_LABEL => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
}
