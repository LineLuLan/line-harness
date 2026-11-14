/* Intent: parse one review-ledger.log line into numbers and names, shared by collector and server.
 * Status: v7. Classic line = date|tier|layer2|L1|L2|L3|note (7 fields; the note may contain "|").
 *   Optional trailing key=value fields win over every guess:
 *   worker=<model>|type=<ui|collector|review|research|docs|config|other>|fail_rounds=<int>|findings=L1:<n>,L2:<n>,L3:<n>
 *   |runs=<runId>[,<runId>...] (v8, ledger-add.ps1 -RunIds; stored in ledger_runs)
 *   v10: field 3 alone proves layer2: starts with "yes" ("layer2 yes" too), PASS/FAIL or L?2b? yes.
 *   Preserve layer2_raw for audit; model names are not evidence. Findings = leading integer of a cell
 *   ("0 + text" = 0, "3 P2 ..." = 3); FAIL rounds over the three cells and the note; the model is the
 *   "(worker <model>)" / "worker model: x" phrase, else the first model name, lower-cased and aliased.
 *   A six-field line (note missing) is parsed with an empty note and a warning; a non-date line is a warning.
 * Next: none. Blockers: none. Confidence: tests/v7.test.js (old + new lines, real-shape samples). */
'use strict';

const TASK_TYPE_VALUES = ['ui', 'collector', 'review', 'research', 'docs', 'config', 'other'];
const KEYS = new Set(['worker', 'type', 'fail_rounds', 'findings', 'runs']);
const MODEL_WORD = String.raw`gpt-[\w.-]+|claude-[\w.-]+|opus|fable|sonnet|haiku|sol|astra|luna`;
const MODEL_RE = new RegExp(`(?<![\\w.-])(?:${MODEL_WORD})(?![\\w])`, 'i');
const MODEL_ONLY = new RegExp(`^(?:${MODEL_WORD})$`, 'i');
// "(worker gpt-6-astra high)", "(worker model: sol)", "worker opus subagents"; the word after
// "worker" must itself be a model name ("worker STOPped" is not a model).
const WORKER_RE = /\bworker(?:\s+model)?\s*[:=]?\s+([\w.-]+)/gi;

