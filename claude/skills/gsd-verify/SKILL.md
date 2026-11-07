---
name: gsd-verify
description: "Goal-backward verification — verify from must-haves backward to artifacts, detect stubs and regressions"
verified: 2026-08
layer: hub
category: workflow
triggers:
  - "gsd verify"
  - "verify work"
  - "goal backward"
  - "check must haves"
  - "verify implementation"
inputs:
  - spec: "SPEC.md with acceptance criteria (source of truth)"
  - plans: "PLAN.md files with must_haves (traced to SPEC.md)"
  - summaries: "SUMMARY.md files from execution"
outputs:
  - verification: "VERIFICATION.md with pass/fail per must-have"
  - fix_plans: "Auto-generated fix plans for failures (if any)"
linksTo:
  - verify
linkedFrom:
  - gsd
  - gsd-execute
preferredNextSkills:
  - gsd-execute
  - pr-writer
  - learn-pattern
fallbackSkills:
  - verify
riskLevel: low
memoryReadPolicy: selective
memoryWritePolicy: selective
sideEffects:
  - "Creates VERIFICATION.md in .planning/"
  - "May create fix PLAN.md files for failures"
agentConfig:
  model: sonnet
  tools: ["Read", "Grep", "Glob", "Bash"]
---

# GSD Verify

## Purpose

Verify implementation **from goals backward** — start with must-haves and trace
to artifacts. This catches stubs, missing integrations, and broken links that
forward-only verification (build + test) misses.

## Key Insight

```
Forward verification:  Code → Build → Tests → "Looks good" (misses stubs)
Backward verification: Must-have → Artifact → Key Links → "Actually works"
```

## Workflow

### Step 0: SPEC → PLAN Traceability Gate (MANDATORY)

**This step is non-negotiable.** If `.planning/SPEC.md` exists, verify traceability FIRST:

1. Read all acceptance criteria from SPEC.md
2. Read all must-haves from every PLAN.md in `.planning/`
3. For each acceptance criterion, find at least one PLAN.md must-have that traces to it
4. **If any criterion has NO matching must-have → STOP and report the gap**

The gap means a requirement was specified but never planned for — this is a missed requirement
that will silently ship incomplete. Do NOT proceed to artifact verification until traceability passes.

```
SPEC.md AC#1: "Users can reset password via email"
  → Plan 1-2 Must-Have: "POST /api/auth/reset sends reset email"  ✅ TRACED

SPEC.md AC#4: "Rate-limited to 100 req/min per user"
  → (no matching must-have in any plan)  ❌ GAP — create a fix plan
```

### Step 1: Collect Must-Haves

Read all PLAN.md files, extract every must-have:

```
Plan 1-1:
  - [ ] POST /api/users returns 201 with user JSON
  - [ ] Password hashed with bcrypt
  - [ ] Email uniqueness enforced at DB level

Plan 1-2:
  - [ ] Login returns JWT + refresh token
  - [ ] Refresh token rotates on use
```

### Step 2: Goal-Backward Trace

For each must-have:

1. **Find the artifact** — grep for the implementation
   ```bash
   # "POST /api/users returns 201"
   grep -rn "POST.*users\|/api/users" src/
   ```

2. **Verify correctness** — read the artifact, check it satisfies the goal
   - Does the route actually return 201?
   - Does it return user JSON (not just `{ ok: true }`)?

3. **Check key links** — trace imports, routes, middleware
   - Is the route registered?
   - Is middleware applied (auth, validation)?
   - Are types consistent across boundaries?

4. **Mark result**: PASS, FAIL, or STUB

### Step 3: Stub Detection

Scan for placeholder patterns that indicate incomplete implementation:

```bash
# Stub patterns to grep for
grep -rn \
  -e 'TODO' \
  -e 'FIXME' \
  -e 'HACK' \
  -e 'placeholder' \
  -e 'mock.*data' \
  -e 'fake.*data' \
  -e 'lorem ipsum' \
  -e 'console\.log' \
  -e 'throw new Error.*not implemented' \
  -e 'return null.*//.*temp' \
  src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.'
```

### Step 4: Technical Verification

Run the standard verification pipeline:

