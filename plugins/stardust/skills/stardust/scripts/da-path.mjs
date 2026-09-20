#!/usr/bin/env node
/**
 * skills/stardust/scripts/da-path.mjs — the one DA / Edge-Delivery-safe path rule.
 *
 * DA accepts a PUT (201) on almost any path; preview and delivery then 400/404 on
 * uppercase, `_`, `--`, edge `-`, dots, diacritics, spaces / `%xx`, `.html|.php`
 * leaves and query strings. Every consumer folds a path through THIS function
 * (rollout `delivery-lint.mjs` P0 path-safety, deploy `deploy-batch.mjs` before
 * the PUT, deploy `localize-links.mjs` map keys) — never a per-script copy.
 * Contract prose: rollout/reference/delivery-gates.md § Gate 3.
 *
 * Rule (one rule for every segment — the folder/leaf distinction is the
 * DIAGNOSIS, not the normaliser):
 *   1. drop `?query` and `#fragment`; strip an origin if a full URL is passed;
 *   2. split on `/`, drop empty segments (`//x//y/` → `/x/y`; root stays `/`);
 *   3. per segment: percent-decode → NFKD, strip combining marks → lowercase →
 *      `ß ae ø oe đ ł þ ð` map → `[^a-z0-9]+` → `-` → collapse → trim edge `-`;
 *   4. the LEAF additionally drops one trailing `.html|.htm|.php|.jsp|.asp|.aspx`
 *      (`/index` is KEPT — deploy-batch's webPath for `index.html` is `/index`;
 *      localize-links' canonicalPath folds it, this function does not).
 *   A segment that is EMPTY after folding (a non-Latin script) returns null:
 *   the caller must transliterate — there is no safe default.
 *
 * This is NOT extract's `slugify` (D6): slugs key `stardust/current/pages/<slug>.*`
 * as one flat identifier; the DA path is a per-segment fold of the source URL path.
 *
 * Usage (module):  import { normalizeDaPath, isDaSafePath } from '…/stardust/scripts/da-path.mjs';
 * Usage (CLI):     node skills/stardust/scripts/da-path.mjs <path> [<path> …]
 *                  prints `<path><TAB><safe>` per argument (`<path><TAB>!unsafe` when null)
 * Exit codes: 0 = every path already safe; 1 = at least one path differs or has no safe
 * form; 2 = usage (no path given). --help prints this header.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LETTER_MAP = { ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', đ: 'd', ł: 'l', þ: 'th', ð: 'd' };
const LEAF_EXT = /\.(?:html?|php|jsp|aspx?)$/i;

function foldSegment(raw) {
  let s = raw;
  try { s = decodeURIComponent(s); } catch { s = s.replace(/%20/g, ' '); }
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/[ßæøœđłþð]/g, (c) => LETTER_MAP[c]);
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** `/A_b/Ärztin.html?x=1` → `/a-b/arztin`; root → `/`; null when a segment empties (transliterate first). */
export function normalizeDaPath(input) {
  let s = String(input ?? '').trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, ''); // origin, if a full URL was passed
  s = s.split(/[?#]/)[0];
  const segs = s.split('/').filter(Boolean);
  if (!segs.length) return '/';
  const out = [];
  for (let i = 0; i < segs.length; i += 1) {
    const raw = i === segs.length - 1 ? segs[i].replace(LEAF_EXT, '') : segs[i];
    const t = foldSegment(raw);
    if (!t) return null;
    out.push(t);
  }
  return `/${out.join('/')}`;
}

/** True iff the path is already in its delivery-safe form. */
export function isDaSafePath(p) {
  return normalizeDaPath(p) === p;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
  if (!args.length) { console.error('usage: node skills/stardust/scripts/da-path.mjs <path> [<path> …]'); process.exit(2); }
  let diverged = 0;
  for (const p of args) {
    const safe = normalizeDaPath(p);
    if (safe !== p) diverged += 1;
    console.log(`${p}\t${safe === null ? '!unsafe' : safe}`);
  }
  process.exit(diverged ? 1 : 0);
}
