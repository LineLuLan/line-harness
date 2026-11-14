/* Intent: fixture-only contracts for Line's six-page Hub. Status: test-first.
 * Next: host screenshots. Blockers: no layout engine here. Confidence: executable assertions. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Store } = require('../collector/db');
const q = require('../server/queries');
const fixture = require('./fixtures/synthetic');
const http = require('node:http');
const { start } = require('../server/server');
const web = path.resolve(__dirname, '../web');
const ids = ['overview', 'flow', 'work', 'cost', 'machine', 'trace'];

/* Intent: evaluate actual vendored htm/Preact templates and visuals without a DOM dependency.
 * Status: hooks use initial state; event setters update the existing UI memories for rerenders.
 * Next: host layout checks. Blockers: no canvas/layout engine. Confidence: runtime assertions. */
async function views() {
  const read = name => fs.readFileSync(path.join(web, name), 'utf8');
  const load = name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);
  const [{ h, cloneElement }, { default: htm }, route] = await Promise.all([load('vendor/preact.module.js'), load('vendor/htm.module.js'), load('route.js')]);
  const strip = s => s.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const hooks = { useState: init => [typeof init === 'function' ? init() : init, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }) };
  const chartSource = read('charts.js');
  const chart = new Function(`${strip(chartSource.slice(chartSource.indexOf('export const COLORS'), chartSource.indexOf('// 1-2-5')))}; return { C: COLORS, fmt, dayLabel };`)();
  const base = { h, cloneElement, htm, ...hooks, ...chart };
  const evaluate = (source, extra, result) => {
    const env = { ...base, ...extra };
    return new Function(...Object.keys(env), `${strip(source)}; return ${result};`)(...Object.values(env));
  };
  const viz = evaluate(read('viz.js'), {}, '{ SOURCE, modelColors, share, SegBar, ShareBar, Spark, Delta, RunScatter, ForecastPlot, forecastText, Flag, runStatus, stamp, Radar, Ring, Donut, HBar }');
  const flow = new Function('h', 'htm', `${strip(read('flow-diagram.js'))}; return { FlowDiagram };`)(h, htm);
  return evaluate(read('app.js').split("const root = document.getElementById('app');")[0], {
    ...viz, ...flow, readRoute: route.readRoute, hashOf: route.hashOf, routeParams: route.hashParams,
    Chart: props => h('chart-fixture', props), location: { hash: '#overview?days=14' }, document: { documentElement: { dataset: {} } }
  }, '{ App, Page, Overview, Work, Cost, Machine, Trace, UsageCard, quotaTone, Attention, PAGES, Ring, Donut, HBar, YearHeat, streaks, usedTone }');
}

function elements(node, out = []) {
  if (Array.isArray(node)) { node.forEach(x => elements(x, out)); return out; }
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return elements(node.type(node.props), out);
    out.push(node); elements(node.props?.children, out);
  } else out.push(String(node));
  return out;
}
const strings = tree => tree.filter(x => typeof x === 'string').join(' ').replace(/\s+/g, ' ');
const cards = tree => tree.filter(x => x.type === 'section' && x.props.class?.split(' ').includes('card'));

/* Intent: execute the findings card templates with data, empty state and ontology copy.
 * Status: fixture-only. Next: host 1440/390 checks. Blockers: no layout engine. Confidence: rendered props. */
