#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag, the reused cell); parseArgs
// defaults and --out derived from --width; --eds-host (edsOrigin table: a bare host or an origin URL, a path refused —
// the CLI exits 2 writing nothing; a sandbox run stitches https://<host><path> and records the origin); a value flag without
// its value (missing, or one that starts with "-": exit 2, the flag, the value and the usage line); --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff;
// an empty selection names its cause (emptySelection table, the CLI exits 1 writing nothing); the roster (selectPages /
// rosterEstimate table — its pool factor (estimateFactor; run-bg's browsersPerSlot from the env, STARDUST_BROWSER_SLOTS=0,
// an inherited slot, the argv's pool flags) —, the RUN_BG_DEADLINE_SEC deadline) and its source — the rollout coverage (coveragePages, beside a
// state, --coverage, a coverage-only project's CLI run, missing / malformed files), else the state. The build host: buildHost
// (--eds-host, coverage deployedUrl, state liveUrl, --proto-base), the first status line naming it for each roster, every
// row's `host` (a reused row keeps its own; a legacy one takes the current host its equal gate key proves), and no
// rollout.json moving the default (the coverage deployedUrl as recorded).
// Reuse under --skip-existing: probeReuse (the capture pair rule), the gate key (stable across key order, changed by
// one block / content / frozen-file byte or a mask edit, null on a freeze mismatch), the deploy-state guard's
// content half; then the CLI over stub instruments in a sandbox project with a git remote and a deploy ledger.
// Origin reuse (originReusePlan / liveReusePlan tables, --origin-max-age, the pool flags — integers >= 1 — and their clamp
// inside a machine browser slot: browserPools, per slot 1 → every origin capture before any EDS one, the estimate × 4 in
// the status line and the deadline guard) and a sandbox
// runner with stub instruments (no browser): fix rounds reuse this run's origin, a new run recaptures, every reuse
// is in the row, origin.json and _run.log. --one-load (C8): inventoryWhy / oneLoadKeep tables, then the sandbox with a
// stitch stub that writes a canned inventory: one stitch per side per page, no probe spawns, fix rounds 0 origin / 1 EDS,
// fallbacks (blocked origin, --warmup) logged, legacy unchanged, and content-presence / unit-geometry cache hits
// recorded in the row (presenceReused, unitsReused — fresh and replayed).
// presence.json `hide` (F6): the reuse deciders refuse another list (absent = []), probeInputs / gateKeyParts carry a
// non-empty list only; a sandbox whose stub instruments log their argv: "*" then the slug's list reaches both stitches,
// content-presence and clip-probe, records and rows carry it, fix rounds / live.png / --skip-existing reuse only the
// same list, no hides → no --hide and no hide field, a live-session.mjs without presenceHide → one log line. The site-wide
// stardust/replica/presence.json (E9): merged under the gate dir's (mergePresence) — a site "*".hide reaches both stitches and
// the probes with no gate dir file, the gate dir wins per field, a malformed site file is an error naming it, a
// live-session.mjs without mergePresence → one "not honoured" line. A hide that matched nothing on the live side (E14):
// hideMissOf / hideMissText; the hide sandbox's stitch stub writes the record's hideMiss (STUB_HIDE_MISS) — the WARNING line,
// origin.json / the row / totals.hideMiss / the summary.md line, a reused origin and --compare-only, live-session's
// hideMissLine or the same text built here, a copied live.png's live-shot.json; the verdict unchanged.
// --dismiss (like gate.sh / anchor.mjs): parseArgs (one comma list, the last wins, an empty list → exit 1, no value → exit 2), the reuse deciders,
// probeInputs / gateKeyParts / skipCapture; the hide sandbox: both stitch argv carry it before --hide, the probes do not
// (content-presence / clip-probe take no --dismiss), records / probes.json inputs / _provenance carry it, and a capture
// taken with another list is never reused (fix rounds, live.png on both stages, --skip-existing on both sides).
// Gate trust: capturePollution, an INCONCLUSIVE verdict / summary cell / head, rowReuse and the reuse deciders refusing a
// capture without the overlay-left check or with an overlay left; every stitch stub writes the --json capture record
// (SHOT_RECORD); a trust sandbox: an overlay left on either side, a crawl-fullpage fallback, no record, a failed
// --recapture-origin keeping an origin from before the check, or one taken with another dismiss/hide list (capturePollution
// with this run's lists) → INCONCLUSIVE, exit 2; a record from before the check
// (no overlayLeft key): skipCapture's `unchecked`, --skip-existing re-stitches it (logged), --compare-only → INCONCLUSIVE.
// Validated overrides: registerIds, checkOverride (kind, register entry, clip + content PASS — clip only on the prototype
// stage — a pixel measurement, not INCONCLUSIVE), the verdict / summary / rowReuse with a valid and an invalid override; the trust sandbox with
// one valid and three invalid overrides.json rows and a register file, then without the register. Override magnitude:
// pixel % ≤ 2 × threshold and |Δh| ≤ 2 × height-tol × origin height on the row's own numbers (inclusive; 2× + ε rejected,
// exactly 2× accepted, the height bar too, a reused row re-checked) — the unprefixed reason, override.magnitude,
// totals.overrideMagnitude and the summary.md line; the trust sandbox at 30 % (rejected) and at 20 % (lifted). Fonts: fontsNotLoaded,
// font-not-loaded:<family> reasons failing the row, the calibration line; the trust sandbox with STUB_FONTS_*. A font check
// that could not run (fontsFailed: null): fontChecksSkipped, font-check-skipped:<side> failing the row, null carried from
// the record, a live.json and a kept origin; the trust sandbox with STUB_FONTS_NULL_*.
// Fix rounds: countsAsRound (a verdict; a reused row's too), roundsOf (rounds.json, else the legacy runs/*.json seed),
// capRefusal (the cap line), nextRounds (count, reset, seed record); the trust sandbox with its own --out (rounds 1-7):
// three counted rounds, a 4th refused before any write (--max-rounds lowers the cap, a full run neither counts nor refuses),
// --max-rounds / --round-reset usage, a reset recorded (rounds.json + row), an INCONCLUSIVE crawl-fullpage row not counted,
// a live process's rounds.lock refused (age, recovery) and a dead one's reaped, a partial / young empty lock held, an old
// unreadable one reaped, the legacy seed. The other sandboxes clear the round
// state before each run (clearRounds) — their repeated --only runs are independent scenarios.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_ROUNDS, OVERRIDE_VERDICTS, REGISTER_FILE, browserPools, buildHost, capRefusal, capturePollution, checkOverride, codeDeployed, contentDeployed, countsAsRound, coveragePages, deployedDocs, edsHostOf, edsOrigin, emptySelection, estimateFactor, fontChecksSkipped, fontsNotLoaded, foundationPart, formatSummary, gateKeyOf, gateKeyParts, hideMissOf, hideMissText, hostServes, instrumentFiles, inventoryWhy, keyChanged, liveReusePlan, nextRounds, oneLoadKeep, originReusePlan, parseArgs, probeInputs, probeReuse, registerIds, rosterEstimate, roundsOf, rowKey, rowReuse, runTables, selectPages, sharedBlocks, skipCapture, verdict } from '../gate-all.mjs';

