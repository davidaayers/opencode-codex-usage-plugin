import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

test("packed V2 Codex plugin mounts, gates providers, and disposes its runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-usage-pack-"))
  const previousCommand = process.env.OPENCODE_CODEX_USAGE_COMMAND
  process.env.OPENCODE_CODEX_USAGE_COMMAND = join(directory, "missing-codex")
  let setup
  let cleanup
  try {
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
    // The real CLI rewrites bare Effect imports to its host runtime. A plain
    // packed import does not, so explicitly guard the private runtime boundary.
    const entrypoint = readFileSync(join(installed, pkg.exports["./tui"].import), "utf8")
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(entrypoint)
    expect(imports.filter((entry) => entry.path === "effect" || entry.path.startsWith("effect/"))).toEqual([])
    ensureRuntimePluginSupport()
    const plugin = (await import(join(installed, pkg.exports["./tui"].import))).default
    expect(plugin.id).toBe("opencode-codex-usage")
    const slots = new Map()
    const listeners = new Set()
    const color = RGBA.fromHex("#ffffff")
    const feedback = Object.fromEntries(["success", "warning", "error"].map((key) => [key, { base: color }]))
    const providerID = "other"
    const api = {
      options: { compact: true },
      ui: {
        slot: (entry) => {
          slots.set(entry.append, entry.render)
          return () => slots.delete(entry.append)
        },
        model: { current: () => undefined },
        toast: { show() {} },
      },
      data: {
        listen: (callback) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        session: { get: () => ({ model: { providerID, id: "fixture" } }), message: { list: () => [] } },
      },
      theme: { text: { base: color, muted: color, action: { primary: { base: color } }, feedback } },
      renderer: { requestRender() {} },
    }
    cleanup = await plugin.setup(api)
    expect([...slots.keys()]).toEqual(["sidebar.content", "prompt.footer.status"])
    setup = await testRender(() => slots.get("sidebar.content")({ sessionID: "test" }), { width: 42, height: 5 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Codex Usage")
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

    // Exercise Bun's delayed socket-error path with an isolated socket, never
    // the user's real shared app-server. This used to emit an unhandled ENOENT.
    const { CodexService } = await import(join(installed, "dist/codex.js"))
    const { Effect, ManagedRuntime } = await import(join(consumer, "node_modules/effect/dist/index.js"))
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
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
