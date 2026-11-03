#!/usr/bin/env node
/**
 * Renders the EDS page and compares it with the captured source, full page and per region.
 * Usage: node compare.mjs <edsUrl> <sourceDir> <outDir>
 *          [--map map.json] [--only r3,r4] [--session name] [--mobile | --tablet] [--no-full]
 *          [--static]   (--static: plain HTML page, don't wait for EDS decoration)
 * map.json: { "r1": "header", "r3": "main > .section:nth-of-type(1)", ... } (region -> EDS selector)
 * Slices (<sourceDir>/slices.json, written by shell.mjs --cuts) are regions too, by their id.
 * Writes <outDir>/eds-<vp>.png, full-diff-<vp>.png, report-<vp>.json, regions/<id>[.<vp>].side.png
 * (source | EDS | diff, side by side, shrunk to 1800 px: for humans) and regions/<id>[.<vp>].views/
 * (views.json, a scaled overview and full-resolution crops around the differences, each sized to
 * reach the model unresized: what the agent judges on). Prints per region: height delta, pixel
 * mismatch, text recall (source words visible on the EDS page; hidden text counts as lost),
 * unrendered icons and the views.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { STEADY } from './lib/ab-tests.mjs';
import { clsOf } from './lib/cls.mjs';
import { closeSession, openSession, runCode, stitchTiles, TILED_SHOT } from './lib/browser.mjs';
import { isMain } from './lib/is-main.mjs';
import { padTo, writeSheet, writeViews } from './lib/views-write.mjs';

/** The command's options (node:util parseArgs), with their defaults. */
export const OPTIONS = {
  map: { type: 'string' }, only: { type: 'string' }, session: { type: 'string', default: 'plg-cmp' },
  mobile: { type: 'boolean', default: false }, tablet: { type: 'boolean', default: false },
  'no-full': { type: 'boolean', default: false },
  static: { type: 'boolean', default: false },
};

/**
 * The comparison as a function (the web-header binary's `header check pixels`): writes <outDir>
 * as the command does and returns { report, lines } (report-<vp>.json's content, the lines the
 * command prints). `opts`: OPTIONS by name; missing ones take their defaults.
 */
