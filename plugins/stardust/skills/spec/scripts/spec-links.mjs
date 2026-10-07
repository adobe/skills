#!/usr/bin/env node
/**
 * spec-links.mjs — S4 link check: every same-origin link found by spec-parse that is not a fetched page —
 * pages are fetched like S2 (redirect chain, template, HTML kept for parsing), assets (/content/dam, files)
 * get HEAD then GET. Records status, final URL and target status. Resumable.
 *
 *   node spec-links.mjs [--config spec.config.json] [--links <links.jsonl>] [--workers 6] [--max 20000]
 *
 * Writes <dir>/links/assets.jsonl and <dir>/links/pages.txt (then run spec-fetch with
 * --urls <dir>/links/pages.txt --out <dir>/links/pages.jsonl to fetch the discovered pages).
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendJSONL, arg, helpAndExit, loadConfig, log, pool, readJSONL, writeText } from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh) stardust-spec/1.0';
const ASSET = /\/content\/dam\/|\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg|mp4|mov)(\?|$)/i;

/** Split discovered same-origin links into pages and assets, skipping known pages. Pure. */
export function splitLinks(linkRows, origin, known) {
  const pages = new Set(); const assets = new Set();
  for (const r of linkRows) {
    for (const u of Object.keys(r.links || {})) {
      let x; try { x = new URL(u); } catch { continue; }
      if (x.origin !== origin || known.has(u)) continue;
      (ASSET.test(x.pathname) ? assets : pages).add(u);
    }
  }
  return { pages: [...pages].sort(), assets: [...assets].sort() };
}

async function check(url) {
  const chain = []; let cur = url;
  for (let hop = 0; hop < 8; hop += 1) {
    let res;
    try {
      res = await fetch(cur, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA } });
      if ([403, 405, 501].includes(res.status)) res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, range: 'bytes=0-1023' } });
    } catch (e) { return { url, error: String(e.message || e).slice(0, 200), chain }; }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) { const next = new URL(res.headers.get('location'), cur).href; chain.push({ url: cur, status: res.status, location: next }); cur = next; continue; }
    return { url, status: chain.length ? chain[0].status : res.status, final_url: cur, final_status: res.status, chain, content_type: res.headers.get('content-type') || '', bytes: Number(res.headers.get('content-length')) || null };
  }
  return { url, error: 'redirect loop', chain };
}

async function main() {
  const cfg = loadConfig();
  const fetched = readJSONL(cfg.p('fetch', 'fetch.jsonl'));
  const known = new Set(fetched.flatMap((r) => [r.url, r.final_url]).filter(Boolean));
  const { pages, assets } = splitLinks(readJSONL(arg('links', cfg.p('parse', 'links.jsonl'))), cfg.origin, known);
  writeText(cfg.p('links', 'pages.txt'), pages.join('\n'));
  const out = cfg.p('links', 'assets.jsonl');
  const done = new Set(existsSync(out) ? readJSONL(out).map((r) => r.url) : []);
  const todo = assets.filter((u) => !done.has(u)).slice(0, Number(arg('max', 20000)));
  log(`${pages.length} discovered pages (→ links/pages.txt), ${assets.length} assets, ${todo.length} to check`);
  await pool(todo, Number(arg('workers', 6)), async (u) => appendJSONL(out, await check(u)), (d, n) => { if (d % 500 === 0 || d === n) log(`${d}/${n}`); });
  if (existsSync(out)) log(`${readFileSync(out, 'utf8').split('\n').filter(Boolean).length} assets checked`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
