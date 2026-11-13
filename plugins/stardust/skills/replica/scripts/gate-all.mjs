#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/replica/scripts/gate-all.mjs — the published-origin gate over EVERY deployed page (#125, D0).
 *
 * THE RULE (#125): every crafted prototype and every deployed page is a row in a pixel table —
 * `<out>/summary.{json,md}` at `stardust/replica/gates/prototypes-<w>/` (--stage prototype: pages with
 * a prototypePath, build = the served prototype, origin = the archetype round's cached live.png when
 * present) and `stardust/replica/gates/all-<w>/` (--stage published, default: `deployed` pages, build =
 * liveUrl). gate-evidence.mjs reads these tables as the source of record; a page without a row is ungated.
 * PAGES (published stage, `selectPages`): the state.json rows with status `deployed` + liveUrl + url (a hand-written
 * roster), MERGED with the rollout ledger's delivered rows (--coverage, stardust/rollout/coverage/pages.json:
 * delivery.status deployed | verified, or failed with a `gate: ` error — update-coverage's own flip, which must stay
 * gateable to flip back) that the state rows do not already name. Merged, not a fallback: a partial roster must not
 * hide a delivered page — a page is ungated only when neither source names it. A ledger row takes its source URL from
 * the state row of its slug (else source.sourceUrl) and its build URL from delivery.deployedUrl (else --eds-host, or
 * the delivered rows' commonest deployed origin, + path); one with neither is listed as skipped, never guessed.
 *
 * Per page: stitched captures of both sides (stitch-shot, --settle), pixel-compare, then the DOM probes
 * — clip-probe on the served side (D1, both stages), content-presence (D2, published stage; the
 * prototype is authored from the same capture content-diff already reconciles) and unit-geometry (D3)
 * for the repeated-unit families stardust/replica/units.json declares for the page. Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + clip.json [+ content.json, units.json],
 * <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead. A page that passes keeps its
 * records, not its PNGs (#156, disk): every PNG in its dir is deleted, pixel.json notes the drop with the masks and
 * eds URL it was measured with, and a --skip-existing / --compare-only run reuses that pass while both hold. Pages go
 * through in batches of BATCH, so a passed batch's PNGs are gone before the next is captured; a page captured again
 * loses its recorded pass first, and a missing capture is written to pixel.json — a failed or interrupted re-capture
 * never leaves the old pass to be reused.
 *
 * VERDICT (all four): pixel % ≤ --threshold AND |Δh| ≤ --height-tol × origin height (a union metric
 * was tried and rejected — white gaps score as matches) AND served clipped ≤ --clip-max +
 * clip-allow.json allowance AND content MISSING + HIDDEN links / headings = 0 (n/a when the origin
 * could not be probed — never a fail) [+ required units within --unit-tol]. The pixel-only verdict is
 * recorded beside it per page and in the totals — every run is calibration data.
 * FONTS (source-fidelity-gate.md § Hardening rule 14): every stitch writes its capture record
 * (<slug>/<side>.capture.json beside the PNG) and the origin / eds meta carries its `fontsFailed` —
 * the dead faces (a declared face with no loaded face of its family, weight and style: a file that failed to
 * fetch, or a local() source the browser cannot resolve), [] when every face loaded, null when the check could
 * not run (`fontCheck` says why; no readable record reads the same — an older stitch-shot copy; a reused archetype
 * live.png carries its live.capture.json, or the frozen baseline's record after a flagged round, and one with
 * neither is retaken, staleCapture). The row carries every dead face with its side — `fontsNotLoaded`
 * [{ family, side: 'origin' | 'eds' | 'both' }], sorted. A face that loads on the source and is dead on the build
 * fails the row — one `font-not-loaded:<family>` reason each; a face dead on the source (alone or on both sides) is
 * what the source site serves: REPORTED (`notes`: `font-dead-on-source:<family>` / `font-dead-on-both:<family>`, and
 * the calibration line), never a fail. A side whose check could not run fails the row —
 * `font-check-skipped:<origin|build>` (`fontChecksSkipped`): a check that could not run is never a
 * pass. Explicit null only: a meta from before the check (no key, --skip-existing) is not flagged — recapture
 * to check. totals.fontsNotLoaded (rows failing on a face) / fontsDeadOnSource (rows reporting one) /
 * fontChecksSkipped count the rows; the calibration line names the faces with their side.
 * PROBE ERRORS: a probe that errored or timed out (as opposed to one that does not apply — origin not probed, no
 * units declared) never leaves a pass: the row carries `probeErrors` [{ probe, error }], one `probe-error:<probe>`
 * reason each, and counts in totals.error (and totals.probeErrors), not totals.fail. Each page's probe results are
 * recorded in <slug>/probes.json; --compare-only re-reads them (no browser, no probe) and re-applies the sidecars.
 * A capture is removed before it is retaken, so a failed capture is an error row with no percentage — never a diff
 * of the previous PNG.
 *
 * Sidecars in <out>/, each entry documented: masks.json (printed on the verdict), overrides.json
 * (shown BESIDE the number, never replacing it), clip-allow.json, presence.json (session-variable
 * regions); repeated units come from stardust/replica/units.json (unit-geometry.mjs header; a legacy
 * <out>/units.json per page still reads). Origin fallback: live stitch → <crawl-shots>/<slug>.png
 * (`crawl-fullpage`, asymmetric, flagged). A cached live.png or a
 * --skip-existing capture is reused only when its capture record has fixedLayers (gate.sh's rule; staleCapture).
 * Overlays and locale (gate.sh's flags, same spelling): --consent / --dismiss / --no-dismiss / --locale reach both
 * captures and every probe that takes them (CHILD_FLAGS — the three probes take --locale only today).
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--stage published|prototype] [--proto-base <url>]
 *        [--state f] [--coverage f] [--out dir] [--width 1440] [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--eds-host <h>]
 *        [--consent <sel>] [--dismiss <sel,…>] [--no-dismiss] [--locale en-US]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--threshold 10] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>]
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs and
 * pixel-compare.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (overrides count), 2 any FAIL or error row, 1 error. `verdict`, `selectPages`, `fontsNotLoaded`, `fontFails`,
 * `fontChecksSkipped`, `shotFonts`, `formatSummary`, `parseArgs`, `passThrough`, `stitchArgs`, `contentArgs`,
 * `clipArgs`, `unitArgs`, `recordedProbes`, `captureRecordOf`, `staleCapture`, `dropPassedCaptures`, `droppedPass`
 * are exported.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pages go through in batches, so a passed batch's PNGs are gone before the next batch is captured (peak disk).
export const BATCH = 25;

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --stage published|prototype  published (default): deployed pages vs liveUrl → gates/all-<w>/;
                            prototype: pages with a prototypePath vs the served prototype → gates/prototypes-<w>/
  --proto-base <url>        where the prototypes dir is served (prototype stage), e.g. http://localhost:8791
  --state <file>            stardust/state.json — rows with status deployed + liveUrl + url
  --coverage <file>         stardust/rollout/coverage/pages.json — its delivered rows (deployed | verified | failed on
                            a gate) are merged in: a page is ungated only when neither file names it
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched)
  --skip-existing           reuse captures in the page dir (a stitch with no fixedLayers in its capture record —
                            taken before fixed layers were captured once — is retaken, as is such a cached live.png),
                            and a passed page's recorded pass while its masks and eds URL are unchanged
  --recapture-eds           (with --skip-existing) re-shoot eds.png only
  --recapture-origin        re-shoot origin.png (the previous one is removed first: a failed re-shoot is an error row)
  --eds-host <host>         gate a code branch host against the same content
  --consent <sel>           site-specific consent-accept selector — both captures
  --dismiss <sel,…>         extra overlay-dismiss selectors — both captures
  --no-dismiss              dismiss no overlay (contradicts --consent / --dismiss: exit 1)
  --locale <tag>            en-US — both captures and every probe
  --blocked <regex>         origins the edge denies → crawl shot unless --try-blocked
  --try-blocked             attempt the live stitch on --blocked origins too
  --crawl-shots <dir>       stardust/current/assets/screenshots (fallback origin PNGs)
  --origin-concurrency <n>  2      --eds-concurrency <n>  4      --probe-concurrency <n>  2
  --threshold <pct>         10     --height-tol <frac>    0.05   --clip-max <n>  0   --unit-tol <px>  4
  --no-clip | --no-content | --no-probes   drop criteria 3 / 4 / both (pixel-only verdict)
  --units <file>            repeated-unit declarations (default <out>/units.json)
  --compare-only            no captures, no probes, no browser: pixel-compare over the existing PNGs (a passed page:
                            its recorded pass), the recorded probe results (<slug>/probes.json), the sidecars
  --warmup <url>            origin warm-up for the probes
  --vh <px>                 stitch chunk height
  --help                    this text
