# Documentation Standards

## Source Controls

- `TH-DOC-001`: Every document opens with a header that states its type (policy, explainer,
  or guide), audience, owner, status, and parent policy. An explainer states that the
  numbered policy docs win on conflict.
- `TH-DOC-002`: Behavior, API, config, contract, or user-visible changes ship their matching
  doc update in the same PR; env-var changes update `.env.example` in the same PR.
- `TH-DOC-003`: Documentation follows the plain-language rules in `writing-style.md`; a
  reader outside the engineering team can follow it without asking for missing context.
- `TH-DOC-004`: Documentation pushed to the shared GitHub goes through a PR with a
  `docs(scope):` Conventional Commit title, the shared PR template, a user-confirmed target
  branch, and review per GitHub flow — never a direct push to `main` or `dev`.
- `TH-DOC-005`: Durable decisions live in durable documents; a PR description, chat message,
  or commit message is never the only record of an architecture or policy decision.
- `TH-DOC-006`: Docs match code. Every route, field, command, env var, or path stated in a
  doc is verified against the code at writing time and cites its source file; the doc
  records what it was `verified_against`; unchecked claims are marked `Not verified`; when
  doc and code disagree, the code is the fact and the doc is fixed.
- `TH-DOC-007`: The target repo's own documentation system — discovered from its `AGENTS.md`
  and docs index, catalogued in `repo-doc-systems.md` — takes precedence over every generic
  convention in this skill; generic templates apply only where the repo defines nothing.
  Standards apply forward-only: never mass-rewrite existing docs; off-standard legacy docs
  are reported as drift, not fixed.

## Document Types And Required Elements

### Numbered policy doc (`D:\02_Organizations\TwoHearts\Policies\Policies\N. Title`)

Owner-only. Required: number + title matching the folder convention; header with Status,
Owner, Audience, Scope, Parent policy; rules marked **GATE** (blocks merge/commit) or
**Guideline** (reviewed, not blocking); who approves exceptions. Do not create or renumber
one without the owner's explicit request.

### Explainer (like the Policy Handbook or the E2E workflow doc)

Required: a header block that says it is an explainer, names its sources, and states that
the numbered docs win on conflict. It quotes or restates policy — it never invents rules.
If a rule is not in a source doc, the explainer marks it as open or omits it.

### Dev guide / how-to

Required: audience line; goal in one sentence; numbered steps with one action per step;
what "done" looks like; what to do when a step fails; links to the parent policy. Warnings
go **before** the step they protect, not after.

### README (per repo)

Required: what the repo is and which product surface it serves; how to run it locally
(exact commands); how to run the tests; where the docs live; links to the repo `AGENTS.md`
and parent policies. No secrets, no credentials, no internal tokens — use placeholder names
and point to the approved secrets mechanism.

### Project memory (`ProjectBrief.md`, `Architecture.md`, `ACTIVE_STATE.md`)

- `ProjectBrief.md`: product scope, users, success criteria, stack, constraints, non-goals.
- `Architecture.md`: system design, data models, module boundaries, services, deployment,
  durable decisions (each with the why).
- `ACTIVE_STATE.md`: current roadmap, task board, validation log, blockers, next steps,
  handoff notes. Keep dense and pruned; convert relative dates to absolute.

### Feature doc — ground truth per feature

The canonical page a future session or a new dev reads to own a feature. Required: AI
Foundry frontmatter with `verified_against`; behavior as observable statements; entry-point
code references; contracts with source files; data + tenant scoping; scenario→test mapping;
edge cases; out-of-scope; decision history; local verify commands. Full template:
[feature-doc-template.md](feature-doc-template.md). It lives in the feature's repo (near the
code) so the docs-same-PR gate keeps it current; it is updated in the same PR as any
behavior change (`TH-DOC-002`, `TH-DOC-006`).

### Knowledge repo (`ai-foundary`)

Cross-repo knowledge lives in `D:\01_Workspaces\TwoHearts\ai-foundary` per its own
`STYLEGUIDE.md` and `CONTRIBUTING.md`: stable docs under `docs/` in Diátaxis buckets,
decisions under `decisions/` (accepted/rejected/superseded ADRs), drafts in `workbench/`,
retired material in `archive/` with an archive note. New documents start from the nearest
file in `templates/`. That repo's conventions win inside that repo.

### Repo `AGENTS.md`

One self-contained file per repo (no central master file, no CLAUDE.md). It carries the
shared standards block plus repo-specific rules, and is hand-synced across repos when a
shared rule changes — note the sync in the PR.

## GitHub Gates For Doc Changes

Before a documentation change reaches the shared GitHub, all of these hold:

1. The change is on a branch named `<name>/<type>/<desc>` — for docs-only work the branch
   type is `chore` (or the change rides the feature/fix branch it documents).
2. **The user has confirmed the PR target branch in the current conversation.** Never assume
   `dev` or `main`, and never invent a `dev` branch for docs-only repositories.
3. The PR title is a Conventional Commit with the `docs` type, e.g.
   `docs(policy): add E2E workflow explainer`.
4. The shared PR template is filled: what/why, linked issue, testing or review evidence
   (for docs: which sources were checked), risk + rollback, docs-updated note, spec-drift
   note.
5. No direct pushes and no force-pushes to `main` or `dev`; the PR needs green CI and one
   approval like any other PR.
6. The diff contains only the intended docs (no unrelated files, no secrets, no PII, no
   generated junk).
7. A doc that explains a policy links to that policy; a doc that a policy depends on is
   updated in the same PR as the policy change.
