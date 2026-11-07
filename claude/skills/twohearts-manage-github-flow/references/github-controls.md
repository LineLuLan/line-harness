# GitHub Controls

## Source Controls

- `TH-GH-001`: Product feature work branches from fresh `dev` where that workflow is effective.
- `TH-GH-002`: Changes flow `feature -> dev -> main`; `main` changes through release gates.
  PR target selection is governed by `TH-GH-008` — never assumed by the agent.
- `TH-GH-003`: PR title or squash commit uses an allowed Conventional Commit type.
- `TH-GH-004`: PR evidence links the issue and covers tests, risk, rollback, docs, and relevant
  screenshots.
- `TH-GH-005`: Standard and High-risk issue approval exists before merge readiness.
- `TH-GH-006`: Review checks code against the approved issue and closes actionable findings.
- `TH-GH-007`: High-impact GitHub writes require exact written authority.
- `TH-GH-008`: An agent never creates a PR without the user's explicit confirmation of the
  target branch in the current conversation. `dev`/`main` are never assumed as targets; a
  general "create a PR" request does not cover the target choice.
- `TH-GH-009`: Merge gates — `dev` merges need PR + green CI + approval from one other dev;
  `main` merges need PR + CI + founder ([founder]) approval; squash merge only.
- `TH-GH-010`: No direct pushes and no force-pushes to `main` or `dev`; feature branches are
  short-lived and personal long-lived branches are banned.

## Product-Repo Flow

Use `feature -> dev -> main` only where the root skill's policy-status check says it applies.
Do not invent a `dev` branch for docs, evaluation, buildweek, or other repositories.

- No direct pushes and no force-pushes to `main` or `dev`.
- Cut branches from fresh `dev` (`git checkout dev && git pull && git checkout -b ...`).
- Branch name `<name>/<type>/<desc>`; **branch types are `feature`, `fix`, `chore`** (do not
  conflate with the ten PR-title commit types).
- Branches are short-lived: days, not weeks. Rebase on `dev` when stale; delete after merge.
  Never keep a personal long-lived branch (no `stable-vN` branches) — the answer is config, a
  flag, or smaller PRs.
- Merge strategy: squash merge only. `dev` = PR + green CI + one other dev's approval;
  `main` = PR + CI + founder ([founder]) approval, once per week through the release gates.

Allowed PR title types are `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`,
`build`, `ci`, and `perf` (commitlint on the PR title / squash commit). Local commit style is a
guideline; the PR title or squash subject is the gate. Do not add an AI `Co-Authored-By`
trailer.

## PR Conventions

- The shared PR template is required on all PRs. Fields: issue link (`Closes #N`, or
  `Part of #N` when more PRs follow), what/why, approach and tradeoffs, testing evidence,
  screenshots when UI changed, risk + rollback, docs-updated note, and a **spec-drift note**
  (if the work changed the issue-spec, update the issue first and link it; otherwise write
  "none").
- Behavior/API/config/contract/user-visible changes ship the matching doc update **in the same
  PR**.
- Request review only when the work is done, self-reviewed (no debug logs, scope creep, or
  dead code), and CI is green.
- Keep PRs small: target ~400 changed lines (guideline); several small PRs against one issue
  beat one giant PR.
- High-risk PRs: the author states which spec section the PR satisfies.

## Review Evidence

- Reviewers run the shared `pr-review` skill and post only findings that need action, plus how
  they were resolved. If the shared skill is unavailable, do not pretend it ran — perform the
  review, label it `Static review only`, and note the missing tool (its canonical source is an
  open decision).
- Confirm issue tier, behavior scenarios, out-of-scope, and Definition of Done. Standard DoD:
  scenarios pass in the harness, daily suite green on the branch, issue reflects what was
  built, second dev approved issue and PRs, lint/typecheck/build pass.
- Confirm the diff contains no unrelated changes, debug logs, dead code, secret material, or
  accidental churn.
- Prioritize cross-tenant, auth, payment, data, contract, and production risks above style.
- Do not infer missing intent from code for Standard or High-risk work.

## Authority

Read-only GitHub inspection is safe. Creating or mutating issues, comments, branches, commits,
PRs, labels, or reviews requires user intent for that write. Opening a PR additionally requires
the user's written confirmation of its target (base) branch — never assume `dev` or `main`.
Merge, branch deletion, protected branch writes, settings/rulesets, releases, and workflow
triggers require the exact action in writing.
