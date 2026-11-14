/* Intent: prove H8b outcome attribution, paired runs and review gates with private fixture DBs.
 * Status: test-first. Next: host API/screenshots. Blockers: none. Confidence: assertions below. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../collector/db');
const q = require('../server/queries');
const { day } = require('../collector/values');
const { parseLedger } = require('../collector/ledger');

/* Intent: isolated, deterministic fixture builders. Status: ready. Next: none. Blockers: none. Confidence: tests. */
function fixture(t) {
  const s = new Store(':memory:'); t.after(() => s.close());
  const now = new Date(2026, 10, 14, 18).getTime() / 1000, r = q.range(30, now);
  const run = (id, model = 'gpt-6-sol', extra = {}) => s.insert('runs', { run_id: id, model: s.intern('model', model),
    is_resume: 0, started: now - 1000, ended: now - 900, exit_code: 0, sandbox_failure: 0, day: day(now), ...extra });
  const ledger = (id, tier = 'Standard-A', extra = {}) => s.insert('ledger', { id, day: day(now), tier: s.intern('tier', tier),
    layer2: 0, l1_raw: '0', l2_raw: '0', l3_raw: '0', l1_count: 0, l2_count: 0, l3_count: 0,
    fail_rounds: 0, model: s.intern('model', 'gpt-6-sol'), note: id, ...extra });
  const link = (l, id) => s.insert('ledger_runs', { ledger_id: l, run_id: id });
  return { s, r, now, run, ledger, link };
}

test('modelCompare: runs, known exit denominator, effort default, session tokens once, lowData at 2/3', t => {
  const { s, r, now, run } = fixture(t);
  s.insert('codex_sessions', { session_id: 'root', model: s.intern('model', 'gpt-6-sol'), day: day(now), total_tokens: 100 });
  s.insert('codex_sessions', { session_id: 'child', parent_thread_id: 'root', model: s.intern('model', 'gpt-6-sol'), day: day(now), total_tokens: 50 });
  run('a', undefined, { codex_session_id: 'child' });
  run('b', undefined, { is_resume: 1, started: now - 800, ended: now - 600, exit_code: 1, sandbox_failure: 1, codex_session_id: 'root' });
  let x = q.modelCompare(s.db, r).runs[0];
  assert.deepEqual([x.runs, x.effort, x.resumePct, x.exit0Pct, x.exitN, x.sandboxFailures, x.medianSecs, x.p90Secs, x.medianTokens, x.lowData],
    [2, 'default', 50, 50, 2, 1, 150, 200, 150, true]);
  run('c', undefined, { ended: null, exit_code: null });
  x = q.modelCompare(s.db, r).runs[0];
  assert.deepEqual([x.runs, x.exit0Pct, x.lowData, x.medianTokens], [3, 50, false, 150]);
  run('high', undefined, { effort: s.intern('effort', 'high') });
  assert.equal(q.modelCompare(s.db, r).runs.find(x => x.effort === 'high').medianTokens, null);
  run('future', undefined, { started: now + 1 });
  assert.equal(q.modelCompare(s.db, r).runs.reduce((n, x) => n + x.runs, 0), 4);
});

test('modelCompare: ledger fallback, last linked owner, unknown fail denominator, STOP, tier links', t => {
  const { s, r, now, run, ledger, link } = fixture(t);
  run('a'); run('b', 'gpt-6.1-sol', { started: now - 100 });
  ledger('one', 'Standard-A', { fail_rounds: 2, l2_count: 2, l3_count: 4 });
  ledger('two', 'Standard-A', { fail_rounds: null, l2_count: null, note: 'worker STOP: prerequisite', stop: null });
  let d = q.modelCompare(s.db, r, 'Standard-A');
  assert.equal(d.runNotice, 'tier filter needs ledger links'); assert.equal(d.runs.length, 2);
  assert.deepEqual([d.outcomes[0].tasks, d.outcomes[0].firstPassPct, d.outcomes[0].firstPassN, d.outcomes[0].meanFailRounds,
    d.outcomes[0].stopPct, d.outcomes[0].defectsAfterWorker, d.outcomes[0].defectsN, d.outcomes[0].lowData], [2, 0, 1, 2, 50, 6, 1, true]);
  ledger('three', 'Standard-A');
  assert.equal(q.modelCompare(s.db, r).outcomes[0].lowData, false);
  link('one', 'a'); link('one', 'b');
  d = q.modelCompare(s.db, r, 'Standard-A');
  assert.equal(d.runNotice, null);
  assert.equal(d.outcomes.find(x => x.key === 'gpt-6.1-sol').tasks, 1, 'last linked run owns one line once');
  ledger('important', 'Important');
  assert.deepEqual(q.modelCompare(s.db, r, 'Important').runs, [], 'existing links, none for this tier');
  assert.equal(q.modelCompare(s.db, r, 'invalid').tier, 'All');
  assert.equal(q.modelCompare(s.db, r).tier, 'All');
  assert.equal(q.modelCompare(s.db, r, 'All').outcomes.reduce((n, x) => n + x.tasks, 0), 4);
});

