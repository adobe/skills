import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '#src/errors.mjs';
import { assertNotBlocked } from '#src/driver/blocked.mjs';
import { bodyPath, dropFailedEntries, harFileName } from '#src/cache/har.mjs';
import { extendConfig, resolveLaunch } from '#src/recipe.mjs';
import { generateSessionName } from '#src/session.mjs';

// 150 scrolls x 600 ms + two 8 s networkidle waits ~ 106 s; leave headroom.
const SCROLL_TIMEOUT_MS = 180_000;

const LOAD_AND_SCROLL = `async page => {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 150; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (i * 300 > h) break;
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(600);
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}`;

const FLUSH_HAR = 'async page => { await page.context().close() }';

/** HAR size plus the sizes of the body files it references. */
function harBytes(harPath) {
  const { log } = JSON.parse(readFileSync(harPath, 'utf8'));
  const dir = path.dirname(harPath);
  return log.entries.reduce((sum, { response }) => {
    const file = response.content?._file && bodyPath(dir, response.content._file);
    return file ? sum + statSync(file).size : sum;
  }, statSync(harPath).size);
}

function closeQuietly(driver, session) {
  try {
    driver.close(session);
  } catch (err) {
    process.stderr.write(`warning: failed to close session ${session}: ${err.message}\n`);
  }
}

/**
 * Load `url` in a browser that records every request into a HAR in `cacheDir`, scroll to
 * trigger lazy content, then flush the HAR by closing the browser context. A successful flush
 * ends the playwright-cli session, so the session is closed only when something fails.
 * The HAR is written to `<har>.tmp` (not indexed by the proxy) and replaces `<har>` only once
 * complete, so a failed refresh keeps the previous recording.
 * @param {object} driver
 * @param {{ url: string, cacheDir: string, headed?: boolean, recipe?: string }} opts
 * @returns {{ url: string, har: string, entries: number, dropped: number, bytes: number }}
 */
export function recordPage(driver, { url, cacheDir, headed, recipe }) {
  const dir = path.resolve(cacheDir);
  mkdirSync(dir, { recursive: true });
  const har = path.join(dir, harFileName(url));
  const launch = resolveLaunch(recipe, { headed });
  const tmp = `${har}.tmp`;
  const config = extendConfig(launch.config, {
    contextOptions: { recordHar: { path: tmp, content: 'attach' } },
  });
  const session = generateSessionName();
  rmSync(tmp, { force: true });
  try {
    try {
      driver.open({ session, url, headed, ...launch, config });
      assertNotBlocked(driver.pageHealth(session));
      driver.run(session, { code: LOAD_AND_SCROLL, timeoutMs: SCROLL_TIMEOUT_MS });
      driver.run(session, { code: FLUSH_HAR });
    } catch (err) {
      closeQuietly(driver, session);
      throw err;
    }
    if (!existsSync(tmp)) throw new CliError('INTERNAL', `HAR not written: ${har}`);
    const { entries, dropped } = dropFailedEntries(tmp);
    renameSync(tmp, har);
    return { url, har, entries, dropped, bytes: harBytes(har) };
  } finally {
    rmSync(tmp, { force: true });
  }
}
