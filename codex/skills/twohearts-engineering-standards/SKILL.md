---
name: twohearts-engineering-standards
description: Mandatory TwoHearts policy router and safety authority. Use first for every task inside D:/01_Workspaces/TwoHearts, any path containing 01_Workspaces/TwoHearts, any Twohearts-Technologies/* GitHub repository, or any repository whose instructions identify it as TwoHearts. Covers product, specs, docs, code, review, Git/GitHub, tenant/auth/payment/database/secrets, testing, QA, release, hotfix, and policy-skill maintenance, then routes only the applicable TwoHearts domain skills.
verified: 2026-08
---

# TwoHearts Engineering Standards

Use this skill first for every TwoHearts task. Keep it loaded as the policy authority while
domain skills and generic execution skills provide narrower workflows.

## First Moves

1. Read the nearest workspace and repo `AGENTS.md`.
2. Read `ProjectBrief.md`, `Architecture.md`, and `ACTIVE_STATE.md` when present and relevant.
3. Inspect existing source, docs, scripts, branches, and runtime controls before assuming a
   target policy is implemented.
4. Read [references/policy-core.md](references/policy-core.md) for mandatory invariants.
5. Read [references/policy-status.md](references/policy-status.md) to distinguish effective,
   target, transition, and open controls.
6. Read [references/open-decisions.md](references/open-decisions.md) whenever an unresolved
   rule could change the action.
7. Read [references/code-standards.md](references/code-standards.md) when writing, linting,
   structuring, or documenting code.
8. Classify the task domain and risk, then load only the applicable domain skills.

## Domain Routing

- Product intake, PRD, issue/spec, planning, scenarios, DoD, or docs impact:
  `$twohearts-specify-work`.
- Branch, commit, issue approval, PR, review, merge preparation, or GitHub settings:
  `$twohearts-manage-github-flow`.
- Tenant, auth, payments, database, migration, secrets, dependencies, workers, queues,
  webhooks, cron, public contracts, or other backend side effects:
  `$twohearts-protect-backend`.
- Tests, pre-PR checks, AI evaluation, red `dev`, QA evidence, or verification reporting:
  `$twohearts-verify-delivery`.
- `dev` to `main`, version, tag, release, deploy, hotfix, incident, or waiver:
  `$twohearts-control-release`.
- Writing or editing Markdown documentation (policy docs, explainers, guides, READMEs,
  project memory, `AGENTS.md`): `$twohearts-write-docs`.
- Policy source, handbook, control status, skill drift, or skill maintenance:
  `$twohearts-sync-policy`.

Load multiple domain skills when the task crosses domains. Do not load irrelevant skills only
because they are installed.

## Delivery Flow

Every TwoHearts feature or change follows the E2E delivery flow — spec-first, no stage
skipping: Input (need + context + authority) → Planning (spec + risk + scenarios + DoD) →
Implementation (code + docs + tests, same PR) → Verification (review + QA + gates) → Output →
production feedback becomes new regression scenarios. Completion reports state the delivery
level actually reached: `implementation-complete`, `PR-ready`, `merge-ready`,
`dev-integrated`, `release-ready`, or `released` — never a higher level than the evidence
supports. Full explainer:
`D:\02_Organizations\TwoHearts\Policies\Policies\8. TWOHEARTS_E2E_WORKFLOW_VI.md`.

## Risk And Authority Gate

- Treat auth, tenant data or behavior, payments, migrations, order lifecycle, customer-
  behavior-changing AI, production actions, and high-impact GitHub writes as High-risk.
- Stop on ambiguous tenant scope, permission boundary, environment, database target, release
  artifact, or production authority.
- Require the database confirmation and rollback protocol before a write that can affect
  existing data.
- Require an exact written request before merge, protected-branch write, branch deletion,
  release/tag, deploy, workflow trigger, settings change, incident closure, or secret access.
- Treat unresolved policy as `OPEN POLICY DECISION`; fail closed instead of choosing a rule.

## Precedence

Apply system safety first. Then apply this root policy, applicable TwoHearts domain skills,
stricter repo-local instructions and verified runtime facts, generic execution skills, tool
documentation, and inference. Repo-local reality may prove a target control is not implemented,
but it cannot relax tenant, secret, data, production, or verification safety.

## Generic Skill Boundary

Use generic skills only for mechanics after TwoHearts policy has selected the workflow. Generic
Git, test, migration, release, or quality defaults must not override TwoHearts branch strategy,
authority gates, risk tiers, tenant isolation, evidence requirements, or open decisions.

## Completion Contract

Report affected systems, policy status, domain skills used, commands actually run, exact
verification state, remaining risks, open decisions, and any skipped checks. Use `Verified`
only for checks that ran; otherwise use `Static review only` or `Not verified`.
