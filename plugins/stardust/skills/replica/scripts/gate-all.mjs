#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/replica/scripts/gate-all.mjs — the published-origin gate over EVERY deployed page (#125, D0).
 *
 * THE RULE (#125): every crafted prototype and every deployed page is a row in a pixel table —
 * `<out>/summary.{json,md}` at `stardust/replica/gates/prototypes-<w>/` (--stage prototype: pages with
 * a prototypePath, build = the served prototype, origin = the archetype round's cached live.png when
 * present) and `stardust/replica/gates/all-<w>/` (--stage published, default: the deployed pages of the roster
 * source below, build = their deployed URL). gate-evidence.mjs reads these tables as the source of record; a page
 * without a row is ungated.
 *
 * Per page: stitched captures of both sides (stitch-shot, --settle), pixel-compare, then the DOM probes
 * — clip-probe on the served side (D1, both stages), content-presence (D2, published stage; the
 * prototype is authored from the same capture content-diff already reconciles) and unit-geometry (D3)
 * for the repeated-unit families stardust/replica/units.json declares for the page. Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + clip.json [+ content.json, units.json] + probes.json
 * [+ gate-key.json], <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead, and count fix
 * rounds in <out>/<slug>/rounds.json (FIX ROUNDS below).
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
 * INCONCLUSIVE: a row measured on a polluted capture has no pixel / height verdict (`inconclusive: true`, pixelPass /
 * heightPass null) — never PASS, never FAIL, never lifted by an override; it exits 2 like a FAIL. Polluted: a
 * crawl-fullpage origin fallback (asymmetric), or a stitch whose capture record names an overlay left on the page
 * after dismissal — each stitch gets `--json <slug>/<side>-shot.json` (deleted before the spawn; origin.json / eds.json
 * record its `overlayLeft` and `fontsFailed`), and no readable record is `unchecked`, never clean; or a stitched capture
 * taken with another hide or --dismiss list than this run's — a previous origin kept after a failed --recapture-origin, a
 * record --compare-only reads (`<side> capture polluted: kept <side> taken with another dismiss/hide list`). Its reasons are
 * `<origin|build> capture polluted: …` — fix the capture (--hide / presence.json, the consent dismissal), not the page.
 * FONTS: a face the page declares that did not load on either side (the capture records' `fontsFailed`) fails the row —
 * one `font-not-loaded:<family>` reason each (`fontsNotLoaded`, sorted; totals.fontsNotLoaded counts the rows, the
 * calibration line names them); the pixel-only calibration verdict is unchanged. A font check that could not run (the
 * record's `fontsFailed: null`, with `fontCheck` saying why; no record at all reads the same) fails the row too — one
 * `font-check-skipped:<origin|build>` reason per side (`fontChecksSkipped`; totals.fontChecksSkipped, the calibration line).
 * OVERRIDES: an overrides.json entry `{ verdict, reason }` lifts a failing row (passWithOverride; exit 0 when every row
 * passes or is lifted) only when validated (`checkOverride`): its verdict is tier-shift / instrument-artifact /
 * source-volatile, its reason names R-<nn> entries that head a section of stardust/replica/inconsistency-register.md
 * (read once per run, cwd-relative), clip PASS and — on the published stage — content PASS (n/a is not PASS), the row
 * has a pixel measurement (not a missing capture or a pixel error) and is not INCONCLUSIVE, and its magnitude is a
 * deviation's — on the row's own measured numbers (the ones it prints): pixel % ≤ 2 × --threshold AND |Δh| ≤ 2 ×
 * --height-tol × origin height, both inclusive (a reused row is re-checked). Larger is a capture to fix (an in-flow
 * per-visitor bar: --hide / presence.json), not a deviation: the override is not valid, the row stays FAIL with the
 * reason `override exceeds magnitude: use --hide / presence.json` (as is, no `override rejected:` prefix), the record
 * carries `magnitude` { pct, maxPct, heightDelta, maxHeightDelta }, totals.overrideMagnitude counts it and summary.md
 * names the rows in one line `Override exceeds magnitude (fix the capture / hide list, not a deviation): <path>, …`. The
 * row's `override` is { verdict, reason, valid[, rejected][, magnitude] }; every other failed rule of a failing row is an
 * `override rejected: <rule>` reason; totals count overridePass, overrideRejected (magnitude ones included),
 * overrideMagnitude and overrideShare.
 *
 * Sidecars in <out>/, each entry documented: masks.json (printed on the verdict), overrides.json
 * (shown BESIDE the number, never replacing it; it counts only when validated — OVERRIDES above), clip-allow.json,
 * presence.json (session-variable regions); repeated units come from stardust/replica/units.json (unit-geometry.mjs
 * header; a legacy <out>/units.json per page still reads). presence.json `hide` (per slug, and `"*"` for every slug, `"*"`'s first; plain
 * CSS selectors) names in-flow per-visitor regions removed on BOTH sides before anything measures — both stitches,
 * content-presence and clip-probe get `--hide <list>` (unit-geometry does not) — and only a non-empty list is recorded
 * (origin.json / eds.json / the row `hide`, probes.json inputs, the gate key), so no capture taken with another list is
 * reused as if equal (fix rounds, live.png, --skip-existing); each stitch's `hidden:` line is origin.json / eds.json
 * `hidden` (text), and a selector that matched nothing (×0) or is invalid is one _run.log line per side. Origin
 * fallback: live stitch → previous origin (--recapture-origin) → <crawl-shots>/<slug>.png (`crawl-fullpage`,
 * asymmetric, flagged — an INCONCLUSIVE row).
 * SITE-WIDE PRESENCE: stardust/replica/presence.json (cwd-relative, the same shape: `"*"` and `<slug>` → { hide, main,
 * variable, reasons }) is merged UNDER <out>/presence.json by live-session's mergePresence — per top-level key and field
 * the gate dir's value wins, keys and fields only one file has are kept, a missing file is {} — and the merged object is
 * the presence everywhere above (hide lists of both stitches and the probes, main / variable, probes.json inputs, the
 * gate key); `reasons` (presence.mjs's notes) is read by no one here. A malformed file of either is an error naming it
 * (`presence.json <file> unreadable (…)`, exit 1, before any write). _run.log names the merge (`presence: <gate file>
 * over <site file>`, or `<site file> (<gate file> not found)`); a diff scripts dir whose live-session.mjs cannot merge
 * (no mergePresence) leaves the site file out — one `presence hide: not honoured for <site file> (site-wide) …` line.
 * DISMISS: --dismiss <sel,…> (like gate.sh / anchor.mjs: one comma list, the last flag wins) hands a site's own
 * overlay-dismiss selectors (a marketing modal with a non-standard closer) to BOTH stitches — `--dismiss <list>`, before
 * `--hide` in the argv; stitch-shot dismisses before it hides, on both sides alike. The diff probes gate-all runs
 * (content-presence, clip-probe, unit-geometry) take no --dismiss flag — they dismiss with the built-in candidates only
 * (gate.sh hands its list to content-diff / visual-diff, which gate-all does not run); under --one-load their inventories
 * come from the stitches, which dismiss with the list. Symmetric capture: only a non-empty list is recorded — origin.json
 * / eds.json `dismiss`, probes.json inputs, the gate key's settings, the table's _provenance — so a capture taken with
 * another list (absent = none) is never reused: fix rounds (`not reused (dismiss list differs)`), the archetype round's
 * live.png on either stage (live.json `dismiss.extra`, gate.sh's --dismiss; `live.png not reused (live.json dismiss list
 * differs)`) and --skip-existing (`not reused (--skip-existing: dismiss list differs)`, either side).
 * Origin reuse: fix rounds (--only, --recapture-eds) and the published stage (gates/<slug>-<w>/live.png + a matching
 * live.json) reuse origin captures of THIS run — at or after the last rollout A-inventory / replica extract start in
 * stardust/status.jsonl (--origin-max-age: older ones too); the row (`originReused`), origin.json and _run.log record it.
 * A kept origin (a fix round's, either stage's live.png) must record the overlay-left check with nothing left
 * (origin.json / live.json `overlayLeft: null`) — a capture from before the check, or one that left an overlay, is
 * re-stitched; a previous origin kept after a failed --recapture-origin without that record is `unchecked` (an
 * INCONCLUSIVE row); --skip-existing re-shoots a stitched capture of either side without that record (logged `not
 * reused (--skip-existing: no overlay-left record)`) and --compare-only reads one as `unchecked` (an INCONCLUSIVE row).
 *
 * REUSE (--skip-existing only; every reuse is printed in the row as `reused`, never silent). Origin captures in the
 * page dir are reused as before — never a stitched one whose record predates the overlay-left check (re-shot); an EDS
 * capture only while its <slug>/gate-key.json proves it current (below), with the same overlay-left record rule.
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
 * Roster source (published stage): --coverage <file> (default stardust/rollout/coverage/pages.json when it exists),
 * else --state (stardust/state.json: `deployed` pages with a liveUrl and a url) — --state keeps the prototype stage
 * (pages with a prototypePath and a url; --coverage ignored) and legacy projects. A coverage row qualifies when its
 * delivery.status is deployed / verified, or failed with a `gate:` error (a fix round re-gates it), with a
 * delivery.deployedUrl (the build; --eds-host rewrites its host) and a source.sourceUrl; template / fidelityTier (units,
 * gate key) and deployedPath come from the state page of the same slug when state.json has one, else templateId / null /
 * the row's path. Beside a coverage, state.json is optional; one that does not parse is one stderr note, not an error.
 * The build is that deployedUrl as recorded (the preview host the delivery records) — no other file moves it; gate another
 * host (the live one) with --eds-host <host>. Every row carries `host`: the build origin (`<protocol>//<host>`) it was
 * measured against — the origin of the EDS capture record's `url` (eds.json; so --compare-only after a run with another
 * --eds-host names the host its pixels came from), else this run's build URL; a reused row keeps its own; one from a
 * table written before the field takes this run's, which its equal gate key (it hashes the build origin) proves. The
 * first status line names the origin(s) this run measures and their source.
 * Not found: an explicit --coverage, or neither file (published), or --state (prototype); a coverage that does not
 * parse → exit 1, nothing written.
 *
 * Empty selection: no page passes the stage filter and --only → one stderr line; published: both sources (absolute)
 * with their counts — coverage rows / deployed, verified or gate-failed with a deployedUrl, state pages / deployed with
 * a liveUrl, each with how many lack the source url, or `not found` — and which one the roster came from; prototype: the
 * state file, its page count and pages with a prototypePath (and how many lack the source url); then what --only matched
 * and the hint — roster from coverage: coverage wins for the published stage (--state cannot change it), so record
 * deployed pages with update-coverage.mjs <slug> --status deployed --url <deployedUrl> or pass --coverage <file>; roster
 * from state: pass --coverage / --state from the project root or deploy first; exit 1, nothing written.
 *
 * Roster estimate: each run's first status line (stdout and _run.log) is `roster: <n> page(s) × 1 width @<w> (<stage>) —
 * estimated <s> s (25 s per page per width[ × <f>: <why>])` (`ESTIMATE_SEC_PER_PAGE` × pages × widths × f; one width per
 * process). 25 s was measured with the default pools (origin 2, both capture pools side by side); f (`estimateFactor`) =
 * ceil((2 / origin pool) × (2 when the capture pools run sequentially)), at least 1 — per browser slot 1 → × 4 (`× 4: 1
 * browser per slot, captures sequential`), 2 → × 2, ≥ 3 or no slot → × 1 (the text as before) — erring high: an
 * over-estimate only lengthens a deadline, an under-estimate kills the run. main() takes f from its own pools;
 * `rosterEstimate` (run-bg sizes a gate-all job's deadline with it, in run-bg's env before the job holds a slot) from the
 * pools the job would run with: an inherited STARDUST_BROWSER_SLOT as is, STARDUST_BROWSER_SLOTS=0 (lock off) → no slot,
 * else run-bg's own `browsersPerSlot` (run-bg.mjs beside this file; absent → 1), with the argv's pool flags. Then
 * `; run-bg deadline <d> s` when one is known, then `; source: coverage <path> (<q> of <N> row(s) qualified)` or
 * `; source: state <path> (<q> of <M> page(s) qualified)` (<q> before --only), then `; build host <origin>[, <origin>…]
 * (<from>)` — the build origin(s) this run measures (sorted, unique) and where they come from (`buildHost`): `--eds-host`;
 * on the prototype stage `--proto-base` (`--proto-base default` without the flag); else `coverage deployedUrl` or `state
 * liveUrl` — a recorded 99-page roster at one width needed 2152 s and was killed by run-bg's 900 s default deadline. Deadline guard: RUN_BG_DEADLINE_SEC (env, seconds —
 * the job's --timeout, exported by run-bg; absent or ≤ 0 = none) below the estimate → gate-all refuses to start, before
 * the out dir and any capture, probe, gate key or table write: one stderr line (`no verdict`, the roster, the estimate,
 * the deadline and the remedy `--timeout <estimate>`), exit 2.
 *
 * FIX ROUNDS — the cap is mechanical, per page per out dir (stage and width): every --only run counts one round per
 * selected page whose row has a verdict (`countsAsRound`: a pixel measurement, not INCONCLUSIVE; a reused row's verdict
 * counts too) in <out>/<slug>/rounds.json { rounds, max, at[ISO…], [resets], [seeded: "runs", seededFrom] } (indent 1,
 * atomic; `at` = the counted rounds since the last reset); full runs never count and are never refused. Every row carries
 * `round` (the count after this run), the table `_provenance.maxRounds`. Without rounds.json the count is seeded from the
 * legacy runs/*.json tables holding a verdict row for the page (`roundsOf`, which gate-triage reads too) and the first
 * write records `seeded`. Each --only run first reserves its pages — <slug>/rounds.lock { pid, at }, sorted, complete
 * when it appears (a unique temp file hard-linked into place): a lock of a running process — or one without a readable pid
 * younger than 30 s — refuses the run (one stderr line `no verdict — a round of <slug> is in progress (pid <n>) — lock
 * taken <at> (<age> ago): <lock>; wait for that run to end, or remove <lock> if no gate-all run is active`, exit 2); a
 * dead process's (or an older unreadable) lock is reaped — renamed aside, re-read, deleted only while still dead (logged
 * `rounds lock <slug> → reaped …`); released on exit. Then the
 * cap, beside the deadline guard (before the out dir and any capture): a selected page at --max-rounds (default 3; 1..3 —
 * it may only lower the cap, anything else is a usage error) refuses the run — one stderr line `no verdict — cap reached —
 * re-prototype decision: <slug> <n>/<max> @<w>` naming the remedy (drop the page from --only, or record the re-prototype
 * decision with --round-reset "<reason>"), exit 2, nothing written. --round-reset (with --only; a non-empty reason) starts
 * a new count for the selected pages at the cap — resets[] { at, reason, from, history }, the row's `roundReset` { reason,
 * at } — or logs `round-reset: no --only slug at the cap — nothing reset`. rounds.json is written before the run table (a
 * crash over-counts, never under-counts); _run.log names each page's count (`rounds @<w>: <slug> <n>/<max>`).
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--stage published|prototype] [--proto-base <url>]
 *        [--coverage f] [--state f] [--out dir] [--width 1440] [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--eds-host <h>]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-max-age <h>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--threshold 10] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>] [--one-load] [--max-rounds 3] [--round-reset "<reason>"]
 *        [--dismiss <sel,…>]
 * --eds-host takes a bare host (https:// added) or an http(s) origin URL and is normalised to `<protocol>//<host>`
 * (`edsOrigin`; the summary's `edsHostOverride` records it); a path, query or hash → one stderr line and the usage
 * line, exit 2, before any I/O.
 * Every flag that takes a value refuses a missing value (the flag last in argv) or one that starts with `-` (another
 * flag, a negative number): one stderr line `gate-all: <flag> needs a value, got "<value>"` (`got nothing` when
 * missing) and the usage line, exit 2, before any I/O — `--eds-host --only home` never gates `--only` as a host.
 * Two browser budgets, kept apart: the origin pool (2) is the source's bot budget; the EDS / probe pools (4 / 2) carry
 * no bot risk, but each of their slots is a Chromium — raising them raises this job's Chromium peak (measured: 6 / 4
 * took an 8-page job from 6 to 8 at once). The three flags take integers ≥ 1 (else exit 1). Without a machine-wide
 * browser slot they hold as given. Inside one (run-bg sets STARDUST_BROWSER_SLOT) the slot bounds browsers, not just
 * jobs: run-bg exports STARDUST_BROWSERS_PER_SLOT = max(1, floor(STARDUST_BROWSER_BUDGET (default 3) /
 * STARDUST_BROWSER_SLOTS)): the contract's 3 browsers = budget 3 across all jobs; a larger machine raises
 * STARDUST_BROWSER_BUDGET. With N per slot (`browserPools`): N = 1 → origin 1 / EDS 1 / probe 1 and the two capture
 * pools run one after the other (every origin capture, then every EDS capture); N ≥ 2 → when origin + EDS exceed N,
 * origin min(oc, ceil(N/2)) and EDS min(ec, N − origin), and probe min(pc, N) (N 3, the defaults: 2 / 1 / 2) — a
 * lower flag stays. A per-slot value that is not a positive integer (an older run-bg) reads as 1, logged. The compare
 * pool (no browser) is unchanged. The status line keeps `pools origin X / eds Y / probe Z` and names the clamp, e.g.
 * `(machine browser slot held; 1 browser(s) per slot — clamped from 2/4/2; capture pools sequential)`.
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs, pixel-compare.mjs
 * and foundation-freeze.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (validated overrides count), 2 any FAIL or INCONCLUSIVE row, or a refused start (no verdict: the run-bg deadline, a page
 * at the round cap, a round of the page in progress) or --eds-host or a value flag without its value, 1 error, a usage
 * error (an unknown flag or a bad value: --stage, --origin-max-age, the pool flags, --max-rounds, --round-reset,
 * --dismiss) or an empty selection.
 * `verdict`, `capturePollution`, `fontsNotLoaded`, `fontChecksSkipped`, `checkOverride`, `registerIds`, `OVERRIDE_VERDICTS`, `REGISTER_FILE`, `formatSummary`, `parseArgs`, `edsOrigin`, `emptySelection`, the roster helpers for run-bg (`ESTIMATE_SEC_PER_PAGE`, `DEFAULT_COVERAGE`,
 * `coveragePages`, `selectPages`, `rosterEstimate`) and the reuse helpers
 * (`probeInputs`, `probeReuse`, `canon`, `gateKeyParts`, `gateKeyOf`, `foundationPart`, `sharedBlocks`,
 * `blockRefs`, `chromeDocs`, `instrumentFiles`, `edsHostOf`, `codeDeployed`, `hostServes`,
 * `deployedDocs`, `contentDeployed`, `keyChanged`, `skipCapture`, `rowKey`, `latestRows`, `rowReuse`), `browserPools`, `estimateFactor`, `buildHost` and the fix-round helpers (`MAX_ROUNDS`, `countsAsRound`,
 * `runTables`, `roundsOf` — gate-triage reads the count with it —, `capRefusal`, `nextRounds`) are exported.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_OUT as FREEZE_MANIFEST, DEFAULT_PATHS as FOUNDATION_PATHS, snapshot } from './foundation-freeze.mjs';

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --stage published|prototype  published (default): deployed pages vs their deployed URL → gates/all-<w>/;
                            prototype: pages with a prototypePath vs the served prototype → gates/prototypes-<w>/
  --proto-base <url>        where the prototypes dir is served (prototype stage), e.g. http://localhost:8791
  --coverage <file>         published roster: stardust/rollout/coverage/pages.json if it exists, else --state; rows
                            deployed / verified / failed "gate: …" with a deployedUrl and a source url
  --state <file>            stardust/state.json — the prototype stage, legacy projects; template / tier of coverage rows
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched): a fix round — each selected page
                            whose row has a verdict (not INCONCLUSIVE; a reused row counts) counts one round
  --max-rounds <n>          3 — fix rounds per page per out dir; 1..3 only (it may only lower the cap). An --only run
                            with a selected page at the cap is refused (no verdict, exit 2, nothing written)
  --round-reset "<reason>"  with --only: the re-prototype decision — the selected pages at the cap start a new count
  --skip-existing           reuse captures (not a stitched one recorded before the overlay-left check:
                            re-shot, logged); probes while the capture pair is unchanged; PASS rows
                            while the gate key is unchanged (rows say reused). Published eds.png:
                            only while <slug>/gate-key.json proves it current (same key, or unknown
                            key with the same tree, reason, upstream, ledger rows); no local
                            content/<page>.html → nothing to compare → re-shot every run (slower)
  --recapture-eds           re-shoot eds.png only; the origin is reused while fresh (always with --skip-existing)
  --recapture-origin        re-shoot origin.png even when fresh (previous kept on failure)
  --origin-max-age <h>      also reuse origin captures from earlier runs up to <h> hours old (env
                            STARDUST_ORIGIN_MAX_AGE_H; default: this run's captures only)
  --eds-host <host>         gate a code branch host against the same content: a bare host or https://<host>
                            (https:// added when no scheme); a path, query or hash is refused (exit 2). Without it
                            the build is the roster's URL as recorded (coverage deployedUrl: the preview host); gate
                            the live host with --eds-host <live host>. Every row records its build origin as host
                            (the origin of its EDS capture's url — eds.json — so --compare-only names that host)
  --blocked <regex>         origins the edge denies → crawl shot unless --try-blocked
  --try-blocked             attempt the live stitch on --blocked origins too
  --crawl-shots <dir>       stardust/current/assets/screenshots (fallback origin PNGs)
  --origin-concurrency <n>  2 — the source's bot budget
  --eds-concurrency <n>     4      --probe-concurrency <n>  2 — no bot risk, but each is a Chromium:
                            raising them raises this job's Chromium peak; integers >= 1 (else exit 1)
                            Inside a machine browser slot (env STARDUST_BROWSER_SLOT, set by run-bg) the pools are
                            clamped to STARDUST_BROWSERS_PER_SLOT = max(1, floor(STARDUST_BROWSER_BUDGET (default 3) /
                            STARDUST_BROWSER_SLOTS)): the contract's 3 browsers = budget 3 across all jobs; a larger
                            machine raises STARDUST_BROWSER_BUDGET. N per slot: 1 → 1 / 1 / 1, the origin pool then
                            the EDS pool (sequential); N >= 2 → origin + EDS <= N (origin min(oc, ceil(N/2)), EDS
                            the rest), probe <= N (N 3: 2 / 1 / 2); a lower flag stays; not a positive integer → 1
  --threshold <pct>         10     --height-tol <frac>    0.05   --clip-max <n>  0   --unit-tol <px>  4
  --no-clip | --no-content | --no-probes   drop criteria 3 / 4 / both (pixel-only verdict)
  --units <file>            repeated-unit declarations (default <out>/units.json)
  --compare-only            no captures; recompute from existing PNGs (a stitched record from before the
                            overlay-left check reads unchecked → INCONCLUSIVE)
  --warmup <url>            origin warm-up for the probes
  --dismiss <sel,…>         extra overlay-dismiss selectors (a marketing modal with a non-standard closer), like gate.sh /
                            anchor.mjs: both stitches get --dismiss <list>, dismissed before the hide list on both sides
                            (the last --dismiss wins; no value → exit 1). gate-all's probes (content-presence, clip-probe,
                            unit-geometry) take no --dismiss: the built-in candidates only (--one-load: the stitches'
                            inventories). Recorded in origin.json / eds.json "dismiss", probes.json inputs and the gate
                            key (a non-empty list only); a capture taken with another list is not reused (fix rounds,
                            live.png — live.json dismiss.extra —, --skip-existing), logged "dismiss list differs"
  --one-load                one navigation per side: each stitch also takes the presence / clip / unit inventories
                            (both sides headed real Chrome, live.png not reused); a side without one → the probes, logged
  --vh <px>                 stitch chunk height
  --help                    this text
  A flag that takes a value refuses a missing one or one that starts with "-" (another flag, a negative number): one
  stderr line — gate-all: <flag> needs a value, got "<value>" (or: got nothing) — and the usage line, exit 2, before any I/O.
Verdict = pixel % ≤ threshold AND |Δh| ≤ height-tol × origin height AND clipped ≤ clip-max(+allowance) AND content MISSING+HIDDEN = 0.
  INCONCLUSIVE row (no pixel / height verdict, never PASS): a polluted capture — a crawl-fullpage origin fallback, or
  an overlay left after dismissal (or no record of the check) in the stitch's --json record <slug>/<side>-shot.json, or
  a kept capture taken with another hide / --dismiss list than this run's (a previous origin kept after a failed
  --recapture-origin; --compare-only): "origin capture polluted: kept origin taken with another dismiss/hide list".
  A declared face that did not load on either side (the record's fontsFailed) fails the row: font-not-loaded:<family>;
  so does a font check that could not run (fontsFailed null, or no record): font-check-skipped:<origin|build>.
Sidecars in <out>/: masks.json, overrides.json, clip-allow.json, presence.json, units.json (see the header);
  overrides.json { "<slug>": { verdict, reason } } counts only when validated: verdict tier-shift / instrument-artifact /
  source-volatile, a reason naming an R-<nn> of stardust/replica/inconsistency-register.md, clip + content PASS (prototype
  stage: clip), a pixel measurement (not a missing capture / pixel error), the row not INCONCLUSIVE — else "override
  rejected: <rule>" reasons and the row stays FAIL. Magnitude, on the row's own numbers: pixel % ≤ 2 × --threshold and
  |Δh| ≤ 2 × --height-tol × origin height (inclusive) — larger → not valid, the row stays FAIL with the reason "override
  exceeds magnitude: use --hide / presence.json" (no prefix), totals.overrideMagnitude, and summary.md's line "Override
  exceeds magnitude (fix the capture / hide list, not a deviation): <path>, …".
  presence.json "hide" (per slug or "*"): in-flow regions removed on both sides before measuring.
  stardust/replica/presence.json (site-wide, the same shape) is merged under <out>/presence.json — per key and field
  the gate dir's value wins — for every use above (hide lists, main / variable, probe inputs, the gate key); a malformed
  one is an error naming it (exit 1); _run.log names the files merged.
Reuse sidecars per page: probes.json, gate-key.json (see the header).
Fix rounds per page: <out>/<slug>/rounds.json { rounds, max, at[], [resets], [seeded, seededFrom] } — without it the
  count is seeded from runs/*.json rows with a verdict; every row carries round (+ roundReset on a reset row). An --only
  run first takes <slug>/rounds.lock { pid, at } (complete when it appears): one held by a running process, or one
  without a readable pid younger than 30 s → "no verdict — a round of <slug> is in progress (pid <n>) — lock taken <at>
  (<age> ago): <lock>; wait for that run to end, or remove <lock> if no gate-all run is active", exit 2; a dead
  process's lock (or an older unreadable one) is reaped (logged). A page at the cap → "no verdict — cap reached —
  re-prototype decision: <slug> <n>/<max> @<w>" (drop it from --only, or --round-reset "<reason>"), exit 2, before the
  out dir; --round-reset with no selected page at the cap logs "round-reset: no --only slug at the cap — nothing reset".
Empty selection → one stderr line: published — the coverage and state paths (absolute) with their counts (rows
  deployed / verified / gate-failed with a deployedUrl; pages deployed with a liveUrl; how many lack a source url) and
  the roster's source; prototype — the state path, its pages with a prototypePath; what --only matched, the hint
  (roster from coverage: coverage wins — record deployed pages with update-coverage.mjs, or pass --coverage); exit 1.
First status line (stdout, _run.log): roster: <n> page(s) × 1 width @<w> (<stage>) — estimated <25·n·f> s (25 s per
  page per width[ × f: <why>])[; run-bg deadline <d> s]; source: coverage|state <path> (<q> of <N> row(s) / page(s)
  qualified, before --only); build host <origin>[, …] (--eds-host | coverage deployedUrl | state liveUrl | --proto-base
  [default]) — the build origin(s) measured and where they come from. f = ceil((2 / origin pool) × (2 when the capture
  pools run sequentially)), at least 1: 1 browser per slot → × 4, 2 → × 2, ≥ 3 or no slot → × 1 (25 s was measured
  with the default pools; it errs high). run-bg sizes a gate-all job's deadline with the same estimate (rosterEstimate,
  from run-bg's env: the slot it will take — run-bg's browsersPerSlot — unless STARDUST_BROWSER_SLOTS=0; the argv's
  pool flags). RUN_BG_DEADLINE_SEC
  (env, seconds: the job's --timeout, exported by run-bg; absent or ≤ 0 = none) below the estimate → refused before the
  out dir or any capture: one stderr line "no verdict" naming --timeout <estimate>; exit 2.
Exit: 0 all PASS (validated overrides count), 2 any FAIL or INCONCLUSIVE row, or a refused start (no verdict: the run-bg
  deadline, a page at the round cap, a round of the page in progress) or --eds-host or a value flag without its value,
  1 error, a usage error (an unknown flag or a bad value) or an empty selection.`;
const USAGE = HELP.split('\n').find((l) => l.startsWith('Usage: '));

/**
 * edsOrigin(value) → { origin } | { error }: --eds-host as a bare host (https:// added when there is no scheme) or an
 * http(s) origin URL; a path other than `/`, a query or a hash is refused. origin = `<protocol>//<host>` (URL-normalised:
 * lower-case host, a non-default port kept). Pure.
 */
export function edsOrigin(value) {
  const raw = String(value ?? '').trim(); const error = `--eds-host takes a host or an origin URL (https://<host>), not a path — got ${value ?? ''}`;
  let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error }; }
  if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || /[?#]/.test(raw) || u.username || u.password) return { error };
  return { origin: `${u.protocol}//${u.host}` };
}

/**
 * browserPools({ oc, ec, pc }, env) → { oc, ec, pc, perSlot, sequential, clampedFrom, fallback }: the capture / probe
 * pools this job may run. No machine browser slot (env STARDUST_BROWSER_SLOT empty) → the flags as given, perSlot null.
 * Inside one, N = STARDUST_BROWSERS_PER_SLOT (run-bg: max(1, floor(budget / slots))); not a positive integer (an older
 * run-bg) → 1 and `fallback` says why. N = 1 → 1 / 1 / 1 and `sequential` (the origin pool, then the EDS pool); N ≥ 2 →
 * when oc + ec > N: oc' = min(oc, ceil(N/2)), ec' = min(ec, N − oc'); pc' = min(pc, N) — a lower flag stays. `clampedFrom`
 * = the flags ({ oc, ec, pc }) when any pool changed, else null. Pure.
 */
export function browserPools({ oc, ec, pc }, env = process.env) {
  const flags = { oc, ec, pc };
  if (!env || !env.STARDUST_BROWSER_SLOT) return { ...flags, perSlot: null, sequential: false, clampedFrom: null, fallback: null };
  const raw = env.STARDUST_BROWSERS_PER_SLOT; const n = Number(raw);
  const given = raw != null && String(raw).trim() !== '';
  const valid = given && Number.isInteger(n) && n >= 1;
  const perSlot = valid ? n : 1;
  const fallback = valid ? null : given ? `STARDUST_BROWSERS_PER_SLOT "${raw}" is not a positive integer — 1 assumed` : 'STARDUST_BROWSERS_PER_SLOT unset (an older run-bg) — 1 assumed';
  let o = oc; let e = ec;
  if (perSlot === 1) { o = 1; e = 1; } else if (oc + ec > perSlot) { o = Math.min(oc, Math.ceil(perSlot / 2)); e = Math.min(ec, perSlot - o); }
  const p = Math.min(pc, perSlot);
  return { oc: o, ec: e, pc: p, perSlot, sequential: perSlot === 1, clampedFrom: o !== oc || e !== ec || p !== pc ? flags : null, fallback };
}
/** The status line's clause for the pools: what the machine browser slot did to them ('' without a slot). */
const poolsNote = (b) => (b.perSlot == null ? '' : ` (machine browser slot held; ${b.perSlot} browser(s) per slot${b.fallback ? ` (${b.fallback})` : ''}${b.clampedFrom ? ` — clamped from ${b.clampedFrom.oc}/${b.clampedFrom.ec}/${b.clampedFrom.pc}` : ''}${b.sequential ? '; capture pools sequential' : ''})`);
// A pool flag's value: an integer ≥ 1, else the usage error (exit 1).
function poolFlag(flag, raw) {
  const n = Number(raw);
  if (raw == null || String(raw).trim() === '' || !Number.isInteger(n) || n < 1) { console.error(`${flag} must be an integer >= 1 (got ${raw ?? 'nothing'})\n\n${HELP}`); process.exit(1); }
  return n;
}

export function parseArgs(argv, env = process.env) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { stage: 'published', protoBase: null, coverage: null, state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, originMaxAge: null, threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null, maxRounds: MAX_ROUNDS, roundReset: null, dismiss: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    // a value flag's value: never missing, never another flag or a dash-led word — the usage line, exit 2, before any I/O
    const v = () => { const x = rest[++i]; if (x == null || String(x).startsWith('-')) { console.error(`gate-all: ${a} needs a value, got ${x == null ? 'nothing' : JSON.stringify(x)}\n${USAGE}`); process.exit(2); } return x; };
    if (a === '--stage') { o.stage = v(); if (!['published', 'prototype'].includes(o.stage)) { console.error(`--stage must be published or prototype\n\n${HELP}`); process.exit(1); } }
    else if (a === '--proto-base') o.protoBase = v().replace(/\/$/, '');
    else if (a === '--coverage') o.coverage = v(); else if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') o.width = Number(v());
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') { const e = edsOrigin(v()); if (e.error) { console.error(`gate-all: ${e.error}\n${USAGE}`); process.exit(2); } o.edsHost = e.origin; } else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-max-age') { o.originMaxAge = Number(v()); if (!(o.originMaxAge >= 0)) { console.error(`--origin-max-age must be a number of hours >= 0\n\n${HELP}`); process.exit(1); } }
    else if (a === '--origin-concurrency') o.oc = poolFlag(a, v()); else if (a === '--eds-concurrency') o.ec = poolFlag(a, v()); else if (a === '--probe-concurrency') o.pc = poolFlag(a, v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--one-load') o.oneLoad = true;
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a === '--max-rounds') {
      const raw = v(); const n = Number(raw);
      if (String(raw).trim() === '' || !Number.isInteger(n) || n < 1 || n > MAX_ROUNDS) { console.error(`--max-rounds must be an integer from 1 to ${MAX_ROUNDS} (got ${raw}) — it may only lower the cap; a page at the cap gets another round only through the re-prototype decision: --only <slug> --round-reset "<reason>"\n\n${HELP}`); process.exit(1); }
      o.maxRounds = n;
    } else if (a === '--dismiss') {
      // like gate.sh / anchor.mjs / stitch-shot: one comma list (the last --dismiss wins), trimmed, empty entries dropped
      const raw = v(); const list = hideRecord(raw);
      if (!list.length) { console.error(`--dismiss takes a list of overlay-dismiss selectors, <sel,…> (got ${raw})\n\n${HELP}`); process.exit(1); }
      o.dismiss = list;
    } else if (a === '--round-reset') {
      const raw = v();
      if (!String(raw).trim()) { console.error(`--round-reset takes the re-prototype decision's reason, a non-empty text (got ${raw})\n\n${HELP}`); process.exit(1); }
      o.roundReset = String(raw).trim();
    }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  o.browserSlot = Boolean(env.STARDUST_BROWSER_SLOT); // run-bg holds a machine-wide browser slot for this job (logged)
  o.pools = browserPools({ oc: o.oc, ec: o.ec, pc: o.pc }, env); o.oc = o.pools.oc; o.ec = o.pools.ec; o.pc = o.pools.pc;
  const deadline = Number(env.RUN_BG_DEADLINE_SEC); o.deadlineSec = deadline > 0 ? deadline : null; // run-bg exports the job's --timeout (s); absent / ≤ 0 = none
  if (o.roundReset != null && !(o.only && o.only.length)) { console.error(`--round-reset needs --only <slug,…>: it resets the round count of the selected pages at the cap\n\n${HELP}`); process.exit(1); }
  if (o.stage === 'prototype' && o.content) o.content = false; // content-diff already reconciles the prototype's text
  if (!o.out) o.out = `stardust/replica/gates/${o.stage === 'prototype' ? 'prototypes' : 'all'}-${o.width}`;
  return o;
}

// ---- the roster: selection + estimate (pure; rosterEstimate also reads the coverage / state files) -------------------
export const ESTIMATE_SEC_PER_PAGE = 25;
export const DEFAULT_COVERAGE = 'stardust/rollout/coverage/pages.json';
const pagesOf = (state) => (state && state.pages) || [];
// A coverage row with a gateable delivery: deployed / verified, or failed by the gate (a fix round re-gates it), with a deployedUrl.
const delivered = (r) => { const d = (r && r.delivery) || {}; return (d.status === 'deployed' || d.status === 'verified' || (d.status === 'failed' && /^gate:/.test(d.error || ''))) && !!d.deployedUrl; };
/**
 * coveragePages(doc, { state }) → the published pages of a rollout coverage doc (pages.json `pages`), in file order: each
 * delivered row with a source.sourceUrl → { slug, url: sourceUrl, liveUrl: deployedUrl, template, fidelityTier,
 * deliveryStatus[, deployedPath] }. template / fidelityTier are the state page's own (same slug) when state has one — its
 * units stay those of the state-selected page, its gate key too while deployedUrl / sourceUrl equal the state's liveUrl / url —
 * else templateId / null; deployedPath: the state page's, else the row's path.
 */
export function coveragePages(doc, { state = null } = {}) {
  return pagesOf(doc).filter((r) => delivered(r) && r.source && r.source.sourceUrl).map((r) => {
    const s = pagesOf(state).find((p) => p && p.slug === r.slug); const deployedPath = (s && s.deployedPath) || r.path;
    return { slug: r.slug, url: r.source.sourceUrl, liveUrl: r.delivery.deployedUrl, template: s ? s.template : (r.templateId ?? null), fidelityTier: s ? s.fidelityTier : null, deliveryStatus: r.delivery.status, ...(deployedPath ? { deployedPath } : {}) };
  });
}
/** selectPages(state, { stage, protoBase, only, coverage }) → the pages this run gates (main() selects with it; run-bg counts with it); published + a coverage doc → coveragePages. */
export function selectPages(state, { stage = 'published', protoBase = null, only = null, coverage = null } = {}) {
  const pages = stage === 'prototype'
    ? pagesOf(state).filter((p) => p.prototypePath && p.url).map((p) => ({ ...p, liveUrl: `${protoBase || 'http://localhost:8791'}/${basename(p.prototypePath)}` }))
    : coverage ? coveragePages(coverage, { state }) : pagesOf(state).filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  return only ? pages.filter((p) => only.includes(p.slug)) : pages;
}
/**
 * The roster's files, resolved against cwd: { cov, st }, each { path, abs } + doc | missing | error (its message); cov null =
 * not the source. Published: an explicit --coverage, else DEFAULT_COVERAGE when it exists, else --state; prototype: --state.
 */
function rosterSource({ stage = 'published', coverage = null, state = 'stardust/state.json' }, cwd = '.') {
  const load = (path) => { const abs = resolve(cwd, path); try { return { path, abs, doc: JSON.parse(readFileSync(abs, 'utf8')) || {} }; } catch (e) { return e.code === 'ENOENT' ? { path, abs, missing: true } : { path, abs, error: e.message }; } };
  const cov = stage === 'published' && (coverage || existsSync(resolve(cwd, DEFAULT_COVERAGE))) ? load(coverage || DEFAULT_COVERAGE) : null;
  return { cov, st: load(state) };
}
// The per-page figure was measured with the default pools: origin 2, the two capture pools side by side.
const ESTIMATE_ORIGIN_POOL = 2;
/**
 * estimateFactor(pools) → { factor, why }: how much slower than the measured default pools a run with these pools
 * (browserPools' result) is taken to be — ceil((2 / origin pool) × (2 when the capture pools run sequentially)), at least
 * 1 — erring high (an over-estimate only lengthens a deadline; an under-estimate kills the run): per slot 1 → 4, 2 → 2,
 * ≥ 3 or no slot (default flags) → 1. `why` names it (null at 1). Pure.
 */
export function estimateFactor(pools) {
  const factor = Math.max(1, Math.ceil((ESTIMATE_ORIGIN_POOL / pools.oc) * (pools.sequential ? 2 : 1)));
  if (factor === 1) return { factor, why: null };
  const why = [pools.perSlot != null ? `${pools.perSlot} browser${pools.perSlot === 1 ? '' : 's'} per slot` : null, pools.sequential ? 'captures sequential' : `origin pool ${pools.oc}`].filter(Boolean).join(', ');
  return { factor, why };
}
// One width per process: widths stays 1 here, explicit so run-bg can sum invocations (pages × widths).
const roster = (pages, { width, stage }, { factor = 1, why = null } = {}) => { const widths = 1; return { pages, widths, width, stage, estimatedSeconds: ESTIMATE_SEC_PER_PAGE * pages * widths * factor, factor, factorWhy: why }; };
const rosterText = (r) => `${r.pages} page(s) × ${r.widths} width${r.widths === 1 ? '' : 's'} @${r.width} (${r.stage})`;
// `(25 s per page per width[ × <factor>: <why>])` — byte-identical to the unfactored text at × 1.
const estimateText = (r) => `${ESTIMATE_SEC_PER_PAGE} s per page per width${r.factor > 1 ? ` × ${r.factor}: ${r.factorWhy}` : ''}`;
/**
 * buildHost(pages, { edsHost, stage, protoBase, source }) → { origins, from }: the build (EDS) origin(s) this run measures
 * and where they come from — `--eds-host` (edsOrigin's normalised value; it rewrites every page's host); else, on the
 * prototype stage, `--proto-base` (`--proto-base default` when not given); else the roster's own URLs: `coverage
 * deployedUrl` or `state liveUrl`. origins = the unique `<protocol>//<host>` of the pages' build URLs, sorted. Pure.
 */
export function buildHost(pages, { edsHost = null, stage = 'published', protoBase = null, source = 'state' } = {}) {
  const from = edsHost ? '--eds-host' : stage === 'prototype' ? (protoBase ? '--proto-base' : '--proto-base default') : source === 'coverage' ? 'coverage deployedUrl' : 'state liveUrl';
  const origins = edsHost ? [edsHost] : [...new Set((pages || []).map((p) => { try { return new URL(p.liveUrl).origin; } catch { return null; } }).filter(Boolean))].sort();
  return { origins, from };
}
// `build host <origin>[, <origin>…] (<from>)` — the first status line's last clause.
const buildHostText = (b) => `build host ${b.origins.join(', ') || 'none'} (${b.from})`;
/**
 * The pools a job started by run-bg will run with, from run-bg's env before the job holds a slot: an inherited
 * STARDUST_BROWSER_SLOT → exactly what main() will see; STARDUST_BROWSER_SLOTS 0 (the lock off) → no slot; else the slot
 * run-bg will take, with run-bg's own browsersPerSlot (run-bg.mjs beside this file; absent → 1, erring high).
 */
function wouldBePools(flags, env) {
  if (env.STARDUST_BROWSER_SLOT) return browserPools(flags, env);
  const slots = String(env.STARDUST_BROWSER_SLOTS ?? '').trim();
  if (slots !== '' && Number(slots) === 0) return browserPools(flags, {});
  return browserPools(flags, { STARDUST_BROWSER_SLOT: 'run-bg', STARDUST_BROWSERS_PER_SLOT: String(RUN_BG && typeof RUN_BG.browsersPerSlot === 'function' ? RUN_BG.browsersPerSlot(env) : 1) });
}
/**
 * rosterEstimate(argv, { cwd, env }) → { pages, widths: 1, width, stage, source: 'coverage', coverage, estimatedSeconds,
 * factor, factorWhy } | { …, source: 'state', state, … } | { error } for gate-all's own argv (no node / script path): reads
 * only --coverage, --state, --stage, --proto-base, --only, --width and the pool flags (other flags, a bad pool value and
 * --help are skipped, never an exit or a print) and the roster's files resolved against cwd as main() does (a state.json
 * that does not parse beside a coverage: ignored) — no other I/O. estimatedSeconds carries estimateFactor of the pools the
 * job would run with in `env` (run-bg's, before it takes the job's slot — wouldBePools).
 */
export function rosterEstimate(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const o = { coverage: null, state: 'stardust/state.json', stage: 'published', protoBase: null, only: null, width: 1440, oc: '2', ec: '4', pc: '2' };
  const KEY = { '--coverage': 'coverage', '--state': 'state', '--stage': 'stage', '--proto-base': 'protoBase', '--only': 'only', '--width': 'width', '--origin-concurrency': 'oc', '--eds-concurrency': 'ec', '--probe-concurrency': 'pc' };
  const a = argv || [];
  for (let i = 0; i < a.length; i += 1) if (KEY[a[i]] && a[i + 1] != null) { o[KEY[a[i]]] = String(a[i + 1]); i += 1; }
  if (!['published', 'prototype'].includes(o.stage)) return { error: `--stage must be published or prototype (got ${o.stage})` };
  const only = o.only == null ? null : o.only.split(',').map((s) => s.trim()).filter(Boolean); const width = Number(o.width);
  const pool = (v, d) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : d; };
  const factor = estimateFactor(wouldBePools({ oc: pool(o.oc, 2), ec: pool(o.ec, 4), pc: pool(o.pc, 2) }, env || {}));
  const { cov, st } = rosterSource(o, cwd); const bad = (f) => (f.missing ? `${f.abs} not found` : `${f.abs} unreadable: ${f.error}`);
  const est = (coverage) => roster(selectPages(st.doc || null, { stage: o.stage, protoBase: o.protoBase && o.protoBase.replace(/\/$/, ''), only, coverage }).length, { width, stage: o.stage }, factor);
  if (cov) return cov.doc ? { ...est(cov.doc), source: 'coverage', coverage: cov.abs } : { error: bad(cov) };
  return st.doc ? { ...est(null), source: 'state', state: st.abs } : { error: bad(st) };
}
/**
 * emptySelection(state, { stage, only, statePath, coverage, coveragePath, source, stateError }) → the one stderr line naming
 * why no page was selected. Published: both sources (state / coverage null = not found; stateError: it did not parse) with
 * their counts and the roster's source, then the hint for that source (coverage wins for the published stage, so its hint
 * records deployed pages in the coverage instead of naming --state); prototype: the state file.
 */
