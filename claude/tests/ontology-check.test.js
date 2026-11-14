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
  const run = (...args) => spawnSync(process.execPath, [script, '--claude-dir', claude, '--codex-dir', codex, ...args], { encoding: 'utf8' });
  return { root, claude, codex, ontology, write, json, run };
}

test('clean, golden generator, INFO only, missing projects directory and quiet hook', t => {
  const f = fixture(t), r = f.run('--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.findings, []);
  assert.ok(result.info.some(x => x.includes('repo-root-dir') && x.includes('enforced outside the guide')));
  const { generateBlocks } = require(script);
  const guide = fs.readFileSync(path.resolve(__dirname, '../CLAUDE.md'), 'utf8');
  for (const name of ['quota', 'review-tiers']) {
    assert.equal(generateBlocks(f.ontology)[name], golden(name));
    assert.equal(guide.split(`<!-- ontology:${name}:begin -->\n`)[1].split(`\n<!-- ontology:${name}:end -->`)[0], golden(name));
  }
  const hook = f.run('--hook'); assert.equal(hook.status, 0); assert.equal(hook.stdout, '');
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
