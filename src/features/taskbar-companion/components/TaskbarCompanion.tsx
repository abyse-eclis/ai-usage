import { listen } from "@tauri-apps/api/event"
import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  companionPopupSize,
  hideCompanionPopup,
  pointerEvent,
  popupDismissEvent,
  type PointerState,
  setCompanionPopupPinned,
  showCompanionPopup
} from "../services/companionPopup"
import { refreshFinishedEvent, requestUsageRefresh } from "../services/companionRefresh"
import { positionTaskbarCompanion, setCompanionContentWidth } from "../services/taskbarCompanionWindow"
import { useCompanionData } from "../hooks/useCompanionData"
import { companionLog } from "../utils/log"
import { usageColor } from "../utils/usageColor"
import type { UsageThresholds } from "../../../shared/utils/thresholds"
import type { CompanionProviderData } from "../utils/taskbarCompanion"
import { ProviderIcon } from "../../../shared/components/ProviderIcon"

const closeDelayMs = 300
/**
 * Backstop for the spinner. It has to outlast a CLI command (which Rust caps
 * at 90 seconds) so a slow-but-working refresh is not reported as finished
 * while it is still going.
 */
const refreshSpinCapMs = 95000

/**
 * The strip that sits inside the Windows taskbar. It shows one segment per
 * provider -- the provider's icon, its headline remaining value, and when that
 * window resets -- and owns the hover state for the separate detail popup.
 *
 * Providers are identified by their image icon only. No letter badges.
 */
