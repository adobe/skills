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
 * Per page: stitched captures of both sides (stitch-shot, --settle), pixel-compare, and the DOM probes
 * — clip-probe on the served side (D1, both stages), content-presence (D2, published stage; the
 * prototype is authored from the same capture content-diff already reconciles) and unit-geometry (D3)
 * for the repeated-unit families stardust/replica/units.json declares for the page. SCHEDULE (per batch): the probes
 * read no capture, so they run beside the two capture pools, and a page's content and unit probes run at once (the
 * clip probe only after a content probe that gave no clip result); --probe-concurrency caps the probe processes in
 * flight across the pages (`limiter`). A page is compared when its captures and probes are
 * done, and its pass is written then (§ REUSE), not when the batch is. BROWSERS: every child that opens a
 * browser (a build capture, an origin freeze or live stitch, a probe — one browser each; content-presence loads its
 * two pages in that one) takes a unit of the job's one budget (`browserBudget`): --max-browsers, else
 * STARDUST_MAX_BROWSERS, else what the phases held in turn FOR THIS JOB — the larger of min(pages to capture on the
 * build side, eds concurrency) and min(pages to probe, probe concurrency) — pages with a reusable recorded pass (§ REUSE) count in neither, plus one per origin capture that has a
 * browser open (a freeze or live stitch; at most the origin concurrency). One page: 1, and 2 only while its origin is
 * frozen; --max-browsers / STARDUST_MAX_BROWSERS replaces it and is how a caller opts in to more. The three
 * concurrency flags are per-kind limits inside it; a log line at the start names the budget and its source. Rows, records and their order do not depend on the schedule. Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + clip.json [+ content.json, units.json],
 * <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead. A page that passes keeps its
 * records, not its PNGs (#156, disk): every PNG in its dir is deleted and pixel.json notes the drop — the page's
 * RECORDED PASS (§ REUSE). Pages go through in batches of BATCH, a passed page's PNGs gone as soon as it passes; a page
 * captured again loses its recorded pass first, and a missing capture is written to pixel.json — a failed or
 * interrupted re-capture never leaves the old pass to be reused.
 * REUSE (--skip-existing): a recorded pass is the page's WHOLE verdict — pixel.json `capturesDropped` { masks, edsUrl,
 * key, probes, at }: the probe results the verdict read, and `key` (`passKey`), one digest per thing the verdict or an
 * instrument reads that can change while the build URL stays: the build and source URLs; the page's entries in
 * masks.json, presence.json, clip-allow.json and overrides.json; its unit families (stardust/replica/units.json or
 * the legacy file, resolved for its slug, template and stage); the run's options (stage, width, wide, threshold,
 * offset bound, height / clip / unit tolerances, the criteria on or off, the origin mode, --blocked for its URL,
 * --warmup, --vh, and the overlay, locale and timer-hold flags as its captures and probes get them); its frozen
 * reference (dir, baseline.json, baseline.png there) and the archetype gate dir's baseline.json (prototype stage: its
 * live.json and live.capture.json too); origin.json and eds.json; the instrument files (this one, pixel-compare,
 * stitch-shot, reference, the three probes); at the prototype stage the prototype file; and the page's LOCAL BUILD
 * INPUTS (`localInputs`, by content): `page content` (its delivered content file and migrated HTML; the prototype
 * and the local files it links), `block <name>` (every file of each block it uses) and `shared code` (the
 * foundation manifest's file set and the nav / footer fragments). It is written — after the
 * page's round — the moment the page's verdict is a pass, so a killed job keeps every page that finished, and a
 * --skip-existing run takes such a page from the record: no capture, no probe, no compare, the row rebuilt from it
 * (`recordedPass`; log `<slug> → recorded pass reused …`). Fail closed — `<slug> → recorded pass not reused (<what>
 * changed, …) — gated again`: any ingredient differs, the key cannot be computed, the record has no key or probe
 * results (an older version's, or --compare-only's pixel pass) or would not pass, or its reference's capture settings
 * changed (§ SETTINGS). A page with no pass on record — failed, or killed before its verdict, its probe in flight —
 * is gated again, reusing only its finished captures. A page whose local inputs cannot be resolved is never reused
 * (`… cannot be resolved: …`) — there is no weaker key. The key is LOCAL: a file changed in the working tree gates
 * its pages again whether or not it was pushed; a change made on the content source or the CDN without touching a
 * local file is not seen, nor is one of the source site — gate those pages without --skip-existing.
 * summary.* is written once, at the end: a killed job leaves the previous one (or none), never a partial one.
 *
 * VERDICT (all four): the PIXEL CRITERION (pixel-compare.mjs --offset-max owns the rule, `pixelVerdict`: the compare
 * runs ALIGNED; aligned % ≤ --threshold AND the total offset ≤ the bound — --offset-max <px>, default 8 at the
 * prototype stage and the larger of 8 and 1 % of the origin height at the published one; aligned % within the
 * threshold but offsets over the bound fails with `offsets: <n> step(s), <px>px total — …`, the fix list; alignment
 * not used → the unaligned %, as before; ROSTER TOLERANCE, published stage without --offset-max: a row over that
 * bound passes the offsets while its total offset ≤ --height-tol × origin height — what the height criterion beside
 * it allows — and no single step exceeds 200 px, `rosterOffsets`; gate.sh and the prototype stage keep the bound) AND |Δh| ≤ --height-tol × origin height (a union metric
 * was tried and rejected — white gaps score as matches) AND served clipped ≤ --clip-max +
 * clip-allow.json allowance AND content MISSING + HIDDEN links / headings = 0 (n/a when the origin
 * could not be probed — never a fail) [+ required units within --unit-tol]. The pixel-only verdict is
 * recorded beside it per page and in the totals — every run is calibration data. Row: `pct` is the UNALIGNED %
 * (what every reader of the table has always read), beside it `alignedPct`, `alignedUsed`, `totalShift`, `steps`
 * (≤ 12), `offsetBound` (the strict bound), `offsetTolerance` (the roster tolerance in px, null where it does not
 * apply), `offsetJudge` ('bound' | 'tolerance': the number that decided the offsets) and, on a row whose pixel
 * criterion is met only under the tolerance, `offsetsWithinTolerance: true` + a `notes` entry with the total shift.
 * totals.alignedOnlyPass counts the rows that pass only thanks to alignment, failOffsets the rows failing on offsets
 * alone, offsetsWithinTolerance the rows over the strict bound and within the tolerance. No override is involved.
 * ORIGIN (both stages): the page's FROZEN REFERENCE (reference.mjs: primed, measured against itself, frozen once) —
 * the usable baseline of the page's archetype gate dir `gates/<slug>-<width>/` (gate.sh's, shared), else (prototype
 * stage) that dir's cached live.png, else the one in the page's own dir, else one is frozen there
 * (`reference.mjs freeze`, the overlay flags and locale passed through) and reused by every later run. origin.png is
 * its copy; origin.json carries `reference` { dir, capturedAt, primed, stable, noiseFloor, variableRows, maskArg[, hint] }
 * (hint: reference.mjs's, when its captures differed without the timer hold — repeated once per page as the log line
 * `origin <slug>: hint: …`, the row's `hint` and a `(hint) …` entry of its reasons cell; no verdict or exit code reads it);
 * the reference's self-varying rows join the page's masks.json rows in the compare; the row records `noiseFloor` and
 * `variableRows`. An UNSTABLE reference (the captures are not one page: reference.mjs exit 2, nothing frozen) is an
 * ERROR row — reason `reference-unstable: <its line>`, counted in totals.error and totals.referenceUnstable — never a
 * FAIL, never a pass, and no crawl shot stands in. --recapture-origin deletes the page's frozen reference (where it
 * lives: the archetype gate dir when that holds one, else the page dir) and freezes again in the same place — never
 * --force: an unstable page stays an error. --live-origin (or GATE_REFERENCE=live in the environment, gate.sh's
 * opt-out) is the origin as it was: the prototype stage's cached live.png, else a fresh stitch on every run.
 * SETTINGS: a usable reference frozen under other capture settings than this run's (`reference.mjs settings`: consent,
 * dismiss, noDismiss, locale against baseline.json `flags`) is deleted and frozen again where it lives, one log line
 * `reference: re-frozen — capture settings changed (consent, locale)` (gate.sh's rule and wording; an unstable
 * re-freeze is the error row above); a --skip-existing origin or recorded pass that came from it is not reused.
 * TIMER HOLD: on by default at 2000 ms (--help § Timer hold; gate.sh's rule) — a reference frozen without it is frozen
 * again once, under the settings it recorded plus the hold. One
 * frozen without recorded flags is reused: `reference: reused — settings not recorded`. No round is recorded for a freeze.
 * WIDE (--wide): the same rows at a wide width — DESIGN.json's extensions.breakpoints.probeWidth (--design, default
 * DESIGN.json), else 2560 — written to `gates/wide-<w>/summary.{json,md}`: a REPORT, exit 0 whatever the rows say,
 * its calibration line counting the pages over the threshold; no round is recorded, no content probe runs, and no
 * reader takes it for a delivery table. It composes with --skip-existing, --only, --eds-host and the overlay flags
 * (its own page dirs and references, at the wide width). When a page is over the threshold (aligned %) or off in
 * height (|Δh| over --height-tol) one line follows the table (`wideLine`):
 * `wide <w>px: N page(s) over <t>% or off in height — <slug> <pct>% Δh <px>px, …`; summary.json carries
 * totals.overThreshold, totals.heightOff and `wide` { line, pages: [{ slug, pct, heightDelta, overThreshold, heightOff }] }.
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
 * (shown BESIDE the number, never replacing it; `{"<slug>": {verdict, reason, waives: [criteria]}}`, a row passes
 * with it only when every failing criterion is waived — overrideScope), clip-allow.json, presence.json (session-variable
 * regions); repeated units come from stardust/replica/units.json (unit-geometry.mjs header; a legacy
 * <out>/units.json per page still reads) — a page none applies to is named, not failed (§ UNITS NOT DECLARED). Origin fallback: live stitch → <crawl-shots>/<slug>.png
 * (`crawl-fullpage`, asymmetric, flagged; never for an unstable reference). A cached live.png or a
 * --skip-existing capture is reused only when its capture record has fixedLayers (gate.sh's rule; staleCapture).
 * Overlays and locale (gate.sh's flags, same spelling): --consent / --dismiss / --no-dismiss / --locale reach both
 * captures and every probe that takes them (CHILD_FLAGS — the three probes take --locale only today).
 *
 * DEADLINE HINT (--deadline-hint; marker run-bg:deadline-hint — run-bg.mjs's convention, its header § Deadline): prints
 * the seconds this job may take (`deadlineHint`, the formula and its calibration in --help § Deadline hint) and exits 0;
 * it reads the two rosters and launches nothing. run-bg.mjs asks it when a job is started without --timeout, so a
 * roster job's deadline follows its pages instead of the flat 900 s.
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--stage published|prototype] [--proto-base <url>]
 *        [--state f] [--coverage f] [--content-dir d] [--out dir] [--width 1440] [--wide] [--design <f>] [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--live-origin] [--eds-host <h>]
 *        [--consent <sel>] [--dismiss <sel,…>] [--no-dismiss] [--locale en-US] [--no-hold-timers] [--hold-min <ms>]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--max-browsers <n>] [--threshold 10] [--offset-max <px>] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>] [--deadline-hint]
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs, reference.mjs and
 * pixel-compare.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (overrides count), 2 any FAIL or error row, 1 error; --wide: 0. `verdict`, `rosterOffsets`, `deadlineHint`, `referenceOf`, `wideWidth`, `wideFlagged`, `wideLine`, `selectPages`, `fontsNotLoaded`, `fontFails`,
 * `fontChecksSkipped`, `shotFonts`, `formatSummary`, `parseArgs`, `passThrough`, `stitchArgs`, `contentArgs`,
 * `clipArgs`, `unitArgs`, `limiter`, `browserBudget`, `maxBrowsersOf`, `recordedProbes`, `captureRecordOf`, `staleCapture`, `staleReason`, `holdMismatch`, `envHold`, `refHold`, `hintOf`, `dropPassedCaptures`, `droppedPass`, `passKey`, `recordedPass`, `localInputs`, `digest`, `fileDigest`
 * are exported.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OFFSETS, pixelVerdict } from './pixel-compare.mjs';
import { DEFAULT_PATHS as FOUNDATION_PATHS, snapshot } from './foundation-freeze.mjs';

// The shared rules (contracts.mjs) live beside browser.mjs in the master skill's scripts dir: the plugin tree or the Setup step 7 copy.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('gate-all: contracts.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(1); }
const { siblingPath } = await import(CONTRACTS.href);

// Pages go through in batches, so a passed batch's PNGs are gone before the next batch is captured (peak disk).
export const BATCH = 25;
/** limiter(n) → slot(fn): runs `fn` (→ a promise) with at most n in flight, first come first served; n < 1 or not a number = 1. */
export function limiter(n) {
  const max = n >= 1 ? Math.floor(n) : 1; let active = 0; const waiting = [];
  const next = () => { if (active < max && waiting.length) { active += 1; waiting.shift()(); } };
  return (fn) => new Promise((res, rej) => { waiting.push(() => Promise.resolve().then(fn).then(res, rej).finally(() => { active -= 1; next(); })); next(); });
}

/**
 * browserBudget({ max, eds, probe }) → slot(kind, fn): the job's one cap on open browsers. `kind` is 'origin' | 'eds' |
 * 'probe'; `fn` (→ a promise) runs while it holds a unit, first come first served among those that fit. `max` = the
 * cap given (--max-browsers / STARDUST_MAX_BROWSERS). Without one the cap is what the phases held when they ran in
 * turn: max(eds + the origin browsers open, probe) — so an origin capture that opens a browser adds its own unit, as
 * it stood beside the build pool, and frozen references leave max(eds, probe). slot.peak() = the most held at once.
 */
