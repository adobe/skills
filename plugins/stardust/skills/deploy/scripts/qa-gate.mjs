#!/usr/bin/env node
/**
 * skills/deploy/scripts/qa-gate.mjs — the stock Local-QA assertion gate (#101).
 *
 * Three e2e runs showed every conversion hand-rolling an ad-hoc probe.mjs
 * (~3–5 min each) asserting the same invariants the section schema already
 * encodes. This is that probe, bundled: point it at the HARNESS page (through
 * the dev server) and the page's eds-schema JSON and it asserts the whole
 * decoration contract in one run.
 *
 *   node skills/deploy/scripts/qa-gate.mjs http://localhost:3000/qa/page.html \
 *        --schema stardust/eds-schema/<page>.json [--maxw 1340]
 *
 * Asserts (FAIL → exit 1):
 *   - the runtime booted: body.appear present (a blank render = harness bug, #40)
 *   - exactly one <h1>, no heading nested inside it (#35/#55)
 *   - >0 sections; every [data-block-name] reaches data-block-status="loaded"
 *   - zero pageerror events; zero broken images (loaded but naturalWidth 0)
 *   - every block instance renders non-empty (height > 5px, has child elements)
 *   - schema unit counts: each schema section with repeats count N≥2 renders
 *     ≥N units in its matching page section (grid/flex children or unit-level
 *     headings — the 1-of-N / 0-of-N segmentation collapse, #48/#52/#62)
 *   - wide-viewport (#13, second pass at 1600px): block content boxes stay
 *     ≤ --maxw unless the block is genuinely full-bleed in the schema order —
 *     over-wide boxes print as WARN (cross-check against the prototype).
 *
 * Deliberately NOT here: CLS (deployed-URL only — the harness false-passes,
 * #100/#101), content/visual-diff (Step 10, deployed-URL only), and
 * interactive drives (#28 — hand-write those per block).
 */
/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const schemaPath = opt('schema', null);
const maxw = Number(opt('maxw', 1340));
if (!url) { console.error('usage: qa-gate.mjs <harnessURL> [--schema <eds-schema.json>] [--maxw 1340]'); process.exit(2); }
const schema = schemaPath ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null;

