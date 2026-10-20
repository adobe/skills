#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, delivery state preserved across re-runs, a row added by `update-coverage.mjs --new`
// (origin marker in source.migratedHtml) kept across a re-run until the migrated tree holds it, a sidecar's
// widgets[] through inventory → blocks.mjs (kind widget, code path, no document rows) → plan.mjs, and inherited
// by content-pending siblings in archetypes-only mode, a
// sidecar's `variance` object copied verbatim to the row's source.variance (absent otherwise), and
// the opt-in `exports` key in rollout.json (carried across re-runs; `--export <name>` adds a name
// once; an unknown name exits 2 before any write), and coverage 0.1.0: each row's `delivered` structure
// parsed from its content file (records in document order, sections, variantId carry-forward,
// contentHash; null without a content file; the file found by the row's path exactly, else by its delivered-path
// fold — the deploy lower-cases — never looser; both cases present: the exact one is read and the pair recorded in
// pages.json caseCollisions[]), the templates' type/representativeUrl/urls and judged
// name/description, `formatVersion`, schema validity, byte-identical re-runs and no project identity.
// Encoded pages (migrate's encoder: a sidecar with `encode`, the document under stardust/encoded/):
// listed once from the sidecar, sourceHash over the encoded document (a re-encode with new bytes
// marks a delivered page stale; a stopped, hand-edited or missing one keeps its last clean hash),
// publicUrl from the encoded path (a clone row: its path, else its deployedUrl); the archetype and clone pages keep
// their migrated-HTML rows — so does a stopped sibling beside its clone HTML (the A′ exception).
// --state: a roster row (no document) carries its status when its encode appears — content-pending
// advances to pending, a status update-coverage recorded stays (named as not compared); the coverage lock is taken;
// a clone sibling in the tree refuses --state, an encoded one does not.
// --state takes a state file's real shape (pages[] of objects with a url; folder URLs with their slash) or
// refuses in one line, writing nothing; it refuses a tree that holds siblings. Stale only when the same
// document's bytes change: identical bytes never; a roster row's hash (another basis) is never compared —
// the row keeps its status and the report names it as not compared.
// Exclusions (state.mjs exclude): a page's excluded record or the state's top-level excluded[] moves it out of
// pages[] and the templates into pages.json excluded[] (the key only when there is one), --state roster included.
// _provenance.stardustVersion: the plugin manifest, else STARDUST_VERSION (a copied scripts tree), else 0.0.0.
// Run: node plugins/stardust/skills/rollout/scripts/test/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_PATTERNS, contentFileFor, contentFileMatch, findIdentity, foldDeliveredPath, identityTokens, publicUrl } from '../lib.mjs';
import { loadSchema, unsupported, validate } from './schema-validate.mjs';

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
// cwd = the scratch root, so the default `stardust/state.json` and `--content content` never resolve inside the repo
const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', migrated, '--out', out, ...args], { encoding: 'utf8', cwd: root });
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
check('--help names the --export opt-in and still wins over a bad --export value, writing nothing', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--export', 'nope', '--help'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /\[--export <name>\]/); assert.match(r.stdout, /--export migration-workspace opts/);
  assert.deepEqual(readdirSync(root).sort(), ['migrated']);
});

check('_provenance.stardustVersion: the plugin manifest, else STARDUST_VERSION (a copied scripts tree with no manifest above it), else 0.0.0', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const base = { ...process.env }; delete base.STARDUST_VERSION;
  const tmp = mkdtempSync(join(tmpdir(), 'rollout-inventory-version-'));
  // the scripts dir copied three levels below an empty root (no plugin manifest above it), relative imports intact
  const copy = join(tmp, 'skills', 'rollout', 'scripts');
  cpSync(join(HERE, '..'), copy, { recursive: true, filter: (src) => basename(src) !== 'test' });
  const inv = (script, env, out) => {
    const r = spawnSync(process.execPath, [script, '--migrated', migrated, '--out', join(tmp, out)], { encoding: 'utf8', cwd: tmp, env });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(readFileSync(join(tmp, out, 'rollout.json'), 'utf8'))._provenance.stardustVersion;
  };
  assert.equal(inv(SCRIPT, { ...base, STARDUST_VERSION: '9.9.9' }, 'real'), manifest, 'the plugin manifest wins over the env');
  assert.equal(inv(join(copy, 'inventory.mjs'), { ...base, STARDUST_VERSION: ' 1.2.3-test ' }, 'env'), '1.2.3-test', 'no manifest: the env, trimmed');
  assert.equal(inv(join(copy, 'inventory.mjs'), { ...base, STARDUST_VERSION: '  ' }, 'blank'), '0.0.0', 'a blank env is unset');
  assert.equal(inv(join(copy, 'inventory.mjs'), base, 'none'), '0.0.0', 'neither: the honest unknown');
  rmSync(tmp, { recursive: true, force: true });
});

