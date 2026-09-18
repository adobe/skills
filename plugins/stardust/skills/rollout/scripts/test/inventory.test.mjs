#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, and delivery state preserved across re-runs.
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

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