Verdict = pixel % ≤ threshold AND |Δh| ≤ height-tol × origin height AND clipped ≤ clip-max(+allowance) AND content MISSING+HIDDEN = 0.
  A font face that loads on the source and is dead on the build (the capture records' fontsFailed,
  <slug>/<side>.capture.json) fails the row: font-not-loaded:<family>; one dead on the source is reported, not failed;
  a font check that could not run (fontsFailed null, or no record) fails it: font-check-skipped:<origin|build>.
  A probe that errored or timed out is an error row (probe-error:<probe>), never a pass and not a FAIL.
Sidecars in <out>/: masks.json, overrides.json, clip-allow.json, presence.json, units.json (see the header).
A page that passes keeps its records, not its PNGs (#156): --recapture-eds / --recapture-origin, or a run
without --skip-existing, shoots it again. Pages go through in batches of ${BATCH}: a passed batch's PNGs are deleted
before the next batch is captured.
Exit: 0 all PASS (overrides count), 2 any FAIL or error row, 1 error.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { stage: 'published', protoBase: null, state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null, coverage: 'stardust/rollout/coverage/pages.json', consent: null, dismiss: null, noDismiss: false, locale: 'en-US' };
  const need = (flag, val) => { if (val == null || val.startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return val; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = () => rest[++i];
    if (a === '--stage') { o.stage = v(); if (!['published', 'prototype'].includes(o.stage)) { console.error(`--stage must be published or prototype\n\n${HELP}`); process.exit(1); } }
    else if (a === '--proto-base') o.protoBase = v().replace(/\/$/, '');
    else if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') o.width = Number(v());
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') o.edsHost = v().replace(/\/$/, ''); else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-concurrency') o.oc = Number(v()); else if (a === '--eds-concurrency') o.ec = Number(v()); else if (a === '--probe-concurrency') o.pc = Number(v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a === '--coverage') o.coverage = need(a, v());
    else if (a === '--consent') o.consent = need(a, v()); else if (a === '--dismiss') o.dismiss = need(a, v()); else if (a === '--no-dismiss') o.noDismiss = true; else if (a === '--locale') o.locale = need(a, v());
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (o.noDismiss && (o.consent || o.dismiss)) { console.error('gate-all: --no-dismiss contradicts --consent / --dismiss — drop one (see --help)'); process.exit(1); }
  if (o.stage === 'prototype' && o.content) o.content = false; // content-diff already reconciles the prototype's text
  if (!o.out) o.out = `stardust/replica/gates/${o.stage === 'prototype' ? 'prototypes' : 'all'}-${o.width}`;
  return o;
}

// ---- pure: the font check of a capture ----------------------------------------------------------------
/**
 * shotFonts(record, { missing }) → the font check of a stitch-shot capture record for the side's meta: { fontsFailed }
 * (checked — the dead faces, [] when every face loaded) or { fontsFailed: null, fontCheck } — null when the record says
 * so (its check could not run), when it predates the check (no fontsFailed key) or when there is no readable record at
 * all (`missing` names why; default: an older stitch-shot copy). Unchecked is never "all loaded".
 */
export function shotFonts(record, { missing = 'no readable capture record (stitch-shot wrote no capture record — re-copy stitch-shot.mjs)' } = {}) {
  if (!record || typeof record !== 'object') return { fontsFailed: null, fontCheck: `failed: ${missing}` };
  if (Array.isArray(record.fontsFailed)) return { fontsFailed: record.fontsFailed.filter((f) => typeof f === 'string' && f) };
  if (!('fontsFailed' in record)) return { fontsFailed: null, fontCheck: 'failed: the capture record predates the font check — re-copy stitch-shot.mjs' };
  return { fontsFailed: null, fontCheck: typeof record.fontCheck === 'string' ? record.fontCheck : 'failed: the check could not run' };
}
/**
 * fontsNotLoaded(originMeta, edsMeta) → the dead faces of the two sides (the metas' `fontsFailed`) with the side each
 * is dead on: [{ family, side: 'origin' | 'eds' | 'both' }], sorted by family, one entry per family (compared
 * case-insensitively, quotes dropped; the build side's spelling is kept when both name it).
 */
const familyKey = (f) => f.trim().replace(/^["']+|["']+$/g, '').toLowerCase();
export function fontsNotLoaded(originMeta, edsMeta) {
  const list = (m) => (m && Array.isArray(m.fontsFailed) ? m.fontsFailed : []).filter((f) => typeof f === 'string' && f.trim());
  const faces = new Map();
  for (const f of list(originMeta)) faces.set(familyKey(f), { family: f, side: 'origin' });
  for (const f of list(edsMeta)) faces.set(familyKey(f), { family: f, side: faces.has(familyKey(f)) ? 'both' : 'eds' });
  return [...faces.values()].sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
}
/**
 * The font rule: a face dead on the source (side 'origin' or 'both') is what the source serves — reported, never a
 * fail; any other dead face fails the row (side 'eds'; a bare family string — a row or caller from before the side
 * was recorded — has no known side and fails as it did).
 */
export const fontFamily = (f) => (typeof f === 'string' ? f : f.family);
export const fontFails = (f) => typeof f === 'string' || (f.side !== 'origin' && f.side !== 'both');
const fontLabel = (f) => (typeof f === 'string' ? f : `${f.family} [${f.side}]`);
/**
 * fontChecksSkipped(originMeta, edsMeta) → the sides ('origin', then 'build' for the EDS side) whose stitch-live meta
 * says `fontsFailed: null` — the font check could not run, so no face is known to have loaded. Explicit null only: an
 * absent key is a meta from before the check and adds nothing; another instrument (a crawl shot) has no check.
 */
export function fontChecksSkipped(originMeta, edsMeta) {
  return [['origin', originMeta], ['build', edsMeta]].filter(([, m]) => m && m.instrument === 'stitch-live' && m.fontsFailed === null).map(([side]) => side);
}

// ---- pure: which pages the gate measures ------------------------------------------------------------------
// The rollout ledger's delivered states (update-coverage.mjs PAGE_STATUSES; lib.mjs pageCounts counts these two as
// delivered). `failed` with a `gate: ` error is update-coverage --gate's own flip of a deployed page: still served,
// and it must stay in the table for a later pass to flip it back.
export const DELIVERED = ['deployed', 'verified'];
const isDelivered = (d) => !!d && (DELIVERED.includes(d.status) || (d.status === 'failed' && /^gate: /.test(d.error || '')));
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
/**
 * selectPages({ state, coverage, stage, protoBase, edsHost, only }) → { pages, skipped, from: { state, coverage } }.
 * Prototype stage: the state rows with a prototypePath (liveUrl = the served prototype). Published stage: the state
 * rows with status `deployed` + liveUrl + url, then every delivered ledger row (`coverage` = the parsed
 * coverage/pages.json, or its `pages` array) those do not name — merged (header § PAGES). A ledger row becomes
 * { ...its state row, slug, url, liveUrl, deployedPath, template }: url = the state row's, else source.sourceUrl;
 * liveUrl = delivery.deployedUrl, else `edsHost` + path, else the delivered rows' commonest deployed origin + path.
 * A delivered row that has no source URL (a page built outside the migrated tree — update-coverage --new — has no
 * source page: `noSourcePage`) or no build URL is returned in `skipped` [{ slug, why }], never guessed.
 * `only` filters both lists. No I/O.
 */
export function selectPages({ state = null, coverage = null, stage = 'published', protoBase = null, edsHost = null, only = null } = {}) {
  const statePages = (state && Array.isArray(state.pages) ? state.pages : []).filter((p) => p && typeof p === 'object');
  const keep = (p) => !only || only.includes(p.slug);
  if (stage === 'prototype') {
    const pages = statePages.filter((p) => p.prototypePath && p.url).map((p) => ({ ...p, liveUrl: `${protoBase || 'http://localhost:8791'}/${basename(p.prototypePath)}` })).filter(keep);
    return { pages, skipped: [], from: { state: pages.length, coverage: 0 } };
  }
  const fromState = statePages.filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  const named = new Set(fromState.map((p) => p.slug));
  const bySlug = new Map(statePages.map((p) => [p.slug, p]));
  const covRows = (Array.isArray(coverage) ? coverage : (coverage && Array.isArray(coverage.pages) ? coverage.pages : [])).filter((r) => r && r.slug && isDelivered(r.delivery));
  const tally = new Map();
  for (const r of covRows) { const o = originOf(r.delivery.deployedUrl); if (o) tally.set(o, (tally.get(o) || 0) + 1); }
  const base = (edsHost || [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o)[0] || '').replace(/\/$/, '') || null;
  const fromCoverage = []; const skipped = [];
  for (const r of covRows) {
    if (named.has(r.slug)) continue;
    named.add(r.slug);
    const st = bySlug.get(r.slug) || {};
    const url = st.url || (r.source && r.source.sourceUrl) || null;
    const path = typeof r.path === 'string' && r.path.startsWith('/') ? r.path : null;
    const liveUrl = r.delivery.deployedUrl || (base && path ? `${base}${path}` : null);
    const built = r.source && typeof r.source.migratedHtml === 'string' && /^[a-z][a-z0-9-]*:[^/]+$/.test(r.source.migratedHtml); // update-coverage --new's origin marker
    if (!url) skipped.push({ slug: r.slug, noSourcePage: !!built, why: built ? `built outside the migrated tree (${r.source.migratedHtml}) — no source page to compare it with` : 'delivered in the rollout ledger, but no source URL (no state.json row with a url, no source.sourceUrl)' });
    else if (!liveUrl) skipped.push({ slug: r.slug, why: 'delivered in the rollout ledger, but no build URL (no delivery.deployedUrl, and no --eds-host or sibling deployed origin to join its path to)' });
    else fromCoverage.push({ ...st, slug: r.slug, url, liveUrl, deployedPath: st.deployedPath || path || undefined, template: st.template ?? r.templateId });
  }
  return { pages: [...fromState, ...fromCoverage].filter(keep), skipped: skipped.filter(keep), from: { state: fromState.filter(keep).length, coverage: fromCoverage.filter(keep).length } };
}

// ---- pure: the child command lines ------------------------------------------------------------------------
// The overlay / locale flags each child accepts (its own parseArgs) — only those are passed. The three probes take
// --locale and no dismiss flag (they dismiss with the built-in candidates); the test reads each child's source, so a
// probe that gains one fails there until it is listed here.
export const CHILD_FLAGS = { 'stitch-shot': ['--consent', '--dismiss', '--no-dismiss', '--locale'], 'content-presence': ['--consent', '--dismiss', '--no-dismiss', '--locale'], 'clip-probe': ['--consent', '--dismiss', '--no-dismiss', '--locale'], 'unit-geometry': ['--consent', '--dismiss', '--no-dismiss', '--locale'] };
/** passThrough(child, opts) → the --locale / --consent / --dismiss / --no-dismiss arguments `child` accepts. */
export function passThrough(child, opts = {}) {
  const takes = (f) => (CHILD_FLAGS[child] || []).includes(f); const a = [];
  if (takes('--locale')) a.push('--locale', opts.locale || 'en-US');
  if (opts.noDismiss) { if (takes('--no-dismiss')) a.push('--no-dismiss'); return a; }
  if (opts.consent && takes('--consent')) a.push('--consent', opts.consent);
  if (opts.dismiss && takes('--dismiss')) a.push('--dismiss', opts.dismiss);
  return a;
}
/** A capture, either side: stitch-shot <url> <out> --width --settle + the overlay / locale flags [+ --vh] [+ tail]. */
export const stitchArgs = (script, url, out, opts, tail = []) => [script, url, out, '--width', String(opts.width), '--settle', ...passThrough('stitch-shot', opts), ...(opts.vh ? ['--vh', String(opts.vh)] : []), ...tail];
/** content-presence <origin> <eds> --json <file>; `presence` = the page's presence.json entry. */
export function contentArgs(script, originUrl, edsUrl, jsonFile, opts, presence = {}) {
  const args = [script, originUrl, edsUrl, '--width', String(opts.width), '--json', jsonFile, ...passThrough('content-presence', opts)];
  if (presence.variable && presence.variable.length) args.push('--variable', presence.variable.join(','));
  if (presence.main) args.push('--main', presence.main);
  if (opts.warmup) args.push('--warmup', opts.warmup);
  return args;
}
/** clip-probe <eds> --json <file> (the served side). */
export const clipArgs = (script, edsUrl, jsonFile, opts) => [script, edsUrl, '--width', String(opts.width), '--json', jsonFile, ...passThrough('clip-probe', opts)];
/** unit-geometry <origin> <eds> --unit-pair <o> <e>… for the page's declared units (two arguments: a selector may hold `=`). */
export function unitArgs(script, originUrl, edsUrl, jsonFile, slug, units, opts) {
  const args = [script, originUrl, edsUrl, '--width', String(opts.width), '--tol', String(opts.unitTol), '--n', String(Math.max(...units.map((x) => x.n))), '--json', jsonFile, '--slug', slug, ...passThrough('unit-geometry', opts)];
  for (const x of units) args.push('--unit-pair', x.origin, x.eds);
  if (opts.warmup) args.push('--warmup', opts.warmup);
  return args;
}

// ---- pure: the verdict --------------------------------------------------------------------------------
/**
 * verdict({ pixel, clip, content, units, override, allowance, capture }, opts) → row fields. `pixel` = pixel.json,
 * `clip` = { counts } (served side) | { error } | null, `content` = { totals } | { error } (origin not probed: n/a) |
 * { error, probeError: true } | null, `units` = { verdict, required } | { error } | null,
 * `capture` = { fonts: fontsNotLoaded(…), fontsSkipped: fontChecksSkipped(…) } — a face dead on the build alone fails
 * the row with one `font-not-loaded:<family>` reason each, one dead on the source is a `notes` entry (`fontFails`;
 * `fontsNotLoaded` carries both), a side whose font check could not run fails with one `font-check-skipped:<side>`
 * (`fontChecksSkipped`); the pixel-only calibration verdict is unchanged. A probe that errored (clip / units
 * `error`, content `probeError`) is `probeErrors` [{ probe, error }] + one `probe-error:<probe>` reason: not a pass.
 */
export function verdict({ pixel = {}, clip = null, content = null, units = null, override = null, allowance = 0, capture = { fonts: [], fontsSkipped: [] } }, { threshold = 10, heightTol = 0.05, clipMax = 0, clipOn = true, contentOn = true } = {}) {
  const compared = pixel.compared && Number.isFinite(pixel.heightDelta);
  const originH = compared ? pixel.compared.height + Math.max(0, pixel.heightDelta) : null;
  const edsH = compared ? pixel.compared.height + Math.max(0, -pixel.heightDelta) : null;
  const pixelPass = compared && pixel.pct <= threshold;
  const heightPass = compared && Math.abs(pixel.heightDelta) <= heightTol * originH;
  const clipped = clip && clip.counts ? clip.counts.total : null;
  const clipPass = !clipOn ? null : clipped == null ? null : clipped <= clipMax + allowance;
  const cTot = content && content.totals ? content.totals : null;
  const contentPass = !contentOn ? null : cTot ? (cTot.missing + cTot.hidden) === 0 : null;
  const unitPass = units && units.verdict && units.required ? (units.verdict.off + units.verdict.hidden + units.verdict.missing + units.verdict.errors) === 0 : null;
  const reasons = [];
  if (!compared) reasons.push(pixel.error ? `pixel error: ${pixel.error}` : 'missing capture');
  if (compared && !pixelPass) reasons.push(`pixel ${pixel.pct}% > ${threshold}%`);
  if (compared && !heightPass) reasons.push(`Δh ${pixel.heightDelta}px > ${Math.round(heightTol * 100)}% of ${originH}`);
  if (clipPass === false) reasons.push(`clipped ${clipped}${allowance ? ` > allowance ${allowance}` : ''}${clip.counts ? ` (text ${clip.counts.textClipped + clip.counts.textHidden}, controls ${clip.counts.controlHidden + clip.counts.controlClipped})` : ''}`);
  if (contentPass === false) reasons.push(`content MISSING ${cTot.missing} / HIDDEN ${cTot.hidden}${cTot.controlState ? ` (+${cTot.controlState} control state)` : ''}`);
  if (unitPass === false) reasons.push(`units off ${units.verdict.off} hidden ${units.verdict.hidden} missing ${units.verdict.missing}`);
  const probeErrors = [];
  if (contentOn && content && content.probeError) probeErrors.push({ probe: 'content', error: String(content.error || 'no result') });
  if (clipOn && clip && clip.error) probeErrors.push({ probe: 'clip', error: String(clip.error) });
  if (units && units.error) probeErrors.push({ probe: 'units', error: String(units.error) });
  reasons.push(...probeErrors.map((e) => `probe-error:${e.probe}: ${e.error}`));
  const fonts = (capture && capture.fonts) || []; const skipped = (capture && capture.fontsSkipped) || [];
  const fontReasons = [...fonts.filter(fontFails).map((f) => `font-not-loaded:${fontFamily(f)}`), ...skipped.map((side) => `font-check-skipped:${side}`)];
  reasons.push(...fontReasons);
  const notes = fonts.filter((f) => !fontFails(f)).map((f) => `font-dead-on-${f.side === 'both' ? 'both' : 'source'}:${f.family}`);
  const pixelOnlyPass = !!(pixelPass && heightPass);
  const pass = pixelOnlyPass && clipPass !== false && contentPass !== false && unitPass !== false && !fontReasons.length && !probeErrors.length;
  const contentNA = contentOn && !cTot && !(content && content.probeError) ? (content && content.error) || 'not probed' : null;
  return { originH, edsH, pixelPass: !!pixelPass, heightPass: !!heightPass, clipped, clipPass, clipAllowance: allowance, contentPass, contentNA, unitPass, pixelOnlyPass, pass, passWithOverride: pass || !!override, fontsNotLoaded: fonts, fontChecksSkipped: skipped, probeErrors, reasons, notes };
}
// Totals: an error row has no percentage or a probe that errored — never counted as FAIL; a FAIL was fully measured.
export const isErrorRow = (r) => r.pct == null || !!(r.probeErrors && r.probeErrors.length);

const cell = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
export function formatSummary(summary) {
  const t = summary.totals; const p = summary._provenance;
  // the dead faces, named once across the table (the calibration line)
  const faces = summary.rows.flatMap((r) => r.fontsNotLoaded || []);
  const named = (list) => [...new Set(list.map(fontLabel))].sort();
  const fonts = named(faces.filter(fontFails)); const sourceDead = named(faces.filter((f) => !fontFails(f)));
  const head = [`# ${p.stage === 'prototype' ? 'Prototype gate — every crafted prototype' : 'Published-origin gate — all deployed pages'}, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error of ${t.pages}**${t.overridePass ? ` (+${t.overridePass} documented override${t.overridePass > 1 ? 's' : ''} → ${t.passWithOverrides} delivered)` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}${t.fontsNotLoaded ? `, fonts not loaded ${t.fontsNotLoaded}${fonts.length ? ` (${fonts.join(', ')})` : ''}` : ''}${t.fontChecksSkipped ? `, font check skipped ${t.fontChecksSkipped}` : ''}${t.probeErrors ? `; probe errors ${t.probeErrors} (error rows, not FAIL)` : ''}${sourceDead.length ? `; fonts dead on the source — reported, not failing: ${t.fontsDeadOnSource ?? summary.rows.filter((r) => (r.fontsNotLoaded || []).some((f) => !fontFails(f))).length} (${sourceDead.join(', ')})` : ''}; content n/a (origin not probed) ${t.contentNA}${t.degradedTier ? `; **${t.degradedTier} page(s) probed on a degraded browser tier** (Chrome elected, Chromium used — install Chrome for bot-managed origins)` : ''}${t.asymmetricOrigins ? `; ${t.asymmetricOrigins} asymmetric origin(s)` : ''}.`, ''];
  const rows = ['| page | template | tier | origin | browser | pixel % (text %) | Δh px | clipped | content | units | verdict | reasons |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const probeErr = (r.probeErrors || []).map((e) => e.probe);
    const content = probeErr.includes('content') ? 'ERROR' : r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = probeErr.includes('units') ? 'ERROR' : r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}` : '-';
    const fontsOnly = r.pixelOnlyPass && Array.isArray(r.reasons) && r.reasons.length > 0 && r.reasons.every((x) => /^font-(not-loaded|check-skipped):/.test(x));
    const verdictCell = r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : probeErr.length ? `ERROR (probe: ${probeErr.join(', ')})` : fontsOnly ? 'FAIL (fonts)' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${r.browser || '-'} | ${cell(r.pct)}${r.textPct != null ? ` (${r.textPct})` : ''} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? ` → ${r.override.verdict}: ${r.override.reason}` : ''} | ${[...r.reasons, ...(r.notes || []).map((x) => `(reported) ${x}`)].join('; ') || '-'} |`);
  }
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (cands) => cands.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const DIFF_DIR = firstExisting(['../../diff/scripts', '../diff']);
const { unitsFor } = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'unit-geometry.mjs')).href) : { unitsFor: () => [] };
const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const readJsonSafe = (p) => { try { return readJson(p); } catch { return null; } };