export function emptySelection(state, { stage = 'published', only = null, statePath, coverage = null, coveragePath = DEFAULT_COVERAGE, source = coverage ? 'coverage' : 'state', stateError = null }) {
  const all = pagesOf(state); const proto = stage === 'prototype';
  const counted = all.filter((p) => (proto ? p.prototypePath : p.status === 'deployed' && p.liveUrl)); const noUrl = counted.filter((p) => !p.url).length;
  const onlyPart = (staged) => (only && staged ? `; --only ${only.join(',')} matched none of the ${staged} page(s) the stage selects` : '');
  if (proto) return `gate-all: no pages selected — ${statePath} has ${all.length} page(s), ${counted.length} with a prototypePath${noUrl ? ` (${noUrl} without a source url)` : ''} (${stage} stage)${onlyPart(counted.length - noUrl)}; pass --state stardust/state.json (or the gate state file) from the project root, or deploy first`;
  const rows = pagesOf(coverage).filter(delivered); const noSrc = rows.filter((r) => !(r.source && r.source.sourceUrl)).length;
  const covPart = coverage ? `coverage ${coveragePath} has ${pagesOf(coverage).length} row(s), ${rows.length} deployed / verified / gate-failed with a deployedUrl${noSrc ? ` (${noSrc} without a source url)` : ''}` : `coverage ${coveragePath} not found`;
  const statePart = state ? `state ${statePath} has ${all.length} page(s), ${counted.length} deployed with a liveUrl${noUrl ? ` (${noUrl} without a source url)` : ''}` : `state ${statePath} ${stateError ? 'unreadable' : 'not found'}`;
  const hint = source === 'coverage' ? 'coverage wins for the published stage — record deployed pages with update-coverage.mjs <slug> --status deployed --url <deployedUrl>, or pass --coverage <file> from the project root' : `pass --coverage ${DEFAULT_COVERAGE} or --state stardust/state.json from the project root, or deploy first`;
  return `gate-all: no pages selected — ${covPart}; ${statePart} (published stage, roster from ${source})${onlyPart(source === 'coverage' ? rows.length - noSrc : counted.length - noUrl)}; ${hint}`;
}

