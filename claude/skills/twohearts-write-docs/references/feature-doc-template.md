# Feature Doc Template (ground truth per feature) — GENERIC FALLBACK ONLY

Use this template ONLY in repos with no documentation system of their own (per
`repo-doc-systems.md`). In `twohearts-delivery-backend` the module SSOT `SPEC.md` template
from `docs/INDEX.md` is used instead; in `ai-foundary` its own templates are used.

A feature doc is the single ground-truth page for one feature. A new session or a new dev
reads it and knows: what the feature does, where it lives in code, what proves it works, and
what was decided along the way. It uses AI Foundry frontmatter conventions
(`D:\01_Workspaces\TwoHearts\ai-foundary\STYLEGUIDE.md`); filenames are kebab-case English.

Copy from here down when creating one:

---

```markdown
---
title: <Feature name>
file_type: feature
status: accepted            # draft | accepted | superseded
owner: <dev who owns this feature>
created_at: "<YYYY-MM-DD HH:mm +07:00>"
updated_at: "<YYYY-MM-DD HH:mm +07:00>"   # bump on every edit
verified_against: "<commit SHA or date the doc was last checked against code>"
reviewers: []
tags: [feature, <domain>]
related: [<issue link>, <ADR link>, <parent doc>]
---

# <Feature name>

<One paragraph: which actor gets what outcome from this feature, and why it exists.>

## Behavior (ground truth)

<Numbered, observable behaviors. Each line is something you can watch happen.>

1. Given <state>, when <actor action>, then <observable result>.
2. ...

## Entry Points (code references)

| What | Where |
|---|---|
| Route | `src/modules/<feature>/<module>.controller.ts` |
| Service | `src/modules/<feature>/<module>.service.ts` |
| Schema | `src/modules/<feature>/<module>.schema.ts` |
| Queue/worker | `...` (delete rows that do not apply) |

## Contracts

<API request/response shapes, env vars, events, webhooks this feature owns or consumes.
Every item cites the source file it was read from.>

## Data

<Tables/collections and fields touched; how tenant scoping is applied
(e.g. req.withTenantDb()); migrations that created them.>

## Scenarios And Tests

| Issue scenario | Test that proves it |
|---|---|
| <Given/When/Then from the issue> | `src/modules/<feature>/__tests__/<x>.test.ts` |

## Edge Cases And Failure Behavior

<What happens on invalid input, permission denied, external failure, retry, duplicate,
timeout. If unhandled, say "unhandled" — do not guess.>

## Out Of Scope

<What this feature deliberately does not do.>

## Decisions And History

<Links to the issue(s), ADRs, and PRs that shaped this feature, one line each with the why.>

## How To Verify Locally

<Exact commands, copy-paste ready. End with what "working" looks like.>
```

---

## Rules that make it ground truth

- Every route, field, command, env var, and file path in the doc is **read from the code at
  writing time**, never from memory. Each contract cites its source file.
- `verified_against` records the commit SHA (or date) the doc was last checked against code.
  A claim that was not checked is marked `Not verified` inline.
- When the feature's behavior changes, the feature doc updates **in the same PR** — that is
  the docs-same-PR gate applied per feature.
- When the doc and the code disagree, **the code is the fact**; fix the doc and record the
  drift in the issue. Never "fix" code to match a stale doc without a spec decision.
- Where the feature doc lives: in the feature's repo under its docs area (near the code it
  describes), so the same-PR gate is enforceable. Cross-repo knowledge (explorations,
  proposals, ADRs) lives in `ai-foundary` per its README.
