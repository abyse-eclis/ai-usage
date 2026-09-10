import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { companionLog } from "../utils/log"

/**
 * The hover detail popup is its own borderless native window: the companion
 * window is only as tall as the taskbar, so anything drawn above it inside
 * that window would be clipped by the window bounds.
 *
 * Ownership of the hover state stays in the companion window. The popup only
 * reports its own pointer/keyboard events back over these events.
 */
/** Rust-owned hover state, polled from the real cursor position. */
export const pointerEvent = "companion-pointer"

export interface PointerState {
  overCompanion: boolean
  overPopup: boolean
}
export const popupDismissEvent = "companion-popup-dismiss"
export const popupPinnedEvent = "companion-popup-pinned"

/** Kept in one place so the companion (which asks for the window) and the popup (which fills it) agree. */
export function companionPopupSize(rowCount: number) {
  const rows = Math.max(1, rowCount)
  return { width: 248, height: 24 + 20 + 8 + rows * 21 + 10 + 14 }
}

export async function showCompanionPopup(size: { width: number; height: number }) {
  companionLog("[Popup] requested show", size)
  try {
    await invoke("show_companion_popup", size)
    companionLog("[Popup] show resolved")
  } catch (error) {
    companionLog("[Popup] show failed", error)
  }
}

export async function hideCompanionPopup() {
  companionLog("[Popup] requested hide")
  await invoke("hide_companion_popup").catch((error) => companionLog("[Popup] hide failed", error))
}

/** Pinning may activate the popup (so Escape and click-outside work); hovering must not. */
export async function setCompanionPopupPinned(pinned: boolean) {
  await invoke("set_companion_popup_pinned", { pinned }).catch((error) =>
    companionLog("[Popup] pin failed", error)
  )
  await emit(popupPinnedEvent, pinned).catch(() => undefined)
}

export async function requestPopupDismiss() {
  companionLog("[Popup] dismiss requested")
  await invoke("dismiss_companion_popup").catch((error) =>
    companionLog("[Popup] dismiss failed", error)
  )
}
