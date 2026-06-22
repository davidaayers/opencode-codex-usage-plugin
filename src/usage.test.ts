import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Usage } from "./usage.js"

const window5h = Usage.RateLimitWindow.make({ usedPercent: 42.4, windowDurationMins: 300, resetsAt: 1_800 })
const windowWeekly = Usage.RateLimitWindow.make({ usedPercent: 12.2, windowDurationMins: 10_080, resetsAt: 604_800 })

describe("Usage.mapRateLimitsToUsage", () => {
  it("maps primary and secondary windows", () => {
    const usage = Usage.mapRateLimitsToUsage(response(snapshot({ primary: window5h, secondary: windowWeekly })))

    expect(usage.fiveHour).toMatchObject({ label: "5h", usedPercent: 42.4, resetsAt: 1_800 })
    expect(usage.weekly).toMatchObject({ label: "weekly", usedPercent: 12.2, resetsAt: 604_800 })
  })

  it("maps inverted windows", () => {
    const usage = Usage.mapRateLimitsToUsage(response(snapshot({ primary: windowWeekly, secondary: window5h })))

    expect(usage.fiveHour?.usedPercent).toBe(42.4)
    expect(usage.weekly?.usedPercent).toBe(12.2)
  })

  it("prefers the codex bucket when rateLimitsByLimitId is present", () => {
    const usage = Usage.mapRateLimitsToUsage(
      Usage.RateLimitsResponse.make({
        rateLimits: snapshot({ primary: null, secondary: null }),
        rateLimitsByLimitId: {
          codex: snapshot({ primary: window5h, secondary: windowWeekly }),
        },
      }),
    )

    expect(usage.fiveHour?.usedPercent).toBe(42.4)
    expect(usage.weekly?.usedPercent).toBe(12.2)
  })

  it("falls back when the codex bucket is absent", () => {
    const usage = Usage.mapRateLimitsToUsage(
      Usage.RateLimitsResponse.make({
        rateLimits: snapshot({ primary: window5h, secondary: windowWeekly }),
        rateLimitsByLimitId: {
          other: snapshot({ primary: null, secondary: null }),
        },
      }),
    )

    expect(usage.fiveHour?.usedPercent).toBe(42.4)
    expect(usage.weekly?.usedPercent).toBe(12.2)
  })

  it("preserves null reset timestamps", () => {
    const usage = Usage.mapRateLimitsToUsage(
      response(
        snapshot({
          primary: Usage.RateLimitWindow.make({ ...window5h, resetsAt: null }),
          secondary: null,
        }),
      ),
    )

    expect(usage.fiveHour).toMatchObject({ label: "5h", usedPercent: 42.4, resetsAt: null })
    expect(usage.weekly).toBeNull()
  })

  it.effect("decodes external rate-limit payloads", () =>
    Effect.gen(function* () {
      const decoded = yield* Usage.decodeRateLimitsResponse({
        rateLimits: {
          primary: { usedPercent: 42.4, windowDurationMins: 300, resetsAt: 1_800 },
          secondary: { usedPercent: 12.2, windowDurationMins: 10_080, resetsAt: 604_800 },
        },
        rateLimitsByLimitId: null,
      })

      expect(decoded.rateLimits.primary?.usedPercent).toBe(42.4)
    }),
  )
})

describe("Usage.formatPercent", () => {
  it("rounds and clamps percentages", () => {
    expect(Usage.formatPercent(42.4)).toBe("42%")
    expect(Usage.formatPercent(101)).toBe("100%")
    expect(Usage.formatPercent(-1)).toBe("0%")
  })

  it("formats remaining percentages from used percentages", () => {
    expect(Usage.formatRemainingPercent(28)).toBe("72%")
    expect(Usage.formatRemainingPercent(101)).toBe("0%")
    expect(Usage.formatRemainingPercent(-1)).toBe("100%")
  })
})

describe("Usage.formatResetTime", () => {
  it("formats unknown, elapsed, minute, hour, and day resets", () => {
    const now = new Date(0)

    expect(Usage.formatResetTime(null, now)).toBe("reset unknown")
    expect(Usage.formatResetTime(-1, now)).toBe("resets now")
    expect(Usage.formatResetTime(60, now)).toBe("resets in 1m")
    expect(Usage.formatResetTime(3_600, now)).toBe("resets in 1h")
    expect(Usage.formatResetTime(3 * 86_400, now)).toBe("resets in 3d")
  })
})

function response(rateLimits: Usage.RateLimitSnapshot): Usage.RateLimitsResponse {
  return Usage.RateLimitsResponse.make({ rateLimits, rateLimitsByLimitId: null })
}

function snapshot(input: {
  readonly primary: Usage.RateLimitWindow | null
  readonly secondary: Usage.RateLimitWindow | null
}): Usage.RateLimitSnapshot {
  return Usage.RateLimitSnapshot.make(input)
}
