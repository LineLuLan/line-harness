/* Intent: preserve legacy H8b HTTP contracts after their views were consolidated.
 * Status: fixture-only; UI coverage moved to hub-slim.test.js. Next: none. Blockers: none. Confidence: runtime assertions. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Store } = require('../collector/db');
const { start } = require('../server/server');
// H10: removed Models/Gates/Routing UI assertions are replaced by hub-slim.test.js.
// Legacy API contracts below remain supported and tested.

test('H8b HTTP: tier allow-list, compare/pairs payload and Gates, including a v8 database', async t => {
  const base = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'h8b-http-')), file = path.join(dir, 'hub.db');
  const s = new Store(file);
  s.exec('DROP INDEX runs_spec_sha; ALTER TABLE runs DROP COLUMN spec_sha'); s.setMeta('schema_version', '8'); s.close();
  const server = start({ db: file, port: 0, systemDir: path.join(dir, 'system') });
  t.after(() => { server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await new Promise(resolve => server.on('listening', resolve));
  const get = endpoint => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: endpoint }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', x => { body += x; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  }).on('error', reject));
  for (const [tier, expected] of [['Important', 'Important'], ["x' OR 1=1", 'All'], ['', 'All']]) {
    const result = await get(`/api/models?days=14&tier=${encodeURIComponent(tier)}`);
    assert.equal(result.status, 200); assert.equal(result.body.data.compare.tier, expected);
    assert.deepEqual(result.body.data.pairs, []); assert.ok(Array.isArray(result.body.data.models));
  }
  const result = await get('/api/gates?days=14');
  assert.equal(result.status, 200); assert.equal(result.body.data.tiers.length, 8);
});
