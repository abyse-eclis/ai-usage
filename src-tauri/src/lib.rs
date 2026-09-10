mod usage;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime,
    WebviewWindow,
};

const WIDGET_STATE_VERSION: u32 = 2;
const SMALL_SIZE: (f64, f64) = (260.0, 180.0);
const MEDIUM_SIZE: (f64, f64) = (320.0, 420.0);
const LARGE_SIZE: (f64, f64) = (460.0, 600.0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetState {
    layout_version: Option<u32>,
    bounds: Option<WidgetBounds>,
    always_on_top: Option<bool>,
}

#[derive(Debug)]
struct AppState {
    always_on_top: Mutex<bool>,
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
    let _ = save_widget_state(&app, &window, None);
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
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let mut state = read_widget_state(app);
    state.layout_version = Some(WIDGET_STATE_VERSION);
    state.bounds = Some(WidgetBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    });
    if let Some(value) = always_on_top {
        state.always_on_top = Some(value);
    }
    write_widget_state(app, &state)
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
        let _ = save_widget_state(app, &window, None);
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
                    let _ = save_widget_state(window.app_handle(), &webview_window, None);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Usage Monitor");
}
