#!/usr/bin/env node
// skills/reskin/scripts/test/reskin-ledger.test.mjs — the ledger writer. Pure part: overall-verdict
// parsing, the mobile-adapt static rules, applyRecord (status, accepted residuals, handoff archetype
// and tier, PASS-only gates for migrate, sibling stage). CLI part on a temp project: --help, usage
// errors, refusal on missing reports, record → eyeball → residual → show → step10 → record (kept). step10's verdicts. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRecord, applyStep10, chromeVerdict, fragmentVerdict, gateVerdicts, gatesOk, mobileStatic, overall, ownerOnly, step10Verdict, WAIVED } from '../reskin-ledger.mjs';

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
check('mobileStatic: viewport, a max-width rule (or media range syntax), one at ≤640px', () => {
  assert.equal(mobileStatic(MOBILE_OK).pass, true);
  assert.match(mobileStatic('<style>@media (max-width:640px){}</style>').issues.join(), /viewport/);
  assert.match(mobileStatic('<meta name="viewport" content="width=device-width">').issues.join(), /desktop-only/);
  assert.match(mobileStatic('<meta name="viewport" content="width=device-width"><style>@media (max-width: 900px){}</style>').issues.join(), /900px/);
  const VP = '<meta name="viewport" content="width=device-width">';
  for (const q of ['(width <= 640px)', '(width < 641px)', 'screen and (640px >= width)', '(400px <= width <= 600px)']) assert.equal(mobileStatic(`${VP}<style>@media ${q}{}</style>`).pass, true, q);
  assert.match(mobileStatic(`${VP}<style>@media (width < 900px){}</style>`).issues.join(), /899px/);
  assert.match(mobileStatic(`${VP}<style>@media (width >= 641px){}</style>`).issues.join(), /desktop-only/);
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
  assert.equal(fragmentVerdict('NOT CHECKED 0/0 (5 of 5 sections out-of-kit)'), 'NOT-CHECKED');
  const vacuous = applyRecord({}, { ...base, m2: { figma: { ...fig, geometry: 'NOT CHECKED 0/0 (5 of 5 sections out-of-kit)' } } });
  assert.equal(vacuous.pages.login.status, 'gated', 'NOT-CHECKED is shown, not blocking');
  assert.equal(vacuous.handoff.form.gates.login['figma.geometry'], undefined, 'NOT-CHECKED is not listed as passed');
  assert.equal(fragmentVerdict('CHALLENGE: bot wall'), 'NOT-RUN'); assert.equal(fragmentVerdict('ERROR (exit 3)'), 'NOT-RUN');
  assert.deepEqual(gateVerdicts({ domEquality: 'PASS', slotCoverage: 'FAIL 1/9' }).map((v) => v.verdict), ['PASS', 'FAIL'], 'hand-written string gates');
  const withClass = applyRecord({ pages: { login: { residuals: [{ gate: 'figma', class: 'figma.geometry', verdict: 'accepted', by: 'user' }] } } }, { ...base, m2: { figma: fig } });
  assert.equal(withClass.pages.login.status, 'gated', 'a residual names its family by class (M2b SKILL)');
});
check('step10: verdicts (FAIL beats NOT-RUN beats PASS), unresolved adds a needs-owner residual, record keeps gates.step10', () => {
  assert.equal(step10Verdict({ eyeball: 'pass', cls: '0.04', header: 'n/a: no header contract' }), 'PASS');
  assert.equal(step10Verdict({ eyeball: 'pass', cls: '0.1', header: 'pass' }), 'FAIL');
  assert.equal(step10Verdict({ eyeball: 'fail', cls: 'unresolved: no probe', header: 'pass' }), 'FAIL');
  assert.equal(step10Verdict({ eyeball: 'pass', cls: 'unresolved: no probe', header: 'pass' }), 'NOT-RUN');
  assert.equal(step10Verdict({ eyeball: 'adopted', cls: '0', header: 'pass' }), 'UNKNOWN');
  const base = { state, slug: 'login', reports: R('PASS'), mobile: mob(), prototypeSha: 'x', at: 't' };
  let L = applyRecord({}, base);
  L = applyStep10(L, { slug: 'login', eyeball: 'pass', cls: 'unresolved: probe not run', header: 'PASS', by: 'user', at: 't2' });
  assert.equal(L.pages.login.gates.step10.verdict, 'NOT-RUN'); assert.equal(L.pages.login.gates.step10.header, 'pass');
  assert.equal(L.pages.login.status, 'failing');
  assert.deepEqual(L.pages.login.residuals.map((r) => [r.gate, r.verdict, r.cause]), [['step10', 'needs-owner', 'cls unresolved: probe not run']]);
  L = applyStep10(L, { slug: 'login', eyeball: 'pass', cls: '0.02', header: 'n/a: static header', at: 't3' });
  assert.equal(L.pages.login.gates.step10.verdict, 'PASS'); assert.equal(L.pages.login.status, 'gated');
  assert.deepEqual(L.pages.login.residuals.map((r) => [r.gate, r.verdict, r.cause]), [['step10', 'needs-owner', 'header n/a: static header']], 'a header other than pass is the owner\'s to see');
  assert.deepEqual(applyStep10(L, { slug: 'login', eyeball: 'pass', cls: '0.02', header: 'pass', at: 't3' }).pages.login.residuals, [], 'a clean pass drops it');
  const re = applyRecord(L, { ...base, at: 't4' });
  assert.deepEqual(re.pages.login.gates.step10, L.pages.login.gates.step10, 'a re-record keeps the step10 receipts');
  assert.equal(re.pages.login.status, 'gated');
  assert.equal(applyRecord(applyStep10(L, { slug: 'login', eyeball: 'pass', cls: '0.3', header: 'pass', at: 't5' }), base).pages.login.status, 'failing');
  assert.deepEqual(gateVerdicts({ step10: { eyeball: 'pass', cls: '0.04', header: 'n/a: none' } }).map((v) => v.verdict), ['PASS'], 'a hand-written step10 without a verdict is computed');
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
  assert.equal(run(['step10', 'login', '--eyeball', 'pass', '--cls', 'low', '--header', 'pass'], root).status, 2);
  assert.equal(run(['step10', 'login', '--eyeball', 'pass', '--cls', '0.01'], root).status, 2);
  const s10 = run(['step10', 'login', '--eyeball', 'pass', '--cls', '0.01', '--header-toggle', 'pass', '--note', 'burger toggles at 360', '--by', 'user'], root);
  assert.equal(s10.status, 0, s10.stderr); assert.match(s10.stdout, /step10 login: PASS/);
  assert.equal(run(['record', 'login'], root).status, 0);
  const L2 = JSON.parse(readFileSync(join(root, 'stardust/reskin/ledger.json'), 'utf8'));
  assert.deepEqual([L2.pages.login.gates.step10.verdict, L2.pages.login.gates.step10.header, L2.pages.login.gates.step10.by], ['PASS', 'pass', 'user']);
});

