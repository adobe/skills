#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag, the reused cell); parseArgs
// defaults and --out derived from --width; --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff.
// Reuse under --skip-existing: probeReuse (the capture pair rule); then the CLI over stub instruments in a sandbox project.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSummary, parseArgs, probeReuse, verdict } from '../gate-all.mjs';

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

// ---- reuse under --skip-existing: probes while the capture pair holds
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
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

// ---- CLI over stub instruments (no browser, no network): the gate.test.mjs sandbox pattern — a realpath'd project
// with stardust/scripts/{replica,diff}.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-reuse-')));
const root = join(base, 'site'); const replica = join(root, 'stardust/scripts/replica'); const diffDir = join(root, 'stardust/scripts/diff');
const COUNT = join(base, 'count.txt'); const OUT = join(root, 'stardust/replica/gates/all-1440');
mkdirSync(replica, { recursive: true }); mkdirSync(diffDir, { recursive: true });
cpSync(SCRIPT, join(replica, 'gate-all.mjs'));
// Every instrument appends one line to STUB_COUNT; pixel-compare fails the slugs listed in STUB_FAIL.
writeFileSync(join(replica, 'stitch-shot.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
appendFileSync(process.env.STUB_COUNT, 'STITCH ' + (url.startsWith('https://origin.test') ? 'origin' : 'eds') + '\\n');
writeFileSync(out, 'png');`);
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
const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
put('stardust/state.json', JSON.stringify({ pages: [
  { slug: 'home', url: 'https://origin.test/', liveUrl: 'https://main--site--org.aem.page/', status: 'deployed', template: 'home' },
  { slug: 'about', url: 'https://origin.test/about', liveUrl: 'https://main--site--org.aem.page/about', status: 'deployed', template: 'page' }] }));

const gateAll = (args = [], env = {}) => {
  writeFileSync(COUNT, '');
  const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, STUB_COUNT: COUNT, STUB_FAIL: '', ...env } });
  const lines = readFileSync(COUNT, 'utf8').split('\n').filter(Boolean);
  const n = (f) => lines.filter(f).length;
  return { ...r, n: { origin: n((l) => l === 'STITCH origin'), eds: n((l) => l === 'STITCH eds'), probes: n((l) => l.startsWith('PROBE')), compares: n((l) => l === 'COMPARE') } };
};
const summary = () => JSON.parse(readFileSync(join(OUT, 'summary.json'), 'utf8'));
const row = (s, slug) => s.rows.find((x) => x.slug === slug);
const pageFile = (slug, f) => join(OUT, slug, f);
// summary.json apart from the reuse fields and timestamps (§ 9 item 1: byte-identical apart from reused / at).
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['reused', 'reusedRows', 'reusedProbes', 'reuse', 'at', 'writtenAt'].includes(k) ? undefined : x)));

let r = gateAll([], { STUB_FAIL: 'about' });
const run1 = existsSync(join(OUT, 'summary.json')) ? summary() : null;
check('run 1 (fresh): per page 2 stitches, 1 content probe, 1 compare; probes.json per page; rows reused null', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 2, eds: 2, probes: 2, compares: 2 });
  for (const slug of ['home', 'about']) { assert.ok(existsSync(pageFile(slug, 'probes.json')), slug); assert.equal(row(run1, slug).reused, null); }
  assert.deepEqual(run1._provenance.reuse, { rows: 0, probes: 0 });
});
r = gateAll(['--skip-existing'], { STUB_FAIL: 'about' });
check('run 2 --skip-existing: 0 stitches, 0 probes (replayed: the capture pair is unchanged), compares only; summary.json equal apart from reused/at', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  const s = summary();
  for (const slug of ['home', 'about']) assert.equal(row(s, slug).reused.what, 'probes');
  assert.equal(s.totals.reusedProbes, 2); assert.deepEqual(strip(s), strip(run1));
  assert.match(readFileSync(join(OUT, 'summary.md'), 'utf8'), /· reused: 0 rows, 2 probe sets/);
});
r = gateAll(['--skip-existing', '--recapture-eds']);
check('--recapture-eds: the EDS side only — EDS stitches + probes + compares, 0 origin stitches, nothing replayed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.equal(summary().totals.reusedProbes, 0);
});
for (const slug of ['home', 'about']) unlinkSync(pageFile(slug, 'probes.json'));
r = gateAll(['--skip-existing']);
check('a legacy gate dir (no probes.json): today\'s behaviour — captures reused, probes run', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 2, compares: 2 });
  assert.equal(summary().totals.reusedProbes, 0);
});
rmSync(base, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
