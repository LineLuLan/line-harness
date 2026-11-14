# Packet Checklist (Important and Critical)

Packets stay under 8 KB; split bigger work.
VALIDATE has at least one runnable command.

Run this list before you dispatch an Important or Critical packet. Fix each gap in the packet, then add the line `CHECKLIST: ok`. The `codex-do.ps1` lint enforces `DOCS CHECKED` and, for Important/Critical packets, `CHECKLIST: ok`. Lint errors exit with code 74.

Source: `~/.claude/state/review-ledger.log` (355 entries, 2026-09-07 to 2026-11-12) and `reviews.jsonl` (6 rows; the findings arrays are empty, so only the gate results count). Counts are keyword matches on the ledger notes: read them as a rank, not as exact numbers. Mined 2026-11-12. Re-mine after about 50 new ledger lines.

1. check: no criterion contradicts another criterion, a CONSTRAINT, a fixture, or an existing test; every term has one meaning (seen 42 times, e.g. a fixed limit of 6 against a recorded value of 18; a fixture that implied 3 changed rows, not 2).
2. check: VALIDATE runs inside the worker sandbox, or the packet says which steps the supervisor runs on the host (seen 20 times, e.g. vitest spawn EPERM, tsx ENOMEM, no network for a dependency download).
3. check: the packet has STOP RULES plus a salvage note, and asks for a fresh session, not a resume, after a sub-agent thread (seen 20 times, e.g. the worker was killed by the low-memory reaper after it wrote all files; a resume failed on a sub-agent id).
4. check: UI work names the widths to test (320, 400, 640, 1024, 1440) and says "no horizontal overflow, no clipped text" (seen 20 times, e.g. a header wrapped at 360-429 px; a table overflowed at 1440x900).
5. check: docs work says "STE: short sentences, active voice, no non-STE words" and names the STE check (seen 20 times, e.g. two non-STE words in a README; a 27-word sentence in a decision record).
6. check: the packet names the file encoding (UTF-8 without BOM, LF or the repo's line ending) when it touches non-ASCII text (seen 18 times, e.g. Vietnamese phrases turned to mojibake from the spec encoding; Set-Content added a BOM).
7. check: docs that quote counts, file names, or rules are in FILES, so the worker updates them with the code (seen 14 times, e.g. a README count stayed at four after a fifth item; a README paragraph still contradicted the fix).
8. check: every value comes from its source of truth (config, API, data), and every fallback is named; no silent default (seen 13 times, e.g. hard-coded methodology values in a report; a rule count used defaults, not clients).
9. check: concurrency, cache, and ordering behaviour is stated, with a test for each (seen 13 times, e.g. cache poisoning during seeding; a heartbeat that used up the rate limit; a lock-file replace race).
10. check: test fixtures use dummy values shorter than the secret-gate pattern and no console.log (seen 13 times, e.g. a dummy key of 8 or more characters tripped the secret gate; console.log in a test note).
11. check: at least one criterion runs the real path (real stack, real data, or a real run), not only mocks or holds (seen 12 times, e.g. a step queried mock calls by name while the mock filed them by slug, and both holds used one value).
12. check: VALIDATE runs the repo formatter, lint, and typecheck on the changed files (seen 11 times, e.g. unformatted files, an E501 line in a breadcrumb, pyright errors in a test).
13. check: build and run steps name every required env var and tool (seen 9 times, e.g. a web build without NEXT_PUBLIC_API_URL; jq not on PATH in the worker shell; a stale .next cache).
14. check: FILES and NON-GOALS fence the scope, and the packet says "do not rewrite lines outside the change" (seen 8 times, e.g. the worker rewrote 11 existing doc rows shorter; a container width changed from page width to 1440).
15. check: PowerShell scripts target 5.1 traps: array unroll in ConvertFrom-Json and @(...), quoting of paths with spaces, $PSScriptRoot in param defaults (seen 7 times, e.g. @(Invoke-RestMethod) nested the JSON array so readiness never passed).
16. check: PowerShell syntax checks in VALIDATE call `powershell -NoProfile -File ~/.claude/bin/ps-parse-check.ps1 <file...>` (exit 0 = clean), never an inline `ParseFile(...,[ref]$null,[ref]$e)` one-liner (seen 2 times, E1 and E2: the outer shell expanded `$e` to empty, so the check could never fail).
