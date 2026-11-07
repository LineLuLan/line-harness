---
name: twohearts-pr-target-rule
description: "TwoHearts rule: NEVER open a PR into dev/main (or any branch) without asking the user which target branch — a general 'create a PR' request does not cover the target choice"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T10:57:26.307Z
---

User correction (2026-07-31): the TwoHearts GitHub-flow skill used to say "target PRs to `dev`",
which could have caused an agent to open PRs into `dev`/`main` unasked. The user's actual rule:
**never open a pull request without asking them which branch it must target** — `dev` and `main`
are never assumed, and a general "create a PR" authorization does not cover the target choice.

**Why:** wrong-target PRs on TwoHearts product repos are a production-risk event ("tai họa");
the `feature -> dev -> main` model describes how changes flow, not authority to open PRs.

**How to apply:** before creating ANY PR on TwoHearts work, ask the user for the target (base)
branch and get written confirmation in the current conversation. Codified in
`C:\Users\ASUS\.codex\skills\twohearts-manage-github-flow\SKILL.md` (Workflow step 3 + Hard
Stops) and `references/github-controls.md` (`TH-GH-002`, `TH-GH-008`). Related:
[[codex-agents-rules]].
