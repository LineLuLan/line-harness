/* Intent: prove Line's typed findings and certified first-pass metric using fixtures only.
 * Status: test-first. Next: independent review. Blockers: none. Confidence: regressions below. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const parsers = require('../collector/parsers');
const { collect, options } = require('../collector/collect');
const { paths, discover } = require('../collector/sources');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

/* Intent: isolate DBs and all discovered logs inside hub. Status: ready.
 * Next: none. Blockers: none. Confidence: explicit environment and cleanup. */
function fixture(t) {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'v11-')), env = f.environment(root);
  fs.mkdirSync(path.dirname(env.LINE_HUB_DB), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env, config: paths(env) };
}

test('v11 migration: collector backs up v10 before adding findings and preserves every existing table', async t => {
  const { env, config } = fixture(t);
  let s = new Store(env.LINE_HUB_DB);
  parsers.ledger(s, '2026-11-15|Important|yes|0|0|0|kept', { id: 'kept' });
  parsers.review(s, { verdict: 'PASS' }, { id: 'kept', ts: 1 });
  s.exec('DROP TABLE IF EXISTS findings'); s.setMeta('schema_version', '10');
  // A normal v10 collector has already interned these linking kinds.
  s.intern('dispatch_kind', 'do'); s.intern('dispatch_kind', 'resume');
  const tables = s.all("SELECT name FROM sqlite_master WHERE type='table'").map(x => x.name);
  const counts = Object.fromEntries(tables.map(table => [table, s.get(`SELECT COUNT(*) n FROM ${table}`).n]));
  s.close();
  // Read-only query compatibility before a collector migration.
  const old = new DatabaseSync(env.LINE_HUB_DB, { readOnly: true });
  try { for (const page of Object.values(q.pages)) assert.ok(page(old, q.range(14))); }
  finally { old.close(); }
  assert.equal((await collect(config, options(['--min-interval-s', '0']))).skipped, 'migration');
  await collect(config, options(['--migrate', '--min-interval-s', '0']));
  const backup = new DatabaseSync(path.join(path.dirname(env.LINE_HUB_DB), 'hub-v10.bak'), { readOnly: true });
  try {
    assert.equal(backup.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '10');
    assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='findings'").get(), undefined);
    for (const table of ['ledger', 'reviews']) assert.equal(backup.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, counts[table]);
  } finally { backup.close(); }
  s = new Store(env.LINE_HUB_DB);
  try {
    assert.equal(SCHEMA_VERSION, 11); assert.equal(s.meta('schema_version'), '11');
    for (const table of tables.filter(x => !['meta', 'lease'].includes(x))) {
      assert.equal(s.get(`SELECT COUNT(*) n FROM ${table}`).n, counts[table], table);
    }
    assert.deepEqual(s.all('PRAGMA table_info(findings)').map(x => x.name),
      ['id', 'ts', 'source', 'kind', 'layer', 'severity', 'category', 'title', 'criterion', 'reviewer', 'project', 'spec_sha', 'run_id']);
    for (const column of ['ts', 'category']) assert.ok(s.all('PRAGMA index_list(findings)').some(index =>
      s.all(`PRAGMA index_info(${index.name})`).some(x => x.name === column)));
  } finally { s.close(); }
});

