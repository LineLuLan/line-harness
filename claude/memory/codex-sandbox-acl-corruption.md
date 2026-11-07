---
name: codex-sandbox-acl-corruption
description: "Codex CLI on Windows fails every shell command with 'helper_unknown_error: apply deny-read ACLs' when ~/.codex/.sandbox/deny_read_acl_state.json is corrupted (e.g. zero bytes after a BSOD); fix = move that file and setup_error.json away, Codex recreates them"
metadata:
  type: project
---

Seen 2026-09-07 on Line's machine right after a BSOD at 01:24: every Codex worker call (codex-do.ps1, codex exec, would also hit MCP/plugin) failed before running any command with `exec_command failed: ... helper_unknown_error: apply deny-read ACLs`. The sandbox log (`~/.codex/.sandbox/sandbox.<date>.log`) showed `parse deny-read ACL state C:\Users\ADMIN\.codex\.sandbox\deny_read_acl_state.json`. The file was 22 zero bytes (NTFS write interrupted by the crash). `setup_error.json` cached the same error.

**Fix (no admin needed):** move `deny_read_acl_state.json` and `setup_error.json` out of `~/.codex/.sandbox/`, then run any `codex exec` that executes a shell command; the setup helper (`codex-windows-sandbox-setup.exe`) recreates a valid state file (`{"principals": ...}`). Verified 2026-09-07: `echo sandbox-ok` ran inside the read-only sandbox afterwards. Keep `setup_marker.json` (sandbox users CodexSandboxOffline/Online, version 5).

**How to apply:** when a worker reports this error, check that file first. Do not reinstall Codex, do not run the worker with `danger-full-access` (the Claude auto-mode classifier blocks that anyway). Open upstream issues: openai/codex #42958, #28248, #36087, #37264. See [[codex-claude-ecosystem]].

## Second failure mode, 2026-09-28: "helper_unknown_error: setup refresh had errors"
After upgrading Codex CLI to 0.157.1, every worker call failed before running a command. The sandbox log (`~/.codex/.sandbox/sandbox.<date>.log`) showed `runtime read/execute validation failed ... CreateFileW failed` on a pnpm link under `C:\Users\ADMIN\AppData\Local\OpenAI\Codex\runtimes\cua_node\...` (path length 301, over the Windows 260 limit). The 0.157 setup helper validates everything under `AppData\Local\OpenAI`, so renaming inside that tree does not help. Fix: move `runtimes\cua_node` OUT of that tree (now at `D:\Backups\codex-cua_node-20260928`), delete `~/.codex/.sandbox/setup_error.json`, run any `codex exec` shell command; verified `echo sandbox-ok`. Side effect: config.toml lines that point at cua_node (the `notify` hook and the `node_repl` MCP server, both desktop-app computer-use features) will warn until the desktop app re-downloads the runtime; the lean worker path ignores config and is unaffected. Restore by moving the folder back.
