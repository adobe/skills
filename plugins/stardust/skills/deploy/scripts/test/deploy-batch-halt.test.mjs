#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs token preflight, 401 halt, access-restricted halt, sentinels (T09.3).
 * Run: node skills/deploy/scripts/test/deploy-batch-halt.test.mjs   (exit 1 on failure)
 *
 *   - resolveToken order shell → ./.env → ~/.claude/.env → ~/.env, source class only; tokenExpiry decodes IMS claims;
 *   - preflight: list 401 → exit 2, zero PUTs; expired token → exit 2; token shorter than the projection → exit 2
 *     unless --ignore-ttl; unknown expiry → warn and run;
 *   - PUT 401 after two pages → exit 3, the halted and the never-reached rows keep their previous status,
 *     one `halt` log line, stdout has `next=` and `SUMMARY … exit=3`;
 *   - delivered 401 + x-error access-not-allowed with no site token → exit 3 naming SITE_TOKEN_<REPO>;
 *     with SITE_TOKEN_<REPO> set → `Authorization: token …` on the delivery host only, 401 is a per-page verify-fail;
 *   - ≥ 3 previously delivered pages 404 at startup → warning sentinel, re-driven, no halt;
 *   - verify log rows carry `ms`; a stale lastError is cleared on success.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startMock } from './mock-da.mjs';
