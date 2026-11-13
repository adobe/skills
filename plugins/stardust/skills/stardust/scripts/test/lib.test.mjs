#!/usr/bin/env node
// skills/stardust/scripts/test/lib.test.mjs — the shared library's own contract (skills/stardust/scripts/lib/README.md):
// every file is pure ESM with a header that says what it owns; paths.mjs keeps the canonical rules and each named variant
// reproduces its consumer (values from the characterization table); names.mjs applies the widget contract (a stem only
// for /widgets/…, any extension case, .htm included; reserved stems; pageWidgets drops a page link; widgetLinks' three
// mount rules, origin filter and dedupe keys); kinds.mjs classifies documents and chrome; taxonomy.mjs labels every class;
// resolve.mjs names the copy that fixes a missing sibling; contracts.mjs re-exports every lib export (no name lost to a clash).
// The cross-implementation pins live in contracts-characterize.test.mjs; the project-copy layout in layout.test.mjs. Run: node <this file>.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as paths from '../lib/paths.mjs';
import * as names from '../lib/names.mjs';
import * as kinds from '../lib/kinds.mjs';
import * as taxonomy from '../lib/taxonomy.mjs';
import * as resolve from '../lib/resolve.mjs';
import * as contracts from '../contracts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'lib');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('every lib file opens with a header that names what it owns and has no Node I/O import besides resolve.mjs', () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith('.mjs')).sort();
  assert.deepEqual(files, ['kinds.mjs', 'names.mjs', 'paths.mjs', 'resolve.mjs', 'taxonomy.mjs']);
  for (const f of files) {
    const src = readFileSync(join(LIB, f), 'utf8');
    assert.ok(src.startsWith('/**\n * skills/stardust/scripts/lib/'), `${f}: header`);
    assert.match(src.slice(0, 2500), /\bOwns?\b|\bowns\b|one copy/, `${f}: says what it owns`);
    if (f !== 'resolve.mjs') assert.ok(!/from 'node:(fs|child_process)'/.test(src), `${f}: no I/O modules`);
  }
});

