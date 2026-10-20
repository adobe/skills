#!/usr/bin/env node
// skills/stardust/scripts/test/contracts-characterize.test.mjs — characterization of every duplicated contract the
// shared-library refactor (notes/refactor-shared-contracts-plan.md, Phase 0 step 1) is about to fold: EDS path
// normalisation, widget stem/href helpers, chrome ids, dynamics class labels, the metadata/section-metadata pair and
// the kind enums. One input table is fed to every existing implementation; the CURRENT outputs are pinned as literal
// tables, and every disagreement between two implementations of the same contract is pinned in KNOWN_DIVERGENCE —
// the refactor must keep both tables byte-identical (a divergence that appears or disappears is a behaviour change).
// Pure: no browser, no network, no node_modules; ~45 child processes of delivery-lint on a temp fixture.
//
// How each implementation is reached:
//   imported          eds-path, localize-links, spec lib (templateOf, CODED), spec-knowledge (needsEntry), qa lib
//                     (buildInventory, pageUrl, plainUrl), qa content (widgetLinks, blockNames), rollout lib, done-check,
//                     seed-redirects, migrate, gate-evidence, block-roundtrip, dynamics lib
//   source-extracted  the verbatim function/literal text is read from the file and evaluated (module-private or in a
//                     script that runs on import): inventory.mjs deliveredPath/urlToDeliveredPath/sidecarFor/pathToSlug,
//                     assemble.mjs normPath, chrome-compare.mjs hrefKey, ai-readability.mjs isChrome, spec lib CHROME,
//                     spec-knowledge k(), dynamics-detect / spec-knowledge CLASS_NAMES, davids-model-lint KEY_VALUE_BLOCKS,
//                     spec-map kind literals
//   re-implemented    deploy-batch.mjs:161-162 webPath (two lines, source-pinned), qa routing.mjs:88 sampling filter
//   spawned           rollout delivery-lint.mjs (--json) on a one-link page per href and on each --path
// Source pins (`pin`) assert the extracted/re-implemented text is still in the file: when Phase 1 swaps an inline rule
// for the shared import, replace that pin with the shared function and keep the expected table unchanged.
//
// Run: node plugins/stardust/skills/stardust/scripts/test/contracts-characterize.test.mjs
//      --print dumps the observed tables + divergences as JSON (paste into EXPECTED / KNOWN_DIVERGENCE only when a
//      behaviour change is intended and reviewed).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, '..', '..', '..');
const at = (rel) => join(SKILLS, rel);
const load = (rel) => import(pathToFileURL(at(rel)).href);
const src = (rel) => readFileSync(at(rel), 'utf8');
const PRINT = process.argv.includes('--print');
let failed = 0;
const check = (name, fn) => { try { fn(); if (!PRINT) console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// --------------------------------------------------------------------------------------------- implementations --
const edsPath = await load('deploy/scripts/eds-path.mjs');
const localize = await load('deploy/scripts/localize-links.mjs');
const specLib = await load('spec/scripts/lib.mjs');
const specKnowledge = await load('spec/scripts/spec-knowledge.mjs');
const qaLib = await load('qa/scripts/lib.mjs');
const qaContent = await load('qa/scripts/checks/content.mjs');
const rollout = await load('rollout/scripts/lib.mjs');
const doneCheck = await load('rollout/scripts/done-check.mjs');
const seed = await load('rollout/scripts/seed-redirects.mjs');
const migrate = await load('migrate/scripts/migrate.mjs');
const gate = await load('replica/scripts/gate-evidence.mjs');
const roundtrip = await load('deploy/scripts/block-roundtrip.mjs');
const dynLib = await load('dynamics/scripts/lib.mjs');

/** The verbatim source text matched by `re` (group 1), evaluated with `scope` in reach. */
function fromSource(rel, re, scope = {}) {
  const m = src(rel).match(re);
  assert.ok(m, `${rel}: ${re} not found — the rule moved; point this test at its new home`);
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(scope), `return (${m[1]});`)(...Object.values(scope));
}
const pin = (rel, snippet) => assert.ok(src(rel).includes(snippet), `${rel} no longer contains the pinned source:\n  ${snippet}`);

// rollout/scripts/inventory.mjs:90-95, 98-103, 106-113, 116-119 — runs on import
const invSidecarFor = fromSource('rollout/scripts/inventory.mjs', /(function sidecarFor\(relHtml\) \{[\s\S]*?\n\})/, { dirname, basename, join });
const invDeliveredPath = fromSource('rollout/scripts/inventory.mjs', /(function deliveredPath\(relHtml\) \{[\s\S]*?\n\})/);
const invUrlToDeliveredPath = fromSource('rollout/scripts/inventory.mjs', /(function urlToDeliveredPath\(url\) \{[\s\S]*?\n\})/);
const invPathToSlug = fromSource('rollout/scripts/inventory.mjs', /(function pathToSlug\(path\) \{[\s\S]*?\n\})/);
// rollout/scripts/assemble.mjs:60-67 — runs on import
const assembleNormPath = fromSource('rollout/scripts/assemble.mjs', /(function normPath\(p\) \{[\s\S]*?\n\})/);
// diff/scripts/chrome-compare.mjs:38-42 — module-private
const chromeCompareHrefKey = fromSource('diff/scripts/chrome-compare.mjs', /const hrefKey = (\(h\) => \{[\s\S]*?\n\});/);
// spec/scripts/spec-knowledge.mjs:114 — the k() inside needsEntry
const specKnowledgeKey = fromSource('spec/scripts/spec-knowledge.mjs', /const k = (\(p\) => String\(p\)[^;]*);/);
// deploy/scripts/ai-readability.mjs:169 — closure-local
const aiReadabilityIsChrome = fromSource('deploy/scripts/ai-readability.mjs', /const isChrome = (\(fp\) => [^;]*);/);
// spec/scripts/lib.mjs:259 — inside genericRules
const specChrome = fromSource('spec/scripts/lib.mjs', /const CHROME = (new Set\(\[[^\]]*\]\));/);
// deploy/scripts/deploy-batch.mjs:161-162 — walkHtml, runs on import; re-implemented, pinned
pin('deploy/scripts/deploy-batch.mjs', "const rel = path.relative(base, full).replace(/\\.html$/, '');");
pin('deploy/scripts/deploy-batch.mjs', 'out.push({ file: full, webPath: `/${rel}` });');
const deployBatchWebPath = (rel) => `/${rel.replace(/\.html$/, '')}`;
// qa/scripts/checks/routing.mjs:88 — the trailing-slash sampling filter; re-implemented, pinned
pin('qa/scripts/checks/routing.mjs', "pages.filter((x) => x.path !== '/' && (x.url || '').endsWith('/'))");
const routingSamples = (x) => x.path !== '/' && (x.url || '').endsWith('/');
// rollout/scripts/seed-redirects.mjs:36 — module-private
const seedPathOf = fromSource('rollout/scripts/seed-redirects.mjs', /const pathOf = (\(u\) => \{[^\n]*\});/);