// The staleness rule gate.sh applies to a cached live.png, for any stitched capture gate-all would reuse: one taken
// before fixed / sticky layers were captured once has no fixedLayers in its capture record (<stem>.capture.json,
// stitch-shot's sidecar) and repeats a sticky header at every seam — compared with a side captured the new way, an
// asymmetric diff. A live.png copied from the frozen baseline (live.json origin "baseline") has no capture record;
// baseline.json's fixedLayers decides. → true when the capture must be retaken.
export const captureRecordOf = (png) => `${png.replace(/\.png$/i, '')}.capture.json`;
export function staleCapture(png) {
  const rec = readJsonSafe(captureRecordOf(png));
  if (rec) return !rec.fixedLayers;
  const live = basename(png) === 'live.png' ? readJsonSafe(join(dirname(png), 'live.json')) : null;
  if (live && live.origin === 'baseline') return !(readJsonSafe(join(dirname(png), 'baseline.json')) || {}).fixedLayers;
  return true;
}

// Disk (#156): a passed page keeps its records, not its pictures. Every PNG in its dir goes (an extra capture put
// there too); pixel.json records the drop with the masks and eds URL the pass was measured with → PNGs deleted.
export function dropPassedCaptures(d, { masks = [], edsUrl }) {
  const pixel = readJsonSafe(join(d, 'pixel.json'));
  if (!pixel) return 0;
  const pngs = readdirSync(d).filter((f) => f.endsWith('.png'));
  for (const f of pngs) rmSync(join(d, f), { force: true });
  writeFileSync(join(d, 'pixel.json'), JSON.stringify({ ...pixel, capturesDropped: { masks, edsUrl } }, null, 2));
  return pngs.length;
}
// The recorded pass a reuse run (--skip-existing, --compare-only) takes instead of re-capturing: null when nothing
// was dropped, a record is gone, or the masks or eds URL differ from the ones the pass was measured with.
export function droppedPass(d, { masks = [], edsUrl }) {
  const pixel = readJsonSafe(join(d, 'pixel.json'));
  const drop = pixel && pixel.capturesDropped;
  if (!drop || drop.edsUrl !== edsUrl || JSON.stringify(drop.masks) !== JSON.stringify(masks)) return null;
  const origin = readJsonSafe(join(d, 'origin.json')); const eds = readJsonSafe(join(d, 'eds.json'));
  return origin && eds && !origin.error && !eds.error ? { origin, eds, pixel } : null;
}
// Before a page is captured again: a failed or interrupted capture must not leave the old pass to be reused.
function forgetDroppedPass(d) {
  const pixel = readJsonSafe(join(d, 'pixel.json'));
  if (!pixel || !pixel.capturesDropped) return;
  delete pixel.capturesDropped;
  writeFileSync(join(d, 'pixel.json'), JSON.stringify(pixel, null, 2));
}

