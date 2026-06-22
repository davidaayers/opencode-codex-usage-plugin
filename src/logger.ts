import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Context, Effect, Layer } from "effect"

type Level = "debug" | "info" | "warn" | "error"

export interface Interface {
  readonly debug: (message: string, extra?: Record<string, unknown>) => Effect.Effect<void>
  readonly info: (message: string, extra?: Record<string, unknown>) => Effect.Effect<void>
  readonly warn: (message: string, extra?: Record<string, unknown>) => Effect.Effect<void>
  readonly error: (message: string, extra?: Record<string, unknown>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("Logger") {}

export const layer = (api: TuiPluginApi) => {
  const write = Effect.fn("Logger.write")(function* (
    level: Level,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    yield* Effect.tryPromise(() =>
      api.client.app.log({
        directory: api.state.path.directory,
        service: "opencode-codex-usage-plugin",
        level,
        message,
        extra,
      }),
    ).pipe(Effect.catch(() => Effect.void))
  })

  return Layer.succeed(
    Service,
    Service.of({
      debug: (message, extra) => write("debug", message, extra),
      info: (message, extra) => write("info", message, extra),
      warn: (message, extra) => write("warn", message, extra),
      error: (message, extra) => write("error", message, extra),
    }),
  )
}

export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    debug: () => Effect.void,
    info: () => Effect.void,
    warn: () => Effect.void,
    error: () => Effect.void,
  }),
)

export * as Logger from "./logger.js"
