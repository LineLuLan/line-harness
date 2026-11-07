---
description: Code quality audit — focused single-pass with explicit exit criteria. Prevents diminishing-return loops.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(python:*), Bash(pytest:*), Bash(git:*), Bash(tsc:*), AskUserQuestion
---

# Code Quality Audit Mode

Single-pass, focused audit with explicit exit criteria. Designed to prevent the diminishing-return audit-fix-re-audit loops.

**Key principle from Anthropic's teams**: Run a focused pass for ONE category, fix everything in that category, verify zero findings remain, then STOP. Do not audit other categories unless explicitly asked.

## STEP 0: Confidence Check & Doc Lookup

If auditing patterns related to a specific framework or library (e.g., React rendering, SQLAlchemy sessions, Express middleware chains), use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to verify your understanding of correct patterns before flagging issues. False positives from misunderstanding framework behavior waste everyone's time.

## SCOPE BOUNDARY

**This command audits code quality, NOT security.** For security audits, use `/security`.

**Audit categories** (pick ONE per run):
1. **Consistency** — Cross-file patterns, naming conventions, code style drift
2. **Dead code** — Unused imports, functions, variables, files
3. **Error handling** — Missing try/catch, unhandled promises, silent failures
4. **Type safety** — Any types, missing generics, unsafe casts, type assertions
5. **Test coverage** — Untested critical paths, missing edge cases
6. **API contracts** — Request/response shape mismatches, missing validation
7. **Performance** — N+1 queries, unnecessary re-renders, missing memoization
8. **Documentation** — Stale comments, misleading docs, missing API docs

---

## STEP 1: Define Scope and Exit Criteria

Ask the user:

> "Which audit category? [1-8 from list above]
> Which module/directory? [specific path or 'full app']"

Then state the exit criteria explicitly:

> "**Exit criteria**: Zero findings in [CATEGORY] for [MODULE] after remediation. I will NOT audit other categories unless you ask."

---

## STEP 2: Scan

### Rules for Scanning
- **Verify every claim** — Do NOT say a file doesn't exist without checking. Do NOT mark something as an issue without reading the actual code.
- **Check actual file state** — `stat` or `Read` every file you reference
- **No false positives** — Only flag things that are genuinely wrong, not stylistic preferences
- **Context matters** — Read surrounding code before flagging. What looks unused might be used dynamically.

### Scan Execution

Use parallel agents for large scans:
```
Task(subagent_type="Explore", prompt="Find all [CATEGORY issues] in [MODULE]. List each with file:line and explanation.")
```

For smaller scans, search directly:
```
Grep for patterns relevant to the chosen category
Read flagged files to verify findings
```

---

## STEP 3: Findings Report

```markdown
### Audit Findings: [CATEGORY] in [MODULE]

| # | File:Line | Issue | Severity | Fix |
|---|-----------|-------|----------|-----|
| 1 | `path:42` | [description] | HIGH/MED/LOW | [fix description] |
| 2 | `path:88` | [description] | HIGH/MED/LOW | [fix description] |

**Total**: X findings
```

Present to user and ask:
> "Found X issues. Should I fix all, or do you want to review and select which to fix?"

---

## STEP 4: Remediation

Fix findings based on user's choice. For each fix:
1. Make the change
2. Verify the change doesn't break anything adjacent

**After fixing ALL selected items**, re-scan the same category:
> "Re-scanning [CATEGORY] for [MODULE]..."

If new findings: fix them (this is normal — fixes can expose related issues).
If zero findings: **EXIT CRITERIA MET. STOP.**

---

## STEP 5: Verification Gates

Run ALL that apply to the detected language:

```bash
# --- JS/TS Projects ---
npx tsc --noEmit --pretty 2>&1 | tail -30      # Type check
npm test -- --watchAll=false 2>&1 | tail -30    # Tests (or: bun test)
npm run lint 2>&1 | tail -20                    # Lint
npm run build 2>&1 | tail -20                   # Build check

# --- Python Projects ---
pytest 2>&1 | tail -30                          # Tests
mypy . 2>/dev/null | tail -20                   # Type check
ruff check . 2>/dev/null | tail -20             # Lint
```

All must pass.

---

## STEP 6: Report

```markdown
## Audit Complete: [CATEGORY] in [MODULE]

**Exit criteria met**: YES
**Findings**: X found → X fixed → 0 remaining

### Changes Made
- [file:line]: [what was fixed]

### Verification
- TypeScript: PASS/FAIL
- Tests: PASS/FAIL
- Lint: PASS/FAIL

### Suggested Next Audit
If you want to continue auditing, the next highest-value category for this module is likely: [suggestion based on what you observed during this audit]
```

---

## ANTI-PATTERNS (Do NOT do these)

- Do NOT expand to other categories mid-audit
- Do NOT re-audit more than once after fixes (scan → fix → verify → DONE)
- Do NOT flag style preferences as findings (only flag actual issues)
- Do NOT mark phases complete without checking actual code state
- Do NOT claim a file doesn't exist without running `stat` on it
