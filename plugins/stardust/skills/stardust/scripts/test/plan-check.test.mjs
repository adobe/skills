#!/usr/bin/env node
// skills/stardust/scripts/test/plan-check.test.mjs — plan-check.mjs: --help, buildRun() from state.json /
// ledger / unit ledgers, legalFor() per flow, off / no key skip, a shadow run against a fake endpoint and
// gate mode exiting 2 on a REVIEW. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL, buildRun, legalFor } from '../plan-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const SCRIPT = join(HERE, '..', 'plan-check.mjs');
const root = mkdtempSync(join(tmpdir(), 'plan-check-test-')); const sd = join(root, 'stardust'); mkdirSync(join(sd, 'rollout'), { recursive: true }); let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const runSync = (args, env = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });
writeFileSync(join(sd, 'state.json'), JSON.stringify({ flow: 'replica', handsOff: true, pages: [{ slug: 'a', status: 'approved' }, { slug: 'b', status: 'directed' }] }));
writeFileSync(join(sd, 'rollout', 'progress.json'), JSON.stringify({ units: { 'C0-foundation': { status: 'done' }, 'C-archetype:article': { status: 'pending' } } }));
writeFileSync(join(sd, 'status.jsonl'), '{"ts":"t","skill":"stardust:rollout","phase":"C-deliver","event":"start"}\n');

await check('--help / no args', () => { assert.equal(runSync(['--help']).code, 0); assert.match(runSync([]).out, /plan-check\.mjs/); });
await check('buildRun and legalFor', () => {
  const run = buildRun(sd); assert.equal(run.flow, 'replica'); assert.equal(run.handsOff, true); assert.match(run.phaseSummary, /approved 1 · directed 1/); assert.equal(run.units['rollout:C-archetype:article'], 'pending'); assert.match(run.lastLedger[0], /C-deliver start/);
  assert.ok(legalFor('replica')['migrate-siblings'] && legalFor('replica')['read-state']); assert.ok(!legalFor('replica')['direct-prep']); assert.ok(legalFor('redesign')['direct-prep']); assert.ok(legalFor(null)['direct-prep'], 'no flow → the union'); assert.ok(LEGAL.common['qa-sweep']);
});
await check('off / no key / usage', () => { assert.match(runSync(['do x']).out, /decider off/); assert.match(runSync(['do x'], { STARDUST_DECIDER: 'shadow' }).out, /no \$TYPESAFE_API_KEY/); assert.equal(runSync(['--mode', 'shadow']).code, 2); });

const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const p = JSON.parse(b).state.proposal; const oo = /siblings/.test(p) ? 0.92 : 0.05; const step = /siblings/.test(p) ? 'migrate-siblings' : 'read-state';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { step: { type: 'choice', choice: step, confidence: 0.9, probabilities: { [step]: 0.92 } }, out_of_order: { type: 'noul', noul: oo }, wrong_flow: { type: 'noul', noul: 0.03 }, resume_from_memory: { type: 'noul', noul: 0.02 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const env = { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
await check('shadow: REVIEW on an out-of-order proposal, exit 0; clean proposal no REVIEW', async () => {
  let r = await runAsync(['render the article siblings now'], env); assert.equal(r.code, 0, r.err); assert.match(r.out, /migrate-siblings \(0\.90\) · out-of-order 0\.92/); assert.match(r.out, /REVIEW/);
  r = await runAsync(['tail the ledger and summarise state'], env); assert.equal(r.code, 0); assert.doesNotMatch(r.out, /REVIEW/);
});
await check('gate: exit 2 on REVIEW', async () => { const r = await runAsync(['render the article siblings now'], { ...env, STARDUST_DECIDER: 'gate' }); assert.equal(r.code, 2); });
server.close(); rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
