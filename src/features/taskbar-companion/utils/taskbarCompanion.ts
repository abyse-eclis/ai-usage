import type { ProviderId, ProviderUsage, UsageLimit } from "../../../shared/types/usage"

export type CompanionLimitKind = "fiveHour" | "weekly" | "fable" | "other"
export type CompanionTimeFormat = "24-hour" | "12-hour"
export type CompanionStatus = "connected" | "cached" | "failed" | "unavailable"

export interface CompanionLimitRow {
  kind: CompanionLimitKind
  /** Name of the window this row covers, spelled out for the popup. */
  label: string
  remainingPercent?: number
  /** What the strip prints: "90%" for percent limits, "19" for counted ones. */
  valueText: string
  /**
   * What the value counts, for the popup only -- "msgs" for a counted limit,
   * undefined when the value already carries its own percent sign.
   */
  valueUnit?: string
  resetText?: string
}

/** One provider's slice of the summary strip and of the popup. */
export interface CompanionProviderData {
  provider: ProviderId
  providerLabel: string
  primary?: CompanionLimitRow
  rows: CompanionLimitRow[]
  status: CompanionStatus
}

export interface CompanionClaudeData extends CompanionProviderData {
  provider: "claude"
  providerLabel: "Claude"
  checkedText: string
}

/** Every provider that has something to show, plus the shared freshness line. */
export interface CompanionData {
  providers: CompanionProviderData[]
  checkedText: string
  status: CompanionStatus
}

export interface CompanionShowSettings {
  showFiveHour: boolean
  showWeekly: boolean
  showFable: boolean
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const companionProviderLabels: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT"
}

/** Strip order. Claude leads because it is the companion's primary provider. */
export const companionProviderOrder: ProviderId[] = ["claude", "codex", "chatgpt"]

export function usedToRemainingPercent(usedPercent?: number) {
  if (usedPercent === undefined || Number.isNaN(usedPercent)) return undefined
  return clampPercent(100 - usedPercent)
}

export function displayRemainingPercent(limit: UsageLimit) {
  return limit.remainingPercent ?? usedToRemainingPercent(limit.usedPercent)
}

interface BuildArgs {
  usage?: ProviderUsage
  cached?: ProviderUsage
  refreshFailed: boolean
  show: CompanionShowSettings
  now?: Date
  timeFormat?: CompanionTimeFormat
}

export function buildClaudeCompanionData(args: BuildArgs): CompanionClaudeData {
  const built = buildProviderData("claude", args)
  return { ...built, provider: "claude", providerLabel: "Claude" }
}

/**
 * The summary strip: one segment per provider that reported usage. Providers
 * with nothing to show are dropped rather than printed as an empty slot.
 */
export function buildCompanionData({
  usage,
  cache,
  refreshFailed,
  show,
  now = new Date(),
  timeFormat = "24-hour",
  order = companionProviderOrder
}: {
  usage: Partial<Record<ProviderId, ProviderUsage>>
  cache: Partial<Record<ProviderId, ProviderUsage>>
  refreshFailed: boolean
  show: CompanionShowSettings
  now?: Date
  timeFormat?: CompanionTimeFormat
  order?: ProviderId[]
}): CompanionData {
  const built = order.map((provider) =>
    buildProviderData(provider, {
      usage: usage[provider],
      cached: cache[provider],
      refreshFailed,
      show,
      now,
      timeFormat
    })
  )
  const providers = built.filter((entry) => entry.rows.length > 0)
  // Freshness is reported once, from the provider the strip leads with.
  const lead = providers[0] ?? built[0]

  return {
    providers,
    checkedText: lead?.checkedText ?? formatCheckedText(undefined, "unavailable", now),
    status: lead?.status ?? "unavailable"
  }
}

