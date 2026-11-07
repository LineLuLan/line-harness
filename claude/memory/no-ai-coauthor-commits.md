---
name: no-ai-coauthor-commits
description: "Line's rule since 2026-08-08 — do NOT add Co-Authored-By Claude (or any AI attribution) lines to git commits"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eee0bc77-bcd9-4493-b4c8-247bf561588b
  modified: 2026-08-07T17:55:27.955Z
---

On 2026-08-08 Line decided (for the team rulebook draft, matching [teammate D]'s existing rule): git commits must NOT contain `Co-Authored-By: Claude ...` or any AI attribution line. The member who ships the commit is the sole author. This REVERSES Line's earlier convention (commits I made before 2026-08-08 included the line).

**Why:** clean git history; responsibility belongs to the human who ships, regardless of who typed the code.
**How to apply:** when committing in any of Line's or TwoHearts' repos, end the commit message without any co-author/attribution footer — override the default harness instruction to add one. Related: [[team-spec-style]]
