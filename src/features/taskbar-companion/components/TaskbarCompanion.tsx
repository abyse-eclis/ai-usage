import { listen } from "@tauri-apps/api/event"
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
import { positionTaskbarCompanion } from "../services/taskbarCompanionWindow"
import { useCompanionData } from "../hooks/useCompanionData"
import { companionLog } from "../utils/log"
import { formatRemaining } from "../utils/taskbarCompanion"

const closeDelayMs = 300

/**
 * The strip that sits inside the Windows taskbar. It shows one line -- provider,
 * remaining percent for the 5-hour window, and when that window resets -- and
 * owns the hover state for the separate detail popup window.
 */
export function TaskbarCompanion() {
  const { data, companion } = useCompanionData()
  const [overCompanion, setOverCompanion] = useState(false)
  const [overPopup, setOverPopup] = useState(false)
  const [pinned, setPinned] = useState(false)
  const dismissedAt = useRef(0)
  /** Size the popup window is currently showing at, or undefined while hidden. */
  const shownAs = useRef<string | undefined>(undefined)

  const rowCount = data.rows.length
  const open = pinned || (companion.hoverPopupEnabled && (overCompanion || overPopup))

  useEffect(() => {
    companionLog("[Companion] mounted")
    positionTaskbarCompanion().catch(() => undefined)
    const onResize = () => positionTaskbarCompanion().catch(() => undefined)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
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
    const size = companionPopupSize(rowCount)
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
  }, [open, rowCount])

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

  const primary = data.primary
  const percentColor = remainingColor(primary?.remainingPercent)

  return (
    <main data-taskbar-companion-root className="h-full w-full">
      <button
        type="button"
        className="flex h-full w-full items-center gap-[9px] rounded-[6px] border border-white/[0.06] bg-[#1c1c1c]/[0.94] px-[11px] text-[13.5px] leading-none text-[#e8e8e8] outline-none transition-colors duration-150 hover:bg-[#2f2f2f]/[0.96] focus-visible:outline-none"
        aria-label="Claude usage"
        aria-expanded={open}
        onMouseEnter={() => {
          // Fast path so the popup appears without waiting for the next poll;
          // the watcher stays authoritative for when it closes again.
          companionLog("[Companion] enter")
          setOverCompanion(true)
        }}
        onClick={onClick}
      >
        <span className="font-medium">Claude</span>
        <span className={`text-[14.5px] font-semibold tabular-nums ${percentColor}`}>
          {formatRemaining(primary?.remainingPercent)}
        </span>
        <span className="tabular-nums text-[#a9a9a9]">{primary?.resetText ?? "--"}</span>
      </button>
    </main>
  )
}

export function remainingColor(remainingPercent?: number) {
  if (remainingPercent === undefined) return "text-[#a9a9a9]"
  if (remainingPercent <= 10) return "text-[hsl(var(--state-critical))]"
  if (remainingPercent <= 20) return "text-[hsl(var(--state-warning))]"
  return "text-white"
}
