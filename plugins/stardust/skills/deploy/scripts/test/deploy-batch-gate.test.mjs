#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs publish hold (T15.1 — rollout publish-gate.md § Gate 8, the release condition).
 * Run: node skills/deploy/scripts/test/deploy-batch-gate.test.mjs   (exit 1 on failure)
 *
 * Against mock-da.mjs with a gate-publish-shaped report (pass / fail / unmeasured / no entry / published-failing /
 * template not at the bar):
 *   - `--publish --gate-report r.json` goes live ONLY for PASS rows of a template at the bar (POST /live/ for
 *     exactly those; ledger `live`); every other row is `held (gate: <report reason>)`, its ledger row stays
 *     `previewed`, no request names it; the plan line and SUMMARY carry `held=`; the coverage line prints;
 *   - `--publish-ungated` publishes the no-entry row and nothing else that was held;
 *   - `--publish-no-regression` publishes a CHANGED live row whose breakpoints sit within best-of-last-3 + 1
 *     (reason `no-regression: 1440 24.9→23.0`) and still holds the regressing one;
 *   - an unchanged live row that the report calls published-failing is skipped as today (never unpublished)
 *     and counted `published-failing` — hash equal or a hash-less legacy row alike (NEGATIVE: the legacy row was
 *     held with the re-publish reason); a PASS page with no template takes the `untyped` group's bar (NEGATIVE);
 *     hands-off names the default report path, so its absence is exit 2;
 *   - a named `--gate-report` that does not exist → exit 2, zero requests, ledger untouched;
 *   - no report file and no flag → today's behaviour plus one WARN `publishing ungated` line;
 *   - the default path stardust/rollout/gate-report.json is read without a flag;
 *   - `--plan --publish` prints the held reasons offline (no network, ledger byte-identical);
 *   - NEGATIVE: `--force` never lifts a hold (the held row is neither reset nor driven); an escape flag without
 *     `--publish` is a usage error; `/index` folds to the report's `/`;
 *   - `--skip-code-sync-verify <reason>` writes the instrument line to the log and stderr; with
 *     `--require-code-synced` it is refused (exit 2).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startMock } from './mock-da.mjs';
