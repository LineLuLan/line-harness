/* Intent: discover fixture-configurable inputs and ingest small state snapshots.
 * Status: local filesystem only. Next: keep snapshot projections explicit.
 * Blockers: none. Confidence: synthetic state and missing-directory coverage. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const v = require('./values');
const { quota } = require('./parsers');
const { repoOf } = require('./repo');
function paths(env = process.env) {
  const claude = env.LINE_HUB_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  return { db: env.LINE_HUB_DB || path.join(os.homedir(), '.line-hub', 'hub.db'), claude,
    codex: env.LINE_HUB_CODEX_DIR || path.join(os.homedir(), '.codex'),
    state: env.LINE_HUB_STATE_DIR || path.join(claude, 'state'),
    status: env.LINE_HUB_STATUS_DIR || path.join(os.tmpdir(), 'ultrathink-status') };
}
function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function discover(config, failed = (_file, error) => { throw error; }) {
  const items = [];
  function attempt(file, action) {
    try { return action(); } catch (error) { failed(file, error); }
  }
  function add(file, kind) {
    attempt(file, () => {
      const info = stat(file);
      if (info?.isFile()) items.push({ file, kind, stat: info });
    });
  }
  function walk(dir, kind) {
    for (const entry of attempt(dir, () => entries(dir)) || []) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, kind);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && (kind !== 'codex' || entry.name.startsWith('rollout-'))) add(file, kind);
    }
  }
  walk(path.join(config.claude, 'projects'), 'claude');
  walk(path.join(config.codex, 'sessions'), 'codex');
  add(path.join(config.state, 'dispatch-trail.log'), 'dispatch');
  add(path.join(config.state, 'review-ledger.log'), 'ledger');
  add(path.join(config.state, 'reviews.jsonl'), 'review');
  add(path.join(config.status, 'anthropic-usage.json'), 'status');
  const runsDir = path.join(config.state, 'runs');
  for (const entry of attempt(runsDir, () => entries(runsDir)) || []) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(config.state, 'runs', entry.name);
    const file = path.join(dir, 'run.json');
    attempt(file, () => {
      const info = stat(file);
      if (!info?.isFile()) return;
      let size = info.size, mtimeMs = info.mtimeMs;
      for (const sidecar of ['exit.txt', 'session.txt', 'activity.txt']) {
        const side = stat(path.join(dir, sidecar));
        if (side?.isFile()) { size += side.size; mtimeMs = Math.max(mtimeMs, side.mtimeMs); }
      }
      items.push({ file, kind: 'run', stat: { size, mtimeMs } });
    });
  }
  return items.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || a.file.localeCompare(b.file));
}
function small(file) {
  const info = stat(file);
  if (!info?.isFile()) return null;
  if (info.size > 1024 * 1024) throw Object.assign(new Error('State snapshot exceeds 1 MB'), { code: 'STATE_TOO_LARGE' });
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
}
function snapshot(store, item) {
  const key = v.hash(item.file);
  const previous = store.state(key);
  if (previous?.size === item.stat.size && previous.mtime_ms === item.stat.mtimeMs) return;
  const text = small(item.file);
  if (text === null) return;
  const row = JSON.parse(text);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new SyntaxError('State must be an object');
  if (item.kind === 'status') {
    for (const window of ['five_hour', 'seven_day']) {
      const value = row[window];
      if (value) quota(store, Math.floor(item.stat.mtimeMs / 1000), 'claude', window, value.utilization, value.resets_at);
    }
    store.cursor(key, item.stat.size, item.stat.mtimeMs, item.stat.size, null);
    return;
  }
  const dir = path.dirname(item.file);
  const exit = small(path.join(dir, 'exit.txt'));
  const exitCode = exit !== null && /^-?\d+$/.test(exit) ? Number(exit) : null;
  const started = v.epoch(row.startedUtc, Math.floor(item.stat.mtimeMs / 1000));
  const runId = v.name(row.runId) || path.basename(dir);
  const old = store.get('SELECT day FROM runs WHERE run_id=?', runId);
  store.touch(old?.day);
  store.insert('runs', { run_id: runId, codex_session_id: v.name(small(path.join(dir, 'session.txt'))),
    project: store.intern('project', repoOf(row.dir)), model: store.intern('model', row.model || 'unknown'),
    effort: store.intern('effort', row.effort), is_resume: row.resume ? 1 : 0, started,
    ended: exitCode === null ? null : v.epoch(small(path.join(dir, 'activity.txt')),
      Math.floor(stat(path.join(dir, 'exit.txt')).mtimeMs / 1000)),
    exit_code: exitCode, sandbox_failure: row.sandboxFailure === true ? 1 : 0, day: v.day(started)
  }, `(run_id) DO UPDATE SET codex_session_id=excluded.codex_session_id,project=excluded.project,
    model=excluded.model,effort=excluded.effort,is_resume=excluded.is_resume,started=excluded.started,
    ended=excluded.ended,exit_code=excluded.exit_code,sandbox_failure=excluded.sandbox_failure,day=excluded.day`);
  store.touch(v.day(started));
  store.cursor(key, item.stat.size, item.stat.mtimeMs, item.stat.size, null);
}
function linkRuns(store) {
  const kind = store.intern('dispatch_kind', 'do');
  store.run(`UPDATE runs SET claude_session_id=(SELECT d.claude_session_id FROM dispatches d
    WHERE d.kind=? AND d.model=runs.model AND d.ts BETWEEN runs.started-120 AND runs.started+120
      AND d.claude_session_id IS NOT NULL
    ORDER BY ABS(d.ts-runs.started), d.ts DESC, d.id LIMIT 1)`, kind);
}
module.exports = { paths, discover, snapshot, linkRuns, small };
