#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Intent: render the ontology's documented placeholders without changing prose.
 * Status: complete. Next: none. Blockers: none. Confidence: pre-edit golden fixtures. */
function render(template, thresholds) {
  return template.replace(/\{([^{}]+)\}/g, (_, expression) => {
    const subtract = expression.endsWith('-1'), key = subtract ? expression.slice(0, -2) : expression;
    if (!Number.isFinite(thresholds[key])) throw new Error(`invalid template key: ${key}`);
    const value = thresholds[key] - (subtract ? 1 : 0);
    return key.includes('Pace') ? (Number.isInteger(value) ? value.toFixed(1) : String(value)) : value.toFixed(0);
  });
}

/* Intent: pure generation shared by CLI and golden tests; routes take the same {key} placeholders as labels
 * (C3 names the Grok switch threshold, K5f 2026-11-18). Status: complete.
 * Next: none. Blockers: none. Confidence: byte comparison against original guide + Grok C3 golden. */
function generateBlocks(o) {
  return {
    quota: ['| Codex quota | Route |', '| --- | --- |',
      ...o.quota.codexLevels.map(x => `| ${render(x.label, o.quota.thresholds)} | ${render(x.route, o.quota.thresholds)} |`), '',
      ...o.quota.claudeRules.map(x => `- ${render(x.bullet, o.quota.thresholds)}`)].join('\n'),
    'review-tiers': ['| Tier | Layers |', '| --- | --- |', ...o.reviewTable.map(x => `| ${x[0]} | ${x[1]} |`)].join('\n')
  };
}

/* Intent: reject incomplete sensor input before any write. Status: complete.
 * Next: extend when consumers change. Blockers: none. Confidence: invalid-input fixtures. */
function validate(o) {
  const string = x => typeof x === 'string' && x.length > 0;
  const list = (x, predicate) => Array.isArray(x) && x.length > 0 && x.every(predicate);
  const need = (ok, field) => { if (!ok) throw new Error(`invalid ontology: ${field}`); };
  need(o && string(o.version), 'version');
  const q = o.quota;
  need(q && q.thresholds && ['codexPace1', 'codexPace2', 'codexUsed1', 'codexUsed2', 'codexUsed3', 'claudePace', 'claudeUsed', 'claude5Used']
    .every(k => Number.isFinite(q.thresholds[k])) && Object.values(q.thresholds).every(Number.isFinite), 'quota.thresholds');
  need(list(q.codexLevels, x => x && string(x.label) && string(x.route)), 'quota.codexLevels');
  need(list(q.claudeRules, x => x && string(x.bullet)), 'quota.claudeRules');
  const r = o.routing;
  need(r && list(r.workTypes, string) && r.workTypes.length === 7, 'routing.workTypes');
  need(r.labels && typeof r.labels === 'object' && !Array.isArray(r.labels)
    && Object.keys(r.labels).length > 0 && Object.values(r.labels).every(string), 'routing.labels');
  // Intent: every cell is a 5-item row of known label keys; K1.C3 is no longer the STOP literal (Grok at C3).
  // Status: complete (K5f 2026-11-18). Next: none. Blockers: none. Confidence: ontology-check tests.
  for (const k of ['K0', 'K1']) for (const c of ['C0', 'C1', 'C2', 'C3']) {
    const row = r.matrix?.[k]?.[c];
    need(Array.isArray(row) && row.length === 5 && row.every(id => typeof id === 'string' && Object.hasOwn(r.labels, id)), `routing.matrix.${k}.${c}`);
  }
  need(r.layer3 && ['K0', 'K1', 'critical'].every(k => string(r.layer3[k])), 'routing.layer3');
  need(string(r.stopText) && string(r.k5Banner), 'routing text');
  render(r.k5Banner, q.thresholds);
  need(o.alerts && ['quotaPace', 'quotaUsed', 'handoffUsed', 'commitPct', 'diskFreePct', 'folderDays', 'cleanDrop', 'cleanMinTasks',
    'vhdxGB', 'staleSecs', 'threadTokens', 'threadActiveHours'].every(k => Number.isFinite(o.alerts[k]))
    && Object.entries(o.alerts).every(([k, v]) => k === '$comment' || Number.isFinite(v)), 'alerts');
  need(list(o.reviewTable, x => Array.isArray(x) && x.length === 2 && x.every(string)), 'reviewTable');
  need(o.hooks && list(o.hooks.claude, x => x && string(x.event) && string(x.script) && (x.matcher === undefined || typeof x.matcher === 'string')),
    'hooks.claude');
  need(list(o.hooks.codex, string), 'hooks.codex');
  need(Array.isArray(o.hooks.retired) && o.hooks.retired.every(x => x && string(x.script)), 'hooks.retired');
  need(Array.isArray(o.rules) && o.rules.every(x => x && string(x.id) && string(x.enforcement)), 'rules');
  need(Array.isArray(o.staleValues) && o.staleValues.every(x => x && string(x.pattern) && string(x.why)), 'staleValues');
  for (const x of o.staleValues) new RegExp(x.pattern, 'i');
  generateBlocks(o); // Unknown placeholders are invalid input, not drift.
}

