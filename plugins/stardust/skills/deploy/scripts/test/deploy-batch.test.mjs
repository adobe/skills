#!/usr/bin/env node
// skills/deploy/scripts/test/deploy-batch.test.mjs — the deploy-batch.mjs contract against a local fake
// of its three hosts (one node http server on a random port standing in for the DA source API, the
// admin API and the delivered origin; no network): PUT → preview → live → .plain.html verify with the
// multipart field, the Authorization header and the ledger row; the already-live skip on re-run;
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
import { randomBytes } from 'node:crypto';
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
      return putOk.has(p) ? reply(200, '<div><p>delivered</p></div>', { 'content-type': 'text/html' }) : reply(404, 'not found');
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
const run = (args, { token = TOKEN, tokenEnv = 'DA_TOKEN' } = {}) => new Promise((resolve) => {
  const env = { ...process.env, DA_SOURCE_BASE: `${BASE}/source`, AEM_ADMIN_BASE: BASE, DEPLOY_VERIFY_ORIGIN: BASE };
  delete env.DA_TOKEN; if (token) env[tokenEnv] = token;
  const p = spawn(process.execPath, [SCRIPT, '--org', ORG, '--repo', REPO, '--branch', BRANCH, '--backoff-ms', '1', ...args], { cwd: proj, env });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => { allOutput.push(out, err); resolve({ code, out, err }); });
});
const ledgerOf = (dir) => JSON.parse(readFileSync(join(proj, dir, '.deploy-ledger.json'), 'utf8'));
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
  assert.ok(readFileSync(join(proj, 'site-a', '.deploy-ledger.json'), 'utf8').endsWith('}\n'), 'trailing newline');
  assert.deepEqual(readdirSync(join(proj, 'site-a')).filter((f) => f.startsWith('.')).sort(), ['.deploy-ledger.json', '.deploy-log.jsonl'], 'no tmp file, no lock dir left');
  const log = logOf('site-a');
  assert.equal(log.length, 2); assert.ok(log.every((e) => e.step === 'verify' && e.ok === true && e.t));
});
await check('re-run skips pages already live (re-verified on the delivered origin, no admin call); --force re-drives them', async () => {
  const from = requests.length;
  const r = await run(['--content', 'site-a']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /^\[deploy-batch\] 2 pages, 2 already live, 0 to drive/m); assert.match(r.err, /done\. 0 ok, 0 failed\./);
  assert.deepEqual(since(from).map((q) => `${q.method} ${q.url}`).sort(), ['GET /a1.plain.html', 'GET /nested/a2.plain.html']);
  const from2 = requests.length;
  const r2 = await run(['--content', 'site-a', '--force']);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.err, /2 pages, 0 already live, 2 to drive/);
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
  await bad(['--content', 'site-a'], /fatal: missing token in env DA_TOKEN/, { token: null });
  await bad(['--content', 'site-a', '--token-env', 'OTHER'], /fatal: missing token in env OTHER/);
  const p = spawn(process.execPath, [SCRIPT, '--repo', REPO, '--branch', BRANCH], { cwd: proj, env: { ...process.env, DA_TOKEN: TOKEN } });
  const noOrg = await new Promise((resolve) => { let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => resolve({ code, err })); });
  assert.equal(noOrg.code, 2); assert.match(noOrg.err, /--org, --repo and --branch are required/); allOutput.push(noOrg.err);
  assert.equal(requests.length, from, 'no request left the process');
  const scratch = mkdtempSync(join(tmpdir(), 'deploy-batch-help-'));
  const h = spawn(process.execPath, [SCRIPT, '--help'], { cwd: scratch, env: { ...process.env, DA_TOKEN: '' } });
  const help = await new Promise((resolve) => { let out = ''; h.stdout.on('data', (d) => { out += d; }); h.on('close', (code) => resolve({ code, out })); });
  assert.equal(help.code, 0); assert.match(help.out, /^deploy-batch\.mjs — resumable, concurrent PUT → preview → live driver for DA\./);
  assert.match(help.out, /Exit codes: 0 every page live/); assert.match(help.out, /3 token halt/); assert.match(help.out, /DA_SOURCE_BASE/); assert.match(help.out, /--backoff-ms/);
  assert.deepEqual(readdirSync(scratch), [], '--help wrote nothing'); rmSync(scratch, { recursive: true, force: true });
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
