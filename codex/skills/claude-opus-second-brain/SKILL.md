---
name: claude-opus-second-brain
description: Safe Codex-to-Claude integration for using Claude Code Opus 5 high by default, with Fable 5.1 medium then Opus 4.8 medium as fallbacks, as a second brain, reviewer, planner, audit writer, architecture critic, root-cause debugging partner, migration-risk reviewer, or adversarial code reviewer. Use when the user asks for Claude/Fable/Opus support from Codex, when important docs/plans/audits should be structured by Claude before Codex codes, when a task benefits from independent model critique, or for high-risk/repo-rule-sensitive work where a Claude review can catch planning, format, tenant-isolation, migration, security, or verification gaps.
---

# Claude Opus Second Brain

## Known Limitation — Sandboxed `codex exec` (verified 2026-08-06)

When this wrapper is invoked from INSIDE a sandboxed `codex exec` run (workspace-write),
the nested `claude` CLI hangs with zero output until timeout (exit 124): the sandbox blocks
the child process from reaching `~/.claude` credentials/state outside the workdir. The same
call succeeds in ~12s outside the sandbox. Therefore:

- Call this skill from the Codex desktop app / `codex` MCP session (full config), or from
  `codex exec -s danger-full-access` — NOT from a workspace-write `codex exec`.
- If you must stay sandboxed, skip the Claude review, say so honestly
  (`Not verified: Claude review unavailable in sandbox`), and continue the normal Codex path.
- Always bound the call with your own timeout (~120s) so a hang cannot stall the task.

Use this skill when Codex should ask Claude Code for an independent plan, audit, or
review without letting Claude modify files. The wrapper prefers Claude Opus 5 at `high`
effort, then retries with Claude Fable 5.1 at `medium`, then Claude Opus 4.8 at `medium` for
retryable model, context, capacity, rate-limit, or availability failures. Claude may
read/search the same non-secret target workspace files Codex is using, but Codex remains the
primary implementer; Claude is the structure author, critic, planner, and reviewer.

## What Already Exists

Claude Code is configured in `C:\Users\ASUS\.claude\CLAUDE.md` with the opposite direction:

- Claude owns planning, root-cause debugging, review, and orchestration.
- Codex GPT-5.5 owns implementation and git/GitHub work.
- Claude can call Codex through the `codex` MCP server or
  `C:\Users\ASUS\.claude\bin\codex-do.ps1`.

This skill adds the Codex side: Codex can call Claude as a read-only second brain, then
implement only after reconciling Claude's structure with repo docs and source files.

## Safe Default

Use the bundled script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ASUS\.codex\skills\claude-opus-second-brain\scripts\ask-claude-opus.ps1 "<prompt>"
```

Default behavior:

- Calls `claude --model claude-opus-5 --effort high --print`.
- Fallback 1: `claude --model claude-fable-5 --effort medium --print`.
- Fallback 2: `claude --model claude-opus-4-8 --effort medium --print`.
- Does not retry on auth, login, budget, or permission errors because fallback cannot fix those.
- `-Effort <level>` remains available for compatibility and overrides only the primary Opus 5
  effort. Prefer the defaults unless the user asks otherwise.
- Lets Claude read/search non-secret files in the target directory with `Read`, `Grep`, and
  `Glob`.
- Does not allow edit or shell/Bash tools.
- Uses `--permission-mode plan`.
- Uses `--no-session-persistence`.
- Applies a small `--max-budget-usd` cap.
- Returns plain text plus a `[Claude usage]` summary for Codex to inspect, including the actual
  model used, model ladder, efforts, and fallback reason. Use `-OutFile <path>` when shell
  capture is unreliable and `-UsageFile <path>` to persist structured usage.

## When To Ask Claude

Ask Claude for:

- Important docs, standards, plan, audit, or release-readiness structure.
- Repo/org-specific formatting and rule compliance for important documents.
- Architecture or implementation plan critique.
- High-risk backend review: tenant isolation, auth, permissions, migrations, secrets, queues,
  workers, webhooks, production behavior.
- Root-cause debugging when there are competing hypotheses.
- Diff review before finalizing a meaningful change.
- Test strategy review when coverage or verification is unclear.
- TwoHearts work where an independent Claude review can catch standards violations.

Do not ask Claude for trivial one-line edits, simple formatting, or tasks where the
cost/latency is not worth it.

## Collaboration Loop

1. Codex scouts the repo and gathers exact context: relevant docs, current code, existing
   patterns, constraints, and target output format.
2. Codex asks Claude to produce or critique the structure: plan, audit, implementation spec,
   risk register, or review checklist.
3. Codex verifies Claude's output against source files and repo rules. If Claude conflicts
   with the source, trust the source and ask a focused follow-up or reconcile explicitly.
4. Codex implements only from the verified structure.
5. For meaningful code/docs changes, Codex asks Claude to review the final plan or diff before
   completion, then runs the repo's actual verification commands.

Claude output is not authority by itself. It is a high-quality review signal that Codex must
ground in evidence.

## Prompt Shape

Pass only the relevant context and target directories. Never include secrets, production
credentials, raw `.env` values, private keys, tokens, or sensitive customer data. Claude may
read/search non-secret files in those directories, but must not read `.env`, `.env.*`,
private keys, token files, credential stores, or production secret stores unless Codex states
the user explicitly requested that exact safe action.

Use this structure:

```text
You are reviewing as Claude Opus 5 high for Codex. If the wrapper reports a fallback, you may
be reviewing as Claude Fable 5.1 medium or Claude Opus 4.8 medium.

Objective:
<what Codex is trying to do>

Context:
<relevant files, snippets, plan, or diff>

Constraints:
<safety, repo standards, tenant/data rules, no-file-edit requirement>

Please return:
1. Recommended structure or plan
2. Blocking issues
3. Risks and missing evidence
4. Repo/org rule or format concerns
5. Simpler/cleaner approach if any
6. Verification recommendations
```

## Read-Only Repo Inspection

Use `-Dir` to point Claude at the relevant trusted project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ASUS\.codex\skills\claude-opus-second-brain\scripts\ask-claude-opus.ps1 -Dir D:\01_Workspaces\TwoHearts "<prompt>"
```

Use `-AddDir` for extra trusted roots. Use `-NoReadTools` only when Claude should review
provided context without filesystem access. Use `-OutFile work\claude-response.txt` when Codex
needs to read the response from disk. Use `-UsageFile work\claude-usage.json` when Codex needs
structured usage data for final reporting.

Only use this on trusted local repos. It allows Claude read/search tools, not edit or shell
tools.

## Decision Rule

Treat Claude output as advice, not authority. Codex must still verify against source files,
repo instructions, tests, and user goals. If Claude recommends a risky operation, Codex must
apply normal safety gates before acting. If Claude was not actually called, say so plainly.

For final task summaries, report Claude usage exactly from the wrapper when Claude was called:
model, effort, `total_tokens_used`, input tokens, output tokens, cache read/create tokens, and
cost. `total_tokens_used` is the sum of input, output, cache-read, and cache-creation token
buckets. Do not estimate missing usage numbers.
