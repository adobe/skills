/**
 * qa/checks/routing.mjs — category A: inventory & routing (delivery layer).
 *
 * - every inventory path serves 200 on the live base (full HTML and .plain.html)
 * - redirects sheet (/redirects.json) rules actually redirect and land on 200
 * - trailing-slash variants of a sample resolve (redirect or 200)
 * - an unknown path really 404s (with a non-empty error page)
 * - sitemap parity: sitemap-only paths (published but untracked) and
 *   inventory-only paths (tracked but unlisted) are both surfaced
 */
import { fetchUrl, pMap, finding, pageUrl, plainUrl } from '../lib.mjs';

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const pages = inventory.pages;

  await pMap(pages, async (p) => {
    const res = await ctx.fetchPage(pageUrl(base, p.path));
    if (res.status !== 200) {
      findings.push(finding('routing', 'page-not-200', 'error', p.path,
        `GET ${p.path} returned ${res.status || `network error: ${res.error}`}`, { url: pageUrl(base, p.path) }));
      return;
    }
    const plain = await ctx.fetchPage(plainUrl(base, p.path));
    if (plain.status !== 200) {
      findings.push(finding('routing', 'plain-not-200', 'error', p.path,
        `.plain.html returned ${plain.status || `network error: ${plain.error}`}`, { url: plainUrl(base, p.path) }));
    }
  }, 8);

  // fragments must also be delivered (nav/footer power the chrome)
  await pMap(inventory.fragments, async (f) => {
    const res = await ctx.fetchPage(plainUrl(base, f));
    if (res.status !== 200) {
      findings.push(finding('routing', 'fragment-not-200', 'error', f,
        `chrome fragment ${f}.plain.html returned ${res.status}`));
    }
  }, 2);

  // redirects sheet: verify each rule redirects and the destination is 200
  const sheet = await fetchUrl(`${base}/redirects.json`);
  if (sheet.status === 200) {
    let rules = [];
    try { rules = (JSON.parse(sheet.body).data || []); } catch { /* not a sheet */ }
    await pMap(rules, async (r) => {
      const from = r.Source || r.source || r.from;
      const to = r.Destination || r.destination || r.to;
      if (!from || !to) return;
      const res = await fetchUrl(pageUrl(base, from), { redirect: 'manual' });
      if (![301, 302, 307, 308].includes(res.status)) {
        findings.push(finding('routing', 'redirect-not-firing', 'error', from,
          `redirect rule ${from} -> ${to} returned ${res.status} instead of a redirect`));
        return;
      }
      const dest = await fetchUrl(res.location.startsWith('http') ? res.location : pageUrl(base, res.location));
      if (dest.status !== 200) {
        findings.push(finding('routing', 'redirect-dest-broken', 'error', from,
          `redirect ${from} lands on ${res.location} which returns ${dest.status}`));
      }
    }, 4);
  } else {
    findings.push(finding('routing', 'no-redirects-sheet', 'info', '',
      `no /redirects.json sheet (${sheet.status}) — skipping redirect verification`));
  }

  // trailing-slash sample: 3 non-root paths should resolve (200 or redirect->200)
  for (const p of pages.filter((x) => x.path !== '/').slice(0, 3)) {
    const res = await fetchUrl(`${pageUrl(base, p.path)}/`);
    if (res.status !== 200) {
      findings.push(finding('routing', 'trailing-slash-broken', 'warn', p.path,
        `${p.path}/ (trailing slash) returned ${res.status}`));
    }
  }

  // a garbage path must 404 with a real error page
  const bogus = await fetchUrl(pageUrl(base, '/stardust-qa-definitely-not-a-page'));
  if (bogus.status !== 404) {
    findings.push(finding('routing', '404-not-404', 'error', '',
      `unknown path returned ${bogus.status} instead of 404`));
  } else if ((bogus.body || '').length < 200) {
    findings.push(finding('routing', '404-page-empty', 'warn', '',
      '404 responses serve a near-empty body (no styled error page)'));
  }

  // sitemap parity (inventory.sitemapPaths is null when sitemap.xml is missing)
  if (inventory.sitemapPaths === null) {
    findings.push(finding('routing', 'sitemap-missing', 'error', '', 'sitemap.xml is not served'));
  } else {
    const inv = new Set(pages.map((p) => p.path));
    for (const s of inventory.sitemapPaths) {
      if (inventory.fragments.includes(s)) {
        findings.push(finding('routing', 'sitemap-lists-fragment', 'error', s,
          `sitemap.xml lists chrome fragment ${s} as a page`));
      } else if (!inv.has(s)) {
        findings.push(finding('routing', 'sitemap-only-page', 'warn', s,
          `sitemap.xml lists ${s} but it is not in the tracked inventory`));
      }
    }
    const sm = new Set(inventory.sitemapPaths);
    for (const p of pages) {
      if (!sm.has(p.path)) {
        findings.push(finding('routing', 'missing-from-sitemap', 'warn', p.path,
          `${p.path} is tracked (${p.sources.join(', ')}) but absent from sitemap.xml`));
      }
    }
  }

  return findings;
}
