#!/usr/bin/env node
// gate.sh contract test: argument parsing, --help, the horizontal-overflow assert (the build capture's own
// `overflow:` line → exit 2 over a PASS pixel line; no measure.mjs launched in a round), the one capture retry on
// exit 1 (live, build; 3 / 4 / 124 final; the retried attempt's overflow line decides), the --full probe fan-out
// and its exit-code rules, the overlay flags (--consent / --dismiss / --no-dismiss reaching both
// captures, the diff probes and chrome-parity), --hide and gate-all's presence.json `hide` ("*" then <slug>; the
// site-wide stardust/replica/presence.json merged under it, the gate dir winning per field) reaching both captures and
// every probe as one effective list (chrome-parity: the flag list + --presence), live.json's `hide`
// record and the live retake on a changed list, the overlay-left rule (a capture that leaves an overlay gives no verdict:
// exit 1, a live one drops live.png / live.json / the live caches), both captures' --json record, live.json's overlayLeft
// / fontsFailed and the retake of a live.png that predates the overlay check, the live hide-miss WARNING (the live record's
// hideMiss, also for a reused live.png; never a verdict), a project stitch-shot.mjs that predates
// --json (no verdict before any capture), the --full probe bound while run-bg holds a machine browser slot (at most
// STARDUST_BROWSERS_PER_SLOT probes at a time, in order; the verdict lines and every exit code those of the unbounded
// round), with stub instruments (no browser, no network), run by /bin/bash (macOS: bash 3.2) where it exists.
// Run: node skills/replica/scripts/test/gate.test.mjs
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..');
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

// Sandbox: stardust/scripts/{replica,diff} with the real gate.sh + run-capped and stub instruments.
// realpath: the scripts' main-module guards compare process.argv[1] with import.meta.url, and a symlinked temp dir
// (macOS /var → /private/var) would make every instrument a silent no-op.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-test-')));
const replica = join(root, 'stardust/scripts/replica');
const diff = join(root, 'stardust/scripts/diff');
mkdirSync(replica, { recursive: true });
mkdirSync(diff, { recursive: true });
cpSync(join(scripts, 'gate.sh'), join(replica, 'gate.sh'));
chmodSync(join(replica, 'gate.sh'), 0o755);
cpSync(join(scripts, 'run-capped.mjs'), join(replica, 'run-capped.mjs'));

// Stubs read their behaviour from environment variables so one sandbox covers every case. stitch-shot: per side
// (LIVE = the https://live.example URL, BUILD = anything else) an exit code (STUB_STITCH_RC_<side>) or a fail-ONCE
// marker file (STUB_FAIL_ONCE_<side>: exit 1 while the marker is absent, create it); every call appends its side to
// STUB_STITCH_COUNT so a test can count attempts, its side + argv to STUB_STITCH_ARGS so a test can read the flags, and
// [side, ...argv] as one JSON line to STUB_STITCH_ARGV so a test can tell one argv value from two. The probe stubs print
// `argv <argv joined>` and `argv-json <JSON argv>` into their evidence files.
// The BUILD side prints the root line gate.sh reads, `overflow: scrollWidth=<w+o> viewport=<w> delta=<o>` (o =
// STUB_OVERFLOW px over the --width viewport; STUB_NO_OVERFLOW_LINE drops it; a fail-once attempt prints o =
// STUB_OVERFLOW_FIRST when set, before its exit 1). A successful capture prints `overlay-left: <STUB_OVERLAY_<side>>`
// first when set (exit 0, as stitch-shot does) and writes its --json record (overlayLeft, fontsFailed = the comma list
// STUB_FONTS_<side>, or null + fontCheck "failed: …" under STUB_FONTS_NULL_<side> — a font check that could not run;
// hideMiss = the JSON in STUB_HIDEMISS_<side>, else null; STUB_NO_JSON_<side> writes none, STUB_BAD_JSON_<side> an
// unreadable one). measure: a call counter only
// (STUB_MEASURE_COUNT) — a round launches none.
const stub = (dir, name, body) => writeFileSync(join(dir, name), `#!/usr/bin/env node\n${body}\n`);
const ARGV_LOG = "console.log('argv ' + process.argv.slice(2).join(' ')); console.log('argv-json ' + JSON.stringify(process.argv.slice(2)));";
// Every probe stub first appends `start <probe> <ms>` to STUB_TIMELINE and `end <probe> <ms>` when it exits (a deadline's
// SIGTERM included), then runs STUB_MS_<PROBE> (e.g. STUB_MS_CONTENT_DIFF), else STUB_PROBE_MS, milliseconds.
const TIMED = (name) => `
  { const tl = process.env.STUB_TIMELINE; const { appendFileSync: tlAppend } = await import('node:fs');
    if (tl) { tlAppend(tl, 'start ${name} ' + Date.now() + '\\n'); process.on('exit', () => tlAppend(tl, 'end ${name} ' + Date.now() + '\\n'));
      process.on('SIGTERM', () => process.exit(143)); }
    const ms = Number(process.env.STUB_MS_${name.toUpperCase().replace(/-/g, '_')} || process.env.STUB_PROBE_MS || 0);
    if (ms) await new Promise((r) => setTimeout(r, ms)); }`;
stub(replica, 'stitch-shot.mjs', `
  import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
  const url = process.argv[2]; const out = process.argv[3];
  const side = /^https:\\/\\/live\\.example/.test(url) ? 'LIVE' : 'BUILD';
  if (process.env.STUB_STITCH_COUNT) appendFileSync(process.env.STUB_STITCH_COUNT, side + '\\n');
  if (process.env.STUB_STITCH_ARGS) appendFileSync(process.env.STUB_STITCH_ARGS, side + ' ' + process.argv.slice(2).join(' ') + '\\n');
  if (process.env.STUB_STITCH_ARGV) appendFileSync(process.env.STUB_STITCH_ARGV, JSON.stringify([side, ...process.argv.slice(2)]) + '\\n');
  const w = Number(process.argv[process.argv.indexOf('--width') + 1]);
  const ovf = (o) => { if (side === 'BUILD' && !process.env.STUB_NO_OVERFLOW_LINE) console.log('overflow: scrollWidth=' + (w + o) + ' viewport=' + w + ' delta=' + o); };
  const once = process.env['STUB_FAIL_ONCE_' + side];
  if (once && !existsSync(once)) { writeFileSync(once, '1'); if (process.env.STUB_OVERFLOW_FIRST) ovf(Number(process.env.STUB_OVERFLOW_FIRST)); console.error('stitch-shot error: Target page, context or browser has been closed'); process.exit(1); }
  const rc = Number(process.env['STUB_STITCH_RC_' + side] || 0);
  if (rc) { console.error('stitch-shot error: stub exit ' + rc); process.exit(rc); }
  const overlayLeft = process.env['STUB_OVERLAY_' + side] || null;
  if (overlayLeft) console.log('overlay-left: ' + overlayLeft);
  const o = Number(process.env.STUB_OVERFLOW || 0);
  writeFileSync(out, 'png'); ovf(o);
  const json = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const fonts = process.env['STUB_FONTS_NULL_' + side] ? { fontsFailed: null, fontCheck: 'failed: Execution context was destroyed' }
    : { fontsFailed: (process.env['STUB_FONTS_' + side] || '').split(',').filter(Boolean) };
  if (json && process.env['STUB_BAD_JSON_' + side]) writeFileSync(json, '{ "url": ');
  else if (json && !process.env['STUB_NO_JSON_' + side]) writeFileSync(json, JSON.stringify({ url, out, width: w, vh: null, settle: process.argv.includes('--settle'),
    dismissed: process.argv.includes('--no-dismiss') ? null : { consent: null, extra: [], marketing: [] }, overlayLeft,
    ...fonts, hidden: [], hideMiss: process.env['STUB_HIDEMISS_' + side] ? JSON.parse(process.env['STUB_HIDEMISS_' + side]) : null,
    height: 2000, overflow: { scrollWidth: w + o, viewport: w, delta: o } }, null, 2) + '\\n');
  console.log('stitched ' + out);`);
stub(replica, 'measure.mjs', `
  import { appendFileSync } from 'node:fs';
  if (process.env.STUB_MEASURE_COUNT) appendFileSync(process.env.STUB_MEASURE_COUNT, 'M\\n');
  console.log('measure  ' + process.argv[2]);`);
stub(replica, 'pixel-compare.mjs', `
  console.log('height delta 0px'); console.log('differing 1.20%');
  process.exit(Number(process.env.STUB_PIXEL_RC || 0));`);
stub(replica, 'chrome-parity.mjs', `${TIMED('chrome-parity')}
  ${ARGV_LOG}
  if (process.env.STUB_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP)));
  const deltas = Number(process.env.STUB_CHROME_DELTAS || 0);
  console.log('chrome-parity @ 1440px'); console.log(deltas ? '✗ ' + deltas + ' delta(s) — fix these' : '✓ chrome parity');
  process.exit(deltas ? 2 : 0);`);
stub(diff, 'content-diff.mjs', `${TIMED('content-diff')}
  if (process.env.STUB_CD_RC) { console.error('content-diff error: build side answered HTTP 502'); process.exit(Number(process.env.STUB_CD_RC)); }
  const s = Number(process.env.STUB_STRUCTURAL || 0);
  console.log('  live: 12 headings'); console.log('Findings: ' + (s ? (s + 2) + ' (' + s + ' structural 🔴)' : 'none — content + roles match'));`);
stub(diff, 'clip-probe.mjs', `${TIMED('clip-probe')}
  ${ARGV_LOG}
  const n = Number(process.env.STUB_CLIPPED || 0);
  console.log('Clipped: ' + n + ' (text clipped ' + n + ', text hidden 0, controls hidden 0, controls clipped 0; advisory: clamped 0)');
  process.exit(n ? 2 : 0);`);
stub(diff, 'content-presence.mjs', `${TIMED('content-presence')}
  ${ARGV_LOG}
  const h = Number(process.env.STUB_HIDDEN || 0);
  console.log('Content: MISSING 0 (headings 0, links 0) / HIDDEN ' + h + ' (headings 0, links ' + h + ') / control-state 0');
  process.exit(h ? 2 : 0);`);
stub(diff, 'unit-geometry.mjs', `${TIMED('unit-geometry')}
  ${ARGV_LOG}
  if (process.env.STUB_UNITS_RC === '2') { console.log('Units: 1 compared; elements within 2, off 3, hidden 1, missing 0 → FAIL'); process.exit(2); }
  console.log('unit-geometry: none declared for home in stardust/replica/units.json → n/a');`);
stub(diff, 'visual-diff.mjs', `${TIMED('visual-diff')}
  ${ARGV_LOG} console.log('Visual diff @ 1440px'); console.log('build red flags (advisory): ');
  console.log('  • HEADING COLOR: h2 differs'); console.log('  • IMAGE DIMS: hero'); console.log('Full metrics JSON:'); console.log('{}');`);

