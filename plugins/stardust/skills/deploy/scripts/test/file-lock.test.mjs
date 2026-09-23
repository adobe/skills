#!/usr/bin/env node
// Contract test for deploy/scripts/file-lock.mjs: mutual exclusion across processes (N children
// each do 20 locked read-increment-writes of one counter file → exact total), a stale lock is
// reclaimed, a held lock times out naming the owner, mergeLedger keeps the other writer's rows and
// lets this process's rows win, writeJSONAtomic leaves no tmp file. Pure node, no network.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireLock, withLock, mergeLedger, writeJSONAtomic, readLedger } from '../file-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'file-lock.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'file-lock-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

await check('N processes incrementing one counter under the lock lose nothing', async () => {
  const counter = join(tmp, 'counter.json');
  writeFileSync(counter, '{"n":0}\n');
  const child = `
    import { withLock } from ${JSON.stringify(LIB)};
    import { readFileSync, writeFileSync } from 'node:fs';
    for (let i = 0; i < 20; i++) withLock(${JSON.stringify(counter)}, () => {
      const d = JSON.parse(readFileSync(${JSON.stringify(counter)}, 'utf8')); d.n += 1;
      writeFileSync(${JSON.stringify(counter)}, JSON.stringify(d));
    });`;
  const kids = Array.from({ length: 6 }, () => new Promise((res) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => res({ code, err }));
  }));
  const rs = await Promise.all(kids);
  for (const r of rs) assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(counter, 'utf8')).n, 120);
  assert.ok(!existsSync(`${counter}.lock`), 'lock dir released');
});

await check('a stale lock (older than staleMs) is reclaimed', () => {
  const t = join(tmp, 'stale.json');
  mkdirSync(`${t}.lock`); writeFileSync(join(`${t}.lock`, 'owner'), '1 long ago\n');
  const old = (Date.now() - 120000) / 1000; utimesSync(`${t}.lock`, old, old);
  const release = acquireLock(t, { staleMs: 60000, timeoutMs: 2000 });
  assert.ok(existsSync(join(`${t}.lock`, 'owner')));
  assert.match(readFileSync(join(`${t}.lock`, 'owner'), 'utf8'), new RegExp(`^${process.pid} `));
  release();
  assert.ok(!existsSync(`${t}.lock`));
});

await check('a lock held by a live writer makes a second acquire time out, naming the owner', () => {
  const t = join(tmp, 'held.json');
  const release = acquireLock(t);
  assert.throws(() => acquireLock(t, { timeoutMs: 300, pollMs: 20 }), new RegExp(`held for over 300 ms \\(owner ${process.pid} `));
  release();
  const r2 = acquireLock(t, { timeoutMs: 300 }); r2();
});

await check('mergeLedger keeps rows another writer added and lets this process\'s rows win', () => {
  const l = join(tmp, 'ledger', 'media.json');
  writeJSONAtomic(l, { '/a.png': { status: 'uploaded', by: 'cluster-1' }, '/shared.png': { status: 'failed', by: 'cluster-1' } });
  const merged = mergeLedger(l, { '/b.png': { status: 'uploaded', by: 'cluster-2' }, '/shared.png': { status: 'uploaded', by: 'cluster-2' } });
  assert.deepEqual(Object.keys(merged).sort(), ['/a.png', '/b.png', '/shared.png']);
  assert.equal(merged['/shared.png'].by, 'cluster-2');
  assert.deepEqual(JSON.parse(readFileSync(l, 'utf8')), merged);
  assert.ok(readFileSync(l, 'utf8').endsWith('}\n'));
  assert.deepEqual(readdirSync(dirname(l)), ['media.json'], 'no tmp file, no lock dir left');
});

await check('a malformed ledger on disk is reported and overwritten with this process\'s rows only', () => {
  const l = join(tmp, 'bad.json'); writeFileSync(l, '{not json');
  let bad = null;
  const merged = mergeLedger(l, { '/x.png': { status: 'uploaded' } }, { onBad: (e) => { bad = e; } });
  assert.ok(bad instanceof Error);
  assert.deepEqual(merged, { '/x.png': { status: 'uploaded' } });
  assert.deepEqual(readLedger(l), merged);
});

console.log(failed ? `file-lock: ${failed} check(s) failed` : 'file-lock: all checks passed');
process.exit(failed ? 1 : 0);
