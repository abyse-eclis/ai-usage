mod taskbar;
mod usage;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Runtime,
    WebviewWindow,
};

const WIDGET_STATE_VERSION: u32 = 4;
const SMALL_SIZE: (f64, f64) = (220.0, 180.0);
const MEDIUM_SIZE: (f64, f64) = (250.0, 240.0);
const LARGE_SIZE: (f64, f64) = (300.0, 360.0);
const COLLAPSED_SIZE: (f64, f64) = (32.0, 64.0);
const TASKBAR_COMPANION_SIZE: (f64, f64) = (190.0, 44.0);
/// Logical padding kept between the companion and the taskbar's own edges, so
/// the companion always sits *inside* the taskbar strip and never overhangs it.
const COMPANION_TASKBAR_MARGIN: f64 = 3.0;
/// Logical distance from the taskbar's left edge -- the strip Windows 11 keeps
/// for the Widgets/News button, which this app replaces.
const COMPANION_LEFT_INSET: f64 = 6.0;
const COMPANION_POPUP_GAP: f64 = 6.0;
const COMPANION_WATCH_INTERVAL_MS: u64 = 700;
const POINTER_WATCH_INTERVAL_MS: u64 = 120;
const SNAP_DISTANCE: f64 = 18.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DockSide {
    Left,
    Right,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetState {
    layout_version: Option<u32>,
    bounds: Option<WidgetBounds>,
    always_on_top: Option<bool>,
    is_collapsed: Option<bool>,
    dock_side: Option<DockSide>,
    expanded_bounds: Option<WidgetBounds>,
    main_widget_enabled: Option<bool>,
    taskbar_companion_enabled: Option<bool>,
    edge_dock_enabled: Option<bool>,
    /// Windows display device name the companion should dock to. `None` means
    /// "whichever monitor is primary right now".
    taskbar_monitor_id: Option<String>,
}

/// Presentation modes are independent of one another: each window's visibility
/// is decided from its own `enabled` flag only. Nothing here should imply that
/// enabling one mode shows or hides another.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresentationSnapshot {
    main_widget_enabled: bool,
    taskbar_companion_enabled: bool,
    edge_dock_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeDockSnapshot {
    is_collapsed: bool,
    dock_side: Option<DockSide>,
    is_animating: bool,
}

struct AppState {
    always_on_top: Mutex<bool>,
    is_animating: Mutex<bool>,
    open_widget_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    taskbar_check_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    /// Last rect the companion was moved to, so the taskbar watcher only
    /// touches the window when the taskbar actually changed.
    companion_placement: Mutex<Option<CompanionPlacement>>,
    /// Monitor the companion is currently docked to, so a momentary failure to
    /// see the primary taskbar does not move it to another screen.
    companion_monitor: Mutex<Option<String>>,
    /// Whether the popup is pinned open by a click, which is when Escape and
    /// click-outside have to be watched for.
    popup_pinned: Mutex<bool>,
    edge_dock_check_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

#[tauri::command]
fn set_always_on_top(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;
    if let Ok(mut value) = state.always_on_top.lock() {
        *value = enabled;
    }
    let _ = save_widget_state(&app, &window, Some(enabled));
    Ok(())
}

#[tauri::command]
fn resize_widget(
    app: AppHandle,
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    let _ = window.set_resizable(true);
    let mut state = read_widget_state(&app);
    state.is_collapsed = Some(false);
    let _ = write_widget_state(&app, &state);
    let _ = save_widget_state(&app, &window, None);
    emit_edge_state(&app);
    Ok(())
}

#[tauri::command]
fn set_skip_taskbar(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_skip_taskbar(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_widget(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    // Closing/hiding the Main Widget must never quit the app or touch other
    // presentation modes (Taskbar Companion keeps running untouched).
    if window.label() == "main" {
        return set_main_widget_enabled(app, false);
    }
    window.hide().map_err(|error| error.to_string())
}

/// Single source of truth for presentation state, persisted independently of
/// any particular window so Rust can decide visibility before the frontend
/// even loads (no startup flash of a window that should stay hidden).
fn presentation_snapshot(app: &AppHandle) -> PresentationSnapshot {
    let state = read_widget_state(app);
    PresentationSnapshot {
        main_widget_enabled: state.main_widget_enabled.unwrap_or(false),
        taskbar_companion_enabled: state.taskbar_companion_enabled.unwrap_or(true),
        edge_dock_enabled: state.edge_dock_enabled.unwrap_or(false),
    }
}

#[tauri::command]
fn get_presentation_state(app: AppHandle) -> PresentationSnapshot {
    presentation_snapshot(&app)
}

/// The Main Widget and Edge Dock are the same underlying "main" window shown
/// in two different shapes (expanded vs. collapsed-to-edge). This is the only
/// place that decides that window's visibility/shape; it never touches the
/// Taskbar Companion window.
fn apply_main_window_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let snapshot = presentation_snapshot(app);
    if !snapshot.main_widget_enabled && !snapshot.edge_dock_enabled {
        let _ = window.hide();
        return;
    }

    let should_collapse = snapshot.edge_dock_enabled && !snapshot.main_widget_enabled;
    let mut state = read_widget_state(app);
    state.is_collapsed = Some(should_collapse);
    let _ = write_widget_state(app, &state);

    restore_or_place_window(app, &window);
    let _ = window.set_resizable(!should_collapse);
    let _ = window.show();
    emit_edge_state(app);
}

fn sync_presentation_menu(app: &AppHandle) {
    let snapshot = presentation_snapshot(app);
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(guard) = state.open_widget_item.lock() {
            if let Some(item) = guard.as_ref() {
                let label = if snapshot.main_widget_enabled { "Hide Full Widget" } else { "Open Full Widget" };
                let _ = item.set_text(label);
            }
        }
        if let Ok(guard) = state.taskbar_check_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(snapshot.taskbar_companion_enabled);
            }
        }
        if let Ok(guard) = state.edge_dock_check_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(snapshot.edge_dock_enabled);
            }
        }
    }
}

