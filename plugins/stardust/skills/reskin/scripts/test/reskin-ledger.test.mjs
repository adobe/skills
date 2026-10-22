#!/usr/bin/env node
// skills/reskin/scripts/test/reskin-ledger.test.mjs — the ledger writer. Pure part: overall-verdict
// parsing, the mobile-adapt static rules, applyRecord (status, accepted residuals, handoff archetype
// and tier, PASS-only gates for migrate, sibling stage). CLI part on a temp project: --help, usage
// errors, refusal on missing reports, record → eyeball → residual → show, the chrome refusals. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRecord, fragmentVerdict, gateVerdicts, mobileStatic, overall, ownerAccepted, WAIVED } from '../reskin-ledger.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'reskin-ledger.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const MOBILE_OK = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>@media (max-width: 900px){} @media (max-width: 640px){}</style>';
const state = { flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'approved', prototypePath: 'stardust/prototypes/login-proposed.html' }, { slug: 'reg', type: 'form', status: 'migrated' }, { slug: 'draft', type: 'form', status: 'prototyped' }] };
const R = (v) => ({ 'reskin-dom-equality': { verdict: v, report: 'a.md' }, 'reskin-slot-coverage': { verdict: 'PASS', report: 'b.md' }, 'reskin-donor-probe': { verdict: 'PASS', report: 'c.md' } });
const mob = (pass = true) => ({ static: { pass, issues: pass ? [] : ['no @media'] }, runtime: { pass: true } });

check('overall reads the report verdict', () => {
  assert.equal(overall('# x\n\n**Overall: PASS**\n'), 'PASS'); assert.equal(overall('**Overall: FAIL** (2)'), 'FAIL'); assert.equal(overall('nothing'), null);
});
check('mobileStatic: viewport, a max-width rule, one at ≤640px', () => {
  assert.equal(mobileStatic(MOBILE_OK).pass, true);
  assert.match(mobileStatic('<style>@media (max-width:640px){}</style>').issues.join(), /viewport/);
  assert.match(mobileStatic('<meta name="viewport" content="width=device-width">').issues.join(), /desktop-only/);
  assert.match(mobileStatic('<meta name="viewport" content="width=device-width"><style>@media (max-width: 900px){}</style>').issues.join(), /900px/);
});
check('record on an approved page: gated, handoff archetype with tier, PASS-only gates for migrate', () => {
  const L = applyRecord({}, { state, slug: 'login', reports: R('PASS'), mobile: mob(), prototypeSha: 'abc', at: 't' });
  assert.equal(L.pages.login.status, 'gated'); assert.equal(L.pages.login.prototypeSha, 'abc');
  const h = L.handoff.form; assert.equal(h.archetype, 'login'); assert.deepEqual(h.tier.waived, WAIVED);
  assert.ok(h.tier.passed.includes('mobile-adapt-static') && h.tier.passed.includes('reskin-dom-equality'));
  assert.match(h.gates.login['reskin-slot-coverage'], /^PASS — b\.md/);
});
check('a FAIL gate makes the page failing and keeps it out of handoff gates; an accepted residual clears it', () => {
  let L = applyRecord({}, { state, slug: 'login', reports: R('FAIL'), mobile: mob(), prototypeSha: 'a', at: 't' });
  assert.equal(L.pages.login.status, 'failing'); assert.equal(L.handoff.form.gates.login['reskin-dom-equality'], undefined);
  L.pages.login.residuals = [{ gate: 'reskin-dom-equality', verdict: 'accepted' }];
  L = applyRecord(L, { state, slug: 'login', reports: R('FAIL'), mobile: mob(), prototypeSha: 'a', at: 't' });
  assert.equal(L.pages.login.status, 'gated'); assert.equal(L.pages.login.residuals.length, 1);
});
check('runtime audit not run is NOT-RUN, which does not count as passing', () => {
  const L = applyRecord({}, { state, slug: 'login', reports: R('PASS'), mobile: { static: { pass: true, issues: [] }, runtime: null }, prototypeSha: 'a', at: 't' });
  assert.equal(L.pages.login.gates['mobile-adapt-runtime'].verdict, 'NOT-RUN'); assert.equal(L.pages.login.status, 'failing');
});
check('the type keeps its first archetype; a second approved page only adds gates; prototyped pages stay out of handoff', () => {
  let L = applyRecord({}, { state, slug: 'login', reports: R('PASS'), mobile: mob(), prototypeSha: 'a', at: 't' });
  L = applyRecord(L, { state, slug: 'reg', reports: R('PASS'), mobile: mob(), prototypeSha: 'b', at: 't' });
  assert.equal(L.handoff.form.archetype, 'login'); assert.ok(L.handoff.form.gates.reg);
  L = applyRecord(L, { state, slug: 'draft', reports: R('PASS'), mobile: mob(), prototypeSha: 'c', at: 't' });
  assert.equal(L.handoff.form.gates.draft, undefined); assert.equal(L.pages.draft.status, 'gated');
});
check('migrated stage records the sibling gate without touching the prototype record', () => {
  let L = applyRecord({}, { state, slug: 'reg', reports: R('PASS'), mobile: mob(), prototypeSha: 'b', at: 't' });
  L = applyRecord(L, { state, slug: 'reg', stage: 'migrated', reports: R('FAIL'), at: 't2' });
  assert.equal(L.pages.reg.status, 'gated'); assert.equal(L.pages.reg.migratedStatus, 'failing'); assert.equal(L.handoff.form.siblings.reg.gate, 'failing');
});

