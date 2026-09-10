import { invoke } from "@tauri-apps/api/core"
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeLimit } from "../../../shared/utils/usage"
import { useSettingsStore } from "../../settings/store/settingsStore"
import { useUsageStore } from "../../widget/store/usageStore"
import { CompanionPopup } from "./CompanionPopup"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(() => undefined) })
}))

const invoked = vi.mocked(invoke)

describe("CompanionPopup", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    invoked.mockClear()
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
          showFiveHour: true,
          showWeekly: true,
          showFable: true
        }
      }
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("lists every limit as remaining percent with its reset time", () => {
    act(() => root.render(<CompanionPopup />))

    expect(host.textContent).toContain("Claude")
    expect(host.textContent).not.toContain("[C]")
    expect(host.textContent).not.toContain("[G]")
    // Window names are spelled out, not abbreviated to "5h" / "wly".
    expect(host.textContent).toContain("5-hour")
    expect(host.textContent).toContain("45%")
    expect(host.textContent).toContain("weekly")
    expect(host.textContent).toContain("60%")
    expect(host.textContent).toContain("fable")
    expect(host.textContent).toContain("72%")
    expect(host.textContent).not.toContain("5h ")
    expect(host.textContent).not.toContain("wly")
  })

  it("names what each column holds so a bare number is never ambiguous", () => {
    act(() => root.render(<CompanionPopup />))

    expect(host.textContent).toContain("Window")
    expect(host.textContent).toContain("Remaining")
    expect(host.textContent).toContain("Resets")
  })

  it("heads each provider section with its image icon next to the name", () => {
    useUsageStore.setState((state) => ({
      usage: {
        ...state.usage,
        chatgpt: {
          provider: "chatgpt",
          status: "connected",
          updatedAt: "2026-09-10T04:00:00.000Z",
          lastSuccessfulAt: "2026-09-10T03:58:00.000Z",
          limits: [
            normalizeLimit({ id: "gpt-pro", label: "GPT Pro", period: "weekly", used: 31, total: 50, unit: "messages" })
          ]
        }
      }
    }))
    act(() => root.render(<CompanionPopup />))

    const icons = Array.from(host.querySelectorAll("img[data-provider-icon]"))
    expect(icons.map((icon) => icon.getAttribute("data-provider-icon"))).toEqual(["claude", "chatgpt"])
    icons.forEach((icon) => expect(icon.getAttribute("src")).toBeTruthy())

    // Names are spelled out here (unlike the strip), but never as the badge.
    expect(host.textContent).toContain("Claude")
    expect(host.textContent).toContain("ChatGPT")
    expect(host.textContent).not.toContain("[C]")
    expect(host.textContent).not.toContain("[G]")
    // 31 of 50 messages used leaves 19, and the popup says what 19 counts.
    expect(host.textContent).toContain("19")
    expect(host.textContent).toContain("msgs")
  })

  it("asks the companion to dismiss on Escape", () => {
    act(() => root.render(<CompanionPopup />))

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(invoked.mock.calls.map(([command]) => command)).toContain("dismiss_companion_popup")
  })
})
