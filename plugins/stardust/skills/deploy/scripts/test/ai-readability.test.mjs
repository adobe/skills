#!/usr/bin/env node
// skills/deploy/scripts/test/ai-readability.test.mjs — the site secret in the AI-readability gate: neither
// ai-readability script sets it context-wide (extraHTTPHeaders); attachOriginAuth adds it only to requests for the
// exact site origin (look-alike hosts, userinfo URLs, other ports and schemes get nothing); scorePage refuses a path
// that resolves off the origin before any request; with playwright in the project, a real page's third-party
// request carries no secret. Redirect scoping of the raw requests: ai-readability-redirect.test.mjs.
// Run: node plugins/stardust/skills/deploy/scripts/test/ai-readability.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachOriginAuth, scorePage } from '../ai-readability.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = 'token fixture';
let checks = 0; let failed = 0;
const report = (name, e) => { checks += 1; if (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } else console.log(`✓ ${name}`); };
const checkAsync = async (name, fn) => { try { await fn(); report(name); } catch (e) { report(name, e); } };

await checkAsync('neither ai-readability script puts the secret in context-wide extraHTTPHeaders', async () => {
  for (const f of ['../ai-readability.mjs', '../../../qa/scripts/checks/ai-readability.mjs']) {
    assert.doesNotMatch(readFileSync(join(HERE, f), 'utf8'), /extraHTTPHeaders\s*:/, f);
  }
});

await checkAsync('attachOriginAuth adds the secret to the exact site origin only', async () => {
  let handler;
  await attachOriginAuth({ route: async (pattern, fn) => { handler = fn; } }, 'https://site.test', SECRET);
  const sent = async (url) => {
    let out;
    await handler({ request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }), continue: (o = {}) => { out = o.headers?.authorization ?? null; } });
    return out;
  };
  assert.equal(await sent('https://site.test/page'), SECRET);
  assert.equal(await sent('https://site.test'), SECRET);
  for (const u of ['https://site.test.evil.test/x', 'https://site.test@evil.test/x', 'https://site.test-evil.test/', 'https://site.test:8443/', 'http://site.test/', 'https://evil.test/']) {
    assert.equal(await sent(u), null, u);
  }
});

await checkAsync('attachOriginAuth with no secret registers nothing', async () => {
  let routed = false;
  await attachOriginAuth({ route: async () => { routed = true; } }, 'https://site.test', null);
  assert.equal(routed, false);
});

await checkAsync('scorePage refuses a path that leaves the origin, before any request', async () => {
  const ctx = { newPage: async () => { throw new Error('opened a page'); }, request: { get: async () => { throw new Error('sent a request'); } } };
  const r = await scorePage(ctx, 'https://site.test', '@evil.test/x', { headers: { authorization: SECRET } });
  assert.deepEqual(r, { path: '@evil.test/x', error: 'path leaves the origin' });
});

let chromium;
try { const m = await import(pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')).href); chromium = m.chromium || m.default?.chromium; } catch { /* no playwright in this project */ }
if (chromium) {
  await checkAsync('in a real page, the site gets the secret and a third-party request does not', async () => {
    const hits = [];
    const listen = (name, body) => new Promise((res) => { const srv = createServer((q, r) => { hits.push({ name, path: q.url, auth: q.headers.authorization || null }); r.writeHead(200, { 'content-type': 'text/html' }); r.end(body(srv)); }).listen(0, '127.0.0.1', () => res(srv)); });
    const other = await listen('other', () => 'x');
    const site = await listen('site', () => `<img src="http://localhost:${other.address().port}/pixel.gif"><img src="/own.gif">`);
    const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'] });
    try {
      const context = await browser.newContext();
      await attachOriginAuth(context, `http://127.0.0.1:${site.address().port}`, SECRET);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${site.address().port}/page`, { waitUntil: 'load' });
      await page.waitForTimeout(200);
      assert.deepEqual(hits.filter((h) => h.name === 'site').map((h) => [h.path, h.auth]), [['/page', SECRET], ['/own.gif', SECRET]]);
      assert.deepEqual(hits.filter((h) => h.name === 'other').map((h) => [h.path, h.auth]), [['/pixel.gif', null]]);
    } finally { await browser.close(); site.close(); other.close(); }
  });
} else console.log('- browser check skipped: no playwright in this project (run from a project copy)');

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nai-readability: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
