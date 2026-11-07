# TwoHearts Policy Status

## Status Meanings

- **Effective**: approved and applicable now, subject to verified repo-local implementation.
- **Target**: intended standard that must not be described as already enforced.
- **Transition**: approved direction with rollout still in progress.
- **Open**: owner decision or implementation fact is missing; fail closed when material.

## Authority Status

| Source | Status | Use |
| --- | --- | --- |
| Collaboration & Contribution Policy, approved 2026-07-28 | Effective for backend | Workflow authority |
| Branching, testing, issue/spec, product, and QA guides | Domain guidance | Apply within approved scope |
| Engineering Standards, dated 2026-06-24 | Target / pre-implementation | Verify per repo before claiming enforcement |
| Vietnamese policy handbook | Explanation | Use for navigation and open-question tracking |
| Codex skill proposal | Design only | Never treat as policy authority |

## Repository Scope

- `twohearts-delivery-backend`: apply approved collaboration workflow now; verify each target
  engineering control against repo reality.
- `twohearts-delivery-dashboard`, `twohearts-mission-control-dashboard`, and
  `twohearts-whitelable-website`: treat collaboration rollout as transition until repo evidence
  or owner confirmation establishes effective status.
- `ai-foundary`, `ai-evals`, legacy build-week repositories, and other TwoHearts repositories:
  apply root safety and verified repo-local workflow. Do not impose product-repo `dev/main`
  rules without applicable policy or repo evidence.

## Runtime Checks

Before using branch, toolchain, CI, test, release, or deployment rules:

1. Inspect repo `AGENTS.md`, contribution docs, scripts, branches, and CI configuration.
2. Record whether the relevant control is effective, target, absent, or contradictory.
3. Follow the stricter safe rule while surfacing drift.
4. Do not create missing branches, checks, labels, rulesets, or automation unless requested.

`pnpm`, Node 22, shared Prettier, commit hooks, CI checks, branch protection, and shared
templates are target controls unless verified in the active repo.
