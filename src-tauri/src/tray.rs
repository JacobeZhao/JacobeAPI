use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Runtime, Window,
};

use crate::{commands, windows};

const SHOW_MANAGER_ID: &str = "show_manager";
const TOGGLE_ORB_ID: &str = "toggle_orb";
const TOGGLE_AUTOSTART_ID: &str = "toggle_autostart";
const QUIT_ID: &str = "quit";

static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn exit_requested() -> bool {
    EXIT_REQUESTED.load(Ordering::SeqCst)
}

pub fn request_exit<R: Runtime>(app: &AppHandle<R>) {
    EXIT_REQUESTED.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn handle_window_close<R: Runtime>(window: &Window<R>, api: &tauri::CloseRequestApi) {
    if matches!(
        window.label(),
        windows::MANAGER_LABEL | windows::QUICK_LABEL
    ) && !exit_requested()
    {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_manager =
        MenuItem::with_id(app, SHOW_MANAGER_ID, "Open JacobeAPI", true, None::<&str>)?;
    let show_orb = CheckMenuItem::with_id(
        app,
        TOGGLE_ORB_ID,
        "Show floating orb",
        true,
        windows::orb_visible(app).unwrap_or(true),
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        TOGGLE_AUTOSTART_ID,
        "Launch at startup",
        true,
        commands::autostart_enabled(app).unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_manager, &show_orb, &autostart, &quit])?;

    let orb_item = show_orb.clone();
    let autostart_item = autostart.clone();
    let mut builder = TrayIconBuilder::new()
        .tooltip("JacobeAPI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            SHOW_MANAGER_ID => {
                let _ = windows::show_manager_home(app);
            }
            TOGGLE_ORB_ID => {
                let requested = orb_item.is_checked().unwrap_or(true);
                let _ = windows::set_orb_visible(app, requested);
                let actual = windows::orb_visible(app).unwrap_or(!requested);
                let _ = orb_item.set_checked(actual);
            }
            TOGGLE_AUTOSTART_ID => {
                let requested = autostart_item.is_checked().unwrap_or(false);
                let actual = commands::set_autostart_enabled(app, requested)
                    .or_else(|_| commands::autostart_enabled(app))
                    .unwrap_or(!requested);
                let _ = autostart_item.set_checked(actual);
            }
            QUIT_ID => request_exit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
