/* Intent: one small uPlot wrapper for Preact, themed from CSS tokens, day-indexed x axis.
 * Status: UI v4. COLORS is read from the CSS custom properties of the active theme
 * (refreshColors() after a theme switch; the page then remounts so every chart redraws).
 * v3: x values are day indexes (no time-zone math in the browser);
 * labels come from the server's local day list (week starts work the same way).
 * yMax (fixed 0..yMax, used by 100% stacked charts) and kind 'points' (markers, no line).
 * Hover tips: uPlot plugin + global `title` handler share one fixed tip at the pointer (installTips).
 * Next: none. Confidence: browser check. */
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import uPlot from 'uplot';
const html = htm.bind(h);

// Semantic colours. Claude = kafka and Codex = nebula on every page; the rest are portfolio swatches.
const TOKENS = { claude: '--kafka', claude2: '--kafka-2', codex: '--nebula', codex2: '--nebula-2', aurora: '--aurora', mars: '--mars', rose: '--rose',
  neutral: '--neutral', good: '--good', warn: '--warn', bad: '--bad', muted: '--muted', ink: '--ink', line: '--line', panel: '--panel', track: '--track' };
export const COLORS = { claude: '#D08BE0', claude2: '#E3B0EE', codex: '#8FA8FF', codex2: '#B5C6FF', aurora: '#6FD3A8', mars: '#FF9A6B', rose: '#F28BB4',
  neutral: '#8F8AA3', good: '#6FD3A8', warn: '#F2C46B', bad: '#FF8A9A', muted: '#B4AFC4', ink: '#EEEBF5', line: '#3A3550', panel: '#1C1929', track: '#262236' };
export function refreshColors() {
  const css = getComputedStyle(document.documentElement);
  for (const [k, v] of Object.entries(TOKENS)) { const val = css.getPropertyValue(v).trim(); if (/^#[0-9a-f]{6}$/i.test(val)) COLORS[k] = val; }
}

export function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return (n / 1e3).toFixed(digits) + 'k';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}
// Axis labels: one decimal only where 0 digits would repeat a label (1.2M and 1.4M, not 1M 1M).
const axisFmt = v => { const s = fmt(v, 1); return s.replace(/\.0(?=[kMB]?$)/, ''); };
export const dayLabel = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

// 1-2-5 tick steps: integer counts never get fractional, repeated labels.
const INCRS = [];
for (let e = 0; e <= 12; e++) for (const m of [1, 2, 5]) INCRS.push(m * 10 ** e);
const AXIS_FONT = '11px "JetBrains Mono Variable", ui-monospace, monospace';
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
const bars = uPlot.paths.bars({ size: [0.62, 42], gap: 1 });
// Two unstacked bar series sit side by side: one ends at the tick, one starts at it.
const pair = [uPlot.paths.bars({ size: [0.36, 22], align: -1, gap: 1 }), uPlot.paths.bars({ size: [0.36, 22], align: 1, gap: 1 })];

/* Hover tips: ONE fixed element on <body>, shared by the uPlot plugin and the global
 * title handler, so every chart shows its numbers next to the pointer with no delay.
 * `owner` says who shows it now ('title' or a uPlot instance); each side hides only its own. */
let tipEl = null, owner = null;
const tip = () => tipEl || (tipEl = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'hover-tip', role: 'tooltip' }));
function placeTip(x, y) {
  const el = tip(), pad = 8, off = 14, w = el.offsetWidth, hh = el.offsetHeight;
  let l = x + off, t = y + off;
  if (l + w > innerWidth - pad) l = x - off - w;
  if (t + hh > innerHeight - pad) t = y - off - hh;
  el.style.left = Math.max(pad, l) + 'px';
  el.style.top = Math.max(pad, t) + 'px';
}
function showTip(who, fill, x, y) { const el = tip(); owner = who; el.replaceChildren(); fill(el); el.style.display = 'block'; placeTip(x, y); }
export function hideTip(who) { if (tipEl && (who === undefined || owner === who)) { tipEl.style.display = 'none'; owner = null; } }

