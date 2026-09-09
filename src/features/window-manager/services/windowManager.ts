import { invoke } from "@tauri-apps/api/core"
import { LogicalSize } from "@tauri-apps/api/dpi"
import { getCurrentWindow } from "@tauri-apps/api/window"
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
