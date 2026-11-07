---
name: lint-format
description: "Unified linting + formatting toolkit — ESLint (flat config, custom rules, plugins, shared configs), Prettier (formatting, editor integration, CI enforcement), Biome (Rust-based unified linter/formatter), Cursor AI rules (.cursorrules, context management). Single entry point for code style infra."
verified: 2026-08
layer: domain
category: tooling
triggers: [".cursorrules", "ai coding assistant", "biome", "biome check", "biome format", "biome lint", "code format", "cursor config", "cursor ide", "cursor rules", "eslint", "eslint config", "eslint plugin", "eslint rule", "lint", "prettier", "prettier config", "prettier plugin"]
---

# Lint Format

Route linting, formatting, and editor-rule work to the tool-specific reference needed for the task.

## Reference Index

| Topic | File | When to load |
| --- | --- | --- |
| ESLint | [`references/eslint.md`](references/eslint.md) | Load for flat config, custom rules, plugins, shared configs, and CI integration. |
| Prettier | [`references/prettier.md`](references/prettier.md) | Load for formatting configuration, ignores, editor setup, hooks, plugins, and APIs. |
| Biome | [`references/biome.md`](references/biome.md) | Load for Biome configuration, linting, formatting, migration, and CI workflows. |
| Cursor Rules | [`references/cursor-rules.md`](references/cursor-rules.md) | Load for Cursor project rules, context guidance, conventions, and generated-file behavior. |
