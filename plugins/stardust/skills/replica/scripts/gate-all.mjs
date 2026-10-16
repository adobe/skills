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
 *
 * Per page: stitched captures of both sides (stitch-shot, --settle), pixel-compare, then the DOM probes
 * — clip-probe on the served side (D1, both stages), content-presence (D2, published stage; the
 * prototype is authored from the same capture content-diff already reconciles) and unit-geometry (D3)
 * for the repeated-unit families stardust/replica/units.json declares for the page. Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + clip.json [+ content.json, units.json] + probes.json
 * [+ gate-key.json], <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead.
 * --one-load (opt-in): ONE navigation per side — each side's stitch (both headed real Chrome) also takes the presence,
 * clip and unit inventories of the page it loaded (stitch-shot --inventory: after its settle, at the top, before the
 * freeze; <slug>/<side>-inventory[.spec].json) and content.json / clip.json / units.json are built from the two with
 * the probes' own report builders (content.json `_provenance.via: one-load`); a needed side without a usable inventory
 * (blocked / failed origin, --warmup, a kept capture taken without one) runs the probes instead, logged `one-load <slug>
 * → fallback: <why>`; the row says which (`oneLoad`). A fix round keeps only a one-load origin; live.png is not taken
 * (`inventoryWhy`, `oneLoadKeep` are exported).
 * A content-presence origin-inventory cache hit is a recorded reuse too (`presenceReused`, _run.log); that inventory
 * (<slug>/presence-origin.json) belongs to one origin capture — its text boxes weight origin.png's compare — and is
 * dropped whenever the capture changes (origin.json `at`: a new stitch, a crawl shot, a copied live.png). A
 * unit-geometry origin-cache hit (units.json `originCache`) is recorded likewise (`unitsReused`, _run.log; fresh or
 * replayed); that per-width cache keeps its own freshness rule.
 *
 * VERDICT (all four): pixel % ≤ --threshold AND |Δh| ≤ --height-tol × origin height (a union metric
 * was tried and rejected — white gaps score as matches) AND served clipped ≤ --clip-max +
 * clip-allow.json allowance AND content MISSING + HIDDEN links / headings = 0 (n/a when the origin
 * could not be probed — never a fail) [+ required units within --unit-tol]. The pixel-only verdict is
 * recorded beside it per page and in the totals — every run is calibration data.
 *
 * Sidecars in <out>/, each entry documented: masks.json (printed on the verdict), overrides.json
 * (shown BESIDE the number, never replacing it), clip-allow.json, presence.json (session-variable
 * regions); repeated units come from stardust/replica/units.json (unit-geometry.mjs header; a legacy
 * <out>/units.json per page still reads). presence.json `hide` (per slug, and `"*"` for every slug, `"*"`'s first; plain
 * CSS selectors) names in-flow per-visitor regions removed on BOTH sides before anything measures — both stitches,
 * content-presence and clip-probe get `--hide <list>` (unit-geometry does not) — and only a non-empty list is recorded
 * (origin.json / eds.json / the row `hide`, probes.json inputs, the gate key), so no capture taken with another list is
 * reused as if equal (fix rounds, live.png, --skip-existing). Origin fallback: live stitch → previous origin
 * (--recapture-origin) → <crawl-shots>/<slug>.png (`crawl-fullpage`, asymmetric, flagged).
 * Origin reuse: fix rounds (--only, --recapture-eds) and the published stage (gates/<slug>-<w>/live.png + a matching
 * live.json) reuse origin captures of THIS run — at or after the last rollout A-inventory / replica extract start in
 * stardust/status.jsonl (--origin-max-age: older ones too); the row (`originReused`), origin.json and _run.log record it.
 *
 * REUSE (--skip-existing only; every reuse is printed in the row as `reused`, never silent). Origin captures in the
 * page dir are reused as before; an EDS capture only while its <slug>/gate-key.json proves it current (below).
 * Probes are replayed from <slug>/probes.json while the capture pair they were taken against is the one on disk —
 * same inputs, every probe ok and its JSON the recorded one, origin.json and eds.json no newer than the probes, a
 * reused origin (it keeps its first capture time) the one probes.json recorded in `pair` — so the same-minute
 * origin/build pairing holds because the pair is unchanged; --recapture-eds / --recapture-origin invalidate them.
 * Published stage: every row carries `gateKey`, sha256 over the frozen
 * foundation's snapshot + icons/ and plugins/, the shared blocks (no document authors them, or foundation code
 * loads them), the page's blocks with every block they import, its content document plus every nav*, footer* and
 * fragments/ document under content/ (any locale), and the build: EDS origin, source URL, width, criteria and
 * thresholds, the page's sidecar entries and the gate's instrument files with every local module they load. It is
 * issued only while that tree is what the gated host serves (code: no changed, deleted, renamed or untracked file
 * under any hashed code path against the upstream branch; host <ref>--<repo>--<owner> = that branch and remote;
 * documents: the newest deploy-ledger row delivered to that <owner>/<repo> (`verifiedOn`) with the same
 * contentSha), else null with the reason in the run log (a frozen-file edit since the freeze: null until re-frozen).
 * A PASS row whose key holds, from a table written under the same criteria, is reused whole (no stitch, probe or
 * compare). The EDS side is re-shot unless gate-key.json holds the same known key — or, the key unknown now, the
 * same parts, reason, upstream commit and ledger rows; a dir without gate-key.json (legacy) is re-shot once. A
 * fresh row keeps the key of its evidence only while that key is current (unknown now: same build part, probes
 * not re-run).
 *
 * Empty selection: no page passes the stage filter (`deployed` with a liveUrl / a prototypePath, each with a source
 * url) and --only → one stderr line naming the state file read (absolute), its page count, how many carry those spec
 * words (and how many of them lack the source url), what --only matched, and the hint to pass --state from the project
 * root or deploy first; exit 1, nothing written.
 *
 * Roster estimate: each run's first status line (stdout and _run.log) is `roster: <n> page(s) × 1 width @<w> (<stage>) —
 * estimated <s> s (25 s per page per width)` (`ESTIMATE_SEC_PER_PAGE` × pages × widths; one width per process) plus
 * `; run-bg deadline <d> s` when one is known — a recorded 99-page roster at one width needed 2152 s and was killed by
 * run-bg's 900 s default deadline. Deadline guard: RUN_BG_DEADLINE_SEC (env, seconds — the job's --timeout, exported by
 * run-bg; absent or ≤ 0 = none) below the estimate → gate-all refuses to start, before the out dir and any capture,
 * probe, gate key or table write: one stderr line (`no verdict`, the roster, the estimate, the deadline and the remedy
 * `--timeout <estimate>`), exit 2.
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--stage published|prototype] [--proto-base <url>]
 *        [--state f] [--out dir] [--width 1440] [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--eds-host <h>]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-max-age <h>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--threshold 10] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>] [--one-load]
 * Two browser budgets, kept apart: the origin pool (2) is the source's bot budget; the EDS / probe pools (4 / 2) carry
 * no bot risk, but each of their slots is a Chromium — raising them raises this job's Chromium peak (measured: 6 / 4
 * took an 8-page job from 6 to 8 at once). A machine-wide browser slot (run-bg) bounds jobs, not browsers, so the
 * defaults hold with or without one; the flags raise them.
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs, pixel-compare.mjs
 * and foundation-freeze.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (overrides count), 2 any FAIL or a refused start (no verdict), 1 error or an empty selection. `verdict`,
 * `formatSummary`, `parseArgs`, `emptySelection`, the roster helpers for run-bg (`ESTIMATE_SEC_PER_PAGE`, `selectPages`,
 * `rosterEstimate`) and the reuse helpers
 * (`probeInputs`, `probeReuse`, `canon`, `gateKeyParts`, `gateKeyOf`, `foundationPart`, `sharedBlocks`,
 * `blockRefs`, `chromeDocs`, `instrumentFiles`, `edsHostOf`, `codeDeployed`, `hostServes`,
 * `deployedDocs`, `contentDeployed`, `keyChanged`, `skipCapture`, `rowKey`, `latestRows`, `rowReuse`) are exported.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_OUT as FREEZE_MANIFEST, DEFAULT_PATHS as FOUNDATION_PATHS, snapshot } from './foundation-freeze.mjs';

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --stage published|prototype  published (default): deployed pages vs liveUrl → gates/all-<w>/;
                            prototype: pages with a prototypePath vs the served prototype → gates/prototypes-<w>/
  --proto-base <url>        where the prototypes dir is served (prototype stage), e.g. http://localhost:8791
  --state <file>            stardust/state.json
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched)
  --skip-existing           reuse captures; probes while the capture pair is unchanged; PASS rows
                            while the gate key is unchanged (rows say reused). Published eds.png:
                            only while <slug>/gate-key.json proves it current (same key, or unknown
                            key with the same tree, reason, upstream, ledger rows); no local
                            content/<page>.html → nothing to compare → re-shot every run (slower)
  --recapture-eds           re-shoot eds.png only; the origin is reused while fresh (always with --skip-existing)
  --recapture-origin        re-shoot origin.png even when fresh (previous kept on failure)
  --origin-max-age <h>      also reuse origin captures from earlier runs up to <h> hours old (env
                            STARDUST_ORIGIN_MAX_AGE_H; default: this run's captures only)
  --eds-host <host>         gate a code branch host against the same content
  --blocked <regex>         origins the edge denies → crawl shot unless --try-blocked
  --try-blocked             attempt the live stitch on --blocked origins too
  --crawl-shots <dir>       stardust/current/assets/screenshots (fallback origin PNGs)
  --origin-concurrency <n>  2 — the source's bot budget
  --eds-concurrency <n>     4      --probe-concurrency <n>  2 — no bot risk, but each is a Chromium:
                            raising them raises this job's Chromium peak (a browser slot bounds jobs)
  --threshold <pct>         10     --height-tol <frac>    0.05   --clip-max <n>  0   --unit-tol <px>  4
  --no-clip | --no-content | --no-probes   drop criteria 3 / 4 / both (pixel-only verdict)
  --units <file>            repeated-unit declarations (default <out>/units.json)
  --compare-only            no captures; recompute from existing PNGs
  --warmup <url>            origin warm-up for the probes
  --one-load                one navigation per side: each stitch also takes the presence / clip / unit inventories
                            (both sides headed real Chrome, live.png not reused); a side without one → the probes, logged
  --vh <px>                 stitch chunk height
  --help                    this text
Verdict = pixel % ≤ threshold AND |Δh| ≤ height-tol × origin height AND clipped ≤ clip-max(+allowance) AND content MISSING+HIDDEN = 0.
Sidecars in <out>/: masks.json, overrides.json, clip-allow.json, presence.json, units.json (see the header);
  presence.json "hide" (per slug or "*"): in-flow regions removed on both sides before measuring.
Reuse sidecars per page: probes.json, gate-key.json (see the header).
Empty selection → one stderr line: the absolute state path, its page count, how many are deployed with a liveUrl /
  have a prototypePath (and how many of those lack a source url), what --only matched, the hint; exit 1.
First status line (stdout, _run.log): roster: <n> page(s) × 1 width @<w> (<stage>) — estimated <25·n> s (25 s per
  page per width)[; run-bg deadline <d> s]. RUN_BG_DEADLINE_SEC (env, seconds: the job's --timeout, exported by
  run-bg; absent or ≤ 0 = none) below the estimate → refused before the out dir or any capture: one stderr line
  "no verdict" naming --timeout <estimate>; exit 2.
Exit: 0 all PASS (overrides count), 2 any FAIL or a refused start (no verdict), 1 error or an empty selection.`;