function buildProviderData(
  provider: ProviderId,
  { usage, cached, refreshFailed, show, now = new Date(), timeFormat = "24-hour" }: BuildArgs
): CompanionProviderData & { checkedText: string } {
  const liveUsage = usage?.provider === provider && usage.status === "connected" ? usage : undefined
  const source = liveUsage ?? (cached?.provider === provider ? cached : undefined)
  const rows: CompanionLimitRow[] =
    source?.limits.reduce<CompanionLimitRow[]>((items, limit) => {
      const row = toCompanionRow(limit, now, timeFormat, provider)
      if (row && shouldShow(row.kind, show, provider)) items.push(row)
      return items
    }, []) ?? []
  const primary = rows.find((row) => row.kind === "fiveHour") ?? rows[0]
  const checkedAt = source?.lastSuccessfulAt ?? cached?.lastSuccessfulAt ?? source?.updatedAt ?? cached?.updatedAt
  const usingCache = source !== liveUsage && cached !== undefined
  const status: CompanionStatus =
    refreshFailed && checkedAt
      ? "failed"
      : usingCache
        ? "cached"
        : source?.status === "connected"
          ? "connected"
          : "unavailable"

  return {
    provider,
    providerLabel: companionProviderLabels[provider],
    primary,
    rows,
    status,
    checkedText: formatCheckedText(checkedAt, status, now)
  }
}

export function toCompanionRow(
  limit: UsageLimit,
  now = new Date(),
  timeFormat: CompanionTimeFormat = "24-hour",
  provider: ProviderId = "claude"
): CompanionLimitRow | undefined {
  const kind = classifyLimit(limit, provider)
  if (!kind) return undefined
  return {
    kind,
    label: companionLabel(kind, limit),
    remainingPercent: displayRemainingPercent(limit),
    valueText: limitValueText(limit),
    valueUnit: limitValueUnit(limit),
    resetText: formatCompanionReset(limit.resetAt, kind === "fiveHour" ? "compact" : "weekday", now, timeFormat)
  } satisfies CompanionLimitRow
}

/**
 * Percent limits read as remaining percent; limits counted in messages or
 * credits read as the raw remaining count, which is what the account shows.
 */
export function limitValueText(limit: UsageLimit) {
  const counted = limit.unit === "messages" || limit.unit === "credits" || limit.unit === "tokens"
  if (counted && limit.used !== undefined && limit.total !== undefined) {
    return formatCount(Math.max(0, limit.total - limit.used))
  }
  const remaining = displayRemainingPercent(limit)
  if (remaining === undefined && counted && limit.used !== undefined) return formatCount(limit.used)
  return formatRemaining(remaining)
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

export function formatCheckedText(checkedAt: string | undefined, status: CompanionStatus, now = new Date()) {
  const ago = checkedAt ? formatAgo(checkedAt, now) : "--"
  if (status === "cached") return `Cached · ${ago}`
  if (status === "failed") return `Failed · checked ${ago}`
  return `Checked ${ago}`
}

export function formatRemaining(value?: number) {
  return value === undefined ? "--" : `${clampPercent(value)}%`
}

function classifyLimit(limit: UsageLimit, provider: ProviderId): CompanionLimitKind | undefined {
  const key = `${limit.id} ${limit.label}`.toLowerCase()
  if (limit.period === "session" || key.includes("five") || key.includes("5h") || key.includes("session")) return "fiveHour"
  if (key.includes("fable")) return "fable"
  if (limit.period === "weekly" || key.includes("weekly") || key.includes("seven-day") || key.includes("7")) return "weekly"
  // Claude's popup only ever showed the three windows it knows about; other
  // providers keep whatever windows they report.
  return provider === "claude" ? undefined : "other"
}

function companionLabel(kind: CompanionLimitKind, limit: UsageLimit) {
  if (kind === "fiveHour") return "5-hour"
  if (kind === "weekly") return "weekly"
  if (kind === "fable") return "fable"
  return shortLabel(limit.label || limit.id)
}

/** Popup rows are narrow, so a provider's own label gets trimmed to fit. */
function shortLabel(label: string) {
  const compact = label.trim().toLowerCase().replace(/\s+/g, " ")
  return compact.length > 12 ? compact.slice(0, 12) : compact
}

/**
 * Names what a counted value is, so the popup can say "19 msgs" where the
 * strip only has room for "19". Percent values need no unit -- the sign is
 * already in the text.
 */
function limitValueUnit(limit: UsageLimit) {
  if (limitValueText(limit).endsWith("%")) return undefined
  if (limit.unit === "messages") return "msgs"
  if (limit.unit === "credits") return "credits"
  if (limit.unit === "tokens") return "tokens"
  return undefined
}

function shouldShow(kind: CompanionLimitKind, show: CompanionShowSettings, provider: ProviderId) {
  if (provider !== "claude") return true
  if (kind === "fiveHour") return show.showFiveHour
  if (kind === "weekly") return show.showWeekly
  if (kind === "fable") return show.showFable
  return true
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

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)))
}
