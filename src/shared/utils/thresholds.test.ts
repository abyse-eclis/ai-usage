import { describe, expect, it } from "vitest"
import { getUsageSeverity, nextReachedThreshold } from "./thresholds"

describe("thresholds", () => {
  it("classifies usage severity", () => {
    expect(getUsageSeverity(79)).toBe("normal")
    expect(getUsageSeverity(80)).toBe("warning")
    expect(getUsageSeverity(90)).toBe("high")
    expect(getUsageSeverity(95)).toBe("critical")
  })

  it("returns the highest reached notification threshold", () => {
    expect(nextReachedThreshold(82)).toBe(80)
    expect(nextReachedThreshold(91)).toBe(90)
    expect(nextReachedThreshold(100)).toBe(95)
  })
})
