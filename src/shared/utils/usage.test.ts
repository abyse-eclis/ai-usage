import { describe, expect, it } from "vitest"
import { normalizeLimit } from "./usage"

describe("normalizeLimit", () => {
  it("preserves used semantics", () => {
    const limit = normalizeLimit({ id: "session", label: "Session", usedPercent: 79 })
    expect(limit.usedPercent).toBe(79)
    expect(limit.remainingPercent).toBe(21)
  })

  it("normalizes remaining semantics without mixing raw meaning", () => {
    const limit = normalizeLimit({ id: "remaining", label: "Remaining", remainingPercent: 32 })
    expect(limit.usedPercent).toBe(68)
    expect(limit.remainingPercent).toBe(32)
    expect(limit.rawValue).toMatchObject({ sourceRemainingPercent: 32 })
  })

  it("derives percent from exact values", () => {
    const limit = normalizeLimit({ id: "gpt-pro", label: "GPT Pro", used: 31, total: 50 })
    expect(limit.usedPercent).toBe(62)
  })
})
