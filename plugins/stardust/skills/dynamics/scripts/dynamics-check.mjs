#!/usr/bin/env node
/**
 * dynamics-check.mjs — stardust:dynamics Phase 5: replay the dynamic parity
 * checks against the published origin. Read-only. Flows, not presence: a check
 * passes when the user-visible flow completes (a query returns a known answer, an
 * empty submission is refused and a filled one reaches the endpoint, a player
 * actually plays), never because a block rendered.
 *
 * Input: `stardust/dynamics/parity.json` (reference/parity-report.md) — per feature
 * a `checks[]` list from the closed set below. Also exported as `replay()` for the
 * qa `dynamics` check.
 *
 *   node dynamics-check.mjs --origin https://main--site--org.aem.live [--parity stardust/dynamics/parity.json]
 *        [--out stardust/qa] [--auth-header "token …" | --token-env SITE_TOKEN] [--headed]
 *
 * Writes (under --out, default stardust/qa):
 *   dynamics-report.md     one row per replayed check (PASS/FAIL, detail, third-party requests)
 *   dynamics-report.json   the same results with _provenance
 * Progress lines go to stderr. Exit 0 when every check passed, 1 otherwise, 2 on usage.
 *
 * Check types (* = required):
 *   fetch-json     { url*, minRows?, expectKeys? }                 GET on the origin returns JSON with rows / keys
 *   dom-count      { path*, selector*, min* }                      ≥ min elements after settle
 *   click-dialog   { path*, trigger*, headingIncludes?, minWidth? } click opens a dialog; heading / width asserted; Escape closes it
 *   search-query   { path*, param?, term*, resultSelector*, titleSelector?, expectIncludes?, expectCount?, expectTitles?[], countTolerance? }
 *                  the results are compared with what the SOURCE showed for the same term (read during detect,
 *                  recorded here — at least one expectation): a result includes expectIncludes; the result COUNT
 *                  equals expectCount (± countTolerance, default 0); the top titles (≤ 3) equal expectTitles as a
 *                  set; no two results share title + text. A count mismatch FAILS — a recorded hands-off run's
 *                  typeahead returned 10 entries (two home pages under one title) where the source returned 3.
 *                  Exported as `compareSearchResults(results, check)` for the unit test and the qa check.
 *   form-flow      { path*, form?, frame?, submit*, fill*, statusSelector?, endpointPattern?, successIncludes?, block? }
 *                  empty submit refused, filled submit leaves the page as a POST / PUT / PATCH (beacons and
 *                  analytics posts never count). frame = the iframe selector of an EMBEDDED form: the iframe must
 *                  exist (a rebuilt native form fails) and the flow runs inside it. fill = { name | CSS selector |
 *                  label: value } or "auto" (test values into every visible control). block (default: true with
 *                  frame) aborts the submission in the browser, so a live production form gets no test lead.
 *                  A submission must carry a filled value (beacons never count); a disabled submit refuses the
 *                  empty attempt. A recorded run shipped a planned iframe as a native form that never posted.
 *                  Exported as `judgeFormFlow`, `isSubmission`, `autoValue`.
 *   video-plays    { path*, trigger?, iframeSelector?, videoSelector?, playbackHost?, reducedMotionPauses? }
 *                  PLAYBACK, not presence: a vendor iframe must issue a playback request to playbackHost with
 *                  status < 400; a native <video> (scrolled to ≥ ¼ visible) must be PLAYING — not paused,
 *                  currentTime advancing between two samples; with reducedMotionPauses the page is reloaded
 *                  under prefers-reduced-motion and the video must be paused. "Video elements present and
 *                  controllable" passed 26/26 on a recorded run while nothing played — the capture freeze
 *                  (video at t=0) had become the spec. Exported as `judgeVideoPlayback(sample, check)`.
 *   consent-gate   { path*, forbiddenHosts*[] }                    no request to those hosts before consent
 *   no-page-errors { paths*[] }                                    no uncaught exceptions
 * Every check also records the third-party request statuses it observed, so a
 * probe-induced failure is distinguishable from a vendor restriction.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag, readJSON, writeJSON, writeText, provenance, loadPlaywright, resolveAuthHeader, attachOriginAuth, sameSite } from './lib.mjs';

const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function openPage(ctx, origin, path) {
  const page = await ctx.newPage();
  const errors = []; const thirdParty = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('response', (r) => { try { const u = new URL(r.url()); if (!sameSite(u.host, new URL(origin).host) && thirdParty.length < 60) thirdParty.push({ host: u.host, status: r.status(), type: r.request().resourceType() }); } catch { /* ignore */ } });
  const resp = await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 }));
  await settle(1200);
  return { page, errors, thirdParty, status: resp?.status() || 0 };
}
const summarize = (tp) => { const m = {}; for (const t of tp) { const k = `${t.host}:${t.status}`; m[k] = (m[k] || 0) + 1; } return Object.entries(m).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(' '); };
const DIALOG = 'dialog[open], [role=dialog]:not([hidden]), [aria-modal=true]';

