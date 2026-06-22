import { Schema } from "effect"

export class RateLimitWindow extends Schema.Class<RateLimitWindow>("Usage.RateLimitWindow")({
  usedPercent: Schema.Number,
  windowDurationMins: Schema.NullOr(Schema.Number),
  resetsAt: Schema.NullOr(Schema.Number),
}) {}

export class RateLimitSnapshot extends Schema.Class<RateLimitSnapshot>("Usage.RateLimitSnapshot")({
  limitId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  limitName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  primary: Schema.NullOr(RateLimitWindow),
  secondary: Schema.NullOr(RateLimitWindow),
}) {}

export class RateLimitsResponse extends Schema.Class<RateLimitsResponse>("Usage.RateLimitsResponse")({
  rateLimits: RateLimitSnapshot,
  rateLimitsByLimitId: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.NullishOr(RateLimitSnapshot))),
  ),
}) {}

export class UsageWindow extends Schema.Class<UsageWindow>("Usage.UsageWindow")({
  label: Schema.Literals(["5h", "weekly"]),
  usedPercent: Schema.Number,
  resetsAt: Schema.NullOr(Schema.Number),
}) {}

export class CodexUsage extends Schema.Class<CodexUsage>("Usage.CodexUsage")({
  fiveHour: Schema.NullOr(UsageWindow),
  weekly: Schema.NullOr(UsageWindow),
}) {}

export const decodeRateLimitsResponse = Schema.decodeUnknownEffect(RateLimitsResponse)

const FIVE_HOURS_MINS = 5 * 60
const WEEK_MINS = 7 * 24 * 60

export function extractCodexRateLimitSnapshot(response: RateLimitsResponse): RateLimitSnapshot {
  return response.rateLimitsByLimitId?.codex ?? response.rateLimits
}

export function mapRateLimitsToUsage(response: RateLimitsResponse): CodexUsage {
  const snapshot = extractCodexRateLimitSnapshot(response)
  const windows = [snapshot.primary, snapshot.secondary].filter((item): item is RateLimitWindow => item !== null)

  return CodexUsage.make({
    fiveHour: findWindow(windows, FIVE_HOURS_MINS, "5h"),
    weekly: findWindow(windows, WEEK_MINS, "weekly"),
  })
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "unknown"
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

export function formatRemainingPercent(usedPercent: number): string {
  return formatPercent(100 - usedPercent)
}

export function formatResetTime(unixSeconds: number | null, now = new Date()): string {
  if (!unixSeconds) return "reset unknown"

  const reset = new Date(unixSeconds * 1000)
  const diffMs = reset.getTime() - now.getTime()
  if (!Number.isFinite(diffMs)) return "reset unknown"
  if (diffMs <= 0) return "resets now"

  const minutes = Math.ceil(diffMs / 60_000)
  if (minutes < 60) return `resets in ${minutes}m`

  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `resets in ${hours}h`

  const days = Math.ceil(hours / 24)
  return `resets in ${days}d`
}

function findWindow(
  windows: ReadonlyArray<RateLimitWindow>,
  durationMins: number,
  label: UsageWindow["label"],
): UsageWindow | null {
  const match = windows.find((item) => item.windowDurationMins === durationMins)
  if (!match) return null

  return UsageWindow.make({
    label,
    usedPercent: match.usedPercent,
    resetsAt: match.resetsAt,
  })
}

export * as Usage from "./usage.js"
