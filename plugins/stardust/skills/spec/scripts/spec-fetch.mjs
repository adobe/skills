#!/usr/bin/env node
/**
 * spec-fetch.mjs — S2 fetch: GET every URL without auto-redirects (each hop recorded), keep the final HTML
 * gzipped, and read the page template. Resumable: URLs already in the output are skipped.
 *
 *   node spec-fetch.mjs [--config spec.config.json] [--urls <file>] [--out <jsonl>] [--html <dir>] [--workers 4]
 *        [--headed | --archive <YYYY-MM-DD>]
 *
 * Defaults: --urls <dir>/inventory/urls.txt, --out <dir>/fetch/fetch.jsonl, --html <dir>/fetch/html.
 * Template rule (config.template): { "bodyAttr": "data-template" } or { "bodyClass": "<regex with one group>" }
 * or { "meta": "<name>" }. Output rows: url, status, final_url, final_status, external, chain[], template,
 * bodyClass, title, html_key, bytes, ms, source (live | headed | archive), tier?, archived_at? — or error ("redirect
 * loop" when it never settles), or blocked (challenge | refused | network) when the origin turns the client away.
 * Challenges are classified by the diff skill's live-session.mjs (edge signatures), plus interstitial page text.
 * Blocked origin: when 10% or more of the rows are blocked, exit 3 — ask the user, then re-run with one of:
 *   --headed             the blocked URLs through live-session's stealth real-Chrome tier (the plugin's `--headed`:
 *                        waits out a JS challenge; replica and diff use the same tier); one page at a time
 *   --archive <date>     the blocked URLs from Internet Archive raw captures since <date> (stale: say so in provenance)
 * Either flag retries only blocked and failed rows and keeps one row per URL (the last). --headed is recorded in
 * <dir>/fetch/technique.json, so later runs (S4's discovered pages, re-runs) start in that tier.
 */
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJSONL, arg, flag, helpAndExit, loadConfig, loadLiveSession, loadPlaywright, log, pool, readJSON, readJSONL, urlKey, writeJSON } from './lib.mjs';

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

const CHALLENGE = /cf-browser-verification|challenge-platform|cf-chl-|Just a moment\.\.\.|Attention Required|_Incapsula_Resource|px-captcha|perimeterx|Access Denied<\/title>|ak_bmsc|datadome|captcha-delivery/i;
/**
 * Why a response turns the client away, or null: a bot challenge (an edge signature by live-session's rules when
 * `isChallenge` is given, or interstitial text), or a refusal of an HTML request. Pure.
 */
export function blockedBy(status, headers, head = '', url = '', isChallenge = null) {
  const edge = isChallenge ? isChallenge({ status: () => status, headers: () => headers, url: () => url }) : headers['cf-mitigated'] === 'challenge';
  if (edge || ([403, 429, 503].includes(status) && CHALLENGE.test(head))) return 'challenge';
  if (status === 403 || status === 429) return 'refused';
  return null;
}
let EDGE = null; // live-session's isChallengeResponse, set in main
const isBlocked = (r) => !!r.blocked || (!!r.error && r.error !== 'redirect loop');

