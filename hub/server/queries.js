/* Intent: turn the private hub DB into small JSON payloads, one per dashboard page.
 * Status: UI v3. Reads daily_* tables for charts; raw tables only for trace, scatter,
 * heatmap, MCP/skill tops, compactions, lead time and run durations (raw rows are kept 90 days).
 * v3 adds: Usage totals / model mix / ranked tops with daily series, quota forecast
 * (linear fit per reset period), anomaly flags (median + 2 x MAD over 28 days),
 * Workers quality (weekly clean rate, repair rounds, lead time), compactions per day.
 * v4 adds: supervisor() (Claude only: hands-on vs delegated work, session weight, review catch
 * by layer, model families), the capability and task-type radars (TASK_TYPES keyword rules),
 * Overview "Needs attention", previous-period KPI deltas and per-source daily totals.
 * Next: OpenTelemetry sources later. Blockers: none.
 * Confidence: tests/server.test.js (shapes + helper unit tests) plus a real-DB browser check. */
'use strict';
const { day } = require('../collector/values');

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
const round1 = v => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

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
  const stmt = db.prepare(`SELECT q.ts, q.used_pct FROM quota_snapshots q WHERE q.source=? AND q.window=?
      AND q.resets_at BETWEEN ? AND ? ORDER BY q.ts, q.used_pct`);
  const ids = db.prepare('SELECT id, kind, name FROM names WHERE kind IN (\'source\', \'window\')').all();
  const id = (kind, name) => ids.find(x => x.kind === kind && x.name === name)?.id;
  return quota(db, now).map(q => {
    const base = { source: q.source, window: q.window, resets_at: q.resets_at, used_pct: q.used_pct, expired: q.expired,
      collectorLastRun: lastRun, stale: !collectorFresh, atLimit: q.used_pct >= 100 };
    if (q.expired) return { ...base, n: 0, points: [], enough: false };
    const points = stmt.all(id('source', q.source), id('window', q.window), q.resets_at - 300, q.resets_at + 300);
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
// FAIL rounds written in a ledger layer: every FAIL word counts once, "FAIL x2" counts 2
// ("FAIL x2 then FAIL" = 3). A negated FAIL ("no FAIL", "not FAIL", "0 FAIL") counts 0.
function failRounds(raw) {
  let n = 0;
  for (const m of String(raw || '').matchAll(/(?<!\b(?:no|not|0)\s+)\bFAIL\b(?:\s*x\s*(\d+))?/gi)) n += m[1] ? Number(m[1]) : 1;
  return n;
}
// withText adds the tier + note text for the task-type classifier only; it never leaves the server.
function ledgerRows(db, r, withText = false) {
  return db.prepare(`SELECT l.day, t.name tier, l.layer2, l.l1_raw, l.l2_raw, l.l3_raw, l.l1_count, l.l2_count, l.l3_count,
      m.name model, l.note FROM ledger l LEFT JOIN names t ON t.id=l.tier LEFT JOIN names m ON m.id=l.model WHERE l.day>=?`)
    .all(r.startDay).map(row => {
      const findings = [row.l1_count, row.l2_count, row.l3_count].reduce((a, b) => a + (b || 0), 0);
      const layers = [['L1', row.l1_raw, row.l1_count], ['L2', row.l2_raw, row.l2_count], ['L3', row.l3_raw, row.l3_count]];
      const dirty = layers.find(([, raw, count]) => !layerClean(raw, count));
      const fails = layers.reduce((a, [, raw]) => a + failRounds(raw), 0);
      return { day: row.day, tier: tierOf(row.tier), layer2: row.layer2 === 1, model: row.model,
        clean: !dirty, layer: dirty ? dirty[0] : null, fail: fails > 0, failRounds: fails,
        l2: row.l2_count, l3: row.l3_count, findings, ...(withText ? { text: `${row.tier || ''} ${row.note || ''}` } : {}) };
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
  for (const row of rows) { const k = row[key] ?? '-'; if (!map.has(k)) map.set(k, []); map.get(k).push(row); }
  return map;
}

// Latest snapshot per window in one pass (quota_snapshots has no retention and grows);
// a tie on ts keeps the higher used_pct, the conservative reading.
function quota(db, now) {
  return db.prepare(`SELECT s.name source, w.name window, q.used_pct, q.resets_at, q.ts FROM (
        SELECT source, window, used_pct, resets_at, ts,
          ROW_NUMBER() OVER (PARTITION BY source, window ORDER BY ts DESC, used_pct DESC) rn FROM quota_snapshots) q
      JOIN names s ON s.id=q.source JOIN names w ON w.id=q.window WHERE q.rn=1`).all()
    .map(x => ({ ...x, expired: x.resets_at < now }));
}
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
    if (f.atLimit) items.push({ kind: 'quota-full', level: 'bad', source: f.source, window: f.window, resets_at: f.resets_at });
    else if (f.hit100At) items.push({ kind: 'quota', level: 'bad', source: f.source, window: f.window, hit100At: f.hit100At, resets_at: f.resets_at });
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
    quota: quota(db, r.now),
    forecast: fc,
    anomaly: flags,
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
  return { models, tiers, byModel, reviews, quality: quality(db, r, ledger, order) };
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
  // Highest used % per local day and window: the chart needs nothing finer.
  const quotaLine = db.prepare(`SELECT date(q.ts, 'unixepoch', 'localtime') day, s.name source, w.name window, MAX(q.used_pct) used_pct
      FROM quota_snapshots q JOIN names s ON s.id=q.source JOIN names w ON w.id=q.window
      WHERE q.ts>=? GROUP BY 1, q.source, q.window ORDER BY 1`).all(r.startTs);
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
    totals, models, mix: modelMix(db, r), cache, quota: quota(db, r.now), quotaLine, forecast: forecast(db, r.now),
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
    claudeOut: series(r, tokens, x => x.output, x => x.source === 'claude'),
    codexOut: series(r, tokens, x => x.output, x => x.source === 'codex'),
    split: { claudeOut, codexOut, supervisorPct: claudeOut + codexOut ? Math.round(claudeOut / (claudeOut + codexOut) * 1000) / 10 : null },
    heat, dispatch, compactions, calendar,
    compactPerDay: r.list.map(d => byDay.get(d)?.n || 0),
    compactPreTokens: r.list.map(d => (byDay.has(d) ? Math.round(byDay.get(d).pre) : null)),
    compactMaxPre: r.list.map(d => byDay.get(d)?.max_pre ?? null)
  };
}

function harness(db, r) {
  const scripts = db.prepare(`SELECT s.name script, e.name event, SUM(runs) runs, SUM(errors) errors, SUM(timeouts) timeouts,
      MAX(p95_ms) p95_ms FROM daily_hooks h JOIN names s ON s.id=h.script JOIN names e ON e.id=h.event
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
      c.output codex_output, c.total_tokens codex_total, c.duration_ms codex_ms, c.reasoning codex_reasoning,
      ${hasBranch(db) ? 'COALESCE(cb.name, sb.name)' : 'NULL'} branch
      FROM runs x LEFT JOIN names p ON p.id=x.project LEFT JOIN names m ON m.id=x.model LEFT JOIN names e ON e.id=x.effort
      LEFT JOIN codex_sessions c ON c.session_id=x.codex_session_id
      ${hasBranch(db) ? `LEFT JOIN names cb ON cb.id=c.branch
      LEFT JOIN claude_sessions cs ON cs.session_id=x.claude_session_id LEFT JOIN names sb ON sb.id=cs.branch` : ''}
      WHERE x.started>=? ORDER BY x.started DESC LIMIT 120`).all(r.startTs);
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

module.exports = { range, pages: { overview, workers, cost, productivity, harness, trace, supervisor }, tierOf, layerClean, median,
  anomaly, fitLine, forecast, weekOf, exactMedian, TASK_TYPES, classifyTask, capabilityNotes, taskNotes, sideOf, failRounds };