// A build origin that serves the slug (the identity assertion needs it).
const server = createServer((_req, res) => res.end('<html><body>home-proposed</body></html>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const buildUrl = `http://127.0.0.1:${server.address().port}/home-proposed.html`;

// Asynchronous: the build origin above lives in this process, so the event loop must keep running while gate.sh
// fetches it (a synchronous spawn would block the server and read as "did not respond"). The interpreter is the script's
// own (#!/bin/bash — bash 3.2 on macOS); a machine browser slot inherited from a run-bg job is dropped (the bound cases
// set it themselves).
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
const inherited = { ...process.env };
delete inherited.STARDUST_BROWSER_SLOT; delete inherited.STARDUST_BROWSERS_PER_SLOT; delete inherited.RUN_BG_DEADLINE_SEC;
function gate(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [join(replica, 'gate.sh'), ...args], {
      cwd: root,
      env: { ...inherited, GATE_REAP_MIN: '0', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// --help
let r = await gate(['--help']);
check('--help exits 0', r.status === 0, `status ${r.status}`);
check('--help prints the usage block', /Usage:/.test(r.stdout) && /--full/.test(r.stdout));
check('--help names the overflow assert and the capture retry', /Horizontal-overflow assert/.test(r.stdout) && /Capture retry/.test(r.stdout) && /overflow-<label>\.txt/.test(r.stdout));
check('--help documents the overlay flags', /Overlay dismissal/.test(r.stdout) && /--consent <sel>/.test(r.stdout) && /--dismiss <sel,…>/.test(r.stdout) && /--no-dismiss/.test(r.stdout), r.stdout.slice(0, 400));
check('--help documents --hide and presence.json (the site-wide file merged under the gate dir\'s) reaching chrome-parity', /\[--hide <sel,…>\]/.test(r.stdout) && /^ {2}--hide <sel,…> /m.test(r.stdout) && /presence\.json/.test(r.stdout)
  && /--presence stardust\/replica\/presence\.json/.test(r.stdout));
check('--help documents the live hide-miss warning: its line, never a verdict', /`gate\.sh: WARNING hide matched nothing on live — candidates: <selector> \(<tag>, <h>px\); …/.test(r.stdout)
  && /none found above the header/.test(r.stdout) && /the verdict and the exit code are unchanged/.test(r.stdout), r.stdout);
check('--help documents the overlay-left rule: no verdict, exit 1', /overlay-left: <descriptor>/.test(r.stdout) && /overlay left on the <live\|build> capture/.test(r.stdout) && /an overlay left on either capture/.test(r.stdout), r.stdout.slice(0, 400));

// Plain pixel round (no --full): verdict lines, evidence, exit = pixel rc.
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter1']);
check('pixel round exits 0 on pass', r.status === 0, r.stderr.slice(0, 200));
check('pixel round prints the verdict lines', /height delta/.test(r.stdout) && /differing/.test(r.stdout));
check('live capture is written once and reused', existsSync(join(root, 'stardust/replica/gates/home-1440/live.png')));
check('no probe evidence without --full', !existsSync(join(root, 'stardust/replica/gates/home-1440/content-diff-iter1.txt')));
check('a clean root prints the overflow assert as ok, after the pixel lines', /differing[^\n]*\n[^]*^gate\.sh: overflow assert at 1440 — build scrollWidth 1440 = viewport → ok$/m.test(r.stdout), r.stdout);
check('the overflow probe leaves its evidence file', /scrollWidth/.test(readFileSync(join(root, 'stardust/replica/gates/home-1440/overflow-iter1.txt'), 'utf8')));

// Horizontal-overflow assert: the build document is wider than its viewport → FAIL (exit 2) over a PASS pixel line.
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf1'], { STUB_OVERFLOW: '13' });
check('a build scrollWidth over the viewport fails the round (exit 2) although pixels passed', r.status === 2, `status ${r.status} ${r.stderr.slice(0, 300)}`);
check('the overflow verdict line names width, scrollWidth, viewport and the px over', /^gate\.sh: OVERFLOW at 1440 — build scrollWidth 1453 > viewport 1440 \(\+13px\) → FAIL \(hard assert: no iteration cap waives horizontal overflow; evidence stardust\/replica\/gates\/home-1440\/overflow-ovf1\.txt\)$/m.test(r.stdout), r.stdout);
check('the pixel verdict lines are still printed before it', /differing 1\.20%[^]*gate\.sh: OVERFLOW/.test(r.stdout));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf2', '--full'], { STUB_OVERFLOW: '40' });
check('under --full an overflow is a verdict (2): the probes still run and the round exits 2', r.status === 2 && /^content-diff: none/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf3'], { STUB_OVERFLOW: '5', STUB_PIXEL_RC: '124' });
check('an overflow never manufactures a verdict from a pixel deadline: exit stays 124, the line is still printed', r.status === 124 && /^gate\.sh: OVERFLOW at 1440 — build scrollWidth 1445/m.test(r.stdout), `status ${r.status}`);
// Tolerance: integer rounding of a subpixel width is not an overflow (default 4 px, GATE_OVERFLOW_TOLERANCE).
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'tol1'], { STUB_OVERFLOW: '3' });
check('+3px is inside the default 4px tolerance: exit 0 and the ok line names the px and the tolerance', r.status === 0 && /^gate\.sh: overflow assert at 1440 — build scrollWidth 1443 vs viewport 1440 \(\+3px, within the 4px rounding tolerance\) → ok$/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'tol2'], { STUB_OVERFLOW: '4' });
check('+4px (the boundary) is still ok', r.status === 0 && /within the 4px rounding tolerance\) → ok$/m.test(r.stdout), `status ${r.status}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'tol3'], { STUB_OVERFLOW: '5' });
check('+5px fails the round (exit 2)', r.status === 2 && /^gate\.sh: OVERFLOW at 1440 — build scrollWidth 1445 > viewport 1440 \(\+5px\) → FAIL/m.test(r.stdout), `status ${r.status}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'tol4'], { STUB_OVERFLOW: '1', GATE_OVERFLOW_TOLERANCE: '0' });
check('GATE_OVERFLOW_TOLERANCE=0 makes the assert exact: +1px fails', r.status === 2 && /\(\+1px\) → FAIL/.test(r.stdout), `status ${r.status}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'tol5'], { STUB_OVERFLOW: '0', GATE_OVERFLOW_TOLERANCE: 'four' });
check('a non-numeric GATE_OVERFLOW_TOLERANCE is a usage error (exit 125) before any capture', r.status === 125 && /whole number of px/.test(r.stderr), `status ${r.status} ${r.stderr}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf4'], { STUB_NO_OVERFLOW_LINE: '1' });
check('a build capture without an overflow line is exit 1 naming the fix (never a silent pass)', r.status === 1 && /^gate\.sh: the build capture printed no overflow line \(stardust\/replica\/gates\/home-1440\/overflow-ovf4\.txt\) — re-copy stitch-shot\.mjs from the plugin; the assert needs it$/m.test(r.stderr) && !/differing/.test(r.stdout), `status ${r.status} ${r.stderr}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf5'], { STUB_STITCH_RC_BUILD: '124' });
check('a build capture deadline is 124, no overflow line', r.status === 124 && /build capture failed \(exit 124\)/.test(r.stderr) && !/overflow assert|OVERFLOW/.test(r.stdout), `status ${r.status} ${r.stderr}`);
// C6: the overflow numbers come from the build capture itself — no second page load through measure.mjs.
const mCount = join(root, 'measure-count.txt');
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'nom1'], { STUB_MEASURE_COUNT: mCount });
check('a round launches no measure.mjs (the overflow line is the build capture\'s own)', r.status === 0 && !existsSync(mCount) && /^gate\.sh: overflow assert at 1440 — build scrollWidth 1440 = viewport → ok$/m.test(r.stdout), `status ${r.status} ${existsSync(mCount)}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'nom2', '--full'], { STUB_MEASURE_COUNT: mCount });
check('a --full round launches no measure.mjs either', r.status === 0 && !existsSync(mCount), `status ${r.status} ${existsSync(mCount)}`);

// Capture retry: exit 1 is retried once — on the build capture, the live capture and the overflow probe; 3 / 124 are final.
const countFile = join(root, 'stitch-count.txt');
const attempts = () => (existsSync(countFile) ? readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean) : []);
const resetCount = () => { if (existsSync(countFile)) unlinkSync(countFile); };
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry1'], { STUB_FAIL_ONCE_BUILD: join(root, 'once-build'), STUB_STITCH_COUNT: countFile });
check('a build capture that exits 1 once is retried and the round passes', r.status === 0, `status ${r.status} ${r.stderr.slice(0, 300)}`);
check('the retry is said on stderr', /^gate\.sh: build capture exited 1 — retrying once \(a capture error under load is not a verdict\)$/m.test(r.stderr), r.stderr);
check('exactly two build attempts, live cached (no live attempt)', attempts().join(',') === 'BUILD,BUILD', attempts().join(','));
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry2'], { STUB_STITCH_RC_BUILD: '1', STUB_STITCH_COUNT: countFile });
check('two exit-1 build captures end the round with exit 1 and say re-queue, never a FAIL', r.status === 1 && /build capture failed \(exit 1\) — not comparing \(twice: no verdict — re-queue the round\)/.test(r.stderr), `status ${r.status} ${r.stderr}`);
check('no third attempt', attempts().join(',') === 'BUILD,BUILD', attempts().join(','));
check('no overflow line, no pixel verdict after a failed capture', !/overflow assert|OVERFLOW|differing/.test(r.stdout), r.stdout);
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry3'], { STUB_STITCH_RC_BUILD: '3', STUB_STITCH_COUNT: countFile });
check('exit 3 (bot challenge) is final on the first attempt — not retried', r.status === 3 && attempts().join(',') === 'BUILD' && !/retrying/.test(r.stderr), `status ${r.status} attempts ${attempts().join(',')}`);
resetCount();
r = await gate(['about', 'https://live.example/about', buildUrl, '1440', 'retry4', '--marker', 'home-proposed'], { STUB_FAIL_ONCE_LIVE: join(root, 'once-live'), STUB_STITCH_COUNT: countFile });
check('a live capture that exits 1 once is retried; the round passes and live.png is kept', r.status === 0 && existsSync(join(root, 'stardust/replica/gates/about-1440/live.png')), `status ${r.status} ${r.stderr.slice(0, 300)}`);
check('live attempted twice, then the build once', attempts().join(',') === 'LIVE,LIVE,BUILD', attempts().join(','));
resetCount();
r = await gate(['press', 'https://live.example/press', buildUrl, '1440', 'retry5', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '1', STUB_STITCH_COUNT: countFile });
check('two exit-1 live captures: exit 1, re-queue named, no partial live.png left to be reused', r.status === 1 && /live capture failed \(exit 1\) — not comparing \(twice: no verdict — re-queue the round\)/.test(r.stderr) && !existsSync(join(root, 'stardust/replica/gates/press-1440/live.png')) && attempts().join(',') === 'LIVE,LIVE', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry6'], { STUB_FAIL_ONCE_BUILD: join(root, 'once-build-ovf'), STUB_OVERFLOW_FIRST: '40', STUB_STITCH_COUNT: countFile });
check('a build capture that exits 1 once: the overflow line of the second attempt decides', r.status === 0 && attempts().join(',') === 'BUILD,BUILD'
  && /^gate\.sh: overflow assert at 1440 — build scrollWidth 1440 = viewport → ok$/m.test(r.stdout) && !/OVERFLOW/.test(r.stdout)
  && readFileSync(join(root, 'stardust/replica/gates/home-1440/overflow-retry6.txt'), 'utf8').trim() === 'overflow: scrollWidth=1440 viewport=1440 delta=0\nstitched stardust/replica/gates/home-1440/build.png', `status ${r.status} attempts ${attempts().join(',')} ${r.stdout}`);

// Unknown flag
r = await gate(['home', 'https://live.example/', buildUrl, '1440', '--bogus']);
check('unknown flag exits 125', r.status === 125);

// --full, everything green
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter2', '--full']);
check('--full exits 0 when every probe passes', r.status === 0, `status ${r.status} ${r.stderr.slice(0, 600)}`);
check('--full prints one content-diff verdict', /^content-diff: none — content \+ roles match/m.test(r.stdout), r.stdout);
check('--full prints the visual flag count and heads', /^visual-diff: 2 advisory flag\(s\) — HEADING COLOR: h2 differs; IMAGE DIMS: hero;/m.test(r.stdout), r.stdout);
check('--full prints the chrome-parity summary', /^chrome-parity: ✓ chrome parity/m.test(r.stdout), r.stdout);
check('--full prints the clip-probe verdict on the build side and skips content-presence in the prototype regime', /^clip-probe: Clipped: 0 /m.test(r.stdout) && !/^content-presence:/m.test(r.stdout) && !existsSync(join(root, 'stardust/replica/gates/home-1440/content-presence-iter2.txt')), r.stdout);
check('--full writes the probe evidence files', ['content-diff-iter2.txt', 'visual-diff-iter2.txt', 'chrome-parity-iter2.txt', 'clip-iter2.txt'].every((f) => existsSync(join(root, 'stardust/replica/gates/home-1440', f))));
check('--full keeps the full reports out of stdout', !/12 headings/.test(r.stdout) && !/Full metrics/.test(r.stdout));

// --full, structural red → 2 even though pixels pass
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter3', '--full'], { STUB_STRUCTURAL: '1' });
check('a structural content red fails the round (exit 2)', r.status === 2, `status ${r.status}`);
check('the structural count is on the verdict line', /^content-diff: 3 \(1 structural 🔴\)/m.test(r.stdout), r.stdout);

// --full, chrome deltas → 2
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter4', '--full'], { STUB_CHROME_DELTAS: '3' });
check('chrome deltas fail the round (exit 2)', r.status === 2, `status ${r.status}`);
check('the chrome summary line is printed', /^chrome-parity: ✗ 3 delta\(s\)/m.test(r.stdout), r.stdout);

// --full, pixel fail rules over green probes
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter5', '--full'], { STUB_PIXEL_RC: '2' });
check('a pixel fail is the round verdict (exit 2)', r.status === 2, `status ${r.status}`);

// --full, a probe deadline → 124, never a verdict
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6', '--full'], { STUB_SLEEP: '3000', GATE_PROBE_TIMEOUT: '1' });
check('a probe deadline makes the round exit 124', r.status === 124, `status ${r.status}`);
check('the deadline is named on the verdict line', /^chrome-parity: DEADLINE \(exit 124\)/m.test(r.stdout), r.stdout);

// --full, a probe that errors gave no verdict → 1, never a pass
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6b', '--full'], { STUB_CD_RC: '1' });
check('an errored probe makes the round exit 1, not 0', r.status === 1, `status ${r.status}`);
check('the error is named on the verdict line', /^content-diff: ERROR \(exit 1\) — content-diff error: build side answered HTTP 502/m.test(r.stdout), r.stdout);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6c', '--full'], { STUB_CD_RC: '3' });
check('a bot challenge on a probe passes through as exit 3', r.status === 3, `status ${r.status}`);

// --full, the pixel step gave no verdict → the probes are skipped, exit = pixel rc
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6d', '--full'], { STUB_PIXEL_RC: '124' });
check('pixel rc 124 under --full skips the probes and exits 124', r.status === 124, `status ${r.status}`);
check('the skip is said in one line', /^gate\.sh: probes skipped — the pixel round gave no verdict \(exit 124\)/m.test(r.stderr), r.stderr);
check('no probe ran or left evidence after a pixel deadline', !/^(content-diff|visual-diff|chrome-parity): /m.test(r.stdout) && !existsSync(join(root, 'stardust/replica/gates/home-1440/content-diff-iter6d.txt')));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6e', '--full'], { STUB_PIXEL_RC: '1' });
check('pixel rc 1 skips the probes and exits 1', r.status === 1 && /probes skipped/.test(r.stderr) && !existsSync(join(root, 'stardust/replica/gates/home-1440/chrome-parity-iter6e.txt')), `status ${r.status}`);

// The probe bound (header § --full, Concurrency): while run-bg holds a machine browser slot (STARDUST_BROWSER_SLOT
// non-empty) the probes run at most STARDUST_BROWSERS_PER_SLOT at a time (unset / not a positive integer → 1), launched
// in order, the OLDEST waited before the next launch; without a slot every probe starts at once. Verdict lines, each
// probe's rc and the round's exit code are those of the unbounded round. Published regime + a families file = all six.
// When the bound holds back some of the round's probes the bound line names the remedy (run-bg --timeout 1800, or a
// larger STARDUST_BROWSER_BUDGET) and, under a run-bg deadline (RUN_BG_DEADLINE_SEC) below 1800 s, that deadline — a note.
const SIX = ['content-diff', 'visual-diff', 'chrome-parity', 'clip-probe', 'content-presence', 'unit-geometry'];
const tlFile = join(root, 'probe-timeline.txt');
const SLOT = join(root, 'locks/slot-1.json');
const readTimeline = () => (existsSync(tlFile) ? readFileSync(tlFile, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => { const [kind, name, t] = l.split(' '); return { kind, name, t: Number(t) }; }) : []);
// The most probes alive at once; an end sorts before a start in the same ms (the bounded launch waits for that end).
const peak = (tl) => { let n = 0; let max = 0; [...tl].sort((a, b) => a.t - b.t || (a.kind === 'end' ? -1 : 1)).forEach((e) => { n += e.kind === 'start' ? 1 : -1; max = Math.max(max, n); }); return max; };
const tAt = (tl, kind, name) => (tl.find((e) => e.kind === kind && e.name === name) || { t: NaN }).t;
const startOrder = (tl) => tl.filter((e) => e.kind === 'start').map((e) => e.name).join(',');
const boundLines = (stderr) => stderr.split('\n').filter((l) => /^gate\.sh: browser slot held/.test(l));
const bounded = (n) => ({ STARDUST_BROWSER_SLOT: SLOT, ...(n === undefined ? {} : { STARDUST_BROWSERS_PER_SLOT: n }) });
const timed = async (lbl, env, regime = 'published') => {
  rmSync(tlFile, { force: true });
  const res = await gate(['home', 'https://live.example/', buildUrl, '1440', lbl, '--full'], { ...(regime ? { GATE_REGIME: regime } : {}), STUB_TIMELINE: tlFile, ...env });
  return { ...res, tl: readTimeline() };
};
const LINE = (n, why) => `gate.sh: browser slot held — the --full probes run at most ${n} at a time (${why})`;
const SUM = (n) => `; this round's ${n} probes take the sum of their times — start a --full round through run-bg with --timeout 1800 (or raise STARDUST_BROWSER_BUDGET)`;
const DEADLINE = (d) => `; the job's deadline ${d} s may end the round with no verdict (exit 124)`;
const show = (x) => `status ${x.status} peak ${peak(x.tl)} starts ${startOrder(x.tl)} | ${x.stderr.slice(0, 400)}`;
mkdirSync(join(root, 'stardust/replica'), { recursive: true });
writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ cards: { origin: '.a', build: '.b', pages: ['home'] } }));
const free = await timed('bnd', { STUB_PROBE_MS: '1500', STARDUST_BROWSERS_PER_SLOT: '1', RUN_BG_DEADLINE_SEC: '900' });
check('no slot: all six probes start at once (a per-slot value alone bounds nothing); no bound line, no deadline note under a 900 s deadline', free.status === 0
  && startOrder(free.tl).split(',').sort().join(',') === [...SIX].sort().join(',') && peak(free.tl) === 6 && boundLines(free.stderr).length === 0
  && !/--timeout 1800|may end the round/.test(free.stderr), show(free));