// pixel-compare imports pngjs at module level (a project devDependency, absent in the plugin checkout):
// import it lazily and skip its one check where it does not resolve, like the other browser/dep-bound tests.
let textBoxPct = null;
try { ({ textBoxPct } = await import('../pixel-compare.mjs')); } catch { console.log('skip  pixel-compare textBoxPct (pngjs not importable here)'); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-all.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const px = (pct, heightDelta, height = 10000) => ({ pct, heightDelta, compared: { width: 1440, height }, pass: pct <= 10 });
const clip = (total) => ({ counts: { total, textClipped: total, textHidden: 0, controlHidden: 0, controlClipped: 0 } });
const content = (missing, hidden, controlState = 0) => ({ totals: { missing, hidden, controlState } });
// stitch-shot's --json capture record, written by every stitch stub: overlayLeft = STUB_OVERLAY_<ORIGIN|EDS>, fontsFailed =
// STUB_FONTS_<ORIGIN|EDS> (a comma list), or null with a fontCheck note when STUB_FONTS_NULL_<ORIGIN|EDS> is set (the
// check could not run). `side` is an expression in the stub that evaluates to 'ORIGIN' or 'EDS'.
const SHOT_RECORD = (side) => `if (process.argv.includes('--json')) writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify({ overlayLeft: process.env['STUB_OVERLAY_' + ${side}] || null, ...(process.env['STUB_FONTS_NULL_' + ${side}] ? { fontsFailed: null, fontCheck: 'failed: stub font check' } : { fontsFailed: (process.env['STUB_FONTS_' + ${side}] || '').split(',').filter(Boolean) }) }));`;

check('the recorded card page: pixel PASS, elements FAIL — pixelOnlyPass true, pass false, both reasons named', () => {
  const v = verdict({ pixel: px(6.68, 69, 29326), clip: clip(379), content: content(0, 284, 2) });
  assert.equal(v.pixelOnlyPass, true); assert.equal(v.pass, false);
  assert.match(v.reasons.join('; '), /clipped 379/); assert.match(v.reasons.join('; '), /HIDDEN 284/); assert.match(v.reasons.join('; '), /2 control state/);
});
check('a clean page passes every criterion', () => {
  const v = verdict({ pixel: px(1.77, -1, 3415), clip: clip(0), content: content(0, 0) });
  assert.equal(v.pass, true); assert.deepEqual(v.reasons, []); assert.equal(v.originH, 3415); assert.equal(v.edsH, 3416);
});
check('height guard: pixel % inside the bar but 6900 px too tall fails (the rejected union metric case)', () => {
  const v = verdict({ pixel: px(4, -6900, 10000), clip: clip(0), content: content(0, 0) });
  assert.equal(v.pixelPass, true); assert.equal(v.heightPass, false); assert.equal(v.pixelOnlyPass, false); assert.match(v.reasons[0], /Δh -6900px > 5% of 10000/);
});
check('clip allowance: a documented allowance lifts the bar; clipMax option too', () => {
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(2), content: content(0, 0), allowance: 2 }).pass, true);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(3), content: content(0, 0), allowance: 2 }).pass, false);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(3), content: content(0, 0) }, { clipMax: 3 }).pass, true);
});
check('content n/a (origin not probed) never fails the page and is named in the row', () => {
  const v = verdict({ pixel: px(3, 0), clip: clip(0), content: { error: 'origin HTTP 403' } });
  assert.equal(v.pass, true); assert.equal(v.contentPass, null); assert.equal(v.contentNA, 'origin HTTP 403');
  const w = verdict({ pixel: px(3, 0), clip: clip(0), content: null });
  assert.equal(w.contentNA, 'not probed');
});
check('criteria switched off read null and cannot fail; --no-probes = the pixel-only verdict', () => {
  const v = verdict({ pixel: px(3, 0), clip: clip(99), content: content(9, 9) }, { clipOn: false, contentOn: false });
  assert.equal(v.pass, true); assert.equal(v.clipPass, null); assert.equal(v.contentPass, null);
});
check('units: required units fail the page, advisory ones do not', () => {
  const u = { verdict: { off: 3, hidden: 1, missing: 0, errors: 0 } };
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(0), content: content(0, 0), units: { ...u, required: true } }).pass, false);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(0), content: content(0, 0), units: { ...u, required: false } }).pass, true);
});
check('missing capture / pixel error → not compared, reasons say so; a free-text override shows beside, is rejected and never replaces the verdict', () => {
  const v = verdict({ pixel: { error: 'missing capture' }, override: { verdict: 'PASS (source capture)', reason: 'live drifted' } });
  assert.equal(v.pass, false); assert.equal(v.passWithOverride, false); assert.match(v.reasons[0], /missing capture/);
  assert.equal(v.override.valid, false); assert.equal(v.override.verdict, 'PASS (source capture)');
  assert.deepEqual(v.reasons.filter((x) => x.startsWith('override rejected: ')), v.override.rejected.map((x) => `override rejected: ${x}`));
});
// ---- overrides.json: an entry counts only when validated (kind, register entry, clip + content PASS) -------------------
const REG = 'stardust/replica/inconsistency-register.md';
const register = { file: REG, found: true, ids: ['R-01', 'R-12'] };
const KIND = 'is not tier-shift / instrument-artifact / source-volatile';
check('registerIds: the R-<nn> IDs that head a section of the register — sorted, unique; an ID in body text is not an entry', () => {
  assert.deepEqual(registerIds('# Inconsistency register\n## R-01 — a\ntext R-99\n### R-12 — b'), ['R-01', 'R-12']);
  assert.deepEqual(registerIds('## R-12 — b\r\n#### R-03: c\n## R-12 again\n##R-04 no space\n####### R-05 seven\n- R-06 a list item\n'), ['R-03', 'R-12']);
  assert.deepEqual(registerIds(''), []); assert.deepEqual([OVERRIDE_VERDICTS, REGISTER_FILE], [['tier-shift', 'instrument-artifact', 'source-volatile'], REG]);
});
check('checkOverride: a validated override (kind, register entry, clip + content PASS) is valid; each failing rule is one rejected line; the prototype stage needs clip only; an INCONCLUSIVE row has no verdict to override', () => {
  const ok = { inconclusive: false, compared: true, clipPass: true, contentPass: true, stage: 'published', register, pct: 15, heightDelta: 0, originH: 3000 };
  assert.equal(checkOverride(null, ok), null);
  assert.deepEqual(checkOverride({ verdict: 'tier-shift', reason: 'R-01: the source serves another tier at this width' }, ok), { verdict: 'tier-shift', reason: 'R-01: the source serves another tier at this width', valid: true });
  const no = (raw, ctx) => { const o = checkOverride(raw, { ...ok, ...ctx }); assert.equal(o.valid, false, JSON.stringify(raw)); return o.rejected; };
  assert.deepEqual(no({ verdict: 'PASS (source capture)', reason: 'R-01 live drifted' }), [`verdict "PASS (source capture)" ${KIND}`]);
  assert.deepEqual(no({ verdict: 'source-volatile', reason: 'R-09 rotating hero' }), [`R-09 not in ${REG}`]);
  assert.deepEqual(no({ verdict: 'source-volatile', reason: 'R-01 and R-09, R-12, R-77' }), [`R-09, R-77 not in ${REG}`]);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { clipPass: false }), ['clip and content must pass (clip FAIL, content PASS)']);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'live drifted since capture' }), [`reason names no R-<nn> of ${REG}`]);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { register: { file: REG, found: false, ids: [] } }), [`no inconsistency register at ${REG}`]);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { register: null }), [`no inconsistency register at ${REG}`], 'no register given');
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { contentPass: null }), ['clip and content must pass (clip PASS, content n/a)'], 'n/a is not PASS');
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { clipPass: null, contentPass: false }), ['clip and content must pass (clip n/a, content FAIL)']);
  assert.equal(checkOverride({ verdict: 'tier-shift', reason: 'R-01' }, { ...ok, stage: 'prototype', contentPass: null }).valid, true, 'the prototype stage has no content criterion');
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { stage: 'prototype', clipPass: null }), ['clip and content must pass (clip n/a, content not a criterion)']);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { inconclusive: true }), ['the row is INCONCLUSIVE — no verdict to override']);
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { compared: false }), ['no pixel measurement to override'], 'a missing capture or a pixel error');
  assert.deepEqual(no({ verdict: 'tier-shift', reason: 'R-01' }, { compared: undefined }), ['no pixel measurement to override'], 'not said: not compared');
  assert.deepEqual(no({ verdict: 'PASS', reason: 'looks fine' }, { clipPass: false, compared: false, inconclusive: true }), [`verdict "PASS" ${KIND}`, `reason names no R-<nn> of ${REG}`, 'clip and content must pass (clip FAIL, content PASS)', 'no pixel measurement to override', 'the row is INCONCLUSIVE — no verdict to override'], 'every rule, in order');
});
check('verdict: a row without a pixel measurement (a pixel error, a missing capture) has nothing to override — a well-formed override is rejected and the row is not delivered', () => {
  const reg = { file: REG, found: true, ids: ['R-03'] }; const ov = { verdict: 'tier-shift', reason: 'R-03: the source serves another tier' };
  const v = verdict({ pixel: { error: 'stitch exit 1: scroll stall' }, clip: clip(0), content: content(0, 0), override: ov, register: reg });
  assert.deepEqual([v.pass, v.passWithOverride, v.override.valid, v.override.rejected], [false, false, false, ['no pixel measurement to override']]);
  assert.deepEqual(v.reasons, ['pixel error: stitch exit 1: scroll stall', 'override rejected: no pixel measurement to override']);
  const m = verdict({ pixel: {}, clip: clip(0), content: content(0, 0), override: ov, register: reg });
  assert.deepEqual([m.passWithOverride, m.reasons], [false, ['missing capture', 'override rejected: no pixel measurement to override']]);
  assert.equal(verdict({ pixel: px(18, 0), clip: clip(0), content: content(0, 0), override: ov, register: reg }).passWithOverride, true, 'measured and failing: the override still lifts it');
});
check('verdict: a validated override lifts a font-not-loaded row — the override rules as written (kind, register entry, clip + content PASS, a pixel measurement)', () => {
  const v = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), register, override: { verdict: 'instrument-artifact', reason: 'R-12: the face is served from another host' }, capture: { polluted: [], fonts: ['Brand Sans'] } });
  assert.deepEqual([v.pass, v.passWithOverride, v.override.valid, v.fontsNotLoaded, v.reasons], [false, true, true, ['Brand Sans'], ['font-not-loaded:Brand Sans']]);
});
check('verdict: a FAIL row with an invalid override stays FAIL (passWithOverride false, one "override rejected:" reason per rule); a valid one lifts it beside the number; an INCONCLUSIVE row\'s override is rejected without reasons', () => {
  const failing = { pixel: px(15, 0), clip: clip(0), content: content(0, 0), register };
  const bad = verdict({ ...failing, override: { verdict: 'PASS (source capture)', reason: 'R-01' } });
  assert.deepEqual([bad.pass, bad.passWithOverride, bad.override.valid], [false, false, false]);
  assert.deepEqual(bad.reasons, ['pixel 15% > 10%', `override rejected: verdict "PASS (source capture)" ${KIND}`]);
  const good = verdict({ ...failing, override: { verdict: 'tier-shift', reason: 'R-01 another tier' } });
  assert.deepEqual([good.pass, good.passWithOverride, good.override.valid], [false, true, true]); assert.deepEqual(good.reasons, ['pixel 15% > 10%']);
  assert.equal(verdict({ ...failing, override: { verdict: 'tier-shift', reason: 'R-01' } }, { stage: 'prototype', contentOn: false }).passWithOverride, true, 'prototype: clip only');
  assert.equal(verdict({ ...failing, override: { verdict: 'tier-shift', reason: 'R-01' } }, { contentOn: false }).passWithOverride, false, '--no-content cannot validate a published override (content n/a)');
  const passing = verdict({ pixel: px(2, 0), clip: clip(0), content: content(0, 0), register, override: { verdict: 'PASS', reason: 'x' } });
  assert.deepEqual([passing.pass, passing.passWithOverride, passing.override.valid], [true, true, false]); assert.deepEqual(passing.reasons, [], 'a passing row names no override rule');
  const inc = verdict({ ...failing, override: { verdict: 'tier-shift', reason: 'R-01' }, capture: { polluted: ['origin capture polluted: overlay left — X'] } });
  assert.deepEqual(inc.reasons, ['origin capture polluted: overlay left — X']); assert.deepEqual(inc.override.rejected, ['the row is INCONCLUSIVE — no verdict to override']);
});
const MAG = 'override exceeds magnitude: use --hide / presence.json';
const tierShift = { verdict: 'tier-shift', reason: 'R-01: the source serves another tier' };
check('checkOverride magnitude: on the row\'s own numbers, pixel % ≤ 2 × threshold and |Δh| ≤ 2 × height-tol × origin height — both inclusive; 2× + ε → not valid with the exact line and the record\'s magnitude; a measured row without the numbers cannot be bounded; INCONCLUSIVE / not compared add no magnitude line', () => {
  const m = (ctx) => checkOverride(tierShift, { inconclusive: false, compared: true, clipPass: true, contentPass: true, register, threshold: 10, heightTol: 0.05, heightDelta: 0, originH: 3000, ...ctx });
  assert.deepEqual(m({ pct: 20 }), { ...tierShift, valid: true }, 'exactly 2 × the threshold is allowed');
  assert.deepEqual(m({ pct: 20.01 }), { ...tierShift, valid: false, rejected: [MAG], magnitude: { pct: 20.01, maxPct: 20, heightDelta: 0, maxHeightDelta: 300 } }, '2 × + ε');
  assert.equal(m({ pct: 5, heightDelta: -300 }).valid, true, '|Δh| exactly 2 × 5 % of 3000');
  for (const dh of [301, -301]) assert.deepEqual(m({ pct: 5, heightDelta: dh }).rejected, [MAG], `Δh ${dh} > 2 × 5 % of 3000`);
  assert.deepEqual(m({ pct: 45, heightDelta: 268, originH: 2400 }).magnitude, { pct: 45, maxPct: 20, heightDelta: 268, maxHeightDelta: 240 }, 'the recorded in-flow bar: both bounds exceeded');
  assert.deepEqual([m({ pct: 24, threshold: 12 }).valid, m({ pct: 24.5, threshold: 12 }).valid, m({ pct: 5, heightDelta: 600, heightTol: 0.1 }).valid], [true, false, true], 'the run\'s criteria');
  assert.deepEqual(m({ pct: 45, clipPass: false }).rejected, ['clip and content must pass (clip FAIL, content PASS)', MAG], 'beside the other rules');
  assert.deepEqual(m({ pct: 15, originH: null }).rejected, ['no measured pixel % / Δh / origin height to bound the override']);
  assert.deepEqual(m({ pct: 15, heightDelta: undefined }).rejected, ['no measured pixel % / Δh / origin height to bound the override']);
  assert.deepEqual(m({ pct: 45, inconclusive: true }).rejected, ['the row is INCONCLUSIVE — no verdict to override']);
  assert.deepEqual(m({ pct: null, compared: false }).rejected, ['no pixel measurement to override']);
});
check('verdict magnitude: a row past 2 × the bar stays FAIL — the exact line as its reason (no "override rejected:" prefix), the other rules prefixed beside it; 2 × exactly is lifted; the height bar likewise (origin height = compared + the excess)', () => {
  const at = (pixel, override = tierShift) => verdict({ pixel, clip: clip(0), content: content(0, 0), register, override });
  const v = at(px(45, 0, 3000));
  assert.deepEqual([v.pass, v.passWithOverride, v.override.valid, v.override.rejected, v.reasons], [false, false, false, [MAG], ['pixel 45% > 10%', MAG]]);
  assert.deepEqual([at(px(20, 0, 3000)).passWithOverride, at(px(20, 0, 3000)).reasons], [true, ['pixel 20% > 10%']]);
  const tall = at(px(5, 268, 2400)); // origin 2668 px: 268 > 266.8
  assert.deepEqual([tall.passWithOverride, tall.reasons], [false, ['Δh 268px > 5% of 2668', MAG]]);
  assert.equal(at(px(5, -300, 3000)).passWithOverride, true, '|Δh| 300 = 2 × 5 % of 3000');
  assert.deepEqual(at(px(45, 0), { verdict: 'PASS', reason: 'R-01' }).reasons, ['pixel 45% > 10%', `override rejected: verdict "PASS" ${KIND}`, MAG]);
  assert.deepEqual(at(px(2, 0)).reasons, [], 'a passing row names no override rule');
});
check('formatSummary: one line names the rows whose override exceeds the magnitude — only when there is one', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const r0 = { slug: 'a', path: '/a', pct: 45, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: false, pixelOnlyPass: false, reasons: ['pixel 45% > 10%', MAG], error: null, override: { ...tierShift, valid: false, rejected: [MAG] } };
  const totals = { pages: 3, pass: 0, pixelOnlyPass: 0, overridePass: 0, overrideRejected: 2, overrideMagnitude: 2, fail: 3, error: 0, failPixel: 3, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 };
  const md = formatSummary({ _provenance: pv, totals, rows: [r0, { ...r0, slug: 'b', path: '/b', override: null }, { ...r0, slug: 'c', path: '/en/c' }] });
  assert.match(md, /\n\nOverride exceeds magnitude \(fix the capture \/ hide list, not a deviation\): \/a, \/en\/c\n\| page \|/);
  assert.doesNotMatch(formatSummary({ _provenance: pv, totals: { ...totals, overrideMagnitude: 0 }, rows: [{ ...r0, override: { ...tierShift, valid: false, rejected: ['x'] } }] }), /Override exceeds magnitude/);
});
check('formatSummary: the override clause — counted / rejected and the override share — only when there is one; a rejected override is marked in the verdict cell', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const r0 = { slug: 'a', path: '/a', pct: 30, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: false, pixelOnlyPass: false, reasons: ['pixel 30% > 10%'], error: null };
  const rows = [{ ...r0, override: { verdict: 'tier-shift', reason: 'R-01 another tier', valid: true } }, { ...r0, slug: 'b', path: '/b', override: { verdict: 'PASS (source capture)', reason: 'drift', valid: false, rejected: ['x'] } }, { ...r0, slug: 'c', path: '/c', override: null }];
  const totals = { pages: 3, pass: 0, pixelOnlyPass: 0, overridePass: 1, overrideRejected: 1, passWithOverrides: 1, fail: 3, error: 0, failPixel: 3, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 };
  const md = formatSummary({ _provenance: pv, totals, rows });
  assert.match(md, /\*\*0 PASS \/ 3 FAIL \/ 0 error of 3\*\* · overrides: 1 counted \/ 1 rejected — override share 1 of 3 \(33\.3 %\)\n/);
  assert.match(md, /\| FAIL → tier-shift: R-01 another tier \|/); assert.match(md, /\| FAIL → PASS \(source capture\): drift \(rejected\) \|/);
  assert.doesNotMatch(formatSummary({ _provenance: pv, totals: { ...totals, overridePass: 0, overrideRejected: 0 }, rows: [rows[2]] }), /overrides:/);
});
// ---- fonts: a declared face that did not load on either side fails the row ----------------------------------------------
check('fontsNotLoaded: the capture records\' fontsFailed of both sides — sorted, unique; a meta without one (legacy, crawl shot, failed) adds none', () => {
  assert.deepEqual(fontsNotLoaded({ fontsFailed: ['B', 'A'] }, { fontsFailed: ['A'] }), ['A', 'B']);
  assert.deepEqual(fontsNotLoaded({ instrument: 'crawl-fullpage' }, { fontsFailed: ['Brand Sans'] }), ['Brand Sans']);
  assert.deepEqual(fontsNotLoaded(null, { fontsFailed: 'Brand Sans' }), []);
});
check('verdict: a face that did not load fails an otherwise passing row — one font-not-loaded:<family> reason each, the pixel-only calibration verdict unchanged; on an INCONCLUSIVE row the font reasons follow the pollution; an override rule follows them', () => {
  const v = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: [], fonts: ['Brand Sans'] } });
  assert.deepEqual([v.pass, v.pixelOnlyPass, v.passWithOverride, v.fontsNotLoaded, v.reasons], [false, true, false, ['Brand Sans'], ['font-not-loaded:Brand Sans']]);
  const inc = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: ['build capture polluted: overlay left — X'], fonts: ['A', 'B'] } });
  assert.deepEqual(inc.reasons, ['build capture polluted: overlay left — X', 'font-not-loaded:A', 'font-not-loaded:B']); assert.equal(inc.inconclusive, true);
  const ov = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), register, override: { verdict: 'PASS', reason: 'R-01' }, capture: { polluted: [], fonts: ['A'] } });
  assert.deepEqual(ov.reasons, ['font-not-loaded:A', `override rejected: verdict "PASS" ${KIND}`]);
  assert.deepEqual(verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) }).fontsNotLoaded, [], 'no capture input: none');
});
check('formatSummary: the calibration line names the faces that did not load — the row count, then the sorted unique families of every row — only when a row has one', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const r0 = { slug: 'a', path: '/a', pct: 1.5, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: false, pixelOnlyPass: true, fontsNotLoaded: ['Brand Sans'], reasons: ['font-not-loaded:Brand Sans'], override: null, error: null };
  const totals = { pages: 1, pass: 0, pixelOnlyPass: 1, overridePass: 0, fail: 1, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, fontsNotLoaded: 1 };
  assert.match(formatSummary({ _provenance: pv, totals, rows: [r0] }), /Failing by criterion: pixel 0, height 0, clip 0, content 0, fonts not loaded 1 \(Brand Sans\); content n\/a/);
  const r1 = { ...r0, slug: 'b', path: '/b', fontsNotLoaded: ['Brand Serif', 'Brand Sans'] };
  assert.match(formatSummary({ _provenance: pv, totals: { ...totals, pages: 3, fontsNotLoaded: 2 }, rows: [r1, { ...r0, slug: 'c', path: '/c', fontsNotLoaded: [] }, r0] }), /, fonts not loaded 2 \(Brand Sans, Brand Serif\); content n\/a/);
  assert.doesNotMatch(formatSummary({ _provenance: pv, totals: { ...totals, fontsNotLoaded: 0 }, rows: [{ ...r0, fontsNotLoaded: [] }] }), /fonts not loaded/);
});
// ---- a font check that could not run (record fontsFailed: null) fails the row too ---------------------------------------
check('fontChecksSkipped: the sides (origin, build) whose stitch-live record says fontsFailed: null — explicit null only; [] or an absent key (a legacy meta) or another instrument adds none', () => {
  const live = (fontsFailed) => ({ instrument: 'stitch-live', overlayLeft: null, fontsFailed });
  assert.deepEqual(fontChecksSkipped(live(null), live([])), ['origin']);
  assert.deepEqual(fontChecksSkipped(live(['A']), live(null)), ['build']);
  assert.deepEqual(fontChecksSkipped(live(null), live(null)), ['origin', 'build']);
  assert.deepEqual(fontChecksSkipped({ instrument: 'stitch-live', overlayLeft: null }, live([])), [], 'absent key: the legacy reading');
  assert.deepEqual(fontChecksSkipped({ instrument: 'crawl-fullpage', asymmetric: true, fontsFailed: null }, null), []);
  assert.deepEqual(fontsNotLoaded(live(null), live(['A'])), ['A'], 'null is not a family list');
});
check('verdict: a skipped font check fails an otherwise passing row — one font-check-skipped:<side> reason each, after any font-not-loaded reason; on an INCONCLUSIVE row it joins the reasons; the row carries fontChecksSkipped', () => {
  const v = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: [], fonts: [], fontsSkipped: ['build'] } });
  assert.deepEqual([v.pass, v.pixelOnlyPass, v.passWithOverride, v.fontChecksSkipped, v.fontsNotLoaded, v.reasons], [false, true, false, ['build'], [], ['font-check-skipped:build']]);
  const both = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), register, override: { verdict: 'PASS', reason: 'R-01' }, capture: { polluted: [], fonts: ['A'], fontsSkipped: ['origin'] } });
  assert.deepEqual(both.reasons, ['font-not-loaded:A', 'font-check-skipped:origin', `override rejected: verdict "PASS" ${KIND}`]);
  const inc = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: ['origin capture polluted: overlay left — X'], fonts: [], fontsSkipped: ['origin', 'build'] } });
  assert.deepEqual(inc.reasons, ['origin capture polluted: overlay left — X', 'font-check-skipped:origin', 'font-check-skipped:build']); assert.equal(inc.inconclusive, true);
  assert.deepEqual(verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: [], fonts: [] } }).fontChecksSkipped, [], 'no fontsSkipped input: none');
});
check('formatSummary: the calibration line adds "font check skipped <n>" only when a row has one', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const r0 = { slug: 'a', path: '/a', pct: 1.5, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: false, pixelOnlyPass: true, fontsNotLoaded: [], fontChecksSkipped: ['build'], reasons: ['font-check-skipped:build'], override: null, error: null };
  const totals = { pages: 1, pass: 0, pixelOnlyPass: 1, overridePass: 0, fail: 1, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, fontsNotLoaded: 0, fontChecksSkipped: 1 };
  assert.match(formatSummary({ _provenance: pv, totals, rows: [r0] }), /Failing by criterion: pixel 0, height 0, clip 0, content 0, font check skipped 1; content n\/a/);
  assert.doesNotMatch(formatSummary({ _provenance: pv, totals: { ...totals, fontChecksSkipped: 0 }, rows: [{ ...r0, fontChecksSkipped: [] }] }), /font check skipped/);
});
// ---- a polluted capture: no pixel verdict — the row is INCONCLUSIVE ---------------------------------------------------
check('capturePollution: a crawl-fullpage origin, an overlay left on either side → one reason per side; a legacy meta without overlayLeft, a failed or missing capture → none', () => {
  const stitched = { instrument: 'stitch-live', overlayLeft: null, fontsFailed: [] };
  assert.deepEqual(capturePollution({ instrument: 'crawl-fullpage', asymmetric: true, note: 'stitch exit 1: boom — crawl screenshot used' }, stitched), ['origin capture polluted: crawl-fullpage fallback — stitch exit 1: boom — crawl screenshot used']);
  assert.deepEqual(capturePollution({ instrument: 'crawl-fullpage', asymmetric: true }, stitched), ['origin capture polluted: crawl-fullpage fallback'], 'no note → no dash');
  assert.deepEqual(capturePollution({ ...stitched, overlayLeft: 'X' }, stitched), ['origin capture polluted: overlay left — X']);
  assert.deepEqual(capturePollution(stitched, { ...stitched, overlayLeft: 'div.modal (fixed, 92 % of the viewport)' }), ['build capture polluted: overlay left — div.modal (fixed, 92 % of the viewport)']);
  assert.deepEqual(capturePollution({ ...stitched, overlayLeft: 'X' }, { ...stitched, overlayLeft: 'Y' }), ['origin capture polluted: overlay left — X', 'build capture polluted: overlay left — Y']);
  assert.deepEqual(capturePollution({ instrument: 'stitch-live', url: 'https://o.test/' }, { instrument: 'stitch-live' }), [], 'legacy metas: the reuse deciders refuse them, they are not judged here');
  assert.deepEqual(capturePollution({ instrument: 'none', error: 'stitch exit 1' }, { instrument: 'stitch-live', error: 'x', overlayLeft: 'X' }), [], 'a failed capture is an error row');
  assert.deepEqual(capturePollution(null, undefined), []);
});
check('capturePollution with this run\'s lists: a stitched capture taken with another hide or --dismiss list (absent = none) → "kept <side> taken with another dismiss/hide list"; the same lists, a crawl shot or a failed capture → none; without lists → not judged', () => {
  const KEPT = 'origin capture polluted: kept origin taken with another dismiss/hide list';
  const at = (hide, dismiss) => ({ instrument: 'stitch-live', overlayLeft: null, ...(hide ? { hide } : {}), ...(dismiss ? { dismiss } : {}) });
  const run = (hide = [], dismiss = []) => ({ hide, dismiss });
  assert.deepEqual(capturePollution(at(), at(null, ['.x']), run([], ['.x'])), [KEPT], 'the origin kept without the --dismiss list');
  assert.deepEqual(capturePollution(at(['.bar']), at(), run()), [KEPT], 'the origin kept with a hide list this run has not');
  assert.deepEqual(capturePollution(at(['.bar', '.x']), at(['.x', '.bar']), run(['.x', '.bar'])), [KEPT], 'another order is another list');
  assert.deepEqual(capturePollution(at(['.bar'], ['.x']), at(['.bar'], ['.x']), run(['.bar'], ['.x'])), [], 'the same lists');
  assert.deepEqual(capturePollution(at(), at(['.bar']), run()), ['build capture polluted: kept build taken with another dismiss/hide list'], '--compare-only: a build record taken with another list');
  assert.deepEqual(capturePollution({ instrument: 'crawl-fullpage', asymmetric: true }, { instrument: 'none', error: 'x', hide: ['.bar'] }, run(['.y'])), ['origin capture polluted: crawl-fullpage fallback'], 'a crawl shot hides nothing; a failed capture is an error row');
  assert.deepEqual(capturePollution(at(['.bar']), at(), null), [], 'no lists given: not judged (the pure two-argument form)');
});
check('verdict: a polluted capture → INCONCLUSIVE — pixel / height null, never PASS, no override lifts it, its reasons are the pollution', () => {
  const polluted = ['origin capture polluted: overlay left — #onetrust-banner-sdk (consent root visible)'];
  const v = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), override: { verdict: 'tier-shift', reason: 'R-01 recorded' }, capture: { polluted, fonts: [] } });
  assert.equal(v.inconclusive, true); assert.equal(v.pixelPass, null); assert.equal(v.heightPass, null); assert.equal(v.pixelOnlyPass, false);
  assert.equal(v.pass, false); assert.equal(v.passWithOverride, false); assert.deepEqual(v.reasons, polluted);
  assert.deepEqual(verdict({ pixel: px(40, 900), clip: clip(0), content: content(0, 0), capture: { polluted } }).reasons, polluted, 'no pixel / height failure named either');
  const clean = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { polluted: [], fonts: [] } });
  assert.equal(clean.inconclusive, false); assert.equal(clean.pass, true); assert.equal(clean.pixelPass, true);
  assert.equal(verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) }).inconclusive, false, 'no capture input: as before');
});
check('formatSummary: an INCONCLUSIVE row — its verdict cell, "/ <n> INCONCLUSIVE" in the head only when there is one', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const ok = { slug: 'b', path: '/b', origin: 'stitch-live', pct: 1.5, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: true, pixelOnlyPass: true, inconclusive: false, reasons: [], override: null, error: null };
  const bad = { ...ok, slug: 'a', path: '/a', pass: false, pixelOnlyPass: false, pixelPass: null, heightPass: null, inconclusive: true, reasons: ['origin capture polluted: overlay left — X'] };
  const totals = { pages: 2, pass: 1, pixelOnlyPass: 1, overridePass: 0, fail: 0, error: 0, inconclusive: 1, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 };
  const md = formatSummary({ _provenance: pv, totals, rows: [bad, ok] });
  assert.match(md, /\*\*1 PASS \/ 0 FAIL \/ 0 error \/ 1 INCONCLUSIVE of 2\*\*/); assert.match(md, /\| `\/a` \|.*\| INCONCLUSIVE \| origin capture polluted: overlay left — X \|/);
  const plain = formatSummary({ _provenance: pv, totals: { ...totals, pages: 1, inconclusive: 0 }, rows: [ok] });
  assert.match(plain, /\*\*1 PASS \/ 0 FAIL \/ 0 error of 1\*\*/); assert.doesNotMatch(plain, /INCONCLUSIVE/);
});
check('formatSummary: header, calibration line, rows, asymmetric flag, override text', () => {
  const rows = [
    { slug: 'a', path: '/a', template: 't', tier: 'thin', origin: 'stitch-live', pct: 6.68, textPct: 12.3, heightDelta: 69, clipped: 379, clipAllowance: 0, content: { missing: 0, hidden: 284, controlState: 2 }, units: { off: 12, hidden: 2, missing: 4 }, unitsRequired: true, pass: false, pixelOnlyPass: true, reasons: ['clipped 379', 'content MISSING 0 / HIDDEN 284'], masked: false, override: null, error: null },
    { slug: 'b', path: '/b', template: 't', tier: 'thin', origin: 'crawl-fullpage', pct: 3, textPct: null, heightDelta: 0, clipped: 0, clipAllowance: 0, content: null, contentNA: 'origin HTTP 403', units: null, pass: true, pixelOnlyPass: true, reasons: [], masked: true, maskedRows: 70, maskReason: 'store notice', override: null, error: null },
    { slug: 'c', path: '/', template: 'home', tier: 'archetype', origin: 'stitch-live', pct: 37, heightDelta: 3, clipped: 0, clipAllowance: 0, content: { missing: 0, hidden: 0, controlState: 0 }, units: null, pass: false, pixelOnlyPass: false, reasons: ['pixel 37% > 10%'], masked: false, override: { verdict: 'PASS (source capture)', reason: 'live drifted since capture; 9.14% vs the gated capture' }, error: null },
  ];
  const totals = { pages: 3, pass: 1, pixelOnlyPass: 2, overridePass: 1, passWithOverrides: 2, fail: 2, error: 0, failPixel: 1, failHeight: 0, failClip: 1, failContent: 1, failUnits: 1, contentNA: 1 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals, rows });
  assert.match(md, /\*\*1 PASS \/ 2 FAIL \/ 0 error of 3\*\*/); assert.match(md, /pixel-only verdict \(criteria 1\+2\): \*\*2 PASS\*\*; full verdict \(1–4\): \*\*1 PASS\*\*/);
  assert.match(md, /\| `\/a` \|.*FAIL \(elements\)/); assert.match(md, /6\.68 \(12\.3\)/); assert.match(md, /crawl-fullpage ⚠asym/); assert.match(md, /n\/a \(origin HTTP 403\)/); assert.match(md, /masked 70 rows: store notice/); assert.match(md, /→ PASS \(source capture\): live drifted/);
  assert.match(md, /off 12 hidden 2 missing 4 \|/);
});
check('parseArgs: defaults, --out derived from --width, --no-probes drops both probe criteria', () => {
  const o = parseArgs(['node', 'x']);
  assert.equal(o.out, 'stardust/replica/gates/all-1440'); assert.equal(o.threshold, 10); assert.equal(o.heightTol, 0.05); assert.equal(o.clipMax, 0); assert.equal(o.clip, true);
  const p = parseArgs(['node', 'x', '--width', '360', '--no-probes', '--only', 'a,b', '--eds-host', 'https://fix-x--r--o.aem.live/']);
  assert.equal(p.out, 'stardust/replica/gates/all-360');
  const q = parseArgs(['node', 'x', '--stage', 'prototype', '--proto-base', 'http://localhost:8791/']);
  assert.equal(q.out, 'stardust/replica/gates/prototypes-1440'); assert.equal(q.content, false, 'no content-presence at the prototype stage'); assert.equal(q.clip, true); assert.equal(q.protoBase, 'http://localhost:8791'); assert.equal(p.clip, false); assert.equal(p.content, false); assert.deepEqual(p.only, ['a', 'b']); assert.equal(p.edsHost, 'https://fix-x--r--o.aem.live');
});
const EDS_ERR = (v) => `--eds-host takes a host or an origin URL (https://<host>), not a path — got ${v}`;
check('edsOrigin / --eds-host: a bare host gets https://, an origin URL is normalised (trailing /, case, a non-default port kept); a path, query, hash or another scheme is refused — the CLI exits 2 before any I/O: the error line, then the usage line', () => {
  for (const [v, origin] of [['main--site--org.aem.page', 'https://main--site--org.aem.page'], ['https://main--site--org.aem.page/', 'https://main--site--org.aem.page'], ['http://localhost:3000', 'http://localhost:3000'],
    [' Main--Site--Org.aem.page ', 'https://main--site--org.aem.page'], ['h.test:8443/', 'https://h.test:8443'], ['https://h.test:443', 'https://h.test']]) assert.deepEqual(edsOrigin(v), { origin }, v);
  for (const v of ['main--site--org.aem.page/en/x', 'https://h.test/x?y', 'https://h.test/?y', 'https://h.test/#top', 'ftp://h.test', '']) assert.deepEqual(edsOrigin(v), { error: EDS_ERR(v) }, v);
  assert.equal(parseArgs(['node', 'x', '--eds-host', 'fix-x--r--o.aem.live']).edsHost, 'https://fix-x--r--o.aem.live', 'host-only form');
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-edshost-'))); mkdirSync(join(cwd, 'stardust'));
  writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify({ pages: [{ slug: 'a', url: 'https://o.test/a', liveUrl: 'https://main--site--org.aem.page/a', status: 'deployed' }] }));
  const before = readdirSync(cwd, { recursive: true }).sort();
  const r = spawnSync(process.execPath, [SCRIPT, '--eds-host', 'main--site--org.aem.page/en/x'], { cwd, encoding: 'utf8', env: { ...process.env, RUN_BG_DEADLINE_SEC: '' } });
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stdout, '');
  assert.deepEqual(r.stderr.trim().split('\n'), [`gate-all: ${EDS_ERR('main--site--org.aem.page/en/x')}`, 'Usage: node gate-all.mjs [options]   (from the project root)']);
  assert.deepEqual(readdirSync(cwd, { recursive: true }).sort(), before); rmSync(cwd, { recursive: true, force: true });
});
check('a value flag never takes a missing value or one that starts with "-": --eds-host --only home, --out / --coverage / --state / --round-reset / --width / --dismiss / --max-rounds / --threshold — one line naming the flag and the value (got nothing at the end), then the usage line; exit 2, before any I/O', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-values-'))); mkdirSync(join(cwd, 'stardust'));
  writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify({ pages: [{ slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--site--org.aem.page/', status: 'deployed' }] }));
  const before = readdirSync(cwd, { recursive: true }).sort();
  for (const [argv, line] of [
    [['--eds-host', '--only', 'home'], 'gate-all: --eds-host needs a value, got "--only"'],
    [['--only', 'home', '--out'], 'gate-all: --out needs a value, got nothing'],
    [['--coverage', '--state', 'stardust/state.json'], 'gate-all: --coverage needs a value, got "--state"'],
    [['--state', '-x'], 'gate-all: --state needs a value, got "-x"'],
    [['--only', 'home', '--round-reset', '--max-rounds', '2'], 'gate-all: --round-reset needs a value, got "--max-rounds"'],
    [['--width', '--only', 'home'], 'gate-all: --width needs a value, got "--only"'],
    [['--dismiss', '-q'], 'gate-all: --dismiss needs a value, got "-q"'],
    [['--max-rounds', '-1'], 'gate-all: --max-rounds needs a value, got "-1"'],
    [['--threshold', '-5'], 'gate-all: --threshold needs a value, got "-5"'],
  ]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd, encoding: 'utf8', env: { ...process.env, RUN_BG_DEADLINE_SEC: '' } });
    assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stderr}${r.stdout}`); assert.equal(r.stdout, '', argv.join(' '));
    assert.deepEqual(r.stderr.trim().split('\n'), [line, 'Usage: node gate-all.mjs [options]   (from the project root)'], argv.join(' '));
  }
  assert.deepEqual(readdirSync(cwd, { recursive: true }).sort(), before); rmSync(cwd, { recursive: true, force: true });
});
check('formatSummary: the reused cell per row and the head clause only when something was reused', () => {
  const base = { slug: 'a', path: '/a', pct: 2, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: true, pixelOnlyPass: true, reasons: [] };
  const totals = { pages: 2, pass: 2, pixelOnlyPass: 2, overridePass: 0, fail: 0, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 };
  const rows = [{ ...base, reused: { what: 'row', from: 'summary.json', at: '2026-01-01T00:00:00.000Z', gateKey: 'k' } }, { ...base, slug: 'b', path: '/b', reused: { what: 'probes', at: '2026-01-02T00:00:00.000Z' } }];
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, reusedRows: 1, reusedProbes: 1 }, rows });
  assert.match(md, /\*\*2 PASS \/ 0 FAIL \/ 0 error of 2\*\* · reused: 1 rows, 1 probe sets/); assert.match(md, /\| reasons \| reused \|/);
  assert.match(md, /\| `\/a` \|.*\| row 2026-01-01T00:00:00\.000Z \|$/m); assert.match(md, /\| `\/b` \|.*\| probes 2026-01-02T00:00:00\.000Z \|$/m);
  const plain = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, reusedRows: 0, reusedProbes: 0 }, rows: [{ ...base, reused: null }] });
  assert.doesNotMatch(plain, /reused:/); assert.match(plain, /\| - \|$/m);
});

// ---- reuse under --skip-existing: probes while the capture pair holds, PASS rows while the gate key holds
const T = (m) => `2026-01-01T00:${String(m).padStart(2, '0')}:00.000Z`;
const inputs0 = () => ({ origin: 'https://o.test/', eds: 'https://e.test/', width: 1440, warmup: null, stage: 'published', content: true, clip: true, presence: { variable: ['.rail'] }, units: [], unitTol: 4 });
const reuseArgs = (over = {}) => ({ sidecar: { at: T(5), inputs: inputs0(), results: { content: 'ok', clip: 'ok', units: null }, ats: { content: T(4), clip: T(4), units: null } }, inputs: inputs0(), originMeta: { at: T(1) }, edsMeta: { at: T(2) }, files: { content: { _provenance: { at: T(4) } }, clip: { at: T(4) } }, opts: { skip: true }, ...over });
check('probeReuse: replays only while both captures are the ones the probes were taken against, same inputs, every probe ok', () => {
  assert.deepEqual(probeReuse(reuseArgs()), { reuse: true, at: T(5), why: null });
  const reordered = reuseArgs(); reordered.sidecar.inputs = Object.fromEntries(Object.entries(inputs0()).reverse());
  assert.equal(probeReuse(reordered).reuse, true, 'key order of the recorded inputs is irrelevant');
  assert.equal(probeReuse(reuseArgs({ edsMeta: { at: T(6) } })).reuse, false, 'EDS re-shot after the probes');
  assert.equal(probeReuse(reuseArgs({ originMeta: { at: T(1), error: 'stitch exit 1' } })).reuse, false, 'a failed capture');
  assert.match(probeReuse(reuseArgs({ opts: { skip: true, recaptureEds: true } })).why, /--recapture-eds/);
  assert.match(probeReuse(reuseArgs({ opts: { skip: true, recaptureOrigin: true } })).why, /--recapture-origin/, 'content loads the origin');
  assert.match(probeReuse(reuseArgs({ inputs: { ...inputs0(), presence: { variable: ['.rail', '.reviews'] } } })).why, /inputs changed/, 'presence.variable edited');
  const errored = reuseArgs(); errored.sidecar.results.content = 'error';
  assert.match(probeReuse(errored).why, /content/, 'a kind that errored re-runs');
  const replaced = reuseArgs(); replaced.files.content = { _provenance: { at: T(9) } };
  assert.equal(probeReuse(replaced).reuse, false, 'content.json is not the recorded one');
  assert.match(probeReuse(reuseArgs({ opts: { skip: false } })).why, /--skip-existing/);
  assert.equal(probeReuse(reuseArgs({ sidecar: null })).reuse, false, 'a legacy dir without probes.json');
});
check('probeReuse: a reused origin (its first capture time kept) replays only when it is the capture the probes recorded in pair', () => {
  const paired = (pair, originMeta) => { const a = reuseArgs({ originMeta }); a.sidecar.pair = pair; return probeReuse(a); };
  const kept = { at: T(1), reused: true, from: 'g/home/origin.png', policy: 'skip-existing' };
  assert.equal(paired({ origin: T(1), eds: T(2) }, kept).reuse, true, '--skip-existing keeps the origin the probes were taken against');
  assert.equal(paired({ origin: T(1), eds: T(2) }, { at: T(1) }).reuse, true, 'a plain capture keeps the time-order rule');
  const copied = { at: T(0), reused: true, from: 'gates/home-1440/live.png', policy: 'same-run' };
  assert.match(paired({ origin: T(1), eds: T(2) }, copied).why, /origin is a reused capture the probes were not taken against/, 'live.png copied in after the probes, older than them');
  assert.equal(paired(undefined, kept).reuse, false, 'probes.json without a recorded pair: a reused origin cannot be proven');
});
check('gateKeyOf / gateKeyParts: stable across key order; one block CSS byte, content byte, frozen-file hash or mask edit changes it; a freeze mismatch → null', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-all-key-'));
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  put('styles/styles.css', 'body{}'); put('blocks/cards/cards.css', '.cards{}'); put('blocks/cards/cards.js', 'export default 1;');
  put('content/index.html', '<main><div><div class="cards one"></div></div></main>'); put('content/nav.html', '<nav></nav>');
  const opts = parseArgs(['node', 'x']); const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' };
  const parts = (ctx = {}) => gateKeyParts(page, { root, opts, ...ctx });
  const key = (ctx) => gateKeyOf(parts(ctx).parts);
  const k0 = key();
  assert.match(k0, /^[0-9a-f]{64}$/); assert.equal(key(), k0);
  assert.deepEqual(Object.keys(parts().parts.content), ['content/index.html', 'content/nav.html']); assert.deepEqual(Object.keys(parts().parts.blocks), ['cards']);
  const shuffled = Object.fromEntries(Object.entries(parts().parts).reverse().map(([k, v]) => [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse()) : v]));
  assert.equal(gateKeyOf(shuffled), k0, 'key order');
  put('blocks/cards/cards.css', '.cards{ }'); assert.notEqual(key(), k0, 'one CSS byte'); put('blocks/cards/cards.css', '.cards{}'); assert.equal(key(), k0);
  put('content/index.html', '<main><div><div class="cards one"></div></div> </main>'); assert.notEqual(key(), k0, 'one content byte'); put('content/index.html', '<main><div><div class="cards one"></div></div></main>');
  assert.notEqual(key({ masks: { home: { masks: ['0-80'], reason: 'banner' } } }), k0, 'a mask edit');
  assert.notEqual(key({ opts: { ...opts, threshold: 12 } }), k0, 'a criterion'); assert.notEqual(key({ opts: { ...opts, clip: false, content: false } }), k0, '--no-probes');
  assert.notEqual(key({ instruments: 'other' }), k0, 'another verdict or probe version');
  const freeze = () => assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'foundation-freeze.mjs'), 'freeze'], { cwd: root }).status, 0);
  freeze(); const kf = key();
  put('styles/styles.css', 'body{ }'); freeze(); assert.notEqual(key(), kf, 'a frozen file hash in the manifest');
  assert.deepEqual(gateKeyParts({ ...page, liveUrl: 'https://main--s--o.aem.page/missing/' }, { root, opts }), { parts: null, why: 'no content/missing/index.html' });
  const frozen = parts().parts.foundation; put('styles/styles.css', 'body{  }');
  assert.equal(parts().why, 'foundation changed since freeze', 'no key'); assert.notEqual(parts().parts.foundation, frozen, 'the parts still say what moved');
  put('styles/styles.css', 'body{ }'); assert.equal(parts().parts.foundation, frozen, 'the snapshot hash equals the manifest\'s while check passes');
  for (const f of ['content/fr/nav.html', 'content/de/footer-alt.html', 'content/fr/fragments/promo.html', 'content/fragments/deep/x.html']) {
    const k1 = key(); put(f, '<p>chrome</p>'); assert.notEqual(key(), k1, `${f} is in every key`); assert.match(parts().why || '', /^$/);
  }
  put('content/fr/about.html', '<p>another page</p>'); const k2 = key(); put('content/fr/about.html', '<p>edited</p>'); assert.equal(key(), k2, 'another page\'s document is not');
  rmSync(root, { recursive: true, force: true });
});
check('blocks not authored by the page still key it: auto-blocks and foundation-loaded blocks (shared part), blocks its blocks import; another page\'s block does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-all-blocks-'));
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  put('scripts/scripts.js', "import { buildBlock } from './aem.js';\nbuildBlock('embed', []);");
  put('blocks/header/header.js', "import { loadFragment } from '../fragment/fragment.js';");
  put('blocks/fragment/fragment.js', 'export const loadFragment = 1;'); put('blocks/embed/embed.css', '.embed{}'); put('blocks/video/video.css', '.video{}');
  put('blocks/cards/cards.js', "import { carousel } from '../carousel/carousel.js';\nimport { x } from '../../scripts/aem.js';"); put('blocks/carousel/carousel.js', 'export const carousel = 1;');
  put('blocks/tabs/tabs.css', '.tabs{}');
  put('content/index.html', '<div class="cards"></div>'); put('content/other.html', '<div class="tabs"></div><div class="carousel"></div><div class="fragment"></div><div class="embed"></div>');
  const opts = parseArgs(['node', 'x']); const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' };
  const key = () => gateKeyOf(gateKeyParts(page, { root, opts, instruments: 'i' }).parts);
  assert.deepEqual(gateKeyParts(page, { root, opts, instruments: 'i' }).parts.blocks.carousel, { 'blocks/carousel/carousel.js': createHash('sha256').update('export const carousel = 1;').digest('hex') }, 'imported by cards');
  assert.deepEqual(sharedBlocks(root).names, ['embed', 'fragment', 'header', 'video'], 'unauthored or loaded by the foundation');
  const k0 = key();
  for (const [f, edit] of [['blocks/embed/embed.css', '.embed{ }'], ['blocks/fragment/fragment.js', 'export const loadFragment = 2;'], ['blocks/video/video.css', '.video{ }'], ['blocks/carousel/carousel.js', 'export const carousel = 2;']]) {
    const before = readFileSync(join(root, f), 'utf8'); put(f, edit); assert.notEqual(key(), k0, f); put(f, before);
  }
  put('blocks/tabs/tabs.css', '.tabs{ }'); assert.equal(key(), k0, 'a block only another page authors');
  rmSync(root, { recursive: true, force: true });
});
check('deploy-state guard: the gated host serves the pushed branch and repo; every document is its newest ledger row, delivered to that org/repo', () => {
  const code = { ok: true, branch: 'feature/Hero', ref: 'feature-hero', owner: 'org', repo: 'site' };
  assert.equal(edsHostOf('feature-hero--site--org.aem.page').ref, 'feature-hero');
  assert.equal(hostServes('feature-hero--site--org.aem.page', code), null);
  assert.match(hostServes('main--site--org.aem.page', code), /serves ref main, the upstream branch is feature\/Hero/);
  assert.match(hostServes('feature-hero--fork--org.aem.page', code), /serves org\/fork, the upstream remote is org\/site/);
  assert.match(hostServes('www.example.com', code), /not an EDS/);
  const root = mkdtempSync(join(tmpdir(), 'gate-all-ledger-'));
  mkdirSync(join(root, 'content')); mkdirSync(join(root, 'stardust/deploy'), { recursive: true });
  const row = (status, ts, contentSha, verifiedOn = 'Org/Site') => ({ status, ts, contentSha, verifiedOn });
  writeFileSync(join(root, 'content/.deploy-ledger.json'), JSON.stringify({ '/index': row('live', T(1), 'old'), '/nav': row('live', T(1), 'n'), '/footer': row('previewed', T(1), 'f'), '/x': { status: 'live', ts: T(1), contentSha: 'x' }, '/y': row('live', T(1), 'y', 'org/other') }));
  writeFileSync(join(root, 'stardust/deploy/ledger-c1.json'), JSON.stringify({ '/index': row('live', T(3), 'new'), '/about': row('preview-fail', T(3), 'a') }));
  const docs = deployedDocs(root); const live = 'main--site--org.aem.live'; const preview = 'main--site--org.aem.page';
  assert.deepEqual(docs['/index'], { contentSha: 'new', status: 'live', verifiedOn: 'Org/Site', ts: T(3) });
  assert.equal(contentDeployed({ 'content/index.html': 'new', 'content/nav.html': 'n' }, docs, live), null);
  assert.match(contentDeployed({ 'content/index.html': 'old' }, docs, live), /content\/index\.html differs from the deployed document/);
  assert.match(contentDeployed({ 'content/z.html': 'z' }, docs, live), /no deploy-ledger contentSha for \/z/);
  assert.equal(contentDeployed({ 'content/footer.html': 'f' }, docs, preview), null, 'previewed is what a preview host serves');
  assert.match(contentDeployed({ 'content/footer.html': 'f' }, docs, live), /is previewed, not live/);
  assert.match(contentDeployed({ 'content/about.html': 'a' }, docs, preview), /is preview-fail/, 'the newest attempt failed: the delivered document is unknown');
  assert.match(contentDeployed({ 'content/x.html': 'x' }, docs, live), /no verifiedOn/, 'a row without verifiedOn proves nothing');
  assert.match(contentDeployed({ 'content/y.html': 'y' }, docs, live), /delivered to org\/other, not org\/site/);
  assert.match(contentDeployed({ 'content/index.html': 'new' }, docs, 'www.example.com'), /not an EDS/);
  rmSync(root, { recursive: true, force: true });
});
check('deploy-state guard, code half: ANY unpushed, deleted, renamed or untracked file under a hashed code path leaves every key unknown', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-git-'))); const root = join(base, 'site');
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  const run = (cwd, ...args) => { const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  put('styles/styles.css', 'body{}'); put('scripts/scripts.js', '//'); put('blocks/hero/hero.js', "import { c } from '../carousel/carousel.js';"); put('blocks/carousel/carousel.js', 'export const c = 1;');
  mkdirSync(join(base, 'org')); run(join(base, 'org'), 'init', '-q', '--bare', 'site.git');
  run(root, 'init', '-q'); run(root, 'symbolic-ref', 'HEAD', 'refs/heads/main'); run(root, 'add', '--', 'styles', 'scripts', 'blocks'); run(root, 'commit', '-qm', 'site');
  run(root, 'remote', 'add', 'origin', join(base, 'org', 'site.git')); run(root, 'push', '-q', '-u', 'origin', 'HEAD');
  assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'foundation-freeze.mjs'), 'freeze', '--paths', 'styles,scripts'], { cwd: root }).status, 0);
  const paths = [...foundationPart(root).paths, 'icons/', 'plugins/', 'blocks/'];
  assert.deepEqual(foundationPart(root).paths, ['styles', 'scripts'], 'slash-less manifest entries');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.deepEqual(codeDeployed(paths, root), { ok: true, why: null, upstream: head, branch: 'main', ref: 'main', owner: 'org', repo: 'site' });
  rmSync(join(root, 'blocks/carousel'), { recursive: true });
  assert.match(codeDeployed(paths, root).why, /not pushed, so not deployed\): blocks\/carousel\/carousel\.js/, 'a deleted dependency the hero block imports');
  assert.equal(codeDeployed(paths, root).upstream, head, 'the upstream commit is recorded with an unknown key too');
  run(root, 'checkout', '--', 'blocks'); run(root, 'mv', 'blocks/hero', 'blocks/hero-banner');
  assert.match(codeDeployed(paths, root).why, /blocks\/hero-banner\/hero\.js, blocks\/hero\/hero\.js/, 'a rename names both sides');
  run(root, 'mv', 'blocks/hero-banner', 'blocks/hero');
  assert.equal(codeDeployed(paths, root).ok, true);
  put('styles/styles.css', 'body{ }'); assert.match(codeDeployed(paths, root).why, /styles\/styles\.css/, 'a slash-less manifest entry covers its whole dir');
  run(root, 'checkout', '--', 'styles'); put('scripts/new.js', '//'); assert.match(codeDeployed(paths, root).why, /untracked code, not deployed: scripts\/new\.js/);
  rmSync(base, { recursive: true, force: true });
});
check('instrumentFiles: the gate\'s instruments and every local module they load are hashed — a new local import cannot escape the key', () => {
  const files = instrumentFiles([SCRIPT, join(HERE, '..', 'stitch-shot.mjs'), join(HERE, '..', 'pixel-compare.mjs'), ...['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => join(HERE, '../../../diff/scripts', f))]);
  const names = files.map((f) => f.split(/[\\/]/).slice(-1)[0]);
  for (const n of ['live-session.mjs', 'measure-live.mjs', 'run-capped.mjs', 'foundation-freeze.mjs', 'clip-probe.mjs']) assert.ok(names.includes(n), n);
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"`](\.{1,2}\/[^'"`]+)['"`]/g)) assert.ok(files.includes(join(dirname(f), m[1])), `${f} imports ${m[1]}, not hashed`);
});
check('keyChanged / skipCapture / rowKey: an EDS capture is reused only while gate-key.json proves it current; a row keeps a key only for evidence measured under it', () => {
  const P = { blocks: { cards: { 'blocks/cards/cards.css': 'a' } } }; const D = { '/index': { contentSha: 'c', ts: T(1) } };
  const cur = (gateKey, over = {}) => ({ gateKey, why: gateKey ? null : 'why', parts: P, upstream: 'u1', deployed: D, ...over });
  assert.equal(keyChanged(null, undefined), false, 'prototype stage: no keys'); assert.equal(keyChanged(null, cur('K')), true, 'no gate-key.json (legacy): nothing proves the capture');
  assert.equal(keyChanged({ gateKey: 'K' }, cur('K')), false); assert.equal(keyChanged({ gateKey: 'K' }, cur('K2')), true); assert.equal(keyChanged({ gateKey: null, parts: P }, cur('K')), true, 'captured while unknown');
  const proven = { gateKey: 'K', why: 'why', parts: P, upstream: 'u1', deployed: D };
  assert.equal(keyChanged(proven, cur(null)), false, 'unknown now: same tree, same reason, same ledger rows');
  assert.equal(keyChanged(proven, cur(null, { parts: { blocks: { cards: { 'blocks/cards/cards.css': 'b' } } } })), true, 'unknown now and the tree moved');
  assert.equal(keyChanged(proven, cur(null, { why: 'other' })), true, 'another reason (a push, a deploy) since the capture');
  assert.equal(keyChanged(proven, cur(null, { deployed: { '/index': { contentSha: 'c', ts: T(2) } } })), true, 'a document re-deployed since the capture');
  assert.equal(keyChanged(proven, cur(null, { upstream: 'u2' })), true, 'a push since the capture, the reason unchanged');
  assert.equal(keyChanged({ gateKey: null, why: 'why' }, cur(null, { parts: null })), true, 'parts unknown');
  const ctx = (opts, changed = false) => ({ opts, has: () => true, keyChanged: () => changed });
  assert.equal(skipCapture({}, 'eds', ctx({ skip: true })), true); assert.equal(skipCapture({}, 'eds', ctx({ skip: true }, true)), false);
  assert.equal(skipCapture({}, 'origin', ctx({ skip: true }, true)), true); assert.equal(skipCapture({}, 'origin', ctx({ skip: true, recaptureOrigin: true })), false);
  assert.equal(skipCapture({}, 'eds', ctx({ skip: false })), false);
  const build = { origin: 'https://h', settings: { threshold: 10 } }; const stored = { gateKey: 'K', parts: { build } };
  assert.equal(rowKey(stored, { gateKey: 'K', parts: { build } }), 'K'); assert.equal(rowKey(stored, { gateKey: 'K2', parts: { build } }), null, 'measured under another key');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build } }), 'K', 'unknown now, same criteria, probes replayed');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build } }, true), null, 'probed afresh against an unproven deploy');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build: { ...build, settings: { threshold: 12 } } } }), null, 'other criteria');
  assert.equal(rowKey(stored, { gateKey: null, parts: null }), null); assert.equal(rowKey(null, { gateKey: 'K' }), null);
});
check('rowReuse: a PASS row under the same key and criteria is reused whole; never an INCONCLUSIVE row, never one measured on an asymmetric (crawl-fullpage) origin', () => {
  const opts = parseArgs(['node', 'x', '--skip-existing']);
  const prov = { stage: 'published', threshold: 10, heightTolerance: 0.05, clipMax: 0, unitTol: 4, criteria: { clip: true, content: true } };
  const prior = (over = {}) => ({ row: { slug: 'a', gateKey: 'K', pct: 2, heightDelta: 0, originH: 3000, pass: true, passWithOverride: true, clipPass: true, contentPass: true, inconclusive: false, originAsymmetric: false, reasons: [], ...over }, from: 'summary.json', at: T(1), prov });
  assert.deepEqual(rowReuse({ prior: prior(), gateKey: 'K', edsPng: true, opts }).reused, { what: 'row', from: 'summary.json', at: T(1), gateKey: 'K' });
  assert.equal(rowReuse({ prior: prior({ inconclusive: true, pass: false, passWithOverride: false }), gateKey: 'K', edsPng: true, opts }), null);
  assert.equal(rowReuse({ prior: prior({ inconclusive: true }), gateKey: 'K', edsPng: true, opts }), null, 'whatever else the row says');
  assert.equal(rowReuse({ prior: prior({ originAsymmetric: true }), gateKey: 'K', edsPng: true, opts }), null, 'a PASS on a crawl-fullpage origin from an older table');
  const withOv = (override) => rowReuse({ prior: prior(), gateKey: 'K', edsPng: true, override, register, opts });
  assert.deepEqual(withOv({ verdict: 'tier-shift', reason: 'R-01' }).override, { verdict: 'tier-shift', reason: 'R-01', valid: true }, 'the override it attaches is validated');
  assert.deepEqual([withOv({ verdict: 'PASS', reason: 'x' }).override.valid, withOv({ verdict: 'PASS', reason: 'x' }).passWithOverride], [false, true], 'a PASS row stays PASS');
  // the magnitude is re-checked on the reused row's own numbers under this run's criteria
  const reOv = (over) => rowReuse({ prior: prior(over), gateKey: 'K', edsPng: true, override: tierShift, register, opts }).override;
  assert.deepEqual(reOv({ pct: 25 }), { ...tierShift, valid: false, rejected: [MAG], magnitude: { pct: 25, maxPct: 20, heightDelta: 0, maxHeightDelta: 300 } });
  assert.deepEqual(reOv({ heightDelta: -301 }).rejected, [MAG]); assert.equal(reOv({ pct: 20, heightDelta: -300 }).valid, true, 'inclusive');
  assert.deepEqual(reOv({ originH: undefined }).rejected, ['no measured pixel % / Δh / origin height to bound the override'], 'a row without its numbers cannot be bounded');
  // host: a reused row keeps its own; one from a table written before the field takes this run's (the equal key proves it)
  const reHost = (over, host = 'https://main--site--org.aem.live') => rowReuse({ prior: prior(over), gateKey: 'K', edsPng: true, opts, host }).host;
  assert.equal(reHost({}), 'https://main--site--org.aem.live', 'a legacy row (no host field)');
  assert.equal(reHost({ host: 'https://main--site--org.aem.page' }), 'https://main--site--org.aem.page', 'its own host kept');
  assert.equal(reHost({ host: null }), null, 'a recorded null stays null'); assert.equal(reHost({}, null), null, 'no current host given');
});
if (textBoxPct) check('pixel-compare textBoxPct: differing pixels counted inside the boxes only, masked rows skipped', () => {
  const w = 10; const h = 10; const data = Buffer.alloc(w * h * 4);
  const red = (x, y) => { const i = (y * w + x) * 4; data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255; };
  red(1, 1); red(2, 1); red(8, 8);
  const masked = new Uint8Array(h); masked[1] = 0;
  const r = textBoxPct({ data }, [{ x: 0, y: 0, w: 4, h: 4 }], w, h, masked);
  assert.equal(r.boxes, 1); assert.equal(r.pixels, 16); assert.equal(r.pct, 12.5);
  masked[1] = 1;
  assert.equal(textBoxPct({ data }, [{ x: 0, y: 0, w: 4, h: 4 }], w, h, masked).pct, 0);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
// ---- an empty selection names its cause: both roster files read (published), their counts, the source, --only --------
// A rollout coverage (pages.json): deployed / verified / gate-failed rows qualify (a, b, c); pending, a non-gate failure
// and a row without a deployedUrl do not (d, e, f).
const crow = (slug, status, { url = `https://main--site--org.aem.page/${slug}`, error = null, source = `https://www.example.com/${slug}`, ...rest } = {}) => ({ slug, path: `/${slug}`, title: slug, templateId: 'page', source: source ? { sourceUrl: source } : {}, blocks: [], delivery: { status, deployedUrl: url, deployedAt: null, verifiedAt: null, error }, ...rest });
const COV = { pages: [crow('a', 'deployed'), crow('b', 'verified'), crow('c', 'failed', { error: 'gate: pixel 12%' }), crow('d', 'pending', { url: null }), crow('e', 'failed', { error: 'deploy: 502' }), crow('f', 'deployed', { url: null })] };
const COV_PATH = 'stardust/rollout/coverage/pages.json';
const STATE_HINT = `pass --coverage ${COV_PATH} or --state stardust/state.json from the project root, or deploy first`;
// Roster from coverage: --state cannot change the published roster, so the hint does not name it.
const COV_HINT = 'coverage wins for the published stage — record deployed pages with update-coverage.mjs <slug> --status deployed --url <deployedUrl>, or pass --coverage <file> from the project root';
const PROTO_HINT = 'pass --state stardust/state.json (or the gate state file) from the project root, or deploy first';
check('emptySelection: published — both sources (absolute) with their counts, a missing one not found, the roster\'s source; prototype — the state file; the source-url and --only exclusions, the source\'s hint last', () => {
  const st = { pages: [{ slug: 'a', url: 'https://o.test/a', status: 'pending', prototypePath: 'p/a.html' }, { slug: 'b', url: 'https://o.test/b', status: 'deployed' },
    { slug: 'c', status: 'deployed', liveUrl: 'https://e.test/c', prototypePath: 'p/c.html' }] };
  const at = '/p/stardust/state.json'; const cp = `/p/${COV_PATH}`; const pub = { stage: 'published', statePath: at, coveragePath: cp }; const noCov = `coverage ${cp} not found`;
  assert.equal(emptySelection({ pages: st.pages.slice(0, 2) }, pub), `gate-all: no pages selected — ${noCov}; state ${at} has 2 page(s), 0 deployed with a liveUrl (published stage, roster from state); ${STATE_HINT}`);
  assert.equal(emptySelection(st, pub), `gate-all: no pages selected — ${noCov}; state ${at} has 3 page(s), 1 deployed with a liveUrl (1 without a source url) (published stage, roster from state); ${STATE_HINT}`);
  assert.equal(emptySelection(st, { stage: 'prototype', only: ['x', 'y'], statePath: at, coverage: COV, coveragePath: cp }), `gate-all: no pages selected — ${at} has 3 page(s), 2 with a prototypePath (1 without a source url) (prototype stage); --only x,y matched none of the 1 page(s) the stage selects; ${PROTO_HINT}`);
  assert.equal(emptySelection(st, { ...pub, only: ['c'] }), `gate-all: no pages selected — ${noCov}; state ${at} has 3 page(s), 1 deployed with a liveUrl (1 without a source url) (published stage, roster from state); ${STATE_HINT}`, '--only is named only when the stage selected pages');
  assert.equal(emptySelection({}, pub), `gate-all: no pages selected — ${noCov}; state ${at} has 0 page(s), 0 deployed with a liveUrl (published stage, roster from state); ${STATE_HINT}`);
  const pending = { pages: [crow('a', 'pending', { url: null }), crow('b', 'failed', { error: 'deploy: 502' })] };
  assert.equal(emptySelection(st, { ...pub, coverage: pending }), `gate-all: no pages selected — coverage ${cp} has 2 row(s), 0 deployed / verified / gate-failed with a deployedUrl; state ${at} has 3 page(s), 1 deployed with a liveUrl (1 without a source url) (published stage, roster from coverage); ${COV_HINT}`);
  const noSrc = { pages: [...COV.pages, crow('g', 'deployed', { source: null })] };
  assert.equal(emptySelection(null, { ...pub, coverage: noSrc, only: ['z'] }), `gate-all: no pages selected — coverage ${cp} has 7 row(s), 4 deployed / verified / gate-failed with a deployedUrl (1 without a source url); state ${at} not found (published stage, roster from coverage); --only z matched none of the 3 page(s) the stage selects; ${COV_HINT}`);
  assert.equal(emptySelection(null, { ...pub, coverage: pending, stateError: 'Unexpected end of JSON input' }), `gate-all: no pages selected — coverage ${cp} has 2 row(s), 0 deployed / verified / gate-failed with a deployedUrl; state ${at} unreadable (published stage, roster from coverage); ${COV_HINT}`);
});
check('CLI: coverage rows all pending and a state without a liveUrl → exit 1, one stderr line naming both files (absolute), their counts, the source and the coverage hint (also with an explicit --state, which cannot change the roster); nothing written', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-empty-'))); mkdirSync(join(cwd, 'stardust/rollout/coverage'), { recursive: true });
  writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify({ pages: [{ slug: 'a', url: 'https://o.test/a', status: 'pending' }, { slug: 'b', url: 'https://o.test/b', status: 'deployed' }] }));
  writeFileSync(join(cwd, COV_PATH), JSON.stringify({ pages: [crow('a', 'pending', { url: null }), crow('b', 'pending', { url: null })] }));
  const before = readdirSync(cwd, { recursive: true }).sort();
  for (const args of [[], ['--state', 'stardust/state.json']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.equal(r.stderr.trim(), `gate-all: no pages selected — coverage ${join(cwd, COV_PATH)} has 2 row(s), 0 deployed / verified / gate-failed with a deployedUrl; state ${join(cwd, 'stardust/state.json')} has 2 page(s), 0 deployed with a liveUrl (published stage, roster from coverage); ${COV_HINT}`, args.join(' '));
    assert.ok(!r.stderr.includes('pass --coverage stardust/rollout/coverage/pages.json or --state'), r.stderr);
  }
  assert.deepEqual(readdirSync(cwd, { recursive: true }).sort(), before);
  rmSync(cwd, { recursive: true, force: true });
});
check('CLI: neither roster file → one stderr line naming both; an explicit --coverage that is missing, or a coverage that does not parse → one line; --stage prototype ignores --coverage (the state message); exit 1, nothing written', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-nofile-')));
  const cli = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); assert.equal(r.status, 1, r.stderr); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr); return r.stderr.trim(); };
  assert.equal(cli([]), `gate-all: neither ${COV_PATH} nor stardust/state.json found — run from the project root or pass --coverage / --state`);
  assert.deepEqual(readdirSync(cwd), []);
  mkdirSync(join(cwd, 'stardust')); writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify({ pages: [] })); writeFileSync(join(cwd, 'bad.json'), '{');
  const before = readdirSync(cwd, { recursive: true }).sort();
  assert.equal(cli(['--coverage', 'missing.json']), 'gate-all: missing.json not found — run from the project root or pass --coverage');
  assert.match(cli(['--coverage', 'bad.json']), /^gate-all: bad\.json unreadable: \S/);
  rmSync(join(cwd, 'stardust/state.json'));
  for (const c of ['missing.json', 'bad.json']) assert.equal(cli(['--stage', 'prototype', '--coverage', c]), 'gate-all: stardust/state.json not found — run from the project root or pass --state');
  assert.deepEqual(readdirSync(cwd, { recursive: true }).sort(), before.filter((f) => f !== join('stardust', 'state.json')));
  rmSync(cwd, { recursive: true, force: true });
});
// ---- the roster: selectPages / rosterEstimate (run-bg sizes a gate-all job's deadline with them), the deadline env ---
const LOCK_OFF = { STARDUST_BROWSER_SLOTS: '0' }; // no machine browser slot: the estimate's factor is 1
check('estimateFactor: relative to the measured default pools — per slot 1 → × 4 (captures sequential), 2 → × 2, 3 → × 1, no slot → × 1; a lower origin flag raises it, never below 1', () => {
  const D = { oc: 2, ec: 4, pc: 2 }; const f = (env, flags = D) => estimateFactor(browserPools(flags, env));
  const slot = (n) => ({ STARDUST_BROWSER_SLOT: '/locks/slot-1', STARDUST_BROWSERS_PER_SLOT: n });
  assert.deepEqual(f(slot('1')), { factor: 4, why: '1 browser per slot, captures sequential' });
  assert.deepEqual(f(slot('2')), { factor: 2, why: '2 browsers per slot, origin pool 1' });
  assert.deepEqual(f(slot('3')), { factor: 1, why: null }); assert.deepEqual(f({}), { factor: 1, why: null });
  assert.deepEqual(f({}, { ...D, oc: 1 }), { factor: 2, why: 'origin pool 1' }); assert.deepEqual(f({}, { ...D, oc: 6 }), { factor: 1, why: null });
});
check('selectPages / rosterEstimate: published vs prototype, --only, the state resolved against cwd, other flags and --help tolerated, a missing or unreadable state → error; RUN_BG_DEADLINE_SEC > 0 is the deadline', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-roster-'))); mkdirSync(join(cwd, 'stardust'));
  const st = { pages: [{ slug: 'a', url: 'https://o.test/a', status: 'deployed', liveUrl: 'https://e.test/a', prototypePath: 'stardust/prototypes/a.html' },
    { slug: 'b', url: 'https://o.test/b', status: 'deployed', liveUrl: 'https://e.test/b' }, { slug: 'c', url: 'https://o.test/c', status: 'pending', prototypePath: 'stardust/prototypes/c.html' },
    { slug: 'd', status: 'deployed', liveUrl: 'https://e.test/d', prototypePath: 'stardust/prototypes/d.html' }] };
  writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify(st)); writeFileSync(join(cwd, 'gate.json'), JSON.stringify({ pages: st.pages.slice(0, 1) })); writeFileSync(join(cwd, 'bad.json'), '{');
  const slugs = (o) => selectPages(st, o).map((p) => p.slug);
  assert.deepEqual(slugs({ stage: 'published' }), ['a', 'b']); assert.deepEqual(slugs({ stage: 'published', only: ['b', 'z'] }), ['b']);
  assert.deepEqual(selectPages(st, { stage: 'prototype', protoBase: 'http://localhost:9' }).map((p) => [p.slug, p.liveUrl]), [['a', 'http://localhost:9/a.html'], ['c', 'http://localhost:9/c.html']]);
  assert.equal(selectPages(st, { stage: 'prototype' })[0].liveUrl, 'http://localhost:8791/a.html'); assert.deepEqual(selectPages({}, { stage: 'published' }), []);
  const state = join(cwd, 'stardust/state.json'); const x1 = { factor: 1, factorWhy: null };
  assert.deepEqual(rosterEstimate([], { cwd, env: LOCK_OFF }), { pages: 2, widths: 1, width: 1440, stage: 'published', source: 'state', state, estimatedSeconds: 50, ...x1 });
  assert.deepEqual(rosterEstimate(['--stage', 'prototype', '--width', '360', '--proto-base', 'http://localhost:9/', '--only', 'c,z'], { cwd, env: LOCK_OFF }), { pages: 1, widths: 1, width: 360, stage: 'prototype', source: 'state', state, estimatedSeconds: 25, ...x1 });
  assert.deepEqual(rosterEstimate(['--skip-existing', '--out', 'x', '--bogus', 'y', '--help', '--state', 'gate.json', '--threshold', '5'], { cwd, env: LOCK_OFF }), { pages: 1, widths: 1, width: 1440, stage: 'published', source: 'state', state: join(cwd, 'gate.json'), estimatedSeconds: 25, ...x1 });
  assert.match(rosterEstimate(['--state', 'nope.json'], { cwd }).error, /nope\.json not found/); assert.match(rosterEstimate(['--state', 'bad.json'], { cwd }).error, /bad\.json unreadable/);
  assert.match(rosterEstimate(['--stage', 'draft'], { cwd }).error, /--stage must be published or prototype/);
  // the pools the job would run with (run-bg's env, before it takes the slot): run-bg's browsersPerSlot, the argv's pool flags
  const x = (env, argv = []) => { const e = rosterEstimate(argv, { cwd, env }); return [e.estimatedSeconds, e.factor, e.factorWhy]; };
  assert.deepEqual(x({}), [200, 4, '1 browser per slot, captures sequential'], 'run-bg defaults: budget 3 / slots 3 → 1 per slot');
  assert.deepEqual(x({ STARDUST_BROWSER_BUDGET: '3', STARDUST_BROWSER_SLOTS: '3' }), [200, 4, '1 browser per slot, captures sequential']);
  assert.deepEqual(x({ STARDUST_BROWSER_BUDGET: '6', STARDUST_BROWSER_SLOTS: '3' }), [100, 2, '2 browsers per slot, origin pool 1']);
  assert.deepEqual(x({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: '3' }), [50, 1, null]);
  assert.deepEqual(x({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: '3' }, ['--origin-concurrency', '1']), [100, 2, '3 browsers per slot, origin pool 1'], 'a lower origin flag');
  assert.deepEqual(x(LOCK_OFF), [50, 1, null], 'STARDUST_BROWSER_SLOTS=0: the lock off, no slot');
  assert.deepEqual(x(LOCK_OFF, ['--origin-concurrency', '1']), [100, 2, 'origin pool 1']); assert.deepEqual(x(LOCK_OFF, ['--origin-concurrency', '4']), [50, 1, null], 'never below 1');
  assert.deepEqual(x(LOCK_OFF, ['--origin-concurrency', 'x']), [50, 1, null], 'a bad value: the default (gate-all itself refuses it)');
  assert.deepEqual(x({ STARDUST_BROWSER_SLOT: '/locks/slot-1', STARDUST_BROWSERS_PER_SLOT: '2', STARDUST_BROWSER_SLOTS: '0' }), [100, 2, '2 browsers per slot, origin pool 1'], 'an inherited slot: what main() will see');
  assert.deepEqual(['900', '0', '-5', 'x', undefined].map((v) => parseArgs(['node', 'x'], v === undefined ? {} : { RUN_BG_DEADLINE_SEC: v }).deadlineSec), [900, null, null, null, null]);
  rmSync(cwd, { recursive: true, force: true });
});
check('coverage roster: deployed / verified / gate-failed rows with a deployedUrl and a source url, in file order, --only after; a state page of the same slug lends template / fidelityTier / deployedPath, else templateId / null / the row path', () => {
  const slugs = (pages) => pages.map((p) => p.slug);
  assert.deepEqual(slugs(coveragePages(COV)), ['a', 'b', 'c']); assert.deepEqual(slugs(selectPages(null, { coverage: COV })), ['a', 'b', 'c']);
  assert.deepEqual(slugs(selectPages(null, { coverage: COV, only: ['c', 'd', 'z'] })), ['c']);
  assert.deepEqual(coveragePages(COV)[2], { slug: 'c', url: 'https://www.example.com/c', liveUrl: 'https://main--site--org.aem.page/c', template: 'page', fidelityTier: null, deliveryStatus: 'failed', deployedPath: '/c' });
  const st = { pages: [{ slug: 'a', url: 'https://o.test/a', status: 'deployed', liveUrl: 'https://e.test/a', template: 'home', fidelityTier: 'A', deployedPath: '/en/', prototypePath: 'p/a.html' },
    { slug: 'b', url: 'https://o.test/b', status: 'pending', template: null, fidelityTier: 'B' }, { slug: 'x', url: 'https://o.test/x', status: 'deployed', liveUrl: 'https://e.test/x' }] };
  assert.deepEqual(coveragePages(COV, { state: st }).map((p) => [p.slug, p.url, p.liveUrl, p.template, p.fidelityTier, p.deployedPath]), [
    ['a', 'https://www.example.com/a', 'https://main--site--org.aem.page/a', 'home', 'A', '/en/'], ['b', 'https://www.example.com/b', 'https://main--site--org.aem.page/b', null, 'B', '/b'],
    ['c', 'https://www.example.com/c', 'https://main--site--org.aem.page/c', 'page', null, '/c']]);
  assert.deepEqual(slugs(selectPages(st, { coverage: COV })), ['a', 'b', 'c'], 'both sources: the coverage is the published roster');
  assert.deepEqual(slugs(selectPages(st, { stage: 'prototype', coverage: COV })), ['a'], 'the prototype stage reads the state');
  const moved = coveragePages({ pages: [crow('p', 'deployed', { url: 'https://main--site--org.aem.page/en/products/p', path: '/products/p' }), { ...crow('q', 'verified'), path: undefined, templateId: undefined }] });
  assert.equal(moved[0].deployedPath, '/products/p', 'the row path, not the deployedUrl pathname'); assert.equal('deployedPath' in moved[1], false); assert.equal(moved[1].template, null);
});
check('buildHost: the build origin(s) measured and where they come from — --eds-host first, the prototype stage\'s --proto-base, else the roster\'s own URLs (coverage deployedUrl / state liveUrl); unique, sorted', () => {
  const ps = [{ liveUrl: 'https://main--site--org.aem.page/b' }, { liveUrl: 'https://main--site--org.aem.page/a' }, { liveUrl: 'https://fix--site--org.aem.page/c' }, { liveUrl: 'not a url' }];
  assert.deepEqual(buildHost(ps, { source: 'coverage' }), { origins: ['https://fix--site--org.aem.page', 'https://main--site--org.aem.page'], from: 'coverage deployedUrl' });
  assert.deepEqual(buildHost(ps.slice(0, 2), { source: 'state' }), { origins: ['https://main--site--org.aem.page'], from: 'state liveUrl' });
  assert.deepEqual(buildHost(ps, { source: 'coverage', edsHost: 'https://main--site--org.aem.live' }), { origins: ['https://main--site--org.aem.live'], from: '--eds-host' });
  assert.deepEqual(buildHost([{ liveUrl: 'http://localhost:9/a.html' }], { stage: 'prototype', protoBase: 'http://localhost:9' }), { origins: ['http://localhost:9'], from: '--proto-base' });
  assert.equal(buildHost([{ liveUrl: 'http://localhost:8791/a.html' }], { stage: 'prototype' }).from, '--proto-base default');
});
check('rosterEstimate over the coverage: the default file beside a state wins (source coverage), --coverage names another; --stage prototype reads the state (a missing / malformed --coverage ignored); a missing or malformed --coverage → error; a malformed state beside a coverage is ignored', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-covroster-'))); mkdirSync(join(cwd, 'stardust/rollout/coverage'), { recursive: true });
  const st = { pages: [{ slug: 'a', url: 'https://o.test/a', status: 'deployed', liveUrl: 'https://e.test/a', prototypePath: 'p/a.html' }, { slug: 'x', url: 'https://o.test/x', status: 'deployed', liveUrl: 'https://e.test/x', prototypePath: 'p/x.html' }] };
  writeFileSync(join(cwd, 'stardust/state.json'), JSON.stringify(st)); writeFileSync(join(cwd, COV_PATH), JSON.stringify(COV));
  writeFileSync(join(cwd, 'other.json'), JSON.stringify({ pages: COV.pages.slice(1) })); writeFileSync(join(cwd, 'bad.json'), '{');
  const coverage = join(cwd, COV_PATH); const state = join(cwd, 'stardust/state.json'); const est = (pages) => ({ pages, widths: 1, width: 1440, estimatedSeconds: 25 * pages, factor: 1, factorWhy: null });
  assert.deepEqual(rosterEstimate([], { cwd, env: LOCK_OFF }), { ...est(3), stage: 'published', source: 'coverage', coverage });
  assert.deepEqual(rosterEstimate(['--only', 'a,z'], { cwd, env: LOCK_OFF }), { ...est(1), stage: 'published', source: 'coverage', coverage });
  assert.deepEqual(rosterEstimate(['--coverage', 'other.json'], { cwd, env: LOCK_OFF }), { ...est(2), stage: 'published', source: 'coverage', coverage: join(cwd, 'other.json') });
  assert.deepEqual(rosterEstimate(['--coverage', 'missing.json'], { cwd, env: LOCK_OFF }), { error: `${join(cwd, 'missing.json')} not found` });
  const bad = rosterEstimate(['--coverage', 'bad.json'], { cwd, env: LOCK_OFF }).error; assert.ok(bad.startsWith(`${join(cwd, 'bad.json')} unreadable: `), bad);
  for (const c of [[], ['--coverage', 'missing.json'], ['--coverage', 'bad.json']]) assert.deepEqual(rosterEstimate(['--stage', 'prototype', ...c], { cwd, env: LOCK_OFF }), { ...est(2), stage: 'prototype', source: 'state', state });
  writeFileSync(join(cwd, 'stardust/state.json'), '{');
  assert.deepEqual(rosterEstimate([], { cwd, env: LOCK_OFF }), { ...est(3), stage: 'published', source: 'coverage', coverage });
  rmSync(cwd, { recursive: true, force: true });
});

