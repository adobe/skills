#!/usr/bin/env node
// gate.sh contract test: argument parsing, --help, the --full probe fan-out and its exit-code rules, with
// stub instruments (no browser, no network). Run: node skills/replica/scripts/test/gate.test.mjs
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

// Stubs read their behaviour from environment variables so one sandbox covers every case.
const stub = (dir, name, body) => writeFileSync(join(dir, name), `#!/usr/bin/env node\n${body}\n`);
stub(replica, 'stitch-shot.mjs', `
  import { writeFileSync } from 'node:fs';
  const out = process.argv[3]; writeFileSync(out, 'png'); console.log('stitched ' + out);`);
stub(replica, 'pixel-compare.mjs', `
  console.log('height delta 0px'); console.log('differing 1.20%');
  process.exit(Number(process.env.STUB_PIXEL_RC || 0));`);
stub(replica, 'chrome-parity.mjs', `
  if (process.env.STUB_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP)));
  const deltas = Number(process.env.STUB_CHROME_DELTAS || 0);
  console.log('chrome-parity @ 1440px'); console.log(deltas ? '✗ ' + deltas + ' delta(s) — fix these' : '✓ chrome parity');
  process.exit(deltas ? 2 : 0);`);
stub(diff, 'content-diff.mjs', `
  if (process.env.STUB_CD_RC) { console.error('content-diff error: build side answered HTTP 502'); process.exit(Number(process.env.STUB_CD_RC)); }
  const s = Number(process.env.STUB_STRUCTURAL || 0);
  console.log('  live: 12 headings'); console.log('Findings: ' + (s ? (s + 2) + ' (' + s + ' structural 🔴)' : 'none — content + roles match'));`);
stub(diff, 'visual-diff.mjs', `
  console.log('Visual diff @ 1440px'); console.log('build red flags (advisory): ');
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

// Plain pixel round (no --full): verdict lines, evidence, exit = pixel rc.
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter1']);
check('pixel round exits 0 on pass', r.status === 0, r.stderr.slice(0, 200));
check('pixel round prints the verdict lines', /height delta/.test(r.stdout) && /differing/.test(r.stdout));
check('live capture is written once and reused', existsSync(join(root, 'stardust/replica/gates/home-1440/live.png')));
check('no probe evidence without --full', !existsSync(join(root, 'stardust/replica/gates/home-1440/content-diff-iter1.txt')));

// Unknown flag
r = await gate(['home', 'https://live.example/', buildUrl, '1440', '--bogus']);
check('unknown flag exits 125', r.status === 125);

// --full, everything green
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter2', '--full']);
check('--full exits 0 when every probe passes', r.status === 0, `status ${r.status} ${r.stderr.slice(0, 600)}`);
check('--full prints one content-diff verdict', /^content-diff: none — content \+ roles match/m.test(r.stdout), r.stdout);
check('--full prints the visual flag count and heads', /^visual-diff: 2 advisory flag\(s\) — HEADING COLOR: h2 differs; IMAGE DIMS: hero;/m.test(r.stdout), r.stdout);
check('--full prints the chrome-parity summary', /^chrome-parity: ✓ chrome parity/m.test(r.stdout), r.stdout);
check('--full writes the probe evidence files', ['content-diff-iter2.txt', 'visual-diff-iter2.txt', 'chrome-parity-iter2.txt'].every((f) => existsSync(join(root, 'stardust/replica/gates/home-1440', f))));
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

// --main / --no-dismiss reach the probes (recorded by the stub through its argv → evidence file)
stub(diff, 'content-diff.mjs', `console.log('argv ' + process.argv.slice(2).join(' ')); console.log('Findings: none — content + roles match');`);
r = await gate(['home', 'https://live.example/', buildUrl, '1440', 'iter7', '--full', '--main', '#content', '--no-dismiss']);
const cdPath = join(root, 'stardust/replica/gates/home-1440/content-diff-iter7.txt');
const cd = existsSync(cdPath) ? readFileSync(cdPath, 'utf8') : `(missing ${cdPath}; stderr: ${r.stderr.slice(0, 300)})`;
check('--main is passed to the diff probes', /--main #content/.test(cd), cd);
check('--no-dismiss drops the dismiss flag', !/--dismiss/.test(cd), cd);

server.close();
if (process.env.GATE_TEST_KEEP) console.log(`sandbox kept at ${root} (build url was ${buildUrl})`);
else rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
