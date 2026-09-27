#!/usr/bin/env node
// skills/replica/scripts/test/gate-flags.test.mjs — the gate-flags.mjs contract: --help before I/O,
// flag parsing (content + visual, dedup, severity, summary), gate-dir naming, the register folded into
// the policy, sort order (decisive defects by P desc, unsure by ambiguity, artefacts last), off mode and
// no key = one skip line and exit 0, missing files = exit 2, and a shadow run against a fake endpoint
// that writes flags-<label>.json and the decisions ledger two levels up. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISIVE_NO, DECISIVE_YES, buildStates, flagLines, gateName, probeSummary, severityOf, sortFlags } from '../gate-flags.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-flags.mjs');
const root = mkdtempSync(join(tmpdir(), 'gate-flags-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const runSync = (args, env = {}, cwd = root) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}, cwd = root) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });

const proj = join(root, 'proj'); const gate = join(proj, 'stardust', 'replica', 'gates', 'home-1440'); mkdirSync(gate, { recursive: true });
writeFileSync(join(gate, 'content-diff-iter1.txt'), `\nContent diff @ 1440px (profile "generic", root "main")\n  source: 21 text nodes — 1 headings, 0 eyebrows, 15 CTAs, 5 body; 15 img\n  build: 18 text nodes — 1 headings, 0 eyebrows, 15 CTAs, 2 body; 15 img\n\nFindings: 3 (1 structural 🔴)\n  🔴 MISSING CTA: source cta "Shop now" → /shop has no build link. A link present in the source is absent in the build\n  🟡 MISSING BODY: source body "{"@context":"https://schema.org"… not found in build. Source body copy not found in the build — confirm a rewrite vs a drop.\n  🟡 MISSING BODY: source body "{"@context":"https://schema.org"… not found in build. Source body copy not found in the build — confirm a rewrite vs a drop.\n`);
writeFileSync(join(gate, 'visual-diff-iter1.txt'), `\nVisual diff @ 1440px (profile "generic")\n\nbuild red flags (advisory):\n  STRETCHED IMAGE x31 (1440)\n\nFull metrics JSON:\n{}\n`);
writeFileSync(join(proj, 'stardust', 'replica', 'inconsistency-register.md'), '# Register\n\n| R-01 | hero CTA colour lifted to brand red | accepted |\n');

await check('--help exits 0 before any I/O; no args prints usage', () => { let r = runSync(['--help']); assert.equal(r.code, 0); assert.match(r.out, /gate-flags\.mjs/); r = runSync([]); assert.equal(r.code, 0); assert.match(r.out, /gate-flags\.mjs/); });

await check('parsing: flag lines from both probes, dedup, severity, summary, gate name, register in the policy', () => {
  const items = buildStates(gate, 'iter1', { regime: 'prototype', register: readFileSync(join(proj, 'stardust', 'replica', 'inconsistency-register.md'), 'utf8') });
  assert.equal(items.length, 3, 'two identical JSON-LD lines collapse to one');
  assert.deepEqual(items.map((i) => i.state.flag.severity), ['red', 'yellow', 'advisory']);
  assert.equal(items[2].state.flag.probe, 'visual'); assert.match(items[0].state.gate.summary, /source: 21 text nodes/);
  assert.deepEqual(gateName(gate), { page: 'home', width: 1440 }); assert.deepEqual(gateName('/x/canon'), { page: 'canon', width: null });
  assert.match(items[0].state.policy, /Inconsistency register:/); assert.match(items[0].state.policy, /R-01/);
  assert.equal(severityOf('🟠 EXTRA x'), 'orange'); assert.equal(flagLines('  🔴 short\n  🟡 MISSING BODY: something long enough\n').length, 1, 'too-short lines dropped');
  assert.equal(probeSummary('Findings: 2\nfoo\n  build: 1'), 'Findings: 2\nbuild: 1');
});

await check('sortFlags: decisive defects first by P desc, unsure by ambiguity, artefacts last by P asc', () => {
  const mk = (p, line) => ({ answers: { defect: { noul: p } }, line });
  const s = sortFlags([mk(0.9, 'a'), mk(0.1, 'b'), mk(0.5, 'c'), mk(0.97, 'd'), mk(0.02, 'e'), mk(0.7, 'f')]);
  assert.deepEqual(s.decisiveDefect.map((r) => r.line), ['d', 'a']); assert.deepEqual(s.unsure.map((r) => r.line), ['c', 'f']); assert.deepEqual(s.notDefect.map((r) => r.line), ['e', 'b']);
  assert.equal(DECISIVE_YES, 0.85); assert.equal(DECISIVE_NO, 0.15);
});

await check('off / no key / missing files', () => {
  let r = runSync([gate, 'iter1'], {}, proj); assert.equal(r.code, 0, r.err); assert.match(r.out, /decider off/); assert.equal(existsSync(join(gate, 'flags-iter1.json')), false);
  r = runSync([gate, 'iter1'], { STARDUST_DECIDER: 'shadow' }, proj); assert.equal(r.code, 0); assert.match(r.out, /no \$TYPESAFE_API_KEY/);
  r = runSync([gate, 'iter9', '--mode', 'shadow'], {}, proj); assert.equal(r.code, 2); assert.match(r.err, /no content-diff-iter9/);
  r = runSync([join(root, 'nope'), 'iter1', '--mode', 'shadow'], {}, proj); assert.equal(r.code, 2);
  r = runSync([gate, 'iter1', '--mode', 'shadow', '--dry-run'], {}, proj); assert.equal(r.code, 0); assert.equal(JSON.parse(r.out).flags, 3); assert.equal(existsSync(join(gate, 'flags-iter1.json')), false);
});

const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const body = JSON.parse(b); const line = body.state.flag.line; const p = /MISSING CTA/.test(line) ? 0.95 : /schema\.org/.test(line) ? 0.06 : 0.52;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { defect: { type: 'noul', noul: p }, artefact: { type: 'noul', noul: 1 - p }, intended: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;

await check('shadow run: sorted verdict lines, flags-<label>.json, ledger two levels up, exit 0', async () => {
  const r = await runAsync([gate, 'iter1', '--register', join(proj, 'stardust', 'replica', 'inconsistency-register.md')], { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: endpoint }, proj);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trim().split('\n'); assert.match(lines[0], /decide: flags 3 — defect ≥0.85: 1 · not a defect ≤0.15: 1 · unsure: 1/); assert.match(lines[0], /\[shadow\]/);
  assert.match(lines[1], /^decide: {3}defect {3}0\.95 {2}🔴 MISSING CTA/); assert.match(lines[2], /^decide: {3}unsure {3}0\.52 {2}STRETCHED/); assert.match(lines[3], /^decide: {3}artefact 0\.06 {2}🟡 MISSING BODY/);
  const j = JSON.parse(readFileSync(join(gate, 'flags-iter1.json'), 'utf8')); assert.equal(j.flags.length, 3); assert.equal(j.thresholds.defect, 0.85);
  const led = readFileSync(join(proj, 'stardust', 'decisions.jsonl'), 'utf8').trim().split('\n'); assert.equal(led.length, 3); assert.equal(JSON.parse(led[0]).battery, 'flag-justify');
});

server.close();
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
