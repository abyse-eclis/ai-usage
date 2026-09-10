import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { CompanionPopup } from "../features/taskbar-companion/components/CompanionPopup"
import { TaskbarCompanion } from "../features/taskbar-companion/components/TaskbarCompanion"
import { useSettingsStore } from "../features/settings/store/settingsStore"
import type { PresentationSettings } from "../features/settings/types/settings"
import { restorePresentationState } from "../features/window-manager/services/windowManager"
import { Widget } from "../features/widget/components/Widget"

/**
 * Keeps each window's local `settings.presentation` mirror in sync with
 * Rust's persisted presentation state (the real source of truth for window
 * visibility). Runs in every window so tray/settings changes made from
 * elsewhere are reflected without ever driving visibility itself.
 */
function usePresentationSync() {
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  useEffect(() => {
    let cancelled = false
    restorePresentationState().then((snapshot) => {
      if (snapshot && !cancelled) updateSettings({ presentation: snapshot })
    })

    const unlisten = listen<PresentationSettings>("presentation-state-changed", (event) => {
      updateSettings({ presentation: event.payload })
    })

    return () => {
      cancelled = true
      unlisten.then((dispose) => dispose()).catch(() => undefined)
    }
  }, [updateSettings])
}

export function App() {
  usePresentationSync()
  if (window.location.pathname === "/companion-popup") return <CompanionPopup />
  if (window.location.pathname === "/companion") return <TaskbarCompanion />
  return <Widget />
}
