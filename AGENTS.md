# AGENTS.md

# Module shape

Do not use `export namespace Foo { ... }` for module organization. It is not
standard ESM, it prevents tree-shaking, and it breaks Node's native TypeScript
runner. Use flat top-level exports combined with a self-reexport at the bottom
of the file:

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@api/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

export * as Foo from "./foo"
```

Consumers import the namespace projection:

```ts
import { Foo } from "@/foo/foo"

yield * Foo.Service
Foo.layer
Foo.defaultLayer
```

Namespace-private helpers stay as non-exported top-level declarations in the
same file — they remain inaccessible to consumers (they are not projected by
`export * as`) but are usable by the file's own code.

## When the file is an `index.ts`

If the module is `foo/index.ts` (single-namespace directory), use `"."` for
the self-reexport source rather than `"./index"`:

```ts
// src/foo/index.ts
export const thing = ...

export * as Foo from "."
```

## Multi-sibling directories

For directories with several independent modules (e.g. `src/session/`,
`src/config/`), keep each sibling as its own file with its own self-reexport,
and do not add a barrel `index.ts`. Consumers import the specific sibling:

```ts
import { SessionRetry } from "@/session/retry"
import { SessionStatus } from "@/session/status"
```

Barrels in multi-sibling directories force every import through the barrel to
evaluate every sibling, which defeats tree-shaking and slows module load.

# Effect rules

Use these rules when writing Effect code.

## Core

- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects; reserve `Effect.fnUntraced` for measured low-level hot paths.
- `Effect.fn` / `Effect.fnUntraced` accept pipeable operators as extra arguments, so avoid unnecessary outer `.pipe()` wrappers.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void` instead of `Effect.succeed(undefined)` or `Effect.succeed(void 0)`.
- Prefer `DateTime.nowAsDate` over `new Date(yield* Clock.currentTimeMillis)` when you need a `Date`.

## Schemas and errors

- Use `Schema.Class` for multi-field data.
- Use branded schemas (`Schema.brand`) for single-value types.
- Use `Schema.TaggedError` for typed errors with the host's Effect 4.0.1.
- Use `Schema.Defect` instead of `unknown` for defect-like causes.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))` for direct early-failure branches.

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `pnpm effect-solutions list` to see available guides
2. Run `pnpm effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect References

The Effect source is cloned to `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol` for implementation details when local guides and installed package types are not enough.

The OpenCode repository at `~/.local/share/opencode/repos/github.com/anomalyco/opencode` has useful examples for structuring an Effect codebase.

# OpenCode plugin rules

- V2 CLI plugin shape: default export `Plugin.define({ id, setup })` from `@opencode/plugin/tui`. Source is `src/tui.tsx`; load from global `cli.json`, never server config. Use `api.data`, `api.ui.slot`, and `api.theme.text`.
- Keep line 1 of every `.tsx` file `/** @jsxImportSource @opentui/solid */`. Use Solid JSX and reactive property reads, never React hooks or destructured reactive props. Every falsifiable `<Show>` in a box slot needs an element fallback; slots always return an element.
- `pnpm check` runs typecheck, Vitest unit tests, and the fresh packed-consumer render/update/error/gating/cleanup test. Packed UI tests use the real host Effect runtime with an injected CodexService fixture; the separate Bun transport regression uses an isolated socket.
- `pnpm build` Solid-transforms `src/tui.tsx` into `dist/tui.js` and generates an ignored root `tui.js` bridge for OpenCode 2.1.3 local-directory loading. Both files are atomically replaced; never commit generated output. npm publishes only `dist` through the sole `./tui` export. Do not also load a global discovery wrapper.
- V2 no longer exposes `client.app.log`; CLI diagnostics use `console.debug/info/warn/error`.
- The Codex transport uses OpenCode's host `effect@4.0.1` runtime. Keep Effect in `devDependencies` and external to the bundle; never ship a private runtime. Tests use `@effect/vitest@4.0.1` with Vitest 5. The packed test supplies host Effect to a fresh dependency-free consumer.
- Keep `codex-websocket` (the Node `ws` alias) in `devDependencies` and bundled. Under Bun, use its native `ws` client with an explicit Unix URL: both its native client and `node:http` ignore `createConnection`. The Node client is the only allowed bundled third-party package; the packed test guards host runtime imports and verifies actual Bun Unix WebSocket reuse.
- OpenCode server logs are written under `~/.local/share/opencode/log/opencode.log`.
- Start OpenCode with `OPENCODE_LOG_LEVEL=DEBUG` for diagnostic logging; `logLevel` is not a supported V2 configuration field.
