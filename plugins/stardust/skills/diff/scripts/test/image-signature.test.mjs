#!/usr/bin/env node
// skills/diff/scripts/test/image-signature.test.mjs — the pure part of image-signature.mjs: signatureDistance, isBlank,
// sameImage (pixels within SAME_IMAGE_MAX, boxes within 2 px, a blank grid never an identity). The in-page grid and the
// element screenshots run in content-diff's end-to-end test. Run: node <this file>.
import assert from 'node:assert/strict';
import { SAME_IMAGE_MAX, SIG_SIZE, isBlank, sameImage, signatureDistance } from '../image-signature.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message}`); } };
const N = SIG_SIZE * SIG_SIZE;
const logo = Array.from({ length: N }, (_, i) => (i % 3 ? 40 : 230));
const shifted = (sig, by) => sig.map((v) => Math.min(255, v + by));

check('signatureDistance: mean |Δ| on 0–255; null when a side is missing or the grids differ in size', () => {
  assert.equal(signatureDistance(logo, logo), 0);
  assert.equal(signatureDistance(logo, shifted(logo, 10)), 10);
  assert.equal(signatureDistance(logo, null), null);
  assert.equal(signatureDistance(logo, logo.slice(1)), null);
});
check('isBlank: a near-uniform grid (an empty box, an unrendered glyph) carries no identity', () => {
  assert.equal(isBlank(new Array(N).fill(255)), true);
  assert.equal(isBlank(new Array(N).fill(250).map((v, i) => v - (i % 2) * 10)), true);
  assert.equal(isBlank(logo), false);
  assert.equal(isBlank(undefined), true);
});
check('sameImage: the same pixels in boxes within 2 px; a distance over SAME_IMAGE_MAX, another box or a blank side is not the same image', () => {
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: shifted(logo, 1), size: '25×16' }), true);
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: shifted(logo, SAME_IMAGE_MAX + 20), size: '24×16' }), false);
  assert.equal(sameImage({ sig: logo, size: '24×16' }, { sig: logo, size: '32×16' }), false);
  const blank = new Array(N).fill(255);
  assert.equal(sameImage({ sig: blank, size: '16×16' }, { sig: blank, size: '16×16' }), false);
  assert.equal(sameImage({ size: '16×16' }, { sig: logo, size: '16×16' }), false);
});

console.log(failed ? `\n${failed} failing` : '\nimage-signature: all checks passed');
process.exit(failed ? 1 : 0);
