#!/usr/bin/env node
// Fixture test: skills/deploy/scripts/da-copy.mjs — the DA folder copy of a project move
// (deploy/reference/project-move.md § Steps, step 4). One local http server plays admin.da.live
// (list / source) AND admin.hlx.page (preview / live); network-free. Pins:
//   - recursive `list` → every file (folders recursed), media ordered before html before json;
//   - html bodies rewritten (`content.da.live/<from>/` → `<to>/`, `main--<site>--<org>`), a sheet PUT as
//     application/json with the same rewrite, media bytes PUT verbatim with their content type;
//   - preview POSTed for html/json only, never live without --publish (D16); --publish adds the live POST;
//   - one 429 then 200 → exactly one `retry` line, the row ends `previewed`;
//   - re-run with the ledger → every row `skip`, zero PUT/POST; --dry → plan lines, zero writes, no ledger;
//   - missing token → exit 2 before any request; 401 → exit 2 halt, ledger checkpointed;
//   - a failed file → exit 1, row `failed` with lastError, the rest still copied; re-run retries only it;
//   - the source tree is never written (no PUT/POST/DELETE under --from);
//   - killed run (one GET parked): the ledger is checkpointed after every file — finished rows survive the kill,
//     the re-run skips them and copies only the interrupted file (defect: written once at run end);
//   - --help lists every documented flag; `--from --to` refused; a foreign ledger refused.
// Usage: node plugins/stardust/evals/fixtures/da-copy.test.mjs   (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyOrder, rewrite, webPathOf, parseArgs } from '../../skills/deploy/scripts/da-copy.mjs';

const CLI = join(import.meta.dirname, '..', '..', 'skills', 'deploy', 'scripts', 'da-copy.mjs');
const dir = mkdtempSync(join(tmpdir(), 'da-copy-'));
const FROM = 'olduser/larkspur'; const TO = 'aemcoder/sdt-larkspur';

// ---- pure ------------------------------------------------------------------------------------
assert.deepEqual(copyOrder([{ path: 'b.html', ext: 'html' }, { path: 'redirects.json', ext: 'json' }, { path: 'media/z.png', ext: 'png' }, { path: 'a/index.html', ext: 'html' }, { path: 'media/a.jpg', ext: 'jpg' }]).map((f) => f.path), ['media/a.jpg', 'media/z.png', 'a/index.html', 'b.html', 'redirects.json'], 'media → html → json, sorted');
assert.equal(rewrite('<img src="https://content.da.live/olduser/larkspur/media/x.png"> <a href="https://main--larkspur--olduser.aem.live/p">', FROM, TO), '<img src="https://content.da.live/aemcoder/sdt-larkspur/media/x.png"> <a href="https://main--sdt-larkspur--aemcoder.aem.live/p">');
assert.equal(webPathOf('index.html'), '/'); assert.equal(webPathOf('a/index.html'), '/a/'); assert.equal(webPathOf('a/b.html'), '/a/b'); assert.equal(webPathOf('redirects.json'), '/redirects.json');
assert.throws(() => parseArgs(['--from', '--to', 'x/y']), /--from needs a value/);
assert.throws(() => parseArgs(['--from', 'x', '--to', 'y/z']), /--from must be <org>\/<site>/);
assert.throws(() => parseArgs(['--from', 'a/b', '--to', 'c/d', '--concurrency', '0']), /--concurrency/);

