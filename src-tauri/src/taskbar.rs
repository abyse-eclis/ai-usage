//! Reads the real Windows taskbar geometry so the Taskbar Companion can be
//! placed *inside* the taskbar strip instead of floating above it.
//!
//! Everything here is read-only shell/window querying (SHAppBarMessage,
//! GetWindowRect, GetMonitorInfoW). Nothing patches, injects into, or hooks
//! Explorer -- the companion is our own borderless window that happens to be
//! positioned over the taskbar's own rectangle.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskbarEdge {
    Bottom,
    Top,
    Left,
    Right,
}

/// Physical-pixel taskbar geometry for one monitor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarInfo {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub edge: TaskbarEdge,
    /// Windows display device name (e.g. `\.\DISPLAY1`) -- stable enough to
    /// persist as `taskbarMonitorId` so the companion is not pinned to the
    /// primary monitor forever.
    pub monitor_id: String,
    pub is_primary: bool,
    pub auto_hide: bool,
    /// False while an auto-hiding taskbar is slid off-screen.
    pub visible: bool,
    pub scale: f64,
    /// Full monitor bounds (physical), used to clamp the popup on screen.
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: i32,
    pub monitor_height: i32,
}

#[cfg(windows)]
mod imp {
    use super::{TaskbarEdge, TaskbarInfo};
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, SHAppBarMessage, SetWindowSubclass, ABM_GETSTATE, ABS_AUTOHIDE, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetCursorPos, GetTopWindow, GetWindow, GetWindowLongPtrW,
        GetWindowRect, SetWindowLongPtrW, MA_NOACTIVATE, MONITORINFOF_PRIMARY,
        SetWindowPos, GWL_EXSTYLE, GW_HWNDNEXT, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, WM_MOUSEACTIVATE, WS_EX_NOACTIVATE,
    };

    const TASKBAR_CLASSES: [&str; 2] = ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

    unsafe extern "system" fn collect_taskbars(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buffer = [0u16; 128];
        let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
        if length > 0 {
            let class = String::from_utf16_lossy(&buffer[..length as usize]);
            if TASKBAR_CLASSES.contains(&class.as_str()) {
                let windows = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
                windows.push(hwnd);
            }
        }
        BOOL(1)
    }

    fn taskbar_windows() -> Vec<HWND> {
        let mut found: Vec<HWND> = Vec::new();
        let _ = unsafe {
            EnumWindows(
                Some(collect_taskbars),
                LPARAM(&mut found as *mut Vec<HWND> as isize),
            )
        };
        found
    }

    fn auto_hide_enabled() -> bool {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            ..Default::default()
        };
        let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as u32;
        state & ABS_AUTOHIDE != 0
    }

    fn edge_for(rect: &RECT, monitor: &RECT) -> TaskbarEdge {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width >= height {
            // Compare against the monitor's vertical midpoint so an auto-hidden
            // (off-screen) taskbar still resolves to the edge it belongs to.
            if (rect.top + rect.bottom) / 2 >= (monitor.top + monitor.bottom) / 2 {
                TaskbarEdge::Bottom
            } else {
                TaskbarEdge::Top
            }
        } else if (rect.left + rect.right) / 2 >= (monitor.left + monitor.right) / 2 {
            TaskbarEdge::Right
        } else {
            TaskbarEdge::Left
        }
    }

    /// An auto-hiding taskbar is not destroyed when it hides: Windows slides it
    /// off-screen leaving a couple of pixels behind.
    fn on_screen(rect: &RECT, monitor: &RECT, edge: TaskbarEdge) -> bool {
        let slack = 6;
        match edge {
            TaskbarEdge::Bottom => rect.top < monitor.bottom - slack,
            TaskbarEdge::Top => rect.bottom > monitor.top + slack,
            TaskbarEdge::Left => rect.right > monitor.left + slack,
            TaskbarEdge::Right => rect.left < monitor.right - slack,
        }
    }

    fn info_for(hwnd: HWND, auto_hide: bool) -> Option<TaskbarInfo> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;

        let monitor_handle = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let mut monitor_info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let ok = unsafe {
            GetMonitorInfoW(
                monitor_handle,
                &mut monitor_info as *mut MONITORINFOEXW as *mut MONITORINFO,
            )
        };
        if !ok.as_bool() {
            return None;
        }

        let monitor_rect = monitor_info.monitorInfo.rcMonitor;
        let edge = edge_for(&rect, &monitor_rect);
        let device = unsafe { PWSTR(monitor_info.szDevice.as_ptr() as *mut u16).to_string() }
            .unwrap_or_default();
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };

        Some(TaskbarInfo {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            edge,
            monitor_id: device,
            is_primary: monitor_info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            auto_hide,
            visible: on_screen(&rect, &monitor_rect, edge),
            scale,
            monitor_x: monitor_rect.left,
            monitor_y: monitor_rect.top,
            monitor_width: monitor_rect.right - monitor_rect.left,
            monitor_height: monitor_rect.bottom - monitor_rect.top,
        })
    }

    /// All taskbars currently on the desktop, one per monitor that has one.
    pub fn all_taskbars() -> Vec<TaskbarInfo> {
        let auto_hide = auto_hide_enabled();
        taskbar_windows()
            .into_iter()
            .filter_map(|hwnd| info_for(hwnd, auto_hide))
            .collect()
    }

    /// Marks a window as "never take activation". Mouse input still reaches it
    /// (so hover and click keep working), but showing or clicking it will not
    /// pull keyboard focus away from the app the user is typing in.
    pub fn set_no_activate(hwnd: HWND, enabled: bool) {
        unsafe {
            let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let bit = WS_EX_NOACTIVATE.0 as isize;
            let next = if enabled { current | bit } else { current & !bit };
            if next != current {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
    }

    const NO_ACTIVATE_SUBCLASS_ID: usize = 1;

    /// A window that refuses activation would otherwise have its clicks eaten:
    /// Windows treats each click on an inactive window as an activation click,
    /// and `WS_EX_NOACTIVATE` alone leaves that click consumed. Answering
    /// `WM_MOUSEACTIVATE` with `MA_NOACTIVATE` says "do not activate me, but do
    /// deliver the click", which is what makes click-to-pin work without taking
    /// keyboard focus away from the app underneath.
    unsafe extern "system" fn no_activate_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if message == WM_MOUSEACTIVATE {
            return LRESULT(MA_NOACTIVATE as isize);
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn deliver_clicks_without_activation(hwnd: HWND) {
        let _ = unsafe {
            SetWindowSubclass(hwnd, Some(no_activate_proc), NO_ACTIVATE_SUBCLASS_ID, 0)
        };
    }

    // Declared directly instead of pulling in another `windows` feature module,
    // which would mean rebuilding that very large crate for two calls.
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }

    const VK_ESCAPE: i32 = 0x1B;
    const VK_LBUTTON: i32 = 0x01;

    fn key_down(virtual_key: i32) -> bool {
        (unsafe { GetAsyncKeyState(virtual_key) } as u16 & 0x8000) != 0
    }

    /// A pinned popup cannot hold keyboard focus (it never takes foreground, so
    /// the app the user is typing in keeps it). Reading these two key states is
    /// what still lets Escape and a click elsewhere dismiss it.
    pub fn escape_down() -> bool {
        key_down(VK_ESCAPE)
    }

    pub fn primary_mouse_down() -> bool {
        key_down(VK_LBUTTON)
    }

    /// The live cursor position in physical screen pixels. Read from the shell
    /// rather than from window events, which a never-activated window does not
    /// reliably receive.
    pub fn cursor_position() -> Option<(f64, f64)> {
        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.ok()?;
        Some((f64::from(point.x), f64::from(point.y)))
    }

    /// True when a taskbar window sits in front of `hwnd` in the z-order.
    ///
    /// The taskbar is topmost too, and Explorer re-raises it from time to time
    /// (and on its own repaints). When that happens the companion keeps
    /// drawing correctly at the right place but is hidden underneath the
    /// taskbar, which looks exactly like the window having vanished.
    pub fn is_behind_taskbar(hwnd: HWND) -> bool {
        let bars = taskbar_windows();
        if bars.is_empty() {
            return false;
        }
        let mut current = unsafe { GetTopWindow(None) }.unwrap_or_default();
        // Front to back: whichever of the two is met first is the one on top.
        while !current.0.is_null() {
            if current == hwnd {
                return false;
            }
            if bars.contains(&current) {
                return true;
            }
            current = match unsafe { GetWindow(current, GW_HWNDNEXT) } {
                Ok(next) => next,
                Err(_) => break,
            };
        }
        false
    }

    /// Re-asserts topmost z-order without activating the window, so the
    /// companion stays drawn over the taskbar and the popup over other apps.
    pub fn raise_topmost_no_activate(hwnd: HWND) {
        let _ = unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        };
    }
}

