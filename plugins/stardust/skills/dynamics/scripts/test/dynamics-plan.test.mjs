#!/usr/bin/env node
// skills/dynamics/scripts/test/dynamics-plan.test.mjs — the dynamics-plan.mjs decide contract (#127):
// --help before I/O; the draft without --decide is unchanged; --decide with the decider off adds one
// "decide: off" note and no jev fields; --decide in shadow against a fake endpoint attaches `jev` to
// every row (class / disposition / reproducibility with probabilities, route, review on a confident
// class disagreement), appends the notes column and writes decisions.jsonl beside state.json.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'dynamics-plan.mjs');
const root = mkdtempSync(join(tmpdir(), 'dynamics-plan-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const runSync = (args, env = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });

mkdirSync(join(root, 'stardust', 'current'), { recursive: true }); mkdirSync(join(root, 'stardust', 'dynamics'), { recursive: true });
writeFileSync(join(root, 'stardust', 'state.json'), JSON.stringify({ runId: 'D-1', pages: [] }));
writeFileSync(join(root, 'stardust', 'current', '_dynamics.json'), JSON.stringify({ _provenance: {}, pages: { '/': {}, '/a': {} }, reach: {}, findings: [
  { id: 'm-modal', class: 'M', feature: 'dialog opened from a trigger', evidence: ['aria-haspopup=dialog'], pages: ['/', '/a'] },
  { id: 'a-unknown-host', class: 'A', feature: 'unknown third-party host cdn.example.com', hint: 'inspect', evidence: ['cdn.example.com'], pages: ['/'] },
] }));
const IN = join(root, 'stardust', 'current', '_dynamics.json'); const OUT = join(root, 'stardust', 'dynamics');

await check('--help exits 0', () => { const r = runSync(['--help']); assert.equal(r.code, 0); assert.match(r.out, /dynamics-plan\.mjs/); assert.match(r.out, /--decide/); });

await check('without --decide: draft as before, no jev', () => {
  const r = runSync(['--in', IN, '--out', OUT]); assert.equal(r.code, 0, r.err);
  const j = JSON.parse(readFileSync(join(OUT, 'dynamic-features.generated-plan.json'), 'utf8')); assert.equal(j.rows.length, 2); assert.ok(!('jev' in j.rows[0])); assert.equal(j._provenance.decide ?? null, null);
  assert.doesNotMatch(r.err, /decide/);
});

await check('--decide with the decider off: one note, no jev, no ledger', () => {
  const r = runSync(['--in', IN, '--out', OUT, '--decide']); assert.equal(r.code, 0, r.err); assert.match(r.err, /decide: off/);
  const j = JSON.parse(readFileSync(join(OUT, 'dynamic-features.generated-plan.json'), 'utf8')); assert.ok(!('jev' in j.rows[0])); assert.equal(existsSync(join(root, 'stardust', 'decisions.jsonl')), false);
  const r2 = runSync(['--in', IN, '--out', OUT, '--decide', '--mode', 'shadow']); assert.equal(r2.code, 0); assert.match(r2.err, /no \$TYPESAFE_API_KEY/);
});

const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const body = JSON.parse(b); const isModal = /dialog/.test(body.state.feature.description);
  const cls = isModal ? 'M' : 'T'; // the unknown host: catalogue says A, model says T → confident disagreement
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { class: { type: 'choice', choice: cls, confidence: 0.93, probabilities: { [cls]: 0.95 } }, disposition: { type: 'choice', choice: isModal ? 'rebuild-native' : 'embed-passthrough', confidence: 0.6, probabilities: {} }, reproducibility: { type: 'choice', choice: 'self', confidence: 0.5, probabilities: {} }, regulated_pii: { type: 'noul', noul: 0.02 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;

await check('--decide in shadow: jev on every row, review on the confident class disagreement, notes column, ledger written', async () => {
  const r = await runAsync(['--in', IN, '--out', OUT, '--decide'], { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: endpoint });
  assert.equal(r.code, 0, r.err); assert.match(r.err, /decide \[shadow\]: class agrees 1\/2 · class review 1/);
  const j = JSON.parse(readFileSync(join(OUT, 'dynamic-features.generated-plan.json'), 'utf8'));
  const modal = j.rows.find((x) => x.id === 'm-modal'); const host = j.rows.find((x) => x.id === 'a-unknown-host');
  assert.equal(modal.jev.class, 'M'); assert.equal(modal.jev.review, false); assert.equal(host.jev.class, 'T'); assert.equal(host.jev.review, true);
  assert.equal(host.class, 'A', 'shadow never changes the catalogue answer'); assert.equal(host.disposition, 'static-snapshot');
  const md = readFileSync(join(OUT, 'dynamic-features.generated-plan.md'), 'utf8'); assert.match(md, /jev: class T 0\.93 REVIEW · disp embed-passthrough 0\.60/);
  const led = readFileSync(join(root, 'stardust', 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(led.length, 2); assert.equal(led[0].battery, 'dynamics-triage'); assert.equal(led[0].runId, 'D-1'); assert.ok(led[0].agent && led[0].agreement);
});

server.close();
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
