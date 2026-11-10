/**
 * skills/dynamics/scripts/lib.mjs — shared helpers for the dynamics instruments
 * (detect, plan, check, snapshot, sync). Standalone dev tooling: no site-specific
 * values live here; everything a site contributes arrives as arguments or files.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop, no-restricted-syntax */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------- args --- */
export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
export function flag(name) { return process.argv.includes(`--${name}`); }
export function list(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

/* ---------------------------------------------------------------- io ---- */
export function readJSON(file, fallback) {
  if (!existsSync(file)) { if (fallback !== undefined) return fallback; throw new Error(`missing ${file}`); }
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function writeJSON(file, obj) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(obj, null, 1)}\n`); }
export function writeText(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`); }
export function provenance(script, extra = {}) {
  return { writtenBy: `stardust:dynamics ${script}`, writtenAt: new Date().toISOString(), ...extra };
}

/* ------------------------------------------------------------- browser --- */
// The browser front door (stardust/scripts/browser.mjs), resolved once. Pure instruments (plan, martech) never
// need it; a browser step that cannot find it stops with the copy instruction.
const BROWSER = ['../../stardust/scripts/browser.mjs', '../stardust/browser.mjs', './stardust/browser.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
function frontDoor() {
  if (!BROWSER) throw Object.assign(new Error('dynamics/lib.mjs: browser.mjs not found (looked in ../../stardust/scripts/, ../stardust/ and ./stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'), { code: 'FRONT_DOOR_MISSING' });
  return import(BROWSER.href);
}
const SETUP_ERRORS = ['FRONT_DOOR_MISSING', 'PLAYWRIGHT_MISSING', 'PLAYWRIGHT_BROKEN'];
/** CLI boundary: a missing front door or Playwright is a setup error. One line, exit 1; any other error passes on. */
export function stopOnSetupError(error) {
  if (!SETUP_ERRORS.includes(error?.code)) throw error;
  console.error(error.message);
  process.exit(1);
}
const viaFrontDoor = (name) => async (...args) => (await frontDoor())[name](...args);
export const loadPlaywright = viaFrontDoor('loadPlaywright');
export const openBrowser = viaFrontDoor('openBrowser');
export const newContext = viaFrontDoor('newContext');
export const newPage = viaFrontDoor('newPage');
export const goto = viaFrontDoor('goto');

/* -------------------------------------------------------------- auth ---- */
/**
 * Resolve the site auth header from `--auth-header "<scheme> <secret>"` or
 * `--token-env NAME` (process.env first, then a `.env` in the cwd). Returns
 * null when the origin is public. The value is never logged.
 */
export function resolveAuthHeader({ authHeader = arg('auth-header'), tokenEnv = arg('token-env') } = {}) {
  if (authHeader && authHeader !== true) return authHeader;
  const name = tokenEnv && tokenEnv !== true ? tokenEnv : 'SITE_TOKEN';
  let v = process.env[name];
  if (!v && existsSync('.env')) v = (readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1];
  if (!v) return null;
  v = v.trim().replace(/^["']|["']$/g, '');
  return /^(token|bearer) /i.test(v) ? v : `token ${v}`;
}

/**
 * Attach the auth header to requests for ONE origin only, through a route
 * filter (the front door's). Never use context-wide extraHTTPHeaders for a
 * secret: it leaks to every third party and turns their CORS checks into false
 * failures that real users never see (recorded on a video vendor's playback API).
 */
export const attachOriginAuth = viaFrontDoor('attachOriginAuth');

/* ------------------------------------------------------------- hosts ---- */
export function registrable(host) { return String(host || '').split(':')[0].split('.').slice(-2).join('.'); }
export function sameSite(hostA, hostB) { return registrable(hostA) === registrable(hostB); }
export function pathPattern(pathname) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/{hash}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}');
}
export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

/* ---------------------------------------------------------- taxonomy ---- */
/** The triage vocabulary (reference/triage.md, classes-and-signals.md): every writer of feature rows checks against it. */
export const TAXONOMY = {
  class: ['L', 'S', 'F', 'M', 'V', 'T', 'A', 'R', 'X', 'I18N', 'CR', 'D'],
  disposition: ['rebuild-native', 'index-backed', 'data-fed', 'embed-passthrough', 'client-only', 'static-snapshot', 'decided-out'],
  reproducibility: ['self', 'needs-credential', 'needs-human-capture', 'needs-backend', 'needs-business-decision'],
  status: ['pending', 'in-progress', 'interim', 'done', 'scaffolded-awaiting-owner', 'delivered-by-capture', 'decided-out', 'skipped-source-broken'],
};

/* ----------------------------------------------------------- vendors ---- */
let VENDORS = null;
export function vendors() {
  if (!VENDORS) {
    const table = readJSON(join(HERE, 'vendors.json'));
    VENDORS = table.vendors.map((v) => ({ ...v, re: new RegExp(v.match, 'i') }));
  }
  return VENDORS;
}
/** first vendor whose pattern matches a host or URL; null when unknown */
export function vendorFor(hostOrUrl) { return vendors().find((v) => v.re.test(hostOrUrl)) || null; }

/* --------------------------------------------------------- page steps --- */
// the click tried when the shared consent pass (the front door's acceptConsent) clicks nothing
export const CONSENT_ACCEPT = [
  '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#usercentrics-root button[data-testid="uc-accept-all-button"]',
  '[id*="accept-all" i]', '[id*="acceptAll" i]', 'button[aria-label*="accept" i]', 'button[title*="accept all" i]',
].join(', ');

/** accept consent (so tags fire), settle, scroll (lazy bands/tags), settle again */
export async function settlePage(page, { settleMs = 5000, scrollStep = 800, maxScroll = 8000 } = {}) {
  const accept = (await frontDoor()).acceptConsent;
  if (!(await accept(page).catch(() => null))) {
    try { await page.click(CONSENT_ACCEPT, { timeout: 3000 }); } catch { /* no dialog */ }
  }
  await page.waitForTimeout(settleMs);
  for (let y = 0; y < maxScroll; y += scrollStep) { await page.mouse.wheel(0, scrollStep); await page.waitForTimeout(80); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** cheap `.env`-free fetch with status + headers; never throws */
export async function probe(url, { method = 'GET', headers = {}, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, redirect: 'manual', signal: ctl.signal });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, contentType: ct.split(';')[0], ok: r.status < 400 };
  } catch (e) { return { status: 0, error: String(e.message || e).slice(0, 80), ok: false }; } finally { clearTimeout(t); }
}
