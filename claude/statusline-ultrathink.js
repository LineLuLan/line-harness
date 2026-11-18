#!/usr/bin/env node
// UltraThink-inspired statusline v2 for Claude Code (Windows).
// Loosely based on InugamiDev/ultrathink-oss statusline.sh, redesigned per user:
//
//   ✦ ultrathink · Fable 5.1 · ctx ▓▓▓▓▓▓▓░░░ 72% · $1.23
//     ⚡ claude <email> · 5h <bar> % · wk <bar> %
//     ⚡ codex <email> · gpt-5.5 xhigh ⚡fast · wk <bar> % ↻ dd/MM
//     ⚡ grok <email> · wk <bar> % ↻ dd/MM
//     📁 dir · ⎇ branch · ◇ recent-skill · ⚙ recent-mcp-server
//
// All bars/percentages show what is LEFT (full bar = plenty remaining).
// Claude usage: Anthropic OAuth usage API (background fetch, cached 60s).
// Codex usage: tail of the newest ~/.codex/sessions/**/rollout-*.jsonl —
//   rate_limits windows bucketed by window_minutes (300→5h, 10080→weekly).
// Recent tools: tools-<session_id>.log written by hooks/track-tools.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOME = os.homedir();

// Intent: each selected account reads its own home and keeps its own cached usage.
// Status: fixture-covered. Next: supervisor review. Blockers: none. Confidence: high.
function codexHome() {
  const main = process.env.CODEX_ACC_MAIN_HOME || path.join(HOME, '.codex');
  try {
    const root = process.env.CODEX_ACC_ROOT || path.join(HOME, '.codex-accounts');
    const name = fs.readFileSync(path.join(root, 'active'), 'utf8').trim();
    if (name !== 'main' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
      const home = path.join(root, name);
      if (fs.statSync(home).isDirectory()) return home;
    }
  } catch {}
  return main;
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

// Intent: make detached worker health visible without delaying statusline rendering.
// Status: fixture-covered. Next: install and wire the hook separately. Blockers: none. Confidence: high.
function summarizeRuns(stateDir, nowMs, isAlive = pidAlive) {
  const summary = { running: 0, stale: 0, died: 0, oldestRunningMin: 0 };
  try {
    const runsDir = path.join(stateDir, 'runs');
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{8}-\d{6}-[A-Za-z0-9]{4}$/.test(entry.name)) continue;
      const dir = path.join(runsDir, entry.name);
      try {
        const folderAge = nowMs - fs.statSync(dir).mtimeMs;
        if (folderAge < 0 || folderAge > 24 * 60 * 60_000) continue;
        if (fs.existsSync(path.join(dir, 'exit.txt'))) continue;
        const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
        if (!run || typeof run !== 'object') continue;
        let alive = isAlive(run.wrapperPid);
        if (!alive) {
          try {
            const tree = JSON.parse(fs.readFileSync(path.join(dir, 'tree.json'), 'utf8'));
            if (Array.isArray(tree)) alive = tree.some(process => process && isAlive(process.pid));
          } catch {}
        }
        if (alive) {
          summary.running++;
          const start = Date.parse(run.startedUtc);
          const ageMin = Math.max(0, Math.floor((nowMs - (Number.isFinite(start) ? start : fs.statSync(dir).mtimeMs)) / 60_000));
          summary.oldestRunningMin = Math.max(summary.oldestRunningMin, ageMin);
          try {
            // out.log mtime can lag while cmd holds it open; codex-do's wait loop also writes
            // activity.txt (UTC ISO) whenever out.log grows. Use the newer of the two.
            let lastOutput = fs.statSync(path.join(dir, 'out.log')).mtimeMs;
            try {
              const act = Date.parse(fs.readFileSync(path.join(dir, 'activity.txt'), 'utf8').trim());
              if (Number.isFinite(act) && act > lastOutput) lastOutput = act;
            } catch {}
            if (nowMs - lastOutput > 10 * 60_000) summary.stale++;
          } catch {}
        } else if (folderAge > 2 * 60_000 && folderAge <= 6 * 60 * 60_000) {
          summary.died++;
        }
      } catch {}
    }
  } catch {}
  return summary;
}

