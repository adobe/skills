#!/usr/bin/env node
// Token probe — gate 1 of figma-to-eds (reference/gates.md).
// Asserts a rendered stylesheet against donor-tokens.json:
//   A. every curated custom property is defined on :root with the exact
//      authored string (custom properties don't get browser-serialized,
//      so this is byte equality — no color conversion needed);
//   B. the element type ramp (kit html-mapping) computes to the expected
//      font-size / font-weight / font-style / line-height per breakpoint.
// Normalizations applied are ONLY those declared in the token sheet:
// percent->unitless line-height (already in the sheet), desktop->web
// font family name, computed line-height px = size * factor (±0.1px).
//
// Usage: node token-probe.mjs --tokens <donor-tokens.json> --css <styles.css> --out <report.json>
// Env: NODE_MODULES_DIR — a node_modules dir that contains playwright.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const tokensPath = arg('--tokens'); const cssPath = arg('--css'); const outPath = arg('--out');
if (!tokensPath || !cssPath || !outPath) { console.error('usage: --tokens <json> --css <css> --out <report>'); process.exit(2); }

const req = createRequire(process.env.NODE_MODULES_DIR
  ? join(resolve(process.env.NODE_MODULES_DIR), 'probe-resolver.cjs') : import.meta.url);
const { chromium } = req('playwright');

const sheet = JSON.parse(readFileSync(tokensPath, 'utf8'));
const T = sheet.tokens;

// probe page: bare elements + the stylesheet under test
const dir = mkdtempSync(join(tmpdir(), 'token-probe-'));
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${resolve(cssPath)}"></head><body>
<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>
<p class="lead">lead</p><p>para</p><ul><li>item</li></ul></body></html>`;
writeFileSync(join(dir, 'probe.html'), html);

// family equivalences come from the token sheet's declared normalizations —
// never hardcoded here (desktop font name vs licensed web font name)
const FAMILY_EQ = new Set((T.typography.familyEquivalences || [[T.typography.families?.primary]])
  .flat().filter(Boolean).map((f) => f.toLowerCase()));

const styleKey = (figmaName) => figmaName.toLowerCase().replace(/[/. ]+/g, '-');
const pickStyle = (name) => T.typography.styles[styleKey(name)]
  || T.typography.styles[styleKey(name) + '-book'];

const failures = []; let checks = 0;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + join(dir, 'probe.html'));

// --- A. custom properties on :root ---
const sections = ['colors', 'radii', 'borderWidths', 'shadows', 'spacing', 'sizing',
  'spaceSemantic', 'sizeSemantic', 'durations', 'easings'];
const expected = {};
for (const s of sections) for (const [p, e] of Object.entries(T[s])) expected[p] = { v: e.value, s };
const actual = await page.evaluate((props) => {
  const cs = getComputedStyle(document.documentElement); const out = {};
  for (const p of props) out[p] = cs.getPropertyValue(p).trim();
  return out;
}, Object.keys(expected));
for (const [p, e] of Object.entries(expected)) {
  checks += 1;
  if (actual[p] !== e.v) failures.push({ gate: 'custom-property', prop: p, section: e.s, expected: e.v, actual: actual[p] || '(undefined)' });
}

// --- B. element ramp per breakpoint ---
const BREAKPOINTS = { mobile: 430, tablet: 1000, desktop: 1440 };
const ELEMENTS = Object.entries(sheet.tokens.typography.htmlMapping)
  .map(([el, style]) => ({ el, sel: el === 'p' ? 'p:not(.lead)' : el, style: pickStyle(style), styleName: style }))
  .filter((e) => e.style);
for (const [bp, width] of Object.entries(BREAKPOINTS)) {
  await page.setViewportSize({ width, height: 900 });
  const got = await page.evaluate((sels) => sels.map((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el);
    return { sel, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase() };
  }), ELEMENTS.map((e) => e.sel));
  for (let i = 0; i < ELEMENTS.length; i += 1) {
    const e = ELEMENTS[i]; const g = got[i]; if (!g) continue;
    const props = e.style.props[bp] || e.style.props.all;
    if (!props) continue;
    checks += 4;
    if (g.fontSize !== props['font-size']) failures.push({ gate: 'element-ramp', el: e.el, bp, prop: 'font-size', expected: props['font-size'], actual: g.fontSize });
    if (g.fontWeight !== props['font-weight']) failures.push({ gate: 'element-ramp', el: e.el, bp, prop: 'font-weight', expected: props['font-weight'], actual: g.fontWeight });
    if (g.fontStyle !== props['font-style']) failures.push({ gate: 'element-ramp', el: e.el, bp, prop: 'font-style', expected: props['font-style'], actual: g.fontStyle });
    const expLh = parseFloat(props['font-size']) * parseFloat(props['line-height']);
    if (Math.abs(parseFloat(g.lineHeight) - expLh) > 0.1) failures.push({ gate: 'element-ramp', el: e.el, bp, prop: 'line-height', expected: `${expLh}px (${props['line-height']} x ${props['font-size']})`, actual: g.lineHeight });
    checks += 1;
    if (!FAMILY_EQ.has(g.family)) failures.push({ gate: 'element-ramp', el: e.el, bp, prop: 'font-family', expected: `[${[...FAMILY_EQ].join(' | ')}]`, actual: g.family });
  }
}
await browser.close();

const report = {
  ranAt: new Date().toISOString(), tokens: tokensPath, css: cssPath,
  checks, failures: failures.length, pass: failures.length === 0, detail: failures,
};
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${report.pass ? 'PASS' : 'FAIL'} — ${checks} checks, ${failures.length} failures -> ${outPath}`);
if (failures.length) console.log(failures.slice(0, 12).map((f) => `  ${f.gate} ${f.prop} ${f.el || f.section || ''} ${f.bp || ''}: expected ${f.expected} got ${f.actual}`).join('\n'));
process.exit(failures.length ? 1 : 0);
