import test from 'node:test';
import assert from 'node:assert/strict';
import { PROPS, diffTexts } from './text-styles.mjs';

const t = (text, styles = {}, rect = {}) => ({ text, rect: { x: 0, y: 0, w: 10, h: 10, ...rect },
  styles: { ...Object.fromEntries(PROPS.map((k) => [k, 'x'])), ...styles } });

test('diffTexts: equal texts give no row; the first family counts, case-insensitively', () => {
  const r = diffTexts([t('About', { fontFamily: 'Inter, Arial' }), t('Tools', { fontFamily: 'Arial' })],
    [t('About', { fontFamily: 'inter, arial' }), t('Tools', { fontFamily: 'arial, sans-serif' })]);
  assert.deepEqual(r, { rows: [], onlySource: [], onlyPage: [], iconsOneSide: [] });
  assert.equal(diffTexts([t('A', { fontFamily: 'Inter' })], [t('A', { fontFamily: 'Arial, Inter' })]).rows.length, 1);
});

test('diffTexts: a rendering property and a half-pixel shift are reported, smaller shifts are not', () => {
  const r = diffTexts([t('Tools', { webkitFontSmoothing: 'antialiased' }, { y: 10 })],
    [t('Tools', { webkitFontSmoothing: 'auto' }, { y: 10.4, x: 1 })]);
  assert.deepEqual(r.rows, [{ text: 'Tools', diffs: [['webkitFontSmoothing', 'antialiased', 'auto'], ['x', 0, 1]] }]);
});

test('diffTexts: texts on one side only, repeated texts matched in order', () => {
  const r = diffTexts([t('A'), t('A', {}, { y: 50 }), t('Close')], [t('A'), t('A', {}, { y: 50 }), t('Skip')]);
  assert.deepEqual(r, { rows: [], onlySource: ['Close'], onlyPage: ['Skip'], iconsOneSide: [] });
});

test('parseSizes: widths with an optional height, 900 by default; a bad size throws', async () => {
  const { parseSizes } = await import('./text-styles.mjs');
  assert.deepEqual(parseSizes('1440x900,820,390x844'), [{ width: 1440, height: 900 }, { width: 820, height: 900 }, { width: 390, height: 844 }]);
  assert.throws(() => parseSizes('wide'), /bad size/);
});

test('differingPixels: counts per pixel, down to the given row', async () => {
  const { differingPixels } = await import('./text-styles.mjs');
  const { PNG } = await import('pngjs');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync('/tmp/ts-');
  const img = (dark) => { const p = new PNG({ width: 4, height: 4 }); p.data.fill(255); for (const i of dark) p.data.set([0, 0, 0, 255], 4 * i); return PNG.sync.write(p); };
  writeFileSync(`${dir}/a.png`, img([]));
  writeFileSync(`${dir}/b.png`, img([1, 13]));
  assert.equal(differingPixels(`${dir}/a.png`, `${dir}/b.png`), 2);
  assert.equal(differingPixels(`${dir}/a.png`, `${dir}/b.png`, 2), 1);
});

test('diffShown: a header text hidden on one side only is a difference; page content is ignored', async () => {
  const { diffShown } = await import('./text-styles.mjs');
  const header = ['Articles', 'Watch Now'];
  const src = [t('Watch Now'), t('Main heading')];
  const page = [t('Watch Now'), t('Articles')];
  assert.deepEqual(diffShown(header, src, page, 0.05), [{ text: 'Articles', diffs: [['shown', false, true]] }]);
  assert.deepEqual(diffShown(header, [t('Watch Now', {}, { y: 3 })], [t('Watch Now', {}, { y: 3 })], 0.05), []);
});

test('cacheKey: the same state gives the same key in any key order; another state another key', async () => {
  const { cacheKey } = await import('./text-styles.mjs');
  assert.equal(cacheKey({ a: 1, b: { c: [1, 2], d: 'x' } }), cacheKey({ b: { d: 'x', c: [1, 2] }, a: 1 }));
  assert.notEqual(cacheKey({ a: 1, b: { c: [1, 2] } }), cacheKey({ a: 1, b: { c: [2, 1] } }));
  assert.match(cacheKey({}), /^[0-9a-f]{16}$/);
});

