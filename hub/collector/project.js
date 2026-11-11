/* Intent: validate bounded JSON bytes while materializing only metric fields.
 * Status: large-record projection for amendment r1; private strings stay bytes.
 * Next: supervisor review of the field allowlists. Blockers: none.
 * Confidence: projection parity, malformed JSON and escaped-key regression tests. */
'use strict';
const usage = { input_tokens: true, output_tokens: true, cache_read_input_tokens: true,
  cache_creation_input_tokens: true, output_tokens_details: { thinking_tokens: true } };
const limit = { used_percent: true, resets_at: true };
const schemas = {
  claude: { type: true, uuid: true, timestamp: true, sessionId: true, cwd: true, effort: true,
    isMeta: true, isCompactSummary: true, isVisibleInTranscriptOnly: true,
    message: { id: true, model: true, content: [{ type: true, id: true, name: true,
      input: { skill: true, subagent_type: true } }], usage: { ...usage, iterations: [usage] } },
    attachment: { type: true, hookName: true, hookEvent: true, command: true,
      durationMs: true, exitCode: true, timedOut: true },
    subtype: true, compactMetadata: { trigger: true, preTokens: true, postTokens: true, durationMs: true } },
  codex: { type: true, timestamp: true, payload: { id: true, session_id: true, timestamp: true, cwd: true,
    thread_source: true, parent_thread_id: true, model: true, effort: true, reasoning_effort: true,
    type: true, started_at: true, completed_at: true, duration_ms: true, time_to_first_token_ms: true,
    info: { total_token_usage: { input_tokens: true, output_tokens: true, cached_input_tokens: true,
      cache_write_input_tokens: true, reasoning_output_tokens: true, total_tokens: true }, model_context_window: true },
    rate_limits: { primary: limit, secondary: limit } } },
  review: { utc: true, dir: true, model: true, effort: true, verdict: true, findings: [{ severity: true }] }
};
function project(buffer, kind) {
  const fallback = Symbol('deep JSON');
  const schema = schemas[kind];
  if (!schema) return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r$/, '');
  let at = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF ? 3 : 0;
  const output = [];
  const bad = () => { throw new SyntaxError('Invalid JSON record'); };
  const white = byte => byte === 32 || byte === 9 || byte === 10 || byte === 13;
  const digit = byte => byte >= 48 && byte <= 57;
  const hex = byte => digit(byte) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);
  function whitespace() { while (white(buffer[at])) at++; }
  function string() {
    const start = at++;
    while (at < buffer.length) {
      const byte = buffer[at++];
      if (byte === 34) return start;
      if (byte < 32) bad();
      if (byte === 92) {
        const escape = buffer[at++];
        if (escape === 117) {
          for (let i = 0; i < 4; i++) if (!hex(buffer[at++])) bad();
        } else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(escape)) bad();
      }
    }
    bad();
  }
  function key(start) {
    const raw = buffer.toString('utf8', start + 1, at - 1);
    const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    return raw.replace(/\\(u[\da-fA-F]{4}|["\\/bfnrt])/g,
      (_, value) => value[0] === 'u' ? String.fromCharCode(parseInt(value.slice(1), 16)) : escapes[value]);
  }
  function number() {
    if (buffer[at] === 45) at++;
    if (buffer[at] === 48) at++;
    else {
      if (!(buffer[at] >= 49 && buffer[at] <= 57)) bad();
      while (digit(buffer[at])) at++;
    }
    if (buffer[at] === 46) {
      at++; if (!digit(buffer[at])) bad();
      while (digit(buffer[at])) at++;
    }
    if (buffer[at] === 101 || buffer[at] === 69) {
      at++; if (buffer[at] === 43 || buffer[at] === 45) at++;
      if (!digit(buffer[at])) bad();
      while (digit(buffer[at])) at++;
    }
  }
  function value(shape, depth = 0) {
    if (depth > 256) throw fallback;
    whitespace();
    const start = at, byte = buffer[at];
    if (byte === 123) {
      at++; whitespace();
      if (shape) output.push('{');
      let first = true;
      if (buffer[at] !== 125) {
        while (true) {
          if (buffer[at] !== 34) bad();
          const keyStart = string();
          // Allowlisted ASCII keys are shorter than 40 characters, even fully
          // escaped they fit in 256 bytes. Never decode a huge unknown key.
          const name = shape && typeof shape === 'object' && !Array.isArray(shape) && at - keyStart <= 256 ? key(keyStart) : null;
          const child = name !== null && Object.hasOwn(shape, name) ? shape[name] : false;
          if (child) {
            if (!first) output.push(','); first = false;
            output.push(JSON.stringify(name), ':');
          }
          whitespace(); if (buffer[at++] !== 58) bad();
          value(child, depth + 1); whitespace();
          if (buffer[at] === 125) break;
          if (buffer[at++] !== 44) bad();
          whitespace();
        }
      }
      at++; if (shape) output.push('}');
    } else if (byte === 91) {
      at++; whitespace();
      if (shape) output.push('[');
      let first = true;
      if (buffer[at] !== 93) {
        while (true) {
          if (shape && !first) output.push(','); first = false;
          value(Array.isArray(shape) ? shape[0] : shape ? true : false, depth + 1); whitespace();
          if (buffer[at] === 93) break;
          if (buffer[at++] !== 44) bad();
        }
      }
      at++; if (shape) output.push(']');
    } else {
      if (byte === 34) string();
      else if (byte === 45 || digit(byte)) number();
      else {
        const literal = byte === 116 ? 'true' : byte === 102 ? 'false' : byte === 110 ? 'null' : null;
        if (!literal) bad();
        for (let i = 0; i < literal.length; i++) if (buffer[at++] !== literal.charCodeAt(i)) bad();
      }
      if (shape) {
        // Only string-vs-array matters for human prompts; retain no prompt bytes.
        output.push(byte === 34 && Array.isArray(shape) ? '""' : buffer.toString('utf8', start, at));
      }
    }
  }
  try { value(schema); } catch (error) {
    if (error !== fallback) throw error;
    // The caller JSON.parses this bounded original line; native parsing handles
    // deep JSON without recursive JavaScript traversal or re-stringification.
    return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r$/, '');
  }
  whitespace();
  if (at !== buffer.length) bad();
  return output.join('');
}
module.exports = { project };
