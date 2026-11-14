/* Intent: project untrusted transcript records into whitelisted numeric facts.
 * Status: Claude, Codex, dispatcher and review formats implemented. v5: project is the git
 *   repository (nearest .git above the folder, or the Codex remote URL name); branch is stored.
 * Next: add explicit projections for future formats. Blockers: none.
 * Confidence: covered by synthetic fixture assertions and raw-byte privacy scan. */
'use strict';
const v = require('./values');
const { repoOf, repoFromUrl } = require('./repo');
const { parseLedger } = require('./ledger');
// v7: a user row is a human turn only when its text is more than harness tags. These tags are
// written by Claude Code itself (task notifications, slash-command echoes, reminders, local shell).
const HARNESS_TAG = /<(task-notification|command-(?:name|message|args)|system-reminder|local-command-[a-z]+|bash-[a-z]+)\b[^>]*>[\s\S]*?<\/\1>/g;
function tagOnly(text) { return text.trim() !== '' && text.replace(HARNESS_TAG, '').trim() === ''; }
const ROLLOUT_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const TOKEN_FIELDS = [['input', 'input_tokens'], ['output', 'output_tokens'], ['cache_read', 'cached_input_tokens'],
  ['cache_write', 'cache_write_input_tokens'], ['reasoning', 'reasoning_output_tokens'], ['total_tokens', 'total_tokens']];
