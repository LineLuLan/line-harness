/* Intent: generate exclusively synthetic private-log shapes for Line's tests.
 * Status: acceptance fixtures. Next: extend when upstream shapes change.
 * Blockers: none. Confidence: high; no real logs are used. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MARKER = 'LINEHUB_PRIVATE_MARKER';
const timestamp = new Date().toISOString();
const privatePath = `C:\\${MARKER}\\project-a`;
function assistant(id = 'msg-1', usage = {}, content = []) {
  return { type: 'assistant', sessionId: 'claude-1', timestamp, cwd: privatePath,
    effort: 'high', message: { id, model: 'claude-test', usage, content } };
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
function jsonl(file, rows) { return write(file, rows.map(JSON.stringify).join('\n') + '\n'); }
function environment(root) {
  return { ...process.env, NODE_OPTIONS: '', LINE_HUB_DB: path.join(root, 'db', 'hub.db'),
    LINE_HUB_CLAUDE_DIR: path.join(root, MARKER, 'claude'),
    LINE_HUB_CODEX_DIR: path.join(root, MARKER, 'codex'),
    LINE_HUB_STATE_DIR: path.join(root, MARKER, 'state'),
    LINE_HUB_STATUS_DIR: path.join(root, MARKER, 'status') };
}
function populate(env) {
  const claude = path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'project-a', 'session.jsonl');
  const secret = MARKER.repeat(3);
  jsonl(claude, [
    assistant('msg-1', { input_tokens: 0, iterations: [
      { input_tokens: 2, output_tokens: 9, cache_read_input_tokens: 3, cache_creation_input_tokens: 4,
        output_tokens_details: { thinking_tokens: 5 } },
      { input_tokens: 7, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 }
    ] }, [ { type: 'text', text: secret }, { type: 'thinking', thinking: secret },
      { type: 'tool_use', id: 'tool-1', name: 'mcp__demo__lookup', input: { text: secret } },
      { type: 'tool_use', id: 'tool-2', name: 'Skill', input: { skill: 'test-skill', text: secret } },
      { type: 'tool_use', id: 'tool-3', name: 'Agent', input: { subagent_type: 'test-agent', prompt: secret } } ]),
    assistant('msg-1', { input_tokens: 1, output_tokens: 1 }, [
      { type: 'tool_use', id: 'tool-1', name: 'mcp__demo__lookup', input: { text: secret } } ]),
    ...['success', 'non_blocking_error', 'error_during_execution', 'cancelled', 'other'].map((status, i) => ({
      type: 'attachment', sessionId: 'claude-1', timestamp,
      attachment: { type: `hook_${status}`, hookName: 'Stop', hookEvent: 'Stop',
        command: i === 3 ? `echo ${secret}` : `powershell -File "C:\\${secret}\\check.ps1"`,
        stdout: secret, stderr: secret, content: secret, durationMs: i * 100,
        exitCode: i === 0 ? 0 : 1, timedOut: i === 4 }
    })),
    { type: 'system', subtype: 'compact_boundary', timestamp, sessionId: 'claude-1',
      compactMetadata: { trigger: 'auto', preTokens: 500, postTokens: 50, durationMs: 80 } },
    ...[{}, { isMeta: true }, { isCompactSummary: true }, { isVisibleInTranscriptOnly: true }]
      .map(flags => ({ type: 'user', sessionId: 'claude-1', timestamp, ...flags,
        message: { role: 'user', content: secret } })),
    { type: 'user', sessionId: 'claude-1', message: { content: [{ type: 'tool_result', content: secret }] } },
    { type: 'unknown-new-type', text: secret }
  ]);
  const codex = path.join(env.LINE_HUB_CODEX_DIR, 'sessions', '2026', '11', '09', 'rollout-test.jsonl');
  const token = n => ({ timestamp, type: 'event_msg', payload: { type: 'token_count',
    info: { total_token_usage: { input_tokens: n, output_tokens: n / 2, cached_input_tokens: 2,
      cache_write_input_tokens: 1, reasoning_output_tokens: 3, total_tokens: n * 1.5 }, model_context_window: 100000 },
    rate_limits: { limit_id: 'codex', primary: { used_percent: 58, window_minutes: 10080,
      resets_at: 1794401189 }, secondary: null, plan_type: 'pro' } } });
  jsonl(codex, [
    { type: 'session_meta', timestamp, payload: { id: 'codex-1', cwd: privatePath, timestamp,
      thread_source: 'subagent', parent_thread_id: 'parent-1', base_instructions: secret } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-test', reasoning_effort: 'high', cwd: privatePath } },
    { type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'turn-1', started_at: 1794400000 } },
    token(100), token(200),
    { type: 'event_msg', timestamp, payload: { type: 'task_complete', turn_id: 'turn-1',
      started_at: 1794400000, completed_at: 1794400010, duration_ms: 10000,
      time_to_first_token_ms: 50, last_agent_message: secret } }
  ]);
  const ts = Math.floor(Date.parse(timestamp) / 1000);
  write(path.join(env.LINE_HUB_STATE_DIR, 'dispatch-trail.log'),
    `${ts - 10}|do|gpt-test|high|claude-1\n${ts - 500}|do|gpt-other|low|too-old\n${ts}|review|gpt-test|high\n`);
  for (const [id, model, complete] of [['run-1', 'gpt-test', true], ['run-2', 'gpt-other', false]]) {
    const dir = path.join(env.LINE_HUB_STATE_DIR, 'runs', id);
    write(path.join(dir, 'run.json'), '\uFEFF' + JSON.stringify({ runId: id, dir: privatePath, model,
      effort: 'high', resume: false, startedUtc: timestamp, sandboxFailure: false }));
    if (complete) write(path.join(dir, 'exit.txt'), '0\r\n');
    write(path.join(dir, 'session.txt'), 'codex-1\r\n');
    write(path.join(dir, 'activity.txt'), timestamp);
  }
  write(path.join(env.LINE_HUB_STATE_DIR, 'runs', 'notify.log'), 'ignore');
  write(path.join(env.LINE_HUB_STATE_DIR, 'review-ledger.log'),
    '2026-11-09|Important|yes|2|PASS|n/a|gpt-first then | claude-last\n');
  jsonl(path.join(env.LINE_HUB_STATE_DIR, 'reviews.jsonl'), [{ utc: timestamp, dir: privatePath,
    specFile: secret, model: 'gpt-test', effort: 'high', verdict: 'FAIL', gates: { lint: 'PASS' },
    findings: ['P0', 'P1', 'P1', 'P3'].map(severity => ({ severity, location: secret, title: secret })) }]);
  write(path.join(env.LINE_HUB_STATUS_DIR, 'anthropic-usage.json'), JSON.stringify({
    five_hour: { utilization: 25, resets_at: timestamp }, seven_day: { utilization: 30, resets_at: timestamp },
    ignored: secret }));
  return { claude, codex, token };
}
module.exports = { MARKER, timestamp, assistant, write, jsonl, environment, populate };
