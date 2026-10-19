// skills/reskin/scripts/deployed/sanity.mjs — A4 of the deployed leg, `sanity`: the hard asserts on the preview. Never
// waivable (the ledger refuses an `accepted` residual for it): a page that fails here is broken, whatever it looks like.
// One Chromium launch, each width (1440 and 360) in a fresh page that is navigated to the preview, settled on its EDS
// decoration (edsSettle) and read:
//   overflow       scrollWidth − clientWidth of the document ≤ 4px
//   decoration     no stalled body.appear, [data-section-status] or [data-block-status] after the settle
//   broken images  no <img> that is complete with no natural width, counted after one scroll pass through the page
//                  (lazy images load), among those with a box or in the viewport; a display:none one is not
//   page errors    no `pageerror` event from the navigation until after the settle
// and, once, at 1440, as shipped (child processes of the diff skill, the bundled Chromium, a bot challenge is exit 3):
//   clip-probe         the clipped or hidden text and controls of the preview: count 0
//   content-presence   the reskin page against the preview: HIDDEN + MISSING headings and links 0
// A protected preview (preview.json says auth: true) is measured with the site token, `auth`, and without one is a setup
// error: this step's own browser and both instruments send it to the preview's origin only (the instruments by --token-env
// and --auth-origin, the value by environment); the reskin page, served for content-presence, never gets it. A public
// preview is sent none. The reskin page is served by serve.mjs, never file://.
//   runSanity({ dir, slug, preview, auth, reskinPage, widths, tools, env, edsTimeoutMs })  writes sanity.json
//        ({ verdict, hard: true, rows }) and returns { verdict: 'PASS' | 'FAIL' | 'ERROR', exit, hard, rows }.
//        A row is { check, width, value, bar, status: 'PASS' | 'FAIL' | 'ERROR', artifact, detail }. A check
//        that gave no verdict (an instrument exiting 124, 1, 4 or any other unexpected exit or no number in its JSON,
//        a page the browser could not load or that answered HTTP 400 or more) makes its row "ERROR (exit N)", the
//        verdict ERROR and the exit 124; a bot challenge throws an error with code 3, and a token the preview refuses
//        (401 or 403 once sent) is a UsageError (exit 2) before any instrument runs. `tools` maps clip and presence
//        to script paths (default: diffTools()),
//        for tests; edsTimeoutMs bounds the settle (default 20000).
//   diffTools(from)    the two instruments in either layout of the scripts, or a UsageError naming what is missing
//   sanityLines(result)  the lines the CLI prints
// Evidence: <deployed>/sanity/ (clip-probe-1440.json, content-presence-1440.json) and <deployed>/sanity.json.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { loadChromium, loadMeasureLive } from '../figma-gate/target.mjs';
import { callOnPreview, childEnv, coded, exitOf, firstLine, outputOf, parseJson, previewToken } from './child.mjs';
import { authContextOptions, edsSettle, loadLiveSession } from './eds.mjs';
import { deployedDir } from './io.mjs';
import { EXIT, listed, stepLines, verdictOf } from './rows.mjs';
import { serveReskinPage } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts, one level deeper than the top-level scripts: the plugin tree (skills/reskin/scripts/deployed ↔
// skills/diff/scripts) and the project copy (stardust/scripts/reskin/deployed ↔ stardust/scripts/diff).
const DIFF = ['../../../diff/scripts', '../../diff'];
const TOOL_FILES = { clip: 'clip-probe.mjs', presence: 'content-presence.mjs' };

const MAX_OVERFLOW_PX = 4;
const BAR_OF = {
  overflow: `≤ ${MAX_OVERFLOW_PX}px`,
  decoration: 'all loaded',
  'broken images': '0',
  'page errors': '0',
  'clip-probe': '0',
  'content-presence': '0',
};
const BROWSER_CHECKS = ['overflow', 'decoration', 'broken images', 'page errors'];
const WIDE = 1440;
const VIEWPORT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 30000;
const EDS_TIMEOUT_MS = 20000;
const SCROLL_DWELL_MS = 150;
const MAX_SCROLL_STEPS = 60;
const IMAGES_TIMEOUT_MS = 3000;

function missingTools(names) {
  return new UsageError(`${names.join(', ')} not found (looked in ../../../diff/scripts/ and ../../diff/): copy the diff skill's scripts beside the reskin scripts (stardust/scripts/diff/)`);
}

// The two instruments by role, from `from` (the directory of this file) in whichever layout holds them.
export function diffTools(from = HERE) {
  const dirs = DIFF.map((p) => resolve(from, p));
  const tools = {};
  const missing = [];
  for (const [role, file] of Object.entries(TOOL_FILES)) {
    const dir = dirs.find((d) => existsSync(join(d, file)));
    if (dir) tools[role] = join(dir, file); else missing.push(file);
  }
  if (missing.length) throw missingTools(missing);
  return tools;
}

function checkTools(tools) {
  const missing = Object.entries(TOOL_FILES).filter(([role]) => !tools[role] || !existsSync(tools[role])).map(([, file]) => file);
  if (missing.length) throw missingTools(missing);
  return tools;
}

// ---- in the page ---------------------------------------------------------------------------------------------------

const overflowIn = () => {
  const el = document.documentElement;
  return Math.max(0, el.scrollWidth - el.clientWidth);
};

// One pass down the page, a viewport at a time (at most maxSteps: a page that grows as it is scrolled has no bottom), so
// lazy images start loading; back at the top afterwards.
const scrollThrough = async ({ dwell, maxSteps }) => {
  const step = Math.max(window.innerHeight, 300);
  const height = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  for (let i = 0, y = 0; i < maxSteps && y < height(); i += 1, y += step) {
    window.scrollTo(0, y);
    await new Promise((done) => { setTimeout(done, dwell); });
  }
  window.scrollTo(0, 0);
};

const imagesDone = () => [...document.images].every((im) => im.complete);

// The sources of the images that are complete with no natural width: those that have a layout box (display:none has
// none) and a size or a place in the viewport.
const brokenImagesIn = () => [...document.images].filter((im) => {
  if (!im.complete || im.naturalWidth !== 0 || im.getClientRects().length === 0) return false;
  const r = im.getBoundingClientRect();
  const inViewport = r.right >= 0 && r.bottom >= 0 && r.left <= window.innerWidth && r.top <= window.innerHeight;
  return r.width > 0 || r.height > 0 || inViewport;
}).map((im) => (im.currentSrc || im.src || '(no src)').slice(0, 300));

// ---- rows ----------------------------------------------------------------------------------------------------------

const row = (check, width, status, value, { artifact = null, detail = null } = {}) => ({ check, width, value, bar: BAR_OF[check], status, artifact, detail });
const errorRow = (check, width, code, detail) => row(check, width, 'ERROR', `ERROR (exit ${code})`, { detail });
const toolError = (check, width, name, r) => errorRow(check, width, exitOf(r), firstLine(outputOf(r, null)) || `${name} exited ${exitOf(r)} without a message`);

const stallOnly = (e) => { if (e?.name !== 'TimeoutError') throw e; };

// The four rows of one width. A challenge is thrown (code 3), and so is a 401 or 403 to a token that was sent (a setup
// error, exit 2, as in parity: nothing is measured); another HTTP status of 400 or more (an error page measures nothing
// about the page) and any other failure to load or read the page make the four rows "ERROR (exit 124)" with
// "HTTP <n> at <url>" or the first line of the failure.
async function measureWidth({ browser, openPage, gotoLive, width, url, token, edsTimeoutMs }) {
  const { ctx, page } = await openPage(browser, { width, height: VIEWPORT_HEIGHT, ...authContextOptions(url, token) });
  try {
    const errors = [];
    page.on('pageerror', (e) => errors.push(firstLine(String(e?.message ?? e)) || 'uncaught error'));
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: NAV_TIMEOUT_MS, settleMs: 0 });
    const eds = await edsSettle(page, { timeoutMs: edsTimeoutMs });
    const pageErrors = [...errors];
    const overflow = await page.evaluate(overflowIn);
    await page.evaluate(scrollThrough, { dwell: SCROLL_DWELL_MS, maxSteps: MAX_SCROLL_STEPS });
    await page.waitForFunction(imagesDone, null, { timeout: IMAGES_TIMEOUT_MS, polling: 100 }).catch(stallOnly);
    const broken = await page.evaluate(brokenImagesIn);
    return [
      row('overflow', width, overflow > MAX_OVERFLOW_PX ? 'FAIL' : 'PASS', `${overflow}px`),
      row('decoration', width, eds.stalled.length ? 'FAIL' : 'PASS', eds.stalled.length ? eds.stalled.join(', ') : 'loaded'),
      row('broken images', width, broken.length ? 'FAIL' : 'PASS', String(broken.length), { detail: listed(broken) }),
      row('page errors', width, pageErrors.length ? 'FAIL' : 'PASS', String(pageErrors.length), { detail: listed(pageErrors) }),
    ];
  } catch (e) {
    if (e?.name === 'BotChallengeError') throw coded(3, e.message);
    if (e?.name === 'LiveHTTPError' && [401, 403].includes(e.status) && token) throw new UsageError(`${url} answered HTTP ${e.status}: the site token was not accepted`);
    const why = e?.name === 'LiveHTTPError' ? `HTTP ${e.status} at ${url}` : firstLine(String(e?.message ?? e)) || 'the page could not be read';
    return BROWSER_CHECKS.map((check) => errorRow(check, width, EXIT.ERROR, why));
  } finally { await ctx.close(); }
}

