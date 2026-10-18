#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/diff/scripts/chrome-explore.mjs — the header's BEHAVIOUR, recorded by using it. Pixel and
 * style gates see the header at rest (pointer parked, motion frozen); a header can pass them with
 * every menu wrong. This explorer opens what a visitor opens and writes it down, so the source's
 * header is a contract and the build is checked against it with the same instrument
 * (chrome-compare.mjs).
 *
 * Per width: every control in the header root (buttons, disclosure triggers, nav links, inputs,
 * the hamburger) is hovered (desktop), clicked and opened from the keyboard (focus + Enter). Each
 * action that reveals content is a STATE: the revealed links, headings, images and inputs, the
 * panel's crop, aria-expanded, focus, scroll lock and the transitions/animations that ran. Each
 * state's close paths are tried (Escape + focus return, click outside, toggle, mouse leave) and
 * its own controls explored depth-first (mega-menu tabs, flyouts, drawer drill-downs), within a
 * budget; hitting it is reported, never silent. Inputs get the probe term typed (typeahead) and
 * submitted (the submit URL). The header's position is sampled at top / scrolled down / up /
 * back. Navigations are answered 204 so the page never leaves.
 *
 * Pollution guard (a first click right after load can catch the page hydrating, not the panel): every top-level state
 * that opened is sampled again on a FRESH page visited exactly as the first one was (the same visit: wait, overlay
 * dismissal, settle; then hide and baseline — a quick reload would click earlier after load), the same control and
 * action: its links, headings, images, inputs and, with pngjs + pixelmatch, its crop. A repeat that differs from the
 * first sample by more than --bar (sampleDelta: the larger of the structural and the crop pixel ratio) marks the state
 * `unstable: { delta, resample: 'agrees'|'differs', resampleDelta }` and is sampled once more: `agrees` (≤ bar) → the
 * state holds the re-sample (the settled sample, crop `…-settled.png`), `differs` → the repeat. The header records
 * `stability: { bar, checked, unstable: ['<w> <path> [<action>]'], crops? }` (`crops: 'skipped: <why>'` when crops were
 * not compared) or `'skipped: --no-repeat'`, printed after the summary. unstableAsWarn(findings, source) turns
 * chrome-compare's errors on an unstable state into warnings.
 *
 * Usage: node skills/diff/scripts/chrome-explore.mjs <url> <out.json> [options]
 *   --width <w,…>        viewport widths (default 1440,390; below 768 is touch: no hover)
 *   --root <sel>         header root (default: first visible header, [role=banner], .header)
 *   --max-states <n>     states per width (default 400)   --max-depth <n>  nesting (default 4)
 *   --probe <term>       search term (default: spec knowledge's first probe, else a nav label word)
 *   --shots <dir>        open-state crops (default stardust/.work/chrome/<out name>)
 *   --plain              bundled Chromium instead of the window-free real-Chrome tier
 *   --warmup <url>       visit first (bot-managed sites)   --locale <tag>  default en-US
 *   --hide <sel,…>       hide in-flow regions (a location bar above the header) after every load; repeatable
 *   --slug <slug>        the page's key in presence.json: its `hide` too, after "*"'s (optional)
 *   --presence <file>    also hide a gate dir's presence.json `hide` ("*", then the slug; needs --slug)
 *   --bar <ratio>        pollution guard: a fresh-page repeat differing by more is unstable (default 0.02, chrome-compare's)
 *   --no-repeat          skip the guard (recorded: stability 'skipped: --no-repeat')
 * The site-wide stardust/replica/presence.json is read by default (its "*" `hide`, plus the --slug entry's), merged
 * under --presence's file (that file's field wins per key); its selectors are tagged `site presence.json`.
 * A hide list is recorded as `hide: { list, presence, site?, perWidth }` with one `<w>: hidden …` line per width.
 *
 * Paired: node skills/diff/scripts/chrome-explore.mjs <source-url> <contract.json> --build <build-url> <build.json> [options]
 *   the source contract and the build record in one run, with the same options and the same probe term on both sides.
 *   --build <url> <out>  the build side (two values); always explored, never cached; its crops in
 *                        stardust/.work/chrome/<build name> (--shots names the source's; the two must differ)
 *   --fresh              re-explore every source width (and overwrite its cache)
 *   --build-only         explore only the build: <contract.json> must exist (else exit 1), is left untouched and its
 *                        probe term is the build's (unless --probe); prints `chrome-explore build-only: source contract
 *                        <contract.json> kept (explored <its at>)`
 *   Each source width comes from the run cache when it holds one: stardust/.work/chrome/source-<hash>.json, its crops in
 *   source-<hash>/ (copied into the contract's crops dir). <hash> = the first 16 hex of sha256 over the canonical JSON
 *   (sorted keys) of what shapes the record: url, width, root, the effective hide list (selector + source), max-states,
 *   max-depth, probe (--probe, else search-probes.json's term; null when read from the page), locale, tier (--plain),
 *   bar, repeat, warmup. A hit needs the file to parse, its inputs to equal these and its crops dir (and every crop it
 *   names) to exist: `chrome-explore source <w>: cached <path> (explored <at>) — --fresh re-explores`, no page opened.
 *   A miss is explored and stored (tmp + rename): `chrome-explore source <w>: explored → <path>`. With the probe read
 *   from the page, a hit's term is the run's and a cached width read with another term is a miss. <contract.json> is
 *   composed from the width records as the single form writes it: the same fields in the same order, `at` the earliest
 *   width's, each width's hide records and stability folded in --width order, the one probe. The single form never
 *   reads or writes the cache (--fresh is a no-op there). Summary lines are prefixed `source ` / `build `.
 * Parallel: every explore of a run (each width; paired: each side × width not cached) starts at once, each in its own
 * browser context, over min(explores, STARDUST_BROWSERS_PER_SLOT) browsers (run-bg exports it; unset or invalid → 1:
 * one browser, its contexts concurrent) — explore i in browser i mod n. Records, files and lines follow --width order
 * whatever finishes first; a repeated width is explored once. A probe read from the page is read once, before (one
 * visit, the first width's viewport, on that explore's page, as before). One failure closes every browser (exit 3 on
 * a bot challenge, naming the URL).
 * Warmup retry: a source (or single) explore that finds 0 controls — an empty header, the mark of a bot wall or a cold
 * edge on the first visit — retries once in a fresh context, warming up with the page's own URL first (unless --warmup is
 * already given, and never on the build side), inside the run's own deadline, and says so on one line.
 * Why: a recorded hands-off run explored its header eight times (57 browser-minutes, 431 s each on average), four of
 * them the unchanged source once the caller's own one-hour cache had lapsed — each run one width after the other.
 * Exit: 0 written · 1 error · 3 bot challenge. `summarize`, `controlCount`, `controlKind`, `normName`, `hideArgs`,
 * `effectiveHide`, `sampleDelta`, `cropDeps`, `cropRatio`, `unstableAsWarn`, `stabilityLine`, `exploreArgs`,
 * `sourceInputs`, `sourceKey`, `sourceCachePath`, `cropsOf`, `cacheMiss`, `readSourceCache`, `composeDoc`,
 * `browsersPerSlot`, `exploreAll` are exported.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatHidden, hideEntries, hideRegions, parseHideList, readPresenceFile, SITE_PRESENCE } from './live-session.mjs';

const TOUCH_BELOW = 768;

/** Lower-case, collapse whitespace, strip punctuation: the pairing key of a control. Pure. */
export const normName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

const KINDS = [
  ['search', /\b(search|buscar|busca|recherche|rechercher|suche|suchen|cerca|zoeken|sök|haku|szukaj|検索|搜索|검색)\b/i],
  ['cart', /\b(cart|bag|basket|panier|warenkorb|carrello|carrito|winkelwagen|cesta)\b/i],
  ['account', /\b(account|sign in|log ?in|sign up|profile|my [a-z]+|konto|compte|cuenta|anmelden|connexion)\b/i],
  ['locale', /\b(language|languages|locale|country|region|lang|sprache|langue|idioma)\b/i],
  ['drawer', /\b(menu|navigation|hamburger|open nav|toggle nav)\b/i],
];
/** The control's family from its name, role and attributes. Pure. */
export function controlKind({ name = '', role = '', type = '', hint = '' }) {
  if (role === 'input' && /search/i.test(`${type} ${hint} ${name}`)) return 'search';
  // class names say "menu" on every nav toggle: only a control NAMED menu is the drawer
  for (const [k, re] of KINDS) if (re.test(k === 'drawer' ? name : `${name} ${hint}`)) return k;
  return role === 'link' ? 'link' : role === 'input' ? 'input' : 'menu';
}

/** A width explore's header-control count (an empty header → 0, the signal to retry with a warmup). Pure. */
export const controlCount = (result) => (result && Array.isArray(result.controls) ? result.controls.length : 0);

/** One line per width: controls, states, distinct links, depth, kinds, truncation. Pure. */
export function summarize(doc) {
  return Object.entries(doc.widths || {}).map(([w, d]) => {
    const links = new Set(); let states = 0; let depth = 0; let unstable = 0; const kinds = {};
    const opens = (c) => c.search || Object.values(c.actions || {}).some((s) => s && s.opened);
    const walk = (cs, lvl) => {
      for (const c of cs) {
        if (lvl === 1 && opens(c)) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
        for (const s of Object.values(c.actions || {})) {
          if (!s || !s.opened) continue;
          states += 1; depth = Math.max(depth, lvl); if (s.unstable) unstable += 1;
          for (const l of s.panel.links) links.add(`${normName(l.text)} ${l.href}`);
        }
        walk(c.children || [], lvl + 1);
      }
    };
    walk(d.controls || [], 1);
    const k = Object.entries(kinds).map(([n, c]) => `${c} ${n}`).join(', ');
    return `${w}: ${(d.controls || []).filter(opens).length} controls (${k || 'none'}), ${states} states, ${links.size} links, depth ${depth}${unstable ? `, ${unstable} unstable` : ''}${d.truncated ? `, TRUNCATED at ${d.truncated}` : ''}`;
  });
}

const r4 = (x) => Math.round(x * 10000) / 10000;
const OPENERS = ['click', 'hover', 'key'];

/** Two samples of one state (the first, a repeat on a fresh page) → { delta, structural, crop }, 4 dp. `structural`: the
 * symmetric difference over the union of the panel's link keys (normName(text) + href), headings, images and inputs,
 * each counted; one side open and the other not = 1. `cropRatio`: the crops' cropRatio(), or why there is none →
 * `crop: 'skipped: <why>'` (default `no crops`), never counted as equal. `delta` = the larger part. Pure. */
export function sampleDelta(first, repeat, { cropRatio: ratio = null } = {}) {
  const on = (s) => !!(s && s.opened);
  const items = (s) => {
    const p = s.panel || {}; const n = {};
    const keys = [...(p.links || []).map((l) => `l ${normName(l.text)} ${l.href}`), ...(p.headings || []).map((h) => `h ${normName(h)}`), ...Array(p.images || 0).fill('i'), ...(p.inputs || []).map((t) => `n ${t}`)];
    return new Set(keys.map((k) => { n[k] = (n[k] || 0) + 1; return `${k} #${n[k]}`; }));
  };
  let structural = on(first) === on(repeat) ? 0 : 1;
  if (on(first) && on(repeat)) {
    const a = items(first); const b = items(repeat); const union = new Set([...a, ...b]);
    structural = union.size ? [...union].filter((k) => !(a.has(k) && b.has(k))).length / union.size : 0;
  }
  const crop = typeof ratio === 'number' ? r4(ratio) : `skipped: ${ratio || 'no crops'}`;
  return { delta: r4(Math.max(structural, typeof crop === 'number' ? crop : 0)), structural: r4(structural), crop };
}

let depsP = null;
/** pngjs + pixelmatch from the project (cwd), else beside this script → { PNG, pixelmatch }, or null when not installed. */
export function cropDeps() {
  const load = async (name) => {
    try { const req = createRequire(join(process.cwd(), 'package.json')); const m = await import(pathToFileURL(req.resolve(name)).href); return m.default || m; } catch { /* fall through */ }
    const m = await import(name); return m.default || m;
  };
  depsP = depsP || (async () => { try { return { PNG: (await load('pngjs')).PNG, pixelmatch: await load('pixelmatch') }; } catch { return null; } })();
  return depsP;
}

/** Two PNG crops → differing pixels (pixelmatch 0.1) over the union box, a size difference counting as different:
 * chrome-compare's visual measure, 4 dp. `deps` = cropDeps(). */
export function cropRatio(a, b, { PNG, pixelmatch }) {
  const x = PNG.sync.read(a); const y = PNG.sync.read(b);
  const w = Math.min(x.width, y.width); const h = Math.min(x.height, y.height);
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o.data; };
  const diff = w && h ? pixelmatch(crop(x), crop(y), null, w, h, { threshold: 0.1 }) : 0;
  const union = Math.max(x.width, y.width) * Math.max(x.height, y.height);
  return union ? r4((diff + (union - w * h)) / union) : 0;
}

