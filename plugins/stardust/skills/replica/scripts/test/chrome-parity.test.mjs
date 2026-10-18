#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — chrome-parity's site auth (--token-env / --auth-header /
// --auth-origin) against a two-origin fixture: a protected origin A whose page loads its stylesheet and image from an
// open origin B, which also serves the same page (the stand-in for the local build). The token reaches A and never B;
// two URLs on one origin need no --auth-origin, two origins need it (a usage error, exit 1, before any request otherwise); nothing is
// sent without a flag — a SITE_TOKEN in the environment and in .env included — and that run is the run of today (exit 1
// naming the 401); a run with no auth flag on open pages is unchanged; the token is never printed. The script imports
// playwright at load, so every case needs it (a skip line without it). Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startTwoOriginServer } from './fixtures/two-origin-server.mjs';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'chrome-parity.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'chrome-parity-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// Async: the fixture servers answer from this process. The child env never carries a site token of the runner's.
const cleanEnv = (extra = {}) => { const env = { ...process.env, ...extra }; for (const k of ['SITE_TOKEN', 'DEPLOYED_GATE_SITE_TOKEN']) if (!(k in extra)) delete env[k]; return env; };
const run = (args, { cwd, env } = {}) => exec(process.execPath, [SCRIPT, ...args], { cwd, env }).then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));
const fixture = async (fn) => { const fx = await startTwoOriginServer(); try { await fn(fx); } finally { await fx.stop(); } };
const leaksNothing = (fx, r) => {
  assert.deepEqual(fx.authorizations('B'), [], 'origin B (the third party and the local build) saw no Authorization');
  assert.ok(!`${r.stdout}${r.stderr}`.includes(fx.token), 'the token is never printed');
};

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  chrome-parity checks (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  await check('--help lists the three site-auth flags and keeps exit 2 for deltas, a usage error being exit 1', async () => {
    const r = await run(['--help']);
    assert.equal(r.status, 0, r.stderr);
    for (const flag of ['--token-env <NAME>', '--auth-header <value>', '--auth-origin <url>']) assert.ok(r.stdout.includes(flag), flag);
    assert.match(r.stdout, /2 deltas printed, 1 error \(a usage error, a site-auth one included\)/);
  });

  await check('--token-env, two URLs on one origin: no --auth-origin needed; the token reaches A and not the origin of its stylesheet and image', () => fixture(async (fx) => {
    const r = await run([`${fx.originA}/page`, `${fx.originA}/copy`, '--token-env', 'FIXTURE_SITE_TOKEN'], { env: cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /■ header: ✓ parity/);
    assert.match(r.stdout, /✓ chrome parity within tolerance/);
    for (const path of ['/page', '/copy']) assert.ok(fx.a.log.some((e) => e.path === path && e.status === 200 && e.authorization === fx.authorization), `${path} answered 200 to the token`);
    assert.ok(['/style.css', '/pic.png'].every((p) => fx.b.log.some((e) => e.path === p && e.status === 200)), 'the sub-resources came from origin B');
    leaksNothing(fx, r);
  }));

  await check('two origins with --auth-origin: the protected live page is measured against the open build, and the build origin gets no token', () => fixture(async (fx) => {
    const r = await run([`${fx.originA}/page`, `${fx.originB}/page`, '--auth-header', fx.token, '--auth-origin', fx.originA], { env: cleanEnv() });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /✓ chrome parity within tolerance/);
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'a bare value is sent as "token <value>"');
    assert.ok(fx.b.log.some((e) => e.path === '/page' && e.status === 200), 'the build page was measured');
    leaksNothing(fx, r);
  }));

  await check('a token and two origins without --auth-origin: a usage error (exit 1, not the deltas code) before any request, naming the flag', () => fixture(async (fx) => {
    const r = await run([`${fx.originA}/page`, `${fx.originB}/page`, '--token-env', 'FIXTURE_SITE_TOKEN'], { env: cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^chrome-parity error: .*one origin only and these URLs have 2.*--auth-origin/);
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
    leaksNothing(fx, r);
  }));

  await check('no flag: nothing is sent — a SITE_TOKEN in the environment and in .env included — and the 401 fails as before (exit 1, naming it)', () => fixture(async (fx) => {
    const cwd = mkdtempSync(join(scratch, 'cwd-'));
    writeFileSync(join(cwd, '.env'), `SITE_TOKEN=${fx.token}\n`);
    const r = await run([`${fx.originA}/page`, `${fx.originB}/page`], { cwd, env: cleanEnv({ SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `chrome-parity error: HTTP 401 at ${fx.originA}/page — not a challenge marker, but not the page either; refusing to measure it\n`);
    assert.ok(fx.a.log.length > 0 && fx.a.log.every((e) => e.authorization === null && e.status === 401), 'origin A saw requests and none carried an Authorization');
    leaksNothing(fx, r);
  }));

  await check('no auth flag on open pages is unaffected: the same report, nothing sent anywhere', () => fixture(async (fx) => {
    const r = await run([`${fx.originB}/page`, `${fx.originB}/copy`], { env: cleanEnv({ SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^chrome-parity @ 1440px, tolerance 1px\n {2}live: {2}.*\/page\n {2}build: .*\/copy\n\n■ header: ✓ parity/);
    assert.equal(fx.a.log.length, 0, 'origin A was never asked');
    leaksNothing(fx, r);
  }));

  await check('auth usage errors exit 1 (not the deltas code) before any request: an unset variable, a flag without its value, a malformed origin', () => fixture(async (fx) => {
    const urls = [`${fx.originA}/page`, `${fx.originA}/copy`];
    const cases = [
      [['--token-env', 'NO_SUCH_FIXTURE_VAR'], /NO_SUCH_FIXTURE_VAR/],
      [['--token-env'], /--token-env takes the name of an environment variable/],
      [['--auth-header'], /--auth-header needs a value/],
      [['--auth-header', 'x', '--auth-origin', 'not a url'], /--auth-origin needs an http\(s\) URL/],
    ];
    for (const [flags, re] of cases) {
      const r = await run([...urls, ...flags], { env: cleanEnv() });
      assert.equal(r.status, 1, `${flags.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /^chrome-parity error: /);
    }
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
  }));
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
