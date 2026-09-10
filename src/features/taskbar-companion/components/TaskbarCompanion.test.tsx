import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
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

const emitted = vi.mocked(emit)

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
        },
        chatgpt: {
          provider: "chatgpt",
          status: "connected",
          updatedAt: "2026-09-10T04:00:00.000Z",
          lastSuccessfulAt: "2026-09-10T03:58:00.000Z",
          limits: [
            normalizeLimit({
              id: "gpt-pro",
              label: "GPT Pro",
              period: "weekly",
              used: 31,
              total: 50,
              unit: "messages"
            })
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

  it("marks each provider with an image icon, not a text badge", () => {
    act(() => root.render(<TaskbarCompanion />))

    const icons = Array.from(host.querySelectorAll("img[data-provider-icon]"))
    expect(icons.map((icon) => icon.getAttribute("data-provider-icon"))).toEqual(["claude", "chatgpt"])
    // Real image assets, not inline text or a CSS-only mark.
    icons.forEach((icon) => expect(icon.getAttribute("src")).toBeTruthy())

    // The provider name lives in the accessible label only -- the strip itself
    // shows the icon, never a letter or a spelled-out name.
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Claude, ChatGPT usage")
    expect(host.textContent).not.toContain("Claude")
    expect(host.textContent).not.toContain("ChatGPT")
    expect(host.textContent).not.toContain("[C]")
    expect(host.textContent).not.toContain("[G]")
    expect(host.textContent).not.toContain("GPT")
  })

  it("keeps the icons at taskbar size and centred with the values", () => {
    act(() => root.render(<TaskbarCompanion />))

    host.querySelectorAll("img[data-provider-icon]").forEach((icon) => {
      // 14-16px keeps the icon crisp inside the taskbar strip.
      expect(Number(icon.getAttribute("width"))).toBeGreaterThanOrEqual(14)
      expect(Number(icon.getAttribute("width"))).toBeLessThanOrEqual(16)
      expect(icon.getAttribute("width")).toBe(icon.getAttribute("height"))
      expect(icon.className).toContain("align-middle")
      expect(icon.className).toContain("object-contain")
    })
  })

  it("shows how much each provider has used and when it resets", () => {
    act(() => root.render(<TaskbarCompanion />))

    // Claude reports 55% used, and that is what the strip shows.
    expect(host.textContent).toContain("55%")
    // ChatGPT is counted in messages: 31 of 50 used.
    expect(host.textContent).toContain("31")
    expect(host.textContent).not.toContain("left")
    expect(host.textContent).not.toContain("remaining")
    expect(host.textContent).not.toContain("AI Usage")
  })

  it("keeps the strip visible with a dash when no provider has data", () => {
    useUsageStore.setState({ usage: {}, cache: {}, refreshFailed: false })
    act(() => root.render(<TaskbarCompanion />))

    expect(host.querySelector("button")).not.toBeNull()
    expect(host.querySelectorAll("img[data-provider-icon]").length).toBe(1)
    expect(host.textContent).toContain("--")
    expect(host.textContent).not.toContain("[C]")
  })

  it("asks the widget to fetch fresh usage when refresh is clicked", () => {
    act(() => root.render(<TaskbarCompanion />))
    const refresh = host.querySelector<HTMLButtonElement>("[data-companion-refresh]")!
    expect(refresh).not.toBeNull()
    emitted.mockClear()

    act(() => refresh.click())

    // The fetch loop lives in the Main Widget window, so the companion asks
    // for a refresh rather than calling providers itself. It asks for the kind
    // that runs the configured CLI commands first, which is what makes the
    // providers write a new reading; the plain "tray-refresh" only re-reads.
    const names = emitted.mock.calls.map(([name]) => name)
    expect(names).toContain("usage-refresh-with-cli")
    expect(names).not.toContain("tray-refresh")
  })

  it("does not pin the popup when refresh is clicked", () => {
    act(() => root.render(<TaskbarCompanion />))
    const refresh = host.querySelector<HTMLButtonElement>("[data-companion-refresh]")!
    invoked.mockClear()

    act(() => refresh.click())

    expect(invoked.mock.calls).not.toContainEqual(["set_companion_popup_pinned", { pinned: true }])
  })

  it("resizes the native strip to the width its segments measure", () => {
    act(() => root.render(<TaskbarCompanion />))

    expect(commandsCalled()).toContain("set_companion_content_width")
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