// A form's submission: a write (xhr / fetch / document post) that carries at least one filled value.
// Matching the body rather than the URL keeps RUM, tag-manager and APM beacons from counting — a recorded
// run "passed" a dead form on a beacon. No values (the empty attempt): any non-beacon write counts.
const BEACON = /\/cdn-cgi\/rum|\/collect\b|beacon|\/analytics\/|\/track(ing)?\b|pixel|telemetry|nr-data\.net|sentry|\/envelope\/|bugsnag|datadoghq|\/rum\b/i;
export function isSubmission({ method = 'GET', type = '', url = '', body = '' } = {}, { endpointPattern = null, values = [] } = {}) {
  if (!['POST', 'PUT', 'PATCH'].includes(method) || !['xhr', 'fetch', 'document'].includes(type)) return false;
  if (endpointPattern) return new RegExp(endpointPattern).test(url);
  if (BEACON.test(url)) return false;
  const vals = values.map(String).filter((v) => v.length > 2);
  if (!vals.length) return true;
  const hay = `${url} ${body || ''}`;
  return vals.some((v) => hay.includes(v) || hay.includes(encodeURIComponent(v)) || hay.includes(encodeURIComponent(v).replace(/%20/g, '+')));
}

// Test value for one control under `fill: "auto"`; null = leave it. Pure.
export function autoValue({ tag = 'input', type = 'text', name = '', label = '', options = [] } = {}) {
  const t = String(type).toLowerCase(); const hint = `${name} ${label}`.toLowerCase();
  if (['hidden', 'submit', 'button', 'reset', 'file', 'password', 'search', 'image'].includes(t)) return null;
  if (tag === 'select') return options.find((o) => o && !/^(select|choose|please|--)/i.test(o)) ?? null;
  if (t === 'checkbox' || t === 'radio') return true;
  if (t === 'email' || /e-?mail/.test(hint)) return 'parity-check@example.com';
  if (t === 'tel' || /phone|mobile|tel\b/.test(hint)) return '4155550123';
  if (t === 'number' || t === 'range') return '5';
  if (t === 'url' || /website|url/.test(hint)) return 'https://example.com';
  if (t === 'date') return '2030-01-15';
  if (/zip|postal/.test(hint)) return '94103';
  if (tag === 'textarea') return 'Parity check, please ignore.';
  if (/company|organi[sz]ation/.test(hint)) return 'Example Inc';
  if (/name/.test(hint)) return 'Parity';
  return 'Parity check';
}

