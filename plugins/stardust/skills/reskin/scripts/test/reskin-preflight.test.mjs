#!/usr/bin/env node
// skills/reskin/scripts/test/reskin-preflight.test.mjs — reskin → migrate readiness. Pure part: a ready
// project passes, each FAIL check trips on its own (flow, archetype per type, canon :root, donor DESIGN,
// canon record drift, direction, dispositions), stale / untyped / awaiting rows only warn. CLI part:
// --help before any I/O, exit 2 on usage errors, exit 0 / 1 on a temp project. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../reskin-preflight.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'reskin-preflight.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

const CSS = ':root { --a: red; }\n.site-main .btn { color: var(--a); }\n';
const HEADER = '<header class="site-header"></header>';
const DYN = '| # | feature | disposition | status |\n|---|---|---|---|\n| 1 | search | rebuild | confirmed |\n';
const PASS = { verdict: 'PASS' };
const gated = (extra = {}) => ({ status: 'gated', gates: { 'reskin-dom-equality': PASS, 'reskin-slot-coverage': PASS, 'reskin-donor-probe': PASS, 'mobile-adapt-static': PASS }, eyeball: { verdict: 'pass' }, residuals: [], ...extra });
const LEDGER = JSON.stringify({ pages: { login: gated() }, handoff: { form: { archetype: 'login', gates: { login: { 'reskin-dom-equality': 'PASS' } } } } });
function project(over = {}) {
  const files = {
    'stardust/state.json': JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'approved' }, { slug: 'registration', type: 'form', status: 'extracted' }] }),
    'stardust/canon/canon.css': CSS,
    'stardust/canon/header.html': HEADER,
    'DESIGN.json': JSON.stringify({ source: { kind: 'donor' }, extensions: { canon: { files: { css: { path: 'stardust/canon/canon.css', sha: sha(CSS) }, header: { path: 'stardust/canon/header.html', sha: sha(HEADER) } } } } }),
    'stardust/direction.md': '# Direction\n\n## Active\n\nDonor reskin.\n',
    'stardust/dynamic-features.md': DYN,
    'stardust/reskin/ledger.json': LEDGER,
    ...over,
  };
  return (rel) => (files[rel] ?? null);
}
const levels = (res, check) => res.filter((r) => r.check === check).map((r) => r.level);
const fails = (res) => res.filter((r) => r.level === 'fail').map((r) => r.check);

