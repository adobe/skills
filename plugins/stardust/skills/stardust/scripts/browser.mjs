/**
 * skills/stardust/scripts/browser.mjs
 *
 * The one entry to the browser for every stardust script: load Playwright, open a browser in one of three modes,
 * make contexts and pages, navigate. The live-site rules (identity, pacing, overlays) stay in live-session.mjs,
 * re-exported here, so a script needs only this file. A library: no CLI.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchLiveBrowser, launchStealthHeaded } from './live-session.mjs';

export * from './live-session.mjs';

const INSTALL_LINE = 'npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps';

let playwrightModule;

const notFound = (error) => error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND';
const firstLine = (error) => String(error?.message ?? error).split('\n')[0];
function broken(where, cause) {
  return Object.assign(new Error(`playwright is installed (${where}) but failed to load: ${firstLine(cause)}`, { cause }), { code: 'PLAYWRIGHT_BROKEN' });
}

// Where playwright resolves from, or null when it is not installed there. Resolving loads nothing, so "not
// found" here is about playwright itself, never about one of its dependencies.
function resolveFrom(where, resolve) {
  try { return resolve(); } catch (error) {
    if (notFound(error)) return null;
    throw broken(where, error);
  }
}

// The project at the working directory first, then this file's own location. The first copy that resolves
// is the one that loads: a copy that fails to load is an error, never replaced by the other one (another
// playwright brings another bundled browser).
async function importPlaywright() {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolveFrom(process.cwd(), () => ({ where: process.cwd(), url: pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')).href }))
    ?? resolveFrom(here, () => ({ where: here, url: import.meta.resolve('playwright') }));
  if (!entry) {
    throw Object.assign(new Error(`playwright is not importable from ${here} or from ${process.cwd()}. From the project root run: ${INSTALL_LINE}`), { code: 'PLAYWRIGHT_MISSING' });
  }
  let mod;
  try { mod = await import(entry.url); } catch (error) { throw broken(entry.where, error); }
  return mod.chromium ? mod : mod.default;
}

/** The playwright module ({ chromium, … }), loaded once. Tries the working directory's project, then the script's own location. */
export function loadPlaywright() {
  playwrightModule ??= importPlaywright().catch((error) => { playwrightModule = undefined; throw error; });
  return playwrightModule;
}

/**
 * Open a browser. `mode`: 'chrome' (default, real Chrome headless), 'headed' (the stealth escalation tier) or
 * 'plain' (`chromium.launch(launchOptions)`, tagged `tier`, default 'chromium'). `launchOptions` and `tier` belong
 * to 'plain' only. `playwright` is a stub module for tests.
 */
export async function openBrowser({ mode = 'chrome', launchOptions, tier, playwright } = {}) {
  if (!['chrome', 'headed', 'plain'].includes(mode)) throw new Error(`openBrowser: unknown mode '${mode}' (chrome, headed or plain)`);
  if (mode !== 'plain' && (launchOptions !== undefined || tier !== undefined)) throw new Error(`openBrowser: launchOptions and tier are for mode 'plain' only, not '${mode}'`);
  const { chromium } = playwright ?? await loadPlaywright();
  if (mode === 'chrome') return recordBrowserUse(await launchLiveBrowser(chromium));
  if (mode === 'headed') return recordBrowserUse(await launchStealthHeaded(chromium));
  const browser = await chromium.launch(launchOptions ?? {});
  browser.stardustTier = tier || 'chromium';
  return recordBrowserUse(browser);
}

export const newContext = (browser, options = {}) => browser.newContext(options);
export const newPage = (browser, options = {}) => browser.newPage(options);
export const goto = (page, url, options = {}) => { firstUrl ??= url; return page.goto(url, options); };

// ---- PILOT ONLY (not for merge): a record of every browser this process opens and closes -------------------------
// One JSON line per event, appended to stardust/replica/browser-use.jsonl of the project at the working directory
// (a path the project commits: stardust/.gitignore ignores .work/, *.log, *.out, PNGs — not this), so a lab run's
// repository holds how many browsers were open at once. { ts, ev: 'open' | 'close', pid, ppid, script, id, host, via }
// — script = the entry script's basename; id = one per browser; host = the host of the first http(s) URL among the
// script's arguments, else of the first URL given to goto() (so often null on 'open'), else null; via (close only) =
// 'close' (browser.close() returned), 'disconnected' (the browser went away by itself) or 'exit' (the process ended
// with it open; a process ended by a signal writes nothing — the reader handles an open without a close).
// On by default; STARDUST_BROWSER_USE=0 turns it off; STARDUST_BROWSER_USE_FILE names another file. Written only
// where a stardust/ directory exists. Recording only: one small synchronous append, every failure swallowed.
let firstUrl; let useSeq = 0; let exitHooked = false;
const stillOpen = new Map();
const hostOf = (u) => { try { return new URL(String(u)).host || null; } catch { return null; } };
function noteBrowserUse(ev, id, via) {
  try {
    if (process.env.STARDUST_BROWSER_USE === '0') return;
    let file = process.env.STARDUST_BROWSER_USE_FILE;
    if (!file) {
      if (!existsSync('stardust')) return;
      mkdirSync(join('stardust', 'replica'), { recursive: true });
      file = join('stardust', 'replica', 'browser-use.jsonl');
    }
    const arg = process.argv.slice(2).find((a) => /^https?:\/\//i.test(a));
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ev, pid: process.pid, ppid: process.ppid, script: process.argv[1] ? basename(process.argv[1]) : null, id, host: hostOf(arg ?? firstUrl), ...(via ? { via } : {}) })}\n`);
  } catch { /* recording only */ }
}
/** Records the browser's open now and its close once (close() returned, 'disconnected', or the process's exit). → the browser, unchanged in behaviour. */
export function recordBrowserUse(browser) {
  try {
    if (!browser || process.env.STARDUST_BROWSER_USE === '0') return browser;
    useSeq += 1;
    const id = `${process.pid}.${useSeq}.${Date.now().toString(36)}`;
    const closed = (via) => { if (stillOpen.delete(id)) noteBrowserUse('close', id, via); };
    stillOpen.set(id, closed);
    noteBrowserUse('open', id);
    if (!exitHooked) { exitHooked = true; process.once('exit', () => { for (const done of [...stillOpen.values()]) done('exit'); }); }
    if (typeof browser.once === 'function') browser.once('disconnected', () => closed('disconnected'));
    if (typeof browser.close === 'function') {
      const close = browser.close;
      browser.close = function recordedClose(...args) {
        let r;
        try { r = close.apply(browser, args); } catch (e) { closed('close'); throw e; }
        if (r && typeof r.then === 'function') return r.finally(() => closed('close'));
        closed('close'); return r;
      };
    }
  } catch { /* recording only */ }
  return browser;
}
