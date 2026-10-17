#!/usr/bin/env node
// skills/rollout/scripts/test/blocks.test.mjs — the blocks.mjs contract for blocks the export can see:
// every subdirectory of the project's blocks/ that holds <name>.js or <name>.css is a delivered block
// and gets a ledger row even when no page lists it (source `blocks-dir`, status converted; a chrome name
// delivers as a fragment); a directory equal to a planned block's id, EDS name or edsBlockName is not
// duplicated, and header and nav are one chrome; a prior delivery (a block recorded not-delivered with
// its reason) survives a re-run; a re-run writes the same bytes but timestamps; a missing blocks dir is a
// note, never an error; every key written is declared in the (closed) rollout schemas.
// Run: node plugins/stardust/skills/rollout/scripts/test/blocks.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'blocks.mjs');
const made = [];
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// A project root holding stardust/rollout (pages + rollout.json) and, optionally, blocks/<name>/<file>.
const project = ({ pages, dirBlocks = {}, priorBlocks = null }) => {
  const proj = mkdtempSync(join(tmpdir(), 'rollout-blocks-test-'));
  made.push(proj);
  const out = join(proj, 'stardust', 'rollout');
  mkdirSync(join(out, 'coverage'), { recursive: true });
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages }, null, 2));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify({ site: {}, _provenance: { stardustVersion: '9.9.9' } }, null, 2));
  if (priorBlocks) writeFileSync(join(out, 'coverage', 'blocks.json'), JSON.stringify({ blocks: priorBlocks }, null, 2));
  for (const [name, files] of Object.entries(dirBlocks)) {
    mkdirSync(join(proj, 'blocks', name), { recursive: true });
    for (const f of files) writeFileSync(join(proj, 'blocks', name, f), `/* ${f} */\n`);
  }
  return { proj, out };
};
const run = (proj, ...args) => spawnSync(process.execPath, [SCRIPT, '--out', join('stardust', 'rollout'), ...args], { cwd: proj, encoding: 'utf8' });
const ledger = (out) => JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8')).blocks;
const byId = (out) => Object.fromEntries(ledger(out).map((b) => [b.id, b]));
const page = (slug, blocks, templateId = 'detail') => ({ slug, templateId, blocks, delivery: { status: 'pending' } });

check('--help names --blocks and writes nothing', () => {
  const proj = mkdtempSync(join(tmpdir(), 'rollout-blocks-help-'));
  made.push(proj);
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: proj, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--blocks <dir>/);
  assert.match(r.stdout, /blocks-dir/);
  assert.deepEqual(readdirSync(proj), []);
});

check('a blocks/ directory no page lists is registered converted (source blocks-dir), sorted with the planned rows', () => {
  const { proj, out } = project({ pages: [page('home', ['hero'])], dirBlocks: { hero: ['hero.js', 'hero.css'], promo: ['promo.css'], 'site-search': ['site-search.js'] } });
  const r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['hero', 'promo', 'site-search']);
  const promo = byId(out).promo;
  assert.deepEqual(promo, {
    id: 'promo', label: 'promo', kind: 'module', signature: 'module:promo', source: 'blocks-dir',
    usedByTemplates: [], usedByPages: [], instanceCount: 0,
    delivery: { status: 'converted', edsBlockName: 'promo', blockPath: null, convertedAt: null },
  });
  assert.equal(byId(out).hero.source, null, 'a planned row keeps its own shape');
  assert.equal(byId(out).hero.delivery.status, 'pending');
  assert.match(r.stdout, /^Registered {2}2 block\(s\) from blocks\/ that no page lists: promo, site-search$/m, r.stdout);
  const counts = JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun.blocks;
  assert.equal(counts.total, 3); assert.equal(counts.converted, 2);
});

check('a chrome name under blocks/ delivers as a fragment; a directory without <name>.js or <name>.css is no block', () => {
  const { proj, out } = project({ pages: [page('home', ['hero'])], dirBlocks: { footer: ['footer.js'], shared: ['utils.js'], empty: [] } });
  const r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['footer', 'hero']);
  const footer = byId(out).footer;
  assert.equal(footer.kind, 'chrome'); assert.equal(footer.signature, 'chrome:footer');
  assert.deepEqual(footer.delivery, { status: 'converted', edsBlockName: null, blockPath: 'fragments/footer.html', convertedAt: null });
});

check('a directory equal to a planned block\'s id or edsBlockName is not duplicated', () => {
  const { proj, out } = project({
    pages: [page('home', ['Hero Banner', 'cards', 'header']), page('about', ['cards'], 'about')],
    dirBlocks: { 'hero-banner': ['hero-banner.js'], cards: ['cards.css'], header: ['header.js'] },
  });
  const r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['cards', 'header', 'Hero Banner']);
  assert.equal(byId(out)['Hero Banner'].delivery.edsBlockName, 'hero-banner');
  assert.equal(byId(out).cards.instanceCount, 2);
  assert.doesNotMatch(r.stdout, /^Registered/m, r.stdout);
});

