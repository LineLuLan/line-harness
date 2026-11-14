# Line Hub

A local dashboard that shows how well a Claude Code (supervisor) + Codex (worker) harness performs: quota pace, delegation quality, tokens, worker runs, hook health, and the machine itself (RAM, disk, folders).

Public code, private data. The database stays at `~/.line-hub/hub.db` and is never committed. It stores numbers and names only, never prompt or answer text and never full paths.

## Parts

| Part | What it does | RAM |
| --- | --- | --- |
| `collector/collect.js` | Reads Claude Code transcripts, Codex rollouts, harness state files and the sampler files incrementally into SQLite (`node:sqlite`), then exits | peak < 90 MB (bench 83-84 MiB); about 0.1 s per hook run |
| `collector/sample-system.js` | One system sample per minute (Task Scheduler), then exits | node about 60 MB + one short `powershell` CIM call; about 0.65 s per call |
| `server/` | Read-only HTTP server on `127.0.0.1` that turns the DB into JSON | about 55-72 MB; stops after 30 min idle |
| `web/` | Ten pages (Preact + htm + uPlot, vendored, no build step) | one browser tab |

There is no always-on process. The collector runs from Claude Code `SessionStart` and `Stop` hooks (async), skips if it ran less than 2 minutes ago, and works for at most 20 s per run. Collector internals: [collector/NOTES.md](collector/NOTES.md).

## Use

Requires Node 24.15 or later.

```
npm run collect -- --full   # first import (about 10 s for 1.6 GB of logs)
npm run hub                 # start the dashboard and open the browser
npm test                    # node --test "tests/*.test.js"  (use --test-concurrency=1 on Windows)
npm run bench               # collector RAM bench (peak RSS < 90 MiB)
npm run collect -- --migrate  # apply a schema upgrade (also done by --full)
npm run collect -- --reparse-ledger  # re-read review-ledger.log from the start (after a parser change)
```

Schema upgrades never run from the hook or a plain run: they skip with `{ "skipped": "migration" }` and log `INFO_MIGRATION_PENDING_V<n>` once to `collect-errors.log`. An explicit `--full` or `--migrate` run first copies the DB to `~/.line-hub/hub-v<old>.bak` (VACUUM INTO), then migrates.

Hook entry (in `~/.claude/settings.json`, under `SessionStart` and `Stop`):

```json
{ "type": "command", "command": "node \"<path>/hub/collector/collect.js\" --hook", "async": true, "timeout": 30 }
```

### System sampler

```
powershell -NoProfile -File hub\scripts\install-sampler.ps1          # register "LineHub-SystemSample", every 1 minute
powershell -NoProfile -File hub\scripts\install-sampler.ps1 -Remove  # unregister
node hub\collector\sample-system.js                                  # one sample by hand (prints a one-line summary)
```

The task runs `conhost.exe --headless node <hub>\collector\sample-system.js --quiet` as the current user while logged on (no window, no stored password; a busy run makes the next start skip; 2 min limit). Each call appends one JSON line to `~/.line-hub/system/<yyyy-mm-dd>.jsonl`:

