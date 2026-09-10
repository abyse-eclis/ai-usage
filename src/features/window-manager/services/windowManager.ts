import { invoke } from "@tauri-apps/api/core"
import { LogicalSize } from "@tauri-apps/api/dpi"
import { getCurrentWindow } from "@tauri-apps/api/window"
import type { PresentationSettings } from "../../settings/types/settings"
import type { WidgetSizeMode } from "../../widget/types/widget"
import { widgetPresets } from "../../widget/utils/presets"

export async function setAlwaysOnTop(enabled: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(enabled)
  } catch {
    await invoke("set_always_on_top", { enabled }).catch(() => undefined)
  }
}

export async function setSkipTaskbar(enabled: boolean) {
  try {
    await getCurrentWindow().setSkipTaskbar(enabled)
  } catch {
    await invoke("set_skip_taskbar", { enabled }).catch(() => undefined)
  }
}

export async function applyWidgetPreset(mode: WidgetSizeMode) {
  if (mode === "custom") return
  const preset = widgetPresets[mode]
  try {
    await getCurrentWindow().setSize(new LogicalSize(preset.width, preset.height))
  } catch {
    await invoke("resize_widget", { width: preset.width, height: preset.height }).catch(() => undefined)
  }
}

export async function hideToTray() {
  try {
    await getCurrentWindow().hide()
  } catch {
    await invoke("hide_widget").catch(() => undefined)
  }
}

// -----------------------------------------------------------------------
// Presentation modes: Main Widget, Taskbar Companion, and Edge Dock are
// independent windows/shapes. Rust's widget-state.json is the source of
// truth for "enabled" (and therefore startup visibility); each function
// below controls only the window it names -- none of them may show or hide
// a different presentation mode.
// -----------------------------------------------------------------------

export async function showMainWidget() {
  return invoke("set_main_widget_enabled", { enabled: true }).catch(() => undefined)
}

export async function hideMainWidget() {
  return invoke("set_main_widget_enabled", { enabled: false }).catch(() => undefined)
}

/** Persists whether the Main Widget should open on next launch, without changing its visibility now. */
export async function setMainWidgetStartupEnabled(enabled: boolean) {
  return invoke("set_main_widget_startup_preference", { enabled }).catch(() => undefined)
}

export async function showTaskbarCompanion() {
  return invoke("set_taskbar_companion_enabled", { enabled: true }).catch(() => undefined)
}

export async function hideTaskbarCompanion() {
  return invoke("set_taskbar_companion_enabled", { enabled: false }).catch(() => undefined)
}

export async function showEdgeDock() {
  return invoke("set_edge_dock_enabled", { enabled: true }).catch(() => undefined)
}

export async function hideEdgeDock() {
  return invoke("set_edge_dock_enabled", { enabled: false }).catch(() => undefined)
}

export async function getPresentationState(): Promise<PresentationSettings | undefined> {
  return invoke<PresentationSettings>("get_presentation_state").catch(() => undefined)
}

/** Re-reads persisted presentation state; used to hydrate the settings mirror on mount in every window. */
export async function restorePresentationState(): Promise<PresentationSettings | undefined> {
  return getPresentationState()
}
