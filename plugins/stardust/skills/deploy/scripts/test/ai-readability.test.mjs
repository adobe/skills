#!/usr/bin/env node
// skills/deploy/scripts/test/ai-readability.test.mjs — ai-readability.mjs: --help and the site-auth usage errors (no
// browser), then the page loads against a two-origin fixture (Chromium, skipped without it): the token goes to the
// page's origin only — the page's own requests, the served fetch and the fragment fetches — never to the origin a
// stylesheet or image comes from, and not across a redirect off the origin; without a flag nothing is sent.
// The CLI runs as a child process, asynchronously: the fixture servers live in this process.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startTwoOriginServer } from '../../../replica/scripts/test/fixtures/two-origin-server.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-readability.mjs');
const SCRATCH = mkdtempSync(join(tmpdir(), 'ai-readability-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const SECRET = 't0k3n';
const AUTHORIZATION = `token ${SECRET}`;

const run = (args, { env = {}, cwd = SCRATCH } = {}) => new Promise((resolve, reject) => {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/token/i.test(k)) delete base[k];
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...base, ...env } });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  child.on('error', reject);
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});
const noSecret = (r) => assert.ok(!r.out.includes(SECRET) && !r.err.includes(SECRET), `the token was printed:\n${r.out}${r.err}`);

test('--help: exit 0 and the usage header with the site-auth flags, before any browser work', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skills\/deploy\/scripts\/ai-readability\.mjs — the AI-readability gate/);
  assert.match(r.stdout, /\[--token-env SITE_TOKEN \| --auth-header "token …"\] \[--auth-origin <url>\]/);
  assert.match(r.stdout, /ONE origin — --auth-origin\s+<url>, default --origin/);
  assert.equal(r.stderr, '');
});

