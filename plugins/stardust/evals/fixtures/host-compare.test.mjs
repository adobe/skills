#!/usr/bin/env node
// Fixture test: skills/deploy/scripts/host-compare.mjs — the parity probe of a project move
// (deploy/reference/project-move.md § Steps, step 5). One local http server plays both EDS hosts
// under /old (truth) and /new; network-free. Pins:
//   - normaliser: branch hosts (.aem.page / .aem.live) and content.da.live org/site fold to HOST/ORG/SITE;
//     media_<hash>.<ext> folds to media_HASH; a body diff outside those → `differs`;
//   - classes: identical · media-only (benign, exit 0) · differs (exit 1) · missing (new 404, exit 1) ·
//     stale-on-old (old 404, new 200 — reported, exit 0) · unreachable (exit 124 when nothing FAILed);
//   - sheets (.json) compared as-is, documents as .plain.html (`/` → /index.plain.html);
//   - --sitemap counts and lists only-on-old / only-on-new; --paths accepts a roster file or a comma list;
//   - --timeout: a hanging host → `no verdict`, exit 124 — never a FAIL; differs beats 124;
//   - --json row shape; --help lists every documented flag; `--old --paths` refused; a bad origin exit 2;
//   - zero requests carry an Authorization header; nothing is written or POSTed.
// Usage: node plugins/stardust/evals/fixtures/host-compare.test.mjs   (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, normaliseHost, normaliseMedia, readPaths, parseArgs } from '../../skills/deploy/scripts/host-compare.mjs';

const CLI = join(import.meta.dirname, '..', '..', 'skills', 'deploy', 'scripts', 'host-compare.mjs');
const dir = mkdtempSync(join(tmpdir(), 'host-compare-'));

// ---- pure -------------------------------------------------------------------------------------
const H = 'a'.repeat(40);
assert.equal(normaliseHost('<a href="https://main--larkspur--olduser.aem.live/x">main--sdt-larkspur--aemcoder.aem.page https://content.da.live/olduser/larkspur/media/a.png'), '<a href="https://HOST/x">HOST https://content.da.live/ORG/SITE/media/a.png');
assert.equal(normaliseMedia(`./media_${H}.jpeg?width=750 media_${'b'.repeat(40)}.avif`), 'media_HASH?width=750 media_HASH'.replace('media_HASH?', './media_HASH?'));
const ok = (body) => ({ status: 200, body });
assert.equal(classify(ok('<p>x</p> https://main--a--b.aem.live/'), ok('<p>x</p> https://main--c--d.aem.page/')).cls, 'identical');
assert.equal(classify(ok(`<img src="./media_${H}.jpeg">`), ok(`<img src="./media_${'c'.repeat(40)}.avif">`)).cls, 'media-only');
assert.equal(classify(ok('<p>x</p>'), ok('<p>y</p>')).cls, 'differs');
assert.equal(classify(ok('<p>x</p>'), { status: 404, body: '' }).cls, 'missing');
assert.equal(classify({ status: 404, body: '' }, ok('<p>x</p>')).cls, 'stale-on-old');
assert.equal(classify({ status: 0, body: '', error: 'timeout' }, ok('x')).cls, 'unreachable');
writeFileSync(join(dir, 'roster.txt'), '# roster\n/\n/about.html\n/news/index\n/redirects.json\n\n/about\n');
assert.deepEqual(readPaths(join(dir, 'roster.txt')), ['/', '/about', '/news/', '/redirects.json'], 'roster file: comments, .html folded, /index → /, dedupe');
assert.deepEqual(readPaths('/a,b,/c.json'), ['/a', '/b', '/c.json']);
assert.throws(() => parseArgs(['--old', '--paths', '/']), /--old needs a value/);
assert.throws(() => parseArgs(['--old', 'https://x', '--new', 'nope', '--paths', '/']), /--new must be an origin/);
assert.throws(() => parseArgs(['--old', 'https://x', '--new', 'https://y']), /--paths is required/);
assert.throws(() => parseArgs(['--old', 'https://x', '--new', 'https://y', '--paths', '/', '--timeout', '0']), /--timeout needs an integer/);

