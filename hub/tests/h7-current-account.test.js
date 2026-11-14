/* Intent: H7 regression - the "current" Codex account in quota() follows the account codex-acc.ps1
 *   marks active (<accounts>/active), not the account with the newest snapshot.
 * Status: synthetic fixtures through the real collect() entry point. Covers: switch to acc2 whose
 *   snapshots are older than default's, switch back with "main", fallback to the newest snapshot when
 *   the file is missing, empty, invalid, or names an account with no snapshots.
 * Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
const { collect, options } = require('../collector/collect');
const { paths } = require('../collector/sources');
const q = require('../server/queries');
const f = require('./fixtures/synthetic');

function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'h7-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: f.environment(root) };
}
const UUID = n => `0000000${n}-aaaa-bbbb-cccc-00000000000${n}`;
const iso = ts => new Date(ts * 1000).toISOString();
function roll(home, id, used, at, resets) {
  return f.jsonl(path.join(home, 'sessions', '2026', '11', '14', `rollout-${id}.jsonl`), [
    { type: 'session_meta', timestamp: iso(at), payload: { id, timestamp: iso(at), cwd: '/x', thread_source: 'user' } },
    { type: 'event_msg', timestamp: iso(at), payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1 } },
      rate_limits: { primary: { used_percent: used, resets_at: resets } } } }]);
}
async function currentCodex(env, now) {
  await collect(paths(env), options(['--full']));
  const store = new Store(env.LINE_HUB_DB);
  try { return q.quota(store.db, now).filter(x => x.source === 'codex').map(x => `${x.account}:${x.used_pct}`); }
  finally { store.close(); }
}

test('H7 current Codex account = the account codex-acc.ps1 marks active, newest snapshot only as fallback', async t => {
  const { env } = setup(t);
  const config = paths(env), now = Math.floor(Date.now() / 1000), H = 3600;
  // default ran last (1 h ago); acc2 last ran 30 h ago. Line then ran `codex-acc.ps1 use acc2`.
  roll(config.codex, UUID(1), 80, now - H, now + 50 * H);
  roll(path.join(config.codexAccounts, 'acc2'), UUID(2), 20, now - 30 * H, now + 100 * H);
  const active = path.join(config.codexAccounts, 'active');
  fs.writeFileSync(active, 'acc2\n');
  assert.deepEqual(await currentCodex(env, now), ['acc2:20'], 'active acc2 wins over the newer default snapshot');
  // `codex-acc.ps1 use main` writes "main"; the main home is labelled "default" in the hub.
  fs.writeFileSync(active, 'main\n');
  assert.deepEqual(await currentCodex(env, now), ['default:80']);
  // No signal: missing, empty or invalid file, or an active account with no snapshot yet -> newest snapshot.
  fs.writeFileSync(active, 'acc2\n'); await currentCodex(env, now);
  for (const content of [null, '', '../x\n', 'acc3\n']) {
    if (content === null) fs.rmSync(active); else fs.writeFileSync(active, content);
    assert.deepEqual(await currentCodex(env, now), ['default:80'], `fallback for ${JSON.stringify(content)}`);
  }
  // Newest-snapshot fallback still follows the newest account (acc2 runs again, newer than default).
  roll(path.join(config.codexAccounts, 'acc2'), UUID(3), 25, now - 60, now + 100 * H);
  assert.deepEqual(await currentCodex(env, now), ['acc2:25']);
});

test('H7 option A (Line 2026-11-15): accounts folder without an active file = main, even when another account is newer', async t => {
  const { env } = setup(t);
  const config = paths(env), now = Math.floor(Date.now() / 1000), H = 3600;
  roll(config.codex, UUID(1), 80, now - 30 * H, now + 50 * H);
  roll(path.join(config.codexAccounts, 'acc2'), UUID(2), 20, now - H, now + 100 * H);
  assert.equal(fs.existsSync(path.join(config.codexAccounts, 'active')), false);
  assert.deepEqual(await currentCodex(env, now), ['default:80'], 'no active file -> main (default), not the newer acc2');
});
