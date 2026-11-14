/* Intent: on-demand local dashboard server; read-only over the private hub DB.
 * Status: UI v6 (ten pages: overview, supervisor, workers, models (takes ?model=<key>&tier=<tier>), cost (Usage), productivity, harness, gates, system, trace - queries.js), v4 (self-hosted woff2 fonts under /fonts/, CSP font-src 'self'; v3 added /viz.js). Binds 127.0.0.1 only, checks Host (DNS-rebinding guard), GET/HEAD only,
 * fixed static allowlist (no path joins from the URL), exits after an idle period.
 * Next: none. Blockers: none. Confidence: tests/server.test.js + real-DB browser check. */
'use strict';
require('../collector/warnings');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { paths } = require('../collector/sources');
const { range, pages, compareTier } = require('./queries');

const WEB = path.join(__dirname, '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
// URL path -> file inside web/. Nothing outside this table is ever served.
const STATIC = {
  '/': 'index.html', '/app.js': 'app.js', '/charts.js': 'charts.js', '/viz.js': 'viz.js', '/route.js': 'route.js', '/style.css': 'style.css',
  '/vendor/preact.module.js': 'vendor/preact.module.js', '/vendor/hooks.module.js': 'vendor/hooks.module.js',
  '/vendor/htm.module.js': 'vendor/htm.module.js', '/vendor/uPlot.esm.js': 'vendor/uPlot.esm.js',
  '/vendor/uPlot.min.css': 'vendor/uPlot.min.css'
};
// Fonts (OFL, @fontsource-variable 5.3.0): three families x three subsets, fixed names only.
for (const family of ['manrope', 'space-grotesk', 'jetbrains-mono'])
  for (const subset of ['latin', 'latin-ext', 'vietnamese']) STATIC[`/fonts/${family}-${subset}-wght-normal.woff2`] = `fonts/${family}-${subset}-wght-normal.woff2`;
// The inline import map is allowed by its hash only; no other inline script can run.
function importMapHash() {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  return m ? `'sha256-${require('node:crypto').createHash('sha256').update(m[1]).digest('base64')}'` : '';
}
const SECURITY = {
  'X-Line-Hub': '1', 'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': `default-src 'self'; script-src 'self' ${importMapHash()}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
};

// Invalid env values fall back to defaults instead of NaN (listen(NaN) throws; NaN idle never stops).
function envPort(env) {
  const n = Number(env.LINE_HUB_PORT);
  return env.LINE_HUB_PORT !== undefined && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 3434;
}
function envIdleMin(env) {
  const n = Number(env.LINE_HUB_IDLE_MIN);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
/* H8a: the last `n` sampler toasts from <system dir>/alerts.jsonl (file tail only, never the DB). Each line is
 * reduced to { ts, rule, text }; a bad line is skipped; a missing file gives [].
 * Intent: System page lists recent alerts. Status: done. Next: none. Blockers: none.
 * Confidence: tests/h8a-alerts.test.js. */
const ALERT_TAIL_BYTES = 64 * 1024;
function recentAlerts(file, n = 20) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, len = Math.min(size, ALERT_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // first line may be cut
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const x = JSON.parse(line);
        if (Number.isFinite(x.ts) && typeof x.rule === 'string' && typeof x.text === 'string') out.push({ ts: x.ts, rule: x.rule.slice(0, 4), text: x.text.slice(0, 300) });
      } catch { /* skip a bad line */ }
    }
    return out.slice(-n).reverse();
  } catch { return []; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}
function start(options = {}) {
  const env = options.env || process.env;
  const dbFile = options.db || paths(env).db;
  const alertsFile = path.join(options.systemDir || paths(env).system, 'alerts.jsonl');
  const port = options.port ?? envPort(env);
  const idleMs = options.idleMs ?? envIdleMin(env) * 60000;
  const checkMs = options.checkMs ?? 60000;
  let db = null, statements = new Map(), last = Date.now();

  // Queries see only { prepare }, backed by a per-connection statement cache.
  const handle = { prepare(sql) {
    let s = statements.get(sql);
    if (!s) { s = db.prepare(sql); statements.set(sql, s); }
    return s;
  } };
  function database() {
    if (db) return handle;
    if (!fs.existsSync(dbFile)) return null;
    db = new DatabaseSync(dbFile, { readOnly: true, timeout: 2000 });
    db.exec('PRAGMA cache_size=-2000; PRAGMA mmap_size=0; PRAGMA temp_store=MEMORY;');
    statements = new Map();
    return handle;
  }
  function closeDb() {
    statements = new Map();
    try { db?.close(); } catch { /* already closed */ }
    db = null;
  }
  function send(res, status, type, body, head) {
    res.writeHead(status, { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(head ? undefined : body);
  }
  const json = (res, status, value, head) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), head);

  const server = http.createServer((req, res) => {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'method' }); }
    const actual = server.address()?.port;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${actual}` && host !== `localhost:${actual}`) return json(res, 403, { error: 'host' });
    last = Date.now(); // only valid local requests keep the server alive
    let url;
    try { url = new URL(req.url, `http://${host}`); } catch { return json(res, 400, { error: 'url' }); }
    if (url.pathname.startsWith('/api/')) {
      const page = url.pathname.slice(5);
      if (!Object.hasOwn(pages, page)) return json(res, 404, { error: 'page' });
      try {
        const h = database();
        if (!h) return json(res, 503, { error: 'no-db', hint: 'npm run collect -- --full' });
        const r = range(Number(url.searchParams.get('days')));
        const collected = Number(h.prepare("SELECT value FROM meta WHERE key='last_run_end'").get()?.value) || null;
        return json(res, 200, { range: { days: r.days, start: r.startDay, today: r.today }, collected, now: r.now,
          // models takes ?model= as a plain string; queries.js only compares it with keys found in the range.
          data: page === 'models' ? pages.models(h, r, url.searchParams.get('model'), compareTier(url.searchParams.get('tier')))
            : page === 'system' ? { ...pages.system(h, r), alerts: recentAlerts(alertsFile) } : pages[page](h, r) }, head);
      } catch (error) {
        // A collector VACUUM or schema change can invalidate a long-lived reader; reopen on the next request.
        closeDb();
        process.stderr.write(`line-hub api ${page}: ${error.code || error.name}\n`);
        return json(res, 500, { error: 'query' }, head);
      }
    }
    const file = Object.hasOwn(STATIC, url.pathname) ? STATIC[url.pathname] : null;
    if (!file) return json(res, 404, { error: 'not-found' });
    fs.readFile(path.join(WEB, file), (error, body) => {
      if (error) return json(res, 500, { error: 'static' });
      res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': file.endsWith('.woff2') ? 'max-age=604800' : 'no-cache', 'Content-Length': body.length });
      res.end(head ? undefined : body);
    });
  });
  const timer = setInterval(() => { if (Date.now() - last >= idleMs) stop(); }, checkMs);
  function stop() {
    clearInterval(timer);
    closeDb();
    server.close();
    server.closeAllConnections?.();
  }
  server.stop = stop;
  server.listen(port, '127.0.0.1');
  return server;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* print only */ }
}

