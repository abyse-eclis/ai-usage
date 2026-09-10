import { CircleAlert } from "lucide-react"
import type { ProviderUsage, UsageLimit } from "../../../shared/types/usage"
import { formatClock } from "../../../shared/utils/time"
import { getUsageSeverity } from "../../../shared/utils/thresholds"
import { useSettingsStore } from "../../settings/store/settingsStore"
import type { WidgetSizeMode } from "../types/widget"

const names: Record<ProviderUsage["provider"], string> = {
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT"
}

interface ProviderCardProps {
  usage: ProviderUsage
  mode: WidgetSizeMode
}

export function ProviderCard({ usage, mode }: ProviderCardProps) {
  const thresholds = useSettingsStore((state) => state.settings.thresholds)
  const visibleLimits = visibleLimitCount(mode, usage.limits.length)

  return (
    <section className="border-b border-white/10 py-[7px] last:border-b-0">
      <h2 className="mb-1 truncate text-[11.5px] font-semibold leading-tight text-[hsl(var(--color-text))]">{names[usage.provider]}</h2>
      {usage.status === "connected" ? (
        <div className="space-y-1">
          {usage.limits.slice(0, visibleLimits).map((limit, index) => (
            <LimitRow key={limit.id} limit={limit} primary={index === 0} mode={mode} thresholds={thresholds} />
          ))}
          {mode === "large" && usage.error ? <p className="truncate text-[10px] text-[hsl(var(--color-muted))]">{usage.error.message}</p> : null}
        </div>
      ) : (
        <div className="flex items-start gap-1.5 text-[10px] leading-snug text-[hsl(var(--color-muted))]">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          <div>
            <div>{usage.error?.message ?? "Usage unavailable"}</div>
            {usage.lastSuccessfulAt ? <div className="mt-0.5">Checked {formatClock(usage.lastSuccessfulAt)}</div> : null}
          </div>
        </div>
      )}
    </section>
  )
}

function LimitRow({
  limit,
  primary,
  mode,
  thresholds
}: {
  limit: UsageLimit
  primary: boolean
  mode: WidgetSizeMode
  thresholds: { warning: number; high: number; critical: number }
}) {
  const usageText = formatUsage(limit, mode)
  const resetText = formatReset(limit, mode)
  const severity = getUsageSeverity(limit.usedPercent ?? 0, thresholds)
  const usageColor =
    severity === "critical"
      ? "text-[hsl(var(--state-critical))]"
      : severity === "high" || severity === "warning"
        ? "text-[hsl(var(--state-warning))]"
        : "text-[hsl(var(--color-text))]"

  return (
    <div className={primary ? "space-y-0.5" : "space-y-0.5 pt-1"}>
      {mode !== "small" || !primary ? (
        <div className={`truncate text-[9.5px] leading-tight ${primary ? "text-[hsl(var(--color-muted))]" : "text-[hsl(var(--color-muted-weak))]"}`}>
          {limit.label}
        </div>
      ) : null}
      <div className={`truncate text-[11.5px] font-semibold leading-tight ${usageColor}`}>{usageText}</div>
      {resetText ? <div className="truncate text-[9.5px] leading-tight text-[hsl(var(--color-muted))]">{resetText}</div> : null}
    </div>
  )
}

function visibleLimitCount(mode: WidgetSizeMode, total: number) {
  if (mode === "small") return Math.min(total, 1)
  if (mode === "medium") return Math.min(total, 2)
  return total
}

function formatUsage(limit: UsageLimit, mode: WidgetSizeMode) {
  if (limit.used !== undefined && limit.total !== undefined) {
    const left = Math.max(0, limit.total - limit.used)
    const count = mode === "small" ? `${formatNumber(limit.used)}/${formatNumber(limit.total)}` : `${formatNumber(limit.used)} / ${formatNumber(limit.total)} used`
    return `${count} \u00b7 ${formatNumber(left)} left`
  }

  if (limit.usedPercent !== undefined) {
    const left = limit.remainingPercent !== undefined ? `${limit.remainingPercent}% left` : undefined
    return left ? `${limit.usedPercent}% used \u00b7 ${left}` : `${limit.usedPercent}% used`
  }

  if (limit.used !== undefined) return `${formatNumber(limit.used)} used`
  if (limit.remainingPercent !== undefined) return `${limit.remainingPercent}% left`
  return "Usage unavailable"
}

function formatReset(limit: UsageLimit, mode: WidgetSizeMode) {
  if (!limit.resetAt) return limit.resetLabel
  const countdown = formatCountdown(limit.resetAt)
  if (!countdown) return limit.resetLabel
  if (mode === "small") return `Reset ${countdown}`
  const at = formatResetAt(limit.resetAt)
  return at ? `Reset ${countdown} \u00b7 ${at}` : `Reset ${countdown}`
}

function formatCountdown(resetAt: string, now = new Date()) {
  const diffMs = new Date(resetAt).getTime() - now.getTime()
  if (Number.isNaN(diffMs)) return undefined
  if (diffMs <= 0) return "now"
  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatResetAt(resetAt: string) {
  const date = new Date(resetAt)
  if (Number.isNaN(date.getTime())) return undefined
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return formatClock(resetAt)
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}
