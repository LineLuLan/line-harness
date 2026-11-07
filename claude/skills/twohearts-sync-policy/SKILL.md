---
name: twohearts-sync-policy
description: Read-only TwoHearts policy and skill drift auditing for canonical DOCX sources, the Vietnamese handbook, policy hashes, control coverage, stale references, effective-versus-target status, open decisions, and agents/openai.yaml consistency. Use when policy files or TwoHearts skills change, when auditing repository enforcement, or when checking whether the installed suite still matches policy.
verified: 2026-08
---

# TwoHearts Sync Policy

Use this skill after `$twohearts-engineering-standards`. Audit only; never rewrite policy,
skills, GitHub settings, or internal Codex memory automatically.

## Workflow

1. Confirm the canonical policy directory and canonical Codex skills directory.
2. Run `scripts/inventory_policies.py` to produce a current read-only inventory.
3. Run `scripts/check_policy_hashes.py` against
   `references/policy-manifest.json`.
4. Run `scripts/check_skill_coverage.py` against
   `references/control-coverage.json`.
5. Validate each TwoHearts skill's structure directly: frontmatter has only `name` and
   `description`, and every `references/` file linked from `SKILL.md` exists.
6. Compare `agents/openai.yaml` names, prompts, and implicit-invocation policy with `SKILL.md`.
7. Review status and open-decision references when a source changed.
8. Report changed policies, affected skills, missing controls, stale status, open decisions,
   and a regeneration checklist.

Read [references/sync-controls.md](references/sync-controls.md) for audit interpretation.

## Script Contract

- `inventory_policies.py`: print JSON inventory; exit `0` or `2` for configuration/input error.
- `check_policy_hashes.py`: exit `0` for no drift, `1` for drift, `2` for configuration/input
  error.
- `check_skill_coverage.py`: exit `0` for complete coverage, `1` for missing coverage, `2` for
  configuration/input error.

All scripts use only the Python standard library, print to stdout, and do not update baselines.

## Authority Boundary

Do not edit policy authority, install or publish a skill update, change a repository, alter
GitHub settings, read secrets, or modify Codex SQLite memory. A detected change starts a
review; it does not authorize synchronization.
