#!/usr/bin/env node
// gate.sh contract test: argument parsing, --help, the horizontal-overflow assert (measure.mjs root line → exit 2
// over a PASS pixel line), the one capture retry on exit 1 (live, build, overflow probe; 3 / 4 / 124 final — 3 is the
// BLOCKED line: a bot challenge or 2xx denial page, no verdict, on either side), the --full probe fan-out and its
// exit-code rules, the overlay flags (--consent / --dismiss / --no-dismiss reaching both captures, the diff probes and
// chrome-parity), the font check per side (one `gate.sh: fonts on the <side> capture` line each after the overflow
// line from the capture records — the dead faces, every face loaded, or NOT CHECKED for a record whose fontsFailed is
// null or no readable record; information, the exit code unchanged; a failed live capture removes its record with
// live.png), with stub instruments (no browser, no network).
// The origin reference (the default origin): the first round freezes one (reference.mjs freeze, the round's overlay
// flags and locale) and gates against it, the next reuses it with no live capture; an unstable reference ends the
// round with exit 5 — no verdict file, no round recorded; a bot challenge is 3, a deadline 124; --live-origin and
// GATE_REFERENCE=live are the round as it was; the reference's mask reaches pixel-compare merged with --mask. The
// pixel criterion (pixel-compare --offset-max, the regime's bound or GATE_OFFSET_MAX_PX): aligned pass within the
// bound → 0, offsets over it → 2 with the offsets reason, alignment not used → the unaligned rule; verdict-<label>.json
// carries the round's pixel numbers. The sections written for the live-origin round run it through GATE_REFERENCE=live
// (the `gate` helper's default here); the reference sections pass DEF.
// The header contract at the prototype stage (--full, the REAL chrome-compare.mjs --status, no browser): for the page the
// contract was recorded on, NOT COMPARED / FAIL is a failed probe once the pixels pass, PASS / CAPPED is not; another
// page, another stage or no contract prints nothing; a contract that cannot be read is no verdict (exit 1). No contract
// in a replica project (state.json flow "replica"): every page's round prints NOT RECORDED, a failed probe.
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
// STUB_STITCH_COUNT so a test can count attempts, and its side + argv to STUB_STITCH_ARGS so a test can read the flags. A
// successful capture writes its capture record <stem>.capture.json (fixedLayers always — a capture the new way, reusable;
// fontsFailed = the comma list STUB_FONTS_<side>, or
// null + fontCheck "failed: …" under STUB_FONTS_NULL_<side> — a font check that could not run; STUB_NO_JSON_<side> writes
// none, STUB_BAD_JSON_<side> an unreadable one). measure: the root line gate.sh reads (STUB_OVERFLOW px over the
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
  writeFileSync(out, 'png');
  const json = out.replace(/\\.png$/i, '') + '.capture.json';
  const fonts = process.env['STUB_FONTS_NULL_' + side] ? { fontsFailed: null, fontCheck: 'failed: Execution context was destroyed' }
    : { fontsFailed: (process.env['STUB_FONTS_' + side] || '').split(',').filter(Boolean) };
  const hold = process.argv.includes('--hold-min') && !process.env['STUB_NO_HOLD_' + side] ? Number(process.argv[process.argv.indexOf('--hold-min') + 1]) : null; // the timer hold, as stitch-shot records it
  if (json && process.env['STUB_BAD_JSON_' + side]) writeFileSync(json, '{ "url": ');
  else if (json && !process.env['STUB_NO_JSON_' + side]) writeFileSync(json, JSON.stringify({ url, out, width: 1440, vh: 900, settle: process.argv.includes('--settle'), ...fonts, fixedLayers: { capture: 'once', count: 0, late: 0 }, ...(hold ? { timers: { hold, held: 1, intervals: 1, chains: 0, delays: [5000] } } : {}), height: 2000 }, null, 2) + '\\n');
  console.log('stitched ' + out);`);
stub(replica, 'measure.mjs', `
  import { appendFileSync } from 'node:fs';
  if (process.env.STUB_MEASURE_COUNT) appendFileSync(process.env.STUB_MEASURE_COUNT, 'M\\n');
  const rc = Number(process.env.STUB_MEASURE_RC || 0);
  if (rc) { console.error('measure: ' + process.argv[2] + ' failed to load — stub exit ' + rc); process.exit(rc); }
  const w = Number(process.argv[process.argv.indexOf('--width') + 1]); const o = Number(process.env.STUB_OVERFLOW || 0);
  console.log('measure  ' + process.argv[2]); console.log('  widths ' + w + ' · 1 selector(s) · 1 props · first match'); console.log(''); console.log('@ ' + w + 'px');
  if (!process.env.STUB_MEASURE_NO_ROOT) console.log('  root  scrollWidth ' + String(w + o).padStart(5) + '  viewport ' + w + '  scrollHeight   5410' + (o ? '  ◄◄ OVERFLOW +' + o + 'px' : ''));
  console.log('  html'); console.log('       x     0  y      0  w  ' + w + '  h  5410  vis  ""'); console.log('      display: block');`);
// pixel-compare: the two legacy lines, then — through the REAL pixelVerdict / alignedLine (the rule's one home) — the
// aligned line and the \`pixel:\` line for the summary STUB_PIXEL_JSON describes ({ pct, aligned: { used, pct, steps } };
// default 1.2 %, alignment not used) under the --offset-max gate.sh passed; --json-out gets that summary (maskedRows =
// the rows of --mask). Exit: STUB_PIXEL_RC when set (no summary written for a non-verdict code), else the rule's.
// STUB_PIXEL_ARGS records the argv.
const REAL_PIXEL = join(scripts, 'pixel-compare.mjs');
stub(replica, 'pixel-compare.mjs', `
  import { appendFileSync, writeFileSync } from 'node:fs';
  import { alignedLine, pixelVerdict } from ${JSON.stringify(REAL_PIXEL)};
  const a = process.argv.slice(2); const arg = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  if (process.env.STUB_PIXEL_ARGS) appendFileSync(process.env.STUB_PIXEL_ARGS, a.join(' ') + '\\n');
  console.log('height delta 0px'); console.log('differing 1.20%');
  const forced = process.env.STUB_PIXEL_RC ? Number(process.env.STUB_PIXEL_RC) : null;
  if (forced !== null && forced !== 0 && forced !== 2) process.exit(forced);
  const given = JSON.parse(process.env.STUB_PIXEL_JSON || '{}');
  const pct = given.pct ?? 1.2; const al = given.aligned || { used: false, pct, steps: [], reason: 'no offset step found' };
  const aligned = { used: al.used, pct: al.pct ?? pct, steps: al.steps || [], totalShift: (al.steps || []).reduce((n, s) => n + Math.abs(s.shift), 0), maxOffset: 0, insertedRows: 0, deletedRows: 0, bands: [], reason: al.reason || null };
  const maskedRows = (arg('--mask') || '').split(',').filter(Boolean).reduce((n, m) => n + Number(m.split(':')[1].split('@')[0]), 0);
  const j = { pct, heightDelta: given.heightDelta ?? 0, compared: { width: 1440, height: given.height ?? 2000, mode: 'overlap' }, threshold: 10, maskedRows, bands: [], verdict: 'aligned', aligned };
  const om = arg('--offset-max'); const v = pixelVerdict(j, { threshold: 10, offsetMax: om === 'prototype' || om === 'published' ? om : om === null ? null : Number(om) });
  console.log(alignedLine(aligned, pct)); console.log(v.line);
  const rc = forced ?? (v.pass ? 0 : 2);
  if (arg('--json-out')) writeFileSync(arg('--json-out'), JSON.stringify({ ...j, pass: rc === 0, offsets: { bound: v.bound, totalShift: v.totalShift, pass: v.offsetsPass }, reason: v.reason }, null, 2) + '\\n');
  process.exit(rc);`);
// reference.mjs: \`freeze\` is the stub — it appends REF to STUB_STITCH_COUNT and its argv to STUB_REF_ARGS, then exits
// STUB_REF_RC with reference.mjs's line for that code (2 = unstable: reference-unstable.json, nothing frozen; 3 = bot
// challenge), fails ONCE with 1 under STUB_REF_FAIL_ONCE (a marker file), sleeps STUB_REF_SLEEP ms first, or freezes:
// baseline.png + baseline.json in reference.mjs's shape — noiseFloor STUB_REF_FLOOR, the variable regions and maskArg
// of STUB_REF_MASK ("y:h,…"), \`flags\` = the overlay flags and locale it was called with. \`mask\` / \`status\` /
// \`settings\` are the real script's (no browser).
const REAL_REFERENCE = join(scripts, 'reference.mjs');
stub(replica, 'reference.mjs', `
  import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'freeze') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [${JSON.stringify(REAL_REFERENCE)}, cmd, ...rest], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  const [url, dir] = rest; const width = Number(rest[rest.indexOf('--width') + 1]);
  const flag = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : null);
  if (process.env.STUB_STITCH_COUNT) appendFileSync(process.env.STUB_STITCH_COUNT, 'REF\\n');
  if (process.env.STUB_REF_ARGS) appendFileSync(process.env.STUB_REF_ARGS, rest.join(' ') + '\\n');
  if (process.env.STUB_REF_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_REF_SLEEP)));
  mkdirSync(dir, { recursive: true });
  const once = process.env.STUB_REF_FAIL_ONCE;
  if (once && !existsSync(once)) { writeFileSync(once, '1'); console.log('reference: not frozen — the priming capture failed (stitch-shot exit 1)'); process.exit(1); }
  const rc = Number(process.env.STUB_REF_RC || 0);
  const hold = rest.includes('--hold-min') ? Number(flag('--hold-min')) : null; // the timer hold, as reference.mjs records it
  const hint = process.env.STUB_REF_HINT && !hold ? process.env.STUB_REF_HINT : null; // reference.mjs's hint: only without the hold, before its verdict line
  if (hint) console.log('hint: ' + hint);
  if (rc === 2) { writeFileSync(join(dir, 'reference-unstable.json'), JSON.stringify({ stable: false, ...(hint ? { hint } : {}) })); console.log('reference: UNSTABLE — heights 2000 vs 2640 after priming; not frozen'); process.exit(2); }
  if (rc === 3) { console.log('reference: not frozen — the priming capture met a bot challenge (stitch-shot exit 3)'); process.exit(3); }
  if (rc) { console.log('reference: not frozen — the capture failed (stitch-shot exit ' + rc + ')'); process.exit(rc); }
  const maskArg = process.env.STUB_REF_MASK || ''; const variable = maskArg.split(',').filter(Boolean).map((m) => ({ y: Number(m.split(':')[0]), h: Number(m.split(':')[1]), pct: 12 }));
  const noiseFloor = Number(process.env.STUB_REF_FLOOR || 0);
  writeFileSync(join(dir, 'baseline.png'), 'frozen-reference-bytes');
  writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ writtenBy: 'skills/replica/scripts/reference.mjs freeze', schema: 1, capturedAt: '2026-11-01T09:00:00.000Z', url, width, vh: 900, height: 2000, settle: true, chunks: 3,
    fontsFailed: [], fixedLayers: { capture: 'once', count: 0 }, ...(hold ? { timers: { hold, held: 2, intervals: 2, chains: 0, delays: [5000, 86400000] } } : {}), primed: true, prime: { height: 2100, pct: 31.4, heightDelta: 100 }, captures: 2, heights: [2000, 2000], noiseFloor, heightSpread: 0, outside: 0,
    variable, variableShare: 0, maskArg, stable: true, reason: null, frozenAt: '2026-11-01T09:00:05.000Z', ...(hint ? { hint } : {}),
    flags: { consent: flag('--consent'), dismiss: flag('--dismiss'), noDismiss: rest.includes('--no-dismiss'), locale: flag('--locale'), vh: null, headed: false, ...(hold ? { holdTimers: hold } : {}) } }, null, 2) + '\\n');
  console.log('reference: frozen ' + width + '×2000, primed, noise floor ' + noiseFloor.toFixed(2) + '%' + (maskArg ? ' in ' + variable.length + ' variable region(s) → mask ' + maskArg : ', no variable region'));`);
stub(replica, 'chrome-parity.mjs', `
  console.log('argv ' + process.argv.slice(2).join(' '));
  if (process.env.STUB_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP)));
  const deltas = Number(process.env.STUB_CHROME_DELTAS || 0);
  console.log('chrome-parity @ 1440px'); console.log(deltas ? '✗ ' + deltas + ' delta(s) — fix these' : '✓ chrome parity');
  process.exit(deltas ? 2 : 0);`);
stub(diff, 'content-diff.mjs', `
  if (process.env.STUB_CD_RC) { console.error('content-diff error: build side answered HTTP 502'); process.exit(Number(process.env.STUB_CD_RC)); }
  const s = Number(process.env.STUB_STRUCTURAL || 0); const l = Number(process.env.STUB_LOST || 0);
  console.log('  live: 12 headings'); console.log('Findings: ' + (s || l ? (s + l + 2) + ' (' + s + ' structural 🔴)' : 'none — content + roles match'));
  console.log('Tiers: looks-same 🔴 ' + s + ' · nothing-lost 🟡 ' + l + ' · accepted 🟢 0 (owner 0, auto 0) · advisory ' + (s || l ? 2 : 0));`);
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
      env: { ...process.env, GATE_REAP_MIN: '0', GATE_REFERENCE: 'live', STARDUST_ROUND_CAP: '0', ...env }, // the cap is rounds.test.mjs's subject: here rounds are recorded, never refused
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// The default origin (the frozen reference): pass DEF as the env — the helper's own default is the live-origin round.
const DEF = { GATE_REFERENCE: '' };

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

// Measure first: a prototype round with no source spec says so (advisory); with the spec on disk it is silent.
{
  const specLine = /^gate\.sh: no source spec for home at 1440 \(stardust\/replica\/spec\/home-1440\.json\) — measure before gating: node .*source-spec\.mjs capture "https:\/\/live\.example\/" --slug home --widths 1440/m;
  const hasSpecScript = existsSync(join(replica, 'source-spec.mjs'));
  if (!hasSpecScript) writeFileSync(join(replica, 'source-spec.mjs'), '');
  let s = await gate(['home', 'https://live.example/', buildUrl, '1440', 'spec1']);
  check('a prototype round with no source spec prints the measure-first line and still runs', s.status === 0 && specLine.test(s.stdout), `status ${s.status} ${s.stdout}`);
  mkdirSync(join(root, 'stardust/replica/spec'), { recursive: true }); writeFileSync(join(root, 'stardust/replica/spec/home-1440.json'), '{}');
  s = await gate(['home', 'https://live.example/', buildUrl, '1440', 'spec2']);
  check('with the spec on disk the line is not printed', s.status === 0 && !/no source spec/.test(s.stdout), s.stdout);
  s = await gate(['home', 'https://live.example/', 'https://preview.example/home', '1440', 'spec3'], { GATE_REGIME: 'published' });
  check('never at the published stage', !/no source spec/.test(s.stdout), s.stdout);
  rmSync(join(root, 'stardust/replica/spec'), { recursive: true, force: true });
  if (!hasSpecScript) unlinkSync(join(replica, 'source-spec.mjs'));
}

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

// The font check per side (header § Fonts): both captures leave their capture record; one line per side after the
// overflow line — information for the loop, never a verdict.
const fontsLine = (side, rest) => new RegExp(`^gate\\.sh: fonts on the ${side} capture — ${rest}$`, 'm');
const gdir = (slug) => `stardust/replica/gates/${slug}-1440`;
r = await gate(['fonts1', 'https://live.example/fonts1', buildUrl, '1440', 'f1', '--marker', 'home-proposed']);
check('both captures leave their capture record (<side>.capture.json in the evidence dir)', r.status === 0
  && existsSync(join(root, gdir('fonts1'), 'live.capture.json')) && existsSync(join(root, gdir('fonts1'), 'build.capture.json')), `status ${r.status} ${r.stderr.slice(0, 300)}`);
check('both records were written by a --settle capture (a symmetric instrument)', JSON.parse(readFileSync(join(root, gdir('fonts1'), 'live.capture.json'), 'utf8')).settle === true
  && JSON.parse(readFileSync(join(root, gdir('fonts1'), 'build.capture.json'), 'utf8')).settle === true);
check('a clean round prints "every declared face loaded" for both sides, after the overflow line', fontsLine('live', 'every declared face loaded').test(r.stdout) && fontsLine('build', 'every declared face loaded').test(r.stdout)
  && /overflow assert[^\n]*\n[^]*fonts on the live capture[^\n]*\n[^]*fonts on the build capture/.test(r.stdout), r.stdout);
r = await gate(['fonts1', 'https://live.example/fonts1', buildUrl, '1440', 'f2', '--marker', 'home-proposed'], { STUB_FONTS_BUILD: 'Brand Sans,Brand Serif Fallback' });
check('dead faces on the build side are named on its line — DEAD FACE(S) with both causes — and the round still passes (information, not a verdict)', r.status === 0
  && fontsLine('build', 'DEAD FACE\\(S\\) Brand Sans, Brand Serif Fallback: the capture renders fallback type for them \\(a file that failed to fetch, or a local\\(\\) source this browser cannot resolve — recreation-procedure\\.md § Fonts policy\\)').test(r.stdout)
  && fontsLine('live', 'every declared face loaded').test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['fonts1', 'https://live.example/fonts1', buildUrl, '1440', 'f3', '--marker', 'home-proposed'], { STUB_FONTS_BUILD: 'X', STUB_PIXEL_RC: '2' });
check('the fonts lines are printed on a failing round too, before the exit', r.status === 2 && fontsLine('build', 'DEAD FACE\\(S\\) X: .*').test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['fonts2', 'https://live.example/fonts2', buildUrl, '1440', 'f4', '--marker', 'home-proposed'], { STUB_FONTS_NULL_LIVE: '1' });
check('a live record whose font check could not run (fontsFailed null) prints NOT CHECKED with the record\'s reason — never "every face loaded"; exit 0', r.status === 0
  && fontsLine('live', 'NOT CHECKED \\(Execution context was destroyed\\) — no face is known to have loaded').test(r.stdout) && !fontsLine('live', 'every declared face loaded').test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['fonts3', 'https://live.example/fonts3', buildUrl, '1440', 'f5', '--marker', 'home-proposed'], { STUB_NO_JSON_LIVE: '1', STUB_BAD_JSON_BUILD: '1', GATE_HOLD_TIMERS: '0' }); // unheld: under the hold a capture with no record is never compared (exit 1)
check('no record (an older stitch-shot) or an unreadable one prints NOT CHECKED naming the record path and the fix, per side', r.status === 0
  && fontsLine('live', `NOT CHECKED \\(no readable capture record at ${gdir('fonts3')}/live.capture\\.json — delete live\\.png to re-take it with the check\\)`).test(r.stdout)
  && fontsLine('build', `NOT CHECKED \\(no readable capture record at ${gdir('fonts3')}/build.capture\\.json — re-copy stitch-shot\\.mjs \\(replica SKILL\\.md § Setup\\)\\)`).test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['fonts2', 'https://live.example/fonts2', buildUrl, '1440', 'f6', '--marker', 'home-proposed']);
check('a later round reuses live.png AND its record: the live line still reads the cached capture\'s check (NOT CHECKED), the build side is fresh', r.status === 0
  && fontsLine('live', 'NOT CHECKED \\(Execution context was destroyed\\).*').test(r.stdout) && fontsLine('build', 'every declared face loaded').test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await gate(['fonts4', 'https://live.example/fonts4', buildUrl, '1440', 'f7', '--marker', 'home-proposed'], { STUB_STITCH_RC_LIVE: '1' });
check('a failed live capture leaves neither live.png nor live.capture.json behind', r.status === 1 && !existsSync(join(root, gdir('fonts4'), 'live.png')) && !existsSync(join(root, gdir('fonts4'), 'live.capture.json')), `status ${r.status}`);

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
check('the structural count is on the verdict line, with the tiers', /^content-diff: 3 \(1 structural 🔴\) — looks-same 🔴 1 · nothing-lost 🟡 0 /m.test(r.stdout), r.stdout);

// --full, an invisible loss only (nothing-lost 🟡) → 2: the second tier fails the round too; the round's record names its files
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'lost1', '--full'], { STUB_LOST: '2' });
check('a nothing-lost 🟡 fails the round (exit 2) with 0 structural 🔴', r.status === 2 && /^content-diff: 4 \(0 structural 🔴\) — looks-same 🔴 0 · nothing-lost 🟡 2 /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
{
  const vj = join(root, 'stardust/replica/gates/home-1440/verdict-lost1.json');
  const v = existsSync(vj) ? JSON.parse(readFileSync(vj, 'utf8')) : null;
  check('verdict-<label>.json records this round: each probe\'s rc and evidence file, the pixel rc + diff, the two tiers', v && v.round === 'lost1' && v.width === 1440 && v.nothingLost === 2 && v.structural === 0 && v.pixel.diff.endsWith('diff-lost1.png') && v.probes['content-diff'].evidence.endsWith('content-diff-lost1.txt') && v.probes['chrome-parity'].rc === 0 && !v.probes['content-presence'], JSON.stringify(v));
}

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
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter6b4', '--full'], { STUB_CD_RC: '4' });
check('exit 4 from a probe other than chrome-parity is that probe\'s own error, never the region hint', /^content-diff: ERROR \(exit 4\) — content-diff error: build side answered HTTP 502/m.test(r.stdout) && !/GATE_CHROME_REGION names it/.test(r.stdout), r.stdout);
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
  && stitchArgs()[0] === `LIVE https://live.example/consent1 stardust/replica/gates/consent1-1440/live.png --width 1440 --settle --consent ${CONSENT} --dismiss ${EXTRA} --hold-timers --hold-min 2000`
  && stitchArgs()[1] === `BUILD ${buildUrl} stardust/replica/gates/consent1-1440/build.png --width 1440 --settle --consent ${CONSENT} --dismiss ${EXTRA} --hold-timers --hold-min 2000`, `status ${r.status} | ${stitchArgs().join(' | ')} ${r.stderr.slice(0, 200)}`);
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
  && stitchArgs().every((l) => / --no-dismiss --hold-timers --hold-min 2000$/.test(l) && !/--consent|--dismiss /.test(l))
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
check('without a families file the round says the repeated-unit check did not run — one NOT RUN line, the exit code as it was', r.status === 0 && /^unit-geometry: NOT RUN — no stardust\/replica\/units\.json: no repeated-unit family is declared, the repeated-unit check did not run$/m.test(r.stdout) && (r.stdout.match(/^unit-geometry:/gm) || []).length === 1, `status ${r.status} ${r.stdout}`);
mkdirSync(join(root, 'stardust/replica'), { recursive: true });
writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ cards: { origin: '.a', build: '.b', pages: ['home'] } }));
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'u1', '--full']);
check('with stardust/replica/units.json the round runs unit-geometry --families --stage --slug and prints its line', r.status === 0 && /^unit-geometry: unit-geometry: none declared/m.test(r.stdout) && /^unit-geometry: NOT RUN — no family in stardust\/replica\/units\.json applies to home: the repeated-unit check did not run$/m.test(r.stdout) && /--families stardust\/replica\/units.json --stage prototype --slug home/.test(readFileSync(join(root, 'stardust/replica/gates/home-1440/units-u1.txt'), 'utf8')), `status ${r.status} ${r.stdout}`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'u2', '--full'], { STUB_UNITS_RC: '2' });
check('a required unit off (unit-geometry exit 2) fails the round', r.status === 2 && /^unit-geometry: Units: 1 compared/m.test(r.stdout) && !/NOT RUN/.test(r.stdout), `status ${r.status} ${r.stdout}`);
unlinkSync(join(root, 'stardust/replica/units.json'));

