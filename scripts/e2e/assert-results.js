// Asserts on real n8n execution output (produced by `n8n execute --rawOutput`).
// Usage: node assert-results.js <demo.raw> <prod.raw> <projectRoot> [outDir]
'use strict';
const fs = require('fs');
const { runAssertions } = require('./assertions');
const [demoRaw, prodRaw, root, outDir] = process.argv.slice(2);

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const start = raw.search(/^\{/m); // n8n prints log lines before the JSON document
  if (start < 0) throw new Error(`No JSON in ${file}:\n${raw.slice(0, 2000)}`);
  return JSON.parse(raw.slice(start)).data.resultData;
}

const { failures } = runAssertions({ root, demo: load(demoRaw), prod: load(prodRaw), outDir, label: 'Real n8n 2.37.10 execution (--network none)' });
process.exit(failures ? 1 : 0);
