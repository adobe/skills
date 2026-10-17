#!/usr/bin/env node
// skills/rollout/scripts/test/inventory.test.mjs — the inventory.mjs contract: template grouping
// from the sidecars (an archetype with `template: null` groups under its own slug, with the
// siblings that name it; `type` last), the archetype as representative, the empty-modules
// report, delivery state preserved across re-runs, a row added by `update-coverage.mjs --new`
// (origin marker in source.migratedHtml) kept across a re-run until the migrated tree holds it, and
// the opt-in `exports` key in rollout.json (carried across re-runs; `--export <name>` adds a name
// once; an unknown name exits 2 before any write), and coverage 0.1.0: each row's `delivered` structure
// parsed from its content file (records in document order, sections, variantId carry-forward,
// contentHash; null without a content file), the templates' type/representativeUrl/urls and judged
// name/description, `formatVersion`, schema validity, byte-identical re-runs and no project identity.
// Run: node plugins/stardust/skills/rollout/scripts/test/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_PATTERNS, findIdentity, identityTokens } from '../lib.mjs';
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

// The opt-in `exports` key: inventory rebuilds rollout.json from named fields on every run, so the key
// must be carried forward explicitly — it is always written (empty when nothing is opted in).
const configPath = join(out, 'rollout.json');
const seedConfig = (patch) => writeFileSync(configPath, JSON.stringify({ ...json('rollout.json'), ...patch }));
check('rollout.json always carries exports, empty when nothing is opted in, between site and lastRun', () => {
  assert.deepEqual(json('rollout.json').exports, []);
  assert.deepEqual(Object.keys(json('rollout.json')), ['_provenance', 'target', 'site', 'exports', 'lastRun']);
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
  assert.deepEqual(Object.keys(home), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'delivered', 'delivery']);
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
  assert.deepEqual(Object.keys(p['news-two']), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'delivered', 'delivery']);
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
  assert.deepEqual(Object.keys(row), ['slug', 'path', 'title', 'templateId', 'source', 'blocks', 'delivered', 'delivery']);
  assert.deepEqual(row.delivered.blocks.map((b) => [b.block, b.variantId]), [['search-results', vid('search-results', [])]]);
  assert.equal(row.delivered.contentHash, hash('content/search.html'));
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
  put('stardust/state.json', { ...siteJson('stardust/state.json'), pages: [...siteJson('stardust/state.json').pages, { slug: 'contact', url: 'https://www.example.com/contact', type: 'about' }] });
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
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