test('Work findings UI: full-width stacked categories, weekly chart, worker chips and empty state', async t => {
  const ui = await views(), s = new Store(':memory:'); t.after(() => s.close());
  const metrics = { first_pass: { label: 'Fixture clean label', definition: 'Fixture clean definition.' } };
  const category = { category: 'logic-bug', label: 'Logic defect', countermeasure: 'Give a worked example.', count: 6, byLayer: { 1: 1, 2: 2, 3: 3 } };
  const d = { metrics, findings: { total: 6, byCategory: [category],
    byWeek: [{ week: '2026-11-09', categories: [{ category: 'logic-bug', label: 'Logic defect', count: 6 }] }],
    byWorker: [{ model: 'gpt-6-sol', categories: [{ category: 'logic-bug', label: 'Logic defect', count: 6 }] }] } };
  const tree = elements(ui.Work({ d })), sections = cards(tree);
  const card = sections.find(c => strings(elements(c)).includes('Where do agents go wrong?'));
  assert.ok(card.props.class.split(' ').includes('span-all'));
  assert.ok(strings(elements(sections[sections.indexOf(card) - 1])).includes('Is quality getting better?'));
  const content = elements(card), track = content.find(n => n.props?.class === 'hbar-track');
  assert.match(track.props.title, /Give a worked example/);
  assert.equal(content.filter(n => n.props?.class === 'hbar-value')[0].props.children, '6');
  const segments = content.filter(n => n.type === 'i' && n.props.title?.startsWith('L'));
  assert.equal(segments.length, 3);
  segments.forEach((n, i) => {
    assert.match(n.props.title, /Give a worked example/);
    assert.ok(n.props.style.startsWith(`flex:${(i + 1) / 6} 0 0;`));
  });
  const chart = content.find(n => n.type === 'chart-fixture');
  assert.equal(chart.props.stacked, true); assert.deepEqual(chart.props.days, ['2026-11-09']);
  assert.deepEqual(chart.props.series.map(x => [x.label, x.kind, x.data]), [['Logic defect', 'bar', [6]]]);
  assert.ok(chart.props.series.every(x => !x.scale || x.scale === 'y'));
  assert.equal(content.filter(n => n.props?.class === 'finding-chip').length, 1);
  assert.match(strings(content), /gpt-6-sol/); assert.match(strings(content), /L\s*1.*L\s*2.*L\s*3/);
  assert.match(JSON.stringify(tree), /Fixture clean definition/);
  assert.doesNotMatch(JSON.stringify(tree), /Pass first time|Passed first time|Existing first-pass KPI/);
  const r = q.range(7), overview = elements(ui.Overview({ d: { ...q.pages.overview(s.db, r), metrics }, range: r }));
  assert.match(JSON.stringify(overview), /Fixture clean definition/);
  assert.doesNotMatch(JSON.stringify(overview), /Existing first-pass KPI/);
  for (const findings of [undefined, { total: 0, byCategory: [], byWeek: [], byWorker: [] }]) {
    const empty = elements(ui.Work({ d: { findings } }));
    assert.match(strings(empty), /No typed findings yet - they start with the next review\./);
    assert.ok(!empty.some(n => n.props?.class === 'finding-chip'));
  }
});

test('v11 UI: Overview and model rings use the ontology label with Clean first pass fallback', async t => {
  const ui = await views(), s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(7), overview = q.pages.overview(s.db, r);
  for (const label of [undefined, 'Fixture certified label']) {
    const metrics = label ? { first_pass: { label } } : undefined;
    const expected = label || 'Clean first pass';
    const o = strings(elements(ui.Overview({ d: { ...overview, metrics }, range: r })));
    const w = strings(elements(ui.Work({ d: { metrics, models: [{ model: 'fixture', runs: 1, cleanPct: 0 }] } })));
    assert.ok(o.includes(expected)); assert.ok(w.includes(expected));
    assert.ok(!o.includes('Pass first time')); assert.ok(!w.includes('First pass'));
  }
});

test('slim UI: all six actual views render empty query data; navigation has exactly six labels', async t => {
  const ui = await views(), s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(14);
  assert.deepEqual(ui.PAGES.map(p => p.id), ids);
  const app = elements(ui.App()), nav = app.find(x => x.type === 'nav');
  assert.deepEqual(elements(nav).filter(x => x.type === 'button').map(x => x.props.title), ['Overview', 'Flow', 'Work', 'Usage', 'Machine', 'Trace']);
  for (const id of ids) {
    const d = id === 'flow' ? undefined : q.pages[id](s.db, r);
    if (id === 'overview') d.workerModels = q.pages.work(s.db, r).models;
    const tree = elements(ui.Page({ id, p: { data: d, range: r, now: r.now } }));
    assert.ok(tree.length, id);
    if (id === 'work' || id === 'machine') assert.equal(cards(tree).length, id === 'work' ? 7 : 6, id);
    if (id === 'cost') assert.equal(cards(tree).length, 5);
    if (id === 'overview') {
      assert.equal(cards(tree).length, 3);
      assert.equal(tree.filter(x => x.props?.class?.startsWith('card kpi')).length, 4);
      assert.match(strings(tree), /0 of 0 runs/);
      assert.doesNotMatch(strings(tree), /Do this now|Active streak|Tokens in range|Which model for which work/);
    }
    if (id === 'trace') {
      assert.match(strings(tree), /No failed or lost runs in this range/);
      assert.equal(tree.find(x => x.type === 'button' && x.props.children === 'Problems only').props['aria-pressed'], true);
    }
  }
});

