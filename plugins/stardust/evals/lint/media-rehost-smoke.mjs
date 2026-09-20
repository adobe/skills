#!/usr/bin/env node
// Smoke: skills/deploy/scripts/rehost-media.mjs (T27.5) against deploy's in-process mock-da.mjs,
// plus the two advisory rows that ride with it — delivery-lint `hotlinked-media` P2 and verify's
// `hotlinked image` class (never a FAIL).
//
// Why: the pass writes DA media and rewrites authored pages, so its ledger, its rewrite and its
// exit contract need an input in the repo. Cases:
//   (1) ledger stardust/da-media.json written with { da, url, sha1, bytes, type, width, height, status, at };
//       a second run makes 0 CDN and 0 DA requests
//   (2) only 2xx image bytes are PUT (field `data`) and rewritten to content.da.live/<org>/<repo>/media/<scope>/<file>
//   (3) 404 → dead, the <img> stays              (4) 200 text/html → not-image, never uploaded
//   (5) `Foo (1)%40x2.jpg` → foo-1-40x2-<sha8>.jpg (6) --dry → no PUT, files byte-identical
//   (7) policy keep (from state.json media.policy): the plain-200 png is `kept`, the 403-to-plain-UA
//       jpeg is still rehosted (a 403'd hotlink is never shippable)
//   (8) exit 1 while blocked | dead | not-image remain, 0 otherwise; a DA 401 on the PUT exits 3 (HaltError)
//   (9) delivery-lint --source-host → P2 hotlinked-media on a source-host <img>; silent with
//       --media-policy keep and on a content.da.live src
//   (10) verify --root: a delivered body with an external <img> → advisory class `hotlinked image`,
//        page stays verified, exit 0
//   (11) NEGATIVE: a 429 backs off once and the retry is SENT (its own timer, same accept header) —
//        REHOST_MEDIA_TIMEOUT_MS shorter than REHOST_MEDIA_BACKOFF_MS
//   (12) NEGATIVE: under the DEFAULT policy a plain-200 raster > 1 MB is acted on: a recognised CDN
//        transform host → pre-shrunk PUT (`via: cdn-transform`); no transform → `oversize`, exit 0
//   (13) NEGATIVE: a ledger `kept` row written under --policy keep is re-evaluated under rehost-all
//        (rehosted); the next rehost-all run is 0-hit again
//   (14) NEGATIVE: --only blocked rehosts the 403-to-plain-UA jpeg and keeps the > 1 MB one with the
//        note; an unknown --only token exits 2
//   (15) --technique headed-chrome: a URL that 403s every bare GET and 200s only with the origin's
//        cookie is fetched in-page (one home-document hit per origin) → rehosted, `source: in-page`;
//        without the flag it stays `blocked`; without Playwright it stays `blocked` with the preflight
//        note (browser half runs under STARDUST_PW_ROOT, else SKIP line)
//   (16) --resize: a 1.1 MB noise PNG with no CDN transform → `oversize` by default, rehosted as a
//        smaller JPEG (`via: resize`) with the flag (browser half as (15))
//
// Usage: node plugins/stardust/evals/lint/media-rehost-smoke.mjs  (exit 1 on findings)
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomFillSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { startMock } from '../../skills/deploy/scripts/test/mock-da.mjs';

const HERE = import.meta.dirname;
const REHOST = join(HERE, '..', '..', 'skills', 'deploy', 'scripts', 'rehost-media.mjs');
const LINT = join(HERE, '..', '..', 'skills', 'rollout', 'scripts', 'delivery-lint.mjs');
const VERIFY = join(HERE, '..', '..', 'skills', 'rollout', 'scripts', 'verify.mjs');
const FIX = join(HERE, 'fixtures', 'media-rehost');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