- free / total RAM (Node `os`), commit used / limit and the list of fixed drives (one `powershell` `Get-CimInstance Win32_OperatingSystem` + `Win32_LogicalDisk` call), free / total bytes per fixed drive (`fs.statfsSync`);
- the top 8 processes by working set from `tasklist /fo csv`, grouped by name (`[name, MB, count]`; Chrome has dozens of processes);
- once per hour: new System event 2004 entries (low-memory resource exhaustion) via `wevtutil` - time and up to 5 process names; the first run looks back 7 days;
- once per day: the size of `~/.claude/projects`, `~/.codex/sessions`, `~/.codex` (total), `~/.claude/state/runs`, `%TEMP%/claude` and `~/.line-hub`. The walk runs in ~600 ms slices across calls (about 45 minutes on Line's machine) and resumes from a cursor of child indexes, so no path is written anywhere.

Errors write one line (code only) to `~/.line-hub/collect-errors.log`; the sampler always exits 0. A failed or timed-out `wevtutil` query logs `SAMPLER_WEVTUTIL` / `SAMPLER_WEVTUTIL_TIMEOUT` and is retried on the next call (the hourly mark does not move); events are queried from the newest event already recorded.

Cost per call, measured on Line's machine (2026-11-13, 5 calls): 628-645 ms wall time, node max RSS 62-64 MB. **The PowerShell CIM child (about 60-80 MB) runs in parallel to the node sampler** for about 0.4 s of each call, so the peak for one call is node + PowerShell, not node alone; `tasklist` (about 0.5 s) runs in parallel too.

## Retention

| Data | Kept |
| --- | --- |
| Sampler files `system/<day>.jsonl` | 8 days; deleted by the collector only after its cursor shows the file was read to the end |
| `system_samples` (raw, one per minute) | 7 days, pruned by whole local day (never part of a day); a pruned day keeps its daily row even if a late sample arrives |
| `system_daily` (RAM / commit / disk per day, folder sizes) | 90 days |
| `memory_kills` (event 2004) | 90 days |
| Raw messages, tool calls, hook events | 90 days (daily totals and receipts kept) |

## Pages

| Page | Shows |
| --- | --- |
UI v6 part 1 (H6a): the v4 pages on schema v8, plus the v5 System page and a one-line "Do this now". UI v6 part 2 (H6b): the Models page. Nav order below. Route ids: `/api/<id>?days=N`, hash `#<id>?days=N`. Models also takes a model key: `/api/models?days=N&model=<key>`, hash `#models/<encodeURIComponent(key)>?days=N`.

| Page (id) | Shows |
| --- | --- |
| Overview (`overview`) | ONE "Do this now" line (first rule that fires; else "All clear - next reset ..."); KPIs with delta + sparkline (tokens today / in range, worker runs, first-pass PASS, quota left, active streak); "What needs attention?"; the 12-month activity calendar; Claude vs Codex tokens per day; capability radar preview. |
| Supervisor (`supervisor`) | Claude only: edits vs work handed off, session weight, review catch by layer, model families, skill / sub-agent / MCP tops, the capability and task-type radars. |
| Worker (`workers`) | Run outcomes per model, weekly first-pass clean by tier, repair rounds, lead time, review tiers, codex-review verdicts. Delegation: rework ratios (7 d / range / 30 d), first-pass clean by tier x worker (7 d, 30 d), per-task runs and lead for ledger lines with `runs=`, resume rate by packet size, Codex tokens by origin. |
| Models (`models`) | One row per model key: tokens, share of its side, runs (Codex) or sessions (Claude), first-pass clean % and FAIL rounds from the ledger, median run time; fewer than 3 runs / sessions = "low data". Click a row for the detail: tokens per day (fresh input, cache read, cache write, output), exact ids; Claude: sessions, top skills / tools / sub-agents of its sessions; Codex: exit 0 / failed / lost, median and p90 run time, effort, findings per layer, task types; last 20 runs or sessions (repo labels only). Key = Claude family (Opus / Fable / Sonnet / Haiku / Other; `<synthetic>` left out) or the exact Codex model name (`unknown` is its own row; retired `gpt-5.6-*` = Other (Codex)). A Claude session is listed when it has a message in the range and counts for the family with the most messages over the whole session. Codex tokens cover every Codex thread (codex-do, interactive desktop / CLI, sub-agents) while runs count codex-do only, so a Codex row shows runs and threads and splits its tokens into codex-do (threads rooted at a run's session) and other; Codex low data = fewer than 3 runs and fewer than 3 threads. Missing data is `null` ("no data"), never 0. When a key exists on both sides, the Codex row id is `codex:<key>` (`claude:<key>` / `codex:<key>` also resolve). Ledger aliases: opus -> Opus, fable -> Fable, claude-subagent -> Other. An unknown key returns `picked: null`. The hash route is the pure module `web/route.js` (on the static allowlist). |
| Usage (`cost`) | Claude vs Codex split and composition, tokens per day, model mix and ranking, one forecast card per quota window (current account), used % vs the even-pace line per window, daily quota peaks, skill / MCP / sub-agent / tool tops. |
| Productivity (`productivity`) | Runs and tasks per day, run time, quota pace per side (Claude 7-day, Claude 5-hour, Codex: used %, window gone, pace, 1.0 reference), when Line works, context pressure. |
| Harness (`harness`) | Hook errors / timeouts, exit 72 / 73, slowest hooks with their configured limit, collector health. |
| Gates (`gates`) | Tasks and review coverage by tier; first-pass and STOP rates; L1/L2/L3 defect sums with known-count denominators; late defect share; latest 20 Important/Critical tasks missing L2 (STOP exempt); reviewer FAIL rates and mean P0+P1; latest eight Monday-start calendar weeks. |
| System (`system`) | Free RAM, commit, free disk C:, low-memory events; RAM by day; drives; folders incl. the WSL and Docker `.vhdx` disks (size, growth, days to full); top processes; low-memory events; hook p95 as a share of each hook's own timeout. |
| Trace (`trace`) | Run scatter, then Claude sessions by repo; each lane bar is one Codex run; the run table shows the run's whole Codex thread tree, once per resumed session. |

The 30 / 70 supervisor / worker target is retired. `/api/delegation` and `/api/usage` return 404 (the delegation metrics are `workers().delegation`).

### Model outcomes and review gates (H8b, 2026-11-14)

Models now starts with **Compare models**. `/api/models?days=30&tier=Standard-A` adds `compare` and `pairs` to the existing payload. The tier selector stays in component state and leaves the hash unchanged. Allowed tiers: All, Skip, Standard, Standard-A, Standard-B, Important, Critical, Exploration, Other; missing or unknown means All.

- Runs are grouped by Codex key and effort (`default` for NULL). Resumes count as runs. Exit-0 uses only known exits. Durations use finished runs; tokens use `runTokens()` (root plus sub-agents, shared sessions counted on the first run only). Tier filtering needs explicit ledger links; if no run in the selected range is linked, the block stays unfiltered and says `tier filter needs ledger links`.
- Outcomes count each ledger line once, owned by its latest linked run, otherwise `ledger.model`. First-pass means `fail_rounds = 0`, over known `fail_rounds` only; this differs from the older **Clean first pass** metric below. The mean FAIL denominator is the same. Defects after the worker mean L2+L3 over lines with both counts. Rows below three runs/tasks show `low data`; comparison rows are alphabetical, without value colours or ranking.
- A/B pairs require the same packet SHA and at least two distinct model keys. They show the latest non-resumed run per key, effort, exit, duration, root-tree tokens and a linked ledger outcome, plus a linked note if available. The date range applies; the tier selector does not filter pairs. At most 20 pairs appear, newest first.
- Gates is `#gates` / `/api/gates?days=N`, after Harness. Layer 2 counts only from `ledger.layer2`, parsed in `collector/ledger.js` from field 3: the existing case-insensitive `^\s*(?:layer2\s+)?yes` rule, or legacy `\b(PASS|FAIL)\b` / case-insensitive `\bL?2b?\s+yes\b`. Model names, findings cells and notes supply no review evidence. `reviews.mode="gates-only"` rows are counted separately as gates-only runs and excluded from reviewer metrics, even with an old model name or a NULL model/effort. Reviewer groups include mode (`model`, otherwise `unknown`), so historical records are not assumed to be model reviews. Each layer shows its own number of lines with counts. Late share is L3 divided by all recorded layer defects; zero total gives `n/a`. Empty weeks remain visible with zero tasks and unknown percentages.

Schema v10 adds `ledger.layer2_raw TEXT` (verbatim field 3 for audit) and `reviews.mode TEXT`. Upgrading from v9 preserves data and schedules a one-time replay of review-ledger.log and reviews.jsonl; replay upserts evidence and mode without duplicates. The server still serves every page on v9 (review mode is unknown). Host migration first writes `hub-v9.bak`. Schema v9 added `runs.spec_sha` and an index. The reader still serves v8 databases (pairs empty). The live collector hook pauses until the supervisor performs the explicit migration; v9 backfills hashes by re-reading run.json snapshots once, without opening packet contents. Missing hashes or historical ledger links are not reconstructed.

### Pace

pace = used % / elapsed % of the window. 1.0 = spending exactly at the even rate; 2.0 = twice as fast as time. It is shown whenever some of the window has passed; under 5 % of the window it is marked "early" and rule (a) then needs used >= 70 %. After the reset the window has no pace. Only the current Codex account (the account of the newest snapshot) is shown.

Window length, in order: `window_secs` on the newest snapshot (v8: Codex `window_minutes`); Claude by name (`five_hour` 5 h, `seven_day` 7 d); `window_secs` on any older snapshot of that quota; else inferred from the reset times - a window is at least as long as the longest time between a period's first snapshot and its reset, so the smallest standard length (5 h, 1 d, 7 d, 30 d) covering that span is used. Else the length is unknown and no pace is shown; a legacy Codex row is never assumed to be 7 days. (The plain gap between consecutive reset times was rejected: Codex moved its weekly reset several times on Line's machine, gaps 1.0-7.7 days, median 4.3.)

Quota burn chart: the x axis is the window itself - one point per local day for windows of 2 days or more, one point per hour for shorter windows.

### "Do this now"

The box shows only the FIRST rule that fires, in this order (`actionBox` in `server/queries.js`, ontology alerts mapped to `RULES`):

| Rule | Fires when | Action text |
| --- | --- | --- |
| a | Claude 7-day or the Codex quota (longest window of the current account; never Claude 5-hour): pace > 1.3 (`RULES.quotaPace`, not early) or used >= 85 % (`RULES.quotaUsed`) | Codex: route Standard-A to gpt-6-sol and exploration to gpt-6-luna until the reset (see the Routing card). Claude: hand more work to Codex. |
| h | Claude 5-hour used >= 80 % (`RULES.handoffUsed`) | finish the current check, update the handoff, pause Claude work until the window resets |
| b | commit charge > 90 % of the commit limit (strict; low free RAM alone never fires, Line 2026-11-14) - skipped when the newest system sample is older than 10 minutes | close the biggest process group, or idle node / Codex processes |
| f | `~/AGENTS.md` exists (existence check only, the file is never read; `LINE_HUB_HOME` overrides the home folder) | move it out of the home folder and check what recreated it (Codex desktop Claude import) |
| c | a drive < 10 % free, or a folder trend fills its drive in < 14 days | clean the biggest folder on that drive / that folder |
| g | a Codex thread has > 50M cumulative tokens (`RULES.threadTokens`) and activity in the last 48 h (`RULES.threadActiveHours`) | stop that session and report to Line; start a fresh one. The Harness page lists every thread over 50M in the range. |
| d | first-pass clean % fell > 15 points vs the 7 days before (3+ tasks in both weeks) | read the FAIL notes, tighten SUCCESS CRITERIA |
| e | a hook's p95 > half its timeout | make the hook faster or raise its timeout |

Order: a, h, b, f, c, g, d, e. Else "All clear" and the next quota reset. `evaluateRules()` returns every rule that fires (`actionBox()` shows the first).

**Usage and routing cards (H8a).** Overview top: the live quotas of the current account (used, left, reset, hours left, pace, `forecast()` projection for Codex and Claude 7-day), other Codex accounts in their current period, and `routeAdvice()` - CLAUDE.md "Route by quota pace" as a pure function (Codex C1: pace > 1.0 or used >= 70; C2: pace > 1.3 or used >= 85; C3: used >= 95; Claude K1: 7-day pace > 1.2 or used >= 70; STOP: C3 with K1 only; K1+C2 Standard-A and Standard-B stay on Sol - Line 2026-11-15: Standard never deferred; 5-hour >= 80 asks for /handoff). Early or unknown pace counts as under every pace threshold. The daily-budget rule is not tracked.

**Desktop alerts (H8a).** After each sample, `sample-system.js` evaluates rules a, b, c, f, g, h (b from the fresh sample, the rest from a read-only DB connection) and toasts once per episode (again only after 15 min clear). Toasts are logged to `<system dir>/alerts.jsonl`; the System page lists the last 20. `LINE_HUB_NOTIFY=0` turns delivery off.

**Deviation from the packet (rule d):** the packet rule has no minimum. The page keeps a gate of 3 or more ledger tasks in EACH of the two weeks, so one or two tasks cannot swing the rule. When the gate is not met, the clean tile says "Low data" instead of OK / Watch / Act.

Tiles use the same tests as the box (`FIRES` in `server/queries.js`): a tile says **Act** only when its rule fires; **Watch** on softer limits (pace > 1.1, clean % lower than the week before, free RAM < 20 % or commit > 60 %, disk < 20 % free); otherwise **OK**. The RAM and disk tiles show the sample time and say **Stale** when the newest sample is older than 10 minutes.

## Environment

| Variable | Default |
| --- | --- |
| `LINE_HUB_DB` | `~/.line-hub/hub.db` |
| `LINE_HUB_SYSTEM_DIR` | `<folder of LINE_HUB_DB>/system` |
| `LINE_HUB_CLAUDE_DIR` | `~/.claude` |
| `LINE_HUB_CODEX_DIR` | `~/.codex` |
| `LINE_HUB_CODEX_ACCOUNTS_DIR` | `<folder of CODEX_DIR>/.codex-accounts` (one Codex home per account) |
| `LINE_HUB_STATE_DIR` | `<CLAUDE_DIR>/state` |
| `LINE_HUB_STATUS_DIR` | `<tmp>/ultrathink-status` |
| `LINE_HUB_TEMP_DIR` | the OS temp folder (the sampler measures `<it>/claude`) |
| `LINE_HUB_PORT` | `3434` |
| `LINE_HUB_IDLE_MIN` | `30` |

## Server safety

- Listens on `127.0.0.1` only and rejects any `Host` header other than `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard).
- GET and HEAD only. Static files come from a fixed allowlist; no URL path is joined to a file path.
- CSP `default-src 'self'`; the one inline script (the import map) is allowed by its SHA-256 hash.
- Opens the DB read-only and never creates or migrates it. Tables and columns of a newer schema are read only when they exist, so a v7 DB renders with the v8 parts empty.

## Notes on metrics

- Codex `input_tokens` already include `cached_input_tokens`. The dashboard shows fresh input = input - cached, so Claude and Codex totals add up the same way.
- "First-pass clean" = a ledger task whose L1, L2 and L3 found nothing and had no FAIL round (a FAIL named only in the note counts too).
- STOP rate = ledger tasks whose FULL note names a worker STOP (`STOP`, `STOPped`; upper case), set by the collector (`ledger.stop`) before the note is cut to 200 characters; `no STOP`, `0 STOP` and `without STOP` do not count. H8b exposes the stored note only for A/B pair context and missing review gates, on the local dashboard.
- Per-task metrics use only ledger lines with `runs=`; no run is linked to a task by time. Aggregate ratios (runs / resumes / FAIL rounds per task) use every task and every run in the window.
- Resume rate by packet size: an original (non-resume) run counts as resumed when a later `-Resume` run continues the same Codex root thread. Size = the run folder's `stdin.txt` (the packet codex-do sent); `n/a` = no copy.
- Codex tokens by origin (from `codex_days`): sub-agent thread = has a parent thread; codex-do run = the root thread of some run's session; other = any other Codex session.
- Supervisor edits = `Edit` / `Write` / `MultiEdit` / `NotebookEdit` tool calls per day (sub-agent calls included: no sidechain flag is stored); worker runs = codex-do runs per day.
- Hook timeouts come from the `hooks` section of `~/.claude/settings.json` (script file name + event, strictest event per script); without a `timeout` the Claude Code default applies (600 s; 30 s for `UserPromptSubmit`).
- A run with no exit code after 2 days shows as lost in Trace.
- "Repo" is the folder that holds the nearest `.git` above the working folder. Only folder names are stored, never paths.
- Schema v5, v6 and v7 replayed every source once. Schema v7 (2026-11-12): forked Codex sub-agent rollouts keep their own tokens, Codex tokens per day from snapshot changes, human turns without sub-agent prompts, run end = `exit.txt` time, quota per Codex account. Schema v8 (2026-11-13): system sampler tables, `ledger_runs`, `runs.spec_bytes`, `quota_snapshots.window_secs`, `hook_limits`; no full replay (run snapshots and the ledger are re-read once). Internals: [collector/NOTES.md](collector/NOTES.md).

## Ledger format

`~/.claude/state/review-ledger.log`, one task per line:

```
date|tier|layer2|L1|L2|L3|note[|worker=<model>][|type=<ui|collector|review|research|docs|config|other>][|fail_rounds=<int>][|findings=L1:<n>,L2:<n>,L3:<n>][|runs=<runId>[,<runId>...]]
```

The trailing key=value fields are optional and win over every guess from the note. `runs=` (written by `ledger-add.ps1 -RunIds`) links the task to its codex-do run folders. Without the fields: layer2 = the cell starts with `yes`; findings = the leading integer of each layer cell; FAIL rounds = FAIL words in the cells and the note; the model = the `(worker <model>)` phrase, else the first model named, aliased (Sol -> gpt-6-sol, Astra -> gpt-6-astra, Luna -> gpt-6-luna, Opus -> opus, Fable -> fable). Lines the parser cannot read fully are counted in `meta.ledger_warnings`, never dropped silently.

## Theme and fonts

Dark (portfolio "dark + kafka") is the default; the sidebar button switches to the light palette and the browser remembers the choice (`#<page>?theme=light` forces one theme without remembering it, for screenshots). Fonts are self-hosted in `web/fonts/` (latin, latin-ext and vietnamese subsets, about 156 KB in total): Manrope for text, Space Grotesk for titles and big numbers, JetBrains Mono for ids and numbers. The CSP allows `font-src 'self'` only; nothing loads from a CDN at runtime.

## Third-party code

`web/vendor/`: Preact 10.29.8 (MIT), htm 3.1.1 (Apache-2.0), uPlot 1.6.32 (MIT). Their license files are next to them.
`web/fonts/`: Manrope, Space Grotesk and JetBrains Mono variable fonts from `@fontsource-variable/*` 5.3.0 (SIL OFL 1.1). Their license files are next to them.

### Harness ontology

`claude/ontology/harness.ontology.json` is the source for routing, quota thresholds,
review tables and alert values. `server/queries.js` loads it once per process:
`LINE_HUB_ONTOLOGY` when set, otherwise `%USERPROFILE%/.claude/ontology/harness.ontology.json`,
otherwise the repository copy when the live file is absent. A missing or invalid
explicit path, or an invalid live file, uses the complete built-in fallback; it
never mixes partial input with defaults. Restart Hub after edits; each scheduled
sampler process loads the current file on its next run.
Overview returns `ontologyStatus` (`state`, `version`, `error`) beside `route`;
`route.thresholds` and Productivity's `pace.thresholds` supply UI pace colours and
routing tooltip values. The statusline uses `ULTRATHINK_ONTOLOGY`, then the live
ontology, with 1.0/1.3 as its missing/invalid-file fallback.

From the repository root, run:

```
node claude/bin/ontology-check.js --claude-dir claude --codex-dir codex
```

This checks generated guide blocks, hook sets and stale prose. `--write` repairs
only existing generated-block content. Use `--repo .` with live defaults to detect
repo/live byte drift; `--json` gives structured findings. SessionStart `--hook`
reports findings without blocking (always exit 0). The normal CLI exits 0 when
clean, 1 for findings, or 2 for invalid/unreadable input.
