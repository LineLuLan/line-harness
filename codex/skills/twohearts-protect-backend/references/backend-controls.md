# Backend Controls

## Source Controls

- `TH-BE-001`: Tenant scope is explicit; request-scoped database helpers and RLS are preserved.
- `TH-BE-002`: Tenant behavior changes include cross-tenant regression coverage.
- `TH-BE-003`: Secret values are never read, exposed, copied, logged, committed, or sent to
  another model without exact safe authority and necessity.
- `TH-BE-004`: Schema and data changes are High-risk, use Drizzle only by default (raw SQL only
  when genuinely needed, e.g. SKIP LOCKED or CTEs), are staged/Neon-validated first,
  expand-contract, rollback-aware, reviewed, and subject to the real-database confirmation
  protocol; destructive changes require explicit approval.
- `TH-BE-005`: Auth, payment, permission, and public-contract ambiguity stops implementation.
- `TH-BE-006`: Retryable external side effects are idempotent or deterministically deduplicated
  (applied global safety principle; not yet an owner-approved TwoHearts hard gate).
- `TH-BE-007`: New dependencies include a PR justification (existing-library fit, maintenance,
  security, bundle/runtime cost, necessity); the review areas are policy guidelines.
- `TH-BE-008`: Env and secrets operations gates — `.env.example` stays maintained when env vars
  change; each secret class has a named owner and a documented rotation expectation; production
  secrets live in AWS Secrets Manager and staging secrets in Render env vars; a leaked secret
  is treated as compromised and rotation is proposed.

## Tenant Checklist

- Identify the tenant source and request lifecycle.
- Verify every query and transaction uses the request-scoped tenant mechanism.
- Confirm administrative or cross-tenant access is explicit, authorized, and separately tested.
- Test two tenants with overlapping identifiers and prove isolation in both directions.
- Treat any possible cross-tenant leak as a release blocker.

## Database Checklist

- Identify database, environment, tables or collections, rows, and expected impact.
- Require two separate written confirmations before a real write affecting existing data.
- Analyze loss, corruption, downtime, privacy, permission, and rollback risks.
- Require a verified backup and restore plan.
- Prefer read-only inspection, staging copies, dry runs, or transaction rollback first.
- Do not assume migration rollback is safe merely because code can be reverted.

## Side-Effect Checklist

Define the idempotency key, uniqueness boundary, retry behavior, timeout behavior, locking or
dedupe store, replay behavior, and observable failure state. Never point local tooling or tests
at real external providers without verified sandbox/test mode, and never use production
credentials locally.
