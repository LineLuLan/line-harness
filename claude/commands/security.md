---
description: Security audit and hardening — OWASP Top 10, auth flows, secrets, input validation, XSS/SQLi.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(pip:*), Bash(python:*), Bash(git:*), Bash(grep:*), AskUserQuestion
---

# Security Audit & Hardening Mode

Scoped workflow for security work. Structured findings with severity categorization. Inspired by Anthropic's Security Engineering team (who use 50% of all slash commands in their monorepo).

## STEP 0: Confidence Check & Doc Lookup

**Before assessing any security patterns**, verify you understand the framework's security model:
- If unsure about auth middleware, CORS config, session handling, or security headers for the specific framework, use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest docs
- Only flag findings you are confident about. False positives erode trust.
- Do NOT guess at framework security defaults — look them up first.

## SCOPE BOUNDARY

**IN SCOPE — What to examine:**
- Authentication flows (login, signup, token refresh, session management)
- Authorization checks (role-based access, permission guards)
- Input validation and sanitization (all user-facing inputs)
- Output encoding (XSS prevention)
- SQL/NoSQL injection vectors
- Secret management (hardcoded keys, .env exposure)
- CORS, CSP, and security headers
- Dependency vulnerabilities (`npm audit`)
- File upload handling
- Rate limiting and DoS protection
- Error messages leaking internal details

**OUT OF SCOPE — Do NOT change:**
- Business logic (unless it's a security fix)
- UI/UX or styling
- Performance optimizations (unless security-related)
- New features or functionality
- Infrastructure configs (use `/cloud` for that)

---

## STEP 1: Define Audit Scope

Ask the user or determine from context:

> "What area should I audit? Options:
> 1. **Full scan** — All OWASP Top 10 categories across the app
> 2. **Auth flows** — Login, signup, token management, session handling
> 3. **Input validation** — All user inputs, API request bodies, query params
> 4. **Secrets** — Hardcoded keys, exposed env vars, .env files
> 5. **Dependencies** — npm audit, known CVEs in packages
> 6. **Specific module** — [name the module]"

**EXIT CRITERIA**: Define upfront what "done" means:
> "This audit is complete when: zero findings of [CRITICAL/HIGH] severity remain after remediation in the scoped area."

---

## STEP 2: Systematic Scan

Run checks based on the chosen scope. Use parallel agents for speed when doing a full scan.

### Auth Flows
```
Search for: password handling, token generation, session creation, JWT verification,
cookie settings (httpOnly, secure, sameSite), token expiry, refresh logic
```

### Input Validation
```
Search for: req.body, req.params, req.query usage without validation
innerHTML, dangerouslySetInnerHTML, eval(), new Function()
SQL string concatenation, unsanitized template literals in queries
```

### Secrets
```bash
# Check for hardcoded secrets (all languages)
grep -rn "api[_-]?key\|secret\|password\|token" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.py" --include="*.yaml" --include="*.yml" --include="*.json" -l | grep -v node_modules | grep -v ".test." | grep -v __pycache__ | grep -v package-lock

# Check .gitignore covers sensitive files
cat .gitignore | grep -E "\.env|secret|credential|\.pem|\.key"

# Dependency audit
npm audit 2>&1 | head -40          # JS/TS
pip audit 2>/dev/null | head -40    # Python (if pip-audit installed)
```

---

## STEP 3: Structured Findings

Report EVERY finding in this exact format:

```markdown
### [SEVERITY] Finding Title

**Category**: [OWASP category or custom]
**Location**: `file:line_number`
**Description**: [What the vulnerability is]
**Impact**: [What an attacker could do]
**Proof**: [Code snippet showing the vulnerability]
**Fix**: [Exact code change needed]
```

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **CRITICAL** | Exploitable now, data exposure/RCE risk | Fix immediately, block deployment |
| **HIGH** | Exploitable with some effort | Fix before next release |
| **MEDIUM** | Defense-in-depth gap | Fix in current sprint |
| **LOW** | Best practice violation, minor risk | Fix when convenient |
| **INFO** | Observation, no direct risk | Document for awareness |

---

## STEP 4: Remediation

For each CRITICAL and HIGH finding:
1. Show the exact fix (before/after code)
2. Implement the fix
3. Verify the fix doesn't break existing tests
4. If no test covers the vulnerability, write one

For MEDIUM and below: list the fixes but ask before implementing.

---

## STEP 5: Verification

Run ALL that apply to the detected language:

```bash
# --- JS/TS Projects ---
npm test -- --watchAll=false 2>&1 | tail -30    # Tests
npx tsc --noEmit --pretty 2>&1 | tail -20      # Type check
npm audit 2>&1 | head -20                       # Dep audit
npm run lint 2>&1 | tail -20                    # Lint
npm run build 2>&1 | tail -20                   # Build check

# --- Python Projects ---
pytest 2>&1 | tail -30                          # Tests
mypy . 2>/dev/null | tail -20                   # Type check
pip audit 2>/dev/null | head -20                # Dep audit
ruff check . 2>/dev/null | tail -20             # Lint
```

---

## STEP 6: Report

```markdown
## Security Audit Complete

**Scope**: [what was audited]
**Exit criteria met**: YES/NO

### Summary
| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| CRITICAL | X | X | 0 |
| HIGH | X | X | 0 |
| MEDIUM | X | X | X |
| LOW | X | 0 | X |

### Findings Detail
[List each finding with status: FIXED / DEFERRED / ACCEPTED RISK]

### Recommendations
- [Priority improvements not in scope but worth noting]

### Verification
- Tests: PASS/FAIL
- TypeScript: PASS/FAIL
- npm audit: [clean / X vulnerabilities remaining]
```
