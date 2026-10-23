import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  naming: "tui.js",
  target: "bun",
  format: "esm",
  external: ["@opencode/plugin", "effect", "@opentui/core", "@opentui/solid", "solid-js"],
  minify: false,
  plugins: [createSolidTransformPlugin()],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const output = await result.outputs[0].text()
if (/jsxDEV|jsx-runtime/.test(output) || !/effect as _\$effect/.test(output) || !/insert as _\$insert/.test(output)) {
  throw new Error("TUI build must contain reactive Solid bindings, not eager JSX runtime calls")
}

mkdirSync("dist", { recursive: true })
// Local directory loading in OpenCode 2.1.3 resolves <directory>/tui,
// whereas npm loading resolves the package's ./tui export.
for (const [entry, contents] of [
  ["dist/tui.js", output],
  ["tui.js", 'export { default } from "./dist/tui.js"\n'],
]) {
  const temporary = `${entry}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, contents)
    renameSync(temporary, entry)
  } finally {
    rmSync(temporary, { force: true })
  }
}
