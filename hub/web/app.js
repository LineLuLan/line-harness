/* Intent: Line Hub dashboard - seven read-only pages over /api/<page>?days=N.
 * Status: UI v4. Portfolio look (dark + kafka, light toggle), titles phrased as questions with
 * source notes behind an (i) tip, a one-glance Overview (KPIs with delta + sparkline, "Needs
 * attention", activity, Claude vs Codex, radar preview) and a Supervisor page that tracks
 * Claude only, with two Claude vs Codex radars. Claude = kafka, Codex = nebula on every page.
 * v3 kept: Usage (route id 'cost'), forecasts, anomaly badges, Workers > Quality, Trace lanes.
 * Next: none. Blockers: none. Confidence: headless Edge screenshots at 1440x900 and 1920x1080. */
import { h, render, cloneElement } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { Chart, COLORS as C, fmt, installTips, refreshColors } from './charts.js';
import { KIND, SOURCE, modelColors, share, SegBar, ShareBar, Spark, Delta, RunScatter, ForecastPlot, forecastText, Flag, runStatus, stamp, Radar } from './viz.js';
const html = htm.bind(h);

// Simple stroke icons (24x24 viewBox), drawn for this project.
const ICON = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  supervisor: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7M16.5 17.5l1.5 1.5 3-3',
  workers: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  cost: 'M4 18a8 8 0 1 1 16 0M12 18l4.5-5.5M7 18h10',
  productivity: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  harness: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  trace: 'M4 6h9M4 12h16M4 18h6M15 4v4M18 10v4M12 16v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
};
const PAGES = [
  { id: 'overview', label: 'Overview', lead: 'The whole harness at a glance.' },
  { id: 'supervisor', label: 'Supervisor', lead: 'Claude only: hands-on work, sessions, review and models.' },
  { id: 'workers', label: 'Worker', lead: 'Codex only: run outcomes and review quality.' },
  { id: 'cost', label: 'Usage', lead: 'Tokens and quota by source, model, skill and tool.' },
  { id: 'productivity', label: 'Productivity', lead: 'Volume, speed and the supervisor / worker split.' },
  { id: 'harness', label: 'Harness', lead: 'Hooks, sandbox and collector health.' },
  { id: 'trace', label: 'Trace', lead: 'Claude sessions by repo; each bar is one Codex run.' }
];
const RANGES = [[1, '24h'], [7, '7d'], [14, '14d'], [30, '30d'], [90, '90d']];
const pct = v => (v === null || v === undefined ? '–' : `${v}%`);
const secs = v => {
  if (v === null || v === undefined) return '–';
  const s = Math.round(v);
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
};
const when = ts => (ts ? new Date(ts * 1000).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '–');
const short = id => (id ? id.slice(0, 8) : '–');
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const round1 = v => Math.round(v * 10) / 10;
const SIDES = () => [{ key: 'claude', label: 'Claude (supervisor)', color: C.claude }, { key: 'codex', label: 'Codex (worker)', color: C.codex, dash: true }];

/* Theme: dark by default, remembered per browser (storage can be blocked: try/catch). */
const THEME_KEY = 'line-hub-theme';
function storedTheme() { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private window: not remembered */ }
  refreshColors();
}

