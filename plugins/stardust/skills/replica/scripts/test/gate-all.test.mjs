#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag); parseArgs defaults and
// --out derived from --width; --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff.
// Fonts (gate rule 14): shotFonts reads a stitch --json record (a list = checked, null + fontCheck when the check
// could not run, when the record predates the check or when there is none), fontsNotLoaded / fontChecksSkipped over
// the two metas (explicit null only), verdict's font-not-loaded:<family> and font-check-skipped:<side> reasons failing
// an otherwise passing row, the calibration line and the FAIL (fonts) cell; then the runner with stub instruments
// (stitch-shot writes the record, pixel-compare the JSON): the meta carries fontsFailed, a dead face or a skipped
// check fails the row (exit 2), the prototype stage reads live-shot.json beside the archetype round's live.png — none
// is unchecked, never "all loaded".
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontChecksSkipped, fontsNotLoaded, formatSummary, parseArgs, shotFonts, verdict } from '../gate-all.mjs';

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
// ---- fonts (gate rule 14): a dead face on either side fails the row; a check that could not run is never a pass -----
const live = (fontsFailed, extra = {}) => ({ instrument: 'stitch-live', url: 'https://origin.example/', ...extra, ...(fontsFailed === undefined ? {} : { fontsFailed }) });
check('shotFonts: a record with a list is checked (strings only); null, an absent key or no record at all → fontsFailed null + a fontCheck saying why — never []', () => {
  assert.deepEqual(shotFonts({ fontsFailed: ['Brand Sans', 7, '', 'Brand Serif'] }), { fontsFailed: ['Brand Sans', 'Brand Serif'] });
  assert.deepEqual(shotFonts({ fontsFailed: [] }), { fontsFailed: [] });
  assert.deepEqual(shotFonts({ fontsFailed: null, fontCheck: 'failed: fonts unavailable' }), { fontsFailed: null, fontCheck: 'failed: fonts unavailable' });
  assert.deepEqual(shotFonts({ fontsFailed: null }), { fontsFailed: null, fontCheck: 'failed: the check could not run' });
  assert.deepEqual(shotFonts({ url: 'x', height: 10 }), { fontsFailed: null, fontCheck: 'failed: the capture record predates the font check — re-copy stitch-shot.mjs' });
  assert.deepEqual(shotFonts(null), { fontsFailed: null, fontCheck: 'failed: no readable capture record (stitch-shot wrote no --json record — re-copy stitch-shot.mjs)' });
  assert.deepEqual(shotFonts(undefined, { missing: 'no live-shot.json beside live.png' }), { fontsFailed: null, fontCheck: 'failed: no live-shot.json beside live.png' });
});
check('fontsNotLoaded: the metas\' fontsFailed of both sides — sorted, unique; a meta without a list (null, absent, a crawl shot, a failed capture) adds none', () => {
  assert.deepEqual(fontsNotLoaded(live(['B', 'A']), live(['A'])), ['A', 'B']);
  assert.deepEqual(fontsNotLoaded({ instrument: 'crawl-fullpage' }, live(['Brand Sans'])), ['Brand Sans']);
  assert.deepEqual(fontsNotLoaded(live(null), live(['A'])), ['A'], 'null is not a family list');
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
// Sandbox: stardust/scripts/replica with the real gate-all.mjs and stubs for stitch-shot (writes the PNG and its --json
// record: fontsFailed = STUB_FONTS_<ORIGIN|EDS> as a comma list, null + fontCheck under STUB_FONTS_NULL_<side>, no record
// under STUB_NO_JSON_<side>; ORIGIN = a https://origin.example URL) and pixel-compare (a passing JSON). --no-probes: the
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
    const json = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
    const fonts = process.env['STUB_FONTS_NULL_' + side] ? { fontsFailed: null, fontCheck: 'failed: Execution context was destroyed' } : { fontsFailed: (process.env['STUB_FONTS_' + side] || '').split(',').filter(Boolean) };
    if (json && !process.env['STUB_NO_JSON_' + side]) writeFileSync(json, JSON.stringify({ url, out, width: 1440, vh: 900, settle: true, ...fonts, height: 2000 }, null, 2) + '\\n');
    console.log('overflow: scrollWidth=1440 viewport=1440 delta=0'); console.log('stitched ' + out);`);
  stub('pixel-compare.mjs', `console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 2000 }, pass: true, bands: [] }));`);
  const pages = (extra = {}) => ({ pages: [{ slug: 'a', url: 'https://origin.example/a', liveUrl: 'https://served.example/a', status: 'deployed', template: 't', fidelityTier: 'thin', ...extra }] });
  const runAll = (tag, args, env = {}, state = pages()) => {
    const out = join(root, `out-${tag}`); const stateFile = join(root, `state-${tag}.json`);
    writeFileSync(stateFile, JSON.stringify(state));
    const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), '--state', stateFile, '--out', out, '--no-probes', ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
    const read = (f) => (existsSync(join(out, f)) ? JSON.parse(readFileSync(join(out, f), 'utf8')) : null);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, summary: read('summary.json'), origin: read('a/origin.json'), eds: read('a/eds.json'), out };
  };
  try {
    check('runner: both stitches are asked for their --json record; the metas carry fontsFailed [] and the clean row passes (exit 0)', () => {
      const r = runAll('clean', []);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(r.out, 'a/origin-shot.json')) && existsSync(join(r.out, 'a/eds-shot.json')), 'the records are beside the captures');
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
      assert.deepEqual([row.pass, row.pixelOnlyPass, row.fontsNotLoaded, row.reasons], [false, true, ['Brand Sans', 'Brand Serif Fallback'], ['font-not-loaded:Brand Sans', 'font-not-loaded:Brand Serif Fallback']]);
      assert.match(readFileSync(join(r.out, 'summary.md'), 'utf8'), /fonts not loaded 1 \(Brand Sans, Brand Serif Fallback\)/);
      assert.match(readFileSync(join(r.out, 'summary.md'), 'utf8'), /FAIL \(fonts\)/);
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
      assert.equal(r.eds.fontsFailed, null); assert.match(r.eds.fontCheck, /^failed: no readable capture record \(stitch-shot wrote no --json record/);
      assert.deepEqual(r.summary.rows[0].reasons, ['font-check-skipped:build']);
    });
    check('runner (prototype stage): the archetype round\'s live.png is reused with the font check of its live-shot.json; none beside it is unchecked (font-check-skipped:origin, the fix named) — never "all loaded"', () => {
      const proto = pages({ prototypePath: 'stardust/prototypes/a.html' });
      const cached = join(root, 'stardust/replica/gates/a-1440'); mkdirSync(cached, { recursive: true });
      writeFileSync(join(cached, 'live.png'), 'png');
      const none = runAll('proto-none', ['--stage', 'prototype', '--proto-base', 'http://127.0.0.1:1'], {}, proto);
      assert.equal(none.status, 2, none.stderr);
      assert.equal(none.origin.fontsFailed, null);
      assert.match(none.origin.fontCheck, /^failed: no live-shot\.json beside .*live\.png \(a gate round before the font check\) — delete live\.png to re-take it$/);
      assert.match(none.origin.note, /^reused .*live\.png/);
      assert.deepEqual(none.summary.rows[0].reasons, ['font-check-skipped:origin']);
      writeFileSync(join(cached, 'live-shot.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: ['Brand Serif'], height: 2000 }));
      const some = runAll('proto-some', ['--stage', 'prototype', '--proto-base', 'http://127.0.0.1:1'], {}, proto);
      assert.equal(some.status, 2, some.stderr);
      assert.deepEqual([some.origin.fontsFailed, some.summary.rows[0].reasons], [['Brand Serif'], ['font-not-loaded:Brand Serif']], 'the cached capture\'s dead face fails the prototype row');
      writeFileSync(join(cached, 'live-shot.json'), JSON.stringify({ url: 'https://origin.example/a', fontsFailed: [], height: 2000 }));
      const clean = runAll('proto-clean', ['--stage', 'prototype', '--proto-base', 'http://127.0.0.1:1'], {}, proto);
      assert.equal(clean.status, 0, clean.stderr);
      assert.deepEqual([clean.origin.fontsFailed, clean.summary.rows[0].pass], [[], true]);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