function claude(store, row, ctx) {
  if (!['assistant', 'user', 'attachment', 'system'].includes(row.type)) return;
  const session = v.name(row.sessionId) || ctx.fallback;
  const ts = v.epoch(row.timestamp, ctx.ts);
  const day = v.day(ts);
  const project = store.intern('project', repoOf(row.cwd));
  const branch = store.intern('branch', v.name(row.gitBranch));
  // branch_ts = time of the line that set the branch, so the newest line carrying a branch wins
  // in any ingest order (a replay sees `ended` already at its maximum). SET sees pre-update values.
  store.run(`INSERT INTO claude_sessions(session_id,project,started,ended,branch,branch_ts) VALUES (?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET project=COALESCE(excluded.project,project),
    started=MIN(started,excluded.started), ended=MAX(ended,excluded.ended),
    branch=CASE WHEN excluded.branch IS NOT NULL AND (branch_ts IS NULL OR excluded.branch_ts>=branch_ts) THEN excluded.branch ELSE branch END,
    branch_ts=CASE WHEN excluded.branch IS NOT NULL AND (branch_ts IS NULL OR excluded.branch_ts>=branch_ts) THEN excluded.branch_ts ELSE branch_ts END`,
  session, project, ts, ts, branch, branch === null ? null : ts);
  if (row.type === 'assistant' && v.name(row.message?.id)) {
    const m = row.message;
    const model = store.intern('model', m.model || 'unknown');
    store.run('UPDATE claude_sessions SET model=? WHERE session_id=?', model, session);
    store.message({ message_id: m.id, session_id: session, ts, day, model,
      effort: store.intern('effort', row.effort), ...v.tokens(m.usage || {}) });
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (block?.type !== 'tool_use' || !v.name(block.id) || !v.name(block.name)) continue;
      const mcp = /^mcp__(.+?)__/.exec(block.name)?.[1];
      store.event('tool_calls', { tool_use_id: block.id, session_id: session, ts, day,
        tool: store.intern('tool', block.name), mcp_server: store.intern('mcp_server', mcp),
        skill: store.intern('skill', block.name === 'Skill' ? block.input?.skill : null),
        subagent: store.intern('subagent', block.name === 'Agent' ? block.input?.subagent_type : null)
      }, 'tool_use_id', 'tool');
    }
  } else if (row.type === 'user' && typeof row.message?.content === 'string' &&
    !row.isMeta && !row.isCompactSummary && !row.isVisibleInTranscriptOnly) {
    const id = row.uuid ? v.hash(`human:${row.uuid}`) : ctx.id;
    // v7: sub-agent prompts (isSidechain or a subagents/ transcript) and tag-only rows are not
    // Line's turns. A replay removes such a row counted by an older version, so turns never double.
    if (row.isSidechain === true || ctx.subagent || tagOnly(row.message.content)) {
      if (store.run('DELETE FROM human_turns WHERE id=?', id).changes) {
        store.run('UPDATE claude_sessions SET turns=MAX(turns-1,0) WHERE session_id=?', session);
      }
    } else if (store.insert('human_turns', { id, session_id: session }).changes) {
      store.run('UPDATE claude_sessions SET turns=turns+1 WHERE session_id=?', session);
    }
  } else if (row.type === 'attachment' && typeof row.attachment?.type === 'string' && row.attachment.type.startsWith('hook_')) {
    const a = row.attachment;
    store.event('hook_events', { id: row.uuid ? v.hash(`hook:${row.uuid}`) : ctx.id,
      session_id: session, ts, day, script: store.intern('script', v.script(a.command)),
      event: store.intern('event', a.hookEvent || a.hookName || 'unknown'),
      status: store.intern('status', a.timedOut === true ? 'timeout' : a.type.slice(5)),
      duration_ms: Math.max(0, v.integer(a.durationMs)), exit_code: v.integer(a.exitCode, null)
    }, 'id', 'hook');
  } else if (row.type === 'system' && row.subtype === 'compact_boundary') {
    const c = row.compactMetadata || {};
    store.insert('compactions', { id: row.uuid ? v.hash(`compact:${row.uuid}`) : ctx.id,
      session_id: session, ts, trigger: store.intern('trigger', c.trigger), pre_tokens: v.integer(c.preTokens),
      post_tokens: v.integer(c.postTokens), duration_ms: v.integer(c.durationMs) });
  }
}
// v7: account 0 = no account split (Claude); Codex snapshots carry the interned account name.
// v8: window_secs = the window length (Codex sends window_minutes; Claude windows are fixed by name).
const CLAUDE_WINDOW_SECS = { five_hour: 5 * 3600, seven_day: 7 * 86400 };
function quota(store, ts, source, window, used, resets, account = null, windowSecs = null) {
  if (typeof used !== 'number' || !Number.isFinite(used)) return;
  const reset = v.epoch(resets);
  if (reset === null) return;
  const secs = Number.isSafeInteger(windowSecs) && windowSecs > 0 ? windowSecs : CLAUDE_WINDOW_SECS[window] ?? null;
  store.insert('quota_snapshots', { ts, source: store.intern('source', source),
    window: store.intern('window', window), used_pct: used, resets_at: reset,
    account: account === null ? 0 : store.intern('account', account), window_secs: secs });
}
function codex(store, row, ctx) {
  const p = row.payload;
  if (!p || typeof p !== 'object') return;
  const ts = v.epoch(row.timestamp, ctx.ts);
  if (row.type === 'session_meta') {
    // v7: a rollout belongs to its FIRST session_meta (its own thread). A forked sub-agent rollout
    // repeats its parent's session_meta after its own; that copy never rebinds the file.
    if (ctx.session) return;
    ctx.session = v.name(p.id) || v.name(p.session_id) || ROLLOUT_ID.exec(ctx.fallback || '')?.[1] || null;
    if (!ctx.session) return;
    // A v7 replay restarts this thread's counters from zero, so per-day deltas are rebuilt exactly once.
    if (store.run('DELETE FROM codex_reseed WHERE session_id=?', ctx.session).changes) {
      for (const d of store.all('SELECT day FROM codex_days WHERE session_id=?', ctx.session)) store.touch(d.day);
      store.run('DELETE FROM codex_days WHERE session_id=?', ctx.session);
      store.run(`UPDATE codex_sessions SET input=0,output=0,cache_read=0,cache_write=0,reasoning=0,total_tokens=0,
        token_ts=NULL WHERE session_id=?`, ctx.session);
    }
    // The remote URL names the repo even when Codex ran in a subfolder; only its last segment is kept.
    store.insert('codex_sessions', { session_id: ctx.session,
      project: store.intern('project', repoFromUrl(p.git?.repository_url) ?? repoOf(p.cwd)),
      branch: store.intern('branch', v.name(p.git?.branch)),
      model: store.intern('model', 'unknown'), thread_source: store.intern('thread_source', p.thread_source),
      parent_thread_id: v.name(p.parent_thread_id), started: v.epoch(p.timestamp, ts), day: v.day(ts),
      account: store.intern('account', ctx.account || 'default') },
    '(session_id) DO UPDATE SET project=excluded.project, branch=COALESCE(excluded.branch,branch), account=excluded.account');
    return;
  }
  if (!ctx.session) return;
  const old = store.get('SELECT * FROM codex_sessions WHERE session_id=?', ctx.session);
  if (!old) return;
  if (row.type === 'turn_context') {
    const model = store.intern('model', p.model || 'unknown');
    store.run(`UPDATE codex_sessions SET model=?, effort=?, project=COALESCE(project,?) WHERE session_id=?`,
      model, store.intern('effort', p.effort || p.reasoning_effort),
      store.intern('project', repoOf(p.cwd)), ctx.session);
    store.touch(old.day);
    // Every day that holds tokens of this thread is re-aggregated under the new model.
    if (model !== old.model) store.run('INSERT OR IGNORE INTO dirty_days SELECT day FROM codex_days WHERE session_id=?', ctx.session);
  } else if (row.type === 'event_msg') {
    if (p.type === 'token_count') {
      const u = p.info?.total_token_usage;
      // These are cumulative counters: source order wins, including corrections
      // that lower a previous value. The cursor preserves that order across runs.
      // Guard: a snapshot older than the stored one (e.g. an older rollout file of the same
      // session replayed later) never overwrites it. Equal times keep source-order corrections.
      if (u && (old.token_ts === null || old.token_ts <= ts)) {
        const next = TOKEN_FIELDS.map(([, key]) => v.integer(u[key]));
        store.run(`UPDATE codex_sessions SET input=?,output=?,cache_read=?,cache_write=?,reasoning=?,
          total_tokens=?,context_window=?,token_ts=?,day=? WHERE session_id=?`,
        ...next, v.integer(p.info.model_context_window, null), ts, v.day(ts), ctx.session);
        // v7: the change since the previous snapshot is spent on this snapshot's local day, so a
        // thread that runs past midnight is split across days. A counter that drops is a reset, not
        // negative spending: that change is clamped to 0 (the thread row still keeps the latest snapshot,
        // so after a reset the days can add up to more than the last cumulative total).
        // Why the clamp stays (S3 review item 16, 2026-11-13): token_count counters only fall when Codex
        // restarts a thread's counting (resume into a new process, compaction rebuild). The tokens spent
        // before the drop were already booked as earlier positive deltas, so a negative delta would
        // subtract real spending; and the spending after the drop shows up as positive deltas again.
        const delta = TOKEN_FIELDS.map(([column], i) => Math.max(0, next[i] - old[column]));
        if (delta.some(Boolean)) {
          store.run(`INSERT INTO codex_days (session_id,day,input,output,cache_read,cache_write,reasoning,total_tokens)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,day) DO UPDATE SET input=input+excluded.input,
            output=output+excluded.output, cache_read=cache_read+excluded.cache_read, cache_write=cache_write+excluded.cache_write,
            reasoning=reasoning+excluded.reasoning, total_tokens=total_tokens+excluded.total_tokens`, ctx.session, v.day(ts), ...delta);
        }
        store.touch(old.day); store.touch(v.day(ts));
      }
      for (const window of ['primary', 'secondary']) {
        const limit = p.rate_limits?.[window];
        if (limit) quota(store, ts, 'codex', window, limit.used_percent, limit.resets_at, ctx.account || 'default',
          Number.isSafeInteger(limit.window_minutes) ? limit.window_minutes * 60 : null);
      }
    } else if (p.type === 'task_started') {
      store.run('UPDATE codex_sessions SET started=MIN(started,?), ended=NULL WHERE session_id=?',
        v.epoch(p.started_at, ts), ctx.session);
    } else if (p.type === 'task_complete') {
      store.run(`UPDATE codex_sessions SET ended=?,duration_ms=?,time_to_first_token_ms=? WHERE session_id=?`,
        v.epoch(p.completed_at, ts), v.integer(p.duration_ms, null), v.integer(p.time_to_first_token_ms, null), ctx.session);
    }
  }
}
/* Intent: persist review mode on first ingest and replay. Status: v10.
 * Next: host replay. Blockers: none. Confidence: v10 and large-record ingestion fixtures. */
