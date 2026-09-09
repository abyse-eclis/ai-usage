import { describe, expect, it } from "vitest"
import { inferWidgetMode, presetFromSize } from "./presets"

describe("widget presets", () => {
  it("infers layout from available size", () => {
    expect(inferWidgetMode({ width: 260, height: 180 })).toBe("small")
    expect(inferWidgetMode({ width: 320, height: 420 })).toBe("medium")
    expect(inferWidgetMode({ width: 460, height: 600 })).toBe("large")
  })

  it("detects presets with tolerance", () => {
    expect(presetFromSize({ width: 324, height: 412 })).toBe("medium")
    expect(presetFromSize({ width: 500, height: 500 })).toBe("custom")
  })
})
