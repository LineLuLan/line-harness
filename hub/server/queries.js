/* Intent: turn the private hub DB into small JSON payloads, one per dashboard page.
 * Status: UI v3. Reads daily_* tables for charts; raw tables only for trace, scatter,
 * heatmap, MCP/skill tops, compactions, lead time and run durations (raw rows are kept 90 days).
 * v3 adds: Usage totals / model mix / ranked tops with daily series, quota forecast
 * (linear fit per reset period), anomaly flags (median + 2 x MAD over 28 days),
 * Workers quality (weekly clean rate, repair rounds, lead time), compactions per day.
 * v4 adds: supervisor() (Claude only: hands-on vs delegated work, session weight, review catch
 * by layer, model families), the capability and task-type radars (TASK_TYPES keyword rules),
 * Overview "Needs attention", previous-period KPI deltas and per-source daily totals.
 * v6 (2026-11-14, H6a): the v4 pages come back on schema v8. Quota reads use the v5 quota() (current
 * account only), windowOf(), quotaName(), pace(), paceHistory() and burndown(); forecast() reads the
 * current account only. Kept from v5: system() (System page), actionBox() (one-line "Do this now" on
 * Overview), the delegation metrics (internal; returned as workers().delegation), hookRank() with
 * hook_limits, runTokens() for Trace. The 30 / 70 split card is replaced by quota pace per side.
 * The server opens the DB read-only and never migrates it: newer tables / columns are read only when
 * they exist (hasTable / hasColumn).
 * v6 part 2 (H6b): models() = the Models page (comparison row per model key + detail of one picked key).
 * H8b: modelCompare() separates runs from ledger outcomes; abPairs() matches packet hashes;
 * gates() measures review layers, violations, reviewers and weekly trends. Notes leave the server
 * only for A/B context and gate violations. v8 readers render pairs empty until v9 migration.
 * Next: host validation. Blockers: ledger_runs is still empty; outcome comparisons use ledger.model.
 * Confidence: tests/server.test.js + tests/v7*.test.js + tests/v8.test.js + headless Edge screenshots. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { day } = require('../collector/values');
const { aliasModel, failRounds, stopFlag } = require('../collector/ledger');

const hasColumn = (db, table, column) => Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name=?`).get(column));
const hasTable = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));

const DAY = 86400;
const RANGES = [1, 7, 14, 30, 90, 365];

// Calendar arithmetic (not 86400 s steps) so DST changes never skip or repeat a day.
function dayList(n, now) {
  const t = new Date(now * 1000);
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i);
    list.push(day(Math.floor(d.getTime() / 1000)));
  }
  const startTs = Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1)).getTime() / 1000);
  return { startDay: list[0], startTs, list };
}
function range(days, now = Math.floor(Date.now() / 1000)) {
  const n = RANGES.includes(days) ? days : 14;
  return { days: n, ...dayList(n, now), now, today: day(now) };
}

const median = values => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
// Unrounded median for small counts (anomaly rule): median([0, 1]) is 0.5, not 1.
const exactMedian = values => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round1 = v => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const round2 = v => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const stamp = ts => new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const bytesText = b => (b >= 1e12 ? `${round1(b / 1e12)} TB` : b >= 1e9 ? `${round1(b / 1e9)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`);

// Anomaly rule: today > median + 2 x MAD of the history (MAD = median absolute deviation).
// MAD = 0 (a flat history): today > 2 x median and today > 0. Under 7 history days: no flag.
function anomaly(history, today) {
  const n = history.length;
  if (n < 7) return { flag: false, today, n, median: null, mad: null, threshold: null, rule: 'needs 7 days of history' };
  const med = exactMedian(history), mad = exactMedian(history.map(x => Math.abs(x - med)));
  const threshold = mad > 0 ? med + 2 * mad : med * 2;
  const flag = mad > 0 ? today > threshold : today > threshold && today > 0;
  return { flag, today, n, median: round1(med), mad: round1(mad), threshold: round1(threshold),
    rule: mad > 0 ? 'today > median + 2 x MAD' : 'MAD = 0: today > 2 x median and > 0' };
}
// The 28 local days before today, limited to days since the collector's first data.
function history(db, r) {
  const h = dayList(29, r.now);
  const first = db.prepare('SELECT MIN(d) d FROM (SELECT MIN(day) d FROM daily_tokens UNION ALL SELECT MIN(day) FROM daily_runs UNION ALL SELECT MIN(day) FROM daily_hooks)').get()?.d;
  const past = h.list.slice(0, -1).filter(d => first && d >= first);
  return { startDay: h.startDay, list: h.list, past, today: r.today };
}
// metrics: { key: [rows, pick] } over the history window; returns { key: anomaly }.
function anomalies(h, metrics) {
  const out = {};
  for (const [key, [rows, pick]] of Object.entries(metrics)) {
    const map = new Map();
    for (const row of rows) map.set(row.day, (map.get(row.day) || 0) + pick(row));
    out[key] = anomaly(h.past.map(d => map.get(d) || 0), map.get(h.today) || 0);
  }
  return out;
}

// Least-squares line through (ts, used_pct). Returns null under 2 distinct times.
function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.ts, 0) / n, my = points.reduce((a, p) => a + p.used_pct, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.ts - mx) ** 2; sxy += (p.ts - mx) * (p.used_pct - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, at: ts => my + slope * (ts - mx) };
}
// Keep at most `cap` points, always the first and the last.
function thin(list, cap) {
  if (list.length <= cap) return list;
  const step = (list.length - 1) / (cap - 1);
  return Array.from({ length: cap }, (_, i) => list[Math.round(i * step)]);
}
// One forecast per window, from the snapshots of its current reset period (same resets_at,
// 5 min tolerance for rounding). Expired periods and periods with < 2 points get no projection.
// quota_snapshots is UNIQUE(source,window,resets_at,used_pct): a plateau writes no new rows.
// So the fit gets one synthetic point (now, last used_pct) when now is inside the period, and
// the projection starts at now from the actual last value: idle time is never counted as usage.
// That plateau is only trusted while the collector is running: when its last run (meta
// last_run_end) is over an hour old, "no new row" may mean "not collected", so nothing is
// extrapolated and the payload says how stale the data is.
const COLLECTOR_FRESH_SECS = 3600;
function forecast(db, now) {
  const lastRun = Number(db.prepare("SELECT value FROM meta WHERE key='last_run_end'").get()?.value) || null;
  const collectorFresh = lastRun !== null && now - lastRun <= COLLECTOR_FRESH_SECS;
  // v6: only the current account of each source (quota() filters it; q.key carries its ids).
  return quota(db, now).map(q => {
    const base = { source: q.source, window: q.window, account: q.account, name: quotaName(q), resets_at: q.resets_at, used_pct: q.used_pct, expired: q.expired,
      collectorLastRun: lastRun, stale: !collectorFresh, atLimit: q.used_pct >= 100 };
    if (q.expired) return { ...base, n: 0, points: [], enough: false };
    const points = db.prepare(`SELECT ts, used_pct FROM quota_snapshots WHERE ${keyWhere(q)} AND resets_at BETWEEN ? AND ? ORDER BY ts, used_pct`)
      .all(...q.key, q.resets_at - 300, q.resets_at + 300);
    const last = points.at(-1);
    const shown = thin(points, 150);
    const idleHours = last && now > last.ts ? round1((Math.min(now, q.resets_at) - last.ts) / 3600) : 0;
    if (points.length < 2) return { ...base, n: points.length, points: shown, enough: false, idleHours };
    const synthetic = collectorFresh && now > last.ts && now < q.resets_at;
    const fit = fitLine(synthetic ? [...points, { ts: now, used_pct: last.used_pct }] : points);
    if (!fit) return { ...base, n: points.length, points: shown, enough: false, idleHours };
    const anchor = { ts: synthetic ? now : last.ts, pct: last.used_pct };
    const raw = anchor.pct + fit.slope * (q.resets_at - anchor.ts);
    let hit100 = null;
    if (anchor.pct >= 100) hit100 = Math.max(now, anchor.ts);
    else if (fit.slope > 0) { const t = anchor.ts + (100 - anchor.pct) / fit.slope; if (t <= q.resets_at) hit100 = Math.round(Math.max(t, now)); }
    return { ...base, n: points.length, points: shown, enough: true, synthetic, idleHours,
      slopePerHour: Math.round(fit.slope * 3600 * 1e4) / 1e4,
      fitStart: { ts: points[0].ts, pct: round1(fit.at(points[0].ts)) }, fitEnd: { ts: anchor.ts, pct: round1(fit.at(anchor.ts)) },
      anchor, projectedRaw: round1(raw), projectedAtReset: round1(Math.max(0, Math.min(100, raw))), overflow: raw > 100, hit100At: hit100 };
  });
}

// Monday-start week key (local) for a YYYY-MM-DD day.
function weekOf(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(y, m - 1, dd - ((new Date(y, m - 1, dd).getDay() + 6) % 7));
  return day(Math.floor(t.getTime() / 1000));
}

// Ledger tiers carry free text after the tier word ("Standard (fix of ...)").
function tierOf(text) {
  const m = /^(Skip|Standard-A|Standard-B|Standard|Important|Critical|Exploration)/i.exec(text || '');
  if (!m) return 'Other';
  const t = m[1].toLowerCase();
  return { skip: 'Skip', 'standard-a': 'Standard-A', 'standard-b': 'Standard-B', standard: 'Standard',
    important: 'Important', critical: 'Critical', exploration: 'Exploration' }[t];
}
// One layer is clean when it found nothing: count 0, or a word such as PASS / n/a.
function layerClean(raw, count) {
  if (count !== null && count !== undefined) return count === 0;
  const text = String(raw || '').trim();
  if (failRounds(text) > 0) return false;
  return text === '' || text === '-' || /^(PASS|n\/?a|none|skip|ok|no FAIL)\b/i.test(text);
}
/* Ledger rows from r.startDay (and before r.endDay when given). FAIL rounds: the collector's
 * failRounds() (FAIL x2 = 2, negations and fail-open words = 0); v7 stores fail_rounds per line.
 * A task is clean ("first-pass clean") when every layer found nothing AND it had no FAIL round.
 * layer = the first layer that found something; a FAIL round with no finding in any cell
 * (fail_rounds= only) counts as caught at L2, the review verdict layer.
 * stop = the note names a worker STOP (v8 column; before the migration the stored note is read).
 * withText adds the tier + note text for the task-type classifier only; it never leaves the server. */
function ledgerRows(db, r, withText = false, withOutcome = false) {
  const v7 = hasColumn(db, 'ledger', 'fail_rounds'), v8 = hasColumn(db, 'ledger', 'stop');
  return db.prepare(`SELECT l.id, l.day, t.name tier, l.layer2, l.l1_raw, l.l2_raw, l.l3_raw, l.l1_count, l.l2_count, l.l3_count,
      m.name model, l.note, ${v7 ? 'l.fail_rounds' : 'NULL fail_rounds'}, ${v8 ? 'l.stop' : 'NULL stop'}
      FROM ledger l LEFT JOIN names t ON t.id=l.tier LEFT JOIN names m ON m.id=l.model WHERE l.day>=? AND l.day<?`)
    .all(r.startDay, r.endDay || '9999').map(row => {
      const findings = [row.l1_count, row.l2_count, row.l3_count].reduce((a, b) => a + (b || 0), 0);
      const layers = [['L1', row.l1_raw, row.l1_count], ['L2', row.l2_raw, row.l2_count], ['L3', row.l3_raw, row.l3_count]];
      const dirty = layers.find(([, raw, count]) => !layerClean(raw, count));
      const fails = row.fail_rounds ?? layers.reduce((a, [, raw]) => a + failRounds(raw), 0);
      const clean = !dirty && fails === 0;
      return { id: row.id, day: row.day, tier: tierOf(row.tier), layer2: row.layer2 === 1, model: aliasModel(row.model) || 'unknown',
        clean, layer: dirty ? dirty[0] : clean ? null : 'L2', fail: fails > 0, failRounds: fails,
        stop: row.stop === null || row.stop === undefined ? stopFlag(row.note) === 1 : row.stop === 1,
        l1: row.l1_count, l2: row.l2_count, l3: row.l3_count, findings, ...(withText ? { text: `${row.tier || ''} ${row.note || ''}` } : {}),
        ...(withOutcome ? { recordedFailRounds: row.fail_rounds, l2Raw: row.l2_raw, note: row.note } : {}) };
    });
}
function summarizeLedger(rows) {
  const tasks = rows.length, clean = rows.filter(x => x.clean).length;
  return { tasks, clean, cleanPct: tasks ? Math.round((clean / tasks) * 1000) / 10 : null,
    avgFindings: tasks ? Math.round((rows.reduce((a, x) => a + x.findings, 0) / tasks) * 10) / 10 : null,
    layer2Pct: tasks ? Math.round((rows.filter(x => x.layer2).length / tasks) * 1000) / 10 : null };
}
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) { const k = typeof key === 'function' ? key(row) : row[key] ?? '-'; if (!map.has(k)) map.set(k, []); map.get(k).push(row); }
  return map;
}
const cleanPct = rows => pctOf(rows.filter(x => x.clean).length, rows.length);

/* ---------- quota and pace (v5) ---------- */
// Latest snapshot per window in one pass (quota_snapshots has no retention and grows); only the CURRENT
// account of each source. A tie on ts keeps the higher used_pct.
/* H7 (2026-11-14): Codex current account = meta codex_active_account (the collector copies it from
 * codex-acc.ps1 <accounts>/active) when that account has snapshots; else the account of the source's
 * newest snapshot (no signal, or a just-added account with no rollout yet). Before H7 the newest snapshot
 * always won, so after `codex-acc.ps1 use acc2` the hub kept showing the previous account.
 * Status: done. Next: none. Blockers: the signal refreshes only when the collector runs (hook, 2 min floor).
 * Confidence: tests/h7-current-account.test.js + real DB check. */
function activeCodexAccount(db) {
  if (!hasTable(db, 'meta')) return null;
  return db.prepare("SELECT value FROM meta WHERE key='codex_active_account'").get()?.value ?? null;
}
const keyWhere = q => (q.key.length === 3 ? 'source=? AND window=? AND account=?' : 'source=? AND window=?');
function quota(db, now) {
  const split = hasColumn(db, 'quota_snapshots', 'account'), win = hasColumn(db, 'quota_snapshots', 'window_secs');
  const rows = db.prepare(`SELECT s.name source, w.name window, ${split ? 'a.name' : 'NULL'} account, q.source sid, q.window wid,
        ${split ? 'q.account' : '0'} aid, q.used_pct, q.resets_at, q.ts, ${win ? 'q.window_secs' : 'NULL'} window_secs FROM (
        SELECT source, window, ${split ? 'account' : '0 account'}, used_pct, resets_at, ts${win ? ', window_secs' : ''},
          ROW_NUMBER() OVER (PARTITION BY source, window${split ? ', account' : ''} ORDER BY ts DESC, used_pct DESC) rn FROM quota_snapshots) q
      JOIN names s ON s.id=q.source JOIN names w ON w.id=q.window ${split ? 'LEFT JOIN names a ON a.id=q.account' : ''} WHERE q.rn=1`).all();
  const current = new Map();
  for (const x of rows) { const c = current.get(x.source); if (!c || x.ts > c.ts) current.set(x.source, x); }
  const active = split ? activeCodexAccount(db) : null;
  const pinned = active === null ? null : rows.find(x => x.source === 'codex' && x.account === active);
  if (pinned) current.set('codex', pinned);
  const where = split ? 'source=? AND window=? AND account=?' : 'source=? AND window=?';
  return rows.filter(x => x.aid === current.get(x.source).aid).map(({ sid, wid, aid, ...x }) => {
    const key = split ? [sid, wid, aid] : [sid, wid];
    return Object.defineProperty({ ...x, ...windowOf(db, x, key, where, win), expired: x.resets_at <= now }, 'key', { value: key, enumerable: false });
  });
}
/* Window length of a quota row:
 *   1. window_secs on the newest snapshot (v8: Codex window_minutes x 60, Claude by name);
 *   2. Claude by name (five_hour = 5 h, seven_day = 7 d);
 *   3. window_secs on any older snapshot of the same source / window / account;
 *   4. from the reset times: the smallest standard length (5 h, 1 d, 7 d, 30 d) that covers the longest
 *      span between a period's first snapshot and its resets_at;
 *   5. unknown (null): no pace, never a guess. */
const CLAUDE_WINDOW_SECS = { five_hour: 5 * 3600, seven_day: 7 * DAY };
const STANDARD_WINDOWS = [5 * 3600, DAY, 7 * DAY, 30 * DAY];
function windowOf(db, q, key, where, win) {
  if (Number.isFinite(q.window_secs) && q.window_secs > 0) return { window_secs: q.window_secs, windowFrom: 'snapshot' };
  if (q.source === 'claude' && CLAUDE_WINDOW_SECS[q.window]) return { window_secs: CLAUDE_WINDOW_SECS[q.window], windowFrom: 'name' };
  const known = win ? db.prepare(`SELECT window_secs s FROM quota_snapshots WHERE ${where} AND window_secs>0 ORDER BY ts DESC LIMIT 1`).get(...key) : null;
  if (known) return { window_secs: known.s, windowFrom: 'snapshot' };
  // resets_at jitters by a few seconds between snapshots of one period: periods are grouped to 5 minutes.
  const span = db.prepare(`SELECT MAX(r - a) span FROM (SELECT MAX(resets_at) r, MIN(ts) a FROM quota_snapshots WHERE ${where} GROUP BY resets_at/300)`).get(...key)?.span;
  const fit = span > 0 ? STANDARD_WINDOWS.find(s => s >= span * 0.99) : null;
  return fit ? { window_secs: fit, windowFrom: 'reset times' } : { window_secs: null, windowFrom: null };
}
const windowSecs = q => (Number.isFinite(q.window_secs) && q.window_secs > 0 ? q.window_secs : q.source === 'claude' ? CLAUDE_WINDOW_SECS[q.window] ?? null : null);
function quotaName(q) {
  const len = windowSecs(q);
  const span = len === null ? q.window : len >= DAY ? `${Math.round(len / DAY)}-day` : `${Math.round(len / 3600)}-hour`;
  return `${q.source === 'codex' ? 'Codex' : 'Claude'} ${span}${q.account && q.account !== 'default' ? ` (${q.account})` : ''}`;
}
/* pace = used % / elapsed % of the window. 1.0 = spending exactly at the even rate; 2.0 = twice as fast.
 * early = under 5 % of the window gone. At or after the reset the window is expired and has no pace.
 * An unknown window length gives no pace. */