const mock = await startMock();
const CDN = mock.base.replace(/^http:\/\//, '');
const cdnUrl = (n) => `http://${CDN}/cdn/${n}`;
const png = readFileSync(join(HERE, 'fixtures', 'media-preflight', 'ok.png'));
// (the mock's decodeURI leaves the reserved %40 encoded — the stem rule must fold it, health-insurer note 89)
// a minimal baseline JPEG: SOI, APP0, SOF0 (8-bit, 3×5 px), EOI — enough for the sniff + the SOF dimension scan
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b080005000301011100ffd9', 'hex');
// a decodable > 1 MB PNG: random RGB scanlines do not deflate (the --resize canvas re-encode must shrink it)
function noisePng(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y += 1) randomFillSync(raw, y * (w * 3 + 1) + 1, w * 3);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const noise = noisePng(600, 600);
const bigJpeg = Buffer.concat([jpeg.subarray(0, jpeg.length - 2), Buffer.alloc(1.5 * 1024 * 1024), jpeg.subarray(-2)]); // 1.5 MB: SOF dims + padding
const slowHits = {};
mock.rules.cdn = (name, headers, search = '') => {
  const browser = /Mozilla/.test(headers['user-agent'] || '');
  switch (name) {
    case 'slow.png': slowHits[headers['user-agent']] = (slowHits[headers['user-agent']] || 0) + 1; return slowHits[headers['user-agent']] === 1 ? { status: 429, body: 'slow down', headers: { 'retry-after': '1' } } : { status: 200, body: png, headers: { 'content-type': 'image/png' } };
    case 'im/big.jpg': return /im=Resize/.test(search) ? { status: 200, body: jpeg, headers: { 'content-type': 'image/jpeg' } } : { status: 200, body: bigJpeg, headers: { 'content-type': 'image/jpeg' } };
    case 'plain/big.jpg': return { status: 200, body: bigJpeg, headers: { 'content-type': 'image/jpeg' } };
    case 'noise.png': return { status: 200, body: noise, headers: { 'content-type': 'image/png' } };
    case 'cookie.jpg': return /\bsess=1\b/.test(headers.cookie || '') ? { status: 200, body: jpeg, headers: { 'content-type': 'image/jpeg' } } : { status: 403, body: 'no session' };
    case 'ok.png': return { status: 200, body: png, headers: { 'content-type': 'image/png' } };
    case 'walled.jpg': return browser ? { status: 200, body: jpeg, headers: { 'content-type': 'image/jpeg' } } : { status: 403, body: 'bot wall' };
    case 'gone.png': return { status: 404, body: 'gone' };
    case 'fallback.jpg': return { status: 200, body: '<!doctype html><html><body>Not found</body></html>', headers: { 'content-type': 'text/html' } };
    case 'Foo (1)%40x2.jpg': return { status: 200, body: jpeg, headers: { 'content-type': 'image/jpeg' } };
    default: return { status: 404, body: `no fixture ${name}` };
  }
};
const T = mkdtempSync(join(tmpdir(), 'media-rehost-smoke-'));
function walk(d) { return readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []; }); }
const seed = (name) => { const dir = join(T, name); rmSync(dir, { recursive: true, force: true }); cpSync(join(FIX, 'content'), dir, { recursive: true }); for (const f of walk(dir)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__CDN__', CDN)); return dir; };
const one = (name, ...assets) => { const dir = join(T, name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.html'), `<body><header></header><main><div><h1>x</h1>${assets.map((a) => `<p><img src="${cdnUrl(a)}" alt=""></p>`).join('')}</div></main><footer></footer></body>`); return dir; }; // one document over named fixtures
const ledgerOf = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const rowOf = (p, n) => ledgerOf(p)[cdnUrl(n)] || {};
const withLedger = (args, p) => [...args.filter((a, i, arr) => arr[i - 1] !== '--ledger' && a !== '--ledger'), '--ledger', p];
const cdnHits = () => mock.requests.filter((r) => r.url.startsWith('/cdn/')).length;
const daHits = () => mock.requests.filter((r) => r.url.startsWith('/da/')).length;
// HOME is redirected so no real .env is read; Playwright's browser cache stays where the runner host keeps it
const BROWSERS = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
const run = (script, args, env = {}) => new Promise((resolve) => { // the mock lives in this process: spawn async so it can answer
  const c = spawn(process.execPath, [script, ...args], { cwd: T, env: { ...process.env, HOME: T, PLAYWRIGHT_BROWSERS_PATH: BROWSERS, DA_TOKEN: 'x', STARDUST_BROWSER_SLOTS: '0', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[smoke] TIMEOUT'; }, 60000);
  c.on('close', (status) => { clearTimeout(t); let json = null; try { json = JSON.parse(stdout); } catch { /* text */ } resolve({ status, stdout, stderr, json }); });
});
const ledgerPath = join(T, 'da-media.json');
const base = (content, extra = []) => ['--org', 'o', '--repo', 'r', '--scope', 'site', '--content', content, '--ledger', ledgerPath, '--captured', join(T, 'no-captured'), '--state', join(T, 'no-state.json'), '--json', ...extra];

// ---- (1)(2)(3)(4)(5)(8): rehost-all over the tree -------------------------------------------
const content = seed('content');
const r1 = await run(REHOST, base(content, ['--policy', 'rehost-all']));
check(r1.status === 1, `run1: dead + not-image remain → exit 1, got ${r1.status}\n${r1.stderr}`);
const L = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
const row = (n) => L[cdnUrl(n)] || {};
check(row('ok.png').status === 'rehosted' && row('ok.png').sha1 === sha1(png) && row('ok.png').bytes === png.length && row('ok.png').type === 'image/png' && row('ok.png').width === 2 && row('ok.png').height === 2 && /^\d{4}-/.test(row('ok.png').at) && /^https:\/\/content\.da\.live\/o\/r\/media\/site\/ok-[0-9a-f]{8}\.png$/.test(row('ok.png').url) && /\/da\/o\/r\/media\/site\/ok-[0-9a-f]{8}\.png$/.test(row('ok.png').da), `(1) ledger row shape for ok.png: ${JSON.stringify(row('ok.png'))}`);
check(row('walled.jpg').status === 'rehosted' && row('walled.jpg').source === 'browser' && row('walled.jpg').width === 3 && row('walled.jpg').height === 5, `(2) 403-plain / 200-browser jpeg rehosted from the browser fetch: ${JSON.stringify(row('walled.jpg'))}`);
check(row('gone.png').status === 'dead' && row('gone.png').http === 404, `(3) 404 → dead: ${JSON.stringify(row('gone.png'))}`);
check(row('fallback.jpg').status === 'not-image', `(4) text/html 200 → not-image: ${JSON.stringify(row('fallback.jpg'))}`);
check(L[cdnUrl('signed.jpg?token=abc&expires=1700000000')] && L[cdnUrl('signed.jpg?token=abc&expires=1700000000')].status === 'signed', '(1) signed URL recorded `signed`, not fetched');
check(!mock.requests.some((r) => /signed\.jpg/.test(r.url)), '(1) 0 requests for the signed URL');
const foo = L[cdnUrl('Foo%20(1)%40x2.jpg')] || {};
check(foo.status === 'rehosted' && /\/foo-1-40x2-[0-9a-f]{8}\.jpg$/.test(foo.url), `(5) stem sanitised to foo-1-40x2-<sha8>.jpg: ${foo.url}`);
const puts = mock.requests.filter((r) => r.method === 'PUT' && r.url.startsWith('/da/o/r/media/site/'));
check(puts.length === 3, `(2) exactly 3 media PUTs (png, walled jpeg, foo jpeg), got ${puts.map((p) => p.url).join(' ')}`);
check(puts.every((p) => p.auth === 'Bearer x'), '(2) media PUTs carry the DA bearer token');
const stored = mock.media[`/media/site/${row('ok.png').url.split('/').pop()}`];
check(stored && Buffer.compare(stored, png) === 0, '(2) the PUT body is the source bytes, byte-identical');
const all = walk(content).map((f) => readFileSync(f, 'utf8')).join('\n');
check(!all.includes('/cdn/ok.png') && (all.match(new RegExp(row('ok.png').url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2, '(2) both <img> references to ok.png rewritten to the content.da.live URL');
check(!all.includes('/cdn/walled.jpg') && all.includes(`poster="${row('walled.jpg').url}"`), '(2) the <video poster> reference is rewritten too');
check(all.includes('/cdn/gone.png'), '(3) the dead <img> is left in place (media-reconcile --apply owns omit)');
check(all.includes('/cdn/fallback.jpg 1x') && all.includes('src="http://' + CDN + '/cdn/fallback.jpg"'), '(4) not-image is neither uploaded nor rewritten');
check(all.includes('https://content.da.live/o/r/media/site/already.png'), 'a content.da.live src is skipped, never re-fetched');
check(!mock.requests.some((r) => /already\.png/.test(r.url)), '0 requests for the da-hosted asset');
check(r1.json && r1.json.counts.rehosted === 3 && r1.json.counts.dead === 1 && r1.json.counts['not-image'] === 1 && r1.json.counts.signed === 1, `(8) counts: ${JSON.stringify(r1.json && r1.json.counts)}`);
// second run: ledger-keyed → 0 CDN, 0 DA
const c0 = cdnHits(); const d0 = daHits();
const r2 = await run(REHOST, base(content, ['--policy', 'rehost-all']));
check(cdnHits() === c0 && daHits() === d0, `(1) second run makes 0 CDN and 0 DA requests (made ${cdnHits() - c0} / ${daHits() - d0})`);
check(r2.status === 1, `(8) second run still exits 1 (dead / not-image rows persist), got ${r2.status}`);

// ---- (6) --dry on a fresh tree: no PUT, files byte-identical, ledger untouched ----------------
const dryTree = seed('dry'); const dryLedger = join(T, 'dry-ledger.json');
const before = walk(dryTree).map((f) => readFileSync(f, 'utf8'));
const d1 = daHits();
const rd = await run(REHOST, [...base(dryTree, ['--policy', 'rehost-all', '--dry']).filter((a, i, arr) => arr[i - 1] !== '--ledger' && a !== '--ledger'), '--ledger', dryLedger]);
check(daHits() === d1, `(6) --dry makes 0 DA requests (made ${daHits() - d1})`);
check(JSON.stringify(walk(dryTree).map((f) => readFileSync(f, 'utf8'))) === JSON.stringify(before), '(6) --dry leaves every file byte-identical');
check(!existsSync(dryLedger) && rd.json && rd.json.dry === true && rd.json.counts.rehosted === 3, `(6) --dry writes no ledger and reports what it would rehost (${rd.status} ${rd.stderr})`);

// ---- (7) policy keep from state.json: plain-200 kept, the 403 one still rehosted --------------
const keepTree = seed('keep'); const keepLedger = join(T, 'keep-ledger.json'); const statePath = join(T, 'state.json');
writeFileSync(statePath, JSON.stringify({ media: { policy: 'keep' } }));
const rk = await run(REHOST, ['--org', 'o', '--repo', 'r', '--scope', 'site', '--content', keepTree, '--ledger', keepLedger, '--captured', join(T, 'no-captured'), '--state', statePath, '--json']);
const K = existsSync(keepLedger) ? JSON.parse(readFileSync(keepLedger, 'utf8')) : {};
check(rk.json && rk.json.policy === 'keep', `(7) policy read from state.json media.policy (got ${rk.json && rk.json.policy})`);
check(K[cdnUrl('ok.png')] && K[cdnUrl('ok.png')].status === 'kept', `(7) plain-200 png kept under policy keep: ${JSON.stringify(K[cdnUrl('ok.png')])}`);
check(K[cdnUrl('walled.jpg')] && K[cdnUrl('walled.jpg')].status === 'rehosted', `(7) 403-to-plain-UA jpeg still rehosted under policy keep: ${JSON.stringify(K[cdnUrl('walled.jpg')])}`);
check(readFileSync(join(keepTree, 'index.html'), 'utf8').includes('/cdn/ok.png'), '(7) the kept <img> is not rewritten');
check(K[cdnUrl('ok.png')] && K[cdnUrl('ok.png')].policy === 'keep', '(13) a kept row records the policy it was kept under');

// ---- (11) 429 back-off: the retry is sent with its own timer --------------------------------------
const slowLedger = join(T, 'slow-ledger.json');
const rSlow = await run(REHOST, withLedger(base(one('slow', 'slow.png'), ['--policy', 'rehost-all']), slowLedger), { REHOST_MEDIA_TIMEOUT_MS: '800', REHOST_MEDIA_BACKOFF_MS: '1200' });
const slowReqs = mock.requests.filter((r) => r.url === '/cdn/slow.png');
check(rSlow.status === 0 && rowOf(slowLedger, 'slow.png').status === 'rehosted', `(11) 429 then 200 → rehosted, exit 0 (got ${rSlow.status} ${JSON.stringify(rowOf(slowLedger, 'slow.png'))})`);
check(slowReqs.length === 2 && slowReqs.every((r) => /^image\/\*/.test(r.accept || '')), `(11) two source GETs, both with the image accept header (got ${JSON.stringify(slowReqs.map((r) => r.accept))})`);

// ---- (12) > 1 MB under the DEFAULT policy: transform host → pre-shrunk PUT; no transform → oversize --
const bigLedger = join(T, 'big-ledger.json'); const bigTree = one('big', 'im/big.jpg', 'plain/big.jpg');
const putsBig = mock.requests.filter((r) => r.method === 'PUT').length;
const rBig = await run(REHOST, withLedger(base(bigTree), bigLedger));
const imRow = rowOf(bigLedger, 'im/big.jpg'); const plainRow = rowOf(bigLedger, 'plain/big.jpg');
check(rBig.status === 0 && rBig.json && rBig.json.policy === 'rehost-blocked', `(12) default policy is rehost-blocked, exit 0 (got ${rBig.status} ${rBig.json && rBig.json.policy})`);
check(imRow.status === 'rehosted' && imRow.via === 'cdn-transform' && imRow.bytes === jpeg.length && imRow.reasons && imRow.reasons.includes('oversize'), `(12) Akamai-IM shaped URL → pre-shrunk through the transform and rehosted: ${JSON.stringify(imRow)}`);
check(mock.requests.some((r) => r.url === '/cdn/im/big.jpg') && mock.requests.filter((r) => r.method === 'PUT').length === putsBig + 1, '(12) exactly one media PUT (the shrunk bytes), none for the oversize row');
check(plainRow.status === 'oversize' && plainRow.bytes === bigJpeg.length && /--resize/.test(plainRow.note || ''), `(12) no transform → oversize with the --resize hint, not rehosted: ${JSON.stringify(plainRow)}`);
check(readFileSync(join(bigTree, 'index.html'), 'utf8').includes('/cdn/plain/big.jpg') && !readFileSync(join(bigTree, 'index.html'), 'utf8').includes('/cdn/im/big.jpg'), '(12) only the rehosted reference is rewritten');

// ---- (13) a kept row does not outlive its policy --------------------------------------------------
const polLedger = join(T, 'policy-ledger.json'); const polTree = one('policy', 'ok.png');
await run(REHOST, withLedger(base(polTree, ['--policy', 'keep']), polLedger));
check(rowOf(polLedger, 'ok.png').status === 'kept', `(13) run 1 under keep: kept (${JSON.stringify(rowOf(polLedger, 'ok.png'))})`);
const rAll = await run(REHOST, withLedger(base(polTree, ['--policy', 'rehost-all']), polLedger));
check(rAll.status === 0 && rowOf(polLedger, 'ok.png').status === 'rehosted' && !rAll.json.rows[cdnUrl('ok.png')].cached, `(13) run 2 under rehost-all re-evaluates the kept row and rehosts it (${JSON.stringify(rowOf(polLedger, 'ok.png'))})`);
const c13 = cdnHits();
const rAll2 = await run(REHOST, withLedger(base(one('policy', 'ok.png'), ['--policy', 'rehost-all']), polLedger)); // a fresh copy of the page: run 2 rewrote the reference
check(cdnHits() === c13 && rAll2.json && (rAll2.json.rows[cdnUrl('ok.png')] || {}).cached === true, '(13) run 3 under the same policy is ledger-final again (0 CDN hits)');

// ---- (14) --only tokens ---------------------------------------------------------------------------
const onlyLedger = join(T, 'only-ledger.json'); const onlyTree = one('only', 'walled.jpg', 'plain/big.jpg', 'ok.png');
const rOnly = await run(REHOST, withLedger(base(onlyTree, ['--only', 'blocked']), onlyLedger));
check(rOnly.status === 0 && rowOf(onlyLedger, 'walled.jpg').status === 'rehosted', `(14) --only blocked rehosts the 403-to-plain-UA jpeg (${JSON.stringify(rowOf(onlyLedger, 'walled.jpg'))})`);
check(rowOf(onlyLedger, 'plain/big.jpg').status === 'kept' && /--only excludes oversize/.test(rowOf(onlyLedger, 'plain/big.jpg').note || '') && rowOf(onlyLedger, 'plain/big.jpg').only === 'blocked', `(14) the > 1 MB raster is kept with the --only note (${JSON.stringify(rowOf(onlyLedger, 'plain/big.jpg'))})`);
check(rowOf(onlyLedger, 'ok.png').status === 'kept' && !rowOf(onlyLedger, 'ok.png').note, '(14) a plain-200 png under rehost-blocked is kept without a note (no reason to act)');
const rOnlyBad = await run(REHOST, base(onlyTree, ['--only', 'nonsense']));
check(rOnlyBad.status === 2 && /--only takes blocked \| oversize \| rehost \| all/.test(rOnlyBad.stderr), `(14) an unknown --only token is a usage error naming the tokens (got ${rOnlyBad.status})`);

// ---- (15)(16) the browser paths: blocked stays blocked without them; Playwright half under STARDUST_PW_ROOT --
const ckLedger = join(T, 'cookie-ledger.json'); const ckTree = one('cookie', 'cookie.jpg');
const rCk = await run(REHOST, withLedger(base(ckTree), ckLedger));
check(rCk.status === 1 && rowOf(ckLedger, 'cookie.jpg').status === 'blocked' && rowOf(ckLedger, 'cookie.jpg').http === 403, `(15) cookie-gated asset without the technique: blocked, exit 1 (${JSON.stringify(rowOf(ckLedger, 'cookie.jpg'))})`);
const nzLedger = join(T, 'noise-ledger.json'); const nzTree = one('noise', 'noise.png');
const rNz = await run(REHOST, withLedger(base(nzTree), nzLedger));
check(noise.length > 1024 * 1024 && rNz.status === 0 && rowOf(nzLedger, 'noise.png').status === 'oversize', `(16) 1.1 MB png with no transform: oversize by default (${noise.length} B, ${JSON.stringify(rowOf(nzLedger, 'noise.png'))})`);
let pwOk = false;
if (process.env.STARDUST_PW_ROOT) { try { createRequire(join(process.env.STARDUST_PW_ROOT, 'package.json')).resolve('playwright'); pwOk = true; } catch { pwOk = false; } }
if (pwOk) {
  const rootBefore = mock.requests.filter((r) => r.url === '/').length;
  const rHc = await run(REHOST, withLedger(base(ckTree, ['--technique', 'headed-chrome']), ckLedger));
  const ck = rowOf(ckLedger, 'cookie.jpg');
  check(rHc.status === 0 && ck.status === 'rehosted' && ck.source === 'in-page' && ck.technique === 'headed-chrome' && ck.width === 3, `(15) --technique headed-chrome: fetched in-page with the origin cookie, rehosted (exit ${rHc.status}, ${JSON.stringify(ck)}) ${rHc.stderr.slice(0, 200)}`);
  check(mock.requests.filter((r) => r.url === '/').length === rootBefore + 1 && mock.requests.some((r) => r.url === '/cdn/cookie.jpg' && /sess=1/.test(r.cookie || '')), '(15) one home-document hit for the origin; the asset fetch carried its cookie');
  const rRs = await run(REHOST, withLedger(base(nzTree, ['--resize']), nzLedger));
  const nz = rowOf(nzLedger, 'noise.png');
  check(rRs.status === 0 && nz.status === 'rehosted' && nz.via === 'resize' && nz.type === 'image/jpeg' && nz.bytes < noise.length && /\.jpg$/.test(nz.url), `(16) --resize re-encodes the oversize png in the page and rehosts the smaller JPEG (${JSON.stringify(nz)}) ${rRs.stderr.slice(0, 200)}`);
} else {
  const rNoPw = await run(REHOST, withLedger(base(ckTree, ['--technique', 'headed-chrome']), ckLedger), { STARDUST_PW_ROOT: join(T, 'no-such-root'), PATH: '' });
  const ck = rowOf(ckLedger, 'cookie.jpg');
  check(rNoPw.status === 1 && ck.status === 'blocked' && /playwright not found|browser launch failed/.test(ck.note || ''), `(15) without Playwright the row stays blocked with the preflight note, exit 1 (${JSON.stringify(ck)})`);
  console.log('media-rehost-smoke: SKIP in-page fetch and --resize browser halves (STARDUST_PW_ROOT does not resolve playwright) — the playwright-missing branch ran');
}

// ---- (8) DA 401 → exit 3, HaltError; usage → exit 2 --------------------------------------------
mock.rules.mediaStatus = () => 401;
const r401 = await run(REHOST, [...base(seed('halt'), ['--policy', 'rehost-all']).filter((a, i, arr) => arr[i - 1] !== '--ledger' && a !== '--ledger'), '--ledger', join(T, 'halt-ledger.json')]);
check(r401.status === 3 && /HALT/.test(r401.stderr), `(8) DA 401 on the media PUT exits 3 with HALT (got ${r401.status} ${r401.stderr.slice(0, 120)})`);
mock.rules.mediaStatus = () => 201;
const rUsage = await run(REHOST, ['--org', 'o', '--repo']);
check(rUsage.status === 2, `usage: bare --repo exits 2, got ${rUsage.status}`);
const rPolicy = await run(REHOST, base(content, ['--policy', 'sometimes']));
check(rPolicy.status === 2, `usage: unknown --policy exits 2, got ${rPolicy.status}`);

// ---- (9) delivery-lint hotlinked-media P2 ------------------------------------------------------
const page = (src) => `<body><header></header><main><div><h1>x</h1><p>${'lorem '.repeat(20)}</p><p><img src="${src}" alt="a"></p></div></main><footer></footer></body>`;
const hot = join(T, 'hot.html'); writeFileSync(hot, page('https://www.source-example.com/img/a.jpg'));
const da = join(T, 'da.html'); writeFileSync(da, page('https://content.da.live/o/r/media/site/a-12345678.jpg'));
const lint = (args) => { const r = spawnSync(process.execPath, [LINT, ...args, '--json'], { encoding: 'utf8', cwd: T }); let j = null; try { j = JSON.parse(r.stdout); } catch { /* usage */ } return { status: r.status, rules: j ? j.findings.map((f) => `${f.sev} ${f.rule}`) : [] }; };
const l1 = lint(['--file', hot, '--source-host', 'https://www.source-example.com/']);
check(l1.rules.includes('P2 hotlinked-media') && l1.status === 0, `(9) source-host <img> → P2 hotlinked-media (advisory, exit 0): ${JSON.stringify(l1)}`);
check(!lint(['--file', hot, '--source-host', 'www.source-example.com', '--media-policy', 'keep']).rules.includes('P2 hotlinked-media'), '(9) --media-policy keep silences hotlinked-media');
check(!lint(['--file', hot]).rules.includes('P2 hotlinked-media'), '(9) silent without --source-host');
check(!lint(['--file', da, '--source-host', 'www.source-example.com']).rules.includes('P2 hotlinked-media'), '(9) a content.da.live src is never hotlinked-media');
check(lint(['--file', hot, '--media-policy', 'whatever']).status === 2, '(9) an unknown --media-policy is a usage error');

// ---- (10) verify --root: hotlinked image is an advisory class, never a FAIL ---------------------
const OUT = join(T, 'rollout'); const ROOT = join(T, 'root'); mkdirSync(join(OUT, 'coverage'), { recursive: true }); mkdirSync(ROOT, { recursive: true });
const covRow = (slug, path) => ({ slug, path, title: slug, templateId: 't', source: { migratedHtml: null, metaJson: null, sourceHash: 'sha256:0' }, blocks: [], delivery: { status: 'deployed', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null } });
writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ pages: [covRow('hot', '/hot'), covRow('clean', '/clean')] }));
writeFileSync(join(ROOT, 'hot.html'), '<main><h1>hot</h1><p><img src="https://www.source-example.com/img/a.jpg" alt="a"></p></main>');
writeFileSync(join(ROOT, 'clean.html'), '<main><h1>clean</h1><p><picture><img src="./media_abc.jpg" alt="a"></picture></p></main>');
const rv = spawnSync(process.execPath, [VERIFY, '--root', ROOT, '--out', OUT], { encoding: 'utf8', cwd: T });
const summary = existsSync(join(OUT, 'verify', 'summary.json')) ? JSON.parse(readFileSync(join(OUT, 'verify', 'summary.json'), 'utf8')) : { pages: [], classes: [] };
const hotRow = summary.pages.find((p) => p.slug === 'hot') || {};
check(rv.status === 0 && summary.verified === 2 && summary.failed === 0, `(10) both pages verified, exit 0 (got ${rv.status}, ${summary.verified}/${summary.failed})\n${rv.stderr}`);
check(hotRow.status === 'verified' && hotRow.advisories && hotRow.advisories.some((a) => a.class === 'hotlinked image' && a.severity === 'info'), `(10) hot page carries the hotlinked image advisory and stays verified: ${JSON.stringify(hotRow)}`);
check(summary.classes.some((c) => c.class === 'hotlinked image' && c.count === 1) && summary.hotlinkedPages === 1, '(10) class table ranks `hotlinked image` once; summary.hotlinkedPages = 1');
check(summary.pendingTargetPages === 0, '(10) a hotlinked advisory is not counted as a pending-target link');
check(/hotlinked images: 1 page\(s\)/.test(rv.stdout), '(10) stdout carries the one-line hotlinked summary');
check(!((summary.pages.find((p) => p.slug === 'clean') || {}).advisories || []).length, '(10) a Media-Bus-rewritten page has no advisory');

await mock.close();
rmSync(T, { recursive: true, force: true });
if (failures.length) { console.error(`media-rehost-smoke: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('media-rehost-smoke: ok (16 cases · ledger + 0-hit re-run, PUT only 2xx images, dead/not-image/signed, stem, --dry, policy keep, exit 3 on DA 401, delivery-lint hotlinked-media, verify hotlinked advisory, 429 retry sent, > 1 MB acted under the default, kept rows re-evaluated per policy, --only tokens, headed-chrome in-page fetch, --resize)');
