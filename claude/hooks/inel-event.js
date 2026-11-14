// inel attention hook (approved by Line 2026-11-12: Notification + Stop, then UserPromptSubmit,
// PostToolUse, PostToolUseFailure, then SessionEnd; inel PLAN.md section 10).
// Intent: tell inel when a Claude session needs Line and when Line has answered.
// Design v3 (after wave 3 review round 3): APPEND-ONLY. Each event is its own file
//   %LOCALAPPDATA%\inel\events\<session_id>--<order_us>-<pid>.json
// written to a temp name and renamed to a unique name: no lock, nothing is ever overwritten.
// inel takes, per session, the record with the largest (order_us, pid).
// order_us = when Claude Code SPAWNED this hook (spawns follow event order), in microseconds.
// Fields: v, session_id, kind, time_ms, order_us, notification_type (enum), task/cron counts.
// Never prompt text, message text, tool names or tool input.
// Fails silent: a broken hook must never disturb Claude Code.
'use strict';
const fs = require('fs');
const path = require('path');

const KINDS = {
  Notification: 'notification',
  Stop: 'stop',
  UserPromptSubmit: 'prompt',
  PostToolUse: 'tool',
  PostToolUseFailure: 'tool',
  SessionEnd: 'end',
};
// Notification types that mean "Line must act" vs "Line just answered" (Claude Code docs, 2026-11-12).
const NEEDS_YOU = new Set([
  'permission_prompt', 'idle_prompt', 'elicitation_dialog', 'elicitation_url_dialog',
  'agent_needs_input', 'quota_auto_resume_stale', 'quota_auto_resume_disabled',
]);
const ANSWERED = new Set(['elicitation_response', 'elicitation_complete']);
const KEEP_PER_SESSION = 8;            // older records of a session beyond this are pruned
const MAX_AGE_MS = 24 * 3600 * 1000;   // any record older than this is pruned
const RECORD = /^([0-9a-f-]{8,64})--(\d{13,20})-(\d{1,10})\.json$/;

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Publish with retries for up to ~3 s; the final name is unique, so no reader ever sees a partial file.
function publish(dir, name, body) {
  const tmp = path.join(dir, `.${name}.tmp`);
  for (let i = 0; i < 12; i++) {
    try {
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, path.join(dir, name));
      return true;
    } catch { sleep(25 * (i + 1)); }
  }
  try { fs.unlinkSync(tmp); } catch {}
  return false;
}

function prune(dir, sid) {
  const now = Date.now();
  const mine = [];
  const others = new Map(); // other session id -> its records
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      const m = RECORD.exec(f);
      if (m) {
        const r = { f: full, order: BigInt(m[2]), pid: Number(m[3]) };
        if (m[1] === sid) mine.push(r);
        else { if (!others.has(m[1])) others.set(m[1], []); others.get(m[1]).push(r); }
      } else if (/^\d{13}-\d+\.json$/.test(f) || /^[0-9a-f-]{8,64}\.json$/.test(f) || /\.lock$/.test(f)
                 || (f.startsWith('.') && f.endsWith('.tmp'))) {
        // v1/v2 leftovers and stray temps (older than a minute, so never an in-flight write).
        if (now - fs.statSync(full).mtimeMs > 60 * 1000) fs.unlinkSync(full);
      }
    } catch { /* raced with another hook */ }
  }
  const newestFirst = (a, b) => (a.order === b.order ? b.pid - a.pid : (a.order > b.order ? -1 : 1));
  // Only ever delete OLDER records of this session; the newest KEEP_PER_SESSION stay.
  mine.sort(newestFirst);
  for (const r of mine.slice(KEEP_PER_SESSION)) { try { fs.unlinkSync(r.f); } catch {} }
  // Other sessions: never delete a live session's newest record. A whole session goes only when
  // EVERY record of it is older than 24 h; otherwise only its expired non-newest records go.
  for (const recs of others.values()) {
    recs.sort(newestFirst);
    let ages;
    try { ages = recs.map((r) => now - fs.statSync(r.f).mtimeMs); } catch { continue; }
    const allExpired = ages.every((a) => a > MAX_AGE_MS);
    recs.forEach((r, i) => {
      if (allExpired || (i > 0 && ages[i] > MAX_AGE_MS)) { try { fs.unlinkSync(r.f); } catch {} }
    });
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
// PostToolUse can carry a large tool_response; 64 MiB covers it (beyond that the event is dropped, documented).
process.stdin.on('data', (c) => { raw += c; if (raw.length > 64 << 20) process.exit(0); });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw.replace(/^﻿/, ''));
    const sid = String(input.session_id || '').toLowerCase();
    if (!/^[0-9a-f-]{8,64}$/.test(sid)) return;
    const kind = KINDS[input.hook_event_name];
    if (!kind) return;
    // Subagent tool calls carry the parent's session id; they are not Line answering.
    if (input.agent_id) return;
    const origin = performance.timeOrigin;
    // Known limit: a backward wall-clock step between two events can let the older one win until the
    // session's next event. Not clamped: a hook cannot tell a clock step from a legitimately late hook.
    const order = Math.round(origin * 1000);
    const rec = { v: 3, session_id: sid, kind, time_ms: Math.floor(origin), order_us: order };
    if (kind === 'notification') {
      const nt = String(input.notification_type || '');
      if (ANSWERED.has(nt)) rec.kind = 'answer';
      else if (NEEDS_YOU.has(nt)) rec.notification_type = nt;
      else return; // informational (auth_success, agent_completed, plugin_notification, ...)
    }
    if (kind === 'stop') {
      rec.background_tasks = Array.isArray(input.background_tasks) ? input.background_tasks.length : 0;
      rec.crons = Array.isArray(input.session_crons) ? input.session_crons.length : 0;
    }
    const base = process.env.LOCALAPPDATA;
    if (!base) return;
    const dir = path.join(base, 'inel', 'events');
    fs.mkdirSync(dir, { recursive: true });
    if (publish(dir, `${sid}--${order}-${process.pid}.json`, JSON.stringify(rec))) prune(dir, sid);
  } catch { /* silent by design */ }
});
