import { describe, expect, it } from "vitest"
import { errorMessage, hasRolledOver, toUsageLimit, windowResetAt } from "./localUsageSource"

const claudeWindow = {
  id: "five-hour",
  label: "Session (5h)",
  usedPercent: 30,
  resetsAtIso: "2026-09-10T04:00:00.421986+00:00"
}

const codexWindow = {
  id: "weekly",
  label: "Weekly",
  usedPercent: 35.4,
  resetsAtEpochSeconds: 1789527560,
  windowMinutes: 10080
}

describe("windowResetAt", () => {
  it("passes through the ISO reset time Claude Code caches", () => {
    expect(windowResetAt(claudeWindow)).toBe("2026-09-10T04:00:00.421Z")
  })

  it("converts the epoch seconds Codex records into ISO", () => {
    expect(windowResetAt(codexWindow)).toBe(new Date(1789527560 * 1000).toISOString())
  })

  it("returns undefined when a window carries no reset time", () => {
    expect(windowResetAt({ id: "weekly", label: "Weekly", usedPercent: 12 })).toBeUndefined()
  })

  it("returns undefined for an unparseable reset time", () => {
    expect(windowResetAt({ ...claudeWindow, resetsAtIso: "not-a-date" })).toBeUndefined()
  })
})

describe("toUsageLimit", () => {
  it("maps a five-hour window onto the session period", () => {
    const limit = toUsageLimit(claudeWindow)
    expect(limit.period).toBe("session")
    expect(limit.usedPercent).toBe(30)
    expect(limit.remainingPercent).toBe(70)
    expect(limit.unit).toBe("percent")
  })

  it("rounds a fractional percentage and keeps the weekly period", () => {
    const limit = toUsageLimit(codexWindow)
    expect(limit.period).toBe("weekly")
    expect(limit.usedPercent).toBe(35)
  })

  it("falls back to a custom period for model specific windows", () => {
    expect(toUsageLimit({ id: "seven-day-opus", label: "Weekly Opus", usedPercent: 4 }).period).toBe(
      "custom"
    )
  })
})

describe("hasRolledOver", () => {
  const now = Date.parse("2026-09-10T05:00:00.000Z")

  it("flags a cached window whose reset time has passed", () => {
    expect(hasRolledOver(claudeWindow, now)).toBe(true)
  })

  it("accepts a window that has not reset yet", () => {
    expect(hasRolledOver(codexWindow, now)).toBe(false)
  })

  it("treats a window without a reset time as current", () => {
    expect(hasRolledOver({ id: "weekly", label: "Weekly", usedPercent: 9 }, now)).toBe(false)
  })
})

describe("errorMessage", () => {
  it("keeps the string a Tauri command rejects with", () => {
    expect(errorMessage("Claude Code state file was not found.", "fallback")).toBe(
      "Claude Code state file was not found."
    )
  })

  it("falls back when the rejection carries no message", () => {
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback")
    expect(errorMessage(undefined, "fallback")).toBe("fallback")
  })
})
