# Line Engineering Standards Reference

Status: personal strict-production standard for Line's non-TwoHearts engineering work.

Use this reference after `line-engineering` triggers for meaningful code, review, planning,
debugging, audit, docs, release, backend, fullstack, AI, database, security, or testing work.

## Scope And Precedence

- Applies to non-TwoHearts repositories, workspaces, and engineering tasks.
- Excludes `D:\01_Workspaces\TwoHearts`, paths containing `01_Workspaces/TwoHearts` or
  `01_Workspaces\TwoHearts`, `Twohearts-Technologies/*`, and repos whose docs identify them as
  TwoHearts; use `$twohearts-engineering-standards` there.
- Repo-local `AGENTS.md`, `CONTRIBUTING.md`, project memory, and explicit user instructions
  override this reference when stricter or more specific.
- Global hard-stop safety rules still apply even when this reference is not loaded.

## Operating Loop

1. Scout the repo: instructions, memory, architecture docs, manifests, scripts, relevant source,
   tests, and current patterns.
2. Define success criteria and affected systems for non-trivial work.
3. Plan risky or broad changes before implementation.
4. Implement the smallest maintainable change that satisfies the goal.
5. Verify with repo-appropriate checks.
6. Review the diff for secrets, generated junk, unrelated churn, debug logs, placeholders, and
   accidental scope expansion.
7. Update compact project memory when behavior, architecture, API, data, workflow, deployment, or
   release state changes.
8. Report what changed, what was verified, what remains risky, and exact usage when available.

## Stack And Pattern Discipline

- Detect the stack from repo files and docs; do not assume Node, pnpm, Drizzle, Next.js, Python,
  FastAPI, Prisma, Vercel, Docker, or any other tool.
- Prefer repo scripts over invented commands.
- Prefer current modules, helper APIs, naming, test layout, and error-handling style.
- Use current official docs through Context7 or authoritative sources for frameworks, SDKs, APIs,
  cloud services, and tools that may have changed.
- Avoid new dependencies unless they clearly beat existing helpers or a small local solution.
- Keep abstractions earned: add them only to reduce real duplication, isolate volatile concerns, or
  match an established local pattern.

## Markdown Document Format

When creating new Markdown docs, or substantially rewriting docs with no stronger repo template,
use the TwoHearts-style format: compact, sectioned, checklist-friendly, and evidence-oriented.
Adapt content to the repo; do not copy TwoHearts-specific tenant, Drizzle, branch, or org rules
unless the target repo actually uses them.

Preferred shape:

1. `# <Document Title>`
2. Optional source/status block: source, owner, date, state, implementation status, or review
   status when useful.
3. `## Scope` or `## Scope And Precedence`
4. `## Gate vs Guideline` when the doc defines standards, policies, reviews, releases, or safety.
5. `## Quick Checklist` for PRs, releases, audits, migrations, onboarding, or repeated workflows.
6. Body sections grouped by behavior or subsystem, such as workflow, toolchain, commits, PRs,
   layout, documentation, lint/quality, AI-agent rules, env/secrets, database, dependencies, and
   exceptions.
7. `## Verification`, `## Risks`, `## Rollback`, or `## Final Report Standard` when the doc
   affects implementation or release work.
8. `## Backlog`, `## Follow-ups`, or `## Migration Backlog` when incomplete rollout items remain.

Formatting rules:

- Use title-case `##` headings and short paragraphs.
- Prefer flat bullets and numbered lists over nested bullets.
- Use checklists only for actions that can be verified.
- Label blocking requirements as gates and softer preferences as guidelines.
- Include exact commands, paths, owners, branches, and evidence only when known.
- Use `Verified`, `Static review only`, and `Not verified` exactly for validation language.
- Preserve an existing repo-local Markdown template when one exists; otherwise use this shape.

## Strict-Production Safety

- Treat unknown team, customer-facing, production-like, or public repositories as PR-first.
- Stop for explicit user confirmation before high-impact GitHub writes, production deploys,
  release actions, workflow triggers, protected-branch writes, merges, branch deletion, repo
  settings changes, or customer-impacting external actions.