import { gateVerdict, gateEntry, gateCoverageLine, loadGateReport } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const page = (t) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p></div></main><footer></footer></body>\n`;

const bp = (status, pixelPct, heightDelta, exit = 0) => ({ verdict: status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'no-verdict', exit, pixelPct, heightDelta, pass: status === 'pass', status, reason: status === 'fail' ? `pixel ${pixelPct} % (record FAIL)` : status === 'unmeasured' ? `no verdict (exit ${exit})` : null });
const entry = (path, template, status, bps, { wasLive = false, best = null } = {}) => ({ path, slug: path.replace(/^\//, '').replace(/\//g, '__') || 'home', template, wasLive, latest: { at: '2026-09-18T09:40:00Z', pass: status === 'pass', status, breakpoints: bps }, bestOfLast3: best || Object.fromEntries(Object.entries(bps).map(([W, b]) => [W, b.pixelPct])), history: [] });
const report = {
  _provenance: { writtenBy: 'gate-publish.mjs (fixture)' },
  generatedAt: '2026-09-18T09:41:00Z',
  breakpoints: [1440, 360],
  coverage: { delivered: 8, gated: 6, pass: 3, fail: 1, publishedFailing: 2, unmeasured: 1, ungated: 1, blocked: 0 },
  templates: { landing: { pages: 2, pass: 2, fail: 0, unmeasured: 0, ungated: 0, atBar: true }, program: { pages: 3, pass: 1, fail: 1, unmeasured: 0, ungated: 1, atBar: false }, article: { pages: 3, pass: 0, fail: 2, unmeasured: 1, ungated: 0, atBar: false } },
  pages: {
    '/': entry('/', 'landing', 'pass', { 360: bp('pass', 4.2, 2), 1440: bp('pass', 6.9, 0) }),
    '/b': entry('/b', 'landing', 'pass', { 360: bp('pass', 3.8, -1), 1440: bp('pass', 5.1, 0) }),
    '/c': entry('/c', 'program', 'fail', { 360: bp('fail', 12.4, -112), 1440: bp('pass', 7.4, 3) }),
    '/d': entry('/d', 'article', 'unmeasured', { 360: bp('pass', 6.1, 1), 1440: bp('unmeasured', null, null, 124) }),
    // /e has no entry (ungated)
    '/f': entry('/f', 'article', 'published-failing', { 360: bp('pass', 8.8, 4), 1440: bp('fail', 23.0, 41) }, { wasLive: true, best: { 360: 8.8, 1440: 24.9 } }),
    '/g': entry('/g', 'program', 'pass', { 360: bp('pass', 5.0, 1), 1440: bp('pass', 6.0, 0) }), // PASS row of a template not at the bar
    '/h': entry('/h', 'article', 'published-failing', { 360: bp('pass', 8.8, 4), 1440: bp('fail', 26.3, 41) }, { wasLive: true, best: { 360: 8.8, 1440: 24.9 } }),
  },
};

// pure helpers — the verdict table
{
  assert.deepEqual(gateVerdict(report, '/b'), { allow: true });
  assert.deepEqual(gateVerdict(report, '/index'), { allow: true }, '/index folds to the report\'s /');
  assert.equal(gateEntry(report, '/index'), report.pages['/']);
  assert.deepEqual(gateVerdict(report, '/c'), { allow: false, why: '360 FAIL 12.4 % Δh -112' });
  assert.deepEqual(gateVerdict(report, '/d'), { allow: false, why: 'unmeasured — 1440 exit 124' });
  assert.deepEqual(gateVerdict(report, '/e'), { allow: false, why: 'ungated — no published-origin number' });
  assert.deepEqual(gateVerdict(report, '/e', { publishUngated: true }), { allow: true, note: 'ungated — --publish-ungated' });
  assert.deepEqual(gateVerdict(report, '/g'), { allow: false, why: 'template program not at the bar' });
  // NEGATIVE: a PASS page with no template takes the report's `untyped` group bar (was: the atBar check skipped when template is null)
  const untyped = { ...report, templates: { ...report.templates, untyped: { pages: 2, pass: 1, fail: 1, unmeasured: 0, ungated: 0, atBar: false } }, pages: { ...report.pages, '/u': entry('/u', null, 'pass', { 360: bp('pass', 2.0, 0), 1440: bp('pass', 3.0, 0) }) } };
  assert.deepEqual(gateVerdict(untyped, '/u'), { allow: false, why: 'template untyped not at the bar' });
  assert.deepEqual(gateVerdict({ ...untyped, templates: { ...untyped.templates, untyped: { ...untyped.templates.untyped, atBar: true } } }, '/u'), { allow: true }, 'untyped at the bar publishes');
  assert.equal(gateVerdict(report, '/f', { wasLive: true }).allow, false, 'a changed live FAIL row is held without the flag');
  assert.deepEqual(gateVerdict(report, '/f', { wasLive: true, publishNoRegression: true }), { allow: true, note: 'no-regression: 360 8.8→8.8 1440 24.9→23' });
  assert.match(gateVerdict(report, '/h', { wasLive: true, publishNoRegression: true }).why, /regressed past best-of-last-3 \+ 1/);
  assert.equal(gateVerdict(report, '/c', { publishNoRegression: true }).allow, false, 'no-regression applies to live rows only');
  assert.equal(gateVerdict(report, '/d', { publishUngated: true, publishNoRegression: true }).allow, false, 'no flag publishes an unmeasured row');
  assert.equal(gateCoverageLine(report, 5), 'published-gated 6 of 8 · PASS 3 · FAIL 1 · unmeasured 1 · ungated 1 · published-failing 2 · held 5');
  assert.equal(loadGateReport(join(tmpdir(), 'no-such-gate-report.json'), false), null, 'the default path may be absent');
  assert.throws(() => loadGateReport(join(tmpdir(), 'no-such-gate-report.json'), true), /--gate-report .* not found/);
}

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-gate-'));
const content = join(dir, 'content');
mkdirSync(content, { recursive: true });
const ledgerPath = join(content, '.deploy-ledger.json');
const logPath = join(content, '.deploy-log.jsonl');
const reportPath = join(dir, 'gate-report.json');
writeFileSync(reportPath, JSON.stringify(report));
const files = { index: 'Home', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H' };
for (const [n, t] of Object.entries(files)) writeFileSync(join(content, `${n}.html`), page(t));
const row = (status, hash) => ({ status, attempts: 1, ts: '2026-09-18T09:05:00Z', put: 201, preview: 200, bodyHash: hash, branch: 'main' });
const seed = () => {
  const led = {};
  for (const [n, t] of Object.entries(files)) led[`/${n}`] = row('previewed', sha1(page(t)));
  led['/f'] = { ...row('live', 'stale-f'), live: 200 }; // changed live row → a re-publish
  led['/h'] = { ...row('live', 'stale-h'), live: 200 };
  writeFileSync(ledgerPath, JSON.stringify(led, null, 2));
  rmSync(logPath, { force: true });
};
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));
const mock = await startMock();
const base = ['--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--concurrency', '1', '--no-progress'];
const run = (extra, env = {}) => new Promise((resolve) => {
  mock.reset();
  const c = spawn(process.execPath, [CLI, ...base, ...extra], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 60000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, out: stdout + stderr, last: stdout.trim().split('\n').at(-1) }); });
});
const lives = () => mock.requests.filter((q) => q.method === 'POST' && q.url.startsWith('/admin/live/')).map((q) => q.url.replace(/^\/admin\/live\/o\/r\/main/, '')).sort();
const named = (p) => mock.requests.filter((q) => decodeURI(q.url).includes(`${p}.`) || decodeURI(q.url).endsWith(p)).length;

try {
  // 1. the hold: PASS rows of a template at the bar go live, everything else is held
  seed();
  let r = await run(['--publish', '--gate-report', reportPath]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(lives(), ['/b', '/index'], `POST /live/ only for the PASS rows: ${lives()}`);
  let led = readLedger();
  assert.equal(led['/index'].status, 'live'); assert.equal(led['/b'].status, 'live');
  for (const p of ['/c', '/d', '/e', '/g']) assert.equal(led[p].status, 'previewed', `${p} stays previewed`);
  for (const p of ['/f', '/h']) assert.equal(led[p].status, 'live', `${p} keeps its live row (held re-publish, never unpublished)`);
  for (const p of ['/c', '/d', '/e', '/f', '/g', '/h']) assert.equal(named(p), 0, `no request names the held ${p}`);
  assert.match(r.stderr, /gate-report .*gate-report\.json \(2026-09-18T09:41:00Z\) — rows without a PASS at every breakpoint are held/);
  assert.match(r.stderr, /published-gated 6 of 8 · PASS 3 · FAIL 1 · unmeasured 1 · ungated 1 · published-failing 2 · held 6/);
  assert.match(r.stderr, /held {4}\/c {2}held \(gate: 360 FAIL 12\.4 % Δh -112\)/);
  assert.match(r.stderr, /held {4}\/d {2}held \(gate: unmeasured — 1440 exit 124\)/);
  assert.match(r.stderr, /held {4}\/e {2}held \(gate: ungated — no published-origin number\)/);
  assert.match(r.stderr, /held {4}\/f {2}held \(gate: 1440 FAIL 23 % Δh 41 — published-failing; a re-publish takes --publish-no-regression \(owner\)\)/);
  assert.match(r.stderr, /held {4}\/g {2}held \(gate: template program not at the bar\)/);
  assert.match(r.stderr, /· 6 held \(gate\) · /, 'plan line counts the held rows');
  assert.equal(r.last, `SUMMARY deploy-batch ok=2 failed=0 exit=0 details=${ledgerPath} skipped=0 published=2 held=6`);
  assert.ok(!/FAIL \//.test(r.stderr), 'a held row is not a page failure');

  // 2. --publish-ungated: the no-entry row publishes, the rest stay held
  seed();
  r = await run(['--publish', '--gate-report', reportPath, '--publish-ungated']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(lives(), ['/b', '/e', '/index']);
  assert.match(r.stderr, /previewed \(publish fast path\) \(gate: ungated — --publish-ungated\)/);
  assert.match(r.last, / published=3 held=5$/);

  // 3. --publish-no-regression: the changed live row within best-of-last-3 + 1 re-publishes; the regressing one is held
  seed();
  r = await run(['--publish', '--gate-report', reportPath, '--publish-no-regression']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(lives(), ['/b', '/f', '/index']);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').map((q) => q.url).join(), '/da/o/r/f.html', 'the changed live row is PUT again');
  assert.match(r.stderr, /changed \(gate: no-regression: 360 8\.8→8\.8 1440 24\.9→23\)/);
  assert.match(r.stderr, /held {4}\/h {2}held \(gate: 1440 FAIL 26\.3 % Δh 41 — regressed past best-of-last-3 \+ 1/);
  assert.equal(readLedger()['/h'].status, 'live');

  // 4. an UNCHANGED live row the report calls published-failing is skipped as today and counted, never unpublished
  seed();
  led = readLedger(); led['/f'].bodyHash = sha1(page('F')); writeFileSync(ledgerPath, JSON.stringify(led));
  r = await run(['--publish', '--gate-report', reportPath]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stderr, /· 1 published-failing/);
  assert.match(r.stderr, /· 5 held \(gate\)/);
  assert.equal(readLedger()['/f'].status, 'live');
  assert.equal(named('/f'), 1, 'one delivered GET (the unchanged-row verify), no POST');

  // 4b. NEGATIVE: an unchanged live row from a hash-less (legacy) ledger is skipped as today — not held with the
  //     published-failing re-publish reason (was: `liveUnchanged` required bodyHash, so the row went through the hold)
  seed();
  led = readLedger(); delete led['/f'].bodyHash; writeFileSync(ledgerPath, JSON.stringify(led));
  r = await run(['--plan', '--publish', '--gate-report', reportPath]);
  assert.match(r.stdout, /skip {4}\/f {2}unchanged \(no hash — a live run verifies the delivered page first\) · published-failing \(gate: 1440 FAIL 23 % Δh 41\)/, 'the plan says so offline');
  r = await run(['--publish', '--gate-report', reportPath]);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.stderr, /\/f {2}held \(gate:/, 'a hash-less unchanged live row is not held');
  assert.match(r.stderr, /· 1 published-failing/); assert.match(r.stderr, /· 5 held \(gate\)/);
  assert.equal(readLedger()['/f'].status, 'live'); assert.equal(readLedger()['/f'].bodyHash, sha1(page('F')), 'the live run backfills the hash');
  assert.ok(!lives().includes('/f'), 'never re-published');

  // 5. a named report that does not exist is fatal — exit 2, nothing read or written
  seed();
  const before = readFileSync(ledgerPath, 'utf8');
  r = await run(['--publish', '--gate-report', join(dir, 'missing.json')]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.stderr, /fatal: --gate-report .*missing\.json not found — run gate-publish\.mjs --report first/);
  assert.equal(mock.requests.length, 0, 'zero requests');
  assert.equal(readFileSync(ledgerPath, 'utf8'), before, 'ledger untouched');
  // the hands-off form names the default path: an absent report is then exit 2, never an ungated publish
  r = await run(['--publish', '--gate-report', 'stardust/rollout/gate-report.json']);
  assert.equal(r.status, 2, r.out); assert.equal(lives().length, 0, 'nothing published');

  // 6. no report and no flag: today's behaviour with the WARN line (every previewed row goes live)
  seed();
  r = await run(['--publish']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stderr, /WARN no gate report at stardust\/rollout\/gate-report\.json — publishing ungated/);
  assert.equal(lives().length, 8, 'all eight rows published (6 fast path + 2 changed live)');
  assert.ok(!/held=/.test(r.last), 'no held= without a report');

  // 7. the default path is read without a flag
  seed();
  mkdirSync(join(dir, 'stardust', 'rollout'), { recursive: true });
  writeFileSync(join(dir, 'stardust', 'rollout', 'gate-report.json'), JSON.stringify(report));
  r = await run(['--publish']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(lives(), ['/b', '/index']);
  assert.match(r.last, / held=6$/);

  // 8. --plan --publish: offline — the held reasons print, nothing is written, no request
  seed();
  const ledgerBytes = readFileSync(ledgerPath, 'utf8');
  r = await run(['--plan', '--publish'], { DA_TOKEN: '' });
  assert.equal(r.status, 0, r.out);
  assert.equal(mock.requests.length, 0);
  assert.equal(readFileSync(ledgerPath, 'utf8'), ledgerBytes, 'a plan run writes no ledger row');
  assert.match(r.stdout, /skip {4}\/c {2}held \(gate: 360 FAIL 12\.4 % Δh -112\)/);
  assert.match(r.stdout, /skip {4}\/g {2}held \(gate: template program not at the bar\)/);
  assert.match(r.stdout, /drive {3}\/index {2}previewed \(publish fast path\)/);
  assert.match(r.stdout, /\[deploy-batch\] published-gated 6 of 8 .* · held 6/);
  assert.match(r.last, /^SUMMARY deploy-batch ok=0 failed=0 exit=0 details=.* mode=plan toDrive=2 held=6$/);

  // 9. NEGATIVE — --force never lifts a hold: the held row is neither reset to pending nor driven
  seed();
  r = await run(['--publish', '--force', '--paths', '/c,/b']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(lives(), ['/b']);
  assert.equal(readLedger()['/c'].status, 'previewed', 'held row keeps its status under --force');
  assert.equal(named('/c'), 0);
  assert.match(r.stderr, /held {4}\/c {2}held \(gate:/);

  // 10. escape flags without --publish are a usage error (they act on rows that would go live)
  for (const flag of ['--publish-ungated', '--publish-no-regression', ['--gate-report', reportPath]]) {
    r = await run([].concat(flag));
    assert.equal(r.status, 2, `${flag} without --publish → exit 2: ${r.out}`);
    assert.match(r.stderr, /apply to a --publish run only/);
  }
  rmSync(join(dir, 'stardust'), { recursive: true, force: true });

  // 11. --skip-code-sync-verify <reason>: the instrument line lands in the log and on stderr; exclusive with --require-code-synced
  seed();
  r = await run(['--skip-code-sync-verify', 'code unchanged since the verified record 3f2a1c0', '--paths', '/b']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stderr, /\[deploy-batch\] instrument: code-sync-verify skipped — code unchanged since the verified record 3f2a1c0/);
  const inst = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((o) => o.step === 'instrument');
  assert.deepEqual([inst.instrument, inst.skipped], ['code-sync-verify', 'code unchanged since the verified record 3f2a1c0']);
  r = await run(['--skip-code-sync-verify', 'x', '--require-code-synced', '--paths', '/b']);
  assert.equal(r.status, 2); assert.match(r.stderr, /exclusive/);
  r = await run(['--skip-code-sync-verify', '--paths', '/b']);
  assert.equal(r.status, 2, 'the reason is required'); assert.match(r.stderr, /--skip-code-sync-verify needs a value/);
  assert.ok(!existsSync(join(dir, 'stardust')), 'no stray writes');

  console.log('deploy-batch-gate test: ok (hold on FAIL / unmeasured / ungated / not-at-bar / changed live, --publish-ungated, --publish-no-regression, published-failing kept, named report missing → 2, WARN without report, default path, --plan offline, --force never lifts a hold, flags need --publish, --skip-code-sync-verify line)');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
