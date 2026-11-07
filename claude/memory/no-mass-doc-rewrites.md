---
name: no-mass-doc-rewrites
description: "User rule: NEVER mass-rewrite or repair existing docs wholesale — new standards apply forward-only (new files or files the task explicitly targets); legacy drift is reported as backlog, not fixed"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T14:13:51.787Z
---

User correction (2026-07-31, while planning TwoHearts docs work): I proposed "repairing" all
broken docs in twohearts-delivery-backend (dead INDEX links, empty SPECs, missing
CONTRACTS.md). The user stopped it: **"sửa lại hết thì đó là viết lại toàn bộ docs rồi, rất
nguy hiểm, không được"** — repairing everything equals rewriting the whole doc corpus, which
is dangerous and forbidden.

**Why:** existing docs are load-bearing knowledge; bulk rewrites by an agent can silently
destroy or distort information nobody reviews line-by-line.

**How to apply:**
- New documentation standards apply **forward-only**: to files being created now, or files
  the current task explicitly asks to edit.
- Legacy docs that violate a standard (dead links, stubs, wrong format) → list them in a
  **drift report / backlog** for the user to turn into issues. Never fix them unrequested.
- A bulk documentation rewrite happens only on the owner's explicit request, scoped per file.
- This is codified in `twohearts-write-docs` (workflow step 6, Hard Stops, TH-DOC-007) and
  `references/repo-doc-systems.md` (Anti-mass-rewrite rule).

Related: [[twohearts-skills-policy-alignment]], [[codex-agents-rules]].