check('a prior not-delivered delivery (with its reason) survives a re-run; the re-run writes the same bytes but timestamps', () => {
  const prior = [{ id: 'promo', label: 'promo', kind: 'module', signature: 'module:promo', source: 'blocks-dir', usedByTemplates: [], usedByPages: [], instanceCount: 0, delivery: { status: 'not-delivered', edsBlockName: 'promo', blockPath: null, convertedAt: null, reason: 'kept for a later campaign' } }];
  const { proj, out } = project({ pages: [page('home', ['hero'])], dirBlocks: { promo: ['promo.js'], teaser: ['teaser.js'] }, priorBlocks: prior });
  let r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(byId(out).promo.delivery, prior[0].delivery);
  assert.equal(byId(out).teaser.delivery.status, 'converted');
  const strip = (s) => s.replace(/"(writtenAt|generatedAt|at)": "[^"]*"/g, '"$1": "<t>"');
  const first = strip(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8'));
  const firstCfg = strip(readFileSync(join(out, 'rollout.json'), 'utf8'));
  r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(strip(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8')), first);
  assert.equal(strip(readFileSync(join(out, 'rollout.json'), 'utf8')), firstCfg);
});

check('a missing blocks dir is a note, not an error; --blocks <dir> reads another directory', () => {
  const { proj, out } = project({ pages: [page('home', ['hero'])] });
  let r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no blocks\/ directory/, r.stdout);
  assert.deepEqual(ledger(out).map((b) => b.id), ['hero']);
  mkdirSync(join(proj, 'eds', 'blocks', 'promo'), { recursive: true });
  writeFileSync(join(proj, 'eds', 'blocks', 'promo', 'promo.js'), '');
  r = run(proj, '--blocks', join('eds', 'blocks'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['hero', 'promo']);
  assert.match(r.stdout, /^Registered {2}1 block\(s\) from eds\/blocks\/ that no page lists: promo$/m, r.stdout);
});

check('a planned chrome row covers its directory by id, edsName(id) or edsBlockName; header and nav are one chrome', () => {
  let { proj, out } = project({ pages: [page('home', ['Header', 'hero'])], dirBlocks: { header: ['header.js'], hero: ['hero.js'] } });
  let r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['Header', 'hero'], 'Header covers blocks/header/ by its EDS name');
  ({ proj, out } = project({ pages: [page('home', ['nav', 'hero'])], dirBlocks: { header: ['header.js'], footer: ['footer.css'] } }));
  r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['footer', 'hero', 'nav'], 'a planned nav covers blocks/header/ — no second chrome row');
  ({ proj, out } = project({ pages: [page('home', ['hero'])], dirBlocks: { header: ['header.js'], nav: ['nav.js'] } }));
  r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledger(out).map((b) => b.id), ['header', 'hero'], 'blocks/header/ and blocks/nav/ register one chrome row');
});

// The schemas are closed (additionalProperties: false): every key written must be declared there.
const SCHEMAS = join(HERE, '..', '..', 'schemas');
const schema = (f) => JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8'));
const undeclared = (obj, props) => Object.keys(obj).filter((k) => !(k in props));

check('every key blocks.mjs writes is declared in the rollout schemas — a blocks-dir row, a not-delivered row with its reason, lastRun.blocks.notDelivered', () => {
  const prior = [{ id: 'promo', label: 'promo', kind: 'module', signature: 'module:promo', source: 'blocks-dir', usedByTemplates: [], usedByPages: [], instanceCount: 0, delivery: { status: 'not-delivered', edsBlockName: 'promo', blockPath: null, convertedAt: null, reason: 'kept for a later campaign' } }];
  const { proj, out } = project({ pages: [page('home', ['hero', 'header'])], dirBlocks: { promo: ['promo.js'], teaser: ['teaser.css'], footer: ['footer.js'] }, priorBlocks: prior });
  const r = run(proj);
  assert.equal(r.status, 0, r.stderr);
  const bs = schema('rollout-blocks.schema.json');
  const doc = JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8'));
  assert.deepEqual(undeclared(doc, bs.properties), []);
  const blockDef = bs.$defs.block; const deliveryDef = blockDef.properties.delivery;
  assert.deepEqual(doc.blocks.map((b) => b.id), ['footer', 'header', 'hero', 'promo', 'teaser']);
  for (const b of doc.blocks) {
    assert.deepEqual(undeclared(b, blockDef.properties), [], b.id);
    for (const k of blockDef.required) assert.ok(k in b, `${b.id} lacks ${k}`);
    assert.ok(blockDef.properties.kind.enum.includes(b.kind), `${b.id} kind ${b.kind}`);
    assert.deepEqual(undeclared(b.delivery, deliveryDef.properties), [], `${b.id} delivery`);
    assert.ok(deliveryDef.properties.status.enum.includes(b.delivery.status), `${b.id} status ${b.delivery.status}`);
    if (b.delivery.status === 'not-delivered') assert.ok(deliveryDef.then.required.includes('reason') && b.delivery.reason, `${b.id}: not-delivered carries its reason`);
  }
  const cs = schema('rollout-config.schema.json');
  const lastRun = JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun;
  const blocksDef = cs.properties.lastRun.properties.blocks.properties;
  assert.deepEqual(undeclared(lastRun, cs.properties.lastRun.properties), []);
  assert.deepEqual(undeclared(lastRun.blocks, blocksDef), []);
  assert.deepEqual(lastRun.blocks, { total: 5, converted: 2, notDelivered: 1, pending: 2 });
});

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
