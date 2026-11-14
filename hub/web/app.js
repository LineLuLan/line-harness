/* Intent: Line Hub dashboard - ten read-only pages over /api/<page>?days=N (/api/models also takes &model=<key>&tier=<tier>).
 * Status: UI v6 part 1 (H6a, 2026-11-14) = the v4 dashboard on schema v8. Portfolio look (dark + kafka,
 * light toggle), titles phrased as questions with source notes behind an (i) tip, a one-glance Overview
 * (one-line "Do this now", KPIs with delta + sparkline, "Needs attention", activity, Claude vs Codex,
 * radar preview) and a Supervisor page with two Claude vs Codex radars. Claude = kafka, Codex = nebula.
 * From v5: the System page, the one-line action box, quota names / pace from the server, the delegation
 * cards on the Worker page and run-tree tokens on Trace. The 30 / 70 split is retired: Productivity shows
 * quota pace per side. Denser layout (card padding 12 px, 10 px gaps).
 * v6 part 2 (H6b): the Models page (nav after Worker) - a comparison row per model key and the detail of
 * one picked key. Hash: #models/<encodeURIComponent(key)>?days=N; readHash splits the page part on '/'.
 * Hash params: days=<1|7|14|30|90>, theme=<dark|light> (for screenshots; not remembered).
 * Next: none. Blockers: none. Confidence: headless Edge screenshots 1366x768, dark. */
import { h, render, cloneElement } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { Chart, COLORS as C, fmt, dayLabel, installTips, refreshColors } from './charts.js';
import { KIND, SOURCE, modelColors, share, SegBar, ShareBar, Spark, Delta, RunScatter, ForecastPlot, forecastText, Flag, runStatus, stamp, Radar } from './viz.js';
import { readRoute, hashOf, hashParams as routeParams } from './route.js';
const html = htm.bind(h);

// Simple stroke icons (24x24 viewBox), drawn for this project.
const ICON = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  supervisor: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7M16.5 17.5l1.5 1.5 3-3',
  workers: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  models: 'M12 3l8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5',
  cost: 'M4 18a8 8 0 1 1 16 0M12 18l4.5-5.5M7 18h10',
  productivity: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  harness: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  gates: 'M4 4h16v16H4zM8 8h8M8 12h5M8 16h2',
  system: 'M4 5h16v10H4zM9 19h6M12 15v4',
  trace: 'M4 6h9M4 12h16M4 18h6M15 4v4M18 10v4M12 16v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
};
const PAGES = [
  { id: 'overview', label: 'Overview', lead: 'The whole harness at a glance.' },
  { id: 'supervisor', label: 'Supervisor', lead: 'Claude only: hands-on work, sessions, review and models.' },
  { id: 'workers', label: 'Worker', lead: 'Codex only: run outcomes and review quality.' },
  { id: 'models', label: 'Models', lead: 'Every Claude family and Codex model side by side; pick one for its detail.' },
  { id: 'cost', label: 'Usage', lead: 'Tokens and quota by source, model, skill and tool.' },
  { id: 'productivity', label: 'Productivity', lead: 'Volume, speed and quota pace per side.' },
  { id: 'harness', label: 'Harness', lead: 'Hooks, sandbox and collector health.' },
  { id: 'gates', label: 'Gates', lead: 'Review coverage and defects caught at each layer.' },
  { id: 'system', label: 'System', lead: 'RAM, disk, folders, processes and hook limits.' },
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
function applyTheme(t, remember = true) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  if (remember) { try { localStorage.setItem(THEME_KEY, t); } catch { /* private window: not remembered */ } }
  refreshColors();
}

// Routing lives in route.js (pure, tested in Node): #<page>?days=N, or #models/<encodeURIComponent(id)>?days=N (H6b).
const hashParams = () => routeParams(location.hash);
const readHash = () => readRoute(location.hash, PAGES.map(p => p.id), RANGES.map(r => r[0]));
const Icon = ({ d }) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