// Lower-case + aliases, so "Sol", "sol" and "gpt-6-sol" are one model.
function aliasModel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const m = value.trim().toLowerCase().replace(/[.,;:)]+$/, '');
  if (m === 'opus' || m.startsWith('claude-opus')) return 'opus';
  if (m === 'fable' || m.startsWith('claude-fable')) return 'fable';
  if (m === 'sol' || m === 'gpt-6-sol') return 'gpt-6-sol';
  if (m === 'astra' || m === 'gpt-6-astra') return 'gpt-6-astra';
  if (m === 'luna' || m === 'gpt-6-luna') return 'gpt-6-luna';
  return m.slice(0, 64);
}
function modelOf(text) {
  for (const m of String(text || '').matchAll(WORKER_RE)) if (MODEL_ONLY.test(m[1])) return aliasModel(m[1]);
  return aliasModel(MODEL_RE.exec(String(text || ''))?.[0] ?? null);
}
// FAIL rounds: every FAIL word counts once, "FAIL x2" counts 2. Negated forms count 0:
// "no FAIL", "not FAIL", "0 FAIL", "FAIL 0" and rule names such as "3-FAIL rule".
function failRounds(raw) {
  let n = 0;
  // FAIL must stand alone: "fail-open", "fail-closed", "FAILED" and "3-FAIL" are not rounds.
  for (const m of String(raw || '').matchAll(/(?<!\b(?:no|not|0)\s+)(?<![\w-])FAIL(?![\w-])(?!\s+0\b)(?:\s*x\s*(\d+))?/gi)) n += m[1] ? Number(m[1]) : 1;
  return n;
}
const MAX_FINDINGS = 999;
// Leading integer of a layer cell ("0 + text" = 0, "3 P2 ..." = 3, "L2 2 P1" = 2); null when none.
function leadingCount(raw) {
  const m = /^\s*(?:L[123]\s*:?\s*)?([+-]?\d+)(?![\d.:/-])/.exec(String(raw || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
// v8 runs=<runId>[,<runId>...] (ledger-add.ps1 -RunIds): codex-do run folder names; anything else is dropped.
function runIds(raw) {
  return [...new Set(String(raw || '').split(',').map(x => x.trim()).filter(x => /^[A-Za-z0-9._-]{1,64}$/.test(x)))];
}
// v8 STOP flag, from the FULL note (the stored note is cut at 200 characters): 1 when the note names a
// worker STOP ("STOP", "STOPped", "worker STOP: ..."); a negated form ("no STOP", "0 STOP", "without STOP")
// does not count. Upper-case only: "stop the server" is not a STOP.
function stopFlag(note) {
  const text = String(note || '');
  for (const m of text.matchAll(/(?<![\w-])STOP/g)) {
    if (!/(?:^|[^\w])(?:no|0|without)\s+$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) return 1;
  }
  return 0;
}
// Returns null for a line that is not a ledger row at all (blank, comment); otherwise
// { row, warning } where warning is null or a short code.
/* Intent: centralize field-3 evidence and retain its audit text. Status: v10.
 * Next: host replay. Blockers: none. Confidence: tests/v10.test.js evidence vectors. */
function parseLedger(text) {
  const line = String(text || '').replace(/^﻿/, '');
  if (!line.trim()) return null;
  let parts = line.split('|');
  const warnings = [];
  // Trailing key=value fields (new format), taken from the end so a "|" inside the note survives.
  // Keys and values are trimmed and lower-cased; an unknown key is a warning and the scan goes on,
  // so known keys after it still count.
  const fields = {};
  while (parts.length > 7) {
    const m = /^\s*([A-Za-z_]+)\s*=\s*(.*?)\s*$/.exec(parts.at(-1));
    if (!m) break;
    const key = m[1].toLowerCase();
    if (KEYS.has(key)) { if (!(key in fields)) fields[key] = key === 'runs' ? m[2] : m[2].toLowerCase(); } else if (!warnings.includes('unknown-field')) warnings.push('unknown-field');
    parts = parts.slice(0, -1);
  }
  const date = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(parts[0]);
  if (!date) return { row: null, warning: line.trimStart().startsWith('#') ? 'comment' : 'bad-date' };
  const [y, mo, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || d < 1 || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return { row: null, warning: 'bad-date' };
  const day = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
  if (parts.length < 6) return { row: null, warning: 'too-few-fields' };
  if (parts.length === 6) { warnings.push('six-fields'); parts = [...parts, '']; }
  const [, tier, layer2, l1, l2, l3] = parts;
  const note = parts.slice(6).join('|');
  const counts = [l1, l2, l3].map(leadingCount);
  if (fields.findings) {
    for (const m of fields.findings.matchAll(/l([123])\s*:\s*(\d+)/gi)) counts[Number(m[1]) - 1] = Number(m[2]);
  }
  if (counts.some(c => c !== null && c > MAX_FINDINGS)) {
    warnings.push('findings-cap');
    for (let i = 0; i < 3; i++) if (counts[i] !== null) counts[i] = Math.min(counts[i], MAX_FINDINGS);
  }
  const all = `${l1} | ${l2} | ${l3} | ${note}`;
  const fr = /^\d+$/.test(fields.fail_rounds || '') ? Number(fields.fail_rounds) : failRounds(all);
  const type = TASK_TYPE_VALUES.includes(fields.type || '') ? fields.type : null;
  // worker= may carry an effort or version ("gpt-6-astra high", "Opus 5.5"): read it like a note phrase.
  const model = fields.worker ? modelOf(`worker ${fields.worker}`) ?? aliasModel(fields.worker) : modelOf(note || all);
  const warning = warnings.length ? warnings.join(',') : null;
  return { warning, row: { day, tier: tier.trim() || null, layer2: (/^\s*(?:layer2\s+)?yes/i.test(layer2) || /(?<!GATES-)\b(PASS|FAIL)\b/.test(layer2) || /\bL?2b?\s+yes\b/i.test(layer2)) ? 1 : 0, layer2_raw: layer2,
    l1_raw: l1, l2_raw: l2, l3_raw: l3, l1_count: counts[0], l2_count: counts[1], l3_count: counts[2],
    note: note.slice(0, 200), model, task_type: type, fail_rounds: fr, runs: runIds(fields.runs), stop: stopFlag(note) } };
}
module.exports = { parseLedger, runIds, stopFlag, aliasModel, modelOf, failRounds, leadingCount, TASK_TYPE_VALUES };