let b = await timed('bnd-empty', { STUB_PROBE_MS: '1500', STARDUST_BROWSER_SLOT: '', STARDUST_BROWSERS_PER_SLOT: '1' });
check('an empty STARDUST_BROWSER_SLOT is no slot: all six at once, no bound line', b.status === 0 && peak(b.tl) === 6 && boundLines(b.stderr).length === 0, show(b));
b = await timed('bnd', { STUB_PROBE_MS: '300', ...bounded('1'), RUN_BG_DEADLINE_SEC: '900' });
check('slot held, STARDUST_BROWSERS_PER_SLOT=1: never two probes at once, launched in order', b.status === 0 && b.tl.length === 12 && peak(b.tl) === 1 && startOrder(b.tl) === SIX.join(','), show(b));
check('… one stderr line names the bound, the remedy and the job\'s 900 s deadline (a note only)', boundLines(b.stderr).join('\n') === LINE(1, 'STARDUST_BROWSERS_PER_SLOT=1') + SUM(6) + DEADLINE(900)
  && (b.stderr.match(/--timeout 1800/g) || []).length === 1, b.stderr);
check('… stdout (every verdict line) and the exit code are byte-for-byte the unbounded round\'s; every pid waited once', b.stdout === free.stdout && b.status === free.status && !/not a child|wait:/.test(b.stderr), `${b.stdout}\n---\n${free.stdout}`);
b = await timed('bnd', { STUB_PROBE_MS: '1500', ...bounded('3'), RUN_BG_DEADLINE_SEC: '1800' });
check('STARDUST_BROWSERS_PER_SLOT=3: at most three at once (three reached), the oldest waited before each next launch', b.status === 0 && peak(b.tl) === 3
  && tAt(b.tl, 'start', 'clip-probe') >= tAt(b.tl, 'end', 'content-diff') && tAt(b.tl, 'start', 'content-presence') >= tAt(b.tl, 'end', 'visual-diff')
  && tAt(b.tl, 'start', 'unit-geometry') >= tAt(b.tl, 'end', 'chrome-parity'), show(b));
check('… its bound line with the remedy (a 1800 s deadline gets no note), and stdout + exit code those of the unbounded round', boundLines(b.stderr).join('\n') === LINE(3, 'STARDUST_BROWSERS_PER_SLOT=3') + SUM(6)
  && b.stdout === free.stdout && b.status === free.status, `${b.stderr}\n${b.stdout}`);
for (const [per, why] of [[undefined, 'STARDUST_BROWSERS_PER_SLOT unset — an older run-bg'], ['abc', "STARDUST_BROWSERS_PER_SLOT='abc' is not a positive integer"], ['0', "STARDUST_BROWSERS_PER_SLOT='0' is not a positive integer"]]) {
  b = await timed(`bnd-${per}`, { STUB_PROBE_MS: '150', ...bounded(per), RUN_BG_DEADLINE_SEC: '0' });
  check(`slot held, STARDUST_BROWSERS_PER_SLOT ${per === undefined ? 'unset' : `'${per}'`}: 1 at a time, the line says why`, b.status === 0 && peak(b.tl) === 1 && startOrder(b.tl) === SIX.join(',')
    && boundLines(b.stderr).join('\n') === LINE(1, `${why}; 1 is the conservative bound`) + SUM(6), show(b));
}
b = await timed('bnd-proto', { STUB_PROBE_MS: '150', ...bounded('1') }, null);
check('bounded in the prototype regime: content-presence never launched (rc 0 as before), the other five one at a time, exit 0; the line counts five', b.status === 0 && startOrder(b.tl) === SIX.filter((n) => n !== 'content-presence').join(',')
  && peak(b.tl) === 1 && !/^content-presence:/m.test(b.stdout) && /^unit-geometry: /m.test(b.stdout) && boundLines(b.stderr).join('\n') === LINE(1, 'STARDUST_BROWSERS_PER_SLOT=1') + SUM(5), show(b));
