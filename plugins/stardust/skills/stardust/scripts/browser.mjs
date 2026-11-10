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

async function importFromWorkingDirectory() {
  const require = createRequire(join(process.cwd(), 'package.json'));
  return import(pathToFileURL(require.resolve('playwright')).href);
}

const notInstalled = (error) => error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND';

async function importPlaywright() {
  let mod;
  try {
    mod = await importFromWorkingDirectory();
  } catch (fromWorkingDirectory) {
    try {
      mod = await import('playwright');
    } catch (bare) {
      // an installed copy that throws while loading needs its own error, not the install line
      const broken = [fromWorkingDirectory, bare].find((e) => !notInstalled(e));
      const error = broken
        ? new Error(`playwright is installed but failed to load: ${String(broken?.message ?? broken).split('\n')[0]}`, { cause: broken })
        : new Error(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} or from ${process.cwd()}. From the project root run: ${INSTALL_LINE}`, { cause: bare });
      error.code = broken ? 'PLAYWRIGHT_BROKEN' : 'PLAYWRIGHT_MISSING';
      throw error;
    }
  }
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
