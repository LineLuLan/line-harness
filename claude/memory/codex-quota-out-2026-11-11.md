---
name: codex-quota-out-2026-11-11
description: Codex was out of quota 11-12 Nov 2026 (dev on Opus + Fable only); Line switched back to Codex on 2026-11-13
metadata:
  node_type: memory
  type: project
  originSessionId: 0bf35df1-8e96-432f-8845-c9f2d92cf9cd
  modified: 2026-11-13T10:49:46.981Z
---

11-11 to 12-11-2026: Codex quota ran out, Line said dev with Opus + Fable only (L2 = fresh Fable subagent instead of Astra).
2026-11-13: Line chose to go back to Codex workers (codex-do: Sol Standard-A, Astra Important), with Opus subagents only when Codex is over its daily quota budget.

**Why:** Line wants delegation to Codex to be efficient; quota pacing card in Line Hub shows the daily budget.
**How to apply:** route by quota pace (see [[review-gate]], [[codex-gpt6-astra]]); check Line Hub "Am I on pace" before large dispatches.
