/* Intent: prove amendment r1 byte triage, bounded materialization and replay.
 * Status: synthetic regression contract. Next: supervisor real-source validation.
 * Blockers: none. Confidence: parse counters and exact byte-offset assertions. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
const { lines, ingest } = require('../collector/stream');
const { shouldSkip, HEAD_BYTES, MAX_LINE_BYTES } = require('../collector/triage');
const { hash } = require('../collector/values');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'triage-'));
  const store = new Store(path.join(root, 'hub.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
function record(bytes, id = 'sized') {
  const row = f.assistant(id, { input_tokens: 17 }, [
    { type: 'tool_use', id: `tool-${id}`, name: 'Write', input: { text: '' } }
  ]);
  const empty = JSON.stringify(row);
  row.message.content[0].input.text = 'x'.repeat(bytes - Buffer.byteLength(empty));
  return JSON.stringify(row);
}
test('head triage identifies only relevant object paths and preserves uncertain heads', () => {
  const check = (kind, value) => shouldSkip(Buffer.from(JSON.stringify(value)).subarray(0, HEAD_BYTES), kind);
  assert.equal(HEAD_BYTES, 1024); assert.equal(MAX_LINE_BYTES, 4 * 1024 * 1024);
  assert.equal(check('claude', { type: 'api-request-blob' }), true);
  assert.equal(check('claude', { attachment: { type: 'hook_success' }, type: 'attachment' }), false);
  assert.equal(check('claude', { type: 'assistant', message: { content: [{ type: 'text' }] } }), false);
  assert.equal(check('claude', { type: 'user', message: { content: [{ type: 'tool_result' }] } }), true);
  assert.equal(check('claude', { type: 'user', other: { content: [] }, message: { content: 'human' } }), false);
  assert.equal(check('claude', { type: 'system', subtype: 'compact_boundary' }), false);
  assert.equal(check('claude', { type: 'system', subtype: 'other' }), true);
  assert.equal(check('claude', { type: 'attachment', attachment: { type: 'other' } }), true);
  assert.equal(check('codex', { payload: { type: 'token_count' }, type: 'event_msg' }), false);
  assert.equal(check('codex', { payload: { type: 'item_completed' }, type: 'event_msg' }), true);
  assert.equal(check('claude', { note: '"type":"api-request"', type: 'assistant' }), false);
  assert.equal(check('claude', { padding: 'x'.repeat(1500), type: 'assistant' }), false);
  assert.equal(shouldSkip(Buffer.from('{"t\\u0079pe":"assistant"}'), 'claude'), false);
  assert.equal(shouldSkip(Buffer.from('\uFEFF { "type" : "api-request" }\r'), 'claude'), true);
});
test('every unneeded type skips before decoding and JSON.parse, even malformed tails', async t => {
  const { root, store } = setup(t);
  const groups = {
    claude: [
      '{"type":"api-request-blob","data":"', '{"type":"api-request","data":"',
      '{"type":"user","message":{"content":[',
      '{"type":"attachment","attachment":{"type":"other","content":"',
      '{"type":"system","subtype":"other","content":"', '{"type":"unknown","data":"'
    ],
    codex: [
      '{"type":"response_item","payload":{"type":"custom_tool_call_output","output":"',
      '{"type":"compacted","payload":{"text":"',
      '{"type":"event_msg","payload":{"type":"item_completed","text":"',
      '{"type":"token_usage_record","payload":{"text":"'
    ]
  };
  for (const [kind, prefixes] of Object.entries(groups)) {
    const file = f.write(path.join(root, `${kind}.jsonl`), prefixes.map(prefix => prefix + 'x'.repeat(1100000) + '\n').join(''));
    const diagnostics = {};
    await ingest(store, { file, kind, stat: fs.statSync(file) }, () => false, { diagnostics });
    assert.equal(diagnostics.json_parsed || 0, 0);
    assert.equal(diagnostics.decoded_lines || 0, 0);
    assert.equal(diagnostics.skipped_triage, prefixes.length);
    assert.ok((diagnostics.max_buffered_bytes || 0) <= HEAD_BYTES);
    assert.ok(diagnostics.max_head_bytes <= HEAD_BYTES);
    assert.equal(store.state(hash(file)).offset, fs.statSync(file).size);
  }
  assert.equal(store.meta('skipped_triage'), '10');
  assert.equal(store.meta('parse_errors'), undefined);
});
test('needed 2 MiB record spanning chunks parses once and preserves metrics', async t => {
  const { root, store } = setup(t);
  const file = f.write(path.join(root, 'needed.jsonl'), record(2 * 1024 * 1024) + '\n');
  const diagnostics = {};
  await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false, { diagnostics });
  assert.equal(diagnostics.json_parsed, 1);
  assert.equal(store.get('SELECT input FROM claude_messages').input, 17);
  assert.equal(store.get('SELECT COUNT(*) n FROM tool_calls').n, 1);
  assert.ok(diagnostics.max_buffered_bytes <= MAX_LINE_BYTES);
});
test('4 MiB cap is inclusive; larger needed lines skip without decoding or parsing', async t => {
  const { root, store } = setup(t);
  const file = f.write(path.join(root, 'cap.jsonl'), record(MAX_LINE_BYTES, 'allowed') + '\n' +
    record(MAX_LINE_BYTES + 1, 'large') + '\n' + record(512, 'after') + '\n');
  const diagnostics = {};
  await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false, { diagnostics });
  assert.equal(diagnostics.json_parsed, 2); assert.equal(diagnostics.decoded_lines, 2);
  assert.equal(diagnostics.skipped_large, 1); assert.equal(store.meta('skipped_large'), '1');
  assert.ok(diagnostics.max_buffered_bytes <= MAX_LINE_BYTES);
  assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 2);
  assert.equal(store.state(hash(file)).offset, fs.statSync(file).size);
  await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false, { diagnostics });
  assert.equal(store.meta('skipped_large'), '1');
});
test('skipped-line offsets survive a budget boundary and partial final skip', async t => {
  const { root, store } = setup(t);
  const skipped = JSON.stringify({ type: 'api-request-blob', text: 'x'.repeat(200000) });
  const needed = record(600, 'next');
  const file = f.write(path.join(root, 'resume.jsonl'), skipped + '\n' + needed + '\n' + skipped);
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  const diagnostics = {};
  // Stop after committing the first complete skipped record, not during its bytes.
  await ingest(store, item, () => (diagnostics.skipped_triage || 0) >= 1, { diagnostics });
  assert.equal(store.state(hash(file)).offset, Buffer.byteLength(skipped) + 1);
  assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 0);
  await ingest(store, item, () => false, { diagnostics });
  assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 1);
  assert.equal(store.meta('skipped_triage'), '1');
  fs.appendFileSync(file, '\n');
  await ingest(store, { ...item, stat: fs.statSync(file) }, () => false, { diagnostics });
  assert.equal(store.meta('skipped_triage'), '2');
  assert.equal(store.state(hash(file)).offset, fs.statSync(file).size);
});
test('one-byte head fragments preserve triage decisions and exact CRLF byte offsets', async t => {
  const { root } = setup(t);
  const text = '\uFEFF{"type":"api-request-blob","text":"long"}\r\n' + JSON.stringify(f.assistant('a')) + '\n';
  const file = f.write(path.join(root, 'tiny.jsonl'), text);
  const found = [], diagnostics = {};
  for await (const line of lines(file, 0, fs.statSync(file).size, { kind: 'claude', highWaterMark: 1, diagnostics })) found.push(line);
  assert.equal(found[0].skip, 'triage'); assert.equal(found[0].text, undefined);
  assert.equal(JSON.parse(found[1].text).message.id, 'a');
  assert.equal(found[1].offset, Buffer.byteLength(text));
});
test('a deadline inside a skipped line commits no partial bytes or skip counter', async t => {
  const { root, store } = setup(t);
  const file = f.write(path.join(root, 'budget.jsonl'), JSON.stringify({ type: 'api-request-blob', text: 'x'.repeat(2 * 1024 * 1024) }) + '\n' + record(512) + '\n');
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  let checks = 0;
  await ingest(store, item, () => ++checks > 5);
  assert.equal(store.state(hash(file)).offset, 0);
  assert.equal(store.meta('skipped_triage'), undefined);
  await ingest(store, item, () => false);
  assert.equal(store.meta('skipped_triage'), '1');
  assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 1);
});
test('skip counters roll back with facts and offsets on a failed batch', async t => {
  const { root, store } = setup(t);
  const file = f.write(path.join(root, 'rollback.jsonl'), '{"type":"api-request"}\n' + record(512) + '\n');
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  const original = store.message.bind(store);
  store.message = () => { throw new Error('Injected rollback'); };
  await assert.rejects(ingest(store, item, () => false), /Injected rollback/);
  assert.equal(store.meta('skipped_triage'), undefined);
  assert.equal(store.state(hash(file)), undefined);
  store.message = original;
  await ingest(store, item, () => false);
  assert.equal(store.meta('skipped_triage'), '1');
});
