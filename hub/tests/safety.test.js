/* Intent: prove concurrency, dirty-day isolation and bounded repeated ingestion.
 * Status: deterministic acceptance regressions with SQLite leases. Next: supervisor independent review.
 * Blockers: none. Confidence: tests use private synthetic scratch directories only. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acquire } = require('../collector/lock');
const { Store } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { aggregate } = require('../collector/aggregate');
const v = require('../collector/values');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: f.environment(root) };
}
test('multiple bounded slices equal one full pass, including unchanged daily rows', async t => {
  const { root, env } = setup(t);
  const current = new Date();
  const earlier = new Date(current.getTime() - 86400000);
  const rows = Array.from({ length: 1300 }, (_, i) => ({ ...f.assistant(`sliced-${i}`, { input_tokens: i }),
    timestamp: (i < 650 ? earlier : current).toISOString() }));
  const file = f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 's.jsonl'), rows);
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  const sliced = new Store(path.join(root, 'sliced.db'));
  const full = new Store(path.join(root, 'full.db'));
  try {
    let total = 0;
    while (total < rows.length) {
      let checked = 0;
      const n = await ingest(sliced, item, () => ++checked > 73);
      assert.ok(n > 0 && n <= 73); total += n;
      aggregate(sliced, () => false);
    }
    await ingest(full, item, () => false); aggregate(full, () => false);
    const sql = 'SELECT day,input,output,messages FROM daily_tokens ORDER BY day';
    assert.deepEqual(sliced.all(sql), full.all(sql));
    const oldDay = v.day(Math.floor(earlier.getTime() / 1000));
    sliced.exec(`CREATE TRIGGER protect_untouched BEFORE DELETE ON daily_tokens
      WHEN OLD.day='${oldDay}' BEGIN SELECT RAISE(ABORT,'untouched day recomputed'); END`);
    fs.appendFileSync(file, JSON.stringify(f.assistant('new-day-only', { input_tokens: 7 })) + '\n');
    await ingest(sliced, { ...item, stat: fs.statSync(file) }, () => false);
    aggregate(sliced, () => false);
    assert.equal(sliced.get('SELECT COUNT(*) n FROM claude_messages').n, 1301);
  } finally { sliced.close(); full.close(); }
});
test('leases are scoped to the configured database, including databases in one directory', t => {
  const { root } = setup(t);
  const first = path.join(root, 'first.db'), second = path.join(root, 'second.db');
  const releaseFirst = acquire(first), releaseSecond = acquire(second);
  try {
    assert.equal(typeof releaseFirst, 'function'); assert.equal(typeof releaseSecond, 'function');
    assert.equal(acquire(first), null); assert.equal(acquire(second), null);
    assert.equal(fs.existsSync(path.join(root, 'collect.lock')), false);
  } finally { releaseFirst?.(); releaseSecond?.(); }
});
