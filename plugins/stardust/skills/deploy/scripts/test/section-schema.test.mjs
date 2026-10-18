#!/usr/bin/env node
// skills/deploy/scripts/test/section-schema.test.mjs — importing the module loads no browser and runs no CLI;
// --help answers without one. No browser.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'section-schema.mjs');
const run = (args) => spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', timeout: 15000 });

test('importing the module loads no browser and runs no CLI: a bare import exits 0 silently', () => {
  const r = run(['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout + r.stderr, '');
});

test('--help / -h: exit 0, prints the usage header', () => {
  for (const flag of ['--help', '-h']) {
    const r = run([SCRIPT, flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage:/);
  }
});