// ------------------------------------------------------------------------------------------- fixtures + spawns --
const root = mkdtempSync(join(tmpdir(), 'contracts-characterize-'));
const content = join(root, 'content');
for (const f of ['index.html', 'a/index.html', 'a/b.html', 'nav.html', 'footer.html', 'fragments/x.html']) {
  mkdirSync(join(content, dirname(f)), { recursive: true }); writeFileSync(join(content, f), '<html><body><main></main></body></html>');
}
for (const f of ['search/site-search.html', 'a/results-wrapper.html', 'a/widget.html', 'x.HTML']) {
  mkdirSync(join(root, 'widgets', dirname(f)), { recursive: true }); writeFileSync(join(root, 'widgets', f), 'export default function decorate() {}');
}
const LINT = at('rollout/scripts/delivery-lint.mjs');
const pageFile = join(root, 'page.html');
const pageHtml = (inner) => `<html><body><main><h1>t</h1>${inner}<div class="metadata"><div><div>title</div><div>t</div></div></div></main></body></html>`;
function lint(inner, pathArg) {
  writeFileSync(pageFile, pageHtml(inner));
  const r = spawnSync(process.execPath, [LINT, '--file', pageFile, '--path', pathArg, '--content', content, '--json'], { encoding: 'utf8', cwd: root });
  assert.ok(r.stdout, `delivery-lint produced no JSON: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const baseline = lint('', '/page').findings.map((f) => f.rule);
/** Rules a single root-relative link adds over the clean page (multiset difference, sorted). */
const lintLinkRules = (href) => {
  const rules = lint(`<p><a href="${href}">link</a></p>`, '/page').findings.map((f) => f.rule);
  const left = [...baseline];
  return rules.filter((x) => { const i = left.indexOf(x); if (i >= 0) { left.splice(i, 1); return false; } return true; }).sort();
};
/** delivery-lint's reading of a --path: inferred type and the path-safety normalisation it asks for (null = none). */
const lintPath = (p) => {
  const out = lint('', p);
  const ps = out.findings.find((f) => f.rule === 'path-safety' && /normalize /.test(f.msg));
  return { type: out.type, norm: ps ? ps.msg.match(/normalize .* → (.*) \(record/)[1] : null };
};
/** qa lib buildInventory on a one-line paths file (no base → no fetch). */
async function qaRow(p) {
  const f = join(root, 'paths.txt'); writeFileSync(f, `${p}\n`);
  const inv = await qaLib.buildInventory({ pathsFile: f, mergeSitemap: false });
  return { path: inv.pages[0].path, url: inv.pages[0].url, fragments: inv.fragments };
}

// ------------------------------------------------------------------------------------------------- the tables --
const PATHS = ['/', '/a', '/a/', '/a/b', '/a/b/', '/a/index.html', '/a/b.html', '/a?x=1', '/a#f', '/A/B', 'https://HOST.example/a/b.html?q',
  '/widgets/search/site-search.html?q=docs', '/widgets/search/site-search.htm', '/nav', '/footer', '/fragments/x'];
const WIDGETS = ['/widgets/search/site-search.html?q=docs', '/widgets/search/site-search.htm', '/widgets/a/results-wrapper.html', '/widgets/a/widget.html',
  '/widgets/x.HTML', 'https://partner.example/widgets/map/finder.html', '/a/b.html', '/nav'];
const CHROME = ['header', 'nav', 'footer', 'menu', 'Header', 'mega-menu', 'hero'];

const safe = (fn) => { try { return fn(); } catch (e) { return `THROWS ${e.constructor.name}`; } };
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const divergences = [];
/**
 * Run every implementation of one contract over the inputs. `impls`: { col: { label: 'file#fn', fn, compare? } };
 * `ref` names the column every other compared column is held against — a disagreement is one KNOWN_DIVERGENCE row.
 */
function family(concept, inputs, impls, ref = null) {
  const table = {};
  for (const input of inputs) {
    const row = {};
    for (const [id, { fn }] of Object.entries(impls)) row[id] = safe(() => fn(input));
    table[input] = row;
    if (!ref) continue;
    for (const [id, { label, compare }] of Object.entries(impls)) {
      if (id === ref || compare === false || same(row[id], row[ref])) continue;
      divergences.push({ concept, input, a: `${impls[ref].label} → ${show(row[ref])}`, b: `${label} → ${show(row[id])}` });
    }
  }
  return table;
}

const qaRows = new Map(); for (const p of PATHS) qaRows.set(p, await qaRow(p));
const lintPaths = new Map(); for (const p of PATHS) lintPaths.set(p, lintPath(p));
const lintLinks = new Map(); for (const h of [...new Set([...PATHS, ...WIDGETS])].filter((h) => h.startsWith('/'))) lintLinks.set(h, lintLinkRules(h));
const lintChrome = new Map(); for (const id of CHROME) lintChrome.set(id, lint('', `/${id}`).type);
const abs = (p) => (/^https?:/i.test(p) ? p : `https://site.example${p}`);
const outputPath = (p) => migrate.outputPathFor(p).outputPath;
const inventoryRow = (p) => { const op = outputPath(p); return { path: invDeliveredPath(op), slug: invPathToSlug(invDeliveredPath(op)), source: { migratedHtml: op } }; };

const OBSERVED = {};

// 1a. lookup key from a link or URL (no query, .html, /index or trailing slash; root `/`) — reference: eds-path pathKey
OBSERVED.pathKey = family('path-key', PATHS, {
  pathKey: { label: 'deploy/scripts/eds-path.mjs#pathKey', fn: edsPath.pathKey },
  canonicalPath: { label: 'deploy/scripts/localize-links.mjs#canonicalPath', fn: localize.canonicalPath },
  specKnowledgeKey: { label: 'spec/scripts/spec-knowledge.mjs#needsEntry.k', fn: specKnowledgeKey },
  assembleNormPath: { label: 'rollout/scripts/assemble.mjs#normPath', fn: assembleNormPath },
  inventoryUrlToDeliveredPath: { label: 'rollout/scripts/inventory.mjs#urlToDeliveredPath', fn: invUrlToDeliveredPath },
  chromeCompareHrefKey: { label: 'diff/scripts/chrome-compare.mjs#hrefKey', fn: chromeCompareHrefKey },
  qaInventoryPath: { label: 'qa/scripts/lib.mjs#buildInventory.path', fn: (p) => qaRows.get(p).path },
  specTemplateSection: { label: "spec/scripts/lib.mjs#templateOf (section, '/'-prefixed)", fn: (p) => { const s = specLib.templateOf({ url: abs(p), template: null }, { scopePath: '', template: { pathSegments: 9 } }); return s === '(root)' ? '/' : `/${s}`; } },
  seedPathOf: { label: 'rollout/scripts/seed-redirects.mjs#pathOf', fn: seedPathOf, compare: false },
  migratePathnameOf: { label: 'migrate/scripts/migrate.mjs#pathnameOf', fn: migrate.pathnameOf, compare: false },
  sheetMatchable: { label: 'rollout/scripts/seed-redirects.mjs#sheetMatchable', fn: seed.sheetMatchable, compare: false },
}, 'pathKey');

// 1b. the URL EDS serves a page at, read from a path listing (qa's paths file / sitemap) — reference: eds-path deliveredUrl
OBSERVED.servedFromListing = family('served-url-listing', PATHS, {
  deliveredUrl: { label: 'deploy/scripts/eds-path.mjs#deliveredUrl', fn: edsPath.deliveredUrl },
  qaInventoryUrl: { label: 'qa/scripts/lib.mjs#buildInventory.url', fn: (p) => qaRows.get(p).url },
  daPath: { label: 'deploy/scripts/eds-path.mjs#daPath (of deliveredUrl)', fn: (p) => edsPath.daPath(edsPath.deliveredUrl(p)), compare: false },
  qaPlainUrl: { label: 'qa/scripts/lib.mjs#plainUrl (of buildInventory.url)', fn: (p) => qaLib.plainUrl('https://site.example', qaRows.get(p).url), compare: false },
  qaPageUrl: { label: 'qa/scripts/lib.mjs#pageUrl (of buildInventory.path)', fn: (p) => qaLib.pageUrl('https://site.example/', qaRows.get(p).path), compare: false },
  qaRoutingSamplesSlash: { label: 'qa/scripts/checks/routing.mjs#trailing-slash sample', fn: (p) => routingSamples(qaRows.get(p)), compare: false },
}, 'deliveredUrl');

// 1c. the URL EDS serves a page at, read from its file in the migrated/content tree (migrate's outputPath for the input,
//     the one input every implementation here takes) — reference: eds-path deliveredUrl of `/<file>`
OBSERVED.servedFromTree = family('served-url-tree', PATHS, {
  outputPath: { label: 'migrate/scripts/migrate.mjs#outputPathFor', fn: outputPath, compare: false },
  deliveredUrl: { label: 'deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>)', fn: (p) => edsPath.deliveredUrl(`/${outputPath(p)}`) },
  publicUrl: { label: 'rollout/scripts/lib.mjs#publicUrl (inventory row of the file)', fn: (p) => rollout.publicUrl(inventoryRow(p)) },
  doneCheckDeliveredPaths: { label: 'rollout/scripts/done-check.mjs#deliveredPaths', fn: (p) => doneCheck.deliveredPaths([{ ...inventoryRow(p), delivery: { status: 'verified' } }])[0] },
  migrateUrlForm: { label: "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed)", fn: (p) => `/${migrate.urlFormOf(outputPath(p))}` },
}, 'deliveredUrl');

// 1d. the delivered (key) path of a file in the tree — reference: inventory deliveredPath
OBSERVED.tree = family('tree-path', PATHS, {
  inventoryDeliveredPath: { label: 'rollout/scripts/inventory.mjs#deliveredPath', fn: (p) => invDeliveredPath(outputPath(p)) },
  gateDaPath: { label: 'replica/scripts/gate-evidence.mjs#daPath', fn: (p) => gate.daPath(outputPath(p)) },
  pathKeyOfFile: { label: 'deploy/scripts/eds-path.mjs#pathKey (of /<file>)', fn: (p) => edsPath.pathKey(`/${outputPath(p)}`) },
  migrateFoldPath: { label: "migrate/scripts/migrate.mjs#foldPath ('/'-prefixed)", fn: (p) => `/${migrate.foldPath(outputPath(p))}`, compare: false },
  inventorySlug: { label: 'rollout/scripts/inventory.mjs#pathToSlug', fn: (p) => invPathToSlug(invDeliveredPath(outputPath(p))), compare: false },
}, 'inventoryDeliveredPath');
// 1e. the DA document path of a file in the tree (`/a/` → `/a/index`) — reference: eds-path daPath of deliveredUrl
OBSERVED.daDocument = family('da-document-path', PATHS, {
  edsDaPath: { label: 'deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>)', fn: (p) => edsPath.daPath(edsPath.deliveredUrl(`/${outputPath(p)}`)) },
  deployBatchWebPath: { label: 'deploy/scripts/deploy-batch.mjs#walkHtml.webPath', fn: (p) => deployBatchWebPath(outputPath(p)) },
}, 'edsDaPath');
OBSERVED.sidecar = family('sidecar', PATHS, {
  migrateSidecar: { label: 'migrate/scripts/migrate.mjs#sidecarFor', fn: (p) => migrate.sidecarFor(outputPath(p)) },
  inventorySidecar: { label: 'rollout/scripts/inventory.mjs#sidecarFor', fn: (p) => invSidecarFor(outputPath(p)) },
}, 'migrateSidecar');

// 1f. seed-redirects seedRows with eds-path's pathKey injected: which sources become sheet rows, CDN rows, or are dropped
{
  const r = seed.seedRows(PATHS.map((p) => ({ kind: 'migration', src: p, target: '/dest' })), [], [], { pathKey: edsPath.pathKey });
  OBSERVED.seedRows = { rows: r.rows.map((x) => x[0]), cdn: r.cdn.map((x) => x[0]), counts: r.counts };
}

// 1g. delivery-lint's reading of each path as --path (type, path-safety) and as a link (rules fired)
OBSERVED.deliveryLint = family('delivery-lint', PATHS, {
  type: { label: 'rollout/scripts/delivery-lint.mjs#inferType', fn: (p) => lintPaths.get(p).type },
  pathSafety: { label: 'rollout/scripts/delivery-lint.mjs#path-safety norm', fn: (p) => lintPaths.get(p).norm },
  linkRules: { label: 'rollout/scripts/delivery-lint.mjs#link rules', fn: (p) => (lintLinks.has(p) ? lintLinks.get(p) : 'not-root-relative') },
});

// 2. widget stem from a mount href — reference: block-roundtrip widgetStem
const mountP = (h) => `<p><a href="${h}">x</a></p>`;
OBSERVED.widgetStem = family('widget-stem', WIDGETS, {
  widgetStem: { label: 'deploy/scripts/block-roundtrip.mjs#widgetStem', fn: roundtrip.widgetStem },
  roundtripLinks: { label: 'deploy/scripts/block-roundtrip.mjs#widgetLinks.name', fn: (h) => roundtrip.widgetLinks(mountP(h))[0]?.name ?? null },
  rolloutPageWidgets: { label: 'rollout/scripts/lib.mjs#pageWidgets.id', fn: (h) => rollout.pageWidgets({ widgets: [{ href: h }] })[0]?.id ?? null },
  migrateWidgetsIn: { label: 'migrate/scripts/migrate.mjs#widgetsIn.id', fn: (h) => migrate.widgetsIn(`<main><p><a data-widget="w" href="${h}">x</a></p></main>`)[0]?.id ?? null },
  qaWidgetLinks: { label: 'qa/scripts/checks/content.mjs#widgetLinks.name (no base)', fn: (h) => qaContent.widgetLinks(`<a href="${h}">x</a>`)[0]?.name ?? null },
  qaWidgetLinksSameSite: { label: 'qa/scripts/checks/content.mjs#widgetLinks.name (base https://site.example)', fn: (h) => qaContent.widgetLinks(`<a href="${h}">x</a>`, 'https://site.example')[0]?.name ?? null },
  rolloutCodePath: { label: 'rollout/scripts/lib.mjs#widgetCodePath', fn: rollout.widgetCodePath, compare: false },
  qaWidgetPath: { label: 'qa/scripts/checks/content.mjs#widgetLinks.path', fn: (h) => qaContent.widgetLinks(`<a href="${h}">x</a>`)[0]?.path ?? null, compare: false },
  reservedStem: { label: 'rollout/scripts/lib.mjs#reservedStem (of widgetStem)', fn: (h) => rollout.reservedStem(roundtrip.widgetStem(h)), compare: false },
  edsName: { label: 'rollout/scripts/lib.mjs#edsName (of widgetStem)', fn: (h) => rollout.edsName(roundtrip.widgetStem(h)), compare: false },
  lintRules: { label: 'rollout/scripts/delivery-lint.mjs#link rules', fn: (h) => (lintLinks.has(h) ? lintLinks.get(h) : 'not-root-relative'), compare: false },
}, 'widgetStem');
// the mount shapes: a <p> with two links, a data-widget mount without href, and the data-widget → href rule
const twoLinks = '<main><p><a href="/widgets/search/site-search.html">a</a> <a href="/about">b</a></p></main>';
const noHref = '<main><p><a data-widget="search/site-search">x</a></p></main>';
OBSERVED.widgetMounts = {
  twoLinks: {
    roundtrip: roundtrip.widgetLinks(twoLinks), migrate: migrate.widgetsIn(twoLinks), qa: qaContent.widgetLinks(twoLinks),
  },
  noHref: {
    roundtrip: roundtrip.widgetLinks(noHref), migrate: migrate.widgetsIn(noHref), qa: qaContent.widgetLinks(noHref),
    migrateFixed: migrate.fixWidgetMounts(noHref), rolloutPageWidgets: rollout.pageWidgets({ widgets: [{ id: 'site-search' }] }),
  },
  widgetHref: Object.fromEntries(['search/site-search', '/widgets/search/site-search.html', 'widgets/a/widget', 'x.HTML', ' map/finder.htm '].map((v) => [v, migrate.widgetHref(v)])),
  splitWidgets: roundtrip.splitWidgets(['site-search', 'hero', 'cards'], roundtrip.widgetLinks(mountP('/widgets/search/site-search.html?q=docs'))),
};

// 3. chrome ids — reference: rollout CHROME_IDS/kindOf
OBSERVED.chrome = family('chrome-id', CHROME, {
  rollout: { label: 'rollout/scripts/lib.mjs#kindOf', fn: (id) => rollout.kindOf(id) === 'chrome' },
  spec: { label: 'spec/scripts/lib.mjs#genericRules.CHROME', fn: (id) => specChrome.has(id) },
  aiReadability: { label: 'deploy/scripts/ai-readability.mjs#isChrome (of /<id>)', fn: (id) => aiReadabilityIsChrome(`/${id}`) },
  qaFragments: { label: 'qa/scripts/lib.mjs#buildInventory.fragments default (of /<id>)', fn: (id) => qaRows.get('/').fragments.includes(`/${id}`) },
  deliveryLint: { label: 'rollout/scripts/delivery-lint.mjs#inferType (of /<id>) === fragment', fn: (id) => lintChrome.get(id) === 'fragment' },
}, 'rollout');
OBSERVED.chromeSets = {
  rollout: [...rollout.CHROME_IDS], spec: [...specChrome], qaDefault: qaRows.get('/').fragments,
  aiReadabilityOnPaths: Object.fromEntries(PATHS.map((p) => [p, aiReadabilityIsChrome(p)])),
};

// 4. dynamics class labels
const dynClassNames = fromSource('dynamics/scripts/dynamics-detect.mjs', /const CLASS_NAMES = (\{[^\n]*\});/);
const specClassNames = fromSource('spec/scripts/spec-knowledge.mjs', /const CLASS_NAMES = (\{[^\n]*\});/);
OBSERVED.classLabels = family('class-label', [...new Set([...dynLib.TAXONOMY.class, ...Object.keys(dynClassNames), ...Object.keys(specClassNames)])], {
  dynamics: { label: 'dynamics/scripts/dynamics-detect.mjs#CLASS_NAMES', fn: (k) => dynClassNames[k] ?? null },
  spec: { label: 'spec/scripts/spec-knowledge.mjs#CLASS_NAMES', fn: (k) => specClassNames[k] ?? null },
  inTaxonomy: { label: 'dynamics/scripts/lib.mjs#TAXONOMY.class', fn: (k) => dynLib.TAXONOMY.class.includes(k), compare: false },
}, 'dynamics');

// 5. the metadata | section-metadata exclusion pair
OBSERVED.metadataPair = {
  davidsModelLint: [...fromSource('deploy/scripts/davids-model-lint.mjs', /const KEY_VALUE_BLOCKS = (new Set\(\[[^\]]*\]\));/)],
  qaBlockNames: [...qaContent.blockNames([{ children: [{ tag: 'div', cls: 'metadata' }, { tag: 'div', cls: 'section-metadata dark' }, { tag: 'div', cls: 'hero dark' }, { tag: 'div', cls: 'default-content-wrapper' }, { tag: 'p', cls: '' }] }])],
};

// 6. kind enums
const specMapSrc = src('spec/scripts/spec-map.mjs');
OBSERVED.kinds = {
  specCoded: [...specLib.CODED],
  specMapHeader: specMapSrc.match(/with kind\n \* ([a-z|]+) \(/)[1].split('|'),
  specMapNestedKinds: fromSource('spec/scripts/spec-map.mjs', /(\[[^\]]*\])\.includes\(x\.kind\)/),
  specMapKindLiterals: [...new Set([...specMapSrc.matchAll(/kind(?:Of\(\w+\))? === '([a-z-]+)'/g)].map((m) => m[1]))].sort(),
  rolloutSchema: JSON.parse(src('rollout/schemas/rollout-blocks.schema.json')).$defs.block.properties.kind.enum,
  rolloutKindOf: [...new Set(CHROME.map(rollout.kindOf))].sort(),
  rolloutDefaultContent: rollout.DEFAULT_CONTENT,
  specMapDefaultBlock: specMapSrc.match(/block: '(default-content)'/)[1],
};
const setDiff = (concept, aLabel, a, bLabel, b) => {
  for (const x of a) if (!b.includes(x)) divergences.push({ concept, input: x, a: `${aLabel} → ${show(x)}`, b: `${bLabel} → absent` });
  for (const x of b) if (!a.includes(x)) divergences.push({ concept, input: x, a: `${aLabel} → absent`, b: `${bLabel} → ${show(x)}` });
};
setDiff('chrome-set', 'rollout/scripts/lib.mjs#CHROME_IDS', OBSERVED.chromeSets.rollout, 'spec/scripts/lib.mjs#genericRules.CHROME', OBSERVED.chromeSets.spec);
setDiff('chrome-set', 'rollout/scripts/lib.mjs#CHROME_IDS', OBSERVED.chromeSets.rollout, 'qa/scripts/lib.mjs#buildInventory.fragments', OBSERVED.chromeSets.qaDefault.map((p) => p.slice(1)));
setDiff('metadata-pair', 'deploy/scripts/davids-model-lint.mjs#KEY_VALUE_BLOCKS', OBSERVED.metadataPair.davidsModelLint, 'qa/scripts/checks/content.mjs#blockNames excludes', ['metadata', 'section-metadata'].filter((n) => !OBSERVED.metadataPair.qaBlockNames.includes(n)));
setDiff('kind-enum', 'spec/scripts/lib.mjs#CODED', OBSERVED.kinds.specCoded, 'spec/scripts/spec-map.mjs#header kinds', OBSERVED.kinds.specMapHeader);
setDiff('kind-enum', 'spec/scripts/lib.mjs#CODED', OBSERVED.kinds.specCoded, 'spec/scripts/spec-map.mjs#nested kinds', OBSERVED.kinds.specMapNestedKinds);
setDiff('kind-enum', 'spec/scripts/spec-map.mjs#header kinds', OBSERVED.kinds.specMapHeader, 'rollout/schemas/rollout-blocks.schema.json#kind', OBSERVED.kinds.rolloutSchema);
setDiff('kind-enum', 'rollout/schemas/rollout-blocks.schema.json#kind', OBSERVED.kinds.rolloutSchema, 'rollout/scripts/lib.mjs#kindOf values', OBSERVED.kinds.rolloutKindOf);

rmSync(root, { recursive: true, force: true });

if (PRINT) { console.log(JSON.stringify({ OBSERVED, KNOWN_DIVERGENCE: divergences }, null, 1)); process.exit(0); }

// ------------------------------------------------------------------------------------------------- expected --
const EXPECTED = {
  pathKey: {
    "/": {"pathKey": "/", "canonicalPath": "/", "specKnowledgeKey": "", "assembleNormPath": "/", "inventoryUrlToDeliveredPath": "/", "chromeCompareHrefKey": "/", "qaInventoryPath": "/", "specTemplateSection": "/", "seedPathOf": "/", "migratePathnameOf": "/", "sheetMatchable": true},
    "/a": {"pathKey": "/a", "canonicalPath": "/a", "specKnowledgeKey": "/a", "assembleNormPath": "/a", "inventoryUrlToDeliveredPath": "/a", "chromeCompareHrefKey": "/a", "qaInventoryPath": "/a", "specTemplateSection": "/a", "seedPathOf": "/a", "migratePathnameOf": "/a", "sheetMatchable": true},
    "/a/": {"pathKey": "/a", "canonicalPath": "/a", "specKnowledgeKey": "/a", "assembleNormPath": "/a", "inventoryUrlToDeliveredPath": "/a/", "chromeCompareHrefKey": "/a", "qaInventoryPath": "/a", "specTemplateSection": "/a", "seedPathOf": "/a/", "migratePathnameOf": "/a/", "sheetMatchable": true},
    "/a/b": {"pathKey": "/a/b", "canonicalPath": "/a/b", "specKnowledgeKey": "/a/b", "assembleNormPath": "/a/b", "inventoryUrlToDeliveredPath": "/a/b", "chromeCompareHrefKey": "/a/b", "qaInventoryPath": "/a/b", "specTemplateSection": "/a/b", "seedPathOf": "/a/b", "migratePathnameOf": "/a/b", "sheetMatchable": true},
    "/a/b/": {"pathKey": "/a/b", "canonicalPath": "/a/b", "specKnowledgeKey": "/a/b", "assembleNormPath": "/a/b", "inventoryUrlToDeliveredPath": "/a/b/", "chromeCompareHrefKey": "/a/b", "qaInventoryPath": "/a/b", "specTemplateSection": "/a/b", "seedPathOf": "/a/b/", "migratePathnameOf": "/a/b/", "sheetMatchable": true},
    "/a/index.html": {"pathKey": "/a", "canonicalPath": "/a", "specKnowledgeKey": "/a", "assembleNormPath": "/a/index.html", "inventoryUrlToDeliveredPath": "/a", "chromeCompareHrefKey": "/a", "qaInventoryPath": "/a/index.html", "specTemplateSection": "/a/index", "seedPathOf": "/a/index.html", "migratePathnameOf": "/a/index.html", "sheetMatchable": true},
    "/a/b.html": {"pathKey": "/a/b", "canonicalPath": "/a/b", "specKnowledgeKey": "/a/b", "assembleNormPath": "/a/b.html", "inventoryUrlToDeliveredPath": "/a/b", "chromeCompareHrefKey": "/a/b", "qaInventoryPath": "/a/b.html", "specTemplateSection": "/a/b", "seedPathOf": "/a/b.html", "migratePathnameOf": "/a/b.html", "sheetMatchable": true},
    "/a?x=1": {"pathKey": "/a", "canonicalPath": "/a", "specKnowledgeKey": "/a?x=1", "assembleNormPath": "/a", "inventoryUrlToDeliveredPath": "/a?x=1", "chromeCompareHrefKey": "/a?x=1", "qaInventoryPath": "/a?x=1", "specTemplateSection": "/a", "seedPathOf": "/a?x=1", "migratePathnameOf": "/a", "sheetMatchable": false},
    "/a#f": {"pathKey": "/a", "canonicalPath": "/a", "specKnowledgeKey": "/a#f", "assembleNormPath": "/a", "inventoryUrlToDeliveredPath": "/a#f", "chromeCompareHrefKey": "/a", "qaInventoryPath": "/a#f", "specTemplateSection": "/a", "seedPathOf": "/a#f", "migratePathnameOf": "/a", "sheetMatchable": false},
    "/A/B": {"pathKey": "/a/b", "canonicalPath": "/a/b", "specKnowledgeKey": "/A/B", "assembleNormPath": "/A/B", "inventoryUrlToDeliveredPath": "/A/B", "chromeCompareHrefKey": "/a/b", "qaInventoryPath": "/A/B", "specTemplateSection": "/A/B", "seedPathOf": "/A/B", "migratePathnameOf": "/A/B", "sheetMatchable": true},
    "https://HOST.example/a/b.html?q": {"pathKey": "/https:/host.example/a/b", "canonicalPath": "/https:/host.example/a/b", "specKnowledgeKey": "https://HOST.example/a/b.html?q", "assembleNormPath": "/https://HOST.example/a/b.html", "inventoryUrlToDeliveredPath": "/a/b", "chromeCompareHrefKey": "/a/b?q", "qaInventoryPath": "/https://HOST.example/a/b.html?q", "specTemplateSection": "/a/b", "seedPathOf": "/a/b.html", "migratePathnameOf": "/a/b.html", "sheetMatchable": false},
    "/widgets/search/site-search.html?q=docs": {"pathKey": "/widgets/search/site-search", "canonicalPath": "/widgets/search/site-search", "specKnowledgeKey": "/widgets/search/site-search.html?q=docs", "assembleNormPath": "/widgets/search/site-search.html", "inventoryUrlToDeliveredPath": "/widgets/search/site-search.html?q=docs", "chromeCompareHrefKey": "/widgets/search/site-search?q=docs", "qaInventoryPath": "/widgets/search/site-search.html?q=docs", "specTemplateSection": "/widgets/search/site-search", "seedPathOf": "/widgets/search/site-search.html?q=docs", "migratePathnameOf": "/widgets/search/site-search.html", "sheetMatchable": false},
    "/widgets/search/site-search.htm": {"pathKey": "/widgets/search/site-search", "canonicalPath": "/widgets/search/site-search", "specKnowledgeKey": "/widgets/search/site-search.htm", "assembleNormPath": "/widgets/search/site-search.htm", "inventoryUrlToDeliveredPath": "/widgets/search/site-search.htm", "chromeCompareHrefKey": "/widgets/search/site-search", "qaInventoryPath": "/widgets/search/site-search.htm", "specTemplateSection": "/widgets/search/site-search", "seedPathOf": "/widgets/search/site-search.htm", "migratePathnameOf": "/widgets/search/site-search.htm", "sheetMatchable": true},
    "/nav": {"pathKey": "/nav", "canonicalPath": "/nav", "specKnowledgeKey": "/nav", "assembleNormPath": "/nav", "inventoryUrlToDeliveredPath": "/nav", "chromeCompareHrefKey": "/nav", "qaInventoryPath": "/nav", "specTemplateSection": "/nav", "seedPathOf": "/nav", "migratePathnameOf": "/nav", "sheetMatchable": true},
    "/footer": {"pathKey": "/footer", "canonicalPath": "/footer", "specKnowledgeKey": "/footer", "assembleNormPath": "/footer", "inventoryUrlToDeliveredPath": "/footer", "chromeCompareHrefKey": "/footer", "qaInventoryPath": "/footer", "specTemplateSection": "/footer", "seedPathOf": "/footer", "migratePathnameOf": "/footer", "sheetMatchable": true},
    "/fragments/x": {"pathKey": "/fragments/x", "canonicalPath": "/fragments/x", "specKnowledgeKey": "/fragments/x", "assembleNormPath": "/fragments/x", "inventoryUrlToDeliveredPath": "/fragments/x", "chromeCompareHrefKey": "/fragments/x", "qaInventoryPath": "/fragments/x", "specTemplateSection": "/fragments/x", "seedPathOf": "/fragments/x", "migratePathnameOf": "/fragments/x", "sheetMatchable": true}
  },
  servedFromListing: {
    "/": {"deliveredUrl": "/", "qaInventoryUrl": "/", "daPath": "/index", "qaPlainUrl": "https://site.example/index.plain.html", "qaPageUrl": "https://site.example/", "qaRoutingSamplesSlash": false},
    "/a": {"deliveredUrl": "/a", "qaInventoryUrl": "/a", "daPath": "/a", "qaPlainUrl": "https://site.example/a.plain.html", "qaPageUrl": "https://site.example/a", "qaRoutingSamplesSlash": false},
    "/a/": {"deliveredUrl": "/a/", "qaInventoryUrl": "/a/", "daPath": "/a/index", "qaPlainUrl": "https://site.example/a/index.plain.html", "qaPageUrl": "https://site.example/a", "qaRoutingSamplesSlash": true},
    "/a/b": {"deliveredUrl": "/a/b", "qaInventoryUrl": "/a/b", "daPath": "/a/b", "qaPlainUrl": "https://site.example/a/b.plain.html", "qaPageUrl": "https://site.example/a/b", "qaRoutingSamplesSlash": false},
    "/a/b/": {"deliveredUrl": "/a/b/", "qaInventoryUrl": "/a/b/", "daPath": "/a/b/index", "qaPlainUrl": "https://site.example/a/b/index.plain.html", "qaPageUrl": "https://site.example/a/b", "qaRoutingSamplesSlash": true},
    "/a/index.html": {"deliveredUrl": "/a/", "qaInventoryUrl": "/a/index.html", "daPath": "/a/index", "qaPlainUrl": "https://site.example/a/index.html.plain.html", "qaPageUrl": "https://site.example/a/index.html", "qaRoutingSamplesSlash": false},
    "/a/b.html": {"deliveredUrl": "/a/b", "qaInventoryUrl": "/a/b.html", "daPath": "/a/b", "qaPlainUrl": "https://site.example/a/b.html.plain.html", "qaPageUrl": "https://site.example/a/b.html", "qaRoutingSamplesSlash": false},
    "/a?x=1": {"deliveredUrl": "/a", "qaInventoryUrl": "/a?x=1", "daPath": "/a", "qaPlainUrl": "https://site.example/a?x=1.plain.html", "qaPageUrl": "https://site.example/a?x=1", "qaRoutingSamplesSlash": false},
    "/a#f": {"deliveredUrl": "/a", "qaInventoryUrl": "/a#f", "daPath": "/a", "qaPlainUrl": "https://site.example/a#f.plain.html", "qaPageUrl": "https://site.example/a#f", "qaRoutingSamplesSlash": false},
    "/A/B": {"deliveredUrl": "/a/b", "qaInventoryUrl": "/A/B", "daPath": "/a/b", "qaPlainUrl": "https://site.example/A/B.plain.html", "qaPageUrl": "https://site.example/A/B", "qaRoutingSamplesSlash": false},
    "https://HOST.example/a/b.html?q": {"deliveredUrl": "/https/host-example/a/b", "qaInventoryUrl": "/https://HOST.example/a/b.html?q", "daPath": "/https/host-example/a/b", "qaPlainUrl": "https://site.example/https://HOST.example/a/b.html?q.plain.html", "qaPageUrl": "https://site.example/https://HOST.example/a/b.html?q", "qaRoutingSamplesSlash": false},
    "/widgets/search/site-search.html?q=docs": {"deliveredUrl": "/widgets/search/site-search", "qaInventoryUrl": "/widgets/search/site-search.html?q=docs", "daPath": "/widgets/search/site-search", "qaPlainUrl": "https://site.example/widgets/search/site-search.html?q=docs.plain.html", "qaPageUrl": "https://site.example/widgets/search/site-search.html?q=docs", "qaRoutingSamplesSlash": false},
    "/widgets/search/site-search.htm": {"deliveredUrl": "/widgets/search/site-search", "qaInventoryUrl": "/widgets/search/site-search.htm", "daPath": "/widgets/search/site-search", "qaPlainUrl": "https://site.example/widgets/search/site-search.htm.plain.html", "qaPageUrl": "https://site.example/widgets/search/site-search.htm", "qaRoutingSamplesSlash": false},
    "/nav": {"deliveredUrl": "/nav", "qaInventoryUrl": "/nav", "daPath": "/nav", "qaPlainUrl": "https://site.example/nav.plain.html", "qaPageUrl": "https://site.example/nav", "qaRoutingSamplesSlash": false},
    "/footer": {"deliveredUrl": "/footer", "qaInventoryUrl": "/footer", "daPath": "/footer", "qaPlainUrl": "https://site.example/footer.plain.html", "qaPageUrl": "https://site.example/footer", "qaRoutingSamplesSlash": false},
    "/fragments/x": {"deliveredUrl": "/fragments/x", "qaInventoryUrl": "/fragments/x", "daPath": "/fragments/x", "qaPlainUrl": "https://site.example/fragments/x.plain.html", "qaPageUrl": "https://site.example/fragments/x", "qaRoutingSamplesSlash": false}
  },
  servedFromTree: {
    "/": {"outputPath": "index.html", "deliveredUrl": "/", "publicUrl": "/", "doneCheckDeliveredPaths": "/", "migrateUrlForm": "/"},
    "/a": {"outputPath": "a/index.html", "deliveredUrl": "/a/", "publicUrl": "/a/", "doneCheckDeliveredPaths": "/a/", "migrateUrlForm": "/a/"},
    "/a/": {"outputPath": "a/index.html", "deliveredUrl": "/a/", "publicUrl": "/a/", "doneCheckDeliveredPaths": "/a/", "migrateUrlForm": "/a/"},
    "/a/b": {"outputPath": "a/b/index.html", "deliveredUrl": "/a/b/", "publicUrl": "/a/b/", "doneCheckDeliveredPaths": "/a/b/", "migrateUrlForm": "/a/b/"},
    "/a/b/": {"outputPath": "a/b/index.html", "deliveredUrl": "/a/b/", "publicUrl": "/a/b/", "doneCheckDeliveredPaths": "/a/b/", "migrateUrlForm": "/a/b/"},
    "/a/index.html": {"outputPath": "a/index.html", "deliveredUrl": "/a/", "publicUrl": "/a/", "doneCheckDeliveredPaths": "/a/", "migrateUrlForm": "/a/"},
    "/a/b.html": {"outputPath": "a/b.html", "deliveredUrl": "/a/b", "publicUrl": "/a/b", "doneCheckDeliveredPaths": "/a/b", "migrateUrlForm": "/a/b.html"},
    "/a?x=1": {"outputPath": "a?x=1/index.html", "deliveredUrl": "/a", "publicUrl": "/a?x=1/", "doneCheckDeliveredPaths": "/a?x=1/", "migrateUrlForm": "/a?x=1/"},
    "/a#f": {"outputPath": "a#f/index.html", "deliveredUrl": "/a", "publicUrl": "/a#f/", "doneCheckDeliveredPaths": "/a#f/", "migrateUrlForm": "/a#f/"},
    "/A/B": {"outputPath": "A/B/index.html", "deliveredUrl": "/a/b/", "publicUrl": "/A/B/", "doneCheckDeliveredPaths": "/A/B/", "migrateUrlForm": "/A/B/"},
    "https://HOST.example/a/b.html?q": {"outputPath": "a/b.html", "deliveredUrl": "/a/b", "publicUrl": "/a/b", "doneCheckDeliveredPaths": "/a/b", "migrateUrlForm": "/a/b.html"},
    "/widgets/search/site-search.html?q=docs": {"outputPath": "widgets/search/site-search.html?q=docs/index.html", "deliveredUrl": "/widgets/search/site-search", "publicUrl": "/widgets/search/site-search.html?q=docs/", "doneCheckDeliveredPaths": "/widgets/search/site-search.html?q=docs/", "migrateUrlForm": "/widgets/search/site-search.html?q=docs/"},
    "/widgets/search/site-search.htm": {"outputPath": "widgets/search/site-search.htm", "deliveredUrl": "/widgets/search/site-search", "publicUrl": "/widgets/search/site-search.htm", "doneCheckDeliveredPaths": "/widgets/search/site-search.htm", "migrateUrlForm": "/widgets/search/site-search.htm"},
    "/nav": {"outputPath": "nav/index.html", "deliveredUrl": "/nav/", "publicUrl": "/nav/", "doneCheckDeliveredPaths": "/nav/", "migrateUrlForm": "/nav/"},
    "/footer": {"outputPath": "footer/index.html", "deliveredUrl": "/footer/", "publicUrl": "/footer/", "doneCheckDeliveredPaths": "/footer/", "migrateUrlForm": "/footer/"},
    "/fragments/x": {"outputPath": "fragments/x/index.html", "deliveredUrl": "/fragments/x/", "publicUrl": "/fragments/x/", "doneCheckDeliveredPaths": "/fragments/x/", "migrateUrlForm": "/fragments/x/"}
  },
  tree: {
    "/": {"inventoryDeliveredPath": "/", "gateDaPath": "/", "pathKeyOfFile": "/", "migrateFoldPath": "/index.html", "inventorySlug": "home"},
    "/a": {"inventoryDeliveredPath": "/a", "gateDaPath": "/a", "pathKeyOfFile": "/a", "migrateFoldPath": "/a/index.html", "inventorySlug": "a"},
    "/a/": {"inventoryDeliveredPath": "/a", "gateDaPath": "/a", "pathKeyOfFile": "/a", "migrateFoldPath": "/a/index.html", "inventorySlug": "a"},
    "/a/b": {"inventoryDeliveredPath": "/a/b", "gateDaPath": "/a/b", "pathKeyOfFile": "/a/b", "migrateFoldPath": "/a/b/index.html", "inventorySlug": "a-b"},
    "/a/b/": {"inventoryDeliveredPath": "/a/b", "gateDaPath": "/a/b", "pathKeyOfFile": "/a/b", "migrateFoldPath": "/a/b/index.html", "inventorySlug": "a-b"},
    "/a/index.html": {"inventoryDeliveredPath": "/a", "gateDaPath": "/a", "pathKeyOfFile": "/a", "migrateFoldPath": "/a/index.html", "inventorySlug": "a"},
    "/a/b.html": {"inventoryDeliveredPath": "/a/b", "gateDaPath": "/a/b", "pathKeyOfFile": "/a/b", "migrateFoldPath": "/a/b.html", "inventorySlug": "a-b"},
    "/a?x=1": {"inventoryDeliveredPath": "/a?x=1", "gateDaPath": "/a?x=1", "pathKeyOfFile": "/a", "migrateFoldPath": "/a-x-1/index.html", "inventorySlug": "a?x=1"},
    "/a#f": {"inventoryDeliveredPath": "/a#f", "gateDaPath": "/a#f", "pathKeyOfFile": "/a", "migrateFoldPath": "/a-f/index.html", "inventorySlug": "a#f"},
    "/A/B": {"inventoryDeliveredPath": "/A/B", "gateDaPath": "/A/B", "pathKeyOfFile": "/a/b", "migrateFoldPath": "/a/b/index.html", "inventorySlug": "A-B"},
    "https://HOST.example/a/b.html?q": {"inventoryDeliveredPath": "/a/b", "gateDaPath": "/a/b", "pathKeyOfFile": "/a/b", "migrateFoldPath": "/a/b.html", "inventorySlug": "a-b"},
    "/widgets/search/site-search.html?q=docs": {"inventoryDeliveredPath": "/widgets/search/site-search.html?q=docs", "gateDaPath": "/widgets/search/site-search.html?q=docs", "pathKeyOfFile": "/widgets/search/site-search", "migrateFoldPath": "/widgets/search/site-search.html-q-docs/index.html", "inventorySlug": "widgets-search-site-search.html?q=docs"},
    "/widgets/search/site-search.htm": {"inventoryDeliveredPath": "/widgets/search/site-search.htm", "gateDaPath": "/widgets/search/site-search.htm", "pathKeyOfFile": "/widgets/search/site-search", "migrateFoldPath": "/widgets/search/site-search.htm", "inventorySlug": "widgets-search-site-search.htm"},
    "/nav": {"inventoryDeliveredPath": "/nav", "gateDaPath": "/nav", "pathKeyOfFile": "/nav", "migrateFoldPath": "/nav/index.html", "inventorySlug": "nav"},
    "/footer": {"inventoryDeliveredPath": "/footer", "gateDaPath": "/footer", "pathKeyOfFile": "/footer", "migrateFoldPath": "/footer/index.html", "inventorySlug": "footer"},
    "/fragments/x": {"inventoryDeliveredPath": "/fragments/x", "gateDaPath": "/fragments/x", "pathKeyOfFile": "/fragments/x", "migrateFoldPath": "/fragments/x/index.html", "inventorySlug": "fragments-x"}
  },
  daDocument: {
    "/": {"edsDaPath": "/index", "deployBatchWebPath": "/index"},
    "/a": {"edsDaPath": "/a/index", "deployBatchWebPath": "/a/index"},
    "/a/": {"edsDaPath": "/a/index", "deployBatchWebPath": "/a/index"},
    "/a/b": {"edsDaPath": "/a/b/index", "deployBatchWebPath": "/a/b/index"},
    "/a/b/": {"edsDaPath": "/a/b/index", "deployBatchWebPath": "/a/b/index"},
    "/a/index.html": {"edsDaPath": "/a/index", "deployBatchWebPath": "/a/index"},
    "/a/b.html": {"edsDaPath": "/a/b", "deployBatchWebPath": "/a/b"},
    "/a?x=1": {"edsDaPath": "/a", "deployBatchWebPath": "/a?x=1/index"},
    "/a#f": {"edsDaPath": "/a", "deployBatchWebPath": "/a#f/index"},
    "/A/B": {"edsDaPath": "/a/b/index", "deployBatchWebPath": "/A/B/index"},
    "https://HOST.example/a/b.html?q": {"edsDaPath": "/a/b", "deployBatchWebPath": "/a/b"},
    "/widgets/search/site-search.html?q=docs": {"edsDaPath": "/widgets/search/site-search", "deployBatchWebPath": "/widgets/search/site-search.html?q=docs/index"},
    "/widgets/search/site-search.htm": {"edsDaPath": "/widgets/search/site-search", "deployBatchWebPath": "/widgets/search/site-search.htm"},
    "/nav": {"edsDaPath": "/nav/index", "deployBatchWebPath": "/nav/index"},
    "/footer": {"edsDaPath": "/footer/index", "deployBatchWebPath": "/footer/index"},
    "/fragments/x": {"edsDaPath": "/fragments/x/index", "deployBatchWebPath": "/fragments/x/index"}
  },
  sidecar: {
    "/": {"migrateSidecar": "_meta.json", "inventorySidecar": "_meta.json"},
    "/a": {"migrateSidecar": "a/_meta.json", "inventorySidecar": "a/_meta.json"},
    "/a/": {"migrateSidecar": "a/_meta.json", "inventorySidecar": "a/_meta.json"},
    "/a/b": {"migrateSidecar": "a/b/_meta.json", "inventorySidecar": "a/b/_meta.json"},
    "/a/b/": {"migrateSidecar": "a/b/_meta.json", "inventorySidecar": "a/b/_meta.json"},
    "/a/index.html": {"migrateSidecar": "a/_meta.json", "inventorySidecar": "a/_meta.json"},
    "/a/b.html": {"migrateSidecar": "a/b._meta.json", "inventorySidecar": "a/b._meta.json"},
    "/a?x=1": {"migrateSidecar": "a?x=1/_meta.json", "inventorySidecar": "a?x=1/_meta.json"},
    "/a#f": {"migrateSidecar": "a#f/_meta.json", "inventorySidecar": "a#f/_meta.json"},
    "/A/B": {"migrateSidecar": "A/B/_meta.json", "inventorySidecar": "A/B/_meta.json"},
    "https://HOST.example/a/b.html?q": {"migrateSidecar": "a/b._meta.json", "inventorySidecar": "a/b._meta.json"},
    "/widgets/search/site-search.html?q=docs": {"migrateSidecar": "widgets/search/site-search.html?q=docs/_meta.json", "inventorySidecar": "widgets/search/site-search.html?q=docs/_meta.json"},
    "/widgets/search/site-search.htm": {"migrateSidecar": "widgets/search/site-search._meta.json", "inventorySidecar": "widgets/search/site-search.htm._meta.json"},
    "/nav": {"migrateSidecar": "nav/_meta.json", "inventorySidecar": "nav/_meta.json"},
    "/footer": {"migrateSidecar": "footer/_meta.json", "inventorySidecar": "footer/_meta.json"},
    "/fragments/x": {"migrateSidecar": "fragments/x/_meta.json", "inventorySidecar": "fragments/x/_meta.json"}
  },
  seedRows: {"rows": ["/", "/a", "/a/b", "/nav", "/footer", "/fragments/x"], "cdn": ["https://HOST.example/a/b.html?q", "/widgets/search/site-search.html?q=docs"], "counts": {"migration": 6, "legacy": 0, "present": 8, "external": 0, "not-a-page": 0, "loop": 0, "cdn": 2, "later-wave": 0}},
  deliveryLint: {
    "/": {"type": "page", "pathSafety": null, "linkRules": []},
    "/a": {"type": "page", "pathSafety": null, "linkRules": ["folder-index-slash"]},
    "/a/": {"type": "page", "pathSafety": "/a", "linkRules": []},
    "/a/b": {"type": "page", "pathSafety": null, "linkRules": []},
    "/a/b/": {"type": "page", "pathSafety": "/a/b", "linkRules": ["trailing-slash"]},
    "/a/index.html": {"type": "page", "pathSafety": null, "linkRules": ["html-extension"]},
    "/a/b.html": {"type": "page", "pathSafety": null, "linkRules": ["html-extension"]},
    "/a?x=1": {"type": "page", "pathSafety": null, "linkRules": ["folder-index-slash"]},
    "/a#f": {"type": "page", "pathSafety": null, "linkRules": ["folder-index-slash"]},
    "/A/B": {"type": "page", "pathSafety": "/a/b", "linkRules": []},
    "https://HOST.example/a/b.html?q": {"type": "page", "pathSafety": "https:/host.example/a/b.html?q", "linkRules": "not-root-relative"},
    "/widgets/search/site-search.html?q=docs": {"type": "page", "pathSafety": null, "linkRules": []},
    "/widgets/search/site-search.htm": {"type": "page", "pathSafety": null, "linkRules": []},
    "/nav": {"type": "fragment", "pathSafety": null, "linkRules": []},
    "/footer": {"type": "fragment", "pathSafety": null, "linkRules": []},
    "/fragments/x": {"type": "fragment", "pathSafety": null, "linkRules": []}
  },
  widgetStem: {
    "/widgets/search/site-search.html?q=docs": {"widgetStem": "site-search", "roundtripLinks": "site-search", "rolloutPageWidgets": "site-search", "migrateWidgetsIn": "site-search", "qaWidgetLinks": "site-search", "qaWidgetLinksSameSite": "site-search", "rolloutCodePath": "widgets/search/site-search.html", "qaWidgetPath": "/widgets/search/site-search.html", "reservedStem": false, "edsName": "site-search", "lintRules": []},
    "/widgets/search/site-search.htm": {"widgetStem": "site-search", "roundtripLinks": "site-search", "rolloutPageWidgets": "site-search.htm", "migrateWidgetsIn": "site-search", "qaWidgetLinks": null, "qaWidgetLinksSameSite": null, "rolloutCodePath": "widgets/search/site-search.htm", "qaWidgetPath": null, "reservedStem": false, "edsName": "site-search", "lintRules": []},
    "/widgets/a/results-wrapper.html": {"widgetStem": "results-wrapper", "roundtripLinks": "results-wrapper", "rolloutPageWidgets": "results-wrapper", "migrateWidgetsIn": "results-wrapper", "qaWidgetLinks": "results-wrapper", "qaWidgetLinksSameSite": "results-wrapper", "rolloutCodePath": "widgets/a/results-wrapper.html", "qaWidgetPath": "/widgets/a/results-wrapper.html", "reservedStem": true, "edsName": "results-wrapper-block", "lintRules": ["widget-name"]},
    "/widgets/a/widget.html": {"widgetStem": "widget", "roundtripLinks": "widget", "rolloutPageWidgets": "widget", "migrateWidgetsIn": "widget", "qaWidgetLinks": "widget", "qaWidgetLinksSameSite": "widget", "rolloutCodePath": "widgets/a/widget.html", "qaWidgetPath": "/widgets/a/widget.html", "reservedStem": true, "edsName": "blk-widget", "lintRules": ["widget-name"]},
    "/widgets/x.HTML": {"widgetStem": "x", "roundtripLinks": "x", "rolloutPageWidgets": "x.HTML", "migrateWidgetsIn": "x", "qaWidgetLinks": "x", "qaWidgetLinksSameSite": "x", "rolloutCodePath": "widgets/x.HTML", "qaWidgetPath": "/widgets/x.HTML", "reservedStem": false, "edsName": "x", "lintRules": []},
    "https://partner.example/widgets/map/finder.html": {"widgetStem": "finder", "roundtripLinks": "finder", "rolloutPageWidgets": "finder", "migrateWidgetsIn": "finder", "qaWidgetLinks": "finder", "qaWidgetLinksSameSite": null, "rolloutCodePath": "widgets/map/finder.html", "qaWidgetPath": "/widgets/map/finder.html", "reservedStem": false, "edsName": "finder", "lintRules": "not-root-relative"},
    "/a/b.html": {"widgetStem": null, "roundtripLinks": null, "rolloutPageWidgets": "b", "migrateWidgetsIn": "b", "qaWidgetLinks": null, "qaWidgetLinksSameSite": null, "rolloutCodePath": "a/b.html", "qaWidgetPath": null, "reservedStem": false, "edsName": "null", "lintRules": ["html-extension"]},
    "/nav": {"widgetStem": null, "roundtripLinks": null, "rolloutPageWidgets": "nav", "migrateWidgetsIn": "nav", "qaWidgetLinks": null, "qaWidgetLinksSameSite": null, "rolloutCodePath": "nav", "qaWidgetPath": null, "reservedStem": false, "edsName": "null", "lintRules": []}
  },
  widgetMounts: {
    "twoLinks": {"roundtrip": [], "migrate": [], "qa": [{"name": "site-search", "href": "/widgets/search/site-search.html", "path": "/widgets/search/site-search.html"}]},
    "noHref": {"roundtrip": [{"name": "site-search", "href": ""}], "migrate": [{"id": "site-search", "href": "/widgets/search/site-search.html"}], "qa": [], "migrateFixed": "<main><p><a data-widget=\"search/site-search\" href=\"/widgets/search/site-search.html\">x</a></p></main>", "rolloutPageWidgets": []},
    "widgetHref": {"search/site-search": "/widgets/search/site-search.html", "/widgets/search/site-search.html": "/widgets/search/site-search.html", "widgets/a/widget": "/widgets/a/widget.html", "x.HTML": "/widgets/x.html", " map/finder.htm ": "/widgets/map/finder.html"},
    "splitWidgets": {"blocks": ["hero", "cards"], "widgets": ["site-search"]}
  },
  chrome: {
    "header": {"rollout": true, "spec": true, "aiReadability": true, "qaFragments": false, "deliveryLint": false},
    "nav": {"rollout": true, "spec": true, "aiReadability": true, "qaFragments": true, "deliveryLint": true},
    "footer": {"rollout": true, "spec": true, "aiReadability": true, "qaFragments": true, "deliveryLint": true},
    "menu": {"rollout": false, "spec": false, "aiReadability": true, "qaFragments": false, "deliveryLint": false},
    "Header": {"rollout": true, "spec": false, "aiReadability": true, "qaFragments": false, "deliveryLint": false},
    "mega-menu": {"rollout": false, "spec": false, "aiReadability": false, "qaFragments": false, "deliveryLint": false},
    "hero": {"rollout": false, "spec": false, "aiReadability": false, "qaFragments": false, "deliveryLint": false}
  },
  chromeSets: {"rollout": ["header", "nav", "footer"], "spec": ["header", "footer", "nav"], "qaDefault": ["/nav", "/footer"], "aiReadabilityOnPaths": {"/": false, "/a": false, "/a/": false, "/a/b": false, "/a/b/": false, "/a/index.html": false, "/a/b.html": false, "/a?x=1": false, "/a#f": false, "/A/B": false, "https://HOST.example/a/b.html?q": false, "/widgets/search/site-search.html?q=docs": false, "/widgets/search/site-search.htm": false, "/nav": true, "/footer": true, "/fragments/x": false}},
  classLabels: {
    "L": {"dynamics": "listing", "spec": "listing", "inTaxonomy": true},
    "S": {"dynamics": "search", "spec": "search", "inTaxonomy": true},
    "F": {"dynamics": "form", "spec": "form", "inTaxonomy": true},
    "M": {"dynamics": "modal / interactive", "spec": "modal / interactive", "inTaxonomy": true},
    "V": {"dynamics": "media", "spec": "media", "inTaxonomy": true},
    "T": {"dynamics": "tag / consent", "spec": "tag / consent", "inTaxonomy": true},
    "A": {"dynamics": "API / personalisation / settings", "spec": "API / settings", "inTaxonomy": true},
    "R": {"dynamics": "relationship", "spec": "relationship", "inTaxonomy": true},
    "X": {"dynamics": "auth / commerce", "spec": "auth / commerce", "inTaxonomy": true},
    "I18N": {"dynamics": "locale", "spec": "locale", "inTaxonomy": true},
    "CR": {"dynamics": "client-rendered", "spec": "client-rendered", "inTaxonomy": true},
    "D": {"dynamics": "sheet / data file", "spec": "data file", "inTaxonomy": true}
  },
  metadataPair: {"davidsModelLint": ["metadata", "section-metadata"], "qaBlockNames": ["hero"]},
  kinds: {"specCoded": ["block", "dynamic", "widget"], "specMapHeader": ["block", "dynamic", "widget", "default", "metadata", "drop"], "specMapNestedKinds": ["block", "dynamic", "widget"], "specMapKindLiterals": ["block", "default", "drop", "metadata", "unmapped"], "rolloutSchema": ["chrome", "module", "section", "widget"], "rolloutKindOf": ["chrome", "module"], "rolloutDefaultContent": "default-content", "specMapDefaultBlock": "default-content"},
};
const KNOWN_DIVERGENCE = [
  {"concept": "path-key", "input": "/", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"\""},
  {"concept": "path-key", "input": "/a/", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/a/\""},
  {"concept": "path-key", "input": "/a/b/", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/a/b/\""},
  {"concept": "path-key", "input": "/a/index.html", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/a/index.html\""},
  {"concept": "path-key", "input": "/a/index.html", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/a/index.html\""},
  {"concept": "path-key", "input": "/a/index.html", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "spec/scripts/lib.mjs#templateOf (section, '/'-prefixed) → \"/a/index\""},
  {"concept": "path-key", "input": "/a/b.html", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/a/b.html\""},
  {"concept": "path-key", "input": "/a/b.html", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/a/b.html\""},
  {"concept": "path-key", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"/a?x=1\""},
  {"concept": "path-key", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/a?x=1\""},
  {"concept": "path-key", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "diff/scripts/chrome-compare.mjs#hrefKey → \"/a?x=1\""},
  {"concept": "path-key", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/a?x=1\""},
  {"concept": "path-key", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"/a#f\""},
  {"concept": "path-key", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/a#f\""},
  {"concept": "path-key", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/a#f\""},
  {"concept": "path-key", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"/A/B\""},
  {"concept": "path-key", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/A/B\""},
  {"concept": "path-key", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/A/B\""},
  {"concept": "path-key", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/A/B\""},
  {"concept": "path-key", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/a/b\"", "b": "spec/scripts/lib.mjs#templateOf (section, '/'-prefixed) → \"/A/B\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"https://HOST.example/a/b.html?q\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/https://HOST.example/a/b.html\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/a/b\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "diff/scripts/chrome-compare.mjs#hrefKey → \"/a/b?q\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/https://HOST.example/a/b.html?q\""},
  {"concept": "path-key", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/https:/host.example/a/b\"", "b": "spec/scripts/lib.mjs#templateOf (section, '/'-prefixed) → \"/a/b\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"/widgets/search/site-search.html?q=docs\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/widgets/search/site-search.html\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/widgets/search/site-search.html?q=docs\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "diff/scripts/chrome-compare.mjs#hrefKey → \"/widgets/search/site-search?q=docs\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/widgets/search/site-search.html?q=docs\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "spec/scripts/spec-knowledge.mjs#needsEntry.k → \"/widgets/search/site-search.htm\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "rollout/scripts/assemble.mjs#normPath → \"/widgets/search/site-search.htm\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "rollout/scripts/inventory.mjs#urlToDeliveredPath → \"/widgets/search/site-search.htm\""},
  {"concept": "path-key", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#pathKey → \"/widgets/search/site-search\"", "b": "qa/scripts/lib.mjs#buildInventory.path → \"/widgets/search/site-search.htm\""},
  {"concept": "served-url-listing", "input": "/a/index.html", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/a/\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/a/index.html\""},
  {"concept": "served-url-listing", "input": "/a/b.html", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/a/b.html\""},
  {"concept": "served-url-listing", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/a\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/a?x=1\""},
  {"concept": "served-url-listing", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/a\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/a#f\""},
  {"concept": "served-url-listing", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/A/B\""},
  {"concept": "served-url-listing", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/https/host-example/a/b\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/https://HOST.example/a/b.html?q\""},
  {"concept": "served-url-listing", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/widgets/search/site-search\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/widgets/search/site-search.html?q=docs\""},
  {"concept": "served-url-listing", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#deliveredUrl → \"/widgets/search/site-search\"", "b": "qa/scripts/lib.mjs#buildInventory.url → \"/widgets/search/site-search.htm\""},
  {"concept": "served-url-tree", "input": "/a/b.html", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a/b\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/a/b.html\""},
  {"concept": "served-url-tree", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "rollout/scripts/lib.mjs#publicUrl (inventory row of the file) → \"/a?x=1/\""},
  {"concept": "served-url-tree", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "rollout/scripts/done-check.mjs#deliveredPaths → \"/a?x=1/\""},
  {"concept": "served-url-tree", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/a?x=1/\""},
  {"concept": "served-url-tree", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "rollout/scripts/lib.mjs#publicUrl (inventory row of the file) → \"/a#f/\""},
  {"concept": "served-url-tree", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "rollout/scripts/done-check.mjs#deliveredPaths → \"/a#f/\""},
  {"concept": "served-url-tree", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/a#f/\""},
  {"concept": "served-url-tree", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a/b/\"", "b": "rollout/scripts/lib.mjs#publicUrl (inventory row of the file) → \"/A/B/\""},
  {"concept": "served-url-tree", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a/b/\"", "b": "rollout/scripts/done-check.mjs#deliveredPaths → \"/A/B/\""},
  {"concept": "served-url-tree", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a/b/\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/A/B/\""},
  {"concept": "served-url-tree", "input": "https://HOST.example/a/b.html?q", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/a/b\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/a/b.html\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "rollout/scripts/lib.mjs#publicUrl (inventory row of the file) → \"/widgets/search/site-search.html?q=docs/\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "rollout/scripts/done-check.mjs#deliveredPaths → \"/widgets/search/site-search.html?q=docs/\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/widgets/search/site-search.html?q=docs/\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "rollout/scripts/lib.mjs#publicUrl (inventory row of the file) → \"/widgets/search/site-search.htm\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "rollout/scripts/done-check.mjs#deliveredPaths → \"/widgets/search/site-search.htm\""},
  {"concept": "served-url-tree", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#deliveredUrl (of /<file>) → \"/widgets/search/site-search\"", "b": "migrate/scripts/migrate.mjs#urlFormOf ('/'-prefixed) → \"/widgets/search/site-search.htm\""},
  {"concept": "tree-path", "input": "/a?x=1", "a": "rollout/scripts/inventory.mjs#deliveredPath → \"/a?x=1\"", "b": "deploy/scripts/eds-path.mjs#pathKey (of /<file>) → \"/a\""},
  {"concept": "tree-path", "input": "/a#f", "a": "rollout/scripts/inventory.mjs#deliveredPath → \"/a#f\"", "b": "deploy/scripts/eds-path.mjs#pathKey (of /<file>) → \"/a\""},
  {"concept": "tree-path", "input": "/A/B", "a": "rollout/scripts/inventory.mjs#deliveredPath → \"/A/B\"", "b": "deploy/scripts/eds-path.mjs#pathKey (of /<file>) → \"/a/b\""},
  {"concept": "tree-path", "input": "/widgets/search/site-search.html?q=docs", "a": "rollout/scripts/inventory.mjs#deliveredPath → \"/widgets/search/site-search.html?q=docs\"", "b": "deploy/scripts/eds-path.mjs#pathKey (of /<file>) → \"/widgets/search/site-search\""},
  {"concept": "tree-path", "input": "/widgets/search/site-search.htm", "a": "rollout/scripts/inventory.mjs#deliveredPath → \"/widgets/search/site-search.htm\"", "b": "deploy/scripts/eds-path.mjs#pathKey (of /<file>) → \"/widgets/search/site-search\""},
  {"concept": "da-document-path", "input": "/a?x=1", "a": "deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>) → \"/a\"", "b": "deploy/scripts/deploy-batch.mjs#walkHtml.webPath → \"/a?x=1/index\""},
  {"concept": "da-document-path", "input": "/a#f", "a": "deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>) → \"/a\"", "b": "deploy/scripts/deploy-batch.mjs#walkHtml.webPath → \"/a#f/index\""},
  {"concept": "da-document-path", "input": "/A/B", "a": "deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>) → \"/a/b/index\"", "b": "deploy/scripts/deploy-batch.mjs#walkHtml.webPath → \"/A/B/index\""},
  {"concept": "da-document-path", "input": "/widgets/search/site-search.html?q=docs", "a": "deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>) → \"/widgets/search/site-search\"", "b": "deploy/scripts/deploy-batch.mjs#walkHtml.webPath → \"/widgets/search/site-search.html?q=docs/index\""},
  {"concept": "da-document-path", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/eds-path.mjs#daPath (of deliveredUrl of /<file>) → \"/widgets/search/site-search\"", "b": "deploy/scripts/deploy-batch.mjs#walkHtml.webPath → \"/widgets/search/site-search.htm\""},
  {"concept": "sidecar", "input": "/widgets/search/site-search.htm", "a": "migrate/scripts/migrate.mjs#sidecarFor → \"widgets/search/site-search._meta.json\"", "b": "rollout/scripts/inventory.mjs#sidecarFor → \"widgets/search/site-search.htm._meta.json\""},
  {"concept": "widget-stem", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → \"site-search\"", "b": "rollout/scripts/lib.mjs#pageWidgets.id → \"site-search.htm\""},
  {"concept": "widget-stem", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → \"site-search\"", "b": "qa/scripts/checks/content.mjs#widgetLinks.name (no base) → null"},
  {"concept": "widget-stem", "input": "/widgets/search/site-search.htm", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → \"site-search\"", "b": "qa/scripts/checks/content.mjs#widgetLinks.name (base https://site.example) → null"},
  {"concept": "widget-stem", "input": "/widgets/x.HTML", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → \"x\"", "b": "rollout/scripts/lib.mjs#pageWidgets.id → \"x.HTML\""},
  {"concept": "widget-stem", "input": "https://partner.example/widgets/map/finder.html", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → \"finder\"", "b": "qa/scripts/checks/content.mjs#widgetLinks.name (base https://site.example) → null"},
  {"concept": "widget-stem", "input": "/a/b.html", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → null", "b": "rollout/scripts/lib.mjs#pageWidgets.id → \"b\""},
  {"concept": "widget-stem", "input": "/a/b.html", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → null", "b": "migrate/scripts/migrate.mjs#widgetsIn.id → \"b\""},
  {"concept": "widget-stem", "input": "/nav", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → null", "b": "rollout/scripts/lib.mjs#pageWidgets.id → \"nav\""},
  {"concept": "widget-stem", "input": "/nav", "a": "deploy/scripts/block-roundtrip.mjs#widgetStem → null", "b": "migrate/scripts/migrate.mjs#widgetsIn.id → \"nav\""},
  {"concept": "chrome-id", "input": "header", "a": "rollout/scripts/lib.mjs#kindOf → true", "b": "qa/scripts/lib.mjs#buildInventory.fragments default (of /<id>) → false"},
  {"concept": "chrome-id", "input": "header", "a": "rollout/scripts/lib.mjs#kindOf → true", "b": "rollout/scripts/delivery-lint.mjs#inferType (of /<id>) === fragment → false"},
  {"concept": "chrome-id", "input": "menu", "a": "rollout/scripts/lib.mjs#kindOf → false", "b": "deploy/scripts/ai-readability.mjs#isChrome (of /<id>) → true"},
  {"concept": "chrome-id", "input": "Header", "a": "rollout/scripts/lib.mjs#kindOf → true", "b": "spec/scripts/lib.mjs#genericRules.CHROME → false"},
  {"concept": "chrome-id", "input": "Header", "a": "rollout/scripts/lib.mjs#kindOf → true", "b": "qa/scripts/lib.mjs#buildInventory.fragments default (of /<id>) → false"},
  {"concept": "chrome-id", "input": "Header", "a": "rollout/scripts/lib.mjs#kindOf → true", "b": "rollout/scripts/delivery-lint.mjs#inferType (of /<id>) === fragment → false"},
  {"concept": "class-label", "input": "A", "a": "dynamics/scripts/dynamics-detect.mjs#CLASS_NAMES → \"API / personalisation / settings\"", "b": "spec/scripts/spec-knowledge.mjs#CLASS_NAMES → \"API / settings\""},
  {"concept": "class-label", "input": "D", "a": "dynamics/scripts/dynamics-detect.mjs#CLASS_NAMES → \"sheet / data file\"", "b": "spec/scripts/spec-knowledge.mjs#CLASS_NAMES → \"data file\""},
  {"concept": "chrome-set", "input": "header", "a": "rollout/scripts/lib.mjs#CHROME_IDS → \"header\"", "b": "qa/scripts/lib.mjs#buildInventory.fragments → absent"},
  {"concept": "kind-enum", "input": "default", "a": "spec/scripts/lib.mjs#CODED → absent", "b": "spec/scripts/spec-map.mjs#header kinds → \"default\""},
  {"concept": "kind-enum", "input": "metadata", "a": "spec/scripts/lib.mjs#CODED → absent", "b": "spec/scripts/spec-map.mjs#header kinds → \"metadata\""},
  {"concept": "kind-enum", "input": "drop", "a": "spec/scripts/lib.mjs#CODED → absent", "b": "spec/scripts/spec-map.mjs#header kinds → \"drop\""},
  {"concept": "kind-enum", "input": "block", "a": "spec/scripts/spec-map.mjs#header kinds → \"block\"", "b": "rollout/schemas/rollout-blocks.schema.json#kind → absent"},
  {"concept": "kind-enum", "input": "dynamic", "a": "spec/scripts/spec-map.mjs#header kinds → \"dynamic\"", "b": "rollout/schemas/rollout-blocks.schema.json#kind → absent"},
  {"concept": "kind-enum", "input": "default", "a": "spec/scripts/spec-map.mjs#header kinds → \"default\"", "b": "rollout/schemas/rollout-blocks.schema.json#kind → absent"},
  {"concept": "kind-enum", "input": "metadata", "a": "spec/scripts/spec-map.mjs#header kinds → \"metadata\"", "b": "rollout/schemas/rollout-blocks.schema.json#kind → absent"},
  {"concept": "kind-enum", "input": "drop", "a": "spec/scripts/spec-map.mjs#header kinds → \"drop\"", "b": "rollout/schemas/rollout-blocks.schema.json#kind → absent"},
  {"concept": "kind-enum", "input": "chrome", "a": "spec/scripts/spec-map.mjs#header kinds → absent", "b": "rollout/schemas/rollout-blocks.schema.json#kind → \"chrome\""},
  {"concept": "kind-enum", "input": "module", "a": "spec/scripts/spec-map.mjs#header kinds → absent", "b": "rollout/schemas/rollout-blocks.schema.json#kind → \"module\""},
  {"concept": "kind-enum", "input": "section", "a": "spec/scripts/spec-map.mjs#header kinds → absent", "b": "rollout/schemas/rollout-blocks.schema.json#kind → \"section\""},
  {"concept": "kind-enum", "input": "section", "a": "rollout/schemas/rollout-blocks.schema.json#kind → \"section\"", "b": "rollout/scripts/lib.mjs#kindOf values → absent"},
  {"concept": "kind-enum", "input": "widget", "a": "rollout/schemas/rollout-blocks.schema.json#kind → \"widget\"", "b": "rollout/scripts/lib.mjs#kindOf values → absent"},
];

// ---------------------------------------------------------------------------------------------------- checks --
check('localize-links canonicalPath is eds-path pathKey itself', () => assert.equal(localize.canonicalPath, edsPath.pathKey));
check('spec-knowledge needsEntry agrees with its extracted k() on every input', () => {
  for (const p of PATHS) { assert.equal(specKnowledge.needsEntry(p, specKnowledgeKey(p)), 0, p); assert.equal(specKnowledge.needsEntry(p, `${specKnowledgeKey(p)}-x`), 1, p); }
});
check('the observed tables cover exactly the pinned concepts', () => assert.deepEqual(Object.keys(OBSERVED), Object.keys(EXPECTED)));
for (const key of Object.keys(EXPECTED)) {
  check(`${key}: every implementation still gives its pinned output on every input`, () => assert.deepEqual(OBSERVED[key], EXPECTED[key]));
}
check('every implementation pair disagrees exactly where KNOWN_DIVERGENCE says (no new or vanished divergence)', () => assert.deepEqual(divergences, KNOWN_DIVERGENCE));
check('source pins of the metadata pair, the qa templates rule and build-harness are unchanged', () => {
  pin('qa/scripts/checks/content.mjs', "if (name !== 'metadata' && name !== 'section-metadata') names.add(name);");
  pin('qa/scripts/checks/content.mjs', "return n === 'metadata' || n === 'section-metadata'; };");
  pin('qa/scripts/checks/templates.mjs', "if (m[1] !== 'metadata' && m[1] !== 'section-metadata') names.add(m[1]);");
  pin('deploy/scripts/build-harness.mjs', "main.indexOf('class=\"metadata\"')");
  pin('deploy/scripts/build-harness.mjs', 'section-metadata(?:\\s[^"\']*)?["\']/gi');
  pin('rollout/scripts/delivery-lint.mjs', "if (/^\\/widgets\\/.+\\.html$/i.test(bare)) {");
  pin('rollout/scripts/delivery-lint.mjs', "const stem = bare.replace(/^.*\\//, '').replace(/\\.html$/i, '');");
  pin('qa/scripts/checks/content.mjs', "if (!/^\\/widgets\\/.+\\.html$/i.test(path) || seen.has(path)) continue;");
  pin('deploy/scripts/ai-readability.mjs', "'--exclude-blocks', 'client-app,widget'");
});

console.log(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
