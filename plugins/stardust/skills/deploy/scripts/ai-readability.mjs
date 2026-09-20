#!/usr/bin/env node
/**
 * skills/deploy/scripts/ai-readability.mjs — the AI-readability gate (#100, reference/ai-readability.md).
 *
 * Exact reimplementation of the formula Adobe's "AI Content Visibility Checker" uses (read from the
 * extension's analyzer, v3.1.0):  score = min(100, servedWords / renderedWords × 100), where served is
 * the page fetched with a ChatGPT-User UA and no JavaScript, rendered is the live DOM serialised as
 * textContent (hidden text counts), both sides stripped of script (JSON-LD kept as text), style,
 * template, media, cookie/consent containers and — by default — nav/header/footer landmarks.
 *
 * Per page it reports:
 *   strict     the checker's popup number (landmarks ignored) and the toggle-off variant
 *   code       strict with referenced fragment documents credited to the served side and the
 *              --exclude-blocks app blocks removed from the rendered side (what block code owns)
 *   servedGap  rendered words absent from the served HTML, attributed per block (metric 2:
 *              what a non-rendering crawler never reads — nav/footer fetch, fragments, index cards)
 *
 *   node skills/deploy/scripts/ai-readability.mjs --origin https://main--site--org.aem.live \
 *        [--paths file | /path …] [--min 98] [--token-env SITE_TOKEN | --auth-header "token …"] \
 *        [--exclude-blocks client-app,widget,form] [--allowlist file.json] [--json out.json] [--verbose]
 *
 * Exit 1 when any page's code score is below --min; 2 on infrastructure failure.
 * Allowlist: [{ "block": "location-finder", "string": "N locations", "reason": "…" }] — a runtime
 * value the block is allowed to generate; its words are removed from that block's servedGap and
 * from the code denominator. Entries name a block and a string, never a page.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHATGPT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
export const LANDMARKS = 'nav,header,footer,.nav,.navigation,.navbar,.nav-bar,.menu,.main-menu,.header,.site-header,.page-header,.footer,.site-footer,.page-footer,#nav,#navigation,#navbar,#header,#footer,#menu,[role="navigation"],[role="banner"],[role="contentinfo"],aside,[role="complementary"],[role="search"]';

/* -------------------------------------------------------------- in-page code -- */
/** Runs inside the page. Returns both scenarios, the code score and per-block attribution. */
export function analyse({ served, fragments, landmarks, excludeBlocks, allow }) {
  const tokens = (t) => t.replace(/\s+/g, ' ').replace(/\s*([,.!?;:])\s*/g, '$1 ').trim().split(/\s+/).filter(Boolean);
  const clean = (html, ignoreLandmarks, isServed) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script').forEach((s) => {
      if (s.type === 'application/ld+json' && s.textContent.trim()) {
        const pre = d.createElement('pre');
        try { pre.textContent = JSON.stringify(JSON.parse(s.textContent), null, 2); } catch { pre.textContent = s.textContent; }
        s.replaceWith(pre);
      } else s.remove();
    });
    d.querySelectorAll(isServed ? 'style,template' : 'noscript,style,template').forEach((e) => e.remove());
    d.querySelectorAll('img,video,audio,picture,svg,canvas,embed,object,iframe').forEach((e) => e.remove());
    d.querySelectorAll('[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"]').forEach((e) => {
      const t = e.textContent.toLowerCase();
      if (t.includes('cookie') || t.includes('consent') || t.includes('privacy')) e.remove();
    });
    if (ignoreLandmarks) d.querySelectorAll(landmarks).forEach((e) => e.remove());
    return d;
  };
  const current = `<!DOCTYPE html><html>${document.head.outerHTML}${document.body.outerHTML}</html>`;
  const ratio = (s, r) => (r > 0 ? Math.min(100, Math.round((s / r) * 100)) : 100);
  const scenario = (ignore) => {
    const s = tokens(clean(served, ignore, true).documentElement.textContent).length;
    const r = tokens(clean(current, ignore, false).documentElement.textContent).length;
    return { score: ratio(s, r), served: s, rendered: r, missing: Math.abs(r - s) };
  };
  const strict = scenario(true);
  const landmarksCounted = scenario(false);

  // per-block attribution on the rendered side (set-based: which words the served HTML never has).
  // Text nodes are joined with spaces (textContent glues adjacent elements into bogus tokens) and
  // script/style/template/noscript text is skipped — attribution only; the score above stays faithful.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
  const nodeText = (root) => {
    const out = []; const w = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (!SKIP.has(n.parentElement?.tagName)) out.push(n.textContent); }
    return out.join(' ');
  };
  const servedSet = new Set(tokens(nodeText(clean(served, false, true).documentElement).toLowerCase()));
  const allowByBlock = {};
  (allow || []).forEach((a) => { (allowByBlock[a.block] ||= []).push(...tokens(String(a.string || '').toLowerCase())); });
  const blocks = [];
  const regions = [];
  document.querySelectorAll('main .section > div').forEach((w) => {
    const b = w.querySelector(':scope > .block');
    const name = b ? (b.dataset.blockName || b.classList[0]) : 'default-content';
    regions.push({ name, el: w, variants: b ? [...b.classList].filter((c) => c !== 'block' && c !== name).join(' ') : '' });
  });
  const hd = document.querySelector('header'); if (hd) regions.push({ name: 'header', el: hd, variants: '' });
  const ft = document.querySelector('footer'); if (ft) regions.push({ name: 'footer', el: ft, variants: '' });
  let excludedWords = 0; let allowedWords = 0; let renderedMain = 0;
  regions.forEach(({ name, el, variants }) => {
    const ws = tokens(nodeText(el));
    const allowed = new Set(allowByBlock[name] || []);
    let gap = ws.filter((w) => !servedSet.has(w.toLowerCase()));
    const gapBefore = gap.length;
    gap = gap.filter((w) => !allowed.has(w.toLowerCase()));
    allowedWords += gapBefore - gap.length;
    const excluded = name !== 'header' && name !== 'footer' && (excludeBlocks || []).includes(name);
    if (excluded) excludedWords += ws.length;
    if (name !== 'header' && name !== 'footer') renderedMain += ws.length;
    blocks.push({ block: name, variants, words: ws.length, servedGap: gap.length, excluded, sample: [...new Set(gap)].slice(0, 12).join(' ') });
  });
  blocks.sort((a, b) => b.servedGap - a.servedGap);

  // code score: fragments credited to the served side, app blocks + allowlisted strings removed from the rendered side
  const fragmentWords = (fragments || []).reduce((n, html) => n + tokens(clean(html, true, true).documentElement.textContent).length, 0);
  const codeServed = strict.served + fragmentWords;
  const codeRendered = Math.max(0, strict.rendered - excludedWords - allowedWords);
  // fragmentsCostPts: strict points the page loses to runtime-fetched fragment copy — the owner's decision, surfaced per page
  const fragmentsCostPts = Math.max(0, ratio(strict.served + fragmentWords, strict.rendered) - strict.score);
  const code = { score: ratio(codeServed, codeRendered), served: codeServed, rendered: codeRendered, fragmentWords, fragmentsCostPts, excludedWords, allowedWords };

  const servedGapTotal = blocks.filter((b) => b.block !== 'header' && b.block !== 'footer').reduce((n, b) => n + b.servedGap, 0);
  return { strict, landmarksCounted, code, blocks, servedGap: { main: servedGapTotal, chrome: blocks.filter((b) => b.block === 'header' || b.block === 'footer').reduce((n, b) => n + b.servedGap, 0), renderedMain } };
}

