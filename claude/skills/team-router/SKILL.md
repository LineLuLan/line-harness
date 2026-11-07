---
name: team-router
description: Route any task to the correct shared-bank tier, workflow, and role kit. Use when asked which skill to use, how to route a task, where to start a task, or which CORE and role skills to install.
verified: 2026-08
---

# Team Router

Start here when the task does not already name an authoritative policy or skill. Load the smallest
route that covers the work; do not load an entire role kit into one session.

## Task Routing

| Task signal | Destination |
| --- | --- |
| Work in a TwoHearts repository | `twohearts-engineering-standards` first; let it route domain policy skills. |
| Large, multi-file, or vague build | `gsd-plan`, then approved execution and `gsd-verify`. |
| Small, clear change | `gsd-quick` plus the narrow stack skill. |
| Decision with material tradeoffs | `weighted-matrix`; add `pre-mortem` or `issue-tree` only when useful. |
| Review someone else's pull request | `pr-review`. |
| Review your own diff | `cx-code-review`. |
| Pre-ship or pre-PR readiness | `cx-verify`. |
| AI strategy, model choice, evals, cost, or research | `ai-research-lead`, then its narrow AI-tier route. |
| UI, component, design-system, or design-quality work | `ui-ux-pro-max`; add one narrow framework or design verb skill. |
| Repository or codebase audit | Run the `audit` command from `25-review-quality/commands`. |

## Session Flow

`task -> router -> plan or quick -> execute -> verify -> handoff`

Use `gsd-plan` for work that needs decomposition or approval. Use `gsd-quick` when scope and success
criteria are already clear. End meaningful sessions with `handoff` when continuation context is
needed.

## Installation Kits

Install CORE once, then install the role kit that matches recurring responsibilities. Stack choices
inside a kit are selective, not cumulative.

| Kit name | Skills list |
| --- | --- |
| CORE (all roles, 7) | `twohearts-engineering-standards`, `handoff`, `strategic-compact`, `weighted-matrix`, `production-guard`, `cx-verify`, `gsd-quick` |
| Orchestrator / Tech Lead | CORE; `gsd-plan`, `gsd-execute`, `gsd-verify`, `vc-generate-plan`, `mece`, `pre-mortem`, `issue-tree`, `make-decision`, `task-delegation`, `skill-creator`, the remaining `twohearts-*` policy skills, `pr-review` |
| Backend Engineer | CORE; `postgresql`, `database-indexing`, `drizzle`, `drizzle-kit`; choose `neon`, `turso`, or `sqlite` by stack; `api-designer`, `api-versioning`, `api-error-handling`, `api-rate-design`, `zod`, `bun`, `pnpm`; commands `backend`, `database`, `security`, `audit` |
| Frontend / Design | CORE; `react`, `nextjs`, `tailwind`, `radix-ui`, `ui-ux-pro-max` and its taste references; choose 5-7 `impeccable-*` verbs; optional `vercel-react-native-skills`; `playwright`, `zod`; commands `frontend`, `audit` |
| AI Engineer | CORE; `openai`, `ai-sdk`, `promptfoo`, `tool-calling-flow-audit`, `model-evals-strategy`, `customer-intelligence-memory`, `conversation-data-preprocessing`, `zod`, `postgresql`; commands `backend`, `security` |
| AI Research Lead | CORE; `ai-research-lead`, `model-intelligence-watch`, `model-evals-strategy`, `model-training-strategy`, `tool-calling-flow-audit`, `ai-cost-per-order`, `customer-intelligence-memory`, `conversation-data-preprocessing`, `task-delegation`; command `ai-architecture-review` |
| Reviewer / QA | CORE; `pr-review`, `cx-code-review`; commands `audit`, `security`, `database`, `test-sweep`, `pre-deploy`; optional `promptfoo` for AI reviews |

## Router Boundaries

- This router replaces `backend-ai-production-router` as the shared bank's top-level router.
- Keep the routing table inside `ai-research-lead` as the AI-tier sub-router.
- Policy routers override workflow preferences. TwoHearts work always begins with
  `twohearts-engineering-standards`.
- Load only the destination skill and necessary dependencies for the current task. Installation
  kits describe workstation setup, not per-request context loading.
