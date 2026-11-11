/* Intent: small inline-SVG / CSS visuals for Line Hub - segmented and share bars,
 * sparklines, week-over-week deltas, the Trace run scatter, the quota forecast plot and (v4)
 * the Claude vs Codex radar.
 * Status: UI v4. Colours are getters over the theme-driven COLORS, so a theme switch needs no reload. Pure Preact + htm, no dependencies; style attributes are built from numbers
 * only (CSP-safe). Charts that need a pixel size measure their box with a ResizeObserver.
 * Next: none. Blockers: none. Confidence: headless Edge screenshots at 1920/1366/1100/700. */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { COLORS as C, fmt } from './charts.js';
const html = htm.bind(h);

// Token composition colours, shared by the split panel and the by-model bars.
export const KIND = [
  { key: 'input', label: 'Fresh input', get color() { return C.mars; } },
  { key: 'cache_read', label: 'Cache read', get color() { return C.neutral; } },
  { key: 'cache_write', label: 'Cache write', get color() { return C.rose; } },
  { key: 'output', label: 'Output', get color() { return C.aurora; } }
];
export const SOURCE = { get claude() { return C.claude; }, get codex() { return C.codex; }, get other() { return C.neutral; } };
// Models of one source share its hue family first, then other swatches.
const palette = () => ({ claude: [C.claude, C.claude2, C.rose, C.mars, C.neutral], codex: [C.codex, C.codex2, C.aurora, C.mars, C.rose] });
// One colour per model, stable within a payload: ranked order, per-source palette.
export function modelColors(models) {
  const used = { claude: 0, codex: 0 }, out = new Map(), pal = palette();
  for (const m of models) {
    if (out.has(`${m.source}|${m.model}`)) continue;
    const list = pal[m.source];
    out.set(`${m.source}|${m.model}`, list ? list[used[m.source]++ % list.length] : C.neutral);
  }
  return out;
}

const pct1 = v => `${(Math.round(v * 10) / 10).toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
export const share = (v, all) => (all ? pct1(v / all * 100) : '–');

export function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => setW(ref.current ? ref.current.clientWidth : 0));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Horizontal segmented bar. `of` scales the whole bar (100 = full width).
export function SegBar({ parts, of = 100, height = 10 }) {
  const all = parts.reduce((a, p) => a + p.v, 0);
  return html`<div class="segbar" style=${`width:${Math.max(0, Math.min(100, of))}%;height:${height}px`}>${all ? parts.filter(p => p.v > 0).map(p =>
    html`<i style=${`flex:${p.v / all} 0 0;background:${p.color}`} title=${`${p.label}: ${fmt(p.v)} (${share(p.v, all)})`}></i>`) : ''}</div>`;
}

// 100% bar for two (or more) named shares with labels underneath.
export function ShareBar({ parts }) {
  const all = parts.reduce((a, p) => a + p.v, 0);
  return html`<div class="sharebar">
    <${SegBar} parts=${parts} height=${14} />
    <div class="share-labels">${parts.map(p => html`<span><i class="sw" style=${`background:${p.color}`}></i>${p.label}
      <b>${share(p.v, all)}</b><span class="dim">${fmt(p.v)}</span></span>`)}</div></div>`;
}

export function Spark({ data, color = C.codex, width = 64, height = 18 }) {
  if (!data?.length) return html`<span></span>`;
  const max = Math.max(1, ...data), n = data.length;
  const pts = data.map((v, i) => `${n === 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1},${height - 2 - (v / max) * (height - 4)}`).join(' ');
  if (n === 1) return html`<svg class="spark" width=${width} height=${height} aria-hidden="true"><circle cx=${width / 2} cy=${height - 2 - (data[0] / max) * (height - 4)} r="2" fill=${color} /></svg>`;
  return html`<svg class="spark" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} aria-hidden="true">
    <polyline points=${pts} fill="none" stroke=${color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" /></svg>`;
}