// Intent: show quota burn relative to elapsed time using only existing usage inputs.
// Status: fixture-covered. Next: supervisor installs. Blockers: none. Confidence: high.
function weeklyPace(usedPercent, resetsAt, nowMs = Date.now()) {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  const resetMs = typeof resetsAt === 'number' ? resetsAt * 1000
    : typeof resetsAt === 'string' && resetsAt.trim() ? Date.parse(resetsAt) : NaN;
  const weekMs = 7 * 24 * 60 * 60_000;
  const elapsedMs = weekMs - (resetMs - nowMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < weekMs * 0.05 || elapsedMs >= weekMs) return null;
  return usedPercent / (100 * elapsedMs / weekMs);
}

// colors (256-color palette from ultrathink)
const RESET = '\x1b[0m', DIM = '\x1b[2m', BOLD = '\x1b[1m';
const c = n => `\x1b[38;5;${n}m`;
const LAVENDER = c(141), PEACH = c(216), SKY = c(117), MINT = c(121),
  AMBER = c(214), CORAL = c(203), SLATE = c(248), SAGE = c(151),
  CLOUD = c(253), STEEL = c(110);
const SEP = ` ${SLATE}·${RESET} `;
const gauge = left => (left > 50 ? MINT : left > 20 ? AMBER : CORAL);
/* Intent: use the ontology's pace colours, with a safe local fallback for missing/invalid input.
 * Status: complete. Next: install after review. Blockers: none. Confidence: real renderer fixture. */
function paceThresholds() {
  try {
    const file = process.env.ULTRATHINK_ONTOLOGY !== undefined ? process.env.ULTRATHINK_ONTOLOGY
      : path.join(process.env.USERPROFILE || HOME, '.claude/ontology/harness.ontology.json');
    const thresholds = JSON.parse(fs.readFileSync(file, 'utf8')).quota?.thresholds;
    if (Number.isFinite(thresholds?.codexPace1) && Number.isFinite(thresholds?.codexPace2)) return thresholds;
  } catch { /* The statusline still renders when the ontology is absent or invalid. */ }
  return { codexPace1: 1.0, codexPace2: 1.3 };
}
let PACE;
const paceLabel = pace => pace == null ? ''
  : ` ${pace > PACE.codexPace2 ? CORAL : pace > PACE.codexPace1 ? AMBER : SAGE}pace ${pace.toFixed(1)}x${RESET}`;

// bar of what's LEFT: full = plenty remaining
function bar(left, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((left / 100) * width)));
  return `${gauge(left)}${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${left}%${RESET}`;
}

