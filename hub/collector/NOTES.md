# Collector internals

> Updated 2026-11-15 (R1, Line): schema v10 adds ledger.layer2_raw TEXT and reviews.mode TEXT in both CREATE TABLE and guarded ALTER steps. Upgrades preserve rows and set meta.v10_review_replay once. collect.js atomically clears that flag and rewinds only review-ledger.log and reviews.jsonl; normal durable cursors finish a budget-stopped replay. Ledger and review upserts prevent duplicate records. The existing explicit host-migration path backs up hub-v9.bak first; the worker did not run --migrate or access ~/.line-hub.

Layer-2 evidence has one owner, collector/ledger.js. Only field 3 counts: the existing case-insensitive /^\s*(?:layer2\s+)?yes/i rule, or legacy /\b(PASS|FAIL)\b/ or /\bL?2b?\s+yes\b/i. PASS/FAIL is uppercase as specified. The raw field is retained verbatim. Findings cells, model names and notes never add evidence. Gates and summarizeLedger both consume the stored layer2 flag.

Gates counts mode="gates-only" separately as gatesOnlyRuns and excludes these records from reviewer metrics. Both historical model="gpt-6-astra" and new model=null/effort=null shapes work. Other rows group by reviewer key, effort and normalized mode: exactly "model" stays model; NULL and every other value become unknown. Large (>=64 KiB) review projection retains mode. Without the v10 column, every page still serves v9 and reviewer mode is unknown.

Routing STOP is only C3 + K1. Both used percentages above 85 no longer stop dispatch. The existing K1+C2 Sol/Sol cell is unchanged; its Standard-A and Standard-B rules append " - Line 2026-11-15: Standard never deferred".

### R1 handoff (Line, 2026-11-15)

- **What we build:** explicit review evidence, separate gates-only results, and Line's corrected STOP policy.
- **Current state:** implementation and fixture checks complete; changes stay uncommitted. All 188 tests passed on the first full run; final validation is recorded below. Host migration and independent supervisor review remain pending. The 1440 px browser check is Not verified: isolated headless Edge exited 2147483651 with sandbox access denied / GPU process unusable. No layout or CSS changes were made; existing evidence-scroll containment remains. Static review only for overflow.
- **Files in flight:** only the 16 task files listed below. Existing uncommitted Hub changes and parallel claude/codex work were preserved. This in-scope handoff replaces a root .handoff write, which the task's explicit file boundary disallows.
- **What changed:** schema v10, selective replay, shared field-3 evidence, reviewer mode ingestion/projection/grouping, UI text plus Mode column and gates-only count, routing STOP and rule text, regression coverage and docs.
- **What failed and why:** pre-implementation focused run had 31 passed / 16 failed (47 total), proving the missing behavior; four legacy evidence vectors, R1 coverage, STOP, mode/projection and schema/replay assertions were red. A new violations assertion initially used insertion order instead of the query's existing alphabetical order and was corrected. The diff pass removed an unintended sort edit outside Gates. The browser prerequisite failed as described above; no sandbox bypass was attempted.
- **The one next step:** supervisor independently reviews the task diff, runs the host migration and checks the real 380-line ledger / 22-row review log, then verifies Gates at 1440 px in a working browser. Those real-data counts come from the packet, not worker access.

Changed files and reasons (relative to hub/):