function review(store, row, ctx) {
  const counts = [0, 0, 0, 0];
  for (const finding of Array.isArray(row.findings) ? row.findings : []) {
    if (/^P[0-3]$/.test(finding?.severity)) counts[Number(finding.severity[1])]++;
  }
  store.insert('reviews', { id: ctx.id, ts: v.epoch(row.utc, ctx.ts), project: store.intern('project', repoOf(row.dir)),
    model: store.intern('model', row.model), effort: store.intern('effort', row.effort), mode: typeof row.mode === 'string' ? row.mode : null,
    verdict: store.intern('status', ['PASS', 'FAIL', 'UNKNOWN'].includes(row.verdict) ? row.verdict : 'UNKNOWN'),
    p0: counts[0], p1: counts[1], p2: counts[2], p3: counts[3] }, '(id) DO UPDATE SET project=excluded.project, mode=excluded.mode');
}
function dispatch(store, text, ctx) {
  const parts = text.split('|');
  if (parts.length < 4 || !/^\d+$/.test(parts[0])) return false;
  store.insert('dispatches', { id: ctx.id, ts: Number(parts[0]), kind: store.intern('dispatch_kind', parts[1]),
    model: store.intern('model', parts[2] || 'unknown'), effort: store.intern('effort', parts[3]),
    claude_session_id: v.name(parts[4]) });
  return true;
}
// v7: parsing lives in ledger.js. A line that is not a row (comment, bad date) or a row parsed with a
// fallback (six fields) adds one to meta.ledger_warnings instead of disappearing; the cells and the
// note are only stored for real rows. Upsert: a replay refreshes every parsed column.
/* Intent: persist the shared evidence result and raw field 3 on replay. Status: v10.
 * Next: host replay. Blockers: none. Confidence: tests/v10.test.js. */
