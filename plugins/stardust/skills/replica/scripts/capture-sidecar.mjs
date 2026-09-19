/**
 * skills/replica/scripts/capture-sidecar.mjs — capture provenance sidecar
 * (`<capture>.png.json`): the ONE definition of what makes two stitched
 * captures comparable. stitch-shot writes it; pixel-compare and crop-compare
 * read both sides and refuse a pair that was not taken with the same
 * instrument parameters (source-fidelity-gate.md § Hardening rule 15).
 *
 * Why: mixed-instrument and mixed-consent compares produced whole false gate
 * rounds in the field — a self-noise capture (same page, same instrument)
 * read 0.00 % where the previous "drift" read 18 %; a reference taken with
 * consent accepted carried a +543 px social wall the deny-state build could
 * never match. The delta was the instrument, not the site. Refusing the
 * compare is cheaper than a round spent chasing it.
 *
 * Sidecar schema (written by stitch-shot; keys marked optional are produced
 * by other instruments/items and are ABSENT until then — never fabricated):
 *   {
 *     url, width, vh, dpr, capturedAt,                 // ISO-8601
 *     instrument: { name: 'stitch-shot', version, options },
 *     consent: { mode: 'accept'|'deny',
 *                via: '<selector>' | 'text:<label>' | 'none-detected' | 'failed' },
 *     dismissed: [ { kind: 'consent'|'extra'|'marketing', sel } ],
 *     fontsFailed: [ '<family>' ],
 *     docHeight, chunks,
 *     source: 'stitch-shot' | 'extract-capture',        // who took the PNG
 *     technique: 'headless' | 'headed-stealth',
 *     storageState?: boolean,                            // optional (session pin)
 *     variants?: [ ... ],                                // optional (A/B / geo markers)
 *     blocked: [ '<substr>' ],                             // --block list (refusal key; [] when none)
 *     hidden?: [], pinnedHidden?: [], tail?: {}, pendingDecodes?, seamRepeats?, visibilityState?,   // optional
 *     masksRects?: [ { kind: 'sel'|'iframe'|'img', sel?, src?, x, y, w, h, fixed? } ]
 *       // --mask-sel / --mask-iframes / --mask-images: page-space rects at scroll 0 after the settle;
 *       // present only when a --mask-* flag was given; fixed:true = inside pinned chrome, never masked
 *   }
 *
 * Refusal keys — a pair is incomparable when any of these differ, or when
 * only one side has a sidecar: instrument.name, width, vh, dpr, consent.mode,
 * blocked (as a set — a --block on one side only is a false measurement).
 * A pair with NO sidecar on either side (pre-sidecar PNGs compared directly)
 * is allowed through with a warning; gate.sh never lets that happen for the
 * live reference (it recaptures a live.png that has no sidecar).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

export const REFUSAL_KEYS = ['instrument.name', 'width', 'vh', 'dpr', 'consent.mode', 'blocked'];

export const sidecarPath = (png) => `${png}.json`;

export function readSidecar(png) {
  try { return JSON.parse(readFileSync(sidecarPath(png), 'utf8')); } catch { return null; }
}

export function writeSidecar(png, data) {
  writeFileSync(sidecarPath(png), `${JSON.stringify(data, null, 2)}\n`);
  return sidecarPath(png);
}

const get = (o, k) => k.split('.').reduce((x, y) => (x == null ? undefined : x[y]), o);
// list-valued keys (blocked[]) compare as sorted sets; an absent list equals an empty one.
const norm = (v) => (Array.isArray(v) ? [...new Set(v.map(String))].sort() : v === undefined ? undefined : v);
const normKey = (v, k) => (k === 'blocked' && v === undefined ? [] : v);

/**
 * Compare the two sidecars. Returns { sidecars, problems } where problems is
 * an empty array when the pair is comparable. `sidecars` is null when neither
 * side has one.
 */
export function comparability(aPng, bPng) {
  const a = readSidecar(aPng);
  const b = readSidecar(bPng);
  if (!a && !b) return { sidecars: null, problems: [] };
  const problems = [];
  if (!a || !b) problems.push(`only ${a ? 'A' : 'B'} has a provenance sidecar (<png>.json) — the other side was captured by a different or older instrument`);
  else for (const k of REFUSAL_KEYS) { const x = norm(normKey(get(a, k), k)); const y = norm(normKey(get(b, k), k)); if (JSON.stringify(x) !== JSON.stringify(y)) problems.push(`${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); }
  return { sidecars: { a, b }, problems };
}

/**
 * Enforce the rule for a compare instrument: exit 1 with a named message on
 * an incomparable pair unless `force`; warn when forced or when neither side
 * has a sidecar. Returns the sidecars object for the instrument's --json.
 */
export function requireComparable(tool, aPng, bPng, { force = false } = {}) {
  const { sidecars, problems } = comparability(aPng, bPng);
  if (!sidecars) { console.error(`${tool}: no provenance sidecar on either side — pre-sidecar captures; comparability (instrument, width, vh, dpr, consent mode) is unverified.`); return { sidecars: null }; }
  if (!problems.length) return { sidecars };
  const head = `${tool}: INCOMPARABLE CAPTURES — ${problems.join('; ')}.`;
  if (!force) {
    console.error(`${head} Not a gate verdict (exit 1): re-capture the odd side with the same flags (gate.sh recaptures a live.png that has no sidecar), or pass --force to compare anyway.`);
    process.exit(1);
  }
  console.error(`${head} --force given: comparing anyway — this number is not a gate number.`);
  return { sidecars, incomparable: problems, forced: true };
}

// Library module — `node capture-sidecar.mjs --help` prints the schema block
// from the header above (the one definition; nothing else runs when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(0, src.indexOf('*/')).replace(/^\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
}