// ---- paths.mjs -----------------------------------------------------------------------------------------------------
check('paths: canonical rules unchanged from deploy eds-path.mjs', () => {
  assert.equal(paths.pathKey('/A/index.html?x#f'), '/a'); assert.equal(paths.pathKey('/a/b/'), '/a/b'); assert.equal(paths.pathKey('/widgets/search/site-search.htm'), '/widgets/search/site-search'); assert.equal(paths.pathKey(''), '/');
  assert.equal(paths.deliveredUrl('/a/index.html'), '/a/'); assert.equal(paths.deliveredUrl('/A B/c.html'), '/a-b/c'); assert.equal(paths.deliveredUrl('https://HOST.example/a/b.html?q'), '/https/host-example/a/b');
  assert.equal(paths.daPath('/a/'), '/a/index'); assert.equal(paths.daPath('/'), '/index'); assert.equal(paths.daPath('/a/b'), '/a/b');
});
check('paths: treePath / rosterPath / pathSlug / sidecarName reproduce rollout inventory (and migrate for loose sidecars)', () => {
  assert.equal(paths.treePath('index.html'), '/'); assert.equal(paths.treePath('a/index.html'), '/a'); assert.equal(paths.treePath('a/b.html'), '/a/b'); assert.equal(paths.treePath('A/B/index.html'), '/A/B');
  assert.equal(paths.treePath('a?x=1/index.html'), '/a?x=1', 'keeps query-like characters'); assert.equal(paths.treePath('widgets/search/site-search.htm'), '/widgets/search/site-search.htm', 'only .html is an extension');
  assert.equal(paths.rosterPath('https://h.example/a/b.html'), '/a/b'); assert.equal(paths.rosterPath('/a/'), '/a/'); assert.equal(paths.rosterPath('/a?x=1'), '/a?x=1'); assert.equal(paths.rosterPath('/index'), '/'); assert.equal(paths.rosterPath(''), '/');
  assert.equal(paths.pathSlug('/'), 'home'); assert.equal(paths.pathSlug('/de/x/y/'), 'de-x-y'); assert.equal(paths.pathSlug('/A/B'), 'A-B');
  assert.equal(paths.sidecarName('index.html'), '_meta.json'); assert.equal(paths.sidecarName('a/index.html'), 'a/_meta.json'); assert.equal(paths.sidecarName('a/b.html'), 'a/b._meta.json');
  assert.equal(paths.sidecarName('widgets/search/site-search.htm'), 'widgets/search/site-search.htm._meta.json', 'strict: rollout inventory');
  assert.equal(paths.sidecarName('widgets/search/site-search.htm', { loose: true }), 'widgets/search/site-search._meta.json', 'loose: migrate');
  assert.equal(paths.sidecarName('x.HTML', { loose: true }), 'x._meta.json');
});
check('paths: sitemapKey / servedPath / safePath / documentPath / listing / chromeHrefKey / redirectKey / urlForm reproduce their consumers', () => {
  assert.equal(paths.sitemapKey('/a/index.html'), '/a/index.html'); assert.equal(paths.sitemapKey('/a/b/'), '/a/b'); assert.equal(paths.sitemapKey('/index'), '/'); assert.equal(paths.sitemapKey('/a/index'), '/a'); assert.equal(paths.sitemapKey('/a?x=1'), '/a'); assert.equal(paths.sitemapKey('/A/B'), '/A/B');
  assert.equal(paths.servedPath('/a', { folderIndex: true }), '/a/'); assert.equal(paths.servedPath('/a', { folderIndex: false }), '/a'); assert.equal(paths.servedPath('/', { folderIndex: true }), '/'); assert.equal(paths.servedPath('/a/', { folderIndex: true }), '/a/');
  assert.equal(paths.isFolderIndexFile('a/index.html'), true); assert.equal(paths.isFolderIndexFile('a\\index.html'), true); assert.equal(paths.isFolderIndexFile('a/b.html'), false); assert.equal(paths.isFolderIndexFile(''), false);
  assert.equal(paths.safePath('/A/B'), '/a/b'); assert.equal(paths.safePath('/a/'), '/a'); assert.equal(paths.safePath('/About_Us//x--y-/'), '/about-us/x-y'); assert.equal(paths.safePath('/a/b'), '/a/b'); assert.equal(paths.safePath('https://HOST.example/a/b.html?q'), 'https:/host.example/a/b.html?q');
  assert.equal(paths.documentPath('a/index.html'), '/a/index'); assert.equal(paths.documentPath('a/b.html'), '/a/b'); assert.equal(paths.documentPath('A/B/index.html'), '/A/B/index');
  assert.equal(paths.listingKey('/a/'), '/a'); assert.equal(paths.listingKey('/'), '/'); assert.equal(paths.listingUrl('/a/'), '/a/'); assert.equal(paths.listingUrl('/a'), '/a'); assert.equal(paths.listingUrl('/a/index.html'), '/a/index.html');
  assert.equal(paths.chromeHrefKey('https://HOST.example/a/b.html?q'), '/a/b?q'); assert.equal(paths.chromeHrefKey('/a/index.html'), '/a'); assert.equal(paths.chromeHrefKey('/'), '/'); assert.equal(paths.chromeHrefKey('/A/B/'), '/a/b');
  assert.equal(paths.redirectKey('/a/index.html'), '/a'); assert.equal(paths.redirectKey('/'), ''); assert.equal(paths.redirectKey('/a?x=1'), '/a?x=1'); assert.equal(paths.redirectKey('/A/B'), '/A/B');
  assert.equal(paths.urlForm('index.html'), ''); assert.equal(paths.urlForm('a/index.html'), 'a/'); assert.equal(paths.urlForm('a/b.html'), 'a/b.html');
});