export function parseArgs(argv, env = process.env) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { stage: 'published', protoBase: null, state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, originMaxAge: null, threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = () => rest[++i];
    if (a === '--stage') { o.stage = v(); if (!['published', 'prototype'].includes(o.stage)) { console.error(`--stage must be published or prototype\n\n${HELP}`); process.exit(1); } }
    else if (a === '--proto-base') o.protoBase = v().replace(/\/$/, '');
    else if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') o.width = Number(v());
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') o.edsHost = v().replace(/\/$/, ''); else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-max-age') { o.originMaxAge = Number(v()); if (!(o.originMaxAge >= 0)) { console.error(`--origin-max-age must be a number of hours >= 0\n\n${HELP}`); process.exit(1); } }
    else if (a === '--origin-concurrency') o.oc = Number(v()); else if (a === '--eds-concurrency') o.ec = Number(v()); else if (a === '--probe-concurrency') o.pc = Number(v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--one-load') o.oneLoad = true;
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  o.browserSlot = Boolean(env.STARDUST_BROWSER_SLOT); // run-bg holds a machine-wide browser slot for this job (logged; pools unchanged)
  const deadline = Number(env.RUN_BG_DEADLINE_SEC); o.deadlineSec = deadline > 0 ? deadline : null; // run-bg exports the job's --timeout (s); absent / ≤ 0 = none
  if (o.stage === 'prototype' && o.content) o.content = false; // content-diff already reconciles the prototype's text
  if (!o.out) o.out = `stardust/replica/gates/${o.stage === 'prototype' ? 'prototypes' : 'all'}-${o.width}`;
  return o;
}

// ---- the roster: selection + estimate (pure; rosterEstimate also reads the state file) ------------------------------
export const ESTIMATE_SEC_PER_PAGE = 25;
const pagesOf = (state) => (state && state.pages) || [];
/** selectPages(state, { stage, protoBase, only }) → the pages this run gates (main() selects with it; run-bg counts with it). */
export function selectPages(state, { stage = 'published', protoBase = null, only = null } = {}) {
  const pages = stage === 'prototype'
    ? pagesOf(state).filter((p) => p.prototypePath && p.url).map((p) => ({ ...p, liveUrl: `${protoBase || 'http://localhost:8791'}/${basename(p.prototypePath)}` }))
    : pagesOf(state).filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  return only ? pages.filter((p) => only.includes(p.slug)) : pages;
}
// One width per process: widths stays 1 here, explicit so run-bg can sum invocations (pages × widths).
const roster = (pages, { width, stage }) => { const widths = 1; return { pages, widths, width, stage, estimatedSeconds: ESTIMATE_SEC_PER_PAGE * pages * widths }; };
const rosterText = (r) => `${r.pages} page(s) × ${r.widths} width${r.widths === 1 ? '' : 's'} @${r.width} (${r.stage})`;
/**
 * rosterEstimate(argv, { cwd }) → { pages, widths: 1, width, stage, state, estimatedSeconds } | { error } for gate-all's own
 * argv (no node / script path): reads only --state, --stage, --proto-base, --only, --width (other flags and --help are
 * skipped, never an exit or a print) and the state file resolved against cwd — no other I/O.
 */
export function rosterEstimate(argv, { cwd = process.cwd() } = {}) {
  const o = { state: 'stardust/state.json', stage: 'published', protoBase: null, only: null, width: 1440 };
  const KEY = { '--state': 'state', '--stage': 'stage', '--proto-base': 'protoBase', '--only': 'only', '--width': 'width' };
  const a = argv || [];
  for (let i = 0; i < a.length; i += 1) if (KEY[a[i]] && a[i + 1] != null) { o[KEY[a[i]]] = String(a[i + 1]); i += 1; }
  if (!['published', 'prototype'].includes(o.stage)) return { error: `--stage must be published or prototype (got ${o.stage})` };
  const only = o.only == null ? null : o.only.split(',').map((s) => s.trim()).filter(Boolean); const width = Number(o.width);
  const state = resolve(cwd, o.state); let json;
  try { json = JSON.parse(readFileSync(state, 'utf8')); } catch (e) { return { error: e.code === 'ENOENT' ? `${state} not found` : `${state} unreadable: ${e.message}` }; }
  return { ...roster(selectPages(json, { stage: o.stage, protoBase: o.protoBase && o.protoBase.replace(/\/$/, ''), only }).length, { width, stage: o.stage }), state };
}
/** emptySelection(state, { stage, only, statePath }) → the one stderr line naming why no page was selected. */
export function emptySelection(state, { stage = 'published', only = null, statePath }) {
  const all = pagesOf(state); const proto = stage === 'prototype';
  const counted = all.filter((p) => (proto ? p.prototypePath : p.status === 'deployed' && p.liveUrl)); const noUrl = counted.filter((p) => !p.url).length;
  const staged = counted.length - noUrl;
  return `gate-all: no pages selected — ${statePath} has ${all.length} page(s), ${counted.length} ${proto ? 'with a prototypePath' : 'deployed with a liveUrl'}${noUrl ? ` (${noUrl} without a source url)` : ''} (${stage} stage)${only && staged ? `; --only ${only.join(',')} matched none of the ${staged} page(s) the stage selects` : ''}; pass --state stardust/state.json (or the gate state file) from the project root, or deploy first`;
}

// ---- pure: the verdict --------------------------------------------------------------------------------
/**
 * verdict({ pixel, clip, content, units, override, allowance }, opts) → row fields. `pixel` = pixel.json,
 * `clip` = { counts } (served side) or null, `content` = { totals } | { error } | null, `units` = { verdict } | null.
 */
export function verdict({ pixel = {}, clip = null, content = null, units = null, override = null, allowance = 0 }, { threshold = 10, heightTol = 0.05, clipMax = 0, clipOn = true, contentOn = true } = {}) {
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
  const pixelOnlyPass = !!(pixelPass && heightPass);
  const pass = pixelOnlyPass && clipPass !== false && contentPass !== false && unitPass !== false;
  return { originH, edsH, pixelPass: !!pixelPass, heightPass: !!heightPass, clipped, clipPass, clipAllowance: allowance, contentPass, contentNA: contentOn && !cTot ? (content && content.error) || 'not probed' : null, unitPass, pixelOnlyPass, pass, passWithOverride: pass || !!override, reasons };
}

