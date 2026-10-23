#!/usr/bin/env node
// gate.sh contract test: argument parsing, --help, the horizontal-overflow assert (measure.mjs root line → exit 2
// over a PASS pixel line), the one capture retry on exit 1 (live, build, overflow probe; 3 / 4 / 124 final — 3 is the
// BLOCKED line: a bot challenge or 2xx denial page, no verdict, on either side), the --full probe fan-out and its
// exit-code rules, the overlay flags (--consent / --dismiss / --no-dismiss reaching both captures, the diff probes and
// chrome-parity), with stub instruments (no browser, no network).
// Run: node skills/replica/scripts/test/gate.test.mjs
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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
// STUB_STITCH_COUNT so a test can count attempts, and its side + argv to STUB_STITCH_ARGS so a test can read the flags. measure: the root line gate.sh reads (STUB_OVERFLOW px over the
// viewport, STUB_MEASURE_RC exit code, STUB_MEASURE_NO_ROOT drops the line).
const stub = (dir, name, body) => writeFileSync(join(dir, name), `#!/usr/bin/env node\n${body}\n`);
// The stub captures; the browserless bookkeeping subcommands (\`baseline\`, \`record\`) are the real stitch-shot's, so
// gate.sh's baseline check and live.json go through the plugin's own reader and writer. STUB_RECORD_FAIL makes
// \`record\` exit 1 (a failed write).
const REAL_STITCH = join(scripts, 'stitch-shot.mjs');
stub(replica, 'stitch-shot.mjs', `
  import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
  if (process.argv[2] === 'record' && process.env.STUB_RECORD_FAIL) { console.error('stitch-shot record: stub failure (STUB_RECORD_FAIL)'); process.exit(1); }
  if (process.argv[2] === 'record' || process.argv[2] === 'baseline') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [${JSON.stringify(REAL_STITCH)}, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  const url = process.argv[2]; const out = process.argv[3];
  const side = /^https:\\/\\/live\\.example/.test(url) ? 'LIVE' : 'BUILD';
  if (process.env.STUB_STITCH_COUNT) appendFileSync(process.env.STUB_STITCH_COUNT, side + '\\n');
  if (process.env.STUB_STITCH_ARGS) appendFileSync(process.env.STUB_STITCH_ARGS, side + ' ' + process.argv.slice(2).join(' ') + '\\n');
  const once = process.env['STUB_FAIL_ONCE_' + side];
  if (once && !existsSync(once)) { writeFileSync(once, '1'); console.error('stitch-shot error: Target page, context or browser has been closed'); process.exit(1); }
  const rc = Number(process.env['STUB_STITCH_RC_' + side] || 0);
  if (rc) { console.error('stitch-shot error: stub exit ' + rc); process.exit(rc); }
  writeFileSync(out, 'png'); writeFileSync(out.replace(/\.png$/, '.capture.json'), JSON.stringify({ fixedLayers: { capture: 'once', count: 0 } })); console.log('stitched ' + out);`);
stub(replica, 'measure.mjs', `
  import { appendFileSync } from 'node:fs';
  if (process.env.STUB_MEASURE_COUNT) appendFileSync(process.env.STUB_MEASURE_COUNT, 'M\\n');
  const rc = Number(process.env.STUB_MEASURE_RC || 0);
  if (rc) { console.error('measure: ' + process.argv[2] + ' failed to load — stub exit ' + rc); process.exit(rc); }
  const w = Number(process.argv[process.argv.indexOf('--width') + 1]); const o = Number(process.env.STUB_OVERFLOW || 0);
  console.log('measure  ' + process.argv[2]); console.log('  widths ' + w + ' · 1 selector(s) · 1 props · first match'); console.log(''); console.log('@ ' + w + 'px');
  if (!process.env.STUB_MEASURE_NO_ROOT) console.log('  root  scrollWidth ' + String(w + o).padStart(5) + '  viewport ' + w + '  scrollHeight   5410' + (o ? '  ◄◄ OVERFLOW +' + o + 'px' : ''));
  console.log('  html'); console.log('       x     0  y      0  w  ' + w + '  h  5410  vis  ""'); console.log('      display: block');`);
