/* Intent: triage raw line bytes before bounded decoding, with atomic cursors.
 * Status: shared occurrence identities for Claude, reviews, ledger and dispatch.
 * Limitation: truncation followed by new lines identical to removed lines cannot
 * be distinguished by occurrence counting; accepted for append-only Claude/Codex logs.
 * Rewrites are detected by shrink OR by a changed fingerprint of the first 4 KiB of the
 * committed prefix (v4); an edit only beyond the first 4 KiB of an unshrunk file is not seen.
 * Reads retain the process-wide 64 KiB buffer and bounded geometric workspace.
 * Next: supervisor real-log validation. Blockers: none.
 * Confidence: parse counters, cap, UTF-8, skipped-line resume and rollback tests. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./values');
const parsers = require('./parsers');
const { shouldSkip, HEAD_BYTES, MAX_LINE_BYTES } = require('./triage');
const { project } = require('./project');
function add(diagnostics, key, amount = 1) { diagnostics[key] = (diagnostics[key] || 0) + amount; }
function maximum(diagnostics, key, amount) { diagnostics[key] = Math.max(diagnostics[key] || 0, amount); }
const READ_BYTES = 64 * 1024;
const readBuffer = Buffer.allocUnsafe(READ_BYTES);
// Transfer detaches the old backing store immediately when growing. Ordinary
// fixed-length buffers keep byte parsing fast and memory accounting explicit.
let workspaceStorage = new ArrayBuffer(READ_BYTES);
let workspace = Buffer.from(workspaceStorage);
let reading = false;
// Fingerprint "<length>:<sha256>" of the first bytes of the committed prefix.
const HEAD_PRINT_BYTES = 4096;
const headBuffer = Buffer.allocUnsafe(HEAD_PRINT_BYTES);
function head(file, length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > HEAD_PRINT_BYTES) return null;
  const fd = fs.openSync(file, 'r');
  try {
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, headBuffer, got, length - got, got);
      if (n === 0) break;
      got += n;
    }
    return `${length}:${hash(headBuffer.subarray(0, got))}${got < length ? ':short' : ''}`;
  } finally { fs.closeSync(fd); }
}
function* lines(file, start, end, options = {}) {
  if (start >= end) return;
  // Buffers belong to the process, so consumers must finish one reader at a time.
  if (reading) throw new Error('Concurrent line readers are not supported');
  reading = true;
  const { kind, diagnostics = {}, sample = () => {}, expired = () => false } = options;
  const readSize = Math.max(1, Math.min(READ_BYTES, options.highWaterMark || READ_BYTES));
  let length = 0, headLength = 0, written = 0, decision = null, offset = start, chunks = 0;
  let fd;
  diagnostics.workspace_capacity = workspace.length;
  function append(from, to, complete) {
    length += to - from;
    let consumed = 0;
    if (decision === null) {
      consumed = Math.min(to - from, HEAD_BYTES - headLength);
      readBuffer.copy(workspace, headLength, from, from + consumed); headLength += consumed;
      maximum(diagnostics, 'max_head_bytes', headLength);
      if (headLength < HEAD_BYTES && !complete) return;
      decision = shouldSkip(workspace.subarray(0, headLength), kind) ? 'triage' : 'keep';
      written = headLength;
    }
    if (decision !== 'keep') return;
    if (length > MAX_LINE_BYTES) { decision = 'large'; written = 0; return; }
    if (length > workspace.length) {
      let capacity = workspace.length;
      while (capacity < length) capacity *= 2;
      workspaceStorage = workspaceStorage.transfer(capacity);
      workspace = Buffer.from(workspaceStorage);
      diagnostics.workspace_capacity = capacity;
      add(diagnostics, 'workspace_growths');
      sample('workspace_grown');
    }
    readBuffer.copy(workspace, written, from + consumed, to); written += to - from - consumed;
    maximum(diagnostics, 'max_buffered_bytes', written);
  }
  try {
    fd = fs.openSync(file, 'r');
    let position = start;
    while (position < end) {
      // Check before every <=64 KiB read, including while discarding a giant line.
      if (expired()) return;
      const bytes = fs.readSync(fd, readBuffer, 0, Math.min(readSize, end - position), position);
      if (!bytes) break;
      position += bytes;
      if (++chunks % 64 === 0) sample('stream_read');
      let from = 0, firstLine = true;
      while (from < bytes) {
        const newline = readBuffer.indexOf(10, from);
        const complete = newline !== -1 && newline < bytes;
        append(from, complete ? newline : bytes, complete);
        from = complete ? newline + 1 : bytes;
        if (!complete) continue;
        // The read already checked the first line; check again between records.
        if (!firstLine && expired()) return;
        firstLine = false;
        offset += length + 1;
        const result = { offset };
        if (decision === 'keep') {
          maximum(diagnostics, 'max_buffered_bytes', length);
          result.bytes = length;
          // This view is valid until next(); no backing allocation per line/chunk/file.
          if (options.raw) result.buffer = workspace.subarray(0, length);
          else {
            result.text = workspace.toString('utf8', 0, length).replace(/^\uFEFF/, '').replace(/\r$/, '');
            add(diagnostics, 'decoded_lines');
          }
        } else result.skip = decision;
        length = 0; headLength = 0; written = 0; decision = null;
        yield result;
      }
    }
  } finally {
    try { if (fd !== undefined) fs.closeSync(fd); } finally { reading = false; }
  }
  // Count original bytes (including invalid UTF-8), not replacement characters.
  // An unfinished line, including a skipped one, remains unacknowledged.
}
async function ingest(store, item, expired, options = {}) {
  const { diagnostics = {}, sample = () => {} } = options;
  const key = hash(item.file);
  const previous = store.state(key);
  let reset = previous && (item.stat.size < previous.size || item.stat.size < previous.offset);
  let offset = !previous || reset ? 0 : previous.offset;
  if (offset === item.stat.size && previous?.mtime_ms === item.stat.mtimeMs) return 0;
  // A rewrite that keeps or grows the size is caught by the committed-prefix fingerprint.
  if (previous && !reset && previous.head && previous.head !== head(item.file, Number(previous.head.split(':')[0]))) {
    reset = true; offset = 0;
  }
  const ctx = { session: reset ? null : previous?.session_id, ts: Math.floor(item.stat.mtimeMs / 1000),
    fallback: path.basename(item.file, '.jsonl') };
  const legacy = item.kind === 'claude' && Boolean(store.get('SELECT 1 FROM legacy_replay WHERE path=?', key));
  // Most records have upstream IDs. Hash their (potentially large) private text
  // only if an event without an upstream ID actually needs a replay identity.
  Object.defineProperty(ctx, 'id', { get() {
    if (ctx.cachedId) return ctx.cachedId;
    let raw = ctx.raw;
    // Match the pre-r1 identity's removal of BOM/CRLF without decoding large text.
    if (raw?.[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) raw = raw.subarray(3);
    if (raw?.at(-1) === 13) raw = raw.subarray(0, -1);
    const digest = hash(raw || ctx.text);
    const timestamp = item.kind === 'claude' ? ctx.recordTimestamp ?? '' : '';
    const fingerprint = hash(`${timestamp}:${digest}`);
    const occurrence = store.get(`INSERT INTO ingest_occurrences VALUES (?,?,1)
      ON CONFLICT(path,fingerprint) DO UPDATE SET occurrences=occurrences+1 RETURNING occurrences`, key, fingerprint).occurrences;
    const id = hash(`${key}:${timestamp}:${digest}:${occurrence}`);
    if (legacy) {
      const oldId = hash(`${key}:${ctx.offset}:${digest}`);
      const table = { user: 'human_turns', attachment: 'hook_events', system: 'compactions' }[ctx.recordType];
      if (table) store.run(`UPDATE OR IGNORE ${table} SET id=? WHERE id=?`, id, oldId);
      if (ctx.recordType === 'attachment') {
        store.run('UPDATE OR IGNORE receipts SET id=? WHERE id=?', hash(`hook:${id}`), hash(`hook:${oldId}`));
      }
    }
    ctx.cachedId = id;
    return id;
  } });
  let pending = 0, count = 0, skippedTriage = 0, skippedLarge = 0;
  store.begin();
  const commit = () => {
    if (skippedTriage) store.addMeta('skipped_triage', skippedTriage);
    if (skippedLarge) store.addMeta('skipped_large', skippedLarge);
    store.cursor(key, item.stat.size, item.stat.mtimeMs, offset, ctx.session, head(item.file, Math.min(HEAD_PRINT_BYTES, offset)));
    if (offset === item.stat.size) store.run('DELETE FROM legacy_replay WHERE path=?', key);
    store.commit(); pending = 0; skippedTriage = 0; skippedLarge = 0;
    // This is a short-lived importer, not a query server: release unused pages
    // between batches instead of carrying their resident memory into later files.
    store.exec('PRAGMA shrink_memory');
    sample('batch_committed');
  };
  try {
    if (offset === 0) store.run('DELETE FROM ingest_occurrences WHERE path=?', key);
    for (const line of lines(item.file, offset, item.stat.size, { ...options, diagnostics, kind: item.kind, expired, raw: true })) {
      ctx.cachedId = null; ctx.recordTimestamp = null; ctx.recordType = null;
      ctx.raw = line.buffer;
      ctx.offset = offset;
      offset = line.offset;
      if (line.skip === 'triage') {
        skippedTriage++; add(diagnostics, 'skipped_triage');
      } else if (line.skip === 'large') {
        skippedLarge++; add(diagnostics, 'skipped_large');
      } else {
        let invalid = false;
        try {
          // Large needed records often contain megabytes of ignored tool input.
          // Validate these bytes without constructing their private JS strings.
          line.text = line.bytes >= 65536 ? project(line.buffer, item.kind)
            : line.buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r$/, '');
          add(diagnostics, 'decoded_lines');
          if (line.bytes >= 65536) sample('line_projected');
        } catch { store.addMeta('parse_errors', 1); invalid = true; }
        ctx.text = line.text;
        if (invalid || !line.text.trim()) {
          // Invalid projected JSON has already contributed one parse error.
        } else if (item.kind === 'dispatch' || item.kind === 'ledger') {
          if (!parsers[item.kind](store, line.text, ctx)) store.addMeta('parse_errors', 1);
        } else {
          let value;
          try {
            add(diagnostics, 'json_parsed');
            value = JSON.parse(line.text);
            if (line.bytes >= 65536) sample('line_parsed');
          } catch { store.addMeta('parse_errors', 1); }
          if (value !== undefined) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) store.addMeta('parse_errors', 1);
            else {
              ctx.recordTimestamp = typeof value.timestamp === 'string' || typeof value.timestamp === 'number' ? value.timestamp : null;
              ctx.recordType = value.type;
              parsers[item.kind](store, value, ctx);
            }
          }
          value = null;
        }
      }
      // Drop both references before asking the generator to materialize another line.
      ctx.text = null; ctx.raw = null; line.text = undefined; line.buffer = undefined;
      count++; pending++;
      if (pending >= 500) { commit(); store.begin(); }
    }
    commit();
  } catch (error) { store.rollback(); throw error; }
  return count;
}
module.exports = { lines, ingest };
