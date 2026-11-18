const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const statusline = path.resolve(__dirname, '../statusline-ultrathink.js');
const { codexAutoGrok, engineSuffix, codexCacheSuffix } = require(statusline);
const now = Date.parse('2026-11-18T12:00:00Z');
const hour = 60 * 60_000;
const plain = text => text.replace(/\x1b\[[\d;]*m/g, '');
const future = (now + 2 * 24 * hour) / 1000;
const past = (now - 24 * hour) / 1000;

// Intent: K5e - the status line applies the same auto rule as codex-do (criterion 2, E10).
// Status: fixture-covered. Next: host render. Blockers: none. Confidence: high.
test('auto rule: used %, reset time and data age decide grok', () => {
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96, resetsAt: future } }, 95, now), true);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96, resetsAt: new Date(future * 1000).toISOString() } }, 95, now), true);
  assert.equal(codexAutoGrok({ weekly: { left: 3 }, dataTs: new Date(now - 2 * hour).toISOString() }, 95, now), true);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 95, resetsAt: future } }, 95, now), true);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96, resetsAt: past } }, 95, now), false);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96 }, dataTs: new Date(now - 30 * hour).toISOString() }, 95, now), false);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 40, resetsAt: future } }, 95, now), false);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 92, resetsAt: future } }, 90, now), true);
  // U2: resetsAt above 1e11 is milliseconds; same values as grok-engine.test.ps1 (2026-11-20T12:00Z future, 2026-11-17T12:00Z past).
  assert.equal(1795176000000, Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96, resetsAt: 1795176000000 } }, 95, now), true);
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 96, resetsAt: 1794916800000 } }, 95, now), false);
  // U4: 94.6 rounds to 95 but stays below the threshold.
  assert.equal(codexAutoGrok({ weekly: { usedPercent: 94.6, resetsAt: future } }, 95, now), false);
  for (const bad of [null, undefined, 'x', {}, { weekly: null }, { weekly: { usedPercent: '96', resetsAt: future } },
    { weekly: { usedPercent: 96, resetsAt: 'not a date' } }, { weekly: { usedPercent: 96 } }]) {
    assert.equal(codexAutoGrok(bad, 95, now), false);
  }
});

test('engine suffix: manual codex, manual grok, auto grok, and nothing for auto codex', () => {
  const hot = { weekly: { usedPercent: 96, resetsAt: future } };
  const cool = { weekly: { usedPercent: 40, resetsAt: future } };
  assert.equal(plain(engineSuffix('grok\n', null, 95, now)), ' · engine: grok (manual)');
  assert.equal(plain(engineSuffix('codex', hot, 95, now)), ' · engine: codex (manual)');
  assert.equal(plain(engineSuffix('auto\n', hot, 95, now)), ' · engine: grok (auto)');
  assert.equal(plain(engineSuffix(null, hot, 95, now)), ' · engine: grok (auto)');
  assert.equal(engineSuffix(null, cool, 95, now), '');
  assert.equal(engineSuffix(null, null, 95, now), '');
  assert.equal(engineSuffix('bogus', cool, 95, now), '');
});

test('cache suffix is empty for the main home and a SHA-256 prefix otherwise', () => {
  assert.equal(codexCacheSuffix('C:\\h\\.codex', 'C:\\h\\.codex'), '');
  const home = 'C:\\Users\\ADMIN\\.codex-accounts\\work';
  const expected = '-' + require('node:crypto').createHash('sha256').update(home, 'utf8').digest('hex').slice(0, 16);
  assert.equal(codexCacheSuffix(home, 'C:\\h\\.codex'), expected);
});

// Real renderer with TEMP/TMP/USERPROFILE overrides (as statusline-pace.test.js); fresh caches so no background refresh starts.
test('real statusline shows the engine suffix and never fails on missing files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-engine-'));
  const cache = path.join(temp, 'ultrathink-status');
  const state = path.join(temp, 'state');
  const env = { ...process.env, USERPROFILE: temp, HOME: temp, TEMP: temp, TMP: temp,
    CODEX_ACC_MAIN_HOME: path.join(temp, 'codex'), CODEX_ACC_ROOT: path.join(temp, 'accounts'),
    CODEX_DO_STATE_DIR: state, ULTRATHINK_TRAIL_OVERRIDE: path.join(temp, 'trail'),
    ULTRATHINK_ONTOLOGY: path.resolve(__dirname, '../ontology/harness.ontology.json'), CODEX_DO_ENGINE: 'grok',
    GROK_HOME: path.join(temp, 'grok') };
  const write = (name, value) => fs.writeFileSync(path.join(cache, name), JSON.stringify(value));
  const input = fs.readFileSync(path.join(__dirname, 'fixtures/statusline-input.json'), 'utf8');
  const render = () => {
    const result = spawnSync(process.execPath, [statusline], { env, input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return plain(result.stdout).split('\n').find(line => line.includes('codex') && line.includes('⚡')) || '';
  };
  try {
    fs.mkdirSync(cache);
    fs.mkdirSync(path.join(temp, 'codex'));
    fs.mkdirSync(state);
    write('accounts.json', { claude: 'fixture', codex: 'fixture' });
    write('anthropic-usage.json', {});
    write('grok-usage.json', { loggedIn: false, ts: Date.now() });
    const codexCache = path.join(cache, 'codex-usage.json');
    write('codex-usage.json', { weekly: { left: 4, usedPercent: 96, resetsAt: (Date.now() + 2 * 24 * hour) / 1000 } });
    assert.match(render(), /engine: grok \(auto\)$/);
    fs.writeFileSync(path.join(state, 'engine.txt'), 'codex\n');
    assert.match(render(), /engine: codex \(manual\)$/);
    fs.writeFileSync(path.join(state, 'engine.txt'), 'grok\n');
    fs.rmSync(codexCache);
    assert.match(render(), /engine: grok \(manual\)$/);
    fs.rmSync(path.join(state, 'engine.txt'));
    const bare = render();
    assert.doesNotMatch(bare, /engine:/, 'missing engine.txt and cache: no suffix (CODEX_DO_ENGINE is not shown)');
    write('codex-usage.json', { weekly: { left: 60, usedPercent: 40, resetsAt: (Date.now() + 2 * 24 * hour) / 1000 } });
    assert.doesNotMatch(render(), /engine:/, 'auto -> codex: no suffix');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
