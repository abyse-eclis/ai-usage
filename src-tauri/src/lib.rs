mod usage;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeDockSnapshot {
    is_collapsed: bool,
    dock_side: Option<DockSide>,
    is_animating: bool,
}

#[derive(Debug)]
struct AppState {
    always_on_top: Mutex<bool>,
    is_animating: Mutex<bool>,
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
fn hide_widget(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_taskbar_companion_visible(app: AppHandle, enabled: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("taskbar-companion") else {
        return Ok(());
    };
    if enabled {
        position_taskbar_companion(app.clone())?;
        window.show().map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_skip_taskbar(true)
            .map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn position_taskbar_companion(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("taskbar-companion") else {
        return Ok(());
    };
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| app.available_monitors().ok().and_then(|monitors| monitors.into_iter().next()))
        .ok_or_else(|| "No monitor is available for the taskbar companion.".to_string())?;
    let scale = monitor.scale_factor();
    let width = (TASKBAR_COMPANION_SIZE.0 * scale).round() as u32;
    let height = (TASKBAR_COMPANION_SIZE.1 * scale).round() as u32;
    let margin = (8.0 * scale).round() as i32;
    let area = monitor.work_area();
    let x = area.position.x + area.size.width as i32 - width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - height as i32 - margin;

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x.max(area.position.x), y.max(area.position.y)))
        .map_err(|error| error.to_string())?;
    Ok(())
}

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

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
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
    let title = MenuItem::with_id(app, "title", "AI Usage Monitor", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Widget", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Widget", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
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
    let action_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &title,
            &title_separator,
            &show,
            &hide,
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

    TrayIconBuilder::new()
        .tooltip("AI Usage Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "refresh" => {
                show_main_window(app);
                let _ = app.emit("tray-refresh", ());
            }
            "dock_left" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = set_dock_side(app.clone(), window, state, DockSide::Left);
                    }
                }
            }
            "dock_right" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = set_dock_side(app.clone(), window, state, DockSide::Right);
                    }
                }
            }
            "dock_undock" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = undock_widget(app.clone(), window, state);
                    }
                }
            }
            "collapse_edge" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = collapse_to_edge(app.clone(), window, state, None);
                    }
                }
            }
            "expand_edge" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = expand_from_edge(app.clone(), window, state);
                    }
                }
            }
            "size_small" => {
                resize_main_window(app, SMALL_SIZE.0, SMALL_SIZE.1);
                show_main_window(app);
                let _ = app.emit("tray-size", "small");
            }
            "size_medium" => {
                resize_main_window(app, MEDIUM_SIZE.0, MEDIUM_SIZE.1);
                show_main_window(app);
                let _ = app.emit("tray-size", "medium");
            }
            "size_large" => {
                resize_main_window(app, LARGE_SIZE.0, LARGE_SIZE.1);
                show_main_window(app);
                let _ = app.emit("tray-size", "large");
            }
            "always_on_top" => toggle_always_on_top(app),
            "settings" => {
                show_main_window(app);
                let _ = app.emit("tray-settings", ());
            }
            "quit" => app.exit(0),
            _ => show_main_window(app),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
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
            get_edge_dock_state,
            collapse_to_edge,
            expand_from_edge,
            set_dock_side,
            undock_widget,
            usage::read_claude_usage,
            usage::read_codex_usage
        ])
        .setup(|app| {
            let persisted_state = read_widget_state(app.handle());
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                restore_or_place_window(app.handle(), &window);
                let always_on_top = persisted_state.always_on_top.unwrap_or(true);
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut value) = state.always_on_top.lock() {
                        *value = always_on_top;
                    }
                }
                let _ = window.set_always_on_top(always_on_top);
                let _ = window.set_skip_taskbar(true);
                let _ = window.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
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
