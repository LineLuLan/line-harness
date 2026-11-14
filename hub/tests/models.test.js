/* Intent: tests for the H6b Models page (server/queries.js models()): key mapping, one Claude family and one
 *   Codex model aggregated, multi-model session attribution, empty range, unknown model, and the ?model=
 *   value never reaching SQL as text (a stored key with a quote is matched through bound parameters).
 * Status: synthetic fixtures only (Store + the real ledger ingest). Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { day } = require('../collector/values');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

function tmp(t, name) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `models-${name}-`));
  const stores = [];
  t.after(() => { for (const x of stores) try { x.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, open: () => { const x = new Store(path.join(dir, 'hub.db')); stores.push(x); return x; } };
}
const localTs = (daysAgo, h = 12) => { const d = new Date(); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h).getTime() / 1000); };

async function fixture(t) {
  const { dir, open } = tmp(t, 'fx');
  const store = open();
  const now = localTs(0, 18), today = day(now), yday = day(now - 86400);
  const src = { claude: store.intern('source', 'claude'), codex: store.intern('source', 'codex') };
  const m = n => store.intern('model', n);
  // daily_tokens: day, source, model, input, output, cache_read, cache_write, reasoning, messages
  const tok = (d, s, model, input, output, cr, cw, msgs) => store.run('INSERT INTO daily_tokens VALUES (?,?,?,?,?,?,?,0,?)', d, src[s], m(model), input, output, cr, cw, msgs);
  tok(today, 'claude', 'claude-opus-5-5', 10, 100, 1000, 50, 4);
  tok(yday, 'claude', 'claude-opus-4-8', 5, 20, 200, 10, 2);
  tok(today, 'claude', 'claude-fable-5-1', 1, 40, 400, 20, 4);
  tok(today, 'claude', '<synthetic>', 0, 0, 0, 0, 5);
  // Codex input includes cache read: fresh input = 500 - 300 = 200.
  tok(today, 'codex', 'gpt-6-astra', 500, 60, 300, 0, 3);
  tok(yday, 'codex', 'gpt-6-astra', 100, 10, 100, 0, 1);
  tok(today, 'codex', 'gpt-5.6-sol', 10, 5, 0, 0, 1);
  tok(today, 'codex', "gpt-q'uote", 7, 3, 0, 0, 1);
  // Claude sessions: S1 = 3 Opus (two ids) + 1 Fable -> Opus; S2 = 2 Fable + 1 Opus + 5 <synthetic> -> Fable;
  // S3 = 1 Opus + 1 Fable (tie) -> Opus (FAMILIES order).
  let n = 0;
  const msg = (sid, model, ts) => store.insert('claude_messages', { message_id: `m${n++}`, session_id: sid, ts, day: day(ts), model: m(model),
    input: 1, output: 2, cache_read: 3, cache_write: 4, reasoning: 0 });
  for (const [sid, list] of [['S1', ['claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-fable-5-1']],
    ['S2', ['claude-fable-5-1', 'claude-fable-5-1', 'claude-opus-5-5', '<synthetic>', '<synthetic>', '<synthetic>', '<synthetic>', '<synthetic>']],
    ['S3', ['claude-opus-5-5', 'claude-fable-5-1']]]) list.forEach((model, i) => msg(sid, model, now - 3000 + i * 10 + (sid === 'S3' ? 1000 : 0)));
  const proj = store.intern('project', 'repo-a');
  store.insert('claude_sessions', { session_id: 'S1', project: proj, started: now - 3000, turns: 1 });
  const tool = (id, sid, name, extra = {}) => store.insert('tool_calls', { tool_use_id: id, session_id: sid, ts: now - 2000, day: today, tool: store.intern('tool', name), ...extra });
  tool('t1', 'S1', 'Skill', { skill: store.intern('skill', 'handoff') });
  tool('t2', 'S1', 'Agent', { subagent: store.intern('subagent', 'Explore') });
  tool('t3', 'S1', 'Read'); tool('t4', 'S2', 'Grep');
  // Codex runs: astra 3 runs (two finished, one lost 3 days ago is out of a 1-day range but inside 7 days).
  const astra = m('gpt-6-astra'), high = store.intern('effort', 'high');
  const run = (id, model, started, ended, exit) => store.insert('runs', { run_id: id, model, effort: high, is_resume: 0, started, ended, exit_code: exit,
    sandbox_failure: 0, day: day(started), project: proj });
  run('r1', astra, now - 3600, now - 3000, 0);
  run('r2', astra, now - 1800, now - 600, 1);
  run('r3', astra, now - 3 * 86400, null, null);
  run('r0', astra, now - 300, null, null); // still running (no exit code, started under 2 days ago)
  run('rq', m("gpt-q'uote"), now - 900, now - 800, 0);
  store.run("UPDATE runs SET codex_session_id='A' WHERE run_id='r1'");
  // Codex threads (codex_days add up to the astra daily_tokens above): A = r1's session, A-sub = its sub-agent,
  // X = an interactive thread with no codex-do run. Token sum per row = (input - cache read) + cache read + cache write + output.
  for (const [id, parent, totalTokens] of [['A', null, 340], ['A-sub', 'A', 110], ['X', null, 220]]) store.insert('codex_sessions', { session_id: id, parent_thread_id: parent, model: astra, day: today, total_tokens: totalTokens });
  const cday = (id, d, input, output, cr) => store.run('INSERT INTO codex_days VALUES (?,?,?,?,?,0,0,0)', id, d, input, output, cr);
  cday('A', today, 300, 40, 200);      // 340
  cday('A-sub', today, 100, 10, 50);   // 110
  cday('X', today, 100, 10, 50);       // 110
  cday('X', yday, 100, 10, 100);       // 110
  store.run('INSERT INTO daily_runs VALUES (?,?,3,1,0,0,1,0)', today, astra);
  store.run('INSERT INTO daily_runs VALUES (?,?,1,0,0,0,0,0)', day(now - 3 * 86400), astra);
  store.run('INSERT INTO daily_runs VALUES (?,?,1,1,0,0,0,0)', today, m("gpt-q'uote"));
  const ledger = f.write(path.join(dir, 'review-ledger.log'), [
    `${today}|Important|yes|0|0|0|ui card fix|worker=astra`,
    `${today}|Important|yes|0|2 P2|0|collector parser fix|worker=gpt-6-astra|fail_rounds=1|type=collector`,
    `${today}|Standard|no|1|0|0|readme docs|worker=opus`,
    `${today}|Standard|no|0|0|0|small config|worker=fable`,
    `${today}|Standard|no|0|0|0|retired worker|worker=gpt-5.6-sol`,
    `${today}|Standard|no|0|0|0|ledger only key|worker=claude-subagent`,
    `${today}|Standard|no|0|0|0|no model named here`].join('\n') + '\n');
  await ingest(store, { file: ledger, kind: 'ledger', stat: fs.statSync(ledger) }, () => false);
  return { store, now };
}

test('ledgerKey maps aliases to page keys', () => {
  assert.deepEqual(q.ledgerKey('opus'), { side: 'claude', key: 'Opus' });
  assert.deepEqual(q.ledgerKey('fable'), { side: 'claude', key: 'Fable' });
  assert.deepEqual(q.ledgerKey('claude-subagent'), { side: 'claude', key: 'Other' });
  assert.deepEqual(q.ledgerKey('gpt-6-astra'), { side: 'codex', key: 'gpt-6-astra' });
  assert.deepEqual(q.ledgerKey('gpt-5.6-sol'), { side: 'codex', key: 'Other (Codex)' });
  assert.equal(q.ledgerKey('unknown'), null);
  assert.equal(q.ledgerKey(null), null);
});

test('models: one Claude family and one Codex model aggregated; retired Codex -> Other (Codex)', async t => {
  const { store, now } = await fixture(t);
  const d = q.pages.models(store.db, q.range(7, now));
  assert.equal(d.picked, null);
  const by = Object.fromEntries(d.models.map(x => [x.key, x]));
  assert.deepEqual(Object.keys(by).sort(), ['Fable', 'Opus', 'Other', 'Other (Codex)', 'gpt-6-astra', "gpt-q'uote"].sort());
  assert.ok(d.models.every(x => x.id === x.key), 'no key on both sides: id = key');
  assert.ok(!('<synthetic>' in by));
  const opus = by.Opus;
  assert.equal(opus.side, 'claude');
  assert.equal(opus.tokens, (10 + 100 + 1000 + 50) + (5 + 20 + 200 + 10), 'both Opus ids, all four token kinds');
  assert.equal(opus.sharePct, Math.round(1395 / (1395 + 461) * 1000) / 10);
  assert.deepEqual([opus.sessions, opus.runs, opus.ledgerTasks, opus.cleanPct], [2, null, 1, 0], 'S1 + S3; the opus ledger line has an L1 finding');
  const astra = by['gpt-6-astra'];
  assert.equal(astra.tokens, (200 + 60 + 300) + (0 + 10 + 100), 'fresh input = input - cache read');
  assert.deepEqual([astra.runs, astra.sessions, astra.ledgerTasks, astra.cleanPct, astra.failRounds, astra.medianSecs, astra.low],
    [4, null, 2, 50, 1, Math.round((600 + 1200) / 2), false]);
  // Tokens vs runs: 3 threads; A (run r1) + its sub-agent A-sub = codex-do, X = other. The split adds up to the tokens.
  assert.deepEqual([astra.threads, astra.runTokens, astra.otherTokens], [3, 340 + 110, 110 + 110]);
  assert.equal(astra.runTokens + astra.otherTokens, astra.tokens);
  assert.match(d.threadRule, /every Codex thread/);
  assert.equal(by['Other (Codex)'].ledgerTasks, 1);
  assert.equal(by['Other (Codex)'].low, true, 'no runs and no threads: low data, still listed');
  assert.deepEqual([by['Other (Codex)'].runs, by['Other (Codex)'].threads, by['Other (Codex)'].runTokens], [null, null, null], 'missing, not zero');
  assert.ok(d.models.findIndex(x => x.side === 'codex') > d.models.findIndex(x => x.side === 'claude'), 'Claude rows first');

  const pa = q.pages.models(store.db, q.range(7, now), 'gpt-6-astra').picked;
  assert.equal(pa.key, 'gpt-6-astra');
  assert.deepEqual([pa.runs.runs, pa.runs.exit0, pa.runs.failed, pa.runs.lost, pa.runs.running, pa.runs.medianSecs, pa.runs.p90Secs], [4, 1, 1, 1, 1, 900, 1200]);
  assert.deepEqual([pa.threads, pa.tokens.runTokens, pa.tokens.otherTokens], [3, 450, 220]);
  assert.equal(pa.effort, 'high');
  assert.deepEqual(pa.ledger.findings, { L1: 0, L2: 2, L3: 0 });
  assert.deepEqual(Object.fromEntries(pa.ledger.taskTypes.map(x => [x.type, x.n])), { ui: 1, data: 1 }, 'stored type=collector -> data; else classifyTask');
  assert.equal(pa.tokens.daily.output.length, 7);
  assert.equal(pa.tokens.daily.output.at(-1), 60);
  assert.deepEqual(pa.last.map(x => x.state), ['running', 'fail', 'ok', 'lost']);
  assert.equal(pa.last[0].repo, 'repo-a');
  assert.equal(pa.last.find(x => x.state === 'ok').tokens, 450, 'run r1 shows its whole thread tree (A + A-sub)');
  assert.ok(pa.last.every(x => !('run_id' in x) && !('codex_session_id' in x)), 'labels only');

  const po = q.pages.models(store.db, q.range(7, now), 'Opus').picked;
  assert.deepEqual(po.breakdown.map(x => x.id), ['claude-opus-5-5', 'claude-opus-4-8']);
  assert.equal(po.sessions.n, 2);
  assert.equal(po.sessions.messages, 6, 'daily_tokens messages of both Opus ids');
  assert.deepEqual(po.tops.skills.rows.map(x => x.name), ['handoff']);
  assert.deepEqual(po.tops.subagents.rows.map(x => x.name), ['Explore']);
  assert.ok(!po.tops.tools.rows.some(x => x.name === 'Grep'), 'Grep was called in S2, a Fable session');
  assert.equal(po.last.length, 2);
  assert.equal(po.last.find(x => x.repo === 'repo-a').messages, 4);
  assert.deepEqual(po.ledger.findings, { L1: 1, L2: 0, L3: 0 });
});

test('models: multi-model session attribution by most messages (synthetic left out, tie -> family order)', async t => {
  const { store, now } = await fixture(t);
  const d = q.pages.models(store.db, q.range(7, now));
  const by = Object.fromEntries(d.models.map(x => [x.key, x]));
  assert.equal(by.Fable.sessions, 1, 'S2: 2 Fable vs 1 Opus; 5 <synthetic> do not count');
  assert.equal(by.Opus.sessions, 2, 'S1 3 vs 1, S3 tie 1 vs 1 -> Opus');
  const pf = q.pages.models(store.db, q.range(7, now), 'Fable').picked;
  assert.deepEqual(pf.tops.tools.rows.map(x => x.name), ['Grep']);
  assert.match(d.sessionRule, /most messages/);
});

test('models: empty range and unknown model -> 200-shaped payload with picked null', async t => {
  const { open } = tmp(t, 'empty');
  const store = open();
  const d = q.pages.models(store.db, q.range(14), 'Opus');
  assert.deepEqual(d.models, []);
  assert.equal(d.picked, null);
  assert.equal(d.ledgerLinkRows, 0);
  const { store: s2, now } = await fixture(t);
  for (const k of ['nope', '', null, undefined, 'x'.repeat(500), 'opus']) assert.equal(q.pages.models(s2.db, q.range(7, now), k).picked, null, String(k));
  // A 1-day range: the lost run (3 days ago) and yesterday's tokens are out.
  const one = q.pages.models(s2.db, q.range(1, now), 'gpt-6-astra').picked;
  assert.deepEqual([one.runs.runs, one.runs.lost, one.runs.running, one.tokens.total], [3, 0, 1, 560]);
});

test('models: the model value is never interpolated into SQL (a quote in a key)', async t => {
  const { store, now } = await fixture(t);
  const r = q.range(7, now);
  const p = q.pages.models(store.db, r, "gpt-q'uote").picked;
  assert.ok(p, 'a stored key with a quote is found');
  assert.deepEqual([p.runs.runs, p.runs.exit0, p.last.length, p.tokens.total], [1, 1, 1, 10]);
  for (const k of ["gpt-6-astra' OR '1'='1", "'; DROP TABLE runs; --", 'gpt-6-astra"']) assert.equal(q.pages.models(store.db, r, k).picked, null, k);
  assert.equal(store.get('SELECT COUNT(*) n FROM runs').n, 5, 'runs table untouched');
});

test('models: session ownership counts ALL messages of the session; the range only lists it (20 Opus yesterday + 1 Fable today -> Opus)', t => {
  const { open } = tmp(t, 'own');
  const store = open();
  const now = localTs(0, 18), yday = localTs(1, 12);
  let n = 0;
  const msg = (model, ts) => store.insert('claude_messages', { message_id: `o${n++}`, session_id: 'LONG', ts, day: day(ts), model: store.intern('model', model),
    input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 });
  for (let i = 0; i < 20; i++) msg('claude-opus-5-5', yday + i);
  msg('claude-fable-5-1', now - 60);
  const d = q.pages.models(store.db, q.range(1, now));
  assert.deepEqual(d.models.map(x => [x.key, x.sessions]), [['Opus', 1]], 'Opus owns it; Fable has no session row');
  assert.equal(d.models[0].tokens, null, 'no daily_tokens rows: tokens missing (null), not 0');
  const p = q.pages.models(store.db, q.range(1, now), 'Opus').picked;
  assert.deepEqual([p.sessions.n, p.sessions.sessionMessages, p.last[0].messages], [1, 1, 1], 'listed with its in-range message only');
});

test('models: a ledger-only key (claude-subagent -> Other) has null tokens / sessions, not zeros', async t => {
  const { store, now } = await fixture(t);
  const d = q.pages.models(store.db, q.range(7, now));
  const other = d.models.find(x => x.side === 'claude' && x.key === 'Other');
  assert.deepEqual([other.tokens, other.output, other.sharePct, other.sessions, other.runs, other.ledgerTasks, other.cleanPct, other.low],
    [null, null, null, null, null, 1, 100, true]);
  const p = q.pages.models(store.db, q.range(7, now), 'Other').picked;
  assert.deepEqual([p.tokens.total, p.tokens.output, p.sessions.n, p.sessions.messages, p.last.length, p.breakdown.length], [null, null, null, null, 0, 0]);
  const pc = q.pages.models(store.db, q.range(7, now), 'Other (Codex)').picked;
  assert.equal(pc.runs, null, 'no run rows: the run block is missing, not zeros');
});

test('models: a key on both sides gets a side-aware id (codex:<key>); claude: / codex: prefixes resolve', t => {
  const { open } = tmp(t, 'clash');
  const store = open();
  const now = localTs(0, 18), today = day(now);
  const src = s => store.intern('source', s), m = x => store.intern('model', x);
  store.run('INSERT INTO daily_tokens VALUES (?,?,?,1,1,0,0,0,1)', today, src('claude'), m('claude-opus-5-5'));
  store.run('INSERT INTO daily_tokens VALUES (?,?,?,5,5,0,0,0,1)', today, src('codex'), m('Opus'));
  const r = q.range(7, now), d = q.pages.models(store.db, r);
  assert.deepEqual(d.models.map(x => [x.id, x.side, x.key]), [['Opus', 'claude', 'Opus'], ['codex:Opus', 'codex', 'Opus']]);
  const side = k => q.pages.models(store.db, r, k).picked?.side ?? null;
  assert.deepEqual([side('Opus'), side('codex:Opus'), side('claude:Opus'), side('codex:Fable'), side('codex:')], ['claude', 'codex', 'claude', null, null]);
  assert.equal(q.pages.models(store.db, r, 'codex:Opus').picked.id, 'codex:Opus');
});