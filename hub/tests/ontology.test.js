'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = process.env.LINE_HUB_ONTOLOGY;

/* Intent: fresh-process loading proves path precedence, whole-file fallback and no per-call reload.
 * Status: complete. Next: none. Blockers: none. Confidence: isolated child processes. */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ontology-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'ontology.json'), o = JSON.parse(fs.readFileSync(source));
  const save = () => fs.writeFileSync(file, JSON.stringify(o)); save();
  const run = (ontology = file, extra = '') => {
    const code = `const q = require(${JSON.stringify(path.resolve(__dirname, '../server/queries'))});
      ${extra}
      console.log(JSON.stringify({status:q.ontologyStatus, route:q.routeAdvice({codexUsed:10,codexPace:0.8}),
        stop:q.routeAdvice({codexUsed:99,claude7Used:99}), rules:q.RULES}));`;
    const env = { ...process.env, USERPROFILE: root, LINE_HUB_ONTOLOGY: ontology };
    if (ontology === null) delete env.LINE_HUB_ONTOLOGY;
    const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  return { root, file, o, save, run };
}

test('ontology loads, exposes status beside route in Overview, returns thresholds and stays cached', t => {
  const f = fixture(t), r = f.run(source);
  assert.deepEqual(r.status, { state: 'loaded', version: f.o.version, error: null });
  assert.deepEqual(r.route.thresholds, f.o.quota.thresholds);
  assert.equal(r.route.ontologyStatus, undefined);
  assert.equal(r.rules.commit, f.o.alerts.commitPct);
  const cached = f.run(f.file, `require('node:fs').writeFileSync(${JSON.stringify(f.file)}, '{}');`);
  assert.equal(cached.status.state, 'loaded');
  const { Store } = require('../collector/db'), q = require('../server/queries');
  const s = new Store(':memory:'); t.after(() => s.close());
  const old = process.env.LINE_HUB_HOME; process.env.LINE_HUB_HOME = f.root;
  t.after(() => { if (old === undefined) delete process.env.LINE_HUB_HOME; else process.env.LINE_HUB_HOME = old; });
  const overview = q.pages.overview(s.db, q.range(7));
  assert.deepEqual(overview.ontologyStatus, r.status);
  assert.deepEqual(overview.route.thresholds, f.o.quota.thresholds);
  assert.deepEqual(q.pages.productivity(s.db, q.range(7)).pace.thresholds, f.o.quota.thresholds);
});

test('without env override: missing live file selects repo; valid live wins; invalid live falls back', t => {
  const f = fixture(t);
  assert.equal(f.run(null).status.state, 'loaded');
  const dir = path.join(f.root, '.claude/ontology'); fs.mkdirSync(dir, { recursive: true });
  const live = path.join(dir, 'harness.ontology.json');
  f.o.routing.labels.sol = 'live fixture'; fs.writeFileSync(live, JSON.stringify(f.o));
  assert.equal(f.run(null).route.rows[0].model, 'live fixture');
  fs.writeFileSync(live, '{}');
  assert.equal(f.run(null).status.state, 'fallback');
  assert.equal(f.run('').status.state, 'fallback', 'an empty but set override is still explicit');
});

test('env missing or malformed never tries another path; incomplete shapes fall back as a whole', t => {
  const f = fixture(t);
  const live = path.join(f.root, '.claude/ontology'); fs.mkdirSync(live, { recursive: true });
  fs.copyFileSync(source, path.join(live, 'harness.ontology.json'));
  for (const value of [null, '{', '{}']) {
    if (value !== null) fs.writeFileSync(f.file, value);
    const r = f.run(value === null ? path.join(f.root, 'missing') : f.file);
    assert.equal(r.status.state, 'fallback'); assert.equal(r.status.version, null); assert.ok(r.status.error);
    assert.equal(r.route.rows[0].model, 'gpt-6-sol high');
  }
  for (const mutate of [o => delete o.quota.thresholds.codexPace2,
    o => o.routing.matrix.K0.C0 = ['unknown', 'sol', 'sol', 'sol', 'sol'],
    o => o.routing.matrix.K0.C1.pop(), o => o.routing.layer3.K1 = null,
    o => o.alerts.commitPct = '90', o => o.routing.k5Banner = '{unknown}']) {
    const o = JSON.parse(fs.readFileSync(source)); mutate(o); o.routing.labels.sol = 'must not leak';
    fs.writeFileSync(f.file, JSON.stringify(o));
    const r = f.run(); assert.equal(r.status.state, 'fallback'); assert.equal(r.route.rows[0].model, 'gpt-6-sol high');
  }
});

test('fixture matrix, labels, thresholds, layer3 and alerts drive behavior', t => {
  const f = fixture(t);
  f.o.routing.matrix.K0.C0[0] = 'astra'; f.o.routing.layer3.K0 = 'fixture review';
  f.o.quota.thresholds.codexPace2 = 1.5; f.o.quota.thresholds.codexUsed3 = 97;
  f.o.alerts.commitPct = 91; f.save();
  const r = f.run(); assert.equal(r.status.state, 'loaded');
  assert.equal(r.route.rows[0].model, 'gpt-6-astra high');
  assert.equal(r.route.rows[5].model, 'fixture review');
  assert.equal(r.route.thresholds.codexPace2, 1.5); assert.equal(r.rules.commit, 91);
  assert.match(r.stop.notes[0], /used >= 97%/);
});
