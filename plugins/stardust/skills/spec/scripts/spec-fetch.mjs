#!/usr/bin/env node
/**
 * spec-fetch.mjs — S2 fetch: GET every URL without auto-redirects (each hop recorded), keep the final HTML
 * gzipped, and read the page template. Resumable: URLs already in the output are skipped.
 *
 *   node spec-fetch.mjs [--config spec.config.json] [--urls <file>] [--out <jsonl>] [--html <dir>] [--workers 4]
 *
 * Defaults: --urls <dir>/inventory/urls.txt, --out <dir>/fetch/fetch.jsonl, --html <dir>/fetch/html.
 * Template rule (config.template): { "bodyAttr": "data-template" } or { "bodyClass": "<regex with one group>" }
 * or { "meta": "<name>" }. Output rows: url, status, final_url, final_status, external, chain[], template,
 * bodyClass, title, html_key, bytes, ms — or error ("redirect loop" when it never settles).
 */
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJSONL, arg, helpAndExit, loadConfig, log, pool, readJSONL, urlKey } from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 stardust-spec/1.0';
const MAX_HOPS = 10;

/** The page template from raw HTML under a config rule. Pure. */
export function readTemplate(html, rule = { bodyAttr: 'data-template' }) {
  const body = (html.match(/<body([^>]*)>/i) || [])[1] || '';
  const bodyClass = (body.match(/\sclass="([^"]*)"/i) || [])[1] || '';
  let template = null;
  if (rule.bodyAttr) template = (body.match(new RegExp(`\\s${rule.bodyAttr}="([^"]*)"`, 'i')) || [])[1] || null;
  else if (rule.bodyClass) { const re = new RegExp(rule.bodyClass); const c = bodyClass.split(/\s+/).find((x) => re.test(x)); template = c ? (c.match(re)[1] ?? c) : null; } else if (rule.meta) template = (html.match(new RegExp(`<meta[^>]+name="${rule.meta}"[^>]+content="([^"]*)"`, 'i')) || [])[1] || null;
  const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim().replace(/\s+/g, ' ');
  return { template, bodyClass, title };
}

async function fetchOne(url, cfg, htmlDir) {
  const chain = []; let cur = url; const t0 = Date.now();
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let res;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,*/*' } }); break; } catch (e) { if (attempt === 2) return { url, error: String(e.message || e), chain }; await new Promise((r) => { setTimeout(r, 1500 * (attempt + 1)); }); }
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location'); const next = loc ? new URL(loc, cur).href : null;
      chain.push({ url: cur, status: res.status, location: next });
      if (!next) break;
      cur = next;
      if (new URL(cur).origin !== cfg.origin) return { url, status: chain[0].status, final_url: cur, final_status: null, external: true, chain, ms: Date.now() - t0 };
      continue;
    }
    const type = res.headers.get('content-type') || '';
    const rec = { url, status: chain.length ? chain[0].status : res.status, final_url: cur, final_status: res.status, external: false, chain, content_type: type, ms: Date.now() - t0 };
    if (res.status === 200 && type.includes('html')) {
      const html = await res.text();
      Object.assign(rec, readTemplate(html, cfg.template), { bytes: html.length, html_key: urlKey(url) });
      writeFileSync(join(htmlDir, `${rec.html_key}.html.gz`), gzipSync(html));
    } else { await res.arrayBuffer().catch(() => {}); }
    return rec;
  }
  return { url, error: 'redirect loop', chain };
}

async function main() {
  const cfg = loadConfig();
  const src = arg('urls', cfg.p('inventory', 'urls.txt'));
  const out = arg('out', cfg.p('fetch', 'fetch.jsonl'));
  const htmlDir = arg('html', cfg.p('fetch', 'html'));
  mkdirSync(htmlDir, { recursive: true });
  const urls = [...new Set(readFileSync(src, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))];
  const done = new Set(existsSync(out) ? readJSONL(out).map((r) => r.url) : []);
  const todo = urls.filter((u) => !done.has(u));
  log(`${urls.length} urls, ${done.size} done, ${todo.length} to fetch`);
  await pool(todo, Number(arg('workers', cfg.workers || 4)), async (u) => { appendJSONL(out, await fetchOne(u, cfg, htmlDir)); },
    (d, n) => { if (d % 200 === 0 || d === n) log(`${d}/${n}`); });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
