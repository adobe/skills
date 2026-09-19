#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/served-check.mjs (T07.4 + T01.3) against a local gzip origin.
 * Run: node skills/deploy/scripts/test/served-check.test.mjs   (exit 1 on failure)
 *
 *   - the body is read DECODED (gzip on the wire, grep hits on the text);
 *   - --grep / --absent verdicts: 0 pass, 1 served-but-wrong;
 *   - --same-as <file>: 0 on byte-equal, 1 on differ with `sha=differ (served N B / local M B)`;
 *   - a 4xx or an `x-error` header is a verdict → exit 1; a 5xx or a network failure is NO verdict → exit 124;
 *   - --wait: keeps polling until the pass, exit 124 (never 1) when the cap expires;
 *   - usage: --help 0, no args 2, two modes 2, unreadable --same-as file 2.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'served-check.mjs');
const dir = mkdtempSync(join(tmpdir(), 'served-check-'));
const CSS = '.hero { display: grid; } /* marker-v2 */\n';
let hits = 0;
const server = createServer((req, res) => {
  hits += 1;
  const gz = (status, text, headers = {}) => { res.writeHead(status, { 'content-type': 'text/css', 'content-encoding': 'gzip', 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT', age: '0', ...headers }); res.end(gzipSync(Buffer.from(text))); };
  switch (req.url) {
    case '/styles.css': return gz(200, CSS);
    case '/old.css': return gz(200, CSS.replace('marker-v2', 'marker-v1'));
    case '/missing.css': return gz(404, 'not found');
    case '/xerr.css': return gz(200, CSS, { 'x-error': 'access-not-allowed' });
    case '/flaky.css': return gz(503, 'try later');
    case '/lands.css': return hits >= 3 ? gz(200, CSS) : gz(404, 'not yet'); // lands on the third poll
    default: return gz(404, 'no route');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
// async spawn: the origin lives in THIS process, so a spawnSync would starve it
const run = (...a) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...a], { env: { ...process.env, SERVED_CHECK_POLL_MS: '50' } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});

try {
  // decoded read + grep verdicts
  let r = await run(`${base}/styles.css`, '--grep', 'marker-v2');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^200 gzip \S+→\d+B last-modified=\S+ age=0 via=\S+ grep=1 http/, `one fact line: ${r.stdout}`);
  r = await run(`${base}/old.css`, '--grep', 'marker-v2');
  assert.equal(r.status, 1, 'pattern absent on a 2xx = served but wrong');
  assert.match(r.stdout, /grep=0/);
  assert.match(r.stderr, /exit 1 — the origin answered/);
  r = await run(`${base}/styles.css`, '--grep', '--wait', '1');
  assert.equal(r.status, 2, 'a value flag followed by another flag is a usage error, never a literal pattern');
  r = await run(`${base}/styles.css`, '--absent', 'about:error');
  assert.equal(r.status, 0, '--absent passes when the pattern is not served');
  r = await run(`${base}/styles.css`, '--absent', 'marker');
  assert.equal(r.status, 1, '--absent fails when the pattern is served');
  r = await run(`${base}/styles.css`);
  assert.equal(r.status, 0, 'no pattern: 2xx is the verdict');

  // --same-as
  const local = join(dir, 'styles.css');
  writeFileSync(local, CSS);
  r = await run(`${base}/styles.css`, '--same-as', local);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, / sha=match /, `same-as match line: ${r.stdout}`);
  writeFileSync(local, `${CSS}.extra { color: red; }\n`);
  r = await run(`${base}/styles.css`, '--same-as', local);
  assert.equal(r.status, 1, 'bytes differ = served but wrong');
  assert.match(r.stdout, new RegExp(` sha=differ \\(served ${CSS.length} B / local ${CSS.length + 23} B\\) `));
  assert.match(r.stderr, /served bytes differ from the local file/);

  // verdict vs no-verdict
  r = await run(`${base}/missing.css`, '--grep', 'marker');
  assert.equal(r.status, 1, '404 is a verdict');
  r = await run(`${base}/xerr.css`, '--grep', 'marker-v2');
  assert.equal(r.status, 1, 'x-error is a verdict even on a 200 with the pattern');
  assert.match(r.stdout, /x-error=access-not-allowed/);
  r = await run(`${base}/flaky.css`, '--grep', 'marker');
  assert.equal(r.status, 124, '5xx without --wait is no verdict');
  assert.match(r.stderr, /no verdict \(5xx \/ network\)/);
  r = await run('http://127.0.0.1:9/x.css', '--grep', 'marker');
  assert.equal(r.status, 124, 'network failure is no verdict');
  assert.match(r.stdout, /^000 /);

  // --wait: lands on the third poll → 0; never lands → 124 (not 1)
  hits = 0;
  r = await run(`${base}/lands.css`, '--grep', 'marker-v2', '--wait', '5');
  assert.equal(r.status, 0, `wait until it lands: ${r.stderr}`);
  assert.equal(r.stdout.trim().split('\n').length, 3, 'one line per poll');
  r = await run(`${base}/old.css`, '--grep', 'marker-v2', '--wait', '1');
  assert.equal(r.status, 124, 'cap expiry is exit 124, never 1');
  assert.match(r.stderr, /pattern not served after 1s — no verdict \(exit 124\)/);
  r = await run(`${base}/missing.css`, '--wait', '1');
  assert.equal(r.status, 124, 'a 404 that never turns 2xx under --wait is still no verdict at the cap');

  // usage
  assert.equal((await run('--help')).status, 0);
  assert.equal((await run()).status, 2, 'no args → 2');
  assert.equal((await run(`${base}/styles.css`, '--grep', 'a', '--same-as', local)).status, 2, 'two modes → 2');
  assert.equal((await run(`${base}/styles.css`, '--same-as', join(dir, 'nope.css'))).status, 2, 'unreadable local file → 2');
  console.log('served-check test: ok');
} finally {
  server.closeAllConnections(); server.close();
  rmSync(dir, { recursive: true, force: true });
}
