#!/usr/bin/env node
// Smoke: skills/rollout/scripts/media-reconcile.mjs tree mode + the pre-PUT SVG/raster classes
// (T27.4) and skills/deploy/scripts/rasterise-svg.mjs, against deploy's in-process mock-da.mjs.
//
// Why: a 409 at preview names no asset — the stage that names it BEFORE the PUT is a gate
// (exit 1 blocks the PUT), so its classes need an input in the repo. Cases:
//   (1) 45 KB pure-vector SVG served gzip with a small content-length → svg-oversize (GET, not HEAD)
//   (2) 8 KB SVG embedding data:image/png → svg-raster       (3) text/html 200 at a .svg URL → svg-invalid
//   (4) clean SVG + PNG → keep                                (5) 404 → omit; 503 → unresolved, untouched under --apply
//   (6) 403 to a plain UA / 200 to a browser UA → keep        (7) content.da.live src → da-hosted, never fetched
//   (8) 151 / 201 <img> → doc-images P2 / P1 (--max-images moves the cap)
//   (9) maxresdefault poster 404 + hqdefault 200 → rewrite    (10) second run → 0 CDN requests (media-probe.json)
//   (11) --apply --rasterise --extract-raster + a pre-filled override map: PNG PUT once, references
//        rewritten; rasterise-svg refuses an HTML body (exit 1); the Playwright render case runs only
//        when STARDUST_PW_ROOT resolves playwright (else SKIP line)
//   (12) exit 1 iff a blocking class remains; the clean tree exits 0; raster >1 MB advisory, >10 MB blocks
//        unless --allow-large-raster
//   (13) NEGATIVE: --allow-large-raster with --cache, then a re-run WITHOUT the flag on the same cache →
//        raster-oversize, exit 1 (the escape lasts one run; the cache keeps the undowngraded class)
//   (14) NEGATIVE: --apply never rewrites an unchanged file (mtime stays)
//
// Usage: node plugins/stardust/evals/lint/media-preflight-smoke.mjs  (exit 1 on findings)
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { startMock } from '../../skills/deploy/scripts/test/mock-da.mjs';

