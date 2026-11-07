# Specification Controls

## Source Controls

- `TH-SPEC-001`: Product need flows through a user story or equivalent PRD context before
  implementation.
- `TH-SPEC-002`: Every work unit has a Trivial, Standard, or High-risk tier.
- `TH-SPEC-003`: Standard and High-risk issues include behavior scenarios, unhappy paths,
  edge cases, out-of-scope, Definition of Done, and an evidence plan.
- `TH-SPEC-004`: Standard and High-risk issues require second-developer approval before merge.
- `TH-SPEC-005`: Behavior, API, config, contract, and user-visible changes include a durable
  documentation impact decision.
- `TH-SPEC-006`: Implementation discoveries update the living issue/spec.
- `TH-SPEC-007`: Midweek requests default to the next sprint; even crucial requests enter only
  after a spec exists.
- `TH-SPEC-008`: Related small work is grouped into one umbrella issue instead of one issue
  per tiny feat; each grouped item keeps its own scenarios and evidence; High-risk work is
  never batched.

## Issue Granularity (user directive 2026-07-31)

Keep the GitHub issue list dense with intent, not diluted by micro-issues.

- **Default: group.** Related Trivial and small Standard items go into ONE umbrella issue per
  module/domain or per sprint theme — not one issue each.
- **Grouping criterion is cohesion, not count.** Same module, same domain, or same sprint
  theme. A grab-bag of unrelated items just to reduce issue count is forbidden — it destroys
  the scenario→test→review→QA chain.
- **Each grouped item stays fully specified**: its own checklist entry with expected result,
  scenarios, and evidence plan. The umbrella issue's tier is the HIGHEST tier of its items.
- **PRs link `Part of #N`** (several small PRs against one issue beat one giant PR); the
  umbrella issue closes only when every item is done — leftover items split into a follow-up
  issue, never silently dropped.
- **Never batch High-risk work** (auth, tenant, payments, migrations, order lifecycle,
  customer-behavior-changing prompts): each High-risk unit gets its own issue with the full
  High-risk spec. If a grouped item grows in scope or risk mid-flight, split it out into its
  own issue before continuing.

## Intake (per PRODUCT_INTAKE.md)

Sprints are weekly. The product team supplies user stories; a dev (mostly [founder]) writes a PRD
grounded in codebase truth; a dev converts stories to GitHub issues at PRD time. Each user
story is a one-page doc with exactly these fields: **Actor** (who does this), **Goal** (what
they want), **Trigger** (what starts the flow), **Success** (what a good outcome looks like),
**Out-of-scope** (what the story does not cover), **Priority** (how urgent).

## Tier Minimums

### Trivial

Include the problem, expected result, and evidence plan. Second issue approval is not required,
although normal PR review still applies.

### Standard

Include context, expected flow, Gherkin scenarios, unhappy paths, edge cases, out-of-scope,
Definition of Done, and test evidence. Require issue approval before merge. The standard DoD
items: all scenarios pass in the harness, daily suite green on the branch, issue reflects what
was actually built, second dev approved issue and PRs, lint/typecheck/build pass. An issue is
not approvable if its done checklist is vague.

### High-risk

Use for auth, tenant behavior or data, payments, migrations, order lifecycle, and customer-
behavior-changing prompt or model work. Add failure modes, rollout, rollback, and explicit
statements of what can break. Require issue approval before merge.

## Scenario Shape

Write observable behavior, not implementation:

```gherkin
Given <starting state>
When <actor performs an action>
Then <observable outcome>
```

Cover happy, invalid-input, failure, cancel, retry, and boundary cases when applicable. Map the
same scenarios to developer tests, PR review, and QA steps.

## Open Decisions

Do not invent:

- The label, bot state, or approval phrase that proves issue approval.
- The definition of a crucial midweek request.
- Missing Definition-of-Ready or capacity-planning rules.

Read the root skill's `references/open-decisions.md` before resolving a policy ambiguity.