- Database work is read-only by default. Before data writes, migrations, backfills, destructive DDL,
  seed scripts against non-empty databases, or ownership changes, require target identification,
  risk analysis, backup/restore plan, and explicit confirmation.
- Never read, print, copy, summarize, store, commit, or send secret values unless the user
  explicitly requests the exact safe action and the task cannot proceed without it.
- Prefer dry-run, staging, transaction rollback, local fixture, or read-only inspection before
  write operations.
- For high-risk work, state the risk class, containment or rollback path, and exact evidence
  gathered before implementation.

## Backend And Data Rules

- Public APIs require explicit contracts, input validation, clear errors, and regression coverage
  proportional to risk.
- Auth, RBAC, permission boundaries, billing, payments, and tenant/account isolation are
  high-risk. Prefer plan-first and independent review.
- Migrations should be backward-compatible when possible. Use expand-contract for production-like
  systems and document rollback expectations.
- Raw SQL and low-level data access are acceptable only when useful and reviewed against safety,
  injection, performance, and transaction concerns.
- Handle failures at boundaries: API calls, databases, queues, workers, webhooks, file uploads,
  email/notification systems, model providers, and external services.
- Workers, webhooks, queues, cron jobs, payments, notification senders, data sync, and AI tools
  with side effects must have idempotency, deduplication, locking, or idempotency-key strategy.

## AI Engineering Rules

- AI features need quality verification beyond code tests when possible: golden fixtures,
  prompt regression suites, promptfoo, custom evals, benchmarks, or human review criteria.
- Tool-using agents must constrain tools, validate inputs, log meaningful traces, and avoid
  unbounded side effects.
- Track model choice, cost, latency, retries, rate limits, fallback behavior, and failure modes for
  production-like AI systems.
- Never send secrets, raw environment values, private keys, production credentials, or sensitive
  customer data to external models or generated docs.
- Use `$claude-opus-second-brain` as a read-only second brain for important plans, audits,
  architecture decisions, high-risk backend/AI work, difficult debugging, and meaningful diff
  review when cost and latency are justified.

## Code Review Checklist

- Does the change solve the stated goal without unrelated refactors?
- Are repo-local instructions and existing patterns respected?
- Are public interfaces, schemas, env var names, docs, and tests updated where behavior changed?
- Are failure modes explicit and observable enough for the risk level?
- Are retries, resumes, and partial failures safe for side-effecting flows?
- Are secrets and local-only artifacts excluded from files, logs, memory, reports, and commits?
- Are validation claims backed by commands actually run?

## Verification Standard

Use these labels exactly:

- `Verified`: a check was actually run and passed.
- `Static review only`: source/read-only review was performed without executing checks.
- `Not verified`: a check was skipped, blocked, unavailable, or not executable.

Choose checks proportional to scope:

- Small edits: targeted test, static review, or relevant script.
- Shared logic or user-facing behavior: unit/integration tests plus lint/type/build when available.
- Public API or database behavior: contract tests, migration dry-run/status, data validation, and
  rollback review.
- UI behavior: browser validation, console check, responsive layout check, and critical flow test.
- AI/data behavior: existing evals or a clearly stated quality-verification gap.

## Git And Delivery

- Read repo workflow before branch, commit, PR, rebase, push, or GitHub write.
- Identify base branch and working branch in team or production repos.
- Check `git status` and review diff before commit.
- Do not commit unrelated files, secrets, `.env`, generated junk, local caches, or tool state.
- Do not push unless explicitly requested or the current task already includes backup/publish work.
- Prefer local branch plus PR over direct writes to protected or shared branches.

## Final Report Standard

Keep final responses short but complete:

- What changed.
- What was verified, using exact labels.
- What was not verified and why.
- Any remaining risks or rollback notes.
- Exact Codex/Claude usage when available; never estimate missing token counts.
