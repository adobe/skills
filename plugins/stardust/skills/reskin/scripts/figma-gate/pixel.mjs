// skills/reskin/scripts/figma-gate/pixel.mjs — B2, frame pixels, advisory only. Where the Figma frame's
// copy is the page's copy, the section's slice of the cached frame PNG is compared with an element
// screenshot of the section through replica's pixel-compare.mjs (a = the Figma slice, b = the page).
// The number never fails the gate: REFERENCE_CLASSES are uncalibrated reading aids, and a section whose
// copy, frame image or frame size does not allow a fair comparison is reported "n/a" with the reason.
// cropRect, textOf, comparable and textBoxes are pure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheFor } from '../figma/cache.mjs';
import { UsageError } from '../figma/errors.mjs';
import { loadChromium, loadMeasureLive, localAttributes, localTarget } from './target.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts: the plugin tree (skills/reskin/scripts/figma-gate ↔ skills/replica/scripts) and the project
// copy (stardust/scripts/reskin/figma-gate ↔ stardust/scripts/replica).
const PIXEL_COMPARE = ['../../../replica/scripts/pixel-compare.mjs', '../../replica/pixel-compare.mjs'];
const DEADLINE_EXIT = 124;

// Typical differing-pixel shares seen on faithful reproductions, by kind of ground: orientation only.
export const REFERENCE_CLASSES = { lightText: 3, inverted: 3.5, rasterGround: 4 };

const flat = (box) => [box, ...box.children.flatMap(flat)];
const textBoxesOf = (box) => flat(box).filter((b) => b.type === 'TEXT' && b.text && b.text.characters.trim() !== '');

// The section's rectangle inside the frame PNG, or { na } when the PNG is not the frame at 1×. Figma
// exports a fractional frame box at its ceiling (1840.13 → 1841 px), so any size within 1px fits.
export function cropRect(root, png) {
  const { w: fw, h: fh } = root.frameBox;
  if (Math.abs(png.width - fw) >= 1 || Math.abs(png.height - fh) >= 1) return { na: `frame PNG is ${png.width}×${png.height}, box ${fw}×${fh}` };
  const [x, y] = [Math.round(root.offset.x), Math.round(root.offset.y)];
  return { x, y, w: Math.min(Math.round(root.box.w), png.width - x), h: Math.min(Math.round(root.box.h), png.height - y) };
}

export const textOf = (box) => textBoxesOf(box).map((b) => b.text.characters.trim()).join(' ');

const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
export const comparable = (box, sectionText) => squash(textOf(box)) === squash(sectionText);

// The origin's text boxes in section coordinates, the shape pixel-compare --text-boxes reads.
export function textBoxes(box) {
  return { boxes: textBoxesOf(box).filter((b) => b.w > 0 && b.h > 0).map(({ x, y, w, h }) => ({ x, y, w, h })) };
}

export function pixelComparePath() {
  const path = PIXEL_COMPARE.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
  if (!path) throw new UsageError('pixel-compare.mjs not found (looked in ../../../replica/scripts/ and ../../replica/): copy the replica skill\'s scripts beside the reskin scripts (stardust/scripts/replica/)');
  return path;
}

