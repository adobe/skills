#!/usr/bin/env node
// skills/rollout/scripts/test/blocks.test.mjs — the blocks.mjs contract on the delivered-site fixture
// (inventory → blocks → conversions recorded with update-coverage → blocks): module rows carry
// variants (ids, classes, pages, instances) from pages.json `delivered`, optionClasses (authored plus
// CSS-only), description, contract (identity scrubbed) and baseType (standard, alias, unknown); a
// judgement lands on the blocks and on template names without re-running inventory; formatVersion and
// the schema; a re-run leaves blocks.json and templates.json byte-identical; no identity strings;
// chrome and default-content rows unchanged; _provenance.inputs hashes every judgement, conversion-log
// and block-code file read; --blocks picks the block code; --help writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/blocks.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, validate } from './schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const root = mkdtempSync(join(tmpdir(), 'rollout-blocks-test-'));
const editJSON = (p, fn) => { const d = JSON.parse(readFileSync(p, 'utf8')); fn(d); writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`); };
// A copy of the shared fixture plus test-local additions: chrome modules, a module mapped to default
// content, and a module whose name is an alias of a standard block (it has no delivered instance).
const prepare = (target) => {
  cpSync(join(HERE, 'fixtures', 'delivered-site'), target, { recursive: true });
  editJSON(join(target, 'stardust', 'migrated', '_meta.json'), (m) => m.modules.push('header', 'footer', 'heading'));
  editJSON(join(target, 'stardust', 'migrated', 'de', 'ueber-uns._meta.json'), (m) => m.modules.push('breadcrumb'));
  return target;
};
const CONVERSIONS = [['hero-banner', 'hero'], ['link-list', 'teaser'], ['three-up', 'columns'], ['heading', 'default-content']];
const dir = prepare(join(root, 'site'));
const OUT = join(dir, 'stardust', 'rollout');
const cov = (f) => join(OUT, 'coverage', f);
const readOr = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const json = (f) => JSON.parse(readFileSync(cov(f), 'utf8'));
const row = (id) => json('blocks.json').blocks.find((b) => b.id === id) || assert.fail(`no blocks.json row ${id}`);
const run = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
const vid = (identity) => `v_${createHash('sha256').update(`stardust-variant:${identity}`).digest('hex').slice(0, 12)}`;
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const NEEDLES = ['fixture-org', 'fixture-site', 'aem.page', 'aem.live', 'content.da.live', 'github.com/fixture-owner'];
const BASE_KEYS = ['id', 'label', 'kind', 'signature', 'source', 'usedByTemplates', 'usedByPages', 'instanceCount', 'delivery'];
const ENRICHED_KEYS = [...BASE_KEYS, 'optionClasses', 'variants', 'description', 'contract', 'baseType'];
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e && e.message).split('\n').join('\n  ')}`); } };
const ok = (r, what) => assert.equal(r.status, 0, `${what}: exit ${r.status}\n  ${(r.stderr || r.stdout || '').trim().slice(0, 600)}`);

const inventory = run('inventory.mjs');
const first = run('blocks.mjs');
const conversions = CONVERSIONS.map(([id, name]) => [id, run('update-coverage.mjs', '--block', id, '--status', 'converted', '--eds-name', name)]);
const recorded = readOr(cov('blocks.json'));
const second = run('blocks.mjs');
const defaultKeys = (() => { try { return Object.keys(json('blocks.json')._provenance.inputs); } catch { return null; } })();

check('setup: inventory, blocks and the recorded conversions run; before the conversions, delivered names without a module row are named on one line', () => {
  ok(inventory, 'inventory.mjs');
  ok(first, 'blocks.mjs (first run)');
  for (const [id, r] of conversions) ok(r, `update-coverage.mjs --block ${id}`);
  ok(second, 'blocks.mjs (after the conversions)');
  const unmatched = first.stdout.split('\n').filter((l) => l.startsWith('Unmatched'));
  assert.equal(unmatched.length, 1, first.stdout);
  assert.match(unmatched[0], /3 delivered block name\(s\) with no module row: columns, hero, teaser/);
  assert.doesNotMatch(second.stdout, /^Unmatched/m, second.stdout);
});

