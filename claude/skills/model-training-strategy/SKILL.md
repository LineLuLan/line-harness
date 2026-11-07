---
name: model-training-strategy
description: Plan whether to use prompting, RAG, classifier probes, fine-tuning, distillation, local models, remote models, or full training. Use for AI Research Lead decisions about fine-tune strategy, training data design, labeling, model/resource fit, local encoder/classifier training, LoRA/adapters, embedding models, deployment tradeoffs, and when to avoid training because system design or data quality is the real bottleneck.
verified: 2026-08
---

# Model Training Strategy

Use this skill to decide how far to move from prompting toward training.

## Decision Ladder

Check cheaper interventions before training:

1. Prompt and schema repair.
2. Retrieval/data grounding improvement.
3. Rules for deterministic cases.
4. Router/classifier layer.
5. Embedding model swap or hybrid retrieval.
6. Supervised fine-tune or adapter.
7. Distillation into a smaller/local model.
8. Full model training only when data, compute, and ownership justify it.

## Training Readiness Checklist

- Target behavior is stable and measurable.
- Dataset represents production distribution and high-value failures.
- Labels are consistent, audited, and versioned.
- Train/validation/test split prevents leakage by customer/session/order.
- Baselines exist and are hard to beat.
- Evaluation includes per-slice failures and business-weighted errors.
- Deployment resource constraints are known: CPU/GPU/RAM/latency/batch size.
- Rollback path exists if model quality regresses.

## Fine-Tune Guidance

Recommend fine-tuning when:

- The same behavior is repeatedly required across many prompts.
- Prompting/RAG cannot reliably enforce style, routing, or structured behavior.
- There is enough high-quality labeled data and a stable eval.
- Cost or latency improves by moving from a larger model to a smaller specialized model.

Avoid fine-tuning when:

- Data is noisy, tiny, or label definitions are unstable.
- Failures come from missing context, bad retrieval, wrong backend flow, or weak evals.
- The behavior changes frequently due to product or policy changes.
- Privacy/legal approval for training data is unclear.

## Output Shape

```markdown
## Strategy
[Prompt/RAG/router/fine-tune/distill/train recommendation]

## Data Plan
[Dataset source, labeling, splits, leakage controls]

## Model Plan
[Candidate models, resource fit, deployment path]

## Eval Gate
[Acceptance threshold and rollback metric]

## Risks
[Data quality, cost, privacy, drift, maintenance]
```

## Worked Example

Case: a placeholder support model repeatedly violates an approved concise response style.

| Rung | Test | Result |
| ---: | --- | --- |
| 1 | Repair prompt and output schema | Format improves, but 18% still exceed the style limit. |
| 2 | Improve retrieval grounding | Facts improve; repeated style failures remain. |
| 3 | Add deterministic rules | Safe for signatures, not for variable response bodies. |
| 4 | Add a router/classifier | Routing is already correct; style is the failing layer. |
| 5 | Swap embeddings or retrieval | Not relevant because retrieved facts are accurate. |
| 6 | Fine-tune a placeholder model | Chosen: supervised adapter on reviewed style pairs. |

Rung 6 plan: label 2,000 responses, split by customer and session, and accept only if style pass
rate reaches 97%, task success does not regress more than 1 point, and rollback to the prompt-only
placeholder model remains immediate. Stop at rung 6; consider rungs 7-8 only if this fine-tune later
fails the quality, cost, or deployment target.
