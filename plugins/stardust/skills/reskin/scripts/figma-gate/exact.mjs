// skills/reskin/scripts/figma-gate/exact.mjs — (f) EXACT FIDELITY, Figma-only sites (reference/gates.md § (f)).
// Blocking pixel gates against Figma's own renders (reskin/figma-renders.json, figma-donor.mjs renders):
//   exact    each page, at every breakpoint frame's width: the page screenshot (full height, lazy content
//            scrolled in) against the frame PNG — differing-pixel share ≤ bar, |height delta| ≤ heightTol
//   library  each variant of each kit block on its library page (urlPattern, {block} substituted): the
//            element [data-kit-component="<variant id>"] (its block when it holds one) against the variant
//            PNG — share ≤ bar, |width delta| and |height delta| ≤ sizeTol; a variant the page does not
//            show fails: the library is the whole kit, used on a page or not
// Comparison is replica's pixel-compare (overlap, per-band breakdown). verdict and gateRow are pure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { readJsonIf } from '../figma/io.mjs';
import { pixelComparePath } from './pixel.mjs';
import { loadChromium, toUrl } from './target.mjs';

export const DEFAULT_BAR = 3;
export const DEFAULT_HEIGHT_TOL = 8;
export const DEFAULT_SIZE_TOL = 2;
const DEADLINE_EXIT = 124;
const BP_ORDER = { desktop: 0, tablet: 1, mobile: 2 };

// PASS | FAIL with the reasons, from one comparison's numbers and the bars.
export function verdict({ pct, heightDelta = 0, widthDelta = 0 }, { bar = DEFAULT_BAR, heightTol = DEFAULT_HEIGHT_TOL, widthTol = Infinity } = {}) {
  const why = [];
  if (!(pct <= bar)) why.push(`${pct}% > ${bar}%`);
  if (Math.abs(heightDelta) > heightTol) why.push(`height Δ ${heightDelta}px > ±${heightTol}`);
  if (Math.abs(widthDelta) > widthTol) why.push(`width Δ ${widthDelta}px > ±${widthTol}`);
  return { verdict: why.length ? 'FAIL' : 'PASS', why };
}

export const similarity = (rows) => {
  const n = rows.filter((r) => typeof r.pct === 'number');
  return n.length ? Number((100 - n.reduce((s, r) => s + r.pct, 0) / n.length).toFixed(2)) : null;
};

export const gateRow = (r) => `${r.verdict.padEnd(5)} ${r.key}${typeof r.pct === 'number' ? ` ${r.pct}%` : ''}${r.heightDelta ? ` Δh ${r.heightDelta}` : ''}${r.widthDelta ? ` Δw ${r.widthDelta}` : ''}${r.why?.length ? ` — ${r.why.join('; ')}` : ''}`;

function compare(a, b, out, timeout) {
  const r = spawnSync(process.execPath, [pixelComparePath(), a, b, '--out', out, '--json', '--threshold', '100', '--timeout', String(timeout)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === DEADLINE_EXIT) return { exit: DEADLINE_EXIT };
  if (r.status !== 0) throw new Error(`pixel-compare exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`);
  const j = JSON.parse(r.stdout);
  return { pct: j.pct, heightDelta: j.heightDelta, bands: (j.bands || []).filter((x) => x.pct > 0).slice(0, 6) };
}

// Figma exports transparent pixels where a frame or variant has no fill; the browser paints white there.
// Composite the reference onto white (once per file, cached beside the diff) so alpha never counts as a difference.
async function flattenOnWhite(src, dst) {
  const { PNG } = await import('pngjs');
  const p = PNG.sync.read(readFileSync(src));
  let opaque = true;
  for (let i = 3; i < p.data.length; i += 4) {
    const a = p.data[i];
    if (a !== 255) {
      opaque = false;
      for (let c = i - 3; c < i; c += 1) p.data[c] = Math.round((p.data[c] * a + 255 * (255 - a)) / 255);
      p.data[i] = 255;
    }
  }
  if (opaque) return src;
  writeFileSync(dst, PNG.sync.write(p));
  return dst;
}

async function pngSize(file) {
  const { PNG } = await import('pngjs');
  const p = PNG.sync.read(readFileSync(file));
  return { width: p.width, height: p.height };
}

async function settle(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    await document.fonts?.ready;
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

function loadRenders(dir) {
  const r = readJsonIf(join(dir, 'reskin', 'figma-renders.json'));
  if (!r) throw new UsageError(`${join(dir, 'reskin', 'figma-renders.json')} is missing: run figma-donor.mjs renders <figma-url> first`);
  return r;
}

async function withBrowser(fn) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try { return await fn(browser); } finally { await browser.close(); }
}

// → { rows: [{ key, breakpoint, width, verdict, pct, heightDelta, why, files }], similarity }
export async function runExact({ dir, slug, url, bar = DEFAULT_BAR, heightTol = DEFAULT_HEIGHT_TOL, timeout = 120, out }) {
  const renders = loadRenders(dir);
  const frames = (renders.pages?.[slug] || []).slice().sort((a, b) => (BP_ORDER[a.breakpoint] ?? 9) - (BP_ORDER[b.breakpoint] ?? 9));
  if (!frames.length) throw new UsageError(`figma-renders.json has no frames for page "${slug}" (pages: ${Object.keys(renders.pages || {}).join(', ')})`);
  mkdirSync(out, { recursive: true });
  const rows = [];
  await withBrowser(async (browser) => {
    for (const f of frames) {
      const key = `${slug}@${f.breakpoint}`;
      const ref = f.png && resolve(dir, f.png);
      if (!ref || !existsSync(ref)) { rows.push({ key, breakpoint: f.breakpoint, verdict: 'FAIL', why: ['no Figma render (re-run figma-donor.mjs renders)'] }); continue; }
      const size = await pngSize(ref);
      const width = Math.round(size.width / (renders.scale || 1));
      // the frame is the viewport: its height sizes 100vh layouts and lets a frame shorter than a screen pass
      const height = Math.round(size.height / (renders.scale || 1));
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: renders.scale || 1 });
      const page = await ctx.newPage();
      await page.goto(toUrl(url), { waitUntil: 'load' });
      await settle(page);
      const files = { figma: await flattenOnWhite(ref, join(out, `${f.breakpoint}.figma.png`)), page: join(out, `${f.breakpoint}.page.png`), diff: join(out, `${f.breakpoint}.diff.png`) };
      writeFileSync(files.page, await page.screenshot({ fullPage: true, animations: 'disabled' }));
      await ctx.close();
      const c = compare(files.figma, files.page, files.diff, timeout);
      if (c.exit === DEADLINE_EXIT) { rows.push({ key, breakpoint: f.breakpoint, width, verdict: 'NO VERDICT', why: [`pixel-compare hit its ${timeout}s deadline`] }); continue; }
      rows.push({ key, breakpoint: f.breakpoint, width, ...c, ...verdict(c, { bar, heightTol }), files });
    }
  });
  const summary = { gate: 'exact', page: slug, url, bar, heightTol, rows, similarity: similarity(rows), pass: rows.every((r) => r.verdict === 'PASS') };
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

