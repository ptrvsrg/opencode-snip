# opencode-snip

OpenCode plugin that automatically prefixes shell commands with [snip](https://github.com/edouard-claude/snip) to reduce LLM token consumption by 60-90%.

## What is snip?

[snip](https://github.com/edouard-claude/snip) is a CLI proxy that filters shell output before it reaches your LLM context window.

| Command | Before | After | Savings |
|---------|--------|-------|---------|
| `go test ./...` | 689 tokens | 16 tokens | 97.7% |
| `git log` | 371 tokens | 53 tokens | 85.7% |
| `cargo test` | 591 tokens | 5 tokens | 99.2% |

## Installation

### 1. Install snip

```bash
brew install edouard-claude/tap/snip
# or
go install github.com/edouard-claude/snip/cmd/snip@latest
```

### 2. Configure OpenCode

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-snip@latest"]
}
```

## How It Works

The plugin uses the `tool.execute.before` hook to prefix all commands with `snip`

## Reducing snip noise

When snip can't find a filter for a command, it prints:

```
snip: no filter for "X", passing through
```

This message comes from the snip binary itself, not from this plugin. To silence it, create or edit `~/.config/snip/config.toml`:

```toml
[display]
quiet_no_filter = true
```

snip has no `--quiet` flag and no `SNIP_QUIET` environment variable. The TOML config is the only way to suppress these messages.

If you keep multiple snip configs, the `SNIP_CONFIG` environment variable lets you point to an alternate file:

```bash
export SNIP_CONFIG=/path/to/my/config.toml
```

## Platform support

This plugin targets POSIX shells (bash/zsh on Linux and macOS). On Windows without WSL, `command -v snip` returns nothing, so the plugin disables itself cleanly and returns an empty hook — no error, no crash.

PowerShell, cmd, and Windows-native path constructs (`$env:`, backslash paths, `.exe` suffixes, `.venv\Scripts\activate`) are not supported.

WSL2 users can use the plugin normally, since WSL2 provides a full POSIX shell environment.

Windows users running native PowerShell or cmd should skip enabling this plugin.

## Plugin configuration

By default, every command gets prefixed with `snip`. You can control which commands are wrapped using the `skip` and `only` options.

Pass options via the tuple form in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-snip@latest", { "skip": ["git"], "only": [] }]
  ]
}
```

**`skip`** — a list of command names to exclude from snip. Useful when snip's output filtering breaks tool behavior that depends on exact output (for example, `git` credential helpers or interactive prompts):

```json
{ "skip": ["git", "ssh"] }
```

**`only`** — if non-empty, only the listed commands get prefixed with snip. All other commands pass through unchanged:

```json
{ "only": ["go", "cargo", "npm"] }
```

When both are set, `only` takes precedence over `skip`. Matching is exact on the first token of the command — no glob patterns or wildcards.

This is the supported fix for issues where granular bash permissions break when snip is prepended to commands that rely on precise output parsing.

## Development

This package uses [semantic-release](https://semantic-release.gitbook.io/) for automated releases. Commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

- `fix:` → patch release
- `feat:` → minor release
- `feat!:`, `fix!:` → major release

## License

MIT
