#!/usr/bin/env node
/**
 * spec-rum.mjs — S5 real-user data (optional): AEM Operational Telemetry bundles for the scope → human page
 * views per path, real-user 404s (with referrers), landing pages reached through a redirect, consent banner states
 * and clicks, views per locale tree, site-search use. Views are estimates (sum of sampled bundle weights; bots and
 * un-activated prerenders excluded).
 *
 *   node spec-rum.mjs [--config spec.config.json] [--days 90] [--domain <host>] [--key-env RUM_DOMAIN_KEY] [--workers 6]
 *
 * The domain key is read from the environment variable named by --key-env or config.rum.keyEnv (never from a
 * file, never printed). Without a key the stage writes <dir>/rum/rum.json with { available: false } and exits 0:
 * every later stage and every consumer treat traffic as unavailable. Hourly files (daily files are downsampled).
 */
import { arg, helpAndExit, loadConfig, log, pool, writeJSON } from './lib.mjs';

helpAndExit(import.meta.url);

/** A human page view: not a bot, not an un-activated prerender. Pure. */
export const isHumanView = (b) => !/^bot/i.test(b.userAgent || '') && (!(b.events || []).some((e) => e.checkpoint === 'prerender') || (b.events || []).some((e) => e.checkpoint === 'navigate' && e.target === 'prerendered'));

/** Fold bundles into the scope's aggregates. Pure. */
export function aggregate(bundles, host, scopePath) {
  const add = (m, k, w) => { const r = m[k] || (m[k] = { views: 0, bundles: 0 }); r.views += w; r.bundles += 1; return r; };
  const pages = {}; const notFound = {}; const redirects = {}; const trees = {}; const consent = {}; const clicks = {}; let search = 0; let human = 0;
  for (const b of bundles) {
    if (!isHumanView(b)) continue;
    let u; try { u = new URL(b.url); } catch { continue; }
    if (u.hostname !== host) continue;
    human += 1; const w = b.weight || 0; const ev = b.events || [];
    const segs = u.pathname.split('/').filter(Boolean);
    add(trees, segs.length >= 2 && /^[a-z]{2}$/.test(segs[0]) ? `${segs[0]}/${segs[1].replace('.html', '')}` : `(${segs[0] || 'root'})`, w);
    const region = u.pathname.startsWith(scopePath) ? 'scope' : 'other';
    ev.filter((e) => e.checkpoint === 'consent').forEach((e) => add(consent, `${region} ${e.source} ${e.target}`, w));
    ev.filter((e) => e.checkpoint === 'click' && /onetrust|ot-sdk|optanon|cookie|consent/i.test(String(e.source))).forEach((e) => add(clicks, `${region} ${String(e.source).slice(0, 80)}`, w));
    if (ev.some((e) => e.checkpoint === 'search') || /\/search(\.html)?$/.test(u.pathname)) search += w;
    if (!u.pathname.startsWith(scopePath)) continue;
    if (ev.some((e) => e.checkpoint === '404')) {
      const r = add(notFound, u.pathname, w); r.referrers = r.referrers || {};
      ev.filter((e) => e.checkpoint === '404').forEach((e) => { const s = e.source || '(direct)'; r.referrers[s] = (r.referrers[s] || 0) + w; });
      continue;
    }
    add(pages, u.pathname, w);
    if (ev.some((e) => e.checkpoint === 'redirect')) add(redirects, u.pathname, w);
  }
  const top = (m, n) => Object.entries(m).sort((a, c) => c[1].views - a[1].views).slice(0, n);
  return { human, pages, notFound, redirectLandings: Object.fromEntries(top(redirects, 1000)), trees: top(trees, 200), consent: top(consent, 60), consentClicks: top(clicks, 30), searchViews: search };
}

async function main() {
  const cfg = loadConfig();
  const keyEnv = arg('key-env', cfg.rum?.keyEnv || 'RUM_DOMAIN_KEY');
  const key = process.env[keyEnv];
  const domain = arg('domain', cfg.rum?.domain || new URL(cfg.origin).hostname);
  const out = cfg.p('rum', 'rum.json');
  if (!key) { writeJSON(out, { available: false, reason: `no domain key in $${keyEnv}` }); log(`no RUM domain key ($${keyEnv}): traffic marked unavailable`); return; }
  const days = Number(arg('days', cfg.rum?.days || 90));
  const end = new Date(); end.setUTCMinutes(0, 0, 0);
  const slots = Array.from({ length: days * 24 }, (_, i) => new Date(end.getTime() - (i + 1) * 3600e3));
  const urlOf = (d) => `https://bundles.aem.page/bundles/${domain}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCHours()).padStart(2, '0')}?domainkey=${encodeURIComponent(key)}`;
  let failed = 0; const bundles = [];
  await pool(slots, Number(arg('workers', 6)), async (d) => {
    try { const r = await fetch(urlOf(d)); if (r.status === 403) throw new Error('invalid domain key for this domain'); if (!r.ok) { if (r.status !== 404) failed += 1; return; } const j = await r.json(); bundles.push(...(j.rumBundles || [])); } catch (e) { if (/invalid domain key/.test(e.message)) throw e; failed += 1; }
  }, (n, t) => { if (n % 240 === 0 || n === t) log(`${n}/${t} hour files`); });
  const agg = aggregate(bundles, domain, cfg.scopePath);
  const times = bundles.map((b) => b.time || b.timeSlot).filter(Boolean).sort();
  writeJSON(out, { available: true, domain, window: `${(times[0] || '').slice(0, 10)} .. ${(times[times.length - 1] || '').slice(0, 10)}`, bundles: bundles.length, failedFiles: failed, note: 'views are estimates: sum of sampled bundle weights, bots and prerenders excluded', ...agg });
  log(`${bundles.length} bundles (${agg.human} human), ${Object.keys(agg.pages).length} scope paths, ${Object.keys(agg.notFound).length} real-user 404 paths, ${failed} failed files`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message.replace(/domainkey=[^&\s]+/g, 'domainkey=***')); process.exit(1); });
