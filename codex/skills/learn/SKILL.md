---
name: learn
description: "Generate a layered HTML learning explainer so Line can master a topic, framework, or repo feature/system before working on it. Repo knowledge comes from codegraph or targeted file reads; framework/library knowledge MUST be fetched fresh through context7, never from memory. Auto-triggers on /learn <topic>, or natural phrases like 'tôi muốn học', 'cho tôi học', 'giúp tôi nắm', 'dạy tôi', 'I want to learn', 'help me understand the architecture of', 'explain this system so I can work on it'."
verified: 2026-08
layer: utility
category: learning
triggers: ["/learn", "tôi muốn học", "cho tôi học", "muốn nắm", "giúp tôi nắm", "dạy tôi", "học về", "i want to learn", "help me learn", "teach me", "explain the architecture", "explain this system", "master this feature", "understand this feature before"]
---

# Learn — layered HTML explainer for a topic, framework, or repo system

## Purpose

Turn "tôi muốn học ABC" into ONE self-contained HTML file that teaches ABC in
four layers: intuition → architecture → mechanics → practice. The reader is
Line: a builder who needs to hold the full design of a feature or system in
their head before touching it. Evidence-first: real code via codegraph, real
docs via context7. Nothing about library versions or APIs comes from memory.

## Step 1 — Classify the topic

| Topic shape | Example | Evidence sources |
|---|---|---|
| Repo feature/system | "payment flow của TwoHearts" | codegraph (+ context7 for the frameworks it uses) |
| Framework/library | "Next.js App Router", "Drizzle migrations" | context7 (mandatory) |
| Theory/concept | "event sourcing", "CAP theorem" | web search of primary sources, dated |
| Mixed (most common) | "học feature X để tôi sửa nó" | all of the above |

If the topic is ambiguous (which repo? which feature? how deep?), ask ONE short
question with 2–3 concrete options before gathering. Otherwise do not ask.

## Step 2 — Gather evidence (before writing any HTML)

**Repo code** — docs first when they exist: check the repo's docs INDEX and
the module's SPEC/SSOT before scanning code; a maintained SPEC carries more
evidence per token than a blind sweep, and code then verifies the SPEC.
Then codegraph: `codegraph_explore` with the repo's `projectPath`. Collect: entry points, core symbols with verbatim source, call
paths between them, blast radius. Fallback when the repo has no `.codegraph/`:
Grep for the feature's route/handler/model names, then Read by line range.
Never read whole files to explore. Every code claim in the output carries a
`path:line` reference.

**Frameworks and libraries** — MANDATORY context7 pass. For every framework,
library, or SDK the topic touches (or that the repo code imports in the
gathered slice): `resolve-library-id` → `query-docs` for the specific concepts
involved. Record the resolved library id, the version if shown, and today's
date. If context7 has no match, fall back to web search of the official docs
and say so. Training-data memory is NOT an accepted source for API shapes,
config keys, defaults, or version behavior.

**Theory** — web search primary sources (original paper, official spec, author
blog). Record source + date. Prefer one authoritative source over five blogs.

**Coverage sweep — go deep, never stop at the obvious module (Line's rule,
2026-08-27).** The first module found is the center, not the whole system.
After the core slice, run expansion rounds until a round finds nothing new:

1. Grep the whole repo for the topic's signals: imports of the core module,
   its table names, env vars, Redis key prefixes, event names, tool names.
2. Codegraph blast-radius on the core symbols — every caller outside the
   module is a related feature to cover (channel workers, cron, webhooks,
   scripts/, test harnesses, admin/dashboard routes).
3. Read the docs INDEX and the SPEC of every adjacent module the sweep hit.
4. Check sibling repos in the same workspace that consume or evaluate the
   system (e.g. eval harnesses, dashboards, e2e repos) — at least name their
   role even when a deep read is out of scope.

The output MUST contain a coverage map: every related feature found, one line
each (role + where it lives), plus an explicit "out of scope" list. A feature
silently missing from the map is a defect of the explainer.

## Step 3 — Build the four layers

Every explainer has exactly these four sections, in this order:

1. **Trực giác (eli5)** — one analogy, one big diagram, under 100 words.
   The reader should be able to redraw the diagram from memory.
2. **Kiến trúc** — components and boundaries, one architecture diagram
   (inline SVG or mermaid), the 3–5 design decisions that shaped it and WHY.
   For a repo system: which repos/modules own which responsibility.
3. **Cơ chế** — the actual data flow: a sequence walkthrough of the main path
   (request → ... → response), key code excerpts with `path:line`, the
   framework APIs involved with their context7-verified behavior. Include one
   failure path, not just the happy path.
4. **Thực hành** — reading order ("open these files in this order"), how to
   change it safely (where tests live, what breaks first), top pitfalls, and
   5 self-check questions Line should be able to answer without looking.

## Step 4 — Output

- One self-contained HTML file: no external assets, light/dark aware, wide
  diagrams scroll in their own container. Write it to
  `.learn/learn-<slug>-<yyyy-mm-dd>.html` under the repo root (create the
  dir; it is local working state, never committed) — or under the user's
  home `.learn/` when there is no repo.
- The local HTML file IS the deliverable on both harnesses. NEVER publish it
  as a Claude Artifact — Line's standing rule (2026-08-27). Open the file
  directly in the default browser (`Start-Process <path>` on Windows) and
  report the local path. Design guidance (`artifact-design`,
  `artifact-diagramming` on the Claude side) still applies to the HTML itself.
- End the chat message with: sources used (library ids + dates, code paths),
  and what was NOT verified.

## Best Practices

1. **Evidence before prose** — finish Step 2 completely before writing a single
   section; retrofitting sources produces confident fiction.
2. **Diagrams carry the mechanism** — every diagram shows real component names
   from the code, not generic boxes labeled "Backend".
3. **One main path, walked fully** — a complete trace of one request teaches
   more than shallow coverage of six.
4. **Version-stamp framework claims** — "Next.js 15 App Router (context7,
   2026-08-27)" — so a stale explainer is detectably stale.
5. **Keep tier 1 honest** — the eli5 layer simplifies but never says something
   the deeper layers contradict.
6. **Right-size the file** — a feature explainer is one scrollable page, not a
   book; link out (path references) instead of pasting whole files.

## Common Pitfalls

| Pitfall | Impact | Fix |
|---|---|---|
| Explaining the framework from memory | Stale/wrong APIs taught as fact | context7 pass is mandatory, dated |
| Generic explainer ignoring the repo | Line learns theory, not their system | codegraph slice first; repo names in every diagram |
| Wall of text, no layers | Nothing sticks | enforce the 4-layer structure |
| Only the happy path | Line can't debug what they "learned" | include one failure path in tier 3 |
| Dumping whole source files into the page | Unreadable, huge file | excerpts + `path:line` reading order |

## Example

### Example: "tôi muốn học order webhook flow của TwoHearts backend"

1. Classify: mixed (repo system + its frameworks).
2. Gather: `codegraph_explore(projectPath: D:\01_Workspaces\TwoHearts\<repo>)`
   for webhook handler → queue → worker call paths; context7 for the queue
   library and framework route handler semantics; note idempotency-key code.
3. Write the 4 layers: postman analogy → component diagram (gateway, handler,
   queue, worker, DB) → sequence walkthrough with `src/webhooks/order.ts:42`
   style refs + one duplicate-delivery failure path → reading order, where the
   tests live, 5 self-check questions.
4. Save `.learn/learn-order-webhook-flow-2026-08-27.html`, open it in the
   browser, report sources + the one thing not verified (e.g. staging queue
   config).