const fmtReset = epochSec => {
  if (!epochSec) return '';
  const d = new Date(epochSec * 1000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Intent: show Grok's account and weekly quota without rendering credential fields.
// Status: fixture-covered. Next: validate live data on the host. Blockers: none. Confidence: high.
function grokRow(cache, nowMs = Date.now()) {
  if (!cache || typeof cache !== 'object') return '';
  let row = `  ${BOLD}${LAVENDER}⚡${RESET} ${PEACH}grok${RESET} ${CLOUD}${cache.email || 'not logged in'}${RESET}`;
  if (cache.loggedIn === false) return row;
  if (cache.expired) return `${row}${SEP}${AMBER}${cache.refreshable ? 'token idle - auto-refresh on next grok run' : 'login expired - run grok login'}${RESET}`;
  let part = '';
  // Touch-up 2026-11-17: the live API sends "USAGE_PERIOD_TYPE_WEEKLY", not "weekly".
  const weekly = typeof cache.periodType === 'string' && /(^|_)weekly$/i.test(cache.periodType);
  const used = cache.usedPercent;
  const resetMs = typeof cache.periodEnd === 'string' ? Date.parse(cache.periodEnd) : NaN;
  const resetSec = Number.isFinite(resetMs) ? resetMs / 1000 : null;
  if (weekly && typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100) {
    part += `${SEP}${SLATE}wk${RESET} ${bar(100 - used)}`;
    part += paceLabel(weeklyPace(used, resetSec, nowMs));
  }
  const reset = fmtReset(resetSec);
  if (reset) part += ` ${SLATE}↻ ${reset}${RESET}`;
  if (part && Number.isFinite(cache.ts) && nowMs - cache.ts > 30 * 60_000) part = `${DIM}${part}${RESET}`;
  return row + part;
}

// Intent: one cache name per Codex account, shared with codex-do (grok-engine-lib.ps1 Get-CodexUsageCacheSuffix):
// '' for the main home, else '-' + first 16 hex of SHA-256 (UTF-8) of the account home string.
// Status: K5e (E7). Next: none. Blockers: none. Confidence: cross-language hash test.
function codexCacheSuffix(home, mainHome) {
  return home === mainHome ? '' : '-' + require('crypto').createHash('sha256').update(home).digest('hex').slice(0, 16);
}

// Intent: K5e auto rule, same as codex-do's Get-CodexQuotaState: used = weekly.usedPercent if numeric, else 100 - left;
// grok when used >= threshold AND (resetsAt in the future, or resetsAt missing and dataTs < 24 h old); anything else = codex.
// Status: K5e (E10). Next: none. Blockers: none. Confidence: statusline-engine tests.
function codexAutoGrok(cache, threshold, nowMs = Date.now()) {
  try {
    const weekly = cache && typeof cache === 'object' ? cache.weekly : null;
    if (!weekly || typeof weekly !== 'object') return false;
    const num = v => typeof v === 'number' && Number.isFinite(v);
    const used = num(weekly.usedPercent) ? weekly.usedPercent : num(weekly.left) ? 100 - weekly.left : null;
    if (used == null || !(used >= threshold)) return false;
    const reset = weekly.resetsAt;
    if (reset != null && reset !== '') {
      // U2: a number above 1e11 is already milliseconds (same rule as codex-do's Get-CodexQuotaState).
      const resetMs = num(reset) ? (reset > 1e11 ? reset : reset * 1000) : typeof reset === 'string' ? Date.parse(reset) : NaN;
      return Number.isFinite(resetMs) && resetMs > nowMs;
    }
    const dataMs = typeof cache.dataTs === 'string' && cache.dataTs ? Date.parse(cache.dataTs) : NaN;
    return Number.isFinite(dataMs) && nowMs - dataMs < 24 * 60 * 60_000;
  } catch { return false; }
}

// Intent: show which engine codex-do will use: engine.txt codex|grok = manual (shown even without a cache);
// auto (or missing/invalid file) = 'engine: grok (auto)' only when the auto rule picks grok. CODEX_DO_ENGINE is not shown.
// Status: K5e (E10). Next: host render. Blockers: none. Confidence: statusline-engine tests.
function engineSuffix(engineText, cache, threshold, nowMs = Date.now()) {
  const mode = typeof engineText === 'string' ? engineText.trim().toLowerCase() : '';
  if (mode === 'codex' || mode === 'grok') return `${SEP}${mode === 'grok' ? AMBER : SLATE}engine: ${mode} (manual)${RESET}`;
  return codexAutoGrok(cache, threshold, nowMs) ? `${SEP}${AMBER}engine: grok (auto)${RESET}` : '';
}

if (require.main !== module) {
  PACE = { codexPace1: 1.0, codexPace2: 1.3 };
  module.exports = { codexHome, summarizeRuns, weeklyPace, grokRow, codexCacheSuffix, codexAutoGrok, engineSuffix };
  return;
}
PACE = paceThresholds();

const CODEX_HOME = codexHome();
const CODEX_MAIN_HOME = process.env.CODEX_ACC_MAIN_HOME || path.join(HOME, '.codex');
const CODEX_ACCOUNT = CODEX_HOME === CODEX_MAIN_HOME ? '' : path.basename(CODEX_HOME);
const CACHE = path.join(os.tmpdir(), 'ultrathink-status');
const USAGE_CACHE = path.join(CACHE, 'anthropic-usage.json');
const CODEX_CACHE_SUFFIX = codexCacheSuffix(CODEX_HOME, CODEX_MAIN_HOME);
const CODEX_CACHE = path.join(CACHE, `codex-usage${CODEX_CACHE_SUFFIX}.json`);
const GROK_CACHE = path.join(CACHE, 'grok-usage.json');
const ACC_CACHE = path.join(CACHE, `accounts${CODEX_CACHE_SUFFIX}.json`);
const DISPATCH_TRAIL = process.env.ULTRATHINK_TRAIL_OVERRIDE || path.join(HOME, '.claude', 'state', 'dispatch-trail.log');
try { fs.mkdirSync(CACHE, { recursive: true }); } catch {}

function fresh(file, ttlMs) {
  try { return Date.now() - fs.statSync(file).mtimeMs < ttlMs; } catch { return false; }
}
// 2026-11-18 (claude-swap): an account switch rewrites ~/.claude/.credentials.json; Claude caches older than it are stale.
function freshClaude(file, ttlMs) {
  if (!fresh(file, ttlMs)) return false;
  try { return fs.statSync(file).mtimeMs >= fs.statSync(path.join(HOME, '.claude', '.credentials.json')).mtimeMs; } catch { return true; }
}

// ---------------------------------------------------------------------------
// Background refresh: node statusline-ultrathink.js --refresh
// (a) Anthropic OAuth usage → anthropic-usage.json
// (b) Grok billing usage → grok-usage.json
// (c) Codex rate limits from newest session rollout → codex-usage.json
// ---------------------------------------------------------------------------
if (process.argv.includes('--refresh')) {
  (async () => {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', '.credentials.json'), 'utf8'));
      const token = creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
      if (token) {
        const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(3000),
        });
        const json = await res.json();
        if (json && json.five_hour) fs.writeFileSync(USAGE_CACHE, JSON.stringify(json));
      }
    } catch {}
    // Intent: cache only display fields from Grok billing and preserve good data on API errors.
    // Status: implemented. Next: validate live data on the host. Blockers: none. Confidence: high.
    try {
      const authFile = path.join(process.env.GROK_HOME || path.join(HOME, '.grok'), 'auth.json');
      if (!fs.existsSync(authFile)) {
        fs.writeFileSync(GROK_CACHE, JSON.stringify({ loggedIn: false, ts: Date.now() }));
      } else {
        const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
        const entry = auth && typeof auth === 'object' ? Object.values(auth)[0] : null;
        if (!entry) {
          fs.writeFileSync(GROK_CACHE, JSON.stringify({ loggedIn: false, ts: Date.now() }));
        } else {
          const { key, user_id: userId, email, expires_at: expiresAt } = entry;
          const safeEmail = typeof email === 'string' ? email : '';
          const expiryMs = typeof expiresAt === 'number'
            ? (expiresAt < 1e12 ? expiresAt * 1000 : expiresAt)
            : typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
          if (expiresAt != null && expiresAt !== '' && !(expiryMs > Date.now())) {
            // 2026-11-18: access token lives ~6 h; the grok CLI refreshes it itself on the next run (refresh_token present).
            const refreshable = typeof entry.refresh_token === 'string' && entry.refresh_token.length > 0;
            fs.writeFileSync(GROK_CACHE, JSON.stringify({ email: safeEmail, expired: true, refreshable, ts: Date.now() }));
          } else if (typeof key === 'string' && key && typeof userId === 'string' && userId) {
            const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
              headers: { Authorization: `Bearer ${key}`, 'X-XAI-Token-Auth': 'xai-grok-cli', 'x-userid': userId },
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) throw new Error('Grok billing request failed');
            const config = (await res.json())?.config;
            const usedPercent = config?.creditUsagePercent;
            const period = config?.currentPeriod;
            if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)
              || usedPercent < 0 || usedPercent > 100 || !period
              || typeof period.type !== 'string' || typeof period.end !== 'string'
              || !Number.isFinite(Date.parse(period.end))) {
              throw new Error('Grok billing response missing quota');
            }
            fs.writeFileSync(GROK_CACHE, JSON.stringify({
              email: safeEmail, usedPercent,
              periodType: period.type, periodEnd: period.end,
              prepaid: typeof config.prepaidBalance?.val === 'number' ? config.prepaidBalance.val : null,
              expired: false, ts: Date.now(),
            }));
          }
        }
      }
    } catch {}
    try { refreshCodexUsage(); } catch {}
    // No process.exit() here: exiting while undici tears down its sockets
    // trips a libuv assertion on Windows. Let the event loop drain naturally.
  })();
  return;
}

