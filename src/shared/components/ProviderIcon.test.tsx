import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ProviderId } from "../types/usage"
import { ProviderIcon, resolveProviderIconSources } from "./ProviderIcon"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const providers: ProviderId[] = ["claude", "chatgpt", "codex"]

describe("ProviderIcon", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it.each(providers)("renders %s as an image asset, never a letter", (provider) => {
    act(() => root.render(<ProviderIcon provider={provider} />))

    const icon = host.querySelector("img")
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute("src")).toBeTruthy()
    // The identity is carried by the image; no character ends up in the DOM.
    expect(host.textContent).toBe("")
  })

  it.each(providers)("ships an SVG as the first choice for %s", (provider) => {
    // Small SVGs are inlined as data URIs by the bundler, so the format shows
    // up in the mime type rather than in a filename.
    expect(resolveProviderIconSources(provider)[0]).toMatch(/svg/)
  })

  it("keeps a generic image as the last candidate, not a text badge", () => {
    const sources = resolveProviderIconSources("claude")
    expect(sources.length).toBeGreaterThan(1)
    // Every provider ends on the same shared placeholder image.
    const last = (provider: ProviderId) => {
      const list = resolveProviderIconSources(provider)
      return list[list.length - 1]
    }
    expect(last("claude")).toBe(last("chatgpt"))
    expect(last("claude")).toBe(last("codex"))
    expect(last("claude")).toMatch(/svg|png/)
    // The placeholder is a different asset from the provider's own artwork.
    expect(last("claude")).not.toBe(sources[0])
  })

  it("falls through the candidate list when an asset fails to load", () => {
    act(() => root.render(<ProviderIcon provider="claude" />))
    const sources = resolveProviderIconSources("claude")
    const icon = () => host.querySelector("img")

    expect(icon()?.getAttribute("src")).toBe(sources[0])

    act(() => icon()?.dispatchEvent(new Event("error")))
    expect(icon()?.getAttribute("src")).toBe(sources[1])
  })

  it("drops the icon rather than showing a letter when every asset fails", () => {
    const sources = resolveProviderIconSources("claude")
    act(() => root.render(<ProviderIcon provider="claude" />))

    for (let attempt = 0; attempt < sources.length; attempt += 1) {
      const icon = host.querySelector("img")
      if (!icon) break
      act(() => icon.dispatchEvent(new Event("error")))
    }

    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toBe("")
  })

  it("renders at the requested size, square, for the taskbar strip", () => {
    act(() => root.render(<ProviderIcon provider="claude" size={14} />))

    const icon = host.querySelector("img")!
    expect(icon.getAttribute("width")).toBe("14")
    expect(icon.getAttribute("height")).toBe("14")
    expect(icon.style.width).toBe("14px")
  })

  it.each(["chatgpt", "codex"] as ProviderId[])(
    "uses the dark-surface variant of the monochrome %s mark",
    (provider) => {
      // These marks are near-black by default and would vanish on the taskbar,
      // so a light variant ships alongside and must win on a dark surface.
      const dark = resolveProviderIconSources(provider, "dark")
      const light = resolveProviderIconSources(provider, "light")
      expect(dark[0]).not.toBe(light[0])
      // The base artwork stays available as the next candidate.
      expect(dark).toContain(light[0])
    }
  )

  it("uses one asset for both surfaces when the mark is colour-safe", () => {
    // Claude's orange reads on light and dark alike, so it ships no variant.
    expect(resolveProviderIconSources("claude", "dark")[0]).toBe(
      resolveProviderIconSources("claude", "light")[0]
    )
  })
})
