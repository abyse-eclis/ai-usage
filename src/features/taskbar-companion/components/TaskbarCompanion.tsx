import { listen } from "@tauri-apps/api/event"
import type { CSSProperties } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ProviderUsage, UsageCacheRecord } from "../../../shared/types/usage"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { useUsageStore, type UsageStateSnapshot } from "../../widget/store/usageStore"
import { hideTaskbarCompanion, positionTaskbarCompanion } from "../services/taskbarCompanionWindow"
import {
  buildClaudeCompanionData,
  formatRemaining
} from "../utils/taskbarCompanion"

const closeDelayMs = 320

export function TaskbarCompanion() {
  const { settings } = useSettingsStore()
  const usage = useUsageStore((state) => state.usage.claude)
  const cached = useUsageStore((state) => state.cache.claude?.usage)
  const refreshFailed = useUsageStore((state) => state.refreshFailed)
  const applySnapshot = useUsageStore((state) => state.applySnapshot)
  const [hovered, setHovered] = useState(false)
  const [popupHovered, setPopupHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const companion = settings.taskbarCompanion

  const data = useMemo(
    () =>
      buildClaudeCompanionData({
        usage,
        cached,
        refreshFailed,
        timeFormat: companion.timeFormat,
        show: {
          showFiveHour: companion.showFiveHour,
          showWeekly: companion.showWeekly,
          showFable: companion.showFable
        }
      }),
    [cached, companion.showFable, companion.showFiveHour, companion.showWeekly, companion.timeFormat, refreshFailed, usage]
  )

  const open = pinned || (companion.hoverPopupEnabled && (hovered || popupHovered))

  useEffect(() => {
    positionTaskbarCompanion().catch(() => undefined)
    const onResize = () => positionTaskbarCompanion().catch(() => undefined)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    const unlisten = listen<UsageStateSnapshot>("usage-state-updated", (event) => applySnapshot(event.payload))
    return () => {
      unlisten.then((dispose) => dispose()).catch(() => undefined)
    }
  }, [applySnapshot])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPinned(false)
      setHovered(false)
      setPopupHovered(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-taskbar-companion-root]")) return
      setPinned(false)
      setHovered(false)
      setPopupHovered(false)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("pointerdown", onPointerDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("pointerdown", onPointerDown)
    }
  }, [])

  useEffect(() => {
    if (settings.taskbarCompanion.enabled) return
    setPinned(false)
    hideTaskbarCompanion().catch(() => undefined)
  }, [settings.taskbarCompanion.enabled])

  function clearCloseTimer() {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
  }

  function scheduleClose() {
    clearCloseTimer()
    closeTimer.current = window.setTimeout(() => {
      setHovered(false)
      setPopupHovered(false)
    }, closeDelayMs)
  }

  const primary = data.primary
  const percentClass =
    primary?.remainingPercent !== undefined && primary.remainingPercent <= 10
      ? "text-[hsl(var(--state-critical))]"
      : primary?.remainingPercent !== undefined && primary.remainingPercent <= 20
        ? "text-[hsl(var(--state-warning))]"
        : "text-white"

  return (
    <main
      data-taskbar-companion-root
      className="relative h-full w-full overflow-visible text-[hsl(var(--color-text))]"
      style={{ "--panel-opacity": settings.opacity } as CSSProperties}
    >
      <button
        type="button"
        className="flex h-full w-full items-center justify-center gap-2 rounded-[9px] border border-[hsl(var(--color-border)/0.62)] bg-[hsl(var(--color-panel)/var(--panel-opacity))] px-3 text-[13.5px] leading-none shadow-[0_8px_22px_rgb(0_0_0/0.24)] outline-none transition hover:bg-[hsl(var(--color-card)/0.96)] focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label="Claude usage"
        aria-expanded={open}
        onMouseEnter={() => {
          clearCloseTimer()
          setHovered(true)
        }}
        onMouseLeave={scheduleClose}
        onClick={() => {
          if (!companion.clickToPinEnabled) return
          clearCloseTimer()
          setPinned((value) => {
            const next = !value
            setHovered(next)
            if (!next) setPopupHovered(false)
            return next
          })
        }}
      >
        <span className="font-medium">Claude</span>
        <span className={`text-[14.5px] font-semibold tabular-nums ${percentClass}`}>{formatRemaining(primary?.remainingPercent)}</span>
        <span className="font-normal tabular-nums text-[hsl(var(--color-muted))]">{primary?.resetText ?? "--"}</span>
      </button>

      {open ? (
        <section
          className="absolute bottom-[calc(100%+8px)] right-0 w-[226px] rounded-[9px] border border-[hsl(var(--color-border)/0.64)] bg-[hsl(var(--color-panel-strong)/0.98)] px-3 py-2.5 shadow-[0_12px_28px_rgb(0_0_0/0.32)]"
          onMouseEnter={() => {
            clearCloseTimer()
            setPopupHovered(true)
          }}
          onMouseLeave={scheduleClose}
        >
          <h1 className="mb-2 text-[14.5px] font-semibold leading-none text-white">Claude</h1>
          <div className="grid grid-cols-[auto_auto_1fr] gap-x-5 gap-y-1.5 text-[13.5px] leading-tight tabular-nums">
            {data.rows.map((row) => (
              <CompanionRow key={row.kind} row={row} />
            ))}
          </div>
          <div className="mt-2.5 truncate text-[10.5px] leading-none text-[hsl(var(--color-muted-weak))]">{data.checkedText}</div>
        </section>
      ) : null}
    </main>
  )
}

function CompanionRow({ row }: { row: { label: string; remainingPercent?: number; resetText?: string } }) {
  const percentClass =
    row.remainingPercent !== undefined && row.remainingPercent <= 10
      ? "text-[hsl(var(--state-critical))]"
      : row.remainingPercent !== undefined && row.remainingPercent <= 20
        ? "text-[hsl(var(--state-warning))]"
        : "text-white"
  return (
    <>
      <span className="text-[hsl(var(--color-muted))]">{row.label}</span>
      <span className={`justify-self-end font-semibold ${percentClass}`}>{formatRemaining(row.remainingPercent)}</span>
      <span className="justify-self-end text-[hsl(var(--color-muted))]">{row.resetText ?? "--"}</span>
    </>
  )
}

export function snapshotFromUsageStore({
  usage,
  cache,
  refreshFailed,
  lastRefreshError
}: {
  usage: Partial<Record<"claude" | "codex" | "chatgpt", ProviderUsage>>
  cache: Partial<Record<"claude" | "codex" | "chatgpt", UsageCacheRecord>>
  refreshFailed: boolean
  lastRefreshError?: string
}): UsageStateSnapshot {
  return { usage, cache, refreshFailed, lastRefreshError }
}
