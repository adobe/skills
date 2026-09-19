#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/gate.sh orchestration contracts,
// without a browser.
//
// Why: gate.sh is the one command a replica round runs, and its contracts
// (reference freshness / live drift, the self-noise floor, the round record)
// are bash + node glue around three instruments that need Chromium and
// pixelmatch. The runner copies gate.sh and run-capped.mjs next to STUB
// instruments (evals/lint/fixtures/gate-sh/) that emit the real sidecar and
// --json shapes, serves a build page for the identity assertion, and asserts:
//   (1) a fresh reference is never re-probed (hit minimisation);
//   (2) a reference older than GATE_REF_MAX_AGE_H gets ONE anchor probe; within
//       the bounded threshold it is kept and the check is recorded;
//   (3) --refresh + a taller live doc → LIVE DRIFT: live.png(.json),
//       anchor-live.json and chrome-live.json are invalidated together, the
//       fresh probe becomes anchor-live.json, liveDrift{} lands in the record;
//   (4) a probe deadline (124) skips the check — no recapture, no FAIL;
//   (5) recorded self-noise Δh bounds the drift threshold;
//   (6) --variance captures live-b once, writes variance.json, prints the
//       noise floor, records noiseFloor{} and never changes the verdict;
//   (7) --help exits 0.
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
for (const f of ['gate.sh', 'run-capped.mjs']) cpSync(join(SCRIPTS, f), join(bin, f));
for (const f of ['stitch-shot.mjs', 'anchor.mjs', 'pixel-compare.mjs']) cpSync(join(STUBS, f), join(bin, f));
const project = join(work, 'project');
mkdirSync(project, { recursive: true });

