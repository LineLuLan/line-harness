/* Intent: measure r2 on r1 large records plus 600 small/medium source files.
 * Status: <90 MiB RSS (v8) and <8 MiB sampled ArrayBuffers gates, with a floor child.
 * Next: compare real-data measurements in supervisor review. Blockers: none.
 * Confidence: child-reported process.resourceUsage().maxRSS, no memory-limit flags. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { environment } = require('../tests/fixtures/synthetic');
const { open } = require('../collector/db');
const scratch = path.resolve(__dirname, '..', '.tmp');
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, 'bench-'));
const env = environment(root);
const MiB = 1024 * 1024;
const timestamp = new Date().toISOString();
const padding = 'synthetic private text '.repeat(400);
let generated = 0;
let expectedSkipped = 0;
const shapes = {};
function track(label) { shapes[label] = (shapes[label] || 0) + 1; }
function generate(file, target, make, initial = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  let size = 0, index = 0;
  function emit(row) {
    if (['api-request', 'api-request-blob', 'compacted', 'response_item'].includes(row.type) ||
      (row.type === 'user' && Array.isArray(row.message?.content)) ||
      (row.type === 'event_msg' && row.payload?.type === 'item_completed')) expectedSkipped++;
    generated++;
    return fs.writeSync(fd, JSON.stringify(row) + '\n');
  }
  try {
    for (const row of initial) size += emit(row);
    while (size < target) {
      size += emit(make(index++));
    }
  } finally { fs.closeSync(fd); }
  return size;
}
function assistant(part, i, large = false) {
  if (large) track('claude_assistant_2MiB');
  return { type: 'assistant', sessionId: `claude-${part}`, timestamp, cwd: '/synthetic/bench-project', effort: 'high',
    message: { id: `${large ? 'large-' : ''}message-${part}-${i}`, model: 'claude-bench',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 25,
        output_tokens_details: { thinking_tokens: 6 } },
      content: [{ type: 'text', text: padding }, { type: 'tool_use', id: `tool-${part}-${i}`,
        name: 'mcp__bench__read', input: { query: large ? 'x'.repeat(2 * MiB) : 'synthetic' } }] } };
}
function claudeRecord(part, i) {
  if (part === 0 && i < 200 && i % 4 === 0) {
    track('claude_user_tool_result_1.5MiB');
    return { type: 'user', sessionId: 'claude-0', timestamp,
      message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(1.5 * MiB) }] } };
  }
  if (part === 0 && [1, 21, 41, 61].includes(i)) {
    track('claude_api_request_blob_3MiB');
    return { type: 'api-request-blob', data: 'x'.repeat(3 * MiB) };
  }
  if ((part === 0 && [3, 23, 43, 63, 83, 103, 123, 143].includes(i)) || (part === 1 && i % 1000 === 3)) {
    return assistant(part, i, true);
  }
  if (i % 20 === 0) return { type: 'api-request', text: padding.repeat(4) };
  if (i % 20 === 1) return { type: 'api-request-blob', text: padding.repeat(8) };
  if (i % 20 === 2) return { type: 'user', message: { content: [{ type: 'tool_result', content: padding }] } };
  if (i % 20 === 3) return { type: 'attachment', timestamp, sessionId: `claude-${part}`, attachment: {
    type: 'hook_success', hookEvent: 'Stop', command: 'node bench-hook.js', exitCode: 0, durationMs: i % 500 } };
  if (i % 20 === 4) return { type: 'user', timestamp, sessionId: `claude-${part}`, message: { content: padding } };
  if (i % 20 === 5) return { type: 'system', subtype: 'compact_boundary', timestamp, sessionId: `claude-${part}`,
    compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 200, durationMs: 30 } };
  return assistant(part, i);
}
function codexRecord(i) {
  if (i === 0) {
    track('codex_custom_tool_call_output_12MiB');
    return { timestamp, type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'x'.repeat(12 * MiB) } };
  }
  if (i === 2 || i === 4) {
    track('codex_compacted_3MiB');
    return { timestamp, type: 'compacted', payload: { text: 'x'.repeat(3 * MiB) } };
  }
  if (i % 4 === 0) return { timestamp, type: 'event_msg', payload: { type: 'item_completed', text: padding.repeat(8) } };
  if (i % 4 === 1) return { timestamp, type: 'response_item', payload: { type: 'custom_tool_call_output', output: padding } };
  if (i % 4 === 2) return { timestamp, type: 'event_msg', payload: { type: 'token_count',
    info: { total_token_usage: { input_tokens: i * 10, output_tokens: i, cached_input_tokens: i * 2,
      reasoning_output_tokens: i, total_tokens: i * 11 } },
    rate_limits: { primary: { used_percent: i % 100, resets_at: 1800000000 } } } };
  return { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${i}`,
    completed_at: Math.floor(Date.now() / 1000), duration_ms: 100, last_agent_message: padding } };
}
try {
  const claudeSizes = [];
  const mtimeBase = Math.floor(Date.now() / 1000) - 1000;
  for (const [part, size] of [[0, 225], [1, 225]]) {
    const file = path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'bench-project', `${part}.jsonl`);
    claudeSizes.push(generate(file, size * MiB, i => claudeRecord(part, i)));
    fs.utimesSync(file, mtimeBase + 100 + part * 200 + 0.5, mtimeBase + 100 + part * 200 + 0.5);
  }
  const codexFile = path.join(env.LINE_HUB_CODEX_DIR, 'sessions', '2026', '11', '09', 'rollout-bench.jsonl');
  const codexSize = generate(codexFile, 150 * MiB,
    codexRecord,
    [{ timestamp, type: 'session_meta', payload: { id: 'codex-bench', cwd: '/synthetic/bench-project', thread_source: 'user' } },
      { timestamp, type: 'turn_context', payload: { model: 'gpt-bench', effort: 'high' } }]);
  fs.utimesSync(codexFile, mtimeBase + 500.5, mtimeBase + 500.5);
  // Interleave large files among 600 independently opened/closed files by mtime.
  // Vary size within 1â€“500 KiB, exercising both sides of the 64 KiB read boundary.
  const smallSizes = [];
  let smallClaudeBytes = 0, smallCodexBytes = 0;
  for (let part = 0; part < 600; part++) {
    const claude = part % 2 === 0;
    const id = `small-${part}`;
    const file = claude
      ? path.join(env.LINE_HUB_CLAUDE_DIR, 'projects', 'bench-project', 'parent', 'subagents', `${id}.jsonl`)
      : path.join(env.LINE_HUB_CODEX_DIR, 'sessions', '2026', '11', '09', `rollout-${id}.jsonl`);
    const size = generate(file, (2 + (part * 43) % 480) * 1024, i => claude
      ? (i % 5 === 0 ? { type: 'api-request', text: padding } : assistant(id, i))
      : (i % 5 === 0 ? { timestamp, type: 'response_item', payload: { type: 'custom_tool_call_output', output: padding } }
        : { timestamp, type: 'event_msg', payload: { type: 'token_count',
          info: { total_token_usage: { input_tokens: i * 10, output_tokens: i, reasoning_output_tokens: i } }, ignored: padding } }),
    claude ? [] : [
      { timestamp, type: 'session_meta', payload: { id, cwd: '/synthetic/bench-project', thread_source: 'user' } },
      { timestamp, type: 'turn_context', payload: { model: 'gpt-bench', effort: 'high' } }
    ]);
    smallSizes.push(size);
    if (claude) smallClaudeBytes += size; else smallCodexBytes += size;
    fs.utimesSync(file, mtimeBase + part, mtimeBase + part);
  }
  const claudeBytes = claudeSizes.reduce((a, b) => a + b, 0);
  if (claudeBytes < 300 * MiB || Math.max(...claudeSizes) < 150 * MiB || codexSize < 50 * MiB ||
    claudeBytes + codexSize < 600 * MiB || shapes.claude_api_request_blob_3MiB < 4 ||
    shapes['claude_user_tool_result_1.5MiB'] < 50 || shapes.codex_custom_tool_call_output_12MiB < 1 ||
    shapes.codex_compacted_3MiB < 2 || shapes.claude_assistant_2MiB < 2) {
    throw new Error('Benchmark generation did not meet required sizes');
  }
  if (smallSizes.length < 600 || smallSizes.some(size => size < 1024 || size > 500 * 1024)) {
    throw new Error('Benchmark generation did not meet the many-files requirement');
  }
  const baseline = spawnSync(process.execPath, [path.resolve(__dirname, 'floor.js'), path.join(root, 'floor', 'hub.db')],
    { env, encoding: 'utf8', maxBuffer: MiB });
  if (baseline.status !== 0) throw new Error(baseline.stderr || 'Floor measurement failed');
  const floor = JSON.parse(baseline.stdout.trim());
  const started = performance.now();
  const child = spawnSync(process.execPath, [path.resolve(__dirname, '../collector/collect.js'), '--full'],
    { env, encoding: 'utf8', maxBuffer: MiB });
  const elapsed = (performance.now() - started) / 1000;
  if (child.status !== 0) throw new Error(child.stderr || 'Collector exited unsuccessfully');
  const metrics = JSON.parse(child.stdout.trim());
  const db = open(env.LINE_HUB_DB);
  let rows = 0;
  try {
    for (const table of ['claude_messages', 'tool_calls', 'hook_events', 'compactions', 'codex_sessions', 'quota_snapshots']) {
      rows += db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    }
    if (rows < 10000) throw new Error('Benchmark did not persist representative event volume');
    if (db.prepare("SELECT COUNT(*) n FROM claude_messages WHERE message_id LIKE 'large-message-%' AND input=100").get().n !== shapes.claude_assistant_2MiB) {
      throw new Error('Needed large records were not ingested');
    }
    if (Number(db.prepare("SELECT value FROM meta WHERE key='skipped_triage'").get().value) !== expectedSkipped) {
      throw new Error('Committed triage count does not match generated records');
    }
  } finally { db.close(); }
  if (metrics.skipped_triage !== expectedSkipped || metrics.skipped_large || metrics.lines !== generated) {
    throw new Error('Unexpected triage result for representative data');
  }
  // v8 (2026-11-13): RSS gate 90 MiB (packet S3: "bench stays < 90 MB"). The v7 code already measured
  // 83-84 MiB on Line's machine (Node 24 floor child alone ~64 MiB), so the old 80 MiB gate failed on v7 too.
  const passed = metrics.max_rss_kb < 90 * 1024 && metrics.sampled_array_buffers_peak < 8 * MiB;
  console.log(JSON.stringify({ claude_bytes: claudeBytes + smallClaudeBytes, largest_claude_bytes: Math.max(...claudeSizes),
    codex_bytes: codexSize + smallCodexBytes, total_bytes: claudeBytes + codexSize + smallClaudeBytes + smallCodexBytes,
    source_files: smallSizes.length + 3, small_files: smallSizes.length,
    smallest_small_file_bytes: Math.min(...smallSizes), largest_small_file_bytes: Math.max(...smallSizes), large_shapes: shapes,
    generated_lines: generated, ingested_lines: metrics.lines, stored_rows: rows,
    skipped_triage: metrics.skipped_triage, skipped_large: metrics.skipped_large || 0,
    json_parsed: metrics.json_parsed, max_buffered_bytes: metrics.max_buffered_bytes,
    sampled_peak: metrics.sampled_peak, sampled_array_buffers_peak: metrics.sampled_array_buffers_peak, floor,
    peak_rss_kb: metrics.max_rss_kb, peak_rss_mb: Number((metrics.max_rss_kb / 1024).toFixed(2)),
    elapsed_seconds: Number(elapsed.toFixed(3)), rows_per_second: Math.round(rows / elapsed),
    lines_per_second: Math.round(metrics.lines / elapsed), passed }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  // This exact directory was created by this process under hub/.tmp.
  if (path.dirname(root) !== scratch || !path.basename(root).startsWith('bench-')) throw new Error('Unexpected cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
}
