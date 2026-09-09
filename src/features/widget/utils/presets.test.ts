import { describe, expect, it } from "vitest"
import { inferWidgetMode, presetFromSize } from "./presets"

describe("widget presets", () => {
  it("infers layout from available size", () => {
    expect(inferWidgetMode({ width: 320, height: 240 })).toBe("small")
    expect(inferWidgetMode({ width: 420, height: 560 })).toBe("medium")
    expect(inferWidgetMode({ width: 640, height: 760 })).toBe("large")
  })

  it("detects presets with tolerance", () => {
    expect(presetFromSize({ width: 424, height: 552 })).toBe("medium")
    expect(presetFromSize({ width: 500, height: 500 })).toBe("custom")
  })
})
