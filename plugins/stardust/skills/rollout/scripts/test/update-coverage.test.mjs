#!/usr/bin/env node
// Contract test for rollout/scripts/update-coverage.mjs under a fan-out: eight processes record a
// different page each at the same moment → all eight rows land, the roll-ups count them, every file
// parses, no lock dir or tmp file remains. Also: a stale lock is reclaimed; --help writes nothing;
// a module mapped to EDS default content (`--eds-name default-content`) is never pending in the
// block roll-up, whatever its status, and a blocks.mjs re-run keeps the mapping. And `--new`: a page
// built outside the migrated tree (a D2 search page) enters coverage as a schema-shaped row with its
// origin in source.migratedHtml, joins its template, is idempotent, refuses captured slugs and taken
// paths, and lands under the lock beside concurrent page updates. And `--gate`: the newest row per page
// and width wins — an older row of either width is skipped and counted (delivery.gate.atByWidth); a width
// with no recorded time, or a record without the map, is applied; an INCONCLUSIVE row is recorded pass false with its
// reasons and never flips the status; only gate-all's validated override (`valid: true`) passes a failing row; a row's
// fix-round count (`round`) merges into delivery.gate.rounds per width, a row without one keeps the map; an --only run's
// runs/<ts>-<slug>.json table ingests like the roster summary; a gate dir ingests summary.json then runs/*.json in name
// order (newest row wins); an absent summary.json beside runs/ tables ingests those with one stdout note; not found,
// unparsable and no-rows files are refused apart (exit 1, nothing written), and so is a table that cannot be read (a
// directory named *.json in runs/); delivery.gate.host records the EDS origin a
// verdict was measured against — the row's `host`, else its own table's `_provenance.eds`, else null; each width keeps
// its own verdict (delivery.gate.passByWidth) whichever table came last, an INCONCLUSIVE width records null (no
// verdict, never false or true), and a page leaves a gate failure for deployed only when no recorded width failed.
// And `--block <name> --status
// not-delivered --reason <text>`: the reason is required (exit 2), recorded as delivery.reason, cleared by
// any other status, the block found by id then by edsBlockName, and counted in lastRun.blocks.notDelivered.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { blockCounts } from '../lib.mjs';
import { loadSchema, validate } from './schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'update-coverage.mjs');
const BLOCKS_SCRIPT = join(HERE, '..', 'blocks.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const runScript = (script, args, cwd) => new Promise((res) => {
  const p = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => res({ code, out, err }));
});
const run = (args, cwd) => runScript(SCRIPT, args, cwd);
const fixture = () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-'));
  const out = join(proj, 'stardust', 'rollout'); mkdirSync(join(out, 'coverage'), { recursive: true });
  const slugs = Array.from({ length: 8 }, (_, i) => `page-${i}`);
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: slugs.map((slug) => ({ slug, template: 'detail', delivery: { status: 'pending' } })) }, null, 2));
  writeFileSync(join(out, 'coverage', 'blocks.json'), JSON.stringify({ blocks: [{ id: 'hero', delivery: { status: 'pending' } }] }, null, 2));
  writeFileSync(join(out, 'coverage', 'templates.json'), JSON.stringify({ templates: [{ id: 'detail', pages: slugs }] }, null, 2));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify({ site: {} }, null, 2));
  return { proj, out, slugs };
};

await check('eight concurrent page updates all land and the roll-ups count them', async () => {
  const { proj, out, slugs } = fixture();
  const rs = await Promise.all(slugs.map((s) => run([s, '--status', 'deployed', '--url', `https://x/${s}`], proj)));
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const pages = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages;
  assert.deepEqual(pages.map((p) => p.delivery.status), Array(8).fill('deployed'));
  const t = JSON.parse(readFileSync(join(out, 'coverage', 'templates.json'), 'utf8')).templates[0];
  assert.equal(t.delivery.deployed, 8);
  const cfg = JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8'));
  assert.equal(cfg.lastRun.pages.deployed, 8);
  assert.deepEqual(readdirSync(out).sort(), ['coverage', 'rollout.json'], 'no lock dir or tmp file left');
  assert.deepEqual(readdirSync(join(out, 'coverage')).sort(), ['blocks.json', 'pages.json', 'templates.json']);
});

await check('page and block updates interleaved keep both files whole', async () => {
  const { proj, out } = fixture();
  const rs = await Promise.all([
    run(['page-0', '--status', 'deployed'], proj), run(['--block', 'hero', '--status', 'converted', '--eds-name', 'hero'], proj),
    run(['page-1', '--status', 'failed', '--error', 'x'], proj), run(['page-2', '--status', 'verified'], proj),
  ]);
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const pages = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages;
  assert.equal(pages.find((p) => p.slug === 'page-1').delivery.error, 'x');
  assert.equal(JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8')).blocks[0].delivery.status, 'converted');
  assert.equal(JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun.blocks.converted, 1);
});

await check('a stale lock from a crashed writer is reclaimed', async () => {
  const { proj, out } = fixture();
  const lock = join(out, '.coverage.lock'); mkdirSync(lock); writeFileSync(join(lock, 'owner'), '1 crashed\n');
  const old = (Date.now() - 120000) / 1000; utimesSync(lock, old, old);
  const r = await run(['page-3', '--status', 'deployed'], proj);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(lock));
});

await check('--help prints the header and writes nothing', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /update-coverage\.mjs <slug>/); assert.deepEqual(readdirSync(proj), []);
});

// --- default-content mappings: a module that needs no block is never pending in the roll-up ------
const BLOCKS_FILE = join('coverage', 'blocks.json');
const row = (id, status, edsBlockName = id) => ({ id, kind: 'module', delivery: { status, edsBlockName, blockPath: null, convertedAt: null } });
const writeBlocks = (out, blocks) => writeFileSync(join(out, BLOCKS_FILE), JSON.stringify({ blocks }, null, 2));
const readBlocks = (out) => JSON.parse(readFileSync(join(out, BLOCKS_FILE), 'utf8')).blocks;
const blockRollup = (out) => JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun.blocks;

await check('blockCounts: a default-content mapping is converted whatever its status; other rows follow the status rule', () => {
  assert.deepEqual(blockCounts([]), { total: 0, converted: 0, notDelivered: 0, pending: 0 });
  assert.deepEqual(blockCounts([row('title', 'pending', 'default-content'), row('text', 'failed', 'default-content')]), { total: 2, converted: 2, notDelivered: 0, pending: 0 });
  assert.deepEqual(blockCounts([row('hero', 'pending'), row('cards', 'failed'), row('faq', 'converted'), row('stats', 'verified')]), { total: 4, converted: 2, notDelivered: 0, pending: 2 });
  assert.deepEqual(blockCounts([{ id: 'bare' }]), { total: 1, converted: 0, notDelivered: 0, pending: 1 });
});

await check('(a) a default-content row recorded pending → lastRun.blocks.pending is 0 and converted counts it', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('title', 'pending', 'default-content'), row('text', 'pending', 'default-content')]);
  const r = await run(['page-0', '--status', 'deployed'], proj); // any write re-rolls rollout.json
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 2, notDelivered: 0, pending: 0 });
  assert.deepEqual(readBlocks(out).map((b) => b.delivery.status), ['pending', 'pending'], 'a roll-up rule, not a status rewrite');
});