// Pure verdict for `form-flow`. Presence never passes: the empty submit must be refused and the
// filled one must leave the page; with `frame`, the embed itself must have shipped.
export function judgeFormFlow({ frame = null, frameFound = true, emptyPosted = 0, emptyDisabled = false, invalid = false, emptyStatus = '', arrived = false, lastPost = '', blocked = false, success = true } = {}) {
  if (frame && !frameFound) return { pass: false, reasons: [`iframe ${frame} not found`], detail: `iframe ${frame} not found — the embedded form did not ship` };
  if (emptyDisabled && !emptyStatus) emptyStatus = 'submit disabled until valid';
  const emptyRefused = emptyPosted === 0 && (emptyDisabled || invalid || emptyStatus.length > 0);
  const reasons = [];
  if (!emptyRefused) reasons.push(emptyPosted ? 'empty submission was sent' : 'empty submission not visibly refused');
  if (!arrived) reasons.push('filled submission never left the page');
  if (!success) reasons.push('success copy missing');
  const detail = `${frame ? `in iframe ${frame} · ` : ''}empty refused: ${emptyRefused}${emptyStatus ? ` ("${emptyStatus}")` : ''} · filled posted: ${arrived}${lastPost ? ` (${lastPost.slice(0, 80)})` : ''}${blocked ? ' · blocked in the browser, never reached the server' : ''} · success copy: ${blocked ? 'n/a (blocked)' : success}`;
  return { pass: reasons.length === 0, reasons, detail };
}

/**
 * Compare a results list `[{ title, text, href }]` with the expectations recorded from the SOURCE
 * for the same term: `expectIncludes` (a result carries this text/href), `expectCount` (the
 * source's result count, ± `countTolerance`, default 0), `expectTitles` (the source's top titles;
 * the first ≤ 3 are compared as a set with the top results here). Two results sharing title + text
 * are duplicates and fail. Pure — no browser, no network — so the unit test drives it directly.
 * Returns { pass, detail, reasons[] }.
 */
// Two reads of the first matching <video>, 800 ms apart, after scrolling it to the viewport centre.
// Null when the page has no such element.
async function sampleVideo(page, selector) {
  const read = () => page.evaluate((s) => {
    const v = document.querySelector(s);
    if (!v) return null;
    const r = v.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / (r.height || 1);
    return { autoplay: v.hasAttribute('autoplay'), paused: v.paused, t: v.currentTime, readyState: v.readyState, visible: Math.round(visible * 100) / 100, src: (v.currentSrc || v.src || '').slice(0, 160) };
  }, selector);
  const found = await page.evaluate((s) => { const v = document.querySelector(s); if (v) v.scrollIntoView({ block: 'center' }); return !!v; }, selector);
  if (!found) return null;
  await settle(1500);
  const a = await read();
  await settle(800);
  const b = await read();
  return { found: true, autoplay: a.autoplay, src: a.src, visible: b.visible, readyState: b.readyState, paused: b.paused, t0: a.t, t1: b.t };
}

// Pure verdict for `video-plays`: sample = { iframe, video, reduced, vendorOk, vendorRequests } where
// video/reduced are sampleVideo() results (null = no <video>). Presence alone never passes.
export function judgeVideoPlayback({ iframe = false, video = null, reduced = null, vendorOk = false, vendorRequests = 0 } = {}, check = {}) {
  const reasons = [];
  const playing = !!video && !video.paused && video.t1 > video.t0;
  if (video && !playing) reasons.push(`video not playing (paused ${video.paused}, Δt ${(video.t1 - video.t0).toFixed(2)}s, readyState ${video.readyState}, ${Math.round((video.visible || 0) * 100)}% visible)`);
  if (video && reduced && (!reduced.paused || reduced.t1 > reduced.t0)) reasons.push('video plays under prefers-reduced-motion');
  if (check.playbackHost && !vendorOk) reasons.push(`no playback request to ${check.playbackHost} with status < 400 (${vendorRequests} seen)`);
  if (!video && !iframe) reasons.push('no player: neither a vendor iframe nor a <video> found');
  const detail = [`iframe/video: ${iframe}`, video ? `video ${playing ? 'playing' : 'NOT playing'} (Δt ${(video.t1 - video.t0).toFixed(2)}s)` : 'no <video>',
    check.playbackHost ? `playback requests ${vendorRequests} (${vendorOk ? 'ok' : 'none ok'})` : null, reduced ? `reduced-motion: ${reduced.paused ? 'paused' : 'PLAYING'}` : null]
    .filter(Boolean).join(' · ');
  return { pass: reasons.length === 0, playing, reasons, detail: reasons.length ? `${detail} · ${reasons.join('; ')}` : detail };
}

