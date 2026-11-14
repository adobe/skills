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
// stub instruments, no browser.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATCH, CHILD_FLAGS, DELIVERED, captureRecordOf, clipArgs, contentArgs, dropPassedCaptures, droppedPass, fontChecksSkipped, fontFails, fontsNotLoaded, formatSummary, isErrorRow, parseArgs, passThrough, hostOrigin, migratedPathOf, recordedProbes, recordRounds, selectPages, shotFonts, staleCapture, stitchArgs, unitArgs, verdict } from '../gate-all.mjs';

// pixel-compare imports pngjs at module level (a project devDependency, absent in the plugin checkout):
// import it lazily and skip its one check where it does not resolve, like the other browser/dep-bound tests.
let textBoxPct = null;
try { ({ textBoxPct } = await import('../pixel-compare.mjs')); } catch { console.log('skip  pixel-compare textBoxPct (pngjs not importable here)'); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-all.mjs');
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
  cpSync(SCRIPT, join(replica, 'gate-all.mjs')); chmodSync(join(replica, 'gate-all.mjs'), 0o755);
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
    if (json && !process.env['STUB_NO_JSON_' + side]) writeFileSync(json, JSON.stringify({ url, out, width: 1440, vh: 900, settle: true, ...fonts, fixedLayers: { capture: 'once', count: 0, late: 0 }, height: 2000 }, null, 2) + '\\n');
    console.log('overflow: scrollWidth=1440 viewport=1440 delta=0'); console.log('stitched ' + out);`);
  stub('pixel-compare.mjs', `console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 2000 }, pass: true, bands: [] }));`);
  const pages = (extra = {}) => ({ pages: [{ slug: 'a', url: 'https://origin.example/a', liveUrl: 'https://served.example/a', status: 'deployed', template: 't', fidelityTier: 'thin', ...extra }] });
  const runAll = (tag, args, env = {}, state = pages()) => {
    const out = join(root, `out-${tag}`); const stateFile = join(root, `state-${tag}.json`);
    writeFileSync(stateFile, JSON.stringify(state));
    const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), '--state', stateFile, '--out', out, '--no-probes', ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
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
      assert.deepEqual([row.pass, row.reasons, row.notes, row.fontsNotLoaded], [true, [], ['font-dead-on-source:Brand Sans', 'font-dead-on-both:Brand Serif'], [{ family: 'Brand Sans', side: 'origin' }, { family: 'Brand Serif', side: 'both' }]]);
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
      const layers = { capture: 'once', count: 0, late: 0 };
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fixedLayers: layers, height: 2000 }));
      const pre = runAll('proto-pre', protoArgs, {}, proto);
      assert.equal(pre.status, 2, pre.stderr);
      assert.match(pre.origin.note, /^reused .*live\.png/);
      assert.deepEqual([pre.origin.fontsFailed, pre.origin.fontCheck], [null, 'failed: the capture record predates the font check — re-copy stitch-shot.mjs']);
      assert.deepEqual(pre.summary.rows[0].reasons, ['font-check-skipped:origin']);
      assert.deepEqual(pre.record.fixedLayers, layers, 'the cached record went with the copy');
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: ['Brand Serif'], fixedLayers: layers, height: 2000 }));
      const some = runAll('proto-some', protoArgs, {}, proto);
      assert.equal(some.status, 0, some.stderr);
      assert.deepEqual([some.origin.fontsFailed, some.summary.rows[0].reasons, some.summary.rows[0].notes], [['Brand Serif'], [], ['font-dead-on-source:Brand Serif']], 'the cached capture\'s dead face is the source\'s: reported, the row passes');
      writeFileSync(join(cached, 'live.capture.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: [], fixedLayers: layers, height: 2000 }));
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
      writeFileSync(join(cached, 'baseline.json'), JSON.stringify({ fontsFailed: ['Brand Serif'], fixedLayers: { capture: 'once', count: 1, late: 0 } }));
      const r = runAll('proto-baseline', protoArgs, {}, proto);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.origin.note, /^reused .*live\.png/);
      assert.deepEqual([r.origin.fontsFailed, r.summary.rows[0].reasons, r.summary.rows[0].notes], [['Brand Serif'], [], ['font-dead-on-source:Brand Serif']], 'the baseline\'s dead face is read and reported');
      assert.deepEqual(r.record, { writtenBy: 'gate-all.mjs', copiedFrom: 'stardust/replica/gates/a-1440/live.png', fixedLayers: { capture: 'once', count: 1, late: 0 }, fontsFailed: ['Brand Serif'] });
      writeFileSync(join(cached, 'baseline.json'), JSON.stringify({ fontsFailed: [], fixedLayers: { capture: 'once', count: 1, late: 0 } }));
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
function sandbox(slugs, { probes = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
  const rep = join(root, 'stardust/scripts/replica');
  mkdirSync(rep, { recursive: true });
  copyFileSync(SCRIPT, join(rep, 'gate-all.mjs'));
  cpSync(join(HERE, '../../../diff/scripts'), join(root, 'stardust/scripts/diff'), { recursive: true });
  cpSync(join(HERE, '../../../stardust/scripts'), join(root, 'stardust/scripts/stardust'), { recursive: true });
  writeFileSync(join(rep, 'stitch-shot.mjs'), `import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2); appendFileSync(process.env.STUB_LOG, url + '\\n');
