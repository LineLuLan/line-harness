/* Intent: tests for web/route.js (the hash route, H6b) and its place in the server's static allowlist.
 * Status: pure functions imported as an ES module from Node. Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { start } = require('../server/server');

const PAGES = ['overview', 'supervisor', 'workers', 'models', 'cost', 'productivity', 'harness', 'gates', 'system', 'trace'];
const DAYS = [1, 7, 14, 30, 90];
// Imported from a data: URL so Node reads it as an ES module without a package.json "type" warning
// (route.js has no imports of its own).
const load = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.resolve(__dirname, '../web/route.js'), 'utf8'))}`);

test('readRoute: plain page, models with and without a key, encoded "/", bad percent-encoding, fallbacks', async () => {
  const { readRoute, hashOf } = await load();
  const read = h => readRoute(h, PAGES, DAYS);
  assert.deepEqual(read('#workers?days=30'), { page: 'workers', days: 30, model: null });
  assert.deepEqual(read('#workers/extra?days=7'), { page: 'workers', days: 7, model: null }, 'only models takes a key');
  assert.deepEqual(read('#models?days=7'), { page: 'models', days: 7, model: null });
  assert.deepEqual(read('#models/?days=7'), { page: 'models', days: 7, model: null }, 'empty key = no pick');
  assert.deepEqual(read('#models/gpt-6.1-sol?days=30&theme=dark'), { page: 'models', days: 30, model: 'gpt-6.1-sol' });
  assert.deepEqual(read(`#${hashOf('models', 14, 'a/b c')}`), { page: 'models', days: 14, model: 'a/b c' }, 'an encoded "/" stays inside the key');
  assert.equal(hashOf('models', 14, 'a/b c'), 'models/a%2Fb%20c?days=14');
  assert.deepEqual(read('#models/codex%3AOpus?days=7'), { page: 'models', days: 7, model: 'codex:Opus' });
  assert.deepEqual(read('#models/%E0%A4%A?days=7'), { page: 'models', days: 7, model: null }, 'bad percent-encoding drops the pick');
  assert.deepEqual(read('#usage?days=90'), { page: 'cost', days: 90, model: null });
  assert.deepEqual(read('#nope?days=5'), { page: 'overview', days: 14, model: null });
  assert.deepEqual(read(''), { page: 'overview', days: 14, model: null });
});

test('hashOf: a range switch keeps the pick, a new pick keeps the range, round trip', async () => {
  const { readRoute, hashOf } = await load();
  const read = h => readRoute(h, PAGES, DAYS);
  const now = read(`#${hashOf('models', 30, 'gpt-6-astra')}`);
  const ranged = read(`#${hashOf(now.page, 7, now.model)}`);
  assert.deepEqual(ranged, { page: 'models', days: 7, model: 'gpt-6-astra' });
  const picked = read(`#${hashOf('models', ranged.days, "gpt-q'uote")}`);
  assert.deepEqual(picked, { page: 'models', days: 7, model: "gpt-q'uote" });
  assert.equal(hashOf('trace', 1), 'trace?days=1');
  assert.equal(hashOf('models', 30, null), 'models?days=30');
});

test('/route.js is on the static allowlist as JavaScript under the same CSP', async t => {
  const server = start({ port: 0, checkMs: 50, db: path.join(__dirname, 'no-such.db') });
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.stop());
  const port = server.address().port;
  const r = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/route.js', headers: { host: `127.0.0.1:${port}` } }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject));
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/javascript/);
  assert.match(r.headers['content-security-policy'], /script-src 'self' 'sha256-/);
  assert.match(r.body, /export function readRoute/);
});