// A probe's JSON → the result the verdict reads (one mapping for a live probe and for --compare-only).
const contentResult = (content, pr = {}) => ({ totals: content.totals, scope: content.scope, variable: pr.variable || [], reason: pr.reason || null, tier: (content._provenance || {}).tier || null });
const clipOfContent = (content) => ({ counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: content.origin.clip.counts, source: 'content-presence' });
const clipResult = (clip) => ({ counts: clip.counts, groups: clip.groups, source: clip.source || 'clip-probe', tier: clip.tier || null });
/**
 * recordedProbes(d, { presence }) → { content?, clip?, units? } — what the last live run's probes returned for the
 * page dir `d`, errors included: <d>/probes.json (written after every live probe pass). A dir from before that file
 * is read from the probes' own JSON (content.json, clip.json, units.json — results only; an error left none). No
 * browser, no child: what --compare-only gates with.
 */
export function recordedProbes(d, { presence = {} } = {}) {
  const saved = readJsonSafe(join(d, 'probes.json'));
  if (saved && typeof saved === 'object') return { ...(saved.content ? { content: saved.content } : {}), ...(saved.clip ? { clip: saved.clip } : {}), ...(saved.units ? { units: saved.units } : {}) };
  const out = {};
  const content = readJsonSafe(join(d, 'content.json')); const clip = readJsonSafe(join(d, 'clip.json')); const units = readJsonSafe(join(d, 'units.json'));
  if (content && content.totals) { out.content = contentResult(content, presence); if (content.eds && content.eds.clip && content.origin && content.origin.clip) out.clip = clipOfContent(content); }
  if (!out.clip && clip && clip.counts) out.clip = clipResult(clip);
  if (units && units.verdict) out.units = { verdict: units.verdict };
  return out;
}