test('findings: six JSONL lines yield five rows and one warning, raw category, bounded titles and id upserts', async t => {
  const { env, config } = fixture(t);
  const base = { utc: f.timestamp, source: 'codex-review', layer: 2, severity: 'P2', category: 'correctness',
    title: 'Short title', criterion: 'C1', reviewer: 'fixture', dir: '/fixture-private/project-a',
    specSha: 'a'.repeat(64), runId: 'run-1', quote: 'PRIVATE_QUOTE', location: '/PRIVATE_LOCATION/file.js', specFile: '/PRIVATE_SPEC/task.md' };
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `finding-${i}` }));
  rows[1].category = ' Unknown future category ';
  rows[2].title = 'x'.repeat(250);
  rows[3].kind = 'format-violation'; rows[3].severity = null;
  rows[4].layer = 3; rows[4].severity = 'P0';
  const file = f.write(path.join(env.LINE_HUB_STATE_DIR, 'findings.jsonl'), rows.map(JSON.stringify).join('\n') + '\n{broken\n');
  assert.equal(discover(config).find(x => x.file === file)?.kind, 'finding');
  await collect(config, options(['--min-interval-s', '0']));
  let s = new Store(env.LINE_HUB_DB);
  try {
    assert.equal(s.get('SELECT COUNT(*) n FROM findings').n, 5);
    assert.equal(s.meta('finding_warnings'), '1'); assert.equal(s.meta('parse_errors'), '1');
    assert.equal(s.get("SELECT category FROM findings WHERE id='finding-1'").category, rows[1].category);
    assert.equal(s.get("SELECT length(title) n FROM findings WHERE id='finding-2'").n, 200);
    assert.equal(s.get("SELECT severity FROM findings WHERE id='finding-3'").severity, null);
    const kept = s.get("SELECT f.*, n.name project_name FROM findings f JOIN names n ON n.id=f.project WHERE f.id='finding-0'");
    assert.equal(kept.project_name, 'project-a'); assert.equal(kept.kind, 'finding');
    assert.equal(kept.spec_sha, base.specSha); assert.equal(kept.run_id, base.runId);
    assert.doesNotMatch(JSON.stringify(s.all('SELECT * FROM findings')), /PRIVATE_|fixture-private/);
  } finally { s.close(); }
  assert.equal((await collect(config, options(['--min-interval-s', '0']))).lines, 0);
  fs.appendFileSync(file, JSON.stringify({ ...rows[0], title: 'Updated', category: 'updated', severity: 'P1' }) + '\n');
  await collect(config, options(['--min-interval-s', '0']));
  s = new Store(env.LINE_HUB_DB);
  try {
    assert.equal(s.get('SELECT COUNT(*) n FROM findings').n, 5);
    assert.equal(s.meta('finding_warnings'), '1');
    assert.deepEqual({ ...s.get("SELECT title, category, severity FROM findings WHERE id='finding-0'") },
      { title: 'Updated', category: 'updated', severity: 'P1' });
  } finally { s.close(); }
});

test('findings: missing required fields and invalid typed fields each warn once', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const valid = { id: 'one', layer: 1, severity: 'P3' };
  for (const row of [{ ...valid, id: undefined }, { ...valid, id: '' }, { ...valid, layer: undefined },
    { ...valid, layer: 4 }, { ...valid, severity: undefined }, { ...valid, severity: null },
    { ...valid, severity: 'P4' }, { ...valid, kind: 'unknown' }]) parsers.finding(s, row, { ts: 1 });
  assert.equal(s.get('SELECT COUNT(*) n FROM findings').n, 0); assert.equal(s.meta('finding_warnings'), '8');
  parsers.finding(s, { ...valid, kind: 'format-violation', severity: null }, { ts: 1 });
  assert.equal(s.get('SELECT COUNT(*) n FROM findings').n, 1); assert.equal(s.meta('finding_warnings'), '8');
});

test('findings: malformed JSON, non-objects and missing fields are skipped without stopping ingestion', async t => {
  const { env, config } = fixture(t);
  const malformed = ['{', '{"quote":"' + 'x'.repeat(65536), 'null', '[]', '42', '{}', '{"id":"missing-layer"}',
    '{"id":"missing-severity","layer":2}'];
  f.write(path.join(env.LINE_HUB_STATE_DIR, 'findings.jsonl'), malformed.join('\n')
    + '\n{"id":"valid-last","layer":2,"severity":"P1"}\n');
  await collect(config, options(['--min-interval-s', '0']));
  const s = new Store(env.LINE_HUB_DB);
  try {
    assert.equal(s.get('SELECT COUNT(*) n FROM findings').n, 1);
    assert.equal(s.meta('finding_warnings'), String(malformed.length));
    assert.equal(s.meta('parse_errors'), '5', 'existing syntax/non-object parse errors are unchanged');
  } finally { s.close(); }
});

