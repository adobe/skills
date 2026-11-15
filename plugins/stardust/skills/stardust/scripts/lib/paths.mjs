/**
 * skills/stardust/scripts/lib/paths.mjs — the EDS path contract, in every form a stardust script uses it. Pure library:
 * no I/O, nothing runs on import. Reached through ../contracts.mjs (README.md § Layout).
 *
 * Owns: the canonical delivered-path rules (moved verbatim from deploy/scripts/eds-path.mjs, which now re-exports them)
 * plus one NAMED variant per consumer whose current output differs from the canonical rule. The characterization test
 * (scripts/test/contracts-characterize.test.mjs) pins every variant's output; a variant converges on the canonical rule
 * only in a deliberate commit that removes its KNOWN_DIVERGENCE rows. Replaces: deploy eds-path.mjs (canonical rules),
 * rollout inventory.mjs sidecarFor/deliveredPath/urlToDeliveredPath/pathToSlug, rollout assemble.mjs normPath, rollout
 * lib.mjs publicUrl's slash rule (and rollout da-library.mjs's page path, the same rule), rollout delivery-lint.mjs
 * path-safety, rollout seed-redirects' lookup of eds-path, deploy deploy-batch webPath, qa lib listing keys and
 * from-knowledge, diff chrome-compare hrefKey, spec-knowledge's redirect key and delivered URL, migrate sidecarFor /
 * urlFormOf, replica gate-evidence daPath.
 *
 * Observed on live EDS sites: a folder index is served at `/a/` (`/a` 404s on a plain site; some sites add a 301;
 * `/a/index` 404s); a leaf page at `/a/b` (`/a/b/` 404s); `.html` 404s. Path segments are lower-case `[a-z0-9-]`.
 *
 * Canonical (deploy eds-path.mjs; localize-links, seed-redirects, spec-knowledge, qa from-knowledge, delivery-lint):
 *   deliveredUrl(sourcePath) — the URL a source page is served at: segments sanitised, `.html` dropped, `/index` → `/a/`
 *   daPath(url)              — the DA document behind a delivered URL: `/a/` → `/a/index`, `/` → `/index`
 *   pathKey(path)            — the lookup key for matching links to pages (no query, `.html`, `/index` or trailing slash)
 *
 * Named variants (each line names the consumer whose output it reproduces and what it keeps that pathKey drops):
 *   treePath(relHtml)              rollout inventory deliveredPath, replica gate-evidence daPath — a migrated file's key path;
 *                                  keeps case, query-like characters; strips only a lowercase `.html` and `/index`
 *   rosterPath(url)                rollout inventory urlToDeliveredPath (archetypes-only roster) — URL pathname; keeps a
 *                                  trailing slash, case, query/hash of a non-URL string; strips lowercase `.html`, `/index`
 *   pathSlug(path)                 rollout inventory pathToSlug — `/de/x/y` → `de-x-y`, `/` → `home`
 *   sidecarName(relHtml, {loose})  rollout inventory sidecarFor (strict: `.html` only) and migrate sidecarFor
 *                                  (loose: `.htm`/`.html`, any case) — `index.html` → `_meta.json`, `x.html` → `x._meta.json`
 *   sitemapKey(path)               rollout assemble normPath — served-vs-expected sitemap comparison key; no query/hash,
 *                                  no trailing slash, `/index` folded; keeps case and `.html`
 *   servedPath(path, {folderIndex}) rollout lib publicUrl — a folder index gets its trailing slash, everything else is kept
 *   isFolderIndexFile(file)        the migrated file that makes a path a folder index (`…/index.html`)
 *   safePath(daPath)               rollout delivery-lint path-safety — lower case, `_` → `-`, collapsed dashes and slashes,
 *                                  no trailing slash; the lint fails when it differs from the given path
 *   documentPath(relHtml)          deploy deploy-batch webPath — the DA document a content file PUTs to (`a/index.html` →
 *                                  `/a/index`); keeps case and query-like characters
 *   listingKey(path), listingUrl(path)  qa lib buildInventory — a path listing's key (no trailing slash) and served URL
 *                                  (the listing's own trailing slash kept); nothing else touched
 *   chromeHrefKey(href)            diff chrome-compare hrefKey — decoded, lower-case pathname without `.htm(l)`/`/index`/
 *                                  trailing slash, query KEPT (a header link's parameters are part of its identity)
 *   redirectKey(path)              spec-knowledge needsEntry — strips `.html`, `/index`, one trailing slash; keeps case/query
 *   urlForm(outputPath)            migrate urlFormOf — a migrated file's URL form: `index.html` dropped, nothing else
 */

/** The URL a source path is served at on EDS. Pure. */
export function deliveredUrl(path) {
  let p = String(path || '/').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.endsWith('.html')) p = p.slice(0, -5);
  else if (p.endsWith('.htm')) p = p.slice(0, -4);
  if (p.endsWith('/index')) p = `${p.slice(0, -6)}/`;
  const out = p.split('/').map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).join('/');
  return out.startsWith('/') ? out : `/${out}`;
}

/** The DA document path behind a delivered URL. Pure. */
export const daPath = (url) => (String(url).endsWith('/') ? `${url}index` : String(url));

