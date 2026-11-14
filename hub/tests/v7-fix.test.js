/* Intent: regression tests for the Packet A fix round (independent review of v7).
 * Status: synthetic fixtures only. Covers: FAIL word boundaries, worker= normalisation, key=value
 *   spacing / unknown keys, date validation, findings cap, ledger_warnings on replay, pacing under a
 *   day, parent cycles in run tokens, and the hook-mode migration guard (skip in a hook, backup + migrate
 *   on --full / --migrate). Counter-drop clamping is in v7.test.js (#3).
 * Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { parseLedger, failRounds } = require('../collector/ledger');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

function root(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'v7fix-'));
  // after() hooks run in order: close every store opened through `opened` before removing the folder.
  const opened = [];
  t.after(() => { for (const s of opened) try { s.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  root.opened = opened;
  return dir;
}
const storeIn = dir => { const s = new Store(path.join(dir, 'hub.db')); root.opened.push(s); return s; };

test('P2-1 fail-open / fail-closed / FAILED are not FAIL rounds', () => {
  assert.equal(failRounds('cache is fail-open on error'), 0);
  assert.equal(failRounds('guard stays fail-closed'), 0);
  assert.equal(failRounds('FAILED to start, FAIL-safe'), 0);
  assert.equal(failRounds('Fable FAIL (P1), then FAIL x2'), 3);
  assert.equal(parseLedger('2026-11-12|Important|yes|0|0|0|made the hook fail-open (worker opus)').row.fail_rounds, 0);
});

test('P2-2 worker= is normalised like a note phrase', () => {
  const m = w => parseLedger(`2026-11-12|Standard|no|0|0|0|x|worker=${w}`).row.model;
  assert.equal(m('gpt-6-astra high'), 'gpt-6-astra');
  assert.equal(m('Opus 5.5'), 'opus');
  assert.equal(m('Sol'), 'gpt-6-sol');
  assert.equal(m('some-new-model'), 'some-new-model');
});

test('P3-5/7 key=value spacing, unknown keys, date validation, findings cap', () => {
  const a = parseLedger('2026-11-12|Standard|no|0|0|0|note | Worker = Astra | colour=blue | TYPE = UI | fail_rounds = 2');
  assert.equal(a.row.model, 'gpt-6-astra', 'known key before an unknown one still counts');
  assert.equal(a.row.task_type, 'ui'); assert.equal(a.row.fail_rounds, 2);
  assert.equal(a.warning, 'unknown-field'); assert.equal(a.row.note, 'note ');
  assert.equal(parseLedger('2026-13-01|Standard|no|0|0|0|x').warning, 'bad-date');
  assert.equal(parseLedger('2026-02-30|Standard|no|0|0|0|x').warning, 'bad-date');
  assert.equal(parseLedger('2026-02-28|Standard|no|0|0|0|x').warning, null);
  const big = parseLedger('2026-11-12|Standard|no|5000 lines|0|0|x');
  assert.equal(big.row.l1_count, 999); assert.equal(big.warning, 'findings-cap');
  assert.equal(parseLedger('2026-11-12|Standard|no|0|0|0|x|findings=L1:0,L2:12345,L3:1').row.l2_count, 999);
});

test('P3-6 ledger_warnings do not grow when the ledger is re-read from the start', async t => {
  const dir = root(t), store = storeIn(dir);
  const file = f.write(path.join(dir, 'review-ledger.log'), '# header\n2026-11-12|Standard|yes|0|x|six fields\n2026-11-12|Standard|no|0|0|0|ok\n');
  const read = () => ingest(store, { file, kind: 'ledger', stat: fs.statSync(file) }, () => false);
  await read(); assert.equal(store.meta('ledger_warnings'), '2');
  store.run('UPDATE ingest_state SET offset=0, size=-1, head=NULL'); // a replay
  await read(); assert.equal(store.meta('ledger_warnings'), '2');
  f.write(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n')); // a rewrite
  await read(); assert.equal(store.meta('ledger_warnings'), '2');
  fs.appendFileSync(file, '2026-99-99|Standard|no|0|0|0|bad\r\n'); // an append adds only its own warning
  await read(); assert.equal(store.meta('ledger_warnings'), '3');
});

// v5 replaced the per-day budget with pace = used % / elapsed % (tests/v8.test.js has the full pace cases).
test('P3-4 (v5) a 5-hour window is paced over its own length, not per day', t => {
  const dir = root(t), store = storeIn(dir);
  const now = Math.floor(new Date(2026, 10, 12, 18).getTime() / 1000), H = 3600;
  const src = store.intern('source', 'claude'), win = store.intern('window', 'five_hour');
  store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at) VALUES (?,?,?,?,?)', now - H, src, win, 20, now + 2 * H);
  store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at) VALUES (?,?,?,?,?)', now, src, win, 40, now + 2 * H);
  const [cur] = q.quota(store.db, now);
  const p = q.pace(cur, now);
  assert.equal(p.windowSecs, 5 * H); assert.equal(p.elapsedPct, 60); assert.equal(p.pace, 0.67); assert.equal(p.hoursLeft, 2);
});

test('P3-8 a parent_thread_id cycle resolves to the smallest id on the cycle and terminates', t => {
  const dir = root(t), store = storeIn(dir);
  const add = (id, parent, total) => store.insert('codex_sessions', { session_id: id, parent_thread_id: parent, model: store.intern('model', 'm'), day: '2026-11-01', total_tokens: total });
  add('b', 'c', 10); add('c', 'a', 20); add('a', 'b', 30); add('leaf', 'c', 5);
  const runs = [{ run_id: 'r1', codex_session_id: 'leaf' }];
  store.insert('runs', { run_id: 'r1', codex_session_id: 'leaf', model: store.intern('model', 'm'), is_resume: 0, started: 1, sandbox_failure: 0, day: '2026-11-01' });
  q.runTokens(store.db, runs);
  assert.equal(runs[0].codex_root, 'a'); assert.equal(runs[0].codex_total, 65); assert.equal(runs[0].codex_threads, 4);
});

test('P2-3 a hook never migrates an older DB; --full backs it up first and migrates', t => {
  const dir = root(t), env = f.environment(dir);
  f.populate(env);
  const run = args => spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), ...args],
    { env, encoding: 'utf8', input: '', timeout: 60000 });
  assert.equal(run(['--full']).status, 0);
  const version = () => { const s = new Store(env.LINE_HUB_DB); try { return s.meta('schema_version'); } finally { s.close(); } };
  // Pretend an older collector wrote this DB (Store would migrate on open, so write the marker raw).
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(env.LINE_HUB_DB); raw.exec("UPDATE meta SET value='6' WHERE key='schema_version'"); raw.close();
  const log = path.join(path.dirname(env.LINE_HUB_DB), 'collect-errors.log');
  for (let i = 0; i < 2; i++) assert.equal(run(['--hook', '--min-interval-s', '0']).status, 0);
  const plain = run([]);
  assert.equal(JSON.parse(plain.stdout).skipped, 'migration');
  const rawCheck = new DatabaseSync(env.LINE_HUB_DB, { readOnly: true });
  assert.equal(rawCheck.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '6', 'hook and plain runs did not migrate');
  rawCheck.close();
  assert.equal(fs.readFileSync(log, 'utf8').match(new RegExp(`INFO_MIGRATION_PENDING_V${SCHEMA_VERSION}`, 'g')).length, 1, 'logged once');
  const full = run(['--full']);
  assert.equal(full.status, 0, full.stderr);
  assert.ok(fs.existsSync(path.join(path.dirname(env.LINE_HUB_DB), 'hub-v6.bak')), 'backup written before the migration');
  assert.equal(version(), String(SCHEMA_VERSION));
  // --migrate works the same way.
  const again = new DatabaseSync(env.LINE_HUB_DB); again.exec("UPDATE meta SET value='6' WHERE key='schema_version'"); again.close();
  assert.equal(run(['--migrate']).status, 0); assert.equal(version(), String(SCHEMA_VERSION));
  // --reparse-ledger re-reads the ledger: rows refresh, nothing doubles.
  const ledgerState = () => { const s = new Store(env.LINE_HUB_DB); try { return [s.get('SELECT COUNT(*) n FROM ledger').n, s.meta('ledger_warnings') ?? null]; } finally { s.close(); } };
  const before = ledgerState();
  assert.equal(run(['--reparse-ledger']).status, 0);
  assert.deepEqual(ledgerState(), before);
});
