# Repo Documentation Systems (surveyed 2026-07-31)

The target repo's own system is the law. This registry records what each TwoHearts repo
actually uses so the skill enforces the right rules. If reality on disk differs from this
registry, reality wins — and report the drift.

## twohearts-delivery-backend — SSOT system

Authority chain inside the repo: repo `AGENTS.md` §1–§3 (doc-first rule, placement table,
mandatory update matrix) → `docs/INDEX.md` (router + SSOT template + generation process) →
`docs/contracts/AGENTS.md` (contract docs).

- **Module ground truth**: `src/modules/<mod>/docs/SPEC.md` — one SSOT per module. Follow the
  SSOT template in `docs/INDEX.md` exactly: Identity table → Purpose → Non-Goals → Data Model
  → API Surface → Business Rules → External Integrations → Security → Key Files →
  Cross-References → optional Known Gaps.
- **SSOT generation rules** (from INDEX): code is ground truth for facts; **no phase history**
  (document current state, not how we got here); old SPEC content is replaced, not appended;
  one module per session.
- **Mandatory update matrix** (repo AGENTS.md §3) runs as a checklist: route change →
  `docs/api/CONTRACTS.md` + `docs/access/ACCESS_MATRIX.md` + module SPEC + OpenAPI path file;
  table/column → tenant-isolation + `docs/data/DATA_MODEL.md` + SPEC; status value →
  `docs/workflows/<relevant>.md` + SPEC; env var → `docs/config/CONFIG_ENV_MATRIX.md`;
  external integration → `docs/integrations/EXTERNAL_INTEGRATIONS.md` + SPEC. If a target
  file does not exist, report it as drift — do not invent it unrequested.
- **Contract-first** for third-party APIs per `docs/contracts/AGENTS.md`: code changes an
  external call → update the contract FIRST; contract is source of truth, code must match.
- **Naming**: `SCREAMING_SNAKE_CASE.md` for cross-cutting docs; fixed filenames `SPEC.md`,
  `CONTRACT.md`. **No YAML frontmatter** — do not add it.
- **Forward-only staleness additions** (user-approved 2026-07-31; applies when CREATING or
  EDITING a SPEC from now on — never retrofitted in bulk):
  - Add `| Last verified | <YYYY-MM-DD> @ <short commit SHA> |` as the last row of the
    Identity table; update it on every SPEC edit.
  - Add a `## Verification` section after Business Rules: a `| Business Rule | Test |` table
    mapping each rule to the test file/command that proves it; rules without a test are
    marked `Not verified`.

## ai-foundary — Markdown knowledge repo

Follow the repo's own `STYLEGUIDE.md`, `CONTRIBUTING.md`, and `AGENTS.md`: YAML frontmatter
(title, file_type, status, owner, created_at, updated_at, reviewers, tags, related);
kebab-case English filenames; Diátaxis placement under `docs/` (00-start-here / 10-tutorials /
20-how-to / 30-reference / 40-explanations / 50-runbooks); decisions as ADRs under
`decisions/` (accepted/rejected/superseded); drafts in `workbench/`; retired material in
`archive/` with an archive note; new documents start from the nearest file in `templates/`.

## Quartet Repositories

Project memory lives in root `ProjectBrief.md` / `Architecture.md` / `ACTIVE_STATE.md`
(create per global policy when meaningful multi-session work starts). No SSOT or Diátaxis
system; keep docs minimal and current. whitelabel-website also carries strict repo-local
branch rules in its `AGENTS.md` that always win.

## Unknown / new repos — generic fallback

Only when a repo has no documentation system of its own: use the generic document types in
`doc-standards.md` and `feature-doc-template.md`, with the plain-language style rules. The
first meaningful docs task in such a repo should propose (not impose) a lightweight system.

## Anti-mass-rewrite rule (all repos)

Standards apply forward: to documents being created now, or documents the task explicitly
targets. Encountering legacy docs that violate the repo standard (dead links, empty/stub
SPECs, phase-history content, wrong naming) is a **drift report item**, never a license to
rewrite. Bulk documentation rewrites require the owner's explicit request.