const first = run('--site-url', 'https://example.test');
check('an archetype with template null groups under its own slug, together with its siblings; type is the last resort', () => {
  assert.equal(first.status, 0, first.stderr);
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(t).sort(), ['home', 'tours-bali', 'unique'], Object.keys(t).join(','));
  assert.equal(t['tours-bali'].pageCount, 3); assert.deepEqual(t['tours-bali'].pages, ['tours-alps', 'tours-bali', 'tours-utah']);
  assert.equal(t.home.pageCount, 1); assert.equal(t.unique.pages[0], 'faq');
  assert.match(first.stdout, /Templates {3}3 \(home:1, tours-bali:3, unique:1\)/);
  assert.deepEqual(json('rollout.json').lastRun.blocks, { total: 0, converted: 0, notDelivered: 0, pending: 0 }, 'the block roll-up has blockCounts\' shape before blocks.mjs runs');
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
  const p = join(migrated, rel); const m = JSON.parse(readFileSync(p, 'utf8')); m.modules = ['hero', slug === 'tours-bali' ? 'gallery' : 'cards'];
  if (slug === 'tours-bali') m.widgets = [{ id: 'tour-finder', href: '/widgets/tours/tour-finder.html?region=all' }];
  writeFileSync(p, JSON.stringify(m));
}
{ const pj = join(out, 'coverage', 'pages.json'); const pages = json('coverage/pages.json'); const utah = pages.pages.find((p) => p.slug === 'tours-utah'); utah.delivery = { ...utah.delivery, status: 'deployed', deployedUrl: 'https://x.test/tours/utah', deployedAt: 'now' }; writeFileSync(pj, JSON.stringify(pages)); }
const second = run();
check('a re-run keeps delivery state, drops the empty-modules count and fills the template block set', () => {
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /modules\[\] empty on 2\/5 sidecars/, second.stdout);
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(t['tours-bali'].blocks, ['cards', 'gallery', 'hero', 'tour-finder']); assert.equal(t['tours-bali'].delivery.deployed, 1);
  const utah = json('coverage/pages.json').pages.find((p) => p.slug === 'tours-utah'); assert.equal(utah.delivery.status, 'deployed');
  assert.equal(json('rollout.json').site.sourceUrl, 'https://example.test', 'site config survives a re-run without --site-url');
});
check('a sidecar widget rides along as the page row\'s widgets[] and joins the template block set under its id', () => {
  const bali = json('coverage/pages.json').pages.find((p) => p.slug === 'tours-bali');
  assert.deepEqual(bali.widgets, [{ id: 'tour-finder', href: '/widgets/tours/tour-finder.html?region=all' }]); assert.deepEqual(bali.blocks, ['hero', 'gallery'], 'modules[] unchanged');
  assert.deepEqual(json('coverage/pages.json').pages.find((p) => p.slug === 'tours-utah').widgets, [], 'a migrated sibling carries only its own sidecar\'s widgets');
  const t = Object.fromEntries(json('coverage/templates.json').templates.map((x) => [x.id, x]));
  assert.deepEqual(t['tours-bali'].blocks, ['cards', 'gallery', 'hero', 'tour-finder']);
  assert.match(second.stdout, /^Widgets {5}1 distinct \(tour-finder\) on 1 pages — code only, one \/widgets\/ link per page$/m, second.stdout);
});
check('blocks.mjs: a widget is a ledger row of kind widget — edsBlockName = its id, blockPath = its code under widgets/, no fragment; plan.mjs converts it once', () => {
  const b = spawnSync(process.execPath, [join(HERE, '..', 'blocks.mjs'), '--out', out], { encoding: 'utf8' }); assert.equal(b.status, 0, b.stderr);
  const row = json('coverage/blocks.json').blocks.find((x) => x.id === 'tour-finder');
  assert.equal(row.kind, 'widget'); assert.equal(row.signature, 'widget:tour-finder'); assert.deepEqual(row.usedByPages, ['tours-bali']); assert.equal(row.instanceCount, 1);
  assert.deepEqual(row.delivery, { status: 'pending', edsBlockName: 'tour-finder', blockPath: 'widgets/tours/tour-finder.html', convertedAt: null });
  assert.equal(json('coverage/blocks.json').blocks.find((x) => x.id === 'hero').kind, 'module');
  assert.match(b.stdout, /Distinct blocks {2}4 {2}\(3 module · 0 chrome\/fragment · 1 widget\)/, b.stdout); assert.match(b.stdout, /^Widgets {10}tour-finder → widgets\/tours\/tour-finder\.html \(code only; no document rows\)$/m, b.stdout);
  const pl = spawnSync(process.execPath, [join(HERE, '..', 'plan.mjs'), '--out', out], { encoding: 'utf8' }); assert.equal(pl.status, 0, pl.stderr);
  const step = json('plan.json').steps.find((s) => s.slug === 'tours-bali');
  assert.deepEqual(step.convert.find((c) => c.id === 'tour-finder'), { id: 'tour-finder', edsBlockName: 'tour-finder', kind: 'widget' });
  assert.ok(!json('plan.json').fragments.some((f) => f.id === 'tour-finder'), 'a widget is not a fragment');
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

check('a sidecar\'s variance object lands verbatim in the row\'s source.variance (an acceptance and its date included); variance null or absent → no key', () => {
  const vRoot = join(root, 'variance'); const vMigrated = join(vRoot, 'migrated'); const vOut = join(vRoot, 'rollout');
  const differs = { verdict: 'differs', file: 'stardust/rollout/variance/tours-bali.json', at: '2026-01-02T03:04:05Z', missing: ['card'], extra: [], deltas: 2, accepted: 'the card row is a page-level promo', acceptedAt: '2026-01-03T00:00:00Z' };
  const skipped = { status: 'skipped', reason: 'no live archetype URL' };
  const sidecars = { 'utah.html': { slug: 'tours-utah', template: 'tours-bali', variance: differs }, 'alps.html': { slug: 'tours-alps', template: 'tours-bali', variance: skipped }, 'bali.html': { slug: 'tours-bali', renderBranch: 'A', template: null, variance: null }, 'faq.html': { slug: 'faq', renderBranch: 'B' } };
  mkdirSync(vMigrated, { recursive: true });
  for (const [leaf, meta] of Object.entries(sidecars)) { writeFileSync(join(vMigrated, leaf), `<html><body><main>${leaf}</main></body></html>`); writeFileSync(join(vMigrated, sidecarName(leaf)), JSON.stringify({ ...meta, modules: [] })); }
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', vMigrated, '--out', vOut], { encoding: 'utf8', cwd: vRoot });
  assert.equal(r.status, 0, r.stderr);
  const rows = Object.fromEntries(JSON.parse(readFileSync(join(vOut, 'coverage', 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p.source]));
  assert.deepEqual(rows['tours-utah'].variance, differs); assert.deepEqual(rows['tours-alps'].variance, skipped);
  assert.deepEqual([rows['tours-utah'].variance.accepted, rows['tours-utah'].variance.acceptedAt], ['the card row is a page-level promo', '2026-01-03T00:00:00Z'], 'an accepted variance reaches coverage, so a re-render can honour it');
  assert.equal('variance' in rows['tours-bali'], false, 'variance null → no key'); assert.equal('variance' in rows.faq, false, 'no variance → no key');
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), JSON.parse(readFileSync(join(vOut, 'coverage', 'pages.json'), 'utf8'))), [], 'rows carrying source.variance validate');
});

