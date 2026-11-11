/* Intent: silence only SQLite's experimental notice, preserving other warnings.
 * Status: installed before loading SQLite. Next: remove when SQLite is stable.
 * Blockers: none. Confidence: warning forwarding is covered by a subprocess test. */
'use strict';
const listeners = process.listeners('warning');
for (const listener of listeners) process.removeListener('warning', listener);
process.on('warning', warning => {
  if (warning.name === 'ExperimentalWarning' && /SQLite is an experimental feature/i.test(warning.message)) return;
  for (const listener of listeners) listener.call(process, warning);
  if (!listeners.length) process.stderr.write(`${warning.name}: ${warning.message}\n`);
});
