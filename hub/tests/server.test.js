/* Intent: prove the dashboard server is local-only, read-only, allowlisted and self-stopping.
 * Status: wave 2 contract; UI v4 adds the supervisor page, radars, task classifier and font routes. Next: none. Blockers: none.
 * Confidence: synthetic DB built by the real collector; every page and guard exercised. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const f = require('./fixtures/synthetic');
const { start } = require('../server/server');
const { range, tierOf, layerClean, median } = require('../server/queries');

function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'server-'));
  const env = f.environment(root);
  env.cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  f.populate(env);
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), '--full'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return env;
}
// Windows cannot delete an open DB: stop the server (closing its handle) before removing files.
const done = (t, server, env) => t.after(() => { server.stop(); env.cleanup(); });
function listen(options) {
  const server = start({ port: 0, checkMs: 50, ...options });
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}
function get(port, pathname, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host } }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('every page returns JSON from a collector-built DB without private text', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 60000 });
  done(t, server, env);
  const port = server.address().port;
  for (const page of ['overview', 'supervisor', 'workers', 'cost', 'productivity', 'harness', 'trace']) {
    for (const days of [1, 14, 90, 7777]) {
      const r = await get(port, `/api/${page}?days=${days}`);
      assert.equal(r.status, 200, `${page} ${days}: ${r.body}`);
      const body = JSON.parse(r.body);
      assert.equal(typeof body.data, 'object');
      assert.ok([1, 7, 14, 30, 90, 365].includes(body.range.days));
      assert.ok(!r.body.includes(f.MARKER), `${page} leaks private text`);
      assert.match(r.headers['content-security-policy'], /default-src 'self'/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
  }
  const overview = JSON.parse((await get(port, '/api/overview?days=14')).body).data;
  assert.equal(overview.chart.days.length, 14);
  assert.equal(overview.chart.claude.length, 14);
  assert.ok(overview.chart.claude.reduce((a, b) => a + b, 0) > 0, 'synthetic Claude output is charted');
});

// UI v3: every new field has the shape the web pages read.
test('UI v3 fields: usage, forecast, anomalies, quality, context pressure, scatter', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 60000 });
  done(t, server, env);
  const port = server.address().port;
  const data = async page => JSON.parse((await get(port, `/api/${page}?days=14`)).body).data;
  const isAnomaly = a => typeof a.flag === 'boolean' && typeof a.today === 'number' && typeof a.n === 'number' && typeof a.rule === 'string';
  const isForecast = f => typeof f.source === 'string' && typeof f.window === 'string' && Array.isArray(f.points) && typeof f.enough === 'boolean' && typeof f.n === 'number';

  const o = await data('overview');
  assert.ok(Array.isArray(o.forecast) && o.forecast.every(isForecast));
  assert.ok(isAnomaly(o.anomaly.tokensToday) && isAnomaly(o.anomaly.runsToday));

  const u = await data('cost');
  for (const s of ['claude', 'codex']) for (const k of ['input', 'output', 'cache_read', 'cache_write', 'messages', 'total']) assert.equal(typeof u.totals[s][k], 'number', `${s}.${k}`);
  assert.equal(u.totals.claude.total, u.totals.claude.input + u.totals.claude.output + u.totals.claude.cache_read + u.totals.claude.cache_write);
  assert.ok(u.totals.claude.total > 0 && u.totals.codex.total > 0);
  // Codex fresh input excludes cached tokens (FRESH_INPUT): synthetic input 200, cached 2.
  assert.equal(u.totals.codex.input, 198);
  assert.ok(u.mix.length >= 2 && u.mix.every(m => m.data.length === 14 && typeof m.total === 'number'));
  assert.ok(u.forecast.every(isForecast));
  for (const key of ['tools', 'skills', 'mcp', 'subagents']) {
    const top = u.tops[key];
    assert.equal(typeof top.total, 'number'); assert.equal(typeof top.distinct, 'number');
    assert.ok(top.rows.length >= 1, `${key} has rows`);
    for (const r of top.rows) { assert.equal(r.daily.length, 14); assert.equal(typeof r.last7, 'number'); assert.equal(typeof r.prev7, 'number'); assert.equal(typeof r.sharePct, 'number'); }
  }
  assert.deepEqual(u.tops.skills.rows.map(r => r.name), ['test-skill']);
  assert.deepEqual(u.tops.mcp.rows.map(r => r.name), ['demo']);

  const h = await data('harness');
  for (const k of ['hookErrors', 'hookTimeouts', 'exit72', 'exit73']) { assert.ok(isAnomaly(h.anomaly[k]), k); assert.equal(typeof h.today[k], 'number'); }

  const w = await data('workers');
  assert.ok(w.quality.clean.weeks.length >= 2);
  assert.equal(w.quality.clean.all.length, w.quality.clean.weeks.length);
  assert.ok(w.quality.clean.tiers.every(x => x.cells.length === w.quality.clean.weeks.length));
  assert.equal(w.quality.repair.length, w.quality.clean.weeks.length);
  assert.ok(w.quality.repair.every(x => typeof x.runs === 'number' && typeof x.resumes === 'number'));
  assert.equal(typeof w.quality.lead.n, 'number');
  assert.equal(w.quality.lead.enough, w.quality.lead.n >= 5);
  if (!w.quality.lead.enough) assert.equal(w.quality.lead.medianMin, null, 'never invents a lead time');
  assert.equal(w.quality.lead.buckets.length, 6);
  assert.equal(w.quality.lead.buckets.reduce((a, b) => a + b.n, 0), w.quality.lead.n, 'histogram covers every point');

  const p = await data('productivity');
  assert.equal(p.compactPerDay.length, 14); assert.equal(p.compactPreTokens.length, 14);
  assert.equal(p.compactPerDay.reduce((a, b) => a + b, 0), 1);
  assert.ok(p.compactPreTokens.includes(500));

  const tr = await data('trace');
  assert.ok(Array.isArray(tr.scatter) && tr.scatter.length === 2);
  assert.ok(tr.scatter.every(r => typeof r.run_id === 'string' && typeof r.started === 'number' && 'exit_code' in r && 'model' in r));
  assert.equal(typeof tr.start, 'number');
  assert.deepEqual(tr.truncated, { runsCapped: false, runsTotal: 2, runsShown: 2, sessionsCapped: false,
    sessionsTotal: tr.sessions.length, sessionsShown: tr.sessions.length });
});

test('anomaly rule: median + 2 x MAD, MAD = 0 fallback, short history', () => {
  const { anomaly } = require('../server/queries');
  const hist = [10, 12, 11, 9, 10, 13, 10, 11, 12, 10];
  // median 10.5, MAD 0.5 -> threshold 11.5
  assert.equal(anomaly(hist, 11).flag, false);
  assert.equal(anomaly(hist, 12).flag, true);
  assert.equal(anomaly(hist, 12).threshold, 11.5);
  assert.equal(anomaly(hist, 12).mad, 0.5);
  const flat = Array(28).fill(0);
  assert.equal(anomaly(flat, 0).flag, false);
  assert.equal(anomaly(flat, 1).flag, true, 'MAD = 0 and median 0: any positive value');
  const flat5 = Array(28).fill(5);
  assert.equal(anomaly(flat5, 10).flag, false); assert.equal(anomaly(flat5, 11).flag, true);
  assert.equal(anomaly([1, 2, 3], 100).flag, false, 'under 7 history days: no flag');
});

test('quota forecast: linear fit, 100% crossing, too few points, expired period', t => {
  const { Store } = require('../collector/db');
  const { forecast, fitLine, weekOf } = require('../server/queries');
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'server-fc-'));
  const store = new Store(path.join(root, 'hub.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const now = 1_800_000_000, H = 3600;
  const codex = store.intern('source', 'codex'), claude = store.intern('source', 'claude');
  const week = store.intern('window', 'primary'), five = store.intern('window', 'five_hour'), seven = store.intern('window', 'seven_day');
  store.begin();
  // codex: 10% per hour for 5 h (10..50 %), resets in 10 h -> fit hits 100% 5 h after the last point.
  for (let i = 0; i < 5; i++) store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now - (4 - i) * H, codex, week, 10 + i * 10, now + 10 * H);
  // an older period with another resets_at must be ignored
  store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now - 50 * H, codex, week, 99, now - 20 * H);
  store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now, claude, five, 20, now + 2 * H); // one point
  store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now - 10 * H, claude, seven, 40, now - H); // expired
  store.commit();
  const list = forecast(store.db, now);
  const c = list.find(f => f.source === 'codex');
  assert.equal(c.n, 5); assert.equal(c.enough, true); assert.equal(c.slopePerHour, 10);
  assert.equal(c.synthetic, false, 'now == last snapshot: nothing to add');
  assert.equal(c.projectedRaw, 150); assert.equal(c.projectedAtReset, 100, 'capped'); assert.equal(c.overflow, true);
  assert.equal(c.hit100At, now + 5 * H);
  assert.deepEqual(c.anchor, { ts: now, pct: 50 });
  assert.deepEqual(c.fitStart, { ts: now - 4 * H, pct: 10 });

  // Plateau (reviewer repro): 10 -> 50 % over 5 h, then 20 h with no new snapshot (UNIQUE on
  // used_pct writes no row), reset 10 h from now. Idle time must not count as usage.
  const later = now + 20 * H;
  const store2 = new Store(path.join(root, 'hub2.db'));
  const c2 = store2.intern('source', 'codex'), w2 = store2.intern('window', 'primary');
  store2.begin();
  for (let i = 0; i < 5; i++) store2.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now - (4 - i) * H, c2, w2, 10 + i * 10, later + 10 * H);
  store2.run("INSERT OR REPLACE INTO meta VALUES ('last_run_end', ?)", String(later - 600)); // collector ran 10 min ago
  store2.commit();
  const p = forecast(store2.db, later)[0];
  // Same plateau, but the collector last ran 5 h ago: the plateau is not extrapolated, stale flag set.
  store2.begin();
  store2.run("INSERT OR REPLACE INTO meta VALUES ('last_run_end', ?)", String(later - 5 * H));
  store2.commit();
  const st = forecast(store2.db, later)[0];
  // Already at 100%: reported as "at 100% now", not as a projection.
  store2.begin();
  store2.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', later - 60, c2, w2, 100, later + 10 * H);
  store2.commit();
  const full = forecast(store2.db, later)[0];
  store2.close();
  assert.equal(p.stale, false);
  assert.equal(st.stale, true); assert.equal(st.synthetic, false, 'stale collector: plateau not extrapolated');
  assert.equal(st.collectorLastRun, later - 5 * H); assert.equal(st.idleHours, 20);
  assert.deepEqual(st.anchor, { ts: now, pct: 50 }); assert.equal(st.slopePerHour, 10);
  assert.ok(st.hit100At === null || st.hit100At >= later, 'never in the past, even when stale');
  assert.equal(full.atLimit, true); assert.equal(full.hit100At, later);
  assert.equal(p.synthetic, true); assert.equal(p.idleHours, 20);
  assert.deepEqual(p.anchor, { ts: later, pct: 50 }, 'projection starts now at the actual value');
  assert.ok(p.slopePerHour > 0 && p.slopePerHour < 10, `plateau lowers the slope (${p.slopePerHour})`);
  assert.ok(p.hit100At === null || p.hit100At >= later, 'a crossing is never in the past');
  assert.ok(p.projectedAtReset >= 50 && p.projectedAtReset <= 100);
  assert.ok(Math.abs(p.projectedRaw - (50 + p.slopePerHour * 10)) < 0.2, 'projection = actual now + slope x time left');
  const f5 = list.find(f => f.window === 'five_hour');
  assert.equal(f5.enough, false); assert.equal(f5.n, 1); assert.equal(f5.hit100At, undefined);
  const f7 = list.find(f => f.window === 'seven_day');
  assert.equal(f7.expired, true); assert.equal(f7.enough, false);
  // Slow growth: no crossing, a projection at reset instead.
  const slow = fitLine([{ ts: 0, used_pct: 10 }, { ts: H, used_pct: 11 }]);
  assert.equal(Math.round(slow.at(10 * H)), 20);
  assert.equal(fitLine([{ ts: 5, used_pct: 1 }, { ts: 5, used_pct: 2 }]), null);
  assert.equal(weekOf('2026-11-11'), '2026-11-09'); assert.equal(weekOf('2026-11-09'), '2026-11-09'); assert.equal(weekOf('2026-11-08'), '2026-11-02');
});

test('only allowlisted static files, GET/HEAD and local Host headers are served', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 60000 });
  done(t, server, env);
  const port = server.address().port;
  for (const p of ['/', '/app.js', '/charts.js', '/viz.js', '/style.css', '/vendor/uPlot.esm.js', '/vendor/preact.module.js'])
    assert.equal((await get(port, p)).status, 200, p);
  // UI v4: self-hosted fonts, three families x three subsets; nothing else under /fonts/.
  for (const family of ['manrope', 'space-grotesk', 'jetbrains-mono']) for (const subset of ['latin', 'latin-ext', 'vietnamese']) {
    const r = await get(port, `/fonts/${family}-${subset}-wght-normal.woff2`);
    assert.equal(r.status, 200, `${family} ${subset}`); assert.equal(r.headers['content-type'], 'font/woff2');
  }
  for (const p of ['/fonts/', '/fonts/LICENSE-manrope', '/fonts/../server/server.js', '/fonts/manrope-cyrillic-wght-normal.woff2'])
    assert.equal((await get(port, p)).status, 404, p);
  assert.match((await get(port, '/')).headers['content-security-policy'], /font-src 'self'/);
  for (const p of ['/vendor/../server/server.js', '/%2e%2e/package.json', '/../package.json', '/vendor/LICENSE-htm', '/index.html.bak', '/api/', '/api/constructor', '/api/__proto__'])
    assert.equal((await get(port, p)).status, 404, p);
  assert.equal((await get(port, '/', { method: 'POST' })).status, 405);
  assert.equal((await get(port, '/api/overview', { method: 'DELETE' })).status, 405);
  assert.equal((await get(port, '/', { host: 'evil.example' })).status, 403);
  assert.equal((await get(port, '/', { host: `evil.example:${port}` })).status, 403);
  assert.equal((await get(port, '/', { host: `localhost:${port}` })).status, 200);
  const head = await get(port, '/api/overview', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body, '');
  // The CSP pins the one inline script (the import map) by hash.
  assert.match((await get(port, '/')).headers['content-security-policy'], /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
});

test('a missing DB gives 503 and the server never creates it', async t => {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'server-nodb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = path.join(root, 'none', 'hub.db');
  const server = await listen({ db, idleMs: 60000 });
  t.after(() => server.stop());
  const r = await get(server.address().port, '/api/overview');
  assert.equal(r.status, 503); assert.equal(JSON.parse(r.body).error, 'no-db');
  assert.equal(fs.existsSync(db), false);
});

test('the server stops itself after the idle period', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 150 });
  done(t, server, env);
  await get(server.address().port, '/api/overview');
  const closed = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    server.on('close', () => { clearTimeout(timer); resolve(true); });
  });
  assert.equal(closed, true);
});

test('day ranges follow the calendar across DST changes', () => {
  const script = `const { range } = require(${JSON.stringify(path.resolve(__dirname, '../server/queries'))});
    const check = (y, m, d, h, mi, days) => { const r = range(days, Math.floor(new Date(y, m, d, h, mi).getTime() / 1000));
      return [r.list.length, new Set(r.list).size, r.list[0], r.list.at(-1)].join(' '); };
    console.log([check(2026, 2, 9, 0, 30, 7), check(2026, 10, 2, 23, 30, 7), check(2026, 10, 8, 23, 30, 14)].join('|'));`;
  const r = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '7 7 2026-03-03 2026-03-09|7 7 2026-10-27 2026-11-02|14 14 2026-10-26 2026-11-08');
});

test('latest quota is one pass, fast on a large table, and a ts tie keeps the higher %', async t => {
  const { Store } = require('../collector/db');
  const { pages } = require('../server/queries');
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'server-quota-'));
  const store = new Store(path.join(root, 'hub.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const src = store.intern('source', 'codex'), win = store.intern('window', 'primary');
  const now = Math.floor(Date.now() / 1000);
  store.begin();
  for (let i = 0; i < 10000; i++) store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now - 10000 + i, src, win, (i % 100) + i / 1e6, now + 86400);
  store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now, src, win, 41, now + 86400);
  store.run('INSERT INTO quota_snapshots VALUES (?,?,?,?,?)', now, src, win, 58, now + 86400);
  store.commit();
  const t0 = Date.now();
  const overview = pages.overview(store.db, range(14, now));
  assert.ok(Date.now() - t0 < 1000, `overview took ${Date.now() - t0} ms`);
  assert.equal(overview.quota.length, 1); assert.equal(overview.quota[0].used_pct, 58);
  const cost = pages.cost(store.db, range(14, now));
  assert.ok(cost.quotaLine.length <= 2, 'quota line is aggregated per day');
});

test('invalid port and idle env values fall back to defaults', () => {
  const { envPort, envIdleMin } = require('../server/server');
  assert.equal(envPort({ LINE_HUB_PORT: 'abc' }), 3434); assert.equal(envPort({ LINE_HUB_PORT: '70000' }), 3434);
  assert.equal(envPort({ LINE_HUB_PORT: '0' }), 0); assert.equal(envPort({}), 3434); assert.equal(envPort({ LINE_HUB_PORT: '4000' }), 4000);
  assert.equal(envIdleMin({ LINE_HUB_IDLE_MIN: 'x' }), 30); assert.equal(envIdleMin({ LINE_HUB_IDLE_MIN: '-1' }), 30); assert.equal(envIdleMin({ LINE_HUB_IDLE_MIN: '5' }), 5);
});

test('requests rejected by the Host check do not keep the server alive', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 300 });
  done(t, server, env);
  const port = server.address().port;
  const spam = setInterval(() => get(port, '/', { host: 'evil.example' }).catch(() => {}), 50);
  const closed = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    server.on('close', () => { clearTimeout(timer); resolve(true); });
  });
  clearInterval(spam);
  assert.equal(closed, true);
});

test('query helpers: ranges, tiers, clean layers, median', () => {
  const now = Math.floor(new Date(2026, 10, 11, 12).getTime() / 1000);
  const r = range(7, now);
  assert.equal(r.list.length, 7); assert.equal(r.list[6], '2026-11-11'); assert.equal(r.startDay, '2026-11-05');
  assert.equal(range(5, now).days, 14);
  assert.equal(tierOf('Standard (fix of reviewed findings)'), 'Standard');
  assert.equal(tierOf('Standard-B'), 'Standard-B');
  assert.equal(tierOf('council'), 'Other');
  assert.equal(layerClean('0', 0), true); assert.equal(layerClean('6', 6), false);
  assert.equal(layerClean('PASS (Fable thay Astra)', null), true);
  assert.equal(layerClean('FAIL x2', null), false);
  assert.equal(layerClean('2 P2', null), false);
  assert.equal(median([5, 1, 3]), 3); assert.equal(median([1, 2, 3, 4]), 3); assert.equal(median([]), null);
});

// UI v4: Supervisor page payload shape on a collector-built DB, and on an empty (schema-only) DB.
test('supervisor page: shape, radars, no private text, and an empty DB', async t => {
  const env = setup(t);
  const server = await listen({ db: env.LINE_HUB_DB, idleMs: 60000 });
  done(t, server, env);
  const port = server.address().port;
  const r = await get(port, '/api/supervisor?days=14');
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes(f.MARKER), 'supervisor leaks private text');
  const s = JSON.parse(r.body).data;
  assert.equal(s.days.length, 14);
  for (const k of ['self', 'agents', 'dispatches', 'reviews']) assert.equal(s.work[k].length, 14, k);
  assert.equal(typeof s.sessions.n, 'number'); assert.ok(Array.isArray(s.sessions.top));
  for (const x of s.sessions.top) { assert.equal(x.id.length <= 8, true, 'short session id only'); assert.equal(typeof x.tokens, 'number'); assert.equal(typeof x.peak, 'number'); }
  assert.ok(s.sessions.n >= 1, 'synthetic Claude session is counted');
  for (const k of ['skills', 'mcp', 'subagents']) assert.equal(typeof s.tops[k].total, 'number');
  assert.equal(typeof s.review.tasks, 'number'); assert.ok(s.review.weeks.every(w => ['clean', 'L1', 'L2', 'L3', 'failRounds'].every(k => typeof w[k] === 'number')));
  assert.equal(s.review.weeks.reduce((a, w) => a + w.clean + w.L1 + w.L2 + w.L3, 0), s.review.tasks, 'every task lands in one week bucket');
  assert.ok(s.models.every(m => typeof m.family === 'string' && m.data.length === 14));
  const cap = s.radar.capability;
  assert.deepEqual(cap.axes.map(a => a.key), ['speed', 'quality', 'rework', 'cache', 'reliability', 'volume']);
  for (const a of cap.axes) for (const side of ['claude', 'codex']) {
    const v = a[side];
    assert.ok(v.score === null || (Number.isInteger(v.score) && v.score >= 0 && v.score <= 100), `${a.key} ${side}`);
    if (v.score === null) assert.equal(typeof v.na, 'string', `${a.key} ${side} names why it is n/a`);
    assert.equal(typeof a.formula, 'string');
  }
  assert.equal(cap.axes.find(a => a.key === 'rework').claude.score, null, 'Claude has no stored rework signal');
  assert.ok(cap.notes.length >= 1 && cap.notes.length <= 3);
  const tt = s.radar.tasks;
  assert.deepEqual(tt.axes.map(a => a.key), ['ui', 'data', 'review', 'research', 'docs', 'config']);
  for (const a of tt.axes) for (const side of ['claude', 'codex']) {
    assert.equal(typeof a[side].n, 'number'); assert.equal(a[side].low, a[side].n < 3);
    if (!a[side].n) assert.equal(a[side].pct, null, 'no tasks: no percentage');
  }
  assert.ok(tt.notes.length >= 1 && tt.notes.length <= 3);
  const o = JSON.parse((await get(port, '/api/overview?days=14')).body).data;
  assert.ok(Array.isArray(o.attention) && o.attention.every(a => typeof a.kind === 'string' && ['warn', 'bad'].includes(a.level)));
  for (const k of ['tokens', 'runs', 'tasks']) assert.equal(typeof o.kpi.prev[k], 'number', `prev.${k}`);
  assert.equal(o.chart.claudeAll.length, 14); assert.equal(o.radar.axes.length, 6);

  // Empty DB: the schema only. Every question answers with zeros / nulls, never invented numbers.
  const { Store } = require('../collector/db');
  const { pages } = require('../server/queries');
  const base = path.resolve(__dirname, '..', '.tmp');
  const root = fs.mkdtempSync(path.join(base, 'server-empty-'));
  const store = new Store(path.join(root, 'hub.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const e = pages.supervisor(store.db, range(14));
  assert.equal(e.sessions.n, 0); assert.deepEqual(e.sessions.top, []); assert.equal(e.sessions.median.messages, null);
  assert.equal(e.review.tasks, 0); assert.deepEqual(e.models, []);
  assert.ok(e.work.self.every(v => v === 0));
  assert.ok(e.radar.capability.axes.every(a => a.claude.score === null && a.codex.score === null && a.claude.na && a.codex.na));
  assert.deepEqual(e.radar.capability.notes, ['Not enough data on both sides to compare yet.']);
  assert.ok(e.radar.tasks.axes.every(a => a.claude.n === 0 && a.codex.n === 0 && a.claude.pct === null));
  const eo = pages.overview(store.db, range(14));
  assert.deepEqual(eo.attention.map(a => a.kind), ['collector'], 'only the never-run collector needs attention');
  assert.equal(eo.kpi.prev.exit0Pct, null);
});

test('task-type classifier: keyword rules, ties, no match, and side of a ledger model', () => {
  const { classifyTask, TASK_TYPES, sideOf, failRounds, capabilityNotes, taskNotes } = require('../server/queries');
  assert.deepEqual(TASK_TYPES.map(t => t.key), ['ui', 'data', 'review', 'research', 'docs', 'config']);
  assert.equal(classifyTask('Standard-A Line Hub UI v4: fonts, theme toggle, radar chart'), 'ui');
  assert.equal(classifyTask('Important collector schema v6 migration + parser fix'), 'data');
  assert.equal(classifyTask('Standard audit + verification, lint and QA'), 'review');
  // Outcome words are not review work: "no FAIL, tests pass" must not pull a UI task into review.
  assert.equal(classifyTask('Standard no FAIL, tests pass, UI sidebar'), 'ui');
  assert.equal(classifyTask('review PASS, gate green, 0 findings, verify ok'), 'other');
  assert.equal(classifyTask('Exploration-1 compare models (pilot)'), 'research');
  assert.equal(classifyTask('Skip README and handoff docs'), 'docs');
  assert.equal(classifyTask('Standard codex-do.ps1 dispatcher hook + settings'), 'config');
  assert.equal(classifyTask('Standard misc cleanup'), 'other', 'no keyword: other');
  assert.equal(classifyTask('ui-v4 page'), 'ui', 'hyphen ends a word');
  assert.equal(classifyTask('build a guidebook'), 'other', 'whole words only (guide != guidebook)');
  assert.equal(classifyTask('lint the ui'), 'ui', 'a 1-1 tie goes to the type listed first');
  assert.equal(classifyTask(null), 'other');
  assert.equal(sideOf('gpt-6-astra'), 'codex'); assert.equal(sideOf('Sol'), 'codex'); assert.equal(sideOf('Fable'), 'claude');
  assert.equal(sideOf('opus'), 'claude'); assert.equal(sideOf(null), null); assert.equal(sideOf('council'), null);
  assert.equal(sideOf('console'), null, 'whole words: console is not sol'); assert.equal(sideOf('gpt-5.6-sol'), 'codex');
  assert.equal(sideOf('Fable + Astra'), 'claude', 'first named wins'); assert.equal(sideOf('Astra, then Fable'), 'codex');
  assert.equal(failRounds('FAIL x2'), 2); assert.equal(failRounds('FAIL then FAIL'), 2); assert.equal(failRounds('PASS'), 0);
  assert.equal(failRounds('no FAIL'), 0); assert.equal(failRounds('FAIL x2 then FAIL'), 3); assert.equal(failRounds('0 FAIL, 2 P2'), 0);
  assert.equal(layerClean('no FAIL', null), true); assert.equal(layerClean('FAIL x2 then PASS', null), false);
  const ax = (key, label, claude, codex, n = 10) => ({ key, label, claude: { score: claude, n, na: claude === null ? 'x' : undefined }, codex: { score: codex, n } });
  // Speed (10 vs 95) is the biggest gap but is never compared; a 2-sample axis is skipped too.
  const notes = capabilityNotes([ax('speed', 'Speed vs own target', 10, 95), ax('quality', 'First-pass quality', 45, 80), ax('rework', 'Low rework', null, 90),
    ax('cache', 'Token efficiency', 0, 100, 2), ax('volume', 'Volume', 60, 40)]);
  assert.equal(notes[0], 'Codex is furthest ahead on First-pass quality (80 vs 45); Claude is furthest ahead on Volume (60 vs 40).');
  assert.match(notes[1], /delegate more/);
  assert.equal(notes[2], 'n/a (no stored signal): Low rework for Claude.');
  // A recommendation needs n >= 3: the same scores on 2 ledger tasks recommend nothing.
  const thin = capabilityNotes([ax('quality', 'First-pass quality', 45, 80, 2), ax('volume', 'Volume', 60, 40)]);
  assert.ok(!thin.some(x => /delegate|tighten/.test(x)), thin.join(' | '));
  // Task notes never come back empty, also when only Claude has enough tasks.
  const cell = (n, pct) => ({ n, pct: n ? pct : null, clean: 0, low: n < 3 });
  const only = taskNotes([{ key: 'ui', label: 'UI', claude: cell(4, 75), codex: cell(1, 0) }, { key: 'docs', label: 'Docs', claude: cell(0), codex: cell(0) }]);
  assert.ok(only.length >= 1 && /Claude passes most often on UI/.test(only[0]), only.join(' | '));
});
