---
description: Frontend development — React, Next.js, React Native, UI components, styles, pages. Visual-first workflow.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(git:*), Bash(tsc:*), Bash(expo:*), Bash(eas:*), AskUserQuestion
---

# Frontend Development Mode

Scoped workflow for frontend work (web and mobile). Follows Vercel React best practices and visual-first approach.

**Supports**: React, Next.js, React Native / Expo

## SCOPE BOUNDARY

**IN SCOPE — Only touch these:**
- Components (`src/components/`, `app/`, `pages/`)
- Styles (`*.css`, `*.scss`, `*.module.css`, `tailwind.config.*`)
- Client-side hooks, context, stores
- UI tests (`__tests__/`, `*.test.tsx`, `*.spec.tsx`)
- Static assets and public files
- Layout and page files

**OUT OF SCOPE — Do NOT touch:**
- API routes (server-side logic)
- Database models, migrations, schemas
- Backend services, middleware, controllers
- Infrastructure configs (Docker, K8s, Terraform)
- Environment variables or secrets

If a frontend task requires backend changes, STOP and tell the user:
> "This task touches backend code at [file]. Switch to `/backend` for that portion, or confirm you want me to proceed across boundaries."

---

## STEP 0: Confidence Check & Doc Lookup

**Before writing any code**, verify you understand the framework and APIs you'll use:
- If unsure about any React/Next.js/React Native API or pattern, use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest docs
- Only proceed when you are confident about the approach. If the docs don't clarify, ask the user.
- Do NOT guess at framework APIs — look them up first.

---

## STEP 1: Scope Confirmation

Before any work, verify:

1. **Detect the platform**:
   ```bash
   # Web (React/Next.js)?
   cat package.json 2>/dev/null | grep -E "react-dom|next" && echo "WEB PROJECT"
   # Mobile (React Native/Expo)?
   cat package.json 2>/dev/null | grep -E "react-native|expo" && echo "MOBILE PROJECT"
   ```
2. **Confirm the project** — Check `package.json` name and framework
3. **Confirm the task** — Restate what you're doing in one sentence
4. **Identify target files** — List the specific components/pages you'll modify

Tell the user:
> "Frontend scope: [project name] ([web/mobile]) — I'll be working on [specific files/components]. This won't touch any backend, API, or infrastructure code."

---

## STEP 2: Visual Context (Recommended)

**Ask the user**: "Do you have a screenshot or mockup of what this should look like? Paste it with Cmd+V for best results."

If a screenshot is provided:
- Analyze the visual: layout, spacing, colors, typography, states
- Reference the screenshot throughout implementation
- Verify against the screenshot when done

If no screenshot:
- Proceed with text description
- Take browser screenshots after implementation for user review

---

## STEP 3: Implementation

### Workflow Pattern: Component-First

1. **Read existing patterns** — Check 2-3 existing components for conventions (naming, file structure, styling approach)
2. **Implement the component/change** following existing patterns exactly
3. **Handle states** — Loading, error, empty, and edge case states
4. **Responsive check** — Ensure mobile/tablet/desktop if applicable

### Code Standards
- Match existing styling approach (CSS modules, Tailwind, styled-components — whatever the project uses)
- No inline styles unless the project already uses them
- Preserve existing component API (props interface) unless explicitly asked to change
- Use existing design tokens/variables — do not hardcode colors, spacing, fonts

---

## STEP 4: Verification Gates

Before declaring done, run ALL that apply. **Detect the project's package manager** (`npm`, `bun`, or `yarn`) and test runner, then use the right commands:

```bash
# TypeScript check
npx tsc --noEmit --pretty 2>&1 | tail -30

# Lint (use project's lint command)
npm run lint 2>&1 | tail -20  # or: bun run lint

# Tests (if they exist for modified components)
npm test -- --watchAll=false --passWithNoTests 2>&1 | tail -30  # or: bun test

# Build check (web only — skip for React Native)
npm run build 2>&1 | tail -20  # or: bun run build

# React Native / Expo — type check is sufficient (no build gate needed)
# For RN, verify no import errors: npx expo doctor 2>/dev/null | tail -10
```

**All gates must pass.** If any fail, fix before reporting done.

---

## STEP 5: Visual Verification (If Browser Available)

If browser automation tools are available:
1. Navigate to the page with the change
2. Take a screenshot
3. Compare against the original mockup/screenshot
4. Show the user the before/after

---

## STEP 6: Report

```markdown
## Frontend Changes Complete

**Component(s)**: [list]
**Files modified**: [list with what changed]

### Visual
[Screenshot or description of the result]

### Verification
- TypeScript: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL
- Build: PASS/FAIL
```
