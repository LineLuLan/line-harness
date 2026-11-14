---
name: line-harness-repo
description: "Public GitHub backup of the whole harness - LineLuLan/line-harness (MIT), local copy D:\\01_Workspaces\\line-harness; how it was built and refreshed"
metadata:
  node_type: memory
  type: reference
  originSessionId: 0bf35df1-8e96-432f-8845-c9f2d92cf9cd
  modified: 2026-11-07T10:38:26.170Z
---

2026-11-07: Line asked to back up the harness + terminal setup and publish it as "Line Harness". Line chose: almost everything public (skills incl. TwoHearts, memory, configs), one NEW public repo, MIT.
- Repo: https://github.com/LineLuLan/line-harness (public, 1694 files, first commit de02c8f). Local: D:\01_Workspaces\line-harness (README, LICENSE, restore.ps1 dry-run by default, .gitignore).
- Collected by a script (session scratchpad collect-harness.ps1): ~/.claude CLAUDE.md, settings.json, statusline, bin, hooks, commands, docs, skills, plugin lists, memory; mcpServers from ~/.claude.json (via node: PS 5.1 ConvertFrom-Json fails on case-duplicate keys); ~/.codex AGENTS.md, config.toml, hooks.json, hooks, rules, skills, skills-archive; ~/AGENTS.md; Windows Terminal settings; scheduled tasks MCP-Weekly-Update + DockerRamTrack. No PowerShell profile exists.
- Never included: auth.json, .credentials.json, .env, transcripts, sessions, history, caches. Secret scan found one live GitHub token in the github MCP Authorization header -> replaced with ${GITHUB_PAT_TOKEN}. config.toml only references env var names.
- The auto-mode classifier blocks Claude from the collect and push steps (data exfiltration); Line runs them with `!` (quote paths with forward slashes - Bash strips backslashes).
- 2026-11-07 later: restore.ps1 rewrites C:\Users\ADMIN in settings.json/config.toml/hooks.json, merges missing Claude MCP servers into ~/.claude.json (claude/merge-mcp.js, backup first), statusline reads OPENROUTER_API_KEY first. Lesson: a `node -e "..."` inside PowerShell double quotes expanded `${GITHUB_PAT_TOKEN}` to empty; PS 5.1 also strips inner quotes for native args -> write a .js file instead.
- 2026-11-07: Line approved deleting C:\Users\ADMIN\AGENTS.md (an Aug-18 copy of CLAUDE.md with Claude->Codex find-replace; gpt-5.6, Fable 5, codex MCP; Claude Code loaded it in every home-dir session and it conflicted with CLAUDE.md). Backup D:\Backups\home-AGENTS.md.bak; removed home/ from the repo. Do not recreate it.
- 2026-11-07: added to the portfolio as project #2 after GoiBERT-M (content/projects.ts, slug line-harness, planet satellite), commit fd81cca on main, live verified at linelulan.vercel.app/projects/line-harness. Metrics used: 328 ledger rows (09-07..11-07), defects L1 38 / L2 165 / L3 301, 168 detached runs, 77 skills, cold start 48.7s->12.6s. Refresh those numbers if the copy is updated.
- To refresh: rerun collect, rerun the secret scan, commit, Line pushes. Older private backup: [[agent-coding-backup-repo]].