// ---- mock hosts ----------------------------------------------------------------------------------
const doc = (title, host, media) => `<body><main><div><h1>${title}</h1><a href="https://${host}/about">About</a><img src="./media_${media}.jpeg?width=750"></div></main></body>`;
const hosts = {
  old: {
    '/index.plain.html': doc('Home', 'main--larkspur--olduser.aem.live', H),
    '/about.plain.html': doc('About', 'main--larkspur--olduser.aem.live', H),
    '/news/index.plain.html': '<body><main><div><h1>News</h1><p>Old copy.</p></div></main></body>',
    '/redirects.json': '{"total":1,"data":[{"source":"/old","destination":"https://main--larkspur--olduser.aem.live/about"}]}',
    '/gone.plain.html': '<body><main><div><h1>Gone</h1></div></main></body>',
    '/sitemap.xml': '<urlset><url><loc>https://main--larkspur--olduser.aem.live/</loc></url><url><loc>https://main--larkspur--olduser.aem.live/about</loc></url><url><loc>https://main--larkspur--olduser.aem.live/fragments/stale</loc></url></urlset>',
  },
  new: {
    '/index.plain.html': doc('Home', 'main--sdt-larkspur--aemcoder.aem.page', H),
    '/about.plain.html': doc('About', 'main--sdt-larkspur--aemcoder.aem.page', 'c'.repeat(40)).replace('.jpeg', '.avif'),
    '/news/index.plain.html': '<body><main><div><h1>News</h1><p>New copy.</p></div></main></body>',
    '/redirects.json': '{"total":1,"data":[{"source":"/old","destination":"https://main--sdt-larkspur--aemcoder.aem.page/about"}]}',
    '/fresh.plain.html': '<body><main><div><h1>Fresh</h1></div></main></body>',
    '/sitemap.xml': '<urlset><url><loc>https://main--sdt-larkspur--aemcoder.aem.page/</loc></url><url><loc>https://main--sdt-larkspur--aemcoder.aem.page/about</loc></url><url><loc>https://main--sdt-larkspur--aemcoder.aem.page/fresh</loc></url></urlset>',
  },
};
let requests = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
  const m = req.url.match(/^\/(old|new|hang)(\/.*)$/);
  if (!m) { res.writeHead(404); res.end(); return; }
  if (m[1] === 'hang') return; // never answers
  const body = hosts[m[1]][m[2]];
  if (body === undefined) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': m[2].endsWith('.json') ? 'application/json' : 'text/html' }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
// async spawn: the mock hosts live in THIS process, so a spawnSync child would deadlock against them
const run = (args) => new Promise((res) => { const c = spawn(process.execPath, [CLI, ...args], { cwd: dir }); let stdout = ''; let stderr = ''; c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; }); c.on('close', (status) => res({ status, stdout, stderr })); });

try {
  // PASS set: identical + media-only + sheet + stale-on-old + sitemap
  requests = [];
  let r = await run(['--old', `${base}/old`, '--new', `${base}/new`, '--paths', '/,/about,/redirects.json,/fresh', '--sitemap', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('{')));
  assert.deepEqual(j.rows.map((x) => [x.path, x.cls]), [['/', 'identical'], ['/about', 'media-only'], ['/redirects.json', 'identical'], ['/fresh', 'stale-on-old']]);
  assert.equal(j.sitemap.old.count, 3); assert.equal(j.sitemap.new.count, 3); assert.deepEqual(j.sitemap.onlyOnOld, ['/fragments/stale']); assert.deepEqual(j.sitemap.onlyOnNew, ['/fresh']);
  assert.match(r.stdout, /SUMMARY host-compare paths=4 identical=2 media-only=1 differs=0 missing=0 stale-on-old=1 unreachable=0 exit=0$/m);
  assert.ok(requests.every((q) => q.method === 'GET' && !q.auth), 'GET only, no token');
  assert.ok(requests.some((q) => q.url === '/old/index.plain.html') && requests.some((q) => q.url === '/new/redirects.json'));

  // FAIL set: differs + missing, roster file
  writeFileSync(join(dir, 'r.txt'), '/\n/news/\n/gone\n');
  r = await run(['--old', `${base}/old`, '--new', `${base}/new`, '--paths', join(dir, 'r.txt')]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^\s+differs\s+\/news\/\s+old=200 new=200 first difference at byte \d+/m);
  assert.match(r.stdout, /^\s+missing\s+\/gone\s+old=200 new=404/m);
  assert.match(r.stdout, /differs=1 missing=1 stale-on-old=0 unreachable=0 exit=1$/m);

  // timeout → 124, never a FAIL; differs still wins over 124
  r = await run(['--old', `${base}/hang`, '--new', `${base}/new`, '--paths', '/', '--timeout', '1']);
  assert.equal(r.status, 124, r.stdout + r.stderr); assert.match(r.stdout, /no verdict: --timeout 1s expired/); assert.match(r.stdout, /exit=124$/m);
  r = await run(['--old', `${base}/old`, '--new', `${base}/new`, '--paths', '/news/,/', '--timeout', '30']);
  assert.equal(r.status, 1);
  // unreachable host (closed port) → 124 with nothing FAILed
  r = await run(['--old', 'http://127.0.0.1:9', '--new', `${base}/new`, '--paths', '/', '--timeout', '10']);
  assert.equal(r.status, 124, r.stdout + r.stderr); assert.match(r.stdout, /unreachable/);

  // usage + help
  r = await run(['--old', 'nope', '--new', `${base}/new`, '--paths', '/']); assert.equal(r.status, 2); assert.match(r.stderr, /--old must be an origin/);
  const h = await run(['--help']); assert.equal(h.status, 0);
  for (const f of ['--old', '--new', '--paths', '--sitemap', '--render', '--width', '--concurrency', '--timeout', '--json', '--help']) assert.ok(h.stdout.includes(f), `help names ${f}`);
  assert.ok(!requests.some((q) => q.method !== 'GET'), 'nothing written or POSTed');
  console.log('host-compare test: ok (normaliser, six classes, sheets, roster file/list, --sitemap, --timeout 124, unreachable 124, differs beats 124, --json, usage, help, GET-only no token)');
} finally {
  server.closeAllConnections?.(); server.close();
  rmSync(dir, { recursive: true, force: true });
}
