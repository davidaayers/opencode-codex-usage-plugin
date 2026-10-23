// The CLI provides its own Effect version for bare imports. Bundle the transport's
// private beta runtime, but leave renderer imports to the host's shared instance.
const result = await Bun.build({
  entrypoints: ["./src/tui.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "external",
  external: ["@opentui/core", "@opentui/solid", "solid-js", "@opencode/plugin", "@opencode/theme"],
})
if (!result.success) throw new AggregateError(result.logs, "Codex plugin build failed")
