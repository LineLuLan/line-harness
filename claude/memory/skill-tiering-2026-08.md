---
name: skill-tiering-2026-08
description: "2026-08-01 skill audit + tiering: 128 skills classified (12 policy / 52 versioned / 47 generic / 17 dead), 94 archived to the SINGLE store ~/.codex/skills-archive, 34 kept active; descriptions 12.5k → 4k tokens/request"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T18:11:11.669Z
---

2026-08-01: audited all 128 skills against frontier models (Fable 5 / GPT-5.5). Hard data:
the Skill tool had NEVER been invoked in 25 recorded transcripts (23MB), and descriptions
cost ~12.5k tokens in every request. Two agents classified: 12 A-policy (irreplaceable),
52 B-versioned-docs, 47 C-generic (models know natively), 17 D-dead/duplicate (broken CLI
deps, stale Claude-4/GPT-4o model IDs conflicting with claude-api skill, wrong-machine).

User-approved tiering (NOT deletion): 94 skills moved to **ONE archive store**
`C:\Users\ASUS\.codex\skills-archive\` (user directive: no duplicate store on .claude side —
the .claude mirror copies were parity-checked 94/94 then removed). 34 stay active on both
sides (12 A-policy + 22 stack-relevant B: nextjs, react, tailwind, shadcn-ui, radix-ui,
drizzle, drizzle-kit, neon, postgresql, sqlite, turso, pnpm, playwright, zod, vite, bun,
lint-format, monorepo-config, openai, ai-sdk, cloudflare, promptfoo). A `skill-archive-index`
skill in both listings catalogs all 94 with a Read-to-load recipe. Result: descriptions ~4k
tokens/request (−8.5k); Codex 0.146's "2% skills context budget" warning resolved.

MCP cleanup same day: `fetch` (dead) and `sequential-thinking` (redundant with native
extended thinking) removed from Claude's mcpServers; sequential-thinking KEPT in Codex's
config.toml per user (available to desktop/MCP-path, absent from lean exec anyway). Claude
mcpServers now: context7, codegraph, github, codex, neon, langfuse.

Follow-ups RESOLVED same day (2026-08-01, all mirrored .claude↔.codex, hash/byte-verified):
- `backend-ai-production-router` rewritten: 3 storage tiers (active 34 → archive 94 at
  `~/.codex/skills-archive` → legacy 151 at `D:\01_Workspaces\codex_setup_repos\
  archived_global_skills`), packs marked A/Archive, 9 nonexistent skill refs removed, MCP
  notes corrected (seq-thinking Codex-only; Claude native thinking/WebFetch).
- `openai` refreshed to 2026-08: GPT-5.6 family (Sol/Terra) + gpt-5.5/5.4 lineup, Responses
  API primary, Assistants legacy, no pricing (never-from-memory guard), unverified marked.
- `cloudflare` refreshed: wrangler.jsonc, compatibility_date 2026 convention, Workers Static
  Assets SPA pattern (matches whitelabel repo), modern DO/versions-deploy.
- `zod` refreshed to v4 (unified `error` param, top-level formats, 2-arg z.record) + v3
  differences table + check-package.json-first rule.
Still stale-but-kept (no marker issues found worth fixing yet): drizzle/drizzle-kit have no
version pins — refresh on next real use. Related: [[codex-claude-ecosystem]].

**SUPERSEDED 2026-08-08 (go-live):** the 94-skill archive was zipped into D:\Backups\machine-snapshot-2026-08-08.zip and DELETED from the machine. Active skills now come from the shared bank (_shared/ in SKILLs-repository clone) via install-bank.ps1: ~75 dirs in ~/.claude/skills, ~78 in ~/.codex/skills. skill-archive-index no longer exists.