const cell = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
export function formatSummary(summary) {
  const t = summary.totals; const p = summary._provenance;
  const head = [`# ${p.stage === 'prototype' ? 'Prototype gate — every crafted prototype' : 'Published-origin gate — all deployed pages'}, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error of ${t.pages}**${t.overridePass ? ` (+${t.overridePass} documented override${t.overridePass > 1 ? 's' : ''} → ${t.passWithOverrides} delivered)` : ''}${t.reusedRows || t.reusedProbes ? ` · reused: ${t.reusedRows || 0} rows, ${t.reusedProbes || 0} probe sets` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}; content n/a (origin not probed) ${t.contentNA}${t.degradedTier ? `; **${t.degradedTier} page(s) probed on a degraded browser tier** (Chrome elected, Chromium used — install Chrome for bot-managed origins)` : ''}${t.asymmetricOrigins ? `; ${t.asymmetricOrigins} asymmetric origin(s)` : ''}.`, ''];
  const rows = ['| page | template | tier | origin | browser | pixel % (text %) | Δh px | clipped | content | units | verdict | reasons | reused |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const content = r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}` : '-';
    const verdictCell = r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${r.browser || '-'} | ${cell(r.pct)}${r.textPct != null ? ` (${r.textPct})` : ''} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? ` → ${r.override.verdict}: ${r.override.reason}` : ''} | ${r.reasons.join('; ') || '-'} | ${r.reused ? `${r.reused.what} ${r.reused.at}` : '-'} |`);
  }
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

// ---- pure: evidence reuse under --skip-existing (every reuse is recorded in the row) ---------------------
/** Canonical JSON: object keys sorted at every depth, so equality and hashes never depend on key order. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/**
 * A recorded hide list (origin.json / eds.json / live.json / the row `hide`; absent = []) as compared: entries split on
 * ',', trimmed, empty dropped, de-duplicated in order — the order is part of the list.
 */
const hideRecord = (h) => [...new Set([].concat(h ?? []).flatMap((s) => (typeof s === 'string' ? s.split(',') : [])).map((s) => s.trim()).filter(Boolean))];
const sameHide = (recorded, list) => canon(hideRecord(recorded)) === canon(hideRecord(list));
/** `{ hide }` only for a non-empty list — absent = none, so records without hides stay as they were. */
const hideField = (list) => (list && list.length ? { hide: list } : {});
/**
 * What a page's probes were taken with — any change re-runs them. ctx = { opts, edsUrl, presence, unitsOf, hideOf }
 * (hideOf(p) = the page's presence.json hide list; `hide` is an input only when non-empty).
 */
export function probeInputs(p, { opts, edsUrl, presence = {}, unitsOf, hideOf = () => [] }) {
  return { origin: p.url, eds: edsUrl(p), width: opts.width, warmup: opts.warmup ?? null, stage: opts.stage, content: opts.content, clip: opts.clip, presence: presence[p.slug] ?? null, units: unitsOf(p), unitTol: opts.unitTol, ...hideField(hideOf(p)) };
}
const PROBE_AT = { content: (j) => j && j._provenance && j._provenance.at, clip: (j) => j && j.at, units: (j) => j && j._provenance && j._provenance.at };
/**
 * probeReuse({ sidecar, inputs, originMeta, edsMeta, files, opts }) → { reuse, at, why }. `sidecar` = <slug>/probes.json,
 * `files` = the probe JSONs on disk { content, clip, units }. Replays only under --skip-existing, without
 * --recapture-eds (and without --recapture-origin when a probe loads the origin), with the same inputs, every
 * enabled probe recorded ok and its JSON still the recorded one, and BOTH captures no newer than the probes —
 * the capture pair the probes were taken against is the pair on disk; a reused capture must be the one the
 * sidecar's `pair` ({ origin, eds } capture times) recorded.
 */
export function probeReuse({ sidecar, inputs, originMeta, edsMeta, files = {}, opts }) {
  const no = (why) => ({ reuse: false, at: null, why });
  if (!opts.skip) return no('no --skip-existing');
  if (opts.recaptureEds) return no('--recapture-eds');
  if (opts.recaptureOrigin && (inputs.content || inputs.units.length)) return no('--recapture-origin');
  if (!sidecar || !sidecar.at) return no('no probes.json');
  if (canon(sidecar.inputs) !== canon(inputs)) return no('probe inputs changed');
  const kinds = ['content', 'clip', 'units'].filter((k) => (k === 'units' ? inputs.units.length : inputs[k]));
  if (!kinds.length) return no('nothing to probe');
  for (const k of kinds) {
    const res = sidecar.results && sidecar.results[k];
    if (res !== 'ok') return no(`${k} probe ${res || 'not run'}`);
    if (!PROBE_AT[k](files[k]) || PROBE_AT[k](files[k]) !== (sidecar.ats && sidecar.ats[k])) return no(`${k}.json is not the recorded one`);
  }
  for (const [side, m] of [['origin', originMeta], ['eds', edsMeta]]) {
    if (!m || m.error || !m.at) return no(`no ${side} capture`);
    if (!(sidecar.at >= m.at)) return no(`${side} captured after the probes`);
    // a reused capture keeps its first capture time, so time order alone cannot prove it is the one the probes saw
    if (m.reused && !(sidecar.pair && sidecar.pair[side] === m.at)) return no(`${side} is a reused capture the probes were not taken against`);
  }
  return { reuse: true, at: sidecar.at, why: null };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// EDS runtime dirs outside the frozen foundation that still change a render (decorated icons, plugins).
const RUNTIME_PATHS = ['icons/', 'plugins/'];
const FREEZE_WHY = 'foundation changed since freeze';
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const BLOCK_CLASS = /<div\s+class="\s*([^"\s]+)/gi;
// The DA document behind a delivered path — deploy/scripts/eds-path.mjs daPath, inlined (no cross-skill import).
const daPathOf = (pathname) => (pathname.endsWith('/') ? `${pathname}index` : pathname);
// EDS host-label form of a branch, repo or owner name: lower case, every run of other characters → '-'.
const hostLabel = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const filesUnder = (root, paths) => Object.entries(snapshot(root, paths)).filter(([, v]) => !String(v).startsWith('symlink:')).map(([f]) => f);
const blockFiles = (root, n) => snapshot(root, [`blocks/${n}/`]);
/** Block dirs a code file loads: `…/blocks/<name>/…`, a sibling `../<name>/…` from inside a block dir, `buildBlock('<name>'`. */
export function blockRefs(text, inBlockDir = false) {
  const out = new Set();
  for (const m of text.matchAll(/['"`](?:\.{0,2}\/)*blocks\/([a-z0-9][a-z0-9-]*)\//g)) out.add(m[1]);
  if (inBlockDir) for (const m of text.matchAll(/['"`(]\.\.\/([a-z0-9][a-z0-9-]*)\//g)) out.add(m[1]);
  for (const m of text.matchAll(/buildBlock\(\s*['"`]([a-z0-9][a-z0-9-]*)['"`]/g)) out.add(m[1]);
  return out;
}
// The named block dirs plus every block dir their JS / CSS loads, transitively.
function blockClosure(root, start) {
  const seen = new Set(); const queue = [...start];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n) || !NAME.test(n) || !existsSync(join(root, 'blocks', n))) continue;
    seen.add(n);
    for (const f of filesUnder(root, [`blocks/${n}/`])) if (/\.(m?js|css)$/.test(f)) queue.push(...blockRefs(readFileSync(join(root, f), 'utf8'), true));
  }
  return [...seen].sort();
}
/**
 * The shared blocks part (once per run, the same for every page): every blocks/<name>/ dir no content document
 * authors (`<div class>` anywhere under content/, or a coverage row) — auto-blocks, fragment loaders — plus every
 * block the foundation or runtime code loads (imports, `buildBlock`), with what those load. An edit there changes
 * every key (rare; errs safe). Authored blocks stay per page.
 */
export function sharedBlocks(root = '.', coverage = {}) {
  const dir = join(root, 'blocks');
  const all = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && NAME.test(d.name)).map((d) => d.name) : [];
  const authored = new Set(Object.values(coverage).flat());
  for (const f of filesUnder(root, ['content/'])) if (f.endsWith('.html')) for (const m of readFileSync(join(root, f), 'utf8').matchAll(BLOCK_CLASS)) authored.add(m[1]);
  const loaded = [];
  for (const f of filesUnder(root, [...FOUNDATION_PATHS, ...RUNTIME_PATHS])) if (/\.(m?js|css|html)$/.test(f)) loaded.push(...blockRefs(readFileSync(join(root, f), 'utf8'), f.startsWith('blocks/')));
  const names = blockClosure(root, [...all.filter((n) => !authored.has(n)), ...loaded]);
  return { hash: sha256(canon(Object.fromEntries(names.map((n) => [n, blockFiles(root, n)])))), names };
}
// The gate's instruments (this file, stitch-shot, pixel-compare, the diff probes) and every local module they load —
// a new verdict, probe or capture engine is a key change. A relative `.mjs` / `.js` string literal that resolves to a
// file counts as a load (static and dynamic imports, candidate lists such as stitch-shot's live-session paths).
export function instrumentFiles(roots) {
  const seen = new Set(); const queue = roots.filter((f) => existsSync(f)).map((f) => resolve(f));
  while (queue.length) {
    const f = queue.shift();
    if (!seen.has(f)) {
      seen.add(f);
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](\.{1,2}\/[^'"`\s]+\.m?js)['"`]/g)) { const dep = resolve(dirname(f), m[1]); if (existsSync(dep)) queue.push(dep); }
    }
  }
  return [...seen].sort();
}
let instrumentsMemo = null;
function instrumentsHash() {
  if (!instrumentsMemo) {
    const roots = [fileURLToPath(import.meta.url), STITCH, PIXEL, ...(DIFF_DIR ? ['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => join(DIFF_DIR, f)) : [])];
    instrumentsMemo = sha256(canon(Object.fromEntries(instrumentFiles(roots).map((f) => [relative(HERE, f).split(sep).join('/'), sha256(readFileSync(f))]))));
  }
  return instrumentsMemo;
}
/**
 * The foundation part of the gate key: the hash of the frozen paths' snapshot (= of the manifest's `files` while
 * `foundation-freeze check` passes; without a manifest, of the default foundation set). `why` = `foundation changed
 * since freeze` when the snapshot left the manifest (no key, but the parts still say what changed). `runtime` = the
 * hash of RUNTIME_PATHS; `paths` = the foundation paths the deploy-state guard diffs against the upstream branch.
 */
export function foundationPart(root = '.') {
  const manifest = join(root, FREEZE_MANIFEST); const runtime = sha256(canon(snapshot(root, RUNTIME_PATHS)));
  const m = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null;
  const paths = m && Array.isArray(m.paths) ? m.paths : FOUNDATION_PATHS;
  const now = canon(snapshot(root, paths.filter((x) => existsSync(join(root, x)))));
  return { hash: sha256(now), runtime, paths, why: m && now !== canon(m.files || {}) ? FREEZE_WHY : null };
}
/**
 * Chrome documents for every key (once per run): every nav*.html and footer*.html anywhere under content/ and every
 * document under a fragments/ dir at any depth — per-locale navs and fragments included (an edit to any re-gates every
 * page; errs safe). → { files: { path: sha256 }, names: block names they author }.
 */
export function chromeDocs(root = '.') {
  const files = {}; const names = new Set();
  for (const f of filesUnder(root, ['content/'])) {
    if (!f.endsWith('.html') || !(/^(nav|footer)/.test(basename(f)) || f.split('/').slice(1, -1).includes('fragments'))) continue;
    const buf = readFileSync(join(root, f)); files[f] = sha256(buf);
    for (const m of buf.toString('utf8').matchAll(BLOCK_CLASS)) names.add(m[1]);
  }
  return { files, names: [...names].sort() };
}
/**
 * gateKeyParts(p, ctx) → { parts, why }: what a published row's verdict depends on (parts null + why
 * only when the page's document is missing; a stale freeze gives parts + why). ctx = { root, opts, edsUrl, masks,
 * clipAllow, presence, unitsOf, hideOf, foundation, coverage (slug → block names), shared, chrome, instruments }.
 * blocks: coverage/pages.json `blocks` ∪ the first class token of every `<div class>` in the page's document and the
 * chrome documents, with every block dir those load — each file hashed; shared: sharedBlocks(). content: the page's
 * content<daPath>.html + chromeDocs(). build: the EDS origin, the source URL, the width, the gate settings, the
 * page's sidecar entries (a mask or allowance edit is a key change; the presence.json hide list only when non-empty)
 * and the instruments' hash.
 */
export function gateKeyParts(p, { root = '.', opts, edsUrl = (x) => x.liveUrl, masks = {}, clipAllow = {}, presence = {}, unitsOf = () => [], hideOf = () => [], foundation = foundationPart(root), coverage = {}, shared = sharedBlocks(root, coverage), chrome = chromeDocs(root), instruments = instrumentsHash() }) {
  const url = new URL(edsUrl(p)); const page = `content${daPathOf(url.pathname)}.html`;
  if (!existsSync(join(root, page))) return { parts: null, why: `no ${page}` };
  const buf = readFileSync(join(root, page));
  const named = new Set([...(coverage[p.slug] || []), ...chrome.names, ...[...buf.toString('utf8').matchAll(BLOCK_CLASS)].map((m) => m[1])]);
  const blocks = Object.fromEntries(blockClosure(root, named).map((n) => [n, blockFiles(root, n)]));
  const settings = { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, clip: opts.clip, content: opts.content };
  const sidecars = { masks: masks[p.slug] ?? null, clipAllow: clipAllow[p.slug] ?? null, presence: presence[p.slug] ?? null, units: unitsOf(p), ...hideField(hideOf(p)) };
  const parts = { v: 1, foundation: foundation.hash, runtime: foundation.runtime, shared: shared.hash, blocks, content: { [page]: sha256(buf), ...chrome.files }, build: { origin: url.origin, source: p.url, width: opts.width, settings, sidecars, instruments } };
  return { parts, why: foundation.why || null };
}
/** gateKeyOf(parts) → hex sha256 of the canonical (sorted-key) JSON of the parts (they carry `v`), or null. */
export const gateKeyOf = (parts) => (parts ? sha256(canon(parts)) : null);
/** An EDS host `<ref>--<repo>--<owner>.(aem|hlx).(page|live)` → { ref, repo, owner, tier }, else null. */
export function edsHostOf(host) {
  const m = /^([a-z0-9-]+?)--([a-z0-9-]+?)--([a-z0-9-]+)\.(?:aem|hlx)\.(page|live)$/i.exec(String(host || ''));
  return m ? { ref: m[1].toLowerCase(), repo: m[2].toLowerCase(), owner: m[3].toLowerCase(), tier: m[4].toLowerCase() } : null;
}
/**
 * Deploy-state guard, code half (one git call set per run, for every page): an upstream branch exists and NO file
 * under any hashed code path (git pathspecs, so a manifest entry without a trailing slash covers its whole dir)
 * differs from it — `git diff --no-renames @{u}` lists both sides of a rename and every deletion — and none is
 * untracked → { ok, why, upstream, branch, ref, owner, repo } (ref / owner / repo in EDS host-label form;
 * `upstream` = the upstream commit, recorded even when the key is unknown, so any push re-shoots unproven pages).
 */
export function codeDeployed(paths, root = '.') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  const named = (l) => `${l.slice(0, 3).join(', ')}${l.length > 3 ? ` (+${l.length - 3})` : ''}`;
  let up; let upstream; let branch; let remoteUrl;
  try { [up] = git('rev-parse', '--abbrev-ref', '@{u}'); [upstream] = git('rev-parse', '@{u}'); } catch { return { ok: false, why: 'no upstream branch (git rev-parse @{u}) — the deployed code cannot be proven', upstream: null }; }
  try {
    const [head] = git('symbolic-ref', '--short', 'HEAD');
    branch = git('config', '--get', `branch.${head}.merge`)[0].replace(/^refs\/heads\//, '');
    [remoteUrl] = git('remote', 'get-url', git('config', '--get', `branch.${head}.remote`)[0]);
  } catch { return { ok: false, why: `cannot read the branch and remote behind ${up}`, upstream }; }
  try {
    const changed = git('diff', '--name-only', '--no-renames', '--relative', '@{u}', '--', ...paths);
    if (changed.length) return { ok: false, why: `code differs from ${up} (not pushed, so not deployed): ${named(changed)}`, upstream };
    const added = git('ls-files', '--others', '--exclude-standard', '--', ...paths);
    if (added.length) return { ok: false, why: `untracked code, not deployed: ${named(added)}`, upstream };
  } catch (e) { return { ok: false, why: `git: ${String(e.message).split('\n')[0]}`, upstream }; }
  const [owner, repo] = remoteUrl.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).slice(-2).map(hostLabel);
  return { ok: true, why: null, upstream, branch, ref: hostLabel(branch), owner, repo };
}
/** Deploy-state guard, per page: the gated host serves the pushed branch of the pushed repo → null, else why. */
export function hostServes(host, code) {
  const h = edsHostOf(host);
  if (!h) return `gated host ${host} is not an EDS <ref>--<repo>--<owner> host — what it serves cannot be proven`;
  if (h.ref !== code.ref) return `gated host serves ref ${h.ref}, the upstream branch is ${code.branch} (${code.ref})`;
  if (h.repo !== code.repo || h.owner !== code.owner) return `gated host serves ${h.owner}/${h.repo}, the upstream remote is ${code.owner}/${code.repo}`;
  return null;
}
/** webPath → { contentSha, status, verifiedOn, ts } of the newest row (by `ts`) across content/.deploy-ledger.json and stardust/deploy/ledger-*.json. */
export function deployedDocs(root = '.') {
  const dl = join(root, 'stardust/deploy');
  const files = [join(root, 'content/.deploy-ledger.json'), ...(existsSync(dl) ? readdirSync(dl).filter((f) => /^ledger-.*\.json$/.test(f)).map((f) => join(dl, f)) : [])];
  const newest = {};
  for (const f of files) {
    let ledger; try { ledger = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const [path, row] of Object.entries(ledger || {})) if (row && typeof row === 'object' && (!newest[path] || String(row.ts || '') > String(newest[path].ts || ''))) newest[path] = row;
  }
  return Object.fromEntries(Object.entries(newest).map(([path, row]) => [path, { contentSha: row.contentSha || null, status: row.status || null, verifiedOn: row.verifiedOn || null, ts: row.ts || null }]));
}
/**
 * Deploy-state guard, content half: every hashed document is the one the gated host serves — its newest ledger row
 * delivered (`live`; `previewed` too on a .page host) to the host's <owner>/<repo> (`verifiedOn`) with contentSha =
 * the file's sha256 → null, else why. A row without verifiedOn proves nothing.
 */
export function contentDeployed(content, docs, host = '') {
  const h = edsHostOf(host);
  if (!h) return `gated host ${host} is not an EDS <ref>--<repo>--<owner> host — the delivered documents cannot be proven`;
  const delivered = h.tier === 'page' ? ['live', 'previewed'] : ['live'];
  for (const [f, hash] of Object.entries(content)) {
    const web = f.replace(/^content/, '').replace(/\.html$/, ''); const row = docs[web];
    if (!row || !row.contentSha) return `${f}: no deploy-ledger contentSha for ${web}`;
    if (!delivered.includes(row.status)) return `${f}: the newest ledger row for ${web} is ${row.status}, not ${delivered.join(' / ')}`;
    if (!row.verifiedOn || row.verifiedOn.split('/').map(hostLabel).join('/') !== `${h.owner}/${h.repo}`) return `${f}: ledger ${web} was delivered to ${row.verifiedOn || 'an unrecorded org/repo (no verifiedOn)'}, not ${h.owner}/${h.repo}`;
    if (row.contentSha !== hash) return `${f} differs from the deployed document (ledger ${web})`;
  }
  return null;
}
/**
 * keyChanged(stored, current) — the stored EDS capture is NOT provably of what the gated host serves now, so it is
 * re-shot. `stored` = gate-key.json, `current` = this run's { gateKey, why, parts, upstream, deployed } (absent:
 * prototype stage, no keys → false). Reused only with the same known key, or — the key unknown now — the same hashed
 * tree (parts), the same reason it is unknown, the same upstream commit (any push re-shoots) and the same
 * deploy-ledger rows for the page's documents. No record
 * (a legacy dir) proves nothing → re-shot.
 */
export function keyChanged(stored, current) {
  if (!current) return false;
  if (!stored) return true;
  if (current.gateKey) return stored.gateKey !== current.gateKey;
  const same = stored.parts && current.parts && canon(stored.parts) === canon(current.parts) && stored.why === current.why && (stored.upstream ?? null) === (current.upstream ?? null) && canon(stored.deployed ?? null) === canon(current.deployed ?? null);
  return !same;
}
/**
 * --skip-existing reuse of one side's capture: on disk, not that side's --recapture-*, for EDS not a changed key, not a
 * capture taken with another hide list. ctx = { opts, has(p, side), keyChanged(p), hideChanged(p, side) }.
 */
export function skipCapture(p, side, { opts, has, keyChanged: changed, hideChanged = () => false }) {
  return !!opts.skip && !opts[side === 'eds' ? 'recaptureEds' : 'recaptureOrigin'] && !(side === 'eds' && changed(p)) && has(p, side) && !hideChanged(p, side);
}
/**
 * rowKey(stored, current, probedFresh) — the key a FRESH row is stamped with: its evidence's stored key only while it
 * is the current key; with the current key unknown, only when the row was measured under the same build part
 * (host, criteria, sidecars, instruments) and no probe ran afresh against the unproven deploy. Otherwise null.
 */
export function rowKey(stored, current, probedFresh = false) {
  if (!stored || !stored.gateKey || !current) return null;
  if (current.gateKey) return stored.gateKey === current.gateKey ? stored.gateKey : null;
  const same = stored.parts && current.parts && canon(stored.parts.build) === canon(current.parts.build);
  return same && !probedFresh ? stored.gateKey : null;
}
/** Latest row per slug (by _provenance.writtenAt) across <out>/summary.json and <out>/runs/*.json at this width → { slug: { row, from, at, prov } }. */
export function latestRows(out, width) {
  const runs = join(out, 'runs');
  const files = ['summary.json', ...(existsSync(runs) ? readdirSync(runs).filter((f) => f.endsWith('.json')).sort().map((f) => `runs/${f}`) : [])];
  const latest = {};
  for (const f of files) {
    let s; try { s = JSON.parse(readFileSync(join(out, f), 'utf8')); } catch { continue; }
    const at = s && s._provenance && s._provenance.writtenAt;
    if (!at || s._provenance.breakpoint !== width || !Array.isArray(s.rows)) continue;
    for (const row of s.rows) if (row && row.slug && (!latest[row.slug] || at > latest[row.slug].at)) latest[row.slug] = { row, from: f, at, prov: s._provenance };
  }
  return latest;
}
// The table's own record of what it evaluated equals this run's criteria (the key carries them too; this is the table's word).
const sameCriteria = (prov, opts) => !!prov && prov.stage === 'published' && prov.threshold === opts.threshold && prov.heightTolerance === opts.heightTol && prov.clipMax === opts.clipMax && prov.unitTol === opts.unitTol && !!prov.criteria && prov.criteria.clip === opts.clip && prov.criteria.content === opts.content;
/**
 * rowReuse({ prior, gateKey, edsPng, override, opts }) → the prior row again, marked `reused`, or null. Only under
 * --skip-existing on the published stage without --recapture-*, with a known current key equal to the row's, a
 * PASS (not an override) from a table written under this run's criteria and the page's eds.png on disk. `at` stays
 * the time the row was measured.
 */
export function rowReuse({ prior, gateKey, edsPng, override = null, opts }) {
  if (!opts.skip || opts.stage !== 'published' || opts.recaptureEds || opts.recaptureOrigin || !gateKey || !prior || !edsPng) return null;
  const { row } = prior;
  if (row.gateKey !== gateKey || row.pass !== true || !sameCriteria(prior.prov, opts)) return null;
  const at = row.reused && row.reused.what === 'row' ? row.reused.at : prior.at;
  return { ...row, override, passWithOverride: row.pass || !!override, reused: { what: 'row', from: prior.from, at, gateKey } };
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (cands) => cands.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const DIFF_DIR = firstExisting(['../../diff/scripts', '../diff']);
const { unitsFor } = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'unit-geometry.mjs')).href) : { unitsFor: () => [] };
const FRESH = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'live-session.mjs')).href) : null;

// ---- origin reuse (pure): `fresh` = live-session.mjs freshness() of the capture's `at` ---------------------------
/**
 * May a fix round keep <out>/<slug>/origin.png? → { reuse, why } (why = the policy when reused). `hide` = this run's
 * presence.json hide list for the page; origin.json's `hide` (absent = []) must be the same list.
 */
export function originReusePlan({ stage, only, recaptureEds, recaptureOrigin, url, width, vh, hide = [] }, prev, fresh) {
  const no = (why) => ({ reuse: false, why });
  if (stage !== 'published') return no(`${stage} stage`);
  if (recaptureOrigin) return no('--recapture-origin');
  if (!((only && only.length) || recaptureEds)) return no('full round');
  if (!prev) return no('no previous origin capture');
  if (prev.instrument !== 'stitch-live' || prev.error) return no(`previous origin is ${prev.instrument}${prev.error ? ` (${prev.error})` : ''}`);
  if (prev.url !== url) return no(`url changed (${prev.url})`);
  if ((prev.width ?? width) !== width) return no(`width ${prev.width}`);
  if ((prev.locale ?? 'en-US') !== 'en-US') return no(`locale ${prev.locale}`);
  if ((prev.vh ?? null) !== (vh ?? null)) return no(`vh ${prev.vh ?? 'default'}`);
  if (!sameHide(prev.hide, hide)) return no('hide list differs');
  if (!fresh || !fresh.fresh) return no((fresh && fresh.reason) || 'no freshness verdict');
  return { reuse: true, why: fresh.policy };
}
/**
 * May the published stage take the archetype round's gates/<slug>-<w>/live.png? `liveMeta` = its live.json (gate.sh).
 * Symmetric capture: every parameter must be the one gate-all's own origin stitch would use (url, width, --vh, en-US,
 * --settle, the built-in dismissal only — no site consent / extra selectors —, the default UA, the same hide list: live.json
 * `hide`, absent = []). The one deliberate difference: live.png is headless bundled Chromium (the EDS side's tier),
 * recorded as `headed: false` in origin.json.
 */
export function liveReusePlan({ stage, recaptureOrigin, url, width, vh, hide = [] }, liveMeta, fresh) {
  const no = (why) => ({ reuse: false, why });
  if (stage !== 'published') return no(`${stage} stage`);
  if (recaptureOrigin) return no('--recapture-origin');
  if (!liveMeta) return no('no live.json');
  if (liveMeta.url !== url || liveMeta.width !== width) return no('live.json url / width differ');
  if ((liveMeta.vh ?? null) !== (vh ?? null)) return no(vh != null ? '--vh set (live.png uses the default viewport)' : `live.json vh ${liveMeta.vh}`);
  if (liveMeta.locale !== 'en-US') return no(`live.json locale ${liveMeta.locale}`);
  if (liveMeta.settle !== true) return no('live.json not settled');
  const dm = liveMeta.dismiss;
  if (!dm || dm.off !== false) return no('live.json overlays not dismissed');
  if (dm.consent != null || dm.extra != null) return no(`live.json dismissed site selectors (consent ${dm.consent}, extra ${dm.extra}) gate-all's stitch does not use`);
  if (liveMeta.ua != null) return no('live.json custom user agent');
  if (!sameHide(liveMeta.hide, hide)) return no('live.json hide list differs');
  if (!fresh || !fresh.fresh) return no((fresh && fresh.reason) || 'no freshness verdict');
  return { reuse: true, why: fresh.policy };
}

// ---- one load (--one-load, pure): each side's stitch takes the probes' inventories (stitch-shot --inventory) -------
/**
 * Why a side's <side>-inventory.json cannot stand in for its probes (null = usable): `meta` = origin.json / eds.json,
 * `inv` = the inventory, `want` = this run's spec blocks for the side. It must be the one taken with that very capture
 * (meta.inventoryAt = inv.at), of this URL, without error, every block `want` asks for taken with the same settings.
 */
export function inventoryWhy(meta, inv, url, want = {}) {
  if (!meta) return 'no capture';
  if (meta.error) return `capture failed: ${meta.error}`;
  if (meta.instrument !== 'stitch-live') return `${meta.instrument} capture`;
  if (!meta.inventory || !meta.inventoryAt) return meta.inventoryError ? `not taken: ${meta.inventoryError}` : 'captured without one';
  if (!inv) return `${meta.inventory} missing`;
  if (inv.error) return `inventory failed: ${inv.error}`;
  if (inv.at !== meta.inventoryAt) return 'the inventory on disk is not the one taken with this capture';
  if (inv.url !== url) return `taken of ${inv.url}`;
  const other = ['presence', 'clip', 'units'].find((k) => want[k] && canon((inv.spec || {})[k] ?? null) !== canon(want[k]));
  return other ? `taken with other ${other} settings` : null;
}
/** --one-load: a kept origin must be a one-load capture too — headed real Chrome with its inventory (`invWhy` null). */
export function oneLoadKeep(plan, prev, invWhy) {
  if (!plan.reuse) return plan;
  if (!prev || prev.headed !== true) return { reuse: false, why: `one-load: not a headed real-Chrome capture (headed: ${prev ? prev.headed : 'unknown'})` };
  return invWhy ? { reuse: false, why: `one-load: no inventory (${invWhy})` } : plan;
}
/** The probes' own report builders, loaded only under --one-load (gate-all composes content / clip / units in-process). */
async function oneLoadLib() {
  const [cp, clip, ug] = await Promise.all(['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => import(pathToFileURL(join(DIFF_DIR, f)).href)));
  return { presenceReport: cp.presenceReport, clipReport: clip.clipReport, unitsReport: ug.unitsReport };
}

const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

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
  const startedAt = new Date().toISOString(); // this process's start (gate-key.json); runStart below is the run anchor
  if (!existsSync(opts.state)) { console.error(`gate-all: ${opts.state} not found — run from the project root or pass --state`); process.exit(1); }
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = readJson(opts.state);
  const pages = selectPages(state, opts);
  if (opts.stage === 'prototype' && !opts.protoBase) console.error('gate-all: --stage prototype without --proto-base — assuming http://localhost:8791 (serve the prototypes dir there, replica SKILL.md § Phase 4)');
  if (!pages.length) { console.error(emptySelection(state, { stage: opts.stage, only: opts.only, statePath: resolve(opts.state) })); process.exit(1); }
  // Deadline guard: a run-bg deadline below the estimate would kill the job mid-roster — refuse before any write.
  const R = roster(pages.length, opts);
  if (opts.deadlineSec && opts.deadlineSec < R.estimatedSeconds) { console.error(`gate-all: refused to start, no verdict — ${rosterText(R)} need an estimated ${R.estimatedSeconds} s (${ESTIMATE_SEC_PER_PAGE} s per page per width), above this job's run-bg deadline of ${opts.deadlineSec} s (RUN_BG_DEADLINE_SEC); re-start the job with run-bg.mjs start --timeout ${R.estimatedSeconds} …, or omit --timeout: run-bg sizes a gate-all job's deadline to this estimate`); process.exit(2); }
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  const CLIP_ALLOW = readJson(join(opts.out, 'clip-allow.json'), {}); const PRESENCE = readJson(join(opts.out, 'presence.json'), {});
  const FAMILIES = readJson('stardust/replica/units.json', null);
  const UNITS = readJson(opts.units || join(opts.out, 'units.json'), {});
  const unitsOf = (p) => (FAMILIES ? unitsFor(FAMILIES, p.slug, p.template) : ((UNITS[p.slug] || {}).units || []).map((x) => ({ origin: x.origin, eds: x.eds || x.origin, n: x.n || 1, required: x.required !== false })));
  const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); writeFileSync(join(opts.out, '_run.log'), `${line}\n`, { flag: 'a' }); };
  log(`roster: ${rosterText(R)} — estimated ${R.estimatedSeconds} s (${ESTIMATE_SEC_PER_PAGE} s per page per width)${opts.deadlineSec ? `; run-bg deadline ${opts.deadlineSec} s` : ''}`);
  // One run anchor per process (every row of the run judged against it); --origin-max-age reaches the probes via the env.
  const ledger = join(dirname(opts.state), 'status.jsonl');
  const runStart = FRESH ? FRESH.runStartAt({ ledger }) : null;
  const maxAgeH = opts.originMaxAge ?? (FRESH ? FRESH.maxAgeHours() : null);
  if (opts.originMaxAge != null) process.env.STARDUST_ORIGIN_MAX_AGE_H = String(opts.originMaxAge);
  const fresh = (m) => (FRESH ? FRESH.freshness(m, { runStart, maxAgeH, ledger }) : { fresh: false, policy: null, reason: 'no freshness policy (diff scripts dir not found)' });
  const reuseOf = (from, m, policy) => ({ ...(FRESH ? FRESH.reuseRecord(from, m, { policy }) : { reused: true, from, at: m.at, policy }), reusedAt: new Date().toISOString() });
  const tryJson = (f) => { try { return readJson(f); } catch { return null; } };
  log(`origin reuse: ${!FRESH ? 'off (live-session.mjs not found in the diff scripts dir)' : runStart ? `same run since ${runStart}` : `no run anchor in ${ledger} (reuse only with --origin-max-age)`}${FRESH && maxAgeH ? `; captures up to ${maxAgeH}h old` : ''}; pools origin ${opts.oc} / eds ${opts.ec} / probe ${opts.pc}${opts.browserSlot ? ' (machine browser slot held)' : ''}`);
  // presence.json `hide` → the page's one list (live-session presenceHide: "*" then the slug's) for both stitches and the probes
  const HIDE_OK = !!FRESH && typeof FRESH.presenceHide === 'function';
  const hideOf = (p) => (HIDE_OK ? FRESH.presenceHide(PRESENCE, p.slug) : []);
  const hideArgs = (p) => { const h = hideOf(p); return h.length ? ['--hide', h.join(',')] : []; };
  if (!HIDE_OK && Object.values(PRESENCE || {}).some((e) => e && typeof e === 'object' && e.hide != null)) log('presence hide: not honoured — the diff scripts dir has no live-session.mjs with presenceHide; captures and probes run without hides');
  const dir = (p) => join(opts.out, p.slug);
  const edsUrl = (p) => (opts.edsHost ? p.liveUrl.replace(/^https?:\/\/[^/]+/, opts.edsHost) : p.liveUrl);
  const results = {};
  const rec = (p, k, v) => { results[p.slug] = { ...(results[p.slug] || {}), [k]: v }; };
  const stitchArgs = (url, out, { inventory, hide = [] } = {}) => [STITCH, url, out, '--width', String(opts.width), '--settle', '--locale', 'en-US', ...(opts.vh ? ['--vh', String(opts.vh)] : []), ...(hide.length ? ['--hide', hide.join(',')] : []), ...(inventory ? ['--inventory', inventory] : [])];
  // --one-load: every stitch (both sides headed real Chrome) also takes the probes' inventories of the page it loaded;
  // --warmup needs a navigation of its own, so it turns the captures back to the probes' path.
  const OL = !!opts.oneLoad && !opts.warmup && !!DIFF_DIR;
  const LIB = OL ? await oneLoadLib() : null;
  if (opts.oneLoad && !OL) log(`one-load: off for this run (${opts.warmup ? '--warmup needs its own navigation' : 'no diff scripts dir'}) — the probes run as without --one-load`);
  /** A side's inventory spec blocks — the split content-presence's --main / --variable and unit-geometry's --unit make. */
  function specFor(p, side) {
    const pr = PRESENCE[p.slug] || {}; const units = unitsOf(p);
    const half = (s) => { const [o, e] = String(s).split('='); return side === 'origin' ? o : e || o; };
    return {
      presence: opts.content ? { rootSel: pr.main ? half(pr.main) : null, variableSels: (pr.variable || []).join(',').split(',').map((x) => x.trim()).filter(Boolean).map(half), countWords: null, moreWords: null, minCut: 2 } : null,
      clip: opts.clip || opts.content ? { minCut: 2, maxFindings: 400, moreWords: null } : null,
      units: units.length ? { sels: units.map((u) => (side === 'origin' ? u.origin : u.eds).trim()), n: Math.max(...units.map((u) => u.n)) } : null,
    };
  }
  function inventorySpec(p, side) {
    const f = join(dir(p), `${side}-inventory.spec.json`);
    writeFileSync(f, JSON.stringify({ out: join(dir(p), `${side}-inventory.json`), side, ...specFor(p, side) }, null, 1));
    return f;
  }
  // The capture meta's record of its inventory: only one written by this stitch (at or after `since`) and without error.
  function inventoryMeta(p, side, since) {
    const f = `${side}-inventory.json`; const inv = tryJson(join(dir(p), f));
    if (inv && !inv.error && inv.at >= since) return { inventory: f, inventoryAt: inv.at };
    return { inventoryError: !inv ? `${f} not written` : inv.error || `${f} predates this capture` };
  }
  const sideInventory = (p, side, url) => { const inv = readSafe(join(dir(p), `${side}-inventory.json`)); return { inv, why: inventoryWhy(readSafe(join(dir(p), `${side}.json`)), inv, url, specFor(p, side)) }; };
  const keepOneLoad = (plan, p, prev) => (OL ? oneLoadKeep(plan, prev, plan.reuse && prev ? sideInventory(p, 'origin', p.url).why : null) : plan);

  async function captureOrigin(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'origin.png'); const meta = join(d, 'origin.json');
    const keep = (r, line) => { writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'origin', r); log(line); };
    const prevAt = (tryJson(meta) || {}).at ?? null; // the origin capture's identity before this run touches it
    const hide = hideOf(p);
    if (skipCapture(p, 'origin', capCtx)) {
      // --skip-existing never recaptures; the reuse is recorded, with a WARN when the capture predates the run
      const kept = readJson(meta); const f = fresh(kept);
      keep({ ...kept, ...reuseOf(out, kept, 'skip-existing'), stale: f.fresh ? undefined : f.reason }, `origin ${p.slug} → reused (--skip-existing)${f.fresh ? ` (captured ${kept.at}; ${f.policy})` : ` WARN ${f.reason}`}`);
      return;
    }
    if (hideMoved(p, 'origin')) log(`origin ${p.slug} → not reused (--skip-existing: hide list differs)`);
    // a fix round keeps this run's origin (originReusePlan); the capture time `at` is kept, the reuse added
    const prev = existsSync(out) && existsSync(meta) ? tryJson(meta) : null;
    const plan = keepOneLoad(originReusePlan({ stage: opts.stage, only: opts.only, recaptureEds: opts.recaptureEds, recaptureOrigin: opts.recaptureOrigin, url: p.url, width: opts.width, vh: opts.vh, hide }, prev, prev && fresh(prev)), p, prev);
    if (plan.reuse) { keep({ ...prev, stale: undefined, ...reuseOf(out, prev, plan.why) }, `origin ${p.slug} → reused ${out} (captured ${prev.at}; ${plan.why})`); return; }
    if (prev && (opts.only || opts.recaptureEds) && opts.stage === 'published') log(`origin ${p.slug} → not reused (${plan.why})`);
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    const cachedLive = join('stardust/replica/gates', `${p.slug}-${opts.width}`, 'live.png');
    const lm = existsSync(cachedLive) ? tryJson(cachedLive.replace(/\.png$/, '.json')) : null;
    const lp = keepOneLoad(liveReusePlan({ stage: opts.stage, recaptureOrigin: opts.recaptureOrigin, url: p.url, width: opts.width, vh: opts.vh, hide }, lm, lm && fresh(lm)), p, lm);
    if (opts.stage === 'published' && existsSync(cachedLive) && !lp.reuse) log(`origin ${p.slug} → live.png not reused (${lp.why})`);
    let r; let warn = null;
    // --one-load: the archetype round's live.png is headless bundled Chromium, not a one-load capture (both stages)
    if (OL && opts.stage === 'prototype' && existsSync(cachedLive)) log(`origin ${p.slug} → live.png not reused (one-load: not a headed real-Chrome capture)`);
    // the prototype stage takes the archetype round's live.png only when it hid the same list (live.json `hide`, absent = [])
    const protoLive = opts.stage === 'prototype' && existsSync(cachedLive) && !OL;
    if (protoLive && !sameHide(lm && lm.hide, hide)) log(`origin ${p.slug} → live.png not reused (live.json hide list differs)`);
    if (protoLive && sameHide(lm && lm.hide, hide)) {
      copyFileSync(cachedLive, out);
      const lat = { at: (lm && lm.at) || statSync(cachedLive).mtime.toISOString() }; const f = fresh(lat);
      r = { instrument: 'stitch-live', note: `reused ${cachedLive} (the archetype round's capture — hit minimisation)`, ...reuseOf(cachedLive, lat, 'prototype-stage'), stale: f.fresh ? undefined : f.reason, ...hideField(hide) };
    }
    else if (lp.reuse) { copyFileSync(cachedLive, out); r = { instrument: 'stitch-live', url: p.url, width: opts.width, locale: 'en-US', headed: false, ...reuseOf(cachedLive, lm, lp.why), note: 'archetype round capture (gate.sh; bundled Chromium — the EDS side\'s tier in legacy mode)', ...hideField(hide) }; }
    else if (opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked) {
      if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `origin matches --blocked ${opts.blocked}; crawl screenshot used (lazy rails may be placeholders)` }; }
      else r = { instrument: 'none', error: `origin blocked and no crawl shot at ${crawlShot}` };
    } else {
      const t0 = new Date().toISOString();
      const s = await run('node', [...stitchArgs(p.url, out, { hide, ...(OL ? { inventory: inventorySpec(p, 'origin') } : {}) }), '--headed']);
      if (s.code === 0) r = { instrument: 'stitch-live', url: p.url, width: opts.width, locale: 'en-US', vh: opts.vh || null, headed: true, log: s.out.trim().split('\n').slice(-2), ...(OL ? inventoryMeta(p, 'origin', t0) : {}), ...hideField(hide) };
      else if (existsSync(out) && existsSync(meta) && opts.recaptureOrigin) {
        // the previous origin stays in use: a recorded reuse (stale when it predates the run), never a silent one
        const kept = readJson(meta); const f = fresh(kept);
        warn = `re-shoot failed (exit ${s.code}: ${lastLine(s.err)}) — previous origin kept`;
        r = { ...kept, ...reuseOf(out, kept, f.fresh ? f.policy : 'recapture-failed'), stale: f.fresh ? undefined : f.reason, note: warn };
      }
      else if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `stitch exit ${s.code}: ${lastLine(s.err)} — crawl screenshot used` }; }
      else r = { instrument: 'none', error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    }
    if (!r.at && !r.reused) r.at = new Date().toISOString(); // a reuse keeps its capture time: the evidence time
    // another origin capture (its `at` changed — a new stitch, a crawl shot or a copied live.png) → the presence inventory
    // of the previous one goes (its text boxes are applied to origin.png); unit-geometry's origin cache is applied to no
    // image — its own freshness rule governs it
    if (r.at !== prevAt) rmSync(join(d, 'presence-origin.json'), { force: true });
    writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'origin', r);
    const warns = [warn, r.stale].filter(Boolean);
    log(`origin ${p.slug} → ${r.instrument}${r.reused ? ` reused ${r.from} (captured ${r.at}; ${r.policy})` : ''}${warns.length ? ` WARN ${warns.join('; ')}` : ''}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  async function captureEds(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'eds.png'); const meta = join(d, 'eds.json');
    if (skipCapture(p, 'eds', capCtx)) { rec(p, 'eds', readJson(meta)); return; }
    if (hideMoved(p, 'eds')) log(`eds ${p.slug} → not reused (--skip-existing: hide list differs)`);
    const t0 = new Date().toISOString(); const hide = hideOf(p);
    const s = await run('node', [...stitchArgs(edsUrl(p), out, { hide, ...(OL ? { inventory: inventorySpec(p, 'eds') } : {}) }), ...(OL ? ['--headed'] : [])]);
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p), ...(OL ? { headed: true, ...inventoryMeta(p, 'eds', t0) } : {}), ...hideField(hide) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  const readSafe = (f) => { try { return readJson(f); } catch { return null; } };
  const probeCtx = { opts, edsUrl, presence: PRESENCE, unitsOf, hideOf };
  // Gate keys (published stage), once per run before any capture; the deploy-state guard's code half is one git call set.
  const KEYS = {};
  if (opts.stage === 'published') {
    let foundation; let shared; let chrome; let broken = null;
    try { foundation = foundationPart('.'); } catch (e) { foundation = { paths: FOUNDATION_PATHS }; broken = `foundation: ${e.message}`; }
    const codePaths = [...foundation.paths, ...RUNTIME_PATHS, 'blocks/'];
    const code = codeDeployed(codePaths); const docs = deployedDocs('.');
    const coverage = Object.fromEntries(((readSafe('stardust/rollout/coverage/pages.json') || {}).pages || []).filter((x) => x && x.slug && Array.isArray(x.blocks)).map((x) => [x.slug, x.blocks]));
    try { shared = sharedBlocks('.', coverage); chrome = chromeDocs('.'); } catch (e) { broken = broken || `blocks / chrome documents: ${e.message}`; }
    for (const p of pages) {
      let k = { parts: null, why: broken };
      if (!broken) try { k = gateKeyParts(p, { ...probeCtx, masks: MASKS, clipAllow: CLIP_ALLOW, foundation, coverage, shared, chrome }); } catch (e) { k = { parts: null, why: `gate key: ${e.message}` }; }
      const host = k.parts && new URL(k.parts.build.origin).host;
      const why = k.why || code.why || hostServes(host, code) || contentDeployed(k.parts.content, docs, host);
      const deployed = k.parts ? Object.fromEntries(Object.keys(k.parts.content).map((f) => { const web = f.replace(/^content/, '').replace(/\.html$/, ''); return [web, docs[web] || null]; })) : null;
      KEYS[p.slug] = { gateKey: why ? null : gateKeyOf(k.parts), why, parts: k.parts, upstream: code.upstream || null, deployed };
    }
    const na = pages.filter((p) => !KEYS[p.slug].gateKey);
    if (na.length) log(`gate key n/a for ${na.length}/${pages.length} page(s) — ${[...new Set(na.map((p) => KEYS[p.slug].why))].slice(0, 3).join('; ')} (no row reuse; their EDS side is re-shot unless gate-key.json records the same tree, reason, upstream commit and ledger rows)`);
  }
  const storedKey = (p) => readSafe(join(dir(p), 'gate-key.json'));
  const currentKey = (p) => (KEYS[p.slug] ? KEYS[p.slug].gateKey : null);
  const capCtx = { opts, has: (p, side) => existsSync(join(dir(p), `${side}.png`)) && existsSync(join(dir(p), `${side}.json`)), keyChanged: (p) => keyChanged(storedKey(p), KEYS[p.slug]),
    // a stitched capture records the hide list it was taken with (absent = none); a crawl shot can hide nothing
    hideChanged: (p, side) => { const m = readSafe(join(dir(p), `${side}.json`)); return !!m && m.instrument === 'stitch-live' && !sameHide(m.hide, hideOf(p)); } };
  // --skip-existing would have kept the capture but for its hide list (logged, then re-shot)
  const hideMoved = (p, side) => skipCapture(p, side, { ...capCtx, hideChanged: undefined }) && capCtx.hideChanged(p, side);
  // The post-spawn record of each probe, shared by the fresh and the replayed path so both build the same row.
  function recordContent(p, content, pr) {
    const d = dir(p);
    rec(p, 'content', { totals: content.totals, scope: content.scope, variable: pr.variable || [], reason: pr.reason || null, tier: content._provenance.tier || null });
    rec(p, 'clip', { counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: content.origin.clip.counts, source: 'content-presence' });
    writeFileSync(join(d, 'clip.json'), JSON.stringify({ url: edsUrl(p), at: content._provenance.at, source: 'content-presence', counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: { counts: content.origin.clip.counts } }, null, 1));
    if (content.textBoxes && content.textBoxes.origin) writeFileSync(join(d, 'text-boxes.json'), JSON.stringify({ side: 'origin', boxes: content.textBoxes.origin }));
    log(`content ${p.slug} → MISSING ${content.totals.missing} HIDDEN ${content.totals.hidden} state ${content.totals.controlState}; clipped ${content.eds.clip.counts.total}`);
    const oc = content._provenance && content._provenance.originCache; // content-presence --origin-cache hit: a recorded reuse
    if (oc) { rec(p, 'presenceReused', { from: oc.file, at: oc.at, policy: oc.policy }); log(`content ${p.slug} → origin inventory reused ${oc.file} (probed ${oc.at}; ${oc.policy})`); }
  }
  function recordClip(p, clip) { rec(p, 'clip', { counts: clip.counts, groups: clip.groups, source: 'clip-probe', tier: clip.tier || null }); log(`clip ${p.slug} → ${clip.counts.total}`); }
  function recordUnits(p, res, required) {
    rec(p, 'units', { verdict: res.verdict, required }); log(`units ${p.slug} → off ${res.verdict.off} hidden ${res.verdict.hidden} missing ${res.verdict.missing}`);
    const oc = res.originCache; // unit-geometry's per-width origin cache hit: a recorded reuse
    if (oc && oc.hit) { rec(p, 'unitsReused', { from: oc.file, at: oc.at, policy: oc.policy }); log(`units ${p.slug} → origin inventory reused ${oc.file} (probed ${oc.at}; ${oc.policy})`); }
  }
  /**
   * --one-load: content.json / clip.json / units.json from the two stitches' inventories with the probes' own report
   * builders, recorded through the same recorders → true. A needed side without a usable inventory (or --warmup)
   * → false, logged `one-load <slug> → fallback: <why>`, and the probes run as without --one-load.
   */
  function oneLoadProbe(p, units) {
    const needO = opts.content || units.length > 0; const needE = needO || opts.clip;
    if (!needE) return false;
    const fallback = (why) => { rec(p, 'oneLoad', { via: 'probes', fallback: why }); log(`one-load ${p.slug} → fallback: ${why}`); return false; };
    if (!OL) return fallback(opts.warmup ? '--warmup set (the warm-up needs its own navigation)' : 'no diff scripts dir');
    const o = needO ? sideInventory(p, 'origin', p.url) : { inv: null, why: null };
    if (o.why) return fallback(`no origin inventory (${o.why})`);
    const e = sideInventory(p, 'eds', edsUrl(p));
    if (e.why) return fallback(`no EDS inventory (${e.why})`);
    const d = dir(p); const tier = !o.inv || o.inv.tier === e.inv.tier ? e.inv.tier : `${o.inv.tier}/${e.inv.tier}`;
    const pairs = units.map((u) => ({ origin: u.origin.trim(), eds: u.eds.trim() })); // unit-geometry --unit's pairs
    const unitInv = (inv) => ({ url: inv.url, at: inv.at, docH: inv.docH, bySel: inv.units.bySel });
    let rep;
    try {
      rep = {
        content: opts.content ? LIB.presenceReport(o.inv, e.inv, { width: opts.width, variable: specFor(p, 'origin').presence.variableSels, chrome: false, tier, via: 'one-load' }) : null,
        clip: opts.clip && !opts.content ? LIB.clipReport({ docH: e.inv.docH, pageW: e.inv.pageW, counts: e.inv.clip.counts, findings: e.inv.clip.findings, textBoxes: e.inv.textBoxes }, { url: edsUrl(p), width: opts.width, tier: e.inv.tier, at: e.inv.at }) : null,
        units: pairs.length ? LIB.unitsReport(unitInv(o.inv), unitInv(e.inv), pairs, { tol: opts.unitTol, n: Math.max(...units.map((u) => u.n)), width: opts.width, tier }) : null,
      };
    } catch (err) { return fallback(`inventories not composable (${String(err.message).split('\n')[0]})`); }
    const write = (k) => writeFileSync(join(d, `${k}.json`), JSON.stringify(rep[k], null, 1));
    if (rep.content) { write('content'); recordContent(p, rep.content, PRESENCE[p.slug] || {}); }
    if (rep.clip) { write('clip'); recordClip(p, rep.clip); }
    if (rep.units) { write('units'); recordUnits(p, rep.units, units.some((x) => x.required)); }
    rec(p, 'oneLoad', { via: 'one-load', origin: o.inv ? o.inv.at : null, eds: e.inv.at });
    log(`one-load ${p.slug} → probes from the stitches' inventories (origin ${o.inv ? o.inv.at : 'not needed'}, EDS ${e.inv.at}; ${tier})`);
    return true;
  }
  async function probe(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const pr = PRESENCE[p.slug] || {};
    const inputs = probeInputs(p, probeCtx); const { units } = inputs;
    if (opts.skip) {
      const files = { content: readSafe(join(d, 'content.json')), clip: readSafe(join(d, 'clip.json')), units: readSafe(join(d, 'units.json')) };
      const originMeta = readSafe(join(d, 'origin.json')); const edsMeta = readSafe(join(d, 'eds.json'));
      const reuse = probeReuse({ sidecar: readSafe(join(d, 'probes.json')), inputs, originMeta, edsMeta, files, opts });
      if (reuse.reuse) {
        if (inputs.content) recordContent(p, files.content, pr);
        if (inputs.clip && !(results[p.slug] && results[p.slug].clip)) recordClip(p, files.clip);
        if (units.length) recordUnits(p, files.units, units.some((x) => x.required));
        rec(p, 'probesReused', reuse.at);
        log(`probes ${p.slug} → reused (taken ${reuse.at}; origin ${originMeta.at}, eds ${edsMeta.at})`);
        return;
      }
      log(`probes ${p.slug} → re-run (${reuse.why})`);
    }
    const at = new Date().toISOString();
    const oneLoaded = opts.oneLoad && oneLoadProbe(p, units); // --one-load: the stitches' inventories, else the probes below
    if (!oneLoaded && opts.content) {
      const args = [join(DIFF_DIR, 'content-presence.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--json', join(d, 'content.json')];
      if (pr.variable && pr.variable.length) args.push('--variable', pr.variable.join(','));
      if (pr.main) args.push('--main', pr.main);
      args.push(...hideArgs(p));
      if (opts.warmup) args.push('--warmup', opts.warmup);
      args.push('--origin-cache', join(d, 'presence-origin.json'));
      const s = await run('node', args);
      const content = readJson(join(d, 'content.json'));
      if (content && (s.code === 0 || s.code === 2)) recordContent(p, content, pr);
      else {
        const why = s.code === 3 ? 'origin bot challenge' : s.code === 4 ? `origin ${lastLine(s.err).replace(/^content-presence error: /, '')}` : `content-presence exit ${s.code}: ${lastLine(s.err)}`;
        rec(p, 'content', { error: why });
        log(`content ${p.slug} → n/a (${why})`);
      }
    }
    if (!oneLoaded && opts.clip && !(results[p.slug] && results[p.slug].clip)) {
      const s = await run('node', [join(DIFF_DIR, 'clip-probe.mjs'), edsUrl(p), '--width', String(opts.width), '--json', join(d, 'clip.json'), ...hideArgs(p)]);
      const clip = readJson(join(d, 'clip.json'));
      if (clip && (s.code === 0 || s.code === 2)) recordClip(p, clip);
      else { rec(p, 'clip', { error: `clip-probe exit ${s.code}: ${lastLine(s.err)}` }); log(`clip ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    if (!oneLoaded && units.length) {
      const args = [join(DIFF_DIR, 'unit-geometry.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--tol', String(opts.unitTol), '--n', String(Math.max(...units.map((x) => x.n))), '--json', join(d, 'units.json'), '--slug', p.slug];
      for (const x of units) args.push('--unit', `${x.origin}=${x.eds}`);
      if (opts.warmup) args.push('--warmup', opts.warmup);
      const s = await run('node', args);
      const res = readJson(join(d, 'units.json'));
      const required = units.some((x) => x.required);
      if (res && (s.code === 0 || s.code === 2)) recordUnits(p, res, required);
      else { rec(p, 'units', { error: `unit-geometry exit ${s.code}: ${lastLine(s.err)}`, required }); log(`units ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    // probes.json: what these probes were taken with and when — the replay record for the next --skip-existing run.
    const r = results[p.slug] || {}; const state = (x) => (x ? (x.error ? 'error' : 'ok') : null);
    const done = { content: state(r.content), clip: state(r.clip), units: state(r.units) };
    const ats = Object.fromEntries(Object.keys(done).map((k) => [k, done[k] === 'ok' ? PROBE_AT[k](readSafe(join(d, `${k}.json`))) || null : null]));
    const pair = Object.fromEntries(['origin', 'eds'].map((side) => [side, (readSafe(join(d, `${side}.json`)) || {}).at || null]));
    writeFileSync(join(d, 'probes.json'), JSON.stringify({ at, inputs, results: done, ats, pair }, null, 1));
    if (Object.values(done).some(Boolean)) rec(p, 'probedAt', at);
  }
  async function compare(p) {
    const d = dir(p);
    if (!existsSync(join(d, 'origin.png')) || !existsSync(join(d, 'eds.png'))) { rec(p, 'pixel', { error: 'missing capture' }); return; }
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

  // A PASS row whose gate key holds is reused whole: the page leaves all three pools.
  const REUSED = {};
  const prior = opts.skip && opts.stage === 'published' ? latestRows(opts.out, opts.width) : {};
  for (const p of pages) {
    const row = rowReuse({ prior: prior[p.slug], gateKey: currentKey(p), edsPng: existsSync(join(dir(p), 'eds.png')), override: OVERRIDES[p.slug] ?? null, opts });
    if (row) { REUSED[p.slug] = row; log(`row ${p.slug} → reused (gate key ${row.gateKey.slice(0, 12)} unchanged; measured ${row.reused.at}, ${row.reused.from})`); }
  }
  const todo = pages.filter((p) => !REUSED[p.slug]);
  if (!opts.compareOnly) {
    await Promise.all([pool(todo, opts.oc, captureOrigin), pool(todo, opts.ec, captureEds)]);
    // gate-key.json = the key of the EDS capture taken in this run (null while unknown or when the capture failed).
    for (const p of todo) {
      const k = KEYS[p.slug]; const m = readSafe(join(dir(p), 'eds.json'));
      if (k && m && m.at >= startedAt) writeFileSync(join(dir(p), 'gate-key.json'), JSON.stringify({ gateKey: m.error ? null : k.gateKey, why: m.error ? `EDS capture failed: ${m.error}` : k.why, parts: k.parts, upstream: k.upstream, deployed: k.deployed, at: m.at }, null, 1));
    }
  } else for (const p of todo) for (const side of ['origin', 'eds']) { const m = readJson(join(dir(p), `${side}.json`)); if (m) rec(p, side, m); }
  if (opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length) await pool(todo, opts.pc, probe);
  await pool(todo, 4, compare);

  const rows = pages.map((p) => {
    if (REUSED[p.slug]) return REUSED[p.slug];
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip && r.clip.counts ? r.clip : null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0 }, { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content });
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument,
      originReused: r.origin && r.origin.reused ? { from: r.origin.from, at: r.origin.at, policy: r.origin.policy, stale: r.origin.stale || null } : null,
      presenceReused: r.presenceReused || null, unitsReused: r.unitsReused || null, ...(opts.oneLoad ? { oneLoad: r.oneLoad || null } : {}), ...hideField(hideOf(p)),
      pct: px.pct ?? null, textPct: px.textPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      browser: (r.content && r.content.tier) || (r.clip && r.clip.tier) || null,
      override: OVERRIDES[p.slug] || null, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null,
      gateKey: opts.stage === 'published' ? rowKey(storedKey(p), KEYS[p.slug], !!r.probedAt) : null, reused: r.probesReused ? { what: 'probes', at: r.probesReused } : null };
  });
  const n = (f) => rows.filter(f).length;
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && r.override), fail: n((r) => !r.pass && r.pct != null), error: n((r) => r.pct == null),
    failPixel: n((r) => r.pct != null && !r.pixelPass), failHeight: n((r) => r.pct != null && !r.heightPass), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric), degradedTier: n((r) => r.browser && r.browser !== 'chrome'),
    reusedRows: n((r) => r.reused && r.reused.what === 'row'), reusedProbes: n((r) => r.reused && r.reused.what === 'probes') };
  totals.passWithOverrides = totals.pass + totals.overridePass;
  totals.originReused = n((r) => r.originReused);
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: new Date().toISOString(), stage: opts.stage, breakpoint: opts.width, threshold: opts.threshold, heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `overlap pixel % ≤ ${opts.threshold} AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, only: opts.only, reuse: { rows: totals.reusedRows, probes: totals.reusedProbes } }, totals, rows };
  const md = formatSummary(summary);
  if (opts.only) { mkdirSync(join(opts.out, 'runs'), { recursive: true }); const f = join(opts.out, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${opts.only[0]}.json`); writeFileSync(f, JSON.stringify(summary, null, 2)); console.log(md); console.log(`run → ${f}`); }
  else { writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2)); writeFileSync(join(opts.out, 'summary.md'), md); console.log(md.split('\n').slice(0, 7).join('\n')); console.log(`summary → ${join(opts.out, 'summary.md')}`); }
  console.log(JSON.stringify(totals));
  process.exitCode = totals.pass + totals.overridePass === totals.pages ? 0 : 2;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`gate-all error: ${e.message}`); process.exit(1); });
}
