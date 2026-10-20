#!/usr/bin/env node
// skills/stardust/scripts/test/state.test.mjs — the state.mjs contract: legal forward moves and
// jumps, re-entry, backward refusal vs --force, all-or-nothing on a bad slug, history entry fields
// (at, approvedBy), prototypePath / migratedPath, stale clearing per status, _provenance
// re-stamp with extra keys preserved, top-level key order (flow keys, unknown keys anchored in
// place), --history-only, the value-flag swallow rule, summary counts and --slugs, usage errors and
// the rejected --gate / --note flags; init (line list, JSON array, stdin, --types, --site-url, the
// record index, provenance refusals, exists / --force, captureGaps), set (--representative /
// --type, --clear-representative, refusals including representative cycles), the crawl's pre-cap
// totalDiscovered and the summary representative lines; exclude (the on-page record, the top-level
// excluded[] for a page init never had, idempotence, refusals, the summary count); the stardustVersion
// stamp order (plugin manifest, else STARDUST_VERSION, else the stamp carried); flow (the seed on a
// missing file and init filling it, the three keys in place on an existing file, stamped once, the
// forced switch and its flow-switch stale flags, refusals byte-identical); mode (the handsOff marker,
// seeded or set in place, printed) and the approval guard: --by hands-off refused without handsOff: true,
// --by user and a hands-off run allowed. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOWS, FLOW_SOURCES, FLOW_SWITCH_REASON, HANDS_OFF_BY, MODES, ORDER, SET_BY, TOP_ORDER, advance, classify, crawlSlug, modeOf, orderTopLevel, pluginVersion, setFlow, setMode, siteTotalDiscovered, stampProvenance, summarise, urlKey, validateProvenance } from '../state.mjs';

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
  const missing = spawnSync(process.execPath, [SCRIPT, 'summary', '--dir', join(root, 'nowhere')], { encoding: 'utf8' }); assert.equal(missing.status, 2); assert.match(missing.stderr, /does not exist — create it with `state\.mjs init --pages <url-file\|->` after the crawl/);
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /node state\.mjs advance <slug…> --to </); assert.match(h.out, /node state\.mjs summary \[--slugs\]/); assert.match(h.out, /--history-only/);
});
check('advance and summary still refuse the init / set flags as unknown options', () => {
  for (const f of ['--pages', '--types', '--site-url', '--current', '--representative', '--type']) {
    const r = run('advance', 'home', '--to', 'directed', f, 'x'); assert.equal(r.code, 2, f); assert.match(r.err, new RegExp(`^state: unknown option ${f}$`, 'm'));
  }
  assert.equal(run('summary', '--type', 'x').code, 2);
});

// ---- init / set / summary representatives -------------------------------------------------------
const initRoot = mkdtempSync(join(tmpdir(), 'state-init-test-'));
const prov = (o = {}) => ({ renderedBy: 'playwright', fetchedAt: '2026-01-01T00:00:00.000Z', waitMode: 'medium', waitMs: 2500, httpStatus: 200, ...o });
const record = (slug, url, { p = {}, finalUrl = url, title = `Title ${slug}` } = {}) => ({ _provenance: prov(p), slug, url, finalUrl, title, renderedBy: 'playwright', fetchedAt: prov(p).fetchedAt, renderedHtml: '<html></html>' });
// The crawl's records: `about-us-1a2b` is a collision suffix only the URL index can find
// (/about/us slugifies to about-us); `old` redirected, so only its finalUrl names /new-home.
const RECORDS = [
  record('index', 'https://www.example.com/', { title: 'Home' }),
  record('about-us', 'https://www.example.com/about-us'),
  record('about-us-1a2b', 'https://www.example.com/about/us'),
  record('de-produkte', 'https://www.example.com/de/produkte/'),
  record('old', 'https://www.example.com/old', { finalUrl: 'https://www.example.com/new-home' }),
  record('blog', 'https://www.example.com/blog', { title: '' }),
];
let projects = 0;
const project = (records = RECORDS) => {
  const d = join(initRoot, `p${(projects += 1)}`, 'stardust');
  const pagesDir = join(d, 'current', 'pages'); mkdirSync(pagesDir, { recursive: true });
  for (const r of records) writeFileSync(join(pagesDir, `${r.slug}.json`), JSON.stringify(r, null, 2));
  return { d, pagesDir, stateFile: join(d, 'state.json'), list: (name, text) => { const f = join(d, '..', name); writeFileSync(f, text); return f; } };
};
const runIn = (d, args, input) => { const r = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', d], { encoding: 'utf8', input }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const readIn = (d) => JSON.parse(readFileSync(join(d, 'state.json'), 'utf8'));

check('stardustVersion stamp: the plugin manifest, else STARDUST_VERSION (a copied state.mjs with no manifest above it), else the stamp already carried — none when nothing resolves', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const base = { ...process.env }; delete base.STARDUST_VERSION;
  const copyRoot = mkdtempSync(join(tmpdir(), 'state-version-'));
  // the script copied three levels below an empty root (no plugin manifest above it); it has no relative imports
  const COPY = join(copyRoot, 'skills', 'stardust', 'scripts', 'state.mjs'); mkdirSync(dirname(COPY), { recursive: true }); copyFileSync(SCRIPT, COPY);
  const init = (script, env) => {
    const p = project();
    const r = spawnSync(process.execPath, [script, 'init', '--pages', p.list('pages.txt', ['', 'about-us', 'blog'].map((x) => `https://www.example.com/${x}`).join('\n')), '--dir', p.d], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr); return p;
  };
  assert.equal(readIn(init(SCRIPT, { ...base, STARDUST_VERSION: '9.9.9' }).d)._provenance.stardustVersion, manifest, 'the plugin manifest wins over the env');
  const p = init(COPY, { ...base, STARDUST_VERSION: ' 1.2.3-test ' });
  assert.equal(readIn(p.d)._provenance.stardustVersion, '1.2.3-test', 'no manifest: the env, trimmed');
  const ex = spawnSync(process.execPath, [COPY, 'exclude', 'blog', '--reason', 'the source answers 404', '--dir', p.d], { encoding: 'utf8', env: base });
  assert.equal(ex.status, 0, ex.stderr); assert.equal(readIn(p.d)._provenance.stardustVersion, '1.2.3-test', 'a later write without the env keeps the stamp already carried');
  assert.ok(!('stardustVersion' in readIn(init(COPY, base).d)._provenance), 'nothing resolves: no stamp (never 0.0.0 over a real one)');
  rmSync(copyRoot, { recursive: true, force: true });
});

