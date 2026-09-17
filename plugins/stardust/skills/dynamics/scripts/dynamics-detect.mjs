#!/usr/bin/env node
/**
 * dynamics-detect.mjs — stardust:dynamics Phase 1 + 2 (detect, classify).
 *
 * Records, per probed page, everything the live page renders from JavaScript,
 * a service or a data source, then classifies each finding into the dynamic
 * classes (reference/classes-and-signals.md). Evidence only: no decision is
 * taken here. Output: `<out>/_dynamics.json` (+ `dynamic-features.generated.md`).
 *
 *   node dynamics-detect.mjs --urls <url,url,…> [--out stardust/current]
 *        [--from-state stardust/state.json]   one URL per page type + the home page, from extract's inventory
 *        [--reach stardust/current]           roll per-page `dynamic` sections (extract --dynamics) into feature reach
 *        [--settle 5000] [--width 1440] [--headed]
 *
 * Probes the SOURCE site. No auth header is sent (the source is public); the
 * target-host probe lives in dynamics-plan.mjs.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  arg, flag, list, readJSON, writeJSON, writeText, provenance, loadPlaywright, vendorFor, registrable, sameSite, pathPattern, settlePage, slug,
} from './lib.mjs';

const OUT = arg('out', 'stardust/current');
const SETTLE = Number(arg('settle', 5000));
const WIDTH = Number(arg('width', 1440));
let URLS = list(arg('urls', ''));
if (!URLS.length && arg('from-state')) {
  const st = readJSON(arg('from-state'));
  const byType = new Map();
  for (const p of st.pages || []) { const t = p.type || 'untyped'; if (!byType.has(t)) byType.set(t, p.url); }
  URLS = [...new Set([st.site?.url || st.site?.origin, ...byType.values()].filter(Boolean))];
}
if (!URLS.length) { console.error('usage: dynamics-detect.mjs --urls <url,…> | --from-state stardust/state.json [--out dir]'); process.exit(2); }

const CLASS_NAMES = { L: 'listing', S: 'search', F: 'form', M: 'modal / interactive', V: 'media', T: 'tag / consent', A: 'API / personalisation / settings', R: 'relationship', X: 'auth / commerce', I18N: 'locale', CR: 'client-rendered', D: 'sheet / data file' };
const API_PATH = /\/(api|graphql|ajax|json|search|autocomplete|typeahead|suggest|client\/|webservices|_next\/data|wp-json|\.rest|odata)/i;

/* ------------------------------------------------------ in-page capture -- */
function domCapture() {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const cn = (el) => (el.getAttribute && el.getAttribute('class')) || '';
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return h; } };
  const inChrome = (el) => !!el.closest('header, nav, footer, [role=navigation], [role=banner], [role=contentinfo], [class*="header" i], [class*="footer" i], [class*="cookie" i], [id*="onetrust" i]');
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };

  // forms — keyed on name + field signature, action optional (JS-wired forms have none)
  const forms = [...document.querySelectorAll('form')].map((f) => {
    const inputs = [...f.querySelectorAll('input, select, textarea')].filter((i) => !['hidden', 'submit', 'button', 'reset'].includes((i.type || '').toLowerCase()));
    const sig = inputs.map((i) => `${i.tagName === 'SELECT' ? 'select' : i.type || 'text'}:${i.name || i.id || ''}`).slice(0, 12);
    return {
      name: f.getAttribute('name') || f.id || cn(f).split(' ')[0] || '', action: f.getAttribute('action') ? abs(f.getAttribute('action')) : null,
      method: (f.getAttribute('method') || 'get').toLowerCase(), role: f.getAttribute('role') || '', inChrome: inChrome(f), fields: inputs.length, signature: sig,
      hidden: [...f.querySelectorAll('input[type=hidden]')].map((i) => i.name).filter(Boolean).slice(0, 12),
      tokens: [...f.querySelectorAll('input')].map((i) => i.name || '').filter((n) => /token|csrf|antibot|nonce|honeypot|captcha|verification/i.test(n)),
      search: f.getAttribute('role') === 'search' || !!f.querySelector('input[type=search], input[name="q"], input[name="s"], input[name*="query" i], input[name*="search" i]'),
      inlineHandler: !!(f.getAttribute('onsubmit') || f.querySelector('[onclick], [onsubmit]')),
    };
  });
  // form-less control groups (modern CMS front ends render forms without <form>)
  const loose = [...document.querySelectorAll('input, select, textarea')].filter((el) => !el.closest('form') && !inChrome(el) && !['hidden', 'submit', 'button', 'password'].includes((el.type || '').toLowerCase()) && vis(el));
  const groups = new Map();
  for (const el of loose) {
    const root = el.closest('section, article, [class*="form" i], [data-component], main > div, main') || document.body;
    const key = root === document.body ? 'body' : `${root.tagName.toLowerCase()}.${cn(root).split(' ')[0]}`;
    if (!groups.has(key)) groups.set(key, { container: key, controls: 0, names: [], submit: null });
    const g = groups.get(key); g.controls += 1; if (el.name && g.names.length < 12) g.names.push(el.name);
    if (!g.submit) { const b = [...root.querySelectorAll('button, [role=button], input[type=submit]')].find((x) => /submit|send|continue|enquir|subscribe|sign ?up|request|apply|pay|search/i.test(norm(x.textContent) || x.value || '')); if (b) g.submit = norm(b.textContent) || b.value; }
  }
  const controlGroups = [...groups.values()].filter((g) => g.controls >= 2);

  // trigger → dialog → content graph
  const dialogs = [...document.querySelectorAll('dialog, [role=dialog], [aria-modal=true], [class*="modal" i]:not(a):not(button):not(script)')];
  const contentSig = (t) => t && { role: t.getAttribute('role') || t.tagName.toLowerCase(), heading: norm(t.querySelector('h1,h2,h3,[class*="title" i]')?.textContent).slice(0, 80), textLen: norm(t.textContent).length, hasForm: !!t.querySelector('form, input, select, textarea'), hasIframe: !!t.querySelector('iframe'), hasVideo: !!t.querySelector('video, video-js, [data-video-id], iframe[src*="player" i]') };
  const triggers = [...document.querySelectorAll('a, button, [role=button]')].filter((el) => !/close|dismiss|vjs-|carousel|slider/i.test(cn(el) + (el.getAttribute('aria-label') || ''))).map((el) => {
    const attrs = [...el.attributes].map((a) => a.name);
    const marker = (cn(el).match(/[\w-]*(modal|dialog|lightbox|popup|overlay)[\w-]*/i) || [])[0] || attrs.find((n) => /modal|dialog|lightbox|popup|micromodal/i.test(n)) || (el.getAttribute('aria-haspopup') === 'dialog' ? 'aria-haspopup=dialog' : null);
    const byId = attrs.map((n) => el.getAttribute(n)).find((v) => v && /^[\w-]+$/.test(v) && document.getElementById(v));
    const controls = (el.getAttribute('aria-controls') && document.getElementById(el.getAttribute('aria-controls'))) || (byId && document.getElementById(byId));
    const controlsDialog = controls && (controls.getAttribute('role') === 'dialog' || controls.tagName === 'DIALOG');
    if (!marker && !controlsDialog) return null;
    const titleAttr = attrs.find((n) => /title/i.test(n) && /modal|dialog/i.test(n));
    return { text: norm(el.textContent).slice(0, 60), href: el.getAttribute('href') ? abs(el.getAttribute('href')) : null, marker: marker || 'aria-controls→dialog', inChrome: inChrome(el), titleOnTrigger: titleAttr ? el.getAttribute(titleAttr).slice(0, 80) : null, target: contentSig(controls || (el.getAttribute('data-target') && document.querySelector(el.getAttribute('data-target'))) || null) };
  }).filter(Boolean).slice(0, 40);
  const dialogSigs = dialogs.map(contentSig).filter((d) => d && d.textLen > 0).slice(0, 12);

  // media players + ids (ids live only in the live DOM)
  const media = [...document.querySelectorAll('video, audio, video-js, iframe, [data-video-id], [data-account], [data-player], a[href*="player" i]')].map((el) => ({
    tag: el.tagName.toLowerCase(), src: (el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data-src') || '').slice(0, 200), account: el.getAttribute('data-account'), player: el.getAttribute('data-player'), videoId: el.getAttribute('data-video-id') || el.getAttribute('data-videoid'), inDialog: !!el.closest('dialog, [role=dialog], [class*="modal" i]'),
  })).filter((m) => m.src || m.videoId);
  // iframes: a missing src means a runtime-injected embed
  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.getAttribute('src') || null, title: f.getAttribute('title') || null, w: f.getBoundingClientRect().width | 0, h: f.getBoundingClientRect().height | 0 }));
  // tag-manager-proxied third parties: mount divs with vendor config attributes, zero script tags
  const mounts = [...document.querySelectorAll('[data-businessunit-id], [data-template-id], [data-widget-id], [class*="widget" i], [data-pr-component], [data-bv-show], [id^="hs-"], [data-hs-forms-root], [id*="mkto" i], [class*="embed" i][data-src]')]
    .filter((el) => !inChrome(el) && [...el.attributes].some((a) => a.name.startsWith('data-')))
    .map((el) => ({ cls: cn(el).split(' ').slice(0, 2).join(' '), attrs: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 6) })).slice(0, 20);

  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => abs(a.getAttribute('href')));
  const auth = hrefs.filter((h) => /login|sign-?in|signin|account|register|logout|b2clogin|oauth|sso|myaccount/i.test(h)).slice(0, 8);
  const commerce = { cart: !!document.querySelector('[class*="cart" i], [href*="/cart"], [href*="checkout"]'), prices: (document.body.innerText.match(/[£$€]\s?\d[\d,.]*/g) || []).length };
  const locale = { lang: document.documentElement.lang || null, hreflang: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => l.getAttribute('hreflang')), switcher: hrefs.filter((h) => { try { const p = new URL(h).pathname; return /^\/(?:[a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i.test(p) && !location.pathname.startsWith(p.split('/').slice(0, 2).join('/')); } catch { return false; } }).slice(0, 5) };
  const cms = {}; for (const k of ['drupalSettings', 'wp', 'wpApiSettings', 'Shopify', 'Sitecore', 'digitalData', 'dataLayer', 'adobeDataLayer', 'utag_data', 'appConfig', '__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', 'Granite', 'CQ']) { try { if (window[k] !== undefined) cms[k] = window[k] && typeof window[k] === 'object' ? Object.keys(window[k]).slice(0, 30) : typeof window[k]; } catch { /* cross-origin getter */ } }
  const framework = document.querySelector('#__next') ? 'next' : document.querySelector('#___gatsby') ? 'gatsby' : document.querySelector('#__nuxt') ? 'nuxt' : document.querySelector('[data-reactroot], [data-react-helmet]') ? 'react' : document.querySelector('[data-v-app], [data-server-rendered]') ? 'vue' : document.querySelector('[ng-version]') ? 'angular' : document.querySelector('[data-sveltekit-preload-data]') ? 'sveltekit' : document.querySelector('astro-island') ? 'astro' : null;
  const globals = ['adobe', '_satellite', 'OneTrust', 'Optanon', 'google_tag_manager', 'gtag', 'Munchkin', 'videojs', 'bc', 'YT', 'Vimeo', 'Intercom', 'drift', 'zE', 'hj', 'clarity', 'optimizely', 'utag', 'dtrum', 'Drupal', 'Shopify', 'algoliasearch', 'grecaptcha', 'hbspt', 'MktoForms2', 'Trustpilot'].filter((g) => { try { return window[g] !== undefined; } catch { return false; } });
  const clientRendered = [...document.querySelectorAll('[class*="placeholder" i], [class*="skeleton" i], [class*="js-" i], [data-lazy], [data-load], [data-src-url], [data-endpoint], [data-api], [data-url], [data-component]')].filter((el) => el.children.length && norm(el.textContent).length > 20 && !inChrome(el)).map((el) => ({ cls: cn(el).split(' ').slice(0, 3).join(' '), attrs: [...el.attributes].filter((a) => /^data-(endpoint|api|url|src-url|load|lazy|params|component)/.test(a.name)).map((a) => `${a.name}=${a.value.slice(0, 60)}`), text: norm(el.textContent).slice(0, 60) })).slice(0, 12);
  const listingCandidates = [...document.querySelectorAll('main ul, main ol, main div, main section')].filter((c) => !inChrome(c)).map((c) => { const kids = [...c.children]; if (kids.length < 3) return null; const cards = kids.map((k) => k.querySelector('a[href]')).filter(Boolean); if (cards.length < 3 || cards.length !== kids.length) return null; const same = cards.filter((a) => abs(a.getAttribute('href')).startsWith(location.origin)).length; if (same < 3) return null; return { cls: cn(c).split(' ').slice(0, 2).join(' ') || c.tagName.toLowerCase(), cards: kids.length, sameSite: same, hasDate: /\b(20\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(c.textContent) }; }).filter(Boolean).slice(0, 10);
  // client-compute signature: inline script + controls + (network judged outside)
  const inline = [...document.querySelectorAll('script:not([src])')].filter((s) => !/json/i.test(s.type || ''));
  const inlineScripts = inline.length;
  const inlineFetch = inline.some((s) => /fetch\(|XMLHttpRequest|\.ajax\(|axios|sendBeacon/.test(s.textContent || ''));
  const mainText = norm(document.querySelector('main')?.innerText || document.body.innerText).length;
  return { title: document.title, forms, controlGroups, triggers, dialogs: dialogSigs, dialogCount: dialogs.length, media, iframes, mounts, auth, commerce, locale, cms, framework, globals, clientRendered, listingCandidates, inlineScripts, inlineFetch, mainText, domAddedAfterLoad: window.__sdDomAfterLoad || 0 };
}

/* ------------------------------------------------------------ classify -- */
function classify(page, path, add) {
  const host = page.host;
  const firstParty = (h) => sameSite(h, host);
  // third-party hosts (from any request), by vendor role
  for (const h of Object.keys(page.hosts)) {
    if (!h || h === host) continue;
    const v = vendorFor(h) || vendorFor(page.scripts.find((s) => s.includes(h)) || '');
    if (v && v.class === '-') continue;
    if (firstParty(h)) { if (v && v.class === 'T') add({ class: 'T', feature: `${v.role} (first-party subdomain — needs a CNAME on the new host)`, page: path, evidence: [h], hint: 'tags' }); continue; }
    const xhr = page.thirdPartyXhr.some((x) => x.includes(h));
    if (v) add({ class: v.class, feature: v.role, role: v.role, page: path, evidence: [h], hint: v.class === 'T' ? 'tags' : v.class === 'F' ? 'forms' : v.class === 'V' ? 'media' : v.class === 'S' ? 'search' : v.class === 'X' ? 'decided-out' : 'inspect' });
    else add({ class: xhr ? 'A' : 'T', feature: `unknown third-party host ${h}`, page: path, evidence: [h], hint: 'inspect' });
  }
  for (const a of page.firstPartyApi) {
    if (!API_PATH.test(a.path) && a.contentType !== 'application/json') continue;
    const isSearch = /search|autocomplete|typeahead|suggest/i.test(a.path);
    const isData = /\.json$/.test(a.path) && a.method === 'GET' && !API_PATH.test(a.path.replace(/\.json$/, ''));
    add({ class: isSearch ? 'S' : isData ? 'D' : 'A', feature: `first-party ${isData ? 'data file' : 'API'} ${a.method} ${a.path}`, page: path, evidence: [`${a.method} ${a.path}${a.query.length ? `?${a.query.join(',')}` : ''} → ${a.status}`], api: { method: a.method, path: a.path }, hint: isSearch ? 'search' : isData ? 'data' : 'api' });
  }
  for (const f of page.forms) {
    if (f.search) { add({ class: 'S', feature: `site search form → ${f.action ? new URL(f.action).pathname : '(JS-submitted)'}`, page: path, evidence: [f.signature.join(',')], hint: 'search' }); continue; }
    if (f.fields === 0) continue;
    const target = f.action ? (firstParty(new URL(f.action).host) ? `origin ${new URL(f.action).pathname}` : `third-party ${new URL(f.action).host}`) : 'no action (JS-wired)';
    add({ class: 'F', feature: `form "${f.name || f.signature.slice(0, 2).join('+')}" → ${target} (${f.fields} fields${f.tokens.length ? `, tokens: ${f.tokens.join(',')}` : ''})`, page: path, evidence: [f.signature.join(','), f.hidden.join(',')].filter(Boolean), signature: f.signature, hint: !f.action && !page.inlineFetch && page.inlineScripts > 0 ? 'client-compute?' : 'forms' });
  }
  for (const g of page.controlGroups) add({ class: 'F', feature: `form-less control group in ${g.container} (${g.controls} controls${g.submit ? `, submit "${g.submit}"` : ''})`, page: path, evidence: [g.names.join(',')].filter(Boolean), hint: !page.inlineFetch && page.inlineScripts > 0 ? 'client-compute?' : 'forms' });
  const byMarker = new Map();
  for (const t of page.triggers) { const k = t.marker; const row = byMarker.get(k) || { n: 0, ex: [], targets: new Set(), titles: 0, chrome: 0 }; row.n += 1; if (row.ex.length < 4) row.ex.push(t.href || t.text); if (t.target) row.targets.add(`${t.target.role}:${t.target.hasForm ? 'form' : t.target.hasVideo ? 'video' : t.target.hasIframe ? 'iframe' : 'content'}`); if (t.titleOnTrigger) row.titles += 1; if (t.inChrome) row.chrome += 1; byMarker.set(k, row); }
  for (const [marker, r] of byMarker) add({ class: 'M', feature: `modal trigger ${marker}${r.chrome === r.n ? ' (chrome only)' : ''} → ${[...r.targets].join('/') || 'target outside DOM at capture'}`, page: path, evidence: [...r.ex, r.titles ? `${r.titles} triggers carry the title (data-*title)` : null].filter(Boolean), hint: r.chrome === r.n ? 'chrome-interaction' : 'modal' });
  for (const m of page.media) { const v = vendorFor(m.src || ''); if ((v && v.class === 'V') || m.videoId || m.tag === 'video-js') add({ class: 'V', feature: v ? v.role : `player element <${m.tag}>${m.inDialog ? ' in a dialog' : ''}`, page: path, evidence: [m.videoId ? `${m.account || '?'}/${m.player || 'default'}/${m.videoId}` : m.src], hint: 'media' }); }
  for (const f of page.iframes) if (!f.src) add({ class: 'V', feature: 'iframe without src (runtime-injected embed)', page: path, evidence: [f.title || `${f.w}×${f.h}`], hint: 'embed-runtime' });
  for (const mnt of page.mounts) add({ class: 'T', feature: `third-party mount <div ${mnt.attrs[0] || mnt.cls}> (tag-manager-injected widget)`, page: path, evidence: [mnt.attrs.join(' ') || mnt.cls], hint: 'tags' });
  if (page.auth.length) add({ class: 'X', feature: 'sign-in / account links', page: path, evidence: page.auth.slice(0, 4), hint: 'decided-out' });
  if (page.commerce.cart || page.commerce.prices > 8) add({ class: 'X', feature: `commerce signals (cart: ${page.commerce.cart}, prices: ${page.commerce.prices})`, page: path, hint: 'decided-out' });
  if (page.locale.hreflang.length || page.locale.switcher.length) add({ class: 'I18N', feature: `locale variants ${page.locale.hreflang.join(',') || page.locale.switcher.map((h) => new URL(h).pathname.split('/')[1]).join(',')}`, page: path, evidence: page.locale.switcher.slice(0, 3), hint: 'locale' });
  for (const c of page.clientRendered) add({ class: 'CR', feature: `client-rendered slot ${c.cls}`, page: path, evidence: c.attrs.length ? c.attrs : [c.text], hint: 'client-rendered' });
  if (page.mainEmptyAtLoad) add({ class: 'CR', feature: 'main empty at load, filled after (client-rendered page)', page: path, evidence: [`text at load ${page.textAtLoad} → settled ${page.mainText}`], hint: 'client-rendered-page' });
  for (const l of page.listingCandidates.filter((x) => x.hasDate || x.cards >= 6)) add({ class: 'L', feature: `listing candidate ${l.cls} (${l.cards} cards)`, page: path, hint: 'listings' });
  for (const [k, keys] of Object.entries(page.cms)) if (Array.isArray(keys)) { const named = keys.filter((x) => /endpoint|api|url|marketo|eloqua|hubspot|antibot|search|campaign|schema|ddl|analytics|consent|token|form/i.test(x)); add({ class: 'A', feature: `CMS / app settings object ${k}`, page: path, evidence: named.slice(0, 8), hint: 'settings' }); }
  if (page.framework) add({ class: 'CR', feature: `client framework ${page.framework}`, page: path, hint: 'framework' });
}

/* ---------------------------------------------------------------- main -- */
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: !flag('headed'), args: ['--disable-blink-features=AutomationControlled'] });
const report = { _provenance: provenance('detect', { settleMs: SETTLE, width: WIDTH, urls: URLS }), pages: {}, findings: [] };
const findingsByKey = new Map();
const add = (f) => {
  const key = `${f.class}|${f.feature}`;
  let x = findingsByKey.get(key);
  if (!x) { x = { id: slug(`${f.class}-${f.feature}`), class: f.class, feature: f.feature, role: f.role, api: f.api, signature: f.signature, hint: f.hint, evidence: [], pages: [] }; findingsByKey.set(key, x); report.findings.push(x); }
  if (!x.pages.includes(f.page)) x.pages.push(f.page);
  if (f.evidence) x.evidence = [...new Set([...x.evidence, ...f.evidence.filter(Boolean)])].slice(0, 12);
};

for (const url of URLS) {
  const { host, origin } = new URL(url);
  const path = new URL(url).pathname || '/';
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(() => { window.__sdDomAfterLoad = 0; let loaded = false; window.addEventListener('load', () => setTimeout(() => { loaded = true; }, 300)); document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { if (loaded) for (const m of ms) window.__sdDomAfterLoad += m.addedNodes.length; }).observe(document.documentElement, { childList: true, subtree: true })); });
  const page = await ctx.newPage();
  const hosts = {}; const scripts = new Set(); const firstPartyApi = new Map(); const thirdPartyXhr = new Set(); const postBodies = [];
  page.on('request', (r) => { if (r.method() === 'POST' && ['xhr', 'fetch'].includes(r.resourceType()) && postBodies.length < 12) postBodies.push({ url: r.url().slice(0, 200), body: (r.postData() || '').slice(0, 400) }); });
  page.on('response', (resp) => {
    try {
      const req = resp.request(); const u = new URL(resp.url()); const type = req.resourceType();
      if (!/^https?:$/.test(u.protocol)) return;
      hosts[u.host] = (hosts[u.host] || 0) + 1;
      if (type === 'script') scripts.add(resp.url().slice(0, 200));
      const ct = (resp.headers()['content-type'] || '').split(';')[0].trim();
      const dataLike = ['xhr', 'fetch', 'eventsource'].includes(type) || /json|graphql/.test(ct);
      if (!dataLike || type === 'document') return;
      if (sameSite(u.host, host)) { const key = `${req.method()} ${u.host}${pathPattern(u.pathname)}`; if (!firstPartyApi.has(key)) firstPartyApi.set(key, { method: req.method(), host: u.host, path: pathPattern(u.pathname), query: [...new Set([...u.searchParams.keys()])].sort(), status: resp.status(), contentType: ct, example: `${u.origin}${u.pathname}` }); } else thirdPartyXhr.add(`${req.method()} ${u.host}${u.pathname.slice(0, 80)}`);
    } catch { /* evidence only */ }
  });
  let status = 0; let textAtLoad = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    status = resp?.status() || 0;
    textAtLoad = await page.evaluate(() => (document.querySelector('main') || document.body)?.innerText.replace(/\s+/g, ' ').trim().length || 0);
    await settlePage(page, { settleMs: SETTLE });
  } catch (e) { report.pages[path] = { url, error: String(e.message).slice(0, 160) }; console.error(`[dynamics] FAIL ${path} ${e.message.slice(0, 100)}`); await ctx.close(); continue; }
  const dom = await page.evaluate(domCapture);
  const pageRec = {
    url, status, host, ...dom, hosts, thirdPartyHosts: Object.keys(hosts).filter((h) => h && !sameSite(h, host)), scripts: [...scripts].slice(0, 60),
    firstPartyApi: [...firstPartyApi.values()], thirdPartyXhr: [...thirdPartyXhr].slice(0, 40), postBodies, textAtLoad, mainEmptyAtLoad: textAtLoad < 200 && dom.mainText > 600,
  };
  report.pages[path] = pageRec;
  classify(pageRec, path, add);
  console.error(`[dynamics] ${status} ${path} · 3rd-party hosts ${pageRec.thirdPartyHosts.length} · 1st-party api ${pageRec.firstPartyApi.length} · forms ${dom.forms.length}+${dom.controlGroups.length} · triggers ${dom.triggers.length} · media ${dom.media.length} · client-rendered ${dom.clientRendered.length}${pageRec.mainEmptyAtLoad ? ' · MAIN-EMPTY-AT-LOAD' : ''}`);
  await ctx.close();
}
await browser.close().catch(() => {});

