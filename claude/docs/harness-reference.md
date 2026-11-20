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

<!-- Intent: document Line's opt-in fallback. Status: detached Grok isolation. Next: supervisor host validation. Blockers: none locally. Confidence: offline library tests. -->
**Grok fallback engine.** Use `codex-do.ps1 -Engine grok -Dir <repo-root> -SpecFile <packet>` (`GROK_DO_BIN` overrides `~/.grok/bin/grok.exe`). Grok runs detached in a separate no-checkout worktree: setup copies every tracked file present in Dir (force-added ignored files included) and every untracked, non-ignored file byte for byte and records each SHA256 in the run's `manifest.json`; ignored files such as `node_modules` are not copied, so a packet's VALIDATE must state any dependency on them. An untracked nested git repository in Dir makes setup exit 78. The fixed preamble requires STOP BEFORE EDITING on packet conflicts or changes outside FILES and forbids commits, pushes, and edits outside the current directory. Before publishing completion, the wrapper compares the worktree to the manifest by hash and copies only changed, added and deleted files back byte for byte (git never converts line endings), after it checks that every touched Dir file still matches the manifest and saves an undo bundle in `runs/<runId>/undo/`; each write is atomic and a failed write rolls back the earlier ones. Ignored files and empty folders created by Grok are not brought back. `codex-do.ps1 -Undo <runId|last> [-Dir <repo>]` restores the pre-run bytes under the Dir lock and skips any file changed since the run (exit 79; exit 2 = no undo bundle). Undo does not restore folder-name case changes. Exit 77 means a touched Dir file changed during the run or bring-back failed (worktree retained); a non-zero Grok exit skips the patch, keeps the worktree, and publishes that exit code. Exit 78 means isolation setup failed. Status, attach, cancel, ledger links, and notification use the existing run lifecycle. Cancel prints the kept worktree only when that path exists, and refuses while bring-back is in progress. Grok defaults to `grok-4.7-build-fast` at effort xhigh for every tier (K6a) with plan mode, web search and sub-agents off (`--no-plan`, `--disable-web-search`, `--no-subagents`), `--max-turns 300`, and a `--rules` system-prompt rule that tells it to finish every SUCCESS CRITERION, run VALIDATE until it passes or a STOP RULE applies (host-only commands listed, not run), and end with a file:line report; pass `-Model grok-4.7` or `-Effort` to override (`Get-GrokLaunchPlan` and `Get-GrokRuleText` in `grok-engine-lib.ps1`). The rule text travels on the `run.cmd` command line, so the lib refuses `" % ^ & | < > !` and line breaks in it; the dispatch echo cuts it to 40 characters. `-Fast` is accepted and ignored for Grok. `-Attached`, `-Resume`, `-Account`, and `-Sandbox` work on Grok (next paragraph but one). Offline checks: `bin/tests/grok-engine.test.ps1`; the supervisor runs `bin/tests/grok-engine-e2e.ps1` on the host with its fake CLI.

<!-- Intent: K5e engine swap. Status: auto default. Next: supervisor host -SetEngine show. Blockers: none. Confidence: grok-engine tests. -->
**Engine swap (K5e).** `-Engine` defaults to `auto`; the engine is chosen by `-Engine codex|grok` > env `CODEX_DO_ENGINE` (codex|grok|auto) > `<stateDir>/engine.txt` > auto, and auto picks Grok only when the Codex weekly used % in the status line cache is at least the ontology's `codexUsed3` (fallback 95) with fresh data (Critical packets stay on Codex; `-Resume` continues on the engine that owns the session (K6a); a dispatch on Grok prints `codex-do: engine grok (<source>: <reason>)` and records `engineSource` in run.json: flag, env, file or auto, or `<source>-fallback` when a Codex-owned or unknown `-Resume` kept a Grok choice on Codex). `codex-do.ps1 -SetEngine codex|grok|auto` writes `engine.txt` atomically and prints the effective engine, and `-SetEngine show` prints the mode, its source and the Codex used % without changing anything. The status line codex row ends with `engine: grok (auto)` when auto picks Grok and `engine: codex (manual)` or `engine: grok (manual)` when `engine.txt` names an engine.

