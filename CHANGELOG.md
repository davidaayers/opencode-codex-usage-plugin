# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking Changes

- Prepare 1.0.0 for OpenCode 2.x only (minimum 2.1.3; OpenCode 3.x is not supported).
- Replace the V1 plugin API and configuration with `Plugin.define` and global `cli.json` loading.
- OpenCode 1.x users must pin `@davidaayers/opencode-codex-usage-plugin@0.1.2`, the last V1 release published on npm.

### Fixed

- Reuse the shared Unix WebSocket server under Bun using its native client, with safe cleanup after a rejected handshake.

### Changed

- Convert the imperative renderer to Solid JSX with reactive updates, provider gating, compact output, and cleanup verification.
- Use OpenCode's host Effect 4.0.1 runtime instead of bundling a private Effect beta.
- Standardize the compiled `src/tui.tsx` entry, package exports, atomic build, and generated local-directory entry.

## [0.1.2](https://github.com/davidaayers/opencode-codex-usage-plugin/compare/v0.1.1...v0.1.2) (2026-09-28)


### Fixed

* connect to shared Codex server over WebSocket ([afd75e3](https://github.com/davidaayers/opencode-codex-usage-plugin/commit/afd75e3f413554301e8dab6a547184bd5f066379))

## [0.1.1](https://github.com/davidaayers/opencode-codex-usage-plugin/compare/v0.1.0...v0.1.1) (2026-09-05)


### Added

* expand weekly-only usage gauge ([44a87e3](https://github.com/davidaayers/opencode-codex-usage-plugin/commit/44a87e309d5b69fbc15e85be0d8a20512ce62aa5))

## [0.1.0] - 2026-08-28

### Added

- Gauge-style Codex 5-hour and weekly quota display with reset countdowns.
- Compact prompt status for the most constrained usage window.
- Scoped npm package publication as `@davidaayers/opencode-codex-usage-plugin`.

## [0.0.3] - 2026-08-02

### Fixed

- Hide Codex usage windows when their data is unavailable.

## [0.0.2] - 2026-06-26

### Changed

- Exclude the demo GIF from the published package.
