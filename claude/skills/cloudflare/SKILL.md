---
name: cloudflare
description: Build and review Cloudflare Workers, Pages, D1, R2, KV, Durable Objects, DNS, edge caching, bindings, deployment configuration, and runtime patterns.
verified: 2026-08
layer: domain
category: devops
triggers:
  - "cloudflare"
  - "workers"
  - "cloudflare pages"
  - "d1"
  - "r2"
  - "kv"
  - "durable objects"
  - "edge function"
  - "wrangler"
  - "wrangler.jsonc"
  - "static assets"
inputs: [application requirements, edge computing needs, storage requirements]
outputs: [Worker scripts, wrangler configs, D1 schemas, R2 policies, DNS configs]
linksTo: [production-guard]
linkedFrom: [ship, optimize, caching]
preferredNextSkills: [monitoring, authentication, terraform]
fallbackSkills: [vercel, aws]
riskLevel: low
memoryReadPolicy: selective
memoryWritePolicy: none
sideEffects: [edge deployments, DNS changes, storage writes]
---

# Cloudflare Specialist

## Purpose

Design and implement edge-first applications using the Cloudflare platform (current as of 2026-08). This skill covers Workers, Workers Static Assets (the current way to serve SPAs and static sites from a Worker — successor to Workers Sites and the recommended path over Pages for new projects), D1 (SQLite at the edge), R2 (object storage), KV (key-value), Durable Objects, Queues, and performance patterns. Config examples use `wrangler.jsonc`, the recommended format.

## Key Patterns

### Worker with Multiple Bindings

```typescript
// src/worker.ts
// Prefer generating Env with `wrangler types` (writes worker-configuration.d.ts);
// a hand-written interface like this also works but can drift from config.
export interface Env {
  ASSETS: Fetcher; // Static Assets binding
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return handleAPI(request, env, ctx);
      }
      // Everything else: serve the SPA / static assets
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleAPI(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Check KV cache first
  const cacheKey = new URL(request.url).pathname;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  // Query D1
  const result = await env.DB.prepare("SELECT * FROM posts WHERE published = 1 LIMIT 20").all();

  const json = JSON.stringify(result.results);

  // Cache in KV with TTL
  ctx.waitUntil(env.KV.put(cacheKey, json, { expirationTtl: 300 }));

  return new Response(json, {
    headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
  });
}
```

### wrangler.jsonc Configuration (as of 2026-08)

`wrangler.jsonc` is the recommended config format (schema validation, comments, newest features). Legacy `wrangler.toml` is still fully supported with the same keys in TOML syntax — migrate opportunistically, not urgently.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-app",
  "main": "src/worker.ts",
  // Set to today's date when creating the project; bump deliberately
  // (each date opts into runtime behavior changes up to that date).
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],

  // Workers Static Assets — serves an SPA from ./dist
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    // Optional: force these paths through the Worker instead of asset matching
    "run_worker_first": ["/api/*"]
  },

  "vars": { "ENVIRONMENT": "production" },

  "kv_namespaces": [
    { "binding": "KV", "id": "xxx-xxx-xxx" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "my-app-db", "database_id": "xxx-xxx-xxx" }
  ],
  "r2_buckets": [
    { "binding": "R2", "bucket_name": "my-app-uploads" }
  ],
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMITER", "class_name": "RateLimiter" }]
  },
  "migrations": [
    // new_sqlite_classes = SQLite-backed DOs (current default choice);
    // legacy key-value DOs use new_classes
    { "tag": "v1", "new_sqlite_classes": ["RateLimiter"] }
  ],
  "queues": {
    "producers": [{ "binding": "JOBS", "queue": "jobs" }],
    "consumers": [{ "queue": "jobs", "max_batch_size": 10, "max_retries": 3, "dead_letter_queue": "jobs-dlq" }]
  },

  "triggers": { "crons": ["*/5 * * * *"] },

  // Per-environment overrides: wrangler deploy --env staging
  "env": {
    "staging": {
      "name": "my-app-staging",
      "kv_namespaces": [{ "binding": "KV", "id": "staging-kv-id" }]
    }
  }
}
```

### D1 Database Patterns

```typescript
// Parameterized queries (always use bind parameters)
const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();

// Batch operations (single round trip)
const results = await env.DB.batch([
  env.DB.prepare("INSERT INTO orders (user_id, total) VALUES (?, ?)").bind(userId, total),
  env.DB.prepare("UPDATE inventory SET stock = stock - ? WHERE product_id = ?").bind(qty, productId),
]);

