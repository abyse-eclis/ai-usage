import { invoke } from "@tauri-apps/api/core"
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

// A tiny event bus stand-in so tests can play the part of Rust's cursor
// watcher, which is what tells the companion where the pointer is.
const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>()
  return {
    handlers,
    deliver(name: string, payload?: unknown) {
      handlers.get(name)?.forEach((handler) => handler({ payload }))
    }
  }
})

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    const set = bus.handlers.get(name) ?? new Set()
    set.add(handler)
    bus.handlers.set(name, set)
    return Promise.resolve(() => set.delete(handler))
  }),
  emit: vi.fn().mockResolvedValue(undefined)
}))

const invoked = vi.mocked(invoke)

function commandsCalled() {
  return invoked.mock.calls.map(([command]) => command)
}

describe("TaskbarCompanion", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    invoked.mockClear()
    bus.handlers.clear()
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
          hoverPopupEnabled: true,
          clickToPinEnabled: true
        },
        presentation: {
          ...state.settings.presentation,
          taskbarCompanionEnabled: true
        }
      }
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it("shows only the provider, remaining percent, and reset time", () => {
    act(() => root.render(<TaskbarCompanion />))

    expect(host.textContent).toContain("Claude")
    // The source reports 55% used, so the companion must read 45% remaining.
    expect(host.textContent).toContain("45%")
    expect(host.textContent).not.toContain("used")
    expect(host.textContent).not.toContain("left")
    expect(host.textContent).not.toContain("AI Usage")
  })

  it("opens the native popup on hover and closes it after the delay", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!
    invoked.mockClear()

    act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
    expect(commandsCalled()).toContain("show_companion_popup")

    invoked.mockClear()
    act(() => bus.deliver("companion-pointer", { overCompanion: false, overPopup: false }))
    expect(commandsCalled()).not.toContain("hide_companion_popup")

    act(() => vi.advanceTimersByTime(300))
    expect(commandsCalled()).toContain("hide_companion_popup")
  })

  it("stays open when the pointer moves from the companion into the popup", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!

    act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
    invoked.mockClear()

    act(() => bus.deliver("companion-pointer", { overCompanion: false, overPopup: true }))
    act(() => vi.advanceTimersByTime(1000))
    expect(commandsCalled()).not.toContain("hide_companion_popup")

    act(() => bus.deliver("companion-pointer", { overCompanion: false, overPopup: false }))
    act(() => vi.advanceTimersByTime(300))
    expect(commandsCalled()).toContain("hide_companion_popup")
  })

  it("pins on click and only closes on Escape", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!
    invoked.mockClear()

    act(() => button.click())
    expect(invoked.mock.calls).toContainEqual(["set_companion_popup_pinned", { pinned: true }])

    invoked.mockClear()
    act(() => bus.deliver("companion-pointer", { overCompanion: false, overPopup: false }))
    act(() => vi.advanceTimersByTime(600))
    expect(commandsCalled()).not.toContain("hide_companion_popup")

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(invoked.mock.calls).toContainEqual(["set_companion_popup_pinned", { pinned: false }])
    act(() => vi.advanceTimersByTime(300))
    expect(commandsCalled()).toContain("hide_companion_popup")
  })

  it("closes when the popup reports it was dismissed by a click outside", () => {
    act(() => root.render(<TaskbarCompanion />))
    const button = host.querySelector("button")!
    act(() => button.click())
    invoked.mockClear()

    act(() => bus.deliver("companion-popup-dismiss"))
    act(() => vi.advanceTimersByTime(300))
    expect(commandsCalled()).toContain("hide_companion_popup")
  })
})