| File | Reason |
| --- | --- |
| collector/ledger.js | Shared field-3 evidence and verbatim audit text |
| collector/schema.sql | New nullable TEXT columns in CREATE TABLE |
| collector/db.js | v10 version/whitelist, guarded columns, replay flag |
| collector/collect.js | One-time review-log cursor rewind, atomic with flag removal |
| collector/parsers.js | Persist/upsert layer2_raw and review mode |
| collector/project.js | Keep mode on >=64 KiB records |
| server/queries.js | Remove model-name evidence, separate gates-only/modes, guard v9, STOP rule |
| web/app.js | Updated evidence/routing tooltips, Mode column, gates-only count |
| README.md | Evidence, modes, migration and routing documentation |
| collector/NOTES.md | Operational rules, validation and handoff |
| tests/v10.test.js | Ten evidence vectors, audit, R1 reproduction, modes, migration/replay/idempotence, all v9 pages |
| tests/project.test.js | Actual large-record ingestion for both gates-only shapes and model mode |
| tests/h8b.test.js | Replace model-name inference fixtures with parsed field-3 evidence |
| tests/h8a-route.test.js | Correct STOP and both Standard rule-text expectations |
| tests/v9.test.js | Current migration destination is v10 |
| tests/h8b-ui.test.js | Rendered mode, both gates-only shapes and evidence tooltip |

Red then green evidence (field 3 is parsed on real-shape lines; findings/note deliberately include misleading text):

| Field 3 | Before | Required / after |
| --- | ---: | ---: |
| yes | 1 | 1 |
| layer2 yes | 1 | 1 |
| no | 0 | 0 |
| no (Fable L2b yes ...) | 0 (red) | 1 |
| partial (Fable 2b yes, codex L2 pending) | 0 (red) | 1 |
| Fable PASS (2 P2 ...); Sol review deferred | 0 (red) | 1 |
| L2 model: OOM ...; L2b Fable: FAIL (3 P1 ...) | 0 (red) | 1 |
| Astra skipped; Fable not run | 0 | 0 |
| no (L2 skipped; L3 yes) | 0 | 0 |
| yes (pending: Codex web review + Fable) | 1 | 1 |

The R1 reproduction keeps field 3 "no" and places "Astra skipped; Fable not run" in the L2 cell and note: stored layer2 remains 0, but Gates changes from 100% coverage / no violation to 0% / one violation. Workers' summarizeLedger agrees at 0%. The STOP reproduction s(85.1,85.1) changes from stop=true/all STOP rows to stop=false/MATRIX['K1 C2']; C3+K1 remains STOP.

Every changed pre-existing assertion/fixture, old -> new:

- tests/v9.test.js: SCHEMA_VERSION 9 -> 10; stored schema_version '9' -> '10'. Other v9 assertions remain unchanged.
- tests/h8a-route.test.js rule assertion: row 0 matching /Claude K1.*Codex C2/ -> both rows 0 and 1 matching those levels plus the exact dated suffix. STOP title changes to "only C3 with K1; both sides over 85 retain K1 C2". For s(85.1,85.1): stop true -> false; models WORK.map(STOP) -> MATRIX['K1 C2']; notes containing "No new packets" true -> false. K1+C2 matrix and other boundaries stay unchanged.
- tests/h8b.test.js first Gates fixture: l2_raw="no (Fable L2 review)" -> parseLedger field 3 "no (Fable L2b yes)" supplies layer2. Test title changes "L2 regex" -> "explicit L2 evidence". Important aggregate [2,50,50,1,50], defect totals/counts, and violations ['Critical','missing L2'] retain their old expected values, now supported by explicit evidence.
- tests/h8b.test.js final fixture: model names ['Astra','Opus','Sol','codex review','subagent'] in l2_raw -> those same strings in parseLedger field 3; manually setting layer2=1 -> parseLedger field 3 "yes". Test title now says "only explicit field-3 evidence counts". Tasks remains 7; Important layer2Pct 100 -> 16.7; violations [] -> notes ['Astra','codex review','Opus','Sol','subagent'] in existing query order.
- tests/h8b-ui.test.js adds fixtures/assertions for Mode, model, "gates-only runs: 2", and the field-3 tooltip; no existing assertion changes.
- tests/project.test.js adds a new ingestion regression; no existing assertion changes. tests/v10.test.js is new. No other pre-existing test expectations were changed.

