---
name: twohearts-control-release
description: Fail-closed TwoHearts release and production policy for weekly dev-to-main promotion, automated and AI gates, QA sign-off, SemVer, tags, changelogs, deploys, hotfixes, production incidents, waivers, rollback, and release readiness. Use whenever a TwoHearts task could merge main, tag, release, deploy, trigger production workflows, handle a hotfix, or close an incident.
verified: 2026-08
---

# TwoHearts Control Release

Use this skill after `$twohearts-engineering-standards`. Treat every release or production
action as high impact and fail closed on unresolved policy.

## Readiness Workflow

1. Verify repository scope and that the product-repo release policy is effective.
2. Identify exact environment, source branch, target branch, commit SHA, artifact, version,
   tag, deployment target, and rollback point.
3. Collect all three gates: weekly automated suite, applicable AI scenario evidence, and
   authorized weekly QA sign-off.
4. Confirm any red gate is fixed or has a written [founder] waiver (one written line; for QA
   failures: reason + expiry + linked issue). Never accept a silent exception; a documented
   incident bypass per the exception policy is not a silent exception.
5. Verify production and demos deploy from a tagged `main` release where that policy applies.
6. Confirm authority for each merge, tag, release, deploy, workflow, incident, or deletion
   action separately.
7. Stop before topology decisions that remain open.

Read [references/release-controls.md](references/release-controls.md) before assessing or
executing release work.

## Hotfix And Incident Boundary

Hotfix path (settled policy): cut an emergency branch from production `main`, one reviewer
approves, run the targeted tests, deploy, and merge the fix back to `dev` the same day — that
last step is mandatory. Incidents may bypass gates when process itself would increase risk;
notify the founder and document the bypass afterward. SemVer, tags, and changelog follow
Engineering Standards §18 (see references); only the hotfix tag/changelog treatment remains
open.

## Hard Stops

Require an exact written request before merging `main`, creating or editing a tag/release,
deploying, triggering a workflow, closing a production incident, deleting a branch, or changing
release settings. Missing environment, SHA, artifact, test evidence, rollback, authority, or an
applicable open decision blocks execution.

## Output Contract

Return gate status, environment and artifact identity, authority checklist, waiver evidence,
rollback and stop conditions, open decisions, actions performed, and actions still blocked.