#[cfg(not(windows))]
mod imp {
    use super::TaskbarInfo;

    pub fn all_taskbars() -> Vec<TaskbarInfo> {
        Vec::new()
    }
}

pub fn all_taskbars() -> Vec<TaskbarInfo> {
    imp::all_taskbars()
}

/// Picks the taskbar the companion should live on: the monitor the user chose
/// (`taskbarMonitorId`) when it is still connected, then the primary one.
///
/// `last_used` keeps a multi-monitor setup steady. A poll that momentarily
/// fails to see the primary taskbar (Explorer busy, a bar mid-move) must not
/// fling the companion onto another monitor's taskbar and back.
pub fn taskbar_for_monitor(monitor_id: Option<&str>, last_used: Option<&str>) -> Option<TaskbarInfo> {
    let bars = all_taskbars();
    let by_id = |id: &str| bars.iter().find(|bar| bar.monitor_id == id).cloned();

    monitor_id
        .filter(|id| !id.is_empty())
        .and_then(by_id)
        .or_else(|| bars.iter().find(|bar| bar.is_primary).cloned())
        .or_else(|| last_used.filter(|id| !id.is_empty()).and_then(by_id))
        .or_else(|| bars.first().cloned())
}

#[cfg(windows)]
pub use imp::{
    cursor_position, deliver_clicks_without_activation, escape_down, is_behind_taskbar,
    primary_mouse_down, raise_topmost_no_activate, set_no_activate,
};

#[cfg(not(windows))]
pub fn cursor_position() -> Option<(f64, f64)> {
    None
}

#[cfg(not(windows))]
pub fn escape_down() -> bool {
    false
}

#[cfg(not(windows))]
pub fn primary_mouse_down() -> bool {
    false
}