/* --------------------------------------------- reach from extract pages -- */
if (arg('reach') && arg('reach') !== true) {
  const dir = join(arg('reach'), 'pages');
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let withDyn = 0; const endpointPages = new Map(); const searchPages = new Set(); const formPages = new Set(); const triggerPages = new Map();
    for (const f of files) {
      const rec = readJSON(join(dir, f), {}); const d = rec.dynamic; if (!d) continue; withDyn += 1;
      for (const e of d.endpoints || []) { const k = `${e.method} ${e.host}${e.path}`; endpointPages.set(k, (endpointPages.get(k) || 0) + 1); }
      if ((d.summary?.searchForms || 0) > 0) searchPages.add(rec.slug);
      if ((d.forms || []).some((x) => !x.search)) formPages.add(rec.slug);
      for (const t of d.triggers || []) triggerPages.set(t.marker, (triggerPages.get(t.marker) || 0) + 1);
    }
    report.reach = { pagesWithEvidence: withDyn, of: files.length, endpoints: Object.fromEntries(endpointPages), searchFormPages: searchPages.size, formPages: formPages.size, triggerPages: Object.fromEntries(triggerPages) };
    for (const fnd of report.findings) {
      if (fnd.api) { const n = [...endpointPages.entries()].filter(([k]) => k.startsWith(`${fnd.api.method} `) && k.endsWith(fnd.api.path)).reduce((sum, [, v]) => sum + v, 0); if (n) fnd.reach = { pages: n, of: files.length }; }
      if (fnd.class === 'S' && /site search form/.test(fnd.feature)) fnd.reach = { pages: searchPages.size, of: files.length };
      if (fnd.class === 'M') { const marker = (fnd.feature.match(/modal trigger (\S+)/) || [])[1]; if (marker && triggerPages.has(marker)) fnd.reach = { pages: triggerPages.get(marker), of: files.length }; }
    }
    report._provenance.reachSource = dir;
  }
}

