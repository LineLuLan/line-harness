-- Intent: private numeric facts, interned names, and durable incremental cursors.
-- Status: schema v6 (v5 git repo as project + branch; v6 branch_ts, replay with counter reset),
--   v4 prefix fingerprint, lease, occurrences.
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
 context_window INTEGER, duration_ms INTEGER, time_to_first_token_ms INTEGER, branch INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS codex_sessions_day ON codex_sessions(day);
CREATE TABLE IF NOT EXISTS quota_snapshots (
 ts INTEGER NOT NULL, source INTEGER NOT NULL, window INTEGER NOT NULL,
 used_pct REAL NOT NULL, resets_at INTEGER NOT NULL,
 UNIQUE(source,window,resets_at,used_pct)
) STRICT;
CREATE TABLE IF NOT EXISTS runs (
 run_id TEXT PRIMARY KEY, claude_session_id TEXT, codex_session_id TEXT, project INTEGER,
 model INTEGER NOT NULL, effort INTEGER, is_resume INTEGER NOT NULL, started INTEGER NOT NULL,
 ended INTEGER, exit_code INTEGER, sandbox_failure INTEGER NOT NULL, day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS runs_day ON runs(day);
CREATE TABLE IF NOT EXISTS dispatches (
 id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind INTEGER NOT NULL, model INTEGER NOT NULL,
 effort INTEGER, claude_session_id TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS dispatches_ts ON dispatches(ts);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, ts INTEGER NOT NULL, project INTEGER, model INTEGER, effort INTEGER,
 verdict INTEGER NOT NULL, p0 INTEGER NOT NULL, p1 INTEGER NOT NULL, p2 INTEGER NOT NULL, p3 INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS ledger (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, tier INTEGER, layer2 INTEGER NOT NULL,
 l1_raw TEXT NOT NULL, l2_raw TEXT NOT NULL, l3_raw TEXT NOT NULL,
 l1_count INTEGER, l2_count INTEGER, l3_count INTEGER, note TEXT NOT NULL, model INTEGER
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
