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

/* ------------------------------------------------------------- reach ---- */
// Stable feature strings shared by the depth probe (dynamics-detect domCapture)
// and the reach pass, so a sidecar signal annotates the archetype finding
// when both saw it and mints a `reach-only` row when only the roster did.
export const REACH_FEATURES = {
  tabs: 'tabs / expanders (role=tablist, aria-expanded controls)',
  shadow: 'shadow-DOM component (open shadow root with content)',
  emptyConfig: 'empty data-* config container (client-rendered slot)',
  controls: 'form-less control group (sibling pages only)',
  searchShell: 'search shell page (results rendered client-side)',
  player: (vendor) => `video: ${vendor} player (ids in the live DOM)`,
  chat: 'chat: live chat widget',
  federated: 'micro-frontend module (remoteEntry.js / registerFederatedComponent)',
  quiz: 'quiz / questionnaire (client compute)',
};
const REACH_API = /\/(api|graphql|ajax|json|search|autocomplete|typeahead|suggest|client\/|webservices|_next\/data|wp-json|\.rest|odata)/i;
/** the `dynamic` sidecar fields reachSignals reads — the crawl.mjs `dynamicDom` contract evals/lint/dynamics-recall.mjs checks */
export const REACH_SIDECAR_FIELDS = ['triggers', 'mediaIds', 'forms', 'tabs', 'shadowHosts', 'emptyConfigContainers', 'controlGroups', 'searchShell', 'players', 'chatLoaders', 'federated', 'quiz'];

/**
 * Mask comments, string / template / regex literal contents of JS source with
 * spaces (same length, delimiters kept) so a brace walk over the result sees
 * code only. Regex literals are recognised by the preceding token (the usual
 * `/` after `( , = : [ ! & | ? { } ; return` heuristic).
 */
export function maskLiterals(src) {
  const out = src.split(''); const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  const prevCode = (i) => { let j = i - 1; while (j >= 0 && /\s/.test(out[j])) j -= 1; return j < 0 ? '' : out[j]; };
  const regexAllowed = (i) => { const c = prevCode(i); if (c === '') return true; if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true; return /(?:^|[^\w$])(return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/.test(src.slice(Math.max(0, i - 8), i).trim()); };
  let i = 0;
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j += 1; j += 1; } blank(i + 1, j); i = j + 1; continue; }
    if (c === '`') {
      // template literal: blank the text, keep `${ … }` code (recursion depth via a small stack)
      let j = i + 1; let depth = 0; let segStart = j;
      while (j < n) {
        if (depth === 0) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '`') { blank(segStart, j); break; }
          if (src[j] === '$' && src[j + 1] === '{') { blank(segStart, j); depth = 1; j += 2; continue; }
        } else {
          if (src[j] === '{') depth += 1;
          else if (src[j] === '}') { depth -= 1; if (depth === 0) { segStart = j + 1; } }
          else if (src[j] === '\'' || src[j] === '"' || src[j] === '`') { const q = src[j]; let k = j + 1; while (k < n && src[k] !== q) { if (src[k] === '\\') k += 1; k += 1; } blank(j + 1, k); j = k; }
        }
        j += 1;
      }
      i = j + 1; continue;
    }
    if (c === '/' && regexAllowed(i)) {
      let j = i + 1; let cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j += 1; }
      blank(i + 1, j); i = j + 1; continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * Keys of the object literal assigned to `name:` in `src` (`name: { a, b: 1, 'c-d': x, ...rest }`
 * → ['a', 'b', 'c-d']), whatever its formatting: multi-line, nested values, trailing commas,
 * comments and strings containing braces. Spreads and computed keys are skipped. Returns null
 * when no such object exists — the caller decides whether that is a failure.
 */