<!-- Intent: K6a Grok covers Codex worker work. Status: resume/read-only/attached/account on grok. Next: supervisor host -Resume run. Blockers: none. Confidence: grok-engine tests + 6 host probes 2026-11-18. -->
**Grok covers Codex options (K6a).** `-Resume <uuid|last>` first finds the run that owns the session: `last` = the newest run for `-Dir` (any engine), a UUID = the newest run whose `session.txt` equals it; `engine: grok` in its run.json means Grok owns it. A Grok-owned session resumes on Grok whatever auto, env or `engine.txt` say (`-Engine codex` exits 2; a Critical packet gets the manual-choice warning); a Codex-owned or unknown session keeps the Codex path (`-Engine grok` exits 2). Grok reopens a session only in the folder where it started (probe 2026-11-18: `--resume` with another `--cwd` fails with "This session's folder no longer exists, so nothing ran"), so a Grok resume builds a fresh byte-copy snapshot of the current Dir at the prior run's worktree path and runs `grok --resume <sessionId>` there (no `--fork-session`, never `--restore-code`); the preamble tells Grok the folder was reset to a fresh snapshot and that unapplied edits from earlier runs are gone. A UUID resume must name the same `-Dir` as the owning run (exit 2 otherwise), and the engine line names the owner, e.g. `codex-do: engine grok (file: -Resume continues grok session <id> from run <runId> <start>)`. Worktrees are kept after an exit 77 (conflict or bring-back error), a non-zero Grok exit, a cancel, or skipped paths; a resume needs the owning run finished (`exit.txt` published and its wrapper tree gone, else exit 78 - seal a dead run with `-Cancel`), then, under the Dir lock, prunes stale worktree registrations (a folder deleted by hand) and moves a kept worktree aside with `git worktree move` to `<path>-kept-<yyyyMMdd-HHmmss>` (printed with the run id; nothing is deleted) before it adds the new snapshot. A Grok resume inherits no model or effort (K6a defaults unless `-Model`/`-Effort`). The 50M rule sums `usage.total_tokens` of the final `end` or `error` event in each run's `out.log` for that session (runs without a `session.txt` are not counted) (exit 76; no data = the usual "token usage unavailable" warning); there is no 3-resume counter. `-Sandbox read-only` runs `--sandbox read-only` with only the `read_file,grep,list_dir` tools (`--disallowed-tools run_terminal_cmd,search_replace,write,Agent`) and a short "do not edit" rule, still in a byte-copy worktree; bring-back applies nothing (`apply.json` status `read-only`, changed paths listed with a warning, worktree removed, Grok's exit code published). Grok refuses to resume a session under another sandbox profile, so `-Resume` with a `-Sandbox` that differs from the owning run exits 2; without `-Sandbox` it keeps the owning run's profile. Grok enforces sandbox profiles only on Linux (Landlock) and macOS (Seatbelt); on Windows it continues without enforcement, so isolation comes from the worktree, the `--deny` git rules and the tool lists, not from `--sandbox`. Every Grok run (worker, read-only, resume) runs with no MCP tools, because Line's workers run lean and MCP tools such as `github__create_or_update_file` have outside effects: `--deny MCPTool(*)` blocks every MCP tool from any source without naming one (grok docs 22-permissions-and-safety, MCP Rules; deny still wins under `--always-approve`), `--disallowed-tools` also removes the MCP meta-tools `use_tool` and `search_tool`, and `run.cmd` sets `GROK_CLAUDE_MCPS_ENABLED=false` and `GROK_CURSOR_MCPS_ENABLED=false` so the Claude and Cursor MCP configs are not scanned (Line's Grok MCP servers come from `~/.claude.json`; `~/.grok/config.toml` has none). Grok's docs (07-mcp-servers, 26-config-reference) offer no switch for project-level sources (`.mcp.json`, a project `.grok/config.toml`): tool calls are blocked, but project-level MCP servers may still start. Probe 7 (2026-11-18): the tool list held no `github__`/`langfuse__`/`context7` tool and no meta-tool, and `github__get_me` could not be called; without the block (probe 5) the MCP tools were listed even under `--tools`. `-Attached` on Grok prints `codex-do: -Attached is the default on grok (detached + wait)` and waits like `-Attach` (exit code = `exit.txt`); `-Account` prints `codex-do: -Account ignored on grok`. `-OutFile` receives the final answer text (the text after the last tool event in `out.log`), written by the wrapper before `exit.txt`. Liveness: Grok prints nothing while a long tool command runs (probes saw gaps up to 6.4 s on tiny prompts; a long VALIDATE can exceed 5 minutes), so a Grok run is alive while its wrapper PID is alive and the 5-minute no-output rule does not apply to it. Probe timing on one tiny prompt: xhigh 43.7 s vs high 29.4 s.

