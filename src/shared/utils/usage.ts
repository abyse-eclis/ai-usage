import type { UsageLimit } from "../types/usage"

export function clampPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return undefined
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function normalizeLimit(limit: UsageLimit): UsageLimit {
  const usedPercent =
    limit.usedPercent ??
    (limit.remainingPercent !== undefined ? 100 - limit.remainingPercent : undefined) ??
    (limit.used !== undefined && limit.total ? (limit.used / limit.total) * 100 : undefined)

  const normalizedUsedPercent = clampPercent(usedPercent)
  const normalizedRemainingPercent =
    limit.remainingPercent !== undefined
      ? clampPercent(limit.remainingPercent)
      : normalizedUsedPercent !== undefined
        ? clampPercent(100 - normalizedUsedPercent)
        : undefined

  return {
    ...limit,
    usedPercent: normalizedUsedPercent,
    remainingPercent: normalizedRemainingPercent,
    rawValue: limit.rawValue ?? {
      sourceUsedPercent: limit.usedPercent,
      sourceRemainingPercent: limit.remainingPercent,
      used: limit.used,
      total: limit.total
    }
  }
}

export function primaryLimit(limits: UsageLimit[]) {
  return limits.find((limit) => limit.period === "session") ?? limits[0]
}
