'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../bin/ontology-check.js');
const source = path.resolve(__dirname, '../ontology/harness.ontology.json');
const golden = name => fs.readFileSync(path.join(__dirname, 'fixtures/ontology', `${name}.golden.md`), 'utf8');

test('template rendering preserves pace precision and formats other values as integers', () => {
  const { render } = require(script);
  assert.equal(render('{codexPace1} {codexPace2} {codexUsed2-1} {codexUsed1}',
    { codexPace1: 1, codexPace2: 1.25, codexUsed2: 85, codexUsed1: 70.5 }), '1.0 1.25 84 71');
});

/* Intent: isolated sensor fixtures using the supplied ontology and pre-edit golden text.
 * Status: complete. Next: none. Blockers: none. Confidence: CLI assertions below. */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
  const ontology = JSON.parse(fs.readFileSync(source, 'utf8'));
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const json = (file, value) => write(file, JSON.stringify(value));
  json(path.join(claude, 'ontology/harness.ontology.json'), ontology);
  write(path.join(claude, 'statusline-ultrathink.js'), '// fixture');
  write(path.join(claude, 'CLAUDE.md'), ['quota', 'review-tiers'].map(name =>
    `<!-- ontology:${name}:begin -->\n${golden(name)}\n<!-- ontology:${name}:end -->`).join('\n\n'));
  const hooks = {};
  for (const h of ontology.hooks.claude) (hooks[h.event] ||= []).push({ ...(h.matcher ? { matcher: h.matcher } : {}),
    hooks: [{ type: 'command', command: `node "C:\\fixture space\\${h.script}"` }] });
  json(path.join(claude, 'settings.json'), { hooks });
  json(path.join(codex, 'hooks.json'), { hooks: { SessionStart: [{ hooks: ontology.hooks.codex.map(script =>
    ({ type: 'command', command: `powershell -File "C:\\fixture\\${script}"` })) }] } });
  const state = path.join(root, 'state');
  const run = (...args) => spawnSync(process.execPath, [script, '--claude-dir', claude, '--codex-dir', codex, '--state-dir', state, ...args], { encoding: 'utf8' });
  return { root, claude, codex, state, ontology, write, json, run };
}

