import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSettingsStore } from "../store/settingsStore"
import { useAutostartSync } from "./useAutostartSync"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Stand-in for the OS startup entry the autostart plugin owns.
const os = vi.hoisted(() => ({ enabled: false, refuse: false }))

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => os.enabled),
  enable: vi.fn(async () => {
    if (!os.refuse) os.enabled = true
  }),
  disable: vi.fn(async () => {
    if (!os.refuse) os.enabled = false
  })
}))

function Harness() {
  useAutostartSync(true)
  return null
}

/** The service only talks to the OS inside the desktop runtime. */
function pretendDesktopRuntime() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

describe("useAutostartSync", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    pretendDesktopRuntime()
    os.enabled = false
    os.refuse = false
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, launchAtStartup: false }
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  const flush = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it("registers the startup entry when the setting is turned on", async () => {
    await act(async () => root.render(<Harness />))
    await flush()

    act(() => {
      useSettingsStore.getState().updateSettings({ launchAtStartup: true })
    })
    await flush()

    expect(os.enabled).toBe(true)
  })

  it("removes the startup entry when the setting is turned off", async () => {
    os.enabled = true
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, launchAtStartup: true }
    }))
    await act(async () => root.render(<Harness />))
    await flush()

    act(() => {
      useSettingsStore.getState().updateSettings({ launchAtStartup: false })
    })
    await flush()

    expect(os.enabled).toBe(false)
  })

  it("adopts the OS state at launch when the two disagree", async () => {
    // The user removed the entry from Task Manager while the app was closed.
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, launchAtStartup: true }
    }))
    os.enabled = false

    await act(async () => root.render(<Harness />))
    await flush()

    expect(useSettingsStore.getState().settings.launchAtStartup).toBe(false)
    expect(os.enabled).toBe(false)
  })

  it("reports the real state when the OS refuses the change", async () => {
    await act(async () => root.render(<Harness />))
    await flush()
    os.refuse = true

    act(() => {
      useSettingsStore.getState().updateSettings({ launchAtStartup: true })
    })
    await flush()

    expect(os.enabled).toBe(false)
    expect(useSettingsStore.getState().settings.launchAtStartup).toBe(false)
  })
})
