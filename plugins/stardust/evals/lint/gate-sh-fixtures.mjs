#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/gate.sh orchestration contracts and
// progress-record.mjs, without a browser.
//
// Why: gate.sh is the one command a replica round runs, and its contracts
// (reference freshness / live drift, the self-noise floor, the round record,
// the mechanical iteration cap, the ledger copy) are bash + node glue around
// three instruments that need Chromium and pixelmatch. The runner copies
// gate.sh, run-capped.mjs and progress-record.mjs next to STUB instruments
// (evals/lint/fixtures/gate-sh/) that emit the real sidecar and --json
// shapes, serves a build page for the identity assertion, and asserts:
//   freshness — a fresh reference is never re-probed; one older than
//     GATE_REF_MAX_AGE_H gets ONE anchor probe and is kept within the bounded
//     threshold (recorded in freshness.json); --refresh + a taller live doc →
//     LIVE DRIFT invalidates live.png(.json), anchor-live.json and
//     chrome-live.json together, stores the probe as anchor-live.json,
//     records liveDrift{} and does not count the round; a probe deadline (124)
//     skips the check — no recapture, no FAIL;
//   variance — --variance captures live-b once, writes variance.json, prints
//     the noise floor and records noiseFloor{} without changing the verdict;
//     its Δh bounds the drift threshold;
//   cap — default labels iter<k> never collide (a no-verdict round keeps its
//     label and does not count); the 4th counted round exits 6 before any
//     capture; --over-cap <reason> runs it and lands overCap; a bad reason and
//     a duplicate label exit 125; --invalidate excludes a record; NO-OP is
//     printed when differing pixels did not move;
//   record — --record upserts breakpoints.<w> (prototype) / published.<w>
//     (published-origin) for the matching page type and prints-only when the
//     archetype has no page type; progress-record --help exits 0;
//   --help exits 0.
//
// Usage: node plugins/stardust/evals/lint/gate-sh-fixtures.mjs  (exit 1 on findings)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SCRIPTS = join(HERE, '..', '..', 'skills', 'replica', 'scripts');
const STUBS = join(HERE, 'fixtures', 'gate-sh');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const work = mkdtempSync(join(tmpdir(), 'gate-sh-fixtures-'));
const bin = join(work, 'scripts', 'replica');
mkdirSync(bin, { recursive: true });
for (const f of ['gate.sh', 'run-capped.mjs', 'progress-record.mjs']) cpSync(join(SCRIPTS, f), join(bin, f));
for (const f of ['stitch-shot.mjs', 'anchor.mjs', 'pixel-compare.mjs']) cpSync(join(STUBS, f), join(bin, f));
const project = join(work, 'project');
mkdirSync(join(project, 'stardust', 'replica'), { recursive: true });

