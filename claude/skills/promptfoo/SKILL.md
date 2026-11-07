---
name: promptfoo
description: Use Promptfoo to run LLM red-team and evaluation suites for prompt injection, jailbreaks, data leakage, PII exposure, RAG risks, and agent safety regressions.
verified: 2026-08
triggers:
  - "red team"
  - "test llm security"
  - "llm vulnerability"
  - "prompt injection test"
  - "jailbreak test"
  - "ai security scan"
  - "promptfoo"
  - "llm eval"
  - "test ai safety"
---

# Promptfoo - LLM Security Testing

Use Promptfoo for automated red teaming and repeatable evaluation of AI agents, RAG
pipelines, and LLM-powered applications.

Sources: https://github.com/promptfoo/promptfoo and https://www.promptfoo.dev/

## Quick Start

```bash
# Configure a red-team run interactively.
npx promptfoo@latest redteam setup

# Run the configured red-team suite.
npx promptfoo@latest redteam run

# Review the results.
npx promptfoo@latest redteam report
```

## Core Concepts

Red teaming generates adversarial prompts to probe:

- Prompt injection and jailbreaks
- Data exfiltration and PII leakage
- Harmful content generation
- Business-logic violations
- RAG poisoning and context stuffing

Define targets, plugins, strategies, and test volume in `promptfooconfig.yaml`:

```yaml
targets:
  - id: openai:<your-target-model>
    # Current-generation example: openai:gpt-5.2. Verify availability and project fit.
    config:
      systemPrompt: "You are a helpful assistant."

redteam:
  purpose: "Customer support chatbot"
  numTests: 50
  plugins:
    - id: harmful:hate
    - id: pii:direct
    - id: prompt-injection
    - id: jailbreak
    - id: harmful:violent-crimes
  strategies:
    - jailbreak
    - prompt-injection
```

## Key Plugins

| Category | Plugin IDs |
| --- | --- |
| Harmful content | `harmful:hate`, `harmful:violent-crimes`, `harmful:cybercrime` |
| PII | `pii:direct`, `pii:session`, `pii:api-db` |
| Injection | `prompt-injection`, `indirect-prompt-injection` |
| Jailbreaks | `jailbreak`, `jailbreak:tree` |
| Business | `policy`, `overreliance`, `excessive-agency` |
| RAG-specific | `rag-poisoning`, `context-length-exceeded` |

## Evaluation And CI

Run an evaluation against the configured target:

```bash
npx promptfoo@latest eval --config promptfooconfig.yaml
```

CI integration with GitHub Actions:

```yaml
- name: LLM Security Scan
  run: npx promptfoo@latest redteam run --ci
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## When To Use

- Before shipping an LLM feature to production
- After material prompt, model, tool, or system-instruction changes
- In CI for AI-powered endpoints and workflows
- When auditing RAG pipelines for data leakage
- When adding tool use or function calling