test('clean, golden generator, INFO only, missing projects directory and quiet hook', t => {
  const f = fixture(t), r = f.run('--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.findings, []);
  assert.ok(result.info.some(x => x.includes('context-silent') && x.includes('enforced outside the guide')));
  const { generateBlocks } = require(script);
  const guide = fs.readFileSync(path.resolve(__dirname, '../CLAUDE.md'), 'utf8');
  for (const name of ['quota', 'review-tiers']) {
    assert.equal(generateBlocks(f.ontology)[name], golden(name));
    assert.equal(guide.split(`<!-- ontology:${name}:begin -->\n`)[1].split(`\n<!-- ontology:${name}:end -->`)[0], golden(name));
  }
  const hook = f.run('--hook'); assert.equal(hook.status, 0); assert.equal(hook.stdout, '');
});

/* Intent: K5f - Codex C3 routes to Grok workers (auto) instead of the old K1+C3 STOP; the generated quota block
 * and the matrix say so. Status: complete. Next: none. Blockers: none. Confidence: this test. */
test('Grok C3 route: generated block, matrix rows and no STOP literal', () => {
  const { generateBlocks, validate } = require(script);
  const o = JSON.parse(fs.readFileSync(source, 'utf8'));
  const quota = generateBlocks(o).quota;
  assert.ok(quota.includes('| Used >= 95% | No Codex. Grok worker via codex-do (auto at used >= 95%): Standard, Important and Exploration; '
    + 'Critical worker = Opus subagent; layer 2 = Grok review (codex-review.ps1 auto) + Fable subagent; ledger `worker=grok-4.7-build-fast`. |'), quota);
  assert.ok(quota.includes('- Codex used >= 95% while the Claude rule is active: Grok workers continue; layer 2 = Fable subagent; report to Line.'));
  assert.ok(!/no new packets|only stop rule/i.test(quota));
  assert.equal(o.routing.labels.grok, 'grok-4.7-build-fast xhigh (codex-do auto)');
  assert.equal(o.routing.labels.grokImp, 'grok-4.7-build-fast xhigh; Critical: Opus subagent');
  for (const k of ['K0', 'K1']) assert.deepEqual(o.routing.matrix[k].C3, ['grok', 'grok', 'grokImp', 'grok', 'fable']);
  assert.ok(o.quota.claudeRules.some(x => x.id === 'STOP' && x.test === 'C3 and K1'));
  validate(o);
  assert.throws(() => validate({ ...o, routing: { ...o.routing, matrix: { ...o.routing.matrix, K1: { ...o.routing.matrix.K1, C3: 'STOP' } } } }),
    /routing\.matrix\.K1\.C3/);
});

test('BLOCKS drift, write limited to content and idempotent, CRLF preserved', t => {
  const f = fixture(t), file = path.join(f.claude, 'CLAUDE.md');
  const before = 'prefix\r\n' + fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n') + '\r\nsuffix';
  fs.writeFileSync(file, before.replace('Pace <= 1.0', 'Pace <= 9.9'));
  const bad = f.run('--json'); assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout).findings.map(x => x.check), ['BLOCKS']);
  assert.equal(f.run('--write').status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(f.run('--write').status, 0); assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('missing markers are findings and write cannot invent boundaries', t => {
  const f = fixture(t); f.write(path.join(f.claude, 'CLAUDE.md'), 'unmarked');
  assert.equal(f.run('--write').status, 1);
  assert.equal(fs.readFileSync(path.join(f.claude, 'CLAUDE.md'), 'utf8'), 'unmarked');
});

test('HOOKS compares Claude event/matcher/script and Codex script sets; retired files and wiring', t => {
  const f = fixture(t), settings = path.join(f.claude, 'settings.json');
  const s = JSON.parse(fs.readFileSync(settings)); s.hooks.PreToolUse[0].matcher = 'wrong'; f.json(settings, s);
  f.write(path.join(f.codex, 'hooks', f.ontology.hooks.retired[0].script), 'retired');
  f.json(path.join(f.codex, 'hooks.json'), { hooks: { Stop: [{ hooks: [{ command: `powershell -File ${f.ontology.hooks.retired[0].script}` }] }] } });
  const r = f.run('--json'); assert.equal(r.status, 1);
  const findings = JSON.parse(r.stdout).findings;
  assert.ok(findings.every(x => x.check === 'HOOKS'));
  assert.ok(findings.some(x => /matcher|wrong/.test(x.message)));
  assert.ok(findings.some(x => /retired file/.test(x.message)));
  assert.ok(findings.some(x => /retired script wired/.test(x.message)));
  assert.ok(findings.some(x => /codex/.test(x.message)));
});

test('DRIFT compares scoped bytes, reports missing twins, excludes tests', t => {
  const f = fixture(t), repo = path.join(f.root, 'repo');
  fs.cpSync(f.claude, path.join(repo, 'claude'), { recursive: true });
  f.write(path.join(repo, 'claude/bin/tests/ignored.js'), 'ignored');
  assert.equal(f.run('--repo', repo).status, 0);
  f.write(path.join(repo, 'claude/bin/new.js'), 'missing live');
  const r = f.run('--repo', repo, '--json'); assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).findings.map(x => x.check), ['DRIFT']);
  f.write(path.join(f.claude, 'bin/new.js'), 'different bytes');
  assert.equal(f.run('--repo', repo).status, 1);
});