// The build page is served from a CHILD process: spawnSync blocks this
// process's event loop, so an in-process server would never answer gate.sh's
// identity curl.
const server = spawn(process.execPath, ['-e', `
  const s = require('node:http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body><h1>home proposed</h1></body></html>'); });
  s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port)));
`], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((r) => { server.stdout.once('data', (d) => r(String(d).trim())); });
const BUILD = `http://127.0.0.1:${port}/home-proposed.html`;
const LIVE = 'https://example.test/';
const DIR = join(project, 'stardust', 'replica', 'gates', 'home-1440');

const gate = (args = [], env = {}) => {
  const r = spawnSync('bash', [join(bin, 'gate.sh'), 'home', LIVE, BUILD, '1440', ...args], {
    cwd: project, encoding: 'utf8', env: { ...process.env, GATE_REAP_MIN: '0', ...env },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
const setCapturedAt = (iso) => { const p = join(DIR, 'live.png.json'); const j = readJson(p); j.capturedAt = iso; writeFileSync(p, JSON.stringify(j, null, 2)); };
const liveCapturedAt = () => readJson(join(DIR, 'live.png.json'))?.capturedAt;

try {
  // (7) --help
  const help = spawnSync('bash', [join(bin, 'gate.sh'), '--help'], { encoding: 'utf8' });
  check(help.status === 0 && /Usage:/.test(help.stdout) && /--refresh/.test(help.stdout), '--help must exit 0 and print the usage incl. --refresh');

  // first round: capture, record, no drift keys
  let r = gate(['iter1']);
  if (r.status !== 0) throw new Error(`round 1: expected exit 0, got ${r.status}\n${r.out}`);
  const rec1 = readJson(join(DIR, 'gate-iter1.json'));
  check(rec1?.verdict === 'PASS' && rec1.regime === 'prototype' && rec1.ref?.capturedAt === liveCapturedAt(), 'round 1: record must carry verdict PASS, regime prototype and ref.capturedAt from the sidecar');
  check(!rec1?.liveDrift && !rec1?.freshness && !rec1?.noiseFloor && typeof rec1?.at === 'string', 'round 1: no drift/freshness/noise keys on a fresh reference; `at` stamped');

  // (1) fresh reference → no probe
  const ts1 = liveCapturedAt();
  r = gate(['iter2'], { STUB_LIVE_DOC: '9999' });
  check(r.status === 0 && !/anchor probe/.test(r.out) && liveCapturedAt() === ts1, `fresh reference must not be probed or recaptured\n${r.out}`);

  // (2) stale reference, same height → one probe, kept, freshness.json
  setCapturedAt(hoursAgo(30));
  const ts2 = liveCapturedAt();
  r = gate(['iter3'], { STUB_LIVE_DOC: '3010' });
  check(r.status === 0 && /fresh-checked/.test(r.out) && existsSync(join(DIR, 'freshness.json')), `stale reference within threshold must be kept and recorded\n${r.out}`);
  check(readJson(join(DIR, 'gate-iter3.json'))?.freshness?.deltaPx === 10, 'record.freshness.deltaPx must be the probe delta');
  check(liveCapturedAt() === ts2 && !existsSync(join(DIR, 'live-b.png')), 'within-threshold check must not recapture');
  r = gate(['iter4'], { STUB_LIVE_DOC: '3010' });
  check(r.status === 0 && !/anchor probe/.test(r.out), `a recent freshness check must suppress the next probe\n${r.out}`);

  // (3) --refresh + drift → all three caches invalidated together, probe stored, liveDrift recorded
  writeFileSync(join(DIR, 'chrome-live.json'), '{"stale":true}');
  writeFileSync(join(DIR, 'anchor-live.json'), JSON.stringify({ key: { url: LIVE, width: 1440, main: 'main' }, probedAt: hoursAgo(30), data: { doc: 3000, sections: [1, 2, 3, 4] } }));
  const before = liveCapturedAt();
  r = gate(['iter5', '--refresh'], { STUB_LIVE_DOC: '3400', STUB_LIVE_SECTIONS: '5' });
  check(r.status === 0 && /LIVE DRIFT Δh \+400px/.test(r.out) && /sections 4→5/.test(r.out), `drift must print LIVE DRIFT with Δh and section counts\n${r.out}`);
  check(liveCapturedAt() !== before, 'drift must recapture live.png (new sidecar capturedAt)');
  check(!existsSync(join(DIR, 'chrome-live.json')), 'drift must delete chrome-live.json together with live.png');
  const anchorCache = readJson(join(DIR, 'anchor-live.json'));
  check(anchorCache?.data?.doc === 3400 && anchorCache.data.sections.length === 5 && anchorCache.key.url === LIVE, 'drift must store the fresh probe as anchor-live.json (anchor --cache format)');
  const rec5 = readJson(join(DIR, 'gate-iter5.json'));
  check(rec5?.liveDrift?.recaptured === true && rec5.liveDrift.docBefore === 3000 && rec5.liveDrift.docAfter === 3400 && rec5.liveDrift.previousCapturedAt === before, 'record.liveDrift must carry before/after heights and the previous capturedAt');
  check(!existsSync(join(DIR, 'freshness.json')), 'drift must clear freshness.json');

  // (4) probe deadline → skipped, reference kept, verdict unaffected
  const ts5 = liveCapturedAt();
  r = gate(['iter6', '--refresh'], { STUB_ANCHOR_EXIT: '124', STUB_LIVE_DOC: '9000' });
  check(r.status === 0 && /drift check skipped/.test(r.out) && /deadline/.test(r.out) && liveCapturedAt() === ts5, `a 124 on the probe must skip the check, never recapture or FAIL\n${r.out}`);
  check(!readJson(join(DIR, 'gate-iter6.json'))?.liveDrift, 'skipped probe must not record liveDrift');

  // (6) --variance: second live capture once, noise floor printed + recorded, verdict untouched
  r = gate(['iter7', '--variance'], { STUB_PCT: '12', STUB_HDELTA: '700', STUB_BAND0: '3.5' });
  check(r.status === 2, `--variance must not change the verdict: pct 12 stays FAIL (exit 2), got ${r.status}\n${r.out}`);
  check(existsSync(join(DIR, 'live-b.png')) && existsSync(join(DIR, 'variance.json')), '--variance must capture live-b.png and write variance.json');
  check(/noise floor 12 %/.test(r.out) && /--mask 0:500/.test(r.out) && /never subtracted/.test(r.out), `noise floor line must print the floor, hot-band mask suggestions and the never-subtracted rule\n${r.out}`);
  const rec7 = readJson(join(DIR, 'gate-iter7.json'));
  check(rec7?.noiseFloor?.pixelPct === 12 && rec7.pixelPct === 12 && rec7.verdict === 'FAIL', 'record.noiseFloor recorded beside the raw pixelPct; verdict from the raw number');
  const liveB = statSync(join(DIR, 'live-b.png.json')).mtimeMs;
  r = gate(['iter8', '--variance'], { STUB_PCT: '4' });
  check(r.status === 0 && statSync(join(DIR, 'live-b.png.json')).mtimeMs === liveB && /noise floor/.test(r.out), `variance is recorded once per gate dir and printed on later rounds\n${r.out}`);

  // (5) recorded self-noise Δh (700) bounds the drift threshold: Δ500 is not drift
  const ts8 = liveCapturedAt();
  r = gate(['iter9', '--refresh'], { STUB_LIVE_DOC: '3500', STUB_LIVE_SECTIONS: '5' });
  check(r.status === 0 && /within 700px/.test(r.out) && liveCapturedAt() === ts8, `self-noise Δh must bound the drift threshold (Δ500 ≤ 700 → keep)\n${r.out}`);
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) { console.error(`gate-sh-fixtures: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('gate-sh-fixtures: ok (freshness probe, live drift + cache invalidation, probe deadline, noise floor, --help)');
