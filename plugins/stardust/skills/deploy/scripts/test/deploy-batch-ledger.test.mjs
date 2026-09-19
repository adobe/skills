#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs ledger semantics (T06.1).
 * Run: node skills/deploy/scripts/test/deploy-batch-ledger.test.mjs   (exit 1 on failure)
 *
 * Asserts, offline (`--plan`) and against the in-process mock (mock-da.mjs):
 *   - a changed file re-drives (hash), an unchanged one is skipped, a new one is `new`;
 *   - `--paths` takes a file or a comma list, normalises `//x.html` → `/x`, and
 *     reports a requested path missing from the tree instead of dropping it;
 *   - `--exclude` lists the page and does not drive it;
 *   - `--force --paths` re-drives the selected page and the ledger row count never shrinks;
 *   - a hash-less `live` row is verified-then-skipped and gains `bodyHash`;
 *   - a `--publish` run over a hash-equal `previewed` row takes the fast path (no PUT);
 *   - `--report` and `--help` need no token and exit 0.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startMock } from './mock-da.mjs';
import { normalisePath, mergeLedger } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const page = (t) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p></div></main><footer></footer></body>\n`;

// pure helpers
assert.equal(normalisePath('//a/b.html'), '/a/b');
assert.equal(normalisePath('a'), '/a');
assert.equal(normalisePath('  '), null);
const merged = mergeLedger({ '/x': { status: 'live' }, '/y': { status: 'live' } }, { '/y': { status: 'pending' }, '/z': { status: 'new' } }, new Set(['/y']));
assert.deepEqual(Object.keys(merged).sort(), ['/x', '/y', '/z'], 'merge keeps on-disk rows and adds this run\'s');
assert.equal(merged['/y'].status, 'pending', 'touched row wins');

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-ledger-'));
const content = join(dir, 'content');
mkdirSync(join(content, 'sub'), { recursive: true });
writeFileSync(join(content, 'a.html'), page('A'));
writeFileSync(join(content, 'sub', 'b.html'), page('B'));
writeFileSync(join(content, 'c.html'), page('C'));
const ledgerPath = join(content, '.deploy-ledger.json');
const writeLedger = (o) => writeFileSync(ledgerPath, JSON.stringify(o, null, 2));
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));

const mock = await startMock();
const progressFile = join(dir, 'work', 'deploy-batch.progress.json');
const base = ['--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--progress', progressFile];
// async spawn: the mock server lives in THIS process, so a spawnSync would starve it
const run = (extra, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...base, ...extra], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 30000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});

try {
  // --help / --report: offline, exit 0
  let r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', env: { ...process.env, HOME: dir, DA_TOKEN: '' } });
  assert.equal(r.status, 0, `--help exit 0: ${r.stderr}`);
  assert.match(r.stdout, /usage:/);

  writeLedger({
    '/a': { status: 'live', attempts: 1, bodyHash: sha1(page('A')) },
    '/sub/b': { status: 'live', attempts: 1, bodyHash: 'stale' },
    '/old': { status: 'put-fail', attempts: 2, lastError: 'PUT 500' },
  });
  r = await run(['--report'], { DA_TOKEN: '' });
  assert.equal(r.status, 0, `--report exit 0: ${r.stderr}`);
  assert.match(r.stdout, /ledger: 3 rows/);
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY deploy-batch ok=0 failed=0 exit=0 details=.* mode=report rows=3$/, '--report ends with a SUMMARY line');
  assert.match(r.stdout, /put-fail {2}\/old {2}PUT 500/);

  // --plan: no network, one reason per path
  mock.reset();
  r = await run(['--plan', '--publish'], { DA_TOKEN: '' });
  assert.equal(r.status, 0, `--plan exit 0: ${r.stderr}`);
  assert.match(r.stdout, /3 pages · 1 unchanged \(hash\) · 1 changed · 1 new · 0 failed-last-time · 0 excluded · 2 to drive/);
  assert.match(r.stdout, /skip {4}\/a {2}unchanged \(hash\)/);
  assert.match(r.stdout, /drive {3}\/sub\/b {2}changed/);
  assert.match(r.stdout, /drive {3}\/c {2}new/);
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY deploy-batch ok=0 failed=0 exit=0 details=.* mode=plan toDrive=2$/, '--plan ends with a SUMMARY line');
  assert.equal(mock.requests.length, 0, '--plan makes no request');

  // mutate a → plan says 2 changed
  writeFileSync(join(content, 'a.html'), page('A2'));
  r = await run(['--plan', '--publish'], { DA_TOKEN: '' });
  assert.match(r.stdout, /0 unchanged \(hash\) · 2 changed · 1 new/);
  writeFileSync(join(content, 'a.html'), page('A'));

  // --paths comma list, normalised; missing path reported, not dropped; --exclude
  r = await run(['--plan', '--publish', '--paths', '//sub/b.html,/zzz', '--exclude', 'sub/b']);
  assert.match(r.stdout, /1 pages · 0 unchanged \(hash\) · 0 changed · 0 new · 0 failed-last-time · 1 excluded · 1 not in content tree · 0 to drive/);
  assert.match(r.stdout, /skip {4}\/sub\/b {2}excluded/);
  assert.match(r.stdout, /missing \/zzz {2}not in content tree/);
  const listFile = join(dir, 'paths.txt');
  writeFileSync(listFile, 'c.html\n\n/a\n');
  r = await run(['--plan', '--paths', listFile]);
  assert.match(r.stdout, /2 pages/);
  assert.match(r.stdout, /drive {3}\/c {2}new/);

  // live run (preview-only) against the mock: skip a (verify GET only), drive b + c
  mock.reset();
  r = await run([]);
  assert.equal(r.status, 0, `preview run exit 0: ${r.stderr}`);
  assert.match(r.stderr, /1 unchanged \(hash\) · 1 changed · 1 new/);
  const puts = mock.requests.filter((q) => q.method === 'PUT').map((q) => q.url);
  assert.equal(puts.length, 2, `two PUTs, got ${puts.join(',')}`);
  assert.ok(!puts.some((u) => u.endsWith('/a.html')), 'unchanged page not re-PUT');
  assert.equal(mock.requests.filter((q) => q.url.startsWith('/delivery/aem.page/a.')).length, 1, 'unchanged page verified once on aem.page');
  const lastLine = r.stdout.trim().split('\n').at(-1);
  assert.equal(lastLine, `SUMMARY deploy-batch ok=2 failed=0 exit=0 details=${ledgerPath} skipped=1 published=preview-only`, 'SUMMARY is the last stdout line');
  const prog = JSON.parse(readFileSync(progressFile, 'utf8'));
  assert.deepEqual([prog.driver, prog.total, prog.done, prog.ok, prog.failed, prog.noverdict], ['deploy-batch', 2, 2, 2, 0, 0], 'progress file shape');
  assert.ok(prog.updatedAt && prog.startedAt && prog.lastPath, 'progress timestamps + lastPath');
  let led = readLedger();
  assert.equal(Object.keys(led).length, 4, 'ledger keeps /old and gains nothing spurious');
  assert.equal(led['/sub/b'].status, 'previewed');
  assert.equal(led['/sub/b'].bodyHash, sha1(page('B')), 'hash recorded on PUT');
  assert.equal(led['/sub/b'].branch, 'main');
  assert.equal(led['/c'].status, 'previewed');
  assert.equal(led['/old'].status, 'put-fail', 'row outside the tree untouched');

  // --force --paths: the selected page is re-driven, row count never shrinks
  mock.reset();
  r = await run(['--force', '--paths', '/a']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /1 forced/);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 1, 'forced page PUT once');
  led = readLedger();
  assert.equal(Object.keys(led).length, 4, '--force --paths keeps every other row');
  assert.equal(led['/a'].status, 'previewed');
  assert.equal(led['/sub/b'].status, 'previewed');

  // hash-less live row → verified, skipped, hash backfilled
  led['/c'] = { status: 'previewed', attempts: 1 };
  writeLedger(led);
  mock.reset();
  r = await run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 0, 'nothing to PUT');
  assert.match(r.stderr, /0 to drive/);
  assert.match(r.stderr, /previewed-only — needs --publish/);
  led = readLedger();
  assert.equal(led['/c'].bodyHash, sha1(page('C')), 'hash backfilled on a hash-less skip');

  // --publish over hash-equal previewed rows: fast path (no PUT, POST /live/ + verify on aem.live)
  mock.reset();
  r = await run(['--publish']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /3 previewed→publish/);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 0, 'fast path skips PUT');
  assert.equal(mock.requests.filter((q) => q.url.startsWith('/admin/live/')).length, 3, 'one POST /live/ per page');
  led = readLedger();
  assert.equal(led['/a'].status, 'live');

  // a failing page exits 1 and stays re-drivable; the FAIL is counted for THIS run only
  mock.reset();
  mock.rules.putStatus = (p) => (p === '/c' ? 400 : 201);
  writeFileSync(join(content, 'c.html'), page('C3'));
  r = await run(['--publish']);
  assert.equal(r.status, 1, 'exit 1 on a FAIL');
  assert.match(r.stderr, /done\. 0 ok, 1 failed\./, 'run-scoped count (the stale /old row is not counted)');
  assert.match(r.stdout, /SUMMARY deploy-batch ok=0 failed=1 exit=1 details=.* skipped=2 published=0$/m);
  r = await run(['--no-progress'], { DA_TOKEN: '' });
  assert.equal(r.status, 2, 'missing token is fatal (exit 2)');
  assert.match(r.stdout, /^SUMMARY deploy-batch ok=0 failed=0 exit=2 details=.* error=missing_token/m, 'fatal still prints a SUMMARY line');
  assert.match(r.stderr, /looked in the shell, \.\/\.env, ~\/\.claude\/\.env, ~\/\.env/);
  led = readLedger();
  assert.equal(led['/c'].status, 'put-fail');
  assert.equal(Object.keys(led).length, 4);
  console.log('deploy-batch-ledger test: ok');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
