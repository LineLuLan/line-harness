---
name: tool-calling-flow-audit
description: Audit backend and agent tool-calling flows for correctness, safety, routing, classifier decisions, argument validation, idempotency, retries, permissions, observability, and business workflow alignment. Use when reviewing whether an AI agent calls the right tools in the right order, whether router/classifier logic gates tools correctly, or whether backend tool execution can cause wrong orders, duplicate actions, cost spikes, or customer-impacting failures.
verified: 2026-08
---

# Tool Calling Flow Audit

Use this skill to review agent/tool behavior as a backend workflow, not just an LLM output.

## Audit Flow

1. Identify the intended business workflow and tool inventory.
2. Trace the actual path: user input -> router/classifier -> prompt/context -> tool selection ->
   argument construction -> backend validation -> side effect -> response.
3. Check each tool boundary:
   - Auth and permission.
   - Required/optional arguments.
   - Schema validation.
   - Idempotency key or deduplication.
   - Retry behavior and timeout.
   - Error recovery and user-visible fallback.
   - Logging/tracing without secrets or PII leakage.
4. Compare traces against expected flows for happy path, edge cases, and forbidden actions.
5. Classify findings by business impact.

## Failure Modes To Hunt

- Wrong intent routes to a side-effect tool.
- Tool called with hallucinated IDs, prices, menu items, addresses, or customer facts.
- Missing confirmation before irreversible or paid actions.
- Duplicate order/payment/message due to retry or refresh.
- Tool result ignored and model replies from stale context.
- Tool errors converted into confident false success.
- Classifier fallback uses generic generation when deterministic tool/rule should win.
- Cost spike from unnecessary multi-step tool loops.

## Required Evidence

Prefer real traces, logs, tests, or code references. If unavailable, produce a test plan and mark
the audit as static review only.

## Output Shape

```markdown
## Verdict
[Correct / risky / broken, confidence]

## Flow Map
[Observed tool sequence and decision points]

## Findings
[Severity, file/trace, impact, fix]

## Eval Tests To Add
[Tool-flow regression cases]

## Rollout Guard
[Monitoring and rollback condition]
```