/* Intent: resolve explicit CLI roots without consulting unrelated state. Status: complete.
 * Next: none. Blockers: none. Confidence: CLI fixtures. */
function options(args) {
  const home = process.env.USERPROFILE || os.homedir();
  const opts = { claudeDir: path.join(home, '.claude'), codexDir: path.join(home, '.codex'), stateDir: path.join(home, '.claude/state') };
  const paths = { '--ontology': 'ontology', '--claude-dir': 'claudeDir', '--codex-dir': 'codexDir', '--repo': 'repo', '--state-dir': 'stateDir' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (paths[arg]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
      opts[paths[arg]] = path.resolve(args[++i]);
    } else if (['--write', '--json', '--hook'].includes(arg)) opts[arg.slice(2)] = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  opts.ontology ||= path.join(opts.claudeDir, 'ontology/harness.ontology.json');
  return opts;
}

/* Intent: validate defect types and metric definitions, skipping only absent checklist docs.
 * Status: complete. Next: none. Blockers: none. Confidence: isolated CLI schema tests. */
function checkKnowledge(o, opts, add, info) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const string = x => typeof x === 'string' && x.trim().length > 0;
  const need = (ok, field) => { if (!ok) add('BLOCKS', `invalid ontology: ${field}`); };
  const categories = o.defectCategories, ids = new Set();
  need(Array.isArray(categories), 'defectCategories must be an array');
  if (Array.isArray(categories)) {
    for (const [i, category] of categories.entries()) {
      const field = `defectCategories[${i}]`;
      if (!object(category)) { need(false, `${field} must be an object`); continue; }
      need(string(category.id) && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(category.id), `${field}.id must be kebab-case`);
      need(!ids.has(category.id), `${field}.id duplicate: ${category.id}`); ids.add(category.id);
      for (const key of ['label', 'countermeasure']) need(string(category[key]), `${field}.${key}`);
      need(category.checklist === null || (Array.isArray(category.checklist)
        && category.checklist.every(n => Number.isInteger(n) && n > 0)), `${field}.checklist`);
      need(Array.isArray(category.keywords) && category.keywords.length >= 3 && category.keywords.length <= 6
        && category.keywords.every(x => string(x) && x === x.toLowerCase()), `${field}.keywords must contain 3-6 lowercase hints`);
    }
    need(ids.has('other'), 'defectCategories must include other');
    need(categories.at(-1)?.id === 'other', 'defectCategories other must be last');
  }
  const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
    && Number.isFinite(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
  const scope = (x, allowed) => Array.isArray(x) && x.length > 0
    && (x.length === 1 && x[0] === '*' || x.every(v => allowed.includes(v)));
  const lessonIds = new Set();
  need(Array.isArray(o.lessons), 'lessons must be an array');
  if (Array.isArray(o.lessons)) for (const [i, lesson] of o.lessons.entries()) {
    const field = `lessons[${i}]`;
    if (!object(lesson)) { need(false, `${field} must be an object`); continue; }
    need(string(lesson.id) && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(lesson.id), `${field}.id must be kebab-case`);
    need(!lessonIds.has(lesson.id), `${field}.id duplicate: ${lesson.id}`); lessonIds.add(lesson.id);
    need(ids.has(lesson.category), `${field}.category must exist in defectCategories`);
    // Imperative wording is a certification review judgment; lint checks nonempty, single-line text.
    need(string(lesson.rule) && !/[\r\n]/.test(lesson.rule), `${field}.rule`);
    need(['draft', 'certified', 'deprecated'].includes(lesson.status), `${field}.status`);
    need(object(lesson.appliesTo), `${field}.appliesTo`);
    if (object(lesson.appliesTo)) {
      need(scope(lesson.appliesTo.types, ['ui', 'collector', 'review', 'research', 'docs', 'config', 'other']), `${field}.appliesTo.types`);
      need(scope(lesson.appliesTo.tiers, ['Skip', 'Standard-A', 'Standard-B', 'Important', 'Critical', 'Exploration']), `${field}.appliesTo.tiers`);
    }
    need(Array.isArray(lesson.evidence) && lesson.evidence.every(x => string(x)
      && (x.startsWith('ledger:') ? /^ledger:\d{4}-\d{2}-\d{2}:\S+$/.test(x) && date(x.slice(7, 17)) : !/\s|:/.test(x)))
      && (lesson.status !== 'certified' || lesson.evidence.length >= 2), `${field}.evidence`);
    need(date(lesson.added), `${field}.added must be yyyy-mm-dd`);
  }
  need(object(o.metrics), 'metrics must be an object');
  if (object(o.metrics)) for (const [id, metric] of Object.entries(o.metrics)) {
    const field = `metrics.${id}`;
    if (!object(metric)) { need(false, `${field} must be an object`); continue; }
    for (const key of ['label', 'definition', 'source']) need(string(metric[key]), `${field}.${key}`);
    need(['draft', 'certified', 'deprecated'].includes(metric.status), `${field}.status`);
  }
  if (!Array.isArray(categories)) return;
  const file = path.join(opts.claudeDir, 'docs/packet-checklist.md');
  let checklist;
  try { checklist = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    info.push(`${file}: missing; skipping checklist number existence check`); return;
  }
  const numbers = new Set([...checklist.matchAll(/^\s*(\d+)\.\s+(?:\[[^\]\r\n]+\]\s+)?check:/gm)].map(x => Number(x[1])));
  for (const category of categories) if (Array.isArray(category?.checklist)) {
    for (const n of category.checklist) need(numbers.has(n), `defectCategories.${category.id}.checklist number ${n} not found in ${file}`);
  }
}

