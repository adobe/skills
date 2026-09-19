#!/usr/bin/env node
/**
 * dynamics-check.mjs — stardust:dynamics Phase 5: replay the dynamic parity
 * checks against the published origin. Read-only. Flows, not presence: a check
 * passes when the user-visible flow completes (a query returns a known answer, an
 * empty submission is refused and a filled one reaches the endpoint, a player
 * actually plays), never because a block rendered.
 *
 * Input: `stardust/dynamics/parity.json` (reference/parity-report.md) — per feature
 * a `checks[]` list from the closed set below. Output: `stardust/qa/dynamics-report.md`
 * + `.json`. Also exported as `replay()` for the qa `dynamics` check.
 *
 *   node dynamics-check.mjs --origin https://main--site--org.aem.live [--parity stardust/dynamics/parity.json]
 *        [--out stardust/qa] [--auth-header "token …" | --token-env SITE_TOKEN] [--headed[=window]] [--gate]
 *
 * Exit: 0 all replays pass · 1 a replay failed · 2 usage · 3 `--gate` blocked — the close-out condition
 * (reference/parity-report.md rule 8 lists the blocking rows; `gate()` below is the implementation and
 * test/gate.test.mjs the fixture). The report always ends with "Delivered / interim / decided-out" counts
 * and "Values the owner must supply" (feature · `owner`), from the parity rows.
 *
 * Check types (* = required):
 *   fetch-json     { url*, minRows?, expectKeys? }                 GET on the origin returns JSON with rows / keys
 *   dom-count      { path*, selector*, min* }                      ≥ min elements after settle
 *   click-dialog   { path*, trigger*, headingIncludes?, minWidth? } click opens a dialog; heading / width asserted; Escape closes it
 *   search-query   { path*, param?, term | terms[]*, resultSelector*, expectIncludes?, minResults?, tolerance?,
 *                    compareLive?: { url, resultSelector?, param? }, itemPattern?: { title?, href?, pagination? } }
 *                                                                  per term: results > 0, ≥ minResults, ≥ live × (1 − tolerance|0.2) when compareLive
 *                                                                  (higher than live is logged, never failed; live unreachable → environment-limit note, not FAIL);
 *                                                                  expectIncludes found; itemPattern selectors resolve on the first result / page
 *   form-flow      { path*, form?, submit*, fill*, statusSelector?, endpointPattern?, successIncludes? } empty submit refused, filled submit arrives
 *   video-plays    { path*, trigger?, videoSelector?, iframeSelector?, playbackHost? }
 *                                                                  a <video> plays (currentTime ≥ 0.5 s within 4 s, readyState ≥ 3; HLS/DASH: manifest + ≥ 1 segment < 400);
 *                                                                  videoSelector scopes which <video> is under test (default: dialog / embed / video block first, then any —
 *                                                                  an autoplaying hero must not pass or fail the check for a player elsewhere); when no scoped <video>
 *                                                                  advanced and playbackHost is given, falls through to: iframe present AND a playbackHost request < 400
 *   consent-gate   { path*, forbiddenHosts*[] }                    no request to those hosts before consent
 *   no-page-errors { paths*[] }                                    no uncaught exceptions
 *   listing-rows   { path*, block*, index?, minRows? }             authored rows of .<block> in <path>.plain.html (heading / label-list rows excluded) > 0,
 *                                                                  and ≥ min(index first-page count, minRows|12) when an index URL is given
 * Every check also records the third-party request statuses it observed, so a
 * probe-induced failure is distinguishable from a vendor restriction.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { arg, flag, readJSON, writeJSON, writeText, provenance, loadPlaywright, resolveAuthHeader, attachOriginAuth, sameSite } from './lib.mjs';

const SCRIPT_NAME = 'dynamics-check';
// live-session.mjs (diff skill) owns the bot-management launch ladder — no
// dynamics script opens a window on its own (evals/lint/launch-ladder.mjs).
// Two layouts exist: the plugin tree (skills/dynamics/scripts ↔ skills/diff/scripts)
// and a project copy (scripts/dynamics ↔ scripts/diff) — resolve either.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('%s: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s live-session.mjs alongside the dynamics scripts.', SCRIPT_NAME);
  process.exit(2);
}
const { launchTier, parseHeadedFlag, resolveStartTier } = await import(pathToFileURL(LIVE_SESSION).href);

const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function openPage(ctx, origin, path) {
  const page = await ctx.newPage();
  const errors = []; const thirdParty = []; const media = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('response', (r) => { try { const u = new URL(r.url()); if (!sameSite(u.host, new URL(origin).host) && thirdParty.length < 60) thirdParty.push({ host: u.host, status: r.status(), type: r.request().resourceType() }); if (MEDIA_URL.test(u.pathname) && media.length < 80) media.push({ url: u.pathname.slice(-80), status: r.status() }); } catch { /* ignore */ } });
  await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => { await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 }); });
  await settle(1200);
  return { page, errors, thirdParty, media };
}
const MEDIA_URL = /\.(m3u8|mpd|ts|m4s|mp4|webm|aac|m4a)$/i;
const MANIFEST = /\.(m3u8|mpd)$/i;
const summarize = (tp) => { const m = {}; for (const t of tp) { const k = `${t.host}:${t.status}`; m[k] = (m[k] || 0) + 1; } return Object.entries(m).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(' '); };
const DIALOG = 'dialog[open], [role=dialog]:not([hidden]), [aria-modal=true]';
// where the <video> under test lives, most specific first; a page-wide hero/background <video> is the last resort
const VIDEO_SCOPES = ['dialog video', '[role=dialog] video', '.embed video', '.video video', 'video'];