export function TaskbarCompanion() {
  const { data, companion, settings } = useCompanionData()
  const thresholds = settings.thresholds
  const [overCompanion, setOverCompanion] = useState(false)
  const [overPopup, setOverPopup] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const dismissedAt = useRef(0)
  const content = useRef<HTMLSpanElement | null>(null)
  /** Size the popup window is currently showing at, or undefined while hidden. */
  const shownAs = useRef<string | undefined>(undefined)

  const providers = data.providers
  const rowCount = providers.reduce((total, entry) => total + entry.rows.length, 0)
  const open = pinned || (companion.hoverPopupEnabled && (overCompanion || overPopup))

  useEffect(() => {
    companionLog("[Companion] mounted")
    positionTaskbarCompanion().catch(() => undefined)
    const onResize = () => positionTaskbarCompanion().catch(() => undefined)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // The strip grows with the number of provider segments, so the native window
  // is resized to fit them. The rendered content is measured where the layout
  // engine can report it, and estimated from the segments where it cannot.
  useEffect(() => {
    const measured = content.current?.scrollWidth ?? 0
    const width = (measured > 0 ? measured : estimateContentWidth(providers)) + stripPaddingPx
    setCompanionContentWidth(width).catch(() => undefined)
  }, [providers])

  useEffect(() => {
    if (!refreshing) return
    // The fetch runs in the Main Widget window, so "done" arrives as a new
    // snapshot rather than a resolved promise. The timeout is the backstop for
    // a refresh that fails or returns nothing new.
    const timer = window.setTimeout(() => setRefreshing(false), refreshSpinCapMs)
    return () => window.clearTimeout(timer)
  }, [refreshing])

  useEffect(() => {
    setRefreshing(false)
  }, [data.checkedText, providers])

  // The widget says when a refresh has settled, which is the only reliable
  // signal when a CLI command is part of it and takes tens of seconds.
  useEffect(() => {
    const unlisten = listen(refreshFinishedEvent, () => setRefreshing(false))
    return () => {
      unlisten.then((dispose) => dispose()).catch(() => undefined)
    }
  }, [])

  // One hover state for both windows, fed by the cursor watcher in Rust. That
  // is what lets the pointer travel from the companion into the popup (and
  // across the gap between them) without the popup closing underneath it.
  useEffect(() => {
    const unlisteners = [
      listen<PointerState>(pointerEvent, (event) => {
        companionLog("[Companion] pointer", event.payload)
        setOverCompanion(event.payload.overCompanion)
        setOverPopup(event.payload.overPopup)
      }),
      listen(popupDismissEvent, () => {
        companionLog("[Companion] popup dismissed")
        dismissedAt.current = Date.now()
        setPinned(false)
        setOverCompanion(false)
        setOverPopup(false)
      })
    ]
    return () => {
      unlisteners.forEach((unlisten) => unlisten.then((dispose) => dispose()).catch(() => undefined))
    }
  }, [])

  // Re-showing a popup that is already up moves the native window under the
  // pointer, which makes the webview report a bogus mouse leave and closes it
  // again. So only ever show it when it is actually closed or has resized.
  useEffect(() => {
    const size = companionPopupSize(rowCount, providers.length)
    const key = `${size.width}x${size.height}`
    if (open) {
      if (shownAs.current === key) return
      companionLog("[Companion] scheduling popup")
      shownAs.current = key
      showCompanionPopup(size).catch(() => undefined)
      return
    }
    const timer = window.setTimeout(() => {
      shownAs.current = undefined
      hideCompanionPopup().catch(() => undefined)
    }, closeDelayMs)
    return () => window.clearTimeout(timer)
  }, [open, providers.length, rowCount])

  useEffect(() => {
    setCompanionPopupPinned(pinned).catch(() => undefined)
  }, [pinned])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPinned(false)
      setOverCompanion(false)
      setOverPopup(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const onRefresh = useCallback(() => {
    companionLog("[Companion] refresh requested")
    setRefreshing(true)
    requestUsageRefresh().catch(() => undefined)
  }, [])

  const onClick = useCallback(() => {
    if (!companion.clickToPinEnabled) return
    // A click that lands right after the popup dismissed itself (focus loss)
    // is the "close it" half of the gesture, not a fresh pin.
    if (Date.now() - dismissedAt.current < 250) {
      setPinned(false)
      return
    }
    setPinned((value) => {
      const next = !value
      companionLog(next ? "[Companion] pinned" : "[Companion] unpinned")
      if (!next) {
        setOverCompanion(false)
        setOverPopup(false)
      }
      return next
    })
  }, [companion.clickToPinEnabled])

  return (
    <main
      data-taskbar-companion-root
      className="flex h-full w-full items-center gap-[8px] rounded-[6px] border border-white/[0.06] bg-[#1c1c1c]/[0.94] px-[10px] text-[13.5px] leading-none text-[#e8e8e8]"
      onMouseEnter={() => {
        // Fast path so the popup appears without waiting for the next poll;
        // the watcher stays authoritative for when it closes again.
        companionLog("[Companion] enter")
        setOverCompanion(true)
      }}
    >
      {/* `w-max` keeps this sized to its content even while the native window
          is still narrower, so the measurement below is the width the strip
          actually needs rather than the width it is being squeezed into. */}
      <span ref={content} className="flex w-max items-center gap-[8px]">
        <button
          type="button"
          className="flex items-center gap-[12px] rounded-[4px] outline-none focus-visible:outline-none"
          aria-label={summaryLabel(providers)}
          aria-expanded={open}
          onClick={onClick}
        >
          {providers.length > 0 ? (
            providers.map((entry) => (
              <CompanionSegment key={entry.provider} entry={entry} thresholds={thresholds} />
            ))
          ) : (
            // Nothing to report yet: the strip keeps its icon and shows a dash,
            // so the companion never blinks out of the taskbar.
            <span className="flex items-center gap-[6px]">
              <ProviderIcon provider="claude" size={16} surface="dark" />
              <span className="tabular-nums text-[#a9a9a9]">--</span>
            </span>
          )}
        </button>
        <button
          type="button"
          className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-[#a9a9a9] outline-none transition-colors duration-150 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none"
          aria-label="Refresh usage now"
          data-companion-refresh
          onClick={onRefresh}
        >
          <RefreshCw className={`size-[13px] ${refreshing ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </span>
    </main>
  )
}

function CompanionSegment({ entry, thresholds }: { entry: CompanionProviderData; thresholds: UsageThresholds }) {
  const primary = entry.primary

  return (
    <span
      className="flex shrink-0 items-center gap-[6px] whitespace-nowrap"
      data-companion-segment={entry.provider}
    >
      <ProviderIcon provider={entry.provider} size={16} surface="dark" />
      <span
        className={`shrink-0 whitespace-nowrap text-[14.5px] font-semibold tabular-nums ${usageColor(primary?.usedPercent, thresholds)}`}
      >
        {primary?.valueText ?? "--"}
      </span>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-[#a9a9a9]">
        {primary?.resetText ?? "--"}
      </span>
    </span>
  )
}

/** Horizontal padding plus borders of the strip button, in CSS pixels. */
const stripPaddingPx = 22
const iconWidthPx = 16
const segmentGapPx = 12
const innerGapPx = 6
/** The refresh button plus the gap before it. */
const refreshButtonPx = 28
/** Rough advance widths for the two type sizes the strip uses. */
const valueCharPx = 8.5
const resetCharPx = 7.5

/**
 * Width the segments need when the layout engine cannot be asked (the first
 * paint, and any headless render). Deliberately generous: an over-wide strip
 * just leaves a little slack, while a short one clips the reset time.
 */
function estimateContentWidth(providers: CompanionProviderData[]) {
  if (providers.length === 0) return iconWidthPx + innerGapPx + 2 * valueCharPx + refreshButtonPx
  const segments = providers.map((entry) => {
    const value = entry.primary?.valueText ?? "--"
    const reset = entry.primary?.resetText ?? "--"
    return iconWidthPx + innerGapPx + value.length * valueCharPx + innerGapPx + reset.length * resetCharPx
  })
  const total = segments.reduce((sum, width) => sum + width, 0)
  return Math.ceil(total + (providers.length - 1) * segmentGapPx + refreshButtonPx)
}

/** The icons carry the identity visually; screen readers get the names here. */
function summaryLabel(providers: CompanionProviderData[]) {
  if (providers.length === 0) return "AI usage"
  return `${providers.map((entry) => entry.providerLabel).join(", ")} usage`
}
