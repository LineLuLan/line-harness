/* Intent: whitelist scalar metrics and normalize dates and path basenames.
 * Status: implemented. Next: extend only for documented upstream fields.
 * Blockers: none. Confidence: synthetic shape and privacy tests. */
'use strict';
const crypto = require('node:crypto');
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function name(value) { return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : null; }
function integer(value, fallback = 0) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}
function epoch(value, fallback = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== 'string') return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}
function day(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function basename(value) {
  return typeof value === 'string' ? name(value.replace(/[\\/]+$/, '').split(/[\\/]/).pop()) : null;
}
function script(command) {
  if (typeof command !== 'string') return 'inline';
  const matches = command.match(/(?:"[^"\r\n]+\.(?:ps1|js|cjs|mjs|sh|py|cmd|bat)"|'[^'\r\n]+\.(?:ps1|js|cjs|mjs|sh|py|cmd|bat)'|[^\s"']+\.(?:ps1|js|cjs|mjs|sh|py|cmd|bat))(?=\s|$)/gi);
  return matches ? basename(matches.at(-1).replace(/^["']|["']$/g, '')) : 'inline';
}
function tokens(usage = {}) {
  const rows = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  const result = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
  for (const u of rows) {
    if (!u || typeof u !== 'object') continue;
    result.input += Math.max(0, integer(u.input_tokens));
    result.output += Math.max(0, integer(u.output_tokens));
    result.cache_read += Math.max(0, integer(u.cache_read_input_tokens));
    result.cache_write += Math.max(0, integer(u.cache_creation_input_tokens));
    result.reasoning += Math.max(0, integer(u.output_tokens_details?.thinking_tokens));
  }
  // Some Claude records put totals in iterations but thinking details only on
  // usage itself. Explicit iteration thinking (including zero) takes precedence.
  if (!rows.some(u => u?.output_tokens_details?.thinking_tokens !== undefined)) {
    result.reasoning = Math.max(0, integer(usage.output_tokens_details?.thinking_tokens));
  }
  return result;
}
module.exports = { hash, name, integer, epoch, day, basename, script, tokens };