const PACE_FORMULA = 'pace = used % / elapsed % of the window (1.0 = even spending; above 1 = faster than time)';
const EARLY_PCT = 5;
function pace(q, at) {
  const len = windowSecs(q);
  const base = { usedPct: round1(q.used_pct), leftPct: round1(Math.max(0, 100 - q.used_pct)), windowSecs: len, resetsAt: q.resets_at,
    hoursLeft: round1(Math.max(0, q.resets_at - at) / 3600) };
  if (at >= q.resets_at) return { ...base, expired: true, elapsedPct: len ? 100 : null, pace: null, early: false };
  if (!len) return { ...base, expired: false, elapsedPct: null, pace: null, early: false, unknownWindow: true };
  const elapsedPct = Math.max(0, Math.min(100, (at - (q.resets_at - len)) / len * 100));
  return { ...base, expired: false, elapsedPct: round1(elapsedPct), pace: elapsedPct > 0 ? round2(q.used_pct / elapsedPct) : null,
    early: elapsedPct < EARLY_PCT };
}
// Pace at the last snapshot of each of the `n` local days up to now. null on a day with no snapshot, and
// null when that snapshot is early in its window (under EARLY_PCT gone: the same rule as FIRES.a), where
// a tiny elapsed share makes the ratio explode (6.95x on Line's machine right after a reset).
function paceHistory(db, q, now, n = 14) {
  const d = dayList(n, now);
  const win = hasColumn(db, 'quota_snapshots', 'window_secs');
  const last = new Map();
  for (const x of db.prepare(`SELECT ts, used_pct, resets_at${win ? ', window_secs' : ''} FROM quota_snapshots WHERE ${keyWhere(q)} AND ts>=? AND ts<=? ORDER BY ts, used_pct`)
    .all(...q.key, d.startTs, now)) last.set(day(x.ts), x);
  return d.list.map(dd => {
    const x = last.get(dd);
    if (!x) return null;
    const p = pace({ ...x, source: q.source, window: q.window, window_secs: x.window_secs || q.window_secs }, x.ts);
    return p.early ? null : p.pace;
  });
}
/* Used % over the current window next to the even-pace line (ideal = 100 x elapsed share of the window at
 * the end of each step): one step per local day for windows of 2 days or more, one per hour otherwise. */
function burndown(db, q, now) {
  if (!q || q.expired) return null;
  const len = windowSecs(q);
  if (!len) return null;
  const start = q.resets_at - len, hourly = len < 2 * DAY;
  const steps = [];
  if (hourly) {
    for (let t = Math.floor(start / 3600) * 3600; t < q.resets_at; t += 3600) steps.push({ from: t, to: t + 3600 });
  } else {
    for (let t = new Date(start * 1000); Math.floor(t.getTime() / 1000) < q.resets_at; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      const from = Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 1000);
      steps.push({ from, to: Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime() / 1000) });
    }
  }
  const snaps = db.prepare(`SELECT ts, used_pct u FROM quota_snapshots WHERE ${keyWhere(q)} AND resets_at BETWEEN ? AND ? AND ts<=?`)
    .all(...q.key, q.resets_at - 300, q.resets_at + 300, now);
  const label = s => (hourly ? new Date(s.from * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : day(s.from));
  return { name: quotaName(q), source: q.source, unit: hourly ? 'hour' : 'day', days: steps.map(label),
    ideal: steps.map(s => round1(Math.max(0, Math.min(100, (s.to - start) / len * 100)))),
    used: steps.map(s => { if (s.from > now) return null; const u = snaps.filter(x => x.ts >= s.from && x.ts < s.to).map(x => x.u); return u.length ? round1(Math.max(...u)) : null; }) };
}
// Live windows with their pace (actionBox input).
function liveQuotas(db, now) {
  return quota(db, now).filter(q => !q.expired).map(q => ({ name: quotaName(q), source: q.source, window: q.window, account: q.account, windowFrom: q.windowFrom, ...pace(q, now) }));
}
// The payload form of a quota row: v4 fields plus its name and pace.
const quotaRow = (q, now) => ({ ...q, name: quotaName(q), ...pace(q, now) });
// Finished runs only: a still-running run (exit NULL) is neither a pass nor a fail.
const finished = x => x.exit0 + x.exit72 + x.exit73 + x.other_fail;
function meta(db) {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM meta').all()) out[key] = value;
  return out;
}
// Codex input_tokens already include cached_input_tokens (verified on real data:
// total_tokens = input + output). Show fresh input only, so every source adds up the same way.
const FRESH_INPUT = "SUM(CASE WHEN s.name='codex' THEN max(input-cache_read,0) ELSE input END)";
function tokensByDay(db, r) {
  return db.prepare(`SELECT t.day, s.name source, ${FRESH_INPUT} input, SUM(output) output, SUM(cache_read) cache_read,
      SUM(cache_write) cache_write, SUM(reasoning) reasoning, SUM(messages) messages FROM daily_tokens t
      JOIN names s ON s.id=t.source WHERE t.day>=? GROUP BY t.day, t.source ORDER BY t.day`).all(r.startDay);
}
function runsByDay(db, r) {
  return db.prepare(`SELECT day, SUM(runs) runs, SUM(exit0) exit0, SUM(exit72) exit72, SUM(exit73) exit73,
      SUM(other_fail) other_fail, SUM(resumes) resumes FROM daily_runs WHERE day>=? GROUP BY day ORDER BY day`).all(r.startDay);
}
// Align sparse rows onto the full day list so charts share one x axis.
function series(r, rows, pick, filter = () => true) {
  const map = new Map();
  for (const row of rows) if (filter(row)) map.set(row.day, (map.get(row.day) || 0) + pick(row));
  return r.list.map(d => map.get(d) || 0);
}
const total = x => x.input + x.output + x.cache_read + x.cache_write;

// The equal-length period just before the range (for KPI deltas). Rows are read from its start
// and filtered to day < r.startDay by the caller.
function previous(r) {
  const p = dayList(2 * r.days, r.now);
  return { startDay: p.startDay, startTs: p.startTs, list: p.list.slice(0, r.days), now: r.now, today: r.today };
}
const exit0Pct = rows => { const n = rows.reduce((a, x) => a + finished(x), 0); return n ? round1(rows.reduce((a, x) => a + x.exit0, 0) / n * 100) : null; };
const sourceTotal = (rows, source) => rows.filter(x => x.source === source).reduce((a, x) => a + total(x), 0);

// Overview "Needs attention": structured items; the page writes the sentences.
const STALE_COLLECTOR_SECS = 6 * 3600;
function attention(db, r, flags, fc, ledger) {
  const items = [];
  for (const [key, label] of [['tokensToday', 'Tokens today'], ['runsToday', 'Worker runs today']]) {
    const a = flags[key];
    if (a?.flag) items.push({ kind: 'anomaly', level: 'warn', label, today: a.today, threshold: a.threshold, median: a.median });
  }
  for (const f of fc) {
    if (f.expired) continue;
    if (f.atLimit) items.push({ kind: 'quota-full', level: 'bad', source: f.source, window: f.window, name: f.name, resets_at: f.resets_at });
    else if (f.hit100At) items.push({ kind: 'quota', level: 'bad', source: f.source, window: f.window, name: f.name, hit100At: f.hit100At, resets_at: f.resets_at });
  }
  const failed = db.prepare('SELECT COUNT(*) n FROM runs WHERE started>=? AND ended IS NOT NULL AND (exit_code IS NULL OR exit_code<>0)').get(r.startTs).n;
  if (failed) items.push({ kind: 'failed', level: 'bad', n: failed });
  // Lost = no exit code 2 days after the start, whenever it started (a 24h range could never show one otherwise).
  const lost = db.prepare('SELECT COUNT(*) n FROM runs WHERE ended IS NULL AND started<?').get(r.now - 2 * DAY).n;
  if (lost) items.push({ kind: 'lost', level: 'warn', n: lost });
  const reviewFails = db.prepare("SELECT COUNT(*) n FROM reviews x JOIN names v ON v.id=x.verdict WHERE x.ts>=? AND v.name='FAIL'").get(r.startTs).n;
  if (reviewFails) items.push({ kind: 'review-fail', level: 'warn', n: reviewFails });
  const ledgerFails = ledger.filter(x => x.fail).length;
  if (ledgerFails) items.push({ kind: 'ledger-fail', level: 'warn', n: ledgerFails, rounds: ledger.reduce((a, x) => a + x.failRounds, 0) });
  const lastRun = Number(db.prepare("SELECT value FROM meta WHERE key='last_run_end'").get()?.value) || null;
  if (lastRun === null || r.now - lastRun > STALE_COLLECTOR_SECS) items.push({ kind: 'collector', level: 'warn', lastRun, hours: lastRun === null ? null : round1((r.now - lastRun) / 3600) });
  return items;
}

function overview(db, r) {
  const tokens = tokensByDay(db, r), runs = runsByDay(db, r), ledger = ledgerRows(db, r);
  const p = previous(r), before = x => x.day < r.startDay;
  const prevTokens = tokensByDay(db, p).filter(before), prevRuns = runsByDay(db, p).filter(before), prevLedger = ledgerRows(db, p).filter(before);
  const today = tokens.filter(x => x.day === r.today);
  const runsToday = runs.find(x => x.day === r.today);
  const active = db.prepare('SELECT COUNT(*) n FROM runs WHERE ended IS NULL AND started>?').get(r.now - 2 * DAY).n;
  const fc = forecast(db, r.now);
  const flags = (() => {
    const h = history(db, r);
    return anomalies(h, { tokensToday: [tokensByDay(db, h), total], runsToday: [runsByDay(db, h), x => x.runs] });
  })();
  const axes = capability(db, r, tokens, ledger);
  return {
    kpi: {
      tokensToday: today.reduce((a, x) => a + total(x), 0),
      outputToday: today.reduce((a, x) => a + x.output, 0),
      claudeToday: sourceTotal(today, 'claude'), codexToday: sourceTotal(today, 'codex'),
      claudeRange: sourceTotal(tokens, 'claude'), codexRange: sourceTotal(tokens, 'codex'),
      runsToday: runsToday?.runs || 0,
      activeRuns: active,
      tasks: summarizeLedger(ledger),
      runsRange: runs.reduce((a, x) => a + x.runs, 0),
      exit0Pct: exit0Pct(runs),
      prev: { tokens: prevTokens.reduce((a, x) => a + total(x), 0), runs: prevRuns.reduce((a, x) => a + x.runs, 0),
        exit0Pct: exit0Pct(prevRuns), cleanPct: summarizeLedger(prevLedger).cleanPct, tasks: prevLedger.length }
    },
    quota: quota(db, r.now).map(q => quotaRow(q, r.now)),
    forecast: fc,
    // H8a: usage card + routing card (Overview top).
    usage: usage(db, r.now, fc),
    route: routeAdvice(routeInputOf(liveQuotas(db, r.now))),
    ontologyStatus,
    anomaly: flags,
    ...doThisNow(db, r.now),
    attention: attention(db, r, flags, fc, ledger),
    calendar: yearCalendar(db, r.now),
    chart: {
      days: r.list,
      claude: series(r, tokens, x => x.output, x => x.source === 'claude'),
      codex: series(r, tokens, x => x.output, x => x.source === 'codex'),
      claudeAll: series(r, tokens, total, x => x.source === 'claude'),
      codexAll: series(r, tokens, total, x => x.source === 'codex'),
      runs: series(r, runs, x => x.runs),
      tasks: series(r, ledger, () => 1)
    },
    radar: { axes, notes: capabilityNotes(axes) }
  };
}

function workers(db, r) {
  const models = db.prepare(`SELECT m.name model, SUM(runs) runs, SUM(exit0) exit0, SUM(exit72) exit72, SUM(exit73) exit73,
      SUM(other_fail) other_fail, SUM(resumes) resumes FROM daily_runs d JOIN names m ON m.id=d.model
      WHERE day>=? GROUP BY d.model ORDER BY runs DESC`).all(r.startDay);
  const durations = groupBy(db.prepare(`SELECT m.name model, ended-started secs FROM runs x JOIN names m ON m.id=x.model
      WHERE x.day>=? AND ended IS NOT NULL AND ended>=started`).all(r.startDay), 'model');
  for (const row of models) {
    row.medianSecs = median((durations.get(row.model) || []).map(x => x.secs));
    row.finished = finished(row);
  }
  const ledger = ledgerRows(db, r);
  const order = ['Critical', 'Important', 'Standard-B', 'Standard-A', 'Standard', 'Skip', 'Exploration', 'Other'];
  const tiers = [...groupBy(ledger, 'tier')].map(([tier, rows]) => ({ tier, ...summarizeLedger(rows),
    avgL2: avg(rows.map(x => x.l2)), avgL3: avg(rows.map(x => x.l3)) }))
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  const byModel = [...groupBy(ledger, 'model')].map(([model, rows]) => ({ model, ...summarizeLedger(rows) }))
    .sort((a, b) => b.tasks - a.tasks).slice(0, 12);
  const reviews = db.prepare(`SELECT v.name verdict, m.name model, COUNT(*) n, SUM(p0) p0, SUM(p1) p1, SUM(p2) p2, SUM(p3) p3
      FROM reviews x JOIN names v ON v.id=x.verdict LEFT JOIN names m ON m.id=x.model WHERE ts>=? GROUP BY x.verdict, x.model`).all(r.startTs);
  return { models, tiers, byModel, reviews, quality: quality(db, r, ledger, order), delegation: delegation(db, r) };
}

const LEAD_BUCKETS = [[15, '< 15m'], [30, '15-30m'], [60, '30-60m'], [120, '1-2h'], [240, '2-4h'], [Infinity, '> 4h']];
// Workers > Quality: weekly first-pass clean rate by tier, repair rounds (resumes), lead time.
function quality(db, r, ledger, order) {
  const weeks = [...new Set(r.list.map(weekOf))];
  const tierNames = [...new Set(ledger.map(x => x.tier))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const cell = rows => ({ clean: rows.filter(x => x.clean).length, dirty: rows.filter(x => !x.clean).length });
  const byWeek = groupBy(ledger.map(x => ({ ...x, week: weekOf(x.day) })), 'week');
  const clean = {
    weeks,
    all: weeks.map(w => cell(byWeek.get(w) || [])),
    tiers: tierNames.map(tier => ({ tier, cells: weeks.map(w => cell((byWeek.get(w) || []).filter(x => x.tier === tier))) }))
  };
  const runWeeks = new Map(weeks.map(w => [w, { week: w, runs: 0, resumes: 0 }]));
  for (const row of runsByDay(db, r)) { const w = runWeeks.get(weekOf(row.day)); if (w) { w.runs += row.runs; w.resumes += row.resumes; } }
  const repair = [...runWeeks.values()].map(w => ({ ...w,
    perRun: w.runs - w.resumes > 0 ? Math.round(w.resumes / (w.runs - w.resumes) * 100) / 100 : null,
    sharePct: w.runs ? round1(w.resumes / w.runs * 100) : null }));
  // Lead time: a review (reviews.jsonl) belongs to the Claude session of the latest run in the
  // same repo that started at most one day before it; lead = last review - first run of that
  // session in that repo. Reviews carry no session id, so this link is by repo and time.
  const runs = db.prepare(`SELECT x.claude_session_id sid, x.project, x.started FROM runs x
      WHERE x.started>=? AND x.claude_session_id IS NOT NULL AND x.project IS NOT NULL ORDER BY x.started`).all(r.startTs - DAY);
  const first = new Map();
  for (const run of runs) { const k = `${run.sid}|${run.project}`; if (!first.has(k)) first.set(k, run.started); }
  const last = new Map();
  for (const rv of db.prepare('SELECT ts, project FROM reviews WHERE ts>=? AND project IS NOT NULL').all(r.startTs)) {
    let best = null;
    for (const run of runs) if (run.project === rv.project && run.started <= rv.ts && rv.ts - run.started <= DAY) best = run;
    if (!best) continue;
    const k = `${best.sid}|${best.project}`;
    last.set(k, Math.max(last.get(k) || 0, rv.ts));
  }
  const points = [...last].map(([k, ts]) => ({ ts, minutes: round1((ts - first.get(k)) / 60) })).sort((a, b) => a.ts - b.ts);
  const mins = points.map(p => p.minutes).sort((a, b) => a - b);
  const lead = { n: points.length, enough: points.length >= 5,
    medianMin: points.length >= 5 ? round1(exactMedian(mins)) : null,
    p90Min: points.length >= 5 ? mins[Math.min(mins.length - 1, Math.ceil(0.9 * mins.length) - 1)] : null,
    // Histogram over every point, so it always agrees with n / median / p90.
    buckets: LEAD_BUCKETS.map(([max, label], i) => ({ label, n: mins.filter(v => v < max && (i === 0 || v >= LEAD_BUCKETS[i - 1][0])).length })),
    points: points.slice(-100) };
  return { clean, repair, lead };
}
function avg(values) {
  const v = values.filter(x => x !== null && x !== undefined);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
}

function cost(db, r) {
  const tokens = tokensByDay(db, r);
  const pick = (source, field) => series(r, tokens, x => x[field], x => x.source === source);
  const models = db.prepare(`SELECT s.name source, m.name model, ${FRESH_INPUT} input, SUM(output) output, SUM(cache_read) cache_read,
      SUM(cache_write) cache_write, SUM(reasoning) reasoning, SUM(messages) messages FROM daily_tokens t
      JOIN names s ON s.id=t.source JOIN names m ON m.id=t.model WHERE day>=? GROUP BY t.source, t.model`).all(r.startDay)
    .map(x => ({ ...x, total: total(x) })).sort((a, b) => b.total - a.total);
  const cache = {};
  for (const source of ['claude', 'codex']) {
    const rows = tokens.filter(x => x.source === source);
    const read = rows.reduce((a, x) => a + x.cache_read, 0);
    const all = rows.reduce((a, x) => a + x.input + x.cache_read + x.cache_write, 0);
    cache[source] = all ? Math.round(read / all * 1000) / 10 : null;
  }
  // Highest used % per local day and window (and account): the chart needs nothing finer. Names come
  // from quotaName(): the current windows carry their resolved length, older accounts their stored one.
  const q = quota(db, r.now);
  const split = hasColumn(db, 'quota_snapshots', 'account'), win = hasColumn(db, 'quota_snapshots', 'window_secs');
  const named = new Map(q.map(x => [x.key.join('|'), quotaName(x)]));
  const quotaLine = db.prepare(`SELECT date(q.ts, 'unixepoch', 'localtime') day, s.name source, w.name window, q.source sid, q.window wid,
      ${split ? 'q.account aid, a.name account' : '0 aid, NULL account'}, ${win ? 'MAX(q.window_secs)' : 'NULL'} window_secs, MAX(q.used_pct) used_pct
      FROM quota_snapshots q JOIN names s ON s.id=q.source JOIN names w ON w.id=q.window ${split ? 'LEFT JOIN names a ON a.id=q.account' : ''}
      WHERE q.ts>=? GROUP BY 1, q.source, q.window${split ? ', q.account' : ''} ORDER BY 1`).all(r.startTs)
    .map(({ sid, wid, aid, window_secs, ...x }) => {
      const key = (split ? [sid, wid, aid] : [sid, wid]).join('|');
      return { day: x.day, source: x.source, key, name: named.get(key) || quotaName({ ...x, window_secs }), used_pct: x.used_pct };
    });
  const totals = {};
  for (const source of ['claude', 'codex']) {
    const rows = tokens.filter(x => x.source === source);
    const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, messages: 0 };
    for (const row of rows) for (const k of Object.keys(t)) t[k] += row[k] || 0;
    totals[source] = { ...t, total: total(t) };
  }
  return {
    days: r.list,
    claude: { output: pick('claude', 'output'), input: pick('claude', 'input'), cacheRead: pick('claude', 'cache_read'), cacheWrite: pick('claude', 'cache_write') },
    codex: { output: pick('codex', 'output'), input: pick('codex', 'input'), cacheRead: pick('codex', 'cache_read'), cacheWrite: pick('codex', 'cache_write') },
    totals, models, mix: modelMix(db, r), cache, quota: q.map(x => quotaRow(x, r.now)), quotaLine, forecast: forecast(db, r.now),
    paceFormula: PACE_FORMULA, burndown: q.filter(x => !x.expired).map(x => burndown(db, x, r.now)).filter(Boolean),
    tops: { tools: tops(db, r, 'tools'), skills: tops(db, r, 'skill'), mcp: tops(db, r, 'mcp_server'), subagents: tops(db, r, 'subagent') }
  };
}

