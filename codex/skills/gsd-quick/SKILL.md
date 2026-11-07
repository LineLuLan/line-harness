---
name: gsd-quick
description: "Run small, well-defined engineering tasks with explicit scope, spec-driven guarantees, narrow verification, and minimal process overhead."
verified: 2026-08
layer: utility
category: workflow
triggers:
  - "quick task"
  - "just do it"
  - "quick fix"
  - "gsd quick"
  - "quick build"
  - "fast implementation"
inputs:
  - task: "What to do — single focused task"
  - flags: "--discuss (clarify first) | --research (scout first) | --full (plan+execute+verify)"
outputs:
  - implementation: "Working code with commit"
  - verification: "Quick verification pass"
linksTo:
  - verify
linkedFrom:
  - gsd
preferredNextSkills:
  - quality-gate
  - verify
fallbackSkills:
  - fix
  - cook
riskLevel: medium
memoryReadPolicy: selective
memoryWritePolicy: selective
sideEffects:
  - "Creates/modifies code files"
  - "Creates git commit"
  - "May spawn 1 subagent for implementation"
---

# GSD Quick

## Purpose

Execute a single, focused task with GSD guarantees but minimal ceremony.
No phases, no roadmap, no multi-wave execution — just plan-execute-verify
in one shot. Perfect for:

- Bug fixes
- Small features (1-3 files)
- Refactors with clear scope
- Adding a component, route, or utility

## Workflow

### Default (no flags): Scout → Implement → Verify

```
1. Quick scout: grep/glob for relevant files (30 seconds)
2. Create mental plan: what files to touch, what to change
3. Implement: make the changes
4. Quick verify: typecheck + test affected files
5. Commit: atomic commit with clear message
```

### With --discuss: Clarify → Scout → Implement → Verify

```
1. Identify gray areas in the request
2. Ask user to clarify (max 2-3 questions)
3. Then proceed with default flow
```

### With --research: Research → Scout → Implement → Verify

```
1. Spawn research agent to understand approach
2. Read research results
3. Then proceed with default flow
```

### With --full: Plan → Execute → Verify (mini GSD)

```
1. Create 1 PLAN.md with must-haves
2. Write progress file: /tmp/ultrathink-progress-{session_id}
3. Spawn 1 executor agent with fresh context
4. Update progress as tasks complete
5. Goal-backward verify against must-haves
6. Delete progress file, commit
```

## Progress Tracking

Write progress to `/tmp/ultrathink-progress-{session_id}` so the statusline shows a live bar.
Even for quick tasks with --full or --research (agent spawns), update progress:

```bash
# Before spawning agent
echo '{"mode":"gsd-quick","phase":1,"wave":1,"total_waves":1,"agents":[{"plan":"quick","status":"running"}],"tasks":{"total":3,"completed":0,"current":"Implementing"}}' > /tmp/ultrathink-progress-{session_id}

# After agent returns
rm -f /tmp/ultrathink-progress-{session_id}
```

## Deviation Rules (Simplified)

For quick tasks, simplified rules:

| Situation | Action |
|-----------|--------|
| Blocking bug found | Fix it inline, note in commit message |
| Missing dependency | Install it, continue |
| Scope expanding beyond 3 files | STOP — suggest using full `gsd` instead |
| Architecture question | STOP — ask user before proceeding |

## Quick Mode Decision Tree

```
Is it a bug fix?           → Default mode (no flags)
Is it a small feature?     → Default or --research
Is the request ambiguous?  → --discuss
Is it touching >3 files?   → --full or escalate to gsd
Is it a new pattern?       → --research
```

## Best Practices

1. **Quick means quick** — if you're planning for >5 minutes, use full GSD
2. **Still verify** — even quick tasks get a typecheck + test pass
3. **Atomic commits** — one commit per quick task
4. **Know when to escalate** — >3 files or architecture changes = full GSD
5. **Include context in commit** — commit message explains the WHY
6. **Don't skip research for new patterns** — use --research flag

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Quick task grows into feature | Context fills, quality drops | Escalate to full GSD at 3+ files |
| Skipping verification | Ships broken code | Always typecheck at minimum |
| No commit message context | Git history is unhelpful | Include why, not just what |
| Over-engineering quick tasks | Wastes time on ceremony | Quick = minimum viable, iterate later |

## Examples

### Bug Fix (default)

```
User: "The login button doesn't redirect after auth"

Quick:
  Scout: grep for login handler, auth callback
  Fix: Add router.push('/dashboard') after successful auth
  Verify: tsc clean, existing tests pass
  Commit: "fix(auth): redirect to dashboard after login"
```

### Small Feature (--research)

```
User: "Add a loading skeleton to the users table"

Quick --research:
  Research: Check if project uses a skeleton library (shadcn? custom?)
  Scout: Find UsersTable component
  Implement: Add Skeleton component with table row pattern
  Verify: tsc clean, visual check
  Commit: "feat(ui): add loading skeleton to users table"
```