check('variants: one per class set in pages.json delivered.blocks — design ids equal to the page records, sorted classes, distinct pages, instances', () => {
  assert.deepEqual(row('link-list').variants, [
    { id: vid('teaser|'), classes: [], pages: 1, instances: 1 },
    { id: vid('teaser|list'), classes: ['list'], pages: 1, instances: 1 },
    { id: vid('teaser|list secure'), classes: ['list', 'secure'], pages: 2, instances: 3 },
  ]);
  assert.deepEqual(row('hero-banner').variants, [
    { id: vid('hero|'), classes: [], pages: 1, instances: 1 },
    { id: vid('hero|dark'), classes: ['dark'], pages: 1, instances: 1 },
  ]);
  assert.deepEqual(row('three-up').variants, [
    { id: vid('columns|'), classes: [], pages: 1, instances: 1 },
    { id: vid('columns|wide'), classes: ['wide'], pages: 1, instances: 1 },
  ]);
  assert.deepEqual(row('breadcrumb').variants, [], 'a module with no delivered instance has no variant');
  const ids = new Map(json('blocks.json').blocks.flatMap((b) => (b.variants || []).map((v) => [`${b.delivery.edsBlockName}|${v.classes.join(' ')}`, v.id])));
  for (const p of json('pages.json').pages) {
    for (const r of (p.delivered && p.delivered.blocks) || []) {
      if (r.kind === 'block') assert.equal(ids.get(`${r.block}|${r.classes.join(' ')}`), r.variantId, `${p.slug} #${r.pos}`);
    }
  }
});

check('optionClasses: classes authored on instances ∪ classes chained in the block CSS (compact, centered, stacked are CSS-only)', () => {
  assert.deepEqual(row('link-list').optionClasses, ['compact', 'list', 'secure']);
  assert.deepEqual(row('hero-banner').optionClasses, ['centered', 'dark']);
  assert.deepEqual(row('three-up').optionClasses, ['stacked', 'wide']);
  assert.deepEqual(row('breadcrumb').optionClasses, []);
});

check('description and contract: the first sentence of the JSDoc right before `export default`, cut at @tags (a helper JSDoc above is skipped; null without one); the conversion-log bullet scrubbed (null without one)', () => {
  assert.equal(row('link-list').description, 'Teaser block: a list of linked cards, each with a title and a short text.');
  assert.equal(row('hero-banner').description, 'Hero block: a full-width picture with the page heading.');
  assert.equal(row('breadcrumb').description, 'loads and decorates the block', 'the export default JSDoc, not the helper above it, and no @param');
  assert.equal(row('three-up').description, null);
  const teaser = row('link-list').contract;
  assert.match(teaser, /one row per card.*Checked on https:\/\/<(?:site|host)>\/about-us before the push\./);
  assert.doesNotMatch(teaser, /teaser-extra|only starts like|outside the contract/, 'exact name, contract section only');
  const hero = row('hero-banner').contract;
  assert.match(hero, /row 1 the picture, row 2 the heading/);
  assert.match(hero, /<repo-url>/);
  assert.match(hero, /<da-path>/);
  assert.deepEqual([row('three-up').contract, row('breadcrumb').contract], [null, null]);
});

check('baseType: a standard name, an alias (breadcrumb → breadcrumbs), unknown; no judged keys without a judgement; enriched keys after delivery', () => {
  assert.deepEqual(['hero-banner', 'three-up', 'breadcrumb', 'link-list'].map((id) => row(id).baseType), ['hero', 'columns', 'breadcrumbs', 'unknown']);
  for (const id of ['hero-banner', 'three-up', 'breadcrumb', 'link-list']) assert.deepEqual(Object.keys(row(id)), ENRICHED_KEYS, id);
});

check('chrome and default-content rows: unchanged by the enrichment (base keys only, same values as recorded)', () => {
  const before = new Map(JSON.parse(recorded).blocks.map((b) => [b.id, b]));
  const base = (b) => Object.fromEntries(BASE_KEYS.map((k) => [k, b[k]]));
  for (const id of ['header', 'footer', 'heading']) {
    assert.deepEqual(Object.keys(row(id)), BASE_KEYS, id);
    assert.deepEqual(row(id), base(before.get(id)), id);
  }
  assert.deepEqual([row('header').kind, row('footer').kind, row('heading').delivery.edsBlockName], ['chrome', 'chrome', 'default-content']);
});