b = await timed('bnd-6', { ...bounded('6'), RUN_BG_DEADLINE_SEC: '900' });
check('a bound that holds nothing back (6 per slot, six probes): the bare bound line — no remedy, no deadline note', b.status === 0 && boundLines(b.stderr).join('\n') === LINE(6, 'STARDUST_BROWSERS_PER_SLOT=6'), show(b));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'bnd-pix'], bounded('1'));
check('slot held, no --full: no bound line (it bounds the probes only)', r.status === 0 && boundLines(r.stderr).length === 0, r.stderr);
// rc precedence under the bound: the same scenario unbounded and with one probe at a time — identical stdout and exit.
// content-diff runs first, so under the bound its rc is stored while the later probes have not started.
const twin = async (lbl, env) => {
  const one = await timed(lbl, env);
  const two = await timed(lbl, { ...env, ...bounded('1') });
  return { one, two, same: one.stdout === two.stdout && one.status === two.status && !/not a child|wait:/.test(two.stderr) };
};
let t = await twin('rp1', { STUB_MS_CONTENT_DIFF: '6000', GATE_PROBE_TIMEOUT: '2', STUB_CHROME_DELTAS: '3' });
check('a deadline (124) in the first probe under the bound: exit 124 over a later chrome FAIL, as unbounded', t.same && t.two.status === 124
  && /^content-diff: DEADLINE \(exit 124\)/m.test(t.two.stdout) && /^chrome-parity: ✗ 3 delta\(s\)/m.test(t.two.stdout), `${show(t.one)}\n${show(t.two)}\n${t.two.stdout}`);
check('… the deadlined probe ended before the next one started; then the rest one at a time', peak(t.two.tl) === 1 && startOrder(t.two.tl) === SIX.join(',')
  && tAt(t.two.tl, 'start', 'visual-diff') >= tAt(t.two.tl, 'end', 'content-diff'), show(t.two));
t = await twin('rp2', { STUB_CD_RC: '1' });
check('an error in the first probe under the bound: its ERROR line and exit 1, as unbounded', t.same && t.two.status === 1
  && /^content-diff: ERROR \(exit 1\) — content-diff error: build side answered HTTP 502/m.test(t.two.stdout) && peak(t.two.tl) === 1, `${show(t.one)}\n${show(t.two)}`);
t = await twin('rp3', { STUB_CD_RC: '1', STUB_CLIPPED: '3' });
check('… with a later clip-probe FAIL: exit 2 (a verdict beats an error), as unbounded', t.same && t.two.status === 2 && /^clip-probe: Clipped: 3 /m.test(t.two.stdout), `${show(t.one)}\n${show(t.two)}`);
t = await twin('rp4', { STUB_CHROME_DELTAS: '3' });
check('a FAIL (chrome-parity exit 2) in an early probe under the bound: exit 2 and its line, as unbounded', t.same && t.two.status === 2 && /^chrome-parity: ✗ 3 delta\(s\)/m.test(t.two.stdout), `${show(t.one)}\n${show(t.two)}`);
t = await twin('rp5', { STUB_CD_RC: '3' });
check('a bot challenge (exit 3) in the first probe under the bound: BLOCKED and exit 3, as unbounded', t.same && t.two.status === 3 && /^content-diff: BLOCKED \(exit 3\)/m.test(t.two.stdout), `${show(t.one)}\n${show(t.two)}`);
unlinkSync(join(root, 'stardust/replica/units.json'));