Decision: implement the supplied explicit evidence/mode contract, high confidence from fixture regressions. No unresolved implementation tradeoff; alternate evidence inference would violate the contract. Sources checked: supplied packet and existing Hub source/tests, 2026-11-15. No new libraries or external documentation required. Missing evidence: production replay results, independent review, browser layout measurement. Cost/latency: zero new dependencies or external calls; two source logs replay once, and one nullable TEXT column per ledger/review row. Runtime latency delta was not benchmarked.

Risks: logs that no longer exist cannot backfill raw evidence or modes; historical reviews without mode remain unknown, by design. Before replay completes, existing stored layer2 values remain in use. The specified regex treats any standalone uppercase PASS/FAIL in field 3 as evidence; interpretation is deliberately limited to the packet's rule. Rollback: restore the task's hub files from D:/Backups/line-harness-pre-R1-2026-11-15/hub, preserving unrelated work (do not use git checkout); after host migration, stop DB users and restore ~/.line-hub/hub-v9.bak. No rollback or host migration was performed by this worker.

Verified final VALIDATE (2026-11-15): from D:/01_Workspaces/line-harness/hub, `node --test "tests/*.test.js"`, exit 0. Tail:

```text
tests 188
suites 0
pass 188
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 6873.2926
```

Focused regression run: 47/47, compared with the pre-implementation 31/47 (16 expected failures). Independent review and the 1440 px browser measurement remain Not verified.

Validation artifacts: hub/.tmp/r1-red.log, r1-green.log, r1-full.log, and r1-task.diff (relative to the working tree captured before this task, not HEAD). Model usage: unavailable in current runtime.


> Updated 2026-11-14 (H8b): schema v9 adds `runs.spec_sha TEXT`. `db.js` adds the column before creating `runs_spec_sha`; the index must not move into schema.sql, which executes before ALTER on older databases. Upgrades from v8 preserve rows and set `meta.v9_run_replay` once. `collect.js` consumes that flag transactionally, resetting only run.json cursors (`size=-1`); pending cursors survive a budget stop. Snapshot upserts store exactly 64 hexadecimal `specSha256` characters, lowercased, otherwise NULL. Reopening v9 does not schedule another replay. No packet contents are read.
>
> The hook skips with `INFO_MIGRATION_PENDING_V9` until the supervisor explicitly migrates on the host. Host migration from v8 first writes `hub-v8.bak`; neither migration nor real-DB access was performed by the H8b worker. The server remains compatible with v8 and returns no A/B pairs until hashes exist. Tests use only in-memory DBs and generated fixtures under `hub/.tmp`.

## H8b worker handoff (2026-11-14, Line)

- **What we build:** model execution/outcome comparison, same-packet pairs and review gate measurements; no routing, cost or sampler changes.
- **Current state:** Verified: `node --test "tests/*.test.js"` passed 171/171 (0 failures), including fixture migration, query, HTTP and htm runtime tests. Host screenshots, live API checks and independent supervisor review remain Not verified.
- **Files in flight:** collector db/schema/collect/sources; server queries/server; web app/route/style; README and these notes; new h8b, h8b-ui and v9 tests; page lists in server/route tests. Pre-existing working-tree changes are retained.
- **What changed:** v9 digest replay; separate run and ledger denominators; last-linked-run ownership with ledger fallback; allow-listed tier control; A/B table; Gates page; formula tips and card-contained scrolling. Missing values remain NULL (`n/a` in the new tables).
- **What failed and why:** initial tests were red because v9 and the three queries did not exist; the later calendar-week regression caught old occupied weeks being selected instead of the latest eight calendar weeks. Both were corrected and their focused tests passed.
- **The one next step:** supervisor reviews the H8b hunks, then performs the host migration, real-DB API check and screenshots at 320/390/640/1024/1440 px. Roll back only H8b hunks (the tree already had other changes); after a host migration, restore the host's `hub-v8.bak` over hub.db with DB users stopped.