check('formatVersion and schema: blocks.json is { _provenance, formatVersion 0.1.0, generatedAt, blocks } and validates; templates.json too', () => {
  const b = json('blocks.json');
  assert.deepEqual(Object.keys(b), ['_provenance', 'formatVersion', 'generatedAt', 'blocks']);
  assert.equal(b.formatVersion, '0.1.0');
  assert.deepEqual(validate(loadSchema('rollout-blocks.schema.json'), b), []);
  assert.deepEqual(validate(loadSchema('rollout-templates.schema.json'), json('templates.json')), []);
});

check('provenance inputs: every block-code file and the conversion log read, project-relative path → sha256 of the bytes on disk, keys sorted (no judgement yet)', () => {
  const inputs = json('blocks.json')._provenance.inputs;
  assert.deepEqual(Object.keys(inputs), [
    'blocks/breadcrumb/breadcrumb.js', 'blocks/columns/columns.css', 'blocks/columns/columns.js', 'blocks/hero/hero.css', 'blocks/hero/hero.js',
    'blocks/teaser/teaser.css', 'blocks/teaser/teaser.js', 'stardust/eds-conversion-log.md',
  ], 'chrome and default-content code is not read; a missing file is not an input');
  for (const [p, h] of Object.entries(inputs)) assert.equal(h, sha(readFileSync(join(dir, p))), p);
});

check('provenance inputs: absolute --out/--blocks from another cwd record the same project-relative keys as the default run', () => {
  const abs = prepare(join(root, 'abs-site'));
  const elsewhere = mkdtempSync(join(root, 'cwd-'));
  const outAbs = join(abs, 'stardust', 'rollout');
  const runAbs = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd: elsewhere, encoding: 'utf8' });
  ok(runAbs('inventory.mjs', '--migrated', join(abs, 'stardust', 'migrated'), '--out', outAbs, '--content', join(abs, 'content')), 'inventory.mjs (absolute flags)');
  ok(runAbs('blocks.mjs', '--out', outAbs, '--blocks', join(abs, 'blocks')), 'blocks.mjs (absolute flags)');
  for (const [id, name] of CONVERSIONS) ok(runAbs('update-coverage.mjs', '--block', id, '--status', 'converted', '--eds-name', name, '--out', outAbs), `update-coverage.mjs --block ${id}`);
  ok(runAbs('blocks.mjs', '--out', outAbs, '--blocks', join(abs, 'blocks')), 'blocks.mjs (absolute flags, after the conversions)');
  assert.deepEqual(readdirSync(elsewhere), [], 'nothing written in the cwd');
  const keys = Object.keys(JSON.parse(readFileSync(join(outAbs, 'coverage', 'blocks.json'), 'utf8'))._provenance.inputs);
  for (const k of keys) assert.ok(!k.startsWith('/') && !k.split('/').includes('..') && !k.includes('\\'), `${k} is not project-relative`);
  assert.deepEqual(keys, defaultKeys, 'the same keys as the default-flag run');
});

check('idempotent: a re-run leaves blocks.json and templates.json byte-identical, untouched, and says unchanged', () => {
  const files = ['blocks.json', 'templates.json'];
  const bytes = files.map((f) => readFileSync(cov(f), 'utf8'));
  const mtimes = files.map((f) => statSync(cov(f)).mtimeMs);
  const again = run('blocks.mjs');
  ok(again, 'blocks.mjs (re-run)');
  assert.match(again.stdout, /\(unchanged\)/);
  assert.deepEqual(files.map((f) => readFileSync(cov(f), 'utf8')), bytes);
  assert.deepEqual(files.map((f) => statSync(cov(f)).mtimeMs), mtimes, 'an unchanged coverage file is not rewritten');
});

check('identity: blocks.json and templates.json name no DA org/site, project host, DA path or repository URL', () => {
  for (const f of ['blocks.json', 'templates.json']) {
    const t = readFileSync(cov(f), 'utf8').toLowerCase();
    assert.deepEqual(NEEDLES.filter((n) => t.includes(n)), [], f);
  }
});

