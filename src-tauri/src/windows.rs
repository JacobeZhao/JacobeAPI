use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindowBuilder,
};

pub const ORB_LABEL: &str = "orb";
pub const QUICK_LABEL: &str = "quick";
pub const MANAGER_LABEL: &str = "manager";
pub const ORB_SIZE: u32 = 56;
pub const QUICK_WIDTH: u32 = 420;
pub const QUICK_HEIGHT: u32 = 700;
pub const WINDOW_MARGIN: i32 = 8;
pub const QUICK_GAP: i32 = 8;
const SETTINGS_FILE: &str = "desktop-settings.json";
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HorizontalEdge {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExpandDirection {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlacement {
    pub rect: WindowRect,
    pub direction: ExpandDirection,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSettings {
    orb_edge: HorizontalEdge,
    orb_relative_y: f64,
    orb_visible: bool,
    always_on_top: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            orb_edge: HorizontalEdge::Right,
            orb_relative_y: 2.0 / 3.0,
            orb_visible: true,
            always_on_top: true,
        }
    }
}

impl WorkArea {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn contains(self, point: Point) -> bool {
        i64::from(point.x) >= i64::from(self.x)
            && i64::from(point.x) < self.right()
            && i64::from(point.y) >= i64::from(self.y)
            && i64::from(point.y) < self.bottom()
    }
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.clamp(min, max.max(min))
}

fn distance_to_work_area(point: Point, area: WorkArea) -> i128 {
    // Treat monitor edges as geometric boundaries when comparing gaps so ties
    // between two displays remain deterministic.
    let right = area.right().max(i64::from(area.x));
    let bottom = area.bottom().max(i64::from(area.y));
    let closest_x = clamp_i64(i64::from(point.x), i64::from(area.x), right);
    let closest_y = clamp_i64(i64::from(point.y), i64::from(area.y), bottom);
    let dx = i128::from(i64::from(point.x) - closest_x);
    let dy = i128::from(i64::from(point.y) - closest_y);
    dx * dx + dy * dy
}

pub fn choose_work_area(point: Point, work_areas: &[WorkArea]) -> Option<WorkArea> {
    work_areas
        .iter()
        .copied()
        .find(|area| area.contains(point))
        .or_else(|| {
            work_areas
                .iter()
                .copied()
                .enumerate()
                .min_by_key(|(index, area)| (distance_to_work_area(point, *area), *index))
                .map(|(_, area)| area)
        })
}

pub fn choose_work_area_for_rect(rect: WindowRect, work_areas: &[WorkArea]) -> Option<WorkArea> {
    let center = Point {
        x: (i64::from(rect.x) + i64::from(rect.width) / 2)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: (i64::from(rect.y) + i64::from(rect.height) / 2)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    };
    choose_work_area(center, work_areas)
}

pub fn fit_size(size: Size, work_area: WorkArea) -> Size {
    Size {
        width: size.width.min(work_area.width),
        height: size.height.min(work_area.height),
    }
}

pub fn clamp_position(position: Point, size: Size, work_area: WorkArea) -> Point {
    let size = fit_size(size, work_area);
    let max_x = work_area.right() - i64::from(size.width);
    let max_y = work_area.bottom() - i64::from(size.height);
    Point {
        x: clamp_i64(i64::from(position.x), i64::from(work_area.x), max_x) as i32,
        y: clamp_i64(i64::from(position.y), i64::from(work_area.y), max_y) as i32,
    }
}

pub fn clamp_rect(rect: WindowRect, work_area: WorkArea) -> WindowRect {
    let size = fit_size(
        Size {
            width: rect.width,
            height: rect.height,
        },
        work_area,
    );
    let position = clamp_position(
        Point {
            x: rect.x,
            y: rect.y,
        },
        size,
        work_area,
    );
    WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

pub fn snap_orb(rect: WindowRect, work_area: WorkArea) -> (WindowRect, HorizontalEdge) {
    let size = fit_size(
        Size {
            width: rect.width,
            height: rect.height,
        },
        work_area,
    );
    let margin_x = WINDOW_MARGIN
        .max(0)
        .min(((i64::from(work_area.width) - i64::from(size.width)) / 2).max(0) as i32);
    let left = i64::from(work_area.x) + i64::from(margin_x);
    let right = work_area.right() - i64::from(size.width) - i64::from(margin_x);
    let rect_center = i64::from(rect.x) + i64::from(rect.width) / 2;
    let work_center = i64::from(work_area.x) + i64::from(work_area.width) / 2;
    let (x, edge) = if rect_center <= work_center {
        (left, HorizontalEdge::Left)
    } else {
        (right, HorizontalEdge::Right)
    };
    let position = clamp_position(
        Point {
            x: x as i32,
            y: rect.y,
        },
        size,
        work_area,
    );
    (
        WindowRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        edge,
    )
}

pub fn place_quick_panel(orb: WindowRect, work_area: WorkArea) -> QuickPlacement {
    let work_center = i64::from(work_area.x) + i64::from(work_area.width) / 2;
    let orb_center_x = i64::from(orb.x) + i64::from(orb.width) / 2;
    let direction = if orb_center_x <= work_center {
        ExpandDirection::Right
    } else {
        ExpandDirection::Left
    };
    let size = fit_size(
        Size {
            width: QUICK_WIDTH,
            height: QUICK_HEIGHT,
        },
        work_area,
    );
    let desired_x = match direction {
        ExpandDirection::Right => i64::from(orb.x) + i64::from(orb.width) + i64::from(QUICK_GAP),
        ExpandDirection::Left => i64::from(orb.x) - i64::from(size.width) - i64::from(QUICK_GAP),
    };
    let desired_y = i64::from(orb.y) + i64::from(orb.height) / 2 - i64::from(size.height) / 2;
    let position = clamp_position(
        Point {
            x: desired_x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
            y: desired_y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        },
        size,
        work_area,
    );
    QuickPlacement {
        rect: WindowRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        direction,
    }
}

fn monitor_work_area(monitor: &tauri::Monitor) -> WorkArea {
    let area = monitor.work_area();
    WorkArea {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

fn available_work_areas<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<WorkArea>, String> {
    app.available_monitors()
        .map(|monitors| monitors.iter().map(monitor_work_area).collect())
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;
    // SAFETY: Both owned UTF-16 buffers are NUL-terminated and live for the call.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) };
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

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data");
    let mut last_collision = None;
    for _ in 0..16 {
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".{file_name}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(mut file) => {
                let result = (|| {
                    file.write_all(bytes)?;
                    file.sync_all()?;
                    drop(file);
                    replace_file(&temp_path, path)
                })();
                if result.is_err() {
                    let _ = fs::remove_file(&temp_path);
                }
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_collision = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_collision.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "cannot allocate temp file",
        )
    }))
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join(SETTINGS_FILE))
        .map_err(|error| error.to_string())
}

