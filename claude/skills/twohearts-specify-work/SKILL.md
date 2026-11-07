---
name: twohearts-specify-work
description: TwoHearts product-intake and work-specification policy for PRDs, user stories, GitHub issue specs, risk tiers, Gherkin scenarios, Definition of Done, documentation impact, implementation planning, and spec drift. Use for any TwoHearts task that defines, decomposes, plans, or changes intended behavior before implementation or review.
verified: 2026-08
---

# TwoHearts Specify Work

Use this skill only after `$twohearts-engineering-standards` establishes TwoHearts scope and
policy status. Treat the approved issue/spec and durable system documentation as complementary
sources of intent.

## Workflow

1. Read the applicable repo instructions and project memory selected by the root skill.
2. Trace the request from user need to story or PRD context, then to one or more issue-ready
   work units. Sprints are weekly: the product team supplies user stories, a dev (mostly
   [founder]) writes the PRD grounded in codebase truth, and a dev converts stories to issues at
   PRD time — the agent assists these steps but does not own PRD authorship.
2b. Apply issue granularity: do NOT open one issue per tiny feat. Group related Trivial and
   small Standard items into one umbrella issue per module/domain or sprint theme, each item
   as its own checklist entry with its own scenarios and evidence; PRs link `Part of #N`.
   High-risk work is NEVER batched — always its own issue. See Issue Granularity in
   [references/specification-controls.md](references/specification-controls.md).
3. Classify each unit as Trivial, Standard, or High-risk. If uncertain, choose the higher tier.
4. Describe behavior with happy, invalid-input, failure, cancel, retry, and boundary scenarios.
5. Record out-of-scope behavior, Definition of Done, evidence plan, and documentation impact.
6. State the required approval evidence. Standard and High-risk work require issue approval
   before merge, but the machine-readable approval mechanism remains open.
7. Reconcile discoveries back into the living issue/spec instead of letting code and intent
   diverge.

Read [references/specification-controls.md](references/specification-controls.md) when drafting
or checking a specification.

## Risk Rules

- Treat auth, tenant behavior or data, payments, migrations, order lifecycle, and prompts or
  models that change customer behavior as High-risk.
- Do not infer low risk from a small diff.
- Midweek feature requests default to the next sprint. Do not classify one as crucial yourself
  (that definition is an open policy decision) — and even a crucial request enters only after
  requirements and flow are worked into a spec.
- Do not skip specification work because a request is urgent.

## Authority Boundary

- Do not create or mutate a GitHub issue unless the user requested that write.
- Do not approve an issue or claim approval without evidence.
- Do not invent business priority, acceptance criteria, API contracts, data fields, or product
  behavior.
- Surface `OPEN POLICY DECISION` when approval state, crucial-request handling, or another
  unresolved rule materially affects the work.

## Output Contract

Return the risk tier and rationale, issue-ready behavior, scenario/test matrix, out-of-scope,
Definition of Done, documentation impact, approval requirement, and unresolved decisions.
