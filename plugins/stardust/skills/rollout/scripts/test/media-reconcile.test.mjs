#!/usr/bin/env node
// skills/rollout/scripts/test/media-reconcile.test.mjs — the media-reconcile.mjs contract: a URL on
// the site's content host (content|admin.da.live) is `hosted` — never fetched anonymously, verified
// offline against the media ledger (exact, query-stripped and re-encoded forms; missing from an
// existing ledger fails the gate, no ledger passes with a NOTE, a ledger that will not load exits
// 2) — while optimize / keep / rewrite / omit and --apply behave as before. Anonymous fetches go
// to a local HTTP server; nothing reaches the network.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'media-reconcile.mjs');
// realpath: the script prints process.cwd()-based paths, which are already resolved.
const BASE = realpathSync(mkdtempSync(join(tmpdir(), 'media-reconcile-test-')));

// Every anonymous GET the script makes lands here (200 for /ok.jpg, 404 otherwise) and is
// recorded in `seen` — a hosted URL must never show up, and must never leave for the network.
const seen = [];
const server = createServer((req, res) => {
  seen.push(req.url);
  if (req.url === '/ok.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end('jpg'); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const HOST = `127.0.0.1:${server.address().port}`;
const EXT = `http://${HOST}`;
after(() => {
  server.closeAllConnections(); server.close(); rmSync(BASE, { recursive: true, force: true });
});

// The script fetches asynchronously, so it must run asynchronously too — spawnSync would block
// the event loop this server answers on.
const run = (args, cwd) => new Promise((done) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => done({ code, out, err }));
});
const jsonOf = (r) => JSON.parse(r.out);
const rowsOf = (r) => Object.fromEntries(jsonOf(r).results.map((x) => [x.url, x]));
const project = () => mkdtempSync(join(BASE, 'p-'));
const img = (src) => `<img src="${src}" alt="">`;
const page = (dir, body, name = 'page.html') => {
  const p = join(dir, name); writeFileSync(p, `<main>\n${body.join('\n')}\n</main>\n`); return p;
};

// A media ledger as the deploy step writes it: keyed by DA path, contentUrl with each path
// segment encodeURIComponent()ed, status 'uploaded' on success.
const SITE = 'site.example.org';
const CDN = 'https://content.da.live/acme/site/media/home';
const rec = (name, extra = {}) => ({
  status: 'uploaded', file: `media/home/${name}`, size: 3, sha256: 'abc', contentType: 'image/jpeg',
  source: null, contentUrl: `${CDN}/${name}`, httpStatus: 201, ts: '2026-01-01T00:00:00.000Z', ...extra,
});
const LEDGER = {
  'media/home/hero.jpg': rec('hero.jpg'),
  'media/home/team photo.jpg': rec('team%20photo.jpg'),
  'media/home/café.jpg': rec('café.jpg'), // a decoded contentUrl (another tool's ledger)
  'media/home/failed.jpg': rec('failed.jpg', { status: 'failed', error: 'PUT 500' }),
};
const writeLedger = (dir, rel, data) => {
  const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); return p;
};

test('hosted URLs in the ledger (exact, ?width=750, srcset with &, decoded/encoded segments) pass offline', async () => {
  const dir = project(); seen.length = 0;
  const ledger = writeLedger(dir, 'ledger.json', LEDGER);
  const hosted = [`${CDN}/hero.jpg`, `${CDN}/hero.jpg?width=750`, `${CDN}/team photo.jpg`, `${CDN}/caf%C3%A9.jpg`];
  const file = page(dir, [
    img(`https://${SITE}/media_1.png`), ...hosted.map(img), img(`${EXT}/ok.jpg`),
    `<picture><source srcset="${CDN}/hero.jpg?width=2000&format=webply 2000w">${img(`${CDN}/hero.jpg`)}</picture>`,
  ]);
  const r = await run(['--file', file, '--deploy-host', SITE, '--media-ledger', ledger, '--json'], dir);
  assert.equal(r.code, 0, r.err + r.out);
  const j = jsonOf(r);
  assert.deepEqual(j.counts, { optimize: 1, hosted: 5, keep: 1 });
  assert.equal(j.mediaLedger, ledger);
  for (const row of j.results.filter((x) => x.decision === 'hosted')) {
    assert.equal(row.status, null, `${row.url} was never fetched`); assert.equal(row.ledger, 'uploaded', row.url);
    assert.equal(row.host, 'content.da.live'); assert.equal(row.suggested, null);
  }
  assert.equal(rowsOf(r)[`https://${SITE}/media_1.png`].ledger, null, 'non-hosted rows carry ledger: null');
  assert.deepEqual(seen, ['/ok.jpg'], 'the server saw only the external URL');
  assert.equal(r.err, '', 'no NOTE when a ledger was loaded');
});