export async function comparePage(edsUrl, srcArg, outArg, opts = {}) {
  const opt = { ...Object.fromEntries(Object.entries(OPTIONS).filter(([, v]) => 'default' in v).map(([k, v]) => [k, v.default])),
    ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const lines = [];
  const srcDir = resolve(srcArg);
  const out = resolve(outArg);
  mkdirSync(join(out, 'regions'), { recursive: true });
  const source = JSON.parse(readFileSync(join(srcDir, 'page.json'), 'utf8'));
  const map = opt.map ? JSON.parse(readFileSync(resolve(opt.map), 'utf8')) : {};
  const only = opt.only ? new Set(opt.only.split(',')) : null;
  const vp = (opt.mobile && 'mobile') || (opt.tablet && 'tablet') || 'desktop';
  const [width, height] = { desktop: [1440, 900], tablet: [820, 1180], mobile: [390, 844] }[vp];
  const shot = join(out, `eds-${vp}.png`);
  const srcShot = join(srcDir, `${vp}.png`);

  openSession(opt.session, { width, height });
  const rects = runCode(opt.session, `async page => {
    // layout shift while the page loads (blocks and their CSS arrive late): its total, and the
    // section, header or footer each moved element belongs to
    await page.addInitScript(() => {
      window.__plgShifts = [];
      const where = (n) => {
        const s = n && n.closest && n.closest('main > .section, body > header, body > footer, main');
        if (!s) return '?';
        return s.matches('.section') ? '.' + [...s.classList].filter((c) => c !== 'section').join('.') : s.tagName.toLowerCase();
      };
      // the boxes' heights on every frame while loading: one that resized above the moved ones
      // is the cause (a box's first appearance, from 0, is not a resize)
      window.__plgHeights = [];
      const t0 = performance.now();
      const sample = () => {
        if (document.body) {
          window.__plgHeights.push(Object.fromEntries([...document.querySelectorAll('main > .section, body > header, body > footer')]
            .map((b) => [where(b), Math.round(b.getBoundingClientRect().height)])));
        }
        if (performance.now() - t0 < 5000) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      new PerformanceObserver((l) => { for (const e of l.getEntries()) {
        if (!e.hadRecentInput) window.__plgShifts.push({ v: e.value, at: [...new Set((e.sources || []).map((s) => where(s.node)))] });
      } }).observe({ type: 'layout-shift', buffered: true });
    });
    // held still as the capture held the source (a rotating placeholder: the retailer, ap-1)
    await page.addInitScript(${STEADY});
    await page.goto(${JSON.stringify(edsUrl)}, { waitUntil: 'load', timeout: 60000 });
    if (!${opt.static}) await page.waitForFunction(() => document.body.classList.contains('appear'), null, { timeout: 15000 });
    // [data-block-status], not .block: the boilerplate's widget block drops its .block class
    await page.waitForFunction(() => [...document.querySelectorAll('[data-block-status]')]
      .every(b => b.dataset.blockStatus === 'loaded'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    const shifts = await page.evaluate(() => [...window.__plgShifts,
      ...window.__plgHeights.map((heights) => ({ v: 0, at: [], heights }))]);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 600) { await page.evaluate(v => scrollTo(0, v), y); await page.waitForTimeout(60); }
    await page.evaluate(() => scrollTo(0, 0));
    // [data-block-status], not .block: the boilerplate's widget block drops its .block class
    await page.waitForFunction(() => [...document.querySelectorAll('[data-block-status]')]
      .every(b => b.dataset.blockStatus === 'loaded'), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    // images inside legacy shadow roots are invisible to document.images: collect them deeply
    await page.evaluate(() => {
      window.__plgImgs = () => [...document.images, ...[...document.querySelectorAll('*')]
        .filter(e => e.shadowRoot).flatMap(e => [...e.shadowRoot.querySelectorAll('img')])];
      window.__plgImgs().forEach(i => { i.loading = 'eager'; });
    });
    await page.waitForFunction(() => window.__plgImgs().every(i => i.complete), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    await (${TILED_SHOT})(page, ${JSON.stringify(shot)});
    const map = ${JSON.stringify(map)};
    // a page wider than the viewport scrolls sideways: no region crop shows it
    const rects = { __overflow: await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth), __shifts: shifts };
    for (const [id, sel] of Object.entries(map)) {
      rects[id] = await page.evaluate(s => {
        const els = [...document.querySelectorAll(s)];
        if (!els.length) return null;
        const rs = els.map(e => e.getBoundingClientRect());
        const top = Math.min(...rs.map(r => r.top)) + scrollY;
        const bottom = Math.max(...rs.map(r => r.bottom)) + scrollY;
        const deep = e => [e.innerText, ...[...e.querySelectorAll('*')].filter(x => x.shadowRoot).map(x => x.shadowRoot.firstElementChild?.innerText || '')].join(' ');
        const text = els.map(deep).join(' ');
        return { y: Math.round(top), h: Math.round(bottom - top), text };
      }, sel);
    }
    return JSON.stringify(rects);
  }`);
  closeSession(opt.session);
  await stitchTiles(shot);

  async function loadPng(file, top = 0, height = null) {
    const img = sharp(file);
    const meta = await img.metadata();
    const h = height ?? meta.height;
    const t = Math.min(Math.max(0, top), meta.height - 1);
    const hh = Math.max(1, Math.min(h, meta.height - t));
    const { data, info } = await img.extract({ left: 0, top: t, width: Math.min(meta.width, width), height: hh })
      // on white, as a browser shows it: a semi-transparent row in a shot is not a difference (s2b)
      .flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  }

  async function diff(a, b, diffFile, sideFile) {
    const w = Math.max(a.w, b.w);
    const h = Math.max(a.h, b.h);
    const pa = padTo(a, w, h);
    const pb = padTo(b, w, h);
    const d = new PNG({ width: w, height: h });
    const n = pixelmatch(pa, pb, d.data, w, h, { threshold: 0.1 });
    if (diffFile) writeFileSync(diffFile, PNG.sync.write(d));
    const region = { pa, pb, d: d.data, w, h };
    if (sideFile) await writeSheet(region, sideFile);
    return { mismatch: +(100 * n / (w * h)).toFixed(2), w, h, region };
  }

  const cls = clsOf(rects.__shifts ?? []);
  const report = { edsUrl, viewport: vp, width, overflow: rects.__overflow, cls, regions: {} };
  if (!opt['no-full']) {
    const { region: _full, ...full } = await diff(await loadPng(srcShot), await loadPng(shot),
      join(out, `full-diff-${vp}.png`));
    report.full = full;
    report.full.srcH = (await sharp(srcShot).metadata()).height;
    report.full.edsH = (await sharp(shot).metadata()).height;
  }
  const words = (t) => (t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  function textRecall(srcText, edsText) {
    const bag = new Map();
    words(edsText).forEach((w) => bag.set(w, (bag.get(w) || 0) + 1));
    const src = words(srcText);
    const lost = [];
    for (const w of src) {
      if (bag.get(w)) bag.set(w, bag.get(w) - 1);
      else lost.push(w);
    }
    return { recall: src.length ? +(100 * (1 - lost.length / src.length)).toFixed(1) : 100, lost };
  }

  const rows = [];
  const slicesFile = join(srcDir, 'slices.json');
  const slices = existsSync(slicesFile) ? JSON.parse(readFileSync(slicesFile, 'utf8')) : [];
  const byId = Object.fromEntries([...source.regions, ...slices].map((r) => [r.id, r]));
  const rectOf = (r) => (vp === 'desktop' ? r.rect : r[`${vp}Rect`]);
  // a requested key the capture has no region for, or whose regions the source does not show at
  // this width, is said so: skipped silently, it read as a clean comparison (PR #27 review)
  const unknown = [];
  const notShown = [];
  for (const key of Object.keys(map)) {
    const ids = key.split('+');
    if (only && !ids.some((id) => only.has(id))) continue;
    if (ids.some((id) => !byId[id])) { unknown.push(key); continue; }
    const parts = ids.map((id) => byId[id]).filter((p) => rectOf(p));
    if (!parts.length) { notShown.push(key); continue; }
    const er = rects[key];
    if (!er) continue;
    const top = Math.min(...parts.map((p) => rectOf(p).y));
    const srcH = Math.max(...parts.map((p) => rectOf(p).y + rectOf(p).h)) - top;
    const a = await loadPng(srcShot, top, srcH);
    const b = await loadPng(shot, er.y, er.h);
    const base = join(out, 'regions', `${key}${vp === 'desktop' ? '' : `.${vp}`}`);
    const side = `${base}.side.png`;
    const { region, ...r } = await diff(a, b, null, side);
    // full-resolution views for the agent: side.png is shrunk to 1800 px (s8)
    const views = await writeViews(region, `${base}.views`);
    const srcText = ids.map((id) => {
      const f = join(srcDir, 'regions', `${id}.txt`);
      return existsSync(f) ? readFileSync(f, 'utf8') : '';
    }).join(' ');
    // region text files hold the desktop text; at other widths menus etc. are legitimately hidden
    const t = vp !== 'desktop' ? { recall: null, lost: [] } : textRecall(srcText, er.text);
    const leftovers = [...new Set((er.text.match(/:[a-z][a-z0-9-]*:/gi) || []))];
    report.regions[key] = { srcY: top, srcH, edsY: er.y, edsH: er.h, ...r, textRecall: t.recall,
      lostWords: t.lost.slice(0, 40), leftovers, views: `${base}.views`, viewsMode: views.mode };
    rows.push(`${key.padEnd(7)} src@${top}+${srcH}  eds@${er.y}+${er.h}  dH=${er.h - srcH}  `
      + `mismatch=${r.mismatch}%${t.recall === null ? '' : `  text=${t.recall}%`}`
      + `${t.lost.length ? ` lost:[${t.lost.slice(0, 8).join(' ')}${t.lost.length > 8 ? ' …' : ''}]` : ''}`
      + `${leftovers.length ? ` UNRENDERED:${leftovers.join(',')}` : ''}  side=${side}`
      + `  views=${views.views.length} ${views.mode}`);
  }
  // the page has no element for a requested key (its selector matched nothing)
  const missing = Object.keys(map).filter((k) => !rects[k] && (!only || k.split('+').some((id) => only.has(id))));
  Object.assign(report, { missing, unknown, notShown });
  writeFileSync(join(out, `report-${vp}.json`), JSON.stringify(report, null, 2));
  if (report.full) {
    lines.push(`FULL ${vp}: mismatch=${report.full.mismatch}% `
      + `(src h=${report.full.srcH}, eds h=${report.full.edsH})`
      + `${report.overflow > 0 ? `  OVERFLOW: the page is ${report.overflow}px wider than the viewport` : ''}`
      + `${cls.value > 0.1 ? `  CLS ${cls.value} > 0.1 (moved: ${cls.by.map(([k, v]) => `${k} ${v}`).join(', ')}; `
        + `resized while loading: ${cls.resized.map(([k, hs]) => `${k} ${hs.join('->')}px`).join(', ') || 'none'})` : ''}`);
  }
  rows.forEach((r) => lines.push(r));
  if (missing.length) lines.push(`MISSING in EDS (selector matched nothing): ${missing.join(', ')}`);
  if (unknown.length) lines.push(`UNKNOWN in the capture (no region with that id): ${unknown.join(', ')}`);
  if (notShown.length) lines.push(`NOT SHOWN at ${vp} on the source (not compared): ${notShown.join(', ')}`);
  return { report, lines };
}

if (isMain(import.meta.url)) {
  const { values, positionals: [edsUrl, srcArg, outArg] } = parseArgs({ allowPositionals: true, options: OPTIONS });
  if (!edsUrl || !srcArg || !outArg) {
    console.error('usage: node compare.mjs <edsUrl> <sourceDir> <outDir> [--map map.json] [--only ids]');
    process.exit(2);
  }
  (await comparePage(edsUrl, srcArg, outArg, values)).lines.forEach((l) => console.log(l));
}
