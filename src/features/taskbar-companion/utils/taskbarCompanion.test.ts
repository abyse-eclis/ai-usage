import { describe, expect, it } from "vitest"
import type { ProviderUsage } from "../../../shared/types/usage"
import { normalizeLimit } from "../../../shared/utils/usage"
import {
  buildClaudeCompanionData,
  buildCompanionData,
  formatCompanionReset,
  usedToRemainingPercent
} from "./taskbarCompanion"

describe("taskbar companion formatting", () => {
  it.each([
    [0, 100],
    [23, 77],
    [55, 45],
    [100, 0]
  ])("converts %s used to %s remaining", (used, remaining) => {
    expect(usedToRemainingPercent(used)).toBe(remaining)
  })

  it("formats same-day 5h reset as local 24-hour time", () => {
    expect(
      formatCompanionReset(
        "2026-09-10T16:00:00.000+07:00",
        "compact",
        new Date("2026-09-10T11:00:00.000+07:00"),
        "24-hour"
      )
    ).toBe("16:00")
  })

  it("formats weekly resets with an abbreviated weekday", () => {
    expect(
      formatCompanionReset(
        "2026-09-16T15:00:00.000+07:00",
        "weekday",
        new Date("2026-09-10T11:00:00.000+07:00"),
        "24-hour"
      )
    ).toBe("Wed 15:00")
  })

  it("uses source remaining percent without double inversion", () => {
    const usage: ProviderUsage = {
      provider: "claude",
      status: "connected",
      updatedAt: "2026-09-10T04:00:00.000Z",
      lastSuccessfulAt: "2026-09-10T04:00:00.000Z",
      limits: [
        normalizeLimit({
          id: "five-hour",
          label: "Session (5h)",
          period: "session",
          remainingPercent: 45,
          resetAt: "2026-09-10T16:00:00.000+07:00"
        })
      ]
    }

    const data = buildClaudeCompanionData({
      usage,
      refreshFailed: false,
      now: new Date("2026-09-10T11:00:00.000+07:00"),
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })

    expect(data.provider).toBe("claude")
    expect(data.primary?.remainingPercent).toBe(45)
  })

  it("maps Claude limits to compact popup rows", () => {
    const usage: ProviderUsage = {
      provider: "claude",
      status: "connected",
      updatedAt: "2026-09-10T04:00:00.000Z",
      lastSuccessfulAt: "2026-09-10T03:58:00.000Z",
      limits: [
        normalizeLimit({ id: "five-hour", label: "Session (5h)", period: "session", usedPercent: 55, resetAt: "2026-09-10T23:00:00+07:00" }),
        normalizeLimit({ id: "seven-day", label: "Weekly", period: "weekly", usedPercent: 40, resetAt: "2026-09-16T15:00:00+07:00" }),
        normalizeLimit({ id: "seven-day-fable", label: "Fable", period: "weekly", usedPercent: 28, resetAt: "2026-09-16T15:00:00+07:00" })
      ]
    }

    const data = buildClaudeCompanionData({
      usage,
      refreshFailed: false,
      now: new Date("2026-09-10T04:00:00.000Z"),
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })

    expect(data.rows.map((row) => [row.label, row.remainingPercent])).toEqual([
      ["5-hour", 45],
      ["weekly", 60],
      ["fable", 72]
    ])
    expect(data.checkedText).toBe("Checked 2m ago")
  })

  it("labels cached and failed readings from the last successful fetch", () => {
    const cachedUsage: ProviderUsage = {
      provider: "claude",
      status: "connected",
      updatedAt: "2026-09-10T03:52:00.000Z",
      lastSuccessfulAt: "2026-09-10T03:52:00.000Z",
      limits: [normalizeLimit({ id: "five-hour", label: "Session", period: "session", usedPercent: 20 })]
    }

    const cached = buildClaudeCompanionData({
      cached: cachedUsage,
      refreshFailed: false,
      now: new Date("2026-09-10T04:00:00.000Z"),
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })
    const failed = buildClaudeCompanionData({
      usage: cachedUsage,
      refreshFailed: true,
      now: new Date("2026-09-10T04:00:00.000Z"),
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })

    expect(cached.checkedText).toBe(`Cached ${"\u00b7"} 8m ago`)
    expect(failed.checkedText).toBe(`Failed ${"\u00b7"} checked 8m ago`)
  })

  it("builds one summary segment per provider that reported usage", () => {
    const now = new Date("2026-09-10T04:00:00.000Z")
    const data = buildCompanionData({
      usage: {
        claude: {
          provider: "claude",
          status: "connected",
          updatedAt: now.toISOString(),
          lastSuccessfulAt: now.toISOString(),
          limits: [
            normalizeLimit({
              id: "five-hour",
              label: "Session (5h)",
              period: "session",
              usedPercent: 10,
              resetAt: "2026-09-10T16:00:00.000+07:00"
            })
          ]
        },
        chatgpt: {
          provider: "chatgpt",
          status: "connected",
          updatedAt: now.toISOString(),
          lastSuccessfulAt: now.toISOString(),
          limits: [
            normalizeLimit({
              id: "gpt-pro",
              label: "GPT Pro",
              period: "weekly",
              used: 31,
              total: 50,
              unit: "messages",
              resetAt: "2026-09-16T15:00:00.000+07:00"
            })
          ]
        }
      },
      cache: {},
      refreshFailed: false,
      now,
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })

    // Percent limits read as a percentage; counted limits read as a count.
    expect(data.providers.map((entry) => [entry.provider, entry.primary?.valueText])).toEqual([
      ["claude", "90%"],
      ["chatgpt", "19"]
    ])
    expect(data.providers.map((entry) => entry.primary?.resetText)).toEqual(["16:00", "Wed 15:00"])
  })

  it("drops providers that reported nothing instead of leaving a blank slot", () => {
    const now = new Date("2026-09-10T04:00:00.000Z")
    const data = buildCompanionData({
      usage: {
        claude: {
          provider: "claude",
          status: "connected",
          updatedAt: now.toISOString(),
          lastSuccessfulAt: now.toISOString(),
          limits: [normalizeLimit({ id: "five-hour", label: "Session", period: "session", usedPercent: 10 })]
        },
        chatgpt: {
          provider: "chatgpt",
          status: "disconnected",
          updatedAt: now.toISOString(),
          limits: []
        }
      },
      cache: {},
      refreshFailed: false,
      now,
      show: { showFiveHour: true, showWeekly: true, showFable: true }
    })

    expect(data.providers.map((entry) => entry.provider)).toEqual(["claude"])
  })
})
