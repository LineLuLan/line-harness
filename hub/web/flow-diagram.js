/* Intent: the Flow page - one-screen pipeline diagram of Line's agent-coding harness, A to Z, drawn in the
 * "execution pipeline" style Line picked (2026-11-15, NVIDIA draw.io reference): icon tiles for artifacts and tools,
 * hexagons for agents, titled rails for cross-cutting systems, orthogonal wires. Hub theme tokens only, no live numbers.
 * Rows: (A) Line -> Opus -> task packet -> codex-do -> worker models; (B) worker steps -> collect -> L1 -> L2 -> L3 -> Critical;
 * rails: quota + routing, safety; bottom: evidence -> verified gate -> ship -> Line Hub -> tune rules.
 * Status: done. Next: none. Blockers: none. Confidence: screenshots at 1440x900 and 1920x1080. */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const C = { line: 'var(--ink)', claude: 'var(--kafka)', claude2: 'var(--kafka-2)', codex: 'var(--nebula)', good: 'var(--aurora)',
  art: 'var(--mars)', rule: 'var(--warn)', bad: 'var(--bad)', wire: 'var(--neutral)' };
const MARKS = Object.entries(C);

// 24x24 stroke glyphs (own drawings, lucide-like).
const ICONS = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  chat: 'M4 5h16v11H10l-5 4v-4H4z',
  plan: 'M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 3h6v3H9zM8.5 11l1.5 1.5 3-3M8.5 16.5h7',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h5M9.5 16h5',
  term: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M12 15h5',
  net: 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 4v5.5M12 14.5V20M5 8l5 2.8M19 8l-5 2.8M5 16l5-2.8M19 16l-5-2.8',
  merge: 'M6 4v6a6 6 0 0 0 6 6h6M15 13l3 3-3 3M6 20v-4',
  list: 'M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  shield: 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6zM9 12l2 2 4-4',
  db: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4-5M3 17h3M18 17h3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  route: 'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 16h4a4 4 0 0 0 4-4V10',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  stop: 'M8 3h8l5 5v8l-5 5H8l-5-5V8zM9 12h6',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  key: 'M8 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 11l9 9M17 17l2-2',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  redo: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  check: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12l3 3 5-6',
  ship: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8zM12 11v7M9 14l3-3 3 3',
  chart: 'M4 20V11M10 20V5M16 20v-7M3 20h18',
};
const Glyph = ({ name, x, y, s, c, w = 2 }) => html`<path d=${ICONS[name]} transform=${`translate(${x - s / 2},${y - s / 2}) scale(${s / 24})`}
  fill="none" stroke=${c} stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;

// Square tile = artifact or tool (solid colour, dark glyph). Hexagon = agent (outlined, coloured glyph).
// Every node glows softly in its own colour (CSS drop-shadow on the group); a white sheen gives tiles depth.
const glow = c => `filter: drop-shadow(0 0 7px color-mix(in srgb, ${c} 55%, transparent))`;
const Tile = ({ x, y, s = 48, c, icon }) => html`<g class="f-node" style=${glow(c)}>
  <rect x=${x - s / 2} y=${y - s / 2 + 3} width=${s} height=${s} rx="9" fill=${c} opacity=".45" />
  <rect x=${x - s / 2} y=${y - s / 2} width=${s} height=${s} rx="9" fill=${c} />
  <rect x=${x - s / 2} y=${y - s / 2} width=${s} height=${s} rx="9" fill="url(#f-sheen)" />
  <${Glyph} name=${icon} x=${x} y=${y} s=${s * 0.56} c="var(--on-accent)" w=${2.3} /></g>`;
const hexPts = (x, y, r) => [0, 1, 2, 3, 4, 5].map(i => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const Hex = ({ x, y, r = 28, c, icon, dashed }) => html`<g class="f-node" style=${dashed ? null : glow(c)}>
  <polygon points=${hexPts(x, y + r * 0.2, r)} fill=${c} opacity=${dashed ? '.2' : '.55'} />
  <polygon points=${hexPts(x, y, r)} fill="var(--paper)" stroke=${c} stroke-width="2.4" stroke-dasharray=${dashed ? '5 4' : null} />
  <polygon points=${hexPts(x, y, r - 5)} fill=${c} opacity=".14" />
  <${Glyph} name=${icon} x=${x} y=${y} s=${r * 0.95} c=${c} w=${2.2} /></g>`;
// Step badge for the main story (1 Line ... 9 Hub).
const Step = ({ x, y, n, c = 'var(--ink)' }) => html`<g><circle cx=${x} cy=${y} r="10" fill=${c} stroke="var(--paper)" stroke-width="2.5" />
  <text x=${x} y=${y + 4} class="f-step">${n}</text></g>`;
// Glowing packets that travel the main path (skipped when the viewer prefers reduced motion).
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const Comets = ({ tracks }) => (still ? null : html`<g class="f-comets">${tracks.flatMap(([d, c, dur], i) => [0, 0.5].map(off => html`
  <circle r="3.6" fill=${c} style=${`filter: drop-shadow(0 0 5px ${c})`}>
    <animateMotion dur=${`${dur}s`} begin=${`${(off * dur + i * 0.4).toFixed(2)}s`} repeatCount="indefinite" path=${d} rotate="auto" /></circle>`))}</g>`);
// Caption: bold name + muted detail; `side` puts it right of the icon instead of below.
const Cap = ({ x, y, t, s, side, anchor }) => html`<g>
  <text x=${x} y=${y} class="f-title" text-anchor=${anchor || (side ? 'start' : 'middle')}>${t}</text>
  ${s ? html`<text x=${x} y=${y + 15} class="f-sub" text-anchor=${anchor || (side ? 'start' : 'middle')}>${s}</text>` : null}</g>`;
const Panel = ({ x, y, w, h: ht, title, c = 'var(--line)' }) => html`<g>
  <rect x=${x} y=${y} width=${w} height=${ht} rx="10" fill="url(#f-panel)" stroke=${c} stroke-opacity=".7" />
  <rect x=${x} y=${y + 10} width="3" height=${ht - 20} rx="1.5" fill=${c} />
  <text x=${x + 16} y=${y + 21} class="f-rail">${title}</text></g>`;
const Wire = ({ d, c = C.wire, dashed, main }) => html`<path d=${d} fill="none" stroke=${c} stroke-width=${main ? 2.2 : 1.4}
  stroke-opacity=${main ? 1 : 0.8}
  stroke-dasharray=${dashed ? '5 4' : null} stroke-linejoin="round"
  marker-end=${`url(#f-arrow-${MARKS.find(([, v]) => v === c)?.[0] || 'wire'})`} />`;
const Note = ({ x, y, t, c = C.wire, anchor = 'middle', rotate }) => html`<text x=${x} y=${y} class="f-label" fill=${c} text-anchor=${anchor}
  transform=${rotate ? `rotate(${rotate} ${x} ${y})` : null}>${t}</text>`;

// One rail: titled panel with six icon + caption steps joined left to right.
function Rail({ y, title, steps }) {
  const xs = steps.map((_, i) => 132 + i * 202);
  return html`<g><${Panel} x=${100} y=${y} w=${1240} h=${86} title=${title} c=${steps[1][1]} />
    ${steps.map(([kind, c, icon, t, s], i) => html`<g>
      ${kind === 'hex' ? html`<${Hex} x=${xs[i]} y=${y + 52} r=${21} c=${c} icon=${icon} />` : html`<${Tile} x=${xs[i]} y=${y + 52} s=${38} c=${c} icon=${icon} />`}
      <${Cap} x=${xs[i] + 30} y=${y + 49} t=${t} s=${s} side=${true} />
      ${i < steps.length - 1 ? html`<${Wire} d=${`M${xs[i] + 150},${y + 52} H${xs[i + 1] - 26}`} />` : null}</g>`)}</g>`;
}

export function FlowDiagram() {
  const fan = [[266, 'Read scope', 'only the packet files'], [312, 'Smallest change', 'match the code style'], [358, 'Run VALIDATE', 'the packet command'], [404, 'Report', 'diff + result, or STOP']];
  return html`<div class="flow-wrap">
    <svg class="flow-svg" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Line's agent-coding harness: Line asks, Opus plans and writes a task packet, codex-do dispatches a Codex model in a sandbox, three review layers check the result, verified work ships and Line Hub measures it.">
      <defs>${MARKS.map(([k, v]) => html`<marker id=${`f-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill=${v} /></marker>`)}
        <linearGradient id="f-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38" /><stop offset=".55" stop-color="#fff" stop-opacity="0" /></linearGradient>
        <linearGradient id="f-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--panel)" /><stop offset="1" stop-color="var(--surface)" /></linearGradient>
        <pattern id="f-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--line)" opacity=".55" /></pattern>
        <radialGradient id="f-vig" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="var(--paper)" stop-opacity="0" /><stop offset="1" stop-color="var(--paper)" stop-opacity=".85" /></radialGradient>
        <linearGradient id="f-title" x1="0" x2="1"><stop offset="0" stop-color="var(--kafka-2)" /><stop offset=".55" stop-color="var(--nebula-2)" /><stop offset="1" stop-color="var(--aurora)" /></linearGradient>
      </defs>
      <rect x="-200" y="-200" width="1840" height="1200" fill="url(#f-dots)" /><rect x="-200" y="-200" width="1840" height="1200" fill="url(#f-vig)" />

      <text x="28" y="40" class="f-h1" fill="url(#f-title)" style="fill: url(#f-title)">Line Harness · Execution Pipeline</text>
      <text x="28" y="61" class="f-h2">From one request to a sandboxed build, three review layers and a verified ship.</text>
      <g class="f-legend">${[[C.line, 'Line', 'sq'], [C.claude, 'Claude', 'hex'], [C.codex, 'Codex', 'hex'], [C.good, 'gates', 'hex'], [C.art, 'artifact · tool', 'sq']].map(([c, t], i) => html`
        <rect x=${900 + i * 80} y="27" width="11" height="11" rx="2" fill=${c} /><text x=${916 + i * 80} y="37" class="f-sub">${t}</text>`)}
        <line x1="1316" y1="32" x2="1340" y2="32" stroke="var(--bad)" stroke-width="1.4" stroke-dasharray="5 4" /><text x="1346" y="37" class="f-sub">loop / fallback</text></g>

      <!-- row A: request -> plan -> packet -> dispatch -> models -->
      <circle cx="74" cy="125" r="30" fill=${C.line} style=${glow(C.line)} /><${Glyph} name="user" x=${74} y=${125} s=${30} c="var(--on-accent)" w=${2.2} />
      <${Cap} x=${74} y=${174} t="Line" s="intent · final say" />
      <${Wire} d="M106,125 H218" c=${C.line} main />
      <circle cx="160" cy="125" r="13" fill="var(--panel)" stroke="var(--line)" /><${Glyph} name="chat" x=${160} y=${125} s=${15} c=${C.line} />
      <${Note} x=${160} y=${154} t="request" />
      <${Tile} x=${256} y=${125} s=${68} c=${C.claude} icon="plan" />
      <${Cap} x=${256} y=${178} t="Opus 5.5 · supervisor" s="plan · tier · route · verify" />
      <${Wire} d="M290,125 H398" c=${C.claude} main />
      <${Note} x=${344} y=${117} t="writes" />
      <${Panel} x=${400} y=${78} w=${360} h=${108} title="Task packet · one per job" />
      <${Tile} x=${442} y=${142} s=${46} c=${C.art} icon="file" />
      <g>${['GOAL', 'CRITERIA', 'FILES', 'CONSTRAINTS', 'VALIDATE', 'STOP RULES'].map((t, i) => html`
        <rect x=${480 + (i % 3) * 92} y=${i < 3 ? 108 : 146} width="84" height="26" rx="5" fill="var(--surface)" stroke="var(--line)" />
        <text x=${522 + (i % 3) * 92} y=${i < 3 ? 125 : 163} class="f-chip" text-anchor="middle">${t}</text>`)}</g>
      <${Wire} d="M760,125 H840" c=${C.art} main />
      <${Tile} x=${870} y=${125} s=${56} c=${C.codex} icon="term" />
      <${Cap} x=${870} y=${174} t="codex-do" s="lint · sandbox · log" />
      <${Wire} d="M898,125 H930 V84 H1320 V95" c=${C.codex} main />
      ${[990, 1100, 1210].map(x => html`<${Wire} d=${`M${x},84 V95`} c=${C.codex} main />`)}
      <${Note} x=${1155} y=${77} t="dispatch by tier + quota" c=${C.codex} />
      ${[[990, C.codex, 'GPT-6.2 Sol', 'Standard-A'], [1100, C.codex, 'GPT-6.2 Astra', 'Std-B · Important+'], [1210, C.codex, 'Sol then Astra', 'exploration'], [1320, C.claude, 'Opus subagent', 'when Codex runs hot']].map(([x, c, t, s]) => html`
        <${Hex} x=${x} y=${125} r=${28} c=${c} icon="net" dashed=${c === C.claude} /><${Cap} x=${x} y=${174} t=${t} s=${s} />`)}
      <${Wire} d="M1348,125 H1422 V214 H58 V335 H90" c=${C.codex} main />

      <!-- row B: the worker run and the review gate -->
      <${Hex} x=${120} y=${335} r=${30} c=${C.codex} icon="net" />
      <${Cap} x=${120} y=${384} t="Worker" s="one bounded packet" />
      <${Wire} d="M150,335 H226" c=${C.codex} main />
      <path d="M226,266 V404" stroke=${C.codex} stroke-width="1.6" fill="none" />
      ${fan.map(([y, t, s]) => html`<g><${Wire} d=${`M226,${y} H246`} c=${C.codex} main /><${Hex} x=${266} y=${y} r=${17} c=${C.codex} icon="code" />
        <${Cap} x=${290} y=${y - 2} t=${t} s=${s} side=${true} /><path d=${`M440,${y} H452`} stroke=${C.codex} stroke-width="1.6" fill="none" /></g>`)}
      <path d="M452,266 V404" stroke=${C.codex} stroke-width="1.6" fill="none" />
      <${Wire} d="M452,335 H490" c=${C.codex} main />
      <${Wire} d="M340,248 V145 H292" c=${C.rule} dashed /><${Note} x=${346} y=${238} t="STOP" c=${C.rule} anchor="start" />
      <${Tile} x=${520} y=${335} s=${54} c=${C.art} icon="merge" />
      <${Cap} x=${520} y=${384} t="Collect" s="diff + VALIDATE output" />
      <rect x="644" y="282" width="452" height="130" rx="12" fill="color-mix(in srgb, var(--aurora) 6%, transparent)" stroke=${C.good} stroke-opacity=".55" stroke-dasharray="6 5" />
      <rect x="738" y="272" width="260" height="20" rx="10" fill="var(--paper)" stroke=${C.good} />
      <text x="868" y="286" class="f-badge" text-anchor="middle">REVIEW GATE · NO SELF-GRADING</text>
      <${Wire} d="M547,335 H660" c=${C.art} main />
      <${Hex} x=${690} y=${335} r=${30} c=${C.good} icon="list" />
      <${Cap} x=${690} y=${384} t="L1 · gates" s="tests · lint · secrets" />
      <${Wire} d="M720,335 H838" c=${C.good} main />
      <${Hex} x=${868} y=${335} r=${30} c=${C.claude2} icon="eye" />
      <${Cap} x=${868} y=${384} t="L2 · fresh model" s="Astra or Fable · per criterion" />
      <${Wire} d="M898,335 H1016" c=${C.claude2} main />
      <${Hex} x=${1046} y=${335} r=${30} c=${C.claude} icon="shield" />
      <${Cap} x=${1046} y=${384} t="L3 · Opus verifies" s="runs the change for real" />
      <${Wire} d="M1076,335 H1196" c=${C.claude} main />
      <${Hex} x=${1226} y=${335} r=${26} c=${C.line} icon="key" dashed=${true} />
      <${Cap} x=${1226} y=${380} t="Critical only" s="Line approves in writing" />
      <${Wire} d="M1252,335 H1406 V660 H930 V684" c=${C.good} main />
      <${Wire} d="M868,305 V240 H120 V303" c=${C.bad} dashed /><path d="M1046,305 V240 H868" stroke=${C.bad} stroke-width="1.4" stroke-dasharray="5 4" fill="none" />
      <${Note} x=${640} y=${234} t="FAIL → worker fixes, new reviewer · max 2, then redesign" c=${C.bad} />

      <!-- rails -->
      <${Rail} y=${428} title="Quota & Routing Rail" steps=${[
        ['tile', C.art, 'db', 'Ontology', 'one source of rules'], ['tile', C.rule, 'gauge', 'Quota pace', 'used % / time elapsed %'],
        ['tile', C.rule, 'grid', 'Levels', 'Codex C0–C3 · Claude K'], ['tile', C.rule, 'route', 'Route matrix', 'work × level → model'],
        ['hex', C.codex, 'swap', 'Fallback', 'Sol · Opus subagent'], ['hex', C.codex, 'swap', 'Grok switch', 'Codex ≥ 95% → Grok auto']]} />
      <${Rail} y=${526} title="Safety Rail" steps=${[
        ['tile', C.art, 'list', 'Packet lint', 'headings · exit 74'], ['hex', C.claude2, 'eye', 'Fable pre-read', 'Important + Critical'],
        ['hex', C.good, 'lock', 'Sandbox', 'repo root as -Dir'], ['hex', C.good, 'grid', 'Dir lock', 'one worker per repo'],
        ['hex', C.good, 'pulse', 'Heartbeat', 'zombie after 5 min'], ['hex', C.good, 'redo', 'Resume', '≤ 3, then fresh']]} />

      <!-- bottom: evidence -> verified gate -> ship -> measure -->
      <${Wire} d="M44,125 H34 V712 H96" c=${C.line} dashed />
      <${Note} x=${24} y=${560} t="Line reads evidence" c=${C.line} rotate=${-90} />
      <${Panel} x=${100} y=${630} w=${610} h=${160} title="Evidence" />
      ${[['file', 'diff', 'git diff'], ['code', 'VALIDATE', 're-run by Opus'], ['check', 'Review log', 'P0–P3 · per criterion'], ['db', 'Ledger line', 'runs= linked']].map(([icon, t, s], i) => html`
        <rect x=${114 + i * 148} y="664" width="136" height="114" rx="6" fill="var(--surface)" stroke="var(--line)" />
        <${Tile} x=${182 + i * 148} y=${706} s=${44} c=${C.art} icon=${icon} /><${Cap} x=${182 + i * 148} y=${750} t=${t} s=${s} />`)}
      <${Wire} d="M710,712 H902" c=${C.good} main />
      <${Tile} x=${930} y=${712} s=${54} c=${C.good} icon="check" />
      <${Cap} x=${930} y=${757} t="Verified" s="only this ships" />
      <rect x="740" y="640" width="160" height="58" rx="6" fill="var(--panel)" stroke="var(--line)" />
      ${['L1 gates green', 'L2 PASS (Important+)', 'L3 ran it for real'].map((t, i) => html`<text x="752" y=${658 + i * 15} class="f-sub">✓ ${t}</text>`)}
      <${Wire} d="M957,712 H1068" c=${C.good} main />
      <${Tile} x=${1096} y=${712} s=${54} c=${C.good} icon="ship" />
      <${Cap} x=${1096} y=${757} t="Ship" s="install live + backup" />
      <${Wire} d="M1123,712 H1238" c=${C.good} main />
      <${Tile} x=${1266} y=${712} s=${54} c=${C.claude2} icon="chart" />
      <${Cap} x=${1266} y=${757} t="Line Hub" s="measures · alerts Line" />
      <${Wire} d="M1293,712 H1376 V471 H1344" c=${C.rule} dashed />
      <${Note} x=${1394} y=${600} t="measure → tune rules" c=${C.rule} rotate=${-90} />
      <text x="1096" y="790" class="f-tag" text-anchor="middle">push only on Line's order (push guard)</text>

      <!-- story steps + travelling packets -->
      ${[[48, 99, 1, C.line], [226, 95, 2, C.claude], [400, 78, 3, C.art], [846, 101, 4, C.codex], [94, 309, 5, C.codex], [644, 282, 6, C.good], [907, 689, 7, C.good], [1073, 689, 8, C.good], [1243, 689, 9, C.claude2]]
        .map(([x, y, n, c]) => html`<${Step} x=${x} y=${y} n=${n} c=${c} />`)}
      <${Comets} tracks=${[['M106,125 H218', C.line, 1.6], ['M290,125 H398', C.claude, 1.6], ['M760,125 H840', C.art, 1.2],
        ['M898,125 H930 V84 H1100 V97', C.codex, 2.4], ['M1348,125 H1422 V214 H58 V335 H90', C.codex, 5.5], ['M452,335 H660', C.art, 1.8],
        ['M720,335 H1196', C.good, 3.2], ['M1252,335 H1406 V660 H930 V684', C.good, 4.2], ['M710,712 H902', C.good, 2], ['M957,712 H1238', C.good, 2.4],
        ['M1293,712 H1376 V471 H1344', C.rule, 3.4]]} />
    </svg>
  </div>`;
}
