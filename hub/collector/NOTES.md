# Collector internals

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
corrections. Its cumulative thread snapshot is assigned to its last token_count day
in `daily_tokens`; this is **not** a reconstruction of per-day Codex token spending.
`daily_tokens.messages` means unique Claude messages or Codex thread snapshots.
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
`process.resourceUsage().maxRSS < 80 MiB`, without runtime memory flags, and requires
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
