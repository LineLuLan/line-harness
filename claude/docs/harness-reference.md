# Harness Reference - full detail

Moved out of ~/.claude/CLAUDE.md on 2026-11-09 so it loads only when needed. CLAUDE.md keeps the rules every session needs and points here. Read this file before changing the dispatcher, the review gate, model routing, or hooks.

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
- MCP servers, verdicts, and usage rules: `D:\01_Workspaces\SKILLs-repository\_shared\MCP-GUIDE.md`. Active here: context7, github, langfuse, neon, plus claude.ai connectors. fetch, sequential-thinking, and codex (MCP; `codex mcp-server` removed from Codex CLI, retired 2026-10-01) are removed.

## Worker Dispatch

Dispatcher checks (2026-11-13, repo mirror): new packets run `bin/packet-lint.ps1` before any Codex process. Exit **74** means packet lint failed; each error is printed. `-AllowLarge` accepts packets over 8 KB of UTF-8 text. Status, attach, cancel and resume skip lint. The outgoing prompt gains `CONSTRAINTS: Do not spawn sub-agents.` when absent; the source packet stays unchanged. Completed runs record child-thread counts in `subagents.txt`; a positive count adds `spawned N sub-agent threads` to the completion notice and end toast. Telemetry uses `telemetry.log`; `out.log` is final once `exit.txt` is published. Malformed rollouts are skipped; scan failures are silent.

<!-- Intent: report-only RAM. Status: aligned. Next: install. Blockers: none. Confidence: caller fixtures. -->
Both `codex-do.ps1` and `codex-review.ps1` sample commit headroom once and report it before starting Codex. Low RAM never blocks, waits, or stops a session; CIM failures warn and continue. `-NoRamCheck` skips the status call, and gates-only reviews (`-SkipModel`) skip all preflights. There is no RAM exit code.

Use `bin/ledger-add.ps1 -Tier Important -Layer2 yes -L1 0 -L2 1 -L3 0 -Note 'review complete' -Worker '<model>' -Type review -FailRounds 1 -Findings 'L1:0,L2:1,L3:0'` to append one validated UTF-8 ledger line. `-RunIds a,b` adds run links; `-Path` overrides the default `~/.claude/state/review-ledger.log`.

`bin/harness-cleanup.ps1` previews deletions and their MB total. `-Days` defaults to 30. `-Apply` deletes only stale direct folders in `$env:TEMP\claude` and stale `out.log` files in `~/.claude/state/runs/<run>`. Other run files stay. Linked or unreadable trees are skipped; deletions go to `~/.claude/state/cleanup.log`. Review the preview before applying.

Review output accepts `[P1]`, `P1:`, `**P1**`, `Severity: P1`, `- P2 -` and `P3 (minor)`. Each finding block counts once; summaries and body references do not introduce findings. The repo mirror writes `reviews.jsonl` with fields `utc`, `dir`, `specFile`, `model`, `effort`, `gates`, `verdict`, `mode`, `criteria`, `criterionResults`, and `findings` (each has `severity`, `location`, `title`). `CODEX_REVIEW_LOG` overrides the log path; gate-only reviews are logged too. Only reviewer stdout supplies findings. Log failures print `codex-review: review log failed: <exception type>` to stderr without failing the review.

<!-- Intent: honest review evidence. Status: documented. Next: install. Blockers: none. Confidence: offline regressions. -->
`-SkipModel` success prints `VERDICT: GATES-PASS (no model review)`, exits 0, and logs verdict `PASS`, mode `gates-only`, criteria `n/a`, and null model/effort. Model runs use mode `model`. With a SpecFile, top-level numbered SUCCESS CRITERIA items define expected ids; sub-items do not. In a CRITERIA block, UNKNOWN, missing expected ids, or duplicates yield `VERDICT: INCOMPLETE (<reason>)`, exit 6, log verdict `UNKNOWN` and criteria `incomplete`. A reviewer or criterion FAIL wins and exits 1, with coverage still logged. Full coverage logs criteria `complete`; per-item evidence stays in `criterionResults`. No CRITERIA block leaves findings-based verdict logic unchanged, adds ` (criteria not reported)` with a SpecFile, and logs criteria `none`. Prompt-only reviews keep prior verdict behavior and log criteria `n/a`, as do empty diffs.