// Week over week: last 7 local days vs the 7 before.
export function Delta({ last, prev }) {
  const tip = `last 7 days ${last} vs previous 7 days ${prev}`;
  if (!last && !prev) return html`<span class="delta dim" title=${tip}>·</span>`;
  if (!prev) return html`<span class="delta up" title=${tip}>new</span>`;
  const d = Math.round((last - prev) / prev * 100);
  return html`<span class=${'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'dim')} title=${tip}>${d > 0 ? '+' : ''}${d}%</span>`;
}

const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ddmm = ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
export const stamp = ts => new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
// Time ticks: local midnights for multi-day spans, every few hours for short ones.
function timeTicks(a, b, width) {
  const span = b - a, want = Math.max(2, Math.floor(width / 80));
  if (span <= 2 * 86400) {
    const step = [1, 2, 3, 6, 12].find(hh => span / (hh * 3600) <= want) || 12;
    const t = new Date(a * 1000); t.setMinutes(0, 0, 0); t.setHours(Math.ceil(t.getHours() / step) * step);
    const out = [];
    for (let x = t.getTime() / 1000; x <= b; x += step * 3600) if (x >= a) out.push({ x, label: hhmm(x) });
    return out;
  }
  const days = Math.ceil(span / 86400), every = Math.max(1, Math.ceil(days / want));
  const t = new Date(a * 1000); t.setHours(24, 0, 0, 0);
  const out = [];
  for (let i = 0; t.getTime() / 1000 <= b; i++, t.setDate(t.getDate() + 1)) if (i % every === 0) out.push({ x: t.getTime() / 1000, label: ddmm(t.getTime() / 1000) });
  return out;
}

const LOST_SECS = 2 * 86400;
export const runStatus = (r, now) => (r.ended === null || r.ended === undefined
  ? (now - r.started > LOST_SECS ? 'lost' : 'running') : r.exit_code === 0 ? 'ok' : 'failed');
const statusColor = st => ({ ok: C.codex, failed: C.bad, running: C.warn, lost: C.muted })[st];