export function compareSearchResults(results, { expectIncludes, expectCount, expectTitles, countTolerance = 0 } = {}) {
  const norm = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const rows = (Array.isArray(results) ? results : []).map((r) => (typeof r === 'string' ? { title: norm(r), text: norm(r), href: '' } : { title: norm(r.title), text: norm(r.text), href: norm(r.href) }));
  const hasCount = expectCount !== undefined && expectCount !== null && expectCount !== '' && Number.isFinite(Number(expectCount));
  const wantCount = hasCount ? Number(expectCount) : null;
  const titles = Array.isArray(expectTitles) ? expectTitles.map(norm).filter(Boolean) : [];
  const reasons = [];
  if (!expectIncludes && !hasCount && !titles.length) reasons.push('no expectation recorded (expectIncludes | expectCount | expectTitles)');
  if (!rows.length && !(hasCount && wantCount === 0)) reasons.push('no results');
  if (expectIncludes) {
    const needle = norm(expectIncludes);
    if (!rows.some((r) => `${r.title} ${r.text} ${r.href}`.includes(needle))) reasons.push(`expected "${expectIncludes}" MISSING`);
  }
  if (hasCount) {
    const tol = Math.max(0, Number(countTolerance) || 0);
    if (Math.abs(rows.length - wantCount) > tol) reasons.push(`count ${rows.length} vs source ${wantCount}${tol ? ` (±${tol})` : ''}`);
  }
  if (titles.length) {
    const n = Math.min(3, titles.length);
    const want = titles.slice(0, n); const got = rows.slice(0, n).map((r) => r.title);
    const missing = want.filter((t) => !got.includes(t)); const unexpected = got.filter((t) => !want.includes(t));
    if (missing.length || unexpected.length) reasons.push(`top-${n} titles differ — source: ${want.join(' | ')} · here: ${got.join(' | ') || '(none)'}`);
  }
  const seen = new Set(); const dupes = [];
  for (const r of rows) { const k = `${r.title}|${r.text}`; if (seen.has(k)) { if (!dupes.includes(r.title)) dupes.push(r.title); } else seen.add(k); }
  if (dupes.length) reasons.push(`duplicates (title + text): ${dupes.slice(0, 3).map((d) => `"${d.slice(0, 40)}"`).join(', ')}`);
  const summary = `${rows.length} results${hasCount ? ` (source ${wantCount})` : ''}${rows[0] ? ` · first: ${rows[0].title.slice(0, 60)}` : ''}`;
  return { pass: reasons.length === 0, detail: reasons.length ? `${summary} · ${reasons.join(' · ')}` : `${summary} · matches the source`, reasons };
}

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
    const sep = c.path.includes('?') ? '&' : '?';
    const { page, thirdParty } = await openPage(ctx, origin, `${c.path}${sep}${c.param || 'q'}=${encodeURIComponent(c.term)}`);
    await page.waitForSelector(c.resultSelector, { timeout: 15000 }).catch(() => {});
    const results = await page.evaluate(({ s, ts }) => [...document.querySelectorAll(s)].map((el) => {
      const squash = (x) => String(x || '').replace(/\s+/g, ' ').trim();
      const t = ts ? el.querySelector(ts) : (el.matches('a, h1, h2, h3, h4') ? el : el.querySelector('h1, h2, h3, h4, [class*="title" i], a'));
      return { title: squash((t || el).textContent), text: squash(el.textContent), href: el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '' };
    }), { s: c.resultSelector, ts: c.titleSelector || null });
    await page.close();
    const { pass, detail } = compareSearchResults(results, c);
    return { pass, detail, thirdParty };
  },
  async 'form-flow'(c, { ctx, origin }) {
    const { page, thirdParty, status } = await openPage(ctx, origin, c.path);
    if (status >= 400) { await page.close(); return { pass: false, reasons: [`page ${status}`], detail: `${c.path} answered ${status} — no form to test`, thirdParty }; }
    const scope = c.form || 'form';
    const submit = String(c.submit).split(',').map((x) => `${scope} ${x.trim()}`).join(', ');
    const block = c.block ?? !!c.frame;
    const posts = []; const filled = []; let blocked = false;
    const asReq = (r) => ({ method: r.method(), type: r.resourceType(), url: r.url(), body: r.postData() || '' });
    page.on('request', (r) => { if (isSubmission(asReq(r), { endpointPattern: c.endpointPattern, values: filled })) posts.push(r.url()); });
    if (block) await page.route('**/*', (route) => { const r = route.request(); if (isSubmission(asReq(r), { endpointPattern: c.endpointPattern, values: filled })) { blocked = true; return route.abort('blockedbyclient'); } return route.continue(); });
    let target = page;
    if (c.frame) {
      const handle = await page.waitForSelector(c.frame, { state: 'attached', timeout: 15000 }).catch(() => null);
      await handle?.scrollIntoViewIfNeeded().catch(() => {}); // a lazy iframe loads only near the viewport
      target = handle && await handle.contentFrame();
      if (!target) { await page.close(); return { ...judgeFormFlow({ frame: c.frame, frameFound: false }), thirdParty }; }
      await target.waitForSelector(scope, { timeout: 15000 });
    }
    const emptyDisabled = await target.$eval(submit, (el) => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => false);
    if (!emptyDisabled) await target.click(submit, { timeout: 8000 });
    await settle(600);
    const emptyStatus = await target.evaluate((s) => (document.querySelector(s)?.textContent || '').trim().slice(0, 80), c.statusSelector || `${scope} [class*="status" i], ${scope} [class*="error" i], ${scope} [aria-live]`);
    const emptyPosted = posts.length;
    const invalid = await target.evaluate((s) => !!document.querySelector(`${s} :invalid`), scope);
    if (c.fill === 'auto') {
      const controls = await target.evaluate((s) => [...document.querySelectorAll(`${s} input, ${s} select, ${s} textarea`)].filter((el) => !el.disabled && (el.offsetWidth || el.offsetHeight)).map((el, i) => {
        el.setAttribute('data-dyn-fill', String(i));
        const label = (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent || el.getAttribute('aria-label') || el.placeholder || '';
        return { i, tag: el.tagName.toLowerCase(), type: el.type || 'text', name: el.name || '', label: label.trim(), options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.value && o.textContent.trim()) : [] };
      }), scope);
      for (const ctl of controls) {
        const value = autoValue(ctl); const sel = `[data-dyn-fill="${ctl.i}"]`;
        if (value === null) continue;
        if (value !== true) filled.push(value);
        if (ctl.tag === 'select') await target.selectOption(sel, { label: value }).catch(() => {});
        else if (value === true) await target.check(sel).catch(() => {});
        else await target.fill(sel, value).catch(() => {});
      }
    } else {
      for (const [key, value] of Object.entries(c.fill || {})) {
        if (typeof value !== 'boolean') filled.push(String(value));
        const byName = `${scope} [name="${key}"]`;
        const sel = await target.$(byName) ? byName : /^[#.[]/.test(key) ? `${scope} ${key}` : null;
        const loc = sel ? target.locator(sel).first() : target.getByLabel(key).first();
        const kind = await loc.evaluate((el) => `${el.tagName.toLowerCase()}:${el.type || ''}`).catch(() => '');
        if (kind.startsWith('select')) await loc.selectOption(String(value)).catch(() => {}); else if (/:(checkbox|radio)$/.test(kind)) await loc.check().catch(() => {}); else await loc.fill(String(value)).catch(() => {});
      }
    }
    await target.click(submit, { timeout: 8000 });
    await settle(2500);
    const arrived = posts.length > emptyPosted;
    const success = c.successIncludes && !blocked ? (await target.evaluate(() => document.body.innerText).catch(() => '')).toLowerCase().includes(c.successIncludes.toLowerCase()) : true;
    await page.close();
    return { ...judgeFormFlow({ frame: c.frame, emptyPosted, emptyDisabled, invalid, emptyStatus, arrived, lastPost: posts.slice(-1)[0] || '', blocked, success }), thirdParty };
  },
  async 'video-plays'(c, { ctx, origin }) {
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    if (c.trigger) { await page.click(c.trigger, { timeout: 8000 }); await settle(4000); } else await settle(3000);
    const iframe = await page.evaluate((s) => !!document.querySelector(s), c.iframeSelector || 'iframe[src*="player" i], dialog iframe, [role=dialog] iframe');
    const videoSel = c.videoSelector || 'video';
    const video = await sampleVideo(page, videoSel);
    let reduced = null;
    if (video && c.reducedMotionPauses) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (c.trigger) { await page.click(c.trigger, { timeout: 8000 }); }
      await settle(2000);
      reduced = await sampleVideo(page, videoSel);
    }
    await page.close();
    const playback = c.playbackHost ? thirdParty.filter((t) => new RegExp(c.playbackHost, 'i').test(t.host)) : [];
    const ok = playback.some((t) => t.status < 400); const failed = playback.filter((t) => t.status >= 400);
    const v = judgeVideoPlayback({ iframe, video, reduced, vendorOk: ok, vendorRequests: playback.length }, c);
    return { pass: v.pass, detail: `${v.detail}${failed.length ? ` · ${failed.length} ≥400 — check whether the probe leaked auth to the vendor` : ''}`, thirdParty };
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
};