Evidence: task-packet source facts dated 2026-11-14 and existing Node SQLite/test patterns; no external library or API added. No API spend or new service. Production latency/RSS impact is not measured; queries scan selected runs and ledger rows and resolve thread trees. Outcome association is limited to stored explicit links or ledger model names; low-data labels are descriptive, not recommendations. Confidence: high in fixture-covered semantics, visual layout and production performance pending host checks. `usage: unavailable in current runtime`.

Existing test changes (only page/route lists): `tests/server.test.js` page loop and `tests/route.test.js` PAGES both changed `... 'harness', 'system', 'trace'` to `... 'harness', 'gates', 'system', 'trace'` (9 to 10 pages). No existing schema-version or metric assertion changed; version checks already refer to SCHEMA_VERSION. New tests live in `tests/v9.test.js`, `tests/h8b.test.js` and `tests/h8b-ui.test.js`.

> Updated 2026-11-14 (H8a): the sampler raises desktop alerts. After the sample line is written, `sample-system.js` evaluates rules a, b, c, f, g, h with `queries.evaluateRules()`: rule b from the fresh row (commit charge > 75 %), a / c / g / h from the hub DB opened with `new DatabaseSync(db, { readOnly: true })` (never Store, never a write, no schema work; no DB file = those rules are skipped), f from `~/AGENTS.md` existence. Episodes live in `sampler-state.json` under `alerts.<rule> = { firing, since, clearedAt, toastedAt }`: a rule toasts when it starts firing, and again only after it was clear for >= 15 min. Each toast appends `{ ts, rule, text }` to `<system dir>/alerts.jsonl` (truncated at 1 MiB; not a `yyyy-mm-dd.jsonl` name, so the collector never ingests it). Delivery: Windows PowerShell 5.1 (`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -EncodedCommand <fixed script>`), title / body only through `LINE_HUB_TOAST_TITLE` / `LINE_HUB_TOAST_BODY` (XML-escaped in the script), 10 s timeout, failures go to stderr and never fail the sample. `LINE_HUB_NOTIFY=0` turns delivery off; the episode state and the log still run.

> Updated 2026-11-13: schema v8 (system sampler + delegation fields). No full replay: `--migrate` / `--full` backs up `hub-v7.bak` and sets two one-time flags that collect.js (which knows the source paths) acts on: `meta.v8_run_replay` resets ONLY the cursors of `<state>/runs/*/run.json` (size=-1, so each run is re-read once for `spec_bytes`; no other cursor is touched) and `meta.v8_ledger_replay` re-reads `review-ledger.log` from the start (rows upsert by content id, nothing doubles; fills `ledger_runs` and `ledger.stop`). A hook run never migrates (it skips and logs `INFO_MIGRATION_PENDING_V8` once).
>
> - System sampler (`sample-system.js`, Task Scheduler every minute): one JSON line per call in `<db folder>/system/<yyyy-mm-dd>.jsonl` (`LINE_HUB_SYSTEM_DIR` overrides). The collector reads these files like any append-only log (kind `system`, byte cursor) into `system_samples` (raw, kept 7 days), `system_daily` (per local day: `ram_free_min_pct`, `ram_free_avg_pct`, `commit_max_pct`, `samples`, and per drive `disk_free_min_pct` / `disk_free_min_bytes` / `disk_total_bytes`; kept 90 days) and `memory_kills` (System event 2004: time + up to 5 process names; kept 90 days). Raw samples are pruned by whole local day (every day before the day of now - 7 d; `meta.system_pruned_before` = the first day kept). Daily RAM / disk metrics are rebuilt with the other daily tables for dirty days, never for a day before that mark (a late sample cannot rebuild a day from a partial set) and never for a day without raw samples. Folder sizes (`folder_bytes`, one row per folder and day, with its drive letter) come straight from the sampler line. Sampler files older than 8 days (by name) are deleted, with their cursors, only when the cursor shows the file was read to the end (offset == size). Only process names (`^[\w .()+@#-]{1,64}$`), drive letters and the six fixed folder labels are stored.
> - Folder pass: once per local day, in ~600 ms slices, one folder after another (`~/.claude/projects`, `~/.codex/sessions`, `~/.codex` without sessions + sessions, `~/.claude/state/runs`, `%TEMP%/claude`, `~/.line-hub`). The slice resumes from a cursor of child indexes (directories read in name order), so `sampler-state.json` holds numbers only, never a path. On Line's machine the pass took 45 calls (`%TEMP%/claude` alone has ~117k files). Links are not followed.
> - Ledger `runs=<runId>[,<runId>...]` (written by `ledger-add.ps1 -RunIds`) fills `ledger_runs (ledger_id, run_id)`; ids outside `[A-Za-z0-9._-]{1,64}` are dropped. A replay rewrites the set for that line.
> - Runs: `spec_bytes` = size of the run folder's `stdin.txt` (the packet codex-do sent; the file is never read).
> - Quota: `window_secs` = Codex `rate_limits.<window>.window_minutes` x 60 (also kept by the >= 64 KiB projection), Claude `five_hour` / `seven_day` by name. Older rows are NULL; the server falls back to 5 h / 7 d.
> - Hook limits: `<claude>/settings.json` is read as a small snapshot; only its `hooks` section is used: per script file name and event, the configured `timeout` (seconds) or the Claude Code default (command / http / mcp_tool 600 s, prompt 30 s, agent 60 s; `UserPromptSubmit` 30 s; docs via context7, 2026-11-13). Nothing else in the file is stored.

