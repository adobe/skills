#!/usr/bin/env node
// Fixture test: typed coverage rows across inventory.mjs, assemble.mjs and optimize.mjs.
//
//   inventory  --content seeds chrome (nav*, footer*), fragments/** and *.json rows with
//              delivery.type fragment | index and stable slugs; a typed row survives a
//              re-run without --content and a re-run whose source file is gone
//              (source.missing: true, delivery preserved); --redirects seeds
//              delivery.deployedPath from a Source row; typed rows stay out of
//              templates.json; rollout.json gains links.outsideInventory: fail; every key
//              the written rows and rollout.json carry is one the schemas list (key-walk,
//              no validator dependency).
//   assemble   sitemap.xml lists live page rows only (deployed | verified | stale, type
//              page) at their served path, on the normalised host — no https://https://.
//   optimize   index rows are skipped; a fragment row runs img-alt only (no single-h1,
//              title-missing, landmark-main …) and is out of the duplicate-title check.
//
// Usage: node plugins/stardust/skills/rollout/scripts/inventory.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SHARED = join(HERE, '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate', 'stardust', 'migrated');
const node = (script, args) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8' });
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

const T = mkdtempSync(join(tmpdir(), 'inventory-test-'));
const MIG = join(T, 'migrated'); const OUT = join(T, 'rollout'); const CONTENT = join(T, 'content');
cpSync(SHARED, MIG, { recursive: true });
mkdirSync(join(CONTENT, 'fragments', 'offers'), { recursive: true });
const NAV = '<div><ul><li><a href="/">Home</a></li></ul><img src="/icons/logo.svg"></div>';
writeFileSync(join(CONTENT, 'nav.html'), NAV);
writeFileSync(join(CONTENT, 'footer.html'), '<div><p>footer</p></div>');
writeFileSync(join(CONTENT, 'nav-de.html'), NAV);
writeFileSync(join(CONTENT, 'fragments', 'offers', 'promo.html'), '<div><p>promo</p></div>');
writeFileSync(join(CONTENT, 'query-index.json'), '{"total":0,"data":[]}');
writeFileSync(join(T, 'redirects.tsv'), '# gate 3\n/business\t/commercial\n/nowhere\t/\n');

// --- inventory: typed seeding + redirects -----------------------------------------
let r = node('inventory.mjs', ['--migrated', MIG, '--out', OUT, '--content', CONTENT, '--redirects', join(T, 'redirects.tsv')]);
assert.equal(r.status, 0, `inventory exit 0\n${r.stderr}`);
const pagesPath = join(OUT, 'coverage', 'pages.json');
let pages = json(pagesPath).pages;
const bySlug = () => new Map(json(pagesPath).pages.map((p) => [p.slug, p]));
const typed = pages.filter((p) => p.delivery.type).map((p) => [p.slug, p.path, p.delivery.type]).sort();
assert.deepEqual(typed, [
  ['chrome-footer', '/footer', 'fragment'], ['chrome-nav', '/nav', 'fragment'], ['chrome-nav-de', '/nav-de', 'fragment'],
  ['fragment-offers-promo', '/fragments/offers/promo', 'fragment'], ['index-query-index', '/query-index.json', 'index'],
], 'typed rows seeded with stable slugs, paths and types');
assert.equal(pages.length, 11, 'six pages + five typed rows');
assert.equal(bySlug().get('business').delivery.deployedPath, '/commercial', '--redirects seeds deployedPath on a Source row');
assert.equal(bySlug().get('home').delivery.deployedPath, undefined, 'rows without a Source row are untouched');
assert.match(r.stdout, /typed rows 5 \(fragment\/index\)/, 'report line names the typed rows');
const templates = json(join(OUT, 'coverage', 'templates.json')).templates;
assert.ok(templates.every((t) => !t.pages.some((s) => s.startsWith('chrome-') || s.startsWith('fragment-') || s.startsWith('index-'))), 'typed rows are excluded from template roll-ups');
assert.equal(templates.reduce((n, t) => n + t.pageCount, 0), 6, 'roll-ups count page rows only');
const config = json(join(OUT, 'rollout.json'));
assert.deepEqual(config.links, { outsideInventory: 'fail' }, 'rollout.json seeds the link policy default');

// --- schema contract: written keys ⊆ schema keys (schemas/rollout-*.schema.json) -----
const schema = (n) => json(join(HERE, '..', 'schemas', n));
const walk = (obj, node, at, out) => {
  if (!node || !node.properties || !obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (!(k in node.properties)) { out.push(`${at}.${k}`); continue; }
    const sub = node.properties[k]; const ref = sub.$ref ? sub.$ref.replace('#/$defs/', '') : null;
    walk(obj[k], ref ? node.__defs[ref] : Object.assign(sub, { __defs: node.__defs }), `${at}.${k}`, out);
  }
};
const unknown = (doc, sch, at) => { const out = []; walk(doc, Object.assign(sch, { __defs: Object.fromEntries(Object.entries(sch.$defs || {}).map(([k, v]) => [k, Object.assign(v, { __defs: sch.$defs })])) }), at, out); return out; };
const pagesSchema = schema('rollout-pages.schema.json'); const pageDef = Object.assign(pagesSchema.$defs.page, { __defs: pagesSchema.$defs });
const rowKeys = json(pagesPath).pages.flatMap((p) => { const out = []; walk(p, pageDef, p.slug, out); return out; });
assert.deepEqual(rowKeys, [], `pages.json rows use only schema keys (unknown: ${rowKeys})`);
assert.deepEqual(unknown(json(join(OUT, 'rollout.json')), schema('rollout-config.schema.json'), 'rollout.json'), [], 'rollout.json uses only schema keys');
const statusEnum = pagesSchema.$defs.page.properties.delivery.properties.status.enum;
assert.ok(json(pagesPath).pages.every((p) => statusEnum.includes(p.delivery.status)), 'every status is in the schema enum');