test('auth usage errors exit 2 before any request: an unset variable is named, an empty flag value is refused, a token pasted for a name is never echoed', async () => {
  const base = ['--origin', 'http://127.0.0.1:9', '/page'];
  const cases = [
    [['--token-env', 'AIR_NOT_SET'], /^ai-readability: no site token: --token-env AIR_NOT_SET is not set \(or is empty\) in the environment or in a AIR_NOT_SET= line of \.env$/m],
    [['--token-env'], /^ai-readability: --token-env takes the name of an environment variable/m],
    [['--token-env', ''], /^ai-readability: --token-env takes the name of an environment variable/m],
    [['--token-env', `token ${SECRET}`], /^ai-readability: --token-env takes the name of an environment variable/m],
    [['--auth-header'], /^ai-readability: --auth-header needs a value$/m],
    [['--auth-header', ''], /^ai-readability: --auth-header needs a value$/m],
    [['--auth-header', SECRET, '--auth-origin'], /^ai-readability: --auth-origin needs an http\(s\) URL/m],
    [['--auth-header', SECRET, '--auth-origin', 'ftp://x.test'], /^ai-readability: --auth-origin needs an http\(s\) URL/m],
  ];
  for (const [flags, expected] of cases) {
    const r = await run([...base, ...flags]);
    assert.equal(r.code, 2, `${flags.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, expected, flags.join(' '));
    assert.equal(r.out, '');
    noSecret(r);
  }
  const noPath = await run(['--origin', 'http://127.0.0.1:9', '--auth-header', AUTHORIZATION]);
  assert.equal(noPath.code, 2); assert.match(noPath.err, /^usage: ai-readability\.mjs --origin <published origin>/); noSecret(noPath);
});

const hasBrowser = await import('playwright').then(async ({ chromium }) => { const b = await chromium.launch(); await b.close(); return true; }, () => false);
const browserTest = (name, fn) => test(name, { skip: !hasBrowser && 'playwright / Chromium not available' }, fn);
const fx = hasBrowser ? await startTwoOriginServer() : null;
after(() => fx && fx.stop());

const hits = (side, path) => side.log.filter((q) => q.path === path);

browserTest('--token-env: the protected page is scored — the served fetch and the page load carry the token, origin B (stylesheet, image) none', async () => {
  fx.reset();
  const r = await run(['--origin', fx.originA, '/page', '--token-env', 'AIR_SITE_TOKEN'], { env: { AIR_SITE_TOKEN: SECRET } });
  assert.equal(r.code, 0, `${r.out}${r.err}`);
  assert.match(r.out, /^\/page\n {2}strict +100%/m);
  noSecret(r);
  assert.deepEqual(hits(fx.a, '/page').map((q) => [q.authorization, q.status]), [[AUTHORIZATION, 200], [AUTHORIZATION, 200]], 'the served fetch and the page load');
  assert.ok(fx.a.log.every((q) => q.authorization === AUTHORIZATION), 'every request to origin A carries the token');
  assert.deepEqual(fx.b.log.map((q) => q.path).sort(), ['/pic.png', '/style.css']);
  assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
});

browserTest('--auth-header: a bare value gets `token `; the --json report holds neither the header nor the token', async () => {
  fx.reset();
  const dir = mkdtempSync(join(SCRATCH, 'json-'));
  const r = await run(['--origin', fx.originA, '/page', '--auth-header', SECRET, '--json', join(dir, 'report.json')]);
  assert.equal(r.code, 0, `${r.out}${r.err}`);
  noSecret(r);
  assert.ok(fx.a.log.every((q) => q.authorization === AUTHORIZATION));
  assert.deepEqual(fx.authorizations('B'), []);
  const report = readFileSync(join(dir, 'report.json'), 'utf8');
  assert.ok(!report.includes(SECRET), 'the token is in the report');
  assert.equal(JSON.parse(report).pages[0].strict.score, 100);
});

browserTest('no flag: a SITE_TOKEN in the environment and in ./.env is not sent — the served fetch is answered 401 and nothing carries an Authorization', async () => {
  fx.reset();
  const dir = mkdtempSync(join(SCRATCH, 'dotenv-'));
  writeFileSync(join(dir, '.env'), `SITE_TOKEN=${SECRET}\n`);
  const r = await run(['--origin', fx.originA, '/page'], { env: { SITE_TOKEN: SECRET }, cwd: dir });
  assert.equal(r.code, 1, `${r.out}${r.err}`);
  assert.match(r.out, /^\/page\n {2}ERROR served fetch HTTP 401$/m);
  noSecret(r);
  assert.deepEqual([...fx.authorizations('A'), ...fx.authorizations('B')], []);
});

browserTest('--auth-origin names the one origin: with origin B named, the page and the served fetch on origin A are sent nothing', async () => {
  fx.reset();
  const r = await run(['--origin', fx.originA, '/page', '--auth-header', SECRET, '--auth-origin', fx.originB]);
  assert.equal(r.code, 1, `${r.out}${r.err}`);
  assert.match(r.out, /ERROR served fetch HTTP 401/);
  noSecret(r);
  assert.deepEqual(fx.authorizations('A'), []);
});

browserTest('a redirect off the origin: the served fetch and the page load follow it, and the other origin sees no Authorization', async () => {
  fx.reset();
  const seen = [];
  const redirector = createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    res.writeHead(302, { location: `${fx.originB}/page` });
    res.end();
  });
  await new Promise((resolve) => { redirector.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = `http://127.0.0.1:${redirector.address().port}`;
    const r = await run(['--origin', origin, '/go', '--token-env', 'AIR_SITE_TOKEN'], { env: { AIR_SITE_TOKEN: SECRET } });
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    noSecret(r);
    assert.deepEqual(seen.map((q) => q.authorization), [AUTHORIZATION, AUTHORIZATION], 'the origin that redirects got the token on its own requests');
    assert.ok(hits(fx.b, '/page').length >= 2, 'both loads followed the redirect to origin B');
    assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
  } finally { redirector.closeAllConnections(); redirector.close(); }
});

browserTest('fragments the served page links to are fetched with the token, and only from the origin', async () => {
  const seen = [];
  const site = createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.headers.authorization !== AUTHORIZATION) { res.writeHead(401); res.end('401'); return; }
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>T</title></head><body><main><h1>Heading</h1><p>Body words sit here.</p><p><a href="/fragments/note">Note</a></p></main></body></html>');
    } else if (req.url === '/fragments/note.plain.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<div><p>Fragment words the page borrows.</p></div>');
    } else { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve) => { site.listen(0, '127.0.0.1', resolve); });
  try {
    const dir = mkdtempSync(join(SCRATCH, 'frag-'));
    const origin = `http://127.0.0.1:${site.address().port}`;
    const r = await run(['--origin', origin, '/page', '--auth-header', AUTHORIZATION, '--json', join(dir, 'report.json')]);
    assert.ok([0, 1].includes(r.code), `${r.out}${r.err}`);
    noSecret(r);
    const page = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).pages[0];
    assert.equal(page.error, undefined, page.error);
    assert.deepEqual(page.fragments, ['/fragments/note']);
    assert.ok(page.code.fragmentWords > 0);
    assert.ok(seen.every((q) => q.authorization === AUTHORIZATION), JSON.stringify(seen));
  } finally { site.closeAllConnections(); site.close(); }
});

browserTest('an origin that drops the connection is an ERROR row, exit 1, and gets no request without the token', async () => {
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.headers.authorization || null); req.socket.destroy(); });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const r = await run(['--origin', `http://127.0.0.1:${server.address().port}`, '/page', '--auth-header', AUTHORIZATION]);
    assert.equal(r.code, 1, `${r.out}${r.err}`);
    assert.match(r.out, /^\/page\n {2}ERROR /m);
    noSecret(r);
    assert.ok(seen.length >= 1 && seen.every((a) => a === AUTHORIZATION), JSON.stringify(seen));
  } finally { server.closeAllConnections(); server.close(); }
});