/** Lookup key: no query or fragment, no `.html`, no `/index`, no trailing slash (root stays `/`), lower case. Pure. */
export function pathKey(p) {
  let s = (p || '').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\.html?$/i, '');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (s === '' || s === '/index') s = '/';
  s = s.replace(/\/index$/, '');
  return s.toLowerCase() || '/';
}

// ------------------------------------------------------------------------------------------------ named variants --

/** rollout inventory deliveredPath / replica gate-evidence daPath: the key path of a migrated file (`a/index.html` → `/a`). Pure. */
export function treePath(relHtml) {
  const noExt = String(relHtml).replace(/\.html$/, '');
  if (noExt === 'index') return '/';
  if (noExt.endsWith('/index')) return `/${noExt.slice(0, -'/index'.length)}`;
  return `/${noExt}`;
}

/** rollout inventory urlToDeliveredPath: the key path of a roster URL (archetypes-only mode). Pure. */
export function rosterPath(url) {
  let p;
  try { p = new URL(url).pathname; } catch { p = String(url); }
  p = p.replace(/\.html$/, '');
  if (p === '' || p === '/' || p === '/index') return '/';
  if (p.endsWith('/index')) return p.slice(0, -'/index'.length);
  return p;
}

/** rollout inventory pathToSlug: a stable slug from a key path (`/de/x/y` → `de-x-y`; `/` → `home`). Pure. */
export function pathSlug(path) {
  if (path === '/') return 'home';
  return String(path).replace(/^\//, '').replace(/\/+$/, '').replace(/\//g, '-');
}

/**
 * The sidecar of a migrated HTML file (`index.html` → `_meta.json`; `x.html` → `x._meta.json`). `loose: false` is rollout
 * inventory's rule (only `.html` is an extension); `loose: true` is migrate's (`.htm`/`.html`, any case). Pure.
 */
export function sidecarName(relHtml, { loose = false } = {}) {
  const s = String(relHtml);
  const i = s.lastIndexOf('/');
  const dir = i < 0 ? '' : s.slice(0, i);
  const leaf = i < 0 ? s : s.slice(i + 1);
  const name = leaf === 'index.html' ? '_meta.json' : `${leaf.replace(loose ? /\.html?$/i : /\.html$/, '')}._meta.json`;
  return dir ? `${dir}/${name}` : name;
}

/** rollout assemble normPath: the sitemap comparison key — no query/hash or trailing slash (root stays `/`), `/index` folded. Pure. */
export function sitemapKey(p) {
  let s = String(p || '/').split(/[?#]/)[0];
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/+$/, '') || '/';
  if (s === '/index') s = '/';
  if (s.endsWith('/index')) s = s.slice(0, -'/index'.length);
  return s;
}

/** rollout lib publicUrl's file test: is this migrated file a folder index (`…/index.html`, either separator)? Pure. */
export const isFolderIndexFile = (file) => /(^|[/\\])index\.html$/.test(String(file || ''));

/** rollout lib publicUrl: the URL EDS serves a key path at — a folder index gets its `/` (`/a` 404s on a plain site). Pure. */
export function servedPath(path, { folderIndex = false } = {}) {
  const p = String(path);
  return p !== '/' && !p.endsWith('/') && folderIndex ? `${p}/` : p;
}

/** rollout delivery-lint path-safety: the delivery-safe form of a DA path; a difference from the given path is a P0. Pure. */
export function safePath(daPathIn) {
  return String(daPathIn).toLowerCase()
    .split('/').map((s) => s.replace(/_/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')).join('/')
    .replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
}

/** deploy deploy-batch webPath: the DA document a content file is PUT to (`a/index.html` → `/a/index`). Pure. */
export const documentPath = (relHtml) => `/${String(relHtml).replace(/\.html$/, '')}`;

/** qa lib buildInventory: a listed path's key (no trailing slash; root stays `/`). Pure. */
export const listingKey = (path) => String(path).replace(/\/$/, '') || '/';
/** qa lib buildInventory: the URL a listed path is served at — its own trailing slash tells a folder index. Pure. */
export const listingUrl = (path) => { const k = listingKey(path); return String(path) !== k && String(path).endsWith('/') ? String(path) : k; };

/** diff chrome-compare hrefKey: a header link's identity — decoded lower-case pathname, extension/index/slash folded, query kept. Pure. */
export function chromeHrefKey(h) {
  let u; try { u = new URL(h, 'http://x'); } catch { return String(h || ''); }
  const p = decodeURIComponent(u.pathname).toLowerCase().replace(/\.html?$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1');
  return `${p}${u.search}`;
}

/** spec-knowledge needsEntry: the redirect comparison key — `.html`, `/index` and one trailing slash dropped, nothing else. Pure. */
export const redirectKey = (p) => String(p).replace(/\.html$/, '').replace(/\/index$/, '').replace(/\/$/, '');

/** migrate urlFormOf: a migrated file's URL form — `index.html` dropped, the extension of a leaf kept. Pure. */
export const urlForm = (outputPath) => String(outputPath).replace(/(^|\/)index\.html$/, '$1');
