---
name: twohearts-skills-policy-alignment
description: "2026-07-31 full realignment of the 7 TwoHearts skills to the policy set in D:\\02_Organizations\\TwoHearts\\Policies\\Policies — key gates restored, invented rules removed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T14:32:25.085Z
---

On 2026-07-31 a 2-agent audit compared all 9 policy docs (~125KB: handbook, skills proposal,
7 DOCX guides) against the 7 TwoHearts skills and found the ~24KB skill compression had dropped
or distorted many written gates. All fixes applied same day, verified by the suite's own
`check_skill_coverage.py` (56 controls, 0 failures). Highlights of what was restored:

- verify-delivery: real five test layers (staging-harness E2E, scripted-LLM, live-model sims
  50/400, promptfoo required check, production feedback); per-PR gate (unit+integration+
  scripted AI green); critical flows (order/payment/consent) zero tolerance; red dev = frozen,
  1-hour unknown → revert; new `references/qa-playbook.md` with full doc-7 QA content.
- manage-github-flow: TH-GH-009 (dev = PR+CI+1 dev approve; main = PR+CI+founder [founder];
  squash only), TH-GH-010 (no direct/force-push to main or dev; branch lifecycle; stable-vN
  ban); full PR template fields + spec-drift + Closes #N; review-timing gate.
- control-release: SemVer settled per Engineering Standards §18 (bump from squash commits;
  tag vX.Y.Z + Keep-a-Changelog per dev→main merge; TH-REL-008); incident bypass path per §16
  (documented after, founder notified; TH-REL-009); waiver corrected to one-line [founder] waiver
  (QA: reason+expiry+linked issue) — 8-field schema removed as unsourced.
- specify-work: doc-5 intake (weekly sprints, PRD by a human dev, 6-field story template,
  midweek default → next sprint; TH-SPEC-007).
- engineering-standards: new `references/code-standards.md` (lint ERROR/WARN tiers +
  suppression discipline, naming/layout, TSDoc/TODO-links-issue/BLEND, docs-same-PR);
  open-decisions list corrected (SemVer removed as settled, Mission Control QA scope settled).
- protect-backend: secrets ops gates (TH-BE-008: .env.example, secret owner, rotation, AWS SM
  prod/Render staging); Drizzle-only-by-default + destructive-approval; "Joi data lab" line
  removed (unsourced); idempotency annotated as global principle, not owner-approved TH gate.

Deliberately NOT policy-derived but kept: TH-GH-008 PR-target-confirmation (user directive, see
[[twohearts-pr-target-rule]]), TH-SPEC-008 issue granularity (user directive 2026-07-31: group
related small feats into one umbrella issue per module/sprint theme, items as checklists, PRs
`Part of #N`; High-risk NEVER batched), and the global two-confirmation DB protocol (AGENTS.md §5).

Also added same day (user request): an 8th skill `twohearts-write-docs` (TH-DOC-001..007) —
**repo-adaptive**: the target repo's own doc system is the law (backend = SSOT SPEC.md per
module + AGENTS.md §3 update matrix + contract-first + SCREAMING_SNAKE, catalogued in
`references/repo-doc-systems.md`); generic template + ASD-STE100 style are fallback only.
Forward-only staleness rule for backend SPECs (Last verified row + Verification section) is
encoded in the SKILL, not in the repo's INDEX. Suite now checks 64 controls (incl.
TH-CORE-009: every task follows the E2E flow and reports its delivery level). The E2E
explainer lives at `D:\02_Organizations\TwoHearts\Policies\Policies\8. TWOHEARTS_E2E_WORKFLOW_VI.md`.

Workspace enforcement (2026-07-31): `D:\01_Workspaces\TwoHearts\AGENTS.md` mandates skill +
E2E + write-docs routing; new `CLAUDE.md` there imports it so Claude Code auto-loads up-tree;
TwoHearts Charter block present in ALL 7 repo AGENTS.md (backend/ai-foundary edited;
whitelabel edited but its AGENTS.md is deliberately gitignored = local-only; kfc-buildweek
extended; ai-evals + both dashboards created new). All local working-tree only — NOT
committed; commits/PRs need user-confirmed targets per TH-GH-008.

Backend docs drift backlog (found in audit, deliberately NOT fixed — see
[[no-mass-doc-rewrites]]): docs/INDEX.md has ~6 dead links (docs/tenancy→docs/infra/tenancy,
invoice path, ipos moved to provider/major/ipos, docs/reference/ipos and kfc/MODULE_PLAN.md
missing); `docs/api/CONTRACTS.md` does not exist though AGENTS.md §3 mandates updating it;
stats + storefront SPEC.md are 0-byte; provider/major/cukcuk SPEC is a 331B stub; docs-old/
(88 files) tracked with no superseded warning; KFC has 2 parallel SPECs; `.local-docs/`
excluded only via machine-local .git/info/exclude.
