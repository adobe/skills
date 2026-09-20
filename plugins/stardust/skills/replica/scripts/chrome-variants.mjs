#!/usr/bin/env node
/**
 * skills/replica/scripts/chrome-variants.mjs — chrome VARIANT inventory before fan-out
 *
 * Offline. Reads the captured page records (`stardust/current/pages/*.json`,
 * the `chrome` field crawl.mjs records: header / footer landmark class sets,
 * nav-row count, body classes, linked stylesheet paths), derives one static
 * fingerprint per page at ZERO live hits, buckets the inventory by it, names
 * each bucket (persisted names are never renumbered) and writes
 * `state.json.pages[].chromeVariant` (--write). With --progress it is the
 * GATE: every variant needs a chrome archetype row in
 * `stardust/replica/progress.json.chrome.variants[]` whose every state is
 * `gated` | `dead` | `unprobed:<reason>` — a variant without that row, a
 * row with an unknown state word, or a `gated` word without its evidence
 * (`gates.<bp>` for every configured breakpoint: an existing chrome-states
 * artefact — a COMPARED `chrome-states.json` (`schema: 1`, `build` set, ≥ 1 cell, no
 * `delta` / `missing` cell), or its directory; paths
 * relative to progress.json's directory) blocks fan-out of its pages (exit 2).
 * A typed word is not a crop: the lint re-reads the artefact, like
 * gate-ledger-lint re-reads the numbers.
 *
 * Why (field record, five migrations): a second header/footer variant
 * (another CSS bundle, another template's chrome, a persistent subnav band)
 * surfaced AFTER fan-out — dozens of pages shipped with the wrong chrome or
 * were compensated page-locally. The variant is derivable from the capture
 * before the first archetype is authored; the live probe (chrome-states.mjs
 * --from-state, one navigation per bucket sample) merges buckets that render
 * identically — never one hit per page.
 *
 * Usage:
 *   node skills/replica/scripts/chrome-variants.mjs [options]
 *     --pages <dir>       captured page records         (default stardust/current/pages)
 *     --state <file>      state.json to read names from / write to (default stardust/state.json)
 *     --write             write pages[].chromeVariant into --state (merge by slug)
 *     --progress <file>   gate mode: require a chrome archetype row per variant
 *                         (default off; use stardust/replica/progress.json)
 *     --json              machine-readable inventory on stdout
 *     --help
 *
 * Exit codes:
 *   0  inventory printed (and written with --write); with --progress every variant has a valid row
 *   2  --progress: at least one variant without a row, a row with a state outside
 *      gated | dead | unprobed:<reason>, or a `gated` row whose gates.<bp> artefact is
 *      missing / unreadable at any configured breakpoint — fan-out of that bucket is blocked
 *   1  error (no page records, unreadable state/progress JSON, unknown flag)
 *
 * Pages captured before the `chrome` field existed land in the `unfingerprinted`
 * bucket with a printed hint (re-run extract on one page per type); they never
 * silently join `default`. Contract and the progress.json `chrome` shape:
 * `../reference/chrome-states.md` § Chrome variants.
 */
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import { existsSync, readdirSync, readFileSync, writeFileSync, realpathSync, statSync } from 'fs';
import { join, basename, dirname, resolve as resolvePath } from 'path';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';

export const STATE_CLASS_RE = /^(is-|has-|js-|active$|open$|opened$|expanded$|sticky|scrolled|fixed$|pinned|shrink|collapsed|hover|focus|loaded|ready|no-js|js$)/i;
export const STATE_WORDS = /^(gated|dead|unprobed:.+)$/;