// Model mix: all tokens per day for the 7 biggest models, the rest summed as "Other".
function modelMix(db, r) {
  const rows = db.prepare(`SELECT t.day, s.name source, m.name model, ${FRESH_INPUT} input, SUM(output) output,
      SUM(cache_read) cache_read, SUM(cache_write) cache_write FROM daily_tokens t JOIN names s ON s.id=t.source
      JOIN names m ON m.id=t.model WHERE t.day>=? GROUP BY t.day, t.source, t.model`).all(r.startDay);
  const by = new Map();
  for (const row of rows) {
    const k = `${row.source}|${row.model}`;
    if (!by.has(k)) by.set(k, { source: row.source, model: row.model, total: 0, rows: [] });
    const v = total(row); by.get(k).total += v; by.get(k).rows.push({ day: row.day, v });
  }
  const ranked = [...by.values()].filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  const keep = ranked.slice(0, 7), rest = ranked.slice(7);
  const out = keep.map(x => ({ source: x.source, model: x.model, total: x.total, data: series(r, x.rows, y => y.v) }));
  if (rest.length) out.push({ source: 'other', model: `Other (${rest.length})`, total: rest.reduce((a, x) => a + x.total, 0),
    data: series(r, rest.flatMap(x => x.rows), y => y.v) });
  return out;
}

// Ranked top 10 with a daily series for the range and a week-over-week delta
// (last 7 local days vs the 7 before, whatever the range). tools: daily_tools; others: tool_calls.
function tops(db, r, column) {
  const wow = dayList(14, r.now), from = wow.startDay < r.startDay ? wow.startDay : r.startDay;
  const rows = column === 'tools'
    ? db.prepare(`SELECT n.name name, d.day, SUM(calls) calls FROM daily_tools d JOIN names n ON n.id=d.tool
        WHERE d.day>=? GROUP BY d.tool, d.day`).all(from)
    : db.prepare(`SELECT n.name name, t.day, COUNT(*) calls FROM tool_calls t JOIN names n ON n.id=t.${column}
        WHERE t.day>=? GROUP BY t.${column}, t.day`).all(from);
  const recent = new Set(wow.list.slice(7)), prior = new Set(wow.list.slice(0, 7));
  const by = new Map();
  for (const row of rows) {
    if (!by.has(row.name)) by.set(row.name, { name: row.name, calls: 0, last7: 0, prev7: 0, rows: [] });
    const x = by.get(row.name);
    if (row.day >= r.startDay) { x.calls += row.calls; x.rows.push(row); }
    if (recent.has(row.day)) x.last7 += row.calls;
    if (prior.has(row.day)) x.prev7 += row.calls;
  }
  const list = [...by.values()].filter(x => x.calls > 0).sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1));
  const all = list.reduce((a, x) => a + x.calls, 0);
  return { total: all, distinct: list.length, rows: list.slice(0, 10).map(x => ({ name: x.name, calls: x.calls,
    sharePct: all ? round1(x.calls / all * 100) : null, last7: x.last7, prev7: x.prev7, daily: series(r, x.rows, y => y.calls) })) };
}

// Year calendar (GitHub-style), always the last 365 days whatever the selected range.
// daily_* tables are kept forever, so this never touches raw rows. Used by Overview + Productivity.
function yearCalendar(db, now) {
  const year = range(365, now);
  const calendar = new Map(year.list.map(d => [d, { day: d, messages: 0, output: 0, runs: 0, tasks: 0 }]));
  for (const row of db.prepare(`SELECT t.day, s.name source, SUM(messages) messages, SUM(output) output FROM daily_tokens t
      JOIN names s ON s.id=t.source WHERE t.day>=? GROUP BY t.day, t.source`).all(year.startDay)) {
    const c = calendar.get(row.day); if (!c) continue;
    if (row.source === 'claude') c.messages += row.messages;
    c.output += row.output;
  }
  for (const row of db.prepare('SELECT day, SUM(runs) runs FROM daily_runs WHERE day>=? GROUP BY day').all(year.startDay)) {
    const c = calendar.get(row.day); if (c) c.runs = row.runs;
  }
  for (const row of db.prepare('SELECT day, COUNT(*) n FROM ledger WHERE day>=? GROUP BY day').all(year.startDay)) {
    const c = calendar.get(row.day); if (c) c.tasks = row.n;
  }
  return [...calendar.values()];
}
function productivity(db, r) {
  const runs = runsByDay(db, r), tokens = tokensByDay(db, r), ledger = ledgerRows(db, r);
  const dispatch = db.prepare(`SELECT k.name kind, COUNT(*) n FROM dispatches x JOIN names k ON k.id=x.kind
      WHERE ts>=? GROUP BY x.kind ORDER BY n DESC`).all(r.startTs);
  const heat = db.prepare(`SELECT CAST(strftime('%w', ts, 'unixepoch', 'localtime') AS INTEGER) dow,
      CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) hour, COUNT(*) n
      FROM claude_messages WHERE ts>=? GROUP BY dow, hour`).all(r.startTs);
  const durations = groupBy(db.prepare(`SELECT day, ended-started secs FROM runs WHERE day>=? AND ended IS NOT NULL AND ended>=started`)
    .all(r.startDay), 'day');
  const compactions = db.prepare(`SELECT COUNT(*) n, SUM(pre_tokens-post_tokens) freed FROM compactions WHERE ts>=?`).get(r.startTs);
  // Context pressure: compactions per local day and the mean context size just before them.
  const compactDays = db.prepare(`SELECT date(ts, 'unixepoch', 'localtime') day, COUNT(*) n, AVG(pre_tokens) pre, MAX(pre_tokens) max_pre
      FROM compactions WHERE ts>=? GROUP BY 1`).all(r.startTs);
  const byDay = new Map(compactDays.map(x => [x.day, x]));
  const calendar = yearCalendar(db, r.now);
  const claudeOut = tokens.filter(x => x.source === 'claude').reduce((a, x) => a + x.output, 0);
  const codexOut = tokens.filter(x => x.source === 'codex').reduce((a, x) => a + x.output, 0);
  return {
    days: r.list,
    runs: series(r, runs, x => x.runs),
    tasks: series(r, ledger, () => 1),
    medianRunMin: r.list.map(d => { const m = median((durations.get(d) || []).map(x => x.secs)); return m === null ? null : Math.round(m / 6) / 10; }),
    split: { claudeOut, codexOut, claudePct: claudeOut + codexOut ? Math.round(claudeOut / (claudeOut + codexOut) * 1000) / 10 : null },
    pace: paceSides(db, r),
    heat, dispatch, compactions, calendar,
    compactPerDay: r.list.map(d => byDay.get(d)?.n || 0),
    compactPreTokens: r.list.map(d => (byDay.has(d) ? Math.round(byDay.get(d).pre) : null)),
    compactMaxPre: r.list.map(d => byDay.get(d)?.max_pre ?? null)
  };
}

// Quota pace per side (replaces the retired 30 / 70 output split): Claude 7-day, Claude 5-hour and the
// Codex window of the current account (the longest one; its name says its length). history = pace at the
// last snapshot of each day in the range (null on a day with no snapshot).
function paceSides(db, r) {
  const q = quota(db, r.now);
  const codex = q.filter(x => x.source === 'codex').sort((a, b) => (windowSecs(b) ?? 0) - (windowSecs(a) ?? 0) || b.ts - a.ts)[0];
  // A side with no snapshot is named by the same quotaName() rule from the window it stands for.
  const picks = [['claude7', { source: 'claude', window: 'seven_day' }, q.find(x => x.source === 'claude' && x.window === 'seven_day')],
    ['claude5', { source: 'claude', window: 'five_hour' }, q.find(x => x.source === 'claude' && x.window === 'five_hour')],
    ['codex', { source: 'codex', window: 'primary', window_secs: 7 * DAY }, codex]];
  return { days: r.list, formula: PACE_FORMULA, thresholds: ROUTE, sides: picks.map(([key, slot, x]) => (x
    ? { key, name: quotaName(x), source: x.source, ...pace(x, r.now), history: paceHistory(db, x, r.now, r.days) }
    : { key, name: quotaName(slot), source: slot.source, missing: true, pace: null, history: r.list.map(() => null) })) };
}

/* ---------- H8a: usage card + routing advice ---------- */
/* routeInputOf(rows): the routeAdvice() input from live quota rows (liveQuotas() / pace() shape).
 * Codex = the longest window (same pick as paceSides()); Claude 7-day and 5-hour by window name.
 * A pace that is null, early or expired counts as "not over any pace threshold" (null); an expired
 * window has no live used % either (null).
 * Intent: one place that turns quota rows into the routing input. Status: done. Next: none.
 * Blockers: none. Confidence: tests/h8a-route.test.js. */
function routeInputOf(rows) {
  const live = (rows || []).filter(x => x && !x.expired);
  const codex = live.filter(x => x.source === 'codex').sort((a, b) => (b.windowSecs ?? 0) - (a.windowSecs ?? 0))[0];
  const c7 = live.find(x => x.source === 'claude' && x.window === 'seven_day'), c5 = live.find(x => x.source === 'claude' && x.window === 'five_hour');
  const paceOf = x => (x && Number.isFinite(x.pace) && !x.early ? x.pace : null);
  const usedOf = x => (x && Number.isFinite(x.usedPct) ? x.usedPct : null);
  return { codexPace: paceOf(codex), codexUsed: usedOf(codex), claude7Pace: paceOf(c7), claude7Used: usedOf(c7), claude5Used: usedOf(c5) };
}
/* routeAdvice(input): CLAUDE.md "Route by quota pace" as a pure function (H8a matrix, Line 2026-11-14).
 * Codex level C3 used >= 95; C2 pace > 1.3 or used >= 85; C1 pace > 1.0 or used >= 70; else C0.
 * Claude K1 = 7-day pace > 1.2 or used >= 70; K5 flag = 5-hour used >= 80 (handoff, rows still shown).
 * STOP = C3 and K1 only (Line 2026-11-15); K1+C2 Standard tasks are never deferred.
 * The "over daily budget" rule is not implemented (no daily-budget data): a note says so.
 * Intent: Hub tells Line today's routing. Status: done. Next: H8b may log advice vs actual model.
 * Blockers: none. Confidence: tests/h8a-route.test.js (every cell + boundaries). */
const DEFAULT_ROUTE = { codexPace1: 1.0, codexPace2: 1.3, codexUsed1: 70, codexUsed2: 85, codexUsed3: 95, claudePace: 1.2, claudeUsed: 70, claude5Used: 80 };
const DEFAULT_WORK = ['Standard-A', 'Standard-B', 'Important/Critical worker', 'Exploration', 'Layer-2 review', 'Layer-3 Important', 'Layer-3 Critical'];
const RM = { sol: 'gpt-6-sol high', astra: 'gpt-6-astra high', astraNr: 'gpt-6-astra high (no resumes)', luna: 'gpt-6-luna max then gpt-6-sol ultra',
  sbCond: 'gpt-6-sol high if <=3 files and runnable VALIDATE, else gpt-6-astra high', opus: 'Opus subagent', explore: 'Claude Explore subagent',
  fable: 'Fable subagent', l2astra: 'gpt-6-astra' };
// Rows 0-4 (Standard-A .. Layer-2) per Claude level and Codex level. K1 + C3 is STOP (no row set).
const DEFAULT_MATRIX = {
  K0: { C0: [RM.sol, RM.astra, RM.astra, RM.luna, RM.l2astra], C1: [RM.sol, RM.sbCond, RM.astra, RM.explore, RM.fable],
    C2: [RM.opus, RM.opus, RM.astraNr, RM.explore, RM.fable], C3: [RM.opus, RM.opus, RM.opus, RM.explore, RM.fable] },
  K1: { C0: [RM.sol, RM.astra, RM.astra, RM.luna, RM.l2astra], C1: [RM.sol, RM.sbCond, RM.astra, RM.explore, RM.l2astra],
    C2: [RM.sol, RM.sol, RM.astraNr, RM.explore, RM.l2astra] }
};
const DEFAULT_LAYER3 = { K0: 'Fable via /model', K1: 'Opus supervisor (Fable only for Critical)', critical: 'Fable 5.2 high via /model claude-fable-5-2' };
const DEFAULT_ALERTS = { quotaPace: 1.3, quotaUsed: 85, handoffUsed: 80, commitPct: 90, diskFreePct: 10, folderDays: 14, cleanDrop: 15, cleanMinTasks: 3,
  vhdxGB: 80, staleSecs: 600, threadTokens: 50e6, threadActiveHours: 48 };

/* Intent: load one complete ontology per process; a bad explicit/live file must not mix defaults with input.
 * Status: complete. Next: restart after ontology edits. Blockers: none. Confidence: isolated loader tests. */
function loadOntology() {
  try {
    const live = path.join(process.env.USERPROFILE || os.homedir(), '.claude/ontology/harness.ontology.json');
    const file = process.env.LINE_HUB_ONTOLOGY !== undefined ? process.env.LINE_HUB_ONTOLOGY
      : fs.existsSync(live) ? live : path.resolve(__dirname, '../../claude/ontology/harness.ontology.json');
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    const need = (ok, field) => { if (!ok) throw new Error(`invalid ontology: ${field}`); };
    const string = x => typeof x === 'string' && x.length > 0;
    need(o && string(o.version), 'version');
    const thresholds = o.quota?.thresholds, routing = o.routing, alerts = o.alerts;
    need(thresholds && Object.keys(DEFAULT_ROUTE).every(k => Number.isFinite(thresholds[k]))
      && Object.values(thresholds).every(Number.isFinite), 'quota.thresholds');
    need(routing && Array.isArray(routing.workTypes) && routing.workTypes.length === 7 && routing.workTypes.every(string), 'routing.workTypes');
    need(routing.labels && Object.keys(RM).every(k => string(routing.labels[k])) && Object.values(routing.labels).every(string), 'routing.labels');
    const matrix = {};
    for (const k of ['K0', 'K1']) {
      matrix[k] = {};
      for (const c of ['C0', 'C1', 'C2', 'C3']) {
        const row = routing.matrix?.[k]?.[c];
        if (k === 'K1' && c === 'C3') { need(row === 'STOP', 'routing.matrix.K1.C3'); continue; }
        need(Array.isArray(row) && row.length === 5 && row.every(id => typeof id === 'string' && Object.hasOwn(routing.labels, id)), `routing.matrix.${k}.${c}`);
        matrix[k][c] = row.map(id => routing.labels[id]);
      }
    }
    need(routing.layer3 && Object.keys(DEFAULT_LAYER3).every(k => string(routing.layer3[k])), 'routing.layer3');
    need(string(routing.stopText) && string(routing.k5Banner), 'routing text');
    need(alerts && Object.keys(DEFAULT_ALERTS).every(k => Number.isFinite(alerts[k]))
      && Object.entries(alerts).every(([k, v]) => k === '$comment' || Number.isFinite(v)), 'alerts');
    const banner = routing.k5Banner.replace(/\{([^{}]+)\}/g, (_, expression) => {
      const subtract = expression.endsWith('-1'), key = subtract ? expression.slice(0, -2) : expression;
      need(Number.isFinite(thresholds[key]), `routing.k5Banner.${key}`);
      const value = thresholds[key] - (subtract ? 1 : 0);
      return key.includes('Pace') ? (Number.isInteger(value) ? value.toFixed(1) : String(value)) : value.toFixed(0);
    });
    return { thresholds, work: routing.workTypes, matrix, layer3: routing.layer3, stopText: routing.stopText, banner, alerts,
      status: { state: 'loaded', version: o.version, error: null } };
  } catch (e) {
    return { thresholds: DEFAULT_ROUTE, work: DEFAULT_WORK, matrix: DEFAULT_MATRIX, layer3: DEFAULT_LAYER3,
      stopText: 'No new packets; report to Line', banner: 'Claude 5-hour >= 80%: finish the current check, update the handoff, pause Claude work until the window resets',
      alerts: DEFAULT_ALERTS, status: { state: 'fallback', version: null, error: e.message } };
  }
}
const ONTOLOGY = loadOntology(), ontologyStatus = ONTOLOGY.status;
const ROUTE = ONTOLOGY.thresholds, ROUTE_WORK = ONTOLOGY.work, ROUTE_MATRIX = ONTOLOGY.matrix;
const STOP_TEXT = ONTOLOGY.stopText, K5_BANNER = ONTOLOGY.banner;
function routeAdvice(input = {}) {
  const num = v => (Number.isFinite(v) ? v : null);
  const cp = num(input.codexPace), cu = num(input.codexUsed), kp = num(input.claude7Pace), ku = num(input.claude7Used), k5 = num(input.claude5Used);
  const p2 = v => v.toFixed(2), u = v => `${round1(v)}%`;
  let codexLevel = 'C0', codexWhy;
  if (cu === null && cp === null) codexWhy = 'Codex C0: no Codex data';
  else if (cu !== null && cu >= ROUTE.codexUsed3) { codexLevel = 'C3'; codexWhy = `Codex C3: used ${u(cu)} >= ${ROUTE.codexUsed3}`; }
  else if (cp !== null && cp > ROUTE.codexPace2) { codexLevel = 'C2'; codexWhy = `Codex C2: pace ${p2(cp)} > ${ROUTE.codexPace2}`; }
  else if (cu !== null && cu >= ROUTE.codexUsed2) { codexLevel = 'C2'; codexWhy = `Codex C2: used ${u(cu)} >= ${ROUTE.codexUsed2}`; }
  else if (cp !== null && cp > ROUTE.codexPace1) { codexLevel = 'C1'; codexWhy = `Codex C1: pace ${p2(cp)} > ${Number.isInteger(ROUTE.codexPace1) ? ROUTE.codexPace1.toFixed(1) : ROUTE.codexPace1}`; }
  else if (cu !== null && cu >= ROUTE.codexUsed1) { codexLevel = 'C1'; codexWhy = `Codex C1: used ${u(cu)} >= ${ROUTE.codexUsed1}`; }
  else codexWhy = `Codex C0: pace ${cp === null ? 'n/a' : p2(cp)}, used ${cu === null ? 'n/a' : u(cu)}`;
  let claudeLevel = 'K0', claudeWhy;
  if (kp !== null && kp > ROUTE.claudePace) { claudeLevel = 'K1'; claudeWhy = `Claude K1: 7-day pace ${p2(kp)} > ${ROUTE.claudePace}`; }
  else if (ku !== null && ku >= ROUTE.claudeUsed) { claudeLevel = 'K1'; claudeWhy = `Claude K1: 7-day used ${u(ku)} >= ${ROUTE.claudeUsed}`; }
  else claudeWhy = `Claude K0: 7-day pace ${kp === null ? 'n/a' : p2(kp)}, used ${ku === null ? 'n/a' : u(ku)}`;
  const handoff = k5 !== null && k5 >= ROUTE.claude5Used;
  const stop = codexLevel === 'C3' && claudeLevel === 'K1';
  const notes = [];
  if (stop) notes.push(`STOP: Codex used >= ${ROUTE.codexUsed3}% while the Claude 7-day rule is active. ${STOP_TEXT}.`);
  if (handoff) notes.push(K5_BANNER);
  if (cu === null && cp === null) notes.push('no Codex data');
  if (cp === null && cu !== null) notes.push('Codex pace early or unknown: only its used % counts');
  if (kp === null && ku !== null) notes.push('Claude 7-day pace early or unknown: only its used % counts');
  notes.push('daily budget rule not tracked');
  if (stop) {
    const why = notes[0].replace(/\. No new packets.*$/, '');
    return { codexLevel, claudeLevel, stop, handoff, notes, thresholds: ROUTE, rows: ROUTE_WORK.map(work => ({ work, model: STOP_TEXT, rule: why })) };
  }
  const set = ROUTE_MATRIX[claudeLevel][codexLevel];
  const ruleOf = i => (claudeLevel === 'K1' && i === 4 ? claudeWhy : claudeLevel === 'K1' && codexLevel === 'C2' && i < 2 ? `${claudeWhy} + ${codexWhy} (Claude rule wins) - Line 2026-11-15: Standard never deferred` : codexWhy);
  const rows = set.map((model, i) => ({ work: ROUTE_WORK[i], model, rule: ruleOf(i) }));
  rows.push({ work: ROUTE_WORK[5], model: ONTOLOGY.layer3[claudeLevel], rule: claudeWhy });
  rows.push({ work: ROUTE_WORK[6], model: ONTOLOGY.layer3.critical, rule: 'Critical: always Fable 5.2 (Line 2026-11-14)' });
  return { codexLevel, claudeLevel, stop, handoff, notes, thresholds: ROUTE, rows };
}
/* usage(db, now): Overview usage card. Rows = the live quotas of the current account (quota()):
 * Claude 7-day, Claude 5-hour, the longest Codex window; used / left / reset / hours left / pace; the Codex
 * and Claude 7-day rows carry forecast().projectedAtReset (no second projection formula). others = other
 * Codex accounts: newest snapshot per account and window in its current period (resets_at > now).
 * Freshness = meta last_run_end vs COLLECTOR_FRESH_SECS (same rule as forecast()); snapshot age is not
 * used (snapshots are written only when the value changes).
 * Intent: quota used/left at a glance. Status: done. Next: none. Blockers: Claude multi-account (non-goal).
 * Confidence: tests/h8a-alerts.test.js (usage on a fixture DB) + real DB check. */