test('STALE scans all requested locations and exempts only dated/history lines', t => {
  const f = fixture(t);
  for (const file of ['projects/p/memory/a.md', 'memory/a.md', 'docs/a.md', 'skills/x/SKILL.md']) {
    f.write(path.join(f.claude, file), 'exit 75\nuntil 2026-11-15 exit 75\nsince 2026-11-15 exit 75\ntừ 1/2 exit 75\nuntil 01/02 exit 75\nsuperseded exit 75\n');
  }
  const r = f.run('--json'); assert.equal(r.status, 1);
  const findings = JSON.parse(r.stdout).findings;
  assert.equal(findings.length, 4); assert.ok(findings.every(x => x.check === 'STALE'));
  const h = f.run('--hook'); assert.equal(h.status, 0);
  assert.ok(h.stdout.trim().split('\n').every(x => x.startsWith('[ontology-check]')));
});

test('invalid or unreadable ontology exits 2, including invalid shape and pattern; hook always 0', t => {
  const f = fixture(t), file = path.join(f.claude, 'ontology/harness.ontology.json');
  for (const value of ['{', '{}', JSON.stringify({ ...f.ontology, staleValues: [{ pattern: '[' }] }),
    JSON.stringify({ ...f.ontology, routing: {} }), JSON.stringify({ ...f.ontology, alerts: {} })]) {
    f.write(file, value); assert.equal(f.run().status, 2); assert.equal(f.run('--hook').status, 0);
  }
  assert.equal(f.run('--ontology', path.join(f.root, 'missing')).status, 2);
  assert.equal(f.run('--hook', '--ontology', path.join(f.root, 'missing')).status, 0);
});

/* Intent: exercise knowledge blocks independently of the repository category data.
 * Status: complete. Next: none. Blockers: none. Confidence: CLI failure and success cases. */
function knowledgeFixture(t, checklist = '1. [contradiction] check: use consistent criteria.\n') {
  const f = fixture(t);
  f.ontology.defectCategories = [
    { id: 'contradiction', label: 'Contradictory requirements', checklist: [1],
      countermeasure: 'Resolve conflicting requirements.', keywords: ['conflict', 'criterion', 'meaning'] },
    { id: 'other', label: 'Other defect', checklist: null,
      countermeasure: 'Describe the defect in the finding title.', keywords: ['other', 'unknown', 'uncategorized'] }
  ];
  f.ontology.metrics = { first_pass: { label: 'Clean first pass', status: 'certified',
    definition: 'A ledger task with fail_rounds = 0 and L1 + L2 + L3 findings = 0.', source: 'review-ledger.log' } };
  // The fixture replaces the categories, so live certified lessons (which name real categories) must not leak in.
  f.ontology.lessons = [];
  f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
  if (checklist !== null) f.write(path.join(f.claude, 'docs/packet-checklist.md'), checklist);
  return f;
}

