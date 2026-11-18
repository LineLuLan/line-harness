const assert = require('node:assert/strict');
const { test } = require('node:test');

const { grokRow } = require('../statusline-ultrathink.js');
const now = Date.parse('2026-11-17T12:00:00Z');
const plain = row => row.replace(/\x1b\[[\d;]*m/g, '');

// Intent: pin Grok account, quota, and secret-safe display states.
// Status: fixture-covered. Next: validate refresh on the host. Blockers: none. Confidence: high.
test('grok row shows logged-out and expired states', () => {
  assert.equal(plain(grokRow({ loggedIn: false, ts: now }, now)), '  ⚡ grok not logged in');
  assert.equal(plain(grokRow({ email: 'a@b.c', expired: true, ts: now }, now)),
    '  ⚡ grok a@b.c · login expired - run grok login');
  assert.equal(grokRow(null, now), '');
});

test('grok row shows weekly quota, pace and reset date', () => {
  const row = grokRow({ email: 'a@b.c', usedPercent: 19, periodType: 'WEEKLY',
    periodEnd: '2026-11-18T01:55:12.408+00:00', ts: now }, now);
  assert.match(plain(row), /^  ⚡ grok a@b\.c · wk ▓▓▓▓▓▓▓▓░░ 81% pace 0\.2x ↻ 18\/11$/);
  // Real API value seen 2026-11-17.
  const live = grokRow({ email: 'a@b.c', usedPercent: 19, periodType: 'USAGE_PERIOD_TYPE_WEEKLY',
    periodEnd: '2026-11-18T01:55:12.408+00:00', ts: now }, now);
  assert.match(plain(live), /wk ▓▓▓▓▓▓▓▓░░ 81% pace 0\.2x ↻ 18\/11$/);
});

test('monthly period has no weekly gauge or pace and stale quota is dimmed', () => {
  const cache = { email: 'a@b.c', usedPercent: 19, periodType: 'monthly',
    periodEnd: '2026-11-18T01:55:12.408+00:00', ts: now };
  assert.equal(plain(grokRow(cache, now)), '  ⚡ grok a@b.c ↻ 18/11');
  const stale = grokRow({ ...cache, periodType: 'weekly', ts: now - 31 * 60_000 }, now);
  assert.match(stale, /\x1b\[2m/);
  assert.match(plain(stale), /wk ▓▓▓▓▓▓▓▓░░ 81%/);
});

test('extra credential-shaped cache fields are never displayed', () => {
  const row = grokRow({ email: 'a@b.c', usedPercent: 19, periodType: 'weekly',
    periodEnd: '2026-11-18T01:55:12.408+00:00', ts: now,
    // Built from parts so the layer-1 secret scan does not flag a fake value.
    key: ['secret', 'key', 'sentinel'].join('-'), token: ['secret', 'token', 'sentinel'].join('-') }, now);
  assert.doesNotMatch(row, /secret-(?:key|token)-sentinel/);
});
