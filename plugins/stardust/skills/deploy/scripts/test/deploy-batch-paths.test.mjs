#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs path-safety stage (T27.3 — rollout Gate 3 enforced before the PUT).
 * Run: node skills/deploy/scripts/test/deploy-batch-paths.test.mjs   (exit 1 on failure)
 *
 * Against the in-process mock (mock-da.mjs):
 *   - a file whose webPath is not delivery-safe is PUT / previewed / verified at normalizeDaPath(webPath);
 *     the ledger row stays keyed on the file-derived webPath and records `deployedPath`;
 *   - one `webPath<TAB>safe` row lands in --redirects-tsv once the page delivers; a second run appends
 *     no duplicate and re-PUTs nothing (hash-equal, verified at the safe path);
 *   - two files folding to one safe path: the first (webPath order) is driven, the other is
 *     `path-collision` with no request to DA for it; a non-Latin file name is `path-unsafe`;
 *   - `--strict-paths`: a divergent page is `path-unsafe`, no PUT; `--plan` prints the path line
 *     and the per-row notes with no network; both statuses are non-ok → exit 1 and listed under FAILS.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';
import { annotateSafePaths } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const page = (t) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p></div></main><footer></footer></body>\n`;

// pure helper: first claimant (webPath order) wins, null = no safe form
{
  const pages = [{ webPath: '/dup/a-b' }, { webPath: '/dup/a_b' }, { webPath: '/ok' }, { webPath: '/x/Ü' }, { webPath: '/日本語' }];
  const c = annotateSafePaths(pages);
  assert.deepEqual(c, { normalised: 1, collisions: 1, unsafe: 1 });
  assert.deepEqual(pages.map((p) => [p.safePath, p.collision]), [['/dup/a-b', null], ['/dup/a-b', '/dup/a-b'], ['/ok', null], ['/x/u', null], [null, null]]);
}

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-paths-'));
const content = join(dir, 'content');
mkdirSync(join(content, 'sub'), { recursive: true });
mkdirSync(join(content, 'dup'), { recursive: true });
writeFileSync(join(content, 'ok.html'), page('OK'));
writeFileSync(join(content, 'sub', 'Getting_Started.html'), page('GS'));
writeFileSync(join(content, 'dup', 'a-b.html'), page('AB1'));
writeFileSync(join(content, 'dup', 'a_b.html'), page('AB2'));
writeFileSync(join(content, '日本語.html'), page('JP'));
const ledgerPath = join(content, '.deploy-ledger.json');
const tsv = join(dir, 'stardust', 'redirects.tsv');
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));

const mock = await startMock();
const base = ['--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--no-progress', '--redirects-tsv', tsv];
const run = (extra, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...base, ...extra], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 30000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const puts = () => mock.requests.filter((q) => q.method === 'PUT').map((q) => decodeURI(q.url));

try {
  // --plan: the path line and per-row notes, no network
  let r = await run(['--plan'], { DA_TOKEN: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[deploy-batch\] paths: 1 normalised \(rows → .*redirects\.tsv\) · 1 collision\(s\) · 1 with no safe form/);
  assert.match(r.stdout, /drive {3}\/sub\/Getting_Started {2}new {2}\[→ \/sub\/getting-started\]/);
  assert.match(r.stdout, /drive {3}\/dup\/a_b {2}new {2}\[path-collision with \/dup\/a-b → \/dup\/a-b\]/);
  assert.match(r.stdout, /drive {3}\/日本語 {2}new {2}\[path-unsafe: no safe form\]/);
  assert.equal(mock.requests.length, 0, '--plan makes no request');
  assert.ok(!existsSync(tsv), '--plan writes no redirect row');

  // live run: driven at the safe path, ledger keyed on webPath + deployedPath, one TSV row, collision + unsafe parked offline
  mock.reset();
  r = await run([]);
  assert.equal(r.status, 1, `collision + unsafe → exit 1: ${r.stderr}`);
  const p1 = puts();
  assert.deepEqual(p1.sort(), ['/da/o/r/dup/a-b.html', '/da/o/r/ok.html', '/da/o/r/sub/getting-started.html'], `PUTs go to safe paths only: ${p1}`);
  assert.equal(mock.requests.filter((q) => /Getting_Started|a_b|日本語/.test(decodeURI(q.url))).length, 0, 'no request ever names an unsafe path');
  assert.match(r.stderr, /OK {3}\/sub\/Getting_Started \(previewed\) {2}https:\/\/main--r--o\.aem\.page\/sub\/getting-started\n/, 'the OK line shows the delivered (safe) URL');
  assert.match(r.stderr, /FAIL \/dup\/a_b \(path-collision\)/);
  assert.match(r.stderr, /FAIL \/日本語 \(path-unsafe\)/);
  assert.match(r.stderr, /FAILS[\s\S]*\/dup\/a_b {2}path-collision {2}normalises to \/dup\/a-b, already claimed by \/dup\/a-b/);
  assert.match(r.stderr, /\/日本語 {2}path-unsafe {2}no delivery-safe form/);
  assert.match(r.stdout, /^SUMMARY deploy-batch ok=3 failed=2 exit=1 /m);
  let led = readLedger();
  assert.equal(led['/sub/Getting_Started'].status, 'previewed', 'ledger key is the file-derived webPath');
  assert.equal(led['/sub/Getting_Started'].deployedPath, '/sub/getting-started', 'deployedPath recorded when it differs');
  assert.equal(led['/ok'].deployedPath, undefined, 'no deployedPath on an already-safe page');
  assert.equal(led['/dup/a-b'].status, 'previewed', 'first claimant is driven');
  assert.equal(led['/dup/a_b'].status, 'path-collision');
  assert.equal(led['/日本語'].status, 'path-unsafe');
  assert.equal(readFileSync(tsv, 'utf8'), '/sub/Getting_Started\t/sub/getting-started\n', 'one redirect row, source = webPath, destination = safe');

  // second run: hash-equal pages verified at the safe path, nothing re-PUT, no duplicate row
  mock.reset();
  r = await run([]);
  assert.equal(r.status, 1, 'the parked pages are re-driven offline and still fail');
  assert.equal(puts().length, 0, `no re-PUT: ${puts()}`);
  assert.equal(mock.requests.filter((q) => decodeURI(q.url) === '/delivery/aem.page/sub/getting-started.plain.html').length, 1, 'the unchanged page is re-verified at its SAFE path');
  assert.equal(readFileSync(tsv, 'utf8'), '/sub/Getting_Started\t/sub/getting-started\n', 'no duplicate row');

  // --strict-paths on a fresh ledger: the divergent page is path-unsafe, no PUT for it
  rmSync(ledgerPath); rmSync(tsv);
  mock.reset();
  r = await run(['--strict-paths', '--paths', '/sub/Getting_Started,/ok']);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(puts(), ['/da/o/r/ok.html'], 'only the safe page is PUT');
  assert.match(r.stderr, /FAIL \/sub\/Getting_Started \(path-unsafe\)/);
  assert.match(r.stderr, /path differs from its safe form \/sub\/getting-started \(--strict-paths/);
  led = readLedger();
  assert.equal(led['/sub/Getting_Started'].status, 'path-unsafe');
  assert.equal(led['/sub/Getting_Started'].deployedPath, undefined, 'nothing was delivered, no deployedPath');
  assert.ok(!existsSync(tsv), 'no redirect row without a delivery');
  console.log('deploy-batch-paths test: ok (safe-path PUT, deployedPath, redirect row + dedupe, path-collision, path-unsafe, --strict-paths, --plan notes)');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
