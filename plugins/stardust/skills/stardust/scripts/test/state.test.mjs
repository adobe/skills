#!/usr/bin/env node
// skills/stardust/scripts/test/state.test.mjs — the state.mjs contract: legal forward moves and
// jumps, re-entry, backward refusal vs --force, all-or-nothing on a bad slug, history entry fields
// (at, approvedBy), prototypePath / migratedPath, stale clearing per status, _provenance
// re-stamp with extra keys preserved, top-level key order (flow keys, unknown keys anchored in
// place), --history-only, the value-flag swallow rule, summary counts and --slugs, usage errors and
// the rejected --gate / --note flags. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER, SET_BY, TOP_ORDER, advance, classify, orderTopLevel, pluginVersion, stampProvenance, summarise } from '../state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'state.mjs');
const root = mkdtempSync(join(tmpdir(), 'state-test-'));
const dir = join(root, 'stardust'); mkdirSync(dir);
const file = join(dir, 'state.json');
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const read = () => JSON.parse(readFileSync(file, 'utf8'));
const page = (slug) => read().pages.find((p) => p.slug === slug);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const mkPage = (slug, status, extra = {}) => ({ slug, url: `https://example.com/${slug === 'home' ? '' : slug}`, title: slug, type: null, status, history: [{ status: 'extracted', at: '2026-01-01T00:00:00Z' }], stale: false, staleReason: null, currentStatePath: `stardust/current/pages/${slug}.json`, prototypePath: null, migratedPath: null, ...extra });
// Deliberately mis-ordered top-level keys and an extra provenance key, to prove the writer fixes
// the order and preserves what it does not own.
const FIXTURE = {
  pages: [mkPage('home', 'extracted'), mkPage('about', 'extracted'), mkPage('pricing', 'directed', { history: [{ status: 'extracted', at: '2026-01-01T00:00:00Z' }, { status: 'directed', at: '2026-01-02T00:00:00Z' }] }), mkPage('contact', 'prototyped', { stale: true, staleReason: 'direction changed at 2026-01-03T00:00:00Z; affected: color.primary', prototypePath: 'stardust/prototypes/contact-proposed.html' })],
  site: { originUrl: 'https://example.com', deployUrl: null, extractedAt: '2026-01-01T00:00:00Z', pageCap: 25, totalDiscovered: 4, crawled: 4 },
  _provenance: { writtenBy: 'stardust:extract', writtenAt: '2026-01-01T00:00:00Z', readArtifacts: ['https://example.com/'], stardustVersion: '0.1.0' },
  direction: null,
  handsOff: true,
  migrate: { selfContained: true },
};
writeFileSync(file, JSON.stringify(FIXTURE, null, 2));

