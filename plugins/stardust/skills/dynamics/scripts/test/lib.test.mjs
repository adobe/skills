#!/usr/bin/env node
// lib.mjs settlePage — the CONSENT_ACCEPT click is the fallback when the shared consent pass clicks nothing.
// And the four browser CLIs: a copy without the master scripts stops with the copy instruction, no stack trace.
// Run: node plugins/stardust/skills/dynamics/scripts/test/lib.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONSENT_ACCEPT, settlePage } from '../lib.mjs';

let failures = 0;
async function check(name, fn) {
  try { await fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}

// what settlePage and the shared consent pass touch on a page; `locator` decides what the shared pass finds
function stubPage(locator) {
  const calls = [];
  const page = {
    calls,
    click: async (sel, opts) => { calls.push([sel, opts]); throw new Error('no dialog'); },
    waitForTimeout: async () => {},
    mouse: { wheel: async () => {} },
    evaluate: async () => {},
    locator,
  };
  return page;
}
const none = { locator: () => none, count: async () => 0 };
const button = { click: async () => {}, waitForElementState: async () => {} };
const found = { locator: () => found, first: () => found, count: async () => 1, elementHandle: async () => button };
const OPTS = { settleMs: 0, maxScroll: 0 };

await check('shared pass finds no dialog: the CONSENT_ACCEPT click runs once and its error is swallowed', async () => {
  const page = stubPage(() => none);
  await settlePage(page, OPTS);
  assert.deepEqual(page.calls, [[CONSENT_ACCEPT, { timeout: 3000 }]]);
});

await check('shared pass throws: the CONSENT_ACCEPT click runs once and its error is swallowed', async () => {
  const page = stubPage(() => { throw new Error('locator broke'); });
  await settlePage(page, OPTS);
  assert.deepEqual(page.calls, [[CONSENT_ACCEPT, { timeout: 3000 }]]);
});

await check('CONSENT_ACCEPT lists the known consent buttons', () => {
  assert.equal(typeof CONSENT_ACCEPT, 'string');
  assert.ok(CONSENT_ACCEPT.includes('#onetrust-accept-btn-handler'));
  assert.ok(CONSENT_ACCEPT.includes('button[title*="accept all" i]'));
});

await check('shared pass clicks a button: the CONSENT_ACCEPT click is skipped', async () => {
  const page = stubPage(() => found);
  await settlePage(page, OPTS);
  assert.deepEqual(page.calls, []);
});

await check('lib.mjs copied flat into stardust/scripts/ finds the front door in stardust/scripts/stardust/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dynamics-flat-'));
  try {
    const flat = join(root, 'stardust', 'scripts');
    mkdirSync(join(flat, 'stardust'), { recursive: true });
    writeFileSync(join(flat, 'lib.mjs'), readFileSync(new URL('../lib.mjs', import.meta.url), 'utf8'));
    writeFileSync(join(flat, 'stardust', 'browser.mjs'), 'export const acceptConsent = async () => true;\n');
    const flatLib = await import(new URL(`file://${join(flat, 'lib.mjs')}`).href);
    const page = stubPage(() => none);
    await flatLib.settlePage(page, OPTS);
    assert.deepEqual(page.calls, [], 'the fake acceptConsent ran, so the fallback click did not');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

await check('a copy without the master scripts: each browser CLI stops with the copy instruction, exit 1, no stack trace', () => {
  const root = mkdtempSync(join(tmpdir(), 'dynamics-no-master-'));
  try {
    const dir = join(root, 'a', 'b'); // no stardust/ beside, above or below it
    cpSync(new URL('..', import.meta.url), dir, { recursive: true, filter: (src) => !src.endsWith('/test') });
    writeFileSync(join(dir, 'calls.json'), '[]');
    writeFileSync(join(dir, 'parity.json'), '{"features":[]}');
    const origin = 'http://localhost:9';
    const runs = [
      ['dynamics-detect.mjs', '--urls', `${origin}/`],
      ['snapshot-forms.mjs', '--urls', `${origin}/`],
      ['snapshot-api.mjs', '--origin', origin, '--calls', 'calls.json'],
      ['dynamics-check.mjs', '--origin', origin, '--parity', 'parity.json'],
    ];
    for (const [script, ...args] of runs) {
      const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 1, `${script}: exit ${r.status}\n${r.stderr}`);
      assert.ok(r.stderr.includes('browser.mjs not found') && r.stderr.includes('stardust/scripts/stardust/'), `${script}: ${r.stderr}`);
      assert.ok(!/^\s+at /m.test(r.stderr), `${script} printed a stack trace:\n${r.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('lib: all checks passed');