// → { blocks: { block: { pass, similarity, rows } }, rows, similarity, pass }
export async function runLibrary({ dir, urlPattern, blocks = null, bar = DEFAULT_BAR, sizeTol = DEFAULT_SIZE_TOL, timeout = 60, out }) {
  if (!/\{block\}/.test(urlPattern)) throw new UsageError(`--url-pattern "${urlPattern}" needs {block} (e.g. http://localhost:3000/library/{block})`);
  const renders = loadRenders(dir);
  const all = Object.entries(renders.library || {});
  const unknown = (blocks || []).filter((b) => !renders.library?.[b]);
  if (unknown.length) throw new UsageError(`--block ${unknown.join(', ')} not in figma-renders.json (blocks: ${all.map(([b]) => b).join(', ')})`);
  const list = blocks?.length ? all.filter(([b]) => blocks.includes(b)) : all;
  mkdirSync(out, { recursive: true });
  const rows = [];
  await withBrowser(async (browser) => {
    for (const [block, entry] of list) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: renders.scale || 1 });
      const page = await ctx.newPage();
      const url = urlPattern.replace('{block}', block);
      const res = await page.goto(toUrl(url), { waitUntil: 'load' }).catch((e) => ({ status: () => 0, err: e }));
      if (!res || res.status() >= 400 || res.err) {
        for (const v of entry.variants) rows.push({ key: `${block}/${v.name}`, block, id: v.id, verdict: 'FAIL', why: [`library page ${url} → ${res?.err ? res.err.message.split('\n')[0] : res?.status()}`] });
        await ctx.close();
        continue;
      }
      await settle(page);
      for (const v of entry.variants) {
        const key = `${block}/${v.name}`;
        const base = { key, block, id: v.id, set: v.set, classes: v.classes };
        const ref = v.png && resolve(dir, v.png);
        if (!ref || !existsSync(ref)) { rows.push({ ...base, verdict: 'FAIL', why: ['no Figma render (re-run figma-donor.mjs renders)'] }); continue; }
        const host = page.locator(`[data-kit-component="${v.id}"]`);
        if (await host.count() === 0) { rows.push({ ...base, verdict: 'FAIL', why: [`[data-kit-component="${v.id}"] is not on ${url}`] }); continue; }
        const inner = host.first().locator(`.${block}`);
        const el = (await inner.count()) ? inner.first() : host.first();
        const size = await pngSize(ref);
        const scale = renders.scale || 1;
        if (v.breakpoint === 'mobile' || v.breakpoint === 'tablet') await page.setViewportSize({ width: Math.max(320, Math.round(size.width / scale)), height: 900 });
        else await page.setViewportSize({ width: 1440, height: 900 });
        await el.scrollIntoViewIfNeeded();
        const stem = join(out, `${block}.${String(v.id).replace(/[^A-Za-z0-9]+/g, '-')}`);
        const files = { figma: await flattenOnWhite(ref, `${stem}.figma.png`), page: `${stem}.page.png`, diff: `${stem}.diff.png` };
        writeFileSync(files.page, await el.screenshot({ animations: 'disabled' }));
        const got = await pngSize(files.page);
        const c = compare(files.figma, files.page, files.diff, timeout);
        if (c.exit === DEADLINE_EXIT) { rows.push({ ...base, verdict: 'NO VERDICT', why: [`pixel-compare hit its ${timeout}s deadline`] }); continue; }
        const widthDelta = Math.round((got.width - size.width) / scale);
        rows.push({ ...base, ...c, widthDelta, ...verdict({ ...c, widthDelta }, { bar, heightTol: sizeTol, widthTol: sizeTol }), files });
      }
      await ctx.close();
    }
  });
  const byBlock = {};
  for (const r of rows) (byBlock[r.block] ||= { rows: [] }).rows.push(r);
  for (const b of Object.values(byBlock)) { b.pass = b.rows.every((r) => r.verdict === 'PASS'); b.similarity = similarity(b.rows); }
  const summary = { gate: 'library', urlPattern, bar, sizeTol, blocks: byBlock, rows, similarity: similarity(rows), pass: rows.every((r) => r.verdict === 'PASS') };
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