// ---- pure helpers -------------------------------------------------------------------------------
check('classify: forward, jump, re-entry, backward, unknown-from; bad target throws', () => {
  assert.equal(classify('extracted', 'directed'), 'forward');
  assert.equal(classify('directed', 'migrated'), 'forward');
  assert.equal(classify('approved', 'approved'), 'reentry');
  assert.equal(classify('approved', 'prototyped'), 'backward');
  assert.equal(classify('weird', 'directed'), 'unknown-from');
  assert.throws(() => classify('extracted', 'done'), /--to must be one of/);
  assert.deepEqual(ORDER, ['extracted', 'directed', 'prototyped', 'approved', 'migrated']);
  assert.deepEqual(SET_BY, { extracted: 'extract', directed: 'direct', prototyped: 'prototype', approved: 'prototype', migrated: 'migrate' });
});
check('stampProvenance: writtenBy/writtenAt first, extra keys kept, stardustVersion from the plugin manifest (fallback: previous)', () => {
  const p = stampProvenance({ writtenBy: 'stardust:extract', writtenAt: 'old', readArtifacts: ['x'], stardustVersion: '0.1.0' }, 'stardust:prototype', '2026-02-02T00:00:00Z');
  assert.deepEqual(Object.keys(p), ['writtenBy', 'writtenAt', 'readArtifacts', 'stardustVersion']);
  assert.equal(p.writtenBy, 'stardust:prototype'); assert.equal(p.writtenAt, '2026-02-02T00:00:00Z'); assert.deepEqual(p.readArtifacts, ['x']);
  assert.equal(p.stardustVersion, pluginVersion() || '0.1.0'); assert.match(p.stardustVersion, /^\d+\.\d+\.\d+/);
  assert.deepEqual(Object.keys(stampProvenance(undefined, 'stardust:migrate')).slice(0, 2), ['writtenBy', 'writtenAt']);
});
check('orderTopLevel: _provenance, site, direction, handsOff, pages, then the rest in place', () => {
  assert.deepEqual(Object.keys(orderTopLevel(FIXTURE)), ['_provenance', 'site', 'direction', 'handsOff', 'pages', 'migrate']);
  assert.deepEqual(Object.keys(orderTopLevel({ pages: [], _provenance: {} })), ['_provenance', 'pages']);
});
check('orderTopLevel: the 0.23.0 flow keys sit between handsOff and pages; an unknown key keeps its place, never pushed behind pages', () => {
  assert.deepEqual(TOP_ORDER, ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'flowChosenAt', 'flowSource', 'pages']);
  const canonical = ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'flowChosenAt', 'flowSource', 'pages', 'migrate'];
  assert.deepEqual(Object.keys(orderTopLevel(Object.fromEntries(canonical.map((k) => [k, 1])))), canonical, 'a file already in order is untouched');
  const shuffled = { pages: [], flowSource: 'question', flow: 'replica', _provenance: {}, flowChosenAt: 't', site: {} };
  assert.deepEqual(Object.keys(orderTopLevel(shuffled)), ['_provenance', 'site', 'flow', 'flowChosenAt', 'flowSource', 'pages']);
  const mid = { _provenance: {}, site: {}, direction: null, reskin: { tokens: 1 }, handsOff: false, pages: [], migrate: {} };
  assert.deepEqual(Object.keys(orderTopLevel(mid)), ['_provenance', 'site', 'direction', 'reskin', 'handsOff', 'pages', 'migrate'], 'reskin stays after direction, not after pages');
  const lead = { note: 'x', pages: [], _provenance: {} };
  assert.deepEqual(Object.keys(orderTopLevel(lead)), ['note', '_provenance', 'pages'], 'a leading unknown key stays leading');
  const tail = { _provenance: {}, pages: [], migrate: {}, flow: 'redesign', extra: 1 };
  assert.deepEqual(Object.keys(orderTopLevel(tail)), ['_provenance', 'flow', 'pages', 'migrate', 'extra'], 'an unknown key that followed pages in the file still follows pages');
});
check('advance (in memory): unknown slug throws before any mutation; --by needs --to approved', () => {
  const s = structuredClone(FIXTURE);
  assert.throws(() => advance(s, ['home', 'ghost'], { to: 'directed' }), /unknown slug\(s\): ghost/);
  assert.equal(s.pages[0].status, 'extracted', 'nothing moved');
  assert.throws(() => advance(s, ['home'], { to: 'directed', by: 'hands-off' }), /--by only applies to --to approved/);
});
check('summarise: counts per status, other statuses, stale list', () => {
  const s = summarise({ pages: [...FIXTURE.pages, mkPage('x', 'weird')] });
  assert.equal(s.total, 5); assert.deepEqual(s.counts.extracted, ['home', 'about']); assert.deepEqual(s.counts.directed, ['pricing']); assert.deepEqual(s.counts.prototyped, ['contact']);
  assert.deepEqual(s.other, { weird: ['x'] }); assert.deepEqual(s.stale, ['contact']);
});