function usage(db, now, fc = forecast(db, now)) {
  const lastRun = Number(db.prepare("SELECT value FROM meta WHERE key='last_run_end'").get()?.value) || null;
  const stale = lastRun === null || now - lastRun > COLLECTOR_FRESH_SECS;
  const live = quota(db, now).filter(x => !x.expired);
  const codex = live.filter(x => x.source === 'codex').sort((a, b) => (windowSecs(b) ?? 0) - (windowSecs(a) ?? 0) || b.ts - a.ts)[0];
  const picks = [live.find(x => x.source === 'claude' && x.window === 'seven_day'), live.find(x => x.source === 'claude' && x.window === 'five_hour'), codex].filter(Boolean);
  const rows = picks.map(x => {
    const p = pace(x, now);
    const projected = x === codex || x.window === 'seven_day' ? fc.find(f => f.source === x.source && f.window === x.window && f.account === x.account) : null;
    return { name: quotaName(x), source: x.source, window: x.window, account: x.account, usedPct: p.usedPct, leftPct: p.leftPct, resetsAt: x.resets_at,
      hoursLeft: p.hoursLeft, pace: p.pace, early: p.early || p.pace === null, unknownWindow: Boolean(p.unknownWindow),
      projectedAtReset: projected && projected.enough ? projected.projectedAtReset : null, projection: Boolean(projected) };
  });
  let others = [];
  if (hasColumn(db, 'quota_snapshots', 'account')) {
    const current = codex ? codex.account : null;
    others = db.prepare(`SELECT a.name account, w.name window, q.used_pct, q.resets_at, q.ts${hasColumn(db, 'quota_snapshots', 'window_secs') ? ', q.window_secs' : ''} FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY account, window ORDER BY ts DESC, used_pct DESC) rn FROM quota_snapshots WHERE source=(SELECT id FROM names WHERE kind='source' AND name='codex')) q
        JOIN names w ON w.id=q.window LEFT JOIN names a ON a.id=q.account WHERE q.rn=1 AND q.resets_at>?`).all(now)
      .filter(x => x.account !== current)
      .map(x => ({ name: quotaName({ ...x, source: 'codex' }), account: x.account, window: x.window, usedPct: round1(x.used_pct), leftPct: round1(Math.max(0, 100 - x.used_pct)),
        resetsAt: x.resets_at, hoursLeft: round1(Math.max(0, x.resets_at - now) / 3600), label: 'other account' }))
      .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  }
  return { rows, others, lastRun, stale, freshSecs: COLLECTOR_FRESH_SECS };
}

/* ---------- v5 parts kept in v6: hooks with limits, system, "Do this now", delegation, run tokens ---------- */
// One row per hook script over the range: timeouts, errors, p95 (nearest rank over every run in the
// range: raw hook_events plus archived duration bins), the configured timeout (hook_limits from
// settings.json; the strictest event of that script) and over = p95 > timeout / 2.
function hookRank(db, r) {
  const rows = db.prepare(`WITH samples AS (
      SELECT h.script, h.duration_ms, COUNT(*) runs,
        SUM(CASE WHEN n.name LIKE '%error%' OR COALESCE(h.exit_code,0)<>0 THEN 1 ELSE 0 END) errors,
        SUM(CASE WHEN n.name='timeout' THEN 1 ELSE 0 END) timeouts
      FROM hook_events h JOIN names n ON n.id=h.status WHERE h.day>=? AND n.name<>'additional_context' GROUP BY h.script, h.duration_ms
      UNION ALL SELECT script, duration_ms, runs, errors, timeouts FROM archived_hooks WHERE day>=?
    ), bins AS (
      SELECT script, duration_ms, SUM(runs) runs, SUM(errors) errors, SUM(timeouts) timeouts FROM samples GROUP BY script, duration_ms
    ), ranked AS (
      SELECT *, SUM(runs) OVER (PARTITION BY script ORDER BY duration_ms) cum, SUM(runs) OVER (PARTITION BY script) total FROM bins
    ) SELECT ranked.script sid, s.name script, SUM(runs) runs, SUM(errors) errors, SUM(timeouts) timeouts,
      MIN(CASE WHEN cum >= (total*95+99)/100 THEN duration_ms END) p95_ms, MAX(duration_ms) max_ms
    FROM ranked JOIN names s ON s.id=ranked.script GROUP BY ranked.script ORDER BY p95_ms DESC LIMIT 20`).all(r.startDay, r.startDay);
  const limit = hasTable(db, 'hook_limits') ? db.prepare('SELECT MIN(timeout_ms) ms FROM hook_limits WHERE script=?') : null;
  return rows.map(({ sid, ...x }) => {
    const timeoutMs = limit?.get(sid)?.ms ?? null;
    return { ...x, timeoutMs, over: timeoutMs !== null && x.p95_ms > timeoutMs / 2 };
  });
}

const FOLDER_LABEL = { claude_projects: '~/.claude/projects', codex_sessions: '~/.codex/sessions', codex_total: '~/.codex (total)',
  claude_runs: '~/.claude/state/runs', temp_claude: '%TEMP%/claude', line_hub: '~/.line-hub',
  wsl_vhdx: 'WSL disk (Ubuntu .vhdx)', docker_vhdx: 'Docker disk (.vhdx)' };
function latestSample(db) {
  if (!hasTable(db, 'system_samples')) return null;
  const s = db.prepare('SELECT * FROM system_samples ORDER BY ts DESC LIMIT 1').get();
  if (!s) return null;
  const list = text => { const v = json(text, []); return Array.isArray(v) ? v : []; }; // bad JSON or a non-array: empty
  const drives = list(s.drives).map(d => ({ ...d, freePct: pctOf(d.free, d.total), usedPct: round1(100 - d.free / d.total * 100) }));
  return { ts: s.ts, ram: { freeMb: s.ram_free_mb, totalMb: s.ram_total_mb, freePct: pctOf(s.ram_free_mb, s.ram_total_mb),
    commitUsedMb: s.commit_used_mb, commitLimitMb: s.commit_limit_mb, commitPct: s.commit_limit_mb ? pctOf(s.commit_used_mb, s.commit_limit_mb) : null },
  drives, top: list(s.top).filter(Array.isArray).map(([name, mb, count]) => ({ name, mb, count })) };
}
// Daily system metric over the day list (null where no value).
function dailyMetric(db, list, metric, subject = '') {
  if (!hasTable(db, 'system_daily')) return list.map(() => null);
  const m = new Map(db.prepare('SELECT day, value FROM system_daily WHERE metric=? AND subject=? AND day>=?').all(metric, subject, list[0]).map(x => [x.day, x.value]));
  return list.map(d => (m.has(d) ? round1(m.get(d)) : null));
}
// Folder sizes: newest value, growth per day over (up to) the last 7 days, days until its drive is full.
function folders(db, now, drives) {
  if (!hasTable(db, 'system_daily')) return [];
  const since = dayList(8, now).startDay;
  const rows = groupBy(db.prepare("SELECT day, subject, value, drive FROM system_daily WHERE metric='folder_bytes' AND day>=? ORDER BY day").all(since), 'subject');
  return Object.keys(FOLDER_LABEL).filter(k => rows.has(k)).map(k => {
    const list = rows.get(k), first = list[0], last = list.at(-1);
    const span = (Date.parse(last.day) - Date.parse(first.day)) / 864e5;
    const growth = span >= 1 ? (last.value - first.value) / span : null;
    const free = drives.find(d => d.d === last.drive)?.free ?? null;
    return { key: k, label: FOLDER_LABEL[k], bytes: last.value, day: last.day, drive: last.drive, growthPerDay: growth === null ? null : Math.round(growth),
      growthDays: span >= 1 ? Math.round(span) : 0, daysToFull: growth > 0 && free !== null ? round1(free / growth) : null };
  }).sort((a, b) => b.bytes - a.bytes);
}

/* "Do this now": ONE rule, the first that fires (shown as one line on Overview).
 * a Claude 7-day or the Codex quota (longest window; never Claude 5-hour): pace > 1.3 (not early) or used >= 85 %;
 * h Claude 5-hour used >= 80 % (finish the check, update the handoff, pause until reset);
 * b commit charge > 90 % of the commit limit (H8a: low free RAM alone never fires; skipped when the newest
 *   system sample is older than 10 minutes);
 * c a drive < 10 % free, a folder trend that fills its drive in < 14 days, or a WSL / Docker .vhdx over 80 GiB;
 * d first-pass clean % fell > 15 points vs the 7 days before (needs 3+ tasks in both weeks);
 * e a hook p95 over half its timeout;
 * f (checked after b) ~/AGENTS.md exists again (a stale auto-converted copy Codex reads; existence only, never read);
 * g (checked after c) a Codex thread over 50M cumulative tokens with activity in the last 48 h.
 * Order: a, h, b, f, c, g, d, e. Else "All clear" + the next reset. href = the page id to open.
 * H8a (2026-11-14): thresholds aligned with CLAUDE.md "Route by quota pace"; rule h added; rule b is
 * commit-only (Line); evaluateRules() returns every firing rule (the sampler toasts from it). */
const RULES = Object.fromEntries(Object.keys(DEFAULT_ALERTS).map(key =>
  [key === 'commitPct' ? 'commit' : key === 'diskFreePct' ? 'diskFree' : key, ONTOLOGY.alerts[key]]));
const isClaude5 = q => q.source === 'claude' && q.window === 'five_hour';
const FIRES = {
  a: q => Boolean(q) && !q.expired && !isClaude5(q) && ((Number.isFinite(q.pace) && q.pace > RULES.quotaPace && !q.early) || (Number.isFinite(q.usedPct) && q.usedPct >= RULES.quotaUsed)),
  h: q => Boolean(q) && !q.expired && isClaude5(q) && Number.isFinite(q.usedPct) && q.usedPct >= RULES.handoffUsed,
  b: ram => Boolean(ram) && ram.commitPct !== null && ram.commitPct !== undefined && ram.commitPct > RULES.commit,
  disk: d => d && d.freePct !== null && d.freePct !== undefined && d.freePct < RULES.diskFree,
  folder: f => f && f.daysToFull !== null && f.daysToFull !== undefined && f.daysToFull < RULES.folderDays,
  vhdx: f => Boolean(f) && typeof f.key === 'string' && f.key.endsWith('_vhdx') && Number.isFinite(f.bytes) && f.bytes > RULES.vhdxGB * 2 ** 30,
  lowData: c => !c || c.nNow < RULES.cleanMinTasks || c.nPrev < RULES.cleanMinTasks,
  d: c => Boolean(c) && c.now !== null && c.prev !== null && !FIRES.lowData(c) && c.prev - c.now > RULES.cleanDrop,
  e: h => h && h.over,
  f: x => Boolean(x && x.strayAgents),
  g: t => Boolean(t) && Number.isFinite(t.tokens) && t.tokens > RULES.threadTokens
};
const tokensText = t => (t >= 1e9 ? `${round1(t / 1e9)}B tokens` : `${round1(t / 1e6)}M tokens`);
// ~/AGENTS.md: existence only, the content is never read. LINE_HUB_HOME overrides the home folder (tests).
const strayAgents = (env = process.env) => fs.existsSync(path.join(env.LINE_HUB_HOME || os.homedir(), 'AGENTS.md'));
// Codex threads over RULES.threadTokens cumulative tokens whose last activity is at or after sinceTs, newest first.
// Labels only: short id (first 8 chars), model, thread_source, tokens, last activity. No path, no prompt text.
function bigThreads(db, sinceTs) {
  if (!hasTable(db, 'codex_sessions')) return [];
  const src = hasColumn(db, 'codex_sessions', 'thread_source');
  return db.prepare(`SELECT c.session_id id, m.name model, ${src ? 'n.name' : 'NULL'} source, c.total_tokens tokens,
      MAX(COALESCE(c.ended, 0), COALESCE(c.token_ts, 0), COALESCE(c.started, 0)) lastTs
      FROM codex_sessions c LEFT JOIN names m ON m.id=c.model ${src ? 'LEFT JOIN names n ON n.id=c.thread_source' : ''}
      WHERE c.total_tokens>?`).all(RULES.threadTokens)
    .filter(x => x.lastTs >= sinceTs).sort((a, b) => b.lastTs - a.lastTs || b.tokens - a.tokens)
    .map(x => ({ id: String(x.id).slice(0, 8), model: x.model || 'unknown', source: x.source || 'unknown', tokens: x.tokens, lastTs: x.lastTs || null }));
}
/* Rule a reads Claude 7-day and the Codex quota of the current account: when Codex has several windows only
 * the longest one counts (rows with no window length all stay, as before). Claude 5-hour belongs to rule h. */
function ruleAQuotas(quotas) {
  const codexLen = Math.max(-1, ...quotas.filter(q => q.source === 'codex' && Number.isFinite(q.windowSecs)).map(q => q.windowSecs));
  return quotas.filter(q => !(q.source === 'codex' && Number.isFinite(q.windowSecs) && q.windowSecs < codexLen));
}
/* evaluateRules(x): EVERY rule that fires, in the "Do this now" order a, h, b, f, c, g, d, e (one entry per
 * rule id: the worst case of that rule). Each entry = { id, rule, level, text, action, href }.
 * Intent: one rule engine for Overview (first entry) and the sampler toasts (all entries).
 * Status: done (H8a). Next: none. Blockers: none. Confidence: v8 / guards / vhdx / h8a-alerts tests. */