import { resolveToken, tokenExpiry, siteTokenNames, medianSecPerPage } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const page = (t) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p></div></main><footer></footer></body>\n`;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const imsToken = (hoursLeft) => `h.${b64u({ created_at: String(Date.now() - 3600_000), expires_in: String(Math.round((1 + hoursLeft) * 3600_000)), client_id: 'x' })}.s`;

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-halt-'));
const content = join(dir, 'content');
mkdirSync(content, { recursive: true });
const ledgerPath = join(content, '.deploy-ledger.json');
const logPath = join(content, '.deploy-log.jsonl');
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));
const readLog = () => readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// pure helpers — HOME isolated so the developer's real ~/.claude/.env is never read
const home = join(dir, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
assert.equal(resolveToken('T_NONE', { cwd: dir, home, env: {} }), null);
assert.deepEqual(resolveToken('T_A', { cwd: dir, home, env: { T_A: ' "shellv" ' } }), { value: 'shellv', source: 'shell' });
writeFileSync(join(dir, '.env'), 'OTHER=1\nexport T_B="repov"\n');
assert.deepEqual(resolveToken('T_B', { cwd: dir, home, env: {} }), { value: 'repov', source: 'repo-env' });
writeFileSync(join(home, '.claude', '.env'), 'T_C=globalv\n');
writeFileSync(join(home, '.env'), 'T_C=homev\nT_D=homev\n');
assert.equal(resolveToken('T_C', { cwd: dir, home, env: {} }).source, 'global-env', '~/.claude/.env before ~/.env');
assert.equal(resolveToken('T_D', { cwd: dir, home, env: {} }).source, 'home-env');
rmSync(join(dir, '.env'));
const t2h = imsToken(2);
assert.ok(Math.abs(tokenExpiry(t2h) - (Date.now() / 1000 + 2 * 3600)) < 5, 'IMS created_at + expires_in (ms) → exp seconds');
assert.equal(tokenExpiry(`a.${b64u({ exp: 1700000000 })}.b`), 1700000000, 'plain exp claim');
assert.equal(tokenExpiry('not-a-jwt'), null);
assert.deepEqual(siteTokenNames('my-repo.v2'), ['SITE_TOKEN_MY_REPO_V2', 'SITE_TOKEN']);
assert.equal(medianSecPerPage(join(dir, 'nope.jsonl')), 6);

const mock = await startMock();
const run = (extra, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, '--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--no-progress', ...extra], { cwd: dir, env: { ...process.env, HOME: home, DA_TOKEN: 'plain', SITE_TOKEN: '', SITE_TOKEN_R: '', DEPLOY_BATCH_REPAIR_DELAY_MS: '20', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 30000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const fresh = () => { rmSync(ledgerPath, { force: true }); rmSync(logPath, { force: true }); mock.reset(); mock.rules.listStatus = () => 200; mock.rules.putStatus = () => 201; mock.rules.delivered = () => ({ status: 200, body: '<main><h1>ok</h1></main>' }); };
const puts = () => mock.requests.filter((q) => q.method === 'PUT').length;

try {
  for (const n of ['a', 'b', 'c']) writeFileSync(join(content, `${n}.html`), page(n));

  // preflight: smoke 401 → exit 2, nothing PUT
  fresh();
  mock.rules.listStatus = () => 401;
  let r = await run([]);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(puts(), 0, 'no PUT after a preflight 401');
  assert.match(r.stderr, /token source=shell valid≈unknown list=401/);
  assert.match(r.stderr, /rejected \(401\) at preflight/);
  assert.match(r.stdout, /SUMMARY deploy-batch ok=0 failed=0 exit=2/);

  // preflight: expired / too short / --ignore-ttl / unknown expiry
  fresh();
  r = await run([], { DA_TOKEN: imsToken(-1) });
  assert.equal(r.status, 2); assert.match(r.stderr, /expired \d+ min ago \(source: shell\)/); assert.equal(puts(), 0);
  fresh();
  r = await run(['--sec-per-page', '3600', '--concurrency', '1'], { DA_TOKEN: imsToken(0.5) });
  assert.equal(r.status, 2, 'projection longer than the token'); assert.match(r.stderr, /3 pages × 3600s ÷ 1/); assert.equal(puts(), 0);
  fresh();
  r = await run(['--sec-per-page', '3600', '--concurrency', '1', '--ignore-ttl'], { DA_TOKEN: imsToken(0.5) });
  assert.equal(r.status, 0, r.stderr); assert.equal(puts(), 3, '--ignore-ttl runs');
  assert.match(r.stderr, /valid≈0\.5h list=200/);
  fresh();
  r = await run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARN token expiry unknown/);
  assert.ok(readLog().filter((l) => l.step === 'verify').every((l) => Number.isFinite(l.ms)), 'verify rows carry ms');

  // token from ./.env (cwd) → source=repo-env
  fresh();
  writeFileSync(join(dir, '.env'), `DA_TOKEN=${imsToken(5)}\n`);
  r = await run([], { DA_TOKEN: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /token source=repo-env valid≈5\.0h/);
  assert.ok(!r.stderr.includes(imsToken(5).slice(2, 20)), 'token value never printed');
  rmSync(join(dir, '.env'));

  // 401 halt mid-batch: seed a previewed row for /c (changed bytes) so its previous status is observable
  fresh();
  writeFileSync(ledgerPath, JSON.stringify({ '/c': { status: 'previewed', attempts: 1, bodyHash: 'old', lastError: 'PUT 401 ' } }));
  let n = 0;
  mock.rules.putStatus = () => { n += 1; return n === 3 ? 401 : 201; };
  r = await run(['--concurrency', '1']);
  assert.equal(r.status, 3, `exit 3 on halt: ${r.stderr}`);
  let led = readLedger();
  const okRows = Object.values(led).filter((x) => x.status === 'previewed').length;
  assert.equal(okRows, 3, 'two pages driven + /c keeps its previous status');
  assert.equal(led['/c'].bodyHash, 'old', 'halted row keeps its previous hash — it re-drives next run');
  assert.equal(led['/c'].lastError, 'PUT 401 ', 'row untouched by the halt');
  assert.equal(readLog().filter((l) => l.step === 'halt').length, 1, 'one halt line');
  assert.deepEqual(readLog().find((l) => l.step === 'halt'), { ...readLog().find((l) => l.step === 'halt'), why: '401', driven: 2, remaining: 1 });
  assert.match(r.stderr, /HALT \(401\): DA_TOKEN rejected.*token source: shell.*2 page\(s\) driven this run, 1 remaining/);
  assert.match(r.stdout, /^next=node .*deploy-batch\.mjs --org o --repo r --branch main --content .* --no-progress --concurrency 1$/m, 'next= is the same command');
  assert.match(r.stdout, /^SUMMARY deploy-batch ok=2 failed=0 exit=3 details=.* halted=401 remaining=1$/m, 'halt SUMMARY counts the pages this run drove');
  assert.equal(puts(), 3, 'no retry of the 401');
  // resume: the same command finishes the remaining page and clears the stale lastError
  mock.reset(); mock.rules.putStatus = () => 201;
  r = await run(['--concurrency', '1']);
  assert.equal(r.status, 0, r.stderr);
  led = readLedger();
  assert.equal(led['/c'].status, 'previewed');
  assert.equal(led['/c'].lastError, undefined, 'lastError cleared on success');
  assert.equal(led['/c'].bodyHash, sha1(page('c')));

  // access-restricted: verify 401 + x-error, no site token → halt exit 3 with the remedy
  fresh();
  mock.rules.delivered = () => ({ status: 401, body: '', headers: { 'x-error': 'access-not-allowed' } });
  r = await run(['--concurrency', '1']);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /HALT \(access-restricted\): .*put SITE_TOKEN_R in \.env/);
  assert.ok(mock.requests.filter((q) => q.url.startsWith('/delivery/')).every((q) => q.auth === null), 'no site header without a token');
  // with SITE_TOKEN_R: header on the delivery host only; the 401 is a per-page verify-fail
  fresh();
  mock.rules.delivered = () => ({ status: 401, body: '', headers: { 'x-error': 'access-not-allowed' } });
  r = await run(['--concurrency', '1'], { SITE_TOKEN_R: 'sitesecret' });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(mock.requests.filter((q) => q.url.startsWith('/delivery/')).every((q) => q.auth === 'token sitesecret'), 'token header on delivery GETs');
  assert.ok(mock.requests.filter((q) => !q.url.startsWith('/delivery/')).every((q) => q.auth === 'Bearer plain'), 'admin/DA never see the site token');
  assert.equal(readLedger()['/a'].status, 'verify-fail');
  assert.match(readLedger()['/a'].lastError, /plain\.html 401 \(x-error: access-not-allowed\)/);

  // content-bus reset sentinel: 3 delivered rows now 404 → warning, re-drive, no halt
  fresh();
  writeFileSync(ledgerPath, JSON.stringify(Object.fromEntries(['a', 'b', 'c'].map((x) => [`/${x}`, { status: 'previewed', attempts: 1, bodyHash: sha1(page(x)) }]))));
  mock.rules.delivered = (tld, p, k) => (k === 1 ? { status: 404, body: '' } : { status: 200, body: '<main><h1>ok</h1></main>' });
  r = await run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARN 3 previously delivered pages now 404 — content-bus reset/);
  assert.equal(readLog().filter((l) => l.step === 'sentinel' && l.why === 'content-bus-reset' && l.n === 3).length, 1);
  assert.equal(puts(), 3, 'all three re-driven');
  console.log('deploy-batch-halt test: ok');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
