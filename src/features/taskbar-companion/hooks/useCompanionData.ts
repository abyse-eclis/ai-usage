import { emit, listen } from "@tauri-apps/api/event"
import { useEffect, useMemo, useState } from "react"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { useUsageStore, type UsageStateSnapshot } from "../../widget/store/usageStore"
import { buildClaudeCompanionData } from "../utils/taskbarCompanion"

/**
 * Both the companion and its hover popup read the single usage store that the
 * Main Widget's fetch loop feeds. Neither window ever calls a provider: they
 * apply the broadcast snapshot, and ask for a re-broadcast when they mount.
 */
export function useCompanionData() {
  const { settings } = useSettingsStore()
  const usage = useUsageStore((state) => state.usage.claude)
  const cached = useUsageStore((state) => state.cache.claude?.usage)
  const refreshFailed = useUsageStore((state) => state.refreshFailed)
  const applySnapshot = useUsageStore((state) => state.applySnapshot)
  const companion = settings.taskbarCompanion
  const [minute, setMinute] = useState(0)

  useEffect(() => {
    const unlisten = listen<UsageStateSnapshot>("usage-state-updated", (event) => applySnapshot(event.payload))
    emit("usage-state-request").catch(() => undefined)
    return () => {
      unlisten.then((dispose) => dispose()).catch(() => undefined)
    }
  }, [applySnapshot])

  // Keeps the "Checked 2m ago" line and reset countdowns honest.
  useEffect(() => {
    const timer = window.setInterval(() => setMinute((value) => value + 1), 60000)
    return () => window.clearInterval(timer)
  }, [])

  const data = useMemo(
    () =>
      buildClaudeCompanionData({
        usage,
        cached,
        refreshFailed,
        timeFormat: companion.timeFormat,
        show: {
          showFiveHour: companion.showFiveHour,
          showWeekly: companion.showWeekly,
          showFable: companion.showFable
        }
      }),
    // `minute` is a deliberate cache-buster for the relative timestamps.
    [
      cached,
      companion.showFable,
      companion.showFiveHour,
      companion.showWeekly,
      companion.timeFormat,
      minute,
      refreshFailed,
      usage
    ]
  )

  return { data, settings, companion }
}
