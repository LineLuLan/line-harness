const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { summarizeRuns } = require('../../statusline-ultrathink.js');

test('summarizeRuns counts live, stale, and recent dead workers', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-runs-'));
  const now = Date.parse('2026-10-12T12:00:00Z');
  const minutes = n => n * 60_000;
  let nextId = 0;
  const run = (ageMin, options = {}) => {
    const dir = path.join(temp, 'runs', `20261012-120000-${String(nextId++).padStart(4, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), options.runJson ?? JSON.stringify({
      runId: path.basename(dir), wrapperPid: options.wrapperPid || 0,
      startedUtc: new Date(now - minutes(options.startedMin ?? ageMin)).toISOString(),
    }));
    if (options.treeJson !== undefined) fs.writeFileSync(path.join(dir, 'tree.json'), options.treeJson);
    if (options.finished) fs.writeFileSync(path.join(dir, 'exit.txt'), '0');
    if (options.logAgeMin !== undefined) {
      const log = path.join(dir, 'out.log');
      fs.writeFileSync(log, 'output');
      fs.utimesSync(log, new Date(now - minutes(options.logAgeMin)), new Date(now - minutes(options.logAgeMin)));
    }
    fs.utimesSync(dir, new Date(now - minutes(ageMin)), new Date(now - minutes(ageMin)));
    return dir;
  };

  try {
    run(4, { wrapperPid: 101, finished: true });
    run(5, { wrapperPid: 102, logAgeMin: 1 });
    run(20, { treeJson: JSON.stringify([{ pid: 103, parentPid: 1, created: '' }]), logAgeMin: 11 });
    run(3); // dead after the two-minute spawn grace period
    run(1); // still in the spawn grace period
    run(7 * 60); // old death is not news
    run(25 * 60, { wrapperPid: 104, logAgeMin: 25 * 60 }); // outside scan window
    run(4, { runJson: '{invalid' });
    run(4, { wrapperPid: 105, treeJson: '{invalid', logAgeMin: 1 });

    const alive = pid => [101, 102, 103, 104, 105].includes(pid);
    assert.deepEqual(summarizeRuns(temp, now, alive), {
      running: 3, stale: 1, died: 1, oldestRunningMin: 20,
    });
    assert.deepEqual(summarizeRuns(path.join(temp, 'missing'), now, alive), {
      running: 0, stale: 0, died: 0, oldestRunningMin: 0,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('summarizeRuns stays within the statusline budget for 50 folders', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-runs-speed-'));
  const started = Date.now();
  try {
    for (let n = 0; n < 50; n++) {
      const dir = path.join(temp, 'runs', `20261012-120000-${String(n).padStart(4, '0')}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ wrapperPid: n + 1, startedUtc: new Date(started).toISOString() }));
    }
    const now = Date.now() + 1000; // tolerate filesystem timestamp precision
    const start = performance.now();
    const result = summarizeRuns(temp, now, () => true);
    const elapsed = performance.now() - start;
    assert.equal(result.running, 50);
    assert.ok(elapsed < 30, `50 folders took ${elapsed.toFixed(1)} ms`);
    t.diagnostic(`50 folders summarized in ${elapsed.toFixed(1)} ms`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('default PID check treats EPERM as alive', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-runs-eperm-'));
  const dir = path.join(temp, 'runs', '20261012-120000-abcd');
  const now = Date.now();
  const originalKill = process.kill;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ wrapperPid: 123, startedUtc: new Date(now - 60_000).toISOString() }));
    fs.utimesSync(dir, new Date(now - 60_000), new Date(now - 60_000));
    process.kill = () => { const error = new Error('access denied'); error.code = 'EPERM'; throw error; };
    assert.equal(summarizeRuns(temp, now).running, 1);
  } finally {
    process.kill = originalKill;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