**Grok reviewer (K6b).** `codex-review.ps1` takes `-Engine auto|codex|grok` (default auto, same decision as codex-do): when Codex weekly used >= 95% the layer-2 model review runs on Grok (`grok-4.7-build-fast` xhigh, read-only plan: `--tools read_file,grep,list_dir`, shell/edit/MCP tools removed, `--deny MCPTool(*)`), with the same VERDICT line, findings block, review log (`engine` field) and findings facts. A Grok answer without a VERDICT line is UNKNOWN (exit 3). Fable still reviews Important work. Verified 2026-11-18: two real Grok reviews caught a planted bug (P0, criterion FAIL) and left the repo untouched.

Before each packet, run `bin/packet-pitfalls.ps1 -Tier <tier> -Type <type>` and paste its `KNOWN PITFALLS:` block into the packet. The block lists applicable certified lessons as `- [lesson-id] rule`. It adds category countermeasures when three or more findings occurred in the past 14 days and no applicable certified lesson covers that category. Advisories exclude `other` and show at most five categories, sorted by findings count descending, with ties in ontology order. When more qualify, the final line is `- advisory: <n> more categories with 3+ findings omitted`. Empty output is `KNOWN PITFALLS: none recorded`. `-StateDir` defaults to `~/.claude/state`; relative paths use the PowerShell location. `-Ontology` defaults to `ontology/harness.ontology.json` beside the script's `bin` folder. Missing findings files supply no advisories. Both this command and the sensor skip malformed JSON, bad UTC timestamps, and rows whose `kind` is neither `finding` nor absent. Future timestamps do not count. The PowerShell command accepts UTC strings and datetime values from newer JSON parsers.

Add `TYPE: config` on its own line, or `| TYPE: config |` inside the `TIER:` line. Standalone metadata must start at the beginning of the line with uppercase `TYPE:` and a single lowercase token; `## ` and bold decoration are allowed. TYPE metadata never closes the current section, and the inline type wins when both exist. Types are `ui`, `collector`, `review`, `research`, `docs`, `config`, and `other`. The first tier word of the first `TIER:` heading selects the tier, ignoring case and trailing punctuation, as in `Important,` or `Critical/Important`. `packet-pitfalls.ps1 -Tier` uses the same normalization. Unknown types warn. Important and Critical packets without a type warn: `add TYPE: to receive typed lessons`.

`Test-Packet -Ontology <path>` uses the same default ontology path. Every applicable certified lesson must appear as `[lesson-id]` inside `KNOWN PITFALLS:`. Missing ids are errors for Important and Critical (dispatch exit 74), and printed warnings for other tiers. A lesson applies when both its type and tier lists match, or contain `*`. Without `TYPE:`, only wildcard type lessons apply. Draft and deprecated lessons do not apply. A missing ontology file or lessons block skips lesson checks. An unreadable or malformed ontology also skips lesson checks and adds one warning: `ontology unreadable: lesson checks skipped`. The generator prints that warning to stderr and still emits its block.