check('crawlSlug mirrors the crawl slug rule; urlKey folds www, trailing slash and fragment, keeps the query', () => {
  assert.equal(crawlSlug('https://example.com/'), 'index'); assert.equal(crawlSlug('https://example.com/About/Team/'), 'about-team'); assert.equal(crawlSlug('https://example.com/a__b//c.html?x=1'), 'a-b-c-html');
  assert.equal(urlKey('https://WWW.Example.com/about/?q=1#top'), 'https://example.com/about?q=1'); assert.equal(urlKey('https://example.com/'), 'https://example.com');
  assert.notEqual(urlKey('http://example.com/a'), urlKey('https://example.com/a'), 'the scheme is part of the origin');
});
check('validateProvenance: a crawl record passes; each condition fails on its own, naming the field', () => {
  const now = Date.parse('2026-01-01T00:10:00Z');
  assert.deepEqual(validateProvenance(record('x', 'https://example.com/x'), { now }), []);
  for (const waitMode of ['slow', 'spec', 'networkidle', 'domcontentloaded(fallback)']) assert.deepEqual(validateProvenance({ _provenance: prov({ waitMode }) }, { now }), [], waitMode);
  assert.deepEqual(validateProvenance({ _provenance: prov({ fetchedAt: '2026-01-01T00:14:00Z' }) }, { now }), [], 'up to 5 min ahead is clock skew');
  const one = (o) => validateProvenance({ _provenance: prov(o) }, { now });
  assert.match(one({ renderedBy: 'fetch' }).join(), /^renderedBy: "fetch" is not "playwright"$/);
  assert.match(one({ fetchedAt: 'yesterday' }).join(), /^fetchedAt: "yesterday" does not parse as ISO 8601$/);
  assert.match(one({ fetchedAt: '2026-01-01T00:16:00Z' }).join(), /^fetchedAt: .* is more than 5 min in the future$/);
  assert.match(one({ waitMs: 0 }).join(), /^waitMs: 0 is not an integer > 0$/); assert.match(one({ waitMs: 2.5 }).join(), /^waitMs/);
  assert.match(one({ waitMode: 'quick' }).join(), /^waitMode: "quick" does not match/);
  assert.match(one({ httpStatus: 404 }).join(), /^httpStatus: 404 is not an integer in \[200, 399\]$/); assert.match(one({ httpStatus: '200' }).join(), /^httpStatus/);
  assert.match(validateProvenance({ slug: 'x' }).join(), /^_provenance: missing, not an object$/);
});
check('init from a line list: index lookup (www, trailing slash, collision suffix, finalUrl), page rows, site, key order, stdout', () => {
  const p = project();
  const list = p.list('pages.txt', '# pages to carry\nhttps://example.com\n\nhttps://www.example.com/about/us/\n  https://example.com/new-home  \nhttps://www.example.com/blog\n');
  const r = runIn(p.d, ['init', '--pages', list]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `state: init 4 page(s) from ${list} · 0 typed · written by stardust:extract\n`);
  const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'pages']); assert.equal(s.direction, null, 'direction present, unresolved');
  assert.equal(s._provenance.writtenBy, 'stardust:extract'); assert.match(s._provenance.writtenAt, ISO_UTC);
  assert.deepEqual(Object.keys(s.site), ['originUrl', 'deployUrl', 'extractedAt', 'pageCap', 'totalDiscovered', 'crawled']);
  assert.deepEqual(s.site, { originUrl: 'https://www.example.com', deployUrl: null, extractedAt: s._provenance.writtenAt, pageCap: null, totalDiscovered: 4, crawled: 4 }, 'no --page-cap, no crawl log: pageCap null, totalDiscovered = input count');
  assert.deepEqual(s.pages.map((x) => x.slug), ['index', 'about-us-1a2b', 'old', 'blog'], 'input order; collision suffix and finalUrl found through the index');
  assert.deepEqual(s.pages[0], { slug: 'index', url: 'https://www.example.com/', title: 'Home', type: null, status: 'extracted', history: [{ status: 'extracted', at: s._provenance.writtenAt }], stale: false, staleReason: null, currentStatePath: `${p.d}/current/pages/index.json`, prototypePath: null, migratedPath: null });
  assert.equal(s.pages[2].url, 'https://www.example.com/old', 'url is the record url'); assert.equal(s.pages[3].title, 'blog', 'an empty title falls back to the slug');
  assert.ok(readFileSync(p.stateFile, 'utf8').endsWith('}\n'));
});
check('init from a JSON array and from stdin; --types sets type and counts typed pages', () => {
  const p = project();
  const json = p.list('pages.json', JSON.stringify(['https://www.example.com/', 'https://www.example.com/about-us']));
  const r = runIn(p.d, ['init', '--pages', json, '--types', 'index=landing, about-us=article']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, / · 2 typed · /);
  assert.deepEqual(readIn(p.d).pages.map((x) => [x.slug, x.type]), [['index', 'landing'], ['about-us', 'article']]);
  const q = project();
  const sin = runIn(q.d, ['init', '--pages', '-', '--types', 'blog=article'], 'https://www.example.com/blog\nhttps://www.example.com/about-us\n');
  assert.equal(sin.code, 0, sin.err); assert.equal(sin.out, 'state: init 2 page(s) from stdin · 1 typed · written by stardust:extract\n');
  assert.deepEqual(readIn(q.d).pages.map((x) => [x.slug, x.type]), [['blog', 'article'], ['about-us', null]]);
});
check('init --types: a slug not in the input or a bad type is a usage error, nothing written', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\n');
  const ghost = runIn(p.d, ['init', '--pages', list, '--types', 'blog=article,about-us=article']); assert.equal(ghost.code, 2); assert.match(ghost.err, /--types names "about-us", which is not among the input pages \(blog\)/);
  const bad = runIn(p.d, ['init', '--pages', list, '--types', 'blog=Article']); assert.equal(bad.code, 2); assert.match(bad.err, /"Article" is not a page type/);
  assert.equal(runIn(p.d, ['init', '--pages', list, '--types', 'blog']).code, 2);
  assert.ok(!existsSync(p.stateFile));
});
check('init --site-url resolves path lines and sets originUrl; a path line without it is a usage error naming the line', () => {
  const p = project(); const list = p.list('pages.txt', '/de/produkte\n/about/us\n');
  const no = runIn(p.d, ['init', '--pages', list]); assert.equal(no.code, 2); assert.match(no.err, /--pages line 1 "\/de\/produkte" is a path; pass --site-url <url>/); assert.ok(!existsSync(p.stateFile));
  const r = runIn(p.d, ['init', '--pages', list, '--site-url', 'https://www.example.com/en/']);
  assert.equal(r.code, 0, r.err); const s = readIn(p.d);
  assert.deepEqual(s.pages.map((x) => [x.slug, x.url]), [['de-produkte', 'https://www.example.com/de/produkte/'], ['about-us-1a2b', 'https://www.example.com/about/us']]);
  assert.equal(s.site.originUrl, 'https://www.example.com');
  assert.equal(runIn(project().d, ['init', '--pages', list, '--site-url', 'example.com']).code, 2, 'a bare host is not a --site-url');
});
check('init refuses a URL with no page record: exit 2, names the crawl slug and the file, nothing written', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\nhttps://www.example.com/Kontakt/Form/\n');
  const r = runIn(p.d, ['init', '--pages', list]);
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.match(r.err, /^state: init refused — 1 of 2 page\(s\) have no valid crawl record under .*; nothing written$/m);
  assert.match(r.err, new RegExp(`^page kontakt-form lacks live-render evidence \\(file exists: no page record for https://www\\.example\\.com/Kontakt/Form/\\) — ${p.d}/current/pages/kontakt-form\\.json; re-crawl it$`, 'm'));
  assert.ok(!existsSync(p.stateFile));
});
check('init refuses a record at the fallback slug that belongs to another URL', () => {
  const p = project(); const list = p.list('pages.txt', 'https://other.example.com/blog\n');
  const r = runIn(p.d, ['init', '--pages', list]); assert.equal(r.code, 2); assert.match(r.err, /page blog lacks live-render evidence \(url: the record is https:\/\/www\.example\.com\/blog, not https:\/\/other\.example\.com\/blog\)/);
  assert.ok(!existsSync(p.stateFile));
});
check('init refuses a record without live-render evidence (renderedBy, waitMs, httpStatus): one line per slug naming slug + condition + file, nothing written', () => {
  const p = project([...RECORDS.slice(0, 2), record('a', 'https://www.example.com/a', { p: { renderedBy: 'synthesized' } }), record('b', 'https://www.example.com/b', { p: { waitMs: 0 } }), record('c', 'https://www.example.com/c', { p: { httpStatus: 404 } })]);
  const list = p.list('pages.txt', ['', 'about-us', 'a', 'b', 'c'].map((x) => `https://www.example.com/${x}`).join('\n'));
  const r = runIn(p.d, ['init', '--pages', list]);
  assert.equal(r.code, 2); assert.match(r.err, /init refused — 3 of 5 page\(s\)/);
  const lines = r.err.trim().split('\n').slice(1);
  assert.deepEqual(lines, [
    `page a lacks live-render evidence (renderedBy: "synthesized" is not "playwright") — ${p.d}/current/pages/a.json; re-crawl it`,
    `page b lacks live-render evidence (waitMs: 0 is not an integer > 0) — ${p.d}/current/pages/b.json; re-crawl it`,
    `page c lacks live-render evidence (httpStatus: 404 is not an integer in [200, 399]) — ${p.d}/current/pages/c.json; re-crawl it`,
  ]);
  assert.ok(!existsSync(p.stateFile));
});
check('init: duplicate slugs in the input are a usage error; an existing state.json is refused byte-identical', () => {
  const p = project();
  const dup = runIn(p.d, ['init', '--pages', p.list('dup.txt', 'https://www.example.com/blog\nhttps://example.com/blog/\n')]);
  assert.equal(dup.code, 2); assert.match(dup.err, /duplicate slug "blog": --pages line 1 \(https:\/\/www\.example\.com\/blog\) and line 2/); assert.ok(!existsSync(p.stateFile));
  const list = p.list('pages.txt', 'https://www.example.com/blog\n');
  assert.equal(runIn(p.d, ['init', '--pages', list]).code, 0);
  const before = readFileSync(p.stateFile, 'utf8');
  const again = runIn(p.d, ['init', '--pages', list]); assert.equal(again.code, 2); assert.match(again.err, /state\.json already exists — init never overwrites it; pass --force/);
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('init --force re-inits while every page is extracted, keeping handsOff / flow / unknown keys in place; refused once a page advanced', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\n');
  writeFileSync(p.stateFile, JSON.stringify({ _provenance: { writtenBy: 'stardust:extract', writtenAt: 'old', readArtifacts: ['x'] }, site: { originUrl: 'https://old.example.com', pageCap: 25 }, direction: null, handsOff: true, flow: 'replica', reskin: { a: 1 }, pages: [mkPage('home', 'extracted')], trailer: 1 }, null, 2));
  const r = runIn(p.d, ['init', '--pages', list, '--force']);
  assert.equal(r.code, 0, r.err); assert.doesNotMatch(r.out, / · kept /, 'a file with pages: the stdout line is unchanged'); const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'reskin', 'pages', 'trailer']);
  assert.equal(s.handsOff, true); assert.equal(s.flow, 'replica'); assert.deepEqual(s.reskin, { a: 1 }); assert.equal(s.trailer, 1);
  assert.deepEqual(Object.keys(s._provenance), ['writtenBy', 'writtenAt', 'stardustVersion'], 'a fresh provenance block');
  assert.equal(s.site.originUrl, 'https://www.example.com'); assert.equal(s.site.pageCap, null, 'site is rebuilt: the old pageCap is not carried'); assert.deepEqual(s.pages.map((x) => x.slug), ['blog']);
  assert.equal(runIn(p.d, ['advance', 'blog', '--to', 'directed']).code, 0);
  const before = readFileSync(p.stateFile, 'utf8');
  const no = runIn(p.d, ['init', '--pages', list, '--force']); assert.equal(no.code, 2); assert.match(no.err, /--force re-inits only while every page is extracted; 1 of 1 page\(s\) moved on: blog \(directed\)/);
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('init fills a state.json that holds no pages (flow keys stamped before extract; pages: []) without --force, keeping its keys in place', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\nhttps://www.example.com/about-us\n');
  const flow = { _provenance: { writtenBy: 'stardust:replica', writtenAt: '2026-01-01T00:00:00Z' }, flow: 'replica', flowChosenAt: '2026-01-01T00:00:00Z', flowSource: 'user-phrase' };
  writeFileSync(p.stateFile, JSON.stringify(flow, null, 2));
  const r = runIn(p.d, ['init', '--pages', list]);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, `state: init 2 page(s) from ${list} · 0 typed · kept flow, flowChosenAt, flowSource · written by stardust:extract\n`);
  const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'flow', 'flowChosenAt', 'flowSource', 'pages']); assert.equal(s.direction, null);
  assert.equal(s.flow, 'replica'); assert.equal(s.flowChosenAt, '2026-01-01T00:00:00Z'); assert.equal(s.flowSource, 'user-phrase');
  assert.equal(s._provenance.writtenBy, 'stardust:extract'); assert.deepEqual(s.pages.map((x) => [x.slug, x.status]), [['blog', 'extracted'], ['about-us', 'extracted']]);
  const q = project();
  writeFileSync(q.stateFile, JSON.stringify({ _provenance: {}, handsOff: true, flow: 'redesign', reskin: { a: 1 }, pages: [] }, null, 2));
  const e = runIn(q.d, ['init', '--pages', list]);
  assert.equal(e.code, 0, e.err); assert.match(e.out, / · 0 typed · kept handsOff, flow, reskin · written by stardust:extract$/m);
  const t = readIn(q.d);
  assert.deepEqual(Object.keys(t), ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'reskin', 'pages'], 'reskin stays after flow, before pages'); assert.equal(t.pages.length, 2);
  const again = runIn(q.d, ['init', '--pages', list]); assert.equal(again.code, 2, 'now it holds pages: refused without --force'); assert.match(again.err, /already exists — init never overwrites it/);
});
check('init refuses an existing state.json that does not parse or whose pages is not an array, with or without --force — byte-identical', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\n');
  for (const [text, re] of [['{ "flow": ', /is not valid JSON/], ['{ "flow": "replica", "pages": {} }', /has a pages key that is not an array/], ['[]', /is not a JSON object/]]) {
    writeFileSync(p.stateFile, text);
    for (const extra of [[], ['--force']]) {
      const r = runIn(p.d, ['init', '--pages', list, ...extra]); assert.equal(r.code, 2, `${text} ${extra}`); assert.equal(r.out, ''); assert.match(r.err, re); assert.equal(readFileSync(p.stateFile, 'utf8'), text);
    }
  }
});
check('init: a pages-less file with a direction keeps it as is (named in · kept)', () => {
  const p = project(); const direction = { resolvedAt: null, phrase: 'calmer, more editorial', directionFile: null, iaFidelity: 'preserved' };
  writeFileSync(p.stateFile, JSON.stringify({ flow: 'redesign', direction }, null, 2));
  const r = runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\n')]);
  assert.equal(r.code, 0, r.err); assert.match(r.out, / · kept flow, direction · written by stardust:extract$/m);
  const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'flow', 'pages']); assert.deepEqual(s.direction, direction);
});
// ---- flow (the master routing's stamp, before extract) ------------------------------------------
check('flow constants; setFlow in memory: unknown flow / source / timestamp refused before anything changes, stamped once, another flow refused without force', () => {
  assert.deepEqual(FLOWS, ['redesign', 'replica', 'reskin']); assert.deepEqual(FLOW_SOURCES, ['user-phrase', 'default', 'question']); assert.equal(FLOW_SWITCH_REASON, 'flow-switch');
  const s = { pages: [] };
  assert.throws(() => setFlow(s, 'sideways'), /flow "sideways" is not a flow \(redesign\|replica\|reskin; state-machine\.md § Flow keys\)/);
  assert.throws(() => setFlow(s, 'replica', { source: 'guess' }), /--source "guess" is not a flow source \(user-phrase\|default\|question\)/);
  assert.throws(() => setFlow(s, 'replica', { at: 'yesterday' }), /--at "yesterday" is not an ISO 8601 timestamp/);
  assert.deepEqual(s, { pages: [] }, 'nothing changed');
  assert.deepEqual(setFlow(s, 'replica', { source: 'user-phrase', at: '2026-01-01T00:00:00Z' }), { changed: true, previous: null, staled: [] });
  assert.deepEqual(s, { pages: [], flow: 'replica', flowChosenAt: '2026-01-01T00:00:00Z', flowSource: 'user-phrase' });
  assert.deepEqual(setFlow(s, 'replica', { source: 'default', at: '2026-02-02T00:00:00Z' }), { changed: false, previous: { flow: 'replica', flowChosenAt: '2026-01-01T00:00:00Z', flowSource: 'user-phrase' }, staled: [] });
  assert.equal(s.flowSource, 'user-phrase', 'the same flow again: stamped once');
  assert.throws(() => setFlow(s, 'redesign'), /refused: flow is already replica \(user-phrase, chosen 2026-01-01T00:00:00Z\) — a switch is explicit/);
  assert.equal(s.flow, 'replica');
});
check('flow on a missing state.json seeds { _provenance, flow, flowChosenAt, flowSource }; the same flow again writes nothing; init then fills it keeping the keys', () => {
  const p = project();
  const none = runIn(p.d, ['flow']); assert.equal(none.code, 0, none.err); assert.equal(none.out, `flow: none (no ${p.stateFile})\n`); assert.ok(!existsSync(p.stateFile), 'printing seeds nothing');
  const r = runIn(p.d, ['flow', 'replica', '--source', 'default', '--at', '2026-01-01T00:00:00Z']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, `state: flow replica (default) chosen 2026-01-01T00:00:00Z · seeded ${p.stateFile} (init fills it after the crawl) · written by stardust:stardust\n`);
  const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'flow', 'flowChosenAt', 'flowSource']);
  assert.deepEqual([s.flow, s.flowChosenAt, s.flowSource, s._provenance.writtenBy, s._provenance.writtenAt], ['replica', '2026-01-01T00:00:00Z', 'default', 'stardust:stardust', '2026-01-01T00:00:00Z']);
  assert.equal(runIn(p.d, ['flow']).out, 'flow: replica (default, chosen 2026-01-01T00:00:00Z)\n');
  const before = readFileSync(p.stateFile, 'utf8');
  const again = runIn(p.d, ['flow', 'replica', '--source', 'user-phrase']);
  assert.equal(again.code, 0, again.err); assert.equal(again.out, 'state: flow replica unchanged (default, chosen 2026-01-01T00:00:00Z)\n');
  assert.equal(readFileSync(p.stateFile, 'utf8'), before, 'stamped once: the second call writes nothing');
  const init = runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\n')]);
  assert.equal(init.code, 0, init.err); assert.match(init.out, / · kept flow, flowChosenAt, flowSource · written by stardust:extract$/m);
  const t = readIn(p.d);
  assert.deepEqual(Object.keys(t), ['_provenance', 'site', 'direction', 'flow', 'flowChosenAt', 'flowSource', 'pages']); assert.deepEqual([t.flow, t.flowSource], ['replica', 'default']);
});
check('flow on an existing state.json with pages sets the three keys in their place and nothing else; --skill names the writer; now when --at is absent', () => {
  const p = project();
  writeFileSync(p.stateFile, JSON.stringify({ _provenance: { writtenBy: 'stardust:extract', writtenAt: 'old', readArtifacts: ['x'] }, site: { originUrl: 'https://www.example.com' }, direction: null, handsOff: true, pages: [mkPage('home', 'extracted')], migrate: { a: 1 } }, null, 2));
  const r = runIn(p.d, ['flow', 'redesign', '--source', 'user-phrase', '--skill', 'prepare-migration']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^state: flow redesign \(user-phrase\) chosen \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z · written by stardust:prepare-migration\n$/);
  const s = readIn(p.d);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'flowChosenAt', 'flowSource', 'pages', 'migrate']);
  assert.equal(s.flow, 'redesign'); assert.match(s.flowChosenAt, ISO_UTC); assert.equal(s.flowSource, 'user-phrase'); assert.equal(s.flowChosenAt, s._provenance.writtenAt, 'one timestamp for the stamp and the provenance');
  assert.equal(s._provenance.writtenBy, 'stardust:prepare-migration'); assert.deepEqual(s._provenance.readArtifacts, ['x'], 'extra provenance keys kept');
  assert.equal(s.handsOff, true); assert.deepEqual(s.migrate, { a: 1 }); assert.deepEqual(s.pages.map((x) => [x.slug, x.status, x.stale]), [['home', 'extracted', false]]);
});
check('flow: another flow is refused byte-identical (exit 2); --force switches it (--source question) and marks every prototyped / approved / migrated page stale (flow-switch), extracted and directed untouched', () => {
  const p = project();
  const pages = [mkPage('home', 'extracted'), mkPage('about', 'directed'), mkPage('blog', 'prototyped', { prototypePath: 'stardust/prototypes/blog-proposed.html' }), mkPage('pricing', 'approved'), mkPage('contact', 'migrated', { stale: true, staleReason: 'direction changed at 2026-01-03T00:00:00Z; affected: color.primary' })];
  writeFileSync(p.stateFile, JSON.stringify({ _provenance: { writtenBy: 'stardust:replica', writtenAt: 'old' }, flow: 'replica', flowChosenAt: '2026-01-01T00:00:00Z', flowSource: 'user-phrase', pages }, null, 2));
  const before = readFileSync(p.stateFile, 'utf8');
  const no = runIn(p.d, ['flow', 'redesign', '--source', 'question']);
  assert.equal(no.code, 2); assert.equal(no.out, '');
  assert.equal(no.err, 'state: refused: flow is already replica (user-phrase, chosen 2026-01-01T00:00:00Z) — a switch is explicit ($stardust <skill> --switch-flow, state-machine.md § Switching): flow redesign --source question --force, which marks the old flow\'s prototyped, approved and migrated pages stale\n');
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
  const r = runIn(p.d, ['flow', 'redesign', '--source', 'question', '--force', '--at', '2026-02-02T00:00:00Z']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'state: flow redesign (question) chosen 2026-02-02T00:00:00Z · switched from replica · stale (flow-switch): blog, pricing, contact · written by stardust:stardust\n');
  const s = readIn(p.d);
  assert.deepEqual([s.flow, s.flowChosenAt, s.flowSource], ['redesign', '2026-02-02T00:00:00Z', 'question']);
  assert.deepEqual(s.pages.map((x) => [x.slug, x.status, x.stale, x.staleReason]), [['home', 'extracted', false, null], ['about', 'directed', false, null], ['blog', 'prototyped', true, 'flow-switch'], ['pricing', 'approved', true, 'flow-switch'], ['contact', 'migrated', true, 'flow-switch']]);
  assert.equal(s.pages[2].prototypePath, 'stardust/prototypes/blog-proposed.html', 'a switch flags; it deletes nothing');
  assert.equal(runIn(p.d, ['summary']).out, '5 page(s) · extracted 1 · directed 1 · prototyped 1 · approved 1 · migrated 1 · stale 3\n');
});
check('flow usage errors and refusals (exit 2, nothing written, no seed): unknown flow / source, a bad --at, two flows, a flag flow does not read, --source / --at elsewhere, a file that does not parse; --help names it', () => {
  const p = project();
  for (const [args, re] of [
    [['flow', 'sideways'], /flow "sideways" is not a flow \(redesign\|replica\|reskin; state-machine\.md § Flow keys\)/],
    [['flow', 'replica', '--source', 'guess'], /--source "guess" is not a flow source \(user-phrase\|default\|question\)/],
    [['flow', 'replica', '--at', 'yesterday'], /--at "yesterday" is not an ISO 8601 timestamp/],
    [['flow', 'replica', 'redesign'], /flow takes one flow \(redesign\|replica\|reskin\), got replica redesign/],
    [['flow', 'replica', '--to', 'directed'], /--to does not apply to flow \(it reads --source, --at, --skill, --force, --dir\)/],
    [['flow', 'replica', '--source'], /--source needs a value/],
    [['advance', 'home', '--to', 'directed', '--source', 'default'], /unknown option --source/],
    [['summary', '--at', '2026-01-01T00:00:00Z'], /unknown option --at/],
  ]) { const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, '', args.join(' ')); assert.match(r.err, re, args.join(' ')); }
  assert.ok(!existsSync(p.stateFile), 'a refusal seeds nothing');
  writeFileSync(p.stateFile, '{ "flow": ');
  const bad = runIn(p.d, ['flow', 'replica']); assert.equal(bad.code, 2); assert.match(bad.err, /is not valid JSON .* — left as it is/); assert.equal(readFileSync(p.stateFile, 'utf8'), '{ "flow": ');
  assert.equal(runIn(p.d, ['flow']).code, 2, 'printing refuses a file that does not parse too');
  const h = runIn(p.d, ['--help']); assert.equal(h.code, 0); assert.match(h.out, /node state\.mjs flow \[redesign\|replica\|reskin\] \[--source user-phrase\|default\|question\] \[--at <iso>\]/);
});
// ---- mode (the handsOff marker) and the approval guard ------------------------------------------
check('mode constants; setMode / modeOf in memory: an unknown mode refused, the same value unchanged, hands-off only on handsOff === true', () => {
  assert.deepEqual(MODES, { 'hands-off': true, interactive: false }); assert.equal(HANDS_OFF_BY, 'hands-off');
  const s = { pages: [] };
  assert.throws(() => setMode(s, 'autopilot'), /mode "autopilot" is not a mode \(hands-off\|interactive; state-machine\.md § Hands-off keys\)/);
  assert.deepEqual(s, { pages: [] });
  assert.deepEqual(setMode(s, 'hands-off'), { changed: true, previous: undefined }); assert.equal(s.handsOff, true);
  assert.deepEqual(setMode(s, 'hands-off'), { changed: false, previous: true });
  assert.deepEqual(setMode(s, 'interactive'), { changed: true, previous: true }); assert.equal(s.handsOff, false);
  for (const [state, mode] of [[{ handsOff: true }, 'hands-off'], [{ handsOff: false }, 'interactive'], [{}, 'interactive'], [{ handsOff: 'yes' }, 'interactive'], [null, 'interactive']]) assert.equal(modeOf(state), mode, JSON.stringify(state));
});
check('advance --to approved --by hands-off is refused (exit 2, byte-identical) without handsOff: true — with --history-only too; --by user and no --by pass; after mode hands-off it passes', () => {
  const p = project();
  const seed = () => writeFileSync(p.stateFile, JSON.stringify({ _provenance: { writtenBy: 'stardust:extract', writtenAt: 'old' }, site: { originUrl: 'https://www.example.com' }, direction: null, pages: [mkPage('home', 'prototyped', { prototypePath: 'stardust/prototypes/home-proposed.html' }), mkPage('about', 'prototyped')] }, null, 2));
  seed();
  const before = readFileSync(p.stateFile, 'utf8');
  const msg = 'state: refused: --by hands-off needs hands-off mode — state.json has no handsOff: true. Hands-off is activated by --hands-off on the invocation or an explicit user phrase (master skill § Hands-off mode) and recorded with `state.mjs mode hands-off`; an interactive run records the user\'s own "approve <slug>" as advance <slug> --to approved --by user\n';
  for (const args of [['advance', 'home', '--to', 'approved', '--by', 'hands-off'], ['advance', 'home', 'about', '--to', 'approved', '--by', 'hands-off', '--prototype', 'x.html'], ['advance', 'home', '--to', 'approved', '--by', 'hands-off', '--history-only'], ['advance', 'home', '--to', 'approved', '--by', 'hands-off', '--force']]) {
    const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.equal(r.err, msg, args.join(' '));
  }
  assert.equal(readFileSync(p.stateFile, 'utf8'), before, 'nothing written');
  assert.equal(runIn(p.d, ['mode', 'interactive']).code, 0);
  const still = runIn(p.d, ['advance', 'home', '--to', 'approved', '--by', 'hands-off']); assert.equal(still.code, 2, 'handsOff: false is not hands-off'); assert.equal(still.err, msg);
  assert.throws(() => advance(JSON.parse(readFileSync(p.stateFile, 'utf8')), ['home'], { to: 'approved', by: 'hands-off' }), /refused: --by hands-off needs hands-off mode/, 'the library path is guarded too');
  const user = runIn(p.d, ['advance', 'home', '--to', 'approved', '--by', 'user', '--prototype', 'stardust/prototypes/home-proposed.html']);
  assert.equal(user.code, 0, user.err); assert.match(user.out, /home \(prototyped→approved\) · approvedBy user · prototypePath set · written by stardust:prototype/);
  assert.deepEqual(readIn(p.d).pages[0].history.at(-1), { status: 'approved', at: readIn(p.d).pages[0].history.at(-1).at, approvedBy: 'user' });
  const plain = runIn(p.d, ['advance', 'about', '--to', 'approved']); assert.equal(plain.code, 0, plain.err); assert.deepEqual(Object.keys(readIn(p.d).pages[1].history.at(-1)), ['status', 'at']);
  seed();
  const on = runIn(p.d, ['mode', 'hands-off', '--at', '2026-03-03T00:00:00Z']);
  assert.equal(on.code, 0, on.err); assert.equal(on.out, 'state: mode hands-off (handsOff: true) · written by stardust:stardust\n');
  const s = readIn(p.d); assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'handsOff', 'pages']); assert.equal(s.handsOff, true); assert.equal(s._provenance.writtenAt, '2026-03-03T00:00:00Z');
  const ok = runIn(p.d, ['advance', 'home', '--to', 'approved', '--by', 'hands-off', '--prototype', 'stardust/prototypes/home-proposed.html']);
  assert.equal(ok.code, 0, ok.err); assert.match(ok.out, /approvedBy hands-off/); assert.equal(readIn(p.d).pages[0].history.at(-1).approvedBy, 'hands-off');
});
check('mode prints the current mode (missing file, no key, true, false); mode on a missing state.json seeds it and init keeps the key; the same mode again writes nothing; usage errors', () => {
  const p = project();
  assert.equal(runIn(p.d, ['mode']).out, `mode: interactive (no ${p.stateFile})\n`); assert.ok(!existsSync(p.stateFile), 'printing seeds nothing');
  const r = runIn(p.d, ['mode', 'hands-off', '--skill', 'replica', '--at', '2026-01-01T00:00:00Z']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, `state: mode hands-off (handsOff: true) · seeded ${p.stateFile} (init fills it after the crawl) · written by stardust:replica\n`);
  const s = readIn(p.d); assert.deepEqual(Object.keys(s), ['_provenance', 'handsOff']); assert.equal(s.handsOff, true); assert.equal(s._provenance.writtenBy, 'stardust:replica');
  assert.equal(runIn(p.d, ['mode']).out, 'mode: hands-off (handsOff: true)\n');
  const before = readFileSync(p.stateFile, 'utf8');
  const again = runIn(p.d, ['mode', 'hands-off']); assert.equal(again.code, 0, again.err); assert.equal(again.out, 'state: mode hands-off unchanged (handsOff: true)\n'); assert.equal(readFileSync(p.stateFile, 'utf8'), before);
  assert.equal(runIn(p.d, ['flow', 'replica', '--at', '2026-01-01T00:00:00Z']).code, 0, 'flow and mode stack on the same seed');
  assert.deepEqual(Object.keys(readIn(p.d)), ['_provenance', 'handsOff', 'flow', 'flowChosenAt', 'flowSource']);
  const init = runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\n')]);
  assert.equal(init.code, 0, init.err); assert.match(init.out, / · kept handsOff, flow, flowChosenAt, flowSource · /);
  assert.deepEqual(Object.keys(readIn(p.d)), ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'flowChosenAt', 'flowSource', 'pages']);
  const off = runIn(p.d, ['mode', 'interactive']); assert.equal(off.code, 0, off.err); assert.equal(off.out, 'state: mode interactive (handsOff: false) · written by stardust:stardust\n');
  assert.equal(runIn(p.d, ['mode']).out, 'mode: interactive (handsOff: false)\n');
  writeFileSync(p.stateFile, JSON.stringify({ pages: [] })); assert.equal(runIn(p.d, ['mode']).out, 'mode: interactive (no handsOff key)\n');
  for (const [args, re] of [
    [['mode', 'autopilot'], /mode "autopilot" is not a mode \(hands-off\|interactive/],
    [['mode', 'hands-off', 'interactive'], /mode takes one mode \(hands-off\|interactive\), got hands-off interactive/],
    [['mode', 'hands-off', '--at', 'now'], /--at "now" is not an ISO 8601 timestamp/],
    [['mode', 'hands-off', '--force'], /--force does not apply to mode \(it reads --at, --skill, --dir\)/],
    [['mode', 'hands-off', '--source', 'default'], /--source does not apply to mode/],
  ]) { const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.match(r.err, re, args.join(' ')); }
  const h = runIn(p.d, ['--help']); assert.match(h.out, /node state\.mjs mode \[hands-off\|interactive\] \[--at <iso>\]/); assert.match(h.out, /--by hands-off refuses \(exit 2\)/);
});
check('siteTotalDiscovered: the post-cap crawl count is a total only where the cap did not bite', () => {
  assert.equal(siteTotalDiscovered({ count: 38, pageCap: 0, inputCount: 2 }), 38, '--page-cap 0: no cap');
  assert.equal(siteTotalDiscovered({ count: 38, pageCap: 50, inputCount: 2 }), 38, 'count below the cap');
  assert.equal(siteTotalDiscovered({ count: 25, pageCap: 25, inputCount: 2 }), null, 'count at the cap: the cap bit');
  assert.equal(siteTotalDiscovered({ count: 30, pageCap: 25, inputCount: 2 }), null, 'count above the cap');
  assert.equal(siteTotalDiscovered({ count: 25, pageCap: null, inputCount: 2 }), 25, 'no --page-cap: the count as logged');
  assert.equal(siteTotalDiscovered({ count: null, pageCap: 25, inputCount: 2 }), 2, 'no logged count: the input count');
});
check('siteTotalDiscovered: a logged pre-cap total (integer >= 0) wins over the cap rule; anything else falls back to it', () => {
  assert.equal(siteTotalDiscovered({ count: 25, total: 140, pageCap: 25, inputCount: 2 }), 140, 'the cap bit, the total is known');
  assert.equal(siteTotalDiscovered({ count: 18, total: 18, pageCap: 25, inputCount: 2 }), 18);
  assert.equal(siteTotalDiscovered({ count: null, total: 0, pageCap: null, inputCount: 2 }), 0, 'zero is a total');
  for (const total of [null, -1, 2.5, '140']) assert.equal(siteTotalDiscovered({ count: 25, total, pageCap: 25, inputCount: 2 }), null, `total ${JSON.stringify(total)}: today's rule`);
});
check('init --page-cap sets site.pageCap and decides totalDiscovered from _crawl-log.json#discovery (total, else count); site key order with captureGaps', () => {
  const pages = 'https://www.example.com/blog\nhttps://www.example.com/about-us\n';
  const initWith = (count, cap, gaps = false, extra = {}) => {
    const p = project();
    writeFileSync(join(p.d, 'current', '_crawl-log.json'), JSON.stringify({ discovery: { fetchTechnique: 'sitemap', count, ...extra }, ...(gaps ? { captureGaps: { roots: [{ root: '/de', slug: 'de', linked: 1, uncaptured: ['/de/a'] }], detail: '' } } : {}) }));
    const r = runIn(p.d, ['init', '--pages', p.list('pages.txt', pages), ...(cap === null ? [] : ['--page-cap', cap])]);
    assert.equal(r.code, 0, r.err); return readIn(p.d).site;
  };
  const bit = initWith(25, '25', true);
  assert.deepEqual(Object.keys(bit), ['originUrl', 'deployUrl', 'extractedAt', 'pageCap', 'totalDiscovered', 'crawled', 'captureGaps']);
  assert.equal(bit.pageCap, 25); assert.equal(bit.totalDiscovered, null, 'count >= --page-cap: the cap bit, no pre-cap total logged'); assert.equal(bit.crawled, 2);
  const total = initWith(25, '25', false, { total: 140 }); assert.equal(total.pageCap, 25); assert.equal(total.totalDiscovered, 140, 'the cap bit, the logged pre-cap total is the total');
  const under = initWith(18, '25'); assert.equal(under.totalDiscovered, 18, 'count < --page-cap: the cap did not bite');
  const nocap = initWith(38, '0'); assert.equal(nocap.pageCap, 0, '0 = no cap, as crawl --max 0'); assert.equal(nocap.totalDiscovered, 38);
  const nopc = initWith(25, null); assert.equal(nopc.pageCap, null); assert.equal(nopc.totalDiscovered, 25, 'no --page-cap: the count as logged');
  const q = project(); writeFileSync(join(q.d, 'current', '_crawl-log.json'), JSON.stringify({ discovery: { count: '38' } }));
  assert.equal(runIn(q.d, ['init', '--pages', q.list('pages.txt', 'https://www.example.com/blog\n'), '--page-cap', '25']).code, 0);
  assert.equal(readIn(q.d).site.totalDiscovered, 1, 'no integer count logged: the input count');
});
check('init --page-cap that is not an integer >= 0 is a usage error, nothing written; advance refuses --page-cap', () => {
  const p = project(); const list = p.list('pages.txt', 'https://www.example.com/blog\n');
  for (const v of ['x', '-1', '2.5', '']) { const r = runIn(p.d, ['init', '--pages', list, '--page-cap', v]); assert.equal(r.code, 2, v); assert.match(r.err, /--page-cap ".*" is not an integer >= 0 \(0 = no cap, as crawl --max 0\)/, v); }
  const none = runIn(p.d, ['init', '--pages', list, '--page-cap']); assert.equal(none.code, 2); assert.match(none.err, /--page-cap needs a value/);
  assert.ok(!existsSync(p.stateFile));
  const adv = run('advance', 'home', '--to', 'directed', '--page-cap', '5'); assert.equal(adv.code, 2); assert.match(adv.err, /^state: unknown option --page-cap$/m);
});
check('init copies _crawl-log.json#captureGaps.roots (only the roots) into site.captureGaps', () => {
  const p = project(); const roots = [{ root: '/de', slug: 'de', linked: 3, uncaptured: ['/de/a', '/de/b'] }];
  writeFileSync(join(p.d, 'current', '_crawl-log.json'), JSON.stringify({ discovery: 'sitemap', captureGaps: { roots, detail: 'locale roots', scope: { entryLocale: '/en' } } }));
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\n')]).code, 0);
  assert.deepEqual(readIn(p.d).site.captureGaps, roots);
  const q = project(); writeFileSync(join(q.d, 'current', '_crawl-log.json'), JSON.stringify({ captureGaps: { roots: [], detail: '' } }));
  assert.equal(runIn(q.d, ['init', '--pages', q.list('pages.txt', 'https://www.example.com/blog\n')]).code, 0);
  assert.ok(!('captureGaps' in readIn(q.d).site), 'no roots, no key');
});
check('init: --current points at another crawl dir; flags init does not read are usage errors; --pages is required', () => {
  const p = project(); const other = join(p.d, '..', 'crawl'); mkdirSync(join(other, 'pages'), { recursive: true });
  writeFileSync(join(other, 'pages', 'blog.json'), JSON.stringify(record('blog', 'https://www.example.com/blog')));
  const r = runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\n'), '--current', other]);
  assert.equal(r.code, 0, r.err); assert.equal(readIn(p.d).pages[0].currentStatePath, `${other}/pages/blog.json`);
  const q = project();
  const stray = runIn(q.d, ['init', '--pages', 'x', '--to', 'directed']); assert.equal(stray.code, 2); assert.match(stray.err, /--to does not apply to init/);
  assert.equal(runIn(q.d, ['init']).code, 2); assert.equal(runIn(q.d, ['init', '--pages', join(q.d, 'nope.txt')]).code, 2);
  const flag = runIn(q.d, ['init', '--pages', '--force']); assert.equal(flag.code, 2); assert.match(flag.err, /--pages needs a value \(got --force, which is a flag\)/);
  assert.ok(!existsSync(q.stateFile));
});
check('set --representative / --type: all named pages, keys placed after type, provenance re-stamped (stardust:direct, --skill overrides)', () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', ['', 'about-us', 'about/us', 'blog', 'de/produkte'].map((x) => `https://www.example.com/${x}`).join('\n'))]).code, 0);
  const r = runIn(p.d, ['set', 'about-us-1a2b', 'blog', '--representative', 'about-us', '--type', 'article']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'state: 2 page(s) set representative=about-us, type=article: about-us-1a2b, blog · written by stardust:direct\n');
  const s = readIn(p.d); const pg = (slug) => s.pages.find((x) => x.slug === slug);
  assert.deepEqual(Object.keys(pg('blog')).slice(0, 6), ['slug', 'url', 'title', 'type', 'representative', 'status']);
  assert.equal(pg('blog').type, 'article'); assert.equal(pg('blog').representative, 'about-us'); assert.ok(!('representative' in pg('about-us')));
  assert.equal(s._provenance.writtenBy, 'stardust:direct');
  const t = runIn(p.d, ['set', 'about-us', '--type', 'article', '--skill', 'prototype']); assert.equal(t.code, 0, t.err);
  assert.equal(t.out, 'state: 1 page(s) set type=article: about-us · written by stardust:prototype\n'); assert.equal(readIn(p.d)._provenance.writtenBy, 'stardust:prototype');
});
check('set --type re-type guard: refuses leaving a template with ≤ 2 pages or making a new one with ≤ 2, unless --owner-decision (recorded on each re-typed page)', () => {
  const slugs = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'h1', 'h2'];
  const p = project(slugs.map((x) => record(x, `https://www.example.com/${x}`)));
  const urls = slugs.map((x) => `https://www.example.com/${x}`).join('\n');
  const types = [...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((x) => `${x}=article`), 'h1=landing', 'h2=landing'].join(',');
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', urls), '--types', types]).code, 0);
  // a brand-new template with one page is refused — every 2-page article becoming its own template was the defect
  const solo = runIn(p.d, ['set', 'a1', '--type', 'article-2']);
  assert.equal(solo.code, 2); assert.equal(solo.out, ''); assert.match(solo.err, /re-type refused:.*new template article-2 would have 1 page/);
  // pulling 4 of 6 articles out leaves article with 2 — refused (guide itself, with 4, is fine)
  const split = runIn(p.d, ['set', 'a1', 'a2', 'a3', 'a4', '--type', 'guide']);
  assert.equal(split.code, 2); assert.match(split.err, /current template article would be left with 2 page/);
  assert.doesNotMatch(split.err, /new template guide/, 'the destination side with 4 pages does not trip');
  // re-typing the whole landing type away (left with 0) is a rename, not a split — allowed
  assert.equal(runIn(p.d, ['set', 'h1', 'h2', '--type', 'article']).code, 0);
  // --owner-decision overrides and is recorded on the re-typed page
  const ok = runIn(p.d, ['set', 'a1', '--type', 'article-2', '--owner-decision', 'a1 is a genuinely distinct composition']);
  assert.equal(ok.code, 0, ok.err);
  const a1 = readIn(p.d).pages.find((x) => x.slug === 'a1');
  assert.equal(a1.type, 'article-2');
  assert.deepEqual({ from: a1.retype.from, to: a1.retype.to, ownerDecision: a1.retype.ownerDecision }, { from: 'article', to: 'article-2', ownerDecision: 'a1 is a genuinely distinct composition' });
  assert.match(a1.retype.at, /^\d{4}-\d\d-\d\dT/);
  // --owner-decision without --type, and an empty one, are usage errors
  assert.match(runIn(p.d, ['set', 'a2', '--representative', 'a1', '--owner-decision', 'x']).err, /--owner-decision records a re-type reason — pass it with --type/);
  assert.match(runIn(p.d, ['set', 'a2', '--type', 'guide', '--owner-decision', '  ']).err, /--owner-decision needs a non-empty sentence/);
});
check('set refuses an unknown slug, an unknown representative, a self-representative, a bad type and a missing value — nothing written', () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', 'https://www.example.com/blog\nhttps://www.example.com/about-us\n')]).code, 0);
  const before = readFileSync(p.stateFile, 'utf8');
  const cases = [
    [['set', 'blog', 'ghost', '--representative', 'about-us'], /unknown slug\(s\): ghost/],
    [['set', 'blog', '--representative', 'ghost'], /unknown representative "ghost"/],
    [['set', 'blog', 'about-us', '--representative', 'about-us'], /about-us cannot be its own representative/],
    [['set', 'blog', '--type', 'Article'], /--type "Article" is not a page type/],
    [['set', 'blog'], /set needs --representative <archetype-slug> and\/or --type <type>/],
    [['set', '--type', 'article'], /set needs at least one <slug>/],
    [['set', 'blog', '--representative', '--type', 'x'], /--representative needs a value/],
    [['set', 'blog', '--type', 'x', '--to', 'directed'], /--to does not apply to set/],
  ];
  for (const [args, re] of cases) { const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.match(r.err, re, args.join(' ')); }
  assert.match(runIn(p.d, ['set', 'about-us', '--representative', 'about-us']).err, /a differing sibling becomes a variant class on its template: node \S+migrate\.mjs render about-us --accept-variance "[^"]+" then node \S+migrate\.mjs variant about-us <variant-class>/, 'a self-representative names the variant path');
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('set refuses a representative cycle (self, two-step, three-step, one of several slugs) in one line naming the chain, nothing written; a chain without a cycle is accepted', () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', ['', 'about-us', 'about/us', 'blog', 'de/produkte'].map((x) => `https://www.example.com/${x}`).join('\n'))]).code, 0);
  assert.equal(runIn(p.d, ['set', 'blog', '--representative', 'about-us']).code, 0);
  const chain = runIn(p.d, ['set', 'about-us', '--representative', 'index']);
  assert.equal(chain.code, 0, chain.err); assert.equal(readIn(p.d).pages.find((x) => x.slug === 'about-us').representative, 'index', 'blog → about-us → index has no cycle');
  const before = readFileSync(p.stateFile, 'utf8');
  for (const [args, ch] of [
    [['set', 'index', '--representative', 'index'], 'index → index'],
    [['set', 'about-us', '--representative', 'blog'], 'about-us → blog → about-us'],
    [['set', 'index', '--representative', 'blog'], 'index → blog → about-us → index'],
    [['set', 'de-produkte', 'index', '--representative', 'blog'], 'index → blog → about-us → index'],
  ]) {
    const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, '');
    assert.equal(r.err.trim().split('\n').length, 1, r.err); assert.ok(r.err.includes(ch), `${args.join(' ')} names ${ch}: ${r.err}`);
  }
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
  const s = readIn(p.d); s.pages.find((x) => x.slug === 'index').representative = 'about-us'; writeFileSync(p.stateFile, JSON.stringify(s, null, 2));
  const loop = runIn(p.d, ['set', 'de-produkte', '--representative', 'blog']);
  assert.equal(loop.code, 0, `a hand-made loop the named pages are not on ends the walk: ${loop.err}`);
});
check('set --clear-representative nulls representative on every named page (key kept after type); with --representative it is a usage error; advance and init refuse it', () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', ['', 'about-us', 'blog'].map((x) => `https://www.example.com/${x}`).join('\n'))]).code, 0);
  assert.equal(runIn(p.d, ['set', 'blog', 'index', '--representative', 'about-us']).code, 0);
  const r = runIn(p.d, ['set', 'blog', 'about-us', '--clear-representative']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'state: 2 page(s) set representative=null: blog, about-us · written by stardust:direct\n');
  const s = readIn(p.d); const pg = (slug) => s.pages.find((x) => x.slug === slug);
  assert.deepEqual(Object.keys(pg('blog')).slice(0, 6), ['slug', 'url', 'title', 'type', 'representative', 'status']); assert.equal(pg('blog').representative, null);
  assert.ok('representative' in pg('about-us') && pg('about-us').representative === null, 'a page that had none gets the key, null');
  assert.equal(pg('index').representative, 'about-us', 'a page not named keeps its link');
  assert.equal(runIn(p.d, ['summary']).out.split('\n')[1], '  representative about-us 1  index');
  const t = runIn(p.d, ['set', 'index', '--clear-representative', '--type', 'landing']);
  assert.equal(t.code, 0, t.err); assert.equal(t.out, 'state: 1 page(s) set representative=null, type=landing: index · written by stardust:direct\n');
  const before = readFileSync(p.stateFile, 'utf8');
  const both = runIn(p.d, ['set', 'blog', '--clear-representative', '--representative', 'about-us']);
  assert.equal(both.code, 2); assert.equal(both.out, ''); assert.match(both.err, /^state: --clear-representative and --representative contradict/);
  const adv = runIn(p.d, ['advance', 'blog', '--to', 'directed', '--clear-representative']); assert.equal(adv.code, 2); assert.match(adv.err, /^state: unknown option --clear-representative$/m);
  const ini = runIn(p.d, ['init', '--pages', 'x', '--clear-representative']); assert.equal(ini.code, 2); assert.match(ini.err, /--clear-representative does not apply to init/);
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('summary prints one representative line per archetype (sorted), with and without --slugs, before the --slugs rows', () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', ['', 'about-us', 'about/us', 'blog', 'de/produkte'].map((x) => `https://www.example.com/${x}`).join('\n'))]).code, 0);
  assert.equal(runIn(p.d, ['summary']).out, '5 page(s) · extracted 5 · directed 0 · prototyped 0 · approved 0 · migrated 0 · stale 0\n', 'no representative, no line');
  assert.equal(runIn(p.d, ['set', 'de-produkte', 'about-us-1a2b', '--representative', 'index']).code, 0);
  assert.equal(runIn(p.d, ['set', 'blog', '--representative', 'about-us']).code, 0);
  const r = runIn(p.d, ['summary']);
  assert.equal(r.out, '5 page(s) · extracted 5 · directed 0 · prototyped 0 · approved 0 · migrated 0 · stale 0\n  representative about-us 1  blog\n  representative index 2  about-us-1a2b, de-produkte\n');
  const sl = runIn(p.d, ['summary', '--slugs']).out.split('\n');
  assert.deepEqual(sl.slice(1, 4), ['  representative about-us 1  blog', '  representative index 2  about-us-1a2b, de-produkte', '  extracted     5  index, about-us, about-us-1a2b, blog, de-produkte']);
});
check('--help lists init and set, from an empty cwd, exit 0', () => {
  const empty = mkdtempSync(join(tmpdir(), 'state-help-'));
  const h = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: empty });
  assert.equal(h.status, 0); assert.match(h.stdout, /node state\.mjs init --pages <file\|->/); assert.match(h.stdout, /node state\.mjs set <slug…> \(--representative <archetype-slug> \| --clear-representative \| --type <type>\)/);
  assert.match(h.stdout, /representative <archetype> <n>/); assert.match(h.stdout, /Exit codes: 0 ok, 2 usage/);
  assert.match(h.stdout, /node state\.mjs exclude <slug…> --reason "<why>" \[--url <url>\]/);
  assert.deepEqual(readdirSync(empty), [], 'nothing written'); rmSync(empty, { recursive: true, force: true });
});

