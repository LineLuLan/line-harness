# Release Controls

## Source Controls

- `TH-REL-001`: Weekly automated, applicable AI, and QA gates are all green before promotion.
- `TH-REL-002`: A red gate is fixed or has a written waiver from [founder] (see Waivers below).
- `TH-REL-003`: Production promotion follows verified `dev -> main -> tag -> production` policy;
  production and demos deploy from a tagged `main` release only, never from a branch.
- `TH-REL-004`: Release identity includes environment, branch, SHA, artifact, version, tag, and
  rollback point.
- `TH-REL-005`: Hotfixes originate from production `main`, have one reviewer and targeted-test
  evidence, and merge back to `dev` the same day — that step is mandatory.
- `TH-REL-006`: High-impact release actions require exact written authority.
- `TH-REL-007`: Open release topology blocks execution instead of selecting a generic default.
- `TH-REL-008`: Versioning is SemVer per repo; the bump is computed from Conventional Commit
  squash commits since the last tag, never hand-picked; every `dev -> main` merge gets a
  `vX.Y.Z` tag and a changelog entry.
- `TH-REL-009`: Incident bypasses are documented after the incident with founder notification —
  never silent.

## Three Gates (weekly dev → main)

1. Weekly automated suite green.
2. The 400 AI conversation scenarios meet their thresholds (owner-defined; do not invent them).
3. Authorized weekly QA pass signed off — QA runs 1-2 days before the release.

Do not substitute CI green for customer-behavior evidence. Do not treat `blocked` as pass. A ❌
on a core QA flow blocks the release, same as a red test suite.

## Waivers

Any gate red → fix it, or get a **one-line written waiver from [founder]**. For a failed QA flow
the written line is: reason + expiry + linked issue. Only [founder] may waive a failed gate. Do
not demand fields beyond the written policy — a richer waiver schema is not settled policy.

## Versioning And Releases (per Engineering Standards §18)

- Each repo uses independent SemVer (MAJOR.MINOR.PATCH), starting at 1.0.0 at go-live. No
  single platform version, no perpetual 0.x.
- **Bump derivation (GATE):** compute from Conventional Commit squash commits since the last
  tag, never hand-pick. `!` or a `BREAKING CHANGE` footer = MAJOR; otherwise `feat` = MINOR;
  everything else = PATCH.
- **Release tag (GATE):** every `dev -> main` merge is a release. Tag `vX.Y.Z` on the squash
  commit on `main`; enforce manually until release automation lands.
- **Changelog (GATE):** maintain a per-repo `CHANGELOG.md` in Keep a Changelog format for every
  release; generate release notes from squash commits since the last tag.
- Breaking change is defined by the contract each repo owns: backend = API routes,
  request/response shapes, webhook contracts, anything consumed by the frontends or tenant
  integrations; frontends = user-facing behavior contracts (expect mostly MINOR/PATCH).
- Guideline: the backend exposes its current version in the health endpoint and startup logs.

## Incident Bypass (per Engineering Standards §16)

Hotfixes and production incidents may bypass gates when the process itself would increase
customer or production risk. The founder is notified, and the bypass is documented **after**
the incident with the missing checks, the risk accepted, and any required follow-up. This
escape hatch is intentional; what is forbidden is a *silent* exception, not the documented
bypass.

## Open Release Decisions

- Whether a hotfix release gets its own tag/changelog entry (the hotfix execution path itself
  is settled: cut from `main`, one reviewer, targeted tests, deploy, merge back to `dev` the
  same day).
- Exact AI thresholds, judge protocol, and stability definition.
- Whether a `blocked` (external-outage) core QA flow blocks release (a ❌ failure definitely
  blocks).
- Exact required GitHub checks and rulesets.

Stop before any action that depends on these decisions and read the root
`references/open-decisions.md`.