function evaluateRules(x) {
  const out = [];
  const add = (rule, level, text, action, href) => out.push({ id: rule, rule, level, text, action, href });
  const a = ruleAQuotas(x.quotas || []).filter(FIRES.a).sort((p, q) => (q.pace ?? 0) - (p.pace ?? 0) || (q.usedPct ?? 0) - (p.usedPct ?? 0))[0];
  if (a) {
    const fast = Number.isFinite(a.pace) && a.pace > RULES.quotaPace && !a.early;
    add('a', 'bad', fast ? `${a.name} quota burns ${a.pace}x faster than time and ${a.leftPct}% is left.` : `${a.name} quota is ${a.usedPct}% used (${a.leftPct}% left).`,
      a.source === 'codex' ? `Follow the Routing card (Codex is at C2 or above) until it resets (${stamp(a.resetsAt)}).`
        : `Hand more work to Codex and keep Claude turns short until it resets (${stamp(a.resetsAt)}).`, 'cost');
  }
  const h = (x.quotas || []).filter(FIRES.h)[0];
  if (h) add('h', 'bad', `Claude 5-hour at ${h.usedPct}%: finish the current check, update the handoff, pause Claude work until the window resets.`,
    `Update the handoff and pause Claude work until the 5-hour window resets (${stamp(h.resetsAt)}).`, 'cost');
  if (!x.stale && FIRES.b(x.ram)) {
    const ram = x.ram, top = (x.top || [])[0];
    add('b', 'bad', `Commit charge ${ram.commitPct}% of limit.`,
      top ? `Close ${top.name} (${top.mb} MB${top.count > 1 ? ` in ${top.count} processes` : ''}) or end idle node / Codex processes before the next dispatch.`
        : 'End idle node / Codex processes before the next dispatch.', 'system');
  }
  if (FIRES.f(x)) add('f', 'bad', '~/AGENTS.md is back: Codex reads stale rules from it.',
    'Move it out of the home folder and check what recreated it (Codex desktop Claude import).', 'harness');
  const drive = (x.drives || []).filter(FIRES.disk).sort((p, q) => p.freePct - q.freePct)[0];
  const fill = (x.folders || []).filter(FIRES.folder).sort((p, q) => p.daysToFull - q.daysToFull)[0];
  const vhdx = (x.folders || []).filter(FIRES.vhdx).sort((p, q) => q.bytes - p.bytes)[0];
  if (drive) {
    const big = (x.folders || []).filter(f => f.drive === drive.d).sort((p, q) => q.bytes - p.bytes)[0];
    // Disk numbers come from the newest system sample: say when that sample is stale (rule b is skipped then, rule c is not).
    add('c', 'bad', `Drive ${drive.d} has only ${drive.freePct}% free${x.stale && x.sampleTs ? ` (sample from ${stamp(x.sampleTs)})` : ''}.`,
      big ? `Clean ${big.label} first (${bytesText(big.bytes)}).` : `Free space on ${drive.d} before the next long run.`, 'system');
  } else if (fill) add('c', 'warn', `${fill.label} grows ${bytesText(fill.growthPerDay)} a day, so ${fill.drive} is full in ${fill.daysToFull} days.`,
    `Archive or clean ${fill.label} this week.`, 'system');
  else if (vhdx) add('c', 'warn', `${vhdx.label} is ${bytesText(vhdx.bytes)}.`, 'Run harness-cleanup.ps1 -Vhdx and follow its steps.', 'system');
  // x.bigThreads is already cut to the last RULES.threadActiveHours hours and sorted newest first.
  const big = (x.bigThreads || []).filter(FIRES.g)[0];
  if (big) add('g', 'warn', `Codex thread ${big.id} (${big.model}, ${big.source}) used ${tokensText(big.tokens)}, over the 50M per-session rule.`,
    'Stop that session and report to Line; start a fresh one.', 'workers');
  const c = x.clean;
  if (FIRES.d(c)) add('d', 'warn', `First-pass clean fell from ${c.prev}% to ${c.now}% in the last 7 days.`,
    'Read the FAIL notes on the Worker page and tighten SUCCESS CRITERIA in the next packet.', 'workers');
  const hook = (x.hooks || []).filter(FIRES.e).sort((p, q) => q.p95_ms / q.timeoutMs - p.p95_ms / p.timeoutMs)[0];
  if (hook) add('e', 'warn', `Hook ${hook.script} has p95 ${round1(hook.p95_ms / 1000)} s, over half its ${round1(hook.timeoutMs / 1000)} s timeout.`,
    `Make ${hook.script} faster or raise its timeout in settings.json.`, 'system');
  return out;
}
function actionBox(x) {
  const first = evaluateRules(x)[0];
  if (first) { const { id, ...box } = first; return box; }
  const next = (x.quotas || []).filter(q => !q.expired).sort((p, q) => p.resetsAt - q.resetsAt)[0];
  return { rule: null, level: 'ok', text: 'All clear.', action: next ? `Next quota reset: ${next.name} at ${stamp(next.resetsAt)}.` : 'No live quota window.',
    href: null, nextReset: next ? { name: next.name, at: next.resetsAt } : null };
}
// First-pass clean % over `days` days, `offsetDays` back from today.
function cleanWindow(db, now, offsetDays, days = 7) {
  const r = dayList(days + offsetDays, now);
  const rows = ledgerRows(db, { startDay: r.startDay, endDay: offsetDays ? r.list[days] : null });
  return { pct: cleanPct(rows), n: rows.length };
}
// Overview: the "Do this now" rule plus whether the newest system sample is stale.
function doThisNow(db, now) {
  const sample = latestSample(db);
  const stale = Boolean(sample) && now - sample.ts > RULES.staleSecs;
  const cleanNow = cleanWindow(db, now, 0), cleanPrev = cleanWindow(db, now, 7);
  const action = actionBox({ quotas: liveQuotas(db, now), ram: sample?.ram, stale, sampleTs: sample?.ts ?? null, top: sample?.top, drives: sample?.drives || [],
    folders: folders(db, now, sample?.drives || []), clean: { now: cleanNow.pct, prev: cleanPrev.pct, nNow: cleanNow.n, nPrev: cleanPrev.n },
    hooks: hookRank(db, range(7, now)), strayAgents: strayAgents(), bigThreads: bigThreads(db, now - RULES.threadActiveHours * 3600) });
  return { action, stale, sampleTs: sample?.ts ?? null };
}

function system(db, r) {
  const now = r.now, sample = latestSample(db);
  const ram24 = hasTable(db, 'system_samples') ? db.prepare('SELECT ts, ram_free_mb f, ram_total_mb t FROM system_samples WHERE ts>=? ORDER BY ts').all(now - DAY)
    .filter(x => x.t > 0).map(x => round1(x.f / x.t * 100)) : [];
  const step = Math.max(1, Math.ceil(ram24.length / 288));
  const kills = hasTable(db, 'memory_kills') ? db.prepare('SELECT ts, top FROM memory_kills WHERE ts>=? ORDER BY ts DESC LIMIT 50').all(now - 30 * DAY)
    .map(x => ({ ts: x.ts, top: json(x.top, []) })) : [];
  return { sample, stale: Boolean(sample) && now - sample.ts > RULES.staleSecs, ram24: ram24.filter((_, i) => i % step === 0),
    folders: folders(db, now, sample?.drives || []), kills, hooks: hookRank(db, r),
    daily: { days: r.list, ramMin: dailyMetric(db, r.list, 'ram_free_min_pct'), ramAvg: dailyMetric(db, r.list, 'ram_free_avg_pct'), commitMax: dailyMetric(db, r.list, 'commit_max_pct') },
    collector: { lastRun: Number(meta(db).last_run_end) || null, schema: Number(meta(db).schema_version) || null } };
}

// Codex thread tree: a parent cycle (bad data) resolves to the smallest id on the cycle.
function threadTree(db) {
  const src = hasColumn(db, 'codex_sessions', 'thread_source');
  const threads = new Map(db.prepare(`SELECT c.session_id id, c.parent_thread_id parent, c.output, c.total_tokens total, c.reasoning, c.duration_ms ms
      ${src ? ', n.name source' : ''} FROM codex_sessions c ${src ? 'LEFT JOIN names n ON n.id=c.thread_source' : ''}`).all().map(t => [t.id, t]));
  const rootOf = id => {
    let t = threads.get(id);
    const seen = [];
    while (t?.parent && threads.has(t.parent)) {
      seen.push(t.id);
      const up = threads.get(t.parent);
      if (seen.includes(up.id)) { const cycle = seen.slice(seen.indexOf(up.id)).sort(); return threads.get(cycle[0]); }
      t = up;
    }
    return t || null;
  };
  return { threads, rootOf };
}
// Run tokens: session.txt may name a sub-agent thread, so a run is resolved to its ROOT thread and shows
// the whole tree. Resumed runs share one Codex session: its tokens are shown on the first run only.
function runTokens(db, runs) {
  const { threads, rootOf } = threadTree(db);
  const children = new Map();
  for (const t of threads.values()) if (t.parent && threads.has(t.parent)) { if (!children.has(t.parent)) children.set(t.parent, []); children.get(t.parent).push(t); }
  const tree = new Map();
  const treeOf = root => {
    if (tree.has(root.id)) return tree.get(root.id);
    const sum = { output: 0, total: 0, reasoning: 0, threads: 0 }, stack = [root], seen = new Set();
    while (stack.length) { const t = stack.pop(); if (seen.has(t.id)) continue; seen.add(t.id); sum.threads++; sum.output += t.output; sum.total += t.total; sum.reasoning += t.reasoning; stack.push(...(children.get(t.id) || [])); }
    tree.set(root.id, sum); return sum;
  };
  const firstRun = new Map();
  for (const x of db.prepare('SELECT run_id, codex_session_id sid FROM runs WHERE codex_session_id IS NOT NULL ORDER BY started, run_id').all()) {
    const root = rootOf(x.sid);
    if (root && !firstRun.has(root.id)) firstRun.set(root.id, x.run_id);
  }
  for (const run of runs) {
    const root = run.codex_session_id ? rootOf(run.codex_session_id) : null;
    Object.assign(run, { codex_root: root ? root.id.slice(0, 8) : null, codex_threads: null, codex_output: null, codex_total: null,
      codex_reasoning: null, codex_ms: null, same_session_as: null });
    if (!root) continue;
    const first = firstRun.get(root.id);
    if (first && first !== run.run_id) { run.same_session_as = first; continue; }
    const t = treeOf(root);
    Object.assign(run, { codex_threads: t.threads, codex_output: t.output, codex_total: t.total, codex_reasoning: t.reasoning, codex_ms: root.ms });
  }
}

/* Delegation metrics (internal; returned as workers().delegation and shown as Worker cards):
 * 1. first-pass clean % by tier x worker over 7 and 30 days;
 * 2. aggregate ratios (runs, resumes, FAIL rounds per ledger task, STOP rate) over 7 d, 30 d and the range;
 * 3. per-task metrics for ledger lines with runs= (ledger_runs); no link is guessed by time;
 * 4. resume rate by packet size (stdin.txt of the original run);
 * 5. Codex tokens by origin (dispatcher root thread, sub-agent thread, other session). */
const TIER_ORDER = ['Critical', 'Important', 'Standard-B', 'Standard-A', 'Standard', 'Skip', 'Exploration', 'Other'];
const BUCKETS = [[8192, '<= 8 KB'], [16384, '8-16 KB'], [Infinity, '> 16 KB']];
function delegation(db, r) {
  const now = r.now;
  const byTierWorker = [7, 30].map(days => {
    const rows = ledgerRows(db, { startDay: dayList(days, now).startDay });
    const list = [...groupBy(rows, x => `${x.tier}|${x.model}`)].map(([k, g]) => {
      const [tier, worker] = k.split('|');
      return { tier, worker, n: g.length, clean: g.filter(x => x.clean).length, pct: cleanPct(g), failRounds: sumBy(g, x => x.failRounds) };
    }).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.n - a.n);
    return { days, tasks: rows.length, pct: cleanPct(rows), rows: list };
  });
  const ratio = days => {
    const d = dayList(days, now), rows = ledgerRows(db, { startDay: d.startDay });
    const runs = db.prepare('SELECT COALESCE(SUM(runs),0) runs, COALESCE(SUM(resumes),0) resumes FROM daily_runs WHERE day>=?').get(d.startDay);
    const tasks = rows.length, fails = sumBy(rows, x => x.failRounds), stops = rows.filter(x => x.stop).length;
    const per = n => (tasks ? round2(n / tasks) : null);
    return { days, tasks, runs: runs.runs, resumes: runs.resumes, failRounds: fails, stopTasks: stops,
      runsPerTask: per(runs.runs), resumesPerTask: per(runs.resumes), failRoundsPerTask: per(fails), stopPct: pctOf(stops, tasks), cleanPct: cleanPct(rows) };
  };
  const ratios = [...new Set([7, 30, r.days])].sort((a, b) => a - b).map(ratio);
  const tasks = ledgerRows(db, r);
  const linked = hasTable(db, 'ledger_runs') ? groupBy(db.prepare(`SELECT lr.ledger_id, lr.run_id, x.is_resume, x.started, x.ended
      FROM ledger_runs lr LEFT JOIN runs x ON x.run_id=lr.run_id WHERE lr.ledger_id IN (SELECT id FROM ledger WHERE day>=?)`).all(r.startDay), 'ledger_id') : new Map();
  const per = tasks.filter(t => linked.has(t.id)).map(t => {
    const list = linked.get(t.id), known = list.filter(x => x.started !== null);
    const ends = known.map(x => x.ended).filter(x => x !== null);
    return { day: t.day, tier: t.tier, worker: t.model, clean: t.clean, failRounds: t.failRounds, runs: list.length, found: known.length,
      resumes: known.filter(x => x.is_resume).length,
      leadMin: known.length && ends.length ? round1((Math.max(...ends) - Math.min(...known.map(x => x.started))) / 60) : null };
  }).sort((a, b) => (a.day < b.day ? 1 : -1));
  const leads = per.map(x => x.leadMin).filter(x => x !== null).sort((a, b) => a - b);
  const perTask = { tasks: tasks.length, withRuns: per.length,
    runsPerTask: per.length ? round2(sumBy(per, x => x.runs) / per.length) : null,
    resumesPerTask: per.length ? round2(sumBy(per, x => x.resumes) / per.length) : null,
    failRoundsPerTask: per.length ? round2(sumBy(per, x => x.failRounds) / per.length) : null,
    leadMedianMin: leads.length ? round1(exactMedian(leads)) : null,
    leadP90Min: leads.length ? leads[Math.min(leads.length - 1, Math.ceil(0.9 * leads.length) - 1)] : null,
    list: per.slice(0, 20) };
  // An original (non-resume) run counts as resumed when a later resume run continues the same Codex root thread.
  const { threads, rootOf } = threadTree(db);
  const spec = hasColumn(db, 'runs', 'spec_bytes');
  const all = db.prepare(`SELECT run_id, codex_session_id sid, is_resume, started, ${spec ? 'spec_bytes' : 'NULL spec_bytes'} FROM runs`).all()
    .map(x => ({ ...x, root: x.sid ? rootOf(x.sid)?.id || x.sid : null }));
  const resumesByRoot = groupBy(all.filter(x => x.is_resume && x.root), 'root');
  const bucketOf = b => (b === null || b === undefined ? 'n/a' : BUCKETS.find(([max]) => b <= max)[1]);
  const originals = all.filter(x => !x.is_resume && x.started >= r.startTs);
  const resumeBySize = [...BUCKETS.map(b => b[1]), 'n/a'].map(bucket => {
    const list = originals.filter(x => bucketOf(x.spec_bytes) === bucket);
    const linkedList = list.filter(x => x.root);
    const resumed = linkedList.filter(x => (resumesByRoot.get(x.root) || []).some(y => y.started > x.started));
    const resumes = sumBy(linkedList, x => (resumesByRoot.get(x.root) || []).filter(y => y.started > x.started).length);
    return { bucket, runs: list.length, linked: linkedList.length, resumed: resumed.length, resumes, ratePct: pctOf(resumed.length, linkedList.length) };
  });
  const runRoots = new Set(all.map(x => x.root).filter(Boolean));
  const origin = { dispatcher: { origin: 'dispatcher', label: 'codex-do runs (root thread)', total: 0, output: 0, threads: 0 },
    subagent: { origin: 'subagent', label: 'sub-agent threads', total: 0, output: 0, threads: 0 },
    other: { origin: 'other', label: 'other Codex sessions', total: 0, output: 0, threads: 0 } };
  for (const x of db.prepare('SELECT session_id id, SUM(total_tokens) total, SUM(output) output FROM codex_days WHERE day>=? GROUP BY session_id').all(r.startDay)) {
    const t = threads.get(x.id);
    const k = t?.parent || /sub/i.test(t?.source || '') ? 'subagent' : runRoots.has(x.id) ? 'dispatcher' : 'other';
    origin[k].total += x.total; origin[k].output += x.output; origin[k].threads++;
  }
  return { byTierWorker, ratios, perTask, resumeBySize, tokensByOrigin: Object.values(origin) };
}

function harness(db, r) {
  // v6: the configured timeout of each script + event (hook_limits, schema v8) when the table exists.
  const limits = hasTable(db, 'hook_limits');
  const scripts = db.prepare(`SELECT s.name script, e.name event, SUM(runs) runs, SUM(errors) errors, SUM(timeouts) timeouts,
      MAX(p95_ms) p95_ms${limits ? ', (SELECT timeout_ms FROM hook_limits l WHERE l.script=h.script AND l.event=h.event) timeoutMs' : ', NULL timeoutMs'}
      FROM daily_hooks h JOIN names s ON s.id=h.script JOIN names e ON e.id=h.event
      WHERE day>=? GROUP BY h.script, h.event ORDER BY runs DESC`).all(r.startDay);
  const hookDays = db.prepare('SELECT day, SUM(runs) runs, SUM(errors) errors, SUM(timeouts) timeouts FROM daily_hooks WHERE day>=? GROUP BY day').all(r.startDay);
  const runs = runsByDay(db, r);
  const tools = db.prepare(`SELECT n.name tool, SUM(calls) calls FROM daily_tools d JOIN names n ON n.id=d.tool
      WHERE day>=? GROUP BY d.tool ORDER BY calls DESC LIMIT 15`).all(r.startDay);
  const top = column => db.prepare(`SELECT n.name name, COUNT(*) calls FROM tool_calls t JOIN names n ON n.id=t.${column}
      WHERE ts>=? GROUP BY t.${column} ORDER BY calls DESC LIMIT 10`).all(r.startTs);
  return {
    days: r.list,
    scripts,
    hookErrors: series(r, hookDays, x => x.errors),
    hookTimeouts: series(r, hookDays, x => x.timeouts),
    exit72: series(r, runs, x => x.exit72),
    exit73: series(r, runs, x => x.exit73),
    otherFail: series(r, runs, x => x.other_fail),
    tools, mcp: top('mcp_server'), skills: top('skill'), subagents: top('subagent'),
    collector: meta(db),
    // Every Codex thread over the 50M per-session rule with activity in the range (rule g looks at 48 h only).
    bigThreads: bigThreads(db, r.startTs),
    today: (() => {
      const t = hookDays.find(x => x.day === r.today), u = runs.find(x => x.day === r.today);
      return { hookErrors: t?.errors || 0, hookTimeouts: t?.timeouts || 0, exit72: u?.exit72 || 0, exit73: u?.exit73 || 0 };
    })(),
    anomaly: (() => {
      const h = history(db, r);
      const hooks = db.prepare('SELECT day, SUM(errors) errors, SUM(timeouts) timeouts FROM daily_hooks WHERE day>=? GROUP BY day').all(h.startDay);
      const runRows = runsByDay(db, h);
      return anomalies(h, { hookErrors: [hooks, x => x.errors], hookTimeouts: [hooks, x => x.timeouts],
        exit72: [runRows, x => x.exit72], exit73: [runRows, x => x.exit73] });
    })()
  };
}