> Updated 2026-11-12: schema v7 (fixes from the 2026-11-11 trace audit). Opening a v1-v6 DB replays every source once, with line counters reset first.
>
> - Codex: a rollout belongs to its FIRST `session_meta` (or the id in its file name). A forked sub-agent rollout repeats its parent's `session_meta`; that copy is ignored, so the child keeps its own counters and the parent's model, end and duration are never overwritten.
> - Codex tokens per day: `codex_days` holds, per thread and local day, the change between consecutive cumulative `token_count` snapshots (a downward correction gives a negative change). A thread that runs past midnight is split across days; the days of a thread always add up to its total. `daily_tokens` for Codex is built from `codex_days` under the thread's current model; `messages` = threads that spent tokens that day. On upgrade every thread's v6 total is kept as one day row (`codex_reseed`) until its rollout is replayed; a rollout that no longer exists keeps the v6 number.
> - Codex accounts: rollouts are read from `<codex home>/sessions` (account `default`) and from every `<LINE_HUB_CODEX_ACCOUNTS_DIR>/<name>/sessions` (account `<name>`; default `~/.codex-accounts`). `codex_sessions.account` and `quota_snapshots.account` hold it (0 = no account, Claude). The upgrade rebuilds `quota_snapshots` with the account in its UNIQUE key; existing Codex rows become `default`.
> - Active Codex account (H7, 2026-11-14): every collector run copies `<LINE_HUB_CODEX_ACCOUNTS_DIR>/active` (written by `codex-acc.ps1 use <name>`; `main` = the `default` account) into meta `codex_active_account`. A missing, empty or invalid file deletes the key. The server's `quota()` shows that account's Codex windows when it has snapshots; otherwise the account of the newest snapshot. No schema change.
> - Human turns: a user text row is a turn only when it is not `isSidechain`, not in a `subagents/` transcript, and not only harness tags (`task-notification`, `command-name/message/args`, `system-reminder`, `local-command-*`, `bash-*`). A replay deletes such rows that an older version counted.
> - Runs: `ended` = the mtime of `exit.txt` (written when codex-do exits). `activity.txt` is the fallback only when `exit.txt` holds no exit code. Runs link to a Claude session through dispatches of kind `do` or `resume`.
> - Ledger: parsing is in `ledger.js` (also used by the server). A line may end with optional fields after the 7 classic fields: `worker=<model>|type=<ui|collector|review|research|docs|config|other>|fail_rounds=<int>|findings=L1:<n>,L2:<n>,L3:<n>`; when present they win. Old lines: `layer2` = the cell starts with `yes` (or `layer2 yes`); findings = the leading integer of each cell (`0 + text` = 0, `3 P2 ...` = 3); `fail_rounds` = FAIL words in the three cells and the note (`FAIL x2` = 2; `no FAIL`, `0 FAIL`, `FAIL 0`, `3-FAIL rule` = 0); model = the `(worker <model>)` / `worker model: x` phrase, else the first model named, lower-cased and aliased (`Opus`/`claude-opus-*` -> `opus`, `Fable` -> `fable`, `Sol` -> `gpt-6-sol`, `Astra` -> `gpt-6-astra`, `Luna` -> `gpt-6-luna`). A six-field line is stored with an empty note; it and every non-row line (the `#` header, a bad date) add one to `meta.ledger_warnings`. Rows are upserted by content id, so a replay refreshes them.
> - Repos: a `.git` FILE that points into `<main>/.git/worktrees/<name>` names the main checkout's folder. The >= 64 KiB projection keeps `gitBranch`, `isSidechain` and `payload.git.{branch,repository_url}`.
> - Hooks: every `hook_*` attachment is stored with the script file name (never the command), event, duration and outcome (`success`, `timeout` = `timedOut`, `cancelled`, `error_*`, `non_blocking_error`). The Harness page ranks scripts by timeouts, errors and range p95.