/// Shows/hides the Main Widget right now and remembers that choice for the
/// next launch. Never touches Taskbar Companion or Edge Dock state.
#[tauri::command]
fn set_main_widget_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut state = read_widget_state(&app);
    state.main_widget_enabled = Some(enabled);
    write_widget_state(&app, &state).map_err(|error| error.to_string())?;
    apply_main_window_visibility(&app);
    if enabled {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }
    sync_presentation_menu(&app);
    let _ = app.emit("presentation-state-changed", presentation_snapshot(&app));
    Ok(())
}

/// Persists whether the Main Widget should open on the next launch, without
/// touching its visibility in the current session (used by the "Main Widget
/// on startup" settings toggle, which lives inside the widget itself).
#[tauri::command]
fn set_main_widget_startup_preference(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut state = read_widget_state(&app);
    state.main_widget_enabled = Some(enabled);
    write_widget_state(&app, &state).map_err(|error| error.to_string())?;
    let _ = app.emit("presentation-state-changed", presentation_snapshot(&app));
    Ok(())
}

/// Shows/hides Taskbar Companion right now and persists it for next launch.
/// Never touches Main Widget or Edge Dock visibility.
#[tauri::command]
fn set_taskbar_companion_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut state = read_widget_state(&app);
    state.taskbar_companion_enabled = Some(enabled);
    write_widget_state(&app, &state).map_err(|error| error.to_string())?;
    set_taskbar_companion_visible(app.clone(), enabled)?;
    sync_presentation_menu(&app);
    let _ = app.emit("presentation-state-changed", presentation_snapshot(&app));
    Ok(())
}

/// Shows/hides the Main Widget in its collapsed-to-edge shape and persists it
/// for next launch. Never touches Taskbar Companion visibility.
#[tauri::command]
fn set_edge_dock_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut state = read_widget_state(&app);
    state.edge_dock_enabled = Some(enabled);
    write_widget_state(&app, &state).map_err(|error| error.to_string())?;
    apply_main_window_visibility(&app);
    sync_presentation_menu(&app);
    let _ = app.emit("presentation-state-changed", presentation_snapshot(&app));
    Ok(())
}

#[tauri::command]
fn toggle_main_widget(app: AppHandle) -> Result<(), String> {
    let visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    set_main_widget_enabled(app, !visible)
}

#[tauri::command]
fn set_taskbar_companion_visible(app: AppHandle, enabled: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("taskbar-companion") else {
        return Ok(());
    };
    if enabled {
        position_taskbar_companion(app.clone())?;
        // The companion must never take keyboard focus away from whatever the
        // user is typing in; it is a read-only readout that happens to accept
        // clicks.
        apply_no_activate(&window, true);
        window.show().map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_skip_taskbar(true)
            .map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
        let _ = hide_companion_popup(app.clone());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CompanionPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    taskbar_visible: bool,
}

/// Where the companion goes *inside* a real taskbar rect: hugging the left end
/// (Windows 11's Widgets/News strip), vertically centred, and never taller
/// than the taskbar itself.
fn companion_placement(info: &taskbar::TaskbarInfo) -> CompanionPlacement {
    let scale = if info.scale > 0.1 { info.scale } else { 1.0 };
    let margin = (COMPANION_TASKBAR_MARGIN * scale).round() as i32;
    let inset = (COMPANION_LEFT_INSET * scale).round() as i32;
    let min_thickness = (24.0 * scale).round() as i32;

    let (x, y, width, height) = match info.edge {
        taskbar::TaskbarEdge::Bottom | taskbar::TaskbarEdge::Top => {
            let height = (info.height - margin * 2).max(min_thickness).min(info.height);
            let width = ((TASKBAR_COMPANION_SIZE.0 * scale).round() as i32).min(info.width.max(1));
            let x = info.x + inset;
            let y = info.y + (info.height - height) / 2;
            (x, y, width, height)
        }
        taskbar::TaskbarEdge::Left | taskbar::TaskbarEdge::Right => {
            let width = (info.width - margin * 2).max(min_thickness).min(info.width);
            let height = (TASKBAR_COMPANION_SIZE.1 * scale).round() as i32;
            let x = info.x + (info.width - width) / 2;
            let y = info.y + inset;
            (x, y, width, height)
        }
    };

    CompanionPlacement {
        x,
        y,
        width: width.max(1) as u32,
        height: height.max(1) as u32,
        taskbar_visible: info.visible,
    }
}

fn preferred_taskbar(app: &AppHandle) -> Option<taskbar::TaskbarInfo> {
    let monitor_id = read_widget_state(app).taskbar_monitor_id;
    let state = app.try_state::<AppState>();
    let last_used = state
        .as_ref()
        .and_then(|state| state.companion_monitor.lock().ok().map(|value| value.clone()))
        .flatten();
    let found = taskbar::taskbar_for_monitor(monitor_id.as_deref(), last_used.as_deref());
    if let (Some(info), Some(state)) = (found.as_ref(), state) {
        if let Ok(mut guard) = state.companion_monitor.lock() {
            *guard = Some(info.monitor_id.clone());
        }
    }
    found
}

/// Fallback for the (non-Windows / no taskbar found) case: bottom-left of the
/// work area, the closest thing to "on the taskbar" without the shell APIs.
fn fallback_placement(app: &AppHandle) -> Result<CompanionPlacement, String> {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        })
        .ok_or_else(|| "No monitor is available for the taskbar companion.".to_string())?;
    let scale = monitor.scale_factor();
    let width = (TASKBAR_COMPANION_SIZE.0 * scale).round() as u32;
    let height = (TASKBAR_COMPANION_SIZE.1 * scale).round() as u32;
    let margin = (COMPANION_LEFT_INSET * scale).round() as i32;
    let area = monitor.work_area();
    Ok(CompanionPlacement {
        x: area.position.x + margin,
        y: area.position.y + area.size.height as i32 - height as i32 - margin,
        width,
        height,
        taskbar_visible: true,
    })
}