test('a hosted URL absent from an existing ledger (or not uploaded) fails the gate with a marker; --apply leaves it', async () => {
  const dir = project(); seen.length = 0;
  const ledger = writeLedger(dir, 'ledger.json', LEDGER);
  const body = [img(`${CDN}/hero.jpg`), img(`${CDN}/orphan.jpg`), img(`${CDN}/failed.jpg?width=750`)];
  const file = page(dir, body); const before = readFileSync(file, 'utf8');
  const text = await run(['--file', file, '--deploy-host', SITE, '--media-ledger', ledger], dir);
  assert.equal(text.code, 1, text.out);
  assert.match(text.out, /^ {2}✓ hosted {3}https:\/\/content\.da\.live\/acme\/site\/media\/home\/hero\.jpg$/m, text.out);
  assert.match(text.out, /^ {2}✗ hosted {3}\S+\/orphan\.jpg \(not in ledger\)$/m, text.out);
  assert.match(text.out, /^ {2}✗ hosted {3}\S+\/failed\.jpg\?width=750 \(not in ledger\)$/m, text.out);
  assert.match(text.out, /^3 hosted$/m, 'the summary counts hosted');
  const rows = rowsOf(await run(['--file', file, '--deploy-host', SITE, '--media-ledger', ledger, '--json'], dir));
  assert.equal(rows[`${CDN}/hero.jpg`].ledger, 'uploaded');
  assert.equal(rows[`${CDN}/orphan.jpg`].ledger, 'missing');
  assert.equal(rows[`${CDN}/failed.jpg?width=750`].ledger, 'missing', 'a failed upload is not an upload');
  const applied = await run(['--file', file, '--media-ledger', ledger, '--apply'], dir);
  assert.equal(applied.code, 1); assert.equal(readFileSync(file, 'utf8'), before, '--apply never touches hosted');
  assert.deepEqual(seen, [], 'nothing was fetched');
});

test('no ledger file and no flag: hosted rows pass as no-ledger with one stderr NOTE naming the auto path', async () => {
  const dir = project(); seen.length = 0;
  page(dir, [img(`${CDN}/hero.jpg`), img(`https://${SITE}/media_1.png`)]);
  const r = await run(['--file', 'page.html', '--deploy-host', SITE, '--json'], dir);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(jsonOf(r).mediaLedger, null);
  assert.equal(rowsOf(r)[`${CDN}/hero.jpg`].ledger, 'no-ledger');
  assert.equal(rowsOf(r)[`${CDN}/hero.jpg`].status, null);
  const auto = join(dir, 'stardust', 'deploy', 'media-ledger.json');
  assert.equal(r.err.trim(), `media-reconcile: no media ledger at ${auto} — hosted URLs are unverified (pass --media-ledger <file>)`);
  assert.deepEqual(seen, []);
  page(dir, [img(`https://${SITE}/a.png`)], 'page2.html');
  const quiet = await run(['--file', 'page2.html', '--deploy-host', SITE], dir);
  assert.equal(quiet.code, 0); assert.equal(quiet.err, '', 'no NOTE when the page has no hosted URL');
});

test('the ledger is auto-detected at <cwd>/stardust/deploy/media-ledger.json without the flag', async () => {
  const dir = project(); seen.length = 0;
  const auto = writeLedger(dir, join('stardust', 'deploy', 'media-ledger.json'), LEDGER);
  page(dir, [img(`${CDN}/hero.jpg`), img(`${CDN}/orphan.jpg`)]);
  const r = await run(['--file', 'page.html', '--deploy-host', SITE, '--json'], dir);
  assert.equal(r.code, 1, r.out);
  assert.equal(jsonOf(r).mediaLedger, auto);
  assert.equal(rowsOf(r)[`${CDN}/hero.jpg`].ledger, 'uploaded');
  assert.equal(rowsOf(r)[`${CDN}/orphan.jpg`].ledger, 'missing');
  assert.equal(r.err, '', 'no NOTE when the auto-detected ledger loads');
});

test('an explicit --media-ledger that is missing, invalid or dangling exits 2 with one stderr line; nothing written', async () => {
  const dir = project(); seen.length = 0;
  const file = page(dir, [img(`${CDN}/hero.jpg`), img(`${EXT}/gone.jpg`)]); const before = readFileSync(file, 'utf8');
  const missing = await run(['--file', file, '--media-ledger', join(dir, 'nope.json'), '--apply'], dir);
  assert.equal(missing.code, 2); assert.equal(missing.out, '');
  assert.equal(missing.err.trim().split('\n').length, 1, missing.err);
  assert.match(missing.err, /media-reconcile: media ledger \S+\/nope\.json: not found/);
  const bad = writeLedger(dir, 'bad.json', '{ not json');
  const invalid = await run(['--file', file, '--media-ledger', bad, '--apply'], dir);
  assert.equal(invalid.code, 2); assert.equal(invalid.out, '');
  assert.equal(invalid.err.trim().split('\n').length, 1, invalid.err);
  assert.match(invalid.err, /media-reconcile: media ledger \S+\/bad\.json: /);
  const dangling = await run(['--file', file, '--media-ledger'], dir);
  assert.equal(dangling.code, 2); assert.match(dangling.err, /--media-ledger needs <file>/);
  assert.equal(readFileSync(file, 'utf8'), before, 'the page is untouched');
  assert.deepEqual(seen, [], 'exit 2 happens before any fetch');
  assert.deepEqual(readdirSync(dir).sort(), ['bad.json', 'page.html']);
});

