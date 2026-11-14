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

const PAGES = ['overview', 'flow', 'work', 'cost', 'machine', 'trace'];
const DAYS = [1, 7, 14, 30, 90];
// Imported from a data: URL so Node reads it as an ES module without a package.json "type" warning
// (route.js has no imports of its own).
const load = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.resolve(__dirname, '../web/route.js'), 'utf8'))}`);

test('readRoute: six pages, old model keys redirect, malformed keys and fallbacks', async () => {
  const { readRoute } = await load();
  const read = h => readRoute(h, PAGES, DAYS);
  for (const page of PAGES) assert.deepEqual(read(`#${page}?days=30`), { page, days: 30, model: null });
  for (const key of ['', '/', '/gpt-6.1-sol', '/a%2Fb%20c', '/codex%3AOpus', '/%E0%A4%A']) {
    assert.deepEqual(read(`#models${key}?days=7`), { page: 'cost', days: 7, model: null });
  }
  assert.deepEqual(read('#workers/extra?days=7'), { page: 'work', days: 7, model: null });
  assert.deepEqual(read('#usage?days=90'), { page: 'cost', days: 90, model: null });
  for (const hash of ['#nope?days=5', '', '#__proto__', '#constructor']) {
    assert.deepEqual(read(hash), { page: 'overview', days: 14, model: null });
  }
});

test('hashOf: range switches retain the resolved page; legacy model hashes land on Usage', async () => {
  const { readRoute, hashOf } = await load();
  const read = h => readRoute(h, PAGES, DAYS);
  const now = read(`#${hashOf('models', 30, 'gpt-6-astra')}`);
  assert.deepEqual(read(`#${hashOf(now.page, 7, now.model)}`), { page: 'cost', days: 7, model: null });
  assert.equal(hashOf('trace', 1), 'trace?days=1');
  assert.equal(hashOf('models', 14, 'a/b c'), 'models/a%2Fb%20c?days=14');
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
