---
name: team-spec-style
description: "Line's formatting rules for team-facing specs/issues — ASD-STE100 English, no icons/emoji, self-contained tables"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eee0bc77-bcd9-4493-b4c8-247bf561588b
  modified: 2026-08-07T17:43:22.401Z
---

For TwoHearts team-facing specs, GitHub issues, and shared docs, Line requires: (1) English in ASD-STE100 style (short sentences, active voice, one instruction per sentence, "must" for requirements); (2) **no icons or emoji** — write statuses as words (KEEP / REWRITE-P0 / DROP), rejected a plan for using checkmark/pencil icons on 2026-08-08; (3) specs must be **self-contained** — embed the actual tables/insights inline so teammates need no side documents ("available on request" pointers were rejected); tag teammates with cc @handle.

**Why:** specs are reference material for teammates ([founder] writes in STE; icons read as unprofessional and lossy when copied).
**How to apply:** before posting any team spec/issue, strip emoji, convert statuses to words, embed full tables, and follow the twohearts-specify-work output contract (risk tier, scenarios, DoD, OPEN POLICY DECISION). Related: [[twohearts-pr-target-rule]]
