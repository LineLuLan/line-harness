# Codex Adapter - Line's Machine

The shared rulebook is `~/.codex/AGENTS.md` (team policy version 1.0 plus Line's personal addendum, section 15). Read it first. This file adds only Codex-harness detail for this machine. When the two files differ, `AGENTS.md` wins.

@C:/Users/ADMIN/.codex/AGENTS.md

## Harness Mapping

| Codex | Codex |
| --- | --- |
| `~/.Codex/AGENTS.md` (this file) | `~/.codex/AGENTS.md` |
| `~/.Codex/settings.json` | `~/.codex/config.toml` |
| `~/.Codex/hooks/*` | `.codex/hooks.json` (per repo) |
| `~/.Codex/skills/` | `~/.codex/skills/` |

- The shared bank is installed on both sides from `D:\01_Workspaces\SKILLs-repository\_shared\` via `install-bank.ps1`. Reinstall with `-All` after bank updates. Replaced versions sit in `skills\.replaced-<timestamp>\`.
- Two bank skills carry the `cx-` prefix on this side (`cx-code-review`, `cx-verify`) because the plain names collide with Codex built-ins.
- MCP servers, verdicts, and usage rules: `D:\01_Workspaces\SKILLs-repository\_shared\MCP-GUIDE.md`. Active here: context7, github, codegraph, codex (MCP), langfuse, neon, plus Codex.ai connectors. fetch and sequential-thinking are removed.

## Worker Dispatch

Two paths; pick by task shape:

1. One-shot bounded tasks — the lean helper:
   `powershell -NoProfile -File C:\Users\ADMIN\.Codex\bin\codex-do.ps1 -Dir <repo> "<packet>"`
   No MCP spawn (measured 48.7s to 12.6s). `-Fast` drops effort to low for mechanical edits. `-Sandbox read-only` for analysis. Multi-line packets pass through stdin automatically (the command line truncates at the first newline - patched 2026-08-06). Long specs: always `-SpecFile <path>` — quotes in an inline spec argument kill the run (verified 2026-08-09).
   The worker writes only inside its `-Dir`. Any copy or install outside that boundary is the supervisor's step, after verification (verified 2026-08-09: a sandboxed worker cannot write to the home directory).
2. Long or open-ended tasks — the official plugin:
   `Agent(subagent_type: "codex:codex-rescue")` with background mode; poll `/codex:status <jobId>`; cancel with `/codex:cancel` only when `.job.updatedAt` is frozen for 5 or more minutes while running. `/codex:review` and `/codex:adversarial-review` for review passes.

Print the full task packet before every dispatch. Verify worker output against the packet checklist; never trust the self-report. Kill worker processes only by exact PID, never by name pattern (incident 2026-08-08: a name-pattern kill destroyed a running delegation).

## Model Routing

Supervisor: Codex Fable 5 first, Codex Opus 5 second (fallback on capacity or context). The supervisor does not downgrade for cost; supervisor tokens buy judgment.

Worker ceiling: `gpt-5.6-sol` at high effort on the priority tier.

xhigh policy - use `gpt-5.6-sol` xhigh ONLY for: (1) extremely dangerous work (security, payment, auth, data migration at the Critical review tier); (2) difficult debugging that resists a high attempt; (3) a super-hard task where a high attempt already failed. Never start at xhigh.

| Task type | Model and effort | Dispatch |
| --- | --- | --- |
| Planning, review, UI and copy judgment, root-cause analysis | Fable 5 high (Opus 5 fallback) | Inline, any size |
| Routine backend implementation, refactors, config | `gpt-5.6-sol` high, priority | codex-do, foreground, 20-minute timeout |
| Exploration, evidence gathering, bulk mechanical edits | `gpt-5.6-luna` xhigh, priority | Read-only sandbox where possible; signature-first reading (codegraph or line ranges), never whole files just to explore |
| Security, payment, auth, migrations | `gpt-5.6-sol` high, priority + Critical gates (two passes, human approval, no autopilot, no background) | codex-do, foreground only |
| Super-hard fallback | `gpt-5.6-sol` xhigh, priority, one attempt with checklist | Then stop and replan |
| Long multi-turn with MCP inside the worker | per rows above | codex MCP server session |

Hard-work phase map (algorithm, debugging, integration, phase-by-phase owners): `D:\01_Workspaces\SKILLs-repository\AGENTS.md`, section "Hard Work - Phase Map".

## Context Thresholds

Under 60 percent: proceed. 60-69: checkpoint. 70-79: offer `/handoff` before a major task. 80 or more: handoff or fresh session is mandatory. Compaction rules: the `strategic-compact` skill.

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
| `codex-job-watcher.ps1` | SessionStart | Optional beep when a plugin job finishes |
| `codegraph-init-check.ps1` | SessionStart | Suggests one-time `codegraph init` in unindexed repos |
| `track-tools.js` | PostToolUse | Feeds the UltraThink statusline |
| `notify-sound.ps1` | Notification, Stop | Plays D:\04_Assets\dragon-studio-new-notification-3-398649.mp3 — 1x when waiting for Line, 3x when a task finishes (beep fallback if the file is missing) |

Settings backups: `settings.json.bak-*`. Machine snapshot before go-live: `D:\Backups\machine-snapshot-2026-08-08.zip` (555 MB). Old rulebooks: `AGENTS.md.bak-golive`, `AGENTS.md.bak-golive`.
