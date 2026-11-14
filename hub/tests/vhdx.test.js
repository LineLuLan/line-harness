/* Intent: tests for the WSL / Docker .vhdx watch: the two sampler folder entries (with the LOCALAPPDATA
 *   override and fallbacks) and the "Do this now" vhdx rule (fires over RULES.vhdxGB GiB, silent under it,
 *   loses to a firing disk rule, keeps the folder-fill rule first, picks the biggest disk).
 * Status: synthetic inputs only, no real .vhdx is touched. Next: none. Blockers: none. Confidence: these tests. */
'use strict';
require('./ontology-setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const s = require('../collector/sample-system');
const q = require('../server/queries');

const GiB = 2 ** 30;
// Labels as folders() in queries.js gives them (FOLDER_LABEL is not exported).
const LABEL = { wsl_vhdx: 'WSL disk (Ubuntu .vhdx)', docker_vhdx: 'Docker disk (.vhdx)', claude_projects: '~/.claude/projects' };
const disk = (key, gib) => ({ key, label: LABEL[key], bytes: gib * GiB, drive: 'C:', growthPerDay: null, daysToFull: null });

test('config: wsl_vhdx and docker_vhdx come after the six existing folders', () => {
  const local = path.join(os.tmpdir(), 'fake-local');
  const cfg = s.config({ LINE_HUB_LOCALAPPDATA: local, LOCALAPPDATA: path.join(os.tmpdir(), 'ignored') });
  assert.deepEqual(cfg.folders.map(f => f.label),
    ['claude_projects', 'codex_sessions', 'codex_total', 'claude_runs', 'temp_claude', 'line_hub', 'wsl_vhdx', 'docker_vhdx']);
  assert.equal(cfg.folders[6].dir, path.join(local, 'wsl'));
  assert.equal(cfg.folders[7].dir, path.join(local, 'Docker', 'wsl', 'disk'));
});

test('config: LOCALAPPDATA, then the home folder, when no override is set', () => {
  const local = path.join(os.tmpdir(), 'env-local');
  assert.equal(s.config({ LOCALAPPDATA: local }).folders.find(f => f.label === 'wsl_vhdx').dir, path.join(local, 'wsl'));
  assert.equal(s.config({}).folders.find(f => f.label === 'docker_vhdx').dir, path.join(os.homedir(), 'AppData', 'Local', 'Docker', 'wsl', 'disk'));
});

test('RULES has the vhdx threshold; folders() labels the two disks', () => {
  assert.equal(q.RULES.vhdxGB, 80);
  const now = Math.floor(Date.now() / 1000);
  const today = s.localDay(Date.now());
  const rows = [{ day: today, subject: 'wsl_vhdx', value: 85 * GiB, drive: 'C:' }, { day: today, subject: 'docker_vhdx', value: 91 * GiB, drive: 'C:' }];
  // Minimal stand-in for the SQLite handle: hasTable() gets a row, the folder query gets the rows above.
  const db = { prepare: () => ({ get: () => ({ 1: 1 }), all: () => rows }) };
  const list = q.folders(db, now, [{ d: 'C:', free: 1e11, total: 5e11 }]);
  assert.deepEqual(list.map(f => [f.key, f.label]), [['docker_vhdx', 'Docker disk (.vhdx)'], ['wsl_vhdx', 'WSL disk (Ubuntu .vhdx)']]);
  assert.equal(q.actionBox({ folders: list }).text, `Docker disk (.vhdx) is 97.7 GB.`);
});

test('actionBox: vhdx rule fires at 81 GiB and is silent at 79 GiB', () => {
  const fired = q.actionBox({ folders: [disk('wsl_vhdx', 81)] });
  assert.equal(fired.rule, 'c'); assert.equal(fired.level, 'warn'); assert.equal(fired.href, 'system');
  assert.equal(fired.action, 'Run harness-cleanup.ps1 -Vhdx and follow its steps.');
  assert.match(fired.text, /^WSL disk \(Ubuntu \.vhdx\) is 87 GB\.$/);
  assert.equal(q.actionBox({ folders: [disk('wsl_vhdx', 79)] }).rule, null);
  // Only keys ending in _vhdx count: a big normal folder does not fire this rule.
  assert.equal(q.actionBox({ folders: [disk('claude_projects', 100)] }).rule, null);
});

test('actionBox: the biggest vhdx wins', () => {
  const box = q.actionBox({ folders: [disk('wsl_vhdx', 85), disk('docker_vhdx', 91)] });
  assert.match(box.text, /^Docker disk \(\.vhdx\) is /);
});

test('actionBox: the disk rule, the fill rule and rules a / b keep priority', () => {
  const folders = [disk('wsl_vhdx', 85)];
  const diskBox = q.actionBox({ drives: [{ d: 'C:', freePct: 5, free: 1e10, total: 2e11 }], folders });
  assert.equal(diskBox.level, 'bad'); assert.match(diskBox.text, /^Drive C: has only 5% free\.$/);
  const fill = { key: 'temp_claude', label: '%TEMP%/claude', bytes: 5e9, drive: 'C:', growthPerDay: 1e9, daysToFull: 3 };
  assert.match(q.actionBox({ folders: [...folders, fill] }).text, /grows/);
  assert.equal(q.actionBox({ ram: { freePct: 5, commitPct: 50 }, folders }).rule, 'c');
  // The vhdx rule comes before rule d.
  assert.equal(q.actionBox({ folders, clean: { now: 40, prev: 70, nNow: 5, nPrev: 5 } }).rule, 'c');
});
