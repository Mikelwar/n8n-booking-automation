// Creates two importable copies of the workflow for the e2e run:
//   wf-demo.json : unchanged (demo_mode = true)
//   wf-prod.json : demo_mode = false, every production integration still disabled → must fail safe
'use strict';
const fs = require('fs');
const [src, outDir] = process.argv.slice(2);
const wf = JSON.parse(fs.readFileSync(src, 'utf8'));

const demo = { ...wf, id: 'bookingDemoE2E01', name: `${wf.name} [e2e demo]` };
const prod = JSON.parse(JSON.stringify({ ...wf, id: 'bookingProdE2E01', name: `${wf.name} [e2e production-mode, integrations disabled]` }));
const cfg = prod.nodes.find((n) => n.name === 'Config');
cfg.parameters.assignments.assignments.find((a) => a.name === 'config.demo_mode').value = false;

fs.writeFileSync(`${outDir}/wf-demo.json`, JSON.stringify(demo));
fs.writeFileSync(`${outDir}/wf-prod.json`, JSON.stringify(prod));
