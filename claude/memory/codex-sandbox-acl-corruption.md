---
name: codex-sandbox-acl-corruption
description: "Codex CLI on Windows fails every shell command with 'helper_unknown_error: apply deny-read ACLs' when ~/.codex/.sandbox/deny_read_acl_state.json is corrupted (e.g. zero bytes after a BSOD); fix = move that file and setup_error.json away, Codex recreates them"
metadata:
  node_type: memory
  type: project
  originSessionId: ea625a11-9d35-4bcd-9eab-c3b3d804ee03
  modified: 2026-11-14T17:22:37.279Z
---

Seen 2026-09-07 on Line's machine right after a BSOD at 01:24: every Codex worker call (codex-do.ps1, codex exec, would also hit MCP/plugin) failed before running any command with `exec_command failed: ... helper_unknown_error: apply deny-read ACLs`. The sandbox log (`~/.codex/.sandbox/sandbox.<date>.log`) showed `parse deny-read ACL state C:\Users\ADMIN\.codex\.sandbox\deny_read_acl_state.json`. The file was 22 zero bytes (NTFS write interrupted by the crash). `setup_error.json` cached the same error.

**Fix (no admin needed):** move `deny_read_acl_state.json` and `setup_error.json` out of `~/.codex/.sandbox/`, then run any `codex exec` that executes a shell command; the setup helper (`codex-windows-sandbox-setup.exe`) recreates a valid state file (`{"principals": ...}`). Verified 2026-09-07: `echo sandbox-ok` ran inside the read-only sandbox afterwards. Keep `setup_marker.json` (sandbox users CodexSandboxOffline/Online, version 5).

**How to apply:** when a worker reports this error, check that file first. Do not reinstall Codex, do not run the worker with `danger-full-access` (the Claude auto-mode classifier blocks that anyway). Open upstream issues: openai/codex #42958, #28248, #36087, #37264. See [[codex-claude-ecosystem]].

## Second failure mode, 2026-09-28: "helper_unknown_error: setup refresh had errors"
After upgrading Codex CLI to 0.157.1, every worker call failed before running a command. The sandbox log (`~/.codex/.sandbox/sandbox.<date>.log`) showed `runtime read/execute validation failed ... CreateFileW failed` on a pnpm link under `C:\Users\ADMIN\AppData\Local\OpenAI\Codex\runtimes\cua_node\...` (path length 301, over the Windows 260 limit). The 0.157 setup helper validates everything under `AppData\Local\OpenAI`, so renaming inside that tree does not help. Fix: move `runtimes\cua_node` OUT of that tree (now at `D:\Backups\codex-cua_node-20260928`), delete `~/.codex/.sandbox/setup_error.json`, run any `codex exec` shell command; verified `echo sandbox-ok`. Side effect: config.toml lines that point at cua_node (the `notify` hook and the `node_repl` MCP server, both desktop-app computer-use features) will warn until the desktop app re-downloads the runtime; the lean worker path ignores config and is unaffected. Restore by moving the folder back.

## Third failure mode, 2026-11-14: "Access denied" writing only some folders
Worker writes failed in line-harness/hub/{collector,tests,.tmp} but worked in hub/web and claude/. Cause: those folders were created by the OLD sandbox account and are owned by `LINE\CodexSandboxOffline`; the setup helper (runs as non-elevated ADMIN) cannot propagate the new capability-SID ACEs into folders it does not own, so they keep stale SIDs. Diagnose without quota: `codex sandbox -c 'sandbox_mode="workspace-write"' -- powershell -NoProfile -File probe.ps1` (Set-Content per folder), and `(Get-Acl dir).Owner`. Fix needs Admin: `icacls <dir> /setowner "LINE\ADMIN" /T /C /Q` then `icacls <dir> /reset /T /C /Q` (only on affected folders, not repo roots). Verified on hub/ 2026-11-14 (9/9 folders writable after). 44 more affected folders found in other repos under D:\01_Workspaces (TwoHearts, Research, inel, Olist-Mercury...).
Variant 2026-11-15: a run with `-Dir <repo>\hub` got EPERM on hub/tests/v9.test.js, a file an earlier run created with `-Dir <repo>` (owner CodexSandboxOffline, only the root workspace's capability SIDs inherited). Rule: always dispatch with the repo root as -Dir; no parallel subfolder runs in one repo. Admin fix for existing files = same setowner + reset.