The ontology's `lessons` array starts empty. Each lesson has a unique kebab-case `id`, a `category` from `defectCategories`, one imperative sentence in `rule`, `appliesTo: { types: [...], tiers: [...] }`, `status`, `evidence`, and an `added` date (`yyyy-mm-dd`). Each scope list contains valid types or tiers, or only `"*"`. Tiers are `Skip`, `Standard-A`, `Standard-B`, `Important`, `Critical`, and `Exploration`. Status is `draft`, `certified`, or `deprecated`; certification requires at least two evidence entries. Evidence entries are finding ids or `ledger:yyyy-mm-dd:short` references. The sensor validates the structure and references; certification review checks imperative wording.

`bin/ontology-check.js --state-dir <path>` defaults to `~/.claude/state`. For every category with at least three findings in 14 days and no certified lesson at any scope, including `other`, it prints `INFO: LESSON: <category> has <n> findings in 14 days and no certified lesson - propose one`. Missing findings files are silent; other read failures add one `INFO: findings unreadable: <code>` line. These INFO messages do not change the exit code, appear only in `result.info` under `--json`, and are omitted under `--hook`.

<!-- Intent: document dispatch exit codes and the resume cap. Status: enforced. Next: install. Blockers: none. Confidence: fixture tests. -->
Dispatch exit codes: 72 sandbox failure in captured output, 73 no sandbox available, 74 packet lint failure, 76 resume session above 50M tokens (start a fresh session and report to Line); 75 is retired and RAM only reports.

Dispatcher checks (2026-11-13, repo mirror): new packets run `bin/packet-lint.ps1` before any Codex process. Exit **74** means packet lint failed; each error is printed. `-AllowLarge` accepts packets over 8 KB of UTF-8 text. Status, attach, cancel and resume skip lint. The outgoing prompt gains `CONSTRAINTS: Do not spawn sub-agents.` when absent; the source packet stays unchanged. Completed runs record child-thread counts in `subagents.txt`; a positive count adds `spawned N sub-agent threads` to the completion notice and end toast. Telemetry uses `telemetry.log`; `out.log` is final once `exit.txt` is published. Malformed rollouts are skipped; scan failures are silent.

<!-- Intent: report-only RAM. Status: aligned. Next: install. Blockers: none. Confidence: caller fixtures. -->
Both `codex-do.ps1` and `codex-review.ps1` sample commit headroom once and report it before starting Codex. Low RAM never blocks, waits, or stops a session; CIM failures warn and continue. `-NoRamCheck` skips the status call, and gates-only reviews (`-SkipModel`) skip all preflights. There is no RAM exit code.

Use `bin/ledger-add.ps1 -Tier Important -Layer2 yes -L1 0 -L2 1 -L3 0 -Note 'review complete' -Worker '<model>' -Type review -FailRounds 1 -Findings 'L1:0,L2:1,L3:0'` to append one validated UTF-8 ledger line. `-RunIds a,b` adds run links; `-Path` overrides the default `~/.claude/state/review-ledger.log`. With `-SpecFile` and no explicit `-RunIds`, an unmatched spec throws without writing; pass `-RunIds`, or omit `-SpecFile` and explain why in `-Note`.

`bin/harness-cleanup.ps1` previews deletions and their MB total. `-Days` defaults to 30. `-Apply` deletes only stale direct folders in `$env:TEMP\claude` and stale `out.log` files in `~/.claude/state/runs/<run>`. Other run files stay. Linked or unreadable trees are skipped; deletions go to `~/.claude/state/cleanup.log`. Review the preview before applying.

