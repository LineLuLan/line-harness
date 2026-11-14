/* Intent: prove offset-independent state-log identities and automatic v3 replay.
 * Status: synthetic regression contract. Next: supervisor independent review.
 * Blockers: none. Confidence: prefix loss, size-keeping rewrites (v4 head fingerprint),
 * duplicate slices, rollback and migration. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { hash } = require('../collector/values');
const { acquire } = require('../collector/lock');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const sources = [
  { kind: 'review', table: 'reviews', name: 'reviews.jsonl', line: i => JSON.stringify({
    utc: f.timestamp, dir: `/synthetic/project-${i}`, model: 'test', verdict: 'PASS' }) },
  { kind: 'ledger', table: 'ledger', name: 'review-ledger.log',
    line: i => `2026-11-09|Important|yes|0|PASS|PASS|synthetic ${i}` },
  { kind: 'dispatch', table: 'dispatches', name: 'dispatch-trail.log',
    line: i => `1794400000|do|test|high|session-${i}` }
];
for (const source of sources) {
  test(`${source.kind}: prefix loss keeps IDs and identical lines persist across slices and reruns`, async t => {
    const root = setup(t), database = path.join(root, 'hub.db');
    const rows = [source.line(0), source.line(1), source.line(2), source.line(2)];
    const file = f.write(path.join(root, source.name), rows.join('\n') + '\n');
    let store = new Store(database);
    const item = () => ({ file, kind: source.kind, stat: fs.statSync(file) });
    const ids = () => store.all(`SELECT id FROM ${source.table} ORDER BY id`);
    try {
      let calls = 0; await ingest(store, item(), () => ++calls > 3);
      store.close(); store = new Store(database);
      await ingest(store, item(), () => false);
      const original = ids(); assert.equal(original.length, 4);
      f.write(file, rows.slice(2).join('\n') + '\n');
      await ingest(store, item(), () => false); assert.deepEqual(ids(), original);
      store.close(); store = new Store(database);
      await ingest(store, item(), () => false); assert.deepEqual(ids(), original);
      fs.appendFileSync(file, rows[2] + '\n');
      await ingest(store, item(), () => false); assert.equal(ids().length, 5);
    } finally { store.close(); }
  });
}

for (const source of sources) {
  test(`${source.kind}: a rewrite that keeps or grows the file size is re-ingested without loss or duplicates`, async t => {
    const root = setup(t), database = path.join(root, 'hub.db');
    const file = f.write(path.join(root, source.name), [0, 1, 2, 3].map(source.line).join('\n') + '\n');
    const store = new Store(database);
    const item = () => ({ file, kind: source.kind, stat: fs.statSync(file) });
    const count = () => store.get(`SELECT COUNT(*) n FROM ${source.table}`).n;
    try {
      await ingest(store, item(), () => false); assert.equal(count(), 4);
      // Same lines with CRLF: larger file, no new facts, no parse errors.
      f.write(file, [0, 1, 2, 3].map(source.line).join('\r\n') + '\r\n');
      await ingest(store, item(), () => false); assert.equal(count(), 4);
      assert.equal(Number(store.meta('parse_errors') || 0), 0);
      // Prefix removed and more lines appended: file grows; every new line is kept.
      f.write(file, [2, 3, 4, 5, 6, 7, 8, 9].map(source.line).join('\n') + '\n');
      await ingest(store, item(), () => false); assert.equal(count(), 10);
      // One line prepended: it is ingested and nothing is counted twice.
      f.write(file, [20, 2, 3, 4, 5, 6, 7, 8, 9].map(source.line).join('\n') + '\n');
      await ingest(store, item(), () => false); assert.equal(count(), 11);
      await ingest(store, item(), () => false); assert.equal(count(), 11);
      assert.equal(Number(store.meta('parse_errors') || 0), 0);
    } finally { store.close(); }
  });
}

test('ledger occurrences roll back with facts and cursors after a failed batch', async t => {
  const root = setup(t), store = new Store(path.join(root, 'hub.db'));
  const file = f.write(path.join(root, 'review-ledger.log'), Array(600).fill(sources[1].line(1)).join('\n') + '\n');
  const item = { file, kind: 'ledger', stat: fs.statSync(file) };
  const original = store.insert.bind(store); let count = 0;
  try {
    store.insert = (...args) => { const result = original(...args); if (++count === 551) throw new Error('Injected'); return result; };
    await assert.rejects(ingest(store, item, () => false), /Injected/);
    assert.equal(store.get('SELECT COUNT(*) n FROM ledger').n, 500);
    assert.equal(store.get('SELECT occurrences FROM ingest_occurrences').occurrences, 500);
    store.insert = original; await ingest(store, item, () => false);
    assert.equal(store.get('SELECT COUNT(*) n FROM ledger').n, 600);
    assert.equal(store.get('SELECT occurrences FROM ingest_occurrences').occurrences, 600);
  } finally { store.close(); }
});

test('v2 automatically rebuilds state logs once, resumes migration and preserves other facts and the lease', async t => {
  const root = setup(t), database = path.join(root, 'hub.db');
  const items = sources.map(source => ({ ...source, file: f.write(path.join(root, source.name),
    [source.line(0), source.line(1), source.line(2), source.line(2)].join('\n') + '\n') }));
  const claude = f.jsonl(path.join(root, 'claude.jsonl'), [f.assistant('preserved')]);
  let store = new Store(database), release;
  const facts = table => store.all(`SELECT * FROM ${table}`).map(({ id, ...row }) => JSON.stringify(row)).sort();
  const expected = new Map();
  try {
    for (const item of items) {
      await ingest(store, { ...item, stat: fs.statSync(item.file) }, () => false);
      expected.set(item.table, facts(item.table));
      let offset = 0;
      for (const line of fs.readFileSync(item.file, 'utf8').trimEnd().split('\n')) {
        const oldId = hash(`${hash(item.file)}:${offset}:${hash(line)}`);
        store.run(`UPDATE ${item.table} SET id=? WHERE id=(SELECT id FROM ${item.table} WHERE length(id)=64 LIMIT 1)`, `old-${oldId}`);
        offset += Buffer.byteLength(line) + 1;
      }
      store.run(`UPDATE ${item.table} SET id=substr(id,5)`);
    }
    await ingest(store, { file: claude, kind: 'claude', stat: fs.statSync(claude) }, () => false);
    store.setMeta('schema_version', '2'); store.close(); store = null;
    release = acquire(database);
    assert.equal(typeof release, 'function');
    store = new Store(database);
    const token = store.get('SELECT token FROM lease').token;
    assert.equal(store.meta('schema_version'), String(SCHEMA_VERSION));
    assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 1);
    for (const item of items) {
      assert.equal(store.get(`SELECT COUNT(*) n FROM ${item.table}`).n, 0);
      assert.equal(store.state(hash(item.file)).offset, 0);
      let calls = 0; await ingest(store, { ...item, stat: fs.statSync(item.file) }, () => ++calls > 1);
    }
    store.close(); store = new Store(database);
    for (const item of items) {
      assert.equal(store.get(`SELECT COUNT(*) n FROM ${item.table}`).n, 1);
      await ingest(store, { ...item, stat: fs.statSync(item.file) }, () => false);
      assert.equal(store.get(`SELECT COUNT(*) n FROM ${item.table}`).n, 4);
      assert.deepEqual(facts(item.table), expected.get(item.table));
      f.write(item.file, [item.line(2), item.line(2)].join('\n') + '\n');
      await ingest(store, { ...item, stat: fs.statSync(item.file) }, () => false);
      assert.equal(store.get(`SELECT COUNT(*) n FROM ${item.table}`).n, 4);
    }
    assert.equal(store.get('SELECT token FROM lease').token, token);
  } finally { store?.close(); release?.(); }
});
