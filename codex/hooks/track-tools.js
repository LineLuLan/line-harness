#!/usr/bin/env node
// PostToolUse hook: log Skill + MCP tool usage for the statusline's line 4.
// Appends "epoch|kind|name" to %TEMP%\ultrathink-status\tools-<session_id>.log.
// Must never fail the tool call: everything is wrapped, always exits 0.
const fs = require('fs');
const os = require('os');
const path = require('path');

function withDispatchTrailLock(dir, write) {
  const lockFile = path.join(dir, 'dispatch-trail.lock');
  let fd = null;
  for (let attempt = 0; attempt < 20 && fd == null; attempt++) {
    try {
      fd = fs.openSync(lockFile, 'wx');
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 30_000) fs.unlinkSync(lockFile);
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (fd == null) return;
  try { write(); }
  finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockFile); } catch {}
  }
}
try {
  let raw = '';
  const buf = Buffer.alloc(65536);
  try {
    let n;
    while ((n = fs.readSync(0, buf, 0, buf.length)) > 0) raw += buf.toString('utf8', 0, n);
  } catch {}
  const d = JSON.parse(raw.replace(/^﻿/, '').trim());
  const tool = d.tool_name || '';
  if (tool === 'Agent' && /codex/i.test(String((d.tool_input && d.tool_input.subagent_type) || ''))) {
    const dir = path.join(os.homedir(), '.claude', 'state');
    fs.mkdirSync(dir, { recursive: true });
    withDispatchTrailLock(dir, () => {
      const f = path.join(dir, 'dispatch-trail.log');
      fs.appendFileSync(f, `${Math.floor(Date.now() / 1000)}|rescue|codex-rescue|-\n`);
      const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
      if (lines.length > 200) fs.writeFileSync(f, lines.slice(-200).join('\n') + '\n');
    });
  }
  let kind = '', name = '';
  if (tool === 'Skill') {
    kind = 'skill';
    name = (d.tool_input && d.tool_input.skill) || '';
  } else if (tool.startsWith('mcp__')) {
    kind = 'mcp';
    name = tool.split('__')[1] || '';
  }
  if (kind && name) {
    const dir = path.join(os.tmpdir(), 'ultrathink-status');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `tools-${d.session_id || 'unknown'}.log`);
    fs.appendFileSync(f, `${Math.floor(Date.now() / 1000)}|${kind}|${name}\n`);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    if (lines.length > 100) fs.writeFileSync(f, lines.slice(-50).join('\n') + '\n');
  }
} catch {}
process.exit(0);
