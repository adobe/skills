#!/usr/bin/env node
// evals/harness-smoke/test/checks.test.mjs — the pure part of the smoke: listing parsing across the
// harnesses' answer styles, heading extraction, and every verifier against a faked workspace. No
// harness, no browser. Run: node <this file>.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, GOLDEN_A, SKILLS, firstH2, listedNames } from '../checks.mjs';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');
const by = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
const root = mkdtempSync(join(tmpdir(), 'smoke-checks-'));
const put = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('listedNames reads Claude, Copilot, Codex and bulleted styles', () => {
  const n = listedNames('- stardust:extract\n* `deploy` — convert prototypes\n/qa\n$spec\n1. impeccable (design)\nskill:diff');
  for (const s of ['extract', 'deploy', 'qa', 'spec', 'impeccable', 'diff']) assert.ok(n.has(s), s);
  assert.ok(listedNames('stardust\nprepare-migration').has('prepare-migration'));
});

check('listing passes only with all 16 + impeccable', () => {
  assert.equal(by.listing.verify(root, { out: [...SKILLS, 'impeccable', 'other'].join('\n') }).pass, true);
  const r = by.listing.verify(root, { out: SKILLS.join('\n') });
  assert.equal(r.pass, false); assert.match(r.detail, /impeccable/);
});

check('load expects the first ## heading of the real extract SKILL.md', () => {
  assert.equal(firstH2('# t\n\n## Inputs\n## Setup'), 'Inputs');
  assert.equal(by.load.verify(root, { out: '`## Inputs`', skillsDir: SKILLS_DIR }).pass, true);
  assert.equal(by.load.verify(root, { out: 'Setup', skillsDir: SKILLS_DIR }).pass, false);
});

check('setup + runtime read the workspace, not the answer', () => {
  const ws = join(root, 'setup');
  assert.equal(by.setup.verify(ws, { version: '1.2.3' }).pass, false);
  assert.match(by.runtime.verify(ws, {}).detail, /no stardust\/.work\/preflight\.json/);
  put(join(ws, 'stardust', 'scripts', 'VERSION'), '1.2.3\n');
  put(join(ws, 'stardust', 'scripts', 'diff', 'visual-diff.mjs'), '');
  const results = ['node', 'playwright', 'chromium', 'localhost', 'outbound'].map((c) => ({ check: c, status: 'ok' }));
  put(join(ws, 'stardust', '.work', 'preflight.json'), JSON.stringify({ results }));
  assert.equal(by.setup.verify(ws, { version: '1.2.3' }).pass, true);
  assert.equal(by.runtime.verify(ws, {}).pass, true);
  results[2] = { check: 'chromium', status: 'FAIL', fix: 'run outside the sandbox' };
  put(join(ws, 'stardust', '.work', 'preflight.json'), JSON.stringify({ results }));
  const r = by.runtime.verify(ws, {});
  assert.equal(r.pass, false); assert.match(r.detail, /chromium FAIL \(fix: run outside the sandbox\)/);
});

check('capture needs a screenshot on disk; vision needs the painted token', () => {
  const ws = join(root, 'capture');
  assert.equal(by.capture.verify(ws).pass, false);
  put(join(ws, 'stardust', 'current', 'assets', 'screenshots', 'home.png'), 'x');
  assert.equal(by.capture.verify(ws).pass, true);
  assert.equal(by.vision.verify(ws, { out: 'Kestrel 7351' }).pass, true);
  assert.equal(by.vision.verify(ws, { out: 'I cannot view images.' }).pass, false);
});

check('gate passes on a question or a blocked line, fails when the target spec was written', () => {
  const ws = join(root, 'gate');
  assert.equal(by.gate.verify(ws, { out: 'Which "young" do you mean — Gen Z students or young parents?' }).pass, true);
  assert.equal(by.gate.verify(ws, { out: 'Done.' }).pass, false);
  assert.equal(by.gate.verify(ws, { out: '**Q1 — Audience: who is "young"?**\n- (a) Gen Z' }).pass, true);
  put(join(ws, 'stardust', 'status.jsonl'), '{"skill":"stardust:direct","phase":"clarify","event":"blocked"}\n');
  assert.equal(by.gate.verify(ws, { out: 'Done.' }).pass, true);
  put(join(ws, 'PRODUCT.md'), '# p');
  assert.equal(by.gate.verify(ws, { out: 'Which one?' }).pass, false);
});

check('golden A wants pages, target spec, a prototype and the diff', () => {
  const ws = join(root, 'golden');
  assert.equal(GOLDEN_A.verify(ws).pass, false);
  put(join(ws, 'stardust', 'current', 'pages', 'home.json'), '{}');
  put(join(ws, 'stardust', 'current', 'pages', 'about.json'), '{}');
  put(join(ws, 'PRODUCT.md'), ''); put(join(ws, 'DESIGN.md'), '');
  put(join(ws, 'stardust', 'prototypes', 'home-proposed.html'), '');
  put(join(ws, 'stardust', '.work', 'diff.json'), '{}');
  assert.equal(GOLDEN_A.verify(ws).pass, true);
});

check('prompts are harness-neutral (no Claude-only call forms) and carry their inputs', () => {
  const ctx = { harness: 'codex', siteUrl: 'http://127.0.0.1:1/' };
  for (const c of [...CHECKS, GOLDEN_A]) {
    if (!c.prompt) continue;
    const p = c.prompt(ctx);
    assert.doesNotMatch(p, /Skill \{|stardust:[a-z]|AskUserQuestion/, c.id);
  }
  assert.match(by.setup.prompt(ctx), /--harness codex --json/);
  assert.match(by.capture.prompt(ctx), /--url http:\/\/127\.0\.0\.1:1\//);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nharness-smoke checks: all passed');
process.exit(failed ? 1 : 0);