await check('(b) --block <id> --status converted --eds-name default-content sets convertedAt, leaves blockPath null, pending is 0', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('image-caption', 'pending')]);
  const r = await run(['--block', 'image-caption', '--status', 'converted', '--eds-name', 'default-content'], proj);
  assert.equal(r.code, 0, r.err);
  const [b] = readBlocks(out);
  assert.equal(b.delivery.status, 'converted');
  assert.equal(b.delivery.edsBlockName, 'default-content');
  assert.equal(b.delivery.blockPath, null);
  assert.match(b.delivery.convertedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(blockRollup(out), { total: 1, converted: 1, notDelivered: 0, pending: 0 });
});

await check('(c) a real pending block still counts as pending beside a default-content mapping recorded pending', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('hero', 'pending'), row('title', 'pending')]);
  let r = await run(['--block', 'title', '--status', 'pending', '--eds-name', 'default-content'], proj); // what the recorded run did
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 1, notDelivered: 0, pending: 1 });
  r = await run(['--block', 'hero', '--status', 'converted', '--eds-name', 'hero'], proj);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 2, notDelivered: 0, pending: 0 });
});

await check('a blocks.mjs re-run keeps a default-content mapping recorded pending and rolls it up as converted', async () => {
  const { proj, out } = fixture();
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: [{ slug: 'home', templateId: 'detail', blocks: ['hero', 'title'], delivery: { status: 'pending' } }] }, null, 2));
  writeBlocks(out, [row('hero', 'pending'), row('title', 'pending', 'default-content')]);
  const r = await runScript(BLOCKS_SCRIPT, ['--out', out], proj);
  assert.equal(r.code, 0, r.err);
  const byId = Object.fromEntries(readBlocks(out).map((b) => [b.id, b.delivery]));
  assert.equal(byId.title.edsBlockName, 'default-content');
  assert.equal(byId.hero.edsBlockName, 'hero');
  assert.deepEqual(blockRollup(out), { total: 2, converted: 1, notDelivered: 0, pending: 1 });
});

// --- not-delivered: a block left undelivered on purpose, with its reason ------------------------
await check('blockCounts: not-delivered is its own count — never pending, never converted; a default-content mapping stays converted', () => {
  assert.deepEqual(blockCounts([row('promo', 'not-delivered'), row('hero', 'pending'), row('faq', 'converted')]), { total: 3, converted: 1, notDelivered: 1, pending: 1 });
  assert.deepEqual(blockCounts([row('title', 'not-delivered', 'default-content')]), { total: 1, converted: 1, notDelivered: 0, pending: 0 });
});

await check('--block <id> --status not-delivered without --reason is a usage error (exit 2), the ledger untouched', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('promo', 'converted')]);
  const before = readFileSync(join(out, BLOCKS_FILE), 'utf8');
  let r = await run(['--block', 'promo', '--status', 'not-delivered'], proj);
  assert.equal(r.code, 2); assert.match(r.err, /--reason/);
  r = await run(['--block', 'promo', '--status', 'not-delivered', '--reason', '  '], proj);
  assert.equal(r.code, 2, 'a blank reason is no reason');
  assert.equal(readFileSync(join(out, BLOCKS_FILE), 'utf8'), before);
});

await check('--block <id> --status not-delivered --reason records delivery.reason and lastRun.blocks.notDelivered; another status clears the reason', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('promo', 'converted'), row('hero', 'pending')]);
  let r = await run(['--block', 'promo', '--status', 'not-delivered', '--reason', 'seasonal teaser, no page uses it'], proj);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^block promo → not-delivered/m, r.out);
  const promo = readBlocks(out).find((b) => b.id === 'promo');
  assert.equal(promo.delivery.status, 'not-delivered'); assert.equal(promo.delivery.reason, 'seasonal teaser, no page uses it');
  assert.deepEqual(blockRollup(out), { total: 2, converted: 0, notDelivered: 1, pending: 1 });
  r = await run(['--block', 'promo', '--status', 'converted'], proj);
  assert.equal(r.code, 0, r.err);
  assert.ok(!('reason' in readBlocks(out).find((b) => b.id === 'promo').delivery), 'any other status deletes delivery.reason');
  assert.deepEqual(blockRollup(out), { total: 2, converted: 1, notDelivered: 0, pending: 1 });
});

await check('--block finds the row by id first, then by delivery.edsBlockName; several rows sharing that name are refused (exit 1)', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('Hero Banner', 'pending', 'hero-banner'), row('cards', 'pending', 'teaser'), row('teaser', 'pending'), row('news', 'pending', 'tiles'), row('products', 'pending', 'tiles')]);
  let r = await run(['--block', 'hero-banner', '--status', 'not-delivered', '--reason', 'replaced by the default hero'], proj);
  assert.equal(r.code, 0, r.err);
  const by = () => Object.fromEntries(readBlocks(out).map((b) => [b.id, b.delivery]));
  assert.equal(by()['Hero Banner'].status, 'not-delivered'); assert.equal(by()['Hero Banner'].reason, 'replaced by the default hero');
  r = await run(['--block', 'teaser', '--status', 'converted'], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(by().teaser.status, 'converted', 'the id match wins'); assert.equal(by().cards.status, 'pending');
  r = await run(['--block', 'nothing-here', '--status', 'converted'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /no block "nothing-here"/);
  const before = readFileSync(join(out, BLOCKS_FILE), 'utf8');
  r = await run(['--block', 'tiles', '--status', 'not-delivered', '--reason', 'x'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /news, products/);
  assert.equal(readFileSync(join(out, BLOCKS_FILE), 'utf8'), before, 'an ambiguous name changes nothing');
});

await check('--help names not-delivered and --reason', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help4-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /not-delivered/); assert.match(r.out, /--reason "<text>"/); assert.deepEqual(readdirSync(proj), []);
});

// --- --new: a page built outside the migrated tree enters coverage --------------------------------
const readPages = (out) => JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages;
const readTemplates = (out) => JSON.parse(readFileSync(join(out, 'coverage', 'templates.json'), 'utf8')).templates;
const readConfig = (out) => JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8'));
// the pages schema's page / source / delivery property sets (additionalProperties: false)
const PAGE_KEYS = ['blocks', 'delivery', 'path', 'slug', 'source', 'templateId', 'title'];
const SOURCE_KEYS = ['metaJson', 'migratedHtml', 'sourceHash'];
const DELIVERY_KEYS = ['deployedAt', 'deployedUrl', 'error', 'status', 'verifiedAt'];

await check('--new adds a schema-shaped row (origin in source.migratedHtml), creates its template row and rolls both up', async () => {
  const { proj, out } = fixture();
  const r = await run(['--new', 'search', '--path', '/search/', '--template', 'search', '--origin', 'dynamics', '--title', 'Search results'], proj);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^search added \(dynamics\) → \/search {3}template search · pending$/m, r.out);
  const row = readPages(out).find((p) => p.slug === 'search');
  assert.ok(row, 'row exists');
  assert.deepEqual(Object.keys(row).sort(), PAGE_KEYS);
  assert.deepEqual(Object.keys(row.source).sort(), SOURCE_KEYS);
  assert.deepEqual(Object.keys(row.delivery).sort(), DELIVERY_KEYS);
  assert.equal(row.path, '/search', 'trailing slash normalized'); assert.equal(row.title, 'Search results'); assert.equal(row.templateId, 'search');
  assert.equal(row.source.migratedHtml, 'dynamics:search'); assert.equal(row.source.metaJson, null); assert.match(row.source.sourceHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(row.blocks, []); assert.equal(row.delivery.status, 'pending'); assert.equal(row.delivery.error, null);
  const pagesSchema = loadSchema('rollout-pages.schema.json');
  assert.deepEqual(validate(pagesSchema.$defs.page, row, { root: pagesSchema }), [], 'the --new row validates as a page');
  assert.deepEqual(readPages(out).map((p) => p.slug).slice(0, 2), ['page-0', 'page-1'], 'existing rows keep their order');
  const t = readTemplates(out).find((x) => x.id === 'search');
  assert.deepEqual(t.pages, ['search']); assert.equal(t.pageCount, 1); assert.equal(t.representativeSlug, 'search'); assert.deepEqual(t.blocks, []);
  assert.equal(t.delivery.pending, 1);
  assert.equal(readConfig(out).lastRun.pages.total, 9); assert.equal(readConfig(out).lastRun.pages.pending, 9);
  assert.deepEqual(readdirSync(out).sort(), ['coverage', 'rollout.json'], 'no lock dir or tmp file left');
});

