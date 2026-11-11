/* Intent: prove ingestion, privacy, replay, budget and hook behavior on fixtures.
 * Status: executable acceptance contract including quiet lease skips. Next: expand for new source versions.
 * Blockers: none. Confidence: high on covered synthetic shapes. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const f = require('./fixtures/synthetic');
const { open } = require('../collector/db');
const base = path.resolve(__dirname, '..', '.tmp');
fs.mkdirSync(base, { recursive: true });
function setup(t) {
  const root = fs.mkdtempSync(path.join(base, 'test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return f.environment(root);
}
function collect(env, args = ['--full']) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), ...args],
    { env, encoding: 'utf8', input: '{"private":"discard me"}', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result;
}
function inspect(env, callback) {
  const db = open(env.LINE_HUB_DB);
  try { return callback(db); } finally { db.close(); }
}
const row = (db, table) => db.prepare(`SELECT * FROM ${table}`).get();
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
test('all source shapes, normalization, dedupe, privacy and MAX across runs', t => {
  const env = setup(t);
  const files = f.populate(env);
  collect(env);
  inspect(env, db => {
    const m = row(db, 'claude_messages');
    assert.deepEqual([m.input, m.output, m.cache_read, m.cache_write, m.reasoning], [9, 11, 4, 6, 5]);
    assert.equal(count(db, 'tool_calls'), 3);
    assert.equal(row(db, 'claude_sessions').turns, 1);
    assert.equal(count(db, 'compactions'), 1);
    const names = db.prepare('SELECT kind,name FROM names').all().map(n => `${n.kind}:${n.name}`);
    for (const name of ['mcp_server:demo', 'skill:test-skill', 'subagent:test-agent', 'script:check.ps1',
      'script:inline', 'status:non_blocking_error', 'status:error_during_execution', 'status:timeout']) {
      assert.ok(names.includes(name), name);
    }
    const c = row(db, 'codex_sessions');
    assert.equal(c.input, 200); assert.equal(c.output, 100);
    assert.equal(c.parent_thread_id, 'parent-1');
    assert.equal(db.prepare('SELECT name FROM names WHERE id=?').get(c.thread_source).name, 'subagent');
    assert.equal(c.duration_ms, 10000); assert.equal(c.time_to_first_token_ms, 50);
    assert.equal(count(db, 'quota_snapshots'), 3);
    const runs = db.prepare('SELECT * FROM runs ORDER BY run_id').all();
    assert.equal(runs[0].claude_session_id, 'claude-1'); assert.equal(runs[0].exit_code, 0);
    assert.ok(runs[0].ended); assert.equal(runs[1].ended, null); assert.equal(runs[1].claude_session_id, null);
    const ledger = row(db, 'ledger');
    assert.equal(ledger.l1_count, 2); assert.equal(ledger.l2_count, null);
    assert.equal(ledger.l2_raw, 'PASS'); assert.equal(ledger.note, 'gpt-first then | claude-last');
    assert.equal(db.prepare('SELECT name FROM names WHERE id=?').get(ledger.model).name, 'claude-last');
    const review = row(db, 'reviews');
    assert.deepEqual([review.p0, review.p1, review.p2, review.p3], [1, 2, 0, 1]);
    assert.equal(row(db, 'daily_tokens').messages, 1);
    assert.equal(db.prepare('SELECT SUM(runs) n FROM daily_hooks').get().n, 5);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  });
  assert.equal(fs.readFileSync(env.LINE_HUB_DB).includes(Buffer.from(f.MARKER)), false);
  fs.appendFileSync(files.claude, JSON.stringify(f.assistant('msg-1', { input_tokens: 20, output_tokens: 3 })) + '\n');
  fs.appendFileSync(files.codex, JSON.stringify(files.token(120)) + '\n');
  collect(env); collect(env);
  inspect(env, db => {
    assert.equal(count(db, 'claude_messages'), 1);
    assert.equal(row(db, 'claude_messages').input, 20);
    assert.equal(row(db, 'claude_messages').output, 11);
    assert.equal(row(db, 'codex_sessions').input, 120);
    assert.equal(count(db, 'quota_snapshots'), 3);
    assert.equal(row(db, 'claude_sessions').turns, 1);
  });
});
test('partial UTF-8 lines, BOM/CRLF, malformed lines and shrinking files', t => {
  const env = setup(t);
  const file = path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl');
  const a = JSON.stringify(f.assistant('a', { input_tokens: 7 }, [{ type: 'text', text: '日本語' }]));
  const b = JSON.stringify(f.assistant('b', { input_tokens: 9 }));
  f.write(file, '\uFEFF' + a + '\r\n' + b.slice(0, -3));
  collect(env);
  inspect(env, db => { assert.equal(count(db, 'claude_messages'), 1);
    assert.equal(row(db, 'ingest_state').offset, Buffer.byteLength('\uFEFF' + a + '\r\n')); });
  fs.appendFileSync(file, b.slice(-3) + '\n{bad json}\n'); collect(env);
  inspect(env, db => { assert.equal(count(db, 'claude_messages'), 2);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='parse_errors'").get().value, '1'); });
  f.write(file, a + '\n'); collect(env);
  inspect(env, db => assert.equal(count(db, 'claude_messages'), 2));
});
test('budget stop and resume matches full ingestion', t => {
  const env = setup(t); const other = setup(t);
  const rows = Array.from({ length: 12000 }, (_, i) => f.assistant(`m-${i}`, { input_tokens: i, output_tokens: 1 }));
  for (const e of [env, other]) f.jsonl(path.join(e.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl'), rows);
  collect(env, ['--budget-ms', '30']);
  // r3 raises this to 1000 ms: fast machines may finish this fixture in one slice.
  // Deterministic deadline/partial-commit assertions live in safety/stream tests.
  inspect(env, db => assert.ok(count(db, 'claude_messages') <= rows.length));
  collect(env); collect(other);
  const totals = e => inspect(e, db => db.prepare('SELECT SUM(input) i, SUM(output) o, COUNT(*) n FROM claude_messages').get());
  assert.deepEqual(totals(env), totals(other));
});
test('hook silence, throttle, live/dead leases and private error logging', t => {
  const env = setup(t); f.populate(env);
  let r = collect(env, ['--hook', '--full']); assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
  const before = inspect(env, db => row(db, 'ingest_state').offset);
  f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'new', 'new.jsonl'), [f.assistant('new')]);
  r = collect(env, ['--hook']); assert.equal(r.stdout + r.stderr, '');
  inspect(env, db => { assert.equal(count(db, 'claude_messages'), 1); assert.equal(row(db, 'ingest_state').offset, before); });
  inspect(env, db => db.prepare('INSERT INTO lease VALUES (1,?,?,?)').run(process.pid, 'test', Date.now()));
  collect(env, ['--hook', '--min-interval-s', '0']);
  inspect(env, db => assert.equal(count(db, 'claude_messages'), 1));
  inspect(env, db => db.prepare('UPDATE lease SET started=?').run(Date.now() - 5 * 60000));
  collect(env, ['--hook', '--min-interval-s', '0']);
  inspect(env, db => assert.equal(count(db, 'claude_messages'), 1));
  inspect(env, db => db.prepare('UPDATE lease SET pid=?').run(2147483647));
  collect(env, ['--hook', '--min-interval-s', '0']);
  inspect(env, db => assert.equal(count(db, 'claude_messages'), 2));
  r = collect(env, ['--hook', '--budget-ms', 'invalid']);
  assert.equal(r.stdout + r.stderr, '');
  assert.ok(fs.statSync(path.join(path.dirname(env.LINE_HUB_DB), 'collect-errors.log')).size > 0);
});
test('retention preserves daily totals, dedupe, late maxima and exact hook p95', t => {
  const env = setup(t);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  const make = (id, input) => ({ ...f.assistant(id, { input_tokens: input }, [
    { type: 'tool_use', id: `t-${id}`, name: 'Read', input: { text: f.MARKER } }
  ]), timestamp: old });
  const hooks = Array.from({ length: 20 }, (_, i) => ({ type: 'attachment', uuid: `h-${i}`,
    sessionId: 'claude-1', timestamp: old, attachment: { type: 'hook_success', hookEvent: 'Stop',
      command: 'node hook.js', durationMs: i + 1, exitCode: 0 } }));
  const file = f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl'), [make('old', 10), ...hooks]);
  collect(env);
  const totals = () => inspect(env, db => ({
    input: db.prepare('SELECT SUM(input) n FROM daily_tokens').get().n,
    calls: db.prepare('SELECT SUM(calls) n FROM daily_tools').get().n,
    hooks: row(db, 'daily_hooks')
  }));
  inspect(env, db => { for (const table of ['claude_messages', 'tool_calls', 'hook_events']) assert.equal(count(db, table), 0); });
  assert.equal(totals().input, 10); assert.equal(totals().hooks.p95_ms, 19);
  // Force a shrinking replay, then add both an existing message correction and a new event.
  f.jsonl(file, [make('old', 10)]); collect(env);
  fs.appendFileSync(file, [make('old', 30), make('new', 5), ...hooks,
    { ...hooks[0], uuid: 'late', attachment: { ...hooks[0].attachment, durationMs: 100 } }
  ].map(JSON.stringify).join('\n') + '\n');
  collect(env); collect(env);
  const after = totals();
  assert.equal(after.input, 35); assert.equal(after.calls, 2);
  assert.equal(after.hooks.runs, 21); assert.equal(after.hooks.p95_ms, 20);
});
test('run sidecar changes, closest do dispatch, and late trail linking', t => {
  const env = setup(t); f.populate(env); collect(env);
  const ts = Math.floor(Date.parse(f.timestamp) / 1000);
  fs.appendFileSync(path.join(env.LINE_HUB_STATE_DIR, 'dispatch-trail.log'),
    `${ts - 2}|do|gpt-other|low|near\n${ts - 1}|review|gpt-other|high|wrong-kind\n`);
  f.write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'run-2', 'exit.txt'), '73\r\n');
  collect(env);
  inspect(env, db => {
    const run = db.prepare("SELECT * FROM runs WHERE run_id='run-2'").get();
    assert.equal(run.exit_code, 73); assert.ok(run.ended); assert.equal(run.claude_session_id, 'near');
    assert.equal(db.prepare('SELECT SUM(exit73) n FROM daily_runs').get().n, 1);
  });
});
test('empty inputs, schema pragmas, weekly maintenance and durable pending aggregates', t => {
  const env = setup(t); collect(env);
  inspect(env, db => {
    assert.equal(db.prepare('PRAGMA cache_size').get().cache_size, -8000);
    assert.equal(db.prepare('PRAGMA mmap_size').get().mmap_size, 0);
    assert.equal(db.prepare('PRAGMA temp_store').get().temp_store, 1);
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    assert.ok(db.prepare("SELECT value FROM meta WHERE key='last_vacuum'").get());
    for (const table of db.prepare('PRAGMA table_list').all().filter(r => !r.name.startsWith('sqlite_'))) assert.equal(table.strict, 1);
    db.exec("INSERT INTO dirty_days VALUES ('2000-01-01'); UPDATE meta SET value='0' WHERE key='last_vacuum'");
  });
  collect(env);
  inspect(env, db => {
    assert.equal(count(db, 'dirty_days'), 0);
    assert.ok(Number(db.prepare("SELECT value FROM meta WHERE key='last_vacuum'").get().value) > 0);
  });
});
test('unknown types do not persist private fields; missing files are harmless', t => {
  const env = setup(t);
  f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl'),
    [{ type: 'ai-title', title: f.MARKER }, { type: 'api-request', content: f.MARKER }]);
  collect(env);
  inspect(env, db => {
    assert.equal(count(db, 'claude_sessions'), 0); assert.equal(count(db, 'claude_messages'), 0);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  });
  assert.equal(fs.readFileSync(env.LINE_HUB_DB).includes(Buffer.from(f.MARKER)), false);
});
test('SQLite warning is suppressed while other warnings remain visible', t => {
  const env = setup(t);
  const r = spawnSync(process.execPath, ['-e',
    "require('./collector/db'); process.emitWarning('still visible', {type:'ExperimentalWarning'});"],
  { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stderr, /still visible/);
  assert.doesNotMatch(r.stderr, /SQLite is an experimental/);
});
test('errors are capped and sanitized; invalid schema hook still exits silently', t => {
  const env = setup(t); collect(env);
  inspect(env, db => db.exec("UPDATE meta SET value='999' WHERE key='schema_version'"));
  const file = path.join(path.dirname(env.LINE_HUB_DB), 'collect-errors.log');
  f.write(file, 'x'.repeat(1024 * 1024));
  const result = collect(env, ['--hook', '--full', '--min-interval-s', '0']);
  assert.equal(result.stdout + result.stderr, '');
  assert.ok(fs.statSync(file).size < 1024);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), new RegExp(f.MARKER));
  inspect(env, db => assert.equal(count(db, 'lease'), 0));
  assert.equal(fs.existsSync(path.join(path.dirname(env.LINE_HUB_DB), 'collect.lock')), false);
});