> Updated 2026-11-11: the lock is now a single-row SQLite `lease` table (BEGIN IMMEDIATE, dead-PID or 30-minute takeover, token-checked release); no lock file. Schema is v4: `ingest_state.head` stores a fingerprint of the first 4 KiB of the committed prefix, so a rewrite that keeps or grows the file size is re-read from 0. Reviews, ledger and dispatch rows use content ids (file key + line hash + occurrence). The lock and schema-version paragraphs below describe older versions.


Node 24 built-ins only. No service, network calls, dependencies, or hook installation.
The collector reads local agent logs and exits; SQLite lives outside this repository
by default. Line's source logs are never modified.

```text
npm test
npm run bench
npm run collect -- --full
node collector/collect.js --hook --budget-ms 20000 --min-interval-s 120
```

On Windows, `npm.cmd` also works when PowerShell policy blocks the `npm.ps1` launcher.
The test and benchmark commands set **all** source paths to generated synthetic
fixtures under `hub/.tmp/`; the collection commands above use the configured paths.
No real-data collection or hook wiring was performed during implementation.

| Variable | Default |
| --- | --- |
| `LINE_HUB_DB` | `~/.line-hub/hub.db` |
| `LINE_HUB_CLAUDE_DIR` | `~/.claude` |
| `LINE_HUB_CODEX_DIR` | `~/.codex` |
| `LINE_HUB_STATE_DIR` | `<Claude directory>/state` |
| `LINE_HUB_STATUS_DIR` | `<os.tmpdir()>/ultrathink-status` |

`--full` ignores the budget. Work time starts after acquiring the lock and opening
the database; requested budgets below 1000 ms are raised to 1000 ms. The collector checks its monotonic deadline
between records, long-line read chunks, files, aggregate days, and retention batches. An active SQLite
statement/commit, filesystem operation, or weekly VACUUM completes atomically; the
budget is cooperative rather than a process kill deadline. Pending aggregate days
survive an interrupted or exhausted slice and are processed on the next run.
Hook mode drains stdin to EOF, discarding bytes, with a two-second cap before work.
It pauses/unrefs the stream at the cap and never destroys stdin. It is silent on
success and exits 0 even on failure. Failures write only a timestamp and sanitized
error code to a capped `collect-errors.log`.

Source discovery/stat/open/ingest failures are isolated: the active item batch
rolls back, earlier committed batches remain, and the next item is processed.
Each failure increments `meta.item_errors` and writes one
`<ts> ITEM_FAILED <code-or-name> <first-12-hex-of-path-sha256>` line. Neither paths
nor exception messages are logged. Linking and maintenance remain reachable after
item failures, subject to the work budget.