// ---- CLI: transitions ---------------------------------------------------------------------------
check('legal forward move on two pages: status, history entry with at, provenance re-stamped, key order fixed', () => {
  const r = run('advance', 'home', 'about', '--to', 'directed');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^state: 2 page\(s\) → directed: home \(extracted→directed\), about \(extracted→directed\) · written by stardust:direct$/m);
  const s = read();
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'handsOff', 'pages', 'migrate']);
  assert.equal(s._provenance.writtenBy, 'stardust:direct'); assert.match(s._provenance.writtenAt, ISO_UTC); assert.deepEqual(s._provenance.readArtifacts, ['https://example.com/']);
  assert.deepEqual(Object.keys(s._provenance), ['writtenBy', 'writtenAt', 'readArtifacts', 'stardustVersion']);
  for (const slug of ['home', 'about']) {
    const p = page(slug); assert.equal(p.status, 'directed'); assert.equal(p.history.length, 2);
    assert.deepEqual(Object.keys(p.history[1]), ['status', 'at']); assert.equal(p.history[1].status, 'directed'); assert.match(p.history[1].at, ISO_UTC);
    assert.equal(p.history[1].at, s._provenance.writtenAt, 'history at and writtenAt share one timestamp');
  }
  assert.equal(page('pricing').history.length, 2, 'untouched page kept verbatim'); assert.equal(s.migrate.selfContained, true); assert.equal(s.handsOff, true);
  assert.ok(readFileSync(file, 'utf8').endsWith('}\n'), 'two-space pretty print with trailing newline');
});
check('--prototype sets prototypePath; --to approved --by records approvedBy; stale is cleared at approval', () => {
  const r = run('advance', 'contact', '--to', 'approved', '--by', 'hands-off', '--prototype', 'stardust/prototypes/contact-proposed.html');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /contact \(prototyped→approved\) · approvedBy hands-off · prototypePath set · stale cleared: contact · written by stardust:prototype/);
  const p = page('contact');
  assert.equal(p.status, 'approved'); assert.deepEqual(p.history.at(-1), { status: 'approved', at: p.history.at(-1).at, approvedBy: 'hands-off' });
  assert.equal(p.stale, false); assert.equal(p.staleReason, null); assert.equal(p.prototypePath, 'stardust/prototypes/contact-proposed.html');
});
check('re-entry (approved → approved) appends a fresh entry without approvedBy; forward jump directed → migrated is legal and sets migratedPath', () => {
  const r = run('advance', 'contact', '--to', 'approved');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /contact \(approved→approved, again\)/);
  const hist = page('contact').history; assert.equal(hist.length, 3, 'extracted, approved (hands-off), approved (again)'); assert.deepEqual(Object.keys(hist.at(-1)), ['status', 'at']); assert.equal(hist.at(-2).approvedBy, 'hands-off', 'the earlier hands-off entry is not rewritten');
  const j = run('advance', 'pricing', '--to', 'migrated', '--migrated', 'stardust/migrated/pricing/index.html');
  assert.equal(j.code, 0, j.err); assert.match(j.out, /pricing \(directed→migrated\) · migratedPath set · written by stardust:migrate/);
  assert.equal(page('pricing').migratedPath, 'stardust/migrated/pricing/index.html'); assert.equal(read()._provenance.writtenBy, 'stardust:migrate');
});
check('stale is NOT cleared by a move to directed (only prototyped|approved|migrated clear it)', () => {
  const s = read(); s.pages.find((p) => p.slug === 'home').stale = true; s.pages.find((p) => p.slug === 'home').staleReason = 'direction changed'; writeFileSync(file, JSON.stringify(s));
  const r = run('advance', 'home', '--to', 'directed'); assert.equal(r.code, 0, r.err); assert.match(r.out, /home \(directed→directed, again\)/); assert.doesNotMatch(r.out, /stale cleared/);
  assert.equal(page('home').stale, true);
  const p = run('advance', 'home', '--to', 'prototyped'); assert.equal(p.code, 0, p.err); assert.match(p.out, /stale cleared: home/); assert.equal(page('home').stale, false); assert.equal(page('home').staleReason, null);
});
check('illegal backward move: exit 2, clear message, file byte-identical', () => {
  const before = readFileSync(file, 'utf8');
  const r = run('advance', 'contact', '--to', 'prototyped');
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.match(r.err, /contact: approved → prototyped moves backward; a page never moves backward \(state-machine\.md § Linearity rule\)/); assert.match(r.err, /--force/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
check('all-or-nothing: one unknown slug among several means nothing is written', () => {
  const before = readFileSync(file, 'utf8');
  const r = run('advance', 'about', 'ghost', '--to', 'prototyped');
  assert.equal(r.code, 2); assert.match(r.err, /unknown slug\(s\): ghost/); assert.equal(readFileSync(file, 'utf8'), before);
});
check('--force allows the backward move and says so; --skill overrides writtenBy', () => {
  const r = run('advance', 'contact', '--to', 'prototyped', '--force', '--skill', 'replica');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /contact \(approved→prototyped, forced\) · written by stardust:replica/);
  assert.equal(page('contact').status, 'prototyped'); assert.equal(page('contact').history.at(-1).status, 'prototyped'); assert.equal(read()._provenance.writtenBy, 'stardust:replica');
});
check('--history-only: a prototyped entry is appended after approved, status stays approved, no demotion, paths set, stale untouched', () => {
  const s = read(); const c = s.pages.find((p) => p.slug === 'contact'); c.status = 'approved'; c.stale = true; c.staleReason = 'direction changed'; writeFileSync(file, JSON.stringify(s));
  const before = page('contact').history.length;
  const r = run('advance', 'contact', '--to', 'prototyped', '--history-only', '--prototype', 'stardust/prototypes/contact-proposed.v2.html');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^state: 1 page\(s\) history \+= prototyped: contact \(stays approved, prototyped entry appended\) · prototypePath set · written by stardust:prototype$/m);
  const p = page('contact');
  assert.equal(p.status, 'approved', 'not demoted'); assert.equal(p.history.length, before + 1); assert.deepEqual(Object.keys(p.history.at(-1)), ['status', 'at']); assert.equal(p.history.at(-1).status, 'prototyped');
  assert.equal(p.prototypePath, 'stardust/prototypes/contact-proposed.v2.html'); assert.equal(p.stale, true, 'stale is not cleared: the status did not move');
  assert.equal(read()._provenance.writtenBy, 'stardust:prototype');
  const h = read(); h.pages.find((x) => x.slug === 'contact').stale = false; h.pages.find((x) => x.slug === 'contact').staleReason = null; writeFileSync(file, JSON.stringify(h));
  const fwd = run('advance', 'home', '--to', 'migrated', '--history-only'); assert.equal(fwd.code, 0, fwd.err); assert.equal(page('home').status, 'prototyped', 'a forward status is appended without moving either');
  const both = run('advance', 'home', '--to', 'migrated', '--history-only', '--force'); assert.equal(both.code, 2); assert.match(both.err, /--history-only does not move the page/);
  const bad = run('advance', 'home', '--to', 'done', '--history-only'); assert.equal(bad.code, 2); assert.match(bad.err, /--to must be one of/);
});
check('a value flag followed by another flag (or nothing) is a usage error naming the flag; file byte-identical', () => {
  const before = readFileSync(file, 'utf8');
  for (const [args, flag] of [[['advance', 'home', '--to', '--force'], '--to'], [['advance', 'home', '--to', 'approved', '--by', '--prototype', 'x'], '--by'], [['advance', 'home', '--to', 'prototyped', '--prototype', '--skill', 'prototype'], '--prototype'], [['advance', 'home', '--to', 'migrated', '--migrated', '--force'], '--migrated'], [['advance', 'home', '--to', 'migrated', '--skill', '--force'], '--skill'], [['advance', 'home', '--to'], '--to']]) {
    const r = run(...args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.match(r.err, new RegExp(`^state: ${flag} needs a value`), args.join(' '));
  }
  const dir2 = spawnSync(process.execPath, [SCRIPT, 'summary', '--dir', '--slugs'], { encoding: 'utf8' }); assert.equal(dir2.status, 2); assert.match(dir2.stderr, /--dir needs a value \(got --slugs, which is a flag\)/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
check('a page whose status is outside the lifecycle needs --force', () => {
  const s = read(); s.pages.push(mkPage('odd', 'weird')); writeFileSync(file, JSON.stringify(s));
  const r = run('advance', 'odd', '--to', 'directed'); assert.equal(r.code, 2); assert.match(r.err, /current status "weird" is not in the lifecycle/);
  const f = run('advance', 'odd', '--to', 'directed', '--force'); assert.equal(f.code, 0, f.err); assert.equal(page('odd').status, 'directed');
});

// ---- CLI: summary and usage ---------------------------------------------------------------------
check('summary prints counts by status (all five, plus other and stale); --slugs lists slugs per status', () => {
  const r = run('summary');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), '5 page(s) · extracted 0 · directed 2 · prototyped 1 · approved 1 · migrated 1 · stale 0');
  const s = run('summary', '--slugs');
  assert.match(s.out, /^ {2}directed\s+2 {2}about, odd$/m); assert.match(s.out, /^ {2}prototyped\s+1 {2}home$/m); assert.match(s.out, /^ {2}approved\s+1 {2}contact$/m); assert.match(s.out, /^ {2}migrated\s+1 {2}pricing$/m);
  assert.doesNotMatch(s.out, /^ {2}extracted/m, 'empty statuses are not listed under --slugs');
});
check('summary shows out-of-lifecycle statuses and stale slugs', () => {
  const st = read(); st.pages.push(mkPage('x', 'weird', { stale: true, staleReason: 'test' })); writeFileSync(file, JSON.stringify(st));
  const r = run('summary', '--slugs'); assert.match(r.out, /other\(weird\) 1 · stale 1$/m); assert.match(r.out, /^ {2}other\(weird\)\s+1 {2}x$/m); assert.match(r.out, /^ {2}stale\s+1 {2}x$/m);
});
check('usage: missing --to, bad --to, no slug, unknown command, unknown option, --gate/--note rejected with a pointer, missing file; --help exits 0', () => {
  assert.equal(run('advance', 'home').code, 2);
  const bad = run('advance', 'home', '--to', 'done'); assert.equal(bad.code, 2); assert.match(bad.err, /--to must be one of extracted\|directed\|prototyped\|approved\|migrated/);
  const noslug = run('advance', '--to', 'directed'); assert.equal(noslug.code, 2); assert.match(noslug.err, /at least one <slug>/);
  assert.equal(run('bogus').code, 2);
  assert.equal(run('summary', '--bogus').code, 2);
  const g = run('advance', 'home', '--to', 'approved', '--gate', 'x.json'); assert.equal(g.code, 2); assert.match(g.err, /--gate is not accepted: a state.json history entry carries status, at and approvedBy only/);
  const n = run('advance', 'home', '--to', 'approved', '--note', 'why'); assert.equal(n.code, 2); assert.match(n.err, /journal\.md/);
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }); assert.equal(none.status, 2); assert.match(none.stderr, /Usage:/);
  const missing = spawnSync(process.execPath, [SCRIPT, 'summary', '--dir', join(root, 'nowhere')], { encoding: 'utf8' }); assert.equal(missing.status, 2); assert.match(missing.stderr, /does not exist — extract creates it/);
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /node state\.mjs advance <slug…> --to </); assert.match(h.out, /node state\.mjs summary \[--slugs\]/); assert.match(h.out, /--history-only/);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nstate: all checks passed');
process.exit(failed ? 1 : 0);
