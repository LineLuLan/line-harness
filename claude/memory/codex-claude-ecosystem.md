---
name: codex-claude-ecosystem
description: "Division of labor between Codex (main coding, GPT-5.6-Sol; Astra trial 2026-09-06 to 09-08 rolled back, Astra only for Critical) and Claude Fable 5.1/Opus 5 (planning/reasoning/debug), and how Claude invokes Codex via the codex CLI"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fab8836b-2f1c-405f-9124-bec5edf35d39
  modified: 2026-08-01T16:55:08.066Z
---

The user wants Codex and Claude Code to operate as ONE consistent ecosystem with a clear division of labor.

**Why:** The user pays for Codex as the primary code-writing engine and wants Claude (Fable 5 / Opus 5 since 2026-08) used where it's strongest, with Claude able to delegate implementation to Codex from inside Claude Code.

**How to apply — role split:**
- **Codex = main coding engine.** Primary model since 2026-09-06: **GPT-6 Astra** (`gpt-6-astra`, high, priority; see [[codex-gpt6-astra]]). Before that, since 2026-08-01: **GPT-5.6-Sol** (`gpt-5.6-sol`, "latest frontier agentic coding model", 272k context, efforts low→ultra) at `model_reasoning_effort=high` + priority tier — switched from GPT-5.5 xhigh after a verified trial (slugify + tests, 7/7 pass, clean DRY/KISS code, 96s). Hand bulk implementation, scaffolding, and mechanical edits to Codex.
- **Claude (Fable 5.1 / Opus 5) = planning, reasoning, debugging.** Use Claude for architecture/plan design, hard reasoning, root-cause debugging, code review, and orchestration. When those needs surface, Claude leads; otherwise delegate coding to Codex.

**How to apply — invoking Codex from Claude Code:**
- Codex CLI is on PATH: `codex` (`C:\Users\ASUS\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`, v0.135.0).
- Non-interactive: `codex exec [OPTIONS] "PROMPT"` (prompt can also come from stdin).
- Useful flags: `-m gpt-5.6-sol` (model), `-c model_reasoning_effort=high`, `-s read-only|workspace-write|danger-full-access` (sandbox), `-C <DIR>` (working root), `--skip-git-repo-check` (needed outside a git repo, e.g. `C:\Users\ASUS`), `-o <FILE>` (write final message to file), `--json` (JSONL events), `--output-schema <FILE>` (structured final output).
- It auto-loads `~/.codex/config.toml` (model gpt-5.6-sol, high, MCP servers) and `.rules` unless `--ignore-user-config` / `--ignore-rules`.
- Default delegation pattern: `codex exec -s workspace-write -C <projectDir> "<task>"` for implementation; keep planning/review in Claude. Confirm before letting Codex run write/destructive ops per [[codex-agents-rules]].

**Orchestration protocol (set up 2026-06-20, see [[claude-mirrors-codex]]):** Claude (Fable 5 / Opus 5) plans/debugs/reviews → delegates implementation + GitHub work to Codex → reviews Codex's diff and verifies. Codex runs gpt-5.6-sol at `model_reasoning_effort=high`, `service_tier=priority` (the "1.5x Fast" tier). **User directive 2026-07-31: fast/priority must ALWAYS be on for Codex coding calls.** Caveat: the Codex desktop app can rewrite `~/.codex/config.toml` (found drifted to medium/default on 2026-07-31; re-pinned to xhigh/priority) — so `codex-do.ps1` now explicitly passes `-c model_reasoning_effort=high -c service_tier=priority` on every call (`-Fast` switch keeps priority, drops effort to low). For MCP-path calls, config.toml is the only lever: re-check it if Codex behaves slow/cheap.

