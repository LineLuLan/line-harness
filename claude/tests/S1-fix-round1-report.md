# S1 dispatcher fix round 1 - Line - 2026-11-13

Resolved all four supplied conflicts. Retained live resume model/effort inheritance,
the case-sensitive user-thread filter, full-packet review context, and Write-ReviewLog.
The live review log fields and CODEX_REVIEW_LOG override remain intact, including
logging gates-only runs. Get-ReviewFindings now supplies severity/location/title;
Write-ReviewRecord was removed. Verdict fallback retains the bracketed P0/P1 rule.

Packet lint now accepts annotated markers, combined known headings, numbered and
inline-code commands, the requested executable forms, and justified read-only n/a
validation. Observed read-only n/a explanations in parentheses are also accepted.
Cleanup checks both timestamps on every candidate item, clears read-only attributes,
continues after candidate failures, and reports/logs those failures. AllowSubAgents
suppresses the appended prohibition. Exit publication precedes sub-agent telemetry.
Ledger enums are canonicalized and all requested line separators are rejected.

## Corpus measurement

Read-only scan of all 221 stdin.txt files under
`C:\Users\ADMIN\.claude\state\runs`. No packet contents were copied into this report.
The baseline was measured before changing packet-lint.ps1 in this round.

| Error | Before | After |
| --- | ---: | ---: |
| Packet exceeds 8 KB | 82 | 82 |
| Missing PACKET CHECK: ok | 81 | 24 |
| Missing CHECKLIST: ok | 71 | 67 |
| Missing GOAL | 22 | 22 |
| Missing SUCCESS CRITERIA | 25 | 25 |
| Missing FILES | 34 | 34 |
| Missing CONSTRAINTS | 55 | 39 |
| Missing DONE WHEN | 36 | 36 |
| Missing VALIDATE | 44 | 44 |
| Missing STOP RULES | 29 | 29 |
| Missing DOCS CHECKED | 2 | 2 |
| No runnable VALIDATE command | 103 | 55 |
| Unique rejected packets | 194 | 168 |

Error groups overlap. Rejections fell by 26 packets (13.4% of baseline rejections).
Of the remaining 55 command errors, 44 also lack a VALIDATE heading. The other 11
contain prose (7) or unresolved interpreter placeholders (4). Four packets are
rejected solely for non-runnable validation. The target of only size and missing
heading/marker failures is therefore not fully met; accepting these would relax
the original runnable-command requirement. No such exemption was added.

Reproduce current counts:
`powershell -NoProfile -ExecutionPolicy Bypass -File claude/tests/measure-packet-lint.ps1`

## Verification and remaining work

Verified: all six test scripts pass under Windows PowerShell 5.1 (168 assertions).
Tests cover the requested syntax, live resume inheritance, source filtering,
exit-before-scan ordering, review log compatibility and actual gates-only logging,
cleanup age/readonly/failure handling, and ledger normalization/separator rejection.
Cleanup removal is mocked; no cleanup -Apply or Codex worker was launched.

Not verified: live WMI dispatch, desktop notifications, actual cleanup deletion,
and independent supervisor review. Confidence is high for the local fixture paths.
The next step is supervisor review and host smoke tests before installation.
The earlier harness-reference.md notes describe the superseded counts field in
reviews.jsonl; updating that document is outside this fix packet's file scope.

No model calls were made. Runtime overhead was not benchmarked; telemetry can no
longer delay publication of the worker exit. Live-file rollback remains the
supervisor's live-pre-S backup; this work is uncommitted in the mirror.

usage: unavailable in current runtime
