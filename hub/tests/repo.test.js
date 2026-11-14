/* Intent: prove v5 repo naming (git root / remote URL) and branch capture, plus the v4 -> v5 replay.
 * Status: synthetic contract. Next: none. Blockers: none.
 * Confidence: temp git trees, Claude + Codex fixtures, migration on a real collector DB. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, SCHEMA_VERSION } = require('../collector/db');
const { ingest } = require('../collector/stream');
const { repoOf, repoFromUrl } = require('../collector/repo');
const f = require('./fixtures/synthetic');

function setup(t) {
  const base = path.resolve(__dirname, '..', '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'repo-'));
  // A fake repository OUTSIDE any real repo would be ideal, but .tmp sits inside the hub's own
  // checkout; the nearest .git still wins, which is exactly the rule under test.
  const repo = path.join(root, 'demo-repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'datasets', 'raw'), { recursive: true });
  const worktree = path.join(root, 'demo-worktree');
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere\n');
  return { root, repo, worktree, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const names = (store, kind) => store.all('SELECT name FROM names WHERE kind=? ORDER BY name', kind).map(r => r.name);
const nameOf = (store, id) => store.get('SELECT name FROM names WHERE id=?', id)?.name ?? null;

test('repoOf walks up to the nearest .git folder or file; repoFromUrl keeps only the repo name', t => {
  const s = setup(t); t.after(s.cleanup);
  assert.equal(repoOf(path.join(s.repo, 'datasets', 'raw')), 'demo-repo');
  assert.equal(repoOf(s.repo), 'demo-repo');
  assert.equal(repoOf(path.join(s.worktree, 'src')), 'demo-worktree');
  assert.equal(repoOf('Z:\\nowhere-at-all\\leaf'), 'leaf'); // missing path: plain basename
  assert.equal(repoOf(null), null);
  assert.equal(repoFromUrl('https://github.com/someone/line-harness.git'), 'line-harness');
  assert.equal(repoFromUrl('git@github.com:someone/line-harness.git'), 'line-harness');
  assert.equal(repoFromUrl('https://example.com/a/b/tools/'), 'tools');
  assert.equal(repoFromUrl(''), null); assert.equal(repoFromUrl(undefined), null);
  // Malformed remotes never yield credentials, query strings or an owner.
  assert.equal(repoFromUrl('ssh://git@host.example:22/owner/repo-z'), 'repo-z');
  assert.equal(repoFromUrl('https://user:tok3n@github.com'), null);
  assert.equal(repoFromUrl('https://github.com/owner/repo.git?token=SECRET#x'), 'repo');
  assert.equal(repoFromUrl('https://github.com/owner'), null);
  // Network and relative paths are not walked (no SMB stalls, no hook-cwd misattribution).
  assert.equal(repoOf('\\\\unreachable-host\\share\\proj'), 'proj');
  assert.equal(repoOf('//unreachable-host/share/proj'), 'proj');
  assert.equal(repoOf('sub/leaf'), 'leaf');
});

test('v6 replay: counters are not doubled, review projects refresh, newest branch wins, old Codex files never lower totals', async t => {
  const s = setup(t); t.after(() => s.cleanup());
  const database = path.join(s.root, 'hub.db');
  const at = sec => new Date(Date.UTC(2026, 10, 1, 10, 0, sec)).toISOString();
  const cwd = path.join(s.repo, 'datasets');
  const claude = f.jsonl(path.join(s.root, 'claude.jsonl'), [
    { ...f.assistant('m1', { output_tokens: 1 }), timestamp: at(1), cwd, gitBranch: 'feature-a' },
    { ...f.assistant('m2', { output_tokens: 1 }), timestamp: at(2), cwd, gitBranch: 'feature-b' },
    { type: 'attachment', sessionId: 'claude-1', timestamp: at(3), cwd, attachment: { type: 'hook_success', hookEvent: 'Stop', command: 'x.ps1', durationMs: 5 } }
  ]);
  fs.appendFileSync(claude, '{not json\n');
  const review = f.write(path.join(s.root, 'reviews.jsonl'), JSON.stringify({ utc: f.timestamp, dir: cwd, model: 'm', verdict: 'PASS' }) + '\n');
  const token = (sec, total) => ({ timestamp: at(sec), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total } } } });
  const meta = { timestamp: at(0), type: 'session_meta', payload: { id: 'cx-9', timestamp: at(0), cwd, thread_source: 'user' } };
  const older = f.jsonl(path.join(s.root, 'rollout-old.jsonl'), [meta, token(10, 200)]);
  const newer = f.jsonl(path.join(s.root, 'rollout-new.jsonl'), [meta, token(20, 1000)]);
  const all = [[claude, 'claude'], [review, 'review'], [older, 'codex'], [newer, 'codex']];
  let store = new Store(database);
  const run = async order => { for (const [file, kind] of order) await ingest(store, { file, kind, stat: fs.statSync(file) }, () => false); };
  try {
    await run(all);
    const counters = () => ({ parse: Number(store.meta('parse_errors') || 0) });
    const before = counters();
    assert.equal(store.get("SELECT total_tokens t FROM codex_sessions WHERE session_id='cx-9'").t, 1000);
    // Pretend v5 wrote this DB with an old basename project on the review.
    store.run('UPDATE reviews SET project=?', store.intern('project', 'datasets'));
    store.setMeta('schema_version', '5');
    store.close(); store = new Store(database);
    // Replay newest-first (the collector's order): the older rollout comes last.
    await run([[claude, 'claude'], [review, 'review'], [newer, 'codex'], [older, 'codex']]);
    assert.deepEqual(counters(), before, 'parse_errors counted once');
    assert.equal(nameOf(store, store.get('SELECT project FROM reviews').project), 'demo-repo');
    assert.equal(nameOf(store, store.get('SELECT branch FROM claude_sessions').branch), 'feature-b');
    assert.equal(store.get("SELECT total_tokens t FROM codex_sessions WHERE session_id='cx-9'").t, 1000);
  } finally { store.close(); }
});

test('Claude sessions get the git repo of their cwd and the latest gitBranch', async t => {
  const s = setup(t);
  const store = new Store(path.join(s.root, 'hub.db')); t.after(() => { store.close(); s.cleanup(); }); // close before delete (Windows)
  const at = sec => new Date(Date.UTC(2026, 10, 1, 10, 0, sec)).toISOString();
  const line = (id, sec, branch) => ({ ...f.assistant(id, { input_tokens: 1, output_tokens: 1 }), timestamp: at(sec), cwd: path.join(s.repo, 'datasets'), gitBranch: branch });
  // Out of order on purpose: the branch of the newest line must win.
  const file = f.jsonl(path.join(s.root, 'claude.jsonl'), [line('m1', 1, 'feature-a'), line('m3', 30, 'main'), line('m2', 10, 'feature-b')]);
  await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
  const row = store.get('SELECT project, branch FROM claude_sessions');
  assert.equal(nameOf(store, row.project), 'demo-repo');
  assert.equal(nameOf(store, row.branch), 'main');
  assert.ok(!names(store, 'project').includes('datasets'), 'subfolder is not a project');
});

test('Codex sessions use the remote URL name and branch; the owner and turn_context cwd do not override', async t => {
  const s = setup(t);
  const store = new Store(path.join(s.root, 'hub.db')); t.after(() => { store.close(); s.cleanup(); }); // close before delete (Windows)
  const file = f.jsonl(path.join(s.root, 'rollout-x.jsonl'), [
    { timestamp: f.timestamp, type: 'session_meta', payload: { id: 'cx-1', timestamp: f.timestamp, cwd: path.join(s.repo, 'datasets'),
      thread_source: 'user', git: { branch: 'dev', commit_hash: 'a'.repeat(40), repository_url: `https://github.com/${f.MARKER}/remote-name.git` } } },
    { timestamp: f.timestamp, type: 'turn_context', payload: { model: 'gpt-test', cwd: path.join(s.worktree, 'src') } }
  ]);
  await ingest(store, { file, kind: 'codex', stat: fs.statSync(file) }, () => false);
  const row = store.get('SELECT project, branch FROM codex_sessions');
  assert.equal(nameOf(store, row.project), 'remote-name');
  assert.equal(nameOf(store, row.branch), 'dev');
  assert.ok(!store.all('SELECT name FROM names').some(r => r.name.includes(f.MARKER)), 'remote owner is never stored');
  // Without a remote URL the git root of cwd is used.
  const file2 = f.jsonl(path.join(s.root, 'rollout-y.jsonl'), [
    { timestamp: f.timestamp, type: 'session_meta', payload: { id: 'cx-2', timestamp: f.timestamp, cwd: path.join(s.repo, 'datasets', 'raw'), thread_source: 'user' } }]);
  await ingest(store, { file: file2, kind: 'codex', stat: fs.statSync(file2) }, () => false);
  assert.equal(nameOf(store, store.get("SELECT project FROM codex_sessions WHERE session_id='cx-2'").project), 'demo-repo');
});

test('v4 -> v5 replays every source once: projects are refreshed, counts are unchanged', async t => {
  const s = setup(t); t.after(() => s.cleanup()); // runs after the finally block closed the store
  const database = path.join(s.root, 'hub.db');
  const at = sec => new Date(Date.UTC(2026, 10, 1, 10, 0, sec)).toISOString();
  const file = f.jsonl(path.join(s.root, 'claude.jsonl'), [1, 2, 3].map(i => ({ ...f.assistant(`m${i}`, { input_tokens: i, output_tokens: i }),
    timestamp: at(i), cwd: path.join(s.repo, 'datasets'), gitBranch: 'main' })));
  let store = new Store(database);
  try {
    await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
    const before = store.get('SELECT COUNT(*) n, SUM(output) o FROM claude_messages');
    // Pretend this DB was written by v4: old basename project, no branch, version 4.
    store.run('UPDATE claude_sessions SET project=?, branch=NULL', store.intern('project', 'datasets'));
    store.setMeta('schema_version', '4');
    store.close(); store = new Store(database);
    assert.equal(store.meta('schema_version'), String(SCHEMA_VERSION));
    const cursor = store.get('SELECT offset, size FROM ingest_state');
    assert.equal(cursor.offset, 0); assert.equal(cursor.size, -1);
    await ingest(store, { file, kind: 'claude', stat: fs.statSync(file) }, () => false);
    const row = store.get('SELECT project, branch FROM claude_sessions');
    assert.equal(nameOf(store, row.project), 'demo-repo');
    assert.equal(nameOf(store, row.branch), 'main');
    assert.deepEqual(store.get('SELECT COUNT(*) n, SUM(output) o FROM claude_messages'), before);
    // A second open of a v5 DB does not replay again.
    store.close(); store = new Store(database);
    assert.notEqual(store.get('SELECT offset FROM ingest_state').offset, 0);
  } finally { store.close(); }
});