check('M2 fragments: verdict strings, flattening, figmaRequired, kept fragment, handoff keys', () => {
  assert.deepEqual(['PASS 3/3', 'ADVISORY x', 'n/a: y', 'FAIL 1/3', 'not run: skipped', 'CRASH: z', undefined, 'weird'].map(fragmentVerdict), ['PASS', 'PASS', 'PASS', 'FAIL', 'NOT-RUN', 'NOT-RUN', 'NOT-RUN', 'UNKNOWN']);
  const fig = { regime: 'local', join: 'PASS', geometry: 'FAIL 2/9', ramp: 'PASS', pixel: 'ADVISORY 5%' };
  assert.deepEqual(gateVerdicts({ figma: fig }).map((v) => `${v.gate}:${v.verdict}`), ['figma.join:PASS', 'figma.geometry:FAIL', 'figma.ramp:PASS']);
  const base = { state, slug: 'login', reports: R('PASS'), mobile: mob(), prototypeSha: 'x', at: 't' };
  assert.equal(applyRecord({}, { ...base, m2: { figma: fig } }).pages.login.status, 'failing');
  assert.equal(applyRecord({}, { ...base, m2: { figmaRequired: true } }).pages.login.status, 'failing');
  const ok = applyRecord({}, { ...base, m2: { figma: { ...fig, geometry: 'PASS 9/9' } } });
  assert.equal(ok.pages.login.status, 'gated'); assert.ok(ok.handoff.form.gates.login['figma.geometry']);
  assert.equal(applyRecord(ok, base).pages.login.gates.figma.geometry, 'PASS 9/9', 'a recorded fragment survives a re-record without fresh evidence');
  assert.equal(applyRecord({}, base).pages.login.gates.figma, undefined, 'no M2 → no figma gate');
  assert.equal(fragmentVerdict('CHALLENGE: bot wall'), 'NOT-RUN'); assert.equal(fragmentVerdict('ERROR (exit 3)'), 'NOT-RUN');
  assert.deepEqual(gateVerdicts({ domEquality: 'PASS', slotCoverage: 'FAIL 1/9' }).map((v) => v.verdict), ['PASS', 'FAIL'], 'hand-written string gates');
  const withClass = applyRecord({ pages: { login: { residuals: [{ gate: 'figma', class: 'figma.geometry', verdict: 'accepted' }] } } }, { ...base, m2: { figma: fig } });
  assert.equal(withClass.pages.login.status, 'gated', 'a residual names its family by class (M2b SKILL)');
});
check('chrome: deployed.chrome is never accepted; a header or footer residual counts only --by a non-agent owner', () => {
  assert.equal(ownerAccepted({ gate: 'mobile-adapt-runtime', verdict: 'accepted' }), true, 'not a chrome gate: no owner needed');
  for (const gate of ['step10.header', 'footer', 'deployed.chrome', 'header-nav']) assert.equal(ownerAccepted({ gate, verdict: 'accepted' }), false, gate);
  for (const by of ['copilot', 'Claude', 'agent', 'hands-off-agent', 'stardust', ' ']) assert.equal(ownerAccepted({ gate: 'footer', verdict: 'accepted', by }), false, by);
  assert.equal(ownerAccepted({ gate: 'footer', verdict: 'accepted', by: 'site owner' }), true);
  assert.equal(ownerAccepted({ gate: 'footer', verdict: 'needs-owner', by: 'site owner' }), false);
  const base = { state, slug: 'login', reports: R('PASS'), mobile: mob(), prototypeSha: 'x', at: 't' };
  const dep = { regime: 'preview', content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: { verdict: 'PASS', hard: true }, inherited: 'PASS', chrome: { verdict: 'FAIL 2/9', hard: true } };
  const owned = { pages: { login: { residuals: [{ gate: 'deployed.chrome', verdict: 'accepted', by: 'site owner' }] } } };
  assert.equal(applyRecord(owned, { ...base, m2: { deployed: dep } }).pages.login.status, 'failing', 'a chrome FAIL stays failing');
  assert.equal(applyRecord({}, { ...base, m2: { deployed: { ...dep, chrome: { verdict: 'PASS', hard: true } } } }).pages.login.status, 'gated');
  const { chrome, ...old } = dep;
  assert.equal(applyRecord({}, { ...base, m2: { deployed: { ...old, sanity: 'PASS' } } }).pages.login.status, 'failing', 'a fragment without chrome is NOT-RUN');
});
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
check('--help exits 0; usage errors exit 2', () => {
  const r = run(['--help'], mkdtempSync(join(tmpdir(), 'rl-'))); assert.equal(r.status, 0); assert.match(r.stdout, /usage: node reskin-ledger\.mjs/);
  assert.equal(run([]).status, 2); assert.equal(run(['bogus']).status, 2); assert.equal(run(['record', 'x', '--stage']).status, 2);
});
check('CLI: refuses without reports, then record → eyeball → residual → show', () => {
  const root = mkdtempSync(join(tmpdir(), 'rl-'));
  const w = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  w('stardust/state.json', JSON.stringify(state)); w('stardust/prototypes/login-proposed.html', MOBILE_OK);
  const r0 = run(['record', 'login'], root); assert.equal(r0.status, 1); assert.match(r0.stderr, /missing gate report/);
  assert.equal(run(['record', 'nope'], root).status, 1);
  for (const f of ['dom-equality', 'slot-coverage', 'donor-probe']) w(`stardust/reskin/gates/login/${f}.md`, `# ${f}\n\n**Overall: PASS**\n`);
  const r1 = run(['record', 'login'], root); assert.equal(r1.status, 0, r1.stderr); assert.match(r1.stdout, /archetype of form/);
  assert.equal(run(['eyeball', 'login', '--verdict', 'maybe'], root).status, 2);
  assert.equal(run(['eyeball', 'login', '--verdict', 'pass', '--note', 'side by side ok'], root).status, 0);
  assert.equal(run(['residual', 'login', '--gate', 'mobile-adapt-runtime', '--cause', 'no Playwright', '--verdict', 'accepted'], root).status, 0);
  const L = JSON.parse(readFileSync(join(root, 'stardust/reskin/ledger.json'), 'utf8'));
  assert.equal(L.pages.login.eyeball.verdict, 'pass'); assert.equal(L.pages.login.residuals[0].verdict, 'accepted'); assert.ok(L.pages.login.gates['reskin-dom-equality']);
  assert.equal(L.handoff.form.archetype, 'login');
  assert.match(run(['show', 'login'], root).stdout, /"eyeball"/);
});
check('CLI: a Figma-sourced page records figma-text.json as its content gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'rl-'));
  const w = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  w('stardust/state.json', JSON.stringify(state)); w('stardust/prototypes/login-proposed.html', MOBILE_OK);
  for (const f of ['slot-coverage', 'donor-probe']) w(`stardust/reskin/gates/login/${f}.md`, `# ${f}\n\n**Overall: PASS**\n`);
  assert.match(run(['record', 'login'], root).stderr, /figma-text\.json/);
  w('stardust/reskin/gates/login/figma-text.json', JSON.stringify({ gate: 'figma-text', verdict: 'FAIL' }));
  run(['record', 'login'], root);
  assert.equal(JSON.parse(readFileSync(join(root, 'stardust/reskin/ledger.json'), 'utf8')).pages.login.gates['reskin-dom-equality'].verdict, 'FAIL');
  w('stardust/reskin/gates/login/figma-text.json', JSON.stringify({ gate: 'figma-text', verdict: 'PASS' }));
  assert.equal(run(['record', 'login'], root).status, 0);
  assert.match(JSON.parse(readFileSync(join(root, 'stardust/reskin/ledger.json'), 'utf8')).pages.login.gates['reskin-dom-equality'].report, /figma-text\.json$/);
});

