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
// with no recorded time, or a record without the map, is applied; each width keeps its own verdict
// (delivery.gate.passByWidth) whichever table came last, and a page leaves a gate failure for deployed only
// when no recorded width failed. And `--block <name> --status
// not-delivered --reason <text>`: the reason is required (exit 2), recorded as delivery.reason, cleared by
// any other status, the block found by id then by edsBlockName, and counted in lastRun.blocks.notDelivered.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { blockCounts } from '../lib.mjs';

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
    { slug: 'page-1', pct: 1.2, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, reasons: [] },
    { slug: 'page-2', pct: 2.0, heightDelta: 1, clipped: 0, content: null, pass: true, reasons: [] },
    { slug: 'page-3', pct: 37, heightDelta: 3, clipped: 0, pass: false, reasons: ['pixel 37% > 10%'], override: { verdict: 'PASS (source capture)', reason: 'live drifted' } },
    { slug: 'not-in-coverage', pct: 1, pass: true, reasons: [] },
  ] }));
  const r = await run(['--gate', table], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /4 of 5 rows matched, 2 status flip\(s\)/);
  const by = Object.fromEntries(JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p.delivery]));
  assert.equal(by['page-0'].status, 'failed'); assert.equal(by['page-0'].error, 'gate: clipped 379; content MISSING 0 / HIDDEN 284'); assert.equal(by['page-0'].gate.pass, false); assert.equal(by['page-0'].gate.clipped, 379);
  assert.equal(by['page-1'].status, 'deployed'); assert.equal(by['page-1'].gate.pass, true);
  assert.equal(by['page-2'].status, 'deployed', 'a gate failure that now passes goes back to deployed'); assert.equal(by['page-2'].error, null);
  assert.equal(by['page-3'].status, 'verified', 'a documented override keeps the page'); assert.equal(by['page-3'].gate.override, 'PASS (source capture)');
  assert.equal(by['page-1'].gate.at, null, 'a table without _provenance has no row time'); assert.equal(by['page-1'].gate.width, null); assert.deepEqual(by['page-1'].gate.atByWidth, {});
  assert.deepEqual(by['page-1'].gate.passByWidth, {}, 'a table without a width records no per-width verdict');
  const bad = await run(['--gate', join(out, 'rollout.json')], proj);
  assert.equal(bad.code, 1, 'a file without rows[] is refused');
});

// --- --gate keeps the newest row per page and width: an older table never reverts a newer verdict ---
const T0 = '2026-01-01T08:00:00.000Z'; const T1 = '2026-01-02T08:00:00.000Z'; const T2 = '2026-01-03T08:00:00.000Z'; const T3 = '2026-01-04T08:00:00.000Z';
const gateTable = (proj, name, writtenAt, breakpoint, rows) => { const f = join(proj, name); writeFileSync(f, JSON.stringify({ _provenance: { writtenBy: 'gate-all.mjs', writtenAt, stage: 'published', breakpoint }, totals: {}, rows })); return f; };
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

await check('--help says the newest row per page and width wins and names the runs/ table', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help3-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /newest row per page and width wins/); assert.match(r.out, /delivery\.gate\.atByWidth/); assert.match(r.out, /runs\/<ts>-<slug>\.json/);
  assert.match(r.out, /delivery\.gate\.passByWidth/);
});

console.log(failed ? `update-coverage: ${failed} check(s) failed` : 'update-coverage: all checks passed');
process.exit(failed ? 1 : 0);
