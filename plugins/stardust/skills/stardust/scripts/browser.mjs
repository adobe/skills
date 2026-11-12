/**
 * skills/stardust/scripts/browser.mjs
 *
 * The one entry to the browser for every stardust script: load Playwright, open a browser in one of three modes,
 * make contexts and pages, navigate. The live-site rules (identity, pacing, overlays) stay in live-session.mjs,
 * re-exported here, so a script needs only this file. A library: no CLI.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
  if (mode === 'chrome') return launchLiveBrowser(chromium);
  if (mode === 'headed') return launchStealthHeaded(chromium);
  const browser = await chromium.launch(launchOptions ?? {});
  browser.stardustTier = tier || 'chromium';
  return browser;
}

export const newContext = (browser, options = {}) => browser.newContext(options);
export const newPage = (browser, options = {}) => browser.newPage(options);
export const goto = (page, url, options = {}) => page.goto(url, options);
