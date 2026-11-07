---
name: gsd-plan
description: "Spec-driven planning — create XML-structured plans with must_haves, wave assignments, and deviation rules"
verified: 2026-08
layer: hub
category: workflow
triggers:
  - "gsd plan"
  - "plan phase"
  - "create execution plan"
  - "spec driven plan"
  - "plan with must haves"
inputs:
  - task: "What to implement"
  - phase: "Phase number (if multi-phase)"
  - context: "REQUIREMENTS.md, ROADMAP.md, prior SUMMARY.md files"
outputs:
  - spec: "SPEC.md with acceptance criteria, constraints, non-goals"
  - plans: "PLAN.md files with must_haves traced to SPEC.md, tasks, wave assignments"
  - research: "RESEARCH.md with codebase analysis"
linksTo:
  - gsd-execute
linkedFrom:
  - gsd
  - cook
preferredNextSkills:
  - gsd-execute
fallbackSkills:
  - plan
riskLevel: low
memoryReadPolicy: selective
memoryWritePolicy: selective
sideEffects:
  - "Creates SPEC.md in .planning/ (acceptance criteria, constraints, non-goals)"
  - "Creates PLAN.md files in .planning/ (traced to SPEC.md)"
  - "Creates RESEARCH.md in .planning/"
  - "Spawns research subagents"
agentConfig:
  model: opus
  tools: ["Read", "Grep", "Glob", "Bash", "Agent"]
---

# GSD Plan

## Purpose

Create spec-driven execution plans where **plans ARE prompts** — each plan contains
everything a fresh-context executor agent needs to implement without any ambient context.

## Workflow

### Phase 1: Research (Parallel Subagents)

Spawn up to 4 parallel research agents:

1. **Codebase scout** — map relevant files, patterns, conventions
2. **Domain research** — understand the problem space (web search if needed)
3. **Dependency check** — what exists, what needs installing
4. **Pattern analysis** — how similar things are done in this codebase

Each agent writes findings to a section. Synthesize into `RESEARCH.md`.

### Phase 1.5: Spec (OpenSpec-absorbed)

After research, before decomposing into plans, write `SPEC.md` — the formal contract.
This prevents scope drift and gives every executor agent clear acceptance criteria.

```markdown
# Spec: {feature/change title}

## Problem Statement
{WHY this change is needed — the motivation, not the solution}

## Acceptance Criteria
- [ ] {Specific, testable criterion — user-visible behavior}
- [ ] {Another criterion — measurable outcome}
- [ ] {Edge case handling}
- [ ] {Performance/security requirement if applicable}

## Constraints
- {Technical constraint — e.g., must use existing auth middleware}
- {Business constraint — e.g., backwards compatible with v2 API}

## Non-Goals (explicit scope fence)
- {What this change does NOT include}
- {Future work explicitly deferred}

## Technical Approach (brief)
{High-level approach from research — 3-5 sentences max}
{Reference RESEARCH.md for details}
```

**Rules:**
- Acceptance criteria MUST be testable (not "works correctly" — HOW to verify)
- Non-goals prevent scope creep during execution (deviation rule #5)
- SPEC.md is the source of truth — PLAN.md must-haves trace back to these criteria
- If the spec changes mid-execution, STOP and update spec first

### Phase 2: Plan Decomposition

Break the task into plans with **2-3 tasks each** (never more).
Each plan's must-haves MUST trace to SPEC.md acceptance criteria:

```markdown
# Plan: {phase}-{number} — {title}

<plan_metadata>
wave: 1
depends_on: []
estimated_tasks: 2
risk: low|medium|high
files_owned: [src/path/to/file.ts, src/path/to/other.ts]
</plan_metadata>

## Context
{Everything the executor needs to understand this plan}
{Include relevant patterns from RESEARCH.md}
{Include relevant code snippets — the agent can't read your context}

## Must-Haves
- [ ] {Specific, testable requirement}
- [ ] {Another specific, testable requirement}
- [ ] Build passes with no new errors
- [ ] Existing tests still pass

## Tasks

### Task 1: {title}
**Files to create/modify:**
- `src/path/to/file.ts` — {what to do}

**Approach:**
{Step-by-step implementation instructions}

**Verification:**
{How to confirm this task is done}

### Task 2: {title}
...

## Deviation Rules
1. Bug blocks task → fix it, add comment, continue
2. Missing dep → install it, continue
3. Minor adjustment (<5 min) → do it, document in SUMMARY.md
4. Architecture change needed → STOP, report back
5. Scope creep → STOP, document for next phase

## References
{Paste relevant code snippets the agent will need}
{The agent gets ONLY this plan — include everything}
```

### Phase 3: Wave Assignment

Map dependencies into waves:

```
Wave 1: Plans with no dependencies (run in parallel)
Wave 2: Plans that depend on Wave 1 outputs
Wave 3: Plans that depend on Wave 2 outputs
```

Rule: **maximize parallelism, respect dependencies**

### Phase 4: Plan Verification

Before handing to executor, verify each plan:

- [ ] Has testable must_haves (not vague "works correctly")
- [ ] Has 2-3 tasks (not more)
- [ ] Includes all context the agent needs (code snippets, patterns)
- [ ] Wave dependencies are correct
- [ ] `files_owned` lists every file the plan creates/modifies (for conflict detection)
- [ ] Deviation rules included
- [ ] No stubs or placeholders in the plan itself

## Must-Have Quality Checklist

Good must-haves are:
- **Specific**: "POST /api/users returns 201 with user JSON" not "user creation works"
- **Testable**: Can be verified by reading code or running a command
- **Independent**: Each must-have is verifiable on its own
- **Complete**: Cover all acceptance criteria, not just happy path

## Best Practices

1. **Include code snippets in plans** — the agent can't read your memory
2. **2-3 tasks per plan, max** — keeps agent context focused
3. **Must-haves drive verification** — if you can't verify it, rewrite it
4. **Wave 1 should be foundation** — types, schemas, shared utilities
5. **Each plan is self-contained** — an agent should understand it without other plans
6. **Use the codebase's conventions** — research phase discovers these

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Vague must-haves | Can't verify completion | Write testable criteria |
| Too many tasks per plan | Agent context overflows | Split into multiple plans |
| Missing code context | Agent reinvents patterns | Include relevant snippets |
| Wrong wave order | Dependent code breaks | Map dependencies carefully |
| Plans reference each other | Agent can't see other plans | Each plan is self-contained |
| Skipping research | Plans miss conventions | Always run parallel research first |

## Examples

### Simple Plan (1 wave)

```markdown
# Plan: 1-1 — Add user avatar upload

<plan_metadata>
wave: 1
depends_on: []
estimated_tasks: 2
risk: low
files_owned: [src/app/api/upload/avatar/route.ts, src/components/ProfileHeader.tsx, prisma/schema.prisma]
</plan_metadata>

## Must-Haves
- [ ] POST /api/upload/avatar accepts image file, stores in /public/avatars
- [ ] User model has `avatar_url` field
- [ ] Avatar displays in profile header component
- [ ] Files >5MB are rejected with 413 status

## Tasks

### Task 1: Upload API route
**Files:** `src/app/api/upload/avatar/route.ts`
**Approach:** Use Next.js route handler, formidable for parsing, sharp for resize
**Verification:** curl -F "file=@test.jpg" localhost:3000/api/upload/avatar returns 200

### Task 2: Profile avatar display
**Files:** `src/components/ProfileHeader.tsx`, `prisma/schema.prisma`
**Approach:** Add avatar_url to User model, display with next/image
**Verification:** Avatar appears in profile page after upload
```