#[tauri::command]
fn position_taskbar_companion(app: AppHandle) -> Result<(), String> {
    let placement = match preferred_taskbar(&app) {
        Some(info) => companion_placement(&info),
        None => fallback_placement(&app)?,
    };
    apply_companion_placement(&app, placement, true)
}

fn apply_companion_placement(
    app: &AppHandle,
    placement: CompanionPlacement,
    force: bool,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("taskbar-companion") else {
        return Ok(());
    };
    let unchanged = app
        .try_state::<AppState>()
        .and_then(|state| state.companion_placement.lock().ok().map(|value| *value))
        .flatten()
        .map(|previous| previous == placement)
        .unwrap_or(false);
    if unchanged && !force {
        return Ok(());
    }

    if placement.taskbar_visible {
        window
            .set_size(PhysicalSize::new(placement.width, placement.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(PhysicalPosition::new(placement.x, placement.y))
            .map_err(|error| error.to_string())?;
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
        }
        // Keep the companion above the taskbar itself, without activating it.
        raise_no_activate(&window);
    } else {
        // Auto-hiding taskbar slid off-screen: the companion goes with it.
        let _ = window.hide();
        let _ = hide_companion_popup(app.clone());
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.companion_placement.lock() {
            *guard = Some(placement);
        }
    }
    debug_log(&format!(
        "[Companion] placed x={} y={} w={} h={} taskbarVisible={}",
        placement.x, placement.y, placement.width, placement.height, placement.taskbar_visible
    ));
    Ok(())
}

/// Polls the shell for taskbar geometry so the companion survives DPI changes,
/// resolution changes, taskbar resizes, and auto-hide, without any hooking.
fn watch_taskbar(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(COMPANION_WATCH_INTERVAL_MS));
        if !presentation_snapshot(&app).taskbar_companion_enabled {
            continue;
        }
        let placement = match preferred_taskbar(&app) {
            Some(info) => companion_placement(&info),
            None => match fallback_placement(&app) {
                Ok(value) => value,
                Err(_) => continue,
            },
        };
        let _ = apply_companion_placement(&app, placement, false);
    });
}

#[tauri::command]
fn get_taskbar_info(app: AppHandle) -> Option<taskbar::TaskbarInfo> {
    preferred_taskbar(&app)
}

#[tauri::command]
fn list_taskbars() -> Vec<taskbar::TaskbarInfo> {
    taskbar::all_taskbars()
}

/// Persists which monitor's taskbar the companion docks to (empty/None means
/// "follow the primary monitor").
#[tauri::command]
fn set_taskbar_monitor(app: AppHandle, monitor_id: Option<String>) -> Result<(), String> {
    let mut state = read_widget_state(&app);
    state.taskbar_monitor_id = monitor_id.filter(|id| !id.is_empty());
    write_widget_state(&app, &state).map_err(|error| error.to_string())?;
    position_taskbar_companion(app)
}

// -----------------------------------------------------------------------
// Hover popup: its own borderless window, because the companion window is only
// as tall as the taskbar and would clip anything drawn above it.
// -----------------------------------------------------------------------

fn companion_anchor(app: &AppHandle) -> Option<(i32, i32, i32, i32)> {
    let window = app.get_webview_window("taskbar-companion")?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((position.x, position.y, size.width as i32, size.height as i32))
}

#[tauri::command]
fn show_companion_popup(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(popup) = app.get_webview_window("companion-popup") else {
        return Err("Companion popup window is missing.".to_string());
    };
    let info = preferred_taskbar(&app);
    let scale = info
        .as_ref()
        .map(|value| value.scale)
        .filter(|value| *value > 0.1)
        .or_else(|| popup.scale_factor().ok())
        .unwrap_or(1.0);

    let popup_width = (width.max(140.0) * scale).round() as i32;
    let popup_height = (height.max(90.0) * scale).round() as i32;
    let gap = (COMPANION_POPUP_GAP * scale).round() as i32;
    let (anchor_x, anchor_y, _anchor_width, anchor_height) =
        companion_anchor(&app).ok_or_else(|| "Companion window is missing.".to_string())?;

    let (mut x, mut y) = match info.as_ref().map(|value| value.edge) {
        Some(taskbar::TaskbarEdge::Top) => (
            anchor_x,
            info.as_ref()
                .map(|value| value.y + value.height)
                .unwrap_or(anchor_y + anchor_height)
                + gap,
        ),
        Some(taskbar::TaskbarEdge::Left) => (
            info.as_ref().map(|value| value.x + value.width).unwrap_or(anchor_x) + gap,
            anchor_y,
        ),
        Some(taskbar::TaskbarEdge::Right) => (
            info.as_ref().map(|value| value.x).unwrap_or(anchor_x) - popup_width - gap,
            anchor_y,
        ),
        // Bottom taskbar (and the no-taskbar fallback): open upwards.
        _ => (
            anchor_x,
            info.as_ref().map(|value| value.y).unwrap_or(anchor_y) - popup_height - gap,
        ),
    };

    if let Some(bounds) = info.as_ref() {
        x = x.clamp(
            bounds.monitor_x,
            (bounds.monitor_x + bounds.monitor_width - popup_width).max(bounds.monitor_x),
        );
        y = y.clamp(
            bounds.monitor_y,
            (bounds.monitor_y + bounds.monitor_height - popup_height).max(bounds.monitor_y),
        );
    }

    popup
        .set_size(PhysicalSize::new(popup_width as u32, popup_height as u32))
        .map_err(|error| error.to_string())?;
    popup
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    // Hovering must not pull focus out of the editor/terminal underneath.
    apply_no_activate(&popup, true);
    popup.show().map_err(|error| error.to_string())?;
    let _ = popup.set_always_on_top(true);
    let _ = popup.set_skip_taskbar(true);
    raise_no_activate(&popup);
    debug_log(&format!("[Popup] shown {}", describe_bounds(&popup)));
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PointerState {
    over_companion: bool,
    over_popup: bool,
}

fn describe_bounds(window: &WebviewWindow) -> String {
    let visible = window.is_visible().unwrap_or(false);
    match (window.outer_position(), window.outer_size()) {
        (Ok(position), Ok(size)) => format!(
            "{},{} {}x{} visible={visible}",
            position.x, position.y, size.width, size.height
        ),
        _ => format!("unknown visible={visible}"),
    }
}

fn window_contains(window: &WebviewWindow, x: f64, y: f64) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let right = position.x as f64 + size.width as f64;
    let bottom = position.y as f64 + size.height as f64;
    x >= position.x as f64 && x < right && y >= position.y as f64 && y < bottom
}

