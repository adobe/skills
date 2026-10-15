#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-pixel.test.mjs — B2, frame pixels (advisory): cropRect, textOf,
// comparable and textBoxes (pure, over the synthetic kit), comparePngs through replica's pixel-compare
// (needs pngjs and pixelmatch), then runPixel and the CLI `pixel` against fixtures/figma-gate/page.html
// with figma-frame.html screenshotted into the capture cache as the frame image (needs playwright).
// Each part prints a skip line when its packages do not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { prepare } from '../figma-gate/prepare.mjs';
import { REFERENCE_CLASSES, comparable, comparePngs, cropRect, pixelHeadline, runPixel, textBoxes, textOf } from '../figma-gate/pixel.mjs';
import { VERDICT_RE } from '../../../replica/scripts/run-bg.mjs';
import { KEY, VERSION, makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-pixel-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const r7 = boxes.roots['1:7'];
const S02_TEXT = '  EVERYTHING in one place\nPlan the work with a shared board that everyone on the team can read. Ship each change behind a review, and keep the history of every decision. New Try it';

await check('REFERENCE_CLASSES are the three uncalibrated reference percentages', () => {
  assert.deepEqual(REFERENCE_CLASSES, { lightText: 3, inverted: 3.5, rasterGround: 4 });
});

await check('pixelHeadline: advisory when every section has a number, "ERROR (exit 124) pixel no verdict" when a comparison hit its deadline', () => {
  const ok = [{ verdict: 'advisory' }, { verdict: 'n/a' }];
  assert.match(pixelHeadline(ok), /^pixel advisory: 2 section\(s\); uncalibrated reference: light text 3%, inverted 3.5%, raster ground 4%$/);
  const lost = pixelHeadline([{ verdict: 'advisory' }, { verdict: 'no verdict' }]);
  assert.match(lost, /^ERROR \(exit 124\) pixel no verdict: 1 of 2 section\(s\) hit a deadline, re-run; uncalibrated reference/);
  assert.ok(!/advisory/.test(lost), lost);
  assert.ok(VERDICT_RE.test(lost), 'run-bg\'s default filter matches it');
});

await check('cropRect: the section rectangle in the frame PNG, n/a unless the PNG is the rounded frame box', () => {
  assert.deepEqual(cropRect(r7, { width: 1440, height: 1840 }), { x: 0, y: 640, w: 1440, h: 800 });
  assert.match(cropRect(r7, { width: 720, height: 920 }).na, /frame PNG is 720×920, box 1440×1840/);
  assert.deepEqual(cropRect({ ...r7, frameBox: { x: 0, y: 0, w: 1439.6, h: 1840.4 } }, { width: 1440, height: 1840 }), { x: 0, y: 640, w: 1440, h: 800 });
});

await check('cropRect: a fractional frame box exports at its ceiling (1840.13 → 1841 px), not n/a', () => {
  const frac = { ...r7, frameBox: { x: 0, y: 0, w: 1440, h: 1840.13 } };
  assert.deepEqual(cropRect(frac, { width: 1440, height: 1841 }), { x: 0, y: 640, w: 1440, h: 800 });
  assert.deepEqual(cropRect({ ...r7, frameBox: { x: 0, y: 0, w: 1440, h: 1840.67 } }, { width: 1440, height: 1840 }), { x: 0, y: 640, w: 1440, h: 800 });
  assert.match(cropRect(frac, { width: 1440, height: 1842 }).na, /frame PNG is 1440×1842, box 1440×1840\.13/);
  const bottom = { ...r7, frameBox: { x: 0, y: 0, w: 1440, h: 1840.67 }, offset: { x: 0, y: 1040.6 }, box: { ...r7.box, h: 800 } };
  assert.deepEqual(cropRect(bottom, { width: 1440, height: 1840 }), { x: 0, y: 1041, w: 1440, h: 799 });
});

await check('textOf: visible TEXT characters in tree order, space-joined', () => {
  assert.equal(textOf(r7.box), 'Everything in one place Plan the work with a shared board that everyone on the team can read. Ship each change behind a review, and keep the history of every decision. New Try it');
  assert.equal(textOf({ ...r7.box, children: [] }), '');
});

await check('comparable: whitespace removed and case folded, then equal', () => {
  assert.equal(comparable(r7.box, S02_TEXT), true);
  assert.equal(comparable(r7.box, 'Our live headline'), false);
  assert.equal(comparable(r7.box, S02_TEXT.replace('Try it', 'Try it now')), false);
});

await check('textBoxes: the root\'s TEXT boxes in section coordinates', () => {
  const { boxes: list } = textBoxes(r7.box);
  assert.deepEqual(list[0], { x: 120, y: 80, w: 1200, h: 48 });
  assert.equal(list.length, 5);
  assert.ok(list.every((b) => b.w > 0 && b.h > 0));
});

let pngOk = false;
try { await import('pngjs'); await import('pixelmatch'); pngOk = true; } catch { console.log('skip  comparePngs (pngjs and pixelmatch are not importable here; run this test in an environment that has them)'); }

if (pngOk) {
  const { PNG } = await import('pngjs');
  const solid = (path, w, h, rgba = [200, 30, 30, 255]) => {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i += 1) png.data.set(rgba, i * 4);
    writeFileSync(path, PNG.sync.write(png));
    return path;
  };
  const work = join(scratch, 'png');
  mkdirSync(work, { recursive: true });
  const a = solid(join(work, 'a.png'), 10, 10);
  const same = solid(join(work, 'same.png'), 10, 10);
  const taller = solid(join(work, 'taller.png'), 10, 12);
  const boxesFile = join(work, 'boxes.json');
  writeFileSync(boxesFile, JSON.stringify({ boxes: [{ x: 0, y: 0, w: 5, h: 5 }] }));

  await check('comparePngs: identical PNGs → pct 0, exit 0, a diff image', () => {
    const r = comparePngs(a, same, { out: join(work, 'diff.png'), textBoxes: boxesFile });
    assert.equal(r.exit, 0);
    assert.equal(r.pct, 0);
    assert.equal(r.textPct, 0);
    assert.equal(r.heightDelta, 0);
    assert.ok(Array.isArray(r.bands));
    assert.ok(existsSync(join(work, 'diff.png')));
  });

  await check('comparePngs: a 10×10 against a 10×12 PNG → heightDelta -2 (a − b); a different colour is over no threshold', () => {
    assert.equal(comparePngs(a, taller, { out: join(work, 'diff2.png'), textBoxes: boxesFile }).heightDelta, -2);
    const red = solid(join(work, 'blue.png'), 10, 10, [30, 30, 200, 255]);
    const r = comparePngs(a, red, { out: join(work, 'diff3.png'), textBoxes: boxesFile });
    assert.equal(r.exit, 0);
    assert.equal(r.pct, 100);
  });

  await check('comparePngs: a missing PNG is a crash, not a verdict', () => {
    assert.throws(() => comparePngs(join(work, 'absent.png'), a, { out: join(work, 'diff4.png'), textBoxes: boxesFile }), /pixel-compare/);
  });
}

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  runPixel and the pixel CLI against page.html (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk && pngOk) {
  const { chromium } = await import('playwright');
  const urlOf = (p) => pathToFileURL(p.page).href;
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const pixelOf = (p) => JSON.parse(readFileSync(join(p.dir, '.work', 'reskin', 'gates', p.slug, 'figma', 'pixel.json'), 'utf8'));

  // The frame image: figma-frame.html drawn at 1440×1840, as M1 would cache it for frame 1:2.
  const frameImage = async (p, { register = true } = {}) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1840 } });
      await page.goto(pathToFileURL(join(p.root, 'figma-frame.html')).href);
      const v = (await import('../figma/cache.mjs')).cacheFor(p.dir, KEY).version(VERSION);
      mkdirSync(dirname(v.path('images/1-2.png')), { recursive: true });
      writeFileSync(v.path('images/1-2.png'), await page.screenshot());
      if (register) v.write('images.json', { '1:2': 'images/1-2.png' });
    } finally { await browser.close(); }
  };
  const project = async (n, opts) => {
    const p = makeProject(join(scratch, n));
    await frameImage(p, opts);
    return p;
  };
  const gate = async (p, extra = {}) => {
    const ready = await prepare({ dir: p.dir, slug: p.slug, url: urlOf(p) });
    assert.equal(ready.drift, false);
    return runPixel({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, dir: p.dir, out: ready.out, ...extra });
  };
  const by = (r, slot) => r.results.find((x) => x.slot === slot);

  await check('runPixel: s01 and s02 are advisory under 1 %, the work files and pixel.json are written', async () => {
    const p = await project('pass');
    const r = await gate(p);
    assert.deepEqual(r.results.map((x) => [x.slot, x.verdict]), [['s01', 'advisory'], ['s02', 'advisory']]);
    const s02 = by(r, 's02');
    assert.equal(s02.mode, 'auto');
    assert.ok(s02.pct < 1, `pct ${s02.pct}`);
    assert.ok(Number.isFinite(s02.textPct) && Number.isFinite(s02.heightDelta) && Array.isArray(s02.bands));
    assert.ok(s02.fonts.some((f) => f.family === 'Inter' && typeof f.served === 'boolean'), JSON.stringify(s02.fonts));
    const work = join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma');
    for (const f of ['s02.figma.png', 's02.page.png', 's02.diff.png', 's02.text-boxes.json', 'pixel.json']) assert.ok(existsSync(join(work, f)), f);
    assert.deepEqual(pixelOf(p), { results: r.results });
    assert.deepEqual(JSON.parse(readFileSync(join(work, 's02.text-boxes.json'), 'utf8')).boxes[0], { x: 120, y: 80, w: 1200, h: 48 });
  });

  await check('runPixel: a family the page neither loads nor has installed is not served; a generic family is', async () => {
    const p = await project('fonts');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('</style>', '.hero, .hero * { font-family: "Nowhere Sans Synthetic", sans-serif !important; }\n.features, .features * { font-family: sans-serif !important; }\n</style>'));
    const r = await gate(p);
    assert.deepEqual(by(r, 's01').fonts, [{ family: 'Nowhere Sans Synthetic', served: false }]);
    assert.deepEqual(by(r, 's02').fonts, [{ family: 'sans-serif', served: true }]);
  });

  await check('runPixel: a section whose copy differs from the frame is n/a: frame content differs, with no screenshot', async () => {
    const p = await project('differs');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('A calm, readable', 'A live, readable'));
    const r = await gate(p);
    assert.equal(by(r, 's01').verdict, 'n/a');
    assert.equal(by(r, 's01').reason, 'frame content differs');
    assert.equal(by(r, 's02').verdict, 'advisory');
    assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 's01.page.png')));
  });

  await check('runPixel: no image for the frame is n/a, re-run figma-donor capture', async () => {
    const p = await project('no-image', { register: false });
    const r = await gate(p);
    assert.deepEqual(r.results.map((x) => [x.verdict, x.reason]), [['n/a', 'no frame image (re-run figma-donor capture)'], ['n/a', 'no frame image (re-run figma-donor capture)']]);
  });

  await check('runPixel: a frame PNG of another size is n/a with the sizes', async () => {
    const p = await project('scaled');
    const v = (await import('../figma/cache.mjs')).cacheFor(p.dir, KEY).version(VERSION);
    const { PNG } = await import('pngjs');
    writeFileSync(v.path('images/1-2.png'), PNG.sync.write(new PNG({ width: 720, height: 920 })));
    const r = await gate(p);
    assert.match(by(r, 's02').reason, /frame PNG is 720×920, box 1440×1840/);
    assert.equal(by(r, 's02').verdict, 'n/a');
  });

  await check('runPixel: mode off is n/a with the why; mode fixture screenshots the selector on fixtureUrl', async () => {
    const p = await project('modes');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    checks.sections.s01.pixel = { mode: 'off', why: 'hero is a video' };
    checks.sections.s02.pixel = { mode: 'fixture', fixtureUrl: pathToFileURL(join(p.root, 'figma-frame.html')).href };
    writeFileSync(file, JSON.stringify(checks));
    const r = await gate(p);
    assert.deepEqual([by(r, 's01').verdict, by(r, 's01').reason, by(r, 's01').mode], ['n/a', 'off: hero is a video', 'off']);
    assert.equal(by(r, 's02').mode, 'fixture');
    assert.equal(by(r, 's02').verdict, 'advisory');
    assert.equal(by(r, 's02').pct, 0);
  });

  await check('runPixel: a pixel-compare deadline is no verdict', async () => {
    const p = await project('deadline');
    const r = await gate(p, { timeout: 0.001 });
    assert.ok(r.results.every((x) => x.verdict === 'no verdict'), JSON.stringify(r.results.map((x) => x.verdict)));
  });

  await check('CLI pixel on page.html: header with the uncalibrated reference, one line per section, exit 0', async () => {
    const p = await project('cli');
    const r = run(['pixel', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^pixel advisory.*uncalibrated reference.*3%.*3\.5%.*4%/m);
    assert.match(r.stdout, /^ {2}s01 \d+\.\d\d% \(text \d+\.\d\d%, Δh -?\d+\)$/m);
    assert.match(r.stdout, /^ {2}s02 \d+\.\d\d% \(text \d+\.\d\d%, Δh -?\d+\)$/m);
  });

  await check('CLI pixel with different copy: the section line is n/a: frame content differs, exit 0', async () => {
    const p = await project('cli-differs');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('A calm, readable', 'A live, readable'));
    const r = run(['pixel', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ {2}s01 n\/a: frame content differs$/m);
    assert.match(r.stdout, /^ {2}s02 \d+\.\d\d% /m);
  });

  await check('CLI pixel stops at join drift: FAIL join line, exit 1, no pixel.json', async () => {
    const p = await project('cli-drift');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('data-slot="s02"', 'data-slot="s09"'));
    const r = run(['pixel', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL join/);
    assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'pixel.json')));
  });

  await check('CLI pixel needs --page and --url (exit 2)', () => {
    assert.equal(run(['pixel', '--url', 'x.html'], scratch).status, 2);
    assert.equal(run(['pixel', '--page', 'home'], scratch).status, 2);
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