check('owner-only gates: an accepted residual covers figma/exact/step10/chrome only when by user; legacy (no by) fails closed', () => {
  for (const g of ['figma.join', 'figma.geometry', 'figma.ramp', 'deployed.figma.geometry', 'exact', 'step10', 'deployed.chrome', 'A6 header crop', 'footer']) assert.ok(ownerOnly(g), g);
  for (const g of ['font.unserved', 'reskin-dom-equality', 'deployed.content', 'mobile-adapt-runtime']) assert.ok(!ownerOnly(g), g);
  const gates = { figma: { join: 'PASS', geometry: 'FAIL 2/9', ramp: 'PASS' } };
  const res = (by) => [{ gate: 'figma.geometry', class: 'figma.geometry', verdict: 'accepted', ...(by === undefined ? {} : { by }) }];
  assert.equal(gatesOk(gates, res(undefined)), false, 'legacy residual without by');
  assert.equal(gatesOk(gates, res('hands-off')), false);
  assert.equal(gatesOk(gates, res('user')), true);
  assert.equal(gatesOk({ 'font.unserved': { verdict: 'FAIL' } }, [{ gate: 'font.unserved', verdict: 'accepted', by: 'hands-off' }]), true, 'an agent may accept a non-owner gate');
  assert.equal(gatesOk({ deployed: { content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: { verdict: 'FAIL 1/4' }, inherited: 'PASS' } }, [{ gate: 'deployed.sanity', verdict: 'accepted', by: 'user' }]), false, 'deployed.sanity is never accepted');
  const fb = (gate) => [{ gate, verdict: 'fallback', by: 'hands-off', note: 'x' }];
  assert.equal(gatesOk({ figma: { join: 'PASS', geometry: 'PASS', ramp: 'FAIL 1/4' } }, fb('figma.ramp')), true, 'a fallback covers figma.ramp');
  assert.equal(gatesOk({ deployed: { content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: 'PASS', inherited: 'PASS', figma: { join: 'PASS', geometry: 'PASS', ramp: 'FAIL 1/4' } } }, fb('figma.ramp')), true, 'and its deployed re-run');
  assert.equal(gatesOk({ step10: { eyeball: 'fail', cls: '0.02', header: 'pass' } }, fb('step10')), true);
  assert.equal(gatesOk({ exact: { verdict: 'FAIL' } }, fb('exact')), true);
  assert.equal(gatesOk(gates, fb('figma.geometry')), true, 'a fitting module keeps its geometry miss as a fallback');
  assert.equal(gatesOk({ figma: { join: 'FAIL 1/3', geometry: 'PASS', ramp: 'PASS' } }, fb('figma.join')), false, 'a join failure is remapped, never a fallback');
  assert.equal(gatesOk({ deployed: { content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: 'FAIL 1/4', inherited: 'PASS' } }, fb('deployed.sanity')), false);
});
check('chromeVerdict: no fragment / parity header crop n/a is NOT-RUN, FAIL is FAIL, explicit chrome keys win over parity', () => {
  assert.equal(chromeVerdict(undefined).verdict, 'NOT-RUN');
  assert.equal(chromeVerdict({ parity: 'PASS' }).verdict, 'PASS');
  assert.equal(chromeVerdict({ parity: 'PASS (n/a: header crop, section-height)' }).verdict, 'NOT-RUN');
  assert.equal(chromeVerdict({ parity: 'PASS (n/a: section-height)' }).verdict, 'PASS');
  assert.equal(chromeVerdict({ parity: 'FAIL 1/9' }).verdict, 'FAIL');
  assert.equal(chromeVerdict({ parity: 'PASS', chrome: 'FAIL 2/4' }).verdict, 'FAIL');
  assert.equal(chromeVerdict({ parity: 'FAIL 1/9', chrome: { verdict: 'PASS' } }).verdict, 'PASS');
  // deployed-gate's chrome.navDepth adds a row; parity's crops still count
  assert.equal(chromeVerdict({ parity: 'PASS', chrome: { navDepth: 'PASS' } }).verdict, 'PASS');
  assert.equal(chromeVerdict({ parity: 'PASS', chrome: { navDepth: 'n/a: the source header has no nav groups' } }).verdict, 'PASS');
  assert.equal(chromeVerdict({ parity: 'PASS', chrome: { navDepth: 'FAIL source 3 nav groups, delivered 0' } }).verdict, 'FAIL');
  assert.equal(chromeVerdict({ parity: 'PASS (n/a: header crop)', chrome: { navDepth: 'PASS' } }).verdict, 'NOT-RUN');
});
check('CLI: owner-only residuals, step10 header refusal for an agent, flag, delivery', () => {
  const root = mkdtempSync(join(tmpdir(), 'rl-'));
  const w = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  const read = () => JSON.parse(readFileSync(join(root, 'stardust/reskin/ledger.json'), 'utf8'));
  w('stardust/state.json', JSON.stringify({ ...state, handsOff: true }));
  const res = (gate, ...extra) => run(['residual', 'login', '--gate', gate, '--cause', 'off by 3px', '--verdict', 'accepted', ...extra], root);
  const r1 = res('figma.geometry', '--by', 'hands-off'); assert.equal(r1.status, 1); assert.match(r1.stderr, /--verdict needs-owner; only --by user accepts/);
  assert.equal(res('figma.ramp').status, 1, 'no --by is not the user');
  assert.equal(res('deployed.chrome', '--by', 'hands-off').status, 1);
  assert.equal(res('step10', '--by', 'hands-off').status, 1);
  assert.equal(res('font.unserved', '--by', 'hands-off').status, 0);
  const u = res('figma.geometry', '--by', 'user'); assert.equal(u.status, 0, u.stderr);
  assert.equal(run(['residual', 'login', '--gate', 'figma.join', '--cause', 'x', '--verdict', 'needs-owner', '--by', 'hands-off'], root).status, 0);
  assert.deepEqual(read().pages.login.residuals.map((r) => [r.gate, r.verdict, r.by]), [['font.unserved', 'accepted', 'hands-off'], ['figma.geometry', 'accepted', 'user'], ['figma.join', 'needs-owner', 'hands-off']]);

  const s10 = (header, ...extra) => run(['step10', 'login', '--eyeball', 'pass', '--cls', '0.01', '--header', header, ...extra], root);
  const h1 = s10('pass', '--by', 'hands-off'); assert.equal(h1.status, 1); assert.match(h1.stderr, /refused.*NOT-RUN.*no gates\.deployed/);
  assert.equal(s10('n/a: no header', '--by', 'hands-off').status, 1);
  assert.equal(s10('pass').status, 1, 'no --by in a handsOff run is the agent');
  const L = read(); L.pages.login.gates = { deployed: { parity: 'FAIL 1/9 header crop 4% > 2%' } }; w('stardust/reskin/ledger.json', JSON.stringify(L));
  assert.match(s10('pass', '--by', 'hands-off').stderr, /chrome evidence is FAIL/);
  const unres = s10('unresolved: header differs from donor', '--by', 'hands-off'); assert.equal(unres.status, 0, unres.stderr);
  assert.ok(read().pages.login.residuals.some((r) => r.gate === 'step10' && r.verdict === 'needs-owner'));
  assert.equal(s10('pass', '--by', 'user').status, 0, 'the user passes it');
  const L2 = read(); L2.pages.login.gates.deployed = { parity: 'PASS' }; w('stardust/reskin/ledger.json', JSON.stringify(L2));
  assert.equal(s10('pass', '--by', 'hands-off').status, 0, 'an agent may pass the header when the chrome evidence passes');

  // fallback: hands-off only, figma.geometry|figma.ramp|exact|step10 only, a --note, step10 after a second run
  const fbk = (gate, ...extra) => run(['residual', 'login', '--gate', gate, '--cause', 'still fails', '--verdict', 'fallback', ...extra], root);
  assert.match(fbk('figma.join', '--note', 'x').stderr, /takes no fallback/);
  assert.match(fbk('deployed.chrome', '--note', 'x').stderr, /takes no fallback/);
  assert.match(fbk('figma.ramp').stderr, /needs --note/);
  const L3 = read(); L3.pages.login.gates.step10 = { ...L3.pages.login.gates.step10, attempts: 1 }; w('stardust/reskin/ledger.json', JSON.stringify(L3));
  assert.match(fbk('step10', '--note', 'finished on a failing eyeball').stderr, /step10 run twice/);
  assert.equal(s10('unresolved: header not measured', '--by', 'hands-off').status, 0);
  assert.equal(read().pages.login.gates.step10.attempts, 2);
  const f10 = fbk('step10', '--note', 'header unchecked after two runs', '--by', 'hands-off'); assert.equal(f10.status, 0, f10.stderr);
  assert.deepEqual(read().pages.login.residuals.filter((r) => r.gate === 'step10').map((r) => r.verdict), ['fallback'], 'replaces the needs-owner one');
  assert.equal(fbk('figma.ramp', '--note', 'source value for --heading-color').status, 0);
  assert.equal(fbk('exact', '--note', 'source text kept').status, 0);
  w('stardust/state.json', JSON.stringify(state));
  assert.match(fbk('figma.ramp', '--note', 'x').stderr, /hands-off run/, 'not outside hands-off');
  w('stardust/state.json', JSON.stringify({ ...state, handsOff: true }));

  assert.equal(run(['flag', 'login'], root).status, 2);
  for (let i = 0; i < 2; i++) assert.equal(run(['flag', 'login', '--note', 'coverage.absent: color.accent'], root).status, 0);
  assert.equal(run(['flag', 'login', '--note', 'font fallback'], root).status, 0);
  assert.deepEqual(read().pages.login.flags, ['coverage.absent: color.accent', 'font fallback']);

  const d = (...a) => run(['delivery', ...a], root);
  assert.equal(d('--scope', 'archetypes-only', '--requested-by', 'user').status, 2, '--reason required');
  assert.equal(d('--scope', 'archetypes-only', '--reason', 'x').status, 2, '--requested-by required');
  assert.equal(d('--scope', 'subset', '--requested-by', 'user', '--reason', 'x').status, 2, 'subset needs --pages');
  assert.equal(d('--scope', 'full-site', '--pages', 'a', '--requested-by', 'user', '--reason', 'x').status, 2, '--pages with subset only');
  assert.equal(d('--scope', 'everything', '--requested-by', 'user', '--reason', 'x').status, 2);
  assert.equal(d('login', '--scope', 'full-site', '--requested-by', 'user', '--reason', 'x').status, 2, 'no slug');
  assert.equal(d('--requested-by', 'runner', '--reason', 'default').status, 0);
  assert.equal(read().delivery.scope, 'full-site');
  const ok = d('--scope', 'subset', '--pages', 'login, reg', '--requested-by', 'runner', '--reason', 'runner page cap 2'); assert.equal(ok.status, 0, ok.stderr);
  const { at, ...rest } = read().delivery; assert.match(at, /Z$/);
  assert.deepEqual(rest, { scope: 'subset', pages: ['login', 'reg'], requestedBy: 'runner', reason: 'runner page cap 2' });
  assert.equal(d('--scope', 'archetypes-only', '--requested-by', 'user', '--reason', '"just the archetypes"').status, 0);
  assert.equal(read().delivery.pages, undefined);
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
