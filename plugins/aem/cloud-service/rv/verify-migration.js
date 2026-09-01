'use strict';

/**
 * End-to-end demo: verify the scheduler skill's change on the WKND legacy file.
 *   1. legacy source  -> RV should FAIL (this is what triggered migration)
 *   2. migrated source -> RV should PASS (skill did it right)
 */
const fs = require('fs');
const path = require('path');
const { checkSchedulerSource } = require('./invariants/scheduler-source.js');

const dir = path.join(__dirname, 'example');
const cases = [
  ['legacy (before skill)',  'SimpleScheduledTask.legacy.java'],
  ['migrated (after skill)', 'SimpleScheduledTask.migrated.java'],
];

for (const [label, file] of cases) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const r = checkSchedulerSource(src);
  console.log(`\n=== ${label} ===`);
  console.log(`result: ${r.result}${r.failure_class ? '   failure_class: ' + r.failure_class : ''}`);
  console.log('checks:', JSON.stringify(r.checks));
  if (r.evidence) console.log('why:', r.evidence);
}
