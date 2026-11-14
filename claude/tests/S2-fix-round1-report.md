# Line's S2 fix round 1

Date: 2026-11-13. This report supersedes the first-round findings in `quota-routing-report.md`.

## What we build

Fix quoted-push equivalence, encoding-independent hook tests, occurrence-based edit budgets, lightweight resets, early-window pace suppression, and the checklist's lint attribution.

Decision: widen the push prefilter and retain the original guard as the decision source. Running its parser on every command was another valid option, but would lose the requested plain-command fast path. Confidence: high for the tested contracts.

## Current state

Verified under both default console settings (input IBM437, output UTF-8) and explicit UTF-8 input/output:

| Suite | Result per mode |
| --- | --- |
| `shell-guards.test.ps1` | 188 assertions passed |
| `edit-budget.test.ps1` | 97 assertions passed, including the final migration change |
| `hook-input.test.ps1` | 3 assertions passed |
| `statusline-pace.test.js` | 2 tests passed |
| Existing Bash heredoc guard suite | 8 cases passed |
| Existing packet docs guard suite | 27 cases passed |

The six-test Node group, including existing account and run-summary tests, also passed. The default batch encountered the existing run-summary speed flake; the isolated recheck passed. See failures below rather than treating the batch log as a clean run.

Commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/run-s2-tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/run-s2-tests.ps1 -Utf8Console
powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/edit-budget.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -Command '[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8; & ./claude/tests/edit-budget.test.ps1'
node --test --test-concurrency=1 claude/tests/statusline-pace.test.js claude/bin/tests/statusline-codexhome.test.js claude/bin/tests/statusline-runs.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/measure-shell-guards.ps1
```

Verified: PowerShell 5.1 syntax, Node syntax, round-only reverse patch check, and unchanged SHA-256 for the supervisor's `claude/CLAUDE.md`.

Timing, median of 10 runs, measured without concurrent validation jobs:

| Path | Median |
| --- | --- |
| Combined shell guard | 192.3 ms |
| Empty PowerShell baseline | 181.4 ms |
| Sum of the three separate guards | 1,264.7 ms |

The combined path adds 10.9 ms over empty startup and saves 1,072.4 ms against the separate guards in this run. No paid API calls or new data sources were added.

## Files in flight

The round-only implementation and test diff is `S2-fix-round1.diff`. It compares against snapshots taken at the start of this fix round, including files that were already untracked. It excludes earlier work and supervisor edits.

Changed: `claude/hooks/shell-guards.ps1`, `claude/hooks/edit-delegation-guard.ps1`, `claude/statusline-ultrathink.js`, `claude/docs/packet-checklist.md`, and scoped test files. New: the byte-level stdin test, encoding-suite runner, round-only diff, logs, and this report under `claude/tests/`.

Evidence logs: `S2-fix-round1-default.log`, `S2-fix-round1-utf8.log`, `S2-fix-round1-budget-default.log`, `S2-fix-round1-budget-utf8.log`, `S2-fix-round1-node-recheck.log`, and `S2-fix-round1-timing.log`.

## What changed

1. The prefilter catches punctuation between the letters of `push`. Tests cover `git pu"s"h`, `git pu''sh`, and `g"i"t pu"s"h`, both with and without approval. Every case compares flag consumption, exit code, decision, and reason against the original scripts. A poisoned sibling guard proves `ls -la` takes the fast path.
2. OpenRouter and heredoc logic matches raw command text. Splitting their trigger with quotes does not create a match in the old guards. Tests preserve that behavior; no new denial rules were added.
3. The test helper writes exact UTF-8 bytes without BOM through `StandardInput.BaseStream`. On this .NET Framework runtime, `Process.Start()` creates an auto-flushing writer and can emit a BOM before the first write. The helper selects BOM-free UTF-8 during startup and restores the parent's encoding immediately. A byte-level probe tests accents, CJK text, and a supplementary Unicode character.
4. Added-line counting consumes each old occurrence once with ordinal comparison. Replacing one `x` with two adds one. Removal and mixed-duplicate cases are covered.
5. Session totals now live in `.budget` files; per-prompt file lists remain in `.json`. Reset reads the session ID with a regex, locks only an existing budget file, and deletes the prompt list. It loads no JSON serializer and creates no state. A lightweight format check preserves prior combined objects until check mode migrates their budget and starts a fresh prompt list. Tests cover reset-before-migration and unchanged budget bytes after normal reset.
6. Pace is hidden below 5% elapsed. Tests cover exactly 5%, one millisecond below it, and real rendering early in the window.
7. The checklist names `codex-do.ps1` lint and exit 74 as enforcement for `DOCS CHECKED` and Important/Critical `CHECKLIST` markers.

## What failed and why

The new regressions failed before implementation: quoted push equivalence, BOM-free stdin, occurrence counting, reset without JSON/state creation, and early-window pace suppression. The final targeted checks passed in both console modes.

Writing through `BaseStream` alone still produced an `EF-BB-BF` prefix under UTF-8 because `Process.Start()` emitted it first. Selecting BOM-free startup encoding fixed the actual source of that prefix.

The unchanged 50-folder run-summary test has a 30 ms limit. It failed at 33.4 ms and 36.5 ms in default batches, then passed standalone at 26.6 ms. The UTF-8 batch passed it at 27.6 ms. No threshold or run-summary code was changed. The default batch log therefore exits nonzero even though every requested regression suite passed; the separate Node recheck records all six tests passing.

Pre-existing guard gaps remain outside scope: `gh pr create`, aliases, `bash -c`, and `cmd /c`. These are not newly supported blocking paths. The combined guard preserves the original guard's coverage and fail-closed approval rule.

Not verified: live installation, independent supervisor review, and high-contention stress. Existing fail-open storage behavior and 24-hour state cleanup remain. The original guard scripts were reused without modification.

## The one next step

The supervisor reviews the round-only diff and runs the listed checks before installation. No subagents, live-home edits, commits, or pushes were used. Rollback uses the supervisor's `live-pre-S` backup or the round-only diff; preserve unrelated working-tree changes and the supervisor's `CLAUDE.md` edits.

Sources checked on 2026-11-13: original guard scripts, existing hook contracts and tests, local PowerShell/.NET process behavior, and statusline pace code. Validation used Windows PowerShell 5.1 and Node 24 built-ins.

Automatic approval review rejected the command containing temporary-snapshot cleanup as blocked by policy. The diff was saved and checked with a non-deleting command. The snapshot remains at `C:/Users/ADMIN/AppData/Local/Temp/harness-test-s2-before-159b1ef54b134a78b4504a419a3dfcc7`.

usage: unavailable in current runtime
