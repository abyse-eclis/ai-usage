import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import type { ProviderUsage } from "../../../shared/types/usage"
import { formatResetCountdown } from "../../../shared/utils/time"
import { nextReachedThreshold, type UsageThresholds } from "../../../shared/utils/thresholds"

const fired = new Set<string>()

export async function notifyThresholds(usages: ProviderUsage[], thresholds: UsageThresholds) {
  const allowed = await ensureNotificationPermission()
  if (!allowed) return

  for (const usage of usages) {
    for (const limit of usage.limits) {
      const percent = limit.usedPercent ?? 0
      const threshold = nextReachedThreshold(percent, thresholds)
      if (!threshold) continue
      const key = `${usage.provider}:${limit.id}:${threshold}:${limit.resetAt ?? "no-reset"}`
      if (fired.has(key)) continue
      fired.add(key)
      sendNotification({
        title: `${providerName(usage.provider)} ${limit.label} usage reached ${threshold}%`,
        body: formatResetCountdown(limit.resetAt) ?? "Open AI Usage Monitor for details."
      })
    }
  }
}

async function ensureNotificationPermission() {
  try {
    if (await isPermissionGranted()) return true
    return (await requestPermission()) === "granted"
  } catch {
    if (!("Notification" in window)) return false
    if (Notification.permission === "granted") return true
    if (Notification.permission === "denied") return false
    return (await Notification.requestPermission()) === "granted"
  }
}

function providerName(provider: ProviderUsage["provider"]) {
  if (provider === "chatgpt") return "ChatGPT"
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}
