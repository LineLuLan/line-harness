/* Intent: prove Line's field-3 evidence rule, review modes and v10 replay on private fixtures.
 * Status: test-first. Next: host validation. Blockers: none. Confidence: regressions below. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Store, SCHEMA_VERSION, backupBeforeMigration } = require('../collector/db');
const { parseLedger } = require('../collector/ledger');
const parsers = require('../collector/parsers');
const { collect, options } = require('../collector/collect');
const { paths } = require('../collector/sources');
const { hash } = require('../collector/values');
const { start } = require('../server/server');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');
const vectors = [
  ['yes', 1], ['layer2 yes', 1], ['no', 0], ['no (Fable L2b yes ...)', 1],
  ['partial (Fable 2b yes, codex L2 pending)', 1], ['Fable PASS (2 P2 ...); Sol review deferred', 1],
  ['L2 model: OOM ...; L2b Fable: FAIL (3 P1 ...)', 1], ['Astra skipped; Fable not run', 0], ['no (GATES-PASS)', 0], ['GATES-PASS (no model review)', 0], ['no (L2 Astra FAIL)', 1],
  ['no (L2 skipped; L3 yes)', 0], ['yes (pending: Codex web review + Fable)', 1]
];
for (const [field, expected] of vectors) test(`v10 field-3 evidence: ${field}`, () => {
  const row = parseLedger(`2026-11-15|Important|${field}|0|Astra skipped; Fable not run|PASS|L2 yes`).row;
  assert.equal(row.layer2, expected);
});
test('v10: audit copy preserves field 3 verbatim', () => {
  assert.equal(parseLedger('2026-11-15|Important| no (Fable L2b yes) |0|0|0|note').row.layer2_raw, ' no (Fable L2b yes) ');
});
test('R1 reproduction: skipped model names outside field 3 are a missing-review violation', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(14, new Date(2026, 10, 15, 18).getTime() / 1000);
  parsers.ledger(s, '2026-11-15|Important|no|0|Astra skipped; Fable not run|0|Astra skipped; Fable not run', { id: 'r1' });
  assert.equal(s.get('SELECT layer2 FROM ledger').layer2, 0);
  const gates = q.gates(s.db, r);
  assert.equal(gates.tiers.find(x => x.tier === 'Important').layer2Pct, 0);
  assert.deepEqual(gates.violations.map(x => x.note), ['Astra skipped; Fable not run']);
  assert.equal(q.pages.workers(s.db, r).tiers.find(x => x.tier === 'Important').layer2Pct, 0);
});
test('v10: gates-only old/new shapes excluded; model and unknown modes keep separate denominators', t => {
  const s = new Store(':memory:'); t.after(() => s.close()); const r = q.range(14);
  for (const [id, mode, model, verdict] of [
    ['old-gates', 'gates-only', 'gpt-6-astra', 'FAIL'], ['new-gates', 'gates-only', null, 'FAIL'],
    ['model', 'model', 'gpt-6-astra', 'PASS'], ['legacy', undefined, 'gpt-6-astra', 'FAIL'],
    ['other', 'future-mode', 'gpt-6-astra', 'PASS'], ['null-model', 'model', null, 'PASS']
  ]) parsers.review(s, { utc: r.now, mode, model, effort: null, verdict, findings: [] }, { id, ts: r.now });
  const d = q.gates(s.db, r);
  assert.equal(d.gatesOnlyRuns, 2);
  assert.equal(d.reviewers.reduce((n, x) => n + x.reviews, 0), 4);
  assert.deepEqual(d.reviewers.filter(x => x.key === 'gpt-6-astra').map(x => [x.mode, x.reviews, x.failPct]),
    [['model', 1, 0], ['unknown', 2, 50]]);
  assert.ok(d.reviewers.some(x => x.key === 'unknown' && x.mode === 'model'));
  parsers.review(s, { utc: r.now, mode: 'model', verdict: 'PASS' }, { id: 'legacy', ts: r.now });
  assert.equal(s.get("SELECT mode FROM reviews WHERE id='legacy'").mode, 'model', 'replay upserts mode');
});
/* Intent: create v9 fixtures without any host paths. Status: ready. Next: none. Blockers: none. Confidence: isolation. */
function fixture(t) {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'v10-')), env = f.environment(dir), stores = [], servers = [];
  fs.mkdirSync(path.dirname(env.LINE_HUB_DB), { recursive: true });
  t.after(() => { for (const server of servers) server.stop(); for (const s of stores) try { s.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  return { env, servers, file: env.LINE_HUB_DB, open: () => { const s = new Store(env.LINE_HUB_DB); stores.push(s); return s; } };
}
function downgrade(s) {
  for (const [table, column] of [['ledger', 'layer2_raw'], ['reviews', 'mode']]) {
    if (s.all(`PRAGMA table_info(${table})`).some(x => x.name === column)) s.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  s.setMeta('schema_version', '9'); s.close();
}
test('v10: v9 migration preserves rows, adds TEXT columns, backs up, flags once and reopens idempotently', t => {
  const { file, open } = fixture(t); let s = open();
  parsers.ledger(s, '2026-11-15|Important|yes|0|0|0|kept', { id: 'kept' });
  parsers.review(s, { verdict: 'PASS' }, { id: 'kept', ts: 1 }); downgrade(s);
  assert.ok(fs.existsSync(backupBeforeMigration(file, 9)));
  s = open(); assert.equal(SCHEMA_VERSION, 10); assert.equal(s.meta('schema_version'), '10');
  for (const [table, column] of [['ledger', 'layer2_raw'], ['reviews', 'mode']]) {
    assert.ok(s.all(`PRAGMA table_info(${table})`).some(x => x.name === column && x.type === 'TEXT'));
    assert.equal(s.get(`SELECT COUNT(*) n FROM ${table}`).n, 1);
    assert.equal(s.get(`SELECT ${column} value FROM ${table}`).value, null);
  }
  assert.equal(s.meta('v10_review_replay'), '1');
  s.run("DELETE FROM meta WHERE key='v10_review_replay'"); s.close();
  s = open(); assert.equal(s.meta('v10_review_replay'), undefined);
  assert.equal(s.get('SELECT COUNT(*) n FROM ledger').n, 1);
});
test('v10: unchanged ledger and reviews replay once, unrelated cursors untouched, no duplicates', async t => {
  const { env, open } = fixture(t);
  const ledger = f.write(path.join(env.LINE_HUB_STATE_DIR, 'review-ledger.log'), '2026-11-15|Important|Fable PASS|0|0|0|review\n');
  const reviews = f.write(path.join(env.LINE_HUB_STATE_DIR, 'reviews.jsonl'), JSON.stringify({ utc: f.timestamp, model: 'gpt-6-astra', mode: 'gates-only', verdict: 'PASS' }) + '\n');
  await collect(paths(env), options(['--min-interval-s', '0']));
  let s = open(); s.run('UPDATE ledger SET layer2=0'); s.cursor('unrelated', 12, 1, 12, null); downgrade(s);
  s = open(); assert.equal(s.meta('v10_review_replay'), '1'); s.close();
  await collect(paths(env), options(['--min-interval-s', '0']));
  s = open(); assert.equal(s.meta('v10_review_replay'), undefined);
  assert.deepEqual({ ...s.get('SELECT layer2,layer2_raw FROM ledger') }, { layer2: 1, layer2_raw: 'Fable PASS' });
  assert.equal(s.get('SELECT mode FROM reviews').mode, 'gates-only');
  assert.equal(s.state('unrelated').offset, 12);
  const cursors = [ledger, reviews].map(file => ({ ...s.state(hash(file)) })); s.close();
  const result = await collect(paths(env), options(['--min-interval-s', '0']));
  assert.equal(result.lines, 0); s = open();
  assert.deepEqual([ledger, reviews].map(file => ({ ...s.state(hash(file)) })), cursors);
  for (const table of ['ledger', 'reviews']) assert.equal(s.get(`SELECT COUNT(*) n FROM ${table}`).n, 1);
});
test('v10: every page still serves a v9 database with legacy reviews', async t => {
  const { file, open, servers } = fixture(t); const s = open();
  parsers.review(s, { verdict: 'PASS', model: 'gpt-6-astra' }, { id: 'legacy', ts: Math.floor(Date.now() / 1000) }); downgrade(s);
  const server = start({ db: file, port: 0, systemDir: path.join(path.dirname(file), 'system') });
  servers.push(server); await new Promise(resolve => server.on('listening', resolve));
  for (const page of ['overview', 'supervisor', 'workers', 'models', 'cost', 'productivity', 'harness', 'gates', 'system', 'trace']) {
    const result = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: `/api/${page}?days=14` }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject));
    assert.equal(result.status, 200, page);
    if (page === 'gates') { assert.equal(result.body.data.gatesOnlyRuns, 0); assert.equal(result.body.data.reviewers[0].mode, 'unknown'); }
  }
});
