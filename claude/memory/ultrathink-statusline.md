---
name: ultrathink-statusline
description: "Claude Code statusline v2: 4 lines with remaining-% bars, Claude+Codex weekly usage, codex model, recent skills/MCP via PostToolUse hook"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T10:48:54.192Z
---

Statusline for Claude Code, originally a Windows Node port of `InugamiDev/ultrathink-oss`'s
`statusline.sh`, redesigned on 2026-07-31 per user requests (bars show what's LEFT, 4-line layout):

```
✦ Line Terminal · Fable 5 · ctx ▓▓▓▓▓▓▓░░░ 72% · $1.23
  ⚡ claude <Line personal account> · 5h <bar>% · wk <bar>%
  ⚡ codex <teammate A account> · gpt-5.5 xhigh ⚡fast · wk <bar>% ↻ 05/08
  📁 dir · ⎇ branch · ◇ recent-skill · ⚙ recent-mcp-server
```

Brand is "Line Terminal" (user's handle is Line) with a zero-cost animation: frame index =
`Math.floor(Date.now()/400)` picks a star glyph (✦✧✶✧) and phase-shifts a lavender→pink
256-color gradient across the letters — animates only because Claude Code re-runs the
statusline command; no background loop, no lag.

Files: `C:\Users\ASUS\.claude\statusline-ultrathink.js` (render + `--refresh` background mode),
`C:\Users\ASUS\.claude\hooks\track-tools.js` (PostToolUse hook, matcher `mcp__.*|Skill`, logs
`epoch|kind|name` to `%TEMP%\ultrathink-status\tools-<session_id>.log`). Both registered in
`~/.claude/settings.json` (statusLine + hooks.PostToolUse). Cache dir `%TEMP%\ultrathink-status`.

Data sources:
- Claude usage: `api.anthropic.com/api/oauth/usage` (token from `~/.claude/.credentials.json`),
  detached background fetch, cached 60s.
- Codex usage: tail (256KB→2MB) of the newest-mtime `~/.codex/sessions/**/rollout-*.jsonl`
  (+`archived_sessions`), last line containing `"rate_limits"`; bucket `primary`/`secondary` BY
  `window_minutes` (300→5h, 10080→weekly) — the 2026-07 Codex build only writes weekly
  (primary=10080, secondary=null), so don't assume primary=5h. `used_percent` is %-used;
  `resets_at` epoch seconds. Data only updates while Codex runs → rendered DIM when >30 min old.
  ATTRIBUTION CAVEAT (bitten 2026-07-31): rollout files don't record which account produced them.
  A long-running session started under another login (there are two: <teammate A account> =
  google-oauth2/acct <redacted>…, <teammate B account> = auth0/acct <redacted>… in auth.json.[teammate B].bak)
  keeps writing the OLD account's limits — [teammate A] showed 5% left when its real number was 73%.
  Distinguish windows by `resets_at`; a tiny `codex exec` probe refreshes to the active account.
- Codex model/effort/tier: regex over top-level keys of `~/.codex/config.toml`
  (`priority` tier renders as `⚡fast`).
- Accounts: claude email from `~/.claude.json` oauthAccount; codex email from JWT id_token claim
  in `~/.codex/auth.json` (decoded locally, tokens never printed). Cached 10 min.

Windows gotchas encoded in the scripts: stdin via `readSync` loop (readFileSync(0) throws EOF on
pipes), strip UTF-8 BOM before JSON.parse (PowerShell 5.1 pipes add one), and NO `process.exit()`
after fetch in the refresh path (libuv assertion crash on Windows — let the event loop drain).

Also on 2026-07-31: user requested plan mode never prompt for read access → read-only allowlist
added to `~/.claude/settings.json` permissions.allow (read-only git/PowerShell commands, full
context7/sequential-thinking/codegraph servers, and ONLY get_*/list_*/search_*/­*_read GitHub MCP
tools — no writes). Related: [[codex-claude-ecosystem]].


## Update 2026-09-07 (Line request, built by the Codex worker, verified by the supervisor)
- Line 2 now shows the model-scoped weekly limit from the OAuth usage API: `limits[]` entry with `kind == "weekly_scoped"` and `scope.model.display_name` (currently "Fable") renders as `fable wk <bar>`.
- Line 3 dispatch counts are per Claude session: `dispatch-trail.log` lines now carry a 5th field `sessionId` (codex-do.ps1 reads `$env:CLAUDE_CODE_SESSION_ID`; track-tools.js uses hook `session_id`). Statusline filters by its stdin `session_id`; legacy 4-field lines are ignored when a session id exists; with no session id it falls back to the old 8-hour window.
- Render format chosen by Line: one icon per model, total first, effort letters in parentheses, sorted by total: `-> ✦ 12 (h10 m1 l1) ☀ 8 (h5 l3)`. Icons: astra ✦, sol ☀, luna ☾, terra ⊕, codex-rescue ⟲. Effort letters l m h x M u.
- Test hook: env `ULTRATHINK_TRAIL_OVERRIDE=<file>` points the statusline at a fixture trail (read only when set).

## Update 2026-09-08 (context feedback loop, Line approved)
- Statusline writes `%TEMP%\ultrathink-status\ctx-<session_id>.json` = `{pct, ts, model}` on every render.
- New hook `~/.claude/hooks/context-guard.ps1` (UserPromptSubmit, wired in settings.json after the delegation reminder) reads it and injects `[CONTEXT nn% - CHECKPOINT | OFFER HANDOFF | HANDOFF MANDATORY]` at 60/70/80. Silent below 60 or if the cache is older than 15 min. Test override: `ULTRATHINK_CTX_OVERRIDE=<file>`. Self-test: `~/.claude/bin/tests/context-guard-selftest.ps1` (hook under 300 ms).
- Why: Claude cannot see its own context percentage; this session was auto-compacted once mid-task before the hook existed.