await check('--new is idempotent (the same slug updates, never duplicates) and --status / --template move the row', async () => {
  const { proj, out } = fixture();
  let r = await run(['--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 0, r.err);
  r = await run(['--new', 'search', '--path', '/search', '--template', 'detail', '--origin', 'dynamics', '--status', 'deployed'], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^search updated \(dynamics\) → \/search {3}template detail · deployed$/m, r.out);
  const rows = readPages(out).filter((p) => p.slug === 'search');
  assert.equal(rows.length, 1); assert.equal(rows[0].templateId, 'detail'); assert.equal(rows[0].delivery.status, 'deployed');
  const t = Object.fromEntries(readTemplates(out).map((x) => [x.id, x]));
  assert.deepEqual(t.search.pages, [], 'left the first template'); assert.equal(t.search.pageCount, 0);
  assert.ok(t.detail.pages.includes('search')); assert.equal(t.detail.pageCount, 9); assert.equal(t.detail.delivery.deployed, 1);
  assert.equal(readConfig(out).lastRun.pages.deployed, 1);
});

await check('--new refuses a captured slug and a path another row owns (exit 1), and a missing flag is a usage error (exit 2) — the ledger untouched', async () => {
  const { proj, out } = fixture();
  const before = JSON.stringify(readPages(out));
  let r = await run(['--new', 'page-0', '--path', '/p0', '--template', 'detail', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /"page-0" is a captured page/);
  r = await run(['--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 0, r.err);
  r = await run(['--new', 'suche', '--path', '/search', '--template', 'search', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /path \/search already belongs to "search"/);
  r = await run(['--new', 'faq', '--path', 'faq', '--template', 'faq', '--origin', 'Dynamics'], proj);
  assert.equal(r.code, 2); assert.match(r.err, /--path <\/delivered\/path> required/); assert.match(r.err, /--origin <token> required/);
  r = await run(['--new', 'faq', '--path', '/faq', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 2); assert.match(r.err, /--template <id> required/);
  const after = readPages(out).filter((p) => p.slug !== 'search');
  assert.equal(JSON.stringify(after), before, 'only the one valid row was added');
});

await check('--new rows land under the lock beside concurrent page updates', async () => {
  const { proj, out } = fixture();
  const rs = await Promise.all([
    run(['--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics'], proj),
    run(['--new', 'sitemap-page', '--path', '/sitemap', '--template', 'utility', '--origin', 'manual'], proj),
    run(['page-0', '--status', 'deployed'], proj), run(['page-1', '--status', 'verified'], proj),
  ]);
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const pages = readPages(out);
  assert.equal(pages.length, 10);
  assert.equal(pages.find((p) => p.slug === 'page-0').delivery.status, 'deployed');
  assert.equal(pages.find((p) => p.slug === 'sitemap-page').source.migratedHtml, 'manual:sitemap-page');
  assert.deepEqual(readTemplates(out).map((t) => t.id), ['detail', 'search', 'utility']);
  assert.equal(readConfig(out).lastRun.pages.total, 10);
  assert.deepEqual(readdirSync(out).sort(), ['coverage', 'rollout.json']);
});

await check('--help names the --new form', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help2-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /--new <slug> --path <\/delivered\/path> --template <id> --origin <origin>/); assert.deepEqual(readdirSync(proj), []);
});

await check('--gate writes delivery.gate from a gate-all summary; a failing verified page flips to failed, a passing failed one back to deployed (#125)', async () => {
  const { proj, out } = fixture();
  for (const r of await Promise.all([run(['page-0', '--status', 'verified'], proj), run(['page-1', '--status', 'deployed'], proj), run(['page-2', '--status', 'failed', '--error', 'gate: clipped 3'], proj), run(['page-3', '--status', 'verified'], proj)])) assert.equal(r.code, 0, r.err);
  const table = join(proj, 'summary.json');
  writeFileSync(table, JSON.stringify({ rows: [
    { slug: 'page-0', pct: 6.7, heightDelta: 69, clipped: 379, content: { missing: 0, hidden: 284 }, pass: false, reasons: ['clipped 379', 'content MISSING 0 / HIDDEN 284'] },
    { slug: 'page-1', pct: 1.2, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, reasons: [], round: 2 },
    { slug: 'page-2', pct: 2.0, heightDelta: 1, clipped: 0, content: null, pass: true, reasons: [] },
    { slug: 'page-3', pct: 37, heightDelta: 3, clipped: 0, pass: false, reasons: ['pixel 37% > 10%'], override: { verdict: 'source-volatile', reason: 'R-1 live drifted', valid: true } },
    { slug: 'not-in-coverage', pct: 1, pass: true, reasons: [] },
  ] }));
  const r = await run(['--gate', table], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /4 of 5 rows matched, 2 status flip\(s\)/);
  const by = Object.fromEntries(JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p.delivery]));
  assert.equal(by['page-0'].status, 'failed'); assert.equal(by['page-0'].error, 'gate: clipped 379; content MISSING 0 / HIDDEN 284'); assert.equal(by['page-0'].gate.pass, false); assert.equal(by['page-0'].gate.clipped, 379);
  assert.equal(by['page-1'].status, 'deployed'); assert.equal(by['page-1'].gate.pass, true);
  assert.equal(by['page-2'].status, 'deployed', 'a gate failure that now passes goes back to deployed'); assert.equal(by['page-2'].error, null);
  assert.equal(by['page-3'].status, 'verified', 'a valid documented override keeps the page'); assert.deepEqual(by['page-3'].gate.override, { verdict: 'source-volatile', reason: 'R-1 live drifted', valid: true });
  assert.equal(by['page-1'].gate.at, null, 'a table without _provenance has no row time'); assert.equal(by['page-1'].gate.width, null); assert.deepEqual(by['page-1'].gate.atByWidth, {});
  assert.deepEqual(by['page-1'].gate.rounds, {}, 'a round without a width has no map entry');
  assert.deepEqual(by['page-1'].gate.passByWidth, {}, 'a table without a width records no per-width verdict');
  // what --gate writes is what the pages schema declares: the six per-width keys, the override object, a null row time
  const pagesSchema = loadSchema('rollout-pages.schema.json');
  for (const slug of ['page-0', 'page-1', 'page-2', 'page-3']) assert.deepEqual(validate(pagesSchema.$defs.gate, by[slug].gate, { root: pagesSchema }), [], `${slug} delivery.gate validates`);
  assert.deepEqual(validate(loadSchema('rollout-config.schema.json').properties.lastRun, readConfig(out).lastRun, { root: loadSchema('rollout-config.schema.json') }), [], 'lastRun (contentPending included) validates');
  const bad = await run(['--gate', join(out, 'rollout.json')], proj);
  assert.equal(bad.code, 1, 'a file without rows[] is refused');
});

// --- --gate keeps the newest row per page and width: an older table never reverts a newer verdict ---
const T0 = '2026-01-01T08:00:00.000Z'; const T1 = '2026-01-02T08:00:00.000Z'; const T2 = '2026-01-03T08:00:00.000Z'; const T3 = '2026-01-04T08:00:00.000Z';
const gateTable = (proj, name, writtenAt, breakpoint, rows, prov = {}) => { const f = join(proj, name); writeFileSync(f, JSON.stringify({ _provenance: { writtenBy: 'gate-all.mjs', writtenAt, stage: 'published', breakpoint, ...prov }, totals: {}, rows })); return f; };
const passRow = (slug, extra = {}) => ({ slug, pct: 1.1, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, reasons: [], ...extra });
const failRow = (slug) => ({ slug, pct: 12, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: false, reasons: ['pixel 12% > 10%'] });
const pagesText = (out) => readFileSync(join(out, 'coverage', 'pages.json'), 'utf8');
const gateOf = (out, slug) => readPages(out).find((p) => p.slug === slug).delivery;
const stripGen = (s) => s.replace(/\n {2}"generatedAt": "[^"]*"/, '');

await check('--gate skips a row older than the page\'s recorded gate at the same width — pages.json unchanged but generatedAt, no flip, counted', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'newer.json', T2, 1440, [passRow('page-0')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 of 1 rows matched, 0 status flip\(s\), 0 older row\(s\) skipped/);
  assert.equal(gateOf(out, 'page-0').gate.at, T2); assert.equal(gateOf(out, 'page-0').gate.width, 1440); assert.deepEqual(gateOf(out, 'page-0').gate.atByWidth, { 1440: T2 });
  const before = pagesText(out);
  r = await run(['--gate', gateTable(proj, 'older.json', T1, 1440, [failRow('page-0'), failRow('not-in-coverage')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 of 2 rows matched, 0 status flip\(s\), 1 older row\(s\) skipped/, r.out);
  assert.equal(stripGen(pagesText(out)), stripGen(before), 'only the top-level generatedAt may change');
  assert.equal(gateOf(out, 'page-0').status, 'deployed');
  r = await run(['--gate', join(proj, 'newer.json')], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /0 older row\(s\) skipped/, 'the same table again (equal time) is applied');
});

await check('--gate applies a row of a width with no recorded time, even one older than the other width\'s time', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'desktop.json', T2, 1440, [passRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'mobile.json', T1, 360, [failRow('page-0')])], proj); // the first verdict at 360
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 of 1 rows matched, 1 status flip\(s\), 0 older row\(s\) skipped/, r.out);
  const d = gateOf(out, 'page-0');
  assert.equal(d.status, 'failed'); assert.equal(d.gate.pass, false); assert.equal(d.gate.width, 360); assert.equal(d.gate.at, T1);
  assert.deepEqual(d.gate.atByWidth, { 1440: T2, 360: T1 });
});

for (const [a, b] of [[1440, 360], [360, 1440]]) {
  await check(`--gate skips an older ${a} row after a newer ${b} ingest overwrote the ${a} record — pages.json unchanged but generatedAt, no flip`, async () => {
    const { proj, out } = fixture();
    let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
    r = await run(['--gate', gateTable(proj, `first-${a}.json`, T2, a, [passRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
    r = await run(['--gate', gateTable(proj, `then-${b}.json`, T3, b, [passRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
    const before = pagesText(out);
    r = await run(['--gate', gateTable(proj, `older-${a}.json`, T1, a, [failRow('page-0')])], proj);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /1 of 1 rows matched, 0 status flip\(s\), 1 older row\(s\) skipped/, r.out);
    assert.equal(stripGen(pagesText(out)), stripGen(before), 'only the top-level generatedAt may change');
    const d = gateOf(out, 'page-0');
    assert.equal(d.status, 'deployed'); assert.equal(d.gate.width, b); assert.deepEqual(d.gate.atByWidth, { [a]: T2, [b]: T3 });
    assert.deepEqual(d.gate.passByWidth, { [a]: true, [b]: true }, 'the skipped older row leaves the per-width verdicts alone');
  });
}

for (const [a, b] of [[1440, 360], [360, 1440]]) {
  await check(`--gate records each width's verdict in delivery.gate.passByWidth — ${a} then ${b} keeps both keys; pass stays the last width's verdict`, async () => {
    const { proj, out } = fixture();
    let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
    const rowAt = (w) => (w === 1440 ? passRow('page-0') : failRow('page-0'));
    r = await run(['--gate', gateTable(proj, `first-${a}.json`, T1, a, [rowAt(a)])], proj); assert.equal(r.code, 0, r.err);
    assert.deepEqual(gateOf(out, 'page-0').gate.passByWidth, { [a]: a === 1440 });
    r = await run(['--gate', gateTable(proj, `then-${b}.json`, T2, b, [rowAt(b)])], proj); assert.equal(r.code, 0, r.err);
    const d = gateOf(out, 'page-0');
    assert.deepEqual(d.gate.passByWidth, { 1440: true, 360: false });
    assert.deepEqual(Object.keys(d.gate.passByWidth).sort(), ['1440', '360'], 'keys are width strings, as atByWidth');
    assert.equal(d.gate.pass, b === 1440, 'pass keeps its meaning: the verdict of the row applied last');
    assert.equal(d.status, 'failed', 'a recorded failing width keeps the page failed, whichever width came last');
    assert.equal(d.error, 'gate: pixel 12% > 10%');
  });
}

await check('--gate: a page failing at 1440 stays failed when 360 passes last; it returns to deployed only once no recorded width fails', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'verified'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'desk.json', T1, 1440, [failRow('page-0')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 status flip\(s\)/, r.out);
  r = await run(['--gate', gateTable(proj, 'mob.json', T2, 360, [passRow('page-0')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /0 status flip\(s\)/, r.out);
  let d = gateOf(out, 'page-0');
  assert.equal(d.status, 'failed', 'the 360 pass never flips back a page the 1440 table failed');
  assert.equal(d.error, 'gate: pixel 12% > 10%');
  assert.equal(d.gate.pass, true); assert.deepEqual(d.gate.passByWidth, { 1440: false, 360: true });
  r = await run(['--gate', gateTable(proj, 'desk2.json', T3, 1440, [passRow('page-0')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 status flip\(s\)/, r.out);
  d = gateOf(out, 'page-0');
  assert.equal(d.status, 'deployed', 'every recorded width passes now'); assert.equal(d.error, null);
  assert.deepEqual(d.gate.passByWidth, { 1440: true, 360: true });
});

await check('--gate passByWidth: an override passes its width; a width re-gated replaces only its own entry', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'desk.json', T1, 1440, [{ ...failRow('page-0'), override: { verdict: 'tier-shift', reason: 'R-01', valid: true } }])], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'mob.json', T1, 360, [failRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
  assert.deepEqual(gateOf(out, 'page-0').gate.passByWidth, { 1440: true, 360: false });
  r = await run(['--gate', gateTable(proj, 'mob2.json', T2, 360, [passRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
  assert.deepEqual(gateOf(out, 'page-0').gate.passByWidth, { 1440: true, 360: true });
});

await check('--gate records a whole-row reuse at its measured time (row.reused.at), a probe reuse at the table\'s writtenAt, and the width', async () => {
  const { proj, out } = fixture();
  const r = await run(['--gate', gateTable(proj, 'runs-reuse.json', T2, 1440, [
    passRow('page-0', { reused: { what: 'row', from: 'runs/older.json', at: T0, gateKey: 'k' } }),
    passRow('page-1', { reused: { what: 'probes', at: T0 } }),
  ])], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(gateOf(out, 'page-0').gate.at, T0); assert.equal(gateOf(out, 'page-0').gate.width, 1440); assert.deepEqual(gateOf(out, 'page-0').gate.atByWidth, { 1440: T0 });
  assert.equal(gateOf(out, 'page-1').gate.at, T2); assert.equal(gateOf(out, 'page-1').gate.width, 1440);
  assert.match(gateOf(out, 'page-0').gate.table, /runs-reuse\.json$/);
});

await check('--gate overwrites a recorded gate without atByWidth (recorded before 0.34.4) even from an older table', async () => {
  const { proj, out } = fixture();
  const doc = JSON.parse(pagesText(out));
  doc.pages[0].delivery = { status: 'deployed', gate: { pass: true, pct: 1, heightDelta: 0, clipped: 0, content: null, reasons: [], override: null, table: 'summary.json', at: T2 } };
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify(doc, null, 2));
  const r = await run(['--gate', gateTable(proj, 'older.json', T1, 1440, [failRow('page-0')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 of 1 rows matched, 1 status flip\(s\), 0 older row\(s\) skipped/, r.out);
  const d = gateOf(out, 'page-0');
  assert.equal(d.status, 'failed'); assert.equal(d.gate.at, T1); assert.equal(d.gate.width, 1440); assert.deepEqual(d.gate.atByWidth, { 1440: T1 });
  assert.deepEqual(d.gate.passByWidth, { 1440: false });
});

await check('--gate records an INCONCLUSIVE row as pass false with its reasons and never flips the status either way', async () => {
  const { proj, out } = fixture();
  for (const r of await Promise.all([run(['page-0', '--status', 'verified'], proj), run(['page-1', '--status', 'failed', '--error', 'gate: pixel 12% > 10%'], proj), run(['page-2', '--status', 'deployed'], proj)])) assert.equal(r.code, 0, r.err);
  const reasons = ['origin capture polluted: overlay left — div#consent (fixed, 92 % of the viewport)', 'font-not-loaded:Brand Sans'];
  let r = await run(['--gate', gateTable(proj, 'polluted.json', T2, 1440, [
    { slug: 'page-0', inconclusive: true, pct: null, heightDelta: null, clipped: null, content: null, pass: false, passWithOverride: false, reasons, override: null, fontsNotLoaded: ['Brand Sans'] },
    passRow('page-2'),
  ])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /2 of 2 rows matched, 0 status flip\(s\), 0 older row\(s\) skipped, 1 inconclusive \(status unchanged\)$/m, r.out);
  const d = gateOf(out, 'page-0');
  assert.equal(d.status, 'verified', 'no verdict: the status stays'); assert.equal(d.error, null);
  assert.equal(d.gate.pass, false); assert.equal(d.gate.inconclusive, reasons.join('; ')); assert.equal(d.gate.pct, null); assert.deepEqual(d.gate.atByWidth, { 1440: T2 });
  assert.deepEqual(Object.keys(d.gate), ['pass', 'pct', 'heightDelta', 'clipped', 'content', 'reasons', 'inconclusive', 'override', 'table', 'at', 'width', 'atByWidth', 'passByWidth', 'rounds', 'host']);
  assert.equal(gateOf(out, 'page-2').gate.inconclusive, null, 'a measured row records inconclusive null');
  const clean = await run(['--gate', gateTable(proj, 'clean.json', T3, 1440, [passRow('page-2')])], proj);
  assert.equal(clean.code, 0, clean.err); assert.match(clean.out, /0 older row\(s\) skipped$/m, 'no inconclusive row, no suffix');
  // a page the gate failed stays failed; an inconclusive row with a valid override still never passes
  r = await run(['--gate', gateTable(proj, 'polluted-2.json', T2, 1440, [{ slug: 'page-1', inconclusive: true, pct: 4, pass: false, reasons: [], override: { verdict: 'tier-shift', reason: 'R-1', valid: true } }])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /0 status flip\(s\), 0 older row\(s\) skipped, 1 inconclusive \(status unchanged\)$/m, r.out);
  const f = gateOf(out, 'page-1');
  assert.equal(f.status, 'failed'); assert.equal(f.error, 'gate: pixel 12% > 10%'); assert.equal(f.gate.pass, false); assert.equal(f.gate.inconclusive, 'no verdict');
  assert.match((await run(['--help'], proj)).out, /inconclusive/);
});

await check('--gate records an INCONCLUSIVE width as passByWidth null — never a new false, never true; an earlier false stands — and flips no status either way; a later passing width does not lift that failure', async () => {
  const { proj, out } = fixture();
  for (const r of await Promise.all([run(['page-0', '--status', 'verified'], proj), run(['page-1', '--status', 'deployed'], proj)])) assert.equal(r.code, 0, r.err);
  let r = await run(['--gate', gateTable(proj, 'desk.json', T1, 1440, [passRow('page-0'), failRow('page-1')])], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'mob.json', T1, 360, [passRow('page-0'), passRow('page-1')])], proj); assert.equal(r.code, 0, r.err);
  assert.deepEqual(gateOf(out, 'page-1').gate.passByWidth, { 1440: false, 360: true }); assert.equal(gateOf(out, 'page-1').status, 'failed');
  const polluted = (slug) => ({ slug, inconclusive: true, pct: null, heightDelta: null, clipped: null, content: null, pass: true, reasons: ['origin capture polluted'], override: { verdict: 'tier-shift', reason: 'R-1', valid: true } });
  r = await run(['--gate', gateTable(proj, 'desk-polluted.json', T2, 1440, [polluted('page-0'), polluted('page-1')])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /2 of 2 rows matched, 0 status flip\(s\), 0 older row\(s\) skipped, 2 inconclusive \(status unchanged\)$/m, r.out);
  const ok = gateOf(out, 'page-0');
  assert.deepEqual(ok.gate.passByWidth, { 1440: null, 360: true }, 'the passing 1440 verdict is replaced by no verdict, not kept true');
  assert.equal(ok.status, 'verified', 'no verdict never fails a page'); assert.equal(ok.error, null);
  const bad = gateOf(out, 'page-1');
  assert.deepEqual(bad.gate.passByWidth, { 1440: false, 360: true }, 'the failing 1440 verdict stands: no verdict never clears it');
  assert.equal(bad.status, 'failed', 'no verdict never lifts a gate failure'); assert.equal(bad.error, 'gate: pixel 12% > 10%');
  r = await run(['--gate', gateTable(proj, 'mob-later.json', T3, 360, [passRow('page-1')])], proj); assert.equal(r.code, 0, r.err);
  const after = gateOf(out, 'page-1');
  assert.deepEqual(after.gate.passByWidth, { 1440: false, 360: true }, 'a later 360 pass leaves the 1440 failure in place');
  assert.equal(after.status, 'failed', 'a polluted 1440 row between a 1440 failure and a later 360 pass never launders the failure');
});

await check('--gate copies the validated override {verdict, reason, valid}; only valid: true passes a failing row — a raw override without valid is not valid', async () => {
  const { proj, out } = fixture();
  for (const r of await Promise.all([run(['page-0', '--status', 'failed', '--error', 'gate: pixel 37% > 10%'], proj), run(['page-1', '--status', 'verified'], proj), run(['page-2', '--status', 'verified'], proj)])) assert.equal(r.code, 0, r.err);
  const fail37 = { pct: 37, heightDelta: 3, clipped: 0, content: { missing: 0, hidden: 0 }, pass: false };
  const r = await run(['--gate', gateTable(proj, 'overrides.json', T2, 1440, [
    { slug: 'page-0', ...fail37, passWithOverride: true, reasons: ['pixel 37% > 10%'], override: { verdict: 'source-volatile', reason: 'R-2 rotating hero', valid: true } },
    { slug: 'page-1', ...fail37, passWithOverride: false, reasons: ['pixel 37% > 10%', 'override rejected: reason names no R-<nn> of stardust/replica/inconsistency-register.md'], override: { verdict: 'source-volatile', reason: 'rotating hero', valid: false, rejected: ['reason names no R-<nn> of stardust/replica/inconsistency-register.md'] } },
    { slug: 'page-2', ...fail37, reasons: ['pixel 37% > 10%'], override: { verdict: 'PASS (source capture)', reason: 'live drifted' } },
  ])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /3 of 3 rows matched, 3 status flip\(s\), 0 older row\(s\) skipped$/m, r.out);
  const v = gateOf(out, 'page-0');
  assert.equal(v.status, 'deployed', 'a valid override lifts a gate failure'); assert.equal(v.error, null); assert.equal(v.gate.pass, true);
  assert.deepEqual(v.gate.override, { verdict: 'source-volatile', reason: 'R-2 rotating hero', valid: true });
  const bad = gateOf(out, 'page-1');
  assert.equal(bad.status, 'failed', 'a rejected override is no pass'); assert.equal(bad.gate.pass, false); assert.match(bad.error, /^gate: pixel 37% > 10%; override rejected: /);
  assert.deepEqual(bad.gate.override, { verdict: 'source-volatile', reason: 'rotating hero', valid: false });
  const legacy = gateOf(out, 'page-2');
  assert.equal(legacy.status, 'failed', 'an override from a table without the check has not earned the row'); assert.equal(legacy.gate.pass, false);
  assert.deepEqual(legacy.gate.override, { verdict: 'PASS (source capture)', reason: 'live drifted', valid: false });
});

await check('--gate merges each row\'s fix-round count into delivery.gate.rounds per width; the newest row of a width sets it (also lower after a reset), a skipped older row does not', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'desktop.json', T1, 1440, [passRow('page-0', { round: 2 })])], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'mobile.json', T2, 360, [passRow('page-0', { round: 1 })])], proj); assert.equal(r.code, 0, r.err);
  assert.deepEqual(gateOf(out, 'page-0').gate.rounds, { 1440: 2, 360: 1 });
  r = await run(['--gate', gateTable(proj, 'desktop-reset.json', T3, 1440, [passRow('page-0', { round: 0, roundReset: { reason: 'template rebuilt', at: T3 } })])], proj); assert.equal(r.code, 0, r.err);
  assert.deepEqual(gateOf(out, 'page-0').gate.rounds, { 1440: 0, 360: 1 });
  r = await run(['--gate', gateTable(proj, 'desktop-old.json', T0, 1440, [passRow('page-0', { round: 5 })])], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 older row\(s\) skipped/, r.out);
  assert.deepEqual(gateOf(out, 'page-0').gate.rounds, { 1440: 0, 360: 1 }, 'a skipped older row never changes the count');
  assert.match((await run(['--help'], proj)).out, /delivery\.gate\.rounds/);
});

await check('--gate keeps the recorded rounds map for a row without a valid round (a table before rounds were counted)', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'counted.json', T1, 1440, [passRow('page-0', { round: 3 })])], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'legacy.json', T2, 1440, [failRow('page-0')])], proj); assert.equal(r.code, 0, r.err);
  let d = gateOf(out, 'page-0');
  assert.equal(d.status, 'failed', 'the newer verdict is applied'); assert.deepEqual(d.gate.atByWidth, { 1440: T2 }); assert.deepEqual(d.gate.rounds, { 1440: 3 });
  r = await run(['--gate', gateTable(proj, 'odd.json', T3, 1440, [passRow('page-0', { round: '4' }), passRow('page-1', { round: 1.5 })])], proj); assert.equal(r.code, 0, r.err);
  d = gateOf(out, 'page-0');
  assert.equal(d.gate.pass, true); assert.deepEqual(d.gate.rounds, { 1440: 3 }, 'a non-integer round is no count');
  assert.deepEqual(gateOf(out, 'page-1').gate.rounds, {});
});

await check('--help says the newest row per page and width wins and names the runs/ table', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help3-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /newest row per page and width wins/); assert.match(r.out, /delivery\.gate\.atByWidth/); assert.match(r.out, /runs\/<ts>-<slug>\.json/);
  assert.match(r.out, /delivery\.gate\.passByWidth/);
});

// --- --gate takes every table gate-all writes: the roster summary.json, an --only run's runs/<ts>-<slug>.json, the gate dir ---
const GATE_DIR = join('stardust', 'replica', 'gates', 'all-1440');
const runFile = (at, slug) => join(GATE_DIR, 'runs', `${at.replace(/[:.]/g, '-')}-${slug}.json`);
// the shape gate-all writes for `--only <slug>`: the roster's row shape, the selected page's row only
const onlyRun = (proj, at, slug, rows) => {
  const rel = runFile(at, slug); mkdirSync(join(proj, GATE_DIR, 'runs'), { recursive: true });
  writeFileSync(join(proj, rel), JSON.stringify({ _provenance: { writtenBy: 'gate-all.mjs', writtenAt: at, stage: 'published', breakpoint: 1440, only: [slug], maxRounds: 3 }, totals: { pages: rows.length }, rows }, null, 2));
  return rel;
};

await check('--gate ingests an --only run table runs/<ts>-<slug>.json (same row shape, fewer rows) like a roster summary', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'verified'], proj); assert.equal(r.code, 0, r.err);
  const rel = onlyRun(proj, T2, 'page-0', [{ ...failRow('page-0'), round: 1 }]);
  r = await run(['--gate', rel], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `gate ${rel} → 1 of 1 rows matched, 1 status flip(s), 0 older row(s) skipped\n`);
  const d = gateOf(out, 'page-0');
  assert.equal(d.status, 'failed'); assert.equal(d.error, 'gate: pixel 12% > 10%'); assert.equal(d.gate.table, rel);
  assert.equal(d.gate.at, T2); assert.equal(d.gate.width, 1440); assert.deepEqual(d.gate.rounds, { 1440: 1 });
});

await check('--gate <dir> ingests its summary.json, then runs/*.json in name order — the newest row per page and width wins whichever table holds it', async () => {
  const { proj, out } = fixture();
  for (const r of await Promise.all([run(['page-0', '--status', 'deployed'], proj), run(['page-1', '--status', 'deployed'], proj)])) assert.equal(r.code, 0, r.err);
  mkdirSync(join(proj, GATE_DIR), { recursive: true });
  gateTable(proj, join(GATE_DIR, 'summary.json'), T2, 1440, [failRow('page-0'), passRow('page-1', { round: 0 }), passRow('page-2')]);
  onlyRun(proj, T1, 'page-1', [{ ...failRow('page-1'), round: 1 }]); // a fix round before the roster: skipped
  const newer = onlyRun(proj, T3, 'page-0', [passRow('page-0', { round: 1 })]); // a fix round after the roster: wins
  const r = await run(['--gate', GATE_DIR], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `gate ${GATE_DIR} (3 tables) → 5 of 5 rows matched, 2 status flip(s), 1 older row(s) skipped\n`);
  const p0 = gateOf(out, 'page-0');
  assert.equal(p0.status, 'deployed', 'the newer --only row lifts the roster failure'); assert.equal(p0.error, null);
  assert.equal(p0.gate.pass, true); assert.equal(p0.gate.table, newer); assert.equal(p0.gate.at, T3); assert.deepEqual(p0.gate.rounds, { 1440: 1 });
  const p1 = gateOf(out, 'page-1');
  assert.equal(p1.status, 'deployed', 'an --only row older than the roster never reverts it'); assert.equal(p1.gate.pass, true);
  assert.equal(p1.gate.table, join(GATE_DIR, 'summary.json')); assert.equal(p1.gate.at, T2); assert.deepEqual(p1.gate.rounds, { 1440: 0 });
});

await check('--gate <dir>/summary.json absent while <dir>/runs/ holds tables → ingests those with one stdout note; a dir without summary.json ingests runs/ with no note', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  onlyRun(proj, T1, 'page-0', [{ ...failRow('page-0'), round: 1 }]);
  const last = onlyRun(proj, T2, 'page-0', [passRow('page-0', { round: 2 })]);
  const summary = join(GATE_DIR, 'summary.json');
  r = await run(['--gate', summary], proj);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.split('\n'), [
    `summary.json absent — an --only run writes runs/<ts>-<slug>.json; ingested 2 table(s) from ${GATE_DIR}/runs/`,
    `gate ${GATE_DIR}/runs/ (2 tables) → 2 of 2 rows matched, 2 status flip(s), 0 older row(s) skipped`, '',
  ]);
  const d = gateOf(out, 'page-0');
  assert.equal(d.status, 'deployed'); assert.equal(d.gate.table, last); assert.equal(d.gate.at, T2); assert.deepEqual(d.gate.rounds, { 1440: 2 });
  r = await run(['--gate', GATE_DIR], proj);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, `gate ${GATE_DIR} (2 tables) → 2 of 2 rows matched, 0 status flip(s), 1 older row(s) skipped\n`, 'the same tables again: the older fix round is skipped');
  assert.equal(gateOf(out, 'page-0').gate.at, T2);
});