const HELP = `chrome-variants — bucket the inventory by chrome fingerprint; gate fan-out on a chrome archetype row per variant

Usage: node chrome-variants.mjs [--pages <dir>] [--state <file>] [--write] [--progress <file>] [--json]
  --pages <dir>      captured page records (default stardust/current/pages)
  --state <file>     state.json — persisted variant names are read from it; --write stores pages[].chromeVariant
  --write            write pages[].chromeVariant into --state (merge by slug; names never renumbered)
  --progress <file>  GATE: every variant needs progress.json.chrome.variants[] row with states gated | dead | unprobed:<reason>
                     and, for a gated row, gates.<bp> artefacts that exist for every breakpointsConfigured (default 1440, 360)
  --json             inventory as JSON
  --help             this text

Exit codes: 0 ok, 2 a variant has no valid chrome archetype row (--progress; fan-out blocked), 1 error.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { pages: 'stardust/current/pages', state: 'stardust/state.json', write: false, progress: null, json: false };
  const need = (flag, i) => { if (rest[i] === undefined || rest[i].startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return rest[i]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--pages') opts.pages = need(a, ++i);
    else if (a === '--state') opts.state = need(a, ++i);
    else if (a === '--write') opts.write = true;
    else if (a === '--progress') opts.progress = need(a, ++i);
    else if (a === '--json') opts.json = true;
    else { console.error(`unknown argument ${a}\n\n${HELP}`); process.exit(1); }
  }
  for (const k of ['pages', 'state']) if (!opts[k]) { console.error(`--${k} needs a value\n\n${HELP}`); process.exit(1); }
  return opts;
}

// ------------------------------------------------------------ pure halves

const normPath = (p) => String(p || '').replace(/\?.*$/, '').replace(/[0-9a-f]{8,}/gi, '{hash}').replace(/\d+\.\d+(\.\d+)?/g, '{v}');
const classes = (lm) => (lm && Array.isArray(lm.classes) ? lm.classes.filter((c) => !STATE_CLASS_RE.test(c)).sort() : []);

/** Static fingerprint of one captured page record, or null when the record predates the `chrome` field. */
export function fingerprintOf(page) {
  const c = page && page.chrome;
  if (!c || typeof c !== 'object') return null;
  const parts = { header: classes(c.header), footer: classes(c.footer), navRows: Number(c.navRows) || 0, stylesheets: [...new Set((c.stylesheets || []).map(normPath))].sort() };
  const key = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
  return { key, parts };
}

const isHome = (p) => { if (p.slug === 'index' || p.slug === 'home') return true; try { return new URL(p.url).pathname.replace(/\/+$/, '') === ''; } catch { return false; } };

/**
 * Bucket pages by fingerprint key. `existing` maps slug → persisted variant
 * name (from state.json): a bucket that already has a name keeps it —
 * never renumbered. Otherwise the home bucket (else the largest) is
 * `default`, the rest `variant-<key4>`. Records without a fingerprint
 * form `unfingerprinted`.
 */
export function bucketPages(pages, existing = {}) {
  const map = new Map();
  for (const p of pages) {
    const fp = fingerprintOf(p);
    const key = fp ? fp.key : 'unfingerprinted';
    if (!map.has(key)) map.set(key, { key, fingerprint: fp ? fp.parts : null, pages: [], name: null });
    map.get(key).pages.push({ slug: p.slug, url: p.url, type: p.type || null, bodyClasses: (p.chrome && p.chrome.bodyClasses) || [] });
  }
  const buckets = [...map.values()].sort((a, b) => b.pages.length - a.pages.length);
  for (const b of buckets) {
    if (b.key === 'unfingerprinted') { b.name = 'unfingerprinted'; continue; }
    const names = [...new Set(b.pages.map((p) => existing[p.slug]).filter(Boolean))];
    if (names.length) { b.name = names[0]; if (names.length > 1) b.renamed = names.slice(1); }
  }
  const taken = new Set(buckets.map((b) => b.name).filter(Boolean));
  // `default` = the home bucket (else the largest) — only while it has no persisted name
  const homeB = buckets.find((b) => b.key !== 'unfingerprinted' && b.pages.some(isHome)) || buckets.find((b) => b.key !== 'unfingerprinted');
  if (homeB && !homeB.name && !taken.has('default')) { homeB.name = 'default'; taken.add('default'); }
  for (const b of buckets) if (!b.name) { let n = `variant-${b.key.slice(0, 4)}`; while (taken.has(n)) n = `${n}x`; b.name = n; taken.add(n); }
  // marker candidates: body classes every page of the bucket carries and no page outside it does
  for (const b of buckets) {
    const inside = b.pages.map((p) => new Set(p.bodyClasses));
    const outside = new Set(buckets.filter((o) => o !== b).flatMap((o) => o.pages.flatMap((p) => p.bodyClasses)));
    b.markerCandidates = inside.length ? [...inside[0]].filter((c) => inside.every((s) => s.has(c)) && !outside.has(c) && !STATE_CLASS_RE.test(c)).slice(0, 6) : [];
  }
  return buckets;
}

/** Why a gates.<bp> artefact is NOT gated evidence (null = it is): chrome-states.json (or the directory holding it) must
 *  exist, parse, be a chrome-states report (`schema: 1` + `cells[]` — `{}` / `[]` was accepted once), AND be a compared
 *  gate: `build` set (a live-only inventory has `build: null` and compares nothing), ≥ 1 cell, and no cell left at
 *  `delta` / `missing` (that report says the chrome is NOT gated — chrome-states.mjs exits 2 on it). */
export function gateArtefactWhy(path, root) {
  if (!path || typeof path !== 'string') return 'no path';
  let file = resolvePath(root || '.', path);
  try { if (statSync(file).isDirectory()) file = join(file, 'chrome-states.json'); } catch { return 'missing'; }
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return 'missing or unreadable'; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.schema !== 1 || !Array.isArray(j.cells)) return 'not a chrome-states report (schema 1 with cells[])';
  if (!j.build) return 'live-only inventory (build: null) — nothing was compared';
  if (!j.cells.length) return 'no cells — nothing was compared';
  const open = j.cells.filter((c) => c && (c.status === 'delta' || c.status === 'missing')).length;
  if (open) return `${open} cell(s) still delta/missing — that report is a FAIL, not a gated chrome`;
  return null;
}
/** Boolean form of gateArtefactWhy. */
export function gateArtefactOk(path, root) { return gateArtefactWhy(path, root) === null; }

/**
 * Gate check against progress.json.chrome.variants[]. Returns
 * { ok, blocked: [{ name, reason }] }. A variant is blocked when no row
 * carries its name (or key), when the row has no `states`, when a state's
 * value is outside gated | dead | unprobed:<reason>, or when a row with a
 * `gated` state has no readable gates.<bp> artefact for every configured
 * breakpoint (`progress.breakpointsConfigured`, default 1440 + 360; paths
 * resolve against `root` = progress.json's directory). `unfingerprinted` is
 * blocked too — an unknown chrome is not a gated chrome.
 */
export function checkProgress(buckets, progress, { root = '.' } = {}) {
  const rows = (progress && progress.chrome && Array.isArray(progress.chrome.variants)) ? progress.chrome.variants : [];
  const bps = (Array.isArray(progress && progress.breakpointsConfigured) && progress.breakpointsConfigured.length ? progress.breakpointsConfigured : [1440, 360]).map(String);
  const blocked = [];
  for (const b of buckets) {
    if (b.key === 'unfingerprinted') { blocked.push({ name: b.name, reason: `${b.pages.length} page record(s) without a chrome fingerprint — re-run extract on one page per type` }); continue; }
    const row = rows.find((r) => r && (r.name === b.name || r.key === b.key));
    if (!row) { blocked.push({ name: b.name, reason: 'no chrome archetype row in progress.json.chrome.variants[]' }); continue; }
    const states = row.states && typeof row.states === 'object' ? Object.entries(row.states) : [];
    if (!states.length) { blocked.push({ name: b.name, reason: 'row has no states{} — the matrix was not recorded' }); continue; }
    const bad = states.filter(([, v]) => !STATE_WORDS.test(String(v)));
    if (bad.length) { blocked.push({ name: b.name, reason: `state(s) outside gated | dead | unprobed:<reason>: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}` }); continue; }
    if (!states.some(([k]) => k === 'rest')) { blocked.push({ name: b.name, reason: 'no `rest` state in the row (the resting crop is item 5)' }); continue; }
    // a `gated` word needs its evidence at every configured breakpoint — the artefact, not the typed word, is the crop
    if (states.some(([, v]) => v === 'gated')) {
      const missing = bps.map((bp) => [bp, gateArtefactWhy(row.gates && row.gates[bp], root)]).filter(([, why]) => why);
      if (missing.length) blocked.push({ name: b.name, reason: `state(s) marked gated without evidence: gates.${missing.map(([bp, why]) => `${bp} ${why}`).join(' / gates.')} — run chrome-states.mjs <live> <proto> at that width until every cell passes and record the artefact path` });
    }
  }
  return { ok: blocked.length === 0, blocked };
}

// -------------------------------------------------------------------- main

function readJson(file, what) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`chrome-variants error: ${what} ${file} unreadable (${e.message})`); process.exit(1); }
}

function main() {
  const opts = parseArgs(process.argv);
  if (!existsSync(opts.pages)) { console.error(`chrome-variants error: no page records at ${opts.pages} (run extract --prep first)`); process.exit(1); }
  const files = readdirSync(opts.pages).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort(); // sorted: bucket order, `default` election and names never depend on the directory listing
  if (!files.length) { console.error(`chrome-variants error: ${opts.pages} holds no page records`); process.exit(1); }
  const pages = files.map((f) => { const j = readJson(join(opts.pages, f), 'page record'); return { slug: j.slug || basename(f, '.json'), url: j.url || j.finalUrl || null, type: j.type || null, chrome: j.chrome }; });
  const state = existsSync(opts.state) ? readJson(opts.state, 'state') : null;
  const statePages = (state && Array.isArray(state.pages)) ? state.pages : [];
  const existing = Object.fromEntries(statePages.filter((p) => p.chromeVariant).map((p) => [p.slug, p.chromeVariant]));
  for (const p of pages) { const sp = statePages.find((x) => x.slug === p.slug); if (sp && sp.type && !p.type) p.type = sp.type; }
  const buckets = bucketPages(pages, existing);
  const gate = opts.progress ? checkProgress(buckets, readJson(opts.progress, 'progress'), { root: dirname(opts.progress) }) : null;

  if (opts.write && state) {
    const bySlug = new Map(buckets.flatMap((b) => b.pages.map((p) => [p.slug, b.name])));
    let n = 0;
    for (const sp of statePages) { const name = bySlug.get(sp.slug); if (name && name !== 'unfingerprinted' && sp.chromeVariant !== name) { sp.chromeVariant = name; n += 1; } }
    writeFileSync(opts.state, `${JSON.stringify(state, null, 2)}\n`);
    console.error(`chrome-variants: wrote chromeVariant on ${n} page(s) in ${opts.state}`);
  } else if (opts.write) console.error(`chrome-variants: --write given but ${opts.state} does not exist — nothing written`);

  const report = { schema: 1, pages: pages.length, variants: buckets.map((b) => ({ name: b.name, key: b.key, pages: b.pages.length, types: [...new Set(b.pages.map((p) => p.type).filter(Boolean))], sample: b.pages.slice(0, 3).map((p) => p.slug), fingerprint: b.fingerprint, markerCandidates: b.markerCandidates, renamed: b.renamed || null })), gate };
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`chrome-variants: ${pages.length} page record(s) → ${buckets.filter((b) => b.key !== 'unfingerprinted').length} chrome variant(s)${buckets.some((b) => b.key === 'unfingerprinted') ? ' + unfingerprinted' : ''}`);
    for (const b of buckets) {
      const fp = b.fingerprint;
      console.log(`\n■ ${b.name} — ${b.pages.length} page(s)${b.pages.some((p) => p.type) ? ` [${[...new Set(b.pages.map((p) => p.type).filter(Boolean))].join(', ')}]` : ''}: ${b.pages.slice(0, 4).map((p) => p.slug).join(', ')}${b.pages.length > 4 ? ', …' : ''}`);
      if (fp) console.log(`  header .${fp.header.join('.') || '(no classes)'} · footer .${fp.footer.join('.') || '(no classes)'} · nav rows ${fp.navRows} · ${fp.stylesheets.length} stylesheet(s)`);
      else console.log('  no chrome fingerprint in these records (captured before the field existed) — re-run extract on one page per type');
      if (b.markerCandidates && b.markerCandidates.length) console.log(`  marker candidates (body classes only these pages carry): ${b.markerCandidates.join(' ')}`);
      if (b.renamed) console.log(`  WARN persisted names merged into one bucket: ${[b.name, ...b.renamed].join(', ')} — keep ${b.name}, never renumber`);
      const sample = b.pages.find((p) => p.url);
      if (fp && sample) console.log(`  probe once: node stardust/scripts/replica/chrome-states.mjs "${sample.url}" --live-cache stardust/replica/gates/${sample.slug}-1440/chrome-live-states.json`);
    }
    if (buckets.filter((b) => b.key !== 'unfingerprinted').length > 1) console.log('\nmore than one chrome variant: the `chrome-variant` decision row opens BEFORE fan-out of the second bucket (default: variant as a template body class or a nav:/footer: document — never page-local CSS); each variant needs its own chrome archetype row (reference/chrome-states.md § Chrome variants).');
    if (gate) {
      if (gate.ok) console.log('\n✓ every chrome variant has a chrome archetype row with named states — fan-out may proceed.');
      else { console.log(`\n✗ ${gate.blocked.length} variant(s) without a gated chrome archetype row — fan-out of their pages is BLOCKED:`); for (const b of gate.blocked) console.log(`  ${b.name}: ${b.reason}`); }
    }
  }
  process.exit(gate && !gate.ok ? 2 : 0);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main();
