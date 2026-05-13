#!/usr/bin/env node
// mobile-nav-audit.mjs — runtime check for the three new Mobile-adapt
// audit conditions documented in skills/prototype/SKILL.md
// § Mobile-adapt audit. Renders an HTML file at 360px and reports:
//
//   (a) audit/responsive: horizontal-overflow-at-360px
//   (b) audit/responsive: nav-readability-floor   (nav descendant font < 11px)
//   (c) audit/responsive: nav-readability-floor   (nav gap/column-gap < 10px)
//
// Exit 0 when no findings; exit 1 when any finding fires.
//
// Usage:
//   node skills/prototype/fixtures/mobile-nav-audit.mjs <file.html>
//
// Requires Playwright:
//   npm i -D playwright
//   npx playwright install chromium

import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const FONT_FLOOR_PX   = 11;
const GAP_FLOOR_PX    = 10;
const VIEWPORT_WIDTH  = 360;
const VIEWPORT_HEIGHT = 800;

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node mobile-nav-audit.mjs <file.html>');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('mobile-nav-audit: Playwright is required.');
  console.error('  npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const abs = isAbsolute(fileArg) ? fileArg : resolve(process.cwd(), fileArg);
const url = pathToFileURL(abs).toString();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.documentElement.offsetHeight);

  const findings = await page.evaluate(({ FONT_FLOOR_PX, GAP_FLOOR_PX, VIEWPORT_WIDTH }) => {
    const out = [];

    // (a) Horizontal overflow on documentElement / body
    const docOver  = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const bodyOver = document.body.scrollWidth - document.body.clientWidth;
    if (docOver > 0 || bodyOver > 0) {
      let culprit = null;
      for (const el of document.querySelectorAll('header, footer, nav, main')) {
        const r = el.getBoundingClientRect();
        if (r.right > VIEWPORT_WIDTH + 0.5) { culprit = el; break; }
      }
      out.push({
        code: 'audit/responsive: horizontal-overflow-at-360px',
        detail: docOver > 0
          ? `documentElement.scrollWidth - clientWidth = ${docOver}px`
          : `body.scrollWidth - clientWidth = ${bodyOver}px`,
        landmark: culprit
          ? culprit.tagName.toLowerCase() +
            (culprit.dataset.section ? `[data-section="${culprit.dataset.section}"]` : '')
          : null,
      });
    }

    // Honor display:none / visibility:hidden up the ancestor chain
    const isHidden = (el) => {
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        cur = cur.parentElement;
      }
      return false;
    };

    // (b) and (c) — only navs that live inside a <header>
    const navsInHeader = document.querySelectorAll('header nav');
    for (const nav of navsInHeader) {
      if (isHidden(nav)) continue;

      // (c) gap on flex/grid <nav>
      const nv = getComputedStyle(nav);
      const isAxisContainer =
        nv.display === 'flex' || nv.display === 'inline-flex' ||
        nv.display === 'grid' || nv.display === 'inline-grid';
      if (isAxisContainer) {
        const col = parseFloat(nv.columnGap) || 0;
        const row = parseFloat(nv.rowGap) || 0;
        // For a horizontal nav, column-gap is the load-bearing one;
        // for a grid that wraps, rowGap can also bite. Take the smaller
        // positive value when both are set.
        const candidates = [col, row].filter((v) => v > 0);
        const effective = candidates.length ? Math.min(...candidates) : 0;
        if (effective > 0 && effective < GAP_FLOOR_PX) {
          out.push({
            code: 'audit/responsive: nav-readability-floor',
            detail: `<nav> ${col > 0 && row > 0 ? 'gap' : (col > 0 ? 'column-gap' : 'row-gap')} is ${effective}px (< ${GAP_FLOOR_PX}px floor)`,
            selector: 'header nav',
          });
        }
      }

      // (b) font-size on any descendant of <nav>
      for (const el of nav.querySelectorAll('*')) {
        if (isHidden(el)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < FONT_FLOOR_PX) {
          out.push({
            code: 'audit/responsive: nav-readability-floor',
            detail: `<${el.tagName.toLowerCase()}> inside <nav> has font-size ${fs}px (< ${FONT_FLOOR_PX}px floor)`,
            selector: `header nav ${el.tagName.toLowerCase()}`,
          });
          break;
        }
      }
    }

    return out;
  }, { FONT_FLOOR_PX, GAP_FLOOR_PX, VIEWPORT_WIDTH });

  if (findings.length === 0) {
    console.log(`✓ ${fileArg} — audit clean at ${VIEWPORT_WIDTH}px`);
    process.exit(0);
  }

  console.error(`✗ ${fileArg} — ${findings.length} finding(s) at ${VIEWPORT_WIDTH}px:`);
  for (const f of findings) {
    console.error(`  - ${f.code}`);
    console.error(`      ${f.detail}`);
    if (f.landmark) console.error(`      landmark: ${f.landmark}`);
    if (f.selector) console.error(`      selector: ${f.selector}`);
  }
  console.error('\nSuggested fix: apply the stock hamburger pattern');
  console.error('  skills/prototype/reference/mobile-nav-collapse.md');
  process.exit(1);
} finally {
  await browser.close();
}
