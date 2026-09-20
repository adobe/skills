#!/usr/bin/env node
/**
 * Fixture test: the site-token plumbing on rollout's plain-fetch readers (T12.2) — lib.mjs siteAuthHeader(),
 * redirects.mjs --post-publish --token-env, media-reconcile.mjs --token-env.
 * Run: node skills/rollout/scripts/site-auth.test.mjs   (exit 1 on failure)
 *
 * One local server plays a LOCKED delivery host: every request without `Authorization: token <value>` is
 * 401 x-error: access-not-allowed; with it, pages answer 200 (HEAD and GET) and /media/clip.mp4 answers 206
 * to a ranged GET. Pins:
 *   - siteAuthHeader(): null without a name; `token <value>` for a shell name (a `token …`/`bearer …` value kept
 *     as is); an unresolvable name → null with ONE stderr note (anonymous read, never a crash);
 *   - redirects --post-publish: anonymous → exit 2 with the 401 forms listed; --token-env NAME → exit 0, every
 *     HEAD carried the token, the value never on stdout/stderr;
 *   - media-reconcile: a same-host <video src> reads `needs-credential` anonymously, `keep` with --token-env; an
 *     off-host media URL never receives the header; --json shape.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteAuthHeader } from './lib.mjs';

const HERE = import.meta.dirname;
const REDIRECTS = join(HERE, 'redirects.mjs');
const MEDIA = join(HERE, 'media-reconcile.mjs');
const FIX = join(HERE, '..', '..', '..', 'evals', 'lint', 'fixtures', 'redirects');
const SITE_TOKEN = 'sekrit-site-token-77';
const seen = [];
const srv = createServer((req, res) => {
  const p = req.url.split('?')[0];
  seen.push({ method: req.method, path: p, auth: req.headers.authorization || '' });
  if (req.headers.authorization !== `token ${SITE_TOKEN}`) { res.writeHead(401, { 'x-error': 'access-not-allowed' }); res.end(''); return; }
  if (p === '/media/clip.mp4') { res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1023/99999' }); res.end('x'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><main><h1>ok</h1></main></body></html>');
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const HOST = `127.0.0.1:${srv.address().port}`;
const run = (script, args, env = {}) => new Promise((ok) => {
  const c = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } }); let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => ok({ status, stdout, stderr, all: stdout + stderr }));
});
const T = mkdtempSync(join(tmpdir(), 'site-auth-test-'));

try {
  // siteAuthHeader()
  assert.equal(await siteAuthHeader(null), null);
  process.env.SITE_TOKEN_T = 'abc'; assert.equal(await siteAuthHeader('SITE_TOKEN_T'), 'token abc');
  process.env.SITE_TOKEN_T = 'bearer zzz'; assert.equal(await siteAuthHeader('SITE_TOKEN_T'), 'bearer zzz', 'a value already carrying its scheme is kept');
  delete process.env.SITE_TOKEN_T;
  const errs = []; const origErr = console.error; console.error = (m) => errs.push(String(m));
  try { assert.equal(await siteAuthHeader('SITE_TOKEN_NOPE_XYZ', 'tool-x'), null); } finally { console.error = origErr; }
  assert.equal(errs.length, 1); assert.match(errs[0], /^tool-x: SITE_TOKEN_NOPE_XYZ not found .* read anonymously$/);

  // redirects --post-publish against the locked host
  const R = join(T, 'rollout'); mkdirSync(R, { recursive: true }); cpSync(join(FIX, 'coverage'), join(R, 'coverage'), { recursive: true });
  writeFileSync(join(R, 'rollout.json'), JSON.stringify({ site: { liveHost: BASE }, lastRun: {} }));
  let r = await run(REDIRECTS, ['--tsv', join(FIX, 'redirects.tsv'), '--out', R, '--post-publish', '--base', BASE]);
  assert.equal(r.status, 2, `anonymous against a locked host: the probe fails loud\n${r.all}`);
  assert.match(r.all, /401/);
  seen.length = 0;
  r = await run(REDIRECTS, ['--tsv', join(FIX, 'redirects.tsv'), '--out', R, '--post-publish', '--base', BASE, '--token-env', 'SITE_TOKEN_R'], { SITE_TOKEN_R: SITE_TOKEN });
  assert.equal(r.status, 0, `with the token by NAME every form answers\n${r.all}`);
  const heads = seen.filter((q) => q.method === 'HEAD');
  assert.ok(heads.length >= 4 && heads.every((q) => q.auth === `token ${SITE_TOKEN}`), `every HEAD carried the token (${heads.length})`);
  assert.doesNotMatch(r.all, /sekrit-site-token/, 'the value is never printed');
  r = await run(REDIRECTS, ['--help']); assert.equal(r.status, 0); assert.match(r.stdout, /--token-env <NAME>/);

  // media-reconcile: same-host media needs the token; off-host never gets it
  const page = join(T, 'page.html');
  writeFileSync(page, `<html><body><main><video src="${BASE}/media/clip.mp4"></video><video src="http://127.0.0.1:1/other.mp4"></video></main></body></html>`);
  seen.length = 0;
  r = await run(MEDIA, ['--file', page, '--deploy-host', HOST, '--json']);
  assert.notEqual(r.status, 0, 'a needs-credential / unplayable row is a non-zero exit (P1) — the governance state is visible');
  let rows = JSON.parse(r.stdout).results;
  const clip = rows.find((x) => x.url.endsWith('/media/clip.mp4'));
  assert.equal(clip.decision, 'needs-credential', `anonymous same-host media reads needs-credential: ${JSON.stringify(clip)}`);
  seen.length = 0;
  r = await run(MEDIA, ['--file', page, '--deploy-host', HOST, '--json', '--token-env', 'SITE_TOKEN_M'], { SITE_TOKEN_M: SITE_TOKEN });
  rows = JSON.parse(r.stdout).results;
  const clip2 = rows.find((x) => x.url.endsWith('/media/clip.mp4'));
  assert.equal(clip2.decision, 'keep', `with --token-env the same-host media is playable: ${JSON.stringify(clip2)}`);
  assert.ok(seen.some((q) => q.path === '/media/clip.mp4' && q.auth === `token ${SITE_TOKEN}`), 'the delivery-host probe carried the token');
  const other = rows.find((x) => x.url.includes('other.mp4')); assert.equal(other.decision, 'unplayable', 'an off-host URL is probed anonymously (network error → unplayable)');
  assert.doesNotMatch(r.all, /sekrit-site-token/);
  r = await run(MEDIA, ['--help']); assert.match(readFileSync(MEDIA, 'utf8'), /--token-env <NAME>/, 'documented in the header');
  console.log('site-auth test: ok');
} finally {
  srv.close();
  rmSync(T, { recursive: true, force: true });
}