Review exit codes: 0 PASS/GATES-PASS, 1 FAIL, 2 invalid repository, 3 UNKNOWN/error, 4 oversized diff, 5 account not logged in, 6 INCOMPLETE. Reviewer severities: P0 (blocks ship: wrong result, data loss, security), P1 (must fix before merge), P2 (should fix), P3 (nit). FAIL when at least one P0 or P1 finding exists.

Two paths; pick by task shape:

1. One-shot bounded tasks — the lean helper:
   `powershell -NoProfile -File C:\Users\ADMIN\.claude\bin\codex-do.ps1 -Dir <repo> "<packet>"`
   No MCP spawn (measured 48.7s to 12.6s). `-Fast` drops effort to medium for mechanical edits (Line 2026-09-06: medium, not low, for stable output). `-Sandbox read-only` for analysis. Multi-line packets pass through stdin automatically (the command line truncates at the first newline - patched 2026-08-06). Long specs: always `-SpecFile <path>` — quotes in an inline spec argument kill the run (verified 2026-08-09).
   Codex accounts (2026-09-28): `codex-acc.ps1 list|status|add <name>|login <name>|use <name>|run|env` keeps one CODEX_HOME per account under `~/.codex-accounts/<name>` (main = `~/.codex`); never copy auth.json. `codex-do.ps1` and `codex-review.ps1` use the active account, or `-Account <name>` per call. Switching is manual (Line). acc1/acc2 snapshots in `~/.codex/accounts` are dead and reserved.
   Multi-turn (2026-10-01): every codex-do run prints `session: <uuid>`. `-Resume <uuid>` (or `-Resume last`) continues that worker session with its transcript (`codex exec resume`; same model, effort, sandbox, account). Resume ONLY to continue the same packet: answer a STOP RULE blocker or fix after a review FAIL. A new packet always starts a fresh session; reviewers are always fresh sessions; after 3 resumes of one session start fresh (context rot).
   Detached by default (2026-10-10): codex-do launches the worker through WMI (outside Claude Code's process tree) with a run folder `~/.claude/state/runs/<runId>` (stdin, out.log, exit.txt, run.json, tree.json, session.txt). If the background task running codex-do is stopped (Esc, session end, low memory), the worker keeps running: reconnect with `-Attach <runId|last>`, stop it with `-Cancel <runId|last>` (exact-PID tree from tree.json only). The Dir lock refuses a second dispatch while that run's tree lives and prints both commands. `-Attached` restores the old in-tree launch per call. Codex sub-agents are disabled by default (`--disable multi_agent --disable multi_agent_v2`) so sessions stay resumable; `-AllowSubAgents` re-enables them. Self-tests: `bin/tests/codex-do-detach-selftest.ps1` (97 assertions) and `codex-do-resume-selftest.ps1`; the worker sandbox blocks WMI, so the supervisor runs the detached test.
   Reliability (2026-10-12): every dispatch and review first runs a 1-second sandbox preflight (`codex-sandbox-lib.ps1`): elevated, else unelevated (still blocks writes outside -C), else exit 73 without a model call. `-NoSandboxFallback` (or `CODEX_DO_NO_FALLBACK=1`) forbids the fallback: use it for Critical-tier work. A finished run whose output has codex's own timestamped router ERROR line for the sandbox exits 72 (review: UNKNOWN). Detached runs fire a Windows toast plus sound when they finish (`codex-run-notify.ps1`, log `~/.claude/state/runs/notify.log`). `codex-do.ps1 -Status [-Hours N]` lists runs as starting, running, STALE (no output 10 min), done, failed, DIED; the statusline shows running/stale/died counts. Root cause of the 2026-10-12 outage: the Codex desktop app locks its computer-use runtime; its autostart is disabled.
   Current docs (2026-10-12, Line): call context7 (resolve-library-id, then query-docs) before any answer, packet, or edit that depends on a library, SDK, framework, CLI, or external API. Every codex-do packet carries `DOCS CHECKED: <lib> <version> via context7 <date>` or `DOCS CHECKED: n/a - <reason>`; `codex-do.ps1` packet lint denies a new dispatch without it (-Status/-Attach/-Cancel/-Resume exempt). Scheduled task `MCP-Weekly-Update` (Mondays 09:00, headless) runs `bin/mcp-weekly-update.ps1`: bumps pinned MCP npm versions in `~/.codex/config.toml` (backup `config.toml.bak-mcpweekly-*`, keeps 4, validates with `codex mcp list`, restores on failure), log `~/.claude/state/mcp-weekly-update.log`, toast on change. Claude-side context7 runs `@latest`. codex-review disables every MCP server that has a `[mcp_servers.<name>]` table (plugin servers have none; overriding them breaks the config).
   The worker writes only inside its `-Dir`. Any copy or install outside that boundary is the supervisor's step, after verification (verified 2026-08-09: a sandboxed worker cannot write to the home directory).
2. Long or open-ended tasks — the official plugin:
   Write every Windows path in a plugin prompt with forward slashes: the rescue forwarder strips backslashes (verified 2026-10-01: the .claude\bin path arrived as C:UsersADMIN.claudebin and the worker refused). `--resume` continues the last rescue thread with memory (verified 2026-10-01 on CLI 0.157.1).
   `Agent(subagent_type: "codex:codex-rescue")` with background mode; poll `/codex:status <jobId>`; cancel with `/codex:cancel` only when `.job.updatedAt` is frozen for 5 or more minutes while running. `/codex:review` and `/codex:adversarial-review` for review passes.

Before printing a packet, run a packet check: compare SUCCESS CRITERIA and REQUIREMENTS against CONSTRAINTS, NON-GOALS, PATTERNS, and fixtures for any rule that contradicts another (shape caps, schema, fixture content), rewrite each conflict into one rule, confirm the template headings exist (a `SUCCESS CRITERIA:` block is required by codex-review.ps1; 2026-10-09 a packet titled REQUIREMENTS made layer 2 return UNKNOWN), and add a line `PACKET CHECK: ok` (2026-10-09: three worker STOPs in one day came from self-contradicting packets).
Print the full task packet before every dispatch. Verify worker output against the packet's SUCCESS CRITERIA; never trust the self-report. Kill worker processes only by exact PID, never by name pattern (incident 2026-08-08: a name-pattern kill destroyed a running delegation).

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
| Exploration tier 1 - locate, list, count, inventory, single-file reads, bulk mechanical edits | `gpt-6-luna` max, priority (`-Model gpt-6-luna -Effort max`; Luna has no ultra) | Read-only sandbox where possible; signature-first reading (Read/Grep or line ranges), never whole files just to explore |
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

On FAIL the worker fixes and a NEW reviewer session runs; never reuse a reviewer session. After 2 FAILs at Important/Critical (3 at Standard), stop, report to Line, and redesign. The supervisor reads the verdict, holds the evidence, and decides to ship; no reviewer ships.

| Tier | Trigger | Reviewer | Command |
| --- | --- | --- | --- |
| Skip | diff under about 20 lines of config, typo, rename, docs | layer 3 only (supervisor runs VALIDATE) | - |
| Standard-A and Standard-B | everything else (see Model Routing for the A/B split; the worker model differs, the review does not) | layers 1+3 only (Line, 2026-09-08: routine work does not earn a model review). Supervisor MAY run layer 2 when the diff exceeds about 150 lines or touches multi-branch logic, and must log why in the ledger | `codex-review.ps1 -Dir <repo> -SpecFile <packet> -SkipModel` for gates only; drop `-SkipModel` to add layer 2 |
| Important | multi-file, API contract, shared module | layers 1+2 (`gpt-6-astra` high, fresh Codex session; layer 2 is mandatory here - the ledger on 2026-09-19 showed 6 of 11 Important tasks skipped it) + one Fable 5.1 subagent in a fresh context (different provider), then layer 3 | `codex-review.ps1` then `Agent(general-purpose)` with diff + criteria |
| Critical | security, payment, auth, migration | Important + Line approves in writing | same, then wait for Line |

`codex-review.ps1` runs the deterministic gates first (typecheck or lint when the repo defines them, secret and console.log scan of the diff), then `codex review` in a fresh session with the diff and the packet criteria embedded in the prompt (the CLI rejects scope flags together with a custom prompt); verdict = explicit VERDICT line, else any [P0]/[P1] finding = FAIL, else PASS. Reviewer instruction: report only gaps that affect correctness or the stated criteria; style is P3. Keep Fable quota for judgment work: Standard tier never spends Claude tokens.

Review ledger (decided 2026-09-08): after every delegated task append one line to `~/.claude/state/review-ledger.log`: `date|tier (Skip, Standard-A, Standard-B, Important, Critical)|layer2 ran? (yes/no)|defects found by L1|by L2|by L3|note|worker=<model>|type=<...>|fail_rounds=<int>|findings=L1:<n>,L2:<n>,L3:<n>` (structured fields below; lines before 2026-11-12 end at the note and name the worker model in it). After 20 Standard-B entries compare defect counts against Standard-A to decide whether Astra earns its cost there. After 20 entries the supervisor reports the catch rate per layer to Line and the tier rules get adjusted by that data, not by feel.

Structured fields (2026-11-12, Line): new lines append `|worker=<model>|type=<ui|collector|review|research|docs|config|other>|fail_rounds=<int>|findings=L1:<n>,L2:<n>,L3:<n>` after the note; old 7-field lines stay valid. Example:
`2026-11-12|Important|yes|0|2|1|inel wave 2 fix round, 4 P2 to backlog|worker=gpt-6-astra high|type=ui|fail_rounds=1|findings=L1:0,L2:2,L3:1`

Packet checklist (2026-11-12): `docs/packet-checklist.md` lists the 15 most frequent defect classes mined from this ledger. Important and Critical packets run it and carry `CHECKLIST: ok`; `codex-do.ps1` packet lint denies them otherwise (the tier is the first word after `TIER:`).

## Context Thresholds

<!-- Intent: continue Line's work through compaction. Status: aligned. Next: install. Blockers: none. Confidence: 2026-11-15 rule. -->
Keep working; compaction handles long sessions. At 85%+ update the newest handoff silently and continue. Never ask Line to `/clear` or start a fresh session. The `context-guard.ps1` prompt hook reads the statusline's context cache. Compaction rules: the `strategic-compact` skill.

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
| `codex-delegation-reminder.ps1` | none (unhooked 2026-11-12; file kept) | Was: re-inject the delegation rule every turn (fired 1,368 times in 30 days without effect) |
| `edit-delegation-guard.ps1` | PreToolUse Edit/Write/MultiEdit (`-Mode check`), UserPromptSubmit (`-Mode reset`), SessionStart (`-Mode session`) | Non-blocking warning when one edit adds >50 lines or the 3rd+ distinct file is edited since Line's last prompt; state is one file per session, `state/edit-delegation/<session_id>.json` (reset deletes it; SessionStart prunes files older than 24 h); memory, `.handoff`, scratchpad paths and subagent calls (`agent_id` in the hook input) exempt; SessionStart prints one delegation line (2026-11-12) |
| `context-guard.ps1` | UserPromptSubmit | Reads the statusline context cache; at 85%+ directs a silent handoff update and continued work through compaction; never asks Line to clear context |
| `codex-job-watcher.ps1` | SessionStart | Optional beep when a plugin job finishes |
| `track-tools.js` | PostToolUse | Feeds the UltraThink statusline |
| `notify-sound.ps1` | Notification, Stop | Plays D:\04_Assets\dragon-studio-new-notification-3-398649.mp3 — 1x when waiting for Line, 3x when a task finishes (beep fallback if the file is missing) |

Timing limit (measured 2026-11-12): the edit hook's check mode runs ~305-325 ms median against ~210-230 ms for powershell.exe start alone (about 100 ms of script work, half of it the JSON library load); under 300 ms needs a node port (Line's decision).

Settings backups: `settings.json.bak-*`. Machine snapshot before go-live: `D:\Backups\machine-snapshot-2026-08-08.zip` (555 MB). Old rulebooks: `AGENTS.md.bak-golive`, `CLAUDE.md.bak-golive`.
