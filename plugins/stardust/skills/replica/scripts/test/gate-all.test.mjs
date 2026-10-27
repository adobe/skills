#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag); parseArgs defaults and
// --out derived from --width; --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff; staleCapture (a
// capture with no fixedLayers in its record is retaken, gate.sh's rule); disk (#150): a passed page keeps its records,
// not its PNGs, and --skip-existing reuses that recorded pass — a run with stub instruments, no browser.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRecordOf, droppedPass, dropPassedCaptures, formatSummary, parseArgs, staleCapture, verdict } from '../gate-all.mjs';

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
// ---- disk (#150): a passed page keeps its records, not its pictures ---------------------------------------------
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
check('droppedPass: the records for the same masks and eds URL; null when either changed, nothing was dropped or a record is gone', () => {
  const d = pageDir(RECORDS);
  try {
    const at = { masks: ['0:100'], edsUrl: 'https://eds.example/a' };
    assert.equal(droppedPass(d, at), null, 'never dropped');
    dropPassedCaptures(d, at);
    const kept = droppedPass(d, at);
    assert.equal(kept.pixel.pct, 1.2); assert.equal(kept.origin.instrument, 'stitch-live'); assert.equal(kept.eds.url, 'https://eds.example/a');
    assert.equal(droppedPass(d, { ...at, masks: [] }), null, 'mask removed');
    assert.equal(droppedPass(d, { ...at, edsUrl: 'https://branch.example/a' }), null, 'another eds host');
    rmSync(join(d, 'origin.json'));
    assert.equal(droppedPass(d, at), null, 'origin record gone');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
check('a run with stub instruments: the passed page loses its PNGs, the failed one keeps them; --skip-existing and --compare-only reuse the recorded pass without a capture; a changed mask re-captures', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
  try {
    const rep = join(root, 'stardust/scripts/replica');
    mkdirSync(rep, { recursive: true });
    copyFileSync(SCRIPT, join(rep, 'gate-all.mjs'));
    cpSync(join(HERE, '../../../diff/scripts'), join(root, 'stardust/scripts/diff'), { recursive: true });
    writeFileSync(join(rep, 'stitch-shot.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2); appendFileSync(process.env.STUB_LOG, url + '\\n');
writeFileSync(out, 'png'); writeFileSync(out.replace(/\\.png$/, '.capture.json'), JSON.stringify({ fixedLayers: { capture: 'once', count: 0 } }));\n`);
    writeFileSync(join(rep, 'pixel-compare.mjs'), `import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2); writeFileSync(a[a.indexOf('--out') + 1], 'png');
const pct = a[0].includes('/bad/') ? 30 : 1;
console.log(JSON.stringify({ pct, heightDelta: 0, compared: { width: 1440, height: 5000 }, pass: pct <= 10 }));\n`);
    const page = (slug) => ({ slug, url: `https://origin.example/${slug}`, status: 'deployed', liveUrl: `https://eds.example/${slug}` });
    writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ pages: [page('good'), page('bad')] }));
    const out = join(root, 'stardust/replica/gates/all-1440');
    const log = join(root, 'stitch.log');
    const gateAll = (...args) => { writeFileSync(log, ''); return spawnSync(process.execPath, [join(rep, 'gate-all.mjs'), '--no-probes', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, STUB_LOG: log } }); };
    const shots = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).sort();
    const pngs = (slug) => readdirSync(join(out, slug)).filter((f) => f.endsWith('.png')).sort();
    const rows = () => Object.fromEntries(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).rows.map((r) => [r.slug, r]));

    let r = gateAll();
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(pngs('good'), [], 'the passed page keeps no PNG');
    assert.deepEqual(pngs('bad'), ['diff.png', 'eds.png', 'origin.png'], 'the failed page keeps its captures and diff');
    assert.ok(existsSync(join(out, 'good/pixel.json')) && existsSync(join(out, 'good/origin.json')) && existsSync(join(out, 'good/eds.json')));
    assert.equal(rows().good.pass, true); assert.equal(rows().bad.pass, false);

    r = gateAll('--skip-existing');
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(shots(), [], 'nothing re-captured: the pass is reused, the failed page reuses its captures');
    assert.equal(rows().good.pass, true); assert.equal(rows().good.pct, 1);
    assert.match(r.stdout, /good → recorded pass reused/);

    r = gateAll('--compare-only');
    assert.equal(r.status, 2, r.stderr);
    assert.equal(rows().good.pass, true, 'compare-only reads the recorded pass, not a missing capture');

    writeFileSync(join(out, 'masks.json'), JSON.stringify({ good: { masks: ['0:100'], reason: 'a rotating banner' } }));
    r = gateAll('--skip-existing');
    assert.deepEqual(shots(), ['https://eds.example/good', 'https://origin.example/good'], 'a changed mask re-captures both sides');
    assert.equal(rows().good.pass, true);
    assert.deepEqual(pngs('good'), [], 'and drops them again on the pass');
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
