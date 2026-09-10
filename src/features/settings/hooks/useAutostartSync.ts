import { useEffect, useRef } from "react"
import { reconcileAutostart, setAutostartEnabled } from "../services/autostart"
import { useSettingsStore } from "../store/settingsStore"

/**
 * Keeps the "Launch at startup" setting and the real Windows startup entry in
 * agreement.
 *
 * On launch the OS is read first and wins any disagreement, so removing the
 * entry from Task Manager's Startup tab sticks. After that, flipping the
 * setting is what registers or removes it. Only one window should run this,
 * hence `active`.
 */
export function useAutostartSync(active: boolean) {
  const launchAtStartup = useSettingsStore((state) => state.settings.launchAtStartup)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    reconcileAutostart(useSettingsStore.getState().settings.launchAtStartup)
      .then((actual) => {
        if (cancelled) return
        hydrated.current = true
        if (actual !== undefined && actual !== useSettingsStore.getState().settings.launchAtStartup) {
          updateSettings({ launchAtStartup: actual })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [active, updateSettings])

  useEffect(() => {
    // Never write to the OS before it has been read, or the stored value would
    // overwrite a startup entry the user removed outside the app.
    if (!active || !hydrated.current) return
    let cancelled = false
    setAutostartEnabled(launchAtStartup)
      .then((actual) => {
        if (cancelled || actual === undefined || actual === launchAtStartup) return
        // The OS refused the change; show what actually happened.
        updateSettings({ launchAtStartup: actual })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [active, launchAtStartup, updateSettings])
}
