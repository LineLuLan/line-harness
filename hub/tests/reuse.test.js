/* Intent: prove r2 buffer reuse, bounded synchronous reads and thinking tokens.
 * Status: synthetic regression contract. Next: supervisor real-log validation.
 * Blockers: none. Confidence: observed I/O buffers, faults and persisted metrics. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lines, ingest } = require('../collector/stream');
const { Store } = require('../collector/db');
const { aggregate } = require('../collector/aggregate');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'reuse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('one read buffer and geometrically growing workspace survive file boundaries', async t => {
  const root = setup(t);
  const sizes = [2048, 90000, 200000, 2048];
  const files = sizes.map((size, i) => f.write(path.join(root, `${i}.jsonl`),
    JSON.stringify({ type: 'user', message: { content: 'x'.repeat(size) } }) + '\n'));
  files.push(f.write(path.join(root, 'skip.jsonl'), '{"type":"api-request-blob","text":"' + 'x'.repeat(2 * 1024 * 1024) + '"}\n'));
  const buffers = new Set(), allocations = [], capacities = [], backings = new Set();
  const originalRead = fs.readSync, originalAlloc = Buffer.allocUnsafe, originalTransfer = ArrayBuffer.prototype.transfer;
  t.mock.method(fs, 'createReadStream', () => { throw new Error('Read streams are forbidden'); });
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    buffers.add(buffer); assert.equal(buffer.length, 65536); assert.ok(length <= 65536);
    return originalRead(fd, buffer, offset, length, position);
  });
  t.mock.method(Buffer, 'allocUnsafe', size => { allocations.push(size); return originalAlloc(size); });
  t.mock.method(ArrayBuffer.prototype, 'transfer', function (capacity) {
    backings.add(this); capacities.push(capacity); return originalTransfer.call(this, capacity);
  });
  const diagnostics = {};
  for (const [i, file] of files.entries()) {
    const found = [];
    for await (const line of lines(file, 0, fs.statSync(file).size, { kind: 'claude', diagnostics })) found.push(line);
    assert.equal(found.length, 1);
    if (i < sizes.length) assert.equal(JSON.parse(found[0].text).message.content.length, sizes[i]);
    else assert.equal(found[0].skip, 'triage');
  }
  assert.equal(buffers.size, 1);
  assert.deepEqual(allocations, []);
  assert.deepEqual(capacities, [131072, 262144]);
  assert.equal(backings.size, 2);
  assert.ok([...backings].every(backing => backing.byteLength === 0));
  assert.equal(diagnostics.workspace_capacity, 262144);
});
test('synchronous reader checks the deadline each read and closes on stop or exception', async t => {
  const root = setup(t);
  const file = f.write(path.join(root, 'skip.jsonl'), '{"type":"api-request-blob","text":"' + 'x'.repeat(400000) + '"}\n');
  const originalRead = fs.readSync, originalClose = fs.closeSync;
  let reads = 0, closes = 0, checks = 0, fail = false;
  t.mock.method(fs, 'readSync', (...args) => {
    reads++;
    if (fail) throw new Error('Injected read failure');
    return originalRead(...args);
  });
  t.mock.method(fs, 'closeSync', fd => { closes++; return originalClose(fd); });
  const result = [];
  for await (const line of lines(file, 0, fs.statSync(file).size, {
    kind: 'claude', expired: () => ++checks >= 2
  })) result.push(line);
  assert.equal(result.length, 0); assert.ok(reads <= 2); assert.equal(checks, 2); assert.equal(closes, 1);
  fail = true;
  await assert.rejects(async () => {
    for await (const line of lines(file, 0, fs.statSync(file).size)) void line;
  }, /Injected read failure/);
  assert.equal(closes, 2);
  fail = false;
  const small = f.write(path.join(root, 'small.jsonl'), '{"type":"user","message":{"content":"hello"}}\n');
  const before = closes;
  for await (const line of lines(small, 0, fs.statSync(small).size)) { assert.ok(line.text); break; }
  assert.equal(closes, before + 1);
});
test('Claude thinking uses iteration details when present, otherwise top-level details', async t => {
  const root = setup(t), store = new Store(path.join(root, 'hub.db'));
  try {
    const cases = [
      ['top', { output_tokens_details: { thinking_tokens: 31 } }, 31],
      ['iterations', { output_tokens_details: { thinking_tokens: 99 }, iterations: [
        { output_tokens_details: { thinking_tokens: 7 } }, { output_tokens_details: { thinking_tokens: 11 } }
      ] }, 18],
      ['top-with-iterations', { output_tokens_details: { thinking_tokens: 23 }, iterations: [
        { output_tokens: 50 }, { output_tokens: 60 }
      ] }, 23],
      ['zero-iterations', { output_tokens_details: { thinking_tokens: 99 }, iterations: [
        { output_tokens_details: { thinking_tokens: 0 } }
      ] }, 0],
      ['partial-iterations', { output_tokens_details: { thinking_tokens: 99 }, iterations: [
        { output_tokens_details: { thinking_tokens: 4 } }, { output_tokens: 10 }
      ] }, 4]
    ];
    const file = f.jsonl(path.join(root, 'thinking.jsonl'), cases.flatMap(([id, usage]) => [
      f.assistant(id, usage),
      // Exercise the projected large-record path as well as ordinary JSON parsing.
      f.assistant(`${id}-projected`, usage, [{ type: 'text', text: 'x'.repeat(70000) }])
    ]));
    const item = () => ({ file, kind: 'claude', stat: fs.statSync(file) });
    await ingest(store, item(), () => false);
    for (const [id, , expected] of cases) {
      for (const suffix of ['', '-projected']) {
        assert.equal(store.get('SELECT reasoning FROM claude_messages WHERE message_id=?', id + suffix).reasoning, expected);
      }
    }
    fs.appendFileSync(file, JSON.stringify(f.assistant('top', { output_tokens_details: { thinking_tokens: 41 } })) + '\n');
    await ingest(store, item(), () => false);
    aggregate(store, () => false);
    assert.equal(store.get('SELECT SUM(reasoning) n FROM daily_tokens').n, 162);
  } finally { store.close(); }
});