/** chrome-compare findings + the source contract → every `error` on a source state marked `unstable` becomes `warn` with
 * `unstable: true` and a note on its detail: same width and path (`<name or kind>` joined by ` > `, as chrome-compare
 * builds it) and the state's action — or no action (close paths, a missing control) and child paths when the state is
 * the control's opener (click, hover, key: the first that opened). Pure; new objects, the input untouched. */
export function unstableAsWarn(findings, sourceDoc) {
  const marks = [];
  const walk = (cs, width, path) => {
    for (const c of cs || []) {
      if (c.role === 'input') continue;
      const p = path ? `${path} > ${c.name || c.kind}` : (c.name || c.kind);
      const opener = OPENERS.find((a) => c.actions && c.actions[a] && c.actions[a].opened);
      for (const [a, s] of Object.entries(c.actions || {})) if (s && s.unstable) marks.push({ width, p, a, opener: a === opener });
      walk(c.children, width, p);
    }
  };
  for (const [w, d] of Object.entries((sourceDoc && sourceDoc.widths) || {})) walk(d.controls, Number(w), '');
  const hit = (f) => marks.some((m) => Number(f.width) === m.width && (f.path === m.p ? (f.action ? f.action === m.a : m.opener) : m.opener && String(f.path || '').startsWith(`${m.p} > `)));
  return findings.map((f) => (f.severity === 'error' && hit(f) ? { ...f, severity: 'warn', unstable: true, detail: `${f.detail} (source state unstable: sampled differently on a fresh page)` } : f));
}

