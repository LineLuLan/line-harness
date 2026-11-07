---
name: no-artifact-delivery
description: Line rule 2026-08-27 — never deliver/open work via Claude Artifact; local HTML file opened in browser is the deliverable
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eed7f892-2910-4b32-9b77-71872cf5291b
  modified: 2026-08-27T11:38:53.497Z
---

Line said (2026-08-27, after the first `learn` skill test published an Artifact): "Không bao giờ mở bằng claude artifact" — never deliver through Claude Artifact.

**Why:** Line wants deliverables as local files opened directly in the browser, not hosted claude.ai pages.

**How to apply:** For HTML explainers, reports, and similar deliverables: write the local file, open it with `Start-Process <path>`, report the path. Do not call the Artifact tool unless Line explicitly asks for a shareable claude.ai link. The [[learn-skill]] SKILL.md was updated accordingly in all 3 locations (bank + ~/.claude + ~/.codex).
