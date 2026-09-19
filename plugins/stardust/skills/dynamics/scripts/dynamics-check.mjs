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
 *        [--out stardust/qa] [--auth-header "token …" | --token-env SITE_TOKEN] [--headed] [--gate]
 *
 * Exit: 0 all replays pass · 1 a replay failed · 2 usage · 3 `--gate` blocked (parity.json missing, or a
 * reproducibility `self` feature still `pending*` / `in-progress` — the close-out condition rollout Phase H
 * and the pilot-only chain run before declaring done). The report always ends with "Delivered / interim /
 * decided-out" counts and "Values the owner must supply" (feature · `owner`), from the parity rows.
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
 *   listing-rows   { path*, block*, index?, minRows? }             authored rows of .<block> in <path>.plain.html (heading / label-list rows excluded) > 0,
 *                                                                  and ≥ min(index first-page count, minRows|12) when an index URL is given
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

/* --------------------------------------------------------------- gate ---- */
const bucket = (s) => (/^(pending|in-progress)/.test(s || '') ? 'pending' : /^(done|delivered)/.test(s || '') ? 'delivered' : /^interim/.test(s || '') ? 'interim' : /^scaffolded/.test(s || '') ? 'scaffolded' : /^decided-out/.test(s || '') ? 'decided-out' : 'other');
/** close-out lint over parity rows (no browser): reasons that block the report; [] = clear */
export function gate(parity) {
  const out = [];
  for (const f of parity.features || []) {
    if (f.reproducibility === 'self' && bucket(f.status) === 'pending') out.push(`${f.feature} (${f.class}): reproducibility self, status "${f.status}" — implement it (D2) or set status interim with a reason and a named owner decision`);
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
  const origin = (arg('origin') || '').replace(/\/$/, '');
  if (!origin) { console.error('usage: dynamics-check.mjs --origin <published origin> [--parity stardust/dynamics/parity.json] [--out stardust/qa] [--gate]'); process.exit(2); }
  const parityFile = arg('parity', 'stardust/dynamics/parity.json');
  const gating = flag('gate');
  const parity = readJSON(parityFile, gating ? null : undefined);
  if (!parity) { console.error(`[dynamics-check] GATE: ${parityFile} missing — Phase 5 never ran; parity.json is required in both flows`); process.exit(3); }
  const results = await replay({ origin, parity, authHeader: resolveAuthHeader(), headed: flag('headed') });
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
