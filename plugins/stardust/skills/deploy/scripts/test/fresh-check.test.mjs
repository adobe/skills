#!/usr/bin/env node
// skills/deploy/scripts/test/fresh-check.test.mjs — the propagation check: whitespace normalisation, sha equality
// for text differing only in whitespace, a literal (not regex) grep; and the CLI against a local node:http server
// that answers gzip-encoded and switches to the new body after a few requests: --grep, --expect-file and
// --expect-sha (full and a 12-char prefix) report fresh; a never-changing body, a 404 and a refused connection
// report stale after the deadline with the last check on stderr; --max-s 0 is one check; --json keys and order;
// usage errors exit 2 before any request; --help writes nothing.
// Run: node plugins/stardust/skills/deploy/scripts/test/fresh-check.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { isFresh, lastCheckLine, normalise, parseArgs, poll, sha256 } from '../fresh-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'fresh-check.mjs');
const OLD = '.hero {\n  color: red;\n}\n/* build old-1 */\n';
const NEW = '.hero {\n  color:   blue;\n}\n\n/* build new-2 [x]+ */\n';
const NEW_SHA = sha256(normalise(NEW));
const FLIP_AFTER = 3; // /flip/<id> serves OLD for this many requests, then NEW
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
let scratch = null;
setTimeout(() => { console.log('✗ the suite did not finish within 15 s'); if (scratch) rmSync(scratch, { recursive: true, force: true }); process.exit(1); }, 15000).unref();

// ---- pure ------------------------------------------------------------------------------------------------
await check('normalise collapses every whitespace run to one space and trims the ends', () => {
  assert.equal(normalise('  a\n\n\tb   c \r\n'), 'a b c');
  assert.equal(normalise('\n \t'), '');
});
await check('text differing only in whitespace has the same sha; a changed character does not', () => {
  assert.equal(sha256(normalise(NEW)), sha256(normalise('.hero { color: blue; } /* build new-2 [x]+ */')));
  assert.notEqual(sha256(normalise(NEW)), sha256(normalise(OLD)));
  assert.equal(isFresh('sha', NEW_SHA.slice(0, 12).toUpperCase(), NEW).fresh, true, 'a prefix, case-insensitive');
  assert.equal(isFresh('file', NEW_SHA, ` ${NEW}\n`).fresh, true);
  assert.equal(isFresh('file', NEW_SHA, OLD).fresh, false);
});
await check('grep is a literal substring of the normalised body, never a regex', () => {
  assert.equal(isFresh('grep', 'new-2 [x]+', NEW).fresh, true);
  assert.equal(isFresh('grep', 'a.c', 'abc').fresh, false, 'a regex dot would match');
  assert.equal(isFresh('grep', 'color: blue;', NEW).fresh, true, 'the marker is normalised too');
});
await check('parseArgs: defaults, one mode, http(s) only, numbers and sha shape', () => {
  assert.deepEqual(parseArgs(['https://example.com/a.css', '--grep', 'x']), { url: 'https://example.com/a.css', mode: 'grep', value: 'x', maxS: 180, everyS: 5, json: false });
  assert.equal(parseArgs(['https://example.com/', '--expect-sha', 'ABCDEF012345', '--max-s', '0', '--every-s', '.5', '--json']).value, 'abcdef012345');
  for (const bad of [['https://example.com/'], ['https://example.com/', '--grep', 'x', '--expect-sha', NEW_SHA], ['ftp://example.com/', '--grep', 'x'],
    ['https://example.com/', '--expect-sha', 'abcdef01234'], ['https://example.com/', '--expect-sha', 'xyz123456789'], ['https://example.com/', '--grep', '  '],
    ['https://example.com/', '--grep', 'x', '--every-s', '0'], ['https://example.com/', '--grep', 'x', '--max-s', '-1'], ['https://example.com/', '--grep'],
    ['https://example.com/', '--grep', 'x', '--bogus']]) assert.ok(parseArgs(bad).error, bad.join(' '));
});
await check('the stale line names the last observation', () => {
  assert.equal(lastCheckLine('grep', 'm', { status: 404, sha: null, error: null }), 'last check: HTTP 404');
  assert.equal(lastCheckLine('grep', 'm', { status: null, sha: null, error: 'fetch failed' }), 'last check: fetch error: fetch failed');
  assert.equal(lastCheckLine('grep', 'm', { status: 200, sha: NEW_SHA, error: null }), 'last check: marker not found');
  assert.equal(lastCheckLine('sha', 'abcdef0123456789', { status: 200, sha: NEW_SHA, error: null }), `last check: sha256 ${NEW_SHA.slice(0, 12)}… ≠ expected abcdef012345…`);
});

