/* Intent: exclude overlapping collectors and keep errors private and bounded.
 * Status: token-owned SQLite lease with dead-PID/30-minute expiry. Next: none.
 * Blockers: none. Confidence: child-process lease contention and error-cap tests. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireLease } = require('./db');
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function acquire(database) {
  return acquireLease(database, process.pid, crypto.randomUUID(), alive);
}
function logError(dir, error, item) {
  // Do not serialize exception messages: JSON/parser/fs errors can contain text or paths.
  const code = typeof error?.code === 'string' && /^[A-Z_0-9]{1,40}$/.test(error.code) ? error.code : 'COLLECT_FAILED';
  const name = ['Error', 'SyntaxError', 'TypeError', 'RangeError'].includes(error?.name) ? error.name : 'Error';
  const detail = item === undefined ? code : `ITEM_FAILED ${code === 'COLLECT_FAILED' ? name : code} ${crypto.createHash('sha256').update(item).digest('hex').slice(0, 12)}`;
  const line = `${new Date().toISOString()} ${detail}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'collect-errors.log');
    let size = 0;
    try { size = fs.statSync(file).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (size + Buffer.byteLength(line) > 1024 * 1024) fs.writeFileSync(file, '', { mode: 0o600 });
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch { /* Hook mode must still exit 0 when its configured directory is unwritable. */ }
}
module.exports = { acquire, logError };
