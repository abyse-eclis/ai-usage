import type { ProviderUsage, UsageLimit } from "../../../shared/types/usage"

export type CompanionLimitKind = "fiveHour" | "weekly" | "fable"
export type CompanionTimeFormat = "24-hour" | "12-hour"

export interface CompanionLimitRow {
  kind: CompanionLimitKind
  label: "5h" | "wly" | "fable"
  remainingPercent?: number
  resetText?: string
}

export interface CompanionClaudeData {
  providerLabel: "Claude"
  primary?: CompanionLimitRow
  rows: CompanionLimitRow[]
  checkedText: string
  status: "connected" | "cached" | "failed" | "unavailable"
}

export interface CompanionShowSettings {
  showFiveHour: boolean
  showWeekly: boolean
  showFable: boolean
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function usedToRemainingPercent(usedPercent?: number) {
  if (usedPercent === undefined || Number.isNaN(usedPercent)) return undefined
  return clampPercent(100 - usedPercent)
}

export function displayRemainingPercent(limit: UsageLimit) {
  return limit.remainingPercent ?? usedToRemainingPercent(limit.usedPercent)
}

export function buildClaudeCompanionData({
  usage,
  cached,
  refreshFailed,
  show,
  now = new Date(),
  timeFormat = "24-hour"
}: {
  usage?: ProviderUsage
  cached?: ProviderUsage
  refreshFailed: boolean
  show: CompanionShowSettings
  now?: Date
  timeFormat?: CompanionTimeFormat
}): CompanionClaudeData {
  const liveUsage = usage?.provider === "claude" && usage.status === "connected" ? usage : undefined
  const source = liveUsage ?? (cached?.provider === "claude" ? cached : undefined)
  const rows: CompanionLimitRow[] =
    source?.limits.reduce<CompanionLimitRow[]>((items, limit) => {
      const row = toCompanionRow(limit, now, timeFormat)
      if (row && shouldShow(row.kind, show)) items.push(row)
      return items
    }, []) ?? []
  const primary = rows.find((row) => row.kind === "fiveHour") ?? rows[0]
  const checkedAt = source?.lastSuccessfulAt ?? cached?.lastSuccessfulAt ?? source?.updatedAt ?? cached?.updatedAt
  const usingCache = source !== liveUsage && cached !== undefined
  const status = refreshFailed && checkedAt ? "failed" : usingCache ? "cached" : source?.status === "connected" ? "connected" : "unavailable"

  return {
    providerLabel: "Claude",
    primary,
    rows,
    checkedText: formatCheckedText(checkedAt, status, now),
    status
  }
}

export function toCompanionRow(
  limit: UsageLimit,
  now = new Date(),
  timeFormat: CompanionTimeFormat = "24-hour"
): CompanionLimitRow | undefined {
  const kind = classifyClaudeLimit(limit)
  if (!kind) return undefined
  return {
    kind,
    label: companionLabel(kind),
    remainingPercent: displayRemainingPercent(limit),
    resetText: formatCompanionReset(limit.resetAt, kind === "fiveHour" ? "compact" : "weekday", now, timeFormat)
  } satisfies CompanionLimitRow
}

export function formatCompanionReset(
  resetAt: string | undefined,
  mode: "compact" | "weekday",
  now = new Date(),
  timeFormat: CompanionTimeFormat = "24-hour"
) {
  if (!resetAt) return "--"
  const date = new Date(resetAt)
  if (Number.isNaN(date.getTime())) return "--"
  const time = formatLocalTime(date, timeFormat)
  if (mode === "weekday" || date.toDateString() !== now.toDateString()) {
    return `${weekdays[date.getDay()]} ${time}`
  }
  return time
}

export function formatCheckedText(checkedAt: string | undefined, status: CompanionClaudeData["status"], now = new Date()) {
  const ago = checkedAt ? formatAgo(checkedAt, now) : "--"
  if (status === "cached") return `Cached \u00b7 ${ago}`
  if (status === "failed") return `Failed \u00b7 checked ${ago}`
  return `Checked ${ago}`
}

export function formatRemaining(value?: number) {
  return value === undefined ? "--" : `${clampPercent(value)}%`
}

function classifyClaudeLimit(limit: UsageLimit): CompanionLimitKind | undefined {
  const key = `${limit.id} ${limit.label}`.toLowerCase()
  if (limit.period === "session" || key.includes("five") || key.includes("5h") || key.includes("session")) return "fiveHour"
  if (key.includes("fable")) return "fable"
  if (limit.period === "weekly" || key.includes("weekly") || key.includes("seven-day") || key.includes("7")) return "weekly"
  return undefined
}

function companionLabel(kind: CompanionLimitKind): CompanionLimitRow["label"] {
  if (kind === "fiveHour") return "5h"
  if (kind === "weekly") return "wly"
  return "fable"
}

function shouldShow(kind: CompanionLimitKind, show: CompanionShowSettings) {
  if (kind === "fiveHour") return show.showFiveHour
  if (kind === "weekly") return show.showWeekly
  return show.showFable
}

function formatLocalTime(date: Date, timeFormat: CompanionTimeFormat) {
  return new Intl.DateTimeFormat("en-US", {
    hour: timeFormat === "12-hour" ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: timeFormat === "12-hour" ? "h12" : "h23"
  }).format(date)
}

function formatAgo(iso: string, now: Date) {
  const diffMs = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(diffMs)) return "--"
  const minutes = Math.max(0, Math.floor(diffMs / 60000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)))
}