// --- preservation: mark chrome-nav deployed, re-run without --content, then with the file gone
pages = json(pagesPath); const nav = pages.pages.find((p) => p.slug === 'chrome-nav');
nav.delivery.status = 'deployed'; nav.delivery.deployedAt = '2026-09-19T00:00:00Z';
writeFileSync(pagesPath, JSON.stringify(pages));
r = node('inventory.mjs', ['--migrated', MIG, '--out', OUT]);
assert.equal(r.status, 0);
let navRow = bySlug().get('chrome-nav');
assert.ok(navRow, 'a typed row survives a re-run without --content');
assert.deepEqual([navRow.delivery.status, navRow.delivery.type, navRow.source.missing], ['deployed', 'fragment', false], 'delivery preserved, not flagged missing when --content was not passed');
assert.equal(bySlug().size, 11, 'no typed row dropped');
rmSync(join(CONTENT, 'nav.html'));
r = node('inventory.mjs', ['--migrated', MIG, '--out', OUT, '--content', CONTENT]);
navRow = bySlug().get('chrome-nav');
assert.ok(navRow && navRow.source.missing === true && navRow.delivery.status === 'deployed', 'source gone → row kept, source.missing: true, delivery preserved');
assert.equal(bySlug().get('chrome-nav-de').source.missing, false, 'a re-seeded row is not missing');
// a changed fragment file re-flags a delivered row stale, like a page
pages = json(pagesPath); const de = pages.pages.find((p) => p.slug === 'chrome-nav-de'); de.delivery.status = 'verified'; writeFileSync(pagesPath, JSON.stringify(pages));
writeFileSync(join(CONTENT, 'nav-de.html'), `${NAV}<!-- changed -->`);
node('inventory.mjs', ['--migrated', MIG, '--out', OUT, '--content', CONTENT]);
assert.equal(bySlug().get('chrome-nav-de').delivery.status, 'stale', 'changed fragment source → stale');

// --- assemble: live page rows only, normalised host -------------------------------
pages = json(pagesPath);
const set = (slug, status) => { pages.pages.find((p) => p.slug === slug).delivery.status = status; };
set('home', 'verified'); set('business', 'deployed'); set('insurance__auto', 'stale'); set('insurance__home', 'failed');
set('chrome-footer', 'verified'); set('index-query-index', 'verified');
writeFileSync(pagesPath, JSON.stringify(pages));
const cfg = json(join(OUT, 'rollout.json')); cfg.site.liveHost = 'https://main--site--org.aem.live/'; writeFileSync(join(OUT, 'rollout.json'), JSON.stringify(cfg));
r = node('assemble.mjs', ['--out', OUT, '--canon', join(T, 'no-canon')]);
assert.equal(r.status, 0, `assemble exit 0\n${r.stderr}`);
const sitemap = readFileSync(join(OUT, 'site', 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
assert.deepEqual(locs, ['https://main--site--org.aem.live/', 'https://main--site--org.aem.live/commercial', 'https://main--site--org.aem.live/insurance/auto'], 'sitemap = deployed|verified|stale page rows at their served path (deployedPath for business); no fragment, index, failed or pending row');
assert.ok(!/https:\/\/https:\/\//.test(sitemap) && !/https:\/\/https:\/\//.test(readFileSync(join(OUT, 'site', 'robots.txt'), 'utf8')), 'liveHost with a scheme is normalised, not doubled');
assert.match(r.stdout, /sitemap.xml   3 urls \(live page rows of 11\)/);

// --- optimize: typed detector sets, offline ---------------------------------------
// --root resolves rows against one tree: give it the migrated pages plus the fragment + index files
const ROOT = join(T, 'root'); cpSync(MIG, ROOT, { recursive: true });
writeFileSync(join(ROOT, 'footer.html'), '<div><p>footer</p><img src="/x.png"></div>');
writeFileSync(join(ROOT, 'query-index.json'), '{"total":0,"data":[]}');
r = node('optimize.mjs', ['--root', ROOT, '--all', '--out', OUT]);
const findings = json(join(OUT, 'optimize', 'findings.json'));
const forSlug = (s) => findings.findings.filter((f) => f.scope.ids.includes(s)).map((f) => f.check).sort();
assert.deepEqual(forSlug('chrome-footer'), ['img-alt'], `fragment row runs img-alt only (got ${forSlug('chrome-footer')})`);
assert.deepEqual(forSlug('index-query-index'), [], 'index row produces no finding');
assert.ok(!findings.runs[0].scopePages.includes('index-query-index'), 'index row is not inspected');
assert.ok(findings.runs[0].scopePages.includes('chrome-footer') && findings.runs[0].scopePages.includes('home'), 'fragment + pages inspected');
assert.ok(!findings.findings.some((f) => f.check === 'duplicate-title' && f.scope.ids.includes('chrome-footer')), 'fragments are out of the duplicate-title check');

for (const s of ['inventory.mjs', 'assemble.mjs', 'optimize.mjs']) assert.equal(node(s, ['--help']).status, 0, `${s} --help exits 0`);
rmSync(T, { recursive: true, force: true });
console.log('inventory.test: ok (typed rows seeded + preserved, --redirects deployedPath, schema key-walk, sitemap = live page rows, fragment-safe optimize)');