/** The header's `stability` → one stdout line; null for a record without one (explored before the guard). Pure. */
export function stabilityLine(doc) {
  const st = doc && doc.stability;
  if (!st) return null;
  if (typeof st === 'string') return `stability ${st} — first samples were not repeated on a fresh page`;
  const crops = st.crops ? ` (crops ${st.crops})` : '';
  if (st.unstable.length) return `UNSTABLE: ${st.unstable.length} state(s) sampled differently on a fresh page (${st.unstable.join(', ')}) — contract findings on them are warnings${crops}`;
  return `stability: ${st.checked} top-level state(s) repeated on a fresh page, all within the bar ${st.bar}${crops}`;
}

/** argv → { hide: [<sel>…] (every --hide, comma lists), presence, slug }. Pure; a usage error throws (chrome-compare
 * reads the same flags). */
export function hideArgs(argv) {
  const values = (k, what) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : [])).map((v) => { if (!v || v.startsWith('--')) throw new Error(`${k} needs ${what}`); return v; });
  const hide = parseHideList(values('--hide', 'a selector list'));
  const [presence = null] = values('--presence', 'a file');
  const [slug = null] = values('--slug', 'a value');
  if (presence && !slug) throw new Error('--presence needs --slug <slug> (the page\'s key in presence.json)');
  return { hide, presence, slug };
}

/** hideArgs → the effective list: --hide entries, then presence.json's `hide` ("*", then the slug; only `hide` — a
 * `variable` region inside the header can be a control the contract records), de-duplicated →
 * { entries: [{ sel, source }], presence: <file> | null, found, note }. The site-wide presence file (`site`, default
 * live-session's SITE_PRESENCE) is read by default — merged under `presence` when both exist, alone (its "*", plus the
 * slug's entry when a slug is given) otherwise; its selectors are tagged `site presence.json` and the result gains
 * `site: <file>`. Without a site file the result is as before. Malformed presence.json (either file) throws. */
export function effectiveHide({ hide = [], presence = null, slug = null, site = SITE_PRESENCE } = {}) {
  const siteFile = site && existsSync(site) ? site : null;
  const p = presence || siteFile ? readPresenceFile(presence, slug, { site: siteFile }) : null;
  const fromFile = p ? (p.hideSources || hideEntries(p.hide, 'presence.json')) : [];
  const entries = hideEntries([...hideEntries(hide, '--hide'), ...fromFile]);
  return { entries, presence: presence || null, found: p ? p.found : null, note: p ? p.note : null, ...(p && p.site ? { site: p.site } : {}) };
}

const BOOL_FLAGS = ['--plain', '--no-repeat', '--fresh', '--build-only'];
/** argv → { url, out, build: { url, out } | null, buildOnly, fresh }: the positional pair (the source contract in the
 * paired form) and the paired form's flags; `--build` takes two values. Pure; a usage error throws. */
export function exploreArgs(argv) {
  const at = argv.flatMap((a, i) => (a === '--build' ? [i] : []));
  if (at.length > 1) throw new Error('--build is given once: --build <build-url> <build.json>');
  let build = null;
  if (at.length) {
    const [u, o] = [argv[at[0] + 1], argv[at[0] + 2]];
    if (!u || u.startsWith('--') || !o || o.startsWith('--')) throw new Error('--build needs two values: --build <build-url> <build.json>');
    build = { url: u, out: o };
  }
  const taken = new Set(at.length ? [at[0] + 1, at[0] + 2] : []);
  const [url = null, out = null] = argv.filter((a, i) => !taken.has(i) && !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !BOOL_FLAGS.includes(argv[i - 1])));
  const buildOnly = argv.includes('--build-only'); const fresh = argv.includes('--fresh');
  if (buildOnly && !build) throw new Error('--build-only needs --build <build-url> <build.json> (it explores the build only)');
  if (buildOnly && fresh) throw new Error('--fresh re-explores the source, --build-only does not explore it: pass one of them');
  return { url, out, build, buildOnly, fresh };
}

// ---- the source cache: one file per URL + width, keyed by what shapes the record ----------------------------------
const CACHE_DIR = join('stardust', '.work', 'chrome');
/** One source width's cache file: stardust/.work/chrome/source-<key>.json (its crops in source-<key>/). */
export const sourceCachePath = (key) => join(CACHE_DIR, `source-${key}.json`);
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** What shapes one width's record: url, width, root, the effective hide list (selector + source, as hide.perWidth
 * records them), max-states, max-depth, probe (the term known before any visit; null when read from the page),
 * locale, tier, bar, repeat, warmup. Pure. */
export function sourceInputs({ url, width, root = null, hide = [], maxStates, maxDepth, probe = null, locale, tier, bar, repeat, warmup = null }) {
  return { url, width, root, hide: hide.map(({ sel, source }) => ({ sel, source })), maxStates, maxDepth, probe, locale, tier, bar, repeat, warmup };
}
/** sourceInputs → the cache key: the first 16 hex of sha256 over their canonical JSON (keys sorted). Pure. */
export const sourceKey = (inputs) => createHash('sha256').update(JSON.stringify(canonical(inputs))).digest('hex').slice(0, 16);

/** Every crop a width's record names (the `shot` of each state, nested controls too), sorted. Pure. */
export function cropsOf(result) {
  const out = new Set();
  const walk = (cs) => { for (const c of cs || []) { for (const s of Object.values(c.actions || {})) if (s && s.shot) out.add(s.shot); walk(c.children); } };
  walk(result && result.controls);
  return [...out].sort();
}

/** A source cache entry (parsed; null when unreadable) against the current inputs → null on a hit, else why it misses:
 * unreadable, other inputs, its crops dir gone, a crop it names gone. Pure but for `exists` (default existsSync). */
export function cacheMiss(entry, inputs, { exists = existsSync } = {}) {
  if (!entry || typeof entry !== 'object' || !entry.result || typeof entry.crops !== 'string' || typeof entry.at !== 'string' || typeof entry.probe !== 'string') return 'unreadable';
  if (!same(entry.inputs, inputs)) return 'other inputs';
  if (!exists(entry.crops)) return `crops dir ${entry.crops} gone`;
  const lost = cropsOf(entry.result).find((f) => !exists(join(entry.crops, f)));
  return lost ? `crop ${lost} gone` : null;
}
/** One source cache file → { entry, miss }: entry null and miss its reason (`none` without a file) unless it hits. */
export function readSourceCache(file, inputs) {
  if (!existsSync(file)) return { entry: null, miss: 'none' };
  let entry = null;
  try { entry = JSON.parse(readFileSync(file, 'utf8')); } catch { /* unreadable */ }
  const miss = cacheMiss(entry, inputs);
  return { entry: miss ? null : entry, miss };
}
// an explored source width: its crops (explored into `tmp`) become source-<key>/, the file is written tmp + rename; the
// old file goes first, so no file ever names a crops dir being replaced
function storeSource({ key, inputs, at, probe, result, tmp }) {
  const file = sourceCachePath(key); const crops = join(CACHE_DIR, `source-${key}`);
  rmSync(file, { force: true }); rmSync(crops, { recursive: true, force: true }); renameSync(tmp, crops);
  const entry = { tool: 'chrome-explore source', key, at, inputs, crops, probe, result };
  const part = `${file}.${process.pid}.tmp`;
  writeFileSync(part, `${JSON.stringify(entry, null, 1)}\n`); renameSync(part, file);
  return entry;
}

