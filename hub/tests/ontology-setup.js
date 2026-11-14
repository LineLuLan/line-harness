'use strict';
// Intent: isolate every Hub test process (and inherited children) from live ontology.
// Status: complete. Next: none. Blockers: none. Confidence: loader fixtures use explicit overrides.
process.env.LINE_HUB_ONTOLOGY = require('node:path').resolve(__dirname, '../../claude/ontology/harness.ontology.json');
