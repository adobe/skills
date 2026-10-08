#!/usr/bin/env node
/**
 * spec-capture.mjs — S6 + S8 visuals: for representative pages, a full-page JPEG plus one clipped JPEG per
 * component box, keyed by the same path ids as spec-parse. The tagger runs the parser's own rules in the page:
 * the path → element map is recorded at DOMContentLoaded (the server structure), and at measure time an element a
 * page script replaced falls back to the same path in the current DOM. A grid row's box is the union of its columns.
 * One browser, two tabs, third-party tag hosts blocked (they dominate load time, not layout).
 *
 *   node spec-capture.mjs [--config spec.config.json] [--urls <file>] [--out <dir>] [--width 1440] [--tabs 2] [--from-cache]
 *
 * When S2 needed the headed tier (fetch/technique.json), the browser is the diff skill's live-session stealth
 * real Chrome too. Pages S2 could not read plainly (source: headed or archive), or every page with --from-cache,
 * render from the HTML S2 kept: the page's own navigation is answered from the cache, its assets load live. A page
 * that still shows a bot challenge is recorded as an error, never captured as the page.
 * Default --urls: <dir>/judgement/capture-urls.txt (spec-pick writes it); default --out: <dir>/media.
 * Writes <out>/<key>/page.jpg, <out>/<key>/<path>.jpg, <out>/<key>/boxes.json. Skips keys already captured.
 * Needs playwright in the project.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { arg, componentLayout, flag, genericRules, groupRows, helpAndExit, loadConfig, loadLiveSession, loadPlaywright, log, profileRules, readJSON, readJSONL, urlKey } from './lib.mjs';

helpAndExit(import.meta.url);

const BLOCK = /adobedtm|demdex|omtrdc|doubleclick|googlesyndication|google-analytics|googletagmanager|facebook|linkedin|licdn|mathtag|smtrk|contextweb|dpmsrv|cookielaw|onetrust|munchkin|marketo|hotjar|bing|twitter|adsrvr|rlcdn|everesttech|feroot|zdassets|criteo|taboola|outbrain/;
const HIDE_CSS = '#onetrust-consent-sdk,#onetrust-banner-sdk,.onetrust-pc-dark-filter,.modal-backdrop,[class*="cookie-banner"],[id*="cookie-banner"]{display:none!important}body.modal-open{overflow:auto!important}';

/**
 * In-page tagger: spec-parse's profile rules and component layout (lib.mjs profileRules, componentLayout, injected
 * with their helpers), over a DOM adapter, so both find the same components under the same path ids.
 */