// ---- pure: overrides.json — an entry counts only when validated -----------------------------------------------------
export const OVERRIDE_VERDICTS = ['tier-shift', 'instrument-artifact', 'source-volatile'];
export const REGISTER_FILE = 'stardust/replica/inconsistency-register.md';
/** registerIds(text) → the sorted unique R-<nn> IDs that head a section of the inconsistency register (`## R-01 — …`). */
export function registerIds(text) {
  const ids = String(text ?? '').split(/\r?\n/).map((l) => /^#{1,6}\s+(R-\d+)\b/.exec(l)).filter(Boolean).map((m) => m[1]);
  return [...new Set(ids)].sort();
}
const passWord = (v) => (v === true ? 'PASS' : v === false ? 'FAIL' : 'n/a');
// An override too large for a deviation: the row's reason is this text as is (never `override rejected: …`) — it names the remedy.
const OVERRIDE_MAGNITUDE = 'override exceeds magnitude: use --hide / presence.json';
const exceedsMagnitude = (ov) => !!ov && ov.valid !== true && Array.isArray(ov.rejected) && ov.rejected.includes(OVERRIDE_MAGNITUDE);
/**
 * checkOverride(raw, { inconclusive, compared, clipPass, contentPass, stage, register, pct, heightDelta, originH, threshold,
 * heightTol }) → { verdict, reason, valid[, rejected][, magnitude] }, or null without an entry. `register` = { file, found, ids }
 * (REGISTER_FILE, read once per run); `compared` = the row has a pixel measurement (not a missing capture or a pixel error;
 * absent = not compared); pct / heightDelta / originH = the row's own measured numbers (the ones the row prints),
 * threshold / heightTol = the run's criteria. Each failing rule is one `rejected` line: the verdict is one of
 * OVERRIDE_VERDICTS; the reason names R-<nn> entries the register heads; clip PASS and — except on the prototype stage,
 * which has no content criterion — content PASS (n/a is not PASS); the row has a pixel measurement; the row is not
 * INCONCLUSIVE; the magnitude is a deviation's — pixel % ≤ 2 × threshold AND |Δh| ≤ 2 × heightTol × originH (inclusive),
 * else the line `override exceeds magnitude: use --hide / presence.json` and `magnitude` { pct, maxPct, heightDelta,
 * maxHeightDelta } (a measured row without those numbers cannot be bounded: rejected too). `rejected` is present only
 * when invalid.
 */
export function checkOverride(raw, { inconclusive = false, compared = false, clipPass = null, contentPass = null, stage = 'published', register = null, pct = null, heightDelta = null, originH = null, threshold = 10, heightTol = 0.05 } = {}) {
  if (raw == null) return null;
  const o = typeof raw === 'object' ? raw : { verdict: raw };
  const kind = o.verdict ?? null; const reason = o.reason ?? null; const file = (register && register.file) || REGISTER_FILE;
  const rejected = [];
  if (!OVERRIDE_VERDICTS.includes(kind)) rejected.push(`verdict "${kind}" is not ${OVERRIDE_VERDICTS.join(' / ')}`);
  const named = [...new Set(String(reason ?? '').match(/\bR-\d+\b/g) || [])];
  if (!named.length) rejected.push(`reason names no R-<nn> of ${REGISTER_FILE}`);
  else if (!register || !register.found) rejected.push(`no inconsistency register at ${file}`);
  else { const absent = named.filter((id) => !register.ids.includes(id)); if (absent.length) rejected.push(`${absent.join(', ')} not in ${file}`); }
  const proto = stage === 'prototype';
  if (clipPass !== true || (!proto && contentPass !== true)) rejected.push(`clip and content must pass (clip ${passWord(clipPass)}, content ${proto ? 'not a criterion' : passWord(contentPass)})`);
  if (!compared) rejected.push('no pixel measurement to override');
  if (inconclusive) rejected.push('the row is INCONCLUSIVE — no verdict to override');
  let magnitude = null;
  if (compared && !inconclusive) {
    const measured = [pct, heightDelta, originH].every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!measured) rejected.push('no measured pixel % / Δh / origin height to bound the override');
    else if (pct > 2 * threshold || Math.abs(heightDelta) > 2 * heightTol * originH) {
      rejected.push(OVERRIDE_MAGNITUDE);
      magnitude = { pct, maxPct: 2 * threshold, heightDelta, maxHeightDelta: Math.round(2 * heightTol * originH * 100) / 100 };
    }
  }
  return { verdict: kind, reason, valid: !rejected.length, ...(rejected.length ? { rejected } : {}), ...(magnitude ? { magnitude } : {}) };
}

