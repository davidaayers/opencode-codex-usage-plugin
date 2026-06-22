# opencode-codex-usage-plugin

OpenCode TUI plugin that shows Codex usage and reset times in the sidebar.

## Install

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-codex-usage-plugin"]
}
```

Restart OpenCode after changing the config.

## Requirements

Install either Codex App or the Codex CLI. The plugin looks for Codex in common locations and on your `PATH`.

If your Codex command lives somewhere else, set `OPENCODE_CODEX_USAGE_COMMAND` in your shell config:

```sh
# ~/.zshrc or ~/.bashrc
export OPENCODE_CODEX_USAGE_COMMAND="/path/to/codex"
```

Then reload your shell config or open a new terminal before starting OpenCode.
