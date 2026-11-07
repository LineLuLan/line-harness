---
name: zod
description: "Use when working with Zod schemas for TypeScript validation, API payload parsing, form validation, environment validation, runtime type checks, and z.infer types."
verified: 2026-08
---

# Zod

> TypeScript-first schema validation with static type inference.
> This skill teaches **Zod v4 (current, as of 2026-08)**. Zod v3 and v4 have breaking API
> differences — **check `package.json` first** (`"zod": "^4.x"` vs `"^3.x"`) before writing code.

## When to Use
- Validating API request/response bodies
- Form validation with react-hook-form
- Environment variable validation
- Runtime type checking at system boundaries

## Version Check (do this first)
- `zod@4.x`: `import { z } from "zod"` gives v4.
- `zod@3.25+`: v4 API available at `import { z } from "zod/v4"`; plain `"zod"` is still v3.
- `zod@<3.25`: v3 only. Use the v3 column in the table below.
- Library code can support both: `import * as z3 from "zod/v3"` / `import * as z4 from "zod/v4/core"`; a v4 schema has a `_zod` property, v3 has `_def` only.

## Core Patterns — Zod v4 (current, as of 2026-08)

### Schema Definition
```typescript
import { z } from "zod"; // v4 when zod@4.x is installed

const UserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),                       // v4: top-level format (z.string().email() is deprecated)
  age: z.number().int().positive().optional(),
  role: z.enum(["admin", "user", "moderator"]),
  tags: z.array(z.string()).default([]),
  meta: z.record(z.string(), z.unknown()), // v4: key schema is REQUIRED (2 args)
});

type User = z.infer<typeof UserSchema>;   // unchanged in v4 (z.input/z.output also unchanged)
```

### Validation
```typescript
// parse() throws on failure, safeParse() returns result object
const result = UserSchema.safeParse(data);
if (!result.success) {
  console.log(z.treeifyError(result.error)); // v4 formatter (.flatten()/.format() deprecated)
  console.log(z.prettifyError(result.error)); // human-readable string
}
```

### Error Customization (v4)
```typescript
// One unified `error` param replaces v3's message/invalid_type_error/required_error/errorMap
z.string({ error: "Name is required" });
z.string().min(5, { error: "Must be 5+ characters" });
z.email({ error: (issue) => issue.input === undefined ? "Required" : "Invalid email" });
// v3-style `{ message: "..." }` still works but is deprecated; cannot combine with `error`.
```

### Common Combinators
- `.transform()` — transform after validation
- `.refine()` / `.superRefine()` — custom and multi-field validation
- `z.discriminatedUnion()` — tagged unions
- `z.strictObject({...})` / `z.looseObject({...})` — v4 replacements for `.strict()` / `.passthrough()` (the methods still exist but are deprecated)
- `z.partialRecord(keyEnum, value)` — v4: `z.record` with an enum key is exhaustive; use this for optional keys
- Top-level formats: `z.email()`, `z.uuid()`, `z.url()`, `z.ipv4()`, `z.ipv6()`, `z.iso.date()`, `z.iso.datetime()`, `z.int()`

### Integration
- **react-hook-form**: `zodResolver(schema)` in useForm (`@hookform/resolvers` v4-compatible from ~v5; unverified exact version)
- **tRPC**: schemas as input/output validators
- **Next.js**: server action validation
- **Env vars**: `z.object({...}).parse(process.env)` at startup
- **Bundle/perf**: v4 is substantially faster and smaller than v3; `zod/mini` offers a tree-shakeable functional API (exact speedup figures: unverified)

## v3 Differences (for repos still on `zod@3`)

| Concern | Zod v4 (current) | Zod v3 |
|---|---|---|
| Import | `zod` (or `zod/v4` on 3.25+) | `zod` |
| Email/URL/UUID | `z.email()`, `z.url()`, `z.uuid()` top-level | `z.string().email()`, `.url()`, `.uuid()` |
| Custom errors | single `{ error }` (string or function) | `{ message }`, `invalid_type_error`, `required_error`, `errorMap` (all removed in v4) |
| `z.record` | 2 args required: `z.record(key, value)` | 1 arg allowed: `z.record(value)` |
| Unknown keys | `z.looseObject` / `z.strictObject` | `.passthrough()` / `.strict()` |
| Error formatting | `z.treeifyError(err)`, `z.prettifyError(err)` | `err.flatten()`, `err.format()` |
| Enum-key records | exhaustive; `z.partialRecord` for partial | not exhaustive |
| `z.infer` / `z.input` / `z.output` | unchanged | same |
