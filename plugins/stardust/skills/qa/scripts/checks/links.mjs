/**
 * qa/checks/links.mjs — category G: link integrity (delivery layer).
 *
 * From every page's full HTML:
 *   - internal hrefs must resolve: inventory hit, or live 200 (off-inventory
 *     info), redirect (info), else broken (error)
 *   - fragment links (#x, /path#x) must target an existing id — checked in
 *     server HTML first, then re-verified in the RENDERED DOM before being
 *     reported (blocks assign ids client-side; server HTML alone false-flags)
 *   - mailto:/tel: must be well-formed
 *   - external links: SKIPPED by default (on blog-scale fleets the unique
 *     external set dominates sweep time — 35 of 38 min on a 1,035-page run).
 *     Pass --probe-externals to probe each unique URL once (HEAD, GET
 *     fallback); 404/410/DNS-fail -> warn (external sites flap; never an
 *     error). The skip is always reported as an info finding, never silent.
 */
import { fetchUrl, pMap, finding, pageUrl, decodeAttr } from '../lib.mjs';

const ASSET_RE = /\.(css|js|png|jpe?g|gif|webp|avif|svg|ico|woff2?|xml|txt|json|pdf|mp4|webm|mov|zip)$/i;

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const known = new Set(inventory.pages.map((p) => p.path));
  for (const f of inventory.fragments) known.add(f);

  const pageHtml = new Map();
  await pMap(inventory.pages, async (p) => {
    const res = await fetchUrl(pageUrl(base, p.path));
    if (res.status === 200) pageHtml.set(p.path, res.body);
  }, 8);

  const internal = new Map(); // path -> Set(referrers)
  const anchors = [];         // {referrer, targetPath, id}
  const external = new Map(); // url -> Set(referrers)

  for (const [path, html] of pageHtml) {
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
      const href = decodeAttr(m[1].trim());
      if (!href || href === '#') {
        findings.push(finding('links', 'empty-href', 'warn', path, 'anchor with empty/# href (dead link affordance)'));
        continue;
      }
      if (href.startsWith('mailto:')) {
        if (!/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(href.split('?')[0])) {
          findings.push(finding('links', 'malformed-mailto', 'warn', path, `malformed mailto: ${href}`));
        }
      } else if (href.startsWith('tel:')) {
        if (!/^tel:\+?[\d\-().\s]{7,}$/.test(href)) {
          findings.push(finding('links', 'malformed-tel', 'warn', path, `malformed tel: ${href}`));
        }
      } else if (href.startsWith('#')) {
        anchors.push({ referrer: path, targetPath: path, id: href.slice(1) });
      } else if (href.startsWith('/')) {
        const [clean, frag] = href.split('#');
        const target = clean.split('?')[0].replace(/\/$/, '') || '/';
        if (!ASSET_RE.test(target)) {
          if (!internal.has(target)) internal.set(target, new Set());
          internal.get(target).add(path);
          if (frag) anchors.push({ referrer: path, targetPath: target, id: frag });
        }
      } else if (/^https?:\/\//i.test(href)) {
        let sameHost = false;
        try { sameHost = new URL(href).host === new URL(base).host; } catch { /* keep external */ }
        if (sameHost) {
          const target = new URL(href).pathname.replace(/\/$/, '') || '/';
          if (!ASSET_RE.test(target)) {
            if (!internal.has(target)) internal.set(target, new Set());
            internal.get(target).add(path);
          }
        } else {
          if (!external.has(href)) external.set(href, new Set());
          external.get(href).add(path);
        }
      }
    }
  }

  // internal targets
  await pMap([...internal.entries()], async ([target, referrers]) => {
    if (known.has(target)) return;
    const res = await fetchUrl(pageUrl(base, target), { redirect: 'manual' });
    if (res.status === 200) {
      findings.push(finding('links', 'off-inventory-link', 'info', target,
        `internal link target ${target} serves 200 but is not in the tracked inventory`,
        { referrers: [...referrers].slice(0, 5) }));
    } else if ([301, 302, 307, 308].includes(res.status)) {
      findings.push(finding('links', 'link-via-redirect', 'info', target,
        `internal links point at ${target} which redirects to ${res.location} — consider linking the destination`,
        { referrers: [...referrers].slice(0, 5) }));
    } else {
      findings.push(finding('links', 'broken-internal-link', 'error', target,
        `internal link target ${target} returns ${res.status || res.error}`,
        { referrers: [...referrers].slice(0, 10) }));
    }
  }, 8);

  // anchor targets: pass 1 against server HTML; survivors re-verified in the
  // rendered DOM (block JS assigns ids at decoration time — e.g. TOC/term ids)
  const suspects = [];
  for (const a of anchors) {
    const html = pageHtml.get(a.targetPath);
    if (!html) continue; // off-inventory target already reported
    if (!new RegExp(`id=["']${a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html)) {
      suspects.push(a);
    }
  }
  if (suspects.length) {
    let renderedIds = null; // targetPath -> Set(ids), null = browser unavailable
    try {
      const { loadPlaywright } = await import('../lib.mjs');
      const { chromium } = await loadPlaywright();
      const browser = await chromium.launch();
      const page = await browser.newPage();
      renderedIds = new Map();
      for (const target of [...new Set(suspects.map((a) => a.targetPath))]) {
        try {
          await page.goto(pageUrl(base, target), { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3500); // let block decoration assign ids
          renderedIds.set(target, new Set(await page.evaluate(
            () => [...document.querySelectorAll('[id]')].map((e) => e.id),
          )));
        } catch { renderedIds.set(target, null); }
      }
      await browser.close();
    } catch { /* no playwright — report unverified */ }
    for (const a of suspects) {
      const ids = renderedIds?.get(a.targetPath);
      if (ids === undefined || ids === null) {
        findings.push(finding('links', 'anchor-unverified', 'info', a.referrer,
          `anchor #${a.id} on ${a.targetPath} not in server HTML; rendered DOM not checkable here — verify manually`));
      } else if (!ids.has(a.id)) {
        findings.push(finding('links', 'broken-anchor', 'warn', a.referrer,
          `anchor #${a.id} on ${a.targetPath} has no matching id (verified in rendered DOM)`));
      }
    }
  }

  // externals: probe each unique URL once (opt-in — see header)
  if (!ctx.opts.probeExternals) {
    if (external.size) {
      findings.push(finding('links', 'externals-skipped', 'info', '',
        `${external.size} unique external link(s) not probed — pass --probe-externals to check them`));
    }
    return findings;
  }
  await pMap([...external.entries()], async ([url, referrers]) => {
    let res = await fetchUrl(url, { method: 'HEAD', timeoutMs: 8000, retries: 0 });
    if (res.status === 0 || res.status >= 400) {
      // many hosts reject HEAD but serve GET (e.g. maps.google.com HEAD=404, GET=200)
      res = await fetchUrl(url, { timeoutMs: 8000, retries: 0 });
    }
    if (res.status === 404 || res.status === 410 || res.status === 0) {
      findings.push(finding('links', 'broken-external-link', 'warn', [...referrers][0],
        `external link ${url} returns ${res.status || `network error: ${res.error}`}`,
        { referrers: [...referrers].slice(0, 10) }));
    }
  }, 6);

  return findings;
}
