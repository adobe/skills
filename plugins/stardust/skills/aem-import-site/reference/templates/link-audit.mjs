#!/usr/bin/env node
/*
 * link-audit.mjs — STARDUST aem-import-site reference template
 *
 * Crawl a sample page per (template, pageType) bucket, enumerate every
 * internal <a href>, cross-check against /query-index.json, and output a
 * weighted-by-inbound list of missing destinations.
 *
 * Setup: drop this file at <project-root>/scripts/utils/link-audit.mjs.
 * Set EDS_PREVIEW_ORIGIN in the project's .env file:
 *
 *   EDS_PREVIEW_ORIGIN=https://main--<repo>--<org>.aem.page
 *
 * Then `cd <project-root> && node scripts/utils/link-audit.mjs`.
 * Output: console summary + /tmp/link-audit.csv full sorted list.
 *
 * See: aem-import-site/reference/link-audit-workflow.md
 */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const ORIGIN = env.match(/^EDS_PREVIEW_ORIGIN=(.+)$/m)?.[1]?.trim();
if (!ORIGIN) {
  console.error('Set EDS_PREVIEW_ORIGIN in .env (e.g. https://main--<repo>--<org>.aem.page)');
  process.exit(1);
}
const ORIGIN_HOST = new URL(ORIGIN).host;

const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();
const existing = new Set(idx.data.map((r) => r.path.replace(/\/$/, '')));
existing.add(''); existing.add('/');
console.log(`Index has ${idx.total} pages`);

// Bucket pages by (template, pageType); sample one per bucket
const buckets = new Map();
for (const r of idx.data) {
  const key = `${r.template || '?'}|${r.pageType || 'detail'}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(r.path);
}
const samples = ['/', ...[...buckets.values()].map((arr) => arr[0])];
console.log(`Sampling ${samples.length} pages across ${buckets.size} (template, pageType) buckets`);

// Visit, extract internal hrefs
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const linkSources = new Map();
const allHrefs = new Map();

for (const path of samples) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim().slice(0, 40),
      region: a.closest('header') ? 'header'
        : a.closest('footer') ? 'footer'
        : a.closest('.breadcrumb') ? 'breadcrumb'
        : a.closest('.cards.related.dynamic, .cards.listing.dynamic, .cards.hub.dynamic') ? 'dynamic'
        : 'main',
    })));
    hrefs.forEach(({ href, text, region }) => {
      if (!href) return;
      if (/^(https?:)?\/\//.test(href) && !href.includes(ORIGIN_HOST)) return;
      if (/^(mailto:|tel:|javascript:|#)/.test(href)) return;
      let norm = href.replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0].replace(/\/$/, '');
      if (!norm.startsWith('/')) norm = '/' + norm;
      if (norm === '' || norm === '/index.html') norm = '/';
      if (!linkSources.has(norm)) linkSources.set(norm, new Set());
      linkSources.get(norm).add(`${region}:${path}`);
      if (!allHrefs.has(norm)) allHrefs.set(norm, { text, region });
    });
  } catch (e) { console.log(`  ✗ ${path}: ${e.message}`); }
  await page.close();
}
await browser.close();

const TOTAL_PAGES = idx.total;
const rows = [];
for (const [href, sources] of linkSources) {
  const fromChrome = [...sources].some((s) => s.startsWith('header:') || s.startsWith('footer:'));
  const fromDynamic = [...sources].some((s) => s.startsWith('dynamic:'));
  const sampledRegions = [...new Set([...sources].map((s) => s.split(':')[0]))];
  let inbound;
  if (fromChrome) inbound = TOTAL_PAGES;
  else if (fromDynamic) inbound = 1;
  else {
    const sourcePaths = [...sources].map((s) => s.split(':')[1]);
    inbound = sourcePaths.reduce((sum, p) => {
      const bucket = [...buckets.values()].find((b) => b.includes(p));
      return sum + (bucket ? bucket.length : 1);
    }, 0);
  }
  const normalized = href.replace(/\/$/, '');
  let exists = existing.has(normalized) || existing.has(href);
  if (!exists) exists = existing.has(normalized + '/') || existing.has(href + '/');
  rows.push({ href, inbound, exists, region: sampledRegions.join('+'), text: allHrefs.get(href)?.text });
}

rows.sort((a, b) => (a.exists !== b.exists) ? (a.exists ? 1 : -1) : b.inbound - a.inbound);

const missing = rows.filter((r) => !r.exists);
console.log(`\nUnique link destinations: ${rows.length}`);
console.log(`  Missing: ${missing.length}`);
console.log(`  Live:    ${rows.length - missing.length}`);

console.log('\n=== TOP 30 MISSING (sorted by estimated inbound link count) ===');
console.log('inbound  region            text                          → href');
missing.slice(0, 30).forEach((r) => {
  console.log(`${String(r.inbound).padStart(6)}   ${r.region.padEnd(17)} ${(r.text || '').padEnd(28)} → ${r.href}`);
});

const csv = ['href,exists,inbound,region,text', ...rows.map((r) => `"${r.href}",${r.exists},${r.inbound},"${r.region}","${(r.text || '').replace(/"/g, '""')}"`)].join('\n');
writeFileSync('/tmp/link-audit.csv', csv);
console.log(`\nFull CSV: /tmp/link-audit.csv`);
