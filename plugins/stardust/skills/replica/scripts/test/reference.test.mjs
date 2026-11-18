#!/usr/bin/env node
// skills/replica/scripts/test/reference.test.mjs — reference.mjs. Without a browser: parseArgs and its usage errors,
// captureArgs, mergeBands, variableRegions (threshold, pad, merge, clamp), maskArg, the decision table, verdictLine,
// assess and freeze over stub captures / compares (prime discarded, baseline written in the shape stitch-shot's
// baselineStatus accepts, unstable → exit 2 and no baseline, --force, reuse without a capture, exit 3 passed through),
// status / mask / --help / usage in an empty cwd. End to end, where playwright, pngjs and pixelmatch are importable
// from the scripts dir and the machine has a non-loopback address (the shared live session — the jar priming relies
// on — skips loopback hosts): a LOCAL fixture server's stable page, first-visit banner, self-varying block and
// alternating layout.
// Run: node plugins/stardust/skills/replica/scripts/test/reference.test.mjs
/* eslint-disable no-restricted-syntax, no-await-in-loop, max-len, object-curly-newline */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, HELP, UsageError, WRITER, assess, captureArgs, decide, fontsDiffer, fontsOfRecord, freeze, main, maskArg, mergeBands, parseArgs, variableRegions, verdictLine } from '../reference.mjs';
import { baselineStatus } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'reference.mjs');
let checks = 0; let failed = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log(`ok    ${name}`); } catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').join('\n      ')}`); }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'reference-test-'));
const band = (y0, pct, h = 20) => ({ y0, y1: y0 + h, pct });

// ---- arguments ------------------------------------------------------------------------------------------------------
await check('parseArgs: freeze defaults, overlay flags, thresholds; usage errors', () => {
  const o = parseArgs(['freeze', 'https://x.test/', 'gates/home-1440', '--width', '1440']);
  assert.deepEqual([o.url, o.dir, o.width, o.captures, o.floorMax, o.heightMax, o.variableMax, o.band, o.bandMin, o.pad, o.force], ['https://x.test/', 'gates/home-1440', 1440, 2, 1, 8, 50, 20, 0.5, 8, false]);
  const p = parseArgs(['freeze', 'u', 'd', '--width', '390', '--consent', '#ok', '--dismiss', '.a,.b', '--locale', 'en-GB', '--vh', '700', '--captures', '3', '--floor-max', '0.5', '--force', '--headed']);
  assert.deepEqual(captureArgs(p), ['--width', '390', '--settle', '--vh', '700', '--consent', '#ok', '--dismiss', '.a,.b', '--locale', 'en-GB', '--headed']);
  assert.deepEqual([p.captures, p.floorMax, p.force], [3, 0.5, true]);
  assert.deepEqual(captureArgs(parseArgs(['freeze', 'u', 'd', '--width', '1440', '--no-dismiss'])), ['--width', '1440', '--settle', '--no-dismiss']);
  for (const bad of [[], ['thaw'], ['freeze', 'u'], ['freeze', 'u', 'd'], ['freeze', 'u', 'd', '--width'], ['freeze', 'u', 'd', '--width', 'wide'], ['freeze', 'u', 'd', '--width', '1440', '--captures', '4'],
    ['freeze', 'u', 'd', '--width', '1440', '--no-dismiss', '--consent', '#ok'], ['freeze', 'u', 'd', '--width', '1440', '--nope'], ['status'], ['mask', 'a', 'b'], ['assess', 'a.png'], ['assess', 'a', 'b', 'c', 'd']]) {
    assert.throws(() => parseArgs(bad), UsageError, bad.join(' '));
  }
  assert.deepEqual(parseArgs(['assess', 'a.png', 'b.png', 'c.png', '--band-min', '1']).pos, ['a.png', 'b.png', 'c.png']);
  assert.equal(parseArgs(['status', 'd', '--json']).json, true);
});

