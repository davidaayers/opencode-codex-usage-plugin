import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import {
  createComponent,
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  setProp,
  useTerminalDimensions,
} from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { Effect, Layer, ManagedRuntime, Option, Predicate, Schema } from "effect"
import { CodexService } from "./codex.ts"
import { Logger } from "./logger.js"
import { Usage } from "./usage.js"

type UsageState =
  | { status: "loading"; usage: null; message: string }
  | { status: "ready"; usage: Usage.CodexUsage; message: string }
  | { status: "error"; usage: null; message: string }

type TuiColor = TuiPluginApi["theme"]["current"]["textMuted"]
type TuiTheme = TuiPluginApi["theme"]["current"]
type Runtime = ReturnType<typeof createRuntime>

class AssistantProviderMessage extends Schema.Class<AssistantProviderMessage>("Tui.AssistantProviderMessage")({
  role: Schema.Literal("assistant"),
  providerID: Schema.String,
}) {}

const decodeAssistantProviderMessage = Schema.decodeUnknownOption(AssistantProviderMessage)

const POLL_MS = 60_000
const UI_TIMEOUT_MS = 15_000

function View(props: { api: TuiPluginApi; session_id: string; runtime: Runtime; onMissingCodex: () => void }) {
  const theme = () => props.api.theme.current
  const { state, isOpenAI } = createUsagePolling(props)

  const root = createElement("box")

  insert(root, () => (isOpenAI() ? UsageBlock({ state, theme }) : null), null)

  return root
}

function CompactView(props: { api: TuiPluginApi; session_id: string; runtime: Runtime; onMissingCodex: () => void }) {
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
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
  const root = createElement("box")

  insert(root, () => (isOpenAI() && sidebarHidden() ? CompactUsageLine({ state, theme }) : null), null)

  return root
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
  const unsubscribeMessage = props.api.event.on("message.updated", () => void refresh())
  const unsubscribeSession = props.api.event.on("session.updated", () => void refresh())

  onCleanup(() => {
    disposed = true
    unsubscribeMessage()
    unsubscribeSession()
    if (timer) clearInterval(timer)
    if (timeout) clearTimeout(timeout)
  })

  return { state, isOpenAI }
}

function UsageBlock(props: { state: () => UsageState; theme: () => TuiTheme }) {
  const root = createElement("box")
  const title = createElement("text")
  const bold = createElement("b")

  insertNode(root, title)
  insertNode(title, bold)
  insertNode(bold, createTextNode("Codex Usage"))
  effect(() => setProp(title, "fg", props.theme().text))

  insert(
    root,
    () => {
      const state = props.state()

      switch (state.status) {
        case "ready":
          return UsageLines(state.usage, () => props.theme().textMuted)
        case "error":
          return textLine(
            () => props.state().message,
            () => props.theme().warning,
          )
        case "loading":
          return textLine(
            () => "Loading...",
            () => props.theme().textMuted,
          )
      }
    },
    null,
  )

  return root
}

function textLine(text: () => string, color: () => TuiColor) {
  const line = createElement("text")

  insert(line, text)
  effect(() => setProp(line, "fg", color()))

  return line
}

function UsageLines(usage: Usage.CodexUsage, color: () => TuiColor) {
  return [UsageLine("5h", usage.fiveHour, color), UsageLine("weekly", usage.weekly, color)]
}

function CompactUsageLine(props: { state: () => UsageState; theme: () => TuiTheme }) {
  return textLine(
    () => compactUsageText(props.state()),
    () => props.theme().textMuted,
  )
}

function compactUsageText(state: UsageState) {
  switch (state.status) {
    case "ready":
      return Usage.formatCompactUsage(state.usage) ?? ""
    case "error":
      return ""
    case "loading":
      return "5h ..."
  }
}

function UsageLine(label: string, usage: Usage.CodexUsage["fiveHour"], color: () => TuiColor) {
  return textLine(
    () =>
      `${label}: ${usage ? `${Usage.formatRemainingPercent(usage.usedPercent)} · ${Usage.formatResetTime(usage.resetsAt)}` : "unavailable"}`,
    color,
  )
}

function isOpenAISession(api: TuiPluginApi, sessionID: string): boolean {
  const messages = api.state.session.messages(sessionID)
  const lastProviderID = [...messages].reverse().map(readAssistantProviderID).find(Boolean)

  if (lastProviderID) return lastProviderID === "openai"

  return api.state.config.model?.startsWith("openai/") ?? false
}

function readAssistantProviderID(message: unknown): string | undefined {
  return Option.getOrUndefined(decodeAssistantProviderMessage(message))?.providerID
}

function isSidebarVisible(api: TuiPluginApi, sessionID: string, width: number): boolean {
  if (api.state.session.get(sessionID)?.parentID) return false
  return api.kv.get<"auto" | "hide">("sidebar", "auto") === "auto" && width > 120
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

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-codex-usage",
  tui: async (api) => {
    const runtime = createRuntime(api)
    debug(runtime, "plugin.init", {})
    let warnedMissingCodex = false

    const warnMissingCodex = () => {
      if (warnedMissingCodex) return
      warnedMissingCodex = true
      api.ui.toast({
        variant: "warning",
        title: "Codex required",
        message: "Install Codex.app or the Codex CLI to see usage stats.",
      })
    }

    api.lifecycle.onDispose(() => runtime.dispose())

    api.slots.register({
      order: 150,
      slots: {
        sidebar_content(_ctx, props) {
          const view = createComponent(View, {
            api,
            get session_id() {
              return props.session_id
            },
            runtime,
            onMissingCodex: warnMissingCodex,
          })

          // OpenTUI's runtime primitives return renderables, while the slot API is typed through Solid's JSX facade.
          return view as unknown as JSX.Element
        },
        session_prompt_right(_ctx, props) {
          const view = createComponent(CompactView, {
            api,
            get session_id() {
              return props.session_id
            },
            runtime,
            onMissingCodex: warnMissingCodex,
          })

          // OpenTUI's runtime primitives return renderables, while the slot API is typed through Solid's JSX facade.
          return view as unknown as JSX.Element
        },
      },
    })
  },
}

export default plugin