/* Intent: propose lessons from recurring finding facts without changing sensor exit codes.
 * Status: complete. Next: P3 certification. Blockers: none. Confidence: dated JSONL fixtures. */
function proposeLessons(o, opts, info) {
  const file = path.join(opts.stateDir, 'findings.jsonl');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') info.push(`findings unreadable: ${e.code}`); return; }
  const now = Date.now(), cutoff = now - 14 * 86400000, counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || (Object.hasOwn(row, 'kind') && row.kind !== 'finding')) continue;
    if (typeof row.utc !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.utc)) continue;
    const utc = Date.parse(row.utc), day = Date.parse(`${row.utc.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(utc) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.utc.slice(0, 10)
      || row.utc.slice(11, 13) > '23' || utc < cutoff || utc > now || typeof row.category !== 'string') continue;
    counts.set(row.category, (counts.get(row.category) || 0) + 1);
  }
  const certified = new Set((Array.isArray(o.lessons) ? o.lessons : []).filter(x => x?.status === 'certified').map(x => x.category));
  for (const category of Array.isArray(o.defectCategories) ? o.defectCategories : []) {
    const n = counts.get(category?.id) || 0;
    if (n >= 3 && !certified.has(category.id)) info.push(`LESSON: ${category.id} has ${n} findings in 14 days and no certified lesson - propose one`);
  }
}

/* Intent: compare generated text, configured hooks, scoped twins and stale prose.
 * Status: complete. Next: install after review. Blockers: none. Confidence: temp-dir tests. */
function check(o, opts) {
  const findings = [], info = o.rules.filter(x => ['HOOK', 'SENSOR'].includes(x.enforcement))
    .map(x => `${x.id}: enforced outside the guide - prose copies can be pruned`);
  const add = (check, message) => findings.push({ check, message });
  const guard = (kind, action) => { try { action(); } catch (e) { add(kind, e.message); } };
  guard('BLOCKS', () => checkKnowledge(o, opts, add, info));
  guard('BLOCKS', () => proposeLessons(o, opts, info));
  const entries = dir => {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  const guide = path.join(opts.claudeDir, 'CLAUDE.md');
  guard('BLOCKS', () => {
    const original = fs.readFileSync(guide, 'utf8'), eol = original.includes('\r\n') ? '\r\n' : '\n';
    let text = original;
    for (const [name, generated] of Object.entries(generateBlocks(o))) {
      const begin = `<!-- ontology:${name}:begin -->`, end = `<!-- ontology:${name}:end -->`;
      const start = text.indexOf(begin), finish = text.indexOf(end);
      if (start < 0 || finish < start || text.indexOf(begin, start + 1) !== -1 || text.indexOf(end, finish + 1) !== -1) {
        add('BLOCKS', `${guide}: missing, duplicate or reversed ${name} markers`); continue;
      }
      const expected = eol + generated.replace(/\n/g, eol) + eol, at = start + begin.length;
      if (text.slice(at, finish) !== expected) {
        if (opts.write) text = text.slice(0, at) + expected + text.slice(finish);
        else add('BLOCKS', `${guide}: ${name} content differs from ontology`);
      }
    }
    if (text !== original) fs.writeFileSync(guide, text, 'utf8');
  });

  // Intent: extract scripts from quoted Windows paths or bare commands, without executing hooks.
  // Status: complete. Next: none. Blockers: none. Confidence: both real hook formats and fixtures.
  const scripts = command => (String(command || '').match(/"[^"]*"|'[^']*'|[^\s]+/g) || [])
    .map(x => x.replace(/^["']|["']$/g, '')).filter(x => /\.(?:ps1|[cm]?js)$/i.test(x))
    .map(x => path.posix.basename(x.replace(/\\/g, '/')));
  const key = x => JSON.stringify([x.event, x.matcher || '', x.script]);
  for (const side of ['claude', 'codex']) guard('HOOKS', () => {
    const root = side === 'claude' ? opts.claudeDir : opts.codexDir;
    const file = path.join(root, side === 'claude' ? 'settings.json' : 'hooks.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config.hooks || typeof config.hooks !== 'object') throw new Error(`${file}: invalid hooks`);
    const actual = new Set(), wired = new Set();
    for (const [event, groups] of Object.entries(config.hooks)) for (const group of groups) for (const hook of group.hooks) {
      const names = scripts(hook.command);
      if (!names.length) add('HOOKS', `${side}: ${event} has no recognizable script`);
      for (const script of names) {
        wired.add(script); actual.add(side === 'claude' ? key({ event, matcher: group.matcher, script }) : script);
      }
    }
    const expected = new Set(side === 'claude' ? o.hooks.claude.map(key) : o.hooks.codex);
    for (const x of expected) if (!actual.has(x)) add('HOOKS', `${side}: missing ${x}`);
    for (const x of actual) if (!expected.has(x)) add('HOOKS', `${side}: unexpected ${x}`);
    for (const { script } of o.hooks.retired) if (wired.has(script)) add('HOOKS', `${side}: retired script wired: ${script}`);
  });
  for (const root of [opts.claudeDir, opts.codexDir]) for (const { script } of o.hooks.retired) {
    const file = path.join(root, 'hooks', script);
    if (fs.existsSync(file)) add('HOOKS', `retired file: ${file}`);
  }

  if (opts.repo) guard('DRIFT', () => {
    const repoClaude = path.join(opts.repo, 'claude');
    if (!fs.statSync(repoClaude).isDirectory()) throw new Error(`not a directory: ${repoClaude}`);
    const files = ['CLAUDE.md', 'settings.json', 'statusline-ultrathink.js'];
    // Intent: walk only mirrored source directories, excluding every tests subtree.
    // Status: complete. Next: none. Blockers: none. Confidence: missing/differing twin tests.
    const walk = relative => {
      for (const entry of entries(path.join(repoClaude, relative))) {
        const next = path.join(relative, entry.name);
        if (entry.isDirectory() && entry.name !== 'tests') walk(next);
        else if (entry.isFile()) files.push(next);
      }
    };
    for (const dir of ['bin', 'hooks', 'docs', 'ontology']) walk(dir);
    for (const relative of files) guard('DRIFT', () => {
      const twin = path.join(opts.claudeDir, relative);
      if (!fs.existsSync(twin)) add('DRIFT', `missing live twin: ${twin}`);
      else if (!fs.readFileSync(path.join(repoClaude, relative)).equals(fs.readFileSync(twin))) add('DRIFT', `bytes differ: ${relative}`);
    });
  });

  guard('STALE', () => {
    const files = new Set(fs.existsSync(guide) ? [guide] : []);
    const markdown = dir => { for (const e of entries(dir)) if (e.isFile() && e.name.endsWith('.md')) files.add(path.join(dir, e.name)); };
    markdown(path.join(opts.claudeDir, 'memory')); markdown(path.join(opts.claudeDir, 'docs'));
    for (const e of entries(path.join(opts.claudeDir, 'projects'))) if (e.isDirectory()) markdown(path.join(opts.claudeDir, 'projects', e.name, 'memory'));
    for (const e of entries(path.join(opts.claudeDir, 'skills'))) if (e.isDirectory()) {
      const file = path.join(opts.claudeDir, 'skills', e.name, 'SKILL.md');
      if (fs.existsSync(file)) files.add(file);
    }
    const patterns = o.staleValues.map(x => ({ ...x, regex: new RegExp(x.pattern, 'i') }));
    const history = /\b(?:until|since)\s+\d{4}-\d{2}-\d{2}\b|(?:từ|\buntil)\s+\d{1,2}\/\d{1,2}\b|superseded/i;
    for (const file of files) guard('STALE', () => {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!history.test(line)) for (const p of patterns) if (p.regex.test(line)) add('STALE', `${file}:${i + 1}: ${p.why}`);
      });
    });
  });
  return { findings, info };
}

/* Intent: human/JSON output with a non-blocking hook mode. Status: complete.
 * Next: none. Blockers: none. Confidence: exit-code tests, including invalid input. */
function main(args) {
  const hook = args.includes('--hook');
  let result, code;
  try {
    const opts = options(args);
    const o = JSON.parse(fs.readFileSync(opts.ontology, 'utf8')); validate(o);
    result = check(o, opts); code = result.findings.length ? 1 : 0;
  } catch (e) { result = { findings: [{ check: 'ONTOLOGY', message: e.message }], info: [] }; code = 2; }
  if (hook) for (const x of result.findings) console.log(`[ontology-check] ${x.check}: ${x.message.replace(/[\r\n]+/g, ' ')}`);
  else if (args.includes('--json')) console.log(JSON.stringify(result));
  else {
    for (const x of result.findings) console.log(`${x.check}: ${x.message}`);
    for (const x of result.info) console.log(`INFO: ${x}`);
    if (!result.findings.length) console.log('ontology-check: clean');
  }
  return hook ? 0 : code;
}

module.exports = { render, generateBlocks, validate, check, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