// { [width]: the four rows }, in one browser: the bundled Chromium, the preview is not bot-managed.
async function browserRows({ widths, url, token, edsTimeoutMs }) {
  const chromium = await loadChromium();
  const { openBrowser, openPage } = await loadMeasureLive();
  const { gotoLive } = await loadLiveSession();
  const browser = await openBrowser(chromium, { tier: 'plain' });
  const rows = {};
  try {
    for (const width of widths) rows[width] = await measureWidth({ browser, openPage, gotoLive, width, url, token, edsTimeoutMs });
  } finally { await browser.close(); }
  return rows;
}

const readJsonFile = (file) => { try { return parseJson(readFileSync(file, 'utf8')); } catch { return null; } };
const counted = (r) => r.status === 0 || r.status === 2;

// clip-probe of the preview at 1440: its exit is the verdict, its count the value.
async function clipRow({ urls, out, tools, env, token }) {
  const file = join(out, `clip-probe-${WIDE}.json`);
  const r = await callOnPreview('clip-probe', tools.clip, [urls.preview, '--width', String(WIDE), '--plain', '--json', file], env, { token, url: urls.preview });
  const json = counted(r) ? readJsonFile(file) : null;
  if (!Number.isFinite(json?.counts?.total)) return toolError('clip-probe', WIDE, 'clip-probe', r);
  const found = (json.findings ?? []).filter((f) => !f.advisory).map((f) => `${f.kind} "${f.text}" in ${f.clipper ?? '(page)'}`);
  return row('clip-probe', WIDE, r.status === 0 ? 'PASS' : 'FAIL', String(json.counts.total), { artifact: file, detail: r.status === 2 ? listed(found) : null });
}