/* -------------------------------------------------------------- output -- */
report.findings.sort((a, b) => a.class.localeCompare(b.class) || b.pages.length - a.pages.length);
writeJSON(join(OUT, '_dynamics.json'), report);
const md = [
  `# Dynamic features — detected (${report._provenance.writtenAt})`, '',
  `Pages probed: ${Object.keys(report.pages).join(', ')} · settle ${SETTLE} ms · width ${WIDTH}${report.reach ? ` · reach from ${report.reach.pagesWithEvidence}/${report.reach.of} crawled pages` : ''}`, '',
  'Evidence only. Every row must receive a disposition in `stardust/dynamic-features.md` (`dynamics-plan.mjs` drafts it).', '',
  '| id | class | feature | pages | reach | evidence | hint |', '|---|---|---|---|---|---|---|',
  ...report.findings.map((f) => `| ${f.id} | ${f.class} ${CLASS_NAMES[f.class] || ''} | ${f.feature.replace(/\|/g, '/')} | ${f.pages.length}/${Object.keys(report.pages).length} | ${f.reach ? `${f.reach.pages}/${f.reach.of}` : ''} | ${(f.evidence || []).slice(0, 3).join('<br>').replace(/\|/g, '/')} | ${f.hint || ''} |`),
];
writeText(join(OUT, 'dynamic-features.generated.md'), md.join('\n'));
console.error(`[dynamics] ${report.findings.length} findings → ${join(OUT, '_dynamics.json')}, dynamic-features.generated.md`);
setTimeout(() => process.exit(0), 200).unref();