function readHash() {
  const [raw, q] = location.hash.replace(/^#/, '').split('?');
  const page = raw === 'usage' ? 'cost' : raw; // the page was renamed; its route id stayed 'cost'
  const days = Number(new URLSearchParams(q || '').get('days'));
  return { page: PAGES.some(p => p.id === page) ? page : 'overview', days: RANGES.some(r => r[0] === days) ? days : 14 };
}
const Icon = ({ d }) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

function App() {
  const [state, setState] = useState(readHash);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => { const on = () => setState(readHash()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => {
    let live = true;
    setError(null);
    const load = () => fetch(`/api/${state.page}?days=${state.days}`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error === 'no-db' ? 'No data yet. Run: npm run collect -- --full' : `Server error (${body.error || r.status})`);
      return body;
    }).then(b => { if (live) { setError(null); setPayload({ ...b, page: state.page }); } })
      .catch(e => live && setError(e instanceof TypeError ? 'The Line Hub server has stopped. Start it again: npm run hub' : e.message));
    load();
    // Poll only while the tab is visible, so a forgotten background tab lets the server idle out.
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const t = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [state.page, state.days]);
  const go = (page, days) => { location.hash = `${page}?days=${days}`; };
  // New colours are read first; the keyed <main> then remounts so every chart redraws with them.
  const toggleTheme = () => { const t = theme === 'dark' ? 'light' : 'dark'; applyTheme(t); setTheme(t); };
  const ready = payload && payload.page === state.page && payload.range.days === state.days;
  const age = payload?.collected ? payload.now - payload.collected : null;
  const current = PAGES.find(p => p.id === state.page);
  return html`<div class="shell">
    <aside class="side">
      <div class="brand"><span class="dot"></span><span class="name">Line Hub</span></div>
      <div class="nav-label">Dashboard</div>
      <nav class="menu">${PAGES.map(p => html`<button class=${p.id === state.page ? 'on' : ''} title=${p.label} onClick=${() => go(p.id, state.days)}>
        <${Icon} d=${ICON[p.id]} /><span>${p.label}</span></button>`)}</nav>
      <div class="side-foot">
        ${payload?.collected ? html`<div class="when-block">Last collected<br /><span class=${'when' + (age > 6 * 3600 ? ' stale' : '')}>${when(payload.collected)}</span></div>` : ''}
        <button class="theme-toggle" onClick=${toggleTheme} title=${`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <${Icon} d=${theme === 'dark' ? ICON.sun : ICON.moon} /><span>${theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button>
      </div>
    </aside>
    <div class="content">
      <header class="bar">
        <div><h1>${current.label}</h1><div class="lead">${current.lead}</div></div>
        <span class="spacer"></span>
        <div class="ranges">${RANGES.map(([d, l]) => html`<button class=${d === state.days ? 'on' : ''} onClick=${() => go(state.page, d)}>${l}</button>`)}</div>
      </header>
      <main key=${theme}>${error ? html`<div class="error">${error}</div>` : !ready ? html`<p class="boot">Loading…</p>` : html`<${Page} id=${state.page} p=${payload} />`}</main>
    </div>
  </div>`;
}

function Page({ id, p }) {
  const View = { overview: Overview, supervisor: Supervisor, workers: Workers, cost: Cost, productivity: Productivity, harness: Harness, trace: Trace }[id];
  return html`<${View} d=${p.data} range=${p.range} now=${p.now} />`;
}
// KPI row: all cards in one even row; on narrower windows two even rows (no orphan card).
const Kpis = ({ children }) => {
  const n = [].concat(children).flat(Infinity).filter(Boolean).length;
  return html`<div class=${'grid kpis' + (n > 5 ? ' wrap' : '')} style=${`--n:${n};--half:${Math.ceil(n / 2)}`}>${children}</div>`;
};
// (i) next to a title: the source / method note, shown by the shared hover tip (installTips).
const Info = ({ text }) => (text ? html`<span class="info" role="img" aria-label=${text} title=${text}>i</span>` : '');
const Kpi = ({ label, value, sub, tone = '', flag = null, info, delta, spark, children }) => html`<div class=${'card kpi ' + tone}>
  <div class="kpi-head"><span class="label">${label}</span><${Info} text=${info} /><${Flag} a=${flag} label=${label} /></div>
  <div class="value">${value}</div>
  ${sub ? html`<div class="sub" title=${sub}>${sub}</div>` : ''}${children || ''}
  ${delta || spark ? html`<div class="kpi-foot">${delta || html`<span></span>`}${spark || ''}</div>` : ''}</div>`;
const Card = ({ title, src, sub, children, span, span2, tall, tools, top }) => html`<section class=${'card' + (span ? ' span-all' : '') + (span2 ? ' span-2' : '') + (tall ? ' tall' : '') + (top ? ' card-top' : '')}>
  <div class="card-head"><div class="card-title"><h3>${title}</h3><${Info} text=${src} /></div>${tools ? html`<div class="card-tools">${tools}</div>` : ''}</div>
  ${sub ? html`<p class="card-sub">${sub}</p>` : ''}<div class="fill">${children}</div></section>`;
// Two-column grid that never leaves half a row empty: in every run of normal cards between
// full-width ones, an odd last card spans both columns.
const Grid = ({ children }) => {
  const list = [].concat(children).flat(Infinity).filter(c => c && typeof c === 'object');
  const out = [...list];
  let run = [];
  const close = () => { if (run.length % 2) out[run.at(-1)] = cloneElement(out[run.at(-1)], { span: true }); run = []; };
  list.forEach((c, i) => { if (c.props?.span) close(); else run.push(i); });
  close();
  return html`<div class="grid cols-2">${out}</div>`;
};
const Chips = ({ options, value, onPick }) => html`<div class="filters">${options.map(([k, l]) =>
  html`<button class=${'chip' + (k === value ? ' on' : '')} onClick=${() => onPick(k)}>${l}</button>`)}</div>`;
const tone = (v, good, warn) => (v === null || v === undefined ? '' : v >= good ? 'good' : v >= warn ? 'warn' : 'bad');
const Name = ({ text, children }) => html`<td class="name" title=${text}>${children ?? text}</td>`;
const NoData = ({ title, field }) => html`<div class="nodata"><b>${title}</b><span>Missing data: <code>${field}</code>. No value is estimated.</span></div>`;

// Change against the previous period of the same length. goodUp: true / false / null (neutral).
function KDelta({ now, prev, days, unit = 'pct', goodUp = null, show = String }) {
  const span = days === 1 ? 'yesterday' : `the ${days} days before`;
  if (now === null || now === undefined || prev === null || prev === undefined) return html`<span class="kdelta flat" title=${`no data for ${span}`}>no prior data</span>`;
  const tip = `${show(now)} now vs ${show(prev)} in ${span}`;
  let d, text;
  if (unit === 'pts') { d = round1(now - prev); text = `${d > 0 ? '+' : ''}${d} pts`; }
  else {
    if (!prev) return html`<span class="kdelta flat" title=${tip}>${now ? 'new' : 'flat'}</span>`;
    d = Math.round((now - prev) / prev * 100); text = `${d > 0 ? '+' : ''}${d}%`;
  }
  const cls = d === 0 || goodUp === null ? 'flat' : (d > 0) === goodUp ? 'up' : 'down';
  return html`<span class=${'kdelta ' + cls} title=${tip}>${text} <span class="muted">vs prior</span></span>`;
}

const QUOTA_NAME = { 'codex:primary': 'Codex (week)', 'claude:five_hour': 'Claude 5 h', 'claude:seven_day': 'Claude 7 d' };
const quotaName = q => QUOTA_NAME[`${q.source}:${q.window}`] || `${q.source} ${q.window}`;
const findForecast = (list, q) => (list || []).find(f => f.source === q.source && f.window === q.window);

// Shares in 0.1 % steps that add up to exactly 100 per day: the rounding remainder goes to that
// day's largest series, so a 100% stack never overshoots yMax.
function shares100(list, n) {
  const shares = list.map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const all = sum(list.map(m => m[i]));
    if (!all) continue;
    let big = 0, used = 0;
    list.forEach((m, k) => { shares[k][i] = Math.round(m[i] / all * 1000); used += shares[k][i]; if (m[i] > list[big][i]) big = k; });
    shares[big][i] += 1000 - used;
    list.forEach((_, k) => { shares[k][i] /= 10; });
  }
  return shares;
}

/* ---------- Overview ---------- */
// Active day = at least one Claude message or worker run. The current streak may end yesterday.
function streaks(calendar) {
  const on = calendar.map(d => d.messages + d.runs > 0);
  let longest = 0, run = 0;
  for (const v of on) { run = v ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = on.length - 1;
  if (i >= 0 && !on[i]) i--;
  let current = 0;
  for (; i >= 0 && on[i]; i--) current++;
  return { current, longest, active: on.filter(Boolean).length };
}
function attentionText(a, days) {
  const page = p => `#${p}?days=${days}`;
  switch (a.kind) {
    case 'anomaly': return { title: `${a.label} is unusually high`, detail: `today ${fmt(a.today)} vs threshold ${fmt(a.threshold)} (28-day median ${fmt(a.median)})` };
    case 'quota': return { title: `${quotaName(a)} may run out before its reset`, detail: `projected 100% at ${stamp(a.hit100At)} · resets ${stamp(a.resets_at)}`, href: page('cost'), link: 'Usage' };
    case 'quota-full': return { title: `${quotaName(a)} is used up`, detail: `resets ${stamp(a.resets_at)}`, href: page('cost'), link: 'Usage' };
    case 'failed': return { title: `${plural(a.n, 'worker run')} failed`, detail: 'exit code other than 0', href: page('trace'), link: 'Trace' };
    case 'lost': return { title: `${plural(a.n, 'worker run')} lost`, detail: 'no exit code 2 days after the start', href: page('trace'), link: 'Trace' };
    case 'review-fail': return { title: `${plural(a.n, 'codex-review')} returned FAIL`, detail: 'verdicts in reviews.jsonl', href: page('workers'), link: 'Worker' };
    case 'ledger-fail': return { title: `${plural(a.n, 'ledger task')} had a FAIL round`, detail: `${plural(a.rounds, 'FAIL round')} in review-ledger.log`, href: page('supervisor'), link: 'Supervisor' };
    case 'collector': return { title: 'Collector data is stale', detail: a.lastRun ? `last run ${stamp(a.lastRun)} (${a.hours} h ago)` : 'the collector has never finished a run', href: page('harness'), link: 'Harness' };
    default: return { title: a.kind, detail: '' };
  }
}
function Attention({ items, days }) {
  if (!items.length) return html`<div class="all-clear"><i></i><div><b>All clear</b><div class="muted">No flags, failed runs, FAIL reviews, quota risk or stale data in this range.</div></div></div>`;
  return html`<ul class="attn">${items.map(a => {
    const t = attentionText(a, days);
    return html`<li><i class=${'lvl ' + a.level}></i><div class="what"><b>${t.title}</b><span title=${t.detail}>${t.detail}</span></div>
      ${t.href ? html`<a href=${t.href}>${t.link} →</a>` : html`<span></span>`}</li>`;
  })}</ul>`;
}
// Capability axes from the server -> Radar props. A null score is drawn as a gap (n/a).
const capabilityAxes = axes => axes.map(a => {
  const side = (s, name) => (a[s].score === null ? `${name}: n/a - ${a[s].na}` : `${name}: ${a[s].score} (${a[s].value})`);
  const tip = `${a.label}\n${a.formula}\n${side('claude', 'Claude')}\n${side('codex', 'Codex')}`;
  const na = ['claude', 'codex'].filter(s => a[s].score === null).map(s => (s === 'claude' ? 'Claude' : 'Codex'));
  const low = ['claude', 'codex'].filter(s => a[s].score !== null && a[s].n < 3).map(s => (s === 'claude' ? 'Claude' : 'Codex'));
  const sub = [na.length ? `${na.join(' + ')} n/a` : '', low.length ? `${low.join(' + ')} low data` : ''].filter(Boolean).join(' · ');
  const val = s => ({ score: a[s].score, low: a[s].score !== null && a[s].n < 3, tip: side(s, s === 'claude' ? 'Claude' : 'Codex') + (a[s].score !== null && a[s].n < 3 ? ` - low data (n = ${a[s].n})` : '') });
  return { label: a.label, tip, sub, values: { claude: val('claude'), codex: val('codex') } };
});
const taskAxes = axes => axes.map(a => {
  const v = (s, name) => (a[s].n ? { score: a[s].pct, low: a[s].low, tip: `${name}: ${a[s].pct}% first pass (${a[s].clean} of ${a[s].n} tasks)${a[s].low ? ' - low data' : ''}` }
    : { score: null, tip: `${name}: no task of this type` });
  const lowAll = a.claude.n < 3 && a.codex.n < 3;
  return { label: a.label, lowAll, sub: lowAll ? 'low data' : `n ${a.claude.n} / ${a.codex.n}`,
    tip: `${a.label}: PASS-first-time % per side\nClaude: ${a.claude.n ? `${a.claude.pct}% of ${a.claude.n}` : 'no task'}\nCodex: ${a.codex.n ? `${a.codex.pct}% of ${a.codex.n}` : 'no task'}${lowAll ? '\nlow data: n < 3 on both sides' : ''}`,
    values: { claude: v('claude', 'Claude'), codex: v('codex', 'Codex') } };
});
const Suggest = ({ notes }) => html`<div class="suggest"><h4>What this suggests</h4>${notes.map(n => html`<p>${n}</p>`)}</div>`;

function Overview({ d, range }) {
  const k = d.kpi, days = range.days;
  const live = d.quota.filter(q => !q.expired);
  const low = live.length ? live.reduce((a, q) => (q.used_pct > a.used_pct ? q : a)) : null;
  const lowF = low ? findForecast(d.forecast, low) : null, lowFt = forecastText(lowF, true);
  const left = low ? Math.max(0, Math.round(100 - low.used_pct)) : null;
  const st = useMemo(() => streaks(d.calendar), [d]);
  const totalDaily = useMemo(() => d.chart.days.map((_, i) => d.chart.claudeAll[i] + d.chart.codexAll[i]), [d]);
  const tokenSeries = useMemo(() => [
    { label: 'Claude', data: d.chart.claudeAll, color: C.claude, kind: 'bar' }, { label: 'Codex', data: d.chart.codexAll, color: C.codex, kind: 'bar' }], [d]);
  const rangeAll = k.claudeRange + k.codexRange;
  return html`
    <${Kpis}>
      <${Kpi} label="Tokens today" value=${fmt(k.tokensToday)} sub=${`Claude ${fmt(k.claudeToday)} · Codex ${fmt(k.codexToday)}`} flag=${d.anomaly?.tokensToday}
        info="All tokens today (fresh input + cache read + cache write + output). Source: daily_tokens." spark=${html`<${Spark} data=${totalDaily} color=${C.claude} />`} />
      <${Kpi} label="Tokens in range" value=${fmt(rangeAll)} sub=${`Claude ${share(k.claudeRange, rangeAll)} · Codex ${share(k.codexRange, rangeAll)}`}
        info="All tokens in the selected range, both sources. No change is shown at 24h: today is still partial." delta=${days > 1 ? html`<${KDelta} now=${rangeAll} prev=${k.prev.tokens} days=${days} show=${fmt} />` : null} />
      <${Kpi} label="Worker runs" value=${k.runsRange} sub=${`exit 0 ${pct(k.exit0Pct)}${k.activeRuns ? ` · ${k.activeRuns} running` : ''}`} tone=${tone(k.exit0Pct, 90, 75)} flag=${d.anomaly?.runsToday}
        info="codex-do runs that started in the range. Exit 0 % counts finished runs only. Source: daily_runs."
        delta=${days > 1 ? html`<${KDelta} now=${k.runsRange} prev=${k.prev.runs} days=${days} />` : null} spark=${html`<${Spark} data=${d.chart.runs} color=${C.codex} />`} />
      <${Kpi} label="First-pass PASS" value=${pct(k.tasks.cleanPct)} sub=${`${k.tasks.clean} of ${k.tasks.tasks} ledger tasks clean`} tone=${tone(k.tasks.cleanPct, 70, 45)}
        info="Ledger tasks whose L1, L2 and L3 found nothing and did not FAIL. Source: review-ledger.log."
        delta=${days > 1 ? html`<${KDelta} now=${k.tasks.cleanPct} prev=${k.prev.cleanPct} days=${days} unit="pts" goodUp=${true} show=${pct} />` : null} />
      <${Kpi} label="Quota left" value=${left === null ? '–' : `${left}%`} sub=${low ? `${quotaName(low)} · ${lowFt.text}` : 'no live quota snapshot'}
        tone=${left === null ? '' : left <= 15 ? 'bad' : left <= 40 ? 'warn' : 'good'}
        info=${`Lowest quota left across windows, with its linear forecast.\n${d.quota.map(q => `${quotaName(q)}: ${q.expired ? 'period ended' : `${Math.round(q.used_pct)}% used, resets ${stamp(q.resets_at)}`}`).join('\n') || 'no snapshots'}`}>
        ${low ? html`<div class=${'meter ' + (left <= 15 ? 'bad' : left <= 40 ? 'warn' : '')}><i style=${`width:${Math.min(100, Math.round(low.used_pct))}%`}></i></div>` : ''}<//>
      <${Kpi} label="Active streak" value=${plural(st.current, 'day')} sub=${`longest ${st.longest} d · ${st.active} active days in 12 months`}
        info="Days in a row with at least one Claude message or worker run, ending today (or yesterday if today is still empty)." />
    <//>
    <div class="grid cols-3">
      <${Card} title="What needs attention?" src="Anomaly flags (median + 2 x MAD over 28 days), failed or lost runs, codex-review FAIL verdicts, ledger FAIL rounds, a quota forecast that hits 100% before reset, and collector data older than 6 h.">
        <${Attention} items=${d.attention} days=${days} /><//>
      <${Card} span2=${true} title="When was the harness active?" src="Last 12 months whatever the range, like a GitHub contribution graph. Sources: daily_tokens, daily_runs, review-ledger.log.">
        <${YearHeat} days=${d.calendar} /><//>
    </div>
    <div class="grid cols-3">
      <${Card} span2=${true} title="Who used the tokens: Claude or Codex?" src="All tokens per day, stacked. Codex fresh input excludes its cached tokens, so both sources add up the same way. Source: daily_tokens.">
        <div class="stack"><${ShareBar} parts=${[{ v: k.claudeRange, color: C.claude, label: 'Claude' }, { v: k.codexRange, color: C.codex, label: 'Codex' }]} />
        <${Chart} days=${d.chart.days} series=${tokenSeries} stacked=${true} height=${170} /></div><//>
      <${Card} title="What is each side good at?" src=${'Preview of the capability radar on the Supervisor page. Hover an axis label for its formula.'}
        tools=${html`<a class="linkish" href=${`#supervisor?days=${days}`}>Supervisor →</a>`}>
        <div class="radar-mini"><${Radar} axes=${capabilityAxes(d.radar.axes)} series=${SIDES()} width=${380} height=${250} R=${80} />
          ${d.radar.notes.length ? html`<${Suggest} notes=${d.radar.notes.slice(0, 2)} />` : ''}</div><//>
    </div>`;
}

/* ---------- Supervisor (Claude only) ---------- */
const FAMILY_COLOR = () => ({ Opus: C.claude, Fable: C.mars, Sonnet: C.aurora, Haiku: C.rose, Other: C.neutral });
function Supervisor({ d, range }) {
  const s = d.sessions, rv = d.review, w = d.work;
  const self = sum(w.self), disp = sum(w.dispatches), agents = sum(w.agents), handsAll = self + disp + agents;
  const famAll = sum(d.models.map(m => m.total));
  const opus = d.models.find(m => m.family === 'Opus')?.total || 0, fable = d.models.find(m => m.family === 'Fable')?.total || 0;
  const workSeries = useMemo(() => [
    { label: 'Edits in Claude sessions (incl. sub-agents)', data: w.self, color: C.claude, kind: 'bar' },
    { label: 'Codex dispatches', data: w.dispatches, color: C.codex, kind: 'bar' },
    { label: 'Sub-agents (Agent)', data: w.agents, color: C.mars, kind: 'bar' }], [d]);
  const famColors = FAMILY_COLOR();
  const modelSeries = useMemo(() => {
    const sh = shares100(d.models.map(m => m.data), d.days.length);
    return d.models.map((m, i) => ({ label: m.family, data: sh[i], color: famColors[m.family] || C.neutral, kind: 'bar', fmt: v => `${v}%` }));
  }, [d]);
  const reviewSeries = useMemo(() => [
    { label: 'Clean', data: rv.weeks.map(x => x.clean), color: C.aurora, kind: 'bar' },
    { label: 'Caught at L1 (gates)', data: rv.weeks.map(x => x.L1), color: C.neutral, kind: 'bar' },
    { label: 'Caught at L2 (model review)', data: rv.weeks.map(x => x.L2), color: C.codex, kind: 'bar' },
    { label: 'Caught at L3 (supervisor)', data: rv.weeks.map(x => x.L3), color: C.claude, kind: 'bar' }], [d]);
  const top = Math.max(1, ...s.top.map(x => x.tokens));
  const verdicts = rv.reviews.map(x => `${x.verdict} ${x.n}`).join(' · ');
  return html`
    <${Kpis}>
      <${Kpi} label="Claude sessions" value=${s.n} sub=${s.n ? `median ${s.median.messages} msgs, ${fmt(s.median.tokens)} tok` : 'no messages in range'}
        info="Sessions with at least one Claude message in the range. Source: claude_messages (raw rows kept 90 days)." />
      <${Kpi} label="Session edits" value=${self.toLocaleString('en-GB')} sub=${`incl. sub-agents · ${disp + agents} out`}
        info=${`Edits in Claude sessions (incl. sub-agents): Edit / Write / MultiEdit / NotebookEdit calls in Claude transcripts, including calls made inside sub-agents. The logs carry no sidechain flag, so the two cannot be told apart. "out" = work handed off: ${disp} Codex dispatches (do, resume, rescue) + ${agents} Agent calls. This is not a clean self-vs-delegate split.`}
        spark=${html`<${Spark} data=${w.self} color=${C.claude} />`} />
      <${Kpi} label="Peak context" value=${s.n ? fmt(s.median.peak) : '–'} sub=${`session median · ${s.compactions} compactions`}
        info="Largest single-message context (fresh input + cache read + cache write) per session, median over sessions. The context window size is not stored, so this is tokens, not %." />
      <${Kpi} label="Review catch rate" value=${rv.tasks ? `${Math.round(rv.caught / rv.tasks * 100)}%` : '–'} sub=${`${rv.caught} of ${rv.tasks} tasks · ${rv.failRounds} FAIL`}
        info="Ledger tasks where L1, L2 or L3 found something. Source: review-ledger.log." />
      <${Kpi} label="Opus share" value=${famAll ? share(opus, famAll) : '–'} sub=${famAll ? `Fable ${share(fable, famAll)} · other ${share(famAll - opus - fable, famAll)}` : 'no Claude tokens'}
        info="Share of all Claude tokens by model family. Source: daily_tokens." />
    <//>
    <${Grid}>
      <${Card} span=${true} title="How much is edited in Claude sessions vs handed off?" sub="Per day: edits in Claude sessions (incl. sub-agents) vs work handed to Codex or a sub-agent."
        src="Edits = Edit, Write, MultiEdit and NotebookEdit calls (daily_tools). They include calls made inside sub-agents: no sidechain flag is stored, so this is not a clean self-vs-delegate split. Codex dispatches = codex-do do / resume / rescue (dispatches; reviews left out). Sub-agents = Agent calls (daily_tools).">
        ${handsAll ? html`<${Chart} days=${d.days} series=${workSeries} stacked=${true} height=${200} />` : html`<${NoData} title="No edits, dispatches or Agent calls in this range" field="daily_tools (Edit, Write, Agent) and dispatches" />`}<//>
      <${Card} title="How heavy are Claude sessions?" sub=${s.n ? `median ${s.median.messages} messages · ${fmt(s.median.tokens)} tokens · peak ${fmt(s.median.peak)}` : ''}
        src=${'Top 10 sessions by tokens in the range. Turns = human turns over the whole session (human_turns has no timestamp). Peak = largest context of one message. Compactions = compactions in the range.'}>
        ${s.n ? html`<div class="ranked sessions">
          <div class="rk-row head"><span>Session</span><span>Tokens</span><span class="n">Msgs</span><span class="n">Peak</span><span class="n">Turns</span><span class="n">Cmp</span></div>
          ${s.top.map(x => html`<div class="rk-row" title=${`${x.id} · ${x.project || 'no repo'} · ${x.model || '–'}\n${when(x.first)} → ${when(x.last)}\ntokens ${x.tokens.toLocaleString('en-GB')} · output ${x.output.toLocaleString('en-GB')}`}>
            <span class="rk-name"><span class="mono">${x.id}</span><span class="ell muted">${x.project || ''}</span></span>
            <span class="rk-bar"><${SegBar} parts=${[{ v: x.tokens, color: C.claude, label: 'tokens' }]} of=${x.tokens / top * 100} height=${8} /></span>
            <span class="n">${x.messages}</span><span class="n">${fmt(x.peak)}</span><span class="n">${x.turns ?? '–'}</span><span class="n">${x.compactions || '·'}</span></div>`)}
          ${s.n > s.top.length ? html`<div class="rk-foot">top ${s.top.length} of ${s.n} sessions</div>` : ''}</div>`
          : html`<${NoData} title="No Claude messages in this range" field="claude_messages" />`}<//>
      <${Card} title="Which Claude models carry the work?" src="Share of all Claude tokens per day by model family (Opus, Fable, Sonnet, Haiku, other). Source: daily_tokens.">
        ${d.models.length ? html`<div class="stack"><${ShareBar} parts=${d.models.map(m => ({ v: m.total, color: famColors[m.family] || C.neutral, label: m.family }))} />
          <${Chart} days=${d.days} series=${modelSeries} stacked=${true} yMax=${100} height=${170} /></div>` : html`<${NoData} title="No Claude tokens in this range" field="daily_tokens (source claude)" />`}<//>
      <${Card} span=${true} title="How often does review catch problems?" sub=${rv.tasks ? `${rv.caught} of ${rv.tasks} tasks had a finding · L1 ${rv.byLayer.L1} · L2 ${rv.byLayer.L2} · L3 ${rv.byLayer.L3} · ${plural(rv.failRounds, 'FAIL round')}${verdicts ? ` · codex-review ${verdicts}` : ''}` : ''}
        src="Ledger tasks per week (weeks start Monday) by the first layer that found something: L1 deterministic gates, L2 fresh model review, L3 supervisor verification. FAIL rounds come from the ledger text (FAIL x2 = 2). Sources: review-ledger.log, reviews.jsonl.">
        ${rv.tasks ? html`<${Chart} days=${rv.weeks.map(x => x.week)} series=${reviewSeries} stacked=${true} height=${190} />` : html`<${NoData} title="No ledger tasks in this range" field="ledger (review-ledger.log)" />`}<//>
    <//>
    <div class="grid cols-3">
      <${Card} top=${true} title="Which skills does Claude lean on?" src="Skill tool calls. Source: tool_calls (raw rows kept 90 days)."><${Ranked} t=${d.tops.skills} color=${C.claude} compact=${true} /><//>
      <${Card} top=${true} title="Which sub-agents does it start?" src="Agent tool calls by agent type. Source: tool_calls."><${Ranked} t=${d.tops.subagents} color=${C.claude} unit="runs" compact=${true} /><//>
      <${Card} top=${true} title="Which MCP servers does it call?" src="Calls per MCP server. Source: tool_calls."><${Ranked} t=${d.tops.mcp} color=${C.claude} compact=${true} /><//>
    </div>
    <h2 class="section">Claude vs Codex</h2>
    <div class="grid cols-2">
      <${Card} title="Strengths by capability" sub="Each axis 0-100; hover an axis label for its formula and raw value."
        src="Six axes over the selected range. A side with no stored signal is n/a: its polygon has a gap there and no value is made up.">
        <${Radar} axes=${capabilityAxes(d.radar.capability.axes)} series=${SIDES()} />
        <${Suggest} notes=${d.radar.capability.notes} /><//>
      <${Card} title="Strengths by task type" sub="PASS-first-time % per task type; hollow points have fewer than 3 tasks."
        src=${`Ledger tasks classified by keyword rules on the tier and note text (TASK_TYPES in server/queries.js). The side is the model named in the ledger note. ${d.radar.tasks.other} tasks matched no type and ${d.radar.tasks.unknown} name no known model; both are left out.`}>
        <${Radar} axes=${taskAxes(d.radar.tasks.axes)} series=${SIDES()} lowLegend=${true} />
        <${Suggest} notes=${d.radar.tasks.notes} /><//>
    </div>`;
}

/* ---------- Worker ---------- */
function Workers({ d }) {
  const maxRuns = Math.max(1, ...d.models.map(m => m.runs));
  const q = d.quality;
  return html`
    <${Grid}>
      <${Card} title="Which worker models run cleanly?" src="codex-do runs per model: exit code and run time. Source: runs/*." span=${true}>
        <table><thead><tr><th>Model</th><th class="n">Run</th><th class="n">Exit 0</th><th class="n opt">Exit 72</th><th class="n opt">Exit 73</th><th class="n">Other fail</th><th class="n opt">Resume</th><th class="n">Median</th></tr></thead>
        <tbody>${d.models.length ? d.models.map(m => html`<tr><td class="name bar-cell" title=${m.model}><i style=${`width:${m.runs / maxRuns * 100}%`}></i>${m.model}</td><td class="n">${m.runs}</td>
          <td class="n">${pct(m.finished ? Math.round(m.exit0 / m.finished * 1000) / 10 : null)}</td><td class="n opt">${m.exit72 || '·'}</td><td class="n opt">${m.exit73 || '·'}</td>
          <td class="n">${m.other_fail || '·'}</td><td class="n opt">${m.resumes || '·'}</td><td class="n">${secs(m.medianSecs)}</td></tr>`) : html`<tr><td colspan="8" class="empty">No runs</td></tr>`}</tbody></table><//>
    <//>
    <h2 class="section">Quality</h2>
    <${Grid}>
      <${Card} span=${q.clean.weeks.length - Math.max(0, q.clean.all.findIndex(x => x.clean + x.dirty > 0)) > 8} title="Is the worker passing review on the first try?" src="Share of ledger tasks with no finding in L1, L2 or L3, per week (weeks start Monday). Source: review-ledger.log."><${CleanWeeks} c=${q.clean} /><//>
      <${Card} title="How often does a run need a repair round?" src="Bars: runs and resumes (codex-do -Resume) per week. Line: resumes as a share of runs. Source: daily_runs."><${Repair} rows=${q.repair} /><//>
      <${Card} title="How long from first run to final review?" src="First worker run of a Claude session to its last codex-review in the same repo. Reviews carry no session id, so they are linked by repo and time."><${Lead} l=${q.lead} /><//>
      <${Card} title="Which review tiers find problems?" src="Per tier: tasks, clean share, share with L2, and average findings per layer. Source: review-ledger.log.">
        <table><thead><tr><th>Tier</th><th class="n">Tasks</th><th class="n">Clean</th><th class="n">Had L2</th><th class="n">L2 findings</th><th class="n">L3 findings</th></tr></thead>
        <tbody>${d.tiers.map(t => html`<tr><${Name} text=${t.tier} /><td class="n">${t.tasks}</td><td class="n">${pct(t.cleanPct)}</td><td class="n">${pct(t.layer2Pct)}</td><td class="n">${t.avgL2 ?? '–'}</td><td class="n">${t.avgL3 ?? '–'}</td></tr>`)}</tbody></table><//>
      <${Card} title="Which worker model passes most often?" src="Model = the last model named in the ledger note. Source: review-ledger.log.">
        <table><thead><tr><th>Model</th><th class="n">Tasks</th><th class="n">Clean</th><th class="n">Avg findings</th></tr></thead>
        <tbody>${d.byModel.map(t => html`<tr><${Name} text=${t.model} /><td class="n">${t.tasks}</td><td class="n">${pct(t.cleanPct)}</td><td class="n">${t.avgFindings}</td></tr>`)}</tbody></table><//>
      ${d.reviews.length ? html`<${Card} title="What did automated reviews find?" src="codex-review verdicts and P0-P3 findings by model. Source: ~/.claude/state/reviews.jsonl." span=${true}>
        <table><thead><tr><th>Model</th><th class="n">Verdict</th><th class="n">Count</th><th class="n">P0</th><th class="n">P1</th><th class="n">P2</th><th class="n">P3</th></tr></thead>
        <tbody>${d.reviews.map(r => html`<tr><${Name} text=${r.model || '–'} /><td class="n"><span class=${'pill ' + (r.verdict === 'PASS' ? 'ok' : 'fail')}>${r.verdict}</span></td><td class="n">${r.n}</td><td class="n">${r.p0}</td><td class="n">${r.p1}</td><td class="n">${r.p2}</td><td class="n">${r.p3}</td></tr>`)}</tbody></table><//>` : ''}
    <//>`;
}

const weekLabel = w => `${w.slice(8, 10)}/${w.slice(5, 7)}`;
// Small multiples: one row per tier, one 100% bar per week (clean vs had findings).
function CleanWeeks({ c: full }) {
  if (!full.tiers.length) return html`<p class="empty">No ledger tasks in this range</p>`;
  // Leading weeks before the first ledger task are empty columns: drop them.
  const from = Math.max(0, full.all.findIndex(x => x.clean + x.dirty > 0));
  const c = { weeks: full.weeks.slice(from), all: full.all.slice(from), tiers: full.tiers.map(t => ({ ...t, cells: t.cells.slice(from) })) };
  const cellView = x => {
    const n = x.clean + x.dirty;
    if (!n) return html`<div class="wk-cell none">–</div>`;
    const p = Math.round(x.clean / n * 100);
    return html`<div class="wk-cell" title=${`${x.clean} of ${n} tasks clean, ${x.dirty} with findings (${p}% clean)`}>
      <div class="wk-bar"><i class="ok" style=${`width:${p}%`}></i><i class="bad" style=${`width:${100 - p}%`}></i></div>
      <span class="wk-num">${p}%</span></div>`;
  };
  // At most 7 week labels, so they never collide; every week keeps its full date in the tooltip.
  const every = Math.ceil(c.weeks.length / 7);
  return html`<div class="wk-wrap"><div class=${'wk-grid' + (c.weeks.length > 8 ? ' many' : '')} style=${`--weeks:${c.weeks.length}`}>
    <span class="wk-h">Tier</span>${c.weeks.map((w, i) => html`<span class="wk-h" title=${`week of ${weekLabel(w)}`}>${i % every === 0 ? weekLabel(w) : ''}</span>`)}
    <span class="wk-tier all">All tiers</span>${c.all.map(cellView)}
    ${c.tiers.map(t => html`<span class="wk-tier" title=${t.tier}>${t.tier}</span>${t.cells.map(cellView)}`)}
  </div></div>
  <div class="legend-row compact"><span><i class="sw ok plain"></i>clean first pass</span><span><i class="sw fail"></i>had findings</span></div>`;
}

function Repair({ rows }) {
  const days = useMemo(() => rows.map(r => r.week), [rows]);
  const series = useMemo(() => [
    { label: 'Runs', data: rows.map(r => r.runs), color: C.codex, kind: 'bar' },
    { label: 'Resumes', data: rows.map(r => r.resumes), color: C.mars, kind: 'bar' },
    { label: 'Resume share', data: rows.map(r => r.sharePct), color: C.rose, scale: 'y2', points: true, fill: false, fmt: v => (v === null ? '–' : `${v}%`) }], [rows]);
  const runs = sum(rows.map(r => r.runs)), res = sum(rows.map(r => r.resumes));
  return html`<div class="stack"><div class="mini-stats"><span><b>${res}</b> resumes / <b>${runs}</b> runs</span>
      <span><b>${runs ? Math.round(res / runs * 1000) / 10 : '–'}%</b> of runs were resumes</span>
      <span><b>${runs - res > 0 ? (res / (runs - res)).toFixed(2) : '–'}</b> resumes per fresh run</span></div>
    <${Chart} days=${days} series=${series} height=${190} y2=${{ fmt: v => `${Math.round(v)}%` }} /></div>`;
}

// Buckets come from the server over every point, so they agree with n / median / p90.
function Lead({ l }) {
  if (!l.enough) return html`<div class="nodata"><b>Not enough data yet (n = ${l.n})</b>
    <span>The lead time needs at least 5 Claude sessions with a worker run and a later codex-review in the same repo. No value is estimated.</span></div>`;
  const max = Math.max(1, ...l.buckets.map(b => b.n));
  const m = v => (v < 90 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`);
  return html`<div class="mini-stats"><span>median <b>${m(l.medianMin)}</b></span><span>p90 <b>${m(l.p90Min)}</b></span><span>n = <b>${l.n}</b></span></div>
    <div class="ranked">${l.buckets.map(b => html`<div class="rk-row simple"><span class="rk-name">${b.label}</span>
      <span class="rk-bar"><${SegBar} parts=${[{ v: b.n, color: C.codex, label: b.label }]} of=${b.n / max * 100} /></span><span class="n">${b.n}</span></div>`)}</div>`;
}

/* ---------- Usage ---------- */
// Kept across range changes (the page remounts while it loads).
const usageUi = { perDay: 'all' };
const sourceLabel = { claude: 'Claude', codex: 'Codex' };
const composition = t => KIND.map(k => ({ v: t[k.key] || 0, color: k.color, label: k.label }));

// Claude vs Codex headline: two 100% share bars and the per-source token composition.
function Split({ d }) {
  const t = d.totals;
  const srcParts = key => ['claude', 'codex'].map(s => ({ v: t[s][key], color: SOURCE[s], label: sourceLabel[s] }));
  return html`<div class="split">
    <div class="split-col">
      <div class="split-h" title="fresh input + cache read + cache write + output">All tokens</div>
      <${ShareBar} parts=${srcParts('total')} />
      <div class="split-h" title="what the models wrote">Output tokens</div>
      <${ShareBar} parts=${srcParts('output')} />
    </div>
    <div class="split-col">
      <div class="split-h">Composition per source
        <span class="kind-legend">${KIND.map(k => html`<span><i class="sw" style=${`background:${k.color}`}></i>${k.label}</span>`)}</span></div>
      ${['claude', 'codex'].map(s => html`<div class="comp">
        <div class="comp-head"><b>${sourceLabel[s]}</b><span class="n">${fmt(t[s].total)} tokens · ${fmt(t[s].messages)} messages · cache hit ${pct(d.cache[s])}</span></div>
        <${SegBar} parts=${composition(t[s])} height=${12} />
        <div class="comp-nums">${KIND.map(k => html`<span title=${`${k.label}: ${t[s][k.key].toLocaleString('en-GB')}`}>${k.label} <b>${fmt(t[s][k.key])}</b> <span class="dim">${share(t[s][k.key], t[s].total)}</span></span>`)}</div>
      </div>`)}
    </div></div>`;
}

// Ranked models: bar length = share of the top model, segments = token composition.
function ModelRanks({ models, colors }) {
  const shown = models.filter(m => m.total > 0), hidden = models.length - shown.length;
  const all = sum(shown.map(m => m.total)), top = Math.max(1, ...shown.map(m => m.total));
  return html`<div class="ranked models">
    <div class="rk-row head"><span>Model</span><span>Tokens (fresh input · cache read · cache write · output)</span><span class="n">Share</span><span class="n">Total</span><span class="n">Output</span><span class="n opt">Messages</span></div>
    ${shown.map(m => html`<div class="rk-row" title=${`${m.model} (${m.source})\nfresh input ${m.input.toLocaleString('en-GB')}\ncache read ${m.cache_read.toLocaleString('en-GB')}\ncache write ${m.cache_write.toLocaleString('en-GB')}\noutput ${m.output.toLocaleString('en-GB')}\nreasoning ${m.reasoning.toLocaleString('en-GB')}\nmessages ${m.messages.toLocaleString('en-GB')}\ntotal ${m.total.toLocaleString('en-GB')}`}>
      <span class="rk-name"><i class="sw" style=${`background:${colors.get(`${m.source}|${m.model}`) || C.neutral}`}></i><span class="ell">${m.model}</span><span class=${'badge ' + m.source}>${m.source}</span></span>
      <span class="rk-bar"><${SegBar} parts=${composition(m)} of=${m.total / top * 100} /></span>
      <span class="n">${share(m.total, all)}</span><span class="n">${fmt(m.total)}</span><span class="n">${fmt(m.output)}</span><span class="n opt">${fmt(m.messages)}</span></div>`)}
    ${hidden ? html`<div class="rk-foot">${plural(hidden, 'model')} with no tokens in this range not shown</div>` : ''}</div>`;
}

// Ranked tops (tools, skills, MCP servers, sub-agents) with share, sparkline and week-over-week.
function Ranked({ t, color = C.claude, unit = 'calls', compact = false }) {
  if (!t.rows.length) return html`<p class="empty">None in this range</p>`;
  const top = Math.max(1, ...t.rows.map(r => r.calls));
  const bar = r => html`<${SegBar} parts=${[{ v: r.calls, color, label: r.name }]} of=${r.calls / top * 100} height=${compact ? 6 : 8} />`;
  const foot = t.distinct > t.rows.length ? html`<div class="rk-foot">top ${t.rows.length} of ${t.distinct} · ${t.total.toLocaleString('en-GB')} ${unit} in total</div>` : html`<div class="rk-foot">${t.total.toLocaleString('en-GB')} ${unit} in total</div>`;
  // Narrow cards: the bar sits under the name and the per-day column is left out.
  if (compact) return html`<div class="ranked tops compact">
    <div class="rk-row head"><span>Name</span><span class="n">${unit}</span><span class="n">Share</span><span class="n" title="last 7 days vs the 7 before">Week</span></div>
    ${t.rows.map(r => html`<div class="rk-row"><span class="rk-name stacked" title=${r.name}><span class="ell">${r.name}</span>${bar(r)}</span>
      <span class="n">${r.calls.toLocaleString('en-GB')}</span><span class="n">${r.sharePct === null ? '–' : `${r.sharePct}%`}</span><${Delta} last=${r.last7} prev=${r.prev7} /></div>`)}
    ${foot}</div>`;
  // A 1-day range has no trend to draw: the per-day column is left out.
  const spark = t.rows[0].daily.length > 1;
  return html`<div class=${'ranked tops' + (spark ? '' : ' nospark')}>
    <div class="rk-row head"><span>Name</span><span></span><span class="n">${unit}</span><span class="n">Share</span>${spark ? html`<span class="opt">Per day</span>` : ''}<span class="n" title="last 7 days vs the 7 before">Week</span></div>
    ${t.rows.map(r => html`<div class="rk-row">
      <span class="rk-name" title=${r.name}><span class="ell">${r.name}</span></span>
      <span class="rk-bar"><${SegBar} parts=${[{ v: r.calls, color, label: r.name }]} of=${r.calls / top * 100} height=${8} /></span>
      <span class="n">${r.calls.toLocaleString('en-GB')}</span><span class="n">${r.sharePct === null ? '–' : `${r.sharePct}%`}</span>
      ${spark ? html`<span class="opt"><${Spark} data=${r.daily} color=${color} /></span>` : ''}<${Delta} last=${r.last7} prev=${r.prev7} /></div>`)}
    ${t.distinct > t.rows.length ? html`<div class="rk-foot">top ${t.rows.length} of ${t.distinct} · ${t.total.toLocaleString('en-GB')} ${unit} in total</div>` : html`<div class="rk-foot">${t.total.toLocaleString('en-GB')} ${unit} in total</div>`}</div>`;
}

const hoursText = h => (h < 10 ? h : Math.round(h));
const slopeText = s => (Math.abs(s) < 0.1 ? (s === 0 ? 'flat' : `${s > 0 ? '+' : '-'}<0.1% per hour`) : `${s > 0 ? '+' : ''}${s.toFixed(1)}% per hour`);
function ForecastCard({ f, now }) {
  const ft = forecastText(f);
  return html`<${Card} top=${true} title=${`Will ${quotaName(f)} run out before reset?`} src=${f.expired ? 'The last reset period has ended.' : `Current period · ${plural(f.n, 'snapshot')} · resets ${stamp(f.resets_at)} · linear fit over the period.`}>
    <div class="fc-head"><span class="fc-now">${f.expired ? '–' : `${Math.round(f.used_pct)}%`}<span class="dim"> used now</span></span>
      <span class=${'fc-text ' + ft.tone}>${ft.text}</span>${f.enough ? html`<span class="dim">${slopeText(f.slopePerHour)}</span>` : ''}
      ${!f.expired && f.idleHours >= 1 ? (f.stale
        ? html`<span class="fc-text warn" title="the collector has not run for over an hour, so the plateau is not extrapolated">no new data for ${hoursText(f.idleHours)} h (collector last ran ${f.collectorLastRun ? stamp(f.collectorLastRun) : 'never'})</span>`
        : html`<span class="dim" title="quota snapshots are only written when the value changes; the collector is running">no change for ${hoursText(f.idleHours)} h</span>`) : ''}</div>
    ${f.points.length ? html`<${ForecastPlot} f=${f} now=${now} />` : html`<p class="empty">No snapshots in this period</p>`}
    <div class="legend-row compact"><span><i class="sw dot lav"></i>snapshot</span>${f.synthetic && f.idleHours >= 0.5 ? html`<span><i class="sw dot ring"></i>now (unchanged)</span>` : ''}<span><i class="sw dash"></i>projection</span><span><i class="sw brk"></i>now</span><span><i class="sw cap"></i>100%</span></div><//>`;
}

function Cost({ d, now }) {
  const [perDay, setPerDayState] = useState(usageUi.perDay);
  const setPerDay = v => { usageUi.perDay = v; setPerDayState(v); };
  const daily = useMemo(() => {
    const pick = s => (perDay === 'output' ? d[s].output : d.days.map((_, i) => d[s].output[i] + d[s].input[i] + d[s].cacheRead[i] + d[s].cacheWrite[i]));
    return [{ label: 'Claude', data: pick('claude'), color: C.claude, kind: 'bar' }, { label: 'Codex', data: pick('codex'), color: C.codex, kind: 'bar' }];
  }, [d, perDay]);
  const colors = useMemo(() => modelColors([...d.mix, ...d.models]), [d]);
  const mix = useMemo(() => {
    const shares = shares100(d.mix.map(m => m.data), d.days.length);
    return d.mix.map((m, k) => ({ label: m.model, color: m.source === 'other' ? C.neutral : colors.get(`${m.source}|${m.model}`), kind: 'bar',
      data: shares[k], fmt: v => `${v}%` }));
  }, [d, colors]);
  const quotaSeries = useMemo(() => {
    const byKey = {};
    for (const q of d.quotaLine) { const k = `${q.source}:${q.window}`; byKey[k] ||= {}; byKey[k][q.day] = q.used_pct; }
    const color = { 'codex:primary': C.codex, 'claude:five_hour': C.mars, 'claude:seven_day': C.claude };
    const label = { 'codex:primary': 'Codex week', 'claude:five_hour': 'Claude 5 h', 'claude:seven_day': 'Claude 7 d' };
    return Object.keys(byKey).map(k => ({ label: label[k] || k, color: color[k] || C.neutral, data: d.days.map(x => byKey[k][x] ?? null), fmt: v => (v === null ? '–' : `${Math.round(v)}%`), fill: false, points: true }));
  }, [d]);
  return html`
    <${Grid}>
      <${Card} title="Who uses the tokens: Claude or Codex?" src="Selected range. Codex fresh input excludes its cached tokens, so both sources add up the same way. Source: daily_tokens." span=${true}><${Split} d=${d} /><//>
      <${Card} title="How many tokens per day?" src=${perDay === 'output' ? 'Output tokens per day, stacked by source.' : 'All tokens per day (fresh input + cache read + cache write + output), stacked by source.'}
        tools=${html`<${Chips} options=${[['all', 'All tokens'], ['output', 'Output']]} value=${perDay} onPick=${setPerDay} />`}>
        <${Chart} days=${d.days} series=${daily} stacked=${true} /><//>
      <${Card} title="Which models carry each day?" src=${`Share of all tokens per day · top ${Math.min(7, d.mix.length)} models${d.mix.some(m => m.source === 'other') ? ', the rest as Other' : ''}.`}>
        ${d.mix.length ? html`<${Chart} days=${d.days} series=${mix} stacked=${true} yMax=${100} />` : html`<p class="empty">No tokens in this range</p>`}<//>
      <${Card} title="Which models use the most tokens?" src="All tokens in the selected range, ranked. Hover a row for every number." span=${true}><${ModelRanks} models=${d.models} colors=${colors} /><//>
      ${(d.forecast || []).map(f => html`<${ForecastCard} f=${f} now=${now} />`)}
      <${Card} title="How close did each day get to the quota?" src="Highest quota % per day, across reset periods. Sources: Codex rate_limits, Claude statusline cache.">
        ${quotaSeries.length ? html`<${Chart} days=${d.days} series=${quotaSeries} />` : html`<p class="empty">No quota snapshots yet</p>`}<//>
      <${Card} top=${true} title="Which skills are used most?" src="Skill tool calls. Source: tool_calls (raw rows are kept 90 days)."><${Ranked} t=${d.tops.skills} /><//>
      <${Card} top=${true} title="Which MCP servers are called most?" src="Calls per server. Source: tool_calls."><${Ranked} t=${d.tops.mcp} /><//>
      <${Card} top=${true} title="Which sub-agents are started most?" src="Agent tool calls by agent type. Source: tool_calls."><${Ranked} t=${d.tops.subagents} unit="runs" /><//>
      <${Card} top=${true} title="Which tools does Claude call most?" src="All Claude tool calls. Source: daily_tools."><${Ranked} t=${d.tops.tools} /><//>
    <//>`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// GitHub-style levels: 0 = none, 1-4 = quartiles of the non-zero values (so one huge day
// does not wash every other day out to level 1).
function levels(values) {
  const nz = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!nz.length) return () => 0;
  const q = p => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
  const cut = [q(0.25), q(0.5), q(0.75)];
  const fn = v => (v <= 0 ? 0 : v <= cut[0] ? 1 : v <= cut[1] ? 2 : v <= cut[2] ? 3 : 4);
  fn.cuts = cut; fn.max = nz.at(-1);
  return fn;
}
// GitHub wording: "3 messages on November 9th." / "No messages on ...".
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const ghTip = (v, unit, date, show) => `${v ? show(v) : 'No'} ${v === 1 ? unit.replace(/s$/, '') : unit} on ${date.toLocaleDateString('en-US', { month: 'long' })} ${ordinal(date.getDate())}.`;
// Unlike GitHub, the legend shows its cut points on hover.
const Legend = ({ level, show = String }) => {
  const c = level?.cuts, tips = c ? ['none', `1 - ${show(c[0])}`, `to ${show(c[1])}`, `to ${show(c[2])}`, `to ${show(level.max)}`] : [];
  return html`<div class="heat-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => html`<i class=${`l${l}`} title=${tips[l] || ''}></i>`)}<span>More</span></div>`;
};
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const METRICS = [
  { key: 'messages', label: 'Claude messages', unit: 'messages' },
  { key: 'runs', label: 'Worker runs', unit: 'runs' },
  { key: 'tasks', label: 'Tasks', unit: 'tasks' },
  { key: 'output', label: 'Output tokens', unit: 'output tokens', fmt: true }
];
// Remembered across re-renders and range changes.
const yearUi = { metric: 'messages' };

// Contribution calendar: weeks are columns (Sunday first), months on top, Mon/Wed/Fri on the left.
function YearHeat({ days }) {
  const [metric, setMetricState] = useState(yearUi.metric);
  const setMetric = m => { yearUi.metric = m; setMetricState(m); };
  const m = METRICS.find(x => x.key === metric);
  const model = useMemo(() => {
    const values = days.map(d => d[metric] || 0);
    const level = levels(values);
    const first = parseDay(days[0].day), lead = first.getDay(); // blank cells before the first day
    const cells = [...Array(lead).fill(null), ...days.map((d, i) => ({ ...d, v: values[i], l: level(values[i]), date: parseDay(d.day) }))];
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    // Month label on the first week that contains that month's first Sunday-row day <= 7.
    const months = weeks.map((w, i) => {
      const firstReal = w.find(Boolean);
      if (!firstReal) return '';
      const d = firstReal.date;
      const prev = i > 0 ? weeks[i - 1].find(Boolean)?.date : null;
      return !prev || prev.getMonth() !== d.getMonth() ? MONTHS[d.getMonth()] : '';
    });
    // Streaks and totals.
    let longest = 0, run = 0;
    for (const v of values) { run = v > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
    let current = 0;
    for (let i = values.length - 1; i >= 0 && values[i] > 0; i--) current++;
    const best = days.reduce((b, d, i) => (values[i] > (b ? b.v : 0) ? { day: d.day, v: values[i] } : b), null);
    const active = values.filter(v => v > 0).length;
    return { weeks, months, total: sum(values), longest, current, best, active, level };
  }, [days, metric]);
  const show = v => (m.fmt ? fmt(v) : v.toLocaleString('en-GB'));
  return html`
    <div class="year-head">
      <div class="year-sum" title=${`${model.active} active days · longest streak ${model.longest} d · current streak ${model.current} d${model.best ? ` · busiest ${parseDay(model.best.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${show(model.best.v)})` : ''}`}>
        <b>${show(model.total)}</b> ${m.unit} · ${model.active} active days${model.best ? ` · busiest ${parseDay(model.best.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</div>
      <div class="filters">${METRICS.map(x => html`<button class=${'chip' + (x.key === metric ? ' on' : '')} onClick=${() => setMetric(x.key)}>${x.label}</button>`)}</div>
    </div>
    <div class="year-wrap"><div class="year" style=${`--weeks:${model.weeks.length}`}>
      <span></span>${model.months.map(t => html`<span class="mon">${t}</span>`)}
      ${[0, 1, 2, 3, 4, 5, 6].map(row => html`<span class="dow">${row % 2 ? DOW[row] : ''}</span>${model.weeks.map(w => {
        const c = w[row];
        if (!c) return html`<span class="cell empty"></span>`;
        const label = ghTip(c.v, m.unit, c.date, show);
        return html`<span class=${`cell l${c.l}`} title=${label}></span>`;
      })}`)}
    </div></div>
    <${Legend} level=${model.level} show=${show} />`;
}

// Hour x weekday grid in the same visual language as the year calendar.
function Heatmap({ cells }) {
  const grid = {};
  for (const c of cells) grid[`${c.dow}:${c.hour}`] = c.n;
  const level = levels(Object.values(grid));
  return html`<div class="hours">
    <span></span>${Array.from({ length: 24 }, (_, hr) => html`<span class="mon">${hr % 3 === 0 ? `${hr}` : ''}</span>`)}
    ${[1, 2, 3, 4, 5, 6, 0].map(dw => html`<span class="dow">${DOW[dw]}</span>${Array.from({ length: 24 }, (_, hr) => {
      const n = grid[`${dw}:${hr}`] || 0;
      return html`<span class=${`cell l${level(n)}`} title=${`${DOW[dw]} ${String(hr).padStart(2, '0')}:00 - ${n} messages`}></span>`;
    })}`)}
  </div><${Legend} level=${level} />`;
}

/* ---------- Productivity ---------- */
function Productivity({ d }) {
  const work = useMemo(() => [{ label: 'Worker runs', data: d.runs, color: C.codex, kind: 'bar' }, { label: 'Tasks', data: d.tasks, color: C.aurora, kind: 'bar' }], [d]);
  const dur = useMemo(() => [{ label: 'Median run', data: d.medianRunMin, color: C.codex, fmt: v => (v === null ? '–' : `${v} min`) }], [d]);
  const split = useMemo(() => [{ label: 'Claude (supervisor)', data: d.claudeOut, color: C.claude, kind: 'bar' }, { label: 'Codex (worker)', data: d.codexOut, color: C.codex, kind: 'bar' }], [d]);
  const pressure = useMemo(() => [
    { label: 'Compactions', data: d.compactPerDay, color: C.claude, kind: 'bar' },
    { label: 'Avg tokens before compaction', data: d.compactPreTokens, color: C.mars, scale: 'y2', points: true, fill: false, fmt: v => fmt(v) }], [d]);
  const sp = d.split.supervisorPct;
  return html`
    <${Kpis}>
      <${Kpi} label="Worker runs" value=${sum(d.runs)} sub=${`${sum(d.tasks)} tasks in the ledger`} spark=${html`<${Spark} data=${d.runs} color=${C.codex} />`} />
      <${Kpi} label="Supervisor / worker" value=${sp === null ? '–' : `${Math.round(sp)} / ${Math.round(100 - sp)}`} sub="by output tokens; target about 30 / 70"
        info="Claude output tokens vs Codex output tokens in the range. An estimate." tone=${sp === null ? '' : sp <= 40 ? 'good' : sp <= 55 ? 'warn' : 'bad'} />
      <${Kpi} label="Dispatches" value=${sum(d.dispatch.map(x => x.n))} sub=${d.dispatch.map(x => `${x.kind} ${x.n}`).join(' · ') || '–'} info="codex-do dispatches by kind. Source: dispatch-trail.log." />
      <${Kpi} label="Compactions" value=${d.compactions.n || 0} sub=${`freed ${fmt(d.compactions.freed || 0)} tokens`} info="Claude context compactions in the range. Source: compactions." />
    <//>
    <${Grid}>
      <${Card} title="How much work is done per day?" src="Worker runs (daily_runs) and ledger tasks (review-ledger.log) per day."><${Chart} days=${d.days} series=${work} /><//>
      <${Card} title="How long does a worker run take?" src="Daily median of finished run time (runs/* startedUtc to exit.txt)."><${Chart} days=${d.days} series=${dur} /><//>
      <${Card} title="Is the supervisor / worker split near 30 / 70?" src="Claude output vs Codex output tokens per day, stacked."><${Chart} days=${d.days} series=${split} stacked=${true} /><//>
      <${Card} title="When does Line work?" src="Claude messages by weekday and hour in the selected range (local time)."><${Heatmap} cells=${d.heat} /><//>
      <${Card} title="Is context filling up?" src="Bars: Claude compactions per day (left axis). Line: mean context size just before a compaction (right axis). Source: compactions.">
        ${sum(d.compactPerDay) ? html`<${Chart} days=${d.days} series=${pressure} y2=${{ fmt: v => fmt(v, 0) }} />` : html`<p class="empty">No compactions in this range</p>`}<//>
    <//>`;
}

/* ---------- Harness ---------- */
function Harness({ d }) {
  const health = useMemo(() => [
    { label: 'Hook errors', data: d.hookErrors, color: C.bad, kind: 'bar' }, { label: 'Hook timeouts', data: d.hookTimeouts, color: C.warn, kind: 'bar' },
    { label: 'Exit 72', data: d.exit72, color: C.mars, kind: 'bar' }, { label: 'Exit 73', data: d.exit73, color: C.rose, kind: 'bar' },
    { label: 'Other run failures', data: d.otherFail, color: C.neutral, kind: 'bar' }], [d]);
  const m = d.collector;
  const slow = [...d.scripts].sort((a, b) => b.p95_ms - a.p95_ms);
  const ms = v => (v >= 10000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
  return html`
    <${Kpis}>
      <${Kpi} label="Hook errors" value=${sum(d.hookErrors)} sub=${`today ${d.today?.hookErrors ?? 0}`} tone=${sum(d.hookErrors) ? 'bad' : 'good'} flag=${d.anomaly?.hookErrors} info="Hook runs that ended with an error in the range. Source: hook_events." />
      <${Kpi} label="Hook timeouts" value=${sum(d.hookTimeouts)} sub=${`today ${d.today?.hookTimeouts ?? 0}`} tone=${sum(d.hookTimeouts) ? 'warn' : 'good'} flag=${d.anomaly?.hookTimeouts} info="Hook runs that timed out in the range. Source: hook_events." />
      <${Kpi} label="Exit 72 / 73" value=${`${sum(d.exit72)} / ${sum(d.exit73)}`} sub=${`today ${d.today?.exit72 ?? 0} / ${d.today?.exit73 ?? 0}`} tone=${sum(d.exit72) + sum(d.exit73) ? 'warn' : 'good'}
        info="Exit 72 = the run hit a sandbox failure. Exit 73 = no sandbox available. Source: runs/*." flag=${d.anomaly?.exit72?.flag ? d.anomaly.exit72 : d.anomaly?.exit73} />
      <${Kpi} label="Collector" value=${when(Number(m.last_run_end))} sub=${`bad lines ${m.parse_errors || 0} · failed items ${m.item_errors || 0} · schema v${m.schema_version}`} info="Last finished collector run and its error counters. Source: meta." />
    <//>
    <${Grid}>
      <${Card} title="Did anything break per day?" src="Stacked: hook errors, hook timeouts, exit 72 / 73 and other run failures."><${Chart} days=${d.days} series=${health} stacked=${true} /><//>
      <${Card} title="Which hooks are slowest?" src="Highest daily p95 in the range, with errors / timeouts. Source: daily_hooks.">
        <table><thead><tr><th>Script</th><th>Event</th><th class="n">Runs</th><th class="n">Err/TO</th><th class="n">p95</th></tr></thead>
        <tbody>${slow.map(s => html`<tr><${Name} text=${s.script} /><td class="muted">${s.event}</td><td class="n">${s.runs}</td>
          <td class="n">${s.errors || s.timeouts ? `${s.errors}/${s.timeouts}` : '·'}</td>
          <td class="n"><span class=${'pill ' + (s.p95_ms > 5000 ? 'fail' : s.p95_ms > 1500 ? 'run' : 'ok')}>${ms(s.p95_ms)}</span></td></tr>`)}</tbody></table><//>
    <//>`;
}

/* ---------- Trace ---------- */
const LOST_SECS = 2 * 86400;   // no exit after 2 days = lost worker
const GAP_SECS = 30 * 60;      // idle longer than this is compressed into a break mark
const RUNNING_CAP = 6 * 3600;  // a running run is drawn at most this long, so one stuck run cannot dominate
// Kept across range changes (the page remounts while it loads).
const traceUi = { project: 'all', open: null, heat: false };

// Turn one session's runs (all in one repo) into a compressed lane:
// active clusters keep real proportions, each idle gap becomes a fixed-width dashed break,
// overlapping (parallel) runs go to stacked sub-lanes.
function laneLayout(runs, dispatches, now) {
  const lost = r => r.ended === null && now - r.started > LOST_SECS;
  const end = r => (r.ended ?? (lost(r) ? r.started + 60 : Math.min(now, r.started + RUNNING_CAP)));
  const items = [...runs].sort((a, b) => a.started - b.started).map(r => ({ r, s: r.started, e: Math.max(end(r), r.started + 30), lost: lost(r) }));
  if (!items.length) return { segs: [], breaks: [], dots: [], active: 0, runTime: 0, rows: 1, first: null, last: null };
  // Sub-lanes: greedy first fit.
  const rowEnds = [];
  for (const it of items) {
    let row = rowEnds.findIndex(e => e <= it.s);
    if (row < 0) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = it.e; it.row = row;
  }
  const clusters = [];
  for (const it of items) {
    const last = clusters.at(-1);
    if (last && it.s - last.e <= GAP_SECS) last.e = Math.max(last.e, it.e);
    else clusters.push({ s: it.s, e: it.e });
  }
  const active = sum(clusters.map(c => c.e - c.s)) || 1;
  const brk = active * 0.04;
  const total = active + brk * Math.max(0, clusters.length - 1);
  let offset = 0;
  for (const c of clusters) { c.x = offset; offset += c.e - c.s + brk; }
  // Times outside every cluster (a review after the run ended) snap to the nearest cluster edge.
  const x = t => {
    let best = clusters[0], tt = t, dist = Infinity;
    for (const c of clusters) {
      const clamped = Math.min(c.e, Math.max(c.s, t)), dd = Math.abs(clamped - t);
      if (dd < dist) { dist = dd; best = c; tt = clamped; }
    }
    return ((best.x + (tt - best.s)) / total) * 100;
  };
  const breaks = clusters.slice(1).map((c, i) => ({ at: ((c.x - brk / 2) / total) * 100, idle: c.s - clusters[i].e }));
  const segs = items.map(it => { const left = x(it.s); return { ...it, left, width: Math.min(100 - left, Math.max(0.4, x(it.e) - left)) }; });
  // Keep dots fully visible at the lane's right end.
  const dots = dispatches.filter(dp => dp.kind === 'review').map(dp => ({ ...dp, left: Math.min(98.5, Math.max(1, x(dp.ts))) }));
  // Real run time = union of run intervals (idle gaps inside a cluster are not counted).
  let runTime = 0, cur = null;
  for (const it of items) {
    if (!cur || it.s > cur.e) { if (cur) runTime += cur.e - cur.s; cur = { s: it.s, e: it.e }; } else cur.e = Math.max(cur.e, it.e);
  }
  runTime += cur.e - cur.s;
  return { segs, breaks, dots, active, runTime, rows: rowEnds.length, first: items[0].s, last: Math.max(...items.map(i => i.e)) };
}

// One row per (Claude session, repo): a session that dispatched work into several repos
// appears under each repo with only the runs that ran there. Each review dispatch goes to
// the part whose runs started closest before it.
function splitByRepo(sessions) {
  const out = [];
  for (const s of sessions) {
    const by = new Map();
    for (const r of s.runs) { const p = r.project || '–'; if (!by.has(p)) by.set(p, []); by.get(p).push(r); }
    const parts = [...by].map(([project, runs]) => ({ session_id: s.session_id, home: s.project, output: s.output, project, runs, dispatches: [], repos: by.size,
      branches: [...new Set(runs.map(r => r.branch).filter(Boolean))] }));
    for (const dp of s.dispatches || []) {
      let best = null, gap = Infinity;
      for (const part of parts) for (const r of part.runs) { const g = dp.ts - r.started; if (g >= 0 && g < gap) { gap = g; best = part; } }
      (best || parts[0])?.dispatches.push(dp);
    }
    out.push(...parts);
  }
  return out;
}

function Trace({ d }) {
  const [project, setProjectState] = useState(traceUi.project);
  const [open, setOpenState] = useState(traceUi.open);
  const setProject = v => { traceUi.project = v; setProjectState(v); };
  const setOpen = v => { traceUi.open = v; setOpenState(v); };
  const [moreChips, setMoreChips] = useState(false);
  const [heat, setHeatState] = useState(traceUi.heat);
  const setHeat = v => { traceUi.heat = v; setHeatState(v); };
  const now = Math.floor(Date.now() / 1000);
  const isFail = r => { const st = runStatus(r, now); return st === 'failed' || st === 'lost'; };
  const sessions = useMemo(() => splitByRepo(d.sessions), [d]);
  const projects = useMemo(() => {
    const m = new Map();
    for (const s of sessions) {
      const p = m.get(s.project) || { name: s.project, runs: 0, sessions: 0, ok: 0, failed: 0, last: 0 };
      p.sessions++; p.runs += s.runs.length; p.ok += s.runs.filter(r => r.exit_code === 0).length;
      p.failed += s.runs.filter(isFail).length;
      p.last = Math.max(p.last, ...s.runs.map(r => r.started)); m.set(s.project, p);
    }
    return [...m.values()].sort((a, b) => b.last - a.last);
  }, [sessions]);
  const selected = projects.some(p => p.name === project) ? project : 'all';
  const shown = projects.filter(p => selected === 'all' || p.name === selected);
  const keyOf = s => `${s.project}:${s.session_id || 'none'}`;
  const rowId = s => `srow-${sessions.indexOf(s)}`;
  // Open a row and bring it into view (failed chips, scatter clicks).
  const reveal = s => {
    if (!s) return;
    setOpen(keyOf(s));
    if (selected !== 'all' && selected !== s.project) setProject('all');
    setTimeout(() => document.getElementById(rowId(s))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  };
  const scatterRuns = useMemo(() => d.scatter.filter(r => selected === 'all' || (r.project || '–') === selected), [d, selected]);
  // A scatter point can be older than the lanes below (120 runs / 40 sessions): say so instead of doing nothing.
  const [notice, setNotice] = useState(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);
  // Which cut hid a run: older than every lane run while runs were capped -> the run cut;
  // otherwise its session fell outside the 40 most recent sessions.
  const tr = d.truncated || {};
  const oldestShown = Math.min(...d.sessions.flatMap(s => s.runs.map(r => r.started)));
  const pick = run => {
    const s = sessions.find(x => x.runs.some(r => r.run_id === run.run_id));
    if (s) { setNotice(null); reveal(s); return; }
    const why = tr.runsCapped && run.started < oldestShown ? `is older than the latest ${tr.runsShown >= 120 ? 120 : tr.runsShown} runs shown below`
      : tr.sessionsCapped ? `belongs to a session outside the ${tr.sessionsShown} most recent sessions shown below` : 'is not shown below';
    setNotice(`Run ${run.run_id} ${why}; pick a shorter range to see its session.`);
  };
  const counts = useMemo(() => {
    const c = { ok: 0, failed: 0, running: 0, lost: 0 };
    for (const r of scatterRuns) c[runStatus(r, now)]++;
    return c;
  }, [scatterRuns]);
  // Lanes share one length scale: the longest session fills the lane, a 30 s run stays short.
  const layouts = useMemo(() => new Map(sessions.map(s => [s, laneLayout(s.runs, s.dispatches, now)])), [sessions]);
  const maxActive = Math.max(60, ...[...layouts.values()].map(l => l.active));
  const laneWidth = a => `${Math.max(3, Math.round(100 * Math.sqrt(a / maxActive)))}%`;
  const capText = [tr.runsCapped ? `the latest 120 of ${tr.runsTotal} runs` : '', tr.sessionsCapped ? `the ${tr.sessionsShown} most recent of ${tr.sessionsTotal} sessions` : '']
    .filter(Boolean).join(', ');
  return html`
    <div class="filters">
      <button class=${'chip' + (selected === 'all' ? ' on' : '')} onClick=${() => setProject('all')}>All<b>${sessions.length}</b></button>
      ${(moreChips ? projects : projects.slice(0, 8)).map(p => html`<button class=${'chip' + (selected === p.name ? ' on' : '')} title=${p.name} onClick=${() => setProject(p.name)}>${p.name}<b>${p.sessions}</b></button>`)}
      ${projects.length > 8 ? html`<button class="chip" onClick=${() => setMoreChips(!moreChips)}>${moreChips ? 'Less' : `+${projects.length - 8} more`}</button>` : ''}
    </div>
    <${Card} title="Which runs were slow or failed?" src=${`One point per Codex run in the range${selected === 'all' ? '' : ` in ${selected}`}. y = duration (log scale). Hover for details, click to open its session.${d.scatter.length >= 600 ? ' Latest 600 runs.' : ''}`}
      tools=${html`<div class="legend-row compact"><span><i class="sw dot lav"></i>exit 0 <b>${counts.ok}</b></span><span><i class="sw dot red"></i>failed <b>${counts.failed}</b></span>
        <span><i class="sw dot amb"></i>running <b>${counts.running}</b></span><span><i class="sw dot ring"></i>lost <b>${counts.lost}</b></span></div>`}>
      ${scatterRuns.length ? html`<${RunScatter} runs=${scatterRuns} start=${d.start} now=${now} onPick=${pick} />` : html`<p class="empty">No runs in this range</p>`}<//>
    ${notice ? html`<div class="notice" role="status">${notice}</div>` : ''}
    <div class="legend-row">${heat ? html`<span><i class="sw hot"></i>run >= 75% of its session's run time</span><span><i class="sw warm"></i>>= 50%</span><span><i class="sw ok"></i>below 50% or a one-run session</span><span><i class="sw failed-hatch"></i>failed / lost (hatched)</span><span><i class="sw running-stripe"></i>running (striped)</span>`
        : html`<span><i class="sw ok"></i>run exit 0</span><span><i class="sw fail"></i>run failed / lost</span><span><i class="sw run"></i>running</span>`}
      <span><i class="sw dot"></i>review</span><span><i class="sw brk"></i>idle gap (compressed)</span>
      <button class=${'chip' + (heat ? ' on' : '')} aria-pressed=${heat} title="Colour each run by its share of the session's total run time (sessions with one run stay neutral)" onClick=${() => setHeat(!heat)}>Heat by share</button>
      <span class="dim">Click a row to see its runs.${capText ? ` Lanes show ${capText}.` : ''}</span></div>
    ${shown.length ? shown.map(p => html`<section class="card project">
      <div class="project-head"><span class="pname">${p.name}</span><span class="pill">${plural(p.sessions, 'session')}</span><span class="pill">${plural(p.runs, 'run')}</span>
        <span class=${'pill ' + (p.ok === p.runs ? 'ok' : 'fail')}>${p.ok}/${p.runs} exit 0</span>
        ${p.failed ? html`<button class="chip fail-chip" title="Open the latest session with a failed or lost run"
          onClick=${() => reveal(sessions.find(s => s.project === p.name && s.runs.some(isFail)))}>${p.failed} failed</button>` : ''}</div>
      ${sessions.filter(s => s.project === p.name).map(s => {
        const key = keyOf(s), L = layouts.get(s), ok = s.runs.filter(r => r.exit_code === 0).length, nFail = s.runs.filter(isFail).length;
        const rowH = 6, laneH = Math.max(16, L.rows * (rowH + 2) + 4);
        const segClass = sg => {
          // Heat: a one-run session is trivially 100% and stays neutral; failed runs keep a red outline.
          if (heat) {
            const sh = s.runs.length > 1 ? (sg.e - sg.s) / Math.max(1, L.runTime) : 0;
            // Failed: hatched red over the heat colour; running: amber stripes, so neither reads as "warm".
            const st = runStatus(sg.r, now);
            return (sh >= 0.75 ? 'hot' : sh >= 0.5 ? 'warm' : '') + (st === 'failed' || st === 'lost' ? ' failed-hatch' : st === 'running' ? ' running-stripe' : '');
          }
          return sg.lost || (sg.r.ended !== null && sg.r.exit_code !== 0) ? 'fail' : sg.r.ended === null ? 'run' : '';
        };
        return html`<div id=${rowId(s)} class=${'srow' + (open === key ? ' open' : '')} role="button" tabindex="0" aria-expanded=${open === key}
            onClick=${() => setOpen(open === key ? null : key)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === key ? null : key); } }}>
            <div class="who"><div class="mono sid"><span class="chev">${open === key ? '▾' : '▸'}</span>${s.session_id ? short(s.session_id) : 'not linked'}
                ${s.session_id && s.repos > 1 ? html`<span class="dim" title=${`This Claude session (started in ${s.home || '–'}) ran work in ${s.repos} repos`}> · 1/${s.repos} repos</span>` : ''}</div>
              <div class="when" title=${`${when(L.first)} → ${when(L.last)}`}>${when(L.first)} → ${when(L.last)}</div>
              ${s.branches.length ? html`<div class="branch" title=${`git branch: ${s.branches.join(', ')}`}>⎇ ${s.branches.join(', ')}</div>` : ''}</div>
            <div class="lane-box"><div class="lane" style=${`width:${laneWidth(L.active)};height:${laneH}px`}>${L.breaks.map(b => html`<span class="brk" style=${`left:${b.at}%`} title=${`idle ${secs(b.idle)}`}></span>`)}
              ${L.segs.map(sg => html`<span class=${'seg ' + segClass(sg)}
                style=${L.rows > 1 ? `left:${sg.left}%;width:${sg.width}%;top:${3 + sg.row * (rowH + 2)}px;height:${rowH}px;bottom:auto` : `left:${sg.left}%;width:${sg.width}%`}
                title=${`${sg.r.model} ${sg.r.effort || ''} · ${sg.lost ? 'lost' : `${secs(sg.e - sg.s)} · exit ${sg.r.exit_code ?? '…'}`}${sg.r.is_resume ? ' · resume' : ''} · ${Math.round((sg.e - sg.s) / Math.max(1, L.runTime) * 100)}% of session run time`}></span>`)}
              ${L.dots.map(dp => html`<span class="dot" style=${`left:${dp.left}%`} title=${`${when(dp.ts)} review ${dp.model}`}></span>`)}</div></div>
            <div class="stats">${nFail ? html`<button class="chip fail-chip" title="Show the runs of this session"
                onClick=${e => { e.stopPropagation(); reveal(s); }} onKeyDown=${e => e.stopPropagation()}>${nFail} failed</button>` : ''}<span class="pill">${plural(s.runs.length, 'run')}</span><span class=${'pill ' + (ok === s.runs.length ? 'ok' : 'fail')}>${ok}/${s.runs.length}</span>
              <span class="pill" title="total time with at least one run in progress">${secs(L.runTime)}</span></div>
          </div>
          ${open === key ? html`<div class="sdetail"><table><thead><tr><th>Run</th><th class="n opt">Branch</th><th class="n">Model</th><th class="n opt">Started</th><th class="n">Duration</th><th class="n">Exit</th><th class="n opt">Codex output</th><th class="n opt">Codex total</th></tr></thead>
            <tbody>${[...s.runs].sort((a, b) => a.started - b.started).map(r => {
              const lost = r.ended === null && now - r.started > LOST_SECS;
              return html`<tr><td class="name mono" title=${r.run_id}>${r.run_id}${r.is_resume ? ' · resume' : ''}</td><td class="n opt muted">${r.branch || '–'}</td><td class="n">${r.model} <span class="dim">${r.effort || ''}</span></td>
                <td class="n opt">${when(r.started)}</td><td class="n">${secs(r.ended ? r.ended - r.started : null)}</td>
                <td class="n"><span class=${'pill ' + (lost ? 'fail' : r.ended === null ? 'run' : r.exit_code === 0 ? 'ok' : 'fail')}>${lost ? 'lost' : r.ended === null ? 'running' : r.exit_code}</span></td>
                <td class="n opt">${fmt(r.codex_output)}</td><td class="n opt">${fmt(r.codex_total)}</td></tr>`; })}</tbody></table>
            ${s.output ? html`<p class="foot">Claude output in this session (all repos): ${fmt(s.output)}</p>` : ''}</div>` : ''}`;
      })}
    </section>`) : html`<section class="card"><p class="empty">No runs in this range</p></section>`}`;
}

const root = document.getElementById('app');
root.textContent = ''; // drop the static boot text before Preact takes over
applyTheme(storedTheme()); // before the first render, so charts read the right colours
installTips(); // styled hover tips for every chart and `title` (charts.js)
render(html`<${App} />`, root);