// The server opens the DB read-only and cannot migrate it: a DB still at schema < 5 has no
// branch columns until the collector has opened it once.
const hasBranch = db => Boolean(db.prepare("SELECT 1 FROM pragma_table_info('codex_sessions') WHERE name='branch'").get())
  && Boolean(db.prepare("SELECT 1 FROM pragma_table_info('claude_sessions') WHERE name='branch'").get());
function trace(db, r) {
  const runs = db.prepare(`SELECT x.run_id, x.claude_session_id, x.codex_session_id, p.name project, m.name model, e.name effort,
      x.is_resume, x.started, x.ended, x.exit_code, x.sandbox_failure,
      ${hasBranch(db) ? 'COALESCE(cb.name, sb.name)' : 'NULL'} branch
      FROM runs x LEFT JOIN names p ON p.id=x.project LEFT JOIN names m ON m.id=x.model LEFT JOIN names e ON e.id=x.effort
      LEFT JOIN codex_sessions c ON c.session_id=x.codex_session_id
      ${hasBranch(db) ? `LEFT JOIN names cb ON cb.id=c.branch
      LEFT JOIN claude_sessions cs ON cs.session_id=x.claude_session_id LEFT JOIN names sb ON sb.id=cs.branch` : ''}
      WHERE x.started>=? ORDER BY x.started DESC LIMIT 120`).all(r.startTs);
  runTokens(db, runs); // v7: tokens of the run's whole Codex thread tree, shown once per resumed session
  const ids = [...new Set(runs.map(x => x.claude_session_id).filter(Boolean))];
  const sessions = new Map();
  const sessionStmt = db.prepare(`SELECT s.session_id, p.name project, s.started, s.ended, s.turns,
      (SELECT SUM(output) FROM claude_messages m WHERE m.session_id=s.session_id) output
      FROM claude_sessions s LEFT JOIN names p ON p.id=s.project WHERE s.session_id=?`);
  const dispatchStmt = db.prepare(`SELECT x.ts, k.name kind, m.name model FROM dispatches x JOIN names k ON k.id=x.kind
      JOIN names m ON m.id=x.model WHERE x.claude_session_id=? ORDER BY x.ts`);
  for (const id of ids) sessions.set(id, { ...(sessionStmt.get(id) || { session_id: id }), dispatches: dispatchStmt.all(id), runs: [] });
  const orphan = { session_id: null, project: null, dispatches: [], runs: [] };
  for (const run of runs) (sessions.get(run.claude_session_id) || orphan).runs.push(run);
  const list = [...sessions.values()];
  if (orphan.runs.length) list.push(orphan);
  list.sort((a, b) => Math.max(...b.runs.map(x => x.started)) - Math.max(...a.runs.map(x => x.started)));
  // Scatter above the lanes: every run in the range (capped), not only the 120 shown as lanes.
  const scatter = db.prepare(`SELECT x.run_id, x.started, x.ended, x.exit_code, m.name model, p.name project
      FROM runs x LEFT JOIN names p ON p.id=x.project LEFT JOIN names m ON m.id=x.model
      WHERE x.started>=? ORDER BY x.started DESC LIMIT 600`).all(r.startTs);
  // Lanes are cut twice: the latest 120 runs, then the latest 40 sessions. Say which cut applied.
  const total = db.prepare('SELECT COUNT(*) n FROM runs WHERE started>=?').get(r.startTs).n;
  const kept = list.slice(0, 40);
  const truncated = { runsCapped: total > runs.length, runsTotal: total, runsShown: kept.reduce((a, s) => a + s.runs.length, 0),
    sessionsCapped: list.length > 40, sessionsTotal: list.length, sessionsShown: kept.length };
  return { sessions: kept, scatter, start: r.startTs, truncated };
}

/* ---------- UI v4: Supervisor page (Claude only) and the Claude vs Codex radars ---------- */

