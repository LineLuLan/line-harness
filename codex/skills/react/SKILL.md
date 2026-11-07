---
name: react
description: "React patterns, hooks, state management, performance optimization, component architecture, TypeScript patterns for components, and data fetching. Absorbs component-patterns, typescript-frontend, typescript-patterns, state-management, zustand, jotai, swr, tanstack-query."
verified: 2026-08
layer: domain
category: frontend
triggers: ["JSX", "QueryClientProvider", "SWRConfig", "as const", "atom", "atom(", "atomFamily", "atomWithStorage", "atomic state", "branded type", "component pattern", "compound component", "conditional type", "context vs zustand", "create store", "discriminated union", "generic component", "global state", "global state react", "headless component", "hoc pattern", "jotai", "mapped type", "polymorphic component", "queryClient", "react component", "react context", "react hook", "react memo", "react pattern", "react performance", "react query", "react render", "react types", "redux", "redux toolkit", "render props", "satisfies", "selector", "signals", "stale-while-revalidate", "state architecture", "state management", "store", "swr", "tanstack query", "template literal type", "type inference", "type safe", "type-level", "typescript DX", "typescript frontend", "typescript pattern", "useAtom", "useEffect", "useInfiniteQuery", "useMutation", "useQuery", "useSWR", "useSWRInfinite", "useSWRMutation", "useShallow", "useState", "zod schema", "zustand", "zustand middleware", "zustand persist", "zustand slice", "zustand store"]
---

# React

Route React implementation work to the smallest relevant reference while keeping the modern best-practice gate active for every task.

## Modern React Best-Practice Gate

Before applying any pattern below, check these current React rules:

1. **Render must stay pure and idempotent** — Component and Hook bodies calculate JSX from props, state, and context. Do not mutate props/state/Hook arguments, perform I/O, schedule timers, subscribe, or call state setters during render.
2. **Effects are synchronization, not derivation** — Use Effects for external systems: browser APIs, subscriptions, non-React widgets, network synchronization that is not handled by the framework/cache. If the value can be calculated from current props or state, derive it during render; if the work is caused by a click/submit/input, put it in the event handler.
3. **Keep state minimal and classified** — Server data belongs in Server Components, framework loaders, TanStack Query, or SWR; URL state belongs in the URL; form state belongs in form APIs; local UI state stays near the component; shared client state should be intentional.
4. **Use `useSyncExternalStore` for external mutable sources** — Browser APIs, third-party stores, and custom stores need a subscribe/getSnapshot contract with immutable cached snapshots and cleanup.
5. **Memoization is a performance tool, not a correctness fix** — `memo`, `useMemo`, and `useCallback` are useful after a concrete re-render cost or unstable prop boundary is identified. Prefer pure rendering, local state, composition, fewer props, and removing unnecessary Effects before blanket memoization. React Compiler may reduce manual memo needs when enabled.
6. **Strict Mode issues are bugs to fix** — Components, Effects, and ref callbacks should tolerate development double-runs through purity and cleanup. Do not suppress Strict Mode to hide missing cleanup or render mutation.
7. **Async UI needs explicit states** — Use Suspense/error boundaries, `useActionState`, `useOptimistic`, `useTransition`, and discriminated unions where they match the app architecture. Avoid hidden boolean soups for complex async flows.

Primary references: https://react.dev/reference/rules/components-and-hooks-must-be-pure, https://react.dev/learn/you-might-not-need-an-effect, https://react.dev/learn/synchronizing-with-effects, https://react.dev/reference/react/useSyncExternalStore, https://react.dev/reference/react/StrictMode, https://react.dev/reference/react/memo

## Reference Index

| Topic | File | When to load |
| --- | --- | --- |
| Core | [`references/core.md`](references/core.md) | Load for hooks, rendering, performance, and core component architecture. |
| Component Patterns | [`references/component-patterns.md`](references/component-patterns.md) | Load for compound, controlled, headless, render-prop, and HOC component designs. |
| TypeScript Frontend | [`references/typescript-frontend.md`](references/typescript-frontend.md) | Load for typed React props, hooks, events, forms, and frontend API boundaries. |
| TypeScript Patterns | [`references/typescript-patterns.md`](references/typescript-patterns.md) | Load for advanced TypeScript types, inference, and type-level utilities. |
| State Management | [`references/state-management.md`](references/state-management.md) | Load when choosing or structuring local, shared, server, URL, or form state. |
| Zustand | [`references/zustand.md`](references/zustand.md) | Load for Zustand stores, selectors, middleware, slices, and persistence. |
| Jotai | [`references/jotai.md`](references/jotai.md) | Load for atomic state, derived atoms, storage, and atom families. |
| SWR | [`references/swr.md`](references/swr.md) | Load for SWR fetching, mutation, pagination, caching, and deduplication. |
| TanStack Query | [`references/tanstack-query.md`](references/tanstack-query.md) | Load for TanStack Query fetching, mutations, invalidation, pagination, and SSR. |
