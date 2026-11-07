# Code Standards (per Engineering Standards §3, §7–§10)

Load this reference when writing, linting, structuring, or documenting code.

## Toolchain (GATE, where effective per policy-status)

pnpm everywhere; Node 22 LTS pinned (`.nvmrc` + `engines`); shared Prettier (single quotes,
semicolons; `format:check` in CI); husky + lint-staged run checks locally. **CI is the
authoritative gate** — a skipped hook does not make a PR mergeable.

## Lint Baseline (§10)

- **ERROR tier (merge-blocking, anti-slop core):** `no-floating-promises`,
  `no-misused-promises` (frontend: `checksVoidReturn.attributes: false`), `await-thenable`,
  `no-unused-vars`, `no-for-in-array`, `no-duplicate-enum-values`,
  `no-unnecessary-type-assertion`, `sonarjs/different-types-comparison` (backend stricter),
  `eqeqeq`, `no-constant-binary-expression`, `no-unreachable`, `no-promise-executor-return`,
  `no-constructor-return`, `no-unused-private-class-members`, `no-script-url`.
- **WARN tier (visible, not blocking):** `no-explicit-any`, the `no-unsafe-*` family (WARN by
  explicit verdict — not OFF, not ERROR), complexity/readability rules, deprecation rules.
  Backend is stricter than frontend.
- **Suppression discipline:** inline disables must carry a reason —
  `// eslint-disable-next-line <rule> -- <why>`; turning a rule off at config level requires a
  PR comment and reviewer sign-off; a blanket "too strict" justification is rejected in review.

## Naming And Layout (guideline — ratifies existing patterns)

Backend: `src/modules/<feature>/`, files `<module>.<layer>.ts` with layers
`controller|service|schema|types|errors|queue`, shared code in `src/shared/`. Frontend:
PascalCase components, camelCase hooks/stores, kebab-case UI/util paths.

Tests: `__tests__/` per module/feature; `*.test.ts` / `*.test.tsx`; backend keeps
`*.unit.test.ts` and `*.integration.test.ts` variants. Existing strays go to the migration
backlog, not immediate cleanup.

## Code Documentation (§9)

- TSDoc required on exported/public surfaces, shared utils, and core services; `@param`,
  `@returns`, `@throws` describe intent, invariants, and failure modes — never restate types.
  (ESLint warns on missing export docs; not a block.)
- **TODO / FIXME must link an issue.**
- Inline-comment BLEND rule: narrate flow/structure only for genuinely complex blocks
  (algorithms, multi-step orchestration, tenant-sensitive flows, provider edge cases);
  elsewhere comments explain why, invariants, edge cases, or external constraints. Never
  restate obvious lines. The audience includes AI reviewers — preserve decision context.
- Behavior/API/config/contract/user-visible changes ship the matching doc update **in the same
  PR** (GATE). A PR description must not be the sole record of a durable architecture decision.
