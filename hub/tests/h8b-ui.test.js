/* Intent: exercise H8b HTTP contracts and actual htm component templates without a browser dependency.
 * Status: fixture-only. Next: supervisor screenshots. Blockers: no layout engine. Confidence: runtime assertions. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Store } = require('../collector/db');
const { start } = require('../server/server');
const q = require('../server/queries');
const web = path.resolve(__dirname, '../web');

/* Intent: load vendored htm/Preact and evaluate components without mounting the DOM.
 * Status: ready. Next: browser layout checks. Blockers: none. Confidence: real template runtime. */
async function views() {
  const load = file => import(`data:text/javascript;base64,${fs.readFileSync(path.join(web, file)).toString('base64')}`);
  const [{ h, cloneElement }, { default: htm }] = await Promise.all([load('vendor/preact.module.js'), load('vendor/htm.module.js')]);
  const source = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').split("const root = document.getElementById('app');")[0];
  return new Function('h', 'cloneElement', 'htm', `${source}; return { CompareModels, Gates, Models, PAGES, UsageCard, RoutingCard, paceClass };`)(h, cloneElement, htm);
}
/* Intent: resolve function components into inspectable host elements. Status: ready.
 * Next: none. Blockers: no DOM layout here. Confidence: assertions inspect rendered content. */
function elements(node, out = []) {
  if (Array.isArray(node)) { node.forEach(x => elements(x, out)); return out; }
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return elements(node.type(node.props), out);
    out.push(node); elements(node.props?.children, out);
  } else out.push(String(node));
  return out;
}

test('ontology UI: pace colours, routing tooltip and handoff banner follow API thresholds', async () => {
  const { UsageCard, RoutingCard, paceClass } = await views();
  const defaults = q.routeAdvice().thresholds;
  assert.equal(paceClass(1.4, false, defaults), 'fail');
  const thresholds = { ...defaults, codexPace1: 1.15, codexPace2: 1.5, codexUsed1: 72, codexUsed2: 87,
    codexUsed3: 97, claudePace: 1.4, claudeUsed: 75, claude5Used: 82 };
  assert.equal(paceClass(1.4, false, thresholds), 'run');
  assert.equal(paceClass(1.4, true, thresholds), '');
  const route = { ...q.routeAdvice(), thresholds, notes: ['Claude 5-hour >= 82%: fixture handoff'] };
  const card = RoutingCard({ r: route });
  assert.match(card.props.src, /C1: pace > 1\.15 or used >= 72%; C2: pace > 1\.5 or used >= 87%; C3: used >= 97%/);
  assert.match(card.props.src, /Claude K1: 7-day pace > 1\.4 or used >= 75%/);
  assert.ok(elements(card).some(x => x.props?.class === 'route-banner'));
  const u = { rows: [{ name: 'fixture', pace: 1.4, early: false }], others: [], freshSecs: 3600 };
  const usage = elements(UsageCard({ u, thresholds }));
  assert.ok(usage.some(x => x.props?.class === 'pill run'));
});