Review output accepts `[P1]`, `P1:`, `**P1**`, `Severity: P1`, `- P2 -` and `P3 (minor)`. Each finding block counts once; summaries and body references do not introduce findings. The repo mirror writes `reviews.jsonl` with fields `utc`, `dir`, `specFile`, `model`, `effort`, `gates`, `verdict`, `mode`, `criteria`, `criterionResults`, and `findings` (each has `severity`, `location`, `title`). `CODEX_REVIEW_LOG` overrides the log path; gate-only reviews are logged too. Only reviewer stdout supplies findings. Log failures print `codex-review: review log failed: <exception type>` to stderr without failing the review.

<!-- Intent: preserve typed review evidence for Line. Status: implemented. Next: Hub ingestion. Blockers: none. Confidence: offline fixtures. -->
`bin/review-findings-lib.ps1` keeps the legacy severity/location/title parser for `reviews.jsonl`. `Get-StructuredFindings` validates the last `findings` JSON fence for `findings.jsonl`. Use the [review findings format](review-findings-format.md) in Codex, Fable and supervisor review prompts. It declares category and criterion; neither field is inferred from prose. Category ids come from `defectCategories` in `ontology/harness.ontology.json`. The loader accepts `-OntologyPath`; the structured parser accepts `-Ontology` as an array of category ids. If the ontology file is missing, unreadable, malformed, or has an invalid category list, the loader supplies the built-in 19 ids. Read, parse and validation errors emit one stderr warning per ontology path per process.

`codex-review.ps1` appends one fact per valid structured finding to `findings.jsonl`, beside the resolved `reviews.jsonl`. A nonempty model answer with a missing or invalid block, or invalid items, adds one `format-violation` row. Valid items still produce facts. Empty model answers and `-SkipModel` produce no model facts or format violations. Every failed gate still produces a layer-1 finding. A clean review with `[]` and no failed gates writes no facts and creates no findings file. A write failure prints `codex-review: findings log failed: <ExceptionType>` to stderr; the verdict and exit code stay unchanged.

| Field | Meaning |
| --- | --- |
| `id` | First 16 lowercase hex characters of SHA-256 of `utc` plus the zero-based finding index for codex-review, or `utc` plus `title` for finding-add. Format violations hash `utc` plus `violation`. |
| `utc` | UTC ISO timestamp; codex-review shares the timestamp with its review row. |
| `source`, `layer` | `codex-review` for layers 1 and 2; `fable` by default for manual layer 2; `supervisor` by default for layer 3. Manual records can override source with `-Source`. |
| `severity`, `category`, `title` | P0-P3 severity, ontology category id, and finding title. Format violations use severity null and category `other`. |
| `location`, `criterion` | Declared source location and `C<n>` criterion, or direct parameters. Nullable values are null; no prose extraction. |
| `reviewer`, `dir` | Reviewer model/name and reviewed directory. Absent values are null. |
| `specFile`, `specSha` | Packet path and SHA-256 of its bytes when the file is found; otherwise null. |
| `runId` | For codex-review, newest run by `startedUtc` with the same `specSha256` and directory; otherwise null. For finding-add, the supplied id or null. |
| `quote` | Null for structured imports, model findings, format violations and gates. Direct `-Quote` is capped at 200 characters. |
| `kind` | Last property: `finding` for valid findings and gates, or `format-violation` for model format errors. |

Format violation titles are `Review findings block missing`, `Review findings block is not valid JSON`, or `<n> findings failed the schema`. They use layer 2 and do not alter verdict logic.

Run lookup reads `runs/*/run.json` under `CODEX_DO_STATE_DIR` or `~/.claude/state`. It does not infer links from stdin. Gate facts use severity P2 and title `<gate> gate failed`: typecheck/lint use `formatter-lint`, secrets/console use `fixture-secret`. Their reviewer, location, criterion and quote are null. Gate diagnostic and secret-hit lines are never copied into facts.

