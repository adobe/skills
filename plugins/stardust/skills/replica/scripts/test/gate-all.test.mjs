#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag); parseArgs defaults and
// --out derived from --width; --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff; staleCapture (a
// capture with no fixedLayers in its record is retaken, gate.sh's rule).
// Fonts (gate rule 14): shotFonts reads a stitch capture record (a list = checked, null + fontCheck when the check
// could not run, when the record predates the check or when there is none), fontsNotLoaded (each dead face with its
// side) / fontChecksSkipped over the two metas (explicit null only), the rule's four cases in verdict — dead on the
// source only: reported, passes; dead on the build only: font-not-loaded:<family>, fails; dead on both: reported,
// passes; a check that did not run: font-check-skipped:<side>, fails — the calibration line and the FAIL (fonts) cell;
// then the runner with stub instruments (stitch-shot writes the record, pixel-compare the JSON): the meta carries
// fontsFailed, the prototype stage reads the record of the archetype round's live.png it reuses (or the
// frozen baseline's after a flagged round; one staleCapture refuses is captured afresh) — none is unchecked, never "all loaded".
// Selection (selectPages): state only / the rollout ledger only / both merged / neither, --only, --eds-host, skipped rows,
// and the runner's "two sources consulted" error. Child commands: --consent / --dismiss / --no-dismiss / --locale reach
// both captures and every probe that takes them (CHILD_FLAGS against each child's own source). Verdict integrity: a
// probe error is an error row, never a pass or a FAIL; --compare-only spawns no capture and no probe and re-reads
// probes.json; a failed re-capture leaves no PNG to diff.
// Disk (#156): a passed page keeps its records, not its PNGs, and --skip-existing reuses that recorded pass — a run with
// stub instruments, no browser. Reuse: the recorded pass is the whole verdict (no probe), each key ingredient
// invalidates it, an incomplete or older record is not reused, it is on disk before the batch ends, kill and resume.
// Local build inputs in the key: the page's content file, its blocks, the shared code; unresolvable = never reused.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HINT, deadlineHint, PASS_FORMAT, localInputs, passKey, recordedPass, repeatGroups, unitsNote, unitsState, rosterOffsets, ROSTER_OFFSETS } from '../gate-all.mjs';
import { BATCH, CHILD_FLAGS, DELIVERED, HOLD_DEFAULT, HOLD_DEFAULT_WHY, refHold, UNSTABLE, WIDE_DEFAULT, referenceOf, wideFlagged, wideLine, wideWidth, captureRecordOf, clipArgs, contentArgs, limiter, browserBudget, maxBrowsersOf, budgetLine, dropPassedCaptures, droppedPass, fontChecksSkipped, fontFails, fontsNotLoaded, unselected, referenceIgnoreNote, REFERENCE_IGNORES, givenFlags, inheritedOpts, formatSummary, isErrorRow, LEGACY_WAIVES, overrideScope, parseArgs, passThrough, hostOrigin, migratedPathOf, recordedProbes, recordRounds, selectPages, shotFonts, staleCapture, staleReason, holdMismatch, envHold, hintOf, stitchArgs, unitArgs, verdict } from '../gate-all.mjs';

// pixel-compare imports pngjs at module level (a project devDependency, absent in the plugin checkout):
// import it lazily and skip its one check where it does not resolve, like the other browser/dep-bound tests.
let textBoxPct = null;
try { ({ textBoxPct } = await import('../pixel-compare.mjs')); } catch { console.log('skip  pixel-compare textBoxPct (pngjs not importable here)'); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-all.mjs');
// The sandboxes' pixel-compare stub: gate-all imports the pixel criterion (pixelVerdict) from pixel-compare.mjs, so a
// stub re-exports the REAL module and runs its stub body only as the main module. The stitch stubs hand `baseline`
// (a browserless subcommand) to the real stitch-shot. The runner sections written for the live-origin table run it
// through GATE_REFERENCE=live (the helpers' default); the reference sections pass REF.
const REAL_PIXEL = join(HERE, '..', 'pixel-compare.mjs');
const REAL_STITCH = join(HERE, '..', 'stitch-shot.mjs');
const REAL_REFERENCE = join(HERE, '..', 'reference.mjs');
const MAIN_ONLY = `import { realpathSync as __rp } from 'node:fs'; import { fileURLToPath as __fu } from 'node:url'; if (process.argv[1] && __rp(process.argv[1]) === __fu(import.meta.url))`;
const REF = { GATE_REFERENCE: '' };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const px = (pct, heightDelta, height = 10000) => ({ pct, heightDelta, compared: { width: 1440, height }, pass: pct <= 10 });
const clip = (total) => ({ counts: { total, textClipped: total, textHidden: 0, controlHidden: 0, controlClipped: 0 } });
const content = (missing, hidden, controlState = 0) => ({ totals: { missing, hidden, controlState } });

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
check('missing capture / pixel error → not compared, reasons say so; override shows beside, never replaces', () => {
  const v = verdict({ pixel: { error: 'missing capture' }, override: { verdict: 'PASS (source capture)', reason: 'live drifted' } });
  assert.equal(v.pass, false); assert.equal(v.passWithOverride, true); assert.match(v.reasons[0], /missing capture/);
});
check('override scope: a fonts override on a row that also fails units is NOT delivered (the 2026-11 field case); naming units delivers it', () => {
  const units = { verdict: { off: 18, hidden: 0, missing: 0, errors: 0 }, required: true };
  const row = { pixel: px(0, 0), clip: clip(0), content: content(0, 0), units, capture: { fonts: ['Satoshi Fallback'], fontsSkipped: [] } };
  const legacy = verdict({ ...row, override: { verdict: 'PASS (instrument override)', reason: 'origin-only dead faces' } });
  assert.deepEqual([legacy.pass, legacy.failing, legacy.unwaived, legacy.passWithOverride], [false, ['units', 'fonts'], ['units'], false]);
  const named = verdict({ ...row, override: { verdict: 'PASS', reason: 'R-02', waives: ['fonts'] } });
  assert.deepEqual([named.unwaived, named.passWithOverride], [['units'], false], 'waives fonts only: units still fail the row');
  const both = verdict({ ...row, override: { verdict: 'PASS', reason: 'R-02', waives: ['fonts', 'units'] } });
  assert.deepEqual([both.unwaived, both.passWithOverride], [[], true]);
});
check('override scope: an entry without waives keeps the documented scope (tier-shift pixel/height, capture, fonts), never clip or content', () => {
  assert.deepEqual(LEGACY_WAIVES, ['capture', 'pixel', 'height', 'fonts']);
  const tier = verdict({ pixel: px(14, 900), clip: clip(0), content: content(0, 0), override: { verdict: 'tier-shift', reason: 'R-01' } });
  assert.deepEqual([tier.failing, tier.passWithOverride], [['pixel', 'height'], true], 'a tier-shift row is still delivered');
  const clipped = verdict({ pixel: px(14, 0), clip: clip(5), content: content(0, 0), override: { verdict: 'tier-shift', reason: 'R-01' } });
  assert.deepEqual([clipped.unwaived, clipped.passWithOverride], [['clip'], false], 'tier-shift only when clip and content pass');
  const hidden = verdict({ pixel: px(1, 0), clip: clip(0), content: content(0, 4), override: { verdict: 'PASS', reason: 'R-03' } });
  assert.deepEqual([hidden.unwaived, hidden.passWithOverride], [['content'], false]);
  const named = verdict({ pixel: px(1, 0), clip: clip(0), content: content(0, 4), override: { verdict: 'PASS', reason: 'R-03', waives: ['content'] } });
  assert.equal(named.passWithOverride, true);
});
check('overrideScope: unknown names waive nothing and are reported; no override → empty scope', () => {
  assert.deepEqual(overrideScope({ verdict: 'PASS', reason: 'x', waives: ['fonts', 'unit'] }), { waives: ['fonts'], legacy: false, unknown: ['unit'] });
  assert.deepEqual(overrideScope({ verdict: 'PASS', reason: 'x' }), { waives: LEGACY_WAIVES, legacy: true, unknown: [] });
  assert.deepEqual(overrideScope(null), { waives: [], legacy: false, unknown: [] });
  const typo = verdict({ pixel: px(0, 0), clip: clip(0), content: content(0, 0), units: { verdict: { off: 2, hidden: 0, missing: 0, errors: 0 }, required: true }, override: { verdict: 'PASS', reason: 'x', waives: ['unit'] } });
  assert.equal(typo.passWithOverride, false, 'a misspelt criterion does not waive it');
});
check('formatSummary: an override that does not cover the row says NOT WAIVED and names what is left', () => {
  const r = { slug: 'a', path: '/a', pct: 0, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: { off: 18, hidden: 0, missing: 0 }, unitsRequired: true, pass: false, pixelOnlyPass: true, reasons: ['units off 18 hidden 0 missing 0', 'font-not-loaded:X'], failing: ['units', 'fonts'], unwaived: ['units'], passWithOverride: false, override: { verdict: 'PASS (instrument override)', reason: 'dead faces', waives: ['fonts'] }, error: null };
  const totals = { pages: 1, pass: 0, pixelOnlyPass: 1, overridePass: 0, passWithOverrides: 0, fail: 1, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, failUnits: 1, contentNA: 0 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 360, verdict: 'V' }, totals, rows: [r] });
  assert.match(md, /FAIL \(elements\) → NOT WAIVED: units \(override waives fonts\): dead faces/);
  assert.doesNotMatch(md, /documented override/);
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
  assert.match(md, /\| `\/a` \|.*FAIL \(elements\)/); assert.match(md, /\| 6\.68 \[12\.3\] \| - \| 69 \|/); assert.match(md, /crawl-fullpage ⚠asym/); assert.match(md, /n\/a \(origin HTTP 403\)/); assert.match(md, /masked 70 rows: store notice/); assert.match(md, /→ PASS \(source capture\): live drifted/);
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
check('staleCapture: gate.sh\'s rule — a capture is reusable only when its capture record has fixedLayers; a baseline copy of live.png goes by baseline.json', () => {
  const d = mkdtempSync(join(tmpdir(), 'gate-all-stale-'));
  try {
    const png = (name) => { const f = join(d, name); writeFileSync(f, 'png'); return f; };
    const origin = png('origin.png');
    assert.equal(captureRecordOf(origin), join(d, 'origin.capture.json'));
    assert.equal(staleCapture(origin), true, 'no record: an old-style capture');
    writeFileSync(captureRecordOf(origin), JSON.stringify({ chunks: 4, denialCheck: 'ok' }));
    assert.equal(staleCapture(origin), true, 'a record from before fixedLayers');
    writeFileSync(captureRecordOf(origin), '{ torn');
    assert.equal(staleCapture(origin), true, 'an unreadable record');
    writeFileSync(captureRecordOf(origin), JSON.stringify({ fixedLayers: { capture: 'once', count: 2, late: 0 } }));
    assert.equal(staleCapture(origin), false);
    const live = png('live.png');
    writeFileSync(join(d, 'live.json'), JSON.stringify({ origin: 'baseline' }));
    writeFileSync(join(d, 'baseline.json'), JSON.stringify({ fixedLayers: null }));
    assert.equal(staleCapture(live), true, 'a copy of a baseline frozen the old way');
    writeFileSync(join(d, 'baseline.json'), JSON.stringify({ fixedLayers: { capture: 'once', count: 1 } }));
    assert.equal(staleCapture(live), false, 'a copy of a baseline frozen the new way');
    writeFileSync(join(d, 'live.json'), JSON.stringify({ origin: 'live' }));
    assert.equal(staleCapture(live), true, 'a live round with no live.capture.json');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---- fonts (gate rule 14): a dead face on either side fails the row; a check that could not run is never a pass -----
const live = (fontsFailed, extra = {}) => ({ instrument: 'stitch-live', url: 'https://origin.example/', ...extra, ...(fontsFailed === undefined ? {} : { fontsFailed }) });
check('shotFonts: a record with a list is checked (strings only); null, an absent key or no record at all → fontsFailed null + a fontCheck saying why — never []', () => {
  assert.deepEqual(shotFonts({ fontsFailed: ['Brand Sans', 7, '', 'Brand Serif'] }), { fontsFailed: ['Brand Sans', 'Brand Serif'] });
  assert.deepEqual(shotFonts({ fontsFailed: [] }), { fontsFailed: [] });
  assert.deepEqual(shotFonts({ fontsFailed: null, fontCheck: 'failed: fonts unavailable' }), { fontsFailed: null, fontCheck: 'failed: fonts unavailable' });
  assert.deepEqual(shotFonts({ fontsFailed: null }), { fontsFailed: null, fontCheck: 'failed: the check could not run' });
  assert.deepEqual(shotFonts({ url: 'x', height: 10 }), { fontsFailed: null, fontCheck: 'failed: the capture record predates the font check — re-copy stitch-shot.mjs' });
  assert.deepEqual(shotFonts(null), { fontsFailed: null, fontCheck: 'failed: no readable capture record (stitch-shot wrote no capture record — re-copy stitch-shot.mjs)' });
  assert.deepEqual(shotFonts(undefined, { missing: 'no live.capture.json beside live.png' }), { fontsFailed: null, fontCheck: 'failed: no live.capture.json beside live.png' });
});
check('fontsNotLoaded: the metas\' fontsFailed of both sides with the side each face is dead on — sorted, one entry per family; a meta without a list (null, absent, a crawl shot, a failed capture) adds none', () => {
  assert.deepEqual(fontsNotLoaded(live(['B', 'A']), live(['A', 'C'])), [{ family: 'A', side: 'both' }, { family: 'B', side: 'origin' }, { family: 'C', side: 'eds' }]);
  assert.deepEqual(fontsNotLoaded(live(['"brand sans"']), live(['Brand Sans'])), [{ family: 'Brand Sans', side: 'both' }], 'one family whatever the quoting and case');
  assert.deepEqual(fontsNotLoaded(live([]), live(['Brand Sans', 'brand sans'])), [{ family: 'brand sans', side: 'eds' }], 'a family the build lists twice is dead on the build alone');
  const faces = (fontsFailed, deadFaces) => ({ ...live(fontsFailed), deadFaces });
  assert.deepEqual(fontsNotLoaded(faces(['Brand'], ['brand|400|italic']), faces(['Brand'], ['brand|400|normal'])), [{ family: 'Brand', side: 'eds' }], 'a source-dead italic does not waive a build-dead regular');
  assert.deepEqual(fontsNotLoaded(faces(['Brand'], ['brand|400|italic', 'brand|700|normal']), faces(['Brand'], ['brand|400|italic'])), [{ family: 'Brand', side: 'both' }], 'every build-dead face is dead on the source');
  assert.deepEqual(fontsNotLoaded(live(['Brand']), faces(['Brand'], ['brand|400|normal'])), [{ family: 'Brand', side: 'both' }], 'a record without the faces (an older capture): by family, as before');
  assert.deepEqual(fontsNotLoaded({ instrument: 'crawl-fullpage' }, live(['Brand Sans'])), [{ family: 'Brand Sans', side: 'eds' }], 'a source with no check: not known dead there');
  assert.deepEqual(fontsNotLoaded(live(null), live(['A'])), [{ family: 'A', side: 'eds' }], 'null is not a family list');
  assert.deepEqual([{ family: 'A', side: 'origin' }, { family: 'A', side: 'both' }, { family: 'A', side: 'eds' }, 'A'].map(fontFails), [false, false, true, true], 'a bare family (no recorded side) fails as before');
  assert.deepEqual(fontsNotLoaded(null, { fontsFailed: 'Brand Sans' }), []);
  assert.deepEqual(fontsNotLoaded(undefined, undefined), []);
});
check('fontChecksSkipped: the sides (origin, build) whose stitch-live meta says fontsFailed: null — explicit null only; [], an absent key (a meta from before the check) or another instrument adds none', () => {
  assert.deepEqual(fontChecksSkipped(live(null), live([])), ['origin']);
  assert.deepEqual(fontChecksSkipped(live(['A']), live(null)), ['build']);
  assert.deepEqual(fontChecksSkipped(live(null), live(null)), ['origin', 'build']);
  assert.deepEqual(fontChecksSkipped(live(undefined), live([])), [], 'absent key: a meta from before the check');
  assert.deepEqual(fontChecksSkipped({ instrument: 'crawl-fullpage', asymmetric: true, fontsFailed: null }, null), []);
  assert.deepEqual(fontChecksSkipped({ instrument: 'none', error: 'stitch exit 1', fontsFailed: null }, undefined), [], 'a failed capture is already a missing capture');
});
check('verdict: a dead face fails an otherwise passing row — one font-not-loaded:<family> reason each, the pixel-only calibration verdict unchanged; a skipped check adds font-check-skipped:<side> after them; the row carries both lists', () => {
  const v = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { fonts: ['Brand Sans'], fontsSkipped: [] } });
  assert.deepEqual([v.pass, v.pixelOnlyPass, v.passWithOverride, v.fontsNotLoaded, v.fontChecksSkipped, v.reasons], [false, true, false, ['Brand Sans'], [], ['font-not-loaded:Brand Sans']]);
  const s = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), capture: { fonts: [], fontsSkipped: ['build'] } });
  assert.deepEqual([s.pass, s.pixelOnlyPass, s.fontChecksSkipped, s.reasons], [false, true, ['build'], ['font-check-skipped:build']]);
  const both = verdict({ pixel: px(1.5, 0), clip: clip(3), content: content(0, 0), capture: { fonts: ['A', 'B'], fontsSkipped: ['origin', 'build'] } });
  assert.deepEqual(both.reasons, ['clipped 3 (text 3, controls 0)', 'font-not-loaded:A', 'font-not-loaded:B', 'font-check-skipped:origin', 'font-check-skipped:build'], 'after the element reasons, fonts then skipped sides');
  assert.equal(verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0), override: { verdict: 'PASS', reason: 'R-01' }, capture: { fonts: ['A'], fontsSkipped: [] } }).passWithOverride, true, 'an override shows beside the fonts reason as it does beside any other');
  const none = verdict({ pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) });
  assert.deepEqual([none.pass, none.fontsNotLoaded, none.fontChecksSkipped], [true, [], []], 'no capture input: none');
});
check('the font rule, four cases: dead on the source only → reported, passes; dead on the build only → fails; dead on both → reported, passes; a check that did not run → never a pass', () => {
  const base = { pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) };
  const of = (o, e) => verdict({ ...base, capture: { fonts: fontsNotLoaded(live(o), live(e)), fontsSkipped: fontChecksSkipped(live(o), live(e)) } });
  const src = of(['Brand Sans'], []);
  assert.deepEqual([src.pass, src.reasons, src.notes, src.fontsNotLoaded], [true, [], ['font-dead-on-source:Brand Sans'], [{ family: 'Brand Sans', side: 'origin' }]]);
  const build = of([], ['Brand Sans']);
  assert.deepEqual([build.pass, build.pixelOnlyPass, build.reasons, build.notes, build.fontsNotLoaded], [false, true, ['font-not-loaded:Brand Sans'], [], [{ family: 'Brand Sans', side: 'eds' }]]);
  const both = of(['Brand Sans'], ['Brand Sans']);
  assert.deepEqual([both.pass, both.reasons, both.notes, both.fontsNotLoaded], [true, [], ['font-dead-on-both:Brand Sans'], [{ family: 'Brand Sans', side: 'both' }]]);
  const mixed = of(['Brand Sans'], ['Brand Sans', 'Brand Serif']);
  assert.deepEqual([mixed.pass, mixed.reasons, mixed.notes], [false, ['font-not-loaded:Brand Serif'], ['font-dead-on-both:Brand Sans']], 'the build-only face still fails beside a source-dead one');
  for (const [o, e, side] of [[null, [], 'origin'], [[], null, 'build'], [['Brand Sans'], null, 'build']]) {
    const v = of(o, e);
    assert.deepEqual([v.pass, v.reasons], [false, [`font-check-skipped:${side}`]], `check not run on the ${side} side`);
  }
});
check('formatSummary: a face dead on the source is named with its side on the calibration line and in the row, which stays PASS', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const row = { slug: 'a', path: '/a', pct: 1.5, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: true, pixelOnlyPass: true, fontsNotLoaded: [{ family: 'Brand Sans', side: 'origin' }, { family: 'Brand Serif', side: 'both' }], fontChecksSkipped: [], probeErrors: [], reasons: [], notes: ['font-dead-on-source:Brand Sans', 'font-dead-on-both:Brand Serif'], override: null, error: null };
  const md = formatSummary({ _provenance: pv, totals: { pages: 1, pass: 1, pixelOnlyPass: 1, overridePass: 0, fail: 0, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, fontsNotLoaded: 0, fontsDeadOnSource: 1, fontChecksSkipped: 0 }, rows: [row] });
  assert.match(md, /fonts dead on the source — reported, not failing: 1 \(Brand Sans \[origin\], Brand Serif \[both\]\)/);
  assert.doesNotMatch(md, /fonts not loaded/);
  assert.match(md, /\| `\/a` \|.*\| PASS \| \(reported\) font-dead-on-source:Brand Sans; \(reported\) font-dead-on-both:Brand Serif \|/);
});
check('formatSummary: the calibration line counts the rows and names the dead faces once, then the skipped checks; a row failing on fonts alone reads FAIL (fonts)', () => {
  const pv = { writtenAt: 'now', breakpoint: 1440, verdict: 'V' };
  const r0 = { slug: 'a', path: '/a', pct: 1.5, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: false, pixelOnlyPass: true, fontsNotLoaded: ['Brand Sans'], fontChecksSkipped: [], reasons: ['font-not-loaded:Brand Sans'], override: null, error: null };
  const totals = { pages: 1, pass: 0, pixelOnlyPass: 1, overridePass: 0, fail: 1, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, fontsNotLoaded: 1, fontChecksSkipped: 0 };
  const md = formatSummary({ _provenance: pv, totals, rows: [r0] });
  assert.match(md, /Failing by criterion: pixel 0, height 0, clip 0, content 0, fonts not loaded 1 \(Brand Sans\); content n\/a/);
  assert.match(md, /\| `\/a` \|.*\| FAIL \(fonts\) \| font-not-loaded:Brand Sans \|/);
  const r1 = { ...r0, slug: 'b', path: '/b', fontsNotLoaded: ['Brand Serif', 'Brand Sans'], fontChecksSkipped: ['build'], reasons: ['font-not-loaded:Brand Sans', 'font-not-loaded:Brand Serif', 'font-check-skipped:build'] };
  const r2 = { ...r0, slug: 'c', path: '/c', clipped: 4, fontsNotLoaded: [], fontChecksSkipped: ['origin'], reasons: ['clipped 4', 'font-check-skipped:origin'] };
  const md2 = formatSummary({ _provenance: pv, totals: { ...totals, pages: 3, fontsNotLoaded: 2, fontChecksSkipped: 2 }, rows: [r1, r2, r0] });
  assert.match(md2, /, fonts not loaded 2 \(Brand Sans, Brand Serif\), font check skipped 2; content n\/a/);
  assert.match(md2, /\| `\/b` \|.*\| FAIL \(fonts\) \|/, 'fonts and a skipped check only: FAIL (fonts)');
  assert.match(md2, /\| `\/c` \|.*\| FAIL \(elements\) \|/, 'an element reason beside the skipped check: FAIL (elements)');
  assert.doesNotMatch(formatSummary({ _provenance: pv, totals: { ...totals, fontsNotLoaded: 0 }, rows: [{ ...r0, pass: true, fontsNotLoaded: [], reasons: [] }] }), /fonts not loaded|font check skipped/);
});

