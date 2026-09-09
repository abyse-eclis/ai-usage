export type UsageSeverity = "normal" | "warning" | "high" | "critical"

export interface UsageThresholds {
  warning: number
  high: number
  critical: number
}

export const defaultThresholds: UsageThresholds = {
  warning: 80,
  high: 90,
  critical: 95
}

export function getUsageSeverity(percent = 0, thresholds = defaultThresholds): UsageSeverity {
  if (percent >= thresholds.critical) return "critical"
  if (percent >= thresholds.high) return "high"
  if (percent >= thresholds.warning) return "warning"
  return "normal"
}

export function nextReachedThreshold(percent: number, thresholds = defaultThresholds) {
  if (percent >= thresholds.critical) return thresholds.critical
  if (percent >= thresholds.high) return thresholds.high
  if (percent >= thresholds.warning) return thresholds.warning
  return undefined
}