function ledger(store, text, ctx) {
  const parsed = parseLedger(text);
  if (!parsed) return true;
  if (parsed.warning) store.addMeta('ledger_warnings', 1);
  const r = parsed.row;
  if (!r) return true;
  const record = { id: ctx.id, day: r.day, tier: store.intern('tier', r.tier), layer2: r.layer2, layer2_raw: r.layer2_raw,
    l1_raw: r.l1_raw, l2_raw: r.l2_raw, l3_raw: r.l3_raw, l1_count: r.l1_count, l2_count: r.l2_count,
    l3_count: r.l3_count, note: r.note, model: store.intern('model', r.model),
    task_type: store.intern('task_type', r.task_type), fail_rounds: r.fail_rounds, warning: store.intern('ledger_warning', parsed.warning),
    stop: r.stop };
  const keys = Object.keys(record).filter(k => k !== 'id');
  store.insert('ledger', record, `(id) DO UPDATE SET ${keys.map(k => `${k}=excluded.${k}`).join(',')}`);
  // v8: runs= links this task to its codex-do runs. A replay rewrites the same set.
  store.run('DELETE FROM ledger_runs WHERE ledger_id=?', ctx.id);
  for (const run of r.runs || []) store.run('INSERT OR IGNORE INTO ledger_runs VALUES (?,?)', ctx.id, run);
  return true;
}
/* v8 system sampler line (collector/sample-system.js), one JSON object per minute:
 * { ts, ram: { free, total } (MB), commit: { used, limit } (MB) | null, drives: [{ d, free, total }] (bytes),
 *   top: [[name, MB, count]], kills?: [{ ts, top: [name] }], folders?: { label: { bytes, drive } } }
 * Only process names, drive letters and the eight fixed folder labels are kept. */
const FOLDERS = new Set(['claude_projects', 'codex_sessions', 'codex_total', 'claude_runs', 'temp_claude', 'line_hub', 'wsl_vhdx', 'docker_vhdx']);
const PROCESS = /^[\w .()+@#-]{1,64}$/;
const DRIVE = /^[A-Z]:$/;
const mb = x => (Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
function system(store, row) {
  const ts = Number.isSafeInteger(row.ts) && row.ts > 0 ? row.ts : null;
  if (ts === null) { store.addMeta('parse_errors', 1); return; }
  const day = v.day(ts);
  if (row.ram && typeof row.ram === 'object') {
    const drives = (Array.isArray(row.drives) ? row.drives : [])
      .filter(x => DRIVE.test(x?.d) && Number.isFinite(x.free) && Number.isFinite(x.total) && x.total > 0)
      .map(x => ({ d: x.d, free: Math.max(0, Math.round(x.free)), total: Math.round(x.total) }));
    const top = (Array.isArray(row.top) ? row.top : [])
      .filter(x => Array.isArray(x) && PROCESS.test(x[0]) && Number.isFinite(x[1])).slice(0, 8)
      .map(x => [x[0], Math.round(x[1]), Number.isSafeInteger(x[2]) ? x[2] : 1]);
    store.run(`INSERT INTO system_samples VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ts) DO NOTHING`, ts, day,
      mb(row.ram.free), mb(row.ram.total), mb(row.commit?.used), mb(row.commit?.limit), JSON.stringify(drives), JSON.stringify(top));
    store.touch(day);
  }
  for (const kill of Array.isArray(row.kills) ? row.kills : []) {
    const kts = Number.isSafeInteger(kill?.ts) && kill.ts > 0 ? kill.ts : null;
    if (kts === null) continue;
    const names = (Array.isArray(kill.top) ? kill.top : []).filter(x => PROCESS.test(x)).slice(0, 5);
    store.run('INSERT OR IGNORE INTO memory_kills VALUES (?,?,?,?)', v.hash(`kill:${kts}:${names.join(',')}`), kts, v.day(kts), JSON.stringify(names));
  }
  if (row.folders && typeof row.folders === 'object') {
    for (const [label, f] of Object.entries(row.folders)) {
      if (!FOLDERS.has(label) || !Number.isFinite(f?.bytes) || f.bytes < 0) continue;
      store.run(`INSERT INTO system_daily VALUES (?,?,?,?,?) ON CONFLICT(day,metric,subject) DO UPDATE SET value=excluded.value, drive=excluded.drive`,
        day, 'folder_bytes', label, Math.round(f.bytes), DRIVE.test(f.drive) ? f.drive : null);
    }
  }
}
module.exports = { claude, codex, review, dispatch, ledger, quota, system, FOLDERS };
