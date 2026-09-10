import { invoke } from "@tauri-apps/api/core"

export interface TaskbarInfo {
  x: number
  y: number
  width: number
  height: number
  edge: "bottom" | "top" | "left" | "right"
  monitorId: string
  isPrimary: boolean
  autoHide: boolean
  visible: boolean
  scale: number
  monitorX: number
  monitorY: number
  monitorWidth: number
  monitorHeight: number
}

// Visibility (enabled/disabled, persisted) lives in windowManager's
// showTaskbarCompanion/hideTaskbarCompanion. This module only handles the
// companion's placement inside the real Windows taskbar rectangle.
export async function positionTaskbarCompanion() {
  return invoke("position_taskbar_companion").catch(() => undefined)
}

/** The taskbar the companion is currently docked to, straight from the shell. */
export async function getTaskbarInfo() {
  return invoke<TaskbarInfo | null>("get_taskbar_info").catch(() => null)
}

/** Every monitor that has a taskbar, for the monitor picker. */
export async function listTaskbars() {
  return invoke<TaskbarInfo[]>("list_taskbars").catch(() => [])
}

/** Empty string means "follow whichever monitor is primary". */
export async function setTaskbarMonitor(monitorId: string) {
  return invoke("set_taskbar_monitor", { monitorId: monitorId || null }).catch(() => undefined)
}
