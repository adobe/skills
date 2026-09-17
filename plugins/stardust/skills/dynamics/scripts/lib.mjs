/**
 * skills/dynamics/scripts/lib.mjs — shared helpers for the dynamics instruments
 * (detect, plan, check, snapshot, sync). Standalone dev tooling: no site-specific
 * values live here; everything a site contributes arrives as arguments or files.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop, no-restricted-syntax */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

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

/* ---------------------------------------------------------- playwright --- */
export async function loadPlaywright() {
  const normalize = (m) => (m.chromium ? m : (m.default?.chromium ? m.default : null));
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    const mod = normalize(await import(pathToFileURL(req.resolve('playwright')).href));
    if (mod) return mod;
  } catch { /* fall through */ }
  try { const mod = normalize(await import('playwright')); if (mod) return mod; } catch { /* fall through */ }
  throw new Error('playwright not importable from the project (npm i -D playwright --no-save) — the dynamics instruments need a browser.');
}

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
 * filter. Never use context-wide extraHTTPHeaders for a secret: it leaks to
 * every third party and turns their CORS checks into false failures that real
 * users never see (recorded on a video vendor's playback API).
 */
export async function attachOriginAuth(context, origin, headerValue) {
  if (!headerValue) return;
  const o = new URL(origin).origin;
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`${o}/`) || u === o) {
      route.continue({ headers: { ...route.request().headers(), authorization: headerValue } });
    } else route.continue();
  });
}

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
export const CONSENT_ACCEPT = [
  '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#usercentrics-root button[data-testid="uc-accept-all-button"]',
  '[id*="accept-all" i]', '[id*="acceptAll" i]', 'button[aria-label*="accept" i]', 'button[title*="accept all" i]',
].join(', ');

/** accept consent (so tags fire), settle, scroll (lazy bands/tags), settle again */
export async function settlePage(page, { settleMs = 5000, scrollStep = 800, maxScroll = 8000 } = {}) {
  try { await page.click(CONSENT_ACCEPT, { timeout: 3000 }); } catch { /* no dialog */ }
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