fn load_settings<R: Runtime>(app: &AppHandle<R>) -> DesktopSettings {
    let Ok(path) = settings_path(app) else {
        return DesktopSettings::default();
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return DesktopSettings::default();
    };
    if metadata.len() > MAX_SETTINGS_BYTES {
        return DesktopSettings::default();
    }
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<DesktopSettings>(&bytes).ok())
        .filter(|settings| settings.orb_relative_y.is_finite())
        .unwrap_or_default()
}

fn save_settings<R: Runtime>(app: &AppHandle<R>, settings: DesktopSettings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    atomic_write(&settings_path(app)?, &bytes).map_err(|error| error.to_string())
}

fn restored_orb_rect(settings: DesktopSettings, area: WorkArea) -> WindowRect {
    let travel = area.height.saturating_sub(ORB_SIZE);
    let y = i64::from(area.y)
        + (settings.orb_relative_y.clamp(0.0, 1.0) * f64::from(travel)).round() as i64;
    let x = match settings.orb_edge {
        HorizontalEdge::Left => area.x,
        HorizontalEdge::Right => (area.right() - i64::from(ORB_SIZE)) as i32,
    };
    let unsnapped = WindowRect {
        x,
        y: y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    snap_orb(unsnapped, area).0
}

fn persist_orb_position<R: Runtime>(
    app: &AppHandle<R>,
    rect: WindowRect,
    area: WorkArea,
    edge: HorizontalEdge,
) -> Result<(), String> {
    let travel = area.height.saturating_sub(rect.height);
    let relative_y = if travel == 0 {
        0.0
    } else {
        f64::from(rect.y.saturating_sub(area.y)) / f64::from(travel)
    };
    let mut settings = load_settings(app);
    settings.orb_edge = edge;
    settings.orb_relative_y = relative_y.clamp(0.0, 1.0);
    save_settings(app, settings)
}

fn orb_rect<R: Runtime>(app: &AppHandle<R>) -> Result<WindowRect, String> {
    let orb = app
        .get_webview_window(ORB_LABEL)
        .ok_or_else(|| "悬浮球窗口尚未创建".to_string())?;
    let position = orb.outer_position().map_err(|error| error.to_string())?;
    let size = orb.outer_size().map_err(|error| error.to_string())?;
    Ok(WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

pub fn setup_windows<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let settings = load_settings(app);
    let initial_area = app
        .primary_monitor()?
        .or_else(|| app.available_monitors().ok()?.into_iter().next())
        .map(|monitor| monitor_work_area(&monitor));
    let initial_orb = initial_area
        .map(|area| restored_orb_rect(settings, area))
        .unwrap_or(WindowRect {
            x: WINDOW_MARGIN,
            y: 96,
            width: ORB_SIZE,
            height: ORB_SIZE,
        });

    if app.get_webview_window(ORB_LABEL).is_none() {
        WebviewWindowBuilder::new(app, ORB_LABEL, WebviewUrl::App("desktop-orb.html".into()))
            .title("JacobeAPI")
            .inner_size(f64::from(ORB_SIZE), f64::from(ORB_SIZE))
            .position(f64::from(initial_orb.x), f64::from(initial_orb.y))
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .always_on_top(settings.always_on_top)
            .skip_taskbar(true)
            .shadow(false)
            .visible(settings.orb_visible)
            .build()?;
    }

    if app.get_webview_window(QUICK_LABEL).is_none() {
        WebviewWindowBuilder::new(
            app,
            QUICK_LABEL,
            WebviewUrl::App("desktop-quick.html".into()),
        )
        .title("JacobeAPI 快捷面板")
        .inner_size(f64::from(QUICK_WIDTH), f64::from(QUICK_HEIGHT))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(settings.always_on_top)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .build()?;
    }
    if let Some(quick) = app.get_webview_window(QUICK_LABEL) {
        let quick_on_event = quick.clone();
        quick.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                let _ = quick_on_event.hide();
            }
        });
    }
    Ok(())
}

