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
 *   - source-host links (T27.8): an href to a `--source-host` (or
 *     rollout.json site.sourceHost) whose path is in the inventory is a bounce
 *     link the localize stage should have rewritten (error); a path not in the
 *     inventory is the honest boundary (warn, counted). /nav, /footer and the
 *     fragments are scanned as referrers too.
 *   - planned gaps: a broken internal target listed in stardust/link-gaps.tsv
 *     (the owner-decided `links: list` row) is `planned-link-gap` (warn), never
 *     `broken-internal-link`
 *   - external links: SKIPPED by default (on blog-scale fleets the unique
 *     external set dominates sweep time — 35 of 38 min on a 1,035-page run).
 *     Pass --probe-externals to probe each unique URL once (HEAD, GET
 *     fallback); 404/410/DNS-fail -> warn (external sites flap; never an
 *     error). The skip is always reported as an info finding, never silent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fetchUrl, pMap, finding, pageUrl, decodeAttr, isThrottled, noteThrottled, arg } from '../lib.mjs';
import { gotoPaced } from './browse.mjs';
import { acquire } from '../../../stardust/scripts/browser-lock.mjs';

const unmeasured = (path, what, res) => finding('links', 'unmeasured', 'info', path, `${what} throttled (HTTP ${res.status} after retries) — not measured; re-run`, { status: res.status });

const ASSET_RE = /\.(css|js|png|jpe?g|gif|webp|avif|svg|ico|woff2?|xml|txt|json|pdf|mp4|webm|mov|zip)$/i;

const hostOf = (v) => { try { return new URL(/^https?:/i.test(v) ? v : `https://${v}`).host.toLowerCase(); } catch { return String(v).toLowerCase(); } };
const pathOf = (href) => { try { return new URL(href).pathname.replace(/\/$/, '') || '/'; } catch { return href; } };
// --source-host <h[,h]>, else rollout.json site.sourceHost (the same value localize-links.mjs rewrites)
function sourceHostsFromConfig() {
  const hosts = new Set((arg('source-host', '') || '').split(',').map((h) => h.trim()).filter(Boolean).map(hostOf));
  if (!hosts.size && existsSync('stardust/rollout/rollout.json')) {
    try { const h = JSON.parse(readFileSync('stardust/rollout/rollout.json', 'utf8'))?.site?.sourceHost; for (const x of [].concat(h || [])) hosts.add(hostOf(x)); } catch { /* no config → class off */ }
  }
  return hosts;
}
// stardust/link-gaps.tsv: first column = the target path (localize-links --unmigrated list); comments/blank skipped
function plannedGapsFromSheet(file = 'stardust/link-gaps.tsv') {
  const gaps = new Set();
  if (!existsSync(file)) return gaps;
  for (const line of readFileSync(file, 'utf8').split('\n')) { const t = line.split('\t')[0].trim(); if (t && !t.startsWith('#')) gaps.add(pathOf(/^https?:/i.test(t) ? t : `https://x${t.startsWith('/') ? '' : '/'}${t}`)); }
  return gaps;
}

/**
 * Pure classifier for one href as run() sees it — the T27.8 classes in one place (tested in
 * qa/scripts/test/links-classes.test.mjs). `known` = inventory paths (+ fragments), `sourceHosts`
 * = --source-host / rollout.json site.sourceHost (normalised hosts), `plannedGaps` = link-gaps.tsv targets.
 *   empty-href · mailto{malformed} · tel{malformed} · anchor{id} · asset{target}
 *   internal{target, frag, known, planned} · source-host-link{host, target, inInventory, severity}
 *   external{url} · other (javascript:, data:, …)
 */
