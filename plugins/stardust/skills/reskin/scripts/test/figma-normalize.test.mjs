#!/usr/bin/env node
// skills/reskin/scripts/test/figma-normalize.test.mjs — the Figma value normalizers: colors to the
// computed-style strings the donor probe asserts (rgb/rgba, hex for DESIGN files), px rounding,
// padding shorthand collapse, radii, shadows (drop, inset, invisible), line height (px and
// unitless), letter spacing (normal, px, em), and solid-fill selection (gradients, invisible paints
// and paint opacity). Pure, no network, no browser. Run: node <this file>.
import assert from 'node:assert/strict';
import {
  colorToCss, colorToHex, px, paddingShorthand, radiusCss, shadowCss,
  lineHeightCss, letterSpacingCss, weightCss, solidFill,
} from '../figma/normalize.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const NAVY = { r: 0.12156863, g: 0.22745098, b: 0.37254903, a: 1 };

check('colorToCss: opaque colors are rgb() with spaced channels', () => {
  assert.equal(colorToCss({ r: 1, g: 1, b: 1, a: 1 }), 'rgb(255, 255, 255)');
  assert.equal(colorToCss(NAVY), 'rgb(31, 58, 95)');
});
check('colorToCss: paint opacity or color alpha below 1 gives rgba() with trimmed alpha', () => {
  assert.equal(colorToCss(BLACK, 0.5), 'rgba(0, 0, 0, 0.5)');
  assert.equal(colorToCss({ r: 0, g: 0, b: 0, a: 0.12 }), 'rgba(0, 0, 0, 0.12)');
  assert.equal(colorToCss({ r: 0, g: 0, b: 0, a: 0.33333 }), 'rgba(0, 0, 0, 0.333)');
});
check('colorToHex: #rrggbb, with alpha byte only below 1', () => {
  assert.equal(colorToHex(NAVY), '#1f3a5f');
  assert.equal(colorToHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
});
check('px: rounds to 2 decimals and trims zeros', () => {
  assert.equal(px(15.5), '15.5px');
  assert.equal(px(16.0004), '16px');
  assert.equal(px(0), '0px');
  assert.equal(px(-1.125), '-1.13px');
});
check('paddingShorthand: collapses like a computed padding shorthand', () => {
  assert.equal(paddingShorthand([16, 24, 16, 24]), '16px 24px');
  assert.equal(paddingShorthand([15.5, 24, 16.5, 24]), '15.5px 24px 16.5px');
  assert.equal(paddingShorthand([8, 8, 8, 8]), '8px');
  assert.equal(paddingShorthand([1, 2, 3, 4]), '1px 2px 3px 4px');
});
check('radiusCss: uniform, per-corner, none', () => {
  assert.equal(radiusCss({ cornerRadius: 8 }), '8px');
  assert.equal(radiusCss({ rectangleCornerRadii: [8, 8, 0, 0] }), '8px 8px 0px 0px');
  assert.equal(radiusCss({ rectangleCornerRadii: [4, 4, 4, 4] }), '4px');
  assert.equal(radiusCss({}), null);
});
check('shadowCss: drop shadow as color x y blur spread', () => {
  assert.equal(shadowCss([{ type: 'DROP_SHADOW', visible: true, color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0 }]), 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px');
});
check('shadowCss: inner shadow ends with inset; several are comma-joined', () => {
  assert.match(shadowCss([{ type: 'INNER_SHADOW', visible: true, color: BLACK, offset: { x: 0, y: 1 }, radius: 2 }]), / inset$/);
  const two = shadowCss([
    { type: 'DROP_SHADOW', visible: true, color: BLACK, offset: { x: 0, y: 1 }, radius: 2 },
    { type: 'DROP_SHADOW', visible: true, color: BLACK, offset: { x: 0, y: 2 }, radius: 4 },
  ]);
  assert.equal(two, 'rgb(0, 0, 0) 0px 1px 2px 0px, rgb(0, 0, 0) 0px 2px 4px 0px');
});
check('shadowCss: invisible shadows and blurs are skipped; nothing left is null', () => {
  assert.equal(shadowCss([{ type: 'DROP_SHADOW', visible: false, color: BLACK, offset: { x: 0, y: 1 }, radius: 2 }]), null);
  assert.equal(shadowCss([{ type: 'LAYER_BLUR', visible: true, radius: 4 }]), null);
  assert.equal(shadowCss([]), null);
  assert.equal(shadowCss(undefined), null);
});
check('lineHeightCss: px by default, unitless ratio on request, normal for intrinsic', () => {
  assert.equal(lineHeightCss({ lineHeightPx: 28, fontSize: 18 }), '28px');
  assert.equal(lineHeightCss({ lineHeightPx: 28, fontSize: 18 }, true), '1.556');
  assert.equal(lineHeightCss({ lineHeightPx: 22, fontSize: 16, lineHeightUnit: 'INTRINSIC_%' }), 'normal');
});
check('letterSpacingCss: normal at 0, px by default, em on request', () => {
  assert.equal(letterSpacingCss({ letterSpacing: 0, fontSize: 16 }), 'normal');
  assert.equal(letterSpacingCss({ fontSize: 16 }), 'normal');
  assert.equal(letterSpacingCss({ letterSpacing: -1.12, fontSize: 56 }), '-1.12px');
  assert.equal(letterSpacingCss({ letterSpacing: -1.12, fontSize: 56 }, 'em'), '-0.02em');
});
check('weightCss: numeric weight as a string', () => {
  assert.equal(weightCss(400), '400');
  assert.equal(weightCss(700.0), '700');
});
check('solidFill: a gradient is not a color', () => {
  assert.deepEqual(solidFill([{ type: 'GRADIENT_LINEAR', visible: true }]), { css: null, hex: null, kind: 'GRADIENT_LINEAR' });
  assert.deepEqual(solidFill([{ type: 'IMAGE', visible: true, imageRef: 'x' }]), { css: null, hex: null, kind: 'IMAGE' });
});
check('solidFill: Figma lists paints bottom to top, so the last visible paint is the one seen', () => {
  assert.equal(solidFill([{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }, { type: 'SOLID', color: NAVY }]).css, 'rgb(31, 58, 95)');
  assert.equal(solidFill([{ type: 'SOLID', color: BLACK }, { type: 'SOLID', visible: false, color: { r: 1, g: 0, b: 0, a: 1 } }]).css, 'rgb(0, 0, 0)');
  assert.equal(solidFill([{ type: 'SOLID', color: NAVY }, { type: 'IMAGE', imageRef: 'x' }]).kind, 'IMAGE');
  assert.equal(solidFill([{ type: 'GRADIENT_LINEAR' }, { type: 'SOLID', color: NAVY }]).css, 'rgb(31, 58, 95)', 'an opaque solid on top covers what is below');
});
check('solidFill: a translucent solid over another visible paint is a composite, not a color', () => {
  assert.deepEqual(solidFill([{ type: 'IMAGE', imageRef: 'x' }, { type: 'SOLID', color: BLACK, opacity: 0.5 }]), { css: null, hex: null, kind: 'COMPOSITE' });
  assert.equal(solidFill([{ type: 'SOLID', color: BLACK, opacity: 0.5 }]).css, 'rgba(0, 0, 0, 0.5)', 'alone it is a translucent color');
});
check('solidFill: missing visible means visible', () => {
  assert.equal(solidFill([{ type: 'SOLID', visible: false, color: { r: 1, g: 0, b: 0, a: 1 } }, { type: 'SOLID', color: BLACK }]).css, 'rgb(0, 0, 0)');
});
check('solidFill: paint opacity multiplies color alpha', () => {
  const f = solidFill([{ type: 'SOLID', color: BLACK, opacity: 0.5 }]);
  assert.equal(f.css, 'rgba(0, 0, 0, 0.5)');
  assert.equal(f.hex, '#00000080');
  assert.equal(f.kind, 'SOLID');
});
check('solidFill: no paints or only invisible paints is NONE', () => {
  assert.equal(solidFill([]).kind, 'NONE');
  assert.equal(solidFill(undefined).kind, 'NONE');
  assert.equal(solidFill([{ type: 'SOLID', visible: false, color: BLACK }]).kind, 'NONE');
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