```bash
# Build
npm run build

# Typecheck
npx tsc --noEmit

# Lint
npx biome lint src/ || npx eslint src/

# Tests
npx vitest run

# Coverage (if available)
npx vitest run --coverage
```

### Step 5: Integration Check

For multi-phase projects, verify cross-phase integration:

- Do phase 1 APIs get called by phase 2 frontend?
- Do shared types match across boundaries?
- Are environment variables consistent?
- Do new routes appear in the router?

### Step 6: Generate Report

```markdown
# VERIFICATION.md

## Summary
Phase: 1 | Plans: 3 | Must-Haves: 12

## Results

### Plan 1-1: User API
| # | Must-Have | Status | Evidence |
|---|----------|--------|----------|
| 1 | POST /api/users returns 201 | ✅ PASS | src/app/api/users/route.ts:24 |
| 2 | Password hashed with bcrypt | ✅ PASS | src/lib/auth.ts:8 |
| 3 | Email uniqueness at DB level | ✅ PASS | prisma/schema.prisma:12 @@unique |

### Plan 1-2: Auth
| 1 | Login returns JWT | ✅ PASS | src/app/api/auth/login/route.ts:31 |
| 2 | Refresh token rotates | ❌ FAIL | Token created but not rotated on reuse |

## Stubs Detected
- src/lib/email.ts:15 — TODO: send verification email

## Technical Checks
- Build: ✅ PASS
- Typecheck: ✅ PASS
- Lint: ⚠️ 2 warnings
- Tests: ✅ 14/14 passed

## Verdict
11/12 must-haves PASSED
1 FAIL: refresh token rotation
1 STUB: email verification

## Auto-Fix Plans
→ Generated: 1-fix-1-PLAN.md (refresh token rotation)
→ Deferred: email verification (documented for Phase 2)
```

### Step 7: Auto-Generate Fix Plans

For each FAIL, create a minimal fix plan:

```markdown
# Plan: 1-fix-1 — Fix refresh token rotation

<plan_metadata>
wave: 1
depends_on: ["1-2"]
estimated_tasks: 1
risk: low
</plan_metadata>

## Context
Refresh token is created on login but not rotated when used.
The /api/auth/refresh endpoint reissues a JWT but reuses the same refresh token.

## Must-Haves
- [ ] Using a refresh token invalidates the old one
- [ ] New refresh token issued alongside new JWT
- [ ] Old refresh tokens cannot be reused (returns 401)

## Tasks
### Task 1: Implement token rotation
**Files:** `src/app/api/auth/refresh/route.ts`, `src/lib/tokens.ts`
**Approach:** On refresh, delete old token from DB, issue new pair
```

## Best Practices

1. **Always verify backward** — must-have → artifact, never artifact → "probably fine"
2. **Check key links** — an API route that exists but isn't registered is useless
3. **Stubs are failures** — TODO in production code means the feature isn't done
4. **Auto-generate fix plans** — don't just report failures, create actionable plans
5. **Integration matters** — phase N features must connect to phase N-1
6. **Console.log is a stub** — treat leftover debug logging as incomplete

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Only running build+test | Stubs pass tests but don't work | Goal-backward trace catches stubs |
| Vague must-haves can't be verified | Verification is hand-wavy | Rewrite must-haves to be specific |
| Not checking key links | Route exists but isn't reachable | Trace imports and registrations |
| Ignoring stubs | Placeholder code ships | Grep for TODO/placeholder/mock |
| Fix plans too large | Defeats minimal-diff philosophy | One fix plan per failure, 1 task each |
| Not re-verifying after fix | Fix introduces new issues | Always re-run verification after fixes |

## Examples

### Catching a Stub

```
Must-have: "Email verification sent on signup"

Trace:
  → src/app/api/users/route.ts:45: await sendVerificationEmail(user.email)
  → src/lib/email.ts:15: export async function sendVerificationEmail(email: string) {
  → src/lib/email.ts:16:   // TODO: implement with Resend
  → src/lib/email.ts:17:   console.log("Would send email to", email);
  → src/lib/email.ts:18: }

Verdict: STUB — function exists but is a no-op
```