test('slim UI: quota thresholds, tick positions, stale stamp and attention links', async () => {
  const ui = await views();
  for (const [pace, usedPct, color] of [[1, 69, 'kafka'], [1.01, 20, 'warn'], [1.3, 20, 'warn'], [1.31, 20, 'bad'], [0.5, 70, 'warn'], [0.5, 85, 'bad']]) {
    assert.equal(ui.quotaTone({ source: 'claude', pace, usedPct }), `var(--${color})`);
  }
  assert.equal(ui.quotaTone({ source: 'codex', pace: null, usedPct: 20 }), 'var(--nebula)');
  const rows = ['seven_day', 'five_hour'].map(window => ({ source: 'claude', window, name: window, usedPct: 80, leftPct: 20, pace: 1.29, hoursLeft: 105.6, projectedAtReset: 125 }));
  const tree = elements(ui.UsageCard({ u: { rows, stale: true, lastRun: 100 }, quotas: rows.map(r => ({ ...r, elapsedPct: 62 })) }));
  assert.match(strings(tree), /data as of/); assert.match(strings(tree), /stale/); assert.match(strings(tree), /reset 4.4 d/);
  assert.equal(tree.filter(x => x.props?.class === 'quota-name')[0].props.children, 'five_hour');
  assert.equal(tree.find(x => x.props?.class === 'quota-tick').props.style, 'left:62%');
  assert.equal(tree.find(x => x.props?.class === 'quota-tick projected').props.style, 'left:100%');
  const track = tree.find(x => x.props?.class === 'quota-track');
  assert.doesNotMatch(strings(elements(track)), /left/, 'left label sits outside the fill');
  const attn = elements(ui.Attention({ days: 30, items: ['review-fail', 'ledger-fail', 'collector', 'anomaly', 'failed'].map(kind => ({ kind, n: 1 })) }));
  assert.deepEqual(attn.filter(x => x.type === 'a').map(x => x.props.href), ['#work?days=30', '#work?days=30', '#machine?days=30', '#cost?days=30']);
});

