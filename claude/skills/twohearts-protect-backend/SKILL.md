---
name: twohearts-protect-backend
description: TwoHearts backend production-safety policy for tenant-scoped routes and data, auth and permissions, payments, database migrations and backfills, env and secrets, public contracts, dependencies, queues, workers, webhooks, cron, retries, and external side effects. Use for any TwoHearts backend or high-risk infrastructure change after the mandatory root skill.
verified: 2026-08
---

# TwoHearts Protect Backend

Use this skill after `$twohearts-engineering-standards`. Treat ambiguous tenant, permission,
data, environment, or side-effect scope as a stop event.

## Workflow

1. Identify environment, tenant boundary, data stores, public contracts, external systems, and
   retryable side effects.
2. Inspect existing request-scoped database helpers, RLS, schemas, migrations, integration
   adapters, idempotency patterns, and tests.
3. Require tenant routes to use `req.withTenantDb()` or `req.withTenantTx()` where those are
   the verified repo helpers.
4. Plan cross-tenant regression and adversarial authorization tests.
5. For schema or data work, use Drizzle only by default (raw SQL only when genuinely needed),
   expand-contract, staging or Neon validation first, an explicit backup, restore, rollout, and
   rollback plan, and explicit approval for destructive changes.
6. For queues, workers, webhooks, cron, payment, notifications, and sync, require idempotency,
   deduplication, locking, or an equivalent invariant.
7. Justify dependencies using existing-library fit, maintenance, security, update cadence,
   bundle/runtime cost, and why a local helper is insufficient.

Read [references/backend-controls.md](references/backend-controls.md) for the control set.

## Secret And Database Boundary

Never read or expose `.env`, credentials, private keys, tokens, or secret stores without an
exact safe request and necessity. Never use production credentials locally. Keep
`.env.example` updated whenever env vars change. Before a real database operation that can
affect existing data, apply the global two-confirmation, impact, backup, restore, dry-run, and
rollback gate.

## Generic Skill Boundary

Use production, migration, ORM, database, security, dependency, env, webhook, queue, and
idempotency skills only for mechanics. They cannot relax TwoHearts tenant or authority gates.

## Output Contract

Report risk class, environment, tenant/data/contract impact, failure modes, safety and rollback
plan, adversarial tests, dependency evidence, idempotency design, and explicit authority still
required.