A live-PID lock is respected regardless of age. Dead-PID locks can be replaced;
malformed locks can be replaced only after ten minutes by filesystem mtime, even
when their contents exceed 4096 bytes. Stale takeover is serialized by a short
transaction on the configured SQLite file, followed by a fresh stale check, atomic
rename to a unique tombstone, and exclusive creation. A rename without serialization
would let a delayed contender move a new owner's lock. SQLite releases its guard
on a crash; there is no separate guard database or persistent mutex file.

The schema version is `meta.schema_version=2`; unsupported versions are rejected.
Version 1 upgrades transactionally: saved file cursors reset once for bounded replay,
and `legacy_replay` tracks pending files. Existing offset-based anonymous IDs (and
retained hook receipts) are adopted into the new scheme as their original lines
are reread. This conversion requires those original source bytes/positions still
to exist; it cannot reconstruct identities already lost before the upgrade.
Rollback to the v1 collector requires the pre-upgrade database copy or a fresh
import, since v1 intentionally rejects a v2 schema marker.

Anonymous Claude events use the file digest, record timestamp, hash of normalized
raw line bytes (BOM/CR removed), and occurrence number. `ingest_occurrences` stores
counts for the committed file prefix, in the same transaction as facts and offsets.
Truncation resets these counts; unchanged remaining lines reuse existing IDs even
after losing a prefix. Identical lines still have separate occurrence IDs. Counters
are in SQLite rather than an unbounded in-memory map and survive budget stops.

`names` interns repeated labels. Query `names` to resolve integer model, project,
tool, source, window, status and other dimension columns. Times are epoch seconds,
days use the collector's local timezone, and tokens are integers. Claude message
tokens use iteration sums followed by field-wise MAX across repeated message IDs.
Thinking tokens use `output_tokens_details.thinking_tokens`: sum iteration details
when supplied (including explicit zero), otherwise use the top-level detail. This
covers Claude records whose iterations contain ordinary token totals but omit
thinking details. Normal runs preserve offsets; the one-time v1-to-v2 replay also
refreshes available historical thinking totals. `--full` disables the budget but
does not independently reset offsets.
Codex session counters use the last token_count in source order, including downward
corrections. Since v7 the per-day split comes from `codex_days` (deltas between snapshots;
see the note at the top), not from the last token_count day.
`daily_tokens.messages` means unique Claude messages or Codex threads active that day.
Hook p95 is nearest-rank; errors include error statuses or nonzero exits, so a timeout
with a nonzero exit contributes to both the error and timeout counts.

The connection opens with the specified 8,000 KiB SQLite cache cap. Ingestion
releases unused cache pages after each committed batch. Final sequential maintenance
temporarily uses a 2,000 KiB cache, then restores the 8,000 KiB setting; this prevents
VACUUM's second database from stacking its memory on the full ingestion cache.
This favors lower resident memory over retaining pages for subsequent queries.

Privacy uses explicit field projections. Prompts, answers, thinking, tool arguments,
hook commands/output, review titles, and parent directory names never enter SQLite.
Projects and hook scripts are basenames. `ingest_state.path` is a SHA-256 path digest,
not a readable path. The packet's explicit exception is the supervisor-written
ledger note, capped at 200 characters. The data remains private even though the code
can be published; the SQLite file is not suitable for public sharing.

Raw Claude messages, tool calls and hook events expire after 90 days, after their
day has been aggregated. Daily tables remain. Hashed receipts prevent replay from
double-counting expired rows; expired message receipts retain token maxima, day and
model, without session IDs or exact times, so late MAX updates remain correct.
Expired hook timing frequency counts preserve exact p95 across late arrivals.
These compact retention tables and human-turn identity receipts grow with history.
Receipt hashes deduplicate replay; aggregate-only retention would use less disk but
could not safely handle truncation/re-ingestion and late message corrections.