// ---- pure: the verdict --------------------------------------------------------------------------------
/**
 * capturePollution(originMeta, edsMeta[, lists]) → why the capture pair cannot carry a pixel verdict (origin.json, eds.json; the EDS
 * side is `build`): a crawl-fullpage / asymmetric origin fallback, or a stitch whose record names an overlay left after
 * dismissal (`unchecked …` when stitch-shot wrote no record). A missing, failed or `none` capture adds nothing — that row
 * is an error. A legacy meta without `overlayLeft` adds nothing either; the reuse deciders refuse it instead (and
 * --compare-only, which takes no capture, hands it in as `unchecked`). `lists` = this run's { hide, dismiss } (given by
 * main()): a stitched capture taken with another hide or --dismiss list (absent = none) — a previous origin kept after a
 * failed --recapture-origin, or a record --compare-only reads — is `<side> capture polluted: kept <side> taken with another
 * dismiss/hide list` (the two sides were not taken alike).
 */
export function capturePollution(originMeta, edsMeta, lists = null) {
  const out = [];
  for (const [side, m] of [['origin', originMeta], ['build', edsMeta]]) {
    if (!m || m.error || !m.instrument || m.instrument === 'none') continue;
    if (m.instrument === 'crawl-fullpage' || m.asymmetric) out.push(`${side} capture polluted: crawl-fullpage fallback${m.note ? ` — ${m.note}` : ''}`);
    if (m.instrument === 'stitch-live' && m.overlayLeft) out.push(`${side} capture polluted: overlay left — ${m.overlayLeft}`);
    if (lists && m.instrument === 'stitch-live' && (!sameHide(m.hide, lists.hide) || !sameDismiss(m.dismiss, lists.dismiss))) out.push(`${side} capture polluted: kept ${side} taken with another dismiss/hide list`);
  }
  return out;
}
/** fontsNotLoaded(originMeta, edsMeta) → the declared faces that did not load on either side (the capture records' `fontsFailed`), sorted, unique. */
export function fontsNotLoaded(originMeta, edsMeta) {
  return [...new Set([originMeta, edsMeta].flatMap((m) => (m && Array.isArray(m.fontsFailed) ? m.fontsFailed : [])).filter((f) => typeof f === 'string' && f))].sort();
}
/**
 * fontChecksSkipped(originMeta, edsMeta) → the sides ('origin', then 'build' for the EDS side) whose stitch-live record
 * says `fontsFailed: null` — the font check could not run, so no face is known to have loaded. Explicit null only: an
 * absent key is a legacy meta and adds nothing.
 */
