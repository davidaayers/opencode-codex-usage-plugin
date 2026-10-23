import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import * as effectRuntime from "effect"
import * as tuiRuntime from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { CodexService } from "./src/codex.ts"

test("packed V2 Codex plugin mounts, gates providers, and disposes its runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-usage-pack-"))
  const previousCommand = process.env.OPENCODE_CODEX_USAGE_COMMAND
  process.env.OPENCODE_CODEX_USAGE_COMMAND = join(directory, "missing-codex")
  let setup
  let cleanup
  const frames = {}
  const capture = (name) => {
    frames[name] = setup.captureCharFrame()
  }
  try {
    // Keep the language-service prepare hook's stdout out of npm's JSON result.
    execFileSync("pnpm", ["build"], { cwd: import.meta.dir })
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
        cwd: import.meta.dir,
        encoding: "utf8",
      }),
    )
    const consumer = join(directory, "consumer")
    execFileSync("npm", [
      "install",
      "--prefix",
      consumer,
      "--no-save",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(directory, packed[0].filename),
    ])
    const installed = join(consumer, "node_modules", "@davidaayers", "opencode-codex-usage-plugin")
    const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
    expect(pkg.dependencies).toBeUndefined()
    expect(existsSync(join(consumer, "node_modules/effect"))).toBe(false)
    expect(pkg.exports).toEqual({ "./tui": "./dist/tui.js" })
    expect(pkg.engines.opencode).toBe(">=2.1.3 <3")
    expect(packed[0].files.filter((file) => file.path.startsWith("dist/")).map((file) => file.path)).toEqual([
      "dist/tui.js",
    ])
    const local = Bun.resolveSync(join(import.meta.dir, "tui"), import.meta.dir)
    expect(local).toBe(join(import.meta.dir, "tui.js"))
    expect(packed[0].files.map((file) => file.path)).not.toContain("tui.js")
    const entrypoint = readFileSync(join(installed, pkg.exports["./tui"]), "utf8")
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(entrypoint)
    expect(imports.some((entry) => entry.path === "effect")).toBe(true)
    for (const hostImport of ["@opencode/plugin/tui", "@opentui/core", "@opentui/solid", "solid-js"]) {
      expect(imports.some((entry) => entry.path === hostImport)).toBe(true)
    }
    expect(entrypoint).not.toMatch(/node_modules\/|effect\/dist\/|jsxDEV|jsx-runtime/)
    expect(Buffer.byteLength(entrypoint)).toBeLessThan(100_000)
    // Keep the real host Effect/ManagedRuntime and renderer, but override the
    // CodexService layer by its stable key. No UI fixture contacts a real socket
    // or spawns Codex. The real transport regression below remains uninjected.
    const { Context, Effect, Layer, ManagedRuntime } = effectRuntime
    let usage = {
      fiveHour: { label: "5h", usedPercent: 42, resetsAt: null },
      weekly: { label: "weekly", usedPercent: 81, resetsAt: null },
    }
    let failure
    let reads = 0
    let hold = true
    let resumeRead
    let disposed = 0
    const result = () => (failure ? Effect.fail(failure) : Effect.succeed(usage))
    const fixtureLayer = Layer.effect(
      Context.Service("CodexService"),
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            disposed++
          }),
        )
        return {
          readUsage: () =>
            Effect.callback((resume) => {
              reads++
              if (hold) resumeRead = resume
              else resume(result())
            }),
          dispose: () => Effect.void,
        }
      }),
    )
    ensureRuntimePluginSupport({
      additional: {
        "@opencode/plugin/tui": tuiRuntime,
        effect: {
          ...effectRuntime,
          ManagedRuntime: {
            ...ManagedRuntime,
            make: (layer) => ManagedRuntime.make(Layer.merge(layer, fixtureLayer)),
          },
        },
      },
    })
    const plugin = (await import(join(installed, pkg.exports["./tui"]))).default
    const localPlugin = (await import(local)).default
    expect(localPlugin.id).toBe(plugin.id)
    expect(typeof localPlugin.setup).toBe("function")
    expect(plugin.id).toBe("opencode-codex-usage")
    const slots = new Map()
    const listeners = new Set()
    const color = RGBA.fromHex("#ffffff")
    const feedback = Object.fromEntries(["success", "warning", "error"].map((key) => [key, { base: color }]))
    const [providerID, setProviderID] = createSignal("other")
    const [messages, setMessages] = createSignal([])
    let toasts = 0
    let parentID
    const api = {
      options: { compact: true },
      ui: {
        slot: (entry) => {
          slots.set(entry.append, entry.render)
          return () => slots.delete(entry.append)
        },
        model: { current: () => undefined },
        toast: {
          show() {
            toasts++
          },
        },
      },
      data: {
        listen: (callback) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        session: {
          get: () => ({ parentID, model: { providerID: providerID(), id: "fixture" } }),
          message: { list: () => messages() },
        },
      },
      theme: { text: { base: color, muted: color, action: { primary: { base: color } }, feedback } },
      renderer: { requestRender() {} },
    }
    cleanup = await plugin.setup(api)
    expect([...slots.keys()]).toEqual(["sidebar.content", "prompt.footer.status"])
    setup = await testRender(() => slots.get("sidebar.content")({ sessionID: "test" }), { width: 42, height: 5 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Codex Usage")
    capture("other-provider")
    expect(reads).toBe(0)
    const refresh = () => {
      for (const listener of listeners)
        listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
    }
    const waitFor = async (check) => {
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await setup.renderOnce()
        if (check()) return
      }
      throw new Error(`Timed out waiting for packed render:\n${setup.captureCharFrame()}`)
    }
    setProviderID("openai")
    refresh()
    await waitFor(() => reads > 0)
    expect(setup.captureCharFrame()).toContain("Loading...")
    capture("loading")
    hold = false
    resumeRead(result())
    await waitFor(() => setup.captureCharFrame().includes("81%"))
    expect(setup.captureCharFrame()).toContain("42%")
    expect(setup.captureCharFrame()).toContain("Codex Usage")
    capture("two-gauges")
    usage = { ...usage, weekly: { ...usage.weekly, usedPercent: 91 } }
    refresh()
    await waitFor(() => setup.captureCharFrame().includes("91%"))
    capture("updated-gauges")
    expect(reads).toBeGreaterThanOrEqual(2)
    failure = { _tag: "CodexService.CommandMissingError", message: "Fixture Codex missing" }
    refresh()
    await waitFor(() => setup.captureCharFrame().includes("Fixture Codex missing"))
    expect(toasts).toBe(1)
    capture("error")
    refresh()
    await waitFor(() => reads >= 4)
    expect(toasts).toBe(1)
    failure = undefined
    usage = { fiveHour: null, weekly: { label: "weekly", usedPercent: 4, resetsAt: null } }
    refresh()
    await waitFor(() => setup.captureCharFrame().includes("4%"))
    expect(setup.captureCharFrame()).toContain("week █▏" + "░".repeat(26))
    expect(setup.captureCharFrame()).not.toContain("5h")
    capture("weekly-only")
    // The last assistant provider takes precedence over the prompt model.
    setMessages([{ type: "assistant", model: { providerID: "other" } }])
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Codex Usage")
    const before = reads
    refresh()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(reads).toBe(before)
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)

    setMessages([])
    setup = await testRender(() => slots.get("prompt.footer.status")({ sessionID: "test" }), { width: 80, height: 3 })
    await waitFor(() => setup.captureCharFrame().includes("Codex weekly 4%"))
    usage = { ...usage, weekly: { ...usage.weekly, usedPercent: 77 } }
    refresh()
    await waitFor(() => setup.captureCharFrame().includes("Codex weekly 77%"))
    capture("compact")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)

    api.options.compact = false
    const beforeWide = reads
    setup = await testRender(() => slots.get("prompt.footer.status")({ sessionID: "test" }), { width: 160, height: 3 })
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(setup.captureCharFrame().trim()).toBe("")
    expect(reads).toBe(beforeWide)
    capture("wide-footer-hidden")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)

    setup = await testRender(() => slots.get("prompt.footer.status")({ sessionID: "test" }), { width: 100, height: 3 })
    await waitFor(() => setup.captureCharFrame().includes("Codex weekly 77%"))
    capture("narrow-footer")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)

    parentID = "parent"
    setup = await testRender(() => slots.get("prompt.footer.status")({ sessionID: "test" }), { width: 160, height: 3 })
    await waitFor(() => setup.captureCharFrame().includes("Codex weekly 77%"))
    capture("child-footer")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)

    setup = await testRender(() => slots.get("prompt.footer.status")({}), { width: 80, height: 3 })
    await setup.renderOnce()
    expect(setup.captureCharFrame().trim()).toBe("")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)
    await cleanup()
    cleanup = undefined
    expect(slots.size).toBe(0)
    expect(disposed).toBe(1)

    // Exercise Bun's delayed socket-error path with an isolated socket, never
    // the user's real shared app-server. This used to emit an unhandled ENOENT.
    // Source-level Bun regression: internal transport modules are no longer
    // published as separate files by the single-bundle canonical build.
    const runtime = ManagedRuntime.make(
      CodexService.layer({
        command: join(directory, "missing-codex"),
        socketPath: join(directory, "isolated.sock"),
        timeoutMs: 100,
      }),
    )
    try {
      await expect(
        runtime.runPromise(
          Effect.gen(function* () {
            const service = yield* CodexService.Service
            return yield* service.readUsage()
          }),
        ),
      ).rejects.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      await runtime.dispose()
    }
  } finally {
    setup?.renderer.destroy()
    await cleanup?.()
    if (previousCommand === undefined) delete process.env.OPENCODE_CODEX_USAGE_COMMAND
    else process.env.OPENCODE_CODEX_USAGE_COMMAND = previousCommand
    if (process.env.OPENCODE_TEST_EVIDENCE_DIR) {
      writeFileSync(
        join(process.env.OPENCODE_TEST_EVIDENCE_DIR, "codex-packed-frames.json"),
        JSON.stringify(frames, null, 2),
      )
    }
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
