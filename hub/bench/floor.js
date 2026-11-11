/* Intent: measure the runtime/module/SQLite floor without ingesting any source.
 * Status: synthetic benchmark child. Next: compare with collector peak.
 * Blockers: none. Confidence: same executable and imports, no runtime flags. */
'use strict';
require('../collector/collect');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../collector/db');
// The benchmark supplies this exact synthetic path; no source discovery occurs.
const file = process.argv[2];
if (!file) throw new Error('A synthetic floor database path is required');
fs.mkdirSync(path.dirname(file), { recursive: true });
const store = new Store(file);
try {
  process.stdout.write(JSON.stringify({ ...process.memoryUsage(), max_rss_kb: process.resourceUsage().maxRSS }) + '\n');
} finally { store.close(); }
