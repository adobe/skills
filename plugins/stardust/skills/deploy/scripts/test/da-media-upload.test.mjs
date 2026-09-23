#!/usr/bin/env node
// skills/deploy/scripts/test/da-media-upload.test.mjs — the da-media-upload.mjs contract against a
// local fake of the DA Source API (node http on a random port; no network): PUT method/path, the
// multipart field name and part content type, the Authorization header, 429-then-200 retry, the
// ledger skip on re-run (path + size), source-fetch 403 (bot wall) vs 404 (missing), a PUT 404,
// svg safety, the 401 policy (an expired JWT exits 3 before any request; the first upload runs alone;
// a 401 burst on a valid token is retried and lands; a 401 that persists through its retries on ANY
// file halts with exit 3 — ledger saved, in-flight uploads finish, the rest not attempted, nothing
// marked failed, one stderr line with the re-run command), the atomic ledger write, --dry-run, usage
// errors (a value flag swallowing nothing or another --flag) — and that the token value never
// reaches stdout, stderr or the ledger.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, jwtExpiry, readManifest } from '../da-media-upload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'da-media-upload.mjs');
const proj = mkdtempSync(join(tmpdir(), 'da-media-upload-test-'));
const TOKEN = `tok-${randomBytes(12).toString('hex')}`;
// JWT-shaped tokens for the preflight: header.payload.signature, base64url, the payload carrying exp.
const jwt = (claims) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${randomBytes(16).toString('base64url')}`;
const EXPIRED_EXP = Math.floor(Date.now() / 1000) - 2 * 3600;
const EXPIRED_JWT = jwt({ exp: EXPIRED_EXP, sub: 'x', client_id: 'test' });
const FUTURE_JWT = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'x' });
const SECRETS = [TOKEN, EXPIRED_JWT, FUTURE_JWT];
const ORG = 'test-org'; const REPO = 'test-repo';
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const allOutput = [];

// ---- fake DA + fake source origin --------------------------------------------------------------------
const requests = [];
const putCount = {};
// The server's view of the client's concurrency: how many PUTs are in flight when each one arrives, and
// whether the deliberately slow first upload (/slow-first.png, held ~150 ms) was still being served.
let putInflight = 0; let slowInflight = false;
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || ''); if (!m) return [];
  const delim = Buffer.from(`--${m[1] || m[2]}`);
  const parts = [];
  let idx = body.indexOf(delim);
  while (idx !== -1) {
    const start = idx + delim.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delim, start);
    const chunk = body.subarray(start + 2, next - 2);
    const sep = chunk.indexOf('\r\n\r\n');
    parts.push({ headers: chunk.subarray(0, sep).toString('utf8'), data: chunk.subarray(sep + 4) });
    idx = next;
  }
  return parts;
}
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  const arrival = { inflight: 0, duringSlow: slowInflight };
  if (req.method === 'PUT') {
    putInflight += 1; arrival.inflight = putInflight;
    if (url.endsWith('/slow-first.png')) slowInflight = true;
    res.once('finish', () => { putInflight -= 1; });
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const rec = { method: req.method, url, headers: req.headers, body, parts: req.method === 'PUT' ? parseMultipart(body, req.headers['content-type']) : [], ...arrival };
    requests.push(rec);
    if (req.method === 'GET' && url.startsWith('/src/')) {
      if (url.endsWith('/missing.png')) { res.writeHead(404); res.end('not found'); return; }
      if (url.endsWith('/walled.png')) { res.writeHead(403); res.end('access denied'); return; }
      if (url.endsWith('/html.png')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html>challenge</html>'); return; }
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(FILES.ok); return;
    }
    if (req.method !== 'PUT' || !url.startsWith(`/source/${ORG}/${REPO}/media/`)) { res.writeHead(405); res.end(); return; }
    putCount[url] = (putCount[url] || 0) + 1;
    if (url.endsWith('/a.png') && putCount[url] === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
    if (/\/flaky\d*\.png$/.test(url) && putCount[url] < 3) { res.writeHead(503); res.end('unavailable'); return; }
    if (url.endsWith('/notfound.png')) { res.writeHead(404); res.end('no such org/repo'); return; }
    if (url.endsWith('/expired.png')) { res.writeHead(401); res.end(''); return; }
    // A valid token answered 401 under a burst: the first two PUTs for each burst*.png path, then 201.
    if (/\/burst\d*\.png$/.test(url) && putCount[url] <= 2) { res.writeHead(401); res.end(''); return; }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); res.end('bad token'); return; }
    const created = () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end('{}'); };
    if (url.endsWith('/slow-first.png')) { setTimeout(() => { slowInflight = false; created(); }, 150); return; }
    if (/\/par\d\.png$/.test(url)) { setTimeout(created, 30); return; }
    created();
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- fixtures ---------------------------------------------------------------------------------------
const FILES = { a: randomBytes(2048), b: randomBytes(1500), c: randomBytes(900), ok: randomBytes(700), svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>') };
const assets = join(proj, 'assets');
mkdirSync(join(assets, 'nested'), { recursive: true });
writeFileSync(join(assets, 'a.png'), FILES.a); writeFileSync(join(assets, 'b.jpg'), FILES.b); writeFileSync(join(assets, 'nested', 'c.webp'), FILES.c);
writeFileSync(join(assets, 'd.mp4'), randomBytes(300)); writeFileSync(join(assets, 'e.svg'), FILES.svg);
const LEDGER = join(proj, 'stardust', 'deploy', 'media-ledger.json');

const run = (args, { token = TOKEN } = {}) => new Promise((resolve) => {
  const env = { ...process.env }; delete env.DA_TOKEN; if (token) env.DA_TOKEN = token;
  const p = spawn(process.execPath, [SCRIPT, '--org', ORG, '--repo', REPO, '--admin-url', BASE, '--content-url', `${BASE}/content`, '--backoff-ms', '5', ...args], { cwd: proj, env });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => { allOutput.push(out, err); resolve({ code, out, err }); });
});
const ledger = () => JSON.parse(readFileSync(LEDGER, 'utf8'));
const contentUrl = (name) => `${BASE}/content/${ORG}/${REPO}/media/brand/${name}`;

// ---- unit ---------------------------------------------------------------------------------------------
await check('classify: image types by extension, non-images skipped, unsafe svg refused', () => {
  assert.equal(classify('x.JPG').type, 'image/jpeg'); assert.equal(classify('x.webp').type, 'image/webp'); assert.equal(classify('x.avif').type, 'image/avif');
  assert.equal(classify('x.mp4').skip, 'not-an-image'); assert.equal(classify('x.pdf').skip, 'not-an-image'); assert.equal(classify('x.mp3').skip, 'not-an-image'); assert.equal(classify('x').skip, 'not-an-image');
  assert.equal(classify('x.svg', FILES.svg).type, 'image/svg+xml');
  assert.equal(classify('x.svg', Buffer.from('<svg><image href="data:image/png;base64,AAAA"/></svg>')).fail, 'svg-unsafe');
  assert.equal(classify('x.svg', Buffer.alloc(41 * 1024, 0x20)).fail, 'svg-unsafe');
});
await check('jwtExpiry: reads exp from a JWT payload; null for a non-JWT, a JWT without exp, or garbage segments', () => {
  assert.equal(jwtExpiry(EXPIRED_JWT), EXPIRED_EXP);
  assert.equal(jwtExpiry(jwt({ sub: 'x' })), null);
  assert.equal(jwtExpiry(TOKEN), null); assert.equal(jwtExpiry('a.b.c'), null); assert.equal(jwtExpiry('a.b'), null); assert.equal(jwtExpiry(undefined), null);
  assert.equal(jwtExpiry(`x.${Buffer.from('not json').toString('base64url')}.y`), null);
});
await check('readManifest: array, map and extract § Media shapes all reduce to {file, source, name}', () => {
  const p = join(proj, 'm.json');
  writeFileSync(p, JSON.stringify([{ file: 'assets/a.png', source: 'https://origin.example/a.png' }, { file: 'assets/b.jpg', name: 'hero.jpg' }]));
  assert.deepEqual(readManifest(p), [{ file: 'assets/a.png', source: 'https://origin.example/a.png', name: 'a.png' }, { file: 'assets/b.jpg', source: null, name: 'hero.jpg' }]);
  writeFileSync(p, JSON.stringify({ 'assets/a.png': 'https://origin.example/a.png', 'assets/b.jpg': { name: 'hero.jpg' } }));
  assert.deepEqual(readManifest(p).map((e) => [e.file, e.source, e.name]), [['assets/a.png', 'https://origin.example/a.png', 'a.png'], ['assets/b.jpg', null, 'hero.jpg']]);
  writeFileSync(p, JSON.stringify({ images: [{ src: 'https://origin.example/x.png?v=1', localPath: 'assets/x-1a2b.png', alt: 'x' }, { src: 'https://origin.example/y.png', localPath: null }] }));
  assert.deepEqual(readManifest(p), [{ file: 'assets/x-1a2b.png', source: 'https://origin.example/x.png?v=1', name: 'x-1a2b.png' }]);
});

// ---- --dir upload: PUT contract, retry, skip non-images ---------------------------------------------
await check('--dir uploads every image: PUT path, field `data`, content type, Authorization; 429 then 201 retried; mp4 skipped', async () => {
  const r = await run(['--scope', 'brand', '--dir', 'assets']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^OK assets\/a\.png -> \S+\/media\/brand\/a\.png \(after 2 attempts\)$/m);
  assert.match(r.out, new RegExp(`^OK assets/b\\.jpg -> ${contentUrl('b.jpg').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(r.out, /^OK assets\/nested\/c\.webp -> \S+\/media\/brand\/nested\/c\.webp$/m);
  assert.match(r.out, /^OK assets\/e\.svg -> \S+\/media\/brand\/e\.svg$/m);
  assert.match(r.out, /^SKIP assets\/d\.mp4 not-an-image \(only jpg\/jpeg\/png\/webp\/gif\/avif\/svg are rehosted; video, audio and PDF ship from the code origin\)$/m);
  assert.match(r.out, /^da-media-upload: 5 file\(s\) — 4 uploaded, 1 skipped \(1 not an image\), 0 failed · ledger stardust\/deploy\/media-ledger\.json$/m);
  const puts = requests.filter((q) => q.method === 'PUT');
  assert.equal(puts.length, 5, 'a.png twice (429 then 201) + b + c + e');
  const aPuts = puts.filter((q) => q.url === `/source/${ORG}/${REPO}/media/brand/a.png`);
  assert.equal(aPuts.length, 2);
  for (const q of aPuts) {
    assert.equal(q.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(q.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.equal(q.parts.length, 1);
    assert.match(q.parts[0].headers, /Content-Disposition: form-data; name="data"; filename="a\.png"/i);
    assert.match(q.parts[0].headers, /Content-Type: image\/png/i);
    assert.ok(q.parts[0].data.equals(FILES.a), 'uploaded bytes equal the file');
  }
  const c = puts.find((q) => q.url.endsWith('/nested/c.webp')); assert.match(c.parts[0].headers, /Content-Type: image\/webp/i); assert.ok(c.parts[0].data.equals(FILES.c));
  assert.match(puts.find((q) => q.url.endsWith('/e.svg')).parts[0].headers, /Content-Type: image\/svg\+xml/i);
  assert.ok(!puts.some((q) => q.url.includes('d.mp4')), 'no PUT for the video');
});
await check('ledger records each upload (path, size, sha256, content url) and never the token', () => {
  const l = ledger();
  assert.deepEqual(Object.keys(l).sort(), ['media/brand/a.png', 'media/brand/b.jpg', 'media/brand/e.svg', 'media/brand/nested/c.webp']);
  const a = l['media/brand/a.png'];
  assert.equal(a.status, 'uploaded'); assert.equal(a.file, 'assets/a.png'); assert.equal(a.size, 2048); assert.match(a.sha256, /^[0-9a-f]{64}$/); assert.equal(a.attempts, 2); assert.equal(a.contentUrl, contentUrl('a.png')); assert.equal(a.contentType, 'image/png');
  assert.ok(!readFileSync(LEDGER, 'utf8').includes(TOKEN), 'token must not be written to the ledger');
  assert.ok(readFileSync(LEDGER, 'utf8').endsWith('}\n'), 'the ledger ends with a trailing newline');
  assert.deepEqual(readdirSync(dirname(LEDGER)), ['media-ledger.json'], 'the atomic write leaves no tmp file behind');
});

// ---- shared ledger: another cluster's rows survive this run's persist -------------------------------
await check('a row another uploader wrote to the shared ledger survives this run (lock + re-read + merge)', async () => {
  const before = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const aKey = Object.keys(before).find((k) => k.endsWith('/brand/a.png'));
  const foreignKey = aKey.replace('/brand/a.png', '/other-cluster/z.png');
  writeFileSync(LEDGER, `${JSON.stringify({ ...before, [foreignKey]: { status: 'uploaded', file: 'assets/z.png', size: 1, by: 'cluster-2' } }, null, 2)}\n`);
  writeFileSync(join(assets, 'f.png'), FILES.a);
  try {
    const r = await run(['--scope', 'brand', '--dir', 'assets']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^OK assets\/f\.png -> /m);
    const l = ledger();
    assert.equal(l[foreignKey].by, 'cluster-2', 'the other writer\'s row is kept');
    assert.equal(l[aKey.replace('/brand/a.png', '/brand/f.png')].status, 'uploaded');
    assert.deepEqual(readdirSync(dirname(LEDGER)), ['media-ledger.json'], 'no tmp file, no lock dir left');
  } finally {
    rmSync(join(assets, 'f.png'));
    const l = JSON.parse(readFileSync(LEDGER, 'utf8')); delete l[foreignKey]; delete l[aKey.replace('/brand/a.png', '/brand/f.png')];
    writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
  }
});
await check('re-run skips every uploaded file (same path and size) without a request; a changed size re-uploads', async () => {
  const before = requests.length;
  const r = await run(['--scope', 'brand', '--dir', 'assets']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(requests.length, before, 'no network traffic on a fully-skipped re-run');
  for (const f of ['a.png', 'b.jpg', 'nested/c.webp', 'e.svg']) assert.match(r.out, new RegExp(`^SKIP assets/${f.replace('.', '\\.')} already uploaded \\(ledger\\) -> \\S+/media/brand/${f.replace('.', '\\.')}$`, 'm'));
  assert.match(r.out, /5 file\(s\) — 0 uploaded, 5 skipped \(1 not an image\), 0 failed/);
  writeFileSync(join(assets, 'b.jpg'), Buffer.concat([FILES.b, randomBytes(10)]));
  const r2 = await run(['--scope', 'brand', '--dir', 'assets']);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out, /^OK assets\/b\.jpg -> /m); assert.match(r2.out, /^SKIP assets\/a\.png already uploaded/m);
  assert.equal(requests.length, before + 1); assert.equal(ledger()['media/brand/b.jpg'].size, 1510);
});

// ---- manifest: source fetch 403 vs 404, PUT 404, svg safety, missing local -----------------------------
await check('manifest: source 2xx is downloaded and uploaded; 403 = bot wall (not missing); 404 = missing; PUT 404; unsafe svg; no local+no source', async () => {
  writeFileSync(join(assets, 'notfound.png'), randomBytes(100));
  writeFileSync(join(assets, 'bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><defs><pattern id="p"><image href="data:image/png;base64,iVBORw0KGgo="/></pattern></defs></svg>');
  const manifest = join(proj, 'manifest.json');
  writeFileSync(manifest, JSON.stringify([
    { file: 'assets/dl/ok.png', source: `${BASE}/src/ok.png` },
    { file: 'assets/dl/missing.png', source: `${BASE}/src/missing.png` },
    { file: 'assets/dl/walled.png', source: `${BASE}/src/walled.png` },
    { file: 'assets/dl/html.png', source: `${BASE}/src/html.png` },
    { file: 'assets/notfound.png' },
    { file: 'assets/bad.svg' },
    { file: 'assets/nolocal.png' },
    { file: 'assets/a.png', name: 'renamed/a-copy.png' },
  ]));
  const r = await run(['--scope', 'brand', '--manifest', 'manifest.json', '--concurrency', '2']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^OK assets\/dl\/ok\.png -> \S+\/media\/brand\/ok\.png$/m);
  assert.ok(existsSync(join(assets, 'dl', 'ok.png')) && readFileSync(join(assets, 'dl', 'ok.png')).equals(FILES.ok), 'fetched source saved to the manifest path');
  const src = requests.find((q) => q.method === 'GET' && q.url === '/src/ok.png'); assert.match(src.headers['user-agent'], /Mozilla/); assert.equal(src.headers.referer, `${BASE}/`);
  assert.match(r.out, /^FAIL assets\/dl\/missing\.png source 404 \(missing at origin — try the rendition\/delimiter repairs first, then omit; never substitute a placeholder\)$/m);
  assert.match(r.out, /^FAIL assets\/dl\/walled\.png source 403 \(bot wall: blocked when hot-linked, NOT missing — capture it in-page .* and re-run; never omit\)$/m);
  assert.match(r.out, /^FAIL assets\/dl\/html\.png source 200 \(answered text\/html, not image bytes\)$/m);
  assert.match(r.out, /^FAIL assets\/notfound\.png 404 \(org\/repo path not found on DA — check --org\/--repo\)$/m);
  assert.match(r.out, /^FAIL assets\/bad\.svg svg-unsafe \(embeds raster data/m);
  assert.match(r.out, /^FAIL assets\/nolocal\.png missing-local \(no such file and the manifest names no source\)$/m);
  assert.match(r.out, /^OK assets\/a\.png -> \S+\/media\/brand\/renamed\/a-copy\.png$/m); // a different DA path is a different ledger entry
  assert.match(r.out, /8 file\(s\) — 2 uploaded, 0 skipped \(0 not an image\), 6 failed/);
  assert.ok(!requests.some((q) => q.method === 'PUT' && /bad\.svg|missing\.png|walled\.png|html\.png|nolocal/.test(q.url)), 'nothing unsafe or unavailable was PUT');
  const l = ledger();
  assert.equal(l['media/brand/walled.png'].status, 'failed'); assert.match(l['media/brand/walled.png'].error, /^source 403/);
  assert.equal(l['media/brand/notfound.png'].httpStatus, 404);
});
await check('5xx is retried up to --retries then reported as FAIL with the attempt count', async () => {
  writeFileSync(join(assets, 'flaky.png'), randomBytes(50)); writeFileSync(join(assets, 'flaky2.png'), randomBytes(50));
  writeFileSync(join(proj, 'flaky.json'), JSON.stringify([{ file: 'assets/flaky.png' }])); writeFileSync(join(proj, 'flaky2.json'), JSON.stringify([{ file: 'assets/flaky2.png' }]));
  const r1 = await run(['--scope', 'brand', '--manifest', 'flaky.json', '--retries', '1']);
  assert.equal(r1.code, 1, r1.out + r1.err); assert.match(r1.out, /^FAIL assets\/flaky\.png 503 \(unavailable; 2 attempts\)$/m);
  const r2 = await run(['--scope', 'brand', '--manifest', 'flaky2.json', '--retries', '4']);
  assert.equal(r2.code, 0, r2.out + r2.err); assert.match(r2.out, /^OK assets\/flaky2\.png -> \S+ \(after 3 attempts\)$/m);
});
await check('a 401 that persists on the first upload halts the batch (after the retries): exit 3, nothing marked failed, ledger checkpointed, remaining files not attempted, one stderr line with the re-run command', async () => {
  for (const n of ['expired.png', 'z1.png', 'z2.png']) writeFileSync(join(assets, n), randomBytes(40));
  writeFileSync(join(proj, 'halt.json'), JSON.stringify([{ file: 'assets/expired.png' }, { file: 'assets/z1.png' }, { file: 'assets/z2.png' }]));
  const before = requests.filter((q) => q.method === 'PUT').length;
  const r = await run(['--scope', 'brand', '--manifest', 'halt.json', '--concurrency', '1', '--retries', '0']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.out, /^HALT assets\/expired\.png 401 \(unauthorized through 1 attempt — DA_TOKEN rejected; not recorded as failed, the re-run resumes here\)$/m);
  assert.doesNotMatch(r.out, /z1\.png|z2\.png|FAIL/); assert.match(r.out, /3 file\(s\) — 0 uploaded, 0 skipped \(0 not an image\), 0 failed, 3 not attempted/);
  assert.equal(r.err.trim().split('\n').length, 1, `one stderr line: ${r.err}`);
  assert.match(r.err, /^da-media-upload: DA_TOKEN rejected \(401 through 1 attempt on assets\/expired\.png, the lone first upload\): refresh DA_TOKEN in the environment and re-run the same command — the ledger skips what already uploaded: DA_TOKEN=<fresh token> node \S+da-media-upload\.mjs --org test-org --repo test-repo .* --scope brand --manifest halt\.json --concurrency 1 --retries 0$/m);
  assert.equal(requests.filter((q) => q.method === 'PUT').length, before + 1);
  assert.equal(ledger()['media/brand/expired.png'], undefined, 'a 401 never marks the file failed'); assert.equal(ledger()['media/brand/z1.png'], undefined);
  // The halt fires only once the retries are spent, and the first upload is alone even at --concurrency 4:
  // three attempts on expired.png, no PUT for z1/z2.
  const before2 = requests.filter((q) => q.method === 'PUT').length;
  const r2 = await run(['--scope', 'brand', '--manifest', 'halt.json', '--concurrency', '4', '--retries', '2', '--backoff-ms', '1']);
  assert.equal(r2.code, 3, r2.out + r2.err);
  assert.match(r2.out, /^HALT assets\/expired\.png 401 \(unauthorized through 3 attempts/m);
  assert.doesNotMatch(r2.out, /z1\.png|z2\.png|FAIL/); assert.match(r2.out, /0 failed, 3 not attempted/); assert.match(r2.err, /DA_TOKEN rejected \(401 through 3 attempts on assets\/expired\.png, the lone first upload\)/);
  const puts2 = requests.filter((q) => q.method === 'PUT').slice(before2);
  assert.equal(puts2.length, 3, 'three attempts on the first upload, then the halt');
  assert.ok(puts2.every((q) => q.url.endsWith('/expired.png') && q.inflight === 1), 'every attempt was the lone request in flight');
  assert.equal(ledger()['media/brand/expired.png'], undefined);
});
await check('an expired JWT in DA_TOKEN exits 3 before any request, naming the expiry and the re-run command; a JWT with a future exp is tried (and a wrong one halts on the first upload)', async () => {
  const before = requests.length; const ledgerBefore = readFileSync(LEDGER, 'utf8');
  const r = await run(['--scope', 'brand', '--manifest', 'halt.json'], { token: EXPIRED_JWT });
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.out, '', 'nothing on stdout — no file was attempted');
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, new RegExp(`^da-media-upload: DA_TOKEN is expired — its exp claim is ${new Date(EXPIRED_EXP * 1000).toISOString().replace(/[.]/g, '\\.')} \\(\\d+ min ago\\); nothing was sent\\. Refresh it and re-run: DA_TOKEN=<fresh token> node \\S+da-media-upload\\.mjs --org test-org .* --manifest halt\\.json$`, 'm'));
  assert.equal(requests.length, before, 'no request left the process'); assert.equal(readFileSync(LEDGER, 'utf8'), ledgerBefore, 'the ledger is untouched');
  const dry = await run(['--scope', 'brand', '--manifest', 'halt.json', '--dry-run'], { token: EXPIRED_JWT });
  assert.equal(dry.code, 0, 'a dry run needs no token and never preflights it'); assert.match(dry.out, /^DRY assets\/expired\.png/m);
  const fut = await run(['--scope', 'brand', '--manifest', 'halt.json', '--retries', '1', '--backoff-ms', '1'], { token: FUTURE_JWT });
  assert.equal(fut.code, 3, fut.out + fut.err); assert.match(fut.out, /^HALT assets\/expired\.png 401 \(unauthorized through 2 attempts/m); assert.doesNotMatch(fut.err, /expired —/);
  assert.equal(requests.length, before + 2, 'the future-exp JWT reached the admin API (two attempts on the lone first upload)');
});

// ---- the 401 rule: burst on a valid token, first upload alone, persistent 401 after acceptance ---------
await check('a burst of 401s on a valid token does not halt: the first upload retries its 401 like a 429 and every file lands', async () => {
  const names = ['burst1.png', 'burst2.png', 'burst3.png'];
  for (const n of names) writeFileSync(join(assets, n), randomBytes(40));
  writeFileSync(join(proj, 'burst.json'), JSON.stringify(names.map((n) => ({ file: `assets/${n}` }))));
  const before = requests.length;
  const r = await run(['--scope', 'brand', '--manifest', 'burst.json', '--concurrency', '4', '--retries', '3', '--backoff-ms', '1']);
  assert.equal(r.code, 0, r.out + r.err);
  for (const n of names) assert.match(r.out, new RegExp(`^OK assets/${n.replace('.', '\\.')} -> \\S+/media/brand/${n.replace('.', '\\.')} \\(after 3 attempts\\)$`, 'm'));
  assert.match(r.out, /3 file\(s\) — 3 uploaded, 0 skipped \(0 not an image\), 0 failed · ledger/);
  assert.doesNotMatch(r.out, /FAIL|halted|not attempted/); assert.equal(r.err, '', 'no halt instruction on stderr');
  assert.equal(requests.slice(before).filter((q) => q.method === 'PUT').length, 9, 'three PUTs per file: 401, 401, 201');
  const l = ledger();
  assert.ok(names.some((n) => l[`media/brand/${n}`].attempts > 1), 'the ledger records the retried attempts');
  for (const n of names) assert.equal(l[`media/brand/${n}`].status, 'uploaded');
});
await check('a 401 that persists after the token was accepted halts too (exit 3): finished files in the ledger, in-flight upload finishes, the rest not attempted, nothing marked failed', async () => {
  for (const n of ['burst4.png', 'expired.png', 'z3.png']) writeFileSync(join(assets, n), randomBytes(40));
  writeFileSync(join(proj, 'late401.json'), JSON.stringify([{ file: 'assets/burst4.png' }, { file: 'assets/expired.png' }, { file: 'assets/z3.png' }]));
  const before = requests.length;
  const r = await run(['--scope', 'brand', '--manifest', 'late401.json', '--concurrency', '1', '--retries', '2', '--backoff-ms', '1']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.out, /^OK assets\/burst4\.png -> \S+ \(after 3 attempts\)$/m);
  assert.match(r.out, /^HALT assets\/expired\.png 401 \(unauthorized through 3 attempts — DA_TOKEN rejected; not recorded as failed, the re-run resumes here\)$/m);
  assert.doesNotMatch(r.out, /z3\.png|FAIL/, 'the remaining file was not attempted');
  assert.match(r.out, /3 file\(s\) — 1 uploaded, 0 skipped \(0 not an image\), 0 failed, 2 not attempted · ledger/);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, /^da-media-upload: DA_TOKEN rejected \(401 through 3 attempts on assets\/expired\.png, after the token had been accepted earlier in this batch\): refresh DA_TOKEN .* re-run the same command — the ledger skips what already uploaded: DA_TOKEN=<fresh token> node \S+da-media-upload\.mjs --org test-org .* --manifest late401\.json --concurrency 1 --retries 2 --backoff-ms 1$/m);
  assert.equal(requests.slice(before).filter((q) => q.method === 'PUT').length, 3 + 3);
  const l = ledger();
  assert.equal(l['media/brand/burst4.png'].status, 'uploaded', 'the finished file is in the ledger');
  assert.equal(l['media/brand/expired.png'], undefined, 'never failed because of a 401'); assert.equal(l['media/brand/z3.png'], undefined);
  // In flight at the halt: with the pool open at 2, the slow upload beside expired.png is allowed to finish
  // (OK, in the ledger) while the files queued behind them are not attempted; a re-run resumes from there.
  const names = ['burst5.png', 'expired.png', 'slow-first.png', 'z4.png', 'z5.png'];
  for (const n of names) writeFileSync(join(assets, n), randomBytes(40));
  writeFileSync(join(proj, 'late401b.json'), JSON.stringify(names.map((n) => ({ file: `assets/${n}` }))));
  const before2 = requests.length;
  const r2 = await run(['--scope', 'late', '--manifest', 'late401b.json', '--concurrency', '2', '--retries', '2', '--backoff-ms', '1']);
  assert.equal(r2.code, 3, r2.out + r2.err);
  assert.match(r2.out, /^OK assets\/burst5\.png/m); assert.match(r2.out, /^OK assets\/slow-first\.png -> \S+\/media\/late\/slow-first\.png$/m);
  assert.match(r2.out, /^HALT assets\/expired\.png 401 \(unauthorized through 3 attempts/m);
  assert.doesNotMatch(r2.out, /z4\.png|z5\.png|FAIL/);
  assert.match(r2.out, /5 file\(s\) — 2 uploaded, 0 skipped \(0 not an image\), 0 failed, 3 not attempted/);
  assert.equal(requests.slice(before2).filter((q) => q.method === 'PUT').length, 3 + 3 + 1, 'burst5 ×3, expired ×3, slow-first ×1 — nothing for z4/z5');
  const l2 = ledger();
  assert.equal(l2['media/late/burst5.png'].status, 'uploaded'); assert.equal(l2['media/late/slow-first.png'].status, 'uploaded');
  assert.equal(l2['media/late/expired.png'], undefined); assert.equal(l2['media/late/z4.png'], undefined);
  assert.ok(readFileSync(LEDGER, 'utf8').endsWith('}\n')); assert.deepEqual(readdirSync(dirname(LEDGER)), ['media-ledger.json'], 'no tmp file after the halt checkpoint');
});
await check('the first upload runs alone: no other PUT arrives while it is in flight, the rest use the pool concurrency', async () => {
  const names = ['slow-first.png', 'par1.png', 'par2.png', 'par3.png', 'par4.png'];
  for (const n of names) writeFileSync(join(assets, n), randomBytes(40));
  writeFileSync(join(proj, 'alone.json'), JSON.stringify(names.map((n) => ({ file: `assets/${n}` }))));
  const before = requests.length;
  const r = await run(['--scope', 'brand', '--manifest', 'alone.json', '--concurrency', '4']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /5 file\(s\) — 5 uploaded, 0 skipped \(0 not an image\), 0 failed/);
  const puts = requests.slice(before).filter((q) => q.method === 'PUT');
  assert.equal(puts.length, 5);
  assert.ok(puts[0].url.endsWith('/slow-first.png'), `the first manifest entry is the first PUT (got ${puts[0].url})`);
  assert.equal(puts[0].inflight, 1); assert.equal(puts[0].duringSlow, false);
  assert.deepEqual(puts.slice(1).filter((q) => q.duringSlow).map((q) => q.url), [], 'no PUT arrived while the first upload was being served');
  const peak = Math.max(...puts.slice(1).map((q) => q.inflight));
  assert.ok(peak >= 2, `the remaining uploads ran concurrently (peak in-flight ${peak})`);
});

// ---- dry run, usage ----------------------------------------------------------------------------------
await check('--scope is relative to media/: a scope that starts with media/ is a usage error (the folder would double to media/media/<name>), nothing is sent', async () => {
  const before = requests.length;
  const r = await run(['--scope', 'media/hero', '--dir', 'assets']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /--scope is relative to media\//); assert.match(r.err, /media\/media\//);
  assert.equal(requests.length, before, 'no request left the process');
  allOutput.push(r.out, r.err);
});
await check('--dry-run needs no token, sends nothing, writes nothing', async () => {
  const before = requests.length; const ledgerBefore = readFileSync(LEDGER, 'utf8'); const mtime = statSync(LEDGER).mtimeMs;
  const r = await run(['--scope', 'other', '--dir', 'assets', '--dry-run'], { token: null });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^DRY assets\/a\.png -> \S+\/media\/other\/a\.png \(2048 bytes\)$/m); assert.match(r.out, /^SKIP assets\/d\.mp4 not-an-image/m);
  assert.match(r.out, /dry-run$/m); assert.doesNotMatch(r.out, /ledger/);
  assert.equal(requests.length, before); assert.equal(readFileSync(LEDGER, 'utf8'), ledgerBefore); assert.equal(statSync(LEDGER).mtimeMs, mtime);
});
await check('usage errors exit 2: missing --org/--repo/--scope, both or neither input, no DA_TOKEN, unknown flag, bad dir/manifest/scope', async () => {
  const bad = async (args, re, opts) => { const r = await run(args, opts); assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, re); };
  const p = spawn(process.execPath, [SCRIPT, '--repo', REPO, '--scope', 's', '--dir', 'assets'], { cwd: proj, env: { ...process.env, DA_TOKEN: TOKEN } });
  const noOrg = await new Promise((resolve) => { let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => resolve({ code, err })); });
  assert.equal(noOrg.code, 2); assert.match(noOrg.err, /--org is required/); allOutput.push(noOrg.err);
  await bad(['--scope', 's', '--dir', 'assets', '--manifest', 'manifest.json'], /exactly one of --dir or --manifest/);
  await bad(['--scope', 's'], /exactly one of --dir or --manifest/);
  await bad(['--dir', 'assets'], /--scope is required/);
  await bad(['--scope', 's', '--dir', 'assets'], /DA_TOKEN is not set/, { token: null });
  await bad(['--scope', 's', '--dir', 'assets', '--bogus'], /unknown argument --bogus/);
  await bad(['--scope', 's', '--dir', 'no-such-dir'], /is not a directory/);
  await bad(['--scope', 's', '--manifest', 'no-such.json'], /cannot read manifest/);
  writeFileSync(join(proj, 'empty.json'), '[]'); await bad(['--scope', 's', '--manifest', 'empty.json'], /lists no entries/);
  await bad(['--scope', '../escape', '--dir', 'assets'], /--scope must be a path segment/);
  await bad(['--scope', 's', '--dir', 'assets', '--concurrency', '0'], /--concurrency needs a number ≥ 1/);
  // a value flag swallows nothing: followed by another --flag or by the end of the line it is a usage error naming the flag
  await bad(['--scope', '--dir', 'assets'], /--scope needs a value \(got --dir\)/);
  await bad(['--scope', 's', '--dir', 'assets', '--ledger', '--dry-run'], /--ledger needs a value \(got --dry-run\)/);
  await bad(['--scope', 's', '--dir'], /--dir needs a value$/m);
  await bad(['--scope', 's', '--dir', 'assets', '--concurrency', '--retries', '2'], /--concurrency needs a value \(got --retries\)/);
  const help = await run(['--help']); assert.equal(help.code, 0); assert.match(help.out, /Usage: DA_TOKEN=… node da-media-upload\.mjs/);
});
await check('the token value never appears in any stdout or stderr', () => {
  assert.ok(allOutput.length > 10);
  for (const s of allOutput) for (const secret of SECRETS) assert.ok(!s.includes(secret), `token leaked: ${s.slice(0, 200)}`);
  assert.ok(!readFileSync(LEDGER, 'utf8').includes(EXPIRED_JWT) && !readFileSync(LEDGER, 'utf8').includes(FUTURE_JWT));
});

server.close();
rmSync(proj, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nda-media-upload: all checks passed');
process.exit(failed ? 1 : 0);
