#!/usr/bin/env node
// dynamics-plan.mjs — the martech contract is opt-in: without --martech the outputs are unchanged.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-plan.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../dynamics-plan.mjs', import.meta.url).pathname;
let failures = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}

const INPUT = {
  pages: { '/': { host: 'www.example.com', scripts: ['https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', 'https://assets.adobedtm.com/abc/launch-0f1e.min.js'] } },
  findings: [{ id: 'T1', class: 'T', feature: 'tag manager: Adobe Launch', role: 'tag manager: Adobe Launch', evidence: ['assets.adobedtm.com'], pages: ['/'] }],
};

function run(args, fn, dir = mkdtempSync(join(tmpdir(), 'sd-plan-'))) {
  try {
    writeFileSync(join(dir, 'in.json'), JSON.stringify(INPUT));
    const r = spawnSync(process.execPath, [SCRIPT, '--in', 'in.json', '--out', 'plan', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    fn({ dir, read: (p) => readFileSync(join(dir, p), 'utf8') });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

check('without --martech: no contract, no martech line, rows untouched', () => run([], ({ dir, read }) => {
  assert.ok(!existsSync(join(dir, 'stardust')));
  assert.doesNotMatch(read('plan/dynamic-features.generated-plan.md'), /Martech/);
  const [row] = JSON.parse(read('plan/dynamic-features.generated-plan.json')).rows;
  assert.equal(row.status, 'pending');
}));

check('--martech <dir>: contract and handoff, evidence read from the dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-plan-'));
  mkdirSync(join(dir, 'ev'));
  writeFileSync(join(dir, 'ev', 'launch.json'), JSON.stringify({ rules: [{ id: 'RL1', name: 'PV', paths: [], selectors: [], consentGroups: ['C0002'] }], dataElements: [] }));
  run(['--martech', 'ev'], ({ read }) => {
    const c = JSON.parse(read('stardust/martech-contract.json'));
    assert.equal(c.consent.model, 'per-tag');
    assert.deepEqual(c.routes.map((r) => [r.id, r.enabled]), [['adobe-launch', false]]);
    assert.match(read('stardust/martech-handoff.md'), /# Martech hand-off/);
    assert.match(read('plan/dynamic-features.generated-plan.md'), /\*\*Martech:\*\* OneTrust · 0\/1 route\(s\) enabled/);
  }, dir);
});

check('a re-run keeps what the owner enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-plan-'));
  mkdirSync(join(dir, 'stardust'));
  writeFileSync(join(dir, 'stardust', 'martech-contract.json'), JSON.stringify({ consent: { cmp: { vendor: 'OneTrust', enabled: true, attrs: {} } }, routes: [{ id: 'adobe-launch', enabled: true, category: null }] }));
  run(['--martech'], ({ read }) => {
    const c = JSON.parse(read('stardust/martech-contract.json'));
    assert.deepEqual([c.consent.cmp.enabled, c.routes[0].enabled], [true, true]);
  }, dir);
});

check('--help documents --martech', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.match(r.stdout, /--martech/);
});

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('dynamics-plan: all checks passed');