/* ------------------------------------------------------------------ driver -- */
async function loadPlaywright() {
  const normalize = (m) => (m.chromium ? m : (m.default?.chromium ? m.default : null));
  for (const base of [join(process.cwd(), 'package.json'), join(process.cwd(), 'stardust', 'package.json')]) { // cwd, then stardust/node_modules (preflight-runtime.mjs)
    try { const mod = normalize(await import(pathToFileURL(createRequire(base).resolve('playwright')).href)); if (mod) return mod; } catch { /* next link */ }
  }
  try { const mod = normalize(await import('playwright')); if (mod) return mod; } catch { /* fall through */ }
  throw new Error('playwright not found — run node skills/stardust/scripts/preflight-runtime.mjs (master § Setup step 9)');
}

async function settle(page) {
  await page.waitForFunction(() => {
    const s = [...document.querySelectorAll('[data-section-status]')];
    return s.length === 0 || s.every((e) => e.dataset.sectionStatus === 'loaded');
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

/** Fragment documents the served page references (fragment links + fragment blocks), as plain HTML. */
async function fetchFragments(request, origin, served, headers) {
  const paths = new Set();
  for (const m of served.matchAll(/href="(\/fragments\/[^"#?]+)"/g)) paths.add(m[1]);
  const ok = []; const html = [];
  for (const p of paths) {
    try {
      const r = await request.get(`${origin}${p}.plain.html`, { headers, timeout: 15000 });
      if (r.ok()) { ok.push(p); html.push(await r.text()); }
    } catch { /* uncredited */ }
  }
  return { paths: ok, html };
}

export async function scorePage(context, origin, path, { excludeBlocks = [], allow = [], headers = {} } = {}) {
  const url = `${origin}${path}`;
  const page = await context.newPage();
  try {
    const servedRes = await context.request.get(url, { headers: { ...headers, 'user-agent': CHATGPT_UA, accept: 'text/html' }, timeout: 20000 });
    if (!servedRes.ok()) return { path, error: `served fetch HTTP ${servedRes.status()}` };
    const served = await servedRes.text();
    const frags = await fetchFragments(context.request, origin, served, headers);
    // fragments the page loads at runtime (metadata-enabled or block-driven, no link in the document)
    const runtime = new Map();
    page.on('response', async (res) => {
      const u = res.url();
      if (!u.startsWith(origin) || !/\/fragments\/[^?#]+\.plain\.html(\?|$)/.test(u) || !res.ok()) return;
      const fp = new URL(u).pathname.replace(/\.plain\.html$/, '');
      if (!frags.paths.includes(fp) && !runtime.has(fp)) { try { runtime.set(fp, await res.text()); } catch { /* skip */ } }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page);
    // chrome fragments (nav/header/footer/menu) are loaded by blocks the strict score strips — crediting them would inflate code
    const isChrome = (fp) => /(^|\/)(nav|header|footer|menu)[^/]*(\/|$)/i.test(fp);
    const credited = [...frags.paths.map((fp, i) => [fp, frags.html[i]]), ...runtime.entries()].filter(([fp, html]) => html && !isChrome(fp));
    const r = await page.evaluate(analyse, { served, fragments: credited.map(([, html]) => html), landmarks: LANDMARKS, excludeBlocks, allow });
    return { path, fragments: credited.map(([fp]) => fp), chromeFragments: [...frags.paths, ...runtime.keys()].filter(isChrome), ...r };
  } catch (e) {
    return { path, error: e.message.split('\n')[0] };
  } finally { await page.close(); }
}

/* --------------------------------------------------------------------- CLI -- */
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const has = (n) => { const i = args.indexOf(n); if (i >= 0) { args.splice(i, 1); return true; } return false; };
  const origin = (opt('--origin', '') || '').replace(/\/$/, '');
  const min = Number(opt('--min', '98'));
  const tokenEnv = opt('--token-env', null);
  const authHeader = opt('--auth-header', null) || (tokenEnv && process.env[tokenEnv] ? `token ${process.env[tokenEnv]}` : null);
  const excludeBlocks = (opt('--exclude-blocks', 'client-app,widget') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowFile = opt('--allowlist', null);
  const jsonOut = opt('--json', null);
  const pathsFile = opt('--paths', null);
  const verbose = has('--verbose');
  let paths = args.filter((a) => a.startsWith('/'));
  if (pathsFile && existsSync(pathsFile)) paths = paths.concat(readFileSync(pathsFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s.startsWith('/')));
  if (!origin || !paths.length) { console.error('usage: ai-readability.mjs --origin <published origin> [--paths file | /path …] [--min 98]'); process.exit(2); }
  const allow = allowFile && existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const headers = authHeader ? { authorization: authHeader } : {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: headers });
  const results = [];
  let fail = false;
  for (const p of paths) {
    const r = await scorePage(context, origin, p, { excludeBlocks, allow, headers });
    results.push(r);
    if (r.error) { console.log(`${p}\n  ERROR ${r.error}`); fail = true; continue; }
    const flag = r.code.score < min ? 'FAIL' : 'ok';
    console.log(`${p}\n  strict ${String(r.strict.score).padStart(3)}%  (served ${r.strict.served} / rendered ${r.strict.rendered}, missing ${r.strict.missing}; landmarks counted ${r.landmarksCounted.score}%)`
      + `\n  code   ${String(r.code.score).padStart(3)}%  ${flag}  (fragments credited +${r.code.fragmentWords} words = fragments cost ${r.code.fragmentsCostPts} pts${r.fragments.length ? ` [${r.fragments.join(' ')}]` : ''}, app blocks −${r.code.excludedWords}, allowlisted −${r.code.allowedWords})`
      + `\n  servedGap main ${r.servedGap.main} / ${r.servedGap.renderedMain} words, chrome ${r.servedGap.chrome}`);
    const rows = r.blocks.filter((b) => b.servedGap > 0 || b.excluded);
    (verbose ? rows : rows.slice(0, 5)).forEach((b) => console.log(`    ${String(b.servedGap).padStart(5)} / ${String(b.words).padStart(5)}  ${(b.block + (b.variants ? ` [${b.variants}]` : '')).padEnd(40)}${b.excluded ? ' (excluded)' : ''} ${b.sample}`));
    if (r.code.score < min) fail = true;
  }
  await browser.close();
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ origin, min, excludeBlocks, allowlist: allow, generatedAt: new Date().toISOString(), pages: results }, null, 2));
  const scored = results.filter((r) => !r.error);
  if (scored.length) console.log(`\n${scored.length} pages: strict min ${Math.min(...scored.map((r) => r.strict.score))}%, code min ${Math.min(...scored.map((r) => r.code.score))}% (gate ${min}%)`);
  process.exit(fail ? 1 : 0);
}
