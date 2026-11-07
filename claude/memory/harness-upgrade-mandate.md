---
name: harness-upgrade-mandate
description: "Line's standing goal (2026-10-10): keep upgrading the harness and fixing its bugs; report outcomes briefly"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9735a2d7-8039-4e01-be5c-698d96e69807
  modified: 2026-10-09T17:46:16.718Z
---

Line (2026-10-10): "Nói chung phải làm sao nâng cấp và fix bug của harness của tôi là đc" — the goal is an upgraded, bug-free harness (codex-do, codex-review, codex-acc, hooks, statusline, CLAUDE.md rules).

**Why:** Line cares about the result (workers that do not die, no annoying errors), not long explanations.

**How to apply:** when a harness bug or weakness shows up, fix it end to end (packet, worker, review gate, real execution) without asking again for each harness-internal fix. Still ask before anything outside the harness or hard to reverse (system config, wsl --shutdown while other sessions run, accounts, git push). Keep reports short: what changed, the evidence, what is left. Related: [[harness-worker-deaths]], [[codex-multi-turn]], [[review-gate]].
