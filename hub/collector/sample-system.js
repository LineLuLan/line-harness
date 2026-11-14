/* Intent: one cheap system sample per call (Task Scheduler runs it every minute), then exit.
 * Status: v8. Appends one JSON line to <db folder>/system/<yyyy-mm-dd>.jsonl:
 *   ts, ram { free, total } MB (os), commit { used, limit } MB + the list of fixed drives (ONE powershell
 *   CIM call), drives [{ d, free, total }] bytes (fs.statfsSync), top 8 process names by working set
 *   (tasklist /fo csv, grouped by name: [name, MB, count]); once per hour new System event 2004 entries
 *   (low-memory resource exhaustion: time + top process names, via wevtutil); once per day the size of
 *   eight fixed folders (the last two hold the WSL and Docker .vhdx disks). The folder walk runs in ~600 ms
 *   slices across calls (it resumes from a cursor of child indexes, so no path is ever written down) and the
 *   sizes are written when all eight are done.
 *   Privacy: process names, drive letters, folder labels and numbers only. No command lines, titles or paths.
 *   Errors: one sanitized line in collect-errors.log, exit code 0 always.
 * Next: supervisor registers the task (scripts/install-sampler.ps1). Blockers: none.
 * Confidence: tests/v8.test.js (parsers on tests/fixtures/system.js, walk resume, sampler run, event cursor)
 *   + measured cost on Line's machine. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const WALK_SLICE_MS = 600;
const EVENT_EVERY_S = 3600;
const EVENT_FIRST_LOOKBACK_S = 7 * 86400;

function config(env = process.env) {
  const db = env.LINE_HUB_DB || path.join(os.homedir(), '.line-hub', 'hub.db');
  const claude = env.LINE_HUB_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  const codex = env.LINE_HUB_CODEX_DIR || path.join(os.homedir(), '.codex');
  const hub = path.dirname(db);
  const local = env.LINE_HUB_LOCALAPPDATA || env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  // H8a: notify = deliver desktop toasts (LINE_HUB_NOTIFY=0 turns delivery off; the alert log still runs).
  // home = the folder rule f checks for AGENTS.md (LINE_HUB_HOME overrides it, as in queries.strayAgents).
  return { db, hub, system: env.LINE_HUB_SYSTEM_DIR || path.join(hub, 'system'), notify: env.LINE_HUB_NOTIFY !== '0', home: env.LINE_HUB_HOME || null,
    // The eight folders, in walk order. codex_total = ~/.codex without sessions + codex_sessions.
    // wsl_vhdx / docker_vhdx: the WSL distro and Docker Desktop virtual disks (only file sizes are summed).
    folders: [
      { label: 'claude_projects', dir: path.join(claude, 'projects') },
      { label: 'codex_sessions', dir: path.join(codex, 'sessions') },
      { label: 'codex_total', dir: codex, skip: path.join(codex, 'sessions'), plus: 'codex_sessions' },
      { label: 'claude_runs', dir: env.LINE_HUB_STATE_DIR ? path.join(env.LINE_HUB_STATE_DIR, 'runs') : path.join(claude, 'state', 'runs') },
      { label: 'temp_claude', dir: path.join(env.LINE_HUB_TEMP_DIR || os.tmpdir(), 'claude') },
      { label: 'line_hub', dir: hub },
      { label: 'wsl_vhdx', dir: path.join(local, 'wsl') },
      { label: 'docker_vhdx', dir: path.join(local, 'Docker', 'wsl', 'disk') }
    ] };
}
const localDay = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------- parsers (pure, tested with fixtures) ---------- */
// tasklist /fo csv /nh: "Image Name","PID","Session Name","Session#","Mem Usage" ("1.234 K" or "1,234 K").
// Grouped by image name (Chrome has dozens of processes), sorted by MB, top 8: [name, MB, count].
function parseTasklist(text, n = 8) {
  const by = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const cells = line.match(/"([^"]*)"/g);
    if (!cells || cells.length < 5) continue;
    const name = cells[0].slice(1, -1), kb = Number(cells[4].replace(/[^0-9]/g, ''));
    if (!name || !Number.isFinite(kb) || !/^[\w .()+@#-]{1,64}$/.test(name)) continue;
    const x = by.get(name) || { kb: 0, count: 0 };
    x.kb += kb; x.count++; by.set(name, x);
  }
  return [...by].map(([name, x]) => [name, Math.round(x.kb / 1024), x.count])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}
