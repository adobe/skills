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
function project(over = {}) {
  const files = {
    'stardust/state.json': JSON.stringify({ flow: 'reskin', pages: [{ slug: 'login', type: 'form', status: 'approved' }, { slug: 'registration', type: 'form', status: 'extracted' }] }),
    'stardust/canon/canon.css': CSS,
    'stardust/canon/header.html': HEADER,
    'DESIGN.json': JSON.stringify({ source: { kind: 'donor' }, extensions: { canon: { files: { css: { path: 'stardust/canon/canon.css', sha: sha(CSS) }, header: { path: 'stardust/canon/header.html', sha: sha(HEADER) } } } } }),
    'stardust/direction.md': '# Direction\n\n## Active\n\nDonor reskin.\n',
    'stardust/dynamic-features.md': DYN,
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
  for (const rel of ['stardust/state.json', 'stardust/canon/canon.css', 'stardust/canon/header.html', 'DESIGN.json', 'stardust/direction.md', 'stardust/dynamic-features.md']) {
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
