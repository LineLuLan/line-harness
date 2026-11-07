---
name: harness-worker-deaths
description: "2026-10-09 root cause of workers dying with 0xC000013A under Claude Code, verified by experiment; fix = WMI-detached launch in codex-do"
metadata:
  node_type: memory
  type: project
  originSessionId: 9735a2d7-8039-4e01-be5c-698d96e69807
  modified: 2026-10-09T17:48:53.299Z
---

Symptom (another session, 2026-10-09): 4 long workers died with 0xC000013A; watchers stopped with "system is running low on memory"; the same worker run from Warp lived 32 min.

Experiment (this session, 2026-10-09): heartbeat processes started from a normal foreground PowerShell command survived new commands, a timed-out command, and stopping another task. Processes started FROM a background task with Start-Process (-NoNewWindow or -WindowStyle Hidden) DIED when that background task was stopped. A process started from the same background task with `Invoke-CimMethod Win32_Process Create` SURVIVED. So Claude Code kills the background task's whole process tree when the task stops (Esc, session end, low memory).

WMI-created processes do not inherit the caller's env vars (set PATH/CODEX_HOME explicitly) but honor CurrentDirectory.

Also: Codex `resume` fails for sessions that spawned sub-agents ("cannot resume an unloaded multi-agent v2 sub-agent"); `--disable multi_agent --disable multi_agent_v2` works on exec and resume.

FIXED and installed 2026-10-10: codex-do default detached mode (WMI + run folder under ~/.claude/state/runs, -Attach, -Cancel via tree.json exact-PID, -Attached fallback), sub-agents disabled by default, legacy-lock compatibility. Real test: a worker launched from a background task survived TaskStop and -Attach returned its result. Backup of the pre-change script: `D:\Backups\codex-do.ps1.bak-20261010-detach`. Review took 3 rounds (Astra + Fable each); PS 5.1 gotcha found: `ConvertFrom-Json` emits a JSON array as ONE object — unroll with `| ForEach-Object { $_ }`. Both review P2s fixed 2026-10-10 (cmd quoting, cancel of finished runs stops leftover descendants). .wslconfig already caps WSL at 3.5 GB. Line approved items 1, 5, 6, 7; item 2 needed no change (cap already in place).

**How to apply:** never launch long-lived processes via Start-Process inside a background tool call; use codex-do (detached) or WMI. Related: [[codex-multi-turn]], [[ram-leak-investigation]].
