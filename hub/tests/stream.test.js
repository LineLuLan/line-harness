/* Intent: directly prove byte boundaries, ordering, rollback and scalar extraction.
 * Status: byte/cursor regressions and obsolete lock-file compatibility. Next: extend only for observed failures.
 * Blockers: none. Confidence: deterministic fixtures and injected budget clock. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
const { lines, ingest } = require('../collector/stream');
const { paths, discover } = require('../collector/sources');
const { aggregate } = require('../collector/aggregate');
const { acquire } = require('../collector/lock');
const v = require('../collector/values');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: f.environment(root) };
}
test('UTF-8 split across read chunks and a long complete line have exact offsets', async t => {
  const { root } = setup(t);
  const text = 'x'.repeat(16383) + '日本語' + 'y'.repeat(60000);
  const file = f.write(path.join(root, 'large.jsonl'), text + '\npartial');
  const result = [];
  for await (const line of lines(file, 0, fs.statSync(file).size)) result.push(line);
  assert.equal(result.length, 1); assert.equal(result[0].text, text);
  assert.equal(result[0].offset, Buffer.byteLength(text) + 1);
});
test('invalid UTF-8 replacement does not advance the cursor by extra bytes', async t => {
  const { root } = setup(t);
  const file = f.write(path.join(root, 'invalid.jsonl'), Buffer.from([0xFF, 10, 65, 10]));
  const found = [];
  for await (const line of lines(file, 0, 4)) found.push(line);
  assert.deepEqual(found.map(line => line.offset), [2, 4]);
  assert.equal(found[1].text, 'A');
});
test('deterministic budget slices resume Codex context and commit only complete lines', async t => {
  const { root, env } = setup(t);
  const files = f.populate(env);
  const store = new Store(path.join(root, 'unit.db'));
  try {
    const item = { file: files.codex, kind: 'codex', stat: fs.statSync(files.codex) };
    let calls = 0;
    assert.equal(await ingest(store, item, () => ++calls > 2), 2);
    assert.equal(store.get('SELECT COUNT(*) n FROM codex_sessions').n, 1);
    assert.equal(store.state(v.hash(files.codex)).session_id, 'codex-1');
    assert.equal(await ingest(store, item, () => false), 4);
    assert.equal(store.get('SELECT input FROM codex_sessions').input, 200);
    aggregate(store, () => false);
    assert.equal(store.get('SELECT input FROM daily_tokens').input, 200);
  } finally { store.close(); }
});
test('a failed transaction rolls back both facts and offset', async t => {
  const { root, env } = setup(t);
  const file = f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl'), [f.assistant('a'), f.assistant('b')]);
  const store = new Store(path.join(root, 'rollback.db'));
  try {
    const original = store.message.bind(store);
    store.message = record => { original(record); if (record.message_id === 'b') throw new Error('Injected failure'); };
    await assert.rejects(ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false), /Injected/);
    assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 0);
    assert.equal(store.state(v.hash(file)), undefined);
    store.message = original;
    await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
    assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 2);
  } finally { store.close(); }
});
test('discover nested subagents newest first and skip non-rollout Codex files', t => {
  const { env } = setup(t);
  const older = f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 's.jsonl'), []);
  const newer = f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 's', 'subagents', 'a.jsonl'), []);
  f.jsonl(path.join(env.LINE_HUB_CODEX_DIR, 'sessions', 'unrelated.jsonl'), []);
  fs.utimesSync(older, 1000, 1000); fs.utimesSync(newer, 2000, 2000);
  const found = discover(paths(env));
  assert.deepEqual(found.map(i => i.file), [newer, older]);
  const defaults = paths({});
  assert.equal(defaults.state, path.join(defaults.claude, 'state'));
  assert.equal(path.basename(defaults.db), 'hub.db');
});
test('script basename extraction, local day and iterations override top-level usage', () => {
  assert.equal(v.script('powershell -File "C:\\private folder\\some hook.ps1"'), 'some hook.ps1');
  assert.equal(v.script("sh '/private/path/start.sh' && node /else/end.cjs"), 'end.cjs');
  assert.equal(v.script('echo text'), 'inline');
  assert.equal(v.basename('/parent/project/'), 'project');
  assert.equal(v.day(Math.floor(new Date(2026, 0, 2, 0, 30).getTime() / 1000)), '2026-01-02');
  assert.equal(v.tokens({ input_tokens: 99, iterations: [{ input_tokens: 1 }, { input_tokens: 2 }] }).input, 3);
  assert.equal(v.tokens({ input_tokens: 99, iterations: [] }).input, 99);
});
test('leftover lock files are ignored by the database lease', t => {
  const { root } = setup(t);
  const file = f.write(path.join(root, 'collect.lock'), '');
  const database = path.join(root, 'hub.db');
  const release = acquire(database); assert.equal(typeof release, 'function');
  try { assert.equal(acquire(database), null); } finally { release(); }
  assert.equal(fs.readFileSync(file, 'utf8'), '');
});