function allRollouts() {
  const roots = [path.join(CODEX_HOME, 'sessions'), path.join(CODEX_HOME, 'archived_sessions')];
  const out = [];
  const walk = d => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try { out.push({ p, m: fs.statSync(p).mtimeMs }); } catch {}
      }
    }
  };
  roots.forEach(walk);
  return out.sort((a, b) => b.m - a.m);
}

// session_meta (line 1) carries no account id, but it has "originator". The
// Codex DESKTOP app keeps its own login/profile (found running a different
// account than the CLI), so its sessions must not feed the statusline —
// Claude delegates through the CLI, whose account is the one that matters.
function readOriginator(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8', 0, n).match(/"originator":"([^"]+)"/);
    return m ? m[1] : '';
  } catch { return ''; }
}

// Files reach 100+ MB — read only the tail and reverse-scan for the last
// rate_limits event. The first line of a tail chunk may be truncated; its
// JSON.parse failure is silently skipped.
function tailRateLimits(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    for (const chunk of [256 * 1024, 2 * 1024 * 1024]) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        try {
          const obj = JSON.parse(lines[i]);
          const rl = obj.payload && obj.payload.rate_limits;
          if (rl) return { rl, ts: obj.timestamp || null };
        } catch {}
      }
      if (start === 0) break;
    }
  } catch {} finally { try { fs.closeSync(fd); } catch {} }
  return null;
}