Record Fable and supervisor findings with `bin/finding-add.ps1`. Required direct parameters are `-Layer 2|3 -Severity P0|P1|P2|P3 -Category <id> -Title <text>`. Optional parameters are `-Location`, `-Criterion`, `-SpecFile`, `-RunId`, `-Reviewer`, `-Quote`, `-Dir`, `-Source` and `-StateDir`. `-Source` accepts `fable`, `supervisor`, `codex-review` or `other`; defaults remain `fable` for layer 2 and `supervisor` for layer 3. Omitted fields are null. `-StateDir` defaults to `CODEX_DO_STATE_DIR`, then `~/.claude/state`. Unknown direct categories or missing required fields fail before any write. Direct parameter values reject pipes and line separators; structured string fields can contain both.

```powershell
bin/finding-add.ps1 -Layer 3 -Severity P1 -Category missing-criterion -Title 'Missing validation' -Location 'src/check.ps1:12' -Criterion C2 -SpecFile '.packets/task.md' -Reviewer 'supervisor' -Dir $PWD.Path
bin/finding-add.ps1 -FromFile '.packets/fable-review.txt' -Layer 2 -Reviewer 'Fable' -Dir $PWD.Path -SpecFile '.packets/task.md'
```

`-FromFile` requires `-Layer` and `-Reviewer` and reads the structured block. It accepts `-Dir`, `-SpecFile`, `-Source` and `-StateDir`. Valid items are written with `kind: finding` and `quote: null`. Invalid items are dropped; their zero-based indexes go to stderr and the command exits 1. A missing or invalid block exits 1 without writing. `VERDICT: PASS` alone is an error; an explicit `[]` succeeds without writing.

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
   Reliability (2026-10-12): every dispatch and review first runs a sandbox preflight capped at 20 s (`codex-sandbox-lib.ps1`): elevated, else unelevated (still blocks writes outside -C), else exit 73 without a model call. `-NoSandboxFallback` (or `CODEX_DO_NO_FALLBACK=1`) forbids the fallback: use it for Critical-tier work. A finished run whose output has codex's own timestamped router ERROR line for the sandbox exits 72 (review: UNKNOWN). Detached runs fire a Windows toast plus sound when they finish (`codex-run-notify.ps1`, log `~/.claude/state/runs/notify.log`). `codex-do.ps1 -Status [-Hours N]` lists runs as starting, running, STALE (no output 10 min), done, failed, DIED; the statusline shows running/stale/died counts. Root cause of the 2026-10-12 outage: the Codex desktop app locks its computer-use runtime; its autostart is disabled.
   Current docs (2026-10-12, Line): call context7 (resolve-library-id, then query-docs) before any answer, packet, or edit that depends on a library, SDK, framework, CLI, or external API. Every codex-do packet carries `DOCS CHECKED: <lib> <version> via context7 <date>` or `DOCS CHECKED: n/a - <reason>`; `codex-do.ps1` packet lint denies a new dispatch without it (-Status/-Attach/-Cancel/-Resume exempt). Scheduled task `MCP-Weekly-Update` (Mondays 09:00, headless) runs `bin/mcp-weekly-update.ps1`: bumps pinned MCP npm versions in `~/.codex/config.toml` (backup `config.toml.bak-mcpweekly-*`, keeps 4, validates with `codex mcp list`, restores on failure), log `~/.claude/state/mcp-weekly-update.log`, toast on change. Claude-side context7 runs `@latest`. codex-review disables every MCP server that has a `[mcp_servers.<name>]` table (plugin servers have none; overriding them breaks the config).
   The worker writes only inside its `-Dir`. Any copy or install outside that boundary is the supervisor's step, after verification (verified 2026-08-09: a sandboxed worker cannot write to the home directory).
2. Long or open-ended tasks — the official plugin:
   Write every Windows path in a plugin prompt with forward slashes: the rescue forwarder strips backslashes (verified 2026-10-01: the .claude\bin path arrived as C:UsersADMIN.claudebin and the worker refused). `--resume` continues the last rescue thread with memory (verified 2026-10-01 on CLI 0.157.1).
   `Agent(subagent_type: "codex:codex-rescue")` with background mode; poll `/codex:status <jobId>`; cancel with `/codex:cancel` only when `.job.updatedAt` is frozen for 5 or more minutes while running. `/codex:review` and `/codex:adversarial-review` for review passes.

