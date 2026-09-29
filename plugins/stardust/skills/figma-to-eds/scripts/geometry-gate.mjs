#!/usr/bin/env node
// Geometry gate — the variant-coverage half of figma-to-eds gate 2.
// Pixel diffs need an opaque reference; Figma metadata gives exact
// x/y/w/h for EVERY variant, including transparent ones. This gate
// renders each case at its design viewport and asserts rendered
// bounding boxes (relative to the target element's origin) against the
// kit's geometry, within per-check tolerances.
//
// Spec file:
// { "page": "<url>", "origin": "main",
//   "cases": [ { "name": "tablet", "page": "<override url>",
//     "viewport": { "width": 834, "height": 1400 },
//     "checks": [ { "name": "h1", "selector": ".hero h1",
//       "expect": { "top": 100, "left": 72, "width": 690, "height": 55 },
//       "tol": { "default": 1, "height": 3, "top": 2 },
//       "source": "1793:54936" } ] } ] }
// Any expect key may be omitted. tol.default applies unless overridden.
//
// Gap checks: after a text block, browser line counts may differ from the
// kit render (cross-engine metrics) — absolute kit tops embed the kit's
// line count. The kit INVARIANT is the spacing between elements. Use:
//   { "name": "button-gap", "selector": ".hero a.button",
//     "expect": { "gap": 32 }, "gapFrom": "<selector of element above>" }
// gap = this.top - gapFrom.bottom.
//
// Usage: node geometry-gate.mjs --spec <spec.json> --out <report.json>
// Env: NODE_MODULES_DIR — node_modules containing playwright.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const specPath = arg('--spec'); const outPath = arg('--out');
if (!specPath || !outPath) { console.error('usage: --spec <json> --out <report>'); process.exit(2); }

const req = createRequire(process.env.NODE_MODULES_DIR
  ? join(resolve(process.env.NODE_MODULES_DIR), 'geo-resolver.cjs') : import.meta.url);
const { chromium } = req('playwright');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const browser = await chromium.launch();
const failures = []; let checks = 0;
const results = [];

for (const c of spec.cases) {
  const page = await browser.newPage({ viewport: c.viewport, deviceScaleFactor: 1 });
  await page.goto(c.page || spec.page, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  const measured = await page.evaluate(({ origin, items }) => {
    const o = document.querySelector(origin).getBoundingClientRect();
    return items.map(({ sel, gapFrom }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const m = { top: b.top - o.top, left: b.left - o.left, width: b.width, height: b.height };
      if (gapFrom) {
        const ref = document.querySelector(gapFrom);
        if (ref) m.gap = b.top - ref.getBoundingClientRect().bottom;
      }
      return m;
    });
  }, { origin: spec.origin || 'main', items: c.checks.map((k) => ({ sel: k.selector, gapFrom: k.gapFrom })) });
  await page.close();

  for (let i = 0; i < c.checks.length; i += 1) {
    const k = c.checks[i]; const m = measured[i];
    if (!m) { failures.push({ case: c.name, check: k.name, error: 'selector not found', selector: k.selector }); continue; }
    for (const [prop, exp] of Object.entries(k.expect)) {
      checks += 1;
      const tol = (k.tol && (k.tol[prop] ?? k.tol.default)) ?? 1;
      const got = m[prop];
      if (Math.abs(got - exp) > tol) {
        failures.push({ case: c.name, check: k.name, prop, expected: exp, actual: Number(got.toFixed(1)), tol, source: k.source });
      }
    }
    results.push({ case: c.name, check: k.name, measured: Object.fromEntries(Object.entries(m).map(([p, v]) => [p, Number(v.toFixed(1))])) });
  }
}
await browser.close();

const report = { spec: specPath, checks, failures: failures.length, pass: failures.length === 0, detail: failures, measured: results };
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${report.pass ? 'PASS' : 'FAIL'} — ${checks} geometry checks, ${failures.length} failures -> ${outPath}`);
if (failures.length) console.log(failures.slice(0, 15).map((f) => `  ${f.case}/${f.check} ${f.prop || f.error}: expected ${f.expected} got ${f.actual} (tol ${f.tol})`).join('\n'));
process.exit(failures.length ? 1 : 0);
