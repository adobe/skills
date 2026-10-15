#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, delivery state preserved across re-runs, and a row added by `update-coverage.mjs --new`
// (origin marker in source.migratedHtml) kept across a re-run until the migrated tree holds it.
// Encoded pages (migrate's encoder: a sidecar with `encode`, the document under stardust/encoded/):
// listed once from the sidecar, sourceHash over the encoded document (a re-encode with new bytes
// marks a delivered page stale), publicUrl from the encoded path; the archetype and clone pages
// keep their migrated-HTML rows.
// Run: node plugins/stardust/skills/rollout/scripts/test/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicUrl } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'inventory.mjs');
const root = mkdtempSync(join(tmpdir(), 'rollout-inventory-test-'));
const migrated = join(root, 'migrated');
const out = join(root, 'rollout');
const sidecarName = (leaf) => (leaf === 'index.html' ? '_meta.json' : `${leaf.replace(/\.html$/, '')}._meta.json`);
const page = (rel, meta) => {
  const dir = join(migrated, dirname(rel));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(migrated, rel), `<html><body><main>${rel}</main></body></html>`);
  writeFileSync(join(dir, sidecarName(rel.split('/').pop())), JSON.stringify(meta));
};
const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', migrated, '--out', out, ...args], { encoding: 'utf8' });
const json = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// Two archetypes whose sidecars leave `template` null (the migrate spec's form), two siblings naming
// the second one, and a unique page carrying only its type. No sidecar has modules yet.
page('index.html', { slug: 'home', type: 'home', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: [] });
page('tours/bali/index.html', { slug: 'tours-bali', type: 'program', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: [] });
page('tours/utah/index.html', { slug: 'tours-utah', type: 'program', fidelityTier: 'sibling', archetypeSource: 'tours-bali', template: 'tours-bali', modules: [] });
page('tours/alps.html', { slug: 'tours-alps', type: 'program', fidelityTier: 'sibling', archetypeSource: 'tours-bali', template: 'tours-bali', modules: [] });
page('faq/index.html', { slug: 'faq', type: 'unique', renderBranch: 'B', template: null, modules: [] });

check('--help prints the usage header (with the grouping rule) and writes nothing', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Template grouping/); assert.match(r.stdout, /--site-url/);
  assert.deepEqual(readdirSync(root).sort(), ['migrated']);
});

const first = run('--site-url', 'https://example.test');
check('an archetype with template null groups under its own slug, together with its siblings; type is the last resort', () => {
  assert.equal(first.status, 0, first.stderr);
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(t).sort(), ['home', 'tours-bali', 'unique'], Object.keys(t).join(','));
  assert.equal(t['tours-bali'].pageCount, 3); assert.deepEqual(t['tours-bali'].pages, ['tours-alps', 'tours-bali', 'tours-utah']);
  assert.equal(t.home.pageCount, 1); assert.equal(t.unique.pages[0], 'faq');
  assert.match(first.stdout, /Templates {3}3 \(home:1, tours-bali:3, unique:1\)/);
});
check('the representative of a template is its archetype, not the first slug', () => {
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.equal(t['tours-bali'].representativeSlug, 'tours-bali');
  assert.equal(t.home.representativeSlug, 'home');
});
check('sidecars with an empty modules[] are counted in the report, naming Phase B', () => {
  assert.match(first.stdout, /^Blocks {6}modules\[\] empty on 5\/5 sidecars — Phase B \(blocks\.mjs\) dedups from them/m, first.stdout);
});

// Fill the tours pages' modules and mark one page deployed, then re-run: the count drops, the
// template's block set fills from its pages, and delivery state survives the re-run.
for (const [rel, slug] of [['tours/bali/_meta.json', 'tours-bali'], ['tours/utah/_meta.json', 'tours-utah'], ['tours/alps._meta.json', 'tours-alps']]) {
  const p = join(migrated, rel); const m = JSON.parse(readFileSync(p, 'utf8')); m.modules = ['hero', slug === 'tours-bali' ? 'gallery' : 'cards']; writeFileSync(p, JSON.stringify(m));
}
{ const pj = join(out, 'coverage', 'pages.json'); const pages = json('coverage/pages.json'); const utah = pages.pages.find((p) => p.slug === 'tours-utah'); utah.delivery = { ...utah.delivery, status: 'deployed', deployedUrl: 'https://x.test/tours/utah', deployedAt: 'now' }; writeFileSync(pj, JSON.stringify(pages)); }
const second = run();
check('a re-run keeps delivery state, drops the empty-modules count and fills the template block set', () => {
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /modules\[\] empty on 2\/5 sidecars/, second.stdout);
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(t['tours-bali'].blocks, ['cards', 'gallery', 'hero']); assert.equal(t['tours-bali'].delivery.deployed, 1);
  const utah = json('coverage/pages.json').pages.find((p) => p.slug === 'tours-utah'); assert.equal(utah.delivery.status, 'deployed');
  assert.equal(json('rollout.json').site.sourceUrl, 'https://example.test', 'site config survives a re-run without --site-url');
});

