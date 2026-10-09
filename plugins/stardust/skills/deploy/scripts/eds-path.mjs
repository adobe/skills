/**
 * skills/deploy/scripts/eds-path.mjs — the one delivered-path contract for EDS. Library, no CLI; pure, no I/O, nothing
 * runs on import (spec, rollout and deploy import it in both layouts: ../../deploy/scripts/ or ../deploy/).
 *
 * Observed on a live EDS origin: a folder index is served at `/a/` (`/a` answers 301 → `/a/`, `/a/index` 404); a leaf
 * page at `/a/b` (`/a/b/` 404); `.html` 404. Path segments are lower-case `[a-z0-9-]`.
 *   deliveredUrl(sourcePath) — the URL a source page is served at: segments sanitised, `.html` dropped, `/index` → `/a/`
 *   daPath(url)              — the DA document behind a delivered URL: `/a/` → `/a/index`, `/` → `/index`
 *   pathKey(path)            — the lookup key for matching links to pages (no query, `.html`, `/index` or trailing slash)
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