// The opt-in `exports` key: inventory rebuilds rollout.json from named fields on every run, so the key
// must be carried forward explicitly — it is always written (empty when nothing is opted in).
const configPath = join(out, 'rollout.json');
const seedConfig = (patch) => writeFileSync(configPath, JSON.stringify({ ...json('rollout.json'), ...patch }));
check('rollout.json always carries exports, empty when nothing is opted in, between site and lastRun; it validates against rollout-config.schema.json (lastRun.pages.contentPending declared)', () => {
  assert.deepEqual(json('rollout.json').exports, []);
  assert.deepEqual(Object.keys(json('rollout.json')), ['_provenance', 'target', 'site', 'exports', 'lastRun']);
  assert.equal(typeof json('rollout.json').lastRun.pages.contentPending, 'number');
  assert.deepEqual(validate(loadSchema('rollout-config.schema.json'), json('rollout.json')), []);
});
check('exports written into rollout.json survives a re-run, with the other site fields', () => {
  const site = { sourceUrl: 'https://example.com', da: { org: 'org', site: 'site', ref: 'main' }, liveHost: 'main--site--org.aem.live' };
  seedConfig({ site, exports: ['migration-workspace'] });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json('rollout.json').exports, ['migration-workspace']); assert.deepEqual(json('rollout.json').site, site);
});
check('the carry-forward keeps string entries only, once each, in order', () => {
  seedConfig({ exports: ['migration-workspace-files', 7, null, 'migration-workspace', 'migration-workspace-files'] });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json('rollout.json').exports, ['migration-workspace-files', 'migration-workspace']);
});
check('--export migration-workspace adds the name once (twice with the flag, and repeated in one run → one entry)', () => {
  const legacy = json('rollout.json'); delete legacy.exports; writeFileSync(configPath, JSON.stringify(legacy)); // a rollout.json from before the key
  const a = run('--export', 'migration-workspace');
  assert.equal(a.status, 0, a.stderr); assert.deepEqual(json('rollout.json').exports, ['migration-workspace']);
  const b = run('--export', 'migration-workspace', '--export', 'migration-workspace');
  assert.equal(b.status, 0, b.stderr); assert.deepEqual(json('rollout.json').exports, ['migration-workspace']);
  const c = run('--export', 'migration-workspace-files');
  assert.equal(c.status, 0, c.stderr); assert.deepEqual(json('rollout.json').exports, ['migration-workspace', 'migration-workspace-files']);
});
check('an unknown --export value, or --export with no value, exits 2 and writes nothing', () => {
  const before = readFileSync(configPath); const pagesBefore = readFileSync(join(out, 'coverage', 'pages.json'));
  for (const extra of [['--export', 'site-archive'], ['--export']]) {
    const r = run(...extra);
    assert.equal(r.status, 2, `${extra.join(' ')}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, /--export needs one of migration-workspace, migration-workspace-files/);
    assert.ok(readFileSync(configPath).equals(before), 'rollout.json byte-identical'); assert.ok(readFileSync(join(out, 'coverage', 'pages.json')).equals(pagesBefore), 'pages.json byte-identical');
  }
});

// --- coverage 0.1.0: the delivered structure ------------------------------------------------------
// A project laid out as rollout runs it (cwd = project root, every flag at its default): migrated pages
// with sidecars, content files for some of them, a source snapshot for one, state.json, a rollout.json
// that names the project (DA org/site, live host) and a judgement for one template.
const site = mkdtempSync(join(tmpdir(), 'rollout-inventory-delivered-'));
const put = (rel, body) => { mkdirSync(dirname(join(site, rel)), { recursive: true }); writeFileSync(join(site, rel), typeof body === 'string' ? body : JSON.stringify(body)); };
const migratedPage = (rel, meta) => { put(`stardust/migrated/${rel}`, `<html><body><main>${rel}</main></body></html>`); put(`stardust/migrated/${dirname(rel) === '.' ? '' : `${dirname(rel)}/`}${sidecarName(rel.split('/').pop())}`, meta); };
const runSite = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: site });
const siteJson = (rel) => JSON.parse(readFileSync(join(site, rel), 'utf8'));
const pagesFile = join(site, 'stardust/rollout/coverage/pages.json');
const templatesFile = join(site, 'stardust/rollout/coverage/templates.json');
const vid = (block, classes) => `v_${createHash('sha256').update(`stardust-variant:${block}|${classes.join(' ')}`).digest('hex').slice(0, 12)}`;
const hash = (rel) => `sha256:${createHash('sha256').update(readFileSync(join(site, rel))).digest('hex')}`;
const REC_KEYS = ['pos', 'block', 'variant', 'kind', 'section', 'sectionPos', 'classes', 'variantId', 'rows', 'cells'];
const dflt = (pos, variant, section, sectionPos) => ({ pos, block: 'default-content', variant, kind: 'default', section, sectionPos, classes: [], variantId: null, rows: null, cells: null });

migratedPage('index.html', { slug: 'home', fidelityTier: 'archetype', template: null, source: { url: 'https://www.example.com/' }, metadata: { lang: ' en-US ' }, modules: ['hero', 'cards'] });
migratedPage('about.html', { slug: 'about', type: 'article', fidelityTier: 'archetype', template: null, source: { url: 'https://www.example.com/about' }, metadata: { lang: 'en-US' }, modules: ['hero'] });
migratedPage('news/one.html', { slug: 'news-one', type: 'article', template: 'about', source: { url: 'https://www.example.com/a/news-one' }, modules: [] });
migratedPage('news/two.html', { slug: 'news-two', type: 'article', template: 'about', modules: [] });
migratedPage('news/three.html', { slug: 'news-three', type: 'article', template: 'about', source: { url: 'https://www.example.com/a/0' }, modules: [] });
put('stardust/state.json', { site: { originUrl: 'https://www.example.com', deployUrl: 'https://main--fixture-site--fixture-org.aem.page' },
  pages: [{ slug: 'home', url: 'https://www.example.com/', type: 'landing' }, { slug: 'about', type: 'unique' }] });
put('stardust/rollout/rollout.json', { target: 'aem-eds', site: { sourceUrl: 'https://www.example.com', da: { org: 'fixture-org', site: 'fixture-site', ref: 'main' }, liveHost: 'main--fixture-site--fixture-org.aem.live' }, exports: [] });
put('stardust/rollout/workspace/judgement.json', { templates: {
  about: { name: ' article ', description: 'Long-form pages, as on main--fixture-site--fixture-org.aem.live and fixture-site.' },
  home: { name: '  ', description: '' },
} });
put('stardust/current/pages/home.html', '<html><body>source snapshot</body></html>');
// Home: a styled section (default run, a block with duplicate/mixed-case classes, a second default run) and a
// plain one (chrome block skipped, a block, a default run repeating a part); a metadata-only section is dropped.
put('content/index.html', `<html><head><title>Home</title></head><body><header><div class="nav">nav</div></header><main>
<div>
  <h1>Welcome</h1>
  <p>Intro, see https://main--fixture-site--fixture-org.aem.page/x.</p>
  <div class="hero wide Dark dark wide"><div><div><picture><img src="/a.jpg" alt=""></picture></div></div><div><div><p>Copy</p></div></div></div>
  <p><a href="/go">Go</a></p>
  <hr>
  <p><picture><img src="/b.jpg" alt=""></picture></p>
  <ul><li><a href="/x">X</a></li><li><strong><a href="/y">Y</a></strong></li></ul>
  <div class="section-metadata"><div><div> Style </div><div> highlight fixture-site </div></div></div>
</div>
<div>
  <div class="header"><div><div>chrome</div></div></div>
  <div class="cards"><div><div>a</div><div>b</div></div><div><div>c</div><div>d</div><div>e</div></div></div>
  <h2>Tail</h2>
  <p><em><a href="/more">More</a></em></p>
  <video src="/v.mp4"></video>
  <h3>End</h3>
</div>
<div><div class="metadata"><div><div>Title</div><div>Home</div></div></div></div>
</main><footer></footer></body></html>
`);
put('content/about.html', '<html><body><div><div class="hero Dark dark wide"><div><div>Hi</div></div></div><p>Text</p></div></body></html>\n');
put('content/news/one/index.html', '<main><div><p>Only text.</p></div><div></div><div><div class="cards"><div><div>x</div></div></div></div></main>\n');

const d1 = runSite();
const pagesOf = () => Object.fromEntries(siteJson('stardust/rollout/coverage/pages.json').pages.map((p) => [p.slug, p]));
const templatesOf = () => Object.fromEntries(siteJson('stardust/rollout/coverage/templates.json').templates.map((t) => [t.id, t]));
check('delivered: records in document order with the spec keys in order — sorted unique classes, merged default-content runs, sections with style and block positions', () => {
  assert.equal(d1.status, 0, d1.stderr);
  const home = pagesOf().home;
  assert.deepEqual(Object.keys(home), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'widgets', 'delivered', 'delivery']);
  assert.deepEqual(Object.keys(home.delivered), ['blocks', 'sections', 'lang', 'sourceSnapshot', 'contentHash']);
  for (const r of home.delivered.blocks) assert.deepEqual(Object.keys(r), REC_KEYS);
  const style = 'highlight <site>'; // the trimmed section-metadata style, project identity scrubbed
  assert.deepEqual(home.delivered.blocks, [
    dflt(0, 'heading+text', style, 0),
    { pos: 1, block: 'hero', variant: 'Dark dark wide', kind: 'block', section: style, sectionPos: 0, classes: ['Dark', 'dark', 'wide'], variantId: vid('hero', ['Dark', 'dark', 'wide']), rows: 2, cells: [1, 1] },
    dflt(2, 'button+separator+image+link-list', style, 0),
    { pos: 3, block: 'cards', variant: null, kind: 'block', section: null, sectionPos: 1, classes: [], variantId: vid('cards', []), rows: 2, cells: [2, 3] },
    dflt(4, 'heading+button+video', null, 1),
  ]);
  assert.deepEqual(home.delivered.sections, [{ pos: 0, style, blocks: [0, 1, 2] }, { pos: 1, style: null, blocks: [3, 4] }]);
  for (const s of home.delivered.sections) assert.deepEqual(Object.keys(s), ['pos', 'style', 'blocks']);
  assert.match(home.delivered.blocks[1].variantId, /^v_[0-9a-f]{12}$/);
});
check('delivered: lang from the sidecar, sourceSnapshot when committed, contentHash of the content file; <body> and <path>/index.html fallbacks; empty sections dropped', () => {
  const p = pagesOf();
  assert.equal(p.home.delivered.lang, 'en-US'); assert.equal(p.home.delivered.sourceSnapshot, join('stardust', 'current', 'pages', 'home.html'));
  assert.equal(p.home.delivered.contentHash, hash('content/index.html'));
  assert.equal(p.about.delivered.sourceSnapshot, null); assert.equal(p.about.delivered.contentHash, hash('content/about.html'));
  assert.deepEqual(p.about.delivered.blocks.map((r) => [r.block, r.variant, r.variantId]), [['hero', 'Dark dark wide', vid('hero', ['Dark', 'dark', 'wide'])], ['default-content', 'text', null]]);
  assert.equal(p['news-one'].delivered.contentHash, hash('content/news/one/index.html')); assert.equal(p['news-one'].delivered.lang, null);
  assert.deepEqual(p['news-one'].delivered.sections, [{ pos: 0, style: null, blocks: [0] }, { pos: 1, style: null, blocks: [1] }]);
  assert.deepEqual(p['news-one'].delivered.blocks.map((r) => [r.pos, r.block, r.sectionPos, r.rows, r.cells]), [[0, 'default-content', 0, null, null], [1, 'cards', 1, 1, [1]]]);
});
check('delivered is null for a page with no content file, placed after blocks; module ids in blocks unchanged', () => {
  const p = pagesOf();
  assert.equal(p['news-two'].delivered, null); assert.equal(p['news-three'].delivered, null);
  assert.deepEqual(Object.keys(p['news-two']), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'widgets', 'delivered', 'delivery']);
  assert.deepEqual(p.home.blocks, ['hero', 'cards']);
  assert.match(d1.stdout, /^Delivered {3}3\/5 pages parsed from content · 2 without a content file \(delivered: null\)$/m, d1.stdout);
});
check('templates: type (sidecar, else state.json), representativeUrl, urls (representative first, rest sorted, unknown skipped), keys in order', () => {
  const t = templatesOf();
  assert.deepEqual(Object.keys(t.about), ['id', 'name', 'description', 'type', 'representativeSlug', 'representativeUrl', 'pages', 'pageCount', 'urls', 'blocks', 'delivery']);
  assert.deepEqual(Object.keys(t.home), ['id', 'type', 'representativeSlug', 'representativeUrl', 'pages', 'pageCount', 'urls', 'blocks', 'delivery']);
  assert.equal(t.about.type, 'article'); assert.equal(t.home.type, 'landing');
  assert.equal(t.about.representativeSlug, 'about'); assert.equal(t.about.representativeUrl, 'https://www.example.com/about');
  assert.deepEqual(t.about.urls, ['https://www.example.com/about', 'https://www.example.com/a/0', 'https://www.example.com/a/news-one']);
  assert.deepEqual(t.about.pages, ['about', 'news-one', 'news-three', 'news-two']); assert.equal(t.about.pageCount, 4);
  assert.deepEqual(t.home.urls, ['https://www.example.com/']);
});
check('templates: a judged name/description is applied, trimmed and scrubbed of the project host; a blank judgement adds nothing', () => {
  const t = templatesOf();
  assert.equal(t.about.name, 'article'); assert.equal(t.about.description, 'Long-form pages, as on <host> and <site>.');
  assert.ok(!('name' in t.home) && !('description' in t.home));
});
check('both coverage files carry formatVersion right after _provenance and validate against their schemas', () => {
  for (const [file, schema, key] of [[pagesFile, 'rollout-pages.schema.json', 'pages'], [templatesFile, 'rollout-templates.schema.json', 'templates']]) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(doc), ['_provenance', 'formatVersion', 'generatedAt', key]); assert.equal(doc.formatVersion, '0.1.0');
    const s = loadSchema(schema);
    assert.deepEqual(unsupported(s), [], `${schema} uses keywords the validator does not check`);
    assert.deepEqual(validate(s, doc), [], schema);
  }
});
check('no project identity in the new fields (delivered, template type/urls/name/description)', () => {
  const tokens = identityTokens({ rollout: siteJson('stardust/rollout/rollout.json'), state: siteJson('stardust/state.json') });
  assert.ok(tokens.includes('fixture-site'), tokens.join(','));
  const fields = {
    delivered: Object.values(pagesOf()).map((p) => p.delivered),
    templates: Object.values(templatesOf()).map(({ name, description, type, representativeUrl, urls }) => ({ name, description, type, representativeUrl, urls })),
  };
  assert.ok(fields.delivered.filter(Boolean).length === 3 && fields.templates.some((t) => t.description), 'the new fields are populated');
  assert.deepEqual(findIdentity(fields, tokens), []);
  for (const re of IDENTITY_PATTERNS) assert.doesNotMatch(JSON.stringify(fields), re);
});
const stamp = () => [pagesFile, templatesFile].map((f) => [readFileSync(f), statSync(f).mtimeMs]);
const firstStamp = stamp();
const d2 = runSite();
check('a second run with unchanged inputs leaves pages.json and templates.json byte-identical and untouched', () => {
  assert.equal(d2.status, 0, d2.stderr);
  stamp().forEach(([bytes, mtime], i) => { assert.ok(bytes.equals(firstStamp[i][0]), 'bytes'); assert.equal(mtime, firstStamp[i][1], 'mtime'); });
  assert.match(d2.stdout, /coverage unchanged, not rewritten/, d2.stdout);
});
check('variantId carry-forward: an id the prior pages.json gave an identity is kept — on every page, a new one included', () => {
  const doc = siteJson('stardust/rollout/coverage/pages.json');
  for (const p of doc.pages) for (const r of (p.delivered && p.delivered.blocks) || []) if (r.block === 'hero') r.variantId = 'v_0123456789ab';
  writeFileSync(pagesFile, JSON.stringify(doc, null, 2));
  put('content/news/two.html', '<main><div><div class="hero dark wide Dark"><div><div>New</div></div></div></div></main>\n');
  const r = runSite();
  assert.equal(r.status, 0, r.stderr);
  const p = pagesOf();
  for (const slug of ['home', 'about', 'news-two']) assert.equal(p[slug].delivered.blocks.find((b) => b.block === 'hero').variantId, 'v_0123456789ab', slug);
  assert.equal(p.home.delivered.blocks.find((b) => b.block === 'cards').variantId, vid('cards', []));
});
check('a row added with update-coverage.mjs --new gets delivered from its content file, after its blocks', () => {
  const reg2 = spawnSync(process.execPath, [UPDATE, '--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics', '--out', 'stardust/rollout'], { encoding: 'utf8', cwd: site });
  assert.equal(reg2.status, 0, reg2.stderr);
  put('content/search.html', '<main><div><div class="search-results"><div><div>Results</div></div></div></div></main>\n');
  const r = runSite();
  assert.equal(r.status, 0, r.stderr);
  const row = pagesOf().search;
  assert.equal(row.source.migratedHtml, 'dynamics:search');
  assert.deepEqual(Object.keys(row), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'delivered', 'delivery'], 'a row update-coverage registered carries no widgets key; delivered still follows its listing');
  assert.deepEqual(row.delivered.blocks.map((b) => [b.block, b.variantId]), [['search-results', vid('search-results', [])]]);
  assert.equal(row.delivered.contentHash, hash('content/search.html'));
});
check('contentFileMatch: the row path exactly, else its delivered-path fold (the deploy lower-cases); never looser; both cases → the exact one, the other reported', () => {
  const files = new Set(['en/4-benefits-ftas-to-chain.html', 'a/FTAs.html', 'a/ftas.html', 'b/index.html', 'index.html']);
  assert.equal(foldDeliveredPath('/en/4-benefits-FTAs-to-chain'), 'en/4-benefits-ftas-to-chain');
  assert.equal(foldDeliveredPath('/A b/C_d.e/'), 'a-b/c-d-e', 'segments lower-cased, runs outside [a-z0-9] → -, trimmed');
  assert.deepEqual(contentFileMatch('/en/4-benefits-FTAs-to-chain', files), { file: 'en/4-benefits-ftas-to-chain.html', rule: 'folded', alternate: null });
  assert.deepEqual(contentFileMatch('/en/4-benefits-ftas-to-chain', files), { file: 'en/4-benefits-ftas-to-chain.html', rule: 'exact', alternate: null });
  assert.deepEqual(contentFileMatch('/a/FTAs', files), { file: 'a/FTAs.html', rule: 'exact', alternate: 'a/ftas.html' }, 'both cases exist: exact wins, the fold is named');
  assert.deepEqual(contentFileMatch('/a/ftas', files), { file: 'a/ftas.html', rule: 'exact', alternate: null });
  assert.deepEqual(contentFileMatch('/B', files), { file: 'b/index.html', rule: 'folded', alternate: null }, 'the folder-index form of the fold');
  assert.deepEqual(contentFileMatch('/en/4-benefits-FTAs', files), { file: null, rule: null, alternate: null }, 'a missing file stays null — no prefix or fuzzy match');
  assert.deepEqual(contentFileMatch('/en/4-benefits-ftas-to-chain-2', files), { file: null, rule: null, alternate: null });
  assert.deepEqual(contentFileMatch('/', files), { file: 'index.html', rule: 'exact', alternate: null });
  assert.deepEqual(contentFileMatch(null, files), { file: null, rule: null, alternate: null });
  assert.equal(contentFileFor('/a/FTAs', (k) => files.has(k)), 'a/FTAs.html', 'a predicate works too');
  assert.equal(contentFileFor('/A/ftas', { 'a/ftas.html': 1 }), 'a/ftas.html', 'an object keyed by path works too');
});
check('a row whose path keeps the source case is delivered from the lower-cased file the deploy wrote; a file missing in both cases stays null', () => {
  migratedPage('news/Four-FTAs.html', { slug: 'news-four', type: 'article', template: 'about', source: { url: 'https://www.example.com/news/Four-FTAs.html' }, modules: [] });
  migratedPage('news/Five-FTAs.html', { slug: 'news-five', type: 'article', template: 'about', source: { url: 'https://www.example.com/news/Five-FTAs.html' }, modules: [] });
  put('content/news/four-ftas.html', '<main><div><div class="cards"><div><div>Four</div></div></div></div></main>\n');
  const r = runSite();
  assert.equal(r.status, 0, r.stderr);
  const p = pagesOf();
  assert.equal(p['news-four'].path, '/news/Four-FTAs', 'the row keeps its path (the page key)');
  assert.deepEqual(p['news-four'].delivered.blocks.map((b) => [b.block, b.variantId]), [['cards', vid('cards', [])]]);
  assert.equal(p['news-four'].delivered.contentHash, hash('content/news/four-ftas.html'));
  assert.equal(p['news-five'].delivered, null, 'no file in either case: still null');
  assert.match(r.stdout, /^Folded {6}1 row\(s\) read from the delivered-path fold of their path .*: news-four → news\/four-ftas\.html$/m, r.stdout);
  assert.doesNotMatch(r.stdout, /^Ambiguous/m);
  for (const f of ['stardust/migrated/news/Four-FTAs.html', 'stardust/migrated/news/Four-FTAs._meta.json', 'stardust/migrated/news/Five-FTAs.html', 'stardust/migrated/news/Five-FTAs._meta.json', 'content/news/four-ftas.html']) rmSync(join(site, f));
  assert.equal(runSite().status, 0);
});
check('a content file under both cases: the exact one is read, pages.json caseCollisions[] names the pair (laid down only where the file system holds both), the schema admits it', () => {
  const head = siteJson('stardust/rollout/coverage/pages.json');
  const pair = { slug: 'news-six', path: '/news/Six-FTAs', file: 'news/Six-FTAs.html', alternate: 'news/six-ftas.html' };
  const sample = { _provenance: head._provenance, formatVersion: head.formatVersion, generatedAt: head.generatedAt, pages: [], caseCollisions: [pair] };
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), sample), [], 'caseCollisions[] is declared in the closed schema');
  assert.ok(!('caseCollisions' in head), 'no collision so far: the key is absent');
  put('content/news/Six-FTAs.html', '<main><div><div class="cards"><div><div>Exact</div></div></div></div></main>\n');
  if (existsSync(join(site, 'content/news/six-ftas.html'))) {
    rmSync(join(site, 'content/news/Six-FTAs.html'));
    console.log('  (case-insensitive file system: it cannot hold both files — the record is covered on the doc shape and in contentFileMatch)');
    return;
  }
  put('content/news/six-ftas.html', '<main><div><div class="hero"><div><div>Fold</div></div></div></div></main>\n');
  migratedPage('news/Six-FTAs.html', { slug: 'news-six', type: 'article', template: 'about', source: { url: 'https://www.example.com/news/Six-FTAs.html' }, modules: [] });
  const r = runSite();
  assert.equal(r.status, 0, r.stderr);
  const doc = siteJson('stardust/rollout/coverage/pages.json');
  assert.deepEqual(doc.caseCollisions, [pair]);
  assert.deepEqual(Object.keys(doc).slice(-2), ['pages', 'caseCollisions']);
  const row = pagesOf()['news-six'];
  assert.equal(row.delivered.contentHash, hash('content/news/Six-FTAs.html'), 'the exact file is read');
  assert.deepEqual(row.delivered.blocks.map((b) => b.block), ['cards']);
  assert.match(r.stdout, /^Ambiguous {3}1 row\(s\) with a content file in both cases .*: news-six → news\/Six-FTAs\.html \(not news\/six-ftas\.html\)$/m, r.stdout);
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), doc), []);
  for (const f of ['stardust/migrated/news/Six-FTAs.html', 'stardust/migrated/news/Six-FTAs._meta.json', 'content/news/Six-FTAs.html', 'content/news/six-ftas.html']) rmSync(join(site, f));
  assert.equal(runSite().status, 0);
  assert.ok(!('caseCollisions' in siteJson('stardust/rollout/coverage/pages.json')), 'the pair gone: the key is gone');
});
check('--content <dir> reads another content tree; a page outside it gets delivered: null', () => {
  cpSync(join(site, 'content'), join(site, 'alt-content'), { recursive: true });
  rmSync(join(site, 'alt-content', 'about.html'));
  const r = runSite('--content', 'alt-content');
  assert.equal(r.status, 0, r.stderr);
  const p = pagesOf();
  assert.equal(p.about.delivered, null); assert.equal(p.home.delivered.contentHash, hash('alt-content/index.html'));
  assert.ok(siteJson('stardust/rollout/coverage/pages.json')._provenance.readArtifacts.includes('alt-content'));
});
check('archetypes-only mode: a roster sibling with a content file gets delivered too', () => {
  // --state takes an archetypes-only tree and a url on every roster page: the news siblings leave, about gets its url
  rmSync(join(site, 'stardust/migrated/news'), { recursive: true, force: true });
  const roster = siteJson('stardust/state.json').pages.map((p) => (p.slug === 'about' ? { ...p, url: 'https://www.example.com/about' } : p));
  put('stardust/state.json', { ...siteJson('stardust/state.json'), pages: [...roster, { slug: 'contact', url: 'https://www.example.com/contact', type: 'about' }] });
  put('content/contact.html', '<main><div><h2>Write to us</h2><div class="form"><div><div>Name</div></div></div></div></main>\n');
  const r = runSite('--state', 'stardust/state.json');
  assert.equal(r.status, 0, r.stderr);
  const row = pagesOf().contact;
  assert.equal(row.delivery.status, 'content-pending'); assert.equal(row.representative, 'about');
  assert.deepEqual(row.delivered.blocks.map((b) => [b.kind, b.block, b.variant]), [['default', 'default-content', 'heading'], ['block', 'form', null]]);
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), siteJson('stardust/rollout/coverage/pages.json')), []);
});

// The shared delivered-site fixture, copied out of the repo: chrome authored on a page is no record,
// duplicate classes collapse, a trimmed section style lands on its records, and both files validate.
const shared = mkdtempSync(join(tmpdir(), 'rollout-inventory-shared-'));
cpSync(join(HERE, 'fixtures', 'delivered-site'), shared, { recursive: true });
const s1 = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: shared });
check('the shared delivered-site fixture: records, styles and schema validity', () => {
  assert.equal(s1.status, 0, s1.stderr);
  const doc = JSON.parse(readFileSync(join(shared, 'stardust/rollout/coverage/pages.json'), 'utf8'));
  const about = doc.pages.find((p) => p.slug === 'about-us');
  assert.ok(about && about.delivered, 'about-us has a content file');
  assert.ok(!about.delivered.blocks.some((r) => r.block === 'footer'), 'an authored footer block is chrome, not a record');
  assert.deepEqual(about.delivered.blocks.filter((r) => r.block === 'teaser').map((r) => r.classes), [['list', 'secure'], ['list', 'secure']]);
  assert.equal(about.delivered.blocks.find((r) => r.block === 'columns').section, 'light');
  assert.equal(about.delivered.lang, 'en-US');
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), doc), []);
  assert.deepEqual(validate(loadSchema('rollout-templates.schema.json'), JSON.parse(readFileSync(join(shared, 'stardust/rollout/coverage/templates.json'), 'utf8'))), []);
});

rmSync(site, { recursive: true, force: true });
rmSync(shared, { recursive: true, force: true });

// ---- encoded pages: a project (stardust/migrated beside stardust/encoded) ------------------------------
// The archetype (its migrated HTML is what deploy converts; the encoder also placed it), siblings the
// encoder placed with no clone (a leaf, a folder index), a sibling with a leftover clone, a clone sibling
// (a migrate render leaves `encode: null`), a stopped sibling with its exception clone, a sidecar with neither
// HTML nor encode, a stopped page and an encode record whose document is gone. The manifest records what the encoder wrote at each path.
{ // block scope: this section's helpers (put, hash, …) share names with the delivered-structure section above
const proj = join(root, 'proj');
const PM = join(proj, 'stardust', 'migrated');
const POUT = join(proj, 'stardust', 'rollout');
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const hash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const sib = (slug) => ({ slug, type: 'tour', renderBranch: "A'", template: 'tours', archetypeSource: 'tours', fidelityTier: 'sibling', modules: [] });
const manifest = {};
const encoded = (sidecarRel, doc, meta, body, { onDisk = true, status = 'clean' } = {}) => {
  const output = { path: `stardust/encoded/${doc}`, sha: hash(body) };
  put(join(PM, sidecarRel), JSON.stringify({ ...meta, encode: { map: { template: 'tours' }, output }, audit: { encode: { status } } }));
  if (onDisk) put(join(proj, output.path), body);
  manifest[output.path] = output.sha;
  put(join(proj, 'stardust/import/tours/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};
const DOC = { arch: '<html><main>tours, rendered</main></html>', north: '<main>north v1</main>', south: '<main>south</main>', eastClone: '<html><main>east clone</main></html>', east: '<main>east</main>', west: '<html><main>west clone</main></html>', except: '<html><main>except clone</main></html>' };
put(join(PM, 'tours/index.html'), DOC.arch);
encoded('tours/_meta.json', 'tours/index.html', { slug: 'tours', type: 'tour', renderBranch: 'A', template: null, fidelityTier: 'archetype', modules: ['hero'] }, '<main>tours</main>');
encoded('tours/north/_meta.json', 'tours/north.html', sib('tours-north'), DOC.north);
encoded('tours/south/_meta.json', 'tours/south/index.html', sib('tours-south'), DOC.south);
put(join(PM, 'tours/east/index.html'), DOC.eastClone);
encoded('tours/east/_meta.json', 'tours/east.html', sib('tours-east'), DOC.east);
put(join(PM, 'tours/west/index.html'), DOC.west);
put(join(PM, 'tours/west/_meta.json'), JSON.stringify({ ...sib('tours-west'), encode: null, audit: null }));
put(join(PM, 'about/_meta.json'), JSON.stringify({ slug: 'about', type: 'unique', modules: [] }));
put(join(PM, 'tours/except/index.html'), DOC.except); // migrate's render carried encode/audit into the clone's sidecar
encoded('tours/except/_meta.json', 'tours/except.html', sib('tours-except'), '<main>except, an earlier encode</main>', { status: 'variance' });
encoded('tours/held/_meta.json', 'tours/held.html', sib('tours-held'), '<main>held</main>', { status: 'variance' });
encoded('tours/gone/_meta.json', 'tours/gone.html', sib('tours-gone'), '<main>gone</main>', { onDisk: false });
const runP = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', POUT, ...args], { encoding: 'utf8' });
const pjson = (p, o = POUT) => JSON.parse(readFileSync(join(o, p), 'utf8'));
const rowsOf = (o) => Object.fromEntries(pjson('coverage/pages.json', o).pages.map((p) => [p.slug, p]));

const e1 = runP();
check('an encoded page is listed once, from its sidecar: path and sourceHash from the encoded document, no clone', () => {
  assert.equal(e1.status, 0, e1.stderr);
  const pages = pjson('coverage/pages.json').pages;
  assert.deepEqual(pages.map((p) => p.slug), ['tours', 'tours-east', 'tours-except', 'tours-gone', 'tours-held', 'tours-north', 'tours-south', 'tours-west'], 'one row per page; a sidecar with neither HTML nor encode is not a page');
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), pjson('coverage/pages.json')), [], 'encoded rows (source.encodedHtml) validate');
  const r = rowsOf(POUT);
  assert.deepEqual(r['tours-north'].source, { migratedHtml: null, encodedHtml: join(proj, 'stardust/encoded/tours/north.html'), metaJson: join(PM, 'tours/north/_meta.json'), sourceHash: hash(DOC.north), sourceUrl: null });
  assert.equal(r['tours-north'].path, '/tours/north'); assert.equal(r['tours-north'].templateId, 'tours'); assert.equal(r['tours-north'].delivery.status, 'pending');
  assert.equal(r['tours-south'].path, '/tours/south'); assert.equal(r['tours-south'].source.sourceHash, hash(DOC.south));
  const t = pjson('coverage/templates.json').templates.find((x) => x.id === 'tours');
  assert.equal(t.pageCount, 8); assert.equal(t.representativeSlug, 'tours');
});
check('the archetype and a clone sibling keep their migrated-HTML rows; a sibling the encoder placed over a leftover clone is listed once, as encoded', () => {
  const r = rowsOf(POUT);
  assert.deepEqual(r.tours.source, { migratedHtml: join(PM, 'tours/index.html'), metaJson: join(PM, 'tours/_meta.json'), sourceHash: hash(DOC.arch), sourceUrl: null }, 'deploy converts the archetype from its migrated HTML; it is never staged from the encoder');
  assert.deepEqual(r['tours-west'].source, { migratedHtml: join(PM, 'tours/west/index.html'), metaJson: join(PM, 'tours/west/_meta.json'), sourceHash: hash(DOC.west), sourceUrl: null });
  assert.deepEqual(r['tours-except'].source, { migratedHtml: join(PM, 'tours/except/index.html'), metaJson: join(PM, 'tours/except/_meta.json'), sourceHash: hash(DOC.except), sourceUrl: null }, 'a stopped sibling beside its clone is a clone page: the exception is converted, never skipped as a stopped encode');
  assert.equal(r['tours-east'].source.migratedHtml, null); assert.equal(r['tours-east'].source.encodedHtml, join(proj, 'stardust/encoded/tours/east.html'));
  assert.equal(r['tours-east'].source.sourceHash, hash(DOC.east), 'the encoded document, not the clone'); assert.equal(r['tours-east'].path, '/tours/east');
});
check('publicUrl: the encoded path decides the trailing slash (a leaf stays bare though its sidecar sits in a folder); a clone row is served at its path; a recorded deployedUrl decides for either', () => {
  const r = rowsOf(POUT);
  assert.equal(publicUrl(r['tours-north']), '/tours/north'); assert.equal(publicUrl(r['tours-east']), '/tours/east');
  assert.equal(publicUrl(r['tours-south']), '/tours/south/');
  assert.equal(publicUrl(r.tours), '/tours'); assert.equal(publicUrl(r['tours-west']), '/tours/west');
  assert.equal(publicUrl({ ...r['tours-south'], delivery: { ...r['tours-south'].delivery, deployedUrl: 'https://x.test/tours/south' } }), '/tours/south');
  assert.equal(publicUrl({ ...r.tours, delivery: { ...r.tours.delivery, deployedUrl: 'https://x.test/tours/' } }), '/tours/');
});
check('an encode that is not current (stopped, document gone) keeps its row with the last clean encode\'s hash; the report names each', () => {
  const r = rowsOf(POUT);
  assert.equal(r['tours-gone'].source.sourceHash, hash('<main>gone</main>')); assert.equal(r['tours-gone'].path, '/tours/gone');
  assert.equal(r['tours-held'].source.sourceHash, hash('<main>held</main>'));
  assert.match(e1.stdout, /^Not current 2 encoded page\(s\) — deploy stages none of them until each encodes clean; the row keeps the last clean encode's hash: tours-gone \(missing\), tours-held \(stopped\)$/m, e1.stdout);
});
{
  const pj = join(POUT, 'coverage', 'pages.json'); const doc = pjson('coverage/pages.json');
  for (const p of doc.pages) if (['tours-north', 'tours-south', 'tours-east', 'tours-held', 'tours-gone'].includes(p.slug)) p.delivery = { ...p.delivery, status: 'deployed', deployedAt: 'now' };
  writeFileSync(pj, JSON.stringify(doc));
  encoded('tours/north/_meta.json', 'tours/north.html', sib('tours-north'), '<main>north v2</main>'); // a re-encode: document, sidecar, manifest
  put(join(proj, 'stardust/encoded/tours/south/index.html'), '<main>south, edited by hand</main>'); // the sidecar still records the encode
}
const e2 = runP();
check('a re-encode with new bytes marks a delivered page stale; an unchanged, stopped, hand-edited or missing document stays put', () => {
  assert.equal(e2.status, 0, e2.stderr);
  const r = rowsOf(POUT);
  assert.equal(r['tours-north'].delivery.status, 'stale'); assert.equal(r['tours-north'].source.sourceHash, hash('<main>north v2</main>'));
  for (const s of ['tours-south', 'tours-east', 'tours-held', 'tours-gone']) assert.equal(r[s].delivery.status, 'deployed', s);
  assert.equal(r['tours-south'].source.sourceHash, hash(DOC.south), 'a hand edit is not a re-encode');
  assert.match(e2.stdout, /^Not current 3 encoded page\(s\) .*: tours-gone \(missing\), tours-held \(stopped\), tours-south \(stale\)$/m, e2.stdout);
});
check('run from the project root with the defaults: encodedHtml is project-relative like migratedHtml', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  const rows = rowsOf(POUT);
  assert.equal(rows['tours-north'].source.encodedHtml, 'stardust/encoded/tours/north.html'); assert.equal(rows.tours.source.migratedHtml, 'stardust/migrated/tours/index.html');
});
check('an encoded page gets delivered from its content file like any row, lang from its sidecar', () => {
  encoded('tours/lang/_meta.json', 'tours/lang.html', { ...sib('tours-lang'), metadata: { lang: ' de ' } }, '<main>lang</main>');
  const body = '<main><div><p>Hallo.</p></div></main>\n';
  put(join(proj, 'content/tours/lang.html'), body);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  const row = rowsOf(POUT)['tours-lang'];
  assert.equal(row.source.encodedHtml, 'stardust/encoded/tours/lang.html');
  assert.equal(row.delivered.lang, 'de'); assert.equal(row.delivered.contentHash, hash(body));
  assert.deepEqual(row.delivered.blocks.map((b) => [b.kind, b.variant]), [['default', 'text']]);
});
check('--state refuses the tree while a clone sibling is in it (tours-west; tours-except, stopped beside its clone) — an encoded sibling is none; nothing written', () => {
  const state = join(proj, 'stardust', 'state.json'); const out1 = join(proj, 'rollout-refused');
  put(state, JSON.stringify({ pages: [{ slug: 'tours', url: 'https://example.com/tours/', type: 'tour' }] }));
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', out1, '--state', state], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr, `rollout inventory: --state is the archetypes-only mode, but ${PM} holds 2 sibling page(s) (tours-except, tours-west) — re-run without --state\n`);
  assert.ok(!existsSync(out1), 'nothing written');
});
// the archetypes-only tree for the --state checks below: the clone siblings leave, the encoded ones stay
for (const dir of ['tours/west', 'tours/except']) rmSync(join(PM, dir), { recursive: true, force: true });
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

check('--state: a content-pending roster page advances to pending on the re-run after its encode appears, listed once', () => {
  const state = join(proj, 'stardust', 'state.json'); const out3 = join(proj, 'rollout-pending');
  put(state, JSON.stringify({ pages: [{ slug: 'tours', url: 'https://example.com/tours/', type: 'tour' }, { slug: 'tours-new', url: 'https://example.com/tours/new', representative: 'tours' }] }));
  const inv = () => spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', out3, '--state', state], { encoding: 'utf8' });
  let r = inv(); assert.equal(r.status, 0, r.stderr);
  assert.equal(rowsOf(out3)['tours-new'].delivery.status, 'content-pending');
  encoded('tours/new/_meta.json', 'tours/new.html', sib('tours-new'), '<main>new</main>');
  r = inv(); assert.equal(r.status, 0, r.stderr);
  const rows = rowsOf(out3);
  assert.equal(rows['tours-new'].delivery.status, 'pending'); assert.equal(rows['tours-new'].source.encodedHtml, join(proj, 'stardust/encoded/tours/new.html')); assert.equal(rows['tours-new'].templateId, 'tours');
  assert.equal(pjson('coverage/pages.json', out3).pages.filter((p) => p.slug.startsWith('tours-new')).length, 1);
});
check('--state: a roster row a cluster marked deployed (no document yet) stays deployed when its encode appears; a later re-encode marks it stale', () => {
  const state = join(proj, 'stardust', 'state.json'); const out4 = join(proj, 'rollout-roster');
  put(state, JSON.stringify({ pages: [{ slug: 'tours', url: 'https://example.com/tours/', type: 'tour' }, { slug: 'tours-late', url: 'https://example.com/tours/late', representative: 'tours' }] }));
  const inv = () => spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', out4, '--state', state], { encoding: 'utf8' });
  let r = inv(); assert.equal(r.status, 0, r.stderr);
  assert.equal(rowsOf(out4)['tours-late'].delivery.status, 'content-pending'); assert.equal(rowsOf(out4)['tours-late'].source.migratedHtml, null);
  const u = spawnSync(process.execPath, [join(HERE, '..', 'update-coverage.mjs'), 'tours-late', '--status', 'deployed', '--url', 'https://x.test/tours/late', '--out', out4], { encoding: 'utf8' });
  assert.equal(u.status, 0, u.stderr);
  encoded('tours/late/_meta.json', 'tours/late.html', sib('tours-late'), '<main>late v1</main>');
  r = inv(); assert.equal(r.status, 0, r.stderr);
  let row = rowsOf(out4)['tours-late'];
  assert.equal(row.delivery.status, 'deployed', 'the roster hash is not the document\'s: no re-flag'); assert.equal(row.delivery.deployedUrl, 'https://x.test/tours/late');
  assert.equal(row.source.sourceHash, hash('<main>late v1</main>'));
  assert.match(r.stdout, /^Kept {8}1 delivered row\(s\) whose hash basis changed \(roster → document\), not compared: tours-late$/m, r.stdout);
  r = inv(); assert.equal(rowsOf(out4)['tours-late'].delivery.status, 'deployed', 'an unchanged re-run');
  assert.doesNotMatch(r.stdout, /not compared/, 'the encoded row is compared now — nothing reported');
  encoded('tours/late/_meta.json', 'tours/late.html', sib('tours-late'), '<main>late v2</main>');
  r = inv(); assert.equal(r.status, 0, r.stderr);
  row = rowsOf(out4)['tours-late']; assert.equal(row.delivery.status, 'stale'); assert.equal(row.source.sourceHash, hash('<main>late v2</main>'));
});
// inventory rewrites pages.json, templates.json and rollout.json: it takes update-coverage's lock BEFORE it reads the old
// coverage — a status a cluster records while inventory waits for the lock survives the run — and releases it
{
  const out5 = join(proj, 'rollout-lock'); const lock = join(out5, '.coverage.lock'); const pj = join(out5, 'coverage', 'pages.json');
  const base = spawnSync(process.execPath, [SCRIPT, '--migrated', PM, '--out', out5], { encoding: 'utf8' });
  const baseline = readFileSync(pj, 'utf8');
  mkdirSync(lock); writeFileSync(join(lock, 'owner'), '4242 a cluster writer\n');
  const p = spawn(process.execPath, [SCRIPT, '--migrated', PM, '--out', out5], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res) => p.on('close', res));
  await new Promise((res) => setTimeout(res, 600));
  const untouchedWhileHeld = readFileSync(pj, 'utf8') === baseline;
  // the lock holder (a cluster's update-coverage) records an encoded page deployed, then releases the lock
  const doc = JSON.parse(baseline);
  for (const row of doc.pages) if (row.slug === 'tours-north') row.delivery = { ...row.delivery, status: 'deployed', deployedUrl: 'https://x.test/tours/north', deployedAt: 'now' };
  writeFileSync(pj, `${JSON.stringify(doc, null, 2)}\n`);
  rmSync(lock, { recursive: true, force: true });
  const code = await done;
  check('the coverage lock (<out>/.coverage.lock, update-coverage\'s) is taken before the old coverage is read: a status recorded while inventory waits survives; nothing written while held; released after', () => {
    assert.equal(base.status, 0, base.stderr);
    assert.equal(untouchedWhileHeld, true, 'pages.json written under a held lock');
    assert.equal(code, 0, err);
    const north = JSON.parse(readFileSync(pj, 'utf8')).pages.find((r) => r.slug === 'tours-north');
    assert.equal(north.delivery.status, 'deployed', 'the status recorded under the lock was lost: the old coverage was read before the lock');
    assert.equal(north.delivery.deployedUrl, 'https://x.test/tours/north');
    assert.deepEqual(readdirSync(out5).sort(), ['coverage', 'rollout.json'], 'no lock dir or tmp file left');
    assert.deepEqual(readdirSync(join(out5, 'coverage')).sort(), ['pages.json', 'templates.json']);
  });
}
}

// --- --state: the state file's real shape or a one-line refusal; the archetypes-only mode refuses a tree with siblings ---
{ // block scope: this section's helpers (put, …) share names with the delivered-structure section above
const box = mkdtempSync(join(tmpdir(), 'rollout-inventory-state-'));
const boxMigrated = join(box, 'migrated');
const boxOut = join(box, 'rollout');
const put = (rel, body) => { mkdirSync(dirname(join(box, rel)), { recursive: true }); writeFileSync(join(box, rel), typeof body === 'string' ? body : JSON.stringify(body)); };
const boxPage = (rel, meta, body = rel) => { put(`migrated/${rel}`, `<html><body><main>${body}</main></body></html>`); put(join('migrated', dirname(rel), sidecarName(rel.split('/').pop())), meta); };
// cwd = the scratch box, so the default `stardust/state.json` and `--content content` never resolve inside the repo
const runBox = (...args) => spawnSync(process.execPath, [SCRIPT, '--migrated', boxMigrated, '--out', boxOut, ...args], { encoding: 'utf8', cwd: box });
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
}

// --- Exclusions: a planned page the source no longer serves (state.mjs exclude) ---------------------------------------
{
const ex = mkdtempSync(join(tmpdir(), 'rollout-inventory-exclude-'));
const exPut = (rel, body) => { mkdirSync(dirname(join(ex, rel)), { recursive: true }); writeFileSync(join(ex, rel), typeof body === 'string' ? body : JSON.stringify(body)); };
const exPage = (rel, meta) => { exPut(`stardust/migrated/${rel}`, `<html><body><main>${rel}</main></body></html>`); exPut(join('stardust/migrated', dirname(rel), sidecarName(rel.split('/').pop())), meta); };
// cwd = the scratch project: the default stardust/state.json is the one written here
const runEx = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: ex });
const exDoc = () => JSON.parse(readFileSync(join(ex, 'stardust/rollout/coverage/pages.json'), 'utf8'));
exPage('index.html', { slug: 'home', type: 'home', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: [] });
exPage('about.html', { slug: 'about', type: 'unique', renderBranch: 'B', template: null, modules: [] });
exPage('news.html', { slug: 'news', type: 'unique', renderBranch: 'B', template: null, modules: [] });
const AT = '2026-10-09T10:00:00Z';
const exState = (news) => ({ pages: [
  { slug: 'home', url: 'https://example.com/', type: 'home', status: 'migrated' },
  { slug: 'about', url: 'https://example.com/about', type: 'unique', status: 'migrated' },
  { slug: 'news', url: 'https://example.com/news', type: 'unique', status: 'migrated', ...(news ? { excluded: { reason: 'the source answers 404', at: AT } } : {}) },
] });

check('exclusions: without any, pages.json has no excluded key; every migrated page is a row', () => {
  exPut('stardust/state.json', exState(false));
  const r = runEx();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!('excluded' in exDoc())); assert.deepEqual(exDoc().pages.map((p) => p.slug), ['about', 'home', 'news']);
  assert.doesNotMatch(r.stdout, /^Excluded/m);
});

check('exclusions: a page state.json records as excluded and one in its top-level excluded[] leave pages[] and the templates for excluded[] rows ({slug, path, sourceUrl, status excluded, reason, at}); schema-valid; a re-run is byte-identical', () => {
  exPut('stardust/state.json', { ...exState(true), excluded: [{ slug: 'old-offer', url: 'https://example.com/old-offer/', reason: 'the source answered 404 at crawl time', at: AT }] });
  const r = runEx();
  assert.equal(r.status, 0, r.stderr);
  const doc = exDoc();
  assert.deepEqual(doc.pages.map((p) => p.slug), ['about', 'home']);
  assert.deepEqual(doc.excluded, [
    { slug: 'news', path: '/news', sourceUrl: 'https://example.com/news', status: 'excluded', reason: 'the source answers 404', at: AT },
    { slug: 'old-offer', path: '/old-offer', sourceUrl: 'https://example.com/old-offer/', status: 'excluded', reason: 'the source answered 404 at crawl time', at: AT },
  ]);
  const templates = JSON.parse(readFileSync(join(ex, 'stardust/rollout/coverage/templates.json'), 'utf8')).templates;
  assert.ok(templates.every((t) => !t.pages.includes('news')), JSON.stringify(templates.map((t) => t.pages)));
  assert.match(r.stdout, /^Excluded {4}2 \(the source no longer serves them; state\.mjs exclude\), never counted: news, old-offer$/m, r.stdout);
  assert.deepEqual(validate(loadSchema('rollout-pages.schema.json'), doc), []);
  const bytes = readFileSync(join(ex, 'stardust/rollout/coverage/pages.json'), 'utf8');
  assert.equal(runEx().status, 0);
  assert.equal(readFileSync(join(ex, 'stardust/rollout/coverage/pages.json'), 'utf8'), bytes);
});

check('exclusions: --state (archetypes-only) never seeds an excluded roster page content-pending; it is an excluded[] row', () => {
  const roster = { pages: [
    { slug: 'home', url: 'https://example.com/', type: 'home' },
    { slug: 'promo', url: 'https://example.com/promo', type: 'home', excluded: { reason: 'the source answers 404', at: AT } },
    { slug: 'promo-2', url: 'https://example.com/promo-2', type: 'home' },
  ] };
  exPut('roster.json', roster);
  rmSync(join(ex, 'stardust/migrated/about.html')); rmSync(join(ex, 'stardust/migrated/about._meta.json'));
  rmSync(join(ex, 'stardust/migrated/news.html')); rmSync(join(ex, 'stardust/migrated/news._meta.json'));
  const r = runEx('--state', 'roster.json');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(exDoc().pages.map((p) => [p.slug, p.delivery.status]), [['home', 'pending'], ['promo-2', 'content-pending']]);
  assert.deepEqual(exDoc().excluded.map((e) => [e.slug, e.path, e.status]), [['promo', '/promo', 'excluded']]);
});
rmSync(ex, { recursive: true, force: true });
}

// Upstream's archetypes-only widget check, adapted: --state refuses a tree that holds siblings, so the archetype
// (with its widget mount) stands alone in its own tree; the roster's sibling inherits the widget as it inherits the blocks.
check('archetypes-only mode: a content-pending sibling inherits the archetype\'s widgets as it inherits its blocks', () => {
  const wBox = mkdtempSync(join(tmpdir(), 'rollout-inventory-widgets-')); const wMigrated = join(wBox, 'migrated'); const out2 = join(wBox, 'rollout'); const state = join(wBox, 'roster.json');
  mkdirSync(join(wMigrated, 'tours', 'bali'), { recursive: true });
  writeFileSync(join(wMigrated, 'tours', 'bali', 'index.html'), '<html><body><main>bali</main></body></html>');
  writeFileSync(join(wMigrated, 'tours', 'bali', '_meta.json'), JSON.stringify({ slug: 'tours-bali', type: 'program', fidelityTier: 'archetype', renderBranch: 'A', template: null, modules: ['hero', 'gallery'], widgets: [{ id: 'tour-finder', href: '/widgets/tours/tour-finder.html?region=all' }] }));
  writeFileSync(state, JSON.stringify({ pages: [{ slug: 'tours-bali', url: 'https://example.com/tours/bali/' }, { slug: 'tours-fiji', url: 'https://example.com/tours/fiji/', type: 'tours-bali' }] }));
  const r = spawnSync(process.execPath, [SCRIPT, '--migrated', wMigrated, '--out', out2, '--state', state], { encoding: 'utf8', cwd: wBox }); assert.equal(r.status, 0, r.stderr);
  const fiji = JSON.parse(readFileSync(join(out2, 'coverage', 'pages.json'), 'utf8')).pages.find((p) => p.slug === 'tours-fiji');
  assert.equal(fiji.delivery.status, 'content-pending'); assert.deepEqual(fiji.blocks, ['hero', 'gallery']); assert.deepEqual(fiji.widgets, [{ id: 'tour-finder', href: '/widgets/tours/tour-finder.html?region=all' }]);
  assert.match(r.stdout, /^Widgets {5}1 distinct \(tour-finder\) on 2 pages/m, r.stdout);
  rmSync(wBox, { recursive: true, force: true });
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