const RUNNERS = {
  async 'fetch-json'(c, { ctx, origin }) {
    const { page } = await openPage(ctx, origin, '/');
    const r = await page.evaluate(async (u) => { const res = await fetch(u); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ } const rows = j ? (Array.isArray(j) ? j.length : Array.isArray(j.data) ? j.data.length : (j.total ?? Object.keys(j).length)) : -1; return { status: res.status, rows, keys: j && !Array.isArray(j) ? Object.keys(j).slice(0, 10) : [] }; }, c.url.startsWith('http') ? c.url : origin + c.url);
    await page.close();
    const okRows = c.minRows === undefined || r.rows >= c.minRows; const okKeys = !c.expectKeys || c.expectKeys.every((k) => r.keys.includes(k));
    return { pass: r.status < 400 && r.rows >= 0 && okRows && okKeys, detail: `${r.status} · ${r.rows} rows${r.keys.length ? ` · keys ${r.keys.join(',')}` : ''}` };
  },
  async 'dom-count'(c, { ctx, origin }) {
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    const n = await page.evaluate((s) => document.querySelectorAll(s).length, c.selector);
    await page.close();
    return { pass: n >= c.min, detail: `${n} × ${c.selector} (min ${c.min})`, thirdParty };
  },
  async 'click-dialog'(c, { ctx, origin }) {
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    await page.click(c.trigger, { timeout: 8000 });
    await settle(1500);
    const d = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { width: Math.round(r.width), heading: (el.querySelector('h1,h2,h3,[class*="heading" i],[class*="title" i]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), fields: el.querySelectorAll('input,select,textarea').length, iframe: !!el.querySelector('iframe') }; }, DIALOG);
    let closed = null;
    if (d) { await page.keyboard.press('Escape'); await settle(500); closed = await page.evaluate((sel) => !document.querySelector(sel), DIALOG); }
    await page.close();
    const okH = !c.headingIncludes || (d && d.heading.toLowerCase().includes(c.headingIncludes.toLowerCase())); const okW = !c.minWidth || (d && d.width >= c.minWidth);
    return { pass: !!d && okH && okW && closed !== false, detail: d ? `dialog ${d.width}px · heading "${d.heading}" · ${d.fields} fields${d.iframe ? ' · iframe' : ''} · Escape closes: ${closed}` : 'no dialog opened', thirdParty };
  },
  async 'search-query'(c, { ctx, origin }) {
    const terms = Array.isArray(c.terms) && c.terms.length ? c.terms : [c.term];
    const q = (base, t, param) => `${base}${base.includes('?') ? '&' : '?'}${param || 'q'}=${encodeURIComponent(t)}`;
    const results = async (page, sel) => { await page.waitForSelector(sel, { timeout: 15000 }).catch(() => {}); return page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => `${el.textContent} ${el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || ''}`.replace(/\s+/g, ' ').trim().toLowerCase()), sel); };
    const tol = c.tolerance ?? 0.2;
    const lines = []; let pass = true; let thirdParty = []; let envLimit = null;
    for (const t of terms) {
      const { page, thirdParty: tp } = await openPage(ctx, origin, q(c.path, t, c.param));
      thirdParty = thirdParty.concat(tp);
      const r = await results(page, c.resultSelector);
      const item = c.itemPattern ? await page.evaluate(({ sel, ip }) => { const first = document.querySelector(sel); const pick = (root, s) => (root.matches(s) ? root : root.querySelector(s)); return { title: !ip.title || !!(first && pick(first, ip.title)), href: !ip.href || !!(first && pick(first, ip.href)?.getAttribute('href')), pagination: !ip.pagination || !!document.querySelector(ip.pagination) }; }, { sel: c.resultSelector, ip: c.itemPattern }) : null;
      await page.close();
      let live = null;
      if (c.compareLive && c.compareLive.url) {
        // the live engine is the reference for "fewer": fresh page, no origin auth (route filter is origin-scoped), a failure here is an environment limit, not a defect
        const lp = await ctx.newPage();
        try {
          const res = await lp.goto(q(c.compareLive.url, t, c.compareLive.param || c.param), { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (!res || res.status() >= 400) envLimit = `live answered ${res ? res.status() : 'nothing'}`; else { await settle(1500); live = (await results(lp, c.compareLive.resultSelector || c.resultSelector)).length; }
        } catch (e) { envLimit = `live unreachable: ${String(e.message).slice(0, 40)}`; }
        await lp.close();
      }
      const hit = c.expectIncludes ? r.find((x) => x.includes(String(c.expectIncludes).toLowerCase())) : null;
      const fewer = live !== null && r.length < live * (1 - tol);
      const ok = r.length > 0 && (c.minResults === undefined || r.length >= c.minResults) && !fewer && (!c.expectIncludes || !!hit) && (!item || (item.title && item.href && item.pagination));
      if (!ok) pass = false;
      lines.push(`${t}: target ${r.length}${live !== null ? ` vs live ${live}${fewer ? ' — FEWER: index scope or missing text property' : r.length > live ? ' (higher: full-text index, fine)' : ''}` : envLimit ? ` (live not comparable — ${envLimit})` : ''}${c.minResults !== undefined ? ` · floor ${c.minResults}` : ''}${c.expectIncludes ? ` · "${c.expectIncludes}" ${hit ? 'found' : 'MISSING'}` : ''}${item ? ` · first item title/href/pagination ${item.title}/${item.href}/${item.pagination}` : ''}`);
    }
    return { pass, detail: lines.join(' | ').slice(0, 400), thirdParty };
  },
  async 'form-flow'(c, { ctx, origin }) {
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    const scope = c.form || 'form';
    const posts = []; page.on('request', (r) => { if (['POST', 'PUT'].includes(r.method()) && ['xhr', 'fetch', 'document'].includes(r.resourceType())) posts.push(r.url()); });
    await page.click(`${scope} ${c.submit}`, { timeout: 8000 });
    await settle(600);
    const emptyStatus = await page.evaluate((s) => (document.querySelector(s)?.textContent || '').trim().slice(0, 80), c.statusSelector || `${scope} [class*="status" i], ${scope} [class*="error" i], ${scope} [aria-live]`);
    const emptyPosted = posts.length;
    const invalid = await page.evaluate((s) => !!document.querySelector(`${s} :invalid`), scope);
    const emptyRefused = emptyPosted === 0 && (invalid || emptyStatus.length > 0);
    for (const [name, value] of Object.entries(c.fill || {})) {
      const sel = `${scope} [name="${name}"]`;
      const kind = await page.evaluate((s) => { const el = document.querySelector(s); return el ? `${el.tagName.toLowerCase()}:${el.type || ''}` : ''; }, sel);
      if (kind.startsWith('select')) await page.selectOption(sel, String(value)).catch(() => {}); else if (/:(checkbox|radio)$/.test(kind)) await page.check(sel).catch(() => {}); else await page.fill(sel, String(value)).catch(() => {});
    }
    await page.click(`${scope} ${c.submit}`, { timeout: 8000 });
    await settle(2000);
    const arrived = c.endpointPattern ? posts.some((u) => new RegExp(c.endpointPattern).test(u)) : posts.length > emptyPosted;
    const success = c.successIncludes ? (await page.evaluate(() => document.body.innerText)).toLowerCase().includes(c.successIncludes.toLowerCase()) : true;
    await page.close();
    return { pass: emptyRefused && arrived && success, detail: `empty refused: ${emptyRefused}${emptyStatus ? ` ("${emptyStatus}")` : ''} · filled posted: ${arrived}${posts.length ? ` (${posts.slice(-1)[0].slice(0, 80)})` : ''} · success copy: ${success}`, thirdParty };
  },
  async 'video-plays'(c, { ctx, origin }) {
    const { page, thirdParty, media } = await openPage(ctx, origin, c.path);
    if (c.trigger) await page.click(c.trigger, { timeout: 8000 });
    // a <video> must actually advance: poll up to 4 s after the trigger (poster-only failures look identical at rest);
    // scoped to the first VIDEO_SCOPES entry (or c.videoSelector) that matches, so an unrelated hero <video> is not the one measured
    const scopes = c.videoSelector ? [c.videoSelector] : VIDEO_SCOPES;
    const readVideo = () => page.evaluate((sel) => { for (const s of sel) { const els = [...document.querySelectorAll(s)]; if (!els.length) continue; const el = els.find((x) => x.currentTime > 0) || els[0]; return { scope: s, currentTime: +el.currentTime.toFixed(2), readyState: el.readyState, src: (el.currentSrc || el.src || '').slice(-60) }; } return null; }, scopes);
    const deadline = Date.now() + 4000; let v = await readVideo();
    while (Date.now() < deadline && !(v && v.currentTime >= 0.5 && v.readyState >= 3)) { await settle(400); v = await readVideo(); }
    const iframe = await page.evaluate((s) => !!document.querySelector(s), c.iframeSelector || 'iframe[src*="player" i], dialog iframe, [role=dialog] iframe');
    await page.close();
    const playing = !!v && v.currentTime >= 0.5 && v.readyState >= 3;
    const manifests = media.filter((m) => MANIFEST.test(m.url)); const segments = media.filter((m) => !MANIFEST.test(m.url));
    const streamOk = !manifests.length || (manifests.some((m) => m.status < 400) && segments.some((m) => m.status < 400));
    const playback = c.playbackHost ? thirdParty.filter((t) => new RegExp(c.playbackHost, 'i').test(t.host)) : [];
    const vendorOk = playback.some((t) => t.status < 400); const failed = playback.filter((t) => t.status >= 400);
    // a scoped <video> that never advanced is not the element under test when an iframe player is declared: fall through to the vendor path
    const pass = playing ? streamOk && (!c.playbackHost || vendorOk) : iframe && !!c.playbackHost && vendorOk;
    const detail = [
      v ? `<video> (${v.scope}) currentTime ${v.currentTime}s readyState ${v.readyState}${playing ? '' : ' — NOT PLAYING'}` : 'no <video>',
      playing ? null : `iframe: ${iframe}${!c.playbackHost ? ' · no playbackHost to assert — a poster-only render is indistinguishable from playback' : ''}`,
      manifests.length ? `stream: manifest ${manifests.map((m) => m.status).join('/')} · segments ${segments.filter((m) => m.status < 400).length}/${segments.length} ok` : null,
      c.playbackHost ? `vendor ${playback.length} request(s) (${vendorOk ? 'ok' : 'none ok'}${failed.length ? `, ${failed.length} ≥400 — check whether the probe leaked auth to the vendor` : ''})` : null,
    ].filter(Boolean).join(' · ');
    return { pass, detail, thirdParty };
  },
  async 'consent-gate'(c, { ctx, origin }) {
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    await settle(4000);
    await page.close();
    const leaked = thirdParty.filter((t) => c.forbiddenHosts.some((h) => t.host.includes(h)));
    return { pass: leaked.length === 0, detail: leaked.length ? `fired before consent: ${[...new Set(leaked.map((t) => t.host))].join(', ')}` : `no request to ${c.forbiddenHosts.length} gated host pattern(s) before consent`, thirdParty };
  },
  async 'no-page-errors'(c, { ctx, origin }) {
    const all = [];
    for (const p of c.paths) { const { page, errors } = await openPage(ctx, origin, p); await page.close(); all.push(...errors.map((e) => `${p}: ${e}`)); }
    return { pass: all.length === 0, detail: all.length ? all.slice(0, 3).join(' | ').slice(0, 200) : `none on ${c.paths.length} page(s)` };
  },
  async 'listing-rows'(c, { ctx, origin }) {
    // document-first listings (reference/listings.md § Block contract): the served document, not the rendered DOM
    const plain = `${c.path.replace(/\/$/, '/index')}.plain.html`;
    const page = await ctx.newPage();
    const res = await page.goto(origin + plain, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    const status = res ? res.status() : 0;
    const r = status < 400 ? await page.evaluate((block) => {
      const blocks = [...document.querySelectorAll('div')].filter((d) => d.classList.contains(block));
      const isHeading = (row) => row.textContent.trim() && [...row.querySelectorAll('*')].every((el) => /^(DIV|H[1-6]|STRONG|EM|A)$/.test(el.tagName)) && row.querySelector('h1,h2,h3,h4,h5,h6') && !row.querySelector('p,ul,ol,img,picture');
      const isLabelList = (row) => row.querySelector('ul,ol') && !row.querySelector('p,img,picture,h1,h2,h3,h4,h5,h6');
      let rows = 0; let excluded = 0;
      for (const b of blocks) for (const row of b.children) { if (!row.textContent.trim() && !row.querySelector('img,picture,a')) continue; if (isHeading(row) || isLabelList(row)) excluded += 1; else rows += 1; }
      return { blocks: blocks.length, rows, excluded };
    }, c.block) : { blocks: 0, rows: 0, excluded: 0 };
    let indexCount = null;
    if (c.index) {
      const j = await page.evaluate(async (u) => { try { const x = await (await fetch(u)).json(); return Array.isArray(x) ? x.length : Array.isArray(x.data) ? x.data.length : (x.total ?? null); } catch { return null; } }, c.index.startsWith('http') ? c.index : origin + c.index);
      indexCount = typeof j === 'number' ? j : null;
    }
    await page.close();
    const floor = indexCount !== null ? Math.min(indexCount, c.minRows ?? 12) : (c.minRows ?? 1);
    const pass = status < 400 && r.blocks > 0 && r.rows > 0 && r.rows >= floor;
    return { pass, detail: status >= 400 ? `${plain} → ${status}` : `${r.blocks} × .${c.block} · ${r.rows} authored rows (${r.excluded} heading/label rows excluded) · floor ${floor}${indexCount !== null ? ` (index ${indexCount})` : ''}${r.rows === 0 && r.blocks ? ' · EMPTY — block authored without rows renders nothing until code-sync and serves 0 words' : ''}` };
  },
};

/** replay every check of every feature; returns results with per-check third-party statuses */
export async function replay({ origin, parity, authHeader = null, headed = 0 }) {
  const { chromium } = await loadPlaywright();
  // headed = ladder start tier (0 = the tier extract recorded; 2 = real Chrome headless; 3 = off-screen window)
  const browser = await launchTier(chromium, resolveStartTier(headed));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await attachOriginAuth(ctx, origin, authHeader);
  // entry-document statuses per check: a 429/503 on the origin's own document makes the replay unmeasured, not failed (qa dynamics/parity-unmeasured)
  let entryStatuses = [];
  ctx.on('response', (r) => { try { if (r.request().resourceType() === 'document' && r.url().startsWith(origin)) entryStatuses.push(r.status()); } catch { /* evidence only */ } });
  const results = [];
  for (const f of parity.features || []) {
    for (const c of f.checks || []) {
      const t0 = Date.now();
      const runner = RUNNERS[c.type];
      let r; entryStatuses = [];
      if (!runner) r = { pass: false, detail: `unknown check type "${c.type}"` };
      else { try { r = await runner(c, { ctx, origin }); } catch (e) { r = { pass: false, detail: `error: ${String(e.message).slice(0, 140)}` }; } }
      const throttled = entryStatuses.some((s) => s === 429 || s === 503);
      results.push({ feature: f.feature, id: f.id, class: f.class, status: f.status, type: c.type, pass: !!r.pass, detail: r.detail, thirdParty: summarize(r.thirdParty || []), ms: Date.now() - t0, environmentLimit: f.environmentLimit || null, entryStatus: throttled ? entryStatuses.find((s) => s === 429 || s === 503) : (entryStatuses[0] ?? null), throttled });
      console.error(`[dynamics-check] ${r.pass ? 'PASS' : 'FAIL'} ${f.feature} · ${c.type} — ${r.detail}`);
    }
  }
  await browser.close().catch(() => {});
  return results;
}

/* --------------------------------------------------------------- gate ---- */
const bucket = (s) => (/^(pending|in-progress)/.test(s || '') ? 'pending' : /^(done|delivered)/.test(s || '') ? 'delivered' : /^interim/.test(s || '') ? 'interim' : /^scaffolded/.test(s || '') ? 'scaffolded' : /^decided-out/.test(s || '') ? 'decided-out' : 'other');
// a row this run built (not one the capture pipeline shipped untouched — nothing to replay there)
const built = (f) => bucket(f.status) === 'delivered' && !/^delivered-by-capture/.test(f.status || '');
const MEDIA_PATTERN = /^(embed-passthrough|media-as-url|hls-stream)$/;
/** close-out lint over parity rows (no browser): reasons that block the report; [] = clear. The rule text is parity-report.md rule 8. */
export function gate(parity) {
  const out = [];
  for (const f of parity.features || []) {
    const has = (type, pred = () => true) => (f.checks || []).some((c) => c.type === type && pred(c));
    if (f.reproducibility === 'self' && bucket(f.status) === 'pending') out.push(`${f.feature} (${f.class}): reproducibility self, status "${f.status}" — implement it (D2) or set status interim with a reason and a named owner decision`);
    // a built search row carries a search-query compared with live or floored explicitly
    if (f.class === 'S' && built(f) && !has('search-query', (c) => c.compareLive || c.minResults !== undefined)) out.push(`${f.feature} (S): status "${f.status}" without a search-query check carrying compareLive or minResults — result counts were never compared with live`);
    // a built media row on an explicit player pattern ends in a playable proof
    if (f.class === 'V' && built(f) && (MEDIA_PATTERN.test(f.disposition || '') || MEDIA_PATTERN.test(f.pattern || '')) && !has('video-plays')) out.push(`${f.feature} (V): status "${f.status}", ${f.disposition || f.pattern} without a video-plays check — a poster-only render is not delivery`);
  }
  return out;
}
export function closeoutSections(parity) {
  const counts = {}; for (const f of parity.features || []) { const b = bucket(f.status); counts[b] = (counts[b] || 0) + 1; }
  const owner = (parity.features || []).filter((f) => f.owner && bucket(f.status) !== 'delivered');
  return [
    '', '## Delivered / interim / decided-out', '',
    ['delivered', 'interim', 'scaffolded', 'decided-out', 'pending', 'other'].filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(' · ') || 'no features',
    '', '## Values the owner must supply', '',
    ...(owner.length ? owner.map((f) => `- ${f.feature} (${f.class}, ${f.status}) — ${f.owner}`) : ['- none']),
  ];
}

/* ---------------------------------------------------------------- cli ---- */
if (process.argv[1] && process.argv[1].endsWith('dynamics-check.mjs')) {
  if (flag('help')) { console.log('usage: dynamics-check.mjs --origin <published origin> [--parity stardust/dynamics/parity.json] [--out stardust/qa] [--auth-header "token …" | --token-env SITE_TOKEN] [--headed[=window]] [--gate]\n  exit: 0 all replays pass · 1 a replay failed · 2 usage · 3 --gate blocked; results carry entryStatus / throttled (qa dynamics/parity-unmeasured)'); process.exit(0); }
  const origin = (arg('origin') || '').replace(/\/$/, '');
  if (!origin) { console.error('usage: dynamics-check.mjs --origin <published origin> [--parity stardust/dynamics/parity.json] [--out stardust/qa] [--gate]'); process.exit(2); }
  const parityFile = arg('parity', 'stardust/dynamics/parity.json');
  const gating = flag('gate');
  const parity = readJSON(parityFile, gating ? null : undefined);
  if (!parity) { console.error(`[dynamics-check] GATE: ${parityFile} missing — Phase 5 never ran; parity.json is required in both flows`); process.exit(3); }
  const headedArg = process.argv.find((a) => a === '--headed' || a.startsWith('--headed='));
  const results = await replay({ origin, parity, authHeader: resolveAuthHeader(), headed: headedArg ? parseHeadedFlag(headedArg) : 0 });
  const out = arg('out', 'stardust/qa');
  const pass = results.filter((r) => r.pass).length;
  const blocked = gate(parity);
  const md = [
    `# Dynamics parity check — ${origin} — ${new Date().toISOString()}`, '',
    `Replayed ${results.length} checks over ${(parity.features || []).length} features · pass ${pass} · fail ${results.length - pass}. Flows, not presence.`, '',
    '| feature | class | status | check | result | detail | third-party requests |', '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.feature} | ${r.class} | ${r.status || ''} | ${r.type} | ${r.pass ? 'PASS' : 'FAIL'} | ${String(r.detail).replace(/\|/g, '/')} | ${r.thirdParty} |`),
    '', '## Features without checks', '',
    ...(parity.features || []).filter((f) => !(f.checks || []).length).map((f) => `- ${f.feature} (${f.class}) — ${f.status}${f.owner ? ` · owner: ${f.owner}` : ''}${f.environmentLimit ? ` · environment limit: ${f.environmentLimit}` : ''}`),
    ...closeoutSections(parity),
    ...(blocked.length ? ['', '## Gate — blocks the report', '', ...blocked.map((b) => `- ${b}`)] : []),
  ];
  writeText(join(out, 'dynamics-report.md'), md.join('\n'));
  writeJSON(join(out, 'dynamics-report.json'), { _provenance: provenance('check', { origin, parity: parityFile }), results, gate: blocked });
  console.error(`[dynamics-check] ${pass}/${results.length} pass → ${join(out, 'dynamics-report.md')}`);
  if (gating && blocked.length) { console.error(`[dynamics-check] GATE: ${blocked.length} row(s) block the report\n${blocked.map((b) => `  - ${b}`).join('\n')}`); process.exitCode = 3; } else process.exitCode = pass === results.length ? 0 : 1;
}
