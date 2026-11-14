/* Intent: run one private, bounded local collection slice and exit.
 * Status: CLI and quiet hook entry point with a database lease. Next: supervisor wires hooks after review.
 * Blockers: none. Confidence: synthetic integration tests and separate RSS benchmark. */
'use strict';
require('./warnings');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Store, SCHEMA_VERSION, storedVersion, backupBeforeMigration } = require('./db');
const { hash } = require('./values');
const { paths, discover, snapshot, linkRuns, pruneSystem, recordActiveAccount } = require('./sources');
const { ingest } = require('./stream');
const { aggregate, retain } = require('./aggregate');
const { acquire, logError } = require('./lock');
const { memorySampler } = require('./memory');
function options(args) {
  const result = { hook: false, full: false, budget: 20000, interval: 120 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--hook') result.hook = true;
    else if (arg === '--full') result.full = true;
    else if (arg === '--migrate') result.migrate = true;
    else if (arg === '--reparse-ledger') result.reparseLedger = true;
    else if (arg === '--budget-ms' || arg === '--min-interval-s') {
      const raw = args[++i];
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < 0) throw new Error('Invalid numeric option');
      result[arg === '--budget-ms' ? 'budget' : 'interval'] = value;
    } else throw new Error('Unknown option');
  }
  result.budget = Math.max(1000, result.budget);
  return result;
}
function runFolders(config) {
  try { return fs.readdirSync(path.join(config.state, 'runs'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
// One info line per pending version, not one per hook run.
function logOnce(dir, code) {
  try { if (fs.readFileSync(path.join(dir, 'collect-errors.log'), 'utf8').includes(` ${code}\n`)) return; } catch { /* no log yet */ }
  logError(dir, { code, name: 'Error' });
}
async function collect(config, opts) {
  const memory = memorySampler();
  const reading = { diagnostics: {}, sample: memory.sample };
  const dir = path.dirname(config.db);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const release = acquire(config.db);
  if (!release) return { skipped: 'lock', lines: 0 };
  let store;
  let lines = 0;
  try {
    // Schema upgrades replay every source, so they never run from a hook (a hook may run a working
    // tree that is mid-edit) or a plain run. Only an explicit --full or --migrate run migrates, after
    // a backup copy <db dir>/hub-v<old>.bak.
    const stored = storedVersion(config.db);
    if (stored !== null && stored < SCHEMA_VERSION) {
      if (opts.hook || !(opts.full || opts.migrate)) {
        if (opts.hook) logOnce(dir, `INFO_MIGRATION_PENDING_V${SCHEMA_VERSION}`);
        return { skipped: 'migration', stored, code: SCHEMA_VERSION, lines: 0 };
      }
      backupBeforeMigration(config.db, stored);
    }
    store = new Store(config.db);
    const started = performance.now();
    const expired = () => !opts.full && performance.now() - started >= Math.max(1000, opts.budget);
    const failed = (file, error) => {
      store.rollback();
      logError(dir, error, file);
      store.addMeta('item_errors', 1);
      if (error instanceof SyntaxError) store.addMeta('parse_errors', 1);
    };
    memory.sample('database_open');
    if (opts.hook && Date.now() / 1000 - Number(store.meta('last_run_end') || 0) < opts.interval) {
      return { skipped: 'interval', lines: 0 };
    }
    // --reparse-ledger (CLI only): read review-ledger.log from the start once more. Rows are upserted
    // by content id and ledger_warnings restart at offset 0, so nothing doubles.
    // v8 migration: the ledger is read once more from the start so runs= fills ledger_runs.
    // Intent: v10 replays only the two review logs, atomically with flag removal. Status: ready.
    // Next: host migration. Blockers: none. Confidence: v10 replay/idempotency fixtures.
    const reviewReplay = store.meta('v10_review_replay');
    if ((opts.reparseLedger && !opts.hook) || store.meta('v8_ledger_replay') || reviewReplay) {
      store.begin();
      store.run("DELETE FROM meta WHERE key IN ('v8_ledger_replay','v10_review_replay')");
      if (reviewReplay) store.run('UPDATE ingest_state SET offset=0, size=-1, head=NULL WHERE path=?', hash(path.join(config.state, 'reviews.jsonl')));
      store.run('UPDATE ingest_state SET offset=0, size=-1, head=NULL WHERE path=?', hash(path.join(config.state, 'review-ledger.log')));
      store.commit();
    }
    // v8/v9: reset only run.json cursors once for spec_bytes / spec_sha; snapshots upsert.
    if (store.meta('v8_run_replay') || store.meta('v9_run_replay')) {
      store.begin();
      store.run("DELETE FROM meta WHERE key IN ('v8_run_replay','v9_run_replay')");
      for (const name of runFolders(config)) store.run('UPDATE ingest_state SET size=-1 WHERE path=?', hash(path.join(config.state, 'runs', name, 'run.json')));
      store.commit();
    }
    // H7: the active Codex account (codex-acc.ps1 <accounts>/active) is read on every run, also a
    // budget-stopped one; one small file, so a switch shows on the next collector run.
    try { recordActiveAccount(store, config); } catch (error) { logError(dir, error, path.join(config.codexAccounts || '', 'active')); }
    // Finish durable aggregate work left by a prior budget stop before new ingestion.
    aggregate(store, expired);
    if (!expired()) {
      for (const item of discover(config, failed)) {
        if (expired()) break;
        try {
          if (item.kind === 'run' || item.kind === 'status' || item.kind === 'settings') {
            store.begin(); snapshot(store, item); store.commit();
          } else lines += await ingest(store, item, expired, reading);
        } catch (error) { failed(item.file, error); }
      }
    }
    if (!expired()) {
      store.begin();
      try { linkRuns(store); store.commit(); } catch (error) { store.rollback(); throw error; }
      // v8: sampler JSONL files older than 8 days are deleted (their rows are already in the DB).
      store.begin();
      try { pruneSystem(store, config); store.commit(); } catch (error) { store.rollback(); logError(dir, error); }
    }
    // VACUUM opens a second database internally. Give sequential maintenance a
    // smaller cache so its working pages do not stack on an 8 MB ingest cache.
    store.exec('PRAGMA cache_size=-2000; PRAGMA shrink_memory;');
    try {
      aggregate(store, expired);
      memory.sample('aggregated');
      retain(store, expired);
      store.exec('PRAGMA optimize');
      const now = Math.floor(Date.now() / 1000);
      if (!expired() && now - Number(store.meta('last_vacuum') || 0) >= 7 * 86400) {
        store.exec('PRAGMA shrink_memory');
        store.exec('VACUUM');
        memory.sample('vacuumed');
        store.setMeta('last_vacuum', Math.floor(Date.now() / 1000));
      }
    } finally {
      store.exec('PRAGMA cache_size=-8000;');
    }
    store.setMeta('last_run_end', Math.floor(Date.now() / 1000));
    memory.sample('finished');
    return { lines, ...reading.diagnostics, ...memory.report(),
      elapsed_ms: Math.round(performance.now() - started), budget_exhausted: expired() };
  } finally {
    try { store?.close(); } finally { release(); }
  }
}
function drainStdin(input = process.stdin) {
  return new Promise(resolve => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      input.removeListener('end', finish); input.removeListener('error', finish);
      input.pause(); input.unref?.();
      resolve();
    };
    if (input.readableEnded) { resolve(); return; }
    timer = setTimeout(finish, 2000);
    input.once('end', finish); input.once('error', finish);
    input.resume(); // Flowing without a data listener discards chunks immediately.
  });
}
async function main(args = process.argv.slice(2)) {
  const hook = args.includes('--hook');
  const config = paths();
  try {
    if (hook) await drainStdin();
    const result = await collect(config, options(args));
    if (!hook) process.stdout.write(JSON.stringify({ ...result, max_rss_kb: process.resourceUsage().maxRSS }) + '\n');
  } catch (error) {
    logError(path.dirname(config.db), error);
    if (!hook) {
      process.stderr.write('Collection failed; see collect-errors.log in the database directory.\n');
      process.exitCode = 1;
    }
  } finally {
    if (hook) {
      process.exitCode = 0;
    }
  }
}
if (require.main === module) void main();
module.exports = { collect, options, drainStdin };
