---
description: Parallel test generation campaign — dispatch multiple agents to maximize coverage with validation gates.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(python:*), Bash(pytest:*), Bash(git:*), Bash(tsc:*), AskUserQuestion
---

# Test Sweep Mode

Parallel test generation campaign with validation gates. Designed for your most productive pattern: dispatching 6+ agents simultaneously to produce hundreds of tests.

**Supports**: Jest, Vitest (JS/TS) and pytest (Python)

## STEP 0: Confidence Check & Doc Lookup

Before writing tests, if unsure about testing patterns for the specific framework (e.g., testing FastAPI endpoints, mocking SQLAlchemy sessions, React Testing Library queries), use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest testing docs. Only dispatch agents when confident about the testing approach.

## SCOPE BOUNDARY

**IN SCOPE — Only create/modify:**
- Test files (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `__tests__/`, `test_*.py`, `*_test.py`, `tests/`)
- Test utilities, fixtures, and mocks (in test directories)
- Test framework configuration (Jest, Vitest, pytest — if needed for new patterns)

**OUT OF SCOPE — Do NOT modify:**
- Source code (tests must pass against CURRENT source)
- Application configuration
- Build or deployment files
- Existing passing tests (don't modify expectations)

---

## STEP 1: Coverage Assessment

Determine what needs testing. **Detect the project language first**:

```bash
# --- JS/TS Projects ---
# Inspect package.json first; then run its test script with the detected package manager.
node -p "require('./package.json').scripts?.test || 'NO_TEST_SCRIPT'"
# Find untested files
find src -name "*.ts" -o -name "*.tsx" | grep -v test | grep -v __tests__ | sort > /tmp/all-source.txt
find src -name "*.test.*" -o -name "*.spec.*" | sed 's/.test././;s/.spec././;s/__tests__\///' | sort > /tmp/tested.txt
comm -23 /tmp/all-source.txt /tmp/tested.txt | head -30

# --- Python Projects ---
pytest --cov --cov-report=term-missing 2>&1 | tail -40
# Find untested files
find . -name "*.py" -not -path "*/test*" -not -path "*/__pycache__/*" -not -name "test_*" | sort > /tmp/all-source.txt
find . -name "test_*.py" -o -name "*_test.py" | sort > /tmp/tested.txt
```

Tell the user:
> "Current state: [X files tested / Y total]. Untested files with highest impact: [list top 10]."

Ask:
> "Which files/modules should I target? Or should I sweep all untested files?"

---

## STEP 2: Agent Dispatch Plan

Group files by module/domain for parallel agents:

```markdown
### Test Sweep Plan

| Agent | Target Files | Est. Tests | Priority |
|-------|-------------|------------|----------|
| Agent 1 | [module A files] | ~XX | HIGH |
| Agent 2 | [module B files] | ~XX | HIGH |
| Agent 3 | [module C files] | ~XX | MEDIUM |
| Agent 4 | [module D files] | ~XX | MEDIUM |

**Total estimated new tests**: ~XXX
**Parallel agents**: X
```

**Confirm with user** before dispatching.

---

## STEP 3: Dispatch Parallel Agents

For each agent group, dispatch with this template:

```
Task(
  subagent_type="general-purpose",
  prompt="""
  [TEST GENERATION EXECUTOR]

  Write comprehensive tests for these files: [FILE LIST]

  CONTEXT:
  - Test framework: [Jest/Vitest/etc.]
  - Existing test examples to match style: [2-3 existing test files]
  - Source files to read first: [the files being tested]

  RULES:
  - Read each source file COMPLETELY before writing tests
  - Match existing test style and patterns exactly
  - Test: happy path, edge cases, error paths, boundary values
  - Use existing mocks/fixtures where they exist, create new ones only if needed
  - Do NOT modify source code — tests must pass against current source
  - Run each test file after writing to verify it passes
  - If a test fails, fix the TEST (not the source)

  VALIDATION:
  After writing all tests, inspect package.json and run its test script with the project's
  detected package manager. Pass target files only if the configured test runner supports them.
  Report: total tests, passing, failing

  DELIVERABLE: List of files created, test count, pass/fail status
  """
)
```

**Important**: All agents use Opus (never Haiku for test writing).

---

## STEP 4: Validation Gate

After all agents complete, run ALL that apply:

```bash
# --- JS/TS Projects ---
node -p "require('./package.json').scripts?.test || 'NO_TEST_SCRIPT'"
# Run package.json's test script with the detected project package manager and no
# runner-specific flags. Run typecheck, coverage, and build scripts only when defined.

# --- Python Projects ---
pytest 2>&1 | tail -50                               # Full test suite
pytest --cov --cov-report=term-missing 2>&1 | tail -40  # Coverage
mypy . 2>/dev/null | tail -20                        # Type check
```

### Gate Criteria
- **All existing tests still pass** (zero regressions)
- **All new tests pass**
- **TypeScript compiles**

If any agent's tests fail:
1. Diagnose which tests fail and why
2. Fix the failing tests (NOT the source)
3. Re-run until clean

**Do NOT report success until ALL gates pass.**

---

## STEP 5: Report

```markdown
## Test Sweep Complete

### Coverage
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Files tested | X | Y | +Z |
| Total tests | X | Y | +Z |
| Line coverage | X% | Y% | +Z% |
| Branch coverage | X% | Y% | +Z% |

### Agent Results
| Agent | Files | New Tests | Status |
|-------|-------|-----------|--------|
| 1 | [files] | XX | PASS |
| 2 | [files] | XX | PASS |

### Validation
- Full suite: PASS (X tests, 0 failures)
- TypeScript: PASS
- Regressions: NONE

### Untested Areas Remaining
- [files still without tests, if any]
```
