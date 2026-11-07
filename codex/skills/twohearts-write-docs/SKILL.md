---
name: twohearts-write-docs
description: TwoHearts documentation-writing policy for policy docs, explainers, guides, READMEs, module SPECs, project memory, and AGENTS.md files. Repo-adaptive - the target repository's own documentation system (discovered from its AGENTS.md and docs INDEX) is the law; generic templates apply only where the repo defines nothing. Defines required elements per document type, the plain-language writing style (ASD-STE100-inspired), the docs-match-code rules, and the gates a documentation change must satisfy before it is pushed or PR'd to the shared GitHub. Use for any TwoHearts task that creates or edits Markdown documentation.
verified: 2026-08
---

# TwoHearts Write Docs

Use this skill after `$twohearts-engineering-standards`. It governs how documentation is
written and shipped; `$twohearts-manage-github-flow` still governs the Git/GitHub mechanics.

## Workflow

1. **Discover the target repo's own documentation system first**: read the repo `AGENTS.md`
   and its docs index (e.g. `docs/INDEX.md`). If the repo has its own system, **that system is
   the law** — its templates, naming, placement, and update matrix override every generic
   convention in this skill. Known systems are catalogued in
   [references/repo-doc-systems.md](references/repo-doc-systems.md).
2. Identify the document type and its required elements — read
   [references/doc-standards.md](references/doc-standards.md). Generic types and the
   [references/feature-doc-template.md](references/feature-doc-template.md) apply ONLY when
   the repo defines no convention of its own.
3. Confirm authority: only the owner creates or changes a numbered policy doc. An explainer
   never overrides policy; when they conflict, the numbered docs win and the explainer says so
   in its header.
4. Write in plain language following
   [references/writing-style.md](references/writing-style.md): short sentences, one
   instruction per step, one meaning per term, defined jargon, active voice.
5. Check code truth: every route, field, command, env var, and path stated in the doc was read
   from the code now, cites its source, and the doc records what it was verified against.
   When doc and code disagree, the code is the fact.
6. **Forward-only scope**: apply these rules to documents you are creating now or that the
   task explicitly asks you to edit. NEVER mass-rewrite existing documentation to match a
   standard. Off-standard legacy docs, dead links, or empty specs you encounter are reported
   as a drift log in your output — not fixed.
7. If the doc change rides with a code change, it ships in the same PR (docs-same-PR gate);
   env-var changes update `.env.example` too.
8. Before pushing or opening a PR, satisfy the GitHub gates in
   [references/doc-standards.md](references/doc-standards.md) — including the user-confirmed
   target branch, `docs(scope):` PR title, and the shared PR template.

## Hard Stops

Do not create, renumber, or rewrite a numbered policy doc without the owner's explicit
request. Do not mass-rewrite or "clean up" existing docs beyond the task's scope. Do not push
documentation directly to `main` or `dev`. Do not open a PR without the user confirming the
target branch in the current conversation. Never put secrets, tokens, customer PII, or
internal URLs with credentials into documentation.

## Generic Skill Boundary

Generic writing or documentation skills may help with mechanics, but they must not override
the target repo's documentation system, the TwoHearts document-type requirements, the
plain-language rules, or the GitHub gates.

## Output Contract

Report the target repo's doc system used, the document type, its required elements and
whether each is present, the code-truth check result, where the doc lives, the PR/push gates
satisfied, any authority still required, and a drift log of off-standard legacy docs
encountered (reported, not fixed).
