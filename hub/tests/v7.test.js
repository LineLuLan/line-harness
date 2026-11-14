/* Intent: regression tests for the 2026-11-11 trace audit fixes and schema v7.
 * Status: synthetic fixtures only. Covers: forked Codex rollouts bind to their first session_meta (#1),
 *   per-day Codex deltas (#3), run tokens by root thread + shared session once (#2), human turns
 *   without sub-agent / tag-only rows (#4), run end = exit.txt mtime (#5), ledger parsing old + new
 *   lines (#6), resume dispatch linking (#7), worktree repo names + large-record projection (#11/#12),
 *   quota per account + pacing (#10/#11), and the v6 -> v7 migration (replay once, nothing doubled).
 * Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { snapshot, linkRuns, discover } = require('../collector/sources');
const { aggregate } = require('../collector/aggregate');
const { parseLedger, aliasModel, failRounds } = require('../collector/ledger');
const parsers = require('../collector/parsers');
const { project } = require('../collector/project');
const { repoOf } = require('../collector/repo');
const { hash } = require('../collector/values');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'v7-'));
  const stores = [];
  t.after(() => { for (const s of stores) try { s.close(); } catch { /* closed */ } fs.rmSync(root, { recursive: true, force: true }); });
  return { root, open: file => { const s = new Store(file || path.join(root, 'hub.db')); stores.push(s); return s; } };
}
const read = (store, file, kind, extra = {}) => ingest(store, { file, kind, stat: fs.statSync(file), ...extra }, () => false);
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const UUID = n => `0000000${n}-aaaa-bbbb-cccc-00000000000${n}`;
const meta = (id, ts, extra = {}) => ({ type: 'session_meta', timestamp: ts, payload: { id, timestamp: ts, cwd: '/x', thread_source: 'user', ...extra } });
const tokens = (ts, total, input = total) => ({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count',
  info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: total - input, reasoning_output_tokens: 0, total_tokens: total } } } });
const turn = (ts, model) => ({ type: 'turn_context', timestamp: ts, payload: { model, effort: 'high' } });

test('#1 a forked rollout binds to its FIRST session_meta; the parent copy never takes it over', async t => {
  const s = setup(t), store = s.open();
  const parent = UUID(1), child = UUID(2), at = local(2026, 11, 1, 10);
  const parentFile = f.jsonl(path.join(s.root, `rollout-2026-11-01T10-00-00-${parent}.jsonl`), [
    meta(parent, at), turn(at, 'gpt-6-astra'), tokens(local(2026, 11, 1, 10, 5), 1000),
    { type: 'event_msg', timestamp: local(2026, 11, 1, 10, 6), payload: { type: 'task_complete', completed_at: 1, duration_ms: 360000 } }]);
  const childFile = f.jsonl(path.join(s.root, `rollout-2026-11-01T10-01-00-${child}.jsonl`), [
    meta(child, at, { thread_source: 'subagent', parent_thread_id: parent, forked_from_id: parent }), meta(parent, at),
    turn(at, 'gpt-6-sol'), tokens(local(2026, 11, 1, 10, 9), 300), tokens(local(2026, 11, 1, 10, 10), 700),
    { type: 'event_msg', timestamp: local(2026, 11, 1, 10, 11), payload: { type: 'task_complete', completed_at: 2, duration_ms: 5 } }]);
  await read(store, parentFile, 'codex'); await read(store, childFile, 'codex');
  const row = id => store.get('SELECT * FROM codex_sessions WHERE session_id=?', id);
  const name = id => store.get('SELECT name FROM names WHERE id=?', id).name;
  assert.equal(row(parent).total_tokens, 1000, 'parent total not overwritten by the fork');
  assert.equal(name(row(parent).model), 'gpt-6-astra'); assert.equal(row(parent).duration_ms, 360000);
  assert.equal(row(child).total_tokens, 700); assert.equal(row(child).parent_thread_id, parent);
  assert.equal(name(row(child).model), 'gpt-6-sol'); assert.equal(row(child).duration_ms, 5);
  // The cursor stores the bound id, so an appended token_count still lands on the child.
  fs.appendFileSync(childFile, JSON.stringify(tokens(local(2026, 11, 1, 10, 12), 900)) + '\n');
  await read(store, childFile, 'codex');
  assert.equal(row(child).total_tokens, 900); assert.equal(row(parent).total_tokens, 1000);
  // No id in the session_meta: the rollout file name's id is used.
  const third = UUID(3);
  const anon = f.jsonl(path.join(s.root, `rollout-2026-11-01T11-00-00-${third}.jsonl`), [
    { type: 'session_meta', timestamp: at, payload: { timestamp: at, cwd: '/x' } }, tokens(local(2026, 11, 1, 11, 1), 50)]);
  await read(store, anon, 'codex');
  assert.equal(row(third).total_tokens, 50);
});

