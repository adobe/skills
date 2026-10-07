#!/usr/bin/env node
/**
 * spec-inventory.mjs — S1 inventory: robots.txt + sitemaps (index or urlset, nested) → the URL list of the
 * scope path, plus every other sitemap (locales, microsites) counted for the multi-language inventory.
 *
 *   node spec-inventory.mjs [--config spec.config.json]
 *
 * Reads config: origin, scopePath, sitemaps? (default: robots.txt Sitemap lines, else /sitemap.xml).
 * Writes <dir>/inventory/urls.txt (scope URLs, sorted, deduped), sitemaps.json (every sitemap: url count,
 * path roots, hreflang count, lastmod years), robots.txt. Exit 0; 2 on usage.
 */
import { helpAndExit, loadConfig, log, writeJSON, writeText, pool } from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 stardust-spec/1.0';

/** <loc> values and whether the document is a sitemap index. Pure. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  return { isIndex: /<sitemapindex/i.test(xml), locs, hreflang: (xml.match(/hreflang=/g) || []).length, lastmod: [...xml.matchAll(/<lastmod>(\d{4})/g)].map((m) => m[1]) };
}
/** First two path segments, e.g. /de/de or /en/home. Pure. */
export const rootOf = (u) => { try { return `/${new URL(u).pathname.split('/').filter(Boolean).slice(0, 2).join('/')}`; } catch { return '/'; } };

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml,text/xml,*/*' }, redirect: 'follow' });
  return r.ok ? r.text() : '';
}

async function main() {
  const cfg = loadConfig();
  const robots = await get(`${cfg.origin}/robots.txt`);
  writeText(cfg.p('inventory', 'robots.txt'), robots || '# none');
  let roots = cfg.sitemaps || [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!roots.length) roots = [`${cfg.origin}/sitemap.xml`];
  const seen = new Set(); const docs = {}; let queue = [...roots];
  while (queue.length) {
    const batch = queue.filter((u) => !seen.has(u)); queue = [];
    batch.forEach((u) => seen.add(u));
    const xmls = await pool(batch, 4, get);
    batch.forEach((u, i) => {
      const s = parseSitemap(xmls[i] || '');
      if (s.isIndex) queue.push(...s.locs);
      else docs[u] = s;
    });
  }
  const inScope = new Set(); const summary = {};
  for (const [u, s] of Object.entries(docs)) {
    const roots2 = {}; s.locs.forEach((l) => { const r = rootOf(l); roots2[r] = (roots2[r] || 0) + 1; });
    const years = {}; s.lastmod.forEach((y) => { years[y] = (years[y] || 0) + 1; });
    summary[u] = { urls: s.locs.length, roots: roots2, hreflang: s.hreflang, lastmodYears: years };
    s.locs.filter((l) => { try { const x = new URL(l); return `${x.origin}` === cfg.origin && (x.pathname === cfg.scopePath || x.pathname.startsWith(`${cfg.scopePath.replace(/\/$/, '')}/`) || x.pathname.startsWith(cfg.scopePath)); } catch { return false; } }).forEach((l) => inScope.add(l));
  }
  const urls = [...inScope].sort();
  writeText(cfg.p('inventory', 'urls.txt'), urls.join('\n'));
  writeJSON(cfg.p('inventory', 'sitemaps.json'), summary);
  log(`${Object.keys(docs).length} sitemaps, ${Object.values(summary).reduce((a, s) => a + s.urls, 0)} urls total, ${urls.length} in scope ${cfg.scopePath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