// A page built outside the migrated tree, registered with `update-coverage.mjs --new`, survives the
// next inventory run with its status untouched — registered once, never re-registered after every
// inventory — and gives way once the migrated tree holds a file for its slug.
const UPDATE = join(HERE, '..', 'update-coverage.mjs');
const reg = spawnSync(process.execPath, [UPDATE, '--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics', '--title', 'Search', '--status', 'deployed', '--out', out], { encoding: 'utf8' });
const third = run();
check('a --new row (origin marker in source.migratedHtml) is kept across a re-run — status untouched, in its template row and the counts, named on the report', () => {
  assert.equal(reg.status, 0, reg.stderr);
  assert.equal(third.status, 0, third.stderr);
  const row = json('coverage/pages.json').pages.find((p) => p.slug === 'search');
  assert.ok(row, 'the row survived the re-run');
  assert.equal(row.source.migratedHtml, 'dynamics:search'); assert.equal(row.delivery.status, 'deployed'); assert.equal(row.path, '/search'); assert.equal(row.templateId, 'search'); assert.equal(row.title, 'Search');
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(t.search.pages, ['search']); assert.equal(t.search.delivery.deployed, 1);
  assert.equal(json('rollout.json').lastRun.pages.total, 6); assert.equal(json('rollout.json').lastRun.pages.deployed, 2);
  assert.match(third.stdout, /^Pages {7}6 total/m, third.stdout);
  assert.match(third.stdout, /^Kept {8}1 row\(s\) built outside the migrated tree \(update-coverage\.mjs --new\), status untouched: search$/m, third.stdout);
  assert.equal(json('coverage/pages.json').pages.filter((p) => p.path === '/search').length, 1, 'one row per path');
});
page('search/index.html', { slug: 'search', type: 'search', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: ['search-results'] });
const fourth = run();
check('once the migrated tree holds the slug, the migrated row replaces the marker row (delivery state carried by slug, re-flagged stale for the new HTML); nothing is kept', () => {
  assert.equal(fourth.status, 0, fourth.stderr);
  const rows = json('coverage/pages.json').pages.filter((p) => p.slug === 'search');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.migratedHtml, join(migrated, 'search/index.html')); assert.deepEqual(rows[0].blocks, ['search-results']);
  assert.equal(rows[0].delivery.status, 'stale', 'a deployed page whose HTML changed is re-flagged stale');
  assert.doesNotMatch(fourth.stdout, /^Kept /m, fourth.stdout);
  assert.equal(json('rollout.json').lastRun.pages.total, 6);
});

check('sourceUrl: the sidecar\'s source URL, else state.json\'s by slug, else null', () => {
  page('about.html', { slug: 'about', type: 'unique', source: { url: 'https://example.com/about-us' }, modules: [] });
  mkdirSync(join(root, 'stardust'), { recursive: true }); // run from a project root: stardust/state.json is read by default
  writeFileSync(join(root, 'stardust', 'state.json'), JSON.stringify({ pages: [{ slug: 'tours-bali', url: 'https://example.com/tours/bali.html' }] }));
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', migrated, '--out', out], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const bySlug = Object.fromEntries(json('coverage/pages.json').pages.map((p) => [p.slug, p.source.sourceUrl]));
  assert.equal(bySlug.about, 'https://example.com/about-us'); assert.equal(bySlug['tours-bali'], 'https://example.com/tours/bali.html'); assert.equal(bySlug.faq, null);
});