// pixel-compare over two PNGs with its own pass bar out of the way: the number is advisory. Exit 124 is
// its deadline (no verdict); any other failure is a crash.
export function comparePngs(figmaPng, pagePng, { out, textBoxes: boxesFile, timeout = 120 }) {
  mkdirSync(dirname(out), { recursive: true });
  const args = [pixelComparePath(), figmaPng, pagePng, '--out', out, '--json', '--threshold', '100', '--timeout', String(timeout), '--text-boxes', boxesFile];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === DEADLINE_EXIT) return { exit: DEADLINE_EXIT };
  if (r.status !== 0) throw new Error(`pixel-compare exited ${r.status}: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  const j = JSON.parse(r.stdout);
  return { pct: j.pct, textPct: j.textPct, heightDelta: j.heightDelta, bands: j.bands, exit: 0 };
}

async function loadPng() {
  try { return (await import('pngjs')).PNG; } catch {
    throw new UsageError('pngjs is not importable from the reskin scripts: run npm i -D pngjs pixelmatch --legacy-peer-deps in the project (reskin SKILL.md § Setup)');
  }
}

function crop(PNG, png, rect) {
  const out = new PNG({ width: rect.w, height: rect.h });
  PNG.bitblt(png, out, rect.x, rect.y, rect.w, rect.h, 0, 0);
  return PNG.sync.write(out);
}

// The distinct first families the section computes, each with whether the page renders it: a generic
// family, a loaded @font-face of the page, or a family installed where the page is measured.
// document.fonts.check() is no test: it answers true for a family no face declares.
const fontsIn = (page, selector) => page.evaluate((sel) => {
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
  const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => unquote(f.family).toLowerCase()));
  const ctx = document.createElement('canvas').getContext('2d');
  const widthIn = (font) => { ctx.font = font; return ctx.measureText('mmmmmmmmmmlli1WQ@#').width; };
  const installed = (family) => ['monospace', 'serif', 'sans-serif'].some((base) => widthIn(`72px ${base}`) !== widthIn(`72px "${family}", ${base}`));
  const root = document.querySelector(sel);
  const families = new Set();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const first = unquote(getComputedStyle(el).fontFamily.split(',')[0]);
    if (first) families.add(first);
  }
  return [...families].map((family) => ({ family, served: GENERIC.has(family.toLowerCase()) || loaded.has(family.toLowerCase()) || installed(family) }));
}, selector);

// The first line of the pixel step. A comparison that hit its deadline leaves the section without a number: the
// line then leads with ERROR (exit 124), which run-bg's default verdict filter matches, instead of "advisory".
export function pixelHeadline(results) {
  const ref = REFERENCE_CLASSES;
  const classes = `uncalibrated reference: light text ${ref.lightText}%, inverted ${ref.inverted}%, raster ground ${ref.rasterGround}%`;
  const lost = results.filter((r) => r.verdict === 'no verdict').length;
  return lost
    ? `ERROR (exit 124) pixel no verdict: ${lost} of ${results.length} section(s) hit a deadline, re-run; ${classes}`
    : `pixel advisory: ${results.length} section(s); ${classes}`;
}

const na = (reason) => ({ verdict: 'n/a', reason, fonts: [] });

// → { results: [{ slot, mode, verdict: 'advisory' | 'n/a' | 'no verdict', pct?, textPct?, heightDelta?,
// bands?, reason?, fonts }] }; writes <slot>.figma.png, .page.png, .diff.png, .text-boxes.json and pixel.json
// under out. Never fails the gate; a crash of the comparison throws.
export async function runPixel({ target, join: joined, checks, boxes, dir, out, timeout = 120 }) {
  mkdirSync(out, { recursive: true });
  const PNG = await loadPng();
  const version = cacheFor(dir, boxes.fileKey).version(boxes.version);
  const images = version.read('images.json') ?? {};
  const pages = new Map();
  let browser = null;
  const pageFor = async (tgt, width) => {
    const key = `${tgt.url}@${width}`;
    if (!pages.has(key)) {
      if (!browser) {
        const [chromium, { openBrowser }] = await Promise.all([loadChromium(), loadMeasureLive()]);
        browser = await openBrowser(chromium, { tier: 'plain' });
      }
      pages.set(key, await tgt.open(browser, width));
    }
    return pages.get(key);
  };

  const results = [];
  try {
    for (const section of joined.sections) {
      const cfg = checks[section.slot];
      if (!cfg) continue;
      const { slot } = section;
      const { mode } = cfg.pixel;
      const done = (r) => results.push({ slot, mode, root: cfg.root, ...r });
      const root = boxes.roots[cfg.root];

      if (mode === 'off') { done(na(`off: ${cfg.pixel.why}`)); continue; }
      const image = images[root.frame] ? version.path(images[root.frame]) : null;
      if (!image || !existsSync(image)) { done(na('no frame image (re-run figma-donor capture)')); continue; }
      const frame = PNG.sync.read(readFileSync(image));
      const rect = cropRect(root, frame);
      if (rect.na) { done(na(rect.na)); continue; }

      // A fixture is a hand-made local page: its section is found by data-slot, whatever regime the target has.
      const pageTarget = mode === 'fixture' ? localTarget(cfg.pixel.fixtureUrl) : target;
      const selector = mode === 'fixture' ? localAttributes.selector(slot) : section.selector;
      const page = await pageFor(pageTarget, cfg.width);
      const locator = page.locator(selector);
      if (await locator.count() === 0) { done(na(`${selector} matched nothing on ${pageTarget.url}`)); continue; }
      const fonts = await fontsIn(page, selector);
      if (!comparable(root.box, await locator.first().innerText())) { done({ ...na('frame content differs'), fonts }); continue; }

      const files = Object.fromEntries(['figma', 'page', 'diff', 'text-boxes'].map((k) => [k, join(out, `${slot}.${k}.${k === 'text-boxes' ? 'json' : 'png'}`)]));
      writeFileSync(files.figma, crop(PNG, frame, rect));
      writeFileSync(files.page, await locator.first().screenshot({ animations: 'disabled' }));
      writeFileSync(files['text-boxes'], `${JSON.stringify(textBoxes(root.box))}\n`);
      const cmp = comparePngs(files.figma, files.page, { out: files.diff, textBoxes: files['text-boxes'], timeout });
      if (cmp.exit === DEADLINE_EXIT) done({ verdict: 'no verdict', reason: `pixel-compare hit its ${timeout}s deadline: re-run`, fonts });
      else done({ verdict: 'advisory', pct: cmp.pct, textPct: cmp.textPct, heightDelta: cmp.heightDelta, bands: cmp.bands, fonts });
    }
  } finally {
    for (const page of pages.values()) await page.context().close();
    if (browser) await browser.close();
  }
  writeFileSync(join(out, 'pixel.json'), `${JSON.stringify({ url: target.url, regime: target.regime, results }, null, 2)}\n`);
  return { results };
}