// ---- names.mjs -----------------------------------------------------------------------------------------------------
check('names: RESERVED, edsName, reservedStem as rollout had them', () => {
  assert.deepEqual([...names.RESERVED], ['section', 'block', 'wrap', 'button', 'widget']);
  assert.equal(names.edsName('Hero Banner'), 'hero-banner'); assert.equal(names.edsName('widget'), 'blk-widget'); assert.equal(names.edsName('results-wrapper'), 'results-wrapper-block'); assert.equal(names.edsName('--'), 'blk-block', 'an empty id falls to block, which is reserved');
  assert.equal(names.reservedStem('widget'), true); assert.equal(names.reservedStem('x-container'), true); assert.equal(names.reservedStem('site-search'), false);
});
check('names: widgetStem — only /widgets/<path>/<name>[.ext], extension case-insensitive, .htm included, any origin; else null', () => {
  assert.equal(names.widgetStem('/widgets/search/site-search.html?q=docs'), 'site-search');
  assert.equal(names.widgetStem('/widgets/search/site-search.htm'), 'site-search');
  assert.equal(names.widgetStem('/widgets/x.HTML'), 'x');
  assert.equal(names.widgetStem('/WIDGETS/a/b.html#f'), 'b');
  assert.equal(names.widgetStem('https://partner.example/widgets/map/finder.html'), 'finder');
  assert.equal(names.widgetStem('/widgets/a/results-wrapper.html'), 'results-wrapper');
  for (const notWidget of ['/a/b.html', '/nav', '/widgets/', '/x/widgets/a.html', 'widgets/a.html', '', null, undefined, 42]) assert.equal(names.widgetStem(notWidget), null, `${notWidget}`);
});
check('names: widgetHref (migrate) and widgetCodePath (rollout) unchanged', () => {
  assert.equal(names.widgetHref('search/site-search'), '/widgets/search/site-search.html'); assert.equal(names.widgetHref('/widgets/search/site-search.html'), '/widgets/search/site-search.html');
  assert.equal(names.widgetHref(' map/finder.htm '), '/widgets/map/finder.html'); assert.equal(names.widgetHref('x.HTML'), '/widgets/x.html');
  assert.equal(names.widgetCodePath('/widgets/search/site-search.html?q=docs'), 'widgets/search/site-search.html'); assert.equal(names.widgetCodePath('https://partner.example/widgets/map/finder.html'), 'widgets/map/finder.html'); assert.equal(names.widgetCodePath('/a/b.html'), 'a/b.html');
});
check('names: pageWidgets — stem id, explicit id wins, no href or a page-link href drops the row', () => {
  assert.deepEqual(names.pageWidgets({ widgets: [{ href: '/widgets/search/site-search.html?q=docs' }, { href: '/widgets/x.HTML' }, { href: '/widgets/s/x.htm' }] }).map((w) => w.id), ['site-search', 'x', 'x']);
  assert.deepEqual(names.pageWidgets({ widgets: [{ id: 'given', href: '/widgets/a/b.html' }, { id: 'site-search' }, { href: '/a/b.html' }, { href: '/nav' }, null, 'x'] }), [{ id: 'given', href: '/widgets/a/b.html' }]);
  assert.deepEqual(names.pageWidgets({}), []); assert.deepEqual(names.pageWidgets(null), []);
});
check('names: widgetLinks — lone-paragraph (deploy), any (qa, with origin filter and path dedupe), data-widget (migrate)', () => {
  const p = (h) => `<p><a href="${h}">x</a></p>`;
  assert.deepEqual(names.widgetLinks(p('/widgets/search/site-search.html?q=docs')), [{ name: 'site-search', href: '/widgets/search/site-search.html?q=docs', path: '/widgets/search/site-search.html' }]);
  assert.deepEqual(names.widgetLinks(p('/a/b.html')), []); assert.deepEqual(names.widgetLinks(p('/nav')), []);
  assert.deepEqual(names.widgetLinks('<main><p><a href="/widgets/search/site-search.html">a</a> <a href="/about">b</a></p></main>'), [], 'two links in the paragraph: not a mount');
  assert.deepEqual(names.widgetLinks('<main><p><a data-widget="search/site-search">x</a></p></main>'), [{ name: 'site-search', href: '', path: '' }], 'a data-widget mount without href keeps its name');
  const twoLinks = '<main><p><a href="/widgets/search/site-search.html">a</a> <a href="/about">b</a></p></main>';
  assert.deepEqual(names.widgetLinks(twoLinks, { mount: 'any', dedupeBy: 'path' }), [{ name: 'site-search', href: '/widgets/search/site-search.html', path: '/widgets/search/site-search.html' }], 'served HTML: any anchor');
  const partner = '<a href="https://partner.example/widgets/map/finder.html">x</a>';
  assert.equal(names.widgetLinks(partner, { mount: 'any' })[0].name, 'finder'); assert.deepEqual(names.widgetLinks(partner, { mount: 'any', base: 'https://site.example' }), [], 'another origin is not this site\'s widget');
  assert.equal(names.widgetLinks('<a href="https://site.example/widgets/map/finder.html?a=1&amp;b=2">x</a>', { mount: 'any', base: 'https://site.example/' })[0].href, 'https://site.example/widgets/map/finder.html?a=1&b=2', 'same origin kept, &amp; decoded');
  const twice = '<a href="/widgets/s/x.html?a">1</a><a href="/widgets/s/x.html?b">2</a>';
  assert.equal(names.widgetLinks(twice, { mount: 'any', dedupeBy: 'path' }).length, 1); assert.equal(names.widgetLinks(twice, { mount: 'any', dedupeBy: 'href' }).length, 2);
  assert.deepEqual(names.widgetLinks('<main><p><a data-widget="search/site-search">x</a></p></main>', { mount: 'data-widget' }), [{ name: 'site-search', href: '/widgets/search/site-search.html', path: '/widgets/search/site-search.html' }], 'migrate: the href a data-widget implies');
  assert.deepEqual(names.widgetLinks(twoLinks, { mount: 'data-widget' }), [], 'migrate: only data-widget mounts');
  assert.equal(names.widgetLinks('<a data-widget="w" href="/widgets/x.HTML">x</a>', { mount: 'data-widget' })[0].name, 'x');
});

