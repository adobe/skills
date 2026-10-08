#!/usr/bin/env node
// skills/dynamics/scripts/test/dynamics-plan.test.mjs — the draft plan from a fixture `_dynamics.json`:
// a form found inside an iframe drafts `embed-passthrough` (never a native rebuild) and a `form-flow`
// check that requires the iframe and blocks the live submission; every other form row drafts a
// `form-flow` check, so Phase 5 always has a flow to replay; client-compute forms draft none. A recorded
// run planned the embed, shipped a dead native form, and nothing replayed it. CLI run in a tmpdir, no network.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-plan.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dynamics-plan.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const dir = mkdtempSync(join(tmpdir(), 'dynamics-plan-'));
const frame = { src: 'www.example.com/demo-request', selector: 'iframe[src*="/demo-request"]', scope: 'form' };
writeFileSync(join(dir, '_dynamics.json'), JSON.stringify({
  pages: { '/contact/': {}, '/newsletter': {}, '/calc': {} },
  findings: [
    { id: 'f-embedded', class: 'F', feature: 'form in iframe → www.example.com/demo-request (5 fields)', hint: 'embedded-form', frame, pages: ['/contact/'], evidence: [] },
    { id: 'f-native', class: 'F', feature: 'form "subscribe" → origin /subscribe (1 fields)', hint: 'forms', pages: ['/newsletter'], evidence: [] },
    { id: 'f-calc', class: 'F', feature: 'form "calc" → no action (JS-wired) (3 fields)', hint: 'client-compute?', pages: ['/calc'], evidence: [] },
    { id: 'm-modal', class: 'M', feature: 'modal trigger a[href$="#demo"]', hint: 'modal', pages: ['/'], evidence: [] },
  ],
}));
const r = spawnSync(process.execPath, [SCRIPT, '--in', join(dir, '_dynamics.json'), '--out', join(dir, 'out')], { encoding: 'utf8' });
const plan = r.status === 0 ? JSON.parse(readFileSync(join(dir, 'out', 'dynamic-features.generated-plan.json'), 'utf8')) : { rows: [] };
const md = r.status === 0 ? readFileSync(join(dir, 'out', 'dynamic-features.generated-plan.md'), 'utf8') : '';
const byId = Object.fromEntries(plan.rows.map((x) => [x.id, x]));

check('the CLI exits 0', () => assert.equal(r.status, 0, r.stderr));
check('a form in an iframe → embed-passthrough, self, never rebuild-native', () => {
  const x = byId['f-embedded'];
  assert.equal(x.disposition, 'embed-passthrough'); assert.equal(x.reproducibility, 'self'); assert.deepEqual(x.frame, frame);
});
check('…with a drafted form-flow check that requires the iframe and blocks the live submission (path without trailing slash)', () => {
  assert.deepEqual(byId['f-embedded'].checks, [{ type: 'form-flow', path: '/contact', submit: 'button[type=submit], input[type=submit], button:not([type])', fill: 'auto', frame: frame.selector, block: true }]);
});
check('a main-page form drafts a form-flow check without frame / block', () => {
  const [c] = byId['f-native'].checks; assert.equal(c.type, 'form-flow'); assert.equal(c.path, '/newsletter'); assert.equal(c.frame, undefined); assert.equal(c.block, undefined);
});
check('client-compute forms and non-form rows draft no check', () => {
  assert.equal(byId['f-calc'].checks, undefined); assert.equal(byId['m-modal'].checks, undefined);
});
check('the markdown names the iframe and the drafted checks', () => {
  assert.match(md, /iframe www\.example\.com\/demo-request; check: form-flow in iframe/);
  assert.match(md, /\*\*Drafted checks:\*\* 2 form row\(s\)/);
});

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\ndynamics-plan: ${failed} check(s) failed` : '\ndynamics-plan: all checks passed');
process.exit(failed ? 1 : 0);
