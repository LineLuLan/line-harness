---
name: codex-gpt6-astra
description: "GPT-6 Astra (gpt-6-astra) is available in Codex on Line's machine since 2026-09-06 after upgrading Codex CLI 0.147.0 -> 0.153.4; Astra is now the default worker (codex-do.ps1, config.toml, CLAUDE.md routing) since 2026-09-06; Luna stays for exploration"
metadata:
  type: project
---

On 2026-09-06 Line asked to check for the new GPT model. GPT-6 Astra shipped 2026-09-03 (slug `gpt-6-astra`). The machine did not see it because Codex CLI was 0.147.0; Astra needs 0.153.1+. Upgraded npm-global `@openai/codex` to 0.153.4 (Line's order, 2026-09-06). Smoke test `codex exec -m gpt-6-astra` returned correctly with ChatGPT sign-in.

Facts verified 2026-09-06 (Codex models cache + OpenAI changelog):
- Efforts: low, medium, high, xhigh, max, ultra. Default medium. Codex reports 272k context (API sheet says 1.05M).
- Fast/priority tier on Astra = "2x speed, increased usage" (Sol was 1.5x).
- API price: $10/M in, $1/M cached, $50/M out; above 272k context input x2, output x1.5.
- Sol and Terra also gained an `ultra` effort level.
- Leftover dir `%APPDATA%\npm\node_modules\@openai\.codex-JQ6LwBuE` holds the old 0.147.0 exe still used by running processes; safe to delete once no codex.exe from it is running.

**How to apply (Line decided 2026-09-06):** Astra replaced Sol everywhere Sol was pinned: `codex-do.ps1` (`gpt-6-astra` high, `-Fast` = medium), `~/.codex/config.toml` (`gpt-6-astra`, high, priority; was Luna xhigh), and the CLAUDE.md Model Routing rows for backend, security, and super-hard fallback. Luna xhigh stays for exploration and bulk mechanical edits. Backups: `*.bak-20260906-*` next to each file. Both paths smoke-tested (header shows `model: gpt-6-astra`). If usage burns too fast, the cheap rollback is `-Fast` more often or Luna for routine work. See [[codex-claude-ecosystem]].
## Rollback 2026-09-08 (Line decision)
Astra burned the shared Codex weekly allowance: 44 sessions on 2026-09-08 morning took the devteam account from 0% to 30% in 2.3 hours; measured 6.5 limit-points per million uncached+output tokens on 09-07 vs 5.1 on the Sol day, and 13.5 on 09-08 after OpenAI reset the window at 08:24 (reports of Astra allowance cuts around 09-06/07, unconfirmed). Line: "tắt Astra, đợi ổn định". New rule: worker default `gpt-5.6-sol` high, Sol xhigh when high fails; `gpt-6-astra` ONLY for Critical (pass `-Model gpt-6-astra` to codex-do.ps1 or codex-review.ps1). config.toml back to Sol high. Revisit when the weekly window resets (09-15) by checking limit-points per million tokens again.

## Routing change 2026-09-19 (Line decision)
Line widened Astra again and replaced Luna for exploration:
- Skip, Standard: `gpt-5.6-sol` high (unchanged).
- Important and Critical: worker and layer-2 reviewer `gpt-6-astra` high (`-Model gpt-6-astra`).
- Super-hard fallback after a failed high attempt: `gpt-6-astra` xhigh (`-Model gpt-6-astra -Effort xhigh`), one attempt.
- Exploration, evidence gathering, bulk mechanical edits: `gpt-5.6-terra` ultra (`-Model gpt-5.6-terra -Effort ultra`). Luna is no longer routed anywhere. Terra supports low..ultra (models cache 2026-09-18); Luna tops out at max.
- `codex-do.ps1` gained `-Effort` (ValidateSet low..ultra, wins over `-Fast`); before this the script could not reach xhigh or ultra, which is why a Luna run on 2026-09-12 went out at high. Smoke-tested 2026-09-19: header `model: gpt-5.6-terra`, `reasoning effort: ultra`.
- Not re-measured yet: Astra limit-points per million tokens after the 2026-09-15 window reset. Measure on the next real Important or Critical task, not with probe runs. Terra ultra cost on the shared weekly allowance is also unmeasured.
- Ledger summary reported to Line 2026-09-19 (67 tasks): Standard layer 2 ran 18 times and caught 0; Important layer 2 caught 4, Critical about 10; layer 3 caught the most at every tier. Layer 2 is mandatory at Important from now on (6 of 11 Important tasks had skipped it).

## Same-day corrections 2026-09-19 (Line)
- Important reverted to `gpt-5.6-sol` high (worker and layer-2 reviewer). Astra stays for Critical (high) and the super-hard fallback (xhigh).
- Exploration is two-tier: tier 1 (locate, list, count, single-file reads, bulk mechanical edits) = `gpt-5.6-luna` xhigh; tier 2 (cross-module synthesis, conflicting evidence, root-cause hypotheses, or an unconfirmed tier-1 answer) = `gpt-5.6-terra` ultra. Measured on one read-and-list task: both 10/10 + 4/4 correct; Luna 114 s, 18k uncached in, 8k out, $0.014 at API prices; Terra ultra 230 s, 2 sessions, 84k uncached in + 474k cached, 23k out, $0.539.
- Codex weekly allowance read 84% used at 2026-09-19 during the benchmark.
- Later on 2026-09-19 Line raised tier 1 from Luna xhigh to Luna `max` (the top level Luna supports; Luna has no ultra). The benchmark numbers above were measured at xhigh; max is unmeasured.

## Benchmark 2026-09-19 (one run per config, small tasks, API prices of 2026-09-18: Astra 10/1/50, Sol 4/0.4/20, Terra 2/0.2/12, Luna 0.2/0.02/1.2 per 1M in/cached/out)
Explore task (list exit codes + env vars of codex-review.ps1, ground truth 10 + 4): Luna xhigh 10/10+4/4, 114 s, $0.014; Terra ultra 10/10+4/4, 230 s, 2 sessions, $0.539.
Code task (parseDuration + tests, 38 hidden tests held by the supervisor): all four passed 38/38. Sol high 279 s, 3 sessions, 68k uncached / 1.24M cached / 14.6k out, $1.064. Sol xhigh 193 s, $0.645. Astra high 109 s, 38k / 253k / 4.3k, $0.843, 56 LOC. Astra xhigh 191 s, $1.231.
Reading: on this task Astra high was the fastest and cheaper than Sol high at API prices (fewer tokens); Sol high vs xhigh order is noise-level with n=1. Whole benchmark moved the weekly allowance 84% -> 85%.
Cost effect of the final 2026-09-19 routing vs the 09-08 routing, weighted by the real dispatch mix since 09-08 (57 Sol, 14 Astra, 1 exploration, 0 xhigh fallbacks in 73): about +1% if the one exploration goes to Terra ultra; about +3-4% if 1 in 20 tasks needs the Astra xhigh fallback (+91% per such task vs Sol xhigh). Luna max unmeasured.

## 2026-09-28 check
GPT-6 Sol and GPT-6 Luna released 2026-09-22 (Sol $2/$0.20/$10, Luna $0.10/$0.01/$0.50 per 1M in/cached/out; no GPT-6 Terra). Need Codex CLI >= 0.156.1 to see them; this machine is on 0.153.4 (npm latest 0.157.1). Codex now labels the 5.6 line "older". Proposed to Line (not yet approved): upgrade CLI, verify slugs, then route Skip/Standard/Important + layer-2 reviewer -> GPT-6 Sol high, exploration tier 1 -> GPT-6 Luna max, tier 2 -> GPT-6 Sol ultra, Astra unchanged. Measure limit-points per million tokens on the first real tasks before calling it done.

## 2026-09-28 routing (Line decision, applied)
Codex CLI upgraded 0.153.4 -> 0.157.1; catalog now lists gpt-6-sol (low..ultra) and gpt-6-luna (low..max). Line: "Astra làm worker luôn" + the two exploration tiers as proposed. Applied: codex-do.ps1 default `gpt-6-astra`, codex-review.ps1 default `gpt-6-astra`, config.toml `gpt-6-astra` high priority, CLAUDE.md routing = Astra high at every tier (xhigh fallback), exploration tier 1 `gpt-6-luna` max, tier 2 `gpt-6-sol` ultra. The whole gpt-5.6 line is retired from routing. Risk on record: the 09-08 rollback happened because Astra drained the shared weekly allowance; Line accepted this knowingly. Measure limit-points per million tokens on the first real tasks and report.
- 2026-09-28 test in progress: bench fixtures under the session scratchpad were wiped between 09-19 and 09-28 (dirs kept, files gone); rebuilt PACKET.md x2 + hidden.test.js from the transcript. Three runs dispatched: luna6-max (explore), sol6-ultra (explore), astra-worker (code, default path, no -Model). Results go to bench/runs.txt + summarize.py. If this session dies, rerun those three and compare with the 09-19 table (Luna xhigh $0.014/114 s; Terra ultra $0.539/230 s; Astra high $0.843/109 s, 38/38).
- 2026-09-28 note: the session scratchpad bench/ dir loses files between sessions (only dirs survive); summarize.py and fixtures had to be rewritten twice. If a rerun is needed, rebuild from the transcript notes above rather than expecting the files to exist.

## Routing test 2026-09-28 (after the sandbox fix; API prices 09-18/09-22; weekly allowance 29% before and after all three)
- Astra worker, default path (no -Model): 38/38 hidden tests, 108 s, 2 sessions, 35k uncached / 218k cached / 4k out, $0.771, 55 LOC. Same as the 09-19 Astra high run ($0.843).
- Exploration tier 2, gpt-6-sol ultra: 10/10 + 4/4, 84 s, 1 session, $0.113. Replaces Terra ultra ($0.539, 230 s) at 1/5 the cost and 1/3 the time.
- Exploration tier 1, gpt-6-luna max: 8/10 + 4/4, 155 s, $0.009. Missed the two catch-block exit paths (lines 376, 380). 5.6 Luna xhigh on 09-19 got 10/10 at $0.014 and 114 s. So GPT-6 Luna is cheaper but slightly less thorough on this task; tier-2 escalation rule covers it.

## Final routing 2026-09-28 (Line approved the Standard A/B split)
- Skip, Standard-A (1-2 files, runnable VALIDATE, single-branch logic, worked examples): `gpt-6-sol` high = script and config default.
- Standard-B (3+ files, long command chains, repo discovery, vague VALIDATE, prior Sol STOP/FAIL), Important, Critical: `gpt-6-astra` high via `-Model gpt-6-astra`; Astra xhigh after a failed high attempt.
- Exploration: `gpt-6-luna` max (tier 1) then `gpt-6-sol` ultra (tier 2). Layer-2 reviewer: `gpt-6-astra` (codex-review.ps1 default).
- The sub-tier and a one-line reason go in the packet header before dispatch; ledger header now carries the sub-tier. After 20 Standard-B rows, compare defects vs Standard-A to decide if Astra earns its cost there.
- Why: measured 38/38 for both Sol and Astra on the code task; Astra's edge is long terminal work and fewer fabrications (Terminal-Bench 58 vs 37), not plain code edits. Estimated 30 of 47 past Standard tasks are A; API cost about +15% vs all-Sol instead of ~2x for all-Astra; lower weekly-allowance risk.
- Final-routing test 2026-09-28: Standard-A path (gpt-6-sol high, default, no flag) on the parseDuration task = 38/38 hidden tests, 145 s, 2 sessions, 44k uncached / 373k cached / 6.5k out, $0.227 API; layer-1 gates via `codex-review.ps1 -SkipModel` PASS. Same task on Astra high = 38/38, 108 s, $0.771. Sol6 is 3.4x cheaper at API prices and 34% slower for equal correctness. Weekly allowance stayed at 29% across all four runs today. Full table also lives in bench/runs.txt (scratchpad, may be wiped).
