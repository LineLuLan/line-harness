---
description: Run a fail-closed pre-deployment readiness review covering repository checks, configuration, rollback, observability, and approval evidence.
verified: 2026-08
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(python:*), Bash(pytest:*), AskUserQuestion
---

# Pre-Deploy Review

Review deployment readiness without triggering a deployment.

## Scope

1. Identify the target environment, artifact, branch, and commit.
2. Read repository deployment instructions and required approval rules.
3. Inspect the working tree and release diff for unrelated or sensitive files.
4. Run the repository-defined lint, typecheck, test, and build commands.
5. Confirm configuration variable names exist without reading secret values.
6. Confirm migration, rollback, monitoring, and incident ownership plans.

## Stop Conditions

- A required check fails or was not run.
- Target environment, artifact, or commit is ambiguous.
- Backup, rollback, approval, or monitoring evidence is missing.
- The action would deploy, publish, merge, or trigger a workflow without explicit authorization.

## Report

Return `READY` only when every required check passed and all evidence is present. Otherwise return
`NOT READY`, list each blocker with its source path, and state the smallest next action. Do not
deploy, publish, merge, push, or trigger workflows from this command.
