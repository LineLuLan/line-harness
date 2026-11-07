---
name: gsd-execute
description: "Execute approved plans in dependency-aware waves with fresh-context agents, bounded file scopes, verification gates, and atomic delivery units."
verified: 2026-08
layer: hub
category: workflow
triggers:
  - "gsd execute"
  - "execute phase"
  - "run the plans"
  - "execute wave"
  - "start building"
inputs:
  - plans: "PLAN.md files from gsd-plan"
  - wave: "Specific wave to execute (default: all waves in order)"
outputs:
  - summaries: "SUMMARY.md per plan with what was done"
  - commits: "Atomic git commits per task"
  - state: "Updated STATE.md"
linksTo:
  - gsd-verify
linkedFrom:
  - gsd
  - gsd-plan
preferredNextSkills:
  - gsd-verify
fallbackSkills:
  - cook
riskLevel: high
memoryReadPolicy: selective
memoryWritePolicy: selective
sideEffects:
  - "Spawns parallel subagents with fresh context"
  - "Creates files and modifies code"
  - "Creates git commits (atomic per task)"
  - "Writes SUMMARY.md per plan"
agentConfig:
  model: sonnet
  tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
  isolation: true
---

# GSD Execute

## Purpose

Execute plans by spawning **fresh-context subagents** for each plan in wave order.
Each agent gets the full 200K context window dedicated to its plan — no context rot.

## Key Concepts

### Fresh Context = Quality

```
Main orchestrator context: ~10-15% used (thin coordinator)
Agent 1 context: 200K fresh → implements Plan 1    ┐
Agent 2 context: 200K fresh → implements Plan 2    │ Wave 1 (parallel)
Agent 3 context: 200K fresh → implements Plan 3    │
Agent 4 context: 200K fresh → implements Plan 4    ┘
Agent 5 context: 200K fresh → implements Plan 5    ┐ Wave 2 (speculative start
Agent 6 context: 200K fresh → implements Plan 6    ┘  if deps satisfied early)
```

### High-Concurrency Mode (Default)

**Target: 6-8 concurrent agents** using git worktree isolation.

| Mode | Max Agents | Isolation | When |
|------|-----------|-----------|------|
| Standard | 4 | Shared workdir | Plans with disjoint file sets |
| Worktree | 6-8 | `isolation: "worktree"` | Plans that may touch overlapping files |
| Sequential | 1 | Shared workdir | Plans with explicit same-file deps |

**Worktree isolation** gives each agent a full copy of the repo. After completion,
changes are merged back. This eliminates file conflicts entirely.

### Speculative Wave Overlap

Don't wait for ALL of Wave N to finish before starting Wave N+1.
Start Wave N+1 plans whose **specific dependencies** are already satisfied:

```
Wave 1: [Plan A, Plan B, Plan C] — all launch immediately
         Plan A completes ✅
         Plan B still running...
         Plan C completes ✅
Wave 2: [Plan D (depends on A), Plan E (depends on A+C)]
         → Plan D can start NOW (A is done)
         → Plan E can start NOW (A+C are done)
         → Plan F (depends on B) must wait
```

**Rule**: Check `depends_on` per plan, not per wave. A plan is ready when
ALL its listed dependencies are completed — regardless of wave boundaries.

### File Ownership Model

Each plan declares `files_owned` in its metadata — the files it will create/modify.
The orchestrator uses this to detect conflicts and decide parallel vs sequential:

```
Plan A files_owned: [src/auth/jwt.ts, src/auth/login.ts]
Plan B files_owned: [src/api/users.ts, src/api/routes.ts]
Plan C files_owned: [src/auth/jwt.ts, src/api/middleware.ts]  ← conflicts with A

→ A and B: parallel (no overlap)
→ A and C: worktree isolation OR sequential (overlap on jwt.ts)
```

### Atomic Commits

Each **task** within a plan gets its own commit:

```
feat(auth): add JWT token generation (Plan 1-1, Task 1)
feat(auth): add refresh token rotation (Plan 1-1, Task 2)
feat(auth): add login API endpoint (Plan 1-2, Task 1)
```

### Agent Prompt Template

Each spawned agent receives:

```markdown
You are executing a GSD plan. Follow it exactly.

## Plan
{full PLAN.md content}

## Deviation Rules
1. Bug blocks task → fix, document, continue
2. Missing dep → install, continue
3. Minor adjustment → fix if <5min, continue
4. Architecture change → STOP immediately, report what and why
5. Scope creep → STOP, document for next phase

## Commit Convention
After each task, create an atomic commit:
  {type}({scope}): {description} (Plan {phase}-{number}, Task {n})

## On Completion
Write a SUMMARY.md with:
- What was implemented
- Any deviations from plan
- Files created/modified
- Must-haves checklist (checked/unchecked)
```