export function browserBudget({ max = null, eds = 4, probe = 2 } = {}) {
  let open = 0; let origin = 0; let peak = 0; const waiting = [];
  const cap = (o) => (max != null ? max : Math.max(eds + o, probe));
  const fits = (kind) => open + 1 <= Math.max(1, cap(origin + (kind === 'origin' ? 1 : 0)));
  const next = () => {
    for (let i = 0; i < waiting.length;) {
      if (!fits(waiting[i].kind)) { i += 1; continue; }
      const w = waiting.splice(i, 1)[0]; open += 1; if (w.kind === 'origin') origin += 1; peak = Math.max(peak, open); w.start();
    }
  };
  const slot = (kind, fn) => new Promise((res, rej) => { waiting.push({ kind, start: () => Promise.resolve().then(fn).then(res, rej).finally(() => { open -= 1; if (kind === 'origin') origin -= 1; next(); }) }); next(); });
  slot.peak = () => peak;
  return slot;
}
/** --max-browsers, else STARDUST_MAX_BROWSERS → { max, from: 'flag' | 'env' | 'default' }; a value that is not a whole number ≥ 1 → { error }: a cap that cannot be read is never "no cap". */
export function maxBrowsersOf(flag, env = process.env) {
  const whole = (v) => (/^\d+$/.test(String(v).trim()) && Number(v) >= 1 ? Number(v) : null);
  if (flag != null) return whole(flag) ? { max: whole(flag), from: 'flag' } : { error: `--max-browsers needs a whole number, at least 1 (got ${flag})` };
  const e = env.STARDUST_MAX_BROWSERS;
  if (e != null && e !== '') return whole(e) ? { max: whole(e), from: 'env' } : { error: `STARDUST_MAX_BROWSERS needs a whole number, at least 1 (got ${e})` };
  return { max: null, from: 'default' };
}
/** The first log line of a job that opens browsers: the budget in force and where it came from. */
export function budgetLine(o, { capture = 0, probe = 0 } = {}) {
  if (o.maxBrowsers != null) return `browser budget: ${o.maxBrowsers} at once (${o.maxBrowsersFrom === 'flag' ? '--max-browsers' : 'STARDUST_MAX_BROWSERS'})`;
  const e = Math.min(capture, o.ec); const p = Math.min(probe, o.pc);
  return `browser budget: ${Math.max(1, e, p)} at once (default for this job: the larger of min(${capture} page(s) to capture, --eds-concurrency ${o.ec}) and min(${probe} page(s) to probe, --probe-concurrency ${o.pc})), plus one per origin capture that opens a browser (a freeze or a live stitch; at most ${o.oc}) — what the phases held in turn; --max-browsers or STARDUST_MAX_BROWSERS sets one cap`;
}
// The deadline hint (--help § Deadline hint): seconds = fixed + perPage × pages ÷ c, held between floor and ceiling.
// perPage is per page-execution at concurrency 1: the worst recorded job above 15 pages took 216 s × c per page
// (published stage: a 75-page roster job at 360 px), the worst prototype-stage one 10 s × c. c is capped at the default
// 2: nothing faster was recorded.
export const HINT = { fixed: 300, perPage: { published: 240, prototype: 20 }, floor: 900, ceiling: 14400, maxConcurrency: 2 };
/** deadlineHint(pages, { stage, oc, ec, pc }) → the seconds a job over `pages` selected pages may take. Pure. */
export function deadlineHint(pages, { stage = 'published', oc = 2, ec = 4, pc = 2 } = {}) {
  const c = Math.max(1, Math.min(...[oc, ec, pc, HINT.maxConcurrency].map((n) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1))));
  const sec = HINT.fixed + (HINT.perPage[stage] ?? HINT.perPage.published) * Math.max(0, Number(pages) || 0) / c;
  return Math.min(HINT.ceiling, Math.max(HINT.floor, Math.ceil(sec)));
}

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --stage published|prototype  published (default): deployed pages vs liveUrl → gates/all-<w>/;
                            prototype: pages with a prototypePath vs the served prototype → gates/prototypes-<w>/
  --proto-base <url>        where the prototypes dir is served (prototype stage), e.g. http://localhost:8791
  --state <file>            stardust/state.json — rows with status deployed + liveUrl + url
  --coverage <file>         stardust/rollout/coverage/pages.json — its delivered rows (deployed | verified | failed on
                            a gate) are merged in: a page is ungated only when neither file names it
  --content-dir <dir>       content — the delivered content tree (a page's file there is part of its reuse key)
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --wide                    REPORT at a wide width (DESIGN.json's extensions.breakpoints.probeWidth, else 2560; an
                            explicit --width wins) → gates/wide-<w>/summary.{json,md}: same rows, exit 0 whatever
                            they say, the pages over the threshold counted; no content probe, no round recorded —
                            a report, not a delivery criterion. Composes with --skip-existing, --only, --eds-host and
                            the overlay flags. Pages over the threshold or off in height (--height-tol) are named on
                            one line after the table — "wide <w>px: N page(s) over <t>% or off in height — <slug>
                            <pct>% Δh <px>px, …" — and in summary.json (totals.overThreshold, totals.heightOff, wide)
  --design <file>           DESIGN.json (--wide reads its probeWidth)
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched)
  --skip-existing           reuse captures in the page dir (a stitch with no fixedLayers in its capture record —
                            taken before fixed layers were captured once — is retaken, as is such a cached live.png),
                            and a passed page's recorded pass — its whole verdict: no capture, no probe, no compare —
                            while everything it was measured with is unchanged (§ Reuse below)
  --recapture-eds           (with --skip-existing) re-shoot eds.png only
  --recapture-origin        delete the page's frozen reference and freeze it again, in the same place (the previous
                            origin.png is removed first: a failed or unstable freeze is an error row; never --force)
  --live-origin             the origin as it was before the frozen reference: a fresh stitch on every run (prototype
                            stage: the archetype round's cached live.png) — GATE_REFERENCE=live does the same
  --eds-host <host>         gate a code branch host against the same content
  --consent <sel>           site-specific consent-accept selector — both captures
  --dismiss <sel,…>         extra overlay-dismiss selectors — both captures
  --no-dismiss              dismiss no overlay (contradicts --consent / --dismiss: exit 1)
  --locale <tag>            en-US — both captures and every probe
  --no-hold-timers          capture without the timer hold, which is ON by default (§ Timer hold below; exit 1
                            together with --hold-timers / --hold-min)
  --hold-min <ms>           the hold with a higher threshold (floor 2000)
  --hold-timers             the hold, asked for: at GATE_HOLD_TIMERS's threshold when that is a number, else 2000
  --blocked <regex>         origins the edge denies → crawl shot unless --try-blocked
  --try-blocked             attempt the live stitch on --blocked origins too
  --crawl-shots <dir>       stardust/current/assets/screenshots (fallback origin PNGs)
  --origin-concurrency <n>  2      --eds-concurrency <n>  4      --probe-concurrency <n>  2   (per-kind limits)
  --max-browsers <n>        browser processes this job holds at once, over origin captures, build captures and probes
                            (one per child; content-presence loads its two pages in that one); a log line names it.
                            Default: STARDUST_MAX_BROWSERS, else what the phases held in turn for THIS job — the larger
                            of min(pages to capture, eds concurrency) and min(pages to probe, probe concurrency), plus
                            one per origin capture with a browser open (a freeze or live stitch). One page: 1 (2 while
                            its origin is frozen); 12 pages at the defaults: 4. Give a number to opt in to more
  --threshold <pct>         10     --height-tol <frac>    0.05   --clip-max <n>  0   --unit-tol <px>  4
  --offset-max <px>         total offset the pixel criterion allows (default: 8 at the prototype stage; published the
                            larger of 8 and 1 % of the origin height, then the roster tolerance below); given, it is
                            the only bound
  --no-clip | --no-content | --no-probes   drop criteria 3 / 4 / both (pixel-only verdict)
  --units <file>            repeated-unit declarations (default <out>/units.json)
  --compare-only            no captures, no probes, no browser: pixel-compare over the existing PNGs (a passed page:
                            its recorded pass), the recorded probe results (<slug>/probes.json), the sidecars
  --warmup <url>            origin warm-up for the probes
  --vh <px>                 stitch chunk height
  --deadline-hint           print the seconds this job may take (§ Deadline hint below) and exit 0: the rosters are
                            read, nothing is captured. run-bg.mjs asks it when a job is started without --timeout
  --help                    this text
Verdict = pixel criterion AND |Δh| ≤ height-tol × origin height AND clipped ≤ clip-max(+allowance) AND content MISSING+HIDDEN = 0.
  Pixel criterion (pixel-compare.mjs --offset-max): the compare is ALIGNED — aligned % ≤ threshold AND total offset ≤
  the bound; within the threshold but over the bound the reason is "offsets: <n> step(s), <px>px total — …" (the fix
  list), not a percentage; alignment not used → the unaligned %. The row keeps pct = the unaligned % and adds
  alignedPct, alignedUsed, totalShift, steps (≤ 12), offsetBound.
  Roster tolerance (published stage, no --offset-max): offsets over the bound still pass while the total offset ≤
  height-tol × origin height (the height criterion's tolerance) and no single step exceeds 200 px. The row records
  offsetBound (strict), offsetTolerance, offsetJudge (bound | tolerance); one passing only under the tolerance has
  offsetsWithinTolerance and a note with its total shift (summary.md: "(reported) offsets within the roster
  tolerance: …"), counted in totals.offsetsWithinTolerance. gate.sh and --stage prototype keep the strict bound.
  Origin = the page's frozen reference (reference.mjs: primed, noise floor measured): the archetype gate dir's
  (gates/<slug>-<width>/), else one frozen once into the page's dir and reused; its self-varying rows are masked and
  the row records noiseFloor and variableRows. An UNSTABLE reference is an error row — reference-unstable: <line> —
  never a FAIL or a pass: pin the page's state (--consent / --dismiss / --locale), or freeze it by hand with --force.
  Timer hold: stitch-shot's (its --help; a bare stitch-shot or reference.mjs call stays unheld), ON by default at
  2000 ms on the reference and both captures, so a page whose carousel advances on its own is captured in one state on
  both sides. Precedence: a flag wins over GATE_HOLD_TIMERS (0 = off, 1 = 2000, a number = that threshold), which
  wins over the default. A reference frozen without the hold is frozen again ONCE under the settings it recorded plus
  the hold ("reference: re-frozen — capture settings changed (holdTimers): the gates hold timers by default …") and
  later runs reuse it; a run that names no hold takes a held reference's threshold; a --no-hold-timers /
  GATE_HOLD_TIMERS=0 run freezes a held one again without it and keeps an unheld one. A reused capture taken under
  another hold is retaken; two sides under different holds are an error row, nothing compared.
  A reference whose captures differed without the timer hold carries reference.mjs's hint: logged once per page
  ("origin <slug>: hint: …"), kept as the row's hint and in its reasons cell as "(hint) …" — advice, never a reason:
  no verdict and no exit code reads it. A run under the hold (the default) has none.
  A reference frozen under other --consent / --dismiss / --no-dismiss / --locale than this run's is frozen again
  ("reference: re-frozen — capture settings changed (consent, locale)"; not a round); one whose settings were not
  recorded is reused, and said so.
  A font face that loads on the source and is dead on the build (the capture records' fontsFailed,
  <slug>/<side>.capture.json) fails the row: font-not-loaded:<family>; one dead on the source is reported, not failed;
  a font check that could not run (fontsFailed null, or no record) fails it: font-check-skipped:<origin|build>.
  A probe that errored or timed out is an error row (probe-error:<probe>), never a pass and not a FAIL.
  A page no repeated-unit family applies to did not take that check: unitsDeclared 0 and a note on the row,
  totals.unitsNotDeclared and the calibration line count it; the verdict and the exit code do not read it.
Sidecars in <out>/: masks.json, overrides.json, clip-allow.json, presence.json, units.json (see the header).
  overrides.json: {"<slug>": {"verdict", "reason", "waives": [capture|pixel|height|clip|content|units|fonts, …]}}
  waives only what it names; no "waives" = capture, pixel, height, fonts; clip, content and units only by name.
A page that passes keeps its records, not its PNGs (#156): --recapture-eds / --recapture-origin, or a run
without --skip-existing, shoots it again. Pages go through in batches of ${BATCH}; a page's PNGs are deleted when it passes.
Reuse (--skip-existing): a page's pass is recorded the moment its verdict is known (pixel.json capturesDropped: the
  probe results and a key), so a killed job keeps every page that finished and the re-run gates only the others —
  a page that failed, or had a capture or probe in flight, is gated again (finished captures reused). The key: build
  and source URL; the page's masks.json, presence.json, clip-allow.json and overrides.json entries; its unit
  families; the verdict and capture options of the run; its frozen reference; its capture records; the instrument
  files; the prototype file (prototype stage); and the page's LOCAL build inputs, by content: "page content" (its
  file under --content-dir and its migrated HTML; a prototype and the local files it links), "block <name>" (every
  file of each block it uses: the ledger row's blocks and the block classes of its content file) and "shared code"
  (styles/ fonts/ blocks/header/ blocks/footer/ head.html scripts/, nav.html and footer.html of the content dir).
  Anything else: "<slug> → recorded pass not reused (<what> changed) — gated again"; so is a record from an older
  version or from --compare-only, and a page whose local inputs cannot be resolved ("page content cannot be
  resolved: …" — no content file and no migrated HTML, no blocks/ directory, none of the shared paths): never a
  weaker key. The key is local: a file changed in the working tree gates its pages again, pushed or not; a change
  made directly on the content source or the CDN, with no local file touched, is NOT seen — gate those pages
  without --skip-existing, or with --recapture-eds (reuses no pass).
  summary.* is written at the end only: a killed job leaves the previous one, never a partial one.
Deadline hint (--deadline-hint): the larger of ${HINT.floor} and ${HINT.fixed} + B × pages ÷ c seconds, at most ${HINT.ceiling} (4 h).
  pages = the pages this run selects (state + ledger, after --only); B = ${HINT.perPage.published} s a page at the published stage
  (--wide too), ${HINT.perPage.prototype} s at the prototype stage; c = the smallest of --origin-concurrency, --eds-concurrency and
  --probe-concurrency, at most ${HINT.maxConcurrency} (the default; nothing faster was recorded). A --skip-existing or --compare-only
  page counts in full: how many recorded passes a run reused was never recorded, so no discount could be calibrated.
  Calibration, 1,149 completed jobs of 23 recorded sessions with a known page count: the worst job above 15 pages took
  170 s × c a page (published), 10 s × c (prototype); the hint covers every one of them and 99 % or more of each
  smaller size class (1, 2–5, 6–15 pages). A later 75-page roster job at 360 px went at 216 s × c a page (39 pages in
  6000 s at the default c = 2), so B leaves room above it. 20 pages → 2700 s, 53 → 6660 s, 75 → 9300 s, 100 → 12300 s (c = 2).
Exit: 0 all PASS (overrides count), 2 any FAIL or error row, 1 error; --wide: 0.`;

/** --eds-host as an origin: a bare host (`main--site--org.aem.page`) gets https://, a trailing slash goes. */
export const hostOrigin = (h) => { const x = String(h || '').trim().replace(/\/+$/, ''); return x && !/^[a-z][a-z0-9+.-]*:\/\//i.test(x) ? `https://${x}` : x; };
/** The gates' default timer hold (ms) — stitch-shot's own default threshold; a bare stitch-shot / reference.mjs call stays unheld. */
export const HOLD_DEFAULT = 2000;
/** GATE_HOLD_TIMERS → the timer hold's threshold in ms: unset or '' = undefined (not named: the default), 0 = null (off), 1 = 2000, else the number. */
export const envHold = (v) => (v == null || v === '' ? undefined : v === '0' ? null : v === '1' ? HOLD_DEFAULT : Number(v));
/** What the re-frozen line adds when only the default asked for the hold (gate.sh's wording). */
export const HOLD_DEFAULT_WHY = ': the gates hold timers by default and this reference was frozen without the hold — frozen again once (--no-hold-timers or GATE_HOLD_TIMERS=0 keeps a round unheld)';
/** A frozen reference's recorded hold (baseline.json flags.holdTimers, else timers.hold — reference.mjs's recordedHold), or null. */
export const refHold = (b) => Number(b && b.flags && b.flags.holdTimers) || Number(b && b.timers && b.timers.hold) || null;
export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { stage: 'published', protoBase: null, state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, maxBrowsers: null, maxBrowsersFrom: 'default', threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null, coverage: 'stardust/rollout/coverage/pages.json', contentDir: 'content', consent: null, dismiss: null, noDismiss: false, locale: 'en-US', offsetMax: null, liveOrigin: process.env.GATE_REFERENCE === 'live', holdTimers: HOLD_DEFAULT, holdGiven: false, wide: false, design: 'DESIGN.json' };
  // the timer hold: the default, then GATE_HOLD_TIMERS, then the flags (holdGiven: the variable or a flag named it)
  const env = envHold(process.env.GATE_HOLD_TIMERS); if (env !== undefined) { o.holdTimers = env; o.holdGiven = true; }
  let holdOn = false; let holdOff = false; let holdMin = null;
  let widthGiven = false; let maxFlag = null;
  const need = (flag, val) => { if (val == null || val.startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return val; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = () => rest[++i];
    if (a === '--stage') { o.stage = v(); if (!['published', 'prototype'].includes(o.stage)) { console.error(`--stage must be published or prototype\n\n${HELP}`); process.exit(1); } }
    else if (a === '--proto-base') o.protoBase = v().replace(/\/$/, '');
    else if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') { o.width = Number(v()); widthGiven = true; }
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') o.edsHost = hostOrigin(v()); else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-concurrency') o.oc = Number(v()); else if (a === '--eds-concurrency') o.ec = Number(v()); else if (a === '--probe-concurrency') o.pc = Number(v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a === '--coverage') o.coverage = need(a, v()); else if (a === '--content-dir') o.contentDir = need(a, v());
    else if (a === '--max-browsers') maxFlag = need(a, v());
    else if (a === '--offset-max') { o.offsetMax = Number(need(a, v())); if (!(Number.isFinite(o.offsetMax) && o.offsetMax >= 0)) { console.error(`--offset-max needs a number of px\n\n${HELP}`); process.exit(1); } }
    else if (a === '--deadline-hint') o.deadlineHint = true;
    else if (a === '--live-origin') o.liveOrigin = true; else if (a === '--wide') o.wide = true; else if (a === '--design') o.design = need(a, v());
    else if (a === '--hold-timers') holdOn = true; else if (a === '--no-hold-timers') holdOff = true; else if (a === '--hold-min') holdMin = Number(need(a, v()));
    else if (a === '--consent') o.consent = need(a, v()); else if (a === '--dismiss') o.dismiss = need(a, v()); else if (a === '--no-dismiss') o.noDismiss = true; else if (a === '--locale') { o.locale = need(a, v()); o.localeGiven = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (holdOff && (holdOn || holdMin != null)) { console.error('gate-all: --no-hold-timers contradicts --hold-timers / --hold-min — drop one (see --help)'); process.exit(1); }
  if (holdOff || holdOn || holdMin != null) { o.holdTimers = holdOff ? null : holdMin ?? o.holdTimers ?? HOLD_DEFAULT; o.holdGiven = true; }
  if (o.holdTimers != null && !(Number.isFinite(o.holdTimers) && o.holdTimers >= 2000)) { console.error(`--hold-min / GATE_HOLD_TIMERS needs a number of ms, at least 2000\n\n${HELP}`); process.exit(1); }
  const mb = maxBrowsersOf(maxFlag);
  if (mb.error) { console.error(`gate-all: ${mb.error}\n\n${HELP}`); process.exit(1); }
  o.maxBrowsers = mb.max; o.maxBrowsersFrom = mb.from;
  if (o.noDismiss && (o.consent || o.dismiss)) { console.error('gate-all: --no-dismiss contradicts --consent / --dismiss — drop one (see --help)'); process.exit(1); }
  if (o.stage === 'prototype' && o.content) o.content = false; // content-diff already reconciles the prototype's text
  // --wide: a report table at the derived probe width — its own dir, no content probe (the base width measured it).
  if (o.wide) { if (!widthGiven) o.width = wideWidth(o.design); o.content = false; }
  if (!o.out) o.out = `stardust/replica/gates/${o.wide ? 'wide' : o.stage === 'prototype' ? 'prototypes' : 'all'}-${o.width}`;
  return o;
}
/** The wide report's width: DESIGN.json's extensions.breakpoints.probeWidth (cap-probe's derived width), else 2560. */
export const WIDE_DEFAULT = 2560;
export function wideWidth(designFile = 'DESIGN.json') {
  try { const w = JSON.parse(readFileSync(designFile, 'utf8')).extensions.breakpoints.probeWidth; return Number.isInteger(w) && w > 0 ? w : WIDE_DEFAULT; } catch { return WIDE_DEFAULT; }
}
/**
 * The wide report's flagged rows: over the threshold (aligned %, the report's own count) or off in height (measured,
 * |Δh| over the height tolerance) → [{ slug, pct, heightDelta, overThreshold, heightOff }], worst first.
 */
export function wideFlagged(rows, { threshold = 10 } = {}) {
  return rows.map((r) => ({ slug: r.slug, pct: r.alignedPct ?? r.pct ?? null, heightDelta: r.heightDelta ?? null, overThreshold: r.alignedPct != null && r.alignedPct > threshold, heightOff: r.pct != null && !r.heightPass }))
    .filter((r) => r.overThreshold || r.heightOff)
    .sort((a, b) => Math.abs(b.heightDelta || 0) - Math.abs(a.heightDelta || 0) || (b.pct || 0) - (a.pct || 0));
}
/** The one line under the wide table, or null when no page is flagged (at most `max` pages named, then `… N more`). */
export function wideLine(flagged, { width, threshold = 10, max = 12 } = {}) {
  if (!flagged.length) return null;
  const named = flagged.slice(0, max).map((r) => `${r.slug} ${r.pct}% Δh ${r.heightDelta}px`);
  return `wide ${width}px: ${flagged.length} page(s) over ${threshold}% or off in height — ${named.join(', ')}${flagged.length > max ? `, … ${flagged.length - max} more` : ''}`;
}
/** baseline.json (reference.mjs's, or stitch-shot's older freeze) → what the origin meta and the row keep of the page's frozen reference. */
export function referenceOf(b, dir) {
  const v = Array.isArray(b && b.variable) ? b.variable : [];
  return { dir, capturedAt: (b && b.capturedAt) ?? null, primed: !!b && b.primed === true, stable: !b || b.stable !== false, noiseFloor: b && typeof b.noiseFloor === 'number' ? b.noiseFloor : null, variableRows: v.reduce((n, r) => n + (Number(r.h) || 0), 0), maskArg: (b && b.maskArg) || '', ...(hintOf(b) ? { hint: hintOf(b) } : {}) };
}
/** reference.mjs's `hint` (baseline.json / reference-unstable.json: the captures differed without the timer hold), or null. Advice: no verdict reads it. */
export const hintOf = (b) => (b && typeof b.hint === 'string' && b.hint.trim() ? b.hint.trim() : null);

// ---- pure: the font check of a capture ----------------------------------------------------------------
/**
 * shotFonts(record, { missing }) → the font check of a stitch-shot capture record for the side's meta: { fontsFailed }
 * (checked — the dead faces, [] when every face loaded) or { fontsFailed: null, fontCheck } — null when the record says
 * so (its check could not run), when it predates the check (no fontsFailed key) or when there is no readable record at
 * all (`missing` names why; default: an older stitch-shot copy). Unchecked is never "all loaded".
 */
export function shotFonts(record, { missing = 'no readable capture record (stitch-shot wrote no capture record — re-copy stitch-shot.mjs)' } = {}) {
  if (!record || typeof record !== 'object') return { fontsFailed: null, fontCheck: `failed: ${missing}` };
  if (Array.isArray(record.fontsFailed)) return { fontsFailed: record.fontsFailed.filter((f) => typeof f === 'string' && f), ...(Array.isArray(record.deadFaces) ? { deadFaces: record.deadFaces } : {}) };
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
  // 'both' only when the SOURCE lists the family (a family the build lists twice is still dead on the build alone),
  // and — when both records carry the dead faces themselves (`deadFaces`: family|weight|style) — only when every face
  // dead on the build is dead on the source too: a source-dead italic does not waive a build-dead regular.
  const keys = (m) => (m && Array.isArray(m.deadFaces) ? m.deadFaces.filter((k) => typeof k === 'string') : null);
  const oFaces = keys(originMeta); const eFaces = keys(edsMeta);
  const onOrigin = new Set(list(originMeta).map(familyKey));
  const covered = (fam) => !oFaces || !eFaces || eFaces.filter((k) => k.split('|')[0] === fam).every((k) => oFaces.includes(k));
  for (const f of list(originMeta)) faces.set(familyKey(f), { family: f, side: 'origin' });
  for (const f of list(edsMeta)) { const k = familyKey(f); faces.set(k, { family: f, side: onOrigin.has(k) && covered(k) ? 'both' : 'eds' }); }
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
export function selectPages({ state = null, coverage = null, stage = 'published', protoBase = null, edsHost = null, only = null, protoExists = () => false } = {}) {
  const statePages = (state && Array.isArray(state.pages) ? state.pages : []).filter((p) => p && typeof p === 'object');
  const keep = (p) => !only || only.includes(p.slug);
  if (stage === 'prototype') {
    // A row not yet advanced to `prototyped` has no prototypePath: the prototype table runs before state.mjs
    // advance in a recreate unit (recorded: a hand-written state file). The conventional file stands in when it exists.
    const protoOf = (p) => p.prototypePath || (p.slug && protoExists(`stardust/prototypes/${p.slug}-proposed.html`) ? `stardust/prototypes/${p.slug}-proposed.html` : null);
    const pages = statePages.filter((p) => p.url && protoOf(p)).map((p) => ({ ...p, prototypePath: protoOf(p), liveUrl: `${protoBase || 'http://localhost:8791'}/${basename(protoOf(p))}` })).filter(keep);
    return { pages, skipped: [], from: { state: pages.length, coverage: 0 } };
  }
  const fromState = statePages.filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  const named = new Set(fromState.map((p) => p.slug));
  const bySlug = new Map(statePages.map((p) => [p.slug, p]));
  const covRows = (Array.isArray(coverage) ? coverage : (coverage && Array.isArray(coverage.pages) ? coverage.pages : [])).filter((r) => r && r.slug && isDelivered(r.delivery));
  const tally = new Map();
  for (const r of covRows) { const o = originOf(r.delivery.deployedUrl); if (o) tally.set(o, (tally.get(o) || 0) + 1); }
  const base = (hostOrigin(edsHost) || [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o)[0] || '').replace(/\/$/, '') || null;
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
  // A page named with --only and given a build host is gated although no ledger calls it delivered yet: the
  // delivery unit gates its page BEFORE update-coverage writes the row (recorded: every unit's first call
  // selected nothing). Path = the ledger row's (any status), else the migrated file's.
  const fromNamed = [];
  if (only && edsHost) {
    const allCov = new Map((Array.isArray(coverage) ? coverage : (coverage && Array.isArray(coverage.pages) ? coverage.pages : [])).filter((r) => r && r.slug).map((r) => [r.slug, r]));
    for (const slug of only) {
      if (named.has(slug) || skipped.some((x) => x.slug === slug)) continue;
      const st = bySlug.get(slug); if (!st || !st.url) continue;
      const cov = allCov.get(slug);
      const path = (cov && typeof cov.path === 'string' && cov.path.startsWith('/') ? cov.path : null) || migratedPathOf(st.migratedPath);
      if (!path) { skipped.push({ slug, why: 'named with --only, but no path: no rollout ledger row and no migratedPath in state.json' }); continue; }
      named.add(slug);
      fromNamed.push({ ...st, slug, liveUrl: `${hostOrigin(edsHost)}${path}`, deployedPath: path });
    }
  }
  return { pages: [...fromState, ...fromCoverage, ...fromNamed].filter(keep), skipped: skipped.filter(keep), from: { state: fromState.filter(keep).length, coverage: fromCoverage.filter(keep).length, ...(fromNamed.length ? { named: fromNamed.length } : {}) } };
}
/**
 * A project's stardust/.gitignore is its own copy (never rewritten): one set up before the per-page references were
 * left untracked still has the line that tracks every gates/ baseline.png. → the note to print, or null.
 */
export const REFERENCE_IGNORES = ['**/gates/all-*/**/baseline.png', '**/gates/prototypes-*/**/baseline.png', '**/gates/wide-*/**/baseline.png'];
export function referenceIgnoreNote(text) {
  if (typeof text !== 'string' || !text.includes('!**/gates/**/baseline.png')) return null;
  const lines = new Set(text.split('\n').map((l) => l.trim()));
  const missing = REFERENCE_IGNORES.filter((l) => !lines.has(l));
  return missing.length ? `stardust/.gitignore tracks every page's frozen reference (baseline.png under the all-pages, prototype and wide tables) — add below its "!**/gates/**/baseline.png" line: ${missing.join('  ')}` : null;
}
const readTextSafe = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
/** The --only slugs that selection neither kept nor listed as skipped: each gets its own NOT gated line. */
export const unselected = (only, pages, skipped) => (only || []).filter((s) => !pages.some((p) => p.slug === s) && !skipped.some((x) => x.slug === s));
/** stardust/migrated/<a>/<b>/index.html → /a/b ; …/x.html → /x ; the root index → / ; anything else → null. */
export function migratedPathOf(file) {
  const m = /(?:^|\/)stardust\/migrated\/(.+)$/.exec(String(file || '')); if (!m) return null;
  const rel = m[1].replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '');
  return `/${rel}`;
}

// ---- pure: the child command lines ------------------------------------------------------------------------
// The overlay / locale flags each child accepts (its own parseArgs) — only those are passed. The three probes take
// --locale and no dismiss flag (they dismiss with the built-in candidates); the test reads each child's source, so a
// probe that gains one fails there until it is listed here.
export const CHILD_FLAGS = { 'stitch-shot': ['--consent', '--dismiss', '--no-dismiss', '--locale', '--hold-timers', '--hold-min'], 'content-presence': ['--consent', '--dismiss', '--no-dismiss', '--locale'], 'clip-probe': ['--consent', '--dismiss', '--no-dismiss', '--locale'], 'unit-geometry': ['--consent', '--dismiss', '--no-dismiss', '--locale'] };
/** passThrough(child, opts) → the --locale / --consent / --dismiss / --no-dismiss arguments `child` accepts. */
export function passThrough(child, opts = {}) {
  const takes = (f) => (CHILD_FLAGS[child] || []).includes(f); const a = [];
  if (takes('--locale')) a.push('--locale', opts.locale || 'en-US');
  if (opts.holdTimers && takes('--hold-timers')) a.push('--hold-timers', '--hold-min', String(opts.holdTimers)); // the timer hold: stitched captures only
  if (opts.noDismiss) { if (takes('--no-dismiss')) a.push('--no-dismiss'); return a; }
  if (opts.consent && takes('--consent')) a.push('--consent', opts.consent);
  if (opts.dismiss && takes('--dismiss')) a.push('--dismiss', opts.dismiss);
  return a;
}
/** The settings this run GIVES, for `reference.mjs settings`: passThrough's, without the --locale default it adds — a
 * default is not a setting the run asked for, and a reference frozen under another locale is not "changed" by it. */
export const givenFlags = (opts = {}) => { const a = passThrough('stitch-shot', opts); const i = a.indexOf('--locale'); if (i >= 0 && !opts.localeGiven) a.splice(i, 2); return a; };
/** The run's options with the settings it omits taken from the page's frozen reference (baseline.json `flags`). */
export function inheritedOpts(opts, flags) {
  if (!flags || typeof flags !== 'object') return opts;
  const text = (v) => (Array.isArray(v) ? v.join(',') : String(v ?? '')).trim() || null;
  // a setting the run gives that differs from the recorded one: the reference is frozen again under the run's
  // settings (reference.mjs settings), so nothing of the old one is inherited
  const differs = (opts.noDismiss === true) !== (flags.noDismiss === true) && (opts.noDismiss || text(opts.consent) || text(opts.dismiss))
    || (opts.holdGiven && (opts.holdTimers || null) !== (Number(flags.holdTimers) || null)) // the default hold never drops the recorded settings
    || ['consent', 'dismiss', 'locale'].some((k) => (k === 'locale' ? opts.localeGiven : true) && text(opts[k]) && text(opts[k]) !== (text(flags[k]) || (k === 'locale' ? 'en-US' : null)));
  if (differs) return opts;
  const gave = opts.noDismiss || text(opts.consent) || text(opts.dismiss); const o = { ...opts };
  if (flags.noDismiss === true && !gave) o.noDismiss = true;
  if (!opts.noDismiss && !o.noDismiss) for (const k of ['consent', 'dismiss']) if (!text(opts[k]) && text(flags[k])) o[k] = text(flags[k]);
  if (!opts.localeGiven && text(flags.locale)) o.locale = text(flags.locale);
  if (!opts.holdGiven && Number(flags.holdTimers) > 0) o.holdTimers = Number(flags.holdTimers); // no hold named: a held reference's threshold
  return o;
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
 * Override scope. An overrides.json entry waives the criteria it names in `waives`; a row passes with it only when
 * every failing criterion is waived. An entry without `waives` keeps the documented scope (a tier-shift, a capture
 * that could not be retaken, an origin-only dead face): capture, pixel, height and fonts. The element criteria
 * (clip, content, units) are waived only by name, so a font reason never delivers a row that fails on its elements.
 */
export const WAIVABLE = ['capture', 'pixel', 'height', 'clip', 'content', 'units', 'fonts'];
export const LEGACY_WAIVES = ['capture', 'pixel', 'height', 'fonts'];
export function overrideScope(override) {
  if (!override) return { waives: [], legacy: false, unknown: [] };
  if (!Array.isArray(override.waives)) return { waives: LEGACY_WAIVES, legacy: true, unknown: [] };
  return { waives: override.waives.filter((c) => WAIVABLE.includes(c)), legacy: false, unknown: override.waives.filter((c) => !WAIVABLE.includes(c)) };
}

/**
 * verdict({ pixel, clip, content, units, override, allowance, capture }, opts) → row fields. `pixel` = pixel.json,
 * `clip` = { counts } (served side) | { error } | null, `content` = { totals } | { error } (origin not probed: n/a) |
 * { error, probeError: true } | null, `units` = { verdict, required } | { error } | null,
 * `capture` = { fonts: fontsNotLoaded(…), fontsSkipped: fontChecksSkipped(…) } — a face dead on the build alone fails
 * the row with one `font-not-loaded:<family>` reason each, one dead on the source is a `notes` entry (`fontFails`;
 * `fontsNotLoaded` carries both), a side whose font check could not run fails with one `font-check-skipped:<side>`
 * (`fontChecksSkipped`); the pixel-only calibration verdict is unchanged. A probe that errored (clip / units
 * `error`, content `probeError`) is `probeErrors` [{ probe, error }] + one `probe-error:<probe>` reason: not a pass.
 * pixelPass = pixel-compare's `pixelVerdict` (header § VERDICT) with the bound `offsetMax` px, else the stage's
 * default; a pixel.json from before --align reads as alignment not used. A `reference-unstable: …` pixel error is
 * the row's reason as it stands. Offsets over that bound are then judged by `rosterOffsets` (header § VERDICT).
 */
export const ROSTER_OFFSETS = { step: 200 };
/**
 * The roster tolerance on the offsets (published stage, no explicit --offset-max; alignment used): a total offset over
 * the strict bound passes while ≤ heightTol × origin height — the height criterion's tolerance — with no single step
 * over ROSTER_OFFSETS.step px (one step that large is a section missing or added, not accumulated drift).
 * → { tolerance (px | null: does not apply), judge ('bound' | 'tolerance' | null: alignment not used), pass (the
 * offsets pass), within (they pass only under the tolerance), largest (px), over (why they fail under it | null) }.
 */
export function rosterOffsets(pv, steps = [], { stage = 'published', offsetMax = null, heightTol = 0.05, originH = 0 } = {}) {
  if (!pv || !pv.used || pv.bound === null) return { tolerance: null, judge: null, pass: !pv || pv.offsetsPass, within: false, largest: 0, over: null };
  const applies = stage === 'published' && offsetMax == null;
  const tolerance = applies ? Math.max(pv.bound, Math.floor(heightTol * originH)) : null;
  if (!applies || pv.offsetsPass) return { tolerance, judge: 'bound', pass: pv.offsetsPass, within: false, largest: 0, over: null };
  const largest = (steps || []).reduce((m, s) => Math.max(m, Math.abs(s.shift)), 0);
  const over = pv.totalShift > tolerance ? `over the roster tolerance ${tolerance}px` : largest > ROSTER_OFFSETS.step ? `one step of ${largest}px, over ${ROSTER_OFFSETS.step}px (roster tolerance ${tolerance}px)` : null;
  return { tolerance, judge: 'tolerance', pass: !over, within: !over, largest, over };
}
export function verdict({ pixel = {}, clip = null, content = null, units = null, override = null, allowance = 0, capture = { fonts: [], fontsSkipped: [] } }, { threshold = 10, heightTol = 0.05, clipMax = 0, clipOn = true, contentOn = true, stage = 'published', offsetMax = null } = {}) {
  const compared = pixel.compared && Number.isFinite(pixel.heightDelta);
  const originH = compared ? pixel.compared.height + Math.max(0, pixel.heightDelta) : null;
  const edsH = compared ? pixel.compared.height + Math.max(0, -pixel.heightDelta) : null;
  const pv = compared ? pixelVerdict(pixel, { threshold, offsetMax: offsetMax ?? stage }) : null;
  const ro = rosterOffsets(pv, pixel.aligned && pixel.aligned.steps, { stage, offsetMax, heightTol, originH });
  const pctPass = !!pv && pv.alignedPct <= threshold;
  const pixelPass = !!pv && (pv.pass || (pctPass && ro.pass));
  const offsetsWithinTolerance = pctPass && ro.within; // the pixel criterion is met only under the roster tolerance
  const heightPass = compared && Math.abs(pixel.heightDelta) <= heightTol * originH;
  const clipped = clip && clip.counts ? clip.counts.total : null;
  const clipPass = !clipOn ? null : clipped == null ? null : clipped <= clipMax + allowance;
  const cTot = content && content.totals ? content.totals : null;
  const contentPass = !contentOn ? null : cTot ? (cTot.missing + cTot.hidden) === 0 : null;
  const unitPass = units && units.verdict && units.required ? (units.verdict.off + units.verdict.hidden + units.verdict.missing + units.verdict.errors) === 0 : null;
  const reasons = [];
  if (!compared) reasons.push(pixel.error ? (UNSTABLE.test(pixel.error) ? pixel.error : `pixel error: ${pixel.error}`) : 'missing capture');
  if (compared && !pixelPass) reasons.push(pctPass && ro.over ? `${pv.reason} — ${ro.over}` : pv.reason);
  if (compared && !heightPass) reasons.push(`Δh ${pixel.heightDelta}px > ${Math.round(heightTol * 100)}% of ${originH}`);
  if (clipPass === false) reasons.push(`clipped ${clipped}${allowance ? ` > allowance ${allowance}` : ''}${clip.counts ? ` (text ${clip.counts.textClipped + clip.counts.textHidden}, controls ${clip.counts.controlHidden + clip.counts.controlClipped})` : ''}`);
  if (contentPass === false) reasons.push(`content MISSING ${cTot.missing} / HIDDEN ${cTot.hidden}${cTot.controlState ? ` (+${cTot.controlState} control state)` : ''}`);
  // a selector error is named: "off 0 hidden 0 missing 0" said nothing about what to fix
  if (unitPass === false) reasons.push(`units off ${units.verdict.off} hidden ${units.verdict.hidden} missing ${units.verdict.missing}${units.verdict.errors ? ` — ${units.verdict.errors} selector error(s)${units.errors && units.errors.length ? `: ${units.errors.slice(0, 2).join('; ')}` : ''} (fix the family's selector in stardust/replica/units.json)` : ''}`);
  const probeErrors = [];
  if (contentOn && content && content.probeError) probeErrors.push({ probe: 'content', error: String(content.error || 'no result') });
  if (clipOn && clip && clip.error) probeErrors.push({ probe: 'clip', error: String(clip.error) });
  if (units && units.error) probeErrors.push({ probe: 'units', error: String(units.error) });
  reasons.push(...probeErrors.map((e) => `probe-error:${e.probe}: ${e.error}`));
  const fonts = (capture && capture.fonts) || []; const skipped = (capture && capture.fontsSkipped) || [];
  const fontReasons = [...fonts.filter(fontFails).map((f) => `font-not-loaded:${fontFamily(f)}`), ...skipped.map((side) => `font-check-skipped:${side}`)];
  reasons.push(...fontReasons);
  const notes = fonts.filter((f) => !fontFails(f)).map((f) => `font-dead-on-${f.side === 'both' ? 'both' : 'source'}:${f.family}`);
  if (offsetsWithinTolerance) notes.push(`offsets within the roster tolerance: ${pv.totalShift}px total, largest step ${ro.largest}px (strict bound ${pv.bound}px, tolerance ${ro.tolerance}px)`);
  const pixelOnlyPass = !!(pixelPass && heightPass);
  const pass = pixelOnlyPass && clipPass !== false && contentPass !== false && unitPass !== false && !fontReasons.length && !probeErrors.length;
  const contentNA = contentOn && !cTot && !(content && content.probeError) ? (content && content.error) || 'not probed' : null;
  const aligned = { alignedPct: pv ? pv.alignedPct : null, alignedUsed: !!pv && pv.used, totalShift: pv ? pv.totalShift : null, steps: pv ? pv.steps : [], offsetBound: pv ? pv.bound : null, offsetTolerance: ro.tolerance, offsetJudge: ro.judge, offsetsWithinTolerance };
  // an errored probe is a failing criterion no override waives ('probe' is not in WAIVABLE)
  const failing = [[!compared, 'capture'], [compared && !pixelPass, 'pixel'], [compared && !heightPass, 'height'], [clipPass === false, 'clip'], [contentPass === false, 'content'], [unitPass === false, 'units'], [fontReasons.length > 0, 'fonts'], [probeErrors.length > 0, 'probe']].filter(([f]) => f).map(([, c]) => c);
  const { waives } = overrideScope(override);
  const unwaived = override ? failing.filter((c) => !waives.includes(c)) : failing;
  return { originH, edsH, ...aligned, pixelPass: !!pixelPass, heightPass: !!heightPass, clipped, clipPass, clipAllowance: allowance, contentPass, contentNA, unitPass, pixelOnlyPass, pass, failing, unwaived, passWithOverride: pass || (!!override && !unwaived.length), fontsNotLoaded: fonts, fontChecksSkipped: skipped, probeErrors, reasons, notes };
}
// An unstable frozen reference: the origin's error, the pixel error and the row's reason, as one string.
export const UNSTABLE = /^reference-unstable: /;
// Totals: an error row has no percentage or a probe that errored — never counted as FAIL; a FAIL was fully measured.
export const isErrorRow = (r) => r.pct == null || !!(r.probeErrors && r.probeErrors.length);
// UNITS NOT DECLARED: a page no family applies to (no units.json, an empty one, none naming its slug or template) did
// not take the repeated-unit check — `unitsDeclared: 0`, one `notes` entry, totals.unitsNotDeclared. Never a reason.
export const SCHEMA_DIR = 'stardust/eds-schema';
/** Repeat groups of ≥ 2 units in the page's section schema (deploy/section-schema.mjs); null = no readable schema. */
export const repeatGroups = (schema) => (schema && Array.isArray(schema.sections) ? schema.sections.reduce((n, s) => n + (s && Array.isArray(s.repeats) ? s.repeats.filter((x) => x && x.count >= 2).length : 0), 0) : null);
/** The row's note when no family applies to the page (null when one does); `recorded` = repeatGroups of its schema. */
export const unitsNote = (declared, recorded = null, slug = '<slug>') => (declared > 0 ? null
  : `units: no family declared for this page — the repeated-unit check did not run${recorded > 0 ? ` (${recorded} repeated module(s) recorded for this page in ${SCHEMA_DIR}/${slug}.json, 0 unit families declared in stardust/replica/units.json)` : ''}`);
/** The row's unit fields: { unitsDeclared, unitsRecorded, notes } — `notes` = the verdict's notes plus the units one. */
export function unitsState(declared, schema, slug, notes = []) {
  const recorded = declared > 0 ? null : repeatGroups(schema); const note = unitsNote(declared, recorded, slug);
  return { unitsDeclared: declared, unitsRecorded: recorded, notes: note ? [...notes, note] : notes };
}

const cell = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
export function formatSummary(summary) {
  const t = summary.totals; const p = summary._provenance;
  // the dead faces, named once across the table (the calibration line)
  const faces = summary.rows.flatMap((r) => r.fontsNotLoaded || []);
  const named = (list) => [...new Set(list.map(fontLabel))].sort();
  const fonts = named(faces.filter(fontFails)); const sourceDead = named(faces.filter((f) => !fontFails(f)));
  const title = p.wide ? `Wide report — ${p.stage === 'prototype' ? 'every crafted prototype' : 'all deployed pages'} (a report, not a delivery criterion)` : p.stage === 'prototype' ? 'Prototype gate — every crafted prototype' : 'Published-origin gate — all deployed pages';
  const head = [`# ${title}, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error of ${t.pages}**${t.overridePass ? ` (+${t.overridePass} documented override${t.overridePass > 1 ? 's' : ''} → ${t.passWithOverrides} delivered)` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}${t.failOffsets ? ` (${t.failOffsets} on offsets alone)` : ''}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}${t.fontsNotLoaded ? `, fonts not loaded ${t.fontsNotLoaded}${fonts.length ? ` (${fonts.join(', ')})` : ''}` : ''}${t.fontChecksSkipped ? `, font check skipped ${t.fontChecksSkipped}` : ''}${t.probeErrors ? `; probe errors ${t.probeErrors} (error rows, not FAIL)` : ''}${sourceDead.length ? `; fonts dead on the source — reported, not failing: ${t.fontsDeadOnSource ?? summary.rows.filter((r) => (r.fontsNotLoaded || []).some((f) => !fontFails(f))).length} (${sourceDead.join(', ')})` : ''}; content n/a (origin not probed) ${t.contentNA}${t.unitsNotDeclared ? `; **units not declared ${t.unitsNotDeclared} of ${t.pages}** (no repeated-unit family applies: the check did not run on them${t.unitsRecordedNotDeclared ? `; ${t.unitsRecordedNotDeclared} of them have repeated modules recorded` : ''})` : ''}${t.degradedTier ? `; **${t.degradedTier} page(s) probed on a degraded browser tier** (Chrome elected, Chromium used — install Chrome for bot-managed origins)` : ''}${t.asymmetricOrigins ? `; ${t.asymmetricOrigins} asymmetric origin(s)` : ''}${t.alignedOnlyPass != null ? `; pixel criterion met only thanks to alignment (unaligned % over the threshold): ${t.alignedOnlyPass}` : ''}${t.offsetsWithinTolerance ? `; offsets over the strict bound, within the roster tolerance: ${t.offsetsWithinTolerance}` : ''}${t.referenceUnstable ? `; **${t.referenceUnstable} unstable reference(s)** (error rows — pin the page's state, then --recapture-origin)` : ''}${p.wide ? `; over the threshold at this width: **${t.overThreshold ?? 0} of ${t.pages}**` : ''}.`, ''];
  const rows = ['| page | template | tier | origin | browser | pixel % aligned (unaligned) [text] | offsets | Δh px | clipped | content | units | verdict | reasons |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const probeErr = (r.probeErrors || []).map((e) => e.probe);
    const content = probeErr.includes('content') ? 'ERROR' : r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = probeErr.includes('units') ? 'ERROR' : r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}${r.unitsDeclared > 0 ? ` (${r.unitsDeclared} famil${r.unitsDeclared > 1 ? 'ies' : 'y'} checked)` : ''}` : r.unitsDeclared === 0 ? 'not declared' : r.unitsDeclared > 0 ? `no result (${r.unitsDeclared} declared)` : '-';
    const fontsOnly = r.pixelOnlyPass && Array.isArray(r.reasons) && r.reasons.length > 0 && r.reasons.every((x) => /^font-(not-loaded|check-skipped):/.test(x));
    const verdictCell = r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : probeErr.length ? `ERROR (probe: ${probeErr.join(', ')})` : fontsOnly ? 'FAIL (fonts)' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${r.browser || '-'} | ${r.alignedUsed ? `${cell(r.alignedPct)} (${cell(r.pct)})` : cell(r.pct)}${r.textPct != null ? ` [${r.textPct}]` : ''} | ${r.alignedUsed && r.steps && r.steps.length ? `${r.steps.length}${r.steps.length >= OFFSETS.kept ? '+' : ''} step(s), ${r.totalShift}px${r.offsetBound != null ? ` (bound ${r.offsetBound}${r.offsetJudge === 'tolerance' ? `, tolerance ${r.offsetTolerance}` : ''})` : ''}` : '-'} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? (r.passWithOverride === false ? ` → NOT WAIVED: ${(r.unwaived || []).join(', ')} (override waives ${overrideScope(r.override).waives.join(', ')}): ${r.override.reason}` : ` → ${r.override.verdict}: ${r.override.reason}`) : ''} | ${[...r.reasons, ...(r.notes || []).map((x) => `(reported) ${x}`), ...(r.hint ? [`(hint) ${r.hint}`] : [])].join('; ') || '-'} |`);
  }
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const REFERENCE = join(HERE, 'reference.mjs');
// The diff skill's scripts dir (content-presence, clip-probe, unit-geometry), in whichever layout holds it (lib/resolve.mjs).
const DIFF_DIR = (() => { const p = siblingPath('diff', 'unit-geometry.mjs'); return p ? dirname(p) : null; })();
const { unitsFor } = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'unit-geometry.mjs')).href) : { unitsFor: () => [] };
const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const readJsonSafe = (p) => { try { return readJson(p); } catch { return null; } };

// The staleness rule gate.sh applies to a cached live.png, for any stitched capture gate-all would reuse: one taken
// before fixed / sticky layers were captured once has no fixedLayers in its capture record (<stem>.capture.json,
// stitch-shot's sidecar) and repeats a sticky header at every seam — compared with a side captured the new way, an
// asymmetric diff. A live.png copied from the frozen baseline (live.json origin "baseline") has no capture record;
// baseline.json's fixedLayers decides. → true when the capture must be retaken.
export const captureRecordOf = (png) => `${png.replace(/\.png$/i, '')}.capture.json`;
// `hold` (the timer hold the run captures this page under: ms, or null) joins the rule: a capture taken under another
// hold — none against one, or another threshold — is retaken too (record.timers.hold; stitch-shot --hold-timers).
// staleReason → null (reusable) | the words for the log line; staleCapture → true when the capture must be retaken.
export function staleReason(png, hold = null) {
  const FIXED = 'predates the fixed-layer capture (no fixedLayers in its record)';
  const why = (r) => (!r.fixedLayers ? FIXED : ((r.timers && r.timers.hold) || null) !== (hold || null) ? `was captured under another timer hold (${(r.timers && r.timers.hold) || 'none'}, this run ${hold || 'none'})` : null);
  const rec = readJsonSafe(captureRecordOf(png));
  if (rec) return why(rec);
  const live = basename(png) === 'live.png' ? readJsonSafe(join(dirname(png), 'live.json')) : null;
  if (live && live.origin === 'baseline') return why(readJsonSafe(join(dirname(png), 'baseline.json')) || {});
  return FIXED;
}
export const staleCapture = (png, hold = null) => staleReason(png, hold) !== null;

/** Two capture records (stitch-shot's) → null when both were taken under the same timer hold (or one has no record: a
 * crawl shot, already flagged asymmetric), else the one-line error of the row. */
export function holdMismatch(originRec, buildRec) {
  if (!originRec || !buildRec) return null;
  const h = (r) => (r.timers && r.timers.hold) || null;
  return h(originRec) === h(buildRec) ? null : `timer hold differs: origin ${h(originRec) ?? 'none'}, build ${h(buildRec) ?? 'none'} (ms) — not compared; re-run with --recapture-origin or --recapture-eds`;
}

// Disk (#156): a passed page keeps its records, not its pictures. Every PNG in its dir goes (an extra capture put
// there too) — except baseline.png, the page's frozen reference: the next run gates against it instead of spending
// three live captures on a new one; pixel.json records the drop with the masks and eds URL the pass was measured
// with → PNGs deleted.
// `key` + `probes` (a live run's pass: passKey, and the probe results the verdict read) make the record the page's
// WHOLE verdict, which --skip-existing reuses without a probe (recordedPass); without them it is the pixel pass alone.
// Written through a sibling temp file + rename: a run killed here leaves the previous pixel.json, never half of one.
export function dropPassedCaptures(d, { masks = [], edsUrl, key = null, probes = null, at = null }) {
  const pixel = readJsonSafe(join(d, 'pixel.json'));
  if (!pixel) return 0;
  const pngs = readdirSync(d).filter((f) => f.endsWith('.png') && f !== 'baseline.png');
  for (const f of pngs) rmSync(join(d, f), { force: true });
  const tmp = join(d, `pixel.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify({ ...pixel, capturesDropped: { masks, edsUrl, ...(key && probes ? { key, probes, at: at || new Date().toISOString() } : {}) } }, null, 2));
  renameSync(tmp, join(d, 'pixel.json'));
  return pngs.length;
}
/** A short digest of a value (canonical enough: the same code builds both sides) or of a file's bytes (null: unreadable). */
export const digest = (v) => createHash('sha256').update(Buffer.isBuffer(v) ? v : JSON.stringify(v ?? null)).digest('hex').slice(0, 16);
export const fileDigest = (f) => { try { return digest(readFileSync(f)); } catch { return null; } };
/**
 * THE REUSE KEY of a recorded pass (header § REUSE): one digest per ingredient, so a refused reuse names what changed.
 * passKey(parts) → { v, build, source, masks, presence, clipAllow, override, units, options, reference, archetype,
 * captures, instruments[, prototype], 'page content'[, 'shared code'][, 'block <name>' …] }, or null when an ingredient that must be read cannot be (`parts.captures` /
 * `parts.instruments` holding a null, a `reference` whose baseline.json is unreadable, a `prototype` file that is,
 * `parts.inputs` — localInputs' answer for the page — missing or naming something unresolved) — a key that cannot
 * be computed is never written and never matches.
 */
export const PASS_FORMAT = 3;
export function passKey({ build, source, masks = null, presence = null, clipAllow = null, override = null, units = [], options = {}, reference = null, archetype = [], captures = [], instruments = [], prototype, inputs = null }) {
  if (!build || !source || captures.length !== 2 || captures.some((c) => !c) || !instruments.length || instruments.some((c) => !c)) return null;
  if (reference && !reference.baseline) return null;
  if (prototype === null) return null; // a prototype file was named and could not be read
  if (!inputs || (inputs.unresolved || []).length || !inputs.content) return null; // the page's local build inputs: never the weaker key
  return { v: PASS_FORMAT, build, source, masks: digest(masks), presence: digest(presence), clipAllow: digest(clipAllow), override: digest(override), units: digest(units), options: digest(options), reference: digest(reference), archetype: digest(archetype), captures: digest(captures), instruments: digest(instruments), ...(prototype ? { prototype } : {}),
    'page content': inputs.content, ...(inputs.shared ? { 'shared code': inputs.shared } : {}), ...Object.fromEntries(Object.entries(inputs.blocks || {}).map(([name, d]) => [`block ${name}`, d])) };
}
/**
 * THE PAGE'S LOCAL BUILD INPUTS (header § REUSE): what the page is built from in the project's working tree, by
 * content — never an mtime, never a fetch. localInputs({ root, contentDir, stage, coverage }) → inputsOf(page) →
 * { content, blocks: { <name>: digest }, shared, unresolved: [why, …] }; `unresolved` non-empty = no key.
 * Published stage — page content: the delivered content file (`<contentDir>/<path>.html`, else `<path>/index.html`,
 * the root page `index.html` — the deploy tree, as rollout's da-library and gate-evidence resolve it) and the
 * migrated HTML it is rendered from (the ledger row's source.migratedHtml, else the state row's migratedPath) — the
 * files that exist; neither = unresolved. Blocks: the ledger row's `blocks` and the first class of every
 * `<div class>` of the content file, kept when `blocks/<name>/` exists — every file under it; no `blocks/` directory
 * = unresolved. Shared code: foundation-freeze's file set (styles/, fonts/, blocks/header/, blocks/footer/,
 * head.html, scripts/) plus the header and footer fragments (`nav.html`, `footer.html` in the content dir and one
 * level down); none of them in the project = unresolved. Prototype stage — page content: the prototype file and
 * the local files it links (href / src, relative to it; one level, not what a stylesheet imports); no blocks, no
 * shared set. Directories are walked as the foundation manifest walks them (`snapshot`: dot-entries and node_modules
 * skipped, a symlink by its link text). The shared digest is computed once per resolver, a block's once per block
 * (`stats` counts them).
 */
export function localInputs({ root = '.', contentDir = 'content', stage = 'published', coverage = null, snap = snapshot } = {}) {
  const stats = { shared: 0, blocks: 0, content: 0 };
  const rows = new Map((Array.isArray(coverage) ? coverage : (coverage && Array.isArray(coverage.pages) ? coverage.pages : [])).filter((r) => r && r.slug).map((r) => [r.slug, r]));
  const at = (f) => (isAbsolute(f) ? f : join(root, f));
  const isFile = (f) => { try { return statSync(at(f)).isFile(); } catch { return false; } };
  const isDir = (f) => { try { return statSync(at(f)).isDirectory(); } catch { return false; } };
  const of = (paths) => { const files = snap(root, paths); return Object.keys(files).length ? digest(files) : null; };
  let shared; const blockOf = new Map();
  const sharedDigest = () => {
    if (shared === undefined) {
      stats.shared += 1;
      const fragments = isDir(contentDir) ? ['', ...readdirSync(at(contentDir)).filter((n) => !n.startsWith('.') && isDir(join(contentDir, n)))].flatMap((d) => ['nav.html', 'footer.html'].map((n) => join(contentDir, d, n))).filter(isFile) : [];
      // the foundation set must hold something: the fragments alone are not the shared code
      try { const base = snap(root, FOUNDATION_PATHS); shared = Object.keys(base).length ? digest({ ...base, ...snap(root, fragments) }) : null; } catch { shared = null; }
    }
    return shared;
  };
  const blockDigest = (name) => {
    if (!blockOf.has(name)) { stats.blocks += 1; let d = null; try { d = of([`blocks/${name}/`]); } catch { d = null; } blockOf.set(name, d); }
    return blockOf.get(name);
  };
  return Object.assign((p) => {
    stats.content += 1;
    const unresolved = [];
    if (stage === 'prototype') {
      const proto = p.prototypePath;
      if (!proto || !isFile(proto)) return { content: null, blocks: {}, shared: null, unresolved: [`page content cannot be resolved: no prototype file${proto ? ` at ${proto}` : ''}`] };
      const html = readFileSync(at(proto), 'utf8');
      const linked = [...new Set([...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"'#?]+)/g)].map((m) => m[1]).filter((u) => !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u)).map((u) => (u.startsWith('/') ? u.slice(1) : join(dirname(proto), u))))].filter(isFile).sort();
      return { content: digest([proto, ...linked].map((f) => [f, fileDigest(at(f))])), blocks: {}, shared: null, unresolved };
    }
    const row = rows.get(p.slug) || {};
    let path; try { path = p.deployedPath || row.path || new URL(p.liveUrl).pathname; } catch { path = null; }
    const rel = path == null ? null : (path.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index');
    const delivered = rel == null ? null : [`${rel}.html`, `${rel}/index.html`].map((c) => join(contentDir, c)).find(isFile) || null;
    const migrated = [row.source && row.source.migratedHtml, p.migratedPath].find((f) => typeof f === 'string' && f.includes('/') && isFile(f)) || null;
    const files = [delivered, migrated].filter(Boolean);
    if (!files.length) unresolved.push(`page content cannot be resolved: no content file for ${path || p.slug} under ${contentDir}/ and no migrated HTML`);
    if (!isDir('blocks')) unresolved.push('blocks cannot be resolved: no blocks/ directory in the project');
    const sharedD = sharedDigest();
    if (!sharedD) unresolved.push(`shared code cannot be resolved: none of ${FOUNDATION_PATHS.join(' ')} in the project`);
    if (unresolved.length) return { content: null, blocks: {}, shared: null, unresolved };
    const named = [...(Array.isArray(row.blocks) ? row.blocks : []), ...(delivered ? [...readFileSync(at(delivered), 'utf8').matchAll(/<div[^>]*\bclass\s*=\s*["']\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]) : [])];
    const blocks = {};
    for (const name of [...new Set(named.filter((n) => typeof n === 'string' && /^[A-Za-z0-9_-]+$/.test(n)))].sort()) { if (name !== 'header' && name !== 'footer' && isDir(`blocks/${name}`)) { const d = blockDigest(name); if (d) blocks[name] = d; } }
    return { content: digest(files.map((f) => [f, fileDigest(at(f))])), blocks, shared: sharedD, unresolved };
  }, { stats });
}
/**
 * recordedPass(d, key) → { origin, eds, pixel, probes } — the page's whole recorded verdict — or { miss: [why, …] }
 * (null when the dir records no pass at all). Fail closed: a record without a key or probe results (written before
 * the key, or by --compare-only), of another format, a `key` that could not be computed, any differing ingredient
 * (named), or a capture meta that is gone or holds an error is a miss.
 */
export function recordedPass(d, key) {
  const pixel = readJsonSafe(join(d, 'pixel.json'));
  const drop = pixel && pixel.capturesDropped;
  if (!drop) return null;
  const was = drop.key;
  if (!was || typeof was !== 'object' || was.v !== PASS_FORMAT || !drop.probes || typeof drop.probes !== 'object') return { miss: ['recorded without its probe results or in another format'] };
  if (!key) return { miss: ['this run\'s key cannot be computed'] };
  const names = [...new Set([...Object.keys(was), ...Object.keys(key)])].filter((k) => was[k] !== key[k]);
  if (names.length) return { miss: names.map((k) => `${k} changed`) };
  const origin = readJsonSafe(join(d, 'origin.json')); const eds = readJsonSafe(join(d, 'eds.json'));
  if (!origin || !eds || origin.error || eds.error) return { miss: ['a capture record is gone or holds an error'] };
  return { origin, eds, pixel, probes: drop.probes };
}
// The recorded PIXEL pass --compare-only takes instead of the PNGs it no longer has: null when nothing was dropped, a
// record is gone, or the masks or eds URL differ from the ones the pass was measured with (--skip-existing: recordedPass).
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
  if (opts.deadlineHint) { // run-bg.mjs's question: one integer, no capture, no file written
    const st = readJsonSafe(opts.state);
    if (!st) { console.error(`gate-all: ${opts.state} not found or unreadable — no deadline hint`); process.exit(1); }
    const sel = selectPages({ state: st, coverage: opts.stage === 'prototype' ? null : readJsonSafe(opts.coverage), stage: opts.stage, protoBase: opts.protoBase, edsHost: opts.edsHost, only: opts.only, protoExists: (f) => existsSync(f) });
    console.log(String(deadlineHint(sel.pages.length, opts)));
    return;
  }
  const ignoreNote = referenceIgnoreNote(readTextSafe('stardust/.gitignore'));
  if (ignoreNote) console.error(`gate-all: ${ignoreNote}`);
  if (!existsSync(opts.state)) { console.error(`gate-all: ${opts.state} not found — run from the project root or pass --state`); process.exit(1); }
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = readJson(opts.state);
  const coverage = opts.stage === 'prototype' ? null : readJsonSafe(opts.coverage);
  const { pages, skipped, from } = selectPages({ state, coverage, stage: opts.stage, protoBase: opts.protoBase, edsHost: opts.edsHost, only: opts.only, protoExists: (f) => existsSync(f) });
  if (opts.stage === 'prototype' && !opts.protoBase) console.error('gate-all: --stage prototype without --proto-base — assuming http://localhost:8791 (serve the prototypes dir there, replica SKILL.md § Phase 4)');
  for (const s of skipped) console.error(`gate-all: ${s.slug} NOT gated — ${s.why}`);
  for (const slug of unselected(opts.only, pages, skipped)) console.error(`gate-all: ${slug} NOT gated — named with --only, but neither ${opts.state} nor ${opts.coverage} has a row for that slug`);
  if (!pages.length) {
    console.error(opts.stage === 'prototype'
      ? `gate-all: no prototype pages selected — ${opts.state} has no row with a prototypePath and a url${opts.only ? ` among --only ${opts.only.join(',')}` : ''}`
      : `gate-all: no deployed pages selected${opts.only ? ` among --only ${opts.only.join(',')}` : ''} — two sources consulted: ${opts.state} (rows with status "deployed" + liveUrl + url: none) and ${opts.coverage} (${coverage ? `rows with delivery.status ${DELIVERED.join(' | ')}, or failed on a gate, and a build URL: none${skipped.length ? `; ${skipped.length} skipped above` : ''}` : (existsSync(opts.coverage) ? 'unreadable' : 'not found')}). Record the delivery (rollout's update-coverage.mjs <slug> --status deployed --url <u>) or pass --state / --coverage.`);
    process.exit(1);
  }
  if (opts.stage !== 'prototype') console.error(`gate-all: ${pages.length} page(s) — ${from.state} from ${opts.state}, ${from.coverage} from ${opts.coverage}`);
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  for (const [slug, o] of Object.entries(OVERRIDES)) {
    const s = overrideScope(o);
    if (s.unknown.length) console.error(`gate-all: overrides.json ${slug}: unknown criteria in waives (${s.unknown.join(', ')}); known: ${WAIVABLE.join(', ')}`);
    if (s.legacy) console.error(`gate-all: overrides.json ${slug} names no "waives" — it waives ${LEGACY_WAIVES.join(', ')}; a clip, content or units failure must be named`);
  }
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
  // The capture settings a usable reference was frozen with against this run's (header § SETTINGS): reference.mjs's
  // own comparison, once per reference dir → { changed: 'consent, locale' | null, unrecorded, why }. A reference.mjs
  // without the subcommand answers nothing: reused as before. The hold (--help § Timer hold): a run that names none
  // does not give it against a held reference (its threshold is inherited); one that turns it off never reuses a held
  // reference; `why` = HOLD_DEFAULT_WHY when the default is what asked for the hold.
  const settingsSeen = new Map();
  const settingsOf = (refDir) => {
    if (!settingsSeen.has(refDir)) {
      const held = refHold(readJsonSafe(join(refDir, 'baseline.json')));
      settingsSeen.set(refDir, run('node', [REFERENCE, 'settings', refDir, ...givenFlags(!opts.holdGiven && held ? { ...opts, holdTimers: null } : opts)]).then((s) => {
        const line = lastLine(s.out);
        const names = [s.code === 0 && line.startsWith('changed: ') ? line.slice(9) : s.code !== 0 && opts.holdTimers ? 'holdTimers (reference.mjs settings gave no answer)' : null, opts.holdGiven && !opts.holdTimers && held ? 'holdTimers' : null].filter(Boolean);
        const changed = names.join(', ') || null;
        return { changed, unrecorded: s.code === 0 && line === 'not recorded', why: !opts.holdGiven && s.code === 0 && /holdTimers/.test(changed || '') ? HOLD_DEFAULT_WHY : '' };
      }));
    }
    return settingsSeen.get(refDir);
  };
  // a reused origin or recorded pass (--skip-existing / --compare-only) stands only while its reference's settings do
  const referenceMoved = async (meta) => !opts.liveOrigin && !opts.compareOnly && !!(meta && meta.reference && meta.reference.dir) && existsSync(join(meta.reference.dir, 'baseline.json')) && !!(await settingsOf(meta.reference.dir)).changed;
  // --skip-existing reuses a capture and its meta — unless it is a stitch taken before fixed layers were captured once
  // (staleCapture): retaken, one log line, so both sides of the compare capture alike.
  const reusable = (p, side, png, meta, quiet = false) => {
    if (!existsSync(png) || !existsSync(meta)) return false;
    const stale = (readJsonSafe(meta) || {}).instrument === 'stitch-live' ? staleReason(png, optsFor(p).holdTimers) : null;
    if (!stale) return true;
    if (!quiet) log(`${side} ${p.slug}: ${png} ${stale} — retaking it`);
    return false;
  };
  // stitch-shot's capture record (captureRecordOf: <side>.capture.json beside the PNG; stitch-shot removes it when a
  // capture starts, and so does this — a stitch that never started leaves no stale one) → the meta's fontsFailed
  // (+ fontCheck when it says why): shotFonts — no readable record is unchecked (null), never "all loaded".
  // A page's build capture and probes run under its frozen reference's settings where the run omits them (the
  // archetype gate dir's reference, else the page dir's; read before any capture, so the two pools need no order).
  const optsOf = new Map();
  const optsFor = (p) => {
    if (opts.liveOrigin) return opts;
    if (!optsOf.has(p.slug)) {
      const base = [join('stardust/replica/gates', `${p.slug}-${opts.width}`), dir(p)].map((d) => readJsonSafe(join(d, 'baseline.json'))).find((b) => b && b.flags);
      optsOf.set(p.slug, inheritedOpts(opts, base && base.flags));
    }
    return optsOf.get(p.slug);
  };
  // Every child that opens a browser holds a unit of the job's budget (`browsers`, sized below once the reuse is decided).
  const stitch = (kind, url, out, tail = [], o = opts) => { rmSync(captureRecordOf(out), { force: true }); return browsers(kind, () => run('node', stitchArgs(STITCH, url, out, o, tail))); };
  // Before a side is captured again its previous PNG, record and diff go: a capture that fails leaves no picture, so
  // the row is a missing capture (an error, no percentage) — never a diff of the old PNG against the other side.
  const forgetCapture = (d, out) => { for (const f of [out, captureRecordOf(out), join(d, 'diff.png')]) rmSync(f, { force: true }); };

  // The page's frozen reference (header § ORIGIN). usable(dir): stitch-shot's `baseline <dir>` — the one definition
  // of a usable frozen baseline, no browser. fromReference: origin.png = its copy, the capture record from baseline.json
  // (fixedLayers, fontsFailed — the copy has no record of its own), the meta carries `reference`.
  const usable = async (refDir, p) => existsSync(join(refDir, 'baseline.png')) && existsSync(join(refDir, 'baseline.json')) && (await run('node', [STITCH, 'baseline', refDir, '--url', p.url, '--width', String(opts.width)])).code === 0;
  const fromReference = (refDir, out, how) => {
    const base = readJsonSafe(join(refDir, 'baseline.json')) || {};
    copyFileSync(join(refDir, 'baseline.png'), out);
    const src = { writtenBy: 'gate-all.mjs', copiedFrom: join(refDir, 'baseline.png'), fixedLayers: base.fixedLayers, ...(base.timers ? { timers: base.timers } : {}), ...('fontsFailed' in base ? { fontsFailed: base.fontsFailed, ...(base.fontCheck ? { fontCheck: base.fontCheck } : {}), ...(Array.isArray(base.deadFaces) ? { deadFaces: base.deadFaces } : {}) } : {}) };
    writeFileSync(captureRecordOf(out), `${JSON.stringify(src, null, 2)}\n`);
    return { instrument: 'stitch-live', url: base.url, reference: referenceOf(base, refDir), note: `${how} ${join(refDir, 'baseline.png')} (the page's frozen reference — primed, not re-captured)`, ...shotFonts(src) };
  };
  async function captureOrigin(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'origin.png'); const meta = join(d, 'origin.json');
    if (opts.skip && !opts.recaptureOrigin && reusable(p, 'origin', out, meta) && !(await referenceMoved(readJsonSafe(meta)))) { rec(p, 'origin', readJson(meta)); return; }
    forgetCapture(d, out); // and a copied origin carries its source's record, or none
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    const gateDir = join('stardust/replica/gates', `${p.slug}-${opts.width}`);
    const cachedLive = join(gateDir, 'live.png');
    const blocked = opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked;
    // Where the origin comes from: a usable frozen reference (the archetype gate dir's, else the page dir's), the
    // prototype stage's cached live.png, or a reference frozen now (freezeInto). --recapture-origin deletes the
    // reference where it lives and freezes there again; --live-origin skips the reference altogether.
    let refDir = null; let freezeInto = null; const setAside = [];
    if (!opts.liveOrigin && !blocked) {
      if (opts.recaptureOrigin) {
        freezeInto = existsSync(join(gateDir, 'baseline.json')) || existsSync(join(gateDir, 'baseline.png')) ? gateDir : d;
        // set aside, not deleted: a freeze that ends without an answer (challenge, deadline, error) puts it back
        for (const where of new Set([freezeInto, d])) for (const f of ['baseline.png', 'baseline.json']) { const from = join(where, f); if (existsSync(from)) { renameSync(from, `${from}.prev`); setAside.push(from); } }
      } else if (await usable(gateDir, p)) refDir = gateDir;
    }
    let useCached = !refDir && !freezeInto && opts.stage === 'prototype' && existsSync(cachedLive);
    const staleLive = useCached ? staleReason(cachedLive, optsFor(p).holdTimers) : null;
    if (staleLive) { useCached = false; log(`origin ${p.slug}: ${cachedLive} ${staleLive} — not reused, capturing the origin`); }
    if (!opts.liveOrigin && !blocked && !refDir && !freezeInto && !useCached) { if (await usable(d, p)) refDir = d; else freezeInto = d; }
    let refrozen = null; let why = ''; let freezeOpts = opts;
    if (refDir) {
      const st = await settingsOf(refDir);
      if (st.changed) {
        // frozen again under the settings the build side runs under (optsFor, read before the old reference goes):
        // the run's — plus, when only the default hold changed, the ones the old reference recorded
        freezeOpts = optsFor(p);
        refrozen = st.changed; why = st.why; freezeInto = refDir; refDir = null; settingsSeen.delete(freezeInto);
        for (const f of ['baseline.png', 'baseline.json']) rmSync(join(freezeInto, f), { force: true });
      } else if (st.unrecorded) log(`origin ${p.slug}: reference: reused — settings not recorded (${join(refDir, 'baseline.json')} was frozen by an older version)`);
    }
    let r;
    if (freezeInto) {
      const s = await browsers('origin', () => run('node', [REFERENCE, 'freeze', p.url, freezeInto, '--width', String(opts.width), ...passThrough('stitch-shot', freezeOpts), ...(opts.vh ? ['--vh', String(opts.vh)] : []), '--headed'], { timeoutMs: 3 * 480000 }));
      const line = lastLine(s.out).replace(/^reference: /, '');
      // frozen (0) or measured unstable (2): the old reference is superseded; anything else answered nothing
      for (const from of setAside) { if (s.code === 0 || s.code === 2) rmSync(`${from}.prev`, { force: true }); else renameSync(`${from}.prev`, from); }
      if (s.code !== 0 && s.code !== 2 && setAside.length && await usable(freezeInto, p)) { refDir = freezeInto; log(`origin ${p.slug}: re-freeze exit ${s.code} (${line || lastLine(s.err)}) — the previous frozen reference is kept`); }
      else if (s.code === 0) {
        refDir = freezeInto;
        if (refrozen) log(`origin ${p.slug}: reference: re-frozen — capture settings changed (${refrozen})${why}`);
        // the page dir keeps the frozen reference only: reference.mjs's kept captures and their diffs go (#156, disk)
        if (freezeInto === d) for (const f of readdirSync(d)) if (/^ref-(\d|diff-).*\.(png|capture\.json)$/.test(f)) rmSync(join(d, f), { force: true });
      } else if (s.code === 2) { const hint = hintOf(readJsonSafe(join(freezeInto, 'reference-unstable.json'))); r = { instrument: 'none', error: `reference-unstable: ${line.replace(/^UNSTABLE — /, '')} (${join(freezeInto, 'reference-unstable.json')})`, ...(hint ? { hint } : {}) }; }
      else if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `reference freeze exit ${s.code}: ${line || lastLine(s.err)} — crawl screenshot used` }; }
      else r = { instrument: 'none', error: `reference freeze exit ${s.code}: ${line || lastLine(s.err)}` };
    }
    if (r) { /* the freeze decided: an error, or the crawl shot */ }
    else if (refDir) r = fromReference(refDir, out, refDir === freezeInto ? 'froze' : 'reused');
    else if (useCached) {
      copyFileSync(cachedLive, out);
      // its record goes with it (a frozen-baseline copy has none: baseline.json's fixedLayers and fontsFailed stand in),
      // so a later --skip-existing round reads the same rule, and the font check (shotFonts) reads the record that went
      const base = readJsonSafe(join(dirname(cachedLive), 'baseline.json')) || {};
      const src = readJsonSafe(captureRecordOf(cachedLive)) || { writtenBy: 'gate-all.mjs', copiedFrom: cachedLive, fixedLayers: base.fixedLayers, ...(base.timers ? { timers: base.timers } : {}), ...('fontsFailed' in base ? { fontsFailed: base.fontsFailed, ...(base.fontCheck ? { fontCheck: base.fontCheck } : {}), ...(Array.isArray(base.deadFaces) ? { deadFaces: base.deadFaces } : {}) } : {}) };
      writeFileSync(captureRecordOf(out), `${JSON.stringify(src, null, 2)}\n`);
      r = { instrument: 'stitch-live', note: `reused ${cachedLive} (the archetype round's capture — hit minimisation)`, ...shotFonts(src) };
    }
    else if (blocked) {
      if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `origin matches --blocked ${opts.blocked}; crawl screenshot used (lazy rails may be placeholders)` }; }
      else r = { instrument: 'none', error: `origin blocked and no crawl shot at ${crawlShot}` };
    } else {
      const s = await stitch('origin', p.url, out, ['--headed']);
      if (s.code !== 0) rmSync(out, { force: true }); // a stitch that died mid-write leaves no partial PNG to diff
      if (s.code === 0) r = { instrument: 'stitch-live', url: p.url, log: s.out.trim().split('\n').slice(-2), ...shotFonts(readJsonSafe(captureRecordOf(out))) };
      else if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `stitch exit ${s.code}: ${lastLine(s.err)} — crawl screenshot used` }; }
      else r = { instrument: 'none', error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    }
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'origin', r);
    log(`origin ${p.slug} → ${r.instrument}${r.reference ? ` (frozen reference ${r.reference.dir}${r.reference.noiseFloor != null ? `, noise floor ${r.reference.noiseFloor}%, ${r.reference.variableRows} self-varying rows masked` : ', noise floor not measured'})` : ''}${r.error ? ` ERROR ${r.error}` : ''}`);
    const hint = (r.reference && r.reference.hint) || r.hint || null;
    if (hint) log(`origin ${p.slug}: hint: ${hint}`);
  }
  async function captureEds(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'eds.png'); const meta = join(d, 'eds.json');
    if (opts.skip && !opts.recaptureEds && reusable(p, 'eds', out, meta)) { rec(p, 'eds', readJson(meta)); return; }
    forgetCapture(d, out);
    const s = await stitch('eds', edsUrl(p), out, [], optsFor(p));
    if (s.code !== 0) rmSync(out, { force: true }); // a stitch that died mid-write leaves no partial PNG to diff
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p), ...shotFonts(readJsonSafe(captureRecordOf(out))) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  // The probe processes in flight, across the pages of the job (--probe-concurrency), each inside the browser budget.
  const probeLimit = limiter(opts.pc);
  const probeSlot = (fn) => probeLimit(() => browsers('probe', fn));
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
    // content, then clip only when content gave no clip result — beside the units probe (it shares no file with them)
    const contentThenClip = async () => {
      if (opts.content) {
        for (const f of ['content.json', 'clip.json']) rmSync(join(d, f), { force: true });
        const s = await probeSlot(() => run('node', contentArgs(join(DIFF_DIR, 'content-presence.mjs'), p.url, edsUrl(p), join(d, 'content.json'), optsFor(p), pr)));
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
        const s = await probeSlot(() => run('node', clipArgs(join(DIFF_DIR, 'clip-probe.mjs'), edsUrl(p), join(d, 'clip.json'), optsFor(p))));
        const clip = readJsonSafe(join(d, 'clip.json'));
        if (clip && clip.counts && (s.code === 0 || s.code === 2)) { put('clip', clipResult(clip)); log(`clip ${p.slug} → ${clip.counts.total}`); }
        else { put('clip', { error: `clip-probe exit ${s.code}: ${lastLine(s.err)}` }); log(`clip ${p.slug} → ERROR ${lastLine(s.err)}`); }
      }
    };
    const unitsProbe = async () => {
      const units = unitsOf(p);
      if (!units.length) return;
      rmSync(join(d, 'units.json'), { force: true });
      const s = await probeSlot(() => run('node', unitArgs(join(DIFF_DIR, 'unit-geometry.mjs'), p.url, edsUrl(p), join(d, 'units.json'), p.slug, units, optsFor(p))));
      const res = readJsonSafe(join(d, 'units.json'));
      const required = units.some((x) => x.required);
      if (res && res.verdict && (s.code === 0 || s.code === 2)) { put('units', { verdict: res.verdict, required, errors: (res.results || []).filter((x) => x.error).map((x) => `${String(x.sel).slice(0, 80)} — ${x.error}`) }); log(`units ${p.slug} → off ${res.verdict.off} hidden ${res.verdict.hidden} missing ${res.verdict.missing}`); }
      else { put('units', { error: `unit-geometry exit ${s.code}: ${lastLine(s.err)}`, required }); log(`units ${p.slug} → ERROR ${lastLine(s.err)}`); }
    };
    await Promise.all([contentThenClip(), unitsProbe()]);
    // the record keeps its key order (content, clip, units) whichever probe ended first
    writeFileSync(join(d, 'probes.json'), JSON.stringify({ writtenBy: 'gate-all.mjs', at: new Date().toISOString(), ...Object.fromEntries(['content', 'clip', 'units'].filter((k) => k in got).map((k) => [k, got[k]])) }, null, 1));
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
    const originMeta = (results[p.slug] || {}).origin || {};
    if (!existsSync(join(d, 'origin.png')) || !existsSync(join(d, 'eds.png'))) {
      const px = { error: UNSTABLE.test(originMeta.error || '') ? originMeta.error : 'missing capture' }; mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px); return;
    }
    // the two sides stitched under different timer holds are two instruments: an error row, nothing compared
    const hm = holdMismatch(readJsonSafe(captureRecordOf(join(d, 'origin.png'))), readJsonSafe(captureRecordOf(join(d, 'eds.png'))));
    if (hm) { const px = { error: hm }; writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px); log(`pixel ${p.slug} → ERROR ${hm}`); return; }
    // masks: the page's masks.json rows, then the frozen reference's self-varying rows (origin.json `reference`)
    const mk = MASKS[p.slug]; const ref = originMeta.reference || null;
    const masks = [...((mk && mk.masks) || []), ...(ref && ref.maskArg ? ref.maskArg.split(',') : [])];
    const args = [PIXEL, join(d, 'origin.png'), join(d, 'eds.png'), '--out', join(d, 'diff.png'), '--threshold', String(opts.threshold), '--offset-max', String(opts.offsetMax ?? opts.stage), '--json', '--timeout', '300'];
    if (masks.length) args.push('--mask', masks.join(','));
    if (existsSync(join(d, 'text-boxes.json'))) args.push('--text-boxes', join(d, 'text-boxes.json'));
    const r = await run('node', args);
    let px; try { px = JSON.parse(r.out); } catch { px = { error: lastLine(r.err) || `exit ${r.code}` }; }
    if (masks.length && !px.error) px.maskReason = [mk && mk.masks && mk.masks.length ? mk.reason || null : null, ref && ref.maskArg ? `self-varying rows of the frozen reference${ref.noiseFloor != null ? ` (noise floor ${ref.noiseFloor}%)` : ''}` : null].filter(Boolean).join('; ') || null;
    writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px);
    log(`pixel ${p.slug} → ${px.error ? `ERROR ${px.error}` : `${px.aligned && px.aligned.used ? `aligned ${px.aligned.pct}% (unaligned ${px.pct}%), ${px.aligned.steps.length} offset step(s) ${px.aligned.totalShift}px` : `${px.pct}%`} Δh ${px.heightDelta}${px.textPct != null ? ` text ${px.textPct}%` : ''} ${px.pass ? 'PASS' : 'FAIL'}${!px.pass && withinTolerance(px) ? ' (strict bound; offsets within the roster tolerance — the row decides)' : ''}${px.maskedRows ? ` [MASKED ${px.maskedRows} rows: ${px.maskReason}]` : ''}`}`);
  }

  const VERDICT_OPTS = { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content, stage: opts.stage, offsetMax: opts.offsetMax };
  function withinTolerance(px) { return verdict({ pixel: px }, VERDICT_OPTS).offsetsWithinTolerance; }
  const rowOf = (p) => {
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip || null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0, capture: { fonts: fontsNotLoaded(r.origin, r.eds), fontsSkipped: fontChecksSkipped(r.origin, r.eds) } }, VERDICT_OPTS);
    const ref = (r.origin && r.origin.reference) || null;
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument,
      pct: px.pct ?? null, textPct: px.textPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      ...unitsState(unitsOf(p).length, readJsonSafe(join(SCHEMA_DIR, `${p.slug}.json`)), p.slug, v.notes),
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      browser: (r.content && r.content.tier) || (r.clip && r.clip.tier) || null,
      override: OVERRIDES[p.slug] || null, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      reference: ref ? ref.dir : null, noiseFloor: ref ? ref.noiseFloor : null, variableRows: ref ? ref.variableRows : 0, hint: (ref && ref.hint) || (r.origin && r.origin.hint) || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null };
  };
  // The reuse key of a page's pass (passKey; header § REUSE), from what this run would gate it with and the capture
  // metas on disk — computed alike when the pass is written and when a later run asks whether it still stands.
  const INSTRUMENTS = [fileURLToPath(import.meta.url), PIXEL, STITCH, REFERENCE, ...(DIFF_DIR ? ['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => join(DIFF_DIR, f)) : [])].map(fileDigest);
  const inputsOf = localInputs({ contentDir: opts.contentDir, stage: opts.stage, coverage });
  const inputsSeen = new Map(); // once per page and job: the key written is the one the run started with
  const inputsFor = (p) => { if (!inputsSeen.has(p.slug)) inputsSeen.set(p.slug, inputsOf(p)); return inputsSeen.get(p.slug); };
  const keyOf = (p, originMeta) => {
    const d = dir(p); const o = optsFor(p); const ref = (originMeta && originMeta.reference) || null;
    const gateDir = join('stardust/replica/gates', `${p.slug}-${opts.width}`);
    return passKey({ build: edsUrl(p), source: p.url, masks: MASKS[p.slug], presence: PRESENCE[p.slug], clipAllow: CLIP_ALLOW[p.slug], override: OVERRIDES[p.slug], units: unitsOf(p),
      options: { stage: opts.stage, width: opts.width, wide: opts.wide, threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, offsetMax: opts.offsetMax, clip: opts.clip, content: opts.content, liveOrigin: opts.liveOrigin, warmup: opts.warmup, vh: opts.vh, blocked: !!(opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked), flags: passThrough('stitch-shot', o) },
      reference: ref && ref.dir ? { dir: ref.dir, baseline: fileDigest(join(ref.dir, 'baseline.json')), png: existsSync(join(ref.dir, 'baseline.png')) } : null,
      archetype: ['baseline.json', ...(opts.stage === 'prototype' ? ['live.json', 'live.capture.json'] : [])].map((f) => fileDigest(join(gateDir, f))),
      captures: [fileDigest(join(d, 'origin.json')), fileDigest(join(d, 'eds.json'))], instruments: INSTRUMENTS, inputs: inputsFor(p),
      ...(opts.stage === 'prototype' ? { prototype: p.prototypePath ? fileDigest(p.prototypePath) : null } : {}) });
  };
  const reused = new Set();
  if (opts.compareOnly && !opts.recaptureEds && !opts.recaptureOrigin) {
    for (const p of pages) {
      const kept = droppedPass(dir(p), measuredWith(p));
      if (!kept || await referenceMoved(kept.origin)) continue;
      reused.add(p.slug); for (const [k, v] of Object.entries(kept)) rec(p, k, v);
      log(`${p.slug} → recorded pass reused (its captures were dropped on the pass)`);
    }
  } else if (opts.skip && !opts.recaptureEds && !opts.recaptureOrigin) {
    // --skip-existing: the recorded pass is the page's whole verdict — no capture, no probe, no compare — while its
    // key holds; the row is rebuilt from the record, and a record that would not pass under this run is not reused.
    for (const p of pages) {
      const kept = recordedPass(dir(p), keyOf(p, readJsonSafe(join(dir(p), 'origin.json'))));
      if (!kept) continue;
      const { unresolved } = inputsFor(p);
      let miss = (unresolved.length ? unresolved : null) || kept.miss || (await referenceMoved(kept.origin) ? ['the reference\'s capture settings changed'] : null);
      if (!miss) {
        rec(p, 'origin', kept.origin); rec(p, 'eds', kept.eds); rec(p, 'pixel', kept.pixel); for (const k of ['content', 'clip', 'units']) rec(p, k, kept.probes[k]);
        if (!rowOf(p).pass) { delete results[p.slug]; miss = ['the record does not pass']; }
      }
      if (miss) { log(`${p.slug} → recorded pass not reused (${miss.join(', ')}) — gated again`); continue; }
      reused.add(p.slug);
      log(`${p.slug} → recorded pass reused (its captures were dropped on the pass)`);
    }
  }
  // Every child that opens a browser holds a unit of the job's budget while it runs (header § BROWSERS).
  // The default is sized to THIS job: the build captures it will really take and the pages it will probe.
  // ONE decision feeds both: `reused` (above) is the set the batches skip (`shoot`) and the set the budget leaves out —
  // a page with a reusable recorded pass opens no browser, so it is neither a page to capture nor a page to probe.
  const toGate = pages.filter((p) => !reused.has(p.slug));
  const jobSize = {
    capture: opts.compareOnly ? 0 : toGate.filter((p) => !(opts.skip && !opts.recaptureEds && reusable(p, 'eds', join(dir(p), 'eds.png'), join(dir(p), 'eds.json'), true))).length,
    probe: opts.compareOnly || !(opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length) ? 0 : toGate.length,
  };
  const browsers = browserBudget({ max: opts.maxBrowsers, eds: Math.min(jobSize.capture, opts.ec), probe: Math.min(jobSize.probe, opts.pc) });
  if (!opts.compareOnly) log(budgetLine(opts, jobSize));
  let dropped = 0;
  const measured = [];
  const stamp = new Date().toISOString(); // one round label for the job, whenever each page's round is written
  // A page's verdict is known: a pass is on disk NOW — its round, then its record (key + probe results) and its PNGs
  // gone — so a job killed later keeps it. A failing page keeps its captures and its records, as it has them already.
  const settle = async (p) => {
    const row = rowOf(p); if (!row.pass) return;
    if (!opts.wide) await recordRounds([row], opts, { now: () => stamp });
    const r = results[p.slug] || {}; const key = keyOf(p, r.origin);
    dropped += dropPassedCaptures(dir(p), { ...measuredWith(p), key, probes: Object.fromEntries(['content', 'clip', 'units'].filter((k) => r[k] !== undefined).map((k) => [k, r[k]])) });
  };
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const shoot = batch.filter((p) => toGate.includes(p));
    if (!opts.compareOnly) measured.push(...shoot);
    for (const p of shoot) forgetDroppedPass(dir(p));
    if (!opts.compareOnly) {
      // the probes read no capture: they start with the batch's captures, under their own limit and the browser budget; a page is
      // compared when its two captures and its probes are done, and settled then — not when the batch is
      const probing = opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length;
      const originSlot = limiter(opts.oc); const edsSlot = limiter(opts.ec); const compareSlot = limiter(4);
      await Promise.all(shoot.map(async (p) => {
        await Promise.all([originSlot(() => captureOrigin(p)), edsSlot(() => captureEds(p)), probing ? probe(p) : null]);
        await compareSlot(() => compare(p));
        await settle(p);
      }));
      continue;
    }
    // --compare-only opens no browser and runs no probe: the recorded results, the sidecars re-applied. Its pass is
    // the pixel pass (no key: a later --skip-existing gates the page), a reused record keeps the key it has.
    for (const p of shoot) for (const side of ['origin', 'eds']) { const m = readJsonSafe(join(dir(p), `${side}.json`)); if (m) rec(p, side, m); }
    for (const p of batch) recallProbes(p);
    await pool(shoot, 4, compare);
    for (const p of batch) {
      if (!rowOf(p).pass) continue;
      const prev = reused.has(p.slug) ? ((readJsonSafe(join(dir(p), 'pixel.json')) || {}).capturesDropped || {}) : {};
      dropped += dropPassedCaptures(dir(p), { ...measuredWith(p), key: prev.key, probes: prev.probes, at: prev.at });
    }
  }
  if (dropped) log(`dropped ${dropped} PNG(s) of passed pages — their records stay (#156)`);
  const rows = pages.map(rowOf);
  const n = (f) => rows.filter(f).length;
  const overCap = opts.wide ? [] : await recordRounds(measured.map((p) => rowOf(p)).filter((r) => !r.pass), opts, { now: () => stamp }); // a report records no round; a pass has its round already (settle)
  if (overCap.length) log(`round cap (source-fidelity-gate.md § Iteration discipline) reached or passed on ${overCap.length} page(s): ${overCap.slice(0, 8).join(', ')}${overCap.length > 8 ? ', …' : ''} — fix per § What a failing row means, or record the decision: rounds.mjs decide ${join(dirname(opts.out), `<slug>-${opts.width}`)} --stage all-pages --decision accept-residual|re-prototype --reason "<why>" (a closed page is not listed again)`);
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && r.passWithOverride), fail: n((r) => !r.pass && !isErrorRow(r)), error: n(isErrorRow), probeErrors: n((r) => r.probeErrors.length > 0),
    failPixel: n((r) => r.pct != null && !r.pixelPass), failHeight: n((r) => r.pct != null && !r.heightPass), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), unitsNotDeclared: n((r) => r.unitsDeclared === 0), unitsRecordedNotDeclared: n((r) => r.unitsDeclared === 0 && r.unitsRecorded > 0), fontsNotLoaded: n((r) => r.fontsNotLoaded.some(fontFails)), fontsDeadOnSource: n((r) => r.fontsNotLoaded.some((f) => !fontFails(f))), fontChecksSkipped: n((r) => r.fontChecksSkipped && r.fontChecksSkipped.length > 0), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric), degradedTier: n((r) => r.browser && r.browser !== 'chrome'),
    alignedOnlyPass: n((r) => r.pixelPass && r.pct > opts.threshold), failOffsets: n((r) => r.pct != null && !r.pixelPass && r.alignedPct <= opts.threshold), offsetsWithinTolerance: n((r) => r.offsetsWithinTolerance), referenceUnstable: n((r) => UNSTABLE.test(r.error || '')),
    ...(opts.wide ? { overThreshold: n((r) => r.alignedPct != null && r.alignedPct > opts.threshold), heightOff: n((r) => r.pct != null && !r.heightPass) } : {}) };
  const flagged = opts.wide ? wideFlagged(rows, opts) : []; const flaggedLine = wideLine(flagged, opts);
  totals.passWithOverrides = totals.pass + totals.overridePass;
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: new Date().toISOString(), stage: opts.stage, breakpoint: opts.width, ...(opts.wide ? { wide: true, report: 'not a delivery criterion — exit 0 whatever the rows say' } : {}), threshold: opts.threshold, offsetMax: opts.offsetMax ?? (opts.stage === 'prototype' ? `${OFFSETS.px}px` : `the larger of ${OFFSETS.px}px and ${OFFSETS.share * 100}% of the origin height; roster tolerance: ${opts.heightTol * 100}% of the origin height with no step over ${ROSTER_OFFSETS.step}px`), originReference: opts.liveOrigin ? 'live' : 'frozen', heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `pixel criterion (aligned % ≤ ${opts.threshold} AND total offset ≤ the bound; alignment not used: unaligned % ≤ ${opts.threshold}) AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, only: opts.only }, totals, ...(opts.wide ? { wide: { line: flaggedLine, pages: flagged } } : {}), rows };
  const md = formatSummary(summary);
  if (opts.only) { mkdirSync(join(opts.out, 'runs'), { recursive: true }); const f = join(opts.out, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${opts.only[0]}.json`); writeFileSync(f, JSON.stringify(summary, null, 2)); console.log(md); console.log(`run → ${f}`); }
  else { writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2)); writeFileSync(join(opts.out, 'summary.md'), md); console.log(md.split('\n').slice(0, 7).join('\n')); console.log(`summary → ${join(opts.out, 'summary.md')}`); }
  console.log(JSON.stringify(totals));
  if (flaggedLine) console.log(flaggedLine); // last, where a log tail is read
  process.exitCode = opts.wide || totals.pass + totals.overridePass === totals.pages ? 0 : 2;
}

/**
 * A published-stage measurement that ended in a verdict is recorded beside gate.sh's rounds
 * (`gates/<slug>-<width>/rounds.json`), under its OWN stage: this verdict does not run gate.sh's probes,
 * so its pass must never read as gate.sh's pass or free a confirmation there. Recorded, never refused: the
 * roster run must not stop on one page's budget. → the slugs at or over the cap with no closing decision
 * (`rounds.mjs decide … --stage all-pages`). Never throws.
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
      R.record(ledger, R.ROSTER_STAGE, label, r.pass ? 'pass' : 'fail');
      R.save(d, ledger);
      const t = R.tally(ledger, R.ROSTER_STAGE);
      if (!r.pass && !t.closed && t.counted >= t.allowance) over.push(r.slug);
    }
  } catch (e) { console.error(`gate-all: rounds not recorded — ${String(e && e.message ? e.message : e).split('\n')[0]}`); }
  return over;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`gate-all error: ${e.message}`); process.exit(1); });
}