if (process.env.STUB_ARGV) appendFileSync(process.env.STUB_ARGV, JSON.stringify(['stitch-shot', ...process.argv.slice(2)]) + '\\n');
if (process.env.STUB_PNGS) appendFileSync(process.env.STUB_PNGS, readdirSync('stardust/replica/gates', { recursive: true }).filter((f) => f.endsWith('.png')).length + '\\n');
if (url === process.env.STUB_KILL) { process.kill(process.ppid, 'SIGKILL'); process.exit(1); }
if (url === process.env.STUB_FAIL) { console.error('capture failed'); process.exit(1); }
writeFileSync(out, 'png'); writeFileSync(out.replace(/\\.png$/, '.capture.json'), JSON.stringify({ fixedLayers: { capture: 'once', count: 0 }, fontsFailed: [] }));\n`);
  writeFileSync(join(rep, 'pixel-compare.mjs'), `import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2); writeFileSync(a[a.indexOf('--out') + 1], 'png');
const pct = a[0].includes('/bad/') ? 30 : 1;
console.log(JSON.stringify({ pct, heightDelta: 0, compared: { width: 1440, height: 5000 }, pass: pct <= 10 }));\n`);
  // Stub probes (probes: true): each logs its argv (STUB_ARGV), then exits STUB_<CONTENT|CLIP>_RC without a result
  // ("kill" = killed mid-run, what a timeout leaves) or writes a clean one.
  const probeStub = (name, envKey, body) => writeFileSync(join(root, 'stardust/scripts/diff', `${name}.mjs`), `import { appendFileSync, writeFileSync } from 'node:fs';
export const inPage = () => ({}); // unit-geometry imports it from clip-probe
const a = process.argv.slice(2); const main = (process.argv[1] || '').endsWith('${name}.mjs');
if (main) appendFileSync(process.env.STUB_ARGV, JSON.stringify(['${name}', ...a]) + '\\n');
const rc = process.env.${envKey};
if (!main) { /* imported, not run */ }
else if (rc === 'kill') process.kill(process.pid, 'SIGKILL');
else if (rc) { console.error('${name} error: stub exit ' + rc); process.exit(Number(rc)); }
else { const counts = { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }; writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify(${body})); }\n`);
  if (probes) {
    probeStub('content-presence', 'STUB_CONTENT_RC', `{ _provenance: { at: 'now', tier: 'chrome' }, totals: { missing: 0, hidden: 0, controlState: 0 }, scope: 'main', eds: { clip: { counts, groups: [] } }, origin: { clip: { counts } } }`);
    probeStub('clip-probe', 'STUB_CLIP_RC', `{ counts, groups: [], tier: 'chrome' }`);
  }
  const page = (slug) => ({ slug, url: `https://origin.example/${slug}`, status: 'deployed', liveUrl: `https://eds.example/${slug}` });
  writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ pages: slugs.map(page) }));
  const out = join(root, 'stardust/replica/gates/all-1440');
  const log = join(root, 'stitch.log');
  const argvLog = join(root, 'argv.log');
  const gateAll = (args = [], env = {}) => { writeFileSync(log, ''); writeFileSync(argvLog, ''); return spawnSync(process.execPath, [join(rep, 'gate-all.mjs'), ...(probes ? [] : ['--no-probes']), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, STUB_LOG: log, STUB_ARGV: argvLog, ...env } }); };
  return {
    root, out, gateAll,
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
  assert.deepEqual(passThrough('stitch-shot', off), ['--locale', 'en-US', '--no-dismiss']);
  assert.deepEqual(passThrough('clip-probe', off), ['--locale', 'en-US', '--no-dismiss']);
  assert.deepEqual(stitchArgs('s', 'u', 'o.png', parseArgs(['node', 'x'])), ['s', 'u', 'o.png', '--width', '1440', '--settle', '--locale', 'en-US'], 'no flag: the command line as it was');
});
check('CHILD_FLAGS is what each child\'s own parseArgs accepts — a flag listed is accepted, an accepted one is listed (a probe that gains --dismiss fails here until it is wired)', () => {
  const src = { 'stitch-shot': join(HERE, '../stitch-shot.mjs'), 'content-presence': join(HERE, '../../../diff/scripts/content-presence.mjs'), 'clip-probe': join(HERE, '../../../diff/scripts/clip-probe.mjs'), 'unit-geometry': join(HERE, '../../../diff/scripts/unit-geometry.mjs') };
  assert.deepEqual(Object.keys(CHILD_FLAGS).sort(), Object.keys(src).sort());
  for (const [name, file] of Object.entries(src)) {
    const text = readFileSync(file, 'utf8');
    // a probe takes the three overlay flags through measure-live's overlayFlag(); --locale and stitch-shot's own flags are parsed in place
    const accepted = ['--consent', '--dismiss', '--no-dismiss', '--locale'].filter((flag) => text.includes("=== '" + flag + "'") || (flag !== '--locale' && text.includes('overlayFlag(a,')));
    assert.deepEqual([...CHILD_FLAGS[name]].sort(), accepted.sort(), name);
  }
});

// ---- verdict integrity: a probe error is an error row -------------------------------------------------------------------
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
  assert.equal(verdict({ ...ok, clip: { error: 'c' }, override: { verdict: 'PASS', reason: 'R-01' } }).passWithOverride, true);
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
    assert.equal(JSON.parse(readFileSync(join(root, 'gates', 'b-1440', 'rounds.json'), 'utf8')).stages.published, undefined, 'a pass here is never a gate.sh published round: it cannot free a confirmation there');
    assert.deepEqual(await recordRounds([row('a', false)], opts, { rounds: { load() { throw new Error('boom'); } } }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
