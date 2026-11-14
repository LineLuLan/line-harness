-- Intent: private numeric facts, interned names, and durable incremental cursors.
-- Status: schema v9 (runs.spec_sha; index created after addColumn in db.js), v8 (system samples / daily system metrics / low-memory kills from the sampler JSONL,
--   ledger_runs from the ledger runs= field, runs.spec_bytes, quota window_secs, hook_limits),
--   v7 (Codex per-day deltas in codex_days, quota account, ledger task_type /
--   fail_rounds / warning, codex_sessions.account; replay once with counter reset),
--   v6 branch_ts, v5 git repo as project + branch, v4 prefix fingerprint, lease, occurrences.
--   Columns added after v1 are also added by collector/db.js (addColumn) for older databases.
-- Next: explicit migrations for subsequent versions.
-- Blockers: none. Confidence: covered by synthetic integration tests.
CREATE TABLE IF NOT EXISTS lease (
 id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL,
 token TEXT NOT NULL, started INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS names (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(kind,name)
) STRICT;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS ingest_state (
 path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL, offset INTEGER NOT NULL,
 session_id TEXT, head TEXT
) STRICT;
-- Counts represent the committed prefix of each file, reset on truncation.
CREATE TABLE IF NOT EXISTS ingest_occurrences (
 path TEXT NOT NULL, fingerprint TEXT NOT NULL, occurrences INTEGER NOT NULL,
 PRIMARY KEY(path,fingerprint)
) STRICT;
CREATE TABLE IF NOT EXISTS legacy_replay (path TEXT PRIMARY KEY) STRICT;
CREATE TABLE IF NOT EXISTS claude_sessions (
 session_id TEXT PRIMARY KEY, project INTEGER, started INTEGER, ended INTEGER,
 turns INTEGER NOT NULL DEFAULT 0, model INTEGER, branch INTEGER, branch_ts INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS claude_messages (
 message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL,
 model INTEGER NOT NULL, effort INTEGER, input INTEGER NOT NULL, output INTEGER NOT NULL,
 cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, reasoning INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS claude_messages_ts ON claude_messages(ts);
CREATE INDEX IF NOT EXISTS claude_messages_session ON claude_messages(session_id);
CREATE INDEX IF NOT EXISTS claude_messages_day ON claude_messages(day);
CREATE TABLE IF NOT EXISTS tool_calls (
 tool_use_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL,
 tool INTEGER NOT NULL, mcp_server INTEGER, skill INTEGER, subagent INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS tool_calls_ts ON tool_calls(ts);
CREATE INDEX IF NOT EXISTS tool_calls_day ON tool_calls(day);
CREATE TABLE IF NOT EXISTS hook_events (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL,
 script INTEGER NOT NULL, event INTEGER NOT NULL, status INTEGER NOT NULL,
 duration_ms INTEGER NOT NULL, exit_code INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS hook_events_ts ON hook_events(ts);
CREATE INDEX IF NOT EXISTS hook_events_day ON hook_events(day);
CREATE TABLE IF NOT EXISTS compactions (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, trigger INTEGER,
 pre_tokens INTEGER NOT NULL, post_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS human_turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS codex_sessions (
 session_id TEXT PRIMARY KEY, project INTEGER, model INTEGER NOT NULL, effort INTEGER,
 thread_source INTEGER, parent_thread_id TEXT, started INTEGER, ended INTEGER, token_ts INTEGER,
 day TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
 cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
 reasoning INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
 context_window INTEGER, duration_ms INTEGER, time_to_first_token_ms INTEGER, branch INTEGER,
 account INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS codex_sessions_day ON codex_sessions(day);
-- v7: Codex tokens spent per thread and local day = differences between consecutive cumulative
-- token_count snapshots, so a thread that runs past midnight is split. Sum over days = thread total.
CREATE TABLE IF NOT EXISTS codex_days (
 session_id TEXT NOT NULL, day TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL,
 cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, reasoning INTEGER NOT NULL,
 total_tokens INTEGER NOT NULL, PRIMARY KEY(session_id,day)
) STRICT;
CREATE INDEX IF NOT EXISTS codex_days_day ON codex_days(day);
-- v7 migration: threads whose counters restart from zero when their rollout is next read from the start.
CREATE TABLE IF NOT EXISTS codex_reseed (session_id TEXT PRIMARY KEY) STRICT;
-- account 0 = not split by account (Claude); otherwise a names id of kind 'account'.
CREATE TABLE IF NOT EXISTS quota_snapshots (
 ts INTEGER NOT NULL, source INTEGER NOT NULL, window INTEGER NOT NULL,
 used_pct REAL NOT NULL, resets_at INTEGER NOT NULL, account INTEGER NOT NULL DEFAULT 0,
 window_secs INTEGER,
 UNIQUE(source,window,account,resets_at,used_pct)
) STRICT;
-- spec_bytes (v8) = size of the run folder's stdin.txt (the packet codex-do sent); NULL = no copy.
CREATE TABLE IF NOT EXISTS runs (
 run_id TEXT PRIMARY KEY, claude_session_id TEXT, codex_session_id TEXT, project INTEGER,
 model INTEGER NOT NULL, effort INTEGER, is_resume INTEGER NOT NULL, started INTEGER NOT NULL,
 ended INTEGER, exit_code INTEGER, sandbox_failure INTEGER NOT NULL, day TEXT NOT NULL, spec_bytes INTEGER, spec_sha TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS runs_day ON runs(day);
CREATE TABLE IF NOT EXISTS dispatches (
 id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind INTEGER NOT NULL, model INTEGER NOT NULL,
 effort INTEGER, claude_session_id TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS dispatches_ts ON dispatches(ts);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, ts INTEGER NOT NULL, project INTEGER, model INTEGER, effort INTEGER,
 verdict INTEGER NOT NULL, p0 INTEGER NOT NULL, p1 INTEGER NOT NULL, p2 INTEGER NOT NULL, p3 INTEGER NOT NULL, mode TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS ledger (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, tier INTEGER, layer2 INTEGER NOT NULL, layer2_raw TEXT,
 l1_raw TEXT NOT NULL, l2_raw TEXT NOT NULL, l3_raw TEXT NOT NULL,
 l1_count INTEGER, l2_count INTEGER, l3_count INTEGER, note TEXT NOT NULL, model INTEGER,
 task_type INTEGER, fail_rounds INTEGER, warning INTEGER,
 stop INTEGER -- v8: 1 = the full note names a worker STOP (collector/ledger.js stopFlag)
) STRICT;
CREATE TABLE IF NOT EXISTS daily_tokens (
 day TEXT NOT NULL, source INTEGER NOT NULL, model INTEGER NOT NULL,
 input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
 cache_write INTEGER NOT NULL, reasoning INTEGER NOT NULL, messages INTEGER NOT NULL,
 PRIMARY KEY(day,source,model)
) STRICT;
CREATE TABLE IF NOT EXISTS daily_tools (
 day TEXT NOT NULL, tool INTEGER NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY(day,tool)
) STRICT;
CREATE TABLE IF NOT EXISTS daily_hooks (
 day TEXT NOT NULL, script INTEGER NOT NULL, event INTEGER NOT NULL, runs INTEGER NOT NULL,
 errors INTEGER NOT NULL, timeouts INTEGER NOT NULL, p95_ms INTEGER NOT NULL,
 PRIMARY KEY(day,script,event)
) STRICT;
CREATE TABLE IF NOT EXISTS daily_runs (
 day TEXT NOT NULL, model INTEGER NOT NULL, runs INTEGER NOT NULL, exit0 INTEGER NOT NULL,
 exit72 INTEGER NOT NULL, exit73 INTEGER NOT NULL, other_fail INTEGER NOT NULL,
 resumes INTEGER NOT NULL, PRIMARY KEY(day,model)
) STRICT;
-- Receipts preserve dedupe after retention without session IDs or exact times.
-- Message receipts retain token maxima so late content-block updates remain correct.
CREATE TABLE IF NOT EXISTS receipts (
 id TEXT PRIMARY KEY, kind INTEGER NOT NULL, day TEXT, model INTEGER,
 input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, reasoning INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS receipts_day ON receipts(day);
CREATE TABLE IF NOT EXISTS archived_tools (
 day TEXT NOT NULL, tool INTEGER NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY(day,tool)
) STRICT;
-- A frequency distribution, rather than one scalar percentile, preserves exact p95
-- when late historical events are added after the original raw rows expire.
CREATE TABLE IF NOT EXISTS archived_hooks (
 day TEXT NOT NULL, script INTEGER NOT NULL, event INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
 runs INTEGER NOT NULL, errors INTEGER NOT NULL, timeouts INTEGER NOT NULL,
 PRIMARY KEY(day,script,event,duration_ms)
) STRICT;
CREATE TABLE IF NOT EXISTS dirty_days (day TEXT PRIMARY KEY) STRICT;
-- v8: system sampler (collector/sample-system.js). Raw samples are kept 7 days; drives = JSON
-- [{"d":"C:","free":bytes,"total":bytes}], top = JSON [["name",MB,count]] (process names only).
CREATE TABLE IF NOT EXISTS system_samples (
 ts INTEGER PRIMARY KEY, day TEXT NOT NULL, ram_free_mb INTEGER, ram_total_mb INTEGER,
 commit_used_mb INTEGER, commit_limit_mb INTEGER, drives TEXT NOT NULL, top TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS system_samples_day ON system_samples(day);
-- Daily system metrics, kept 90 days. metric: ram_free_min_pct, ram_free_avg_pct, commit_max_pct,
-- samples (subject ''), disk_free_min_pct / disk_free_min_bytes / disk_total_bytes (subject = drive),
-- folder_bytes (subject = folder label, drive = its drive letter).
CREATE TABLE IF NOT EXISTS system_daily (
 day TEXT NOT NULL, metric TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', value REAL NOT NULL, drive TEXT,
 PRIMARY KEY(day,metric,subject)
) STRICT;
-- Windows System event 2004 (low-memory resource exhaustion): time + top process names, kept 90 days.
CREATE TABLE IF NOT EXISTS memory_kills (
 id TEXT PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, top TEXT NOT NULL
) STRICT;
-- Ledger line -> codex-do run ids from its optional runs= field (ledger-add.ps1 -RunIds).
CREATE TABLE IF NOT EXISTS ledger_runs (
 ledger_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(ledger_id,run_id)
) STRICT;
-- Hook timeouts from the hooks section of <claude>/settings.json (script file name + event only).
CREATE TABLE IF NOT EXISTS hook_limits (
 script INTEGER NOT NULL, event INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, PRIMARY KEY(script,event)
) STRICT;
