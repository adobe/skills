/**
 * qa/checks/browse.mjs — one browser pass per page per viewport, emitting three
 * check categories (a page load is the expensive unit — never pay it twice):
 *
 *   rendered (D) — geometry & runtime integrity at the rendered layer:
 *     page errors, console errors, failed/4xx same-origin requests, collapsed
 *     main/sections (getBoundingClientRect().height — computed display lies
 *     inside display:none ancestors), broken/upscaled images, mobile
 *     horizontal overflow, stalled EDS section decoration
 *   visual (E) — full-page screenshots vs committed baselines; first run
 *     creates baselines (info), later runs report % changed pixels. Diffs are
 *     computed in-browser in horizontal bands (no native image deps).
 *   a11y (H) — axe-core (CDN-injected) on the desktop viewport, violations
 *     deduped fleet-wide by rule; falls back to info when axe can't load.
 *
 * EDS-aware settle: waits for [data-section-status] to reach "loaded"
 * everywhere, then a grace delay — hanging third-party tags (GTM) stall
 * decoration, so a plain networkidle wait never fires.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadPlaywright, finding, pageUrl, pathSlug, ensureDir, pMap,
} from '../lib.mjs';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const AXE_CDN = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
const SETTLE_MS = 2000;
const DECORATION_TIMEOUT = 15000;
const DIFF_WARN = 0.005; // 0.5% pixels changed
const DIFF_ERROR = 0.05; // 5%

async function settle(page) {
  try {
    await page.waitForFunction(() => {
      const sections = [...document.querySelectorAll('[data-section-status]')];
      return sections.length === 0 || sections.every((s) => s.dataset.sectionStatus === 'loaded');
    }, null, { timeout: DECORATION_TIMEOUT });
    await page.waitForTimeout(SETTLE_MS);
    return true;
  } catch {
    await page.waitForTimeout(SETTLE_MS);
    return false;
  }
}

async function autoScroll(page) {
  // trigger lazy loading before a full-page screenshot (CDP capture doesn't)
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
}

/** Compare two PNGs inside the browser, in horizontal bands (memory-safe). */
async function pixelDiff(diffPage, pngA, pngB) {
  return diffPage.evaluate(async ([a64, b64]) => {
    const load = (b64) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode failed'));
      i.src = `data:image/png;base64,${b64}`;
    });
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    const w = Math.min(ia.width, ib.width);
    const h = Math.min(ia.height, ib.height);
    const BAND = 2000;
    const ca = document.createElement('canvas'); const cb = document.createElement('canvas');
    ca.width = w; cb.width = w;
    let diff = 0; const bands = [];
    for (let y = 0; y < h; y += BAND) {
      const bh = Math.min(BAND, h - y);
      ca.height = bh; cb.height = bh;
      const xa = ca.getContext('2d', { willReadFrequently: true });
      const xb = cb.getContext('2d', { willReadFrequently: true });
      xa.clearRect(0, 0, w, bh); xb.clearRect(0, 0, w, bh);
      xa.drawImage(ia, 0, y, w, bh, 0, 0, w, bh);
      xb.drawImage(ib, 0, y, w, bh, 0, 0, w, bh);
      const da = xa.getImageData(0, 0, w, bh).data;
      const db = xb.getImageData(0, 0, w, bh).data;
      let bandDiff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 48) bandDiff += 1;
      }
      diff += bandDiff;
      bands.push({ fromY: y, ratio: +(bandDiff / (w * bh)).toFixed(4) });
    }
    return {
      widthA: ia.width, heightA: ia.height, widthB: ib.width, heightB: ib.height,
      compared: { w, h }, diffPixels: diff, ratio: diff / (w * h), bands: bands.filter((b) => b.ratio > 0.001),
    };
  }, [pngA.toString('base64'), pngB.toString('base64')]);
}

