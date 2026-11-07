---
name: openai
description: OpenAI API integration — GPT-6 Astra and GPT-5.x models, Responses API, structured outputs, tool calling, embeddings, vision
verified: 2026-09
layer: domain
category: ai
triggers:
  - "openai"
  - "gpt-5"
  - "responses api"
  - "chatgpt api"
  - "openai embeddings"
  - "openai function calling"
riskLevel: low
linksTo:
  - ai-sdk
  - promptfoo
linkedFrom:
  - ai-sdk
  - rag
---

# OpenAI

> OpenAI API integration — GPT-6 Astra and GPT-5.x models, Responses API, structured outputs, tool calling, embeddings, vision. Content verified against developers.openai.com and the OpenAI system card as of 2026-09-06.

## Models (as of 2026-09-06)
- **Frontier: GPT-6 Astra** (`gpt-6-astra`, released 2026-09-03) — flagship for software engineering, computer use, and hard reasoning. 1,050,000-token context (922k max input), 128k max output, knowledge cutoff 2026-04-30. Reasoning efforts `low` | `medium` | `high` | `xhigh` | `max` (Codex CLI adds `ultra`). Needs Codex CLI 0.153.1+. First model at the Critical cybersecurity level: it refuses advanced cyber tasks such as exploit writing. Costs about 2.5x GPT-5.6 Sol; above 272k context input is billed 2x and output 1.5x (checked 2026-09-06; re-check the pricing page before quoting).
- **Previous frontier: GPT-5.6 family** — Sol (complex reasoning/coding), Terra (intelligence/cost balance), Luna (cost-sensitive, high-volume). IDs seen in docs: `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra` (Luna tier ID unverified). All take text+image input, text output.
- **Prior GPT-5.x line still served**: `gpt-5.5` (reasoning model), `gpt-5.4` (+ `gpt-5.4-mini`/`-nano`), `gpt-5`, `gpt-5-mini`.
- **Reasoning control**: `reasoning: { effort: "minimal" | "low" | "medium" | "high" | "xhigh" }`; `reasoning.mode: "pro"` for quality-first workloads (GPT-5.6). Chat Completions uses top-level `reasoning_effort`.
- **Images**: `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`; or the `image_generation` tool inside Responses.
- Never state pricing from memory — check the platform pricing page.

## When to Use
- Text generation / agents via the Responses API (primary surface)
- Embeddings for vector search / RAG pipelines
- Image understanding (vision input) or image generation
- Structured JSON output or function/tool calling

## Key Patterns

### Responses API (primary; Chat Completions kept for compatibility)
```ts
const res = await openai.responses.create({
  model: "gpt-5.6",
  input: [{ role: "user", content: "..." }], // or a plain string
  reasoning: { effort: "medium" },
});
console.log(res.output_text); // output[] holds typed items: reasoning, message, tool calls
```
- Chain turns with `previous_response_id` (server-stored state, `store: true`) or replay output items as next input.
- **Streaming**: `stream: true`, then `for await (const event of stream)` — handle `response.output_text.delta`, `response.output_item.done`, `response.completed`, `response.failed`.

### Tool / Function Calling
- Responses shape is flat (internally tagged): `{ type: "function", name, description, parameters, strict: true }`; Chat Completions wraps the same under `function: { ... }`.
- Model emits `function_call` items; reply with `{ type: "function_call_output", call_id, output }`.
- Built-in tools: `web_search`, `file_search`, `code_interpreter`, `image_generation` (pass in `tools`).

### Structured Outputs
- Chat Completions: `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` (verified 2026-08); Responses uses `text.format` with the same schema fields (shape unverified against 2026 docs).
- Schema rules: `additionalProperties: false`, every property in `required`, `strict: true`.

### Embeddings (unchanged as of 2026-08)
- `text-embedding-3-small` (1536d, cheap) or `text-embedding-3-large` (3072d, precise)
- Batch embed with `input: string[]`; cosine similarity; same model for docs and queries

### Vision
- User content parts: `{ type: "input_text", text }` and `{ type: "input_image", image_url, detail: "low" | "high" | "auto" }` (base64 data URIs or HTTP URLs)

### Assistants API (legacy)
- Deprecated in favor of the Responses API — do not build new work on threads/runs/assistants; migrate state to `previous_response_id`/stored responses (exact sunset date unverified).

### Rate Limiting and Retries
- Respect `429` with exponential backoff (2^n seconds, jitter, max 60s)
- Track `x-ratelimit-remaining-*` headers; budget for reasoning tokens in `usage` on reasoning models

## Anti-Patterns
- Starting new integrations on Chat Completions or Assistants when Responses covers the use case
- Hardcoding stale model IDs (gpt-4o era) — use config/env vars and current GPT-5.x IDs
- Ignoring reasoning-token usage — high `reasoning.effort` inflates latency and cost
- Skipping error handling on streams — network drops lose partial responses
- Mixing embedding models between docs and queries
- Quoting pricing or context-window numbers from memory instead of the live docs

## Related Skills
`ai-sdk` | `rag` | `prompt-engineering` | `ai-agents`
