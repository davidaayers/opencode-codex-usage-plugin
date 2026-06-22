# Effect Source Setup

This setup task is required when `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol` is missing.

## Prompt

The local Effect source checkout was not found at `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol`.

Create it before continuing:

```sh
mkdir -p ~/.local/share/opencode/repos/github.com/Effect-TS
git clone https://github.com/Effect-TS/effect-smol ~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol
```

## Supported Options

### Local Clone

Use this global checkout for local research without modifying the host repository.

- Repo path: `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol`
- Source: `https://github.com/Effect-TS/effect-smol`

#### Concrete Shape

Use this exact shape for the setup. Do not modify the host repository.

```sh
#!/usr/bin/env sh

set -eu

repo_dir="$HOME/.local/share/opencode/repos/github.com/Effect-TS/effect-smol"
repo_url="https://github.com/Effect-TS/effect-smol"

if [ -d "$repo_dir/.git" ]; then
  exit 0
fi

mkdir -p "$(dirname "$repo_dir")"
git clone "$repo_url" "$repo_dir"
```

#### Notes

- This keeps `~/.local/share/opencode/repos/github.com/Effect-TS/effect-smol` available for local research without forcing it into version control
- The script is only responsible for ensuring the checkout exists; it does not update or reset an existing clone

## Guidance

- Do not continue with Effect-specific work until the global checkout exists.