test('slim UI: Work graphics, shortened notes and Machine row limits', async () => {
  const ui = await views(), note = '<script>' + 'long note '.repeat(15);
  const days = q.range(7).list;
  const tree = elements(ui.Work({ d: {
    calendar: q.range(365).list.map((day, i) => ({ day, messages: i % 5, runs: i % 3, tasks: i % 2 })),
    radar: { axes: ['Speed', 'Quality', 'Rework', 'Cache', 'Reliability', 'Volume'].map(label => ({ label, formula: `${label} formula`,
      claude: { score: 60, value: 'fixture', n: 5 }, codex: { score: 80, value: 'fixture', n: 5 } })), notes: ['First note', 'Second note', 'Third note', 'Hidden fourth note'] },
    daily: { days, clean: days.map(() => 2), hadFindings: days.map(() => 1), pass7: days.map(() => 66.7) },
    tiers: [{ tier: 'Important', tasks: 2, clean: 1, hadFindings: 1, firstPassPct: 50, layer2Pct: 50, defects: { L1: 1, L2: 2, L3: 3 } }],
    models: [{ model: 'fixture', runs: 3, exit0Pct: 50, medianSecs: 100, cleanPct: null }],
    weeks: [{ week: '2026-11-09', tasks: 2, firstPassPct: 50 }], violations: Array.from({ length: 9 }, () => ({ day: '2026-11-15', note }))
  } }));
  const notes = tree.filter(x => x.type === 'span' && x.props.title === note);
  assert.equal(notes.length, 5); assert.equal(notes[0].props.children.length, 90);
  assert.ok(!tree.some(x => x.type === 'script'));
  assert.equal(tree.filter(x => x.type === 'path' && x.props.class?.startsWith('poly ')).length, 2);
  assert.match(strings(tree), /Quality formula/); assert.doesNotMatch(strings(tree), /Hidden fourth note/);
  assert.equal(tree.filter(x => x.type === 'div' && x.props.class?.startsWith('stat-ring')).length, 2);
  assert.ok(tree.some(x => x.type === 'svg' && x.props['aria-label']?.includes('Defects caught')));
  const machine = elements(ui.Machine({ d: { sample: { ts: 100, ram: { freePct: 20, commitPct: 60 }, drives: [{ d: 'C:', usedPct: 60 }, { d: 'D:', usedPct: 91 }] }, stale: true, hookErrors: 2, hookTimeouts: 3,
    daily: { days, ramMin: days.map(() => 15), ramAvg: days.map(() => 25), commitMax: days.map(() => 80) },
    processes: Array.from({ length: 9 }, (_, i) => ({ name: `process-${i}`, mb: 900 - i * 100, count: 2 })),
    hooks: Array.from({ length: 9 }, (_, i) => ({ script: `hook-${i}`, p95_ms: 200, timeoutMs: 1000 })),
    folders: Array.from({ length: 9 }, (_, i) => ({ label: `folder-${i}`, bytes: 1000, growthPerDay: [null, 1000, -1000][i % 3] })),
    alerts: Array.from({ length: 9 }, (_, i) => ({ ts: i + 1, text: `alert-${i}`, rule: 'g' })) } }));
  assert.match(strings(machine), /91%/);
  assert.doesNotMatch(strings(machine.filter(x => x.type !== 'title')), /hook-6|folder-6|process-6/);
  assert.equal(machine.filter(x => x.props?.class === 'hbar-marker').length, 6);
  assert.equal(machine.filter(x => x.type === 'div' && x.props.class?.startsWith('stat-ring')).length, 4);
  assert.match(strings(machine), /\+1 KB \/ day/); assert.match(strings(machine), /-1 KB \/ day/);
  const alerts = machine.filter(x => x.props?.class === 'alert-item');
  assert.equal(alerts.length, 4); assert.match(strings(elements(alerts[0])), /alert-8/);
  assert.equal(machine.filter(x => x.type === 'circle' && x.props.class === 'alert-dot').length, 9);
});

test('slim UI: Usage tabs cap at five and All/Output switches chart data', async t => {
  const ui = await views(), s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(1), d = q.pages.cost(s.db, r);
  d.claude.output = [4]; d.claude.input = [6];
  for (const key of ['tools', 'skills', 'mcp', 'subagents']) d.tops[key] = { total: 9, distinct: 9, rows: Array.from({ length: 9 }, (_, i) => ({ name: `${key}-${i}`, calls: 1, sharePct: 11, last7: 1, prev7: 0 })) };
  const draw = () => elements(ui.Cost({ d, now: r.now }));
  let tree = draw(); assert.equal(tree.find(x => x.type === 'chart-fixture').props.series[0].data[0], 10);
  tree.find(x => x.type === 'button' && x.props.children === 'Output').props.onClick();
  tree = draw(); assert.equal(tree.find(x => x.type === 'chart-fixture').props.series[0].data[0], 4);
  for (const [key, label] of [['tools', 'Tools'], ['skills', 'Skills'], ['mcp', 'MCP'], ['subagents', 'Sub-agents']]) {
    tree.find(x => x.type === 'button' && x.props.children === label).props.onClick(); tree = draw();
    assert.match(strings(tree), new RegExp(`${key}-4`)); assert.doesNotMatch(strings(tree), new RegExp(`${key}-5`));
    assert.equal(cards(tree).length, 5);
  }
});

