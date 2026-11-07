---
name: customer-intelligence-memory
description: Design and review customer intelligence, long-term memory, personalization, customer history, profile summarization, retrieval, privacy, retention, deletion, and analytics systems for AI agents. Use when building AI memory over company local data, conversation history, orders, preferences, complaints, segments, customer lifetime value, or personalization that must improve revenue while controlling privacy and hallucination risk.
verified: 2026-08
---

# Customer Intelligence Memory

Use this skill to design customer memory that is useful, scoped, and safe.

## Memory Architecture Flow

1. Define jobs-to-be-done: personalization, support continuity, upsell, churn prevention, routing,
   complaint handling, or customer segmentation.
2. Separate memory types:
   - Raw events: orders, messages, clicks, tickets, calls.
   - Derived facts: preferences, allergies, language, location, segment.
   - Summaries: customer timeline, recent issues, lifecycle state.
   - Embeddings: searchable snippets or normalized facts.
   - Decisions: why an offer, route, or recommendation was chosen.
3. Design write policy: what gets stored, who can write, confidence, source, timestamp, TTL, and
   correction/deletion path.
4. Design read policy: which memories are retrieved for which intents, how many, freshness, source
   citations, and privacy boundaries.
5. Define evals: memory precision, stale fact rate, harmful recall, personalization lift, cost, and
   support resolution impact.

## Guardrails

- Prefer structured facts plus compact summaries over dumping raw transcripts into prompts.
- Store source, timestamp, confidence, and scope for every durable memory.
- Distinguish user-stated facts from model-inferred facts.
- Do not use sensitive attributes unless explicitly approved and legally valid.
- Support deletion, correction, and retention expiry.
- Keep memory retrieval intent-scoped to avoid irrelevant or creepy personalization.

## Output Shape

```markdown
## Memory Strategy
[What to store, summarize, embed, and retrieve]

## Data Model
[Entities, fields, source, confidence, TTL]

## Read/Write Policy
[When memory is created and when it is used]

## Evals
[Precision, freshness, privacy, revenue/support metrics]

## Risks
[Privacy, stale facts, hallucinated facts, over-personalization]
```
