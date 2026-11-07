---
name: learn-skill
description: "Custom bank skill \"learn\" — layered HTML learning explainer (codegraph + mandatory context7); not yet in install-bank.ps1 KitsMap"
metadata: 
  node_type: memory
  type: project
  originSessionId: eed7f892-2910-4b32-9b77-71872cf5291b
  modified: 2026-08-27T11:42:06.347Z
---

Created 2026-08-27 at Line's request: skill `learn` generates a 4-layer HTML learning explainer (eli5 intuition → architecture → mechanics → practice) for a topic, framework, or repo feature. Repo evidence via codegraph; framework/library knowledge MUST go through context7 (dated, never from memory). Output: `.learn/learn-<slug>-<date>.html`, opened directly in the browser — NEVER published as a Claude Artifact (see [[no-artifact-delivery]]).

Locations: bank source `D:\01_Workspaces\SKILLs-repository\_shared\10-orchestration\learn\SKILL.md`; installed to `~/.claude/skills/learn` and `~/.codex/skills/learn` by direct copy.

**Why:** Line wants to master a feature/system before implementing; no existing plugin (official or community marketplace) does this.

**How to apply:** Trigger on "tôi muốn học X" / `/learn X`. Line's depth rule (2026-08-27): every run must go DEEP — never stop at the obvious module; run expansion rounds (repo-wide grep for signals, codegraph blast radius, adjacent module SPECs, sibling repos) until a round finds nothing new, and the output must include a coverage map + explicit out-of-scope list. Also SPEC/SSOT-first before code scanning. Caveat: `learn` is NOT in install-bank.ps1 KitsMap or team-router — a future `install-bank.ps1 -All` run will not (re)install it; adding it to a kit touches team-shared files and needs Line's/team decision. Related: [[codex-claude-ecosystem]].