test('slim UI: Trace initially shows problem sessions, All restores clean sessions', async () => {
  const ui = await views(), now = Math.floor(Date.now() / 1000);
  const run = (id, exit, start = now - 100) => ({ run_id: id, model: 'fixture', project: 'repo', started: start, ended: exit == null ? null : now - 10, exit_code: exit, branch: null });
  const good = run('good', 0), bad = run('bad', 1), same = run('same', 0), lost = run('lost', null, now - 3 * 86400);
  const session = (id, runs) => ({ session_id: id, project: 'repo', runs, dispatches: [] });
  const d = { sessions: [session('clean', [good]), session('problem', [bad, same]), session('lost', [lost])], scatter: [good, bad, same, lost], start: now - 4 * 86400 };
  let tree = elements(ui.Trace({ d }));
  assert.equal(tree.filter(x => x.props?.class?.startsWith('srow')).length, 2);
  assert.match(strings(tree), /exit 0 1 failed 1 running 0 lost 1/);
  const all = tree.find(x => x.type === 'button' && elements(x).includes('All')); all.props.onClick();
  tree = elements(ui.Trace({ d })); assert.equal(tree.filter(x => x.props?.class?.startsWith('srow')).length, 3);
});

test('slim routes: every retired hash redirects, including model keys', async () => {
  const route = await import(`data:text/javascript;base64,${fs.readFileSync(path.join(web, 'route.js')).toString('base64')}`);
  for (const [old, page] of Object.entries({ supervisor: 'work', workers: 'work', gates: 'work', productivity: 'work',
    system: 'machine', harness: 'machine', models: 'cost', 'models/a%2Fb': 'cost', 'models/%E0%A4%A': 'cost', usage: 'cost', nope: 'overview' })) {
    assert.deepEqual(route.readRoute(`#${old}?days=30`, ids, [7, 14, 30]), { page, days: 30, model: null }, old);
  }
});

test('slim queries: empty database preserves unknowns and compact shapes', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(90), w = q.pages.work(s.db, r), m = q.pages.machine(s.db, r);
  assert.deepEqual(Object.keys(w).sort(), ['calendar', 'daily', 'findings', 'metrics', 'models', 'radar', 'tiers', 'violations', 'weeks']);
  assert.equal(w.calendar.length, 365); assert.equal(w.radar.axes.length, 6);
  assert.deepEqual(w.daily.days, r.list); assert.ok(w.daily.clean.every(x => x === 0));
  assert.ok(w.daily.hadFindings.every(x => x === 0)); assert.ok(w.daily.pass7.every(x => x === null));
  assert.deepEqual(w.models, []); assert.deepEqual(w.tiers, []); assert.deepEqual(w.violations, []);
  assert.equal(w.weeks.length, 8); assert.ok(w.weeks.every(x => x.tasks === 0 && x.firstPassPct === null));
  assert.deepEqual(Object.keys(m).sort(), ['daily', 'folders', 'hookErrors', 'hookTimeouts', 'hooks', 'processes', 'sample', 'stale']);
  assert.deepEqual(m.daily.days, r.list); assert.ok(m.daily.ramMin.every(x => x === null)); assert.deepEqual(m.processes, []);
  assert.equal(m.sample, null); assert.equal(m.hookErrors, 0); assert.equal(m.hookTimeouts, 0);
  assert.deepEqual(m.hooks, []); assert.deepEqual(m.folders, []);
});

test('slim queries: compose the existing collector fixture without changing legacy payloads', t => {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'slim-')), env = fixture.environment(root);
  let s;
  t.after(() => { s?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fixture.populate(env);
  const collected = spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), '--full'], { env, encoding: 'utf8' });
  assert.equal(collected.status, 0, collected.stderr);
  s = new Store(env.LINE_HUB_DB);
  const r = q.range(90), w = q.pages.work(s.db, r), m = q.pages.machine(s.db, r);
  const workers = q.pages.workers(s.db, r), gates = q.pages.gates(s.db, r), system = q.pages.system(s.db, r), harness = q.pages.harness(s.db, r);
  assert.ok(w.models.length); assert.ok(w.tiers.length);
  assert.deepEqual(w.tiers.map(x => x.tier), gates.tiers.filter(x => x.tasks).map(x => x.tier));
  for (const row of w.models) {
    const old = workers.models.find(x => x.model === row.model);
    assert.equal(row.runs, old.runs); assert.equal(row.exit0, old.exit0); assert.equal(row.finished, old.finished);
    assert.equal(row.medianSecs, old.medianSecs);
    assert.equal(row.cleanPct, workers.byModel.find(x => x.model === row.model)?.cleanPct ?? null);
  }
  assert.deepEqual(w.weeks, gates.weeks.map(({ week, tasks, firstPassPct }) => ({ week, tasks, firstPassPct })));
  assert.deepEqual(w.violations, gates.violations.slice(0, 5));
  assert.equal(m.hookErrors, harness.hookErrors.reduce((a, b) => a + b, 0));
  assert.equal(m.hookTimeouts, harness.hookTimeouts.reduce((a, b) => a + b, 0));
  assert.equal(m.stale, system.stale); assert.ok(m.hooks.length <= 6); assert.ok(m.folders.length <= 6);
  assert.deepEqual(m.daily, system.daily);
  assert.deepEqual(w.radar.axes, q.pages.supervisor(s.db, r).radar.capability.axes);
});