stub(replica, 'pixel-compare.mjs', `
  console.log('height delta 0px'); console.log('differing 1.20%');
  process.exit(Number(process.env.STUB_PIXEL_RC || 0));`);
stub(replica, 'chrome-parity.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' '));
  if (process.env.STUB_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP)));
  const deltas = Number(process.env.STUB_CHROME_DELTAS || 0);
  console.log('chrome-parity @ 1440px'); console.log(deltas ? '✗ ' + deltas + ' delta(s) — fix these' : '✓ chrome parity');
  process.exit(deltas ? 2 : 0);`);
stub(diff, 'content-diff.mjs', `
  if (process.env.STUB_CD_RC) { console.error('content-diff error: build side answered HTTP 502'); process.exit(Number(process.env.STUB_CD_RC)); }
  const s = Number(process.env.STUB_STRUCTURAL || 0);
  console.log('  live: 12 headings'); console.log('Findings: ' + (s ? (s + 2) + ' (' + s + ' structural 🔴)' : 'none — content + roles match'));`);
stub(diff, 'clip-probe.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' '));
  const n = Number(process.env.STUB_CLIPPED || 0);
  console.log('Clipped: ' + n + ' (text clipped ' + n + ', text hidden 0, controls hidden 0, controls clipped 0; advisory: clamped 0)');
  process.exit(n ? 2 : 0);`);
stub(diff, 'content-presence.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' '));
  const h = Number(process.env.STUB_HIDDEN || 0);
  console.log('Content: MISSING 0 (headings 0, links 0) / HIDDEN ' + h + ' (headings 0, links ' + h + ') / control-state 0');
  process.exit(h ? 2 : 0);`);
stub(diff, 'unit-geometry.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' '));
  if (process.env.STUB_UNITS_RC === '2') { console.log('Units: 1 compared; elements within 2, off 3, hidden 1, missing 0 → FAIL'); process.exit(2); }
  console.log('unit-geometry: none declared for home in stardust/replica/units.json → n/a');`);
