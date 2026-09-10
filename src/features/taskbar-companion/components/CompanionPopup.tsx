import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useRef } from "react"
import { popupPinnedEvent, requestPopupDismiss } from "../services/companionPopup"
import { useCompanionData } from "../hooks/useCompanionData"
import { companionLog } from "../utils/log"
import { formatRemaining } from "../utils/taskbarCompanion"
import { remainingColor } from "./TaskbarCompanion"

/**
 * Contents of the hover detail window. It renders the same usage store the
 * companion reads. Hover state is decided by the cursor watcher in Rust; this
 * window only reports Escape and focus loss, which dismiss a pinned popup.
 */
export function CompanionPopup() {
  const { data } = useCompanionData()
  const pinned = useRef(false)

  useEffect(() => {
    companionLog("[Popup] mounted")
    const unlisten = listen<boolean>(popupPinnedEvent, (event) => {
      pinned.current = event.payload
    })
    return () => {
      unlisten.then((dispose) => dispose()).catch(() => undefined)
    }
  }, [])

  // Only a pinned popup ever holds focus, so losing it means the user clicked
  // somewhere else -- that is the reliable "click outside" signal.
  useEffect(() => {
    let dispose: (() => void) | undefined
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && pinned.current) requestPopupDismiss().catch(() => undefined)
      })
      .then((unlisten) => {
        dispose = unlisten
      })
      .catch(() => undefined)
    return () => dispose?.()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestPopupDismiss().catch(() => undefined)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <main
      data-companion-popup-root
      className="flex h-full w-full flex-col rounded-[8px] border border-white/[0.07] bg-[#1c1c1c]/[0.97] px-3 py-3 text-[#e8e8e8] shadow-[0_12px_28px_rgb(0_0_0/0.38)]"
    >
      <h1 className="mb-2 text-[14px] font-semibold leading-none text-white">Claude</h1>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-[5px] text-[13px] leading-none tabular-nums">
        {data.rows.map((row) => (
          <div key={row.kind} className="contents">
            <span className="text-[#a9a9a9]">{row.label}</span>
            <span className={`justify-self-end font-semibold ${remainingColor(row.remainingPercent)}`}>
              {formatRemaining(row.remainingPercent)}
            </span>
            <span className="justify-self-end text-[#a9a9a9]">{row.resetText ?? "--"}</span>
          </div>
        ))}
        {data.rows.length === 0 ? <span className="col-span-3 text-[#a9a9a9]">unavailable</span> : null}
      </div>
      <div className="mt-auto truncate pt-2 text-[10.5px] leading-none text-[#8a8a8a]">{data.checkedText}</div>
    </main>
  )
}
