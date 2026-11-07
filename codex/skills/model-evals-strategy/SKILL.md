---
name: model-evals-strategy
description: Design and review evaluation systems for choosing AI models, routers, classifiers, encoders, RAG components, tool-calling agents, prompt variants, and fine-tune candidates. Use when the user needs model comparison, eval datasets, metrics, acceptance thresholds, scorecards, business-weighted decisions, cost/latency analysis, offline/online eval plans, or strategy for selecting the most accurate and profitable model.
verified: 2026-08
---

# Model Evals Strategy

Use this skill to turn model choice into a measured business decision.

## Eval Design Flow

1. State the decision: choose model, route intents, retrieve knowledge/menu items, call tools,
   generate replies, classify customers, reduce cost, or protect revenue.
2. Define test units: prompt, conversation turn, full session, tool-call trace, customer profile,
   retrieval query, or backend action.
3. Build eval slices before scoring: language, intent, high-value users, complaints, edge cases,
   tool-required cases, refusal/safety cases, noisy text, long history, and production-like data.
4. Choose metrics by task:
   - Classification/router: macro-F1, per-class F1, confusion matrix, business-weighted error.
   - Retrieval: Recall@k, MRR, nDCG, exact item hit, latency, false-positive cost.
   - Tool calling: valid call rate, argument accuracy, sequence success, no-op/duplicate rate.
   - Generation: task success, groundedness, policy compliance, human preference, cost/token.
   - Memory: precision of recalled facts, freshness, privacy leakage, deletion correctness.
5. Add guardrails: latency p95, cost/request, token usage, RAM/CPU/GPU fit, data privacy, and
   rollback condition.
6. Report both raw scores and business-weighted recommendation.

## Model Comparison Rules

- Compare against a baseline: current production, simple rules, keyword search, smaller model, or
  hybrid pipeline.
- Do not hide small dataset risk. Label results as directional until data volume and production
  coverage are sufficient.
- Prefer confidence intervals or bootstrap when sample size is small.
- Weight errors by business impact. A complaint misrouted to greeting may matter more than a
  greeting misrouted to other.
- Separate encoder quality, generator quality, router quality, retrieval quality, and tool-flow
  quality. One model rarely wins every layer.

## Minimum Report

```markdown
## Decision
[What model/system choice this eval supports]

## Dataset
[Source, size, labels, slices, known gaps]

## Metrics
[Primary + guardrails]

## Results
[Score table + per-slice failures]

## Recommendation
[Winner, fallback, confidence, rollout scope]

## Next Eval Work
[Data to add, tests to rerun, production monitor]
```

## Worked Example

Evaluate a placeholder router on 200 labeled turns, with 50 turns per class.

| Class | Weight | Baseline F1 | Candidate F1 |
| --- | ---: | ---: | ---: |
| order | 3 | 0.86 | 0.91 |
| support | 2 | 0.80 | 0.84 |
| complaint | 5 | 0.62 | 0.78 |
| greeting | 1 | 0.92 | 0.90 |

Business-weighted baseline: `(0.86*3 + 0.80*2 + 0.62*5 + 0.92*1) / 11 = 0.745`.

Business-weighted candidate: `(0.91*3 + 0.84*2 + 0.78*5 + 0.90*1) / 11 = 0.837`.

Verdict: use the candidate placeholder router in a limited rollout. Macro behavior improves, the
highest-cost complaint class gains 0.16 F1, and the weighted score gains 0.092. Keep greeting
regression below 0.03 and collect at least 100 complaint examples before a broad rollout.