stub(diff, 'visual-diff.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' ')); console.log('Visual diff @ 1440px'); console.log('build red flags (advisory): ');
  console.log('  • HEADING COLOR: h2 differs'); console.log('  • IMAGE DIMS: hero'); console.log('Full metrics JSON:'); console.log('{}');`);

// A build origin that serves the slug (the identity assertion needs it).
const server = createServer((_req, res) => res.end('<html><body>home-proposed</body></html>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const buildUrl = `http://127.0.0.1:${server.address().port}/home-proposed.html`;

// Asynchronous: the build origin above lives in this process, so the event loop must keep running while gate.sh
// fetches it (a synchronous spawn would block the server and read as "did not respond").
function gate(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', [join(replica, 'gate.sh'), ...args], {
      cwd: root,
      env: { ...process.env, GATE_REAP_MIN: '0', ...env },
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
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf4'], { STUB_MEASURE_NO_ROOT: '1' });
check('an overflow probe without a root line is exit 1 with the fix named (never a silent pass)', r.status === 1 && /printed no root line/.test(r.stderr), `status ${r.status} ${r.stderr}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'ovf5'], { STUB_MEASURE_RC: '124' });
check('an overflow probe deadline is exit 124, no verdict', r.status === 124 && /overflow probe hit its deadline/.test(r.stderr), `status ${r.status} ${r.stderr}`);

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
writeFileSync(join(root, 'stardust/replica/gates/home-1440/live.capture.json'), JSON.stringify({ chunks: 6 }));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'relive'], { STUB_STITCH_COUNT: countFile });
check('a cached live.png captured before fixed layers were captured once is re-taken, said on stdout', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && /live\.png predates the fixed-layer capture/.test(r.stdout), `status ${r.status} attempts ${attempts().join(',')} ${r.stdout.slice(0, 300)}`);
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry2'], { STUB_STITCH_RC_BUILD: '1', STUB_STITCH_COUNT: countFile });
check('two exit-1 build captures end the round with exit 1 and say re-queue, never a FAIL', r.status === 1 && /build capture failed \(exit 1\) — not comparing \(twice: no verdict — re-queue the round\)/.test(r.stderr), `status ${r.status} ${r.stderr}`);
check('no third attempt', attempts().join(',') === 'BUILD,BUILD', attempts().join(','));
check('no overflow line, no pixel verdict after a failed capture', !/overflow assert|OVERFLOW|differing/.test(r.stdout), r.stdout);
resetCount();
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry3'], { STUB_STITCH_RC_BUILD: '3', STUB_STITCH_COUNT: countFile });
check('exit 3 (bot challenge) is final on the first attempt — not retried', r.status === 3 && attempts().join(',') === 'BUILD' && !/retrying/.test(r.stderr), `status ${r.status} attempts ${attempts().join(',')}`);
check('the blocked class is named — BLOCKED (exit 3), a bot challenge or 2xx denial page, no verdict, escalate --headed — never "failed"', /^gate\.sh: build capture BLOCKED \(exit 3\) — a bot challenge or 2xx denial page, not the page: no verdict for this round; escalate --headed$/m.test(r.stderr) && !/build capture failed/.test(r.stderr), r.stderr);
resetCount();
r = await gate(['wall', 'https://live.example/wall', buildUrl, '1440', 'retry3b', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '3', STUB_STITCH_COUNT: countFile });
check('a live capture that exits 3 ends the round with exit 3 on the first attempt: the live BLOCKED line, no build attempt, no live.png left to be reused as the source', r.status === 3 && attempts().join(',') === 'LIVE' && /^gate\.sh: live capture BLOCKED \(exit 3\) — a bot challenge or 2xx denial page, not the page: no verdict for this round; escalate --headed$/m.test(r.stderr) && !/retrying/.test(r.stderr) && !existsSync(join(root, 'stardust/replica/gates/wall-1440/live.png')), `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['about', 'https://live.example/about', buildUrl, '1440', 'retry4', '--marker', 'home-proposed'], { STUB_FAIL_ONCE_LIVE: join(root, 'once-live'), STUB_STITCH_COUNT: countFile });
check('a live capture that exits 1 once is retried; the round passes and live.png is kept', r.status === 0 && existsSync(join(root, 'stardust/replica/gates/about-1440/live.png')), `status ${r.status} ${r.stderr.slice(0, 300)}`);
check('live attempted twice, then the build once', attempts().join(',') === 'LIVE,LIVE,BUILD', attempts().join(','));
resetCount();
r = await gate(['press', 'https://live.example/press', buildUrl, '1440', 'retry5', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '1', STUB_STITCH_COUNT: countFile });
check('two exit-1 live captures: exit 1, re-queue named, no partial live.png left to be reused', r.status === 1 && /live capture failed \(exit 1\) — not comparing \(twice: no verdict — re-queue the round\)/.test(r.stderr) && !existsSync(join(root, 'stardust/replica/gates/press-1440/live.png')) && attempts().join(',') === 'LIVE,LIVE', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
const mCount = join(root, 'measure-count.txt');
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'retry6'], { STUB_MEASURE_RC: '1', STUB_MEASURE_COUNT: mCount });
check('an overflow probe that exits 1 twice is exit 1 (no verdict) after one retry', r.status === 1 && /overflow probe exited 1 — retrying once/.test(r.stderr) && /overflow probe failed \(exit 1\) — no verdict, re-queue the round: measure: /.test(r.stderr) && readFileSync(mCount, 'utf8').trim().split('\n').length === 2, `status ${r.status} ${r.stderr}`);

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

// --main / --no-dismiss reach the probes (recorded by the stub through its argv → evidence file)
stub(diff, 'content-diff.mjs', `console.log('argv ' + process.argv.slice(2).join(' ')); console.log('Findings: none — content + roles match');`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter7', '--full', '--main', '#content', '--no-dismiss']);
const cdPath = join(root, 'stardust/replica/gates/home-1440/content-diff-iter7.txt');
const cd = existsSync(cdPath) ? readFileSync(cdPath, 'utf8') : `(missing ${cdPath}; stderr: ${r.stderr.slice(0, 300)})`;
check('--main is passed to the diff probes', /--main #content/.test(cd), cd);
check('--no-dismiss drops the dismiss flag', !/--dismiss/.test(cd), cd);

// Overlay dismissal, one vocabulary (header § Overlay dismissal): --consent / --dismiss reach BOTH stitched captures
// (symmetric), the diff probes (joined into their one --dismiss value) and chrome-parity; a default round dismisses
// with the built-in candidates (captures: no flag; probes: bare --dismiss); --no-dismiss reaches the captures and
// chrome-parity as --no-dismiss and drops the probes' flag. Fresh slugs so the live capture runs (live.png is cached per
// slug × width); the selectors carry spaces and commas on purpose — the quoting through the arrays is the contract.
const argsFile = join(root, 'stitch-args.txt');
const stitchArgs = () => (existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim().split('\n') : []);
const resetArgs = () => { if (existsSync(argsFile)) unlinkSync(argsFile); };
const evidence = (slug, name) => { const p = join(root, `stardust/replica/gates/${slug}-1440/${name}`); return existsSync(p) ? readFileSync(p, 'utf8') : `(missing ${p})`; };
const CONSENT = '#consent-yes, .consent-box-yes'; const EXTRA = '.promo-close,#newsletter-close';
resetArgs();
r = await gate(['consent1', 'https://live.example/consent1', buildUrl, '1440', 'c1', '--full', '--marker', 'home-proposed', '--consent', CONSENT, '--dismiss', EXTRA], { STUB_STITCH_ARGS: argsFile });
check('--consent / --dismiss reach the live capture (after --settle) and the build capture alike, values intact', r.status === 0 && stitchArgs().length === 2
  && stitchArgs()[0] === `LIVE https://live.example/consent1 stardust/replica/gates/consent1-1440/live.png --width 1440 --settle --consent ${CONSENT} --dismiss ${EXTRA}`
  && stitchArgs()[1] === `BUILD ${buildUrl} stardust/replica/gates/consent1-1440/build.png --width 1440 --consent ${CONSENT} --dismiss ${EXTRA}`, `status ${r.status} | ${stitchArgs().join(' | ')} ${r.stderr.slice(0, 200)}`);
check('the diff probes get the same selectors joined into one --dismiss list', new RegExp(`--main main --dismiss ${CONSENT},${EXTRA}$`, 'm').test(evidence('consent1', 'content-diff-c1.txt')) && new RegExp(`--main main --dismiss ${CONSENT},${EXTRA} --out `).test(evidence('consent1', 'visual-diff-c1.txt')), evidence('consent1', 'content-diff-c1.txt') + evidence('consent1', 'visual-diff-c1.txt'));
check('chrome-parity gets --consent and --dismiss', new RegExp(`--live-cache \\S+ --consent ${CONSENT} --dismiss ${EXTRA}$`, 'm').test(evidence('consent1', 'chrome-parity-c1.txt')), evidence('consent1', 'chrome-parity-c1.txt'));
resetArgs();
r = await gate(['consent2', 'https://live.example/consent2', buildUrl, '1440', 'c2', '--full', '--marker', 'home-proposed'], { STUB_STITCH_ARGS: argsFile });
check('a default round dismisses with the built-in candidates: no overlay flag on either capture, bare --dismiss on the probes, none on chrome-parity', r.status === 0 && stitchArgs().length === 2
  && stitchArgs().every((l) => !/--consent|--dismiss|--no-dismiss/.test(l))
  && /--main main --dismiss$/m.test(evidence('consent2', 'content-diff-c2.txt')) && /--main main --dismiss --out /.test(evidence('consent2', 'visual-diff-c2.txt'))
  && !/--consent|--dismiss/.test(evidence('consent2', 'chrome-parity-c2.txt')), `status ${r.status} | ${stitchArgs().join(' | ')} | ${evidence('consent2', 'content-diff-c2.txt')}`);
resetArgs();
r = await gate(['consent3', 'https://live.example/consent3', buildUrl, '1440', 'c3', '--full', '--marker', 'home-proposed', '--no-dismiss'], { STUB_STITCH_ARGS: argsFile });
check('--no-dismiss reaches both captures and chrome-parity as --no-dismiss and drops the probes\' flag', r.status === 0 && stitchArgs().length === 2
  && stitchArgs().every((l) => / --no-dismiss$/.test(l) && !/--consent|--dismiss /.test(l))
  && !/--dismiss/.test(evidence('consent3', 'content-diff-c3.txt')) && !/--dismiss/.test(evidence('consent3', 'visual-diff-c3.txt')) && / --no-dismiss$/m.test(evidence('consent3', 'chrome-parity-c3.txt')) && !/--consent|--dismiss /.test(evidence('consent3', 'chrome-parity-c3.txt')), `status ${r.status} | ${stitchArgs().join(' | ')}`);
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

// --gate-against-baseline (the opt-in origin baseline; default OFF). Flag ON with a frozen baseline: no live capture,
// baseline.png is the origin side (copied over live.png), live.json says origin "baseline", one stdout line names the
// capture time. Flag ON without a usable baseline (missing, lone PNG, frozen for another width or URL): exit 125 with
// one stderr line BEFORE any capture — never a live shot in its place. Flag OFF: a round is the one it always was —
// a baseline beside it changes nothing, a baseline-derived live.png is retaken with one line, a live.png with no
// record is reused. The bookkeeping goes through the real stitch-shot (the stub forwards `baseline` / `record`).
const gdir = (slug, w = 1440) => join('stardust/replica/gates', `${slug}-${w}`);
const liveJson = (slug) => { const f = join(root, gdir(slug), 'live.json'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const livePng = (slug) => { const f = join(root, gdir(slug), 'live.png'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const noTmp = (slug) => !readdirSync(join(root, gdir(slug))).some((f) => f.endsWith('.tmp'));
const PROV = { writtenBy: 'skills/replica/scripts/stitch-shot.mjs --freeze-baseline', schema: 1, capturedAt: '2026-10-19T08:00:00.000Z', url: 'https://live.example/', width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, fontsFailed: [], fixedLayers: { capture: 'once', count: 1 } };
const freezeBaseline = (slug, prov = PROV) => {
  const d = join(root, gdir(slug));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'baseline.png'), 'baseline-png-bytes');
  writeFileSync(join(d, 'baseline.json'), `${JSON.stringify(prov, null, 2)}\n`);
};
r = await gate(['--help']);
check('--help names --gate-against-baseline and its exit-125 precondition', /--gate-against-baseline/.test(r.stdout) && /without a usable\s+frozen baseline/.test(r.stdout), r.stdout.slice(0, 200));

resetCount();
freezeBaseline('blon');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl1', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('flag ON with a frozen baseline: the round passes with no live capture — only the build side stitches', r.status === 0 && attempts().join(',') === 'BUILD', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr.slice(0, 300)}`);
check('the baseline is the pixel-compare origin: live.png is a copy of baseline.png, no temp file left', livePng('blon') === 'baseline-png-bytes' && noTmp('blon'));
check('live.json records origin "baseline", at = the capture time and originBaseline { capturedAt, height }, written by gate.sh --gate-against-baseline', (() => {
  const lj = JSON.parse(liveJson('blon') || '{}');
  return lj.writtenBy === 'gate.sh --gate-against-baseline' && lj.origin === 'baseline' && lj.url === 'https://live.example/' && lj.width === 1440 && lj.at === PROV.capturedAt
    && JSON.stringify(lj.originBaseline) === JSON.stringify({ capturedAt: PROV.capturedAt, height: PROV.height });
})(), liveJson('blon'));
check('one stdout line names the frozen baseline and its capture time, before the verdict lines', /^gate\.sh: gating against the frozen origin baseline \(captured 2026-10-19T08:00:00\.000Z\) — origin side from baseline\.png, no fresh live shot\n[^]*differing/m.test(r.stdout), r.stdout);
check('the pixel verdict and the overflow assert still print (the rest of the round is unchanged)', /differing 1\.20%/.test(r.stdout) && /overflow assert at 1440/.test(r.stdout), r.stdout);

resetCount();
r = await gate(['blmiss', 'https://live.example/', buildUrl, '1440', 'bl2', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('flag ON with no baseline: exit 125 before any capture (no live, no build), one stderr line naming what is missing and the two ways out', r.status === 125 && attempts().length === 0
  && /^gate\.sh: --gate-against-baseline set but no frozen baseline in stardust\/replica\/gates\/blmiss-1440 \(baseline\.png \+ baseline\.json\) — not gating against a live shot in its place: freeze one \(stitch-shot\.mjs "https:\/\/live\.example\/" stardust\/replica\/gates\/blmiss-1440\/baseline\.png --freeze-baseline --width 1440 --settle\) or drop the flag$/m.test(r.stderr)
  && (r.stderr.match(/^gate\.sh: /gm) || []).length === 1, `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
check('… and nothing was written: no live.png, no live.json, no verdict lines', livePng('blmiss') === null && liveJson('blmiss') === null && !/differing|overflow assert/.test(r.stdout), r.stdout);
resetCount();
freezeBaseline('blstale', { ...PROV, width: 360 });
r = await gate(['blstale', 'https://live.example/', buildUrl, '1440', 'bl3', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('flag ON with a baseline frozen at another width: exit 125, no capture, the one line says stale and names both widths', r.status === 125 && attempts().length === 0
  && /^gate\.sh: --gate-against-baseline set but stale: stardust\/replica\/gates\/blstale-1440\/baseline\.json was frozen at 360px, this round is 1440px — re-freeze with --force — not gating against a live shot in its place/m.test(r.stderr) && livePng('blstale') === null, `status ${r.status} ${r.stderr}`);
resetCount();
freezeBaseline('blurl', { ...PROV, url: 'https://live.example/other' });
r = await gate(['blurl', 'https://live.example/', buildUrl, '1440', 'bl4', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('flag ON with a baseline frozen for another URL: exit 125, no capture, the one line names both URLs', r.status === 125 && attempts().length === 0
  && /was frozen for https:\/\/live\.example\/other, this round's live URL is https:\/\/live\.example\/ — re-freeze with --force/.test(r.stderr), `status ${r.status} ${r.stderr}`);
resetCount();
mkdirSync(join(root, gdir('bllone')), { recursive: true }); writeFileSync(join(root, gdir('bllone'), 'baseline.png'), 'baseline-png-bytes');
r = await gate(['bllone', 'https://live.example/', buildUrl, '1440', 'bl5', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('flag ON with a lone baseline.png (no provenance): exit 125, no capture, the line names the interrupted freeze', r.status === 125 && attempts().length === 0 && /baseline\.png has no baseline\.json beside it \(an interrupted freeze\) — re-freeze with --force/.test(r.stderr), `status ${r.status} ${r.stderr}`);

resetCount();
freezeBaseline('bloff');
r = await gate(['bloff', 'https://live.example/', buildUrl, '1440', 'bl6', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('flag OFF (the default) with a baseline beside the round: unchanged — a fresh live shot, then the build; no live.json, no baseline line, live.png is the live capture', r.status === 0 && attempts().join(',') === 'LIVE,BUILD'
  && liveJson('bloff') === null && livePng('bloff') === 'png' && !/frozen origin baseline/.test(r.stdout + r.stderr), `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['bloff', 'https://live.example/', buildUrl, '1440', 'bl7', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('… and the next round reuses that live.png (BUILD only), as on every round before this flag existed', r.status === 0 && attempts().join(',') === 'BUILD' && liveJson('bloff') === null, `attempts ${attempts().join(',')}`);

resetCount();
writeFileSync(join(root, gdir('blon'), 'live.capture.json'), '{ "stale": "a live round\'s record" }\n');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl8', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('flag dropped after a flagged round: the baseline-derived live.png is retaken with one line — LIVE then BUILD, live.json removed, live.png is the live capture', r.status === 0 && attempts().join(',') === 'LIVE,BUILD'
  && /^gate\.sh: live\.png is the frozen origin baseline \(a --gate-against-baseline round\); this round gates against the live origin — retaking it$/m.test(r.stderr) && (r.stderr.match(/retaking/g) || []).length === 1
  && liveJson('blon') === null && livePng('blon') === 'png', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr} ${liveJson('blon')}`);
check('… and the stale capture record (live.capture.json) went with the retaken live.png (the retake writes its own)', !existsSync(join(root, gdir('blon'), 'live.capture.json')) || !readFileSync(join(root, gdir('blon'), 'live.capture.json'), 'utf8').includes('"stale"'));
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl9', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('… the next unflagged round reuses that fresh live.png (BUILD only, no retake line)', r.status === 0 && attempts().join(',') === 'BUILD' && !/retaking/.test(r.stderr), `attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
writeFileSync(join(root, gdir('blon'), 'live.capture.json'), '{ "stale": "the live round\'s record" }\n');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl10', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('a flagged round after a live one takes the baseline again: BUILD only, live.png is baseline.png, live.json origin "baseline", no temp file', r.status === 0 && attempts().join(',') === 'BUILD'
  && livePng('blon') === 'baseline-png-bytes' && JSON.parse(liveJson('blon') || '{}').origin === 'baseline' && noTmp('blon'), `attempts ${attempts().join(',')} ${liveJson('blon')}`);
check('… and the live round\'s capture record (live.capture.json) is removed with the copy — no record describes bytes it did not measure', !existsSync(join(root, gdir('blon'), 'live.capture.json')));

// A record that cannot be written (STUB_RECORD_FAIL): the round ends (exit 1, one line) with live.png removed, so the
// baseline bytes never sit under a missing record for the next unflagged round to reuse as a live shot.
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl11', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile, STUB_RECORD_FAIL: '1' });
check('a flagged round whose live.json write fails: exit 1 with one line, no capture spent, neither live.png nor live.json left', r.status === 1 && attempts().length === 0
  && /^gate\.sh: could not write stardust\/replica\/gates\/blon-1440\/live\.json for the frozen origin — not comparing \(a later round would read the copy as a live shot\); re-run the round$/m.test(r.stderr)
  && livePng('blon') === null && liveJson('blon') === null, `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl12', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('… so the next unflagged round captures live (LIVE,BUILD) instead of reusing baseline bytes', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && livePng('blon') === 'png', `attempts ${attempts().join(',')} ${r.stderr}`);
check('the frozen baseline itself is untouched by every round above', readFileSync(join(root, gdir('blon'), 'baseline.png'), 'utf8') === 'baseline-png-bytes' && JSON.parse(readFileSync(join(root, gdir('blon'), 'baseline.json'), 'utf8')).capturedAt === PROV.capturedAt);

server.close();
if (process.env.GATE_TEST_KEEP) console.log(`sandbox kept at ${root} (build url was ${buildUrl})`);
else rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