// ---- variable regions -------------------------------------------------------------------------------------------------
await check('variableRegions: threshold, pad, merge, clamp; mergeBands keeps the largest % per band', () => {
  assert.deepEqual(variableRegions([band(0, 0), band(20, 0.5), band(40, 0.4)]), [], 'a band AT the threshold is not variable');
  assert.deepEqual(variableRegions([band(100, 0), band(120, 3), band(140, 0)]), [{ y: 112, h: 36, pct: 3 }], 'one band, padded 8 rows each side');
  assert.deepEqual(variableRegions([band(120, 3), band(140, 9), band(160, 1)]), [{ y: 112, h: 76, pct: 9 }], 'adjacent bands merge; pct = the largest');
  assert.deepEqual(variableRegions([band(120, 3), band(160, 2)]), [{ y: 112, h: 76, pct: 3 }], 'padded ranges 4 rows apart merge');
  assert.deepEqual(variableRegions([band(120, 3), band(200, 2)]), [{ y: 112, h: 36, pct: 3 }, { y: 192, h: 36, pct: 2 }], 'far apart stay two');
  assert.deepEqual(variableRegions([band(0, 5), band(980, 5)], { height: 1000 }), [{ y: 0, h: 28, pct: 5 }, { y: 972, h: 28, pct: 5 }], 'clamped to the page');
  assert.deepEqual(variableRegions([band(120, 3)], { pad: 0, min: 2 }), [{ y: 120, h: 20, pct: 3 }]);
  assert.deepEqual(variableRegions([band(120, 3)], { min: 3 }), []);
  assert.deepEqual(variableRegions([band(200, 2), band(120, 3)]).map((r) => r.y), [112, 192], 'input order does not matter');
  assert.deepEqual(mergeBands([[band(0, 0), band(20, 1)], [band(0, 2), band(20, 0.3), band(40, 7)]]), [band(0, 2), band(20, 1), band(40, 7)]);
});

await check('maskArg: yA:h comma list pixel-compare parses; \'\' when none', () => {
  assert.equal(maskArg([]), '');
  assert.equal(maskArg([{ y: 3120, h: 520, pct: 9 }, { y: 5010, h: 190, pct: 2 }]), '3120:520,5010:190');
  for (const spec of maskArg([{ y: 0, h: 28 }, { y: 972, h: 28 }]).split(',')) assert.match(spec, /^(\d+):(\d+)$/);
});

// ---- the decision -----------------------------------------------------------------------------------------------------
await check('decide: the table', () => {
  assert.deepEqual(decide({ heights: [3000, 3000], outside: 0 }), { stable: true, reason: null });
  assert.equal(decide({ heights: [3000, 3008], outside: 0 }).stable, true, '8 px is within the bar');
  assert.deepEqual(decide({ heights: [3390, 2950], outside: 0 }), { stable: false, reason: 'heights 3390 vs 2950' });
  assert.equal(decide({ heights: [3000, 3009], outside: 0 }).stable, false);
  assert.equal(decide({ heights: [3000, 3009], outside: 0 }, { heightMax: 10 }).stable, true);
  assert.equal(decide({ heights: [3000, 3000], outside: 1 }).stable, true, 'at the bar');
  assert.match(decide({ heights: [3000, 3000], outside: 1.4 }).reason, /1\.4% still differs outside the variable regions \(bar 1%\)/);
  assert.equal(decide({ heights: [3000, 3000], outside: 1.4 }, { floorMax: 2 }).stable, true);
  assert.equal(decide({ heights: [3000, 3000], outside: 0.02, variableShare: 12 }).stable, true, 'noisy only inside the regions');
  assert.match(decide({ heights: [3000, 3000], outside: 0, variableShare: 80 }).reason, /80% of the rows differ/);
  assert.match(decide({ heights: [3000, 3000], outside: 0, fontsDiffer: 'Brand Sans vs none' }).reason, /dead font faces differ \(Brand Sans vs none\)/);
  // a face dead on the source is what the source serves: the same on every capture, it is recorded, not unstable
  assert.equal(fontsDiffer([{ fontsFailed: ['B', 'A'] }, { fontsFailed: ['A', 'B'] }]), null);
  assert.equal(fontsDiffer([{ fontsFailed: [] }, { fontsFailed: [] }]), null); assert.equal(fontsDiffer([{ fontsFailed: null }, {}]), null);
  assert.equal(fontsDiffer([{ fontsFailed: ['A'] }, { fontsFailed: [] }]), 'A vs none'); assert.equal(fontsDiffer([{ fontsFailed: [] }, { fontsFailed: null }]), 'none vs not checked');
  assert.deepEqual(fontsOfRecord({ fontsFailed: ['A'], deadFaces: ['a|400|normal'] }), { fontsFailed: ['A'], deadFaces: ['a|400|normal'] });
  assert.deepEqual(fontsOfRecord({ fontsFailed: null, fontCheck: 'failed: timeout' }), { fontsFailed: null, fontCheck: 'failed: timeout' }, 'a check that did not run is never []');
  assert.equal(fontsOfRecord({}).fontsFailed, null);
  assert.match(verdictLine({ stable: true, width: 1440, height: 3000, primed: true, noiseFloor: 0, variable: [], fontsFailed: ['Brand Sans'] }, 'frozen'), /dead on the source: Brand Sans/);
  assert.equal(decide({ heights: [3000, 3000, 3020], outside: 0 }).stable, false, 'three captures: the spread');
});

