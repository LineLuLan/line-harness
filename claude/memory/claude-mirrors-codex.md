---
name: claude-mirrors-codex
description: ".claude is configured to mirror .codex — CLAUDE.md imports AGENTS.md, 5 MCP servers wired, 128 skills copied — so both harnesses share one ecosystem"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 30c9d9e9-21d8-4ba0-bec0-50425ca73863
---

On 2026-06-20 the user had Claude Code's `~/.claude` set up to mirror `~/.codex` for one consistent ecosystem (see [[codex-claude-ecosystem]]). State of the mirror:

- **Rulebook (single source of truth):** `~/.claude/CLAUDE.md` is a thin pointer that `@`-imports `C:/Users/ASUS/.codex/AGENTS.md`. Edit AGENTS.md once → both tools update. CLAUDE.md adds only a Claude-harness tooling-map addendum (MCP names, cx- prefixes, sub-agent mapping). The "Autonomous Founder Engineer" rules in [[codex-agents-rules]] now govern Claude Code too via that import.
- **MCP servers (user scope, in `~/.claude.json` `mcpServers`, all ✔ connected):** `context7`, `sequential-thinking`, `fetch` (env PYTHONIOENCODING=utf-8), `codegraph` — all stdio cmd/npx. `github` — HTTP to `https://api.githubcopilot.com/mcp/`, header `Authorization: Bearer ${GITHUB_PAT_TOKEN}` (env-var reference, not literal token). `codex` — stdio `codex mcp-server` (lets Claude delegate to Codex natively; see [[codex-claude-ecosystem]]). The cmd-based servers use args `["/c","npx.cmd",...]` (note: `claude mcp add` via Git Bash mangles `/c`→`C:/`; fix args directly if re-adding). NOT ported: `node_repl`, `task-inugami` (Codex desktop-runtime only).
- **Skills:** all 128 from `~/.codex/skills` copied to `~/.claude/skills`. Two renamed to avoid colliding with Claude built-ins: `cx-code-review`, `cx-verify`. Router entry point `backend-ai-production-router` is present. To refresh, re-copy from `~/.codex/skills`.
- **Permissions:** mirroring Codex auto-allow (`git add`, `git commit`) into `~/.claude/settings.local.json` was BLOCKED by the auto-mode classifier as self-widening; user must add those allow rules manually if wanted.

**SUPERSEDED 2026-08-08 (go-live):** hand-mirroring is replaced by install-bank.ps1 from the shared bank. Rulebooks replaced: ~/.codex/AGENTS.md = Team Policy v1.0 + Line's personal addendum section 15; ~/.claude/CLAUDE.md = thin machine adapter. Old dotfiles are in the 555MB snapshot zip.
