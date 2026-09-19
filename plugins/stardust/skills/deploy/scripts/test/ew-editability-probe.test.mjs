#!/usr/bin/env node
/**
 * Fixture test for ew-editability-probe.mjs (T32.2 hardening).
 * Run: node --test skills/deploy/scripts/test/ew-editability-probe.test.mjs
 *
 * Pure parts always run: @ew-exempt parsing anywhere in the file (import or
 * pragma before the JSDoc, single-star comments), item-level syntax, the
 * aggregate's item matching and --strict findings. The harness part (real module
 * install from a synthetic origin, external-origin abort ledger, 404 → exit 2,
 * --strict exit 1) needs Playwright + Chromium: when loadChromium() cannot resolve
 * playwright (project, bare or global install) those tests are SKIPPED, not failed.
 *
 * Fixture: test/fixtures/ew-probe/ — blocks/{hero (imports aem.js + helper +
 * sibling teaser), teaser, cards (import before JSDoc, item-level exemption),
 * promo (single-star granular tag, no category), broken (unresolvable import)},
 * scripts/{aem.js (fetches rum.hlx.page at import time), dom-helpers.js},
 * content/{page.html (all five), page-clean.html (no broken)}.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExemptTags, parseExemptItem, matchExemption, aggregate, strictFindings, readBlockExemptions,
  probeContent, verdict, loadChromium, installErrors,
} from '../ew-editability-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'ew-probe');
const PROBE = join(here, '..', 'ew-editability-probe.mjs');

test('parseExemptTags: tag after an import / pragma, single-star comment, none', () => {
  const afterImport = "import { el } from '../../scripts/dom-helpers.js';\n/**\n * Cards\n * @ew-exempt <p> /^\\$\\d/ — derived: price re-rendered\n */\nexport default function decorate() {}";
  const t = parseExemptTags(afterImport);
  assert.ok(t, 'tag after an import is read');
  assert.equal(t.items.length, 1);
  assert.equal(t.items[0].tag, 'p');
  assert.ok(t.items[0].pattern instanceof RegExp);
  assert.equal(t.items[0].category, 'derived');
  assert.equal(t.items[0].granular, false);
  assert.deepEqual(t.categories, ['derived']);
  const single = parseExemptTags('/* promo: @ew-exempt config rows */\nexport default function d() {}');
  assert.ok(single, 'single-star comment is read');
  assert.equal(single.items[0].granular, true);
  assert.equal(single.items[0].category, 'config');
  assert.equal(parseExemptTags('/** no tags here */ export default function d() {}'), null);
  assert.equal(parseExemptTags("import x from './x.js';\nexport default function d() {}"), null);
});

test('parseExemptItem: the documented shapes', () => {
  const iso = parseExemptItem('<p> ISO date (cell 1) — derived');
  assert.equal(iso.tag, 'p'); assert.equal(iso.pattern, null); assert.equal(iso.category, 'derived'); assert.equal(iso.granular, false);
  const all = parseExemptItem('all — index-driven listing, authored rows are the no-JS fallback');
  assert.equal(all.all, true); assert.equal(all.category, 'all'); assert.equal(all.granular, false);
  const price = parseExemptItem('<p> /^\\$?\\d/ — price');
  assert.equal(price.category, null, 'an unknown word after the dash is not a category');
  assert.ok(price.pattern.test('$12'));
  const bare = parseExemptItem('showcase video links');
  assert.equal(bare.granular, true); assert.equal(bare.category, null);
  const meta = parseExemptItem('/^[a-z-]+$/ — metadata: glyph keys');
  assert.equal(meta.tag, null); assert.ok(meta.pattern); assert.equal(meta.category, 'metadata');
});

test('aggregate: item-level exemptions match by tag + regex; granular swallows; strict reports', () => {
  const rows = [
    { block: 'cards', tag: 'h3', text: 'Basic', hits: 1, sameText: true },
    { block: 'cards', tag: 'p', text: '$9', hits: 0 },
    { block: 'cards', tag: 'p', text: 'For starters', hits: 0 },
    { block: 'promo', tag: 'p', text: 'Promo line', hits: 0 },
    { block: 'listing', tag: 'p', text: 'Row', hits: 0 },
    { block: 'plain', tag: 'p', text: 'Dead', hits: 0 },
  ];
  const exemptions = {
    cards: parseExemptTags('/** @ew-exempt <p> /^\\$\\d/ — derived: price */'),
    promo: parseExemptTags('/* @ew-exempt config rows */'),
    listing: parseExemptTags('/** @ew-exempt all — index-driven */'),
  };
  const agg = aggregate(rows, { exemptions });
  const by = Object.fromEntries(agg.blocks.map((b) => [b.block, b]));
  assert.equal(by.cards.exempt, 1, 'only the price matches the item');
  assert.equal(by.cards.dead, 1, 'the other dead <p> stays dead');
  assert.equal(by.cards.exemptItems[0].category, 'derived');
  assert.equal(by.promo.exempt, 1); assert.equal(by.promo.dead, 0);
  assert.equal(by.listing.exempt, 1);
  assert.equal(by.plain.dead, 1);
  assert.deepEqual(verdict(agg), { dead: true, duplicated: false });
  const strict = strictFindings(agg);
  assert.equal(strict.length, 1, 'only the granular category-less promo tag is a strict finding');
  assert.match(strict[0], /promo: `@ew-exempt config rows` swallowed 1 text/);
  assert.equal(matchExemption(exemptions.cards, { tag: 'h3', text: '$9' }), null, 'tag mismatch');
  // legacy exemption objects without items (e.g. built by hand) stay granular
  assert.ok(matchExemption({ all: false, reasons: ['--exempt (CLI)'], categories: [] }, { tag: 'p', text: 'x' }).granular);
});

