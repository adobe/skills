#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, delivery state preserved across re-runs, and a row added by `update-coverage.mjs --new`
// (origin marker in source.migratedHtml) kept across a re-run until the migrated tree holds it.
// --state takes a state file's real shape (pages[] of objects with a url; folder URLs with their slash) or
// refuses in one line, writing nothing; it refuses a tree that holds siblings. Stale only when the same
// document's bytes change: identical bytes never; a roster row's hash (another basis) is never compared —
// the row keeps its status and the report names it as not compared.
// Run: node plugins/stardust/skills/rollout/scripts/test/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// --- --state: the state file's real shape or a one-line refusal; the archetypes-only mode refuses a tree with siblings ---
const box = mkdtempSync(join(tmpdir(), 'rollout-inventory-state-'));
const boxMigrated = join(box, 'migrated');
const boxOut = join(box, 'rollout');
const put = (rel, body) => { mkdirSync(dirname(join(box, rel)), { recursive: true }); writeFileSync(join(box, rel), typeof body === 'string' ? body : JSON.stringify(body)); };
const boxPage = (rel, meta, body = rel) => { put(`migrated/${rel}`, `<html><body><main>${body}</main></body></html>`); put(join('migrated', dirname(rel), sidecarName(rel.split('/').pop())), meta); };
const runBox = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', boxMigrated, '--out', boxOut, ...args], { encoding: 'utf8' });
const boxRows = () => Object.fromEntries(JSON.parse(readFileSync(join(boxOut, 'coverage', 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p]));
const deliver = (...slugs) => { const f = join(boxOut, 'coverage', 'pages.json'); const doc = JSON.parse(readFileSync(f, 'utf8')); for (const p of doc.pages) if (slugs.includes(p.slug)) p.delivery = { ...p.delivery, status: 'deployed', deployedUrl: `https://x.test${p.path}` }; writeFileSync(f, JSON.stringify(doc)); };
boxPage('index.html', { slug: 'home', type: 'home', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: ['hero'] });
boxPage('tours/bali/index.html', { slug: 'tours-bali', type: 'program', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: ['gallery'] });
const ROSTER = { pages: [
  { slug: 'home', url: 'https://example.com/', type: 'home' },
  { slug: 'tours-bali', url: 'https://example.com/tours/bali/', type: 'tours-bali' },
  { slug: 'tours-utah', url: 'https://example.com/tours/utah/', type: 'tours-bali' },
] };
put('state.json', ROSTER);

check('--state with a file that is not a state file (pages[] of objects with a url) → exit 2, one line, nothing written', () => {
  const bad = { 'missing.json': null, 'not-json.json': '{"pages": [', 'top-array.json': ROSTER.pages, 'pages-map.json': { pages: { home: ROSTER.pages[0] } },
    'no-url.json': { pages: [{ slug: 'home', type: 'home' }] }, 'string-entry.json': { pages: ['https://example.com/'] }, 'null-entry.json': { pages: [ROSTER.pages[0], null] } };
  for (const [name, body] of Object.entries(bad)) {
    if (body !== null) put(name, body);
    const file = join(box, name);
    const r = runBox('--state', file);
    assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, `rollout inventory: ${file} is not a state file (pages[] of {slug, url, type}) — nothing written\n`, name);
    assert.equal(r.stdout, '', name);
    assert.ok(!existsSync(boxOut), `${name}: nothing written`);
  }
});

check('--state over a tree that holds siblings (fidelityTier sibling, or a template naming another slug) → exit 2, one line, nothing written', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', migrated, '--out', boxOut, '--state', join(box, 'state.json')], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr, `rollout inventory: --state is the archetypes-only mode, but ${migrated} holds 2 sibling page(s) (tours-alps, tours-utah) — re-run without --state\n`);
  assert.ok(!existsSync(boxOut), 'nothing written');
  const many = join(box, 'many');
  const manyPage = (rel, meta) => { mkdirSync(dirname(join(many, rel)), { recursive: true }); writeFileSync(join(many, rel), `<main>${rel}</main>`); writeFileSync(join(many, dirname(rel), sidecarName(rel.split('/').pop())), JSON.stringify(meta)); };
  manyPage('a.html', { slug: 'a', fidelityTier: 'archetype', template: null });
  manyPage('f.html', { slug: 'f', fidelityTier: 'archetype', template: 'f' });
  manyPage('e.html', { slug: 'e', template: 'a' });
  manyPage('d.html', { slug: 'd', template: 'a' });
  manyPage('c.html', { slug: 'c', fidelityTier: 'sibling' });
  manyPage('b.html', { slug: 'b', template: 'a' });
  const m = spawnSync(process.execPath, [SCRIPT, '--migrated', many, '--out', boxOut, '--state', join(box, 'state.json')], { encoding: 'utf8' });
  assert.equal(m.status, 2, m.stdout + m.stderr);
  assert.equal(m.stderr, `rollout inventory: --state is the archetypes-only mode, but ${many} holds 4 sibling page(s) (b, c, d…) — re-run without --state\n`);
  assert.ok(!existsSync(boxOut), 'nothing written');
});

