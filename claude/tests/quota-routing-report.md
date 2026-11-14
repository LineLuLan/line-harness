# Line's quota routing and shell guard handoff

Date: 2026-11-13. Runtime: Windows PowerShell 5.1.26100.9818; Node v24.19.0.

## What we build

Route work by quota pace, warn on cumulative supervisor edits, and run the three shell guards in one PowerShell process. The working tree contains the implementation. No installation, commit, push, or subagent run was performed.

Decision: call the original guard scripts in child script scopes with replayed stdin and captured stdout. This keeps their decisions and reasons in one source. Copying the logic was another viable option, but would let the push rule drift. Confidence: high for the tested contracts.

## Current state

Verified:

| Check | Result |
| --- | --- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/shell-guards.test.ps1` | 114 assertions passed |
| `powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/edit-budget.test.ps1` | 76 assertions passed |
| `node --test --test-concurrency=1 claude/tests/statusline-pace.test.js claude/bin/tests/statusline-codexhome.test.js claude/bin/tests/statusline-runs.test.js` | 6 tests passed |
| Existing `claude/bin/tests/bash-heredoc-guard.test.ps1` | 8 cases passed |
| Existing `claude/bin/tests/packet-docs-guard.test.ps1` | 27 cases passed |
| `powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/render-statusline-fixture.ps1` | Ran the specified `node claude/statusline-ultrathink.js < claude/tests/fixtures/statusline-input.json` command with isolated homes and fresh dummy caches; both weekly quotas showed `pace 1.2x` |
| Settings comparison against HEAD | Valid JSON; one Bash/PowerShell command, timeout 15; every other hook and setting unchanged |
| PowerShell 5.1 parser; `node --check`; scoped `git diff --check` | Passed |
| Original three guard files compared against HEAD | Unchanged |
| Routing text presence and section placement | Passed |

The final timing run used `claude/tests/measure-shell-guards.ps1`. Each median contains 10 samples; each separate-guard sample sums the three process durations. These runs were isolated from other validation jobs.

| Plain command path | Median |
| --- | --- |
| Combined guard | 192.5 ms |
| Sum of three original guards | 1,282.6 ms |
| Empty `powershell.exe` script | 178.7 ms |

The measured reduction is 1,090.1 ms per plain shell call, about 85%. No API call or new data source was needed. Model-routing cost savings and live hook latency are not measured.

Not verified: live installation, independent supervisor review, broader unrelated repository tests, and high-contention parallel edit stress. Lock failure and prompt-reset persistence have deterministic coverage.

## Files in flight

- `claude/CLAUDE.md`
- `claude/docs/packet-checklist.md`
- `claude/hooks/edit-delegation-guard.ps1`
- `claude/hooks/shell-guards.ps1`
- `claude/settings.json`
- `claude/statusline-ultrathink.js`
- New scoped test helpers, tests, fixture, benchmark, render runner, report, and `quota-routing.diff` under `claude/tests/`.

`quota-routing.diff` contains the tracked-file diff plus full additions for the scoped untracked files. The checklist and edit guard were already untracked before this task, so their full-file additions include inherited content. Use the supervisor's pre-task backup to isolate their exact delta. Existing unrelated working-tree changes were preserved.

## What changed

1. Added quota pace rules after Model Routing, including daily targets, Claude restrictions, both-side stop conditions, desktop/CLI accounting, and the 50M-session stop.
2. Added Important packet pre-reading, two-FAIL redesign for Important/Critical, packet/RAM exit codes and switches, and ledger helper use. The requested old CHECKLIST sentence was absent in this checkout, so the new enforcement sentence was added to Worker Dispatch.
3. Added the two requested lines at the top of the checklist; retained the rest verbatim.
4. Added a single-process shell wrapper. The first denial wins. Its fast path includes judge-tool names as well as push/OpenRouter/heredoc triggers. Unicode escapes and PowerShell backticks take the guarded path. Normal Windows path separators do not defeat the fast path.
5. Tested exit code, decision, exact reason, flag consumption, locked approval, malformed input, escaped push, guard order, and dispatcher mentions. Payload commands are never executed.
6. Replaced only the shell hook entries in settings.
7. Added cumulative line totals to the edit guard's locked state. Prompt reset clears the file list but retains the total. Legacy arrays migrate. Existing counting rules remain; `.packets` and subagent calls are exempt. Warnings start above 150 and change above 300. No denial is emitted.
8. Added weekly pace beside Claude and Codex quotas. Missing, invalid, expired, or unstarted windows show no pace. Existing Codex caches derive usage from remaining quota; refreshed caches retain the exact used percentage. Colours use the unrounded pace; displayed numbers have one decimal.

## What failed and why

- Before implementation, the new shell test failed because the wrapper did not exist; nine budget assertions and both pace tests failed. They passed after implementation.
- An added `git p`u`sh` fixture exposed a fast-path bypass. The trigger now includes backticks, and the final equivalence suite passed.
- The existing 50-folder statusline speed test failed at 41.6 ms during concurrent checks and at 33.5 ms on an isolated retry (limit: 30 ms). Its code was not changed. The final serial suite passed at 27.9 ms; the HEAD baseline measured 28.7 ms. Treat this threshold as sensitive to host load.
- A full-tree whitespace check found an existing extra blank line at `hub/tests/server.test.js:225`. It is outside scope. The scoped check passed.
- The checklist still attributes enforcement to `hooks/packet-docs-guard.ps1`. This pre-existing sentence was retained because criterion 3 explicitly says to keep the rest. `CLAUDE.md` now names `codex-do.ps1` correctly. The supervisor should resolve this wording in a follow-up.

Residual risks: quota data can be stale until the existing refresh runs; old Codex caches use rounded remaining percentages; edit state still fails open if storage is unavailable. The existing 24-hour state cleanup remains. These changes do not add a new quota data source or reconstruct earlier session edits.

## The one next step

The supervisor reviews this diff against the packet and the `live-pre-S` backup before installation. Resolve the retained checklist attribution at that review. Re-run the listed validation commands on the installation target. Rollback: restore the scoped original files from the supervisor backup and remove only this task's new files; do not discard unrelated working-tree changes.

Sources checked on 2026-11-13: the three original guard scripts, existing hook JSON and tests, edit guard state/counting code, statusline cache readers, and the local runtime versions. No external model capability or pricing claim was researched or introduced beyond the supplied routing policy.

usage: unavailable in current runtime
