#!/usr/bin/env node
// dynamics-plan.mjs — martech contract + handoff from `_dynamics.json#martech`; tag rows take its status.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-plan.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../dynamics-plan.mjs', import.meta.url).pathname;
let failures = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}

const tag = (role, host) => ({
  id: role, class: 'T', feature: role, role, evidence: [host], pages: ['/'],
});
const FINDINGS = [
  tag('consent: OneTrust', 'cdn.cookielaw.org'),
  tag('tag manager: Adobe Launch', 'assets.adobedtm.com'),
  tag('marketing: ad / retargeting pixel', 'connect.facebook.net'),
];
const MARTECH = {
  sourceHosts: ['www.example.test'],
  staticScripts: [
    { src: 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', attrs: { 'data-domain-script': '0a1b2c3d-1111-2222-3333-444455556666' } },
    { src: 'https://assets.adobedtm.com/abc/def/launch-0f1e2d3c.min.js', attrs: {} },
  ],
  urls: ['https://connect.facebook.net/en_US/fbevents.js'],
};

function run(martech, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-plan-'));
  try {
    writeFileSync(join(dir, 'in.json'), JSON.stringify({ pages: { '/': {} }, findings: FINDINGS, ...(martech && { martech }) }));
    const args = [SCRIPT, '--in', 'in.json', '--out', 'plan', '--contract', 'stardust/martech-contract.json'];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const read = (p) => readFileSync(join(dir, p), 'utf8');
    const plan = JSON.parse(read('plan/dynamic-features.generated-plan.json'));
    fn({ dir, read, rows: Object.fromEntries(plan.rows.map((x) => [x.feature, x])) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

check('writes the contract and the handoff next to it', () => run(MARTECH, ({ read }) => {
  const c = JSON.parse(read('stardust/martech-contract.json'));
  assert.deepEqual(c.productionHosts, ['www.example.test']);
  assert.equal(c.consent.cmp, 'onetrust');
  assert.equal(c.routes[0].id, 'adobe-launch');
  assert.match(read('stardust/martech-handoff.md'), /# Martech handoff/);
  assert.match(read('plan/dynamic-features.generated-plan.md'), /\*\*Martech contract:\*\* `stardust\/martech-contract\.json`/);
}));

check('tag rows take their status from the contract', () => run(MARTECH, ({ rows }) => {
  const cmp = rows['consent: OneTrust'];
  assert.deepEqual([cmp.martech, cmp.reproducibility, cmp.status], ['host-gated', 'self', 'pending']);
  assert.equal(rows['tag manager: Adobe Launch'].martech, 'host-gated');
  const pixel = rows['marketing: ad / retargeting pixel'];
  assert.deepEqual([pixel.martech, pixel.decision], ['via-tag-manager', 'none (ships inside the tag manager route)']);
}));

check('a source vendor outside any tag manager awaits the owner', () => run({ ...MARTECH, staticScripts: [] }, ({ rows }) => {
  const pixel = rows['marketing: ad / retargeting pixel'];
  assert.deepEqual([pixel.martech, pixel.status], ['scaffolded-awaiting-owner', 'scaffolded-awaiting-owner']);
  assert.notEqual(pixel.disposition, 'decided-out');
}));

check('input without martech evidence writes no contract and says so', () => run(null, ({ dir, read, rows }) => {
  assert.ok(!existsSync(join(dir, 'stardust/martech-contract.json')));
  assert.match(read('plan/dynamic-features.generated-plan.md'), /re-run `dynamics-detect\.mjs`/);
  assert.equal(rows['consent: OneTrust'].martech, undefined);
}));

check('--help names --contract', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.match(r.stdout, /--contract stardust\/martech-contract\.json/);
});

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('dynamics-plan: all checks passed');