function run(cmd, args, { timeoutMs = 480000 } = {}) {
  return new Promise((res) => {
    const ch = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { ch.kill('SIGKILL'); err += '\n[gate-all] TIMEOUT'; }, timeoutMs);
    ch.on('close', (code) => { clearTimeout(t); res({ code, out, err }); });
  });
}
async function pool(items, n, fn) { const q = [...items]; const workers = []; for (let i = 0; i < Math.max(1, n); i += 1) workers.push((async () => { while (q.length) await fn(q.shift()); })()); await Promise.all(workers); }
const lastLine = (s) => (s || '').trim().split('\n').filter(Boolean).pop() || '';

async function main() {
  const opts = parseArgs(process.argv);
  if (!existsSync(opts.state)) { console.error(`gate-all: ${opts.state} not found — run from the project root or pass --state`); process.exit(1); }
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = readJson(opts.state);
  const coverage = opts.stage === 'prototype' ? null : readJsonSafe(opts.coverage);
  const { pages, skipped, from } = selectPages({ state, coverage, stage: opts.stage, protoBase: opts.protoBase, edsHost: opts.edsHost, only: opts.only });
  if (opts.stage === 'prototype' && !opts.protoBase) console.error('gate-all: --stage prototype without --proto-base — assuming http://localhost:8791 (serve the prototypes dir there, replica SKILL.md § Phase 4)');
  for (const s of skipped) console.error(`gate-all: ${s.slug} NOT gated — ${s.why}`);
  if (!pages.length) {
    console.error(opts.stage === 'prototype'
      ? `gate-all: no prototype pages selected — ${opts.state} has no row with a prototypePath and a url${opts.only ? ` among --only ${opts.only.join(',')}` : ''}`
      : `gate-all: no deployed pages selected${opts.only ? ` among --only ${opts.only.join(',')}` : ''} — two sources consulted: ${opts.state} (rows with status "deployed" + liveUrl + url: none) and ${opts.coverage} (${coverage ? `rows with delivery.status ${DELIVERED.join(' | ')}, or failed on a gate, and a build URL: none${skipped.length ? `; ${skipped.length} skipped above` : ''}` : (existsSync(opts.coverage) ? 'unreadable' : 'not found')}). Record the delivery (rollout's update-coverage.mjs <slug> --status deployed --url <u>) or pass --state / --coverage.`);
    process.exit(1);
  }
  if (opts.stage !== 'prototype') console.error(`gate-all: ${pages.length} page(s) — ${from.state} from ${opts.state}, ${from.coverage} from ${opts.coverage}`);
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  const CLIP_ALLOW = readJson(join(opts.out, 'clip-allow.json'), {}); const PRESENCE = readJson(join(opts.out, 'presence.json'), {});
  const FAMILIES = readJson('stardust/replica/units.json', null);
  const UNITS = readJson(opts.units || join(opts.out, 'units.json'), {});
  const unitsOf = (p) => (FAMILIES ? unitsFor(FAMILIES, p.slug, p.template, opts.stage) : ((UNITS[p.slug] || {}).units || []).map((x) => ({ origin: x.origin, eds: x.eds || x.origin, n: x.n || 1, required: x.required !== false })));
  const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); writeFileSync(join(opts.out, '_run.log'), `${line}\n`, { flag: 'a' }); };
  const dir = (p) => join(opts.out, p.slug);
  const edsUrl = (p) => (opts.edsHost ? p.liveUrl.replace(/^https?:\/\/[^/]+/, opts.edsHost) : p.liveUrl);
  const measuredWith = (p) => ({ masks: (MASKS[p.slug] && MASKS[p.slug].masks) || [], edsUrl: edsUrl(p) });
  const results = {};
  const rec = (p, k, v) => { results[p.slug] = { ...(results[p.slug] || {}), [k]: v }; };
  const reused = new Set();
  if ((opts.skip || opts.compareOnly) && !opts.recaptureEds && !opts.recaptureOrigin) {
    for (const p of pages) {
      const kept = droppedPass(dir(p), measuredWith(p));
      if (!kept) continue;
      reused.add(p.slug); for (const [k, v] of Object.entries(kept)) rec(p, k, v);
      log(`${p.slug} → recorded pass reused (its captures were dropped on the pass)`);
    }
  }
  // --skip-existing reuses a capture and its meta — unless it is a stitch taken before fixed layers were captured once
  // (staleCapture): retaken, one log line, so both sides of the compare capture alike.
  const reusable = (p, side, png, meta) => {
    if (!existsSync(png) || !existsSync(meta)) return false;
    if ((readJsonSafe(meta) || {}).instrument !== 'stitch-live' || !staleCapture(png)) return true;
    log(`${side} ${p.slug}: ${png} predates the fixed-layer capture (no fixedLayers in its record) — retaking it`);
    return false;
  };
  // stitch-shot's capture record (captureRecordOf: <side>.capture.json beside the PNG; stitch-shot removes it when a
  // capture starts, and so does this — a stitch that never started leaves no stale one) → the meta's fontsFailed
  // (+ fontCheck when it says why): shotFonts — no readable record is unchecked (null), never "all loaded".
  const stitch = (url, out, tail = []) => { rmSync(captureRecordOf(out), { force: true }); return run('node', stitchArgs(STITCH, url, out, opts, tail)); };
  // Before a side is captured again its previous PNG, record and diff go: a capture that fails leaves no picture, so
  // the row is a missing capture (an error, no percentage) — never a diff of the old PNG against the other side.
  const forgetCapture = (d, out) => { for (const f of [out, captureRecordOf(out), join(d, 'diff.png')]) rmSync(f, { force: true }); };

  async function captureOrigin(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'origin.png'); const meta = join(d, 'origin.json');
    if (opts.skip && !opts.recaptureOrigin && reusable(p, 'origin', out, meta)) { rec(p, 'origin', readJson(meta)); return; }
    forgetCapture(d, out); // and a copied origin carries its source's record, or none
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    const cachedLive = join('stardust/replica/gates', `${p.slug}-${opts.width}`, 'live.png');
    let useCached = opts.stage === 'prototype' && existsSync(cachedLive);
    if (useCached && staleCapture(cachedLive)) { useCached = false; log(`origin ${p.slug}: ${cachedLive} predates the fixed-layer capture (no fixedLayers in its record) — not reused, capturing the origin`); }
    let r;
    if (useCached) {
      copyFileSync(cachedLive, out);
      // its record goes with it (a frozen-baseline copy has none: baseline.json's fixedLayers and fontsFailed stand in),
      // so a later --skip-existing round reads the same rule, and the font check (shotFonts) reads the record that went
      const base = readJsonSafe(join(dirname(cachedLive), 'baseline.json')) || {};
      const src = readJsonSafe(captureRecordOf(cachedLive)) || { writtenBy: 'gate-all.mjs', copiedFrom: cachedLive, fixedLayers: base.fixedLayers, ...('fontsFailed' in base ? { fontsFailed: base.fontsFailed } : {}) };
      writeFileSync(captureRecordOf(out), `${JSON.stringify(src, null, 2)}\n`);
      r = { instrument: 'stitch-live', note: `reused ${cachedLive} (the archetype round's capture — hit minimisation)`, ...shotFonts(src) };
    }
    else if (opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked) {
      if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `origin matches --blocked ${opts.blocked}; crawl screenshot used (lazy rails may be placeholders)` }; }
      else r = { instrument: 'none', error: `origin blocked and no crawl shot at ${crawlShot}` };
    } else {
      const s = await stitch(p.url, out, ['--headed']);
      if (s.code !== 0) rmSync(out, { force: true }); // a stitch that died mid-write leaves no partial PNG to diff
      if (s.code === 0) r = { instrument: 'stitch-live', url: p.url, log: s.out.trim().split('\n').slice(-2), ...shotFonts(readJsonSafe(captureRecordOf(out))) };
      else if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `stitch exit ${s.code}: ${lastLine(s.err)} — crawl screenshot used` }; }
      else r = { instrument: 'none', error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    }
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'origin', r);
    log(`origin ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  async function captureEds(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'eds.png'); const meta = join(d, 'eds.json');
    if (opts.skip && !opts.recaptureEds && reusable(p, 'eds', out, meta)) { rec(p, 'eds', readJson(meta)); return; }
    forgetCapture(d, out);
    const s = await stitch(edsUrl(p), out);
    if (s.code !== 0) rmSync(out, { force: true }); // a stitch that died mid-write leaves no partial PNG to diff
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p), ...shotFonts(readJsonSafe(captureRecordOf(out))) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  // One page's probes. A result the probe returned is recorded as is; origin not probed (content-presence exit 3 / 4)
  // is n/a as before; anything else — a crash, a timeout, an unreadable result — is a probe ERROR ({ error }, content:
  // + probeError), which the verdict never lets pass. Each probe's previous JSON goes first, and the page's results,
  // errors included, are written to probes.json — what --compare-only re-reads (recordedProbes).
  async function probe(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const pr = PRESENCE[p.slug] || {};
    const got = {};
    const put = (k, v) => { got[k] = v; rec(p, k, v); };
    for (const k of ['content', 'clip', 'units']) rec(p, k, undefined);
    if (opts.content) {
      for (const f of ['content.json', 'clip.json']) rmSync(join(d, f), { force: true });
      const s = await run('node', contentArgs(join(DIFF_DIR, 'content-presence.mjs'), p.url, edsUrl(p), join(d, 'content.json'), opts, pr));
      const content = readJsonSafe(join(d, 'content.json'));
      let ok = false;
      if (content && (s.code === 0 || s.code === 2)) {
        try {
          const c = contentResult(content, pr); const cl = clipOfContent(content);
          writeFileSync(join(d, 'clip.json'), JSON.stringify({ url: edsUrl(p), at: content._provenance.at, source: 'content-presence', counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: { counts: content.origin.clip.counts } }, null, 1));
          if (content.textBoxes && content.textBoxes.origin) writeFileSync(join(d, 'text-boxes.json'), JSON.stringify({ side: 'origin', boxes: content.textBoxes.origin }));
          put('content', c); put('clip', cl); ok = true;
          log(`content ${p.slug} → MISSING ${content.totals.missing} HIDDEN ${content.totals.hidden} state ${content.totals.controlState}; clipped ${content.eds.clip.counts.total}`);
        } catch (e) { s.err += `\ncontent.json unreadable: ${e.message}`; }
      }
      if (!ok && (s.code === 3 || s.code === 4)) {
        const why = s.code === 3 ? 'origin bot challenge' : `origin ${lastLine(s.err).replace(/^content-presence error: /, '')}`;
        put('content', { error: why });
        log(`content ${p.slug} → n/a (${why})`);
      } else if (!ok) {
        const why = `content-presence exit ${s.code}: ${lastLine(s.err)}`;
        put('content', { error: why, probeError: true });
        log(`content ${p.slug} → ERROR ${why}`);
      }
    }
    if (opts.clip && !got.clip) {
      rmSync(join(d, 'clip.json'), { force: true });
      const s = await run('node', clipArgs(join(DIFF_DIR, 'clip-probe.mjs'), edsUrl(p), join(d, 'clip.json'), opts));
      const clip = readJsonSafe(join(d, 'clip.json'));
      if (clip && clip.counts && (s.code === 0 || s.code === 2)) { put('clip', clipResult(clip)); log(`clip ${p.slug} → ${clip.counts.total}`); }
      else { put('clip', { error: `clip-probe exit ${s.code}: ${lastLine(s.err)}` }); log(`clip ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    const units = unitsOf(p);
    if (units.length) {
      rmSync(join(d, 'units.json'), { force: true });
      const s = await run('node', unitArgs(join(DIFF_DIR, 'unit-geometry.mjs'), p.url, edsUrl(p), join(d, 'units.json'), p.slug, units, opts));
      const res = readJsonSafe(join(d, 'units.json'));
      const required = units.some((x) => x.required);
      if (res && res.verdict && (s.code === 0 || s.code === 2)) { put('units', { verdict: res.verdict, required }); log(`units ${p.slug} → off ${res.verdict.off} hidden ${res.verdict.hidden} missing ${res.verdict.missing}`); }
      else { put('units', { error: `unit-geometry exit ${s.code}: ${lastLine(s.err)}`, required }); log(`units ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    writeFileSync(join(d, 'probes.json'), JSON.stringify({ writtenBy: 'gate-all.mjs', at: new Date().toISOString(), ...got }, null, 1));
  }
  // --compare-only: the recorded results stand in for the probes — no browser, no child. The units' `required` is
  // re-read from the declarations (a sidecar); a page whose declarations are gone has no unit criterion.
  function recallProbes(p) {
    const got = recordedProbes(dir(p), { presence: PRESENCE[p.slug] || {} });
    const units = unitsOf(p);
    if (got.units) { if (units.length) got.units = { ...got.units, required: units.some((x) => x.required) }; else delete got.units; }
    for (const [k, v] of Object.entries(got)) rec(p, k, v);
  }
  async function compare(p) {
    const d = dir(p);
    if (!existsSync(join(d, 'origin.png')) || !existsSync(join(d, 'eds.png'))) {
      const px = { error: 'missing capture' }; mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px); return;
    }
    const mk = MASKS[p.slug];
    const args = [PIXEL, join(d, 'origin.png'), join(d, 'eds.png'), '--out', join(d, 'diff.png'), '--threshold', String(opts.threshold), '--json', '--timeout', '300'];
    if (mk && mk.masks && mk.masks.length) args.push('--mask', mk.masks.join(','));
    if (existsSync(join(d, 'text-boxes.json'))) args.push('--text-boxes', join(d, 'text-boxes.json'));
    const r = await run('node', args);
    let px; try { px = JSON.parse(r.out); } catch { px = { error: lastLine(r.err) || `exit ${r.code}` }; }
    if (mk && mk.masks && mk.masks.length && !px.error) px.maskReason = mk.reason || null;
    writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px);
    log(`pixel ${p.slug} → ${px.error ? `ERROR ${px.error}` : `${px.pct}% Δh ${px.heightDelta}${px.textPct != null ? ` text ${px.textPct}%` : ''} ${px.pass ? 'PASS' : 'FAIL'}${px.maskedRows ? ` [MASKED ${px.maskedRows} rows: ${px.maskReason}]` : ''}`}`);
  }

  const rowOf = (p) => {
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip || null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0, capture: { fonts: fontsNotLoaded(r.origin, r.eds), fontsSkipped: fontChecksSkipped(r.origin, r.eds) } }, { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content });
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument,
      pct: px.pct ?? null, textPct: px.textPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      browser: (r.content && r.content.tier) || (r.clip && r.clip.tier) || null,
      override: OVERRIDES[p.slug] || null, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null };
  };
  let dropped = 0;
  const measured = [];
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const shoot = batch.filter((p) => !reused.has(p.slug));
    if (!opts.compareOnly) measured.push(...shoot);
    for (const p of shoot) forgetDroppedPass(dir(p));
    if (!opts.compareOnly) await Promise.all([pool(shoot, opts.oc, captureOrigin), pool(shoot, opts.ec, captureEds)]);
    else for (const p of shoot) for (const side of ['origin', 'eds']) { const m = readJsonSafe(join(dir(p), `${side}.json`)); if (m) rec(p, side, m); }
    // --compare-only opens no browser and runs no probe: the recorded results, the sidecars re-applied
    if (opts.compareOnly) for (const p of batch) recallProbes(p);
    else if (opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length) await pool(batch, opts.pc, probe);
    await pool(shoot, 4, compare);
    for (const p of batch) if (rowOf(p).pass) dropped += dropPassedCaptures(dir(p), measuredWith(p));
  }
  if (dropped) log(`dropped ${dropped} PNG(s) of passed pages — their records stay (#156)`);
  const rows = pages.map(rowOf);
  const n = (f) => rows.filter(f).length;
  const overCap = await recordRounds(measured.map((p) => rowOf(p)), opts);
  if (overCap.length) log(`round cap (source-fidelity-gate.md § Iteration discipline) reached or passed on ${overCap.length} page(s): ${overCap.slice(0, 8).join(', ')}${overCap.length > 8 ? ', …' : ''} — rounds.mjs status <gate-dir>, then decide`);
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && r.override), fail: n((r) => !r.pass && !isErrorRow(r)), error: n(isErrorRow), probeErrors: n((r) => r.probeErrors.length > 0),
    failPixel: n((r) => r.pct != null && !r.pixelPass), failHeight: n((r) => r.pct != null && !r.heightPass), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), fontsNotLoaded: n((r) => r.fontsNotLoaded.some(fontFails)), fontsDeadOnSource: n((r) => r.fontsNotLoaded.some((f) => !fontFails(f))), fontChecksSkipped: n((r) => r.fontChecksSkipped && r.fontChecksSkipped.length > 0), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric), degradedTier: n((r) => r.browser && r.browser !== 'chrome') };
  totals.passWithOverrides = totals.pass + totals.overridePass;
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: new Date().toISOString(), stage: opts.stage, breakpoint: opts.width, threshold: opts.threshold, heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `overlap pixel % ≤ ${opts.threshold} AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, only: opts.only }, totals, rows };
  const md = formatSummary(summary);
  if (opts.only) { mkdirSync(join(opts.out, 'runs'), { recursive: true }); const f = join(opts.out, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${opts.only[0]}.json`); writeFileSync(f, JSON.stringify(summary, null, 2)); console.log(md); console.log(`run → ${f}`); }
  else { writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2)); writeFileSync(join(opts.out, 'summary.md'), md); console.log(md.split('\n').slice(0, 7).join('\n')); console.log(`summary → ${join(opts.out, 'summary.md')}`); }
  console.log(JSON.stringify(totals));
  process.exitCode = totals.pass + totals.overridePass === totals.pages ? 0 : 2;
}

