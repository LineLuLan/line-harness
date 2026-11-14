/* Intent: v9 migration and packet SHA ingest against isolated fixtures.
 * Status: test-first. Next: host migration. Blockers: none. Confidence: tests below. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { snapshot, paths } = require('../collector/sources');
const { collect, options } = require('../collector/collect');
const { hash } = require('../collector/values');
const f = require('./fixtures/synthetic');

/* Intent: keep all artifacts in hub/.tmp. Status: ready. Next: none. Blockers: none. Confidence: fixture isolation. */
function fixture(t) {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'v9-')), stores = [];
  t.after(() => { for (const s of stores) try { s.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  const env = f.environment(dir), file = env.LINE_HUB_DB;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return { dir, env, file, open: () => { const s = new Store(file); stores.push(s); return s; } };
}

test('v9: actual v8 schema migrates with data, column before index, replay once, reopen idempotent', t => {
  const { file, open } = fixture(t);
  const old = new DatabaseSync(file);
  old.exec(fs.readFileSync(path.resolve(__dirname, '../collector/schema.sql'), 'utf8').replace(/, spec_sha TEXT/g, ''));
  old.exec("INSERT INTO meta VALUES ('schema_version','8'); INSERT INTO names VALUES (1,'model','gpt-6-sol'); INSERT INTO runs (run_id,model,is_resume,started,sandbox_failure,day) VALUES ('kept',1,0,1,0,'2026-11-14')");
  old.close();
  let s = open();
  assert.equal(SCHEMA_VERSION, 10); assert.equal(s.meta('schema_version'), '10');
  assert.equal(s.get("SELECT run_id FROM runs WHERE run_id='kept'").run_id, 'kept');
  assert.ok(s.all('PRAGMA table_info(runs)').some(x => x.name === 'spec_sha' && x.type === 'TEXT'));
  assert.ok(s.all('PRAGMA index_list(runs)').some(x => x.name === 'runs_spec_sha'));
  assert.equal(s.meta('v9_run_replay'), '1');
  s.run("DELETE FROM meta WHERE key='v9_run_replay'"); s.close();
  s = open(); assert.equal(s.meta('v9_run_replay'), undefined);
  assert.equal(s.get('SELECT COUNT(*) n FROM runs').n, 1);
});

test('v9 snapshot: valid, uppercase normalized, short, non-hex, missing SHA', t => {
  const { dir, open } = fixture(t), s = open();
  const cases = [['a'.repeat(64), 'a'.repeat(64)], ['AB'.repeat(32), 'ab'.repeat(32)], ['a'.repeat(63), null], ['z'.repeat(64), null], [undefined, null], ['a'.repeat(64) + '\n', null]];
  for (const [i, [input, expected]] of cases.entries()) {
    const file = f.write(path.join(dir, 'runs', String(i), 'run.json'), JSON.stringify({ runId: String(i), model: 'gpt-6-sol', specSha256: input }));
    snapshot(s, { kind: 'run', file, stat: fs.statSync(file) });
    assert.equal(s.get('SELECT spec_sha FROM runs WHERE run_id=?', String(i)).spec_sha, expected);
  }
});

test('v9 replay resets only run cursors once and backfills unchanged run.json', async t => {
  const { env, open } = fixture(t), sha = 'c'.repeat(64);
  const file = f.write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'old', 'run.json'), JSON.stringify({ runId: 'old', model: 'gpt-6-sol', specSha256: sha }));
  let s = open(); snapshot(s, { kind: 'run', file, stat: fs.statSync(file) });
  s.run('UPDATE runs SET spec_sha=NULL');
  s.setMeta('v9_run_replay', '1'); s.cursor('unrelated', 12, 1, 12, null); s.close();
  await collect(paths(env), options(['--min-interval-s', '0']));
  s = open();
  assert.equal(s.get('SELECT spec_sha FROM runs').spec_sha, sha);
  assert.equal(s.meta('v9_run_replay'), undefined); assert.equal(s.state('unrelated').size, 12);
  const cursor = { ...s.state(hash(file)) }; s.close();
  await collect(paths(env), options(['--min-interval-s', '0']));
  s = open(); assert.deepEqual({ ...s.state(hash(file)) }, cursor);
  assert.equal(s.get('SELECT COUNT(*) n FROM runs').n, 1);
});
