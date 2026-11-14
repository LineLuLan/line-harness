/* Intent: H8a tests - rule alignment (a / b / h, evaluateRules), the usage card query, the sampler alert
 *   episodes, toast command shape (injectable exec), read-only DB access, missing DB, alerts.jsonl tail.
 * Status: synthetic fixtures only. Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../collector/db');
const s = require('../collector/sample-system');
const q = require('../server/queries');
const { recentAlerts } = require('../server/server');

const H = 3600, D = 86400;
function tmp(t, name) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `h8a-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A hub DB with quota snapshots: [source, window, account, used, resets_at, window_secs, ts].
function hubDb(dir, now, snaps, lastRun = now - 60) {
  const file = path.join(dir, 'hub.db');
  const store = new Store(file);
  for (const [source, window, account, used, resets, secs, ts] of snaps) {
    store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at,account,window_secs) VALUES (?,?,?,?,?,?,?)',
      ts ?? now - 600, store.intern('source', source), store.intern('window', window), used, resets, store.intern('account', account), secs);
  }
  store.setMeta('last_run_end', String(lastRun));
  store.close();
  return file;
}
const row = (ts, commit = { used: 10, limit: 100 }) => ({ ts, ram: { free: 8000, total: 16000 }, commit, drives: [], top: [{ name: 'node.exe', mb: 900, count: 3 }] });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/* ---------- rule alignment ---------- */
test('rules: a fires on pace > 1.3 (not early) or used >= 85, never for Claude 5-hour; h at 5-hour >= 80; b is commit-only', () => {
  const quota = x => ({ name: 'Codex 7-day', source: 'codex', window: 'primary', pace: 1, early: false, usedPct: 50, leftPct: 50, expired: false, resetsAt: 1_800_000_000, ...x });
  assert.equal(q.RULES.quotaPace, 1.3); assert.equal(q.RULES.quotaUsed, 85); assert.equal(q.RULES.ramFree, undefined);
  assert.equal(q.FIRES.a(quota({ pace: 1.3 })), false); assert.equal(q.FIRES.a(quota({ pace: 1.31 })), true);
  assert.equal(q.FIRES.a(quota({ pace: 3, early: true })), false, 'early pace never counts');
  assert.equal(q.FIRES.a(quota({ pace: null, usedPct: 85 })), true); assert.equal(q.FIRES.a(quota({ usedPct: 84.9 })), false);
  const c5 = quota({ name: 'Claude 5-hour', source: 'claude', window: 'five_hour', pace: 2, usedPct: 90 });
  assert.equal(q.FIRES.a(c5), false, 'Claude 5-hour is rule h, not rule a');
  assert.equal(q.FIRES.h(c5), true); assert.equal(q.FIRES.h({ ...c5, usedPct: 79.9 }), false); assert.equal(q.FIRES.h({ ...c5, usedPct: 80 }), true);
  const h = q.actionBox({ quotas: [c5] });
  assert.equal(h.rule, 'h'); assert.match(h.text, /^Claude 5-hour at 90%: finish the current check, update the handoff, pause Claude work until the window resets\./);
  assert.equal(q.FIRES.b({ freePct: 1, commitPct: 50 }), false); assert.equal(q.FIRES.b({ freePct: 50, commitPct: 90.1 }), true); assert.equal(q.FIRES.b({ freePct: 50, commitPct: 89.9 }), false); assert.equal(q.FIRES.b({ freePct: 50, commitPct: 90 }), false);
  assert.equal(q.actionBox({ ram: { freePct: 50, commitPct: 95 } }).text, 'Commit charge 95% of limit.');
  // Only the longest Codex window counts for rule a.
  const short = quota({ name: 'Codex 5-hour', windowSecs: 5 * H, pace: 3 }), long = quota({ windowSecs: 7 * D, pace: 0.5 });
  assert.equal(q.actionBox({ quotas: [short, long] }).rule, null);
  assert.equal(q.actionBox({ quotas: [short, { ...long, pace: 1.4 }] }).rule, 'a');
});

