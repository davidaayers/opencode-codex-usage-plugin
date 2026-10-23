/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { Effect, Layer, ManagedRuntime, Option, Predicate, Schema } from "effect"
import { CodexService } from "./codex.ts"
import { Logger } from "./logger.js"
import { Usage } from "./usage.js"

type UsageState =
  | { status: "loading"; usage: null; message: string }
  | { status: "ready"; usage: Usage.CodexUsage; message: string }
  | { status: "error"; usage: null; message: string }

type TuiColor = TuiPluginApi["theme"]["text"]["base"]
type TuiTheme = Record<"text" | "textMuted" | "accent" | "success" | "warning" | "error", TuiColor>
type Runtime = ReturnType<typeof createRuntime>

class AssistantProviderMessage extends Schema.Class<AssistantProviderMessage>("Tui.AssistantProviderMessage")({
  type: Schema.Literal("assistant"),
  model: Schema.Struct({ providerID: Schema.String }),
}) {}

const decodeAssistantProviderMessage = Schema.decodeUnknownOption(AssistantProviderMessage)

const POLL_MS = 60_000
const UI_TIMEOUT_MS = 15_000
const GAUGE_WIDTH = 7
const EXPANDED_GAUGE_WIDTH = 28
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"]
const OK_AT = 50
const WARN_AT = 75
const DANGER_AT = 90

function themePalette(api: TuiPluginApi): TuiTheme {
  const text = api.theme.text
  return {
    text: text.base,
    textMuted: text.muted,
    accent: text.action.primary.base,
    success: text.feedback.success.base,
    warning: text.feedback.warning.base,
    error: text.feedback.error.base,
  }
}

function View(props: { api: TuiPluginApi; session_id: string; runtime: Runtime; onMissingCodex: () => void }) {
  const theme = () => themePalette(props.api)
  const { state, isOpenAI } = createUsagePolling(props)

  return (
    <box visible={isOpenAI()}>
      <Show when={isOpenAI()} fallback={<box />}>
        <UsageBlock state={state} theme={theme} />
      </Show>
    </box>
  )
}

function CompactView(props: { api: TuiPluginApi; session_id: string; runtime: Runtime; onMissingCodex: () => void }) {
  const dimensions = useTerminalDimensions()
  const theme = () => themePalette(props.api)
  const sidebarHidden = createMemo(() => !isSidebarVisible(props.api, props.session_id, dimensions().width))
  const { state, isOpenAI } = createUsagePolling({
    api: props.api,
    get session_id() {
      return props.session_id
    },
    runtime: props.runtime,
    onMissingCodex: props.onMissingCodex,
    enabled: sidebarHidden,
  })
  return (
    <box visible={isOpenAI() && sidebarHidden()}>
      <Show when={isOpenAI() && sidebarHidden()} fallback={<box />}>
        <text fg={theme().textMuted}>{compactUsageText(state())}</text>
      </Show>
    </box>
  )
}