// --gate-against-baseline (the opt-in origin baseline; default OFF). Flag ON with a frozen baseline: no live capture,
// baseline.png is the origin side (copied over live.png), live.json says origin "baseline", one stdout line names the
// capture time. Flag ON without a usable baseline (missing, lone PNG, frozen for another width or URL): exit 125 with
// one stderr line BEFORE any capture — never a live shot in its place. Flag OFF: a round is the one it always was —
// a baseline beside it changes nothing, a baseline-derived live.png is retaken with one line, a live.png with no
// record is reused. The bookkeeping goes through the real stitch-shot (the stub forwards `baseline` / `record`).
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
check('--help names the origin reference: the default, --live-origin, GATE_REFERENCE=live, --gate-against-baseline as a no-op, exit 5', /Origin reference/.test(r.stdout) && /--live-origin/.test(r.stdout) && /GATE_REFERENCE=live/.test(r.stdout)
  && /--gate-against-baseline\s+accepted, a no-op/.test(r.stdout) && /5 origin reference UNSTABLE/.test(r.stdout) && /reference\.mjs freeze/.test(r.stdout), r.stdout.slice(0, 200));
check('--help documents the pixel criterion and its env: aligned % ≤ threshold AND total offset ≤ GATE_OFFSET_MAX_PX (8 prototype; published the larger of 8 and 1 %)', /Pixel criterion/.test(r.stdout) && /GATE_OFFSET_MAX_PX/.test(r.stdout)
  && /larger\s+of 8 and 1 % of the origin height/.test(r.stdout) && /offsets: 3 step\(s\), 37px total/.test(r.stdout), r.stdout.slice(0, 200));

