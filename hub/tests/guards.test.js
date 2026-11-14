/* Intent: tests for the two harness-guard rules of "Do this now": f (~/AGENTS.md is back) and g (a Codex thread
 *   over 50M cumulative tokens active in the last 48 h), their place in the order a > b > f > c > g > d > e,
 *   bigThreads() on a real SQLite store, the Harness payload list, and no path / prompt text in any payload.
 * Status: synthetic inputs only; the fake home is a temp folder (LINE_HUB_HOME). Next: none. Blockers: none.
 * Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
const { day } = require('../collector/values');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function tmp(t, name) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `guards-${name}-`));
  const stores = [];
  const saved = process.env.LINE_HUB_HOME;
  t.after(() => {
    if (saved === undefined) delete process.env.LINE_HUB_HOME; else process.env.LINE_HUB_HOME = saved;
    for (const x of stores) try { x.close(); } catch { /* closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, open: () => { const x = new Store(path.join(dir, 'hub.db')); stores.push(x); return x; } };
}
// One Codex thread row. The session id carries the private MARKER so a leak of the full id would show.
function thread(store, { id, tokens, last, model = 'gpt-6.1-sol', source = 'user' }) {
  store.insert('codex_sessions', { session_id: id, model: store.intern('model', model), thread_source: store.intern('thread_source', source),
    project: store.intern('project', `C:\\${f.MARKER}\\project-a`), started: last - 2 * HOUR, ended: last, token_ts: last,
    day: day(last), total_tokens: tokens });
}
const big = (tokens, extra = {}) => ({ id: 'abcdef12', model: 'gpt-6.1-sol', source: 'user', tokens, lastTs: NOW - HOUR, ...extra });

test('RULES has the thread thresholds', () => {
  assert.equal(q.RULES.threadTokens, 50e6);
  assert.equal(q.RULES.threadActiveHours, 48);
});

test('rule f: fires when the fake home has AGENTS.md, silent otherwise; never reads it', t => {
  const { dir } = tmp(t, 'home');
  process.env.LINE_HUB_HOME = dir;
  assert.equal(q.strayAgents(), false);
  assert.equal(q.actionBox({ strayAgents: q.strayAgents() }).rule, null);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), f.MARKER);
  assert.equal(q.strayAgents(), true);
  const box = q.actionBox({ strayAgents: q.strayAgents() });
  assert.equal(box.rule, 'f'); assert.equal(box.level, 'bad'); assert.equal(box.href, 'harness');
  assert.equal(box.text, '~/AGENTS.md is back: Codex reads stale rules from it.');
  assert.equal(box.action, 'Move it out of the home folder and check what recreated it (Codex desktop Claude import).');
  assert.doesNotMatch(JSON.stringify(box), new RegExp(f.MARKER), 'the file content never reaches the payload');
  // An explicit env object is honoured too.
  assert.equal(q.strayAgents({ LINE_HUB_HOME: path.join(dir, 'nope') }), false);
});

test('rule g: fires at 51M, silent at 49M', () => {
  const box = q.actionBox({ bigThreads: [big(51e6)] });
  assert.equal(box.rule, 'g'); assert.equal(box.level, 'warn'); assert.equal(box.href, 'workers');
  assert.equal(box.text, 'Codex thread abcdef12 (gpt-6.1-sol, user) used 51M tokens, over the 50M per-session rule.');
  assert.equal(box.action, 'Stop that session and report to Line; start a fresh one.');
  assert.equal(q.actionBox({ bigThreads: [big(49e6)] }).rule, null);
  assert.equal(q.actionBox({ bigThreads: [big(50e6)] }).rule, null, 'the threshold is strict');
});

test('"Do this now" order: a > b > f > c > g > d', () => {
  const quota = { name: 'Codex 7-day', source: 'codex', pace: 1.8, leftPct: 20, expired: false, resetsAt: 1_800_000_000 };
  let x = { quotas: [quota], ram: { freePct: 5, commitPct: 95 }, strayAgents: true, drives: [{ d: 'C:', freePct: 5, free: 5e9, total: 1e11 }],
    bigThreads: [big(60e6)], clean: { now: 30, prev: 70, nNow: 10, nPrev: 10 } };
  const order = [];
  for (const drop of [{ quotas: [] }, { ram: null }, { strayAgents: false }, { drives: [] }, { bigThreads: [] }, { clean: null }]) {
    order.push(q.actionBox(x).rule);
    x = { ...x, ...drop };
  }
  order.push(q.actionBox(x).rule);
  assert.deepEqual(order, ['a', 'b', 'f', 'c', 'g', 'd', null]);
});

test('bigThreads on a store: > 50M and active within the window, newest first, labels only', t => {
  const { open } = tmp(t, 'db');
  const store = open();
  thread(store, { id: `fresh51m-${f.MARKER}`, tokens: 51e6, last: NOW - HOUR });
  thread(store, { id: `newer60m-${f.MARKER}`, tokens: 60e6, last: NOW - 60 });
  thread(store, { id: `small49m-${f.MARKER}`, tokens: 49e6, last: NOW - HOUR });
  thread(store, { id: `stale90m-${f.MARKER}`, tokens: 90e6, last: NOW - 49 * HOUR, model: 'gpt-6-astra', source: 'subagent' });
  const since48 = NOW - q.RULES.threadActiveHours * HOUR;
  const list = q.bigThreads(store.db, since48);
  assert.deepEqual(list.map(x => x.id), ['newer60m', 'fresh51m']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'lastTs', 'model', 'source', 'tokens']);
  assert.equal(list[1].model, 'gpt-6.1-sol'); assert.equal(list[1].source, 'user'); assert.equal(list[1].tokens, 51e6);
  // Older than 48 h: not in the rule input, but in a 30-day range.
  assert.deepEqual(q.bigThreads(store.db, NOW - 30 * 86400).map(x => x.id), ['newer60m', 'fresh51m', 'stale90m']);
  // Only the old thread over 50M: rule g is silent.
  const onlyOld = q.bigThreads(store.db, since48).filter(x => x.id === 'stale90m');
  assert.equal(q.actionBox({ bigThreads: onlyOld }).rule, null);
});

test('overview and harness payloads: rule g fires from the DB, Harness lists every big thread, no path or prompt text', t => {
  const { dir, open } = tmp(t, 'pages');
  process.env.LINE_HUB_HOME = dir; // no AGENTS.md here: rule f stays silent
  const store = open();
  thread(store, { id: `recent51-${f.MARKER}`, tokens: 51e6, last: NOW - HOUR });
  thread(store, { id: `older99m-${f.MARKER}`, tokens: 99e6, last: NOW - 5 * 86400 });
  const o = q.pages.overview(store.db, q.range(7));
  assert.equal(o.action.rule, 'g');
  assert.match(o.action.text, /^Codex thread recent51 \(gpt-6\.1-sol, user\) used 51M tokens/);
  const h = q.pages.harness(store.db, q.range(30));
  assert.deepEqual(h.bigThreads.map(x => x.id), ['recent51', 'older99m']);
  for (const payload of [o, h]) {
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, new RegExp(f.MARKER), 'no full thread id, path or prompt text');
  }
  // With AGENTS.md in the fake home, rule f wins over g.
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'x');
  assert.equal(q.pages.overview(store.db, q.range(7)).action.rule, 'f');
});