export function fontChecksSkipped(originMeta, edsMeta) {
  return [['origin', originMeta], ['build', edsMeta]].filter(([, m]) => m && m.instrument === 'stitch-live' && m.fontsFailed === null).map(([side]) => side);
}
/**
 * verdict({ pixel, clip, content, units, override, allowance, capture, register }, opts) → row fields. `pixel` = pixel.json,
 * `clip` = { counts } (served side) or null, `content` = { totals } | { error } | null, `units` = { verdict } | null,
 * `capture` = { polluted: capturePollution(…), fonts: fontsNotLoaded(…), fontsSkipped: fontChecksSkipped(…) } — any
 * pollution makes the row INCONCLUSIVE: pixelPass / heightPass null, never PASS, no override lifts it, its reasons are
 * the pollution (then the font reasons);
 * any font fails the row with one `font-not-loaded:<family>` reason each (`fontsNotLoaded`), any side whose font check
 * could not run with one `font-check-skipped:<side>` (`fontChecksSkipped`); the pixel-only calibration
 * verdict unchanged. `override` (the overrides.json entry) is validated
 * with checkOverride against `register` and opts.stage → the row's `override`; only a valid one sets passWithOverride,
 * an invalid one on a failing row adds one `override rejected: <rule>` reason per rule — the magnitude rule's line as is:
 * `override exceeds magnitude: use --hide / presence.json` (no prefix).
 */
export function verdict({ pixel = {}, clip = null, content = null, units = null, override = null, allowance = 0, capture = { polluted: [], fonts: [], fontsSkipped: [] }, register = null }, { threshold = 10, heightTol = 0.05, clipMax = 0, clipOn = true, contentOn = true, stage = 'published' } = {}) {
  const polluted = (capture && capture.polluted) || []; const inconclusive = polluted.length > 0;
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
  const fonts = (capture && capture.fonts) || []; const skipped = (capture && capture.fontsSkipped) || [];
  const fontReasons = [...fonts.map((f) => `font-not-loaded:${f}`), ...skipped.map((side) => `font-check-skipped:${side}`)];
  reasons.push(...fontReasons);
  const pixelOnlyPass = !inconclusive && !!(pixelPass && heightPass);
  const pass = pixelOnlyPass && clipPass !== false && contentPass !== false && unitPass !== false && !fontReasons.length;
  const ov = checkOverride(override, { inconclusive, compared: !!compared, clipPass, contentPass, stage, register, pct: compared ? pixel.pct : null, heightDelta: compared ? pixel.heightDelta : null, originH, threshold, heightTol });
  if (!inconclusive && !pass && ov && !ov.valid) reasons.push(...ov.rejected.map((x) => (x === OVERRIDE_MAGNITUDE ? x : `override rejected: ${x}`)));
  return { originH, edsH, pixelPass: inconclusive ? null : !!pixelPass, heightPass: inconclusive ? null : !!heightPass, clipped, clipPass, clipAllowance: allowance, contentPass, contentNA: contentOn && !cTot ? (content && content.error) || 'not probed' : null, unitPass, pixelOnlyPass, pass, passWithOverride: pass || !!(ov && ov.valid), inconclusive, fontsNotLoaded: fonts, fontChecksSkipped: skipped, reasons: inconclusive ? [...polluted, ...fontReasons] : reasons, override: ov };
}