test('ontology: first-pass labels reach Overview and Work; older ontology keeps the certified fallback', t => {
  const { root } = fixture(t), file = path.join(root, 'ontology.json');
  const ontology = JSON.parse(fs.readFileSync(process.env.LINE_HUB_ONTOLOGY, 'utf8'));
  const code = `const { Store } = require(${JSON.stringify(path.resolve(__dirname, '../collector/db'))});
    const q = require(${JSON.stringify(path.resolve(__dirname, '../server/queries'))});
    const s = new Store(':memory:');
    try { process.stdout.write(JSON.stringify(['overview', 'work'].map(page => q.pages[page](s.db, q.range(7)).metrics?.first_pass?.label ?? null))); }
    finally { s.close(); }`;
  for (const [metrics, expected] of [[{ first_pass: { label: 'Fixture certified label' } }, 'Fixture certified label'],
    [undefined, 'Clean first pass']]) {
    fs.writeFileSync(file, JSON.stringify({ ...ontology, metrics }));
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, LINE_HUB_ONTOLOGY: file } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [expected, expected]);
  }
});

test('firstPassClean: zero/missing FAIL rounds and the existing layer rule are both required', () => {
  const clean = { fail_rounds: 0, l1_count: 0, l2_count: 0, l3_count: 0 };
  assert.equal(q.firstPassClean(clean), true);
  for (const fail_rounds of [null, undefined]) assert.equal(q.firstPassClean({ ...clean, fail_rounds }), true);
  assert.equal(q.firstPassClean({ ...clean, fail_rounds: 1 }), false);
  for (const layer of [1, 2, 3]) {
    assert.equal(q.firstPassClean({ ...clean, [`l${layer}_count`]: 3 }), false);
    assert.equal(q.firstPassClean({ ...clean, [`l${layer}_count`]: null, [`l${layer}_raw`]: 'PASS' }), true);
    assert.equal(q.firstPassClean({ ...clean, [`l${layer}_count`]: null, [`l${layer}_raw`]: 'FAIL x2' }), false);
    assert.equal(q.firstPassClean({ ...clean, [`l${layer}_count`]: null, [`l${layer}_raw`]: 'unknown' }), false);
  }
});

test('certified first pass: L2 findings with zero FAIL rounds fail in Overview, Work, gates and model outcomes', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(7, new Date(2026, 10, 15, 18).getTime() / 1000), model = s.intern('model', 'gpt-6-sol');
  s.insert('daily_runs', { day: r.today, model, runs: 1, exit0: 1, exit72: 0, exit73: 0, other_fail: 0, resumes: 0 });
  for (const [id, fail_rounds, l2_count, day] of [['dirty', 0, 3, r.today], ['clean', null, 0, r.today],
    ['repair', 1, 0, r.today], ['future', 0, 0, '2099-01-01'], ['old', 0, 0, '2000-01-01']]) {
    s.insert('ledger', { id, day, note: id, tier: s.intern('tier', 'Important'), model, layer2: 1,
      l1_count: 0, l2_count, l3_count: 0, l1_raw: '0', l2_raw: String(l2_count), l3_raw: '0', fail_rounds });
  }
  const overview = q.pages.overview(s.db, r), work = q.pages.work(s.db, r), gates = q.gates(s.db, r);
  assert.equal(q.ledgerRows(s.db, r).find(x => x.id === 'dirty').clean, false);
  assert.equal(overview.kpi.tasks.tasks, 3); assert.equal(overview.kpi.tasks.cleanPct, 33.3);
  assert.equal(work.daily.clean.at(-1), 1); assert.equal(work.daily.hadFindings.at(-1), 2);
  assert.equal(work.daily.pass7.at(-1), overview.kpi.tasks.cleanPct);
  assert.equal(work.tiers[0].firstPassPct, 33.3); assert.equal(work.tiers[0].clean, 1);
  assert.equal(work.weeks.find(x => x.tasks).firstPassPct, 33.3);
  assert.equal(work.models[0].cleanPct, 33.3);
  for (const row of [gates.tiers.find(x => x.tasks), gates.weeks.find(x => x.tasks), q.modelCompare(s.db, r).outcomes[0]]) {
    assert.equal(row.firstPassPct, 33.3); assert.equal(row.firstPassN, 3);
  }
  assert.equal(q.pages.workers(s.db, r).byModel[0].cleanPct, 33.3);
});