// ---- encoded pages: a project (stardust/migrated beside stardust/encoded) ------------------------------
// The archetype (its migrated HTML is what deploy converts; the encoder also placed it), siblings the
// encoder placed with no clone (a leaf, a folder index), a sibling with a leftover clone, a clone sibling,
// a sidecar with neither HTML nor encode, and an encode record whose document is gone.
const proj = join(root, 'proj');
const PM = join(proj, 'stardust', 'migrated');
const POUT = join(proj, 'stardust', 'rollout');
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const hash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const sib = (slug) => ({ slug, type: 'tour', renderBranch: "A'", template: 'tours', archetypeSource: 'tours', fidelityTier: 'sibling', modules: [] });
const encoded = (sidecarRel, doc, meta, body) => {
  const output = { path: `stardust/encoded/${doc}`, sha: body === null ? 'sha256:gone' : hash(body) };
  put(join(PM, sidecarRel), JSON.stringify({ ...meta, encode: { map: { template: 'tours' }, output }, audit: { encode: { status: 'clean' } } }));
  if (body !== null) put(join(proj, output.path), body);
};
const DOC = { arch: '<html><main>tours, rendered</main></html>', north: '<main>north v1</main>', south: '<main>south</main>', eastClone: '<html><main>east clone</main></html>', east: '<main>east</main>', west: '<html><main>west clone</main></html>' };
put(join(PM, 'tours/index.html'), DOC.arch);
encoded('tours/_meta.json', 'tours/index.html', { slug: 'tours', type: 'tour', renderBranch: 'A', template: null, fidelityTier: 'archetype', modules: ['hero'] }, '<main>tours</main>');
encoded('tours/north/_meta.json', 'tours/north.html', sib('tours-north'), DOC.north);
encoded('tours/south/_meta.json', 'tours/south/index.html', sib('tours-south'), DOC.south);
put(join(PM, 'tours/east/index.html'), DOC.eastClone);
encoded('tours/east/_meta.json', 'tours/east.html', sib('tours-east'), DOC.east);
put(join(PM, 'tours/west/index.html'), DOC.west);
put(join(PM, 'tours/west/_meta.json'), JSON.stringify(sib('tours-west')));
put(join(PM, 'about/_meta.json'), JSON.stringify({ slug: 'about', type: 'unique', modules: [] }));
encoded('tours/gone/_meta.json', 'tours/gone.html', sib('tours-gone'), null);
const runP = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', POUT, ...args], { encoding: 'utf8' });
const pjson = (p, o = POUT) => JSON.parse(readFileSync(join(o, p), 'utf8'));
const rowsOf = (o) => Object.fromEntries(pjson('coverage/pages.json', o).pages.map((p) => [p.slug, p]));