await check('verdictLine: frozen with regions, frozen clean, unstable, forced, a stitch-shot baseline', () => {
  const r = { width: 1440, height: 8757, primed: true, stable: true, noiseFloor: 2.31, outside: 0.02, variable: [{ y: 3120, h: 520, pct: 9 }, { y: 5010, h: 190, pct: 3 }], maskArg: '3120:520,5010:190' };
  assert.equal(verdictLine(r), 'reference: frozen 1440×8757, primed, noise floor 2.31% in 2 variable region(s) (rows 3120–3640, 5010–5200) → mask 3120:520,5010:190; outside them 0.02%');
  assert.equal(verdictLine({ ...r, noiseFloor: 0, variable: [], maskArg: '' }), 'reference: frozen 1440×8757, primed, noise floor 0.00%, no variable region');
  assert.equal(verdictLine({ primed: true, stable: false, reason: 'heights 3390 vs 2950' }), 'reference: UNSTABLE — heights 3390 vs 2950 after priming; not frozen');
  assert.match(verdictLine({ ...r, stable: false, forced: true, reason: 'heights 3390 vs 2950' }), /^reference: frozen 1440×8757.* \(FORCED, unstable: heights 3390 vs 2950\)$/);
  assert.match(verdictLine({ width: 1440, height: 900, stable: true, forced: true }, 'reused'), /^reference: reused 1440×900, noise floor not measured/);
});

// ---- orchestration over stubs -----------------------------------------------------------------------------------------
// heights per capture (prime first), a compare script keyed "a|b|mask" by file stem, and a log of what ran.
function stubs({ heights, compares, capture = () => 0, baseline = null }) {
  const log = []; let n = 0; const sizes = new Map();
  const stem = (p) => p.split('/').pop().replace('.png', '');
  return {
    log,
    size: (p) => ({ width: 1440, height: sizes.get(stem(p)) }),
    now: () => '2026-01-02T03:04:05.000Z',
    readJson: (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } },
    capture(url, png, o) {
      log.push(`capture ${stem(png)} ${captureArgs(o).join(' ')}`);
      const code = capture(stem(png));
      if (code !== 0) return code;
      const h = heights[n]; n += 1; sizes.set(stem(png), h);
      writeFileSync(png, `png ${stem(png)}`);
      writeFileSync(png.replace('.png', '.capture.json'), JSON.stringify({ url, width: o.width, vh: 900, height: h, chunks: 4, fontsFailed: [], fixedLayers: { capture: 'once', count: 0, late: 0 }, at: '2026-01-01T00:00:00.000Z' }));
      return 0;
    },
    compare(a, b, { mask }) {
      const key = `${stem(a)}|${stem(b)}|${mask || ''}`; log.push(`compare ${key}`);
      const r = compares[key] ?? compares[`${stem(a)}|${stem(b)}|*`];
      assert.ok(r, `unexpected compare ${key}`);
      return { heightDelta: sizes.has(stem(a)) ? sizes.get(stem(a)) - sizes.get(stem(b)) : 0, bands: [], ...r };
    },
    baselineCheck(dir, want) { const s = baseline ? baseline(dir, want) : baselineStatus(dir, want); return { ok: s.ok, line: s.ok ? String(s.provenance.capturedAt) : s.why }; },
  };
}
const opts = (dir, ...extra) => parseArgs(['freeze', 'https://x.test/', dir, '--width', '1440', ...extra]);

