// Contract test for migrate.mjs — a mkdtemp project with seven state pages, prototypes, captures and a
// canon; every subcommand is driven through the CLI (execFileSync/spawnSync); foldPath is imported for
// the pure check. Also: importing the module is silent, the flow guard, the merged state.json.migrate
// block, AEM-folded output-path collisions, a malformed sidecar refused, the value-flag swallow rule, the A′ fork
// from the archetype's typed slots (media map, media ledger, refusals) and the sibling-variance gate.
// Run: node skills/migrate/scripts/test/migrate.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { foldPath, forkFromArchetype, forkHead } from '../migrate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrate.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'migrate-test-'));
let failed = 0; let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`); }
}
const run = (args, cwd = tmp) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const write = (rel, data) => { const f = join(tmp, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); return f; };
const read = (rel) => readFileSync(join(tmp, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const has = (rel) => existsSync(join(tmp, rel));
const STATE = 'stardust/state.json'; const OUT = 'stardust/migrated';

// ---- fixture ---------------------------------------------------------------------------------
const page = (slug, url, status, type, extra = {}) => ({ slug, url, title: slug, status, type, ...extra });
const state0 = {
  _provenance: { writtenBy: 'test' },
  site: { originUrl: 'https://example.test', name: 'Example' },
  direction: { status: 'active' },
  flow: 'replica', flowChosenAt: '2026-09-01T00:00:00Z', flowSource: 'user-phrase',
  pages: [
    page('home', '/', 'approved', 'landing'),
    page('tours', '/tours/', 'approved', 'listing'),
    page('tours-north', '/tours/north/', 'directed', 'listing'),
    page('about-history', '/about/history.html', 'approved', 'static'),
    page('faq', '/faq', 'directed', 'faq'),
    page('contact', '/contact/', 'extracted', 'form'),
    page('brochure', '/files/brochure.pdf', 'approved', 'document'),
  ],
};
write(STATE, `${JSON.stringify(state0, null, 2)}\n`);

// ---- importing the module never prints help or exits -------------------------------------------
console.log('import');
check('importing migrate.mjs with no argv prints nothing and does not exit (the help guard sits under the main check)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log('imported');`], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'imported\n'); assert.equal(r.stderr, '');
  const bare = run([]); assert.equal(bare.status, 0); assert.match(bare.out, /Usage:/, 'the CLI with no arguments still prints the usage');
});

