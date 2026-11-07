---
name: task-delegation
description: Convert AI research findings, architecture reviews, eval plans, model decisions, data pipeline requirements, tool-calling audits, or training strategy into precise implementation tasks for the implementer or an engineering/data/AI team. Use when the AI Research Lead needs to delegate work with clear context, scope, acceptance criteria, files, metrics, validation commands, risks, and expected deliverables.
verified: 2026-08
---

# AI Task Delegation

Use this skill to turn research judgment into executable engineering work.

## Delegation Principles

- Give the implementer a decision-ready task, not vague ambition.
- Include exact evidence and expected outcome.
- Scope the task tightly: files/modules/systems if known, no unrelated refactors.
- Define acceptance criteria and eval/verification gates.
- State non-goals and safety boundaries.
- Ask the implementer to report blockers, assumptions, and verification evidence.

## Task Packet Template

```markdown
## Task
[One-sentence implementation objective]

## Context
[Research finding, model/eval result, architecture reason, business impact]

## Scope
[Systems/files/modules/data sources to inspect or change]

## Requirements
- [Functional requirement]
- [Data/model/tool-flow requirement]
- [Cost/latency/safety requirement]

## Acceptance Criteria
- [Measurable completion condition]
- [Eval/test threshold]
- [Rollback or monitoring condition]

## Validation
- [Commands, evals, traces, dashboards, or manual checks]

## Constraints
- Do not read or expose secrets.
- Do not change production behavior without approval.
- Do not broaden scope unless required to satisfy the acceptance criteria.

## Deliverable
[PR, report, eval artifact, architecture diagram, test suite, dataset, or implementation summary]
```

## Severity Labels

- `P0`: production/customer/revenue loss, security/privacy, or wrong external side effect.
- `P1`: model/tool flow materially wrong or high cost risk.
- `P2`: quality, robustness, or observability gap.
- `P3`: cleanup, docs, or future improvement.

## Review Checklist Before Sending

- Does the task say why it matters to revenue, cost, quality, or risk?
- Can the implementer finish without guessing?
- Are evals or tests explicit?
- Are safety boundaries clear?
- Is the output format clear enough to review quickly?
