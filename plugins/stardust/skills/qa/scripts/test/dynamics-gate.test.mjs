#!/usr/bin/env node
/**
 * Fixture test for the qa `dynamics` gate severities (no network, no browser).
 * Run: node skills/qa/scripts/test/dynamics-gate.test.mjs
 *
 * Models the recorded miss: the dynamics inventory planned an embedded form, the build shipped a dead
 * native one, no parity file was written, and qa reported only info — the run went green.
 */
import { missingFinding, uncheckedFindings } from '../checks/dynamics.mjs';

let failed = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed += 1;
}

const withInventory = missingFinding('stardust/dynamics/parity.json', 'stardust/dynamic-features.md');
expect('inventory but no parity file → parity-missing error', withInventory.id === 'parity-missing' && withInventory.severity === 'error', withInventory.message);
expect('no inventory, no parity file → info', missingFinding('stardust/dynamics/parity.json', null).severity === 'info');

const out = uncheckedFindings([
  { feature: 'demo form', class: 'F', status: 'planned' },
  { feature: 'video', class: 'V', status: 'pending media' },
  { feature: 'checked form', class: 'F', status: 'done', checks: [{ type: 'form-flow' }] },
  { feature: 'chat', class: 'T', status: 'decided-out' },
]);
expect('an unchecked form → parity-unchecked warn', out.find((f) => /demo form/.test(f.message))?.severity === 'warn');
expect('an unchecked non-form → info', out.find((f) => /video/.test(f.message))?.severity === 'info');
expect('checked and decided-out rows → no finding', out.length === 2, `${out.length} findings`);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
