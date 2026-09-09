import { describe, expect, it } from "vitest"
import { formatResetCountdown } from "./time"

describe("formatResetCountdown", () => {
  it("formats hours and minutes", () => {
    expect(formatResetCountdown("2026-09-09T12:02:00.000Z", new Date("2026-09-09T10:00:00.000Z"))).toBe(
      "Resets in 2h 02m"
    )
  })

  it("formats elapsed reset times as ready", () => {
    expect(formatResetCountdown("2026-09-09T09:59:00.000Z", new Date("2026-09-09T10:00:00.000Z"))).toBe(
      "Ready to refresh"
    )
  })
})
