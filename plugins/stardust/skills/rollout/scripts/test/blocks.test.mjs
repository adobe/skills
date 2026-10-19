#!/usr/bin/env node
// skills/rollout/scripts/test/blocks.test.mjs — the blocks.mjs contract, in two parts.
// The delivered-site fixture (inventory → blocks → conversions recorded with update-coverage → blocks):
// module rows carry variants (ids, classes, pages, instances) from pages.json `delivered`, a variantsSummary
// ({total, singleUse}; the top-level one adds blocks), usage (usedByTemplates, usedByPages, instanceCount)
// counted from the same delivered records — not the sidecars' plan; chrome and default-content rows count
// their declaring sidecars — optionClasses (authored plus CSS-only), description, contract (identity
// scrubbed) and baseType (standard, alias, unknown); a judgement lands on the blocks and on template names without re-running inventory;
// formatVersion and the schema; a re-run leaves blocks.json and templates.json byte-identical; no identity
// strings; chrome and default-content rows unchanged; _provenance.inputs hashes every judgement,
// conversion-log and block-code file read; --blocks picks the block code; --help writes nothing.
// Blocks the export can see: every subdirectory of the project's blocks/ that holds <name>.js or
// <name>.css is a delivered block and gets a ledger row even when no page lists it (source `blocks-dir`,
// status converted; a chrome name delivers as a fragment; a module one carries the delivered structure
// too); a directory equal to a planned block's id, EDS name or edsBlockName is not duplicated, and header
// and nav are one chrome; a prior delivery (a block recorded not-delivered with its reason) survives a
// re-run; a re-run writes the same bytes but timestamps; a missing blocks dir is a note, never an error;
// every key written is declared in the (closed) rollout schemas.
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
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e && e.message).split('\n').join('\n  ')}`); } };

// The delivered-site fixture: enriched module rows, judgement, provenance inputs, idempotence.
{
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
  const ENRICHED_KEYS = [...BASE_KEYS, 'optionClasses', 'variants', 'variantsSummary', 'description', 'contract', 'baseType'];
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

  check('usage: usedByTemplates, usedByPages and instanceCount are counted from the delivered documents (pages.json delivered.blocks, kind block — the records block-origin maps), not the sidecars\' plan; a planned module no document shows reads 0', () => {
    const pagesDoc = json('pages.json');
    const tplOf = Object.fromEntries(pagesDoc.pages.map((p) => [p.slug, p.templateId]));
    // an independent re-derivation from the page records
    const expect = (name) => {
      const hits = pagesDoc.pages.flatMap((p) => ((p.delivered && p.delivered.blocks) || []).filter((r) => r.kind === 'block' && r.block === name).map(() => p.slug));
      const pages = [...new Set(hits)].sort();
      return { usedByTemplates: [...new Set(pages.map((slug) => tplOf[slug]))].sort(), usedByPages: pages, instanceCount: hits.length };
    };
    const usage = (b) => ({ usedByTemplates: b.usedByTemplates, usedByPages: b.usedByPages, instanceCount: b.instanceCount });
    for (const [id, name] of CONVERSIONS.filter(([, n]) => n !== 'default-content')) assert.deepEqual(usage(row(id)), expect(name), id);
    assert.deepEqual([row('link-list').instanceCount, row('link-list').usedByPages], [5, ['about-us', 'de-ueber-uns', 'home']]);
    assert.deepEqual([row('hero-banner').instanceCount, row('three-up').instanceCount], [2, 2]);
    // the plan said 3 (one link-list per sidecar); the delivered documents hold 5 teasers
    assert.equal(pagesDoc.pages.filter((p) => (p.blocks || []).includes('link-list')).length, 3);
    // breadcrumb is planned on de/ueber-uns, yet no document shows a breadcrumb block: 0, truthfully
    assert.ok(pagesDoc.pages.some((p) => (p.blocks || []).includes('breadcrumb')), 'breadcrumb is planned');
    assert.deepEqual(usage(row('breadcrumb')), { usedByTemplates: [], usedByPages: [], instanceCount: 0 });
    // on every row with a block the count is the sum of its variants' instances — the mapping's record set
    for (const b of json('blocks.json').blocks.filter((x) => Array.isArray(x.variants))) assert.equal(b.instanceCount, b.variants.reduce((n, v) => n + v.instances, 0), b.id);
  });

  check('variantsSummary: per row {total, singleUse} over its variants[]; at the top {total, singleUse, blocks} over the module rows; the summary line names the single-use count; rows without variants carry none', () => {
    assert.deepEqual(row('link-list').variantsSummary, { total: 3, singleUse: 2 });
    assert.deepEqual(row('hero-banner').variantsSummary, { total: 2, singleUse: 2 });
    assert.deepEqual(row('three-up').variantsSummary, { total: 2, singleUse: 2 });
    assert.deepEqual(row('breadcrumb').variantsSummary, { total: 0, singleUse: 0 });
    assert.deepEqual(json('blocks.json').variantsSummary, { total: 7, singleUse: 6, blocks: 3 });
    assert.match(second.stdout, /^Delivered\s+7 variant\(s\) of 3 block\(s\), 6 single-use/m, second.stdout);
    for (const id of ['header', 'footer', 'heading']) assert.equal('variantsSummary' in row(id), false, `${id}: no variants, no summary`);
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

  check('chrome and default-content rows: base keys only; chrome unchanged by the enrichment (same values as recorded); both count the pages whose sidecars declare them — a fragment or default content leaves no block record', () => {
    const before = new Map(JSON.parse(recorded).blocks.map((b) => [b.id, b]));
    const base = (b) => Object.fromEntries(BASE_KEYS.map((k) => [k, b[k]]));
    for (const id of ['header', 'footer', 'heading']) assert.deepEqual(Object.keys(row(id)), BASE_KEYS, id);
    for (const id of ['header', 'footer']) assert.deepEqual(row(id), base(before.get(id)), id);
    assert.deepEqual([row('header').kind, row('footer').kind, row('heading').delivery.edsBlockName], ['chrome', 'chrome', 'default-content']);
    // all three are declared on the home sidecar only
    const tpl = json('pages.json').pages.find((p) => p.slug === 'home').templateId;
    for (const id of ['header', 'footer', 'heading']) assert.deepEqual([row(id).instanceCount, row(id).usedByPages, row(id).usedByTemplates], [1, ['home'], [tpl]], id);
    // before its default-content mapping, heading was a module row with EDS name `heading`: no document shows such a block, so it read 0
    assert.deepEqual([before.get('heading').instanceCount, before.get('heading').usedByPages], [0, []]);
  });

  check('formatVersion and schema: blocks.json is { _provenance, formatVersion 0.1.0, generatedAt, variantsSummary, blocks } and validates; templates.json too', () => {
    const b = json('blocks.json');
    assert.deepEqual(Object.keys(b), ['_provenance', 'formatVersion', 'generatedAt', 'variantsSummary', 'blocks']);
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
}

// Synthetic projects: blocks/<name>/ directories no page lists, not-delivered rows, the closed schemas.
{
  const SCRIPT = join(HERE, '..', 'blocks.mjs');
  const made = [];

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
  const vid = (identity) => `v_${createHash('sha256').update(`stardust-variant:${identity}`).digest('hex').slice(0, 12)}`;

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
      optionClasses: [], variants: [], variantsSummary: { total: 0, singleUse: 0 }, description: null, contract: null, baseType: 'unknown',
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

  check('a directory equal to a planned block\'s id or edsBlockName is not duplicated; a planned row counts its delivered records, not its sidecar listings', () => {
    const cards = (pos) => ({ pos, block: 'cards', kind: 'block', classes: [], variantId: vid('cards|') });
    const { proj, out } = project({
      pages: [{ ...page('home', ['Hero Banner', 'cards', 'header']), delivered: { blocks: [cards(0), cards(1)] } }, page('about', ['cards'], 'about')],
      dirBlocks: { 'hero-banner': ['hero-banner.js'], cards: ['cards.css'], header: ['header.js'] },
    });
    const r = run(proj);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(ledger(out).map((b) => b.id), ['cards', 'header', 'Hero Banner']);
    assert.equal(byId(out)['Hero Banner'].delivery.edsBlockName, 'hero-banner');
    const usage = (b) => [b.instanceCount, b.usedByPages, b.usedByTemplates];
    assert.deepEqual(usage(byId(out).cards), [2, ['home'], ['detail']], 'two cards records on home; about lists cards but has no delivered document');
    assert.deepEqual(usage(byId(out)['Hero Banner']), [0, [], []], 'planned, yet no document shows a hero-banner block');
    assert.deepEqual(usage(byId(out).header), [1, ['home'], ['detail']], 'chrome: the pages whose sidecars declare it');
    assert.doesNotMatch(r.stdout, /^Registered/m, r.stdout);
  });

  check('usage and variantsSummary from the delivered records: a repeated and a single-use variant on a planned row, a single-use one on a blocks-dir row, a planned block no document shows at 0, chrome by its sidecars; the top-level summary and the summary line agree', () => {
    const rec = (pos, block, classes) => ({ pos, block, kind: 'block', classes, variantId: vid(`${block}|${classes.join(' ')}`) });
    const home = { ...page('home', ['promo', 'header', 'hero']), delivered: { blocks: [rec(0, 'promo', ['dark']), rec(1, 'promo', ['dark']), rec(2, 'promo', []), rec(3, 'teaser', [])] } };
    const about = { ...page('about', ['promo', 'header'], 'about'), delivered: { blocks: [rec(0, 'promo', ['dark'])] } };
    const { proj, out } = project({ pages: [home, about], dirBlocks: { promo: ['promo.js'], teaser: ['teaser.js'] } });
    const r = run(proj);
    assert.equal(r.status, 0, r.stderr);
    const b = byId(out);
    const usage = (x) => [x.instanceCount, x.usedByPages, x.usedByTemplates];
    assert.deepEqual(usage(b.promo), [4, ['about', 'home'], ['about', 'detail']]);
    assert.deepEqual(b.promo.variants, [{ id: vid('promo|'), classes: [], pages: 1, instances: 1 }, { id: vid('promo|dark'), classes: ['dark'], pages: 2, instances: 3 }]);
    assert.deepEqual(b.promo.variantsSummary, { total: 2, singleUse: 1 });
    assert.deepEqual([b.teaser.source, ...usage(b.teaser), b.teaser.variantsSummary], ['blocks-dir', 1, ['home'], ['detail'], { total: 1, singleUse: 1 }]);
    assert.deepEqual([...usage(b.hero), b.hero.variants, b.hero.variantsSummary], [0, [], [], [], { total: 0, singleUse: 0 }], 'planned on home, no record: 0');
    assert.deepEqual(usage(b.header), [2, ['about', 'home'], ['about', 'detail']]);
    const doc = JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8'));
    assert.deepEqual(doc.variantsSummary, { total: 3, singleUse: 2, blocks: 2 });
    assert.match(r.stdout, /^Delivered\s+3 variant\(s\) of 2 block\(s\), 2 single-use/m, r.stdout);
    assert.match(r.stdout, /^Most reused\s+promo×4, teaser×1$/m, r.stdout);
    assert.deepEqual(validate(loadSchema('rollout-blocks.schema.json'), doc), []);
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

  check('a blocks-dir module row carries the delivered structure too: the pages\' delivered variants no planned row takes land on it (no variant without a block); Unmatched still names it', () => {
    const variantId = `v_${createHash('sha256').update('stardust-variant:promo|dark').digest('hex').slice(0, 12)}`;
    const home = { ...page('home', ['hero']), delivered: { blocks: [{ pos: 0, block: 'promo', kind: 'block', classes: ['dark'], variantId }] } };
    const { proj, out } = project({ pages: [home], dirBlocks: { promo: ['promo.js'] } });
    const r = run(proj);
    assert.equal(r.status, 0, r.stderr);
    const promo = byId(out).promo;
    assert.equal(promo.source, 'blocks-dir');
    assert.deepEqual(promo.variants, [{ id: variantId, classes: ['dark'], pages: 1, instances: 1 }]);
    assert.deepEqual(promo.optionClasses, ['dark']);
    assert.deepEqual(byId(out).hero.variants, []);
    assert.match(r.stdout, /^Unmatched +1 delivered block name\(s\) with no module row: promo /m, r.stdout);
    assert.deepEqual(validate(loadSchema('rollout-blocks.schema.json'), JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8'))), []);
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
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