test('slim Machine: lowest drive, hook timeout-share ordering and six largest folders', t => {
  const s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(14);
  s.insert('system_samples', { ts: r.now - 1200, day: r.today, ram_free_mb: 200, ram_total_mb: 1000,
    commit_used_mb: 600, commit_limit_mb: 1000, top: '[]', drives: JSON.stringify([{ d: 'C:', total: 1000, free: 400 }, { d: 'D:', total: 1000, free: 90 }]) });
  const folders = ['claude_projects', 'codex_sessions', 'codex_total', 'claude_runs', 'temp_claude', 'line_hub', 'wsl_vhdx', 'docker_vhdx'];
  folders.forEach((subject, i) => s.insert('system_daily', { day: r.today, metric: 'folder_bytes', subject, value: (i + 1) * 1000, drive: 'D:' }));
  for (let i = 0; i < 8; i++) {
    const script = s.intern('script', `hook-${i}`), event = s.intern('event', 'Stop');
    s.insert('hook_events', { id: `h-${i}`, session_id: 'fixture', ts: r.now, day: r.today, script, event, status: s.intern('status', 'success'), duration_ms: 800 - i * 10, exit_code: 0 });
    s.insert('hook_limits', { script, event, timeout_ms: 8000 - i * 1000 });
  }
  const m = q.pages.machine(s.db, r);
  assert.equal(m.sample.ts, r.now - 1200); assert.deepEqual(m.sample.ram, { freePct: 20, commitPct: 60 });
  assert.deepEqual(m.sample.lowestDrive, { d: 'D:', freePct: 9 });
  assert.deepEqual(m.sample.drives.map(x => [x.d, x.usedPct]), [['C:', 60], ['D:', 91]]);
  assert.equal(m.stale, true);
  assert.deepEqual(m.hooks.map(x => x.script), ['hook-7', 'hook-6', 'hook-5', 'hook-4', 'hook-3', 'hook-2']);
  assert.deepEqual(m.folders.map(x => x.bytes), [8000, 7000, 6000, 5000, 4000, 3000]);
});

test('slim HTTP: new endpoints and Machine alerts coexist with every legacy endpoint', async t => {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'slim-http-')), db = path.join(root, 'hub.db');
  new Store(db).close();
  fs.writeFileSync(path.join(root, 'alerts.jsonl'), JSON.stringify({ ts: 100, rule: 'g', text: 'fixture alert' }) + '\n');
  const server = start({ db, port: 0, systemDir: root });
  t.after(() => { server.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await new Promise(resolve => server.on('listening', resolve));
  const get = page => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: `/api/${page}?days=14` }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', x => { body += x; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  }).on('error', reject));
  for (const page of Object.keys(q.pages)) {
    const result = await get(page); assert.equal(result.status, 200, page);
    if (page === 'machine' || page === 'system') assert.deepEqual(result.body.data.alerts, [{ ts: 100, rule: 'g', text: 'fixture alert' }]);
  }
});

/* Intent: prove H11 daily quality denominators, history at the range edge and restored payloads.
 * Status: fixture-only. Next: host screenshots. Blockers: no layout engine. Confidence: exact counts. */