Amendments r1/r2: JSONL input uses synchronous reads into one process-wide 64 KiB
Buffer. Every read checks the budget; `try/finally` closes the file on completion,
early exit, and errors. A path-aware scanner inspects
at most the first 1,024 bytes for record and payload types; it does not confuse
nested types or quoted text with the top-level type. Unneeded types and Claude
user tool-result arrays enter byte-counting skip mode without decoding or parsing
their bodies. If the head is inconclusive, the record remains eligible rather than
risk losing a needed event. Eligible records exceeding 4 MiB (excluding LF) are
discarded before decoding/JSON.parse and counted in `meta.skipped_large`.
`meta.skipped_triage` counts irrelevant complete records. Counters and offsets
commit together; a partial trailing line or interrupted skip is reread next run.
Malformed skipped bodies are intentionally not validated or counted as parse errors.

One process-wide line workspace starts at 64 KiB, doubles only for needed records,
and is capped at 4 MiB. Node 24's `ArrayBuffer.transfer` preserves the prefix and
detaches the old backing allocation immediately, so geometric growth does not
leave megabytes awaiting GC. Buffer views are refreshed only on growth; read chunks
and file boundaries allocate no new backing buffers. Raw line views are valid only
until the next reader step, and overlapping readers are rejected. Eligible JSON records
at least 64 KiB are validated directly as bytes and projected onto the metric field
allowlists before JSON.parse. Large ignored tool inputs, prompt/answer text and
other private strings are not created as JavaScript strings. This additional
projection avoids V8 external-string accumulation even for needed 2 MiB assistant
records. The tradeoff versus ordinary full-line decoding is a small validator and
explicit allowlists that must stay in sync with the source parsers. Regression tests
compare both paths for every source fixture and validate malformed ignored fields.
At nesting deeper than 256 levels, projection returns the original bounded line
for native JSON.parse instead of recursing further. No recursive stringification
is used; a regression covers 5000 nested arrays. This rare path can temporarily
materialize ignored fields in memory, but persistence still uses explicit metrics.

The benchmark generates at least 600 MiB, including four 3 MiB Claude blobs,
50 user tool-result lines of 1.5 MiB, 24 needed assistant lines with 2 MiB tool input,
a 12 MiB Codex tool output, two 3 MiB compacted records, and mixed normal records.
It additionally generates 600 files of 1–500 KiB, interleaving them with the large
files by modification time to exercise repeated open/read/close operations.
It verifies every large needed assistant was ingested and generated skip counts
match persisted counters. The unchanged gate uses the child's unmodified
`process.resourceUsage().maxRSS < 90 MiB` (80 MiB before v8; v7 already measured 83 MiB), without runtime memory flags, and requires
ArrayBuffers below 8 MiB across **all** memory samples. A separate child loads the
collector modules and opens an empty synthetic DB to measure the runtime floor. Output
includes triage skips, stored rows/s, source lines/s and a sampled memory breakdown
(`heapUsed`, `external`, `arrayBuffers`). The sampled peak is explicitly separate
from the OS high-water mark, which can occur between samples. Generated data is
deleted afterwards.

Validation uses synthetic fixtures, including a checkpointed DB byte scan for
`LINEHUB_PRIVATE_MARKER`. The supervisor reports r2 real-data validation passed:
full import 84 MB / 7.7 s, incremental hook 57 MB / 0.1 s, stable counts. This
worker has not run r3 on real sources; its independent Important-tier review and
real-source validation remain with the supervisor.
The source-format/API evidence is the packet and amendment checked on 2026-11-09;
the real-line size and many-file memory measurements were supplied by the supervisor.
The r2 Node buffer transfer behavior was checked locally on v24.19.0. No network was
used. There is no API spend or idle service RAM. Runtime and RSS results are in the
handoff and task report. Rollback consists of removing the newly created collector,
tests, benchmark and package files; no hook settings or production data were changed.

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