const excludeProject = () => {
  const p = project();
  assert.equal(runIn(p.d, ['init', '--pages', p.list('pages.txt', ['', 'about-us', 'blog'].map((x) => `https://www.example.com/${x}`).join('\n'))]).code, 0);
  return p;
};
check('exclude records { excluded: { reason, at } } on a page in state.json (after status; status untouched), re-stamps provenance (stardust:extract, --skill overrides); the same reason again writes nothing', () => {
  const p = excludeProject();
  const r = runIn(p.d, ['exclude', 'blog', '--reason', 'the source answers 404 since the crawl']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'state: excluded 1 page(s): blog · written by stardust:extract\n');
  const s = readIn(p.d); const blog = s.pages.find((x) => x.slug === 'blog');
  assert.equal(blog.status, 'extracted');
  assert.deepEqual(Object.keys(blog).slice(Object.keys(blog).indexOf('status'), Object.keys(blog).indexOf('status') + 2), ['status', 'excluded']);
  assert.equal(blog.excluded.reason, 'the source answers 404 since the crawl'); assert.match(blog.excluded.at, ISO_UTC);
  assert.equal(s._provenance.writtenBy, 'stardust:extract'); assert.ok(!('excluded' in s.pages.find((x) => x.slug === 'index')));
  const before = readFileSync(p.stateFile, 'utf8');
  const again = runIn(p.d, ['exclude', 'blog', '--reason', 'the source answers 404 since the crawl', '--skill', 'rollout']);
  assert.equal(again.code, 0, again.err); assert.equal(again.out, 'state: exclude unchanged: blog\n'); assert.equal(readFileSync(p.stateFile, 'utf8'), before);
  const other = runIn(p.d, ['exclude', 'blog', '--reason', 'moved off the site by its owner', '--skill', 'rollout']);
  assert.equal(other.code, 0, other.err); assert.equal(readIn(p.d).pages.find((x) => x.slug === 'blog').excluded.reason, 'moved off the site by its owner');
  assert.equal(readIn(p.d)._provenance.writtenBy, 'stardust:rollout');
});
check('exclude --url records a planned page state.json never had in the top-level excluded[] ({ slug, url, reason, at }, by slug); pages[] untouched; idempotent', () => {
  const p = excludeProject();
  const pagesBefore = JSON.stringify(readIn(p.d).pages);
  const r = runIn(p.d, ['exclude', 'gone', '--url', 'https://www.example.com/gone', '--reason', 'the source answered 404 at crawl time']);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'state: excluded 1 page(s): gone (not in pages[]) · written by stardust:extract\n');
  assert.equal(runIn(p.d, ['exclude', 'aaa', '--url', 'https://www.example.com/aaa', '--reason', 'the source answered 404 at crawl time']).code, 0);
  const s = readIn(p.d);
  assert.equal(JSON.stringify(s.pages), pagesBefore);
  assert.deepEqual(s.excluded.map((e) => [e.slug, e.url, e.reason]), [['aaa', 'https://www.example.com/aaa', 'the source answered 404 at crawl time'], ['gone', 'https://www.example.com/gone', 'the source answered 404 at crawl time']]);
  assert.deepEqual(Object.keys(s.excluded[0]), ['slug', 'url', 'reason', 'at']); assert.match(s.excluded[0].at, ISO_UTC);
  assert.equal(Object.keys(s).at(-1), 'excluded', 'after pages');
  const before = readFileSync(p.stateFile, 'utf8');
  assert.equal(runIn(p.d, ['exclude', 'gone', '--url', 'https://www.example.com/gone', '--reason', 'the source answered 404 at crawl time']).out, 'state: exclude unchanged: gone\n');
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('exclude refuses, nothing written: no or empty --reason, no slug, an unknown slug without --url, --url for a page in pages[], --url with two slugs, a --url that is not http(s), a flag it does not read; advance refuses --reason', () => {
  const p = excludeProject();
  const before = readFileSync(p.stateFile, 'utf8');
  for (const [args, re] of [
    [['exclude', 'blog'], /exclude needs --reason "<why>"/],
    [['exclude', 'blog', '--reason', '  '], /exclude needs --reason "<why>"/],
    [['exclude', '--reason', 'x'], /exclude needs at least one <slug>/],
    [['exclude', 'ghost', '--reason', 'x'], /unknown slug\(s\): ghost — .*--url <url>/],
    [['exclude', 'blog', '--url', 'https://www.example.com/blog', '--reason', 'x'], /blog is in pages\[\]: exclude it without --url/],
    [['exclude', 'old-blog', '--url', 'https://example.com/blog/', '--reason', 'x'], /https:\/\/example\.com\/blog\/ is the URL of blog in pages\[\]: exclude blog without --url/],
    [['exclude', 'a', 'b', '--url', 'https://www.example.com/a', '--reason', 'x'], /--url names one page: one <slug>/],
    [['exclude', 'gone', '--url', 'gone', '--reason', 'x'], /--url "gone" is not an absolute http\(s\) URL/],
    [['exclude', 'blog', '--reason', 'x', '--to', 'directed'], /--to does not apply to exclude/],
    [['advance', 'blog', '--to', 'directed', '--reason', 'x'], /unknown option --reason/],
  ]) { const r = runIn(p.d, args); assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.match(r.err, re, args.join(' ')); }
  assert.equal(readFileSync(p.stateFile, 'utf8'), before);
});
check('summary adds the excluded count (pages[] records and the top-level list) only when there is one; --slugs lists them', () => {
  const p = excludeProject();
  assert.equal(runIn(p.d, ['summary']).out, '3 page(s) · extracted 3 · directed 0 · prototyped 0 · approved 0 · migrated 0 · stale 0\n');
  assert.equal(runIn(p.d, ['exclude', 'blog', '--reason', 'r']).code, 0);
  assert.equal(runIn(p.d, ['exclude', 'gone', '--url', 'https://www.example.com/gone', '--reason', 'r']).code, 0);
  assert.equal(runIn(p.d, ['summary']).out, '3 page(s) · extracted 3 · directed 0 · prototyped 0 · approved 0 · migrated 0 · stale 0 · excluded 2\n');
  assert.ok(runIn(p.d, ['summary', '--slugs']).out.includes('  excluded      2  blog, gone\n'));
});

rmSync(initRoot, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nstate: all checks passed');
process.exit(failed ? 1 : 0);