// ---- mock DA + admin ---------------------------------------------------------------------------
const tree = {
  '': [{ path: `/${FROM}/index`, name: 'index', ext: 'html' }, { path: `/${FROM}/about`, name: 'about', ext: 'html' }, { path: `/${FROM}/media`, name: 'media' }, { path: `/${FROM}/redirects`, name: 'redirects', ext: 'json' }, { path: `/${FROM}/news`, name: 'news' }],
  media: [{ path: `/${FROM}/media/hero.png`, name: 'hero', ext: 'png' }],
  news: [{ path: `/${FROM}/news/index`, name: 'index', ext: 'html' }],
};
const source = {
  'index.html': { type: 'text/html', body: '<body><main><div><h1>Home</h1><img src="https://content.da.live/olduser/larkspur/media/hero.png"></div></main></body>' },
  'about.html': { type: 'text/html', body: '<body><main><div><h1>About</h1><a href="https://main--larkspur--olduser.aem.live/news/">News</a></div></main></body>' },
  'news/index.html': { type: 'text/html', body: '<body><main><div><h1>News</h1></div></main></body>' },
  'redirects.json': { type: 'application/json', body: '{"total":1,"data":[{"source":"/old","destination":"https://main--larkspur--olduser.aem.live/about"}]}' },
  'media/hero.png': { type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
};
let requests = [];
const rules = { flaky429: null, fail500: null, unauthorized: false, hang: null };
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method, url: req.url, type: req.headers['content-type'] || '', body, auth: req.headers.authorization || '' });
    if (rules.unauthorized) { res.writeHead(401); res.end('unauthorized'); return; }
    const u = req.url;
    let m;
    if ((m = u.match(new RegExp(`^/list/${FROM}(?:/(.*))?$`)))) { const d = m[1] || ''; if (!(d in tree)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(tree[d])); return; }
    if ((m = u.match(new RegExp(`^/source/${FROM}/(.+)$`))) && req.method === 'GET') { if (rules.hang === m[1]) return; const f = source[m[1]]; if (!f) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': f.type }); res.end(f.body); return; }
    if ((m = u.match(new RegExp(`^/source/${TO}/(.+)$`))) && req.method === 'PUT') {
      if (rules.fail500 === m[1]) { res.writeHead(500); res.end('boom'); return; }
      res.writeHead(201); res.end(); return;
    }
    if ((m = u.match(new RegExp(`^/(preview|live)/aemcoder/sdt-larkspur/main(/.*)$`))) && req.method === 'POST') {
      if (rules.flaky429 === m[2]) { rules.flaky429 = null; res.writeHead(429); res.end('slow down'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    res.writeHead(404); res.end(`unexpected ${req.method} ${u}`);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const ledger = join(dir, 'ledger.json');
const env = { ...process.env, DA_COPY_DA_BASE: base, DA_COPY_ADMIN_BASE: base, DA_COPY_BACKOFF_MS: '1', DA_TOKEN: 'tok-VALUE-1234', HOME: dir };
// async spawn: the mock server lives in THIS process, so a spawnSync child would deadlock against it
const exec = (args, opts) => new Promise((res) => { const c = spawn(process.execPath, args, opts); let stdout = ''; let stderr = ''; c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; }); c.on('close', (status) => res({ status, stdout, stderr })); });
const run = (args, e = env) => exec([CLI, '--from', FROM, '--to', TO, '--ledger', ledger, ...args], { env: e, cwd: dir });
const puts = () => requests.filter((r) => r.method === 'PUT').map((r) => r.url.replace(`/source/${TO}/`, ''));
const posts = (k) => requests.filter((r) => r.method === 'POST' && r.url.startsWith(`/${k}/`)).map((r) => r.url.replace(`/${k}/aemcoder/sdt-larkspur/main`, ''));

try {
  // --dry: plan only
  requests = [];
  let r = await run(['--dry']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(puts().length + posts('preview').length, 0, 'dry: no writes');
  assert.ok(!existsSync(ledger), 'dry: no ledger');
  assert.match(r.stdout, /plan\s+media\/hero\.png[\s\S]*plan\s+about\.html[\s\S]*plan\s+redirects\.json/);
  assert.equal(requests.filter((r2) => r2.method === 'GET' && r2.url.startsWith('/list/')).length, 3, 'three list calls (root, media, news)');

  // first run: copy + preview, one 429
  requests = []; rules.flaky429 = '/about';
  r = await run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const order = puts(); const kind = (f) => (f.endsWith('.html') ? 1 : f.endsWith('.json') ? 2 : 0);
  assert.deepEqual([...order].sort(), ['about.html', 'index.html', 'media/hero.png', 'news/index.html', 'redirects.json'], 'every file PUT once');
  assert.deepEqual(order.map(kind), [0, 1, 1, 1, 2], 'media wave → html wave → json wave (concurrency reorders only within a wave)');
  assert.deepEqual(posts('preview').sort(), ['/', '/about', '/about', '/news/', '/redirects.json'], 'preview for html/json (about twice: 429 then 200), never media');
  assert.equal(posts('live').length, 0, 'no live POST without --publish');
  assert.equal((r.stdout.match(/^\s+retry 1 POST/mg) || []).length, 1, 'one retry line');
  const put = (p) => requests.find((q) => q.method === 'PUT' && q.url.endsWith(`/${p}`));
  const about = put('about.html'); assert.match(about.type, /^multipart\/form-data/); assert.match(about.body.toString(), /main--sdt-larkspur--aemcoder\.aem\.live/); assert.ok(!about.body.toString().includes('olduser'));
  assert.match(put('index.html').body.toString(), /content\.da\.live\/aemcoder\/sdt-larkspur\/media\/hero\.png/);
  const sheet = put('redirects.json'); assert.match(sheet.body.toString(), /Content-Type: application\/json/i); assert.match(sheet.body.toString(), /main--sdt-larkspur--aemcoder/);
  const png = put('media/hero.png'); assert.match(png.body.toString('latin1'), /Content-Type: image\/png/i); assert.ok(png.body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])), 'media bytes verbatim');
  assert.ok(requests.every((q) => q.auth === 'Bearer tok-VALUE-1234'));
  assert.ok(!requests.some((q) => q.method !== 'GET' && q.url.includes(`/${FROM}/`)), 'source tree never written');
  assert.ok(!(r.stdout + r.stderr).includes('tok-VALUE-1234'), 'token value never printed'); assert.match(r.stdout, /token DA_TOKEN from shell/);
  let l = JSON.parse(readFileSync(ledger, 'utf8'));
  assert.equal(l.rows['about.html'].status, 'previewed'); assert.equal(l.rows['media/hero.png'].status, 'copied'); assert.equal(l.rows['redirects.json'].status, 'previewed');
  assert.match(r.stdout, /SUMMARY da-copy olduser\/larkspur → aemcoder\/sdt-larkspur files=5 copied=5 previewed=4 live=0 skipped=0 failed=0 retries=1 exit=0$/m);

  // re-run: everything skipped, zero writes
  requests = [];
  r = await run([]);
  assert.equal(r.status, 0, r.stdout); assert.equal(puts().length + posts('preview').length, 0); assert.equal((r.stdout.match(/^\s+skip /mg) || []).length, 5);

  // --publish: live POST for docs only, rows → live; media stays copied
  requests = [];
  r = await run(['--publish']);
  assert.equal(r.status, 0, r.stdout); assert.deepEqual(posts('live').sort(), ['/', '/about', '/news/', '/redirects.json']); assert.equal(puts().length, 0, 'no re-PUT');
  l = JSON.parse(readFileSync(ledger, 'utf8')); assert.equal(l.rows['about.html'].status, 'live'); assert.equal(l.rows['media/hero.png'].status, 'copied');

  // a failed PUT → exit 1, row failed, the rest copied; re-run retries only it
  rmSync(ledger); requests = []; rules.fail500 = 'news/index.html';
  r = await run([]);
  assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAILED\s+news\/index\.html: PUT .*: 500/); assert.match(r.stdout, /failed=1 retries=4 exit=1$/m);
  l = JSON.parse(readFileSync(ledger, 'utf8')); assert.equal(l.rows['news/index.html'].status, 'failed'); assert.match(l.rows['news/index.html'].lastError, /500/); assert.equal(l.rows['about.html'].status, 'previewed');
  rules.fail500 = null; requests = [];
  r = await run([]);
  assert.equal(r.status, 0, r.stdout); assert.deepEqual(puts(), ['news/index.html'], 'only the failed row re-driven');

  // missing token → exit 2, zero requests; 401 → exit 2 halt
  requests = [];
  r = await run([], { ...env, DA_TOKEN: '' });
  assert.equal(r.status, 2); assert.equal(requests.length, 0); assert.match(r.stderr, /missing token in env DA_TOKEN/);
  rmSync(ledger); rules.unauthorized = true;
  r = await run([]);
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /401/); assert.match(r.stdout, /exit=2$/m); rules.unauthorized = false;
  r = await run([]); assert.equal(r.status, 0, 'recovers after the refresh');

  // killed run: the ledger is checkpointed after EVERY file (defect: written once at run end — a kill lost every row).
  // One html GET hangs; once the media wave is on disk and the other html rows landed, SIGKILL; the rows survive, the re-run skips them.
  rmSync(ledger, { force: true }); requests = []; rules.hang = 'about.html';
  {
    const c = spawn(process.execPath, [CLI, '--from', FROM, '--to', TO, '--ledger', ledger], { env, cwd: dir });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    const rowsOnDisk = () => (existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')).rows : {});
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !(rowsOnDisk()['media/hero.png']?.status === 'copied' && rowsOnDisk()['news/index.html']?.status === 'previewed')) await new Promise((w) => { setTimeout(w, 25); });
    c.kill('SIGKILL'); await new Promise((w) => { c.on('close', w); });
    const rows = rowsOnDisk();
    assert.equal(rows['media/hero.png']?.status, 'copied', `killed run: the media row was on disk before the kill\n${out}`);
    assert.equal(rows['news/index.html']?.status, 'previewed', 'killed run: a finished html row was on disk before the kill');
    assert.equal(rows['about.html'], undefined, 'killed run: the hung file has no row (never finished)');
    assert.ok(!existsSync(`${ledger}.tmp`), 'checkpoints are tmp + rename: no half-written file left');
  }
  rules.hang = null; requests = [];
  r = await run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skip\s+media\/hero\.png \(copied\)/, 're-run skips the checkpointed media row');
  assert.ok(!puts().includes('media/hero.png') && !puts().includes('news/index.html'), 're-run PUTs nothing the killed run had finished');
  assert.ok(puts().includes('about.html'), 're-run copies the file the kill interrupted');

  // foreign ledger refused; --help lists every flag
  r = await run(['--ledger', join(dir, 'foreign.json'), '--dry']); assert.equal(r.status, 0);
  requests = [];
  const foreign = await exec([CLI, '--from', 'x/y', '--to', 'z/w', '--ledger', ledger], { env, cwd: dir });
  assert.equal(foreign.status, 2); assert.match(foreign.stderr, /belongs to olduser\/larkspur → aemcoder\/sdt-larkspur; use --ledger/); assert.equal(requests.length, 0, 'foreign ledger refused before any request');
  rmSync(ledger, { force: true });
  const h = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(h.status, 0);
  for (const f of ['--from', '--to', '--prefix', '--publish', '--dry', '--skip-copy', '--concurrency', '--ledger', '--token-env', '--help']) assert.ok(h.stdout.includes(f), `help names ${f}`);
  console.log('da-copy test: ok (order, rewrite, sheet JSON, media verbatim, preview-only default, --publish, 429 retry, resume skip, --dry, failed row + re-drive, token missing, 401 halt, killed run keeps checkpointed rows, source untouched, help)');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