test('H8b UI: templates render populated/empty tables, formulas, tier control, low data and Gates navigation', async t => {
  const { CompareModels, Gates, Models, PAGES } = await views();
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(14), empty = q.modelCompare(s.db, r);
  let selected;
  const tree = elements(CompareModels({ d: empty, pairs: [], tier: 'All', setTier: x => { selected = x; } }));
  assert.ok(tree.includes('No A/B pairs yet: dispatch the same packet with -Model A and -Model B.'));
  const select = tree.find(x => x.type === 'select'); select.props.onChange({ target: { value: 'Important' } });
  assert.equal(selected, 'Important');
  assert.equal(PAGES[PAGES.findIndex(x => x.id === 'harness') + 1].id, 'gates');
  s.insert('runs', { run_id: 'r', model: s.intern('model', 'gpt-6-sol'), is_resume: 0, started: r.now, sandbox_failure: 0, day: r.today });
  s.insert('ledger', { id: 'l', day: r.today, tier: s.intern('tier', 'Important'), layer2: 0,
    l1_raw: '0', l2_raw: '0', l3_raw: '0', note: '<script>escaped by Preact</script>', fail_rounds: 0 });
  const compare = q.modelCompare(s.db, r);
  const populated = elements(CompareModels({ d: compare, pairs: [{ sha: 'a'.repeat(64), newest: r.now, note: 'pair note', models: [{ key: 'a', effort: 'high', exitCode: 0, durationSecs: 30, totalTokens: 100, failRounds: 0 }] }], tier: 'All', setTier: () => {} }));
  assert.ok(populated.includes('low data')); assert.ok(populated.includes('n/a (n=0)'));
  assert.equal(populated.filter(x => x.type === 'table').length, 3);
  assert.ok(populated.some(x => x.type === 'span' && x.props.title?.includes('exit_code = 0')));
  assert.ok(populated.some(x => x.type === 'span' && x.props.title?.includes('Shared sessions')));
  // Intent: render mode and gates-only totals for both log shapes. Status: v10. Next: none. Blockers: none. Confidence: real templates.
  for (const [id, mode, model] of [['gates-old', 'gates-only', 'gpt-6-astra'], ['gates-new', 'gates-only', null], ['review', 'model', 'gpt-6-astra']]) {
    s.insert('reviews', { id, mode, model: s.intern('model', model), ts: r.now, verdict: s.intern('status', 'PASS'), p0: 0, p1: 0, p2: 0, p3: 0 });
  }
  const gates = elements(Gates({ d: q.gates(s.db, r) }));
  assert.ok(gates.includes('Mode')); assert.ok(gates.includes('model'));
  assert.ok(gates.some(x => x.type === 'p' && elements(x).filter(v => typeof v === 'string').join('') === 'gates-only runs: 2'));
  assert.ok(gates.some(x => x.type === 'span' && x.props.title?.includes('Only ledger field 3 supplies evidence')));
  assert.ok(gates.includes('<script>escaped by Preact</script>')); assert.ok(!gates.some(x => x.type === 'script'));
  const models = elements(Models({ d: { models: [], picked: null, compare, pairs: [] }, tier: 'All', model: null, loaded: null, setTier: () => {} }));
  assert.equal(models.find(x => x.type === 'div').props.class, 'model-page');
  assert.equal(models.find(x => x.type === 'h3').props.children, 'Compare models');
  const route = await import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(web, 'route.js'), 'utf8'))}`);
  assert.deepEqual(route.readRoute('#gates?days=30', PAGES.map(x => x.id), [14, 30]), { page: 'gates', days: 30, model: null });
});

test('H8b HTTP: tier allow-list, compare/pairs payload and Gates, including a v8 database', async t => {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'h8b-http-')), file = path.join(dir, 'hub.db');
  const s = new Store(file);
  s.exec('DROP INDEX runs_spec_sha; ALTER TABLE runs DROP COLUMN spec_sha'); s.setMeta('schema_version', '8'); s.close();
  const server = start({ db: file, port: 0, systemDir: path.join(dir, 'system') });
  t.after(() => { server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await new Promise(resolve => server.on('listening', resolve));
  const get = endpoint => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: endpoint }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', x => { body += x; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  }).on('error', reject));
  for (const [tier, expected] of [['Important', 'Important'], ["x' OR 1=1", 'All'], ['', 'All']]) {
    const result = await get(`/api/models?days=14&tier=${encodeURIComponent(tier)}`);
    assert.equal(result.status, 200); assert.equal(result.body.data.compare.tier, expected);
    assert.deepEqual(result.body.data.pairs, []); assert.ok(Array.isArray(result.body.data.models));
  }
  const result = await get('/api/gates?days=14');
  assert.equal(result.status, 200); assert.equal(result.body.data.tiers.length, 8);
});