// The blon rounds are a project that never holds (GATE_HOLD_TIMERS=0 on every round): its reference frozen without
// the hold — here by stitch-shot, no settings recorded — is kept and reused, never frozen again.
const UNHELD = { GATE_HOLD_TIMERS: '0' };
resetCount();
freezeBaseline('blon');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl1', '--marker', 'home-proposed', '--gate-against-baseline'], { ...UNHELD, STUB_STITCH_COUNT: countFile });
check('flag ON with a frozen baseline: the round passes with no live capture — only the build side stitches', r.status === 0 && attempts().join(',') === 'BUILD', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr.slice(0, 300)}`);
check('the baseline is the pixel-compare origin: live.png is a copy of baseline.png, no temp file left', livePng('blon') === 'baseline-png-bytes' && noTmp('blon'));
check('live.json records origin "baseline", at = the capture time and originBaseline { capturedAt, height }, written by gate.sh --gate-against-baseline', (() => {
  const lj = JSON.parse(liveJson('blon') || '{}');
  return lj.writtenBy === 'gate.sh --gate-against-baseline' && lj.origin === 'baseline' && lj.url === 'https://live.example/' && lj.width === 1440 && lj.at === PROV.capturedAt
    && JSON.stringify(lj.originBaseline) === JSON.stringify({ capturedAt: PROV.capturedAt, height: PROV.height });
})(), liveJson('blon'));
check('one stdout line names the frozen reference and its capture time among the verdict lines — a baseline frozen by stitch-shot has no measured noise floor, and the line says so', /differing[^]*^gate\.sh: reference: frozen 2026-10-19T08:00:00\.000Z, noise floor not measured \(frozen without priming — reference\.mjs freeze --force measures it\) — 0 rows excluded$/m.test(r.stdout), r.stdout);
check('the pixel verdict and the overflow assert still print (the rest of the round is unchanged)', /differing 1\.20%/.test(r.stdout) && /overflow assert at 1440/.test(r.stdout), r.stdout);
check('the live fonts line of a flagged round reads the frozen baseline\'s check (live.png is its copy and has no capture record)', /^gate\.sh: fonts on the live capture — every declared face loaded \(the frozen baseline's check\)$/m.test(r.stdout), r.stdout);

// No usable baseline (missing, frozen for another width or URL, a lone PNG): the round freezes one — once — and gates
// against it; the reason the old one was unusable is on the line.
resetCount();
r = await gate(['blmiss', 'https://live.example/', buildUrl, '1440', 'bl2', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
check('no baseline: the round freezes a reference (one freeze, then the build), says why, and passes against it', r.status === 0 && attempts().join(',') === 'REF,BUILD'
  && /^gate\.sh: no usable frozen reference for blmiss@1440 \(no frozen baseline in stardust\/replica\/gates\/blmiss-1440 \(baseline\.png \+ baseline\.json\)\) — freezing one: a priming capture, then two kept \(reference\.mjs freeze\)$/m.test(r.stdout)
  && livePng('blmiss') === 'frozen-reference-bytes' && JSON.parse(liveJson('blmiss') || '{}').origin === 'baseline', `status ${r.status} attempts ${attempts().join(',')} ${r.stdout} ${r.stderr}`);
for (const [slug, prov, why] of [['blstale', { ...PROV, width: 360 }, /stale: .*was frozen at 360px, this round is 1440px/], ['blurl', { ...PROV, url: 'https://live.example/other' }, /was frozen for https:\/\/live\.example\/other, this round's live URL is https:\/\/live\.example\//], ['bllone', null, /baseline\.png has no baseline\.json beside it \(an interrupted freeze\)/]]) {
  resetCount();
  if (prov) freezeBaseline(slug, prov); else { mkdirSync(join(root, gdir(slug)), { recursive: true }); writeFileSync(join(root, gdir(slug), 'baseline.png'), 'baseline-png-bytes'); }
  r = await gate([slug, 'https://live.example/', buildUrl, '1440', 'bl3', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile });
  check(`${slug}: an unusable baseline (another width / another URL / a lone PNG) is frozen again for this round's URL and width — its reason named, never compared`, r.status === 0 && attempts().join(',') === 'REF,BUILD'
    && why.test(r.stdout) && livePng(slug) === 'frozen-reference-bytes' && JSON.parse(readFileSync(join(root, gdir(slug), 'baseline.json'), 'utf8')).width === 1440, `status ${r.status} attempts ${attempts().join(',')} ${r.stdout} ${r.stderr}`);
}

