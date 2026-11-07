---
name: twohearts-verify-delivery
description: TwoHearts verification policy for scenario-to-test traceability, repository-native lint, typecheck, test and build checks, tenant isolation, AI behavior and prompt evaluations, daily red-dev classification, QA scripts, sign-off evidence, and release-readiness inputs. Use for test planning, execution, pre-PR verification, AI evals, QA evidence, or verification reporting.
verified: 2026-08
---

# TwoHearts Verify Delivery

Use this skill after `$twohearts-engineering-standards`. Select checks from repository evidence,
not generic package-manager or coverage assumptions.

## Workflow

1. Map each approved issue scenario to automated checks, review evidence, and QA steps.
2. Inspect repo scripts, CI, test layout, eval harnesses, and environment requirements.
3. Enforce the per-PR gate: unit tests, integration tests, and the scripted AI flows all green
   to merge; the promptfoo check is required when prompt or model files change. Locally:
   `pnpm typecheck && pnpm lint && pnpm test`.
4. Add tenant-isolation evidence whenever tenant-scoped behavior changes.
5. Separate deterministic assertions from scored AI evaluation — assert on effects (order
   created, tool called), never exact AI wording — and record scenario, model, judge, prompt,
   and rubric versions where available. Critical flows (order, payment, consent) have zero
   tolerance: one failure blocks.
6. Classify red `dev` as internal, external/blocked, or unresolved. Internal freezes `dev`
   (only fixes or reverts merge; whoever broke it fixes it; after 1 hour unknown, revert the
   suspect merge). Never silently disable a test; attach owner and expiry to external blocks.
7. Draft the QA sprint-delta script from the sprint issues (the feature's dev approves it
   before handoff). The standing regression script is fixed policy content, not AI-drafted.
   Require human QA evidence and sign-off.
8. Report exact commands and results using the verification vocabulary below.

Read [references/verification-controls.md](references/verification-controls.md) for the five
test layers, PR gates, AI judging, and red-dev rules. Read
[references/qa-playbook.md](references/qa-playbook.md) for QA scope, the weekly pass, bug
filing, and sign-off.

## Verification Vocabulary

- `Verified`: the named command or check actually ran and its result is known.
- `Static review only`: source or configuration was inspected without executing the check.
- `Not verified`: the check was skipped, blocked, unavailable, or not executable.

## Generic Skill Boundary

Use test, verification, promptfoo, UI, Playwright, and browser skills for mechanics. Do not
invent an 80% threshold, package manager, AI threshold, or release-ready conclusion. Do not
auto-fix unrelated formatting.

## QA Boundary

Codex may draft scripts, evidence matrices, bug templates, and sign-off skeletons. Codex may
not sign off for QA, convert blocked to pass, run production smoke without an exact request, or
capture unsafe PII in screenshots and identifiers.
