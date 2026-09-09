import { ChevronRight, CircleAlert } from "lucide-react"
import type { ProviderUsage } from "../../../shared/types/usage"
import { formatResetCountdown } from "../../../shared/utils/time"
import { ProgressBar } from "./ProgressBar"

const accents: Record<ProviderUsage["provider"], string> = {
  claude: "hsl(var(--accent-claude))",
  codex: "hsl(var(--accent-codex))",
  chatgpt: "hsl(var(--accent-chatgpt))"
}

const names: Record<ProviderUsage["provider"], string> = {
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT"
}

interface ProviderCardProps {
  usage: ProviderUsage
  compact?: boolean
  detailed?: boolean
}

export function ProviderCard({ usage, compact = false, detailed = false }: ProviderCardProps) {
  const accent = accents[usage.provider]
  const visibleLimits = compact ? usage.limits.slice(0, 1) : usage.limits

  return (
    <section className="rounded-[8px] border border-white/10 bg-[hsl(var(--color-card)/0.38)] px-3 py-2.5 shadow-[0_12px_32px_rgb(0_0_0/0.18)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold text-[hsl(var(--color-text))]">{names[usage.provider]}</h2>
        <ChevronRight className="size-4 shrink-0 text-[hsl(var(--color-muted))]" aria-hidden />
      </div>

      {usage.status === "connected" ? (
        <div className="space-y-2">
          {visibleLimits.map((limit) => (
            <div key={limit.id} className="grid grid-cols-[minmax(60px,0.9fr)_minmax(76px,1.5fr)_auto] items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs text-[hsl(var(--color-text))]">{limit.label}</div>
                {!compact && limit.resetAt ? (
                  <div className="mt-1 truncate text-xs text-[hsl(var(--color-muted))]">
                    {formatResetCountdown(limit.resetAt)}
                  </div>
                ) : null}
              </div>
              <ProgressBar percent={limit.usedPercent} accent={accent} label={`${names[usage.provider]} ${limit.label}`} />
              <div className="min-w-10 text-right text-xs font-medium text-[hsl(var(--color-text))]">
                {limit.used !== undefined && limit.total !== undefined ? `${limit.used} / ${limit.total}` : `${limit.usedPercent ?? 0}%`}
              </div>
            </div>
          ))}
          {detailed && usage.error ? <p className="text-xs text-[hsl(var(--color-muted))]">{usage.error.message}</p> : null}
        </div>
      ) : (
        <div className="flex items-start gap-2 text-xs text-[hsl(var(--color-muted))]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div>{usage.error?.message ?? "Usage unavailable"}</div>
            {usage.lastSuccessfulAt ? <div className="mt-1 text-xs">Last successful update {usage.lastSuccessfulAt}</div> : null}
          </div>
        </div>
      )}
    </section>
  )
}