// ---- fix rounds: the count (roundsOf — rounds.json, else the legacy runs/*.json seed), the cap line, the next count ------
const RT = (m) => `2026-02-01T00:${String(m).padStart(2, '0')}:00.000Z`;
check('countsAsRound: a row with a verdict counts (a reused row too); an INCONCLUSIVE row, a row without a pixel measurement or no row does not', () => {
  assert.equal(countsAsRound({ slug: 'a', pct: 2, inconclusive: false }), true); assert.equal(countsAsRound({ slug: 'a', pct: 30, pass: false }), true, 'a FAIL is a verdict');
  assert.equal(countsAsRound({ slug: 'a', pct: 2, reused: { what: 'row', at: RT(1) } }), true, 'a reused verdict is a verdict');
  assert.equal(countsAsRound({ slug: 'a', pct: 1.5, inconclusive: true }), false); assert.equal(countsAsRound({ slug: 'a', pct: null, error: 'missing capture' }), false); assert.equal(countsAsRound(null), false);
});
check('roundsOf: no rounds.json → the legacy seed from runs/*.json (tables with a verdict row for the slug: INCONCLUSIVE / error rows and unreadable tables are none, a reused row is one), from "runs"; rounds.json present → it (from "rounds.json"); one that does not parse → the seed', () => {
  const out = mkdtempSync(join(tmpdir(), 'gate-all-rounds-'));
  assert.deepEqual(roundsOf(out, 'a'), { rounds: 0, max: MAX_ROUNDS, at: [], resets: [], from: 'runs' }); assert.equal(MAX_ROUNDS, 3);
  mkdirSync(join(out, 'runs'));
  const table = (m, rows) => writeFileSync(join(out, 'runs', `${RT(m).replace(/[:.]/g, '-')}-x.json`), JSON.stringify({ _provenance: { writtenAt: RT(m) }, rows }));
  table(4, [{ slug: 'a', pct: 2, reused: { what: 'row', at: RT(1) } }]); table(1, [{ slug: 'a', pct: 2 }, { slug: 'b', pct: 2 }]); table(2, [{ slug: 'a', pct: 1.5, inconclusive: true }]);
  table(3, [{ slug: 'a', pct: null, error: 'missing capture' }]); table(5, [{ slug: 'b', pct: 30 }]); writeFileSync(join(out, 'runs', 'broken.json'), '{');
  assert.deepEqual(roundsOf(out, 'a'), { rounds: 2, max: 3, at: [RT(1), RT(4)], resets: [], from: 'runs' });
  assert.deepEqual(roundsOf(out, 'b'), { rounds: 2, max: 3, at: [RT(1), RT(5)], resets: [], from: 'runs' });
  assert.deepEqual(roundsOf(out, 'a', runTables(out)), roundsOf(out, 'a'), 'the tables read once give the same count');
  mkdirSync(join(out, 'a'));
  const doc = { rounds: 1, max: 2, at: [RT(9)], resets: [{ at: RT(8), reason: 'r', from: 3, history: [RT(1), RT(4), RT(7)] }], seeded: 'runs', seededFrom: 2 };
  writeFileSync(join(out, 'a', 'rounds.json'), JSON.stringify(doc));
  assert.deepEqual(roundsOf(out, 'a'), { ...doc, from: 'rounds.json' }, 'rounds.json wins over the tables');
  writeFileSync(join(out, 'a', 'rounds.json'), '{"rounds":');
  assert.equal(roundsOf(out, 'a').from, 'runs'); assert.equal(roundsOf(out, 'a').rounds, 2);
  rmSync(out, { recursive: true, force: true });
});
check('capRefusal: no page at the cap → null; any page at rounds >= max → one line (no verdict, cap reached — re-prototype decision, each capped <slug> <n>/<max> @<w>, the remedy); --round-reset → null', () => {
  assert.equal(capRefusal([{ slug: 'a', rounds: 2 }, { slug: 'b', rounds: 0 }], { max: 3, width: 1440 }), null);
  const line = capRefusal([{ slug: 'a', rounds: 3 }, { slug: 'b', rounds: 1 }, { slug: 'c', rounds: 4 }], { max: 3, width: 1440 });
  assert.equal(line, 'gate-all: refused to start, no verdict — cap reached — re-prototype decision: a 3/3 @1440, c 4/3 @1440 (the fix-round cap, --max-rounds 3); drop a, c from --only, or record the re-prototype decision with --round-reset "<reason>" (a new count for the page(s) at the cap)');
  assert.match(capRefusal([{ slug: 'a', rounds: 2 }], { max: 2, width: 360 }), /cap reached — re-prototype decision: a 2\/2 @360 /, 'a lowered cap');
  assert.equal(capRefusal([{ slug: 'a', rounds: 3 }], { max: 3, width: 1440, reset: 're-prototyped' }), null);
});
check('nextRounds: a counted round adds `at`; a reset (the re-prototype decision) appends { at, reason, from, history } and starts a new count; nothing counted → nothing to write; a count seeded from runs/ records seeded / seededFrom once and keeps it', () => {
  const fresh = { rounds: 0, max: 3, at: [], resets: [], from: 'runs' };
  assert.deepEqual(nextRounds(fresh, { at: RT(1), max: 3, counted: true }), { doc: { rounds: 1, max: 3, at: [RT(1)] }, round: 1, roundReset: null, changed: true });
  assert.deepEqual(nextRounds(fresh, { at: RT(1), max: 3, counted: false }), { doc: { rounds: 0, max: 3, at: [] }, round: 0, roundReset: null, changed: false });
  const seeded = nextRounds({ rounds: 2, max: 3, at: [RT(1), RT(2)], resets: [], from: 'runs' }, { at: RT(3), max: 3, counted: true });
  assert.deepEqual(seeded.doc, { rounds: 3, max: 3, at: [RT(1), RT(2), RT(3)], seeded: 'runs', seededFrom: 2 });
  const capped = { ...seeded.doc, from: 'rounds.json' };
  const reset = nextRounds(capped, { at: RT(4), max: 3, counted: true, reset: 're-prototyped the hero' });
  assert.deepEqual(reset, { doc: { rounds: 1, max: 3, at: [RT(4)], resets: [{ at: RT(4), reason: 're-prototyped the hero', from: 3, history: [RT(1), RT(2), RT(3)] }], seeded: 'runs', seededFrom: 2 }, round: 1, roundReset: { reason: 're-prototyped the hero', at: RT(4) }, changed: true });
  const noVerdict = nextRounds(capped, { at: RT(4), max: 3, counted: false, reset: 'r' });
  assert.deepEqual([noVerdict.doc.rounds, noVerdict.doc.at, noVerdict.doc.resets.length, noVerdict.round, noVerdict.changed], [0, [], 1, 0, true], 'a reset is recorded even when the round yields no verdict');
  assert.deepEqual(nextRounds({ ...reset.doc, from: 'rounds.json' }, { at: RT(5), max: 2, counted: true }).doc, { ...reset.doc, rounds: 2, max: 2, at: [RT(4), RT(5)] }, 'resets kept, max = this run\'s cap');
});