function refreshCodexUsage() {
  for (const cand of allRollouts().slice(0, 10)) {
    if (readOriginator(cand.p) === 'Codex Desktop') continue;
    const hit = tailRateLimits(cand.p);
    if (!hit) continue;
    const out = { fiveH: null, weekly: null, planType: hit.rl.plan_type || '', dataTs: hit.ts };
    for (const w of [hit.rl.primary, hit.rl.secondary]) {
      if (!w || w.used_percent == null) continue;
      const slot = w.window_minutes === 300 ? 'fiveH' : w.window_minutes === 10080 ? 'weekly' : null;
      if (slot) out[slot] = { left: Math.max(0, Math.round(100 - w.used_percent)), usedPercent: w.used_percent, resetsAt: w.resets_at || null };
    }
    fs.writeFileSync(CODEX_CACHE, JSON.stringify(out));
    return;
  }
}

// ---------------------------------------------------------------------------
// Render path
// ---------------------------------------------------------------------------

// Read stdin with a readSync loop: readFileSync(0) throws EOF on Windows pipes.
let raw = '';
try {
  const buf = Buffer.alloc(65536);
  let n;
  while ((n = fs.readSync(0, buf, 0, buf.length)) > 0) raw += buf.toString('utf8', 0, n);
} catch {}
let data = {};
try { data = JSON.parse(raw.replace(/^﻿/, '').trim()); } catch {}

const model = String((data.model && data.model.display_name) || '?').replace(/^Claude /, '');
const sid = data.session_id || '';
const usedPct = Math.floor((data.context_window && data.context_window.used_percentage) || 0);
// Feed context thresholds to the prompt hook without interrupting rendering.
try {
  if (sid) {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, `ctx-${sid}.json`), JSON.stringify({ pct: usedPct, ts: Math.floor(Date.now() / 1000), model }));
  }
} catch {}
const ctxLeft = Math.max(0, 100 - usedPct);
const cost = Number((data.cost && data.cost.total_cost_usd) || 0).toFixed(2);
const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();

