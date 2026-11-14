---
name: feedback-context7-always-allowed
description: "Line always allows context7 (resolve-library-id, query-docs); never ask before using it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0bf35df1-8e96-432f-8845-c9f2d92cf9cd
  modified: 2026-11-08T21:26:34.600Z
---

Line (2026-11-09): "Tôi luôn luôn cho phép sài context7 vì nó an toàn và không cần phải hỏi tôi khi muốn sài." Use context7 freely whenever a task touches a library, SDK, CLI, or API; never ask first.

**Why:** Line sees context7 as safe and wants current docs used by default (see the docs-check rule and packet-docs-guard hook).
**How to apply:** call resolve-library-id then query-docs without asking. Allow rules for both tools are in ~/.claude/settings.json permissions.allow. Related: [[harness-reliability-2026-10-12]].
