# Line Hub

A local dashboard that shows how well a Claude Code (supervisor) + Codex (worker) harness performs: quota, tokens, worker runs, review quality, hook health, and per-session traces.

Public code, private data. The database stays at `~/.line-hub/hub.db` and is never committed. It stores numbers and names only, never prompt or answer text and never full paths.

## Parts

| Part | What it does | RAM |
| --- | --- | --- |
| `collector/` | Reads Claude Code transcripts, Codex rollouts and harness state files incrementally into SQLite (`node:sqlite`), then exits | peak < 80 MB; about 0.1 s per hook run |
| `server/` | Read-only HTTP server on `127.0.0.1` that turns the DB into JSON | about 55-72 MB (all pages at 90 days); stops after 30 min idle |
| `web/` | Seven pages (Preact + htm + uPlot, vendored, no build step) | one browser tab |

There is no always-on process. The collector runs from Claude Code `SessionStart` and `Stop` hooks (async), skips if it ran less than 2 minutes ago, and works for at most 20 s per run. Collector internals: [collector/NOTES.md](collector/NOTES.md).

## Use

Requires Node 24.15 or later.

```
npm run collect -- --full   # first import (about 10 s for 1.6 GB of logs)
npm run hub                 # start the dashboard and open the browser
npm test                    # node --test "tests/*.test.js"
npm run bench               # collector RAM bench (peak RSS < 80 MB)
```

Hook entry (in `~/.claude/settings.json`, under `SessionStart` and `Stop`):

```json
{ "type": "command", "command": "node \"<path>/hub/collector/collect.js\" --hook", "async": true, "timeout": 30 }
```

## Environment

| Variable | Default |
| --- | --- |
| `LINE_HUB_DB` | `~/.line-hub/hub.db` |
| `LINE_HUB_CLAUDE_DIR` | `~/.claude` |
| `LINE_HUB_CODEX_DIR` | `~/.codex` |
| `LINE_HUB_STATE_DIR` | `<CLAUDE_DIR>/state` |
| `LINE_HUB_STATUS_DIR` | `<tmp>/ultrathink-status` |
| `LINE_HUB_PORT` | `3434` |
| `LINE_HUB_IDLE_MIN` | `30` |

## Server safety

- Listens on `127.0.0.1` only and rejects any `Host` header other than `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard).
- GET and HEAD only. Static files come from a fixed allowlist; no URL path is joined to a file path.
- CSP `default-src 'self'`; the one inline script (the import map) is allowed by its SHA-256 hash.
- Opens the DB read-only and never creates it.

## Notes on metrics

- Codex `input_tokens` already include `cached_input_tokens`. The dashboard shows fresh input = input - cached, so Claude and Codex totals add up the same way.
- "Clean first time" = a ledger task whose L1, L2 and L3 found nothing and did not FAIL.
- "Supervisor / worker" compares Claude output tokens with Codex output tokens. It is an estimate.
- A run with no exit code after 2 days shows as lost in Trace. Exit-0 rates count finished runs only.
- "Repo" is the folder that holds the nearest `.git` above the working folder (so `<repo>/datasets` counts as `<repo>`). For Codex sessions the last segment of the git remote URL wins; the remote owner is never stored. Only folder names are stored, never paths.
- Branch comes from the logs themselves: Claude `gitBranch` (the newest line of a session wins) and Codex `session_meta.git.branch`. `HEAD` means a detached checkout.
- Schema v5 replays every source once on upgrade (about 10 s for 1.6 GB; peak about 85 MB for that one run).

## Supervisor page

The Supervisor page tracks Claude only, from data the collector already stores: hands-on edits (Edit / Write) vs Codex dispatches and Agent calls per day, session weight (messages, tokens, peak context, human turns, compactions), skills / sub-agents / MCP servers, review catch by layer (L1 / L2 / L3, FAIL rounds), and the Opus / Fable / other model split. A question with no data shows which table is empty; nothing is estimated.

Two radars compare Claude (kafka purple, solid) with Codex (nebula blue, dashed):

- Strengths by capability: Speed, First-pass quality, Low rework, Token efficiency, Reliability, Volume, each 0-100. Hover an axis label for its formula. Claude has no stored repair signal, so Low rework is n/a for Claude (a gap in its polygon). Claude reliability = sessions with no `<synthetic>` message (an API error or interrupt), the closest stored signal.
- Strengths by task type: PASS-first-time % per task type. Ledger tasks are classified by the keyword rules in `TASK_TYPES` (`server/queries.js`); edit that list to tune them. Axes with fewer than 3 tasks are hollow and marked "low data".

The "What this suggests" lines under each radar come from simple rules over the same numbers.

## Theme and fonts

Dark (portfolio "dark + kafka") is the default; the sidebar button switches to the portfolio light palette and the browser remembers the choice. Fonts are self-hosted in `web/fonts/` (latin, latin-ext and vietnamese subsets, about 156 KB in total): Manrope for text, Space Grotesk for titles and KPI values, JetBrains Mono for ids and numbers. The CSP allows `font-src 'self'` only; nothing loads from a CDN at runtime.

## Third-party code

`web/vendor/`: Preact 10.29.8 (MIT), htm 3.1.1 (Apache-2.0), uPlot 1.6.32 (MIT). Their license files are next to them.
`web/fonts/`: Manrope, Space Grotesk and JetBrains Mono variable fonts from `@fontsource-variable/*` 5.3.0 (SIL OFL 1.1). Their license files are next to them.