test('readBlockExemptions: fixture blocks + CLI union', () => {
  const ex = readBlockExemptions(join(FIX, 'blocks'), ['hero', 'cards', 'promo', 'broken'], new Set(['broken']));
  assert.equal(ex.hero, undefined);
  assert.equal(ex.cards.items[0].tag, 'p');
  assert.equal(ex.promo.items[0].granular, true);
  assert.equal(ex.broken.source, '--exempt');
  assert.equal(ex.broken.items[0].granular, true);
});

test('installErrors: names the unresolved module paths', () => {
  const lines = installErrors([{ name: 'broken', error: 'Failed to fetch dynamically imported module [/blocks/broken/broken.js]' }], { missing: { '/scripts/nope.js': 1, '/icons/x.svg': 1 } }, '/repo');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /broken: block JS failed to install/);
  assert.match(lines[0], /unresolved under the harness root \/repo: \/scripts\/nope\.js/);
  assert.doesNotMatch(lines[0], /icons\/x\.svg/);
});

let chromium = null;
try { chromium = await loadChromium(); } catch { /* skipped below */ }
const skip = chromium ? false : 'playwright is not resolvable (project, bare or global) — harness tests skipped';

test('harness: real module install, external abort ledger, 404 → not installed, exemptions matched', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const r = await probeContent(browser, { content: join(FIX, 'content', 'page.html'), blocksDir: join(FIX, 'blocks'), stylesPath: join(FIX, 'styles', 'styles.css') });
    await r.ctx.close();
    assert.equal(r.root, FIX, 'root defaults to the blocks dir parent');
    assert.match(r.pipeline, /^pipeline emulation: section-metadata 0, meta 1/);
    assert.equal(r.errors.length, 1, `exactly the broken block fails: ${JSON.stringify(r.errors)}`);
    assert.match(r.errors[0], /^broken: block JS failed to install/);
    assert.match(r.errors[0], /\/scripts\/nope\.js/);
    assert.ok(Object.keys(r.requests.aborted).some((u) => u.startsWith('https://rum.hlx.page/')), `rum sampling aborted and listed: ${JSON.stringify(r.requests)}`);
    assert.equal(r.requests.missing['/scripts/nope.js'], 1);
    const agg = aggregate(r.rows, { exemptions: readBlockExemptions(join(FIX, 'blocks'), r.names) });
    const by = Object.fromEntries(agg.blocks.map((b) => [b.block, b]));
    assert.equal(by.hero.dead, 0, 'hero (aem.js + helper + sibling import) installed and moved its texts');
    assert.equal(by.hero.editable, by.hero.authored);
    assert.equal(by.cards.exempt, 2, 'both prices matched the item-level tag');
    assert.equal(by.cards.dead, 0);
    assert.equal(by.promo.exempt, 2, 'granular tag swallowed both rebuilt lines');
    assert.equal(by.broken.dead, 0, 'an uninstalled block leaves its raw rows (editable) — the exit-2 probe error is what fails it');
    assert.equal(strictFindings(agg).length, 1);
  } finally { await browser.close(); }
});

test('CLI exit codes: 2 on an uninstallable block; 0 clean; 1 under --strict; --help 0', { skip }, () => {
  const run = (args) => spawnSync(process.execPath, [PROBE, ...args], { encoding: 'utf8', cwd: FIX });
  const common = ['--blocks-dir', join(FIX, 'blocks'), '--styles', join(FIX, 'styles', 'styles.css')];
  const bad = run(['--content', join(FIX, 'content', 'page.html'), ...common]);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /aborted  https:\/\/rum\.hlx\.page/);
  assert.match(bad.stdout, /404      \/scripts\/nope\.js/);
  const clean = run(['--content', join(FIX, 'content', 'page-clean.html'), ...common]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  const strict = run(['--content', join(FIX, 'content', 'page-clean.html'), ...common, '--strict']);
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  assert.match(strict.stdout, /--strict: exemptions that must be declared item-level/);
  assert.match(strict.stdout, /\[derived\]/);
  const help = run(['--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /usage:/);
});
