---
name: ai-cost-per-order
description: Estimate, review, and optimize AI processing cost per order, conversation, customer session, tool-calling workflow, or model route. Use when designing architecture for unit economics, token budgets, prompt cost, model cascade strategy, local-vs-remote model tradeoffs, caching, batching, latency/cost guardrails, margin impact, revenue protection, and cost dashboards for AI order automation.
verified: 2026-08
---

# AI Cost Per Order

Use this skill to make AI architecture financially measurable.

## Cost Model Flow

1. Define the unit: order, conversation, customer session, message, tool-call workflow, or resolved
   support case.
2. Map the AI path: classifier/router -> retrieval/memory -> generation -> tool calls -> fallback
   or human handoff.
3. Estimate cost drivers:
   - Input/output tokens per step.
   - Model price by route.
   - Embedding, retrieval, reranking, memory writes, and vector storage.
   - Tool-call count, retries, timeouts, and duplicate calls.
   - Local CPU/GPU cost, RAM footprint, cold start, and batch throughput.
   - Human escalation or correction cost when the model fails.
4. Compute expected and worst-case cost: mean, p95, high-context case, retry case, and fallback case.
5. Compare against revenue/margin: cost/order, cost as percent of gross margin, and loss avoided.
6. Recommend controls: model cascade, max token budget, prompt compression, cache, local router,
   deterministic rules, batching, retrieval pruning, and handoff thresholds.

## Required Metrics

- `cost_per_order`
- `cost_per_conversation`
- `cost_per_successful_resolution`
- `tokens_per_step`
- `tool_calls_per_order`
- `fallback_rate`
- `human_handoff_rate`
- `p50/p95_latency`
- `gross_margin_after_ai_cost`

## Architecture Checks

- Is a small/local router used before expensive generation?
- Are deterministic cases handled by rules or tools instead of LLM calls?
- Are long customer histories summarized before entering prompts?
- Are retrieval candidates capped and reranked only when needed?
- Are duplicate retries idempotent and counted?
- Is there a hard budget stop per order/session?
- Does monitoring show cost by intent, route, model, and customer segment?

## Output Shape

```markdown
## Unit Economics Verdict
[Healthy / risky / not measurable]

## Cost Formula
[Step-by-step cost model]

## Architecture Findings
[Where cost leaks or margin risk appears]

## Optimization Plan
[Router/cascade/cache/prompt/data/tool changes]

## Dashboard Metrics
[Metrics Line/team should implement]
```

## Worked Example

All model names and prices below are placeholders; prices are USD per 1 million tokens.

| Step | Placeholder model | Input tokens x price | Output tokens x price | Cost |
| --- | --- | ---: | ---: | ---: |
| Route | Router-A | `800/1M x $0.10` | `50/1M x $0.40` | `$0.00010` |
| Retrieve | Embed-B | `1,000/1M x $0.02` | `0` | `$0.00002` |
| Generate | Generator-C | `3,000/1M x $2.00` | `500/1M x $8.00` | `$0.01000` |

`cost_per_order = 0.00010 + 0.00002 + 0.01000 = $0.01012`.

For placeholder order revenue of `$20.00` and non-AI cost of `$12.00`:

`gross_margin_after_ai_cost = 20.00 - 12.00 - 0.01012 = $7.98988`.

AI uses `0.01012 / 8.00 x 100 = 0.1265%` of pre-AI gross margin. Add retry probability and
human handoff cost before using this directional example for a production budget.