const e1 = runP();
check('an encoded page is listed once, from its sidecar: path and sourceHash from the encoded document, no clone', () => {
  assert.equal(e1.status, 0, e1.stderr);
  const pages = pjson('coverage/pages.json').pages;
  assert.deepEqual(pages.map((p) => p.slug), ['tours', 'tours-east', 'tours-gone', 'tours-north', 'tours-south', 'tours-west'], 'one row per page; a sidecar with neither HTML nor encode is not a page');
  const r = rowsOf(POUT);
  assert.deepEqual(r['tours-north'].source, { migratedHtml: null, encodedHtml: join(proj, 'stardust/encoded/tours/north.html'), metaJson: join(PM, 'tours/north/_meta.json'), sourceHash: hash(DOC.north), sourceUrl: null });
  assert.equal(r['tours-north'].path, '/tours/north'); assert.equal(r['tours-north'].templateId, 'tours'); assert.equal(r['tours-north'].delivery.status, 'pending');
  assert.equal(r['tours-south'].path, '/tours/south'); assert.equal(r['tours-south'].source.sourceHash, hash(DOC.south));
  const t = pjson('coverage/templates.json').templates.find((x) => x.id === 'tours');
  assert.equal(t.pageCount, 6); assert.equal(t.representativeSlug, 'tours');
});
check('the archetype and a clone sibling keep their migrated-HTML rows; a sibling the encoder placed over a leftover clone is listed once, as encoded', () => {
  const r = rowsOf(POUT);
  assert.deepEqual(r.tours.source, { migratedHtml: join(PM, 'tours/index.html'), metaJson: join(PM, 'tours/_meta.json'), sourceHash: hash(DOC.arch), sourceUrl: null }, 'deploy converts the archetype from its migrated HTML; it is never staged from the encoder');
  assert.deepEqual(r['tours-west'].source, { migratedHtml: join(PM, 'tours/west/index.html'), metaJson: join(PM, 'tours/west/_meta.json'), sourceHash: hash(DOC.west), sourceUrl: null });
  assert.equal(r['tours-east'].source.migratedHtml, null); assert.equal(r['tours-east'].source.encodedHtml, join(proj, 'stardust/encoded/tours/east.html'));
  assert.equal(r['tours-east'].source.sourceHash, hash(DOC.east), 'the encoded document, not the clone'); assert.equal(r['tours-east'].path, '/tours/east');
});
check('publicUrl: the encoded path decides the trailing slash (a leaf stays bare though its sidecar sits in a folder); clone rows as before', () => {
  const r = rowsOf(POUT);
  assert.equal(publicUrl(r['tours-north']), '/tours/north'); assert.equal(publicUrl(r['tours-east']), '/tours/east');
  assert.equal(publicUrl(r['tours-south']), '/tours/south/');
  assert.equal(publicUrl(r.tours), '/tours/'); assert.equal(publicUrl(r['tours-west']), '/tours/west/');
});
check('an encode record whose document is gone: the row stays (sourceHash null) and the report names it', () => {
  const r = rowsOf(POUT);
  assert.equal(r['tours-gone'].source.sourceHash, null); assert.equal(r['tours-gone'].path, '/tours/gone');
  assert.match(e1.stdout, /^Missing {5}1 encoded document\(s\) named by a sidecar — re-run the encoder: tours-gone \(stardust\/encoded\/tours\/gone\.html\)$/m, e1.stdout);
});
{
  const pj = join(POUT, 'coverage', 'pages.json'); const doc = pjson('coverage/pages.json');
  for (const p of doc.pages) if (['tours-north', 'tours-south', 'tours-east', 'tours-gone'].includes(p.slug)) p.delivery = { ...p.delivery, status: 'deployed', deployedAt: 'now' };
  writeFileSync(pj, JSON.stringify(doc));
  put(join(proj, 'stardust/encoded/tours/north.html'), '<main>north v2</main>');
}
const e2 = runP();
check('a re-encode with new bytes marks a delivered page stale; unchanged documents (and a missing one) stay put', () => {
  assert.equal(e2.status, 0, e2.stderr);
  const r = rowsOf(POUT);
  assert.equal(r['tours-north'].delivery.status, 'stale'); assert.equal(r['tours-north'].source.sourceHash, hash('<main>north v2</main>'));
  for (const s of ['tours-south', 'tours-east', 'tours-gone']) assert.equal(r[s].delivery.status, 'deployed', s);
});
check('run from the project root with the defaults: encodedHtml is project-relative like migratedHtml', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  const rows = rowsOf(POUT);
  assert.equal(rows['tours-north'].source.encodedHtml, 'stardust/encoded/tours/north.html'); assert.equal(rows.tours.source.migratedHtml, 'stardust/migrated/tours/index.html');
});
check('--state (archetypes-only): an encoded sibling keeps its template and its roster entry is not listed again; other roster pages join as content-pending', () => {
  const state = join(proj, 'stardust', 'state.json'); const out2 = join(proj, 'rollout-state');
  put(state, JSON.stringify({ pages: [{ slug: 'tours', url: 'https://example.com/tours/', type: 'tour' }, { slug: 'tours-north', url: 'https://example.com/Tours/North', type: 'tours' }, { slug: 'tours-extra', url: 'https://example.com/tours/extra', representative: 'tours' }] }));
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', out2, '--state', state], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pages = pjson('coverage/pages.json', out2).pages; const rows = rowsOf(out2);
  assert.equal(pages.filter((p) => /north/i.test(p.slug)).length, 1, pages.map((p) => p.slug).join(','));
  assert.equal(rows['tours-north'].templateId, 'tours'); assert.equal(rows['tours-north'].source.encodedHtml, join(proj, 'stardust/encoded/tours/north.html'));
  assert.equal(rows['tours-extra'].templateId, 'tours'); assert.equal(rows['tours-extra'].delivery.status, 'content-pending');
  assert.equal(rows.tours.templateId, 'tours');
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
