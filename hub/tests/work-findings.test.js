/* Intent: prove K1c-2 category reporting and privacy with isolated fixtures.
 * Status: test-first. Next: supervisor layout checks. Blockers: none. Confidence: exact counts. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Store } = require('../collector/db');
const parsers = require('../collector/parsers');
const q = require('../server/queries');
const ontology = JSON.parse(fs.readFileSync(process.env.LINE_HUB_ONTOLOGY, 'utf8'));
const now = new Date(2026, 10, 15, 18).getTime() / 1000;

/* Intent: insert bounded fixture findings through the real parser. Status: ready.
 * Next: none. Blockers: none. Confidence: aggregation tests below. */
function add(s, id, category, layer = 1, runId = null, ts = now) {
  parsers.finding(s, { id, category, layer, runId, utc: ts, severity: 'P2', title: 'Fixture' }, {});
}

test('Work findings: top ten plus other preserve totals and layers; workers use run model aliases', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(90, now), categories = ontology.defectCategories.filter(c => c.id !== 'other');
  s.insert('runs', { run_id: 'sol', model: s.intern('model', 'Sol'), day: r.today, started: now - 100, is_resume: 0, sandbox_failure: 0 });
  s.insert('runs', { run_id: 'sol-alias', model: s.intern('model', 'gpt-6-sol'), day: r.today, started: now - 100, is_resume: 0, sandbox_failure: 0 });
  s.insert('runs', { run_id: 'no-model', model: s.intern('model', 'unknown'), day: r.today, started: now - 100, is_resume: 0, sandbox_failure: 0 });
  categories.forEach((c, i) => {
    for (let j = 0; j < 20 - i; j++) add(s, `${i}-${j}`, c.id, j % 3 + 1, j % 2 ? 'sol' : 'sol-alias');
  });
  add(s, 'unknown', 'future-category', 2, 'missing-run');
  add(s, 'null-category', null, 3, 'no-model');
  add(s, 'explicit-other', 'other', 1);
  add(s, 'old', 'logic-bug', 1, 'sol', r.startTs - 1);
  add(s, 'future', 'logic-bug', 1, 'sol', now + 1);
  const findings = q.pages.work(s.db, r).findings;
  assert.equal(findings.total, 210);
  assert.equal(findings.byCategory.length, 11);
  assert.deepEqual(findings.byCategory.filter(c => c.category !== 'other').map(c => c.category), categories.slice(0, 10).map(c => c.id));
  assert.equal(findings.byCategory.reduce((n, c) => n + c.count, 0), 210);
  assert.ok(findings.byCategory.every((c, i, a) => !i || a[i - 1].count >= c.count));
  const other = findings.byCategory.find(c => c.category === 'other');
  assert.equal(other.count, 55);
  assert.equal(Object.values(other.byLayer).reduce((a, b) => a + b), 55);
  const first = findings.byCategory.find(c => c.category === categories[0].id);
  assert.deepEqual(first, { category: categories[0].id, label: categories[0].label,
    countermeasure: categories[0].countermeasure, count: 20, byLayer: { 1: 7, 2: 7, 3: 6 } });
  assert.deepEqual(findings.byWorker.map(w => w.model), ['gpt-6-sol', 'unknown']);
  assert.deepEqual(findings.byWorker[0].categories.map(c => [c.category, c.count]), categories.slice(0, 3).map((c, i) => [c.id, 20 - i]));
  assert.deepEqual(findings.byWorker[1].categories.map(c => [c.category, c.count]), [['other', 3]]);
});

test('Work findings: eight Monday weeks, zero gaps and top five use original categories, independent of selected range', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(1, now), categories = ontology.defectCategories.slice(0, 6);
  const oldest = new Date(2026, 8, 21).getTime() / 1000;
  categories.forEach((c, i) => {
    for (let j = 0; j < 6 - i; j++) add(s, `${i}-${j}`, c.id, 1, null, oldest);
  });
  add(s, 'today', categories[0].id);
  add(s, 'too-old', categories[0].id, 1, null, oldest - 1);
  add(s, 'future', categories[0].id, 1, null, now + 1);
  const findings = q.pages.work(s.db, r).findings;
  assert.equal(findings.total, 1);
  assert.equal(findings.byWeek.length, 8);
  assert.equal(findings.byWeek[0].week, '2026-09-21');
  assert.equal(findings.byWeek.at(-1).week, '2026-11-09');
  assert.deepEqual(findings.byWeek[0].categories.map(c => [c.category, c.count]), categories.slice(0, 5).map((c, i) => [c.id, 6 - i]));
  assert.ok(findings.byWeek.slice(1, -1).every(w => w.categories.every(c => c.count === 0)));
  assert.deepEqual(findings.byWeek.at(-1).categories.map(c => c.count), [1, 0, 0, 0, 0]);
});