test('an auto-detected ledger that will not parse also exits 2 — a corrupt ledger is a defect, not a pass', async () => {
  const dir = project();
  writeLedger(dir, join('stardust', 'deploy', 'media-ledger.json'), '[oops');
  page(dir, [img(`${CDN}/hero.jpg`)]);
  const r = await run(['--file', 'page.html', '--json'], dir);
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.match(r.err, /media-reconcile: media ledger \S+\/media-ledger\.json: /);
});

test('ledger shapes: an entries wrapper or a bare array are read too; only status uploaded counts', async () => {
  const dir = project();
  const file = page(dir, [img(`${CDN}/hero.jpg`), img(`${CDN}/failed.jpg`)]);
  const shapes = [{ entries: [rec('hero.jpg'), rec('failed.jpg', { status: 'failed' })] }, [rec('hero.jpg')]];
  for (const shape of shapes) {
    const ledger = writeLedger(dir, 'ledger.json', shape);
    const rows = rowsOf(await run(['--file', file, '--media-ledger', ledger, '--json'], dir));
    assert.equal(rows[`${CDN}/hero.jpg`].ledger, 'uploaded'); assert.equal(rows[`${CDN}/failed.jpg`].ledger, 'missing');
  }
});

test('regression + --apply: optimize / keep [200] / rewrite / omit [404] as before; omit removed, hosted intact', async () => {
  const dir = project(); seen.length = 0;
  const ledger = writeLedger(dir, 'ledger.json', LEDGER);
  const hostedImg = img(`${CDN}/hero.jpg?width=750`); const sameImg = img(`https://${SITE}/media_1.png`);
  const file = page(dir, [sameImg, img(`${EXT}/ok.jpg`), img(`${EXT}/gone.jpg`), img(`${EXT}/moved.jpg`), hostedImg]);
  const r = await run(['--file', file, '--deploy-host', SITE, '--media-ledger', ledger, '--apply',
    '--host-rewrite', `${HOST}/moved=${HOST}/ok`], dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^media-reconcile \S+\/page\.html \(APPLIED\)$/m);
  assert.match(r.out, /^ {2}✓ optimize https:\/\/site\.example\.org\/media_1\.png$/m, r.out);
  assert.match(r.out, /^ {2}✓ keep {5}\[200\] http:\/\/127\.0\.0\.1:\d+\/ok\.jpg$/m, r.out);
  assert.match(r.out, /^ {2}✗ omit {5}\[404\] http:\/\/127\.0\.0\.1:\d+\/gone\.jpg$/m, r.out);
  assert.match(r.out, /^ {2}→ rewrite {2}\[200\] http:\/\/127\.0\.0\.1:\d+\/moved\.jpg\n +→ http:\/\/127\.0\.0\.1:\d+\/ok\.jpg$/m, r.out);
  assert.match(r.out, /^ {2}✓ hosted {3}https:\/\/content\.da\.live\/\S+\/hero\.jpg\?width=750$/m, r.out);
  assert.match(r.out, /^1 optimize · 1 keep · 1 omit · 1 rewrite · 1 hosted$/m, r.out);
  const doc = readFileSync(file, 'utf8');
  assert.ok(!doc.includes('gone.jpg'), 'the omitted <img> is gone');
  assert.ok(!doc.includes('moved.jpg') && doc.split('/ok.jpg').length === 3, 'the rewrite landed');
  assert.ok(doc.includes(hostedImg), 'the hosted <img> is byte-identical');
  assert.ok(doc.includes(sameImg), 'the same-origin <img> is untouched');
  assert.deepEqual(seen.sort(), ['/gone.jpg', '/moved.jpg', '/ok.jpg', '/ok.jpg'], 'three external URLs + the repaired one');
});

test('--help: exit 0, usage names hosted, --media-ledger and the exit rule; nothing written in an empty cwd', async () => {
  const dir = project();
  const r = await run(['--help'], dir);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  assert.match(r.out, /Usage:/); assert.match(r.out, /^\s*hosted\s+— on the site's content host/m);
  assert.match(r.out, /--media-ledger <file>/);
  assert.match(r.out, /exit 1 on omit, unresolved,\s+or a hosted URL missing from the ledger/);
  assert.deepEqual(readdirSync(dir), []);
});