function createUsagePolling(props: {
  api: TuiPluginApi
  session_id: string
  runtime: Runtime
  onMissingCodex: () => void
  enabled?: () => boolean
}) {
  const [state, setState] = createSignal<UsageState>({
    status: "loading",
    usage: null,
    message: "Loading usage...",
  })

  const isOpenAI = createMemo(() => isOpenAISession(props.api, props.session_id))
  const enabled = props.enabled ?? (() => true)

  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let refreshAgain = false

  const refresh = () => {
    if (inFlight) {
      refreshAgain = true
      debug(props.runtime, "tui.refresh.join", { sessionID: props.session_id })
      return inFlight
    }

    inFlight = runRefresh().finally(() => {
      inFlight = undefined
      if (refreshAgain && !disposed) {
        refreshAgain = false
        void refresh()
      }
    })

    return inFlight
  }

  const runRefresh = async () => {
    if (!enabled()) return

    if (!isOpenAI()) {
      debug(props.runtime, "tui.refresh.skip", { reason: "provider_not_openai", sessionID: props.session_id })
      return
    }

    const startedAt = Date.now()
    debug(props.runtime, "tui.refresh.start", { sessionID: props.session_id })
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (disposed || state().status !== "loading") return
      warn(props.runtime, "tui.refresh.ui_timeout", { sessionID: props.session_id, timeoutMs: UI_TIMEOUT_MS })
      setState({
        status: "error",
        usage: null,
        message: "Still waiting; check OpenCode server logs.",
      })
      props.api.renderer.requestRender()
    }, UI_TIMEOUT_MS)

    try {
      const usage = await props.runtime.runPromise(
        Effect.gen(function* () {
          const codex = yield* CodexService.Service
          return yield* codex.readUsage()
        }),
      )
      if (disposed) return
      if (timeout) clearTimeout(timeout)
      debug(props.runtime, "tui.refresh.success", { sessionID: props.session_id, ms: Date.now() - startedAt })
      setState({ status: "ready", usage, message: "Usage loaded" })
      props.api.renderer.requestRender()
    } catch (error) {
      if (disposed) return
      if (timeout) clearTimeout(timeout)
      if (Predicate.isTagged(error, "CodexService.CommandMissingError")) props.onMissingCodex()
      warn(props.runtime, "tui.refresh.error", {
        sessionID: props.session_id,
        ms: Date.now() - startedAt,
        error: errorMessage(error),
      })
      setState({
        status: "error",
        usage: null,
        message: errorMessage(error),
      })
      props.api.renderer.requestRender()
    }
  }

  createEffect(() => {
    if (enabled()) untrack(() => void refresh())
  })
  timer = setInterval(() => void refresh(), POLL_MS)
  const unsubscribeSession = props.api.data.listen(({ details }) => {
    if (
      (details.type === "session.usage.updated" ||
        details.type === "session.step.ended" ||
        details.type === "session.model.selected") &&
      details.data.sessionID === props.session_id
    )
      void refresh()
  })

  onCleanup(() => {
    disposed = true
    unsubscribeSession()
    if (timer) clearInterval(timer)
    if (timeout) clearTimeout(timeout)
  })

  return { state, isOpenAI }
}

function UsageBlock(props: { state: () => UsageState; theme: () => TuiTheme }) {
  const usage = () => props.state().usage
  return (
    <box flexDirection="column">
      <text fg={props.theme().text} attributes={TextAttributes.BOLD}>
        {"Codex Usage"}
      </text>
      <Show
        when={usage()}
        fallback={
          <text fg={props.state().status === "error" ? props.theme().warning : props.theme().textMuted}>
            {props.state().status === "error" ? props.state().message : "Loading..."}
          </text>
        }
      >
        {(current) => <UsageGauges usage={current()} theme={props.theme} />}
      </Show>
    </box>
  )
}

function UsageGauges(props: { usage: Usage.CodexUsage; theme: () => TuiTheme }) {
  const width = () => (props.usage.fiveHour ? GAUGE_WIDTH : EXPANDED_GAUGE_WIDTH)
  const windows = createMemo(() =>
    [
      { label: "5h", window: props.usage.fiveHour },
      { label: "week", window: props.usage.weekly },
    ].filter((entry): entry is { label: string; window: Usage.UsageWindow } => entry.window !== null),
  )
  return (
    <box>
      <box flexDirection="row" columnGap={1}>
        <For each={windows()} fallback={<box />}>
          {(entry) => <UsageGauge label={entry.label} window={entry.window} theme={props.theme} width={width()} />}
        </For>
      </box>
    </box>
  )
}

function UsageGauge(props: { label: string; window: Usage.UsageWindow; theme: () => TuiTheme; width: number }) {
  const bar = () => usageGauge(props.window.usedPercent, props.width)
  const color = () => levelColor(props.window.usedPercent, props.theme())
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={props.theme().textMuted}>{`${props.label} `}</text>
        <text fg={color()}>{bar().fill}</text>
        <text fg={props.theme().textMuted}>{bar().track}</text>
      </box>
      <box flexDirection="row">
        <text fg={color()}>{Usage.formatPercent(props.window.usedPercent)}</text>
        <text fg={props.theme().textMuted}>{` · ${shortReset(props.window.resetsAt)}`}</text>
      </box>
    </box>
  )
}

function compactUsageText(state: UsageState) {
  switch (state.status) {
    case "ready":
      return compactGaugeText(state.usage)
    case "error":
      return ""
    case "loading":
      return "5h ..."
  }
}