// Output of the CIM call: "<TotalVirtualMemorySize KB> <FreeVirtualMemory KB>" then "C: D:".
// Commit limit = TotalVirtualMemorySize, commit used = limit - FreeVirtualMemory.
function parseCim(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const [limitKb, freeKb] = (lines[0] || '').split(/\s+/).map(Number);
  const commit = Number.isFinite(limitKb) && Number.isFinite(freeKb) && limitKb > 0
    ? { used: Math.round((limitKb - freeKb) / 1024), limit: Math.round(limitKb / 1024) } : null;
  const drives = [...new Set((lines[1] || '').split(/\s+/).filter(d => /^[A-Z]:$/i.test(d)).map(d => d.toUpperCase()))];
  return { commit, drives };
}
// wevtutil /f:xml output for System event 2004 (Microsoft-Windows-Resource-Exhaustion-Detector):
// TimeCreated/@SystemTime and the <Name> of each <Process_N> under ProcessInfo (highest commit first).
function parseEvents(xml, max = 5) {
  const out = [];
  for (const ev of String(xml || '').split(/<\/Event>/)) {
    const t = /<TimeCreated\s+SystemTime=['"]([^'"]+)['"]/.exec(ev);
    if (!t || !/<EventID[^>]*>\s*2004\s*</.test(ev)) continue;
    const ts = Math.floor(Date.parse(t[1]) / 1000);
    if (!Number.isFinite(ts)) continue;
    const names = [...ev.matchAll(/<Name>([^<]{1,64})<\/Name>/g)].map(m => m[1].trim()).filter(n => /^[\w .()+@#-]{1,64}$/.test(n));
    out.push({ ts, top: [...new Set(names)].slice(0, max) });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/* ---------- resumable folder walk ---------- */
// w = { cursor: [index per directory level], bytes, files }. Directories are read in name order, so a
// cursor of child indexes finds the same place on the next call without storing any path. Entries that
// change between calls make the total approximate (fine for a daily size). Links are not followed.
function readDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { return []; }
}
function walkStep(root, w, deadline, skip = null, now = Date.now) {
  const frames = [{ dir: root, list: readDir(root), i: w.cursor[0] || 0 }];
  for (let k = 1; k < w.cursor.length; k++) {
    const f = frames[k - 1], e = f.list[f.i];
    if (!e || !e.isDirectory()) break;
    const dir = path.join(f.dir, e.name);
    frames.push({ dir, list: readDir(dir), i: w.cursor[k] || 0 });
  }
  let n = 0;
  while (frames.length) {
    const f = frames.at(-1);
    if (f.i >= f.list.length) { frames.pop(); if (frames.length) frames.at(-1).i++; continue; }
    if ((++n & 31) === 0 && now() >= deadline) { w.cursor = frames.map(x => x.i); return false; }
    const e = f.list[f.i], p = path.join(f.dir, e.name);
    if (e.isDirectory()) {
      if (skip && path.resolve(p).toLowerCase() === path.resolve(skip).toLowerCase()) { f.i++; continue; }
      frames.push({ dir: p, list: readDir(p), i: 0 });
      continue;
    }
    if (e.isFile()) { try { w.bytes += fs.statSync(p).size; w.files++; } catch { /* vanished */ } }
    f.i++;
  }
  w.cursor = [];
  return true;
}
// One slice of the daily folder pass. Returns the eight sizes when the pass finishes in this call, else null.
function folderSlice(state, folders, deadline, day = localDay(), now = Date.now) {
  if (!state.walk || state.walk.day !== day) state.walk = { day, index: 0, cursor: [], bytes: 0, files: 0, results: {}, done: false };
  const w = state.walk;
  if (w.done) return null;
  while (w.index < folders.length) {
    const f = folders[w.index];
    if (!walkStep(f.dir, w, deadline, f.skip, now)) return null;
    const drive = /^[A-Za-z]:/.test(path.resolve(f.dir)) ? path.resolve(f.dir).slice(0, 2).toUpperCase() : null;
    w.results[f.label] = { bytes: w.bytes + (f.plus ? w.results[f.plus]?.bytes || 0 : 0), drive };
    Object.assign(w, { index: w.index + 1, cursor: [], bytes: 0, files: 0 });
    if (now() >= deadline && w.index < folders.length) return null;
  }
  w.done = true;
  return w.results;
}

/* ---------- side effects ---------- */
function run(file, args, timeout = 5000, env = undefined) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', ...(env ? { env } : {}) },
      (error, stdout) => resolve(error ? { error } : { stdout }));
  });
}
function logError(dir, code) {
  const line = `${new Date().toISOString()} ${/^[A-Z_0-9]{1,40}$/.test(code) ? code : 'SAMPLER_FAILED'}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'collect-errors.log');
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* none yet */ }
    if (size + line.length > 1024 * 1024) fs.writeFileSync(file, '', { mode: 0o600 });
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch { /* never fail the scheduled task */ }
}
function readState(file) {
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function writeState(file, state) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const CIM = "$o=Get-CimInstance Win32_OperatingSystem -Property TotalVirtualMemorySize,FreeVirtualMemory;" +
  "\"$($o.TotalVirtualMemorySize) $($o.FreeVirtualMemory)\";" +
  "(@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -Property DeviceID) | ForEach-Object { $_.DeviceID }) -join ' '";

/* ---------- H8a proactive alerts ---------- */
/* After each sample: evaluate rules a, b, c, f, g, h (queries.evaluateRules, the same engine as "Do this now"),
 * keep one episode per rule in the sampler state, toast once per episode, log each toast to alerts.jsonl.
 * Rule b uses the fresh row in hand; a, c, g, h read the hub DB through a READ-ONLY node:sqlite connection
 * (never Store, never a write, no schema work); no DB file = those rules are skipped. f checks ~/AGENTS.md.
 * Intent: Line sees a harness limit without Hub open. Status: done. Next: none.
 * Blockers: a toast from a headless scheduled task shows only when Windows lets that session notify.
 * Confidence: tests/h8a-alerts.test.js + real runs (H8a report). */
const ALERT_RULES = ['a', 'b', 'c', 'f', 'g', 'h'];
const ALERT_RULE_NAME = { a: 'quota pace', b: 'commit charge', c: 'disk', f: 'stray AGENTS.md', g: '50M thread', h: 'Claude 5-hour' };
const REFIRE_SECS = 15 * 60;
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const TOAST_TIMEOUT_MS = 10000;
// Fixed script (adapted from ~/.claude/bin/codex-run-notify.ps1 toast lines). Title and body come ONLY from
// LINE_HUB_TOAST_TITLE / LINE_HUB_TOAST_BODY and are XML-escaped here; nothing is interpolated into the command.
const TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
  '  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
  '  $title = [Security.SecurityElement]::Escape([string]$env:LINE_HUB_TOAST_TITLE)',
  '  $body = [Security.SecurityElement]::Escape([string]$env:LINE_HUB_TOAST_BODY)',
  '  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  "  $xml.LoadXml(('<toast><visual><binding template=\"ToastGeneric\"><text>{0}</text><text>{1}</text></binding></visual><audio silent=\"true\"/></toast>' -f $title, $body))",
  '  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
  "  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
  '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)',
  '  exit 0',
  '} catch { exit 1 }'
].join('\n');
// -EncodedCommand (UTF-16LE base64) of the fixed script: no quoting of the script through the command line.
const TOAST_ARGS = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(TOAST_SCRIPT, 'utf16le').toString('base64')];

/* Episode step for one rule list. state.alerts[rule] = { firing, since, clearedAt, toastedAt }.
 * Starts firing: toast when never toasted, or when it was clear for >= 15 min before firing again.
 * A refire after a shorter clear continues the episode silently. Returns the rule ids to toast now. */
function alertEpisodes(state, firing, ts) {
  const alerts = state.alerts && typeof state.alerts === 'object' ? state.alerts : {};
  const toast = [];
  for (const id of ALERT_RULES) {
    const e = alerts[id] && typeof alerts[id] === 'object' ? alerts[id] : { firing: false, since: null, clearedAt: null, toastedAt: null };
    if (firing.includes(id)) {
      if (!e.firing) {
        const fresh = e.toastedAt === null || e.toastedAt === undefined || (Number.isFinite(e.clearedAt) && ts - e.clearedAt >= REFIRE_SECS);
        e.firing = true; e.since = ts;
        if (fresh) { e.toastedAt = ts; toast.push(id); }
      }
    } else if (e.firing) { e.firing = false; e.clearedAt = ts; }
    alerts[id] = e;
  }
  state.alerts = alerts;
  return toast.sort((p, q) => firing.indexOf(p) - firing.indexOf(q)); // rule order, as evaluateRules gives it
}
// One toast through Windows PowerShell 5.1. exec is the sampler's injectable runner. Never throws.
async function deliverToast(title, body, exec = run) {
  try {
    const r = await exec(POWERSHELL, TOAST_ARGS, TOAST_TIMEOUT_MS, { ...process.env, LINE_HUB_TOAST_TITLE: String(title), LINE_HUB_TOAST_BODY: String(body) });
    if (r && r.error) { process.stderr.write(`line-hub toast: ${r.error.killed ? 'timeout' : `exit ${r.error.code ?? 'error'}`}\n`); return { ok: false, error: r.error }; }
    return { ok: true };
  } catch (error) {
    process.stderr.write(`line-hub toast: ${error?.code || error?.name || 'error'}\n`);
    return { ok: false, error };
  }
}
// The rule input from the fresh row (rule b) and the read-only hub DB (a, c, g, h). f needs neither.
function alertInput(cfg, row, ts) {
  const q = require('../server/queries');
  const commitPct = row.commit && row.commit.limit ? Math.round(row.commit.used / row.commit.limit * 1000) / 10 : null;
  const x = { ram: { freePct: row.ram.total ? Math.round(row.ram.free / row.ram.total * 1000) / 10 : null, commitPct }, top: row.top, stale: false,
    strayAgents: q.strayAgents(cfg.home ? { LINE_HUB_HOME: cfg.home } : process.env) };
  if (!cfg.db || !fs.existsSync(cfg.db)) return x;
  require('./warnings');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(cfg.db, { readOnly: true, timeout: 500 });
  try {
    const sample = q.latestSample(db);
    x.quotas = q.liveQuotas(db, ts);
    x.drives = sample?.drives || [];
    x.sampleTs = sample?.ts ?? null;
    x.folders = q.folders(db, ts, x.drives);
    x.bigThreads = q.bigThreads(db, ts - q.RULES.threadActiveHours * 3600);
  } finally { db.close(); }
  return x;
}
async function alertStep(cfg, state, row, exec = run, save = () => {}) {
  const q = require('../server/queries');
  let x;
  try { x = alertInput(cfg, row, row.ts); } catch (error) {
    process.stderr.write(`line-hub alerts: ${error?.code || error?.name || 'error'}\n`);
    return { fired: [], toasted: [], failed: true }; // keep episode state as is: no false clears, no re-toast on recovery
  }
  const fired = q.evaluateRules(x).filter(r => ALERT_RULES.includes(r.id));
  const toast = alertEpisodes(state, fired.map(r => r.id), row.ts);
  if (toast.length) save(); // state first: a crash during delivery must not log/toast the same episode twice
  for (const id of toast) {
    const r = fired.find(k => k.id === id);
    const file = path.join(cfg.system, 'alerts.jsonl');
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* none yet */ }
      if (size > 1024 * 1024) fs.writeFileSync(file, '', { mode: 0o600 });
      fs.appendFileSync(file, JSON.stringify({ ts: row.ts, rule: id, text: r.text }) + '\n', { mode: 0o600 });
    } catch (error) { process.stderr.write(`line-hub alerts log: ${error?.code || 'error'}\n`); }
    if (cfg.notify === true) await deliverToast(`Line Hub: ${ALERT_RULE_NAME[id]}`, `${r.text} ${r.action}`, exec);
  }
  return { fired: fired.map(r => r.id), toasted: toast };
}

// exec / win are injectable for tests (fake child processes on any platform).
async function sample(cfg = config(), now = Date.now(), exec = run, win = process.platform === 'win32') {
  fs.mkdirSync(cfg.system, { recursive: true, mode: 0o700 });
  const stateFile = path.join(cfg.system, 'sampler-state.json');
  const state = readState(stateFile);
  const ts = Math.floor(now / 1000);
  // Events are queried from the newest event already recorded (or 7 days back when none yet), once an hour.
  // The hourly mark only moves after a successful query, so a failed or timed-out wevtutil is retried next call.
  const sinceEvents = Number(state.lastEventTs) || ts - EVENT_FIRST_LOOKBACK_S;
  const wantEvents = win && ts - (Number(state.lastEventCheck) || 0) >= EVENT_EVERY_S;
  // Start the child processes first; the folder slice runs while they work.
  const cim = win ? exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', CIM]) : Promise.resolve({ error: new Error('not windows') });
  const tasks = win ? exec('tasklist.exe', ['/fo', 'csv', '/nh']) : Promise.resolve({ error: new Error('not windows') });
  const events = wantEvents ? exec('wevtutil.exe', ['qe', 'System', `/q:*[System[(EventID=2004) and TimeCreated[@SystemTime>='${new Date(sinceEvents * 1000).toISOString()}']]]`, '/f:xml', '/c:50', '/rd:true']) : null;
  const folders = state.walk?.done && state.walk.day === localDay(now) ? null : folderSlice(state, cfg.folders, Date.now() + WALK_SLICE_MS, localDay(now));
  const [c, t, e] = await Promise.all([cim, tasks, events]);
  const errors = [];
  const parsed = c.error ? (errors.push('SAMPLER_CIM'), { commit: null, drives: [] }) : parseCim(c.stdout);
  const driveList = parsed.drives.length ? parsed.drives : (win ? ['C:'] : []);
  const drives = [];
  for (const d of driveList) {
    try { const s = fs.statfsSync(`${d}\\`); drives.push({ d, free: s.bavail * s.bsize, total: s.blocks * s.bsize }); } catch { errors.push('SAMPLER_STATFS'); }
  }
  const row = { ts, ram: { free: Math.round(os.freemem() / 1048576), total: Math.round(os.totalmem() / 1048576) },
    commit: parsed.commit, drives, top: t.error ? (errors.push('SAMPLER_TASKLIST'), []) : parseTasklist(t.stdout) };
  if (e) {
    if (e.error) errors.push(e.error.killed || e.error.signal ? 'SAMPLER_WEVTUTIL_TIMEOUT' : 'SAMPLER_WEVTUTIL');
    else {
      const found = parseEvents(e.stdout).filter(k => k.ts > (Number(state.lastEventTs) || 0));
      if (found.length) { row.kills = found; state.lastEventTs = found.at(-1).ts; }
      state.lastEventCheck = ts;
    }
  }
  if (folders) row.folders = folders;
  fs.appendFileSync(path.join(cfg.system, `${localDay(now)}.jsonl`), JSON.stringify(row) + '\n', { mode: 0o600 });
  // H8a: alerts after the sample is written; never fails the sample. Result is kept off the JSON row.
  const alertStart = Date.now();
  let alerts;
  try { alerts = await alertStep(cfg, state, row, exec, () => writeState(stateFile, state)); } catch (error) {
    process.stderr.write(`line-hub alerts: ${error?.code || error?.name || 'error'}\n`);
    alerts = { fired: [], toasted: [], failed: true };
  }
  Object.defineProperty(row, 'alerts', { value: { ...alerts, ms: Date.now() - alertStart }, enumerable: false });
  writeState(stateFile, state);
  for (const code of new Set(errors)) logError(cfg.hub, code);
  return row;
}

async function main() {
  const started = Date.now();
  const cfg = config();
  try {
    const row = await sample(cfg, started);
    if (!process.argv.includes('--quiet')) {
      process.stdout.write(JSON.stringify({ ok: true, ms: Date.now() - started, max_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
        drives: row.drives.length, top: row.top.length, kills: row.kills?.length || 0, folders: Boolean(row.folders),
        alerts: row.alerts ? { fired: row.alerts.fired, toasted: row.alerts.toasted, ms: row.alerts.ms } : null }) + '\n');
    }
  } catch (error) {
    logError(cfg.hub, typeof error?.code === 'string' && /^[A-Z_0-9]{1,40}$/.test(error.code) ? `SAMPLER_${error.code}`.slice(0, 40) : 'SAMPLER_FAILED');
  } finally {
    process.exitCode = 0;
  }
}
if (require.main === module) void main();
module.exports = { config, parseTasklist, parseCim, parseEvents, walkStep, folderSlice, sample, localDay,
  alertEpisodes, alertInput, alertStep, deliverToast, ALERT_RULES, REFIRE_SECS, POWERSHELL, TOAST_SCRIPT, TOAST_ARGS, TOAST_TIMEOUT_MS };