// Jaeger-style scatter: x = start time, y = duration (log scale), colour = outcome.
export function RunScatter({ runs, start, now, height = 190, onPick }) {
  const [ref, w] = useWidth();
  const L = 44, R = 10, T = 10, B = 22, ih = height - T - B, iw = Math.max(10, w - L - R);
  const durMin = r => (r.ended ? Math.max(0.1, (r.ended - r.started) / 60) : Math.max(0.1, (now - r.started) / 60));
  const pts = runs.map(r => ({ r, st: runStatus(r, now) })).map(p => ({ ...p, d: p.st === 'lost' ? null : durMin(p.r) }));
  const maxD = Math.max(60, ...pts.filter(p => p.d).map(p => p.d)), minD = 0.25;
  const ly = v => T + ih - (Math.log(Math.max(minD, v)) - Math.log(minD)) / (Math.log(maxD) - Math.log(minD)) * ih;
  const x0 = Math.min(start, ...runs.map(r => r.started)), x1 = now;
  const lx = t => L + (t - x0) / Math.max(1, x1 - x0) * iw;
  const yt = [[1, '1m'], [5, '5m'], [15, '15m'], [60, '1h'], [240, '4h'], [720, '12h'], [1440, '24h']].filter(([v]) => v <= maxD);
  const xt = w ? timeTicks(x0, x1, iw) : [];
  const fmtD = m => (m < 1.5 ? `${Math.round(m * 60)}s` : m < 90 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`);
  return html`<div class="scatter" ref=${ref} style=${`height:${height}px`}>${w ? html`<svg width=${w} height=${height} role="img" aria-label="Codex runs by start time and duration">
    ${yt.map(([v, l]) => html`<g><line x1=${L} x2=${w - R} y1=${ly(v)} y2=${ly(v)} class="gl" /><text x=${L - 6} y=${ly(v) + 3.5} class="ax" text-anchor="end">${l}</text></g>`)}
    ${xt.filter(t => lx(t.x) > L + 14 && lx(t.x) < w - R - 16).map(t => html`<text x=${lx(t.x)} y=${height - 6} class="ax" text-anchor="middle">${t.label}</text>`)}
    <line x1=${L} x2=${L} y1=${T} y2=${T + ih} class="gl" />
    ${pts.map(p => {
      const cx = lx(p.r.started), cy = p.d === null ? T + 2 : ly(p.d);
      const tip = `${p.r.run_id}\n${p.r.model || '–'} · ${p.r.project || '–'}\nstarted ${stamp(p.r.started)}\nduration ${p.d === null ? 'unknown (lost)' : fmtD(p.d) + (p.st === 'running' ? ' so far' : '')}\n${p.st === 'ok' ? 'exit 0' : p.st === 'failed' ? `exit ${p.r.exit_code}` : p.st}`;
      return html`<circle cx=${cx} cy=${cy} r=${p.st === 'ok' ? 3.6 : 4.4} fill=${p.st === 'lost' ? 'none' : statusColor(p.st)} stroke=${statusColor(p.st)}
        stroke-width=${p.st === 'lost' ? 1.5 : 0} fill-opacity=${p.st === 'ok' ? 0.75 : 0.95} class="pt" onClick=${() => onPick && onPick(p.r)}><title>${tip}</title></circle>`;
    })}
  </svg>` : ''}</div>`;
}

// Quota forecast: actual snapshots, a faint line of the fit over the observed part, and a
// dashed projection that starts at the anchor (now, actual used %) and runs to resets_at.
// Lines are clipped at the plot top (yMax) by geometry, so their angle never bends.
export function ForecastPlot({ f, now, height = 150 }) {
  const [ref, w] = useWidth();
  if (!f.points.length) return html`<div ref=${ref}></div>`;
  const L = 34, R = 10, T = 8, B = 20, ih = height - T - B, iw = Math.max(10, w - L - R);
  const x0 = f.points[0].ts, x1 = Math.max(f.resets_at, x0 + 60);
  const top = Math.max(100, ...f.points.map(p => p.used_pct));
  const yMax = f.enough && f.projectedRaw > 100 ? 110 : Math.min(200, Math.ceil(top / 10) * 10);
  const lx = t => L + (t - x0) / (x1 - x0) * iw, ly = v => T + ih - Math.max(0, Math.min(yMax, v)) / yMax * ih;
  // End of a straight segment from (ts, pct) with `perSec` slope, stopped where it leaves the plot.
  const clipEnd = (ts, pct, perSec, endTs) => {
    const v = pct + perSec * (endTs - ts);
    if (v <= yMax || perSec <= 0) return { ts: endTs, pct: v };
    return { ts: ts + (yMax - pct) / perSec, pct: yMax };
  };
  const perSec = f.enough ? f.slopePerHour / 3600 : 0;
  const proj = f.enough ? clipEnd(f.anchor.ts, f.anchor.pct, perSec, x1) : null;
  const last = f.points.at(-1);
  const xt = w ? timeTicks(x0, x1, iw) : [];
  const line = f.points.map(p => `${lx(p.ts)},${ly(p.used_pct)}`).join(' ');
  return html`<div class="forecast" ref=${ref} style=${`height:${height}px`}>${w ? html`<svg width=${w} height=${height} role="img" aria-label="Quota used over the current period with a linear projection">
    ${[0, 50, 100].filter(v => v <= yMax).map(v => html`<g><line x1=${L} x2=${w - R} y1=${ly(v)} y2=${ly(v)} class=${v === 100 ? 'gl cap' : 'gl'} />
      <text x=${L - 6} y=${ly(v) + 3.5} class="ax" text-anchor="end">${v}%</text></g>`)}
    ${xt.filter(t => lx(t.x) > L + 14 && lx(t.x) < w - R - 16).map(t => html`<text x=${lx(t.x)} y=${height - 5} class="ax" text-anchor="middle">${t.label}</text>`)}
    ${f.enough ? html`<line x1=${lx(f.fitStart.ts)} y1=${ly(f.fitStart.pct)} x2=${lx(f.fitEnd.ts)} y2=${ly(f.fitEnd.pct)} class="fit" />` : ''}
    ${now >= x0 && now <= x1 ? html`<line x1=${lx(now)} x2=${lx(now)} y1=${T} y2=${T + ih} class="now" />` : ''}
    <line x1=${lx(x1)} x2=${lx(x1)} y1=${T} y2=${T + ih} class="reset" />
    <polyline points=${line} class="actual" />
    ${f.synthetic ? html`<line x1=${lx(last.ts)} y1=${ly(last.used_pct)} x2=${lx(f.anchor.ts)} y2=${ly(f.anchor.pct)} class="flat" />` : ''}
    ${proj ? html`<line x1=${lx(f.anchor.ts)} y1=${ly(f.anchor.pct)} x2=${lx(proj.ts)} y2=${ly(proj.pct)} class="proj" />` : ''}
    ${f.points.map(p => html`<circle cx=${lx(p.ts)} cy=${ly(p.used_pct)} r="2.4" class="apt"><title>${`${stamp(p.ts)} · ${Math.round(p.used_pct)}%`}</title></circle>`)}
    ${f.synthetic && f.idleHours >= 0.5 ? html`<circle cx=${lx(f.anchor.ts)} cy=${ly(f.anchor.pct)} r="3.2" class="anchor"><title>${`now: still ${Math.round(f.anchor.pct)}% (no new snapshot for ${f.idleHours} h)`}</title></circle>` : ''}
    ${f.hit100At ? html`<circle cx=${lx(f.hit100At)} cy=${ly(100)} r="4" class="hit"><title>${`projected 100% at ${stamp(f.hit100At)}`}</title></circle>` : ''}
  </svg>` : ''}</div>`;
}

// One line of forecast text, shared by the Usage cards and the Overview quota cards.
export function forecastText(f, compact = false) {
  if (!f) return { text: 'no forecast', tone: '' };
  if (f.expired) return { text: compact ? 'period ended' : 'period ended; waiting for a new snapshot', tone: '' };
  if (f.atLimit) return { text: 'at 100% now', tone: 'bad', full: 'the quota is already used up (100%) until the reset' };
  if (!f.enough) return { text: compact ? `too few points (n = ${f.n})` : `not enough points to project (n = ${f.n})`, tone: '' };
  if (f.hit100At) return { text: compact ? `100% by ${new Date(f.hit100At * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
    : `projected to hit 100% at ${stamp(f.hit100At)}`, tone: 'bad', full: `projected to hit 100% at ${stamp(f.hit100At)}` };
  if (f.overflow) return { text: 'projected 100%+ at reset', tone: 'bad' };
  const p = Math.max(0, Math.round(f.projectedAtReset));
  return { text: `projected ${p}% at reset`, tone: p >= 85 ? 'warn' : '' };
}
// Anomaly badge for a KPI card; `a` comes from the server's anomaly() rule.
export function Flag({ a, label }) {
  if (!a?.flag) return '';
  const rule = a.rule.startsWith('MAD = 0')
    ? `the last ${a.n} days were flat (median ${a.median}, MAD 0), so the rule is today > 2 x median and > 0`
    : `rule: today > median + 2 x MAD over the last ${a.n} days (median ${a.median}, MAD ${a.mad}, threshold ${a.threshold})`;
  return html`<span class="flag" title=${`${label} today = ${fmt(a.today)} is unusually high; ${rule}.`}>unusual</span>`;
}

/* Radar: one polygon per side over shared 0-100 axes.
 * axes: [{ label, tip, sub?, values: { <side>: { score: 0-100 | null, low?: bool, tip } } }]
 * series: [{ key, label, color, dash? }]. A null score is a gap: no vertex, no line through it,
 * the fill only covers sectors between two real neighbours. A low-data point is hollow. */
export function Radar({ axes, series, width = 420, height = 300, R = 100, lowLegend = false }) {
  const n = axes.length, cx = width / 2, cy = height / 2 + 2;
  const ang = i => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i, v) => [cx + Math.cos(ang(i)) * R * v / 100, cy + Math.sin(ang(i)) * R * v / 100];
  const xy = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const ring = v => axes.map((_, i) => xy(at(i, v))).join(' ');
  const shapes = series.map(s => {
    const vals = axes.map(a => a.values[s.key] || { score: null });
    let line = '', fill = '';
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = vals[i], b = vals[j];
      if (a.score === null || a.score === undefined || b.score === null || b.score === undefined) continue;
      const p = at(i, a.score), q = at(j, b.score);
      line += `M${xy(p)}L${xy(q)}`;
      fill += `M${cx},${cy}L${xy(p)}L${xy(q)}Z`;
    }
    return html`<g>
      ${fill ? html`<path d=${fill} fill=${s.color} fill-opacity="0.16" stroke="none" />` : ''}
      ${line ? html`<path d=${line} class=${'poly ' + s.key} fill="none" stroke=${s.color} />` : ''}
      ${vals.map((v, i) => (v.score === null || v.score === undefined ? '' : html`<circle cx=${at(i, v.score)[0]} cy=${at(i, v.score)[1]} r="4" class="pt"
        fill=${v.low ? C.panel : s.color} stroke=${s.color}><title>${v.tip || `${s.label}: ${v.score}`}</title></circle>`))}
    </g>`;
  });
  const labels = axes.map((a, i) => {
    const [x, y] = at(i, 100), dx = x - cx, dy = y - cy;
    const anchor = Math.abs(dx) < 6 ? 'middle' : dx > 0 ? 'start' : 'end';
    const lx = x + (anchor === 'start' ? 8 : anchor === 'end' ? -8 : 0), ly = y + (dy < -6 ? (a.sub ? -24 : -10) : dy > 6 ? 16 : -4);
    return html`<g><text x=${lx} y=${ly} text-anchor=${anchor} class=${'axis-label' + (a.lowAll ? ' low' : '')}>${a.label}<title>${a.tip}</title></text>
      ${a.sub ? html`<text x=${lx} y=${ly + 13} text-anchor=${anchor} class="tick">${a.sub}</text>` : ''}</g>`;
  });
  return html`<div class="radar-wrap"><svg class="radar" viewBox=${`0 0 ${width} ${height}`} width=${width} height=${height} role="img"
      aria-label=${`Radar: ${series.map(s => s.label).join(' vs ')} on ${axes.map(a => a.label).join(', ')}`}>
    ${[25, 50, 75, 100].map(v => html`<polygon class="ring" points=${ring(v)} />`)}
    ${axes.map((_, i) => { const [x, y] = at(i, 100); return html`<line class="spoke" x1=${cx} y1=${cy} x2=${x} y2=${y} />`; })}
    ${[50, 100].map(v => html`<text class="tick" x=${cx + 4} y=${cy - R * v / 100 + 11}>${v}</text>`)}
    ${shapes}${labels}
  </svg>
  <div class="radar-legend">${series.map(s => html`<span class="side-chip"><i class=${'sw line' + (s.dash ? ' dash' : '')} style=${`border-color:${s.color}`}></i>${s.label}</span>`)}
    ${lowLegend ? html`<span class="side-chip"><i class="sw hollow"></i>${'low data (n < 3)'}</span>` : ''}<span class="side-chip">gap in a polygon = n/a</span></div></div>`;
}
