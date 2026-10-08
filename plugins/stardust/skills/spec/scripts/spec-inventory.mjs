#!/usr/bin/env node
/**
 * spec-inventory.mjs — S1 inventory: robots.txt + sitemaps (index or urlset, nested) → the URL list of the
 * scope path, plus every other sitemap (locales, microsites) counted for the multi-language inventory.
 *
 *   node spec-inventory.mjs [--config spec.config.json] [--max <n>] [--headed | --archive <YYYY-MM-DD>]
 *
 * Reads config: origin, scopePath, sitemaps? (default: robots.txt Sitemap lines, else /sitemap.xml), maxPages?.
 * Stops when the origin redirects elsewhere (set `origin` to the final one). Without sitemap URLs in scope, crawls
 * same-origin links from the scope root (breadth first, up to the cap). Above --max / maxPages, keeps an even
 * sample per first path segment (every section at least one URL).
 * Writes <dir>/inventory/urls.txt (the URLs every later stage reads, sorted), urls-all.txt (when sampled),
 * summary.json ({ total, kept, source: sitemap|crawl, sampled }), sitemaps.json (every sitemap: url count, path
 * roots, hreflang count, lastmod years), robots.txt. Exit 0; 1 on a redirected origin; 2 on usage; 3 when the origin
 * turns this client away (a bot challenge on robots, sitemaps or pages, classified by the diff skill's
 * live-session.mjs): ask the user, then re-run with --headed (live-session's stealth real-Chrome tier) or --archive
 * <date> (Internet Archive captures since <date>), the same choice S2 then makes.
 */
import { arg, flag, helpAndExit, loadConfig, loadLiveSession, loadPlaywright, log, writeJSON, writeText, pool } from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 stardust-spec/1.0';

/** <loc> values and whether the document is a sitemap index. Pure. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  return { isIndex: /<sitemapindex/i.test(xml), locs, hreflang: (xml.match(/hreflang=/g) || []).length, lastmod: [...xml.matchAll(/<lastmod>(\d{4})/g)].map((m) => m[1]) };
}
/** First two path segments, e.g. /de/de or /en/home. Pure. */
export const rootOf = (u) => { try { return `/${new URL(u).pathname.split('/').filter(Boolean).slice(0, 2).join('/')}`; } catch { return '/'; } };

