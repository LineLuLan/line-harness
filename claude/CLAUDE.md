# Claude Code Adapter - Line's Machine

The shared rulebook is `~/.codex/AGENTS.md` (team policy version 1.0 plus Line's personal addendum, section 15). Read it first. This file adds only Claude-harness detail for this machine. When the two files differ, `AGENTS.md` wins.

@C:/Users/ADMIN/.codex/AGENTS.md

Full detail (dispatcher flags, model-routing rationale, review-gate mechanics, timeout doctrine, output diet, hook table, incident history): `~/.claude/docs/harness-reference.md`. Read it before changing the dispatcher, the review gate, model routing, or hooks.

## Harness Mapping

| Claude Code | Codex |
| --- | --- |
| `~/.claude/CLAUDE.md` (this file) | `~/.codex/AGENTS.md` |
| `~/.claude/settings.json` | `~/.codex/config.toml` |
| `~/.claude/hooks/*` | `.codex/hooks.json` (per repo) |
| `~/.claude/skills/` | `~/.codex/skills/` |

- Shared skill bank: `D:\01_Workspaces\SKILLs-repository\_shared\`, installed on both sides with `install-bank.ps1 -All`. Two bank skills carry the `cx-` prefix here (`cx-code-review`, `cx-verify`). Unused bank skills are turned off on the Claude side with `skillOverrides` in settings.json; Codex keeps them.
- MCP servers: context7, github, langfuse, neon, plus claude.ai connectors. codegraph was removed 2026-11-15 (4 calls in 30 days; Codex cannot use MCP); restore steps in D:\Backups\codegraph-off-2026-11-15\RESTORE.txt. Use Read/Grep for code. Rules: `D:\01_Workspaces\SKILLs-repository\_shared\MCP-GUIDE.md`.
- Do not recreate `~/AGENTS.md`. It was a stale converted copy of this file; the Codex desktop app's Claude import is the suspected source (2026-11-09).

## Worker Dispatch

1. One-shot bounded tasks: `powershell -NoProfile -File C:\Users\ADMIN\.claude\bin\codex-do.ps1 -Dir <repo> -SpecFile <packet>` (long specs always through `-SpecFile`). `-Model <slug> -Effort <level>`, `-Fast` (medium effort), `-Sandbox read-only`, `-Account <name>`.
   - Runs detached by default (outside Claude Code's process tree). `-Status`, `-Attach <runId|last>`, `-Cancel <runId|last>`. A toast plus sound fires when a run ends.
   - Codex CLI 0.162.1 ignores `--disable multi_agent --disable multi_agent_v2` (verified 2026-11-09: the worker still has `collaboration.spawn_agent`; `agents.max_threads=0` is rejected). Say "Do not spawn sub-agents" in every packet's CONSTRAINTS; session discovery must pick the `thread_source: user` rollout.
   - `-Resume <uuid|last>` only to continue the same packet (STOP blocker or review FAIL); at most 3 resumes, then a fresh session. New packets and reviewers always start fresh sessions.
   - Exit 73 = no sandbox available; exit 72 = the run hit a sandbox failure. Use `-NoSandboxFallback` for Critical work.
   - The worker writes only inside `-Dir`. Copies or installs outside it are the supervisor's step, after verification.
   - Always pass the repo ROOT as `-Dir`, never a subfolder: files a sandbox run creates are owned by `CodexSandboxOffline` and only carry the capability SID of the `-Dir` used then, so a later run with another `-Dir` gets EPERM on them (2026-11-15, hub/tests/v9.test.js). One worker per repo at a time (the Dir lock); parallelize across repos only.
2. Long or open-ended tasks: `Agent(subagent_type: "codex:codex-rescue")` in background mode; poll `/codex:status <jobId>`; cancel only when `.job.updatedAt` is frozen 5+ minutes. Write Windows paths with forward slashes in plugin prompts.

Every packet: run a packet check (SUCCESS CRITERIA vs CONSTRAINTS, NON-GOALS, PATTERNS, fixtures; no contradictions; template headings present) and add `PACKET CHECK: ok`. Add `DOCS CHECKED: <lib> <version> via context7 <date>` or `DOCS CHECKED: n/a - <reason>` (`codex-do.ps1` lint exits 74 without it). Call context7 before any answer, packet, or edit that depends on a library, SDK, CLI, or external API. Print the full packet before dispatch. Verify worker output against the packet's SUCCESS CRITERIA; never trust the self-report. Kill worker processes only by exact PID.

Important and Critical packets also run `~/.claude/docs/packet-checklist.md` and add `CHECKLIST: ok`. `codex-do.ps1` lints every new packet and denies Important/Critical packets without it.

Packet and RAM gates: exit 74 = packet lint errors (`-AllowLarge` for packets over 8 KB); the RAM check only reports commit headroom and never blocks, waits, or stops a session (Line, 2026-11-14: sessions always run; if memory truly runs out, Windows ends the process itself). Do not add any harness step that stops or delays work because of low RAM. Write the ledger line with `bin/ledger-add.ps1 -SpecFile <packet>` (links the line to its codex-do runs; without it Hub model compare has no run outcomes - found 2026-11-14: 0 of 378 lines linked).

Shell: long or multi-line commands go through the PowerShell tool or a script file, never Bash (heredocs are denied by a hook). Scheduled tasks launch through `conhost.exe --headless`. Never start a long-lived process with Start-Process from a background task.

## Model Routing

| Work | Model |
| --- | --- |
| Planning, packets, verdicts, ship, memory, Line-facing replies | Opus 5.5 high (session default) |
| Layer-3 verification at Important, hard root-cause, architecture | Fable 5.1 high via `/model` |
| Critical: layer 3, the Fable review subagent, and the pre-dispatch packet read (Line, 2026-11-14) | Fable 5.2 high (`/model claude-fable-5-2`). The Agent tool only takes the `fable` alias; on 2026-11-14 a `fable` subagent reported itself as `claude-fable-5-2` (model self-report), so Fable subagents already run 5.2 - re-check if the alias changes |
| Standard-A (1-2 files, runnable VALIDATE, single-branch logic, worked examples) | `gpt-6-sol` high |
| Standard-B (3+ files, long command chains, repo discovery, vague VALIDATE, prior Sol STOP/FAIL), Important, Critical | `gpt-6-astra` high |
| Exploration | `gpt-6-luna` max first, then `gpt-6-sol` ultra for synthesis |
| Fallback after a failed high attempt | `gpt-6-astra` xhigh, one attempt, then replan |

Never start at xhigh. Write the tier into the packet header before dispatch. The `gpt-5.6-*` line is retired.

## Route by quota pace

Pace = used % / % of the window elapsed. Daily budget per side = 15% of the week; over budget = today's burn above 20%. Check pace at session start and before each Important packet (statusline or Line Hub "Today's routing"). These rules override the routing table; the Claude bullets win for workers and reviews when both sides are stressed.

<!-- ontology:quota:begin -->
| Codex quota | Route |
| --- | --- |
| Pace <= 1.0 and used < 70% | Normal routing table. |
| Pace > 1.0 to 1.3, used 70-84%, or over daily budget | Standard-B with <= 3 files and a runnable VALIDATE goes to `gpt-6-sol` high. No Luna exploration (Claude Explore subagent). Layer 2 = Fable subagent. |
| Pace > 1.3 or used 85-94% | Codex for Important/Critical. Standard work goes to an Opus subagent with the same packet (if Claude is stressed too, see below). No resumes. |
| Used >= 95% | No Codex. Opus subagent = worker, Fable subagent = layer 2, ledger `worker=opus`. |

- Claude 7-day pace > 1.2 or used >= 70%: no Opus subagent workers; layer 2 = Astra; Fable only for Critical layer 3; supervisor edits <= 20 lines.
- Both sides stressed (Claude rule above active and Codex not >= 95%): Standard-A and Standard-B go to `gpt-6-sol` high and are never deferred (Line, 2026-11-15).
- Codex used >= 95% while the Claude rule is active: no new packets; report to Line. This is the only stop rule.
- Claude 5-hour used >= 80%: finish the current check, update the handoff, pause Claude work until the window resets.
- Codex desktop and CLI sessions count against the budget. One session over 50M tokens: stop and report to Line.
<!-- ontology:quota:end -->

## Paid API Budget

OpenRouter credits pay for exactly one thing: runs of the model under test, `openai/gpt-6-luna`. No judge panels, labelling, probes of other models, or pilots go to OpenRouter; those run on subscription quota (Claude subagents, codex-do). "chạy" or "chạy pilot" never widens this. An exception needs Line to name the model and budget in the current conversation, and the command carries `OPENROUTER_GUARD_OVERRIDE=1`. Enforced by `hooks/openrouter-model-guard.ps1`.

## Review Gate

The implementer never grades itself. Layers: (1) deterministic gates, (2) fresh-session model review, (3) supervisor verification: compare the diff to every SUCCESS CRITERIA line, re-run VALIDATE, and execute the change for real. Layer 3 is never skipped and never delegated to Codex.

<!-- ontology:review-tiers:begin -->
| Tier | Layers |
| --- | --- |
| Skip (under ~20 lines of config, typo, docs) | 3 |
| Standard-A / Standard-B | 1 + 3 (`codex-review.ps1 -SkipModel`); layer 2 optional over ~150 lines, logged |
| Important (multi-file, API contract, shared module) | 1 + 2 (`gpt-6-astra`, mandatory) + a Fable 5.1 subagent + 3 |
| Critical (security, payment, auth, migration) | Important + Line approves in writing |
<!-- ontology:review-tiers:end -->

Important packets get a pre-dispatch read by a Fable subagent (packet only, about 5 minutes). At Critical every Fable step uses Fable 5.2.

On FAIL the worker fixes and a NEW reviewer session runs. After 2 FAILs at Important/Critical (3 at Standard) stop, report to Line, and redesign. After every delegated task append one line to `~/.claude/state/review-ledger.log` with `bin/ledger-add.ps1`: `date|tier|layer2 yes/no|L1|L2|L3|note|worker=<model>|type=<ui|collector|review|research|docs|config|other>|fail_rounds=<int>|findings=L1:<n>,L2:<n>,L3:<n>`. Old 7-field lines stay valid.

## Working Rules

- Context (Line, 2026-11-15): keep working; compaction handles long sessions. Never ask Line to `/clear` or start a fresh session. At 85%+ update the newest handoff file silently and continue (`context-guard.ps1`).
- Liveness: measure heartbeats, not wall clocks. A background run whose output has not changed for 5+ minutes while its process lives is a zombie: stop it by exact PID, salvage partial results first. Every packet carries STOP RULES.
- Output diet: tail long output, never paste full logs, read files by line range when the target is known.
- Evidence labels: every claim about Line's machine says "đã kiểm tra trên máy" (ran it here), "theo một nguồn, chưa kiểm" (one source), or "tôi đoán" (inference). Web research findings carry one of: read (opened the source), cited (a source quotes it), located (seen in a listing only), contradicted, not found.
- Node 24: run test folders as `node --test "tests/*.test.js"`; `node --test tests/` fails with MODULE_NOT_FOUND.
- Interview first (2-4 questions with options, recommended first) when a request has two readings, a real fork exists, or the task is a new feature, spec, or system change. Otherwise act; decide and note minor choices.
- Startup: confirm the working directory, read the nearest repo `AGENTS.md` and newest `.handoff/` file, route through `team-router` (TwoHearts work goes to `twohearts-engineering-standards` first), check context before a major task, state the plan before the first tool call.
