---
name: background-task-keepalive
description: "User rule: when background work is launched mid-task, keep the session alive until it finishes, then continue — never end the turn with work still running"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5e428186-d924-416f-ac64-ff396708317c
  modified: 2026-07-31T10:54:31.954Z
---

User directive (2026-07-31): if anything is launched to run in the background during a task
(build, long test, dev server, CI/deploy watcher, sub-agent, delegated `codex exec`, background
Bash/PowerShell task), the session must be KEPT ALIVE until that background work completes —
then report its real result and continue the remaining steps.

**Why:** the user has been left with turns that ended while background work was still running,
so nobody was around to see it finish or act on the result.

**How to apply:**
- Never end a turn or say "done" while a harness-tracked background task is running — wait for
  its completion notification (it re-invokes the session), then continue.
- For external processes the harness can't track (CI runs, deploys, detached processes), poll or
  tail logs at an interval matched to how fast the state changes; use Monitor/ScheduledWakeup
  mechanisms when available instead of abandoning the wait.
- On completion, report the actual outcome (including failures) before moving on.
- Rule is also codified for both tools in `~/.codex/AGENTS.md` §7 (Background work keep-alive).

Related: [[codex-agents-rules]], [[codex-claude-ecosystem]].
