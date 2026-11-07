---
name: ai-sdk
description: Use when building with stable Vercel AI SDK v5 in TypeScript or React, including text and UI streaming, tool calling, multi-step execution, structured output, UIMessage conversion, and useChat client flows.
verified: 2026-08
---

# AI SDK v5

Use stable AI SDK v5 APIs. Check installed package versions before changing an existing project.
Treat every model identifier below as a placeholder; choose a project-specific model from current
provider documentation and project evals.

## When to Use

- Build text generation or streaming in TypeScript and Next.js route handlers.
- Stream typed UI messages to React clients.
- Add server-side or client-side tools and multi-step tool loops.
- Produce schema-validated output with Zod.
- Implement chat with `useChat` from `@ai-sdk/react`.

## Core Patterns

### Generate and Stream Text

```typescript
import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-5.2"); // Placeholder; model choice is project-specific.

const { text } = await generateText({
  model,
  system: "Answer precisely.",
  prompt: "Summarize the incident in three bullets.",
});

const result = streamText({
  model,
  prompt: "Explain the remediation plan.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

Handle provider and validation failures at the boundary. Record model choice, latency, token use,
and retries when the application has production requirements.

### Define Tools

Use `tool()` and validate inputs with `inputSchema`.

```typescript
import { generateText, tool } from "ai";
import { z } from "zod";

const result = await generateText({
  model,
  prompt: "What is the weather in Bangkok?",
  tools: {
    getWeather: tool({
      description: "Get current weather for a city.",
      inputSchema: z.object({
        city: z.string().min(1),
      }),
      execute: async ({ city }) => weatherService.current(city),
    }),
  },
});
```

Keep side-effecting tools narrow, authorized, observable, and idempotent. Validate tool results
before passing external data back to the model.

### Run Multiple Steps

Use `stopWhen: stepCountIs(n)` on `generateText` or `streamText`.

```typescript
import { stepCountIs, streamText } from "ai";

const result = streamText({
  model,
  messages,
  tools,
  stopWhen: stepCountIs(5),
});
```

Treat the limit as a safety bound, not a target. Structured output adds one generation step, so
raise the count by one when combining it with a bounded tool loop.

### Stream UI Messages from a Route Handler

Route handlers receive `UIMessage[]`. Convert them before sending them to the model, then return a
UI message stream response.

```typescript
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json();

  const result = streamText({
    model: openai("gpt-5.2"), // Placeholder; model choice is project-specific.
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
```

### Use Chat in React

Manage form state in the component. `useChat` manages messages and transport, not the input field.

```tsx
"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, addToolOutput } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onToolCall({ toolCall }) {
      if (toolCall.toolName === "getBrowserLocale") {
        addToolOutput({
          tool: "getBrowserLocale",
          toolCallId: toolCall.toolCallId,
          output: navigator.language,
        });
      }
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const text = input.trim();
        if (!text) return;
        sendMessage({ text });
        setInput("");
      }}
    >
      {messages.map((message) => (
        <div key={message.id}>{message.role}</div>
      ))}
      <input value={input} onChange={(event) => setInput(event.target.value)} />
      <button type="submit">Send</button>
    </form>
  );
}
```

Do not await `addToolOutput` inside `onToolCall`; waiting there deadlocks the client tool flow.
Use `sendAutomaticallyWhen` when completed client tool calls should resume generation.

### Produce Structured Output

Use `experimental_output: Output.object({ schema })` when text generation or tools must finish with
a typed object.

```typescript
import { generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";

const schema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
});

const result = await generateText({
  model,
  prompt: "Research the question, then return the final answer.",
  tools: {
    lookup: tool({
      description: "Look up an approved source.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => sourceIndex.lookup(query),
    }),
  },
  stopWhen: stepCountIs(6), // Five tool-loop steps plus one structured-output step.
  experimental_output: Output.object({ schema }),
});

const typedAnswer = result.experimental_output;
```

For pure structured generation without tools or surrounding text, `generateObject` and
`streamObject` remain available in v5.

## Anti-Patterns

- Do not use the v4 tool field `parameters:`; use `inputSchema`.
- Do not use `maxSteps`; use `stopWhen: stepCountIs(n)`.
- Do not return `toDataStreamResponse`; return `toUIMessageStreamResponse` for UI chat streams.
- Do not expect `useChat` to expose or manage `input`, `handleInputChange`, or form submission.
- Do not copy gpt-4o-era model identifiers into examples; use placeholders and make model choice
  project-specific.
- Do not await client `addToolOutput` from inside `onToolCall`.

AI SDK 6 is in beta (`ToolLoopAgent`, stable `output` parameter); this skill covers stable v5.