// The ledger's model column names who implemented a task: a Claude model when the supervisor
// did the work itself, a Codex model when the worker did. Unknown or empty = left out.
// Whole words only ("console" is not "sol"). When both sides are named ("Fable + Astra"),
// the model named first wins: the ledger names the implementer first.
const CLAUDE_MODEL = /(?<![a-z0-9])(?:opus|fable|sonnet|haiku|claude)(?![a-z0-9])/i;
const CODEX_MODEL = /(?<![a-z0-9])(?:gpt|sol|astra|luna|codex)(?![a-z0-9])/i;
function sideOf(model) {
  if (!model) return null;
  const a = CLAUDE_MODEL.exec(model), b = CODEX_MODEL.exec(model);
  if (a && b) return a.index <= b.index ? 'claude' : 'codex';
  return a ? 'claude' : b ? 'codex' : null;
}
const LOW_DATA = 3; // fewer samples than this: drawn hollow, "low data", never used for a recommendation
const pctOf = (a, b) => (b ? round1(a / b * 100) : null);
const score100 = v => Math.max(0, Math.min(100, Math.round(v)));
const sumBy = (rows, pick) => rows.reduce((a, x) => a + (pick(x) || 0), 0);
const listText = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const durText = s => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${round1(s / 60)} min` : `${round1(s / 3600)} h`);

/* Task-type keyword rules for the "Strengths by task type" radar - tune them here.
 * A ledger task's text is its tier plus its note, lower-cased. Each type scores one point per
 * matching word (whole words; "ui-v4" matches "ui"); the highest score wins and a tie goes to the
 * type listed first. A task with no match is "other" and is left out of the radar.
 * Only the counts per type leave the server, never the note text. */
const TASK_TYPES = [
  { key: 'ui', label: 'UI', words: ['ui', 'ux', 'css', 'style', 'styles', 'layout', 'page', 'pages', 'dashboard', 'chart', 'charts', 'frontend',
    'front-end', 'component', 'components', 'screen', 'screenshot', 'screenshots', 'html', 'preact', 'react', 'tailwind', 'theme', 'font',
    'fonts', 'sidebar', 'radar', 'visual', 'design', 'portfolio'] },
  { key: 'data', label: 'Collector / data', words: ['collector', 'data', 'sql', 'sqlite', 'db', 'database', 'schema', 'query', 'queries',
    'parser', 'parsers', 'ingest', 'etl', 'dataset', 'datasets', 'migration', 'metrics', 'telemetry', 'jsonl', 'rollout', 'rollouts',
    'transcript', 'transcripts', 'backfill'] },
  // Work words only: outcome words that most notes carry ("tests pass", "review PASS", "gate",
  // "findings", "verify") are left out, or every task would look like review work.
  { key: 'review', label: 'Review / verify', words: ['reviewer', 'code-review', 're-review', 'verification', 'audit', 'testing', 'qa', 'lint',
    'eval', 'evals', 'cx-verify', 'security-review'] },
  { key: 'research', label: 'Research', words: ['research', 'explore', 'exploration', 'investigate', 'investigation', 'spike', 'compare',
    'comparison', 'benchmark', 'bench', 'probe', 'pilot', 'analysis', 'analyze', 'root-cause', 'rca', 'survey'] },
  { key: 'docs', label: 'Docs', words: ['doc', 'docs', 'readme', 'documentation', 'spec', 'specs', 'guide', 'handbook', 'policy', 'policies',
    'markdown', 'explainer', 'write-up', 'writeup', 'agents.md', 'claude.md', 'handoff', 'memo'] },
  { key: 'config', label: 'Config / harness', words: ['config', 'configuration', 'settings', 'hook', 'hooks', 'harness', 'dispatcher',
    'script', 'scripts', 'ps1', 'install', 'installer', 'setup', 'ci', 'workflow', 'codex-do', 'statusline', 'toml', 'skill', 'skills',
    'mcp', 'sandbox', 'scheduler'] }
];
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TASK_RE = TASK_TYPES.map(t => new RegExp(`(?<![a-z0-9])(?:${t.words.map(escapeRe).join('|')})(?![a-z0-9])`, 'g'));
function classifyTask(text) {
  const s = String(text || '').toLowerCase();
  let best = 'other', top = 0;
  TASK_TYPES.forEach((t, i) => { const n = (s.match(TASK_RE[i]) || []).length; if (n > top) { top = n; best = t.key; } });
  return best;
}

/* Strengths by capability: six axes, each 0-100 per side. A side with no stored signal gets
 * score null and an `na` reason - the page draws a gap, never a made-up value. */
const SPEED_TARGET = { codex: 600, claude: 20 }; // seconds that score 50 (score = 100 x T / (T + median))
const IDLE_GAP = 600; // seconds between Claude messages above this count as idle
const CAPABILITY_FORMULA = {
  speed: `Each side against its own target, so this axis is not a head-to-head comparison and is left out of the notes. 100 x T / (T + median); a median equal to the target T scores 50, faster scores higher. Codex: median finished run time, T = ${SPEED_TARGET.codex / 60} min. Claude: median seconds between two Claude messages of one session, T = ${SPEED_TARGET.claude} s; gaps over ${IDLE_GAP / 60} min count as idle and are ignored.`,
  quality: 'Share of ledger tasks with no finding in L1, L2 or L3 and no FAIL. The side is the model named in the ledger note: Opus / Fable / Sonnet = Claude, Sol / Astra / Luna / GPT = Codex.',
  rework: 'Codex: 100 - resumes as % of runs (codex-do -Resume = a repair round). Claude: no stored repair signal.',
  cache: 'Cache hit % = cache read / (fresh input + cache read + cache write) tokens.',
  reliability: 'Codex: exit 0 % of finished runs. Claude: % of sessions in the range with no <synthetic> message (Claude Code writes one on an API error or an interrupt) - the closest stored signal.',
  volume: 'Share of all output tokens written in the range (Claude + Codex = 100).'
};
function capability(db, r, tokens = tokensByDay(db, r), ledger = ledgerRows(db, r)) {
  const side = (score, value, n, na) => (score === null || score === undefined || Number.isNaN(score)
    ? { score: null, value: null, n: n || 0, na, low: true } : { score: score100(score), value, n, low: n < LOW_DATA });
  // Codex runs
  const runs = runsByDay(db, r);
  const nRuns = sumBy(runs, x => x.runs), resumes = sumBy(runs, x => x.resumes), fin = sumBy(runs, finished), ok = sumBy(runs, x => x.exit0);
  const durs = db.prepare('SELECT ended-started secs FROM runs WHERE day>=? AND ended IS NOT NULL AND ended>=started').all(r.startDay).map(x => x.secs);
  const runMed = median(durs);
  // Claude step time: gaps between consecutive messages of one session, idle gaps left out.
  // The median is taken in SQLite (count, then the middle one or two rows), so the ~20k
  // message rows of a 90-day range never become JS objects (keeps the server near its RSS budget).
  const GAPS = `SELECT g FROM (SELECT ts - LAG(ts) OVER (PARTITION BY session_id ORDER BY ts) g FROM claude_messages WHERE ts>=?)
      WHERE g>0 AND g<=${IDLE_GAP}`;
  const nGaps = db.prepare(`SELECT COUNT(*) n FROM (${GAPS})`).get(r.startTs).n;
  const middle = nGaps ? db.prepare(`${GAPS} ORDER BY g LIMIT ? OFFSET ?`)
    .all(r.startTs, nGaps % 2 ? 1 : 2, nGaps % 2 ? (nGaps - 1) / 2 : nGaps / 2 - 1).map(x => x.g) : [];
  const stepMed = median(middle);
  const gaps = { length: nGaps };
  const sessions = db.prepare(`SELECT c.session_id, MAX(m.name='<synthetic>') bad FROM claude_messages c JOIN names m ON m.id=c.model
      WHERE c.ts>=? GROUP BY c.session_id`).all(r.startTs);
  const badSessions = sessions.filter(x => x.bad).length;
  const fp = s => { const rows = ledger.filter(x => sideOf(x.model) === s); return { n: rows.length, pct: pctOf(rows.filter(x => x.clean).length, rows.length) }; };
  const cache = s => {
    const rows = tokens.filter(x => x.source === s);
    const read = sumBy(rows, x => x.cache_read), all = sumBy(rows, x => x.input + x.cache_read + x.cache_write);
    return { all, pct: pctOf(read, all) };
  };
  const out = { claude: sumBy(tokens.filter(x => x.source === 'claude'), x => x.output), codex: sumBy(tokens.filter(x => x.source === 'codex'), x => x.output) };
  const outAll = out.claude + out.codex;
  const q = { claude: fp('claude'), codex: fp('codex') }, c = { claude: cache('claude'), codex: cache('codex') };
  const axis = (key, label, claude, codex) => ({ key, label, formula: CAPABILITY_FORMULA[key], claude, codex });
  return [
    axis('speed', 'Speed vs own target',
      stepMed === null ? side(null, null, 0, 'no two Claude messages within 10 min in this range')
        : side(100 * SPEED_TARGET.claude / (SPEED_TARGET.claude + stepMed), `median ${durText(stepMed)} between messages`, gaps.length),
      runMed === null ? side(null, null, 0, 'no finished run in this range')
        : side(100 * SPEED_TARGET.codex / (SPEED_TARGET.codex + runMed), `median run ${durText(runMed)}`, durs.length)),
    axis('quality', 'First-pass quality',
      q.claude.n ? side(q.claude.pct, `${q.claude.pct}% clean first time`, q.claude.n) : side(null, null, 0, 'no ledger task names a Claude model in this range'),
      q.codex.n ? side(q.codex.pct, `${q.codex.pct}% clean first time`, q.codex.n) : side(null, null, 0, 'no ledger task names a Codex model in this range')),
    axis('rework', 'Low rework',
      side(null, null, 0, 'no stored repair signal for supervisor work (resumes exist only for Codex runs)'),
      nRuns ? side(100 - resumes / nRuns * 100, `${pctOf(resumes, nRuns)}% of runs were resumes`, nRuns) : side(null, null, 0, 'no worker run in this range')),
    axis('cache', 'Token efficiency',
      c.claude.all ? side(c.claude.pct, `cache hit ${c.claude.pct}%`, c.claude.all) : side(null, null, 0, 'no Claude tokens in this range'),
      c.codex.all ? side(c.codex.pct, `cache hit ${c.codex.pct}%`, c.codex.all) : side(null, null, 0, 'no Codex tokens in this range')),
    axis('reliability', 'Reliability',
      sessions.length ? side(100 - badSessions / sessions.length * 100, `${sessions.length - badSessions} of ${sessions.length} sessions with no <synthetic> message`, sessions.length)
        : side(null, null, 0, 'no Claude session in this range'),
      fin ? side(ok / fin * 100, `${ok} of ${fin} finished runs exit 0`, fin) : side(null, null, 0, 'no finished run in this range')),
    axis('volume', 'Volume',
      outAll ? side(out.claude / outAll * 100, `${pctOf(out.claude, outAll)}% of output tokens`, out.claude) : side(null, null, 0, 'no output tokens in this range'),
      outAll ? side(out.codex / outAll * 100, `${pctOf(out.codex, outAll)}% of output tokens`, out.codex) : side(null, null, 0, 'no output tokens in this range'))
  ];
}
// "What this suggests": up to three plain sentences from the capability scores.
// 1) where each side is furthest ahead, 2) what to change (delegate more / tighten packets),
// 3) which axes are n/a for which side.
// Speed is measured against a different target per side, so it never ranks a lead. Axes where
// either side has fewer than LOW_DATA samples are left out, and a recommendation needs n >= LOW_DATA.
const LEAD_MIN = 5; // points; smaller gaps count as a tie
const NOT_COMPARED = new Set(['speed']);
const enoughN = v => v.score !== null && v.n >= LOW_DATA;
function capabilityNotes(axes) {
  const both = axes.filter(a => a.claude.score !== null && a.codex.score !== null);
  if (!both.length) return ['Not enough data on both sides to compare yet.'];
  const fair = both.filter(a => !NOT_COMPARED.has(a.key) && enoughN(a.claude) && enoughN(a.codex));
  const lines = [];
  if (!fair.length) lines.push(`No shared axis has ${LOW_DATA}+ samples on both sides yet (Speed is never compared).`);
  else {
    const lead = s => { const o = s === 'claude' ? 'codex' : 'claude'; return fair.map(a => ({ a, d: a[s].score - a[o].score })).sort((x, y) => y.d - x.d)[0]; };
    const cx = lead('codex'), cl = lead('claude');
    const ahead = (name, x) => `${name} is furthest ahead on ${x.a.label} (${x.a[name.toLowerCase()].score} vs ${x.a[name === 'Codex' ? 'claude' : 'codex'].score})`;
    const parts = [cx.d >= LEAD_MIN ? ahead('Codex', cx) : '', cl.d >= LEAD_MIN ? ahead('Claude', cl) : ''].filter(Boolean);
    lines.push(parts.length ? `${parts.join('; ')}.` : `The two sides are within ${LEAD_MIN} points on every compared axis.`);
  }
  const vol = axes.find(a => a.key === 'volume'), fpq = axes.find(a => a.key === 'quality');
  if (vol && fpq && vol.claude.score !== null && enoughN(fpq.codex)) {
    if (vol.claude.score > 40 && fpq.codex.score >= 70) lines.push(`Claude still writes ${vol.claude.score}% of output tokens while Codex passes first time ${fpq.codex.score}% - delegate more.`);
    else if (fpq.codex.score < 50) lines.push(`Codex passes first time only ${fpq.codex.score}% - tighten packets before delegating more.`);
  }
  const na = s => axes.filter(a => a[s].score === null).map(a => a.label);
  const naText = [['Claude', na('claude')], ['Codex', na('codex')]].filter(([, l]) => l.length).map(([n, l]) => `${l.join(', ')} for ${n}`);
  if (naText.length) lines.push(`n/a (no stored signal): ${naText.join('; ')}.`);
  return lines.slice(0, 3);
}

// Strengths by task type: PASS-first-time % per type and side, from classified ledger tasks.
function taskTypes(db, r) {
  const rows = ledgerRows(db, r, true);
  const by = new Map(TASK_TYPES.map(t => [t.key, { claude: [], codex: [] }]));
  let other = 0, unknown = 0;
  for (const row of rows) {
    const s = sideOf(row.model);
    if (!s) { unknown++; continue; }
    const type = classifyTask(row.text);
    if (type === 'other') { other++; continue; }
    by.get(type)[s].push(row.clean);
  }
  const cell = list => ({ n: list.length, clean: list.filter(Boolean).length, pct: pctOf(list.filter(Boolean).length, list.length), low: list.length < LOW_DATA });
  const axes = TASK_TYPES.map(t => ({ key: t.key, label: t.label, claude: cell(by.get(t.key).claude), codex: cell(by.get(t.key).codex) }));
  return { axes, other, unknown, tasks: rows.length, notes: taskNotes(axes) };
}
function taskNotes(axes) {
  const enough = s => axes.filter(a => a[s].n >= LOW_DATA);
  const cx = enough('codex').sort((a, b) => b.codex.pct - a.codex.pct);
  if (!cx.length && !enough('claude').length) return [`Every task type has fewer than ${LOW_DATA} classified tasks per side - wait for more ledger rows or tune TASK_TYPES.`];
  const lines = [];
  if (!cx.length) {
    const cl = enough('claude').sort((a, b) => b.claude.pct - a.claude.pct)[0];
    lines.push(`Codex has fewer than ${LOW_DATA} classified tasks on every type; Claude passes most often on ${cl.label} (${cl.claude.pct}%, n = ${cl.claude.n}).`);
  }
  if (cx.length) {
    const top = cx[0], low = cx.at(-1);
    lines.push(`Codex is strongest on ${top.label} (${top.codex.pct}% first pass, n = ${top.codex.n})${cx.length > 1 ? `; weakest on ${low.label} (${low.codex.pct}%, n = ${low.codex.n})` : ''}.`);
  }
  const shared = axes.filter(a => a.claude.n >= LOW_DATA && a.codex.n >= LOW_DATA);
  const claudeBetter = shared.filter(a => a.claude.pct - a.codex.pct >= 10).map(a => a.label);
  const codexBetter = shared.filter(a => a.codex.pct - a.claude.pct >= 10).map(a => a.label);
  if (claudeBetter.length) lines.push(`Claude passes more often on ${listText(claudeBetter)} - tighten the packets there or keep that work with Claude.`);
  if (codexBetter.length) lines.push(`Codex passes more often on ${listText(codexBetter)} - delegate more of it.`);
  if (lines.length < 3) {
    const low = axes.filter(a => a.claude.n < LOW_DATA && a.codex.n < LOW_DATA).map(a => a.label);
    if (low.length) lines.push(`Low data (n < ${LOW_DATA} on both sides): ${listText(low)}.`);
  }
  if (!lines.length) lines.push('No task type has enough tasks on both sides to compare yet.');
  return lines.slice(0, 3);
}

const SELF_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const FAMILIES = [['Opus', /opus/i], ['Fable', /fable/i], ['Sonnet', /sonnet/i], ['Haiku', /haiku/i]];
const familyOf = m => (FAMILIES.find(([, re]) => re.test(m)) || ['Other'])[0];
function supervisor(db, r) {
  // 1. Edits in Claude sessions vs work handed off. daily_tools counts every tool call in the
  // transcripts, sub-agent calls included (no sidechain flag is stored), so "self" is not pure supervisor work.
  const tools = db.prepare(`SELECT d.day, n.name tool, SUM(calls) calls FROM daily_tools d JOIN names n ON n.id=d.tool
      WHERE d.day>=? AND n.name IN ('Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent') GROUP BY d.day, d.tool`).all(r.startDay);
  const disp = db.prepare(`SELECT date(x.ts, 'unixepoch', 'localtime') day, k.name kind, COUNT(*) n FROM dispatches x
      JOIN names k ON k.id=x.kind WHERE x.ts>=? GROUP BY 1, x.kind`).all(r.startTs);
  const work = {
    self: series(r, tools, x => x.calls, x => SELF_TOOLS.includes(x.tool)),
    agents: series(r, tools, x => x.calls, x => x.tool === 'Agent'),
    dispatches: series(r, disp, x => x.n, x => x.kind !== 'review'),
    reviews: series(r, disp, x => x.n, x => x.kind === 'review')
  };
  // 2. How heavy are sessions? Raw message rows (kept 90 days) inside the range.
  const sess = db.prepare(`SELECT session_id sid, COUNT(*) messages, SUM(input+output+cache_read+cache_write) tokens, SUM(output) output,
      MAX(input+cache_read+cache_write) peak, MIN(ts) first, MAX(ts) last FROM claude_messages WHERE ts>=? GROUP BY session_id`).all(r.startTs);
  const turns = new Map(db.prepare(`SELECT session_id sid, COUNT(*) n FROM human_turns
      WHERE session_id IN (SELECT DISTINCT session_id FROM claude_messages WHERE ts>=?) GROUP BY session_id`).all(r.startTs).map(x => [x.sid, x.n]));
  const compact = new Map(db.prepare('SELECT session_id sid, COUNT(*) n, MAX(pre_tokens) pre FROM compactions WHERE ts>=? GROUP BY session_id')
    .all(r.startTs).map(x => [x.sid, x]));
  const mainModel = new Map();
  for (const x of db.prepare(`SELECT c.session_id sid, m.name model, COUNT(*) n FROM claude_messages c JOIN names m ON m.id=c.model
      WHERE c.ts>=? AND m.name<>'<synthetic>' GROUP BY c.session_id, c.model ORDER BY n DESC`).all(r.startTs)) if (!mainModel.has(x.sid)) mainModel.set(x.sid, x.model);
  const project = db.prepare('SELECT p.name project FROM claude_sessions s LEFT JOIN names p ON p.id=s.project WHERE s.session_id=?');
  const list = sess.map(x => ({ id: String(x.sid).slice(0, 8), project: project.get(x.sid)?.project || null, model: mainModel.get(x.sid) || null,
    messages: x.messages, tokens: x.tokens, output: x.output, peak: x.peak, first: x.first, last: x.last,
    turns: turns.get(x.sid) ?? null, compactions: compact.get(x.sid)?.n || 0 })).sort((a, b) => b.tokens - a.tokens);
  const med = pick => median(list.map(pick).filter(v => v !== null && v !== undefined));
  const sessions = { n: list.length, top: list.slice(0, 10),
    median: { messages: med(x => x.messages), tokens: med(x => x.tokens), peak: med(x => x.peak), turns: med(x => x.turns), compactions: med(x => x.compactions) },
    compactions: sumBy(list, x => x.compactions), withTurns: list.filter(x => x.turns !== null).length };
  // 4. How often does review catch problems? Ledger tasks per week by the first layer that found something.
  const ledger = ledgerRows(db, r);
  const weeks = [...new Set(r.list.map(weekOf))];
  const wk = new Map(weeks.map(w => [w, { week: w, clean: 0, L1: 0, L2: 0, L3: 0, failRounds: 0 }]));
  for (const x of ledger) { const w = wk.get(weekOf(x.day)); if (!w) continue; w[x.clean ? 'clean' : x.layer] += 1; w.failRounds += x.failRounds; }
  const reviews = db.prepare(`SELECT v.name verdict, COUNT(*) n, SUM(p0) p0, SUM(p1) p1, SUM(p2) p2, SUM(p3) p3 FROM reviews x
      JOIN names v ON v.id=x.verdict WHERE x.ts>=? GROUP BY x.verdict`).all(r.startTs);
  const review = { weeks: [...wk.values()], tasks: ledger.length, caught: ledger.filter(x => !x.clean).length,
    byLayer: { L1: ledger.filter(x => x.layer === 'L1').length, L2: ledger.filter(x => x.layer === 'L2').length, L3: ledger.filter(x => x.layer === 'L3').length },
    failTasks: ledger.filter(x => x.fail).length, failRounds: sumBy(ledger, x => x.failRounds), reviews };
  // 5. Model split: Claude tokens per day by model family.
  const fam = new Map();
  for (const x of db.prepare(`SELECT t.day, m.name model, SUM(input+output+cache_read+cache_write) total, SUM(output) output, SUM(messages) messages
      FROM daily_tokens t JOIN names s ON s.id=t.source JOIN names m ON m.id=t.model WHERE s.name='claude' AND t.day>=? AND m.name<>'<synthetic>'
      GROUP BY t.day, t.model`).all(r.startDay)) {
    const f = familyOf(x.model);
    if (!fam.has(f)) fam.set(f, { family: f, total: 0, output: 0, messages: 0, rows: [] });
    const v = fam.get(f); v.total += x.total; v.output += x.output; v.messages += x.messages; v.rows.push(x);
  }
  const models = [...fam.values()].filter(x => x.total > 0).sort((a, b) => b.total - a.total)
    .map(x => ({ family: x.family, total: x.total, output: x.output, messages: x.messages, data: series(r, x.rows, y => y.total) }));
  const tokens = tokensByDay(db, r), axes = capability(db, r, tokens, ledger);
  return { days: r.list, work, sessions, tops: { skills: tops(db, r, 'skill'), mcp: tops(db, r, 'mcp_server'), subagents: tops(db, r, 'subagent') },
    review, models, radar: { capability: { axes, notes: capabilityNotes(axes) }, tasks: taskTypes(db, r) } };
}

/* ---------- UI v6 (H6b): Models page - one row per model, detail for one picked model ---------- */
/* Model key (the identity of a row and of a picked page):
 * - Claude: the family from familyOf() (Opus / Fable / Sonnet / Haiku / Other); exact ids are a breakdown.
 *   '<synthetic>' is left out. Ledger aliases: opus -> Opus, fable -> Fable, claude-subagent -> Other.
 * - Codex: the exact model name of runs / daily_tokens ('unknown' is its own row); retired gpt-5.6-* -> 'Other (Codex)'.
 * - Row id = the key; when one key exists on both sides, the Codex row's id is 'codex:<key>'. A request may also
 *   name 'codex:<key>' / 'claude:<key>' explicitly.
 * A Claude session is listed when it has a message in the range and counts for the family with the most messages
 * over the WHOLE session (claude_messages; tie -> FAMILIES order).
 * Codex tokens cover every Codex thread (codex-do, interactive desktop / CLI, sub-agents); runs cover codex-do only.
 * So each Codex row also carries its threads and splits tokens into runTokens (threads whose root thread is a
 * codex-do run's session) and otherTokens. Missing data is null, never 0.
 * The ?model= value is only compared against the ids found in the range; SQL gets the stored raw model
 * names as bound parameters, never the request text. */
const RETIRED_CODEX = /^gpt-5\.6/i;
const CODEX_OTHER = 'Other (Codex)';
const FAMILY_ORDER = ['Opus', 'Fable', 'Sonnet', 'Haiku', 'Other'];
const codexKey = name => (RETIRED_CODEX.test(name) ? CODEX_OTHER : name);
// Ledger model (aliasModel output) -> key; null when the ledger names no model.
function ledgerKey(model) {
  if (!model || model === 'unknown') return null;
  const side = sideOf(model);
  if (side === 'claude') return { side, key: familyOf(model) };
  if (side === 'codex' || /^gpt-/i.test(model)) return { side: 'codex', key: codexKey(model) };
  return null;
}
const SESSION_RULE = 'A Claude session is listed when it has a message in the range; it counts for the family with the most messages over the whole session (claude_messages, raw rows kept 90 days).';
const THREAD_RULE = 'Codex tokens cover every Codex thread (codex-do runs, interactive desktop / CLI sessions, sub-agents); runs count codex-do only. codex-do tokens = threads whose root thread is a codex-do run session; other = the rest. Low data (Codex) = fewer than 3 runs and fewer than 3 threads.';
const p90Of = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] : null; };
const marks = list => list.map(() => '?').join(',');
const tokenDays = (r, rows) => ({ input: series(r, rows, x => x.input), cache_read: series(r, rows, x => x.cache_read),
  cache_write: series(r, rows, x => x.cache_write), output: series(r, rows, x => x.output) });
const sumTokens = rows => { const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, messages: 0 }; for (const x of rows) for (const k of Object.keys(t)) t[k] += x[k] || 0; return { ...t, total: total(t) }; };
const topOf = (map, n = 8) => { const list = [...map].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1));
  const all = sumBy(list, x => x.calls); return { total: all, distinct: list.length, rows: list.slice(0, n).map(x => ({ ...x, sharePct: pctOf(x.calls, all) })) }; };
const ledgerStats = rows => ({ tasks: rows.length, cleanPct: rows.length ? cleanPct(rows) : null, failRounds: rows.length ? sumBy(rows, x => x.failRounds) : null,
  failTasks: rows.filter(x => x.fail).length, findings: { L1: sumBy(rows, x => x.l1), L2: sumBy(rows, x => x.l2), L3: sumBy(rows, x => x.l3) } });

// Codex threads with tokens in the range, per key: count and the codex-do / other token split (same token sum
// as daily_tokens: fresh input + cache read + cache write + output from codex_days).
function codexThreads(db, r) {
  const out = new Map();
  if (!hasTable(db, 'codex_days')) return out;
  const { rootOf } = threadTree(db);
  const runRoots = new Set(db.prepare('SELECT DISTINCT codex_session_id sid FROM runs WHERE codex_session_id IS NOT NULL').all()
    .map(x => rootOf(x.sid)?.id || x.sid));
  for (const x of db.prepare(`SELECT d.session_id id, m.name model, SUM(max(d.input-d.cache_read,0)+d.cache_read+d.cache_write+d.output) tokens
      FROM codex_days d JOIN codex_sessions c ON c.session_id=d.session_id JOIN names m ON m.id=c.model WHERE d.day>=? GROUP BY d.session_id`).all(r.startDay)) {
    const key = codexKey(x.model);
    if (!out.has(key)) out.set(key, { threads: 0, runTokens: 0, otherTokens: 0, runThreads: 0 });
    const v = out.get(key), root = rootOf(x.id)?.id || x.id;
    v.threads++;
    if (runRoots.has(root)) { v.runTokens += x.tokens; v.runThreads++; } else v.otherTokens += x.tokens;
  }
  return out;
}

/* Intent: H8b comparisons accept only named tiers. Status: ready. Next: none.
 * Blockers: none. Confidence: fixture tests. */
function compareTier(tier) { return ['All', ...TIER_ORDER].includes(tier) ? tier : 'All'; }

/* Intent: bound ledger outcomes to calendar days without inferring unknown FAIL rounds.
 * Status: ready. Next: none. Blockers: none. Confidence: H8b fixtures. */
function outcomeRows(db, r) {
  return ledgerRows(db, r, false, true).filter(x => x.day <= r.today);
}

/* Intent: reuse thread-tree token accounting on runs started inside the requested range.
 * Status: ready. Next: none. Blockers: none. Confidence: shared-session fixtures. */
function comparisonRuns(db, r) {
  const rows = db.prepare(`SELECT x.*, m.name model_name, COALESCE(e.name,'default') effort_name
    FROM runs x LEFT JOIN names m ON m.id=x.model LEFT JOIN names e ON e.id=x.effort
    WHERE x.started>=? AND x.started<=? ORDER BY x.started, x.run_id`).all(r.startTs, r.now);
  runTokens(db, rows);
  return rows.map(x => ({ ...x, key: codexKey(x.model_name || 'unknown') }));
}

/* Intent: explicit ledger links provide attribution; absent v8 tables need no guessed links.
 * Status: ready. Next: old links remain unfilled. Blockers: none. Confidence: fixtures. */
function outcomeLinks(db) {
  if (!hasTable(db, 'ledger_runs')) return [];
  return db.prepare(`SELECT lr.ledger_id, x.run_id, x.started, m.name model, t.name tier,
    l.note, ${hasColumn(db, 'ledger', 'fail_rounds') ? 'l.fail_rounds' : 'NULL fail_rounds'}, l.day
    FROM ledger_runs lr JOIN runs x ON x.run_id=lr.run_id JOIN ledger l ON l.id=lr.ledger_id
    LEFT JOIN names m ON m.id=x.model LEFT JOIN names t ON t.id=l.tier
    ORDER BY x.started, x.run_id, l.day, l.id`).all();
}

/* Intent: distinguish measured outcomes from missing counts and unknown FAIL rounds.
 * Status: ready. Next: none. Blockers: none. Confidence: denominator fixtures. */
function outcomeStats(rows) {
  const known = rows.filter(x => x.recordedFailRounds !== null), tasks = rows.length;
  const defects = rows.filter(x => x.l2 !== null && x.l3 !== null);
  return { tasks, firstPassN: known.length, firstPassPct: pctOf(known.filter(x => x.recordedFailRounds === 0).length, known.length),
    meanFailRounds: known.length ? round2(sumBy(known, x => x.recordedFailRounds) / known.length) : null,
    stopPct: pctOf(rows.filter(x => x.stop).length, tasks),
    defectsAfterWorker: defects.length ? round2(sumBy(defects, x => x.l2 + x.l3) / defects.length) : null,
    defectsN: defects.length, lowData: tasks < LOW_DATA };
}

/* Intent: compare worker execution and ledger outcomes independently, even without ledger_runs.
 * Status: ready. Next: host validation. Blockers: historical links absent. Confidence: H8b fixtures. */
function modelCompare(db, r, requestedTier) {
  const tier = compareTier(requestedTier), allRuns = comparisonRuns(db, r), links = outcomeLinks(db);
  const runIds = new Set(allRuns.map(x => x.run_id)), linkedInRange = links.some(x => runIds.has(x.run_id));
  const runNotice = tier !== 'All' && !linkedInRange ? 'tier filter needs ledger links' : null;
  const allowed = new Set(links.filter(x => tierOf(x.tier) === tier).map(x => x.run_id));
  const selected = tier === 'All' || runNotice ? allRuns : allRuns.filter(x => allowed.has(x.run_id));
  const runs = [...groupBy(selected, x => JSON.stringify([x.key, x.effort_name])).values()].map(rows => {
    const done = rows.filter(x => x.ended !== null && x.ended >= x.started).map(x => x.ended - x.started);
    const exits = rows.filter(x => x.exit_code !== null);
    const tokens = rows.filter(x => !x.same_session_as && x.codex_total !== null).map(x => x.codex_total);
    return { key: rows[0].key, effort: rows[0].effort_name, runs: rows.length,
      resumePct: pctOf(rows.filter(x => x.is_resume === 1).length, rows.length),
      exit0Pct: pctOf(exits.filter(x => x.exit_code === 0).length, exits.length), exitN: exits.length,
      sandboxFailures: rows.filter(x => x.sandbox_failure === 1).length, medianSecs: median(done), p90Secs: p90Of(done),
      medianTokens: median(tokens), tokenN: tokens.length, lowData: rows.length < LOW_DATA };
  }).sort((a, b) => a.key.localeCompare(b.key) || a.effort.localeCompare(b.effort));
  const owner = new Map(links.map(x => [x.ledger_id, codexKey(x.model || 'unknown')]));
  const rows = outcomeRows(db, r).filter(x => tier === 'All' || x.tier === tier);
  const outcomes = [...groupBy(rows, x => owner.get(x.id) || ledgerKey(x.model)?.key || 'unknown')]
    .map(([key, g]) => ({ key, ...outcomeStats(g) })).sort((a, b) => a.key.localeCompare(b.key));
  return { tier, tiers: ['All', ...TIER_ORDER], runNotice, runs, outcomes };
}

/* Intent: same packet, distinct model keys; keep the latest non-resumed attempt per model.
 * Status: ready. Next: collect real pairs. Blockers: none. Confidence: paired-run fixtures. */
function abPairs(db, r) {
  if (!hasColumn(db, 'runs', 'spec_sha')) return [];
  const runs = comparisonRuns(db, r).filter(x => x.is_resume === 0 && x.spec_sha !== null), links = outcomeLinks(db);
  const linked = groupBy(links, 'run_id');
  // Notes can belong to an older or resumed run of this SHA, outside the selected run range.
  const shaByRun = new Map(db.prepare('SELECT run_id, spec_sha FROM runs WHERE spec_sha IS NOT NULL').all().map(x => [x.run_id, x.spec_sha]));
  const notes = new Map(links.map(x => [shaByRun.get(x.run_id), x.note]));
  const pairs = [];
  for (const [sha, group] of groupBy(runs, 'spec_sha')) {
    const latest = new Map(group.map(x => [x.key, x]));
    if (latest.size < 2) continue;
    pairs.push({ sha, newest: Math.max(...group.map(x => x.started)), note: notes.get(sha) ?? null,
      models: [...latest.values()].map(x => ({ key: x.key, runId: x.run_id, effort: x.effort_name, started: x.started,
        exitCode: x.exit_code, durationSecs: x.ended !== null && x.ended >= x.started ? x.ended - x.started : null,
        totalTokens: x.codex_total, failRounds: linked.get(x.run_id)?.at(-1).fail_rounds ?? null }))
        .sort((a, b) => a.key.localeCompare(b.key)) });
  }
  return pairs.sort((a, b) => b.newest - a.newest || a.sha.localeCompare(b.sha)).slice(0, 20);
}

/* Intent: measure review use and catches, with a separate known-count denominator per layer.
 * Status: ready. Next: none. Blockers: none. Confidence: missing-count fixtures. */
function gateStats(rows) {
  const defects = {}, countsN = {};
  for (const [label, field] of [['L1', 'l1'], ['L2', 'l2'], ['L3', 'l3']]) {
    const known = rows.filter(x => x[field] !== null);
    defects[label] = sumBy(known, x => x[field]); countsN[label] = known.length;
  }
  return { ...outcomeStats(rows), layer2Pct: pctOf(rows.filter(x => x.layer2).length, rows.length), defects, countsN,
    lateSharePct: pctOf(defects.L3, defects.L1 + defects.L2 + defects.L3) };
}

/* Intent: expose tier coverage, missed review gates, reviewer results and Monday-week trends.
 * Status: v10 uses collector evidence only; gates-only runs excluded, model/unknown modes separated.
 * Next: host validation. Blockers: none. Confidence: H8b and v10 fixture tests. */
function gates(db, r) {
  const rows = outcomeRows(db, r);
  const tiers = TIER_ORDER.map(tier => ({ tier, ...gateStats(rows.filter(x => x.tier === tier)) }));
  const violations = rows.filter(x => ['Important', 'Critical'].includes(x.tier) && !x.layer2 && !x.stop)
    .sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id)).slice(0, 20).map(x => ({ day: x.day, note: x.note }));
  const reviews = hasTable(db, 'reviews') ? db.prepare(`SELECT m.name model, COALESCE(e.name,'unknown') effort, v.name verdict, x.p0, x.p1,
    ${hasColumn(db, 'reviews', 'mode') ? 'x.mode' : 'NULL mode'}
    FROM reviews x LEFT JOIN names m ON m.id=x.model LEFT JOIN names e ON e.id=x.effort LEFT JOIN names v ON v.id=x.verdict
    WHERE x.ts>=? AND x.ts<=?`).all(r.startTs, r.now) : [];
  const gatesOnlyRuns = reviews.filter(x => x.mode === 'gates-only').length;
  const modelReviews = reviews.filter(x => x.mode !== 'gates-only').map(x => ({ ...x, mode: x.mode === 'model' ? 'model' : 'unknown' }));
  const reviewers = [...groupBy(modelReviews, x => JSON.stringify([ledgerKey(x.model)?.key || codexKey(x.model || 'unknown'), x.effort, x.mode])).values()]
    .map(g => ({ key: ledgerKey(g[0].model)?.key || codexKey(g[0].model || 'unknown'), effort: g[0].effort, mode: g[0].mode, reviews: g.length,
      failPct: pctOf(g.filter(x => /^FAIL$/i.test(x.verdict)).length, g.length), meanP0P1: round2(sumBy(g, x => x.p0 + x.p1) / g.length) }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.effort.localeCompare(b.effort) || a.mode.localeCompare(b.mode));
  const byWeek = groupBy(rows, x => weekOf(x.day));
  const weeks = [...new Set(r.list.map(weekOf))].slice(-8)
    .map(week => ({ week, ...gateStats(byWeek.get(week) || []) }));
  return { tasks: rows.length, tiers, violations, reviewers, gatesOnlyRuns, weeks };
}

function models(db, r, wanted = null, tier = 'All') {
  // 1. Tokens per day and raw model name (fresh input for Codex, as everywhere else).
  const tok = db.prepare(`SELECT t.day, s.name source, m.name model, ${FRESH_INPUT} input, SUM(output) output, SUM(cache_read) cache_read,
      SUM(cache_write) cache_write, SUM(messages) messages FROM daily_tokens t JOIN names s ON s.id=t.source JOIN names m ON m.id=t.model
      WHERE t.day>=? AND s.name IN ('claude', 'codex') AND m.name<>'<synthetic>' GROUP BY t.day, t.source, t.model`).all(r.startDay)
    .map(x => ({ ...x, side: x.source, key: x.source === 'claude' ? familyOf(x.model) : codexKey(x.model) }));
  // 2. Codex runs per raw model (daily_runs for counts, runs for durations - same split as the Worker page).
  const dailyRuns = db.prepare(`SELECT m.name model, SUM(runs) runs, SUM(exit0) exit0, SUM(exit72) exit72, SUM(exit73) exit73,
      SUM(other_fail) other_fail, SUM(resumes) resumes FROM daily_runs d JOIN names m ON m.id=d.model WHERE d.day>=? GROUP BY d.model`).all(r.startDay)
    .map(x => ({ ...x, key: codexKey(x.model) }));
  const runRows = db.prepare(`SELECT m.name model, x.started, x.ended FROM runs x JOIN names m ON m.id=x.model WHERE x.started>=?`).all(r.startTs)
    .map(x => ({ ...x, key: codexKey(x.model) }));
  const threads = codexThreads(db, r);
  // 3. Claude sessions with a message in the range; the owner family is counted over ALL their messages.
  const perSession = new Map();
  for (const x of db.prepare(`SELECT c.session_id sid, m.name model, COUNT(*) n FROM claude_messages c JOIN names m ON m.id=c.model
      WHERE c.session_id IN (SELECT DISTINCT session_id FROM claude_messages WHERE ts>=?) AND m.name<>'<synthetic>'
      GROUP BY c.session_id, c.model`).all(r.startTs)) {
    if (!perSession.has(x.sid)) perSession.set(x.sid, new Map());
    const fam = perSession.get(x.sid), f = familyOf(x.model);
    fam.set(f, (fam.get(f) || 0) + x.n);
  }
  const sessionKey = new Map();
  for (const [sid, fam] of perSession) {
    const best = [...fam].sort((a, b) => b[1] - a[1] || FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]))[0];
    sessionKey.set(sid, best[0]);
  }
  // 4. Ledger rows by mapped key.
  const ledger = ledgerRows(db, r, true).map(x => ({ ...x, mapped: ledgerKey(x.model) }));

  // Keys present in the range, per side.
  const keys = new Map();
  const add = (side, key) => { const id = `${side}|${key}`; if (!keys.has(id)) keys.set(id, { side, key }); };
  for (const x of tok) add(x.side, x.key);
  for (const x of dailyRuns) add('codex', x.key);
  for (const x of runRows) add('codex', x.key);
  for (const key of threads.keys()) add('codex', key);
  for (const k of sessionKey.values()) add('claude', k);
  for (const x of ledger) if (x.mapped) add(x.mapped.side, x.mapped.key);
  const both = new Set([...keys.values()].filter(x => x.side === 'claude' && keys.has(`codex|${x.key}`)).map(x => x.key));
  const sideTotal = { claude: sumBy(tok.filter(x => x.side === 'claude'), total), codex: sumBy(tok.filter(x => x.side === 'codex'), total) };

  const rows = [...keys.values()].map(({ side, key }) => {
    const t = tok.filter(x => x.side === side && x.key === key), tokens = t.length ? sumBy(t, total) : null;
    const l = ledger.filter(x => x.mapped && x.mapped.side === side && x.mapped.key === key);
    const base = { id: side === 'codex' && both.has(key) ? `codex:${key}` : key, key, side, tokens, output: t.length ? sumBy(t, x => x.output) : null,
      sharePct: tokens === null ? null : pctOf(tokens, sideTotal[side]),
      ledgerTasks: l.length, cleanPct: l.length ? cleanPct(l) : null, failRounds: l.length ? sumBy(l, x => x.failRounds) : null };
    if (side === 'codex') {
      const d = dailyRuns.filter(x => x.key === key), mine = runRows.filter(x => x.key === key);
      const runs = d.length ? sumBy(d, x => x.runs) : mine.length || null;
      const durs = mine.filter(x => x.ended !== null && x.ended >= x.started).map(x => x.ended - x.started);
      const th = threads.get(key);
      return { ...base, runs, sessions: null, threads: th ? th.threads : null, runTokens: th ? th.runTokens : null, otherTokens: th ? th.otherTokens : null,
        medianSecs: median(durs), n: runs || 0, low: (runs || 0) < LOW_DATA && (th?.threads || 0) < LOW_DATA };
    }
    const sessions = [...sessionKey.values()].filter(k => k === key).length || null;
    return { ...base, runs: null, sessions, threads: null, runTokens: null, otherTokens: null, medianSecs: null, n: sessions || 0, low: (sessions || 0) < LOW_DATA };
  }).sort((a, b) => (a.side === b.side ? (b.tokens ?? -1) - (a.tokens ?? -1) || (a.key < b.key ? -1 : 1) : a.side === 'claude' ? -1 : 1));

  const linkRows = hasTable(db, 'ledger_runs') ? db.prepare('SELECT COUNT(*) n FROM ledger_runs').get().n : 0;
  const out = { models: rows, picked: null, sessionRule: SESSION_RULE, threadRule: THREAD_RULE, ledgerLinkRows: linkRows,
    compare: modelCompare(db, r, tier), pairs: abPairs(db, r) };
  if (typeof wanted !== 'string' || !wanted || wanted.length > 128) return out;
  const prefixed = /^(codex|claude):(.+)$/.exec(wanted);
  const pick = rows.find(x => x.id === wanted) || (prefixed ? rows.find(x => x.side === prefixed[1] && x.key === prefixed[2]) : null);
  if (!pick) return out;
  out.picked = pickedDetail(db, r, pick, { tok, dailyRuns, runRows, sessionKey, ledger });
  return out;
}

function pickedDetail(db, r, row, { tok, dailyRuns, runRows, sessionKey, ledger }) {
  const { side, key } = row;
  const t = tok.filter(x => x.side === side && x.key === key);
  const l = ledger.filter(x => x.mapped && x.mapped.side === side && x.mapped.key === key);
  const byDay = new Map();
  for (const x of t) { const v = byDay.get(x.day) || { day: x.day, input: 0, output: 0, cache_read: 0, cache_write: 0 }; for (const k of ['input', 'output', 'cache_read', 'cache_write']) v[k] += x[k]; byDay.set(x.day, v); }
  const ids = new Map();
  for (const x of t) { if (!ids.has(x.model)) ids.set(x.model, []); ids.get(x.model).push(x); }
  const breakdown = [...ids].map(([id, list]) => ({ id, ...sumTokens(list) })).sort((a, b) => b.total - a.total);
  const sums = t.length ? sumTokens(t) : { input: null, output: null, cache_read: null, cache_write: null, messages: null, total: null };
  const base = { id: row.id, key, side, days: r.list, tokens: { ...sums, sharePct: row.sharePct, runTokens: row.runTokens, otherTokens: row.otherTokens,
    daily: tokenDays(r, [...byDay.values()]) }, threads: row.threads, breakdown, ledger: ledgerStats(l), low: row.low, n: row.n };
  // ledger.task_type is a v7 column: older databases fall back to the keyword rules only.
  const typeOf = hasColumn(db, 'ledger', 'task_type')
    ? new Map(db.prepare('SELECT l.id, n.name type FROM ledger l LEFT JOIN names n ON n.id=l.task_type WHERE l.day>=?').all(r.startDay).map(x => [x.id, x.type])) : new Map();
  const typeCount = new Map();
  for (const x of l) {
    const stored = typeOf.get(x.id);
    const type = stored ? (stored === 'collector' ? 'data' : stored) : classifyTask(x.text);
    typeCount.set(type, (typeCount.get(type) || 0) + 1);
  }
  const label = k => TASK_TYPES.find(x => x.key === k)?.label || (k === 'other' ? 'Other' : k);
  base.ledger.taskTypes = [...typeCount].map(([type, n]) => ({ type, label: label(type), n })).sort((a, b) => b.n - a.n);

  if (side === 'codex') {
    const raw = [...new Set([...dailyRuns, ...runRows, ...t].filter(x => x.key === key).map(x => x.model))];
    const d = dailyRuns.filter(x => x.key === key), mine = runRows.filter(x => x.key === key);
    const durs = mine.filter(x => x.ended !== null && x.ended >= x.started).map(x => x.ended - x.started);
    const inList = raw.length ? `m.name IN (${marks(raw)})` : '0';
    const one = sql => (raw.length ? db.prepare(sql).get(...raw, r.startTs, r.now - 2 * DAY).n : 0);
    const lost = one(`SELECT COUNT(*) n FROM runs x JOIN names m ON m.id=x.model WHERE ${inList} AND x.started>=? AND x.ended IS NULL AND x.started<?`);
    const running = one(`SELECT COUNT(*) n FROM runs x JOIN names m ON m.id=x.model WHERE ${inList} AND x.started>=? AND x.ended IS NULL AND x.started>=?`);
    const efforts = raw.length ? db.prepare(`SELECT e.name effort, COUNT(*) n FROM runs x JOIN names m ON m.id=x.model LEFT JOIN names e ON e.id=x.effort
        WHERE ${inList} AND x.started>=? GROUP BY x.effort ORDER BY n DESC`).all(...raw, r.startTs) : [];
    const last = raw.length ? db.prepare(`SELECT x.run_id, x.codex_session_id, p.name project, x.started, x.ended, x.exit_code, x.is_resume
        FROM runs x JOIN names m ON m.id=x.model LEFT JOIN names p ON p.id=x.project WHERE ${inList} AND x.started>=? ORDER BY x.started DESC, x.run_id LIMIT 20`)
      .all(...raw, r.startTs) : [];
    runTokens(db, last);
    const exit0 = sumBy(d, x => x.exit0), failed = sumBy(d, x => x.exit72 + x.exit73 + x.other_fail);
    // No daily_runs row and no runs row in the range: the run block is null ("no data"), not zeros.
    const runs = d.length || mine.length ? { runs: row.runs, exit0, failed, lost, running, resumes: sumBy(d, x => x.resumes), exit0Pct: pctOf(exit0, exit0 + failed),
      medianSecs: median(durs), p90Secs: p90Of(durs), timed: durs.length } : null;
    return { ...base, ids: raw.length, runs,
      effort: efforts.filter(x => x.effort).map(x => x.effort).join(', ') || null,
      last: last.map(x => ({ started: x.started, repo: x.project || null, secs: x.ended !== null && x.ended >= x.started ? x.ended - x.started : null,
        tokens: x.codex_total, sameSession: Boolean(x.same_session_as), exit: x.exit_code, resume: x.is_resume === 1,
        state: x.ended === null ? (x.started < r.now - 2 * DAY ? 'lost' : 'running') : x.exit_code === 0 ? 'ok' : 'fail' })) };
  }
  // Claude: sessions attributed to this family.
  const sids = [...sessionKey].filter(([, k]) => k === key).map(([sid]) => sid);
  const sidSet = new Set(sids);
  const tools = new Map(), skills = new Map(), agents = new Map();
  if (sids.length) for (const x of db.prepare(`SELECT t.session_id sid, n.name tool, k.name skill, a.name subagent, COUNT(*) n FROM tool_calls t
      JOIN names n ON n.id=t.tool LEFT JOIN names k ON k.id=t.skill LEFT JOIN names a ON a.id=t.subagent
      WHERE t.ts>=? GROUP BY t.session_id, t.tool, t.skill, t.subagent`).all(r.startTs)) {
    if (!sidSet.has(x.sid)) continue;
    tools.set(x.tool, (tools.get(x.tool) || 0) + x.n);
    if (x.skill) skills.set(x.skill, (skills.get(x.skill) || 0) + x.n);
    if (x.subagent) agents.set(x.subagent, (agents.get(x.subagent) || 0) + x.n);
  }
  const stats = sids.length ? db.prepare(`SELECT session_id sid, COUNT(*) messages, SUM(input+output+cache_read+cache_write) tokens, MIN(ts) first, MAX(ts) last
      FROM claude_messages WHERE ts>=? GROUP BY session_id`).all(r.startTs).filter(x => sidSet.has(x.sid)) : [];
  const project = db.prepare('SELECT p.name project FROM claude_sessions s LEFT JOIN names p ON p.id=s.project WHERE s.session_id=?');
  const last = stats.sort((a, b) => b.last - a.last || (a.sid < b.sid ? -1 : 1)).slice(0, 20)
    .map(x => ({ started: x.first, lastTs: x.last, repo: project.get(x.sid)?.project || null, messages: x.messages, tokens: x.tokens }));
  return { ...base, ids: breakdown.length,
    sessions: { n: sids.length || null, messages: t.length ? sumBy(t, x => x.messages) : null, sessionMessages: stats.length ? sumBy(stats, x => x.messages) : null },
    tops: { skills: topOf(skills), tools: topOf(tools), subagents: topOf(agents) }, last };
}

// Page ids = /api/<id>. delegation() is internal (workers().delegation): /api/delegation is a 404.
module.exports = { range, pages: { overview, supervisor, workers, cost, productivity, harness, gates, system, trace, models }, modelCompare, abPairs, gates, compareTier, ledgerKey, tierOf, layerClean, median,
  anomaly, fitLine, forecast, weekOf, exactMedian, TASK_TYPES, classifyTask, capabilityNotes, taskNotes, sideOf, failRounds,
  ledgerRows, runTokens, hookRank, quota, pace, paceHistory, burndown, actionBox, FIRES, RULES, bigThreads, strayAgents, quotaName, latestSample, folders, routeAdvice, routeInputOf, usage, evaluateRules, liveQuotas, ontologyStatus };