test('Work findings: empty and pre-v11 databases return the empty contract', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  for (const legacy of [false, true]) {
    if (legacy) s.exec('DROP TABLE findings');
    const findings = q.pages.work(s.db, q.range(7, now)).findings;
    assert.equal(findings.total, 0); assert.deepEqual(findings.byCategory, []); assert.deepEqual(findings.byWorker, []);
    assert.equal(findings.byWeek.length, 8); assert.ok(findings.byWeek.every(w => w.categories.length === 0));
  }
});

test('ontology: missing categories and invalid ontology use all 19 copied defaults; live labels survive', t => {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'work-findings-')), file = path.join(root, 'ontology.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const code = `const { Store } = require('./collector/db'), q = require('./server/queries');
    const p = require('./collector/parsers'), s = new Store(':memory:'), r = q.range(7);
    const ids = ${JSON.stringify(ontology.defectCategories.map(c => c.id))};
    const rows = ids.map((id, i) => {
      s.exec('DELETE FROM findings');
      p.finding(s, { id: String(i), category: id, layer: 1, severity: 'P2', utc: r.now }, {});
      const { category, label, countermeasure } = q.pages.work(s.db, r).findings.byCategory[0];
      return { id: category, label, countermeasure };
    });
    process.stdout.write(JSON.stringify({ rows, metrics: q.pages.work(s.db, r).metrics })); s.close();`;
  for (const variant of ['missing', 'invalid', 'custom']) {
    const input = structuredClone(ontology);
    if (variant === 'missing') delete input.defectCategories;
    if (variant === 'custom') input.defectCategories[0].label = 'Fixture custom label';
    fs.writeFileSync(file, variant === 'invalid' ? '{}' : JSON.stringify(input));
    const child = spawnSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, LINE_HUB_ONTOLOGY: file } });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    const expected = (variant === 'custom' ? input : ontology).defectCategories.map(({ id, label, countermeasure }) => ({ id, label, countermeasure }));
    assert.deepEqual(result.rows, expected);
    assert.equal(result.metrics.first_pass.definition, ontology.metrics.first_pass.definition);
  }
});

test('finding privacy: paths in titles become basenames before truncation; metadata is capped at 64', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const titles = [
    ['Fix C:\\Users\\private\\repo\\bug.js and D:/private/repo/test.js', 'Fix bug.js and test.js'],
    ['Fix /Users/private/repo/a.js and /home/private/repo/b.js', 'Fix a.js and b.js'],
    ['Inspect "C:\\Users\\private name\\repo\\my file.js" now', 'Inspect "my file.js" now'],
    ['Inspect /home/private name/repo/bug.js now', 'Inspect bug.js now'],
    ['Inspect C:\\private\\repo (copy)\\src[1]\\bug.js now', 'Inspect bug.js now'],
    ['See (/Users/private/repo/bug.js:12), then C:/private/repo/next.js.', 'See (bug.js:12), then next.js.'],
    ['Fix /home/' + 'private/'.repeat(50) + 'bug.js now', 'Fix bug.js now']
  ];
  titles.forEach(([title, expected], i) => {
    parsers.finding(s, { id: String(i), layer: 2, severity: 'P1', title, category: 'c'.repeat(80),
      source: 's'.repeat(80), criterion: 'x'.repeat(80), reviewer: 'r'.repeat(80) }, { ts: now });
    const row = s.get('SELECT * FROM findings WHERE id=?', String(i));
    assert.equal(row.title, expected);
    for (const key of ['category', 'source', 'criterion', 'reviewer']) assert.equal(row[key].length, 64);
  });
  assert.doesNotMatch(JSON.stringify(s.all('SELECT * FROM findings')), /private|Users|home/);
});

test('firstPassClean: null rounds cannot hide raw FAIL behind zero finding counts', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(7, now);
  for (const layer of [1, 2, 3]) {
    const row = { id: String(layer), day: r.today, note: 'fixture', tier: s.intern('tier', 'Important'), layer2: 1,
      fail_rounds: null, l1_count: 0, l2_count: 0, l3_count: 0, l1_raw: '0', l2_raw: '0', l3_raw: '0', [`l${layer}_raw`]: '0, FAIL x2' };
    assert.equal(q.firstPassClean(row), false);
    s.insert('ledger', row);
  }
  assert.ok(q.ledgerRows(s.db, r).every(row => !row.clean && row.fail));
  assert.equal(q.pages.work(s.db, r).daily.clean.at(-1), 0);
  assert.equal(q.pages.overview(s.db, r).kpi.tasks.cleanPct, 0);
});