test('icons: paired by position, compared by centre only; one too far is on one side only', async () => {
  const { pairIcons } = await import('./text-styles.mjs');
  const icon = (x, y = 30, text = 'icon') => ({ text, kind: 'icon', rect: { x, y, w: 0, h: 0 }, styles: { fontFamily: String(x) } });
  // named on one side only, other font: still paired, nothing to report at the same centre
  assert.deepEqual(diffTexts([icon(184, 30, 'icon "Logo"')], [icon(184)]).rows, []);
  // a close X 20 px off: one row; a search glass 100 px off: on each side only
  const r = diffTexts([icon(846), icon(1100)], [icon(866), icon(1200)]);
  assert.deepEqual(r.rows, [{ text: 'icon', diffs: [['x', 846, 866]] }]);
  assert.deepEqual([r.onlySource, r.onlyPage], [[], []], 'an icon on one side only is not judged');
  assert.deepEqual(r.iconsOneSide, ['source: icon at 1100,30', 'page: icon at 1200,30']);
  // nearest first: two close icons are not crossed
  assert.equal(pairIcons([icon(100), icon(130)], [icon(128), icon(102)]).pairs.map(([s, p]) => `${s.rect.x}-${p.rect.x}`).join(' '), '100-102 130-128');
});

test('minusBaseline: what the page before the unit already differed by, with the same value, is not counted', async () => {
  const { minusBaseline } = await import('./text-styles.mjs');
  const r = { rows: [{ text: 'Hero', diffs: [['y', 205.6, 65.6]] }, { text: 'Blog', diffs: [['x', 10, 12], ['color', 'a', 'b']] }],
    onlySource: ['Orange bar', 'About'], onlyPage: ['Form field'] };
  const base = { rows: [{ text: 'Hero', diffs: [['y', 205.6, 65.6]] }, { text: 'Blog', diffs: [['x', 10, 11]] }],
    onlySource: ['Orange bar'], onlyPage: ['Form field'] };
  const { r: left, inherited } = minusBaseline(r, base);
  assert.deepEqual(left.rows, [{ text: 'Blog', diffs: [['x', 10, 12], ['color', 'a', 'b']] }], 'a different page value stays');
  assert.deepEqual([left.onlySource, left.onlyPage, inherited], [['About'], [], 3]);
});

test('minusBaseline: the header is the unit\'s even where the page before it was as wrong', async () => {
  const { minusBaseline } = await import('./text-styles.mjs');
  // the retailer's shell: its legacy header collapsed (texts missing) and the page below it at 0
  const r = { rows: [{ text: '(the page below the header)', diffs: [['y', 112, 0]] }], onlySource: ['Colours', 'Hero'], onlyPage: [] };
  const base = { rows: [{ text: '(the page below the header)', diffs: [['y', 112, 0]] }], onlySource: ['Colours', 'Hero'], onlyPage: [] };
  const { r: left, inherited } = minusBaseline(r, base, ['Colours']);
  assert.deepEqual([left.rows.length, left.onlySource, inherited], [1, ['Colours'], 1]);
});

test('differingPixels with a baseline: pixels the page shares with the baseline are not counted', async () => {
  const { differingPixels } = await import('./text-styles.mjs');
  const { PNG } = await import('pngjs');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync('/tmp/tsb-');
  const img = (dark) => { const p = new PNG({ width: 4, height: 1 }); p.data.fill(255); for (const i of dark) p.data.set([0, 0, 0, 255], 4 * i); return PNG.sync.write(p); };
  writeFileSync(`${dir}/src.png`, img([]));
  writeFileSync(`${dir}/base.png`, img([0])); // the shell already differs at pixel 0
  writeFileSync(`${dir}/page.png`, img([0, 2])); // the page keeps it and adds pixel 2
  assert.equal(differingPixels(`${dir}/src.png`, `${dir}/page.png`), 2);
  assert.equal(differingPixels(`${dir}/src.png`, `${dir}/page.png`, null, `${dir}/base.png`), 1);
});

test('captureHideCss: the capture hide rules plus the late layers the mobile probe recorded', async () => {
  const { captureHideCss } = await import('./text-styles.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ts-hide-'));
  writeFileSync(join(dir, 'overlays.json'), JSON.stringify({ hideCss: '#a { display:none }' }));
  assert.equal(captureHideCss(join(dir, 'overlays.json')), '#a { display:none }');
  mkdirSync(join(dir, 'open'));
  writeFileSync(join(dir, 'open/open.json'), JSON.stringify({ mobileMenu: { lateOverlays: ['#wpconsent-container', '.x'] } }));
  assert.equal(captureHideCss(join(dir, 'overlays.json')),
    '#a { display:none }\n#wpconsent-container, .x { display: none !important; }');
  writeFileSync(join(dir, 'overlays.json'), JSON.stringify({}));
  assert.equal(captureHideCss(join(dir, 'overlays.json')), '#wpconsent-container, .x { display: none !important; }');
});
