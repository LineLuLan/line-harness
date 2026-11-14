/* Intent: prove large-record projection preserves metrics and JSON validation.
 * Status: amendment r1 field allowlists checked against all synthetic source shapes.
 * Next: supervisor review. Blockers: none. Confidence: output parity and bad JSON cases. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { project } = require('../collector/project');
const { lines, ingest } = require('../collector/stream');
const { Store } = require('../collector/db');
const { discover, paths } = require('../collector/sources');
const { hash } = require('../collector/values');
const f = require('./fixtures/synthetic');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'projection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('large-field projections produce the same stored metrics as every small fixture', async t => {
  const root = setup(t), env = f.environment(root); f.populate(env);
  const original = new Store(path.join(root, 'original.db'));
  const projected = new Store(path.join(root, 'projected.db'));
  try {
    for (const item of discover(paths(env)).filter(i => ['claude', 'codex', 'review'].includes(i.kind))) {
      await ingest(original, item, () => false);
      const projectedFile = path.join(root, `${item.kind}.jsonl`);
      const fd = fs.openSync(projectedFile, 'w');
      try {
        for await (const line of lines(item.file, 0, item.stat.size)) {
          const value = JSON.parse(line.text);
          // The large ignored field forces the production projection code path.
          value.ignoredPadding = 'x'.repeat(70000);
          fs.writeSync(fd, JSON.stringify(value) + '\n');
        }
      } finally { fs.closeSync(fd); }
      await ingest(projected, { ...item, file: projectedFile, stat: fs.statSync(projectedFile) }, () => false);
    }
    const tables = ['claude_sessions', 'claude_messages', 'tool_calls', 'hook_events', 'compactions', 'codex_sessions', 'quota_snapshots', 'reviews'];
    for (const table of tables) {
      // Source-position identities intentionally differ; metric columns must not.
      const normalize = rows => rows.map(row => {
        const copy = { ...row }; delete copy.id; return copy;
      }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert.deepEqual(normalize(projected.all(`SELECT * FROM ${table}`)), normalize(original.all(`SELECT * FROM ${table}`)), table);
    }
    assert.equal(projected.meta('parse_errors'), undefined);
  } finally { original.close(); projected.close(); }
});
test('projection strips private strings, handles escapes, and keeps prompt type', () => {
  const input = Buffer.from('{"t\\u0079pe":"user","sessionId":"s","message":{"content":"private\\n\\u1234\\\"text"},"ignored":{"a":[1,-2,3.5e+2,null,true,false,{}]}}');
  assert.deepEqual(JSON.parse(project(input, 'claude')), { type: 'user', sessionId: 's', message: { content: '' } });
  const assistant = f.assistant('m', { input_tokens: 2 }, [
    { type: 'thinking', thinking: f.MARKER }, { type: 'text', text: f.MARKER },
    { type: 'tool_use', id: 't', name: 'Skill', input: { skill: 'test-skill', other: f.MARKER } }
  ]);
  assistant.cwd = '/synthetic/project';
  const text = project(Buffer.from(JSON.stringify(assistant)), 'claude');
  assert.equal(text.includes(f.MARKER), false);
  const parsed = JSON.parse(text);
  assert.equal(parsed.message.content[0].thinking, undefined);
  assert.equal(parsed.message.content[1].text, undefined);
  assert.deepEqual(parsed.message.content[2].input, { skill: 'test-skill' });
  const duplicate = '{"type":"assistant","message":{"id":"first","id":"last"}}';
  assert.equal(JSON.parse(project(Buffer.from(duplicate), 'claude')).message.id, 'last');
});
test('ignored JSON values validate without losing following metric fields', () => {
  const values = [null, true, false, 0, -1, 1.25, 1e-100, 1e100, '', '\\"\n\t', '日本語 🧪',
    [1, null, { nested: ['x', false] }], { object: { nested: [1, 2, 3] } },
    { ['x'.repeat(70000)]: 'huge ignored key' }];
  for (const value of values) {
    const text = JSON.stringify({ ignored: value, type: 'assistant', message: { id: 'after-ignored', model: 'test' } });
    assert.deepEqual(JSON.parse(project(Buffer.from(text), 'claude')),
      { type: 'assistant', message: { id: 'after-ignored', model: 'test' } });
  }
});
test('malformed ignored content still rejects the entire needed record', () => {
  const bad = ['{"ignored":"bad\\q"}', '{"ignored":"bad\\uXX00"}', '{"ignored":01}', '{"ignored":1.}',
    '{"ignored":1e+}', '{"ignored":tru}', '{"ignored":[1,]}', '{"ignored":{"a":1,}}',
    '{"ignored":"control\u0001"}', '{"ignored":null} trailing', '{"ignored":"unterminated}', '{"ignored":-}'];
  for (const text of bad) {
    assert.throws(() => JSON.parse(text));
    assert.throws(() => project(Buffer.from(text), 'claude'), SyntaxError, text);
  }
});
test('large human prompts normalize BOM/CRLF for occurrence identities and keep no prompt text', async t => {
  const root = setup(t);
  const store = new Store(path.join(root, 'human.db'));
  try {
    const row = JSON.stringify({ type: 'user', sessionId: 'human', timestamp: f.timestamp,
      message: { content: f.MARKER.repeat(10000) } });
    const file = f.write(path.join(root, 'human.jsonl'), '\uFEFF' + row + '\r\n');
    const expected = hash(`${hash(file)}:${f.timestamp}:${hash(row)}:1`);
    await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
    assert.equal(store.get('SELECT id FROM human_turns').id, expected);
    assert.equal(store.get('SELECT turns FROM claude_sessions').turns, 1);
    store.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.equal(fs.readFileSync(path.join(root, 'human.db')).includes(Buffer.from(f.MARKER)), false);
  } finally { store.close(); }
});

/* Intent: retain review mode on the >=64 KiB ingestion path. Status: regression.
 * Next: none. Blockers: none. Confidence: actual ingest, both gates-only shapes. */
test('large review ingestion preserves mode and excludes gates-only records', async t => {
  const root = setup(t), store = new Store(':memory:');
  try {
    const file = f.jsonl(path.join(root, 'reviews.jsonl'), [
      { model: 'gpt-6-astra', effort: 'high', mode: 'gates-only' },
      { model: null, effort: null, mode: 'gates-only' },
      { model: 'gpt-6-astra', effort: 'high', mode: 'model' }
    ].map(row => ({ ...row, utc: f.timestamp, verdict: 'PASS', ignoredPadding: 'x'.repeat(70000) })));
    let projections = 0;
    await ingest(store, { file, kind: 'review', stat: fs.statSync(file) }, () => false,
      { sample: stage => { if (stage === 'line_projected') projections++; } });
    assert.equal(projections, 3);
    assert.deepEqual(store.all('SELECT mode FROM reviews ORDER BY rowid').map(x => x.mode), ['gates-only', 'gates-only', 'model']);
    const q = require('../server/queries'), d = q.gates(store.db, q.range(14));
    assert.equal(d.gatesOnlyRuns, 2); assert.equal(d.reviewers.length, 1);
    assert.equal(d.reviewers[0].reviews, 1); assert.equal(d.reviewers[0].mode, 'model');
  } finally { store.close(); }
});