function App() {
  const [state, setState] = useState(readHash);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [modelTier, setModelTier] = useState('All');
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => { const on = () => setState(readHash()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => {
    let live = true;
    setError(null);
    const model = state.page === 'models' && state.model ? `&model=${encodeURIComponent(state.model)}` : '';
    const tier = state.page === 'models' ? `&tier=${encodeURIComponent(modelTier)}` : '';
    const load = () => fetch(`/api/${state.page}?days=${state.days}${model}${tier}`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error === 'no-db' ? 'No data yet. Run: npm run collect -- --full' : `Server error (${body.error || r.status})`);
      return body;
    }).then(b => { if (live) { setError(null); setPayload({ ...b, page: state.page, model: state.model }); } })
      .catch(e => live && setError(e instanceof TypeError ? 'The Line Hub server has stopped. Start it again: npm run hub' : e.message));
    load();
    // Poll only while the tab is visible, so a forgotten background tab lets the server idle out.
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const t = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [state.page, state.days, state.model, modelTier]);
  const go = (page, days, model = null) => { location.hash = hashOf(page, days, model); };
  // New colours are read first; the keyed <main> then remounts so every chart redraws with them.
  const toggleTheme = () => { const t = theme === 'dark' ? 'light' : 'dark'; applyTheme(t); setTheme(t); };
  // The Models page keeps its comparison table on screen while another pick loads (Models compares `loaded` with `model`).
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
      <main key=${theme}>${error ? html`<div class="error">${error}</div>` : !ready ? html`<p class="boot">Loading…</p>`
        : html`<${Page} id=${state.page} p=${payload} model=${state.model} tier=${modelTier} setTier=${setModelTier} pick=${key => go('models', state.days, key)} />`}</main>
    </div>
  </div>`;
}

function Page({ id, p, model, pick, tier, setTier }) {
  const View = { overview: Overview, supervisor: Supervisor, workers: Workers, models: Models, cost: Cost, productivity: Productivity, harness: Harness, gates: Gates, system: System, trace: Trace }[id];
  return html`<${View} d=${p.data} range=${p.range} now=${p.now} model=${model} loaded=${p.model} pick=${pick} tier=${tier} setTier=${setTier} />`;
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

// Quota names come from the server (quotaName(): window length and account, e.g. "Codex 7-day").
const quotaName = q => q.name || `${q.source} ${q.window}`;
const findForecast = (list, q) => (list || []).find(f => f.source === q.source && f.window === q.window);
const hourLabel = k => k || '';
const PACE_CAP = 3; // Productivity pace chart: y axis 0..3x
const paceText = v => (v === null || v === undefined ? '–' : `${v.toFixed(2)}x`);

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

// "Do this now" (server actionBox): ONE compact line, the first rule that fires; a muted line when none does.
const RULE_NAME = { a: 'quota pace', b: 'commit charge', c: 'disk', d: 'first-pass clean', e: 'hook time', f: 'stray AGENTS.md', g: '50M thread', h: 'Claude 5-hour' };
function ActionLine({ a, stale, sampleTs, days }) {
  if (!a) return '';
  // The stale note goes before the action text, so the line's ellipsis never hides it.
  const staleNote = stale ? `system sample from ${stamp(sampleTs)} is stale (over 10 min), commit rule skipped` : '';
  if (a.rule === null) return html`<div class="action-line ok" role="status" title=${staleNote}><span class="al-text muted">All clear${staleNote ? ` (${staleNote})` : ''} - next reset ${a.nextReset ? `${a.nextReset.name} ${stamp(a.nextReset.at)}` : 'unknown (no live quota window)'}</span></div>`;
  const page = PAGES.find(p => p.id === a.href);
  return html`<div class=${'action-line ' + a.level} role="status" title=${`Rule ${a.rule} (${RULE_NAME[a.rule]}): ${a.text}${staleNote ? `\n${staleNote}` : ''}\nAction: ${a.action}`}>
    <span class="al-rule">Do this now · ${RULE_NAME[a.rule]}</span><span class="al-text"><b>${a.text}</b>${staleNote ? html` <span class="muted">(${staleNote})</span>` : ''} ${a.action}</span>
    ${page ? html`<a href=${`#${page.id}?days=${days}`}>${page.label} →</a>` : ''}</div>`;
}

/* H8a: usage card + routing card (server usage() and routeAdvice()). Dense two-line rows, no tiles.
 * Intent: quota used/left and today's routing at the top of Overview. Status: done. Next: none.
 * Blockers: none. Confidence: real-DB render at 1440 / 390 px (H8a report). */
// Intent: API thresholds keep both pace tables aligned with routing. Status: complete.
// Next: none. Blockers: none. Confidence: component fixture tests.
// Fallback thresholds when an older server omits them (same values as the built-in Hub constants).
const DEFAULT_THRESHOLDS = { codexPace1: 1.0, codexPace2: 1.3, codexUsed1: 70, codexUsed2: 85, codexUsed3: 95, claudePace: 1.2, claudeUsed: 70, claude5Used: 80 };
const paceClass = (pace, early, thresholds = DEFAULT_THRESHOLDS) => (pace === null || pace === undefined || early ? ''
  : pace > thresholds.codexPace2 ? 'fail' : pace > thresholds.codexPace1 ? 'run' : 'ok');
function UsageCard({ u, thresholds }) {
  if (!u) return '';
  const tools = html`<span class="muted small">data as of ${u.lastRun ? stamp(u.lastRun) : 'never'}</span>${u.stale ? html` <span class="pill run" title="the collector last ran over an hour ago">stale</span>` : ''}`;
  return html`<${Card} title="How much quota is left?" tools=${tools}
    src=${`Live quotas of the current account (Claude 7-day, Claude 5-hour, the longest Codex window). Pace = used % / elapsed % of the window; "early" = under 5% of the window gone or no window length. At reset = forecast() linear projection (Codex and Claude 7-day only). Stale = collector last ran over ${Math.round(u.freshSecs / 60)} min ago (snapshot age is not used: snapshots are written only when the value changes). Source: quota_snapshots, meta.`}>
    ${u.rows.length ? html`<table class="usage-table"><thead><tr><th>Quota</th><th class="n">Used / left</th><th class="n" title="pace; arrow = projected used % at the reset">Pace · at reset</th></tr></thead>
    <tbody>${u.rows.map(r => html`<tr>
      <td class="name"><b>${r.name}</b><span class="u2">resets ${when(r.resetsAt)} · ${r.hoursLeft} h left</span></td>
      <td class="n"><b>${pct(r.usedPct)}</b><span class="u2">${pct(r.leftPct)} left</span></td>
      <td class="n"><span class=${'pill ' + paceClass(r.pace, r.early, thresholds)} title=${r.unknownWindow ? 'window length unknown' : r.early ? 'early in the window: not over any pace threshold' : ''}>${r.early ? 'early' : paceText(r.pace)}</span>
        ${r.projection ? html`<span class="u2 nw" title="forecast() linear projection at the reset">${r.projectedAtReset === null ? 'reset n/a' : `→ ${pct(r.projectedAtReset)}`}</span>` : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="empty">No live quota window</p>`}
    ${u.others.length ? html`<div class="sub-h">Other Codex accounts (current period)</div><ul class="u-others">${u.others.map(o => html`<li title=${o.name}>
      <span class="ell">${o.account}</span><span class="n">${pct(o.usedPct)} used · ${pct(o.leftPct)} left · resets ${when(o.resetsAt)}</span><span class="muted small">${o.label}</span></li>`)}</ul>` : ''}<//>`;
}
function RoutingCard({ r }) {
  if (!r) return '';
  const banners = r.notes.filter(n => /^STOP:|^Claude 5-hour >= /.test(n));
  const rest = r.notes.filter(n => !banners.includes(n));
  const t = r.thresholds || DEFAULT_THRESHOLDS;
  const levels = html`<div class="legend-row compact route-levels"><span class=${'pill ' + (r.codexLevel === 'C0' ? 'ok' : r.codexLevel === 'C1' ? 'run' : 'fail')}>Codex ${r.codexLevel}</span><span class=${'pill ' + (r.claudeLevel === 'K0' ? 'ok' : 'fail')}>Claude ${r.claudeLevel}</span>${r.handoff ? html`<span class="pill fail">5-hour handoff</span>` : ''}</div>`;
  return html`<${Card} span2=${true} title="Which model for which work today?"
    src=${`CLAUDE.md 'Route by quota pace' from the live pace (routeAdvice). Codex C1: pace > ${Number.isInteger(t.codexPace1) ? t.codexPace1.toFixed(1) : t.codexPace1} or used >= ${t.codexUsed1}%; C2: pace > ${t.codexPace2} or used >= ${t.codexUsed2}%; C3: used >= ${t.codexUsed3}%. Claude K1: 7-day pace > ${t.claudePace} or used >= ${t.claudeUsed}%. STOP: C3 with K1 only. K1+C2 Standard-A and Standard-B stay on Sol; Line 2026-11-15: Standard never deferred. Early or unknown pace counts as under every pace threshold.`}>
    ${levels}${banners.map(b => html`<div class="route-banner" role="status">${b}</div>`)}
    <table class="route-table"><thead><tr><th>Work</th><th>Model</th><th class="opt">Rule</th></tr></thead>
    <tbody>${r.rows.map(x => html`<tr><td class="work">${x.work}</td><td class="wrap"><b>${x.model}</b><span class="u2 only-narrow">${x.rule}</span></td>
      <td class="wrap opt muted small">${x.rule}</td></tr>`)}</tbody></table>
    ${rest.length ? html`<p class="card-sub">${rest.join(' · ')}</p>` : ''}<//>`;
}

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
    <${ActionLine} a=${d.action} stale=${d.stale} sampleTs=${d.sampleTs} days=${days} />
    ${d.usage || d.route ? html`<div class="grid cols-3 top-pair"><${UsageCard} u=${d.usage} thresholds=${d.route?.thresholds} /><${RoutingCard} r=${d.route} /></div>` : ''}
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
        info=${`Lowest quota left across windows, with its linear forecast.\n${d.quota.map(q => `${quotaName(q)}: ${q.expired ? 'period ended' : `${Math.round(q.used_pct)}% used, pace ${paceText(q.pace)}, resets ${stamp(q.resets_at)}`}`).join('\n') || 'no snapshots'}`}>
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
function Workers({ d, range }) {
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
    <//>
    ${d.delegation ? html`<h2 class="section">Delegation</h2><${Delegation} g=${d.delegation} days=${range.days} />` : ''}`;
}

/* Worker > Delegation (v5 metrics, v4 look): only cards v4 had no equivalent for. */
const BarCell = ({ v, max = 100, text, color = C.codex }) => html`<span class="cell-bar"><${SegBar} parts=${[{ v: v || 0, color, label: text }]} of=${Math.max(0, Math.min(100, (v || 0) / max * 100))} height=${6} /><b>${text}</b></span>`;
function Delegation({ g, days }) {
  const R = g.ratios, col = x => (x.days === days && ![7, 30].includes(x.days) ? `${x.days} d (range)` : `${x.days} d`);
  const rows = [['Ledger tasks', x => x.tasks, null, String], ['First-pass clean', x => x.cleanPct, 100, pct], ['Runs per task', x => x.runsPerTask, 3, v => v ?? '–'],
    ['Resumes per task', x => x.resumesPerTask, 1, v => v ?? '–'], ['FAIL rounds per task', x => x.failRoundsPerTask, 1, v => v ?? '–'], ['STOP rate (note names a STOP)', x => x.stopPct, 100, pct]];
  const pt = g.perTask, origin = [...g.tokensByOrigin].sort((a, b) => b.total - a.total), originAll = sum(origin.map(o => o.total));
  const oTop = Math.max(1, ...origin.map(o => o.total));
  const worst = w => [...w.rows].filter(r => r.n >= 2).sort((a, b) => a.pct - b.pct)[0];
  return html`<${Grid}>
    <${Card} span=${true} title="How much rework does each task need?"
      src="Aggregate ratios over every ledger task in the window: worker runs and resumes (daily_runs), FAIL rounds (ledger fail_rounds= or FAIL words), STOP = the ledger note names a worker STOP. Sources: review-ledger.log, runs/*.">
      <table><thead><tr><th>Measure</th>${R.map(x => html`<th class="n">${col(x)}</th>`)}</tr></thead>
      <tbody>${rows.map(([label, pick, max, show]) => html`<tr><td>${label}</td>${R.map(x => html`<td class="n">${max ? html`<${BarCell} v=${pick(x)} max=${max} text=${show(pick(x))} />` : show(pick(x))}</td>`)}</tr>`)}</tbody></table><//>
    ${g.byTierWorker.map(w => html`<${Card} title=${`Which tier and worker pass first time (${w.days} d)?`}
      src=${`Ledger tasks of the last ${w.days} days by tier and worker (worker= or the model named in the note). Clean = no finding in L1, L2 or L3 and no FAIL round.${w.tasks ? ` ${pct(w.pct)} of ${w.tasks} tasks were clean first time${worst(w) ? `; weakest group with 2+ tasks: ${worst(w).tier} / ${worst(w).worker} at ${pct(worst(w).pct)}` : ''}.` : ''}`}>
      ${w.rows.length ? html`<table><thead><tr><th>Tier</th><th>Worker</th><th class="n">Tasks</th><th class="n">Clean first time</th><th class="n opt">FAIL</th></tr></thead>
        <tbody>${w.rows.map(r => html`<tr><td class="nw">${r.tier}</td><${Name} text=${r.worker} /><td class="n">${r.n}</td><td class="n"><${BarCell} v=${r.pct} text=${`${pct(r.pct)} (${r.clean})`} color=${C.aurora} /></td><td class="n opt">${r.failRounds || '·'}</td></tr>`)}</tbody></table>`
        : html`<p class="empty">No ledger task in the last ${w.days} days</p>`}<//>`)}
    <${Card} title="How many runs and how long per task?"
      src=${`${pt.withRuns} of ${pt.tasks} ledger tasks in the range carry run ids. Only ledger lines with runs= (ledger-add.ps1 -RunIds) are used; no run is linked by time. Lead = first run start to last run end of the task. * = a run id not collected yet.`}>
      ${pt.withRuns ? html`<div class="mini-stats"><span><b>${pt.runsPerTask}</b> runs / task</span><span><b>${pt.resumesPerTask}</b> resumes / task</span><span><b>${pt.failRoundsPerTask}</b> FAIL / task</span>
        <span>lead median <b>${pt.leadMedianMin === null ? '–' : `${pt.leadMedianMin} min`}</b></span><span>p90 <b>${pt.leadP90Min === null ? '–' : `${pt.leadP90Min} min`}</b></span></div>
        <table><thead><tr><th>Day</th><th>Tier</th><th class="opt">Worker</th><th class="n">Runs</th><th class="n">Resumes</th><th class="n">FAIL</th><th class="n">Lead</th></tr></thead>
        <tbody>${pt.list.map(t => html`<tr><td>${dayLabel(t.day)}</td><td class="nw">${t.tier}</td><${Name} text=${t.worker} /><td class="n" title=${t.found < t.runs ? `${t.runs - t.found} run id(s) not collected yet` : ''}>${t.runs}${t.found < t.runs ? '*' : ''}</td><td class="n">${t.resumes || '·'}</td><td class="n">${t.failRounds || '·'}</td><td class="n">${t.leadMin === null ? '–' : `${t.leadMin}m`}</td></tr>`)}</tbody></table>`
        : html`<${NoData} title="No ledger line with runs= in this range" field="ledger runs= (ledger-add.ps1 -RunIds)" />`}<//>
    <${Card} title="Do big packets get resumed more?" src="Packet size = stdin.txt in the run folder. A run counts as resumed when a later -Resume run continues its Codex root thread. n/a = no stdin.txt copy.">
      <table><thead><tr><th>Packet size</th><th class="n">Runs</th><th class="n">Resumed</th><th class="n">Resume rate</th></tr></thead>
      <tbody>${g.resumeBySize.map(b => html`<tr><td>${b.bucket}</td><td class="n">${b.runs}</td><td class="n">${b.resumed}</td><td class="n"><${BarCell} v=${b.ratePct} text=${pct(b.ratePct)} color=${C.mars} /></td></tr>`)}</tbody></table><//>
    <${Card} title="Where do Codex tokens go?"
      src="Codex tokens per thread in the range (codex_days): a sub-agent thread (it has a parent thread), the root thread of a codex-do run, or any other Codex session (used directly).">
      ${originAll ? html`<div class="ranked wide">${origin.map(o => html`<div class="rk-row simple" title=${`${o.label}: ${o.total.toLocaleString('en-GB')} tokens in ${plural(o.threads, 'thread')}`}>
        <span class="rk-name">${o.label}</span><span class="rk-bar"><${SegBar} parts=${[{ v: o.total, color: C.codex, label: o.label }]} of=${o.total / oTop * 100} /></span>
        <span class="n">${share(o.total, originAll)}</span></div>`)}</div>` : html`<p class="empty">No Codex tokens in this range</p>`}<//>
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

/* ---------- Models (H6b) ---------- */
// Key = Claude family (Opus / Fable / Sonnet / Haiku / Other) or the exact Codex model name. Every empty field
// says "no data"; nothing is estimated. Paths and prompt text never reach the page: repo labels only.
const ND = 'no data';
const nd = (v, show = String) => (v === null || v === undefined ? ND : show(v));
const sideLabel = s => (s === 'codex' ? 'Codex' : 'Claude');
const LowBadge = ({ text }) => html`<span class="badge low" title=${`low data: ${text} in this range`}>low data</span>`;
const lowText = m => (m.side === 'codex' ? `${m.runs ?? 0} runs and ${m.threads ?? 0} threads (both under 3)` : `${m.sessions ?? 0} sessions (under 3)`);
// Codex rows: runs (codex-do) and threads (every Codex thread with tokens) are different populations; show both.
const runsText = m => (m.side === 'codex' ? (m.runs === null && m.threads === null ? ND : `${m.runs ?? 0} run${m.runs === 1 ? '' : 's'} · ${m.threads ?? 0} thr.`) : nd(m.sessions, v => `${v} sess.`));
const splitText = m => (m.runTokens === null || m.runTokens === undefined ? 'codex-do / other split: no data' : `codex-do ${fmt(m.runTokens)} · other ${fmt(m.otherTokens)}`);
/* Intent: formulas stay attached to every comparison number. Status: ready.
 * Next: host screenshots. Blockers: none. Confidence: fixture render checks. */
const EvidenceValue = ({ value, info }) => html`<span title=${info}>${value ?? 'n/a'}</span>`;
const EVIDENCE_FORMULA = {
  tasks: 'Ledger lines whose day is in the range; each line counts once.',
  firstPassPct: '100 x lines with fail_rounds = 0 / lines with fail_rounds NOT NULL; n is that denominator.',
  meanFailRounds: 'Sum of fail_rounds / lines with fail_rounds NOT NULL.',
  stopPct: '100 x ledger lines flagged STOP / tasks. A NULL stop flag falls back to the note parser.',
  defectsAfterWorker: 'Mean of L2 + L3 counts over lines with both counts; n is that denominator.',
  layer2Pct: '100 x tasks with layer2 = 1 / tasks. Only ledger field 3 supplies evidence: starts with yes or layer2 yes, or contains PASS/FAIL or L2/L2b/2/2b yes. Model names alone never count.',
  lateSharePct: '100 x summed L3 / summed (L1 + L2 + L3), using available counts; no defects gives n/a.',
  counts: 'Sum of known counts for this layer; n with counts is the number of ledger lines with a non-NULL count.',
  runs: 'Count of runs started in the range, including resumes.',
  resumePct: '100 x runs with is_resume = 1 / runs.',
  exit0Pct: '100 x runs with exit_code = 0 / runs with a non-NULL exit code; n is that denominator.',
  sandboxFailures: 'Count of runs with sandbox_failure = 1.',
  medianSecs: 'Median of ended - started in seconds for finished runs with a non-negative duration.',
  p90Secs: 'Nearest-rank 90th percentile of ended - started for finished runs.',
  medianTokens: 'Median total tokens of each run root thread plus sub-agents. Shared sessions count on their first run only; n is the token sample count.'
};
/* Intent: dense tables scroll within the card, with readable text and formula tips.
 * Status: ready. Next: host width checks. Blockers: none. Confidence: scoped CSS. */
function EvidenceTable({ rows, columns, label, empty = 'No data in this range.' }) {
  if (!rows.length) return html`<p class="empty">${empty}</p>`;
  return html`<div class="evidence-scroll" role="region" aria-label=${label} tabIndex="0"><table class="evidence-table">
    <thead><tr>${columns.map(([field, title, info]) => html`<th>${title}<${Info} text=${info || EVIDENCE_FORMULA[field]} /></th>`)}</tr></thead>
    <tbody>${rows.map(row => html`<tr>${columns.map(([field, , info, show]) => html`<td><${EvidenceValue}
      value=${show ? show(row) : row[field]} info=${info || EVIDENCE_FORMULA[field]} /></td>`)}</tr>`)}</tbody></table></div>`;
}
const evidencePct = v => v === null || v === undefined ? 'n/a' : `${v}%`;
const evidenceFirst = x => `${evidencePct(x.firstPassPct)} (n=${x.firstPassN})`;
const evidenceModel = x => html`${x.key}${x.lowData ? html`<span class="u2">low data</span>` : ''}`;
const OUTCOME_COLUMNS = [
  ['tasks', 'Tasks'], ['firstPassPct', 'First pass', null, evidenceFirst], ['meanFailRounds', 'Mean FAIL rounds'],
  ['stopPct', 'STOP', null, x => evidencePct(x.stopPct)],
  ['defectsAfterWorker', 'Defects after worker', null, x => `${x.defectsAfterWorker ?? 'n/a'} (n=${x.defectsN})`]
];

/* Intent: compare executions, outcomes and same-packet pairs without changing the hash.
 * Status: ready. Next: real pairs. Blockers: historical links absent. Confidence: API fixtures. */
function CompareModels({ d, tier, setTier, pairs }) {
  const pairRows = pairs.flatMap(p => p.models.map(m => ({ ...m, sha: p.sha, note: p.note, newest: p.newest })));
  return html`<${Card} span=${true} title="Compare models" src="Runs and ledger outcomes have separate denominators. Alphabetical rows, no ranking. Fewer than 3 runs or tasks is low data. Tier filters apply to these two blocks; A/B pairs use the date range."
    tools=${html`<label class="tier-select">Tier <select aria-label="Comparison tier" value=${tier} onChange=${e => setTier(e.target.value)}>${d.tiers.map(t => html`<option value=${t}>${t}</option>`)}</select></label>`}>
    ${d.tier !== tier ? html`<p class="empty">Loading comparison...</p>` : html`
      <h4 class="sub-h">Runs</h4>${d.runNotice ? html`<p class="card-sub">${d.runNotice}</p>` : ''}
      <${EvidenceTable} label="Model runs" rows=${d.runs} columns=${[
        ['key', 'Model', 'Exact Codex key; retired gpt-5.6 models share Other (Codex). Low data = fewer than 3 runs.', evidenceModel],
        ['effort', 'Effort', 'Stored effort name; NULL is default.'], ['runs', 'Runs'], ['resumePct', 'Resumes', null, x => evidencePct(x.resumePct)],
        ['exit0Pct', 'Exit 0', null, x => `${evidencePct(x.exit0Pct)} (n=${x.exitN})`], ['sandboxFailures', 'Sandbox failures'],
        ['medianSecs', 'Median seconds'], ['p90Secs', 'p90 seconds'], ['medianTokens', 'Median tokens', null, x => `${x.medianTokens ?? 'n/a'} (n=${x.tokenN})`]
      ]} />
      <h4 class="sub-h">Outcomes</h4><${EvidenceTable} label="Model outcomes" rows=${d.outcomes} columns=${[
        ['key', 'Model', 'Owner is the last linked run by start time; otherwise the ledger model key. Low data = fewer than 3 tasks.', evidenceModel], ...OUTCOME_COLUMNS
      ]} />`}
    <h4 class="sub-h">Same-packet A/B pairs</h4>
    <${EvidenceTable} label="Same-packet A/B pairs" rows=${pairRows} empty="No A/B pairs yet: dispatch the same packet with -Model A and -Model B." columns=${[
      ['sha', 'Packet SHA', 'Same SHA-256 packet, at least two distinct model keys; latest non-resumed run per key.'],
      ['newest', 'Latest pair start', 'Newest selected run start; pairs sorted newest first, at most 20.', x => when(x.newest)],
      ['key', 'Model'], ['effort', 'Effort'], ['exitCode', 'Exit', 'Recorded exit code; n/a if unfinished or unknown.'],
      ['durationSecs', 'Seconds', EVIDENCE_FORMULA.medianSecs.replace('Median of ', '')],
      ['totalTokens', 'Tokens', 'Root thread plus sub-agent total tokens; shared sessions only on the first run.'],
      ['failRounds', 'FAIL rounds', 'fail_rounds of the newest ledger line linked to this run; n/a if missing.'],
      ['note', 'Note', 'Note of a ledger line linked to any run of this packet.']
    ]} /><//>`;
}

/* Intent: show coverage, defect catches, review violations and trend without score colours.
 * Status: v10 shows review modes and separate gates-only totals. Next: host screenshots. Blockers: none. Confidence: gates fixtures. */
function Gates({ d }) {
  const counts = ['L1', 'L2', 'L3'].map(layer => [layer, layer, EVIDENCE_FORMULA.counts,
    x => `${x.defects[layer]} (${x.countsN[layer]} with counts)`]);
  return html`<${Grid}>
    <${Card} span=${true} title="Review layers by tier" src="Every ledger task belongs to exactly one tier, including Standard and Other."
      sub=${`${d.tasks} tasks in the range`}>
      <${EvidenceTable} label="Review layers by tier" rows=${d.tiers} columns=${[
        ['tier', 'Tier'], ['tasks', 'Tasks'], ['layer2Pct', 'Layer 2 used', null, x => evidencePct(x.layer2Pct)],
        ...OUTCOME_COLUMNS.slice(1, 4), ...counts, ['lateSharePct', 'Late share', null, x => evidencePct(x.lateSharePct)]
      ]} /><//>
    <${Card} title="Missing review gates" src="Important or Critical tasks without layer 2 and without STOP. Newest first, at most 20.">
      <${EvidenceTable} label="Missing review gates" rows=${d.violations} empty="No violations in this range." columns=${[['day', 'Day'], ['note', 'Note']]} /><//>
    <${Card} title="Reviewer results" src="Model and legacy reviews grouped by reviewer model key, effort and mode. Gates-only runs are excluded. Missing or unrecognized mode is unknown; NULL effort is unknown.">
      <${EvidenceTable} label="Reviewer results" rows=${d.reviewers} columns=${[
        ['key', 'Reviewer'], ['effort', 'Effort'], ['mode', 'Mode'], ['reviews', 'Reviews', 'Count of review records with timestamps in range, excluding gates-only.'],
        ['failPct', 'FAIL', '100 x reviews with verdict FAIL / reviews.', x => evidencePct(x.failPct)],
        ['meanP0P1', 'Mean P0 + P1', 'Sum of p0 + p1 / reviews.']
      ]} /><p class="small">gates-only runs: ${d.gatesOnlyRuns}</p><//>
    <${Card} span=${true} title="Weekly review trend" src="Monday-start weeks in the selected range, latest 8 weeks. Partial weeks use only tasks inside the range.">
      <${EvidenceTable} label="Weekly review trend" rows=${d.weeks} columns=${[
        ['week', 'Week of'], ['tasks', 'Tasks'], ['firstPassPct', 'First pass', null, evidenceFirst],
        ['lateSharePct', 'Late share', null, x => evidencePct(x.lateSharePct)]
      ]} /><//>
  <//>`;
}

function Models({ d, range, model, loaded, pick, tier, setTier }) {
  const rows = d.models, p = loaded === model ? d.picked : null;
  const top = Math.max(1, ...rows.map(r => r.tokens || 0));
  const rowTip = m => `${m.key} (${sideLabel(m.side)})\ntokens ${nd(m.tokens, v => v.toLocaleString('en-GB'))} · ${nd(m.sharePct, v => `${v}%`)} of ${sideLabel(m.side)}${m.side === 'codex' ? `\n${splitText(m)}\nruns ${nd(m.runs)} (codex-do) · threads ${nd(m.threads)} (all Codex threads)` : `\nsessions ${nd(m.sessions)}`} · ledger tasks ${m.ledgerTasks}\nclick to open the detail`;
  return html`<div class="model-page">
    <${Grid}>
      <${CompareModels} d=${d.compare} pairs=${d.pairs} tier=${tier} setTier=${setTier} />
      <${Card} span=${true} title="How do the models compare?" sub=${rows.length ? 'Click a row to open its detail below.' : ''}
        src=${`One row per model key: a Claude family (exact ids are shown in the detail) or an exact Codex model name; retired gpt-5.6-* = Other (Codex). Tokens = fresh input + cache read + cache write + output (daily_tokens). Runs = codex-do runs (daily_runs). ${d.sessionRule} ${d.threadRule} Clean first pass and FAIL rounds = ledger rows whose worker maps to the key. Low data (Claude) = fewer than 3 sessions. When a key exists on both sides, the Codex row is codex:<key>.`}>
        ${rows.length ? html`<table class="pick-table"><thead><tr><th>Model</th><th>Tokens</th><th class="n">Share of side</th><th class="n" title="Codex: codex-do runs · Codex threads; Claude: sessions">Runs / sessions</th><th class="n">Clean first pass</th><th class="n opt">FAIL rounds</th><th class="n">Median run</th></tr></thead>
          <tbody>${rows.map(m => html`<tr class=${'pick' + (m.id === model ? ' on' : '')} tabIndex="0" title=${rowTip(m)}
              onClick=${() => pick(m.id)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(m.id); } }}>
            <td class="name"><span class="mname"><span class=${'badge ' + m.side}>${sideLabel(m.side)}</span><span class="ell">${m.key}</span>${m.low ? html`<${LowBadge} text=${lowText(m)} />` : ''}</span></td>
            <td class="tok-cell"><span class="cell-bar"><span class="tok-track"><${SegBar} parts=${[{ v: m.tokens, color: m.side === 'codex' ? C.codex : C.claude, label: `${m.key} tokens` }]} of=${(m.tokens || 0) / top * 100} height=${6} /></span><b>${m.tokens === null ? html`<span class="dim">${ND}</span>` : fmt(m.tokens)}</b></span></td>
            <td class="n">${m.tokens > 0 && m.sharePct === 0 ? '<0.1%' : pct(m.sharePct)}</td>
            <td class="n">${runsText(m)}</td>
            <td class="n">${m.ledgerTasks ? html`<span title=${`${m.ledgerTasks} ledger tasks`}>${pct(m.cleanPct)} <span class="dim">(${m.ledgerTasks})</span></span>` : '–'}</td>
            <td class="n opt">${m.ledgerTasks ? m.failRounds || '·' : '–'}</td>
            <td class="n">${m.side === 'codex' ? secs(m.medianSecs) : html`<span class="dim">n/a</span>`}</td></tr>`)}</tbody></table>`
          : html`<${NoData} title="No model has tokens, runs, sessions or ledger rows in this range" field="daily_tokens, runs, claude_messages, ledger" />`}<//>
    <//>
    ${model && loaded !== model ? html`<p class="boot">Loading ${model}…</p>`
      : model && !p ? html`<div class="card note-line"><b>${model}</b> has no data in this range. Pick another model or a longer range.</div>`
      : p ? html`<${ModelDetail} p=${p} d=${d} pick=${pick} />`
      : rows.length ? html`<p class="card-sub hint">Pick a model above to see its tokens per day, runs or sessions, review results and latest work.</p>` : ''}</div>`;
}

const TopList = ({ t, unit = 'calls', color }) => {
  if (!t.rows.length) return html`<p class="empty">${ND}</p>`;
  const max = Math.max(1, ...t.rows.map(r => r.calls));
  return html`<div class="ranked wide">${t.rows.map(r => html`<div class="rk-row simple" title=${`${r.name}: ${r.calls.toLocaleString('en-GB')} ${unit} (${pct(r.sharePct)})`}>
      <span class="rk-name"><span class="ell">${r.name}</span></span><span class="rk-bar"><${SegBar} parts=${[{ v: r.calls, color, label: r.name }]} of=${r.calls / max * 100} height=${6} /></span>
      <span class="n">${r.calls.toLocaleString('en-GB')}</span></div>`)}
    <div class="rk-foot">${t.distinct > t.rows.length ? `top ${t.rows.length} of ${t.distinct} · ` : ''}${t.total.toLocaleString('en-GB')} ${unit} in total</div></div>`;
};

function ModelDetail({ p, d, pick }) {
  const codex = p.side === 'codex', color = codex ? C.codex : C.claude, L = p.ledger, R = p.runs;
  const tokSeries = useMemo(() => KIND.map(k => ({ label: k.label, data: p.tokens.daily[k.key], color: k.color, kind: 'bar' })), [p]);
  const fMax = Math.max(1, L.findings.L1, L.findings.L2, L.findings.L3);
  const tMax = Math.max(1, ...L.taskTypes.map(x => x.n));
  const outcome = codex && R ? [{ v: R.exit0, color: C.good, label: 'exit 0' }, { v: R.failed, color: C.bad, label: 'failed (exit 72 / 73 / other)' },
    { v: R.lost, color: C.warn, label: 'lost (no exit code after 2 days)' }, { v: R.running, color: C.neutral, label: 'running' }] : [];
  return html`
    <h2 class="section model-head"><span class=${'badge ' + p.side}>${sideLabel(p.side)}</span>${p.key}${p.low ? html`<${LowBadge} text=${lowText({ side: p.side, runs: R?.runs ?? null, threads: p.threads, sessions: p.sessions?.n ?? null })} />` : ''}
      <button class="linkish" onClick=${() => pick(null)} title="Close the detail">close</button></h2>
    <${Kpis}>
      <${Kpi} label="Tokens" value=${nd(p.tokens.total, fmt)} sub=${p.tokens.total === null ? 'no token rows in this range' : codex ? `${splitText(p.tokens)} · ${nd(p.threads)} threads` : `${pct(p.tokens.sharePct)} of Claude · output ${fmt(p.tokens.output)}`}
        info=${codex ? `Fresh input + cache read + cache write + output in the range (daily_tokens), ${pct(p.tokens.sharePct)} of Codex. ${d.threadRule}` : 'Fresh input + cache read + cache write + output in the range. Source: daily_tokens.'} />
      ${codex ? html`<${Kpi} label="Runs" value=${R ? R.runs : ND} sub=${R ? `exit 0 ${pct(R.exit0Pct)} · ${R.resumes} resumes` : 'no codex-do run in this range'} info="codex-do runs in the range. Source: daily_runs." />`
        : html`<${Kpi} label="Sessions" value=${nd(p.sessions.n)} sub=${p.sessions.messages === null ? 'no messages in this range' : `${fmt(p.sessions.messages)} messages`} info=${`${d.sessionRule} Messages = messages of this family (daily_tokens).`} />`}
      <${Kpi} label="Clean first pass" value=${nd(L.cleanPct, v => `${v}%`)} sub=${L.tasks ? `${plural(L.tasks, 'ledger task')}` : 'no ledger task names it'}
        info="Ledger tasks whose worker maps to this key with no finding in L1, L2 or L3 and no FAIL round. Source: review-ledger.log." />
      <${Kpi} label="FAIL rounds" value=${nd(L.failRounds)} sub=${L.tasks ? `${plural(L.failTasks, 'task')} with a FAIL` : ''} info="FAIL rounds from the ledger (fail_rounds= or FAIL words; FAIL x2 = 2)." />
      ${codex ? html`<${Kpi} label="Median run" value=${nd(R?.medianSecs, secs)} sub=${R && R.p90Secs !== null ? `p90 ${secs(R.p90Secs)} · ${plural(R.timed, 'finished run')}` : ''} info="Run time = end - start of finished runs in the range. Source: runs/*." />`
        : html`<${Kpi} label="Exact ids" value=${p.ids} sub=${p.breakdown[0]?.id || ND} info="Distinct Claude model ids of this family with tokens in the range." />`}
    <//>
    <${Grid}>
      <${Card} span=${true} title="How many tokens per day?" src="Stacked per day: fresh input, cache read, cache write, output (Codex input already contains cache read; only the fresh part is shown). Source: daily_tokens.">
        ${p.tokens.total ? html`<${Chart} days=${p.days} series=${tokSeries} stacked=${true} height=${180} />` : html`<${NoData} title="No tokens in this range" field="daily_tokens" />`}<//>
      ${!codex || p.breakdown.length > 1 ? html`<${Card} title="Which exact model ids?" src="Tokens per stored model id inside this key. Source: daily_tokens.">
        ${p.breakdown.length ? html`<table><thead><tr><th>Model id</th><th title="fresh input · cache read · cache write · output">Tokens</th><th class="n">Share</th><th class="n opt">Output</th><th class="n">Msgs</th></tr></thead>
          <tbody>${p.breakdown.map(b => html`<tr><${Name} text=${b.id} /><td style="width:30%"><${SegBar} parts=${composition(b)} of=${b.total / Math.max(1, p.breakdown[0].total) * 100} height=${8} /></td>
            <td class="n">${share(b.total, p.tokens.total)}</td><td class="n opt">${fmt(b.output)}</td><td class="n">${fmt(b.messages)}</td></tr>`)}</tbody></table>`
          : html`<p class="empty">${ND}</p>`}<//>` : ''}
      ${codex ? html`<${Card} title="How do its runs end?" src="Exit 0 / failed (exit 72, 73 or other) from daily_runs; lost = no exit code 2 days after the start, running = started under 2 days ago with no exit code (runs/*). Effort = the effort of its runs.">
        ${R ? html`<div class="stack"><${SegBar} parts=${outcome} height=${12} />
          <div class="mini-stats"><span><b>${R.exit0}</b> exit 0</span><span><b>${R.failed}</b> failed</span><span><b>${R.lost}</b> lost</span>${R.running ? html`<span><b>${R.running}</b> running</span>` : ''}</div>
          <div class="mini-stats"><span>median <b>${nd(R.medianSecs, secs)}</b></span><span>p90 <b>${nd(R.p90Secs, secs)}</b></span><span>effort <b>${p.effort || ND}</b></span><span>resumes <b>${R.resumes}</b></span></div></div>`
          : html`<${NoData} title="No runs in this range" field="runs / daily_runs" />`}<//>` : ''}
      <${Card} title="Does it pass review first time?" src=${`Ledger tasks whose worker maps to this key${codex ? '' : ' (ledger opus -> Opus, fable -> Fable, claude-subagent -> Other)'}. Findings per layer = the count in each ledger cell. Task type = ledger type=, else the keyword rules (TASK_TYPES).`}>
        ${L.tasks ? html`<div class="mini-stats"><span><b>${pct(L.cleanPct)}</b> clean first pass</span><span><b>${L.tasks}</b> tasks</span><span><b>${L.failRounds}</b> FAIL rounds</span></div>
          <div class="ranked wide">${['L1', 'L2', 'L3'].map(k => html`<div class="rk-row simple" title=${`${k}: ${L.findings[k]} findings`}><span class="rk-name">Findings ${k}</span>
            <span class="rk-bar"><${SegBar} parts=${[{ v: L.findings[k], color: C.mars, label: `${k} findings` }]} of=${L.findings[k] / fMax * 100} height=${6} /></span><span class="n">${L.findings[k]}</span></div>`)}</div>
          ${codex ? html`<div class="sub-h">Task types</div>
          <div class="ranked wide">${L.taskTypes.map(x => html`<div class="rk-row simple" title=${`${x.label}: ${plural(x.n, 'task')}`}><span class="rk-name">${x.label}</span>
            <span class="rk-bar"><${SegBar} parts=${[{ v: x.n, color, label: x.label }]} of=${x.n / tMax * 100} height=${6} /></span><span class="n">${x.n}</span></div>`)}</div>` : ''}`
          : html`<${NoData} title="No ledger task names this model in this range" field="ledger worker= / model in the note" />`}<//>
    <//>
    ${codex ? '' : html`<div class="grid cols-3">
      <${Card} top=${true} title="Which skills?" src=${`Skill calls in the sessions attributed to ${p.key}. ${d.sessionRule} Source: tool_calls.`}><${TopList} t=${p.tops.skills} color=${color} /><//>
      <${Card} top=${true} title="Which tools?" src=${`Tool calls in the sessions attributed to ${p.key}. tool_calls has no model column, so a call counts for the session's main family.`}><${TopList} t=${p.tops.tools} color=${color} /><//>
      <${Card} top=${true} title="Which sub-agents?" src=${`Agent calls by agent type in the sessions attributed to ${p.key}. Source: tool_calls.`}><${TopList} t=${p.tops.subagents} color=${color} unit="runs" /><//>
    </div>`}
    <${Grid}>
      <${Card} span=${true} title=${codex ? 'What were its last 20 runs?' : 'What were its last 20 sessions?'}
        sub=${d.ledgerLinkRows ? '' : 'ledger link: no data yet (no ledger line carries runs= so far)'}
        src=${codex ? 'Newest first. Repo = folder name only. Tokens = the whole Codex thread tree of the run; a resumed run shares its first run\'s session, so its tokens are shown there.' : `Newest first, by last message. ${d.sessionRule} Repo = folder name only. Tokens = all messages of the session in the range.`}>
        ${p.last.length ? (codex ? html`<table><thead><tr><th>Time</th><th>Repo</th><th class="n">Duration</th><th class="n">Tokens</th><th class="n">Exit</th></tr></thead>
          <tbody>${p.last.map(x => html`<tr><td class="nw">${when(x.started)}${x.resume ? html` <span class="dim" title="codex-do -Resume">resume</span>` : ''}</td><${Name} text=${x.repo || ND} />
            <td class="n">${nd(x.secs, secs)}</td><td class="n">${x.sameSession ? html`<span class="dim" title="same Codex session as an earlier run">same session</span>` : nd(x.tokens, fmt)}</td>
            <td class="n"><span class=${'pill ' + (x.state === 'ok' ? 'ok' : x.state === 'fail' ? 'fail' : 'run')} title=${x.state}>${x.exit ?? x.state}</span></td></tr>`)}</tbody></table>`
          : html`<table><thead><tr><th>Time</th><th>Repo</th><th class="n">Messages</th><th class="n">Tokens</th></tr></thead>
          <tbody>${p.last.map(x => html`<tr><td class="nw" title=${`${when(x.started)} → ${when(x.lastTs)}`}>${when(x.lastTs)}</td><${Name} text=${x.repo || ND} />
            <td class="n">${x.messages}</td><td class="n">${fmt(x.tokens)}</td></tr>`)}</tbody></table>`)
          : html`<${NoData} title=${codex ? 'No runs in this range' : 'No sessions attributed in this range'} field=${codex ? 'runs' : 'claude_messages'} />`}<//>
    <//>`;
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
  return html`<${Card} top=${true} title=${`Will ${quotaName(f)} run out before reset?`} src=${f.expired ? 'The last reset period has ended.' : `Current period of the current account · ${plural(f.n, 'snapshot')} · resets ${stamp(f.resets_at)} · linear fit over the period.`}>
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
    // One line per window (and account); names from the server's quotaName().
    const meta = {};
    for (const q of d.quotaLine) { byKey[q.key] ||= {}; byKey[q.key][q.day] = q.used_pct; meta[q.key] = q; }
    const palette = { codex: [C.codex, C.codex2, C.aurora], claude: [C.claude, C.mars, C.rose] }, used = { codex: 0, claude: 0 };
    return Object.keys(byKey).map(k => ({ label: meta[k].name, color: palette[meta[k].source]?.[used[meta[k].source]++ % 3] || C.neutral,
      data: d.days.map(x => byKey[k][x] ?? null), fmt: v => (v === null ? '–' : `${Math.round(v)}%`), fill: false, points: true }));
  }, [d]);
  const burn = useMemo(() => (d.burndown || []).map(b => ({ b, series: [{ label: 'Used %', data: b.used, color: b.source === 'codex' ? C.codex : C.claude, fmt: v => (v === null ? '–' : `${v}%`), points: true, fill: false },
    { label: 'Even pace', data: b.ideal, color: C.neutral, dash: true, fill: false, fmt: v => (v === null ? '–' : `${v}%`) }] })), [d]);
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
      ${burn.length ? html`<${Card} span=${true} title="Is each quota spending on pace?"
        src=${`${(d.quota || []).filter(q => !q.expired).map(q => `${quotaName(q)} pace ${paceText(q.pace)}`).join(' · ')}. Used % over the current window (one point per day; per hour for windows under 2 days) next to the even-pace line. ${d.paceFormula}. Current account only.`}>
        <div class="burn">${burn.map(({ b, series }) => html`<div class="burn-one"><h4>${b.name}</h4>
          <${Chart} days=${b.days} series=${series} yMax=${100} height=${150} xLabel=${b.unit === 'hour' ? hourLabel : dayLabel} /></div>`)}</div><//>` : ''}
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
  // Quota pace per side (replaces the retired 30 / 70 split): pace history per day + the 1.0 reference.
  const paceColor = { claude7: C.claude, claude5: C.mars, codex: C.codex };
  // y is capped at PACE_CAP: a higher pace is drawn at the cap; the hover tip shows the real value.
  const paceSeries = useMemo(() => [...d.pace.sides.map(s => ({ label: s.name, data: s.history.map(v => (v === null ? null : Math.min(v, PACE_CAP))),
    color: paceColor[s.key], points: true, fill: false,
    fmt: (v, i) => { const raw = s.history[i]; return raw > PACE_CAP ? `${paceText(raw)} (above the ${PACE_CAP}x cap)` : paceText(raw); } })),
    { label: 'Even pace (1.0)', data: d.days.map(() => 1), color: C.neutral, dash: true, fill: false, fmt: paceText }], [d]);
  const pressure = useMemo(() => [
    { label: 'Compactions', data: d.compactPerDay, color: C.claude, kind: 'bar' },
    { label: 'Avg tokens before compaction', data: d.compactPreTokens, color: C.mars, scale: 'y2', points: true, fill: false, fmt: v => fmt(v) }], [d]);
  const sp = d.split.claudePct;
  // Early in a window (under 5% gone) the pace is noisy: neutral, like rule a.
  const paceTone = s => paceClass(s.pace, s.early, d.pace.thresholds);
  return html`
    <${Kpis}>
      <${Kpi} label="Worker runs" value=${sum(d.runs)} sub=${`${sum(d.tasks)} tasks in the ledger`} spark=${html`<${Spark} data=${d.runs} color=${C.codex} />`} />
      <${Kpi} label="Output split" value=${sp === null ? '–' : `${Math.round(sp)} / ${Math.round(100 - sp)}`} sub="Claude / Codex share of output tokens"
        info="Claude output tokens vs Codex output tokens in the range. A description, not a target: delegation is judged by quota pace and first-pass quality." />
      <${Kpi} label="Dispatches" value=${sum(d.dispatch.map(x => x.n))} sub=${d.dispatch.map(x => `${x.kind} ${x.n}`).join(' · ') || '–'} info="codex-do dispatches by kind. Source: dispatch-trail.log." />
      <${Kpi} label="Compactions" value=${d.compactions.n || 0} sub=${`freed ${fmt(d.compactions.freed || 0)} tokens`} info="Claude context compactions in the range. Source: compactions." />
    <//>
    <${Grid}>
      <${Card} title="How much work is done per day?" src="Worker runs (daily_runs) and ledger tasks (review-ledger.log) per day."><${Chart} days=${d.days} series=${work} /><//>
      <${Card} title="How long does a worker run take?" src="Daily median of finished run time (runs/* startedUtc to exit.txt)."><${Chart} days=${d.days} series=${dur} /><//>
      <${Card} title="Quota pace per side"
        src=${`Is each side spending its quota faster than time? ${d.pace.formula}. Lines: pace at the last quota snapshot of each day; dashed = 1.0. Claude 7-day, Claude 5-hour and the Codex window of the current account. Source: quota_snapshots.`}>
        <div class="stack"><table class="pace-table"><thead><tr><th>Window</th><th class="n">Used</th><th class="n">Window gone</th><th class="n">Pace</th><th class="n opt">Resets</th></tr></thead>
        <tbody>${d.pace.sides.map(s => html`<tr><td class="name"><i class="sw" style=${`background:${paceColor[s.key]}`}></i>${s.name}</td>
          ${s.missing ? html`<td class="n muted" colspan="4">no snapshot</td>` : html`<td class="n">${pct(s.usedPct)}</td><td class="n">${s.expired ? 'reset' : pct(s.elapsedPct)}</td>
          <td class="n"><span class=${'pill ' + paceTone(s)} title=${s.early ? 'under 5% of the window gone: early' : s.unknownWindow ? 'window length unknown' : ''}>${paceText(s.pace)}</span></td><td class="n opt muted">${stamp(s.resetsAt)}</td>`}</tr>`)}</tbody></table>
        <${Chart} days=${d.days} series=${paceSeries} height=${150} yMax=${PACE_CAP} /></div><//>
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
      <${Card} title="Which hooks are slowest?" src="Highest daily p95 in the range, with errors / timeouts. Limit = the timeout set in settings.json for that event (hook_limits; Claude Code default 600 s, 30 s for UserPromptSubmit). Source: daily_hooks.">
        <table><thead><tr><th>Script</th><th>Event</th><th class="n">Runs</th><th class="n">Err/TO</th><th class="n">p95</th><th class="n opt">Limit</th></tr></thead>
        <tbody>${slow.map(s => html`<tr><${Name} text=${s.script} /><td class="muted">${s.event}</td><td class="n">${s.runs}</td>
          <td class="n">${s.errors || s.timeouts ? `${s.errors}/${s.timeouts}` : '·'}</td>
          <td class="n"><span class=${'pill ' + (s.p95_ms > 5000 ? 'fail' : s.p95_ms > 1500 ? 'run' : 'ok')}>${ms(s.p95_ms)}</span></td>
          <td class="n opt muted">${s.timeoutMs ? ms(s.timeoutMs) : '–'}</td></tr>`)}</tbody></table><//>
      <${Card} title="Which Codex threads broke the 50M rule?" src="Codex threads over 50M cumulative tokens with activity in the range, newest first. Rule g on Overview fires for one active in the last 48 h. Source: codex_sessions.">
        ${(d.bigThreads || []).length ? html`<table><thead><tr><th>Thread</th><th>Model</th><th>Source</th><th class="n">Tokens</th><th class="n opt">Last active</th></tr></thead>
        <tbody>${d.bigThreads.map(x => html`<tr><td class="mono">${x.id}</td><td class="muted">${x.model}</td><td class="muted">${x.source}</td>
          <td class="n"><span class="pill fail">${fmt(x.tokens)}</span></td><td class="n opt muted">${x.lastTs ? stamp(x.lastTs) : '–'}</td></tr>`)}</tbody></table>`
          : html`<p class="empty">No Codex thread over 50M tokens in this range</p>`}<//>
    <//>`;
}

/* ---------- System (v5 data, v4 cards) ---------- */
const bytes = b => (b === null || b === undefined ? '–' : b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`);
const msText = v => (v === null || v === undefined ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
// Break opportunities after path separators, so a folder label wraps at '/' and never inside a word.
const pathBreaks = text => String(text).split(/(?<=[\\/])/).flatMap((part, i) => (i ? [html`<wbr />`, part] : [part]));
// H8a: the last 20 sampler toasts (server tail of alerts.jsonl). Status: done. Confidence: real render.
function AlertsCard({ list }) {
  const rows = list || [];
  return html`<${Card} title="Which alerts did the sampler raise?" src="Desktop toasts from the minute sampler (rules a, b, c, f, g, h), newest first, last 20. One toast per episode; a rule toasts again only after it was clear for 15 min. LINE_HUB_NOTIFY=0 turns delivery off (the log still runs). Source: system/alerts.jsonl.">
    ${rows.length ? html`<table><thead><tr><th>When</th><th>Rule</th><th>Alert</th></tr></thead><tbody>${rows.map(x => html`<tr>
      <td class="nw">${stamp(x.ts)}</td><td class="nw muted">${x.rule} · ${RULE_NAME[x.rule] || '?'}</td><td class="wrap">${x.text}</td></tr>`)}</tbody></table>`
      : html`<p class="empty">No alert raised yet</p>`}<//>`;
}
function System({ d, now }) {
  const s = d.sample;
  const ramSeries = useMemo(() => [{ label: 'Lowest free RAM', data: d.daily.ramMin, color: C.bad, fmt: pct, points: true, fill: false },
    { label: 'Average free RAM', data: d.daily.ramAvg, color: C.aurora, fmt: pct, points: true, fill: false },
    { label: 'Highest commit', data: d.daily.commitMax, color: C.mars, dash: true, fmt: pct, points: true, fill: false }], [d]);
  const hooks = d.hooks.filter(x => x.p95_ms !== null).map(x => ({ x, share: x.timeoutMs ? x.p95_ms / x.timeoutMs * 100 : null }))
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  const over = hooks.filter(h => h.x.over);
  const hookCard = html`<${Card} title="Which hooks are close to their timeout?"
    src=${`${over.length ? `${plural(over.length, 'hook')} over half its timeout (rule e): ${over.map(h => h.x.script).join(', ')}.` : 'No hook is over half its timeout.'} Bar = the hook's p95 in the range as a share of its OWN timeout (full width = the timeout; the dashed mark = half). p95 = nearest rank over every run (hook_events + archived bins). Timeouts from settings.json (hook_limits).`}>
    ${hooks.length ? html`<div class="ranked wide">${hooks.map(({ x, share: sh }) => html`<div class="rk-row simple" title=${`${x.script}\np95 ${msText(x.p95_ms)} · max ${msText(x.max_ms)} · ${x.runs} runs${x.timeoutMs ? `\ntimeout ${msText(x.timeoutMs)}` : '\ntimeout unknown'}${x.errors ? `\n${x.errors} errors` : ''}${x.timeouts ? `\n${x.timeouts} timed out` : ''}`}>
      <span class="rk-name"><span class="ell">${x.script}</span></span>
      <span class="rk-bar half-mark"><${SegBar} parts=${[{ v: sh ?? 0, color: x.over ? C.bad : sh !== null && sh > 25 ? C.warn : C.aurora, label: x.script }]} of=${Math.min(100, sh ?? 0)} height=${8} /></span>
      <span class="n">${sh === null ? `p95 ${msText(x.p95_ms)}` : `${sh < 1 ? sh.toFixed(1) : Math.round(sh)}%`}</span></div>`)}</div>`
      : html`<p class="empty">No hook runs in this range</p>`}<//>`;
  if (!s) return html`<${Grid}>
    <${Card} title="No system sample yet" src="The sampler writes RAM, drives, folders and processes; the collector reads them.">
      <${NoData} title="The sampler has not written a sample, or the collector has not read one yet" field="system_samples (install: hub/scripts/install-sampler.ps1)" /><//>
    ${hookCard}<${AlertsCard} list=${d.alerts} /><//>`;
  const driveC = s.drives.find(x => x.d === 'C:');
  const tone3 = (v, bad, warn) => (v === null || v === undefined ? '' : v < bad ? 'bad' : v < warn ? 'warn' : 'good');
  const topMb = Math.max(1, ...s.top.map(p => p.mb));
  const grow = [...d.folders].filter(f => f.growthPerDay > 0).sort((a, b) => b.growthPerDay - a.growthPerDay)[0];
  return html`
    <${Kpis}>
      <${Kpi} label="Free RAM" value=${pct(s.ram.freePct)} sub=${`${(s.ram.freeMb / 1024).toFixed(1)} of ${(s.ram.totalMb / 1024).toFixed(1)} GB · ${d.stale ? 'STALE sample' : `sampled ${when(s.ts)}`}`}
        tone=${d.stale ? 'warn' : tone3(s.ram.freePct, 10, 20)} info="Free physical memory in the newest sample. Shown only: low free RAM never fires a rule (rule b is commit charge, Line 2026-11-14). Source: system_samples."
        spark=${d.ram24.length > 1 ? html`<${Spark} data=${d.ram24} color=${C.aurora} />` : null} />
      <${Kpi} label="Commit" value=${pct(s.ram.commitPct)} sub=${s.ram.commitLimitMb ? `${(s.ram.commitUsedMb / 1024).toFixed(1)} of ${(s.ram.commitLimitMb / 1024).toFixed(1)} GB limit` : 'no commit limit'}
        tone=${s.ram.commitPct === null ? '' : s.ram.commitPct > 90 ? 'bad' : s.ram.commitPct > 75 ? 'warn' : 'good'} info="Committed memory as % of the commit limit (RAM + page file). Rule b fires over 75%." />
      <${Kpi} label="Free disk C:" value=${driveC ? pct(driveC.freePct) : '–'} sub=${driveC ? `${bytes(driveC.free)} of ${bytes(driveC.total)}` : 'no sample of C:'}
        tone=${driveC ? tone3(driveC.freePct, 10, 20) : ''} info="Free space on C: in the newest sample. Rule c fires under 10%." />
      <${Kpi} label="Low-memory events" value=${d.kills.length} sub=${d.kills.length ? `last ${stamp(d.kills[0].ts)}` : 'none in 30 days'} tone=${d.kills.length ? 'bad' : 'good'}
        info="Windows resource-exhaustion events (System 2004) in the last 30 days. Source: memory_kills." />
    <//>
    <${Grid}>
      <${Card} title="Is RAM running out?" src="Per day: lowest and average free RAM % and highest commit % (system_daily). Rule b: commit charge over 90% of the limit (free RAM is shown, never a rule).">
        <${Chart} days=${d.daily.days} series=${ramSeries} yMax=${100} height=${170} /><//>
      <${Card} title="Is any drive filling up?" src="Used share of each drive in the newest sample. Rule c fires when a drive has under 10% free.">
        <div class="drives">${s.drives.map(x => html`<div class="drive" title=${`${x.d} ${bytes(x.free)} free of ${bytes(x.total)}`}>
          <div class="drive-head"><b>${x.d}</b><span class="muted">${bytes(x.free)} free of ${bytes(x.total)}</span><span class="n">${pct(x.usedPct)} used</span></div>
          <div class=${'meter ' + (x.freePct === null || x.freePct === undefined ? '' : x.freePct < 10 ? 'bad' : x.freePct < 20 ? 'warn' : '')}><i style=${`width:${Math.min(100, x.usedPct)}%`}></i></div></div>`)}</div><//>
      <${Card} span=${true} title="Which folders grow?"
        tools=${grow ? html`<span class="muted small">fastest: ${grow.label} +${bytes(grow.growthPerDay)} / day</span>` : ''}
        src="Folder sizes measured once a day by the sampler, incl. the WSL and Docker .vhdx disks. Growth = change per day over up to 7 days. Days to full = free space on that drive / growth. Rule c fires under 14 days, or a .vhdx over 80 GiB.">
        ${d.folders.length ? html`<table><thead><tr><th>Folder</th><th class="n">Drive</th><th class="n">Size</th><th class="n">Growth / day</th><th class="n">Days to full</th><th class="n opt">Measured</th></tr></thead>
        <tbody>${d.folders.map(f => html`<tr><td class="name path" title=${f.label}>${pathBreaks(f.label)}</td><td class="n muted">${f.drive || '–'}</td><td class="n">${bytes(f.bytes)}</td>
          <td class="n">${f.growthPerDay === null ? html`<span class="muted" title="needs two days of sizes">–</span>` : `${f.growthPerDay < 0 ? '-' : '+'}${bytes(Math.abs(f.growthPerDay))}`}</td>
          <td class="n" title=${f.daysToFull !== null && f.daysToFull >= 365 ? `over a year (${f.daysToFull} d)` : ''}>${f.daysToFull === null || f.daysToFull >= 365 ? '–' : html`<span class=${'pill ' + (f.daysToFull < 14 ? 'fail' : f.daysToFull < 60 ? 'run' : 'ok')}>${f.daysToFull} d</span>`}</td><td class="n opt muted">${dayLabel(f.day)}</td></tr>`)}</tbody></table>`
          : html`<${NoData} title="No folder sizes yet" field="system_daily folder_bytes (measured once a day)" />`}<//>
      <${Card} title="Which processes hold the most memory?" src="Working set per process name in the newest sample, summed over its processes. Source: system_samples.">
        ${s.top.length ? html`<div class="ranked wide">${s.top.map(p => html`<div class="rk-row simple" title=${`${p.name}: ${p.mb} MB${p.count > 1 ? ` in ${p.count} processes` : ''}`}>
          <span class="rk-name"><span class="ell">${p.name}</span>${p.count > 1 ? html`<span class="muted"> x${p.count}</span>` : ''}</span>
          <span class="rk-bar"><${SegBar} parts=${[{ v: p.mb, color: C.mars, label: p.name }]} of=${p.mb / topMb * 100} /></span><span class="n">${p.mb.toLocaleString('en-GB')} MB</span></div>`)}</div>`
          : html`<p class="empty">No process list in the last sample</p>`}<//>
      <${Card} title="Did Windows run out of memory?" src="Resource-exhaustion events (System log, event 2004) in the last 30 days, with the top processes Windows named.">
        ${d.kills.length ? html`<table><thead><tr><th>When</th><th>Top processes</th></tr></thead><tbody>${d.kills.map(k => html`<tr><td class="nw">${stamp(k.ts)}</td><${Name} text=${k.top.join(', ') || '–'} /></tr>`)}</tbody></table>`
          : html`<p class="empty">No low-memory event in the last 30 days</p>`}<//>
      ${hookCard}
      <${AlertsCard} list=${d.alerts} />
    <//>
    <p class="foot">Collector last ran ${when(d.collector.lastRun)} · schema v${d.collector.schema ?? '–'}${d.stale ? ` · newest system sample ${stamp(s.ts)} is over 10 min old` : ''}.</p>`;
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
                ${r.same_session_as ? html`<td class="n opt muted" colspan="2" title=${`Same Codex session as run ${r.same_session_as} (a resume): its tokens are shown on that run, once.`}>same session</td>`
                  : html`<td class="n opt">${fmt(r.codex_output)}</td><td class="n opt" title=${r.codex_root ? `Root thread ${r.codex_root}${r.codex_threads > 1 ? ` + ${r.codex_threads - 1} sub-agent thread(s)` : ''}: the whole tree is counted.` : 'no Codex rollout found for this run'}>${fmt(r.codex_total)}</td>`}</tr>`; })}</tbody></table>
            ${s.output ? html`<p class="foot">Claude output in this session (all repos): ${fmt(s.output)}</p>` : ''}</div>` : ''}`;
      })}
    </section>`) : html`<section class="card"><p class="empty">No runs in this range</p></section>`}`;
}

const root = document.getElementById('app');
root.textContent = ''; // drop the static boot text before Preact takes over
// Before the first render, so charts read the right colours. A theme= hash param wins and is not remembered.
const forced = hashParams().get('theme');
applyTheme(forced === 'light' || forced === 'dark' ? forced : storedTheme(), !forced);
installTips(); // styled hover tips for every chart and `title` (charts.js)
render(html`<${App} />`, root);
