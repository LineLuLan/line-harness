---
name: codex-desktop-lag-cleanup
description: "Codex desktop lag root cause = giant session JSONLs in ~/.codex/sessions; cleanup 2026-08-06, user keeps sessions from 20/7 onward"
metadata: 
  node_type: memory
  type: project
  originSessionId: eee0bc77-bcd9-4493-b4c8-247bf561588b
  modified: 2026-08-05T18:16:45.238Z
---

2026-08-06: Codex desktop lag diagnosed — conversations are single JSONL rollouts in `~/.codex/sessions/YYYY/MM/DD/`; files of 60–183 MB make old-conversation loads slow, and a 295 MB `logs_2.sqlite` slowed startup. Cleanup done: deleted 86 sessions created before 2026-07-20 and untouched since (0.55 GB), log DBs (349 MB incl. stale June copy in `~/.codex/sqlite`), `.tmp` (195 MB), plugin cache (47 MB), Electron caches in `%APPDATA%\Codex\web\Codex` (112 MB). Round 2 (same day, user approved): deleted 187 batch sessions created 25–31/7 (7.8 GB — parallel audit/fix fleets whose files are >50% duplicated `compacted` context snapshots), pruned 277 ghost entries from `session_index.jsonl` (backup: `.bak-cleanup`), old desktop logs in `%LOCALAPPDATA%\Codex\Logs` (82 MB), webview partition caches (121 MB). Result: sessions 8.8 GB → 470 MB (65 files), `~/.codex` 9.4 → 1.6 GB. Still present by user choice: 183 MB marathon thread "Build backend LLM evaluation" (advised to close and start new threads), `archived_sessions` 72 MB, stale `~/.codex/packages/standalone/0.135.0` 242 MB (May-era standalone CLI, not on PATH — optional delete). Heaviness mechanism to remember: Codex appends a full context snapshot per compaction and child sessions inherit the parent's compacted blob. Related: [[codex-setup-overview]]
