# UserPromptSubmit hook: inject the mandatory team delegation rule into context.

$reminder = @'
[CODEX-DELEGATION - MANDATORY HARD RULE]
Non-trivial coding (multi-file, >~50 LOC, schema/migration/API/UI implementation, library integration, or a large refactor) MUST be dispatched to the Codex worker, not done inline with Edit/Write.

Dispatch paths:
  1. One-shot bounded tasks: use the team helper script codex-do.ps1 for a lean run without MCP. Pass multi-line specifications through stdin or a spec file, never on the command line.
  2. Long or open-ended tasks: use Agent(subagent_type: codex:codex-rescue) with --background, then poll /codex:status <jobId>. Use /codex:cancel only when .job.updatedAt is unchanged for 5 or more minutes while status is running. An active long job is not a zombie.

Parallelize only when write scopes are fully disjoint file paths. Bundle overlapping scopes into one worker.
Return worker output verbatim. Verify it against the task packet checklist; do not trust self-report.

Current docs: when an answer, packet, or edit depends on a library, SDK, framework, CLI, or external API, call context7 first (resolve-library-id, then query-docs) - training data is stale. Every codex-do packet needs a line 'DOCS CHECKED: <lib> <version> via context7 <date>' or 'DOCS CHECKED: n/a - <reason>' (a PreToolUse hook blocks dispatches without it).

Inline Edit/Write is only for surgical fixes (<50 LOC, 1-2 files) or verification-tied tweaks. Target about a 30/70 supervisor/worker mix.

See AGENTS.md section 3 for the full protocol.
'@

[Console]::Out.WriteLine($reminder)
exit 0