## Progress Tracking

Write progress to `/tmp/ultrathink-progress-{session_id}` (JSON) so the statusline
and progress-display hook can render live progress bars.

### Bridge File Format

Each agent tracks its own task progress. The statusline shows a summary bar;
the progress-display hook shows per-agent lines on each Agent tool return.

```json
{
  "mode": "gsd",
  "phase": 1,
  "wave": 1,
  "total_waves": 3,
  "agents": [
    {
      "plan": "1-1",
      "status": "done",
      "tasks_total": 3,
      "tasks_done": 3,
      "current_task": ""
    },
    {
      "plan": "1-2",
      "status": "running",
      "tasks_total": 2,
      "tasks_done": 1,
      "current_task": "Task 2: Add refresh token"
    },
    {
      "plan": "1-3",
      "status": "queued",
      "tasks_total": 2,
      "tasks_done": 0,
      "current_task": ""
    }
  ],
  "tasks": {
    "total": 7,
    "completed": 4
  }
}
```

**Agent statuses**: `queued` → `running` → `done` | `failed`

### When to Update

| Event | Update |
|-------|--------|
| Wave starts | Set all wave agents as "queued", set wave/total_waves |
| Agent spawned | Set that agent to "running", set tasks_total from plan |
| Agent reports task done | Increment agent's tasks_done, update current_task, increment global tasks.completed |
| Agent returns | Set agent to "done" or "failed" |
| Wave verified | Advance wave, queue next wave's agents |
| All done | Delete the progress file (statusline reverts to normal) |

### How to Write (Using gsd-utils.sh)

Source the shared utilities for easy progress tracking:

```bash
# Source the GSD utilities
source "$(dirname "${BASH_SOURCE[0]}")/gsd-utils.sh"  # from hooks dir
# Otherwise, source the gsd-utils hook from your local hooks directory if present.

# Initialize progress for phase 1 with 2 waves
gsd_progress_init 1 2

# Add agents for wave 1
gsd_progress_add_agent "1-1" 3   # Plan 1-1, 3 tasks
gsd_progress_add_agent "1-2" 2   # Plan 1-2, 2 tasks

# Start agents
gsd_progress_start_agent "1-1" "Task 1: Setup DB schema"
gsd_progress_start_agent "1-2" "Task 1: Create API routes"

# As tasks complete
gsd_progress_task_done "1-1" "Task 2: Add migrations"
gsd_progress_task_done "1-1" "Task 3: Seed data"
gsd_progress_task_done "1-1"  # last task, no next

# Mark agent done
gsd_progress_agent_done "1-1"

# Advance to next wave
gsd_progress_next_wave

# On completion, clean up
gsd_progress_cleanup
```

#### Manual JSON method (fallback)

```bash
# If gsd-utils.sh is not available, write JSON directly:
cat > /tmp/ultrathink-progress-{session_id} << 'PROGRESS'
{"mode":"gsd","phase":1,"wave":1,"total_waves":2,"agents":[{"plan":"1-1","status":"running","tasks_total":3,"tasks_done":0,"current_task":"Task 1"}],"tasks":{"total":5,"completed":0}}
PROGRESS

# Update with jq
jq '.agents[0].tasks_done = 1 | .agents[0].current_task = "Task 2" | .tasks.completed = 1' \
  /tmp/ultrathink-progress-{session_id} > /tmp/ultrathink-progress-{session_id}.tmp \
  && mv /tmp/ultrathink-progress-{session_id}.tmp /tmp/ultrathink-progress-{session_id}
```

On completion, clean up: `rm -f /tmp/ultrathink-progress-{session_id}`

## Workflow

### Step 1: Load Plans and Sort by Wave

```
Read all PLAN.md files from .planning/
Group by wave number
Sort waves ascending
```

### Step 2: Execute Plans (Dependency-Driven, Not Wave-Locked)

Instead of rigid wave-by-wave, use **dependency-driven scheduling**:

```typescript
// Build ready queue: plans whose dependencies are all completed
const ready = allPlans.filter(plan =>
  plan.depends_on.every(dep => completedPlans.has(dep))
)

// Check file ownership conflicts among ready plans
const { parallel, sequential } = resolveConflicts(ready)

// Launch parallel group with worktree isolation
const agents = parallel.map(plan => ({
  type: "general-purpose",
  prompt: buildAgentPrompt(plan),
  isolation: "worktree",  // Default: worktree for safe parallel execution
  run_in_background: true
}))

// Launch all ready agents at once (up to 8)
agents.forEach(a => spawnAgent(a))

// Sequential plans run one at a time after parallel batch
for (const plan of sequential) {
  await spawnAgent({ ...plan, isolation: undefined })
}
```

