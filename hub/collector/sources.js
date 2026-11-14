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
  const codex = env.LINE_HUB_CODEX_DIR || path.join(os.homedir(), '.codex');
  const db = env.LINE_HUB_DB || path.join(os.homedir(), '.line-hub', 'hub.db');
  return { db, claude, codex,
    // v8: the system sampler writes <db folder>/system/<yyyy-mm-dd>.jsonl (collector/sample-system.js).
    system: env.LINE_HUB_SYSTEM_DIR || path.join(path.dirname(db), 'system'),
    // v7: one CODEX_HOME per account (codex-acc.ps1): <accounts>/<name>/sessions. Defaults to the
    // folder next to the Codex home, so fixture homes never pick up the real accounts.
    codexAccounts: env.LINE_HUB_CODEX_ACCOUNTS_DIR || path.join(path.dirname(codex), '.codex-accounts'),
    state: env.LINE_HUB_STATE_DIR || path.join(claude, 'state'),
    status: env.LINE_HUB_STATUS_DIR || path.join(os.tmpdir(), 'ultrathink-status') };
}
// Account label of a Codex home: its folder name when it sits under the accounts folder, else "default".
function accountOf(home, accounts) {
  return accounts && path.resolve(path.dirname(home)).toLowerCase() === path.resolve(accounts).toLowerCase() ? path.basename(home) : 'default';
}
/* H7 (2026-11-14): the active Codex account. codex-acc.ps1 `use <name>` writes "<name>\n" to
 * <accounts>/active (Get-CodexActiveAccount in codex-acc-lib.ps1 reads it back). "main" is the main home,
 * labelled by accountOf() ("default"). A missing, empty or invalid file is no signal (null); quota() then
 * falls back to the account of the newest snapshot. Stored as meta codex_active_account on every run.
 * Status: done. Next: none. Blockers: none. Confidence: tests/h7-current-account.test.js + real DB check. */
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
function activeAccount(config) {
  if (!config.codexAccounts) return null;
  let name;
  try { name = fs.readFileSync(path.join(config.codexAccounts, 'active'), 'utf8').replace(/^﻿/, '').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    // Line 2026-11-15 (option A): an accounts folder without an `active` file means `main`, exactly as
    // codex-acc.ps1 reads it; no accounts folder at all = no multi-account signal (newest-snapshot fallback).
    return fs.existsSync(config.codexAccounts) ? accountOf(config.codex, config.codexAccounts) : null;
  }
  if (!ACCOUNT_NAME.test(name)) return null;
  return name === 'main' ? accountOf(config.codex, config.codexAccounts) : name;
}
function recordActiveAccount(store, config) {
  const name = activeAccount(config);
  if (name === null) store.run("DELETE FROM meta WHERE key='codex_active_account'");
  else store.setMeta('codex_active_account', name);
}
const SYSTEM_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
// v8: delete sampler files older than `days` local days (by file name), but only once their cursor shows
// they were read to the end (offset == size); an unread or partly read file waits for a later run.
// Their cursors go too.
function pruneSystem(store, config, now = Date.now(), days = 8) {
  if (!config.system) return 0;
  const t = new Date(now);
  const cutoff = v.day(Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days).getTime() / 1000));
  let removed = 0;
  for (const entry of entries(config.system)) {
    if (!entry.isFile() || !SYSTEM_FILE.test(entry.name) || entry.name.slice(0, 10) >= cutoff) continue;
    const file = path.join(config.system, entry.name);
    const cursor = store.state(v.hash(file)), info = stat(file);
    if (!cursor || !info || cursor.offset !== info.size) continue;
    try { fs.unlinkSync(file); removed++; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    store.run('DELETE FROM ingest_state WHERE path=?', v.hash(file));
  }
  return removed;
}
// v8: hook timeouts from the hooks section of settings.json. Nothing else in the file is read or kept.
// Defaults (Claude Code docs via context7, 2026-11-13): command / http / mcp_tool 600 s, prompt 30 s,
// agent 60 s; UserPromptSubmit lowers command / http / mcp_tool to 30 s.
function hookLimits(hooks) {
  const out = new Map();
  for (const [event, matchers] of Object.entries(hooks && typeof hooks === 'object' ? hooks : {})) {
    for (const m of Array.isArray(matchers) ? matchers : []) {
      for (const h of Array.isArray(m?.hooks) ? m.hooks : []) {
        const type = h?.type || 'command';
        const base = type === 'prompt' ? 30 : type === 'agent' ? 60 : event === 'UserPromptSubmit' ? 30 : 600;
        const secs = Number.isFinite(h?.timeout) && h.timeout > 0 ? h.timeout : base;
        const key = `${v.script(h?.command)}|${event}`;
        out.set(key, Math.max(out.get(key) || 0, Math.round(secs * 1000)));
      }
    }
  }
  return [...out].map(([key, ms]) => { const [script, event] = key.split('|'); return { script, event, ms }; });
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
  function add(file, kind, account) {
    attempt(file, () => {
      const info = stat(file);
      if (info?.isFile()) items.push(account ? { file, kind, stat: info, account } : { file, kind, stat: info });
    });
  }
  function walk(dir, kind, account) {
    for (const entry of attempt(dir, () => entries(dir)) || []) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, kind, account);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && (kind !== 'codex' || entry.name.startsWith('rollout-'))) add(file, kind, account);
    }
  }
  walk(path.join(config.claude, 'projects'), 'claude');
  walk(path.join(config.codex, 'sessions'), 'codex', accountOf(config.codex, config.codexAccounts));
  if (config.codexAccounts) {
    for (const entry of attempt(config.codexAccounts, () => entries(config.codexAccounts)) || []) {
      const home = path.join(config.codexAccounts, entry.name);
      if (entry.isDirectory() && path.resolve(home).toLowerCase() !== path.resolve(config.codex).toLowerCase()) walk(path.join(home, 'sessions'), 'codex', entry.name);
    }
  }
  add(path.join(config.state, 'dispatch-trail.log'), 'dispatch');
  add(path.join(config.state, 'review-ledger.log'), 'ledger');
  add(path.join(config.state, 'reviews.jsonl'), 'review');
  add(path.join(config.status, 'anthropic-usage.json'), 'status');
  add(path.join(config.claude, 'settings.json'), 'settings');
  if (config.system) {
    for (const entry of attempt(config.system, () => entries(config.system)) || []) {
      if (entry.isFile() && SYSTEM_FILE.test(entry.name)) add(path.join(config.system, entry.name), 'system');
    }
  }
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
  if (item.kind === 'settings') {
    store.run('DELETE FROM hook_limits');
    for (const x of hookLimits(row.hooks)) {
      store.run('INSERT OR REPLACE INTO hook_limits VALUES (?,?,?)', store.intern('script', x.script), store.intern('event', x.event), x.ms);
    }
    store.cursor(key, item.stat.size, item.stat.mtimeMs, item.stat.size, null);
    return;
  }
  const dir = path.dirname(item.file);
  const exitInfo = stat(path.join(dir, 'exit.txt'));
  const exit = small(path.join(dir, 'exit.txt'));
  const exitCode = exit !== null && /^-?\d+$/.test(exit) ? Number(exit) : null;
  // v7: a run ends when codex-do writes exit.txt, so its mtime is the end time. activity.txt
  // (the last worker activity) is only the fallback when exit.txt holds no exit code.
  const ended = exitCode !== null ? Math.floor(exitInfo.mtimeMs / 1000)
    : exitInfo?.isFile() ? v.epoch(small(path.join(dir, 'activity.txt')), Math.floor(exitInfo.mtimeMs / 1000)) : null;
  const started = v.epoch(row.startedUtc, Math.floor(item.stat.mtimeMs / 1000));
  const runId = v.name(row.runId) || path.basename(dir);
  const old = store.get('SELECT day FROM runs WHERE run_id=?', runId);
  store.touch(old?.day);
  store.insert('runs', { run_id: runId, codex_session_id: v.name(small(path.join(dir, 'session.txt'))),
    project: store.intern('project', repoOf(row.dir)), model: store.intern('model', row.model || 'unknown'),
    effort: store.intern('effort', row.effort), is_resume: row.resume ? 1 : 0, started,
    ended,
    exit_code: exitCode, sandbox_failure: row.sandboxFailure === true ? 1 : 0, day: v.day(started),
    // v8: packet size = the stdin.txt copy codex-do writes into the run folder (size only, never read).
    spec_bytes: stat(path.join(dir, 'stdin.txt'))?.size ?? null,
    // v9: accept only a complete SHA-256 digest; the packet itself is never read.
    spec_sha: typeof row.specSha256 === 'string' && /^[a-f0-9]{64}$/i.test(row.specSha256) ? row.specSha256.toLowerCase() : null
  }, `(run_id) DO UPDATE SET codex_session_id=excluded.codex_session_id,project=excluded.project,
    model=excluded.model,effort=excluded.effort,is_resume=excluded.is_resume,started=excluded.started,
    ended=excluded.ended,exit_code=excluded.exit_code,sandbox_failure=excluded.sandbox_failure,day=excluded.day,
    spec_bytes=excluded.spec_bytes,spec_sha=excluded.spec_sha`);
  store.touch(v.day(started));
  store.cursor(key, item.stat.size, item.stat.mtimeMs, item.stat.size, null);
}
// v7: a resumed run is dispatched as kind `resume`, so both kinds link a run to its Claude session.
function linkRuns(store) {
  const kinds = [store.intern('dispatch_kind', 'do'), store.intern('dispatch_kind', 'resume')];
  store.run(`UPDATE runs SET claude_session_id=(SELECT d.claude_session_id FROM dispatches d
    WHERE d.kind IN (?,?) AND d.model=runs.model AND d.ts BETWEEN runs.started-120 AND runs.started+120
      AND d.claude_session_id IS NOT NULL
    ORDER BY ABS(d.ts-runs.started), d.ts DESC, d.id LIMIT 1)`, ...kinds);
}
module.exports = { paths, discover, snapshot, linkRuns, small, accountOf, activeAccount, recordActiveAccount, pruneSystem, hookLimits, SYSTEM_FILE };