// content-presence of the served reskin page against the preview at 1440: HIDDEN + MISSING headings and links.
async function presenceRow({ urls, out, tools, env, token }) {
  const file = join(out, `content-presence-${WIDE}.json`);
  const r = await callOnPreview('content-presence', tools.presence, [urls.reskin, urls.preview, '--width', String(WIDE), '--plain', '--json', file], env, { token, url: urls.preview });
  const json = counted(r) ? readJsonFile(file) : null;
  const totals = json?.totals;
  if (!Number.isFinite(totals?.missing) || !Number.isFinite(totals?.hidden)) return toolError('content-presence', WIDE, 'content-presence', r);
  const lost = (json.findings ?? []).filter((f) => /^(MISSING|HIDDEN) (HEADING|LINK)$/.test(f.kind)).map((f) => `${f.kind}: ${f.msg}`);
  const detail = r.status === 2 ? [`HIDDEN ${totals.hidden}, MISSING ${totals.missing}`, listed(lost)].filter(Boolean).join('\n') : null;
  return row('content-presence', WIDE, r.status === 0 ? 'PASS' : 'FAIL', String(totals.missing + totals.hidden), { artifact: file, detail });
}

// The two instrument rows, with the reskin page served for the one that reads it.
async function instrumentRows({ reskinPage, preview, token, out, tools, env }) {
  const server = await serveReskinPage(reskinPage);
  try {
    const run = { urls: { reskin: server.url, preview }, out, tools, env: childEnv(env, null), token };
    return [await clipRow(run), await presenceRow(run)];
  } finally { await server.close(); }
}

// preview is the record of `deployed-gate preview`; auth the Authorization header value, or null (used only when the
// preview is protected); reskinPage the file of the local reskin page (default <dir>/reskin/pages/<slug>.html).
export async function runSanity({ dir, slug, preview, auth = null, reskinPage = join(dir, 'reskin', 'pages', `${slug}.html`), widths = [1440, 360], tools = null, env = process.env, edsTimeoutMs = EDS_TIMEOUT_MS }) {
  const deployed = deployedDir(dir, slug);
  const out = join(deployed, 'sanity');
  const record = join(deployed, 'sanity.json');
  for (const stale of [record, out]) rmSync(stale, { recursive: true, force: true });
  const seal = (rows) => {
    const verdict = verdictOf(rows);
    writeJson(record, { verdict, hard: true, rows });
    return { verdict, exit: EXIT[verdict], hard: true, rows };
  };

  if (typeof preview.url !== 'string' || !preview.url) throw new UsageError(`${join(deployed, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  const token = previewToken('sanity', preview, auth);
  if (!existsSync(reskinPage)) throw new UsageError(`missing ${reskinPage}: the reskin page content-presence holds the preview to (deployed-gate sanity --reskin <file>)`);
  const instruments = tools ? checkTools(tools) : diffTools();
  mkdirSync(out, { recursive: true });

  const measured = await browserRows({ widths, url: preview.url, token, edsTimeoutMs });
  const wide = widths.includes(WIDE) ? await instrumentRows({ reskinPage, preview: preview.url, token, out, tools: instruments, env }) : [];
  return seal(widths.flatMap((width) => [...measured[width], ...(width === WIDE ? wide : [])]));
}

// What a failing row says: the value against its bar ("overflow 240px > 4px @360"), the stalled parts for decoration.
const failure = (r) => (r.check === 'decoration' ? `decoration: ${r.value} @${r.width}` : `${r.check} ${r.value} > ${r.bar.replace(/^≤ /, '')} @${r.width}`);

// The lines the CLI prints: a line for the checks that gave no verdict, the verdict line, one indented line per failing
// row (its findings below), and one n/a line per distinct reason.
export const sanityLines = (result) => stepLines('sanity', result, { failHeading: 'FAIL sanity (hard)', failure });