for (const checklist of ['1. check: use consistent criteria.\n', '1. [contradiction] check: use consistent criteria.\r\n']) {
  test(`valid knowledge blocks pass with ${checklist.includes('[') ? 'tagged' : 'plain'} checklist numbers`, t => {
    const f = knowledgeFixture(t, checklist), r = f.run('--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).findings, []);
    assert.ok(!JSON.parse(r.stdout).info.some(x => x.includes('packet-checklist.md')));
  });
}

test('missing checklist docs prints exactly one INFO and passes', t => {
  const f = knowledgeFixture(t, null), r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter(x => x.includes('packet-checklist.md'));
  assert.equal(lines.length, 1, r.stdout);
  assert.match(lines[0], /^INFO: .*packet-checklist\.md.*skip/i);
});

const invalidKnowledge = [
  ['duplicate category id', o => o.defectCategories.splice(1, 0, { ...o.defectCategories[0] }), /duplicate.*contradiction/i],
  ['non-kebab category id', o => { o.defectCategories[0].id = 'Bad_id'; }, /id/],
  ['missing category field', o => { delete o.defectCategories[0].countermeasure; }, /countermeasure/],
  ['missing checklist field', o => { delete o.defectCategories[0].checklist; }, /checklist/],
  ['non-array checklist', o => { o.defectCategories[0].checklist = '1'; }, /checklist/],
  ['non-integer checklist', o => { o.defectCategories[0].checklist = [1.5]; }, /checklist/],
  ['too few keywords', o => { o.defectCategories[0].keywords = ['one', 'two']; }, /keywords/],
  ['too many keywords', o => { o.defectCategories[0].keywords = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; }, /keywords/],
  ['uppercase keyword', o => { o.defectCategories[0].keywords[0] = 'Conflict'; }, /keywords/],
  ['non-string keyword', o => { o.defectCategories[0].keywords[0] = 1; }, /keywords/],
  ['unknown checklist number 99', o => { o.defectCategories[0].checklist = [99]; }, /checklist.*99/],
  ['missing other', o => { o.defectCategories.pop(); }, /other/],
  ['other not last', o => { o.defectCategories.reverse(); }, /other.*last/],
  ['missing categories', o => { delete o.defectCategories; }, /defectCategories/],
  ['invalid categories shape', o => { o.defectCategories = {}; }, /defectCategories/],
  ['null category', o => { o.defectCategories[0] = null; }, /defectCategories/],
  ['approved metric status', o => { o.metrics.first_pass.status = 'approved'; }, /status/],
  ['missing metrics', o => { delete o.metrics; }, /metrics/],
  ['invalid metrics shape', o => { o.metrics = []; }, /metrics/],
  ['null metric', o => { o.metrics.first_pass = null; }, /metrics/],
  ...['label', 'status', 'definition', 'source'].map(field => [
    `missing metric ${field}`, o => { delete o.metrics.first_pass[field]; }, new RegExp(field)
  ])
];
for (const [name, mutate, message] of invalidKnowledge) {
  test(`knowledge BLOCKS: ${name}`, t => {
    const f = knowledgeFixture(t); mutate(f.ontology);
    f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
    const r = f.run('--json'); assert.equal(r.status, 1, r.stdout + r.stderr);
    const findings = JSON.parse(r.stdout).findings;
    assert.ok(findings.every(x => x.check === 'BLOCKS'), r.stdout);
    assert.ok(findings.some(x => message.test(x.message)), r.stdout);
  });
}

test('missing docs skips only checklist existence, retaining schema and metric checks', t => {
  const f = knowledgeFixture(t, null);
  f.ontology.defectCategories[0].checklist = [99];
  f.ontology.metrics.first_pass.status = 'approved';
  f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
  const r = f.run('--json'); assert.equal(r.status, 1, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout);
  assert.ok(result.findings.some(x => x.check === 'BLOCKS' && x.message.includes('status')));
  assert.ok(!result.findings.some(x => /checklist.*99/.test(x.message)));
  assert.equal(result.info.filter(x => x.includes('packet-checklist.md')).length, 1);
});

test('all allowed metric statuses pass and every metric is checked', t => {
  const f = knowledgeFixture(t);
  for (const status of ['draft', 'certified', 'deprecated']) {
    f.ontology.metrics.another = { ...f.ontology.metrics.first_pass, status };
    f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
    const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  f.ontology.metrics.another.status = 'approved';
  f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
  const r = f.run(); assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /BLOCKS: .*metrics\.another\.status/);
});

test('repository knowledge categories cover the checklist and certify the exact first-pass definition', () => {
  const ontology = JSON.parse(fs.readFileSync(source, 'utf8'));
  const ids = ['contradiction', 'sandbox-validate', 'salvage-resume', 'ui-widths', 'docs-style', 'encoding',
    'docs-sync', 'source-of-truth', 'concurrency', 'fixture-secret', 'real-path', 'formatter-lint', 'env-tools',
    'scope-creep', 'ps51-traps', 'missing-criterion', 'unverified-claim', 'logic-bug', 'other'];
  assert.deepEqual(ontology.defectCategories.map(x => x.id), ids);
  assert.deepEqual(ontology.defectCategories.map(x => x.checklist),
    [...Array.from({ length: 14 }, (_, i) => [i + 1]), [15, 16], null, null, null, null]);
  assert.deepEqual(ontology.metrics.first_pass, { label: 'Clean first pass', status: 'certified',
    definition: 'A ledger task with fail_rounds = 0 and L1 + L2 + L3 findings = 0.', source: 'review-ledger.log' });
  const checklist = fs.readFileSync(path.resolve(__dirname, '../docs/packet-checklist.md'), 'utf8');
  for (const category of ontology.defectCategories) for (const number of category.checklist || []) {
    assert.ok(checklist.includes(`${number}. [${category.id}] check:`), `${number}: ${category.id}`);
  }
});

/* Intent: define lesson schema and recurrence behavior before implementation.
 * Status: complete. Next: none. Blockers: none. Confidence: isolated CLI fixtures. */
function lessonFixture(t) {
  const f = knowledgeFixture(t);
  f.ontology.lessons = [{ id: 'resolve-conflicts', category: 'contradiction', rule: 'Resolve conflicting requirements.',
    appliesTo: { types: ['config'], tiers: ['Important'] }, status: 'certified',
    evidence: ['0123456789abcdef', 'ledger:2026-11-15:conflict'], added: '2026-11-15' }];
  f.save = () => f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
  f.save();
  return f;
}

const invalidLessons = [
  ['missing lessons', o => { delete o.lessons; }, /lessons/],
  ['non-array lessons', o => { o.lessons = {}; }, /lessons/],
  ['null lesson', o => { o.lessons = [null]; }, /lessons/],
  ['duplicate id', o => o.lessons.push({ ...o.lessons[0] }), /duplicate/],
  ['non-kebab id', o => { o.lessons[0].id = 'Bad_id'; }, /id/],
  ['unknown category', o => { o.lessons[0].category = 'absent'; }, /category/],
  ['empty rule', o => { o.lessons[0].rule = ''; }, /rule/],
  ['multiline rule', o => { o.lessons[0].rule = 'Resolve conflicts.\nCheck again.'; }, /rule/],
  ['unknown status', o => { o.lessons[0].status = 'approved'; }, /status/],
  ['missing appliesTo', o => { delete o.lessons[0].appliesTo; }, /appliesTo/],
  ['unknown type', o => { o.lessons[0].appliesTo.types = ['backend']; }, /types/],
  ['empty types', o => { o.lessons[0].appliesTo.types = []; }, /types/],
  ['mixed wildcard types', o => { o.lessons[0].appliesTo.types = ['*', 'config']; }, /types/],
  ['unknown tier', o => { o.lessons[0].appliesTo.tiers = ['Standard']; }, /tiers/],
  ['non-array tiers', o => { o.lessons[0].appliesTo.tiers = 'Important'; }, /tiers/],
  ['mixed wildcard tiers', o => { o.lessons[0].appliesTo.tiers = ['*', 'Important']; }, /tiers/],
  ['one certified evidence', o => { o.lessons[0].evidence.pop(); }, /evidence/],
  ['non-array evidence', o => { o.lessons[0].evidence = 'finding'; }, /evidence/],
  ['empty evidence id', o => { o.lessons[0].evidence[0] = ''; }, /evidence/],
  ['bad ledger evidence', o => { o.lessons[0].evidence[0] = 'ledger:bad:entry'; }, /evidence/],
  ['bad added date', o => { o.lessons[0].added = '2026-02-30'; }, /added/]
];
for (const [name, mutate, message] of invalidLessons) {
  test(`lesson BLOCKS: ${name}`, t => {
    const f = lessonFixture(t); mutate(f.ontology); f.save();
    const r = f.run('--json'); assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(JSON.parse(r.stdout).findings.some(x => x.check === 'BLOCKS' && message.test(x.message)), r.stdout);
  });
}

test('empty lessons and all statuses, work types, tiers and wildcards pass', t => {
  const f = lessonFixture(t);
  f.ontology.lessons[0].appliesTo = { types: ['ui', 'collector', 'review', 'research', 'docs', 'config', 'other'],
    tiers: ['Skip', 'Standard-A', 'Standard-B', 'Important', 'Critical', 'Exploration'] };
  f.save(); assert.equal(f.run().status, 0);
  for (const status of ['draft', 'certified', 'deprecated']) {
    Object.assign(f.ontology.lessons[0], { status, appliesTo: { types: ['*'], tiers: ['*'] },
      evidence: status === 'certified' ? ['finding-1', 'finding-2'] : [] });
    f.save(); assert.equal(f.run().status, 0);
  }
  f.ontology.lessons = []; f.save(); assert.equal(f.run().status, 0);
});

test('LESSON recurrence counts valid recent findings only; INFO is quiet in hook and JSON stays parseable', t => {
  const f = lessonFixture(t);
  f.ontology.lessons[0].status = 'draft'; f.save();
  const utc = new Date(Date.now() - 86400000).toISOString();
  const rows = [
    { utc, category: 'contradiction' }, { utc, category: 'contradiction', kind: 'finding' },
    { utc, category: 'contradiction', kind: 'format-violation' }, { utc, category: 'contradiction', kind: null },
    { utc, category: 'CONTRADICTION' }, [{ utc, category: 'contradiction' }],
    { utc: 'bad', category: 'contradiction' }, { utc: 1, category: 'contradiction' },
    { utc: '2026-02-30T12:00:00Z', category: 'contradiction' },
    { utc: new Date(Date.now() - 15 * 86400000).toISOString(), category: 'contradiction' },
    { utc: new Date(Date.now() + 86400000).toISOString(), category: 'contradiction' },
    { utc, category: 'unknown' }, null, []
  ];
  const writeRows = () => f.write(path.join(f.state, 'findings.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n{broken\n');
  writeRows();
  assert.ok(!JSON.parse(f.run('--json').stdout).info.some(x => x.startsWith('LESSON:')));
  rows.push({ utc, category: 'contradiction', kind: 'finding' }); writeRows();
  const r = f.run('--json'); assert.equal(r.status, 0, r.stdout + r.stderr);
  const expected = 'LESSON: contradiction has 3 findings in 14 days and no certified lesson - propose one';
  assert.deepEqual(JSON.parse(r.stdout).info.filter(x => x.startsWith('LESSON:')), [expected]);
  assert.ok(f.run().stdout.includes(`INFO: ${expected}`));
  assert.equal(f.run('--hook').stdout, '');
  f.ontology.lessons[0].status = 'certified'; f.save();
  assert.ok(!JSON.parse(f.run('--json').stdout).info.some(x => x.startsWith('LESSON:')));
});

test('unreadable findings directory is INFO only, never BLOCKS, and quiet in hook mode', t => {
  const f = lessonFixture(t);
  fs.mkdirSync(path.join(f.state, 'findings.jsonl'), { recursive: true });
  const r = f.run('--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.info.filter(x => x.startsWith('findings unreadable:')), ['findings unreadable: EISDIR']);
  assert.match(f.run().stdout, /^INFO: findings unreadable: EISDIR$/m);
  assert.equal(f.run('--hook').stdout, '');
});

test('sensor recurrence still lists all categories including other', t => {
  const f = knowledgeFixture(t);
  const utc = new Date(Date.now() - 86400000).toISOString();
  f.ontology.defectCategories = Array.from({ length: 7 }, (_, i) => ({ ...f.ontology.defectCategories[0], id: `category-${i}` }))
    .concat(f.ontology.defectCategories.at(-1));
  f.json(path.join(f.claude, 'ontology/harness.ontology.json'), f.ontology);
  const rows = f.ontology.defectCategories.flatMap(c => Array.from({ length: 3 }, () => ({ utc, category: c.id })));
  f.write(path.join(f.state, 'findings.jsonl'), rows.map(x => JSON.stringify(x)).join('\n'));
  const r = f.run('--json'); assert.equal(r.status, 0, r.stdout + r.stderr);
  const info = JSON.parse(r.stdout).info.filter(x => x.startsWith('LESSON:'));
  assert.equal(info.length, 8);
  assert.ok(info.some(x => x.startsWith('LESSON: other ')));
});
