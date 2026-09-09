import { Info, RefreshCw, Settings, X } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import type { ProviderUsage } from "../../../shared/types/usage"
import { formatClock } from "../../../shared/utils/time"
import { primaryLimit } from "../../../shared/utils/usage"
import { notifyThresholds } from "../../notifications/services/notifications"
import { SettingsPanel } from "../../settings/components/SettingsPanel"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { applyWidgetPreset, hideToTray, setAlwaysOnTop } from "../../window-manager/services/windowManager"
import { useContainerSize } from "../hooks/useContainerSize"
import { useUsageStore } from "../store/usageStore"
import { inferWidgetMode } from "../utils/presets"
import { ProviderCard } from "./ProviderCard"
import { ProgressBar } from "./ProgressBar"

const providerOrder = ["claude", "codex", "chatgpt"] as const

export function Widget() {
  const { ref, size } = useContainerSize<HTMLElement>()
  const layoutMode = inferWidgetMode(size)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const { settings, updateSettings } = useSettingsStore()
  const { usage, isRefreshing, refreshFailed, refreshUsage } = useUsageStore()

  const usages = useMemo(
    () => providerOrder.map((id) => usage[id]).filter((item): item is ProviderUsage => item !== undefined),
    [usage]
  )
  const latestUpdatedAt = usages
    .map((item) => item.updatedAt)
    .sort()
    .at(-1)

  useEffect(() => {
    refreshUsage(settings.demoMode)
  }, [refreshUsage, settings.demoMode])

  useEffect(() => {
    const interval = window.setInterval(() => refreshUsage(settings.demoMode), settings.refreshIntervalMinutes * 60000)
    return () => window.clearInterval(interval)
  }, [refreshUsage, settings.demoMode, settings.refreshIntervalMinutes])

  useEffect(() => {
    const minute = window.setInterval(() => setTick((value) => value + 1), 60000)
    return () => window.clearInterval(minute)
  }, [])

  useEffect(() => {
    setAlwaysOnTop(settings.alwaysOnTop)
  }, [settings.alwaysOnTop])

  useEffect(() => {
    if (settings.notificationsEnabled) {
      notifyThresholds(usages, settings.thresholds)
    }
  }, [settings.notificationsEnabled, settings.thresholds, usages, tick])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      const mode = event.key === "1" ? "small" : event.key === "2" ? "medium" : event.key === "3" ? "large" : undefined
      if (!mode) return
      updateSettings({ sizeMode: mode })
      applyWidgetPreset(mode)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [updateSettings])

  return (
    <main
      ref={ref}
      className="h-full w-full overflow-hidden rounded-[22px] border border-[hsl(var(--color-border)/0.62)] bg-[hsl(var(--color-panel)/var(--panel-opacity))] text-[hsl(var(--color-text))] shadow-[0_24px_70px_rgb(0_0_0/0.42)]"
      style={
        {
          "--panel-opacity": settings.opacity,
          backdropFilter: settings.backgroundBlur ? "blur(28px) saturate(1.25)" : undefined
        } as CSSProperties
      }
    >
      <div className="flex h-full flex-col p-4">
        <header className="drag-region mb-4 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-white">AI Usage</h1>
            {layoutMode !== "small" ? (
              <p className="truncate text-sm text-[hsl(var(--color-muted))]">Track your AI usage across providers</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {layoutMode !== "small" ? (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--color-muted))]">
                <span className="size-2 rounded-full bg-emerald-400" />
                Online
              </div>
            ) : null}
            <IconButton label="Refresh" onClick={() => refreshUsage(settings.demoMode)}>
              <RefreshCw className={`size-5 ${isRefreshing ? "animate-spin" : ""}`} />
            </IconButton>
            <IconButton label="Settings" onClick={() => setSettingsOpen((open) => !open)}>
              <Settings className="size-5" />
            </IconButton>
            <IconButton label="Hide to tray" onClick={hideToTray}>
              <X className="size-5" />
            </IconButton>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: settingsOpen && layoutMode === "large" ? "1fr 280px" : "1fr" }}>
          <div className="no-scrollbar min-h-0 overflow-y-auto">
            {layoutMode === "small" ? <SmallUsageList /> : <FullUsageList detailed={layoutMode === "large"} />}
          </div>
          <SettingsPanel open={settingsOpen} />
        </div>

        <footer className="mt-4 flex shrink-0 items-center justify-between border-t border-white/10 pt-3 text-xs text-[hsl(var(--color-muted))]">
          <span>
            {refreshFailed ? "Refresh failed" : "Updated"} {latestUpdatedAt ? formatClock(latestUpdatedAt) : "--:--"}
          </span>
          <div className="flex items-center gap-2">
            <PresetButton label="Small" active={settings.sizeMode === "small"} onClick={() => choosePreset("small")} />
            <PresetButton label="Medium" active={settings.sizeMode === "medium"} onClick={() => choosePreset("medium")} />
            <PresetButton label="Large" active={settings.sizeMode === "large"} onClick={() => choosePreset("large")} />
            <Info className="size-4" aria-label="Local-first demo mode is available from settings." />
          </div>
        </footer>
      </div>
    </main>
  )

  function choosePreset(mode: "small" | "medium" | "large") {
    updateSettings({ sizeMode: mode })
    applyWidgetPreset(mode)
  }
}

function SmallUsageList() {
  const usage = useUsageStore((state) => state.usage)
  return (
    <div className="space-y-3">
      {providerOrder.map((id) => {
        const providerUsage = usage[id]
        if (!providerUsage) return null
        const limit = primaryLimit(providerUsage.limits)
        const accent = id === "claude" ? "hsl(var(--accent-claude))" : id === "codex" ? "hsl(var(--accent-codex))" : "hsl(var(--accent-chatgpt))"
        return (
          <div key={id} className="rounded-[8px] border border-white/10 bg-white/[0.045] p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium">
              <span>{providerUsage.provider === "chatgpt" ? "ChatGPT" : providerUsage.provider.charAt(0).toUpperCase() + providerUsage.provider.slice(1)}</span>
              <span>{limit?.usedPercent ?? 0}%</span>
            </div>
            <ProgressBar percent={limit?.usedPercent} accent={accent} label={`${providerUsage.provider} primary usage`} />
          </div>
        )
      })}
    </div>
  )
}

function FullUsageList({ detailed }: { detailed: boolean }) {
  const usage = useUsageStore((state) => state.usage)
  return (
    <div className={detailed ? "grid gap-3 @container md:grid-cols-2" : "space-y-3"}>
      {providerOrder.map((id) => (usage[id] ? <ProviderCard key={id} usage={usage[id]!} detailed={detailed} /> : null))}
    </div>
  )
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="grid size-10 place-items-center rounded-[8px] bg-white/8 text-[hsl(var(--color-text))] outline-none transition hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-sky-300"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PresetButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`grid size-7 place-items-center rounded-[7px] text-[10px] outline-none transition focus-visible:ring-2 focus-visible:ring-sky-300 ${
        active ? "bg-white/16 text-white" : "bg-transparent text-[hsl(var(--color-muted))] hover:bg-white/10"
      }`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {label[0]}
    </button>
  )
}