export async function run(ctx) {
  const { base, inventory, opts } = ctx;
  const findings = [];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const baselineDir = opts.baselineDir;
  const shotDir = join(opts.outDir, 'shots');
  ensureDir(shotDir);
  if (baselineDir) ensureDir(baselineDir);

  const axeAgg = new Map(); // ruleId -> {impact, help, pages:Set, sample}
  const upscaled = new Map(); // src -> {pages:Set, nw, rw}
  // canvas diff worker; recreated on demand — a crashed tab must not sink the sweep
  let diffPage = null;
  const getDiffPage = async () => {
    if (!diffPage || diffPage.isClosed()) diffPage = await (await browser.newContext()).newPage();
    return diffPage;
  };

  await pMap(inventory.pages, async (p) => {
    for (const vp of VIEWPORTS) {
      // one page/viewport failing (tab crash, OOM) is a finding, never a sweep abort
      try {
        await sweepPage(p, vp);
      } catch (e) {
        findings.push(finding('rendered', 'page-sweep-failed', 'warn', p.path,
          `[${vp.name}] browser pass aborted mid-page: ${String(e).slice(0, 200)}`));
      }
    }
  }, opts.browserConcurrency || 3);

  async function sweepPage(p, vp) {
    {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const consoleErrors = []; const pageErrors = []; const badRequests = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
      page.on('requestfailed', (r) => {
        const failure = r.failure()?.errorText || '';
        if (r.url().startsWith(base) && !failure.includes('ERR_ABORTED')) {
          badRequests.push(`${failure} ${r.url().slice(base.length)}`.slice(0, 300));
        }
      });
      page.on('response', (r) => {
        if (r.url().startsWith(base) && r.status() >= 400) {
          badRequests.push(`HTTP ${r.status()} ${r.url().slice(base.length)}`.slice(0, 300));
        }
      });

      try {
        await page.goto(pageUrl(base, p.path), { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) {
        findings.push(finding('rendered', 'load-failed', 'error', p.path,
          `[${vp.name}] page failed to load: ${String(e).slice(0, 200)}`));
        await context.close();
        return;
      }
      const decorated = await settle(page);
      if (!decorated) {
        findings.push(finding('rendered', 'decoration-stalled', 'warn', p.path,
          `[${vp.name}] EDS section decoration did not reach "loaded" within ${DECORATION_TIMEOUT / 1000}s`));
      }
      await autoScroll(page);

      // ---- rendered (D): geometry --------------------------------------
      const geo = await page.evaluate(() => {
        const main = document.querySelector('main');
        const mainH = main ? Math.round(main.getBoundingClientRect().height) : 0;
        const sections = [...document.querySelectorAll('main > div')].map((s, i) => ({
          i,
          h: Math.round(s.getBoundingClientRect().height),
          status: s.dataset.sectionStatus || null,
          hasContent: !!(s.textContent.trim() || s.querySelector('img,picture,iframe,svg,form')),
          cls: s.className.slice(0, 80),
        }));
        const imgs = [...document.querySelectorAll('img')].map((img) => {
          const r = img.getBoundingClientRect();
          return {
            src: (img.currentSrc || img.src || '').slice(0, 250),
            complete: img.complete,
            nw: img.naturalWidth,
            rw: Math.round(r.width),
            visible: r.width > 0 && r.height > 0,
          };
        });
        return {
          mainH,
          sections,
          imgs,
          scrollW: document.scrollingElement.scrollWidth,
          innerW: window.innerWidth,
        };
      });

      if (geo.mainH < 50) {
        findings.push(finding('rendered', 'main-collapsed', 'error', p.path,
          `[${vp.name}] <main> renders ${geo.mainH}px tall — page is effectively blank`));
      }
      for (const s of geo.sections.filter((x) => x.hasContent && x.h === 0)) {
        findings.push(finding('rendered', 'section-collapsed', 'error', p.path,
          `[${vp.name}] section ${s.i} (${s.cls || 'no class'}) has content but renders 0px tall`,
          { section: s }));
      }
      const broken = geo.imgs.filter((i) => i.complete && i.nw === 0 && i.src && !i.src.startsWith('data:'));
      if (broken.length) {
        findings.push(finding('rendered', 'broken-image', 'error', p.path,
          `[${vp.name}] ${broken.length} image(s) failed to load`,
          { srcs: [...new Set(broken.map((i) => i.src))].slice(0, 8) }));
      }
      if (vp.name === 'desktop') {
        for (const i of geo.imgs.filter((x) => x.nw > 0 && x.nw < 200 && x.rw > x.nw * 2 && x.rw - x.nw > 100)) {
          if (!upscaled.has(i.src)) upscaled.set(i.src, { pages: new Set(), nw: i.nw, rw: i.rw });
          upscaled.get(i.src).pages.add(p.path);
        }
      }
      if (geo.scrollW > geo.innerW + 4) {
        findings.push(finding('rendered', 'horizontal-overflow', vp.name === 'mobile' ? 'error' : 'warn', p.path,
          `[${vp.name}] page scrolls horizontally (${geo.scrollW}px content in ${geo.innerW}px viewport)`));
      }
      if (pageErrors.length) {
        findings.push(finding('rendered', 'page-error', 'error', p.path,
          `[${vp.name}] ${pageErrors.length} uncaught JS error(s)`, { errors: [...new Set(pageErrors)].slice(0, 5) }));
      }
      if (consoleErrors.length) {
        findings.push(finding('rendered', 'console-error', 'warn', p.path,
          `[${vp.name}] ${consoleErrors.length} console error(s)`, { errors: [...new Set(consoleErrors)].slice(0, 5) }));
      }
      if (badRequests.length) {
        findings.push(finding('rendered', 'request-failed', 'error', p.path,
          `[${vp.name}] ${badRequests.length} same-origin request(s) failed`, { requests: [...new Set(badRequests)].slice(0, 8) }));
      }

      // ---- a11y (H): axe on desktop only --------------------------------
      if (vp.name === 'desktop' && !opts.skipA11y) {
        try {
          await page.addScriptTag({ url: AXE_CDN });
          const axe = await page.evaluate(async () => {
            const r = await window.axe.run(document, { resultTypes: ['violations'] });
            return r.violations.map((v) => ({
              id: v.id, impact: v.impact, help: v.help,
              sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
              nodes: v.nodes.length,
            }));
          });
          for (const v of axe) {
            if (!axeAgg.has(v.id)) axeAgg.set(v.id, { ...v, pages: new Set() });
            axeAgg.get(v.id).pages.add(p.path);
          }
        } catch (e) {
          findings.push(finding('a11y', 'axe-unavailable', 'info', p.path,
            `axe-core could not run: ${String(e).slice(0, 120)}`));
        }
      }

      // ---- visual (E): screenshot vs baseline ----------------------------
      try {
        const shot = await page.screenshot({
          fullPage: true,
          animations: 'disabled',
          mask: [page.locator('iframe')],
          timeout: 30000,
        });
        const name = `${pathSlug(p.path)}.${vp.name}.png`;
        writeFileSync(join(shotDir, name), shot);
        if (baselineDir) {
          const baseFile = join(baselineDir, name);
          if (!existsSync(baseFile)) {
            writeFileSync(baseFile, shot);
            findings.push(finding('visual', 'baseline-created', 'info', p.path,
              `[${vp.name}] no baseline existed — current screenshot saved as baseline`, { file: baseFile }));
          } else {
            const baseline = readFileSync(baseFile);
            const d = await pixelDiff(await getDiffPage(), baseline, shot);
            const heightDelta = Math.abs(d.heightA - d.heightB) / Math.max(d.heightA, 1);
            if (heightDelta > 0.02) {
              findings.push(finding('visual', 'page-height-changed', 'warn', p.path,
                `[${vp.name}] page height changed ${d.heightA}px -> ${d.heightB}px (${(heightDelta * 100).toFixed(1)}%) vs baseline`,
                { baseline: baseFile, current: join(shotDir, name) }));
            }
            if (d.ratio > DIFF_WARN) {
              findings.push(finding('visual', 'visual-diff', d.ratio > DIFF_ERROR ? 'error' : 'warn', p.path,
                `[${vp.name}] ${(d.ratio * 100).toFixed(2)}% of pixels differ from baseline — needs triage: regression or accepted change?`,
                { ratio: +d.ratio.toFixed(4), bands: d.bands.slice(0, 10), baseline: baseFile, current: join(shotDir, name) }));
            }
          }
        }
      } catch (e) {
        findings.push(finding('visual', 'screenshot-failed', 'warn', p.path,
          `[${vp.name}] screenshot failed: ${String(e).slice(0, 150)}`));
      }

      await context.close();
    }
  }

  // fleet-level aggregates
  for (const [src, u] of upscaled) {
    findings.push(finding('rendered', 'upscaled-image', 'warn', [...u.pages][0],
      `image rendered ${u.rw}px wide from a ${u.nw}px source (blurry) on ${u.pages.size} page(s)`,
      { src, pages: [...u.pages].slice(0, 8) }));
  }
  const impactSeverity = { critical: 'error', serious: 'error', moderate: 'warn', minor: 'info' };
  for (const [id, v] of axeAgg) {
    findings.push(finding('a11y', `axe-${id}`, impactSeverity[v.impact] || 'warn', [...v.pages][0],
      `${v.help} (${v.impact}) — ${v.pages.size} page(s) affected`,
      { rule: id, pages: [...v.pages].slice(0, 10), sampleTargets: v.sample, nodesOnFirstPage: v.nodes }));
  }

  await browser.close();
  return findings;
}
