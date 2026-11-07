---
name: model-intelligence-watch
description: Continuously research and refresh AI model strategy for a company, including new frontier models, local/open models, embeddings, rerankers, classifiers, multimodal models, fine-tuning support, pricing, context windows, latency, API changes, eval methods, deployment patterns, and cost/performance optimization. Use before major model recommendations, architecture reviews, cost-per-order planning, fine-tune decisions, or model roadmap updates.
verified: 2026-08
---

# Model Intelligence Watch

Use this skill to keep the company's model strategy current instead of frozen in old assumptions.

## Research Triggers

Use this skill when:

- Choosing or replacing a model.
- Reviewing AI architecture or model routing.
- Estimating cost per order/conversation.
- Planning fine-tune, distillation, local deployment, or hybrid routing.
- Updating eval benchmarks or strategy.
- A model/provider/library may have changed since the last decision.

## Source Rules

- Prefer official provider docs, pricing pages, release notes, model cards, technical reports,
  papers, and local dependency/source inspection.
- Start from the official documentation roots in `references/sources.md`.
- Use current sources for date-sensitive claims: model availability, API behavior, pricing,
  context windows, fine-tuning support, rate limits, and deprecations.
- Treat public benchmark claims as hypotheses until reproduced on company evals.
- Record the date checked and source type.

## Research Workflow

1. Define the decision: quality, cost, latency, tool calling, local deployment, embeddings, routing,
   fine-tune, multimodal, or privacy.
2. List candidates:
   - Current production baseline.
   - Smaller/cheaper remote models.
   - Stronger frontier models for hard cases.
   - Local/open models for routing, embeddings, classification, or privacy.
   - Hybrid cascade options.
3. Check current facts: pricing, context, latency expectations, structured output/tool support,
   fine-tuning, embeddings, batch APIs, caching, safety, and deployment constraints.
4. Map candidates to company evals and cost-per-order assumptions.
5. Recommend experiments rather than direct rollout when evidence is missing.

## Strategy Patterns

- Use small/local classifiers or rules before expensive generation.
- Use frontier models only for high-value or hard cases when evals justify cost.
- Use model cascades with escalation thresholds.
- Use prompt compression, summarization, retrieval pruning, and caching before upgrading models.
- Re-evaluate model choices when provider pricing or API capabilities change.
- Maintain a holdout eval set that is not used to tune prompts or training.

## Output Shape

```markdown
## Model Intelligence Update
[Decision and date-sensitive sources checked]

## Candidate Matrix
[Model/provider, role, quality hypothesis, cost, latency, constraints]

## Recommendation
[Use / test / avoid, with confidence]

## Evals To Run
[Company-specific tests before adoption]

## Cost/Architecture Impact
[Expected cost/order, latency, and routing changes]
```
