/* Intent: recompute only dirty local days and retain historical aggregates safely.
 * Status: exact nearest-rank p95 and replay-safe 90-day retention implemented.
 * Next: measure archive growth on real data in supervisor review. Blockers: none.
 * Confidence: covered by retention, replay and incremental tests. */
'use strict';
const { hash } = require('./values');
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
  // Codex provides a thread-wide cumulative snapshot, not per-response deltas.
  // Its latest snapshot is attributed to its last token_count local date.
  store.run(`INSERT INTO daily_tokens
    SELECT ?,?,model,SUM(input),SUM(output),SUM(cache_read),SUM(cache_write),SUM(reasoning),COUNT(*)
    FROM codex_sessions WHERE day=? AND token_ts IS NOT NULL GROUP BY model`, day, codex, day);
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
  store.run('DELETE FROM dirty_days WHERE day=?', day);
}
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
}
module.exports = { aggregate, retain };