test('chart pages: daily quality includes six prior days, findings without FAIL and zero-task gaps', async t => {
  const ui = await views(), s = new Store(':memory:'); t.after(() => s.close());
  const r = q.range(7), history = q.range(14, r.now).list;
  const add = (id, day, findings, fails) => s.insert('ledger', { id, day, tier: s.intern('tier', 'Important'), layer2: 1,
    l1_raw: String(findings), l2_raw: '0', l3_raw: '0', l1_count: findings, l2_count: 0, l3_count: 0,
    fail_rounds: fails, model: s.intern('model', 'gpt-test'), note: id });
  add('prior', history[6], 0, 0); add('first', r.list[0], 1, 0); add('last', r.today, 0, 0);
  add('fail-only', r.today, 0, 1); add('future', '2099-01-01', 0, 0);
  const w = q.pages.work(s.db, r);
  assert.deepEqual(w.daily.clean, [0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(w.daily.hadFindings, [1, 0, 0, 0, 0, 0, 1]);
  assert.equal(w.daily.pass7[0], 50); assert.equal(w.daily.pass7.at(-1), 33.3);
  assert.equal(w.tiers[0].clean, 1); assert.equal(w.tiers[0].hadFindings, 2);
  assert.equal(w.calendar.length, 365); assert.equal(w.calendar.at(-1).tasks, 2);
  const wt = elements(ui.Work({ d: w })), quality = wt.find(x => x.type === 'chart-fixture');
  assert.equal(quality.props.stacked, true); assert.equal(quality.props.series[2].scale, 'y2');
  assert.deepEqual(quality.props.days, r.list); assert.deepEqual(quality.props.series[2].data, w.daily.pass7);
  assert.equal(wt.filter(x => x.props?.class?.match(/^cell l/)).length, 365);
  assert.deepEqual(cards(wt).map(x => elements(x).find(n => n.type === 'h3').props.children), [
    'When was the harness active?', 'Claude vs Codex', 'Did tasks pass review?',
    'Is quality getting better?', 'Where do agents go wrong?', 'Which worker model does good work?', 'Important work that skipped review'
  ]);
  const processes = Array.from({ length: 8 }, (_, i) => [`process-${i}`, (i + 1) * 100, 1]);
  s.insert('system_samples', { ts: r.now, day: r.today, ram_free_mb: 200, ram_total_mb: 1000,
    commit_used_mb: 600, commit_limit_mb: 1000, top: JSON.stringify(processes), drives: '[]' });
  for (const [metric, value] of [['ram_free_min_pct', 10], ['ram_free_avg_pct', 20], ['commit_max_pct', 90]]) {
    s.insert('system_daily', { day: r.today, metric, subject: '', value });
  }
  const m = q.pages.machine(s.db, r);
  assert.deepEqual(m.processes.map(p => p.mb), [800, 700, 600, 500, 400, 300]);
  assert.equal(m.daily.ramMin.at(-1), 10); assert.equal(m.daily.ramAvg.at(-1), 20); assert.equal(m.daily.commitMax.at(-1), 90);
  const mt = elements(ui.Machine({ d: m, range: r, now: r.now }));
  assert.deepEqual(mt.find(x => x.type === 'chart-fixture').props.series.map(x => x.data.at(-1)), [10, 20, 90]);
  assert.ok(elements(ui.Work({ d: {} })).length); assert.ok(elements(ui.Machine({ d: {} })).length);
  for (const [used, tone] of [[69, 'aurora'], [70, 'warn'], [85, 'warn'], [86, 'bad'], [null, 'muted']]) {
    assert.equal(ui.usedTone(used), `var(--${tone})`);
  }
});

test('chart helpers: rings clamp percentages, donuts normalize counts, missing values stay unknown', async () => {
  const ui = await views();
  for (const [value, expected] of [[-20, 0], [140, 100], [50, 50], [null, null], [NaN, null]]) {
    const tree = elements(ui.Ring({ value, label: 'Test' }));
    assert.match(strings(tree), expected === null ? /–/ : new RegExp(`${expected}%`));
    const arc = tree.find(x => x.props?.class === 'ring-value');
    assert.equal(arc?.props['stroke-dasharray'], expected === null ? undefined : `${expected} 100`);
  }
  for (const parts of [[], [{ label: 'Unknown', v: null }], [{ label: 'Bad', v: -4 }, { label: 'L1', v: 200 }, { label: 'L2', v: 100 }]]) {
    const tree = elements(ui.Donut({ parts, label: 'Defects' }));
    const arcs = tree.filter(x => x.props?.class === 'donut-segment');
    for (const arc of arcs) {
      const percent = Number(arc.props['stroke-dasharray'].split(' ')[0]);
      assert.ok(percent >= 0 && percent <= 100);
    }
    assert.doesNotMatch(JSON.stringify(tree), /NaN|Infinity/);
  }
  assert.equal(ui.streaks([{ runs: 1 }, { runs: 1 }, { runs: 0 }], 'runs').current, 2);
  const calendar = [{ day: '2026-11-14', messages: 2, runs: 1, tasks: 0 }, { day: '2026-11-15', messages: 3, runs: 0, tasks: 1 }];
  let tree = elements(ui.YearHeat({ days: calendar }));
  assert.equal(tree.find(x => x.type === 'button' && x.props.children === 'Worker runs').props.class, 'chip on');
  tree.find(x => x.type === 'button' && x.props.children === 'Tasks').props.onClick();
  tree = elements(ui.YearHeat({ days: calendar }));
  assert.equal(tree.find(x => x.type === 'button' && x.props.children === 'Tasks').props.class, 'chip on');
});

/* Intent: execute the real Chart effect against a recording uPlot, including legacy stacked bars.
 * Status: regression. Next: canvas screenshots on host. Blockers: no canvas here. Confidence: data and options. */
test('uPlot stacking: only primary-axis bars accumulate; lines and y2 retain raw values', async () => {
  const read = name => fs.readFileSync(path.join(web, name), 'utf8');
  const [{ h }, { default: htm }] = await Promise.all(['preact.module.js', 'htm.module.js'].map(name =>
    import(`data:text/javascript;base64,${Buffer.from(read(`vendor/${name}`)).toString('base64')}`)));
  let captured, effect, refs;
  class Plot {
    static paths = { bars: () => () => {} };
    constructor(opts, data) { captured = { opts, data }; this.width = opts.width; this.height = opts.height; this.root = { querySelector: () => null }; }
    setSize() {} destroy() {}
  }
  const source = read('charts.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const Chart = new Function('h', 'htm', 'uPlot', 'useRef', 'useEffect', 'document', 'ResizeObserver', `${source}; return Chart;`)(
    h, htm, Plot, () => ({ current: refs++ === 0 ? { clientWidth: 600, clientHeight: 230 } : null }), fn => { effect = fn; }, {}, class { observe() {} disconnect() {} });
  const draw = (series, stacked = true) => { refs = 0; Chart({ days: ['2026-11-14', '2026-11-15'], series, stacked, y2: { fmt: String } }); effect(); return captured; };
  const clean = { label: 'Clean', kind: 'bar', data: [2, 3], color: '#000000' };
  const dirty = { label: 'Findings', kind: 'bar', data: [1, 2], color: '#000000' };
  const line = { label: 'Pass %', scale: 'y2', data: [66.7, null], color: '#000000' };
  let plot = draw([clean, dirty, line]);
  assert.equal(plot.opts.series.at(-1).label, 'Pass %', 'percentage line draws on top of the bars');
  const values = label => plot.data[plot.opts.series.findIndex(s => s.label === label)];
  assert.deepEqual(values('Clean'), [2, 3]); assert.deepEqual(values('Findings'), [3, 5]); assert.deepEqual(values('Pass %'), [66.7, null]);
  plot = draw([clean, { ...line, scale: 'y' }, dirty, { ...line, label: 'y2 bar', kind: 'bar' }]);
  assert.deepEqual(values('Pass %'), [66.7, null]); assert.deepEqual(values('Findings'), [3, 5]); assert.deepEqual(values('y2 bar'), [66.7, null]);
  plot = draw([clean, dirty]); assert.deepEqual(plot.data, [[0, 1], [3, 5], [2, 3]]);
  plot = draw([clean, dirty], false); assert.deepEqual(plot.data, [[0, 1], [2, 3], [1, 2]]);
});