Before printing a packet, run a packet check: compare SUCCESS CRITERIA and REQUIREMENTS against CONSTRAINTS, NON-GOALS, PATTERNS, and fixtures for any rule that contradicts another (shape caps, schema, fixture content), rewrite each conflict into one rule, confirm the template headings exist (a `SUCCESS CRITERIA:` block is required by codex-review.ps1; 2026-10-09 a packet titled REQUIREMENTS made layer 2 return UNKNOWN), and add a line `PACKET CHECK: ok` (2026-10-09: three worker STOPs in one day came from self-contradicting packets).
Print the full task packet before every dispatch. Verify worker output against the packet's SUCCESS CRITERIA; never trust the self-report. Kill worker processes only by exact PID, never by name pattern (incident 2026-08-08: a name-pattern kill destroyed a running delegation).

Shell commands (2026-10-09): long or multi-line commands go through the PowerShell tool or a script file, never the Bash tool (Bash fails with `unexpected EOF` on long commands, also for Line's `!` commands; enforced 2026-10-12 by the PreToolUse hook bash-heredoc-guard.ps1, which denies Bash heredocs). Scheduled tasks must launch through `conhost.exe --headless`, or Windows Terminal opens a window. Claude Code kills the whole process tree of a background task when that task stops (Esc, session end, low memory; verified 2026-10-09 by experiment): never start a long-lived process with Start-Process from a background task; codex-do launches detached through WMI for that reason.

## Model Routing

Supervisor (Line, 2026-09-28): Claude Opus 5.5 high is the session default (settings.json `claude-opus-5-5[1m]`, `effortLevel: high` - Opus 5.5 defaults to medium, keep it explicit). Switch to Claude Fable 5.2 with `/model` for layer-3 verification at Important and Critical, hard root-cause work, and architecture decisions; the layer-2b subagent stays Fable 5.2 so it differs from the worker. Reason: the Fable weekly quota hit 96% on 2026-09-28 while the shared weekly pool sat at 51%. Within a tier, do not downgrade further for cost; supervisor tokens buy judgment.

Worker default: `gpt-6.2-sol` high on the priority tier for Skip and Standard-A. `gpt-6.2-astra` high for Standard-B, Important, and Critical (`-Model gpt-6.2-astra`); `gpt-6.2-astra` xhigh when a high attempt fails. Standard splits by task shape, decided and written into the packet header before dispatch: Standard-A = one or two files, a runnable VALIDATE (test, build, or diff-against-fixture), single-branch logic, worked input/output examples in the packet. Standard-B = any of: three or more files, a long command chain (build, migrate, docker, start a service then probe it), the worker must discover context in the repo, VALIDATE is missing or vague, or Sol already STOPped or FAILed on a similar task. Exploration: `gpt-6-luna` max first (tier 1), `gpt-6.2-sol` ultra for synthesis (tier 2). Pass `-Model <slug>` and `-Effort <level>` to codex-do.ps1 and codex-review.ps1. The `gpt-5.6-*` line is retired (Codex labels it older; 5.6 promo pricing ends 2026-11-21).

**Model upgrade 2026-11-20.** Fable blind-graded three models on four real harness tasks. All three passed every host VALIDATE check. `gpt-6.2-astra` scored 133/160 against 130/160 for `gpt-6-astra` and scored highest on the Important task. It was fastest (4.9 minutes versus 5.1 for the previous Astra) and used the fewest tokens (1.04M input and 5.1k output versus 1.12M and 7.5k). `gpt-6.2-sol` scored highest overall at 137/160. Line chose it for Standard-A and the new Astra for Standard-B, Important, and Critical.

xhigh policy - use `gpt-6.2-astra` xhigh ONLY for: (1) extremely dangerous work (security, payment, auth, data migration at the Critical review tier); (2) difficult debugging that resists a high attempt; (3) a super-hard task where a high attempt already failed. Never start at xhigh.

| Task type | Model and effort | Dispatch |
| --- | --- | --- |
| Planning, packets, verdict reading, ship, memory, Line-facing replies | Opus 5.5 high (session default) | Inline, any size |
| Layer-3 verification at Important/Critical, hard root-cause, architecture decisions | Fable 5.2 high via `/model` | Inline |
| Standard-A: one or two files, runnable VALIDATE, single-branch logic | `gpt-6.2-sol` high, priority | codex-do, foreground, 20-minute timeout |
| Exploration tier 1 - locate, list, count, inventory, single-file reads, bulk mechanical edits | `gpt-6.2-sol` high, priority (`-Model gpt-6.2-sol`); gpt-6-luna is no longer a worker (2026-11-20) | Read-only sandbox where possible; signature-first reading (Read/Grep or line ranges), never whole files just to explore |
| Exploration tier 2 - cross-module synthesis, conflicting evidence, root-cause hypotheses, or a tier-1 answer the supervisor could not confirm | `gpt-6.2-astra` xhigh, priority (`-Model gpt-6.2-astra -Effort xhigh`); web or X research: Claude Explore subagent or Grok | Same sandbox rules. Start at tier 1 unless the question is synthesis from the start |
| Standard-B: three or more files, long command chains, repo discovery, vague VALIDATE, or a prior Sol STOP/FAIL | `gpt-6.2-astra` high, priority (`-Model gpt-6.2-astra`) | codex-do, foreground, 20-minute timeout |
| Multi-file, API contract, shared module (Important tier) | `gpt-6.2-astra` high, priority (`-Model gpt-6.2-astra`) | codex-do, foreground, 20-minute timeout |
| Security, payment, auth, migrations | `gpt-6.2-astra` high, priority + Critical gates (two passes, human approval, no autopilot, no background) | codex-do, foreground only |
| Super-hard fallback | `gpt-6.2-astra` xhigh, priority, one attempt with checklist (`-Model gpt-6.2-astra -Effort xhigh`) | Then stop and replan |
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
| Important | multi-file, API contract, shared module | layers 1+2 (`gpt-6.2-astra` high, fresh Codex session; layer 2 is mandatory here - the ledger on 2026-09-19 showed 6 of 11 Important tasks skipped it) + one Fable 5.2 subagent in a fresh context (different provider), then layer 3 | `codex-review.ps1` then `Agent(general-purpose)` with diff + criteria |
| Critical | security, payment, auth, migration | Important + Line approves in writing | same, then wait for Line |

<!-- Intent: document packet scope and syntax protection. Status: implemented. Next: install. Blockers: none. Confidence: offline regressions. -->
With `-SpecFile`, `codex-review.ps1` defaults to the packet FILES paths and reports excluded changed files; empty or zero-match packet paths fall back to the whole diff. `-AllPaths` keeps whole-diff review, while explicit `-Paths` takes precedence. The `psparse` layer-1 gate parses changed, existing `.ps1`, `.psm1`, and `.psd1` files in the effective scope, fails on syntax errors with up to ten diagnostics and category `ps51-traps`, and is skipped by `-SkipGates`.

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
| `track-tools.js` | PostToolUse | Feeds the UltraThink statusline |
| `notify-sound.ps1` | Notification, Stop | Plays D:\04_Assets\dragon-studio-new-notification-3-398649.mp3 — 1x when waiting for Line, 3x when a task finishes (beep fallback if the file is missing) |

Timing limit (measured 2026-11-12): the edit hook's check mode runs ~305-325 ms median against ~210-230 ms for powershell.exe start alone (about 100 ms of script work, half of it the JSON library load); under 300 ms needs a node port (Line's decision).

Settings backups: `settings.json.bak-*`. Machine snapshot before go-live: `D:\Backups\machine-snapshot-2026-08-08.zip` (555 MB). Old rulebooks: `AGENTS.md.bak-golive`, `CLAUDE.md.bak-golive`.