pub fn show_manager<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let manager = app
        .get_webview_window(MANAGER_LABEL)
        .ok_or_else(|| "管理器窗口尚未创建".to_string())?;
    manager.show().map_err(|error| error.to_string())?;
    manager.set_focus().map_err(|error| error.to_string())
}

pub fn hide_manager<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.get_webview_window(MANAGER_LABEL)
        .ok_or_else(|| "管理器窗口尚未创建".to_string())?
        .hide()
        .map_err(|error| error.to_string())
}

pub fn begin_orb_drag<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(quick) = app.get_webview_window(QUICK_LABEL) {
        quick.hide().map_err(|error| error.to_string())?;
    }
    app.get_webview_window(ORB_LABEL)
        .ok_or_else(|| "悬浮球窗口尚未创建".to_string())?
        .start_dragging()
        .map_err(|error| error.to_string())?;
    snap_orb_window(app)
}

pub fn snap_orb_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_LABEL)
        .ok_or_else(|| "悬浮球窗口尚未创建".to_string())?;
    let current = orb_rect(app)?;
    let work_areas = available_work_areas(app)?;
    let area = choose_work_area_for_rect(current, &work_areas)
        .ok_or_else(|| "未找到可用显示器".to_string())?;
    let (snapped, edge) = snap_orb(current, area);
    orb.set_size(PhysicalSize::new(snapped.width, snapped.height))
        .map_err(|error| error.to_string())?;
    orb.set_position(PhysicalPosition::new(snapped.x, snapped.y))
        .map_err(|error| error.to_string())?;
    persist_orb_position(app, snapped, area, edge)
}

pub fn toggle_quick_panel<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let quick = app
        .get_webview_window(QUICK_LABEL)
        .ok_or_else(|| "快捷面板窗口尚未创建".to_string())?;
    if quick.is_visible().map_err(|error| error.to_string())? {
        return quick.hide().map_err(|error| error.to_string());
    }

    let orb = orb_rect(app)?;
    let work_areas = available_work_areas(app)?;
    let area = choose_work_area_for_rect(orb, &work_areas)
        .ok_or_else(|| "未找到可用显示器".to_string())?;
    let placement = place_quick_panel(orb, area);
    quick
        .set_size(PhysicalSize::new(
            placement.rect.width,
            placement.rect.height,
        ))
        .map_err(|error| error.to_string())?;
    quick
        .set_position(PhysicalPosition::new(placement.rect.x, placement.rect.y))
        .map_err(|error| error.to_string())?;
    quick.show().map_err(|error| error.to_string())?;
    quick.set_focus().map_err(|error| error.to_string())
}

pub fn hide_quick_panel<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.get_webview_window(QUICK_LABEL)
        .ok_or_else(|| "quick panel window has not been created".to_string())?
        .hide()
        .map_err(|error| error.to_string())
}

pub fn orb_visible<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    app.get_webview_window(ORB_LABEL)
        .ok_or_else(|| "orb window has not been created".to_string())?
        .is_visible()
        .map_err(|error| error.to_string())
}

pub fn orb_always_on_top<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    app.get_webview_window(ORB_LABEL)
        .ok_or_else(|| "orb window has not been created".to_string())?
        .is_always_on_top()
        .map_err(|error| error.to_string())
}

pub fn set_orb_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_LABEL)
        .ok_or_else(|| "orb window has not been created".to_string())?;
    if visible {
        orb.show().map_err(|error| error.to_string())?;
    } else {
        hide_quick_panel(app)?;
        orb.hide().map_err(|error| error.to_string())?;
    }
    let mut settings = load_settings(app);
    settings.orb_visible = visible;
    save_settings(app, settings)
}

pub fn set_orb_always_on_top<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    app.get_webview_window(ORB_LABEL)
        .ok_or_else(|| "orb window has not been created".to_string())?
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;
    app.get_webview_window(QUICK_LABEL)
        .ok_or_else(|| "quick panel window has not been created".to_string())?
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;
    let mut settings = load_settings(app);
    settings.always_on_top = enabled;
    save_settings(app, settings)
}

pub fn handle_second_instance<R: Runtime>(app: &AppHandle<R>) {
    let _ = show_manager(app);
}
