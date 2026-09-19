#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs delivery-side repairs (T27.2), against mock-da.mjs.
 * Run: node skills/deploy/scripts/test/deploy-batch-repairs.test.mjs   (exit 1 on failure)
 *
 *   - about:error then clean → exactly 2 preview POSTs, `previewed`, repaired: 're-preview';
 *   - persisting about:error → verify-fail "about:error (persists after re-preview)", 2 POSTs;
 *   - thin body (< 200 B / no <main>) → body-invalid, zero requests for that page; --allow-thin PUTs;
 *   - 700 B over a 15 KB DA document → overwrite-guard, no PUT; --allow-shrink PUTs;
 *   - delivered GET 503 then 200 → one retry, `previewed`; a 404 is not retried;
 *   - branch ≠ main: the shrink-guard GET is the two-clocks probe (no HEAD), WARN printed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const page = (t, n = 12) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(n)}</p></div></main><footer></footer></body>\n`;

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-repairs-'));
const content = join(dir, 'content');
mkdirSync(content, { recursive: true });
const ledgerPath = join(content, '.deploy-ledger.json');
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));
const readLog = () => readFileSync(join(content, '.deploy-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const mock = await startMock();
const run = (extra, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, '--org', 'o', '--repo', 'r', '--content', content, ...extra], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', DEPLOY_BATCH_REPAIR_DELAY_MS: '20', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 30000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const fresh = () => { rmSync(ledgerPath, { force: true }); rmSync(join(content, '.deploy-log.jsonl'), { force: true }); mock.reset(); for (const k of Object.keys(mock.source)) delete mock.source[k]; };
const previews = (p) => mock.requests.filter((q) => q.url === `/admin/preview/o/r/main${p}`).length;

try {
  // 1. about:error once, then clean → repaired
  fresh();
  writeFileSync(join(content, 'a.html'), page('A'));
  mock.rules.delivered = (tld, p, n) => ({ status: 200, body: n === 1 ? '<main><img src="about:error"></main>' : '<main><h1>A</h1></main>' });
  let r = await run(['--branch', 'main']);
  assert.equal(r.status, 0, `repaired run exits 0: ${r.stderr}`);
  assert.equal(previews('/a'), 2, 'exactly two preview POSTs');
  let led = readLedger();
  assert.equal(led['/a'].status, 'previewed');
  assert.equal(led['/a'].repaired, 're-preview');
  assert.ok(readLog().some((l) => l.step === 'repreview' && l.ok === true), 'log has a repreview line');

  // 2. persisting about:error → verify-fail with the "persists" why, still only 2 POSTs
  fresh();
  mock.rules.delivered = () => ({ status: 200, body: '<main><img src="about:error"></main>' });
  r = await run(['--branch', 'main']);
  assert.equal(r.status, 1);
  assert.equal(previews('/a'), 2, 'one re-preview only');
  led = readLedger();
  assert.equal(led['/a'].status, 'verify-fail');
  assert.equal(led['/a'].lastError, 'about:error (persists after re-preview)');
  assert.equal(led['/a'].repaired, undefined);

  // 3. thin body → body-invalid, zero requests; --allow-thin PUTs
  fresh();
  mock.rules.delivered = () => ({ status: 200, body: '<main><h1>ok</h1></main>' });
  writeFileSync(join(content, 'a.html'), 'da-sanitise: encoded 3 entities -> content/a.html\n');
  r = await run(['--branch', 'main']);
  assert.equal(r.status, 1);
  assert.equal(mock.requests.filter((q) => !q.url.startsWith('/list/')).length, 0, 'no request for an invalid body (only the preflight smoke)');
  led = readLedger();
  assert.equal(led['/a'].status, 'body-invalid');
  assert.match(led['/a'].lastError, /^body \d+ B \/ no <main>/);
  assert.match(r.stderr, /FAILS[\s\S]*\/a {2}body-invalid/);
  mock.reset();
  r = await run(['--branch', 'main', '--allow-thin']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 1, '--allow-thin PUTs');

  // 4. shrink guard: 15 KB on DA, ~700 B new → overwrite-guard; --allow-shrink PUTs
  fresh();
  mock.source['/a'] = page('RICH', 600); // ~16 KB existing document
  writeFileSync(join(content, 'a.html'), page('STUB', 20)); // ~700 B
  r = await run(['--branch', 'main']);
  assert.equal(r.status, 1);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 0, 'no PUT over a rich page');
  assert.equal(mock.requests.filter((q) => q.method === 'GET' && q.url.startsWith('/da/')).length, 1, 'one DA source GET');
  led = readLedger();
  assert.equal(led['/a'].status, 'overwrite-guard');
  assert.match(led['/a'].lastError, /^existing \d+ B vs new \d+ B \(> 5×\)/);
  mock.reset();
  r = await run(['--branch', 'main', '--allow-shrink']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 1, '--allow-shrink PUTs');
  assert.equal(readLedger()['/a'].status, 'previewed');

  // 5. verify blip: 503 then 200 → one retry and OK; a 404 is a verdict (no retry)
  fresh();
  writeFileSync(join(content, 'a.html'), page('A'));
  mock.rules.delivered = (tld, p, n) => (n === 1 ? { status: 503, body: '' } : { status: 200, body: '<main><h1>A</h1></main>' });
  r = await run(['--branch', 'main']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.requests.filter((q) => q.url.startsWith('/delivery/')).length, 2, 'one retry after the 503');
  fresh();
  mock.rules.delivered = () => ({ status: 404, body: '' });
  r = await run(['--branch', 'main']);
  assert.equal(r.status, 1);
  assert.equal(mock.requests.filter((q) => q.url.startsWith('/delivery/')).length, 1, '404 not retried');
  assert.equal(readLedger()['/a'].lastError, 'plain.html 404');

  // 6. branch ≠ main: the source GET is the two-clocks probe — no HEAD, WARN names the shared count
  fresh();
  mock.rules.delivered = () => ({ status: 200, body: '<main><h1>A</h1></main>' });
  mock.source['/a'] = page('A');
  writeFileSync(join(content, 'b.html'), page('B'));
  r = await run(['--branch', 'feat-x']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.requests.filter((q) => q.method === 'HEAD').length, 0, 'HEAD replaced by the GET');
  assert.match(r.stderr, /WARN two clocks: 1 document\(s\) already on DA are shared with main/);
  led = readLedger();
  assert.equal(led['/a'].sharedWithMain, true);
  assert.equal(led['/b'].sharedWithMain, false);
  console.log('deploy-batch-repairs test: ok');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