/**
 * A published-stage measurement that ended in a verdict is a round of its page (rounds.mjs — the same
 * ledger gate.sh keeps, `gates/<slug>-<width>/rounds.json`). Recorded here, never refused here: the
 * roster run must not stop on one page's budget. → the slugs at or over the cap. Never throws.
 */
export async function recordRounds(rows, opts, { rounds = null, now = () => new Date().toISOString() } = {}) {
  if (opts.stage !== 'published' || !rows.length) return [];
  const over = [];
  try {
    const R = rounds || await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'rounds.mjs')).href);
    const root = dirname(opts.out); const label = `all-${now().replace(/[:.]/g, '-')}`;
    for (const r of rows) {
      if (!r || isErrorRow(r)) continue;
      const d = join(root, `${r.slug}-${opts.width}`); mkdirSync(d, { recursive: true });
      const { ledger } = R.load(d);
      R.record(ledger, 'published', label, r.pass ? 'pass' : 'fail');
      R.save(d, ledger);
      const t = R.tally(ledger, 'published');
      if (!r.pass && t.counted >= t.allowance) over.push(r.slug);
    }
  } catch (e) { console.error(`gate-all: rounds not recorded — ${String(e && e.message ? e.message : e).split('\n')[0]}`); }
  return over;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`gate-all error: ${e.message}`); process.exit(1); });
}
