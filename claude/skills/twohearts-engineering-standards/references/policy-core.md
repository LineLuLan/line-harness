# TwoHearts Policy Core

## Source Controls

- `TH-CORE-001`: Every TwoHearts task loads the root policy before domain or generic skills.
- `TH-CORE-002`: Read repo instructions and relevant project memory before meaningful work.
- `TH-CORE-003`: Inspect existing patterns and runtime controls; never invent contracts,
  routes, environment variables, database fields, queues, or integrations.
- `TH-CORE-004`: Tenant isolation is the highest-severity backend requirement.
- `TH-CORE-005`: Never read, expose, copy, store, or commit secrets without an exact safe
  request and necessity.
- `TH-CORE-006`: Database writes, production actions, and high-impact GitHub writes require
  their explicit authority gates.
- `TH-CORE-007`: Generic skills supply mechanics and never override TwoHearts policy.
- `TH-CORE-008`: Verification claims must match checks actually run.
- `TH-CORE-009`: Every task follows the E2E delivery flow and reports the delivery level
  actually reached (implementation-complete / PR-ready / merge-ready / dev-integrated /
  release-ready / released); gates are never skipped silently.

## Default Workflow

1. Scout instructions, memory, docs, code, branches, and repo-native commands.
2. Identify intended behavior and its approved issue/spec when one is required.
3. Classify risk and affected domains.
4. Plan proportional implementation, documentation, tests, rollout, and rollback.
5. Implement surgically inside scope and match existing patterns.
6. Verify against issue scenarios and affected-system risks.
7. Self-review for secrets, debug artifacts, dead code, scope creep, and accidental churn.
8. Update project memory only when product, architecture, API, data, workflow, deployment, or
   release state actually changed.
9. Report evidence and unresolved areas honestly.

## Safety Invariants

- Cross-tenant leakage is a blocker above style, speed, naming, or PR size.
- Never use production credentials locally.
- Never expose secret values to logs, Claude, GitHub, reports, screenshots, or memory.
- Treat real database work as read-only until confirmation, impact, backup, restore, and
  rollback requirements are satisfied.
- Apply idempotency or equivalent deduplication to retryable external side effects (applied
  global safety principle; formal TwoHearts hard-gate status awaits owner approval).
- Do not deploy, release, merge protected branches, trigger workflows, or close production
  incidents by implication.
- Do not silently disable tests or turn a red system into a normal accepted state.
- Do not call static inspection `Verified`.

## Sources

The authority set is the seven policy DOCX files in
`D:\02_Organizations\TwoHearts\Policies\Policies`. The Vietnamese handbook is an explanation
and cross-reference, not a new policy. The skill proposal is design input, not policy
authority.
