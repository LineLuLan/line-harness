const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const statusline = path.resolve(__dirname, '../statusline-ultrathink.js');
process.env.ULTRATHINK_ONTOLOGY = path.resolve(__dirname, '../ontology/harness.ontology.json');
const { weeklyPace } = require(statusline);
const week = 7 * 24 * 60 * 60_000;
const now = Date.parse('2026-11-13T12:00:00Z');

test('weekly pace uses elapsed window, accepts both existing reset formats, rejects unavailable inputs', () => {
  assert.equal(weeklyPace(60, (now + week / 2) / 1000, now), 1.2);
  assert.equal(weeklyPace(60, new Date(now + week / 2).toISOString(), now), 1.2);
  assert.equal(weeklyPace(0, (now + week / 2) / 1000, now), 0);
  assert.equal(weeklyPace(75, (now + week / 2) / 1000, now), 1.5);
  assert.equal(weeklyPace(5, (now + week * 0.95) / 1000, now), 1);
  assert.equal(weeklyPace(5, (now + week * 0.95 + 1) / 1000, now), null);
  assert.equal(weeklyPace(5, (now + week * 0.99) / 1000, now), null);
  for (const used of [null, undefined, '', '60', NaN, Infinity, -1, 101]) {
    assert.equal(weeklyPace(used, (now + week / 2) / 1000, now), null);
  }
  for (const reset of [null, undefined, '', 'bad', {}, NaN, Infinity, 0, now / 1000,
    (now - 1) / 1000, (now + week) / 1000, (now + week + 1) / 1000]) {
    assert.equal(weeklyPace(60, reset, now), null);
  }
});

test('real statusline renders numeric pace and threshold colours from existing caches only', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-pace-'));
  const cache = path.join(temp, 'ultrathink-status');
  const main = path.join(temp, 'codex');
  const env = { ...process.env, USERPROFILE: temp, HOME: temp, TEMP: temp, TMP: temp,
    CODEX_ACC_MAIN_HOME: main, CODEX_ACC_ROOT: path.join(temp, 'accounts'),
    CODEX_DO_STATE_DIR: path.join(temp, 'state'), ULTRATHINK_TRAIL_OVERRIDE: path.join(temp, 'trail') };
  const write = (name, value) => fs.writeFileSync(path.join(cache, name), JSON.stringify(value));
  const input = fs.readFileSync(path.join(__dirname, 'fixtures/statusline-input.json'), 'utf8');
  const timings = [];
  try {
    fs.mkdirSync(cache);
    fs.mkdirSync(main);
    // Assert isolation before executing a renderer that can refresh account data.
    const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify([require("os").homedir(),require("os").tmpdir()]))'], { env, encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), [temp, temp]);
    write('accounts.json', { claude: 'fixture', codex: 'fixture' });
    write('openrouter-usage.json', {});
    const render = (used, options = {}) => {
      const reset = Date.now() + week * (options.early ? 0.99 : 0.5);
      write('anthropic-usage.json', { seven_day: { utilization: used,
        ...(options.missing ? {} : { resets_at: new Date(options.expired ? Date.now() - 1000 : reset).toISOString() }) } });
      write('codex-usage.json', { weekly: { left: 100 - used,
        ...(options.exact ? { usedPercent: used + 0.4 } : {}),
        ...(options.missing ? {} : { resetsAt: (options.expired ? Date.now() - 1000 : reset) / 1000 }) } });
      const started = performance.now();
      const result = spawnSync(process.execPath, [statusline], { env, input, encoding: 'utf8' });
      timings.push(performance.now() - started);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      return result.stdout;
    };
    for (const [used, pace, colour] of [[40, '0.8', 151], [60, '1.2', 214], [75, '1.5', 203]]) {
      const output = render(used);
      assert.equal((output.match(new RegExp(`pace ${pace.replace('.', '\\.')}x`, 'g')) || []).length, 2);
      assert.ok(output.includes(`\x1b[38;5;${colour}mpace ${pace}x`));
      for (const name of ['claude', 'codex']) {
        const line = output.split('\n').find(line => line.includes(name));
        assert.match(line, /wk.*pace/);
      }
    }
    // Raw Codex usage can carry decimals that the old 'left' cache rounded away.
    assert.match(render(62.4, { exact: true }), /pace 1\.3x/);
    assert.doesNotMatch(render(60, { missing: true }), /pace /);
    assert.doesNotMatch(render(60, { expired: true }), /pace /);
    assert.doesNotMatch(render(5, { early: true }), /pace /);
    // Intent: prove ontology changes affect actual ANSI output, without touching live state.
    // Status: complete. Next: none. Blockers: none. Confidence: isolated renderer subprocess.
    const ontology = JSON.parse(fs.readFileSync(process.env.ULTRATHINK_ONTOLOGY, 'utf8'));
    ontology.quota.thresholds.codexPace2 = 1.5;
    env.ULTRATHINK_ONTOLOGY = path.join(temp, 'ontology.json');
    fs.writeFileSync(env.ULTRATHINK_ONTOLOGY, JSON.stringify(ontology));
    assert.ok(render(70).includes('\x1b[38;5;214mpace 1.4x'), 'fixture 1.5 boundary makes 1.4 amber');
    fs.writeFileSync(env.ULTRATHINK_ONTOLOGY, '{}');
    assert.ok(render(70).includes('\x1b[38;5;203mpace 1.4x'), 'invalid ontology falls back to 1.3');
  } finally {
    timings.sort((a, b) => a - b);
    t.diagnostic(`render including Node startup: n=${timings.length}, median=${timings[Math.floor(timings.length / 2)].toFixed(1)} ms`);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
