---
name: codex-multi-turn
description: "2026-10-01 multi-turn worker design after codex mcp-server removal — codex-do -Resume, rescue plugin backslash bug, resume rules"
metadata:
  node_type: memory
  type: project
  originSessionId: 9735a2d7-8039-4e01-be5c-698d96e69807
  modified: 2026-10-01T02:51:32.168Z
---

2026-10-01: `codex mcp-server` removed in Codex CLI 0.154.0 (deprecated 0.149.1). Line approved removing the codex entry from `~/.claude.json` (backup `D:\Backups\claude.json.bak-20261001-0931`); MCP-GUIDE.md row marked RETIRED. Worker paths now: (1) `codex-do.ps1` (`codex exec`), (2) codex-rescue plugin (`codex app-server` over a named pipe).

Multi-turn = resume, not MCP. `codex-do.ps1 -Resume <uuid|last>` runs `codex exec resume` (no -s/-C on resume; sandbox via `-c sandbox_mode=`, workdir via process cwd). Every run prints `session: <uuid>`, matched by session_meta cwd == -Dir because concurrent workers share the sessions folder (a newest-file heuristic picked another worker's run in the live test). Backup of the pre-change script: `D:\Backups\codex-do.ps1.bak-20261001-resume`.

Rules (community consensus from X/dev.to/GitHub research, Line approved): resume only for the same packet (STOP RULE answer, fix after FAIL); new packet = fresh session; reviewers always fresh; 3 resumes max then fresh.

Rescue plugin gotcha: the forwarder strips backslashes from prompts, so Windows paths must use forward slashes. `--resume` keeps memory (verified).

**How to apply:** Use -Resume when a worker STOPs or fails review instead of a cold re-dispatch. Use forward slashes in every codex-rescue prompt. Related: [[codex-gpt6-astra]], [[review-gate]], [[account-switcher]].