test('abPairs: distinct models, latest per key, ignore resume/null sha, linked outcome and note', t => {
  const { s, r, now, run, ledger, link } = fixture(t), sha = 'a'.repeat(64);
  assert.deepEqual(q.abPairs(s.db, r), []);
  run('old', undefined, { spec_sha: sha }); run('latest', undefined, { spec_sha: sha, started: now - 500 });
  assert.deepEqual(q.abPairs(s.db, r), []);
  run('resume', 'gpt-6.1-sol', { spec_sha: sha, is_resume: 1 });
  run('null', 'gpt-6.1-sol');
  assert.deepEqual(q.abPairs(s.db, r), []);
  run('other', 'gpt-6.1-sol', { spec_sha: sha, started: now - 200 });
  ledger('note', 'Important', { note: 'same packet result', fail_rounds: 2 }); link('note', 'old'); link('note', 'other');
  const pairs = q.abPairs(s.db, r);
  assert.equal(pairs.length, 1); assert.equal(pairs[0].note, 'same packet result');
  assert.equal(pairs[0].newest, now - 200);
  const a = pairs[0].models.find(x => x.key === 'gpt-6-sol'), b = pairs[0].models.find(x => x.key === 'gpt-6.1-sol');
  assert.deepEqual([a.runId, a.effort, a.exitCode, a.totalTokens, a.failRounds], ['latest', 'default', 0, null, null]);
  assert.equal(b.failRounds, 2);
});

test('gates: all tiers sum, explicit L2 evidence, STOP exemption, counts denominators, reviewers and Monday weeks', t => {
  const { s, r, now, ledger } = fixture(t);
  for (const tier of ['Skip', 'Standard', 'Standard-A', 'Standard-B', 'Critical', 'Exploration', 'Other']) ledger(tier, tier);
  ledger('used', 'Important', { layer2: parseLedger('2026-11-14|Important|no (Fable L2b yes)|1|2|3|review').row.layer2, l1_count: 1, l2_count: 2, l3_count: 3, fail_rounds: 2 });
  ledger('violation', 'Important', { day: '2026-11-08', note: 'missing L2' });
  ledger('stop', 'Critical', { note: 'worker STOP: blocked', stop: null, fail_rounds: null, l1_count: null });
  for (const [id, verdict, p0, p1] of [['pass', 'PASS', 0, 0], ['fail', 'FAIL', 1, 2]]) s.insert('reviews', {
    id, ts: now, model: s.intern('model', 'gpt-6-astra'), verdict: s.intern('verdict', verdict), p0, p1, p2: 0, p3: 0 });
  const d = q.gates(s.db, r);
  assert.equal(d.tasks, 10); assert.equal(d.tiers.reduce((n, x) => n + x.tasks, 0), d.tasks);
  const important = d.tiers.find(x => x.tier === 'Important');
  assert.deepEqual([important.tasks, important.layer2Pct, important.firstPassPct, important.meanFailRounds, important.lateSharePct], [2, 50, 50, 1, 50]);
  assert.deepEqual(important.defects, { L1: 1, L2: 2, L3: 3 });
  assert.deepEqual(important.countsN, { L1: 2, L2: 2, L3: 2 });
  assert.equal(d.tiers.find(x => x.tier === 'Skip').lateSharePct, null);
  assert.deepEqual(d.violations.map(x => x.note), ['Critical', 'missing L2']);
  assert.deepEqual([d.reviewers[0].effort, d.reviewers[0].reviews, d.reviewers[0].failPct, d.reviewers[0].meanP0P1], ['unknown', 2, 50, 1.5]);
  assert.deepEqual(d.weeks.filter(x => x.tasks).map(x => [x.week, x.tasks]), [['2026-11-02', 1], ['2026-11-09', 9]]);
});