await check('--gate refuses a path that does not exist (exit 1, `<path> not found`) — no runs/ table beside a summary.json, a mistyped run table, an empty gate dir; nothing written', async () => {
  const { proj, out } = fixture();
  const before = pagesText(out);
  const summary = join(GATE_DIR, 'summary.json');
  const expectRefused = async (path, msg) => {
    const r = await run(['--gate', path], proj);
    assert.equal(r.code, 1, `${path}: ${r.out}`); assert.equal(r.err, `rollout: ${msg}\n`); assert.equal(r.out, '');
    assert.equal(pagesText(out), before, 'pages.json untouched');
  };
  await expectRefused(summary, `${summary} not found`);
  mkdirSync(join(proj, GATE_DIR, 'runs'), { recursive: true });
  writeFileSync(join(proj, GATE_DIR, 'runs', 'notes.txt'), 'not a table');
  await expectRefused(summary, `${summary} not found`);
  await expectRefused(runFile(T2, 'page-0'), `${runFile(T2, 'page-0')} not found`);
  await expectRefused(GATE_DIR, `${GATE_DIR} holds no gate-all table (no summary.json, no runs/*.json)`);
});

await check('--gate names an unparsable file by its own error, and "not a gate-all summary (no rows[])" only a parsed file without rows — exit 1, nothing written, a bad table in a dir refuses the whole dir', async () => {
  const { proj, out } = fixture();
  const before = pagesText(out);
  writeFileSync(join(proj, 'truncated.json'), '{"_provenance": {"writtenBy": "gate-all.mjs"}, "rows": [');
  let r = await run(['--gate', 'truncated.json'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /^rollout: truncated\.json does not parse as JSON \(.+\)\n$/); assert.doesNotMatch(r.err, /no rows\[\]|not found/);
  writeFileSync(join(proj, 'rounds.json'), JSON.stringify({ rounds: 1, max: 3, at: [T1] }));
  r = await run(['--gate', 'rounds.json'], proj);
  assert.equal(r.code, 1); assert.equal(r.err, 'rollout: rounds.json is not a gate-all summary (no rows[])\n');
  mkdirSync(join(proj, GATE_DIR, 'runs'), { recursive: true });
  gateTable(proj, join(GATE_DIR, 'summary.json'), T2, 1440, [failRow('page-0')]);
  const empty = runFile(T3, 'page-0'); writeFileSync(join(proj, empty), '');
  r = await run(['--gate', GATE_DIR], proj);
  assert.equal(r.code, 1); assert.ok(r.err.startsWith(`rollout: ${empty} does not parse as JSON (`), r.err);
  assert.equal(pagesText(out), before, 'pages.json untouched');
});

await check('--gate refuses a table it cannot read (exit 1, `<path> cannot be read (<code>)`) — a directory named x.json in runs/ refuses the whole ingest; nothing written', async () => {
  const { proj, out } = fixture();
  const before = pagesText(out);
  const unreadable = join(GATE_DIR, 'runs', 'x.json'); mkdirSync(join(proj, unreadable), { recursive: true });
  const expectRefused = async (path) => {
    const r = await run(['--gate', path], proj);
    assert.equal(r.code, 1, `${path}: ${r.out}`); assert.equal(r.err, `rollout: ${unreadable} cannot be read (EISDIR)\n`); assert.equal(r.out, '');
    assert.equal(pagesText(out), before, 'pages.json untouched');
  };
  await expectRefused(join(GATE_DIR, 'summary.json')); // absent: falls back to runs/
  await expectRefused(GATE_DIR);
  gateTable(proj, join(GATE_DIR, 'summary.json'), T2, 1440, [failRow('page-0')]);
  await expectRefused(GATE_DIR);
});

await check('--help names the gate dir form, the absent summary.json note and every refusal, each also on the exit-code line', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help4-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0);
  for (const s of ['--gate <table | dir>', 'runs/*.json in name order', 'summary.json absent — an --only run writes runs/<ts>-<slug>.json', '<path> not found', '<path> cannot be read (<code>)', 'does not parse as JSON', 'not a gate-all summary (no rows[])', '<dir> holds no gate-all table']) assert.ok(r.out.includes(s), s);
  const exit = r.out.slice(r.out.indexOf('Exit 0 ok'));
  for (const s of ['not found', 'cannot be read', 'unparsable', 'no rows[]', 'holds no gate-all table']) assert.ok(exit.includes(s), `exit-code line: ${s}`);
});

