/**
 * qa/lib.mjs — shared helpers for the stardust:qa read-only checkers.
 *
 * Everything here is side-effect-free except writeJSON/ensureDir, which only
 * ever target the QA output directory. No module in this skill mutates site
 * content, DA documents, or repo code.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
export function flag(name) { return process.argv.includes(`--${name}`); }

export const STARDUST_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pj = JSON.parse(readFileSync(join(here, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    return pj.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

export function provenance(script, input) {
  return {
    writtenBy: `stardust:qa/${script}`,
    stardustVersion: STARDUST_VERSION,
    writtenAt: new Date().toISOString(),
    againstInput: input,
  };
}

export function ensureDir(dir) { mkdirSync(dir, { recursive: true }); }
export function readJSON(file, fallback = undefined) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJSON(file, obj) {
  ensureDir(dirname(file));
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

/* ---------------------------------------------------------------- fetch -- */

const UA = 'stardust-qa/1.0 (+read-only site QA)';

/**
 * Fetch a URL with timeout + one retry. redirect: 'manual' callers get the
 * Location back instead of the followed body.
 */
/* ---------------------------------------------------------- site auth -- */
// Protected origins (access allow-list + site secret) 401 every unauthenticated
// probe. The header is sent to the BASE origin only — never to third parties,
// whose CORS checks would turn a credentialed request into a false failure.
let ORIGIN_AUTH = null;
export function setOriginAuth(base, headerValue) { ORIGIN_AUTH = base && headerValue ? { origin: new URL(base).origin, value: headerValue } : null; }
export function originAuthFor(url) { return ORIGIN_AUTH && String(url).startsWith(ORIGIN_AUTH.origin) ? ORIGIN_AUTH.value : null; }
/** browser side: attach the auth header to base-origin requests of a Playwright context (route filter, never extraHTTPHeaders) */
export async function attachOriginAuth(context) {
  if (!ORIGIN_AUTH) return;
  const { origin, value } = ORIGIN_AUTH;
  await context.route('**/*', (route) => { const u = route.request().url(); if (u === origin || u.startsWith(`${origin}/`)) route.continue({ headers: { ...route.request().headers(), authorization: value } }); else route.continue(); });
}
/** `--auth-header "token …"` or `--token-env NAME` (process.env, then a cwd `.env`); default env name SITE_TOKEN */
export function resolveAuthHeader() {
  const direct = arg('auth-header'); if (direct) return direct;
  const name = arg('token-env') || 'SITE_TOKEN';
  let v = process.env[name];
  if (!v && existsSync('.env')) v = (readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1];
  if (!v) return null;
  v = v.trim().replace(/^["']|["']$/g, '');
  return /^(token|bearer) /i.test(v) ? v : `token ${v}`;
}

/* ------------------------------------------------- throttle / limiter -- */
// 429/503 from the published origin is infrastructure state, not a page defect.
// Three sweeps on three projects read a rate-limit wall as hundreds of
// findings (page-not-200, og-image-broken, unknown-block, request-failed…)
// because the fetch path ran 8-wide per check with no back-off and the cache
// re-served every 429 to every later check. Rules, all code:
//   - every fetch (and every browser navigation) takes one slot from a per-host
//     limiter (createHostLimiter): additive-increase / multiplicative-decrease —
//     a throttle halves the host cap (min 1), +1 after `restoreMs` clean
//   - fetchUrl retries 429/503 through the limiter: Retry-After (seconds or
//     date, capped) else 2 / 4 / 8 s, `throttleAttempts` attempts total
//   - a response still throttled after the retries carries `throttled: true`;
//     checks emit `<check>/unmeasured` (info) for it and never a defect finding
//   - createPageCache never keeps a throttled or 503 response
//   - infra counters (throttled, retries, serverErrors) feed report.infra
const FETCH_DEFAULTS = { backoffMs: 2000, throttleAttempts: 3, retryAfterCapMs: 60000 };
/** override fetch/retry defaults for one process (tests: `configureFetch({ backoffMs: 10 })`) */
export function configureFetch(partial) { Object.assign(FETCH_DEFAULTS, partial); return { ...FETCH_DEFAULTS }; }

const INFRA = { throttled: 0, retries: 0, serverErrors: 0 };
export function infraCounters() { return { ...INFRA }; }
export function resetInfraCounters() { INFRA.throttled = 0; INFRA.retries = 0; INFRA.serverErrors = 0; }
/** browser checks count a throttled page here (fetchUrl counts its own) so report.infra covers both paths */
export function noteThrottled(n = 1) { INFRA.throttled += n; return INFRA.throttled; }

export function createHostLimiter({ maxInFlight = 4, restoreMs = 30000, now = Date.now } = {}) {
  const hosts = new Map(); // host -> { cap, inFlight, waiters: [], lastThrottle }
  const state = (host) => { let h = hosts.get(host); if (!h) { h = { cap: maxInFlight, inFlight: 0, waiters: [], lastThrottle: 0 }; hosts.set(host, h); } return h; };
  const pump = (h) => { while (h.waiters.length && h.inFlight < h.cap) { h.inFlight += 1; h.waiters.shift()(); } };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };
  return {
    /** resolve when a slot for the url's host is free (the caller must release it) */
    take(url) {
      const h = state(hostOf(url));
      if (h.inFlight < h.cap) { h.inFlight += 1; return Promise.resolve(); }
      return new Promise((resolve) => { h.waiters.push(resolve); });
    },
    release(url) {
      const h = state(hostOf(url));
      h.inFlight = Math.max(0, h.inFlight - 1);
      // additive increase: one clean window since the last throttle restores one slot
      if (h.cap < maxInFlight && h.lastThrottle && now() - h.lastThrottle >= restoreMs) { h.cap += 1; h.lastThrottle = now(); }
      pump(h);
    },
    /** multiplicative decrease on 429/503: halve the host cap, never below 1 */
    onThrottle(url) { const h = state(hostOf(url)); h.cap = Math.max(1, Math.floor(h.cap / 2)); h.lastThrottle = now(); return h.cap; },
    capFor(url) { return state(hostOf(url)).cap; },
    stats() { return Object.fromEntries([...hosts].map(([k, h]) => [k, { cap: h.cap, inFlight: h.inFlight, queued: h.waiters.length }])); },
  };
}
let LIMITER = null;
export function setFetchLimiter(limiter) { LIMITER = limiter; return limiter; }
export function getFetchLimiter() { return LIMITER; }
/** run `fn` holding one limiter slot for `url`'s host (browser navigations share the fetch budget) */
export async function withNavSlot(url, fn) {
  if (!LIMITER) return fn();
  await LIMITER.take(url);
  try { return await fn(); } finally { LIMITER.release(url); }
}
/** the throttle contract for a fetchUrl result: 429, or 503 that asked us to retry (Retry-After) */
export function isThrottled(res) { return !!res && res.throttled === true; }
/** Retry-After → ms (seconds or HTTP date), capped; null when absent/unparseable */
export function retryAfterMs(value, { capMs = FETCH_DEFAULTS.retryAfterCapMs, now = Date.now } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Math.min(capMs, Number(s) * 1000);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.min(capMs, Math.max(0, t - now()));
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function fetchUrl(url, { redirect = 'follow', method = 'GET', timeoutMs = 20000, retries = 1, backoffMs = FETCH_DEFAULTS.backoffMs, throttleAttempts = FETCH_DEFAULTS.throttleAttempts } = {}) {
  let netAttempt = 0; let throttleAttempt = 0; let sawRetryAfter = false;
  for (;;) {
    if (LIMITER) await LIMITER.take(url);
    // armed only once the slot is held: time queued behind the per-host cap must not eat into timeoutMs
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let wait = 0; // ms before the next pass (set by a retry branch)
    try {
      const auth = originAuthFor(url);
      const res = await fetch(url, { method, redirect, signal: ctl.signal, headers: { 'user-agent': UA, ...(auth ? { authorization: auth } : {}) } });
      const body = method === 'HEAD' ? '' : await res.text();
      const out = { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers.entries()), location: res.headers.get('location'), url: res.url, body };
      if (res.status !== 429 && res.status !== 503) return out;
      const ra = retryAfterMs(res.headers.get('retry-after'));
      if (ra !== null) sawRetryAfter = true;
      if (LIMITER) LIMITER.onThrottle(url);
      throttleAttempt += 1;
      if (throttleAttempt < throttleAttempts) { INFRA.retries += 1; wait = ra !== null ? ra : backoffMs * 2 ** (throttleAttempt - 1); } else {
        // still throttled after the retries: 429 (and a 503 that asked us to retry) is infrastructure state, not a page defect
        out.throttled = res.status === 429 || sawRetryAfter;
        if (out.throttled) INFRA.throttled += 1; else INFRA.serverErrors += 1;
        return out;
      }
    } catch (e) {
      if (netAttempt >= retries) return { ok: false, status: 0, headers: {}, location: null, url, body: '', error: e.message };
      netAttempt += 1;
      wait = 1000 * netAttempt;
    } finally {
      clearTimeout(timer);
      if (LIMITER) LIMITER.release(url);
    }
    await sleep(wait);
  }
}

/**
 * Shared page-fetch cache for one sweep: routing, content, metadata, and links
 * each visit every page, so without this a fleet is fetched ~3× (full HTML)
 * plus 2× (.plain.html). Only plain GET+follow requests are cached (probes —
 * HEAD, redirect:'manual' — have distinct semantics and bypass it); network
 * failures (status 0), throttled (429 / 503+Retry-After) and 503 responses are
 * not cached, so one throttled answer is never re-served to later checks —
 * that is how a single 429 became four findings per page. Stores in-flight
 * promises, so concurrent callers share one request.
 */
export function createPageCache(maxEntries = 4096) {
  const cache = new Map(); // url -> Promise<fetchUrl result>
  const cachedFetch = (url, opts = {}) => {
    const cacheable = (!opts.method || opts.method === 'GET')
      && (!opts.redirect || opts.redirect === 'follow');
    if (!cacheable) return fetchUrl(url, opts);
    if (cache.has(url)) return cache.get(url);
    const p = fetchUrl(url, opts).then((res) => {
      if (res.status === 0 || isThrottled(res) || res.status === 503 || cache.size > maxEntries) cache.delete(url);
      return res;
    });
    cache.set(url, p);
    return p;
  };
  return cachedFetch;
}

/** Tiny concurrency limiter: run tasks (thunks) with at most n in flight. */
export async function pMap(items, fn, n = 6) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

/**
 * report.infra — completeness of a sweep, not fidelity. `unmeasured` findings
 * (id `unmeasured` or `parity-unmeasured`) name the pages the origin throttled;
 * when their share of the fleet exceeds `throttleMaxPct` the report is
 * incomplete: report.html carries the banner and qa.mjs exits 2 (incomplete
 * beats "errors found"). No gate threshold lives here.
 */
export function infraSummary(findings, pageCount, { throttleMaxPct = 5, counters = infraCounters() } = {}) {
  const unmeasured = findings.filter((f) => f.id === 'unmeasured' || f.id === 'parity-unmeasured');
  const pages = [...new Set(unmeasured.map((f) => f.path).filter(Boolean))];
  const pct = pageCount ? Math.round((pages.length / pageCount) * 1000) / 10 : 0;
  return { ...counters, unmeasuredFindings: unmeasured.length, unmeasuredPages: pages.length, unmeasuredPct: pct, throttleMaxPct, incomplete: pct > throttleMaxPct };
}

/* ----------------------------------------------------------------- html -- */

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode HTML entities in an attribute value (hrefs/content carry &#x26; etc.). */
export function decodeAttr(s) {
  return (s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

/** Normalize text for containment comparisons: lowercase, alphanumerics only. */
export function normText(s) {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract `<p>…</p>` inner texts in order (tags stripped). */
export function paragraphTexts(html) {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]));
}

/** Delivered path → live URL. '/' maps to the site root. */
export function pageUrl(base, path) {
  return `${base.replace(/\/$/, '')}${path === '/' ? '/' : path}`;
}
export function plainUrl(base, path) {
  const b = base.replace(/\/$/, '');
  return path === '/' ? `${b}/index.plain.html` : `${b}${path}.plain.html`;
}
export function pathSlug(path) {
  return path === '/' ? 'index' : path.replace(/^\//, '').replace(/\//g, '__');
}

/* ------------------------------------------------------------- findings -- */

/**
 * Finding shape (schemas/qa-report.schema.json):
 *   check     one of routing|content|templates|rendered|visual|metadata|links|a11y|perf
 *   id        stable machine id within the check, e.g. "missing-canonical"
 *   severity  error | warn | info
 *   path      delivered path the finding is about ('' = fleet-level)
 *   message   one-line human statement
 *   evidence  optional free-form object (urls, counts, excerpts, file refs)
 */
export function finding(check, id, severity, path, message, evidence = undefined) {
  const f = { check, id, severity, path, message };
  if (evidence !== undefined) f.evidence = evidence;
  return f;
}

/* ------------------------------------------------------------ allowlist -- */

/**
 * Allowlist entries (schemas/qa-allowlist.schema.json):
 *   { check, id?, path?, messagePattern?, reason, addedAt? }
 * A finding is allowlisted when every provided field matches:
 *   check: exact or '*'; id: exact or '*'; path: exact or prefix ending in '*';
 *   messagePattern: JS regex tested against message.
 * Allowlisted findings stay in the report (allowlisted: true) — they are
 * documented non-defects, not deleted evidence.
 */
export function loadAllowlist(file) {
  const doc = readJSON(file, null);
  if (!doc) return [];
  return Array.isArray(doc) ? doc : (doc.entries || []);
}

function pathMatches(pattern, path) {
  if (pattern === undefined || pattern === null) return true;
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

export function applyAllowlist(findings, entries) {
  for (const f of findings) {
    const hit = entries.find((e) => (e.check === '*' || e.check === f.check)
      && (e.id === undefined || e.id === '*' || e.id === f.id)
      && pathMatches(e.path, f.path)
      && (e.messagePattern === undefined || new RegExp(e.messagePattern, 'i').test(f.message)));
    if (hit) { f.allowlisted = true; f.allowlistReason = hit.reason || ''; }
  }
  return findings;
}

/* ------------------------------------------------------------ playwright -- */

/**
 * Resolve playwright from the *project* (cwd), not the plugin cache — plugin
 * scripts live outside any node_modules tree. Falls back to a bare import.
 */
export async function loadPlaywright() {
  const normalize = (mod) => (mod.chromium ? mod : (mod.default?.chromium ? mod.default : null));
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    const mod = normalize(await import(pathToFileURL(req.resolve('playwright')).href));
    if (mod) return mod;
  } catch { /* fall through */ }
  try {
    const mod = normalize(await import('playwright'));
    if (mod) return mod;
  } catch { /* fall through */ }
  throw new Error('playwright not found: install it in the project (npm i -D playwright) — browser checks need it.');
}

/* ------------------------------------------------------------- inventory -- */

/**
 * Build the page inventory (the fleet the checks sweep). Sources, merged:
 *   --paths-file <txt>          one delivered path per line
 *   --template-map <json>       stardust/template-map.json ({templates:{t:{urls:[]}}})
 *   sitemap.xml at --base       always fetched when base is set (also used for parity findings)
 * Fragments (nav/footer) are tracked separately: they are delivered documents
 * but not pages (no h1/metadata expectations).
 */
export async function buildInventory({ base, pathsFile, templateMap, fragments = ['/nav', '/footer'], mergeSitemap = true }) {
  const pages = new Map(); // path -> {path, sources:[], template}
  const add = (path, source, template) => {
    const p = path.replace(/\/$/, '') || '/';
    if (!pages.has(p)) pages.set(p, { path: p, sources: [], template: template || null });
    const row = pages.get(p);
    if (!row.sources.includes(source)) row.sources.push(source);
    if (template && !row.template) row.template = template;
  };

  if (pathsFile && existsSync(pathsFile)) {
    for (const line of readFileSync(pathsFile, 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) add(t.startsWith('/') ? t : `/${t}`, 'paths-file');
    }
  }
  if (templateMap && existsSync(templateMap)) {
    const doc = readJSON(templateMap, {});
    for (const [tname, t] of Object.entries(doc.templates || {})) {
      for (const u of t.urls || []) add(u, 'template-map', tname);
    }
  }
  let sitemapPaths = null;
  if (base) {
    const res = await fetchUrl(`${base.replace(/\/$/, '')}/sitemap.xml`);
    if (res.ok) {
      sitemapPaths = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
        .map((m) => { try { return new URL(m[1]).pathname.replace(/\/$/, '') || '/'; } catch { return null; } })
        .filter(Boolean);
      if (mergeSitemap) for (const p of sitemapPaths) if (!fragments.includes(p)) add(p, 'sitemap');
    }
  }
  return {
    pages: [...pages.values()].sort((a, b) => a.path.localeCompare(b.path)),
    sitemapPaths, // null = sitemap unavailable
    fragments,
  };
}