// kick a background refresh when either cache is stale (never blocks render)
if (!freshClaude(USAGE_CACHE, 60_000) || !fresh(CODEX_CACHE, 60_000) || !fresh(GROK_CACHE, 300_000)) {
  try {
    spawn(process.execPath, [__filename, '--refresh'], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

let claude5hLeft = null, claudeWkLeft = null;
let claudeWkPace = null;
let claudeScopedWeekly = null;
try {
  const u = JSON.parse(fs.readFileSync(USAGE_CACHE, 'utf8'));
  if (u.five_hour && u.five_hour.utilization != null) claude5hLeft = Math.max(0, 100 - Math.floor(u.five_hour.utilization));
  if (u.seven_day && u.seven_day.utilization != null) claudeWkLeft = Math.max(0, 100 - Math.floor(u.seven_day.utilization));
  if (u.seven_day) claudeWkPace = weeklyPace(u.seven_day.utilization, u.seven_day.resets_at);
  const scoped = Array.isArray(u.limits) && u.limits.find(limit =>
    limit && limit.kind === 'weekly_scoped' && limit.scope && limit.scope.model && limit.scope.model.display_name);
  if (scoped && typeof scoped.percent === 'number' && Number.isFinite(scoped.percent)) {
    claudeScopedWeekly = {
      label: String(scoped.scope.model.display_name).toLowerCase(),
      left: Math.max(0, 100 - Math.floor(scoped.percent)),
    };
  }
} catch {}

let codexUsage = null;
try { codexUsage = JSON.parse(fs.readFileSync(CODEX_CACHE, 'utf8')); } catch {}

// accounts (claude + codex emails), cached 10 min; never prints tokens
function loadAccounts() {
  if (freshClaude(ACC_CACHE, 600_000)) {
    try { return JSON.parse(fs.readFileSync(ACC_CACHE, 'utf8')); } catch {}
  }
  const acc = { claude: '', codex: '', codexPlan: '' };
  try {
    const cj = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8'));
    acc.claude = (cj.oauthAccount && cj.oauthAccount.emailAddress) || '';
  } catch {}
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, 'auth.json'), 'utf8'));
    const idToken = auth.tokens && auth.tokens.id_token;
    if (idToken) {
      const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
      acc.codex = claims.email || '';
      const oa = claims['https://api.openai.com/auth'];
      acc.codexPlan = (oa && oa.chatgpt_plan_type) || '';
    }
  } catch {}
  try { fs.writeFileSync(ACC_CACHE, JSON.stringify(acc)); } catch {}
  return acc;
}
const acc = loadAccounts();

// codex model straight from config.toml top-level keys (tiny file, no TOML lib)
function codexModel() {
  const out = { model: '', effort: '', tier: '' };
  try {
    const t = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8');
    const g = re => { const m = t.match(re); return m ? m[1] : ''; };
    out.model = g(/^model\s*=\s*"([^"]+)"/m);
    out.effort = g(/^model_reasoning_effort\s*=\s*"([^"]+)"/m);
    out.tier = g(/^service_tier\s*=\s*"([^"]+)"/m);
  } catch {}
  return out;
}
const cm = codexModel();

