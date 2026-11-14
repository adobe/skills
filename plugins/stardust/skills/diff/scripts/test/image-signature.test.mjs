#!/usr/bin/env node
// skills/diff/scripts/test/image-signature.test.mjs — the pure part of image-signature.mjs: signatureDistance, isBlank,
// sameImage (RGB pixels within SAME_IMAGE_MAX over the drawn cells, boxes within 2 px, a blank grid never an identity;
// a recoloured shape and a different thin-line icon are other images). The in-page grid and the element screenshots
// run in content-diff's end-to-end test. Run: node <this file>.
import assert from 'node:assert/strict';
import { SAME_IMAGE_MAX, SIG_SIZE, isBlank, sameImage, signatureDistance } from '../image-signature.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const N = SIG_SIZE * SIG_SIZE;
const WHITE = [255, 255, 255];
// a SIG_SIZE × SIG_SIZE RGB grid: ink(x, y) → [r, g, b] or null for the background
const grid = (ink, bg = WHITE) => Array.from({ length: N }, (_, i) => ink(i % SIG_SIZE, Math.floor(i / SIG_SIZE)) || bg).flat();
const disk = (rgb) => grid((x, y) => ((x - 5.5) ** 2 + (y - 5.5) ** 2 <= 16 ? rgb : null));
const logo = disk([42, 170, 102]);
const shifted = (sig, by) => sig.map((v) => Math.max(0, Math.min(255, v + by)));
const grey = (sig) => { const out = []; for (let i = 0; i < sig.length; i += 3) out.push(0.299 * sig[i] + 0.587 * sig[i + 1] + 0.114 * sig[i + 2]); return out; };

check('signatureDistance: mean |Δ| on 0–255 over the drawn cells; null when a side is missing or the grids differ in size', () => {
  assert.equal(signatureDistance(logo, logo), 0);
  assert.equal(signatureDistance(logo, shifted(logo, -10)), 10);
  assert.equal(signatureDistance(logo, null), null);
  assert.equal(signatureDistance(logo, logo.slice(3)), null);
});
check('isBlank: a near-uniform grid (an empty box, an unrendered glyph, a solid fill) carries no identity', () => {
  assert.equal(isBlank(grid(() => null)), true);
  assert.equal(isBlank(grid((x) => (x % 2 ? [245, 245, 245] : null))), true);
  assert.equal(isBlank(grid(() => [206, 43, 55])), true);
  assert.equal(isBlank(logo), false);
  assert.equal(isBlank(undefined), true);
});
check('sameImage: the same pixels in boxes within 2 px; a distance over SAME_IMAGE_MAX, another box or a blank side is not the same image', () => {
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: logo, size: '24×16' }), true);
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: shifted(logo, -1), size: '25×16' }), true);
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: shifted(logo, -(SAME_IMAGE_MAX + 20)), size: '24×16' }), false);
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: logo, size: '32×16' }), false);
  const blank = grid(() => null);
  assert.equal(sameImage({ sig: blank, size: '16×16' }, { sig: blank, size: '16×16' }), false);
  assert.equal(sameImage({ size: '16×16' }, { sig: logo, size: '16×16' }), false);
});
check('sameImage: the same shape recoloured red (#CE2B37) vs green (#009246) is another image — the grey levels (≈93 vs ≈94) would have matched', () => {
  const red = disk([0xce, 0x2b, 0x37]); const green = disk([0x00, 0x92, 0x46]);
  assert.ok(Math.abs(grey(red)[66] - grey(green)[66]) < 2, 'the two colours are the same grey');
  assert.equal(sameImage({ sig: red, size: '16×16' }, { sig: green, size: '16×16' }), false);
});
check('sameImage: two different thin-line icons in a mostly-white box are other images — averaged over the whole box they would pass', () => {
  const line = [190, 190, 190]; // a 1 px stroke covers a 2 px cell by half
  const diag = grid((x, y) => (x === y && x >= 3 && x <= 8 ? line : null));
  const anti = grid((x, y) => (x + y === 11 && x >= 3 && x <= 8 && x !== 5 && x !== 6 ? line : null));
  const wholeBox = diag.reduce((s, v, i) => s + Math.abs(v - anti[i]), 0) / diag.length;
  assert.ok(wholeBox <= SAME_IMAGE_MAX, `whole-box mean ${wholeBox.toFixed(1)} hides the difference`);
  assert.equal(sameImage({ sig: diag, size: '24×24' }, { sig: anti, size: '24×24' }), false);
  assert.equal(sameImage({ sig: diag, size: '24×24' }, { sig: diag, size: '24×24' }), true);
});

console.log(failed ? `\n${failed} failing` : '\nimage-signature: all checks passed');
process.exit(failed ? 1 : 0);