// --- --gate records which EDS host each verdict was measured against: the preview host by default, the live one under --eds-host ---
const PREVIEW = 'https://main--site--org.aem.page'; const LIVE = 'https://main--site--org.aem.live';

await check('--gate records delivery.gate.host — the row\'s host (a trailing slash trimmed), else the table\'s _provenance.eds, else null', async () => {
  const { proj, out } = fixture();
  let r = await run(['--gate', gateTable(proj, 'hosts.json', T1, 1440, [passRow('page-0', { host: `${LIVE}/` }), passRow('page-1'), passRow('page-2', { host: null })], { eds: PREVIEW })], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `gate ${join(proj, 'hosts.json')} → 3 of 3 rows matched, 0 status flip(s), 0 older row(s) skipped\n`, 'the result line is unchanged');
  assert.equal(gateOf(out, 'page-0').gate.host, LIVE, 'the row\'s own host wins over the table\'s');
  assert.equal(gateOf(out, 'page-1').gate.host, PREVIEW, 'no row host: the table\'s _provenance.eds');
  assert.equal(gateOf(out, 'page-2').gate.host, PREVIEW, 'a null row host: the table\'s _provenance.eds');
  r = await run(['--gate', gateTable(proj, 'bare.json', T2, 1440, [passRow('page-0'), passRow('page-1', { host: '' })])], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(gateOf(out, 'page-0').gate.host, null, 'neither: null — a newer row never inherits the older record\'s host');
  assert.equal(gateOf(out, 'page-1').gate.host, null);
  r = await run(['--gate', gateTable(proj, 'slash.json', T3, 1440, [passRow('page-0')], { eds: `${LIVE}/` })], proj);
  assert.equal(r.code, 0, r.err); assert.equal(gateOf(out, 'page-0').gate.host, LIVE, 'the provenance fallback is trimmed alike');
  assert.match((await run(['--help'], proj)).out, /delivery\.gate\.host/);
});

await check('--gate leaves the recorded host when it skips an older row — pages.json unchanged but generatedAt', async () => {
  const { proj, out } = fixture();
  let r = await run(['page-0', '--status', 'deployed'], proj); assert.equal(r.code, 0, r.err);
  r = await run(['--gate', gateTable(proj, 'roster-live.json', T2, 1440, [passRow('page-0', { host: LIVE })], { eds: LIVE })], proj); assert.equal(r.code, 0, r.err);
  assert.equal(gateOf(out, 'page-0').gate.host, LIVE);
  const before = pagesText(out);
  r = await run(['--gate', gateTable(proj, 'preview-older.json', T1, 1440, [failRow('page-0')], { eds: PREVIEW })], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /1 older row\(s\) skipped/, r.out);
  assert.equal(stripGen(pagesText(out)), stripGen(before), 'only the top-level generatedAt may change');
  assert.equal(gateOf(out, 'page-0').gate.host, LIVE);
});

await check('--gate <dir> takes each row\'s host from its own table — the row\'s host, else that table\'s _provenance.eds, else null', async () => {
  const { proj, out } = fixture();
  mkdirSync(join(proj, GATE_DIR, 'runs'), { recursive: true });
  gateTable(proj, join(GATE_DIR, 'summary.json'), T1, 1440, [passRow('page-0'), passRow('page-1'), passRow('page-2'), passRow('page-3')], { eds: PREVIEW });
  gateTable(proj, runFile(T2, 'page-0'), T2, 1440, [passRow('page-0')], { eds: LIVE });
  gateTable(proj, runFile(T2, 'page-1'), T2, 1440, [passRow('page-1', { host: LIVE })], { eds: PREVIEW });
  gateTable(proj, runFile(T2, 'page-2'), T2, 1440, [passRow('page-2')]);
  const r = await run(['--gate', GATE_DIR], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /\(4 tables\) → 7 of 7 rows matched/, r.out);
  assert.equal(gateOf(out, 'page-0').gate.host, LIVE, 'its runs/ table\'s _provenance.eds, not the summary\'s');
  assert.equal(gateOf(out, 'page-1').gate.host, LIVE, 'its row host');
  assert.equal(gateOf(out, 'page-2').gate.host, null, 'its runs/ table names no host: null, not the summary\'s');
  assert.equal(gateOf(out, 'page-3').gate.host, PREVIEW, 'only the summary holds it');
});

console.log(failed ? `update-coverage: ${failed} check(s) failed` : 'update-coverage: all checks passed');
// --- --new keeps the roster's source URL: a planned page re-created by hand is a real page, not a synthesized one ---
await check('--new keeps source.sourceUrl for a page the roster knows — a prior roster row (updated, not refused as captured), else stardust/state.json by slug, else by delivered path — retires its excluded[] row, and stays synthesized (same shape) for a page no roster names', async () => {
  const { proj, out } = fixture();
  const pagesSchema = loadSchema('rollout-pages.schema.json');
  const rosterRow = { slug: 'about', path: '/about', title: 'About', templateId: 'home', representative: 'home', source: { migratedHtml: null, metaJson: null, sourceHash: 'sha256:' + 'a'.repeat(64), currentStatePath: null, sourceUrl: 'https://example.com/about.html' }, blocks: ['hero'], widgets: [], delivery: { status: 'content-pending', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null } };
  const doc = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8'));
  doc.pages.push(rosterRow);
  doc.excluded = [{ slug: 'faq', path: '/faq', sourceUrl: 'https://example.com/faq/', status: 'excluded', reason: 'not captured', at: null }];
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify(doc, null, 2));
  writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ pages: [{ slug: 'about', url: 'https://example.com/about.html' }, { slug: 'faq', url: 'https://example.com/faq/' }, { slug: 'kontakt', url: 'https://example.com/contact' }] }));
  // a roster row (no document): updated, its URL kept
  let r = await run(['--new', 'about', '--path', '/about', '--template', 'about', '--origin', 'unique', '--status', 'verified'], proj);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^about updated \(unique\) → \/about {3}template about · verified {3}source https:\/\/example\.com\/about\.html$/m, r.out);
  let row = readPages(out).find((p) => p.slug === 'about');
  assert.deepEqual(row.source, { migratedHtml: 'unique:about', metaJson: null, sourceHash: row.source.sourceHash, sourceUrl: 'https://example.com/about.html' });
  assert.equal(row.delivery.status, 'verified');
  assert.deepEqual(validate(pagesSchema.$defs.page, row, { root: pagesSchema }), []);
  // the roster by slug: the URL from state.json; the excluded[] row for it is retired (the key goes with the last row)
  r = await run(['--new', 'faq', '--path', '/faq', '--template', 'faq', '--origin', 'unique'], proj);
  assert.equal(r.code, 0, r.err);
  row = readPages(out).find((p) => p.slug === 'faq');
  assert.equal(row.source.sourceUrl, 'https://example.com/faq/');
  assert.ok(!('excluded' in JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8'))), 'the planned page exists now: no excluded[] row for it');
  // the roster by delivered path (another slug): the URL still found
  r = await run(['--new', 'contact', '--path', '/contact/', '--template', 'contact', '--origin', 'unique'], proj);
  assert.equal(r.code, 0, r.err);
  assert.equal(readPages(out).find((p) => p.slug === 'contact').source.sourceUrl, 'https://example.com/contact');
  // no roster entry: synthesized, the shape unchanged (no sourceUrl key), the result line unchanged
  r = await run(['--new', 'search', '--path', '/search', '--template', 'search', '--origin', 'dynamics'], proj);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^search added \(dynamics\) → \/search {3}template search · pending$/m, r.out);
  assert.deepEqual(Object.keys(readPages(out).find((p) => p.slug === 'search').source).sort(), SOURCE_KEYS);
  // a captured page (a migrated file) is still refused
  const d2 = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8'));
  d2.pages.find((p) => p.slug === 'page-1').source = { migratedHtml: 'stardust/migrated/page-1.html', sourceHash: 'sha256:' + 'b'.repeat(64), sourceUrl: 'https://example.com/page-1' };
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify(d2, null, 2));
  r = await run(['--new', 'page-1', '--path', '/page-1', '--template', 'x', '--origin', 'unique'], proj);
  assert.equal(r.code, 1); assert.match(r.err, /"page-1" is a captured page \(source stardust\/migrated\/page-1\.html\)/);
  assert.deepEqual(validate(pagesSchema.$defs.page, readPages(out).find((p) => p.slug === 'contact'), { root: pagesSchema }), [], 'a roster-matched row validates as a page');
});

process.exit(failed ? 1 : 0);