/** replay every check of every feature; returns results with per-check third-party statuses */
export async function replay({ origin, parity, authHeader = null, headed = false }) {
  if (!(parity.features || []).some((f) => (f.checks || []).length)) return [];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await attachOriginAuth(ctx, origin, authHeader);
  const results = [];
  for (const f of parity.features || []) {
    for (const c of f.checks || []) {
      const t0 = Date.now();
      const runner = RUNNERS[c.type];
      let r;
      if (!runner) r = { pass: false, detail: `unknown check type "${c.type}"` };
      else { try { r = await runner(c, { ctx, origin }); } catch (e) { r = { pass: false, detail: `error: ${String(e.message).slice(0, 140)}` }; } }
      results.push({ feature: f.feature, id: f.id, class: f.class, status: f.status, type: c.type, pass: !!r.pass, detail: r.detail, thirdParty: summarize(r.thirdParty || []), ms: Date.now() - t0, environmentLimit: f.environmentLimit || null });
      console.error(`[dynamics-check] ${r.pass ? 'PASS' : 'FAIL'} ${f.feature} · ${c.type} — ${r.detail}`);
    }
  }
  await browser.close().catch(() => {});
  return results;
}

/* ---------------------------------------------------------------- cli ---- */
if (process.argv[1] && process.argv[1].endsWith('dynamics-check.mjs')) {
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(0);
  }
  const origin = (arg('origin') || '').replace(/\/$/, '');
  if (!origin) { console.error('usage: dynamics-check.mjs --origin <published origin> [--parity stardust/dynamics/parity.json]'); process.exit(2); }
  const parityFile = arg('parity', 'stardust/dynamics/parity.json');
  const parity = readJSON(parityFile);
  const results = await replay({ origin, parity, authHeader: resolveAuthHeader(), headed: flag('headed') });
  const out = arg('out', 'stardust/qa');
  const pass = results.filter((r) => r.pass).length;
  const md = [
    `# Dynamics parity check — ${origin} — ${new Date().toISOString()}`, '',
    `Replayed ${results.length} checks over ${(parity.features || []).length} features · pass ${pass} · fail ${results.length - pass}. Flows, not presence.`, '',
    '| feature | class | status | check | result | detail | third-party requests |', '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.feature} | ${r.class} | ${r.status || ''} | ${r.type} | ${r.pass ? 'PASS' : 'FAIL'} | ${String(r.detail).replace(/\|/g, '/')} | ${r.thirdParty} |`),
    '', '## Features without checks', '',
    ...(parity.features || []).filter((f) => !(f.checks || []).length).map((f) => `- ${f.feature} (${f.class}) — ${f.status}${f.owner ? ` · owner: ${f.owner}` : ''}${f.environmentLimit ? ` · environment limit: ${f.environmentLimit}` : ''}`),
  ];
  writeText(join(out, 'dynamics-report.md'), md.join('\n'));
  writeJSON(join(out, 'dynamics-report.json'), { _provenance: provenance('check', { origin, parity: parityFile }), results });
  console.error(`[dynamics-check] ${pass}/${results.length} pass → ${join(out, 'dynamics-report.md')}`);
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 200).unref();
}