function gauge(fraction: number, width: number): { fill: string; track: string } {
  const cells = Math.min(1, Math.max(0, fraction)) * width
  let full = Math.floor(cells)
  let partial = EIGHTHS[Math.round((cells - full) * 8)] ?? ""
  if (partial === EIGHTHS[8]) {
    full += 1
    partial = ""
  }
  return {
    fill: "█".repeat(full) + partial,
    track: "░".repeat(width - full - (partial ? 1 : 0)),
  }
}

function usageGauge(percent: number, width: number): { fill: string; track: string } {
  return gauge(percent / 100, width)
}

function levelColor(percent: number, theme: TuiTheme): TuiColor {
  if (percent >= DANGER_AT) return theme.error
  if (percent >= WARN_AT) return theme.warning
  if (percent >= OK_AT) return theme.accent
  return theme.success
}

function shortReset(unixSeconds: number | null, now = new Date()): string {
  const formatted = Usage.formatResetTime(unixSeconds, now)
  if (formatted === "reset unknown") return "?"
  if (formatted === "resets now") return "now"
  return formatted.replace("resets in ", "")
}

function compactGaugeText(usage: Usage.CodexUsage): string {
  const windows = [usage.fiveHour, usage.weekly].filter((window): window is Usage.UsageWindow => window !== null)
  const window = windows.reduce<Usage.UsageWindow | undefined>(
    (worst, current) => (!worst || current.usedPercent > worst.usedPercent ? current : worst),
    undefined,
  )
  return window ? `Codex ${window.label} ${Usage.formatPercent(window.usedPercent)}` : ""
}

export const CodexUsageFormat = {
  gauge,
  usageGauge,
  levelColor,
  shortReset,
  compactGaugeText,
}

function isOpenAISession(api: TuiPluginApi, sessionID: string): boolean {
  const messages = api.data.session.message.list(sessionID)
  const lastProviderID = [...messages].reverse().map(readAssistantProviderID).find(Boolean)

  if (lastProviderID) return lastProviderID === "openai"

  const model = api.data.session.get(sessionID)?.model ?? api.ui.model.current()
  return model?.providerID === "openai"
}

function readAssistantProviderID(message: unknown): string | undefined {
  return Option.getOrUndefined(decodeAssistantProviderMessage(message))?.model.providerID
}

function isSidebarVisible(api: TuiPluginApi, sessionID: string, width: number): boolean {
  if (api.data.session.get(sessionID)?.parentID) return false
  return api.options.compact !== true && width > 120
}

function createRuntime(api: TuiPluginApi) {
  const loggerLayer = Logger.layer(api)
  return ManagedRuntime.make(CodexService.layer().pipe(Layer.provideMerge(loggerLayer)))
}

function debug(runtime: Runtime, message: string, extra: Record<string, unknown> = {}) {
  void runtime.runPromise(Effect.logDebug(message, extra)).catch(() => undefined)
}

function warn(runtime: Runtime, message: string, extra: Record<string, unknown> = {}) {
  void runtime.runPromise(Effect.logWarning(message, extra)).catch(() => undefined)
}

function errorMessage(error: unknown): string {
  if (Predicate.isError(error)) return error.message
  if (Predicate.hasProperty(error, "message") && Predicate.isString(error.message)) {
    return error.message
  }
  return "Usage unavailable"
}

export default Plugin.define({
  id: "opencode-codex-usage",
  setup: async (api) => {
    const runtime = createRuntime(api)
    debug(runtime, "plugin.init", {})
    let warnedMissingCodex = false

    const warnMissingCodex = () => {
      if (warnedMissingCodex) return
      warnedMissingCodex = true
      api.ui.toast.show({
        variant: "warning",
        title: "Codex required",
        message: "Install Codex.app or the Codex CLI to see usage stats.",
      })
    }

    const sidebar = api.ui.slot({
      prepend: "sidebar.content",
      render(props) {
        return <View api={api} session_id={props.sessionID} runtime={runtime} onMissingCodex={warnMissingCodex} />
      },
    })
    const compact = api.ui.slot({
      append: "prompt.footer.status",
      render(props) {
        return (
          <Show when={props.sessionID} fallback={<box visible={false} />}>
            {(id) => <CompactView api={api} session_id={id()} runtime={runtime} onMissingCodex={warnMissingCodex} />}
          </Show>
        )
      },
    })
    return () => {
      sidebar()
      compact()
      return runtime.dispose()
    }
  },
})
