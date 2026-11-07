---
name: account-switcher
description: Codex multi-account switcher codex-acc.ps1 (built 2026-09-28) and Claude-side findings; why auth snapshots fail
metadata:
  node_type: memory
  type: project
  originSessionId: 9735a2d7-8039-4e01-be5c-698d96e69807
  modified: 2026-09-28T11:41:31.567Z
---

Codex side DONE 2026-09-28: `~/.claude/bin/codex-acc.ps1` (+ `codex-acc-lib.ps1`). One CODEX_HOME per account under `~/.codex-accounts/<name>`; main = `~/.codex` (<team shared account> Pro). `add` copies config/AGENTS/.sandbox/.sandbox-bin + junctions skills/rules, then `codex login` in that home. `use` writes `~/.codex-accounts/active`; codex-do/codex-review read it or take `-Account`; statusline shows `codex [name]`. Backup of pre-install scripts: `D:\Backups\acc-switcher-pre-20260928-1840`.

Line's choices: manual switching only (no auto threshold); only Line's own accounts (acc1 = [teammate A]'s, excluded; acc2 = stale devteam copy, never use). Names main/acc1/acc2 reserved.

Why: auth.json snapshots die — OpenAI rotates refresh tokens (acc1 got 401 invalid_refresh_token 28/9).

Claude side NOT built (Line: "Codex first"). Findings: `CLAUDE_CONFIG_DIR` isolates login (tested: fresh dir = "Not logged in"). No documented in-session account switch. Feasible design: per-account config dir sharing projects/settings/hooks/skills via junctions, switch = exit + `claude --resume <id>` under the other dir (~5-10 s, context kept). Do not hot-swap `.credentials.json` in a live session.

**How to apply:** Line adds accounts with `codex-acc.ps1 add <name>` (browser login once). When Line asks for the Claude side, start from the design above. Related: [[codex-gpt6-astra]], [[codex-sandbox-acl-corruption]].
