---
description: AI architecture review for model, data, memory, tool-calling, eval, cost, and rollout risk.
verified: 2026-08
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(rg:*), Bash(find:*), AskUserQuestion, Task
---

# AI Architecture Review

Use this command when reviewing an AI system architecture before implementation or production
rollout.

## Scope

Review:

- Model and routing architecture.
- Data ingestion and feature/memory pipeline.
- Prompt/RAG/tool-calling boundaries.
- Eval and monitoring coverage.
- Cost, latency, privacy, and rollback.

## Workflow

1. Read repository instructions and architecture docs if present.
2. Map the current or proposed flow: data -> model/router -> tools -> memory -> response.
3. Identify business objective and measurable success.
4. Use `$ai-research-lead` plus relevant domain skills.
5. Produce findings ordered by business risk.

## Output

```markdown
## Verdict
[Ready / risky / not ready]

## Architecture Map
[Current/proposed flow]

## Findings
[Severity, evidence, impact, fix]

## Required Evals
[Offline/online gates]

## Tasks For Line
[Implementation packets]
```
