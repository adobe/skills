#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, delivery state preserved across re-runs, and a row added by `update-coverage.mjs --new`
// (origin marker in source.migratedHtml) kept across a re-run until the migrated tree holds it.
// Run: node plugins/stardust/skills/rollout/scripts/test/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
