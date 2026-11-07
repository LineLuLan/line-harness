---
name: line-git-authority
description: "Line's git rule since 2026-08-08 — NO commit and NO push unless Line explicitly orders that exact action in the current conversation"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eee0bc77-bcd9-4493-b4c8-247bf561588b
  modified: 2026-08-08T14:00:24.793Z
---

Line's standing git rule (2026-08-08, stated while approving the go-live plan): do **not** commit and do **not** push — anywhere, including Line's own private repos (agent-coding, SKILLs-repository) — unless Line explicitly orders that exact commit/push in the current conversation. Personal work stays in the working tree until Line says otherwise.

**Why:** Line wants full manual control over what enters git history; several deliverables are personal-only and must never reach the team repo.
**How to apply:** finish work and report with files in the working tree; never treat task completion as implicit commit authorization; when a commit would help, ask — one line — instead of doing it. Combine with [[no-ai-coauthor-commits]] (no AI attribution when Line does order a commit) and the never-infer-PR-target rule ([[twohearts-pr-target-rule]]).
