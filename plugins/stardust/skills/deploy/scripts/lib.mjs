#!/usr/bin/env node
/**
 * skills/deploy/scripts/lib.mjs — the DA credential primitives of the deploy
 * scripts. Consumer today: deploy-batch.mjs (preflight + halt) and its fixture
 * tests; a later credential CLI imports these instead of re-implementing them.
 * One implementation, no dependencies (Node 18+).
 *
 *   resolveToken(name, { cwd, home, env })
 *     → { value, source } | null. Order: shell env → ./.env → ~/.claude/.env → ~/.env.
 *     `source` is the CLASS (shell | repo-env | global-env | home-env) — callers
 *     print the class, never the value or a home path.
 *   tokenExpiry(jwt)
 *     → epoch SECONDS | null. IMS tokens carry `created_at` + `expires_in`
 *     (string ms, no `exp`); a plain JWT `exp` (s) is the fallback.
 *   daSmoke(token, org, repo, { list })
 *     → HTTP status of ONE authenticated GET admin.da.live/list/{org}/{repo}/
 *     (0 on a network error). The one call a preflight makes before any PUT.
 *   envFiles({ cwd, home })            → the ordered [file, class] pairs resolveToken reads.
 *   siteTokenName(slug)                → `SITE_TOKEN_<SLUG>` (uppercased, non-alphanumerics → _).
 *   siteTokenNamesIn({ cwd, home, env }) → every `SITE_TOKEN_*` NAME present in the shell env
 *     or those files — names only, by regex; the files are never echoed.
 *   fetchDecoded(url, { headers })     → { status, buf, enc, rawLen, lastModified, age, xcache,
 *     xerr, via } — the DECODED served body (fetch inflates gzip) plus the cache facts every
 *     served-asset reader prints; status 0 + `error` on a network failure.
 *
 * `node skills/deploy/scripts/lib.mjs --help` prints this contract; the module
 * has no other CLI. DEPLOY_BATCH_DA_LIST overrides the list host (fixture tests).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DA_LIST = process.env.DEPLOY_BATCH_DA_LIST || 'https://admin.da.live/list';
export const TOKEN_SOURCES = ['shell', 'repo-env', 'global-env', 'home-env'];

/**
 * Resolve a token by env NAME: shell → ./.env → ~/.claude/.env → ~/.env.
 * Returns { value, source } with source ∈ TOKEN_SOURCES, or null.
 */
export function envFiles({ cwd = process.cwd(), home = homedir() } = {}) {
  return [[path.join(cwd, '.env'), 'repo-env'], [path.join(home, '.claude', '.env'), 'global-env'], [path.join(home, '.env'), 'home-env']];
}

export function resolveToken(name, { cwd = process.cwd(), home = homedir(), env = process.env } = {}) {
  const clean = (v) => (v == null ? null : String(v).trim().replace(/^["']|["']$/g, '')) || null;
  if (clean(env[name])) return { value: clean(env[name]), source: 'shell' };
  for (const [file, source] of envFiles({ cwd, home })) {
    if (!existsSync(file)) continue;
    const m = readFileSync(file, 'utf8').match(new RegExp(`^(?:export\\s+)?${name}=(.*)$`, 'm'));
    if (m && clean(m[1])) return { value: clean(m[1]), source };
  }
  return null;
}

/** IMS `created_at` + `expires_in` (string ms) → exp seconds; plain JWT `exp` (s) fallback; null when undecodable. */
export function tokenExpiry(jwt) {
  try {
    const seg = String(jwt).split('.')[1];
    if (!seg) return null;
    const claims = JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (claims.created_at && claims.expires_in) {
      const exp = (Number(claims.created_at) + Number(claims.expires_in)) / 1000;
      return Number.isFinite(exp) ? exp : null;
    }
    return Number.isFinite(Number(claims.exp)) ? Number(claims.exp) : null;
  } catch { return null; }
}

/** `SITE_TOKEN_<SLUG>`: uppercased, every non-alphanumeric → `_` (`ledgerline-demo` → SITE_TOKEN_LEDGERLINE_DEMO). Exact-match only — never a prefix. */
export function siteTokenName(slug) {
  return `SITE_TOKEN_${String(slug).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Every SITE_TOKEN_* NAME visible to resolveToken — shell env first, then the env files — by regex; values are never read out. */
export function siteTokenNamesIn({ cwd = process.cwd(), home = homedir(), env = process.env } = {}) {
  const names = new Set(Object.keys(env).filter((k) => /^SITE_TOKEN(_[A-Z0-9_]+)?$/.test(k)));
  for (const [file] of envFiles({ cwd, home })) {
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/^(?:export\s+)?(SITE_TOKEN(?:_[A-Z0-9_]+)?)=/gm)) names.add(m[1]);
  }
  return [...names].sort();
}

/** GET a served asset DECODED (fetch inflates gzip) with the cache facts; status 0 + error on a network failure. */
export async function fetchDecoded(url, { headers = {}, redirect = 'follow' } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, redirect });
  } catch (err) {
    return { status: 0, buf: Buffer.alloc(0), error: String(err.message || err), enc: 'identity', rawLen: '?', lastModified: '-', age: '-', xcache: null, xerr: null, via: '-' };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const h = (k) => res.headers.get(k);
  return {
    status: res.status, buf, enc: h('content-encoding') || 'identity', rawLen: h('content-length') || '?',
    lastModified: h('last-modified') || '-', age: h('age') || '-', xcache: h('x-cache'), xerr: h('x-error'),
    via: h('x-served-by') || h('server') || '-',
  };
}

/** One authenticated GET on the DA list endpoint — the smoke test before any PUT. Returns the status (0 = network error). */
export async function daSmoke(token, org, repo, { list = DA_LIST } = {}) {
  try {
    const res = await fetch(`${list}/${org}/${repo}/`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
  } catch { return 0; }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  console.log('skills/deploy/scripts/lib.mjs — importable module: resolveToken(name) · tokenExpiry(jwt) · daSmoke(token, org, repo) · envFiles() · siteTokenName(slug) · siteTokenNamesIn() · fetchDecoded(url). No CLI; see the header comment.');
  process.exit(process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2);
}
