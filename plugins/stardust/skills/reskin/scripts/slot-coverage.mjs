#!/usr/bin/env node
/**
 * skills/reskin/scripts/slot-coverage.mjs — content-gate half two.
 *
 * dom-equality.mjs proves the CONCATENATED text is byte-equal; this script
 * proves the model's STRUCTURE survived: every content-model slot is
 * present in the rendered page, addressed slot by slot. The two are
 * complementary — a renderer that dropped one slot and duplicated another
 * to the same total length would fool a length-based check; slot coverage
 * catches it (and localizes any failure to a named slot).
 *
 * Checks against stardust/reskin/content-model/<slug>/content-model.json:
 *   (1) SLOT TEXT   — each slot's normalized visibleText is substring-
 *                     present in the rendered scope's normalized text.
 *   (2) CTAs        — each captured CTA is present as a (text, ABSOLUTE
 *                     href) pair: an <a> whose href equals absHref and
 *                     whose text contains the captured label.
 *   (3) IMAGES      — each captured image src is present, URL-normalized
 *                     to host+path.
 *   (3b) PAINT      — each present content image actually RENDERS
 *                     (naturalWidth > 0 after a lazy-load scroll pass).
 *                     The src check compares URL strings; an origin-locked
 *                     source CDN can 403 every hotlinked image while the
 *                     string gate passes (F-R4, kew: 19 images never
 *                     painted on a PASSing gate). Zero-painted → FAIL
 *                     naming the img; downgrade with --paint warn only
 *                     with a recorded reason.
 *   (4) METADATA    — title, description, canonical, every OG tag, every
 *                     Twitter tag carried VERBATIM; JSON-LD block count
 *                     matches. Fidelity over repair: broken source values
 *                     must be carried too (flag them, don't fix them).
 *
 * Usage:
 *   node slot-coverage.mjs --model <content-model.json> --rendered <url|file>
 *       [--rendered-scope <sel>]   default "main"
 *       [--report <path>]          markdown report
 *       [--paint fail|warn]        paint-assertion severity (default fail)
 *
 * Exit: 0 all checks pass, 1 any fail, 2 setup error.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const opts = { 'rendered-scope': 'main', paint: 'fail' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else { console.error(`[slot-coverage] unknown arg: ${a}`); process.exit(2); }
  }
  if (!['fail', 'warn'].includes(opts.paint)) { console.error(`[slot-coverage] --paint must be fail|warn, got: ${opts.paint}`); process.exit(2); }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.model || !args.rendered) {
  console.log('usage: node slot-coverage.mjs --model <content-model.json> --rendered <url|file>');
  console.log('         [--rendered-scope main] [--report <path>] [--paint fail|warn]');
  console.log('Proves every model slot (text, CTAs, images) + all metadata present in the render,');
  console.log('and that every present content image actually PAINTS (naturalWidth > 0) — a URL-string');
  console.log('match can pass while an origin-locked source CDN 403s every image (gates.md § Image');
  console.log('paint). --paint warn downgrades paint failures to warnings (record why).');
  console.log('Exit: 0 pass, 1 fail, 2 setup error.');
  process.exit(args.help ? 0 : 2);
}

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[slot-coverage] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run: npm i -D playwright --no-save --legacy-peer-deps  (extract SKILL.md § Setup)');
  process.exit(2);
}

const toUrl = (p) => (/^(https?|file):/.test(p) ? p : pathToFileURL(resolve(p)).href);
const model = JSON.parse(readFileSync(resolve(args.model), 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(toUrl(args.rendered), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);

// Paint assertion prep (F-R4): scroll so lazy images intersect and load,
// then wait (bounded) for every in-flight image to settle. An image that
// 403s fires `error` and stays naturalWidth=0 — exactly what we assert on.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
});
await page.evaluate(() => Promise.race([
  Promise.all(Array.from(document.images).map((img) => (img.complete ? null
    : new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); })))),
  new Promise((r) => setTimeout(r, 10000)),
]));
await page.waitForTimeout(300);

const results = []; // { gate, check, pass, detail }
const R = (gate, check, pass, detail = '') => results.push({ gate, check, pass, detail });

// ---- (1)(2)(3) slot coverage ------------------------------------------------
const rendered = await page.evaluate((scopeSel) => {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const scope = document.querySelector(scopeSel);
  if (!scope) return { error: `rendered scope not found: ${scopeSel}` };
  return {
    text: norm(scope.innerText),
    hrefs: Array.from(scope.querySelectorAll('a[href]')).map((a) => ({ href: a.href, text: norm(a.innerText) })),
    imgs: Array.from(scope.querySelectorAll('img')).map((i) => ({
      src: i.currentSrc || i.src,
      painted: i.complete && i.naturalWidth > 0,
    })),
  };
}, args['rendered-scope']);
if (rendered.error) { console.error(`[slot-coverage] ${rendered.error}`); await browser.close(); process.exit(2); }

const normPath = (u) => { try { const x = new URL(u, 'http://x'); return x.hostname + x.pathname; } catch { return u; } };
for (const s of model.sections) {
  R('slot-coverage', `${s.slot} text present`, rendered.text.includes(s.visibleText), s.visibleText.slice(0, 50));
  for (const c of s.ctas) {
    const hit = rendered.hrefs.find((h) => h.href === c.absHref && h.text.includes(c.text));
    R('slot-coverage', `${s.slot} CTA "${c.text.slice(0, 30)}" -> ${c.absHref.slice(0, 60)}`, !!hit);
  }
  for (const im of s.images) {
    const matches = rendered.imgs.filter((r2) => normPath(r2.src) === normPath(im.currentSrc));
    R('slot-coverage', `${s.slot} image …${normPath(im.currentSrc).slice(-50)}`, matches.length > 0);
    if (matches.length > 0) {
      // (3b) PAINT (F-R4): src-string presence is not rendering. A rendered
      // content image that never painted (naturalWidth=0 — e.g. the source
      // CDN 403s hotlinked requests) is a broken page the string gate
      // cannot see.
      const painted = matches.some((r2) => r2.painted);
      const hint = painted ? '' : 'naturalWidth=0 — never painted; origin-locked source CDN? localize assets (Phase 6, gates.md § Image paint)';
      if (!painted && args.paint === 'warn') {
        console.log(`  WARN paint: ${s.slot} image …${normPath(im.currentSrc).slice(-50)} — ${hint}`);
        R('paint', `${s.slot} image …${normPath(im.currentSrc).slice(-50)} painted (WARN-downgraded)`, true, hint);
      } else {
        R('paint', `${s.slot} image …${normPath(im.currentSrc).slice(-50)} painted`, painted, hint);
      }
    }
  }
}

// ---- (4) metadata carried verbatim -------------------------------------------
const meta = await page.evaluate(() => {
  const og = {}; const tw = {}; let description = '';
  document.querySelectorAll('meta').forEach((m) => {
    const p = m.getAttribute('property') || ''; const n = m.getAttribute('name') || '';
    const c = m.getAttribute('content'); if (c === null) return;
    if (p.startsWith('og:')) og[p] = c;
    if (n.startsWith('twitter:') || p.startsWith('twitter:')) tw[n || p] = c;
    if (n === 'description') description = c;
  });
  return {
    title: document.title, description,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    og, tw, jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
  };
});
const md0 = model.metadata;
R('metadata', 'title', meta.title === md0.title, meta.title);
R('metadata', 'description', meta.description === md0.description);
R('metadata', 'canonical', meta.canonical === md0.canonical, `${meta.canonical}`);
for (const [k, v] of Object.entries(md0.ogTags)) R('metadata', `og ${k}`, meta.og[k] === v);
for (const [k, v] of Object.entries(md0.twitterTags)) R('metadata', `tw ${k}`, meta.tw[k] === v);
R('metadata', 'jsonLd block count', meta.jsonLdCount === md0.jsonLd.length, `${meta.jsonLdCount}/${md0.jsonLd.length}`);

await browser.close();

// ---- report -------------------------------------------------------------------
const byGate = {};
for (const r of results) (byGate[r.gate] ??= []).push(r);
let md = `# Slot-coverage + metadata report\n\n- Model: ${args.model}\n- Rendered: ${args.rendered} (scope: \`${args['rendered-scope']}\`)\n- Generated: ${new Date().toISOString()}\n\n`;
let allPass = true;
for (const [gate, rs] of Object.entries(byGate)) {
  const fails = rs.filter((r) => !r.pass);
  if (fails.length) allPass = false;
  md += `## ${gate} — ${rs.length - fails.length}/${rs.length} pass\n\n`;
  for (const r of rs) md += `- [${r.pass ? 'x' : ' '}] ${r.check}${r.detail ? ` — ${r.detail}` : ''}\n`;
  md += `\n`;
}
md += `**Overall: ${allPass ? 'PASS' : 'FAIL'}**\n`;
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, md);
}
const failLines = results.filter((r) => !r.pass);
console.log(`[slot-coverage] ${allPass ? 'PASS' : 'FAIL'} — ${results.length - failLines.length}/${results.length} checks${args.report ? ` — report: ${args.report}` : ''}`);
for (const f of failLines.slice(0, 15)) console.log(`  FAIL ${f.gate}: ${f.check}${f.detail ? ` — ${f.detail}` : ''}`);
process.exit(allPass ? 0 : 1);
