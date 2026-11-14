/* Intent: recompute only dirty local days and retain historical aggregates safely.
 * Status: exact nearest-rank p95 and replay-safe 90-day retention implemented. v8: daily system
 *   metrics (systemDay) and system retention (raw samples 7 days, daily rows and kills 90 days).
 * Next: measure archive growth on real data in supervisor review. Blockers: none.
 * Confidence: covered by retention, replay and incremental tests. */
'use strict';
const { hash, day: dayOf } = require('./values');
function aggregateDay(store, day) {
  const claude = store.intern('source', 'claude');
  const codex = store.intern('source', 'codex');
  for (const table of ['daily_tokens', 'daily_tools', 'daily_hooks', 'daily_runs']) {
    store.run(`DELETE FROM ${table} WHERE day=?`, day);
  }
  store.run(`INSERT INTO daily_tokens
    SELECT ?,?,model,SUM(input),SUM(output),SUM(cache_read),SUM(cache_write),SUM(reasoning),COUNT(*)
    FROM (SELECT model,input,output,cache_read,cache_write,reasoning FROM claude_messages WHERE day=?
      UNION ALL SELECT model,input,output,cache_read,cache_write,reasoning FROM receipts WHERE day=? AND kind=1)
    GROUP BY model`, day, claude, day, day);
  // v7: Codex tokens come from codex_days (per thread and day deltas of the cumulative snapshots),
  // under the thread's current model. messages = threads that spent tokens that day.
  store.run(`INSERT INTO daily_tokens
    SELECT ?,?,s.model,SUM(d.input),SUM(d.output),SUM(d.cache_read),SUM(d.cache_write),SUM(d.reasoning),COUNT(*)
    FROM codex_days d JOIN codex_sessions s ON s.session_id=d.session_id WHERE d.day=? GROUP BY s.model`, day, codex, day);
  store.run(`INSERT INTO daily_tools SELECT ?,tool,SUM(calls) FROM (
    SELECT tool,COUNT(*) calls FROM tool_calls WHERE day=? GROUP BY tool
    UNION ALL SELECT tool,calls FROM archived_tools WHERE day=?) GROUP BY tool`, day, day, day);
  store.run(`INSERT INTO daily_hooks
    WITH samples AS (
      SELECT h.script,h.event,h.duration_ms,COUNT(*) runs,
        SUM(CASE WHEN n.name LIKE '%error%' OR COALESCE(h.exit_code,0)<>0 THEN 1 ELSE 0 END) errors,
        SUM(CASE WHEN n.name='timeout' THEN 1 ELSE 0 END) timeouts
      FROM hook_events h JOIN names n ON n.id=h.status WHERE h.day=? GROUP BY h.script,h.event,h.duration_ms
      UNION ALL SELECT script,event,duration_ms,runs,errors,timeouts FROM archived_hooks WHERE day=?
    ), bins AS (
      SELECT script,event,duration_ms,SUM(runs) runs,SUM(errors) errors,SUM(timeouts) timeouts
      FROM samples GROUP BY script,event,duration_ms
    ), ranked AS (
      SELECT *,SUM(runs) OVER (PARTITION BY script,event ORDER BY duration_ms) cumulative,
        SUM(runs) OVER (PARTITION BY script,event) total FROM bins
    ) SELECT ?,script,event,SUM(runs),SUM(errors),SUM(timeouts),
      MIN(CASE WHEN cumulative >= (total*95+99)/100 THEN duration_ms END)
      FROM ranked GROUP BY script,event`, day, day, day);
  store.run(`INSERT INTO daily_runs SELECT ?,model,COUNT(*),SUM(CASE WHEN exit_code=0 THEN 1 ELSE 0 END),
    SUM(CASE WHEN exit_code=72 THEN 1 ELSE 0 END),SUM(CASE WHEN exit_code=73 THEN 1 ELSE 0 END),
    SUM(CASE WHEN exit_code NOT IN (0,72,73) THEN 1 ELSE 0 END),SUM(is_resume)
    FROM runs WHERE day=? GROUP BY model`, day, day);
  systemDay(store, day);
  store.run('DELETE FROM dirty_days WHERE day=?', day);
}
// v8: daily RAM / commit / disk metrics from the raw samples of that day. Raw samples are pruned by whole
// local day (meta system_pruned_before = the first day still kept). A day before that mark keeps its stored
// metrics: a late sample for it never rebuilds the day from a partial set. A day with no raw samples is
// not touched either. Folder sizes (folder_bytes) come straight from the sampler and are not touched here.
const SAMPLE_METRICS = ['samples', 'ram_free_min_pct', 'ram_free_avg_pct', 'commit_max_pct', 'disk_free_min_pct', 'disk_free_min_bytes', 'disk_total_bytes'];
function systemDay(store, day) {
  const pruned = store.meta('system_pruned_before');
  if (pruned && day < pruned) return;
  if (!store.get('SELECT 1 FROM system_samples WHERE day=? LIMIT 1', day)) return;
  store.run(`DELETE FROM system_daily WHERE day=? AND metric IN (${SAMPLE_METRICS.map(() => '?').join(',')})`, day, ...SAMPLE_METRICS);
  const put = (metric, subject, value, drive = null) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) store.run('INSERT OR REPLACE INTO system_daily VALUES (?,?,?,?,?)', day, metric, subject, value, drive);
  };
  const r = store.get(`SELECT COUNT(*) n, MIN(100.0*ram_free_mb/ram_total_mb) mn, AVG(100.0*ram_free_mb/ram_total_mb) av,
      MAX(CASE WHEN commit_limit_mb>0 THEN 100.0*commit_used_mb/commit_limit_mb END) cm
    FROM system_samples WHERE day=? AND ram_total_mb>0`, day);
  put('samples', '', store.get('SELECT COUNT(*) n FROM system_samples WHERE day=?', day).n);
  if (r.n) { put('ram_free_min_pct', '', round1(r.mn)); put('ram_free_avg_pct', '', round1(r.av)); put('commit_max_pct', '', r.cm === null ? null : round1(r.cm)); }
  for (const d of store.all(`SELECT json_extract(j.value,'$.d') d, MIN(100.0*json_extract(j.value,'$.free')/json_extract(j.value,'$.total')) pct,
      MIN(json_extract(j.value,'$.free')) free, MAX(json_extract(j.value,'$.total')) total
    FROM system_samples s, json_each(s.drives) j WHERE s.day=? GROUP BY 1`, day)) {
    put('disk_free_min_pct', d.d, round1(d.pct), d.d); put('disk_free_min_bytes', d.d, d.free, d.d); put('disk_total_bytes', d.d, d.total, d.d);
  }
}
const round1 = x => Math.round(x * 10) / 10;
function aggregate(store, expired) {
  while (!expired()) {
    const next = store.get('SELECT day FROM dirty_days ORDER BY day LIMIT 1');
    if (!next) break;
    store.begin();
    try { aggregateDay(store, next.day); store.commit(); }
    catch (error) { store.rollback(); throw error; }
  }
}
function retain(store, expired, now = Math.floor(Date.now() / 1000)) {
  const cutoff = now - 90 * 86400;
  const tables = [['claude_messages', 'message_id', 'message', 1], ['tool_calls', 'tool_use_id', 'tool', 2], ['hook_events', 'id', 'hook', 3]];
  for (const [table, key, kind, number] of tables) {
    while (!expired()) {
      const rows = store.all(`SELECT * FROM ${table} WHERE ts<?
        AND day NOT IN (SELECT day FROM dirty_days) ORDER BY ts LIMIT 500`, cutoff);
      if (!rows.length) break;
      store.begin();
      try {
        for (const row of rows) {
          const receipt = { id: hash(`${kind}:${row[key]}`), kind: number };
          if (number === 1) {
            for (const field of ['day', 'model', 'input', 'output', 'cache_read', 'cache_write', 'reasoning']) receipt[field] = row[field];
          } else if (number === 2) {
            store.run(`INSERT INTO archived_tools VALUES (?,?,1) ON CONFLICT(day,tool) DO UPDATE SET calls=calls+1`, row.day, row.tool);
          } else {
            const status = store.get('SELECT name FROM names WHERE id=?', row.status).name;
            store.run(`INSERT INTO archived_hooks VALUES (?,?,?,?,1,?,?)
              ON CONFLICT(day,script,event,duration_ms) DO UPDATE SET runs=runs+1,
                errors=errors+excluded.errors,timeouts=timeouts+excluded.timeouts`,
            row.day, row.script, row.event, row.duration_ms,
            status.includes('error') || (row.exit_code !== null && row.exit_code !== 0) ? 1 : 0,
            status === 'timeout' ? 1 : 0);
          }
          store.insert('receipts', receipt);
          store.run(`DELETE FROM ${table} WHERE ${key}=?`, row[key]);
        }
        store.commit();
      } catch (error) { store.rollback(); throw error; }
    }
  }
  if (expired()) return;
  // v8 system retention: raw samples by WHOLE local day - every day before the day of (now - 7 d) goes, never
  // part of a day (their daily metrics are already in system_daily; a day still waiting for aggregation keeps
  // its samples and moves the mark back). Daily metrics and low-memory kills: 90 days.
  store.begin();
  try {
    const keepFrom = dayOf(now - 7 * 86400);
    store.run('DELETE FROM system_samples WHERE day<? AND day NOT IN (SELECT day FROM dirty_days)', keepFrom);
    const waiting = store.get('SELECT MIN(day) d FROM system_samples WHERE day<?', keepFrom)?.d;
    store.setMeta('system_pruned_before', waiting && waiting < keepFrom ? waiting : keepFrom);
    store.run('DELETE FROM system_daily WHERE day<?', dayOf(cutoff));
    store.run('DELETE FROM memory_kills WHERE ts<?', cutoff);
    store.commit();
  } catch (error) { store.rollback(); throw error; }
}
module.exports = { aggregate, retain };
