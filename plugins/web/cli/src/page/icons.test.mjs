import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, deriveName, optimizeSvg, writeIcons } from '#src/page/icons.mjs';

const SEARCH = { width: 16, height: 16, svgClass: 'icon-search', parentTag: 'BUTTON' };
const CART = { width: 24, height: 24, parentClass: 'header-cart', parentTag: 'A' };
const MENU = { width: 20, height: 20, className: 'nav-menu-toggle', parentTag: 'BUTTON' };

test('classify returns icon for known pattern samples', () => {
  for (const e of [SEARCH, CART, MENU]) assert.equal(classify(e), 'icon');
  assert.equal(classify({ width: 10, height: 10, className: 'site-logo' }), 'logo');
  assert.equal(classify({ width: 200, height: 90 }), 'image');
});

test('deriveName matches known patterns with high confidence', () => {
  assert.deepEqual(deriveName(SEARCH, 1), { name: 'search', confidence: 'high' });
  assert.deepEqual(deriveName(CART, 1), { name: 'cart', confidence: 'high' });
  assert.deepEqual(deriveName(MENU, 1), { name: 'menu', confidence: 'high' });
  assert.deepEqual(deriveName({ parentAriaLabel: 'Open Foo!' }, 1), {
    name: 'open-foo',
    confidence: 'high',
  });
  assert.deepEqual(deriveName({}, 3), { name: 'icon-3', confidence: 'low' });
});

test('optimizeSvg strips width/height and keeps viewBox', () => {
  const out = optimizeSvg(
    '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="#f00"/></svg>',
    'icon',
  );
  assert.ok(!/\swidth=|\sheight=/.test(out));
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /fill="currentColor"/);
});

test('optimizeSvg derives viewBox from width/height when missing', () => {
  assert.match(optimizeSvg('<svg width="10" height="12"></svg>', 'logo'), /viewBox="0 0 10 12"/);
});

test('writeIcons writes svgs and manifest, skipping images and empty entries', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'icons-')), 'out');
  const svg = '<svg viewBox="0 0 1 1"><path/></svg>';
  const manifest = writeIcons(
    [
      { ...SEARCH, source: 'inline-svg', svg },
      { width: 200, height: 90, source: 'inline-svg', svg },
      { ...CART, source: 'img-svg', resolvedSvg: null },
    ],
    'http://x',
    dir,
  );
  assert.equal(manifest.url, 'http://x');
  assert.deepEqual(
    manifest.icons.map((i) => [i.name, i.file, i.class]),
    [['search', 'search.svg', 'icon']],
  );
  assert.ok(existsSync(join(dir, 'search.svg')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'icons.json'), 'utf8')), manifest);
});

const USE = '<svg width="16" height="16" viewBox="0 0 16 16"><use href="#icon-heart"></use></svg>';
const HEART = { width: 16, height: 16, parentAriaLabel: 'Favorites', parentTag: 'BUTTON' };
const inlineUse = { ...HEART, source: 'inline-svg', svg: USE };
const spriteOf = (symbolSvg) => ({
  ...HEART,
  source: 'svg-sprite',
  symbolSvg,
  fallbackSvg: USE,
});

test('writeIcons writes a resolved sprite once, under its element name', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'icons-')), 'out');
  const symbol = '<symbol viewBox="0 0 16 16"><path fill="#f00" d="M0 0h1v1z"/></symbol>';
  const { icons } = writeIcons([inlineUse, spriteOf(symbol)], 'http://x', dir);
  assert.deepEqual(
    icons.map((i) => i.name),
    ['favorites'],
  );
  const content = readFileSync(join(dir, 'favorites.svg'), 'utf8');
  assert.match(content, /currentColor/);
  assert.doesNotMatch(content, /<use/);
});

test('writeIcons keeps the inline icon when the sprite is unresolved', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'icons-')), 'out');
  const { icons } = writeIcons([inlineUse, spriteOf(null)], 'http://x', dir);
  assert.deepEqual(
    icons.map((i) => [i.name, i.source]),
    [['favorites', 'inline-svg']],
  );
});
