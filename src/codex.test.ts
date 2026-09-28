import { EventEmitter } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { vi } from "vitest"
import { WebSocketServer } from "codex-websocket"
import { CodexService } from "./codex.ts"
import { Logger } from "./logger.ts"

const packageJson = createRequire(import.meta.url)("../package.json") as { version: string }

type TestProcess = EventEmitter & {
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly writes: string[]
  readonly kill: ReturnType<typeof vi.fn>
  readonly unref: ReturnType<typeof vi.fn>
}

describe("CodexService", () => {
  it("reuses a shared WebSocket app-server across OpenCode instances", async () => {
    const socketPath = join(tmpdir(), `ocu-test-${process.pid}-${Date.now()}.sock`)
    const server = createServer()
    const websockets = new WebSocketServer({ server })
    let connections = 0
    const extensions: Array<string | undefined> = []
    server.on("upgrade", (request) => extensions.push(request.headers["sec-websocket-extensions"]))
    websockets.on("connection", (socket) => {
      connections++
      socket.on("message", (data) => {
        const request = JSON.parse(data.toString())
        socket.send(
          JSON.stringify({
            id: request.id,
            result:
              request.method === "initialize"
                ? {}
                : {
                    rateLimits: {
                      primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 123 },
                      secondary: null,
                    },
                    rateLimitsByLimitId: null,
                  },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    const spawn = vi.fn()
    const first = createRuntime({ command: "/tmp/codex", socketPath, spawn, timeoutMs: 500 })
    const second = createRuntime({ command: "/tmp/codex", socketPath, spawn, timeoutMs: 500 })

    try {
      const usage = await Promise.all([readUsage(first), readUsage(second)])
      expect(usage.map((value) => value.fiveHour?.usedPercent)).toEqual([14, 14])
      expect(connections).toBe(2)
      expect(extensions).toEqual([undefined, undefined])
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await first.dispose()
      await second.dispose()
      await new Promise<void>((resolve) => websockets.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("falls back to stdio when a shared server has stale authentication", async () => {
    const socketPath = join(tmpdir(), `ocu-stale-auth-${process.pid}-${Date.now()}.sock`)
    const server = createServer()
    const websockets = new WebSocketServer({ server })
    websockets.on("connection", (socket) => {
      socket.on("message", (data) => {
        const request = JSON.parse(data.toString())
        socket.send(
          JSON.stringify({
            id: request.id,
            ...(request.method === "initialize"
              ? { result: {} }
              : { error: { message: "401 Unauthorized: token_revoked" } }),
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    const direct = createProcess()
    const spawn = vi.fn().mockReturnValueOnce(direct)
    const runtime = createRuntime({ command: "/tmp/codex", socketPath, spawn, timeoutMs: 500 })

    try {
      const usagePromise = readUsage(runtime)
      void usagePromise.catch(() => undefined)
      const initialize = await waitForRequest(direct)
      expect(initialize.method).toBe("initialize")
      direct.stdout.write(`${JSON.stringify({ id: initialize.id, result: {} })}\n`)
      const rateLimits = await waitForRequest(direct)
      expect(rateLimits.method).toBe("account/rateLimits/read")
      direct.stdout.write(
        `${JSON.stringify({
          id: rateLimits.id,
          result: {
            rateLimits: { primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 123 }, secondary: null },
            rateLimitsByLimitId: null,
          },
        })}\n`,
      )
      await expect(usagePromise).resolves.toMatchObject({ fiveHour: { usedPercent: 14 } })
      expect(spawn).toHaveBeenCalledOnce()
      expect(spawn).toHaveBeenCalledWith("/tmp/codex", ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
      })
    } finally {
      await runtime.dispose()
      await new Promise<void>((resolve) => websockets.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("falls back to stdio when the shared Unix socket is unavailable", async () => {
    const direct = createProcess()
    const socketPath = join(tmpdir(), `ocu-missing-${process.pid}-${Date.now()}.sock`)
    const spawn = vi.fn().mockReturnValueOnce(createProcess()).mockReturnValueOnce(direct)
    const runtime = createRuntime({ command: "/tmp/codex", socketPath, spawn, timeoutMs: 100 })

    try {
      const usagePromise = readUsage(runtime)
      await waitForSpawnCall(spawn, 2)

      expect(spawn).toHaveBeenNthCalledWith(1, "/tmp/codex", ["app-server", "--listen", `unix://${socketPath}`], {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      })
      expect(spawn).toHaveBeenNthCalledWith(2, "/tmp/codex", ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
      })

      const initialize = await waitForRequest(direct)

      expect(initialize).toMatchObject({
        id: "opencode-codex-usage-plugin-1",
        method: "initialize",
        params: {
          clientInfo: {
            version: packageJson.version,
          },
        },
      })
      direct.stdout.write(`${JSON.stringify({ id: 1, method: "currentTime/read", params: {} })}\n`)
      await nextTick()

      const serverResponse = await waitForRequest(direct)
      expect(serverResponse).toMatchObject({
        id: 1,
        result: {
          unixTimestampMs: expect.any(Number),
        },
      })

      direct.stdout.write(`${JSON.stringify({ id: initialize.id, result: {} })}\n`)
      await nextTick()
      const rateLimits = await waitForRequest(direct)
      expect(rateLimits.id).toBe("opencode-codex-usage-plugin-2")
      expect(rateLimits.method).toBe("account/rateLimits/read")

      direct.stdout.write(
        `${JSON.stringify({
          id: rateLimits.id,
          result: {
            rateLimits: {
              primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 123 },
              secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: 456 },
            },
            rateLimitsByLimitId: null,
          },
        })}\n`,
      )
      await nextTick()

      await expect(usagePromise).resolves.toMatchObject({
        fiveHour: { label: "5h", usedPercent: 14, resetsAt: 123 },
        weekly: { label: "weekly", usedPercent: 42, resetsAt: 456 },
      })
    } finally {
      await runtime.dispose()
      expect(direct.kill).toHaveBeenCalledOnce()
    }
  })

  it("cleans up a stdio app-server that does not answer initialize", async () => {
    const direct = createProcess()
    const spawn = vi.fn().mockReturnValueOnce(createProcess()).mockReturnValueOnce(direct)
    const runtime = createRuntime({ command: "/tmp/codex", socketPath: "/tmp/ocu-timeout.sock", spawn, timeoutMs: 50 })

    try {
      await expect(readUsage(runtime)).rejects.toMatchObject({
        _tag: "CodexService.RequestTimeoutError",
        method: "initialize",
      })
      expect(direct.kill).toHaveBeenCalledOnce()
    } finally {
      await runtime.dispose()
    }
  })

  it("fails before spawning when the Codex command is missing", async () => {
    const spawn = vi.fn()
    const runtime = createRuntime({ commandExists: () => false, spawn, timeoutMs: 1_000 })

    try {
      await expect(readUsage(runtime)).rejects.toMatchObject({ _tag: "CodexService.CommandMissingError" })
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })

  it("fails with an invalid payload error when Codex changes the response shape", async () => {
    const direct = createProcess()
    const spawn = vi.fn().mockReturnValueOnce(createProcess()).mockReturnValueOnce(direct)
    const runtime = createRuntime({ command: "/tmp/codex", socketPath: "/tmp/ocu-invalid.sock", spawn, timeoutMs: 100 })

    try {
      const usagePromise = readUsage(runtime)
      void usagePromise.catch(() => undefined)
      await waitForSpawnCall(spawn, 2)
      const initialize = await waitForRequest(direct)
      direct.stdout.write(`${JSON.stringify({ id: initialize.id, result: {} })}\n`)
      await nextTick()
      const rateLimits = await waitForRequest(direct)
      direct.stdout.write(
        `${JSON.stringify({
          id: rateLimits.id,
          result: {
            rateLimits: {
              primary: { usedPercent: "bad", windowDurationMins: 300, resetsAt: 123 },
              secondary: null,
            },
            rateLimitsByLimitId: null,
          },
        })}\n`,
      )
      await nextTick()

      await expect(usagePromise).rejects.toMatchObject({ _tag: "CodexService.InvalidPayloadError" })
    } finally {
      await runtime.dispose()
    }
  })
})

describe("CodexService.resolveCodexCommand", () => {
  it("uses an explicit environment override", () => {
    expect(CodexService.resolveCodexCommand(() => false, { OPENCODE_CODEX_USAGE_COMMAND: "/tmp/codex" })).toBe(
      "/tmp/codex",
    )
  })

  it("uses the bundled Codex app binary when it exists", () => {
    expect(
      CodexService.resolveCodexCommand((command) => command === "/Applications/Codex.app/Contents/Resources/codex", {}),
    ).toBe("/Applications/Codex.app/Contents/Resources/codex")
  })

  it("uses a known CLI path", () => {
    expect(CodexService.resolveCodexCommand((command) => command === "/opt/homebrew/bin/codex", {})).toBe(
      "/opt/homebrew/bin/codex",
    )
  })

  it("uses PATH lookup when no absolute candidate exists", () => {
    expect(CodexService.resolveCodexCommand((command) => command === "codex", {})).toBe("codex")
  })

  it("returns null when no Codex command exists", () => {
    expect(CodexService.resolveCodexCommand(() => false, {})).toBeNull()
  })
})

function createRuntime(options: CodexService.Options) {
  return ManagedRuntime.make(CodexService.layer(options).pipe(Layer.provideMerge(Logger.noopLayer)))
}

function readUsage(runtime: ReturnType<typeof createRuntime>) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const codex = yield* CodexService.Service
      return yield* codex.readUsage()
    }),
  )
}

function createProcess(): TestProcess {
  const stdin = new PassThrough()
  const writes: string[] = []
  stdin.on("data", (chunk: Buffer | string) => writes.push(chunk.toString()))

  return Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    writes,
    kill: vi.fn(() => undefined),
    unref: vi.fn(() => undefined),
  })
}

async function waitForRequest(child: TestProcess): Promise<Record<string, unknown>> {
  for (let i = 0; i < 20; i++) {
    const chunks = child.writes.shift()
    if (chunks) return JSON.parse(chunks)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Expected a request.")
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitForSpawnCall(spawn: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (spawn.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${count} spawn call(s).`)
}