check('judgement: judged base type, purpose, reuse guidance and colour scheme land on the block (scrubbed); a judged template name and description reach templates.json without inventory, and leave when emptied', () => {
  const jp = join(OUT, 'workspace', 'judgement.json');
  mkdirSync(dirname(jp), { recursive: true });
  const judgement = {
    templates: { 'about-us': { name: 'story-page', description: 'Pages about the Fixture-Site team.' }, home: { name: '', description: '  ' } },
    blocks: {
      teaser: { baseType: 'cards', purpose: 'Lists linked cards, as on main--fixture-site--fixture-org.aem.page.', reuseGuidance: { suitableFor: ['short link lists'], notSuitableFor: [] }, colorScheme: 'light' },
      hero: { baseType: '', purpose: '', reuseGuidance: { suitableFor: [], notSuitableFor: [] }, colorScheme: '' },
      breadcrumb: { baseType: 'Fixture-Site breadcrumbs' },
    },
  };
  writeFileSync(jp, `${JSON.stringify(judgement, null, 2)}\n`);
  const pagesBefore = readFileSync(cov('pages.json'), 'utf8');
  const r = run('blocks.mjs');
  ok(r, 'blocks.mjs (judged)');
  const teaser = row('link-list');
  assert.deepEqual(Object.keys(teaser), [...ENRICHED_KEYS, 'purpose', 'reuseGuidance', 'colorScheme']);
  assert.equal(teaser.baseType, 'cards');
  assert.match(teaser.purpose, /^Lists linked cards, as on <(?:site|host)>\.$/);
  assert.deepEqual(teaser.reuseGuidance, { suitableFor: ['short link lists'], notSuitableFor: [] });
  assert.equal(teaser.colorScheme, 'light');
  const hero = row('hero-banner');
  assert.deepEqual(Object.keys(hero), ENRICHED_KEYS, 'empty judged values are not written');
  assert.equal(hero.baseType, 'hero');
  assert.equal(row('breadcrumb').baseType, '<site> breadcrumbs', 'a judged base type is scrubbed too');
  const inputs = json('blocks.json')._provenance.inputs;
  assert.equal(inputs['stardust/rollout/workspace/judgement.json'], sha(readFileSync(jp)), 'the judgement read is a recorded input');
  assert.deepEqual(Object.keys(inputs), [...Object.keys(inputs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  const templates = json('templates.json').templates;
  const about = templates.find((t) => t.id === 'about-us');
  assert.deepEqual(Object.keys(about).slice(0, 3), ['id', 'name', 'description']);
  assert.deepEqual([about.name, about.description], ['story-page', 'Pages about the <site> team.']);
  const home = templates.find((t) => t.id === 'home');
  assert.equal('name' in home || 'description' in home, false, 'an empty judgement is not a name');
  assert.deepEqual(validate(loadSchema('rollout-templates.schema.json'), json('templates.json')), []);
  assert.deepEqual(validate(loadSchema('rollout-blocks.schema.json'), json('blocks.json')), []);
  assert.equal(readFileSync(cov('pages.json'), 'utf8'), pagesBefore, 'blocks.mjs leaves pages.json alone');
  for (const f of ['blocks.json', 'templates.json']) {
    const t = readFileSync(cov(f), 'utf8').toLowerCase();
    assert.deepEqual(NEEDLES.filter((n) => t.includes(n)), [], `${f} after the judgement`);
  }
  judgement.templates['about-us'] = { name: '', description: '' };
  writeFileSync(jp, `${JSON.stringify(judgement, null, 2)}\n`);
  ok(run('blocks.mjs'), 'blocks.mjs (judgement emptied)');
  const emptied = json('templates.json').templates.find((t) => t.id === 'about-us');
  assert.equal('name' in emptied || 'description' in emptied, false, 'a name no longer judged leaves templates.json');
});

check('--blocks <dir> picks the block code: an empty dir leaves no description and no CSS-only class', () => {
  const empty = join(root, 'no-blocks');
  mkdirSync(empty);
  ok(run('blocks.mjs', '--blocks', empty), 'blocks.mjs --blocks <empty>');
  assert.equal(row('link-list').description, null);
  assert.deepEqual(row('link-list').optionClasses, ['list', 'secure']);
  assert.equal(Object.keys(json('blocks.json')._provenance.inputs).some((k) => k.startsWith('blocks/')), false, 'no block code read, none recorded');
  ok(run('blocks.mjs'), 'blocks.mjs (default --blocks)');
  assert.deepEqual(row('link-list').optionClasses, ['compact', 'list', 'secure']);
});

check('--help prints the usage header (with --blocks) and writes nothing', () => {
  const cwd = mkdtempSync(join(root, 'help-'));
  const h = spawnSync(process.execPath, [join(SCRIPTS, 'blocks.mjs'), '--help'], { cwd, encoding: 'utf8' });
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /Usage: node skills\/rollout\/scripts\/blocks\.mjs \[--out <rolloutDir>\] \[--blocks <dir>\]/);
  assert.deepEqual(readdirSync(cwd), []);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