// Migrations
// wrangler d1 migrations create my-app-db create_users
// migrations/0001_create_users.sql
/*
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_email ON users(email);
*/
```

### Durable Objects (Rate Limiter, modern RPC style)

```typescript
import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject {
  private requests: Map<string, number[]> = new Map();

  // RPC method — call directly from the Worker, no fetch() plumbing needed
  async check(ip: string): Promise<{ allowed: boolean }> {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = 100;

    const timestamps = this.requests.get(ip) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);

    if (recent.length >= maxRequests) return { allowed: false };

    recent.push(now);
    this.requests.set(ip, recent);
    return { allowed: true };
  }
}

// Caller side (in the Worker):
// const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
// const { allowed } = await stub.check(ip);
```

### R2 Upload Pattern

```typescript
async function handleUpload(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) return new Response("No file", { status: 400 });

  const key = `uploads/${Date.now()}-${file.name}`;
  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  return Response.json({ key, url: `/files/${key}` });
}
```

## Best Practices

### Performance
- Use KV for read-heavy data with eventual consistency tolerance
- Use D1 for relational data that needs consistency
- Use R2 for large objects (images, files, backups)
- Use Durable Objects for coordination and stateful logic (prefer SQLite-backed DOs)
- Use Queues for async/background work with retries and DLQs
- Leverage `ctx.waitUntil()` for non-blocking async work (analytics, caching)
- Use `Cache API` for computed responses; static assets are cached by the platform automatically

### Security
- Always bind parameters in D1 queries (prevent SQL injection)
- Validate request origins with `request.headers.get("Origin")`
- Use `wrangler secret put <KEY>` for API keys, never commit `.env` files
- Implement rate limiting with Durable Objects or the Rate Limiting binding
- Set CORS headers explicitly

### D1 Optimization
- Keep queries simple; D1 runs SQLite at the edge
- Use batch operations to minimize round trips
- Create indexes for frequently queried columns
- Use `RETURNING` clause to avoid extra reads after writes

### Deployment (as of 2026-08)
- `wrangler dev` — local dev on the workerd runtime (bindings simulated locally; `--remote` for real resources)
- `wrangler deploy` (with `--env staging` etc.) — build and deploy immediately
- `wrangler versions upload` then `wrangler versions deploy` — gradual/canary rollouts
- `wrangler tail` — real-time log streaming
- `wrangler types` — regenerate Env types after any binding change
- SPAs and static sites: build a Worker with Static Assets. Pages still works but new projects are steered to Workers; a migration path from Pages to Workers exists

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| String interpolation in D1 queries | Always use `.bind()` parameters |
| Ignoring `ctx.waitUntil()` | Use it for fire-and-forget async work |
| KV reads in hot loops | Batch reads or use Cache API |
| Large Worker bundle | Use dynamic imports, tree shake |
| No error handling | Wrap handler in try/catch, log errors |
| Missing CORS headers | Add explicit `Access-Control-*` headers |
| New SPA on Workers Sites / Pages patterns | Use Workers Static Assets (`assets` config block) |
| Hand-written `Env` drifting from config | Run `wrangler types` after binding changes |
| Blindly bumping `compatibility_date` | Bump deliberately; read the compatibility-flags changelog first |

## Examples

### Cron Trigger (Scheduled Worker)

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Runs every 5 minutes per the crons config
    const staleItems = await env.DB.prepare(
      "SELECT id FROM cache_entries WHERE expires_at < datetime('now')"
    ).all();

    if (staleItems.results.length > 0) {
      const ids = staleItems.results.map((r) => r.id);
      await env.DB.prepare(
        `DELETE FROM cache_entries WHERE id IN (${ids.map(() => "?").join(",")})`
      ).bind(...ids).run();
    }
  },
} satisfies ExportedHandler<Env>;
```

### SPA + API on one Worker (Static Assets)

```jsonc
// wrangler.jsonc — SPA served from ./dist, /api/* handled by the Worker
{
  "name": "my-spa",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

```typescript
// src/worker.ts — API routes first, SPA fallback for everything else
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ ok: true });
    }
    return env.ASSETS.fetch(request); // index.html fallback handles client routing
  },
} satisfies ExportedHandler<Env>;
```
