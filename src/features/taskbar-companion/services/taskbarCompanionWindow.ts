import { invoke } from "@tauri-apps/api/core"

export async function setTaskbarCompanionVisible(enabled: boolean) {
  return invoke("set_taskbar_companion_visible", { enabled }).catch(() => undefined)
}

export async function positionTaskbarCompanion() {
  return invoke("position_taskbar_companion").catch(() => undefined)
}

export async function hideTaskbarCompanion() {
  return setTaskbarCompanionVisible(false)
}