/// Hover is decided from the real cursor position rather than from webview
/// mouse events. A borderless, never-activated window reports mouse-out
/// spuriously, which is what made the hover popup close the moment the pointer
/// crossed into it; polling both window rects is immune to that and also
/// covers the gap between the two windows.
fn watch_pointer(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<PointerState> = None;
        let mut mouse_was_down = false;
        loop {
            thread::sleep(Duration::from_millis(POINTER_WATCH_INTERVAL_MS));
            let Some(companion) = app.get_webview_window("taskbar-companion") else {
                continue;
            };
            let Some((x, y)) = taskbar::cursor_position().or_else(|| {
                app.cursor_position()
                    .ok()
                    .map(|position| (position.x, position.y))
            }) else {
                continue;
            };
            let popup = app.get_webview_window("companion-popup");
            let state = PointerState {
                over_companion: window_contains(&companion, x, y),
                over_popup: popup
                    .as_ref()
                    .map(|popup| window_contains(popup, x, y))
                    .unwrap_or(false),
            };
            // Windows refuses to hand foreground to a window whose app is not
            // already in front, so a pinned popup has no keyboard focus and
            // cannot see Escape itself. Watching the two key states here is
            // what keeps "Escape closes it" and "click elsewhere closes it"
            // working without stealing focus from the user's editor.
            let pinned = app
                .try_state::<AppState>()
                .and_then(|state| state.popup_pinned.lock().ok().map(|value| *value))
                .unwrap_or(false);
            if pinned {
                let outside = !state.over_companion && !state.over_popup;
                let clicked_away = taskbar::primary_mouse_down() && outside && !mouse_was_down;
                if taskbar::escape_down() || clicked_away {
                    debug_log("[Popup] dismissed while pinned");
                    let _ = app.emit("companion-popup-dismiss", ());
                }
            }
            mouse_was_down = taskbar::primary_mouse_down();

            if last == Some(state) {
                continue;
            }
            last = Some(state);
            debug_log(&format!(
                "[Pointer] cursor=({x:.0},{y:.0}) companion={} popup={}",
                state.over_companion, state.over_popup
            ));
            let _ = app.emit("companion-pointer", state);
        }
    });
}

/// Escape inside the popup, or the popup losing focus while pinned.
#[tauri::command]
fn dismiss_companion_popup(app: AppHandle) -> Result<(), String> {
    debug_log("[Popup] dismiss requested");
    app.emit("companion-popup-dismiss", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_companion_popup(app: AppHandle) -> Result<(), String> {
    let Some(popup) = app.get_webview_window("companion-popup") else {
        return Ok(());
    };
    popup.hide().map_err(|error| error.to_string())?;
    debug_log("[Popup] hidden");
    Ok(())
}

/// Pinning (an explicit click) is allowed to activate the popup so it can take
/// Escape and detect click-outside via focus loss. Plain hovering never does.
#[tauri::command]
fn set_companion_popup_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    let Some(popup) = app.get_webview_window("companion-popup") else {
        return Ok(());
    };
    apply_no_activate(&popup, !pinned);
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.popup_pinned.lock() {
            *guard = pinned;
        }
    }
    if pinned {
        let _ = popup.set_focus();
    }
    debug_log(&format!("[Popup] pinned={pinned}"));
    Ok(())
}

fn debug_log(message: &str) {
    #[cfg(debug_assertions)]
    println!("{message}");
    #[cfg(not(debug_assertions))]
    let _ = message;
}

#[cfg(windows)]
fn apply_no_activate(window: &WebviewWindow, enabled: bool) {
    if let Ok(hwnd) = window.hwnd() {
        taskbar::set_no_activate(hwnd, enabled);
        if enabled {
            taskbar::deliver_clicks_without_activation(hwnd);
        }
    }
}

#[cfg(not(windows))]
fn apply_no_activate(_window: &WebviewWindow, _enabled: bool) {}

#[cfg(windows)]
fn raise_no_activate(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        taskbar::raise_topmost_no_activate(hwnd);
    }
}

#[cfg(not(windows))]
fn raise_no_activate(_window: &WebviewWindow) {}

#[tauri::command]
fn get_edge_dock_state(app: AppHandle) -> EdgeDockSnapshot {
    edge_snapshot(&app)
}

