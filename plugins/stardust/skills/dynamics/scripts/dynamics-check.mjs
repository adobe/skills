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
 *        [--out stardust/qa] [--auth-header "token …" | --token-env SITE_TOKEN] [--headed]
 *
 * Check types (* = required):
 *   fetch-json     { url*, minRows?, expectKeys? }                 GET on the origin returns JSON with rows / keys
 *   dom-count      { path*, selector*, min* }                      ≥ min elements after settle
 *   click-dialog   { path*, trigger*, headingIncludes?, minWidth? } click opens a dialog; heading / width asserted; Escape closes it
 *   search-query   { path*, param?, term*, resultSelector*, expectIncludes* } results include the expected text/href
 *   form-flow      { path*, form?, submit*, fill*, statusSelector?, endpointPattern?, successIncludes? } empty submit refused, filled submit arrives
 *   video-plays    { path*, trigger?, iframeSelector?, playbackHost* } iframe present AND a playback request to the vendor observed
 *   consent-gate   { path*, forbiddenHosts*[] }                    no request to those hosts before consent
 *   no-page-errors { paths*[] }                                    no uncaught exceptions
 * Every check also records the third-party request statuses it observed, so a
 * probe-induced failure is distinguishable from a vendor restriction.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { join } from 'node:path';
import { arg, flag, readJSON, writeJSON, writeText, provenance, loadPlaywright, resolveAuthHeader, attachOriginAuth, sameSite } from './lib.mjs';

const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function openPage(ctx, origin, path) {
  const page = await ctx.newPage();
  const errors = []; const thirdParty = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('response', (r) => { try { const u = new URL(r.url()); if (!sameSite(u.host, new URL(origin).host) && thirdParty.length < 60) thirdParty.push({ host: u.host, status: r.status(), type: r.request().resourceType() }); } catch { /* ignore */ } });
  await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => { await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 }); });
  await settle(1200);
  return { page, errors, thirdParty };
}
const summarize = (tp) => { const m = {}; for (const t of tp) { const k = `${t.host}:${t.status}`; m[k] = (m[k] || 0) + 1; } return Object.entries(m).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(' '); };
const DIALOG = 'dialog[open], [role=dialog]:not([hidden]), [aria-modal=true]';

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
    const r = await page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => `${el.textContent} ${el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || ''}`.replace(/\s+/g, ' ').trim().toLowerCase()), c.resultSelector);
    await page.close();
    const hit = r.find((x) => x.includes(String(c.expectIncludes).toLowerCase()));
    return { pass: r.length > 0 && !!hit, detail: `${r.length} results · expected "${c.expectIncludes}" ${hit ? 'found' : 'MISSING'}${r[0] ? ` · first: ${r[0].slice(0, 80)}` : ''}`, thirdParty };
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
    const { page, thirdParty } = await openPage(ctx, origin, c.path);
    if (c.trigger) { await page.click(c.trigger, { timeout: 8000 }); await settle(4000); } else await settle(3000);
    const iframe = await page.evaluate((s) => !!document.querySelector(s), c.iframeSelector || 'iframe[src*="player" i], dialog iframe, [role=dialog] iframe, video');
    await page.close();
    const playback = thirdParty.filter((t) => new RegExp(c.playbackHost, 'i').test(t.host));
    const ok = playback.some((t) => t.status < 400); const failed = playback.filter((t) => t.status >= 400);
    return { pass: iframe && ok, detail: `iframe/video: ${iframe} · playback requests ${playback.length} (${ok ? 'ok' : 'none ok'}${failed.length ? `, ${failed.length} ≥400 — check whether the probe leaked auth to the vendor` : ''})`, thirdParty };
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