// ---- CLI over stub instruments (no browser, no network): the gate.test.mjs sandbox pattern — a realpath'd project
// with stardust/scripts/{replica,diff}, a git remote the site's code is pushed to, and a deploy ledger with contentSha.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-reuse-')));
const reuseRoot = join(base, 'site'); const replica = join(reuseRoot, 'stardust/scripts/replica'); const diffDir = join(reuseRoot, 'stardust/scripts/diff');
const COUNT = join(base, 'count.txt'); const REUSE_OUT = join(reuseRoot, 'stardust/replica/gates/all-1440');
mkdirSync(replica, { recursive: true }); mkdirSync(diffDir, { recursive: true });
cpSync(SCRIPT, join(replica, 'gate-all.mjs')); cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(replica, 'foundation-freeze.mjs'));
// gate-all takes the run anchor and the freshness rule from the diff dir's live-session.mjs (node: imports only).
cpSync([resolve(HERE, '../../../diff/scripts'), resolve(HERE, '../../diff')].map((x) => join(x, 'live-session.mjs')).find((x) => existsSync(x)), join(diffDir, 'live-session.mjs'));
// Every instrument appends one line to STUB_COUNT; pixel-compare fails the slugs listed in STUB_FAIL.
writeFileSync(join(replica, 'stitch-shot.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
appendFileSync(process.env.STUB_COUNT, 'STITCH ' + (url.startsWith('https://origin.test') ? 'origin' : 'eds') + '\\n');
writeFileSync(out, 'png');
${SHOT_RECORD("(url.startsWith('https://origin.test') ? 'ORIGIN' : 'EDS')")}`);
writeFileSync(join(replica, 'pixel-compare.mjs'), `import { appendFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
appendFileSync(process.env.STUB_COUNT, 'COMPARE\\n');
const pct = (process.env.STUB_FAIL || '').split(',').includes(basename(dirname(process.argv[2]))) ? 30 : 2;
console.log(JSON.stringify({ pct, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: pct <= 10, bands: [] }));`);
writeFileSync(join(diffDir, 'content-presence.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.STUB_COUNT, 'PROBE content\\n');
const a = process.argv; const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, origin: { clip }, eds: { clip }, totals: { missing: 0, hidden: 0, controlState: 0 }, scope: 'main' }));`);
writeFileSync(join(diffDir, 'clip-probe.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.STUB_COUNT, 'PROBE clip\\n');
const a = process.argv; writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ at: new Date().toISOString(), counts: { total: 0 }, groups: [] }));`);
writeFileSync(join(diffDir, 'unit-geometry.mjs'), `import { appendFileSync } from 'node:fs';
export function unitsFor() { return []; }
if (process.argv[1] && process.argv[1].endsWith('unit-geometry.mjs')) appendFileSync(process.env.STUB_COUNT, 'PROBE units\\n');`);
const put = (f, s) => { mkdirSync(dirname(join(reuseRoot, f)), { recursive: true }); writeFileSync(join(reuseRoot, f), s); };
put('.gitignore', 'stardust/\n'); put('head.html', '<script src="/scripts/scripts.js" type="module"></script>'); put('scripts/scripts.js', '// site');
put('styles/styles.css', 'body { margin: 0; }'); put('blocks/hero/hero.css', '.hero { color: red; }'); put('blocks/cards/cards.css', '.cards { gap: 1rem; }');
put('content/index.html', '<main><div><div class="hero"></div></div></main>'); put('content/about.html', '<main><div><div class="cards"></div></div></main>');
put('content/nav.html', '<main><div><p>nav</p></div></main>'); put('content/footer.html', '<main><div><p>footer</p></div></main>');
const sha = (f) => createHash('sha256').update(readFileSync(join(reuseRoot, f))).digest('hex');
put('content/.deploy-ledger.json', JSON.stringify(Object.fromEntries(['index', 'about', 'nav', 'footer'].map((n) => [`/${n}`, { status: 'live', ts: '2026-01-01T00:00:00.000Z', contentSha: sha(`content/${n}.html`), verifiedOn: 'org/site' }]))));
put('stardust/state.json', JSON.stringify({ pages: [
  { slug: 'home', url: 'https://origin.test/', liveUrl: 'https://main--site--org.aem.page/', status: 'deployed', template: 'home' },
  { slug: 'about', url: 'https://origin.test/about', liveUrl: 'https://main--site--org.aem.page/about', status: 'deployed', template: 'page' }] }));
const sh = (cwd, cmd, args) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
const git = (...args) => sh(reuseRoot, 'git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);
const CODE = ['.gitignore', 'head.html', 'scripts', 'styles', 'blocks', 'content'];
sh(reuseRoot, process.execPath, [join(replica, 'foundation-freeze.mjs'), 'freeze']);
// The remote's last two path segments are its <owner>/<repo> and the branch is main: the host main--site--org serves it.
mkdirSync(join(base, 'org')); sh(join(base, 'org'), 'git', ['init', '-q', '--bare', 'site.git']);
git('init', '-q'); git('symbolic-ref', 'HEAD', 'refs/heads/main'); git('add', '--', ...CODE); git('commit', '-qm', 'site');
git('remote', 'add', 'origin', join(base, 'org', 'site.git')); git('push', '-q', '-u', 'origin', 'HEAD');

const gateAll = (args = [], env = {}) => {
  writeFileSync(COUNT, '');
  const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), ...args], { cwd: reuseRoot, encoding: 'utf8', env: { ...process.env, STUB_COUNT: COUNT, STUB_FAIL: '', RUN_BG_DEADLINE_SEC: '', ...env } });
  const lines = readFileSync(COUNT, 'utf8').split('\n').filter(Boolean);
  const n = (f) => lines.filter(f).length;
  return { ...r, n: { origin: n((l) => l === 'STITCH origin'), eds: n((l) => l === 'STITCH eds'), probes: n((l) => l.startsWith('PROBE')), compares: n((l) => l === 'COMPARE') } };
};
const summary = () => JSON.parse(readFileSync(join(REUSE_OUT, 'summary.json'), 'utf8'));
const row = (s, slug) => s.rows.find((x) => x.slug === slug);
const pageFile = (slug, f) => join(REUSE_OUT, slug, f);
const storedKey = (slug) => JSON.parse(readFileSync(pageFile(slug, 'gate-key.json'), 'utf8')).gateKey;
// summary.json apart from the reuse fields and timestamps (§ 9 item 1: byte-identical apart from reused / at).
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['reused', 'reusedRows', 'reusedProbes', 'reuse', 'at', 'writtenAt'].includes(k) ? undefined : x)));
const HEX = /^[0-9a-f]{64}$/;

let r = gateAll([], { STUB_FAIL: 'about' });
const run1 = existsSync(join(REUSE_OUT, 'summary.json')) ? summary() : null;
check('run 1 (fresh): per page 2 stitches, 1 content probe, 1 compare; probes.json + gate-key.json; rows carry gateKey', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 2, eds: 2, probes: 2, compares: 2 });
  for (const slug of ['home', 'about']) { assert.ok(existsSync(pageFile(slug, 'probes.json')), slug); assert.match(storedKey(slug), HEX); assert.equal(row(run1, slug).gateKey, storedKey(slug)); assert.equal(row(run1, slug).reused, null); }
  assert.equal(row(run1, 'about').pass, false); assert.deepEqual(run1._provenance.reuse, { rows: 0, probes: 0 });
  for (const slug of ['home', 'about']) assert.equal(row(run1, slug).host, 'https://main--site--org.aem.page', slug);
});
// a table written before rows carried `host`: the reused PASS row takes the current host (its equal gate key proves it)
if (run1) { const legacy = JSON.parse(readFileSync(join(REUSE_OUT, 'summary.json'), 'utf8')); for (const x of legacy.rows) delete x.host; writeFileSync(join(REUSE_OUT, 'summary.json'), JSON.stringify(legacy, null, 2)); }
check('probes.json records the capture pair it was taken against (origin.json / eds.json at)', () => {
  const at = (slug, side) => JSON.parse(readFileSync(pageFile(slug, `${side}.json`), 'utf8')).at;
  for (const slug of ['home', 'about']) assert.deepEqual(JSON.parse(readFileSync(pageFile(slug, 'probes.json'), 'utf8')).pair, { origin: at(slug, 'origin'), eds: at(slug, 'eds') }, slug);
});
r = gateAll(['--skip-existing'], { STUB_FAIL: 'about' });
check('run 2 --skip-existing: the PASS row reused whole, the FAIL page re-compared on replayed probes — 0 stitches, 0 probes; summary.json equal apart from reused/at and the recorded origin reuse', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 1 });
  const s = summary();
  assert.deepEqual(row(s, 'home').reused, { what: 'row', from: 'summary.json', at: run1._provenance.writtenAt, gateKey: row(run1, 'home').gateKey });
  assert.equal(row(s, 'home').host, 'https://main--site--org.aem.page', 'a reused row from a table without host: the host its key proves');
  assert.equal(row(s, 'about').reused.what, 'probes'); assert.equal(s.totals.reusedRows, 1); assert.equal(s.totals.reusedProbes, 1);
  // the kept origin is a recorded reuse too (originReused, policy skip-existing) — the one other field that differs
  assert.equal(row(s, 'about').originReused.policy, 'skip-existing'); assert.equal(s.totals.originReused, 1);
  const own = (v) => { const c = strip(v); for (const x of c.rows) delete x.originReused; delete c.totals.originReused; return c; };
  assert.deepEqual(own(s), own(run1));
  assert.match(readFileSync(join(REUSE_OUT, 'summary.md'), 'utf8'), /· reused: 1 rows, 1 probe sets/);
});
r = gateAll(['--skip-existing', '--recapture-eds']);
const run3 = summary();
check('--recapture-eds: the EDS side only — EDS stitches + probes + compares, 0 origin stitches, no row reused', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.equal(run3.totals.reusedRows + run3.totals.reusedProbes, 0);
});
r = gateAll(['--skip-existing']);
check('a second --skip-existing run over all-PASS rows launches nothing: 0 stitches, 0 probes, 0 compares; summary.json equal apart from reused/at', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 0 });
  assert.equal(summary().totals.reusedRows, 2); assert.deepEqual(strip(summary()), strip(run3));
});
r = gateAll(['--compare-only', '--no-probes']);
check('--compare-only --no-probes: a pixel-only row never carries the full-criteria key', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  for (const slug of ['home', 'about']) assert.equal(row(summary(), slug).gateKey, null, slug);
});
r = gateAll(['--skip-existing']);
check('… so the next --skip-existing run reuses no row: it re-compares on replayed probes and keys the rows again', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  const s = summary(); assert.equal(s.totals.reusedRows, 0); assert.equal(s.totals.reusedProbes, 2); assert.equal(row(s, 'home').gateKey, storedKey('home'));
});
const keys4 = { home: storedKey('home'), about: storedKey('about') };
put('blocks/cards/cards.css', '.cards { gap: 2rem; }'); git('add', '--', 'blocks/cards/cards.css'); git('commit', '-qm', 'cards gap'); git('push', '-q');
r = gateAll(['--skip-existing']);
check('one byte in blocks/cards/cards.css, committed + pushed: that page re-shoots EDS + probes + compares under a new key, the other page is reused', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 1, probes: 1, compares: 1 });
  const s = summary();
  assert.equal(row(s, 'home').reused.what, 'row'); assert.equal(row(s, 'about').reused, null);
  assert.notEqual(storedKey('about'), keys4.about); assert.equal(row(s, 'about').gateKey, storedKey('about')); assert.equal(storedKey('home'), keys4.home);
});
put('blocks/cards/cards.css', '.cards { gap: 3rem; }');
r = gateAll(['--skip-existing']);
check('the same edit NOT pushed: every key is unknown (the reason names the file) — no row reused, every EDS side re-shot and re-probed (its gate-key.json recorded a proven key, now a different reason)', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — code differs from origin\/main \(not pushed, so not deployed\): blocks\/cards\/cards\.css/);
  const s = summary();
  assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0);
  for (const slug of ['home', 'about']) { assert.equal(row(s, slug).gateKey, null, 'evidence of an unproven build carries no key'); assert.equal(storedKey(slug), null); }
});
r = gateAll(['--skip-existing']);
check('… run again with nothing changed: the unknown-key captures are reused (same tree, reason, upstream commit and ledger rows), probes replayed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  assert.equal(summary().totals.reusedProbes, 2);
});
put('blocks/cards/cards.css', '.cards { gap: 4rem; }'); git('add', '--', 'blocks/cards/cards.css'); git('commit', '-qm', 'cards v1'); git('push', '-q');
put('blocks/cards/cards.css', '.cards { gap: 3rem; }');
r = gateAll(['--skip-existing']);
check('a push in between (v1 committed and pushed, v2 still dirty): the reason, tree and ledger rows read the same, the upstream commit moved — every EDS side re-shot', () => {
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — code differs from origin\/main \(not pushed, so not deployed\): blocks\/cards\/cards\.css \(/);
  assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
});
git('checkout', '--', 'blocks/cards/cards.css');
put('styles/styles.css', 'body { margin: 1px; }'); git('add', '--', 'styles/styles.css'); git('commit', '-qm', 'foundation request'); git('push', '-q');
r = gateAll(['--skip-existing']);
check('a frozen file edited after the freeze (pushed): every key unknown, yet the EDS side is re-shot and re-probed — no row reused, rows unkeyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — foundation changed since freeze/);
  const s = summary(); assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0);
  for (const slug of ['home', 'about']) { assert.equal(row(s, slug).gateKey, null); assert.equal(storedKey(slug), null); }
});
sh(reuseRoot, process.execPath, [join(replica, 'foundation-freeze.mjs'), 'freeze']);
r = gateAll(['--skip-existing']);
check('re-frozen: the new keys differ from the unknown ones the evidence was captured under — EDS re-shot once more, rows keyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  for (const slug of ['home', 'about']) { assert.match(storedKey(slug), HEX); assert.equal(row(summary(), slug).gateKey, storedKey(slug)); }
});
r = gateAll(['--skip-existing']);
check('… and the next run launches nothing', () => { assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 0 }); });
for (const slug of ['home', 'about']) for (const f of ['probes.json', 'gate-key.json']) unlinkSync(pageFile(slug, f));
const legacy = summary(); for (const x of legacy.rows) { delete x.gateKey; delete x.reused; } writeFileSync(join(REUSE_OUT, 'summary.json'), JSON.stringify(legacy, null, 2));
r = gateAll(['--skip-existing']);
check('a legacy gate dir (no probes.json / gate-key.json, rows without gateKey): nothing records what its EDS capture shows — re-shot and re-probed once, then keyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  const s = summary();
  assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0); assert.match(storedKey('home'), HEX); assert.equal(row(s, 'home').gateKey, storedKey('home'));
});
rmSync(base, { recursive: true, force: true });

// ---- origin reuse: the pure deciders, --origin-max-age, the pool budgets ----------------------------------
const DIFF = [resolve(HERE, '../../../diff/scripts'), resolve(HERE, '../../diff')].find((p) => existsSync(join(p, 'live-session.mjs')));
const { freshness } = await import(pathToFileURL(join(DIFF, 'live-session.mjs')).href);
const RUN = '2026-10-16T08:00:00.000Z'; const NOW = Date.parse('2026-10-16T09:00:00.000Z');
const U = 'https://www.example.com/'; const AT = '2026-10-16T08:30:00.000Z';
const ask = { stage: 'published', only: ['home'], recaptureEds: false, recaptureOrigin: false, url: U, width: 1440, vh: null };
const prev = { instrument: 'stitch-live', url: U, width: 1440, locale: 'en-US', vh: null, overlayLeft: null, at: AT };
const fr = (meta, o = {}) => freshness(meta, { runStart: RUN, maxAgeH: null, now: NOW, ...o });
check('originReusePlan: a fix round reuses this run\'s origin; stale, no anchor, --recapture-origin, other stage or a full round recapture', () => {
  assert.deepEqual(originReusePlan(ask, prev, fr(prev)), { reuse: true, why: 'same-run' });
  const old = { ...prev, at: '2026-10-16T07:00:00.000Z' };
  const stale = originReusePlan(ask, old, fr(old));
  assert.equal(stale.reuse, false); assert.match(stale.why, /captured before this run \(2026-10-16T08:00:00\.000Z\)/);
  const none = originReusePlan(ask, old, fr(old, { runStart: null }));
  assert.equal(none.reuse, false); assert.match(none.why, /no run anchor .*opt-in: --origin-max-age/);
  assert.deepEqual(originReusePlan(ask, old, fr(old, { runStart: null, maxAgeH: 6 })), { reuse: true, why: 'max-age 6h' });
  assert.equal(originReusePlan({ ...ask, recaptureOrigin: true }, prev, fr(prev)).reuse, false);
  assert.equal(originReusePlan({ ...ask, stage: 'prototype' }, prev, fr(prev)).reuse, false);
  assert.equal(originReusePlan({ ...ask, only: null }, prev, fr(prev)).reuse, false, 'a full round recaptures');
  assert.deepEqual(originReusePlan({ ...ask, only: null, recaptureEds: true }, prev, fr(prev)), { reuse: true, why: 'same-run' }, '--recapture-eds re-shoots the EDS side only');
  assert.equal(originReusePlan(ask, null, null).reuse, false);
});
check('originReusePlan: url / width / vh / locale mismatches and crawl / error origins are never reused; legacy metas without width read as the run\'s', () => {
  const no = (p) => assert.equal(originReusePlan(ask, p, fr(p)).reuse, false, JSON.stringify(p));
  no({ ...prev, url: 'https://www.example.com/other' }); no({ ...prev, width: 360 }); no({ ...prev, vh: 900 }); no({ ...prev, locale: 'de-DE' });
  no({ ...prev, instrument: 'crawl-fullpage', asymmetric: true }); no({ ...prev, error: 'stitch exit 1' }); no({ ...prev, instrument: 'none' });
  const legacy = { instrument: 'stitch-live', url: U, overlayLeft: null, at: AT };
  assert.equal(originReusePlan(ask, legacy, fr(legacy)).reuse, true);
  assert.equal(originReusePlan({ ...ask, vh: 900 }, legacy, fr(legacy)).reuse, false, 'a legacy capture had no --vh');
});
check('liveReusePlan: the archetype round\'s live.png is reused only when live.json matches every capture parameter of gate-all\'s own stitch and is fresh', () => {
  const live = { writtenBy: 'gate.sh', url: U, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: AT };
  const la = { stage: 'published', recaptureOrigin: false, url: U, width: 1440 };
  assert.deepEqual(liveReusePlan(la, live, fr(live)), { reuse: true, why: 'same-run' });
  assert.equal(liveReusePlan(la, null, null).reuse, false, 'a legacy live.png without live.json is never reused');
  assert.equal(liveReusePlan(la, { ...live, locale: null }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, dismiss: { off: true, consent: null, extra: null } }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, url: `${U}x` }, fr(live)).reuse, false); assert.equal(liveReusePlan(la, { ...live, width: 360 }, fr(live)).reuse, false);
  const old = { ...live, at: '2026-10-16T07:00:00.000Z' };
  assert.match(liveReusePlan(la, old, fr(old)).why, /captured before this run/);
  assert.equal(liveReusePlan({ ...la, recaptureOrigin: true }, live, fr(live)).reuse, false); assert.equal(liveReusePlan({ ...la, stage: 'prototype' }, live, fr(live)).reuse, false);
  // symmetric capture: --vh, settle, the dismissal set and the UA must be the ones gate-all's stitch would use
  assert.deepEqual(liveReusePlan({ ...la, vh: 1200 }, live, fr(live)), { reuse: false, why: '--vh set (live.png uses the default viewport)' });
  assert.equal(liveReusePlan({ ...la, vh: 1200 }, { ...live, vh: 1200 }, fr(live)).reuse, true);
  assert.equal(liveReusePlan(la, { ...live, vh: 1200 }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, settle: false }, fr(live)).reuse, false);
  assert.match(liveReusePlan(la, { ...live, dismiss: { off: false, consent: '#accept', extra: null } }, fr(live)).why, /consent/);
  assert.equal(liveReusePlan(la, { ...live, dismiss: { off: false, consent: null, extra: '.modal' } }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, ua: 'custom' }, fr(live)).reuse, false);
});
check('originReusePlan / liveReusePlan: a capture taken before the overlay-left check (no overlayLeft key) or one that left an overlay is never reused', () => {
  const unchecked = { ...prev }; delete unchecked.overlayLeft;
  assert.deepEqual(originReusePlan(ask, unchecked, fr(unchecked)), { reuse: false, why: 'previous origin predates the overlay-left check' });
  const left = { ...prev, overlayLeft: '#cmpbox (consent root visible)' };
  assert.deepEqual(originReusePlan(ask, left, fr(left)), { reuse: false, why: 'previous origin left an overlay (#cmpbox (consent root visible))' });
  const live = { writtenBy: 'gate.sh', url: U, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: AT };
  const la = { stage: 'published', recaptureOrigin: false, url: U, width: 1440 };
  const old = { ...live }; delete old.overlayLeft;
  assert.deepEqual(liveReusePlan(la, old, fr(old)), { reuse: false, why: 'live.png predates the overlay-left check' });
  assert.deepEqual(liveReusePlan(la, { ...live, overlayLeft: 'html (overflow:hidden)' }, fr(live)), { reuse: false, why: 'live.png left an overlay (html (overflow:hidden))' });
});
// ---- hide (F6): presence.json `hide` — the reuse deciders and the inputs / key a capture's list is part of -------------
const HL = ['.geo-bar', '.promo-strip'];
check('hide: originReusePlan / liveReusePlan refuse a capture taken hiding another list (absent = []), accept the same list', () => {
  const hid = { ...prev, hide: HL };
  assert.deepEqual(originReusePlan({ ...ask, hide: HL }, hid, fr(hid)), { reuse: true, why: 'same-run' });
  assert.deepEqual(originReusePlan({ ...ask, hide: [] }, prev, fr(prev)), { reuse: true, why: 'same-run' }, 'no list either side');
  assert.deepEqual(originReusePlan(ask, hid, fr(hid)), { reuse: false, why: 'hide list differs' }, 'taken hiding, this run hides nothing');
  assert.deepEqual(originReusePlan({ ...ask, hide: HL }, prev, fr(prev)), { reuse: false, why: 'hide list differs' }, 'a record without hide hid nothing');
  assert.equal(originReusePlan({ ...ask, hide: ['.geo-bar'] }, hid, fr(hid)).why, 'hide list differs', 'a shorter list');
  assert.equal(originReusePlan({ ...ask, hide: [...HL].reverse() }, hid, fr(hid)).why, 'hide list differs', 'another order');
  const live = { writtenBy: 'gate.sh', url: U, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: AT };
  const la = { stage: 'published', recaptureOrigin: false, url: U, width: 1440 };
  assert.deepEqual(liveReusePlan({ ...la, hide: HL }, { ...live, hide: HL }, fr(live)), { reuse: true, why: 'same-run' });
  assert.deepEqual(liveReusePlan(la, { ...live, hide: [] }, fr(live)), { reuse: true, why: 'same-run' }, 'gate.sh records [] for none');
  assert.deepEqual(liveReusePlan(la, { ...live, hide: ['.geo-bar'] }, fr(live)), { reuse: false, why: 'live.json hide list differs' });
  assert.deepEqual(liveReusePlan({ ...la, hide: HL }, live, fr(live)), { reuse: false, why: 'live.json hide list differs' }, 'a live.json without hide hid nothing');
  assert.equal(liveReusePlan({ ...la, hide: HL }, { ...live, hide: ['.geo-bar'] }, fr(live)).why, 'live.json hide list differs');
});
check('hide: probeInputs / gateKeyParts are unchanged without a list (old probes.json replays and keys hold) and carry a non-empty one — probes re-run, the key moves; skipCapture refuses a capture hideChanged names', () => {
  const opts = parseArgs(['node', 'x']); const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' };
  const ctx = { opts, edsUrl: (x) => x.liveUrl, presence: { home: { variable: ['.rail'] } }, unitsOf: () => [] };
  const legacy = probeInputs(page, ctx);
  assert.deepEqual(Object.keys(legacy), ['origin', 'eds', 'width', 'warmup', 'stage', 'content', 'clip', 'presence', 'units', 'unitTol']);
  assert.deepEqual(probeInputs(page, { ...ctx, hideOf: () => [] }), legacy, 'an empty list is no input');
  const hidden = probeInputs(page, { ...ctx, hideOf: () => HL }); assert.deepEqual(hidden, { ...legacy, hide: HL });
  const sidecar = (inputs) => ({ ...reuseArgs().sidecar, inputs });
  assert.equal(probeReuse(reuseArgs({ sidecar: sidecar(legacy), inputs: probeInputs(page, { ...ctx, hideOf: () => [] }) })).reuse, true, 'a probes.json from before replays');
  assert.match(probeReuse(reuseArgs({ sidecar: sidecar(legacy), inputs: hidden })).why, /probe inputs changed/);
  assert.match(probeReuse(reuseArgs({ sidecar: sidecar(hidden), inputs: probeInputs(page, { ...ctx, hideOf: () => ['.geo-bar'] }) })).why, /probe inputs changed/);
  const root = mkdtempSync(join(tmpdir(), 'gate-all-hide-key-'));
  mkdirSync(join(root, 'content')); writeFileSync(join(root, 'content/index.html'), '<main></main>');
  const parts = (c = {}) => gateKeyParts(page, { root, opts, instruments: 'i', ...c }).parts;
  assert.equal(gateKeyOf(parts({ hideOf: () => [] })), gateKeyOf(parts())); assert.equal('hide' in parts().build.sidecars, false);
  assert.deepEqual(parts({ hideOf: () => HL }).build.sidecars.hide, HL);
  assert.notEqual(gateKeyOf(parts({ hideOf: () => HL })), gateKeyOf(parts())); assert.notEqual(gateKeyOf(parts({ hideOf: () => HL })), gateKeyOf(parts({ hideOf: () => ['.geo-bar'] })));
  rmSync(root, { recursive: true, force: true });
  const cc = { opts: { skip: true }, has: () => true, keyChanged: () => false };
  assert.equal(skipCapture({}, 'origin', cc), true, 'no hideChanged: as before');
  assert.equal(skipCapture({}, 'origin', { ...cc, hideChanged: () => true }), false); assert.equal(skipCapture({}, 'eds', { ...cc, hideChanged: () => true }), false);
});
check('skipCapture: a capture ctx.unchecked names (a stitched record without an overlay-left record) is not reused on either side; without unchecked, as before', () => {
  const cc = { opts: { skip: true }, has: () => true, keyChanged: () => false };
  assert.equal(skipCapture({}, 'origin', { ...cc, unchecked: () => true }), false); assert.equal(skipCapture({}, 'eds', { ...cc, unchecked: () => true }), false);
  assert.equal(skipCapture({}, 'eds', { ...cc, unchecked: () => false }), true); assert.equal(skipCapture({}, 'origin', cc), true);
});
// ---- --dismiss: the extra overlay-dismiss selectors both stitches get — recorded, compared like a hide list --------------
const DL = ['.nl-close', '#promo-x'];
check('dismiss: parseArgs — one comma list (trimmed, de-duplicated; the last --dismiss wins, like gate.sh / anchor.mjs), [] by default; an empty list → exit 1, no value → exit 2 (a value flag without its value), before any I/O', () => {
  assert.deepEqual(parseArgs(['node', 'x']).dismiss, []);
  assert.deepEqual(parseArgs(['node', 'x', '--dismiss', ' .nl-close , #promo-x,,.nl-close']).dismiss, DL);
  assert.deepEqual(parseArgs(['node', 'x', '--dismiss', '.a', '--dismiss', '.b']).dismiss, ['.b']);
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-dismiss-')));
  for (const [argv, status, re] of [[['--dismiss'], 2, /^gate-all: --dismiss needs a value, got nothing$/m], [['--dismiss', '--only', 'a'], 2, /^gate-all: --dismiss needs a value, got "--only"$/m], [['--dismiss', ' , '], 1, /^--dismiss takes a list of overlay-dismiss selectors, <sel,…> \(got /]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd, encoding: 'utf8', env: { ...process.env, RUN_BG_DEADLINE_SEC: '' } });
    assert.equal(r.status, status, argv.join(' ')); assert.match(r.stderr, re, argv.join(' ')); assert.equal(r.stdout, '');
  }
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true, force: true });
});
check('dismiss: originReusePlan / liveReusePlan refuse a capture taken with another --dismiss list (absent = none; another order is another list), accept the same; live.json dismiss.extra is gate.sh\'s list; a site consent selector is still refused', () => {
  const kept = { ...prev, dismiss: DL };
  assert.deepEqual(originReusePlan({ ...ask, dismiss: DL }, kept, fr(kept)), { reuse: true, why: 'same-run' });
  assert.deepEqual(originReusePlan(ask, kept, fr(kept)), { reuse: false, why: 'dismiss list differs' }, 'taken with a list, this run has none');
  assert.deepEqual(originReusePlan({ ...ask, dismiss: DL }, prev, fr(prev)), { reuse: false, why: 'dismiss list differs' }, 'a record without dismiss dismissed no extra');
  assert.equal(originReusePlan({ ...ask, dismiss: [...DL].reverse() }, kept, fr(kept)).why, 'dismiss list differs');
  const live = { writtenBy: 'gate.sh', url: U, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: AT };
  const la = { stage: 'published', recaptureOrigin: false, url: U, width: 1440 }; const ex = (extra, consent = null) => ({ ...live, dismiss: { off: false, consent, extra } });
  assert.deepEqual(liveReusePlan({ ...la, dismiss: DL }, ex('.nl-close,#promo-x'), fr(live)), { reuse: true, why: 'same-run' });
  assert.deepEqual(liveReusePlan(la, ex('.nl-close'), fr(live)), { reuse: false, why: 'live.json dismiss list differs' });
  assert.deepEqual(liveReusePlan({ ...la, dismiss: DL }, ex(null), fr(live)), { reuse: false, why: 'live.json dismiss list differs' });
  assert.deepEqual(liveReusePlan({ ...la, dismiss: DL }, ex('.nl-close'), fr(live)), { reuse: false, why: 'live.json dismiss list differs' });
  assert.deepEqual(liveReusePlan(la, ex(null), fr(live)), { reuse: true, why: 'same-run' }, 'no list either side');
  assert.match(liveReusePlan({ ...la, dismiss: DL }, ex('.nl-close,#promo-x', '#accept'), fr(live)).why, /consent #accept/);
});
check('dismiss: probeInputs / gateKeyParts carry a non-empty list only (old probes.json replays and keys hold without one) — another list re-runs the probes and moves the key; skipCapture refuses a capture dismissChanged names', () => {
  const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' }; const opts = parseArgs(['node', 'x']); const withList = parseArgs(['node', 'x', '--dismiss', DL.join(',')]);
  const ctx = (o) => ({ opts: o, edsUrl: (x) => x.liveUrl, presence: {}, unitsOf: () => [] });
  const legacy = probeInputs(page, ctx(opts)); assert.equal('dismiss' in legacy, false);
  assert.deepEqual(probeInputs(page, ctx(withList)), { ...legacy, dismiss: DL });
  const sidecar = (inputs) => ({ ...reuseArgs().sidecar, inputs });
  assert.equal(probeReuse(reuseArgs({ sidecar: sidecar(legacy), inputs: probeInputs(page, ctx(opts)) })).reuse, true, 'a probes.json from before replays');
  assert.match(probeReuse(reuseArgs({ sidecar: sidecar(legacy), inputs: probeInputs(page, ctx(withList)) })).why, /probe inputs changed/);
  const root = mkdtempSync(join(tmpdir(), 'gate-all-dismiss-key-'));
  mkdirSync(join(root, 'content')); writeFileSync(join(root, 'content/index.html'), '<main></main>');
  const parts = (o) => gateKeyParts(page, { root, opts: o, instruments: 'i' }).parts;
  assert.equal('dismiss' in parts(opts).build.settings, false); assert.deepEqual(parts(withList).build.settings.dismiss, DL);
  assert.notEqual(gateKeyOf(parts(withList)), gateKeyOf(parts(opts))); assert.notEqual(gateKeyOf(parts(withList)), gateKeyOf(parts(parseArgs(['node', 'x', '--dismiss', '.nl-close']))));
  rmSync(root, { recursive: true, force: true });
  const cc = { opts: { skip: true }, has: () => true, keyChanged: () => false };
  assert.equal(skipCapture({}, 'origin', cc), true, 'no dismissChanged: as before');
  assert.equal(skipCapture({}, 'origin', { ...cc, dismissChanged: () => true }), false); assert.equal(skipCapture({}, 'eds', { ...cc, dismissChanged: () => true }), false);
});
check('parseArgs: --origin-max-age <h>; pools origin 2 / EDS 4 / probe 2 without a machine browser slot, explicit flags win; inside one (STARDUST_BROWSER_SLOT) the pools are clamped to STARDUST_BROWSERS_PER_SLOT (unset → 1, sequential)', () => {
  assert.equal(parseArgs(['node', 'x'], {}).originMaxAge, null); assert.equal(parseArgs(['node', 'x', '--origin-max-age', '6'], {}).originMaxAge, 6);
  const plain = parseArgs(['node', 'x'], {}); assert.deepEqual([plain.oc, plain.ec, plain.pc, plain.pools.perSlot], [2, 4, 2, null]);
  const held = parseArgs(['node', 'x'], { STARDUST_BROWSER_SLOT: '/locks/slot-1' }); assert.deepEqual([held.oc, held.ec, held.pc], [1, 1, 1]); assert.equal(held.browserSlot, true);
  assert.deepEqual([held.pools.sequential, held.pools.clampedFrom, held.pools.fallback], [true, { oc: 2, ec: 4, pc: 2 }, 'STARDUST_BROWSERS_PER_SLOT unset (an older run-bg) — 1 assumed']);
  const own = parseArgs(['node', 'x', '--eds-concurrency', '6', '--probe-concurrency', '4', '--origin-concurrency', '1'], {}); assert.deepEqual([own.oc, own.ec, own.pc], [1, 6, 4]);
  const ownHeld = parseArgs(['node', 'x', '--eds-concurrency', '6', '--probe-concurrency', '4', '--origin-concurrency', '1'], { STARDUST_BROWSER_SLOT: '/locks/slot-1', STARDUST_BROWSERS_PER_SLOT: '3' });
  assert.deepEqual([ownHeld.oc, ownHeld.ec, ownHeld.pc], [1, 2, 3], 'the lower origin flag stays, EDS takes the rest of 3, probe ≤ 3');
  for (const bad of ['x', '-1']) {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-all-maxage-'));
    const r = spawnSync(process.execPath, [SCRIPT, '--origin-max-age', bad], { cwd, encoding: 'utf8' });
    assert.equal(r.status, bad === '-1' ? 2 : 1, r.stderr); assert.match(r.stderr, /--origin-max-age/); assert.deepEqual(readdirSync(cwd), []);
    rmSync(cwd, { recursive: true, force: true });
  }
});
check('pool flags take integers >= 1: 0, 1.5 or x → usage exit 1 naming the flag; -2 or no value → a value flag without its value, exit 2; nothing written', () => {
  for (const [flag, bad] of [['--origin-concurrency', '0'], ['--probe-concurrency', '1.5'], ['--eds-concurrency', 'x']]) {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-all-pools-'));
    const r = spawnSync(process.execPath, [SCRIPT, flag, bad], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1, `${flag} ${bad}: ${r.stderr}`); assert.match(r.stderr, new RegExp(`^${flag} must be an integer >= 1 \\(got ${bad.replace('.', '\\.')}\\)`)); assert.deepEqual(readdirSync(cwd), []);
    rmSync(cwd, { recursive: true, force: true });
  }
  for (const [flag, bad] of [['--eds-concurrency', '-2'], ['--origin-concurrency', undefined]]) {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-all-pools-'));
    const r = spawnSync(process.execPath, [SCRIPT, flag, ...(bad === undefined ? [] : [bad])], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 2, `${flag} ${bad}: ${r.stderr}`); assert.match(r.stderr, new RegExp(`^gate-all: ${flag} needs a value, got ${bad === undefined ? 'nothing' : `"${bad}"`}$`, 'm')); assert.deepEqual(readdirSync(cwd), []);
    rmSync(cwd, { recursive: true, force: true });
  }
});
check('browserPools: no slot → the flags as given; per slot 1 → 1 / 1 / 1 sequential; 3 → 2 / 1 / 2; 2 → 1 / 1 / 2; 6 → 2 / 4 / 2 unchanged; a lower flag stays; junk → 1, named', () => {
  const D = { oc: 2, ec: 4, pc: 2 }; const slot = (n) => ({ STARDUST_BROWSER_SLOT: '/locks/slot-1', ...(n === undefined ? {} : { STARDUST_BROWSERS_PER_SLOT: n }) });
  assert.deepEqual(browserPools(D, {}), { ...D, perSlot: null, sequential: false, clampedFrom: null, fallback: null });
  assert.deepEqual(browserPools(D, { STARDUST_BROWSERS_PER_SLOT: '1' }), { ...D, perSlot: null, sequential: false, clampedFrom: null, fallback: null }, 'no slot env: the per-slot value is not read');
  assert.deepEqual(browserPools(D, slot('1')), { oc: 1, ec: 1, pc: 1, perSlot: 1, sequential: true, clampedFrom: D, fallback: null });
  assert.deepEqual(browserPools(D, slot('3')), { oc: 2, ec: 1, pc: 2, perSlot: 3, sequential: false, clampedFrom: D, fallback: null });
  assert.deepEqual(browserPools(D, slot('2')), { oc: 1, ec: 1, pc: 2, perSlot: 2, sequential: false, clampedFrom: D, fallback: null });
  assert.deepEqual(browserPools(D, slot('6')), { ...D, perSlot: 6, sequential: false, clampedFrom: null, fallback: null });
  assert.deepEqual(browserPools({ oc: 1, ec: 1, pc: 1 }, slot('3')), { oc: 1, ec: 1, pc: 1, perSlot: 3, sequential: false, clampedFrom: null, fallback: null }, 'lower flags stay');
  assert.deepEqual(browserPools({ oc: 1, ec: 6, pc: 4 }, slot('4')), { oc: 1, ec: 3, pc: 4, perSlot: 4, sequential: false, clampedFrom: { oc: 1, ec: 6, pc: 4 }, fallback: null });
  for (const [n, why] of [[undefined, 'STARDUST_BROWSERS_PER_SLOT unset (an older run-bg) — 1 assumed'], ['', 'STARDUST_BROWSERS_PER_SLOT unset (an older run-bg) — 1 assumed'], ['0', 'STARDUST_BROWSERS_PER_SLOT "0" is not a positive integer — 1 assumed'], ['2.5', 'STARDUST_BROWSERS_PER_SLOT "2.5" is not a positive integer — 1 assumed'], ['x', 'STARDUST_BROWSERS_PER_SLOT "x" is not a positive integer — 1 assumed']]) {
    assert.deepEqual(browserPools(D, slot(n)), { oc: 1, ec: 1, pc: 1, perSlot: 1, sequential: true, clampedFrom: D, fallback: why }, String(n));
  }
});

// ---- sandbox runner: the real gate-all with stub instruments (no browser, no network) -----------------------
// realpath: gate-all's main-module guard compares process.argv[1] with import.meta.url (macOS /var → /private/var).
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
const RS = join(root, 'stardust/scripts/replica'); const DS = join(root, 'stardust/scripts/diff');
mkdirSync(RS, { recursive: true }); cpSync(SCRIPT, join(RS, 'gate-all.mjs')); cpSync(DIFF, DS, { recursive: true });
const STITCH_LOG = join(root, 'stitch.log'); const CP_LOG = join(root, 'cp.log');
const stub = (dir, name, body) => writeFileSync(join(dir, name), `#!/usr/bin/env node\n${body}\n`);
// Each run of the gate / hgate / tgate helpers is its own fix-round scenario: the round counter's state in the given out
// dirs (runs/ and <slug>/rounds.json) is cleared first, so their repeated --only runs never meet the cap — the cap has its
// own scenarios (rounds 1-7: their own --out, never cleared, never a higher cap).
const clearRounds = (...outs) => {
  for (const out of outs.filter((o) => existsSync(o))) {
    rmSync(join(out, 'runs'), { recursive: true, force: true });
    for (const d of readdirSync(out, { withFileTypes: true }).filter((x) => x.isDirectory())) rmSync(join(out, d.name, 'rounds.json'), { force: true });
  }
};
// stitch-shot: one line per call (ORIGIN = the www.example.com side, EDS = anything else), writes a PNG stand-in and its
// --json record; STUB_ORIGIN_RC makes the origin capture fail with that exit code.
stub(RS, 'stitch-shot.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
  const side = /www\\.example\\.com/.test(process.argv[2]) ? 'ORIGIN' : 'EDS';
  appendFileSync(${JSON.stringify(STITCH_LOG)}, side + ' ' + process.argv.slice(2).join(' ') + '\\n');
  if (side === 'ORIGIN' && process.env.STUB_ORIGIN_RC) { console.error('stitch-shot error: stub exit ' + process.env.STUB_ORIGIN_RC); process.exit(Number(process.env.STUB_ORIGIN_RC)); }
  writeFileSync(process.argv[3], 'png');
  ${SHOT_RECORD('side')}`);
stub(RS, 'pixel-compare.mjs', `console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: true }));`);
// content-presence: records its argv, whether --origin-cache existed at start and the max-age env it inherited;
// writes the cache when absent (like the real probe) and a canned content.json.
stub(DS, 'content-presence.mjs', `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'; import { dirname } from 'node:path';
  const a = process.argv.slice(2); const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  const cache = val('--origin-cache'); const had = !!cache && existsSync(cache);
  appendFileSync(${JSON.stringify(CP_LOG)}, JSON.stringify({ argv: a, had, maxAge: process.env.STARDUST_ORIGIN_MAX_AGE_H || null }) + '\\n');
  if (cache && !had) { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ key: {}, at: new Date().toISOString(), data: {} })); }
  const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
  writeFileSync(val('--json'), JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, scope: 'root', totals: { missing: 0, hidden: 0, controlState: 0 }, eds: { clip }, origin: { clip }, textBoxes: { origin: [] } }));`);
const pages = [{ slug: 'home', url: 'https://www.example.com/', liveUrl: 'https://main--site--org.aem.live/', status: 'deployed', template: 'home', prototypePath: 'stardust/prototypes/home.html' },
  { slug: 'about', url: 'https://www.example.com/about', liveUrl: 'https://main--site--org.aem.live/about', status: 'deployed', template: 'page' }];
writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ pages }));
cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(RS, 'foundation-freeze.mjs')); // gate-all imports it (gate keys)
const LEDGER = join(root, 'stardust/status.jsonl');
const opener = (ts) => appendFileSync(LEDGER, `${JSON.stringify({ ts, skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' })}\n`);
opener(new Date(Date.now() - 60e3).toISOString());
const OUT = join(root, 'stardust/replica/gates/all-1440');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
const gate = (args, env = {}) => {
  for (const f of [STITCH_LOG, CP_LOG]) rmSync(f, { force: true });
  clearRounds(OUT, join(root, 'stardust/replica/gates/prototypes-1440'));
  const e = { ...process.env, ...env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, [join(RS, 'gate-all.mjs'), '--width', '1440', ...args], { cwd: root, env: e, encoding: 'utf8', timeout: 60e3 });
  const st = lines(STITCH_LOG); const run = (r.stdout.match(/run → (.*)/) || [])[1];
  const doc = (() => { try { return run ? read(run) : read('stardust/replica/gates/all-1440/summary.json'); } catch { return null; } })(); // read now: the next run clears runs/
  return { ...r, origin: st.filter((l) => l.startsWith('ORIGIN')).length, eds: st.filter((l) => l.startsWith('EDS')).length, cp: lines(CP_LOG).map((l) => JSON.parse(l)), row: (slug) => doc.rows.find((x) => x.slug === slug) };
};
const runLog = () => readFileSync(join(OUT, '_run.log'), 'utf8');
const presence = (slug) => `stardust/replica/gates/all-1440/${slug}/presence-origin.json`;
let homeAt = null;
check('deadline guard: RUN_BG_DEADLINE_SEC 49 s below the estimate (2 pages × 25 s) → exit 2, one stderr line "no verdict" naming the roster, the estimate, the deadline and --timeout 50; no out dir, no capture, nothing written', () => {
  const before = readdirSync(root, { recursive: true }).sort();
  const r = gate([], { RUN_BG_DEADLINE_SEC: '49' });
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.match(r.stderr, /no verdict/); assert.match(r.stderr, /2 page\(s\) × 1 width @1440 \(published\)/); assert.match(r.stderr, /estimated 50 s/); assert.match(r.stderr, /deadline of 49 s/); assert.match(r.stderr, /--timeout 50 /);
  assert.equal(r.origin + r.eds, 0); assert.equal(r.cp.length, 0); assert.equal(existsSync(OUT), false); assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
});
let first = null;
check('sandbox 1: a full round captures both sides of every page; origin.json records width, locale, vh, headed and at', () => {
  const r = gate([], { RUN_BG_DEADLINE_SEC: '50' }); first = r;
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 2); assert.equal(r.eds, 2);
  const m = read('stardust/replica/gates/all-1440/home/origin.json');
  assert.equal(m.width, 1440); assert.equal(m.locale, 'en-US'); assert.equal(m.vh, null); assert.equal(m.headed, true); assert.ok(m.at); assert.equal(m.reused, undefined);
  homeAt = m.at;
  assert.equal(r.row('home').originReused, null); assert.equal(read('stardust/replica/gates/all-1440/summary.json').totals.originReused, 0);
  assert.match(runLog(), /origin reuse: same run since .*; pools origin 2 \/ eds 4 \/ probe 2/);
  assert.ok(r.cp.every((c) => !c.had), 'a fresh origin capture is paired with a fresh presence inventory');
});
check('roster estimate: the run\'s first status line — stdout and _run.log — is the roster with its estimate (2 pages → 50 s), the run-bg deadline, its source (a state-only project: the state, 2 of 2 pages qualified) and the build host it measured (state liveUrl); a deadline equal to the estimate starts; every row carries host', () => {
  const want = /^\S+ roster: 2 page\(s\) × 1 width @1440 \(published\) — estimated 50 s \(25 s per page per width\); run-bg deadline 50 s; source: state stardust\/state\.json \(2 of 2 page\(s\) qualified\); build host https:\/\/main--site--org\.aem\.live \(state liveUrl\)$/;
  assert.equal(first.status, 0); assert.match(first.stdout.split('\n')[0], want); assert.match(runLog().split('\n')[0], want);
  assert.match(runLog().split('\n')[1], / origin reuse: /);
  assert.deepEqual(['home', 'about'].map((slug) => first.row(slug).host), ['https://main--site--org.aem.live', 'https://main--site--org.aem.live']);
});
check('coverage-only project (no state.json): the rollout coverage is the roster — the first status line names it and its qualified rows (before --only) and the build host (coverage deployedUrl — a rollout.json site.liveHost does not move it), a gate-failed row is re-gated against its deployedUrl, the row path / template / host from the coverage; a state.json that does not parse beside it → one stderr note, the run goes on', () => {
  const croot = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-cov-'))); mkdirSync(join(croot, 'stardust/rollout/coverage'), { recursive: true });
  writeFileSync(join(croot, COV_PATH), JSON.stringify(COV));
  // a rollout.json naming a live host does not move the default: the build is the coverage deployedUrl as recorded
  writeFileSync(join(croot, 'stardust/rollout/rollout.json'), JSON.stringify({ site: { liveHost: 'main--site--org.aem.live' } }));
  const cgate = () => {
    rmSync(STITCH_LOG, { force: true }); const e = { ...process.env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) delete e[k];
    const r = spawnSync(process.execPath, [join(RS, 'gate-all.mjs'), '--width', '1440', '--only', 'c'], { cwd: croot, env: e, encoding: 'utf8', timeout: 60e3 });
    return { ...r, run: JSON.parse(readFileSync(join(croot, r.stdout.match(/run → (.*)/)[1]), 'utf8')), log: readFileSync(join(croot, 'stardust/replica/gates/all-1440/_run.log'), 'utf8').trim().split('\n') };
  };
  const want = /^\S+ roster: 1 page\(s\) × 1 width @1440 \(published\) — estimated 25 s \(25 s per page per width\); source: coverage stardust\/rollout\/coverage\/pages\.json \(3 of 6 row\(s\) qualified\); build host https:\/\/main--site--org\.aem\.page \(coverage deployedUrl\)$/;
  const r = cgate();
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout.split('\n')[0], want); assert.match(r.log[0], want);
  assert.deepEqual(lines(STITCH_LOG).map((l) => l.split(' ').slice(0, 2).join(' ')).sort(), ['EDS https://main--site--org.aem.page/c', 'ORIGIN https://www.example.com/c']);
  const row = r.run.rows.find((x) => x.slug === 'c'); assert.deepEqual([r.run.rows.length, row.path, row.template, row.pass, row.host], [1, '/c', 'page', true, 'https://main--site--org.aem.page']);
  assert.equal(existsSync(join(croot, 'stardust/state.json')), false);
  writeFileSync(join(croot, 'stardust/state.json'), '{');
  const m = cgate();
  assert.equal(m.status, 0, m.stderr + m.stdout); assert.match(m.stdout.split('\n')[0], want);
  assert.equal(m.stderr.split('\n').filter((l) => l.startsWith('gate-all: ')).length, 1, m.stderr);
  assert.match(m.stderr, /^gate-all: stardust\/state\.json unreadable \(.+\) — roster from coverage without state enrichment$/m);
  rmSync(croot, { recursive: true, force: true });
});
check('--eds-host in the sandbox: a bare host and its https://<host>/ form both stitch and probe https://<host><path> and record the origin as _provenance.edsHostOverride and the row host; the first status line names it (--eds-host); a later --compare-only without it keeps the row host its pixels came from (the eds.json url)', () => {
  const eroot = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-eds-'))); mkdirSync(join(eroot, 'stardust'));
  writeFileSync(join(eroot, 'stardust/state.json'), JSON.stringify({ pages: [pages[1]] }));
  const host = 'fix-x--site--org.aem.page';
  for (const flag of [host, `https://${host}/`]) {
    for (const f of [STITCH_LOG, CP_LOG]) rmSync(f, { force: true });
    const e = { ...process.env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) delete e[k];
    const r = spawnSync(process.execPath, [join(RS, 'gate-all.mjs'), '--width', '1440', '--eds-host', flag], { cwd: eroot, env: e, encoding: 'utf8', timeout: 60e3 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(lines(STITCH_LOG).filter((l) => l.startsWith('EDS ')).map((l) => l.split(' ')[1]), [`https://${host}/about`], flag);
    assert.deepEqual(lines(CP_LOG).map((l) => JSON.parse(l).argv[1]), [`https://${host}/about`], flag);
    const { _provenance: pv, rows } = JSON.parse(readFileSync(join(eroot, 'stardust/replica/gates/all-1440/summary.json'), 'utf8'));
    assert.deepEqual([pv.edsHostOverride, pv.eds, rows[0].host], [`https://${host}`, `https://${host}`, `https://${host}`], flag);
    assert.match(r.stdout.split('\n')[0], new RegExp(`; source: state stardust/state\\.json \\(1 of 1 page\\(s\\) qualified\\); build host https://${host.replace(/\./g, '\\.')} \\(--eds-host\\)$`), flag);
  }
  // --compare-only without --eds-host recomputes the pixels of that capture: the row names the host they came from
  // (eds.json url), not the roster's — the status line still names what this run would measure
  const e = { ...process.env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) delete e[k];
  const c = spawnSync(process.execPath, [join(RS, 'gate-all.mjs'), '--width', '1440', '--compare-only'], { cwd: eroot, env: e, encoding: 'utf8', timeout: 60e3 });
  assert.equal(c.status, 0, c.stderr + c.stdout);
  const cs = JSON.parse(readFileSync(join(eroot, 'stardust/replica/gates/all-1440/summary.json'), 'utf8'));
  assert.deepEqual([cs._provenance.edsHostOverride, cs.rows[0].host], [null, `https://${host}`]);
  assert.match(c.stdout.split('\n')[0], /; build host https:\/\/main--site--org\.aem\.live \(state liveUrl\)$/);
  rmSync(eroot, { recursive: true, force: true });
});
check('pools inside a machine browser slot: per slot 1 → _run.log names 1 / 1 / 1 clamped from 2/4/2, sequential, and every ORIGIN capture precedes every EDS one; the estimate × 4 in the status line and the deadline guard; per slot 3 → 2 / 1 / 2, not sequential, the estimate × 1', () => {
  const slot = { STARDUST_BROWSER_SLOT: join(root, 'slot-1.json') };
  const one = gate(['--out', 'stardust/replica/gates/pools1-1440'], { ...slot, STARDUST_BROWSERS_PER_SLOT: '1' });
  assert.equal(one.status, 0, one.stderr + one.stdout); assert.equal(one.origin, 2); assert.equal(one.eds, 2);
  assert.deepEqual(lines(STITCH_LOG).map((l) => l.split(' ')[0]), ['ORIGIN', 'ORIGIN', 'EDS', 'EDS'], 'the origin pool, then the EDS pool');
  const log1 = readFileSync(join(root, 'stardust/replica/gates/pools1-1440/_run.log'), 'utf8');
  assert.match(log1, /; pools origin 1 \/ eds 1 \/ probe 1 \(machine browser slot held; 1 browser\(s\) per slot — clamped from 2\/4\/2; capture pools sequential\)$/m);
  // the estimate follows the pools: × 4 at one browser per slot — in the status line and the deadline guard
  const est4 = /^\S+ roster: 2 page\(s\) × 1 width @1440 \(published\) — estimated 200 s \(25 s per page per width × 4: 1 browser per slot, captures sequential\); source: state /;
  assert.match(one.stdout.split('\n')[0], est4); assert.match(log1.split('\n')[0], est4);
  const short = gate(['--out', 'stardust/replica/gates/pools1d-1440'], { ...slot, STARDUST_BROWSERS_PER_SLOT: '1', RUN_BG_DEADLINE_SEC: '120' });
  assert.equal(short.status, 2, short.stderr + short.stdout); assert.equal(short.stdout, ''); assert.equal(short.origin + short.eds, 0);
  assert.match(short.stderr, /^gate-all: refused to start, no verdict — 2 page\(s\) × 1 width @1440 \(published\) need an estimated 200 s \(25 s per page per width × 4: 1 browser per slot, captures sequential\), above this job's run-bg deadline of 120 s .*--timeout 200 /);
  assert.equal(existsSync(join(root, 'stardust/replica/gates/pools1d-1440')), false, 'a deadline between the unclamped (50 s) and the clamped (200 s) estimate is refused before the out dir');
  const three = gate(['--out', 'stardust/replica/gates/pools3-1440'], { ...slot, STARDUST_BROWSERS_PER_SLOT: '3' });
  assert.equal(three.status, 0, three.stderr + three.stdout); assert.equal(three.origin + three.eds, 4);
  assert.match(readFileSync(join(root, 'stardust/replica/gates/pools3-1440/_run.log'), 'utf8'), /; pools origin 2 \/ eds 1 \/ probe 2 \(machine browser slot held; 3 browser\(s\) per slot — clamped from 2\/4\/2\)$/m);
  assert.match(three.stdout.split('\n')[0], / — estimated 50 s \(25 s per page per width\); source: /, 'per slot 3 keeps the origin pool at 2: × 1, the text as before');
  for (const d of ['pools1-1440', 'pools3-1440']) rmSync(join(root, 'stardust/replica/gates', d), { recursive: true, force: true });
});
check('sandbox 2: --only home is a fix round — 0 origin navigations, the row / origin.json / _run.log record the reuse, presence cache passed; a held browser slot without a per-slot value (an older run-bg) → pools 1 / 1 / 1, named', () => {
  const r = gate(['--only', 'home'], { STARDUST_BROWSER_SLOT: join(root, 'slot-1.json') });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 1);
  assert.match(runLog(), /; pools origin 1 \/ eds 1 \/ probe 1 \(machine browser slot held; 1 browser\(s\) per slot \(STARDUST_BROWSERS_PER_SLOT unset \(an older run-bg\) — 1 assumed\) — clamped from 2\/4\/2; capture pools sequential\)$/m);
  assert.deepEqual(r.row('home').originReused, { from: 'stardust/replica/gates/all-1440/home/origin.png', at: homeAt, policy: 'same-run', stale: null });
  const m = read('stardust/replica/gates/all-1440/home/origin.json');
  assert.equal(m.at, homeAt, 'the capture time is kept'); assert.ok(m.reusedAt >= homeAt); assert.equal(m.reused, true); assert.equal(m.policy, 'same-run');
  assert.match(runLog(), /origin home → reused stardust\/replica\/gates\/all-1440\/home\/origin\.png \(captured .*; same-run\)/);
  assert.equal(r.cp.length, 1); const a = r.cp[0].argv; assert.equal(a[a.indexOf('--origin-cache') + 1], presence('home')); assert.equal(r.cp[0].had, true);
});
check('sandbox 3: a new run (new A-inventory start) recaptures the origin once and drops its presence inventory', () => {
  opener(new Date().toISOString());
  const r = gate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 1); assert.equal(r.eds, 1);
  assert.match(runLog(), /origin home → not reused \(captured before this run/); assert.equal(r.cp[0].had, false);
  assert.equal(r.row('home').originReused, null); assert.notEqual(read('stardust/replica/gates/all-1440/home/origin.json').at, homeAt);
  assert.equal(gate(['--only', 'home']).origin, 0, 'the next fix round of the new run reuses again');
});
check('sandbox 4: --recapture-origin re-shoots a fresh origin', () => {
  const r = gate(['--only', 'home', '--recapture-origin']);
  assert.equal(r.origin, 1); assert.equal(r.row('home').originReused, null);
});
check('sandbox 5: without a ledger reuse is opt-in — STARDUST_ORIGIN_MAX_AGE_H or --origin-max-age (passed on to the probes); neither → recapture', () => {
  renameSync(LEDGER, `${LEDGER}.off`);
  try {
    const env = gate(['--only', 'home'], { STARDUST_ORIGIN_MAX_AGE_H: '6' });
    assert.equal(env.origin, 0); assert.equal(env.row('home').originReused.policy, 'max-age 6h');
    const flag = gate(['--only', 'home', '--origin-max-age', '6']);
    assert.equal(flag.origin, 0); assert.equal(flag.row('home').originReused.policy, 'max-age 6h'); assert.equal(flag.cp[0].maxAge, '6');
    assert.match(runLog(), /origin reuse: no run anchor/);
    const off = gate(['--only', 'home']);
    assert.equal(off.origin, 1); assert.match(runLog(), /not reused \(no run anchor/);
  } finally { renameSync(`${LEDGER}.off`, LEDGER); }
});
check('sandbox 6: the published stage reuses the archetype round\'s fresh live.png when live.json matches; locale null → stitched', () => {
  const g = join(root, 'stardust/replica/gates/about-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  opener(new Date().toISOString());
  const liveAt = new Date().toISOString();
  const live = { writtenBy: 'gate.sh', url: 'https://www.example.com/about', width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: liveAt };
  writeFileSync(join(g, 'live.json'), JSON.stringify(live));
  const r = gate(['--only', 'about']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 1);
  assert.deepEqual(r.row('about').originReused, { from: 'stardust/replica/gates/about-1440/live.png', at: liveAt, policy: 'same-run', stale: null });
  const m = read('stardust/replica/gates/all-1440/about/origin.json'); assert.equal(m.headed, false); assert.equal(m.locale, 'en-US'); assert.equal(m.url, live.url);
  const vh = gate(['--only', 'about', '--vh', '1200']);
  assert.equal(vh.origin, 1, 'a --vh round never takes the default-viewport live.png'); assert.match(runLog(), /origin about → live\.png not reused \(--vh set/);
  writeFileSync(join(g, 'live.json'), JSON.stringify({ ...live, locale: null }));
  opener(new Date().toISOString());
  assert.equal(gate(['--only', 'about']).origin, 1);
});
check('sandbox 7: --skip-existing keeps a stale origin (never a recapture) but records it: policy skip-existing + stale, a WARN line', () => {
  opener(new Date().toISOString());
  const r = gate(['--only', 'home', '--skip-existing']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0);
  assert.equal(r.eds, 1, 'the sandbox has no content/index.html, so no gate-key.json proves the EDS capture: re-shot');
  const o = r.row('home').originReused; assert.equal(o.policy, 'skip-existing'); assert.match(o.stale, /captured before this run/);
  assert.match(runLog(), /origin home → reused \(--skip-existing\) WARN captured before this run/);
  assert.equal(read('stardust/replica/gates/all-1440/home/origin.json').policy, 'skip-existing');
});
check('sandbox 8: the prototype stage records the archetype round\'s live.png as a reuse with its capture time (live.json), stale when it predates the run; a live.png whose live.json has no overlay-left record (or none at all) or names an overlay left is stitched instead', () => {
  const g = join(root, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  const args = ['--stage', 'prototype', '--proto-base', 'http://localhost:9', '--no-probes'];
  const row = () => read('stardust/replica/gates/prototypes-1440/summary.json').rows.find((x) => x.slug === 'home');
  const protoLog = () => readFileSync(join(root, 'stardust/replica/gates/prototypes-1440/_run.log'), 'utf8');
  const oldAt = new Date(Date.now() - 3600e3).toISOString();
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, overlayLeft: null, at: oldAt }));
  const r = gate(args);
  assert.equal(r.origin, 0, r.stderr + r.stdout);
  const o = row().originReused; assert.equal(o.from, 'stardust/replica/gates/home-1440/live.png'); assert.equal(o.at, oldAt); assert.equal(o.policy, 'prototype-stage'); assert.match(o.stale, /captured before this run/);
  assert.equal(read('stardust/replica/gates/prototypes-1440/home/origin.json').at, oldAt); assert.equal(read('stardust/replica/gates/prototypes-1440/home/origin.json').overlayLeft, null);
  assert.match(protoLog(), /origin home → stitch-live reused .*prototype-stage\) WARN captured before this run/);
  const nowAt = new Date().toISOString(); writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, overlayLeft: null, at: nowAt }));
  gate(args); assert.deepEqual(row().originReused, { from: 'stardust/replica/gates/home-1440/live.png', at: nowAt, policy: 'prototype-stage', stale: null });
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, at: nowAt }));
  assert.equal(gate(args).origin, 1); assert.match(protoLog(), /origin home → live\.png not reused \(live\.png predates the overlay-left check\)/);
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, overlayLeft: '#cmpbox (consent root visible)', at: nowAt }));
  assert.equal(gate(args).origin, 1); assert.match(protoLog(), /origin home → live\.png not reused \(live\.png left an overlay \(#cmpbox \(consent root visible\)\)\)/);
  rmSync(join(g, 'live.json'));
  assert.equal(gate(args).origin, 1, 'no live.json: no record of the check'); assert.equal(row().originReused, null);
});
check('sandbox 9: a failed --recapture-origin keeps the previous origin AND says so — policy recapture-failed + stale when it predates the run, a WARN line, the presence inventory stays with it', () => {
  assert.equal(gate(['--only', 'home', '--recapture-origin']).origin, 1);
  const reused = gate(['--only', 'home']); assert.equal(reused.row('home').originReused.policy, 'same-run', 'origin.json now holds a same-run reuse record');
  const at = read('stardust/replica/gates/all-1440/home/origin.json').at;
  opener(new Date().toISOString());
  const a = gate(['--only', 'home', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.origin, 1);
  const ra = a.row('home').originReused; assert.equal(ra.policy, 'recapture-failed'); assert.equal(ra.at, at); assert.match(ra.stale, /captured before this run/);
  assert.match(runLog(), /origin home → stitch-live reused .*origin\.png \(captured .*; recapture-failed\) WARN re-shoot failed \(exit 1: .*\) — previous origin kept; captured before this run/);
  assert.equal(a.cp[0].had, true, 'the kept origin keeps its presence inventory (the probe judges its freshness)');
  assert.equal(gate(['--only', 'home', '--recapture-origin']).origin, 1);
  const b = gate(['--only', 'home', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.deepEqual(b.row('home').originReused, { from: 'stardust/replica/gates/all-1440/home/origin.png', at: read('stardust/replica/gates/all-1440/home/origin.json').at, policy: 'same-run', stale: null }, 'a kept plain capture is a recorded reuse, never silent');
  assert.match(runLog(), /same-run\) WARN re-shoot failed/); assert.equal(b.cp[0].had, true);
});
// ---- --one-load (C8): one navigation per side — the pure deciders, then the same sandbox ----------------------------
const invMeta = { instrument: 'stitch-live', headed: true, inventory: 'origin-inventory.json', inventoryAt: AT };
const invFile = { url: U, at: AT, items: [], spec: { presence: { rootSel: null, variableSels: [] }, clip: { minCut: 2 }, units: null } };
check('inventoryWhy: only the inventory taken with this very capture, of this URL, with this run\'s blocks, stands in for the probes', () => {
  const want = { presence: { rootSel: null, variableSels: [] }, clip: { minCut: 2 }, units: null };
  assert.equal(inventoryWhy(invMeta, invFile, U, want), null);
  assert.equal(inventoryWhy(invMeta, invFile, U, { ...want, presence: null }), null, 'a block this run does not need is not compared');
  const table = [
    ['no capture', null, invFile, /^no capture$/], ['failed capture', { error: 'stitch exit 3' }, invFile, /capture failed: stitch exit 3/],
    ['crawl shot', { instrument: 'crawl-fullpage' }, invFile, /crawl-fullpage capture/], ['legacy capture', { instrument: 'stitch-live', headed: true }, invFile, /captured without one/],
    ['not taken', { instrument: 'stitch-live', inventoryError: 'origin-inventory.json not written' }, invFile, /not taken: origin-inventory\.json not written/],
    ['file gone', invMeta, null, /origin-inventory\.json missing/], ['inventory error', invMeta, { ...invFile, error: 'page crashed' }, /inventory failed: page crashed/],
    ['another capture\'s inventory', invMeta, { ...invFile, at: '2026-10-16T08:31:00.000Z' }, /not the one taken with this capture/],
    ['another url', invMeta, { ...invFile, url: `${U}x` }, /taken of /], ['other presence settings', invMeta, { ...invFile, spec: { ...invFile.spec, presence: { rootSel: 'main', variableSels: [] } } }, /other presence settings/],
  ];
  for (const [name, m, inv, re] of table) assert.match(String(inventoryWhy(m, inv, U, want)), re, name);
  assert.match(inventoryWhy(invMeta, invFile, U, { ...want, units: { sels: ['.card'], n: 2 } }), /other units settings/, 'units declared since the capture');
});
check('oneLoadKeep: under --one-load a kept origin must be headed real Chrome with its inventory; a refused plan stays refused', () => {
  const plan = { reuse: true, why: 'same-run' };
  assert.deepEqual(oneLoadKeep(plan, invMeta, null), plan);
  assert.deepEqual(oneLoadKeep({ reuse: false, why: 'full round' }, invMeta, 'x'), { reuse: false, why: 'full round' });
  assert.match(oneLoadKeep(plan, { headed: false }, null).why, /^one-load: not a headed real-Chrome capture \(headed: false\)/);
  assert.match(oneLoadKeep(plan, invMeta, 'captured without one').why, /^one-load: no inventory \(captured without one\)/);
  assert.equal(parseArgs(['n', 'x', '--one-load']).oneLoad, true); assert.ok(!parseArgs(['n', 'x']).oneLoad, 'opt-in');
});
// The sandbox's diff modules become importable stubs (gate-all loads the report builders in-process under --one-load);
// the stitch stub writes a canned inventory to the spec's `out` when given --inventory; a units family on home.
const UG_LOG = join(root, 'ug.log');
cpSync(join(DIFF, 'content-presence.mjs'), join(DS, 'content-presence-real.mjs')); cpSync(join(DIFF, 'unit-geometry.mjs'), join(DS, 'unit-geometry-real.mjs'));
stub(DS, 'content-presence.mjs', `export * from './content-presence-real.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; import { dirname } from 'node:path';
if (process.argv[1] && process.argv[1].endsWith('content-presence.mjs')) {
  const a = process.argv.slice(2); const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  const cache = val('--origin-cache'); const had = !!cache && existsSync(cache);
  appendFileSync(${JSON.stringify(CP_LOG)}, JSON.stringify({ argv: a, had, maxAge: process.env.STARDUST_ORIGIN_MAX_AGE_H || null }) + '\\n');
  if (cache && !had) { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ key: {}, at: new Date().toISOString(), data: {} })); }
  const originCache = had ? { file: cache, at: JSON.parse(readFileSync(cache, 'utf8')).at, policy: 'same-run' } : null;
  const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
  writeFileSync(val('--json'), JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome', originCache }, totals: { missing: 0, hidden: 0, controlState: 0 }, eds: { clip }, origin: { clip }, textBoxes: { origin: [] } }));
}`);
stub(DS, 'unit-geometry.mjs', `export * from './unit-geometry-real.mjs';
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.argv[1] && process.argv[1].endsWith('unit-geometry.mjs')) {
  const a = process.argv.slice(2); appendFileSync(${JSON.stringify(UG_LOG)}, a.join(' ') + '\\n');
  const at = new Date().toISOString(); const val = (f) => a[a.indexOf(f) + 1];
  // like the real probe's units.json: originCache { file, hit, at, … } — STUB_UG_HIT = the cached inventory's time
  const file = 'stardust/current/measure/' + val('--slug') + '-units-' + val('--width') + '.json';
  const originCache = process.env.STUB_UG_HIT ? { file, hit: true, at: process.env.STUB_UG_HIT, policy: 'same-run' } : { file, hit: false, at, reason: 'stub: measured' };
  writeFileSync(val('--json'), JSON.stringify({ _provenance: { at, tier: 'chrome' }, originCache, results: [], verdict: { units: 1, within: 1, off: 0, hidden: 0, missing: 0, errors: 0, requiredOff: 0 } }));
}`);
stub(RS, 'stitch-shot.mjs', `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
  const a = process.argv.slice(2); const side = /www\\.example\\.com/.test(a[0]) ? 'ORIGIN' : 'EDS';
  appendFileSync(${JSON.stringify(STITCH_LOG)}, side + ' ' + a.join(' ') + '\\n');
  if (side === 'ORIGIN' && process.env.STUB_ORIGIN_RC) { console.error('stitch-shot error: stub exit ' + process.env.STUB_ORIGIN_RC); process.exit(Number(process.env.STUB_ORIGIN_RC)); }
  if (a.includes('--inventory')) {
    const spec = JSON.parse(readFileSync(a[a.indexOf('--inventory') + 1], 'utf8'));
    const item = (kind, text, y, extra = {}) => ({ kind, text, y, x: 0, w: 100, h: 20, state: 'visible', variable: false, inRoot: true, inChrome: false, path: 'main > p', ...extra });
    const items = [item('heading', 'Offers', 10, { level: 1 }), item('text', 'Weekly offers for every store', 40), item('link', 'All offers', 70, { href: '/a' })];
    if (side === 'EDS') items.push(item('link', 'Newsroom', 100, { href: '/n' }));
    const unit = { index: 0, path: 'div.card', rect: { x: 0, y: 200, w: 300, h: 200 }, elements: [{ role: 'heading', tag: 'h3', sel: 'h3', text: 'card', x: 10, y: 10, w: 100, h: 20, absY: 210, hidden: false, fs: 16, lh: 20, fw: '700' }] };
    const units = spec.units ? { n: spec.units.n, bySel: Object.fromEntries(spec.units.sels.map((s) => [s, { sel: s, matches: 1, visibleMatches: 1, units: [unit] }])) } : undefined;
    writeFileSync(spec.out, JSON.stringify({ url: a[0], side: spec.side, at: new Date().toISOString(), docH: 3000, tier: 'chrome', settle: 'stitch', status: null, settlePasses: null, pageW: 1440, root: 'main', items,
      clip: { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [], findings: [] }, textBoxes: [{ x: 0, y: 40, w: 100, h: 20 }], units, spec: { presence: spec.presence, clip: spec.clip, units: spec.units } }));
  }
  writeFileSync(a[1], 'png');
  ${SHOT_RECORD('side')}`);
writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ cards: { origin: '.card', build: '.card', n: 2, pages: ['home'] } }));
mkdirSync(join(root, 'stardust/current/assets/screenshots'), { recursive: true }); writeFileSync(join(root, 'stardust/current/assets/screenshots/about.png'), 'png');
const olGate = (args, env) => { rmSync(UG_LOG, { force: true }); const g = gate(args, env); const st = lines(STITCH_LOG); return { ...g, ug: lines(UG_LOG).length, argv: (s) => st.filter((l) => l.startsWith(s)) }; };
const pageJson = (slug, f) => read(`stardust/replica/gates/all-1440/${slug}/${f}`);
let olOriginAt = null;
check('one-load 1: a full --one-load round — one stitch per side per page (both --headed --inventory), 0 content-presence / unit-geometry spawns, content.json / clip.json / text-boxes.json / units.json from the inventories', () => {
  const r = olGate(['--one-load']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 2); assert.equal(r.eds, 2); assert.equal(r.cp.length, 0); assert.equal(r.ug, 0);
  for (const l of [...r.argv('ORIGIN'), ...r.argv('EDS')]) { assert.match(l, / --headed/); assert.match(l, / --inventory \S+-inventory\.spec\.json/); }
  const c = pageJson('home', 'content.json');
  assert.equal(c._provenance.via, 'one-load'); assert.equal(c._provenance.tier, 'chrome'); assert.equal(c.origin.settle, 'stitch');
  assert.equal(c.totals.missing, 0); assert.equal(c.totals.hidden, 0); assert.equal(c.totals.extraLinks, 1, 'the served-only link');
  assert.equal(pageJson('home', 'clip.json').source, 'content-presence'); assert.deepEqual(pageJson('home', 'text-boxes.json'), { side: 'origin', boxes: [{ x: 0, y: 40, w: 100, h: 20 }] });
  const u = pageJson('home', 'units.json'); assert.equal(u._provenance.writtenBy, 'unit-geometry.mjs'); assert.equal(u.verdict.units, 1); assert.equal(u.results[0].sel, '.card=.card');
  const o = pageJson('home', 'origin.json'); const e = pageJson('home', 'eds.json');
  assert.equal(o.headed, true); assert.equal(o.inventory, 'origin-inventory.json'); assert.equal(o.inventoryAt, pageJson('home', 'origin-inventory.json').at);
  assert.equal(e.headed, true); assert.equal(e.inventory, 'eds-inventory.json');
  olOriginAt = o.inventoryAt;
  const row = r.row('home'); assert.equal(row.oneLoad.via, 'one-load'); assert.equal(row.oneLoad.origin, olOriginAt); assert.equal(row.content.missing, 0); assert.equal(row.units.units, 1); assert.equal(row.pass, true);
  assert.match(runLog(), /one-load home → probes from the stitches' inventories \(origin \S+, EDS \S+; chrome\)/);
  assert.equal(pageJson('home', 'probes.json').results.content, 'ok', 'P3\'s probes.json records the one-load probes');
});
check('one-load 2: --one-load --only home is a fix round — 0 origin stitches, 1 EDS, 0 probe spawns; the kept origin\'s own inventory', () => {
  const r = olGate(['--one-load', '--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 1); assert.equal(r.cp.length, 0); assert.equal(r.ug, 0);
  const row = r.row('home'); assert.equal(row.originReused.policy, 'same-run'); assert.equal(row.oneLoad.via, 'one-load'); assert.equal(row.oneLoad.origin, olOriginAt);
  assert.equal(pageJson('home', 'content.json')._provenance.via, 'one-load');
});
check('one-load 3: a --blocked origin (crawl shot) has no inventory — content-presence runs for that page, the row and _run.log say why', () => {
  const r = olGate(['--one-load', '--only', 'about', '--recapture-origin', '--blocked', 'example\\.com/about']);
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.row('about').inconclusive, true, 'a crawl-fullpage origin is a polluted capture: no pixel verdict');
  assert.equal(r.origin, 0); assert.equal(r.eds, 1); assert.equal(r.cp.length, 1);
  assert.match(runLog(), /one-load about → fallback: no origin inventory \(crawl-fullpage capture\)/);
  assert.deepEqual(r.row('about').oneLoad, { via: 'probes', fallback: 'no origin inventory (crawl-fullpage capture)' });
});
check('one-load 4: --one-load --warmup falls back — the captures run as without --one-load, every page runs the probes, logged', () => {
  const r = olGate(['--one-load', '--warmup', 'https://www.example.com/']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.cp.length, 2); assert.equal(r.ug, 1);
  assert.ok(r.argv('ORIGIN').concat(r.argv('EDS')).every((l) => !l.includes('--inventory')), 'no inventory taken');
  assert.ok(r.argv('EDS').every((l) => !l.includes('--headed')), 'the EDS capture keeps its tier');
  assert.match(runLog(), /one-load: off for this run \(--warmup needs its own navigation\)/); assert.match(runLog(), /one-load home → fallback: --warmup set/);
  assert.equal(r.row('home').oneLoad.fallback, '--warmup set (the warm-up needs its own navigation)');
});
check('one-load 5: without --one-load nothing changes — legacy counts, argv and row shape (no oneLoad field)', () => {
  const r = olGate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 2); assert.equal(r.eds, 2); assert.equal(r.cp.length, 2); assert.equal(r.ug, 1);
  assert.ok(r.argv('ORIGIN').every((l) => l.endsWith(' --headed') && !l.includes('--inventory'))); assert.ok(r.argv('EDS').every((l) => !l.includes('--headed') && !l.includes('--inventory')));
  assert.equal('oneLoad' in r.row('home'), false); assert.equal(r.row('home').presenceReused, null); assert.equal(r.row('home').unitsReused, null, 'a unit-geometry cache miss is no reuse');
  assert.equal(pageJson('home', 'eds.json').headed, undefined); assert.equal(pageJson('home', 'origin.json').inventory, undefined);
});
check('presence cache: a content-presence origin-inventory cache hit reaches the row (presenceReused) and _run.log', () => {
  const r = olGate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.cp.length, 1); assert.equal(r.cp[0].had, true);
  const pr = r.row('home').presenceReused; assert.equal(pr.from, presence('home')); assert.equal(pr.policy, 'same-run'); assert.ok(pr.at);
  assert.match(runLog(), /content home → origin inventory reused \S+presence-origin\.json \(probed \S+; same-run\)/);
});
check('units cache: a unit-geometry origin-cache hit reaches the row (unitsReused) and _run.log — fresh, and replayed from probes.json', () => {
  const hitAt = new Date(Date.now() - 5e3).toISOString();
  const r = olGate(['--only', 'home'], { STUB_UG_HIT: hitAt });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.ug, 1);
  const ur = r.row('home').unitsReused; assert.deepEqual(ur, { from: 'stardust/current/measure/home-units-1440.json', at: hitAt, policy: 'same-run' });
  assert.match(runLog(), /units home → origin inventory reused stardust\/current\/measure\/home-units-1440\.json \(probed \S+; same-run\)/);
  const again = olGate(['--only', 'home', '--skip-existing', '--compare-only']); // no capture: the probes replay, no unit-geometry spawn
  assert.equal(again.status, 0, again.stderr + again.stdout); assert.equal(again.ug, 0); assert.equal(again.row('home').reused.what, 'probes');
  assert.deepEqual(again.row('home').unitsReused, ur);
});
check('one-load 6: a fix round keeps only a one-load origin — a legacy capture (no inventory) is re-shot once with one', () => {
  const r = olGate(['--one-load', '--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 1); assert.equal(r.cp.length, 0);
  assert.match(runLog(), /origin home → not reused \(one-load: no inventory \(captured without one\)\)/);
  assert.equal(olGate(['--one-load', '--only', 'home']).origin, 0, 'the next fix round keeps it');
});
check('--skip-existing with origin.png gone and a fresh live.png older than the probes: the replay is refused and logged, the probes re-run against the new origin — not from the old origin\'s presence inventory (unit-geometry\'s origin cache keeps its own freshness rule)', () => {
  opener(new Date().toISOString());
  const g = join(root, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  const liveAt = new Date().toISOString();
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, at: liveAt }));
  const first = olGate(['--only', 'home', '--recapture-origin']); // a stitched origin, then probes (presence cache written)
  assert.equal(first.status, 0, first.stderr + first.stdout); assert.equal(first.origin, 1); assert.ok(pageJson('home', 'probes.json').at > liveAt);
  assert.ok(existsSync(join(root, presence('home'))));
  const unitsCache = join(root, 'stardust/current/measure/home-units-1440.json'); mkdirSync(dirname(unitsCache), { recursive: true }); writeFileSync(unitsCache, '{}');
  rmSync(join(OUT, 'home/origin.png'));
  const r = olGate(['--only', 'home', '--skip-existing']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0);
  assert.equal(r.eds, 1, 'no gate-key.json proves the EDS capture (no content/index.html): re-shot');
  assert.equal(r.row('home').originReused.from, 'stardust/replica/gates/home-1440/live.png');
  assert.match(runLog(), /probes home → re-run \(origin is a reused capture the probes were not taken against\)/);
  assert.equal(r.cp.length, 1, 'content-presence re-ran'); assert.equal(r.cp[0].had, false, 'the old origin\'s presence inventory was dropped with it');
  assert.equal(r.ug, 1); assert.equal(existsSync(unitsCache), true, 'unit-geometry\'s origin cache is applied to no image — left to its freshness rule');
  assert.equal(r.row('home').reused, null, 'no probe replay in the row');
});
// clip-probe becomes an importable stub too (counts its spawns): the prototype stage's clip comes from the EDS inventory.
const CLIP_LOG = join(root, 'clip.log');
cpSync(join(DIFF, 'clip-probe.mjs'), join(DS, 'clip-probe-real.mjs'));
stub(DS, 'clip-probe.mjs', `export * from './clip-probe-real.mjs';
import { appendFileSync } from 'node:fs';
if (process.argv[1] && process.argv[1].endsWith('clip-probe.mjs')) { appendFileSync(${JSON.stringify(CLIP_LOG)}, process.argv.slice(2).join(' ') + '\\n'); process.exit(1); }`);
check('one-load 7: --stage prototype --one-load — the archetype live.png is not taken (logged), the origin is stitched with its inventory, clip.json is the clip-probe CLI object, 0 clip-probe spawns', () => {
  opener(new Date().toISOString());
  const g = join(root, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, at: new Date().toISOString() }));
  rmSync(CLIP_LOG, { force: true });
  const r = olGate(['--stage', 'prototype', '--proto-base', 'http://localhost:9', '--one-load']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(lines(CLIP_LOG).length, 0, 'no clip-probe spawn'); assert.equal(r.cp.length, 0); assert.equal(r.ug, 0);
  const proto = 'stardust/replica/gates/prototypes-1440';
  assert.match(readFileSync(join(root, proto, '_run.log'), 'utf8'), /origin home → live\.png not reused \(one-load: not a headed real-Chrome capture\)/);
  assert.equal(r.argv('ORIGIN').length, 1); assert.match(r.argv('ORIGIN')[0], / --inventory \S+origin-inventory\.spec\.json --headed$/);
  assert.match(r.argv('EDS')[0], /^EDS http:\/\/localhost:9\/home\.html .* --inventory \S+eds-inventory\.spec\.json --headed$/);
  const clipJson = read(`${proto}/home/clip.json`);
  assert.deepEqual(Object.keys(clipJson), ['url', 'at', 'width', 'status', 'settlePasses', 'docH', 'pageW', 'counts', 'findings', 'textBoxes', 'groups', 'tier'], 'the clip-probe CLI keys');
  assert.equal(clipJson.url, 'http://localhost:9/home.html'); assert.equal(clipJson.at, read(`${proto}/home/eds-inventory.json`).at);
  const row = read(`${proto}/summary.json`).rows.find((x) => x.slug === 'home');
  assert.equal(row.oneLoad.via, 'one-load'); assert.equal(row.originReused, null); assert.equal(row.clipped, 0); assert.equal(row.units.units, 1);
});
rmSync(root, { recursive: true, force: true });

