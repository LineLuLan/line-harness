/* Intent: tests for schema v8 and UI v5: the system sampler (parsers on fixtures, resumable folder walk),
 *   sampler JSONL ingest + retention + file pruning, the v7 -> v8 migration, pace math, the "Do this now"
 *   rule order, hook limits from settings.json, and the delegation metrics (ledger runs=, packet size,
 *   token origin) on fixtures.
 * Status: synthetic fixtures only. Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Store, SCHEMA_VERSION, storedVersion } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { hookLimits } = require('../collector/sources');
const { parseLedger } = require('../collector/ledger');
const { day, hash } = require('../collector/values');
const s = require('../collector/sample-system');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');
const fx = require('./fixtures/system');

function tmp(t, name) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `v8-${name}-`));
  const stores = [];
  t.after(() => { for (const x of stores) try { x.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, open: file => { const x = new Store(file || path.join(dir, 'hub.db')); stores.push(x); return x; } };
}
const collect = (env, args = []) => spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), ...args], { env, encoding: 'utf8', input: '', timeout: 60000 });
const localTs = (daysAgo, h = 12) => { const d = new Date(); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h).getTime() / 1000); };

test('sampler parsers: tasklist grouped by name, CIM commit + drives, event 2004 names', () => {
  assert.deepEqual(s.parseTasklist(fx.TASKLIST), [['node.exe', 1024, 1], ['chrome.exe', 500, 2], ['Code.exe', 400, 1], ['svchost.exe', 20, 1], ['System Idle Process', 0, 1]]);
  assert.equal(s.parseTasklist(fx.TASKLIST, 2).length, 2);
  assert.deepEqual(s.parseTasklist(''), []);
  assert.deepEqual(s.parseCim(fx.CIM), { commit: { used: Math.round((40044916 - 19091924) / 1024), limit: Math.round(40044916 / 1024) }, drives: ['C:', 'D:'] });
  assert.deepEqual(s.parseCim('garbage'), { commit: null, drives: [] });
  const ev = s.parseEvents(fx.EVENTS);
  assert.equal(ev.length, 2, 'only event id 2004');
  assert.deepEqual(ev[0], { ts: Date.parse('2026-11-12T22:01:00Z') / 1000, top: ['msedge.exe'] });
  assert.deepEqual(ev[1].top, ['node.exe', 'chrome.exe', 'Code.exe', 'vmmem', 'x.exe'], 'unique names, top 5, in order');
  assert.deepEqual(s.parseEvents(''), []);
});

test('folder walk resumes from an index cursor and adds up to one full pass; codex_total = rest + sessions', t => {
  const { dir } = tmp(t, 'walk');
  const make = (rel, size) => f.write(path.join(dir, rel), 'x'.repeat(size));
  for (let i = 0; i < 30; i++) make(`codex/sessions/2026/11/${String(i % 5)}/r${i}.jsonl`, 100 + i);
  for (let i = 0; i < 12; i++) make(`codex/skills/s${i}/a.md`, 10);
  make('codex/config.toml', 7);
  for (let i = 0; i < 40; i++) make(`claude/projects/p${i % 4}/s${i}.jsonl`, 50);
  const full = { cursor: [], bytes: 0, files: 0 };
  assert.equal(s.walkStep(path.join(dir, 'codex'), full, Infinity), true);
  const expected = 30 * 100 + (29 * 30) / 2 + 120 + 7;
  assert.equal(full.bytes, expected); assert.equal(full.files, 43);
  // A clock that runs out every 32 entries forces many resumes.
  let clock = 0; const now = () => (clock += 1);
  const w = { cursor: [], bytes: 0, files: 0 };
  let calls = 0;
  while (!s.walkStep(path.join(dir, 'codex'), w, clock + 2, null, now)) { calls++; assert.ok(w.cursor.every(Number.isInteger), 'the cursor is indexes only'); assert.ok(calls < 500); }
  assert.ok(calls >= 1, 'it really stopped and resumed'); assert.equal(w.bytes, expected); assert.equal(w.files, 43);
  // folderSlice over named folders, with a tiny budget: sizes appear only when the whole pass is done.
  const folders = [{ label: 'codex_sessions', dir: path.join(dir, 'codex', 'sessions') },
    { label: 'codex_total', dir: path.join(dir, 'codex'), skip: path.join(dir, 'codex', 'sessions'), plus: 'codex_sessions' },
    { label: 'claude_projects', dir: path.join(dir, 'claude', 'projects') }, { label: 'line_hub', dir: path.join(dir, 'missing') }];
  const state = {};
  let result = null, slices = 0;
  clock = 0;
  while (!result) { result = s.folderSlice(state, folders, clock + 3, '2026-11-13', now); slices++; assert.ok(slices < 500); }
  assert.ok(slices > 1);
  assert.equal(result.codex_sessions.bytes, 30 * 100 + 435); assert.equal(result.codex_total.bytes, expected);
  assert.equal(result.claude_projects.bytes, 2000); assert.equal(result.line_hub.bytes, 0);
  assert.equal(s.folderSlice(state, folders, Infinity, '2026-11-13'), null, 'done for the day');
  assert.ok(s.folderSlice(state, folders, Infinity, '2026-11-14'), 'a new day starts a new pass');
  assert.ok(!JSON.stringify(state).includes(dir), 'the state holds no path');
});

test('sampler run: writes one JSON line, keeps state, never prints or stores paths, exits 0 on errors', async t => {
  const { dir } = tmp(t, 'sample');
  const cfg = { hub: dir, system: path.join(dir, 'system'), folders: [{ label: 'line_hub', dir: path.join(dir, 'empty') }] };
  const now = Date.now();
  const row = await s.sample(cfg, now);
  const file = path.join(cfg.system, `${s.localDay(now)}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.ts, Math.floor(now / 1000)); assert.ok(parsed.ram.total > 0 && parsed.ram.free >= 0);
  assert.deepEqual(parsed.folders, { line_hub: { bytes: 0, drive: row.folders.line_hub.drive } });
  assert.ok(!lines[0].includes(dir), 'no path in the sample');
  // An unwritable system folder (a file in its place): the CLI logs one line and still exits 0.
  const bad = path.join(dir, 'bad'); fs.writeFileSync(bad, 'x');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../collector/sample-system.js'), '--quiet'],
    { env: { ...process.env, LINE_HUB_DB: path.join(dir, 'hub.db'), LINE_HUB_SYSTEM_DIR: bad }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  assert.match(fs.readFileSync(path.join(dir, 'collect-errors.log'), 'utf8'), /SAMPLER_[A-Z]+\n$/);
});

test('ingest of sampler JSONL: samples, daily metrics, kills, folders; raw kept 7 days, files pruned after 8', t => {
  const { dir, open } = tmp(t, 'ingest');
  const env = f.environment(dir), sys = path.join(dir, 'db', 'system');
  const sample = (ts, freeMb, extra = {}) => ({ ts, ram: { free: freeMb, total: 16000 }, commit: { used: 30000, limit: 40000 },
    drives: [{ d: 'C:', free: 50e9, total: 500e9 }, { d: 'Z:', free: 1, total: 0 }], top: [['node.exe', 900, 4], ['bad|x', 5, 1]], ...extra });
  const write = (d, rows) => f.jsonl(path.join(sys, `${day(d)}.jsonl`), rows);
  write(localTs(0), [sample(localTs(0, 9), 1600), sample(localTs(0, 10), 800, { kills: [{ ts: localTs(0, 9), top: ['node.exe', 'C:\\secret\\x.exe'] }],
    folders: { claude_projects: { bytes: 2e9, drive: 'C:' }, '../etc': { bytes: 5 } } })]);
  write(localTs(6), [sample(localTs(6), 4000, { folders: { claude_projects: { bytes: 1.4e9, drive: 'C:' } } })]);
  write(localTs(10), [sample(localTs(10), 4000)]);
  assert.equal(collect(env, ['--full']).status, 0);
  const store = open(env.LINE_HUB_DB);
  const days = store.all('SELECT day FROM system_samples ORDER BY ts').map(x => x.day);
  assert.deepEqual(days, [day(localTs(6)), day(localTs(0)), day(localTs(0))], 'the 10-day-old raw sample is gone, 6 d kept');
  const metric = (d, m, sub = '') => store.get('SELECT value FROM system_daily WHERE day=? AND metric=? AND subject=?', d, m, sub)?.value;
  assert.equal(metric(day(localTs(0)), 'ram_free_min_pct'), 5); assert.equal(metric(day(localTs(0)), 'ram_free_avg_pct'), 7.5);
  assert.equal(metric(day(localTs(0)), 'commit_max_pct'), 75); assert.equal(metric(day(localTs(0)), 'disk_free_min_pct', 'C:'), 10);
  assert.equal(metric(day(localTs(10)), 'ram_free_min_pct'), 25, 'its daily metrics stay after the raw rows go');
  assert.equal(metric(day(localTs(0)), 'folder_bytes', 'claude_projects'), 2e9);
  assert.equal(store.get("SELECT COUNT(*) n FROM system_daily WHERE subject='../etc'").n, 0, 'unknown folder labels are dropped');
  assert.deepEqual(JSON.parse(store.get('SELECT top FROM system_samples ORDER BY ts DESC').top), [['node.exe', 900, 4]], 'bad process names dropped');
  assert.equal(JSON.parse(store.get('SELECT drives FROM system_samples LIMIT 1').drives).length, 1, 'a drive with total 0 is dropped');
  assert.deepEqual(JSON.parse(store.get('SELECT top FROM memory_kills').top), ['node.exe'], 'a path is never a process name');
  assert.ok(!fs.existsSync(path.join(sys, `${day(localTs(10))}.jsonl`)), 'files older than 8 days are deleted');
  assert.ok(fs.existsSync(path.join(sys, `${day(localTs(6))}.jsonl`)));
  // Incremental: an appended line is read once; a second run adds nothing.
  fs.appendFileSync(path.join(sys, `${day(localTs(0))}.jsonl`), JSON.stringify(sample(localTs(0, 11), 8000)) + '\n');
  store.close();
  assert.equal(collect(env).status, 0); assert.equal(collect(env).status, 0);
  const again = open(env.LINE_HUB_DB);
  assert.equal(again.get('SELECT COUNT(*) n FROM system_samples').n, 4);
  // Server: folders growth + days to full over the 7-day span, latest sample, kills.
  const sys2 = q.pages.system(again.db, q.range(14));
  assert.equal(sys2.sample.ram.freePct, 50); assert.equal(sys2.sample.drives[0].freePct, 10);
  const fold = sys2.folders.find(x => x.key === 'claude_projects');
  assert.equal(fold.growthPerDay, 1e8); assert.equal(fold.growthDays, 6); assert.equal(fold.daysToFull, 500, '50 GB free / 0.1 GB a day');
  assert.equal(sys2.kills.length, 1);
  // Retention of daily rows: 90 days.
  again.run("INSERT INTO system_daily VALUES ('2020-01-01','ram_free_min_pct','',1,NULL)");
  again.close();
  assert.equal(collect(env, ['--full']).status, 0);
  assert.equal(open(env.LINE_HUB_DB).get("SELECT COUNT(*) n FROM system_daily WHERE day='2020-01-01'").n, 0);
});

test('v7 -> v8 migration: the hook skips, --migrate backs up, re-reads ledger runs= and run packet sizes once', t => {
  const { dir, open } = tmp(t, 'mig');
  const env = f.environment(dir);
  f.populate(env);
  const runDir = path.join(env.LINE_HUB_STATE_DIR, 'runs', 'run-1');
  f.write(path.join(runDir, 'stdin.txt'), 'p'.repeat(9000));
  fs.appendFileSync(path.join(env.LINE_HUB_STATE_DIR, 'review-ledger.log'), `${day(localTs(0))}|Standard-A|no|0|0|0|x|worker=sol|runs=run-1,bad id,run-2\n`);
  assert.equal(collect(env, ['--full']).status, 0);
  let store = open(env.LINE_HUB_DB);
  const before = { ledger: store.get('SELECT COUNT(*) n FROM ledger').n, links: store.all('SELECT run_id FROM ledger_runs ORDER BY run_id').map(x => x.run_id) };
  assert.deepEqual(before.links, ['run-1', 'run-2'], 'invalid run ids are dropped');
  assert.equal(store.get("SELECT spec_bytes FROM runs WHERE run_id='run-1'").spec_bytes, 9000);
  // Pretend a v7 collector wrote this DB: no ledger_runs rows, no packet sizes, marker 7.
  store.run('DELETE FROM ledger_runs'); store.run('UPDATE runs SET spec_bytes=NULL'); store.setMeta('schema_version', '7');
  store.close();
  const log = path.join(path.dirname(env.LINE_HUB_DB), 'collect-errors.log');
  assert.equal(collect(env, ['--hook', '--min-interval-s', '0']).status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`INFO_MIGRATION_PENDING_V${SCHEMA_VERSION}`));
  assert.equal(storedVersion(env.LINE_HUB_DB), 7, 'the hook never migrates (read without opening a Store, which would migrate)');
  const m = collect(env, ['--migrate']);
  assert.equal(m.status, 0, m.stderr);
  assert.ok(fs.existsSync(path.join(path.dirname(env.LINE_HUB_DB), 'hub-v7.bak')));
  store = open(env.LINE_HUB_DB);
  assert.equal(store.meta('schema_version'), String(SCHEMA_VERSION)); assert.equal(store.meta('v8_ledger_replay'), undefined);
  assert.equal(store.get('SELECT COUNT(*) n FROM ledger').n, before.ledger, 'no ledger row doubled');
  assert.deepEqual(store.all('SELECT run_id FROM ledger_runs ORDER BY run_id').map(x => x.run_id), before.links);
  const run = store.get("SELECT spec_bytes FROM runs WHERE run_id='run-1'");
  assert.equal(run.spec_bytes, 9000, 'run.json snapshots are re-read once');
  for (const table of ['system_samples', 'system_daily', 'memory_kills', 'ledger_runs', 'hook_limits']) assert.ok(store.get("SELECT 1 FROM sqlite_master WHERE name=?", table), table);
});

test('pace math: even spending, a 5-hour window, early, expired, Codex window_secs, unknown window', () => {
  const H = 3600, now = 1_800_000_000;
  const p = (used, resetIn, window, window_secs = null, source = 'claude') => q.pace({ source, used_pct: used, resets_at: now + resetIn, window, window_secs }, now);
  assert.equal(p(50, 3.5 * 86400, 'seven_day').pace, 1, 'half used at half time');
  const five = p(50, 1.25 * H, 'five_hour');
  assert.deepEqual([five.windowSecs, five.elapsedPct, five.pace, five.hoursLeft, five.early], [5 * H, 75, 0.67, 1.3, false]);
  const early = p(5, 5 * H - 60, 'five_hour');
  assert.ok(early.pace > 1 && early.early === true, 'item 13: a pace as soon as elapsed > 0, flagged early under 5 %');
  assert.equal(p(5, 5 * H, 'five_hour').pace, null, 'nothing elapsed yet');
  const gone = p(80, 0, 'five_hour');
  assert.deepEqual([gone.expired, gone.pace, gone.elapsedPct], [true, null, 100]);
  assert.equal(p(40, 4 * H, 'primary', 5 * H, 'codex').pace, 2, 'Codex window_minutes');
  const unknown = p(10, 6 * 86400, 'primary', null, 'codex');
  assert.deepEqual([unknown.windowSecs, unknown.pace, unknown.unknownWindow], [null, null, true], 'item 12: a legacy Codex row is never assumed 7 d');
  assert.equal(q.quotaName({ source: 'claude', window: 'five_hour' }), 'Claude 5-hour');
  assert.equal(q.quotaName({ source: 'codex', window: 'primary' }), 'Codex primary');
});

test('item 12: window length of a legacy (NULL window_secs) row: older snapshot, reset times, never 7 d for a 5-hour window', t => {
  const { open } = tmp(t, 'window');
  const store = open();
  const now = 1_800_000_000, H = 3600;
  const codex = store.intern('source', 'codex'), w = store.intern('window', 'primary'), acc = store.intern('account', 'default');
  const ins = (ts, used, reset, secs = null) => store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at,account,window_secs) VALUES (?,?,?,?,?,?,?)', ts, codex, w, used, reset, acc, secs);
  // A 5-hour Codex window seen over three periods (first snapshot up to 4.5 h before each reset).
  for (let k = 0; k < 3; k++) { const reset = now - (2 - k) * 5 * H + 2 * H; ins(reset - 4.5 * H, 10, reset); ins(reset - H, 60 + k, reset); }
  let [cur] = q.quota(store.db, now);
  assert.deepEqual([cur.window_secs, cur.windowFrom], [5 * H, 'reset times']);
  assert.equal(q.pace(cur, now).windowSecs, 5 * H);
  // A window_minutes on any older snapshot wins over the inference.
  store.run('UPDATE quota_snapshots SET window_secs=? WHERE ts=(SELECT MIN(ts) FROM quota_snapshots)', 6 * H);
  [cur] = q.quota(store.db, now);
  assert.deepEqual([cur.window_secs, cur.windowFrom], [6 * H, 'snapshot']);
  // A single legacy period seen only 2 h before its reset: inferred as the smallest standard window that fits (5 h).
  store.run('DELETE FROM quota_snapshots');
  ins(now - 2 * H, 5, now + 3 * H);
  [cur] = q.quota(store.db, now);
  assert.equal(cur.window_secs, 5 * H);
});

test('item 14: the burn chart covers short windows hour by hour', t => {
  const { open } = tmp(t, 'burn');
  const store = open();
  const H = 3600, now = Math.floor(new Date(2026, 10, 13, 15, 30).getTime() / 1000), reset = now + 2 * H;
  const src = store.intern('source', 'codex'), w = store.intern('window', 'primary'), acc = store.intern('account', 'default');
  for (const [ago, used] of [[2.5, 10], [1.2, 30], [0.1, 45]]) store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at,account,window_secs) VALUES (?,?,?,?,?,?,?)', now - ago * H, src, w, used, reset, acc, 5 * H);
  const [cur] = q.quota(store.db, now);
  const b = q.burndown(store.db, cur, now);
  assert.equal(b.unit, 'hour'); assert.equal(b.name, 'Codex 5-hour');
  assert.deepEqual(b.days, ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
  assert.deepEqual(b.used, [null, 10, 30, 45, null, null]);
  assert.equal(b.ideal.at(-1), 100);
  // v6: the burn chart sits on the Usage page (route id cost).
  assert.equal(q.pages.cost(store.db, q.range(14, now)).burndown[0].unit, 'hour');
});

// v6: the v5 tile row (and tileTones) is gone; the rule predicates behind "Do this now" stay.
test('items 1, 2, 13, 15: rules fire only past their limits; stale samples skip rule b; low data; early pace', () => {
  const quota = (pace, leftPct, extra = {}) => ({ name: 'Codex 7-day', source: 'codex', pace, leftPct, usedPct: 100 - leftPct, expired: false, early: false, resetsAt: 1_800_000_000, ...extra });
  // H8a: pace 1.8 with 50 % left now fires rule a (pace > 1.3 is enough; the old "< 30 % left" conjunction is gone).
  assert.equal(q.actionBox({ quotas: [quota(1.8, 50)] }).rule, 'a');
  assert.equal(q.actionBox({ quotas: [quota(1.8, 20)] }).rule, 'a');
  assert.equal(q.actionBox({ quotas: [quota(1.8, 20)] }).href, 'cost', 'links the Usage page');
  // Early in the window rule a needs used >= 70 % (left < 30 % already implies it; the guard is kept explicit).
  assert.equal(q.FIRES.a(quota(9, 20, { early: true, usedPct: 80 })), false);
  assert.equal(q.FIRES.a({ ...quota(9, 20, { early: true }), usedPct: 60 }), false);
  // Clean: a 30-point drop fires rule d; under 3 tasks in a week is low data and never fires.
  assert.equal(q.FIRES.d({ now: 40, prev: 70, nNow: 5, nPrev: 5 }), true);
  assert.equal(q.FIRES.lowData({ now: 40, prev: 70, nNow: 2, nPrev: 5 }), true);
  assert.equal(q.FIRES.d({ now: 50, prev: 52, nNow: 10, nPrev: 10 }), false, 'a 2-point drop is not rule d');
  assert.equal(q.actionBox({ clean: { now: 40, prev: 70, nNow: 2, nPrev: 5 } }).rule, null);
  // RAM: 15 % free does not fire; H8a: 5 % free with commit 50 % no longer fires (rule b is commit-only); a stale sample skips rule b.
  const ram = freePct => ({ ram: { freePct, commitPct: 50 } });
  assert.equal(q.FIRES.b(ram(15).ram), false);
  assert.equal(q.actionBox({ ram: ram(5).ram }).rule, null);
  assert.equal(q.actionBox({ ram: ram(5).ram, stale: true }).rule, null);
  assert.equal(q.FIRES.disk({ d: 'C:', freePct: 15 }), false);
});

test('items 2 + 3 on a DB: a stale sample is marked on Overview and System; raw samples are pruned by whole day and a pruned day is never rebuilt', t => {
  const { dir, open } = tmp(t, 'stale');
  const env = f.environment(dir), sys = path.join(dir, 'db', 'system');
  const row = (ts, free) => ({ ts, ram: { free, total: 16000 }, commit: { used: 1, limit: 100 }, drives: [{ d: 'C:', free: 10e9, total: 100e9 }], top: [] });
  const old = localTs(9, 23); // late in the day 9 days ago: (now - 7 d) is inside a later day, so this whole day goes
  f.jsonl(path.join(sys, `${day(old)}.jsonl`), [row(old - 3600, 8000), row(old, 4000)]);
  f.jsonl(path.join(sys, `${day(localTs(0))}.jsonl`), [row(Math.floor(Date.now() / 1000) - 3600, 800)]);
  assert.equal(collect(env, ['--full']).status, 0);
  let store = open(env.LINE_HUB_DB);
  assert.equal(store.get('SELECT COUNT(*) n FROM system_samples WHERE day=?', day(old)).n, 0);
  assert.equal(store.get("SELECT value FROM system_daily WHERE day=? AND metric='ram_free_min_pct'", day(old)).value, 25);
  assert.ok(store.meta('system_pruned_before') > day(old));
  // A late sample for that pruned day must not rebuild it from the partial set.
  store.close();
  fs.appendFileSync(path.join(sys, `${day(old)}.jsonl`), JSON.stringify(row(old - 60, 16000)) + '\n');
  assert.equal(collect(env).status, 0);
  store = open(env.LINE_HUB_DB);
  assert.equal(store.get("SELECT value FROM system_daily WHERE day=? AND metric='ram_free_min_pct'", day(old)).value, 25, 'kept');
  // The newest sample is an hour old: stale. RAM is 5 % free but rule b is skipped; Overview and System say stale.
  const o = q.pages.overview(store.db, q.range(14));
  assert.equal(o.stale, true);
  assert.equal(typeof o.sampleTs, 'number');
  assert.equal(q.pages.system(store.db, q.range(14)).stale, true);
  assert.notEqual(o.action.rule, 'b');
  // Rule c still reads a stale sample. C: has exactly 10 % free here: the rule needs < 10 %, so it does not fire.
  assert.notEqual(o.action.rule, 'c');
  // Below 10 % it fires on a stale sample too, and the text says how old the sample is.
  const c = q.actionBox({ stale: true, sampleTs: o.sampleTs, ram: { freePct: 5, commitPct: 50 }, drives: [{ d: 'C:', freePct: 5, free: 5e9, total: 100e9 }] });
  assert.equal(c.rule, 'c'); assert.match(c.text, /^Drive C: has only 5% free \(sample from .+\)\.$/);
  assert.doesNotMatch(q.actionBox({ drives: [{ d: 'C:', freePct: 5 }] }).text, /sample from/, 'a fresh sample needs no note');
});

test('v6 pace values: an early snapshot gives no pace; paceSides and burndown on a small fixture', t => {
  const { open } = tmp(t, 'pacevals');
  const store = open();
  const H = 3600, now = Math.floor(new Date(2026, 10, 13, 15, 30).getTime() / 1000);
  const start = now - 42 * H, reset = start + 7 * 24 * H; // Claude 7-day window (length by name), started Nov 11 21:30
  const src = store.intern('source', 'claude'), w = store.intern('window', 'seven_day');
  const add = (ts, used) => store.run('INSERT INTO quota_snapshots (ts,source,window,used_pct,resets_at) VALUES (?,?,?,?,?)', ts, src, w, used, reset);
  add(start + H, 5);  // 1 h of 168 gone (0.6 %): early, 5 / 0.6 = 8.4x would be noise
  add(now, 30);       // 42 h of 168 gone = 25 %: pace 30 / 25 = 1.2
  const [cur] = q.quota(store.db, now);
  assert.equal(q.pace({ ...cur, used_pct: 5 }, start + H).early, true);
  assert.deepEqual(q.paceHistory(store.db, cur, now, 3), [null, null, 1.2], 'Nov 11 early -> null, Nov 12 no snapshot, Nov 13 1.2');
  const p = q.pages.productivity(store.db, q.range(7, now)).pace;
  const c7 = p.sides.find(s => s.key === 'claude7');
  assert.deepEqual([c7.name, c7.usedPct, c7.elapsedPct, c7.pace, c7.early], ['Claude 7-day', 30, 25, 1.2, false]);
  assert.deepEqual(c7.history, [null, null, null, null, null, null, 1.2]);
  assert.deepEqual(p.sides.filter(s => s.missing).map(s => s.name), ['Claude 5-hour', 'Codex 7-day'], 'missing sides named by quotaName()');
  const b = q.burndown(store.db, cur, now);
  assert.equal(b.unit, 'day');
  assert.deepEqual(b.days, ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
  assert.deepEqual(b.used, [5, null, 30, null, null, null, null, null]);
  assert.deepEqual([b.ideal[0], b.ideal[2], b.ideal.at(-1)], [Math.round(2.5 / 168 * 1000) / 10, Math.round(50.5 / 168 * 1000) / 10, 100]);
});

test('item 11: sampler files are deleted only after they were read to the end', t => {
  const { dir, open } = tmp(t, 'prune');
  const { pruneSystem } = require('../collector/sources');
  const store = open();
  const sys = path.join(dir, 'system'), old = path.join(sys, `${day(localTs(12))}.jsonl`);
  f.jsonl(old, [{ ts: localTs(12), ram: { free: 1, total: 2 }, drives: [], top: [] }]);
  const config = { system: sys };
  assert.equal(pruneSystem(store, config), 0, 'never read: kept'); assert.ok(fs.existsSync(old));
  store.cursor(hash(old), fs.statSync(old).size, 0, 5, null);
  assert.equal(pruneSystem(store, config), 0, 'partly read: kept');
  store.cursor(hash(old), fs.statSync(old).size, 0, fs.statSync(old).size, null);
  assert.equal(pruneSystem(store, config), 1); assert.ok(!fs.existsSync(old)); assert.equal(store.state(hash(old)), undefined);
});

test('item 5: STOP flag from the full note, negations excluded', async t => {
  const { stopFlag } = require('../collector/ledger');
  assert.equal(stopFlag('worker STOPped on a missing file'), 1);
  assert.equal(stopFlag('STOP: ambiguous spec'), 1);
  for (const n of ['no STOP this time', '0 STOP', 'ran without STOP', 'stop the server', 'NONSTOP', 'non-STOP', '']) assert.equal(stopFlag(n), 0, n);
  assert.equal(stopFlag('no STOP in r1, then STOP in r2'), 1, 'a later real STOP still counts');
  const long = `${'x'.repeat(250)} worker STOP`;
  assert.equal(parseLedger(`2026-11-12|Standard|no|0|0|0|${long}`).row.stop, 1, 'past the 200-character cut');
  const { dir, open } = tmp(t, 'stop');
  const store = open();
  const file = f.write(path.join(dir, 'review-ledger.log'), `${day(localTs(0))}|Standard|no|0|0|0|${long}\n${day(localTs(0))}|Standard|no|0|0|0|no STOP\n`);
  await ingest(store, { file, kind: 'ledger', stat: fs.statSync(file) }, () => false);
  assert.deepEqual(store.all('SELECT stop FROM ledger ORDER BY stop').map(x => x.stop), [0, 1]);
  assert.equal(q.pages.workers(store.db, q.range(7)).delegation.ratios[0].stopTasks, 1);
});

test('item 6: a failed or timed-out wevtutil keeps the event cursor and logs a code; events are queried from the newest one', async t => {
  const { dir } = tmp(t, 'events');
  const cfg = { hub: dir, system: path.join(dir, 'system'), folders: [] };
  const calls = [];
  const fake = mode => async (file, args) => {
    calls.push([file, args]);
    if (file === 'wevtutil.exe') return mode === 'fail' ? { error: Object.assign(new Error('x'), { killed: true }) } : { stdout: fx.EVENTS };
    if (file === 'tasklist.exe') return { stdout: fx.TASKLIST };
    return { stdout: fx.CIM };
  };
  const now = Date.parse('2026-11-13T10:00:00Z');
  await s.sample(cfg, now, fake('fail'), true);
  const state = () => JSON.parse(fs.readFileSync(path.join(cfg.system, 'sampler-state.json'), 'utf8'));
  assert.equal(state().lastEventCheck, undefined, 'a timeout does not move the hourly mark');
  assert.match(fs.readFileSync(path.join(dir, 'collect-errors.log'), 'utf8'), /SAMPLER_WEVTUTIL_TIMEOUT/);
  const row = await s.sample(cfg, now + 60000, fake('ok'), true);
  assert.equal(row.kills.length, 2); assert.equal(state().lastEventTs, row.kills[1].ts);
  assert.equal(state().lastEventCheck, Math.floor((now + 60000) / 1000));
  // Next hour: the query starts at the newest recorded event, and the same events are not reported twice.
  const again = await s.sample(cfg, now + 3700 * 1000, fake('ok'), true);
  assert.equal(again.kills, undefined);
  const q3 = calls.filter(c => c[0] === 'wevtutil.exe').at(-1)[1].join(' ');
  assert.ok(q3.includes(new Date(row.kills[1].ts * 1000).toISOString()), q3);
});

test('item 8: the v8 migration resets only run.json cursors', t => {
  const { dir, open } = tmp(t, 'runreplay');
  const env = f.environment(dir);
  f.populate(env);
  assert.equal(collect(env, ['--full']).status, 0);
  let store = open(env.LINE_HUB_DB);
  const runKey = hash(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'run-1', 'run.json'));
  const others = () => store.all('SELECT path, size FROM ingest_state WHERE path<>? AND path<>? ORDER BY path', runKey,
    hash(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'run-2', 'run.json')));
  const before = others();
  store.setMeta('v8_run_replay', '1');
  store.close();
  // The flag is acted on before ingestion; the snapshot then re-reads the run and writes its size back.
  assert.equal(collect(env).status, 0);
  store = open(env.LINE_HUB_DB);
  assert.equal(store.meta('v8_run_replay'), undefined);
  assert.deepEqual(others(), before, 'stream and other snapshot cursors untouched');
  assert.ok(store.state(runKey).size > 0, 'the run snapshot was re-read');
});

test('"Do this now" shows only the first rule that fires, in the order a, b, c, d, e', () => {
  const quota = (pace, leftPct, extra = {}) => ({ name: 'Codex 7-day', source: 'codex', pace, leftPct, expired: false, resetsAt: 1_800_000_000, ...extra });
  const all = { quotas: [quota(1.8, 20)], ram: { freePct: 5, commitPct: 95 }, top: [{ name: 'node.exe', mb: 2400, count: 27 }],
    drives: [{ d: 'C:', freePct: 8, free: 4e10, total: 5e11 }], folders: [{ label: '%TEMP%/claude', bytes: 5e9, drive: 'C:', growthPerDay: 1e9, daysToFull: 3 }],
    clean: { now: 30, prev: 70, nNow: 10, nPrev: 10 }, hooks: [{ script: 'slow.ps1', p95_ms: 6000, timeoutMs: 10000, over: true }] };
  const order = [];
  let x = { ...all };
  // H8a: the dropped quotas sit at the new pace threshold (1.3, strict) - pace 2 with 50 % left fires rule a now.
  for (const drop of [{ quotas: [quota(1.2, 20), quota(1.3, 50)] }, { ram: { freePct: 30, commitPct: 50 } }, { drives: [] }, { folders: [] }, { clean: { now: 60, prev: 70, nNow: 10, nPrev: 10 } }, { hooks: [] }]) {
    const a = q.actionBox(x);
    order.push(a.rule);
    assert.ok(a.text.length > 0 && a.action.length > 0);
    x = { ...x, ...drop };
  }
  assert.deepEqual(order, ['a', 'b', 'c', 'c', 'd', 'e']);
  const clear = q.actionBox(x);
  assert.equal(clear.rule, null); assert.equal(clear.text, 'All clear.'); assert.match(clear.action, /^Next quota reset: Codex 7-day at /);
  assert.match(q.actionBox(all).action, /Routing card/);
  assert.match(q.actionBox({ ...all, quotas: [] }).action, /Close node\.exe \(2400 MB in 27 processes\)/);
  assert.match(q.actionBox({ ...all, quotas: [], ram: null }).action, /Clean %TEMP%\/claude first/);
  // Thresholds are strict and the clean rule needs 3+ tasks in both weeks. H8a: pace 1.5 now fires rule a (> 1.3);
  // commit 75 % does not fire rule b (threshold is strict > 90 since 2026-11-14).
  assert.equal(q.actionBox({ quotas: [quota(1.5, 20)], ram: { freePct: 10, commitPct: 75 }, drives: [{ d: 'C:', freePct: 10 }], folders: [{ daysToFull: 14 }],
    clean: { now: 50, prev: 66, nNow: 2, nPrev: 10 }, hooks: [] }).rule, 'a');
  assert.equal(q.actionBox({ quotas: [quota(1.3, 20)], ram: { freePct: 10, commitPct: 75 }, drives: [{ d: 'C:', freePct: 10 }], folders: [{ daysToFull: 14 }],
    clean: { now: 50, prev: 66, nNow: 2, nPrev: 10 }, hooks: [] }).rule, null);
  assert.equal(q.actionBox({ clean: { now: 50, prev: 66, nNow: 3, nPrev: 3 } }).rule, 'd');
});

test('hook limits from settings.json: explicit timeout, defaults by type and event, strictest per script', () => {
  const rows = hookLimits({
    Stop: [{ hooks: [{ type: 'command', command: 'node "C:\\x\\collect.js" --hook', timeout: 30 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'powershell -File C:\\y\\guard.ps1' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'powershell -File C:\\y\\guard.ps1' }, { type: 'prompt', prompt: 'x' }] }]
  });
  const get = (script, event) => rows.find(r => r.script === script && r.event === event)?.ms;
  assert.equal(get('collect.js', 'Stop'), 30000);
  assert.equal(get('guard.ps1', 'UserPromptSubmit'), 30000);
  assert.equal(get('guard.ps1', 'PreToolUse'), 600000);
  assert.equal(get('inline', 'PreToolUse'), 30000);
  assert.ok(!JSON.stringify(rows).includes('C:'), 'file names only');
  assert.deepEqual(hookLimits(null), []);
});

test('delegation metrics on fixtures: ratios, STOP rate, per-task runs= only, packet-size resume rate, token origin', async t => {
  const { dir, open } = tmp(t, 'deleg');
  const store = open();
  const now = localTs(0, 18), today = day(now), m = store.intern('model', 'gpt-6-astra');
  const ledger = f.write(path.join(dir, 'review-ledger.log'), [
    `${today}|Important|yes|0|0|0|clean task|worker=astra|runs=r1,r2`,
    `${today}|Important|yes|0|2 P2|0|worker STOP then fixed|worker=astra|fail_rounds=1|runs=r3`,
    `${today}|Standard-A|no|0|0|0|no run ids here|worker=sol`,
    `${today}|Standard-A|no|0|FAIL|0|second FAIL|worker=sol`].join('\n') + '\n');
  await ingest(store, { file: ledger, kind: 'ledger', stat: fs.statSync(ledger) }, () => false);
  const run = (id, sid, resume, started, ended, spec) => store.insert('runs', { run_id: id, codex_session_id: sid, model: m, is_resume: resume ? 1 : 0,
    started, ended, exit_code: 0, sandbox_failure: 0, day: day(started), spec_bytes: spec });
  run('r1', 'A', false, now - 3600, now - 3000, 4000);   // small packet, resumed by r2
  run('r2', 'A', true, now - 2900, now - 2400, 300);
  run('r3', 'B', false, now - 1800, now - 600, 20000);  // big packet, never resumed
  run('r4', 'C-child', false, now - 500, now - 100, 12000); // session is a sub-agent thread of C: root C
  run('r5', null, false, now - 400, null, null);
  const thread = (id, parent, total) => store.insert('codex_sessions', { session_id: id, parent_thread_id: parent, model: m, day: today, total_tokens: total });
  thread('A', null, 0); thread('B', null, 0); thread('C', null, 0); thread('C-child', 'C', 0); thread('Z', null, 0);
  for (const [id, total] of [['A', 100], ['B', 50], ['C', 30], ['C-child', 20], ['Z', 7]]) store.run('INSERT INTO codex_days VALUES (?,?,0,1,0,0,0,?)', id, today, total);
  store.run('INSERT INTO daily_runs VALUES (?,?,5,4,0,0,0,1)', today, m);
  const d = q.pages.workers(store.db, q.range(14, now)).delegation;
  const r7 = d.ratios.find(x => x.days === 7);
  assert.deepEqual([r7.tasks, r7.runs, r7.resumes, r7.failRounds, r7.stopTasks], [4, 5, 1, 3, 1], 'fail_rounds=1 + FAIL in a cell and the note = 2');
  assert.deepEqual([r7.runsPerTask, r7.resumesPerTask, r7.failRoundsPerTask, r7.stopPct, r7.cleanPct], [1.25, 0.25, 0.75, 25, 50]);
  assert.equal(d.perTask.tasks, 4); assert.equal(d.perTask.withRuns, 2, 'only the two lines with runs=');
  const first = d.perTask.list.find(x => x.runs === 2);
  assert.deepEqual([first.resumes, first.leadMin, first.clean], [1, 20, true], 'lead = first start to last end of its runs');
  assert.deepEqual([d.perTask.runsPerTask, d.perTask.resumesPerTask], [1.5, 0.5]);
  const size = Object.fromEntries(d.resumeBySize.map(b => [b.bucket, [b.runs, b.linked, b.resumed, b.ratePct]]));
  assert.deepEqual(size, { '<= 8 KB': [1, 1, 1, 100], '8-16 KB': [1, 1, 0, 0], '> 16 KB': [1, 1, 0, 0], 'n/a': [1, 0, 0, null] });
  const origin = Object.fromEntries(d.tokensByOrigin.map(o => [o.origin, [o.total, o.threads]]));
  assert.deepEqual(origin, { dispatcher: [180, 3], subagent: [20, 1], other: [7, 1] });
  const sol = d.byTierWorker[0].rows.find(x => x.worker === 'gpt-6-sol');
  assert.deepEqual([sol.tier, sol.n, sol.clean, sol.pct], ['Standard-A', 2, 1, 50]);
  assert.deepEqual(parseLedger(`${today}|Skip|no|0|0|0|x|runs= a , a,b`).row.runs, ['a', 'b']);
});