resetCount();
freezeBaseline('bloff');
r = await gate(['bloff', 'https://live.example/', buildUrl, '1440', 'bl6', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('GATE_REFERENCE=live with a baseline beside the round: the round as it was — a fresh live shot, then the build; no live.json, the reference line says live, live.png is the live capture', r.status === 0 && attempts().join(',') === 'LIVE,BUILD'
  && liveJson('bloff') === null && livePng('bloff') === 'png' && !/reference: frozen/.test(r.stdout + r.stderr) && /^gate\.sh: reference: a live capture \(--live-origin \/ GATE_REFERENCE=live, or no reference\.mjs\) — not primed, no noise floor measured, no rows excluded$/m.test(r.stdout), `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['bloff', 'https://live.example/', buildUrl, '1440', 'bl7', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile });
check('… and the next round reuses that live.png (BUILD only), as on every round before this flag existed', r.status === 0 && attempts().join(',') === 'BUILD' && liveJson('bloff') === null, `attempts ${attempts().join(',')}`);

resetCount();
writeFileSync(join(root, gdir('blon'), 'live.capture.json'), '{ "stale": "a live round\'s record" }\n');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl8', '--marker', 'home-proposed'], { ...UNHELD, STUB_STITCH_COUNT: countFile });
check('flag dropped after a flagged round: the baseline-derived live.png is retaken with one line — LIVE then BUILD, live.json removed, live.png is the live capture', r.status === 0 && attempts().join(',') === 'LIVE,BUILD'
  && /^gate\.sh: live\.png is the frozen origin reference's copy; this round gates against the live origin \(--live-origin \/ GATE_REFERENCE=live\) — retaking it$/m.test(r.stderr) && (r.stderr.match(/retaking/g) || []).length === 1
  && liveJson('blon') === null && livePng('blon') === 'png', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr} ${liveJson('blon')}`);
check('… and the stale capture record (live.capture.json) went with the retaken live.png — the retake wrote a fresh one', existsSync(join(root, gdir('blon'), 'live.capture.json')) && !readFileSync(join(root, gdir('blon'), 'live.capture.json'), 'utf8').includes('stale'));
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl9', '--marker', 'home-proposed'], { ...UNHELD, STUB_STITCH_COUNT: countFile });
check('… the next unflagged round reuses that fresh live.png (BUILD only, no retake line)', r.status === 0 && attempts().join(',') === 'BUILD' && !/retaking/.test(r.stderr), `attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
writeFileSync(join(root, gdir('blon'), 'live.capture.json'), '{ "stale": "the live round\'s record" }\n');
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl10', '--marker', 'home-proposed', '--gate-against-baseline'], { ...UNHELD, STUB_STITCH_COUNT: countFile });
check('a flagged round after a live one takes the baseline again: BUILD only, live.png is baseline.png, live.json origin "baseline", no temp file', r.status === 0 && attempts().join(',') === 'BUILD'
  && livePng('blon') === 'baseline-png-bytes' && JSON.parse(liveJson('blon') || '{}').origin === 'baseline' && noTmp('blon'), `attempts ${attempts().join(',')} ${liveJson('blon')}`);
check('… and the live round\'s capture record (live.capture.json) is removed with the copy — no record describes bytes it did not measure', !existsSync(join(root, gdir('blon'), 'live.capture.json')));

// A record that cannot be written (STUB_RECORD_FAIL): the round ends (exit 1, one line) with live.png removed, so the
// baseline bytes never sit under a missing record for the next unflagged round to reuse as a live shot.
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl11', '--marker', 'home-proposed', '--gate-against-baseline'], { ...UNHELD, STUB_STITCH_COUNT: countFile, STUB_RECORD_FAIL: '1' });
check('a flagged round whose live.json write fails: exit 1 with one line, no capture spent, neither live.png nor live.json left', r.status === 1 && attempts().length === 0
  && /^gate\.sh: could not write stardust\/replica\/gates\/blon-1440\/live\.json for the frozen origin — not comparing \(a later round would read the copy as a live shot\); re-run the round$/m.test(r.stderr)
  && livePng('blon') === null && liveJson('blon') === null, `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await gate(['blon', 'https://live.example/', buildUrl, '1440', 'bl12', '--marker', 'home-proposed'], { ...UNHELD, STUB_STITCH_COUNT: countFile });
check('… so the next unflagged round captures live (LIVE,BUILD) instead of reusing baseline bytes', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && livePng('blon') === 'png', `attempts ${attempts().join(',')} ${r.stderr}`);
check('the frozen baseline itself is untouched by every round above', readFileSync(join(root, gdir('blon'), 'baseline.png'), 'utf8') === 'baseline-png-bytes' && JSON.parse(readFileSync(join(root, gdir('blon'), 'baseline.json'), 'utf8')).capturedAt === PROV.capturedAt);

// ---- The origin reference as the DEFAULT origin, and the aligned pixel criterion (DEF: no GATE_REFERENCE) ------------
// rounds.mjs is the real one for this section, so "recorded" and "not recorded" are read from rounds.json.
cpSync(join(scripts, 'rounds.mjs'), join(replica, 'rounds.mjs'));
const refArgsFile = join(root, 'ref-args.txt'); const pixelArgsFile = join(root, 'pixel-args.txt'); const stitchArgsFile = join(root, 'stitch-args-ref.txt');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
const resetRefArgs = () => { for (const f of [refArgsFile, pixelArgsFile, stitchArgsFile]) if (existsSync(f)) unlinkSync(f); };
const roundsOf = (slug) => { try { return Object.values(JSON.parse(readFileSync(join(root, gdir(slug), 'rounds.json'), 'utf8')).stages).flatMap((st) => st.rounds); } catch { return []; } };
const verdictJson = (slug, label) => { const f = join(root, gdir(slug), `verdict-${label}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const REFENV = { ...DEF, STUB_STITCH_COUNT: countFile, STUB_REF_ARGS: refArgsFile, STUB_PIXEL_ARGS: pixelArgsFile, STUB_STITCH_ARGS: stitchArgsFile };
const refRound = (slug, label, extra = [], env = {}) => gate([slug, `https://live.example/${slug}`, buildUrl, '1440', label, '--marker', 'home-proposed', ...extra], { ...REFENV, ...env });
const steps = (...pairs) => { let c = 0; return pairs.map(([y, shift]) => { c += shift; return { y, shift, cumulative: c }; }); };
const aligned = (pct, alignedPct, st, extra = {}) => JSON.stringify({ pct, aligned: { used: true, pct: alignedPct, steps: st }, ...extra });

// First round: no reference → frozen (one freeze, the round's flags), then gated against; second round: reused.
resetCount(); resetRefArgs();
// The later rounds of this page keep the round's capture settings (R1): other settings freeze the reference again (§ Capture settings, below).
const R1 = ['--consent', '#accept-all', '--dismiss', '.promo .close', '--locale', 'en-GB'];
r = await refRound('ref1', 'r1', ['--consent', '#accept-all', '--dismiss', '.promo .close', '--locale', 'en-GB'], { STUB_REF_FLOOR: '2.31', STUB_REF_MASK: '392:56,4000:652' });
check('default origin, first round: a reference is frozen (one freeze, no stitched live capture), then the build is captured and the round passes', r.status === 0 && attempts().join(',') === 'REF,BUILD', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
check('the freeze gets the live URL, the evidence dir, the width, the capture deadline and the round\'s overlay flags and locale', lines(refArgsFile).length === 1
  && lines(refArgsFile)[0] === `https://live.example/ref1 ${gdir('ref1')} --width 1440 --timeout 300 --consent #accept-all --dismiss .promo .close --locale en-GB --hold-timers --hold-min 2000`, lines(refArgsFile).join('|'));
check('… and the build capture gets the same flags and locale', /^BUILD .* --consent #accept-all --dismiss \.promo \.close --locale en-GB --hold-timers --hold-min 2000$/.test(lines(stitchArgsFile)[0] || ''), lines(stitchArgsFile).join('|'));
check('the freeze is announced with the reason, and reference.mjs\'s own line is relayed', /^gate\.sh: no usable frozen reference for ref1@1440 \(no frozen baseline in .*\) — freezing one/m.test(r.stdout) && /^gate\.sh: reference: frozen 1440×2000, primed, noise floor 2\.31% in 2 variable region\(s\) → mask 392:56,4000:652$/m.test(r.stdout), r.stdout);
check('the round gates against the frozen reference: live.png is its copy, live.json says origin "baseline"', livePng('ref1') === 'frozen-reference-bytes' && JSON.parse(liveJson('ref1') || '{}').origin === 'baseline');
check('one verdict line says what the round was gated against: capture time, noise floor, regions, rows excluded', /^gate\.sh: reference: frozen 2026-11-01T09:00:00\.000Z, noise floor 2\.31% in 2 region\(s\) — 708 rows excluded$/m.test(r.stdout), r.stdout);
check('the reference\'s mask reaches pixel-compare, with --offset-max at the regime\'s default and --json-out in the evidence dir', (() => { const a = lines(pixelArgsFile)[0] || ''; return / --offset-max prototype /.test(a) && a.includes(` --json-out ${gdir('ref1')}/pixel-r1.json`) && / --mask 392:56,4000:652$/.test(a); })(), lines(pixelArgsFile).join('|'));
check('a round that passed on the unaligned number still passes (alignment not used → the unaligned rule), and the pixel: line says so', /^pixel: 1\.20% \(alignment not used — the unaligned number rules\) → PASS$/m.test(r.stdout), r.stdout);
check('the round is recorded once, as a pass', roundsOf('ref1').length === 1 && roundsOf('ref1')[0].verdict === 'pass' && roundsOf('ref1')[0].label === 'r1', JSON.stringify(roundsOf('ref1')));
check('verdict-<label>.json is written for a pixel-only round too: stage, the pixel numbers, the masked rows, the noise floor, the reference', (() => {
  const v = verdictJson('ref1', 'r1');
  return v && v.round === 'r1' && v.width === 1440 && v.stage === 'prototype' && v.pixel.rc === 0 && v.pixel.pct === 1.2 && v.pixel.alignedPct === 1.2 && v.pixel.alignedUsed === false && v.pixel.totalShift === 0
    && Array.isArray(v.pixel.steps) && v.pixel.steps.length === 0 && v.pixel.maskedRows === 708 && v.pixel.noiseFloor === 2.31 && v.pixel.diff.endsWith('diff-r1.png') && v.pixel.json.endsWith('pixel-r1.json')
    && v.reference.origin === 'frozen' && v.reference.capturedAt === '2026-11-01T09:00:00.000Z' && v.reference.primed === true && v.reference.maskArg === '392:56,4000:652'
    && JSON.stringify(v.probes) === '{}' && v.structural === 0 && v.nothingLost === 0 && typeof v.at === 'string';
})(), JSON.stringify(verdictJson('ref1', 'r1')));
resetCount(); resetRefArgs();
r = await refRound('ref1', 'r2', [...R1, '--mask', '10:20', '--mask', '300:40@310']);
check('second round: the frozen reference is reused — no freeze, no live capture, only the build', r.status === 0 && attempts().join(',') === 'BUILD' && lines(refArgsFile).length === 0 && !/freezing one/.test(r.stdout), `status ${r.status} attempts ${attempts().join(',')}`);
check('a caller --mask (repeatable) is merged with the reference\'s: the caller\'s first, then the self-varying rows', / --mask 10:20,300:40@310,392:56,4000:652$/.test(lines(pixelArgsFile)[0] || '') && verdictJson('ref1', 'r2').pixel.maskedRows === 768, lines(pixelArgsFile).join('|'));
resetCount();
r = await refRound('ref1', 'r3', [...R1, '--full']);
check('a --full round on the default origin: the probes run against the live URL, the verdict file keeps the pixel numbers beside the probes', r.status === 0 && attempts().join(',') === 'BUILD' && /^content-diff: none/m.test(r.stdout)
  && readFileSync(join(root, gdir('ref1'), 'content-diff-r3.txt'), 'utf8').length > 0 && verdictJson('ref1', 'r3').pixel.noiseFloor === 2.31 && verdictJson('ref1', 'r3').probes['content-diff'].rc === 0 && verdictJson('ref1', 'r3').pixel.rc === 0, `status ${r.status} ${r.stdout}`);

check('a finished --full round leaves no pending mark in its verdict file', verdictJson('ref1', 'r3').pending === undefined);
// An unstable reference: no verdict, a distinct exit, nothing recorded.
r = await refRound('refunl', 'u0', ['--locale', 'de-DE'], { STUB_REF_RC: '2' });
check('the forced-freeze command of the exit-5 message carries the round\'s locale and overlay flags', r.status === 5 && /--width 1440 --locale de-DE --hold-timers --hold-min 2000 --force$/m.test(r.stderr), r.stderr);
resetCount(); resetRefArgs();
r = await refRound('refun', 'u1', ['--full'], { STUB_REF_RC: '2' });
check('an UNSTABLE reference ends the round with exit 5 after ONE freeze: no retry, no build capture, no pixel line, no probe', r.status === 5 && attempts().join(',') === 'REF' && !/differing|overflow assert|content-diff/.test(r.stdout), `status ${r.status} attempts ${attempts().join(',')} ${r.stdout}`);
check('reference.mjs\'s one-line reason is printed, then the way out: pin the state (overlay flags, --locale) or freeze --force after reading reference-unstable.json', /^gate\.sh: reference: UNSTABLE — heights 2000 vs 2640 after priming; not frozen$/m.test(r.stderr)
  && new RegExp(`^gate\\.sh: REFERENCE UNSTABLE \\(exit 5\\) — .*NO VERDICT, the round is not counted\\. Pin the page's state and re-run — overlay flags \\(--consent <sel> / --dismiss <sel,…>\\), --locale <tag> — or read ${gdir('refun')}/reference-unstable\\.json \\(\\+ ref-\\*\\.png\\) and, when the variation is the page's own, freeze it anyway: node .*reference\\.mjs freeze "https://live\\.example/refun" ${gdir('refun')} --width 1440 --hold-timers --hold-min 2000 --force$`, 'm').test(r.stderr), r.stderr);
check('no verdict file, no round recorded, no baseline, no live.png', !readdirSync(join(root, gdir('refun'))).some((f) => /^verdict-|^baseline\.|^live\.png$|^pixel-/.test(f)) && roundsOf('refun').length === 0, `${readdirSync(join(root, gdir('refun'))).join(',')} ${JSON.stringify(roundsOf('refun'))}`);
resetCount();
r = await refRound('refun', 'u2');
check('the next round freezes again (nothing was frozen) and, the page now stable, passes', r.status === 0 && attempts().join(',') === 'REF,BUILD', `status ${r.status} attempts ${attempts().join(',')}`);

// No-verdict exits of the freeze: a bot challenge (3), a deadline (124), a capture error (1, retried once).
resetCount();
r = await refRound('refbot', 'b1', [], { STUB_REF_RC: '3' });
check('a bot challenge during the freeze is exit 3 on the first attempt — the BLOCKED line, no build capture, nothing recorded, no verdict file', r.status === 3 && attempts().join(',') === 'REF'
  && /^gate\.sh: reference capture BLOCKED \(exit 3\) — a bot challenge or 2xx denial page, not the page: no verdict for this round; escalate --headed$/m.test(r.stderr) && roundsOf('refbot').length === 0 && verdictJson('refbot', 'b1') === null, `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await refRound('refslow', 's1', [], { STUB_REF_SLEEP: '6000', GATE_REFERENCE_TIMEOUT: '1' });
check('a freeze over GATE_REFERENCE_TIMEOUT is exit 124 — no verdict, not retried, nothing recorded', r.status === 124 && attempts().join(',') === 'REF' && /^gate\.sh: reference freeze hit its deadline \(exit 124\) — no verdict, re-run the round/m.test(r.stderr) && roundsOf('refslow').length === 0, `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await refRound('refonce', 'o1', [], { STUB_REF_FAIL_ONCE: join(root, 'once-ref') });
check('a freeze that exits 1 once is retried once and the round passes', r.status === 0 && attempts().join(',') === 'REF,REF,BUILD' && /^gate\.sh: reference freeze exited 1 — retrying once/m.test(r.stderr), `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
resetCount();
r = await refRound('referr', 'e1', [], { STUB_REF_RC: '1' });
check('two exit-1 freezes: exit 1, re-queue named, no verdict', r.status === 1 && attempts().join(',') === 'REF,REF' && /reference capture failed \(exit 1\) — not comparing \(twice: no verdict — re-queue the round\)/.test(r.stderr) && roundsOf('referr').length === 0, `status ${r.status} ${r.stderr}`);
r = await refRound('ref1', 'd1', R1, { STUB_PIXEL_RC: '124' });
check('a pixel deadline on the default origin is still exit 124 with no verdict file and no round recorded', r.status === 124 && verdictJson('ref1', 'd1') === null && !roundsOf('ref1').some((x) => x.label === 'd1'), `status ${r.status}`);
r = await refRound('ref1', 'd2', R1, { STUB_STITCH_RC_BUILD: '3' });
check('a blocked build capture on the default origin is still exit 3', r.status === 3 && verdictJson('ref1', 'd2') === null, `status ${r.status}`);

// --live-origin: the round as it was, for one round; GATE_REFERENCE=live the same for every round (the helper default).
resetCount();
r = await refRound('reflive', 'l1', ['--live-origin']);
check('--live-origin: a live capture, then the build — no freeze, no baseline written, live.png is the capture, the reference line says live', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && livePng('reflive') === 'png'
  && !existsSync(join(root, gdir('reflive'), 'baseline.png')) && liveJson('reflive') === null && /^gate\.sh: reference: a live capture/m.test(r.stdout) && verdictJson('reflive', 'l1').reference.origin === 'live' && verdictJson('reflive', 'l1').pixel.noiseFloor === null, `status ${r.status} attempts ${attempts().join(',')}`);
check('… and pixel-compare gets no reference mask', !/--mask/.test(lines(pixelArgsFile).pop() || ''), lines(pixelArgsFile).pop());
resetCount();
r = await gate(['reflive', 'https://live.example/reflive', buildUrl, '1440', 'l2', '--marker', 'home-proposed'], { STUB_STITCH_COUNT: countFile, GATE_REFERENCE: 'live' });
check('GATE_REFERENCE=live: the same for every round — the cached live.png is reused, no freeze', r.status === 0 && attempts().join(',') === 'BUILD' && !existsSync(join(root, gdir('reflive'), 'baseline.png')), `status ${r.status} attempts ${attempts().join(',')}`);
resetCount();
r = await gate(['reflive', 'https://live.example/reflive', buildUrl, '1440', 'l3', '--marker', 'home-proposed', '--gate-against-baseline'], { STUB_STITCH_COUNT: countFile, GATE_REFERENCE: 'live' });
check('--gate-against-baseline is accepted and means the default: over GATE_REFERENCE=live it freezes and gates against the reference', r.status === 0 && attempts().join(',') === 'REF,BUILD' && livePng('reflive') === 'frozen-reference-bytes', `status ${r.status} attempts ${attempts().join(',')} ${r.stderr}`);
r = await gate(['reflive', 'https://live.example/reflive', buildUrl, '1440', 'l4', '--marker', 'home-proposed'], { GATE_REFERENCE: 'sometimes' });
check('GATE_REFERENCE takes frozen or live only (exit 125)', r.status === 125 && /GATE_REFERENCE must be frozen or live/.test(r.stderr), `status ${r.status} ${r.stderr}`);
resetCount();
unlinkSync(join(replica, 'rounds.mjs')); const refStub = readFileSync(join(replica, 'reference.mjs'), 'utf8'); unlinkSync(join(replica, 'reference.mjs'));
r = await gate(['refnone', 'https://live.example/refnone', buildUrl, '1440', 'n1', '--marker', 'home-proposed'], { ...DEF, STUB_STITCH_COUNT: countFile });
check('a project copy without reference.mjs: one stdout line, the round gates against a live capture', r.status === 0 && attempts().join(',') === 'LIVE,BUILD' && /^gate\.sh: .*reference\.mjs missing — this round gates against a live capture/m.test(r.stdout), `status ${r.status} attempts ${attempts().join(',')} ${r.stdout}`);
writeFileSync(join(replica, 'reference.mjs'), refStub); cpSync(join(scripts, 'rounds.mjs'), join(replica, 'rounds.mjs'));

// The pixel criterion: aligned % ≤ threshold AND total offset ≤ the bound (8 prototype; published the larger of 8 and 1 %).
r = await refRound('px1', 'a1', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5])) });
check('aligned % within the threshold, offsets within the bound → exit 0 although the unaligned number is over the threshold', r.status === 0, `status ${r.status} ${r.stdout}`);
check('the aligned line of pixel-compare and the pixel: line — both percentages, the offset list, the bound — are printed after the pixel lines', /differing 1\.20%\n^aligned: 1\.23% \(unaligned 16\.62%\) — 1 offset step: −5px at y=103$/m.test(r.stdout)
  && /^pixel: aligned 1\.23% \(unaligned 16\.62%\) → PASS — offsets: 1 step\(s\), 5px total — −5px at y=103 \(bound 8px\)$/m.test(r.stdout), r.stdout);
check('the verdict file carries both percentages, alignedUsed, the total shift and the steps', (() => { const v = verdictJson('px1', 'a1').pixel; return v.rc === 0 && v.pct === 16.62 && v.alignedPct === 1.23 && v.alignedUsed === true && v.totalShift === 5 && JSON.stringify(v.steps) === JSON.stringify(steps([103, -5])) && v.offsetBound === 8 && v.reason === null; })(), JSON.stringify(verdictJson('px1', 'a1')));
r = await refRound('px1', 'a2', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5], [2125, -20], [3300, -12])) });
check('aligned % within the threshold but offsets over the bound → exit 2, and the reason names the offsets, not a percentage', r.status === 2
  && /^pixel: aligned 1\.23% \(unaligned 16\.62%\) → FAIL — offsets: 3 step\(s\), 37px total — −5px at y=103, −20px at y=2125, −12px at y=3300 \(bound 8px\)$/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
check('… recorded as a FAIL round, the verdict file says why', roundsOf('px1').map((x) => x.verdict).join(',') === 'pass,fail' && (() => { const v = verdictJson('px1', 'a2').pixel; return v.rc === 2 && v.totalShift === 37 && v.steps.length === 3 && /^offsets: 3 step\(s\), 37px total/.test(v.reason) && !/%/.test(v.reason); })(), JSON.stringify(verdictJson('px1', 'a2')));
resetRefArgs();
r = await refRound('px2', 'a3', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5], [2125, -20], [3300, -12]), { height: 5000 }), GATE_REGIME: 'published' });
check('published regime: the bound is the larger of 8 and 1 % of the origin height — 37 px pass on a 5000 px origin (bound 50)', r.status === 0 && / --offset-max published /.test(lines(pixelArgsFile)[0] || '') && /\(bound 50px\)$/m.test(r.stdout) && verdictJson('px2', 'a3').stage === 'published' && verdictJson('px2', 'a3').pixel.offsetBound === 50, `status ${r.status} ${r.stdout}`);
resetRefArgs();
r = await refRound('px3', 'a4', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5], [2125, -20], [3300, -12])), GATE_OFFSET_MAX_PX: '40' });
check('GATE_OFFSET_MAX_PX overrides the bound: 37 px pass at 40', r.status === 0 && / --offset-max 40 /.test(lines(pixelArgsFile)[0] || '') && /\(bound 40px\)$/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await refRound('px3', 'a5', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5], [2125, -20], [3300, -12])), GATE_OFFSET_MAX_PX: '36' });
check('… and fail at 36', r.status === 2, `status ${r.status}`);
r = await refRound('px3', 'a6', [], { GATE_OFFSET_MAX_PX: '8px' });
check('GATE_OFFSET_MAX_PX must be a whole number (exit 125)', r.status === 125 && /GATE_OFFSET_MAX_PX must be a whole number of px/.test(r.stderr), `status ${r.status} ${r.stderr}`);
r = await refRound('px4', 'a7', [], { STUB_PIXEL_JSON: aligned(30.1, 12, steps([103, 4])) });
check('the aligned % over the threshold fails on the percentage', r.status === 2 && /^pixel: aligned 12\.00% \(unaligned 30\.10%\) > 10% → FAIL — offsets: 1 step\(s\), 4px total/m.test(r.stdout) && verdictJson('px4', 'a7').pixel.reason === 'pixel aligned 12% (unaligned 30.1%) > 10%', `status ${r.status} ${r.stdout}`);
r = await refRound('px5', 'a8', [], { STUB_PIXEL_JSON: JSON.stringify({ pct: 16.62, aligned: { used: false, pct: 16.62, steps: [], reason: 'aligned number not lower than the unaligned one' } }) });
check('alignment not used (used: false) → the unaligned number rules: 16.62 % fails', r.status === 2 && /^pixel: 16\.62% \(alignment not used — the unaligned number rules\) > 10% → FAIL$/m.test(r.stdout) && verdictJson('px5', 'a8').pixel.alignedUsed === false && verdictJson('px5', 'a8').pixel.alignedPct === 16.62, `status ${r.status} ${r.stdout}`);
r = await refRound('px5', 'a9', [], { STUB_PIXEL_JSON: JSON.stringify({ pct: 9.5, aligned: { used: false, pct: 9.5, steps: [] } }) });
check('… and 9.5 % passes, as it did before alignment', r.status === 0, `status ${r.status}`);
r = await refRound('px6', 'a10', [], { STUB_PIXEL_JSON: aligned(9.5, 4, steps([400, 3], [900, -5])) });
check('a round that passed on the unaligned number (9.5 %) still passes when its offsets are within the bound (8 px) …', r.status === 0, `status ${r.status} ${r.stdout}`);
r = await refRound('px6', 'a11', [], { STUB_PIXEL_JSON: aligned(9.5, 4, steps([400, 3], [900, -6])) });
check('… and fails only when they exceed it (9 px): the one new way to fail', r.status === 2 && /→ FAIL — offsets: 2 step\(s\), 9px total/.test(r.stdout), `status ${r.status} ${r.stdout}`);
r = await refRound('px7', 'a12', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1])) });
check('the offset list prints at most 6 steps then "… N more"; the verdict file keeps at most 12', r.status === 2 && /\+1px at y=6, … 8 more \(bound 8px\)$/m.test(r.stdout) && verdictJson('px7', 'a12').pixel.steps.length === 12 && verdictJson('px7', 'a12').pixel.totalShift === 14, `status ${r.status} ${r.stdout}`);
r = await refRound('px8', 'a13', [], { STUB_PIXEL_JSON: aligned(16.62, 1.23, steps([103, -5])), STUB_OVERFLOW: '13' });
check('the overflow assert still rules an aligned PASS (exit 2), and the verdict file records the round\'s exit', r.status === 2 && /OVERFLOW at 1440/.test(r.stdout) && verdictJson('px8', 'a13').pixel.rc === 2, `status ${r.status}`);
unlinkSync(join(replica, 'rounds.mjs'));

// Disk (#156): a round keeps only its own diff image and vdiff dir; earlier rounds keep their text and JSON evidence.
const kdir = join(root, 'stardust/replica/gates/keep-1440');
for (const d of ['vdiff-iter1', 'vdiff-iter2']) mkdirSync(join(kdir, d), { recursive: true });
for (const f of ['diff-iter1.png', 'diff-final.png', 'vdiff-iter1/eds-full.png', 'diff-iter2.png', 'vdiff-iter2/eds-full.png', 'chrome-header-diff.png', 'baseline.png', 'verdict-iter1.json', 'content-diff-iter1.txt']) writeFileSync(join(kdir, f), 'x');
r = await gate(['keep', 'https://live.example/', buildUrl, '1440', 'iter2', '--marker', 'home-proposed']);
check('a round deletes earlier rounds\' diff-*.png and vdiff-*/ before comparing', r.status === 0 && !existsSync(join(kdir, 'diff-iter1.png')) && !existsSync(join(kdir, 'diff-final.png')) && !existsSync(join(kdir, 'vdiff-iter1')), `status ${r.status} ${readdirSync(kdir).join(',')}`);
check('… and keeps everything else: this round\'s diff and vdiff dir, captures, the frozen baseline, crop diffs, earlier rounds\' text and JSON', ['diff-iter2.png', 'vdiff-iter2/eds-full.png', 'live.png', 'build.png', 'baseline.png', 'chrome-header-diff.png', 'verdict-iter1.json', 'content-diff-iter1.txt'].every((f) => existsSync(join(kdir, f))), readdirSync(kdir).join(','));

// ── Stage (header § Stage): prototype / local-build / published from the build URL, GATE_REGIME overrides ──────────
// rounds.mjs is the real one: the stage is read from its `check` line (printed before any fetch), the ledger and
// verdict-<label>.json. The build server answers every path with the marker.
cpSync(join(scripts, 'rounds.mjs'), join(replica, 'rounds.mjs'));
const base = buildUrl.replace(/\/home-proposed\.html$/, '');
writeFileSync(join(root, 'file-proposed.html'), 'home-proposed'); writeFileSync(join(root, 'index.html'), 'home-proposed');
const stageOfRun = (out) => (/^rounds: \S+ (\S+) — /m.exec(out) || [])[1]; // "round … may run", or "cap check off" in this sandbox
const STAGE_TABLE = [
  [`${base}/home-proposed.html`, {}, 'prototype'],
  [`${base}/home-proposed.html?v=2#top`, {}, 'prototype'],
  [`file://${root}/file-proposed.html`, {}, 'prototype'],
  [`${base.replace('127.0.0.1', 'localhost')}/home-proposed.html`, {}, 'prototype'],
  [`${base}/products/home`, {}, 'local-build'],
  [`${base}/`, {}, 'local-build'],
  [`${base}/home-proposed.html.plain.html`, {}, 'local-build'],
  [`${base}/page?from=home-proposed.html`, {}, 'local-build'],
  [`file://${root}/index.html`, {}, 'local-build'],
  [`${base}/home-proposed.html`, { GATE_REGIME: 'local-build' }, 'local-build'],
  [`${base}/products/home`, { GATE_REGIME: 'prototype' }, 'prototype'],
  [`${base}/products/home`, { GATE_REGIME: 'published' }, 'published'],
  [`${base}/home-proposed.html`, { GATE_REGIME: 'published' }, 'published'],
  [`${base}/products/home`, { GATE_REGIME: 'staging' }, 'local-build'], // an unknown value is ignored: the URL decides
  ['https://127.0.0.1:1/home-proposed.html', {}, 'published'], // not a local http URL; nothing listens: exit 4 after the stage line
  ['https://127.0.0.1:1/home-proposed.html', { GATE_REGIME: 'local-build' }, 'local-build'],
];
let si = 0;
for (const [url, env, want] of STAGE_TABLE) {
  si += 1;
  r = await gate([`st${si}`, 'https://live.example/', url, '1440', 'x1', '--marker', 'home-proposed'], { GATE_REGIME: '', ...env });
  const v = verdictJson(`st${si}`, 'x1');
  check(`stage: ${url.replace(base, '<local>').replace(root, '<root>')}${env.GATE_REGIME ? ` GATE_REGIME=${env.GATE_REGIME}` : ''} → ${want}`, stageOfRun(r.stdout) === want && (r.status === 4 || (r.status === 0 && v && v.stage === want)), `status ${r.status} stage ${stageOfRun(r.stdout)} verdict ${v && v.stage} ${r.stderr.slice(0, 200)}`);
}
r = await gate(['--help']);
check('--help documents the three stages, the -proposed.html rule and GATE_REGIME', /^Stage \(/m.test(r.stdout) && /prototype +the build URL is local .* AND its path ends in\n? *-proposed\.html/.test(r.stdout) && /local-build +the build URL is local and anything else/.test(r.stdout) && /GATE_REGIME +prototype \| local-build \| published/.test(r.stdout), r.stdout.slice(0, 300));

// local-build rounds: their own budget in the same gate dir, the prototype stage's offset bound, stage in the verdict file.
const stageRounds = (slug, stage) => { try { return JSON.parse(readFileSync(join(root, gdir(slug), 'rounds.json'), 'utf8')).stages[stage]?.rounds || []; } catch { return []; } };
const lbRound = (label, url, env = {}, extra = []) => gate(['lb', 'https://live.example/lb', url, '1440', label, '--marker', 'home-proposed', ...extra], { GATE_REGIME: '', STARDUST_ROUND_CAP: '', STUB_PIXEL_ARGS: pixelArgsFile, ...env }); // the cap is on here: rounds.mjs is in the sandbox
const FAIL = { STUB_PIXEL_RC: '2' };
for (const l of ['iter1', 'iter2', 'iter3']) await lbRound(l, buildUrl, FAIL);
r = await lbRound('iter4', buildUrl, FAIL);
check('the prototype stage is at its cap after three failed rounds (exit 6)', r.status === 6 && stageRounds('lb', 'prototype').length === 3, `status ${r.status}`);
resetRefArgs();
r = await lbRound('eds1', `${base}/lb`, FAIL);
check('a local build that is not the prototype runs in the same gate dir although the prototype stage is spent: its own budget', r.status === 2 && /^rounds: lb-1440 local-build — round "eds1" may run: the first round/m.test(r.stdout) && /^rounds: lb-1440 local-build — recorded "eds1" fail as first/m.test(r.stdout), `status ${r.status} ${r.stdout.slice(0, 300)} ${r.stderr.slice(0, 200)}`);
check('… recorded under local-build, the prototype rounds untouched', stageRounds('lb', 'local-build').map((x) => x.label).join() === 'eds1' && stageRounds('lb', 'prototype').map((x) => x.label).join() === 'iter1,iter2,iter3');
check('verdict-<label>.json says stage "local-build"', (verdictJson('lb', 'eds1') || {}).stage === 'local-build' && (verdictJson('lb', 'iter1') || {}).stage === 'prototype');
check('the local-build pixel verdict uses the prototype stage\'s offset bound (pixel-compare --offset-max prototype = 8 px)', / --offset-max prototype /.test(lines(pixelArgsFile)[0] || ''), lines(pixelArgsFile).join('|'));
r = await lbRound('eds2', `${base}/lb`, { ...FAIL, GATE_OFFSET_MAX_PX: '20' });
check('GATE_OFFSET_MAX_PX still overrides the bound', / --offset-max 20 /.test(lines(pixelArgsFile)[1] || ''), lines(pixelArgsFile).join('|'));
await lbRound('eds3', `${base}/lb`, FAIL);
const lbBefore = readdirSync(join(root, gdir('lb'))).sort().join();
r = await lbRound('eds4', `${base}/lb`, FAIL);
check('local-build is capped on its own: the fourth counted round exits 6 naming --stage local-build, before any work', r.status === 6 && /rounds\.mjs decide stardust\/replica\/gates\/lb-1440 --stage local-build/.test(r.stderr) && readdirSync(join(root, gdir('lb'))).sort().join() === lbBefore, `status ${r.status} ${r.stderr}`);
resetRefArgs();
r = await lbRound('pub1', `${base}/lb`, { GATE_REGIME: 'published' });
check('the published stage of the same dir still runs, with its own bound', r.status === 0 && stageRounds('lb', 'published').length === 1 && / --offset-max published /.test(lines(pixelArgsFile)[0] || ''), `status ${r.status}`);
// --full at the local-build stage: the prototype stage's probe set (no content-presence); unit-geometry reads the delivered block's selector.
writeFileSync(join(root, 'stardust/replica/units.json'), JSON.stringify({ cards: { origin: '.a', build: '.b', eds: '.c', pages: ['lbf'] } }));
r = await gate(['lbf', 'https://live.example/lbf', `${base}/lbf`, '1440', 'eds1', '--marker', 'home-proposed', '--full'], { GATE_REGIME: '' });
unlinkSync(join(root, 'stardust/replica/units.json'));
check('--full local-build: content-diff, visual-diff, chrome-parity, clip-probe and unit-geometry run; content-presence does not', (() => {
  const v = verdictJson('lbf', 'eds1') || { probes: {} };
  return r.status === 0 && v.stage === 'local-build' && Object.keys(v.probes).sort().join() === 'chrome-parity,clip-probe,content-diff,unit-geometry,visual-diff' && !existsSync(join(root, gdir('lbf'), 'content-presence-eds1.txt')) && !/^content-presence:/m.test(r.stdout);
})(), `status ${r.status} ${r.stdout} ${JSON.stringify(verdictJson('lbf', 'eds1'))}`);
check('… unit-geometry gets --stage published (the delivered blocks are served), never the unknown stage name', / --stage published /.test(evidence('lbf', 'units-eds1.txt')), evidence('lbf', 'units-eds1.txt'));

// ── Capture settings: a reference frozen under other overlay flags / locale is frozen again, never silently reused ──
const freezes = () => lines(refArgsFile).length;
resetRefArgs(); r = await refRound('set', 's1');
check('settings: the first round freezes the reference under its flags (none)', r.status === 0 && freezes() === 1 && !/re-frozen/.test(r.stdout), `status ${r.status} ${r.stderr}`);
resetRefArgs(); r = await refRound('set', 's2');
check('settings: nothing changed → the reference is reused, no freeze, no settings line', r.status === 0 && freezes() === 0 && !/re-frozen|settings not recorded/.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('set', 's2b', ['--locale', 'en-US']);
check('settings: --locale en-US is the default locale — not a change', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout), r.stdout);
writeFileSync(join(root, gdir('set'), 'chrome-live.json'), '{}');
resetRefArgs(); r = await refRound('set', 's3', ['--consent', '#ok', '--locale', 'de-DE']);
check('settings: consent and locale changed → re-frozen under the round\'s flags, said in one line', r.status === 0 && freezes() === 1 && (r.stdout.match(/^gate\.sh: reference: re-frozen — capture settings changed \(consent, locale\)$/gm) || []).length === 1 && !/no usable frozen reference/.test(r.stdout), `status ${r.status} ${r.stdout}`);
check('… the freeze gets the new flags and never --force (an unstable page stays unstable)', / --consent #ok --locale de-DE --hold-timers --hold-min 2000$/.test(lines(refArgsFile)[0] || '') && !/--force/.test(lines(refArgsFile)[0] || ''), lines(refArgsFile).join('|'));
check('… the new baseline records them, the round gates against it, and the chrome live cache of the old settings is gone', (() => { const b = JSON.parse(readFileSync(join(root, gdir('set'), 'baseline.json'), 'utf8')); return b.flags.consent === '#ok' && b.flags.locale === 'de-DE' && livePng('set') === 'frozen-reference-bytes' && !existsSync(join(root, gdir('set'), 'chrome-live.json')); })());
resetRefArgs(); r = await refRound('set', 's4', ['--consent', '#ok', '--locale', 'de-DE']);
check('settings: the same flags again → reused', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout));
resetRefArgs(); resetCount(); r = await refRound('set', 's4b');
check('settings: a round that omits the reference\'s flags reuses it AND runs its build capture under them, said in one line', r.status === 0 && freezes() === 0
  && /^gate\.sh: reference: settings this round omits are the frozen reference's — --consent #ok --locale de-DE /m.test(r.stdout)
  && lines(stitchArgsFile).some((l) => /build\.png .*--consent #ok --locale de-DE --hold-timers --hold-min 2000$/.test(l)), `${r.stdout}\n${lines(stitchArgsFile).join(' | ')}`);
check('a re-freeze is not a round: four invocations with a verdict, four recorded rounds (first + confirmations), 1 counted', roundsOf('set').map((x) => `${x.label}:${x.kind}`).join() === 's1:first,s2:confirm,s2b:confirm,s3:confirm,s4:confirm,s4b:confirm', JSON.stringify(roundsOf('set')));
resetRefArgs(); r = await refRound('set', 's5', ['--no-dismiss'], { STUB_REF_RC: '2' });
check('settings: a re-freeze that finds the page unstable ends the round with exit 5 — no verdict, no round, and no reference of the old settings left to gate against', r.status === 5 && freezes() === 1 && !existsSync(join(root, gdir('set'), 'baseline.json')) && !existsSync(join(root, gdir('set'), 'baseline.png')) && verdictJson('set', 's5') === null && roundsOf('set').length === 6 && !/re-frozen/.test(r.stdout), `status ${r.status} ${r.stdout}`);
resetRefArgs(); r = await refRound('set', 's6', ['--dismiss', '.promo-close']);
check('settings: with no reference left the next round freezes one as a first freeze (no re-frozen line)', r.status === 0 && freezes() === 1 && !/capture settings changed/.test(r.stdout) && /no usable frozen reference/.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('set', 's7', ['--dismiss', '.other-close']);
check('… a changed --dismiss list alone', r.status === 0 && freezes() === 1 && /^gate\.sh: reference: re-frozen — capture settings changed \(dismiss\)$/m.test(r.stdout), r.stdout);
// a baseline from before flags were recorded (stitch-shot --freeze-baseline, an older reference.mjs): reused, and said so
freezeBaseline('old', { ...PROV, url: 'https://live.example/old' });
resetRefArgs(); r = await refRound('old', 'o1', ['--consent', '#ok', '--locale', 'de-DE'], UNHELD);
check('settings not recorded (an unheld round): the reference is reused as before, with one line saying so', r.status === 0 && freezes() === 0 && (r.stdout.match(/^gate\.sh: reference: reused — settings not recorded \(/gm) || []).length === 1 && livePng('old') === 'baseline-png-bytes', `status ${r.status} ${r.stdout}`);

// ── Timer hold: ON by default at 2000 ms — the reference and both captures under one hold, or nothing is compared ──
const HELD = /^gate\.sh: timers held \(≥ 2000 ms\) — live 2 \(5000, 86400000 ms\), build 1 \(5000 ms\)$/m;
const HOLD_ARGS = / --hold-timers --hold-min 2000$/;
const buildArgs = () => lines(stitchArgsFile).filter((l) => /^BUILD /.test(l));
const recHold = (slug, f) => { try { return (JSON.parse(readFileSync(join(root, gdir(slug), f), 'utf8')).timers || {}).hold ?? null; } catch { return null; } };
const unheld = (res) => !/--hold/.test(lines(refArgsFile).join(' ')) && !/--hold/.test(lines(stitchArgsFile).join(' ')) && !/timers held/.test(res.stdout + res.stderr);
const DEFAULT_WHY = 'gate.sh: reference: re-frozen — capture settings changed (holdTimers): the gates hold timers by default and this reference was frozen without the hold — frozen again once (--no-hold-timers or GATE_HOLD_TIMERS=0 keeps a round unheld)';
const whyLines = (res) => res.stdout.split('\n').filter((l) => l === DEFAULT_WHY).length;
resetRefArgs(); r = await refRound('hold', 'h1');
check('hold default: a round that names no hold holds on both sides — the reference freeze and the build capture get --hold-timers --hold-min 2000, both records say 2000, one line says what each side held', r.status === 0 && freezes() === 1
  && HOLD_ARGS.test(lines(refArgsFile)[0] || '') && buildArgs().length === 1 && HOLD_ARGS.test(buildArgs()[0]) && recHold('hold', 'baseline.json') === 2000 && recHold('hold', 'build.capture.json') === 2000 && HELD.test(r.stdout), `status ${r.status} ${r.stdout}\n${r.stderr}`);
resetRefArgs(); r = await refRound('hold', 'h2');
check('hold default: the next default round reuses the held reference — no freeze, no settings line, the build captured under the hold', r.status === 0 && freezes() === 0 && !/re-frozen|settings this round omits/.test(r.stdout)
  && HOLD_ARGS.test(buildArgs()[0] || '') && HELD.test(r.stdout), `${r.stdout}\n${lines(stitchArgsFile).join(' | ')}`);
resetRefArgs(); r = await refRound('hold', 'h3', [], { GATE_HOLD_TIMERS: '1' });
check('hold: GATE_HOLD_TIMERS=1 is the default\'s hold — the same as the reference\'s: reused', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && HELD.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('hold', 'h3b', ['--hold-timers']);
check('hold: --hold-timers likewise', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && HELD.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('hold', 'h4', ['--hold-min', '3000']);
check('hold: another threshold → the reference is frozen again (holdTimers)', r.status === 0 && freezes() === 1 && /^gate\.sh: reference: re-frozen — capture settings changed \(holdTimers\)$/m.test(r.stdout) && / --hold-timers --hold-min 3000$/.test(lines(refArgsFile)[0] || ''), r.stdout);
resetRefArgs(); r = await refRound('hold', 'h4b');
check('hold default: a round that names no hold takes a held reference\'s threshold — no freeze, the build captured under it, said in one line', r.status === 0 && freezes() === 0
  && /^gate\.sh: reference: settings this round omits are the frozen reference's — --hold-timers --hold-min 3000 /m.test(r.stdout)
  && /build\.png .*--hold-timers --hold-min 3000$/.test(buildArgs()[0] || '') && /^gate\.sh: timers held \(≥ 3000 ms\)/m.test(r.stdout), `${r.stdout}\n${lines(stitchArgsFile).join(' | ')}`);
resetRefArgs(); r = await refRound('hold', 'h5', ['--hold-min', '3000'], { STUB_NO_HOLD_BUILD: '1' });
check('hold: a build captured without the hold against a held reference is never compared — exit 1, one line, no verdict', r.status === 1 && /^gate\.sh: timer hold differs — origin '3000' \(.*baseline\.json\), build '', this round '3000'/m.test(r.stderr) && verdictJson('hold', 'h5') === null && lines(pixelArgsFile).length === 0, `status ${r.status} ${r.stderr}`);
resetRefArgs(); r = await refRound('holdnb', 'h1', [], { STUB_NO_HOLD_BUILD: '1' });
check('hold default: the default hold fails closed too — a build capture whose record has no hold is exit 1, nothing compared', r.status === 1 && /^gate\.sh: timer hold differs — origin '2000' \(.*baseline\.json\), build '', this round '2000'/m.test(r.stderr) && verdictJson('holdnb', 'h1') === null && lines(pixelArgsFile).length === 0, `status ${r.status} ${r.stderr}`);
resetRefArgs(); r = await refRound('hold', 'h6', ['--no-hold-timers']);
check('hold: --no-hold-timers against a held reference freezes it again without the hold (holdTimers)', r.status === 0 && freezes() === 1 && /^gate\.sh: reference: re-frozen — capture settings changed \(holdTimers\)$/m.test(r.stdout) && unheld(r) && recHold('hold', 'baseline.json') === null, `${r.stdout}\n${lines(refArgsFile).join(' | ')}`);
// off: the flag and the variable; a project that never holds keeps its unheld reference
resetRefArgs(); r = await refRound('nohold', 'n1', ['--no-hold-timers']);
check('hold off: --no-hold-timers — no hold flag on the freeze or the captures, no hold in either record, no timers line', r.status === 0 && freezes() === 1 && unheld(r) && recHold('nohold', 'baseline.json') === null && recHold('nohold', 'build.capture.json') === null, `${r.stdout}\n${lines(stitchArgsFile).join(' | ')}`);
resetRefArgs(); r = await refRound('noholdenv', 'n1', [], { GATE_HOLD_TIMERS: '0' });
check('hold off: GATE_HOLD_TIMERS=0 likewise', r.status === 0 && freezes() === 1 && unheld(r) && recHold('noholdenv', 'baseline.json') === null && recHold('noholdenv', 'build.capture.json') === null, `${r.stdout}\n${lines(stitchArgsFile).join(' | ')}`);
resetRefArgs(); r = await refRound('nohold', 'n2', ['--no-hold-timers']); const offAgain = r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && unheld(r);
resetRefArgs(); r = await refRound('nohold', 'n3', [], { GATE_HOLD_TIMERS: '0' });
check('hold off: a project whose rounds all run unheld (--no-hold-timers, GATE_HOLD_TIMERS=0) keeps its unheld reference — never frozen again', offAgain && r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && unheld(r), r.stdout);
// an existing project: a reference frozen before the default (no hold) meets a round that holds
resetRefArgs(); r = await refRound('nohold', 'n4');
check('hold default: an old unheld reference is frozen again under the hold, and one line says why', r.status === 0 && freezes() === 1 && whyLines(r) === 1 && (r.stdout.match(/re-frozen/g) || []).length === 1
  && HOLD_ARGS.test(lines(refArgsFile)[0] || '') && recHold('nohold', 'baseline.json') === 2000 && HELD.test(r.stdout), `status ${r.status} ${r.stdout}`);
resetRefArgs(); r = await refRound('nohold', 'n5'); const onceA = r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout);
resetRefArgs(); r = await refRound('nohold', 'n6');
check('hold default: … once — the rounds after it reuse the held reference, no freeze, no line', onceA && r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && HELD.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('legacy', 'l1', ['--consent', '#ok', '--locale', 'de-DE', '--no-hold-timers']);
resetRefArgs(); r = await refRound('legacy', 'l2');
check('hold default: the old reference\'s recorded settings a round omits go into that freeze — frozen again under them plus the hold, the build captured alike', r.status === 0 && freezes() === 1 && whyLines(r) === 1
  && / --consent #ok --locale de-DE --hold-timers --hold-min 2000$/.test(lines(refArgsFile)[0] || '') && /build\.png .*--consent #ok --locale de-DE --hold-timers --hold-min 2000$/.test(buildArgs()[0] || '')
  && /^gate\.sh: reference: settings this round omits are the frozen reference's — --consent #ok --locale de-DE /m.test(r.stdout), `${r.stdout}\n${lines(refArgsFile).join(' | ')}`);
resetRefArgs(); r = await refRound('legacy', 'l3');
check('hold default: … and the round after reuses it', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout) && /build\.png .*--consent #ok --locale de-DE --hold-timers --hold-min 2000$/.test(buildArgs()[0] || ''), r.stdout);
resetRefArgs(); r = await refRound('legacy2', 'm1', ['--consent', '#ok', '--locale', 'de-DE', '--no-hold-timers']);
resetRefArgs(); r = await refRound('legacy2', 'm2', ['--consent', '#other']);
check('hold default: a default round that ALSO changes a setting inherits nothing from the old reference — frozen under this round\'s flags plus the hold, as gate-all does', r.status === 0 && freezes() === 1
  && / --consent #other --hold-timers --hold-min 2000$/.test(lines(refArgsFile)[0] || '') && !/de-DE/.test(lines(refArgsFile)[0] || '') && !/de-DE/.test(buildArgs()[0] || ''), `${lines(refArgsFile)[0]}\n${buildArgs()[0]}\n${r.stdout}`);
resetRefArgs(); r = await refRound('old', 'o2');
check('hold default: a reference with NO recorded settings (stitch-shot\'s) is not reused under the hold — frozen again with the line, never "settings not recorded"', r.status === 0 && freezes() === 1 && whyLines(r) === 1 && !/settings not recorded/.test(r.stdout) && livePng('old') === 'frozen-reference-bytes', `status ${r.status} ${r.stdout}`);
resetRefArgs(); r = await refRound('old', 'o3');
check('hold default: … once', r.status === 0 && freezes() === 0 && !/re-frozen/.test(r.stdout), r.stdout);
resetRefArgs(); r = await refRound('legacyun', 'l1', ['--no-hold-timers']);
resetRefArgs(); r = await refRound('legacyun', 'l2', [], { STUB_REF_RC: '2' });
check('hold default: an old unheld reference whose re-freeze finds the page unstable — exit 5, and the reason for the freeze is said once (stderr)', r.status === 5 && freezes() === 1
  && (r.stderr.match(/^gate\.sh: reference: was being frozen again — capture settings changed \(holdTimers\): the gates hold timers by default /gm) || []).length === 1, `status ${r.status} ${r.stderr}`);
// precedence: a flag over GATE_HOLD_TIMERS over the default
const holdOfRound = async (label, flags, env) => { resetRefArgs(); const res = await refRound('prec', label, flags, env); const m = /--hold-min (\d+)$/.exec(buildArgs()[0] || ''); return res.status === 0 ? (m ? Number(m[1]) : /--hold/.test(buildArgs()[0] || '--hold') ? 'bad' : 'off') : `exit ${res.status}`; };
const prec = [await holdOfRound('p1', [], { GATE_HOLD_TIMERS: '2500' }), await holdOfRound('p2', ['--no-hold-timers'], { GATE_HOLD_TIMERS: '2500' }), await holdOfRound('p3', ['--hold-min', '4000'], { GATE_HOLD_TIMERS: '0' }),
  await holdOfRound('p4', ['--hold-timers'], { GATE_HOLD_TIMERS: '0' }), await holdOfRound('p5', ['--hold-timers'], { GATE_HOLD_TIMERS: '3000' }), await holdOfRound('p6', ['--hold-min', '4000'], { GATE_HOLD_TIMERS: '3000' })];
check('hold precedence: a flag wins over GATE_HOLD_TIMERS, which wins over the default — env 2500 → 2500; --no-hold-timers over env 2500 → off; --hold-min 4000 over env 0 → 4000; --hold-timers over env 0 → 2000; --hold-timers keeps env 3000\'s threshold; --hold-min 4000 over env 3000 → 4000',
  JSON.stringify(prec) === JSON.stringify([2500, 'off', 4000, 2000, 3000, 4000]), JSON.stringify(prec));
for (const bad of [['--no-hold-timers', '--hold-timers'], ['--hold-min', '3000', '--no-hold-timers']]) { r = await refRound('plain', 'n2', bad); check(`hold: ${bad.join(' ')} is a usage error (exit 125)`, r.status === 125 && /--no-hold-timers contradicts/.test(r.stderr), r.stderr); }
// ── The hint (reference.mjs § HINT): only an unheld round can carry it — a reference whose captures differed without the hold ──
const HINT = 'the page changes on its own between captures (2 self-varying region(s) masked) — when a timer drives the change (a carousel that advances by itself), freezing again with --hold-timers (the gates hold by default: drop --no-hold-timers / GATE_HOLD_TIMERS=0) captures it in one state';
const hintLines = (s) => (s.match(/^gate\.sh: hint: .*$/gm) || []);
const sameVerdict = (v) => JSON.stringify({ ...v, at: 0 }).replace(/hint(no)?-1440/g, 'X'); // the record without its time and its dir
const SELF = { STUB_REF_FLOOR: '2.31', STUB_REF_MASK: '392:56,4000:652', STUB_REF_HINT: HINT };
resetRefArgs(); r = await refRound('hint', 'i1', [], { ...SELF, ...UNHELD });
const hintFreezes = freezes();
const plainRound = await refRound('hintno', 'i1', [], { STUB_REF_FLOOR: '2.31', STUB_REF_MASK: '392:56,4000:652', ...UNHELD });
check('hint: a self-varying page frozen with the hold turned off — the reference\'s hint once on stdout, after the reference line; the exit code and the verdict are those of the same round without it', r.status === 0 && plainRound.status === 0 && hintFreezes === 1
  && hintLines(r.stdout).length === 1 && hintLines(r.stdout)[0] === `gate.sh: hint: ${HINT}` && hintLines(r.stderr).length === 0 && hintLines(plainRound.stdout + plainRound.stderr).length === 0
  && /^gate\.sh: reference: frozen 2026-11-01T09:00:00\.000Z, noise floor 2\.31% in 2 region\(s\) — 708 rows excluded\ngate\.sh: hint: /m.test(r.stdout)
  && sameVerdict(verdictJson('hint', 'i1')) === sameVerdict(verdictJson('hintno', 'i1')), `status ${r.status} ${r.stdout}\n${JSON.stringify(verdictJson('hint', 'i1'))}\n${JSON.stringify(verdictJson('hintno', 'i1'))}`);
resetRefArgs(); r = await refRound('hint', 'i2', ['--no-hold-timers']);
check('hint: the next unheld round reuses the reference and repeats its hint, once', r.status === 0 && freezes() === 0 && hintLines(r.stdout).length === 1, r.stdout);
resetRefArgs(); r = await refRound('hint', 'i3', [], SELF);
check('hint: a default round freezes that reference again under the hold and it carries no hint — no hint line', r.status === 0 && freezes() === 1 && whyLines(r) === 1 && hintLines(r.stdout + r.stderr).length === 0 && !('hint' in JSON.parse(readFileSync(join(root, gdir('hint'), 'baseline.json'), 'utf8'))), r.stdout);
resetRefArgs(); r = await refRound('hintdef', 'i1', [], SELF); const noHintFirst = r.status === 0 && freezes() === 1 && hintLines(r.stdout + r.stderr).length === 0;
resetRefArgs(); r = await refRound('hintdef', 'i2', [], SELF);
check('hint: a default round prints none — neither on the round that freezes a self-varying page nor on the one that reuses the reference', noHintFirst && r.status === 0 && freezes() === 0 && hintLines(r.stdout + r.stderr).length === 0, r.stdout);
resetRefArgs(); r = await refRound('hintenv', 'i1', [], { ...SELF, GATE_HOLD_TIMERS: '1' });
check('hint: GATE_HOLD_TIMERS=1 likewise', r.status === 0 && hintLines(r.stdout + r.stderr).length === 0, r.stdout);
resetRefArgs(); r = await refRound('plain', 'n3', [], UNHELD);
check('hint: a stable page has none, unheld either', r.status === 0 && !/hint/.test(r.stdout + r.stderr), r.stdout);
resetRefArgs(); r = await refRound('hintun', 'i1', [], { STUB_REF_RC: '2', STUB_REF_HINT: HINT, ...UNHELD });
check('hint: an UNSTABLE freeze with the hold turned off — still exit 5 and its two lines, plus the hint once (stderr)', r.status === 5 && hintLines(r.stderr).length === 1 && hintLines(r.stdout).length === 0 && /^gate\.sh: REFERENCE UNSTABLE \(exit 5\)/m.test(r.stderr) && verdictJson('hintun', 'i1') === null, `status ${r.status} ${r.stderr}`);
resetRefArgs(); r = await refRound('hintun', 'i2', [], { STUB_REF_RC: '2', STUB_REF_HINT: HINT });
check('hint: … and on a default round exit 5 with no hint', r.status === 5 && hintLines(r.stdout + r.stderr).length === 0, r.stderr);
for (const bad of [['--hold-min', '1999'], ['--hold-min', 'soon']]) { r = await refRound('plain', 'n2', bad); check(`hold: ${bad.join(' ')} is a usage error (exit 125)`, r.status === 125 && /at least 2000/.test(r.stderr), r.stderr); }
r = await gate(['--help']);
// ── The header contract at the prototype stage: the first comparison belongs here (chrome-compare.mjs --status) ──
{
  const DIFF_SCRIPTS = join(scripts, '..', '..', 'diff', 'scripts');
  for (const f of ['chrome-compare.mjs', 'chrome-explore.mjs']) cpSync(join(DIFF_SCRIPTS, f), join(diff, f));
  const chromeDir = join(root, 'stardust/chrome'); mkdirSync(chromeDir, { recursive: true });
  const contractFile = join(chromeDir, 'header-contract.json');
  const ledger = (rounds, decisions = []) => writeFileSync(join(chromeDir, 'rounds.json'), JSON.stringify({ version: 1, stages: { prototype: { rounds: rounds.map((verdict, i) => ({ label: `compare-${i + 1}`, at: `2026-11-20T10:0${i}:00Z`, verdict, kind: i ? 'fix' : 'first' })), decisions } } }));
  const hc = (label, env = {}, slug = 'hc', extra = []) => gate([slug, `https://live.example/${slug}`, buildUrl, '1440', label, '--marker', 'home-proposed', '--full', ...extra], env);
  const probe = (slug, label) => ((verdictJson(slug, label) || {}).probes || {})['header-contract'];
  r = await hc('n0');
  check('header contract: no contract file → nothing printed, nothing failed', r.status === 0 && !/header contract/.test(r.stdout) && !probe('hc', 'n0') && !existsSync(join(root, gdir('hc'), 'header-contract-n0.txt')), `status ${r.status} ${r.stdout}`);
  // never recorded: a replica project (state.json flow) asks on every page's round; any other project is not asked
  const stateFile = join(root, 'stardust/state.json');
  const notRecorded = (slug) => new RegExp(`^header contract: NOT RECORDED — node stardust/scripts/diff/chrome-explore\\.mjs "https://live\\.example/${slug}" stardust/chrome/header-contract\\.json$`, 'm');
  writeFileSync(stateFile, JSON.stringify({ flow: 'replica', pages: [] }, null, 2));
  r = await hc('nr1');
  check('header contract: no contract in a replica project → the NOT RECORDED line with the explore command for this page\'s source, a failed probe (exit 2) on a pixel pass', r.status === 2 && notRecorded('hc').test(r.stdout) && (probe('hc', 'nr1') || {}).rc === 2 && (roundsOf('hc').find((x) => x.label === 'nr1') || {}).verdict === 'fail', `status ${r.status} ${r.stdout} ${r.stderr}`);
  r = await hc('nr2', {}, 'hcother');
  check('header contract: … on every page\'s round until one is recorded', r.status === 2 && notRecorded('hcother').test(r.stdout), `status ${r.status} ${r.stdout}`);
  r = await hc('nr3', { STUB_PIXEL_RC: '2' });
  check('header contract: NOT RECORDED is printed on a pixel FAIL too; the pixel verdict is the exit', r.status === 2 && notRecorded('hc').test(r.stdout), `status ${r.status} ${r.stdout}`);
  r = await hc('nr4', { GATE_REGIME: 'published' });
  check('header contract: NOT RECORDED is not asked at the published stage', r.status === 0 && !/header contract/.test(r.stdout), `status ${r.status} ${r.stdout}`);
  writeFileSync(stateFile, JSON.stringify({ flow: 'reskin' }));
  r = await hc('nr5');
  check('header contract: no contract in a project of another flow → nothing printed, nothing failed', r.status === 0 && !/header contract/.test(r.stdout) && !probe('hc', 'nr5'), `status ${r.status} ${r.stdout}`);
  writeFileSync(stateFile, JSON.stringify({ flow: 'replica' }));
  writeFileSync(contractFile, JSON.stringify({ url: 'http://live.example/hc/index.html', widths: { 1440: {}, 390: {} } }));
  r = await hc('n1');
  check('header contract: recorded on this page and never compared at the prototype stage → the NOT COMPARED verdict line with the two commands, a failed probe (exit 2) on a pixel pass',
    r.status === 2 && new RegExp(`^header contract: NOT COMPARED at this stage — node stardust/scripts/diff/chrome-explore\\.mjs "${buildUrl}" stardust/chrome/header-build\\.json --width 390,1440 --max-requests 0 --pace-ms 0 --reload-pause-ms 0 && node stardust/scripts/diff/chrome-compare\\.mjs stardust/chrome/header-contract\\.json stardust/chrome/header-build\\.json --profile replica --json stardust/chrome/header-parity\\.json$`, 'm').test(r.stdout), `status ${r.status} ${r.stdout} ${r.stderr}`);
  check('… every other probe ran and passed, the verdict file records the probe and its evidence, and the round is a FAIL in the page\'s ledger', /^content-diff: none/m.test(r.stdout) && /^chrome-parity: ✓/m.test(r.stdout) && (probe('hc', 'n1') || {}).rc === 2 && /header-contract-n1\.txt$/.test((probe('hc', 'n1') || {}).evidence || '') && / stardust\/replica\/gates\/hc-1440\/header-contract-n1\.txt /.test(r.stdout.split('\n').find((l) => l.startsWith('evidence: ')) || '') && (roundsOf('hc').find((x) => x.label === 'n1') || {}).verdict === 'fail', JSON.stringify(verdictJson('hc', 'n1')));
  check('… the status question writes no ledger', !existsSync(join(chromeDir, 'rounds.json')));
  r = await hc('n2', { STUB_PIXEL_RC: '2' });
  check('header contract: on a pixel FAIL the line is still printed; the pixel verdict is the exit', r.status === 2 && /^header contract: NOT COMPARED at this stage — /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  r = await hc('o1', {}, 'hcother');
  check('header contract: a page the contract was not recorded on → nothing printed, nothing failed, no evidence file', r.status === 0 && !/header contract/.test(r.stdout) && !probe('hcother', 'o1') && !existsSync(join(root, gdir('hcother'), 'header-contract-o1.txt')), `status ${r.status} ${r.stdout}`);
  r = await gate(['hc', 'https://live.example/hc', `${base}/hc`, '1440', 'lb1', '--marker', 'home-proposed', '--full'], { GATE_REGIME: '' });
  check('header contract: not asked at the local-build stage', r.status === 0 && !/header contract/.test(r.stdout), `status ${r.status} ${r.stdout}`);
  r = await hc('p1', { GATE_REGIME: 'published' });
  check('header contract: not asked at the published stage', r.status === 0 && !/header contract/.test(r.stdout), `status ${r.status} ${r.stdout}`);
  ledger(['fail']);
  r = await hc('f1');
  check('header contract: a failing comparison inside its cap → FAIL at this stage, a failed probe', r.status === 2 && /^header contract: FAIL at this stage — 1 counted round of 3, the last one a FAIL: fix the header, then node /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  ledger(['fail', 'pass']);
  r = await hc('ok1');
  check('header contract: a passing comparison recorded for the stage → PASS, the round passes', r.status === 0 && /^header contract: PASS at this stage \(2 counted rounds\)$/m.test(r.stdout) && (probe('hc', 'ok1') || {}).rc === 0, `status ${r.status} ${r.stdout}`);
  ledger(['fail', 'fail', 'fail']);
  r = await hc('c0');
  check('header contract: at its cap with no class recorded → still FAIL, naming the decisions file', r.status === 2 && /^header contract: FAIL at this stage — 3 counted rounds of 3, the last one a FAIL: record a class per remaining error in stardust\/chrome\/header-decisions\.json /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  ledger(['fail', 'fail', 'fail'], [{ decision: 'accept-residual', reason: '12 header-contract error(s) classed (12 accept-residual) in stardust/chrome/header-decisions.json', at: '2026-11-20T10:05:00Z', counted: 3 }]);
  const open = [{ key: 'motion@390 Menu [click]', id: 'motion', width: 390, path: 'Menu', action: 'click', severity: 'error' }, { key: 'keyboard@1440 Shop', id: 'keyboard', width: 1440, path: 'Shop', severity: 'error' }];
  writeFileSync(join(chromeDir, 'header-parity.json'), JSON.stringify({ stage: 'prototype', findings: open }));
  r = await hc('c0b');
  check('header contract: a closing decision in the ledger without a class per remaining error (a hand-made accept-residual) is not a cap → FAIL', r.status === 2 && /^header contract: FAIL at this stage — closed in the ledger by accept-residual, but 2 of 2 error\(s\) have no class: record a class per remaining error in stardust\/chrome\/header-decisions\.json /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  writeFileSync(join(chromeDir, 'header-decisions.json'), JSON.stringify({ decisions: open.map((f) => ({ finding: f.key, class: 'accept-residual', reason: 'the prototype carries no behaviour script' })) }));
  r = await hc('c1');
  check('header contract: a capped comparison (three rounds, then a class per error) → CAPPED, the round passes: a prototype without the behaviour is not stuck', r.status === 0 && /^header contract: CAPPED at this stage — 3 counted rounds, closed by accept-residual: 12 header-contract error\(s\) classed /m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  writeFileSync(join(chromeDir, 'rounds.json'), '{ "version": 1, ');
  r = await hc('e1');
  check('header contract: a ledger that cannot be read is no verdict (exit 1), never "compared"', r.status === 1 && /^header contract: ERROR \(exit 1\) — chrome-compare: .*rounds\.json is not a readable round ledger/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  rmSync(join(chromeDir, 'rounds.json'));
  writeFileSync(join(diff, 'chrome-compare.mjs'), '#!/usr/bin/env node\nconsole.error("usage: chrome-compare.mjs <source.json> <build.json>"); process.exit(1);\n');
  r = await hc('e2');
  check('header contract: a chrome-compare.mjs copy without --status is no verdict (exit 1), with the re-copy instruction', r.status === 1 && /^header contract: ERROR \(exit 1\) — usage: chrome-compare\.mjs .* re-copy the diff scripts dir$/m.test(r.stdout), `status ${r.status} ${r.stdout}`);
  rmSync(chromeDir, { recursive: true, force: true }); rmSync(stateFile);
  r = await gate(['--help']);
  check('--help documents the header contract probe and its lines', /^Header contract \(--full, the prototype stage/m.test(r.stdout) && /header contract: NOT COMPARED at this stage — /.test(r.stdout) && /CAPPED at this stage/.test(r.stdout) && /header contract: NOT RECORDED — /.test(r.stdout));
}
check('--help names the default hold, --no-hold-timers, --hold-min, --hold-timers, GATE_HOLD_TIMERS and the precedence', r.status === 0 && /Timer hold — ON by default at 2000 ms/.test(r.stdout) && /--no-hold-timers /.test(r.stdout) && /--hold-timers /.test(r.stdout) && /--hold-min <ms>/.test(r.stdout)
  && /Precedence: a flag wins over GATE_HOLD_TIMERS \(0 = off, 1 = 2000, a number = that threshold\)/.test(r.stdout) && /GATE_HOLD_TIMERS=0/.test(r.stdout), r.stdout.slice(0, 200));
unlinkSync(join(replica, 'rounds.mjs'));

server.close();
if (process.env.GATE_TEST_KEEP) console.log(`sandbox kept at ${root} (build url was ${buildUrl})`);
else rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