await check('a decimal --max-s whose milliseconds are fractional still gets a valid per-check timeout', async () => {
  const fetchImpl = async (url, init) => { assert.ok(init.signal instanceof AbortSignal); return new Response(NEW); };
  for (const maxS of [16.1, 2.0005]) {
    const r = await poll({ url: 'https://example.com/a.css', mode: 'grep', expected: 'new-2', maxS, everyS: 60 }, { fetchImpl, now: () => 0 });
    assert.equal(r.last.error, null, `--max-s ${maxS}`); assert.equal(r.fresh, true, `--max-s ${maxS}`);
  }
});

// ---- CLI against a local gzip server ---------------------------------------------------------------------
const hits = new Map();
const server = createServer((req, res) => {
  const path = req.url;
  hits.set(path, (hits.get(path) || 0) + 1);
  if (path === '/moved') { res.writeHead(301, { location: '/static/moved' }); res.end(); return; }
  const body = path.startsWith('/flip/') ? (hits.get(path) > FLIP_AFTER ? NEW : OLD) : path.startsWith('/static/') ? OLD : null;
  if (body === null) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'text/css', 'content-encoding': 'gzip' });
  res.end(gzipSync(body));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const closed = createServer();
await new Promise((r) => closed.listen(0, '127.0.0.1', r));
const REFUSED = `http://127.0.0.1:${closed.address().port}/x.css`;
await new Promise((r) => closed.close(r));

scratch = mkdtempSync(join(tmpdir(), 'fresh-check-'));
const run = (args, cwd = scratch) => new Promise((done) => {
  const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd });
  let out = ''; let err = '';
  ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
  ch.on('close', (code) => done({ code, out, err }));
});
const FAST = ['--max-s', '5', '--every-s', '0.2'];