const seeded = runBox('--state', join(box, 'state.json'));
check('--state over an archetypes-only tree seeds the roster page content-pending under the archetype its type names', () => {
  assert.equal(seeded.status, 0, seeded.stderr);
  const rows = boxRows();
  assert.deepEqual(Object.keys(rows).sort(), ['home', 'tours-bali', 'tours-utah']);
  assert.equal(rows['tours-utah'].delivery.status, 'content-pending'); assert.equal(rows['tours-utah'].templateId, 'tours-bali');
  assert.equal(rows['tours-utah'].source.migratedHtml, null); assert.deepEqual(rows['tours-utah'].blocks, ['gallery']);
});

check('a delivered page re-inventoried with identical bytes is not stale', () => {
  deliver('home', 'tours-utah');
  const r = runBox('--state', join(box, 'state.json'));
  assert.equal(r.status, 0, r.stderr);
  const rows = boxRows();
  assert.equal(rows.home.delivery.status, 'deployed'); assert.equal(rows['tours-utah'].delivery.status, 'deployed');
  assert.match(r.stdout, /0 stale$/m, r.stdout);
  assert.doesNotMatch(r.stdout, /hash basis changed/, 'nothing skipped, nothing reported');
});

check('a delivered roster row, then migrated (its hash now of the migrated file — another basis), keeps its status, takes the new hash and is reported as not compared', () => {
  const rosterHash = boxRows()['tours-utah'].source.sourceHash;
  boxPage('tours/utah/index.html', { slug: 'tours-utah', type: 'program', fidelityTier: 'sibling', template: 'tours-bali', modules: ['gallery'] });
  const before = readFileSync(join(boxOut, 'coverage', 'pages.json'), 'utf8');
  const refused = runBox('--state', join(box, 'state.json'));
  assert.equal(refused.status, 2, refused.stdout);
  assert.equal(refused.stderr, `rollout inventory: --state is the archetypes-only mode, but ${boxMigrated} holds 1 sibling page(s) (tours-utah) — re-run without --state\n`);
  assert.equal(readFileSync(join(boxOut, 'coverage', 'pages.json'), 'utf8'), before, 'nothing written');
  const r = runBox();
  assert.equal(r.status, 0, r.stderr);
  const utah = boxRows()['tours-utah'];
  assert.equal(utah.delivery.status, 'deployed');
  assert.equal(utah.source.migratedHtml, join(boxMigrated, 'tours/utah/index.html'));
  assert.notEqual(utah.source.sourceHash, rosterHash);
  assert.equal(utah.templateId, 'tours-bali');
  assert.match(r.stdout, /^Kept {8}1 delivered row\(s\) whose hash basis changed \(roster → document\), not compared: tours-utah$/m, r.stdout);
});

check('changed bytes of the same delivered document → stale; the unchanged one stays delivered', () => {
  const again = runBox();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(boxRows()['tours-utah'].delivery.status, 'deployed', 'the migrated row re-read with identical bytes');
  assert.doesNotMatch(again.stdout, /^Kept /m, 'the migrated row is compared now — nothing reported');
  boxPage('index.html', { slug: 'home', type: 'home', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: ['hero'] }, 'home, edited');
  const r = runBox();
  assert.equal(r.status, 0, r.stderr);
  const rows = boxRows();
  assert.equal(rows.home.delivery.status, 'stale'); assert.equal(rows['tours-utah'].delivery.status, 'deployed');
  assert.match(r.stdout, /1 stale$/m, r.stdout);
});

rmSync(box, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