test('evaluateRules: every firing rule in order a, h, b, f, c, g, d, e; actionBox = the first, without id', () => {
  const x = { quotas: [{ name: 'Codex 7-day', source: 'codex', pace: 2, usedPct: 50, leftPct: 50, expired: false, resetsAt: 1_800_000_000 },
    { name: 'Claude 5-hour', source: 'claude', window: 'five_hour', pace: 1, usedPct: 82, leftPct: 18, expired: false, resetsAt: 1_800_000_000 }],
  ram: { freePct: 50, commitPct: 95 }, strayAgents: true, drives: [{ d: 'C:', freePct: 5 }], bigThreads: [{ id: 'abc', model: 'm', source: 'user', tokens: 60e6 }],
  clean: { now: 30, prev: 70, nNow: 5, nPrev: 5 }, hooks: [{ script: 'x.ps1', p95_ms: 6000, timeoutMs: 10000, over: true }] };
  const all = q.evaluateRules(x);
  assert.deepEqual(all.map(r => r.id), ['a', 'h', 'b', 'f', 'c', 'g', 'd', 'e']);
  for (const r of all) assert.ok(r.text && r.action && r.href && r.level);
  const box = q.actionBox(x);
  assert.equal(box.rule, 'a'); assert.equal('id' in box, false);
  assert.deepEqual(q.evaluateRules({}), []);
  assert.equal(q.actionBox({}).rule, null);
});

/* ---------- usage card ---------- */
test('usage: current-account rows with used / left / reset / pace, projection only on Codex + Claude 7-day, other accounts, freshness by last_run_end', t => {
  const dir = tmp(t, 'usage');
  const now = Math.floor(Date.now() / 1000);
  const file = hubDb(dir, now, [
    ['claude', 'seven_day', 'default', 20, now + 4 * D, 7 * D, now - 2 * D], ['claude', 'seven_day', 'default', 40, now + 4 * D, 7 * D, now - 3600],
    ['claude', 'five_hour', 'default', 30, now + 2 * H, 5 * H],
    ['codex', 'primary', 'acc1', 10, now + 5 * D, 7 * D, now - D], ['codex', 'primary', 'acc1', 25, now + 5 * D, 7 * D, now - 1200],
    ['codex', 'primary', 'acc2', 60, now + 3 * D, 7 * D, now - 7200], ['codex', 'primary', 'acc3', 90, now - 60, 7 * D, now - 9 * D]
  ]);
  const store = new Store(file); store.setMeta('codex_active_account', 'acc1'); store.close();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try { usageChecks(db, now); } finally { db.close(); }
});
function usageChecks(db, now) {
  const u = q.usage(db, now);
  assert.deepEqual(u.rows.map(r => r.name), ['Claude 7-day', 'Claude 5-hour', 'Codex 7-day (acc1)']);
  const c7 = u.rows[0];
  assert.equal(c7.usedPct, 40); assert.equal(c7.leftPct, 60); assert.equal(c7.resetsAt, now + 4 * D); assert.equal(c7.hoursLeft, 96);
  assert.equal(c7.pace, q.pace({ source: 'claude', window: 'seven_day', used_pct: 40, resets_at: now + 4 * D, window_secs: 7 * D }, now).pace);
  const fc = q.forecast(db, now);
  assert.equal(c7.projectedAtReset, fc.find(f => f.window === 'seven_day').projectedAtReset, 'reuses forecast()');
  assert.equal(u.rows[1].projection, false); assert.equal(u.rows[1].projectedAtReset, null);
  assert.equal(u.rows[2].projection, true);
  assert.deepEqual(u.others.map(o => [o.account, o.usedPct, o.leftPct, o.label]), [['acc2', 60, 40, 'other account']], 'acc3 period ended: not listed');
  assert.equal(u.stale, false); assert.equal(u.lastRun, now - 60);
  assert.equal(q.usage(db, now + 2 * H).stale, true, 'over COLLECTOR_FRESH_SECS since last_run_end');
  // Overview carries the card and the routing advice from the same live quotas.
  const o = q.pages.overview(db, q.range(7, now));
  assert.equal(o.usage.rows.length, 3);
  assert.deepEqual(o.route.rows.map(r => r.work)[0], 'Standard-A');
  assert.equal(typeof o.route.codexLevel, 'string');
}