const fails = [];
const warns = [];
const ok = [];
const check = (cond, label, detail = '') => (cond ? ok : fails).push(`${label}${detail ? ` — ${detail}` : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// let lazy sections load
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 60); }); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const out = {};
  out.appear = document.body.classList.contains('appear');
  out.h1 = document.querySelectorAll('h1').length;
  out.h1Nested = document.querySelectorAll('h1 h1, h1 h2, h1 h3, h1 h4, h1 h5, h1 h6').length;
  out.sections = document.querySelectorAll('main .section').length;
  out.blocks = [...document.querySelectorAll('[data-block-name]')].map((b) => {
    const rect = b.getBoundingClientRect();
    const containers = [b, ...b.querySelectorAll('*')].filter((e) => ['grid', 'flex'].includes(getComputedStyle(e).display));
    const cand = containers[0] || null;
    // the repeating container is the DENSEST grid/flex, not the first (an
    // outer 2-col layout wrapping a 5-item rail would otherwise read as 2)
    const unitCount = containers.reduce((m, e) => Math.max(m, e.children.length), 0);
    // tag-level unit proxies (the schema's unitSelector tag maps to these)
    const tagCounts = {
      article: b.querySelectorAll('article').length,
      li: b.querySelectorAll('li').length,
      figure: b.querySelectorAll('figure').length,
    };
    const headingUnits = b.querySelectorAll('h3, h4, h5').length;
    return {
      name: b.dataset.blockName,
      status: b.dataset.blockStatus,
      height: Math.round(rect.height || b.scrollHeight),
      kids: b.childElementCount,
      layout: cand ? getComputedStyle(cand).display : 'block-only',
      unitCount,
      headingUnits,
      tagCounts,
    };
  });
  out.brokenImgs = [...document.querySelectorAll('img')].filter((i) => i.complete && !i.naturalWidth).length;
  // page sections that hold blocks, in order (for schema matching)
  out.blockSections = [...document.querySelectorAll('main .section')]
    .filter((s) => s.querySelector('[data-block-name]'))
    .map((s) => {
      const b = s.querySelector('[data-block-name]');
      return { block: b.dataset.blockName };
    });
  return out;
});

check(r.appear, 'body.appear set (runtime booted)');
check(r.h1 === 1, 'exactly one <h1>', `found ${r.h1}`);
check(r.h1Nested === 0, 'no heading nested inside <h1>', `found ${r.h1Nested}`);
check(r.sections > 0, 'main .section count > 0', `${r.sections} sections`);
check(pageErrors.length === 0, 'zero pageerror events', pageErrors.slice(0, 3).join(' | '));
check(r.brokenImgs === 0, 'zero broken images', `${r.brokenImgs} broken`);
for (const b of r.blocks) {
  check(b.status === 'loaded', `block ${b.name} loaded`, `status=${b.status}`);
  check(b.height > 5 && b.kids > 0, `block ${b.name} renders non-empty`, `h=${b.height} kids=${b.kids}`);
}

// schema unit counts — match Nth block-bearing page section to Nth schema
// section that has repeats is fragile; match by ORDER over all schema sections.
if (schema && Array.isArray(schema.sections)) {
  const withRepeats = schema.sections
    .map((s, i) => ({ ...s, i }))
    .filter((s) => (s.repeats || []).some((rep) => rep.count >= 2));
  // page block instances in DOM order:
  const instances = r.blocks.filter((b) => !['header', 'footer'].includes(b.name));
  // schema sections (excluding chrome) in order:
  const protoSections = schema.sections.filter((s) => !['header', 'footer'].includes(s.section));
  withRepeats.forEach((s) => {
    const pos = protoSections.indexOf(protoSections.find((x) => x.section === s.section));
    const inst = instances[pos];
    if (!inst) { warns.push(`schema section "${s.section}" (repeats) has no matching page block by order — verify manually`); return; }
    const want = Math.max(...s.repeats.map((rep) => rep.count));
    // schema-informed proxy: the unitSelector's TAG (proto classes don't survive
    // conversion, the semantic tag usually does), else densest grid / headings
    const tags = s.repeats.map((rep) => (rep.unitSelector || '').split('.')[0].toLowerCase()).filter(Boolean);
    const tagGot = Math.max(0, ...tags.map((t) => (inst.tagCounts || {})[t] || 0));
    const got = Math.max(inst.unitCount, inst.headingUnits, tagGot);
    check(got >= want, `units: "${s.section}" → block ${inst.name} renders ≥${want}`, `rendered ${got} (grid kids ${inst.unitCount} / unit headings ${inst.headingUnits} / tag ${tagGot})`);
  });
}

// wide-viewport pass (#13)
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(600);
const wide = await page.evaluate(() => [...document.querySelectorAll('[data-block-name]')].map((b) => {
  const inner = b.querySelector('.wrap, [class*="inner"], [class*="container"]') || b.firstElementChild;
  return { name: b.dataset.blockName, w: inner ? Math.round(inner.getBoundingClientRect().width) : 0 };
}));
wide.filter((b) => b.w > maxw + 40 && !['header', 'footer'].includes(b.name))
  .forEach((b) => warns.push(`wide-1600: block ${b.name} content spans ${b.w}px (> ${maxw}) — full-bleed is correct ONLY if the prototype section has no inner max-width wrapper (#13)`));

await browser.close();

ok.forEach((l) => console.log(`  ✓ ${l}`));
warns.forEach((l) => console.log(`  ⚠ ${l}`));
fails.forEach((l) => console.log(`  ✗ ${l}`));
console.log(`QA GATE: ${fails.length === 0 ? 'PASS' : 'FAIL'} — ${ok.length} ok, ${warns.length} warn, ${fails.length} fail`);
process.exit(fails.length ? 1 : 0);