const HERE = import.meta.dirname;
const RECONCILE = join(HERE, '..', '..', 'skills', 'rollout', 'scripts', 'media-reconcile.mjs');
const RASTERISE = join(HERE, '..', '..', 'skills', 'deploy', 'scripts', 'rasterise-svg.mjs');
const FIX = join(HERE, 'fixtures', 'media-preflight');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const mock = await startMock();
const CDN = mock.base.replace(/^http:\/\//, '');
const cdnUrl = (n) => `http://${CDN}/cdn/${n}`;
const png = readFileSync(join(FIX, 'ok.png'));
const bigSvg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${'<path d="M0 0 L100 100 Z" fill="#123456"/>'.repeat(1200)}</svg>`; // ~45 KB, pure vector
const assets = {
  'big.svg': { status: 200, body: gzipSync(Buffer.from(bigSvg)), headers: { 'content-type': 'image/svg+xml', 'content-encoding': 'gzip' } },
  'raster.svg': { status: 200, body: readFileSync(join(FIX, 'raster.svg')), headers: { 'content-type': 'image/svg+xml' } },
  'bad.svg': { status: 200, body: Buffer.from('<!doctype html><html><body>Asset not found</body></html>'), headers: { 'content-type': 'text/html' } },
  'clean.svg': { status: 200, body: readFileSync(join(FIX, 'clean.svg')), headers: { 'content-type': 'image/svg+xml' } },
  'ok.png': { status: 200, body: png, headers: { 'content-type': 'image/png' } },
  'gone.png': { status: 404, body: 'gone' },
  'flaky.png': { status: 503, body: 'busy' },
  'large.jpg': { status: 200, body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1020)]), headers: { 'content-type': 'image/jpeg' }, total: 2 * 1024 * 1024 },
  'huge.jpg': { status: 200, body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1020)]), headers: { 'content-type': 'image/jpeg' }, total: 11 * 1024 * 1024 },
  'vi/abc/maxresdefault.jpg': { status: 404, body: 'no maxres' },
  'vi/abc/hqdefault.jpg': { status: 200, body: png, headers: { 'content-type': 'image/jpeg' } },
  'clip.mp4': { status: 200, body: Buffer.alloc(4096), headers: { 'content-type': 'video/mp4' } },
};
mock.rules.cdn = (name, headers) => {
  if (name === 'walled.jpg') return /Mozilla/.test(headers['user-agent'] || '') ? { status: 200, body: png, headers: { 'content-type': 'image/jpeg' } } : { status: 403, body: 'bot wall' };
  return assets[name] || { status: 404, body: 'no such fixture' };
};
assert(bigSvg.length > 40000, `fixture: big.svg must exceed 40,000 raw bytes (got ${bigSvg.length})`);
function assert(ok, msg) { if (!ok) { console.error(`media-preflight-smoke: ${msg}`); process.exit(1); } }

const T = mkdtempSync(join(tmpdir(), 'media-preflight-smoke-'));
const seed = (name) => { const dir = join(T, name); cpSync(join(FIX, name), dir, { recursive: true }); for (const f of walk(dir)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__CDN__', CDN)); return dir; };
function walk(d) { return readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []; }); }
const cdnHits = () => mock.requests.filter((r) => r.url.startsWith('/cdn/')).length;
const mediaPuts = () => mock.requests.filter((r) => r.method === 'PUT' && /\/media\//.test(r.url));
// HOME is redirected so no real .env is read; Playwright's browser cache stays where the runner host keeps it
const BROWSERS = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
// the mock lives in this process: spawn async so it can answer
const run = (script, args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [script, ...args], { cwd: T, env: { ...process.env, HOME: T, PLAYWRIGHT_BROWSERS_PATH: BROWSERS, DA_TOKEN: 'x', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[smoke] TIMEOUT'; }, 60000);
  c.on('close', (status) => { clearTimeout(t); let json = null; try { json = JSON.parse(stdout); } catch { /* text mode */ } resolve({ status, stdout, stderr, json }); });
});
const cls = (j, u) => (j.results.find((r) => r.url === u) || {}).decision;

// ---- run 1: classes over the tree -------------------------------------------------------
const content = seed('content');
const cache = join(T, 'probe.json');
const r1 = await run(RECONCILE, ['--content', content, '--cache', cache, '--json']);
check(r1.status === 1, `run1: expected exit 1 (blocking classes), got ${r1.status}\n${r1.stderr}`);
const j1 = r1.json || { results: [] };
check(cls(j1, cdnUrl('big.svg')) === 'svg-oversize', `(1) gzip 45 KB svg → svg-oversize, got ${cls(j1, cdnUrl('big.svg'))}`);
check(cls(j1, cdnUrl('raster.svg')) === 'svg-raster', `(2) data:image svg → svg-raster, got ${cls(j1, cdnUrl('raster.svg'))}`);
check(cls(j1, cdnUrl('bad.svg')) === 'svg-invalid', `(3) html at .svg → svg-invalid, got ${cls(j1, cdnUrl('bad.svg'))}`);
check(cls(j1, cdnUrl('clean.svg')) === 'keep' && cls(j1, cdnUrl('ok.png')) === 'keep', '(4) clean svg + png → keep');
check(cls(j1, cdnUrl('gone.png')) === 'omit', `(5) 404 → omit, got ${cls(j1, cdnUrl('gone.png'))}`);
check(cls(j1, cdnUrl('flaky.png')) === 'unresolved', `(5) 503 → unresolved, got ${cls(j1, cdnUrl('flaky.png'))}`);
check(cls(j1, cdnUrl('walled.jpg')) === 'keep', `(6) 403 plain / 200 browser UA → keep, got ${cls(j1, cdnUrl('walled.jpg'))}`);
check(cls(j1, 'https://content.da.live/o/r/media/site/hosted.png') === 'da-hosted', '(7) content.da.live → da-hosted');
check(cls(j1, cdnUrl('large.jpg')) === 'raster-large', `(12) 2 MB raster → raster-large advisory, got ${cls(j1, cdnUrl('large.jpg'))}`);
check(cls(j1, cdnUrl('huge.jpg')) === 'raster-oversize', `(12) 11 MB raster → raster-oversize, got ${cls(j1, cdnUrl('huge.jpg'))}`);
const poster = j1.results.find((r) => r.url === cdnUrl('vi/abc/maxresdefault.jpg'));
check(poster && poster.decision === 'rewrite' && poster.suggested === cdnUrl('vi/abc/hqdefault.jpg'), `(9) maxres 404 → rewrite to hqdefault, got ${JSON.stringify(poster)}`);
check(cls(j1, cdnUrl('clip.mp4')) === 'keep', '(9) ranged GET on the mp4 → keep');
const svgReqs = mock.requests.filter((r) => r.url === '/cdn/big.svg');
check(svgReqs.length === 1 && svgReqs[0].method === 'GET' && !svgReqs[0].range, `(1)/(10) the svg is fetched once, in full, by GET (got ${JSON.stringify(svgReqs)})`);
check(mock.requests.filter((r) => r.url === '/cdn/ok.png').length === 1, '(10) an asset shared by two documents is probed once');
check(mock.requests.filter((r) => r.url === '/cdn/ok.png' && r.range === 'bytes=0-1023').length === 1, 'rasters are probed with a ranged GET');
check(!mock.requests.some((r) => /hosted\.png/.test(r.url)), '(7) 0 requests for the da-hosted asset');
check(existsSync(cache) && JSON.parse(readFileSync(cache, 'utf8'))[cdnUrl('big.svg')].class === 'svg-oversize', '(10) media-probe cache written with the class');
const files1 = walk(content).map((f) => readFileSync(f, 'utf8')).join('');
check(files1.includes('gone.png') && files1.includes('flaky.png'), 'run1 without --apply changes nothing');

// ---- run 2: zero CDN hits from the cache; --apply leaves unresolved untouched -------------
const before = cdnHits();
const r2 = await run(RECONCILE, ['--content', content, '--cache', cache, '--apply', '--json']);
check(cdnHits() === before, `(10) second run makes 0 CDN requests (made ${cdnHits() - before})`);
check(r2.status === 1, `run2 --apply: exit 1 while svg classes remain, got ${r2.status}`);
const idx2 = readFileSync(join(content, 'index.html'), 'utf8');
check(!idx2.includes('gone.png'), '(5) --apply removes the 404 <img>');
check(idx2.includes('flaky.png'), '(5) --apply leaves the unresolved (503) <img> untouched');
check(readFileSync(join(content, 'news', 'a.html'), 'utf8').includes('vi/abc/hqdefault.jpg'), '(9) --apply rewrites the poster to hqdefault');

// ---- run 3: --apply --rasterise --extract-raster with a pre-filled map ---------------------
const map = join(T, 'overrides.json');
writeFileSync(map, JSON.stringify({ [cdnUrl('big.svg')]: { png: 'https://content.da.live/o/r/media/svg/big-prerendered.png', bytes: 1, w: 1, h: 1, at: 'x' } }));
const putsBefore = mediaPuts().length;
const r3 = await run(RECONCILE, ['--content', content, '--cache', cache, '--apply', '--rasterise', '--extract-raster', '--org', 'o', '--repo', 'r', '--override-map', map, '--json']);
check(r3.status === 1, `run3: bad.svg (svg-invalid) still blocks → exit 1, got ${r3.status}\n${r3.stderr}`);
const puts = mediaPuts().slice(putsBefore);
check(puts.length === 1 && /^\/da\/o\/r\/media\/svg\/raster-[0-9a-f]{8}\.png$/.test(puts[0].url), `(11) exactly one media PUT for the raster svg (got ${JSON.stringify(puts.map((p) => p.url))})`);
check(puts.length === 1 && Buffer.compare(mock.media[puts[0].url.replace(/^\/da\/o\/r/, '')], Buffer.from(readFileSync(join(FIX, 'raster.svg'), 'utf8').match(/base64,([^"]+)/)[1], 'base64')) === 0, '(11) the PUT body is the embedded PNG, byte-identical (extract-raster)');
const map3 = JSON.parse(readFileSync(map, 'utf8'));
check(map3[cdnUrl('raster.svg')] && map3[cdnUrl('raster.svg')].via === 'extract-raster' && map3[cdnUrl('raster.svg')].w === 4, `(11) override map gains the raster.svg row (got ${JSON.stringify(map3[cdnUrl('raster.svg')])})`);
const all3 = walk(content).map((f) => readFileSync(f, 'utf8')).join('\n');
check(!all3.includes('/cdn/big.svg') && (all3.match(/big-prerendered\.png/g) || []).length === 2, '(11) both references to big.svg rewritten from the pre-filled map');
check(!all3.includes('/cdn/raster.svg') && all3.includes(map3[cdnUrl('raster.svg')] && map3[cdnUrl('raster.svg')].png), '(11) raster.svg reference rewritten to the PUT PNG');
check(all3.includes('/cdn/bad.svg'), '(11) svg-invalid is never rasterised — the reference stays for the owner');
check(!r3.stderr.includes('big.svg'), '(11) a mapped svg is not re-rendered');
// rasterise-svg standalone: refuses the HTML body; exit 3 on a DA 401 (HaltError, never a retry)
const rBad = await run(RASTERISE, ['--svg', cdnUrl('bad.svg'), '--org', 'o', '--repo', 'r', '--override-map', map]);
check(rBad.status === 1 && /not an SVG/.test(rBad.stderr), `(11) rasterise-svg exits 1 on an HTML body, got ${rBad.status} ${rBad.stderr}`);
mock.rules.mediaStatus = () => 401;
const r401 = await run(RASTERISE, ['--svg', cdnUrl('clean.svg'), '--org', 'o', '--repo', 'r', '--from-png', join(FIX, 'ok.png'), '--override-map', map]);
check(r401.status === 3 && /HALT/.test(r401.stderr), `rasterise-svg exits 3 on a DA 401 (got ${r401.status} ${r401.stderr})`);
mock.rules.mediaStatus = () => 201;
const putsBeforeDry = mediaPuts().length;
const rDry = await run(RASTERISE, ['--svg', cdnUrl('clean.svg'), '--org', 'o', '--repo', 'r', '--from-png', join(FIX, 'ok.png'), '--override-map', map, '--dry']);
check(rDry.status === 0 && mediaPuts().length === putsBeforeDry && JSON.parse(readFileSync(map, 'utf8'))[cdnUrl('clean.svg')].dry === true, `rasterise-svg --dry PUTs nothing and marks the map row dry (got ${rDry.status} ${rDry.stderr})`);
// Playwright render half — only when the eval runner's node_modules resolve it
let pwOk = false;
if (process.env.STARDUST_PW_ROOT) { try { createRequire(join(process.env.STARDUST_PW_ROOT, 'package.json')).resolve('playwright'); pwOk = true; } catch { pwOk = false; } }
if (pwOk) {
  const rPw = await run(RASTERISE, ['--svg', cdnUrl('clean.svg'), '--org', 'o', '--repo', 'r', '--override-map', map, '--out', join(T, 'clean.png')]);
  const row = JSON.parse(readFileSync(map, 'utf8'))[cdnUrl('clean.svg')];
  check(rPw.status === 0 && row && row.via === 'render' && row.w === 240 && row.h === 80, `render: 120×40 svg at ×2 → 240×80 PNG on DA (got ${rPw.status} ${JSON.stringify(row)} ${rPw.stderr})`);
} else console.log('media-preflight-smoke: SKIP Playwright render case (STARDUST_PW_ROOT does not resolve playwright) — extract-raster and --from-png paths ran');

// ---- (8) document caps, (12) clean tree exit 0, --allow-large-raster ---------------------
const caps = join(T, 'caps'); mkdirSync(caps, { recursive: true });
const many = (n) => `<body><header></header><main><div><h1>x</h1>${`<p><img src="${cdnUrl('ok.png')}" alt=""></p>`.repeat(n)}</div></main><footer></footer></body>`;
writeFileSync(join(caps, 'p2.html'), many(151)); writeFileSync(join(caps, 'p1.html'), many(201));
const rc = await run(RECONCILE, ['--content', caps, '--cache', cache, '--json']);
const doc = (f) => (rc.json ? rc.json.results.find((r) => r.decision === 'doc-images' && r.url.endsWith(f)) : null) || {};
check(doc('p2.html').severity === 'P2' && doc('p1.html').severity === 'P1' && rc.status === 1, `(8) 151 → P2, 201 → P1 (blocks), got ${doc('p2.html').severity}/${doc('p1.html').severity} exit ${rc.status}`);
const rc2 = await run(RECONCILE, ['--content', caps, '--cache', cache, '--max-images', '250']);
check(rc2.status === 0 && /cap moved to 250/.test(rc2.stdout), `(8) --max-images 250 lifts the P1 cap for the run (exit ${rc2.status})`);
const clean = seed('clean');
const rClean = await run(RECONCILE, ['--content', clean, '--cache', cache]);
check(rClean.status === 0, `(12) clean tree exits 0, got ${rClean.status}\n${rClean.stdout}`);
const rAllow = await run(RECONCILE, ['--file', join(content, 'index.html'), '--cache', cache, '--allow-large-raster', '--no-cache', '--json']);
check(rAllow.json && cls(rAllow.json, cdnUrl('huge.jpg')) === 'raster-large', '(12) --allow-large-raster turns raster-oversize into the advisory');
const rUsage = await run(RECONCILE, ['--content']);
check(rUsage.status === 2, `usage: bare --content exits 2, got ${rUsage.status}`);

// ---- (13) the --allow-large-raster escape never persists through the cache ------------------
const hugeTree = join(T, 'huge'); mkdirSync(hugeTree, { recursive: true });
writeFileSync(join(hugeTree, 'index.html'), `<body><header></header><main><div><h1>x</h1><p><img src="${cdnUrl('huge.jpg')}" alt=""></p></div></main><footer></footer></body>`);
const hugeCache = join(T, 'huge-probe.json');
const rA1 = await run(RECONCILE, ['--content', hugeTree, '--cache', hugeCache, '--allow-large-raster', '--json']);
check(rA1.status === 0 && rA1.json && cls(rA1.json, cdnUrl('huge.jpg')) === 'raster-large', `(13) run with the flag: raster-large, exit 0 (got ${rA1.status} ${rA1.json && cls(rA1.json, cdnUrl('huge.jpg'))})`);
check(existsSync(hugeCache) && JSON.parse(readFileSync(hugeCache, 'utf8'))[cdnUrl('huge.jpg')].class === 'raster-oversize', '(13) the cache stores the undowngraded class raster-oversize');
const hitsA = cdnHits();
const rA2 = await run(RECONCILE, ['--content', hugeTree, '--cache', hugeCache, '--json']);
check(cdnHits() === hitsA, `(13) the re-run reads the cache (made ${cdnHits() - hitsA} CDN requests)`);
check(rA2.status === 1 && rA2.json && cls(rA2.json, cdnUrl('huge.jpg')) === 'raster-oversize', `(13) re-run WITHOUT the flag on the same cache: raster-oversize, exit 1 (got ${rA2.status} ${rA2.json && cls(rA2.json, cdnUrl('huge.jpg'))})`);
const rA3 = await run(RECONCILE, ['--content', hugeTree, '--cache', hugeCache, '--allow-large-raster']);
check(rA3.status === 0 && /read as the advisory for this run only/.test(rA3.stdout), '(13) the flag prints its reason on every run it applies to');

// ---- (14) --apply leaves an unchanged file untouched (mtime) ---------------------------------
const cleanIdx = join(clean, 'index.html'); const old = new Date('2020-01-01T00:00:00Z'); utimesSync(cleanIdx, old, old);
const rApplyClean = await run(RECONCILE, ['--content', clean, '--cache', cache, '--apply']);
check(rApplyClean.status === 0 && statSync(cleanIdx).mtimeMs === old.getTime(), `(14) --apply on an unchanged file keeps its mtime (exit ${rApplyClean.status}, mtime ${statSync(cleanIdx).mtime.toISOString()})`);

await mock.close();
rmSync(T, { recursive: true, force: true });
if (failures.length) { console.error(`media-preflight-smoke: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log(`media-preflight-smoke: ok (14 cases · svg-oversize/raster/invalid, caps, poster ladder, cache 0-hit re-run, extract-raster PUT once, exit 1 iff blocking, --allow-large-raster one run only, --apply mtime)`);
