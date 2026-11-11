/* Intent: project untrusted transcript records into whitelisted numeric facts.
 * Status: Claude, Codex, dispatcher and review formats implemented. v5: project is the git
 *   repository (nearest .git above the folder, or the Codex remote URL name); branch is stored.
 * Next: add explicit projections for future formats. Blockers: none.
 * Confidence: covered by synthetic fixture assertions and raw-byte privacy scan. */
'use strict';
const v = require('./values');
const { repoOf, repoFromUrl } = require('./repo');
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
    if (store.insert('human_turns', { id, session_id: session }).changes) {
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
function quota(store, ts, source, window, used, resets) {
  if (typeof used !== 'number' || !Number.isFinite(used)) return;
  const reset = v.epoch(resets);
  if (reset === null) return;
  store.insert('quota_snapshots', { ts, source: store.intern('source', source),
    window: store.intern('window', window), used_pct: used, resets_at: reset });
}
function codex(store, row, ctx) {
  const p = row.payload;
  if (!p || typeof p !== 'object') return;
  const ts = v.epoch(row.timestamp, ctx.ts);
  if (row.type === 'session_meta') {
    ctx.session = v.name(p.id) || v.name(p.session_id);
    if (!ctx.session) return;
    // The remote URL names the repo even when Codex ran in a subfolder; only its last segment is kept.
    store.insert('codex_sessions', { session_id: ctx.session,
      project: store.intern('project', repoFromUrl(p.git?.repository_url) ?? repoOf(p.cwd)),
      branch: store.intern('branch', v.name(p.git?.branch)),
      model: store.intern('model', 'unknown'), thread_source: store.intern('thread_source', p.thread_source),
      parent_thread_id: v.name(p.parent_thread_id), started: v.epoch(p.timestamp, ts), day: v.day(ts) },
    '(session_id) DO UPDATE SET project=excluded.project, branch=COALESCE(excluded.branch,branch)');
    return;
  }
  if (!ctx.session) return;
  const old = store.get('SELECT * FROM codex_sessions WHERE session_id=?', ctx.session);
  if (!old) return;
  if (row.type === 'turn_context') {
    store.run(`UPDATE codex_sessions SET model=?, effort=?, project=COALESCE(project,?) WHERE session_id=?`,
      store.intern('model', p.model || 'unknown'), store.intern('effort', p.effort || p.reasoning_effort),
      store.intern('project', repoOf(p.cwd)), ctx.session);
    store.touch(old.day);
  } else if (row.type === 'event_msg') {
    if (p.type === 'token_count') {
      const u = p.info?.total_token_usage;
      // These are cumulative counters: source order wins, including corrections
      // that lower a previous value. The cursor preserves that order across runs.
      if (u) {
        // Guard: a snapshot older than the stored one (e.g. an older rollout file of the same
        // session replayed later) never overwrites it. Equal times keep source-order corrections.
        store.run(`UPDATE codex_sessions SET input=?,output=?,cache_read=?,cache_write=?,reasoning=?,
          total_tokens=?,context_window=?,token_ts=?,day=? WHERE session_id=? AND (token_ts IS NULL OR token_ts<=?)`,
        v.integer(u.input_tokens), v.integer(u.output_tokens), v.integer(u.cached_input_tokens),
        v.integer(u.cache_write_input_tokens), v.integer(u.reasoning_output_tokens), v.integer(u.total_tokens),
        v.integer(p.info.model_context_window, null), ts, v.day(ts), ctx.session, ts);
        store.touch(old.day); store.touch(v.day(ts));
      }
      for (const window of ['primary', 'secondary']) {
        const limit = p.rate_limits?.[window];
        if (limit) quota(store, ts, 'codex', window, limit.used_percent, limit.resets_at);
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
function review(store, row, ctx) {
  const counts = [0, 0, 0, 0];
  for (const finding of Array.isArray(row.findings) ? row.findings : []) {
    if (/^P[0-3]$/.test(finding?.severity)) counts[Number(finding.severity[1])]++;
  }
  store.insert('reviews', { id: ctx.id, ts: v.epoch(row.utc, ctx.ts), project: store.intern('project', repoOf(row.dir)),
    model: store.intern('model', row.model), effort: store.intern('effort', row.effort),
    verdict: store.intern('status', ['PASS', 'FAIL', 'UNKNOWN'].includes(row.verdict) ? row.verdict : 'UNKNOWN'),
    p0: counts[0], p1: counts[1], p2: counts[2], p3: counts[3] }, '(id) DO UPDATE SET project=excluded.project');
}
function dispatch(store, text, ctx) {
  const parts = text.split('|');
  if (parts.length < 4 || !/^\d+$/.test(parts[0])) return false;
  store.insert('dispatches', { id: ctx.id, ts: Number(parts[0]), kind: store.intern('dispatch_kind', parts[1]),
    model: store.intern('model', parts[2] || 'unknown'), effort: store.intern('effort', parts[3]),
    claude_session_id: v.name(parts[4]) });
  return true;
}
function ledger(store, text, ctx) {
  const parts = text.split('|');
  if (parts.length < 7 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) return false;
  const note = parts.slice(6).join('|');
  const model = [...note.matchAll(/gpt-[\w.-]+|claude-[\w.-]+|opus|fable|sol|astra|luna/gi)].at(-1)?.[0];
  const parsed = parts.slice(3, 6).map(s => /^[+-]?\d+$/.test(s.trim()) && Number.isSafeInteger(Number(s)) ? Number(s) : null);
  store.insert('ledger', { id: ctx.id, day: parts[0], tier: store.intern('tier', parts[1]),
    layer2: /^(?:layer2\s+)?yes$/i.test(parts[2].trim()) ? 1 : 0,
    l1_raw: parts[3], l2_raw: parts[4], l3_raw: parts[5], l1_count: parsed[0], l2_count: parsed[1],
    l3_count: parsed[2], note: note.slice(0, 200), model: store.intern('model', model) });
  return true;
}
module.exports = { claude, codex, review, dispatch, ledger, quota };