export function objectLiteralKeys(src, name) {
  const masked = maskLiterals(src);
  const re = new RegExp(`(?:^|[^\\w$.])${name.replace(/[$]/g, '\\$&')}\\s*:\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    let depth = 0; let entryStart = open + 1; const entries = [];
    for (let i = open; i < masked.length; i += 1) {
      const ch = masked[i];
      if ('{[('.includes(ch)) depth += 1;
      else if ('}])'.includes(ch)) { depth -= 1; if (depth === 0) { entries.push([entryStart, i]); break; } }
      else if (ch === ',' && depth === 1) { entries.push([entryStart, i]); entryStart = i + 1; }
    }
    if (depth !== 0) continue; // unbalanced → not the literal we want
    const keys = [];
    for (const [a, b] of entries) {
      // keys are read off the masked slice (comments blanked, string contents blanked but delimiters kept);
      // a quoted key's text is then taken from the raw source at the same offsets
      const m = masked.slice(a, b); const i0 = m.search(/\S/); if (i0 < 0 || m.startsWith('...', i0)) continue;
      if (m[i0] === '\'' || m[i0] === '"') { const i1 = m.indexOf(m[i0], i0 + 1); if (i1 > i0) keys.push(src.slice(a + i0 + 1, a + i1)); continue; }
      const k = m.slice(i0).match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
      if (k) keys.push(k[1]);
    }
    return keys;
  }
  return null;
}

/**
 * Fold the per-page `dynamic` sections extract --dynamics wrote (`pages/*.json`)
 * into reach rows. Pure: `records` = [{ slug, dynamic }]. Returns
 *   { summary, rows } — summary is the roll-up `_dynamics.json#reach` carries;
 *   each row is { class, feature, hint, pages, evidence, marker?, api? } with
 *   `pages` = how many sidecars showed the signal and `evidence` = up to 4 slugs.
 * Classes follow classes-and-signals.md: tabs / expanders / shadow content → M,
 * empty config container / remoteEntry → CR, search shell → S, player ids → V,
 * chat loader → T, control group / quiz → F, same-site API endpoint → A/S/D,
 * third-party script host → the vendor table's class.
 */
export function reachSignals(records) {
  const rows = new Map();
  const hit = (key, row, slug) => {
    const r = rows.get(key) || { ...row, pages: 0, evidence: [] };
    r.pages += 1; if (r.evidence.length < 4 && slug) r.evidence.push(slug);
    rows.set(key, r);
  };
  let withDyn = 0; const endpointPages = new Map(); const searchPages = new Set(); const formPages = new Set(); const triggerPages = new Map();
  for (const rec of records) {
    const d = rec && rec.dynamic; if (!d) continue; withDyn += 1;
    const slug = rec.slug || '';
    for (const e of d.endpoints || []) {
      const k = `${e.method} ${e.host}${e.path}`; endpointPages.set(k, (endpointPages.get(k) || 0) + 1);
      if (!e.sameSite || !(REACH_API.test(e.path) || /\.json$/.test(e.path))) continue;
      const isSearch = /search|autocomplete|typeahead|suggest/i.test(e.path);
      const isData = /\.json$/.test(e.path) && e.method === 'GET' && !REACH_API.test(e.path.replace(/\.json$/, ''));
      hit(`api|${k}`, { class: isSearch ? 'S' : isData ? 'D' : 'A', feature: `first-party ${isData ? 'data file' : 'API'} ${e.method} ${e.path}`, hint: isSearch ? 'search' : isData ? 'data' : 'api', api: { method: e.method, path: e.path } }, slug);
    }
    if ((d.summary?.searchForms || 0) > 0 || (d.forms || []).some((f) => f.search)) { searchPages.add(slug); hit('search-form', { class: 'S', feature: 'site search form (sibling pages only)', hint: 'search', searchForm: true }, slug); }
    if ((d.forms || []).some((x) => !x.search)) formPages.add(slug);
    for (const t of d.triggers || []) { triggerPages.set(t.marker, (triggerPages.get(t.marker) || 0) + 1); }
    for (const marker of new Set((d.triggers || []).map((t) => t.marker))) hit(`trigger|${marker}`, { class: 'M', feature: `modal trigger ${marker} (sibling pages only)`, hint: 'modal', marker }, slug);
    if ((d.tabs?.tablists || 0) > 0 || (d.tabs?.expanders || 0) > 0) hit('tabs', { class: 'M', feature: REACH_FEATURES.tabs, hint: 'modal' }, slug);
    if ((d.shadowHosts || []).length) hit('shadow', { class: 'M', feature: REACH_FEATURES.shadow, hint: 'client-rendered' }, slug);
    if ((d.emptyConfigContainers || []).length) hit('empty-config', { class: 'CR', feature: REACH_FEATURES.emptyConfig, hint: 'client-rendered' }, slug);
    if ((d.controlGroups || []).length) hit('controls', { class: 'F', feature: REACH_FEATURES.controls, hint: 'forms' }, slug);
    if (d.searchShell) hit('search-shell', { class: 'S', feature: REACH_FEATURES.searchShell, hint: 'search' }, slug);
    for (const vendor of new Set((d.players || []).map((p) => p.vendor).filter(Boolean))) hit(`player|${vendor}`, { class: 'V', feature: REACH_FEATURES.player(vendor), hint: 'media' }, slug);
    if ((d.chatLoaders || []).length) hit(`vendor|T|${REACH_FEATURES.chat}`, { class: 'T', feature: REACH_FEATURES.chat, role: REACH_FEATURES.chat, hint: 'tags' }, slug);
    if ((d.federated?.remoteEntries || []).length || (d.federated?.registerCalls || 0) > 0) hit('federated', { class: 'CR', feature: REACH_FEATURES.federated, hint: 'client-rendered' }, slug);
    if ((d.quiz?.markers || 0) > 0 || (d.quiz?.radioFieldsets || 0) > 0) hit('quiz', { class: 'F', feature: REACH_FEATURES.quiz, hint: 'client-compute?' }, slug);
    for (const h of d.thirdPartyScriptHosts || []) {
      const v = vendorFor(h.host || h); if (!v || v.class === '-') continue;
      hit(`vendor|${v.class}|${v.role}`, { class: v.class, feature: v.role, role: v.role, hint: v.class === 'T' ? 'tags' : v.class === 'F' ? 'forms' : v.class === 'V' ? 'media' : v.class === 'S' ? 'search' : v.class === 'X' ? 'decided-out' : 'inspect' }, slug);
    }
  }
  return {
    summary: { pagesWithEvidence: withDyn, of: records.length, endpoints: Object.fromEntries(endpointPages), searchFormPages: searchPages.size, formPages: formPages.size, triggerPages: Object.fromEntries(triggerPages) },
    rows: [...rows.values()],
  };
}
