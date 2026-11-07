---
name: twohearts-manage-github-flow
description: TwoHearts Git and GitHub workflow policy for branches, commits, issues, pull requests, issue approval, code review, merge preparation, branch protection, PR templates, and Conventional Commit titles. Use for any TwoHearts Git or GitHub read/write task after the mandatory root skill establishes repository scope and effective branch policy.
verified: 2026-08
---

# TwoHearts Manage GitHub Flow

Use this skill after `$twohearts-engineering-standards`. Verify the active repository's policy
status before enforcing product-repo branch rules.

## Workflow

1. Read repo instructions, contribution docs, project memory, and the approved issue/spec.
2. Inspect remotes, current/base branches, status, staged and unstaged changes, and existing PR
   or issue templates.
3. For product repos where the workflow is effective, cut feature work from fresh `dev`,
   reserve `main` for gated release promotion, and use no release branch. `dev` is where
   product PRs eventually land, but an agent never chooses a PR target itself: ask the user
   and get their explicit target-branch confirmation before creating any PR.
4. Validate branch naming against `<name>/<type>/<desc>` where that target is effective.
5. Build PR evidence: what/why, linked issue, approach and tradeoffs, scenario/test evidence,
   risk and rollback, docs, and UI screenshots when safe and relevant.
6. Check Standard or High-risk issue approval evidence before merge readiness.
7. Review implementation against the approved issue, tenant boundaries, and repo rules.
8. Post or recommend actionable findings only; track resolution before approval.

Read [references/github-controls.md](references/github-controls.md) for control details and
authority gates.

## Generic Skill Boundary

Use repository-native Git commands for mechanics, `$cx-code-review` for review passes, and
`$production-guard` before high-impact writes. Override generic main-based GitHub Flow, `develop` naming,
release branches, inferred intent, and generic commit-type lists when TwoHearts policy applies.

## Hard Stops

Require the user's exact written request before merge, protected-branch write, branch deletion,
release action, workflow trigger, or repository settings/ruleset change. Opening a pull request
is also gated: do not create any PR until the user has explicitly confirmed the target (base)
branch in the current conversation — never default to `dev` or `main`, and never treat a
general "create a PR" authorization as covering the target choice. Do not push automatically.
Do not commit unrelated files, secrets, environment files, or local artifacts.

## Output Contract

Report repository and policy status, base and target branches, issue/spec and approval state,
PR evidence completeness, actions performed, authority still required, and verification.
