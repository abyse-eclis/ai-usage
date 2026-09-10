import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart"

/**
 * "Launch at startup" is registered with Windows itself (a Run key entry that
 * the autostart plugin owns), not with anything this app persists. The stored
 * setting is only a mirror of that OS state.
 *
 * The app already keeps running once started -- closing a window is prevented
 * and only the tray's Quit exits -- so registering here is all that "run every
 * time the computer starts" needs.
 */

/** A plain `vite dev` tab has no OS integration to register with. */
function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Whether Windows currently launches this app at sign-in. */
export async function isAutostartEnabled(): Promise<boolean | undefined> {
  if (!isDesktopRuntime()) return undefined
  try {
    return await isEnabled()
  } catch {
    return undefined
  }
}

/**
 * Registers or removes the startup entry. Returns what the OS reports
 * afterwards, so a refused write cannot leave the toggle lying.
 */
export async function setAutostartEnabled(enabled: boolean): Promise<boolean | undefined> {
  if (!isDesktopRuntime()) return undefined
  try {
    if (enabled) await enable()
    else await disable()
  } catch {
    // Locked-down machines can refuse the write; fall through and report the
    // state the OS actually ended up in.
  }
  return isAutostartEnabled()
}

/**
 * Brings the OS and the stored setting back into agreement at launch.
 *
 * The OS wins when the two disagree, because the user may have removed the
 * entry in Task Manager's Startup tab since the app last ran; re-adding it
 * behind their back would be wrong.
 */
export async function reconcileAutostart(stored: boolean): Promise<boolean | undefined> {
  const actual = await isAutostartEnabled()
  if (actual === undefined) return undefined
  return actual === stored ? stored : actual
}