const capture = (slug, title, desc) => write(`stardust/current/pages/${slug}.json`, JSON.stringify({ url: `https://example.test/${slug}`, title, metaDescription: desc, _provenance: { unsourcedContent: [] } }));
capture('home', 'Home capture', 'Home description from the capture.');
capture('tours', 'Tours capture', 'Tours description.');
capture('tours-north', 'North tours', 'Northern tours description.');
capture('about-history', 'Our history', 'History description.');
capture('faq', 'FAQ', 'Questions.');
const P = 'stardust/prototypes';
write(`${P}/home-proposed.html`, `<!doctype html>
<html lang="en">
<head><title>Home</title><link rel="stylesheet" href="site.css"><style>.x{color:red}</style></head>
<body>
<header><a href="/">Example</a></header>
<main>
  <section class="hero"><img src="assets/img/hero.jpg" srcset="assets/img/hero.jpg 1x, assets/img/hero@2x.jpg 2x" alt=""><h1>Welcome</h1></section>
  <section class="cards" data-module="cards"><a href="/tours/">Tours</a> <a href="https://example.test/about/history.html?utm_source=x&amp;keep=1#team">History</a></section>
  <div style="background:url(assets/img/bg.png)"><a href="/contact/">Contact</a> <a href="/nowhere/">Nowhere</a> <a href="mailto:a@example.test">Mail</a> <a href="#top">Top</a> <a href="https://elsewhere.example/x">Else</a></div>
</main>
<footer>© Example</footer>
</body>
</html>
`);
write(`${P}/site.css`, `body{font-family:A}@font-face{src:url(assets/fonts/a.woff2)}.bg{background:url(/assets/img/bg.png)}\n`);
write(`${P}/canon.css`, `:root{--a:1}\nbody{margin:0}\n`);
const minimal = (title, body = '') => `<!doctype html>\n<html lang="en">\n<head><title>${title}</title></head>\n<body><main><section class="intro"><h1>${title}</h1><a href="/">Home</a>${body}</section></main></body>\n</html>\n`;
write(`${P}/tours-proposed.html`, minimal('Tours', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Tours"}</script>'));
write(`${P}/tours-north-proposed.html`, minimal('North tours'));
write(`${P}/about-history-proposed.html`, minimal('Our history'));
write(`${P}/faq-proposed.html`, minimal('FAQ'));
write(`${P}/assets/img/hero.jpg`, 'HERO');
write(`${P}/assets/img/hero@2x.jpg`, 'HERO2X');
write(`${P}/assets/fonts/a.woff2`, 'FONT');
write('stardust/current/assets/img/bg.png', 'BG');

// ---- flow guard (state-machine.md § Flow keys) -------------------------------------------------
console.log('flow guard');
check('render refuses (exit 2) a state file without flow, pointing at the master routing; nothing is written', () => {
  const noFlow = structuredClone(state0); delete noFlow.flow; delete noFlow.flowChosenAt; delete noFlow.flowSource;
  write(STATE, `${JSON.stringify(noFlow, null, 2)}\n`);
  const r = run(['render', '--all']);
  assert.equal(r.status, 2, r.err); assert.equal(r.out, '');
  assert.match(r.err, /^refused: stardust\/state\.json has no top-level flow — stamp flow \/ flowChosenAt \/ flowSource before migrating/);
  assert.match(r.err, /skills\/stardust\/SKILL\.md § Routing/); assert.match(r.err, /Two migration flows/);
  assert.ok(!has(OUT), 'no page rendered'); assert.equal('migrate' in json(STATE), false, 'state.json untouched');
  for (const flow of ['replica', 'redesign']) { write(STATE, `${JSON.stringify({ ...noFlow, flow }, null, 2)}\n`); const ok = run(['pagemap']); assert.equal(ok.status, 0, ok.err); }
  write(STATE, `${JSON.stringify(state0, null, 2)}\n`);
});
// ---- run 1: --all without --branch-b → six placed, faq refused --------------------------------
console.log('render --all (first run)');
const r1 = run(['render', '--all']);
check('exit 2 because faq is refused; faq refusal names strict branch rule on stderr', () => {
  assert.equal(r1.status, 2, r1.err);
  assert.match(r1.err, /^refused faq: strict branch — /m);
  assert.match(r1.out, /^rendered 4, unchanged 0, refused 1, passthrough 1 → stardust\/migrated\/$/m);
});
check('per-page lines carry branch, type and counts', () => {
  assert.match(r1.out, /^A {2}home → index\.html {2}\(landing; \d+ assets, \d+ links, 2 broken, 3 sections\)$/m);
  assert.match(r1.out, /^A' tours-north → tours\/north\/index\.html {2}\(listing; /m);
  assert.match(r1.out, /^passthrough brochure: files\/brochure\.pdf /m);
  assert.match(r1.out, /^skip contact: status extracted$/m);
});
check('output paths follow the URL-literal rule and sidecars sit beside their page', () => {
  for (const f of ['index.html', '_meta.json', 'tours/index.html', 'tours/_meta.json', 'tours/north/index.html', 'tours/north/_meta.json', 'about/history.html', 'about/history._meta.json']) assert.ok(has(`${OUT}/${f}`), `${f} missing`);
  assert.ok(!has(`${OUT}/files/brochure.pdf`), 'passthrough must not create a file');
  assert.ok(!has(`${OUT}/faq/index.html`), 'refused page must not be written');
});
const home = read(`${OUT}/index.html`); const homeMeta = json(`${OUT}/_meta.json`);
check('site.css bundled to assets/site.css with url()s rewritten relative to its new location', () => {
  assert.match(home, /href="\.\/assets\/site\.css"/);
  const css = read(`${OUT}/assets/site.css`);
  assert.match(css, /url\(fonts\/a\.woff2\)/); assert.match(css, /url\(img\/bg\.png\)/);
  assert.equal(read(`${OUT}/assets/fonts/a.woff2`), 'FONT'); assert.equal(read(`${OUT}/assets/img/bg.png`), 'BG');
});
check('img src, both srcset candidates and the inline style url() are rewritten and bundled', () => {
  assert.match(home, /src="\.\/assets\/img\/hero\.jpg"/);
  assert.match(home, /srcset="\.\/assets\/img\/hero\.jpg 1x, \.\/assets\/img\/hero@2x\.jpg 2x"/);
  assert.match(home, /style="background:url\(\.\/assets\/img\/bg\.png\)"/);
  assert.equal(read(`${OUT}/assets/img/hero@2x.jpg`), 'HERO2X');
});
check('provenance comment is the first child of <head>; first <style> starts with the canon :root block', () => {
  assert.match(home, /<head>\s*<!--\s*stardust:migrate/);
  const style = home.match(/<style[^>]*>([\s\S]*?)<\/style>/); assert.ok(style); assert.match(style[1].trim(), /^:root\{--a:1\}/);
  assert.match(home, /<link rel="stylesheet" href="\.\/assets\/canon\.css">/);
});
check('<main> gets data-template and positional data-section 1..3; modules[] from data-module', () => {
  assert.match(home, /<main data-template="home">/);
  for (const n of [1, 2, 3]) assert.match(home, new RegExp(`data-section="${n}"`));
  assert.ok(!/data-section="4"/.test(home)); assert.deepEqual(homeMeta.modules, ['cards']); assert.equal(homeMeta.slotsFilled.length, 3);
});
check('internal links: relative with explicit leaf, tracking stripped, broken flagged, others untouched', () => {
  assert.match(home, /href="\.\/tours\/index\.html"/);
  assert.match(home, /href="\.\/about\/history\.html\?keep=1#team"/);
  assert.match(home, /href="https:\/\/example\.test\/contact\/" data-broken-link="true"/);
  assert.match(home, /href="\.\/nowhere\/index\.html" data-broken-link="true"/);
  assert.match(home, /href="mailto:a@example\.test"/); assert.match(home, /href="#top"/); assert.match(home, /href="https:\/\/elsewhere\.example\/x"/);
  assert.match(home, /<header><a href="\.\/index\.html">/);
  assert.equal(homeMeta.brokenInternalLinks.length, 2);
});
check('depth-aware prefixes on nested pages', () => {
  const north = read(`${OUT}/tours/north/index.html`); const hist = read(`${OUT}/about/history.html`);
  assert.match(north, /href="\.\.\/\.\.\/index\.html"/); assert.match(north, /href="\.\.\/\.\.\/assets\/canon\.css"/);
  assert.match(hist, /href="\.\.\/index\.html"/); assert.match(hist, /href="\.\.\/assets\/canon\.css"/);
});
check('sidecar: branches, template, tiers, archetype fields, key order and sha set', () => {
  const north = json(`${OUT}/tours/north/_meta.json`);
  assert.equal(homeMeta.renderBranch, 'A'); assert.equal(homeMeta.template, null); assert.equal(homeMeta.fidelityTier, 'archetype'); assert.equal(homeMeta.archetypeSha, null);
  assert.equal(north.renderBranch, "A'"); assert.equal(north.template, 'tours'); assert.equal(north.fidelityTier, 'sibling'); assert.equal(north.archetypeSource, 'tours'); assert.match(north.archetypeSha, /^[0-9a-f]{12}$/);
  assert.equal(Object.keys(homeMeta)[0], 'slug'); assert.equal(homeMeta.outputPath, 'index.html'); assert.equal(homeMeta.outputPathDefault, null); assert.equal(homeMeta.sidecar, '_meta.json');
  assert.equal(json(`${OUT}/about/history._meta.json`).outputPathDefault, null);
  assert.deepEqual(Object.keys(homeMeta.canonShas), ['header', 'footer', 'css']); assert.equal(homeMeta.driverVersion, '1');
  assert.equal(homeMeta.metadata.title, 'Home'); assert.equal(homeMeta.metadata.description, 'Home description from the capture.');
});
check('variance gate: an A′ page with no probe file is rendered, recorded as skipped and named in one summary line; A / B record null', () => {
  assert.match(r1.out, /^variance: 1 A′ page\(s\) rendered without a variance probe row — recorded as skipped \(tours-north\)$/m);
  assert.deepEqual(json(`${OUT}/tours/north/_meta.json`).variance, { status: 'skipped', reason: 'no variance probe file stardust/rollout/variance/tours.json' });
  assert.equal(homeMeta.variance, null); assert.equal(Object.keys(homeMeta).at(-1), 'variance');
});
check('state.json.migrate: page map from all 7 pages, sorted bundledAssets; pages[].status and site untouched', () => {
  const s = json(STATE);
  assert.equal(s.migrate.pageMap.length, 7); assert.deepEqual(s.migrate.pageMap.map((e) => e.slug), state0.pages.map((p) => p.slug));
  assert.deepEqual(s.migrate.pageMap[3], { sourceUrl: '/about/history.html', outputPath: 'about/history.html', slug: 'about-history', outputPathDefault: null });
  assert.deepEqual(s.migrate.bundledAssets, [...s.migrate.bundledAssets].sort()); assert.ok(s.migrate.bundledAssets.includes('img/bg.png'));
  assert.deepEqual(s.pages.map((p) => p.status), state0.pages.map((p) => p.status)); assert.deepEqual(s.site, state0.site); assert.equal(s.migrate.selfContained, true);
  assert.deepEqual(Object.keys(s), ['_provenance', 'site', 'direction', 'flow', 'flowChosenAt', 'flowSource', 'pages', 'migrate']);
  assert.equal(s.flow, 'replica');
});
check('the sidecar-only subcommands are not flow-guarded: gate works on a state without flow', () => {
  const s = json(STATE); const flowKeys = { flow: s.flow, flowChosenAt: s.flowChosenAt, flowSource: s.flowSource }; delete s.flow; delete s.flowChosenAt; delete s.flowSource;
  write(STATE, `${JSON.stringify(s, null, 2)}\n`);
  const g = run(['gate', 'tours', 'probe-ok', '--evidence', 'unguarded']); assert.equal(g.status, 0, g.err); assert.deepEqual(json(`${OUT}/tours/_meta.json`).gatesPassed, ['probe-ok']);
  const r = run(['render', 'tours']); assert.equal(r.status, 2); assert.match(r.err, /no top-level flow/);
  const back = json(STATE); Object.assign(back, flowKeys); write(STATE, `${JSON.stringify(back, null, 2)}\n`);
  // undo the gate so the later judgment checks start clean
  const m = json(`${OUT}/tours/_meta.json`); m.gatesPassed = []; m.gateEvidence = {}; write(`${OUT}/tours/_meta.json`, `${JSON.stringify(m, null, 2)}\n`);
});
check('state.json.migrate is merged: a key this script does not own (generators) survives a render', () => {
  const s = json(STATE); s.migrate.generators = { sitemap: 'stardust/scripts/gen/sitemap.mjs' }; s.migrate.cleanedAssets = ['old/x.png']; write(STATE, `${JSON.stringify(s, null, 2)}\n`);
  const r = run(['render', 'tours', '--force']); assert.equal(r.status, 0, r.err);
  const m = json(STATE).migrate;
  assert.deepEqual(m.generators, { sitemap: 'stardust/scripts/gen/sitemap.mjs' }); assert.deepEqual(m.cleanedAssets, ['old/x.png']);
  assert.deepEqual(m.lastRun.rendered, ['tours']); assert.equal(m.pageMap.length, 7);
  const t = json(STATE); delete t.migrate.generators; t.migrate.cleanedAssets = []; write(STATE, `${JSON.stringify(t, null, 2)}\n`);
});

// ---- run 2/3: --branch-b places faq; the rest is unchanged; a third run touches nothing ---------
console.log('render --all --branch-b faq, then again');
const r2 = run(['render', '--all', '--branch-b', 'faq']);
check('faq renders on branch B (thin) once named in --branch-b; the other pages are unchanged', () => {
  assert.equal(r2.status, 0, r2.err);
  assert.match(r2.out, /^B {2}faq → faq\/index\.html {2}\(faq; /m);
  assert.match(r2.out, /^rendered 1, unchanged 4, refused 0, passthrough 1 /m);
  const faq = json(`${OUT}/faq/_meta.json`); assert.equal(faq.renderBranch, 'B'); assert.equal(faq.fidelityTier, 'thin'); assert.equal(faq.template, null);
  assert.match(read(`${OUT}/faq/index.html`), /<main data-template="faq">/); assert.equal(faq.outputPathDefault, 'trailing-slash'); assert.equal(faq.outputPath, 'faq/index.html');
});
const mtime = (rel) => statSync(join(tmp, rel)).mtimeMs;
const before = { html: mtime(`${OUT}/index.html`), meta: mtime(`${OUT}/_meta.json`), css: mtime(`${OUT}/assets/site.css`) };
const r3 = run(['render', '--all', '--branch-b', 'faq']);
check('third run: every page unchanged, files not rewritten', () => {
  assert.equal(r3.status, 0, r3.err);
  for (const s of ['home', 'tours', 'tours-north', 'about-history', 'faq']) assert.match(r3.out, new RegExp(`^unchanged ${s} → `, 'm'));
  assert.match(r3.out, /^rendered 0, unchanged 5, refused 0, passthrough 1 /m);
  assert.deepEqual({ html: mtime(`${OUT}/index.html`), meta: mtime(`${OUT}/_meta.json`), css: mtime(`${OUT}/assets/site.css`) }, before);
});

// ---- judgments recorded through the CLI survive a forced re-render -----------------------------
console.log('gate / variant / deviation / modules / decision, then --force');
check('gate, variant, deviation, modules and decision write into the sidecar', () => {
  assert.equal(run(['gate', 'home', 'visual-parity', '--evidence', 'compared side by side']).status, 0);
  assert.equal(run(['gate', 'home', 'links']).status, 0);
  assert.equal(run(['variant', 'home', 'hero', 'compact']).status, 0);
  assert.equal(run(['deviation', 'home', '--kind', 'copy-trim', '--source', 'Welcome to the site', '--target', 'Welcome', '--reason', 'headline length']).status, 0);
  assert.equal(run(['modules', 'tours', 'listing-grid', 'filters']).status, 0);
  assert.equal(run(['decision', 'home', '--kind', 'kept-legacy-form', '--json', '{"note":"form posts to the origin"}']).status, 0);
  const m = json(`${OUT}/_meta.json`);
  assert.deepEqual(m.gatesPassed, ['visual-parity', 'links']); assert.equal(m.gateEvidence['visual-parity'], 'compared side by side');
  assert.deepEqual(m.variants, ['hero compact']);
  assert.deepEqual(m.contentDeviations, [{ kind: 'copy-trim', source: 'Welcome to the site', target: 'Welcome', reason: 'headline length' }]);
  assert.deepEqual(m.migrationDecisions.filter((d) => !d._driver), [{ kind: 'kept-legacy-form', note: 'form posts to the origin' }]);
  assert.deepEqual(json(`${OUT}/tours/_meta.json`).modules, ['listing-grid', 'filters']);
});
check('subcommand errors: unknown slug, passthrough leaf, missing sidecar', () => {
  const a = run(['gate', 'nope', 'x']); assert.equal(a.status, 1); assert.match(a.err, /unknown slug/);
  const b = run(['gate', 'brochure', 'x']); assert.equal(b.status, 1); assert.match(b.err, /passthrough leaf/);
  const c = run(['gate', 'contact', 'x']); assert.equal(c.status, 1); assert.match(c.err, /render contact first/);
});
const r4 = run(['render', '--all', '--branch-b', 'faq', '--force']);
check('--force rewrites every page and carries the recorded judgments over', () => {
  assert.equal(r4.status, 0, r4.err);
  assert.match(r4.out, /^rendered 5, unchanged 0, refused 0, passthrough 1 /m);
  assert.ok(mtime(`${OUT}/index.html`) > before.html);
  const m = json(`${OUT}/_meta.json`);
  assert.deepEqual(m.gatesPassed, ['visual-parity', 'links']); assert.deepEqual(m.variants, ['hero compact']); assert.equal(m.contentDeviations.length, 1);
  assert.deepEqual(m.migrationDecisions.filter((d) => !d._driver).map((d) => d.kind), ['kept-legacy-form']);
  assert.deepEqual(json(`${OUT}/tours/_meta.json`).modules, ['listing-grid', 'filters'], 'earlier modules record wins when the HTML has no data-module');
  assert.deepEqual(json(`${OUT}/_meta.json`).modules, ['cards'], 'data-module in the HTML wins');
  assert.equal(json(STATE).migrate.lastRun.rendered.length, 5);
});
check('render --force carries the encoder\'s sidecar keys (encode, audit), the harness record (passedOn) and keeps generators; sourceCurrentSha stays sha1/12 of the page JSON', () => {
  const side = `${OUT}/tours/north/_meta.json`; const sha = (c) => `sha256:${c.repeat(64)}`;
  const encode = { encoder: { script: 'stardust/scripts/migrate/encode.mjs', version: '1', sha: sha('a') }, map: { template: 'tours', vocabularySha: sha('b'), transformSha: null },
    inputs: { captureSha: sha('c'), pageJsonSha: sha('d'), siteSha: sha('e'), patchesSha: null, archetypeCaptureSha: sha('f') }, output: { path: 'stardust/encoded/tours/north.html', sha: sha('0') }, encodedAt: '2026-10-01T00:00:00Z' };
  const audit = { encode: { status: 'clean', unmapped: [], flattened: [], patchesApplied: [] }, other: { kept: true } };
  const passedOn = { key: sha('9'), shapes: [{ slug: 'tours-north', shape: [{ block: 'cards', rows: 1, cells: ['image,text'] }] }] };
  write(side, `${JSON.stringify({ ...json(side), encode, audit, passedOn }, null, 2)}\n`);
  const s = json(STATE); const generators = { tours: { script: encode.encoder.script, sha: sha('a'), version: '1', vocabularySha: sha('b'), transformSha: null } };
  s.migrate.generators = generators; write(STATE, `${JSON.stringify(s, null, 2)}\n`);
  const r = run(['render', 'tours-north', '--force']); assert.equal(r.status, 0, r.err); assert.match(r.out, /^A' tours-north → /m);
  const after = json(side);
  assert.deepEqual(after.encode, encode, 'encode survives the re-render'); assert.deepEqual(after.audit, audit, 'audit survives, every sub-key');
  assert.deepEqual(after.passedOn, passedOn, 'passedOn survives');
  assert.deepEqual(json(STATE).migrate.generators, generators, 'generators kept as is');
  assert.equal(after.sourceCurrentSha, createHash('sha1').update(readFileSync(join(tmp, 'stardust/current/pages/tours-north.json'))).digest('hex').slice(0, 12), 'migrate\'s own key: sha1/12 of the page JSON');
  const t = json(STATE); delete t.migrate.generators; write(STATE, `${JSON.stringify(t, null, 2)}\n`);
});
check('modules --clear empties the list; summary lists every page with — for pages without a sidecar', () => {
  assert.equal(run(['modules', 'tours', '--clear']).status, 0); assert.deepEqual(json(`${OUT}/tours/_meta.json`).modules, []);
  const s = run(['summary']); assert.equal(s.status, 0);
  assert.match(s.out, /^home\s+approved\s+A\s+archetype\s+2\s+1\s+1\s+2\s+index\.html/m);
  assert.match(s.out, /^contact\s+extracted\s+—\s+—/m);
  const j = run(['summary', '--json']); assert.equal(JSON.parse(j.out).length, 7);
  const pm = run(['pagemap']); assert.equal(pm.status, 0); assert.match(pm.out, /^7 entries, 0 collision\(s\)$/m);
});

// ---- refusals: placeholder gate, empty <title>, output-path collision --------------------------
console.log('refusals');
const s1 = json(STATE);
s1.pages.push(page('draft', '/draft/', 'approved', 'static'), page('untitled', '/untitled/', 'approved', 'static'), page('dup-a', '/dup', 'approved', 'static'), page('dup-b', '/dup/', 'approved', 'static'));
write(STATE, `${JSON.stringify(s1, null, 2)}\n`);
write(`${P}/draft-proposed.html`, minimal('Draft', '<p data-placeholder="body">lorem</p>'));
write(`${P}/untitled-proposed.html`, minimal('').replace('<title></title>', '<title> </title>'));
write(`${P}/dup-a-proposed.html`, minimal('Dup A')); write(`${P}/dup-b-proposed.html`, minimal('Dup B'));
check('[data-placeholder] in the source → refused, exit 2, nothing written', () => {
  const r = run(['render', 'draft']); assert.equal(r.status, 2); assert.match(r.err, /^refused draft: strict placeholder-gate — \[data-placeholder\] present/m);
  assert.ok(!has(`${OUT}/draft/index.html`)); assert.ok(!has(`${OUT}/draft/_meta.json`));
});
check('empty <title> with no capture title → strict refusal', () => {
  const r = run(['render', 'untitled']); assert.equal(r.status, 2); assert.match(r.err, /^refused untitled: strict /m); assert.ok(!has(`${OUT}/untitled/index.html`));
});
check('two pages mapping to one output path → both refused (strict 8) before any render', () => {
  const r = run(['render', 'dup-a', 'dup-b']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused dup-a: strict 8 — output path dup\/index\.html collides with dup-b/m); assert.match(r.err, /^refused dup-b: strict 8 /m);
  assert.ok(!has(`${OUT}/dup/index.html`)); assert.match(run(['pagemap']).out, /1 collision\(s\)/);
});
check('two pages that collide only once AEM-folded (/About vs /about/) are both refused (strict 8), before any render', () => {
  assert.equal(foldPath('About/index.html'), 'about/index.html'); assert.equal(foldPath('Our Team/Meet_Us.html'), 'our-team/meet-us.html'); assert.equal(foldPath('a//b/'), 'a/b'); assert.equal(foldPath('x--y/-z-/index.html'), 'x-y/z/index.html');
  const s2 = json(STATE); s2.pages.push(page('about-upper', '/About', 'approved', 'static'), page('about-lower', '/about/', 'approved', 'static'));
  write(STATE, `${JSON.stringify(s2, null, 2)}\n`);
  write(`${P}/about-upper-proposed.html`, minimal('About U')); write(`${P}/about-lower-proposed.html`, minimal('About L'));
  const r = run(['render', 'about-upper', 'about-lower']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused about-upper: strict 8 — output path About\/index\.html collides with about-lower \(about\/index\.html\) once AEM-folded to about\/index\.html/m);
  assert.match(r.err, /^refused about-lower: strict 8 — output path about\/index\.html collides with about-upper \(About\/index\.html\) once AEM-folded to about\/index\.html/m);
  assert.ok(!has(`${OUT}/About/index.html`) && !has(`${OUT}/about/index.html`));
  const pm = run(['pagemap']); assert.equal(pm.status, 2); assert.match(pm.out, /^about-upper .*→ About\/index\.html  COLLISION \(folds to about\/index\.html\)$/m); assert.match(pm.out, /^about-lower .*→ about\/index\.html  COLLISION$/m); assert.match(pm.out, /2 collision\(s\)/);
  const back = json(STATE); back.pages = back.pages.filter((p) => !['about-upper', 'about-lower'].includes(p.slug)); write(STATE, `${JSON.stringify(back, null, 2)}\n`);
});
check('a malformed sidecar is refused by the sidecar subcommands (usage error naming the file) and by render (strict sidecar); never overwritten', () => {
  const side = `${OUT}/tours/_meta.json`; const good = read(side);
  write(side, '{ "slug": "tours", broken');
  const g = run(['gate', 'tours', 'x']); assert.equal(g.status, 1); assert.match(g.err, /^usage error: stardust\/migrated\/tours\/_meta\.json is not a valid JSON sidecar/);
  const v = run(['variant', 'tours', 'wide']); assert.equal(v.status, 1); assert.match(v.err, /not a valid JSON sidecar/);
  assert.equal(read(side), '{ "slug": "tours", broken', 'untouched by the subcommands');
  const r = run(['render', 'tours', '--force']); assert.equal(r.status, 2); assert.match(r.err, /^refused tours: strict sidecar — stardust\/migrated\/tours\/_meta\.json exists but is not valid JSON — fix or delete the sidecar/m);
  assert.equal(read(side), '{ "slug": "tours", broken', 'untouched by render');
  write(side, good);
});
check('a value flag followed by another flag (or nothing) is a usage error naming the flag', () => {
  for (const [args, flag] of [[['gate', 'home', 'links', '--evidence', '--force'], 'evidence'], [['render', '--all', '--canon-css'], 'canon-css'], [['render', 'home', '--out', '--force'], 'out'], [['deviation', 'home', '--kind', '--reason', 'x'], 'kind'], [['render', 'home', '--source', '--all'], 'source']]) {
    const r = run(args); assert.equal(r.status, 1, args.join(' ')); assert.match(r.err, new RegExp(`^usage error: --${flag} needs a value`), args.join(' '));
  }
  assert.match(run(['gate', 'home', 'links', '--evidence', '--force']).err, /--evidence needs a value \(got --force, which is a flag\)/);
  assert.deepEqual(json(`${OUT}/_meta.json`).gatesPassed, ['visual-parity', 'links'], 'nothing recorded');
  const ok = run(['decision', 'home', '--kind', 'k', '--json', '{"a":1}']); assert.equal(ok.status, 0, ok.err); // --json still takes its object
});
check('unknown slug and no command are usage errors (exit 1)', () => {
  assert.equal(run(['render', 'ghost']).status, 1); assert.equal(run(['frobnicate']).status, 1);
  const noState = run(['render', '--all', '--state', 'nope.json']); assert.equal(noState.status, 1);
  assert.match(noState.err, /^usage error: nope\.json does not exist — create it with state\.mjs init --pages <url-file\|-> after the crawl/);
});
s1.pages = s1.pages.filter((p) => !['draft', 'untitled', 'dup-a', 'dup-b'].includes(p.slug));

// ---- metadata: canonical from site.deployUrl, JSON-LD defaults by type, missing assets -----------
console.log('metadata and missing assets');
s1.site.deployUrl = 'https://www.example-live.test';
s1.pages.push(page('news-post', '/news/post/', 'approved', 'article'));
write(STATE, `${JSON.stringify(s1, null, 2)}\n`);
capture('news-post', 'A post', 'Post description.');
write(`${P}/news-post-proposed.html`, minimal('A post', '<img src="assets/img/missing.png" alt="">'));
const r5 = run(['render', '--all', '--branch-b', 'faq', '--force']); // deployUrl is not in the idempotency sha set
check('deployUrl → canonical and og:url point at the deployed URL form of the output path', () => {
  assert.equal(r5.status, 0, r5.err);
  const h = read(`${OUT}/index.html`); const hist = read(`${OUT}/about/history.html`); const post = read(`${OUT}/news/post/index.html`);
  assert.match(h, /<link rel="canonical" href="https:\/\/www\.example-live\.test\/">/);
  assert.match(h, /<meta property="og:url" content="https:\/\/www\.example-live\.test\/">/);
  assert.match(hist, /<link rel="canonical" href="https:\/\/www\.example-live\.test\/about\/history\.html">/);
  assert.match(post, /<link rel="canonical" href="https:\/\/www\.example-live\.test\/news\/post\/">/);
  assert.equal(json(`${OUT}/_meta.json`).metadata.canonical, 'https://www.example-live.test/');
});
check('default JSON-LD: WebPage for home, Article for an article page, an existing block is left alone', () => {
  const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const h = ld(read(`${OUT}/index.html`)); assert.equal(h.length, 1); assert.equal(h[0]['@type'], 'WebPage'); assert.equal(h[0].name, 'Home'); assert.equal(h[0].url, 'https://www.example-live.test/');
  const p = ld(read(`${OUT}/news/post/index.html`)); assert.equal(p.length, 1); assert.equal(p[0]['@type'], 'Article'); assert.equal(p[0].headline, 'A post'); assert.equal(p[0].mainEntityOfPage, 'https://www.example-live.test/news/post/');
  const t = ld(read(`${OUT}/tours/index.html`)); assert.equal(t.length, 1); assert.equal(t[0]['@type'], 'CollectionPage');
  assert.equal(json(`${OUT}/_meta.json`).jsonLd?.['@type'], 'WebPage');
});
check('missing asset: reference left as is, warned, recorded in the sidecar and in state.json.migrate', () => {
  assert.match(r5.out, /^missing assets: 1 reference\(s\)/m);
  const m = json(`${OUT}/news/post/_meta.json`); assert.deepEqual(m.missingAssets.map((x) => x.subpath), ['img/missing.png']);
  assert.deepEqual(m.migrationDecisions.filter((d) => d._driver).map((d) => d.kind), ['asset-missing']);
  assert.match(read(`${OUT}/news/post/index.html`), /src="assets\/img\/missing\.png"/);
  assert.deepEqual(json(STATE).migrate.missingAssets, [{ subpath: 'img/missing.png', referencedBy: ['news-post'] }]);
  assert.ok(!json(STATE).migrate.bundledAssets.includes('img/missing.png'));
});

// ---- A′ fork: a directed sibling without its own file is forked from the archetype's typed slots ---------
console.log("A' fork from the archetype");
const s3 = json(STATE);
s3.pages.push(
  page('guides', '/guides/', 'approved', 'guide'),
  page('guide-alpha', '/guides/alpha/', 'directed', 'guide'),
  page('guide-beta', '/guides/beta/', 'directed', 'guide'),
  page('guide-gamma', '/guides/gamma/', 'directed', 'guide'),
  page('guide-short', '/guides/short/', 'directed', 'guide'),
  page('guide-draft', '/guides/draft/', 'approved', 'guide'), // no source HTML: never a candidate, but a representative may name it
  page('guide-orphan', '/guides/orphan/', 'directed', 'guide', { representative: 'guide-draft' }),
  page('howto-one', '/howto/one/', 'directed', 'howto', { representative: 'guides' }),
  page('notes', '/notes/', 'approved', 'note'),
  page('note-one', '/notes/one/', 'directed', 'note'),
);
write(STATE, `${JSON.stringify(s3, null, 2)}\n`);
write(`${P}/guides-proposed.html`, `<!doctype html>
<html lang="en">
<head><title>Guides</title>
<meta name="description" content="All guides.">
<link rel="canonical" href="https://example.test/guides/">
<meta property="og:title" content="Guides">
<meta property="og:image" content="https://example.test/og.jpg">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Guides"}</script>
</head>
<body>
<header><a href="/">Example</a></header>
<main>
  <section class="hero">
    <h1 data-slot="headline">Archetype headline</h1>
    <p data-slot="deck">Archetype <em>deck</em></p>
    <img data-slot="lead-image" src="assets/img/hero.jpg" srcset="assets/img/hero.jpg 1x, assets/img/hero@2x.jpg 2x" sizes="100vw" alt="Archetype hero">
    <a data-slot="cta" class="button" href="/guides/">All guides</a>
  </section>
  <section class="body">
    <div data-slot="body"><p>Archetype body <span data-slot="body-note">note</span></p></div>
    <figure data-slot="figure"><picture><source srcset="assets/img/hero@2x.jpg" media="(min-width: 800px)"><img src="assets/img/hero.jpg" alt="Archetype figure"></picture><figcaption data-slot="caption">Archetype caption</figcaption></figure>
    <ul class="tips">
      <li data-slot="tip">Archetype tip one</li>
      <li data-slot="tip">Archetype tip two</li>
    </ul>
    <aside data-slot="sidebar"><p>Archetype sidebar</p></aside>
    <div class="related" data-slot="related"><a href="/tours/">Archetype related</a></div>
    <img class="badge" src="assets/img/hero.jpg" alt="">
  </section>
</main>
<footer>© Example</footer>
</body>
</html>
`);
write(`${P}/notes-proposed.html`, minimal('Notes'));
write(`${P}/guide-gamma-proposed.html`, minimal('Gamma own file'));
const fullSlots = (over = {}) => ({ headline: 'H', deck: 'D', 'lead-image': { src: '/media/alpha.jpg' }, cta: { href: '/tours/' }, body: 'B', figure: null, tip: ['T'], sidebar: null, related: { href: '/tours/' }, ...over });
const cap = (slug, o) => write(`stardust/current/pages/${slug}.json`, JSON.stringify({ url: `https://example.test/guides/${slug}`, _provenance: { unsourcedContent: [] }, ...o }));
cap('guide-alpha', { url: 'https://example.test/guides/alpha', finalUrl: 'https://example.test/guides/alpha/', title: 'Alpha guide', metaDescription: 'Alpha description.', language: 'en-GB', slots: {
  headline: 'Alpha & <friends>', deck: { text: 'Alpha deck' }, 'lead-image': { src: '/media/alpha.jpg#top', alt: 'Alpha hero' }, cta: { href: '/tours/north/', text: 'Northern tours' },
  body: { html: '<p>Alpha body <img src="media/inline.png" alt=""></p>' }, figure: { src: 'https://cdn.example.test/fig.jpg', alt: 'Alpha figure' }, caption: 'Alpha caption',
  tip: ['Tip A', 'Tip B', { html: '<strong>Tip C</strong>' }], sidebar: null, related: { href: 'https://example.test/about/history.html', text: 'Our history' }, 'body-note': 'inside the replaced body', extra: 'no such slot' } });
cap('guide-beta', { url: 'https://example.test/guides/beta', title: 'Beta guide', description: 'Beta from description.', slots: {
  headline: 'Beta', deck: { html: '<b>Beta deck</b>' }, 'lead-image': { src: 'https://media.example.test/beta.jpg', alt: 'Beta hero', srcset: 'https://media.example.test/beta.jpg 1x, https://media.example.test/beta-2x.jpg 2x' },
  cta: { href: '/tours/' }, body: 'Beta body', figure: { src: '/media/unknown.jpg' }, caption: null, tip: ['Only tip'], sidebar: { text: 'Beta sidebar' }, related: { href: '/faq' } } });
cap('guide-gamma', { title: 'Gamma guide', slots: [{ name: 'headline', text: 'Gamma' }, { name: 'deck', value: 'Gamma deck' }, { name: 'lead-image', src: 'https://media.example.test/gamma.jpg', alt: 'Gamma' },
  { name: 'cta', href: '/tours/', text: 'Tours' }, { name: 'body', html: '<p>Gamma body</p>' }, { name: 'figure', value: null }, { name: 'tip', text: 'G1' }, { name: 'tip', text: 'G2' }, { name: 'sidebar', value: null }, { name: 'related', href: '/tours/' }] });
cap('guide-short', { title: 'Short guide', slots: { headline: 'Short', deck: 'D', 'lead-image': { src: '/x.jpg' }, cta: { href: '/' }, body: 'B', figure: null, related: { href: '/' } } });
cap('guide-orphan', { title: 'Orphan', slots: fullSlots() });
cap('howto-one', { title: 'How to one', slots: fullSlots({ headline: 'How to one' }) });
cap('note-one', { title: 'Note one', slots: { headline: 'x' } });
write('stardust/current/assets/media/alpha-1a2b3c4d.jpg', 'ALPHA');
write('stardust/current/assets/media/inline-5e6f7a8b.png', 'INLINE');
write('stardust/current/assets/media-map.json', `${JSON.stringify({
  'https://cdn.example.test/fig.jpg': { local: null, bytes: null, contentType: null, status: 'http-404' },
  'https://example.test/guides/alpha/media/inline.png': { local: 'stardust/current/assets/media/inline-5e6f7a8b.png', bytes: 6, contentType: 'image/png', status: 'ok' },
  'https://example.test/media/alpha.jpg': { local: 'stardust/current/assets/media/alpha-1a2b3c4d.jpg', bytes: 5, contentType: 'image/jpeg', status: 'ok' },
}, null, 2)}\n`);
write('stardust/deploy/media-ledger.json', `${JSON.stringify({
  '/media/beta.jpg': { status: 'uploaded', file: 'stardust/deploy/media/beta.jpg', source: 'https://media.example.test/beta.jpg', contentUrl: 'https://content.example.test/media/beta.jpg' },
  '/media/unknown.jpg': { status: 'failed', file: 'stardust/deploy/media/unknown.jpg', source: 'https://example.test/media/unknown.jpg', contentUrl: 'https://content.example.test/media/unknown.jpg' },
}, null, 2)}\n`);
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const f1 = run(['render', 'guide-alpha', 'guide-beta']);
const alpha = has(`${OUT}/guides/alpha/index.html`) ? read(`${OUT}/guides/alpha/index.html`) : ''; const alphaMain = mainOf(alpha);
check('a directed sibling without its own file is forked from the archetype by default (per-page line names the fork)', () => {
  assert.equal(f1.status, 0, f1.err);
  assert.match(f1.out, /^A' guide-alpha → guides\/alpha\/index\.html {2}\(guide; fork of guides; /m);
  assert.match(f1.out, /^A' guide-beta → guides\/beta\/index\.html {2}\(guide; fork of guides; /m);
  assert.ok(!/Archetype/.test(alphaMain), 'no archetype content left in <main>'); assert.ok(!/data-stardust-fork/.test(alpha), 'transient marker stripped');
  assert.match(f1.out, /^variance: 2 A′ page\(s\) rendered without a variance probe row — recorded as skipped \(guide-alpha, guide-beta\)$/m);
});
check('fork text (escaped), { text }, { html } verbatim with nested slots gone, link on <a>, link on a container', () => {
  assert.match(alphaMain, /<h1 data-slot="headline">Alpha &amp; &lt;friends><\/h1>/);
  assert.match(alphaMain, /<p data-slot="deck">Alpha deck<\/p>/);
  assert.match(alphaMain, /<div data-slot="body"><p>Alpha body <img src="\.\.\/\.\.\/assets\/media\/inline-5e6f7a8b\.png" alt=""><\/p><\/div>/);
  assert.ok(!/body-note/.test(alphaMain), 'a nested slot goes with the replaced content');
  assert.match(alphaMain, /<a data-slot="cta" class="button" href="\.\.\/\.\.\/tours\/north\/index\.html">Northern tours<\/a>/);
  assert.match(alphaMain, /<div class="related" data-slot="related"><a href="\.\.\/\.\.\/about\/history\.html">Our history<\/a><\/div>/);
});
check('fork image via the media map → bundled under assets/media/, srcset + sizes removed; container image: first <img>, <source> removed, nested caption filled', () => {
  assert.match(alphaMain, /<img data-slot="lead-image" src="\.\.\/\.\.\/assets\/media\/alpha-1a2b3c4d\.jpg" alt="Alpha hero">/);
  assert.equal(read(`${OUT}/assets/media/alpha-1a2b3c4d.jpg`), 'ALPHA'); assert.equal(read(`${OUT}/assets/media/inline-5e6f7a8b.png`), 'INLINE');
  assert.ok(json(STATE).migrate.bundledAssets.includes('media/alpha-1a2b3c4d.jpg'));
  assert.match(alphaMain, /<figure data-slot="figure"><picture><img src="https:\/\/cdn\.example\.test\/fig\.jpg" alt="Alpha figure"><\/picture><figcaption data-slot="caption">Alpha caption<\/figcaption><\/figure>/);
  assert.match(alphaMain, /<img class="badge" src="\.\.\/\.\.\/assets\/img\/hero\.jpg" alt="">/, "the archetype's template-level media stay");
});
check('fork repeated slot: more values clone the last element after it; null removes the element', () => {
  assert.deepEqual([...alphaMain.matchAll(/<li data-slot="tip">(.*?)<\/li>/g)].map((m) => m[1]), ['Tip A', 'Tip B', '<strong>Tip C</strong>']);
  assert.ok(!/data-slot="sidebar"/.test(alphaMain));
});
check("fork head: capture title / description / language; the archetype's canonical, og:*, twitter:* and JSON-LD gone", () => {
  assert.match(alpha, /<title>Alpha guide<\/title>/); assert.match(alpha, /<meta name="description" content="Alpha description\.">/); assert.ok(!/All guides\./.test(alpha));
  assert.match(alpha, /<html lang="en-GB">/);
  assert.ok(!/href="https:\/\/example\.test\/guides\/"/.test(alpha)); assert.ok(!/og:title|og:image|twitter:/.test(alpha));
  assert.match(alpha, /<link rel="canonical" href="https:\/\/www\.example-live\.test\/guides\/alpha\/">/);
  const ld = ldOf(alpha); assert.equal(ld.length, 1); assert.equal(ld[0]['@type'], 'WebPage'); assert.equal(ld[0].name, 'Alpha guide');
  assert.match(alpha, /^ {2}sourceForked: {5}stardust\/prototypes\/guides-proposed\.html \+ stardust\/current\/pages\/guide-alpha\.json#slots$/m);
});
check('fork sidecar: A′ fields and the driver decisions (archetype-fork, slot-empty, slot-unused, media-unmapped)', () => {
  const m = json(`${OUT}/guides/alpha/_meta.json`);
  assert.equal(m.renderBranch, "A'"); assert.equal(m.template, 'guides'); assert.equal(m.archetypeSource, 'guides'); assert.equal(m.fidelityTier, 'sibling');
  assert.equal(m.metadata.title, 'Alpha guide'); assert.equal(m.metadata.lang, 'en-GB');
  assert.deepEqual(m.migrationDecisions.filter((d) => d._driver), [
    { kind: 'archetype-fork', archetype: 'guides', slots: ['body', 'caption', 'cta', 'deck', 'figure', 'headline', 'lead-image', 'related', 'sidebar', 'tip'], _driver: true },
    { kind: 'slot-empty', slot: 'sidebar', _driver: true },
    { kind: 'slot-unused', slots: ['body-note', 'extra'], _driver: true },
    { kind: 'media-unmapped', ref: 'https://cdn.example.test/fig.jpg', _driver: true },
  ]);
});
check('fork media: ledger contentUrl (srcset kept with sizes), unmapped origin URL kept + decision, alt removed when absent; fewer values trim; link text kept when absent', () => {
  const b = mainOf(read(`${OUT}/guides/beta/index.html`)); const m = json(`${OUT}/guides/beta/_meta.json`);
  assert.match(b, /<img data-slot="lead-image" src="https:\/\/content\.example\.test\/media\/beta\.jpg" srcset="https:\/\/content\.example\.test\/media\/beta\.jpg 1x, https:\/\/media\.example\.test\/beta-2x\.jpg 2x" sizes="100vw" alt="Beta hero">/);
  assert.match(b, /<picture><img src="https:\/\/example\.test\/media\/unknown\.jpg"><\/picture>/);
  assert.ok(!/figcaption/.test(b), 'a null nested slot is removed');
  assert.deepEqual([...b.matchAll(/<li data-slot="tip">(.*?)<\/li>/g)].map((x) => x[1]), ['Only tip']);
  assert.match(b, /<a data-slot="cta" class="button" href="\.\.\/\.\.\/tours\/index\.html">All guides<\/a>/);
  assert.match(b, /<p data-slot="deck"><b>Beta deck<\/b><\/p>/); assert.match(b, /<aside data-slot="sidebar">Beta sidebar<\/aside>/);
  assert.match(read(`${OUT}/guides/beta/index.html`), /<meta name="description" content="Beta from description\.">/);
  assert.deepEqual(m.migrationDecisions.filter((d) => d.kind === 'media-unmapped').map((d) => d.ref), ['https://example.test/media/unknown.jpg', 'https://media.example.test/beta-2x.jpg']);
  assert.deepEqual(m.migrationDecisions.filter((d) => d.kind === 'slot-empty').map((d) => d.slot), ['caption']);
});
check('a fork re-run with the same inputs is unchanged', () => {
  const r = run(['render', 'guide-alpha']); assert.equal(r.status, 0, r.err); assert.match(r.out, /^unchanged guide-alpha → /m);
});
check('an own source file renders A′ from it; --from-archetype forks it anyway (array-form slots, --media-ledger { entries })', () => {
  const own = run(['render', 'guide-gamma']); assert.equal(own.status, 0, own.err);
  assert.match(own.out, /^A' guide-gamma → guides\/gamma\/index\.html {2}\(guide; \d+ assets/m); assert.match(read(`${OUT}/guides/gamma/index.html`), /Gamma own file/);
  write('stardust/deploy/alt-ledger.json', JSON.stringify({ entries: { '/media/gamma.jpg': { status: 'uploaded', source: 'https://media.example.test/gamma.jpg', contentUrl: 'https://content.example.test/media/gamma.jpg' } } }));
  const f = run(['render', 'guide-gamma', '--from-archetype', '--media-ledger', 'stardust/deploy/alt-ledger.json']); assert.equal(f.status, 0, f.err);
  assert.match(f.out, /^A' guide-gamma → guides\/gamma\/index\.html {2}\(guide; fork of guides; /m);
  const g = mainOf(read(`${OUT}/guides/gamma/index.html`));
  assert.ok(!/Gamma own file/.test(g)); assert.match(g, /<h1 data-slot="headline">Gamma<\/h1>/); assert.match(g, /<p data-slot="deck">Gamma deck<\/p>/);
  assert.match(g, /src="https:\/\/content\.example\.test\/media\/gamma\.jpg" alt="Gamma"/);
  assert.deepEqual([...g.matchAll(/<li data-slot="tip">(.*?)<\/li>/g)].map((x) => x[1]), ['G1', 'G2']);
  assert.ok(!/data-slot="figure"|data-slot="caption"/.test(g), 'a removed slot takes its nested slots with it (caption needs no value)');
  const bad = run(['render', 'guide-gamma', '--from-archetype', '--media-map', 'nope.json']); assert.equal(bad.status, 1); assert.match(bad.err, /^usage error: --media-map nope\.json does not exist/);
});
check("the state representative names the archetype (a type with no candidate of its own)", () => {
  const r = run(['render', 'howto-one']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^A' howto-one → howto\/one\/index\.html {2}\(howto; fork of guides; /m); assert.equal(json(`${OUT}/howto/one/_meta.json`).template, 'guides');
});
check('fork refusals: archetype without data-slot, missing slot values (every name listed), archetype without source HTML; nothing written', () => {
  const r = run(['render', 'note-one', 'guide-short', 'guide-orphan']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused note-one: strict slots — archetype notes has no data-slot inside <main>, so a fork would carry the archetype's own content — mark its typed slots \(stardust\/reference\/data-attributes\.md § Slot identity\), or pass --source note-one=<file>$/m);
  assert.match(r.err, /^refused guide-short: strict slots — stardust\/current\/pages\/guide-short\.json#slots has no value for slot\(s\) sidebar, tip of archetype guides — /m);
  assert.match(r.err, /^refused guide-orphan: strict source — archetype guide-draft has no proposed HTML at stardust\/prototypes\/guide-draft-proposed\.html — /m);
  assert.match(r.out, /^rendered 0, unchanged 0, refused 3, passthrough 0 /m);
  for (const p of ['notes/one', 'guides/short', 'guides/orphan']) assert.ok(!has(`${OUT}/${p}/index.html`) && !has(`${OUT}/${p}/_meta.json`), p);
});
check('an explicit --source <slug>=<file> that does not exist is a strict source refusal, never a fork; nothing written', () => {
  const before = [read(`${OUT}/guides/alpha/index.html`), read(`${OUT}/guides/alpha/_meta.json`)];
  const r = run(['render', 'guide-alpha', '--source', 'guide-alpha=stardust/prototypes/nope.html', '--force']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused guide-alpha: strict source — no source HTML at stardust\/prototypes\/nope\.html — pass --source <slug>=<file> or build the page first$/m);
  assert.doesNotMatch(r.out, /fork of/);
  assert.deepEqual([read(`${OUT}/guides/alpha/index.html`), read(`${OUT}/guides/alpha/_meta.json`)], before);
});
check("forkHead (pure): capture text with $ sequences lands verbatim (escaped); the archetype's hreflang alternates go", () => {
  const arch = '<html lang="en"><head><title>Arch</title>\n<meta name="description" content="Arch desc.">\n<link rel="alternate" hreflang="de" href="https://example.test/de/guides/">\n<link rel="alternate" hreflang="x-default" href="https://example.test/guides/">\n<link rel="alternate" type="application/rss+xml" href="/feed.xml">\n<link rel="stylesheet" href="site.css">\n</head><body><main></main></body></html>';
  const h = forkHead(arch, { title: 'Save $$ and $& more', metaDescription: "From $' on" });
  assert.equal(h.slice(h.indexOf('<head>'), h.indexOf('</head>') + 7), '<head><title>Save $$ and $&amp; more</title>\n<meta name="description" content="From $\' on">\n<link rel="alternate" type="application/rss+xml" href="/feed.xml">\n<link rel="stylesheet" href="site.css">\n</head>');
});
check('forkFromArchetype (pure): a value the slot element cannot take is a strict slots refusal', () => {
  assert.throws(() => forkFromArchetype('<html><head><title>t</title></head><body><main><img data-slot="pic" src="a.jpg"><div data-slot="box"><p>x</p></div></main></body></html>', { slots: { pic: 'words', box: { src: '/b.jpg' } } }, { slug: 's', archetype: 'a' }),
    /^Error: refused s: strict slots — slot value\(s\) the archetype a cannot take: pic \(text value on <img>\); box \(image value on <div> without an <img>\) — /);
});
check('forkFromArchetype (pure): inserted HTML maps src / srcset on img, source, video, audio and poster on video only; an <iframe src> keeps its URL', () => {
  const seen = []; const resolveMedia = (ref) => { seen.push(ref); return { ref: `mapped/${ref.split('/').pop()}`, unmapped: null }; };
  const html = '<iframe src="https://video.example.test/embed/1"></iframe><img src="/a.jpg"><video src="/v.mp4" poster="/p.jpg"><source src="/s.webm"></video><audio src="/au.mp3"></audio><div poster="/x.jpg"><embed src="/e.swf"></div>';
  const r = forkFromArchetype('<html><head><title>t</title></head><body><main><div data-slot="body"></div></main></body></html>', { slots: { body: { html } } }, { slug: 's', archetype: 'a', resolveMedia });
  assert.match(r.html, /<div data-slot="body"><iframe src="https:\/\/video\.example\.test\/embed\/1"><\/iframe><img src="mapped\/a\.jpg"><video src="mapped\/v\.mp4" poster="mapped\/p\.jpg"><source src="mapped\/s\.webm"><\/video><audio src="mapped\/au\.mp3"><\/audio><div poster="\/x\.jpg"><embed src="\/e\.swf"><\/div><\/div>/);
  assert.deepEqual(seen.sort(), ['/a.jpg', '/au.mp3', '/p.jpg', '/s.webm', '/v.mp4']);
});

// ---- variance gate: the sibling-variance record gates every A′ page ------------------------------------
console.log('variance gate');
const VAR = 'stardust/rollout/variance/guides.json';
const sib = (slug, verdict, missing = [], extra = []) => ({ slug, url: `https://example.test/guides/${slug}/`, verdict, missing, extra, deltas: [...missing.map((p) => ({ kind: 'missing', probe: p, msg: `${p} absent` })), ...extra.map((p) => ({ kind: 'extra', probe: p, msg: `${p} extra` }))] });
const varDoc = (siblings) => `${JSON.stringify({ template: 'guides', archetype: 'https://example.test/guides/', at: '2026-10-01T00:00:00Z', siblings }, null, 2)}\n`;
write(VAR, varDoc([sib('guide-alpha', 'same'), sib('guide-beta', 'differs', ['hero'], ['card']), sib('guide-gamma', 'same')]));
check('verdict same → recorded (the changed variance record re-renders the page); a page with no row → skipped with the reason', () => {
  const r = run(['render', 'guide-alpha', 'howto-one']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^A' guide-alpha → /m); assert.match(r.out, /^variance: 1 A′ page\(s\) rendered without a variance probe row — recorded as skipped \(howto-one\)$/m);
  assert.deepEqual(json(`${OUT}/guides/alpha/_meta.json`).variance, { verdict: 'same', file: VAR, at: '2026-10-01T00:00:00Z', missing: [], extra: [], deltas: 0, accepted: null });
  assert.deepEqual(json(`${OUT}/howto/one/_meta.json`).variance, { status: 'skipped', reason: `${VAR} has no row for howto-one` });
});
check('verdict differs → strict variance refusal (nothing written) until --accept-variance "<reason>", then recorded as accepted', () => {
  const before = read(`${OUT}/guides/beta/_meta.json`);
  const r = run(['render', 'guide-beta']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused guide-beta: strict variance — the variance probe \(stardust\/rollout\/variance\/guides\.json\) found guide-beta differs from archetype guides: missing \[hero\], extra \[card\], 2 delta\(s\) — check the clone against the archetype and re-run with --accept-variance "<reason>", or re-type it: /m);
  assert.equal(read(`${OUT}/guides/beta/_meta.json`), before);
  const a = run(['render', 'guide-beta', '--accept-variance', 'the hero is a page-level promo']); assert.equal(a.status, 0, a.err); assert.match(a.out, /^A' guide-beta → /m);
  assert.deepEqual(json(`${OUT}/guides/beta/_meta.json`).variance, { verdict: 'differs', file: VAR, at: '2026-10-01T00:00:00Z', missing: ['hero'], extra: ['card'], deltas: 2, accepted: 'the hero is a page-level promo' });
  const again = run(['render', 'guide-beta']); assert.equal(again.status, 2); assert.match(again.err, /--accept-variance "<reason>" \(an earlier render accepted it: "the hero is a page-level promo"\)/);
  const empty = run(['render', 'guide-beta', '--accept-variance', '']); assert.equal(empty.status, 1); assert.match(empty.err, /^usage error: --accept-variance needs a non-empty reason/);
});
check('more than half of the current clones differ → strict variance refusal even with --accept-variance (re-typing named); --variance-dir is honoured', () => {
  write('stardust/alt-variance/guides.json', varDoc([sib('guide-alpha', 'same'), sib('guide-beta', 'differs', ['hero']), sib('guide-gamma', 'differs', [], ['map'])]));
  const r = run(['render', 'guide-beta', '--accept-variance', 'looks fine', '--variance-dir', 'stardust/alt-variance']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused guide-beta: strict variance — 2 of 3 current clone\(s\) of archetype guides differ in stardust\/alt-variance\/guides\.json, so the template does not hold for this group — re-type the template: sub-archetypes by locale family or composition \(state\.mjs set <slug…> --representative <archetype-slug>, then probe the new template with replica\/sibling-variance\.mjs\); the re-typing is recorded as a deviation \(migrate\.mjs decision <slug> --kind re-type …, or deviation\), never a mechanical clone; --accept-variance does not unlock a majority$/m);
  assert.ok(!/a recorded deviation/.test(r.err), 'a recorded deviation is never offered as a way to unlock the page');
  assert.equal(json(`${OUT}/guides/beta/_meta.json`).variance.accepted, 'the hero is a page-level promo', 'nothing written');
  const missingDir = run(['render', 'guide-beta', '--variance-dir', 'nope']); assert.equal(missingDir.status, 1); assert.match(missingDir.err, /^usage error: --variance-dir nope does not exist/);
});
// Rows left behind by siblings that moved to a sub-archetype (and by slugs not in the state) are not current clones.
const s4 = json(STATE);
const frs = ['fr-1', 'fr-2', 'fr-3', 'fr-4', 'fr-5']; const des = ['de-1', 'de-2', 'de-3', 'de-4', 'de-5'];
s4.pages.push(page('city', '/city/', 'approved', 'city'), page('city-fr', '/city/fr/', 'approved', 'city'),
  ...frs.map((s) => page(s, `/city/${s}/`, 'directed', 'city', { representative: 'city' })),
  ...des.map((s, i) => page(s, `/city/${s}/`, 'directed', 'city', i < 2 ? { representative: 'city' } : {})));
write(STATE, `${JSON.stringify(s4, null, 2)}\n`);
write(`${P}/city-proposed.html`, minimal('City')); write(`${P}/city-fr-proposed.html`, minimal('City FR')); write(`${P}/de-1-proposed.html`, minimal('DE one'));
capture('de-1', 'DE one', 'DE one description.');
const citySib = (slug, verdict) => ({ ...sib(slug, verdict, verdict === 'differs' ? ['hero'] : []), url: `https://example.test/city/${slug}/` });
write('stardust/rollout/variance/city.json', `${JSON.stringify({ template: 'city', archetype: 'https://example.test/city/', at: '2026-10-02T00:00:00Z',
  siblings: [...frs.map((s) => citySib(s, 'differs')), ...des.map((s, i) => citySib(s, i < 2 ? 'differs' : 'same')), citySib('gone', 'differs')] }, null, 2)}\n`);
check('the majority counts current clones only: 7 of 10 refused; once the fr-* siblings name a sub-archetype, 2 of 5 → de-1 renders with --accept-variance, refused without', () => {
  const before = run(['render', 'de-1', '--accept-variance', 'the hero is a page-level promo']); assert.equal(before.status, 2);
  assert.match(before.err, /^refused de-1: strict variance — 7 of 10 current clone\(s\) of archetype city differ in stardust\/rollout\/variance\/city\.json, /m, 'a row for a slug not in the state counts on neither side');
  for (const s of s4.pages) if (frs.includes(s.slug)) s.representative = 'city-fr';
  write(STATE, `${JSON.stringify(s4, null, 2)}\n`);
  const plain = run(['render', 'de-1']); assert.equal(plain.status, 2);
  assert.match(plain.err, /^refused de-1: strict variance — the variance probe \(stardust\/rollout\/variance\/city\.json\) found de-1 differs from archetype city: /m);
  assert.ok(!has(`${OUT}/city/de-1/index.html`), 'nothing written');
  const ok = run(['render', 'de-1', '--accept-variance', 'the hero is a page-level promo']); assert.equal(ok.status, 0, ok.err);
  assert.match(ok.out, /^A' de-1 → city\/de-1\/index\.html /m);
  assert.equal(json(`${OUT}/city/de-1/_meta.json`).variance.accepted, 'the hero is a page-level promo');
});
check('--archetype <slug>=<a> makes a row a current clone again (5 of 8 → refused even with --accept-variance)', () => {
  const r = run(['render', 'de-1', '--accept-variance', 'x', '--archetype', 'fr-1=city', '--archetype', 'fr-2=city', '--archetype', 'fr-3=city']); assert.equal(r.status, 2);
  assert.match(r.err, /^refused de-1: strict variance — 5 of 8 current clone\(s\) of archetype city differ in /m);
});

// ---- --help ---------------------------------------------------------------------------------
console.log('--help');
check('--help in an empty cwd: exit 0, usage on stdout, nothing written', () => {
  const empty = mkdtempSync(join(tmpdir(), 'migrate-help-'));
  const r = run(['--help'], empty); assert.equal(r.status, 0); assert.match(r.out, /usage/i); assert.match(r.out, /Writes:/);
  assert.deepEqual(readdirSync(empty), []);
  rmSync(empty, { recursive: true, force: true });
});

// ---- done -----------------------------------------------------------------------------------
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed, ${passed} passed` : `\nall checks passed (${passed})`);
process.exitCode = failed ? 1 : 0;
