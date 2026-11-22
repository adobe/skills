#!/usr/bin/env node
/**
 * replica/scripts/smoke-check.mjs — fast delivery smoke check for replayed (pre-gated) pages.
 *
 * Not a fidelity gate: fidelity was proven when the fixture was built (published-origin gate). This proves
 * the DELIVERY of this run is sound, for every page at once:
 *   1. the page answers 200 on the served origin and its delivered markup has no about:error (broken media);
 *   2. in Chrome at <width>: every block decorates (data-block-status="loaded"), no page error, every font face
 *      that was requested loaded;
 *   3. the first viewport (width × height) differs from the page's frozen source reference
 *      (stardust/replica/gates/<slug>-<width>/baseline.png, top rows) by at most --max-pct.
 *
 * Usage (from the project root):
 *   node stardust/scripts/replica/smoke-check.mjs --origin <https://host> --pages '<json [{slug,path}]>'
 *        [--width 1440] [--height 900] [--max-pct 10] [--out stardust/replica/gates/smoke-1440]
 * Writes: <out>/summary.json ({ rows: [{slug, path, pass, http, aboutError, blocks, blocksLoaded,
 *         pageErrors, fontsFailed, topPct, reasons}], pass, at }); screenshots to --shots (default
 *         stardust/.work/smoke-<width>/<slug>-top.png, scratch, not committed).
 * Exit: 0 every page passes · 2 any page fails · 1 error.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const { chromium } = await import('playwright');
const { PNG } = await import('pngjs');
const pixelmatch = (await import('pixelmatch')).default;
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ORIGIN = String(opt('--origin', '')).replace(/\/$/, '');
const PAGES = JSON.parse(opt('--pages', '[]'));
const W = Number(opt('--width', 1440));
const H = Number(opt('--height', 900));
const MAX = Number(opt('--max-pct', 10));
const OUT = opt('--out', `stardust/replica/gates/smoke-${W}`);
if (!ORIGIN || !PAGES.length) { console.error('usage: --origin <url> --pages <json>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
// screenshots are scratch (not committed: a checkpoint pushing six full-width PNGs cost ~15 s); the summary is the record
const SHOTS = opt('--shots', `stardust/.work/smoke-${W}`);
fs.mkdirSync(SHOTS, { recursive: true });

async function one(browser, pg) {
  const row = { slug: pg.slug, path: pg.path, pass: false, reasons: [] };
  const url = `${ORIGIN}${pg.path}`;
  try {
    const plain = await fetch(`${ORIGIN}${pg.path === '/' ? '/index' : pg.path}.plain.html?cb=${Date.now()}`);
    row.http = plain.status;
    row.aboutError = ((await plain.text()).match(/about:error/g) || []).length;
  } catch (e) { row.http = 0; row.reasons.push(`fetch: ${e.message}`); }
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  try {
    await page.goto(`${url}?cb=${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('main .block, header .block, footer .block')];
      return b.length > 0 && b.every((x) => x.dataset.blockStatus === 'loaded');
    }, null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(2000); // the page's own entrance motion settles (a reduced-motion or frozen capture differs from the reference)
    const st = await page.evaluate(() => {
      const b = [...document.querySelectorAll('main .block, header .block, footer .block')];
      return {
        blocks: b.length,
        blocksLoaded: b.filter((x) => x.dataset.blockStatus === 'loaded').length,
        fontsFailed: [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`),
      };
    });
    Object.assign(row, st);
    row.pageErrors = errors;
    const shot = path.join(SHOTS, `${pg.slug}-top.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: W, height: H } });
    const ref = path.join('stardust/replica/gates', `${pg.slug}-${W}`, 'baseline.png');
    if (fs.existsSync(ref)) {
      const a = PNG.sync.read(fs.readFileSync(ref));
      const b = PNG.sync.read(fs.readFileSync(shot));
      const h = Math.min(H, a.height, b.height);
      const crop = (img) => { const o = new PNG({ width: W, height: h }); for (let y = 0; y < h; y += 1) img.data.copy(o.data, y * W * 4, y * img.width * 4, y * img.width * 4 + W * 4); return o; };
      const ca = crop(a); const cb = crop(b);
      const n = pixelmatch(ca.data, cb.data, null, W, h, { threshold: 0.1 });
      row.topPct = Math.round((n / (W * h)) * 10000) / 100;
    } else row.reasons.push('no frozen reference for the top-viewport compare');
  } catch (e) { row.reasons.push(`load: ${e.message.slice(0, 160)}`); }
  await ctx.close();
  if (row.http !== 200) row.reasons.push(`http ${row.http}`);
  if (row.aboutError) row.reasons.push(`about:error ×${row.aboutError}`);
  if (!row.blocks || row.blocksLoaded !== row.blocks) row.reasons.push(`blocks ${row.blocksLoaded}/${row.blocks}`);
  if (row.pageErrors?.length) row.reasons.push(`page errors ${row.pageErrors.length}`);
  if (row.fontsFailed?.length) row.reasons.push(`fonts failed ${row.fontsFailed.join(', ')}`);
  if (row.topPct == null || row.topPct > MAX) row.reasons.push(`top viewport ${row.topPct ?? '?'}% > ${MAX}%`);
  row.pass = row.reasons.length === 0;
  return row;
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const rows = await Promise.all(PAGES.map((pg) => one(browser, pg)));
await browser.close();
const pass = rows.every((r) => r.pass);
fs.writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify({ at: new Date().toISOString(), origin: ORIGIN, width: W, height: H, maxPct: MAX, pass, rows }, null, 2)}\n`);
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.path} http ${r.http} blocks ${r.blocksLoaded}/${r.blocks} top ${r.topPct}%${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`);
console.log(`smoke: ${rows.filter((r) => r.pass).length}/${rows.length} PASS`);
process.exit(pass ? 0 : 2);