const cell = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
export function formatSummary(summary) {
  const t = summary.totals; const p = summary._provenance;
  // validated overrides lift a row (counted); rejected ones are named — both with the share of the table they cover
  const counted = t.overridePass || 0; const rejected = t.overrideRejected || 0;
  const ovClause = counted + rejected ? ` · overrides: ${counted} counted / ${rejected} rejected — override share ${counted} of ${t.pages} (${(t.pages ? (100 * counted) / t.pages : 0).toFixed(1)} %)` : '';
  // the faces that did not load, named once across the table (the calibration line)
  const fonts = [...new Set(summary.rows.flatMap((r) => r.fontsNotLoaded || []))].sort();
  // the failing rows whose override is too large for a deviation (pixel % > 2 × threshold or |Δh| > 2 × the height bar), named once
  const oversized = summary.rows.filter((r) => !r.pass && exceedsMagnitude(r.override)).map((r) => r.path);
  const head = [`# ${p.stage === 'prototype' ? 'Prototype gate — every crafted prototype' : 'Published-origin gate — all deployed pages'}, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error${t.inconclusive ? ` / ${t.inconclusive} INCONCLUSIVE` : ''} of ${t.pages}**${ovClause}${t.reusedRows || t.reusedProbes ? ` · reused: ${t.reusedRows || 0} rows, ${t.reusedProbes || 0} probe sets` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}${t.fontsNotLoaded ? `, fonts not loaded ${t.fontsNotLoaded}${fonts.length ? ` (${fonts.join(', ')})` : ''}` : ''}${t.fontChecksSkipped ? `, font check skipped ${t.fontChecksSkipped}` : ''}; content n/a (origin not probed) ${t.contentNA}${t.degradedTier ? `; **${t.degradedTier} page(s) probed on a degraded browser tier** (Chrome elected, Chromium used — install Chrome for bot-managed origins)` : ''}${t.asymmetricOrigins ? `; ${t.asymmetricOrigins} asymmetric origin(s)` : ''}.`, '', ...(oversized.length ? [`Override exceeds magnitude (fix the capture / hide list, not a deviation): ${oversized.join(', ')}`, ''] : [])];
  const rows = ['| page | template | tier | origin | browser | pixel % (text %) | Δh px | clipped | content | units | verdict | reasons | reused |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const content = r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}` : '-';
    const verdictCell = r.inconclusive ? 'INCONCLUSIVE' : r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${r.browser || '-'} | ${cell(r.pct)}${r.textPct != null ? ` (${r.textPct})` : ''} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? ` → ${r.override.verdict}: ${r.override.reason}${r.override.valid === true ? '' : ' (rejected)'}` : ''} | ${r.reasons.join('; ') || '-'} | ${r.reused ? `${r.reused.what} ${r.reused.at}` : '-'} |`);
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
 * --dismiss: the extra overlay-dismiss selectors both stitches click before the hide list — recorded like a hide list
 * (`{ dismiss }` only when non-empty: records, probes.json inputs and the gate key from runs without one stay as they
 * were) and compared by the same rule (split on ',', trimmed, de-duplicated, the order part of the list).
 */
const dismissField = (list) => (list && list.length ? { dismiss: list } : {});
const sameDismiss = (recorded, list) => sameHide(recorded, list);
/** stitch-shot's `hidden: <sel> ×<n> (<h>px) [<source>]; …` stdout line (printed only with --hide) → that text, else null. */
const hiddenText = (out) => { const l = String(out || '').split('\n').map((x) => x.trim()).filter((x) => x.startsWith('hidden: ')).pop(); return l ? l.slice('hidden: '.length) : null; };
/** A hidden text's selectors that matched nothing (×0) or were invalid (error) → one short log clause, else null. */
function hiddenMisses(text) {
  const entries = String(text || '').split('; ');
  const zero = entries.map((e) => /^(.+) ×0 \[[^\]]*\]$/.exec(e)).filter(Boolean).map((m) => m[1]);
  const bad = entries.map((e) => /^(.+?) error: .*\[[^\]]*\]$/.exec(e)).filter(Boolean).map((m) => m[1]);
  const parts = [zero.length ? `matched nothing: ${zero.join(', ')}` : '', bad.length ? `invalid: ${bad.join(', ')}` : ''].filter(Boolean);
  return parts.length ? `hide ${parts.join('; ')}` : null;
}
/**
 * What a page's probes were taken with — any change re-runs them. ctx = { opts, edsUrl, presence, unitsOf, hideOf }
 * (hideOf(p) = the page's presence.json hide list; `hide` is an input only when non-empty; so is opts.dismiss, the
 * --dismiss list the capture pair was taken with).
 */
export function probeInputs(p, { opts, edsUrl, presence = {}, unitsOf, hideOf = () => [] }) {
  return { origin: p.url, eds: edsUrl(p), width: opts.width, warmup: opts.warmup ?? null, stage: opts.stage, content: opts.content, clip: opts.clip, presence: presence[p.slug] ?? null, units: unitsOf(p), unitTol: opts.unitTol, ...hideField(hideOf(p)), ...dismissField(opts.dismiss) };
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
 * page's sidecar entries (a mask or allowance edit is a key change; the presence.json hide list only when non-empty),
 * the --dismiss list (settings, only when non-empty) and the instruments' hash.
 */
export function gateKeyParts(p, { root = '.', opts, edsUrl = (x) => x.liveUrl, masks = {}, clipAllow = {}, presence = {}, unitsOf = () => [], hideOf = () => [], foundation = foundationPart(root), coverage = {}, shared = sharedBlocks(root, coverage), chrome = chromeDocs(root), instruments = instrumentsHash() }) {
  const url = new URL(edsUrl(p)); const page = `content${daPathOf(url.pathname)}.html`;
  if (!existsSync(join(root, page))) return { parts: null, why: `no ${page}` };
  const buf = readFileSync(join(root, page));
  const named = new Set([...(coverage[p.slug] || []), ...chrome.names, ...[...buf.toString('utf8').matchAll(BLOCK_CLASS)].map((m) => m[1])]);
  const blocks = Object.fromEntries(blockClosure(root, named).map((n) => [n, blockFiles(root, n)]));
  const settings = { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, clip: opts.clip, content: opts.content, ...dismissField(opts.dismiss) };
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
 * capture taken with another hide list or another --dismiss list, not a stitched one whose record predates the
 * overlay-left check. ctx = { opts, has(p, side), keyChanged(p), hideChanged(p, side), dismissChanged(p, side), unchecked(p, side) }.
 */
export function skipCapture(p, side, { opts, has, keyChanged: changed, hideChanged = () => false, dismissChanged = () => false, unchecked = () => false }) {
  return !!opts.skip && !opts[side === 'eds' ? 'recaptureEds' : 'recaptureOrigin'] && !(side === 'eds' && changed(p)) && has(p, side) && !hideChanged(p, side) && !dismissChanged(p, side) && !unchecked(p, side);
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
 * rowReuse({ prior, gateKey, edsPng, override, register, opts, host }) → the prior row again, marked `reused`, or null. Only under
 * --skip-existing on the published stage without --recapture-*, with a known current key equal to the row's, a
 * PASS (not an override) from a table written under this run's criteria and the page's eds.png on disk — never an
 * INCONCLUSIVE row, never one measured on an asymmetric (crawl-fullpage) origin. `at` stays the time the row was measured;
 * the override it attaches (this run's overrides.json entry) is validated against `register` like a fresh row's — its
 * magnitude on the row's own pct / heightDelta / originH under this run's --threshold / --height-tol. `host` = this run's
 * build origin for the page: the reused row keeps its own `host`; one written before that field takes `host` (the equal
 * gate key hashes the build origin, so it proves the same host).
 */
export function rowReuse({ prior, gateKey, edsPng, override = null, register = null, opts, host = null }) {
  if (!opts.skip || opts.stage !== 'published' || opts.recaptureEds || opts.recaptureOrigin || !gateKey || !prior || !edsPng) return null;
  const { row } = prior;
  if (row.gateKey !== gateKey || row.pass !== true || row.inconclusive || row.originAsymmetric || !sameCriteria(prior.prov, opts)) return null;
  const at = row.reused && row.reused.what === 'row' ? row.reused.at : prior.at;
  // the override is re-checked on the reused row's own measured numbers, like a fresh row's
  const ov = checkOverride(override, { inconclusive: false, compared: row.pct != null, clipPass: row.clipPass, contentPass: row.contentPass, stage: opts.stage, register, pct: row.pct, heightDelta: row.heightDelta, originH: row.originH, threshold: opts.threshold, heightTol: opts.heightTol });
  // a row from a table written before `host` takes this run's host only because its equal gate key (it hashes the build origin) proves it
  return { ...row, host: 'host' in row ? row.host : row.gateKey === gateKey ? host : null, override: ov, passWithOverride: row.pass || !!(ov && ov.valid), reused: { what: 'row', from: prior.from, at, gateKey } };
}

// ---- fix rounds: <out>/<slug>/rounds.json counts the --only runs that yielded a verdict — the cap is mechanical ----------
export const MAX_ROUNDS = 3;
/** A row a fix round counts: a verdict — a pixel measurement, not INCONCLUSIVE (a reused row's verdict is one too). */
export const countsAsRound = (row) => !!row && row.pct != null && row.inconclusive !== true;
/** <out>/runs/*.json in name order → [{ file, at, rows }] (unreadable tables skipped; at = _provenance.writtenAt, else the file's mtime). */
export function runTables(outDir) {
  const dir = join(outDir, 'runs'); if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let s; try { s = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!s || !Array.isArray(s.rows)) continue;
    const at = (s._provenance && typeof s._provenance.writtenAt === 'string' && s._provenance.writtenAt) || statSync(join(dir, f)).mtime.toISOString();
    out.push({ file: `runs/${f}`, at, rows: s.rows });
  }
  return out;
}
/**
 * roundsOf(outDir, slug[, tables]) → { rounds, max, at, resets, from: 'rounds.json' | 'runs'[, seeded, seededFrom] } —
 * fs reads only; gate-all's cap and gate-triage read the count with it. <outDir>/<slug>/rounds.json when present (one
 * that does not parse, or has no integer `rounds`, reads as absent); else the legacy seed: the number of
 * <outDir>/runs/*.json tables holding a row for the slug that countsAsRound (`at` their writtenAt, sorted; max MAX_ROUNDS).
 * `tables` = runTables(outDir), read once for many slugs.
 */
export function roundsOf(outDir, slug, tables = null) {
  let doc = null; try { doc = JSON.parse(readFileSync(join(outDir, slug, 'rounds.json'), 'utf8')); } catch { doc = null; }
  if (doc && typeof doc === 'object' && Number.isInteger(doc.rounds) && doc.rounds >= 0) {
    return { rounds: doc.rounds, max: Number.isInteger(doc.max) && doc.max >= 1 ? doc.max : MAX_ROUNDS, at: Array.isArray(doc.at) ? doc.at : [], resets: Array.isArray(doc.resets) ? doc.resets : [], from: 'rounds.json', ...(doc.seeded ? { seeded: doc.seeded, seededFrom: doc.seededFrom } : {}) };
  }
  const at = (tables || runTables(outDir)).filter((t) => t.rows.some((r) => r && r.slug === slug && countsAsRound(r))).map((t) => t.at).sort();
  return { rounds: at.length, max: MAX_ROUNDS, at, resets: [], from: 'runs' };
}
/**
 * capRefusal(states, { max, width, reset }) → the one stderr line refusing an --only run, or null. `states` = the selected
 * pages' [{ slug, rounds }]; any at rounds ≥ max refuses — unless `reset` (--round-reset: the re-prototype decision).
 */
export function capRefusal(states, { max = MAX_ROUNDS, width, reset = null } = {}) {
  const capped = states.filter((s) => s.rounds >= max);
  if (!capped.length || reset) return null;
  const names = capped.map((s) => s.slug).join(', ');
  return `gate-all: refused to start, no verdict — cap reached — re-prototype decision: ${capped.map((s) => `${s.slug} ${s.rounds}/${max} @${width}`).join(', ')} (the fix-round cap, --max-rounds ${max}); drop ${names} from --only, or record the re-prototype decision with --round-reset "<reason>" (a new count for the page(s) at the cap)`;
}
/**
 * nextRounds(prev, { at, max, counted, reset }) → { doc, round, roundReset, changed }: the page's rounds.json after this run.
 * `prev` = roundsOf(…); `reset` (a reason) first appends { at, reason, from, history } to resets and zeroes the count;
 * `counted` (countsAsRound) then adds `at`. doc = { rounds, max, at, [resets], [seeded: 'runs', seededFrom] } — the seed
 * recorded when the count came from runs/*.json rows (and kept once recorded); `changed` = something to write. Pure.
 */
export function nextRounds(prev, { at, max = MAX_ROUNDS, counted = false, reset = null }) {
  let rounds = prev.rounds; let ats = [...(prev.at || [])]; const resets = [...(prev.resets || [])]; let roundReset = null;
  if (reset) { resets.push({ at, reason: reset, from: rounds, history: ats }); rounds = 0; ats = []; roundReset = { reason: reset, at }; }
  if (counted) { rounds += 1; ats.push(at); }
  const seed = prev.seeded ? { seeded: prev.seeded, seededFrom: prev.seededFrom } : prev.from === 'runs' && prev.rounds > 0 ? { seeded: 'runs', seededFrom: prev.rounds } : {};
  return { doc: { rounds, max, at: ats, ...(resets.length ? { resets } : {}), ...seed }, round: rounds, roundReset, changed: !!(counted || reset) };
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (cands) => cands.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const DIFF_DIR = firstExisting(['../../diff/scripts', '../diff']);
const { unitsFor } = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'unit-geometry.mjs')).href) : { unitsFor: () => [] };
const FRESH = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'live-session.mjs')).href) : null;
// run-bg's own per-slot rule (browsersPerSlot) for rosterEstimate. run-bg imports this file only dynamically, inside a
// gate-all job's sizing, and has no import-time side effects (its CLI runs only as the entry), so there is no cycle;
// dynamic + guarded so a copy of this file without run-bg.mjs beside it still loads.
const RUN_BG = existsSync(join(HERE, 'run-bg.mjs')) ? await import(pathToFileURL(join(HERE, 'run-bg.mjs')).href) : null;

// ---- origin reuse (pure): `fresh` = live-session.mjs freshness() of the capture's `at` ---------------------------
/**
 * A kept capture's overlay-left record (origin.json from stitch-shot's --json record, live.json from gate.sh): no
 * `overlayLeft` key (or no record) → it predates the check; a truthy one → it left an overlay. → why not, or null.
 */
const overlayWhy = (meta, what) => (!meta || !('overlayLeft' in meta) ? `${what} predates the overlay-left check` : meta.overlayLeft ? `${what} left an overlay (${meta.overlayLeft})` : null);
/** A stitched capture record (origin.json / eds.json) from before the overlay-left check: no `overlayLeft` key. */
const legacyStitch = (meta) => !!meta && meta.instrument === 'stitch-live' && !('overlayLeft' in meta);
const LEGACY_UNCHECKED = 'unchecked (capture predates the overlay-left check)';
/**
 * May a fix round keep <out>/<slug>/origin.png? → { reuse, why } (why = the policy when reused). `hide` = this run's
 * presence.json hide list for the page, `dismiss` = this run's --dismiss list; origin.json's `hide` and `dismiss` (absent
 * = []) must be the same lists; origin.json must record the overlay-left check with nothing left (`overlayLeft: null`).
 */
export function originReusePlan({ stage, only, recaptureEds, recaptureOrigin, url, width, vh, hide = [], dismiss = [] }, prev, fresh) {
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
  if (!sameDismiss(prev.dismiss, dismiss)) return no('dismiss list differs');
  const left = overlayWhy(prev, 'previous origin'); if (left) return no(left);
  if (!fresh || !fresh.fresh) return no((fresh && fresh.reason) || 'no freshness verdict');
  return { reuse: true, why: fresh.policy };
}
/**
 * May the published stage take the archetype round's gates/<slug>-<w>/live.png? `liveMeta` = its live.json (gate.sh).
 * Symmetric capture: every parameter must be the one gate-all's own origin stitch would use (url, width, --vh, en-US,
 * --settle, the built-in dismissal with this run's --dismiss list — live.json `dismiss.extra` (gate.sh --dismiss),
 * absent = none, the same list; no site consent selector —, the default UA, the same hide list: live.json `hide`, absent
 * = []), and live.json must record the overlay-left check with nothing left. The one deliberate difference: live.png is
 * headless bundled Chromium (the EDS side's tier), recorded as `headed: false` in origin.json.
 */
export function liveReusePlan({ stage, recaptureOrigin, url, width, vh, hide = [], dismiss = [] }, liveMeta, fresh) {
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
  if (dm.consent != null) return no(`live.json dismissed site selectors (consent ${dm.consent}, extra ${dm.extra}) gate-all's stitch does not use`);
  if (!sameDismiss(dm.extra, dismiss)) return no('live.json dismiss list differs');
  if (liveMeta.ua != null) return no('live.json custom user agent');
  if (!sameHide(liveMeta.hide, hide)) return no('live.json hide list differs');
  const left = overlayWhy(liveMeta, 'live.png'); if (left) return no(left);
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

// ---- presence: the site-wide stardust/replica/presence.json merged UNDER <out>/presence.json --------------------------
const SITE_PRESENCE_FILE = 'stardust/replica/presence.json'; // live-session's SITE_PRESENCE when it exports one
const hasHide = (doc) => Object.values(doc && typeof doc === 'object' ? doc : {}).some((e) => e && typeof e === 'object' && e.hide != null);
/**
 * presenceOf(out) → { presence, note, notHonoured }: the run's one presence object — live-session's mergePresence(site,
 * gate) of the site-wide file (cwd-relative) and <out>/presence.json (per top-level key and field the gate dir's value
 * wins; keys / fields only one file has are kept; a missing file = {}), each entry without `reasons` (presence.mjs's notes,
 * read by no one here). A malformed file of either throws `presence.json <file> unreadable (…)`. `note` names the sources
 * when a site file is merged; `notHonoured` is the one log line when the diff scripts dir cannot honour them — no
 * presenceHide: no hides at all; no mergePresence: the site file is left out of the run.
 */
function presenceOf(out) {
  const read = (f) => { if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`presence.json ${f} unreadable (${e.message})`); } };
  const gateFile = join(out, 'presence.json'); const siteFile = (FRESH && typeof FRESH.SITE_PRESENCE === 'string' && FRESH.SITE_PRESENCE) || SITE_PRESENCE_FILE;
  const gate = read(gateFile); const site = read(siteFile);
  const hideOk = !!FRESH && typeof FRESH.presenceHide === 'function'; const mergeOk = !!FRESH && typeof FRESH.mergePresence === 'function';
  const merged = site && mergeOk ? FRESH.mergePresence(site, gate) : gate && typeof gate === 'object' ? gate : {};
  const presence = Object.fromEntries(Object.entries(merged).map(([k, e]) => [k, e && typeof e === 'object' && !Array.isArray(e) ? Object.fromEntries(Object.entries(e).filter(([f]) => f !== 'reasons')) : e]));
  const note = site && mergeOk ? `presence: ${gate ? `${gateFile} over ${siteFile}` : `${siteFile} (${gateFile} not found)`} — the gate dir's field wins` : null;
  let notHonoured = null;
  if (!hideOk && (hasHide(gate) || hasHide(site))) notHonoured = 'presence hide: not honoured — the diff scripts dir has no live-session.mjs with presenceHide; captures and probes run without hides';
  else if (site && typeof site === 'object' && Object.keys(site).length && !mergeOk) notHonoured = `presence hide: not honoured for ${siteFile} (site-wide) — the diff scripts dir has no live-session.mjs with mergePresence; captures and probes run with ${gate ? gateFile : 'no presence.json'} only`;
  return { presence, note, notHonoured };
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