try {
  await check('--grep: fresh once the gzip-encoded body switches; polled until then, not after', async () => {
    const url = `${BASE}/flip/grep`;
    const r = await run([url, '--grep', 'build new-2 [x]+', ...FAST]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, new RegExp(`^fresh ${url} after \\d+s\\n$`));
    assert.equal(r.err, '');
    assert.equal(hits.get('/flip/grep'), FLIP_AFTER + 1);
  });
  await check('--expect-file differing only in whitespace: fresh', async () => {
    const file = join(scratch, 'hero.css');
    writeFileSync(file, '.hero {\tcolor: blue;\n}   /* build new-2 [x]+ */\n\n');
    const r = await run([`${BASE}/flip/file`, '--expect-file', file, ...FAST]);
    assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /^fresh /);
  });
  await check('--expect-sha, full and a 12-char prefix: fresh', async () => {
    const full = await run([`${BASE}/flip/sha-full`, '--expect-sha', NEW_SHA, ...FAST]);
    assert.equal(full.code, 0, full.out + full.err); assert.match(full.out, /^fresh /);
    const prefix = await run([`${BASE}/flip/sha-prefix`, '--expect-sha', NEW_SHA.slice(0, 12), ...FAST]);
    assert.equal(prefix.code, 0, prefix.out + prefix.err); assert.match(prefix.out, /^fresh /);
  });
  await check('redirects are followed', async () => {
    const r = await run([`${BASE}/moved`, '--grep', 'build old-1', '--max-s', '0']);
    assert.equal(r.code, 0, r.out + r.err); assert.equal(hits.get('/static/moved'), 1);
  });
  await check('a never-changing body: stale after the deadline (exit 3), the last check on stderr', async () => {
    const url = `${BASE}/static/never`;
    const r = await run([url, '--grep', 'build new-2', '--max-s', '1', '--every-s', '0.2']);
    assert.equal(r.code, 3, r.out + r.err);
    assert.match(r.out, new RegExp(`^stale ${url} after 1s\\n$`));
    assert.equal(r.err, 'last check: marker not found\n');
    assert.ok(hits.get('/static/never') >= 3 && hits.get('/static/never') <= 6, `checks within the deadline: ${hits.get('/static/never')}`);
    const sha = await run([url, '--expect-sha', NEW_SHA, '--max-s', '0']);
    assert.equal(sha.code, 3);
    assert.equal(sha.err, `last check: sha256 ${sha256(normalise(OLD)).slice(0, 12)}… ≠ expected ${NEW_SHA.slice(0, 12)}…\n`);
  });
  await check('--max-s 0 is exactly one check', async () => {
    const r = await run([`${BASE}/flip/once`, '--grep', 'build new-2', '--max-s', '0', '--every-s', '0.2']);
    assert.equal(r.code, 3, r.out + r.err); assert.equal(hits.get('/flip/once'), 1);
  });
  await check('a 404 and a refused connection are stale, named on stderr', async () => {
    const nf = await run([`${BASE}/gone.css`, '--grep', 'x', '--max-s', '0.4', '--every-s', '0.2']);
    assert.equal(nf.code, 3); assert.match(nf.out, /^stale /); assert.equal(nf.err, 'last check: HTTP 404\n');
    const refused = await run([REFUSED, '--grep', 'x', '--max-s', '0']);
    assert.equal(refused.code, 3); assert.match(refused.err, /^last check: fetch error: \S.*\n$/);
  });
  await check('--json: one object, keys in order', async () => {
    const url = `${BASE}/flip/json`;
    const r = await run([url, '--expect-sha', NEW_SHA.slice(0, 12), '--json', ...FAST]);
    assert.equal(r.code, 0, r.out + r.err);
    const o = JSON.parse(r.out);
    assert.deepEqual(Object.keys(o), ['state', 'url', 'after', 'checks', 'mode', 'status', 'sha', 'expected', 'error']);
    assert.deepEqual({ ...o, after: 0 }, { state: 'fresh', url, after: 0, checks: FLIP_AFTER + 1, mode: 'sha', status: 200, sha: NEW_SHA, expected: NEW_SHA.slice(0, 12), error: null });
    const stale = JSON.parse((await run([`${BASE}/gone.css`, '--grep', 'x', '--max-s', '0', '--json'])).out);
    assert.deepEqual(stale, { state: 'stale', url: `${BASE}/gone.css`, after: 0, checks: 1, mode: 'grep', status: 404, sha: null, expected: 'x', error: null });
  });
  await check('usage errors exit 2 with one stderr line and no request', async () => {
    const before = [...hits.values()].reduce((a, b) => a + b, 0);
    const url = `${BASE}/static/usage`;
    for (const args of [[url], [url, '--grep', 'x', '--expect-sha', NEW_SHA], ['ftp://127.0.0.1/x', '--grep', 'x'], ['not-a-url', '--grep', 'x'],
      [url, '--expect-sha', NEW_SHA.slice(0, 11)], [url, '--grep', 'x', '--every-s', '0'], [url, '--expect-file', join(scratch, 'missing.css')]]) {
      const r = await run(args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
      assert.equal(r.out, ''); assert.match(r.err, /^fresh-check: .*usage: fresh-check\.mjs .*\n$/);
    }
    assert.equal([...hits.values()].reduce((a, b) => a + b, 0), before);
  });
  await check('--help: exit 0, usage, output, exit codes and the raw fallback; writes nothing in its cwd', async () => {
    const cwd = join(scratch, 'help'); mkdirSync(cwd);
    for (const flag of ['--help', '-h']) {
      const r = await run([flag], cwd);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^deploy\/fresh-check\.mjs — /); assert.match(r.out, /Usage: node stardust\/scripts\/deploy\/fresh-check\.mjs <url>/);
      assert.match(r.out, /`fresh <url> after <n>s`/); assert.match(r.out, /Exit: 0 fresh · 3 stale after the deadline · 2 usage/);
      assert.match(r.out, /curl -s --compressed <url> \| grep -F '<marker>'/); assert.match(r.out, /Writes nothing\./);
      assert.match(r.out, /state .*url, after, checks, mode .*status .*sha .*expected .*error/s);
    }
    assert.deepEqual(readdirSync(cwd), []);
  });
} finally {
  server.closeAllConnections(); server.close();
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