// --main / --no-dismiss reach the probes (recorded by the stub through its argv → evidence file)
stub(diff, 'content-diff.mjs', `${ARGV_LOG} console.log('Findings: none — content + roles match');`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter7', '--full', '--main', '#content', '--no-dismiss']);
const cdPath = join(root, 'stardust/replica/gates/home-1440/content-diff-iter7.txt');
const cd = existsSync(cdPath) ? readFileSync(cdPath, 'utf8') : `(missing ${cdPath}; stderr: ${r.stderr.slice(0, 300)})`;
check('--main is passed to the diff probes', /--main #content/.test(cd), cd);
check('--no-dismiss drops the dismiss flag', !/--dismiss/.test(cd), cd);

// Overlay dismissal, one vocabulary (header § Overlay dismissal): --consent / --dismiss reach BOTH stitched captures
// (symmetric), the diff probes (joined into their one --dismiss value) and chrome-parity; a default round dismisses
// with the built-in candidates (captures: no flag; probes: bare --dismiss); --no-dismiss reaches the captures as
// stitch-shot's --no-dismiss and drops the probes' flag. Fresh slugs so the live capture runs (live.png is cached per
// slug × width); the selectors carry spaces and commas on purpose — the quoting through the arrays is the contract.
const argsFile = join(root, 'stitch-args.txt');
const stitchArgs = () => (existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim().split('\n') : []);
const resetArgs = () => { if (existsSync(argsFile)) unlinkSync(argsFile); };
const evidence = (slug, name) => { const p = join(root, `stardust/replica/gates/${slug}-1440/${name}`); return existsSync(p) ? readFileSync(p, 'utf8') : `(missing ${p})`; };
const CONSENT = '#consent-yes, .consent-box-yes'; const EXTRA = '.promo-close,#newsletter-close';
// argv as the instrument saw it (JSON): stitch-shot's lines in STUB_STITCH_ARGV ([side, ...argv]), a probe's `argv-json`
// evidence line. hideArg → the one value after --hide; undefined without --hide; null when --hide repeats or another
// argv value names a hidden selector too (a list split into several values — lost quoting).
const argvFile = join(root, 'stitch-argv.txt');
const stitchArgv = () => (existsSync(argvFile) ? readFileSync(argvFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const resetArgv = () => { if (existsSync(argvFile)) unlinkSync(argvFile); };
const argvIn = (text) => { const m = /^argv-json (.*)$/m.exec(text); return m ? JSON.parse(m[1]) : null; };
const hideArg = (argv) => {
  if (!argv) return null;
  const at = argv.flatMap((a, i) => (a === '--hide' ? [i] : []));
  if (!at.length) return undefined;
  return at.length === 1 && argv.filter((a) => /geo-bar|location-bar|promo-strip/.test(a)).length === 1 ? argv[at[0] + 1] : null;
};
resetArgs();
r = await gate(['consent1', 'https://live.example/consent1', buildUrl, '1440', 'c1', '--full', '--marker', 'home-proposed', '--consent', CONSENT, '--dismiss', EXTRA], { STUB_STITCH_ARGS: argsFile });
check('--consent / --dismiss reach the live capture (after --settle) and the build capture alike, values intact', r.status === 0 && stitchArgs().length === 2
  && stitchArgs()[0] === `LIVE https://live.example/consent1 stardust/replica/gates/consent1-1440/live.png --width 1440 --settle --json stardust/replica/gates/consent1-1440/live-shot.json --consent ${CONSENT} --dismiss ${EXTRA} --locale en-US`
  && stitchArgs()[1] === `BUILD ${buildUrl} stardust/replica/gates/consent1-1440/build.png --width 1440 --settle --json stardust/replica/gates/consent1-1440/build-shot.json --consent ${CONSENT} --dismiss ${EXTRA} --locale en-US`, `status ${r.status} | ${stitchArgs().join(' | ')} ${r.stderr.slice(0, 200)}`);
check('the diff probes get the same selectors joined into one --dismiss list', new RegExp(`--main main --dismiss ${CONSENT},${EXTRA}$`, 'm').test(evidence('consent1', 'content-diff-c1.txt')) && new RegExp(`--main main --dismiss ${CONSENT},${EXTRA} --out `).test(evidence('consent1', 'visual-diff-c1.txt')), evidence('consent1', 'content-diff-c1.txt') + evidence('consent1', 'visual-diff-c1.txt'));
check('chrome-parity gets --consent and --dismiss', new RegExp(`--live-cache \\S+ --consent ${CONSENT} --dismiss ${EXTRA}$`, 'm').test(evidence('consent1', 'chrome-parity-c1.txt')), evidence('consent1', 'chrome-parity-c1.txt'));
resetArgs(); resetArgv();
r = await gate(['consent2', 'https://live.example/consent2', buildUrl, '1440', 'c2', '--full', '--marker', 'home-proposed'], { STUB_STITCH_ARGS: argsFile, STUB_STITCH_ARGV: argvFile });
check('a default round dismisses with the built-in candidates: no overlay flag on either capture, bare --dismiss on the probes, none on chrome-parity', r.status === 0 && stitchArgs().length === 2
  && stitchArgs().every((l) => !/--consent|--dismiss|--no-dismiss/.test(l))
  && /--main main --dismiss$/m.test(evidence('consent2', 'content-diff-c2.txt')) && /--main main --dismiss --out /.test(evidence('consent2', 'visual-diff-c2.txt'))
  && !/--consent|--dismiss/.test(evidence('consent2', 'chrome-parity-c2.txt')), `status ${r.status} | ${stitchArgs().join(' | ')} | ${evidence('consent2', 'content-diff-c2.txt')}`);
check('without --hide and presence.json no capture or probe gets --hide', r.status === 0 && stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === undefined)
  && ['content-diff-c2.txt', 'visual-diff-c2.txt', 'clip-c2.txt', 'chrome-parity-c2.txt'].every((f) => { const a = argvIn(evidence('consent2', f)); return a && hideArg(a) === undefined; })
  && !/retaking/.test(r.stderr), `${JSON.stringify(stitchArgv())} ${r.stderr}`);
check('the build capture settles like the live one: --settle on both stitches', stitchArgv().map((a) => a[0]).join(',') === 'LIVE,BUILD'
  && stitchArgv().every((a) => a.filter((x) => x === '--settle').length === 1), JSON.stringify(stitchArgv()));
resetArgs();
r = await gate(['consent3', 'https://live.example/consent3', buildUrl, '1440', 'c3', '--full', '--marker', 'home-proposed', '--no-dismiss'], { STUB_STITCH_ARGS: argsFile });
check('--no-dismiss reaches both captures as stitch-shot --no-dismiss and drops the probes\' flag', r.status === 0 && stitchArgs().length === 2
  && stitchArgs().every((l) => / --no-dismiss --locale en-US$/.test(l) && !/--consent|--dismiss /.test(l))
  && !/--dismiss/.test(evidence('consent3', 'content-diff-c3.txt')) && !/--dismiss/.test(evidence('consent3', 'visual-diff-c3.txt')) && !/--consent|--dismiss/.test(evidence('consent3', 'chrome-parity-c3.txt')), `status ${r.status} | ${stitchArgs().join(' | ')}`);
resetArgs();
r = await gate(['consent3', 'https://live.example/consent3', buildUrl, '1440', 'c4', '--no-dismiss', '--consent', '#consent-yes'], { STUB_STITCH_ARGS: argsFile });
check('--no-dismiss with --consent is a usage error (exit 125) before any capture', r.status === 125 && /contradicts/.test(r.stderr) && stitchArgs().length === 0, `status ${r.status} ${r.stderr}`);
r = await gate(['consent3', 'https://live.example/consent3', buildUrl, '1440', 'c5', '--consent']);
check('--consent without a selector is a usage error', r.status !== 0 && /--consent needs a selector/.test(r.stderr), `status ${r.status} ${r.stderr}`);

// #125: element defects fail a --full round; content-presence and unit-geometry join in the published regime / with a families file
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'clip1', '--full'], { STUB_CLIPPED: '3' });
check('--full: a clipped count > 0 on the build side fails the round (exit 2) with its verdict line', r.status === 2 && /^clip-probe: Clipped: 3 /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'pub1', '--full'], { GATE_REGIME: 'published', STUB_HIDDEN: '284' });
check('--full in the published regime runs content-presence live vs build and a HIDDEN link fails the round', r.status === 2 && /^content-presence: Content: MISSING 0 .*HIDDEN 284/m.test(r.stdout) && existsSync(join(root, 'stardust/replica/gates/home-1440/content-presence-pub1.txt')), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'pub2', '--full'], { GATE_REGIME: 'published' });
check('--full in the published regime passes when content-presence is clean', r.status === 0 && /^content-presence: Content: MISSING 0 .*HIDDEN 0/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
check('no unit-geometry line without a families file', !/^unit-geometry:/m.test(r.stdout));
mkdirSync(join(root, 'stardust/replica'), { recursive: true });
writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ cards: { origin: '.a', build: '.b', pages: ['home'] } }));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'u1', '--full']);
check('with stardust/replica/units.json the round runs unit-geometry --families --slug and prints its line', r.status === 0 && /^unit-geometry: unit-geometry: none declared/m.test(r.stdout) && /--families stardust\/replica\/units.json --slug home/.test(readFileSync(join(root, 'stardust/replica/gates/home-1440/units-u1.txt'), 'utf8')), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'u2', '--full'], { STUB_UNITS_RC: '2' });
check('a required unit off (unit-geometry exit 2) fails the round', r.status === 2 && /^unit-geometry: Units: 1 compared/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
unlinkSync(join(root, 'stardust/replica/units.json'));

// Live-side caches (C5) and live.json: --full hands each live-side probe its cache file in the gate dir; both stitched
// captures pin --locale en-US; a live capture records its parameters in live.json (argv-passed, JSON.stringify), a
// cached live.png round leaves it untouched, a failed (re)capture leaves neither live.png nor live.json.
const gdir = (slug) => `stardust/replica/gates/${slug}-1440`;
const liveJson = (slug) => { const p = join(root, gdir(slug), 'live.json'); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
resetArgs();
r = await gate(['cache1', 'https://live.example/cache1', buildUrl, '1440', 'k1', '--full', '--marker', 'home-proposed'], { GATE_REGIME: 'published', STUB_STITCH_ARGS: argsFile });
check('--full: content-diff gets --live-cache <gate dir>/content-live.json, visual-diff <gate dir>/visual-live.json, content-presence --origin-cache <gate dir>/presence-live.json', r.status === 0
  && evidence('cache1', 'content-diff-k1.txt').includes(` --live-cache ${gdir('cache1')}/content-live.json `)
  && evidence('cache1', 'visual-diff-k1.txt').includes(` --live-cache ${gdir('cache1')}/visual-live.json`)
  && evidence('cache1', 'content-presence-k1.txt').includes(` --origin-cache ${gdir('cache1')}/presence-live.json`), `status ${r.status} ${r.stdout}`);
check('both stitched captures pin --locale en-US', stitchArgs().length === 2 && stitchArgs().every((l) => / --locale en-US$/.test(l)), stitchArgs().join(' | '));
const before = new Date().toISOString();
r = await gate(['lj1', 'https://live.example/lj1', buildUrl, '1440', 'j1', '--marker', 'home-proposed']);
let lj = liveJson('lj1') ? JSON.parse(liveJson('lj1')) : {};
check('a live capture writes live.json: url, width, locale, settle, overlays dismissed, the capture time', r.status === 0 && lj.writtenBy === 'gate.sh' && lj.url === 'https://live.example/lj1'
  && lj.width === 1440 && lj.locale === 'en-US' && lj.settle === true && lj.headed === false && lj.dismiss.off === false && lj.dismiss.consent === null && lj.dismiss.extra === null
  && lj.at >= before && lj.at <= new Date().toISOString(), `status ${r.status} ${liveJson('lj1')}`);
check('a round without --hide or presence.json records hide: [] in live.json', Array.isArray(lj.hide) && lj.hide.length === 0, liveJson('lj1'));
r = await gate(['lj2', 'https://live.example/lj2', buildUrl, '1440', 'j2', '--marker', 'home-proposed', '--no-dismiss']);
check('--no-dismiss → live.json dismiss.off true', r.status === 0 && liveJson('lj2') && JSON.parse(liveJson('lj2')).dismiss.off === true, liveJson('lj2'));
r = await gate(['lj3', 'https://live.example/lj3', buildUrl, '1440', 'j3', '--marker', 'home-proposed', '--consent', CONSENT, '--dismiss', EXTRA]);
lj = liveJson('lj3') ? JSON.parse(liveJson('lj3')) : {};
check('--consent / --dismiss values land in live.json intact', r.status === 0 && Boolean(lj.dismiss) && lj.dismiss.off === false && lj.dismiss.consent === CONSENT && lj.dismiss.extra === EXTRA, liveJson('lj3'));
const kept = liveJson('lj1');
resetCount();
r = await gate(['lj1', 'https://live.example/lj1', buildUrl, '1440', 'j4', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('a cached live.png round leaves live.json byte-identical (no live capture)', r.status === 0 && attempts().join(',') === 'BUILD' && kept !== null && liveJson('lj1') === kept, `${attempts().join(',')} ${liveJson('lj1')}`);
unlinkSync(join(root, gdir('lj1'), 'live.png'));
r = await gate(['lj1', 'https://live.example/lj1', buildUrl, '1440', 'j5', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '1' });
check('a failed live (re)capture leaves neither live.png nor live.json', r.status === 1 && !existsSync(join(root, gdir('lj1'), 'live.png')) && liveJson('lj1') === null, `status ${r.status} ${liveJson('lj1')}`);
r = await gate(['lj4', 'https://live.example/lj4', buildUrl, '1440', 'j6', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '3' });
check('a blocked first live capture (exit 3) writes no live.json', r.status === 3 && !existsSync(join(root, gdir('lj4'), 'live.png')) && liveJson('lj4') === null, `status ${r.status}`);
// Retaking live.png (delete it) also drops the probes' live caches; chrome-live.json keeps its own rule; a cached round keeps them.
const probeCaches = ['content-live.json', 'visual-live.json', 'presence-live.json'];
const present = (slug) => [...probeCaches, 'chrome-live.json'].filter((f) => existsSync(join(root, gdir(slug), f)));
r = await gate(['lj5', 'https://live.example/lj5', buildUrl, '1440', 'j7', '--marker', 'home-proposed']);
[...probeCaches, 'chrome-live.json'].forEach((f) => writeFileSync(join(root, gdir('lj5'), f), '{}'));
r = await gate(['lj5', 'https://live.example/lj5', buildUrl, '1440', 'j8', '--marker', 'home-proposed']);
check('a cached live.png round keeps the probes\' live caches', r.status === 0 && present('lj5').length === 4, present('lj5').join(','));
unlinkSync(join(root, gdir('lj5'), 'live.png'));
r = await gate(['lj5', 'https://live.example/lj5', buildUrl, '1440', 'j9', '--marker', 'home-proposed']);
check('retaking live.png drops content-, visual- and presence-live.json; chrome-live.json is left alone', r.status === 0 && present('lj5').join(',') === 'chrome-live.json', present('lj5').join(','));

// overlay-left (header § Overlay dismissal): a capture whose final overlay check printed `overlay-left: <descriptor>`
// gives no verdict — exit 1 with one stderr line naming the side, never retried. A live one drops live.png, live.json
// and the probes' live caches before any build capture; a build one stops before pixel-compare and the overflow line.
// Both captures write their record (--json <gate dir>/<live|build>-shot.json); live.json records overlayLeft: null and
// the record's fontsFailed — a list = checked, null = not checked (the record's own null, or no readable record → null
// and one stderr note).
const OVL = 'div#promo-modal (fixed, 92 % of the viewport)';
const ovlLine = (side) => `gate.sh: overlay left on the ${side} capture — ${OVL} — no verdict: fix the capture (--consent / --dismiss / --hide), not the page`;
const flagValue = (argv, f) => (argv && argv.indexOf(f) > 0 ? argv[argv.indexOf(f) + 1] : undefined);
resetCount(); resetArgv();
r = await gate(['ovl1', 'https://live.example/ovl1', buildUrl, '1440', 'o1', '--marker', 'home-proposed'], { STUB_FONTS_LIVE: 'Brand Sans,Brand Serif', STUB_STITCH_ARGV: argvFile });
lj = liveJson('ovl1') ? JSON.parse(liveJson('ovl1')) : {};
check('a clean live capture records the overlay check in live.json: overlayLeft null, fontsFailed from its record', r.status === 0 && Object.hasOwn(lj, 'overlayLeft') && lj.overlayLeft === null
  && JSON.stringify(lj.fontsFailed) === '["Brand Sans","Brand Serif"]' && !/live-shot\.json/.test(r.stderr), `status ${r.status} ${liveJson('ovl1')} ${r.stderr}`);
check('both captures write their record: --json <gate dir>/live-shot.json and <gate dir>/build-shot.json, one argv value each', stitchArgv().map((a) => a[0]).join(',') === 'LIVE,BUILD'
  && flagValue(stitchArgv()[0], '--json') === `${gdir('ovl1')}/live-shot.json` && flagValue(stitchArgv()[1], '--json') === `${gdir('ovl1')}/build-shot.json`
  && existsSync(join(root, gdir('ovl1'), 'build-shot.json')), JSON.stringify(stitchArgv()));
check('the live capture\'s stdout is kept as live-capture.txt and still printed', evidence('ovl1', 'live-capture.txt') === `stitched ${gdir('ovl1')}/live.png\n`
  && r.stdout.includes(`stitched ${gdir('ovl1')}/live.png\n`), evidence('ovl1', 'live-capture.txt'));
r = await gate(['ovl2', 'https://live.example/ovl2', buildUrl, '1440', 'o2', '--marker', 'home-proposed'], { STUB_NO_JSON_LIVE: '1' });
lj = liveJson('ovl2') ? JSON.parse(liveJson('ovl2')) : {};
const notCheckedNote = /^gate\.sh: the live capture left no readable record \(stardust\/replica\/gates\/[a-z0-9]+-1440\/live-shot\.json\) — live\.json records fontsFailed: null \(not checked\)$/m;
check('a live capture with no record: live.json fontsFailed null (not checked) and one stderr note naming the record', r.status === 0 && lj.overlayLeft === null
  && Object.hasOwn(lj, 'fontsFailed') && lj.fontsFailed === null && notCheckedNote.test(r.stderr) && (r.stderr.match(/live-shot\.json/g) || []).length === 1, `status ${r.status} ${liveJson('ovl2')} ${r.stderr}`);
r = await gate(['fbad', 'https://live.example/fbad', buildUrl, '1440', 'f1', '--marker', 'home-proposed'], { STUB_BAD_JSON_LIVE: '1' });
lj = liveJson('fbad') ? JSON.parse(liveJson('fbad')) : {};
check('an unreadable record: fontsFailed null and the same one note', r.status === 0 && Object.hasOwn(lj, 'fontsFailed') && lj.fontsFailed === null
  && notCheckedNote.test(r.stderr) && (r.stderr.match(/live-shot\.json/g) || []).length === 1, `status ${r.status} ${liveJson('fbad')} ${r.stderr}`);
r = await gate(['fnull', 'https://live.example/fnull', buildUrl, '1440', 'f2', '--marker', 'home-proposed'], { STUB_FONTS_NULL_LIVE: '1' });
lj = liveJson('fnull') ? JSON.parse(liveJson('fnull')) : {};
check('a record whose font check could not run (fontsFailed null): live.json fontsFailed null, no note — never [] (all loaded)', r.status === 0
  && Object.hasOwn(lj, 'fontsFailed') && lj.fontsFailed === null && !/live-shot\.json/.test(r.stderr), `status ${r.status} ${liveJson('fnull')} ${r.stderr}`);
r = await gate(['fnone', 'https://live.example/fnone', buildUrl, '1440', 'f3', '--marker', 'home-proposed']);
lj = liveJson('fnone') ? JSON.parse(liveJson('fnone')) : {};
check('a record whose check ran and found nothing: fontsFailed [] carried as checked', r.status === 0 && Array.isArray(lj.fontsFailed) && lj.fontsFailed.length === 0
  && !/live-shot\.json/.test(r.stderr), `status ${r.status} ${liveJson('fnone')} ${r.stderr}`);
mkdirSync(join(root, gdir('ovl3')), { recursive: true });
probeCaches.forEach((f) => writeFileSync(join(root, gdir('ovl3'), f), '{}'));
resetCount();
r = await gate(['ovl3', 'https://live.example/ovl3', buildUrl, '1440', 'o3', '--full', '--marker', 'home-proposed'], { STUB_OVERLAY_LIVE: OVL, STUB_STITCH_COUNT: countFile });
check('an overlay left on the live capture: exit 1, one stderr line naming the live capture, the descriptor and "no verdict"', r.status === 1 && r.stderr.includes(`${ovlLine('live')}\n`)
  && (r.stderr.match(/no verdict/g) || []).length === 1, `status ${r.status} ${r.stderr}`);
check('… live.png, live.json and the probes\' live caches are removed (the next round retakes it)', ['live.png', 'live.json', ...probeCaches].every((f) => !existsSync(join(root, gdir('ovl3'), f))), present('ovl3').join(','));
check('… never retried, no build capture, no pixel-compare, no overflow line, no probe', attempts().join(',') === 'LIVE' && !/retrying/.test(r.stderr)
  && !/differing|overflow assert|OVERFLOW/.test(r.stdout) && !existsSync(join(root, gdir('ovl3'), 'content-diff-o3.txt')), `${attempts().join(',')} ${r.stdout}`);
resetCount();
r = await gate(['ovl1', 'https://live.example/ovl1', buildUrl, '1440', 'o4', '--full', '--marker', 'home-proposed'], { STUB_OVERLAY_BUILD: OVL, STUB_STITCH_COUNT: countFile });
check('an overlay left on the build capture: exit 1, one stderr line naming the build capture', r.status === 1 && r.stderr.includes(`${ovlLine('build')}\n`)
  && (r.stderr.match(/no verdict/g) || []).length === 1 && /^overlay-left: /m.test(evidence('ovl1', 'overflow-o4.txt')), `status ${r.status} ${r.stderr}`);
check('… never retried, no pixel verdict, no overflow verdict line, no probe; the cached live.png stays', attempts().join(',') === 'BUILD' && !/retrying/.test(r.stderr)
  && !/differing|overflow assert|OVERFLOW/.test(r.stdout) && !existsSync(join(root, gdir('ovl1'), 'content-diff-o4.txt')) && existsSync(join(root, gdir('ovl1'), 'live.png')), `${attempts().join(',')} ${r.stdout}`);

// A hide that matched nothing on live (header § --hide): the live capture's record (live-shot.json) carries
// hideMiss { sels, candidates } → one stderr line, hideMissLine's text (`<selector> (<tag>, <h>px)` joined '; ', a 0-px
// entry `0px now — …`, none → `none found above the header`, then the missed selectors) — after the live capture and
// again on a round that reuses that live.png; never a verdict (stdout and exit code those of a round without it). A
// build record's hideMiss is no live warning; an overlay-left live capture still names its miss before the no-verdict line.
const MISS = { sels: ['.geo-bar', '#top .location-bar'], candidates: [
  { tag: 'div', id: 'geo-suggest', classes: [], top: 0, height: 48, selector: '#geo-suggest' },
  { tag: 'aside', id: '', classes: ['region-wrap', 'js-geo'], top: 48, height: 0, selector: 'aside.region-wrap' },
  { tag: 'div', id: '', classes: ['strip'], top: 48, height: 31.6, selector: 'body > div:nth-of-type(2)' }] };
const MISS_LINE = 'gate.sh: WARNING hide matched nothing on live — candidates: #geo-suggest (div, 48px); aside.region-wrap (aside, 0px now — a block that grows later is still hidden by the persistent display:none !important rule); body > div:nth-of-type(2) (div, 32px) (.geo-bar, #top .location-bar)';
const warnings = (stderr) => stderr.split('\n').filter((l) => /WARNING/.test(l));
const missRound = (slug, lbl, env = {}) => gate([slug, `https://live.example/${slug}`, buildUrl, '1440', lbl, '--marker', 'home-proposed', '--hide', '.geo-bar, #top .location-bar'], { STUB_STITCH_COUNT: countFile, ...env });
const r0 = await missRound('miss0', 'x1');
resetCount();
r = await missRound('miss1', 'x1', { STUB_HIDEMISS_LIVE: JSON.stringify(MISS) });
check('a live record with hideMiss: one stderr WARNING line, hideMissLine\'s text (a 0-px candidate named as such)', r.status === 0 && attempts().join(',') === 'LIVE,BUILD'
  && JSON.stringify(warnings(r.stderr)) === JSON.stringify([MISS_LINE]), `status ${r.status} ${attempts().join(',')} ${r.stderr}`);
check('… never a verdict: stdout and the exit code are those of the same round without a miss (which warns nothing)', warnings(r0.stderr).length === 0
  && r.status === r0.status && r.stdout.replaceAll('miss1', 'S') === r0.stdout.replaceAll('miss0', 'S'), `${r.stdout}\n---\n${r0.stdout}`);
resetCount();
r = await missRound('miss1', 'x2', { STUB_PIXEL_RC: '2' });
check('a reused live.png whose live-shot.json carries hideMiss warns again (no live capture); a FAIL stays exit 2', r.status === 2 && attempts().join(',') === 'BUILD'
  && JSON.stringify(warnings(r.stderr)) === JSON.stringify([MISS_LINE]), `status ${r.status} ${attempts().join(',')} ${r.stderr}`);
r = await missRound('miss2', 'x1', { STUB_HIDEMISS_LIVE: JSON.stringify({ sels: ['.geo-bar'], candidates: [] }) });
check('no candidates: `none found above the header`', r.status === 0 && JSON.stringify(warnings(r.stderr))
  === JSON.stringify(['gate.sh: WARNING hide matched nothing on live — candidates: none found above the header (.geo-bar)']), `status ${r.status} ${r.stderr}`);
r = await missRound('miss3', 'x1', { STUB_HIDEMISS_BUILD: JSON.stringify(MISS) });
check('a hideMiss in the build record only: no live warning', r.status === 0 && warnings(r.stderr).length === 0, `status ${r.status} ${r.stderr}`);
r = await missRound('miss4', 'x1', { STUB_HIDEMISS_LIVE: JSON.stringify(MISS), STUB_OVERLAY_LIVE: OVL });
check('an overlay-left live capture: the WARNING line, then the no-verdict line, exit 1', r.status === 1 && JSON.stringify(warnings(r.stderr)) === JSON.stringify([MISS_LINE])
  && r.stderr.indexOf(MISS_LINE) < r.stderr.indexOf(ovlLine('live')) && r.stderr.includes(ovlLine('live')), `status ${r.status} ${r.stderr}`);

// --hide (in-flow per-visitor regions): ONE effective list — the --hide list, then presence.json's "*" and <slug> `hide`
// — reaches both stitched captures and every --full probe as one --hide value (split, trimmed, de-duplicated, joined
// with ','); chrome-parity keeps the flag value as given plus --presence <file> --slug <slug> (it reads the file's `hide`
// itself). Independent of --no-dismiss. presence.json: this regime's sidecar first (prototype → gates/prototypes-<w>/,
// published → gates/all-<w>/), then the other stage's.
const HIDE = '.geo-bar, .location-bar';
const PROBE_FILES = (l) => [`content-diff-${l}.txt`, `visual-diff-${l}.txt`, `clip-${l}.txt`, `content-presence-${l}.txt`];
resetArgv();
r = await gate(['hide1', 'https://live.example/hide1', buildUrl, '1440', 'h1', '--full', '--marker', 'home-proposed', '--hide', HIDE], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('--hide reaches the live and the build capture as one --hide value, the list trimmed and comma-joined', r.status === 0
  && stitchArgv().map((a) => a[0]).join(',') === 'LIVE,BUILD' && stitchArgv().every((a) => hideArg(a) === '.geo-bar,.location-bar'), `status ${r.status} | ${JSON.stringify(stitchArgv())}`);
check('--hide reaches content-diff, visual-diff, clip-probe and content-presence (published regime) as the same one value',
  PROBE_FILES('h1').every((f) => hideArg(argvIn(evidence('hide1', f))) === '.geo-bar,.location-bar'), PROBE_FILES('h1').map((f) => evidence('hide1', f)).join(' | '));
check('chrome-parity still gets the --hide value as given: one argv value, after its live cache', hideArg(argvIn(evidence('hide1', 'chrome-parity-h1.txt'))) === HIDE
  && new RegExp(`--live-cache \\S+ --hide ${HIDE}$`, 'm').test(evidence('hide1', 'chrome-parity-h1.txt')), evidence('hide1', 'chrome-parity-h1.txt'));
check('live.json records the effective list', JSON.stringify(JSON.parse(liveJson('hide1') || '{}').hide) === '[".geo-bar",".location-bar"]', liveJson('hide1'));
resetArgv();
r = await gate(['hide1', 'https://live.example/hide1', buildUrl, '1440', 'h2', '--full', '--marker', 'home-proposed', '--no-dismiss', '--hide', '.geo-bar'], { STUB_STITCH_ARGV: argvFile });
check('--hide is independent of --no-dismiss: no contradiction, chrome-parity still gets it', r.status === 0 && /--live-cache \S+ --hide \.geo-bar$/m.test(evidence('hide1', 'chrome-parity-h2.txt')), `status ${r.status} ${r.stderr}`);
check('--no-dismiss and --hide reach both captures together', stitchArgv().length === 2 && stitchArgv().every((a) => a.includes('--no-dismiss') && hideArg(a) === '.geo-bar'), JSON.stringify(stitchArgv()));
check('a changed list retakes live.png and says so in one line (lists comma-separated)', /^gate\.sh: live\.png was taken hiding \[\.geo-bar, \.location-bar\]; this round hides \[\.geo-bar\] — retaking it$/m.test(r.stderr), r.stderr);
r = await gate(['hide1', 'https://live.example/hide1', buildUrl, '1440', 'h3', '--full', '--marker', 'home-proposed', '--dismiss', EXTRA, '--hide', '.geo-bar']);
check('--hide joins the overlay flags on chrome-parity\'s argv', r.status === 0 && new RegExp(`--live-cache \\S+ --dismiss ${EXTRA} --hide \\.geo-bar$`, 'm').test(evidence('hide1', 'chrome-parity-h3.txt')), evidence('hide1', 'chrome-parity-h3.txt'));
// --hide is repeatable: the values accumulate (chrome-parity gets them joined, as given); the effective list dedupes.
resetArgv();
r = await gate(['hidem', 'https://live.example/hidem', buildUrl, '1440', 'm1', '--full', '--marker', 'home-proposed', '--hide', '.geo-bar', '--hide', '.location-bar, .geo-bar'], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('a repeated --hide: every value reaches both captures and the 4 probes (deduped), chrome-parity and live.json', r.status === 0
  && stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === '.geo-bar,.location-bar')
  && PROBE_FILES('m1').every((f) => hideArg(argvIn(evidence('hidem', f))) === '.geo-bar,.location-bar')
  && hideArg(argvIn(evidence('hidem', 'chrome-parity-m1.txt'))) === '.geo-bar,.location-bar, .geo-bar'
  && JSON.stringify(JSON.parse(liveJson('hidem') || '{}').hide) === '[".geo-bar",".location-bar"]', `status ${r.status} ${JSON.stringify(stitchArgv())} ${evidence('hidem', 'chrome-parity-m1.txt')}`);
// The probes' quoting: a selector with a space arrives inside ONE argument at each probe.
r = await gate(['hideq', 'https://live.example/hideq', buildUrl, '1440', 'q1', '--full', '--marker', 'home-proposed', '--hide', '#top .location-bar'], { GATE_REGIME: 'published' });
check('a selector with a space reaches content-diff, visual-diff, content-presence and clip-probe as one argv value', r.status === 0
  && PROBE_FILES('q1').every((f) => hideArg(argvIn(evidence('hideq', f))) === '#top .location-bar'), PROBE_FILES('q1').map((f) => evidence('hideq', f)).join(' | '));
r = await gate(['hide1', 'https://live.example/hide1', buildUrl, '1440', 'h4', '--hide']);
check('--hide without a selector list is a usage error (exit 125)', r.status === 125 && /--hide needs a selector list/.test(r.stderr), `status ${r.status} ${r.stderr}`);
r = await gate(['hide1', 'https://live.example/hide1', buildUrl, '1440', 'h5', '--hide', '--full']);
check('--hide followed by a flag is a usage error too (the flag is not taken as a selector)', r.status === 125 && /--hide needs a selector list/.test(r.stderr), `status ${r.status} ${r.stderr}`);
// live.json's `hide` and the retake: a live.png taken hiding a different list (ordered, after the same dedupe; a missing
// field = []) is retaken with one line and the probes' live caches go with it; the same list reuses it; no live.json →
// retaken (with hides: the hide-list line; without: it predates the overlay-left check). A live.json without overlayLeft
// is retaken once too (one line: the hide-list one when the list differs as well); a recorded overlay is never reused.
const rtLine = (o, n) => `gate.sh: live.png was taken hiding [${o}]; this round hides [${n}] — retaking it`;
const rtHide = () => JSON.stringify((JSON.parse(liveJson('rt1') || '{}')).hide);
const rt = (lbl, extra = []) => gate(['rt1', 'https://live.example/rt1', buildUrl, '1440', lbl, '--marker', 'home-proposed', ...extra], { STUB_STITCH_COUNT: countFile, STUB_STITCH_ARGV: argvFile });
resetCount(); resetArgv();
r = await rt('r1', ['--hide', '.geo-bar']);
check('a first round with --hide captures live and records its list', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && rtHide() === '[".geo-bar"]', `status ${r.status} ${attempts().join(',')} ${liveJson('rt1')}`);
writeFileSync(join(root, gdir('rt1'), 'content-live.json'), '{}');
resetCount(); resetArgv();
r = await rt('r2', ['--hide', '#top .location-bar']);
check('a different list retakes live.png: the line, a second LIVE capture, the new list in live.json, the probe live caches dropped', r.status === 0
  && r.stderr.includes(rtLine('.geo-bar', '#top .location-bar')) && attempts().join(',') === 'LIVE,BUILD' && rtHide() === '["#top .location-bar"]'
  && !existsSync(join(root, gdir('rt1'), 'content-live.json')), `status ${r.status} ${attempts().join(',')} ${r.stderr} ${liveJson('rt1')}`);
check('a selector with a space stays one argv value on both captures', stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === '#top .location-bar'), JSON.stringify(stitchArgv()));
resetCount();
r = await rt('r3', ['--hide', ' #top .location-bar ,, #top .location-bar ']);
check('the same list (after trim and dedupe) reuses live.png: no line, build only', r.status === 0 && !/retaking/.test(r.stderr) && attempts().join(',') === 'BUILD', `${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await rt('r4');
check('dropping the list retakes too (hides [] this round)', r.status === 0 && r.stderr.includes(rtLine('#top .location-bar', '')) && attempts().join(',') === 'LIVE,BUILD' && rtHide() === '[]', `${attempts().join(',')} ${r.stderr}`);
const legacy = JSON.parse(liveJson('rt1')); delete legacy.hide; writeFileSync(join(root, gdir('rt1'), 'live.json'), JSON.stringify(legacy));
resetCount();
r = await rt('r5');
check('a live.json without the hide field reads as []: a round without hides reuses live.png', r.status === 0 && !/retaking/.test(r.stderr) && attempts().join(',') === 'BUILD', `${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await rt('r6', ['--hide', '.geo-bar']);
check('… and a round with hides retakes it', r.status === 0 && r.stderr.includes(rtLine('', '.geo-bar')) && attempts().join(',') === 'LIVE,BUILD', `${attempts().join(',')} ${r.stderr}`);
unlinkSync(join(root, gdir('rt1'), 'live.json'));
resetCount();
r = await rt('r7');
const predates = 'gate.sh: live.png predates the overlay-left check — retaking it';
check('no live.json and no hides: live.png predates the overlay-left check — retaken with one line, the record written', r.status === 0 && r.stderr.includes(predates)
  && (r.stderr.match(/retaking/g) || []).length === 1 && attempts().join(',') === 'LIVE,BUILD' && JSON.parse(liveJson('rt1') || '{}').overlayLeft === null, `${attempts().join(',')} ${r.stderr} ${liveJson('rt1')}`);
rmSync(join(root, gdir('rt1'), 'live.json'), { force: true });
resetCount(); resetArgv();
r = await rt('r8', ['--hide', '.location-bar']);
check('no live.json and a hide list: live.png is retaken with one line, the list recorded', r.status === 0
  && r.stderr.includes('gate.sh: live.png has no live.json record; this round hides [.location-bar] — retaking it') && (r.stderr.match(/retaking/g) || []).length === 1
  && attempts().join(',') === 'LIVE,BUILD' && stitchArgv().every((a) => hideArg(a) === '.location-bar') && rtHide() === '[".location-bar"]', `${attempts().join(',')} ${r.stderr} ${liveJson('rt1')}`);
const rewriteLive = (edit) => { const j = JSON.parse(liveJson('rt1') || '{}'); edit(j); writeFileSync(join(root, gdir('rt1'), 'live.json'), JSON.stringify(j)); };
rewriteLive((j) => delete j.overlayLeft);
resetCount();
r = await rt('r9', ['--hide', '.location-bar']);
check('a live.json without overlayLeft (same hide list): retaken with one line — it predates the overlay-left check', r.status === 0 && r.stderr.includes(predates)
  && (r.stderr.match(/retaking/g) || []).length === 1 && attempts().join(',') === 'LIVE,BUILD' && Object.hasOwn(JSON.parse(liveJson('rt1') || '{}'), 'overlayLeft'), `${attempts().join(',')} ${r.stderr}`);
rewriteLive((j) => delete j.overlayLeft);
resetCount();
r = await rt('r10');
check('… and with a different hide list as well: the hide-list line only, one retake', r.status === 0 && r.stderr.includes(rtLine('.location-bar', ''))
  && (r.stderr.match(/retaking/g) || []).length === 1 && attempts().join(',') === 'LIVE,BUILD', `${attempts().join(',')} ${r.stderr}`);
rewriteLive((j) => { j.overlayLeft = '#cmp-root (consent root visible)'; });
resetCount();
r = await rt('r11');
check('a live.json that records an overlay left is never reused: retaken with one line naming it', r.status === 0
  && r.stderr.includes('gate.sh: live.png\'s live.json records an overlay left (#cmp-root (consent root visible)) — retaking it')
  && (r.stderr.match(/retaking/g) || []).length === 1 && attempts().join(',') === 'LIVE,BUILD' && JSON.parse(liveJson('rt1') || '{}').overlayLeft === null, `${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await rt('r12');
check('a live.json recording overlayLeft null and the same list is reused (no line, build only)', r.status === 0 && !/retaking/.test(r.stderr) && attempts().join(',') === 'BUILD', `${attempts().join(',')} ${r.stderr}`);
const presenceFile = (stage) => `stardust/replica/gates/${stage}-1440/presence.json`;
const writePresence = (stage) => { mkdirSync(join(root, dirname(presenceFile(stage))), { recursive: true }); writeFileSync(join(root, presenceFile(stage)), JSON.stringify({ pres1: { variable: ['.geo-bar'] } })); };
writePresence('prototypes'); writePresence('all');
resetArgv();
r = await gate(['pres1', 'https://live.example/pres1', buildUrl, '1440', 'p1', '--full', '--marker', 'home-proposed'], { STUB_STITCH_ARGV: argvFile });
check('prototype regime: gates/prototypes-<w>/presence.json reaches chrome-parity as --presence <file> --slug <slug>', r.status === 0 && new RegExp(`--live-cache \\S+ --presence ${presenceFile('prototypes')} --slug pres1$`, 'm').test(evidence('pres1', 'chrome-parity-p1.txt')), evidence('pres1', 'chrome-parity-p1.txt'));
check('a presence.json without `hide` adds no --hide to any capture or probe', stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === undefined)
  && ['content-diff-p1.txt', 'visual-diff-p1.txt', 'clip-p1.txt', 'chrome-parity-p1.txt'].every((f) => { const a = argvIn(evidence('pres1', f)); return a && hideArg(a) === undefined; }), JSON.stringify(stitchArgv()));
r = await gate(['pres1', 'https://live.example/pres1', buildUrl, '1440', 'p2', '--full', '--marker', 'home-proposed'], { GATE_REGIME: 'published' });
check('published regime: gates/all-<w>/presence.json is preferred', r.status === 0 && new RegExp(`--presence ${presenceFile('all')} --slug pres1$`, 'm').test(evidence('pres1', 'chrome-parity-p2.txt')), evidence('pres1', 'chrome-parity-p2.txt'));
unlinkSync(join(root, presenceFile('prototypes')));
r = await gate(['pres1', 'https://live.example/pres1', buildUrl, '1440', 'p3', '--full', '--marker', 'home-proposed', '--hide', '.promo-strip']);
check('prototype regime with only gates/all-<w>/presence.json: the other stage\'s file is passed (after --hide)', r.status === 0 && new RegExp(`--hide \\.promo-strip --presence ${presenceFile('all')} --slug pres1$`, 'm').test(evidence('pres1', 'chrome-parity-p3.txt')), evidence('pres1', 'chrome-parity-p3.txt'));
check('--presence <file> reaches chrome-parity only', ['content-diff-p3.txt', 'visual-diff-p3.txt', 'clip-p3.txt'].every((f) => /^argv /m.test(evidence('pres1', f)) && !/--presence/.test(evidence('pres1', f))));
unlinkSync(join(root, presenceFile('all')));
r = await gate(['pres1', 'https://live.example/pres1', buildUrl, '1440', 'p4', '--full', '--marker', 'home-proposed']);
check('no presence.json: no --presence flag', r.status === 0 && /^argv /m.test(evidence('pres1', 'chrome-parity-p4.txt')) && !/--presence|--slug/.test(evidence('pres1', 'chrome-parity-p4.txt')), evidence('pres1', 'chrome-parity-p4.txt'));
// presence.json `hide` in the discovered file: "*" (every slug) then <slug>, after the --hide list → one effective list
// for the captures and the probes; chrome-parity gets --presence <file> --slug <slug> and only the flag list in --hide.
mkdirSync(join(root, dirname(presenceFile('prototypes'))), { recursive: true });
writeFileSync(join(root, presenceFile('prototypes')), JSON.stringify({ '*': { hide: ['.geo-bar'] }, home: { hide: ['.promo-strip'] } }));
resetArgv();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ph1', '--full'], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('presence.json "*" then <slug> `hide` reach both captures as one --hide .geo-bar,.promo-strip', r.status === 0 && stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === '.geo-bar,.promo-strip'), `status ${r.status} ${JSON.stringify(stitchArgv())} ${r.stderr}`);
check('… and content-diff, visual-diff, clip-probe and content-presence', PROBE_FILES('ph1').every((f) => hideArg(argvIn(evidence('home', f))) === '.geo-bar,.promo-strip'), PROBE_FILES('ph1').map((f) => evidence('home', f)).join(' | '));
check('chrome-parity gets --presence <file> --slug home and no --hide (it reads the file\'s hide itself)', (() => { const a = argvIn(evidence('home', 'chrome-parity-ph1.txt')); return Boolean(a) && hideArg(a) === undefined && a.join(' ').endsWith(`--presence ${presenceFile('prototypes')} --slug home`); })(), evidence('home', 'chrome-parity-ph1.txt'));
resetArgv();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ph2', '--full', '--hide', '.location-bar, .geo-bar'], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('the --hide list comes first, presence entries follow, de-duplicated', r.status === 0 && stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === '.location-bar,.geo-bar,.promo-strip')
  && PROBE_FILES('ph2').every((f) => hideArg(argvIn(evidence('home', f))) === '.location-bar,.geo-bar,.promo-strip'), `status ${r.status} ${JSON.stringify(stitchArgv())}`);
check('chrome-parity: only the flag list in its --hide, then --presence <file> --slug home', hideArg(argvIn(evidence('home', 'chrome-parity-ph2.txt'))) === '.location-bar, .geo-bar'
  && new RegExp(`--hide \\.location-bar, \\.geo-bar --presence ${presenceFile('prototypes')} --slug home$`, 'm').test(evidence('home', 'chrome-parity-ph2.txt')), evidence('home', 'chrome-parity-ph2.txt'));
resetArgv();
r = await gate(['star1', 'https://live.example/star1', buildUrl, '1440', 's1', '--marker', 'home-proposed'], { STUB_STITCH_ARGV: argvFile });
check('"*" applies to every slug: another slug\'s captures hide .geo-bar only, and its live.json says so', r.status === 0 && stitchArgv().length === 2 && stitchArgv().every((a) => hideArg(a) === '.geo-bar')
  && JSON.stringify(JSON.parse(liveJson('star1') || '{}').hide) === '[".geo-bar"]', `status ${r.status} ${JSON.stringify(stitchArgv())}`);
writeFileSync(join(root, presenceFile('prototypes')), '{ "home": { "hide": [".geo-bar"');
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'pm1', '--full'], { STUB_STITCH_COUNT: countFile });
check('a malformed presence.json: exit 1 with one stderr line naming the file, before any capture', r.status === 1 && r.stderr.trim().split('\n').length === 1
  && /^gate\.sh: presence\.json stardust\/replica\/gates\/prototypes-1440\/presence\.json unreadable \(.+\) — fix or delete it; nothing captured$/.test(r.stderr.trim())
  && attempts().length === 0 && !/differing/.test(r.stdout), `status ${r.status} ${r.stderr} ${attempts().join(',')}`);
unlinkSync(join(root, presenceFile('prototypes')));
// The site-wide stardust/replica/presence.json merges UNDER the gate-dir file: per top-level key, per field, the gate
// dir's value wins; keys / fields only one file has are kept. chrome-parity gets --presence <gate-dir file>, else the
// site file. A malformed site file is refused like a gate-dir one: exit 1 naming it, before any capture.
const SITE = 'stardust/replica/presence.json';
writeFileSync(join(root, SITE), JSON.stringify({ '*': { hide: ['.geo-bar'] }, sitep: { hide: ['.promo-strip'] } }));
resetArgv();
r = await gate(['sitep', 'https://live.example/sitep', buildUrl, '1440', 'sp1', '--full', '--marker', 'home-proposed', '--hide', '.location-bar'], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('site file only: its "*" then <slug> `hide` follow --hide on both captures and live.json', r.status === 0 && stitchArgv().length === 2
  && stitchArgv().every((a) => hideArg(a) === '.location-bar,.geo-bar,.promo-strip') && JSON.stringify(JSON.parse(liveJson('sitep') || '{}').hide) === '[".location-bar",".geo-bar",".promo-strip"]', `status ${r.status} ${JSON.stringify(stitchArgv())} ${r.stderr}`);
check('… and content-diff, visual-diff, clip-probe and content-presence', PROBE_FILES('sp1').every((f) => hideArg(argvIn(evidence('sitep', f))) === '.location-bar,.geo-bar,.promo-strip'), PROBE_FILES('sp1').map((f) => evidence('sitep', f)).join(' | '));
check('… chrome-parity gets the flag list, then --presence stardust/replica/presence.json --slug sitep', new RegExp(`--hide \\.location-bar --presence ${SITE} --slug sitep$`, 'm').test(evidence('sitep', 'chrome-parity-sp1.txt')), evidence('sitep', 'chrome-parity-sp1.txt'));
writeFileSync(join(root, presenceFile('prototypes')), JSON.stringify({ '*': { hide: ['.location-bar'] }, sitep: { variable: ['.hero-media'] } }));
resetArgv();
r = await gate(['sitep', 'https://live.example/sitep', buildUrl, '1440', 'sp2', '--full', '--marker', 'home-proposed'], { STUB_STITCH_ARGV: argvFile });
check('gate dir wins per field: its "*".hide replaces the site\'s, the site\'s <slug>.hide stays (the gate entry has none)', r.status === 0 && stitchArgv().length === 2
  && stitchArgv().every((a) => hideArg(a) === '.location-bar,.promo-strip') && PROBE_FILES('sp2').filter((f) => !f.startsWith('content-presence')).every((f) => hideArg(argvIn(evidence('sitep', f))) === '.location-bar,.promo-strip'), `status ${r.status} ${JSON.stringify(stitchArgv())} ${r.stderr}`);
check('… chrome-parity gets --presence <gate-dir file> --slug sitep', (() => { const a = argvIn(evidence('sitep', 'chrome-parity-sp2.txt')); return Boolean(a) && hideArg(a) === undefined && a.join(' ').endsWith(`--presence ${presenceFile('prototypes')} --slug sitep`); })(), evidence('sitep', 'chrome-parity-sp2.txt'));
writeFileSync(join(root, SITE), '{ "*": { "hide": [".geo-bar"');
resetCount();
r = await gate(['sitep', 'https://live.example/sitep', buildUrl, '1440', 'sp3', '--full', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('a malformed site file (beside a valid gate-dir file): exit 1 with one stderr line naming it, before any capture', r.status === 1 && r.stderr.trim().split('\n').length === 1
  && /^gate\.sh: presence\.json stardust\/replica\/presence\.json unreadable \(.+\) — fix or delete it; nothing captured$/.test(r.stderr.trim())
  && attempts().length === 0 && !/differing/.test(r.stdout), `status ${r.status} ${r.stderr} ${attempts().join(',')}`);
unlinkSync(join(root, SITE)); unlinkSync(join(root, presenceFile('prototypes')));
// The site file alone (no --hide, no gate-dir presence.json in either stage): its list still reaches both captures, the
// probes and live.json; chrome-parity gets --presence <site file> and no --hide. Malformed in that setup: refused alike.
writeFileSync(join(root, SITE), JSON.stringify({ '*': { hide: ['.geo-bar'] }, siteonly: { hide: ['.promo-strip'] } }));
resetArgv();
r = await gate(['siteonly', 'https://live.example/siteonly', buildUrl, '1440', 'so1', '--full', '--marker', 'home-proposed'], { GATE_REGIME: 'published', STUB_STITCH_ARGV: argvFile });
check('site file only, no --hide and no gate-dir file: both captures and live.json get its "*" then <slug> hide', r.status === 0
  && !existsSync(join(root, presenceFile('prototypes'))) && !existsSync(join(root, presenceFile('all'))) && stitchArgv().length === 2
  && stitchArgv().every((a) => hideArg(a) === '.geo-bar,.promo-strip') && JSON.stringify(JSON.parse(liveJson('siteonly') || '{}').hide) === '[".geo-bar",".promo-strip"]', `status ${r.status} ${JSON.stringify(stitchArgv())} ${r.stderr}`);
check('… content-diff, visual-diff, clip-probe and content-presence get the same list', PROBE_FILES('so1').every((f) => hideArg(argvIn(evidence('siteonly', f))) === '.geo-bar,.promo-strip'), PROBE_FILES('so1').map((f) => evidence('siteonly', f)).join(' | '));
check('… chrome-parity gets no --hide, then --presence stardust/replica/presence.json --slug siteonly', (() => { const a = argvIn(evidence('siteonly', 'chrome-parity-so1.txt')); return Boolean(a) && hideArg(a) === undefined && a.join(' ').endsWith(`--presence ${SITE} --slug siteonly`); })(), evidence('siteonly', 'chrome-parity-so1.txt'));
writeFileSync(join(root, SITE), '{ "siteonly": { "hide": [".promo-strip"');
resetCount();
r = await gate(['siteonly', 'https://live.example/siteonly', buildUrl, '1440', 'so2', '--full', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('a malformed site file with no --hide and no gate-dir file: exit 1, one stderr line naming it, before any capture', r.status === 1 && r.stderr.trim().split('\n').length === 1
  && /^gate\.sh: presence\.json stardust\/replica\/presence\.json unreadable \(.+\) — fix or delete it; nothing captured$/.test(r.stderr.trim())
  && attempts().length === 0 && !/differing/.test(r.stdout), `status ${r.status} ${r.stderr} ${attempts().join(',')}`);
unlinkSync(join(root, SITE));

// A stale project copy of stitch-shot (from before the capture record: it rejects the flag, exit 1 — twice, read as
// "re-queue the round"): no verdict before any capture, one stderr line naming the file and the fix.
const stitchShot = join(replica, 'stitch-shot.mjs'); const currentStitch = readFileSync(stitchShot, 'utf8');
check('the stub stitch-shot takes --json (the stale-copy check lets it through)', currentStitch.includes('--json'));
stub(replica, 'stitch-shot.mjs', `
  import { appendFileSync } from 'node:fs';
  if (process.env.STUB_STITCH_COUNT) appendFileSync(process.env.STUB_STITCH_COUNT, 'STALE\\n');
  const known = ['--width', '--settle', '--locale', '--hide', '--consent', '--dismiss', '--no-dismiss', '--vh'];
  const bad = process.argv.slice(4).find((a) => a.startsWith('--') && !known.includes(a));
  if (bad) { console.error('stitch-shot error: unknown flag ' + bad); process.exit(1); }`);
resetCount();
r = await gate(['stale1', 'https://live.example/stale1', buildUrl, '1440', 'st1', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('a stitch-shot.mjs that predates --json: exit 1 before any capture, one stderr line naming the file and the fix (no verdict)', r.status === 1 && attempts().length === 0
  && r.stderr.trim() === `gate.sh: ${replica}/stitch-shot.mjs predates the --json capture record — re-copy it from the plugin (no verdict)`
  && !existsSync(join(root, gdir('stale1'), 'live.png')), `status ${r.status} ${r.stderr} ${attempts().join(',')}`);
writeFileSync(stitchShot, currentStitch);

server.close();
if (process.env.GATE_TEST_KEEP) console.log(`sandbox kept at ${root} (build url was ${buildUrl})`);
else rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