test('H8b v8 compatibility: absent SHA and link table render empty pairs and unfiltered runs', t => {
  const { s, r, run, ledger } = fixture(t); run('a'); ledger('one');
  s.exec('DROP INDEX IF EXISTS runs_spec_sha; ALTER TABLE runs DROP COLUMN spec_sha; DROP TABLE ledger_runs');
  assert.deepEqual(q.abPairs(s.db, r), []);
  assert.equal(q.modelCompare(s.db, r, 'Important').runNotice, 'tier filter needs ledger links');
  assert.equal(q.gates(s.db, r).tasks, 1);
});

test('H8b: newest pairs and violations capped at 20, weekly trend covers latest 8 calendar weeks', t => {
  const { s, now, run, ledger, link } = fixture(t), r = q.range(365, now);
  for (let i = 0; i < 22; i++) {
    const spec_sha = i.toString(16).padStart(64, '0');
    run(`a${i}`, undefined, { spec_sha, started: now - 100 + i });
    run(`b${i}`, 'gpt-6.1-sol', { spec_sha, started: now - 100 + i });
    ledger(`v${i}`, 'Important', { day: day(now - i * 86400) });
  }
  ledger('old-note', 'Skip', { day: day(now - 200 * 86400), note: 'older run, same packet' });
  run('outside', undefined, { started: r.startTs - 1, spec_sha: '0'.repeat(63) + 'f' }); link('old-note', 'outside');
  const pairs = q.abPairs(s.db, r);
  assert.equal(pairs.length, 20); assert.equal(pairs[0].newest, now - 79);
  assert.equal(pairs.find(x => x.sha === '0'.repeat(63) + 'f').note, 'older run, same packet');
  const d = q.gates(s.db, r);
  assert.equal(d.violations.length, 20); assert.equal(d.violations[0].day, day(now));
  assert.equal(d.weeks.length, 8);
  assert.ok(!d.weeks.some(x => x.week === q.weekOf(day(now - 200 * 86400))), 'old occupied weeks must not displace recent empty weeks');
});

test('H8b: empty range and all-unknown values stay null; only explicit field-3 evidence counts', t => {
  const { s, r, now, run, ledger } = fixture(t);
  assert.deepEqual(q.modelCompare(s.db, r).runs, []); assert.deepEqual(q.modelCompare(s.db, r).outcomes, []);
  assert.equal(q.gates(s.db, r).tasks, 0);
  run('unknown', undefined, { exit_code: null, ended: null });
  ledger('unknown', 'Standard (legacy)', { fail_rounds: null, l2_count: null, l3_count: null });
  let d = q.modelCompare(s.db, r);
  assert.deepEqual([d.runs[0].exit0Pct, d.runs[0].medianSecs, d.outcomes[0].firstPassPct, d.outcomes[0].meanFailRounds, d.outcomes[0].defectsAfterWorker], [null, null, null, null, null]);
  for (const text of ['Astra', 'Opus', 'Sol', 'codex review', 'subagent']) ledger(text, 'Important', { layer2: parseLedger(`2026-11-14|Important|${text}|0|0|0|review`).row.layer2 });
  ledger('explicit', 'Important', { layer2: parseLedger('2026-11-14|Important|yes|0|0|0|review').row.layer2 });
  ledger('future', 'Critical', { day: day(now + 86400) });
  d = q.gates(s.db, r);
  assert.equal(d.tasks, 7); assert.equal(d.tiers.find(x => x.tier === 'Important').layer2Pct, 16.7);
  assert.deepEqual(d.violations.map(x => x.note), ['Astra', 'codex review', 'Opus', 'Sol', 'subagent']);
});
