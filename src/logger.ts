import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import { Array, Layer, Logger as EffectLogger, Predicate, References, type LogLevel } from "effect"

type Level = "debug" | "info" | "warn" | "error"

// Mapping from Effect log levels to OpenCode log levels
const levels: Partial<Record<LogLevel.LogLevel, Level>> = {
  Debug: "debug",
  Trace: "debug",
  Warn: "warn",
  Error: "error",
  Fatal: "error",
}

export const layer = (api: TuiPluginApi) => {
  const logger = EffectLogger.make((options) => {
    const [message, extra] = Array.ensure(options.message)

    // V2 has no app.log endpoint. Keep diagnostics in the CLI's console log.
    const level = levels[options.logLevel] ?? "info"
    console[level]("opencode-codex-usage-plugin", String(message), Predicate.isObject(extra) ? extra : {})
  })

  return EffectLogger.layer([logger]).pipe(Layer.merge(Layer.succeed(References.MinimumLogLevel, "Debug")))
}

export const noopLayer = EffectLogger.layer([])

export * as Logger from "./logger.js"