**HYBRID MCP delegation (2026-08-01, measured):** `codex exec` used to spend ~36s spawning the 7
config.toml MCP servers per delegation (48.7s vs 12.6s for the same one-word task). `codex-do.ps1`
now runs LEAN: `--ignore-user-config -m gpt-5.6-sol` + explicit effort/tier flags **+ `-c
windows.sandbox="elevated"`** — CRITICAL on Windows: `--ignore-user-config` drops `[windows]
sandbox = "elevated"` from config.toml and Codex then SILENTLY downgrades `-s workspace-write`
to read-only (header shows `sandbox: read-only`, every write "blocked by policy"; bug found +
fixed + probe-verified 2026-08-01). Any future lean `codex exec` call must carry that flag. It
prefers the
npm-global codex (`%APPDATA%\npm\codex.cmd`, v0.146.0) because PATH still resolves the
desktop-managed standalone stuck at 0.135. Measured end-to-end after: **10.8s**. Policy: Claude
pre-fetches context via its own warm MCPs and embeds verified facts in the spec; Codex blocked on
external info → report blocker → re-delegate. The MCP `codex` tool keeps full config for long
multi-turn sessions. Codex-side npx MCP servers pinned (context7@3.2.5,
sequential-thinking@2026.7.4, codegraph@1.5.0). Claude-side MCP additions 2026-08-01: `neon`
(remote OAuth https://mcp.neon.tech/mcp) and `langfuse` (stdio via
`~/.claude/bin/langfuse-mcp-launch.ps1`, which loads LANGFUSE_* from the TwoHearts .env.local at
runtime — values never printed/persisted). Codegraph now indexes twohearts-delivery-backend
(1,508 files). Codex 0.146 features noted but NOT enabled yet: subagents, PostToolUse hooks,
/import. Two wired delegation paths:
- **Shell helper (DEFAULT since hybrid 2026-08-01):** `C:\Users\ASUS\.claude\bin\codex-do.ps1` wraps `codex exec` with `-s workspace-write -C <dir> --skip-git-repo-check` and pipes empty stdin (else `codex exec` hangs on stdin in non-TTY PowerShell). Flags: `-Sandbox`, `-Fast` (effort=low for quick iterations), `-OutFile`. Verified end-to-end (2026-08-01: returned model gpt-5.6-sol / high). Use for one-shot tasks with a self-contained spec (~90% of delegations).
- **Native MCP (for long multi-turn sessions):** `codex mcp-server` is registered as the `codex` MCP server in `~/.claude.json` (✔ verified connected). Claude calls the `codex` tool directly — no shell/stdin quirks, full config incl. Codex-side MCPs, ~36s startup. Use when the session shape needs multi-turn context (`codex-reply`) or Codex must query MCPs mid-task; also the fallback when the exec path is blocked. The full protocol lives in `~/.claude/CLAUDE.md` "ORCHESTRATION PROTOCOL" section.

**Standing approval (user directive 2026-07-31):** Claude→Codex delegation is ALWAYS pre-approved
("2 bạn là 1 hệ sinh thái thống nhất") — `mcp__codex`, `PowerShell(codex:*)`, `Bash(codex:*)`, and
the codex-do.ps1 invocation are allowlisted in `~/.claude/settings.json`. Never ask permission just
to hand coding work to Codex. The AGENTS.md hard-stop gates still apply to WHAT the work does
(prod DB, schema/auth/payment/deploy, secrets, high-impact GitHub writes) — confirm those with the
user, not the act of delegating.

**Delegation-first is STRICT (user feedback 2026-08-01):** the user complained Claude kept
self-implementing ("claude toàn tự làm") — they pay for Codex precisely so Codex bears the
implementation token cost. Claude self-edits ONLY for ≤~20-line mechanical edits or touch-ups
to a fresh Codex diff. When a Codex path is blocked, fall back helper↔MCP; if BOTH fail, stop
and report — never silently implement a chunk yourself (that's what caused Claude to burn its
own tokens during the 2026-08-01 sandbox bug). Full rule in ~/.claude/CLAUDE.md.

See [[codex-agents-rules]] for the shared safety/operating rules and [[codex-setup-overview]] for the full inventory.
- 2026-09-28: settings.json model was found at opus[1m] (drifted since ~09-19); Line asked to restore it to claude-fable-5-1[1m] to match the CLAUDE.md supervisor rule. Done; takes effect on the next session.

## Supervisor model change 2026-09-28 (Line approved)
Fable weekly quota hit 96% (shared weekly pool 51%). Line: "giảm gánh nặng bằng Opus 5.5". Applied: settings.json model `claude-opus-5-5[1m]` + `effortLevel: high` (Opus 5.5 defaults to medium); CLAUDE.md supervisor rule = Opus 5.5 default, `/model` to Fable 5.1 for layer-3 at Important/Critical, hard root-cause, architecture; layer-2b subagent stays Fable 5.1; second-brain skill primary `claude-opus-5-5`. Opus 5.5 API price $4/$20 vs Fable $10/$50, same 1M context. Unmeasured: Opus 5.5 layer-3 catch rate; watch the ledger. Takes effect next session.
