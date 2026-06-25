import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
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

    void api.client.app
      .log({
        directory: api.state.path.directory,
        service: "opencode-codex-usage-plugin",
        level: levels[options.logLevel] ?? "info",
        message: String(message),
        extra: Predicate.isObject(extra) ? extra : {},
      })
      .catch(() => undefined)
  })

  return EffectLogger.layer([logger]).pipe(Layer.merge(Layer.succeed(References.MinimumLogLevel, "Debug")))
}

export const noopLayer = EffectLogger.layer([])

export * as Logger from "./logger.js"