// ---- hide (F6) sandbox: presence.json `hide` reaches both stitches, content-presence and clip-probe; records; reuse -----
// Its own project: stub instruments log `<NAME> <argv>` (stitch-shot: ORIGIN = the www.example.com side, else EDS); the
// real live-session.mjs (presenceHide, freshness) and foundation-freeze.mjs.
const hroot = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-hide-')));
const HRS = join(hroot, 'stardust/scripts/replica'); const HDS = join(hroot, 'stardust/scripts/diff'); const HLOG = join(hroot, 'argv.log');
const HOUT = join(hroot, 'stardust/replica/gates/all-1440'); const HPROTO = join(hroot, 'stardust/replica/gates/prototypes-1440');
mkdirSync(HRS, { recursive: true }); mkdirSync(HDS, { recursive: true });
cpSync(SCRIPT, join(HRS, 'gate-all.mjs')); cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(HRS, 'foundation-freeze.mjs')); cpSync(join(DIFF, 'live-session.mjs'), join(HDS, 'live-session.mjs'));
const argvLog = (name) => `appendFileSync(${JSON.stringify(HLOG)}, ${name} + ' ' + process.argv.slice(2).join(' ') + '\\n');`;
stub(HRS, 'stitch-shot.mjs', `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
${argvLog("(/www\\.example\\.com/.test(process.argv[2]) ? 'ORIGIN' : 'EDS')")}
// with --hide, stitch-shot's hidden: line — the origin: .promo-strip ×0, .cookie-strip invalid, the rest ×1; the build: all ×0
const a = process.argv.slice(2); const origin = /www\\.example\\.com/.test(a[0]);
const entry = (s) => (!origin || s === '.promo-strip' ? s + ' ×0 [--hide]' : s === '.cookie-strip' ? s + " error: '" + s + "' is not a valid style rule selector [--hide]" : s + ' ×1 (88px) [--hide]');
if (a.includes('--hide')) console.log('hidden: ' + a[a.indexOf('--hide') + 1].split(',').map(entry).join('; '));
writeFileSync(process.argv[3], 'png');
${SHOT_RECORD("(origin ? 'ORIGIN' : 'EDS')")}
// STUB_HIDE_MISS (a hideMiss record as JSON): the sels this capture's --hide list holds → the --json record's hideMiss, on
// both sides alike (stitch-shot does not know the side; gate-all warns about the origin's only)
if (process.env.STUB_HIDE_MISS && a.includes('--json') && a.includes('--hide')) {
  const f = a[a.indexOf('--json') + 1]; const m = JSON.parse(process.env.STUB_HIDE_MISS); const list = a[a.indexOf('--hide') + 1].split(',');
  const sels = m.sels.filter((x) => list.includes(x));
  if (sels.length) writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), hideMiss: { ...m, sels } }));
}`);
stub(HRS, 'pixel-compare.mjs', 'console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: true }));');
stub(HDS, 'content-presence.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
${argvLog("'CONTENT'")}
const a = process.argv; const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, scope: 'root', totals: { missing: 0, hidden: 0, controlState: 0 }, eds: { clip }, origin: { clip } }));`);
stub(HDS, 'clip-probe.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
${argvLog("'CLIP'")}
const a = process.argv; writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ at: new Date().toISOString(), counts: { total: 0 }, groups: [] }));`);
stub(HDS, 'unit-geometry.mjs', 'export function unitsFor() { return []; }');
writeFileSync(join(hroot, 'stardust/state.json'), JSON.stringify({ pages })); // home (with a prototypePath) and about
appendFileSync(join(hroot, 'stardust/status.jsonl'), `${JSON.stringify({ ts: new Date(Date.now() - 60e3).toISOString(), skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' })}\n`);
const setPresence = (json, out = HOUT) => { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'presence.json'), JSON.stringify(json)); };
const hgate = (args, env = {}) => {
  rmSync(HLOG, { force: true }); clearRounds(HOUT, HPROTO);
  const e = { ...process.env, ...env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC', 'STUB_HIDE_MISS']) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, [join(HRS, 'gate-all.mjs'), '--width', '1440', ...args], { cwd: hroot, env: e, encoding: 'utf8', timeout: 60e3 });
  const all = lines(HLOG); const run = (r.stdout.match(/run → (.*)/) || [])[1]; const out = args.includes('prototype') ? HPROTO : HOUT;
  const doc = (() => { try { return JSON.parse(readFileSync(run ? join(hroot, run) : join(out, 'summary.json'), 'utf8')); } catch { return null; } })(); // read now: the next run clears runs/
  return { ...r, all, by: (name, slug) => all.filter((l) => l.startsWith(`${name} `) && l.includes(`-1440/${slug}/`)), row: (slug) => doc.rows.find((x) => x.slug === slug) };
};
const hideArg = (l) => { const a = l.split(' '); const i = a.indexOf('--hide'); return i < 0 ? null : a[i + 1]; };
const hjson = (slug, f, out = HOUT) => JSON.parse(readFileSync(join(out, slug, f), 'utf8'));
const hlog = (out = HOUT) => readFileSync(join(out, '_run.log'), 'utf8');
const liveJson = (url, hide) => ({ writtenBy: 'gate.sh', url, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, ...(hide ? { hide } : {}), headed: false, overlayLeft: null, at: new Date().toISOString() });
setPresence({ '*': { hide: ['.geo-bar'] }, home: { hide: ['.promo-strip'] } });
check('hide 1: presence.json "*" + a slug\'s hide → both stitches and content-presence get --hide "*" then the slug\'s; a page without its own entry gets "*"\'s; origin.json / eds.json / probes.json inputs / the row record the list', () => {
  const r = hgate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const [slug, want] of [['home', '.geo-bar,.promo-strip'], ['about', '.geo-bar']]) {
    for (const name of ['ORIGIN', 'EDS', 'CONTENT']) { const l = r.by(name, slug); assert.equal(l.length, 1, `${name} ${slug}`); assert.equal(hideArg(l[0]), want, `${name} ${slug}: ${l[0]}`); }
    for (const f of ['origin.json', 'eds.json']) assert.deepEqual(hjson(slug, f).hide, want.split(','), `${slug} ${f}`);
    assert.deepEqual(hjson(slug, 'probes.json').inputs.hide, want.split(',')); assert.deepEqual(r.row(slug).hide, want.split(','), `${slug} row`);
  }
  assert.match(r.by('ORIGIN', 'home')[0], / --locale en-US --hide \.geo-bar,\.promo-strip --headed$/);
  assert.equal(r.by('CLIP', 'home').length, 0, 'content-presence carries the clip counts');
  // the stitch's hidden: line → origin.json / eds.json `hidden`; a ×0 selector is one _run.log line per page and side
  assert.equal(hjson('home', 'origin.json').hidden, '.geo-bar ×1 (88px) [--hide]; .promo-strip ×0 [--hide]');
  assert.equal(hjson('home', 'eds.json').hidden, '.geo-bar ×0 [--hide]; .promo-strip ×0 [--hide]');
  assert.equal(hjson('about', 'origin.json').hidden, '.geo-bar ×1 (88px) [--hide]');
  assert.equal((r.stdout.match(/ origin home → hide /g) || []).length, 1, r.stdout); assert.match(r.stdout, / origin home → hide matched nothing: \.promo-strip$/m);
  assert.match(r.stdout, / eds home → hide matched nothing: \.geo-bar, \.promo-strip$/m); assert.doesNotMatch(r.stdout, / origin about → hide /, 'every selector matched');
});
check('hide 2: a fix round (--only) with the list unchanged reuses the origin; the EDS stitch hides the same list', () => {
  const r = hgate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.by('ORIGIN', 'home').length, 0); assert.equal(hideArg(r.by('EDS', 'home')[0]), '.geo-bar,.promo-strip');
  assert.equal(r.row('home').originReused.policy, 'same-run'); assert.deepEqual(r.row('home').hide, HL); assert.deepEqual(hjson('home', 'origin.json').hide, HL);
});
check('hide 3: clip-probe (--no-content: no content-presence) gets the same --hide', () => {
  const r = hgate(['--only', 'home', '--no-content']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.by('CONTENT', 'home').length, 0);
  const c = r.by('CLIP', 'home'); assert.equal(c.length, 1); assert.equal(hideArg(c[0]), '.geo-bar,.promo-strip');
});
check('hide 4: a fix round with a changed list re-stitches the origin (not reused: hide list differs) and records the new list; the next fix round reuses it', () => {
  setPresence({ '*': { hide: ['.geo-bar'] }, home: { hide: ['.promo-strip', '.cookie-strip'] } });
  const r = hgate(['--only', 'home']); const want = ['.geo-bar', '.promo-strip', '.cookie-strip'];
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const o = r.by('ORIGIN', 'home'); assert.equal(o.length, 1); assert.equal(hideArg(o[0]), want.join(','));
  assert.match(hlog(), /origin home → not reused \(hide list differs\)/);
  assert.match(r.stdout, / origin home → hide matched nothing: \.promo-strip; invalid: \.cookie-strip$/m);
  assert.equal(r.row('home').originReused, null); assert.deepEqual(hjson('home', 'origin.json').hide, want); assert.deepEqual(r.row('home').hide, want);
  assert.equal(hgate(['--only', 'home']).by('ORIGIN', 'home').length, 0);
});
check('hide 5: --skip-existing keeps an origin taken hiding the same list, re-shoots one taken hiding another (logged)', () => {
  const same = hgate(['--only', 'about', '--skip-existing']);
  assert.equal(same.status, 0, same.stderr + same.stdout); assert.equal(same.by('ORIGIN', 'about').length, 0); assert.match(hlog(), /origin about → reused \(--skip-existing\)/);
  setPresence({ '*': { hide: ['.geo-bar', '.chat-tab'] }, home: { hide: ['.promo-strip', '.cookie-strip'] } });
  const moved = hgate(['--only', 'about', '--skip-existing']);
  assert.equal(moved.status, 0, moved.stderr + moved.stdout); assert.equal(moved.by('ORIGIN', 'about').length, 1); assert.equal(hideArg(moved.by('ORIGIN', 'about')[0]), '.geo-bar,.chat-tab');
  assert.match(hlog(), /origin about → not reused \(--skip-existing: hide list differs\)/); assert.deepEqual(hjson('about', 'origin.json').hide, ['.geo-bar', '.chat-tab']);
});
check('hide 6: the published stage takes the archetype round\'s live.png only when live.json hid the same list', () => {
  const g = join(hroot, 'stardust/replica/gates/about-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify(liveJson('https://www.example.com/about', ['.geo-bar', '.chat-tab'])));
  const r = hgate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.by('ORIGIN', 'about').length, 0);
  assert.equal(r.row('about').originReused.from, 'stardust/replica/gates/about-1440/live.png'); assert.deepEqual(hjson('about', 'origin.json').hide, ['.geo-bar', '.chat-tab']);
  writeFileSync(join(g, 'live.json'), JSON.stringify(liveJson('https://www.example.com/about', ['.geo-bar'])));
  const d = hgate([]);
  assert.equal(d.by('ORIGIN', 'about').length, 1); assert.match(hlog(), /origin about → live\.png not reused \(live\.json hide list differs\)/);
  rmSync(g, { recursive: true, force: true });
});
check('hide 7: --stage prototype — the archetype live.png only with the same list (both stitches hide it); --skip-existing keeps both sides with the same list, re-shoots both with another (logged)', () => {
  const args = ['--stage', 'prototype', '--proto-base', 'http://localhost:9', '--no-probes'];
  setPresence({ '*': { hide: ['.geo-bar'] } }, HPROTO);
  const g = join(hroot, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify(liveJson('https://www.example.com/', ['.geo-bar'])));
  const a = hgate(args);
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.by('ORIGIN', 'home').length, 0); assert.equal(a.row('home').originReused.policy, 'prototype-stage');
  assert.deepEqual(hjson('home', 'origin.json', HPROTO).hide, ['.geo-bar']); assert.equal(hideArg(a.by('EDS', 'home')[0]), '.geo-bar', 'the served prototype hides the same list');
  writeFileSync(join(g, 'live.json'), JSON.stringify(liveJson('https://www.example.com/', [])));
  const b = hgate(args);
  assert.equal(hideArg(b.by('ORIGIN', 'home')[0]), '.geo-bar'); assert.match(hlog(HPROTO), /origin home → live\.png not reused \(live\.json hide list differs\)/);
  const c = hgate([...args, '--skip-existing']);
  assert.equal(c.status, 0, c.stderr + c.stdout); assert.equal(c.by('ORIGIN', 'home').length + c.by('EDS', 'home').length, 0, 'the same list: both kept');
  setPresence({ '*': { hide: ['.geo-bar', '.cookie-strip'] } }, HPROTO);
  const d = hgate([...args, '--skip-existing']);
  assert.equal(hideArg(d.by('ORIGIN', 'home')[0]), '.geo-bar,.cookie-strip'); assert.equal(hideArg(d.by('EDS', 'home')[0]), '.geo-bar,.cookie-strip');
  assert.match(hlog(HPROTO), /origin home → not reused \(--skip-existing: hide list differs\)/); assert.match(hlog(HPROTO), /eds home → not reused \(--skip-existing: hide list differs\)/);
  rmSync(g, { recursive: true, force: true });
});
check('hide 8: no hide entries → no --hide in any argv and no hide field in origin.json / eds.json / probes.json / the row; an origin taken hiding is not reused', () => {
  setPresence({ home: { variable: ['.rail'] } });
  const r = hgate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.all.length, 3, r.all.join('\n')); assert.ok(r.all.every((l) => !l.includes('--hide')), r.all.join('\n'));
  assert.equal(r.by('ORIGIN', 'home').length, 1); assert.match(hlog(), /origin home → not reused \(hide list differs\)/);
  for (const f of ['origin.json', 'eds.json']) { assert.equal('hide' in hjson('home', f), false, f); assert.equal('hidden' in hjson('home', f), false, f); }
  assert.doesNotMatch(r.stdout, /→ hide /);
  assert.equal('hide' in hjson('home', 'probes.json').inputs, false); assert.equal('hide' in r.row('home'), false);
});
check('hide 9: a diff scripts dir whose live-session.mjs lacks presenceHide → one log line, captures and probes run without hides', () => {
  setPresence({ '*': { hide: ['.geo-bar'] } });
  renameSync(join(HDS, 'live-session.mjs'), join(HDS, 'live-session-real.mjs'));
  writeFileSync(join(HDS, 'live-session.mjs'), "export { freshness, maxAgeHours, reuseRecord, runStartAt } from './live-session-real.mjs';\n");
  try {
    const r = hgate([]);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal((r.stdout.match(/presence hide: not honoured/g) || []).length, 1, r.stdout);
    assert.ok(r.all.length && r.all.every((l) => !l.includes('--hide')), r.all.join('\n')); assert.equal('hide' in r.row('home'), false);
  } finally { rmSync(join(HDS, 'live-session.mjs')); renameSync(join(HDS, 'live-session-real.mjs'), join(HDS, 'live-session.mjs')); }
});
const argOf = (l, flag) => { const a = l.split(' '); const i = a.indexOf(flag); return i < 0 ? null : a[i + 1]; };
const withDismiss = (url, extra, hide = []) => ({ ...liveJson(url, hide), dismiss: { off: false, consent: null, extra } });
check('dismiss 1: --dismiss reaches both stitches (before --hide), not content-presence (it takes no --dismiss); origin.json / eds.json / probes.json inputs / _provenance record the list', () => {
  setPresence({ '*': { hide: ['.geo-bar'] } });
  const r = hgate(['--dismiss', '.nl-close,#promo-x']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const slug of ['home', 'about']) {
    for (const name of ['ORIGIN', 'EDS']) { const l = r.by(name, slug); assert.equal(l.length, 1, `${name} ${slug}`); assert.match(l[0], / --dismiss \.nl-close,#promo-x --hide \.geo-bar( |$)/, l[0]); }
    assert.equal(argOf(r.by('CONTENT', slug)[0], '--dismiss'), null, r.by('CONTENT', slug)[0]);
    for (const f of ['origin.json', 'eds.json']) assert.deepEqual(hjson(slug, f).dismiss, DL, `${slug} ${f}`);
    assert.deepEqual(hjson(slug, 'probes.json').inputs.dismiss, DL);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(HOUT, 'summary.json'), 'utf8'))._provenance.dismiss, DL);
});
check('dismiss 2: a fix round with the same list keeps the origin, the EDS stitch dismisses it, clip-probe (--no-content) gets no --dismiss; a round without --dismiss re-stitches the origin (not reused: dismiss list differs) and records none', () => {
  const same = hgate(['--only', 'home', '--dismiss', '.nl-close,#promo-x']);
  assert.equal(same.status, 0, same.stderr + same.stdout); assert.equal(same.by('ORIGIN', 'home').length, 0); assert.equal(argOf(same.by('EDS', 'home')[0], '--dismiss'), '.nl-close,#promo-x');
  const clipRun = hgate(['--only', 'home', '--no-content', '--dismiss', '.nl-close,#promo-x']);
  assert.equal(clipRun.status, 0, clipRun.stderr + clipRun.stdout); assert.equal(clipRun.by('CLIP', 'home').length, 1); assert.equal(argOf(clipRun.by('CLIP', 'home')[0], '--dismiss'), null);
  const none = hgate(['--only', 'home']);
  assert.equal(none.status, 0, none.stderr + none.stdout); assert.equal(none.by('ORIGIN', 'home').length, 1); assert.match(hlog(), /origin home → not reused \(dismiss list differs\)/);
  assert.ok(none.all.every((l) => !l.includes('--dismiss')), none.all.join('\n'));
  for (const f of ['origin.json', 'eds.json']) assert.equal('dismiss' in hjson('home', f), false, f);
  assert.equal('dismiss' in hjson('home', 'probes.json').inputs, false);
});
check('dismiss 3: the published stage takes the archetype round\'s live.png only when live.json dismissed the same list (gate.sh --dismiss → dismiss.extra)', () => {
  setPresence({});
  const g = join(hroot, 'stardust/replica/gates/about-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify(withDismiss('https://www.example.com/about', '.nl-close')));
  const a = hgate(['--dismiss', '.nl-close']);
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.by('ORIGIN', 'about').length, 0);
  assert.equal(a.row('about').originReused.from, 'stardust/replica/gates/about-1440/live.png'); assert.deepEqual(hjson('about', 'origin.json').dismiss, ['.nl-close']);
  const b = hgate([]);
  assert.equal(b.by('ORIGIN', 'about').length, 1); assert.match(hlog(), /origin about → live\.png not reused \(live\.json dismiss list differs\)/);
  rmSync(g, { recursive: true, force: true });
});
check('dismiss 4: --stage prototype — the archetype live.png only with the same list (both stitches dismiss it); --skip-existing keeps both sides with the same list, re-shoots both with another (logged)', () => {
  const args = ['--stage', 'prototype', '--proto-base', 'http://localhost:9', '--no-probes'];
  setPresence({}, HPROTO);
  const g = join(hroot, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify(withDismiss('https://www.example.com/', '.nl-close,#promo-x')));
  const a = hgate([...args, '--dismiss', '.nl-close,#promo-x']);
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.by('ORIGIN', 'home').length, 0); assert.equal(a.row('home').originReused.policy, 'prototype-stage');
  assert.deepEqual(hjson('home', 'origin.json', HPROTO).dismiss, DL); assert.equal(argOf(a.by('EDS', 'home')[0], '--dismiss'), '.nl-close,#promo-x', 'the served prototype dismisses the same list');
  const b = hgate(args);
  assert.equal(b.by('ORIGIN', 'home').length, 1); assert.match(hlog(HPROTO), /origin home → live\.png not reused \(live\.json dismiss list differs\)/);
  const c = hgate([...args, '--skip-existing']);
  assert.equal(c.status, 0, c.stderr + c.stdout); assert.equal(c.by('ORIGIN', 'home').length + c.by('EDS', 'home').length, 0, 'the same (no) list: both kept');
  const d = hgate([...args, '--skip-existing', '--dismiss', '.nl-close']);
  assert.equal(d.status, 0, d.stderr + d.stdout); assert.equal(argOf(d.by('ORIGIN', 'home')[0], '--dismiss'), '.nl-close'); assert.equal(argOf(d.by('EDS', 'home')[0], '--dismiss'), '.nl-close');
  assert.match(hlog(HPROTO), /origin home → not reused \(--skip-existing: dismiss list differs\)/); assert.match(hlog(HPROTO), /eds home → not reused \(--skip-existing: dismiss list differs\)/);
  rmSync(g, { recursive: true, force: true });
});
// ---- the site-wide presence.json (stardust/replica/presence.json), merged UNDER the gate dir's (live-session mergePresence)
const SITE = join(hroot, 'stardust/replica/presence.json');
const setSite = (json) => { mkdirSync(dirname(SITE), { recursive: true }); writeFileSync(SITE, typeof json === 'string' ? json : JSON.stringify(json)); };
check('site 1: no gate dir presence.json — the site file\'s "*".hide reaches both stitches, content-presence and clip-probe of every page; origin.json / eds.json / probes.json inputs / the row record it; _run.log names the merge', () => {
  rmSync(join(HOUT, 'presence.json'), { force: true }); setSite({ '*': { hide: ['.site-bar'] } });
  const r = hgate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const slug of ['home', 'about']) {
    for (const name of ['ORIGIN', 'EDS', 'CONTENT']) { const l = r.by(name, slug); assert.equal(l.length, 1, `${name} ${slug}`); assert.equal(hideArg(l[0]), '.site-bar', `${name} ${slug}: ${l[0]}`); }
    for (const f of ['origin.json', 'eds.json']) assert.deepEqual(hjson(slug, f).hide, ['.site-bar'], `${slug} ${f}`);
    assert.deepEqual(hjson(slug, 'probes.json').inputs.hide, ['.site-bar']); assert.deepEqual(r.row(slug).hide, ['.site-bar'], `${slug} row`);
  }
  assert.match(hlog(), / presence: stardust\/replica\/presence\.json \(stardust\/replica\/gates\/all-1440\/presence\.json not found\) — the gate dir's field wins$/m);
  const c = hgate(['--only', 'about', '--no-content']);
  assert.equal(c.status, 0, c.stderr + c.stdout); assert.equal(hideArg(c.by('CLIP', 'about')[0]), '.site-bar'); assert.equal(c.by('ORIGIN', 'about').length, 0, 'the same merged list: the origin is kept');
});
check('site 2: the gate dir wins per field — its "*".hide over the site\'s; a slug\'s fields only the site has (hide, main) are kept beside the gate\'s variable; the merged entry is the probe input without reasons', () => {
  setSite({ '*': { hide: ['.site-bar'] }, home: { hide: ['.promo-strip'], main: 'main.site', reasons: { '.promo-strip': 'R-01' } } });
  setPresence({ '*': { hide: ['.geo-bar'] }, home: { variable: ['.rail'] } });
  const r = hgate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const [slug, want] of [['home', '.geo-bar,.promo-strip'], ['about', '.geo-bar']]) for (const name of ['ORIGIN', 'EDS', 'CONTENT']) assert.equal(hideArg(r.by(name, slug)[0]), want, `${name} ${slug}`);
  const c = r.by('CONTENT', 'home')[0]; assert.deepEqual([argOf(c, '--main'), argOf(c, '--variable')], ['main.site', '.rail'], c);
  assert.deepEqual(hjson('home', 'probes.json').inputs.presence, { hide: ['.promo-strip'], main: 'main.site', variable: ['.rail'] });
  assert.deepEqual(r.row('home').hide, ['.geo-bar', '.promo-strip']);
  assert.match(hlog(), / presence: stardust\/replica\/gates\/all-1440\/presence\.json over stardust\/replica\/presence\.json — the gate dir's field wins$/m);
});
check('site 3: a malformed site file is an error naming it — exit 1, no capture, no probe', () => {
  setSite('{"*": ');
  const r = hgate([]);
  assert.equal(r.status, 1, r.stderr + r.stdout); assert.equal(r.all.length, 0, r.all.join('\n'));
  assert.match(r.stderr, /^gate-all error: presence\.json stardust\/replica\/presence\.json unreadable \(/m);
});
check('site 4: a live-session.mjs without mergePresence leaves the site file out — one "presence hide: not honoured for <site file> (site-wide)" line, the gate dir\'s list only; one without presenceHide and a site-only hide → the one "not honoured" line, no hides', () => {
  setSite({ '*': { hide: ['.site-bar'] } }); setPresence({ '*': { hide: ['.geo-bar'] } });
  renameSync(join(HDS, 'live-session.mjs'), join(HDS, 'live-session-real.mjs'));
  try {
    writeFileSync(join(HDS, 'live-session.mjs'), "export { freshness, maxAgeHours, presenceHide, reuseRecord, runStartAt } from './live-session-real.mjs';\n");
    const a = hgate([]);
    assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal((a.stdout.match(/presence hide: not honoured/g) || []).length, 1, a.stdout);
    assert.match(a.stdout, / presence hide: not honoured for stardust\/replica\/presence\.json \(site-wide\) — the diff scripts dir has no live-session\.mjs with mergePresence; captures and probes run with stardust\/replica\/gates\/all-1440\/presence\.json only$/m);
    assert.equal(hideArg(a.by('ORIGIN', 'home')[0]), '.geo-bar');
    rmSync(join(HOUT, 'presence.json'));
    writeFileSync(join(HDS, 'live-session.mjs'), "export { freshness, maxAgeHours, reuseRecord, runStartAt } from './live-session-real.mjs';\n");
    const b = hgate([]);
    assert.equal(b.status, 0, b.stderr + b.stdout); assert.equal((b.stdout.match(/presence hide: not honoured/g) || []).length, 1, b.stdout);
    assert.match(b.stdout, / presence hide: not honoured — the diff scripts dir has no live-session\.mjs with presenceHide/);
    assert.ok(b.all.length && b.all.every((l) => !l.includes('--hide')), b.all.join('\n'));
  } finally { rmSync(join(HDS, 'live-session.mjs')); renameSync(join(HDS, 'live-session-real.mjs'), join(HDS, 'live-session.mjs')); rmSync(SITE, { force: true }); setPresence({}); }
});
// ---- a hide selector that matched nothing on the live (origin) capture: the record's hideMiss → a WARNING, never a verdict
const MISS = { sels: ['.promo-strip'], candidates: [{ tag: 'section', id: '', classes: ['bar__wrapper'], top: 0, height: 0, selector: 'section.bar__wrapper' }, { tag: 'div', id: 'geo', classes: [], top: 0, height: 88, selector: '#geo' }] };
const ZERO = '0px now — a block that grows later is still hidden by the persistent display:none !important rule';
const MISS_LINE = `hide matched nothing on live — candidates: section.bar__wrapper (section, ${ZERO}); #geo (div, 88px) (.promo-strip)`;
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const warned = (slug, text = MISS_LINE) => new RegExp(`^\\S+ WARNING ${slug}: ${reEsc(text)}$`, 'm');
const MISS_MD = /^Hide matched nothing on live \(a warning, not a verdict — fix the hide list; candidates in the row's hideMiss and _run\.log\): (.*)$/m;
check('hideMissOf / hideMissText: a record\'s hideMiss as kept (missed selectors, candidates with a selector), null when nothing missed; the one-line text — <selector> (<tag>, <h>px) joined "; ", a 0-px block "0px now — …", none "none found above the header", then the missed selectors; live-session\'s hideMissLine when given', () => {
  assert.deepEqual(hideMissOf(MISS), MISS);
  for (const none of [null, undefined, {}, { sels: [] }, { sels: [''] }, 'x']) assert.equal(hideMissOf(none), null, JSON.stringify(none));
  assert.deepEqual(hideMissOf({ sels: ['.a', 3, ''], candidates: [{ tag: 'div' }, { tag: 'p', height: 12, selector: 'p.x' }, null] }), { sels: ['.a'], candidates: [{ tag: 'p', height: 12, selector: 'p.x' }] });
  assert.deepEqual(hideMissOf({ sels: ['.a'] }), { sels: ['.a'], candidates: [] });
  assert.equal(hideMissText(MISS), MISS_LINE);
  assert.equal(hideMissText({ sels: ['.a', '.b'], candidates: [] }), 'hide matched nothing on live — candidates: none found above the header (.a, .b)');
  assert.equal(hideMissText({ sels: ['.a'], candidates: [{ tag: 'div', height: 87.6, selector: 'div.bar' }] }), 'hide matched nothing on live — candidates: div.bar (div, 88px) (.a)');
  assert.equal(hideMissText(MISS, (sels, list) => `helper ${sels.join('|')} ${list.length}\nsecond`), 'helper .promo-strip 2 second', 'the helper\'s text, one line');
});
check('hide miss 1: the origin capture record\'s hideMiss → one "WARNING <slug>: hide matched nothing on live — candidates: …" line (stdout and _run.log), origin.json and the row keep it, totals.hideMiss 1, one summary.md line naming the row; the build side\'s miss is not warned about; the verdict and the exit code unchanged', () => {
  setPresence({ home: { hide: ['.promo-strip'] } });
  const r = hgate([], { STUB_HIDE_MISS: JSON.stringify(MISS) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, warned('home')); assert.match(hlog(), warned('home')); assert.equal((r.stdout.match(/ WARNING /g) || []).length, 1, r.stdout);
  assert.deepEqual(hjson('home', 'origin.json').hideMiss, MISS); assert.equal('hideMiss' in hjson('home', 'eds.json'), false, 'eds-shot.json carried one too: not recorded');
  const s = JSON.parse(readFileSync(join(HOUT, 'summary.json'), 'utf8'));
  assert.deepEqual(s.rows.find((x) => x.slug === 'home').hideMiss, MISS); assert.equal('hideMiss' in s.rows.find((x) => x.slug === 'about'), false);
  assert.deepEqual([s.totals.hideMiss, s.totals.pass, s.totals.pages], [1, 2, 2]); assert.deepEqual([r.row('home').pass, r.row('home').reasons], [true, []]);
  assert.equal(readFileSync(join(HOUT, 'summary.md'), 'utf8').match(MISS_MD)[1], '/');
});
check('hide miss 2: a reused origin capture whose record has one warns too — a fix round keeps the origin (0 origin stitches) and --compare-only reads origin.json: the WARNING, the row\'s hideMiss and the summary line (--only prints the table)', () => {
  const r = hgate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.by('ORIGIN', 'home').length, 0); assert.equal(r.row('home').originReused.policy, 'same-run');
  assert.match(r.stdout, warned('home')); assert.deepEqual(r.row('home').hideMiss, MISS); assert.equal(r.stdout.match(MISS_MD)[1], '/');
  const c = hgate(['--compare-only']);
  assert.equal(c.status, 0, c.stderr + c.stdout); assert.equal(c.by('ORIGIN', 'home').length + c.by('EDS', 'home').length, 0, 'no capture'); assert.match(c.stdout, warned('home')); assert.deepEqual(c.row('home').hideMiss, MISS);
});
check('hide miss 3: live-session\'s hideMissLine is the text when the diff dir has one (one text for every tool); without it the same text is built here — and no candidate reads "none found above the header"', () => {
  setPresence({ home: { hide: ['.promo-strip', '.gone'] } });
  const none = hgate(['--only', 'home'], { STUB_HIDE_MISS: JSON.stringify({ sels: ['.promo-strip', '.gone'], candidates: [] }) });
  assert.equal(none.status, 0, none.stderr + none.stdout); assert.equal(none.by('ORIGIN', 'home').length, 1, 'another list: re-stitched');
  const text = 'hide matched nothing on live — candidates: none found above the header (.promo-strip, .gone)';
  assert.match(none.stdout, warned('home', text));
  renameSync(join(HDS, 'live-session.mjs'), join(HDS, 'live-session-real.mjs'));
  try {
    writeFileSync(join(HDS, 'live-session.mjs'), "export * from './live-session-real.mjs';\nexport function hideMissLine(sels, list) { return `helper: ${sels.join(' + ')} / ${list.length} candidate(s)`; }\n");
    assert.match(hgate(['--only', 'home']).stdout, warned('home', 'helper: .promo-strip + .gone / 0 candidate(s)'));
    writeFileSync(join(HDS, 'live-session.mjs'), "export { freshness, maxAgeHours, mergePresence, presenceHide, reuseRecord, runStartAt, SITE_PRESENCE } from './live-session-real.mjs';\n");
    assert.match(hgate(['--only', 'home']).stdout, warned('home', text), 'no hideMissLine: the same text');
  } finally { rmSync(join(HDS, 'live-session.mjs')); renameSync(join(HDS, 'live-session-real.mjs'), join(HDS, 'live-session.mjs')); }
});
check('hide miss 4: a copied live.png carries its capture record\'s hideMiss (gate.sh\'s live-shot.json beside it) — the WARNING and the row\'s hideMiss; no miss anywhere → no WARNING, totals.hideMiss 0, no summary line', () => {
  setPresence({ about: { hide: ['.promo-strip'] } });
  const g = join(hroot, 'stardust/replica/gates/about-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  writeFileSync(join(g, 'live.json'), JSON.stringify(liveJson('https://www.example.com/about', ['.promo-strip'])));
  writeFileSync(join(g, 'live-shot.json'), JSON.stringify({ overlayLeft: null, fontsFailed: [], hideMiss: MISS }));
  try {
    const r = hgate([]);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.by('ORIGIN', 'about').length, 0); assert.equal(r.row('about').originReused.from, 'stardust/replica/gates/about-1440/live.png');
    assert.match(r.stdout, warned('about')); assert.deepEqual(r.row('about').hideMiss, MISS); assert.deepEqual(hjson('about', 'origin.json').hideMiss, MISS);
  } finally { rmSync(g, { recursive: true, force: true }); }
  setPresence({});
  const clean = hgate([]);
  assert.equal(clean.status, 0, clean.stderr + clean.stdout); assert.doesNotMatch(clean.stdout, / WARNING /);
  const s = JSON.parse(readFileSync(join(HOUT, 'summary.json'), 'utf8'));
  assert.equal(s.totals.hideMiss, 0); assert.ok(s.rows.every((x) => !('hideMiss' in x))); assert.doesNotMatch(readFileSync(join(HOUT, 'summary.md'), 'utf8'), MISS_MD);
});
rmSync(hroot, { recursive: true, force: true });

// ---- gate trust sandbox: a polluted capture → an INCONCLUSIVE row ----------------------------------------------------
// Its own project (the hide sandbox pattern): stub instruments, the real live-session.mjs and foundation-freeze.mjs.
// stitch-shot writes its --json record from STUB_OVERLAY_* / STUB_FONTS_* (STUB_NO_JSON: no record, an older copy) and
// fails the origin with STUB_ORIGIN_RC; pixel-compare fails the slugs in STUB_FAIL (at STUB_FAIL_PCT %, default 30); content-presence clips 3 on the build
// side of the slugs in STUB_CLIP_FAIL.
const troot = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-trust-')));
const TRS = join(troot, 'stardust/scripts/replica'); const TDS = join(troot, 'stardust/scripts/diff'); const TLOG = join(troot, 'stitch.log');
const TOUT = join(troot, 'stardust/replica/gates/all-1440');
mkdirSync(TRS, { recursive: true }); mkdirSync(TDS, { recursive: true });
cpSync(SCRIPT, join(TRS, 'gate-all.mjs')); cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(TRS, 'foundation-freeze.mjs')); cpSync(join(DIFF, 'live-session.mjs'), join(TDS, 'live-session.mjs'));
stub(TRS, 'stitch-shot.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
const a = process.argv.slice(2); const side = /www\\.example\\.com/.test(a[0]) ? 'ORIGIN' : 'EDS';
appendFileSync(${JSON.stringify(TLOG)}, side + ' ' + a.join(' ') + '\\n');
if (side === 'ORIGIN' && process.env.STUB_ORIGIN_RC) { console.error('stitch-shot error: stub exit ' + process.env.STUB_ORIGIN_RC); process.exit(Number(process.env.STUB_ORIGIN_RC)); }
writeFileSync(a[1], 'png');
if (!process.env.STUB_NO_JSON) { ${SHOT_RECORD('side')} }`);
stub(TRS, 'pixel-compare.mjs', `import { basename, dirname } from 'node:path';
const pct = (process.env.STUB_FAIL || '').split(',').includes(basename(dirname(process.argv[2]))) ? Number(process.env.STUB_FAIL_PCT || 30) : 1.5;
console.log(JSON.stringify({ pct, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: pct <= 10 }));`);
stub(TDS, 'content-presence.mjs', `import { writeFileSync } from 'node:fs'; import { basename, dirname } from 'node:path';
const a = process.argv; const out = a[a.indexOf('--json') + 1]; const n = (process.env.STUB_CLIP_FAIL || '').split(',').includes(basename(dirname(out))) ? 3 : 0;
const counts = (total) => ({ total, textClipped: total, textHidden: 0, controlHidden: 0, controlClipped: 0 });
writeFileSync(out, JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, scope: 'root', totals: { missing: 0, hidden: 0, controlState: 0 }, eds: { clip: { counts: counts(n), groups: [] } }, origin: { clip: { counts: counts(0), groups: [] } } }));`);
stub(TDS, 'unit-geometry.mjs', 'export function unitsFor() { return []; }');
appendFileSync(join(troot, 'stardust/status.jsonl'), `${JSON.stringify({ ts: new Date(Date.now() - 60e3).toISOString(), skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' })}\n`);
const tpages = (slugs) => writeFileSync(join(troot, 'stardust/state.json'), JSON.stringify({ pages: slugs.map((slug) => ({ slug, url: `https://www.example.com/${slug}`, liveUrl: `https://main--site--org.aem.live/${slug}`, status: 'deployed', template: 'page' })) }));
const tgate = (args, env = {}) => {
  rmSync(TLOG, { force: true }); clearRounds(TOUT);
  const e = { ...process.env, ...env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, [join(TRS, 'gate-all.mjs'), '--width', '1440', ...args], { cwd: troot, env: e, encoding: 'utf8', timeout: 60e3 });
  const run = (r.stdout.match(/run → (.*)/) || [])[1]; const s = JSON.parse(readFileSync(run ? join(troot, run) : join(TOUT, 'summary.json'), 'utf8'));
  return { ...r, s, row: (slug) => s.rows.find((x) => x.slug === slug), md: run ? r.stdout : readFileSync(join(TOUT, 'summary.md'), 'utf8'), stitches: (side) => lines(TLOG).filter((l) => l.startsWith(`${side} `)) };
};
const tjson = (slug, f) => JSON.parse(readFileSync(join(TOUT, slug, f), 'utf8'));
const tlog = () => readFileSync(join(TOUT, '_run.log'), 'utf8');
const UNCHECKED = 'unchecked (stitch-shot wrote no --json record — re-copy stitch-shot.mjs)';
tpages(['a']);
check('trust 1: an overlay left on the origin capture → the row is INCONCLUSIVE (measured, not judged), totals.inconclusive 1, fail 0, exit 2; summary.md says so; origin.json / eds.json record the stitch\'s --json record (<slug>/<side>-shot.json)', () => {
  const r = tgate([], { STUB_OVERLAY_ORIGIN: '#cmpbox (consent root visible)' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const row = r.row('a');
  assert.deepEqual([row.inconclusive, row.pixelPass, row.heightPass, row.pixelOnlyPass, row.pass, row.passWithOverride, row.pct], [true, null, null, false, false, false, 1.5]);
  assert.deepEqual(row.reasons, ['origin capture polluted: overlay left — #cmpbox (consent root visible)']);
  const t = r.s.totals; assert.deepEqual([t.pages, t.pass, t.fail, t.error, t.inconclusive, t.failPixel, t.failHeight], [1, 0, 0, 0, 1, 0, 0]);
  assert.match(r.md, /\*\*0 PASS \/ 0 FAIL \/ 0 error \/ 1 INCONCLUSIVE of 1\*\*/); assert.match(r.md, /\| INCONCLUSIVE \| origin capture polluted: overlay left — #cmpbox \(consent root visible\) \|/);
  assert.deepEqual([tjson('a', 'origin.json').overlayLeft, tjson('a', 'origin.json').fontsFailed, tjson('a', 'eds.json').overlayLeft], ['#cmpbox (consent root visible)', [], null]);
  for (const [side, f] of [['ORIGIN', 'origin'], ['EDS', 'eds']]) assert.ok(r.stitches(side)[0].includes(` --json stardust/replica/gates/all-1440/a/${f}-shot.json `), r.stitches(side)[0]);
  assert.match(tlog(), /origin a → stitch-live WARN overlay left — #cmpbox \(consent root visible\)/);
});
check('trust 2: a fix round never keeps an origin that left an overlay — re-stitched, logged; the clean one it takes is kept by the next', () => {
  const r = tgate(['--only', 'a']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.stitches('ORIGIN').length, 1);
  assert.match(tlog(), /origin a → not reused \(previous origin left an overlay \(#cmpbox \(consent root visible\)\)\)/);
  assert.deepEqual([r.row('a').inconclusive, r.row('a').pass], [false, true]);
  assert.equal(tgate(['--only', 'a']).stitches('ORIGIN').length, 0);
});
check('trust 3: an overlay left on the build capture → "build capture polluted: overlay left — …"', () => {
  const r = tgate([], { STUB_OVERLAY_EDS: 'div.modal (fixed, 92 % of the viewport)' });
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.row('a').inconclusive, true);
  assert.deepEqual(r.row('a').reasons, ['build capture polluted: overlay left — div.modal (fixed, 92 % of the viewport)']);
  assert.match(tlog(), /eds a → stitch-live WARN overlay left — div\.modal/);
});
check('trust 4: a crawl-fullpage origin fallback (the stitch failed, a crawl shot in --crawl-shots) → INCONCLUSIVE, the reason names the fallback and its note', () => {
  mkdirSync(join(troot, 'shots'), { recursive: true }); writeFileSync(join(troot, 'shots/a.png'), 'png');
  const r = tgate(['--crawl-shots', 'shots'], { STUB_ORIGIN_RC: '1' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const row = r.row('a'); assert.deepEqual([row.origin, row.originAsymmetric, row.inconclusive, row.pass], ['crawl-fullpage', true, true, false]);
  assert.deepEqual(row.reasons, ['origin capture polluted: crawl-fullpage fallback — stitch exit 1: stitch-shot error: stub exit 1 — crawl screenshot used']);
  assert.equal(r.s.totals.asymmetricOrigins, 1); assert.equal(r.s.totals.inconclusive, 1);
});
check('trust 5: a stitch-shot that writes no --json record (an older copy; the previous records deleted before each stitch) → both captures unchecked (overlay and font check), INCONCLUSIVE — never clean', () => {
  const r = tgate([], { STUB_NO_JSON: '1' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.deepEqual(r.row('a').reasons, [`origin capture polluted: overlay left — ${UNCHECKED}`, `build capture polluted: overlay left — ${UNCHECKED}`, 'font-check-skipped:origin', 'font-check-skipped:build']);
  assert.equal(existsSync(join(TOUT, 'a/eds-shot.json')), false, 'the last run\'s record was not read');
  assert.deepEqual([tjson('a', 'origin.json').overlayLeft, tjson('a', 'origin.json').fontsFailed], [UNCHECKED, null]);
});
// overrides.json: v valid; k a free-text kind; u an R-<nn> the register lacks; c clip FAIL — all four pixel-FAIL rows (at 15 %,
// inside the override magnitude: 2 × the 10 % threshold).
const OV = { v: { verdict: 'tier-shift', reason: 'R-01: the source serves another tier at 1440' }, k: { verdict: 'PASS (source capture)', reason: 'R-01: live drifted since capture' },
  u: { verdict: 'source-volatile', reason: 'R-09: a rotating hero' }, c: { verdict: 'instrument-artifact', reason: 'R-01: lazy rail' } };
const TREG = join(troot, REG);
check('trust 6: overrides.json — one valid, three invalid (kind, unknown register entry, clip FAIL) → overridePass 1, overrideRejected 3, overrideShare 0.2, exit 2; the head names counted / rejected and the share; each rejected rule is a row reason', () => {
  tpages(['a', 'v', 'k', 'u', 'c']); mkdirSync(TOUT, { recursive: true }); writeFileSync(join(TOUT, 'overrides.json'), JSON.stringify(OV));
  mkdirSync(dirname(TREG), { recursive: true }); writeFileSync(TREG, '# Inconsistency register\n\n## R-01 — the source serves another tier at this width\n\nSeen on R-09-like pages too.\n');
  const r = tgate([], { STUB_FAIL: 'v,k,u,c', STUB_FAIL_PCT: '15', STUB_CLIP_FAIL: 'c' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const t = r.s.totals; assert.deepEqual([t.pass, t.fail, t.overridePass, t.overrideRejected, t.overrideShare, t.passWithOverrides], [1, 4, 1, 3, 0.2, 2]);
  assert.deepEqual(r.row('v').override, { ...OV.v, valid: true }); assert.equal(r.row('v').passWithOverride, true); assert.deepEqual(r.row('v').reasons, ['pixel 15% > 10%']);
  const rejected = (slug) => { const row = r.row(slug); assert.equal(row.passWithOverride, false, slug); assert.equal(row.override.valid, false, slug); return [row.override.rejected, row.reasons.filter((x) => x.startsWith('override rejected: '))]; };
  assert.deepEqual(rejected('k'), [[`verdict "PASS (source capture)" ${KIND}`], [`override rejected: verdict "PASS (source capture)" ${KIND}`]]);
  assert.deepEqual(rejected('u'), [[`R-09 not in ${REG}`], [`override rejected: R-09 not in ${REG}`]]);
  assert.deepEqual(rejected('c'), [['clip and content must pass (clip FAIL, content PASS)'], ['override rejected: clip and content must pass (clip FAIL, content PASS)']]);
  assert.match(r.md, /\*\*1 PASS \/ 4 FAIL \/ 0 error of 5\*\* · overrides: 1 counted \/ 3 rejected — override share 1 of 5 \(20\.0 %\)/);
  assert.match(r.md, /→ tier-shift: R-01: the source serves another tier at 1440 \|/); assert.match(r.md, /→ PASS \(source capture\): R-01: live drifted since capture \(rejected\) \|/);
});
check('trust 7: every failing row lifted by a validated override → exit 0; the same overrides without the register → rejected, exit 2', () => {
  tpages(['a', 'v']);
  const r = tgate([], { STUB_FAIL: 'v', STUB_FAIL_PCT: '15' });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.deepEqual([r.s.totals.pass, r.s.totals.overridePass, r.s.totals.overrideRejected], [1, 1, 0]);
  rmSync(TREG);
  const g = tgate([], { STUB_FAIL: 'v', STUB_FAIL_PCT: '15' });
  assert.equal(g.status, 2, g.stderr + g.stdout); assert.deepEqual(g.row('v').override.rejected, [`no inconsistency register at ${REG}`]);
  assert.match(g.md, /overrides: 0 counted \/ 1 rejected — override share 0 of 2 \(0\.0 %\)/);
  tpages(['a']);
});
check('trust 7b: override magnitude — a pixel-FAIL row at 30 % (past 2 × the 10 % threshold) with an otherwise valid override stays FAIL: the reason as is, override.valid false with its magnitude, totals.overrideMagnitude 1, summary.md names the row, exit 2; at exactly 20 % the same override lifts it, exit 0', () => {
  tpages(['a', 'v']); writeFileSync(TREG, '# Inconsistency register\n\n## R-01 — the source serves another tier at this width\n');
  const r = tgate([], { STUB_FAIL: 'v' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const row = r.row('v');
  assert.deepEqual([row.pass, row.passWithOverride, row.override.valid, row.override.rejected, row.override.magnitude], [false, false, false, [MAG], { pct: 30, maxPct: 20, heightDelta: 0, maxHeightDelta: 300 }]);
  assert.deepEqual(row.reasons, ['pixel 30% > 10%', MAG]);
  const t = r.s.totals; assert.deepEqual([t.overridePass, t.overrideRejected, t.overrideMagnitude, t.fail], [0, 1, 1, 1]);
  assert.match(r.md, /^Override exceeds magnitude \(fix the capture \/ hide list, not a deviation\): \/v$/m);
  const e = tgate([], { STUB_FAIL: 'v', STUB_FAIL_PCT: '20' });
  assert.equal(e.status, 0, e.stderr + e.stdout); assert.deepEqual([e.row('v').override.valid, e.row('v').passWithOverride, e.s.totals.overrideMagnitude], [true, true, 0]);
  assert.doesNotMatch(e.md, /Override exceeds magnitude/);
  rmSync(TREG); tpages(['a']);
});
check('trust 8: a declared face that did not load on the build side (the record\'s fontsFailed) → a FAIL row with font-not-loaded:<family>, totals.fontsNotLoaded 1, the calibration line names it, exit 2', () => {
  tpages(['a']);
  const r = tgate([], { STUB_FONTS_EDS: 'Brand Sans' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const row = r.row('a'); assert.deepEqual([row.pass, row.pixelOnlyPass, row.inconclusive, row.fontsNotLoaded, row.reasons], [false, true, false, ['Brand Sans'], ['font-not-loaded:Brand Sans']]);
  assert.deepEqual(tjson('a', 'eds.json').fontsFailed, ['Brand Sans']); assert.deepEqual(tjson('a', 'origin.json').fontsFailed, []);
  assert.deepEqual([r.s.totals.fontsNotLoaded, r.s.totals.fail, r.s.totals.pass], [1, 1, 0]);
  assert.match(r.md, /Failing by criterion: pixel 0, height 0, clip 0, content 0, fonts not loaded 1 \(Brand Sans\);/); assert.match(r.md, /\| FAIL \(elements\) \| font-not-loaded:Brand Sans \|/);
  const both = tgate([], { STUB_FONTS_ORIGIN: 'Brand Serif,Brand Sans', STUB_FONTS_EDS: 'Brand Sans' });
  assert.deepEqual(both.row('a').reasons, ['font-not-loaded:Brand Sans', 'font-not-loaded:Brand Serif'], 'either side, once each');
  assert.match(both.md, /, fonts not loaded 1 \(Brand Sans, Brand Serif\);/);
  const clean = tgate([]); assert.equal(clean.status, 0, clean.stderr + clean.stdout); assert.equal(clean.s.totals.fontsNotLoaded, 0); assert.doesNotMatch(clean.md, /fonts not loaded/);
});
check('trust 9: a failed --recapture-origin that keeps a previous origin from before the overlay-left check (origin.json without overlayLeft) → unchecked, INCONCLUSIVE — never a clean PASS; a kept checked origin stays clean', () => {
  const meta = join(TOUT, 'a/origin.json'); const old = tjson('a', 'origin.json'); delete old.overlayLeft; delete old.fontsFailed;
  writeFileSync(meta, JSON.stringify(old, null, 2));
  const r = tgate(['--only', 'a', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stitches('ORIGIN').length, 1);
  const unchecked = 'unchecked (previous origin predates the overlay-left check)';
  assert.deepEqual([r.row('a').inconclusive, r.row('a').pass, r.row('a').originReused.policy], [true, false, 'same-run']);
  assert.deepEqual(r.row('a').reasons, [`origin capture polluted: overlay left — ${unchecked}`]);
  assert.deepEqual([tjson('a', 'origin.json').overlayLeft, tjson('a', 'origin.json').fontsFailed], [unchecked, []]);
  assert.match(tlog(), /origin a → stitch-live reused .*WARN re-shoot failed \(exit 1: .*\) — previous origin kept; overlay left — unchecked \(previous origin predates the overlay-left check\)/);
  assert.equal(tgate([]).status, 0, 'a full round re-stitches it');
  const kept = tgate(['--only', 'a', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.equal(kept.status, 0, kept.stderr + kept.stdout); assert.deepEqual([kept.row('a').inconclusive, tjson('a', 'origin.json').overlayLeft], [false, null]);
});
check('trust 10: a font check that could not run (record fontsFailed: null) → font-check-skipped:<side>, a FAIL row, exit 2 — carried from the stitch record, a kept origin after a failed --recapture-origin and a live.json; an absent key in live.json stays absent', () => {
  const r = tgate([], { STUB_FONTS_NULL_EDS: '1' });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  const row = r.row('a'); assert.deepEqual([row.pass, row.pixelOnlyPass, row.inconclusive, row.fontChecksSkipped, row.fontsNotLoaded, row.reasons], [false, true, false, ['build'], [], ['font-check-skipped:build']]);
  assert.deepEqual([tjson('a', 'eds.json').fontsFailed, tjson('a', 'eds.json').fontCheck, tjson('a', 'origin.json').fontsFailed], [null, 'failed: stub font check', []]);
  assert.deepEqual([r.s.totals.fontChecksSkipped, r.s.totals.fontsNotLoaded, r.s.totals.fail], [1, 0, 1]); assert.match(r.md, /, font check skipped 1; content n\/a/);
  assert.equal(tgate([], { STUB_FONTS_NULL_ORIGIN: '1' }).row('a').reasons[0], 'font-check-skipped:origin');
  const kept = tgate(['--only', 'a', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.equal(kept.status, 2, kept.stderr + kept.stdout); assert.deepEqual(kept.row('a').reasons, ['font-check-skipped:origin'], 'the kept origin\'s null is not read as all fonts loaded');
  assert.equal(tjson('a', 'origin.json').fontsFailed, null);
  const g = join(troot, 'stardust/replica/gates/a-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  const live = { writtenBy: 'gate.sh', url: 'https://www.example.com/a', width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, overlayLeft: null, fontsFailed: null, at: new Date().toISOString() };
  writeFileSync(join(g, 'live.json'), JSON.stringify(live));
  const l = tgate([]);
  assert.equal(l.status, 2, l.stderr + l.stdout); assert.equal(l.stitches('ORIGIN').length, 0); assert.equal(l.row('a').originReused.from, 'stardust/replica/gates/a-1440/live.png');
  assert.deepEqual([l.row('a').reasons, tjson('a', 'origin.json').fontsFailed], [['font-check-skipped:origin'], null]);
  const legacy = { ...live }; delete legacy.fontsFailed; writeFileSync(join(g, 'live.json'), JSON.stringify(legacy));
  const a = tgate([]);
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.stitches('ORIGIN').length, 0); assert.equal('fontsFailed' in tjson('a', 'origin.json'), false);
  rmSync(g, { recursive: true, force: true });
});
// a capture record from before the overlay-left check: origin.json / eds.json without the overlayLeft key (nor fontsFailed)
const legacyRecord = (f) => { const m = tjson('a', f); delete m.overlayLeft; delete m.fontsFailed; writeFileSync(join(TOUT, 'a', f), JSON.stringify(m, null, 2)); };
check('trust 11: --skip-existing never keeps a stitched origin whose record predates the overlay-left check — re-stitched, logged, the row has a verdict; a checked one is kept', () => {
  assert.equal(tgate([]).status, 0);
  assert.equal(tgate(['--skip-existing']).stitches('ORIGIN').length, 0, 'a checked origin is reused');
  legacyRecord('origin.json');
  const r = tgate(['--skip-existing']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.stitches('ORIGIN').length, 1);
  assert.match(tlog(), /origin a → not reused \(--skip-existing: no overlay-left record\)/);
  assert.deepEqual([r.row('a').inconclusive, r.row('a').pass, r.row('a').originReused, tjson('a', 'origin.json').overlayLeft], [false, true, null, null]);
});
check('trust 12: --compare-only (no captures) reads a stitched record without an overlay-left record as unchecked → INCONCLUSIVE, exit 2; its fontsFailed as recorded, the record on disk unchanged', () => {
  legacyRecord('origin.json'); legacyRecord('eds.json');
  const r = tgate(['--compare-only']);
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stitches('ORIGIN').length + r.stitches('EDS').length, 0);
  const unchecked = 'unchecked (capture predates the overlay-left check)';
  assert.deepEqual([r.row('a').inconclusive, r.row('a').reasons], [true, [`origin capture polluted: overlay left — ${unchecked}`, `build capture polluted: overlay left — ${unchecked}`]]);
  assert.deepEqual(['overlayLeft' in tjson('a', 'origin.json'), 'fontsFailed' in tjson('a', 'eds.json')], [false, false]);
});
check('trust 13: a failed --recapture-origin that keeps a previous origin taken with another --dismiss or hide list → INCONCLUSIVE ("origin capture polluted: kept origin taken with another dismiss/hide list"), exit 2, logged — not a verdict; the next round re-stitches it', () => {
  const KEPT = 'origin capture polluted: kept origin taken with another dismiss/hide list';
  assert.equal(tgate([]).status, 0, 'a clean origin, taken without a --dismiss or hide list');
  const d = tgate(['--only', 'a', '--recapture-origin', '--dismiss', '.nl-close'], { STUB_ORIGIN_RC: '1' });
  assert.equal(d.status, 2, d.stderr + d.stdout); assert.equal(d.stitches('ORIGIN').length, 1);
  assert.deepEqual([d.row('a').inconclusive, d.row('a').pass, d.row('a').pixelPass, d.row('a').reasons], [true, false, null, [KEPT]]);
  assert.equal(d.s.totals.inconclusive, 1); assert.equal('dismiss' in tjson('a', 'origin.json'), false, 'the kept record names the list it was taken with (none)');
  assert.match(tlog(), /origin a → stitch-live reused .*WARN re-shoot failed \(exit 1: .*\) — previous origin kept \(taken with another dismiss\/hide list: no verdict\)/);
  writeFileSync(join(TOUT, 'presence.json'), JSON.stringify({ '*': { hide: ['.geo-bar'] } }));
  try {
    const h = tgate(['--only', 'a', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
    assert.equal(h.status, 2, h.stderr + h.stdout); assert.deepEqual([h.row('a').inconclusive, h.row('a').reasons, h.row('a').hide], [true, [KEPT], ['.geo-bar']]);
    const next = tgate(['--only', 'a']);
    assert.equal(next.status, 0, next.stderr + next.stdout); assert.equal(next.stitches('ORIGIN').length, 1); assert.match(tlog(), /origin a → not reused \(hide list differs\)/);
    assert.deepEqual([next.row('a').inconclusive, next.row('a').pass], [false, true]);
  } finally { rmSync(join(TOUT, 'presence.json'), { force: true }); }
});
// ---- fix rounds (the cap is mechanical): the trust sandbox with its own --out per scenario family, never cleared --------
tpages(['a', 'b']);
const ROUT_REL = 'stardust/replica/gates/rounds-1440'; const ROUT = join(troot, ROUT_REL);
const rgate = (args, env = {}, out = ROUT_REL) => {
  rmSync(TLOG, { force: true });
  const e = { ...process.env, ...env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT', 'STARDUST_BROWSERS_PER_SLOT', 'RUN_BG_DEADLINE_SEC']) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, [join(TRS, 'gate-all.mjs'), '--width', '1440', '--out', out, ...args], { cwd: troot, env: e, encoding: 'utf8', timeout: 60e3 });
  const run = (r.stdout.match(/run → (.*)/) || [])[1];
  const doc = (() => { try { return JSON.parse(readFileSync(join(troot, run || join(out, 'summary.json')), 'utf8')); } catch { return null; } })();
  return { ...r, doc, row: (slug) => doc.rows.find((x) => x.slug === slug), stitches: lines(TLOG).length, log: () => readFileSync(join(troot, out, '_run.log'), 'utf8') };
};
const roundsFile = (slug, out = ROUT) => join(out, slug, 'rounds.json');
const roundsJson = (slug, out = ROUT) => JSON.parse(readFileSync(roundsFile(slug, out), 'utf8'));
const tree = () => readdirSync(troot, { recursive: true }).sort();
const ROUND_ATS = [];
check('rounds 1: three --only a runs with a verdict count 1, 2, 3 — rounds.json { rounds, max, at } (indent 1, trailing newline; at = each run table\'s writtenAt), every row stamped round, _provenance.maxRounds 3; no rounds.lock left', () => {
  for (const i of [1, 2, 3]) {
    const r = rgate(['--only', 'a']);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.row('a').round, i); assert.equal(r.doc._provenance.maxRounds, 3);
    ROUND_ATS.push(r.doc._provenance.writtenAt); assert.equal(existsSync(join(ROUT, 'a', 'rounds.lock')), false, 'the reservation is released');
    assert.match(r.log(), new RegExp(`rounds @1440: a ${i}/3$`, 'm'));
  }
  assert.deepEqual(roundsJson('a'), { rounds: 3, max: 3, at: ROUND_ATS });
  assert.equal(readFileSync(roundsFile('a'), 'utf8'), `${JSON.stringify({ rounds: 3, max: 3, at: ROUND_ATS }, null, 1)}\n`);
  assert.equal(existsSync(join(ROUT, 'b')), false, 'b was never selected');
});
check('rounds 2: a 4th --only round is refused before any write — exit 2, one stderr line (no verdict, cap reached — re-prototype decision, a 3/3 @1440, the remedy), no capture, the tree unchanged (b\'s reservation dir removed); --max-rounds 2 refuses too; a full run neither counts nor refuses', () => {
  rmSync(TLOG, { force: true }); const before = tree();
  const r = rgate(['--only', 'a,b']);
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.match(r.stderr, /no verdict/); assert.match(r.stderr, /cap reached — re-prototype decision: a 3\/3 @1440 \(/); assert.doesNotMatch(r.stderr, / b \d/);
  assert.match(r.stderr, /drop a from --only, or record the re-prototype decision with --round-reset "<reason>"/);
  assert.equal(r.stitches, 0); assert.deepEqual(tree(), before);
  const low = rgate(['--only', 'a', '--max-rounds', '2']);
  assert.equal(low.status, 2, low.stderr + low.stdout); assert.match(low.stderr, /cap reached — re-prototype decision: a 3\/2 @1440 \(the fix-round cap, --max-rounds 2\)/); assert.deepEqual(tree(), before);
  const full = rgate([]);
  assert.equal(full.status, 0, full.stderr + full.stdout); assert.deepEqual([full.row('a').round, full.row('b').round], [3, 0]); assert.equal(full.doc._provenance.maxRounds, 3);
  assert.deepEqual(roundsJson('a'), { rounds: 3, max: 3, at: ROUND_ATS }); assert.equal(existsSync(roundsFile('b')), false, 'a full run writes no count');
});
check('rounds 3: --max-rounds takes 1..3 only (it may only lower the cap) — 4, 0, 2.5, x → usage exit 1 naming --round-reset; --round-reset needs --only and a reason → usage exit 1; either without its value → exit 2 (a value flag without its value); nothing written', () => {
  const usage = (args, re, status = 1) => {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-all-rounds-usage-'));
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, status, `${args.join(' ')}: ${r.stderr}`); assert.match(r.stderr, re, args.join(' ')); assert.deepEqual(readdirSync(cwd), []);
    rmSync(cwd, { recursive: true, force: true });
  };
  for (const bad of ['4', '0', '2.5', 'x']) usage(['--only', 'a', '--max-rounds', bad], new RegExp(`^--max-rounds must be an integer from 1 to 3 \\(got ${bad.replace('.', '\\.')}\\) — it may only lower the cap; .* --round-reset "<reason>"`));
  usage(['--max-rounds'], /^gate-all: --max-rounds needs a value, got nothing$/m, 2);
  usage(['--round-reset', 're-prototyped'], /^--round-reset needs --only <slug,…>/);
  usage(['--only', 'a', '--round-reset', ' '], /^--round-reset takes the re-prototype decision's reason, a non-empty text/);
  usage(['--only', 'a', '--round-reset'], /^gate-all: --round-reset needs a value, got nothing$/m, 2);
});
const REASON = 're-prototyped the hero section';
check('rounds 4: --round-reset "<reason>" — the selected page at the cap starts a new count (resets[{ at, reason, from 3, history }], the row\'s roundReset, round 1), a selected page below the cap is not reset; then no page at the cap → one log line, nothing reset', () => {
  const r = rgate(['--only', 'a,b', '--round-reset', REASON]);
  assert.equal(r.status, 0, r.stderr + r.stdout); const t = r.doc._provenance.writtenAt;
  assert.deepEqual(roundsJson('a'), { rounds: 1, max: 3, at: [t], resets: [{ at: t, reason: REASON, from: 3, history: ROUND_ATS }] });
  assert.deepEqual([r.row('a').round, r.row('a').roundReset], [1, { reason: REASON, at: t }]);
  assert.deepEqual([r.row('b').round, 'roundReset' in r.row('b'), roundsJson('b')], [1, false, { rounds: 1, max: 3, at: [t] }]);
  assert.match(r.log(), new RegExp(`round-reset: a 3/3 @1440 → a new count \\(${REASON}\\)$`, 'm')); assert.match(r.log(), /rounds @1440: a 1\/3 \(after the reset\), b 1\/3$/m);
  const again = rgate(['--only', 'a', '--round-reset', 'once more']);
  assert.equal(again.status, 0, again.stderr + again.stdout); assert.match(again.log(), /round-reset: no --only slug at the cap — nothing reset$/m);
  assert.deepEqual([again.row('a').round, 'roundReset' in again.row('a'), roundsJson('a').rounds, roundsJson('a').resets.length], [2, false, 2, 1]);
});
check('rounds 5: an INCONCLUSIVE row (a crawl-fullpage origin fallback) is no round — rounds.json untouched, the row carries the current count, logged', () => {
  mkdirSync(join(troot, 'shots'), { recursive: true }); writeFileSync(join(troot, 'shots/a.png'), 'png');
  const before = readFileSync(roundsFile('a'), 'utf8');
  const r = rgate(['--only', 'a', '--recapture-origin', '--blocked', 'example\\.com/a', '--crawl-shots', 'shots']);
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.deepEqual([r.row('a').inconclusive, r.row('a').origin, r.row('a').round], [true, 'crawl-fullpage', 2]);
  assert.equal(readFileSync(roundsFile('a'), 'utf8'), before); assert.match(r.log(), /rounds @1440: a 2\/3 \(no verdict — not counted\)$/m);
});
check('rounds 6: the reservation — a rounds.lock of a running process refuses the run (no verdict — a round of <slug> is in progress (pid n), the lock\'s age and the recovery), its lock kept, the other selected page\'s lock released; a dead process\'s lock is reaped (logged) and the round counts; a partial or empty lock is held while it may be being written (a live pid in it, or younger than 30 s), an old unreadable one reaped; no lock, temp or reap file left behind', () => {
  const lock = (slug) => join(ROUT, slug, 'rounds.lock'); const live = `${JSON.stringify({ pid: process.pid, at: RT(1) })}\n`;
  writeFileSync(lock('b'), live);
  const before = readFileSync(roundsFile('a'), 'utf8');
  const r = rgate(['--only', 'a,b']);
  assert.equal(r.status, 2, r.stderr + r.stdout); assert.equal(r.stdout, ''); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`no verdict — a round of b is in progress \\(pid ${process.pid}\\) — lock taken ${RT(1).replace(/\./g, '\\.')} \\(\\d+ d ago\\): ${ROUT_REL}/b/rounds\\.lock; wait for that run to end, or remove ${ROUT_REL}/b/rounds\\.lock if no gate-all run is active$`, 'm')); assert.equal(r.stitches, 0);
  assert.equal(readFileSync(lock('b'), 'utf8'), live, 'another run\'s lock is never removed'); assert.equal(existsSync(lock('a')), false, 'a\'s reservation released');
  assert.equal(readFileSync(roundsFile('a'), 'utf8'), before);
  const dead = spawnSync(process.execPath, ['-e', '']).pid; // exited: its pid is no running process
  writeFileSync(lock('b'), `${JSON.stringify({ pid: dead, at: RT(2) })}\n`);
  const g = rgate(['--only', 'b']);
  assert.equal(g.status, 0, g.stderr + g.stdout); assert.match(g.log(), new RegExp(`rounds lock b → reaped pid ${dead} \\(not running; taken ${RT(2).replace(/\./g, '\\.')}\\)$`, 'm'));
  assert.deepEqual([g.row('b').round, roundsJson('b').rounds], [2, 2]); assert.equal(existsSync(lock('b')), false);
  // a lock caught mid-write (partial JSON naming a running pid) or empty and young is never reaped as garbage
  const refused = (content, re) => {
    writeFileSync(lock('b'), content); const before2 = readFileSync(roundsFile('b'), 'utf8');
    const x = rgate(['--only', 'b']);
    assert.equal(x.status, 2, x.stderr + x.stdout); assert.match(x.stderr, re); assert.equal(x.stitches, 0);
    assert.equal(readFileSync(lock('b'), 'utf8'), content, 'the lock left as it was'); assert.equal(readFileSync(roundsFile('b'), 'utf8'), before2);
  };
  refused(`{"pid":${process.pid},"at":"20`, new RegExp(`a round of b is in progress \\(pid ${process.pid}\\) — lock taken `));
  refused('', /a round of b is in progress \(pid unknown\) — lock taken \S+ \(\d+ s ago\): .*remove \S+rounds\.lock if no gate-all run is active$/m);
  const old = new Date(Date.now() - 3600e3); utimesSync(lock('b'), old, old); // the same empty lock, an hour old: no writer is still at it
  const o = rgate(['--only', 'b']);
  assert.equal(o.status, 0, o.stderr + o.stdout); assert.match(o.log(), /rounds lock b → reaped an unreadable lock \(60 min old\)$/m); assert.equal(o.row('b').round, 3);
  assert.deepEqual(readdirSync(join(ROUT, 'b')).filter((f) => f.startsWith('rounds.lock')), [], 'no lock, temp or reap file left');
});
check('rounds 7: legacy seed — no rounds.json: the run tables with a verdict row for the page seed the count (an INCONCLUSIVE or error row is none, a reused row is one); the first write records seeded: "runs", seededFrom; the next --only is refused at the cap', () => {
  const LREL = 'stardust/replica/gates/legacy-1440'; const LOUT = join(troot, LREL); mkdirSync(join(LOUT, 'runs'), { recursive: true });
  const table = (m, row) => writeFileSync(join(LOUT, 'runs', `${RT(m).replace(/[:.]/g, '-')}-a.json`), JSON.stringify({ _provenance: { writtenBy: 'gate-all.mjs', writtenAt: RT(m), breakpoint: 1440 }, rows: [{ slug: 'a', ...row }] }));
  table(1, { pct: 2, pass: true }); table(2, { pct: 1.5, inconclusive: true }); table(3, { pct: null, error: 'missing capture' }); table(4, { pct: 2, pass: true, reused: { what: 'row', at: RT(1) } });
  assert.deepEqual(roundsOf(LOUT, 'a'), { rounds: 2, max: 3, at: [RT(1), RT(4)], resets: [], from: 'runs' });
  const r = rgate(['--only', 'a'], {}, LREL);
  assert.equal(r.status, 0, r.stderr + r.stdout); const t = r.doc._provenance.writtenAt;
  assert.deepEqual(roundsJson('a', LOUT), { rounds: 3, max: 3, at: [RT(1), RT(4), t], seeded: 'runs', seededFrom: 2 }); assert.equal(r.row('a').round, 3);
  const capped = rgate(['--only', 'a'], {}, LREL);
  assert.equal(capped.status, 2, capped.stderr + capped.stdout); assert.match(capped.stderr, /cap reached — re-prototype decision: a 3\/3 @1440 /);
});
rmSync(troot, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