if (require.main === module) {
  const server = start();
  server.on('listening', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    // ASCII only: Windows PowerShell 5.1 consoles mis-decode UTF-8 output.
    process.stdout.write(`Line Hub: ${url}  (auto-stop after ${envIdleMin(process.env)} min idle)\n`);
    if (process.argv.includes('--open')) openBrowser(url);
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      // Open the browser only if the port really answers as Line Hub.
      const port = envPort(process.env), url = `http://127.0.0.1:${port}/`;
      const req = http.get({ host: '127.0.0.1', port, path: '/', headers: { host: `127.0.0.1:${port}` }, timeout: 1500 }, res => {
        res.resume();
        if (res.headers['x-line-hub'] === '1') {
          process.stdout.write(`Line Hub already running: ${url}\n`);
          if (process.argv.includes('--open')) openBrowser(url);
          process.exit(0);
        }
        process.stderr.write(`line-hub: port ${port} is used by another program; set LINE_HUB_PORT\n`);
        process.exit(1);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => { process.stderr.write(`line-hub: port ${port} is busy; set LINE_HUB_PORT\n`); process.exit(1); });
      return;
    }
    process.stderr.write(`line-hub: ${error.code || error.message}\n`);
    process.exit(1);
  });
  server.on('close', () => process.exit(process.exitCode || 0));
}

module.exports = { start, envPort, envIdleMin, recentAlerts };