// ---- kinds.mjs -----------------------------------------------------------------------------------------------------
check('kinds: chrome ids, documentKind, meta blocks, enums, defaults', () => {
  assert.deepEqual([...kinds.CHROME_IDS], ['header', 'nav', 'footer']); assert.equal(kinds.kindOf('Header'), 'chrome'); assert.equal(kinds.kindOf('hero'), 'module');
  assert.equal(kinds.isChromeName('Header'), true); assert.equal(kinds.isChromeName('menu'), false); assert.equal(kinds.isChromeName('/menu'), false);
  assert.equal(kinds.isChromeName('/menu', { menu: true }), true); assert.equal(kinds.isChromeName('/de/nav-de/', { menu: true }), true); assert.equal(kinds.isChromeName('/fragments/x', { menu: true }), false); assert.equal(kinds.isChromeName('/mega-menu', { menu: true }), false);
  assert.deepEqual(kinds.QA_CHROME_PATHS, ['/nav', '/footer']);
  assert.equal(kinds.documentKind('/nav'), 'fragment'); assert.equal(kinds.documentKind('/Footer'), 'fragment'); assert.equal(kinds.documentKind('/header'), 'page', 'delivery-lint: header is not a fragment path');
  assert.equal(kinds.documentKind('/fragments/x'), 'fragment'); assert.equal(kinds.documentKind('/about/nav'), 'page'); assert.equal(kinds.documentKind('/query-index.json'), 'index'); assert.equal(kinds.documentKind('/x.json'), 'index'); assert.equal(kinds.documentKind(''), 'page'); assert.equal(kinds.documentKind(null), 'page');
  assert.deepEqual([...kinds.META_BLOCKS], ['metadata', 'section-metadata']); assert.deepEqual([...kinds.KEY_VALUE_BLOCKS], ['metadata', 'section-metadata', 'library-metadata']); assert.equal(kinds.isMetaBlock('section-metadata'), true); assert.equal(kinds.isMetaBlock('hero'), false);
  assert.equal(kinds.DEFAULT_CONTENT, 'default-content'); assert.deepEqual([...kinds.CODED], ['block', 'dynamic', 'widget']);
  assert.deepEqual(kinds.SPEC_MAP_KINDS, ['block', 'dynamic', 'widget', 'default', 'metadata', 'drop']); assert.deepEqual(kinds.SPEC_CATALOG_KINDS, ['block', 'dynamic', 'global', 'widget']);
  assert.deepEqual(kinds.ROLLOUT_KINDS, ['chrome', 'module', 'section', 'widget']); assert.deepEqual(kinds.DYNAMICS_TARGETS, ['block', 'widget', 'runtime', 'content', 'embed']); assert.deepEqual(kinds.AI_EXCLUDE_DEFAULT, ['client-app', 'widget']);
  assert.deepEqual(JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'rollout', 'schemas', 'rollout-blocks.schema.json'), 'utf8')).$defs.block.properties.kind.enum, kinds.ROLLOUT_KINDS, 'the rollout schema enum is the exported one');
});

// ---- taxonomy.mjs ---------------------------------------------------------------------------------------------------
check('taxonomy: every class has a label and every label a class; dynamics labels are the reference', () => {
  assert.deepEqual(Object.keys(taxonomy.CLASS_NAMES), taxonomy.TAXONOMY.class);
  assert.equal(taxonomy.CLASS_NAMES.A, 'API / personalisation / settings'); assert.equal(taxonomy.CLASS_NAMES.D, 'sheet / data file');
  assert.deepEqual(Object.keys(taxonomy.TAXONOMY), ['class', 'disposition', 'reproducibility', 'status']);
});

// ---- resolve.mjs ----------------------------------------------------------------------------------------------------
check('resolve: plugin layout here; siblings found; a missing one names the copy that fixes it', () => {
  assert.equal(resolve.layout(), 'plugin');
  assert.equal(resolve.siblingPath('deploy', 'eds-path.mjs'), join(HERE, '..', '..', '..', 'deploy', 'scripts', 'eds-path.mjs'));
  assert.equal(resolve.siblingPath('deploy', 'nope.mjs'), null);
  assert.throws(() => resolve.sibling('deploy', 'nope.mjs'), /deploy\/nope\.mjs not found \(looked in .* and .*\): copy the deploy skill's scripts dir to stardust\/scripts\/deploy\//);
  assert.ok(resolve.sibling('deploy', 'eds-path.mjs').startsWith('file://'));
});

// ---- contracts.mjs ---------------------------------------------------------------------------------------------------
check('contracts.mjs re-exports every export of every lib file, the same binding (an `export *` name clash would drop one silently)', () => {
  const all = [paths, names, kinds, taxonomy, resolve].flatMap((m) => Object.keys(m));
  assert.equal(new Set(all).size, all.length, 'two lib files export the same name');
  assert.deepEqual(Object.keys(contracts).sort(), [...all].sort());
  for (const m of [paths, names, kinds, taxonomy, resolve]) for (const k of Object.keys(m)) assert.equal(contracts[k], m[k], k);
});

console.log(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