// The build page is served from a CHILD process: spawnSync blocks this
// process's event loop, so an in-process server would never answer gate.sh's
// identity curl.
const server = spawn(process.execPath, ['-e', `
  const s = require('node:http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body><h1>fresh drift noise cap rec orphan proposed</h1></body></html>'); });
  s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port)));
`], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((r) => { server.stdout.once('data', (d) => r(String(d).trim())); });
const BUILD = `http://127.0.0.1:${port}/proposed.html`;
const LIVE = 'https://example.test/';
const dirOf = (slug) => join(project, 'stardust', 'replica', 'gates', `${slug}-1440`);

const gate = (slug, args = [], env = {}) => {
  const r = spawnSync('bash', [join(bin, 'gate.sh'), slug, LIVE, BUILD, '1440', ...args], {
    cwd: project, encoding: 'utf8', env: { ...process.env, GATE_REAP_MIN: '0', ...env },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
const sidecar = (slug) => join(dirOf(slug), 'live.png.json');
const setCapturedAt = (slug, iso) => { const j = readJson(sidecar(slug)); j.capturedAt = iso; writeFileSync(sidecar(slug), JSON.stringify(j, null, 2)); };
const liveCapturedAt = (slug) => readJson(sidecar(slug))?.capturedAt;
const rec = (slug, label) => readJson(join(dirOf(slug), `gate-${label}.json`));

try {
  // --help
  const help = spawnSync('bash', [join(bin, 'gate.sh'), '--help'], { encoding: 'utf8' });
  check(help.status === 0 && /Usage:/.test(help.stdout) && /--refresh/.test(help.stdout) && /--over-cap/.test(help.stdout), 'gate.sh --help must exit 0 and print the usage incl. --refresh and --over-cap');
  const prHelp = spawnSync(process.execPath, [join(bin, 'progress-record.mjs'), '--help'], { encoding: 'utf8' });
  check(prHelp.status === 0 && /Usage:/.test(prHelp.stdout), 'progress-record --help must exit 0');

  // ---- freshness (slug fresh) ----
  let r = gate('fresh');
  if (r.status !== 0) throw new Error(`fresh round 1: expected exit 0, got ${r.status}\n${r.out}`);
  const f1 = rec('fresh', 'iter1');
  check(f1?.verdict === 'PASS' && f1.regime === 'prototype' && f1.ref?.capturedAt === liveCapturedAt('fresh') && f1.iteration === 1, 'round 1: default label iter1, verdict PASS, regime prototype, ref.capturedAt from the sidecar, iteration 1');
  check(!f1?.liveDrift && !f1?.freshness && !f1?.noiseFloor && typeof f1?.at === 'string', 'round 1: no drift/freshness/noise keys on a fresh reference; `at` stamped');
  const ts1 = liveCapturedAt('fresh');
  r = gate('fresh', [], { STUB_LIVE_DOC: '9999', STUB_DIFFPX: '900' });
  check(r.status === 0 && !/anchor probe/.test(r.out) && liveCapturedAt('fresh') === ts1 && rec('fresh', 'iter2')?.iteration === 2, `fresh reference must not be probed or recaptured; label iter2\n${r.out}`);
  setCapturedAt('fresh', hoursAgo(30));
  const ts2 = liveCapturedAt('fresh');
  r = gate('fresh', [], { STUB_LIVE_DOC: '3010', STUB_DIFFPX: '800' });
  check(r.status === 0 && /fresh-checked/.test(r.out) && existsSync(join(dirOf('fresh'), 'freshness.json')), `stale reference within threshold must be kept and recorded\n${r.out}`);
  check(rec('fresh', 'iter3')?.freshness?.deltaPx === 10 && liveCapturedAt('fresh') === ts2, 'record.freshness.deltaPx is the probe delta; no recapture within threshold');
  r = gate('fresh', ['--over-cap', 'canon-followup'], { STUB_LIVE_DOC: '3010', STUB_DIFFPX: '700' });
  check(r.status === 0 && !/anchor probe/.test(r.out) && rec('fresh', 'iter4')?.overCap === 'canon-followup', `a recent freshness check suppresses the next probe; --over-cap runs the 4th round and lands overCap\n${r.out}`);

  // ---- drift (slug drift) ----
  r = gate('drift');
  check(r.status === 0, `drift round 1 must pass\n${r.out}`);
  const D = dirOf('drift');
  writeFileSync(join(D, 'chrome-live.json'), '{"stale":true}');
  writeFileSync(join(D, 'anchor-live.json'), JSON.stringify({ key: { url: LIVE, width: 1440, main: 'main' }, probedAt: hoursAgo(30), data: { doc: 3000, sections: [1, 2, 3, 4] } }));
  const before = liveCapturedAt('drift');
  r = gate('drift', ['--refresh'], { STUB_LIVE_DOC: '3400', STUB_LIVE_SECTIONS: '5' });
  check(r.status === 0 && /LIVE DRIFT Δh \+400px/.test(r.out) && /sections 4→5/.test(r.out) && /not counted/.test(r.out), `drift must print LIVE DRIFT with Δh, section counts and 'not counted'\n${r.out}`);
  check(liveCapturedAt('drift') !== before && !existsSync(join(D, 'chrome-live.json')), 'drift must recapture live.png and delete chrome-live.json with it');
  const anchorCache = readJson(join(D, 'anchor-live.json'));
  check(anchorCache?.data?.doc === 3400 && anchorCache.data.sections.length === 5 && anchorCache.key.url === LIVE, 'drift must store the fresh probe as anchor-live.json (anchor --cache format)');
  const d2 = rec('drift', 'iter2');
  check(d2?.liveDrift?.recaptured === true && d2.liveDrift.docBefore === 3000 && d2.liveDrift.docAfter === 3400 && d2.liveDrift.previousCapturedAt === before && d2.counted === false && d2.iteration === undefined, 'record.liveDrift carries before/after heights + previous capturedAt; the round is not counted');
  const ts5 = liveCapturedAt('drift');
  r = gate('drift', ['--refresh'], { STUB_ANCHOR_EXIT: '124', STUB_LIVE_DOC: '9000' });
  check(r.status === 0 && /drift check skipped/.test(r.out) && /deadline/.test(r.out) && liveCapturedAt('drift') === ts5, `a 124 on the probe must skip the check, never recapture or FAIL\n${r.out}`);
  const d3 = rec('drift', 'iter3');
  check(d3 && !d3.liveDrift && d3.iteration === 2, 'skipped probe: no liveDrift; the round counts as iteration 2 (the drift round did not)');

  // ---- variance (slug noise) ----
  r = gate('noise', ['--variance'], { STUB_PCT: '12', STUB_HDELTA: '700', STUB_BAND0: '3.5' });
  check(r.status === 2, `--variance must not change the verdict: pct 12 stays FAIL (exit 2), got ${r.status}\n${r.out}`);
  const N = dirOf('noise');
  check(existsSync(join(N, 'live-b.png')) && existsSync(join(N, 'variance.json')), '--variance must capture live-b.png and write variance.json');
  check(/noise floor 12 %/.test(r.out) && /--mask 0:500/.test(r.out) && /never subtracted/.test(r.out), `noise floor line must print the floor, hot-band mask suggestions and the never-subtracted rule\n${r.out}`);
  const n1 = rec('noise', 'iter1');
  check(n1?.noiseFloor?.pixelPct === 12 && n1.pixelPct === 12 && n1.verdict === 'FAIL', 'record.noiseFloor recorded beside the raw pixelPct; verdict from the raw number');
  const liveB = statSync(join(N, 'live-b.png.json')).mtimeMs;
  r = gate('noise', ['--variance'], { STUB_PCT: '4' });
  check(r.status === 0 && statSync(join(N, 'live-b.png.json')).mtimeMs === liveB && /noise floor/.test(r.out), `variance is recorded once per gate dir and printed on later rounds\n${r.out}`);
  const ts8 = liveCapturedAt('noise');
  r = gate('noise', ['--refresh'], { STUB_LIVE_DOC: '3500', STUB_LIVE_SECTIONS: '5', STUB_PCT: '4' });
  check(r.status === 0 && /within 700px/.test(r.out) && liveCapturedAt('noise') === ts8, `self-noise Δh must bound the drift threshold (Δ500 ≤ 700 → keep)\n${r.out}`);

  // ---- cap (slug cap) ----
  r = gate('cap', [], { STUB_DIFFPX: '1000' });
  check(r.status === 0 && rec('cap', 'iter1')?.iteration === 1 && !/NO-OP/.test(r.out), `cap round 1\n${r.out}`);
  r = gate('cap', [], { STUB_DIFFPX: '1000' });
  check(r.status === 0 && /NO-OP/.test(r.out) && rec('cap', 'iter2')?.noOp?.vs === 'iter1', `unchanged differing pixels must print NO-OP and record noOp.vs\n${r.out}`);
  r = gate('cap', [], { STUB_COMPARE_EXIT: '124', STUB_DIFFPX: '500' });
  check(r.status === 124 && /not counted/.test(r.out) && rec('cap', 'iter3')?.verdict === 'no-verdict', `a 124 round keeps its label iter3, verdict no-verdict, not counted\n${r.out}`);
  r = gate('cap', [], { STUB_DIFFPX: '500' });
  check(r.status === 0 && rec('cap', 'iter4')?.iteration === 3 && !/NO-OP/.test(r.out), `default label skips the used iter3 → iter4, counted as iteration 3\n${r.out}`);
  const C = dirOf('cap');
  const buildBefore = statSync(join(C, 'build.png.json')).mtimeMs;
  r = gate('cap', []);
  check(r.status === 6 && /cap reached: 3\/3/.test(r.out) && /--over-cap/.test(r.out) && /Residual classes/.test(r.out), `4th counted round must exit 6 with the decision pointer\n${r.out}`);
  check(statSync(join(C, 'build.png.json')).mtimeMs === buildBefore && !existsSync(join(C, 'gate-iter5.json')), 'exit 6 must happen before any capture and write no record');
  r = gate('cap', ['--over-cap', 'bogus']);
  check(r.status === 125, `an unknown --over-cap reason must exit 125, got ${r.status}`);
  r = gate('cap', ['iter1']);
  check(r.status === 125 && /already exists/.test(r.out), `an explicit duplicate label must exit 125\n${r.out}`);
  r = gate('cap', ['--over-cap', 'source-inconsistent'], { STUB_DIFFPX: '400' });
  check(r.status === 0 && rec('cap', 'iter5')?.overCap === 'source-inconsistent' && rec('cap', 'iter5').iteration === 4 && /over-cap: source-inconsistent/.test(r.out), `--over-cap runs the round and records overCap\n${r.out}`);
  r = gate('cap', ['--invalidate', 'iter2', 'consent dialog present in the build capture']);
  check(r.status === 0 && /counted rounds now 3\/3 \(excluded: 1\)/.test(r.out) && rec('cap', 'iter2')?.excluded?.reason === 'consent dialog present in the build capture', `--invalidate must mark the record excluded and reprint the count\n${r.out}`);
  r = gate('cap', ['--invalidate', 'nope', 'x']);
  check(r.status === 1, `--invalidate on a missing record must exit 1, got ${r.status}`);
  r = gate('cap', ['--invalidate', 'iter4', 'stale server']);
  r = gate('cap', [], { STUB_DIFFPX: '300' });
  check(r.status === 0 && rec('cap', 'iter6')?.iteration === 3, `after two exclusions the next default label is the free iter6 and counts as iteration 3\n${r.out}`);

  // ---- --record (slug rec, orphan) ----
  const progress = join(project, 'stardust', 'replica', 'progress.json');
  writeFileSync(progress, JSON.stringify({ captureState: { consent: 'accept' }, pageTypes: { landing: { archetype: 'rec', breakpoints: { 1440: { residuals: [{ cause: 'capture-state' }] } } } }, note: 'free-form' }, null, 2));
  r = gate('rec', ['--record'], { STUB_PCT: '5', STUB_HDELTA: '3' });
  let pj = readJson(progress);
  const bp = pj?.pageTypes?.landing?.breakpoints?.['1440'];
  check(r.status === 0 && bp?.iterations === 1 && bp.result?.pass === true && bp.result.pixelPct === 5 && bp.result.heightDelta === 3 && bp.result.regime === 'prototype' && /gate-iter1\.json$/.test(bp.record), `--record must upsert breakpoints.1440 with iterations/result/record\n${r.out}\n${JSON.stringify(pj)}`);
  check(bp?.residuals?.[0]?.cause === 'capture-state' && pj.note === 'free-form' && pj.captureState?.consent === 'accept', '--record must preserve the rest of the ledger');
  r = gate('rec', ['--record', '--regime', 'published-origin'], { STUB_PCT: '7' });
  pj = readJson(progress);
  check(r.status === 0 && pj.pageTypes.landing.published?.['1440']?.result?.regime === 'published-origin' && pj.pageTypes.landing.published['1440'].url === BUILD && pj.pageTypes.landing.breakpoints['1440'].iterations === 1, `published-origin --record writes published.1440 and leaves breakpoints.1440 alone\n${r.out}`);
  const size = statSync(progress).size;
  r = gate('orphan', ['--record']);
  check(r.status === 0 && /no page type .* has archetype "orphan"/.test(r.out) && /would be:/.test(r.out) && statSync(progress).size === size, `--record with no matching page type must print the block and write nothing\n${r.out}`);
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) { console.error(`gate-sh-fixtures: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('gate-sh-fixtures: ok (freshness probe, live drift + cache invalidation, probe deadline, noise floor, iteration cap / --over-cap / --invalidate / NO-OP, --record ledger copy, --help)');