function gitBranch(dir) {
  let d = dir;
  for (let i = 0; i < 8; i++) {
    try {
      const head = fs.readFileSync(path.join(d, '.git', 'HEAD'), 'utf8').trim();
      const m = head.match(/^ref: refs\/heads\/(.+)$/);
      return m ? m[1] : head.slice(0, 8);
    } catch {}
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return '';
}
const branch = gitBranch(cwd);

// recent skills / MCP servers from hooks/track-tools.js log (15-min window, max 4)
function recentTools(sessionId) {
  if (!sessionId) return [];
  let lines;
  try {
    lines = fs.readFileSync(path.join(CACHE, `tools-${sessionId}.log`), 'utf8').trim().split('\n');
  } catch { return []; }
  const now = Date.now() / 1000, seen = new Set(), out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < 4; i--) {
    const [ts, kind, name] = lines[i].split('|');
    if (!name || now - Number(ts) > 900) continue;
    const key = `${kind}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, name });
  }
  return out.reverse();
}
const tools = recentTools(sid);

// Intent: session totals survive long runs; missing session keeps the 8h fallback.
// Status: fixture-covered. Next: supervisor review. Blockers: none. Confidence: high.
function recentDispatches(sessionId) {
  let lines;
  try { lines = fs.readFileSync(DISPATCH_TRAIL, 'utf8').trim().split('\n'); }
  catch { return ''; }
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - (8 * 60 * 60);
  const counts = new Map();
  for (const line of lines) {
    const [rawTs, , modelName, effort, trailSessionId] = line.trim().split('|');
    const ts = Number(rawTs.replace(/^\uFEFF/, ''));
    if (!modelName) continue;
    if (sessionId ? trailSessionId !== sessionId : (!Number.isFinite(ts) || ts < cutoff || ts > now)) continue;
    if (!counts.has(modelName)) counts.set(modelName, { total: 0, efforts: new Map() });
    const count = counts.get(modelName);
    count.total++;
    if (effort && effort !== '-') count.efforts.set(effort, (count.efforts.get(effort) || 0) + 1);
  }
  const icons = new Map([['astra', '✦'], ['sol', '☀'], ['luna', '☾'], ['terra', '⊕'], ['codex-rescue', '⟲']]);
  const efforts = new Map([['ultra', 'u'], ['max', 'M'], ['xhigh', 'x'], ['high', 'h'], ['medium', 'm'], ['low', 'l']]);
  return Array.from(counts).sort((a, b) => b[1].total - a[1].total).map(([modelName, count]) => {
    const shortModel = modelName.replace(/^gpt-\d+(?:\.\d+)?-/, '');
    const breakdown = Array.from(efforts, ([effort, letter]) =>
      count.efforts.has(effort) ? `${letter}${count.efforts.get(effort)}` : '').filter(Boolean).join(' ');
    return `${icons.get(shortModel) || shortModel} ${count.total}${breakdown ? ` (${breakdown})` : ''}`;
  }).join(' ');
}
const dispatches = recentDispatches(sid);

// === Line 1: brand · model · context bar · cost ===
// Animated brand: statusline re-renders every few hundred ms while active, so
// picking a frame from wall-clock time yields a shimmer with zero extra cost.
const frame = Math.floor(Date.now() / 200);
const star = ['✦', '✧', '✶', '✧'][frame % 4];
const GRAD = [141, 147, 183, 219, 213, 219, 183, 147]; // lavender→pink wave
const brandText = 'Line Terminal';
let brand = '';
for (let i = 0; i < brandText.length; i++) {
  brand += `\x1b[38;5;${GRAD[(i + frame) % GRAD.length]}m${brandText[i]}`;
}
let l1 = `${BOLD}${LAVENDER}${star} ${brand}${RESET}`;
l1 += `${SEP}${SKY}${model}${RESET}`;
l1 += `${SEP}${SLATE}ctx${RESET} ${bar(ctxLeft)}`;
l1 += `${SEP}${CLOUD}$${cost}${RESET}`;

// === Line 2: claude account + 5h/weekly bars ===
let l2 = `  ${BOLD}${LAVENDER}⚡${RESET} ${PEACH}claude${RESET} ${CLOUD}${acc.claude || 'not logged in'}${RESET}`;
if (claude5hLeft != null) l2 += `${SEP}${SLATE}5h${RESET} ${bar(claude5hLeft)}`;
if (claudeWkLeft != null) l2 += `${SEP}${SLATE}wk${RESET} ${bar(claudeWkLeft)}${paceLabel(claudeWkPace)}`;
if (claudeScopedWeekly) l2 += `${SEP}${SLATE}${claudeScopedWeekly.label} wk${RESET} ${bar(claudeScopedWeekly.left)}`;

// === Line 3: codex account + model + weekly (and 5h when the CLI writes it) ===
let l3 = `  ${BOLD}${LAVENDER}⚡${RESET} ${PEACH}codex${CODEX_ACCOUNT ? ` [${CODEX_ACCOUNT}]` : ''}${RESET} ${CLOUD}${acc.codex || 'not logged in'}${RESET}`;
if (cm.model) {
  let m = `${cm.model}${cm.effort ? ' ' + cm.effort : ''}`;
  if (cm.tier === 'priority') m += ' ⚡fast';
  l3 += `${SEP}${SKY}${m}${RESET}`;
}
if (dispatches) l3 += `${SEP}${SAGE}-> ${dispatches}${RESET}`;
if (codexUsage && (codexUsage.fiveH || codexUsage.weekly)) {
  // rollout data only updates while a Codex turn runs — dim when >30 min old
  const stale = codexUsage.dataTs && Date.now() - Date.parse(codexUsage.dataTs) > 30 * 60_000;
  let part = '';
  if (codexUsage.fiveH) part += `${SEP}${SLATE}5h${RESET} ${bar(codexUsage.fiveH.left)}`;
  if (codexUsage.weekly) {
    part += `${SEP}${SLATE}wk${RESET} ${bar(codexUsage.weekly.left)}`;
    const weekly = codexUsage.weekly;
    const used = weekly.usedPercent ?? (typeof weekly.left === 'number' ? 100 - weekly.left : null);
    part += paceLabel(weeklyPace(used, weekly.resetsAt));
    const r = fmtReset(codexUsage.weekly.resetsAt);
    if (r) part += ` ${SLATE}↻ ${r}${RESET}`;
  }
  l3 += stale ? `${DIM}${part}${RESET}` : part;
}
// Intent: K5e criterion 5 - engine mode after the quota part; never throws, missing files = no suffix. Status: K5e. Next: host render. Blockers: none. Confidence: statusline-engine tests.
try {
  const engineState = process.env.CODEX_DO_STATE_DIR || path.join(HOME, '.claude', 'state');
  let engineText = null;
  try { engineText = fs.readFileSync(path.join(engineState, 'engine.txt'), 'utf8'); } catch {}
  l3 += engineSuffix(engineText, codexUsage, Number.isFinite(PACE.codexUsed3) ? PACE.codexUsed3 : 95);
} catch {}
try {
  const stateDir = process.env.CODEX_DO_STATE_DIR || path.join(HOME, '.claude', 'state');
  const runs = summarizeRuns(stateDir, Date.now());
  const parts = [];
  if (runs.running) parts.push(`${SLATE}\u2699 ${runs.running} run (${runs.oldestRunningMin}m)${RESET}`);
  if (runs.stale) parts.push(`${AMBER}\u26a0 ${runs.stale} stale${RESET}`);
  if (runs.died) parts.push(`${CORAL}\u2716 ${runs.died} died${RESET}`);
  if (parts.length) l3 += `${SEP}${parts.join(' ')}`;
} catch {}

// === Line 3b: Grok account + weekly quota ===
let l3b = '';
try {
  l3b = grokRow(JSON.parse(fs.readFileSync(GROK_CACHE, 'utf8')));
} catch {}

// === Line 4: workspace + branch + recent skills/MCP ===
let l4 = `  ${STEEL}📁 ${path.basename(cwd) || cwd}${RESET}`;
if (branch) l4 += `${SEP}${SAGE}⎇ ${branch}${RESET}`;
for (const t of tools) {
  l4 += t.kind === 'skill'
    ? `${SEP}${SAGE}◇ ${t.name}${RESET}`
    : `${SEP}${STEEL}⚙ ${t.name}${RESET}`;
}

process.stdout.write(`${l1}\n${l2}\n${l3}\n${l3b ? `${l3b}\n` : ''}${l4}\n`);