/** The record file from per-width records (`records[i]` = { at, result } for `widths[i]`, an exploreWidth result, fresh
 * or cached): the fields and their order the single form always wrote — tool, url, at, shots, hide?, stability, widths,
 * probe. `at` = the earliest record's (`at` with no widths); each width's `hidden` goes to hide.perWidth and its
 * stability is folded into the header's (checked summed, unstable concatenated, the first crops note) in `widths`
 * order. `hide` = effectiveHide's result. Pure; the records untouched. */
export function composeDoc({ url, shots, hide, repeat, bar, probe, widths, records, at = null }) {
  const first = records.map((r) => r.at).filter(Boolean).sort()[0] || at;
  const doc = { tool: 'chrome-explore', url, at: first, shots, ...(hide.entries.length ? { hide: { list: hide.entries.map((x) => x.sel), presence: hide.presence, ...(hide.site ? { site: hide.site } : {}), perWidth: {} } } : {}), stability: repeat ? { bar, checked: 0, unstable: [] } : 'skipped: --no-repeat', widths: {} };
  widths.forEach((width, i) => {
    doc.probe = probe;
    const { hidden, stability, ...record } = records[i].result;
    doc.widths[width] = record;
    if (doc.hide) doc.hide.perWidth[width] = hidden;
    if (stability && typeof doc.stability === 'object') { doc.stability.checked += stability.checked; doc.stability.unstable.push(...stability.unstable); if (stability.crops) doc.stability.crops = doc.stability.crops || stability.crops; }
  });
  return doc;
}

/** STARDUST_BROWSERS_PER_SLOT (run-bg exports it) → the browsers one run may hold; unset or not a positive integer → 1. Pure. */
export function browsersPerSlot(env = process.env) { const n = Number(env.STARDUST_BROWSERS_PER_SLOT); return Number.isInteger(n) && n >= 1 ? n : 1; }

/** Every explore at once, each in its own context, over min(tasks, perSlot) browsers — task i in browser i mod n.
 * `launch()` → a browser; `before(browsers)` runs once they are open (the probe's one visit) and its value reaches
 * `explore(task, browser, i, value)`. → the results in task order, whatever order they finish in. The first failure is
 * thrown; every browser is closed either way. */
export async function exploreAll(tasks, { perSlot = 1, launch, before = null, explore }) {
  const n = Math.min(tasks.length, Number.isInteger(perSlot) && perSlot >= 1 ? perSlot : 1);
  if (!n) return [];
  const opened = await Promise.allSettled(Array.from({ length: n }, () => launch()));
  const browsers = opened.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  try {
    const failed = opened.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    const pre = before ? await before(browsers) : undefined;
    return await Promise.all(tasks.map((t, i) => explore(t, browsers[i % n], i, pre)));
  } finally { await Promise.all(browsers.map((b) => Promise.resolve().then(() => b.close()).catch(() => {}))); }
}