/* ---------- sampler alerts ---------- */
test('alert episodes: start toasts, repeat is silent, a clear under 15 min then refire is silent, a clear of 15 min then refire toasts', () => {
  const state = {};
  const t0 = 1_800_000_000;
  assert.deepEqual(s.alertEpisodes(state, ['a'], t0), ['a']);
  assert.deepEqual(state.alerts.a, { firing: true, since: t0, clearedAt: null, toastedAt: t0 });
  assert.deepEqual(s.alertEpisodes(state, ['a'], t0 + 60), [], 'still firing: no second toast');
  assert.deepEqual(s.alertEpisodes(state, [], t0 + 120), []);
  assert.equal(state.alerts.a.clearedAt, t0 + 120);
  assert.deepEqual(s.alertEpisodes(state, ['a'], t0 + 120 + 14 * 60), [], 'clear for 14 min: same episode');
  assert.deepEqual(s.alertEpisodes(state, [], t0 + 2000), []);
  assert.deepEqual(s.alertEpisodes(state, ['a', 'b'], t0 + 2000 + 15 * 60), ['a', 'b'], 'clear for 15 min: a new episode; b is new');
  assert.equal(state.alerts.a.toastedAt, t0 + 2000 + 15 * 60);
  assert.deepEqual(s.alertEpisodes(state, ['zz'], t0 + 9000), [], 'unknown rule ids are ignored');
});

