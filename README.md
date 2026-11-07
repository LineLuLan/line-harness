# Line Harness

Line's agent-coding setup on Windows 11: Claude Code as the supervisor, the Codex CLI as the worker, plus the hooks, skills, status line, and terminal configuration that hold them together.

This repository is a working backup of a real machine. You can read it to learn the setup, or restore it on a new machine with `restore.ps1`.

## How it works

1. Claude Code (the supervisor) plans the work, writes a task packet, and reviews the result.
2. The Codex CLI (the worker) implements the packet in a sandbox, through `claude/bin/codex-do.ps1`.
3. A review gate checks every change: deterministic gates, a fresh-session model review, then supervisor verification.
4. Hooks enforce the rules every turn: delegation reminder, context guard, Bash heredoc guard, docs-check guard, git-push guard.

The full operating policy is in `codex/AGENTS.md` (shared rules) and `claude/CLAUDE.md` (Claude-side detail).

## Layout

| Path | Restores to | Contents |
| --- | --- | --- |
| `claude/CLAUDE.md`, `claude/settings.json` | `~/.claude/` | Claude Code rules and settings (hooks, model, status line) |
| `claude/bin/` | `~/.claude/bin/` | Worker dispatch (`codex-do.ps1`), review gate (`codex-review.ps1`), Codex account switcher, sandbox preflight, run notifications, weekly MCP updater, self-tests |
| `claude/hooks/` | `~/.claude/hooks/` | PreToolUse, UserPromptSubmit, PostToolUse, Stop, and SessionStart hooks |
| `claude/statusline-ultrathink.js` | `~/.claude/` | UltraThink status line: model, context, quotas, worker runs |
| `claude/commands/`, `claude/skills/` | `~/.claude/` | Slash commands and the installed skill bank |
| `claude/memory/` | `~/.claude/projects/<project>/memory/` | Persistent memory notes (reference only, machine-specific) |
| `claude/mcp-servers.json` | `mcpServers` in `~/.claude.json` | MCP server definitions (tokens removed) |
| `claude/plugins/` | `~/.claude/plugins/` | Installed plugin and marketplace lists |
| `codex/AGENTS.md`, `codex/config.toml`, `codex/hooks.json` | `~/.codex/` | Codex rules, configuration, and hooks |
| `codex/hooks/`, `codex/rules/`, `codex/skills/`, `codex/skills-archive/` | `~/.codex/` | Codex hooks, rules, active and archived skills |
| `home/AGENTS.md` | `~/AGENTS.md` | Codex adapter for the home directory |
| `terminal/windows-terminal-settings.json` | Windows Terminal `LocalState/settings.json` | Windows Terminal profiles and theme |
| `scheduled-tasks/*.xml` | Task Scheduler | Weekly MCP update and Docker RAM tracker (headless through `conhost.exe --headless`) |

## Restore on a new machine

Requirements: Windows 11, PowerShell 5.1, Node.js, Git, the Claude Code CLI, and the Codex CLI.

```powershell
git clone https://github.com/LineLuLan/line-harness.git
cd line-harness
powershell -NoProfile -ExecutionPolicy Bypass -File .\restore.ps1          # dry run: shows what would be copied
powershell -NoProfile -ExecutionPolicy Bypass -File .\restore.ps1 -Apply   # copies files, backs up existing ones first
```

`restore.ps1` does not touch `~/.claude.json`, credentials, or scheduled tasks. Do these steps by hand:

1. Merge `claude/mcp-servers.json` into `~/.claude.json` and set your own tokens.
2. Set the `GITHUB_PAT_TOKEN` environment variable (used by the GitHub MCP server on both sides).
3. Sign in: `claude` and `codex login`.
4. Import a scheduled task: `Register-ScheduledTask -Xml (Get-Content .\scheduled-tasks\MCP-Weekly-Update.xml -Raw) -TaskName MCP-Weekly-Update`.

The configs were captured on a machine whose user folder is `C:\Users\ADMIN`. With `-Apply`, `restore.ps1` rewrites that folder to your own user folder in `~/.claude/settings.json` (hooks and status line), `~/.codex/config.toml`, and `~/.codex/hooks.json`. The rule files (`CLAUDE.md`, `AGENTS.md`) still mention `C:\Users\ADMIN` as text.

The status line's OpenRouter row reads the `OPENROUTER_API_KEY` environment variable. Without it, the row stays empty; the other rows still work.

## What is not in this repository

Credentials (`auth.json`, `.credentials.json`, `.env`), API tokens, conversation transcripts, session logs, and caches. All files were scanned for secrets before publication. The one live token found (a GitHub token in an MCP header) was replaced with `${GITHUB_PAT_TOKEN}`.

## License

MIT. See `LICENSE`.
