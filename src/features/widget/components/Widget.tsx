import { ChevronLeft, ChevronRight, RefreshCw, Settings, X } from "lucide-react"
import { listen } from "@tauri-apps/api/event"
import type { CSSProperties, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import type { ProviderUsage } from "../../../shared/types/usage"
import { formatClock } from "../../../shared/utils/time"
import { useEdgeDockStore } from "../../edge-dock/store/edgeDockStore"
import type { DockSide, EdgeDockState } from "../../edge-dock/types/edgeDock"
import { notifyThresholds } from "../../notifications/services/notifications"
import { SettingsPanel } from "../../settings/components/SettingsPanel"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { applyWidgetPreset, hideToTray, setAlwaysOnTop, setSkipTaskbar } from "../../window-manager/services/windowManager"
import { useContainerSize } from "../hooks/useContainerSize"
import { useUsageStore } from "../store/usageStore"
import { inferWidgetMode } from "../utils/presets"
import { ProviderCard } from "./ProviderCard"

const providerOrder = ["claude", "codex", "chatgpt"] as const

export function Widget() {
  const { ref, size } = useContainerSize<HTMLElement>()
  const layoutMode = inferWidgetMode(size)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const { settings, updateSettings } = useSettingsStore()
  const { usage, isRefreshing, refreshFailed, refreshUsage } = useUsageStore()
  const isCollapsed = useEdgeDockStore((state) => state.isCollapsed)
  const dockSide = useEdgeDockStore((state) => state.dockSide)
  const isDockAnimating = useEdgeDockStore((state) => state.isAnimating)
  const hydrateEdgeDock = useEdgeDockStore((state) => state.hydrate)
  const collapseEdgeDock = useEdgeDockStore((state) => state.collapse)
  const expandEdgeDock = useEdgeDockStore((state) => state.expand)
  const applyEdgeDockState = useEdgeDockStore((state) => state.applyNativeState)

  const usages = useMemo(
    () => providerOrder.map((id) => usage[id]).filter((item): item is ProviderUsage => item !== undefined),
    [usage]
  )
  const latestUpdatedAt = usages
    .map((item) => item.lastSuccessfulAt ?? item.updatedAt)
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
    setSkipTaskbar(settings.hideFromTaskbar)
  }, [settings.hideFromTaskbar])

  useEffect(() => {
    const unlisteners = [
      listen("tray-refresh", () => refreshUsage(settings.demoMode)),
      listen("tray-settings", () => setSettingsOpen(true)),
      listen<EdgeDockState>("edge-dock-state", (event) => {
        applyEdgeDockState(event.payload)
      }),
      listen<"small" | "medium" | "large">("tray-size", (event) => {
        updateSettings({ sizeMode: event.payload })
      }),
      listen<boolean>("tray-always-on-top", (event) => {
        updateSettings({ alwaysOnTop: event.payload })
      })
    ]

    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten.then((dispose) => dispose()).catch(() => undefined)
      })
    }
  }, [applyEdgeDockState, refreshUsage, settings.demoMode, updateSettings])

  useEffect(() => {
    hydrateEdgeDock().catch(() => undefined)
  }, [hydrateEdgeDock])

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

  if (isCollapsed) {
    const side = dockSide ?? "right"
    const Icon = side === "left" ? ChevronRight : ChevronLeft
    return (
      <main
        ref={ref}
        className={`grid h-full w-full place-items-center border border-[hsl(var(--color-border)/0.62)] bg-[hsl(var(--color-panel)/var(--panel-opacity))] text-[hsl(var(--color-text))] shadow-[0_8px_22px_rgb(0_0_0/0.28)] ${
          side === "left" ? "rounded-r-[10px] border-l-0" : "rounded-l-[10px] border-r-0"
        }`}
        style={{ "--panel-opacity": settings.opacity } as CSSProperties}
      >
        <button
          type="button"
          className="grid size-full place-items-center outline-none transition hover:bg-white/10 active:bg-white/14 focus-visible:ring-2 focus-visible:ring-sky-300"
          aria-label="Expand AI Usage Widget"
          title="Expand"
          disabled={isDockAnimating}
          onClick={() => expandEdgeDock()}
        >
          <Icon className="size-4" />
        </button>
      </main>
    )
  }

  return (
    <main
      ref={ref}
      className="group relative h-full w-full overflow-hidden rounded-[11px] border border-[hsl(var(--color-border)/0.58)] bg-[hsl(var(--color-panel)/var(--panel-opacity))] text-[hsl(var(--color-text))] shadow-[0_10px_30px_rgb(0_0_0/0.28)]"
      style={
        {
          "--panel-opacity": settings.opacity,
          backdropFilter: settings.backgroundBlur ? "blur(8px)" : undefined
        } as CSSProperties
      }
    >
      <div className="flex h-full flex-col px-2.5 py-2">
        <header className="drag-region flex h-[28px] shrink-0 items-center justify-between gap-2 border-b border-white/10 pb-1.5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-tight text-white">AI Usage</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton label="Collapse" onClick={() => collapseEdgeDock()}>
              {collapseIcon(dockSide)}
            </IconButton>
            <IconButton label="Refresh" onClick={() => refreshUsage(settings.demoMode)}>
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </IconButton>
            <IconButton subtle label="Settings" onClick={() => setSettingsOpen((open) => !open)}>
              <Settings className="size-3.5" />
            </IconButton>
            <IconButton subtle label="Hide to tray" onClick={hideToTray}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <div className="no-scrollbar h-full overflow-y-auto">
            <UsageList mode={layoutMode} />
          </div>
        </div>

        <footer className="shrink-0 border-t border-white/10 pt-1.5 text-[9px] leading-tight text-[hsl(var(--color-muted))]">
          <span>{formatChecked(latestUpdatedAt, refreshFailed, layoutMode)}</span>
        </footer>
      </div>

      <div className={`absolute inset-x-2 bottom-2 top-9 z-10 ${settingsOpen ? "block" : "hidden"}`}>
        <SettingsPanel open={settingsOpen} />
      </div>
    </main>
  )
}

function UsageList({ mode }: { mode: ReturnType<typeof inferWidgetMode> }) {
  const usage = useUsageStore((state) => state.usage)
  return (
    <div>
      {providerOrder.map((id) => (usage[id] ? <ProviderCard key={id} usage={usage[id]!} mode={mode} /> : null))}
    </div>
  )
}

function IconButton({ label, children, onClick, subtle = false }: { label: string; children: ReactNode; onClick: () => void; subtle?: boolean }) {
  return (
    <button
      type="button"
      className={`grid size-6 place-items-center rounded-[6px] text-[hsl(var(--color-text))] outline-none transition hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-sky-300 ${
        subtle ? "opacity-0 group-hover:opacity-70 focus-visible:opacity-100" : "bg-transparent opacity-80"
      }`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function collapseIcon(side: DockSide) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return <Icon className="size-3.5" />
}

function formatChecked(iso: string | undefined, failed: boolean, mode: ReturnType<typeof inferWidgetMode>) {
  if (!iso) return failed ? "Checked -- \u00b7 Failed" : "Checked --"
  const ago = formatAgo(iso)
  if (failed) return `Checked ${ago} \u00b7 Failed`
  if (mode === "small") return `Checked ${ago}`
  return `Checked ${ago} \u00b7 ${formatClock(iso)}`
}

function formatAgo(iso: string, now = new Date()) {
  const diffMs = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(diffMs)) return "--"
  const minutes = Math.max(0, Math.floor(diffMs / 60000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
