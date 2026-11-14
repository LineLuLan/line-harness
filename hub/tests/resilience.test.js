/* Intent: prove r3 isolation, locking, replay, stdin and bounded projection.
 * Status: SQLite lease and replay regression contract. Next: independent supervisor review.
 * Blockers: none. Confidence: child races, injected I/O faults and DB assertions. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { collect, options, drainStdin } = require('../collector/collect');
const { PassThrough } = require('node:stream');
const { paths, linkRuns } = require('../collector/sources');
const { acquire } = require('../collector/lock');
const { ingest } = require('../collector/stream');
const { project } = require('../collector/project');
const { hash } = require('../collector/values');
const f = require('./fixtures/synthetic');
const entry = path.resolve(__dirname, '../collector/collect.js');
function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'resilience-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: f.environment(root) };
}
test('item failures are private and isolated; hook still links, aggregates and finishes', t => {
  const { root, env } = setup(t); f.populate(env);
  const files = [
    f.write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'huge', 'run.json'), 'x'.repeat(1024 * 1024 + 1)),
    f.write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'invalid', 'run.json'), '{bad'),
    f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'busy.jsonl'), [f.assistant('busy')]),
    f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'stat-fail.jsonl'), [f.assistant('stat')]),
    f.write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'empty', 'run.json'), '')
  ];
  const denied = path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'denied');
  fs.mkdirSync(denied, { recursive: true }); files.push(denied);
  const inject = f.write(path.join(root, 'inject.cjs'), `const fs=require('node:fs');
    for(const [method,needle,code] of [['openSync','busy.jsonl','EBUSY'],['lstatSync','stat-fail.jsonl','EACCES'],['readdirSync','denied','EPERM']]) {
      const original=fs[method]; fs[method]=function(file,...args) {
        if(String(file).endsWith(needle)) throw Object.assign(new Error('LINEHUB_PRIVATE_MARKER'),{code});
        return original.call(this,file,...args);
      };
    }`);
  const child = spawnSync(process.execPath, ['-r', inject, entry, '--hook', '--full'], { env, encoding: 'utf8', input: 'discard' });
  assert.equal(child.status, 0); assert.equal(child.stdout + child.stderr, '');
  const store = new Store(env.LINE_HUB_DB);
  try {
    assert.equal(store.meta('item_errors'), '6'); assert.ok(Number(store.meta('last_run_end')));
    assert.equal(store.get('SELECT COUNT(*) n FROM claude_messages').n, 1);
    assert.ok(store.get('SELECT 1 FROM daily_tokens'));
    assert.ok(store.get('SELECT 1 FROM runs WHERE claude_session_id IS NOT NULL'));
    assert.ok(Number(store.meta('last_vacuum')));
    for (const file of files) assert.equal(store.state(hash(file)), undefined);
  } finally { store.close(); }
  const errors = fs.readFileSync(path.join(path.dirname(env.LINE_HUB_DB), 'collect-errors.log'), 'utf8').trim().split('\n');
  assert.equal(errors.length, 6);
  for (const line of errors) assert.match(line, /^\S+ ITEM_FAILED (?:[A-Z_0-9]+|SyntaxError|Error) [a-f0-9]{12}$/);
  for (const file of files) assert.ok(errors.some(line => line.endsWith(hash(file).slice(0, 12))));
  assert.ok(!errors.join('').includes(f.MARKER));
});
test('linkRuns prepares and executes unchanged on a fresh database', t => {
  const { root } = setup(t), store = new Store(path.join(root, 'fresh.db'));
  try { assert.doesNotThrow(() => linkRuns(store)); } finally { store.close(); }
});
test('leases respect live PIDs, expire after thirty minutes and release only their token', t => {
  const { root, env } = setup(t), database = path.join(root, 'lease.db');
  const store = new Store(database);
  const contender = () => {
    const result = spawnSync(process.execPath, ['-e', `const {acquire}=require('./collector/lock');
      const release=acquire(process.argv[1]);process.stdout.write(String(Boolean(release)));if(release)release();`, database],
    { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    return result.stdout;
  };
  let release, successor;
  try {
    store.run('INSERT INTO lease VALUES (1,?,?,?)', process.pid, 'live', Date.now() - 5 * 60000);
    assert.equal(contender(), 'false');
    store.run('UPDATE lease SET started=?', Date.now() - 31 * 60000);
    assert.equal(contender(), 'true');
    const dead = spawnSync(process.execPath, ['-e', ''], { env });
    assert.equal(dead.status, 0);
    store.run('INSERT INTO lease VALUES (1,?,?,?)', dead.pid, 'dead', Date.now());
    assert.equal(contender(), 'true');
    release = acquire(database); assert.equal(typeof release, 'function');
    const old = store.get('SELECT token FROM lease').token;
    store.run('UPDATE lease SET started=?', Date.now() - 31 * 60000);
    successor = acquire(database); assert.equal(typeof successor, 'function');
    const current = store.get('SELECT token FROM lease').token;
    assert.notEqual(current, old);
    release(); release = null;
    assert.equal(store.get('SELECT token FROM lease').token, current);
    assert.equal(contender(), 'false');
    successor(); successor = null;
    assert.equal(contender(), 'true');
    assert.equal(store.get('SELECT COUNT(*) n FROM lease').n, 0);
  } finally { release?.(); successor?.(); store.close(); }
});

test('a busy SQLite writer makes acquisition return null after its bounded timeout', t => {
  const { root, env } = setup(t), database = path.join(root, 'busy.db');
  const store = new Store(database);
  try {
    store.begin();
    const result = spawnSync(process.execPath, ['-e', `const {acquire}=require('./collector/lock');
      const start=Date.now(); const release=acquire(process.argv[1]);
      process.stdout.write(JSON.stringify({owned:Boolean(release),elapsed:Date.now()-start}));if(release)release();`, database],
    { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || String(result.error)); assert.equal(result.stderr, '');
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.owned, false); assert.ok(answer.elapsed >= 900 && answer.elapsed < 3000, JSON.stringify(answer));
  } finally { store.close(); }
  const release = acquire(database); assert.equal(typeof release, 'function'); release();
});

test('eight fresh-database lease contenders admit exactly one owner', { timeout: 15000 }, async t => {
  const { root, env } = setup(t);
  const database = path.join(root, 'fresh.db');
  const code = `const {acquire}=require('./collector/lock'); let release; process.on('message', msg=>{
      if(msg==='start'){release=acquire(process.argv[1]);process.send(Boolean(release));}
      else {if(release)release();process.disconnect();}
    });process.send('ready');`;
  const children = Array.from({ length: 8 }, () => spawn(process.execPath, ['-e', code, database], {
    cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  }));
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
  const done = children.map(child => new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Child exit ${code}`)));
  }));
  await Promise.all(children.map(child => new Promise(resolve => child.once('message', resolve))));
  const answers = children.map(child => new Promise(resolve => child.once('message', resolve)));
  for (const child of children) child.send('start');
  const owners = await Promise.all(answers);
  for (const child of children) child.send('release');
  await Promise.all(done);
  assert.equal(owners.filter(Boolean).length, 1);
  assert.equal(fs.existsSync(path.join(root, 'collect.lock')), false);
  const release = acquire(database); assert.equal(typeof release, 'function'); release();
});
function anonymousRows() {
  const common = { sessionId: 'anonymous', timestamp: f.timestamp };
  return [
    { ...common, type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'Stop', command: 'node check.js', durationMs: 5 } },
    { ...common, type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 20 } },
    { ...common, type: 'user', message: { content: 'synthetic human' } }
  ];
}
test('prefix loss and identical anonymous records replay without extra rows across slices', async t => {
  const { root } = setup(t), file = path.join(root, 'replay.jsonl');
  const rows = anonymousRows();
  f.jsonl(file, [...Array.from({ length: 10 }, (_, i) => f.assistant(`prefix-${i}`)), ...rows, ...rows]);
  const store = new Store(path.join(root, 'replay.db'));
  const item = () => ({ file, kind: 'claude', stat: fs.statSync(file) });
  const counts = () => ['hook_events', 'compactions', 'human_turns'].map(table => store.get(`SELECT COUNT(*) n FROM ${table}`).n);
  try {
    let calls = 0; await ingest(store, item(), () => ++calls > 14);
    await ingest(store, item(), () => false); assert.deepEqual(counts(), [2, 2, 2]);
    f.jsonl(file, [...rows, ...rows]); await ingest(store, item(), () => false);
    assert.deepEqual(counts(), [2, 2, 2]);
    await ingest(store, item(), () => false); assert.deepEqual(counts(), [2, 2, 2]);
    fs.appendFileSync(file, JSON.stringify(rows[0]) + '\n'); await ingest(store, item(), () => false);
    assert.deepEqual(counts(), [3, 2, 2]);
    f.jsonl(file, rows); await ingest(store, item(), () => false); assert.deepEqual(counts(), [3, 2, 2]);
    assert.equal(store.get("SELECT turns FROM claude_sessions WHERE session_id='anonymous'").turns, 2);
  } finally { store.close(); }
});
test('v1 cursors replay and adopt existing offset-based IDs without duplicating facts', async t => {
  const { root } = setup(t), database = path.join(root, 'upgrade.db');
  const rows = anonymousRows(), file = f.jsonl(path.join(root, 'upgrade.jsonl'), rows);
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  let store = new Store(database);
  try {
    await ingest(store, item, () => false);
    let offset = 0;
    for (const [i, table] of ['hook_events', 'compactions', 'human_turns'].entries()) {
      const text = JSON.stringify(rows[i]);
      store.run(`UPDATE ${table} SET id=? WHERE session_id=?`, hash(`${hash(file)}:${offset}:${hash(text)}`), 'anonymous');
      offset += Buffer.byteLength(text) + 1;
    }
    store.setMeta('schema_version', '1'); store.close(); store = new Store(database);
    assert.equal(store.meta('schema_version'), String(SCHEMA_VERSION)); assert.equal(store.state(hash(file)).offset, 0);
    let checked = 0; await ingest(store, item, () => ++checked > 1);
    store.close(); store = new Store(database);
    await ingest(store, item, () => false);
    for (const table of ['hook_events', 'compactions', 'human_turns']) assert.equal(store.get(`SELECT COUNT(*) n FROM ${table}`).n, 1);
    assert.equal(store.get('SELECT turns FROM claude_sessions').turns, 1);
    assert.equal(store.get('SELECT COUNT(*) n FROM legacy_replay').n, 0);
  } finally { store.close(); }
});
test('occurrence counters roll back with a failed batch and resume from the committed prefix', async t => {
  const { root } = setup(t), store = new Store(path.join(root, 'counter.db'));
  const hook = anonymousRows()[0], file = f.jsonl(path.join(root, 'counter.jsonl'), Array(600).fill(hook));
  const item = { file, kind: 'claude', stat: fs.statSync(file) };
  const original = store.event.bind(store); let events = 0;
  try {
    store.event = (...args) => { original(...args); if (++events === 551) throw new Error('Injected batch failure'); };
    await assert.rejects(ingest(store, item, () => false), /Injected/);
    assert.equal(store.get('SELECT COUNT(*) n FROM hook_events').n, 500);
    assert.equal(store.get('SELECT occurrences FROM ingest_occurrences').occurrences, 500);
    store.event = original; await ingest(store, item, () => false);
    assert.equal(store.get('SELECT COUNT(*) n FROM hook_events').n, 600);
    assert.equal(store.get('SELECT occurrences FROM ingest_occurrences').occurrences, 600);
  } finally { store.close(); }
});
test('failed ingestion rolls back its batch and later source items still commit', async t => {
  const { env } = setup(t);
  f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'a.jsonl'), [f.assistant('bad')]);
  f.jsonl(path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'p', 'b.jsonl'), [f.assistant('good')]);
  const original = Store.prototype.message;
  t.mock.method(Store.prototype, 'message', function (row) {
    original.call(this, row);
    if (row.message_id === 'bad') throw Object.assign(new Error('Injected write'), { code: 'EIO' });
  });
  await collect(paths(env), options(['--full']));
  const store = new Store(env.LINE_HUB_DB);
  try {
    assert.deepEqual(store.all('SELECT message_id FROM claude_messages').map(row => row.message_id), ['good']);
    assert.equal(store.meta('item_errors'), '1'); assert.ok(store.meta('last_run_end'));
  } finally { store.close(); }
});
test('hook drains a slowly piped 1 MiB payload without EPIPE or stdout', { timeout: 10000 }, async t => {
  const { env } = setup(t);
  const child = spawn(process.execPath, [entry, '--hook', '--full'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; const pipeErrors = [];
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', error => pipeErrors.push(error.code));
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  for (let i = 0; i < 16; i++) {
    child.stdin.write(Buffer.alloc(65536, 120));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.stdin.end(); assert.equal(await done, 0);
  assert.deepEqual(pipeErrors, []); assert.equal(stdout + stderr, '');
});
test('stdin drain caps an open stream at two seconds without destroying it', async t => {
  const input = new PassThrough();
  t.mock.method(input, 'destroy', () => assert.fail('stdin must not be destroyed'));
  const started = performance.now(); await drainStdin(input);
  assert.ok(performance.now() - started >= 1900);
  assert.ok(performance.now() - started < 4000);
  assert.equal(input.destroyed, false); assert.equal(input.isPaused(), true);
});
test('projection falls back for 5000 nested arrays and ingests metrics', async t => {
  const { root } = setup(t), store = new Store(path.join(root, 'deep.db'));
  const text = '{"type":"assistant","sessionId":"deep","ignored":' + '['.repeat(5000) + '0' + ']'.repeat(5000) +
    ',"padding":"' + 'x'.repeat(70000) + '","message":{"id":"deep-msg","model":"test","usage":{"input_tokens":9}}}';
  try {
    assert.equal(JSON.parse(project(Buffer.from(text), 'claude')).message.usage.input_tokens, 9);
    const file = f.write(path.join(root, 'deep.jsonl'), text + '\n');
    await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
    assert.equal(store.get('SELECT input FROM claude_messages').input, 9); assert.equal(store.meta('parse_errors'), undefined);
  } finally { store.close(); }
});
test('budget minimum is 1000 ms and startup time does not consume work time', async t => {
  const { env } = setup(t); f.populate(env);
  assert.equal(options(['--budget-ms', '1']).budget, 1000);
  let clock = 0; const original = Store.prototype.setMeta;
  t.mock.method(performance, 'now', () => clock);
  t.mock.method(Store.prototype, 'setMeta', function (key, value) {
    if (key === 'schema_version') clock += 5000;
    return original.call(this, key, value);
  });
  const result = await collect(paths(env), options(['--budget-ms', '1']));
  assert.ok(result.lines > 0); assert.equal(result.budget_exhausted, false); assert.equal(result.elapsed_ms, 0);
});
