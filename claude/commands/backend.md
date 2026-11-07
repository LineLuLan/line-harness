---
description: Backend/API development — services, controllers, middleware, routes. TDD-first workflow.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(git:*), Bash(tsc:*), Bash(curl:*), Bash(docker:*), Bash(python:*), Bash(pytest:*), Bash(pip:*), Bash(uvicorn:*), AskUserQuestion
---

# Backend Development Mode

Scoped workflow for backend/API work. TDD-first approach inspired by Anthropic's Security Engineering and Product Dev teams.

**Supports**: Node.js/TypeScript (Express, Fastify, Next.js API routes) AND Python (FastAPI, Flask, Django)

## STEP 0: Confidence Check & Doc Lookup

**Before writing any code**, verify you understand the framework and APIs you'll use:
- If unsure about any framework API or pattern (Express middleware, FastAPI dependencies, SQLAlchemy sessions, etc.), use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest docs
- Only proceed when you are confident about the approach. If the docs don't clarify, ask the user.
- Do NOT guess at framework APIs — look them up first.

---

## SCOPE BOUNDARY

**IN SCOPE — Only touch these:**
- API routes and controllers (Express routes, FastAPI endpoints, Django views)
- Services and business logic
- Middleware (auth, validation, error handling)
- Backend utilities and helpers
- Backend tests (`*.test.ts`, `*.spec.ts`, `test_*.py`, `*_test.py`)
- API schemas, validators, DTOs (Zod, Pydantic, etc.)
- Server configuration files

**OUT OF SCOPE — Do NOT touch:**
- React/UI components, pages, layouts
- CSS, styles, design tokens
- Frontend state management (stores, context)
- Database migrations or schema changes (use `/database`)
- Infrastructure configs (use `/cloud`)
- Security hardening (use `/security`)

If a backend task requires frontend or database changes, STOP and tell the user:
> "This task also needs [frontend/database] changes at [file]. Use `/frontend` or `/database` for those, or confirm cross-boundary work."

---

## STEP 1: Scope Confirmation

Before any work:

1. **Detect language and framework**:
   ```bash
   # JS/TS project?
   cat package.json 2>/dev/null | grep -E "express|fastify|next|hono|koa" && echo "NODE PROJECT"
   # Python project?
   cat requirements.txt 2>/dev/null | grep -E "fastapi|flask|django|starlette" || \
     cat pyproject.toml 2>/dev/null | grep -E "fastapi|flask|django" && echo "PYTHON PROJECT"
   git branch --show-current
   ```
2. **Identify the API surface** — Which endpoints/services are affected?
3. **Check existing patterns** — Read 1-2 similar routes/services for conventions

Tell the user:
> "Backend scope: [service/module] — I'll be working on [specific endpoints/services]. No frontend, DB schema, or infra changes."

---

## STEP 2: TDD-First Workflow

**Write tests BEFORE implementation** (non-trivial logic only):

1. **Define success criteria as tests**:
   - Happy path: expected input → expected output
   - Edge cases: empty input, boundary values, malformed data
   - Error paths: unauthorized, not found, validation failure
   - Integration: does it work with adjacent services?

2. **Run tests — they should FAIL**:
   ```bash
   # JS/TS
   npm test -- --watchAll=false [test-file] 2>&1 | tail -20
   # Python
   pytest [test-file] -v 2>&1 | tail -20
   ```

3. **Implement until tests pass**

4. **Run full test suite to check for regressions**:
   ```bash
   # JS/TS
   npm test -- --watchAll=false 2>&1 | tail -30
   # Python
   pytest 2>&1 | tail -30
   ```

For trivial changes (renaming, simple config): skip TDD, just implement and verify.

---

## STEP 3: Implementation Standards

### Code Patterns
- Match existing error handling patterns (don't invent new ones)
- Use existing validation approach (Zod, Pydantic, or whatever the project already uses)
- Follow existing auth/middleware chain patterns (Express middleware, FastAPI dependencies, Django decorators)
- No new dependencies without asking the user first

### API Contract Discipline
- If modifying an existing endpoint's request/response shape, list the breaking changes explicitly
- If adding a new endpoint, document: method, path, request body, response shape, auth requirements
- Validate at system boundaries (incoming requests), trust internal code

---

## STEP 4: Verification Gates

Run ALL that apply to the detected language:

```bash
# --- JS/TS Projects ---
npx tsc --noEmit --pretty 2>&1 | tail -30      # Type check
npm test -- --watchAll=false 2>&1 | tail -40    # Tests (or: bun test)
npm run lint 2>&1 | tail -20                    # Lint

# --- Python Projects ---
pytest 2>&1 | tail -40                          # Tests
mypy . 2>/dev/null | tail -20                   # Type check (if configured)
ruff check . 2>/dev/null | tail -20             # Lint (or: flake8, pylint — use project's linter)
```

**All gates must pass.**

Also run:
```bash
# Build check
npm run build 2>&1 | tail -20                  # JS/TS (or: bun run build)

# API smoke test (if server is running)
curl -s http://localhost:PORT/health | head -5
```

---

## STEP 5: Report

```markdown
## Backend Changes Complete

**Service/Module**: [name]
**Endpoints affected**: [list with methods]

### Changes
- [file]: [what changed and why]

### API Contract Changes (if any)
- [endpoint]: [what changed in request/response shape]

### Test Coverage
- New tests: [count]
- All tests passing: YES/NO
- Regressions: NONE / [list]

### Verification
- TypeScript: PASS/FAIL
- Tests: PASS/FAIL
- Lint: PASS/FAIL
```
