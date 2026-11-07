---
name: agent-coding-backup-repo
description: Private repo LineLuLan/agent-coding = allowlist backup of .claude + .codex; local clone D:\01_Workspaces\agent-coding; sync process + codex-do.ps1 stdin fix
metadata: 
  node_type: memory
  type: reference
  originSessionId: eee0bc77-bcd9-4493-b4c8-247bf561588b
  modified: 2026-08-08T16:45:25.248Z
---

`https://github.com/LineLuLan/agent-coding` (PRIVATE — verified via unauthenticated API 404 on 2026-08-06). Local clone: `D:\01_Workspaces\agent-coding`. Allowlist-only backup of the user's Claude + Codex setup: `codex/{AGENTS.md, rules, skills(45), skills-archive(94), config.toml.example}`, `claude/{CLAUDE.md, settings*.example, statusline-ultrathink.js, hooks, bin, skills(35)}`, `scripts/setup.ps1` (guided fresh-machine install, rewrites `C:\Users\ASUS` → `$env:USERPROFILE`). Never commit auth/sessions/sqlite/logs (see BACKUP_POLICY.md; run its rg secret-scan before push). Full sync done 2026-08-06 (commit dcbd1d7) via two codex-do.ps1 delegations.

2026-08-08 GO-LIVE COMPLETE: the machine now RUNS the new system — bank v1.0 installed to both `~/.claude/skills` (75) and `~/.codex/skills` (78 incl. .system + 2 personal + 4 vc-*); team AGENTS.md + §15 personal addendum at `~/.codex/AGENTS.md`; new thin-adapter `~/.claude/CLAUDE.md` (old rulebooks in `*.bak-golive`); 3 harness hooks + settings merged (backup `settings.json.bak-20260808-*`); codex plugin `codex@openai-codex` installed (PATH reordered npm-first — needs session restart); codegraph CLI global + ALL 7 TwoHearts repos indexed (`.codegraph/` in each repo's `.git/info/exclude`); DELETED per Line's order: skills-archive-94, packages/standalone 0.135, task-inugami, old router/index/watzup/shadcn skills, `.replaced-*`. Full restore: `D:\Backups\machine-snapshot-2026-08-08.zip` (555 MB, 7142 entries). NOTHING committed/pushed anywhere per [[line-git-authority]].

2026-08-08: `_shared/` bank v1.0 built LOCALLY in the SKILLs-repository clone (73 skill dirs / 6 tiers, 251 files — implements issue #2: winning-source copies, ai-sdk rewritten to v5, promptfoo sanitized, 4 mega-files split router+references, pr-review references genericized, team-router + ROADMAP.md, Line's member folder trimmed to 6 personal skills). ALL UNCOMMITTED pending team approval of issues #1/#2; team rulebook draft AGENTS.md+CLAUDE.md also sits uncommitted at repo root. Backup of removed Line dirs in %TEMP%\skill-bank-round-a-line-source-*.

Team sharing: `Twohearts-Technologies/SKILLs-repository` (clone: `D:\01_Workspaces\SKILLs-repository`) holds per-person skill folders — user's folder is **"Line's skills"** (user's name: Line; 45 active skills + AGENTS.md/CLAUDE.md + README, pushed 2026-08-06 commit 12456d6, direct-to-main per user's explicit choice). TwoHearts PR-target rule applied: always ask push/PR target for this org's repos.

Round G (2026-08-09): codex-do.ps1 now has a per-Dir dispatch lock (second worker in the same tree gets REFUSED + exit 3; stale locks auto-clear), a child-PID ledger at ~/.claude/state/dispatch-ledger.log (start/end pairs for orphan cleanup by exact PID), and a CODEX_DO_BIN env override for testing. Verified independently with a fake binary. Backup: bin/codex-do.ps1.bak-roundg.

Second lesson (2026-08-09): text containing double quotes / JSON samples passed as an OUTER powershell.exe argument mangles parsing and kills the run before the first echo — use `codex-do.ps1 -SpecFile <path>` (param added 2026-08-09) or a one-line "read spec at <path>" prompt; never inline long spec text as an argument at ANY layer.

Key lesson: the npm `codex.cmd` shim TRUNCATES command-line prompts at the first newline — multi-line specs silently arrived as one line (round 1 executed a guessed subset while reporting success). Fixed 2026-08-06 in `~/.claude/bin/codex-do.ps1`: multi-line prompts now go via stdin. For long specs, also fine to write a spec file and pass a one-line "read spec at <path>" prompt. Always verify delegated work against the spec checklist, not the agent's self-report. Related: [[codex-claude-ecosystem]], [[codex-desktop-lag-cleanup]]
