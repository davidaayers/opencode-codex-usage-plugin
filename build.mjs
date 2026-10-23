// OpenCode supplies Effect and the renderer. Never bundle private runtime copies.
const result = await Bun.build({
  entrypoints: ["./src/tui.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "external",
  external: ["effect", "@opentui/core", "@opentui/solid", "solid-js", "@opencode/plugin", "@opencode/theme"],
})
if (!result.success) throw new AggregateError(result.logs, "Codex plugin build failed")