test('#3 Codex tokens are stored per day as deltas; a thread past midnight is split and sums to its total', async t => {
  const s = setup(t), store = s.open();
  const id = UUID(4);
  const file = f.jsonl(path.join(s.root, `rollout-x-${id}.jsonl`), [meta(id, local(2026, 11, 1, 23, 0)), turn(local(2026, 11, 1, 23, 0), 'gpt-6-astra'),
    tokens(local(2026, 11, 1, 23, 10), 400, 300), tokens(local(2026, 11, 1, 23, 50), 1000, 800),
    tokens(local(2026, 11, 2, 0, 20), 1500, 1100)]);
  await read(store, file, 'codex');
  const days = store.all('SELECT day, total_tokens t, input i FROM codex_days WHERE session_id=? ORDER BY day', id);
  assert.deepEqual(days.map(d => [d.day, d.t, d.i]), [['2026-11-01', 1000, 800], ['2026-11-02', 500, 300]]);
  assert.equal(store.get('SELECT total_tokens t FROM codex_sessions WHERE session_id=?', id).t, 1500);
  aggregate(store, () => false);
  const daily = store.all(`SELECT t.day, t.input+t.output io FROM daily_tokens t JOIN names n ON n.id=t.source WHERE n.name='codex' ORDER BY t.day`);
  assert.deepEqual(daily.map(d => [d.day, d.io]), [['2026-11-01', 1000], ['2026-11-02', 500]]);
  // A counter drop is a reset: the per-day change is clamped to 0, never negative; the thread row keeps the last snapshot.
  const reset = UUID(10);
  const rf = f.jsonl(path.join(s.root, `rollout-r-${reset}.jsonl`), [meta(reset, local(2026, 11, 3, 9)),
    tokens(local(2026, 11, 3, 9, 1), 1000), tokens(local(2026, 11, 3, 9, 2), 100), tokens(local(2026, 11, 3, 9, 3), 300)]);
  await read(store, rf, 'codex');
  assert.equal(store.get('SELECT total_tokens t FROM codex_sessions WHERE session_id=?', reset).t, 300);
  assert.equal(store.get('SELECT total_tokens t FROM codex_days WHERE session_id=?', reset).t, 1200);
  assert.ok(store.all('SELECT * FROM codex_days').every(d => d.total_tokens >= 0 && d.input >= 0 && d.output >= 0));
  // Re-reading the same file (a rewrite) never adds the deltas twice.
  f.write(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  await read(store, file, 'codex');
  assert.equal(store.get('SELECT SUM(total_tokens) t FROM codex_days WHERE session_id=?', id).t, 1500);
});

test('#2 run tokens resolve to the root thread tree; a session shared by resumed runs is counted once', async t => {
  const s = setup(t), store = s.open();
  const add = (id, parent, total, out) => store.insert('codex_sessions', { session_id: id, parent_thread_id: parent, model: store.intern('model', 'm'),
    day: '2026-11-01', total_tokens: total, output: out });
  add('root', null, 1000, 100); add('kid', 'root', 300, 30); add('grandkid', 'kid', 50, 5); add('other', null, 70, 7);
  const run = (id, sid, started) => store.insert('runs', { run_id: id, codex_session_id: sid, model: store.intern('model', 'm'),
    is_resume: 0, started, sandbox_failure: 0, day: '2026-11-01' });
  run('r1', 'kid', 100); run('r2', 'root', 200); run('r3', 'other', 300); run('r4', 'missing', 400);
  const runs = store.all('SELECT run_id, codex_session_id FROM runs ORDER BY started');
  q.runTokens(store.db, runs);
  const by = Object.fromEntries(runs.map(r => [r.run_id, r]));
  assert.equal(by.r1.codex_total, 1350, 'sub-agent id resolves to the root tree (root + kid + grandkid)');
  assert.equal(by.r1.codex_threads, 3); assert.equal(by.r1.codex_root, 'root');
  assert.equal(by.r2.codex_total, null); assert.equal(by.r2.same_session_as, 'r1', 'resume: same session, counted once');
  assert.equal(by.r3.codex_total, 70); assert.equal(by.r4.codex_total, null); assert.equal(by.r4.codex_root, null);
});

test('#4 human turns leave out sidechain rows, sub-agent transcripts and tag-only rows; a replay removes old ones', async t => {
  const s = setup(t), store = s.open();
  const user = (uuid, content, extra = {}) => ({ type: 'user', uuid, sessionId: 'sess', timestamp: f.timestamp, message: { role: 'user', content }, ...extra });
  const rows = [user('u1', 'please fix the bug'), user('u2', 'sub-agent prompt', { isSidechain: true }),
    user('u3', '<task-notification>\n<task-id>x</task-id>\n</task-notification>'),
    user('u4', '<command-name>/handoff</command-name>\n<command-message>handoff</command-message>\n<command-args></command-args>'),
    user('u5', '<local-command-stdout>ok</local-command-stdout>'), user('u6', '<bash-input>ls</bash-input>'),
    user('u7', '<system-reminder>x</system-reminder>\nand a real question'), user('u8', '<bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>')];
  const main = f.jsonl(path.join(s.root, 'projects', 'p', 'sess.jsonl'), rows);
  const sub = f.jsonl(path.join(s.root, 'projects', 'p', 'sess', 'subagents', 'agent-1.jsonl'), [user('s1', 'do the sub task')]);
  // An older version counted u2 and s1: their rows exist before the replay.
  for (const uuid of ['u2', 's1']) store.insert('human_turns', { id: hash(`human:${uuid}`), session_id: 'sess' });
  store.insert('claude_sessions', { session_id: 'sess', turns: 2 });
  await read(store, main, 'claude'); await read(store, sub, 'claude');
  assert.equal(store.get('SELECT turns FROM claude_sessions WHERE session_id=?', 'sess').turns, 2, 'u1 and u7 only');
  assert.deepEqual(store.all('SELECT id FROM human_turns').map(x => x.id).sort(), [hash('human:u1'), hash('human:u7')].sort());
});

test('#5 run end = exit.txt mtime; activity.txt is only a fallback', t => {
  const s = setup(t), store = s.open();
  const dir = path.join(s.root, 'runs', 'run-a');
  f.write(path.join(dir, 'run.json'), JSON.stringify({ runId: 'run-a', model: 'm', startedUtc: '2026-11-01T10:00:00Z' }));
  f.write(path.join(dir, 'activity.txt'), '2026-11-02T16:00:00Z'); // 30 h later: a stale activity stamp
  f.write(path.join(dir, 'exit.txt'), '0');
  const exitAt = Date.parse('2026-11-01T10:11:00Z') / 1000;
  fs.utimesSync(path.join(dir, 'exit.txt'), exitAt, exitAt);
  const item = () => { const st = fs.statSync(path.join(dir, 'run.json')); return { file: path.join(dir, 'run.json'), kind: 'run', stat: { size: st.size + 30, mtimeMs: Date.now() } }; };
  store.begin(); snapshot(store, item()); store.commit();
  assert.equal(store.get('SELECT ended FROM runs').ended, exitAt);
  f.write(path.join(dir, 'exit.txt'), 'garbage'); fs.utimesSync(path.join(dir, 'exit.txt'), exitAt, exitAt);
  store.begin(); snapshot(store, { ...item(), stat: { size: 1, mtimeMs: 1 } }); store.commit();
  assert.equal(store.get('SELECT ended FROM runs').ended, Date.parse('2026-11-02T16:00:00Z') / 1000);
});

test('#6 ledger: old lines (leading integers, ^yes, FAIL rounds, aliased worker) and new key=value lines', () => {
  const p = text => parseLedger(text).row;
  const a = p('2026-11-12|Important|yes (Sol x2: gates)|0 + supervisor note|3 P2 (fixed)|PASS|wave 2 FAIL x2 then fixed (worker gpt-6-astra high) after Fable review');
  assert.equal(a.layer2, 1); assert.deepEqual([a.l1_count, a.l2_count, a.l3_count], [0, 3, null]);
  assert.equal(a.fail_rounds, 2); assert.equal(a.model, 'gpt-6-astra', 'the (worker x) phrase wins over Fable');
  assert.equal(p('2026-11-12|Important|layer2 yes|L1 pass|L2 PASS|L3 live|x').layer2, 1);
  assert.equal(p('2026-11-12|Important|no (deferred)|0|0|0|Opus did it, then Sol reviewed').model, 'opus', 'first model named');
  assert.equal(p('2026-11-12|Standard|no|0|0|0|ran the console only').model, null, 'console is not sol');
  assert.equal(p('2026-11-12|Standard|no|0|0|0|stopped per 3-FAIL rule, no FAIL here').fail_rounds, 0);
  assert.equal(p('2026-11-12|Standard|no|0|0|0|worker STOPped; Codex astra did the rest').model, 'gpt-6-astra');
  // Alias table.
  for (const [raw, want] of [['Opus', 'opus'], ['claude-opus-5-5', 'opus'], ['Fable', 'fable'], ['Sol', 'gpt-6-sol'], ['gpt-6-sol', 'gpt-6-sol'],
    ['ASTRA', 'gpt-6-astra'], ['luna', 'gpt-6-luna'], ['gpt-5.6-sol', 'gpt-5.6-sol']]) assert.equal(aliasModel(raw), want, raw);
  // New format: trailing fields win over every guess, and a "|" inside the note survives.
  const n = p('2026-11-12|Standard-A|yes|PASS|1 P2|0|UI fix | with pipe (worker opus)|worker=Sol|type=collector|fail_rounds=1|findings=L1:0,L2:4,L3:0');
  assert.equal(n.model, 'gpt-6-sol'); assert.equal(n.task_type, 'collector'); assert.equal(n.fail_rounds, 1);
  assert.deepEqual([n.l1_count, n.l2_count, n.l3_count], [0, 4, 0]); assert.equal(n.note, 'UI fix | with pipe (worker opus)');
  // Six fields (note missing) and non-rows are warnings, never silent drops.
  const six = parseLedger('2026-10-13|Important|yes|0|Astra r1: 3 P2 (fixed)|L3: real run; worker gpt-6-astra (fresh)');
  assert.equal(six.warning, 'six-fields'); assert.equal(six.row.model, 'gpt-6-astra'); assert.equal(six.row.l3_raw, 'L3: real run; worker gpt-6-astra (fresh)');
  assert.equal(parseLedger('﻿# date|tier|layer2_ran|L1|L2|L3|note').warning, 'comment');
  assert.equal(parseLedger('11/12/2026|Important|yes|0|0|0|x').warning, 'bad-date');
  assert.equal(p('2026-1-5|Skip|no|0|0|0|x').day, '2026-01-05');
  assert.equal(parseLedger('   '), null);
  assert.equal(failRounds('Astra FAIL x3 (r1 ...)'), 3); assert.equal(failRounds('FAIL 0'), 0);
});

test('#6 ledger rows feed the server: clean needs no finding AND no FAIL round; type= wins over keywords', async t => {
  const s = setup(t), store = s.open();
  const file = f.write(path.join(s.root, 'review-ledger.log'), ['# header',
    '2026-11-10|Standard-A|yes|0|0 + note|0|ui sidebar polish (worker sol)',
    '2026-11-10|Standard-A|yes|0|0|0|ui page round 1 FAIL then PASS (worker sol)',
    '2026-11-10|Important|no|0|0|0|docs readme pass (worker gpt-6-sol)|type=ui',
    '2026-10-13|Important|yes|0|Astra r1: 1 P2|L3 worker gpt-6-astra'].join('\n') + '\n');
  await read(store, file, 'ledger');
  assert.equal(store.get('SELECT COUNT(*) n FROM ledger').n, 4);
  assert.equal(store.meta('ledger_warnings'), '2'); assert.equal(store.meta('parse_errors'), undefined);
  const rows = q.ledgerRows(store.db, { startDay: '2026-01-01' });
  const day = rows.filter(r => r.day === '2026-11-10');
  assert.equal(day.filter(r => r.clean).length, 2, 'the 0 + note row and the type=ui row are clean');
  const failed = day.find(r => r.failRounds);
  assert.equal(failed.clean, false); assert.equal(failed.failRounds, 1); assert.equal(failed.model, 'gpt-6-sol');
  // The rows also feed the Worker page tier x worker table (workers().delegation).
  const d = q.pages.workers(store.db, q.range(14, Math.floor(new Date(2026, 10, 11, 12).getTime() / 1000))).delegation;
  const sol = d.byTierWorker[1].rows.find(x => x.tier === 'Standard-A' && x.worker === 'gpt-6-sol');
  assert.deepEqual([sol.n, sol.clean, sol.pct, sol.failRounds], [2, 1, 50, 1]);
});

test('#7 resume dispatches link runs; #11 worktrees name the main repo; #12 large records keep gitBranch and payload.git', async t => {
  const s = setup(t), store = s.open();
  parsers.dispatch(store, '1794400000|resume|gpt-6-astra|high|claude-9', { id: 'd1' });
  store.insert('runs', { run_id: 'r1', model: store.intern('model', 'gpt-6-astra'), is_resume: 1, started: 1794400030, sandbox_failure: 0, day: '2026-11-01' });
  linkRuns(store);
  assert.equal(store.get('SELECT claude_session_id c FROM runs').c, 'claude-9');
  // Worktree: <wt>/.git is a file pointing into <main>/.git/worktrees/<name>.
  const main = path.join(s.root, 'main-repo'), wt = path.join(s.root, 'main-repo-feature'), sub = path.join(s.root, 'host', 'lib');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'feature'), { recursive: true }); fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'feature')}\n`);
  fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../.git/modules/lib\n');
  assert.equal(repoOf(path.join(wt, 'src')), 'main-repo');
  assert.equal(repoOf(sub), 'lib', 'a submodule keeps its own folder name');
  const big = 'x'.repeat(70000);
  const claude = JSON.parse(project(Buffer.from(JSON.stringify({ ...f.assistant('m', {}, [{ type: 'text', text: big }]), gitBranch: 'feat/a', isSidechain: true })), 'claude'));
  assert.equal(claude.gitBranch, 'feat/a'); assert.equal(claude.isSidechain, true); assert.ok(!JSON.stringify(claude).includes(big));
  const codex = JSON.parse(project(Buffer.from(JSON.stringify(meta('c', f.timestamp, { base_instructions: big, git: { branch: 'dev', commit_hash: 'abc', repository_url: 'https://h/o/r.git' } }))), 'codex'));
  assert.deepEqual(codex.payload.git, { branch: 'dev', repository_url: 'https://h/o/r.git' });
});

test('#10 quota per account: accounts are discovered by Codex home, the forecast reads the current account only; pacing formula', async t => {
  const s = setup(t), store = s.open();
  const now = Math.floor(new Date(2026, 10, 12, 18).getTime() / 1000), H = 3600;
  const iso = ts => new Date(ts * 1000).toISOString();
  const roll = (home, id, used, at, resets) => f.jsonl(path.join(s.root, home, 'sessions', '2026', '11', '12', `rollout-${id}.jsonl`), [meta(id, iso(at)),
    { type: 'event_msg', timestamp: iso(at), payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1 } },
      rate_limits: { primary: { used_percent: used, resets_at: resets } } } }]);
  roll('.codex', UUID(5), 80, now - 30 * H, now + 50 * H);
  roll(path.join('.codex-accounts', 'second'), UUID(6), 10, now - 20 * H, now + 100 * H); // yesterday, before midnight
  roll(path.join('.codex-accounts', 'second'), UUID(7), 30, now - H, now + 100 * H);
  const items = discover({ claude: path.join(s.root, 'none'), codex: path.join(s.root, '.codex'), codexAccounts: path.join(s.root, '.codex-accounts'),
    state: path.join(s.root, 'none'), status: path.join(s.root, 'none') });
  assert.deepEqual(items.map(i => i.account).sort(), ['default', 'second', 'second']);
  for (const item of items) await ingest(store, item, () => false);
  assert.equal(store.get('SELECT COUNT(DISTINCT account) n FROM quota_snapshots').n, 2);
  const cur = q.quota(store.db, now);
  assert.equal(cur.length, 1); assert.equal(cur[0].account, 'second'); assert.equal(cur[0].used_pct, 30);
  // v5 pace: no window_minutes in this rollout -> Codex window = 7 days; 100 h left = 68 h gone.
  const p = q.pace(cur[0], now);
  assert.equal(p.elapsedPct, Math.round(68 / 168 * 1000) / 10); assert.equal(p.pace, Math.round(30 / (68 / 168 * 100) * 100) / 100);
  assert.equal(q.quotaName(cur[0]), 'Codex 7-day (second)');
  assert.equal(store.get("SELECT n.name FROM codex_sessions c JOIN names n ON n.id=c.account WHERE session_id=?", UUID(6)).name, 'second');
});

test('v6 -> v7 migration: replays once, Claude facts equal, Codex totals rise to raw, turns and counters not doubled', async t => {
  const s = setup(t), database = path.join(s.root, 'hub.db');
  const parent = UUID(8), child = UUID(9), at = local(2026, 11, 3, 10);
  const files = [
    [f.jsonl(path.join(s.root, 'projects', 'p', 'sess.jsonl'), [
      { ...f.assistant('m1', { input_tokens: 5, output_tokens: 7 }), sessionId: 'sess' },
      { type: 'user', uuid: 'h1', sessionId: 'sess', timestamp: f.timestamp, message: { content: 'real prompt' } },
      { type: 'user', uuid: 'h2', sessionId: 'sess', timestamp: f.timestamp, message: { content: '<task-notification>x</task-notification>' } }]), 'claude'],
    [f.jsonl(path.join(s.root, `rollout-a-${parent}.jsonl`), [meta(parent, at), tokens(local(2026, 11, 3, 10, 5), 1000)]), 'codex'],
    [f.jsonl(path.join(s.root, `rollout-b-${child}.jsonl`), [meta(child, at, { parent_thread_id: parent }), meta(parent, at), tokens(local(2026, 11, 3, 10, 9), 600)]), 'codex'],
    [f.write(path.join(s.root, 'review-ledger.log'), '# header\n2026-11-03|Standard|yes|0|0|0|x (worker Sol)\n'), 'ledger']];
  fs.appendFileSync(files[0][0], '{not json\n');
  let store = s.open(database);
  for (const [file, kind] of files) await read(store, file, kind);
  aggregate(store, () => false);
  const claudeFacts = () => store.get('SELECT COUNT(*) n, SUM(input) i, SUM(output) o FROM claude_messages');
  const before = claudeFacts();
  // Make this DB look like v6 wrote it: the fork overwrote the parent (600) and the child stayed 0,
  // the tag-only row was a turn, codex_days did not exist, the old quota key had no account.
  store.run(`UPDATE codex_sessions SET total_tokens=CASE session_id WHEN ? THEN 600 ELSE 0 END, input=CASE session_id WHEN ? THEN 600 ELSE 0 END, account=NULL`, parent, parent);
  store.run('DELETE FROM codex_days');
  store.insert('human_turns', { id: hash('human:h2'), session_id: 'sess' }); store.run('UPDATE claude_sessions SET turns=2');
  store.exec(`DROP TABLE quota_snapshots; CREATE TABLE quota_snapshots (ts INTEGER NOT NULL, source INTEGER NOT NULL, window INTEGER NOT NULL,
    used_pct REAL NOT NULL, resets_at INTEGER NOT NULL, UNIQUE(source,window,resets_at,used_pct)) STRICT;`);
  store.run('INSERT INTO quota_snapshots VALUES (1,?,?,50,99)', store.intern('source', 'codex'), store.intern('window', 'primary'));
  store.setMeta('schema_version', '6');
  const counters = () => ['parse_errors', 'ledger_warnings'].map(k => store.meta(k));
  const countersBefore = counters();
  store.close(); store = s.open(database);
  assert.equal(store.meta('schema_version'), String(SCHEMA_VERSION));
  assert.equal(store.get('SELECT COUNT(*) n FROM quota_snapshots WHERE account<>0').n, 1, 'old Codex snapshot kept under the default account');
  assert.equal(store.get('SELECT SUM(total_tokens) t FROM codex_days').t, 600, 'until replay, the v6 totals stay as one day row');
  for (const [file, kind] of files) await read(store, file, kind);
  aggregate(store, () => false);
  assert.deepEqual(claudeFacts(), before, 'Claude facts unchanged');
  assert.deepEqual(counters(), countersBefore, 'line counters counted once');
  assert.equal(store.get('SELECT turns FROM claude_sessions').turns, 1);
  assert.equal(store.get('SELECT total_tokens t FROM codex_sessions WHERE session_id=?', parent).t, 1000);
  assert.equal(store.get('SELECT total_tokens t FROM codex_sessions WHERE session_id=?', child).t, 600);
  assert.equal(store.get('SELECT SUM(total_tokens) t FROM codex_days').t, 1600);
  assert.equal(store.get("SELECT SUM(t.input+t.output) io FROM daily_tokens t JOIN names n ON n.id=t.source WHERE n.name='codex'").io, 1600);
  assert.equal(store.get('SELECT COUNT(*) n FROM codex_reseed').n, 0);
  assert.equal(store.get("SELECT n.name FROM ledger l JOIN names n ON n.id=l.model").name, 'gpt-6-sol');
  // A second open does not replay again, and re-reading changes nothing.
  store.close(); store = s.open(database);
  assert.notEqual(store.get('SELECT MIN(offset) o FROM ingest_state').o, 0);
  for (const [file, kind] of files) await read(store, file, kind);
  assert.equal(store.get('SELECT SUM(total_tokens) t FROM codex_days').t, 1600);
  assert.deepEqual(counters(), countersBefore);
});
