---
name: review-gate
description: "Review Gate decided by Line 2026-09-07: implementer never grades itself; Standard tier = codex-review.ps1 (gates + fresh `codex review` by gpt-6-astra, Codex tokens only); Important adds a Fable 5.1 subagent; Critical adds Line's written approval"
metadata:
  type: feedback
---

Line asked (2026-09-07) whether another agent checks quality before delivery. Answer then: no, the supervisor graded the worker alone. Line approved a review gate and it is now in `~/.claude/CLAUDE.md` section "Review Gate".

**Why:** senior guidance (Anthropic best practices, cross-model adversarial review, 2026) says the implementer must not grade itself, the reviewer should run in a fresh context and see only the diff + criteria, verdicts should be binary with file:line evidence, and deterministic gates (typecheck, lint, secret scan) belong in scripts, not prose. Line also wants Standard-tier reviews to spend Codex tokens, not the tighter Fable weekly quota.

**How to apply:**
- Skip tier (diff under ~20 lines of config/typo/rename/docs): run VALIDATE only.
- Standard: `powershell -NoProfile -File C:\Users\ADMIN\.claude\bin\codex-review.ps1 -Dir <repo> -SpecFile <packet.md> [-Base <branch>] [-Effort high] [-OutFile <f>]`. Exit 0 PASS, 1 FAIL, 2 not a git repo, 3 UNKNOWN (read output by hand), 4 diff over 400 KB (split the review). Gates run first and stop before Codex on FAIL (secrets, console.log, typecheck/lint when the repo defines them).
- Important: Standard + one Fable 5.1 subagent (`Agent`, fresh context) given the diff and the packet criteria.
- Critical: Important + Line approves in writing.
- On FAIL: worker fixes, then a NEW reviewer run (never reuse). After 3 FAILs stop and report to Line.
- **Line correction 2026-09-08 ("Codex chấm Codex rồi 2 thằng đều sai thì sao"):** the Codex review is layer 2 of 3. Layer 3, the supervisor (Fable) comparing the diff to every criterion, re-running VALIDATE, and executing the change for real, is mandatory at every tier and is never delegated to Codex. Same-model review shares the worker's blind spots; the codex-review build itself proved it (the worker's wrong VERDICT assumption was caught only by the supervisor running it live).
- Same model (Astra) in a fresh session counts as independent; Line rejected using weaker Sol to review Astra.

**Implementation facts (verified 2026-09-08):** `codex review` accepts a custom prompt via stdin `-` but rejects `--uncommitted`/`--base`/`--ignore-user-config` together with a prompt, so the helper embeds `git diff HEAD` (+ untracked files) in the prompt. Review mode ignores the "print VERDICT" instruction and answers in its own format: findings tagged `[P0]`..`[P3]`; a clean diff yields an untagged sentence. Verdict rule in the helper: explicit VERDICT line > any [P0]/[P1] = FAIL > untagged non-empty answer = PASS > empty or "Not verified" = UNKNOWN. Live checks: `a-b` bug -> [P1] + FAIL; comment-only change -> PASS; secret + console.log -> gates FAIL without calling Codex. Self-test: `~/.claude/bin/tests/codex-review-selftest.ps1` (47 offline assertions + 2 live reviews; run outside the Codex sandbox, the nested Codex cannot find home). Each review appends `epoch|review|model|effort|sessionId` to dispatch-trail.log, so the statusline counts reviews inside the model icon totals.

Related: [[codex-claude-ecosystem]], [[codex-gpt6-astra]], [[ultrathink-statusline]].

**Line decision 2026-09-08 (later the same day):** Standard tier drops layer 2 entirely ("việc cơ bản không thể lỗi quá nhiều"). Standard = gates (`codex-review.ps1 -SkipModel`) + supervisor layer 3. Layer 2 (Codex fresh review) stays for Important and Critical, and the supervisor may add it on a Standard diff over ~150 lines or with multi-branch logic, logging the reason. Ledger `~/.claude/state/review-ledger.log` records per task which layer caught defects; first 3 entries: L3 caught 2, L1 and L2 caught 0. Re-evaluate after 20 entries.

**Model update 2026-09-08:** after the Astra rollback, layer-2 reviewer is `gpt-5.6-sol` high by default; `-Model gpt-6-astra` only for Critical reviews.

**Model update 2026-09-19:** layer-2 reviewer is `gpt-6-astra` high at Important and Critical (`codex-review.ps1 -Model gpt-6-astra`); layer 2 is mandatory at Important. The script default stays Sol, so the flag must be passed.

**2026-09-28:** layer-2 reviewer default is now `gpt-6-astra` (script default; no flag needed).
