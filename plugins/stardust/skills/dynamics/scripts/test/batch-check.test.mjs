#!/usr/bin/env node
// skills/dynamics/scripts/test/batch-check.test.mjs — batch-check.mjs: --help, pendingFrom() on an
// inventory table, off / no key skip, a shadow run against a fake endpoint (REVIEW on a serial message,
// none on a batch), gate exit 2. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pendingFrom } from '../batch-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const SCRIPT = join(HERE, '..', 'batch-check.mjs');
const root = mkdtempSync(join(tmpdir(), 'batch-check-test-')); mkdirSync(join(root, 'stardust')); let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const runSync = (args, env = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });
const inv = '| # | id | feature | class | reach | disposition | reproducibility | status |\n|---|---|---|---|---|---|---|---|\n| 1 | tags | GTM | T | 10/10 | embed-passthrough | needs-credential | pending |\n| 2 | forms | contact | F | 3/10 | rebuild-native | needs-backend | pending |\n| 3 | menu | nav | M | 10/10 | rebuild-native | self | done |\n';
writeFileSync(join(root, 'stardust', 'dynamic-features.md'), inv);
writeFileSync(join(root, 'serial.md'), 'Quick question: do you have the GTM container id? I will wait.');
writeFileSync(join(root, 'batch.md'), 'Owner batch (complete): 1 GTM container id — interim: no tags load. 2 form endpoint — interim: stub + log.');

await check('--help / no args', () => { assert.equal(runSync(['--help']).code, 0); assert.match(runSync([]).out, /batch-check\.mjs/); });
await check('pendingFrom picks needs-* rows only', () => { assert.deepEqual(pendingFrom(inv), ['tags (needs-credential)', 'forms (needs-backend)']); });
await check('off / no key', () => { assert.match(runSync(['serial.md']).out, /decider off/); assert.match(runSync(['serial.md'], { STARDUST_DECIDER: 'shadow' }).out, /no \$TYPESAFE_API_KEY/); });
const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const m = JSON.parse(b).state.message; const batch = /batch/i.test(m) ? 0.95 : 0.05;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { one_batch: { type: 'noul', noul: batch }, each_decision_named: { type: 'noul', noul: batch }, interim_recorded: { type: 'noul', noul: batch }, covers_pending: { type: 'noul', noul: batch } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const env = { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
await check('shadow: REVIEW on serial, none on batch; covers 2 pending', async () => {
  let r = await runAsync(['serial.md'], env); assert.equal(r.code, 0, r.err); assert.match(r.out, /one batch 0\.05/); assert.match(r.out, /covers 2 pending/); assert.match(r.out, /REVIEW/);
  r = await runAsync(['batch.md'], env); assert.doesNotMatch(r.out, /REVIEW/);
});
await check('gate: exit 2 on REVIEW', async () => { const r = await runAsync(['serial.md'], { ...env, STARDUST_DECIDER: 'gate' }); assert.equal(r.code, 2); });
server.close(); rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
