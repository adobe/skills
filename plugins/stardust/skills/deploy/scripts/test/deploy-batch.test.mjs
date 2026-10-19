#!/usr/bin/env node
// skills/deploy/scripts/test/deploy-batch.test.mjs — the deploy-batch.mjs contract against a local fake
// of its three hosts (one node http server on a random port standing in for the DA source API, the
// admin API and the delivered origin; no network): PUT → preview → live → .plain.html verify with the
// multipart field, the Authorization header and the ledger row (`contentSha` + `verifiedAt`); the
// content-hash skip on re-run (an unchanged live page sends nothing within --verify-max-age, one pooled
// GET after it; a changed document, a legacy row without contentSha or a failed re-verify re-drives);
// --no-publish; the 401 policy (an expired JWT exits 3 before any request; a 401 burst on a valid token
// is retried on PUT, preview and live and the page lands; a 401 that persists through its retries on
// any page or step halts the batch with exit 3 — nothing new starts, pages in flight finish, the ledger
// is written, the halted page keeps its status and is never put-fail, one stderr HALT line with the
// exact re-run command — and the same command with a fresh token resumes); a 5xx that persists is a
// per-page FAIL with exit 1, not a halt; usage errors exit 2; --help; and that the token value never
// reaches stdout, stderr, a ledger or a log.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'deploy-batch.mjs');
const proj = mkdtempSync(join(tmpdir(), 'deploy-batch-test-'));
const TOKEN = `tok-${randomBytes(12).toString('hex')}`;
const FRESH_TOKEN = `fresh-${randomBytes(12).toString('hex')}`; // the token after a refresh: the fake accepts it everywhere
// JWT-shaped tokens for the preflight: header.payload.signature, base64url, the payload carrying exp.
const jwt = (claims) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${randomBytes(16).toString('base64url')}`;
const EXPIRED_EXP = Math.floor(Date.now() / 1000) - 2 * 3600;
const EXPIRED_JWT = jwt({ exp: EXPIRED_EXP, sub: 'x', client_id: 'test' });
const FUTURE_JWT = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'x' });
const SECRETS = [TOKEN, FRESH_TOKEN, EXPIRED_JWT, FUTURE_JWT];
const ORG = 'test-org'; const REPO = 'test-repo'; const BRANCH = 'main';
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const allOutput = [];

// ---- fake DA source API + admin API + delivered origin -------------------------------------------------
const requests = [];
const count = { put: {}, preview: {}, live: {}, verify: {} };
const bump = (kind, p) => { count[kind][p] = (count[kind][p] || 0) + 1; return count[kind][p]; };
const putOk = new Set(); // pages whose fragment landed: the delivered origin answers 200 for these only
const verifyGets = { delayMs: 0, inFlight: 0, maxInFlight: 0 }; // a slow delivered origin shows whether the GETs overlap
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
const SRC = `/source/${ORG}/${REPO}`; const PREVIEW = `/preview/${ORG}/${REPO}/${BRANCH}`; const LIVE = `/live/${ORG}/${REPO}/${BRANCH}`;
// A second repo of the same org: its own source and admin paths, and its own delivered origin (under ORIGIN_B).
const REPO_B = 'test-repo-b'; const ORIGIN_B = '/origin-b';
const SRC_B = `/source/${ORG}/${REPO_B}`; const PREVIEW_B = `/preview/${ORG}/${REPO_B}/${BRANCH}`; const LIVE_B = `/live/${ORG}/${REPO_B}/${BRANCH}`;
const putOkB = new Set();
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method, url, headers: req.headers, body, parts: req.method === 'PUT' ? parseMultipart(body, req.headers['content-type']) : [] });
    const auth = req.headers.authorization;
    const valid = auth === `Bearer ${TOKEN}` || auth === `Bearer ${FRESH_TOKEN}`;
    const fresh = auth === `Bearer ${FRESH_TOKEN}`;
    const reply = (status, text = '', headers = {}) => { res.writeHead(status, headers); res.end(text); };
    if (req.method === 'PUT' && url.startsWith(`${SRC_B}/`)) { putOkB.add(url.slice(SRC_B.length, -'.html'.length)); return reply(valid ? 201 : 401, '{}'); }
    if (req.method === 'POST' && (url.startsWith(`${PREVIEW_B}/`) || url.startsWith(`${LIVE_B}/`))) return reply(valid ? 200 : 401, '{}');
    if (req.method === 'GET' && url.startsWith(`${ORIGIN_B}/`)) {
      return putOkB.has(url.slice(ORIGIN_B.length, -'.plain.html'.length)) ? reply(200, '<div><p>delivered</p></div>') : reply(404, 'not found');
    }
    if (req.method === 'PUT' && url.startsWith(`${SRC}/`) && url.endsWith('.html')) {
      const p = url.slice(SRC.length, -'.html'.length);
      const n = bump('put', p);
      if (/-dead$/.test(p) && !fresh) return reply(401, ''); // the token is dead until refreshed
      if (/burst$/.test(p) && n <= 2) return reply(401, ''); // a valid token answered 401 under a burst, then accepted
      if (/flaky$/.test(p)) return reply(503, 'unavailable');
      if (/recover$/.test(p) && n <= 2) return reply(503, 'unavailable');
      if (!valid) return reply(401, 'bad token');
      const created = () => { putOk.add(p); reply(201, '{}', { 'content-type': 'application/json' }); };
      if (/slow$/.test(p)) { setTimeout(created, 800); return undefined; }
      return created();
    }
    if (req.method === 'POST' && url.startsWith(`${PREVIEW}/`)) {
      const p = url.slice(PREVIEW.length);
      const n = bump('preview', p);
      if (/burst-prev$/.test(p) && n <= 2) return reply(401, '');
      if (!valid) return reply(401, 'bad token');
      return reply(200, '{}', { 'content-type': 'application/json' });
    }
    if (req.method === 'POST' && url.startsWith(`${LIVE}/`)) {
      const p = url.slice(LIVE.length);
      const n = bump('live', p);
      if (/dead-live$/.test(p) && !fresh) return reply(401, '');
      if (/burst-live$/.test(p) && n <= 2) return reply(401, '');
      if (!valid) return reply(401, 'bad token');
      return reply(200, '{}', { 'content-type': 'application/json' });
    }
    if (req.method === 'GET' && url.endsWith('.plain.html')) {
      const p = url.slice(0, -'.plain.html'.length);
      bump('verify', p);
      const answer = () => (putOk.has(p) ? reply(200, '<div><p>delivered</p></div>', { 'content-type': 'text/html' }) : reply(404, 'not found'));
      if (!verifyGets.delayMs) return answer();
      verifyGets.inFlight += 1; verifyGets.maxInFlight = Math.max(verifyGets.maxInFlight, verifyGets.inFlight);
      setTimeout(() => { verifyGets.inFlight -= 1; answer(); }, verifyGets.delayMs);
      return undefined;
    }
    return reply(405, `unexpected ${req.method} ${url}`);
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- fixtures + runner ---------------------------------------------------------------------------------
const FRAG = {};
const site = (dir, names) => {
  for (const n of names) {
    const f = join(proj, dir, `${n}.html`);
    mkdirSync(dirname(f), { recursive: true });
    FRAG[`/${n}`] = `<div><h1>${n}</h1><p>${randomBytes(6).toString('hex')}</p></div>\n`;
    writeFileSync(f, FRAG[`/${n}`]);
  }
};
const run = (args, { token = TOKEN, tokenEnv = 'DA_TOKEN', origin = BASE, coords = true, rolloutConfig = null, imsFile = null } = {}) => new Promise((resolve) => {
  const env = { ...process.env, DA_SOURCE_BASE: `${BASE}/source`, AEM_ADMIN_BASE: BASE, DEPLOY_VERIFY_ORIGIN: origin };
  // deterministic defaults: the org/repo/branch-from-rollout and token-from-ADOBE_IMS_TOKEN_FILE features
  // read these only when the test opts in (coords omits the explicit flags, rolloutConfig / imsFile set the env)
  delete env.DA_TOKEN; delete env.ADOBE_IMS_TOKEN_FILE; delete env.ROLLOUT_CONFIG;
  if (token) env[tokenEnv] = token;
  if (imsFile) env.ADOBE_IMS_TOKEN_FILE = imsFile;
  if (rolloutConfig) env.ROLLOUT_CONFIG = rolloutConfig;
  const coord = coords ? ['--org', ORG, '--repo', REPO, '--branch', BRANCH] : [];
  const p = spawn(process.execPath, [SCRIPT, ...coord, '--backoff-ms', '1', ...args], { cwd: proj, env });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => { allOutput.push(out, err); resolve({ code, out, err }); });
});
const ledgerOf = (dir) => JSON.parse(readFileSync(join(proj, dir, '.deploy-ledger.json'), 'utf8'));
const writeLedger = (dir, l) => writeFileSync(join(proj, dir, '.deploy-ledger.json'), `${JSON.stringify(l, null, 2)}\n`);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const skipLine = (a, b, n, c, d, e, tail = '') => new RegExp(`^\\[deploy-batch\\] skip: ${a} unchanged \\(contentSha; ${b} verified ≤ ${n} min ago, ${c} re-verified by GET\\); re-drive: ${d} changed since live, ${e} ledger rows without contentSha${tail}$`, 'm');
const logOf = (dir) => readFileSync(join(proj, dir, '.deploy-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const since = (from) => requests.slice(from);
const touching = (reqs, p) => reqs.filter((q) => q.url.includes(p));
const haltLines = (err) => err.split('\n').filter((l) => /^HALT /.test(l));
const rerunRe = (tokenEnv, tail) => new RegExp(`${tokenEnv}=<fresh token> node .*deploy-batch\\.mjs --org ${ORG} --repo ${REPO} --branch ${BRANCH} --backoff-ms 1 ${tail}$`, 'm');

// ---- (a) happy path ------------------------------------------------------------------------------------
await check('happy path: PUT (multipart `data`, text/html, Authorization) → preview → live → .plain.html verify, ledger `live`, log appended, exit 0', async () => {
  site('site-a', ['a1', 'nested/a2']);
  const from = requests.length;
  const r = await run(['--content', 'site-a', '--concurrency', '2']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, '', 'nothing on stdout');
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 0 already live, 2 to drive \(concurrency 2, publish=true\)$/m);
  assert.match(r.err, /^\[\d\/2\] OK {3}\/a1 \(live\)$/m); assert.match(r.err, /^\[\d\/2\] OK {3}\/nested\/a2 \(live\)$/m);
  assert.match(r.err, /^\[deploy-batch\] done\. 2 ok, 0 failed\.$/m);
  assert.doesNotMatch(r.err, /FAIL|HALT/);
  const reqs = since(from);
  assert.deepEqual(reqs.map((q) => `${q.method} ${q.url}`).sort(), [
    `GET /a1.plain.html`, `GET /nested/a2.plain.html`,
    `POST ${LIVE}/a1`, `POST ${LIVE}/nested/a2`,
    `POST ${PREVIEW}/a1`, `POST ${PREVIEW}/nested/a2`,
    `PUT ${SRC}/a1.html`, `PUT ${SRC}/nested/a2.html`,
  ]);
  for (const q of reqs.filter((x) => x.method !== 'GET')) assert.equal(q.headers.authorization, `Bearer ${TOKEN}`);
  const put = reqs.find((q) => q.method === 'PUT' && q.url.endsWith('/nested/a2.html'));
  assert.match(put.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(put.parts.length, 1);
  assert.match(put.parts[0].headers, /Content-Disposition: form-data; name="data"; filename="a2\.html"/i);
  assert.match(put.parts[0].headers, /Content-Type: text\/html/i);
  assert.equal(put.parts[0].data.toString('utf8'), FRAG['/nested/a2'], 'uploaded bytes equal the fragment file');
  // the order per page is PUT → preview → live → verify
  const a1 = reqs.filter((q) => /\/a1(\.html|\.plain\.html)?$/.test(q.url)).map((q) => q.method + (q.url.startsWith(LIVE) ? ' live' : q.url.startsWith(PREVIEW) ? ' preview' : ''));
  assert.deepEqual(a1, ['PUT', 'POST preview', 'POST live', 'GET']);
  const l = ledgerOf('site-a');
  assert.deepEqual(Object.keys(l).sort(), ['/a1', '/nested/a2']);
  assert.equal(l['/a1'].status, 'live'); assert.equal(l['/a1'].put, 201); assert.equal(l['/a1'].preview, 200); assert.equal(l['/a1'].live, 200); assert.equal(l['/a1'].verify, 'ok'); assert.equal(l['/a1'].attempts, 1);
  for (const p of ['/a1', '/nested/a2']) {
    assert.equal(l[p].contentSha, sha256(FRAG[p]), `${p}: contentSha = sha256 of the bytes PUT`);
    assert.equal(l[p].verifiedOn, `${ORG}/${REPO}`, `${p}: verifiedOn = the org/repo it was delivered to`);
    assert.match(l[p].verifiedAt, ISO_RE); assert.ok(Date.now() - Date.parse(l[p].verifiedAt) < 60000);
  }
  assert.ok(readFileSync(join(proj, 'site-a', '.deploy-ledger.json'), 'utf8').endsWith('}\n'), 'trailing newline');
  assert.deepEqual(readdirSync(join(proj, 'site-a')).filter((f) => f.startsWith('.')).sort(), ['.deploy-ledger.json', '.deploy-log.jsonl'], 'no tmp file, no lock dir left');
  const log = logOf('site-a');
  assert.equal(log.length, 2); assert.ok(log.every((e) => e.step === 'verify' && e.ok === true && e.t));
});
await check('re-run on an unchanged tree sends 0 requests (unchanged contentSha, verified ≤ 60 min ago); --verify-max-age 0 re-verifies with pooled GETs and no admin call, refreshing verifiedAt; --force re-drives them', async () => {
  const before = ledgerOf('site-a');
  const from = requests.length;
  const r = await run(['--content', 'site-a']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 2 already live, 0 to drive \(concurrency 4, publish=true\)$/m); assert.match(r.err, /done\. 0 ok, 0 failed\./);
  assert.match(r.err, skipLine(2, 2, 60, 0, 0, 0));
  assert.equal(requests.length, from, 'no request at all: no PUT, no admin call, no .plain.html GET');
  assert.deepEqual(ledgerOf('site-a'), before, 'a skip without a request leaves the rows as they were');
  // --verify-max-age 0: always re-verify — one GET per page, run inside the pool (the slow origin shows them overlap)
  Object.assign(verifyGets, { delayMs: 150, maxInFlight: 0 });
  const from1 = requests.length;
  const r1 = await run(['--content', 'site-a', '--verify-max-age', '0']);
  verifyGets.delayMs = 0;
  assert.equal(r1.code, 0, r1.out + r1.err);
  assert.match(r1.err, /^\[deploy-batch\] 2 pages, 2 already live, 0 to drive/m);
  assert.match(r1.err, skipLine(2, 0, 0, 2, 0, 0));
  assert.deepEqual(since(from1).map((q) => `${q.method} ${q.url}`).sort(), ['GET /a1.plain.html', 'GET /nested/a2.plain.html']);
  assert.equal(verifyGets.maxInFlight, 2, 'the two re-verify GETs ran concurrently, not one after the other');
  const after = ledgerOf('site-a');
  for (const p of ['/a1', '/nested/a2']) {
    assert.ok(after[p].verifiedAt > before[p].verifiedAt, `${p}: verifiedAt refreshed by the GET`);
    assert.deepEqual({ ...after[p], verifiedAt: 0 }, { ...before[p], verifiedAt: 0 }, `${p}: nothing else in the row changes`);
  }
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-a', '--force']);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, /2 pages, 0 already live, 2 to drive/); assert.doesNotMatch(r2.err, /skip:/);
  assert.equal(since(from2).filter((q) => q.method === 'PUT').length, 2);
  assert.equal(ledgerOf('site-a')['/a1'].attempts, 1, '--force starts a fresh ledger');
});
await check('--no-publish: PUT → preview → verify only, ledger `previewed`, no POST /live', async () => {
  site('site-np', ['np1']);
  const from = requests.length;
  const r = await run(['--content', 'site-np', '--no-publish']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[1\/1\] OK {3}\/np1 \(previewed\)$/m);
  assert.deepEqual(since(from).map((q) => `${q.method} ${q.url}`), [`PUT ${SRC}/np1.html`, `POST ${PREVIEW}/np1`, 'GET /np1.plain.html']);
  assert.equal(ledgerOf('site-np')['/np1'].status, 'previewed'); assert.equal(ledgerOf('site-np')['/np1'].live, undefined);
  assert.equal(ledgerOf('site-np')['/np1'].contentSha, sha256(FRAG['/np1'])); assert.match(ledgerOf('site-np')['/np1'].verifiedAt, ISO_RE);
});

// ---- (a2) the content-hash skip ------------------------------------------------------------------------
await check('one byte changed in one page re-deploys only that page (PUT → preview → live → GET, no --force); the unchanged page sends 0 requests; the row carries the new contentSha', async () => {
  site('site-h', ['h1', 'h2']);
  const r0 = await run(['--content', 'site-h']);
  assert.equal(r0.code, 0, r0.out + r0.err);
  const before = ledgerOf('site-h');
  const changed = FRAG['/h2'].replace('<h1>h2</h1>', '<h1>h3</h1>');
  assert.equal(changed.length, FRAG['/h2'].length);
  writeFileSync(join(proj, 'site-h', 'h2.html'), changed);
  const from = requests.length;
  const r = await run(['--content', 'site-h']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 1 already live, 1 to drive/m);
  assert.match(r.err, skipLine(1, 1, 60, 0, 1, 0));
  assert.match(r.err, /^\[1\/1\] OK {3}\/h2 \(live\)$/m);
  const reqs = since(from);
  assert.deepEqual(reqs.map((q) => `${q.method} ${q.url}`), [`PUT ${SRC}/h2.html`, `POST ${PREVIEW}/h2`, `POST ${LIVE}/h2`, 'GET /h2.plain.html']);
  assert.equal(reqs[0].parts[0].data.toString('utf8'), changed, 'the changed bytes were PUT');
  const l = ledgerOf('site-h');
  assert.deepEqual(l['/h1'], before['/h1'], 'the unchanged page row is untouched');
  assert.equal(l['/h2'].contentSha, sha256(changed)); assert.notEqual(l['/h2'].contentSha, before['/h2'].contentSha);
  assert.equal(l['/h2'].attempts, 2); assert.ok(l['/h2'].verifiedAt > before['/h2'].verifiedAt);
});
await check('a ledger row without contentSha (written before this version) re-drives once, then carries the hash and is skipped', async () => {
  site('site-k', ['k1', 'k2']);
  assert.equal((await run(['--content', 'site-k'])).code, 0);
  const l0 = ledgerOf('site-k');
  delete l0['/k1'].contentSha; delete l0['/k1'].verifiedAt;
  writeLedger('site-k', l0);
  const from = requests.length;
  const r = await run(['--content', 'site-k']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 1 already live, 1 to drive/m);
  assert.match(r.err, skipLine(1, 1, 60, 0, 0, 1));
  assert.deepEqual(since(from).map((q) => `${q.method} ${q.url}`), [`PUT ${SRC}/k1.html`, `POST ${PREVIEW}/k1`, `POST ${LIVE}/k1`, 'GET /k1.plain.html']);
  assert.equal(ledgerOf('site-k')['/k1'].contentSha, sha256(FRAG['/k1']));
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-k']);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, skipLine(2, 2, 60, 0, 0, 0)); assert.equal(requests.length, from2, 'the legacy row re-drives once only');
});
await check('re-verify: a row verified longer than --verify-max-age ago gets one GET (200 ⇒ skipped, verifiedAt refreshed); a failed re-verify (age 0, delivered 404) re-drives the page', async () => {
  site('site-v', ['v1', 'v2', 'v3']);
  assert.equal((await run(['--content', 'site-v'])).code, 0);
  const l0 = ledgerOf('site-v');
  l0['/v1'].verifiedAt = new Date(Date.now() - 2 * 3600e3).toISOString(); // older than the default 60 min
  writeLedger('site-v', l0);
  const from = requests.length;
  const r = await run(['--content', 'site-v']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 3 pages, 3 already live, 0 to drive/m);
  assert.match(r.err, skipLine(3, 2, 60, 1, 0, 0));
  assert.deepEqual(since(from).map((q) => `${q.method} ${q.url}`), ['GET /v1.plain.html']);
  assert.ok(Date.now() - Date.parse(ledgerOf('site-v')['/v1'].verifiedAt) < 60000, 'verifiedAt refreshed by the GET');
  putOk.delete('/v2'); // the delivered origin lost v2: its re-verify answers 404
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-v', '--verify-max-age', '0']);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, /^\[deploy-batch\] 3 pages, 2 already live, 1 to drive/m);
  assert.match(r2.err, skipLine(2, 0, 0, 2, 0, 0, ', 1 failed the re-verify GET'));
  assert.match(r2.err, /^\[1\/1\] OK {3}\/v2 \(live\)$/m);
  const reqs = since(from2);
  assert.deepEqual(touching(reqs, '/v2').map((q) => `${q.method} ${q.url}`), ['GET /v2.plain.html', `PUT ${SRC}/v2.html`, `POST ${PREVIEW}/v2`, `POST ${LIVE}/v2`, 'GET /v2.plain.html']);
  assert.deepEqual(reqs.filter((q) => !q.url.includes('/v2')).map((q) => `${q.method} ${q.url}`).sort(), ['GET /v1.plain.html', 'GET /v3.plain.html']);
  assert.equal(ledgerOf('site-v')['/v2'].status, 'live'); assert.equal(ledgerOf('site-v')['/v2'].attempts, 2);
});

await check('a skip is tied to the org/repo the page was delivered to (verifiedOn): the same content folder pointed at another repo re-deploys there with 0 requests to the first; fresh for it afterwards; a document changed and delivered to the second still reaches the first, whose stale copy answers 200', async () => {
  const fmt = (q) => `${q.method} ${q.url}`;
  const onB = { origin: `${BASE}${ORIGIN_B}` };
  site('site-t', ['t1', 't2']);
  assert.equal((await run(['--content', 'site-t'])).code, 0);
  const from = requests.length;
  const r = await run(['--content', 'site-t', '--repo', REPO_B], onB);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 0 already live, 2 to drive/m);
  assert.match(r.err, skipLine(0, 0, 60, 0, 0, 0, ', 2 verified on another org/repo'));
  for (const p of ['t1', 't2']) assert.deepEqual(touching(since(from), `/${p}`).map(fmt), [`PUT ${SRC_B}/${p}.html`, `POST ${PREVIEW_B}/${p}`, `POST ${LIVE_B}/${p}`, `GET ${ORIGIN_B}/${p}.plain.html`]);
  assert.equal(since(from).length, 8, 'nothing sent to the first repo or its origin');
  for (const p of ['/t1', '/t2']) { assert.equal(ledgerOf('site-t')[p].verifiedOn, `${ORG}/${REPO_B}`); assert.equal(ledgerOf('site-t')[p].contentSha, sha256(FRAG[p])); }
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-t', '--repo', REPO_B], onB);
  assert.match(r2.err, skipLine(2, 2, 60, 0, 0, 0)); assert.equal(requests.length, from2, 'fresh for the second repo');
  const changed = FRAG['/t1'].replace('<h1>t1</h1>', '<h1>t9</h1>');
  writeFileSync(join(proj, 'site-t', 't1.html'), changed);
  assert.equal((await run(['--content', 'site-t', '--repo', REPO_B], onB)).code, 0);
  const from3 = requests.length;
  const r3 = await run(['--content', 'site-t']); // the first repo still delivers its old t1 with a 200
  assert.equal(r3.code, 0, r3.out + r3.err);
  assert.match(r3.err, skipLine(0, 0, 60, 0, 0, 0, ', 2 verified on another org/repo'));
  const reqs = since(from3);
  assert.equal(reqs.find((q) => q.method === 'PUT' && q.url === `${SRC}/t1.html`).parts[0].data.toString('utf8'), changed, 'the first repo receives the changed document');
  assert.equal(reqs.filter((q) => q.url.includes(REPO_B) || q.url.startsWith(ORIGIN_B)).length, 0);
  assert.equal(ledgerOf('site-t')['/t1'].verifiedOn, `${ORG}/${REPO}`);
});

// ---- (b) a 401 burst on a valid token ------------------------------------------------------------------
await check('a 401 burst on a valid token (401, 401, then accepted) is retried like a 429 on PUT, preview and live — every page lands, no HALT, exit 0', async () => {
  site('site-b', ['burst', 'burst-prev', 'burst-live', 'plain']);
  const from = requests.length;
  const r = await run(['--content', 'site-b', '--concurrency', '4', '--retries', '3']);
  assert.equal(r.code, 0, r.out + r.err);
  for (const p of ['burst', 'burst-prev', 'burst-live', 'plain']) assert.match(r.err, new RegExp(`^\\[\\d/4\\] OK {3}/${p} \\(live\\)$`, 'm'));
  assert.match(r.err, /done\. 4 ok, 0 failed\./); assert.doesNotMatch(r.err, /HALT|FAIL|401/);
  const reqs = since(from);
  assert.equal(reqs.filter((q) => q.method === 'PUT' && q.url.endsWith('/burst.html')).length, 3, 'PUT: 401, 401, 201');
  assert.equal(reqs.filter((q) => q.method === 'POST' && q.url === `${PREVIEW}/burst-prev`).length, 3, 'preview: 401, 401, 200');
  assert.equal(reqs.filter((q) => q.method === 'POST' && q.url === `${LIVE}/burst-live`).length, 3, 'live: 401, 401, 200');
  assert.equal(reqs.filter((q) => q.method === 'PUT' && q.url.endsWith('/plain.html')).length, 1);
  const l = ledgerOf('site-b');
  for (const p of ['/burst', '/burst-prev', '/burst-live', '/plain']) { assert.equal(l[p].status, 'live'); assert.equal(l[p].put, 201); assert.equal(l[p].preview, 200); assert.equal(l[p].live, 200); }
});

// ---- (c) a persistent 401 halts -------------------------------------------------------------------------
await check('a 401 that persists through its retries on page 2 of 4 halts: exit 3, one HALT line with the re-run command, page 1 live, page 2 not failed, pages 3–4 not attempted, ledger written', async () => {
  site('site-c', ['c1', 'c2-dead', 'c3', 'c4']);
  const from = requests.length;
  const r = await run(['--content', 'site-c', '--concurrency', '1', '--retries', '2']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.out, '', 'nothing on stdout');
  assert.match(r.err, /^\[1\/4\] OK {3}\/c1 \(live\)$/m);
  assert.match(r.err, /^\[2\/4\] HALT \/c2-dead \(put 401 after 3 attempts — status kept pending, not failed\)$/m);
  assert.match(r.err, /^\[deploy-batch\] halted on a 401\. 1 ok, 0 failed, 3 left for the re-run \(the halted page and the pages not started keep their status; the ledger resumes them\)\.$/m);
  assert.doesNotMatch(r.err, /FAIL|put-fail/);
  const halts = haltLines(r.err);
  assert.equal(halts.length, 1, `one HALT line: ${r.err}`);
  assert.match(halts[0], /^HALT \/c2-dead 401 after 3 attempts — refresh DA_TOKEN and re-run: /);
  assert.match(halts[0], rerunRe('DA_TOKEN', '--content site-c --concurrency 1 --retries 2'));
  const reqs = since(from);
  assert.equal(touching(reqs, '/c2-dead').length, 3, 'three PUT attempts on the halted page, nothing else for it');
  assert.ok(reqs.filter((q) => q.url.includes('/c2-dead')).every((q) => q.method === 'PUT'));
  assert.equal(touching(reqs, '/c3').length + touching(reqs, '/c4').length, 0, 'pages 3–4 were never attempted');
  const l = ledgerOf('site-c');
  assert.equal(l['/c1'].status, 'live');
  assert.deepEqual(Object.keys(l['/c2-dead']).sort(), ['attempts', 'status', 'ts']);
  assert.equal(l['/c2-dead'].status, 'pending', 'never put-fail because of a 401'); assert.equal(l['/c2-dead'].attempts, 1);
  assert.equal(l['/c3'], undefined); assert.equal(l['/c4'], undefined);
  assert.ok(readFileSync(join(proj, 'site-c', '.deploy-ledger.json'), 'utf8').endsWith('}\n'));
  assert.deepEqual(readdirSync(join(proj, 'site-c')).filter((f) => f.startsWith('.')).sort(), ['.deploy-ledger.json', '.deploy-log.jsonl'], 'no tmp file, no lock dir after the halt checkpoint');
  const halt = logOf('site-c').find((e) => e.path === '/c2-dead');
  assert.deepEqual({ step: halt.step, status: halt.status, attempts: halt.attempts, halt: halt.halt }, { step: 'put', status: 401, attempts: 3, halt: true });
  // the same command with a fresh token resumes: c1 skipped (already live), c2-dead / c3 / c4 delivered
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-c', '--concurrency', '1', '--retries', '2'], { token: FRESH_TOKEN });
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, /4 pages, 1 already live, 3 to drive/); assert.match(r2.err, /done\. 3 ok, 0 failed\./);
  assert.equal(since(from2).filter((q) => q.method === 'PUT').length, 3);
  const l2 = ledgerOf('site-c');
  for (const p of ['/c1', '/c2-dead', '/c3', '/c4']) assert.equal(l2[p].status, 'live');
  assert.equal(l2['/c2-dead'].attempts, 2, 'the halted page carries its attempt count into the resume');
});
await check('at the halt nothing new starts while the page already in flight finishes (ledger `live`); a persistent 401 on the live step halts too, status kept', async () => {
  site('site-c2', ['a-slow', 'b-dead', 'c3', 'c4']);
  const from = requests.length;
  const r = await run(['--content', 'site-c2', '--concurrency', '2', '--retries', '2']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.err, /^\[\d\/4\] HALT \/b-dead \(put 401 after 3 attempts — status kept pending, not failed\)$/m);
  assert.match(r.err, /^\[\d\/4\] OK {3}\/a-slow \(live\)$/m);
  assert.match(r.err, /halted on a 401\. 1 ok, 0 failed, 3 left for the re-run/);
  assert.equal(haltLines(r.err).length, 1);
  assert.match(haltLines(r.err)[0], rerunRe('DA_TOKEN', '--content site-c2 --concurrency 2 --retries 2'));
  const reqs = since(from);
  assert.equal(touching(reqs, '/c3').length + touching(reqs, '/c4').length, 0, 'the queued pages were never started');
  assert.deepEqual(touching(reqs, '/a-slow').map((q) => q.method), ['PUT', 'POST', 'POST', 'GET'], 'the in-flight page ran its whole chain');
  const l = ledgerOf('site-c2');
  assert.equal(l['/a-slow'].status, 'live'); assert.equal(l['/b-dead'].status, 'pending'); assert.equal(l['/c3'], undefined);
  // a 401 that persists on POST /live/ (after PUT and preview were accepted) is the same halt
  site('site-c3', ['dead-live']);
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-c3', '--retries', '1']);
  assert.equal(r2.code, 3, r2.out + r2.err);
  assert.match(r2.err, /^\[1\/1\] HALT \/dead-live \(live 401 after 2 attempts — status kept pending, not failed\)$/m);
  assert.equal(haltLines(r2.err).length, 1); assert.match(haltLines(r2.err)[0], /^HALT \/dead-live 401 after 2 attempts — refresh DA_TOKEN and re-run: /);
  assert.deepEqual(since(from2).map((q) => `${q.method} ${q.url}`), [`PUT ${SRC}/dead-live.html`, `POST ${PREVIEW}/dead-live`, `POST ${LIVE}/dead-live`, `POST ${LIVE}/dead-live`]);
  const rec = ledgerOf('site-c3')['/dead-live'];
  assert.equal(rec.status, 'pending'); assert.equal(rec.put, 201); assert.equal(rec.preview, 200); assert.equal(rec.live, undefined); assert.equal(rec.lastError, undefined);
});

// ---- (d) expired JWT ------------------------------------------------------------------------------------
await check('an expired JWT exits 3 before any request (the fake sees none, no ledger is written), naming the expiry and the re-run command; --token-env names that variable; a future-exp JWT is tried', async () => {
  site('site-d', ['d1', 'd2']);
  const from = requests.length;
  const r = await run(['--content', 'site-d'], { token: EXPIRED_JWT });
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.out, '');
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, new RegExp(`^\\[deploy-batch\\] DA_TOKEN is expired — its exp claim is ${new Date(EXPIRED_EXP * 1000).toISOString().replace(/[.]/g, '\\.')} \\(\\d+ min ago\\); nothing was sent\\. Refresh it and re-run: `));
  assert.match(r.err, rerunRe('DA_TOKEN', '--content site-d'));
  assert.equal(requests.length, from, 'no request left the process');
  assert.ok(!existsSync(join(proj, 'site-d', '.deploy-ledger.json')) && !existsSync(join(proj, 'site-d', '.deploy-log.jsonl')), 'nothing written');
  const r2 = await run(['--content', 'site-d', '--token-env', 'MY_TOKEN'], { token: EXPIRED_JWT, tokenEnv: 'MY_TOKEN' });
  assert.equal(r2.code, 3, r2.out + r2.err);
  assert.match(r2.err, /^\[deploy-batch\] MY_TOKEN is expired — /); assert.match(r2.err, rerunRe('MY_TOKEN', '--content site-d --token-env MY_TOKEN'));
  assert.equal(requests.length, from);
  // a JWT with a future exp reaches the admin API; the fake does not know it, so its 401 persists and the batch halts on the first page
  const r3 = await run(['--content', 'site-d', '--concurrency', '1', '--retries', '1'], { token: FUTURE_JWT });
  assert.equal(r3.code, 3, r3.out + r3.err);
  assert.doesNotMatch(r3.err, /is expired/);
  assert.match(r3.err, /^\[1\/2\] HALT \/d1 \(put 401 after 2 attempts/m);
  assert.equal(since(from).length, 2, 'two PUT attempts on the first page, then the halt');
  assert.equal(ledgerOf('site-d')['/d1'].status, 'pending'); assert.equal(ledgerOf('site-d')['/d2'], undefined);
});

// ---- (e) a persistent 5xx is a per-page failure, not a halt ---------------------------------------------
await check('a 5xx that persists through --retries is a per-page FAIL (put-fail, exit 1) and the batch runs on; the re-run re-drives only the failures and a 5xx that clears lands', async () => {
  site('site-e', ['e1', 'e3', 'flaky', 'recover']);
  const from = requests.length;
  const r = await run(['--content', 'site-e', '--concurrency', '1', '--retries', '1']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^\[1\/4\] OK {3}\/e1 \(live\)$/m); assert.match(r.err, /^\[2\/4\] OK {3}\/e3 \(live\)$/m);
  assert.match(r.err, /^\[3\/4\] FAIL \/flaky \(put-fail\)$/m); assert.match(r.err, /^\[4\/4\] FAIL \/recover \(put-fail\)$/m);
  assert.match(r.err, /^\[deploy-batch\] done\. 2 ok, 2 failed\.$/m);
  assert.match(r.err, /^FAILS \(re-run the same command to re-drive — succeeded pages are skipped\):$/m);
  assert.match(r.err, /^ {2}\/flaky {2}put-fail {2}PUT 503 unavailable$/m);
  assert.doesNotMatch(r.err, /HALT|halted|401/);
  assert.equal(touching(since(from), '/flaky').length, 2, '1 + 1 retry');
  const l = ledgerOf('site-e');
  assert.equal(l['/flaky'].status, 'put-fail'); assert.equal(l['/flaky'].put, 503); assert.equal(l['/flaky'].lastError, 'PUT 503 unavailable'); assert.equal(l['/flaky'].attempts, 1);
  assert.equal(l['/e1'].status, 'live');
  const fail = logOf('site-e').find((e) => e.path === '/flaky');
  assert.deepEqual({ step: fail.step, status: fail.status, attempts: fail.attempts, halt: fail.halt }, { step: 'put', status: 503, attempts: 2, halt: undefined });
  // re-run with more retries: e1/e3 skipped (already live), recover clears on its third attempt, flaky still fails
  count.put = {};
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-e', '--concurrency', '1', '--retries', '4']);
  assert.equal(r2.code, 1, r2.out + r2.err);
  assert.match(r2.err, /4 pages, 2 already live, 2 to drive/);
  assert.match(r2.err, /^\[\d\/2\] OK {3}\/recover \(live\)$/m); assert.match(r2.err, /^\[\d\/2\] FAIL \/flaky \(put-fail\)$/m);
  assert.match(r2.err, /done\. 1 ok, 1 failed\./);
  assert.equal(touching(since(from2), '/recover').filter((q) => q.method === 'PUT').length, 3, '503, 503, 201');
  assert.equal(touching(since(from2), '/flaky').length, 5, '1 + 4 retries');
  const l2 = ledgerOf('site-e');
  assert.equal(l2['/recover'].status, 'live'); assert.equal(l2['/recover'].attempts, 2); assert.equal(l2['/flaky'].status, 'put-fail'); assert.equal(l2['/flaky'].attempts, 2);
});

// ---- usage, --help --------------------------------------------------------------------------------------
await check('usage errors exit 2 (unknown flag, missing --org/--repo/--branch, no token) with nothing sent; --help prints the header, exits 0, writes nothing', async () => {
  const from = requests.length;
  const bad = async (args, re, opts) => { const r = await run(args, opts); assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, re); };
  await bad(['--content', 'site-a', '--bogus'], /^\[deploy-batch\] fatal: unknown arg: --bogus$/m);
  // the default token path (no flag) names $ADOBE_IMS_TOKEN_FILE and DA_TOKEN; an explicit --token-env names only it
  await bad(['--content', 'site-a'], /fatal: missing token — set \$ADOBE_IMS_TOKEN_FILE to a token file or DA_TOKEN in the env \(or pass --token-file \/ --token-env\)/, { token: null });
  await bad(['--content', 'site-a', '--token-env', 'OTHER'], /fatal: missing token in env OTHER/);
  await bad(['--content', 'site-a', '--verify-max-age', 'x'], /^\[deploy-batch\] fatal: --verify-max-age takes minutes, a number ≥ 0 \(got x\)$/m);
  await bad(['--content', 'site-a', '--verify-max-age', '-5'], /fatal: --verify-max-age takes minutes, a number ≥ 0 \(got -5\)$/m);
  await bad(['--content', 'site-a', '--verify-max-age'], /fatal: --verify-max-age takes minutes, a number ≥ 0 \(got nothing\)$/m);
  // --org absent and no rollout.json to default it from: exit 2, the error names the missing flag and the file it read
  const p = spawn(process.execPath, [SCRIPT, '--repo', REPO, '--branch', BRANCH], { cwd: proj, env: { ...process.env, DA_TOKEN: TOKEN, ADOBE_IMS_TOKEN_FILE: '', ROLLOUT_CONFIG: join(proj, 'none.json') } });
  const noOrg = await new Promise((resolve) => { let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => resolve({ code, err })); });
  assert.equal(noOrg.code, 2); assert.match(noOrg.err, /--org required — not given and .*none\.json not found/); allOutput.push(noOrg.err);
  assert.equal(requests.length, from, 'no request left the process');
  const scratch = mkdtempSync(join(tmpdir(), 'deploy-batch-help-'));
  const h = spawn(process.execPath, [SCRIPT, '--help'], { cwd: scratch, env: { ...process.env, DA_TOKEN: '' } });
  const help = await new Promise((resolve) => { let out = ''; h.stdout.on('data', (d) => { out += d; }); h.on('close', (code) => resolve({ code, out })); });
  assert.equal(help.code, 0); assert.match(help.out, /^deploy-batch\.mjs — resumable, concurrent PUT → preview → live driver for DA\./);
  assert.match(help.out, /Exit codes: 0 every page live/); assert.match(help.out, /3 token halt/); assert.match(help.out, /DA_SOURCE_BASE/); assert.match(help.out, /--backoff-ms/);
  assert.match(help.out, /\[--verify-max-age 60\]/); assert.match(help.out, /^--verify-max-age {2}minutes/m); assert.match(help.out, /contentSha/);
  assert.deepEqual(readdirSync(scratch), [], '--help wrote nothing'); rmSync(scratch, { recursive: true, force: true });
});

// ---- (g) --token-file <path> ----------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
await check('--token-file <path> reads the token from the file once at start (trailing newline ignored; DA_TOKEN unset); the expiry and HALT lines name the file and the re-run command carries no <var>= prefix; the same command resumes once the file is fresh', async () => {
  const tokenFile = join(proj, 'da-token'); writeFileSync(tokenFile, `${TOKEN}\n`);
  site('site-f', ['f1']);
  const from = requests.length;
  const r = await run(['--content', 'site-f', '--token-file', tokenFile], { token: null });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[1\/1\] OK {3}\/f1 \(live\)$/m);
  const admin = since(from).filter((q) => q.method !== 'GET');
  assert.equal(admin.length, 3, 'PUT, preview, live');
  for (const q of admin) assert.equal(q.headers.authorization, `Bearer ${TOKEN}`, 'the file value without its newline');
  assert.equal(ledgerOf('site-f')['/f1'].status, 'live');
  // a 401 that persists: the HALT line names the file and says how to refresh it; no `<var>=<fresh token>` prefix
  site('site-f2', ['g-dead']);
  const h = await run(['--content', 'site-f2', '--retries', '1', '--token-file', tokenFile], { token: null });
  assert.equal(h.code, 3, h.out + h.err);
  assert.match(h.err, /^\[1\/1\] HALT \/g-dead \(put 401 after 2 attempts — status kept pending, not failed\)$/m);
  const halts = haltLines(h.err);
  assert.equal(halts.length, 1, `one HALT line: ${h.err}`);
  assert.match(halts[0], new RegExp(`^HALT /g-dead 401 after 2 attempts — write a fresh token to ${esc(tokenFile)} and re-run: node \\S+deploy-batch\\.mjs --org ${ORG} --repo ${REPO} --branch ${BRANCH} --backoff-ms 1 --content site-f2 --retries 1 --token-file ${esc(tokenFile)}   \\(after writing the fresh token to ${esc(tokenFile)}\\)$`));
  assert.doesNotMatch(h.err, /<fresh token>|DA_TOKEN/);
  assert.equal(ledgerOf('site-f2')['/g-dead'].status, 'pending', 'never put-fail because of a 401');
  // an expired JWT in the file: exit 3 before any request, the line names the file
  writeFileSync(tokenFile, `${EXPIRED_JWT}\n`);
  const from2 = requests.length;
  const x = await run(['--content', 'site-f2', '--token-file', tokenFile], { token: null });
  assert.equal(x.code, 3, x.out + x.err);
  assert.equal(x.err.trim().split('\n').length, 1, x.err);
  assert.match(x.err, new RegExp(`^\\[deploy-batch\\] the token in ${esc(tokenFile)} is expired — its exp claim is ${new Date(EXPIRED_EXP * 1000).toISOString().replace(/[.]/g, '\\.')} \\(\\d+ min ago\\); nothing was sent\\. Refresh it and re-run: node \\S+deploy-batch\\.mjs .* --content site-f2 --token-file ${esc(tokenFile)}   \\(after writing the fresh token to ${esc(tokenFile)}\\)$`, 'm'));
  assert.doesNotMatch(x.err, /<fresh token>|DA_TOKEN/);
  assert.equal(requests.length, from2, 'no request left the process');
  // the same command resumes once the file holds a fresh token
  writeFileSync(tokenFile, FRESH_TOKEN);
  const r2 = await run(['--content', 'site-f2', '--retries', '1', '--token-file', tokenFile], { token: null });
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, /done\. 1 ok, 0 failed\./);
  assert.equal(ledgerOf('site-f2')['/g-dead'].status, 'live'); assert.equal(ledgerOf('site-f2')['/g-dead'].attempts, 2);
});
await check('--token-file usage errors exit 2 with nothing sent: together with --token-env, a missing file (named), an empty file (named) — DA_TOKEN in the environment does not stand in; --help names the flag', async () => {
  const from = requests.length;
  const tokenFile = join(proj, 'da-token'); writeFileSync(tokenFile, TOKEN);
  const both = await run(['--content', 'site-f', '--token-file', tokenFile, '--token-env', 'X'], { token: null });
  assert.equal(both.code, 2, both.out + both.err); assert.match(both.err, /^\[deploy-batch\] fatal: give at most one of --token-env \/ --token-file$/m);
  const missing = join(proj, 'no-such-token');
  const miss = await run(['--content', 'site-f', '--token-file', missing], { token: TOKEN });
  assert.equal(miss.code, 2, miss.out + miss.err); assert.match(miss.err, new RegExp(`^\\[deploy-batch\\] fatal: cannot read --token-file ${esc(missing)}: `, 'm'));
  writeFileSync(tokenFile, '  \n');
  const empty = await run(['--content', 'site-f', '--token-file', tokenFile], { token: TOKEN });
  assert.equal(empty.code, 2, empty.out + empty.err); assert.match(empty.err, new RegExp(`^\\[deploy-batch\\] fatal: --token-file ${esc(tokenFile)} is empty$`, 'm'));
  assert.equal(requests.length, from, 'no request left the process');
  const help = await run(['--help']); assert.equal(help.code, 0); assert.match(help.out, /--token-env DA_TOKEN \| --token-file <path>/); assert.match(help.out, /--token-file read the token from this file instead/);
});

// ---- (h) --org/--repo/--branch default from rollout.json site.da ----------------------------------------
await check('--org/--repo/--branch default from rollout.json site.da (explicit flags win); the resolved line names each source; ref defaults to main; a missing/absent site.da errors clearly naming the file and fields', async () => {
  site('site-g', ['g1', 'g2']);
  const cfg = join(proj, 'rollout-g.json');
  writeFileSync(cfg, JSON.stringify({ site: { da: { org: ORG, site: REPO, ref: BRANCH } } }));
  // no --org/--repo/--branch: all three come from site.da and the page lands on the fake's org/repo/branch
  const from = requests.length;
  const r = await run(['--content', 'site-g'], { coords: false, rolloutConfig: cfg });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[\d\/2\] OK {3}\/g1 \(live\)$/m); assert.match(r.err, /^\[\d\/2\] OK {3}\/g2 \(live\)$/m);
  assert.match(r.err, new RegExp(`^\\[deploy-batch\\] resolved: org ${ORG} \\(from ${esc(cfg)} site\\.da\\.org\\), repo ${REPO} \\(from ${esc(cfg)} site\\.da\\.site\\), branch ${BRANCH} \\(from ${esc(cfg)} site\\.da\\.ref\\), token env DA_TOKEN$`, 'm'));
  for (const q of since(from).filter((x) => x.method !== 'GET')) assert.ok(q.url.startsWith(`${SRC}/`) || q.url.startsWith(PREVIEW) || q.url.startsWith(LIVE), q.url);
  // an explicit flag wins: --repo REPO beats a config that names REPO_B (the request goes to REPO, not REPO_B)
  const cfgB = join(proj, 'rollout-b.json');
  writeFileSync(cfgB, JSON.stringify({ site: { da: { org: ORG, site: REPO_B, ref: BRANCH } } }));
  const from1 = requests.length;
  const r1 = await run(['--content', 'site-g', '--repo', REPO, '--force'], { coords: false, rolloutConfig: cfgB });
  assert.equal(r1.code, 0, r1.out + r1.err);
  assert.match(r1.err, new RegExp(`resolved: org ${ORG} \\(from ${esc(cfgB)} site\\.da\\.org\\), repo ${REPO} \\(from --flag\\), branch ${BRANCH} \\(from ${esc(cfgB)} site\\.da\\.ref\\)`));
  assert.equal(since(from1).filter((q) => q.url.includes(REPO_B)).length, 0, 'the explicit --repo wins over the config');
  // ref absent → branch defaults to main (= BRANCH); the resolved line marks it the schema default
  const cfgNoRef = join(proj, 'rollout-noref.json');
  writeFileSync(cfgNoRef, JSON.stringify({ site: { da: { org: ORG, site: REPO } } }));
  const r2 = await run(['--content', 'site-g', '--force'], { coords: false, rolloutConfig: cfgNoRef });
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, new RegExp(`branch ${BRANCH} \\(from ${esc(cfgNoRef)} site\\.da\\.ref default\\)`));
  // a missing rollout.json: exit 2, names every missing flag and the file
  const r3 = await run(['--content', 'site-g'], { coords: false, rolloutConfig: join(proj, 'no-rollout.json'), token: TOKEN });
  assert.equal(r3.code, 2, r3.out + r3.err);
  assert.match(r3.err, new RegExp(`fatal: --org, --repo, --branch required — not given and ${esc(join(proj, 'no-rollout.json'))} not found; pass the flag\\(s\\) or set site\\.da\\.org / site\\.da\\.site / site\\.da\\.ref in `));
  // a rollout.json without site.da: names it
  const cfgEmpty = join(proj, 'rollout-empty.json'); writeFileSync(cfgEmpty, JSON.stringify({ site: {} }));
  const r4 = await run(['--content', 'site-g'], { coords: false, rolloutConfig: cfgEmpty, token: TOKEN });
  assert.equal(r4.code, 2, r4.out + r4.err); assert.match(r4.err, new RegExp(`required — not given and ${esc(cfgEmpty)} has no site\\.da`));
  // site.da present but missing org: only --org is required, named with the field
  const cfgNoOrg = join(proj, 'rollout-noorg.json'); writeFileSync(cfgNoOrg, JSON.stringify({ site: { da: { site: REPO, ref: BRANCH } } }));
  const r5 = await run(['--content', 'site-g'], { coords: false, rolloutConfig: cfgNoOrg, token: TOKEN });
  assert.equal(r5.code, 2, r5.out + r5.err); assert.match(r5.err, new RegExp(`fatal: --org required — not given and ${esc(cfgNoOrg)} site\\.da is missing site\\.da\\.org`));
});

// ---- (i) --token-file defaults to $ADOBE_IMS_TOKEN_FILE -------------------------------------------------
await check('with no token flag, the token comes from the file named by $ADOBE_IMS_TOKEN_FILE; the resolved, expiry and HALT lines name the file and the variable; the value never leaks', async () => {
  const tf = join(proj, 'ims-token'); writeFileSync(tf, `${TOKEN}\n`);
  site('site-i', ['i1']);
  const from = requests.length;
  const r = await run(['--content', 'site-i'], { token: null, imsFile: tf });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[1\/1\] OK {3}\/i1 \(live\)$/m);
  assert.match(r.err, new RegExp(`resolved: .* token file ${esc(tf)} \\(from \\$ADOBE_IMS_TOKEN_FILE\\)$`, 'm'));
  assert.equal(since(from).filter((q) => q.method !== 'GET').every((q) => q.headers.authorization === `Bearer ${TOKEN}`), true, 'the file token authorised the admin calls');
  // a 401 that persists: the HALT line names the file and the variable, no <var>=<fresh> prefix
  site('site-i2', ['i-dead']);
  const h = await run(['--content', 'site-i2', '--retries', '1'], { token: null, imsFile: tf });
  assert.equal(h.code, 3, h.out + h.err);
  assert.match(haltLines(h.err)[0], new RegExp(`write a fresh token to ${esc(tf)} \\(from \\$ADOBE_IMS_TOKEN_FILE\\) and re-run: node `));
  assert.doesNotMatch(h.err, /<fresh token>/);
  // an expired JWT in the file: exit 3 before any request, one line naming the file and the variable
  writeFileSync(tf, `${EXPIRED_JWT}\n`);
  const from2 = requests.length;
  const x = await run(['--content', 'site-i2', '--force'], { token: null, imsFile: tf });
  assert.equal(x.code, 3, x.out + x.err);
  assert.equal(x.err.trim().split('\n').length, 1, x.err);
  assert.match(x.err, new RegExp(`^\\[deploy-batch\\] the token in ${esc(tf)} \\(from \\$ADOBE_IMS_TOKEN_FILE\\) is expired — `));
  assert.equal(requests.length, from2, 'nothing was sent');
});

// ---- (f) the token never leaks ---------------------------------------------------------------------------
await check('the token value never appears on stdout, stderr, in any ledger or any log', () => {
  assert.ok(allOutput.length > 20);
  for (const s of allOutput) for (const secret of SECRETS) assert.ok(!s.includes(secret), `token leaked to output: ${s.slice(0, 200)}`);
  const files = [];
  (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.deploy-(ledger\.json|log\.jsonl)$/.test(e)) files.push(p); } })(proj);
  assert.ok(files.length >= 10, `ledgers and logs found: ${files.length}`);
  for (const f of files) { const text = readFileSync(f, 'utf8'); for (const secret of SECRETS) assert.ok(!text.includes(secret), `token leaked to ${f}`); }
});

server.close();
rmSync(proj, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\ndeploy-batch: all checks passed');
process.exit(failed ? 1 : 0);
