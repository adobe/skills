#!/usr/bin/env node
// skills/rollout/scripts/test/repair-queue.test.mjs — repair-queue.mjs: --help, rowState() from a
// fixture gate dir, priorityOf() weights, toMarkdown(), off / no key skip, a shadow run against a fake
// endpoint (json + md written, cosmetic flag, sort order, ledger beside state.json). Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARM, priorityOf, rowState, toMarkdown } from '../repair-queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const SCRIPT = join(HERE, '..', 'repair-queue.mjs');
const root = mkdtempSync(join(tmpdir(), 'repair-queue-test-')); let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const runSync = (args, env = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });
const gate = join(root, 'stardust', 'replica', 'gates', 'all-1440'); mkdirSync(join(gate, 'a'), { recursive: true }); mkdirSync(join(gate, 'b')); mkdirSync(join(gate, 'c'));
writeFileSync(join(root, 'stardust', 'state.json'), JSON.stringify({ runId: 'RQ-1', pages: [] }));
writeFileSync(join(gate, 'summary.json'), JSON.stringify({ rows: [
  { slug: 'a', path: '/a', template: 't1', tier: 'thin', pct: 15.2, heightDelta: -20, clipped: 0, content: { missing: 0, hidden: 0 }, pass: false, reasons: ['pixel 15.2 > 10'] },
  { slug: 'b', path: '/b', template: 't2', tier: 'thin', pct: 6.1, heightDelta: 55, clipped: 5, content: { missing: 12, hidden: 3 }, pass: false, reasons: ['content MISSING 12 / HIDDEN 3', 'clipped 5'] },
  { slug: 'c', path: '/c', template: 't1', tier: 'archetype', pct: 1.2, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, reasons: [] },
] }));
writeFileSync(join(gate, 'b', 'content.json'), JSON.stringify({ findings: [{ sev: '🔴', kind: 'MISSING LINK', text: 'shop products' }, { sev: '🔴', kind: 'HIDDEN LINK', text: 'details' }] }));
writeFileSync(join(gate, 'b', 'clip.json'), JSON.stringify({ summary: { textClipped: 5, controlClipped: 2 }, groups: [{ kind: 'CONTROL CLIPPED', text: 'shop products' }] }));

await check('--help', () => { const r = runSync(['--help']); assert.equal(r.code, 0); assert.match(r.out, /repair-queue\.mjs/); });
await check('rowState reads probes and summary; priorityOf weights; toMarkdown', () => {
  const s = rowState(gate, JSON.parse(readFileSync(join(gate, 'summary.json'), 'utf8')).rows[1]).row;
  assert.equal(s.content.missing, 12); assert.deepEqual(s.content.examples.slice(0, 2), ['link: shop products', 'link: details']); assert.equal(s.clipped.controlClipped, 2); assert.deepEqual(s.clippedExamples, ['shop products']);
  assert.equal(priorityOf({ reader_harm: { score: 3 }, scope: { score: 2 }, template_wide: { noul: 1 } }), 1); assert.equal(priorityOf({ reader_harm: { score: 0 }, scope: { score: 0 }, template_wide: { noul: 0 } }), 0);
  assert.match(toMarkdown({ gate: 'g', failing: 1, total: 2, mode: 'shadow', rows: [{ path: '/x', template: 't', pct: 1, heightDelta: 2, clipped: { textClipped: 0, controlClipped: 0 }, content: { missing: 0, hidden: 0 }, harm: 0.2, harmConfidence: 0.9, scope: 0.1, templateWide: 0.1, priority: 0.05, cosmetic: true }] }), /cosmetic → override candidate/);
  assert.deepEqual(HARM, ['cosmetic', 'degraded', 'broken in part', 'unusable']);
});
await check('off / no key / missing summary', () => { let r = runSync(['--gate', gate]); assert.equal(r.code, 0); assert.match(r.out, /decider off — 2 failing/); r = runSync(['--gate', gate], { STARDUST_DECIDER: 'shadow' }); assert.match(r.out, /no \$TYPESAFE_API_KEY/); assert.equal(runSync(['--gate', join(root, 'nope'), '--mode', 'shadow']).code, 2); });

const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const row = JSON.parse(b).state.row; const bad = row.content.missing > 0;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { reader_harm: { type: 'score', score: bad ? 2.6 : 0.2, confidence: 0.7, probabilities: {} }, scope: { type: 'score', score: bad ? 1.5 : 0.5, confidence: 0.6, probabilities: {} }, template_wide: { type: 'noul', noul: bad ? 0.7 : 0.2 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const env = { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
await check('shadow run: queue json + md, harmful row first, cosmetic flagged, ledger beside state.json', async () => {
  const r = await runAsync(['--gate', gate, '--out', join(root, 'stardust', 'rollout', 'repair-queue')], env); assert.equal(r.code, 0, r.err);
  assert.match(r.out, /repair-queue \[shadow\]: 2\/2 failing row\(s\) graded/); assert.match(r.out, /cosmetic 1/);
  const q = JSON.parse(readFileSync(join(root, 'stardust', 'rollout', 'repair-queue.json'), 'utf8')); assert.equal(q.rows[0].slug, 'b'); assert.equal(q.rows[1].cosmetic, true); assert.ok(q.rows[0].priority > q.rows[1].priority);
  assert.match(readFileSync(join(root, 'stardust', 'rollout', 'repair-queue.md'), 'utf8'), /\| 1 \| `\/b`/);
  const led = readFileSync(join(root, 'stardust', 'decisions.jsonl'), 'utf8').trim().split('\n'); assert.equal(led.length, 2); assert.equal(JSON.parse(led[0]).runId, 'RQ-1');
});
server.close(); rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