// how documents are read: live (default), live-session's stealth Chrome (--headed) or the Internet Archive (--archive)
const MODE = { archive: arg('archive', null), headed: flag('headed'), blocked: 0, ctx: null, ls: null };
async function get(url) {
  if (MODE.archive) {
    const cdx = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&from=${MODE.archive.replace(/-/g, '')}&filter=statuscode:200&fl=timestamp`, { headers: { 'user-agent': UA } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const ts = cdx.length > 1 ? cdx[cdx.length - 1][0] : null;
    return ts ? fetch(`https://web.archive.org/web/${ts}id_/${url}`, { headers: { 'user-agent': UA } }).then((r) => (r.ok ? r.text() : '')).catch(() => '') : '';
  }
  if (!MODE.ls) MODE.ls = await loadLiveSession();
  if (MODE.headed) {
    if (!MODE.ctx) { const { chromium } = await loadPlaywright(); MODE.ctx = await MODE.ls.newLiveContext(await MODE.ls.launchStealthHeaded(chromium)); }
    const p = await MODE.ctx.newPage();
    try { const r = await MODE.ls.gotoLive(p, url, { solveWindow: true, httpError: 'measure', settleMs: 300 }); return r.ok() ? await r.text().catch(() => '') : ''; } catch (e) { if (e.name === 'BotChallengeError') MODE.blocked += 1; return ''; } finally { await p.close(); }
  }
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml,text/xml,*/*' }, redirect: 'follow' }).catch(() => null);
  if (!r) return '';
  const h = Object.fromEntries(r.headers);
  if (MODE.ls.isChallengeResponse({ status: () => r.status, headers: () => h, url: () => r.url }) || r.status === 403 || r.status === 429) { MODE.blocked += 1; await r.arrayBuffer().catch(() => {}); return ''; }
  return r.ok ? r.text() : '';
}

/** Even sample of `max` URLs, allocated per first path segment under the scope (each section ≥ 1). Pure. */
export function sampleBySection(urls, max, scopePath) {
  if (urls.length <= max) return urls;
  const sec = (u) => { try { return new URL(u).pathname.slice(scopePath.length).split('/').filter(Boolean)[0] || '(root)'; } catch { return '(root)'; } };
  const groups = {}; urls.forEach((u) => { (groups[sec(u)] = groups[sec(u)] || []).push(u); });
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  const quota = Object.fromEntries(keys.map((k) => [k, 1]));
  let left = max - keys.length;
  if (left < 0) return keys.slice(0, max).map((k) => groups[k][0]);
  keys.forEach((k) => { const q = Math.floor(((groups[k].length - 1) / (urls.length - keys.length)) * left); quota[k] += Math.min(q, groups[k].length - 1); });
  left = max - Object.values(quota).reduce((a, b) => a + b, 0);
  for (const k of keys) { if (left <= 0) break; if (quota[k] < groups[k].length) { quota[k] += 1; left -= 1; } }
  const out = [];
  for (const k of keys) { const g = groups[k].sort(); const step = g.length / quota[k]; for (let i = 0; i < quota[k]; i += 1) out.push(g[Math.floor(i * step)]); }
  return out.sort();
}

const inScopeOf = (cfg) => (l) => { try { const x = new URL(l); return `${x.origin}` === cfg.origin && (x.pathname === cfg.scopePath || x.pathname.startsWith(`${cfg.scopePath.replace(/\/$/, '')}/`) || x.pathname.startsWith(cfg.scopePath)); } catch { return false; } };

/** Breadth-first same-origin crawl from the scope root, for sites without a usable sitemap. */
async function crawl(cfg, max) {
  const ok = inScopeOf(cfg); const seen = new Set([`${cfg.origin}${cfg.scopePath}`]); let frontier = [...seen];
  const skip = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|json)(\?|$)/i;
  while (frontier.length && seen.size < max * 2) {
    const pages = await pool(frontier.slice(0, 200), 4, get); const next = [];
    pages.forEach((html, i) => { for (const m of (html || '').matchAll(/href="([^"#]+)"/g)) { let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), frontier[i]); } catch { continue; } u.hash = ''; u.search = ''; const h = u.href; if (ok(h) && !skip.test(h) && !seen.has(h)) { seen.add(h); next.push(h); } } });
    frontier = next;
  }
  return [...seen];
}

async function main() {
  const cfg = loadConfig();
  const max = Number(arg('max', cfg.maxPages || 0)) || Infinity;
  const probe = await fetch(`${cfg.origin}${cfg.scopePath}`, { headers: { 'user-agent': UA }, redirect: 'follow' }).catch((e) => ({ url: '', error: e.message }));
  const finalOrigin = probe.url ? new URL(probe.url).origin : null;
  if (finalOrigin && finalOrigin !== cfg.origin) { console.error(`origin ${cfg.origin} redirects to ${finalOrigin}: set "origin": "${finalOrigin}" in spec.config.json`); process.exit(1); }
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
  const inScope = new Set(); const summary = {}; const ok = inScopeOf(cfg);
  for (const [u, s] of Object.entries(docs)) {
    const roots2 = {}; s.locs.forEach((l) => { const r = rootOf(l); roots2[r] = (roots2[r] || 0) + 1; });
    const years = {}; s.lastmod.forEach((y) => { years[y] = (years[y] || 0) + 1; });
    summary[u] = { urls: s.locs.length, roots: roots2, hreflang: s.hreflang, lastmodYears: years };
    s.locs.filter(ok).forEach((l) => inScope.add(l));
  }
  let all = [...inScope].sort(); let source = 'sitemap';
  if (!all.length) { source = 'crawl'; all = (await crawl(cfg, max === Infinity ? 5000 : max)).sort(); }
  if (MODE.ctx) await MODE.ctx.browser().close();
  if (MODE.blocked && all.length <= 1) {
    console.error(`BLOCKED ORIGIN: ${MODE.blocked} request(s) for robots, sitemaps or pages were turned away${MODE.headed ? ' even headed' : ''}. Ask the user how to proceed: allow-list the crawler (user agent "stardust-spec/1.0") and re-run; --headed (live-session's stealth real-Chrome tier; it waits out a JS challenge); or --archive <YYYY-MM-DD> (Internet Archive captures: stale, and the spec must say so). Use the same choice for S2.`);
    process.exit(3);
  }
  if (MODE.archive) source = `${source} (archive since ${MODE.archive})`;
  const urls = sampleBySection(all, max, cfg.scopePath);
  writeText(cfg.p('inventory', 'urls.txt'), urls.join('\n'));
  if (urls.length < all.length) writeText(cfg.p('inventory', 'urls-all.txt'), all.join('\n'));
  writeJSON(cfg.p('inventory', 'summary.json'), { total: all.length, kept: urls.length, source, sampled: urls.length < all.length });
  writeJSON(cfg.p('inventory', 'sitemaps.json'), summary);
  log(`${Object.keys(docs).length} sitemaps, ${Object.values(summary).reduce((a, s) => a + s.urls, 0)} urls total, ${all.length} in scope ${cfg.scopePath} (${source})${urls.length < all.length ? `, sampled ${urls.length}` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
