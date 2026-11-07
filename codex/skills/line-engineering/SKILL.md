---
name: line-engineering
description: Line's strict-production personal engineering standard and routing layer. Use for every meaningful non-TwoHearts repository, workspace, coding task, review, plan, audit, refactor, debug session, release-readiness check, backend/fullstack/AI/database/security/testing task, or project-standards update. Do not use for work under D:/01_Workspaces/TwoHearts, paths containing 01_Workspaces/TwoHearts or 01_Workspaces\TwoHearts, Twohearts-Technologies/* repositories, or repos whose docs identify them as TwoHearts; those must use twohearts-engineering-standards first.
---

# Line Engineering

Use this skill as Line's default operating policy for meaningful engineering work outside
TwoHearts. Treat repo-local instructions as authoritative when they are stricter or more
specific.

## Scope

1. Use this skill for all meaningful non-TwoHearts work: product code, backend, fullstack,
   AI systems, database work, debugging, refactoring, audits, docs, release readiness, and
   project standards.
2. Do not use this skill as the primary standard for anything under `D:\01_Workspaces\TwoHearts`,
   paths containing `01_Workspaces/TwoHearts` or `01_Workspaces\TwoHearts`,
   `Twohearts-Technologies/*`, or repos whose docs identify them as TwoHearts. Use
   `$twohearts-engineering-standards` first there.
3. If repo-local `AGENTS.md`, project docs, or user instructions conflict with this skill,
   follow the stricter and more specific rule.

## First Moves

1. Read repo instructions before edits: `AGENTS.md`, then `ProjectBrief.md`,
   `Architecture.md`, and `ACTIVE_STATE.md` when present.
2. Inspect existing structure, stack, package manager, scripts, tests, naming, and helper APIs.
   Detect; do not assume.
3. For meaningful code/review/planning work, read `references/engineering-standards.md`.
4. Use `$backend-ai-production-router` for backend, AI, database, security, quality, testing,
   release, or minimal UI internals.
5. Use `$claude-opus-second-brain` for important plans, audits, standards/docs, architecture
   decisions, high-risk implementation, difficult debugging, or final review when available.
6. If a `.codegraph/` index exists and the codebase is broad or unfamiliar, use CodeGraph for
   architecture discovery, then confirm risky details with `rg` and direct file reads.
7. Do not invent env vars, routes, API contracts, data models, queues, workers, package choices,
   deployment paths, or external integrations. Verify against source and docs.

## Strict-Production Defaults

- Prefer plan-first or phase-by-phase work for database, auth, permissions, payment, public API,
  deployment, release, GitHub write, secret, production, architecture, or broad-refactor changes.
- Proceed autonomously only for scoped local work that fits the global safe-autonomy boundary.
- Treat team, customer-facing, production-like, or unknown repos as PR-first until repo policy says
  otherwise.
- Keep changes surgical and reversible. State rollback or containment for high-risk changes.
- Require idempotency or deduplication for workers, queues, webhooks, cron jobs, payments,
  notifications, sync jobs, and AI tools with side effects.
- Never read, print, store, commit, or send secrets unless the user explicitly asks for the exact
  safe action and the task cannot proceed without it.

## Code And Project Standards

- Match the repo's existing stack, style, module boundaries, package manager, and test strategy.
- Prefer existing helpers and local patterns over new abstractions. Add abstractions only when they
  remove real complexity or match an established pattern.
- Keep public APIs, schemas, database contracts, config, and user-visible behavior documented when
  they change.
- When creating or substantially rewriting Markdown docs, use the TwoHearts-style document shape
  in `references/engineering-standards.md`: clear title, status/scope, gate/checklist sections,
  workflow or delivery rules, verification, risk/rollback, and backlog or next steps when useful.
- Justify new dependencies with fit, maintenance, security, size/runtime impact, and why existing
  code is insufficient.
- Avoid duplicate `new`/`enhanced` implementations, hidden TODOs, placeholders, debug logs,
  unrelated formatting churn, and broad opportunistic refactors.
- Update compact project memory after meaningful changes to product direction, architecture, APIs,
  data models, workflows, deployment, release state, or long-running task state.

## Verification

Before reporting completion:

1. Identify affected systems.
2. Run checks proportional to scope using repo-documented commands: lint, format check, typecheck,
   tests, build, migration dry-run/status, UI/browser validation, or AI/data evals.
3. For AI/data pipelines, run existing golden datasets, prompt regression suites, promptfoo, or
   custom evals when available.
4. Inspect diffs for secrets, accidental files, debug logs, dead code, scope creep, and generated
   junk.
5. Report only real evidence: `Verified` for checks actually run, `Static review only` for
   source/read-only review, and `Not verified` for skipped or blocked checks.
6. Include usage reporting when exact Codex or Claude usage is available; never estimate token
   counts.

## Output Discipline

Final reports should be concise and name the meaningful changes, validation performed, remaining
risks, and any unverified areas. For GitHub or production-facing work, include target repo/branch,
commit or PR when applicable, and rollback/containment notes.
