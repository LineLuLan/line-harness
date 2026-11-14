/* Intent: own SQLite access, atomic ingestion, normalization and retained receipts.
 * Status: schema v10 (field-3 evidence and review modes; targeted log replay), v9 (packet SHA, targeted run replay), v8 (system sampler tables, ledger_runs, spec_bytes, window_secs, hook_limits; no full replay), v7 (see the addColumn steps below), SQLite leases and transactional replay migration.
 * Migration: v1/v2 automatically rebuild reviews/ledger/dispatches from source logs.
 * Other facts are kept; all cursors rewind once because old cursors lack source kinds.
 * Missing source logs cannot be rebuilt; counts refill across budgeted runs.
 * Next: keep future migrations explicit and replay-safe.
 * Blockers: none. Confidence: acceptance tests; real logs intentionally out of scope. */
'use strict';
require('./warnings');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hash, name } = require('./values');
const SCHEMA_VERSION = 10;
// Read-only peek at the stored schema version (null = no DB or no meta yet). Never migrates.
function storedVersion(file) {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='meta'").get()) return null;
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    return row ? Number(row.value) : null;
  } finally { db.close(); }
}
// Copy the whole DB (WAL included) to <dir>/hub-v<N>.bak before a migration.
function backupBeforeMigration(file, version) {
  const out = path.join(path.dirname(file), `hub-v${version}.bak`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try { db.prepare('VACUUM INTO ?').run(out); } finally { db.close(); }
  return out;
}
function open(file) {
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-8000; PRAGMA mmap_size=0; PRAGMA temp_store=FILE; PRAGMA busy_timeout=5000;');
  return db;
}
function acquireLease(file, pid, token, alive) {
  const db = new DatabaseSync(file, { timeout: 1000 });
  let transaction = false, owned = false;
  try {
    db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE;');
    transaction = true;
    // Bootstrap inside the writer transaction so even fresh-DB contenders serialize.
    db.exec(`CREATE TABLE IF NOT EXISTS lease (
      id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL,
      token TEXT NOT NULL, started INTEGER NOT NULL
    ) STRICT`);
    const holder = db.prepare('SELECT pid,started FROM lease WHERE id=1').get();
    const now = Date.now();
    if (holder && now - holder.started <= 30 * 60000 && alive(holder.pid)) {
      db.exec('ROLLBACK'); transaction = false;
      return null;
    }
    db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?,?)').run(pid, token, now);
    db.exec('COMMIT'); transaction = false; owned = true;
    return () => {
      if (!owned) return;
      try { db.prepare('DELETE FROM lease WHERE token=?').run(token); }
      finally { owned = false; db.close(); }
    };
  } catch (error) {
    if ((error.errcode & 255) === 5) return null; // SQLITE_BUSY, including extended codes.
    throw error;
  } finally {
    if (!owned) {
      try { if (transaction) db.exec('ROLLBACK'); } finally { db.close(); }
    }
  }
}
class Store {
  constructor(file) {
    this.db = open(file);
    this.statements = new Map();
    this.names = new Map();
    this.inTransaction = false;
    try {
      const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='meta'").get();
      const version = exists && this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
      if (version && !['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(version.value)) throw new Error('Unsupported schema version');
      this.begin();
      this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      const addColumn = (table, column, type) => {
        if (!this.all(`PRAGMA table_info(${table})`).some(c => c.name === column)) this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      };
      // v4: committed-prefix fingerprint. NULL for old cursors = trusted until the next commit.
      addColumn('ingest_state', 'head', 'TEXT');
      // v5: session branches. Projects become git repos, so every source is replayed once:
      // all ids are content-based and every insert is idempotent, so replay only refreshes
      // project/branch values. size=-1 also forces run.json snapshots to be re-read.
      addColumn('claude_sessions', 'branch', 'INTEGER');
      addColumn('codex_sessions', 'branch', 'INTEGER');
      // v6: branch_ts (newest branch wins in any order), review projects upserted, Codex token
      // snapshots guarded by time. Replay once more; line counters are reset first because a
      // replay re-counts every line (v5 doubled them).
      addColumn('claude_sessions', 'branch_ts', 'INTEGER');
      // v7: Codex account per thread and per quota snapshot, parsed ledger fields, per-day Codex deltas.
      addColumn('codex_sessions', 'account', 'INTEGER');
      for (const column of ['task_type', 'fail_rounds', 'warning']) addColumn('ledger', column, 'INTEGER');
      if (!this.all('PRAGMA table_info(quota_snapshots)').some(c => c.name === 'account')) {
        // The UNIQUE key gains the account, which needs a table rebuild. Existing Codex rows came from
        // the default Codex home (the only one read before v7); Claude rows have no account (0).
        const codex = this.intern('source', 'codex'), fallback = this.intern('account', 'default');
        this.exec(`CREATE TABLE quota_snapshots_v7 (
          ts INTEGER NOT NULL, source INTEGER NOT NULL, window INTEGER NOT NULL,
          used_pct REAL NOT NULL, resets_at INTEGER NOT NULL, account INTEGER NOT NULL DEFAULT 0,
          UNIQUE(source,window,account,resets_at,used_pct)) STRICT`);
        this.run(`INSERT OR IGNORE INTO quota_snapshots_v7 (ts,source,window,used_pct,resets_at,account)
          SELECT ts,source,window,used_pct,resets_at,CASE WHEN source=? THEN ? ELSE 0 END FROM quota_snapshots`, codex, fallback);
        this.exec('DROP TABLE quota_snapshots; ALTER TABLE quota_snapshots_v7 RENAME TO quota_snapshots;');
      }
      // v8: quota window length (Codex window_minutes; Claude windows are fixed) and the packet size of a run.
      addColumn('quota_snapshots', 'window_secs', 'INTEGER');
      addColumn('runs', 'spec_bytes', 'INTEGER');
      addColumn('ledger', 'stop', 'INTEGER');
      // Intent: retain evidence and review mode without losing v9 rows. Status: v10.
      // Next: collect consumes the replay flag. Blockers: none. Confidence: tests/v10.test.js.
      addColumn('ledger', 'layer2_raw', 'TEXT');
      addColumn('reviews', 'mode', 'TEXT');
      if (version && Number(version.value) < 10) this.setMeta('v10_review_replay', '1');
      // v9: packet identity for same-packet A/B comparisons. Index follows ALTER on older DBs.
      addColumn('runs', 'spec_sha', 'TEXT');
      this.exec('CREATE INDEX IF NOT EXISTS runs_spec_sha ON runs(spec_sha)');
      if (version && Number(version.value) < 9) this.setMeta('v9_run_replay', '1');
      // v8 needs no full replay. Two one-time re-reads are flagged here and done by collect.js, which knows
      // the source paths: v8_run_replay = only the run.json snapshot cursors are reset (spec_bytes), and
      // v8_ledger_replay = the ledger is re-read from the start (runs= -> ledger_runs, stop; rows upsert).
      if (version && Number(version.value) < 8) {
        this.setMeta('v8_run_replay', '1');
        this.setMeta('v8_ledger_replay', '1');
      }
      // v6 and v7 replay every source once. Line counters are reset first because a replay re-counts
      // every line. v7 also re-binds forked Codex rollouts, removes sub-agent / tag-only human turns
      // and re-parses the ledger (rows are upserted by content id, so nothing doubles).
      if (version && Number(version.value) < 7) {
        this.run('UPDATE ingest_state SET offset=0, size=-1, head=NULL, session_id=NULL');
        this.run("DELETE FROM meta WHERE key IN ('parse_errors','skipped_triage','skipped_large','ledger_warnings')");
        // Codex: keep each thread's old total as one day row until its rollout is replayed (a rollout
        // that no longer exists keeps the v6 number); the replay then rebuilds it from zero as deltas.
        this.run(`INSERT OR IGNORE INTO codex_days SELECT session_id,day,input,output,cache_read,cache_write,reasoning,total_tokens
          FROM codex_sessions WHERE token_ts IS NOT NULL`);
        this.run('INSERT OR IGNORE INTO codex_reseed SELECT session_id FROM codex_sessions');
        this.run('UPDATE codex_sessions SET account=? WHERE account IS NULL', this.intern('account', 'default'));
      }
      if (version?.value === '1') {
        this.exec('INSERT OR IGNORE INTO legacy_replay SELECT path FROM ingest_state;');
      }
      if (version && Number(version.value) < 3) {
        this.exec('DELETE FROM reviews; DELETE FROM ledger; DELETE FROM dispatches;');
        this.run('UPDATE ingest_state SET offset=0,session_id=NULL');
      }
      this.setMeta('schema_version', String(SCHEMA_VERSION));
      this.commit();
      this.hasReceipts = Boolean(this.get('SELECT 1 FROM receipts LIMIT 1'));
    } catch (error) { this.db.close(); throw error; }
  }
  stmt(sql) {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  run(sql, ...args) { return this.stmt(sql).run(...args); }
  get(sql, ...args) { return this.stmt(sql).get(...args); }
  all(sql, ...args) { return this.stmt(sql).all(...args); }
  iter(sql, ...args) { return this.stmt(sql).iterate(...args); }
  exec(sql) { this.db.exec(sql); }
  begin() { if (!this.inTransaction) { this.exec('BEGIN IMMEDIATE'); this.inTransaction = true; } }
  commit() { if (this.inTransaction) { this.exec('COMMIT'); this.inTransaction = false; } }
  rollback() { if (this.inTransaction) { this.exec('ROLLBACK'); this.inTransaction = false; this.names.clear(); } }
  meta(key) { return this.get('SELECT value FROM meta WHERE key=?', key)?.value; }
  setMeta(key, value) { this.run('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  addMeta(key, n) { this.setMeta(key, Number(this.meta(key) || 0) + n); }
  intern(kind, value) {
    const text = name(value);
    if (text === null) return null;
    const key = `${kind}:${text}`;
    if (this.names.has(key)) return this.names.get(key);
    this.run('INSERT OR IGNORE INTO names(kind,name) VALUES (?,?)', kind, text);
    const id = this.get('SELECT id FROM names WHERE kind=? AND name=?', kind, text).id;
    if (this.names.size >= 256) this.names.clear();
    this.names.set(key, id);
    return id;
  }
  touch(day) { if (day) this.run('INSERT OR IGNORE INTO dirty_days VALUES (?)', day); }
  insert(table, record, conflict = 'DO NOTHING') {
    if (table === 'receipts') this.hasReceipts = true;
    const keys = Object.keys(record);
    return this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT ${conflict}`,
      ...keys.map(k => record[k] ?? null));
  }
  state(key) { return this.get('SELECT * FROM ingest_state WHERE path=?', key); }
  cursor(key, size, mtime, offset, session, head = null) {
    this.run(`INSERT INTO ingest_state (path,size,mtime_ms,offset,session_id,head) VALUES (?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
      size=excluded.size, mtime_ms=excluded.mtime_ms, offset=excluded.offset, session_id=excluded.session_id, head=excluded.head`,
    key, size, mtime, offset, session || null, head);
  }
  message(record) {
    const id = this.hasReceipts ? hash(`message:${record.message_id}`) : null;
    const old = id && this.get('SELECT * FROM receipts WHERE id=?', id);
    const fields = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];
    if (old) {
      this.run(`UPDATE receipts SET ${fields.map(k => `${k}=MAX(${k},?)`).join(',')} WHERE id=?`,
        ...fields.map(k => record[k]), id);
      this.touch(old.day);
    } else {
      this.insert('claude_messages', record, `(message_id) DO UPDATE SET ${fields.map(k => `${k}=MAX(${k},excluded.${k})`).join(',')}`);
      this.touch(this.get('SELECT day FROM claude_messages WHERE message_id=?', record.message_id).day);
    }
  }
  event(table, record, key, kind) {
    if (this.hasReceipts && this.get('SELECT 1 FROM receipts WHERE id=?', hash(`${kind}:${record[key]}`))) return;
    if (this.insert(table, record).changes) this.touch(record.day);
  }
  close() { this.rollback(); this.db.close(); }
}
module.exports = { open, Store, acquireLease, SCHEMA_VERSION, storedVersion, backupBeforeMigration };
