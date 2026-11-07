---
name: production-guard
description: Apply production safety gates for GitHub writes, deployments, releases, secrets, CI/CD, production incidents, protected branches, environment variables, and customer-impacting changes. Use before any action with production, repo, release, workflow, deployment, secret, or external-system side effects.
verified: 2026-08
---

# Production Guard

Use this skill before any action that may affect production runtime, repository history, CI/CD, releases, packages, secrets, customers, or external systems.

## Default Posture

- Analyze first.
- Prefer read-only inspection.
- Prefer local branch + PR over direct writes.
- Treat production-impacting actions as blocked until confirmation.
- Never claim verification unless the check was actually run.

## GitHub Write Guard

Before using GitHub MCP or `gh` for write operations:

1. Identify target owner/repo.
2. Identify base branch, working branch, issue number, PR number, release, workflow, or file path.
3. State the exact write action.
4. Explain reversibility and rollback.
5. Ask for explicit confirmation when the write is high impact.

High-impact GitHub actions require exact user request:

- Merge PR.
- Close issue/incident.
- Delete branch/tag/release.
- Edit protected branch or repository settings.
- Trigger production workflow.
- Publish release/package.
- Push or write directly to protected branch.

## Deployment Guard

Before production deploy/release:

1. Target environment.
2. Branch/commit SHA.
3. Artifact or workflow name.
4. CI/test status.
5. Expected user impact.
6. Rollback path.
7. Stop condition.
8. Explicit written confirmation.

If CI, tests, or rollback are unknown, say so and stop before production action.

## Secrets Guard

Never print or persist secret values.

Protected by default:

- `.env`
- `.env.*`
- private keys
- SSH keys
- cloud credentials
- production tokens
- package registry tokens
- database credentials
- OAuth client secrets
- webhook signing secrets

Prefer checking variable names and presence, not values.

If a secret was exposed in chat, logs, git, issue/PR, or generated files:

1. Treat it as compromised.
2. Recommend rotation.
3. Remove it from files/history where possible.
4. Replace with env var references.

## Production Repo Onboarding

For a production repo without clear local policy, establish or ask for:

- Branching policy.
- Base branch and working branch.
- PR approval policy.
- Test/build commands.
- Deployment environments.
- Required CI checks.
- Database access policy.
- Secret handling policy.
- Rollback runbook.

Use `ProjectBrief.md`, `Architecture.md`, and `ACTIVE_STATE.md` when present. If missing in a serious repo, propose lightweight versions before large changes.

## Pair With

- `team-router` for bank skill routing.
- `cx-verify` for post-edit verification.
- `twohearts-protect-backend` for TwoHearts auth, permissions, and public API risk.
- `drizzle-kit` and `postgresql` for database change planning and local validation.
- `pre-mortem` for high-risk failure analysis.