**Scheduling rules:**
1. A plan is **ready** when ALL its `depends_on` plans are completed
2. Ready plans with **disjoint files_owned** launch in parallel (worktree isolation)
3. Ready plans with **overlapping files_owned** and no worktree → run sequentially
4. With worktree isolation, even overlapping files can run in parallel (merge after)
5. **Max 8 concurrent agents** — queue remainder, launch as slots free up
6. Re-check ready queue after EVERY agent completion (new plans may unblock)

### Step 3: Collect Results (Continuous)

After EACH agent completes (not after entire wave):
1. Read SUMMARY.md from the returned agent
2. Check its must-haves
3. Run quick verification (build + typecheck)
4. If Rule 4 deviation → STOP, report to user
5. **Re-check ready queue** — new plans may now be unblocked
6. Launch any newly-ready plans immediately (up to 8 total concurrent)

### Step 4: Advance (Continuous Flow, Not Wave-Locked)

Plans launch as soon as their dependencies are met — no waiting for entire waves.
The "wave" concept becomes a planning aid, not an execution barrier:

```
Plan A (wave 1) completes → check: which wave 2+ plans depend only on A?
  → Plan D depends on [A] → LAUNCH NOW (don't wait for B, C)
  → Plan E depends on [A, B] → still blocked on B
Plan B (wave 1) completes → check: Plan E depends on [A, B] → both done → LAUNCH NOW
```

**Safety gate**: Build must pass after each batch of completions before launching
plans from the NEXT wave tier. Within the same wave, no gate needed.

### Step 5: Update State

```markdown
# STATE.md update after wave completion

## Current
Phase: 1, Wave: 2 (completed), Status: verified

## Completed
- Wave 1: [Plan 1-1 ✅, Plan 1-2 ✅]
- Wave 2: [Plan 1-3 ✅]
```

## Deviation Handling

| Rule | In Agent | In Orchestrator |
|------|----------|-----------------|
| 1-3 | Agent handles, documents | Orchestrator reviews summary |
| 4 | Agent STOPS | Orchestrator reports to user, creates fix plan |
| 5 | Agent STOPS | Orchestrator defers to next phase |

When an agent reports Rule 4:
1. Read the agent's report
2. Present options to user
3. Create a fix plan if needed
4. Re-execute the affected plan

## Best Practices

1. **Never implement in the orchestrator** — always spawn agents
2. **One plan per agent** — don't combine plans
3. **Verify after each wave** — don't batch all verification to end
4. **Default to worktree isolation** — `isolation: "worktree"` for all parallel agents
5. **Read summaries before advancing** — catch deviations early
6. **Keep STATE.md current** — next session needs it for continuity
7. **Launch up to 8 concurrent agents** — worktree isolation makes this safe
8. **Start plans as soon as deps are met** — don't wait for entire waves

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Executing all waves at once | Later waves break from missing deps | Wave-by-wave with verification |
| Agent modifies unplanned files | Merge conflicts, unexpected changes | Plans list exact files |
| Skipping Rule 4 stops | Architecture breaks silently | Always respect agent STOP signals |
| Not reading summaries | Deviations go unnoticed | Review every summary between waves |
| Too many agents at once | System resource limits | Max 6-8 concurrent agents (worktree isolation) |
| No commits between tasks | Can't revert individual tasks | Atomic commit after each task |

## Examples

### Executing a 2-Wave Phase

```
Wave 1 (parallel):
  → Agent A: Plan 1-1 (API routes)     → SUMMARY: ✅ all must-haves
  → Agent B: Plan 1-2 (Database schema) → SUMMARY: ✅ all must-haves

[Verify Wave 1: build ✅, typecheck ✅, tests ✅]

Wave 2 (sequential — depends on both):
  → Agent C: Plan 1-3 (Frontend integration) → SUMMARY: ⚠️ Rule 3 deviation

[Verify Wave 2: build ✅, typecheck ✅, 1 test needs update]
[Update STATE.md: Phase 1 complete]
```

### Handling a Rule 4 Stop

```
Agent C reports: "Plan requires adding a new database table not in schema.
This is an architectural change (Rule 4). Stopping."

Orchestrator:
  → Presents to user: "Agent found schema needs new 'notifications' table"
  → User confirms: "Yes, add it"
  → Creates fix plan: Add notifications table
  → Re-spawns agent with updated plan
```
