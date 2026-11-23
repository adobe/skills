#!/usr/bin/env node
// skills/dynamics/scripts/test/sync-sheets.test.mjs — the sync-sheets CLI's token and usage handling: every
// failure here exits 2 before any request leaves the machine, and a message names the token source, never a value.
// No network: each case stops at argument or token resolution, ahead of the first fetch.
// Run: node plugins/stardust/skills/dynamics/scripts/test/sync-sheets.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'sync-sheets.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const tmp = mkdtempSync(join(tmpdir(), 'sync-sheets-'));
const BASE = ['--source', 'http://127.0.0.1:9', '--org', 'o', '--repo', 'r', '--paths', 'placeholders.json', '--log', join(tmp, 'log')];
const env = { ...process.env };
delete env.DA_TOKEN; delete env.ADOBE_IMS_TOKEN_FILE;
const run = (args, extra = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: tmp, encoding: 'utf8', env: { ...env, ...extra } });

check('missing --paths → usage, exit 2', () => {
  const r = run(['--source', 'http://x', '--org', 'o', '--repo', 'r']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: sync-sheets\.mjs/);
});

check('--token-file with no value → "needs a value", exit 2', () => {
  const r = run([...BASE, '--token-file']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--token-file needs a value/);
});

check('--token-env with no value → "needs a value", exit 2', () => {
  const r = run([...BASE, '--token-env', '--token-file', 'x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--token-env needs a value/);
});

check('unreadable --token-file → exit 2, names the file, writes no log', () => {
  const missing = join(tmp, 'nope.txt');
  const r = run([...BASE, '--token-file', missing]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(missing), r.stderr);
  assert.ok(!existsSync(join(tmp, 'log', '_sync.json')));
});

check('empty --token-file → exit 2, never prints a value', () => {
  const f = join(tmp, 'empty.txt'); writeFileSync(f, '  \n');
  const r = run([...BASE, '--token-file', f]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(f), r.stderr);
});

check('no DA_TOKEN and no ADOBE_IMS_TOKEN_FILE → exit 2 naming DA_TOKEN', () => {
  const r = run(BASE);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /DA_TOKEN/);
});

check('ADOBE_IMS_TOKEN_FILE pointing nowhere → exit 2, names the file', () => {
  const missing = join(tmp, 'ims.txt');
  const r = run(BASE, { ADOBE_IMS_TOKEN_FILE: missing });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(missing), r.stderr);
});

check('--help prints the header and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sync-sheets\.mjs — copy sheet-backed JSON/);
});

rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
