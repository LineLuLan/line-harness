const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const statusline = path.resolve(__dirname, '../../statusline-ultrathink.js');

test('codexHome resolves active accounts safely and require has no side effects', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-codexhome-'));
  const root = path.join(temp, 'accounts');
  const main = path.join(temp, 'main');
  fs.mkdirSync(root);
  fs.mkdirSync(main);
  const previousRoot = process.env.CODEX_ACC_ROOT;
  const previousMain = process.env.CODEX_ACC_MAIN_HOME;
  process.env.CODEX_ACC_ROOT = root;
  process.env.CODEX_ACC_MAIN_HOME = main;
  try {
    const probe = spawnSync(process.execPath, ['-e', `
      const fs = require('fs');
      const spawn = require('child_process');
      let sideEffects = 0;
      fs.mkdirSync = fs.writeFileSync = fs.readSync = spawn.spawn = () => {
        sideEffects++;
        throw new Error('Unexpected runtime side effect');
      };
      const originalRead = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        if (String(file) !== ${JSON.stringify(statusline)}) {
          sideEffects++;
          throw new Error('Unexpected runtime read');
        }
        return originalRead.call(this, file, ...args);
      };
      const exported = require(${JSON.stringify(statusline)});
      if (typeof exported.codexHome !== 'function') throw new Error('codexHome export missing');
      if (sideEffects !== 0) throw new Error('Requiring statusline triggered runtime side effects');
    `], { encoding: 'utf8', env: process.env });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout, '');
    assert.equal(probe.stderr, '');

    const { codexHome } = require(statusline);
    assert.equal(codexHome(), main, 'missing active file uses main');
    fs.writeFileSync(path.join(root, 'active'), 'main\n');
    assert.equal(codexHome(), main, 'main uses main override');
    fs.mkdirSync(path.join(root, 'work2'));
    fs.writeFileSync(path.join(root, 'active'), 'work2\n');
    assert.equal(codexHome(), path.join(root, 'work2'), 'existing account resolves');
    fs.writeFileSync(path.join(root, 'active'), 'missing');
    assert.equal(codexHome(), main, 'missing account falls back');
    for (const garbage of ['', '../main', 'WORK', 'bad name', 'a'.repeat(33), 'work2\nmain']) {
      fs.writeFileSync(path.join(root, 'active'), garbage);
      assert.equal(codexHome(), main, `invalid account ${JSON.stringify(garbage)} falls back`);
    }
    fs.writeFileSync(path.join(root, 'file-account'), 'not a directory');
    fs.writeFileSync(path.join(root, 'active'), 'file-account');
    assert.equal(codexHome(), main, 'a file is not an account directory');
  } finally {
    if (previousRoot === undefined) delete process.env.CODEX_ACC_ROOT;
    else process.env.CODEX_ACC_ROOT = previousRoot;
    if (previousMain === undefined) delete process.env.CODEX_ACC_MAIN_HOME;
    else process.env.CODEX_ACC_MAIN_HOME = previousMain;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
