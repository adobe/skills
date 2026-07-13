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
export async function fetchUrl(url, { redirect = 'follow', method = 'GET', timeoutMs = 20000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, redirect, signal: ctl.signal, headers: { 'user-agent': UA } });
      const body = method === 'HEAD' ? '' : await res.text();
      clearTimeout(timer);
      return {
        ok: res.ok,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        location: res.headers.get('location'),
        url: res.url,
        body,
      };
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= retries) return { ok: false, status: 0, headers: {}, location: null, url, body: '', error: e.message };
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
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

/* ----------------------------------------------------------------- html -- */

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode HTML entities in an attribute value (hrefs/content carry &#x26; etc.). */
export function decodeAttr(s) {
  return (s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
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
export async function buildInventory({ base, pathsFile, templateMap, fragments = ['/nav', '/footer'] }) {
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
      for (const p of sitemapPaths) if (!fragments.includes(p)) add(p, 'sitemap');
    }
  }
  return {
    pages: [...pages.values()].sort((a, b) => a.path.localeCompare(b.path)),
    sitemapPaths, // null = sitemap unavailable
    fragments,
  };
}