await check('freeze: primes, discards the prime, freezes ref-1 with a mask; stitch-shot\'s baselineStatus accepts the record; a second freeze reuses it', () => {
  const dir = tmp();
  try {
    const d = stubs({ heights: [4065, 3000, 3000], compares: { 'prime|ref-1|': { pct: 41.2 }, 'ref-1|ref-2|': { pct: 2.31, bands: [band(100, 0), band(120, 30), band(140, 22), band(900, 0.2)] }, 'ref-1|ref-2|112:56': { pct: 0.02 } } });
    const r = freeze(opts(dir, '--consent', '#ok'), d);
    assert.equal(r.code, 0);
    assert.equal(r.line, 'reference: frozen 1440×3000, primed, noise floor 2.31% in 1 variable region(s) (rows 112–168) → mask 112:56; outside them 0.02%');
    assert.deepEqual(d.log, ['capture prime --width 1440 --settle --consent #ok', 'capture ref-1 --width 1440 --settle --consent #ok', 'capture ref-2 --width 1440 --settle --consent #ok', 'compare prime|ref-1|', 'compare ref-1|ref-2|', 'compare ref-1|ref-2|112:56']);
    assert.deepEqual(readdirSync(dir).sort(), ['baseline.json', 'baseline.png', 'ref-1.capture.json', 'ref-1.png', 'ref-2.capture.json', 'ref-2.png']);
    assert.equal(readFileSync(join(dir, 'baseline.png'), 'utf8'), 'png ref-1');
    const b = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
    assert.deepEqual({ ...b, flags: undefined, thresholds: undefined }, { writtenBy: WRITER, schema: 1, capturedAt: '2026-01-01T00:00:00.000Z', url: 'https://x.test/', width: 1440, vh: 900, height: 3000, settle: true, chunks: 4, fontsFailed: [], fixedLayers: { capture: 'once', count: 0, late: 0 },
      primed: true, prime: { height: 4065, pct: 41.2, heightDelta: 1065 }, captures: 2, heights: [3000, 3000], noiseFloor: 2.31, heightSpread: 0, outside: 0.02, variable: [{ y: 112, h: 56, pct: 30 }], variableShare: 1.87, maskArg: '112:56', stable: true, reason: null, frozenAt: '2026-01-02T03:04:05.000Z', flags: undefined, thresholds: undefined });
    assert.deepEqual(b.flags, { consent: '#ok', dismiss: null, noDismiss: false, locale: null, vh: null, headed: false });
    assert.deepEqual(b.thresholds, { floorMax: DEFAULTS.floorMax, heightMax: DEFAULTS.heightMax, variableMax: DEFAULTS.variableMax, band: DEFAULTS.band, bandMin: DEFAULTS.bandMin, pad: DEFAULTS.pad });
    assert.equal(baselineStatus(dir, { url: 'https://x.test', width: 1440 }).ok, true, 'the existing reader accepts it');
    // idempotent: same URL and width → no capture, no compare
    const again = stubs({ heights: [], compares: {} });
    const r2 = freeze(opts(dir), again);
    assert.equal(r2.code, 0); assert.equal(r2.reused, true); assert.deepEqual(again.log, []);
    assert.match(r2.line, /^reference: reused 1440×3000, primed, noise floor 2\.31% in 1 variable region/);
    // another width is not this baseline: it captures again
    const other = stubs({ heights: [900, 900, 900], compares: { 'prime|ref-1|': { pct: 0 }, 'ref-1|ref-2|': { pct: 0 } } });
    assert.equal(freeze(parseArgs(['freeze', 'https://x.test/', dir, '--width', '390']), other).code, 0);
    assert.equal(other.log.length, 5);
    assert.equal(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).maskArg, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('freeze: heights differ → exit 2, no baseline, captures and reference-unstable.json stay; --force freezes it as stable: false', () => {
  const dir = tmp();
  try {
    const script = { heights: [3390, 3390, 2950], compares: { 'prime|ref-1|': { pct: 0 }, 'ref-1|ref-2|': { pct: 38 } } };
    const r = freeze(opts(dir), stubs(script));
    assert.equal(r.code, 2);
    assert.equal(r.line, 'reference: UNSTABLE — heights 3390 vs 2950 after priming; not frozen');
    assert.deepEqual(readdirSync(dir).sort(), ['ref-1.capture.json', 'ref-1.png', 'ref-2.capture.json', 'ref-2.png', 'reference-unstable.json']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'reference-unstable.json'), 'utf8')).heightSpread, 440);
    const f = freeze(opts(dir, '--force'), stubs(script));
    assert.equal(f.code, 0);
    assert.match(f.line, /^reference: frozen 1440×3390, primed, .*\(FORCED, unstable: heights 3390 vs 2950\)$/);
    assert.equal(existsSync(join(dir, 'reference-unstable.json')), false, 'the earlier report is cleared');
    assert.equal(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).stable, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('freeze: floor above the bar outside the regions → unstable; --floor-max moves the bar; three captures use every pair', () => {
  const dir = tmp();
  try {
    const compares = { 'prime|ref-1|': { pct: 0 }, 'ref-1|ref-2|': { pct: 0.4, bands: [band(0, 0.4)] }, 'ref-1|ref-3|': { pct: 3, bands: [band(400, 20)] }, 'ref-2|ref-3|': { pct: 3.2, bands: [band(400, 21), band(420, 1)] }, 'ref-1|ref-2|392:56': { pct: 0.4 }, 'ref-1|ref-3|392:56': { pct: 1.6 }, 'ref-2|ref-3|392:56': { pct: 1.2 } };
    const r = freeze(opts(dir, '--captures', '3'), stubs({ heights: [2000, 2000, 2000, 2004], compares }));
    assert.equal(r.code, 2);
    assert.equal(r.line, 'reference: UNSTABLE — 1.6% still differs outside the variable regions (bar 1%) after priming; not frozen');
    assert.deepEqual([r.result.noiseFloor, r.result.outside, r.result.heightSpread, r.result.captures], [3.2, 1.6, 4, 3]);
    assert.equal(existsSync(join(dir, 'baseline.json')), false);
    const ok = freeze(opts(dir, '--captures', '3', '--floor-max', '2'), stubs({ heights: [2000, 2000, 2000, 2004], compares }));
    assert.equal(ok.code, 0);
    assert.equal(ok.result.maskArg, '392:56');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('freeze: a bot challenge passes through as 3, a capture deadline as 124, another capture failure is 1 — nothing frozen, no compare', () => {
  const dir = tmp();
  try {
    const d = stubs({ heights: [900], compares: {}, capture: (s) => (s === 'ref-1' ? 3 : 0) });
    const r = freeze(opts(dir), d);
    assert.equal(r.code, 3); assert.match(r.line, /bot challenge/);
    assert.equal(freeze(opts(dir), stubs({ heights: [], compares: {}, capture: () => 1 })).code, 1);
    const late = freeze(opts(dir), stubs({ heights: [], compares: {}, capture: () => 124 }));
    assert.equal(late.code, 124, 'a capture over its deadline is the deadline exit, not an error'); assert.match(late.line, /priming capture exceeded its \d+s deadline \(exit 124/);
    assert.equal(existsSync(join(dir, 'baseline.png')), false);
    assert.equal(d.log.some((l) => l.startsWith('compare')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('assess: the same decision over given captures (no prime); the mask is re-measured; deterministic', () => {
  const d = stubs({ heights: [], compares: { 'a|b|': { pct: 5.63, bands: [band(0, 40), band(20, 0.2), band(4760, 3)] }, 'a|b|0:28,4752:36': { pct: 0 } } });
  d.size = () => ({ width: 1440, height: 6669 });
  const o = parseArgs(['assess', 'x/a.png', 'x/b.png']);
  const r = assess(o.pos, o, d, { diffDir: '/nowhere' });
  assert.deepEqual([r.stable, r.noiseFloor, r.outside, r.maskArg, r.variableShare], [true, 5.63, 0, '0:28,4752:36', 0.96]);
  assert.deepEqual(assess(o.pos, o, d, { diffDir: '/nowhere' }), r);
  assert.equal(verdictLine({ ...r, forced: false }, 'stable'), 'reference: stable 1440×6669, noise floor 5.63% in 2 variable region(s) (rows 0–28, 4752–4788) → mask 0:28,4752:36; outside them 0.00%');
});

await check('main: status / mask read the stored reference; none → exit 1; usage → 125', () => {
  const dir = tmp(); const lines = []; const log = console.log; const err = console.error;
  console.log = (s) => lines.push(s); console.error = (s) => lines.push(`E ${s}`);
  try {
    const d = stubs({ heights: [900, 900, 900], compares: { 'prime|ref-1|': { pct: 0 }, 'ref-1|ref-2|': { pct: 1, bands: [band(100, 9)] }, 'ref-1|ref-2|92:36': { pct: 0 } } });
    assert.equal(main(['status', dir], d), 1);
    assert.equal(main(['mask', dir], d), 1);
    assert.equal(main(['freeze', 'https://x.test/', dir, '--width', '1440'], d), 0);
    assert.equal(main(['status', dir], d), 0);
    assert.equal(main(['status', dir, '--json'], d), 0);
    assert.equal(main(['status', dir, '--width', '390'], d), 1, 'frozen at another width');
    assert.equal(main(['mask', dir], d), 0);
    assert.equal(main(['freeze', 'https://x.test/'], d), 125);
    assert.match(lines[0], /^reference: none — no frozen baseline in /);
    assert.equal(lines[1], '');
    assert.equal(lines[3], 'reference: frozen 1440×900, primed, noise floor 1.00% in 1 variable region(s) (rows 92–128) → mask 92:36; outside them 0.00%');
    assert.equal(JSON.parse(lines[4]).usable, true);
    assert.match(lines[5], /^reference: none — stale: /);
    assert.equal(lines[6], '92:36');
    assert.match(lines[7], /^E reference: freeze needs <url> <dir> \(--help\)$/);
  } finally { console.log = log; console.error = err; rmSync(dir, { recursive: true, force: true }); }
});

await check('--help in an empty cwd: exit 0, the usage, nothing written; a usage error is exit 125 before any I/O', () => {
  const cwd = tmp();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'freeze', '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), HELP);
    for (const word of ['freeze <url> <dir>', 'status <dir>', 'mask <dir>', 'assess <a.png>', '--floor-max', '--captures', 'Exit codes: 0', '125 usage']) assert.ok(HELP.includes(word), word);
    const bad = spawnSync(process.execPath, [SCRIPT, 'freeze', 'https://x.test/', 'out', '--captures', '2'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(bad.status, 125); assert.match(bad.stderr, /needs --width/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- end to end: local fixtures only --------------------------------------------------------------------------------
const pw = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('playwright'); await import('pngjs'); await import('pixelmatch');"], { cwd: dirname(SCRIPT), encoding: 'utf8' });
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
if (pw.status !== 0 || !lan) {
  console.log(`skip  end-to-end reference (${pw.status !== 0 ? 'playwright / pngjs / pixelmatch not importable from the scripts dir' : 'no non-loopback address: the shared live session skips loopback hosts'})`);
} else {
  const css = 'html,body{margin:0;font:16px/1.4 sans-serif}.b{height:450px;box-sizing:border-box;padding:20px}.b0{background:#e8eef7}.b1{background:#f7ede8}.b2{background:#e8f7ec}.b3{background:#f4e8f7}#banner{height:400px;background:#222;color:#fff}#spot{height:300px}#extra{height:440px;background:#fc0}';
  const bands = (from, to) => Array.from({ length: to - from }, (_, i) => `<section class="b b${(from + i) % 4}">Band ${from + i + 1}</section>`).join('');
  const doc = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title><style>${css}</style></head><body>${body}</body></html>`;
  const hits = {};
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x/').pathname;
    const n = hits[path] = (hits[path] || 0) + 1;
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    let body;
    if (path === '/stable') body = bands(0, 8);
    else if (path === '/banner') { // first visit (no cookie): a tall banner, and the cookie that removes it
      const seen = /(^|;\s*)seen=1/.test(req.headers.cookie || '');
      if (!seen) headers['set-cookie'] = 'seen=1; Path=/; Max-Age=86400';
      body = `${seen ? '' : '<div id="banner">First visit</div>'}${bands(0, 8)}`;
    } else if (path === '/varying') body = `${bands(0, 2)}<div id="spot" style="background:hsl(${(n * 97) % 360} 80% 45%)"></div>${bands(2, 8)}`; // rows 900–1200 change on every load
    else if (path === '/alternating') body = n % 2 ? `<div id="extra">Layout A</div>${bands(0, 6)}` : bands(0, 6);
    else { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, headers); res.end(doc(body));
  });
  await new Promise((r) => { server.listen(0, lan, r); });
  const base = `http://${lan}:${server.address().port}`;
  const run = (script, args, cwd) => new Promise((resolve) => {
    const child = spawn(process.execPath, [join(dirname(SCRIPT), script), ...args], { cwd });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out: out.trim(), err }));
  });
  // each case in its own cwd: the live session's jar is scoped to the working tree, so each starts as a first visit
  const freezeCase = async (path, ...extra) => {
    const cwd = tmp();
    const r = await run('reference.mjs', ['freeze', `${base}${path}`, 'ref', '--width', '800', '--vh', '600', ...extra], cwd);
    const read = (f) => { try { return JSON.parse(readFileSync(join(cwd, 'ref', f), 'utf8')); } catch { return null; } };
    return { ...r, cwd, dir: join(cwd, 'ref'), baseline: read('baseline.json'), report: read('reference-unstable.json') };
  };
  try {
    await check('e2e stable page: frozen, floor 0, no variable region; status and the reuse', async () => {
      const r = await freezeCase('/stable');
      try {
        assert.equal(r.code, 0, r.err);
        assert.equal(r.out, 'reference: frozen 800×3600, primed, noise floor 0.00%, no variable region');
        assert.deepEqual([r.baseline.stable, r.baseline.noiseFloor, r.baseline.variable, r.baseline.maskArg, r.baseline.prime.pct], [true, 0, [], '', 0]);
        assert.equal(baselineStatus(r.dir, { url: `${base}/stable`, width: 800 }).ok, true);
        const before = hits['/stable'];
        const again = await run('reference.mjs', ['freeze', `${base}/stable`, 'ref', '--width', '800'], r.cwd);
        assert.equal(again.code, 0); assert.match(again.out, /^reference: reused 800×3600/); assert.equal(hits['/stable'], before, 'no request');
        assert.equal((await run('reference.mjs', ['status', 'ref'], r.cwd)).out, 'reference: frozen 800×3600, primed, noise floor 0.00%, no variable region');
        assert.equal((await run('stitch-shot.mjs', ['baseline', 'ref', '--url', `${base}/stable`, '--width', '800'], r.cwd)).code, 0);
      } finally { rmSync(r.cwd, { recursive: true, force: true }); }
    });
    await check('e2e first-visit banner: the prime absorbs it — the unprimed capture is 400 px taller and differs, the frozen baseline is the banner-less page, two primed captures agree within 0.5%', async () => {
      const r = await freezeCase('/banner');
      try {
        assert.equal(r.code, 0, r.err);
        assert.equal(r.out, 'reference: frozen 800×3600, primed, noise floor 0.00%, no variable region');
        assert.equal(r.baseline.prime.height, 4000); assert.equal(r.baseline.prime.heightDelta, 400);
        assert.ok(r.baseline.prime.pct > 4, `the first visit differs (${r.baseline.prime.pct}%)`);
        assert.ok(r.baseline.noiseFloor <= 0.5); assert.deepEqual(r.baseline.heights, [3600, 3600]);
        assert.equal(existsSync(join(r.dir, 'prime.png')), false, 'the prime is discarded');
      } finally { rmSync(r.cwd, { recursive: true, force: true }); }
    });
    await check('e2e self-varying block: frozen, stable, exactly one region covering rows 900–1200, and two fresh captures compared WITH the mask read 0', async () => {
      const r = await freezeCase('/varying');
      try {
        assert.equal(r.code, 0, r.err);
        assert.equal(r.baseline.stable, true); assert.equal(r.baseline.variable.length, 1);
        const [v] = r.baseline.variable;
        assert.ok(v.y <= 900 && v.y >= 872 && v.y + v.h >= 1200 && v.y + v.h <= 1228, JSON.stringify(v));
        assert.equal(r.baseline.maskArg, `${v.y}:${v.h}`);
        assert.ok(r.baseline.noiseFloor > 5 && r.baseline.outside === 0, JSON.stringify(r.baseline));
        assert.equal((await run('reference.mjs', ['mask', 'ref'], r.cwd)).out, r.baseline.maskArg);
        for (const n of ['x', 'y']) assert.equal((await run('stitch-shot.mjs', [`${base}/varying`, `${n}.png`, '--width', '800', '--vh', '600', '--settle'], r.cwd)).code, 0);
        const cmp = async (...mask) => JSON.parse((await run('pixel-compare.mjs', ['x.png', 'y.png', '--json', '--threshold', '100', '--out', 'd.png', ...mask], r.cwd)).out).pct;
        assert.ok(await cmp() > 5); assert.equal(await cmp('--mask', r.baseline.maskArg), 0);
        const a = await run('reference.mjs', ['assess', 'x.png', 'y.png'], r.cwd);
        assert.equal(a.code, 0); assert.ok(a.out.endsWith(`→ mask ${r.baseline.maskArg}; outside them 0.00%`), a.out);
      } finally { rmSync(r.cwd, { recursive: true, force: true }); }
    });
    await check('e2e alternating layouts: UNSTABLE, exit 2, nothing frozen, the captures and the report stay', async () => {
      const r = await freezeCase('/alternating');
      try {
        assert.equal(r.code, 2, r.err);
        assert.match(r.out, /^reference: UNSTABLE — heights (2700 vs 3140|3140 vs 2700) after priming; not frozen$/);
        assert.equal(r.baseline, null); assert.equal(existsSync(join(r.dir, 'baseline.png')), false);
        assert.equal(r.report.stable, false); assert.equal(r.report.heightSpread, 440);
        assert.ok(existsSync(join(r.dir, 'ref-1.png')) && existsSync(join(r.dir, 'ref-2.png')));
        assert.equal((await run('reference.mjs', ['status', 'ref'], r.cwd)).code, 1);
      } finally { rmSync(r.cwd, { recursive: true, force: true }); }
    });
  } finally { server.close(); }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nreference: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
