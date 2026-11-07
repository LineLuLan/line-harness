# Claude Code Adapter - Line's Machine

The shared rulebook is `~/.codex/AGENTS.md` (team policy version 1.0 plus Line's personal addendum, section 15). Read it first. This file adds only Claude-harness detail for this machine. When the two files differ, `AGENTS.md` wins.

@C:/Users/ADMIN/.codex/AGENTS.md

## Harness Mapping

| Claude Code | Codex |
| --- | --- |
| `~/.claude/CLAUDE.md` (this file) | `~/.codex/AGENTS.md` |
| `~/.claude/settings.json` | `~/.codex/config.toml` |
| `~/.claude/hooks/*` | `.codex/hooks.json` (per repo) |
| `~/.claude/skills/` | `~/.codex/skills/` |

- The shared bank is installed on both sides from `D:\01_Workspaces\SKILLs-repository\_shared\` via `install-bank.ps1`. Reinstall with `-All` after bank updates. Replaced versions sit in `skills\.replaced-<timestamp>\`.
- Two bank skills carry the `cx-` prefix on this side (`cx-code-review`, `cx-verify`) because the plain names collide with Claude Code built-ins.
- MCP servers, verdicts, and usage rules: `D:\01_Workspaces\SKILLs-repository\_shared\MCP-GUIDE.md`. Active here: context7, github, codegraph, langfuse, neon, plus claude.ai connectors. fetch, sequential-thinking, and codex (MCP; `codex mcp-server` removed from Codex CLI, retired 2026-10-01) are removed.

## Worker Dispatch

Two paths; pick by task shape:

1. One-shot bounded tasks — the lean helper:
   `powershell -NoProfile -File C:\Users\ADMIN\.claude\bin\codex-do.ps1 -Dir <repo> "<packet>"`
   No MCP spawn (measured 48.7s to 12.6s). `-Fast` drops effort to medium for mechanical edits (Line 2026-09-06: medium, not low, for stable output). `-Sandbox read-only` for analysis. Multi-line packets pass through stdin automatically (the command line truncates at the first newline - patched 2026-08-06). Long specs: always `-SpecFile <path>` — quotes in an inline spec argument kill the run (verified 2026-08-09).
   Codex accounts (2026-09-28): `codex-acc.ps1 list|status|add <name>|login <name>|use <name>|run|env` keeps one CODEX_HOME per account under `~/.codex-accounts/<name>` (main = `~/.codex`); never copy auth.json. `codex-do.ps1` and `codex-review.ps1` use the active account, or `-Account <name>` per call. Switching is manual (Line). acc1/acc2 snapshots in `~/.codex/accounts` are dead and reserved.
   Multi-turn (2026-10-01): every codex-do run prints `session: <uuid>`. `-Resume <uuid>` (or `-Resume last`) continues that worker session with its transcript (`codex exec resume`; same model, effort, sandbox, account). Resume ONLY to continue the same packet: answer a STOP RULE blocker or fix after a review FAIL. A new packet always starts a fresh session; reviewers are always fresh sessions; after 3 resumes of one session start fresh (context rot).
   Detached by default (2026-10-10): codex-do launches the worker through WMI (outside Claude Code's process tree) with a run folder `~/.claude/state/runs/<runId>` (stdin, out.log, exit.txt, run.json, tree.json, session.txt). If the background task running codex-do is stopped (Esc, session end, low memory), the worker keeps running: reconnect with `-Attach <runId|last>`, stop it with `-Cancel <runId|last>` (exact-PID tree from tree.json only). The Dir lock refuses a second dispatch while that run's tree lives and prints both commands. `-Attached` restores the old in-tree launch per call. Codex sub-agents are disabled by default (`--disable multi_agent --disable multi_agent_v2`) so sessions stay resumable; `-AllowSubAgents` re-enables them. Self-tests: `bin/tests/codex-do-detach-selftest.ps1` (97 assertions) and `codex-do-resume-selftest.ps1`; the worker sandbox blocks WMI, so the supervisor runs the detached test.
   Reliability (2026-10-12): every dispatch and review first runs a 1-second sandbox preflight (`codex-sandbox-lib.ps1`): elevated, else unelevated (still blocks writes outside -C), else exit 73 without a model call. `-NoSandboxFallback` (or `CODEX_DO_NO_FALLBACK=1`) forbids the fallback: use it for Critical-tier work. A finished run whose output has codex's own timestamped router ERROR line for the sandbox exits 72 (review: UNKNOWN). Detached runs fire a Windows toast plus sound when they finish (`codex-run-notify.ps1`, log `~/.claude/state/runs/notify.log`). `codex-do.ps1 -Status [-Hours N]` lists runs as starting, running, STALE (no output 10 min), done, failed, DIED; the statusline shows running/stale/died counts. Root cause of the 2026-10-12 outage: the Codex desktop app locks its computer-use runtime; its autostart is disabled.
   Current docs (2026-10-12, Line): call context7 (resolve-library-id, then query-docs) before any answer, packet, or edit that depends on a library, SDK, framework, CLI, or external API. Every codex-do packet carries `DOCS CHECKED: <lib> <version> via context7 <date>` or `DOCS CHECKED: n/a - <reason>`; the PreToolUse hook `hooks/packet-docs-guard.ps1` denies a dispatch without it (-Status/-Attach/-Cancel/-Resume exempt). Scheduled task `MCP-Weekly-Update` (Mondays 09:00, headless) runs `bin/mcp-weekly-update.ps1`: bumps pinned MCP npm versions in `~/.codex/config.toml` (backup `config.toml.bak-mcpweekly-*`, keeps 4, validates with `codex mcp list`, restores on failure), log `~/.claude/state/mcp-weekly-update.log`, toast on change; codegraph's global install is report-only (`codegraph upgrade` with no Claude session open). Claude-side context7 runs `@latest`. codex-review disables every MCP server that has a `[mcp_servers.<name>]` table (plugin servers have none; overriding them breaks the config).
   The worker writes only inside its `-Dir`. Any copy or install outside that boundary is the supervisor's step, after verification (verified 2026-08-09: a sandboxed worker cannot write to the home directory).
2. Long or open-ended tasks — the official plugin:
   Write every Windows path in a plugin prompt with forward slashes: the rescue forwarder strips backslashes (verified 2026-10-01: the .claude\bin path arrived as C:UsersADMIN.claudebin and the worker refused). `--resume` continues the last rescue thread with memory (verified 2026-10-01 on CLI 0.157.1).
   `Agent(subagent_type: "codex:codex-rescue")` with background mode; poll `/codex:status <jobId>`; cancel with `/codex:cancel` only when `.job.updatedAt` is frozen for 5 or more minutes while running. `/codex:review` and `/codex:adversarial-review` for review passes.

Before printing a packet, run a packet check: compare SUCCESS CRITERIA and REQUIREMENTS against CONSTRAINTS, NON-GOALS, PATTERNS, and fixtures for any rule that contradicts another (shape caps, schema, fixture content), rewrite each conflict into one rule, confirm the template headings exist (a `SUCCESS CRITERIA:` block is required by codex-review.ps1; 2026-10-09 a packet titled REQUIREMENTS made layer 2 return UNKNOWN), and add a line `PACKET CHECK: ok` (2026-10-09: three worker STOPs in one day came from self-contradicting packets).
Print the full task packet before every dispatch. Verify worker output against the packet checklist; never trust the self-report. Kill worker processes only by exact PID, never by name pattern (incident 2026-08-08: a name-pattern kill destroyed a running delegation).

Shell commands (2026-10-09): long or multi-line commands go through the PowerShell tool or a script file, never the Bash tool (Bash fails with `unexpected EOF` on long commands, also for Line's `!` commands; enforced 2026-10-12 by the PreToolUse hook bash-heredoc-guard.ps1, which denies Bash heredocs). Scheduled tasks must launch through `conhost.exe --headless`, or Windows Terminal opens a window. Claude Code kills the whole process tree of a background task when that task stops (Esc, session end, low memory; verified 2026-10-09 by experiment): never start a long-lived process with Start-Process from a background task; codex-do launches detached through WMI for that reason.

## Model Routing

Supervisor (Line, 2026-09-28): Claude Opus 5.5 high is the session default (settings.json `claude-opus-5-5[1m]`, `effortLevel: high` - Opus 5.5 defaults to medium, keep it explicit). Switch to Claude Fable 5.1 with `/model` for layer-3 verification at Important and Critical, hard root-cause work, and architecture decisions; the layer-2b subagent stays Fable 5.1 so it differs from the worker. Reason: the Fable weekly quota hit 96% on 2026-09-28 while the shared weekly pool sat at 51%. Within a tier, do not downgrade further for cost; supervisor tokens buy judgment.

Worker default: `gpt-6-sol` high on the priority tier for Skip and Standard-A. `gpt-6-astra` high for Standard-B, Important, and Critical (`-Model gpt-6-astra`); `gpt-6-astra` xhigh when a high attempt fails. Standard splits by task shape, decided and written into the packet header before dispatch: Standard-A = one or two files, a runnable VALIDATE (test, build, or diff-against-fixture), single-branch logic, worked input/output examples in the packet. Standard-B = any of: three or more files, a long command chain (build, migrate, docker, start a service then probe it), the worker must discover context in the repo, VALIDATE is missing or vague, or Sol already STOPped or FAILed on a similar task. Exploration: `gpt-6-luna` max first (tier 1), `gpt-6-sol` ultra for synthesis (tier 2). Pass `-Model <slug>` and `-Effort <level>` to codex-do.ps1 and codex-review.ps1. The `gpt-5.6-*` line is retired (Codex labels it older; 5.6 promo pricing ends 2026-11-21).

xhigh policy - use `gpt-6-astra` xhigh ONLY for: (1) extremely dangerous work (security, payment, auth, data migration at the Critical review tier); (2) difficult debugging that resists a high attempt; (3) a super-hard task where a high attempt already failed. Never start at xhigh.

| Task type | Model and effort | Dispatch |
| --- | --- | --- |
| Planning, packets, verdict reading, ship, memory, Line-facing replies | Opus 5.5 high (session default) | Inline, any size |
| Layer-3 verification at Important/Critical, hard root-cause, architecture decisions | Fable 5.1 high via `/model` | Inline |
| Standard-A: one or two files, runnable VALIDATE, single-branch logic | `gpt-6-sol` high, priority | codex-do, foreground, 20-minute timeout |
| Exploration tier 1 - locate, list, count, inventory, single-file reads, bulk mechanical edits | `gpt-6-luna` max, priority (`-Model gpt-6-luna -Effort max`; Luna has no ultra) | Read-only sandbox where possible; signature-first reading (codegraph or line ranges), never whole files just to explore |
| Exploration tier 2 - cross-module synthesis, conflicting evidence, root-cause hypotheses, or a tier-1 answer the supervisor could not confirm | `gpt-6-sol` ultra, priority (`-Model gpt-6-sol -Effort ultra`; there is no GPT-6 Terra) | Same sandbox rules. Start at tier 1 unless the question is synthesis from the start |
| Standard-B: three or more files, long command chains, repo discovery, vague VALIDATE, or a prior Sol STOP/FAIL | `gpt-6-astra` high, priority (`-Model gpt-6-astra`) | codex-do, foreground, 20-minute timeout |
| Multi-file, API contract, shared module (Important tier) | `gpt-6-astra` high, priority (`-Model gpt-6-astra`) | codex-do, foreground, 20-minute timeout |
| Security, payment, auth, migrations | `gpt-6-astra` high, priority + Critical gates (two passes, human approval, no autopilot, no background) | codex-do, foreground only |
| Super-hard fallback | `gpt-6-astra` xhigh, priority, one attempt with checklist (`-Model gpt-6-astra -Effort xhigh`) | Then stop and replan |
| Long multi-turn or open-ended worker sessions | per rows above | codex-rescue plugin (background, app-server); the codex MCP server path is retired |

Hard-work phase map (algorithm, debugging, integration, phase-by-phase owners): `D:\01_Workspaces\SKILLs-repository\CLAUDE.md`, section "Hard Work - Phase Map".

## Paid API Budget

OpenRouter credits (`OPENROUTER_API_KEY` in `.env.local`) pay for exactly one thing: runs of the model under test, `openai/gpt-6-luna` (classifier + chat in eval v3). Nothing else goes to OpenRouter: no judge panel, no labelling, no probe of another model, no "pilot". Judge panels (Opus 5.5, GPT-6 Astra, GPT-6 Sol, GPT-6.1 Sol) run on subscription quota as Claude CLI subagents (Agent tool, model opus) and Codex sessions (codex-do packets), as the 2026-10-08 panel did. "chạy" or "chạy pilot" never widens this; an exception exists only when Line names the model and the budget in the current conversation, and the command then carries `OPENROUTER_GUARD_OVERRIDE=1`. Enforced by the PreToolUse hook `hooks/openrouter-model-guard.ps1` (denies `label-judges.mjs` real runs, `run-panel.ps1`, and any OpenRouter command naming a non-Luna model id). Incident: 2026-10-25, a 40-row judge pilot sent to OpenRouter cost 0.94 USD from the wallet.

## Review Gate

The implementer never grades itself. Three layers, each of a different nature, and the supervisor layer is mandatory at every tier (Line, 2026-09-08: "Codex checking Codex can both be wrong"):

1. Deterministic gates (no model): typecheck, lint, secret scan, console.log scan. Run by `codex-review.ps1` before any model review.
2. Model review in a fresh session: sees only the diff and the packet SUCCESS CRITERIA, answers PASS or FAIL with file:line evidence. Same model as the worker counts as a different context, not a different mind; it is the weakest layer.
3. Supervisor verification (Fable, a different model and provider): compare the diff against EVERY SUCCESS CRITERIA line, re-run VALIDATE yourself, and execute the change at least once for real (run the script, hit the endpoint, render the page). Reading is not verification. This layer never gets skipped and never gets delegated back to Codex.

On FAIL the worker fixes and a NEW reviewer session runs; never reuse a reviewer session. After 3 FAILs stop and report to Line. The supervisor reads the verdict, holds the evidence, and decides to ship; no reviewer ships.

| Tier | Trigger | Reviewer | Command |
| --- | --- | --- | --- |
| Skip | diff under about 20 lines of config, typo, rename, docs | layer 3 only (supervisor runs VALIDATE) | - |
| Standard-A and Standard-B | everything else (see Model Routing for the A/B split; the worker model differs, the review does not) | layers 1+3 only (Line, 2026-09-08: routine work does not earn a model review). Supervisor MAY run layer 2 when the diff exceeds about 150 lines or touches multi-branch logic, and must log why in the ledger | `codex-review.ps1 -Dir <repo> -SpecFile <packet> -SkipModel` for gates only; drop `-SkipModel` to add layer 2 |
| Important | multi-file, API contract, shared module | layers 1+2 (`gpt-6-astra` high, fresh Codex session; layer 2 is mandatory here - the ledger on 2026-09-19 showed 6 of 11 Important tasks skipped it) + one Fable 5.1 subagent in a fresh context (different provider), then layer 3 | `codex-review.ps1` then `Agent(general-purpose)` with diff + criteria |
| Critical | security, payment, auth, migration | Important + Line approves in writing | same, then wait for Line |

`codex-review.ps1` runs the deterministic gates first (typecheck or lint when the repo defines them, secret and console.log scan of the diff), then `codex review` in a fresh session with the diff and the packet criteria embedded in the prompt (the CLI rejects scope flags together with a custom prompt); verdict = explicit VERDICT line, else any [P0]/[P1] finding = FAIL, else PASS. Reviewer instruction: report only gaps that affect correctness or the stated criteria; style is optional. Keep Fable quota for judgment work: Standard tier never spends Claude tokens.

Review ledger (decided 2026-09-08): after every delegated task append one line to `~/.claude/state/review-ledger.log`: `date|tier (Skip, Standard-A, Standard-B, Important, Critical)|layer2 ran? (yes/no)|defects found by L1|by L2|by L3|note (name the worker model)`. After 20 Standard-B entries compare defect counts against Standard-A to decide whether Astra earns its cost there. After 20 entries the supervisor reports the catch rate per layer to Line and the tier rules get adjusted by that data, not by feel.

## Context Thresholds

Under 60 percent: proceed. 60-69: checkpoint. 70-79: offer `/handoff` before a major task. 80 or more: handoff or fresh session is mandatory. Enforced by the `context-guard.ps1` prompt hook since 2026-09-08: the statusline writes the percentage it renders to a cache the hook reads. Compaction rules: the `strategic-compact` skill.

## Timeout Doctrine

Measure heartbeats, not wall clocks. A slow job and a dead job are different things.

- Path 1 (codex-do, background): the task output file is the heartbeat. Its last-write time still moves = the job is alive; let it run. Unchanged for 5 or more minutes while the process exists = zombie; stop it by exact PID and salvage.
- Path 1 (foreground): only for tasks expected under 5 minutes, with the 20-minute cap. Never foreground a task that might outgrow the cap.
- Path 2 (codex-rescue): poll `.job.updatedAt` per AGENTS.md section 3.
- On any timeout or kill: check for partial results FIRST ([founder]'s salvage rule). Finished files beat a rerun.
- Every packet carries STOP RULES ([teammate A]'s rule) so a confused worker reports and halts instead of grinding.

## Thinking Ladder and Output Diet

Match reasoning depth to risk (from [teammate N]'s ladder, adopted 2026-08-09):

| Work | Trigger to use |
| --- | --- |
| Normal implementation | none |
| Multi-step logic, edge cases, API design | "think hard" |
| Architecture decisions, complex debugging | "think harder" |
| Security, payment, migrations, critical production code | "ultrathink" |

Output diet — command output is context budget (from [teammate N]'s RTK principle):
- Cut command output before it enters context: tail the last 30 lines, or show failures only.
- Never paste a full log when one summary line answers the question.
- Read files by line range when the target is known. Do not read whole files to explore.

## Interview-First Rule

Before starting work, interview Line with concrete options (plan-mode style: 2-4 questions, each with choices, the recommended choice first) when ANY of these is true:

1. The request has two or more readings, and a wrong guess costs rework.
2. A real fork exists: several valid approaches with different trade-offs (model choice, architecture, scope, priority).
3. The task is large: a new feature, a new spec, or a system change. Open with the interview to lock intent before planning.

Otherwise do not ask. Clear bounded tasks proceed directly. Minor choices (naming, formatting, defaults) are decided and noted, not asked. Autonomous and background runs never block on questions.

## Startup Checklist

1. Confirm the working directory and target project.
2. Read the nearest repository `AGENTS.md` and the newest `.handoff/` file.
3. Route the task through `team-router` (TwoHearts work goes to `twohearts-engineering-standards` first).
4. Check context usage before a major task.
5. State the plan before the first tool call.

## Active Hooks on This Machine

| Hook | Trigger | Purpose |
| --- | --- | --- |
| `codex-delegation-reminder.ps1` | UserPromptSubmit | Re-injects the delegation hard rule every turn |
| `context-guard.ps1` | UserPromptSubmit | Reads the statusline context cache (ctx-<session>.json under the ultrathink-status temp dir) and injects CHECKPOINT (60-69%), OFFER HANDOFF (70-79%), or HANDOFF MANDATORY (80%+); silent below 60% or when the cache is older than 15 min (added 2026-09-08) |
| `codex-job-watcher.ps1` | SessionStart | Optional beep when a plugin job finishes |
| `codegraph-init-check.ps1` | SessionStart | Suggests one-time `codegraph init` in unindexed repos |
| `track-tools.js` | PostToolUse | Feeds the UltraThink statusline |
| `notify-sound.ps1` | Notification, Stop | Plays D:\04_Assets\dragon-studio-new-notification-3-398649.mp3 — 1x when waiting for Line, 3x when a task finishes (beep fallback if the file is missing) |

Settings backups: `settings.json.bak-*`. Machine snapshot before go-live: `D:\Backups\machine-snapshot-2026-08-08.zip` (555 MB). Old rulebooks: `AGENTS.md.bak-golive`, `CLAUDE.md.bak-golive`.