test('toast delivery: Windows PowerShell 5.1, fixed encoded script, title and body only through env vars, 10 s timeout, never throws', async () => {
  const calls = [];
  const exec = async (file, args, timeout, env) => { calls.push({ file, args, timeout, env }); return { stdout: '' }; };
  const title = 'Line Hub test <&"\'$(Get-Date)>', body = "body `n $env:USERNAME ; exit 3";
  assert.deepEqual(await s.deliverToast(title, body, exec), { ok: true });
  const [c] = calls;
  assert.equal(c.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(c.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(Buffer.from(c.args[3], 'base64').toString('utf16le'), s.TOAST_SCRIPT, 'the fixed script, unchanged');
  assert.ok(!c.args.join(' ').includes('Line Hub test') && !c.args.join(' ').includes('USERNAME'), 'no interpolation into the command');
  assert.ok(!s.TOAST_SCRIPT.includes('Line Hub test'));
  assert.match(s.TOAST_SCRIPT, /\$env:LINE_HUB_TOAST_TITLE/); assert.match(s.TOAST_SCRIPT, /SecurityElement\]::Escape/);
  assert.equal(c.env.LINE_HUB_TOAST_TITLE, title); assert.equal(c.env.LINE_HUB_TOAST_BODY, body);
  assert.equal(c.timeout, 10000);
  // A failing or throwing exec is reported, never thrown.
  assert.equal((await s.deliverToast('t', 'b', async () => ({ error: Object.assign(new Error('x'), { killed: true }) }))).ok, false);
  assert.equal((await s.deliverToast('t', 'b', async () => { throw new Error('boom'); })).ok, false);
});

test('alert input: the hub DB is opened read-only and never changed; a missing DB skips the DB rules', t => {
  const dir = tmp(t, 'ro');
  const now = Math.floor(Date.now() / 1000);
  const file = hubDb(dir, now, [['claude', 'five_hour', 'default', 85, now + H, 5 * H]]);
  const before = sha(file);
  const sqlite = require('node:sqlite');
  const Orig = sqlite.DatabaseSync, opened = [];
  sqlite.DatabaseSync = class extends Orig { constructor(p, o) { opened.push(o); super(p, o); } };
  t.after(() => { sqlite.DatabaseSync = Orig; });
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const x = s.alertInput({ db: file, home }, row(now), now);
  assert.equal(opened.length, 1); assert.equal(opened[0].readOnly, true);
  assert.equal(x.quotas.length, 1); assert.equal(x.quotas[0].window, 'five_hour');
  assert.equal(x.strayAgents, false);
  assert.equal(sha(file), before, 'the DB file is byte-identical');
  // Missing DB: no throw, no file created, no DB rules.
  const missing = path.join(dir, 'none', 'hub.db');
  const y = s.alertInput({ db: missing, home }, row(now, { used: 95, limit: 100 }), now);
  assert.equal(fs.existsSync(missing), false); assert.equal(y.quotas, undefined);
  assert.deepEqual(q.evaluateRules(y).map(r => r.id), ['b'], 'rule b still runs on the fresh row');
});

test('sampler run: alerts log once per episode to alerts.jsonl; delivery only when notify is on; missing DB is silent', async t => {
  const dir = tmp(t, 'run');
  const now = Date.now(), ts = Math.floor(now / 1000);
  const db = hubDb(dir, ts, [['claude', 'five_hour', 'default', 85, ts + 4 * H, 5 * H]]);
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const calls = [];
  const fake = async (file, args, timeout, env) => {
    calls.push(file);
    if (file === 'tasklist.exe') return { stdout: '"node.exe","1","Console","1","1,024 K"' };
    if (file === 'powershell.exe') return { stdout: '20000000 1000000\nC:' }; // commit 95 %
    return { stdout: '' };
  };
  const cfg = { db, hub: dir, home, system: path.join(dir, 'system'), folders: [], notify: false };
  const r1 = await s.sample(cfg, now, fake, true);
  assert.deepEqual(r1.alerts.fired, ['h', 'b']); assert.deepEqual(r1.alerts.toasted, ['h', 'b']);
  assert.ok(!('alerts' in JSON.parse(JSON.stringify(r1))), 'not in the JSON row');
  const log = () => fs.readFileSync(path.join(cfg.system, 'alerts.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(log().map(l => l.rule), ['h', 'b']);
  assert.deepEqual(Object.keys(log()[0]).sort(), ['rule', 'text', 'ts']);
  assert.equal(calls.filter(c => c === s.POWERSHELL).length, 0, 'notify off: no toast process');
  const r2 = await s.sample(cfg, now + 60000, fake, true);
  assert.deepEqual(r2.alerts.toasted, []); assert.equal(log().length, 2, 'second run: no second line');
  const state = JSON.parse(fs.readFileSync(path.join(cfg.system, 'sampler-state.json'), 'utf8'));
  assert.equal(state.alerts.h.firing, true);
  // Notify on: one toast process per new episode, through the same exec.
  const cfg2 = { ...cfg, system: path.join(dir, 'system2'), notify: true };
  await s.sample(cfg2, now, fake, true);
  assert.equal(calls.filter(c => c === s.POWERSHELL).length, 2);
  // Missing DB: only rule b (fresh row) can fire.
  const cfg3 = { ...cfg, db: path.join(dir, 'nope.db'), system: path.join(dir, 'system3') };
  assert.deepEqual((await s.sample(cfg3, now, fake, true)).alerts.fired, ['b']);
  assert.equal(s.config({ LINE_HUB_NOTIFY: '0' }).notify, false); assert.equal(s.config({}).notify, true);
});

test('server: recentAlerts returns the newest 20 valid lines, newest first; a missing file gives []', t => {
  const dir = tmp(t, 'tail');
  const file = path.join(dir, 'alerts.jsonl');
  const lines = Array.from({ length: 25 }, (_, i) => JSON.stringify({ ts: 1000 + i, rule: 'a', text: `t${i}` }));
  lines.splice(20, 0, 'not json', JSON.stringify({ ts: 'x', rule: 'a', text: 'bad' }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const got = recentAlerts(file);
  assert.equal(got.length, 20);
  assert.deepEqual(got[0], { ts: 1024, rule: 'a', text: 't24' });
  assert.equal(got.at(-1).ts, 1005);
  assert.deepEqual(recentAlerts(path.join(dir, 'missing.jsonl')), []);
});

test('alertStep: a DB error keeps episode state (no false clear); state is saved before any toast delivery', async t => {
  const dir = tmp(t, 'dberr');
  const ts = Math.floor(Date.now() / 1000);
  const bad = path.join(dir, 'hub.db'); fs.writeFileSync(bad, 'not a sqlite database at all, just text padding '.repeat(20));
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const cfg = { db: bad, hub: dir, home, system: path.join(dir, 'system'), folders: [], notify: false };
  fs.mkdirSync(cfg.system);
  const state = { alerts: { g: { firing: true, since: ts - 600, clearedAt: null, toastedAt: ts - 600 } } };
  const before = JSON.stringify(state);
  const r = await s.alertStep(cfg, state, row(ts, { used: 95, limit: 100 }), undefined, () => { throw new Error('save must not run'); });
  assert.equal(r.failed, true); assert.deepEqual(r.toasted, []);
  assert.equal(JSON.stringify(state), before, 'firing rule g is not cleared by a DB error');
  // Healthy path: save() runs before delivery, and only when something toasts.
  const ok = { db: path.join(dir, 'none', 'hub.db'), hub: dir, home, system: cfg.system, folders: [], notify: true };
  const order = [];
  const exec = async () => { order.push('deliver'); return { stdout: '' }; };
  const st2 = {};
  await s.alertStep(ok, st2, row(ts, { used: 95, limit: 100 }), exec, () => order.push('save'));
  assert.deepEqual(order, ['save', 'deliver']);
  // Corrupt primitive entry is replaced, not thrown on.
  const st3 = { alerts: { b: 1 } };
  assert.deepEqual(s.alertEpisodes(st3, ['b'], ts), ['b']); assert.equal(st3.alerts.b.firing, true);
});