check('a ready project has no failing check', () => assert.deepEqual(fails(preflight(project())), []));
check('flow other than reskin fails', () => {
  const st = JSON.stringify({ flow: 'redesign', pages: [{ slug: 'login', type: 'form', status: 'approved' }] });
  assert.deepEqual(fails(preflight(project({ 'stardust/state.json': st }))), ['flow']);
});
check('a type without an approved or migrated page fails and names its pages', () => {
  const st = JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'migrated' }, { slug: 'home', type: 'landing', status: 'prototyped' }] });
  const r = preflight(project({ 'stardust/state.json': st })).find((x) => x.check === 'archetypes');
  assert.equal(r.level, 'fail'); assert.match(r.detail, /landing \(home\)/); assert.doesNotMatch(r.detail, /form/);
});
check('missing state stops early with one failure', () => {
  const res = preflight(project({ 'stardust/state.json': null }));
  assert.deepEqual(res.map((r) => r.check), ['state']);
});
check('canon.css not opening with :root fails (comments ignored)', () => {
  const css = '/* x */ .a { color: red; }\n:root { --a: red; }';
  assert.deepEqual(levels(preflight(project({ 'stardust/canon/canon.css': css })), 'canon'), ['fail']);
  assert.deepEqual(levels(preflight(project({ 'stardust/canon/canon.css': `/* stamp */\n${CSS}` })), 'canon'), ['ok']);
});
check('DESIGN.json not donor-sourced fails', () => {
  const d = JSON.parse(project()('DESIGN.json')); d.source.kind = 'direction';
  assert.ok(fails(preflight(project({ 'DESIGN.json': JSON.stringify(d) }))).includes('design'));
});
check('a canon file edited after the bridge fails canon-record', () => {
  assert.deepEqual(levels(preflight(project({ 'stardust/canon/header.html': '<header>edited</header>' })), 'canon-record'), ['fail']);
});
check('direction without an Active heading fails', () => assert.ok(fails(preflight(project({ 'stardust/direction.md': '# Direction\n' }))).includes('direction')));
check('a feature row without a disposition fails; awaiting rows only warn', () => {
  const dyn = `${DYN}| 2 | map | – | awaiting owner |\n`;
  const res = preflight(project({ 'stardust/dynamic-features.md': dyn }));
  assert.deepEqual(levels(res, 'dynamics'), ['fail']); assert.deepEqual(levels(res, 'dynamics-owner'), ['warn']);
});
check('stale and untyped pages warn but do not fail', () => {
  const st = JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'migrated', stale: true, staleReason: 'canon changed; affected: css' }, { slug: 'misc', status: 'extracted' }] });
  const res = preflight(project({ 'stardust/state.json': st }));
  assert.deepEqual(fails(res), []); assert.deepEqual(levels(res, 'stale'), ['warn']); assert.deepEqual(levels(res, 'untyped'), ['warn']);
  assert.match(res.find((r) => r.check === 'stale').detail, /login: canon changed/);
});
check('a mapped module with no canon skeleton fails canon-modules; untyped pages are ignored', () => {
  const d = JSON.parse(project()('DESIGN.json'));
  d.extensions.modules = [{ id: 'M1', canonicalRendering: { path: 'stardust/canon/modules/M1.html', sha: 'x' } }, { id: 'M2', canonicalRendering: null }];
  const mapping = JSON.stringify({ pages: { login: { slots: { s01: { module: 'M1' }, s02: { module: 'M2' } } }, misc: { slots: { s01: { module: 'M7' } } } } });
  const base = { 'DESIGN.json': JSON.stringify(d), 'stardust/reskin/mapping.json': mapping, 'stardust/canon/modules/M1.html': '<section data-module="M1"></section>' };
  const r = preflight(project(base)).find((x) => x.check === 'canon-modules');
  assert.equal(r.level, 'fail'); assert.match(r.detail, /M2 \(login\)/); assert.doesNotMatch(r.detail, /M1|M7/);
  const okMap = JSON.stringify({ pages: { login: { slots: { s01: { module: 'M1' } } } } });
  assert.deepEqual(levels(preflight(project({ ...base, 'stardust/reskin/mapping.json': okMap })), 'canon-modules'), ['ok']);
  assert.deepEqual(levels(preflight(project({ ...base, 'stardust/reskin/mapping.json': okMap, 'stardust/canon/modules/M1.html': null })), 'canon-modules'), ['fail']);
});
check('the reskin predicate: missing ledger, failing gate, open residual, no eyeball, prototype drift each fail archetype-gates', () => {
  const ag = (ledger, extra = {}) => preflight(project({ 'stardust/reskin/ledger.json': ledger, ...extra })).find((x) => x.check === 'archetype-gates');
  assert.match(ag(null).detail, /ledger\.json is missing/);
  const L = (page) => JSON.stringify({ pages: { login: page }, handoff: { form: { archetype: 'login', gates: {} } } });
  const failing = gated({ status: 'failing', gates: { 'reskin-slot-coverage': { verdict: 'FAIL' } } });
  assert.match(ag(L(failing)).detail, /reskin-slot-coverage FAIL/);
  assert.equal(ag(L({ ...failing, residuals: [{ gate: 'reskin-slot-coverage', verdict: 'accepted' }], status: 'gated' })).level, 'ok');
  assert.match(ag(L(gated({ residuals: [{ gate: 'x', verdict: 'needs-owner' }] }))).detail, /x needs-owner/);
  assert.match(ag(L(gated({ eyeball: undefined }))).detail, /no eyeball/);
  assert.match(ag(L(gated({ eyeball: { verdict: 'fail' } }))).detail, /eyeball fail/);
  const st = JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'approved', prototypePath: 'stardust/prototypes/login-proposed.html' }] });
  const proto = '<html>v1</html>';
  assert.equal(ag(L(gated({ prototypeSha: sha(proto) })), { 'stardust/state.json': st, 'stardust/prototypes/login-proposed.html': proto }).level, 'ok');
  assert.match(ag(L(gated({ prototypeSha: sha(proto) })), { 'stardust/state.json': st, 'stardust/prototypes/login-proposed.html': '<html>v2</html>' }).detail, /prototype changed/);
});
check('the reskin predicate: deployed evidence whose codeStamp no longer matches the EDS code fails archetype-gates', () => {
  const dep = { regime: 'preview', content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: 'PASS', inherited: 'PASS', codeStamp: 'aaaa000011112222' };
  const files = project({ 'stardust/reskin/ledger.json': JSON.stringify({ pages: { login: gated({ gates: { ...gated().gates, deployed: dep } }) }, handoff: { form: { archetype: 'login', gates: {} } } }) });
  const ag = (stamp) => preflight(files, { stamp }).find((x) => x.check === 'archetype-gates');
  assert.equal(ag(() => 'aaaa000011112222').level, 'ok');
  assert.match(ag(() => 'bbbb000011112222').detail, /deployed evidence is stale .*stamp aaaa000011112222, now bbbb000011112222.*deployed-gate all --page login/);
  assert.equal(ag(null).level, 'ok');
});
check('the reskin predicate reads M2 fragments: figma B0/B1/B3, deployed A1–A6 + figma re-run, D7 sanity and chrome', () => {
  const ag = (page) => preflight(project({ 'stardust/reskin/ledger.json': JSON.stringify({ pages: { login: page }, handoff: { form: { archetype: 'login', gates: {} } } }) })).find((x) => x.check === 'archetype-gates');
  const fig = { regime: 'local', join: 'PASS', geometry: 'PASS 12/12', ramp: 'PASS', pixel: 'ADVISORY 4.1%', register: { a: 1 } };
  const dep = { regime: 'preview', content: 'PASS', tokens: 'PASS', parity: 'ADVISORY 2%', sanity: 'PASS', inherited: 'n/a: no contract', chrome: { verdict: 'PASS', hard: true }, figma: { ...fig, regime: 'preview' } };
  assert.equal(ag(gated({ gates: { figma: fig, deployed: dep } })).level, 'ok');
  assert.match(ag(gated({ gates: { figma: { ...fig, geometry: 'FAIL 3/12' } } })).detail, /figma\.geometry FAIL/);
  assert.match(ag(gated({ gates: { figma: { missing: 'figma-gate all not run' } } })).detail, /figma\.join NOT-RUN/);
  assert.equal(ag(gated({ gates: { figma: { ...fig, ramp: 'FAIL 1/4' } }, residuals: [{ gate: 'figma.ramp', verdict: 'accepted' }] })).level, 'ok');
  assert.match(ag(gated({ gates: { deployed: { ...dep, figma: { ...fig, join: 'FAIL 1/5' } } } })).detail, /deployed\.figma\.join FAIL/);
  assert.equal(ag(gated({ gates: { deployed: { ...dep, figma: { ...fig, join: 'FAIL 1/5' } } }, residuals: [{ gate: 'figma.join', verdict: 'accepted' }] })).level, 'ok');
  assert.match(ag(gated({ gates: { deployed: { ...dep, sanity: 'FAIL 1/9' } }, residuals: [{ gate: 'deployed.sanity', verdict: 'accepted' }] })).detail, /deployed\.sanity FAIL/);
  const { chrome, ...noChrome } = dep;
  assert.match(ag(gated({ gates: { deployed: noChrome } })).detail, /deployed\.chrome NOT-RUN/, 'a deployed fragment without chrome is not run');
  assert.match(ag(gated({ gates: { deployed: { ...dep, chrome: { verdict: 'FAIL 2/9', hard: true } } }, residuals: [{ gate: 'deployed.chrome', verdict: 'accepted', by: 'site owner' }] })).detail, /deployed\.chrome FAIL/, 'chrome is never accepted');
});
check('a header or footer residual counts only when the owner accepted it, never an agent', () => {
  const ag = (residuals) => preflight(project({ 'stardust/reskin/ledger.json': JSON.stringify({ pages: { login: gated({ gates: { 'step10.header': 'FAIL', ok: 'PASS' }, residuals }) }, handoff: { form: { archetype: 'login', gates: {} } } }) })).find((x) => x.check === 'archetype-gates');
  assert.match(ag([{ gate: 'step10.header', verdict: 'accepted' }]).detail, /step10\.header FAIL/, 'no --by');
  assert.match(ag([{ gate: 'step10.header', verdict: 'accepted', by: 'copilot' }]).detail, /step10\.header FAIL/, 'an agent');
  assert.equal(ag([{ gate: 'step10.header', verdict: 'accepted', by: 'site owner' }]).level, 'ok');
});
check('approval: an agent approval fails unless the run is hands-off and says so', () => {
  const st = (by, handsOff) => JSON.stringify({ flow: 'reskin', handsOff, pages: [{ slug: 'login', type: 'form', status: 'approved', history: [{ status: 'approved', approvedBy: by }] }] });
  const lv = (by, h) => levels(preflight(project({ 'stardust/state.json': st(by, h) })), 'approval');
  assert.deepEqual(lv('autopilot'), ['fail']); assert.deepEqual(lv('hands-off'), ['fail']); assert.deepEqual(lv('autopilot', true), ['fail']);
  assert.deepEqual(lv('hands-off', true), ['ok']); assert.deepEqual(lv('user'), ['ok']); assert.deepEqual(lv(undefined), ['ok']);
});
check('a migrated page without a passing sibling gate warns', () => {
  const st = JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'migrated' }, { slug: 'registration', type: 'form', status: 'migrated' }] });
  const led = JSON.parse(LEDGER); led.pages.login.migratedStatus = 'gated';
  const r = preflight(project({ 'stardust/state.json': st, 'stardust/reskin/ledger.json': JSON.stringify(led) })).find((x) => x.check === 'sibling-gates');
  assert.equal(r.level, 'warn'); assert.match(r.detail, /registration/); assert.doesNotMatch(r.detail, /login/);
});

const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
check('--help prints usage and exits 0 without reading the project', () => {
  const r = run(['--help'], mkdtempSync(join(tmpdir(), 'rp-')));
  assert.equal(r.status, 0); assert.match(r.stdout, /usage: node reskin-preflight\.mjs/);
});
check('usage errors exit 2', () => {
  assert.equal(run(['--dir']).status, 2); assert.equal(run(['--bogus']).status, 2);
});
check('CLI exits 0 on a ready project and 1 after breaking it', () => {
  const root = mkdtempSync(join(tmpdir(), 'rp-'));
  const read = project();
  for (const rel of ['stardust/state.json', 'stardust/canon/canon.css', 'stardust/canon/header.html', 'DESIGN.json', 'stardust/direction.md', 'stardust/dynamic-features.md', 'stardust/reskin/ledger.json']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), read(rel));
  }
  const ok = run(['--root', root, '--json']);
  assert.equal(ok.status, 0, ok.stdout); assert.equal(JSON.parse(ok.stdout).ready, true);
  writeFileSync(join(root, 'stardust/canon/canon.css'), '.a{}');
  const bad = run(['--root', root]);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL canon/); assert.match(bad.stdout, /not ready/);
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
