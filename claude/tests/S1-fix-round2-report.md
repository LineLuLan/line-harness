# S1 fix round 2 - Line's supervisor handoff

2026-11-13. Changes remain in the mirror working tree. No real Codex/model calls,
no sub-agents, no installation, no workspace commit or push.

## What we build

Install-ready dispatcher hardening, with offline regression coverage. Full
completion is blocked by the environment's denial of WMI process creation.

## Current state

Verified with Windows PowerShell 5.1 (`powershell -NoProfile -ExecutionPolicy Bypass -File`):

| Script | Result |
| --- | --- |
| claude/tests/packet-lint.test.ps1 | 87 PASS, 0 FAIL |
| claude/tests/harness-cleanup.test.ps1 | 17 PASS, 0 FAIL |
| claude/tests/review-findings.test.ps1 | 24 PASS, 0 FAIL |
| claude/tests/ledger-add.test.ps1 | 19 PASS, 0 FAIL |
| claude/tests/codex-do.test.ps1 | 31 PASS, 0 FAIL |
| claude/tests/ram-preflight.test.ps1 | 13 PASS, 0 FAIL |
| claude/bin/tests/codex-do-resume-selftest.ps1 | 39 assertions, exit 0 |
| claude/bin/tests/codex-review-selftest.ps1 -OfflineOnly | 250 assertions, exit 0 |
| claude/bin/tests/codex-do-detach-selftest.ps1 -LocalOnly | 31 assertions, exit 0 |
| claude/bin/tests/codex-do-detach-selftest.ps1 | Failed: dispatcher exit 70 at first detached launch |

Verified: syntax parsing and `git diff --check` for changed tracked scripts.
Static review only: full detached lifecycle beyond the denied WMI launch and native
desktop toast display. The toast text helper and completion output isolation have
executed unit coverage. No change to the review selftest's live-by-default switch.
Resume and detach selftests exclusively use a disposable fake executable; they
have no live-model branch requiring an OfflineOnly switch.

## Files in flight / what changed

- `claude/bin/codex-do.ps1`: attached telemetry requires an existing run folder;
  correct thread_spawn metadata and explicit user-source filtering; malformed
  rollouts skipped; completion logs separately after exit publication; SpecFile examples.
- `claude/bin/codex-run-notify.ps1`: positive sub-agent count included in toast text.
- `claude/bin/ram-preflight.ps1`: per-poll progress; CIM failure warns and fails open.
- `claude/bin/packet-lint.ps1`: setup prefixes and Measure-Command accepted;
  English make/go/find prose rejected.
- `claude/bin/codex-review.ps1`: findings headers separated from summary/body
  mentions; low-RAM verdict printed before exit 75; existing log schema retained.
- The three selftests share `claude/bin/tests/fixtures/dispatch-packet.ps1`.
  Resume baseline lookup now respects the repository's git prefix.
- Unit regression cases and `claude/docs/harness-reference.md` updated.

## What failed and why

The full detach suite reaches the fake command after lint and sandbox preflight,
then reports:

```text
codex-do: Win32_Process.Create failed: Access denied
```

Dispatcher exit: 70. Selftest exit: 1. No production launcher fallback or WMI
bypass was added. The existing LocalOnly mode passes but does not replace full
detached lifecycle coverage. No assertion that all nine requested suites pass.

Confidence: high for executed unit/offline paths; detached installation readiness
is not verified. No model cost from tests. RAM polling stays at 30 seconds; the
completion scan occurs after exit publication. Rollback remains the supervisor's
live-pre-S backups; unrelated working-tree changes must be preserved.
Runtime model/token usage: unavailable in current runtime.

## One next step

Run the full fake-only detached suite in a supervisor session permitted to create
Win32_Process instances, then review the mirror before installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File claude/bin/tests/codex-do-detach-selftest.ps1
```