async function fetchOne(url, cfg, htmlDir) {
  const chain = []; let cur = url; const t0 = Date.now();
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let res;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,*/*' } }); break; } catch (e) { if (attempt === 2) return { url, error: String(e.message || e), blocked: 'network', chain, source: 'live' }; await new Promise((r) => { setTimeout(r, 1500 * (attempt + 1)); }); }
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
    const rec = { url, status: chain.length ? chain[0].status : res.status, final_url: cur, final_status: res.status, external: false, chain, content_type: type, ms: Date.now() - t0, source: 'live' };
    if (res.status !== 200) {
      const head = type.includes('html') ? (await res.text().catch(() => '')).slice(0, 20000) : (await res.arrayBuffer().catch(() => {}), '');
      const why = blockedBy(res.status, Object.fromEntries(res.headers), head, cur, EDGE);
      if (why) rec.blocked = why;
      return rec;
    }
    if (type.includes('html')) {
      const html = await res.text();
      Object.assign(rec, readTemplate(html, cfg.template), { bytes: html.length, html_key: urlKey(url) });
      writeFileSync(join(htmlDir, `${rec.html_key}.html.gz`), gzipSync(html));
    } else { await res.arrayBuffer().catch(() => {}); }
    return rec;
  }
  return { url, error: 'redirect loop', chain };
}

/** --headed: the URL through live-session's stealth real-Chrome tier; the HTML kept is the main document as served. */
async function fetchHeaded(ls, ctx, tier, url, cfg, htmlDir) {
  const t0 = Date.now(); const page = await ctx.newPage();
  try {
    const res = await ls.gotoLive(page, url, { solveWindow: true, httpError: 'measure', settleMs: 600 });
    const final = page.url(); const status = res.status();
    const chain = []; for (let r = res.request().redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift({ url: r.url(), status: (await r.response())?.status() ?? null, location: null });
    const rec = { url, status: chain.length ? chain[0].status : status, final_url: final, final_status: status, external: new URL(final).origin !== cfg.origin, chain, ms: Date.now() - t0, source: 'headed', tier };
    const html = (await res.text().catch(() => null)) || await page.content();
    if (CHALLENGE.test(html.slice(0, 20000)) && status !== 200) return { ...rec, blocked: 'challenge' };
    if (status === 200) { Object.assign(rec, readTemplate(html, cfg.template), { bytes: html.length, html_key: urlKey(url) }); writeFileSync(join(htmlDir, `${rec.html_key}.html.gz`), gzipSync(html)); }
    return rec;
  } catch (e) {
    return { url, error: String(e.message || e).slice(0, 200), blocked: e.name === 'BotChallengeError' ? 'challenge' : 'network', source: 'headed', tier };
  } finally { await page.close(); }
}

/** --archive: the newest Internet Archive capture since `since` (raw `id_` HTML, no archive toolbar). */
async function fetchArchive(url, since, cfg, htmlDir) {
  const t0 = Date.now(); const ia = async (u) => { for (let a = 0; a < 4; a += 1) { const r = await fetch(u, { headers: { 'user-agent': UA } }).catch(() => null); if (r && r.status !== 429 && r.status < 500) return r; await new Promise((x) => { setTimeout(x, 3000 * 2 ** a); }); } return null; };
  const cdx = await ia(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&from=${since.replace(/-/g, '')}&filter=statuscode:200&filter=mimetype:text/html&fl=timestamp`);
  const rows = cdx?.ok ? await cdx.json().catch(() => []) : [];
  const ts = rows.length > 1 ? rows[rows.length - 1][0] : null;
  if (!ts) return { url, error: `no archive capture since ${since}`, blocked: 'archive-miss', source: 'archive' };
  const r = await ia(`https://web.archive.org/web/${ts}id_/${url}`);
  if (!r?.ok) return { url, error: `archive fetch ${r?.status ?? 'failed'}`, blocked: 'archive-miss', source: 'archive' };
  const html = await r.text();
  const rec = { url, status: 200, final_url: url, final_status: 200, external: false, chain: [], ms: Date.now() - t0, source: 'archive', archived_at: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` };
  Object.assign(rec, readTemplate(html, cfg.template), { bytes: html.length, html_key: urlKey(url) });
  writeFileSync(join(htmlDir, `${rec.html_key}.html.gz`), gzipSync(html));
  return rec;
}

async function main() {
  const cfg = loadConfig();
  const archive = arg('archive', null);
  const techFile = cfg.p('fetch', 'technique.json');
  const headed = flag('headed') || (!archive && readJSON(techFile, {}).technique === 'headed');
  const ls = await loadLiveSession(); EDGE = ls.isChallengeResponse;
  if (archive && !/^\d{4}-\d{2}-\d{2}$/.test(archive)) throw new Error('--archive needs a date: YYYY-MM-DD');
  const src = arg('urls', cfg.p('inventory', 'urls.txt'));
  const out = arg('out', cfg.p('fetch', 'fetch.jsonl'));
  const htmlDir = arg('html', cfg.p('fetch', 'html'));
  mkdirSync(htmlDir, { recursive: true });
  const urls = [...new Set(readFileSync(src, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))];
  const last = new Map((existsSync(out) ? readJSONL(out) : []).map((r) => [r.url, r]));
  const retry = archive || flag('headed');
  const todo = urls.filter((u) => !last.has(u) || (retry && isBlocked(last.get(u))));
  log(`${urls.length} urls, ${last.size} done, ${todo.length} to fetch${archive ? ` (archive since ${archive})` : headed ? ' (headed)' : ''}`);
  const progress = (d, n) => { if (d % 200 === 0 || d === n) log(`${d}/${n}`); };
  if (headed) {
    const { chromium } = await loadPlaywright(); const b = await ls.launchStealthHeaded(chromium); const tier = ls.browserTier(b);
    const ctx = await ls.newLiveContext(b, { viewport: { width: 1440, height: 900 } });
    writeJSON(techFile, { technique: 'headed', tier, since: new Date().toISOString().slice(0, 10) });
    await pool(todo, 1, async (u) => { appendJSONL(out, await fetchHeaded(ls, ctx, tier, u, cfg, htmlDir)); await new Promise((r) => { setTimeout(r, 800); }); }, progress);
    await b.close();
  } else if (archive) {
    await pool(todo, 2, async (u) => { appendJSONL(out, await fetchArchive(u, archive, cfg, htmlDir)); }, progress);
  } else {
    await pool(todo, Number(arg('workers', cfg.workers || 4)), async (u) => { appendJSONL(out, await fetchOne(u, cfg, htmlDir)); }, progress);
  }
  // one row per URL (the last attempt), so a retry never double-counts a page
  const rows = [...new Map(readJSONL(out).map((r) => [r.url, r])).values()];
  if (retry) writeFileSync(out, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const blocked = rows.filter(isBlocked); const by = {}; blocked.forEach((r) => { by[r.blocked || 'error'] = (by[r.blocked || 'error'] || 0) + 1; });
  const sources = {}; rows.forEach((r) => { sources[r.source || 'live'] = (sources[r.source || 'live'] || 0) + 1; });
  log(`${rows.length} rows: ${JSON.stringify(sources)}; blocked ${blocked.length} ${JSON.stringify(by)}`);
  if (rows.length && blocked.length / rows.length >= 0.1) {
    console.error(`BLOCKED ORIGIN: ${blocked.length} of ${rows.length} pages turned this client away (${JSON.stringify(by)}). Ask the user how to proceed: allow-list the crawler (user agent "stardust-spec/1.0") and re-run; --headed (live-session's stealth real-Chrome tier; it waits out a JS challenge); or --archive <YYYY-MM-DD> (Internet Archive captures: stale, and the spec must say so).`);
    process.exit(3);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
