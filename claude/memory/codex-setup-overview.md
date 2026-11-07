---
name: codex-setup-overview
description: "Inventory of the user's ~/.codex setup — config.toml, MCP servers, 128 skills, rules — that Claude treats as shared reference"
metadata: 
  node_type: memory
  type: reference
  originSessionId: fab8836b-2f1c-405f-9124-bec5edf35d39
  modified: 2026-08-01T11:22:21.955Z
---

The user's Codex config lives at `C:\Users\ASUS\.codex`. Claude treats it as shared reference for the [[codex-claude-ecosystem]].

**config.toml**: model `gpt-5.6-sol` (since 2026-08-01; was gpt-5.5 xhigh), `model_reasoning_effort = "high"`, `service_tier = "priority"`. Windows sandbox = elevated. Desktop theme dark/dracula. Plugins enabled: vercel, github, browser. Many trusted project paths under `D:\01_Workspaces\*` and `C:\Users\ASUS\documents\codex\*`.

**MCP servers** (defined for Codex; reachable in Claude Code only if separately connected — they are NOT auto-available here): `context7` (fresh library docs), `sequential-thinking`, `fetch` (mcp-server-fetch), `codegraph` (@colbymchenry/codegraph), `github` (githubcopilot MCP, bearer via `GITHUB_PAT_TOKEN`), `node_repl` (OpenAI runtime + browser control), `task-inugami` (bun server at task.inugami.dev).

**Skills**: 128 active in `C:\Users\ASUS\.codex\skills`. Entry/routing skill = `backend-ai-production-router` (selects lean packs: Workflow/Process, Backend Core, Database/Infra, Distributed Systems, AI Engineering, plus `vc-*` vibecode packs). Archived full library at `D:\01_Workspaces\codex_setup_repos\archived_global_skills` — read a single archived `SKILL.md` on-demand only when the active pack lacks the domain.

**rules/default.rules** (execpolicy auto-allow): reading `research` & `backend-ai-production-router` SKILL.md, and `git add` / `git commit`.

Note: these skills/MCP/rules belong to the Codex harness. Claude can read the skill files as guidance and shell out to Codex (see [[codex-claude-ecosystem]]), but Claude's own tools/skills are separate.