function tagger({ profile, mainSel, nameAttrs, stripPrefix }) {
  const RAW = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const MEDIA = 'img,picture,video,iframe,form,input,select,textarea,canvas,object,embed';
  const weight = (el) => {
    if (el.matches(MEDIA) || el.querySelector(MEDIA)) return 1;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim() && !RAW.has(n.parentNode.nodeName)) return 1;
    return 0;
  };
  const A = { tag: (el) => el.tagName.toLowerCase(), cls: (el) => [...(el.classList || [])], attr: (el, a) => el.getAttribute(a), kids: (el) => [...el.children], parent: (el) => el.parentElement, weight };
  const R = profileRules(profile, A, { nameAttrs, stripPrefix }); // eslint-disable-line no-undef -- injected with the tagger
  // assign(main) → { els: Map(path → element), rows: { rowPath: [memberPaths] } } on the DOM as it is now
  const assign = (main) => {
    const els = new Map(); const rows = {};
    const visit = (n) => {
      if (n.row) { rows[n.p] = n.members.map((m) => m.p); n.members.forEach(visit); return; }
      els.set(n.p, n.el); (n.kids || []).forEach(visit); (n.cols || []).forEach((col) => col.forEach(visit));
    };
    componentLayout(main, R, A, main === document.body).forEach(visit); // eslint-disable-line no-undef
    return { els, rows };
  };
  const findMain = () => {
    const list = mainSel ? mainSel.split(',').map((x) => x.trim()) : ['main', '[role=main]', '#main', '#content', '#main-content', 'article'];
    return list.map((x) => document.querySelector(x)).find(Boolean) || (mainSel ? null : document.body);
  };
  // the server structure is what spec-parse saw: record it at DOMContentLoaded, before page scripts re-render
  document.addEventListener('DOMContentLoaded', () => { const m = findMain(); if (m) window.__specDCL = assign(m); }, { once: true, capture: true });
  // at measure time: keep DOMContentLoaded elements still in the page, fall back to the same path in today's DOM
  window.__specMeasure = () => {
    const m = findMain(); const dcl = window.__specDCL || { els: new Map(), rows: {} };
    const now = m ? assign(m) : { els: new Map(), rows: {} };
    const boxes = {};
    const paths = new Set([...dcl.els.keys()]);
    for (const p of paths) {
      const el = dcl.els.get(p).isConnected ? dcl.els.get(p) : now.els.get(p);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      boxes[p] = { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return { boxes, rows: { ...now.rows, ...dcl.rows }, height: document.documentElement.scrollHeight };
  };
}

/** Union box of member boxes (grid rows). Pure. */
export function unionBox(boxes) {
  const b = boxes.filter(Boolean); if (!b.length) return null;
  const x = Math.min(...b.map((r) => r.x)); const y = Math.min(...b.map((r) => r.y));
  return { x, y, w: Math.max(...b.map((r) => r.x + r.w)) - x, h: Math.max(...b.map((r) => r.y + r.h)) - y };
}

async function main() {
  const cfg = loadConfig();
  const src = arg('urls', cfg.p('judgement', 'capture-urls.txt'));
  const out = arg('out', cfg.p('media'));
  const width = Number(arg('width', 1440));
  const urls = readFileSync(src, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const { chromium } = await loadPlaywright();
  const headed = readJSON(cfg.p('fetch', 'technique.json'), {}).technique === 'headed';
  const ls = headed ? await loadLiveSession() : null;
  const browser = headed ? await ls.launchStealthHeaded(chromium) : await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = headed ? await ls.newLiveContext(browser, { viewport: { width, height: 900 }, deviceScaleFactor: 1 }) : await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  if (headed) log(`headed tier (${ls.browserTier(browser)}), as S2`);
  const args = { profile: cfg.parser.profile, mainSel: cfg.parser.main || null, nameAttrs: cfg.parser.nameAttrs || [], stripPrefix: cfg.parser.stripPrefix || null };
  // one closure: the shared rules and the tagger, nothing added to the page's globals but the two __spec hooks
  await ctx.addInitScript({ content: `(() => {\n${[genericRules, groupRows, profileRules, componentLayout].map(String).join('\n')}\n(${tagger})(${JSON.stringify(args)});\n})();` });
  await ctx.route('**/*', (route) => { let h = ''; try { h = new URL(route.request().url()).hostname; } catch { /* keep */ } return BLOCK.test(h) ? route.abort() : route.fallback(); }); // fallback: live-session's document headers still apply
  // S2's rows (sitemap and discovered pages): which pages render from the cached HTML
  const rows = [cfg.p('fetch', 'fetch.jsonl'), cfg.p('links', 'pages.jsonl')].filter((f) => existsSync(f)).flatMap((f) => readJSONL(f));
  const cached = new Map(rows.filter((r) => r.html_key && (flag('from-cache') || (r.source && r.source !== 'live'))).map((r) => [r.url, r.html_key]));
  const htmlDir = cfg.p('fetch', 'html');
  const queue = urls.filter((u) => !existsSync(join(out, urlKey(u), 'boxes.json')));
  log(`${urls.length} urls, ${queue.length} to capture`);
  let n = 0;
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift(); const key = urlKey(url); const dir = join(out, key);
      mkdirSync(dir, { recursive: true });
      const page = await ctx.newPage();
      try {
        const hk = cached.get(url); const file = hk && join(htmlDir, `${hk}.html.gz`);
        if (file && existsSync(file)) {
          let served = false;
          await page.route('**/*', (route) => {
            const req = route.request();
            if (!served && req.isNavigationRequest() && req.frame() === page.mainFrame()) { served = true; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: gunzipSync(readFileSync(file)).toString('utf8') }); }
            return route.fallback();
          });
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
        if (await page.evaluate(() => /Just a moment|Verify you are human|Attention Required|challenge-platform/i.test(document.title + document.body.innerText.slice(0, 2000) + [...document.scripts].map((x) => x.src).join(' ')))) throw new Error('bot challenge: page not captured');
        await page.addStyleTag({ content: HIDE_CSS });
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 100); }); } window.scrollTo(0, 0); });
        await page.waitForTimeout(1200);
        const data = await page.evaluate(() => (window.__specMeasure ? window.__specMeasure() : { boxes: {}, rows: {}, height: document.documentElement.scrollHeight }));
        for (const [p, members] of Object.entries(data.rows)) data.boxes[p] = unionBox(members.map((m) => data.boxes[m]));
        const H = Math.min(data.height, 16000);
        await page.screenshot({ path: join(dir, 'page.jpg'), fullPage: true, type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width, height: H } });
        for (const [p, b] of Object.entries(data.boxes)) {
          if (!b || b.h < 24 || b.w < 24 || b.y >= H) continue;
          const clip = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.w, width - Math.max(0, b.x)), height: Math.min(b.h, 2400, H - b.y) };
          if (clip.width < 24 || clip.height < 24) continue;
          await page.screenshot({ path: join(dir, `${p}.jpg`), fullPage: true, type: 'jpeg', quality: 70, clip });
        }
        writeFileSync(join(dir, 'boxes.json'), JSON.stringify({ url, ...data }));
      } catch (e) {
        writeFileSync(join(dir, 'boxes.json'), JSON.stringify({ url, error: String(e).slice(0, 300) }));
      }
      await page.close();
      n += 1; if (n % 10 === 0) log(`${n} captured`);
    }
  };
  await Promise.all(Array.from({ length: Number(arg('tabs', 2)) }, worker));
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