check('CLI: chrome residuals and the eyeball refuse what an agent may not waive', () => {
  const root = mkdtempSync(join(tmpdir(), 'rl-'));
  const w = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  w('stardust/state.json', JSON.stringify(state)); w('stardust/prototypes/login-proposed.html', MOBILE_OK);
  for (const f of ['dom-equality', 'slot-coverage', 'donor-probe']) w(`stardust/reskin/gates/login/${f}.md`, `# ${f}\n\n**Overall: PASS**\n`);
  assert.equal(run(['record', 'login'], root).status, 0);
  const res = (...a) => run(['residual', 'login', '--cause', 'c', ...a], root);
  assert.match(res('--gate', 'deployed.chrome', '--verdict', 'accepted', '--by', 'site owner').stderr, /cannot be accepted/);
  const noBy = res('--gate', 'step10.header', '--verdict', 'accepted'); assert.equal(noBy.status, 1); assert.match(noBy.stderr, /site owner's to accept/);
  assert.equal(res('--gate', 'step10.header', '--verdict', 'accepted', '--by', 'copilot').status, 1);
  assert.equal(res('--gate', 'step10.header', '--verdict', 'needs-owner').status, 0, 'an agent records needs-owner');
  assert.equal(res('--gate', 'step10.header', '--verdict', 'accepted', '--by', 'site owner').status, 0);
  assert.equal(run(['residual', 'login', '--gate', 'footer', '--by'], root).status, 2);
  const file = join(root, 'stardust/reskin/ledger.json');
  const L = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(L.pages.login.residuals.map((r) => [r.gate, r.verdict, r.by]), [['step10.header', 'accepted', 'site owner']]);
  L.pages.login.gates.deployed = { regime: 'preview', chrome: { verdict: 'FAIL 1/9', hard: true } }; writeFileSync(file, JSON.stringify(L));
  const eye = run(['eyeball', 'login', '--verdict', 'pass'], root); assert.equal(eye.status, 1); assert.match(eye.stderr, /deployed\.chrome fails/);
  assert.equal(run(['eyeball', 'login', '--verdict', 'fail'], root).status, 0, 'a fail is always recorded');
  L.pages.login.gates.deployed.chrome = { verdict: 'PASS', hard: true }; writeFileSync(file, JSON.stringify(L));
  assert.equal(run(['eyeball', 'login', '--verdict', 'pass'], root).status, 0);
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