// ---- fix-round reservation: <out>/<slug>/rounds.lock { pid, at } per selected page, released on exit -----------------
const HELD = []; // { file (null until taken), made: the dirs the reservation created, deepest first (removed again while empty) }
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function releaseRounds() {
  while (HELD.length) {
    const { file, made } = HELD.pop();
    if (file) { try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ } }
    for (const d of made) { try { rmdirSync(d); } catch { /* not empty: the run wrote there */ } }
  }
}
// A lock with no readable pid this young may be one being written by hand or by an older copy — held, never reaped.
const LOCK_GRACE_MS = 30e3;
const uniq = () => `${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
const ago = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; };
/**
 * A rounds.lock's holder → { pid, at, ageMs } (pid from the JSON, else from a partial `"pid": <n>`, else null; at = its
 * `at`, else the file's mtime; ageMs = the file's age), or null when the file is gone.
 */
function lockHolder(file) {
  let text; let st; try { text = readFileSync(file, 'utf8'); st = statSync(file); } catch { return null; }
  let j = null; try { j = JSON.parse(text); } catch { j = null; }
  const m = /"pid"\s*:\s*(\d+)/.exec(text);
  const pid = j && Number.isInteger(j.pid) && j.pid > 0 ? j.pid : m && Number(m[1]) > 0 ? Number(m[1]) : null;
  return { pid, at: (j && typeof j.at === 'string' && j.at) || st.mtime.toISOString(), ageMs: Date.now() - st.mtimeMs };
}
// Held: a running process's lock (not this process's pid — that one predates it), or a young lock without a readable pid.
const lockLive = (h) => (h.pid ? h.pid !== process.pid && pidAlive(h.pid) : h.ageMs < LOCK_GRACE_MS);
/**
 * Takes every selected page's rounds.lock (sorted) before the cap check → the log notes. A lock appears complete: its
 * { pid, at } is written to a unique temp file that is hard-linked into place (EEXIST = held). A held lock (lockLive)
 * refuses the run — one stderr line naming the pid, the lock's age and the recovery, exit 2 (the locks taken so far and the
 * dirs the reservation created are released by the exit handler — nothing written). A dead one is reaped: renamed to a
 * unique name, re-read there and deleted only if still dead (a live one is linked back and refuses).
 */
function reserveRounds(out, slugs) {
  process.on('exit', releaseRounds);
  const notes = [];
  for (const slug of slugs) {
    const d = resolve(out, slug); const file = join(d, 'rounds.lock'); const shown = join(out, slug, 'rounds.lock');
    const made = []; for (let x = d; !existsSync(x) && dirname(x) !== x; x = dirname(x)) made.push(x);
    const entry = { file: null, made }; HELD.push(entry);
    mkdirSync(d, { recursive: true });
    const refuse = (h) => { console.error(`gate-all: refused to start, no verdict — a round of ${slug} is in progress (pid ${h && h.pid ? h.pid : 'unknown'}) — lock taken ${h ? `${h.at} (${ago(Date.now() - (Date.parse(h.at) || Date.now() - h.ageMs))} ago)` : 'just now'}: ${shown}; wait for that run to end, or remove ${shown} if no gate-all run is active`); process.exit(2); };
    for (let attempt = 0; !entry.file; attempt += 1) {
      const tmp = `${file}.${uniq()}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
      try { linkSync(tmp, file); entry.file = file; } catch (e) { if (e.code !== 'EEXIST') throw e; } finally { rmSync(tmp, { force: true }); }
      if (entry.file) break;
      const h = lockHolder(file);
      if (attempt >= 3) refuse(h);
      if (!h) continue; // released meanwhile — take it
      if (lockLive(h)) refuse(h);
      const aside = `${file}.reap.${uniq()}`;
      try { renameSync(file, aside); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      const moved = lockHolder(aside);
      if (moved && lockLive(moved)) { try { linkSync(aside, file); rmSync(aside, { force: true }); } catch { /* another lock took its place: this one stays beside it */ } refuse(moved); }
      rmSync(aside, { force: true });
      notes.push(`rounds lock ${slug} → reaped ${moved && moved.pid ? `pid ${moved.pid} (not running; taken ${moved.at})` : `an unreadable lock (${ago(moved ? moved.ageMs : 0)} old)`}`);
    }
  }
  return notes;
}
const writeJsonAtomic = (f, doc) => { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(doc, null, 1)}\n`); renameSync(tmp, f); };

async function main() {
  const opts = parseArgs(process.argv);
  const startedAt = new Date().toISOString(); // this process's start (gate-key.json); runStart below is the run anchor
  const { cov, st } = rosterSource(opts);
  if (cov && !cov.doc) { console.error(cov.missing ? `gate-all: ${cov.path} not found — run from the project root or pass --coverage` : `gate-all: ${cov.path} unreadable: ${cov.error}`); process.exit(1); }
  if (!cov && st.missing) { console.error(opts.stage === 'prototype' ? `gate-all: ${opts.state} not found — run from the project root or pass --state` : `gate-all: neither ${DEFAULT_COVERAGE} nor ${opts.state} found — run from the project root or pass --coverage / --state`); process.exit(1); }
  if (!cov && st.error) throw new Error(st.error);
  if (cov && st.error) console.error(`gate-all: ${opts.state} unreadable (${st.error}) — roster from coverage without state enrichment`);
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = st.doc || null; const covDoc = cov ? cov.doc : null;
  const pages = selectPages(state, { ...opts, coverage: covDoc });
  if (opts.stage === 'prototype' && !opts.protoBase) console.error('gate-all: --stage prototype without --proto-base — assuming http://localhost:8791 (serve the prototypes dir there, replica SKILL.md § Phase 4)');
  if (!pages.length) { console.error(emptySelection(state, { stage: opts.stage, only: opts.only, statePath: st.abs, coverage: covDoc, coveragePath: cov ? cov.abs : resolve(DEFAULT_COVERAGE), source: cov ? 'coverage' : 'state', stateError: st.error })); process.exit(1); }
  const qualified = selectPages(state, { ...opts, coverage: covDoc, only: null }).length;
  const sourceText = cov ? `coverage ${cov.path} (${qualified} of ${pagesOf(covDoc).length} row(s) qualified)` : `state ${opts.state} (${qualified} of ${pagesOf(state).length} page(s) qualified)`;
  // Deadline guard: a run-bg deadline below the estimate would kill the job mid-roster — refuse before any write.
  const R = roster(pages.length, opts, estimateFactor(opts.pools));
  if (opts.deadlineSec && opts.deadlineSec < R.estimatedSeconds) { console.error(`gate-all: refused to start, no verdict — ${rosterText(R)} need an estimated ${R.estimatedSeconds} s (${estimateText(R)}), above this job's run-bg deadline of ${opts.deadlineSec} s (RUN_BG_DEADLINE_SEC); re-start the job with run-bg.mjs start --timeout ${R.estimatedSeconds} …, or omit --timeout: run-bg sizes a gate-all job's deadline to this estimate`); process.exit(2); }
  // Fix rounds (--only): reserve every selected page's round, then the cap — refused before the out dir and any write.
  const slugs = [...new Set(pages.map((p) => p.slug))].sort();
  // presence: the site-wide file merged UNDER <out>/presence.json (read before any write: a malformed one names its file)
  const PRES = presenceOf(opts.out);
  const lockNotes = opts.only ? reserveRounds(opts.out, slugs) : [];
  const TABLES = runTables(opts.out);
  const ROUNDS = Object.fromEntries(slugs.map((slug) => [slug, roundsOf(opts.out, slug, TABLES)]));
  const refusal = opts.only ? capRefusal(slugs.map((slug) => ({ slug, rounds: ROUNDS[slug].rounds })), { max: opts.maxRounds, width: opts.width, reset: opts.roundReset }) : null;
  if (refusal) { console.error(refusal); process.exit(2); }
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  // the inconsistency register an override must name an entry of (read once; cwd-relative like units.json)
  const REGISTER = (() => { try { return { file: REGISTER_FILE, found: true, ids: registerIds(readFileSync(REGISTER_FILE, 'utf8')) }; } catch { return { file: REGISTER_FILE, found: false, ids: [] }; } })();
  const CLIP_ALLOW = readJson(join(opts.out, 'clip-allow.json'), {}); const PRESENCE = PRES.presence;
  const FAMILIES = readJson('stardust/replica/units.json', null);
  const UNITS = readJson(opts.units || join(opts.out, 'units.json'), {});
  const unitsOf = (p) => (FAMILIES ? unitsFor(FAMILIES, p.slug, p.template) : ((UNITS[p.slug] || {}).units || []).map((x) => ({ origin: x.origin, eds: x.eds || x.origin, n: x.n || 1, required: x.required !== false })));
  const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); writeFileSync(join(opts.out, '_run.log'), `${line}\n`, { flag: 'a' }); };
  log(`roster: ${rosterText(R)} — estimated ${R.estimatedSeconds} s (${estimateText(R)})${opts.deadlineSec ? `; run-bg deadline ${opts.deadlineSec} s` : ''}; source: ${sourceText}; ${buildHostText(buildHost(pages, { edsHost: opts.edsHost, stage: opts.stage, protoBase: opts.protoBase, source: cov ? 'coverage' : 'state' }))}`);
  // One run anchor per process (every row of the run judged against it); --origin-max-age reaches the probes via the env.
  const ledger = join(dirname(opts.state), 'status.jsonl');
  const runStart = FRESH ? FRESH.runStartAt({ ledger }) : null;
  const maxAgeH = opts.originMaxAge ?? (FRESH ? FRESH.maxAgeHours() : null);
  if (opts.originMaxAge != null) process.env.STARDUST_ORIGIN_MAX_AGE_H = String(opts.originMaxAge);
  const fresh = (m) => (FRESH ? FRESH.freshness(m, { runStart, maxAgeH, ledger }) : { fresh: false, policy: null, reason: 'no freshness policy (diff scripts dir not found)' });
  const reuseOf = (from, m, policy) => ({ ...(FRESH ? FRESH.reuseRecord(from, m, { policy }) : { reused: true, from, at: m.at, policy }), reusedAt: new Date().toISOString() });
  const tryJson = (f) => { try { return readJson(f); } catch { return null; } };
  log(`origin reuse: ${!FRESH ? 'off (live-session.mjs not found in the diff scripts dir)' : runStart ? `same run since ${runStart}` : `no run anchor in ${ledger} (reuse only with --origin-max-age)`}${FRESH && maxAgeH ? `; captures up to ${maxAgeH}h old` : ''}; pools origin ${opts.oc} / eds ${opts.ec} / probe ${opts.pc}${poolsNote(opts.pools)}`);
  for (const note of lockNotes) log(note);
  if (opts.roundReset) {
    const capped = slugs.filter((slug) => ROUNDS[slug].rounds >= opts.maxRounds);
    log(capped.length ? `round-reset: ${capped.map((slug) => `${slug} ${ROUNDS[slug].rounds}/${opts.maxRounds} @${opts.width}`).join(', ')} → a new count (${opts.roundReset})` : 'round-reset: no --only slug at the cap — nothing reset');
  }
  // presence.json `hide` → the page's one list (live-session presenceHide: "*" then the slug's) for both stitches and the probes
  const HIDE_OK = !!FRESH && typeof FRESH.presenceHide === 'function';
  const hideOf = (p) => (HIDE_OK ? FRESH.presenceHide(PRESENCE, p.slug) : []);
  const hideArgs = (p) => { const h = hideOf(p); return h.length ? ['--hide', h.join(',')] : []; };
  // a stitch run with a list: its `hidden:` line → origin.json / eds.json `hidden`; ×0 / invalid selectors → one log line per side
  const stitchHidden = (p, side, s, hide) => {
    const h = hide.length ? hiddenText(s.out) : null; if (!h) return {};
    const miss = hiddenMisses(h); if (miss) log(`${side} ${p.slug} → ${miss}`);
    return { hidden: h };
  };
  if (PRES.note) log(PRES.note);
  if (PRES.notHonoured) log(PRES.notHonoured);
  const dir = (p) => join(opts.out, p.slug);
  const edsUrl = (p) => (opts.edsHost ? p.liveUrl.replace(/^https?:\/\/[^/]+/, opts.edsHost) : p.liveUrl);
  const hostOf = (p) => { try { return new URL(edsUrl(p)).origin; } catch { return null; } }; // this run's build origin
  // the row's `host`: the origin the EDS pixels came from — the capture record's url (eds.json), else this run's build URL
  const rowHost = (p, eds) => { try { if (eds && eds.url) return new URL(eds.url).origin; } catch { /* not a URL: this run's */ } return hostOf(p); };
  const results = {};
  const rec = (p, k, v) => { results[p.slug] = { ...(results[p.slug] || {}), [k]: v }; };
  const stitchArgs = (url, out, { inventory, hide = [], json } = {}) => [STITCH, url, out, '--width', String(opts.width), '--settle', '--json', json, '--locale', 'en-US', ...(opts.vh ? ['--vh', String(opts.vh)] : []), ...(opts.dismiss.length ? ['--dismiss', opts.dismiss.join(',')] : []), ...(hide.length ? ['--hide', hide.join(',')] : []), ...(inventory ? ['--inventory', inventory] : [])];
  // stitch-shot's --json capture record (<slug>/<side>-shot.json, deleted before each stitch) → the meta's overlayLeft /
  // fontsFailed (+ fontCheck when it says why); no readable record (an older stitch-shot) is unchecked — never a clean
  // capture — and a fontsFailed that is not an array (null: the font check could not run) is null, never "all loaded"
  const shotFile = (p, side) => join(dir(p), `${side}-shot.json`);
  const shotRecord = (p, side) => {
    const j = tryJson(shotFile(p, side));
    if (!j || typeof j !== 'object' || !('overlayLeft' in j)) return { overlayLeft: 'unchecked (stitch-shot wrote no --json record — re-copy stitch-shot.mjs)', fontsFailed: null };
    return { overlayLeft: j.overlayLeft || null, fontsFailed: Array.isArray(j.fontsFailed) ? j.fontsFailed : null, ...(typeof j.fontCheck === 'string' ? { fontCheck: j.fontCheck } : {}) };
  };
  const stitch = (p, side, url, out, extra = {}, tail = []) => { rmSync(shotFile(p, side), { force: true }); return run('node', [...stitchArgs(url, out, { ...extra, json: shotFile(p, side) }), ...tail]); };
  // a copied live.png carries live.json's record of the same check (the reuse deciders admit only overlayLeft: null);
  // fontsFailed null (the check could not run) stays null, an absent key stays absent
  const liveRecord = (lm) => ({ overlayLeft: lm.overlayLeft || null, ...('fontsFailed' in lm ? { fontsFailed: Array.isArray(lm.fontsFailed) ? lm.fontsFailed : null } : {}) });
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
    logNotKept(p, 'origin');
    // a fix round keeps this run's origin (originReusePlan); the capture time `at` is kept, the reuse added
    const prev = existsSync(out) && existsSync(meta) ? tryJson(meta) : null;
    const plan = keepOneLoad(originReusePlan({ stage: opts.stage, only: opts.only, recaptureEds: opts.recaptureEds, recaptureOrigin: opts.recaptureOrigin, url: p.url, width: opts.width, vh: opts.vh, hide, dismiss: opts.dismiss }, prev, prev && fresh(prev)), p, prev);
    if (plan.reuse) { keep({ ...prev, stale: undefined, ...reuseOf(out, prev, plan.why) }, `origin ${p.slug} → reused ${out} (captured ${prev.at}; ${plan.why})`); return; }
    if (prev && (opts.only || opts.recaptureEds) && opts.stage === 'published') log(`origin ${p.slug} → not reused (${plan.why})`);
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    const cachedLive = join('stardust/replica/gates', `${p.slug}-${opts.width}`, 'live.png');
    const lm = existsSync(cachedLive) ? tryJson(cachedLive.replace(/\.png$/, '.json')) : null;
    const lp = keepOneLoad(liveReusePlan({ stage: opts.stage, recaptureOrigin: opts.recaptureOrigin, url: p.url, width: opts.width, vh: opts.vh, hide, dismiss: opts.dismiss }, lm, lm && fresh(lm)), p, lm);
    if (opts.stage === 'published' && existsSync(cachedLive) && !lp.reuse) log(`origin ${p.slug} → live.png not reused (${lp.why})`);
    let r; let warn = null;
    // --one-load: the archetype round's live.png is headless bundled Chromium, not a one-load capture (both stages)
    if (OL && opts.stage === 'prototype' && existsSync(cachedLive)) log(`origin ${p.slug} → live.png not reused (one-load: not a headed real-Chrome capture)`);
    // the prototype stage takes the archetype round's live.png only when it hid the same list (live.json `hide`, absent = [])
    // and dismissed with the same --dismiss list (live.json `dismiss.extra`, absent = none), and live.json records the
    // overlay-left check with nothing left
    const protoLive = opts.stage === 'prototype' && existsSync(cachedLive) && !OL;
    const protoWhy = protoLive ? (!sameHide(lm && lm.hide, hide) ? 'live.json hide list differs' : !sameDismiss(lm && lm.dismiss && lm.dismiss.extra, opts.dismiss) ? 'live.json dismiss list differs' : overlayWhy(lm, 'live.png')) : null;
    if (protoLive && protoWhy) log(`origin ${p.slug} → live.png not reused (${protoWhy})`);
    if (protoLive && !protoWhy) {
      copyFileSync(cachedLive, out);
      const lat = { at: lm.at || statSync(cachedLive).mtime.toISOString() }; const f = fresh(lat);
      r = { instrument: 'stitch-live', note: `reused ${cachedLive} (the archetype round's capture — hit minimisation)`, ...reuseOf(cachedLive, lat, 'prototype-stage'), stale: f.fresh ? undefined : f.reason, ...liveRecord(lm), ...hideField(hide), ...dismissField(opts.dismiss) };
    }
    else if (lp.reuse) { copyFileSync(cachedLive, out); r = { instrument: 'stitch-live', url: p.url, width: opts.width, locale: 'en-US', headed: false, ...reuseOf(cachedLive, lm, lp.why), note: 'archetype round capture (gate.sh; bundled Chromium — the EDS side\'s tier in legacy mode)', ...liveRecord(lm), ...hideField(hide), ...dismissField(opts.dismiss) }; }
    else if (opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked) {
      if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `origin matches --blocked ${opts.blocked}; crawl screenshot used (lazy rails may be placeholders)` }; }
      else r = { instrument: 'none', error: `origin blocked and no crawl shot at ${crawlShot}` };
    } else {
      const t0 = new Date().toISOString();
      const s = await stitch(p, 'origin', p.url, out, { hide, ...(OL ? { inventory: inventorySpec(p, 'origin') } : {}) }, ['--headed']);
      if (s.code === 0) r = { instrument: 'stitch-live', url: p.url, width: opts.width, locale: 'en-US', vh: opts.vh || null, headed: true, log: s.out.trim().split('\n').slice(-2), ...shotRecord(p, 'origin'), ...(OL ? inventoryMeta(p, 'origin', t0) : {}), ...hideField(hide), ...dismissField(opts.dismiss), ...stitchHidden(p, 'origin', s, hide) };
      else if (existsSync(out) && existsSync(meta) && opts.recaptureOrigin) {
        // the previous origin stays in use: a recorded reuse (stale when it predates the run), never a silent one
        const kept = readJson(meta); const f = fresh(kept);
        warn = `re-shoot failed (exit ${s.code}: ${lastLine(s.err)}) — previous origin kept${sameHide(kept.hide, hide) && sameDismiss(kept.dismiss, opts.dismiss) ? '' : ' (taken with another dismiss/hide list: no verdict)'}`;
        // a kept origin from before the overlay-left check is unchecked, never clean (the row is INCONCLUSIVE); its font
        // record: an absent key reads [] (legacy), a null (or other non-array) stays null — never "all loaded"
        const checked = 'overlayLeft' in kept ? {} : { overlayLeft: 'unchecked (previous origin predates the overlay-left check)' };
        const fontRec = !('fontsFailed' in kept) ? { fontsFailed: [] } : Array.isArray(kept.fontsFailed) ? {} : { fontsFailed: null };
        r = { ...kept, ...checked, ...fontRec, ...reuseOf(out, kept, f.fresh ? f.policy : 'recapture-failed'), stale: f.fresh ? undefined : f.reason, note: warn };
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
    const warns = [warn, r.stale, r.overlayLeft ? `overlay left — ${r.overlayLeft}` : null].filter(Boolean);
    log(`origin ${p.slug} → ${r.instrument}${r.reused ? ` reused ${r.from} (captured ${r.at}; ${r.policy})` : ''}${warns.length ? ` WARN ${warns.join('; ')}` : ''}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  async function captureEds(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'eds.png'); const meta = join(d, 'eds.json');
    if (skipCapture(p, 'eds', capCtx)) { rec(p, 'eds', readJson(meta)); return; }
    logNotKept(p, 'eds');
    const t0 = new Date().toISOString(); const hide = hideOf(p);
    const s = await stitch(p, 'eds', edsUrl(p), out, { hide, ...(OL ? { inventory: inventorySpec(p, 'eds') } : {}) }, OL ? ['--headed'] : []);
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p), ...shotRecord(p, 'eds'), ...(OL ? { headed: true, ...inventoryMeta(p, 'eds', t0) } : {}), ...hideField(hide), ...dismissField(opts.dismiss), ...stitchHidden(p, 'eds', s, hide) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.overlayLeft ? ` WARN overlay left — ${r.overlayLeft}` : ''}${r.error ? ` ERROR ${r.error}` : ''}`);
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
    const coverage = Object.fromEntries(((covDoc || readSafe(DEFAULT_COVERAGE) || {}).pages || []).filter((x) => x && x.slug && Array.isArray(x.blocks)).map((x) => [x.slug, x.blocks]));
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
    hideChanged: (p, side) => { const m = readSafe(join(dir(p), `${side}.json`)); return !!m && m.instrument === 'stitch-live' && !sameHide(m.hide, hideOf(p)); },
    // and the --dismiss list (absent = none) — a crawl shot dismissed nothing either
    dismissChanged: (p, side) => { const m = readSafe(join(dir(p), `${side}.json`)); return !!m && m.instrument === 'stitch-live' && !sameDismiss(m.dismiss, opts.dismiss); },
    unchecked: (p, side) => legacyStitch(readSafe(join(dir(p), `${side}.json`))) };
  // --skip-existing would have kept the capture but for its hide list, its --dismiss list or a record from before the
  // overlay-left check (logged, then re-shot)
  const notKept = (p, side) => {
    if (!skipCapture(p, side, { ...capCtx, hideChanged: undefined, dismissChanged: undefined, unchecked: undefined })) return null;
    return capCtx.hideChanged(p, side) ? 'hide list differs' : capCtx.dismissChanged(p, side) ? 'dismiss list differs' : capCtx.unchecked(p, side) ? 'no overlay-left record' : null;
  };
  const logNotKept = (p, side) => { const why = notKept(p, side); if (why) log(`${side} ${p.slug} → not reused (--skip-existing: ${why})`); };
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
    const row = rowReuse({ prior: prior[p.slug], gateKey: currentKey(p), edsPng: existsSync(join(dir(p), 'eds.png')), override: OVERRIDES[p.slug] ?? null, register: REGISTER, opts, host: hostOf(p) });
    if (row) { REUSED[p.slug] = row; log(`row ${p.slug} → reused (gate key ${row.gateKey.slice(0, 12)} unchanged; measured ${row.reused.at}, ${row.reused.from})`); }
  }
  const todo = pages.filter((p) => !REUSED[p.slug]);
  if (!opts.compareOnly) {
    // one browser per machine slot: the two capture pools run one after the other, never side by side
    if (opts.pools.sequential) { await pool(todo, opts.oc, captureOrigin); await pool(todo, opts.ec, captureEds); }
    else await Promise.all([pool(todo, opts.oc, captureOrigin), pool(todo, opts.ec, captureEds)]);
    // gate-key.json = the key of the EDS capture taken in this run (null while unknown or when the capture failed).
    for (const p of todo) {
      const k = KEYS[p.slug]; const m = readSafe(join(dir(p), 'eds.json'));
      if (k && m && m.at >= startedAt) writeFileSync(join(dir(p), 'gate-key.json'), JSON.stringify({ gateKey: m.error ? null : k.gateKey, why: m.error ? `EDS capture failed: ${m.error}` : k.why, parts: k.parts, upstream: k.upstream, deployed: k.deployed, at: m.at }, null, 1));
    }
  } else {
    // --compare-only takes no capture: a stitched record from before the overlay-left check is read as unchecked (an
    // INCONCLUSIVE row), never clean; the record on disk and its fontsFailed stay as they are
    for (const p of todo) for (const side of ['origin', 'eds']) { const m = readJson(join(dir(p), `${side}.json`)); if (m) rec(p, side, legacyStitch(m) ? { ...m, overlayLeft: LEGACY_UNCHECKED } : m); }
  }
  if (opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length) await pool(todo, opts.pc, probe);
  await pool(todo, 4, compare);

  const rows = pages.map((p) => {
    if (REUSED[p.slug]) return REUSED[p.slug];
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip && r.clip.counts ? r.clip : null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0, capture: { polluted: capturePollution(r.origin, r.eds, { hide: hideOf(p), dismiss: opts.dismiss }), fonts: fontsNotLoaded(r.origin, r.eds), fontsSkipped: fontChecksSkipped(r.origin, r.eds) }, register: REGISTER }, { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content, stage: opts.stage });
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument, host: rowHost(p, r.eds),
      originReused: r.origin && r.origin.reused ? { from: r.origin.from, at: r.origin.at, policy: r.origin.policy, stale: r.origin.stale || null } : null,
      presenceReused: r.presenceReused || null, unitsReused: r.unitsReused || null, ...(opts.oneLoad ? { oneLoad: r.oneLoad || null } : {}), ...hideField(hideOf(p)),
      pct: px.pct ?? null, textPct: px.textPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      browser: (r.content && r.content.tier) || (r.clip && r.clip.tier) || null,
      override: v.override, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null,
      gateKey: opts.stage === 'published' ? rowKey(storedKey(p), KEYS[p.slug], !!r.probedAt) : null, reused: r.probesReused ? { what: 'probes', at: r.probesReused } : null };
  });
  // Fix rounds: an --only run counts each row with a verdict (countsAsRound) — rounds.json written before the run table, so
  // a crash over-counts, never under-counts; --round-reset first starts a new count for the selected pages at the cap.
  // Every row carries `round` (a full run: the current count, never counted); a reset row `roundReset`.
  const writtenAt = new Date().toISOString(); const roundLines = [];
  for (const row of rows) {
    const prev = ROUNDS[row.slug]; delete row.roundReset; // a reused row's own reset belongs to its own run
    if (!opts.only) { row.round = prev.rounds; continue; }
    const counted = countsAsRound(row);
    const next = nextRounds(prev, { at: writtenAt, max: opts.maxRounds, counted, reset: opts.roundReset && prev.rounds >= opts.maxRounds ? opts.roundReset : null });
    if (next.changed) writeJsonAtomic(join(opts.out, row.slug, 'rounds.json'), next.doc);
    row.round = next.round; if (next.roundReset) row.roundReset = next.roundReset;
    roundLines.push(`${row.slug} ${next.round}/${opts.maxRounds}${counted ? '' : ' (no verdict — not counted)'}${next.roundReset ? ' (after the reset)' : ''}`);
  }
  if (roundLines.length) log(`rounds @${opts.width}: ${roundLines.join(', ')}`);
  const n = (f) => rows.filter(f).length;
  // an INCONCLUSIVE row is neither a FAIL nor an error, and has no pixel / height verdict (null) to count; only a validated
  // override lifts a failing row (overridePass), an invalid one is counted as rejected
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && !!r.override && r.override.valid === true), overrideRejected: n((r) => !r.pass && !!r.override && r.override.valid !== true), overrideMagnitude: n((r) => !r.pass && exceedsMagnitude(r.override)), fail: n((r) => !r.inconclusive && !r.pass && r.pct != null), error: n((r) => !r.inconclusive && r.pct == null), inconclusive: n((r) => r.inconclusive),
    failPixel: n((r) => r.pct != null && r.pixelPass === false), failHeight: n((r) => r.pct != null && r.heightPass === false), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), fontsNotLoaded: n((r) => r.fontsNotLoaded && r.fontsNotLoaded.length > 0), fontChecksSkipped: n((r) => r.fontChecksSkipped && r.fontChecksSkipped.length > 0), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric), degradedTier: n((r) => r.browser && r.browser !== 'chrome'),
    reusedRows: n((r) => r.reused && r.reused.what === 'row'), reusedProbes: n((r) => r.reused && r.reused.what === 'probes') };
  totals.passWithOverrides = totals.pass + totals.overridePass;
  totals.overrideShare = totals.pages ? Number((totals.overridePass / totals.pages).toFixed(3)) : 0;
  totals.originReused = n((r) => r.originReused);
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt, stage: opts.stage, breakpoint: opts.width, threshold: opts.threshold, heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `overlap pixel % ≤ ${opts.threshold} AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, ...dismissField(opts.dismiss), only: opts.only, maxRounds: opts.maxRounds, reuse: { rows: totals.reusedRows, probes: totals.reusedProbes } }, totals, rows };
  const md = formatSummary(summary);
  if (opts.only) { mkdirSync(join(opts.out, 'runs'), { recursive: true }); const f = join(opts.out, 'runs', `${writtenAt.replace(/[:.]/g, '-')}-${opts.only[0]}.json`); writeFileSync(f, JSON.stringify(summary, null, 2)); console.log(md); console.log(`run → ${f}`); }
  else { writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2)); writeFileSync(join(opts.out, 'summary.md'), md); console.log(md.split('\n').slice(0, 7).join('\n')); console.log(`summary → ${join(opts.out, 'summary.md')}`); }
  console.log(JSON.stringify(totals));
  process.exitCode = totals.pass + totals.overridePass === totals.pages ? 0 : 2;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`gate-all error: ${e.message}`); process.exit(1); }).finally(releaseRounds);
}