export function classifyHref(href, { base = '', known = new Set(), sourceHosts = new Set(), plannedGaps = new Set() } = {}) {
  const h = String(href || '').trim();
  if (!h || h === '#') return { kind: 'empty-href' };
  if (h.startsWith('mailto:')) return { kind: 'mailto', malformed: !/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(h.split('?')[0]) };
  if (h.startsWith('tel:')) return { kind: 'tel', malformed: !/^tel:\+?[\d\-().\s]{7,}$/.test(h) };
  if (h.startsWith('#')) return { kind: 'anchor', id: h.slice(1) };
  const internal = (target, frag) => (ASSET_RE.test(target) ? { kind: 'asset', target } : { kind: 'internal', target, frag: frag || null, known: known.has(target), planned: plannedGaps.has(target) });
  if (h.startsWith('/')) {
    const [clean, frag] = h.split('#');
    return internal(clean.split('?')[0].replace(/\/$/, '') || '/', frag);
  }
  if (/^https?:\/\//i.test(h)) {
    const host = hostOf(h);
    if (sourceHosts.size && sourceHosts.has(host)) {
      const target = pathOf(h);
      const inInventory = known.has(target);
      return { kind: 'source-host-link', host, target, inInventory, severity: inInventory ? 'error' : 'warn' };
    }
    let sameHost = false;
    try { sameHost = new URL(h).host === new URL(base).host; } catch { /* keep external */ }
    if (sameHost) return internal(new URL(h).pathname.replace(/\/$/, '') || '/', null);
    return { kind: 'external', url: h };
  }
  return { kind: 'other' };
}

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const known = new Set(inventory.pages.map((p) => p.path));
  for (const f of inventory.fragments) known.add(f);
  const sourceHosts = sourceHostsFromConfig();
  const plannedGaps = plannedGapsFromSheet();

  const pageHtml = new Map();
  // referrers = every page plus the chrome/fragment documents (a bounce link in /nav bounces sitewide)
  const referrers = [...inventory.pages, ...(inventory.fragments || []).filter((f) => !inventory.pages.some((p) => p.path === f)).map((f) => ({ path: f }))];
  await pMap(referrers, async (p) => {
    const res = await ctx.fetchPage(pageUrl(base, p.path));
    if (isThrottled(res)) findings.push(unmeasured(p.path, `GET ${p.path}`, res));
    else if (res.status === 200) pageHtml.set(p.path, res.body);
  }, 8);

  const internal = new Map(); // path -> Set(referrers)
  const anchors = [];         // {referrer, targetPath, id}
  const external = new Map(); // url -> Set(referrers)

  for (const [path, html] of pageHtml) {
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
      const href = decodeAttr(m[1].trim());
      const c = classifyHref(href, { base, known, sourceHosts, plannedGaps });
      if (c.kind === 'empty-href') {
        findings.push(finding('links', 'empty-href', 'warn', path, 'anchor with empty/# href (dead link affordance)'));
      } else if (c.kind === 'mailto') {
        if (c.malformed) findings.push(finding('links', 'malformed-mailto', 'warn', path, `malformed mailto: ${href}`));
      } else if (c.kind === 'tel') {
        if (c.malformed) findings.push(finding('links', 'malformed-tel', 'warn', path, `malformed tel: ${href}`));
      } else if (c.kind === 'anchor') {
        anchors.push({ referrer: path, targetPath: path, id: c.id });
      } else if (c.kind === 'internal') {
        if (!internal.has(c.target)) internal.set(c.target, new Set());
        internal.get(c.target).add(path);
        if (c.frag) anchors.push({ referrer: path, targetPath: c.target, id: c.frag });
      } else if (c.kind === 'source-host-link') {
        findings.push(finding('links', 'source-host-link', c.severity, path, c.inInventory
          ? `href to the source host ${c.host}${c.target} whose path is in the inventory — a bounce link localize-links.mjs should have rewritten`
          : `href to the source host ${c.host}${c.target} — path not in the inventory (the honest boundary, counted)`, { href, target: c.target, inInventory: c.inInventory }));
      } else if (c.kind === 'external') {
        if (!external.has(href)) external.set(href, new Set());
        external.get(href).add(path);
      }
    }
  }

  // internal targets
  await pMap([...internal.entries()], async ([target, referrers]) => {
    if (known.has(target)) return;
    const res = await fetchUrl(pageUrl(base, target), { redirect: 'manual' });
    if (isThrottled(res)) {
      findings.push(unmeasured(target, `internal link target ${target}`, res));
    } else if (res.status === 200) {
      findings.push(finding('links', 'off-inventory-link', 'info', target,
        `internal link target ${target} serves 200 but is not in the tracked inventory`,
        { referrers: [...referrers].slice(0, 5) }));
    } else if ([301, 302, 307, 308].includes(res.status)) {
      findings.push(finding('links', 'link-via-redirect', 'info', target,
        `internal links point at ${target} which redirects to ${res.location} — consider linking the destination`,
        { referrers: [...referrers].slice(0, 5) }));
    } else if (plannedGaps.has(target)) {
      findings.push(finding('links', 'planned-link-gap', 'warn', target,
        `internal link target ${target} is a planned gap (stardust/link-gaps.tsv, the owner-decided \`links: list\` row) — returns ${res.status || res.error}`,
        { referrers: [...referrers].slice(0, 10) }));
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
      const slot = await acquire({ script: 'qa-links' }).catch((e) => { if (e.code === 124) { console.error(e.message); process.exit(124); } throw e; }); // fan-out.md § Machine budget — 124 = no slot, no verdict, never an error row
      const browser = await chromium.launch(); browser.on('disconnected', () => slot?.release());
      const page = await browser.newPage();
      renderedIds = new Map();
      for (const target of [...new Set(suspects.map((a) => a.targetPath))]) {
        try {
          // one limiter slot per navigation, paced 429/503 retries (browse.mjs gotoPaced): a throttled
          // target has no ids to read — its suspects are links/unmeasured, never broken-anchor
          const res = await gotoPaced(page, pageUrl(base, target), { waitUntil: 'domcontentloaded', timeout: 30000 });
          const status = res ? res.status() : 0;
          if (status === 429 || status === 503) {
            noteThrottled();
            renderedIds.set(target, 'throttled');
            findings.push(finding('links', 'unmeasured', 'info', target,
              `anchor target throttled (HTTP ${status} after the paced retries) — its fragment links are not verified; re-run`, { status }));
            continue;
          }
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
      if (ids === 'throttled') continue; // reported once per target as links/unmeasured above
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
