/* Intent: own SQLite access, atomic ingestion, normalization and retained receipts.
 * Status: schema v3, SQLite leases and transactional replay migration.
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
      if (version && !['1', '2', '3', '4', '5', '6'].includes(version.value)) throw new Error('Unsupported schema version');
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
      if (version && Number(version.value) < 6) {
        this.run('UPDATE ingest_state SET offset=0, size=-1, head=NULL, session_id=NULL');
        this.run("DELETE FROM meta WHERE key IN ('parse_errors','skipped_triage','skipped_large')");
      }
      if (version?.value === '1') {
        this.exec('INSERT OR IGNORE INTO legacy_replay SELECT path FROM ingest_state;');
      }
      if (version && Number(version.value) < 3) {
        this.exec('DELETE FROM reviews; DELETE FROM ledger; DELETE FROM dispatches;');
        this.run('UPDATE ingest_state SET offset=0,session_id=NULL');
      }
      this.setMeta('schema_version', '6');
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
module.exports = { open, Store, acquireLease };
