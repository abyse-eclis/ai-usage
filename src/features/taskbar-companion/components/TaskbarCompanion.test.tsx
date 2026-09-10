import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeLimit } from "../../../shared/utils/usage"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { useUsageStore } from "../../widget/store/usageStore"
import { TaskbarCompanion } from "./TaskbarCompanion"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn().mockResolvedValue(undefined)
}))

describe("TaskbarCompanion", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    useUsageStore.setState({
      usage: {
        claude: {
          provider: "claude",
          status: "connected",
          updatedAt: "2026-09-10T04:00:00.000Z",
          lastSuccessfulAt: "2026-09-10T03:58:00.000Z",
          limits: [
            normalizeLimit({ id: "five-hour", label: "Session", period: "session", usedPercent: 55 }),
            normalizeLimit({ id: "seven-day", label: "Weekly", period: "weekly", usedPercent: 40 }),
            normalizeLimit({ id: "seven-day-fable", label: "Fable", period: "weekly", usedPercent: 28 })
          ]
        }
      },
      cache: {},
      refreshFailed: false
    })
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        taskbarCompanion: {
          ...state.settings.taskbarCompanion,
          enabled: true,
          hoverPopupEnabled: true,
          clickToPinEnabled: true
        }
      }
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it("opens on hover and waits before closing", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!

    act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
    expect(host.textContent).toContain("5h")
    expect(host.textContent).toContain("45%")

    act(() => button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })))
    expect(host.textContent).toContain("5h")

    act(() => vi.advanceTimersByTime(320))
    expect(host.textContent).not.toContain("5h")
  })

  it("keeps the popup open while pinned until Escape", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!

    act(() => button.click())
    expect(host.textContent).toContain("fable")

    act(() => button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })))
    act(() => vi.advanceTimersByTime(500))
    expect(host.textContent).toContain("fable")

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(host.textContent).not.toContain("fable")
  })
})
