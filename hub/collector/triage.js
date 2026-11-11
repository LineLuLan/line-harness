/* Intent: reject irrelevant records using at most the first 1,024 raw bytes.
 * Status: amendment r1, conservative object-path scanner without JSON.parse.
 * Next: add observed source types explicitly. Blockers: none.
 * Confidence: nested types, quoted decoys, partial heads and BOM tests. */
'use strict';
const HEAD_BYTES = 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const CLAUDE_TYPES = new Set(['assistant', 'attachment', 'system', 'user']);
const CODEX_TYPES = new Set(['session_meta', 'turn_context', 'event_msg']);
const CODEX_EVENTS = new Set(['task_started', 'task_complete', 'token_count']);
function shouldSkip(input, kind) {
  if (kind !== 'claude' && kind !== 'codex') return false;
  const head = input.subarray(0, HEAD_BYTES);
  let at = head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF ? 3 : 0;
  const fields = {};
  const whitespace = () => { while ([32, 9, 13, 10].includes(head[at])) at++; };
  // An escaped key/value is uncertain; leave it to the bounded full JSON parser.
  function string(capture) {
    const from = ++at;
    let escaped = false;
    while (at < head.length) {
      if (head[at] === 92) { escaped = true; at += 2; continue; }
      if (head[at] === 34) {
        const value = capture && !escaped ? head.toString('utf8', from, at) : null;
        at++; return { complete: true, value };
      }
      at++;
    }
    return { complete: false, value: null };
  }
  function child(parent, key) {
    if (parent === 'root') {
      if (['type', 'subtype', 'payload', 'message', 'attachment'].includes(key)) return key;
    } else if (parent === 'payload' && key === 'type') return 'payload.type';
    else if (parent === 'attachment' && key === 'type') return 'attachment.type';
    else if (parent === 'message' && key === 'content') return 'message.content';
    return '';
  }
  function value(target, depth) {
    if (depth > 32) return false;
    whitespace();
    const byte = head[at];
    if (byte === 34) {
      const token = string(Boolean(target));
      if (token.complete && token.value !== null) fields[target] = token.value;
      return token.complete;
    }
    if (byte === 123) {
      at++; whitespace();
      if (head[at] === 125) { at++; return true; }
      while (at < head.length) {
        if (head[at] !== 34) return false;
        const key = string(Boolean(target));
        if (!key.complete) return false;
        whitespace();
        if (head[at++] !== 58 || !value(child(target, key.value), depth + 1)) return false;
        whitespace();
        if (head[at] === 125) { at++; return true; }
        if (head[at++] !== 44) return false;
        whitespace();
      }
      return false;
    }
    if (byte === 91) {
      if (target === 'message.content') fields.userArray = true;
      at++; whitespace();
      if (head[at] === 93) { at++; return true; }
      while (at < head.length) {
        if (!value('', depth + 1)) return false;
        whitespace();
        if (head[at] === 93) { at++; return true; }
        if (head[at++] !== 44) return false;
      }
      return false;
    }
    const from = at;
    while (at < head.length && ![32, 9, 13, 10, 44, 93, 125].includes(head[at])) at++;
    return at > from;
  }
  value('root', 0);
  const type = fields.type;
  if (!type) return false;
  if (kind === 'codex') {
    return !CODEX_TYPES.has(type) || (type === 'event_msg' && fields['payload.type'] !== undefined && !CODEX_EVENTS.has(fields['payload.type']));
  }
  return !CLAUDE_TYPES.has(type) || (type === 'user' && fields.userArray === true) ||
    (type === 'system' && fields.subtype !== undefined && fields.subtype !== 'compact_boundary') ||
    (type === 'attachment' && fields['attachment.type'] !== undefined && !fields['attachment.type'].startsWith('hook_'));
}
module.exports = { shouldSkip, HEAD_BYTES, MAX_LINE_BYTES };