#[tauri::command]
fn collapse_to_edge(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<AppState>,
    side: Option<DockSide>,
) -> Result<EdgeDockSnapshot, String> {
    with_animation_guard(&app, state, || {
        let bounds = current_bounds(&window).map_err(|error| error.to_string())?;
        let area = monitor_work_area_for_bounds(&app, bounds).map_err(|error| error.to_string())?;
        let dock_side = side.unwrap_or_else(|| nearest_dock_side(area, bounds));
        let docked = docked_position(area, dock_side, bounds);
        let expanded_bounds = WidgetBounds {
            x: docked.x,
            y: docked.y,
            width: bounds.width,
            height: bounds.height,
        };
        let collapsed = collapsed_bounds(&window, area, dock_side, docked.y);

        let _ = window.set_resizable(false);
        animate_window(&window, expanded_bounds, collapsed).map_err(|error| error.to_string())?;

        let mut widget_state = read_widget_state(&app);
        widget_state.layout_version = Some(WIDGET_STATE_VERSION);
        widget_state.is_collapsed = Some(true);
        widget_state.dock_side = Some(dock_side);
        widget_state.expanded_bounds = Some(expanded_bounds);
        widget_state.bounds = Some(expanded_bounds);
        write_widget_state(&app, &widget_state).map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn expand_from_edge(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<AppState>,
) -> Result<EdgeDockSnapshot, String> {
    with_animation_guard(&app, state, || {
        let widget_state = read_widget_state(&app);
        let collapsed = current_bounds(&window).map_err(|error| error.to_string())?;
        let expanded = widget_state.expanded_bounds.or(widget_state.bounds).unwrap_or(WidgetBounds {
            x: collapsed.x,
            y: collapsed.y,
            width: MEDIUM_SIZE.0 as u32,
            height: MEDIUM_SIZE.1 as u32,
        });
        let area = monitor_work_area_for_bounds(&app, expanded).map_err(|error| error.to_string())?;
        let side = widget_state
            .dock_side
            .unwrap_or_else(|| nearest_dock_side(area, expanded));
        let target_position = docked_position(area, side, expanded);
        let target = WidgetBounds {
            x: target_position.x,
            y: target_position.y,
            width: expanded.width,
            height: expanded.height,
        };

        animate_window(&window, collapsed, target).map_err(|error| error.to_string())?;
        let _ = window.set_resizable(true);

        let mut next_state = widget_state;
        next_state.layout_version = Some(WIDGET_STATE_VERSION);
        next_state.is_collapsed = Some(false);
        next_state.dock_side = Some(side);
        next_state.expanded_bounds = Some(target);
        next_state.bounds = Some(target);
        write_widget_state(&app, &next_state).map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn set_dock_side(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<AppState>,
    side: DockSide,
) -> Result<EdgeDockSnapshot, String> {
    with_animation_guard(&app, state, || {
        let bounds = current_bounds(&window).map_err(|error| error.to_string())?;
        let state = read_widget_state(&app);
        let expanded = if state.is_collapsed.unwrap_or(false) {
            state.expanded_bounds.unwrap_or(bounds)
        } else {
            bounds
        };
        let area = monitor_work_area_for_bounds(&app, expanded).map_err(|error| error.to_string())?;
        let target_position = docked_position(area, side, expanded);
        let target = WidgetBounds {
            x: target_position.x,
            y: target_position.y,
            width: expanded.width,
            height: expanded.height,
        };

        if state.is_collapsed.unwrap_or(false) {
            let collapsed = collapsed_bounds(&window, area, side, target.y);
            animate_window(&window, bounds, collapsed).map_err(|error| error.to_string())?;
            let _ = window.set_resizable(false);
        } else {
            window
                .set_position(PhysicalPosition::new(target.x, target.y))
                .map_err(|error| error.to_string())?;
        }

        let mut next_state = state;
        next_state.layout_version = Some(WIDGET_STATE_VERSION);
        next_state.dock_side = Some(side);
        next_state.expanded_bounds = Some(target);
        next_state.bounds = Some(target);
        write_widget_state(&app, &next_state).map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn undock_widget(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<AppState>,
) -> Result<EdgeDockSnapshot, String> {
    with_animation_guard(&app, state, || {
        let widget_state = read_widget_state(&app);
        if widget_state.is_collapsed.unwrap_or(false) {
            let collapsed = current_bounds(&window).map_err(|error| error.to_string())?;
            let expanded = widget_state.expanded_bounds.or(widget_state.bounds).unwrap_or(WidgetBounds {
                x: collapsed.x,
                y: collapsed.y,
                width: MEDIUM_SIZE.0 as u32,
                height: MEDIUM_SIZE.1 as u32,
            });
            let area = monitor_work_area_for_bounds(&app, expanded).map_err(|error| error.to_string())?;
            let side = widget_state
                .dock_side
                .unwrap_or_else(|| nearest_dock_side(area, expanded));
            let target_position = docked_position(area, side, expanded);
            let target = WidgetBounds {
                x: target_position.x,
                y: target_position.y,
                width: expanded.width,
                height: expanded.height,
            };
            animate_window(&window, collapsed, target).map_err(|error| error.to_string())?;
        }

        let bounds = current_bounds(&window).map_err(|error| error.to_string())?;
        let mut next_state = read_widget_state(&app);
        next_state.layout_version = Some(WIDGET_STATE_VERSION);
        next_state.is_collapsed = Some(false);
        next_state.dock_side = None;
        next_state.expanded_bounds = Some(bounds);
        next_state.bounds = Some(bounds);
        let _ = window.set_resizable(true);
        write_widget_state(&app, &next_state).map_err(|error| error.to_string())?;
        Ok(())
    })
}

fn widget_state_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("widget-state.json"))
}

fn read_widget_state<R: Runtime>(app: &AppHandle<R>) -> WidgetState {
    let Ok(path) = widget_state_path(app) else {
        return WidgetState::default();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return WidgetState::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn edge_snapshot<R: Runtime>(app: &AppHandle<R>) -> EdgeDockSnapshot {
    let state = read_widget_state(app);
    EdgeDockSnapshot {
        is_collapsed: state.is_collapsed.unwrap_or(false),
        dock_side: state.dock_side,
        is_animating: false,
    }
}

fn write_widget_state<R: Runtime>(app: &AppHandle<R>, state: &WidgetState) -> tauri::Result<()> {
    let path = widget_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

fn save_widget_state<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    always_on_top: Option<bool>,
) -> tauri::Result<()> {
    let existing = read_widget_state(app);
    if existing.is_collapsed.unwrap_or(false) {
        let mut state = existing;
        if let Some(value) = always_on_top {
            state.always_on_top = Some(value);
        }
        return write_widget_state(app, &state);
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let mut state = existing;
    state.layout_version = Some(WIDGET_STATE_VERSION);
    state.bounds = Some(WidgetBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    });
    state.expanded_bounds = state.bounds;
    if let Some(value) = always_on_top {
        state.always_on_top = Some(value);
    }
    write_widget_state(app, &state)
}

fn current_bounds<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<WidgetBounds> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    Ok(WidgetBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn monitor_work_area_for_bounds<R: Runtime>(
    app: &AppHandle<R>,
    bounds: WidgetBounds,
) -> tauri::Result<PhysicalRect<i32, u32>> {
    let monitors = app.available_monitors()?;
    let center_x = bounds.x + (bounds.width as i32 / 2);
    let center_y = bounds.y + (bounds.height as i32 / 2);

    if let Some(monitor) = monitors.iter().find(|monitor| {
        let area = monitor.work_area();
        let left = area.position.x;
        let top = area.position.y;
        let right = left + area.size.width as i32;
        let bottom = top + area.size.height as i32;
        center_x >= left && center_x <= right && center_y >= top && center_y <= bottom
    }) {
        return Ok(*monitor.work_area());
    }

    app.primary_monitor()?
        .or_else(|| monitors.into_iter().next())
        .map(|monitor| *monitor.work_area())
        .ok_or_else(|| tauri::Error::WindowNotFound)
}

fn clamp_y(area: PhysicalRect<i32, u32>, y: i32, height: u32) -> i32 {
    let min_y = area.position.y;
    let max_y = area.position.y + area.size.height as i32 - height as i32;
    y.clamp(min_y, max_y.max(min_y))
}

fn nearest_dock_side(area: PhysicalRect<i32, u32>, bounds: WidgetBounds) -> DockSide {
    let left_distance = (bounds.x - area.position.x).abs();
    let right_edge = area.position.x + area.size.width as i32;
    let right_distance = (right_edge - (bounds.x + bounds.width as i32)).abs();
    if left_distance <= right_distance {
        DockSide::Left
    } else {
        DockSide::Right
    }
}

fn docked_position(
    area: PhysicalRect<i32, u32>,
    side: DockSide,
    bounds: WidgetBounds,
) -> PhysicalPosition<i32> {
    let x = match side {
        DockSide::Left => area.position.x,
        DockSide::Right => area.position.x + area.size.width as i32 - bounds.width as i32,
    };
    PhysicalPosition::new(x, clamp_y(area, bounds.y, bounds.height))
}

fn collapsed_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    area: PhysicalRect<i32, u32>,
    side: DockSide,
    y: i32,
) -> WidgetBounds {
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = (COLLAPSED_SIZE.0 * scale).round() as u32;
    let height = (COLLAPSED_SIZE.1 * scale).round() as u32;
    let x = match side {
        DockSide::Left => area.position.x,
        DockSide::Right => area.position.x + area.size.width as i32 - width as i32,
    };
    WidgetBounds {
        x,
        y: clamp_y(area, y, height),
        width,
        height,
    }
}

fn animate_window<R: Runtime>(
    window: &WebviewWindow<R>,
    from: WidgetBounds,
    to: WidgetBounds,
) -> tauri::Result<()> {
    const STEPS: i32 = 10;
    for step in 1..=STEPS {
        let progress = step as f64 / STEPS as f64;
        let eased = 1.0 - (1.0 - progress).powi(3);
        let lerp_i32 = |a: i32, b: i32| a + ((b - a) as f64 * eased).round() as i32;
        let lerp_u32 = |a: u32, b: u32| {
            (a as f64 + (b as f64 - a as f64) * eased).round().max(1.0) as u32
        };
        window.set_position(PhysicalPosition::new(
            lerp_i32(from.x, to.x),
            lerp_i32(from.y, to.y),
        ))?;
        window.set_size(PhysicalSize::new(
            lerp_u32(from.width, to.width),
            lerp_u32(from.height, to.height),
        ))?;
        thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}

fn emit_edge_state<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit("edge-dock-state", edge_snapshot(app));
}

fn snap_window_if_near_edge<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let state = read_widget_state(app);
    if state.is_collapsed.unwrap_or(false) {
        return;
    }

    let Ok(bounds) = current_bounds(window) else {
        return;
    };
    let Ok(area) = monitor_work_area_for_bounds(app, bounds) else {
        return;
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let threshold = (SNAP_DISTANCE * scale).round() as i32;
    let left_distance = (bounds.x - area.position.x).abs();
    let right_edge = area.position.x + area.size.width as i32;
    let right_distance = (right_edge - (bounds.x + bounds.width as i32)).abs();
    let side = if left_distance <= threshold {
        Some(DockSide::Left)
    } else if right_distance <= threshold {
        Some(DockSide::Right)
    } else {
        None
    };

    let Some(side) = side else {
        if state.dock_side.is_some()
            && left_distance > threshold * 2
            && right_distance > threshold * 2
        {
            let mut next_state = state;
            next_state.dock_side = None;
            next_state.bounds = Some(bounds);
            next_state.expanded_bounds = Some(bounds);
            let _ = write_widget_state(app, &next_state);
            emit_edge_state(app);
        }
        return;
    };

    let target = docked_position(area, side, bounds);
    if target.x != bounds.x || target.y != bounds.y {
        let _ = window.set_position(target);
    }

    let snapped = WidgetBounds {
        x: target.x,
        y: target.y,
        width: bounds.width,
        height: bounds.height,
    };
    let mut next_state = state;
    next_state.layout_version = Some(WIDGET_STATE_VERSION);
    next_state.is_collapsed = Some(false);
    next_state.dock_side = Some(side);
    next_state.bounds = Some(snapped);
    next_state.expanded_bounds = Some(snapped);
    let _ = write_widget_state(app, &next_state);
    emit_edge_state(app);
}

fn with_animation_guard<R: Runtime, F>(
    app: &AppHandle<R>,
    state: tauri::State<AppState>,
    operation: F,
) -> Result<EdgeDockSnapshot, String>
where
    F: FnOnce() -> Result<(), String>,
{
    {
        let mut is_animating = state
            .is_animating
            .lock()
            .map_err(|_| "Animation state is unavailable".to_string())?;
        if *is_animating {
            return Ok(EdgeDockSnapshot {
                is_animating: true,
                ..edge_snapshot(app)
            });
        }
        *is_animating = true;
    }

    let result = operation();

    if let Ok(mut is_animating) = state.is_animating.lock() {
        *is_animating = false;
    }

    result?;
    emit_edge_state(app);
    Ok(edge_snapshot(app))
}

fn bounds_are_visible<R: Runtime>(app: &AppHandle<R>, bounds: WidgetBounds) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    monitors.iter().any(|monitor| {
        let area = monitor.work_area();
        let left = area.position.x;
        let top = area.position.y;
        let right = left + area.size.width as i32;
        let bottom = top + area.size.height as i32;
        bounds.x < right
            && bounds.x + bounds.width as i32 > left
            && bounds.y < bottom
            && bounds.y + bounds.height as i32 > top
    })
}

fn default_top_right_position<R: Runtime>(
    window: &WebviewWindow<R>,
    width: u32,
    _height: u32,
) -> Option<PhysicalPosition<i32>> {
    let monitor = window.current_monitor().ok().flatten().or_else(|| {
        window
            .available_monitors()
            .ok()
            .and_then(|monitors| monitors.into_iter().next())
    })?;
    let area = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()).round() as i32;
    let x = area.position.x + area.size.width as i32 - width as i32 - margin;
    let y = area.position.y + margin;
    Some(PhysicalPosition::new(
        x.max(area.position.x),
        y.max(area.position.y),
    ))
}

fn restore_or_place_window<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let state = read_widget_state(app);
    if state.layout_version == Some(WIDGET_STATE_VERSION) {
        if state.is_collapsed.unwrap_or(false) {
            if let (Some(side), Some(bounds)) = (state.dock_side, state.expanded_bounds.or(state.bounds)) {
                if let Ok(area) = monitor_work_area_for_bounds(app, bounds) {
                    let target = collapsed_bounds(window, area, side, bounds.y);
                    let _ = window.set_resizable(false);
                    let _ = window.set_size(PhysicalSize::new(target.width, target.height));
                    let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
                    return;
                }
            }
        }

        if let Some(bounds) = state
            .bounds
            .filter(|bounds| bounds_are_visible(app, *bounds))
        {
            let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
            let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
            return;
        }
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let width = (MEDIUM_SIZE.0 * scale_factor).round() as u32;
    let height = (MEDIUM_SIZE.1 * scale_factor).round() as u32;
    let _ = window.set_size(LogicalSize::new(MEDIUM_SIZE.0, MEDIUM_SIZE.1));
    if let Some(position) = default_top_right_position(window, width, height) {
        let _ = window.set_position(position);
    }
}

fn resize_main_window<R: Runtime>(app: &AppHandle<R>, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(LogicalSize::new(width, height));
        let _ = window.set_resizable(true);
        let mut state = read_widget_state(app);
        state.is_collapsed = Some(false);
        let _ = write_widget_state(app, &state);
        let _ = save_widget_state(app, &window, None);
        emit_edge_state(app);
    }
}

fn toggle_always_on_top<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let enabled = app
            .try_state::<AppState>()
            .and_then(|state| state.always_on_top.lock().ok().map(|value| !*value))
            .unwrap_or(true);
        let _ = window.set_always_on_top(enabled);
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut value) = state.always_on_top.lock() {
                *value = enabled;
            }
        }
        let _ = save_widget_state(app, &window, Some(enabled));
        let _ = window.emit("tray-always-on-top", enabled);
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let snapshot = presentation_snapshot(app);
    let title = MenuItem::with_id(app, "title", "AI Usage Monitor", false, None::<&str>)?;
    let open_widget_label = if snapshot.main_widget_enabled { "Hide Full Widget" } else { "Open Full Widget" };
    let open_widget = MenuItem::with_id(app, "open_full_widget", open_widget_label, true, None::<&str>)?;
    let taskbar_companion = CheckMenuItem::with_id(
        app,
        "taskbar_companion",
        "Taskbar Companion",
        true,
        snapshot.taskbar_companion_enabled,
        None::<&str>,
    )?;
    let edge_dock = CheckMenuItem::with_id(
        app,
        "edge_dock",
        "Edge Dock",
        true,
        snapshot.edge_dock_enabled,
        None::<&str>,
    )?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh Claude", true, None::<&str>)?;
    let always_on_top =
        MenuItem::with_id(app, "always_on_top", "Always on Top", true, None::<&str>)?;
    let dock_left = MenuItem::with_id(app, "dock_left", "Left", true, None::<&str>)?;
    let dock_right = MenuItem::with_id(app, "dock_right", "Right", true, None::<&str>)?;
    let dock_undock = MenuItem::with_id(app, "dock_undock", "Undock", true, None::<&str>)?;
    let dock_menu = Submenu::with_items(
        app,
        "Dock",
        true,
        &[&dock_left, &dock_right, &dock_undock],
    )?;
    let collapse = MenuItem::with_id(app, "collapse_edge", "Collapse to Edge", true, None::<&str>)?;
    let expand = MenuItem::with_id(app, "expand_edge", "Expand Widget", true, None::<&str>)?;
    let small = MenuItem::with_id(app, "size_small", "Small", true, None::<&str>)?;
    let medium = MenuItem::with_id(app, "size_medium", "Medium", true, None::<&str>)?;
    let large = MenuItem::with_id(app, "size_large", "Large", true, None::<&str>)?;
    let size_menu = Submenu::with_items(app, "Widget Size", true, &[&small, &medium, &large])?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let title_separator = PredefinedMenuItem::separator(app)?;
    let presentation_separator = PredefinedMenuItem::separator(app)?;
    let action_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &title,
            &title_separator,
            &open_widget,
            &taskbar_companion,
            &edge_dock,
            &presentation_separator,
            &refresh,
            &dock_menu,
            &collapse,
            &expand,
            &always_on_top,
            &size_menu,
            &action_separator,
            &settings,
            &quit,
        ],
    )?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.open_widget_item.lock() {
            *guard = Some(open_widget.clone());
        }
        if let Ok(mut guard) = state.taskbar_check_item.lock() {
            *guard = Some(taskbar_companion.clone());
        }
        if let Ok(mut guard) = state.edge_dock_check_item.lock() {
            *guard = Some(edge_dock.clone());
        }
    }

    TrayIconBuilder::new()
        .tooltip("AI Usage Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_full_widget" => {
                let _ = toggle_main_widget(app.clone());
            }
            "taskbar_companion" => {
                let enabled = !presentation_snapshot(app).taskbar_companion_enabled;
                let _ = set_taskbar_companion_enabled(app.clone(), enabled);
            }
            "edge_dock" => {
                let enabled = !presentation_snapshot(app).edge_dock_enabled;
                let _ = set_edge_dock_enabled(app.clone(), enabled);
            }
            "refresh" => {
                // Background refresh must not surface the Main Widget: the
                // fetch loop already runs in the (possibly hidden) main
                // window, so just ask it to refresh.
                let _ = app.emit("tray-refresh", ());
            }
            "dock_left" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = set_dock_side(app.clone(), window, state, DockSide::Left);
                    }
                }
            }
            "dock_right" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = set_dock_side(app.clone(), window, state, DockSide::Right);
                    }
                }
            }
            "dock_undock" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = undock_widget(app.clone(), window, state);
                    }
                }
            }
            "collapse_edge" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = collapse_to_edge(app.clone(), window, state, None);
                    }
                }
            }
            "expand_edge" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = expand_from_edge(app.clone(), window, state);
                    }
                }
            }
            "size_small" => {
                resize_main_window(app, SMALL_SIZE.0, SMALL_SIZE.1);
                let _ = set_main_widget_enabled(app.clone(), true);
                let _ = app.emit("tray-size", "small");
            }
            "size_medium" => {
                resize_main_window(app, MEDIUM_SIZE.0, MEDIUM_SIZE.1);
                let _ = set_main_widget_enabled(app.clone(), true);
                let _ = app.emit("tray-size", "medium");
            }
            "size_large" => {
                resize_main_window(app, LARGE_SIZE.0, LARGE_SIZE.1);
                let _ = set_main_widget_enabled(app.clone(), true);
                let _ = app.emit("tray-size", "large");
            }
            "always_on_top" => toggle_always_on_top(app),
            "settings" => {
                let _ = set_main_widget_enabled(app.clone(), true);
                let _ = app.emit("tray-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                let _ = toggle_main_widget(tray.app_handle().clone());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            always_on_top: Mutex::new(true),
            is_animating: Mutex::new(false),
            open_widget_item: Mutex::new(None),
            taskbar_check_item: Mutex::new(None),
            companion_placement: Mutex::new(None),
            companion_monitor: Mutex::new(None),
            popup_pinned: Mutex::new(false),
            edge_dock_check_item: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            set_always_on_top,
            resize_widget,
            set_skip_taskbar,
            hide_widget,
            set_taskbar_companion_visible,
            position_taskbar_companion,
            get_taskbar_info,
            list_taskbars,
            set_taskbar_monitor,
            show_companion_popup,
            hide_companion_popup,
            dismiss_companion_popup,
            set_companion_popup_pinned,
            get_edge_dock_state,
            collapse_to_edge,
            expand_from_edge,
            set_dock_side,
            undock_widget,
            get_presentation_state,
            set_main_widget_enabled,
            set_main_widget_startup_preference,
            set_taskbar_companion_enabled,
            set_edge_dock_enabled,
            toggle_main_widget,
            usage::read_claude_usage,
            usage::read_codex_usage
        ])
        .setup(|app| {
            let persisted_state = read_widget_state(app.handle());
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let always_on_top = persisted_state.always_on_top.unwrap_or(true);
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut value) = state.always_on_top.lock() {
                        *value = always_on_top;
                    }
                }
                let _ = window.set_always_on_top(always_on_top);
                let _ = window.set_skip_taskbar(true);
                // Each presentation mode's visibility comes from its own
                // persisted flag only. Main Widget/Edge Dock default to off,
                // so this must not force-show the window here.
                apply_main_window_visibility(app.handle());
            }
            if let Some(popup) = app.get_webview_window("companion-popup") {
                let _ = popup.set_skip_taskbar(true);
                let _ = popup.set_always_on_top(true);
                apply_no_activate(&popup, true);
            }
            let taskbar_enabled = persisted_state.taskbar_companion_enabled.unwrap_or(true);
            let _ = set_taskbar_companion_visible(app.handle().clone(), taskbar_enabled);
            watch_taskbar(app.handle().clone());
            watch_pointer(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                // Closing a presentation window only hides it (and, for the
                // Main Widget, remembers that for next launch) -- it never
                // quits the app or affects any other presentation mode.
                if window.label() == "main" {
                    let _ = set_main_widget_enabled(window.app_handle().clone(), false);
                } else {
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if window.label() != "main" {
                    return;
                }
                if let Some(webview_window) = window.app_handle().get_webview_window("main") {
                    let is_animating = window
                        .app_handle()
                        .try_state::<AppState>()
                        .and_then(|state| state.is_animating.lock().ok().map(|value| *value))
                        .unwrap_or(false);
                    if !is_animating {
                        snap_window_if_near_edge(window.app_handle(), &webview_window);
                        let _ = save_widget_state(window.app_handle(), &webview_window, None);
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Usage Monitor");
}
