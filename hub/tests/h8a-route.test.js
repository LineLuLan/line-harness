/* Intent: H8a routeAdvice(): today's model routing from the live quota pace (CLAUDE.md "Route by quota pace").
 *   Every matrix cell, the level boundaries (Codex 1.0 / 1.3 / 70 / 85 / 95, Claude 7-day 1.2 / 70, 5-hour 80),
 *   STOP, null / early pace and the all-null input; routeInputOf() maps live quota rows to the input.
 * Status: written before the implementation (red run in the H8a report). Next: none. Blockers: none.
 * Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('../server/queries');

const SOL = 'gpt-6-sol high', ASTRA = 'gpt-6-astra high', ASTRA_NR = 'gpt-6-astra high (no resumes)';
const LUNA = 'gpt-6-luna max then gpt-6-sol ultra', SB_COND = 'gpt-6-sol high if <=3 files and runnable VALIDATE, else gpt-6-astra high';
const OPUS = 'Opus subagent', EXPLORE = 'Claude Explore subagent', FABLE = 'Fable subagent', L2_ASTRA = 'gpt-6-astra';
const L3I_K0 = 'Fable via /model', L3I_K1 = 'Opus supervisor (Fable only for Critical)', L3C = 'Fable 5.2 high via /model claude-fable-5-2';
const WORK = ['Standard-A', 'Standard-B', 'Important/Critical worker', 'Exploration', 'Layer-2 review', 'Layer-3 Important', 'Layer-3 Critical'];
const STOP = 'No new packets; report to Line';

// One input per level: the Codex and Claude values that produce exactly that level.
const CODEX = { C0: { codexPace: 0.8, codexUsed: 40 }, C1: { codexPace: 1.1, codexUsed: 50 }, C2: { codexPace: 1.5, codexUsed: 60 }, C3: { codexPace: 0.9, codexUsed: 96 } };
const CLAUDE = { K0: { claude7Pace: 0.9, claude7Used: 30 }, K1: { claude7Pace: 1.3, claude7Used: 40 } };
const advice = (k, c, extra = {}) => q.routeAdvice({ ...CODEX[c], ...CLAUDE[k], claude5Used: 10, ...extra });
const models = a => a.rows.map(r => r.model);

const MATRIX = {
  'K0 C0': [SOL, ASTRA, ASTRA, LUNA, L2_ASTRA, L3I_K0, L3C],
  'K0 C1': [SOL, SB_COND, ASTRA, EXPLORE, FABLE, L3I_K0, L3C],
  'K0 C2': [OPUS, OPUS, ASTRA_NR, EXPLORE, FABLE, L3I_K0, L3C],
  'K0 C3': [OPUS, OPUS, OPUS, EXPLORE, FABLE, L3I_K0, L3C],
  'K1 C0': [SOL, ASTRA, ASTRA, LUNA, L2_ASTRA, L3I_K1, L3C],
  'K1 C1': [SOL, SB_COND, ASTRA, EXPLORE, L2_ASTRA, L3I_K1, L3C],
  'K1 C2': [SOL, SOL, ASTRA_NR, EXPLORE, L2_ASTRA, L3I_K1, L3C]
};

for (const [cell, want] of Object.entries(MATRIX)) {
  test(`routeAdvice matrix ${cell}`, () => {
    const [k, c] = cell.split(' ');
    const a = advice(k, c);
    assert.equal(a.codexLevel, c); assert.equal(a.claudeLevel, k);
    assert.equal(a.stop, false); assert.equal(a.handoff, false);
    assert.deepEqual(a.rows.map(r => r.work), WORK);
    assert.deepEqual(models(a), want);
    for (const r of a.rows) assert.ok(typeof r.rule === 'string' && r.rule.length > 0, `${r.work} has a rule`);
    assert.ok(a.notes.includes('daily budget rule not tracked'));
  });
}

test('routeAdvice matrix K1 C3: STOP on every row', () => {
  const a = advice('K1', 'C3');
  assert.equal(a.stop, true); assert.equal(a.codexLevel, 'C3'); assert.equal(a.claudeLevel, 'K1');
  assert.deepEqual(models(a), WORK.map(() => STOP));
});

test('routeAdvice: each rule names the level that produced it', () => {
  const c2 = advice('K0', 'C2');
  assert.equal(c2.rows[0].rule, 'Codex C2: pace 1.50 > 1.3');
  assert.match(c2.rows[4].rule, /^Codex C2/);
  assert.match(c2.rows[5].rule, /^Claude K0/);
  const k1 = advice('K1', 'C1');
  assert.equal(k1.rows[4].rule, 'Claude K1: 7-day pace 1.30 > 1.2');
  for (const row of advice('K1', 'C2').rows.slice(0, 2)) assert.match(row.rule, /Claude K1.*Codex C2.* - Line 2026-11-15: Standard never deferred$/);
  assert.equal(advice('K0', 'C3').rows[0].rule, 'Codex C3: used 96% >= 95');
  assert.equal(q.routeAdvice({ codexPace: 0.5, codexUsed: 86, claude7Pace: 0.5, claude7Used: 10, claude5Used: 0 }).rows[0].rule, 'Codex C2: used 86% >= 85');
  assert.equal(q.routeAdvice({ codexPace: 0.5, codexUsed: 10, claude7Pace: 0.5, claude7Used: 75, claude5Used: 0 }).rows[4].rule, 'Claude K1: 7-day used 75% >= 70');
});

test('routeAdvice boundaries: Codex pace 1.0 / 1.3 and used 70 / 85 / 95', () => {
  const lvl = (codexPace, codexUsed) => q.routeAdvice({ codexPace, codexUsed, claude7Pace: 0.5, claude7Used: 10, claude5Used: 0 }).codexLevel;
  assert.equal(lvl(1.0, 10), 'C0'); assert.equal(lvl(1.01, 10), 'C1');
  assert.equal(lvl(1.3, 10), 'C1'); assert.equal(lvl(1.31, 10), 'C2');
  assert.equal(lvl(0.5, 69.9), 'C0'); assert.equal(lvl(0.5, 70), 'C1');
  assert.equal(lvl(0.5, 84.9), 'C1'); assert.equal(lvl(0.5, 85), 'C2');
  assert.equal(lvl(0.5, 94.9), 'C2'); assert.equal(lvl(0.5, 95), 'C3');
});

test('routeAdvice boundaries: Claude 7-day pace 1.2 / used 70; 5-hour 80', () => {
  const k = (claude7Pace, claude7Used) => q.routeAdvice({ codexPace: 0.5, codexUsed: 10, claude7Pace, claude7Used, claude5Used: 0 }).claudeLevel;
  assert.equal(k(1.2, 10), 'K0'); assert.equal(k(1.21, 10), 'K1');
  assert.equal(k(0.5, 69.9), 'K0'); assert.equal(k(0.5, 70), 'K1');
  const h = claude5Used => q.routeAdvice({ codexPace: 0.5, codexUsed: 10, claude7Pace: 0.5, claude7Used: 10, claude5Used });
  assert.equal(h(79.9).handoff, false);
  const at80 = h(80);
  assert.equal(at80.handoff, true);
  assert.ok(at80.notes.includes('Claude 5-hour >= 80%: finish the current check, update the handoff, pause Claude work until the window resets'));
  assert.deepEqual(models(at80), MATRIX['K0 C0'], 'rows are still shown');
});

test('routeAdvice STOP: only C3 with K1; both sides over 85 retain K1 C2', () => {
  const s = (codexUsed, claude7Used) => q.routeAdvice({ codexPace: 0.5, codexUsed, claude7Pace: 0.5, claude7Used, claude5Used: 0 });
  const at85 = s(85, 85);
  assert.equal(at85.stop, false); assert.equal(at85.codexLevel, 'C2'); assert.equal(at85.claudeLevel, 'K1');
  assert.deepEqual(models(at85), MATRIX['K1 C2']);
  const over = s(85.1, 85.1);
  assert.equal(over.stop, false);
  assert.deepEqual(models(over), MATRIX['K1 C2']);
  assert.ok(!over.notes.some(n => /No new packets/.test(n)));
  // STOP overrides K5 rows too, and K5 still asks for the handoff.
  const both = q.routeAdvice({ codexPace: 0.5, codexUsed: 96, claude7Pace: 1.5, claude7Used: 10, claude5Used: 90 });
  assert.equal(both.stop, true); assert.equal(both.handoff, true);
  assert.deepEqual(models(both), WORK.map(() => STOP));
});

test('routeAdvice: null pace counts as under every pace threshold; the used % still applies', () => {
  const a = q.routeAdvice({ codexPace: null, codexUsed: 72, claude7Pace: null, claude7Used: 20, claude5Used: null });
  assert.equal(a.codexLevel, 'C1'); assert.equal(a.claudeLevel, 'K0');
  assert.equal(q.routeAdvice({ codexPace: null, codexUsed: 10, claude7Pace: null, claude7Used: 75, claude5Used: null }).claudeLevel, 'K1');
});

test('routeAdvice: all-null input = C0 / K0 with the "no Codex data" note, no STOP, no handoff', () => {
  const a = q.routeAdvice({ codexPace: null, codexUsed: null, claude7Pace: null, claude7Used: null, claude5Used: null });
  assert.equal(a.codexLevel, 'C0'); assert.equal(a.claudeLevel, 'K0');
  assert.equal(a.stop, false); assert.equal(a.handoff, false);
  assert.ok(a.notes.includes('no Codex data'));
  assert.ok(a.notes.includes('daily budget rule not tracked'));
  assert.deepEqual(models(a), MATRIX['K0 C0']);
  assert.equal(q.routeAdvice({}).codexLevel, 'C0', 'missing keys = null');
});

test('routeInputOf: Claude 7-day, Claude 5-hour, the longest Codex window; early / expired pace is null', () => {
  const rows = [
    { source: 'claude', window: 'seven_day', windowSecs: 7 * 86400, pace: 1.4, early: false, usedPct: 33, expired: false },
    { source: 'claude', window: 'five_hour', windowSecs: 5 * 3600, pace: 2, early: true, usedPct: 81, expired: false },
    { source: 'codex', window: 'primary', windowSecs: 5 * 3600, pace: 3, early: false, usedPct: 90, expired: false },
    { source: 'codex', window: 'secondary', windowSecs: 7 * 86400, pace: 1.2, early: true, usedPct: 50, expired: false }
  ];
  assert.deepEqual(q.routeInputOf(rows), { codexPace: null, codexUsed: 50, claude7Pace: 1.4, claude7Used: 33, claude5Used: 81 });
  assert.deepEqual(q.routeInputOf([]), { codexPace: null, codexUsed: null, claude7Pace: null, claude7Used: null, claude5Used: null });
  // An expired window carries no live data.
  assert.equal(q.routeInputOf([{ ...rows[0], expired: true, pace: null }]).claude7Used, null);
});
