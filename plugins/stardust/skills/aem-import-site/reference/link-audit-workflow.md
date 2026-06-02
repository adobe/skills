# Link audit workflow

After a multi-template migration, the most useful next-step planning
artifact isn't "what's left to migrate" — it's **"which not-yet-
migrated pages would unlock the most cross-page navigation"**.

That question is answered by the link audit: crawl a sample of
already-migrated pages, enumerate every internal `<a href>`,
cross-check against `/query-index.json`, and sort missing destinations
by weighted inbound-link count.

This is a standard Phase 7 deliverable (post-batch, post-verify) for
every aem-import-site project.

## Why this beats arbitrary template ordering

Without the audit, post-batch migration planning tends to default to
"do the biggest sitemap first" or "do whatever the next template in
the alphabet is". Neither correlates with user-visible impact.

The audit reveals that 5-10 missing pages typically account for 80%
of broken cross-page links — because they're linked from every
page's chrome (each chrome destination has ~N inbound, where N =
total page count). Building those 5-10 first unlocks navigation
across the entire site.

The audit reorders the remaining migration backlog by **chrome-impact
× cardinality × destination-importance**.

## Audit recipe

```js
// scripts/utils/link-audit.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const ORIGIN = '<your EDS preview URL>';

// 1. Load query-index (the truth about what exists)
const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();
const existing = new Set(idx.data.map(r => r.path.replace(/\/$/, '')));
existing.add(''); existing.add('/');

// 2. Bucket pages by (template, pageType) — sample one per bucket
const buckets = new Map();
for (const r of idx.data) {
  const key = `${r.template || '?'}|${r.pageType || 'detail'}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(r.path);
}
const samples = ['/', ...[...buckets.values()].map(arr => arr[0])];

// 3. Visit each sample; extract every internal href; record sources
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const linkSources = new Map();    // href → Set(<region>:<source-page>)
const allHrefs = new Map();       // href → first-seen text label

for (const path of samples) {
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().slice(0, 40),
    region: a.closest('header') ? 'header'
          : a.closest('footer') ? 'footer'
          : a.closest('.breadcrumb') ? 'breadcrumb'
          : a.closest('.cards.related.dynamic, .cards.listing.dynamic, .cards.hub.dynamic') ? 'dynamic'
          : 'main',
  })));
  hrefs.forEach(({ href, text, region }) => {
    if (!href || /^(https?:)?\/\//.test(href) || /^(mailto:|tel:|javascript:|#)/.test(href)) return;
    let norm = href.split('?')[0].split('#')[0].replace(/\/$/, '');
    if (!norm.startsWith('/')) norm = '/' + norm;
    if (!linkSources.has(norm)) linkSources.set(norm, new Set());
    linkSources.get(norm).add(`${region}:${path}`);
    if (!allHrefs.has(norm)) allHrefs.set(norm, { text, region });
  });
  await page.close();
}
await browser.close();

// 4. Classify + weight by source region (chrome links count as N × inbound)
const TOTAL = idx.total;
const rows = [...linkSources].map(([href, sources]) => {
  const fromChrome = [...sources].some(s => s.startsWith('header:') || s.startsWith('footer:'));
  const fromDynamic = [...sources].some(s => s.startsWith('dynamic:'));
  let inbound;
  if (fromChrome) inbound = TOTAL;                              // chrome → on every page
  else if (fromDynamic) inbound = 1;                            // dynamic → low per-page weight
  else {                                                         // main-content → scale by bucket size
    inbound = [...sources].reduce((sum, s) => {
      const srcPath = s.split(':')[1];
      const bucket = [...buckets.values()].find(b => b.includes(srcPath));
      return sum + (bucket ? bucket.length : 1);
    }, 0);
  }
  const exists = existing.has(href.replace(/\/$/, '')) || existing.has(href + '/');
  return { href, inbound, exists, region: [...new Set([...sources].map(s => s.split(':')[0]))].join('+'), text: allHrefs.get(href)?.text };
});

// 5. Sort missing-first by inbound, write CSV
rows.sort((a, b) => (a.exists !== b.exists) ? (a.exists ? 1 : -1) : b.inbound - a.inbound);
const csv = ['href,exists,inbound,region,text',
  ...rows.map(r => `"${r.href}",${r.exists},${r.inbound},"${r.region}","${(r.text || '').replace(/"/g, '""')}"`)
].join('\n');
writeFileSync('/tmp/link-audit.csv', csv);

const missing = rows.filter(r => !r.exists);
console.log(`Unique destinations: ${rows.length}  |  Missing: ${missing.length}  |  Live: ${rows.length - missing.length}`);
console.log('\nTop 30 missing (sorted by weighted inbound):');
missing.slice(0, 30).forEach(r => {
  console.log(`  ${String(r.inbound).padStart(6)}  ${r.region.padEnd(17)} ${r.text.padEnd(28)} → ${r.href}`);
});
```

## Interpreting the output

The audit categorizes missing destinations into bands:

- **Chrome-linked (inbound = total page count)**: every page references
  this. Priority 1. Usually a hub destination (`/section/`,
  `/products/`, etc.) or a utility-strip portal (`/login/`,
  `/account/`).

- **Sampled-main-linked × bucket size (inbound = hundreds-thousands)**:
  linked from a sampled detail/listing/etc. page; the weight reflects
  how many pages of that template family would have the same link.
  Usually a CTA destination (`/contact/`, `/quotes/`) or a
  category-parent (linked from breadcrumbs across the family).

- **Dynamic-block-linked (inbound = 1)**: shown in a `.cards.related`
  or `.cards.listing` somewhere. Low priority unless many pages
  point to the same destination (e.g., a related-attachment that
  appears across hundreds of detail pages). The audit can
  surface this if you also scan a dynamic-block render output.

- **1-inbound (one-off)**: linked from a single page's main content.
  Usually deferred to long-tail.

## When to re-run

After every batch of new pages, re-run the audit. The bucket structure
and weighting shift as new templates ship; missing-destinations may
disappear (you authored them) and new ones may appear (a new template
introduced a new link pattern). The audit is cheap (< 5 minutes for
~10-bucket projects).

## Limitations

- **Limited to sampled main-content links per template.** A
  one-off page with unusual main-content links won't be sampled
  unless its template is a separate bucket.
- **Doesn't catch links inside lazy-loaded content.** If a section
  loads its hrefs after the Playwright wait, they're missed.
  Mitigate by adding a longer settle (5+ seconds) and/or scrolling.
- **Doesn't audit dynamic-block-generated links comprehensively.**
  The dynamic blocks generate links from query-index at render time;
  scanning them across all categories would require visiting every
  hub/listing. For most projects the rough categorization is enough.
