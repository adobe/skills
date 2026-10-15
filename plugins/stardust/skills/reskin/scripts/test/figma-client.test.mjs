#!/usr/bin/env node
// skills/reskin/scripts/test/figma-client.test.mjs — Figma URL parsing and the REST client against a
// local fake of the API (node http on a random port; no network): accepted URL forms and branch keys,
// the X-Figma-Token header and query encoding, 401/403 → exit 3 with what to check, 404 and 400 → exit 2,
// 429 honored up to --max-wait and refused beyond it with the plan headers, 5xx retried then exit 3,
// image bytes fetched without the token, and the token redacted from every error message.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFigmaUrl, canonicalFigmaUrl } from '../figma/url.mjs';
import { createClient, redact } from '../figma/client.mjs';
import { FigmaError, UsageError } from '../figma/errors.mjs';
import { startFakeFigma } from './fixtures/figma-kit/fake-figma.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const KEY = 'AbCdEf1234567890';
const TOKEN = `tok-${randomBytes(12).toString('hex')}`;
const fixtureDir = mkdtempSync(join(tmpdir(), 'figma-client-test-'));
writeFileSync(join(fixtureDir, 'file.json'), JSON.stringify({ name: 'Kit', version: 'v1', document: { id: '0:0', type: 'DOCUMENT', children: [] } }));
writeFileSync(join(fixtureDir, 'frame.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
const fake = await startFakeFigma({ fixtureDir, token: TOKEN, behaviors: {} });
const FILE = `/v1/files/${KEY}`;
const sleeps = [];
const client = (opts = {}) => createClient({ token: TOKEN, base: fake.base, maxRetries: 3, maxWaitSec: 60, sleep: async (ms) => { sleeps.push(ms); }, ...opts });
const reset = () => { fake.requests.length = 0; sleeps.length = 0; for (const k of Object.keys(fake.behaviors)) delete fake.behaviors[k]; };
const rejects = async (p, test) => { let err; try { await p; } catch (e) { err = e; } assert.ok(err, 'expected a rejection'); test(err); return err; };

// ---- url -------------------------------------------------------------------------------------------------
await check('parseFigmaUrl: design URL with a dashed node-id', () => {
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/design/${KEY}/Kit?node-id=12-34`), { fileKey: KEY, mainFileKey: KEY, nodeId: '12:34' });
});
await check('parseFigmaUrl: file URL with an encoded colon; proto URL without a node', () => {
  assert.equal(parseFigmaUrl(`https://www.figma.com/file/${KEY}/Kit?node-id=12%3A34`).nodeId, '12:34');
  assert.equal(parseFigmaUrl(`https://www.figma.com/proto/${KEY}/Kit`).nodeId, null);
  assert.equal(parseFigmaUrl(`https://figma.com/design/${KEY}`).fileKey, KEY);
});
await check('parseFigmaUrl: branch URL reads the branch key and keeps the main key', () => {
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/design/${KEY}/branch/BrAnCh1234567890/Kit`), { fileKey: 'BrAnCh1234567890', mainFileKey: KEY, nodeId: null });
});
await check('parseFigmaUrl: a bare file key is accepted', () => {
  assert.deepEqual(parseFigmaUrl(KEY), { fileKey: KEY, mainFileKey: KEY, nodeId: null });
});
await check('parseFigmaUrl: a non-Figma URL or a bad node-id is a usage error listing the accepted forms', () => {
  assert.throws(() => parseFigmaUrl('https://example.com/design/x'), (e) => e instanceof UsageError && e.code === 2 && /figma\.com\/design/.test(e.message));
  assert.throws(() => parseFigmaUrl(`https://www.figma.com/design/${KEY}/Kit?node-id=abc`), (e) => e.code === 2 && /node-id/.test(e.message));
  assert.throws(() => parseFigmaUrl(''), (e) => e.code === 2);
});
await check('canonicalFigmaUrl: design form with a dashed node-id', () => {
  assert.equal(canonicalFigmaUrl({ fileKey: KEY, nodeId: '12:34' }), `https://www.figma.com/design/${KEY}?node-id=12-34`);
  assert.equal(canonicalFigmaUrl({ fileKey: KEY, nodeId: null }), `https://www.figma.com/design/${KEY}`);
});

// ---- client ----------------------------------------------------------------------------------------------
await check('getJson sends X-Figma-Token and the query, ids encoded once', async () => {
  reset();
  const body = await client().getJson(FILE, { depth: 2, ids: ['1:2', '3:4'] });
  assert.equal(body.version, 'v1');
  const [r] = fake.requests;
  assert.equal(r.headers['x-figma-token'], TOKEN);
  assert.equal(r.query.depth, '2');
  assert.equal(r.query.ids, '1:2,3:4');
  assert.ok(!r.rawUrl.includes('%25'), `double-encoded: ${r.rawUrl}`);
});
await check('no token: usage error naming FIGMA_TOKEN and file_content:read, no request', async () => {
  reset();
  await rejects(createClient({ token: '', base: fake.base }).getJson(FILE), (e) => {
    assert.equal(e.code, 2);
    assert.match(e.message, /FIGMA_TOKEN/);
    assert.match(e.message, /file_content:read/);
  });
  assert.equal(fake.requests.length, 0);
});
await check('401 → exit 3, message lists token, expiry, scope and sharing', async () => {
  reset();
  fake.behaviors[FILE] = { status: 401, body: { status: 401, err: 'Unauthorized' } };
  await rejects(client().getJson(FILE), (e) => {
    assert.ok(e instanceof FigmaError);
    assert.equal(e.exitCode, 3);
    assert.equal(e.status, 401);
    for (const re of [/FIGMA_TOKEN/, /expir/i, /file_content:read/, /shared/i]) assert.match(e.message, re);
  });
  assert.equal(fake.requests.length, 1, 'auth failures are not retried');
});
await check('403 from the fake on a wrong token → exit 3', async () => {
  reset();
  await rejects(createClient({ token: 'wrong-token-value', base: fake.base, sleep: async () => {} }).getJson(FILE), (e) => {
    assert.equal(e.exitCode, 3);
    assert.equal(e.status, 403);
  });
});
await check('404 → exit 2 naming the file key and node-id', async () => {
  reset();
  fake.behaviors[FILE] = { status: 404, body: { status: 404, err: 'Not found' } };
  await rejects(client().getJson(FILE), (e) => { assert.equal(e.exitCode, 2); assert.match(e.message, /node-id|file key/i); });
});
await check('400 → exit 2 carrying Figma\'s reason', async () => {
  reset();
  fake.behaviors[FILE] = { status: 400, body: { status: 400, err: 'Invalid parameter: ids' } };
  await rejects(client().getJson(FILE), (e) => { assert.equal(e.exitCode, 2); assert.match(e.message, /Invalid parameter: ids/); });
});
await check('429 with Retry-After 1 then 200 → resolves after one sleep(1000)', async () => {
  reset();
  fake.behaviors[FILE] = [{ status: 429, headers: { 'retry-after': '1' }, body: { status: 429, err: 'Rate limit exceeded' } }];
  const body = await client().getJson(FILE);
  assert.equal(body.version, 'v1');
  assert.deepEqual(sleeps, [1000]);
  assert.equal(fake.requests.length, 2);
});
await check('429 with Retry-After beyond --max-wait → exit 3 at once, plan headers quoted, no sleep', async () => {
  reset();
  fake.behaviors[FILE] = { status: 429, headers: { 'retry-after': '3600', 'x-figma-plan-tier': 'starter', 'x-figma-rate-limit-type': 'low', 'x-figma-upgrade-link': 'https://www.figma.com/pricing' }, body: { status: 429, err: 'Rate limit exceeded' } };
  const c = client();
  await rejects(c.getJson(FILE), (e) => {
    assert.equal(e.exitCode, 3);
    assert.equal(e.status, 429);
    for (const s of ['3600', 'starter', 'low', 'https://www.figma.com/pricing', '--max-wait']) assert.ok(e.message.includes(s), `missing ${s}: ${e.message}`);
    assert.equal(e.info.planTier, 'starter');
  });
  assert.deepEqual(sleeps, []);
  assert.equal(fake.requests.length, 1);
  assert.equal(c.planTier, 'starter');
});
await check('503 four times → exit 3 after maxRetries, with capped exponential backoff', async () => {
  reset();
  fake.behaviors[FILE] = { status: 503, body: 'unavailable' };
  await rejects(client({ maxWaitSec: 3 }).getJson(FILE), (e) => { assert.equal(e.exitCode, 3); assert.equal(e.status, 503); });
  assert.equal(fake.requests.length, 4);
  assert.deepEqual(sleeps, [1000, 2000, 3000]);
});
await check('503 then 200 → recovers', async () => {
  reset();
  fake.behaviors[FILE] = [{ status: 503, body: 'unavailable' }];
  assert.equal((await client().getJson(FILE)).version, 'v1');
  assert.equal(fake.requests.length, 2);
});
await check('connection refused → exit 3 after retries', async () => {
  reset();
  const dead = await startFakeFigma({ fixtureDir, token: TOKEN, behaviors: {} });
  const deadBase = dead.base;
  await dead.close();
  await rejects(createClient({ token: TOKEN, base: deadBase, maxRetries: 1, sleep: async () => {} }).getJson(FILE), (e) => { assert.equal(e.exitCode, 3); });
});
await check('getBytes on a non-API URL sends no X-Figma-Token', async () => {
  reset();
  const bytes = await client().getBytes(`${fake.base}/img/frame.png`);
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes[1], 0x50);
  assert.equal(fake.requests[0].headers['x-figma-token'], undefined);
});
await check('getBytes failure → FigmaError without the signed URL\'s query', async () => {
  reset();
  await rejects(client({ maxRetries: 0 }).getBytes(`${fake.base}/img/missing.png?X-Amz-Signature=secret-sig`), (e) => {
    assert.ok(e instanceof FigmaError);
    assert.equal(e.exitCode, 3);
    assert.ok(!e.message.includes('secret-sig'), e.message);
    assert.ok(!/FIGMA_TOKEN/.test(e.message), 'storage refusals are not token advice');
  });
});
await check('a redirect on a token-bearing request is refused, never followed with the token', async () => {
  reset();
  fake.behaviors[FILE] = { status: 302, headers: { location: `${fake.base}/steal` }, body: '' };
  await rejects(client().getJson(FILE), (e) => { assert.equal(e.exitCode, 3); assert.match(e.message, /redirect/i); });
  assert.ok(!fake.requests.some((r) => r.path === '/steal'), 'redirect followed');
});
await check('FIGMA_API_BASE must be https or a loopback http URL', () => {
  assert.throws(() => createClient({ token: TOKEN, base: 'http://example.com' }), (e) => e.code === 2 && /FIGMA_API_BASE/.test(e.message));
  assert.throws(() => createClient({ token: TOKEN, base: 'not a url' }), (e) => e.code === 2);
  createClient({ token: TOKEN, base: 'https://api.figma.com' });
  createClient({ token: TOKEN, base: 'http://localhost:1234' });
});
await check('redact removes every occurrence of the token; empty token is a no-op', () => {
  const out = redact(`a ${TOKEN} b ${TOKEN}`, TOKEN);
  assert.ok(!out.includes(TOKEN));
  assert.equal(redact('plain', ''), 'plain');
});
await check('every FigmaError message is redacted, even when Figma echoes the token', async () => {
  reset();
  fake.behaviors[FILE] = { status: 400, body: { status: 400, err: `bad header ${TOKEN}` } };
  await rejects(client().getJson(FILE), (e) => { assert.ok(!e.message.includes(TOKEN)); assert.ok(!JSON.stringify(e.info).includes(TOKEN)); });
  fake.behaviors[FILE] = { status: 401, body: { status: 401, err: `token ${TOKEN} expired` } };
  await rejects(client().getJson(FILE), (e) => assert.ok(!e.message.includes(TOKEN)));
});

await fake.close();
rmSync(fixtureDir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
