import { describe, expect, it } from "vitest"
import { inferWidgetMode, presetFromSize } from "./presets"

describe("widget presets", () => {
  it("infers layout from available size", () => {
    expect(inferWidgetMode({ width: 220, height: 180 })).toBe("small")
    expect(inferWidgetMode({ width: 250, height: 240 })).toBe("medium")
    expect(inferWidgetMode({ width: 300, height: 360 })).toBe("large")
  })

  it("detects presets with tolerance", () => {
    expect(presetFromSize({ width: 254, height: 232 })).toBe("medium")
    expect(presetFromSize({ width: 500, height: 500 })).toBe("custom")
  })
})