// Global handler: any element with a `title` attribute (or an SVG <title> child) gets the styled
// tip instead of the native delayed one. The text moves to data-tip while hovered and comes back
// on leave, unless Preact set a new title meanwhile.
let hovered = null;
function tipSource(start) {
  for (let el = start; el && el !== document.body && el.nodeType === 1; el = el.parentNode) {
    if (el === hovered || el.getAttribute('title')) return el;
    const t = [...el.children].find(c => c.tagName.toLowerCase() === 'title');
    if (t && t.textContent) return el;
  }
  return null;
}
function stash(el) {
  if (el.getAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.dataset.tipAttr = '1'; el.removeAttribute('title'); return; }
  const t = [...el.children].find(c => c.tagName.toLowerCase() === 'title'), n = t?.firstChild;
  if (n?.nodeType === 3) { el.dataset.tip = n.data; n.data = ''; }
}
function unstash(el) {
  const text = el.dataset.tip;
  if (text === undefined) return;
  if (el.dataset.tipAttr) { if (!el.hasAttribute('title')) el.setAttribute('title', text); }
  else { const n = [...el.children].find(c => c.tagName.toLowerCase() === 'title')?.firstChild; if (n?.nodeType === 3 && !n.data) n.data = text; }
  delete el.dataset.tip; delete el.dataset.tipAttr;
}
const lines = text => el => text.split('\n').forEach((s, i) => { const d = el.appendChild(document.createElement('div')); d.textContent = s; if (i === 0 && text.includes('\n')) d.className = 'tip-head'; });
export function installTips() {
  if (installTips.done) return;
  installTips.done = true;
  const leave = () => { if (hovered) { unstash(hovered); hovered = null; } hideTip('title'); };
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = tipSource(e.target);
    if (el === hovered) return;
    leave();
    if (!el) return;
    stash(el);
    hovered = el;
    if (el.dataset.tip) showTip('title', lines(el.dataset.tip), e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', e => { if (hovered && owner === 'title') placeTip(e.clientX, e.clientY); });
  document.addEventListener('pointerout', e => { if (hovered && !(e.relatedTarget && hovered.contains(e.relatedTarget))) leave(); });
  addEventListener('scroll', () => hideTip(), true);
  addEventListener('blur', leave);
}

// uPlot plugin: day label, then one row per visible series (swatch, label, the series' own raw value).
const tipPlugin = (days, rows) => {
  let over = null;
  const off = u => () => hideTip(u);
  return { hooks: {
    init: u => { over = u.over; over.addEventListener('mouseleave', off(u)); },
    setCursor: u => {
      const { left, top, idx } = u.cursor;
      if (idx === null || idx === undefined || left < 0) return hideTip(u);
      const r = over.getBoundingClientRect();
      showTip(u, el => {
        const head = el.appendChild(document.createElement('div'));
        head.className = 'tip-head'; head.textContent = dayLabel(days[idx]);
        rows.forEach((s, i) => {
          if (!u.series[i + 1]?.show) return;
          const row = el.appendChild(document.createElement('div')), sw = document.createElement('i'), lab = document.createElement('span'), val = document.createElement('b');
          row.className = 'tip-row'; sw.style.background = s.color; lab.textContent = s.label; val.textContent = s.fmt ? s.fmt(s.data[idx]) : fmt(s.data[idx]);
          row.append(sw, lab, val);
        });
      }, r.left + left, r.top + top);
    },
    destroy: u => hideTip(u)
  } };
};

/* series: [{ label, data, color, kind: 'line' | 'bar' | 'points', scale?: 'y' | 'y2', fmt? }] */
export function Chart({ days, series, height = 230, y2 = null, stacked = false, yMax = null }) {
  const box = useRef(null), plot = useRef(null);
  useEffect(() => {
    if (!box.current) return;
    const x = days.map((_, i) => i);
    let values = series.map(s => s.data.map(v => (v === null || v === undefined ? null : v)));
    if (stacked) {
      // Cumulative bars, drawn back to front so each segment shows its own share.
      const acc = x.map(() => 0);
      values = values.map(col => col.map((v, i) => (acc[i] += v || 0)));
    }
    const order = stacked ? [...series.keys()].reverse() : [...series.keys()];
    const barKeys = series.map((s, i) => (s.kind === 'bar' ? i : -1)).filter(i => i >= 0);
    const paired = !stacked && barKeys.length === 2;
    const opts = {
      width: box.current.clientWidth || 600,
      height,
      padding: [8, 8, 0, 0],
      cursor: { points: { size: 7 }, drag: { x: false, y: false } },
      legend: { live: false }, // swatch + label only; the hover tip shows the values
      plugins: [tipPlugin(days, order.map(k => series[k]))],
      // Fixed x range from the day list: uPlot widens a one-point range to 0..100 otherwise (24h view).
      scales: { x: { time: false, range: () => [-0.6, days.length - 1 + 0.6] }, y: { range: (u, min, max) => [0, yMax ?? Math.max(1, max) * 1.08] },
        ...(y2 ? { y2: { range: (u, min, max) => [0, Math.max(1, max) * 1.08] } } : {}) },
      axes: [
        { stroke: COLORS.muted, grid: { show: false }, ticks: { stroke: COLORS.line }, space: 46, font: AXIS_FONT,
          values: (u, splits) => splits.map(i => (Number.isInteger(i) ? dayLabel(days[i]) : '')) },
        { stroke: COLORS.muted, grid: { stroke: COLORS.line, width: 1 }, ticks: { show: false }, size: 52, space: 40, incrs: INCRS, font: AXIS_FONT, values: (u, splits) => splits.map(axisFmt) },
        ...(y2 ? [{ scale: 'y2', side: 1, stroke: COLORS.muted, grid: { show: false }, ticks: { show: false }, size: 48, incrs: INCRS, font: AXIS_FONT,
          values: (u, splits) => splits.map(v => (y2.fmt ? y2.fmt(v) : fmt(v, 0))) }] : [])
      ],
      series: [
        { label: 'Day', value: (u, i) => (i === null ? '' : dayLabel(days[i])) },
        ...order.map(k => {
          const s = series[k];
          const base = { label: s.label, scale: s.scale || 'y', stroke: s.color, width: 2,
            value: (u, v, si, idx) => {
              if (idx === null || idx === undefined) return '–';
              const raw = s.data[idx];
              return s.fmt ? s.fmt(raw) : fmt(raw);
            } };
          if (s.kind === 'bar') return { ...base, paths: paired ? pair[barKeys.indexOf(k)] : bars, fill: alpha(s.color, stacked ? 0.85 : 0.55), width: 0, points: { show: false } };
          if (s.kind === 'points') return { ...base, paths: () => null, points: { show: true, size: 7, fill: s.color, stroke: s.color } };
          return { ...base, fill: s.fill === false ? undefined : alpha(s.color, 0.1), points: { show: Boolean(s.points) || days.length < 3, size: 6, fill: s.color }, spanGaps: true };
        })
      ]
    };
    const data = [x, ...order.map(k => values[k])];
    plot.current?.destroy();
    plot.current = new uPlot(opts, data, box.current);
    // Axis labels are canvas text: once the self-hosted fonts load, redraw so sizes use them.
    const made = plot.current;
    document.fonts?.ready.then(() => { if (plot.current === made) made.redraw(false, true); });
    // The plot fills its box: width always, height when the grid row makes the card taller
    // than `height` (the minimum). The plot is absolutely positioned, so it never feeds back.
    const fit = () => {
      const el = box.current, u = plot.current;
      if (!el || !u) return;
      const legend = u.root.querySelector('.u-legend')?.offsetHeight || 0;
      // The box is at least `height` + 36 px; a legend that wraps to more lines shrinks the plot instead of being clipped.
      const w = el.clientWidth, hgt = Math.max(120, el.clientHeight - legend - 4);
      if (w && (Math.abs(u.width - w) > 2 || Math.abs(u.height - hgt) > 2)) {
        u.setSize({ width: w, height: hgt });
        // A new width can re-wrap the legend; measure again and shrink once more if it grew.
        const after = u.root.querySelector('.u-legend')?.offsetHeight || 0;
        if (after > legend) u.setSize({ width: w, height: Math.max(120, el.clientHeight - after - 4) });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
  }, [days, series, height, stacked, yMax]);
  return html`<div class="chart" ref=${box} style=${`min-height:${height + 36}px`}></div>`;
}
