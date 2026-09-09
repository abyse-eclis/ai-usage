import { AlertTriangle } from "lucide-react"
import { getUsageSeverity } from "../../../shared/utils/thresholds"
import { useSettingsStore } from "../../settings/store/settingsStore"

interface ProgressBarProps {
  percent?: number
  accent: string
  label: string
}

export function ProgressBar({ percent = 0, accent, label }: ProgressBarProps) {
  const thresholds = useSettingsStore((state) => state.settings.thresholds)
  const severity = getUsageSeverity(percent, thresholds)
  const color =
    severity === "critical"
      ? "hsl(var(--state-critical))"
      : severity === "high"
        ? "hsl(var(--state-high))"
        : severity === "warning"
          ? "hsl(var(--state-warning))"
          : accent

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        className="h-2.5 min-w-24 flex-1 overflow-hidden rounded-full bg-[hsl(var(--color-track)/0.72)]"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 72%, white))`
          }}
        />
      </div>
      {severity === "critical" ? <AlertTriangle className="size-4 text-[hsl(var(--state-critical))]" /> : null}
    </div>
  )
}
