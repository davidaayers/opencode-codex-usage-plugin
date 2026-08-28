import { describe, expect, it } from "vitest"
import { Usage } from "./usage.js"
import { CodexUsageFormat } from "./tui.js"

const theme = {
  success: "success",
  accent: "accent",
  warning: "warning",
  error: "error",
} as never

describe("CodexUsageFormat.gauge", () => {
  it("clamps boundaries and renders partial cells", () => {
    expect(CodexUsageFormat.gauge(-1, 7)).toEqual({ fill: "", track: "░░░░░░░" })
    expect(CodexUsageFormat.gauge(0.5, 7)).toEqual({ fill: "███▌", track: "░░░" })
    expect(CodexUsageFormat.gauge(2, 7)).toEqual({ fill: "███████", track: "" })
  })

  it("converts usage percentages before rendering", () => {
    expect(CodexUsageFormat.usageGauge(42, 7)).toEqual({ fill: "███", track: "░░░░" })
    expect(CodexUsageFormat.usageGauge(81, 7)).toEqual({ fill: "█████▋", track: "░" })
    expect(CodexUsageFormat.usageGauge(100, 7)).toEqual({ fill: "███████", track: "" })
  })
})

describe("CodexUsageFormat.levelColor", () => {
  it("uses the Go plugin threshold boundaries", () => {
    expect(CodexUsageFormat.levelColor(49.9, theme)).toBe("success")
    expect(CodexUsageFormat.levelColor(50, theme)).toBe("accent")
    expect(CodexUsageFormat.levelColor(75, theme)).toBe("warning")
    expect(CodexUsageFormat.levelColor(90, theme)).toBe("error")
  })
})

describe("CodexUsageFormat.compactGaugeText", () => {
  it("identifies the window with the highest usage", () => {
    const usage = Usage.CodexUsage.make({
      fiveHour: Usage.UsageWindow.make({ label: "5h", usedPercent: 42, resetsAt: null }),
      weekly: Usage.UsageWindow.make({ label: "weekly", usedPercent: 81, resetsAt: null }),
    })

    expect(CodexUsageFormat.compactGaugeText(usage)).toBe("Codex weekly 81%")
  })
})

describe("CodexUsageFormat.shortReset", () => {
  it("keeps reset details compact", () => {
    expect(CodexUsageFormat.shortReset(null, new Date(0))).toBe("?")
    expect(CodexUsageFormat.shortReset(3_600, new Date(0))).toBe("1h")
  })
})
