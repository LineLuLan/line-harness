/* Intent: Line Hub's six read-only pages: Overview, Flow, Work, Usage, Machine and Trace.
 * Status: Line's approved compact layout (2026-11-15); legacy hashes redirect and APIs remain.
 * Overview uses three rows within the desktop viewport; mobile cards stack. Theme tokens unchanged.
 * Next: supervisor host screenshots. Blockers: none. Confidence: fixture queries and UI render tests. */
import { h, render, cloneElement } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { Chart, COLORS as C, fmt, dayLabel, installTips, refreshColors } from './charts.js';
import { SOURCE, modelColors, share, SegBar, ShareBar, Spark, Delta, RunScatter, ForecastPlot, forecastText, Flag, runStatus, stamp, Radar, Ring, Donut, HBar } from './viz.js';
import { readRoute, hashOf, hashParams as routeParams } from './route.js';
import { FlowDiagram } from './flow-diagram.js';
const html = htm.bind(h);

// Simple stroke icons (24x24 viewBox), drawn for this project.
const ICON = {
  flow: 'M5 6h4v4H5zM15 4h4v4h-4zM15 16h4v4h-4zM9 8h3v8h3M12 12h3',
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  work: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  cost: 'M4 18a8 8 0 1 1 16 0M12 18l4.5-5.5M7 18h10',
  machine: 'M4 5h16v10H4zM9 19h6M12 15v4',
  trace: 'M4 6h9M4 12h16M4 18h6M15 4v4M18 10v4M12 16v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
};
const PAGES = [
  { id: 'overview', label: 'Overview', lead: 'The whole harness at a glance.' },
  { id: 'flow', label: 'Flow', lead: 'How one task moves through the harness, A to Z.' },
  { id: 'work', label: 'Work', lead: 'Is the harness doing good work?' },
  { id: 'cost', label: 'Usage', lead: 'Tokens, quota and the calls behind them.' },
  { id: 'machine', label: 'Machine', lead: 'Does the machine have room to work?' },
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

/* Theme: dark by default, remembered per browser (storage can be blocked: try/catch). */
const THEME_KEY = 'line-hub-theme';
function storedTheme() { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
function applyTheme(t, remember = true) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  if (remember) { try { localStorage.setItem(THEME_KEY, t); } catch { /* private window: not remembered */ } }
  refreshColors();
}

// Routing lives in route.js: six pages plus legacy redirects, #<page>?days=N.
const hashParams = () => routeParams(location.hash);
const readHash = () => readRoute(location.hash, PAGES.map(p => p.id), RANGES.map(r => r[0]));
const Icon = ({ d }) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

function App() {
  const [state, setState] = useState(readHash);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => { const on = () => setState(readHash()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => {
    let live = true;
    setError(null);
    // Flow is a static diagram (Line 2026-11-15): no API call; keep the last collection time for the side panel.
    if (state.page === 'flow') { setPayload(p => ({ ...(p || {}), page: 'flow', model: null, range: { days: state.days } })); return () => { live = false; }; }
    // Intent: exact N of M uses existing worker counts, never a rounded-percent estimate.
    // Status: one extra read only on Overview. Next: none. Blockers: none. Confidence: query fixtures.
    const read = page => fetch(`/api/${page}?days=${state.days}`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error === 'no-db' ? 'No data yet. Run: npm run collect -- --full' : `Server error (${body.error || r.status})`);
      return body;
    });
    const load = () => Promise.all([read(state.page), state.page === 'overview' ? read('work') : null])
      .then(([b, work]) => {
        if (work) b.data.workerModels = work.data.models;
        return b;
      }).then(b => { if (live) { setError(null); setPayload({ ...b, page: state.page, model: state.model }); } })
      .catch(e => live && setError(e instanceof TypeError ? 'The Line Hub server has stopped. Start it again: npm run hub' : e.message));
    load();
    // Poll only while the tab is visible, so a forgotten background tab lets the server idle out.
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const t = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [state.page, state.days]);
  const go = (page, days, model = null) => { location.hash = hashOf(page, days, model); };
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
        <div class="ranges">${RANGES.map(([d, l]) => html`<button class=${d === state.days ? 'on' : ''} onClick=${() => go(state.page, d, state.model)}>${l}</button>`)}</div>
      </header>
      <main key=${theme} class=${state.page === 'overview' ? 'overview-main' : ''}>${error ? html`<div class="error">${error}</div>` : !ready ? html`<p class="boot">Loading…</p>`
        : html`<${Page} id=${state.page} p=${payload} />`}</main>
    </div>
  </div>`;
}

/* Intent: six view routes, including the existing static Flow. Status: ready.
 * Next: host screenshots. Blockers: none. Confidence: all six empty-data render tests. */
function Page({ id, p }) {
  const View = { overview: Overview, work: Work, cost: Cost, machine: Machine, trace: Trace, flow: FlowDiagram }[id];
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

// Quota names come from the server (quotaName(): window length and account, e.g. "Codex 7-day").
const quotaName = q => q.name || `${q.source} ${q.window}`;
function attentionText(a, days) {
  const page = p => `#${p}?days=${days}`;
  switch (a.kind) {
    case 'anomaly': return { title: `${a.label} is unusually high`, detail: `today ${fmt(a.today)} vs threshold ${fmt(a.threshold)} (28-day median ${fmt(a.median)})`, href: page('cost'), link: 'Usage' };
    case 'quota': return { title: `${quotaName(a)} may run out before its reset`, detail: `projected 100% at ${stamp(a.hit100At)} · resets ${stamp(a.resets_at)}`, href: page('cost'), link: 'Usage' };
    case 'quota-full': return { title: `${quotaName(a)} is used up`, detail: `resets ${stamp(a.resets_at)}`, href: page('cost'), link: 'Usage' };
    case 'failed': return { title: `${plural(a.n, 'worker run')} failed`, detail: 'exit code other than 0', href: page('trace'), link: 'Trace' };
    case 'lost': return { title: `${plural(a.n, 'worker run')} lost`, detail: 'no exit code 2 days after the start', href: page('trace'), link: 'Trace' };
    case 'review-fail': return { title: `${plural(a.n, 'codex-review')} returned FAIL`, detail: 'verdicts in reviews.jsonl', href: page('work'), link: 'Work' };
    case 'ledger-fail': return { title: `${plural(a.n, 'ledger task')} had a FAIL round`, detail: `${plural(a.rounds, 'FAIL round')} in review-ledger.log`, href: page('work'), link: 'Work' };
    case 'collector': return { title: 'Collector data is stale', detail: a.lastRun ? `last run ${stamp(a.lastRun)} (${a.hours} h ago)` : 'the collector has never finished a run', href: page('machine'), link: 'Machine' };
    default: return { title: a.kind, detail: '' };
  }
}
function Attention({ items = [], days }) {
  if (!items.length) return html`<div class="all-clear"><i></i><div><b>All clear</b><div class="muted">No flags, failed runs, FAIL reviews, quota risk or stale data in this range.</div></div></div>`;
  return html`<ul class="attn">${items.slice(0, 4).map(a => {
    const t = attentionText(a, days);
    return html`<li><i class=${'lvl ' + a.level}></i><div class="what"><b>${t.title}</b><span title=${t.detail}>${t.detail}</span></div>
      ${t.href ? html`<a href=${t.href}>${t.link} →</a>` : html`<span></span>`}</li>`;
  })}</ul>`;
}
/* Intent: show used quota against elapsed time and projected reset usage, in three compact rows.
 * Status: same live quotas, no estimates. Next: host screenshots. Blockers: none. Confidence: fixture UI tests. */
const quotaTone = r => r.pace > 1.3 || r.usedPct >= 85 ? 'var(--bad)'
  : r.pace > 1 || r.usedPct >= 70 ? 'var(--warn)' : r.source === 'claude' ? 'var(--kafka)' : 'var(--nebula)';
const clampPct = n => Math.max(0, Math.min(100, n));
function UsageCard({ u = {}, quotas = [] }) {
  const rows = [...(u.rows || [])].sort((a, b) => {
    const order = r => r.source === 'claude' ? r.window === 'five_hour' ? 0 : 1 : 2;
    return order(a) - order(b);
  }).slice(0, 3);
  const tools = html`<span class="muted small">data as of ${u.lastRun ? stamp(u.lastRun) : 'never'}</span>${u.stale ? html` <span class="pill run">stale</span>` : ''}`;
  return html`<${Card} title="How much quota is left?" tools=${tools} src="Filled = used %. White tick = elapsed window %. Dashed tick = projected usage at reset. Pace = used / elapsed; projections need quota history.">
    <div class="quota-rows">${rows.map(r => {
      const q = quotas.find(q => q.source === r.source && q.window === r.window && q.account === r.account);
      return html`<div class="quota-row"><b class="quota-name" title=${r.name}>${r.name}</b>
        <div class="quota-track" role="meter" aria-label=${`${r.name} used`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${r.usedPct}>
          <i class="quota-used" style=${`width:${clampPct(r.usedPct)}%;background:${quotaTone(r)}`}></i>
          ${q?.elapsedPct != null ? html`<i class="quota-tick" style=${`left:${clampPct(q.elapsedPct)}%`} title=${`${pct(q.elapsedPct)} of window elapsed`}></i>` : ''}
          ${r.projectedAtReset != null ? html`<i class="quota-tick projected" style=${`left:${clampPct(r.projectedAtReset)}%`} title=${`${pct(r.projectedAtReset)} projected at reset`}></i>` : ''}
        </div><b class="n quota-left">${pct(r.leftPct)} left</b>
        <span class="quota-meta mono">pace ${r.pace == null ? '–' : r.pace.toFixed(2)} · reset ${r.hoursLeft == null ? '–' : r.hoursLeft >= 24 ? `${(r.hoursLeft / 24).toFixed(1)} d` : `${r.hoursLeft} h`}</span></div>`;
    })}</div>
    ${rows.length ? html`<p class="quota-legend muted small">Fill: used · white tick: even pace · dashed tick: at reset</p>` : html`<p class="empty">No live quota window</p>`}<//>`;
}

/* Intent: one-screen Overview, three rows with the chart taking the remaining space.
 * Status: compact. Next: host viewport checks. Blockers: none. Confidence: empty and populated render tests. */
function Overview({ d, range }) {
  const k = d.kpi, days = range.days;
  const models = d.workerModels || [], finished = sum(models.map(x => x.finished)), ok = sum(models.map(x => x.exit0));
  const tokenSeries = useMemo(() => [
    { label: 'Claude', data: d.chart.claudeAll, color: C.claude, kind: 'bar' },
    { label: 'Codex', data: d.chart.codexAll, color: C.codex, kind: 'bar' }], [d]);
  return html`<div class="overview-page">
    <div class="overview-top"><${UsageCard} u=${d.usage} quotas=${d.quota} />
      <${Card} title="What needs attention?"><${Attention} items=${d.attention} days=${days} /><//></div>
    <${Kpis}>
      <${Kpi} label="Tasks shipped" value=${k.tasks.tasks} sub="ledger tasks in range"
        delta=${html`<${KDelta} now=${k.tasks.tasks} prev=${k.prev.tasks} days=${days} />`} />
      <${Kpi} label=${d.metrics?.first_pass?.label || "Clean first pass"} value=${pct(k.tasks.cleanPct)} sub=${`${k.tasks.clean} of ${k.tasks.tasks} tasks`}
        info=${`${d.metrics?.first_pass?.label || 'Clean first pass'}: ${d.metrics?.first_pass?.definition || 'A ledger task with fail_rounds = 0 and L1 + L2 + L3 findings = 0.'} Source: review-ledger.log.`} />
      <${Kpi} label="Worker runs OK" value=${pct(k.exit0Pct)} sub=${d.workerModels ? `${ok} of ${finished} runs` : 'run counts unavailable'}
        info="Exit 0 / finished runs in range; running and lost runs are outside this denominator." />
      <${Kpi} label="Tokens today" value=${fmt(k.tokensToday)} sub=${`Claude ${fmt(k.claudeToday)} · Codex ${fmt(k.codexToday)}`} />
    <//>
    <${Card} title="Tokens per day · Claude vs Codex"><${Chart} days=${d.chart.days} series=${tokenSeries} stacked=${true} height=${160} /><//>
  </div>`;
}

/* Intent: restore the pre-H10 Work visual from D:/Backups/h10-pre-slim/web/app.js.
 * Status: H11, empty-safe and scoped to Work. Next: host screenshots. Blockers: none. Confidence: fixture tests. */
function streaks(calendar, metric = null) {
  const on = calendar.map(d => metric ? (d[metric] || 0) > 0 : (d.messages || 0) + (d.runs || 0) > 0);
  let longest = 0, run = 0;
  for (const v of on) { run = v ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = on.length - 1;
  if (i >= 0 && !on[i]) i--;
  let current = 0;
  for (; i >= 0 && on[i]; i--) current++;
  return { current, longest, active: on.filter(Boolean).length };
}

/* Intent: restore the pre-H10 Work visual from D:/Backups/h10-pre-slim/web/app.js.
 * Status: H11, empty-safe and scoped to Work. Next: host screenshots. Blockers: none. Confidence: fixture tests. */
const SIDES = () => [{ key: 'claude', label: 'Claude (supervisor)', color: C.claude }, { key: 'codex', label: 'Codex (worker)', color: C.codex, dash: true }];
const capabilityAxes = axes => axes.map(a => {
  const side = (s, name) => (a[s].score === null ? `${name}: n/a - ${a[s].na}` : `${name}: ${a[s].score} (${a[s].value})`);
  const tip = `${a.label}\n${a.formula}\n${side('claude', 'Claude')}\n${side('codex', 'Codex')}`;
  const na = ['claude', 'codex'].filter(s => a[s].score === null).map(s => (s === 'claude' ? 'Claude' : 'Codex'));
  const low = ['claude', 'codex'].filter(s => a[s].score !== null && a[s].n < 3).map(s => (s === 'claude' ? 'Claude' : 'Codex'));
  const sub = [na.length ? `${na.join(' + ')} n/a` : '', low.length ? `${low.join(' + ')} low data` : ''].filter(Boolean).join(' · ');
  const val = s => ({ score: a[s].score, low: a[s].score !== null && a[s].n < 3, tip: side(s, s === 'claude' ? 'Claude' : 'Codex') + (a[s].score !== null && a[s].n < 3 ? ` - low data (n = ${a[s].n})` : '') });
  return { label: a.label, tip, sub, values: { claude: val('claude'), codex: val('codex') } };
});
const Suggest = ({ notes }) => html`<div class="suggest"><h4>What this suggests</h4>${notes.map(n => html`<p>${n}</p>`)}</div>`;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// GitHub-style levels: 0 = none, 1-4 = quartiles of the non-zero values (so one huge day
// does not wash every other day out to level 1).
/* Intent: restore the pre-H10 Work visual from D:/Backups/h10-pre-slim/web/app.js.
 * Status: H11, empty-safe and scoped to Work. Next: host screenshots. Blockers: none. Confidence: fixture tests. */
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
/* Intent: restore the pre-H10 Work visual from D:/Backups/h10-pre-slim/web/app.js.
 * Status: H11, empty-safe and scoped to Work. Next: host screenshots. Blockers: none. Confidence: fixture tests. */
const Legend = ({ level, show = String }) => {
  const c = level?.cuts, tips = c ? ['none', `1 - ${show(c[0])}`, `to ${show(c[1])}`, `to ${show(c[2])}`, `to ${show(level.max)}`] : [];
  return html`<div class="heat-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => html`<i class=${`l${l}`} title=${tips[l] || ''}></i>`)}<span>More</span></div>`;
};
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const METRICS = [
  { key: 'messages', label: 'Claude messages', unit: 'messages' },
  { key: 'runs', label: 'Worker runs', unit: 'runs' },
  { key: 'tasks', label: 'Tasks', unit: 'tasks' }
];
// Remembered across re-renders and range changes.
const yearUi = { metric: 'runs' };

// Contribution calendar: weeks are columns (Sunday first), months on top, Mon/Wed/Fri on the left.
/* Intent: restore the pre-H10 Work visual from D:/Backups/h10-pre-slim/web/app.js.
 * Status: H11, empty-safe and scoped to Work. Next: host screenshots. Blockers: none. Confidence: fixture tests. */
function YearHeat({ days = [] }) {
  const [metric, setMetricState] = useState(yearUi.metric);
  const setMetric = m => { yearUi.metric = m; setMetricState(m); };
  const m = METRICS.find(x => x.key === metric);
  const model = useMemo(() => {
    if (!days.length) return null;
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
    const { longest, current, active } = streaks(days, metric);
    const best = days.reduce((b, d, i) => (values[i] > (b ? b.v : 0) ? { day: d.day, v: values[i] } : b), null);
    return { weeks, months, total: sum(values), longest, current, best, active, level };
  }, [days, metric]);
  if (!model) return html`<p class="empty">No activity recorded yet</p>`;
  const show = v => (m.fmt ? fmt(v) : v.toLocaleString('en-GB'));
  return html`
    <div class="year-head">
      <div class="year-sum" title=${`${model.active} active days · longest streak ${model.longest} d · current streak ${model.current} d${model.best ? ` · busiest ${parseDay(model.best.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${show(model.best.v)})` : ''}`}>
        <b>${show(model.total)}</b> ${m.unit} · ${model.active} active days · current streak ${model.current} d${model.best ? ` · busiest ${parseDay(model.best.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ' · busiest: none'}</div>
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


/* Intent: make recurring defect categories, review layers and worker patterns visible together.
 * Status: server-ranked categories, eight weekly stacks and top-three worker chips.
 * Next: host 1440/390 checks. Blockers: none. Confidence: populated/empty template fixtures. */
function WorkFindings({ findings }) {
  if (!findings?.total) return html`<p class="empty">No typed findings yet - they start with the next review.</p>`;
  const layers = [C.claude, C.codex, C.mars], colors = [C.claude, C.codex, C.mars, C.aurora, C.rose];
  const weeks = findings.byWeek || [], categories = weeks[0]?.categories || [];
  const series = categories.map((c, i) => ({ label: c.label, kind: 'bar', color: colors[i],
    data: weeks.map(w => w.categories.find(x => x.category === c.category)?.count || 0) }));
  return html`<div class="work-findings">
    <div class="finding-categories"><h4>Findings by category</h4>
      <${HBar} rows=${findings.byCategory.map(c => ({ label: c.label, value: c.count, display: String(c.count),
        title: `${c.label}: ${c.count}\n${c.countermeasure}`,
        parts: [1, 2, 3].map((layer, i) => ({ v: c.byLayer[layer], label: `L${layer} - ${c.countermeasure}`, color: layers[i] })) }))} />
      <div class="stats-legend">${layers.map((color, i) => html`<span><i class="sw" style=${`background:${color}`}></i>L${i + 1}</span>`)}</div>
    </div>
    <div class="finding-weeks"><h4>Top 5 categories over 8 weeks</h4>
      <${Chart} days=${weeks.map(w => w.week)} series=${series} stacked=${true} height=${190} />
    </div>
    <div class="finding-workers"><h4>Top categories by worker</h4>
      ${findings.byWorker.map(w => html`<div class="finding-worker"><span class="finding-model">${w.model}</span>
        <div class="finding-chips">${w.categories.map(c => html`<span class="finding-chip">${c.label}<b>${c.count}</b></span>`)}</div></div>`)}
    </div>
  </div>`;
}

/* Intent: chart-first Work: yearly activity, capability, review outcomes and daily quality.
 * Status: existing metrics, no inferred attribution. Next: host screenshots. Blockers: none. Confidence: fixture render tests. */
function Work({ d = {} }) {
  const tiers = (d.tiers || []).filter(t => t.tasks > 0), models = d.models || [];
  const cleanLabel = d.metrics?.first_pass?.label || 'Clean first pass';
  const cleanDefinition = d.metrics?.first_pass?.definition || 'A ledger task with fail_rounds = 0 and L1 + L2 + L3 findings = 0.';
  const daily = d.daily || { days: [], clean: [], hadFindings: [], pass7: [] }, radar = d.radar || { axes: [], notes: [] };
  const quality = useMemo(() => [
    { label: cleanLabel, data: daily.clean, kind: 'bar', color: C.aurora },
    { label: 'Had findings', data: daily.hadFindings, kind: 'bar', color: C.bad },
    { label: '7-day pass %', data: daily.pass7, scale: 'y2', color: C.claude, fmt: pct, fill: false, points: true }
  ], [d]);
  const defects = ['L1', 'L2', 'L3'].map((key, i) => ({ label: key, v: sum(tiers.map(t => t.defects?.[key])), color: [C.claude, C.codex, C.mars][i] }));
  return html`<div class="slim-page stats-page work-page"><${Grid}>
    <${Card} title="When was the harness active?" span=${true} src="Last 365 days, independent of the range. Daily Claude messages, worker runs or ledger tasks. Current streak may end yesterday.">
      <${YearHeat} days=${d.calendar || []} /><//>
    <${Card} title="Claude vs Codex" src="Capability scores over the selected range. Hover axis labels for formulas. Missing signals leave gaps; Speed uses a different target per side.">
      <${Radar} axes=${capabilityAxes(radar.axes)} series=${SIDES()} width=${520} height=${270} R=${78} />
      <${Suggest} notes=${radar.notes.slice(0, 3)} /><//>
    <${Card} title="Did tasks pass review?" src="Green = no L1/L2/L3 finding and no FAIL. Red = a finding or FAIL. Defect slices sum recorded counts only.">
      <${HBar} rows=${tiers.map(t => ({ label: t.tier, value: t.tasks, display: String(t.tasks),
        parts: [{ v: t.clean, label: cleanLabel, color: C.aurora }, { v: t.hadFindings, label: 'Had findings', color: C.bad }] }))} empty="No ledger tasks in this range" />
      <div class="stats-legend"><span><i class="sw" style="background:var(--aurora)"></i>${cleanLabel}</span><span><i class="sw" style="background:var(--bad)"></i>Had findings</span></div>
      <${Donut} parts=${defects} label="Defects caught by layer" /><//>
    <${Card} title="Is quality getting better?" src="Daily task counts; green = no findings and no FAIL. Line = clean tasks / all tasks in the trailing 7 calendar days, including history before the selected range. No tasks = no percentage.">
      <${Chart} days=${daily.days} series=${quality} stacked=${true} y2=${{ fmt: pct }} height=${200} /><//>
    <${Card} title="Where do agents go wrong?" span=${true} src="Typed findings. Categories and workers use the selected range; Other includes unknown categories and those below the top 10. Weekly counts show the top 5 categories over the latest 8 Monday-start weeks, independent of the range. Workers are attributed by run ID; missing models are unknown.">
      <${WorkFindings} findings=${d.findings} /><//>
    <${Card} title="Which worker model does good work?" src=${`Bars = worker runs. Exit 0 uses finished runs only. ${cleanLabel}: ${cleanDefinition} Attributed by the recorded model. Grey ring = no data.`}>
      <div class="worker-ranks"><${HBar} rows=${models.map(m => ({ label: m.model, value: m.runs, display: `${m.runs} runs`, color: C.codex,
        extra: html`<${Ring} value=${m.exit0Pct} label="Exit 0" color=${C.codex} title=${`${m.exit0 ?? '–'} of ${m.finished ?? '–'} finished runs`} /><${Ring} value=${m.cleanPct} label=${d.metrics?.first_pass?.label || "Clean first pass"} color=${C.aurora} />` }))} empty="No worker runs in this range" /></div><//>
    <${Card} title="Important work that skipped review" span=${true}
      tools=${d.violations?.length ? null : html`<span class="review-clear muted small">None (STOP tasks exempt)</span>`}>
      ${d.violations?.length ? html`<ul class="stats-list">${d.violations.slice(0, 5).map(x => html`<li><time>${dayLabel(x.day)}</time><span title=${x.note}>${x.note?.length > 90 ? x.note.slice(0, 89) + '…' : x.note}</span></li>`)}</ul>`
        : ''}<//>
  <//></div>`;
}

const usageUi = { perDay: 'all', top: 'tools' };
/* Intent: rank models with four columns only. Status: ready. Next: host screenshots.
 * Blockers: none. Confidence: real htm rendering. */
function ModelRanks({ models, colors }) {
  const shown = models.filter(m => m.total > 0), all = sum(shown.map(m => m.total)), top = Math.max(1, ...shown.map(m => m.total));
  return shown.length ? html`<div class="model-ranks">
    <div class="model-rank head"><span>Model</span><span>Tokens</span><span class="n">Share</span><span class="n">Total</span></div>
    ${shown.map(m => html`<div class="model-rank"><span class="ell" title=${`${m.model} (${m.source})`}>${m.model}</span>
      <${SegBar} parts=${[{ v: m.total, color: colors.get(`${m.source}|${m.model}`) || C.neutral, label: m.model }]} of=${m.total / top * 100} height=${7} />
      <span class="n">${share(m.total, all)}</span><span class="n">${fmt(m.total)}</span></div>`)}</div>` : html`<p class="empty">No tokens in this range</p>`;
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

/* Intent: one quota forecast card, three small charts, retaining unknown/stale forecast evidence.
 * Status: current account only. Next: host screenshots. Blockers: none. Confidence: fixture render tests. */
function Forecasts({ d, now }) {
  const live = (d.quota || []).filter(q => !q.expired);
  const codex = live.filter(q => q.source === 'codex').sort((a, b) => (b.windowSecs || 0) - (a.windowSecs || 0))[0];
  const picks = [live.find(q => q.source === 'claude' && q.window === 'five_hour'), live.find(q => q.source === 'claude' && q.window === 'seven_day'), codex];
  return html`<div class="forecast-grid">${picks.map((q, i) => {
    const f = q && d.forecast.find(f => f.source === q.source && f.window === q.window && f.account === q.account);
    const ft = forecastText(f);
    return html`<div class="forecast-one"><h4>${q ? quotaName(q) : ['Claude 5-hour', 'Claude 7-day', 'Codex 7-day'][i]}</h4>
      ${f ? html`<p class=${'fc-text ' + ft.tone}>${ft.text}${f.stale ? ' · stale data' : ''}</p>
        ${f.points.length ? html`<${ForecastPlot} f=${f} now=${now} height=${150} />` : html`<p class="empty">No snapshots in this period</p>`}` : html`<p class="empty">No live quota window</p>`}</div>`;
  })}</div>`;
}

/* Intent: five Usage cards: source split, daily tokens, models, quota forecasts and tabbed calls.
 * Status: compact. Next: host screenshots. Blockers: none. Confidence: empty/populated UI tests. */
function Cost({ d, now }) {
  const [perDay, setPerDayState] = useState(usageUi.perDay), [top, setTopState] = useState(usageUi.top);
  const setPerDay = v => { usageUi.perDay = v; setPerDayState(v); };
  const setTop = v => { usageUi.top = v; setTopState(v); };
  const daily = useMemo(() => {
    const pick = s => (perDay === 'output' ? d[s].output : d.days.map((_, i) => d[s].output[i] + d[s].input[i] + d[s].cacheRead[i] + d[s].cacheWrite[i]));
    return [{ label: 'Claude', data: pick('claude'), color: C.claude, kind: 'bar' }, { label: 'Codex', data: pick('codex'), color: C.codex, kind: 'bar' }];
  }, [d, perDay]);
  const colors = useMemo(() => modelColors(d.models), [d]);
  return html`<div class="slim-page"><${Grid}>
    <${Card} title="Who uses the tokens: Claude or Codex?" span=${true} src="All tokens in the selected range: fresh input + cache read + cache write + output.">
      <${ShareBar} parts=${['claude', 'codex'].map(s => ({ v: d.totals[s].total, color: SOURCE[s], label: s === 'claude' ? 'Claude' : 'Codex' }))} /><//>
    <${Card} title="How many tokens per day?" tools=${html`<${Chips} options=${[['all', 'All'], ['output', 'Output']]} value=${perDay} onPick=${setPerDay} />`}>
      <${Chart} days=${d.days} series=${daily} stacked=${true} height=${170} /><//>
    <${Card} title="Which models use the most tokens?"><${ModelRanks} models=${d.models} colors=${colors} /><//>
    <${Card} title="Will each quota run out?" span=${true} src="Current windows, linear projection from quota snapshots. Dashed = projection; vertical mark = now; cap = 100%."><${Forecasts} d=${d} now=${now} /><//>
    <${Card} title="What does Claude call most?" span=${true} tools=${html`<${Chips} options=${[['tools', 'Tools'], ['skills', 'Skills'], ['mcp', 'MCP'], ['subagents', 'Sub-agents']]} value=${top} onPick=${setTop} />`}>
      <${Ranked} t=${{ ...d.tops[top], rows: d.tops[top].rows.slice(0, 5) }} compact=${true} unit=${top === 'subagents' ? 'runs' : 'calls'} /><//>
  <//></div>`;
}

const bytes = b => (b === null || b === undefined ? '–' : b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`);
const msText = v => (v === null || v === undefined ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
// Break opportunities after path separators, so a folder label wraps at '/' and never inside a word.
const pathBreaks = text => String(text).split(/(?<=[\\/])/).flatMap((part, i) => (i ? [html`<wbr />`, part] : [part]));
/* Intent: one threshold scale for Machine's used capacity (free RAM is inverted by the caller).
 * Status: display only; alert rules unchanged. Next: none. Blockers: none. Confidence: boundary fixtures. */
const usedTone = used => !Number.isFinite(used) ? 'var(--muted)' : used > 85 ? 'var(--bad)' : used >= 70 ? 'var(--warn)' : 'var(--aurora)';

/* Intent: place every sampler alert on a calendar-day axis, stacking same-day dots by rule.
 * Status: compact range-aware timeline. Next: host screenshots. Blockers: none. Confidence: count fixtures. */
function AlertTimeline({ alerts = [], days = [] }) {
  const dated = alerts.filter(a => Number.isFinite(a.ts)).map(a => {
    const date = new Date(a.ts * 1000);
    return { ...a, day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` };
  });
  const bounds = [...days, ...dated.map(a => a.day)].sort(), first = bounds[0], last = bounds.at(-1);
  if (!first) return html`<p class="empty compact">No alert raised yet</p>`;
  const ordinalDay = day => Date.parse(`${day}T00:00:00Z`) / 864e5;
  const start = ordinalDay(first), span = ordinalDay(last) - start;
  const rules = [...new Set(dated.map(a => a.rule))].sort();
  const colors = { a: C.claude, b: C.bad, c: C.mars, d: C.warn, e: C.codex, f: C.neutral, g: C.rose, h: C.aurora };
  const color = rule => colors[rule] || C.muted;
  const stacks = new Map();
  const points = dated.map(a => { const n = stacks.get(a.day) || 0; stacks.set(a.day, n + 1); return { ...a, n }; });
  const axisY = Math.max(48, 16 + Math.max(1, ...stacks.values()) * 9), height = axisY + 28;
  return html`<div class="alert-timeline"><svg viewBox=${`0 0 800 ${height}`} width="100%" role="img" aria-label="Recent alerts by day and rule">
    <line x1="16" x2="784" y1=${axisY} y2=${axisY} stroke="var(--line)" />
    ${[...new Set([first, days[Math.floor(days.length / 2)], last].filter(Boolean))].map(day => {
      const x = span ? 16 + (ordinalDay(day) - start) / span * 768 : 400;
      return html`<g><line x1=${x} x2=${x} y1=${axisY} y2=${axisY + 4} stroke="var(--muted)" />
        <text x=${x} y=${axisY + 17} text-anchor=${day === first ? 'start' : day === last ? 'end' : 'middle'}>${dayLabel(day)}</text></g>`;
    })}
    ${points.map(a => html`<circle class="alert-dot" cx=${span ? 16 + (ordinalDay(a.day) - start) / span * 768 : 400} cy=${axisY - 9 - a.n * 9} r="3.5" fill=${color(a.rule)}>
      <title>${`${stamp(a.ts)} · Rule ${a.rule}: ${a.text}`}</title></circle>`)}
    </svg><div class="stats-legend">${rules.map(rule => html`<span><i class="sw" style=${`background:${color(rule)}`}></i>Rule ${rule}</span>`)}</div></div>`;
}

/* Intent: chart-first Machine, restoring the daily RAM and working-set views from pre-H10 System.
 * Status: existing sampler fields only. Next: host screenshots. Blockers: none. Confidence: fixture render tests. */
function Machine({ d = {} }) {
  const s = d.sample, daily = d.daily || { days: [], ramMin: [], ramAvg: [], commitMax: [] };
  const drives = ['C:', 'D:'].map(name => (s?.drives || []).find(x => x.d.toUpperCase() === name));
  const ramSeries = useMemo(() => [{ label: 'Lowest free RAM', data: daily.ramMin, color: C.bad, fmt: pct, points: true, fill: false },
    { label: 'Average free RAM', data: daily.ramAvg, color: C.aurora, fmt: pct, points: true, fill: false },
    { label: 'Highest commit', data: daily.commitMax, color: C.mars, dash: true, fmt: pct, points: true, fill: false }], [d]);
  const errors = d.hookErrors || 0, timeouts = d.hookTimeouts || 0;
  return html`<div class="slim-page stats-page machine-page"><${Grid}>
    <${Card} title="Does the machine have room?" span=${true} tools=${html`<span class="muted small">${s ? `sampled ${stamp(s.ts)}` : 'No system sample yet'}</span>${d.stale ? html`<span class="pill run">stale</span>` : ''}`}>
      <div class="machine-rings"><${Ring} value=${s?.ram.freePct} label="RAM" color=${usedTone(s?.ram.freePct == null ? null : 100 - s.ram.freePct)} title=${`Free RAM: ${pct(s?.ram.freePct)}`} />
        <${Ring} value=${s?.ram.commitPct} label="Commit" color=${usedTone(s?.ram.commitPct)} />
        <${Ring} value=${drives[0]?.usedPct} label="C:" color=${usedTone(drives[0]?.usedPct)} title=${`Drive C used: ${pct(drives[0]?.usedPct)}`} />
        ${drives[1] ? html`<${Ring} value=${drives[1].usedPct} label="D:" color=${usedTone(drives[1].usedPct)} title=${`Drive D used: ${pct(drives[1].usedPct)}`} />` : ''}
        <div class="hook-stat"><span><i class="status-dot" style=${`background:var(--${errors + timeouts > 0 ? 'bad' : 'aurora'})`}></i>Hooks</span><b>${errors} / ${timeouts}</b><span class="muted small">errors / timeouts</span></div></div><//>
    <${Card} title="Is RAM running out?" src="Daily lowest and average free RAM %, plus highest commit %. Missing samples stay unknown.">
      <${Chart} days=${daily.days} series=${ramSeries} yMax=${100} height=${190} /><//>
    <${Card} title="Hooks close to their timeout" src="Top six by p95 / configured timeout; unknown limits sort last. p95 uses raw events and archived duration bins.">
      <${HBar} max=${100} marker=${50} rows=${(d.hooks || []).slice(0, 6).map(x => {
        const value = x.timeoutMs && x.p95_ms != null ? x.p95_ms / x.timeoutMs * 100 : null;
        return { label: x.script, value, color: value === null ? C.muted : value > 50 ? C.bad : value > 25 ? C.warn : C.aurora,
          display: `${x.p95_ms == null ? '–' : round1(x.p95_ms / 1000) + ' s'} / ${x.timeoutMs ? round1(x.timeoutMs / 1000) + ' s' : '–'}`,
          title: `${x.script}: ${pct(value === null ? null : round1(value))} of timeout` };
      })} empty="No hook runs in this range" /><p class="muted small compact">Dashed mark: 50% of timeout</p><//>
    <${Card} title="Which folders grow?" src="Top six folders by size. Growth uses up to seven days of sampler measurements; grey means insufficient history.">
      <${HBar} rows=${(d.folders || []).slice(0, 6).map(f => ({ label: f.label, value: f.bytes, display: bytes(f.bytes), color: C.codex,
        extra: html`<span class="growth-chip" style=${`color:var(--${f.growthPerDay == null || f.growthPerDay === 0 ? 'muted' : f.growthPerDay > 0 ? 'warn' : 'aurora'})`}>
          ${f.growthPerDay == null ? '– / day' : `${f.growthPerDay < 0 ? '-' : '+'}${bytes(Math.abs(f.growthPerDay))} / day`}</span>` }))} empty="No folder sizes yet" /><//>
    <${Card} title="What holds the memory?" src="Top six process names by working set in the newest sample, summed over processes of that name.">
      <${HBar} rows=${(d.processes || []).slice(0, 6).map(p => ({ label: p.name, value: p.mb, display: `${fmt(p.mb)} MB`, color: C.mars,
        title: `${p.name}: ${p.mb} MB${p.count > 1 ? ` in ${p.count} processes` : ''}` }))} empty="No process list in the last sample" /><//>
    <${Card} title="Recent alerts" span=${true} src="Every returned sampler alert by day and rule, with the newest four below. The axis includes older alerts when present; notification rules are unchanged.">
      <${AlertTimeline} alerts=${d.alerts || []} days=${daily.days} />
      <ul class="stats-list">${[...(d.alerts || [])].sort((a, b) => b.ts - a.ts).slice(0, 4).map(a => html`<li class="alert-item"><time>${stamp(a.ts)}</time><span title=${`Rule ${a.rule}: ${a.text}`}>${a.text}</span></li>`)}</ul><//>
  <//></div>`;
}

/* ---------- Trace ---------- */
const LOST_SECS = 2 * 86400;   // no exit after 2 days = lost worker
const GAP_SECS = 30 * 60;      // idle longer than this is compressed into a break mark
const RUNNING_CAP = 6 * 3600;  // a running run is drawn at most this long, so one stuck run cannot dominate
// Kept across range changes (the page remounts while it loads).
const traceUi = { project: 'all', open: null, heat: false, problems: true };

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

/* Intent: keep scatter and lanes while defaulting to sessions with failed or lost runs.
 * Status: repo filters preserved. Next: host screenshots. Blockers: none. Confidence: interaction fixtures. */
function Trace({ d }) {
  const [problems, setProblemsState] = useState(traceUi.problems);
  const setProblems = v => { traceUi.problems = v; setProblemsState(v); };
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
  const visibleSessions = sessions.filter(s => (selected === 'all' || s.project === selected) && (!problems || s.runs.some(isFail)));
  const shown = projects.filter(p => visibleSessions.some(s => s.project === p.name));
  const keyOf = s => `${s.project}:${s.session_id || 'none'}`;
  const rowId = s => `srow-${sessions.indexOf(s)}`;
  // Open a row and bring it into view (failed chips, scatter clicks).
  const reveal = s => {
    if (!s) return;
    setOpen(keyOf(s));
    if (selected !== 'all' && selected !== s.project) setProject('all');
    setTimeout(() => document.getElementById(rowId(s))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  };
  const scatterRuns = useMemo(() => {
    // Scatter has no session id: use lane membership where available, plus failed/lost points beyond the lane cap.
    const problemRuns = new Set(visibleSessions.flatMap(s => s.runs.map(r => r.run_id)));
    return d.scatter.filter(r => (selected === 'all' || (r.project || '–') === selected) && (!problems || isFail(r) || problemRuns.has(r.run_id)));
  }, [d, selected, problems]);
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
      <button class=${'chip' + (problems ? ' on' : '')} aria-pressed=${problems} onClick=${() => setProblems(!problems)}>Problems only</button>
      <button class=${'chip' + (!problems && selected === 'all' ? ' on' : '')} onClick=${() => { setProject('all'); setProblems(false); }}>All<b>${sessions.length}</b></button>
      ${(moreChips ? projects : projects.slice(0, 8)).map(p => html`<button class=${'chip' + (selected === p.name ? ' on' : '')} title=${p.name} onClick=${() => setProject(p.name)}>${p.name}<b>${p.sessions}</b></button>`)}
      ${projects.length > 8 ? html`<button class="chip" onClick=${() => setMoreChips(!moreChips)}>${moreChips ? 'Less' : `+${projects.length - 8} more`}</button>` : ''}
    </div>
    <${Card} title="Which runs were slow or failed?" src=${`One point per Codex run in the range${selected === 'all' ? '' : ` in ${selected}`}. y = duration (log scale). Hover for details, click to open its session.${d.scatter.length >= 600 ? ' Latest 600 runs.' : ''}`}
      tools=${html`<div class="legend-row compact"><span><i class="sw dot lav"></i>exit 0 <b>${counts.ok}</b></span><span><i class="sw dot red"></i>failed <b>${counts.failed}</b></span>
        <span><i class="sw dot amb"></i>running <b>${counts.running}</b></span><span><i class="sw dot ring"></i>lost <b>${counts.lost}</b></span></div>`}>
      ${scatterRuns.length ? html`<${RunScatter} runs=${scatterRuns} start=${d.start} now=${now} onPick=${pick} />` : html`<p class="empty">${problems ? 'No failed or lost runs in this range' : 'No runs in this range'}</p>`}<//>
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
      ${visibleSessions.filter(s => s.project === p.name).map(s => {
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
                ${r.same_session_as ? html`<td class="n opt muted" colspan="2" title=${`Same Codex session as run ${r.same_session_as} (a resume): its tokens are shown on that run, once.`}>same session</td>`
                  : html`<td class="n opt">${fmt(r.codex_output)}</td><td class="n opt" title=${r.codex_root ? `Root thread ${r.codex_root}${r.codex_threads > 1 ? ` + ${r.codex_threads - 1} sub-agent thread(s)` : ''}: the whole tree is counted.` : 'no Codex rollout found for this run'}>${fmt(r.codex_total)}</td>`}</tr>`; })}</tbody></table>
            ${s.output ? html`<p class="foot">Claude output in this session (all repos): ${fmt(s.output)}</p>` : ''}</div>` : ''}`;
      })}
    </section>`) : html`<section class="card"><p class="empty">${problems ? 'No failed or lost runs in this range' : 'No runs in this range'}</p></section>`}`;
}

const root = document.getElementById('app');
root.textContent = ''; // drop the static boot text before Preact takes over
// Before the first render, so charts read the right colours. A theme= hash param wins and is not remembered.
const forced = hashParams().get('theme');
applyTheme(forced === 'light' || forced === 'dark' ? forced : storedTheme(), !forced);
installTips(); // styled hover tips for every chart and `title` (charts.js)
render(html`<${App} />`, root);