// ---- the runner with stub instruments: the record → the meta → the row -------------------------------------------------
// Sandbox: stardust/scripts/replica with the real gate-all.mjs and stubs for stitch-shot (writes the PNG and its capture
// record, fixedLayers always: fontsFailed = STUB_FONTS_<ORIGIN|EDS> as a comma list, null + fontCheck under STUB_FONTS_NULL_<side>,
// no record under STUB_NO_JSON_<side>; ORIGIN = a https://origin.example URL) and pixel-compare (a passing JSON). --no-probes: the
// diff skill's scripts are not needed. realpath: the main-module guard compares process.argv[1] with import.meta.url.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
  const replica = join(root, 'stardust/scripts/replica');
  mkdirSync(replica, { recursive: true });
  cpSync(SCRIPT, join(replica, 'gate-all.mjs')); chmodSync(join(replica, 'gate-all.mjs'), 0o755); cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(replica, 'foundation-freeze.mjs'));
  cpSync(join(HERE, '../../../stardust/scripts'), join(root, 'stardust/scripts/stardust'), { recursive: true }); // Setup step 7: the shared contracts
  const stub = (name, body) => writeFileSync(join(replica, name), `#!/usr/bin/env node\n${body}\n`);
  stub('stitch-shot.mjs', `
    import { writeFileSync } from 'node:fs';
    const url = process.argv[2]; const out = process.argv[3];
    const side = /^https:\\/\\/origin\\.example/.test(url) ? 'ORIGIN' : 'EDS';
    const rc = Number(process.env['STUB_STITCH_RC_' + side] || 0);
    if (rc) { console.error('stitch-shot error: stub exit ' + rc); process.exit(rc); }
    writeFileSync(out, 'png');
    const json = out.replace(/\\.png$/i, '') + '.capture.json';
    const fonts = process.env['STUB_FONTS_NULL_' + side] ? { fontsFailed: null, fontCheck: 'failed: Execution context was destroyed' } : { fontsFailed: (process.env['STUB_FONTS_' + side] || '').split(',').filter(Boolean) };
    const hold = process.argv.includes('--hold-min') ? Number(process.argv[process.argv.indexOf('--hold-min') + 1]) : null; // the timer hold, as stitch-shot records it
    if (json && !process.env['STUB_NO_JSON_' + side]) writeFileSync(json, JSON.stringify({ url, out, width: 1440, vh: 900, settle: true, ...fonts, fixedLayers: { capture: 'once', count: 0, late: 0 }, ...(hold ? { timers: { hold, held: 1, intervals: 1, chains: 0, delays: [5000] } } : {}), height: 2000 }, null, 2) + '\\n');
    console.log('overflow: scrollWidth=1440 viewport=1440 delta=0'); console.log('stitched ' + out);`);
  // gate-all imports the pixel criterion from pixel-compare.mjs: the stub re-exports the real module and is a stub only when run
  stub('pixel-compare.mjs', `export * from ${JSON.stringify(REAL_PIXEL)};\n${MAIN_ONLY} console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 2000 }, pass: true, bands: [] }));`);
  const pages = (extra = {}) => ({ pages: [{ slug: 'a', url: 'https://origin.example/a', liveUrl: 'https://served.example/a', status: 'deployed', template: 't', fidelityTier: 'thin', ...extra }] });
  const runAll = (tag, args, env = {}, state = pages()) => {
    const out = join(root, `out-${tag}`); const stateFile = join(root, `state-${tag}.json`);
    writeFileSync(stateFile, JSON.stringify(state));
    const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), '--state', stateFile, '--out', out, '--no-probes', ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, GATE_REFERENCE: 'live', ...env } });
    const read = (f) => (existsSync(join(out, f)) ? JSON.parse(readFileSync(join(out, f), 'utf8')) : null);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, summary: read('summary.json'), origin: read('a/origin.json'), eds: read('a/eds.json'), record: read('a/origin.capture.json'), out };
  };
  try {
    check('runner: both stitches are asked for their capture record; the metas carry fontsFailed [] and the clean row passes (exit 0)', () => {
      const r = runAll('clean', []);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(r.out, 'a/origin.capture.json')) && existsSync(join(r.out, 'a/eds.capture.json')), 'the records are beside the captures');
      assert.deepEqual([r.origin.instrument, r.origin.fontsFailed, r.eds.fontsFailed], ['stitch-live', [], []]);
      assert.ok(!('fontCheck' in r.origin) && !('fontCheck' in r.eds), 'a check that ran carries no fontCheck');
      const row = r.summary.rows[0];
      assert.deepEqual([row.pass, row.fontsNotLoaded, row.fontChecksSkipped, row.reasons], [true, [], [], []]);
      assert.deepEqual([r.summary.totals.fontsNotLoaded, r.summary.totals.fontChecksSkipped], [0, 0]);
    });
    check('runner: a dead face on the served side → eds.json fontsFailed, the row fails with font-not-loaded:<family> (exit 2), the calibration line names it', () => {
      const r = runAll('dead', [], { STUB_FONTS_EDS: 'Brand Sans,Brand Serif Fallback' });
      assert.equal(r.status, 2, r.stderr);
      assert.deepEqual(r.eds.fontsFailed, ['Brand Sans', 'Brand Serif Fallback']);
      const row = r.summary.rows[0];
      assert.deepEqual([row.pass, row.pixelOnlyPass, row.fontsNotLoaded, row.reasons], [false, true, [{ family: 'Brand Sans', side: 'eds' }, { family: 'Brand Serif Fallback', side: 'eds' }], ['font-not-loaded:Brand Sans', 'font-not-loaded:Brand Serif Fallback']]);
      assert.match(readFileSync(join(r.out, 'summary.md'), 'utf8'), /fonts not loaded 1 \(Brand Sans \[eds\], Brand Serif Fallback \[eds\]\)/);
      assert.match(readFileSync(join(r.out, 'summary.md'), 'utf8'), /FAIL \(fonts\)/);
    });
    check('runner: a face dead on the source — alone, or on both sides — is reported in the row and the calibration line and the row passes (exit 0); totals count it apart', () => {
      const r = runAll('dead-source', [], { STUB_FONTS_ORIGIN: 'Brand Sans,Brand Serif', STUB_FONTS_EDS: 'Brand Serif' });
      assert.equal(r.status, 0, r.stderr);
      const row = r.summary.rows[0];
      assert.deepEqual([row.pass, row.reasons, row.notes, row.fontsNotLoaded], [true, [], ['font-dead-on-source:Brand Sans', 'font-dead-on-both:Brand Serif', unitsNote(0)], [{ family: 'Brand Sans', side: 'origin' }, { family: 'Brand Serif', side: 'both' }]]);
      assert.deepEqual([r.summary.totals.fontsNotLoaded, r.summary.totals.fontsDeadOnSource, r.summary.totals.pass], [0, 1, 1]);
      assert.match(readFileSync(join(r.out, 'summary.md'), 'utf8'), /fonts dead on the source — reported, not failing: 1 \(Brand Sans \[origin\], Brand Serif \[both\]\)/);
    });
    check('runner: an origin whose font check could not run → origin.json fontsFailed null + fontCheck, the row fails with font-check-skipped:origin (exit 2) — never a pass', () => {
      const r = runAll('skipped', [], { STUB_FONTS_NULL_ORIGIN: '1' });
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.origin.fontsFailed, null); assert.equal(r.origin.fontCheck, 'failed: Execution context was destroyed');
      const row = r.summary.rows[0];
      assert.deepEqual([row.pass, row.fontChecksSkipped, row.reasons], [false, ['origin'], ['font-check-skipped:origin']]);
      assert.equal(r.summary.totals.fontChecksSkipped, 1);
    });
    check('runner: a stitch that writes no record (an older copy) → fontsFailed null with the re-copy note, font-check-skipped:build', () => {
      const r = runAll('norec', [], { STUB_NO_JSON_EDS: '1' });
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.eds.fontsFailed, null); assert.match(r.eds.fontCheck, /^failed: no readable capture record \(stitch-shot wrote no capture record/);
      assert.deepEqual(r.summary.rows[0].reasons, ['font-check-skipped:build']);
    });
    check('runner (prototype stage): the archetype round\'s live.png is reused with the font check of its live.capture.json, which goes with the copy — a record with fixedLayers but no fontsFailed predates the check (font-check-skipped:origin, the fix named), a face dead there is reported (the source side: not a fail), [] passes; one staleCapture refuses (no record) is not reused: the origin is captured afresh, said once — never "all loaded"', () => {
      const proto = pages({ prototypePath: 'stardust/prototypes/a.html' });
      const cached = join(root, 'stardust/replica/gates/a-1440'); mkdirSync(cached, { recursive: true });
      const protoArgs = ['--stage', 'prototype', '--proto-base', 'http://127.0.0.1:1'];
      writeFileSync(join(cached, 'live.png'), 'png');
      const none = runAll('proto-none', protoArgs, {}, proto);
      assert.equal(none.status, 0, none.stderr);
      assert.match(none.stdout, /live\.png predates the fixed-layer capture \(no fixedLayers in its record\) — not reused, capturing the origin/);
      assert.ok(!/^reused /.test(none.origin.note || ''), `not reused: ${none.origin.note}`);
      assert.deepEqual([none.origin.instrument, none.origin.fontsFailed, none.record.fontsFailed], ['stitch-live', [], []], 'captured afresh by the stub, its own record checked');
      const layers = { capture: 'once', count: 0, late: 0 }; const timers = { hold: 2000, held: 0, intervals: 0, chains: 0, delays: [] }; // the archetype round held, as this run does
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fixedLayers: layers, timers, height: 2000 }));
      const pre = runAll('proto-pre', protoArgs, {}, proto);
      assert.equal(pre.status, 2, pre.stderr);
      assert.match(pre.origin.note, /^reused .*live\.png/);
      assert.deepEqual([pre.origin.fontsFailed, pre.origin.fontCheck], [null, 'failed: the capture record predates the font check — re-copy stitch-shot.mjs']);
      assert.deepEqual(pre.summary.rows[0].reasons, ['font-check-skipped:origin']);
      assert.deepEqual(pre.record.fixedLayers, layers, 'the cached record went with the copy');
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: ['Brand Serif'], fixedLayers: layers, timers, height: 2000 }));
      const some = runAll('proto-some', protoArgs, {}, proto);
      assert.equal(some.status, 0, some.stderr);
      assert.deepEqual([some.origin.fontsFailed, some.summary.rows[0].reasons, some.summary.rows[0].notes], [['Brand Serif'], [], ['font-dead-on-source:Brand Serif', unitsNote(0)]], 'the cached capture\'s dead face is the source\'s: reported, the row passes');
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: [], fixedLayers: layers, timers, height: 2000 }));
      const clean = runAll('proto-clean', protoArgs, {}, proto);
      assert.equal(clean.status, 0, clean.stderr);
      assert.deepEqual([clean.origin.fontsFailed, clean.summary.rows[0].pass], [[], true]);
    });
    check('runner (prototype stage): after a --gate-against-baseline round (live.json origin "baseline", no live.capture.json) the frozen baseline\'s record stands in — its fixedLayers for the reuse, its fontsFailed for the font check — and the copy\'s record says where it came from', () => {
      const proto = pages({ prototypePath: 'stardust/prototypes/a.html' });
      const cached = join(root, 'stardust/replica/gates/a-1440');
      const protoArgs = ['--stage', 'prototype', '--proto-base', 'http://127.0.0.1:1'];
      rmSync(join(cached, 'live.capture.json'), { force: true });
      writeFileSync(join(cached, 'live.json'), JSON.stringify({ origin: 'baseline' }));
      const timers = { hold: 2000, held: 0, intervals: 0, chains: 0, delays: [] }; // frozen under the default hold
      writeFileSync(join(cached, 'baseline.json'), JSON.stringify({ fontsFailed: ['Brand Serif'], fixedLayers: { capture: 'once', count: 1, late: 0 }, timers }));
      const r = runAll('proto-baseline', protoArgs, {}, proto);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.origin.note, /^reused .*live\.png/);
      assert.deepEqual([r.origin.fontsFailed, r.summary.rows[0].reasons, r.summary.rows[0].notes], [['Brand Serif'], [], ['font-dead-on-source:Brand Serif', unitsNote(0)]], 'the baseline\'s dead face is read and reported');
      assert.deepEqual(r.record, { writtenBy: 'gate-all.mjs', copiedFrom: 'stardust/replica/gates/a-1440/live.png', fixedLayers: { capture: 'once', count: 1, late: 0 }, timers, fontsFailed: ['Brand Serif'] });
      writeFileSync(join(cached, 'baseline.json'), JSON.stringify({ fontsFailed: [], fixedLayers: { capture: 'once', count: 1, late: 0 }, timers }));
      const clean = runAll('proto-baseline-clean', protoArgs, {}, proto);
      assert.equal(clean.status, 0, clean.stderr);
      assert.deepEqual([clean.origin.fontsFailed, clean.summary.rows[0].pass], [[], true]);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ---- disk (#156): a passed page keeps its records, not its pictures ---------------------------------------------
const pageDir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'gate-all-drop-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), typeof body === 'string' ? body : JSON.stringify(body));
  return d;
};
const RECORDS = { 'pixel.json': px(1.2, 0), 'origin.json': { instrument: 'stitch-live' }, 'eds.json': { instrument: 'stitch-live', url: 'https://eds.example/a' }, 'content.json': { totals: {} }, 'origin.capture.json': { fixedLayers: {} } };
check('dropPassedCaptures: every PNG in the page dir goes, an extra capture too; the JSON records stay; pixel.json records the drop', () => {
  const d = pageDir({ ...RECORDS, 'origin.png': 'p', 'eds.png': 'p', 'diff.png': 'p', 'origin-prev.png': 'p' });
  try {
    assert.equal(dropPassedCaptures(d, { masks: [], edsUrl: 'https://eds.example/a' }), 4);
    assert.deepEqual(readdirSync(d).sort(), Object.keys(RECORDS).sort());
    const pixel = JSON.parse(readFileSync(join(d, 'pixel.json'), 'utf8'));
    assert.equal(pixel.pct, 1.2); assert.deepEqual(pixel.capturesDropped, { masks: [], edsUrl: 'https://eds.example/a' });
  } finally { rmSync(d, { recursive: true, force: true }); }
});
check('dropPassedCaptures: no pixel.json, nothing dropped', () => {
  const d = pageDir({ 'origin.png': 'p' });
  try { assert.equal(dropPassedCaptures(d, { edsUrl: 'u' }), 0); assert.ok(existsSync(join(d, 'origin.png'))); } finally { rmSync(d, { recursive: true, force: true }); }
});
check('droppedPass: the records for the same masks and eds URL; null when either changed, nothing was dropped, or a record is gone or holds an error', () => {
  const d = pageDir(RECORDS);
  try {
    const at = { masks: ['0:100'], edsUrl: 'https://eds.example/a' };
    assert.equal(droppedPass(d, at), null, 'never dropped');
    dropPassedCaptures(d, at);
    const kept = droppedPass(d, at);
    assert.equal(kept.pixel.pct, 1.2); assert.equal(kept.origin.instrument, 'stitch-live'); assert.equal(kept.eds.url, 'https://eds.example/a');
    assert.equal(droppedPass(d, { ...at, masks: [] }), null, 'mask removed');
    assert.equal(droppedPass(d, { ...at, edsUrl: 'https://branch.example/a' }), null, 'another eds host');
    writeFileSync(join(d, 'eds.json'), JSON.stringify({ instrument: 'none', url: 'https://eds.example/a', error: 'stitch exit 1' }));
    assert.equal(droppedPass(d, at), null, 'a capture record that holds an error');
    rmSync(join(d, 'origin.json'));
    assert.equal(droppedPass(d, at), null, 'origin record gone');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
// A project root with the real gate-all.mjs, the real diff scripts and stub instruments. The stitch stub logs each
// URL (STUB_LOG), fails one (STUB_FAIL, exit 1), kills gate-all on one (STUB_KILL — an interrupted run) and logs how
// many gate PNGs exist when it is called (STUB_PNGS — the peak a run reaches). pixel-compare fails `/bad` pages.
function sandbox(slugs, { probes = false, units = false, inputs = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
  const rep = join(root, 'stardust/scripts/replica');
  mkdirSync(rep, { recursive: true });
  copyFileSync(SCRIPT, join(rep, 'gate-all.mjs')); copyFileSync(join(HERE, '..', 'foundation-freeze.mjs'), join(rep, 'foundation-freeze.mjs'));
  // the project a page is built from (its local build inputs): a content file per page (`a` and `good` use the cards
  // block, every page the teaser block), two more blocks, the shared code and the header fragment
  if (inputs) {
    const put = (f, body) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), body); };
    for (const s of slugs) put(`content/${s}.html`, `<main><div><h1>${s}</h1><div class="teaser"><div>t</div></div>${['a', 'good'].includes(s) ? '<div class="cards wide"><div>c</div></div>' : ''}</div></main>`);
    for (const b of ['cards', 'teaser', 'quote', 'header']) { put(`blocks/${b}/${b}.js`, `export default function decorate() {} // ${b}\n`); put(`blocks/${b}/${b}.css`, `.${b} { color: red; }\n`); }
    put('styles/styles.css', 'body { margin: 0; }\n'); put('scripts/scripts.js', '// aem\n'); put('head.html', '<meta name="viewport" content="width=device-width">\n');
    put('content/nav.html', '<div><p>Brand</p></div>\n'); put('content/footer.html', '<div><p>Legal</p></div>\n');
  }
  cpSync(join(HERE, '../../../diff/scripts'), join(root, 'stardust/scripts/diff'), { recursive: true });
  cpSync(join(HERE, '../../../stardust/scripts'), join(root, 'stardust/scripts/stardust'), { recursive: true });
  writeFileSync(join(rep, 'stitch-shot.mjs'), `import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
if (process.argv[2] === 'baseline') { const { spawnSync } = await import('node:child_process'); process.exit(spawnSync(process.execPath, [${JSON.stringify(REAL_STITCH)}, ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1); }
const [url, out] = process.argv.slice(2); appendFileSync(process.env.STUB_LOG, url + '\\n');
const t0 = Date.now(); if (process.env.STUB_SHOT_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.STUB_SHOT_MS));
if (process.env.STUB_TIMES) appendFileSync(process.env.STUB_TIMES, JSON.stringify({ kind: 'stitch-shot', slug: url.split('/').pop(), t0, t1: Date.now() }) + '\\n');
if (process.env.STUB_ARGV) appendFileSync(process.env.STUB_ARGV, JSON.stringify(['stitch-shot', ...process.argv.slice(2)]) + '\\n');
if (process.env.STUB_PNGS) appendFileSync(process.env.STUB_PNGS, readdirSync('stardust/replica/gates', { recursive: true }).filter((f) => f.endsWith('.png')).length + '\\n');
if (url === process.env.STUB_KILL) { process.kill(process.ppid, 'SIGKILL'); process.exit(1); }
if (url === process.env.STUB_FAIL) { console.error('capture failed'); process.exit(1); }
const hold = process.argv.includes('--hold-min') ? Number(process.argv[process.argv.indexOf('--hold-min') + 1]) : null; // the timer hold, as stitch-shot records it
writeFileSync(out, 'png'); writeFileSync(out.replace(/\\.png$/, '.capture.json'), JSON.stringify({ fixedLayers: { capture: 'once', count: 0 }, fontsFailed: [], ...(hold ? { timers: { hold, held: 1, intervals: 1, chains: 0, delays: [5000] } } : {}) }));\n`);
  // pixel-compare: `/bad/` pages read 30 %, the rest 1 %; STUB_PX = { "<slug>": { pct, aligned: { used, pct, steps } } } gives
  // a page an aligned summary (and heightDelta) (totalShift = the sum of |shift|); STUB_PX_ARGV logs each call's argv (apart from STUB_ARGV: the captures and probes).
  writeFileSync(join(rep, 'pixel-compare.mjs'), `export * from ${JSON.stringify(REAL_PIXEL)};
import { appendFileSync, writeFileSync } from 'node:fs';
${MAIN_ONLY} {
const a = process.argv.slice(2); writeFileSync(a[a.indexOf('--out') + 1], 'png');
if (process.env.STUB_PX_ARGV) appendFileSync(process.env.STUB_PX_ARGV, JSON.stringify(a) + '\\n');
const slug = a[0].split('/').slice(-2)[0]; const given = (JSON.parse(process.env.STUB_PX || '{}'))[slug] || {};
const pct = given.pct ?? (a[0].includes('/bad/') ? 30 : 1);
const al = given.aligned ? { ...given.aligned, totalShift: (given.aligned.steps || []).reduce((n, x) => n + Math.abs(x.shift), 0) } : null;
const maskedRows = a.includes('--mask') ? a[a.indexOf('--mask') + 1].split(',').reduce((n, m) => n + Number(m.split(':')[1].split('@')[0]), 0) : 0;
console.log(JSON.stringify({ pct, heightDelta: given.heightDelta ?? 0, compared: { width: 1440, height: 5000 }, pass: pct <= 10, maskedRows, ...(al ? { aligned: al } : {}) }));
}\n`);
  // reference.mjs: `freeze <url> <dir>` logs "freeze <url>" (STUB_LOG) and its argv (STUB_ARGV); the URL in STUB_REF_UNSTABLE is
  // unstable (exit 2, reference-unstable.json, nothing frozen); else baseline.png + baseline.json in reference.mjs's shape
  // (noiseFloor 2.31, the regions of STUB_REF_MASK, `flags` = the overlay flags and locale of the call) beside the kept
  // captures ref-1.png / ref-2.png. `settings <dir> …` is the real script's (no browser), and is not logged.
  writeFileSync(join(rep, 'reference.mjs'), `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
const [cmd, url, dir, ...rest] = process.argv.slice(2);
if (cmd === 'settings') { const { spawnSync } = await import('node:child_process'); process.exit(spawnSync(process.execPath, [${JSON.stringify(REAL_REFERENCE)}, ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1); }
const flag = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : null);
appendFileSync(process.env.STUB_LOG, cmd + ' ' + url + '\\n');
if (process.env.STUB_ARGV) appendFileSync(process.env.STUB_ARGV, JSON.stringify(['reference', ...process.argv.slice(2)]) + '\\n');
const t0 = Date.now(); if (process.env.STUB_SHOT_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.STUB_SHOT_MS));
if (process.env.STUB_TIMES) appendFileSync(process.env.STUB_TIMES, JSON.stringify({ kind: 'reference', slug: url.split('/').pop(), t0, t1: Date.now() }) + '\\n');
mkdirSync(dir, { recursive: true });
for (const f of ['ref-1.png', 'ref-2.png', 'ref-diff-1-2.png', 'ref-1.capture.json']) writeFileSync(join(dir, f), 'x');
if (url === process.env.STUB_REF_FAIL) { console.log('reference: not frozen — the capture met a bot challenge (stitch-shot exit 3)'); process.exit(3); }
const hold = rest.includes('--hold-min') ? Number(flag('--hold-min')) : null; // the timer hold, as reference.mjs records it
const hint = process.env.STUB_REF_HINT && !hold ? process.env.STUB_REF_HINT : null; // reference.mjs's hint: only without the hold, before its verdict line
if (hint) console.log('hint: ' + hint);
if (url === process.env.STUB_REF_UNSTABLE) { writeFileSync(join(dir, 'reference-unstable.json'), JSON.stringify(hint ? { hint } : {})); console.log('reference: UNSTABLE — heights 5000 vs 5640 after priming; not frozen'); process.exit(2); }
const maskArg = process.env.STUB_REF_MASK || ''; const variable = maskArg.split(',').filter(Boolean).map((m) => ({ y: Number(m.split(':')[0]), h: Number(m.split(':')[1]), pct: 9 }));
writeFileSync(join(dir, 'baseline.png'), 'frozen');
writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ writtenBy: 'skills/replica/scripts/reference.mjs freeze', schema: 1, capturedAt: '2026-11-01T09:00:00.000Z', url, width: Number(rest[rest.indexOf('--width') + 1]), vh: 900, height: 5000, settle: true, chunks: 6, fontsFailed: [], fixedLayers: { capture: 'once', count: 0 }, ...(hold ? { timers: { hold, held: 2, intervals: 2, chains: 0, delays: [5000, 86400000] } } : {}), primed: true, noiseFloor: 2.31, variable, maskArg, stable: true, reason: null, ...(hint ? { hint } : {}), flags: { consent: flag('--consent'), dismiss: flag('--dismiss'), noDismiss: rest.includes('--no-dismiss'), locale: flag('--locale'), vh: null, headed: rest.includes('--headed'), ...(hold ? { holdTimers: hold } : {}) } }));
console.log('reference: frozen, primed');\n`);
  // Stub probes (probes: true; units: true adds unit-geometry and a family for every page): each logs its argv
  // (STUB_ARGV), then exits STUB_<CONTENT|CLIP|UNITS>_RC without a result ("kill" = killed mid-run, what a timeout
  // leaves) or writes a clean one. STUB_BY_SLUG = { "<slug>": { "<probe>": { rc, ms, missing, off } } } gives one page's
  // probe its own exit code, duration and findings; STUB_PROBE_MS is every probe's duration, STUB_SHOT_MS a capture's;
  // STUB_TIMES logs { kind, slug, t0, t1 } per capture and probe (what ran beside what). `killGate` (per slug and
  // probe) kills gate-all while that probe is in flight; STUB_SNAP logs, as each probe ends, { kind, slug, passes }
  // — the pages whose whole pass is on disk at that moment — and whether a summary exists.
  const probeStub = (name, envKey, body) => writeFileSync(join(root, 'stardust/scripts/diff', `${name}.mjs`), `import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
export const inPage = () => ({}); // unit-geometry imports it from clip-probe
const a = process.argv.slice(2); const main = (process.argv[1] || '').endsWith('${name}.mjs');
if (main) appendFileSync(process.env.STUB_ARGV, JSON.stringify(['${name}', ...a]) + '\\n');
const slug = (a[0] || '').split('/').pop(); const by = main ? (JSON.parse(process.env.STUB_BY_SLUG || '{}')[slug] || {})['${name}'] || {} : {};
const t0 = Date.now(); const ms = by.ms ?? Number(process.env.STUB_PROBE_MS || 0);
if (main && ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (main && process.env.STUB_TIMES) appendFileSync(process.env.STUB_TIMES, JSON.stringify({ kind: '${name}', slug, t0, t1: Date.now() }) + '\\n');
const rc = by.rc ?? process.env.${envKey};
if (main && process.env.STUB_SNAP) { const g = 'stardust/replica/gates/all-1440'; appendFileSync(process.env.STUB_SNAP, JSON.stringify({ kind: '${name}', slug, passes: readdirSync(g).filter((d) => { try { return !!JSON.parse(readFileSync(g + '/' + d + '/pixel.json', 'utf8')).capturesDropped.key; } catch { return false; } }).sort(), summary: existsSync(g + '/summary.json') }) + '\\n'); }
if (main && by.killGate) { process.kill(process.ppid, 'SIGKILL'); process.exit(1); }
if (!main) { /* imported, not run */ }
else if (rc === 'kill') process.kill(process.pid, 'SIGKILL');
else if (rc) { console.error('${name} error: stub exit ' + rc); process.exit(Number(rc)); }
else { const counts = { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }; writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify(${body})); }\n`);
  if (probes) {
    probeStub('content-presence', 'STUB_CONTENT_RC', `{ _provenance: { at: 'now', tier: 'chrome' }, totals: { missing: by.missing ?? 0, hidden: 0, controlState: 0 }, scope: 'main', eds: { clip: { counts, groups: [] } }, origin: { clip: { counts } } }`);
    probeStub('clip-probe', 'STUB_CLIP_RC', `{ counts, groups: [], tier: 'chrome' }`);
  }
  if (units) {
    probeStub('unit-geometry', 'STUB_UNITS_RC', `{ verdict: { units: 1, within: 1, off: by.off ?? 0, hidden: 0, missing: 0, errors: 0, requiredOff: by.off ?? 0 }, results: [] }`);
    writeFileSync(join(root, 'stardust/scripts/diff/unit-geometry.mjs'), `export const unitsFor = (families, slug) => Object.values(families).filter((f) => f.pages.includes(slug)).map((f) => ({ origin: f.origin, eds: f.build, n: f.n, required: true }));\n${readFileSync(join(root, 'stardust/scripts/diff/unit-geometry.mjs'), 'utf8')}`);
    mkdirSync(join(root, 'stardust/replica'), { recursive: true });
    writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ card: { origin: '.cards > li', build: '.cards > li', n: 3, required: true, pages: slugs } }));
  }
  const page = (slug) => ({ slug, url: `https://origin.example/${slug}`, status: 'deployed', liveUrl: `https://eds.example/${slug}` });
  writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ pages: slugs.map(page) }));
  const out = join(root, 'stardust/replica/gates/all-1440');
  const log = join(root, 'stitch.log');
  const argvLog = join(root, 'argv.log'); const pxLog = join(root, 'px-argv.log');
  const timesLog = join(root, 'times.log');
  const gateAll = (args = [], env = {}) => { writeFileSync(log, ''); writeFileSync(argvLog, ''); writeFileSync(pxLog, ''); writeFileSync(timesLog, ''); return spawnSync(process.execPath, [join(rep, 'gate-all.mjs'), ...(probes ? [] : ['--no-probes']), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GATE_REFERENCE: 'live', STUB_LOG: log, STUB_ARGV: argvLog, STUB_PX_ARGV: pxLog, STUB_TIMES: timesLog, ...env } }); };
  return {
    root, out, gateAll,
    times: () => readFileSync(timesLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    compares: () => Object.fromEntries(readFileSync(pxLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((a) => [a[0].split('/').slice(-2)[0], a])),
    files: (d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).sort() : []),
    tableOf: (d) => { const f = join(root, 'stardust/replica/gates', d, 'summary.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; },
    spawned: () => readFileSync(argvLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    totals: () => JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).totals,
    shots: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).sort(),
    pngs: (slug) => readdirSync(join(out, slug)).filter((f) => f.endsWith('.png')).sort(),
    rows: () => Object.fromEntries(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).rows.map((r) => [r.slug, r])),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
check('a run with stub instruments: the passed page loses its PNGs, the failed one keeps them; --skip-existing and --compare-only reuse the recorded pass without a capture; a changed mask re-captures', () => {
  const { out, gateAll, shots, pngs, rows, done } = sandbox(['good', 'bad']);
  try {
    let r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(pngs('good'), [], 'the passed page keeps no PNG');
    assert.deepEqual(pngs('bad'), ['diff.png', 'eds.png', 'origin.png'], 'the failed page keeps its captures and diff');
    assert.ok(existsSync(join(out, 'good/pixel.json')) && existsSync(join(out, 'good/origin.json')) && existsSync(join(out, 'good/eds.json')));
    assert.equal(rows().good.pass, true); assert.equal(rows().bad.pass, false);

    r = gateAll(['--skip-existing']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(shots(), [], 'nothing re-captured: the pass is reused, the failed page reuses its captures');
    assert.equal(rows().good.pass, true); assert.equal(rows().good.pct, 1);
    assert.match(r.stdout, /good → recorded pass reused/);

    r = gateAll(['--compare-only']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(rows().good.pass, true, 'compare-only reads the recorded pass, not a missing capture');

    writeFileSync(join(out, 'masks.json'), JSON.stringify({ good: { masks: ['0:100'], reason: 'a rotating banner' } }));
    r = gateAll(['--skip-existing']);
    assert.deepEqual(shots(), ['https://eds.example/good', 'https://origin.example/good'], 'a changed mask re-captures both sides');
    assert.equal(rows().good.pass, true);
    assert.deepEqual(pngs('good'), [], 'and drops them again on the pass');
  } finally { done(); }
});
check('a failed or interrupted re-capture never leaves the old pass to be reused: the next --skip-existing run captures again', () => {
  const { out, gateAll, shots, rows, done } = sandbox(['good']);
  try {
    assert.equal(gateAll().status, 0);
    let r = gateAll(['--skip-existing', '--recapture-origin'], { STUB_FAIL: 'https://origin.example/good' });
    assert.equal(r.status, 2, 'the failed re-capture fails the page');
    assert.match(JSON.parse(readFileSync(join(out, 'good/pixel.json'), 'utf8')).error, /missing capture/, 'and pixel.json says so');
    r = gateAll(['--skip-existing']);
    assert.ok(shots().includes('https://origin.example/good') && !/recorded pass reused/.test(r.stdout), `the failed side captured again, not the old pass reused: ${shots().join(', ')}`);
    assert.equal(r.status, 0); assert.equal(rows().good.pass, true);

    r = gateAll(['--skip-existing', '--recapture-eds'], { STUB_KILL: 'https://eds.example/good' });
    assert.equal(r.signal, 'SIGKILL', 'the run was interrupted mid-capture');
    r = gateAll(['--skip-existing']);
    assert.ok(shots().includes('https://eds.example/good') && !/recorded pass reused/.test(r.stdout), `captured again after the interruption: ${shots().join(', ')}`);
    assert.equal(r.status, 0); assert.equal(rows().good.pass, true);
  } finally { done(); }
});
check(`peak disk: pages go through in batches of ${BATCH} — a passed batch's PNGs are gone before the next batch is captured`, () => {
  const slugs = Array.from({ length: BATCH + 15 }, (_, i) => `p${i}`);
  const { root, gateAll, done } = sandbox(slugs);
  try {
    const counts = join(root, 'pngs.log');
    const r = gateAll([], { STUB_PNGS: counts });
    assert.equal(r.status, 0, r.stderr);
    const peak = Math.max(...readFileSync(counts, 'utf8').split('\n').filter(Boolean).map(Number));
    assert.ok(peak < 2 * BATCH, `at most one batch of captures on disk at a time: saw ${peak} PNGs, ${2 * slugs.length - 1} without batches`);
  } finally { done(); }
});
// ---- page selection (selectPages): state.json's deployed rows merged with the rollout ledger's delivered rows ---------
const stRow = (slug, extra = {}) => ({ slug, url: 'https://origin.example/' + slug, status: 'migrated', template: 't-' + slug, fidelityTier: 'thin', ...extra });
const covRow = (slug, status, extra = {}, delivery = {}) => ({ slug, path: '/' + slug, templateId: 'tpl', source: { sourceUrl: 'https://source.example/' + slug }, delivery: { status, deployedUrl: 'https://eds.example/' + slug, error: null, ...delivery }, ...extra });
check('selectPages — state only: the rows with status deployed + liveUrl + url, as before; no ledger adds none', () => {
  const state = { pages: [stRow('a', { status: 'deployed', liveUrl: 'https://eds.example/a' }), stRow('b'), stRow('c', { status: 'deployed' }), { slug: 'd', status: 'deployed', liveUrl: 'https://eds.example/d' }] };
  const r = selectPages({ state, coverage: null });
  assert.deepEqual([r.pages.map((p) => p.slug), r.from, r.skipped], [['a'], { state: 1, coverage: 0 }, []]);
  assert.deepEqual(r.pages[0], state.pages[0], 'a state row goes through untouched');
});
check('selectPages — ledger only: every delivered row (deployed, verified, failed on a gate) becomes { slug, url, liveUrl }; the source URL is the state row\'s, else source.sourceUrl; other states are not delivered', () => {
  assert.deepEqual(DELIVERED, ['deployed', 'verified']);
  const state = { pages: [stRow('a'), stRow('b'), stRow('p')] };
  const coverage = { pages: [covRow('a', 'verified'), covRow('b', 'deployed'), covRow('c', 'verified'), covRow('g', 'failed', {}, { error: 'gate: pixel 30% > 10%' }), covRow('f', 'failed', {}, { error: 'publish 500' }),
    covRow('p', 'pending'), covRow('q', 'content-pending'), covRow('s', 'stale'), covRow('v', 'converting'), { slug: 'nodelivery' }] };
  const r = selectPages({ state, coverage });
  assert.deepEqual([r.pages.map((p) => p.slug), r.from, r.skipped], [['a', 'b', 'c', 'g'], { state: 0, coverage: 4 }, []]);
  assert.deepEqual(r.pages[0], { ...stRow('a'), liveUrl: 'https://eds.example/a', deployedPath: '/a' }, 'the state row\'s url, template and tier; the ledger\'s deployed URL and path');
  assert.deepEqual([r.pages[2].url, r.pages[2].template, r.pages[2].deployedPath], ['https://source.example/c', 'tpl', '/c'], 'no state row: source.sourceUrl and templateId');
  assert.deepEqual(selectPages({ state, coverage: coverage.pages }).pages.map((p) => p.slug), ['a', 'b', 'c', 'g'], 'the bare pages array reads the same');
});
check('selectPages — both: merged, the state row wins for a slug both name, and a delivered page the roster omits is still selected', () => {
  const state = { pages: [stRow('a', { status: 'deployed', liveUrl: 'https://roster.example/a' }), stRow('b')] };
  const r = selectPages({ state, coverage: { pages: [covRow('a', 'verified'), covRow('b', 'verified')] } });
  assert.deepEqual([r.pages.map((p) => [p.slug, p.liveUrl]), r.from], [[['a', 'https://roster.example/a'], ['b', 'https://eds.example/b']], { state: 1, coverage: 1 }]);
});
check('selectPages — neither: nothing selected, nothing skipped; --only filters both sources', () => {
  assert.deepEqual(selectPages({ state: { pages: [stRow('a')] }, coverage: { pages: [covRow('a', 'pending')] } }), { pages: [], skipped: [], from: { state: 0, coverage: 0 } });
  assert.deepEqual(selectPages({}).pages, []); assert.deepEqual(selectPages({ state: {}, coverage: { pages: 'x' } }).pages, []);
  const state = { pages: [stRow('a', { status: 'deployed', liveUrl: 'https://eds.example/a' }), stRow('b')] };
  const r = selectPages({ state, coverage: { pages: [covRow('b', 'verified'), covRow('c', 'verified')] }, only: ['b', 'zz'] });
  assert.deepEqual([r.pages.map((p) => p.slug), r.from], [['b'], { state: 0, coverage: 1 }]);
});
check('selectPages — a delivered row with no deployed URL takes --eds-host + path, else the delivered rows\' commonest deployed origin; one with no build or no source URL is skipped with the reason, never guessed', () => {
  const noUrl = covRow('n', 'verified', {}, { deployedUrl: null });
  const sib = selectPages({ state: {}, coverage: { pages: [covRow('a', 'verified'), covRow('b', 'verified'), covRow('o', 'verified', {}, { deployedUrl: 'https://other.example/o' }), noUrl] } });
  assert.equal(sib.pages.find((p) => p.slug === 'n').liveUrl, 'https://eds.example/n');
  assert.equal(selectPages({ state: {}, coverage: { pages: [noUrl] }, edsHost: 'https://branch.example' }).pages[0].liveUrl, 'https://branch.example/n');
  const alone = selectPages({ state: {}, coverage: { pages: [noUrl, covRow('x', 'verified', { source: {} }, { deployedUrl: null })] } });
  assert.deepEqual(alone.pages, []);
  assert.deepEqual(alone.skipped.map((x) => [x.slug, /no build URL/.test(x.why), /no source URL/.test(x.why)]), [['n', true, false], ['x', false, true]]);
  const built = selectPages({ state: {}, coverage: { pages: [covRow('search', 'verified', { source: { migratedHtml: 'dynamics:search', metaJson: null } })] } });
  assert.deepEqual([built.pages, built.skipped.map((x) => [x.slug, x.noSourcePage, /built outside the migrated tree \(dynamics:search\) — no source page/.test(x.why)])], [[], [['search', true, true]]], 'a page added with update-coverage --new has no source page: named, not gated');
});
check('selectPages — prototype stage: the state rows with a prototypePath, served from --proto-base; the ledger is not read', () => {
  const state = { pages: [stRow('a', { prototypePath: 'stardust/prototypes/a.html' }), stRow('b')] };
  const r = selectPages({ state, coverage: { pages: [covRow('b', 'verified')] }, stage: 'prototype', protoBase: 'http://localhost:9000' });
  assert.deepEqual(r.pages.map((p) => [p.slug, p.liveUrl]), [['a', 'http://localhost:9000/a.html']]);
});

// ---- overlay / locale pass-through: the flags reach both captures and every probe that takes them -------------------------
check('parseArgs: --consent / --dismiss / --no-dismiss / --locale (default en-US), --coverage', () => {
  const d = parseArgs(['node', 'x']);
  assert.deepEqual([d.consent, d.dismiss, d.noDismiss, d.locale, d.coverage], [null, null, false, 'en-US', 'stardust/rollout/coverage/pages.json']);
  const o = parseArgs(['node', 'x', '--consent', '#accept', '--dismiss', '.modal .close,.promo-x', '--locale', 'de-DE', '--coverage', 'c.json']);
  assert.deepEqual([o.consent, o.dismiss, o.noDismiss, o.locale, o.coverage], ['#accept', '.modal .close,.promo-x', false, 'de-DE', 'c.json']);
  assert.equal(parseArgs(['node', 'x', '--no-dismiss']).noDismiss, true);
  const bad = spawnSync(process.execPath, [SCRIPT, '--no-dismiss', '--consent', '#accept'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--no-dismiss contradicts --consent \/ --dismiss/);
});
check('child commands: both captures get --consent, --dismiss and --locale (or --no-dismiss); every probe gets the flags it accepts; en-US when --locale is absent', () => {
  const o = { ...parseArgs(['node', 'x', '--consent', '#accept', '--dismiss', '.close,.x', '--locale', 'de-DE', '--vh', '800', '--warmup', 'https://origin.example/']) };
  const tail = (args, flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  for (const [side, args] of [['origin', stitchArgs('stitch-shot.mjs', 'https://origin.example/a', 'o.png', o, ['--headed'])], ['eds', stitchArgs('stitch-shot.mjs', 'https://eds.example/a', 'e.png', o)]]) {
    assert.deepEqual([tail(args, '--consent'), tail(args, '--dismiss'), tail(args, '--locale'), tail(args, '--vh'), args.includes('--settle'), args.includes('--no-dismiss')], ['#accept', '.close,.x', 'de-DE', '800', true, false], side);
  }
  assert.deepEqual(stitchArgs('s', 'u', 'o.png', o, ['--headed']).slice(-1), ['--headed']);
  const units = [{ origin: '.card', eds: '.cards > div', n: 3, required: true }];
  const probes = { 'content-presence': contentArgs('c', 'https://origin.example/a', 'https://eds.example/a', 'content.json', o, { variable: ['.news'], main: 'main' }), 'clip-probe': clipArgs('c', 'https://eds.example/a', 'clip.json', o), 'unit-geometry': unitArgs('u', 'https://origin.example/a', 'https://eds.example/a', 'units.json', 'a', units, { ...o, unitTol: 4 }) };
  for (const [name, args] of Object.entries(probes)) {
    assert.equal(tail(args, '--locale'), 'de-DE', name);
    for (const flag of ['--consent', '--dismiss']) assert.equal(args.includes(flag), CHILD_FLAGS[name].includes(flag), name + ' ' + flag + ': passed only when the child accepts it');
    assert.equal(args.includes('--no-dismiss'), false, name + ': --no-dismiss only when asked for');
  }
  assert.deepEqual([tail(probes['content-presence'], '--variable'), tail(probes['content-presence'], '--main'), tail(probes['content-presence'], '--warmup')], ['.news', 'main', 'https://origin.example/']);
  { const ua = probes['unit-geometry']; const k = ua.indexOf('--unit-pair'); assert.deepEqual([ua[k + 1], ua[k + 2], tail(ua, '--n'), tail(ua, '--tol'), tail(ua, '--slug')], ['.card', '.cards > div', '3', '4', 'a']); assert.equal(ua.includes('--unit'), false); }
  const off = parseArgs(['node', 'x', '--no-dismiss']);
  assert.deepEqual(passThrough('stitch-shot', off), ['--locale', 'en-US', '--hold-timers', '--hold-min', '2000', '--no-dismiss']);
  assert.deepEqual(passThrough('clip-probe', off), ['--locale', 'en-US', '--no-dismiss']);
  assert.deepEqual(stitchArgs('s', 'u', 'o.png', parseArgs(['node', 'x'])), ['s', 'u', 'o.png', '--width', '1440', '--settle', '--locale', 'en-US', '--hold-timers', '--hold-min', '2000'], 'no flag: the default hold and nothing else');
  assert.deepEqual(stitchArgs('s', 'u', 'o.png', parseArgs(['node', 'x', '--no-hold-timers'])), ['s', 'u', 'o.png', '--width', '1440', '--settle', '--locale', 'en-US'], '--no-hold-timers: the command line as it was');
});
check('CHILD_FLAGS is what each child\'s own parseArgs accepts — a flag listed is accepted, an accepted one is listed (a probe that gains --dismiss fails here until it is wired)', () => {
  const src = { 'stitch-shot': join(HERE, '../stitch-shot.mjs'), 'content-presence': join(HERE, '../../../diff/scripts/content-presence.mjs'), 'clip-probe': join(HERE, '../../../diff/scripts/clip-probe.mjs'), 'unit-geometry': join(HERE, '../../../diff/scripts/unit-geometry.mjs') };
  assert.deepEqual(Object.keys(CHILD_FLAGS).sort(), Object.keys(src).sort());
  for (const [name, file] of Object.entries(src)) {
    const text = readFileSync(file, 'utf8');
    // a probe takes the three overlay flags through measure-live's overlayFlag(); --locale and stitch-shot's own flags are parsed in place
    const accepted = ['--consent', '--dismiss', '--no-dismiss', '--locale', '--hold-timers', '--hold-min'].filter((flag) => text.includes("=== '" + flag + "'") || (['--consent', '--dismiss', '--no-dismiss'].includes(flag) && text.includes('overlayFlag(a,')));
    assert.deepEqual([...CHILD_FLAGS[name]].sort(), accepted.sort(), name);
  }
});

// ---- verdict integrity: a probe error is an error row -------------------------------------------------------------------
check('verdict: a unit selector error is named in the reason, with the selector and what to fix — "off 0 hidden 0 missing 0" alone said nothing', () => {
  const ok = { pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) };
  const v = verdict({ ...ok, units: { verdict: { off: 0, hidden: 0, missing: 0, errors: 1 }, required: true, errors: ['.cards > li=.cards > div — no visible unit on the served side (3 / 0 DOM matches)'] } });
  assert.equal(v.pass, false);
  assert.deepEqual(v.reasons, ['units off 0 hidden 0 missing 0 — 1 selector error(s): .cards > li=.cards > div — no visible unit on the served side (3 / 0 DOM matches) (fix the family\'s selector in stardust/replica/units.json)']);
  assert.deepEqual(verdict({ ...ok, units: { verdict: { off: 2, hidden: 0, missing: 0, errors: 0 }, required: true } }).reasons, ['units off 2 hidden 0 missing 0']);
  assert.match(verdict({ ...ok, units: { verdict: { off: 0, hidden: 0, missing: 0, errors: 2 }, required: true } }).reasons[0], /2 selector error\(s\) \(fix the family/);
});
check('verdict: a probe that errored is never a pass — probeErrors + one probe-error:<probe> reason each; not applicable (origin not probed, no units, a criterion switched off) stays as it was', () => {
  const ok = { pixel: px(1.5, 0), clip: clip(0), content: content(0, 0) };
  const c = verdict({ ...ok, content: { error: 'content-presence exit 1: boom', probeError: true } });
  assert.deepEqual([c.pass, c.pixelOnlyPass, c.contentPass, c.contentNA, c.probeErrors, c.reasons], [false, true, null, null, [{ probe: 'content', error: 'content-presence exit 1: boom' }], ['probe-error:content: content-presence exit 1: boom']]);
  const k = verdict({ ...ok, clip: { error: 'clip-probe exit null: [gate-all] TIMEOUT' } });
  assert.deepEqual([k.pass, k.clipPass, k.clipped, k.probeErrors.map((e) => e.probe)], [false, null, null, ['clip']]);
  const u = verdict({ ...ok, units: { error: 'unit-geometry exit 1: x', required: false } });
  assert.deepEqual([u.pass, u.unitPass, u.probeErrors.map((e) => e.probe)], [false, null, ['units']]);
  const all = verdict({ pixel: px(1.5, 0), clip: { error: 'c' }, content: { error: 'd', probeError: true }, units: { error: 'e' }, capture: { fonts: [{ family: 'A', side: 'eds' }], fontsSkipped: [] } });
  assert.deepEqual(all.reasons, ['probe-error:content: d', 'probe-error:clip: c', 'probe-error:units: e', 'font-not-loaded:A']);
  const na = verdict({ ...ok, content: { error: 'origin HTTP 403' }, units: null });
  assert.deepEqual([na.pass, na.probeErrors, na.contentNA], [true, [], 'origin HTTP 403']);
  assert.deepEqual(verdict({ ...ok, clip: null, content: null }).probeErrors, [], 'not probed is not an error');
  const off = verdict({ pixel: px(1.5, 0), clip: { error: 'c' }, content: { error: 'd', probeError: true } }, { clipOn: false, contentOn: false });
  assert.deepEqual([off.pass, off.probeErrors], [true, []], 'a criterion switched off cannot error');
  assert.equal(verdict({ ...ok, clip: { error: 'c' }, override: { verdict: 'PASS', reason: 'R-01' } }).passWithOverride, false, 'no override waives an errored probe: the criterion was not measured');
  assert.deepEqual(verdict({ ...ok, clip: { error: 'c' }, override: { verdict: 'PASS', reason: 'R-01', waives: ['clip', 'probe'] } }).unwaived, ['probe']);
  assert.deepEqual([{ pct: null }, { pct: 3, probeErrors: [{ probe: 'clip' }] }, { pct: 30, probeErrors: [] }, { pct: 3 }].map(isErrorRow), [true, true, false, false]);
});
check('formatSummary: a probe-error row reads ERROR (probe: …), its content cell ERROR, and the calibration line counts it apart from FAIL', () => {
  const row = { slug: 'a', path: '/a', pct: 1.5, heightDelta: 0, clipped: null, content: null, contentNA: null, units: null, pass: false, pixelOnlyPass: true, fontsNotLoaded: [], fontChecksSkipped: [], probeErrors: [{ probe: 'content', error: 'x' }], reasons: ['probe-error:content: x'], notes: [], override: null, error: null };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { pages: 1, pass: 0, pixelOnlyPass: 1, overridePass: 0, fail: 0, error: 1, probeErrors: 1, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 }, rows: [row] });
  assert.match(md, /\*\*0 PASS \/ 0 FAIL \/ 1 error of 1\*\*/); assert.match(md, /probe errors 1 \(error rows, not FAIL\)/);
  assert.match(md, /\| ERROR \| - \| ERROR \(probe: content\) \| probe-error:content: x \|/);
});
check('recordedProbes: probes.json as written, errors included; a dir from before it reads the probes\' own JSON; an empty dir has none', () => {
  const d = mkdtempSync(join(tmpdir(), 'gate-all-probes-'));
  try {
    assert.deepEqual(recordedProbes(d), {});
    const counts = { total: 2 };
    writeFileSync(join(d, 'content.json'), JSON.stringify({ _provenance: { tier: 'chrome' }, totals: { missing: 1, hidden: 0 }, scope: 'main', eds: { clip: { counts, groups: [] } }, origin: { clip: { counts } } }));
    writeFileSync(join(d, 'units.json'), JSON.stringify({ verdict: { off: 0, hidden: 0, missing: 0, errors: 0 } }));
    const legacy = recordedProbes(d, { presence: { variable: ['.news'], reason: 'rotates' } });
    assert.deepEqual([legacy.content.totals.missing, legacy.content.variable, legacy.content.tier, legacy.clip.counts.total, legacy.clip.source, legacy.units.verdict.off], [1, ['.news'], 'chrome', 2, 'content-presence', 0]);
    rmSync(join(d, 'content.json')); writeFileSync(join(d, 'clip.json'), JSON.stringify({ counts, groups: [] }));
    assert.deepEqual([recordedProbes(d).content, recordedProbes(d).clip.source], [undefined, 'clip-probe']);
    writeFileSync(join(d, 'probes.json'), JSON.stringify({ writtenBy: 'gate-all.mjs', content: { error: 'content-presence exit 1: x', probeError: true }, clip: { error: 'clip-probe exit 1: y' } }));
    assert.deepEqual(recordedProbes(d), { content: { error: 'content-presence exit 1: x', probeError: true }, clip: { error: 'clip-probe exit 1: y' } }, 'the record wins over the probes\' files');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
check('runner: the ledger alone selects the delivered pages (no state row says deployed); with neither source the error names both files', () => {
  const { root, gateAll, rows, done } = sandbox(['a', 'b']);
  try {
    const state = { pages: [{ slug: 'a', url: 'https://origin.example/a', status: 'migrated', template: 't' }, { slug: 'b', url: 'https://origin.example/b', status: 'migrated' }] };
    writeFileSync(join(root, 'stardust/state.json'), JSON.stringify(state));
    let r = gateAll();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no deployed pages selected — two sources consulted: stardust\/state\.json \(rows with status "deployed" \+ liveUrl \+ url: none\) and stardust\/rollout\/coverage\/pages\.json \(not found\)/);
    mkdirSync(join(root, 'stardust/rollout/coverage'), { recursive: true });
    writeFileSync(join(root, 'stardust/rollout/coverage/pages.json'), JSON.stringify({ pages: [covRow('a', 'verified'), covRow('b', 'pending')] }));
    r = gateAll();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.keys(rows()), ['a']); assert.deepEqual([rows().a.path, rows().a.template, rows().a.pass], ['/a', 't', true]);
    assert.match(r.stderr, /1 page\(s\) — 0 from stardust\/state\.json, 1 from stardust\/rollout\/coverage\/pages\.json/);
    writeFileSync(join(root, 'stardust/rollout/coverage/pages.json'), JSON.stringify({ pages: [covRow('b', 'pending')] }));
    r = gateAll();
    assert.equal(r.status, 1); assert.match(r.stderr, /pages\.json \(rows with delivery\.status deployed \| verified, or failed on a gate, and a build URL: none\)/);
  } finally { done(); }
});
check('runner: the overlay and locale flags reach both captures and every probe spawned; a probe error is an error row — never a pass, not a FAIL (exit 2); origin not probed stays n/a', () => {
  const { gateAll, spawned, rows, totals, out, done } = sandbox(['good'], { probes: true });
  try {
    let r = gateAll(['--consent', '#accept', '--dismiss', '.close,.x', '--locale', 'de-DE']);
    assert.equal(r.status, 0, r.stderr);
    const tail = (args, flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
    const calls = spawned();
    assert.deepEqual(calls.map((c) => c[0]).sort(), ['content-presence', 'stitch-shot', 'stitch-shot'], 'two captures and the content probe (its clip result stands in for clip-probe)');
    for (const c of calls) assert.equal(tail(c, '--locale'), 'de-DE', c[0] + ' ' + c[1]);
    for (const c of calls) assert.deepEqual([tail(c, '--consent'), tail(c, '--dismiss')], ['#accept', '.close,.x'], c[0] + ' ' + c[1]);
    assert.deepEqual([rows().good.pass, rows().good.probeErrors, totals().error, totals().probeErrors], [true, [], 0, 0]);

    r = gateAll(['--no-content', '--no-dismiss']);
    assert.deepEqual(spawned().map((c) => [c[0], c.includes('--no-dismiss'), tail(c, '--locale')]).sort(), [['clip-probe', true, 'en-US'], ['stitch-shot', true, 'en-US'], ['stitch-shot', true, 'en-US']]);

    r = gateAll([], { STUB_CONTENT_RC: '1' });
    assert.equal(r.status, 2, r.stderr);
    let row = rows().good;
    assert.deepEqual([row.pass, row.pixelOnlyPass, row.pct, row.probeErrors.map((e) => e.probe), row.contentNA], [false, true, 1, ['content'], null]);
    assert.match(row.reasons[0], /^probe-error:content: content-presence exit 1: content-presence error: stub exit 1/);
    assert.deepEqual([totals().pass, totals().fail, totals().error, totals().probeErrors], [0, 0, 1, 1], 'counted as an error, not as a FAIL');
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /ERROR \(probe: content\)/);
    assert.ok(existsSync(join(out, 'good/origin.png')), 'an error row is not a pass: its captures stay');

    r = gateAll(['--no-content'], { STUB_CLIP_RC: 'kill' });
    assert.equal(r.status, 2, r.stderr);
    row = rows().good;
    assert.deepEqual([row.pass, row.probeErrors.map((e) => e.probe), totals().error, totals().fail], [false, ['clip'], 1, 0], 'a probe killed mid-run (what a timeout leaves) is an error too');

    r = gateAll([], { STUB_CONTENT_RC: '4' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([rows().good.pass, rows().good.probeErrors, /^origin /.test(rows().good.contentNA), totals().contentNA], [true, [], true, 1], 'origin HTTP error: content n/a as before, the clip probe still ran');
  } finally { done(); }
});
check('--compare-only spawns no capture and no probe: it re-reads the recorded probe results (errors included) and re-applies the sidecars', () => {
  const { gateAll, spawned, shots, rows, totals, out, done } = sandbox(['good', 'bad'], { probes: true });
  try {
    let r = gateAll([], { STUB_CONTENT_RC: '1', STUB_CLIP_RC: '1' });
    assert.equal(r.status, 2, r.stderr); assert.equal(totals().error, 2);
    r = gateAll(['--compare-only']);
    assert.deepEqual([spawned(), shots()], [[], []], 'nothing captured, nothing probed');
    assert.deepEqual([rows().good.pass, rows().good.probeErrors.map((e) => e.probe), totals().error], [false, ['content', 'clip'], 2], 'the recorded probe errors still stand');

    r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([rows().good.pass, rows().bad.pass, rows().bad.content.missing, rows().bad.clipped], [true, false, 0, 0]);
    writeFileSync(join(out, 'clip-allow.json'), JSON.stringify({ bad: { max: 3, reason: 'a documented carousel' } }));
    r = gateAll(['--compare-only']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([spawned(), shots()], [[], []], 'nothing captured, nothing probed');
    assert.deepEqual([rows().good.pass, rows().bad.pass, rows().bad.content.missing, rows().bad.clipped, rows().bad.clipAllowance, rows().bad.browser], [true, false, 0, 0, 3, 'chrome'], 'the recorded content and clip results, the sidecar re-applied');
    assert.deepEqual([totals().fail, totals().error], [1, 0]);

    rmSync(join(out, 'bad/probes.json'));
    r = gateAll(['--compare-only']);
    assert.deepEqual([spawned(), rows().bad.content.missing, rows().bad.clipped], [[], 0, 0], 'a page dir from before probes.json: the probes\' own JSON');
  } finally { done(); }
});
// ---- the schedule: probes beside the captures and beside each other, under one cap; the rows do not depend on it ----
const PROBE_KINDS = ['content-presence', 'clip-probe', 'unit-geometry'];
const overlap = (x, y) => x.t0 < y.t1 && y.t0 < x.t1;
const maxInFlight = (spans) => Math.max(0, ...spans.map((x) => spans.filter((y) => y.t0 <= x.t0 && x.t0 < y.t1).length));
check('schedule: the content and unit probes of a page overlap in time; the clip probe runs after a content probe that gave no clip result', () => {
  const { gateAll, times, rows, done } = sandbox(['a'], { probes: true, units: true });
  try {
    let r = gateAll(['--max-browsers', '3'], { STUB_PROBE_MS: '500' }); // one page: the default budget is 1 — more is asked for
    assert.equal(r.status, 0, r.stderr);
    const of = (kind) => times().find((t) => t.kind === kind);
    assert.ok(overlap(of('content-presence'), of('unit-geometry')), JSON.stringify(times()));
    assert.equal(of('clip-probe'), undefined, 'content gave the clip result');
    assert.deepEqual([rows().a.pass, rows().a.units.off, rows().a.content.missing, rows().a.clipped], [true, 0, 0, 0]);
    r = gateAll(['--max-browsers', '3'], { STUB_PROBE_MS: '300', STUB_CONTENT_RC: '4' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(of('clip-probe').t0 >= of('content-presence').t1, 'clip only once content has answered without one');
    assert.ok(overlap(of('content-presence'), of('unit-geometry')));
  } finally { done(); }
});
check('schedule: probes start before the batch\'s captures have all finished', () => {
  const { gateAll, times, done } = sandbox(['a', 'b', 'c'], { probes: true, units: true });
  try {
    const r = gateAll(['--eds-concurrency', '1'], { STUB_SHOT_MS: '400', STUB_PROBE_MS: '100' });
    assert.equal(r.status, 0, r.stderr);
    const shots = times().filter((t) => t.kind === 'stitch-shot'); const probes = times().filter((t) => PROBE_KINDS.includes(t.kind));
    assert.deepEqual([shots.length, probes.length], [6, 6]);
    const lastShot = Math.max(...shots.map((t) => t.t1));
    assert.ok(Math.min(...probes.map((t) => t.t0)) < lastShot, 'the first probe did not wait for the captures');
    assert.ok(probes.filter((t) => t.t1 <= lastShot).length >= 2, 'probes ended while captures were still running');
  } finally { done(); }
});
check('schedule: --probe-concurrency caps the probe processes in flight across pages (2 → at most 2, 1 → one at a time); the default is 2', () => {
  const { gateAll, times, done } = sandbox(['a', 'b', 'c', 'd'], { probes: true, units: true });
  try {
    const run = (n) => { const r = gateAll(['--probe-concurrency', String(n)], { STUB_PROBE_MS: '250' }); assert.equal(r.status, 0, r.stderr); return times().filter((t) => PROBE_KINDS.includes(t.kind)); };
    let probes = run(2);
    assert.equal(probes.length, 8, 'content + units for each of the four pages');
    assert.equal(maxInFlight(probes), 2, JSON.stringify(probes));
    probes = run(1);
    assert.equal(maxInFlight(probes), 1, JSON.stringify(probes));
    assert.equal(parseArgs(['node', 'x']).pc, 2); assert.equal(parseArgs(['node', 'x', '--probe-concurrency', '7']).pc, 7);
  } finally { done(); }
});
await checkAsync('limiter: at most n in flight, first come first served; a rejection frees its slot; n < 1 or not a number runs one at a time', async () => {
  const trace = async (n) => {
    const slot = limiter(n); let active = 0; let peak = 0; const started = [];
    const job = (i) => slot(async () => { started.push(i); active += 1; peak = Math.max(peak, active); await new Promise((res) => { setTimeout(res, 5); }); active -= 1; if (i === 1) throw new Error('boom'); return i; });
    const settled = await Promise.allSettled([0, 1, 2, 3, 4].map(job));
    return { peak, started, settled: settled.map((x) => x.status === 'fulfilled' ? x.value : x.reason.message) };
  };
  assert.deepEqual(await trace(2), { peak: 2, started: [0, 1, 2, 3, 4], settled: [0, 'boom', 2, 3, 4] });
  assert.equal((await trace(9)).peak, 5);
  for (const n of [1, 0, NaN, undefined]) assert.equal((await trace(n)).peak, 1, String(n));
});
check('schedule: rows, their order and the probe records are the same whichever probe ends first — one at a time (the serial order) against the default, with the durations reversed', () => {
  const slugs = ['a', 'b', 'c', 'd', 'e'];
  // fixed results: b misses content, c's content probe errors (the clip probe then runs), d's units are off, e's unit probe is killed
  const results = { b: { 'content-presence': { missing: 2 } }, c: { 'content-presence': { rc: 1 } }, d: { 'unit-geometry': { off: 1 } }, e: { 'unit-geometry': { rc: 'kill' } } };
  const timed = (order) => Object.fromEntries(slugs.map((s, i) => [s, { 'content-presence': { ...(results[s] || {})['content-presence'], ms: 60 * (order ? i + 1 : slugs.length - i) }, 'unit-geometry': { ...(results[s] || {})['unit-geometry'], ms: 60 * (order ? slugs.length - i : i + 1) } }]));
  const outcome = (args, by) => {
    const { gateAll, tableOf, out, done } = sandbox(slugs, { probes: true, units: true });
    try {
      const r = gateAll(args, { STUB_BY_SLUG: JSON.stringify(by) });
      assert.equal(r.status, 2, r.stderr);
      const t = tableOf('all-1440');
      const records = Object.fromEntries(slugs.map((s) => [s, Object.fromEntries(['probes.json', 'clip.json', 'content.json', 'units.json'].filter((f) => existsSync(join(out, s, f))).map((f) => [f, readFileSync(join(out, s, f), 'utf8').replace(/"at": ?"[^"]*"/g, '"at":""')]))]));
      return { rows: t.rows, totals: t.totals, table: readFileSync(join(out, 'summary.md'), 'utf8').split('\n').slice(8).join('\n'), records, files: Object.fromEntries(slugs.map((s) => [s, readdirSync(join(out, s)).sort()])) };
    } finally { done(); }
  };
  const serial = outcome(['--probe-concurrency', '1', '--eds-concurrency', '1', '--origin-concurrency', '1'], timed(true));
  assert.deepEqual(serial.rows.map((r) => r.slug), slugs, 'the roster\'s order');
  assert.deepEqual(serial.rows.map((r) => [r.pass, r.failing.join()]), [[true, ''], [false, 'content'], [false, 'probe'], [false, 'units'], [false, 'probe']]);
  assert.deepEqual(serial.rows.map((r) => r.probeErrors.map((e) => e.probe).join()), ['', '', 'content', '', 'units']);
  assert.deepEqual([serial.totals.pass, serial.totals.fail, serial.totals.error], [1, 2, 2]);
  assert.deepEqual(Object.keys(JSON.parse(serial.records.a['probes.json'])), ['writtenBy', 'at', 'content', 'clip', 'units'], 'the record\'s key order');
  for (const [name, args, by] of [['default cap, same durations', [], timed(true)], ['default cap, units end first', [], timed(false)], ['cap 3, units end first', ['--probe-concurrency', '3'], timed(false)], ['one browser at a time', ['--max-browsers', '1'], timed(false)], ['three browsers', ['--max-browsers', '3'], timed(true)]]) {
    assert.deepEqual(outcome(args, by), serial, name);
  }
});
check('schedule: a failing probe and a failing capture read as before — the unit probe\'s error is an error row beside a recorded content result; a page whose capture failed is an error row with no percentage, its probes recorded', () => {
  const { gateAll, rows, totals, out, done } = sandbox(['a', 'b'], { probes: true, units: true });
  try {
    let r = gateAll([], { STUB_BY_SLUG: JSON.stringify({ a: { 'unit-geometry': { rc: 1 } } }), STUB_PROBE_MS: '100' });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([rows().a.pass, rows().a.pct, rows().a.probeErrors.map((e) => e.probe), rows().a.content.missing, rows().a.clipped, rows().b.pass], [false, 1, ['units'], 0, 0, true]);
    assert.match(rows().a.reasons[0], /^probe-error:units: unit-geometry exit 1: unit-geometry error: stub exit 1/);
    assert.deepEqual([totals().pass, totals().fail, totals().error, totals().probeErrors], [1, 0, 1, 1]);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(out, 'a/probes.json'), 'utf8'))).slice(2), ['content', 'clip', 'units']);
    assert.ok(existsSync(join(out, 'a/origin.png')) && !existsSync(join(out, 'b/origin.png')), 'the error row keeps its captures, the pass drops them');

    r = gateAll([], { STUB_FAIL: 'https://eds.example/b', STUB_PROBE_MS: '100' });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([rows().b.pct, rows().b.pass, rows().b.reasons, rows().b.error, rows().a.pass], [null, false, ['pixel error: missing capture'], 'missing capture', true]);
    assert.match(JSON.parse(readFileSync(join(out, 'b/eds.json'), 'utf8')).error, /stitch exit 1: capture failed/);
    assert.deepEqual([rows().b.content.missing, rows().b.units.off, rows().b.probeErrors], [0, 0, []], 'its probes ran and are recorded, as before');
    assert.deepEqual([totals().pass, totals().fail, totals().error, totals().probeErrors], [1, 0, 1, 0]);
  } finally { done(); }
});
// ---- the browser budget: one cap per job over every child that opens a browser -----------------------------------
await checkAsync('browserBudget: a given cap holds over every kind; without one the cap is the larger of eds and probe, plus one per origin browser open — what the phases held in turn', async () => {
  const trace = async (opts, jobs) => {
    const slot = browserBudget(opts); let open = 0; let peak = 0; let originPeak = 0; let origin = 0;
    await Promise.all(jobs.map((kind) => slot(kind, async () => { open += 1; if (kind === 'origin') origin += 1; peak = Math.max(peak, open); originPeak = Math.max(originPeak, origin); await new Promise((res) => { setTimeout(res, 5); }); open -= 1; if (kind === 'origin') origin -= 1; })));
    return [peak, slot.peak()];
  };
  const mix = (o, e, p) => [...Array(o).fill('origin'), ...Array(e).fill('eds'), ...Array(p).fill('probe')];
  assert.deepEqual(await trace({ max: 3, eds: 4, probe: 4 }, mix(4, 6, 6)), [3, 3]);
  assert.deepEqual(await trace({ max: 1, eds: 4, probe: 2 }, mix(2, 3, 3)), [1, 1]);
  assert.deepEqual(await trace({ eds: 1, probe: 1 }, mix(0, 5, 5)), [1, 1], '1/1/1, references frozen: one browser at a time');
  assert.deepEqual(await trace({ eds: 1, probe: 1 }, mix(1, 5, 5)), [2, 2], '1/1/1, one origin capture with a browser: two, as the capture phase held');
  assert.deepEqual(await trace({ eds: 4, probe: 2 }, mix(0, 9, 9)), [4, 4], 'the defaults, frozen: the build pool\'s four');
  assert.deepEqual(await trace({ eds: 4, probe: 2 }, mix(2, 9, 9)), [6, 6], 'the defaults, first pass: origin 2 + eds 4');
  assert.deepEqual(await trace({ eds: 1, probe: 4 }, mix(2, 9, 9)), [4, 4], 'probe above origin + eds: the probe phase\'s four');
  assert.deepEqual([maxBrowsersOf('3', {}), maxBrowsersOf(null, { STARDUST_MAX_BROWSERS: '2' }), maxBrowsersOf('3', { STARDUST_MAX_BROWSERS: '2' }), maxBrowsersOf(null, {}), maxBrowsersOf(null, { STARDUST_MAX_BROWSERS: '' })], [{ max: 3, from: 'flag' }, { max: 2, from: 'env' }, { max: 3, from: 'flag' }, { max: null, from: 'default' }, { max: null, from: 'default' }]);
  for (const bad of ['0', 'x', '1.5', '-2']) { assert.match(maxBrowsersOf(bad, {}).error, /--max-browsers needs a whole number/); assert.match(maxBrowsersOf(null, { STARDUST_MAX_BROWSERS: bad }).error, /STARDUST_MAX_BROWSERS needs a whole number/); }
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--max-browsers', '0'], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, STARDUST_MAX_BROWSERS: 'many' } }).status, 1, 'a cap that cannot be read stops the job');
  assert.match(spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' }).stdout, /--max-browsers <n>\s+browser processes this job holds at once[^]*STARDUST_MAX_BROWSERS, else what the phases held in turn for THIS job[^]*One page: 1 \(2 while\s+its origin is frozen\); 12 pages at the defaults: 4/);
  assert.equal(budgetLine({ maxBrowsers: 3, maxBrowsersFrom: 'env', oc: 2, ec: 4, pc: 2 }), 'browser budget: 3 at once (STARDUST_MAX_BROWSERS)');
  assert.match(budgetLine({ maxBrowsers: null, oc: 2, ec: 4, pc: 2 }, { capture: 1, probe: 1 }), /^browser budget: 1 at once \(default for this job: the larger of min\(1 page\(s\) to capture, --eds-concurrency 4\) and min\(1 page\(s\) to probe, --probe-concurrency 2\)\)/);
});
check('browser budget: the stub browsers open at once never exceed the budget — 1/1/1 frozen holds one, 1/1/1 on a first pass two, the defaults four (frozen, 12 pages) or six (first pass), --max-browsers and STARDUST_MAX_BROWSERS what they say; the first log line names the budget and its source', () => {
  const slugs = Array.from({ length: 12 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  const { gateAll, times, totals, out, done } = sandbox(slugs, { probes: true, units: true });
  const ONE = ['--origin-concurrency', '1', '--eds-concurrency', '1', '--probe-concurrency', '1'];
  try {
    const peak = (args, env = {}) => {
      const r = gateAll(args, { STUB_SHOT_MS: '90', STUB_PROBE_MS: '90', ...env });
      assert.equal(r.status, 0, r.stderr); assert.equal(totals().pass, 12);
      const firstLine = r.stdout.split('\n')[0].replace(/^\S+ /, '');
      return [maxInFlight(times()), times().filter((t) => t.kind === 'reference').length, firstLine];
    };
    // first pass: every origin is frozen now (reference.mjs: a browser each)
    let [n, freezes, line] = peak(ONE, REF);
    assert.deepEqual([n, freezes], [2, 12], '1/1/1, first pass: the origin freeze beside one other browser, as the capture phase held');
    assert.match(line, /^browser budget: 1 at once \(default for this job: the larger of min\(12 page\(s\) to capture, --eds-concurrency 1\) and min\(12 page\(s\) to probe, --probe-concurrency 1\)\), plus one per origin capture that opens a browser/);
    // the references are frozen from here on: no origin browser
    [n, freezes] = peak(ONE, REF);
    assert.deepEqual([n, freezes], [1, 0], '1/1/1, frozen: ONE browser at a time');
    [n, freezes, line] = peak([...ONE, '--max-browsers', '2'], REF);
    assert.deepEqual([n, freezes, line], [2, 0, 'browser budget: 2 at once (--max-browsers)']);
    [n] = peak([...ONE, '--max-browsers', '3'], REF);
    assert.equal(n, 2, 'the per-kind limits hold inside a larger budget: one build capture, one probe');
    [n] = peak(['--origin-concurrency', '1', '--eds-concurrency', '2', '--probe-concurrency', '1'], REF);
    assert.equal(n, 2, '1/2/1, frozen: the build pool\'s two');
    [n, freezes, line] = peak([], REF);
    assert.deepEqual([n, freezes], [4, 0], 'the defaults, frozen, 12 pages: four');
    assert.match(line, /^browser budget: 4 at once \(default for this job: the larger of min\(12 page\(s\) to capture, --eds-concurrency 4\) and min\(12 page\(s\) to probe, --probe-concurrency 2\)\)/);
    [n] = peak(['--max-browsers', '3'], REF);
    assert.equal(n, 3);
    [n] = peak(['--max-browsers', '1'], REF);
    assert.equal(n, 1);
    [n, , line] = peak([], { ...REF, STARDUST_MAX_BROWSERS: '2' });
    assert.deepEqual([n, line], [2, 'browser budget: 2 at once (STARDUST_MAX_BROWSERS)']);
    [n, , line] = peak(['--max-browsers', '3'], { ...REF, STARDUST_MAX_BROWSERS: '2' });
    assert.deepEqual([n, line], [3, 'browser budget: 3 at once (--max-browsers)'], 'the flag wins over the variable');
    // a first pass at the defaults: the origin is stitched live on every run (GATE_REFERENCE=live), two at a time
    [n] = peak([]);
    assert.ok(n > 4 && n <= 6, `origin 2 + eds 4 at most, got ${n}`);
    [n] = peak(['--max-browsers', '3']);
    assert.equal(n, 3, 'a given cap covers the origin captures too');
    assert.ok(existsSync(join(out, 'summary.json')));
  } finally { done(); }
});
check('browser budget: a one-page job holds what it held before — the defaults one browser on a frozen reference and two while its origin is frozen, 1/2/1 one; two pages at the defaults two; --max-browsers opts in to more', () => {
  const run = (slugs, args, env = {}) => {
    const { gateAll, times, totals, done } = sandbox(slugs, { probes: true, units: true });
    try {
      const out = [];
      for (const [a, e] of [[args, env]].concat(env.then || [])) {
        const r = gateAll(a, { STUB_SHOT_MS: '120', STUB_PROBE_MS: '120', ...REF, ...e, then: undefined });
        assert.equal(r.status, 0, r.stderr); assert.equal(totals().pass, slugs.length);
        out.push([maxInFlight(times()), times().filter((t) => t.kind === 'reference').length, r.stdout.split('\n')[0].replace(/^\S+ /, '').split(' (')[0]]);
      }
      return out;
    } finally { done(); }
  };
  const TWO = ['--origin-concurrency', '1', '--eds-concurrency', '2', '--probe-concurrency', '1'];
  // first pass (the origin is frozen: a browser), then the frozen reference, then asking for three
  assert.deepEqual(run(['a'], [], { then: [[[], {}], [['--max-browsers', '3'], {}]] }), [[2, 1, 'browser budget: 1 at once'], [1, 0, 'browser budget: 1 at once'], [3, 0, 'browser budget: 3 at once']]);
  assert.deepEqual(run(['a'], TWO, { then: [[TWO, {}]] }), [[2, 1, 'browser budget: 1 at once'], [1, 0, 'browser budget: 1 at once']]);
  assert.deepEqual(run(['a', 'b'], [], { then: [[[], {}]] }).map((x) => [x[0] <= 4, x[2]]), [[true, 'browser budget: 2 at once'], [true, 'browser budget: 2 at once']]);
  assert.equal(run(['a', 'b'], [], { then: [[[], {}]] })[1][0], 2, 'two pages, frozen: two');
});
check('a failed re-capture leaves no old PNG to diff: the capture is removed first, so the row is an error with no percentage', () => {
  const { gateAll, pngs, rows, totals, out, done } = sandbox(['bad']);
  try {
    assert.equal(gateAll().status, 2);
    assert.deepEqual([pngs('bad'), rows().bad.pct], [['diff.png', 'eds.png', 'origin.png'], 30]);
    let r = gateAll(['--skip-existing', '--recapture-eds'], { STUB_FAIL: 'https://eds.example/bad' });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(pngs('bad'), ['origin.png'], 'the stale eds.png and its diff are gone');
    assert.deepEqual([rows().bad.pct, rows().bad.pass, rows().bad.reasons, totals().error, totals().fail], [null, false, ['pixel error: missing capture'], 1, 0]);
    assert.match(JSON.parse(readFileSync(join(out, 'bad/pixel.json'), 'utf8')).error, /missing capture/);
    assert.match(JSON.parse(readFileSync(join(out, 'bad/eds.json'), 'utf8')).error, /stitch exit 1/);

    assert.equal(gateAll().status, 2); assert.equal(rows().bad.pct, 30);
    r = gateAll(['--skip-existing', '--recapture-origin'], { STUB_FAIL: 'https://origin.example/bad' });
    assert.deepEqual([pngs('bad'), rows().bad.pct, totals().error], [['eds.png'], null, 1], '--recapture-origin: the previous origin is not kept either');
    assert.equal(gateAll([], { STUB_FAIL: 'https://origin.example/bad' }).status, 2);
    assert.deepEqual([pngs('bad'), rows().bad.pct], [['eds.png'], null], 'a plain run whose origin capture fails');
  } finally { done(); }
});
check('selectPages — a page named with --only and given --eds-host is selected before any ledger calls it delivered: path from the ledger row of any status, else from migratedPath; a bare host gets https://', () => {
  const state = { pages: [{ slug: 'a', url: 'https://origin.example/a/', status: 'migrated', migratedPath: 'stardust/migrated/a/index.html' }, { slug: 'home', url: 'https://origin.example/', status: 'migrated', migratedPath: 'stardust/migrated/index.html' }, { slug: 'b', url: 'https://origin.example/b.html', status: 'migrated', migratedPath: 'stardust/migrated/b.html' }, { slug: 'nopath', url: 'https://origin.example/n', status: 'migrated' }] };
  const coverage = { pages: [{ slug: 'b', path: '/bee', delivery: { status: 'pending' } }] };
  const sel = (only, edsHost) => selectPages({ state, coverage, edsHost, only });
  assert.deepEqual(sel(['a', 'home', 'b'], 'main--x--y.aem.page').pages.map((p) => [p.slug, p.liveUrl]), [['a', 'https://main--x--y.aem.page/a'], ['home', 'https://main--x--y.aem.page/'], ['b', 'https://main--x--y.aem.page/bee']]);
  assert.deepEqual(sel(['a'], 'https://h.example/').from, { state: 0, coverage: 0, named: 1 });
  assert.deepEqual(sel(['a'], null).pages, [], 'no build host: nothing to join the path to');
  assert.deepEqual(sel(null, 'https://h.example').pages, [], 'without --only nothing is assumed delivered');
  assert.match(sel(['nopath'], 'https://h.example').skipped[0].why, /no path/);
  assert.deepEqual([hostOrigin('main--x--y.aem.page'), hostOrigin('https://h.example/'), hostOrigin('http://localhost:3000'), hostOrigin('')], ['https://main--x--y.aem.page', 'https://h.example', 'http://localhost:3000', '']);
  assert.deepEqual([migratedPathOf('stardust/migrated/index.html'), migratedPathOf('stardust/migrated/a/b/index.html'), migratedPathOf('/w/stardust/migrated/x.html'), migratedPathOf('elsewhere/x.html'), migratedPathOf(undefined)], ['/', '/a/b', '/x', null, null]);
  assert.equal(parseArgs(['node', 'x', '--eds-host', 'main--x--y.aem.page/']).edsHost, 'https://main--x--y.aem.page');
});
check('selectPages — prototype stage: a row without prototypePath is selected when the conventional prototype file exists; without the file it is not', () => {
  const state = { pages: [{ slug: 'a', url: 'https://origin.example/a' }, { slug: 'b', url: 'https://origin.example/b', prototypePath: 'stardust/prototypes/b-v2.html' }, { slug: 'c', url: 'https://origin.example/c' }] };
  const sel = selectPages({ state, stage: 'prototype', protoBase: 'http://localhost:9000', protoExists: (f) => f === 'stardust/prototypes/a-proposed.html' });
  assert.deepEqual(sel.pages.map((p) => [p.slug, p.liveUrl]), [['a', 'http://localhost:9000/a-proposed.html'], ['b', 'http://localhost:9000/b-v2.html']]);
  assert.deepEqual(selectPages({ state, stage: 'prototype' }).pages.map((p) => p.slug), ['b'], 'no file check: as before');
});
await checkAsync('recordRounds: a published measurement with a verdict is a round of its page in gates/<slug>-<width>/rounds.json; error rows, the prototype stage and no rows record nothing; at the cap the slug is named; a broken ledger never throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-all-rounds-'));
  try {
    const opts = { stage: 'published', out: join(root, 'gates', 'all-1440'), width: 1440 };
    const row = (slug, pass, extra = {}) => ({ slug, pass, pct: pass ? 1 : 12, reasons: [], ...extra });
    assert.deepEqual(await recordRounds([], opts), []);
    assert.deepEqual(await recordRounds([row('a', false)], { ...opts, stage: 'prototype' }), []);
    assert.equal(existsSync(join(root, 'gates', 'a-1440')), false);
    let n = 0; const now = () => `2026-01-01T00:00:0${n++}.000Z`;
    assert.deepEqual(await recordRounds([row('a', false), row('b', true), row('c', false, { pct: null, error: 'capture failed' })], opts, { now }), []);
    const led = (s) => JSON.parse(readFileSync(join(root, 'gates', `${s}-1440`, 'rounds.json'), 'utf8')).stages['all-pages'].rounds;
    assert.deepEqual([led('a').map((r) => r.kind), led('b').map((r) => r.verdict), existsSync(join(root, 'gates', 'c-1440', 'rounds.json'))], [['first'], ['pass'], false]);
    assert.deepEqual(await recordRounds([row('a', false)], opts, { now }), []);
    assert.deepEqual(await recordRounds([row('a', false), row('b', true)], opts, { now }), ['a'], 'three counted rounds, the last a FAIL: at the cap');
    assert.deepEqual([led('a').length, led('b').map((r) => r.kind)], [3, ['first', 'confirm']]);
    const R = await import('../rounds.mjs'); const da = join(root, 'gates', 'a-1440'); const la = R.load(da).ledger;
    assert.equal(R.decide(la, 'all-pages', 'accept-residual', 'registered').error, undefined); R.save(da, la);
    assert.deepEqual(await recordRounds([row('a', false)], opts, { now }), [], 'a page closed by a decision on the roster stage is not named again');
    assert.equal(JSON.parse(readFileSync(join(root, 'gates', 'b-1440', 'rounds.json'), 'utf8')).stages.published, undefined, 'a pass here is never a gate.sh published round: it cannot free a confirmation there');
    assert.deepEqual(await recordRounds([row('a', false)], opts, { rounds: { load() { throw new Error('boom'); } } }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('referenceIgnoreNote: a project .gitignore from before the per-page references were left untracked gets one note naming the missing lines; the current template, a project without the tracking line, or no file gets none', () => {
  const tpl = readFileSync(join(HERE, '../../../stardust/reference/stardust.gitignore'), 'utf8');
  assert.equal(referenceIgnoreNote(tpl), null); assert.equal(referenceIgnoreNote(null), null); assert.equal(referenceIgnoreNote('**/gates/**/*.png\n'), null);
  const old = '**/gates/**/*.png\n!**/gates/**/baseline.png\n**/gates/all-*/**/baseline.png\n';
  assert.match(referenceIgnoreNote(old), /add below .*: \*\*\/gates\/prototypes-\*\/\*\*\/baseline\.png {2}\*\*\/gates\/wide-\*\/\*\*\/baseline\.png$/);
  for (const l of REFERENCE_IGNORES) assert.ok(tpl.includes(l), l);
});
check('givenFlags / inheritedOpts: the locale default is not a given setting; a page\'s build capture and probes take the settings the run omits from its frozen reference, never over a given one', () => {
  assert.deepEqual(givenFlags(parseArgs(['node', 'x', '--no-hold-timers'])), []);
  assert.deepEqual(givenFlags(parseArgs(['node', 'x', '--no-hold-timers', '--locale', 'de-DE', '--consent', '#a'])), ['--locale', 'de-DE', '--consent', '#a']);
  const run = parseArgs(['node', 'x', '--no-hold-timers']);
  const o = inheritedOpts(run, { consent: '#ok', dismiss: null, noDismiss: false, locale: 'de-DE' });
  assert.deepEqual([o.consent, o.locale, passThrough('stitch-shot', o)], ['#ok', 'de-DE', ['--locale', 'de-DE', '--consent', '#ok']]);
  assert.deepEqual(passThrough('stitch-shot', inheritedOpts(run, { noDismiss: true, locale: null })), ['--locale', 'en-US', '--no-dismiss']);
  const given = parseArgs(['node', 'x', '--locale', 'fr-FR']);
  assert.equal(inheritedOpts(given, { consent: '#ok', locale: 'de-DE' }), given, 'a given setting that differs: the reference is frozen again, nothing inherited');
  assert.equal(inheritedOpts(run, null), run);
});
check('timer hold (ON by default at 2000 ms; --no-hold-timers / --hold-min / --hold-timers / GATE_HOLD_TIMERS): reaches stitch-shot only, both sides; a run that names no hold takes a held reference\'s threshold; a capture taken under another hold is stale; two sides under different holds are an error row', () => {
  const dflt = parseArgs(['node', 'x']);
  assert.deepEqual([dflt.holdTimers, dflt.holdGiven, HOLD_DEFAULT], [2000, false, 2000]);
  const off = parseArgs(['node', 'x', '--no-hold-timers']);
  assert.deepEqual([off.holdTimers, off.holdGiven], [null, true]); assert.equal(passThrough('stitch-shot', off).join(' ').includes('hold'), false);
  assert.equal(parseArgs(['node', 'x', '--hold-timers']).holdTimers, 2000); assert.equal(parseArgs(['node', 'x', '--hold-min', '3000', '--hold-timers']).holdTimers, 3000);
  assert.deepEqual([envHold(undefined), envHold(''), envHold('0'), envHold('1'), envHold('2500')], [undefined, undefined, null, 2000, 2500]);
  const on = parseArgs(['node', 'x', '--hold-timers']);
  for (const o of [dflt, on]) for (const side of [stitchArgs('s', 'https://origin.example/a', 'o.png', o, ['--headed']), stitchArgs('s', 'https://eds.example/a', 'e.png', o)]) assert.deepEqual(side.slice(side.indexOf('--hold-timers'), side.indexOf('--hold-timers') + 3), ['--hold-timers', '--hold-min', '2000']);
  for (const probe of ['content-presence', 'clip-probe', 'unit-geometry']) assert.equal(passThrough(probe, dflt).join(' ').includes('hold'), false, probe);
  assert.deepEqual(givenFlags(on), ['--hold-timers', '--hold-min', '2000'], 'a given setting for reference.mjs settings');
  assert.deepEqual(givenFlags(dflt), ['--hold-timers', '--hold-min', '2000'], 'the default hold is given too: an unheld reference is "changed: holdTimers"');
  assert.equal(inheritedOpts(dflt, { consent: null, locale: null, holdTimers: 3000 }).holdTimers, 3000, 'no hold named: the reference\'s threshold');
  assert.equal(inheritedOpts(dflt, { consent: null, locale: null }).holdTimers, 2000, 'an unheld reference: the default stands');
  assert.deepEqual([inheritedOpts(dflt, { consent: '#ok', locale: null }).consent, inheritedOpts(dflt, { consent: '#ok', locale: null }).holdTimers], ['#ok', 2000], 'the default hold against an unheld reference keeps the settings it recorded');
  assert.equal(inheritedOpts(on, { consent: '#ok', locale: null }), on, 'asked for against an unheld reference: frozen again, nothing inherited');
  assert.equal(inheritedOpts(on, { consent: '#ok', locale: null, holdTimers: 2000 }).consent, '#ok');
  assert.equal(inheritedOpts(off, { consent: '#ok', locale: null, holdTimers: 2000 }), off, 'turned off against a held reference: frozen again without it, nothing inherited');
  assert.deepEqual([inheritedOpts(off, { consent: '#ok', locale: null }).consent, inheritedOpts(off, { consent: '#ok', locale: null }).holdTimers], ['#ok', null], 'turned off against an unheld reference: reused');
  assert.deepEqual([refHold({ flags: { holdTimers: 3000 } }), refHold({ timers: { hold: 2000 } }), refHold({ flags: {} }), refHold(null)], [3000, 2000, null, null]);
  const d = mkdtempSync(join(tmpdir(), 'gate-all-hold-'));
  try {
    const eds = join(d, 'eds.png'); writeFileSync(eds, 'png');
    const fixedLayers = { capture: 'once', count: 0, late: 0 }; const timers = { hold: 2000, held: 1, intervals: 1, chains: 0, delays: [5000] };
    writeFileSync(captureRecordOf(eds), JSON.stringify({ fixedLayers }));
    assert.equal(staleCapture(eds), false); assert.equal(staleCapture(eds, 2000), true, 'unheld, the run holds');
    assert.equal(staleReason(eds, 2000), 'was captured under another timer hold (none, this run 2000)');
    writeFileSync(captureRecordOf(eds), JSON.stringify({ fixedLayers, timers }));
    assert.equal(staleCapture(eds, 2000), false); assert.equal(staleCapture(eds), true, 'held, the run does not'); assert.equal(staleCapture(eds, 3000), true, 'another threshold');
    const live = join(d, 'live.png'); writeFileSync(live, 'png'); writeFileSync(join(d, 'live.json'), JSON.stringify({ origin: 'baseline' }));
    writeFileSync(join(d, 'baseline.json'), JSON.stringify({ fixedLayers, timers }));
    assert.equal(staleCapture(live, 2000), false, 'a copy of a held reference'); assert.equal(staleCapture(live), true);
    assert.equal(holdMismatch({ fixedLayers, timers }, { fixedLayers, timers }), null); assert.equal(holdMismatch({ fixedLayers }, { fixedLayers }), null);
    assert.equal(holdMismatch(null, { fixedLayers, timers }), null, 'no record on one side (a crawl shot): flagged asymmetric elsewhere');
    assert.match(holdMismatch({ fixedLayers, timers }, { fixedLayers }), /^timer hold differs: origin 2000, build none \(ms\) — not compared/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  const help = spawnSync(process.execPath, [join(HERE, '../gate-all.mjs'), '--help'], { encoding: 'utf8' }).stdout;
  assert.match(help, /--hold-timers /); assert.match(help, /--no-hold-timers /); assert.match(help, /--hold-min <ms>/); assert.match(help, /ON by default at\s+2000 ms/);
  assert.match(help, /Precedence: a flag wins over GATE_HOLD_TIMERS \(0 = off, 1 = 2000, a number = that threshold\), which\s+wins over the default/);
});
check('timer hold precedence: a flag wins over GATE_HOLD_TIMERS, which wins over the default; --no-hold-timers with --hold-timers / --hold-min is a usage error', () => {
  const was = process.env.GATE_HOLD_TIMERS;
  const under = (env, flags) => { if (env === undefined) delete process.env.GATE_HOLD_TIMERS; else process.env.GATE_HOLD_TIMERS = env; const o = parseArgs(['node', 'x', ...flags]); return [o.holdTimers, o.holdGiven]; };
  try {
    assert.deepEqual([under(undefined, []), under('0', []), under('1', []), under('2500', [])], [[2000, false], [null, true], [2000, true], [2500, true]], 'the variable over the default');
    assert.deepEqual([under('2500', ['--no-hold-timers']), under('0', ['--hold-min', '4000']), under('0', ['--hold-timers']), under('3000', ['--hold-min', '4000'])], [[null, true], [4000, true], [2000, true], [4000, true]], 'a flag over the variable');
    assert.deepEqual(under('3000', ['--hold-timers']), [3000, true], '--hold-timers alone keeps the variable\'s threshold');
  } finally { if (was === undefined) delete process.env.GATE_HOLD_TIMERS; else process.env.GATE_HOLD_TIMERS = was; }
  for (const bad of [['--no-hold-timers', '--hold-timers'], ['--hold-min', '3000', '--no-hold-timers']]) {
    const r = spawnSync(process.execPath, [join(HERE, '../gate-all.mjs'), ...bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, bad.join(' ')); assert.match(r.stderr, /--no-hold-timers contradicts --hold-timers \/ --hold-min/);
  }
});
check('timer hold default (runner): a default run holds on both sides; --no-hold-timers and GATE_HOLD_TIMERS=0 do not, and a project run that way keeps its unheld references; an old unheld reference is frozen again once, under the settings it recorded plus the hold, with one line saying why', () => {
  const holdArgs = (box) => box.spawned().filter((a) => a[0] === 'stitch-shot' || (a[0] === 'reference' && a[1] === 'freeze')).map((a) => [a[0], a.includes('--hold-min') ? a[a.indexOf('--hold-min') + 1] : null]);
  const recHold = (box, f) => { const j = JSON.parse(readFileSync(join(box.out, f), 'utf8')); return (j.timers && j.timers.hold) ?? null; };
  const frozen = (box) => box.shots().filter((x) => x.startsWith('freeze'));
  const dflt = sandbox(['good']); const flag = sandbox(['good']); const env = sandbox(['good']);
  try {
    let r = dflt.gateAll([], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(holdArgs(dflt).sort(), [['reference', '2000'], ['stitch-shot', '2000']], 'the freeze and the build capture both get --hold-min 2000');
    assert.deepEqual([recHold(dflt, 'good/baseline.json'), recHold(dflt, 'good/origin.capture.json'), recHold(dflt, 'good/eds.capture.json')], [2000, 2000, 2000], 'both sides\' records say 2000');
    r = dflt.gateAll([], { ...REF });
    assert.deepEqual(frozen(dflt), [], 'the next default run reuses the held reference'); assert.doesNotMatch(r.stdout, /re-frozen/);
    for (const [box, args, extra] of [[flag, ['--no-hold-timers'], {}], [env, [], { GATE_HOLD_TIMERS: '0' }]]) {
      r = box.gateAll(args, { ...REF, ...extra });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(holdArgs(box).sort(), [['reference', null], ['stitch-shot', null]], 'no hold flag on either side');
      assert.deepEqual([recHold(box, 'good/baseline.json'), recHold(box, 'good/origin.capture.json'), recHold(box, 'good/eds.capture.json')], [null, null, null]);
      r = box.gateAll(args, { ...REF, ...extra });
      assert.deepEqual(frozen(box), [], 'an unheld project keeps its unheld reference'); assert.doesNotMatch(r.stdout, /re-frozen/);
    }
    // the existing project: env's reference was frozen without the hold, with a consent selector; now a default run
    r = env.gateAll(['--consent', '#ok'], { ...REF, GATE_HOLD_TIMERS: '0' });
    assert.match(r.stdout, /origin good: reference: re-frozen — capture settings changed \(consent\)$/m);
    r = env.gateAll([], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(frozen(env), ['freeze https://origin.example/good']);
    assert.equal(r.stdout.split('\n').filter((l) => l.endsWith(`origin good: reference: re-frozen — capture settings changed (holdTimers)${HOLD_DEFAULT_WHY}`)).length, 1, r.stdout);
    assert.equal((r.stdout.match(/re-frozen/g) || []).length, 1, 'one line');
    assert.match(HOLD_DEFAULT_WHY, /^: the gates hold timers by default and this reference was frozen without the hold — frozen again once \(--no-hold-timers or GATE_HOLD_TIMERS=0 keeps a round unheld\)$/);
    const freeze = env.spawned().find((a) => a[0] === 'reference'); const eds = env.spawned().find((a) => a[0] === 'stitch-shot');
    for (const a of [freeze, eds]) assert.deepEqual([a[a.indexOf('--consent') + 1], a[a.indexOf('--hold-min') + 1]], ['#ok', '2000'], 'the recorded consent selector goes into the freeze and the build capture, with the hold');
    assert.deepEqual([recHold(env, 'good/baseline.json'), recHold(env, 'good/eds.capture.json'), JSON.parse(readFileSync(join(env.out, 'good/baseline.json'), 'utf8')).flags.consent], [2000, 2000, '#ok']);
    for (const again of [1, 2]) { r = env.gateAll([], { ...REF }); assert.deepEqual(frozen(env), [], `once: run ${again} after it freezes nothing`); assert.doesNotMatch(r.stdout, /re-frozen/); }
    // turned off against the held reference: frozen again without it
    r = env.gateAll(['--no-hold-timers'], { ...REF });
    assert.match(r.stdout, /origin good: reference: re-frozen — capture settings changed \(holdTimers\)$/m); assert.equal(recHold(env, 'good/baseline.json'), null);
  } finally { dflt.done(); flag.done(); env.done(); }
});
check('unselected: an --only slug that selection neither kept nor skipped gets its own NOT gated line', () => {
  assert.deepEqual(unselected(['a', 'b', 'c'], [{ slug: 'a' }], [{ slug: 'b', why: 'x' }]), ['c']);
  assert.deepEqual(unselected(null, [], []), []);
});
// ---- the pixel criterion (aligned % + offsets) and the frozen reference ---------------------------------------------------
const st = (...shifts) => { let c = 0; return shifts.map((shift, i) => { c += shift; return { y: 103 + 1000 * i, shift, cumulative: c }; }); };
const pxa = (pct, alignedPct, steps, height = 5000) => ({ ...px(pct, 0, height), aligned: { used: true, pct: alignedPct, steps, totalShift: steps.reduce((n, x) => n + Math.abs(x.shift), 0) } });
check('verdict: the row carries alignedPct / alignedUsed / totalShift / steps / offsetBound; pixelPass follows the rule — aligned % within the threshold AND offsets within the bound', () => {
  const v = verdict({ pixel: pxa(16.62, 1.23, st(-5)) }, { stage: 'prototype' });
  assert.deepEqual([v.pixelPass, v.pixelOnlyPass, v.pass, v.alignedPct, v.alignedUsed, v.totalShift, v.offsetBound, v.reasons], [true, true, true, 1.23, true, 5, 8, []]);
  assert.deepEqual(v.steps, st(-5));
});
check('verdict: aligned % within the threshold but offsets over the bound fails with the offsets reason — at the prototype stage 37 px > 8; at the published stage the bound is the larger of 8 and 1 % of the origin height', () => {
  const p = pxa(16.62, 1.23, st(-5, -20, -12));
  const proto = verdict({ pixel: p }, { stage: 'prototype' });
  assert.deepEqual([proto.pixelPass, proto.pass, proto.offsetBound], [false, false, 8]);
  assert.deepEqual(proto.reasons, ['offsets: 3 step(s), 37px total — −5px at y=103, −20px at y=1103, −12px at y=2103 (bound 8px)']);
  const pub = verdict({ pixel: p }, { stage: 'published' });
  assert.deepEqual([pub.pixelPass, pub.pass, pub.offsetBound, pub.reasons], [true, true, 50, []]);
  assert.equal(verdict({ pixel: pxa(16.62, 1.23, st(-5, -20, -12), 600) }, { stage: 'published' }).pixelPass, false, '1 % of 600 px is under the 8 px floor');
  assert.equal(verdict({ pixel: p }).pixelPass, true, 'the default stage is published');
  assert.equal(verdict({ pixel: p }, { stage: 'prototype', offsetMax: 40 }).pixelPass, true, '--offset-max overrides the stage default');
  assert.equal(verdict({ pixel: p }, { stage: 'published', offsetMax: 36 }).pixelPass, false);
});
check('verdict: alignment not used, or a pixel.json from before --align → the unaligned rule and its reason, as before; a page that passed unaligned still passes unless its offsets exceed the bound', () => {
  for (const pixel of [px(12, 0), { ...px(12, 0), aligned: { used: false, pct: 12, steps: [], totalShift: 0 } }]) {
    const v = verdict({ pixel }, { stage: 'prototype' });
    assert.deepEqual([v.pixelPass, v.alignedUsed, v.alignedPct, v.totalShift, v.offsetBound, v.reasons], [false, false, 12, 0, null, ['pixel 12% > 10%']]);
  }
  assert.equal(verdict({ pixel: px(9.9, 0) }, { stage: 'prototype' }).pixelPass, true);
  assert.equal(verdict({ pixel: pxa(9.9, 4, st(3, -5)) }, { stage: 'prototype' }).pixelPass, true, '8 px of offsets: within the bound');
  assert.equal(verdict({ pixel: pxa(9.9, 4, st(3, -6)) }, { stage: 'prototype' }).pixelPass, false, '9 px: the one new way to fail');
  assert.deepEqual(verdict({ pixel: pxa(30.1, 12, st(4)) }, { stage: 'prototype' }).reasons, ['pixel aligned 12% (unaligned 30.1%) > 10%']);
});
// ---- the roster tolerance on the offsets (published stage; gate.sh and the prototype stage keep the strict bound) ----
check('roster tolerance: a published row over the strict bound and within height-tol × origin height passes — both numbers, the judge, the note with the total shift', () => {
  const v = verdict({ pixel: pxa(16.62, 4.7, st(-54, 40, -23)) }); // 5000 px page: strict bound 50, tolerance 250; 117 px
  assert.deepEqual([v.pixelPass, v.pixelOnlyPass, v.pass, v.failing, v.reasons], [true, true, true, [], []]);
  assert.deepEqual([v.totalShift, v.offsetBound, v.offsetTolerance, v.offsetJudge, v.offsetsWithinTolerance], [117, 50, 250, 'tolerance', true]);
  assert.deepEqual(v.notes, ['offsets within the roster tolerance: 117px total, largest step 54px (strict bound 50px, tolerance 250px)']);
  const strict = verdict({ pixel: pxa(16.62, 1.23, st(-5, -20, -12)) }); // 37 px ≤ 50: the strict bound judged it, no note
  assert.deepEqual([strict.pass, strict.offsetBound, strict.offsetTolerance, strict.offsetJudge, strict.offsetsWithinTolerance, strict.notes], [true, 50, 250, 'bound', false, []]);
  const edge = verdict({ pixel: pxa(16.62, 4, st(200, -50)) });
  assert.deepEqual([edge.pass, edge.totalShift, edge.offsetsWithinTolerance], [true, 250, true], 'exactly the tolerance, one step of exactly 200 px: within');
  assert.deepEqual([verdict({ pixel: pxa(16.62, 4, st(-60, 60)) }, { heightTol: 0.02 }).pass, verdict({ pixel: pxa(16.62, 4, st(-60, 60)) }, { heightTol: 0.03 }).offsetTolerance], [false, 150], 'the tolerance is --height-tol: one number for the height and the offsets');
  const plain = verdict({ pixel: px(4, 0, 5000) });
  assert.deepEqual([plain.offsetBound, plain.offsetTolerance, plain.offsetJudge, plain.offsetsWithinTolerance], [null, null, null, false], 'alignment not used: no offsets to judge');
});
check('roster tolerance: over the tolerance fails on the offsets as before, and so does one step over 200 px within it — the reason names which', () => {
  const over = verdict({ pixel: pxa(16.62, 4.7, st(-120, -90, 41)) }); // 251 px > 250
  assert.deepEqual([over.pixelPass, over.pass, over.failing, over.offsetBound, over.offsetTolerance, over.offsetJudge, over.offsetsWithinTolerance, over.notes], [false, false, ['pixel'], 50, 250, 'tolerance', false, []]);
  assert.deepEqual(over.reasons, ['offsets: 3 step(s), 251px total — −120px at y=103, −90px at y=1103, +41px at y=2103 (bound 50px) — over the roster tolerance 250px']);
  const step = verdict({ pixel: pxa(16.62, 2.1, st(-236, 1), 10000) }); // 237 px ≤ 500, but one step is a section's worth
  assert.deepEqual([step.pixelPass, step.pass, step.offsetJudge, step.offsetsWithinTolerance], [false, false, 'tolerance', false]);
  assert.deepEqual(step.reasons, [`offsets: 2 step(s), 237px total — −236px at y=103, +1px at y=1103 (bound 100px) — one step of 236px, over ${ROSTER_OFFSETS.step}px (roster tolerance 500px)`]);
  const late = { ...pxa(16.62, 3, st(...Array(13).fill(5), -201), 10000) };
  assert.equal(verdict({ pixel: late }).pixelPass, false, 'the large step is found past the 12 steps the row keeps');
  assert.equal(verdict({ pixel: late }).steps.length, 12);
  assert.deepEqual(verdict({ pixel: pxa(30.1, 12, st(-54, 40)) }).reasons, ['pixel aligned 12% (unaligned 30.1%) > 10%'], 'aligned % over the threshold: the percentage is the reason, the tolerance is not consulted');
  assert.equal(verdict({ pixel: pxa(30.1, 12, st(-54, 40)) }).offsetsWithinTolerance, false);
});
check('roster tolerance: a row failing another criterion still fails; no override is involved', () => {
  const p = pxa(16.62, 4.7, st(-54, 40, -23));
  const clipped = verdict({ pixel: p, clip: clip(3) });
  assert.deepEqual([clipped.pixelPass, clipped.pass, clipped.failing, clipped.passWithOverride, clipped.offsetsWithinTolerance], [true, false, ['clip'], false, true]);
  assert.equal(clipped.notes.length, 1, 'the note stays on the failing row');
  const tall = verdict({ pixel: { ...p, heightDelta: -300 } }); // 5000 px origin, 6 % taller build
  assert.deepEqual([tall.pixelPass, tall.heightPass, tall.pass, tall.failing], [true, false, false, ['height']]);
  const fonts = verdict({ pixel: p, capture: { fonts: [{ family: 'Brand Sans', side: 'eds' }], fontsSkipped: [] } });
  assert.deepEqual([fonts.pass, fonts.failing], [false, ['fonts']]);
  const within = verdict({ pixel: p });
  assert.deepEqual([within.pass, within.passWithOverride, within.unwaived], [true, true, []], 'a pass, not an override pass');
  const waived = verdict({ pixel: pxa(16.62, 4.7, st(-120, -90, 41)), override: { verdict: 'ACCEPTED', reason: 'r' } });
  assert.deepEqual([waived.pass, waived.pixelPass], [false, false], 'over the tolerance an override changes nothing about the row\'s own verdict');
});
check('roster tolerance: the prototype stage and an explicit --offset-max keep the one strict bound', () => {
  const p = pxa(16.62, 4.7, st(-54, 40, -23));
  const proto = verdict({ pixel: p }, { stage: 'prototype' });
  assert.deepEqual([proto.pixelPass, proto.offsetBound, proto.offsetTolerance, proto.offsetJudge, proto.offsetsWithinTolerance], [false, 8, null, 'bound', false]);
  assert.deepEqual(proto.reasons, ['offsets: 3 step(s), 117px total — −54px at y=103, +40px at y=1103, −23px at y=2103 (bound 8px)']);
  const given = verdict({ pixel: p }, { stage: 'published', offsetMax: 100 });
  assert.deepEqual([given.pixelPass, given.offsetBound, given.offsetTolerance, given.offsetJudge], [false, 100, null, 'bound']);
  assert.equal(verdict({ pixel: p }, { stage: 'published', offsetMax: 117 }).pixelPass, true);
  assert.deepEqual(rosterOffsets(null), { tolerance: null, judge: null, pass: true, within: false, largest: 0, over: null });
});
check('roster tolerance: formatSummary shows both numbers on the row, the note as (reported), and the calibration line counts the rows', () => {
  const base = { template: 't', tier: 'thin', origin: 'stitch-live', heightDelta: 0, clipped: 0, clipAllowance: 0, content: null, units: null, masked: false, override: null, error: null };
  const v = verdict({ pixel: pxa(16.62, 4.7, st(-54, 40, -23)) });
  const rows = [{ ...base, slug: 'a', path: '/a', pct: 16.62, ...v }, { ...base, slug: 'b', path: '/b', pct: 16.62, ...verdict({ pixel: pxa(16.62, 1.23, st(-5)) }) }];
  const totals = { pages: 2, pass: 2, pixelOnlyPass: 2, overridePass: 0, fail: 0, error: 0, failPixel: 0, failOffsets: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, alignedOnlyPass: 2, offsetsWithinTolerance: 1 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals, rows });
  assert.match(md, /\| `\/a` \|.*\| 4\.7 \(16\.62\) \| 3 step\(s\), 117px \(bound 50, tolerance 250\) \|.*\| PASS \| \(reported\) offsets within the roster tolerance: 117px total, largest step 54px \(strict bound 50px, tolerance 250px\) \|/);
  assert.match(md, /\| `\/b` \|.*\| 1 step\(s\), 5px \(bound 50\) \|.*\| PASS \| - \|/);
  assert.match(md, /; offsets over the strict bound, within the roster tolerance: 1[;.]/);
  assert.doesNotMatch(formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, offsetsWithinTolerance: 0 }, rows: rows.slice(1) }), /roster tolerance/);
});
check('roster tolerance, the runner: the row passes (exit 0), totals.offsetsWithinTolerance counts it, summary.md carries the note, the recorded pass is reused; over the tolerance, --stage prototype or --offset-max: exit 2 as before', () => {
  const within = { page: { pct: 16.62, aligned: { used: true, pct: 4.7, steps: st(-54, 40, -23) } } };
  const env = sandbox(['page']); const proto = sandbox(['page']);
  try {
    let r = env.gateAll([], { STUB_PX: JSON.stringify(within) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const row = env.rows().page;
    assert.deepEqual([row.pass, row.passWithOverride, row.override, row.totalShift, row.offsetBound, row.offsetTolerance, row.offsetJudge, row.offsetsWithinTolerance], [true, true, null, 117, 50, 250, 'tolerance', true]);
    assert.ok(row.notes.includes('offsets within the roster tolerance: 117px total, largest step 54px (strict bound 50px, tolerance 250px)'));
    assert.deepEqual([env.totals().pass, env.totals().overridePass, env.totals().failOffsets, env.totals().offsetsWithinTolerance], [1, 0, 0, 1]);
    assert.match(readFileSync(join(env.out, 'summary.md'), 'utf8'), /\(bound 50, tolerance 250\) \|.*\| PASS \| .*\(reported\) offsets within the roster tolerance: 117px total/);
    assert.match(r.stdout, /offsets over the strict bound, within the roster tolerance: 1/);
    assert.match(JSON.parse(readFileSync(join(env.out, 'summary.json'), 'utf8'))._provenance.offsetMax, /roster tolerance: 5% of the origin height with no step over 200px/);
    assert.deepEqual(env.compares().page.slice(env.compares().page.indexOf('--offset-max'), env.compares().page.indexOf('--offset-max') + 2), ['--offset-max', 'published'], 'pixel-compare is asked for the strict rule, as before');
    r = env.gateAll(['--skip-existing'], { STUB_PX: JSON.stringify(within) });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.deepEqual(env.shots(), [], 'the pass under the tolerance is a recorded pass');
    assert.equal(env.rows().page.offsetsWithinTolerance, true);

    r = env.gateAll(['--recapture-eds'], { STUB_PX: JSON.stringify({ page: { pct: 16.62, aligned: { used: true, pct: 4.7, steps: st(-120, -90, 41) } } }) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.deepEqual([env.rows().page.pass, env.rows().page.failing, env.totals().failOffsets, env.totals().offsetsWithinTolerance], [false, ['pixel'], 1, 0]);
    assert.match(env.rows().page.reasons[0], /^offsets: 3 step\(s\), 251px total — .* \(bound 50px\) — over the roster tolerance 250px$/);
    r = env.gateAll(['--recapture-eds', '--offset-max', '100'], { STUB_PX: JSON.stringify(within) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.deepEqual([env.rows().page.pass, env.rows().page.offsetBound, env.rows().page.offsetTolerance, env.totals().offsetsWithinTolerance], [false, 100, null, 0]);

    writeFileSync(join(proto.root, 'stardust/state.json'), JSON.stringify({ pages: [{ slug: 'page', url: 'https://origin.example/page', prototypePath: 'stardust/prototypes/page.html' }] }));
    mkdirSync(join(proto.root, 'stardust/prototypes'), { recursive: true }); writeFileSync(join(proto.root, 'stardust/prototypes/page.html'), '<html></html>');
    r = proto.gateAll(['--stage', 'prototype', '--proto-base', 'http://localhost:1'], { STUB_PX: JSON.stringify(within) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const prow = proto.tableOf('prototypes-1440').rows[0];
    assert.deepEqual([prow.pass, prow.offsetBound, prow.offsetTolerance, prow.offsetJudge, prow.offsetsWithinTolerance], [false, 8, null, 'bound', false]);
  } finally { env.done(); proto.done(); }
});
check('verdict / isErrorRow: an unstable reference is the row\'s reason as it stands — an error row, never a FAIL; no aligned numbers', () => {
  const v = verdict({ pixel: { error: 'reference-unstable: heights 5000 vs 5640 after priming; not frozen (d/reference-unstable.json)' } });
  assert.deepEqual(v.reasons, ['reference-unstable: heights 5000 vs 5640 after priming; not frozen (d/reference-unstable.json)']);
  assert.deepEqual([v.pass, v.pixelPass, v.alignedPct, v.totalShift], [false, false, null, null]);
  assert.equal(isErrorRow({ pct: null, ...v }), true); assert.ok(UNSTABLE.test(v.reasons[0]));
  assert.deepEqual(verdict({ pixel: { error: 'stitch exit 1' } }).reasons, ['pixel error: stitch exit 1'], 'any other pixel error reads as before');
});
check('formatSummary: the pixel cell is aligned % (unaligned %), an offsets column, and the calibration line counts the rows passing only thanks to alignment, the offsets-only fails and the unstable references', () => {
  const base = { template: 't', tier: 'thin', origin: 'stitch-live', heightDelta: 0, clipped: 0, clipAllowance: 0, content: null, units: null, masked: false, override: null, error: null, reasons: [] };
  const rows = [
    { ...base, slug: 'a', path: '/a', pct: 16.62, alignedPct: 1.23, alignedUsed: true, totalShift: 5, steps: st(-5), offsetBound: 50, pass: true, pixelOnlyPass: true },
    { ...base, slug: 'b', path: '/b', pct: 16.62, alignedPct: 1.23, alignedUsed: true, totalShift: 137, steps: st(-5, -120, -12), offsetBound: 50, pass: false, pixelOnlyPass: false, reasons: ['offsets: 3 step(s), 137px total — −5px at y=103, −120px at y=1103, −12px at y=2103 (bound 50px)'] },
    { ...base, slug: 'c', path: '/c', pct: 2, alignedPct: 2, alignedUsed: false, totalShift: 0, steps: [], offsetBound: null, pass: true, pixelOnlyPass: true },
    { ...base, slug: 'd', path: '/d', pct: null, alignedPct: null, alignedUsed: false, steps: [], pass: false, pixelOnlyPass: false, error: 'reference-unstable: heights 5000 vs 5640', reasons: ['reference-unstable: heights 5000 vs 5640'] },
  ];
  const totals = { pages: 4, pass: 2, pixelOnlyPass: 2, overridePass: 0, fail: 1, error: 1, failPixel: 1, failOffsets: 1, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, alignedOnlyPass: 1, referenceUnstable: 1 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals, rows });
  assert.match(md, /\| pixel % aligned \(unaligned\) \[text\] \| offsets \|/);
  assert.match(md, /\| `\/a` \|.*\| 1\.23 \(16\.62\) \| 1 step\(s\), 5px \(bound 50\) \| 0 \|.*\| PASS \|/);
  assert.match(md, /\| `\/b` \|.*\| 1\.23 \(16\.62\) \| 3 step\(s\), 137px \(bound 50\) \|.*\| FAIL \| offsets: 3 step\(s\), 137px total/);
  assert.match(md, /\| `\/c` \|.*\| 2 \| - \| 0 \|/);
  assert.match(md, /\| `\/d` \|.*\| n\/a \| - \|.*\| ERROR reference-unstable: heights 5000 vs 5640 \|/);
  assert.match(md, /Failing by criterion: pixel 1 \(1 on offsets alone\), height 0/);
  assert.match(md, /pixel criterion met only thanks to alignment \(unaligned % over the threshold\): 1; \*\*1 unstable reference\(s\)\*\* \(error rows/);
  const wide = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 2560, verdict: 'V', wide: true }, totals: { ...totals, overThreshold: 1 }, rows });
  assert.match(wide, /^# Wide report — all deployed pages \(a report, not a delivery criterion\), 2560px/); assert.match(wide, /over the threshold at this width: \*\*1 of 4\*\*/);
});
check('parseArgs: --offset-max, --live-origin (and GATE_REFERENCE=live), --wide → gates/wide-<w> at DESIGN.json\'s probeWidth else 2560, no content probe; an explicit --width wins', () => {
  const d = parseArgs(['node', 'x']);
  assert.deepEqual([d.offsetMax, d.liveOrigin, d.wide], [null, process.env.GATE_REFERENCE === 'live', false]);
  const o = parseArgs(['node', 'x', '--offset-max', '20', '--live-origin']);
  assert.deepEqual([o.offsetMax, o.liveOrigin], [20, true]);
  const tmp = mkdtempSync(join(tmpdir(), 'gate-all-design-'));
  try {
    assert.equal(wideWidth(join(tmp, 'DESIGN.json')), WIDE_DEFAULT); assert.equal(WIDE_DEFAULT, 2560);
    writeFileSync(join(tmp, 'DESIGN.json'), JSON.stringify({ extensions: { breakpoints: { probeWidth: 1920 } } }));
    assert.equal(wideWidth(join(tmp, 'DESIGN.json')), 1920);
    const w = parseArgs(['node', 'x', '--wide', '--design', join(tmp, 'DESIGN.json')]);
    assert.deepEqual([w.wide, w.width, w.out, w.content, w.clip, w.stage], [true, 1920, 'stardust/replica/gates/wide-1920', false, true, 'published']);
    writeFileSync(join(tmp, 'DESIGN.json'), JSON.stringify({ extensions: { breakpoints: { probeWidth: null } } }));
    assert.equal(parseArgs(['node', 'x', '--wide', '--design', join(tmp, 'DESIGN.json')]).out, 'stardust/replica/gates/wide-2560');
    assert.equal(parseArgs(['node', 'x', '--wide', '--width', '3000', '--design', join(tmp, 'DESIGN.json')]).out, 'stardust/replica/gates/wide-3000');
    assert.equal(parseArgs(['node', 'x', '--wide', '--stage', 'prototype', '--design', join(tmp, 'nope.json')]).out, 'stardust/replica/gates/wide-2560');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
check('referenceOf: what the origin meta keeps of a frozen reference — noise floor, self-varying rows, mask; a baseline frozen by stitch-shot has no measured floor', () => {
  assert.deepEqual(referenceOf({ capturedAt: 'T', primed: true, stable: true, noiseFloor: 2.31, variable: [{ y: 392, h: 56 }, { y: 4000, h: 652 }], maskArg: '392:56,4000:652' }, 'd'),
    { dir: 'd', capturedAt: 'T', primed: true, stable: true, noiseFloor: 2.31, variableRows: 708, maskArg: '392:56,4000:652' });
  assert.deepEqual(referenceOf({ capturedAt: 'T' }, 'd'), { dir: 'd', capturedAt: 'T', primed: false, stable: true, noiseFloor: null, variableRows: 0, maskArg: '' });
  assert.equal(referenceOf({ stable: false }, 'd').stable, false);
});
check('dropPassedCaptures keeps baseline.png — the page\'s frozen reference outlives the pass, every other PNG goes', () => {
  const d = pageDir({ ...RECORDS, 'origin.png': 'x', 'eds.png': 'x', 'diff.png': 'x', 'diff-aligned.png': 'x', 'baseline.png': 'ref', 'baseline.json': {} });
  try {
    assert.equal(dropPassedCaptures(d, { masks: [], edsUrl: 'https://eds.example/a' }), 4);
    assert.deepEqual(readdirSync(d).filter((f) => f.endsWith('.png')), ['baseline.png']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The runner on the default origin (REF: no GATE_REFERENCE): the frozen reference per page.
const BASELINE = (url, extra = {}) => ({ writtenBy: 'skills/replica/scripts/reference.mjs freeze', schema: 1, capturedAt: '2026-10-30T08:00:00.000Z', url, width: 1440, vh: 900, height: 5000, settle: true, chunks: 6, fontsFailed: [], fixedLayers: { capture: 'once', count: 0 }, primed: true, noiseFloor: 3.5, variable: [{ y: 100, h: 40, pct: 9 }], maskArg: '100:40', stable: true, reason: null, timers: { hold: 2000, held: 2, intervals: 2, chains: 0, delays: [5000, 86400000] }, ...extra }); // frozen under the default hold; { timers: undefined } = an unheld one
check('reference: the archetype gate dir\'s frozen baseline is the origin (no freeze, no origin stitch); otherwise one is frozen into the page dir, once, and reused by the next run', () => {
  const { root, out, gateAll, shots, rows, compares, files, done } = sandbox(['arch', 'page', 'bad']);
  try {
    const gdir = join(root, 'stardust/replica/gates/arch-1440'); mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'baseline.png'), 'archetype-reference'); writeFileSync(join(gdir, 'baseline.json'), JSON.stringify(BASELINE('https://origin.example/arch')));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'masks.json'), JSON.stringify({ arch: { masks: ['0:20'], reason: 'a rotating banner' } }));
    let r = gateAll([], { ...REF, STUB_REF_MASK: '392:56,4000:652', STUB_PX: JSON.stringify({ page: { pct: 16.62, aligned: { used: true, pct: 1.23, steps: st(-5, 12) } } }) });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(shots(), ['freeze https://origin.example/bad', 'freeze https://origin.example/page', 'https://eds.example/arch', 'https://eds.example/bad', 'https://eds.example/page'], 'no origin stitch at all; the archetype page spends no freeze');
    const row = rows();
    assert.deepEqual([row.arch.pass, row.arch.reference, row.arch.noiseFloor, row.arch.variableRows, row.arch.origin], [true, 'stardust/replica/gates/arch-1440', 3.5, 40, 'stitch-live']);
    assert.deepEqual([row.page.reference, row.page.noiseFloor, row.page.variableRows], ['stardust/replica/gates/all-1440/page', 2.31, 708]);
    assert.deepEqual(compares().arch.slice(compares().arch.indexOf('--mask')), ['--mask', '0:20,100:40'], 'masks.json rows, then the reference\'s self-varying rows');
    assert.deepEqual(compares().page.slice(compares().page.indexOf('--offset-max'), compares().page.indexOf('--offset-max') + 2), ['--offset-max', 'published']);
    assert.deepEqual(compares().page.slice(compares().page.indexOf('--mask')), ['--mask', '392:56,4000:652']);
    assert.deepEqual([row.arch.masked, row.arch.maskedRows], [true, 60]); assert.match(row.arch.maskReason, /^a rotating banner; self-varying rows of the frozen reference \(noise floor 3\.5%\)$/);
    assert.match(row.page.maskReason, /^self-varying rows of the frozen reference \(noise floor 2\.31%\)$/);
    // the aligned row: pct stays the unaligned number, the aligned fields beside it, pixelPass by the rule (17 px ≤ 1 % of 5000)
    assert.deepEqual([row.page.pct, row.page.alignedPct, row.page.alignedUsed, row.page.totalShift, row.page.steps.length, row.page.offsetBound, row.page.pixelPass, row.page.pass], [16.62, 1.23, true, 17, 2, 50, true, true]);
    assert.deepEqual([row.bad.pct, row.bad.alignedPct, row.bad.alignedUsed, row.bad.pixelPass, row.bad.reasons], [30, 30, false, false, ['pixel 30% > 10%']]);
    const t = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    assert.deepEqual([t.totals.alignedOnlyPass, t.totals.failOffsets, t.totals.referenceUnstable, t._provenance.originReference], [1, 0, 0, 'frozen']);
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /\| 1\.23 \(16\.62\) \| 2 step\(s\), 17px \(bound 50\) \|/);
    assert.equal(JSON.parse(readFileSync(join(out, 'page/origin.json'), 'utf8')).reference.maskArg, '392:56,4000:652');
    assert.deepEqual(files('stardust/replica/gates/all-1440/page').filter((f) => /^(baseline|ref-)/.test(f)), ['baseline.json', 'baseline.png'], 'the passed page keeps its frozen reference; reference.mjs\'s kept captures are gone (disk)');
    assert.deepEqual(files('stardust/replica/gates/all-1440/bad').filter((f) => f.endsWith('.png')), ['baseline.png', 'diff.png', 'eds.png', 'origin.png']);
    assert.equal(readFileSync(join(out, 'bad/origin.png'), 'utf8'), 'frozen', 'origin.png is the reference\'s copy');

    r = gateAll([], { ...REF, STUB_REF_MASK: '392:56,4000:652' });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(shots(), ['https://eds.example/arch', 'https://eds.example/bad', 'https://eds.example/page'], 'the next run freezes nothing: every page has its reference');
    assert.deepEqual([rows().page.reference, rows().page.noiseFloor, rows().page.variableRows], ['stardust/replica/gates/all-1440/page', 2.31, 708]);

    r = gateAll(['--offset-max', '16'], { ...REF, STUB_PX: JSON.stringify({ page: { pct: 16.62, aligned: { used: true, pct: 1.23, steps: st(-5, 12) } } }) });
    assert.deepEqual([rows().page.pixelPass, rows().page.offsetBound, rows().page.reasons], [false, 16, ['offsets: 2 step(s), 17px total — −5px at y=103, +12px at y=1103 (bound 16px)']], '--offset-max is the bound');
    assert.equal(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).totals.failOffsets, 1);
    assert.deepEqual(compares().page.slice(compares().page.indexOf('--offset-max'), compares().page.indexOf('--offset-max') + 2), ['--offset-max', '16']);
  } finally { done(); }
});
check('hint: a reference whose captures differed with the hold turned off carries reference.mjs\'s hint — logged once per page, kept on the row and in its reasons cell; none on a default run (held), under --hold-timers or GATE_HOLD_TIMERS=1, none for a stable page; rows, totals and exit code are those of the run without it', () => {
  const HINT = 'the page changes on its own between captures (2 self-varying region(s) masked) — when a timer drives the change (a carousel that advances by itself), freezing again with --hold-timers (the gates hold by default: drop --no-hold-timers / GATE_HOLD_TIMERS=0) captures it in one state';
  assert.equal(referenceOf({ capturedAt: 'T', hint: HINT }, 'd').hint, HINT); assert.equal('hint' in referenceOf({ capturedAt: 'T' }, 'd'), false);
  assert.deepEqual([hintOf({ hint: ` ${HINT} ` }), hintOf({ hint: '' }), hintOf({ hint: 7 }), hintOf(null)], [HINT, null, null, null]);
  const hintLogs = (r, slug) => (r.stdout.match(new RegExp(`origin ${slug}: hint: .*$`, 'gm')) || []);
  const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, hint: null }]));
  const plain = sandbox(['good', 'wobbly']); const self = sandbox(['good', 'wobbly']); const held = sandbox(['good', 'wobbly']); const env = sandbox(['good', 'wobbly']); const dflt = sandbox(['good', 'wobbly']);
  try {
    const UN = { ...REF, STUB_REF_MASK: '392:56,4000:652', STUB_REF_UNSTABLE: 'https://origin.example/wobbly' }; const OFF = { GATE_HOLD_TIMERS: '0' };
    const r0 = plain.gateAll([], { ...UN, ...OFF });
    let r = self.gateAll([], { ...UN, ...OFF, STUB_REF_HINT: HINT });
    assert.equal(r.status, r0.status, r.stderr); assert.equal(r.status, 2);
    for (const slug of ['good', 'wobbly']) { assert.deepEqual(hintLogs(r, slug).length, 1, `${slug}: ${r.stdout}`); assert.ok(hintLogs(r, slug)[0].endsWith(`origin ${slug}: hint: ${HINT}`)); assert.equal(self.rows()[slug].hint, HINT); assert.equal(hintLogs(r0, slug).length, 0); assert.equal(plain.rows()[slug].hint, null); }
    assert.deepEqual(strip(self.rows()), strip(plain.rows()), 'the hint changes no verdict, reason or number'); assert.deepEqual(self.totals(), plain.totals());
    assert.equal(self.rows().good.pass, true); assert.deepEqual(self.rows().wobbly.reasons, plain.rows().wobbly.reasons);
    const md = readFileSync(join(self.out, 'summary.md'), 'utf8');
    assert.equal(md.split(`(hint) ${HINT}`).length - 1, 2, 'once per row'); assert.doesNotMatch(readFileSync(join(plain.out, 'summary.md'), 'utf8'), /hint/);
    // the next run reuses the frozen reference: the row keeps the hint
    r = self.gateAll(['--no-hold-timers'], { ...REF, STUB_REF_HINT: HINT, STUB_REF_UNSTABLE: 'https://origin.example/wobbly' });
    assert.equal(self.rows().good.hint, HINT);
    for (const [box, args, extra] of [[dflt, [], {}], [held, ['--hold-timers'], {}], [env, [], { GATE_HOLD_TIMERS: '1' }]]) {
      r = box.gateAll(args, { ...UN, STUB_REF_HINT: HINT, ...extra });
      assert.equal(r.status, 2, r.stderr); assert.doesNotMatch(r.stdout + r.stderr, /hint/); assert.deepEqual([box.rows().good.hint, box.rows().wobbly.hint], [null, null]);
    }
    // a default run over the reference frozen with the hold off: frozen again under the hold, the hint gone with it
    r = self.gateAll([], { ...REF, STUB_REF_HINT: HINT, STUB_REF_MASK: '392:56,4000:652' });
    assert.doesNotMatch(r.stdout + r.stderr, /hint/); assert.equal(self.rows().good.hint, null);
  } finally { plain.done(); self.done(); held.done(); env.done(); dflt.done(); }
  const help = spawnSync(process.execPath, [join(HERE, '../gate-all.mjs'), '--help'], { encoding: 'utf8' }).stdout;
  assert.match(help, /origin <slug>: hint: …/);
});
check('reference: an UNSTABLE reference is an error row — reason reference-unstable: <line>, counted in totals.error, not a FAIL, not a pass, no crawl shot in its place; the next run tries again; --recapture-origin re-freezes without --force', () => {
  const { root, out, gateAll, shots, rows, totals, spawned, files, done } = sandbox(['good', 'wobbly']);
  try {
    mkdirSync(join(root, 'stardust/current/assets/screenshots'), { recursive: true }); writeFileSync(join(root, 'stardust/current/assets/screenshots/wobbly.png'), 'crawl');
    let r = gateAll([], { ...REF, STUB_REF_UNSTABLE: 'https://origin.example/wobbly' });
    assert.equal(r.status, 2, r.stderr);
    const w = rows().wobbly;
    assert.deepEqual([w.pct, w.pass, w.origin, w.originAsymmetric], [null, false, 'none', false]);
    assert.deepEqual(w.reasons, ['reference-unstable: heights 5000 vs 5640 after priming; not frozen (stardust/replica/gates/all-1440/wobbly/reference-unstable.json)']);
    assert.equal(w.error, w.reasons[0]);
    assert.deepEqual([totals().error, totals().fail, totals().pass, totals().referenceUnstable], [1, 0, 1, 1]);
    assert.ok(!existsSync(join(out, 'wobbly/baseline.png')) && !existsSync(join(out, 'wobbly/origin.png')), 'nothing frozen, no origin picture');
    assert.ok(files('stardust/replica/gates/all-1440/wobbly').includes('ref-1.png'), 'the unstable captures stay for inspection');
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /ERROR reference-unstable: heights 5000 vs 5640/);
    assert.equal(existsSync(join(root, 'stardust/replica/gates/wobbly-1440/rounds.json')), false, 'an error row records no round');

    r = gateAll([], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shots(), ['freeze https://origin.example/wobbly', 'https://eds.example/good', 'https://eds.example/wobbly'], 'the unstable page is frozen again (now stable); the good one reuses its reference');
    assert.equal(rows().wobbly.pass, true);

    r = gateAll(['--recapture-origin'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shots().filter((x) => x.startsWith('freeze')), ['freeze https://origin.example/good', 'freeze https://origin.example/wobbly'], '--recapture-origin freezes every page again');
    assert.ok(spawned().filter((a) => a[0] === 'reference').every((a) => !a.includes('--force') && a.includes('--headed') && a[a.indexOf('--locale') + 1] === 'en-US'), 'never --force; the capture flags ride');
    r = gateAll(['--recapture-origin'], { ...REF, STUB_REF_FAIL: 'https://origin.example/good' });
    assert.deepEqual([r.status, rows().good.pass, existsSync(join(out, 'good/baseline.png')), existsSync(join(out, 'good/baseline.png.prev'))], [0, true, true, false], 'a re-freeze that ends without an answer (a challenge) keeps the previous reference and gates against it');
    assert.match(r.stdout + r.stderr, /re-freeze exit 3 .* the previous frozen reference is kept/);
    r = gateAll(['--recapture-origin'], { ...REF, STUB_REF_UNSTABLE: 'https://origin.example/good' });
    assert.equal(r.status, 2);
    assert.deepEqual([rows().good.pct, totals().error, existsSync(join(out, 'good/baseline.png'))], [null, 1, false], 'a re-freeze that finds the page unstable leaves an error row and no reference');
  } finally { done(); }
});
check('reference: --recapture-origin re-freezes where the reference lives (the archetype gate dir), --live-origin stitches the origin as before, --compare-only spawns no freeze and no browser', () => {
  const { root, out, gateAll, shots, rows, spawned, files, done } = sandbox(['arch', 'bad']);
  try {
    const gdir = join(root, 'stardust/replica/gates/arch-1440'); mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'baseline.png'), 'archetype-reference'); writeFileSync(join(gdir, 'baseline.json'), JSON.stringify(BASELINE('https://origin.example/arch')));
    let r = gateAll(['--recapture-origin'], { ...REF });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(readFileSync(join(gdir, 'baseline.png'), 'utf8'), 'frozen', 'frozen again in the archetype gate dir, so gate.sh and the table keep one reference');
    assert.deepEqual([rows().arch.reference, existsSync(join(out, 'arch/baseline.png'))], ['stardust/replica/gates/arch-1440', false]);
    assert.ok(files('stardust/replica/gates/arch-1440').includes('ref-1.png'), 'the archetype dir keeps reference.mjs\'s evidence');

    r = gateAll(['--compare-only'], { ...REF });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([shots(), spawned()], [[], []], 'no capture, no freeze, no probe');
    assert.deepEqual([rows().bad.pct, rows().bad.reference, rows().bad.noiseFloor], [30, 'stardust/replica/gates/all-1440/bad', 2.31], 'the reference of the recorded origin is still on the row');

    r = gateAll(['--live-origin'], { ...REF });
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(shots(), ['https://eds.example/arch', 'https://eds.example/bad', 'https://origin.example/arch', 'https://origin.example/bad'], 'a fresh origin stitch per page, no freeze');
    assert.deepEqual([rows().arch.reference, rows().arch.noiseFloor, rows().arch.variableRows], [null, null, 0]);
    assert.equal(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))._provenance.originReference, 'live');
  } finally { done(); }
});
check('--wide: a report table at the wide width — gates/wide-<w>/summary.{json,md}, the same rows, exit 0 whatever they say, the pages over the threshold counted, no round recorded, the delivery table untouched', () => {
  const { root, gateAll, shots, tableOf, compares, done } = sandbox(['good', 'bad']);
  try {
    let r = gateAll(['--wide'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    const t = tableOf('wide-2560');
    assert.ok(t, 'summary.json in gates/wide-2560'); assert.ok(existsSync(join(root, 'stardust/replica/gates/wide-2560/summary.md')));
    assert.deepEqual([t._provenance.wide, t._provenance.breakpoint, t.totals.pages, t.totals.pass, t.totals.fail, t.totals.overThreshold], [true, 2560, 2, 1, 1, 1]);
    const bad = t.rows.find((x) => x.slug === 'bad');
    assert.deepEqual([bad.pct, bad.alignedPct, bad.pass, bad.reference], [30, 30, false, 'stardust/replica/gates/wide-2560/bad']);
    assert.deepEqual(Object.keys(bad).sort(), Object.keys(tableOf('wide-2560').rows[0]).sort(), 'one row shape');
    assert.match(readFileSync(join(root, 'stardust/replica/gates/wide-2560/summary.md'), 'utf8'), /^# Wide report — all deployed pages \(a report, not a delivery criterion\), 2560px[^]*over the threshold at this width: \*\*1 of 2\*\*/);
    assert.ok(shots().includes('freeze https://origin.example/bad'), 'the wide reference is frozen at the wide width, in the report\'s page dir');
    assert.equal(tableOf('all-1440'), null, 'the delivery table is not written'); assert.equal(tableOf('all-2560'), null);
    assert.equal(existsSync(join(root, 'stardust/replica/gates/bad-2560/rounds.json')), false, 'a report records no round');
    assert.ok(compares().bad.includes('--offset-max'));
    writeFileSync(join(root, 'DESIGN.json'), JSON.stringify({ extensions: { breakpoints: { probeWidth: 1920 } } }));
    r = gateAll(['--wide'], { ...REF });
    assert.equal(r.status, 0, r.stderr); assert.equal(tableOf('wide-1920').totals.overThreshold, 1, 'DESIGN.json\'s probeWidth is the wide width');
  } finally { done(); }
});
check('wideFlagged / wideLine: the pages over the threshold (aligned %) or off in height, worst height first; no flagged page → no line; a long list is cut', () => {
  const row = (slug, alignedPct, heightDelta, heightPass, pct = alignedPct) => ({ slug, pct, alignedPct, heightDelta, heightPass });
  const rows = [row('fine', 1.2, 4, true), row('shifted', 3.1, 12, true, 16.6), row('over', 31.25, 0, true), row('tall', 2, -765, false), row('both', 44, 500, false), { slug: 'error', pct: null, alignedPct: null, heightDelta: null, heightPass: false }];
  const f = wideFlagged(rows, { threshold: 10 });
  assert.deepEqual(f, [{ slug: 'tall', pct: 2, heightDelta: -765, overThreshold: false, heightOff: true }, { slug: 'both', pct: 44, heightDelta: 500, overThreshold: true, heightOff: true }, { slug: 'over', pct: 31.25, heightDelta: 0, overThreshold: true, heightOff: false }], 'an error row (no measurement) and a page passing only thanks to alignment are not flagged');
  assert.equal(wideLine(f, { width: 2560, threshold: 10 }), 'wide 2560px: 3 page(s) over 10% or off in height — tall 2% Δh -765px, both 44% Δh 500px, over 31.25% Δh 0px');
  assert.equal(wideLine([], { width: 2560 }), null);
  assert.match(wideLine(f, { width: 1920, threshold: 5, max: 1 }), /^wide 1920px: 3 page\(s\) over 5% or off in height — tall 2% Δh -765px, … 2 more$/);
});
check('--wide composes with --skip-existing, --only, --eds-host and the overlay flags: the flagged line after the table and in summary.json, exit 0, captures reused by the next run', () => {
  const { root, gateAll, shots, spawned, tableOf, files, done } = sandbox(['good', 'bad', 'tall']);
  try {
    copyFileSync(join(HERE, '..', 'rounds.mjs'), join(root, 'stardust/scripts/replica/rounds.mjs')); // the real ledger: "no round" is measured
    const FLAGS = ['--wide', '--skip-existing', '--eds-host', 'preview.example', '--consent', '#ok', '--dismiss', '.promo-close', '--locale', 'en-GB'];
    const env = { ...REF, STUB_PX: JSON.stringify({ tall: { pct: 2, heightDelta: -765 } }) };
    const LINE = 'wide 2560px: 2 page(s) over 10% or off in height — tall 2% Δh -765px, bad 30% Δh 0px';
    let r = gateAll(FLAGS, env);
    assert.equal(r.status, 0, r.stderr);
    const t = tableOf('wide-2560');
    assert.deepEqual([t.totals.pages, t.totals.pass, t.totals.overThreshold, t.totals.heightOff], [3, 1, 1, 1]);
    assert.deepEqual(t.wide, { line: LINE, pages: [{ slug: 'tall', pct: 2, heightDelta: -765, overThreshold: false, heightOff: true }, { slug: 'bad', pct: 30, heightDelta: 0, overThreshold: true, heightOff: false }] });
    const outLines = r.stdout.trim().split('\n');
    assert.equal(outLines.at(-1), LINE, 'the line is the last one printed, after the table and the totals'); assert.equal(outLines.filter((l) => l === LINE).length, 1);
    assert.deepEqual(JSON.parse(outLines.at(-2)).heightOff, 1);
    const stitches = spawned().filter((a) => a[0] === 'stitch-shot'); const freezes = spawned().filter((a) => a[0] === 'reference');
    assert.deepEqual(stitches.map((a) => a[1]).sort(), ['https://preview.example/bad', 'https://preview.example/good', 'https://preview.example/tall'], '--eds-host is the build side');
    for (const a of [...stitches, ...freezes]) { assert.equal(a[a.indexOf('--width') + 1], '2560'); assert.equal(a[a.indexOf('--consent') + 1], '#ok'); assert.equal(a[a.indexOf('--dismiss') + 1], '.promo-close'); assert.equal(a[a.indexOf('--locale') + 1], 'en-GB'); }
    assert.equal(freezes.length, 3); assert.equal(t._provenance.edsHostOverride, 'https://preview.example');
    assert.equal(tableOf('all-1440'), null); assert.equal(existsSync(join(root, 'stardust/replica/gates/tall-2560/rounds.json')), false, 'a report records no round');
    assert.deepEqual(files('stardust/replica/gates').filter((d) => /-2560$/.test(d)), ['wide-2560'], 'no gate dir is created at the wide width');

    r = gateAll(FLAGS, env);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shots(), [], '--skip-existing: the second wide run captures and freezes nothing');
    assert.deepEqual(tableOf('wide-2560').wide.line, LINE); assert.equal(r.stdout.trim().split('\n').at(-1), LINE);

    r = gateAll([...FLAGS, '--only', 'tall'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').at(-1), 'wide 2560px: 1 page(s) over 10% or off in height — tall 2% Δh -765px');
    assert.equal(tableOf('wide-2560').totals.pages, 3, '--only writes runs/, the report table is untouched');
    const run = files('stardust/replica/gates/wide-2560/runs'); assert.equal(run.length, 1);
    assert.equal(JSON.parse(readFileSync(join(root, 'stardust/replica/gates/wide-2560/runs', run[0]), 'utf8')).wide.pages.length, 1);

    r = gateAll([...FLAGS, '--only', 'good'], env);
    assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /^wide 2560px:/m, 'nothing flagged: no line');
    assert.doesNotThrow(() => JSON.parse(r.stdout.trim().split('\n').at(-1)));
  } finally { done(); }
});
check('a delivery table (no --wide) carries no wide block and prints no wide line', () => {
  const { gateAll, tableOf, done } = sandbox(['bad']);
  try {
    const r = gateAll([], { ...REF });
    assert.equal(r.status, 2); assert.doesNotMatch(r.stdout, /^wide /m);
    const t = tableOf('all-1440'); assert.equal('wide' in t, false); assert.equal('heightOff' in t.totals, false);
  } finally { done(); }
});
check('reference settings: a reference frozen under other overlay flags or locale is frozen again where it lives (one line), reused when nothing changed, never under --skip-existing either; no round is recorded for a freeze', () => {
  const { root, out, gateAll, shots, rows, tableOf, done } = sandbox(['arch', 'page']);
  try {
    const gdir = join(root, 'stardust/replica/gates/arch-1440'); mkdirSync(gdir, { recursive: true });
    copyFileSync(join(HERE, '..', 'rounds.mjs'), join(root, 'stardust/scripts/replica/rounds.mjs')); // the real ledger
    const NONE = { consent: null, dismiss: null, noDismiss: false, locale: null, vh: null, headed: false };
    writeFileSync(join(gdir, 'baseline.png'), 'archetype-reference'); writeFileSync(join(gdir, 'baseline.json'), JSON.stringify(BASELINE('https://origin.example/arch', { flags: NONE })));
    const frozen = () => shots().filter((x) => x.startsWith('freeze'));
    const rounds = () => JSON.parse(readFileSync(join(gdir, 'rounds.json'), 'utf8')).stages['all-pages'].rounds.length;
    let r = gateAll([], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(frozen(), ['freeze https://origin.example/page'], 'gate.sh froze the archetype with no --locale; gate-all\'s default en-US is the same setting');
    assert.doesNotMatch(r.stdout, /re-frozen|settings not recorded/);
    r = gateAll([], { ...REF });
    assert.deepEqual(frozen(), [], 'nothing changed: nothing frozen'); assert.doesNotMatch(r.stdout, /re-frozen/);

    r = gateAll(['--consent', '#ok', '--locale', 'de-DE'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(frozen(), ['freeze https://origin.example/arch', 'freeze https://origin.example/page']);
    assert.match(r.stdout, /origin arch: reference: re-frozen — capture settings changed \(consent, locale\)$/m); assert.match(r.stdout, /origin page: reference: re-frozen — capture settings changed \(consent, locale\)$/m);
    assert.equal((r.stdout.match(/re-frozen/g) || []).length, 2, 'one line per reference');
    assert.equal(readFileSync(join(gdir, 'baseline.png'), 'utf8'), 'frozen', 'the archetype\'s is frozen again in its gate dir');
    assert.deepEqual([JSON.parse(readFileSync(join(gdir, 'baseline.json'), 'utf8')).flags.consent, rows().arch.reference, existsSync(join(out, 'arch/baseline.png'))], ['#ok', 'stardust/replica/gates/arch-1440', false]);

    r = gateAll(['--skip-existing', '--consent', '#ok', '--locale', 'de-DE'], { ...REF });
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(shots(), [], 'same settings + --skip-existing: the recorded passes stand');
    const before = rounds();
    r = gateAll(['--skip-existing'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(frozen(), [], 'a run that omits the reference\'s locale and consent inherits them: the default locale is not a changed setting, nothing is frozen again');
    r = gateAll(['--skip-existing', '--locale', 'en-US'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(frozen(), ['freeze https://origin.example/arch', 'freeze https://origin.example/page'], '--skip-existing does not reuse a pass measured against a reference of other settings');
    assert.match(r.stdout, /origin arch: reference: re-frozen — capture settings changed \(locale\)$/m);
    assert.equal(rounds(), before + 1, 'the measurement is the round; the freeze adds none');
    assert.equal(tableOf('all-1440').totals.pass, 2);

    r = gateAll(['--no-dismiss'], { ...REF, STUB_REF_UNSTABLE: 'https://origin.example/arch' });
    assert.equal(r.status, 2);
    assert.deepEqual([rows().arch.pct, existsSync(join(gdir, 'baseline.png'))], [null, false], 'an unstable re-freeze is an error row and leaves no reference of the old settings');
    assert.match(rows().arch.reasons[0], /^reference-unstable: /); assert.doesNotMatch(r.stdout, /origin arch: reference: re-frozen/); assert.equal(rounds(), before + 1, 'an error row records no round');
  } finally { done(); }
});
check('reference settings not recorded (a baseline from before flags were recorded, an unheld run): reused as before, and said so', () => {
  const { root, gateAll, shots, rows, done } = sandbox(['arch']);
  try {
    const gdir = join(root, 'stardust/replica/gates/arch-1440'); mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'baseline.png'), 'archetype-reference'); writeFileSync(join(gdir, 'baseline.json'), JSON.stringify(BASELINE('https://origin.example/arch', { timers: undefined })));
    const r = gateAll(['--consent', '#ok', '--locale', 'de-DE', '--no-hold-timers'], { ...REF });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shots(), ['https://eds.example/arch'], 'no freeze');
    assert.equal((r.stdout.match(/origin arch: reference: reused — settings not recorded \(/g) || []).length, 1);
    assert.equal(rows().arch.reference, 'stardust/replica/gates/arch-1440');
  } finally { done(); }
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
check('units not declared: a page no family applies to is a named state — unitsDeclared 0, one note, the recorded repeat groups when its schema has them; never a reason', () => {
  const schema = { sections: [{ section: 'hero', repeats: [] }, { section: 'cards', repeats: [{ unitSelector: 'LI.card', count: 3 }, { unitSelector: 'A.pill', count: 1 }] }, { section: 'rows', repeats: [{ unitSelector: 'DIV.row', count: 2 }] }, { section: 'bare' }] };
  assert.deepEqual([repeatGroups(schema), repeatGroups({ sections: [] }), repeatGroups(null), repeatGroups({ sections: 'x' })], [2, 0, null, null]);
  const plain = 'units: no family declared for this page — the repeated-unit check did not run';
  assert.deepEqual([unitsNote(0), unitsNote(0, 0), unitsNote(0, null), unitsNote(2, 5)], [plain, plain, plain, null]);
  assert.equal(unitsNote(0, 2, 'a'), `${plain} (2 repeated module(s) recorded for this page in stardust/eds-schema/a.json, 0 unit families declared in stardust/replica/units.json)`);
  assert.deepEqual(unitsState(0, schema, 'a', ['font-dead-on-source:X']), { unitsDeclared: 0, unitsRecorded: 2, notes: ['font-dead-on-source:X', unitsNote(0, 2, 'a')] });
  assert.deepEqual(unitsState(0, null, 'a'), { unitsDeclared: 0, unitsRecorded: null, notes: [plain] });
  assert.deepEqual(unitsState(3, schema, 'a', ['n']), { unitsDeclared: 3, unitsRecorded: null, notes: ['n'] }, 'a family applies: no note, the schema is not read');
});
check('formatSummary: the units cell names the state (not declared / N families checked / no result) and the calibration line counts the pages that took no unit check', () => {
  const base = { pct: 1, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, pixelOnlyPass: true, reasons: [], override: null, error: null };
  const rows = [
    { ...base, slug: 'a', path: '/a', units: null, ...unitsState(0, { sections: [{ repeats: [{ count: 3 }] }] }, 'a') },
    { ...base, slug: 'b', path: '/b', units: { off: 0, hidden: 0, missing: 0 }, unitsRequired: true, ...unitsState(3, null, 'b') },
    { ...base, slug: 'c', path: '/c', units: { off: 1, hidden: 0, missing: 0 }, unitsRequired: false, ...unitsState(1, null, 'c') },
    { ...base, slug: 'd', path: '/d', units: null, ...unitsState(2, null, 'd') },
    { ...base, slug: 'e', path: '/e', units: null },
  ];
  const totals = { pages: 5, pass: 5, pixelOnlyPass: 5, overridePass: 0, fail: 0, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0, unitsNotDeclared: 1, unitsRecordedNotDeclared: 1 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals, rows });
  assert.match(md, /; \*\*units not declared 1 of 5\*\* \(no repeated-unit family applies: the check did not run on them; 1 of them have repeated modules recorded\)/);
  assert.match(md, /\| `\/a` \|.*\| not declared \| PASS \| \(reported\) units: no family declared for this page — the repeated-unit check did not run \(1 repeated module\(s\) recorded for this page in stardust\/eds-schema\/a\.json, 0 unit families declared in stardust\/replica\/units\.json\) \|/);
  assert.match(md, /\| `\/b` \|.*\| off 0 hidden 0 missing 0 \(3 families checked\) \| PASS \| - \|/);
  assert.match(md, /\| `\/c` \|.*\| off 1 hidden 0 missing 0 \(advisory\) \(1 family checked\) \| PASS \|/);
  assert.match(md, /\| `\/d` \|.*\| no result \(2 declared\) \| PASS \|/);
  assert.match(md, /\| `\/e` \|.*\| - \| PASS \| - \|/, 'a row from before the state reads as it did');
  assert.doesNotMatch(formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, unitsNotDeclared: 0 }, rows: rows.slice(1) }), /units not declared/);
});
check('runner: pages with no family carry unitsDeclared 0, the note and the totals; declaring a family or recording repeat groups changes the row, never the verdict or the exit code', () => {
  const { root, out, gateAll, rows, totals, done } = sandbox(['good', 'bad']);
  try {
    let r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    const before = Object.fromEntries(Object.entries(rows()).map(([k, v]) => [k, v.pass]));
    assert.deepEqual([rows().good.unitsDeclared, rows().good.unitPass, rows().good.pass, rows().good.reasons, rows().good.notes], [0, null, true, [], [unitsNote(0)]]);
    assert.deepEqual([totals().unitsNotDeclared, totals().unitsRecordedNotDeclared, totals().pass], [2, 0, 1]);
    assert.match(r.stdout, /\*\*units not declared 2 of 2\*\*/, 'the calibration line on stdout says so');
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /\| not declared \| PASS \| \(reported\) units: no family declared for this page/);
    mkdirSync(join(root, 'stardust/eds-schema'), { recursive: true });
    writeFileSync(join(root, 'stardust/eds-schema/good.json'), JSON.stringify({ sections: [{ section: 'cards', repeats: [{ unitSelector: 'LI.card', count: 3 }] }] }));
    writeFileSync(join(root, 'stardust/eds-schema/bad.json'), '{ not json');
    r = gateAll(['--compare-only']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([rows().good.unitsRecorded, rows().good.notes, rows().bad.unitsRecorded], [1, [unitsNote(0, 1, 'good')], null], 'an unreadable schema is no record');
    assert.deepEqual([totals().unitsNotDeclared, totals().unitsRecordedNotDeclared], [2, 1]);
    assert.deepEqual(Object.fromEntries(Object.entries(rows()).map(([k, v]) => [k, v.pass])), before);
    writeFileSync(join(out, 'units.json'), JSON.stringify({ good: { units: [{ origin: '.card' }] } }));
    r = gateAll(['--compare-only']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual([rows().good.unitsDeclared, rows().good.notes, rows().bad.unitsDeclared, totals().unitsNotDeclared], [1, [], 0, 1], 'a declared page loses the note');
    assert.deepEqual(Object.fromEntries(Object.entries(rows()).map(([k, v]) => [k, v.pass])), before);
  } finally { done(); }
});
// ---- reuse: a recorded pass is the page's whole verdict, written when the page has it (--skip-existing) -------------
const kinds = (spawned) => spawned.map((a) => `${a[0]} ${a[0] === 'reference' ? a[2] : a[1]}`.replace(/https:\/\/(origin|eds)\.example\//, '$1:')).sort();
const dropOf = (out, slug) => { try { return JSON.parse(readFileSync(join(out, slug, 'pixel.json'), 'utf8')).capturesDropped; } catch { return undefined; } };
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
check('reuse: a reusable recorded pass launches no probe, no capture and no compare under --skip-existing, and its row is the recorded one', () => {
  const { out, gateAll, spawned, shots, compares, rows, done } = sandbox(['a', 'b', 'bad'], { probes: true, units: true });
  try {
    let r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    const first = rows();
    assert.deepEqual([first.a.pass, first.b.pass, first.bad.pass], [true, true, false]);
    assert.deepEqual(Object.keys(dropOf(out, 'a')), ['masks', 'edsUrl', 'key', 'probes', 'at'], 'the record: the pixel pass, its key and the probe results');
    assert.deepEqual(Object.keys(dropOf(out, 'a').probes), ['content', 'clip', 'units']);
    r = gateAll(['--skip-existing']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(kinds(spawned()), ['content-presence origin:bad', 'unit-geometry origin:bad'], 'probes for the failed page only');
    assert.deepEqual([shots(), Object.keys(compares())], [[], ['bad']], 'no capture (the failed page reuses its own), one compare');
    assert.deepEqual(rows(), first, 'the rows, the reused ones from the record');
    assert.match(r.stdout, /browser budget: 1 at once \(default for this job: the larger of min\(0 page\(s\) to capture, --eds-concurrency 4\) and min\(1 page\(s\) to probe, --probe-concurrency 2\)\)/, 'the budget counts the pages the reuse decision left to gate');
    assert.match(r.stdout, /a → recorded pass reused/); assert.match(r.stdout, /b → recorded pass reused/); assert.doesNotMatch(r.stdout, /bad → recorded pass/);
    assert.deepEqual([rows().a.content.missing, rows().a.clipped, rows().a.units.off, rows().a.unitsRequired, rows().a.browser], [0, 0, 0, true, 'chrome'], 'probe results and all');
  } finally { done(); }
});
check('reuse: each key ingredient invalidates it — a mask, the presence allow-list, the clip allowance, an override, the unit families, a verdict option, a capture flag, the build URL, the reference, a capture record, an instrument file — for the page it concerns only, and names it', () => {
  const { root, out, gateAll, spawned, shots, rows, done } = sandbox(['a', 'b'], { probes: true, units: true });
  try {
    let args = []; // the options every later run keeps
    const run = (extra = []) => { const r = gateAll(['--skip-existing', ...args, ...extra], { ...REF }); assert.equal(r.status, 0, r.stderr + r.stdout); return r; };
    const probed = () => [...new Set(spawned().filter((a) => PROBE_KINDS.includes(a[0])).map((a) => a[1].split('/').pop()))].sort();
    assert.equal(gateAll([], { ...REF }).status, 0);
    assert.deepEqual([probed(), run() && probed()], [['a', 'b'], []], 'recorded, then reused');
    const edit = (file, fn) => { const f = join(root, file); writeFileSync(f, JSON.stringify(fn(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}))); };
    const G = 'stardust/replica/gates/all-1440';
    const steps = [
      ['masks', ['a'], () => edit(`${G}/masks.json`, () => ({ a: { masks: ['0:100'], reason: 'a rotating banner' } }))],
      ['masks', ['a'], () => edit(`${G}/masks.json`, (m) => ({ a: { ...m.a, reason: 'another reason' } }))],
      ['presence', ['a'], () => edit(`${G}/presence.json`, () => ({ a: { variable: ['.ticker'], reason: 'session-variable' } }))],
      ['clipAllow', ['a'], () => edit(`${G}/clip-allow.json`, () => ({ a: { max: 2, reason: 'a designed truncation' } }))],
      ['override', ['a'], () => edit(`${G}/overrides.json`, () => ({ a: { verdict: 'accepted', reason: 'a tier shift', waives: ['pixel'] } }))],
      ['units', ['a', 'b'], () => edit('stardust/replica/units.json', (u) => ({ card: { ...u.card, n: 4 } }))],
      ['options', ['a', 'b'], () => { args = ['--threshold', '9']; }],
      ['options', ['a', 'b'], () => { args = ['--threshold', '9', '--unit-tol', '6']; }],
      ['options', ['a', 'b'], () => { args = ['--threshold', '9', '--unit-tol', '6', '--no-content']; }],
      ['build', ['a', 'b'], () => { args = [...args, '--eds-host', 'branch--site--org.example']; }],
      ['reference', ['a'], () => edit(`${G}/a/baseline.json`, (b) => ({ ...b, capturedAt: '2026-11-02T10:00:00.000Z' }))],
      ['archetype', ['b'], () => { mkdirSync(join(root, 'stardust/replica/gates/b-1440'), { recursive: true }); edit('stardust/replica/gates/b-1440/baseline.json', () => ({ note: 'an archetype round froze a reference here' })); }],
      ['captures', ['a'], () => edit(`${G}/a/eds.json`, (m) => ({ ...m, at: 'later' }))],
      ['instruments', ['a', 'b'], () => { const f = join(root, 'stardust/scripts/diff/clip-probe.mjs'); writeFileSync(f, `${readFileSync(f, 'utf8')}// a newer probe\n`); }],
    ];
    for (const [name, pages, change] of steps) {
      change();
      const r = run();
      assert.deepEqual(probed(), pages, `${name}: probed again — ${r.stdout.split('\n').filter((l) => /recorded pass/.test(l)).join(' | ')}`);
      for (const s of pages) assert.match(r.stdout, new RegExp(`${s} → recorded pass not reused \\([^)]*${name} changed[^)]*\\) — gated again`), `${name} named for ${s}`);
      for (const s of ['a', 'b'].filter((x) => !pages.includes(x))) assert.match(r.stdout, new RegExp(`${s} → recorded pass reused`), `${name}: ${s} is not concerned`);
      assert.ok(pages.every((s) => shots().some((u) => u.endsWith(`/${s}`))), `${name}: its build captured again`);
      assert.deepEqual([run() && probed(), rows().a.pass, rows().b.pass], [[], true, true], `${name}: recorded under the new key, reused after`);
    }
    // the reference's capture settings (today's rule, kept): frozen again, the pass not reused
    args = [...args, '--locale', 'de-DE'];
    const r = run();
    assert.deepEqual(probed(), ['a', 'b']); assert.match(r.stdout, /re-frozen — capture settings changed \(locale\)/);
  } finally { done(); }
});
check('reuse: an incomplete or old-format record is not reused — no key, no probe results, another format, a key that cannot be computed, a capture record gone or in error; passKey is null when an ingredient is unreadable', () => {
  const parts = { build: 'https://eds.example/a', source: 'https://origin.example/a', captures: ['o1', 'e1'], instruments: ['i1'], reference: { dir: 'd', baseline: 'b1', png: true }, inputs: { content: 'c1', blocks: { cards: 'k1' }, shared: 's1', unresolved: [] } };
  const key = passKey(parts);
  assert.deepEqual([key.v, PASS_FORMAT, Object.keys(key)], [3, 3, ['v', 'build', 'source', 'masks', 'presence', 'clipAllow', 'override', 'units', 'options', 'reference', 'archetype', 'captures', 'instruments', 'page content', 'shared code', 'block cards']]);
  for (const [why, bad] of [['origin.json unreadable', { captures: [null, 'e1'] }], ['eds.json unreadable', { captures: ['o1', null] }], ['an instrument file unreadable', { instruments: ['i1', null] }], ['the reference\'s baseline.json unreadable', { reference: { dir: 'd', baseline: null, png: false } }], ['the prototype file unreadable', { prototype: null }], ['no build URL', { build: '' }], ['no local inputs', { inputs: null }], ['an unresolved local input', { inputs: { content: 'c1', blocks: {}, shared: 's1', unresolved: ['page content cannot be resolved'] } }], ['no page content digest', { inputs: { content: null, blocks: {}, shared: 's1', unresolved: [] } }]]) assert.equal(passKey({ ...parts, ...bad }), null, why);
  assert.equal(passKey({ ...parts, prototype: 'p1' }).prototype, 'p1');
  for (const [k, v] of [['masks', { masks: ['0:10'] }], ['presence', { main: 'main' }], ['clipAllow', { max: 1 }], ['override', { verdict: 'x' }], ['units', [{ origin: '.c' }]], ['options', { threshold: 9 }], ['archetype', ['x']]]) assert.notEqual(passKey({ ...parts, [k]: v })[k], key[k], k);
  const at = { masks: [], edsUrl: 'https://eds.example/a' }; const probes = { content: { totals: { missing: 0, hidden: 0 } } };
  const d = pageDir(RECORDS);
  try {
    assert.equal(recordedPass(d, key), null, 'no pass on record');
    dropPassedCaptures(d, at);
    assert.match(recordedPass(d, key).miss[0], /without its probe results or in another format/, 'the older record: masks and eds URL only');
    assert.notEqual(droppedPass(d, at), null, '--compare-only still reads it');
    dropPassedCaptures(d, { ...at, key });
    assert.deepEqual(dropOf(dirname(d), basename(d)), at, 'a key without probe results is not written');
    dropPassedCaptures(d, { ...at, key: { ...key, v: 1 }, probes });
    assert.match(recordedPass(d, key).miss[0], /another format/);
    dropPassedCaptures(d, { ...at, key, probes });
    assert.deepEqual(recordedPass(d, key).probes, probes, 'the complete record');
    assert.deepEqual(readdirSync(d).filter((f) => f.includes('.tmp')), [], 'written through a temp file that is gone');
    assert.match(recordedPass(d, null).miss[0], /key cannot be computed/);
    assert.deepEqual(recordedPass(d, { ...key, masks: 'x', units: 'y' }).miss, ['masks changed', 'units changed']);
    assert.deepEqual(recordedPass(d, { ...key, prototype: 'p1' }).miss, ['prototype changed']);
    writeFileSync(join(d, 'eds.json'), JSON.stringify({ instrument: 'none', error: 'stitch exit 1' }));
    assert.match(recordedPass(d, key).miss[0], /capture record is gone or holds an error/);
    writeFileSync(join(d, 'pixel.json'), '{ "pct": 1, "capturesDropped": { "masks": [], "edsUrl"'); // a write cut short
    assert.equal(recordedPass(d, key), null, 'an unreadable pixel.json records nothing');
  } finally { rmSync(d, { recursive: true, force: true }); }
  // the runner: an older version's record, and --compare-only's pixel pass of a page that was never probed
  const { out, gateAll, spawned, rows, done } = sandbox(['a', 'b'], { probes: true, units: true });
  try {
    const probed = () => [...new Set(spawned().filter((a) => PROBE_KINDS.includes(a[0])).map((a) => a[1].split('/').pop()))].sort();
    assert.equal(gateAll().status, 0);
    const f = join(out, 'a/pixel.json'); const pixel = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...pixel, capturesDropped: { masks: pixel.capturesDropped.masks, edsUrl: pixel.capturesDropped.edsUrl } }));
    let r = gateAll(['--skip-existing']);
    assert.deepEqual([r.status, probed()], [0, ['a']], r.stdout);
    assert.match(r.stdout, /a → recorded pass not reused \(recorded without its probe results or in another format\) — gated again/);
    r = gateAll(['--compare-only']);
    assert.deepEqual([r.status, spawned(), dropOf(out, 'a').key, dropOf(out, 'b').key], [0, [], JSON.parse(readFileSync(f, 'utf8')).capturesDropped.key, dropOf(out, 'b').key], '--compare-only keeps a reused record as it is');
    assert.ok(dropOf(out, 'a').key && dropOf(out, 'a').probes);
    assert.deepEqual([gateAll(['--skip-existing']).status, probed()], [0, []], 'and it is still reusable');
    // a page with captures and no probe record, passed by --compare-only: its pass is the pixel pass, not a verdict
    for (const s of ['a']) { rmSync(join(out, s), { recursive: true }); mkdirSync(join(out, s)); for (const side of ['origin', 'eds']) { writeFileSync(join(out, s, `${side}.png`), 'png'); writeFileSync(join(out, s, `${side}.json`), JSON.stringify({ instrument: 'stitch-live' })); writeFileSync(join(out, s, `${side}.capture.json`), JSON.stringify({ fixedLayers: { capture: 'once', count: 0 }, fontsFailed: [] })); } }
    r = gateAll(['--compare-only']);
    assert.deepEqual([r.status, rows().a.pass, rows().a.contentNA, Object.keys(dropOf(out, 'a'))], [0, true, 'not probed', ['masks', 'edsUrl']]);
    r = gateAll(['--skip-existing']);
    assert.deepEqual([r.status, probed(), rows().a.contentNA], [0, ['a'], null], 'the next --skip-existing run gates it');
  } finally { done(); }
});
check('a page\'s pass is on disk before the batch ends: while a later page of the same batch is still being probed, the finished page has its whole record and no PNG, and no summary exists yet', () => {
  const { root, out, gateAll, pngs, done } = sandbox(['a', 'b', 'c'], { probes: true, units: true });
  try {
    const snap = join(root, 'snap.log');
    const slow = { 'content-presence': { ms: 1200 }, 'unit-geometry': { ms: 1200 } };
    const r = gateAll([], { STUB_SNAP: snap, STUB_BY_SLUG: JSON.stringify({ b: slow, c: { 'content-presence': { ms: 1200 }, 'unit-geometry': { ms: 2000 } } }) });
    assert.equal(r.status, 0, r.stderr);
    const seen = readFileSync(snap, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const at = (slug, kind) => seen.find((x) => x.slug === slug && x.kind === kind);
    assert.deepEqual(at('b', 'unit-geometry').passes, ['a'], 'a is recorded while b and c (the same batch) are in flight');
    assert.deepEqual(at('c', 'unit-geometry').passes, ['a', 'b'], 'and b before c ends');
    assert.ok(seen.every((x) => x.summary === false), 'the summary is written at the end only');
    assert.deepEqual([pngs('a'), pngs('c'), existsSync(join(out, 'summary.json'))], [[], [], true]);
  } finally { done(); }
});
check('kill and resume: a job killed while a probe is in flight leaves no summary and keeps the pass (and the round) of every page that finished; the --skip-existing resume launches instruments only for the pages without a complete verdict, and the page whose probe was in flight is probed and compared again', () => {
  const { root, out, gateAll, spawned, shots, compares, rows, tableOf, done } = sandbox(['a', 'b', 'c', 'd'], { probes: true, units: true });
  try {
    copyFileSync(join(HERE, '..', 'rounds.mjs'), join(root, 'stardust/scripts/replica/rounds.mjs')); // the real ledger
    const rounds = (s) => { const f = join(root, `stardust/replica/gates/${s}-1440/rounds.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).stages['all-pages'].rounds.map((x) => x.verdict) : []; };
    // a and b finish; c's unit probe kills the job at 900 ms while its content probe (1500 ms) and d's probes are in flight
    const by = { c: { 'content-presence': { ms: 1500 }, 'unit-geometry': { ms: 900, killGate: true } }, d: { 'content-presence': { ms: 1300 }, 'unit-geometry': { ms: 1300 } } };
    let r = gateAll(['--probe-concurrency', '4'], { STUB_BY_SLUG: JSON.stringify(by) });
    assert.equal(r.signal, 'SIGKILL', 'the job was killed');
    wait(900); // the orphaned probes end
    assert.equal(tableOf('all-1440'), null, 'no summary: nothing reads as complete');
    assert.deepEqual(['a', 'b', 'c', 'd'].map((s) => !!(dropOf(out, s) || {}).key), [true, true, false, false], 'the finished pages are on disk');
    assert.deepEqual(['a', 'b', 'c', 'd'].map(rounds), [['pass'], ['pass'], [], []]);
    assert.ok(existsSync(join(out, 'c/content.json')), 'the in-flight content probe even left a result: not a verdict');
    r = gateAll(['--skip-existing']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(kinds(spawned()), ['content-presence origin:c', 'content-presence origin:d', 'unit-geometry origin:c', 'unit-geometry origin:d'], 'probes for c and d only');
    assert.deepEqual([Object.keys(compares()).sort(), shots()], [['c', 'd'], []], 'compared again; their finished captures are reused (--skip-existing)');
    assert.match(r.stdout, /a → recorded pass reused/); assert.match(r.stdout, /b → recorded pass reused/);
    assert.deepEqual([Object.values(rows()).map((x) => x.pass), tableOf('all-1440').totals.pass], [[true, true, true, true], 4]);
    assert.deepEqual(['a', 'b', 'c', 'd'].map(rounds), [['pass'], ['pass'], ['pass'], ['pass']], 'one round per page: a reused pass records none');
    assert.deepEqual([gateAll(['--skip-existing']).status, spawned(), shots()], [0, [], []], 'and a further resume launches nothing');
  } finally { done(); }
});
check('without --skip-existing nothing is reused: every page is captured, probed and compared whatever is on record, with the same instrument calls and the same rows as the first run', () => {
  const { gateAll, spawned, shots, compares, rows, done } = sandbox(['a', 'b', 'bad'], { probes: true, units: true });
  try {
    const calls = () => [spawned().filter((a) => PROBE_KINDS.includes(a[0])).map((a) => JSON.stringify(a)).sort(), spawned().filter((a) => a[0] === 'stitch-shot').map((a) => JSON.stringify(a)).sort(), Object.values(compares()).map((a) => a.join(' ')).sort()];
    assert.equal(gateAll().status, 2);
    const first = { calls: calls(), rows: rows() };
    assert.deepEqual([first.calls[0].length, first.calls[1].length, first.calls[2].length], [6, 6, 3], 'content + units, two captures and one compare per page');
    const r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual({ calls: calls(), rows: rows() }, first);
    assert.doesNotMatch(r.stdout, /recorded pass/);
    assert.equal(gateAll(['--only', 'a']).status, 0); assert.deepEqual([calls()[0].length, shots()], [2, ['https://eds.example/a', 'https://origin.example/a']], '--only: its page, in full');
    assert.equal(gateAll(['--skip-existing', '--recapture-eds']).status, 2);
    assert.deepEqual([calls()[0].length, shots().filter((u) => u.includes('eds.example')).length, calls()[2].length], [6, 3, 3], '--recapture-eds reuses no pass: every build shot, probed and compared again');
  } finally { done(); }
});
// ---- reuse: the page's local build inputs are in the key — a build that changed in the working tree is gated again ----
check('local inputs: editing the page\'s content file, a file of a block it uses, a shared style or the header fragment gates the page again and names the group (page content, block <name>, shared code); a file of a block it does NOT use leaves it reused; so does its migrated HTML once the ledger names it', () => {
  const { root, gateAll, spawned, rows, done } = sandbox(['a', 'b'], { probes: true, units: true });
  try {
    const probed = () => [...new Set(spawned().filter((x) => PROBE_KINDS.includes(x[0])).map((x) => x[1].split('/').pop()))].sort();
    const run = () => { const r = gateAll(['--skip-existing']); assert.equal(r.status, 0, r.stderr + r.stdout); return r; };
    const touch = (f) => writeFileSync(join(root, f), `${existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : ''}/* edited */\n`);
    assert.equal(gateAll().status, 0);
    assert.deepEqual([run() && probed()], [[]], 'recorded, then reused');
    // a uses cards + teaser, b teaser only; quote is used by neither
    for (const [file, pages, group] of [['content/a.html', ['a'], 'page content'], ['blocks/cards/cards.css', ['a'], 'block cards'], ['blocks/quote/quote.js', [], null], ['blocks/teaser/teaser.js', ['a', 'b'], 'block teaser'], ['blocks/cards/extra/part.js', ['a'], 'block cards'],
      ['styles/styles.css', ['a', 'b'], 'shared code'], ['content/nav.html', ['a', 'b'], 'shared code'], ['blocks/header/header.js', ['a', 'b'], 'shared code'], ['scripts/scripts.js', ['a', 'b'], 'shared code'], ['fonts/brand.woff2', ['a', 'b'], 'shared code'], ['content/fr/footer.html', ['a', 'b'], 'shared code'], ['content/b.html', ['b'], 'page content']]) {
      mkdirSync(dirname(join(root, file)), { recursive: true }); touch(file);
      const r = run();
      assert.deepEqual(probed(), pages, `${file}: ${r.stdout.split('\n').filter((l) => /recorded pass/.test(l)).join(' | ')}`);
      for (const s of pages) assert.match(r.stdout, new RegExp(`${s} → recorded pass not reused \\(${group} changed\\) — gated again`), `${file}: ${group} named for ${s}`);
      for (const s of ['a', 'b'].filter((x) => !pages.includes(x))) assert.match(r.stdout, new RegExp(`${s} → recorded pass reused`), `${file}: ${s} reused`);
      assert.deepEqual([run() && probed(), rows().a.pass, rows().b.pass], [[], true, true], `${file}: recorded under the new key`);
    }
    // an mtime alone is not a change: the same bytes written again
    writeFileSync(join(root, 'styles/styles.css'), readFileSync(join(root, 'styles/styles.css')));
    assert.deepEqual(run() && probed(), [], 'contents, not mtimes');
    // the ledger: its row's blocks and migrated HTML join the page's inputs
    mkdirSync(join(root, 'stardust/migrated'), { recursive: true }); writeFileSync(join(root, 'stardust/migrated/b.html'), '<main>b</main>');
    mkdirSync(join(root, 'stardust/rollout/coverage'), { recursive: true });
    writeFileSync(join(root, 'stardust/rollout/coverage/pages.json'), JSON.stringify({ pages: [{ slug: 'b', path: '/b', blocks: ['quote'], source: { migratedHtml: 'stardust/migrated/b.html' }, delivery: { status: 'deployed', deployedUrl: 'https://eds.example/b' } }] }));
    let r = run();
    assert.deepEqual(probed(), ['b']); assert.match(r.stdout, /b → recorded pass not reused \((?=[^)]*page content changed)(?=[^)]*block quote changed)[^)]*\)/);
    touch('stardust/migrated/b.html'); r = run();
    assert.deepEqual(probed(), ['b'], 'the migrated HTML'); assert.match(r.stdout, /b → recorded pass not reused \(page content changed\)/);
    touch('blocks/quote/quote.js'); r = run();
    assert.deepEqual(probed(), ['b'], 'a block the ledger names for it'); assert.match(r.stdout, /b → recorded pass not reused \(block quote changed\)/);
  } finally { done(); }
});
check('local inputs: unresolvable inputs are never reused and the log says which — no content file and no migrated HTML, no blocks/ directory, none of the shared paths; a project with none of them records no reusable pass at all', () => {
  const { root, out, gateAll, spawned, done } = sandbox(['a', 'b'], { probes: true, units: true });
  try {
    const probed = () => [...new Set(spawned().filter((x) => PROBE_KINDS.includes(x[0])).map((x) => x[1].split('/').pop()))].sort();
    assert.equal(gateAll().status, 0);
    rmSync(join(root, 'content/a.html'));
    let r = gateAll(['--skip-existing']);
    assert.deepEqual([r.status, probed()], [0, ['a']]);
    assert.match(r.stdout, /a → recorded pass not reused \(page content cannot be resolved: no content file for \/a under content\/ and no migrated HTML\) — gated again/);
    assert.equal(dropOf(out, 'a').key, undefined, 'and the pass it earns now has no key: not the weaker one');
    r = gateAll(['--skip-existing']);
    assert.deepEqual(probed(), ['a'], 'gated on every run while it cannot be resolved');
    writeFileSync(join(root, 'content/a.html'), '<main><div><h1>a</h1></div></main>');
    assert.deepEqual([gateAll(['--skip-existing']).status, probed(), gateAll(['--skip-existing']).status, probed()], [0, ['a'], 0, []], 'resolvable again: keyed, then reused');
    for (const [gone, why] of [[['blocks'], /blocks cannot be resolved: no blocks\/ directory in the project/], [['styles', 'scripts', 'head.html'], /shared code cannot be resolved: none of styles\/ fonts\/ blocks\/header\/ blocks\/footer\/ head\.html scripts\/ in the project/]]) {
      for (const g of gone) rmSync(join(root, g), { recursive: true });
      r = gateAll(['--skip-existing']);
      assert.deepEqual(probed(), ['a', 'b'], String(why)); assert.match(r.stdout, why);
    }
  } finally { done(); }
  const bare = sandbox(['a'], { probes: true, units: true, inputs: false });
  try {
    assert.equal(bare.gateAll().status, 0);
    const r = bare.gateAll(['--skip-existing']);
    assert.equal(r.status, 0); assert.equal(bare.spawned().filter((x) => PROBE_KINDS.includes(x[0])).length, 2, 'probed again');
    assert.match(r.stdout, /a → recorded pass not reused \(page content cannot be resolved: [^)]*, blocks cannot be resolved: [^)]*, shared code cannot be resolved: [^)]*\) — gated again/);
  } finally { bare.done(); }
});
check('local inputs: the shared-code digest is computed once per job and a block\'s once per block, whatever the number of pages; the prototype stage keys the prototype and the local files it links', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-inputs-')));
  try {
    const put = (f, body) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), body); };
    const pages = Array.from({ length: 40 }, (_, i) => ({ slug: `p${i}`, liveUrl: `https://eds.example/p${i}` }));
    for (const p of pages) put(`content/${p.slug}.html`, `<main><div><div class="hero"></div><div class="${p.slug.endsWith('1') ? 'cards' : 'teaser'}"></div></div></main>`);
    for (const b of ['hero', 'cards', 'teaser', 'unused']) put(`blocks/${b}/${b}.js`, b);
    put('styles/styles.css', 'x'); put('scripts/aem.js', 'x');
    const walked = [];
    const inputsOf = localInputs({ root, snap: (r, paths) => { walked.push(paths.join(' ')); const files = {}; for (const p of paths) { const f = join(r, p); if (!existsSync(f)) continue; for (const n of (p.endsWith('/') ? readdirSync(f) : [''])) files[join(p, n)] = readFileSync(join(f, n), 'utf8'); } return files; } });
    const got = pages.map(inputsOf);
    assert.ok(got.every((x) => x.unresolved.length === 0 && x.content && x.shared === got[0].shared), JSON.stringify(got[0]));
    assert.deepEqual([inputsOf.stats.shared, inputsOf.stats.blocks, inputsOf.stats.content], [1, 3, 40], 'shared once, each used block once, the unused one never');
    assert.deepEqual([walked.filter((w) => w.startsWith('styles/')).length, walked.filter((w) => w === 'blocks/hero/').length, walked.includes('blocks/unused/')], [1, 1, false]);
    assert.deepEqual([Object.keys(got[1].blocks), Object.keys(got[2].blocks)], [['cards', 'hero'], ['hero', 'teaser']]);
    // prototype stage
    put('stardust/prototypes/home-proposed.html', '<link rel="stylesheet" href="proto.css"><script src="./js/app.js"></script><img src="https://cdn.example/x.png"><a href="#top">x</a>');
    put('stardust/prototypes/proto.css', 'a'); put('stardust/prototypes/js/app.js', 'b');
    const proto = (page = { slug: 'home', prototypePath: 'stardust/prototypes/home-proposed.html' }) => localInputs({ root, stage: 'prototype' })(page);
    const first = proto();
    assert.deepEqual([first.unresolved, first.blocks, first.shared], [[], {}, null]);
    put('stardust/prototypes/js/app.js', 'c'); const second = proto(); assert.notEqual(second.content, first.content, 'a linked script');
    put('stardust/prototypes/proto.css', 'd'); assert.notEqual(proto().content, second.content, 'a linked stylesheet');
    put('stardust/prototypes/other.css', 'e'); assert.equal(proto().content, localInputs({ root, stage: 'prototype' })({ slug: 'home', prototypePath: 'stardust/prototypes/home-proposed.html' }).content, 'a file it does not link');
    assert.match(proto({ slug: 'x', prototypePath: 'stardust/prototypes/none.html' }).unresolved[0], /page content cannot be resolved: no prototype file at stardust\/prototypes\/none\.html/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
// ---- the roster tolerance × the recorded pass ----
check('reuse × roster tolerance: a pass under the tolerance is recorded with its key and probe results and rebuilds from the record as a pass — judge, note, counters — with no instrument; --height-tol (the tolerance\'s input) and --offset-max are in the key: changed, the page is gated again and judged with the new one', () => {
  const within = { STUB_PX: JSON.stringify({ page: { pct: 16.62, aligned: { used: true, pct: 4.7, steps: st(-54, 40, -23) } } }) };
  const { out, gateAll, spawned, shots, compares, rows, totals, done } = sandbox(['page', 'plain'], { probes: true });
  try {
    let r = gateAll([], within);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const first = rows();
    assert.deepEqual([first.page.pass, first.page.offsetJudge, first.page.offsetsWithinTolerance, first.page.offsetBound, first.page.offsetTolerance, first.plain.offsetsWithinTolerance], [true, 'tolerance', true, 50, 250, false]);
    assert.deepEqual(Object.keys(dropOf(out, 'page')), ['masks', 'edsUrl', 'key', 'probes', 'at'], 'the whole verdict is on record, though pixel-compare itself said FAIL (strict bound)');
    assert.equal(JSON.parse(readFileSync(join(out, 'page', 'pixel.json'), 'utf8')).aligned.steps.length, 3, 'the steps the tolerance reads are in the record');
    // reused: no STUB_PX this time — a compare would read 1 % with no offsets, so the row can only come from the record
    r = gateAll(['--skip-existing']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([spawned(), shots(), Object.keys(compares())], [[], [], []], 'no probe, no capture, no compare');
    assert.match(r.stdout, /page → recorded pass reused/);
    assert.deepEqual(rows(), first, 'the rebuilt rows are the recorded ones');
    assert.ok(rows().page.notes.includes('offsets within the roster tolerance: 117px total, largest step 54px (strict bound 50px, tolerance 250px)'));
    assert.deepEqual([totals().pass, totals().failOffsets, totals().offsetsWithinTolerance], [2, 0, 1]);
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /\(bound 50, tolerance 250\) \|.*\| PASS \| .*\(reported\) offsets within the roster tolerance: 117px total/);
    // the tolerance's input changes: the key names it, the page is judged again under the new tolerance (0.04 × 5000 = 200 ≥ 117)
    r = gateAll(['--skip-existing', '--height-tol', '0.04'], within);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /page → recorded pass not reused \(options changed\) — gated again/);
    assert.deepEqual([Object.keys(compares()).sort(), rows().page.offsetTolerance, rows().page.pass], [['page', 'plain'], 200, true]);
    // a tolerance the record does not meet (0.02 × 5000 = 100 < 117): never the old pass
    r = gateAll(['--skip-existing', '--height-tol', '0.02'], within);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /page → recorded pass not reused \(options changed\) — gated again/);
    assert.deepEqual([rows().page.pass, rows().page.failing, rows().page.offsetTolerance, totals().offsetsWithinTolerance, dropOf(out, 'page')], [false, ['pixel'], 100, 0, undefined]);
    // back under the default, then an explicit --offset-max (the strict bound only): gated again, fails
    assert.equal(gateAll(['--skip-existing'], within).status, 0);
    assert.deepEqual(Object.keys(dropOf(out, 'page')), ['masks', 'edsUrl', 'key', 'probes', 'at']);
    r = gateAll(['--skip-existing', '--offset-max', '50'], within);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /page → recorded pass not reused \(options changed\) — gated again/);
    assert.deepEqual([rows().page.pass, rows().page.offsetTolerance, rows().page.offsetJudge], [false, null, 'bound']);
  } finally { done(); }
});
// ---- the deadline hint (run-bg.mjs's convention: --deadline-hint prints the seconds the job may take) ----
check('deadlineHint: fixed + per-page budget × pages ÷ concurrency, floor 900, ceiling 14400; the prototype stage has its own budget; concurrency is the slowest pool, at most 2', () => {
  assert.deepEqual(HINT, { fixed: 300, perPage: { published: 240, prototype: 20 }, floor: 900, ceiling: 14400, maxConcurrency: 2 });
  assert.deepEqual([0, 1, 5, 6, 20, 53, 75, 100, 117, 118, 5000].map((n) => deadlineHint(n)), [900, 900, 900, 1020, 2700, 6660, 9300, 12300, 14340, 14400, 14400]);
  assert.deepEqual([1, 20, 100].map((n) => deadlineHint(n, { oc: 1, ec: 1, pc: 1 })), [900, 5100, 14400], 'concurrency 1: twice the per-page time');
  assert.equal(deadlineHint(20, { oc: 1, ec: 4, pc: 2 }), 5100, 'the slowest pool paces the job');
  assert.equal(deadlineHint(20, { oc: 8, ec: 8, pc: 8 }), 2700, 'nothing faster than the default is credited');
  assert.equal(deadlineHint(20, { oc: NaN, ec: 0, pc: 2 }), 5100, 'an unusable concurrency reads as 1');
  assert.deepEqual([53, 100, 250].map((n) => deadlineHint(n, { stage: 'prototype' })), [900, 1300, 2800]);
});
check('gate-all --deadline-hint prints the formula\'s value for 1, 20 and 100 selected pages and launches nothing (no capture, no probe, no file)', () => {
  const slugs = Array.from({ length: 100 }, (_, i) => `p${i}`);
  const { root, out, gateAll, shots, spawned, done } = sandbox(slugs);
  try {
    const before = readdirSync(join(root, 'stardust')).sort();
    const hint = (args, env) => { const r = gateAll(['--deadline-hint', ...args], env); assert.equal(r.status, 0, r.stderr); assert.deepEqual([shots(), spawned()], [[], []], 'nothing launched'); return r.stdout; };
    assert.equal(hint(['--only', 'p7']), '900\n');
    assert.equal(hint(['--only', slugs.slice(0, 20).join(',')]), '2700\n');
    assert.equal(hint([]), '12300\n');
    assert.equal(hint(['--skip-existing', '--width', '360']), '12300\n', 'a --skip-existing page counts in full');
    assert.equal(hint(['--only', slugs.slice(0, 20).join(','), '--origin-concurrency', '1', '--eds-concurrency', '2', '--probe-concurrency', '1']), '5100\n');
    assert.equal(hint(['--only', 'not-a-page']), '900\n', 'no page selected: the floor');
    assert.equal(hint(['--stage', 'prototype']), '900\n');
    assert.equal(existsSync(out), false, 'the table dir is not created');
    assert.deepEqual(readdirSync(join(root, 'stardust')).sort(), before, 'nothing written');
    const r = gateAll(['--deadline-hint', '--state', 'nowhere.json']);
    assert.deepEqual([r.status, r.stdout], [1, ''], 'no roster: no hint (run-bg keeps its default)'); assert.match(r.stderr, /no deadline hint/);
  } finally { done(); }
});
check('gate-all carries run-bg\'s marker, and --help states the hint formula', () => {
  const src = readFileSync(join(HERE, '..', 'gate-all.mjs'), 'utf8');
  assert.ok(src.includes('run-bg:deadline-hint'), 'the marker run-bg.mjs reads before it asks');
  const r = spawnSync(process.execPath, [join(HERE, '..', 'gate-all.mjs'), '--help'], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(r.status, 0); assert.match(r.stdout, /--deadline-hint/); assert.match(r.stdout, /the larger of 900 and 300 \+ B × pages ÷ c seconds, at most 14400/); assert.match(r.stdout, /B = 240 s a page at the published stage/);
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