// ---- in-page library (installed once per document; ONE argument object per call) ------------------
function installInPage({ rootSel }) {
  if (window.__sdtc) return true;
  const ATOMS = 'a[href],button,input:not([type=hidden]),select,textarea,summary,h1,h2,h3,h4,h5,h6,[role=heading],[role=button],[role=tab],[role=menuitem],[role=option],img,label';
  const CTRL = 'button,summary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,[role=button],[role=tab],[role=menuitem],[role=switch],[role=combobox],[aria-expanded],[aria-haspopup],[aria-controls],label[for],a[href]';
  const root = () => [...document.querySelectorAll(rootSel || 'header,[role=banner],.header')].find((e) => e.getBoundingClientRect().height > 0) || null;
  const clipped = (el, r) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      // only hidden / clip overflow hides content; what a scroll container holds is reachable by scrolling
      if (!/hidden|clip/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
      const q = p.getBoundingClientRect();
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left); const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w <= 0 || h <= 0 || (w * h) < 0.5 * r.width * r.height) return true;
    }
    return false;
  };
  const vis = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (r.bottom < 0 || r.right < 0 || r.left > innerWidth) return false;
    return !clipped(el, r);
  };
  const skip = (el) => { const m = el.closest('main,footer,[role=contentinfo]'); const rt = root(); return m && !(rt && m.contains(rt)); };
  const atoms = () => [...document.querySelectorAll(ATOMS)].filter((el) => !skip(el));
  // visible text minus icons (svg, aria-hidden, icon-font ligatures): what pairs a control across source and build
  const ICON_FONT = /icon|symbol|awesome|glyph|ligature/i;
  const text = (el) => {
    const parts = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      const cs = p && getComputedStyle(p);
      if (!p || p.closest('svg,[aria-hidden=true],script,style') || ICON_FONT.test(cs.fontFamily) || /transparent/.test(cs.fontFamily) || cs.color === 'rgba(0, 0, 0, 0)') continue;
      if (p.closest('[hidden]') || getComputedStyle(p).display === 'none') continue;
      parts.push(n.nodeValue);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    const byId = lb && lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
    const img = el.querySelector && el.querySelector('img[alt],svg title');
    // the visible label pairs best (sites put icon words in aria-label) unless it is only a glyph (☰, ⌕); then the label, then hidden text
    const shown = text(el);
    return ((/[\p{L}\p{N}]/u.test(shown) ? shown : '') || el.getAttribute('aria-label') || byId || el.textContent || el.getAttribute('title') || (img && (img.getAttribute('alt') || img.textContent)) || el.getAttribute('placeholder') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  const cssPath = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && document.querySelectorAll(`#${e.id}`).length === 1) { parts.unshift(`#${e.id}`); break; }
      const sib = [...e.parentElement.children].filter((x) => x.tagName === e.tagName);
      parts.unshift(`${e.tagName.toLowerCase()}${sib.length > 1 ? `:nth-of-type(${sib.indexOf(e) + 1})` : ''}`);
    }
    return parts.join('>');
  };
  const realHref = (el) => { const h = el.getAttribute('href') || ''; return h && !/^(#|javascript:)/i.test(h); };
  const roleOf = (el) => (/^(input|select|textarea)$/i.test(el.tagName) && !/^(submit|button|reset|image)$/i.test(el.getAttribute('type') || '') ? 'input' : el.tagName === 'A' && realHref(el) && !el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup') && !el.hasAttribute('aria-controls') && !/^(tab|button|menuitem)$/.test(el.getAttribute('role') || '') ? 'link' : 'toggle');
  // a link inside a panel is explored only when it looks like a trigger: aria, or a hidden list beside it
  const hasHiddenSibling = (el) => { const li = el.closest('li'); return !!(li && [...li.querySelectorAll('ul,ol,div,section')].some((x) => !x.contains(el) && x.querySelector('a') && !vis(x))); };
  const linkOf = (a) => ({ text: (text(a) || a.getAttribute('aria-label') || '').slice(0, 120), href: a.href || a.getAttribute('href') || '' });
  let rootBase = new Map(); let base = new Map(); let motion = []; let listening = false;
  const lib = {
    root: () => { const r = root(); return r ? cssPath(r) : null; },
    // `root` = the closed page (reset compares against it); the current baseline is what a state is measured from
    snapshot({ root: r = false } = {}) { base = new Map(atoms().map((el) => [el, vis(el)])); if (r) rootBase = base; return base.size; },
    diff() {
      const now = atoms(); const appeared = now.filter((el) => vis(el) && base.get(el) !== true);
      const gone = [...base.entries()].filter(([el, v]) => v && !vis(el)).length;
      return { appeared, gone };
    },
    changed() { return atoms().filter((el) => vis(el) !== (rootBase.get(el) === true)).length; },
    controls({ scope }) {
      const rt = root();
      const pool = scope === 'root' ? (rt ? [...rt.querySelectorAll(CTRL)] : []) : lib.diff().appeared.flatMap((el) => [el, ...el.querySelectorAll(CTRL)]).filter((el) => el.matches(CTRL));
      const seen = new Set(); const out = [];
      // aria-expanded on a container (a <nav>) does not make it a control: it must take focus or a pointer itself
      const interactive = (el) => el.matches('a[href],button,summary,input,select,textarea,label[for],[role=button],[role=tab],[role=menuitem],[role=switch],[role=combobox]') || el.tabIndex >= 0;
      for (const el of pool) {
        if (seen.has(el) || !vis(el) || !interactive(el)) continue; seen.add(el);
        const role = roleOf(el);
        if (scope !== 'root' && role === 'link' && !hasHiddenSibling(el)) continue;
        if (el.tagName === 'LABEL' && !el.htmlFor) continue;
        const r = el.getBoundingClientRect();
        out.push({ sel: cssPath(el), name: nameOf(el), role, type: el.getAttribute('type') || '', hint: `${el.className || ''} ${el.id || ''} ${el.getAttribute('aria-controls') || ''}`.slice(0, 160), href: role === 'link' ? linkOf(el).href : '', expanded: el.getAttribute('aria-expanded'), rect: [r.x, r.y, r.width, r.height].map(Math.round) });
      }
      return out;
    },
    state({ sel }) {
      const { appeared, gone } = lib.diff();
      const content = appeared.filter((el) => el.matches('a[href],button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role=heading],img,[role=option]'));
      if (!content.length && gone < 2) return null;
      const t = document.querySelector(sel);
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const el of appeared) { const r = el.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      let lca = appeared[0] || null;
      while (lca && !appeared.every((el) => lca.contains(el))) lca = lca.parentElement;
      // the crop is the panel's own box: climb from the common parent to the last ancestor that does not hold the trigger
      while (lca && lca.parentElement && lca.parentElement !== document.body && t && !lca.parentElement.contains(t)) lca = lca.parentElement;
      if (lca && lca !== document.body && lca !== document.documentElement) {
        const r = lca.getBoundingClientRect();
        if (r.width * r.height < 0.95 * innerWidth * innerHeight || r.height < innerHeight) { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      }
      const clip = appeared.length ? [Math.max(0, x0), Math.max(0, y0), Math.min(innerWidth, x1), Math.min(innerHeight, y1)] : null;
      const ae = document.activeElement;
      const lock = [document.documentElement, document.body].some((e) => { const cs = getComputedStyle(e); return cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.position === 'fixed'; });
      return {
        opened: appeared.length > 0, hidden: gone,
        panel: {
          links: appeared.filter((el) => el.matches('a[href]')).map(linkOf),
          headings: appeared.filter((el) => el.matches('h1,h2,h3,h4,h5,h6,[role=heading]')).map((el) => text(el).slice(0, 120)).filter(Boolean),
          images: appeared.filter((el) => el.matches('img')).length,
          inputs: appeared.filter((el) => el.matches('input,select,textarea')).map((el) => el.getAttribute('type') || el.tagName.toLowerCase()),
          buttons: appeared.filter((el) => el.matches('button,[role=button]')).map(nameOf).filter(Boolean),
          options: appeared.filter((el) => el.matches('[role=option]')).length,
          rect: clip && [clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]].map(Math.round),
        },
        expanded: t ? t.getAttribute('aria-expanded') : null,
        focus: !ae || ae === document.body ? 'body' : t && (ae === t || t.contains(ae)) ? 'trigger' : appeared.some((el) => el === ae || el.contains(ae)) ? 'panel' : 'elsewhere',
        scrollLock: lock,
      };
    },
    focusReturned({ sel }) { const t = document.querySelector(sel); const ae = document.activeElement; return !!(t && ae && (ae === t || t.contains(ae))); },
    focusIn() { const ae = document.activeElement; return !!ae && lib.diff().appeared.some((el) => el === ae || el.contains(ae)); },
    focus({ sel }) { const t = document.querySelector(sel); if (!t) return false; t.focus(); return document.activeElement === t || t.contains(document.activeElement); },
    blur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); return true; },
    center({ sel }) { const t = document.querySelector(sel); if (!t) return null; t.scrollIntoView({ block: 'nearest' }); const r = t.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; },
    outsidePoint() {
      const { appeared } = lib.diff(); const rt = root();
      for (const [x, y] of [[innerWidth / 2, innerHeight - 12], [12, innerHeight - 12], [innerWidth - 12, innerHeight / 2], [innerWidth / 2, innerHeight * 0.75]]) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || appeared.some((el) => el.contains(hit) || hit.contains(el)) || (rt && rt.contains(hit)) || hit.closest('a,button,input,select,textarea,label,[role=button]')) continue;
        return { x, y };
      }
      return null;
    },
    motionStart() {
      motion = [];
      if (!listening) {
        listening = true;
        const rec = (e, kind) => {
          const t = e.target; if (!(t instanceof Element)) return;
          const a = (t.getAnimations ? t.getAnimations() : []).find((x) => (kind === 'transition' ? x.transitionProperty === e.propertyName : x.animationName === e.animationName));
          const tm = a && a.effect ? a.effect.getComputedTiming() : null;
          motion.push({ kind, prop: kind === 'transition' ? e.propertyName : e.animationName, ms: tm ? Math.round(Number(tm.duration) || 0) : null, delay: tm ? Math.round(tm.delay || 0) : null, easing: tm ? tm.easing : null, target: `${t.tagName.toLowerCase()}${t.classList.length ? `.${t.classList[0]}` : ''}` });
        };
        document.addEventListener('transitionrun', (e) => rec(e, 'transition'), true);
        document.addEventListener('animationstart', (e) => rec(e, 'animation'), true);
      }
      return true;
    },
    async motionSettle({ maxMs }) {
      const t0 = performance.now();
      await new Promise((r) => { setTimeout(r, 80); });
      for (;;) {
        const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && Number(a.effect.getComputedTiming().endTime) !== Infinity);
        if (!running.length || performance.now() - t0 > maxMs) break;
        await new Promise((r) => { setTimeout(r, 60); });
      }
      const seen = new Set();
      return motion.filter((m) => { const k = `${m.kind}|${m.prop}|${m.target}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    },
    header() {
      const rt = root(); if (!rt) return null;
      const r = rt.getBoundingClientRect(); const cs = getComputedStyle(rt);
      let pos = cs.position; for (let p = rt.parentElement; p && pos === 'static'; p = p.parentElement) { const q = getComputedStyle(p).position; if (q === 'fixed' || q === 'sticky') pos = q; }
      return { y: Math.round(scrollY), top: Math.round(r.top), height: Math.round(r.height), position: pos, inView: r.bottom > 1 && r.top < innerHeight };
    },
  };
  window.__sdtc = lib;
  return true;
}

async function loadPlaywright() {
  const norm = (m) => (m.chromium ? m : m.default);
  try { const req = createRequire(join(process.cwd(), 'package.json')); return norm(await import(pathToFileURL(req.resolve('playwright')).href)); } catch { /* fall through */ }
  return norm(await import('playwright'));
}

// null = the document was replaced (a navigation slipped through) or is being replaced
const call = async (page, fn, arg = {}) => { try { return await page.evaluate(async ({ f, a }) => (window.__sdtc ? { v: await window.__sdtc[f](a) } : null), { f: fn, a: arg }); } catch { return null; } };

/** Explore one width. Returns { root, controls[], scroll[], truncated, states, probe } (+ `hidden`, the first load's
 * hide records, when `hide` is set: applied after every load, before the baseline; + `stability: { checked, unstable,
 * crops? }` when `repeat`: the pollution guard, top-level open states repeated on a fresh `gotoFn` visit against `bar`). */
export async function exploreWidth(page, { url, width, rootSel, maxStates, maxDepth, probe, shotsDir, settleMs = 250, visitOpts = {}, gotoFn, hide = [], repeat = true, bar = 0.02 }) {
  const touch = width < TOUCH_BELOW;
  const vh = page.viewportSize().height;
  const hideList = hideEntries(hide);
  let hidden = null;
  let nav = null; let armed = true; let states = 0; let truncated = null; let shotN = 0;
  await page.route('**/*', (route) => {
    const r = route.request();
    if (armed && r.isNavigationRequest() && r.frame() === page.mainFrame()) { nav = r.url(); return route.fulfill({ status: 204, body: '' }); }
    return route.fallback();
  });
  let at = url; let loads = 0;
  // the first visit settles the page; later ones only restore the closed header (same URL, overlays already answered);
  // `full` repeats the first visit (the guard's fresh page: sampled no earlier after load than the first sample was)
  // navigations are answered 204 throughout (the page never leaves), except our own reloads
  const load = async ({ full = false } = {}) => {
    armed = false;
    if (loads++ === 0 || full) { await gotoFn(page, url, visitOpts); at = page.url(); } else { await page.goto(at, { waitUntil: 'load', timeout: 60000 }); await page.waitForTimeout(400); }
    // an in-flow bar above the header is gone before the root, its controls and the closed baseline are read
    const recs = await hideRegions(page, hideList, { settleMs });
    if (!hidden) hidden = recs;
    await page.evaluate(installInPage, { rootSel }); await call(page, 'snapshot', { root: true });
    armed = true;
  };
  async function C(fn, arg = {}) {
    let r = await call(page, fn, arg);
    if (!r) { await load(); r = await call(page, fn, arg); }
    return r ? r.v : null;
  }
  await load();
  const park = async () => { await page.mouse.move(2, vh - 2); };
  const reset = async () => {
    await park(); await page.keyboard.press('Escape'); await C('blur'); await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(settleMs);
    if (page.url().split('#')[0] !== at.split('#')[0] || await C('changed') > 0) await load();
    await C('snapshot');
  };
  const act = async (c, action) => {
    if (action === 'hover') { const p = await C('center', { sel: c.sel }); if (!p) return false; await page.mouse.move(p.x, p.y, { steps: 4 }); }
    else if (action === 'click') { const p = await C('center', { sel: c.sel }); if (!p) return false; await page.mouse.click(p.x, p.y); }
    else if (action === 'key') { if (!await C('focus', { sel: c.sel })) return false; await page.keyboard.press('Enter'); }
    return true;
  };
  // re-open the parents, then measure from there: a child's state is what IT reveals
  const replay = async (path) => { for (const step of path) { await act(step.c, step.action); await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs); } if (path.length) await C('snapshot'); };
  const grab = async (rect) => {
    if (!shotsDir || !rect || rect[2] < 4 || rect[3] < 4) return null;
    try { return await page.screenshot({ clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } }); } catch { return null; }
  };
  const save = (png, tag) => {
    if (!png) return null;
    shotN += 1; const f = join(shotsDir, `${width}-${String(shotN).padStart(3, '0')}-${tag.replace(/[^\w-]+/g, '-').slice(0, 40)}.png`);
    try { writeFileSync(f, png); return basename(f); } catch { return null; }
  };
  // one sample on the page as it is → [state, crop PNG]; the crop is saved only with a tag (a repeat keeps it in memory)
  const take = async (c, action, tag) => {
    nav = null;
    await C('motionStart');
    if (!await act(c, action)) return [null, null];
    const motion = await C('motionSettle', { maxMs: 2000 });
    await page.waitForTimeout(settleMs);
    const s = await C('state', { sel: c.sel });
    if (nav) return [{ opened: false, navigates: nav }, null];
    if (!s || !s.opened) return [s && s.hidden ? { opened: false, hides: s.hidden } : null, null];
    s.motion = motion;
    const png = await grab(s.panel.rect);
    s.shot = tag ? save(png, tag) : null;
    if (action === 'key') { await page.keyboard.press('Tab'); await page.waitForTimeout(80); s.tabReachesPanel = await C('focusIn'); }
    return [s, png];
  };
  const observe = async (c, action, path) => {
    await reset(); await replay(path);
    const [s] = await take(c, action, `${c.name || c.role}-${action}`);
    if (s && s.opened) states += 1;
    return s;
  };
  const closes = async (c, action, path) => {
    const out = {};
    const reopen = async () => { await reset(); await replay(path); await act(c, action); await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs); };
    const shut = async () => { await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs); const s = await C('state', { sel: c.sel }); return !s || !s.opened; };
    await reopen(); if (action === 'key' || action === 'click') await C('focus', { sel: c.sel });
    await page.keyboard.press('Escape'); out.escape = await shut(); out.focusReturn = out.escape ? await C('focusReturned', { sel: c.sel }) : false;
    await reopen(); const pt = await C('outsidePoint');
    if (pt) { await page.mouse.click(pt.x, pt.y); out.outside = await shut(); } else out.outside = null;
    if (action === 'click') { await reopen(); await act(c, 'click'); out.toggle = await shut(); }
    if (action === 'hover') { await reopen(); await park(); out.leave = await shut(); }
    return out;
  };
  const typeIn = async (c, path) => {
    await reset(); await replay(path);
    if (!await act(c, 'click')) return null;
    await C('snapshot');
    nav = null;
    await page.keyboard.type(probe, { delay: 80 }); await page.waitForTimeout(1500);
    const s = await C('state', { sel: c.sel });
    // the submit is followed (POST forms redirect to the results URL): record where the visitor lands, then reload
    armed = false;
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => null), page.keyboard.press('Enter')]);
    await page.waitForTimeout(800);
    const submit = page.url() !== at ? page.url() : nav;
    await load();
    return { probe, typeahead: s && s.opened ? { links: s.panel.links.length, options: s.panel.options } : { links: 0, options: 0 }, submit: submit ? submit.replace(encodeURIComponent(probe), '{q}').replace(probe.replace(/ /g, '+'), '{q}') : null };
  };
  const sig = (s) => JSON.stringify([s.panel.links.map((l) => l.href).sort(), s.panel.headings, s.panel.buttons]);
  const explore = async (scope, path, depth, seen = new Set(), known = new Set()) => {
    const found = (await C('controls', { scope })).filter((c) => !known.has(c.sel));
    const listed = new Set([...known, ...found.map((c) => c.sel)]);
    const out = [];
    for (const c of found) {
      if (states >= maxStates) { truncated = truncated || (path.map((p) => p.c.name).join(' > ') || 'top level'); break; }
      const node = { name: c.name, key: normName(c.name), role: c.role, kind: controlKind(c), sel: c.sel, href: c.href || undefined, expanded: c.expanded, rect: c.rect, actions: {} };
      if (c.role === 'input') { node.search = await typeIn(c, path); out.push(node); continue; }
      const acts = c.role === 'link' ? (touch ? [] : ['hover']) : touch ? ['click', 'key'] : ['hover', 'click', 'key'];
      for (const a of acts) node.actions[a] = await observe(c, a, path);
      const opener = ['click', 'hover', 'key'].find((a) => node.actions[a] && node.actions[a].opened);
      // a state already open higher up the path (a drawer's Back, a tab re-selecting the default pane) is recorded, not re-entered
      if (opener && seen.has(sig(node.actions[opener]))) node.returns = true;
      else if (opener) {
        node.close = await closes(c, opener, path);
        if (depth < maxDepth) {
          await reset(); await replay(path); await act(c, opener); await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs);
          node.children = await explore('panel', [...path, { c, action: opener }], depth + 1, new Set([...seen, sig(node.actions[opener])]), listed);
        } else truncated = truncated || `depth ${maxDepth} at ${[...path.map((p) => p.c.name), c.name].join(' > ')}`;
      }
      if (c.role === 'link' && !opener) { delete node.actions; node.actions = {}; }
      out.push(node);
    }
    return out;
  };
  // the pollution guard: a first click right after load can catch the page hydrating, not the panel — every top-level
  // open state is sampled again on a fresh page, the same control found the same way; over the bar it is sampled once more
  const fresh = async (node, action) => {
    await load({ full: true }); await reset();
    const cs = (await C('controls', { scope: 'root' })) || [];
    const c = cs.find((x) => x.sel === node.sel) || cs.find((x) => normName(x.name) === node.key && x.role === node.role);
    return c ? take(c, action) : [null, null];
  };
  const guard = async (controls) => {
    const out = { checked: 0, unstable: [] };
    const deps = shotsDir ? await cropDeps() : null;
    const why = !shotsDir ? 'no crops' : deps ? null : 'pngjs + pixelmatch not installed in this project';
    if (why) out.crops = `skipped: ${why}`;
    const delta = ([a, pa], [b, pb]) => sampleDelta(a, b, { cropRatio: why || (pa && pb ? cropRatio(pa, pb, deps) : 'one sample has no crop') }).delta;
    for (const node of controls) {
      for (const a of OPENERS) {
        const first = node.actions && node.actions[a];
        if (!first || !first.opened) continue;
        out.checked += 1;
        let png = null; try { png = first.shot ? readFileSync(join(shotsDir, first.shot)) : null; } catch { /* no crop */ }
        const rep = await fresh(node, a);
        const d1 = delta([first, png], rep);
        if (d1 <= bar) continue;
        const re = await fresh(node, a);
        const d2 = delta(rep, re);
        const [settled, settledPng] = d2 <= bar ? re : rep;
        const unstable = { delta: d1, resample: d2 <= bar ? 'agrees' : 'differs', resampleDelta: d2 };
        // a settled sample that opens nothing keeps the first one's fields: the state stays recorded, marked
        node.actions[a] = settled && settled.opened ? { ...settled, shot: save(settledPng, `${node.name || node.role}-${a}-settled`), unstable } : { ...first, unstable };
        out.unstable.push(`${width} ${node.name || node.kind} [${a}]`);
      }
    }
    return out;
  };
  const rootPath = await C('root');
  const controls = rootPath ? await explore('root', [], 1) : [];
  const stability = repeat ? (rootPath ? await guard(controls) : { checked: 0, unstable: [] }) : null;
  await reset();
  const scroll = [];
  const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
  if (rootPath && docH > vh + 1000) {
    for (const [label, y] of [['top', 0], ['down', 1000], ['up', 700], ['back', 0]]) {
      await page.mouse.wheel(0, y - await page.evaluate(() => scrollY)); await page.waitForTimeout(700);
      scroll.push({ at: label, ...(await C('header')) });
    }
  }
  await page.unroute('**/*');
  return { root: rootPath, controls, scroll, states, truncated, loads, ...(hideList.length ? { hidden } : {}), ...(stability ? { stability } : {}) };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const fail = (msg) => { console.error(`chrome-explore: ${msg}`); process.exit(1); };
  let parsed;
  try { parsed = exploreArgs(argv); } catch (e) { fail(e.message); }
  const { url, out, build, buildOnly, fresh } = parsed;
  if (!url || !out) { console.error('usage: chrome-explore.mjs <url> <out.json> [--build <build-url> <build.json> [--build-only | --fresh]] [--width 1440,390] [--root <sel>] [--max-states 400] [--max-depth 4] [--probe <term>] [--shots <dir>] [--plain] [--bar 0.02] [--no-repeat]'); process.exit(1); }
  const bar = Number(arg('bar', '0.02')); const repeat = !argv.includes('--no-repeat');
  if (!(bar >= 0 && bar <= 1)) { console.error(`chrome-explore: --bar needs a ratio in [0, 1] (default 0.02), not ${arg('bar', '')}`); process.exit(1); }
  let hide;
  try { hide = effectiveHide(hideArgs(argv)); } catch (e) { console.error(`chrome-explore: ${e.message}`); process.exit(1); }
  if (hide.found === false || (hide.presence && !existsSync(hide.presence))) console.error(`chrome-explore: ${hide.note}`);
  const widths = [...new Set(arg('width', '1440,390').split(',').map(Number).filter(Boolean))];
  const shotsDir = arg('shots', join('stardust', '.work', 'chrome', basename(out, '.json')));
  const buildShots = build ? join('stardust', '.work', 'chrome', basename(build.out, '.json')) : null;
  let kept = null;
  if (build) {
    if (resolve(build.out) === resolve(out)) fail(`the source contract and the build record are one file (${out}): name two`);
    if (buildOnly) {
      if (!existsSync(out)) fail(`--build-only keeps the source contract ${out}, which does not exist — explore it first (the paired form without --build-only)`);
      try { kept = JSON.parse(readFileSync(out, 'utf8')); } catch (e) { fail(`--build-only: the source contract ${out} is unreadable (${e.message})`); }
    }
    const srcShots = buildOnly ? kept && typeof kept.shots === 'string' && kept.shots : shotsDir;
    if (srcShots && resolve(srcShots) === resolve(buildShots)) fail(`the source and build crops would share ${buildShots} — pass --shots <dir> for the source's`);
  }
  const given = arg('probe', null);
  const sp = join('stardust', 'spec', 'knowledge', 'search-probes.json');
  const specProbe = () => { if (!existsSync(sp)) return null; try { return (JSON.parse(readFileSync(sp, 'utf8'))[0] || {}).term || null; } catch { return null; } };
  // the term known before any visit (the cache key's probe); null → read from the page once, before the explores
  let probe = given || (kept && typeof kept.probe === 'string' && kept.probe) || specProbe();
  if (given && kept && kept.probe && kept.probe !== given) console.error(`chrome-explore: --probe ${given} differs from the source contract's probe ${kept.probe} — the two sides type different terms`);
  const known = probe || null;
  const opts = { root: arg('root', null), maxStates: Number(arg('max-states', 400)), maxDepth: Number(arg('max-depth', 4)), locale: arg('locale', 'en-US'), tier: argv.includes('--plain') ? 'plain' : 'stealth', bar, repeat, warmup: arg('warmup', null) };
  // paired: each source width from the cache when it holds one (a page-read probe: the first hit's term is the run's)
  const source = build && !buildOnly ? widths.map((width) => {
    const inputs = sourceInputs({ url, width, hide: hide.entries, probe: known, ...opts });
    const key = sourceKey(inputs);
    return { width, inputs, key, file: sourceCachePath(key), entry: fresh ? null : readSourceCache(sourceCachePath(key), inputs).entry };
  }) : [];
  if (!probe) {
    const hit = source.find((s) => s.entry);
    if (hit) probe = hit.entry.probe;
    for (const s of source) if (s.entry && s.entry.probe !== probe) s.entry = null;
  }
  for (const s of source) s.hit = !!s.entry;
  if (buildOnly) console.log(`chrome-explore build-only: source contract ${out} kept (explored ${kept.at || 'at an unrecorded time'})`);
  if (!buildOnly) { mkdirSync(shotsDir, { recursive: true }); mkdirSync(dirname(out), { recursive: true }); }
  if (build) { mkdirSync(buildShots, { recursive: true }); mkdirSync(dirname(build.out), { recursive: true }); }
  if (source.length) mkdirSync(CACHE_DIR, { recursive: true });
  const tasks = [
    ...(build ? source.filter((s) => !s.hit).map((s) => ({ side: 'source', url, width: s.width, src: s, shots: join(CACHE_DIR, `source-${s.key}.tmp-${process.pid}`) })) : widths.map((width) => ({ side: 'single', url, width, shots: shotsDir }))),
    ...(build ? widths.map((width) => ({ side: 'build', url: build.url, width, shots: buildShots })) : []),
  ];
  const here = dirname(fileURLToPath(import.meta.url));
  const { openBrowser, openPage, visit } = await import(pathToFileURL(join(here, 'measure-live.mjs')).href);
  const { chromium } = tasks.length ? await loadPlaywright() : {};
  const gotoFn = (p, u) => visit(p, u, { warmup: opts.warmup, settle: { passes: 1, quietMs: 800 } });
  const openFor = async (task, browser) => {
    const { ctx, page } = await openPage(browser, { width: task.width, height: task.width < TOUCH_BELOW ? 844 : 900, locale: opts.locale });
    ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    return { ctx, page };
  };
  let at = new Date().toISOString();
  // after the first failure the other explores' browsers are closed under them: what they throw then is not the error
  let failing = false;
  process.on('unhandledRejection', (e) => { if (!failing) { console.error(`chrome-explore: ${e && e.message ? e.message : e}`); process.exit(1); } });
  const named = (task, e) => { failing = true; if (e && typeof e === 'object' && !e.exploreUrl) e.exploreUrl = task.url; return e; };
  let results;
  try {
    results = await exploreAll(tasks, {
      perSlot: browsersPerSlot(),
      launch: () => openBrowser(chromium, { tier: opts.tier }),
      // no probe yet: read once on the first explore's page (the first width of the side that is read), as before
      before: async (browsers) => {
        at = new Date().toISOString();
        if (probe) return null;
        const ready = await openFor(tasks[0], browsers[0]);
        try {
          await gotoFn(ready.page, tasks[0].url);
          await hideRegions(ready.page, hide.entries);
          probe = await ready.page.evaluate(() => ((document.querySelector('header nav,header') || document.body).innerText.match(/\p{L}{4,}/u) || ['news'])[0].toLowerCase());
        } catch (e) { throw named(tasks[0], e); }
        return ready;
      },
      explore: async (task, browser, i, ready) => {
        const prepShots = () => { if (task.side === 'source') { rmSync(task.shots, { recursive: true, force: true }); mkdirSync(task.shots, { recursive: true }); } };
        const run = (page, goto) => exploreWidth(page, { url: task.url, width: task.width, rootSel: opts.root, maxStates: opts.maxStates, maxDepth: opts.maxDepth, probe, shotsDir: task.shots, gotoFn: goto, hide: hide.entries, repeat, bar });
        try {
          prepShots();
          let { ctx, page } = i === 0 && ready ? ready : await openFor(task, browser);
          let result = await run(page, gotoFn);
          // A source (or single) explore that finds no controls retries once in a fresh context, warming up with the
          // page's own URL first — a bot wall or a cold edge can serve an empty header on the first visit. In-process, so
          // the run's own deadline bounds it; skipped when --warmup is already given or on the build side. It says so.
          if (!opts.warmup && task.side !== 'build' && controlCount(result) === 0) {
            console.log(`chrome-explore ${task.side === 'source' ? 'source ' : ''}${task.width}: 0 controls — retried once with a warmup visit`);
            await ctx.close();
            prepShots();
            ({ ctx, page } = await openFor(task, browser));
            result = await run(page, (p, u) => visit(p, u, { warmup: task.url, settle: { passes: 1, quietMs: 800 } }));
          }
          await ctx.close();
          // stored as soon as it is explored: a failure elsewhere in the run does not lose it
          if (task.side === 'source') task.src.entry = storeSource({ key: task.src.key, inputs: task.src.inputs, at, probe, result, tmp: task.shots });
          return result;
        } catch (e) {
          if (task.side === 'source') rmSync(task.shots, { recursive: true, force: true });
          throw named(task, e);
        }
      },
    });
  } catch (e) {
    if (e && e.name === 'BotChallengeError') { console.error(`chrome-explore: bot challenge on ${e.exploreUrl || url} — retry with --warmup or the headed tier`); process.exit(3); }
    throw e;
  }
  const write = (file, doc) => writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
  const report = (doc, file, shots, side) => {
    for (const line of summarize(doc)) console.log(`chrome-explore ${side}${line}`);
    if (stabilityLine(doc)) console.log(`chrome-explore ${side}${stabilityLine(doc)}`);
    for (const [w, recs] of Object.entries(doc.hide ? doc.hide.perWidth : {})) console.log(`chrome-explore ${side}${w}: hidden ${formatHidden(recs)}`);
    console.log(`→ ${file} (crops in ${shots})`);
  };
  const compose = (u, shots, records) => composeDoc({ url: u, shots, hide, repeat, bar, probe, widths, records, at });
  const explored = (side) => tasks.map((t, i) => (t.side === side ? { at, result: results[i] } : null)).filter(Boolean);
  if (!build) {
    const doc = compose(url, shotsDir, explored('single'));
    write(out, doc); report(doc, out, shotsDir, '');
    return;
  }
  let srcDoc = null;
  if (!buildOnly) {
    for (const s of source) for (const f of cropsOf(s.entry.result)) copyFileSync(join(s.entry.crops, f), join(shotsDir, f));
    srcDoc = compose(url, shotsDir, source.map((s) => ({ at: s.entry.at, result: s.entry.result })));
    write(out, srcDoc);
  }
  const buildDoc = compose(build.url, buildShots, explored('build'));
  write(build.out, buildDoc);
  for (const s of source) console.log(s.hit ? `chrome-explore source ${s.width}: cached ${s.file} (explored ${s.entry.at}) — --fresh re-explores` : `chrome-explore source ${s.width}: explored → ${s.file}`);
  if (srcDoc) report(srcDoc, out, shotsDir, 'source ');
  report(buildDoc, build.out, buildShots, 'build ');
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
if (process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === self; } catch { return false; } })()) main().catch((e) => { console.error(`chrome-explore: ${e.message}`); process.exit(1); });
