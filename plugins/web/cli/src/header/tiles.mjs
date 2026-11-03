import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import sharp from 'sharp';

const scratch = mkdtempSync(join(tmpdir(), 'plg-pw-'));
let counter = 0;
// sessions are per process: parallel runs (bench, units) reuse the same logical names
const sid = (session) => `${session}-${process.pid}`;

function cli(args, opts = {}) {
  return execFileSync('playwright-cli', args, {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts,
  });
}

/** Opens a playwright-cli session with a fixed viewport (CSP bypassed: we inject capture scripts). */
export function openSession(session, { width = 1440, height = 900, scale = 1 } = {}) {
  const cfg = join(scratch, `${session}-cfg.json`);
  writeFileSync(cfg, JSON.stringify({
    browser: { browserName: 'chromium', contextOptions: { viewport: { width, height }, deviceScaleFactor: scale, bypassCSP: true } },
  }));
  // bounded like closeSession: a stuck close here blocked the whole sweep before the open (PR #14 review)
  try { cli([`-s=${sid(session)}`, 'close'], { timeout: 30000 }); } catch { /* not open, or stuck */ }
  cli([`-s=${sid(session)}`, `--config=${cfg}`, 'open', 'about:blank'], { timeout: 60000 });
}

export function closeSession(session) {
  // bounded: a close that never returned held a text-styles sweep ~15 min after its work (s2b v1-4)
  try { cli([`-s=${sid(session)}`, 'close'], { timeout: 30000 }); } catch { /* already closed or stuck */ }
}

/**
 * Runs `async page => {...}` source in the session and returns its JSON-decoded result.
 * The function must return a JSON string (or nothing).
 */
export function runCode(session, fnSource) {
  return decode(session, cli(runArgs(session, fnSource)));
}

/**
 * Same as runCode, without blocking the event loop (for parallel sessions). `timeout` (ms) kills a
 * call that does not return (a stuck playwright-cli held an s2b sweep 13 min) and rejects.
 */
export async function runCodeAsync(session, fnSource, { timeout = 0 } = {}) {
  const { stdout } = await promisify(execFile)('playwright-cli', runArgs(session, fnSource),
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout });
  return decode(session, stdout);
}

function runArgs(session, fnSource) {
  counter += 1;
  const file = join(scratch, `code-${counter}.js`);
  writeFileSync(file, fnSource);
  return [`-s=${sid(session)}`, '--raw', 'run-code', `--filename=${file}`];
}

function decode(session, out) {
  const text = out.trim();
  if (!text || text === 'undefined') return undefined;
  if (text.startsWith('Error') || text.startsWith('### Error')) {
    throw new Error(`run-code failed in session ${session}: ${text.slice(0, 2000)}`);
  }
  let value = JSON.parse(text);
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}

/**
 * In-page source of `async (page, path) => {}`: a full-page screenshot. Chromium leaves full-page
 * shots blank below about 16384 px on some pages, so taller pages are shot in 8000 px tiles
 * (path.tile-<n>.png) that stitchTiles() joins on the Node side.
 */
export const TILED_SHOT = `async (page, path) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h <= 16000) return page.screenshot({ path, fullPage: true });
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (let y = 0, n = 0; y < h; y += 8000, n += 1) {
    await page.screenshot({ path: path + '.tile-' + n + '.png', fullPage: true,
      clip: { x: 0, y, width, height: Math.min(8000, h - y) } });
  }
}`;

/** Joins path.tile-<n>.png (TILED_SHOT) top to bottom into path and removes them; no tiles: no-op. */
export async function stitchTiles(path) {
  const prefix = `${basename(path)}.tile-`;
  const tiles = readdirSync(dirname(path)).filter((f) => f.startsWith(prefix))
    .sort((a, b) => parseInt(a.slice(prefix.length), 10) - parseInt(b.slice(prefix.length), 10))
    .map((f) => join(dirname(path), f));
  if (!tiles.length) return;
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  let top = 0;
  const parts = tiles.map((input, i) => { const p = { input, left: 0, top }; top += metas[i].height; return p; });
  await sharp({ create: { width: metas[0].width, height: top, channels: 4, background: '#fff' } })
    .composite(parts).png().toFile(path);
  tiles.forEach((t) => rmSync(t));
}
