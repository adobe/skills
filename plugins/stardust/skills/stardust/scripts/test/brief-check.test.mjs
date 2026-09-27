#!/usr/bin/env node
// skills/stardust/scripts/test/brief-check.test.mjs — brief-check.mjs: --help, classify() thresholds and
// the blocking set, off / no key skip lines, a shadow run against a fake endpoint (missing + unsure lines,
// exit 0) and gate mode exiting 2 on a missing required item. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REQUIRED, ITEMS, classify } from '../brief-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const SCRIPT = join(HERE, '..', 'brief-check.mjs');
const root = mkdtempSync(join(tmpdir(), 'brief-check-test-')); let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const runSync = (args, env = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });
writeFileSync(join(root, 'brief.md'), 'You are the archetype agent for the home page. Work only inside stardust/prototypes/home-*. Run node stardust/scripts/replica/gate.sh home … 1440 iter1 --full. Write ledger.mjs start/end lines.');

await check('--help / no args exit 0', () => { assert.equal(runSync(['--help']).code, 0); assert.match(runSync([]).out, /brief-check\.mjs/); });
await check('classify: thresholds and blocking set', () => {
  const answers = Object.fromEntries(ITEMS.map((i, k) => [i, { noul: [0.95, 0.1, 0.5, 0.9, 0.2, 0.85][k] }]));
  const c = classify(answers, DEFAULT_REQUIRED);
  assert.deepEqual(c.missing, ['carries_gate_commands', 'forbids_shortcuts']); assert.deepEqual(c.unsure, ['cites_contract_sections']); assert.deepEqual(c.blocking, ['carries_gate_commands'], 'forbids_shortcuts is advisory');
});
await check('off and no key skip', () => { let r = runSync(['brief.md']); assert.equal(r.code, 0); assert.match(r.out, /decider off/); r = runSync(['brief.md'], { STARDUST_DECIDER: 'shadow' }); assert.match(r.out, /no \$TYPESAFE_API_KEY/); assert.equal(runSync(['nope.md', '--mode', 'shadow']).code, 2); });

const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const brief = JSON.parse(b).state.brief; const has = (re) => (re.test(brief) ? 0.95 : 0.05);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { names_owned_paths: { type: 'noul', noul: has(/Work only inside/) }, carries_gate_commands: { type: 'noul', noul: has(/gate\.sh/) }, cites_contract_sections: { type: 'noul', noul: 0.5 }, requires_ledger_lines: { type: 'noul', noul: has(/ledger\.mjs/) }, forbids_shortcuts: { type: 'noul', noul: 0.05 }, bounded_scope: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const env = { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
await check('shadow run: missing + unsure lines, exit 0', async () => { const r = await runAsync(['brief.md', '--phase', 'archetype'], env); assert.equal(r.code, 0, r.err); assert.match(r.out, /brief-check \[shadow\]: 1 item\(s\) missing — forbids_shortcuts · unsure — cites_contract_sections/); assert.match(r.out, /present {2}0\.95 {2}names_owned_paths/); });
await check('gate run: exit 2 when a required item is missing', async () => { const r = await runAsync(['brief.md', '--require', 'forbids_shortcuts'], { ...env, STARDUST_DECIDER: 'gate' }); assert.equal(r.code, 2); assert.match(r.out, /do not dispatch/); const ok = await runAsync(['brief.md'], { ...env, STARDUST_DECIDER: 'gate' }); assert.equal(ok.code, 0, 'the default required set is all present'); });
server.close(); rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
