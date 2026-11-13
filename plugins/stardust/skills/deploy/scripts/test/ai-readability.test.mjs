#!/usr/bin/env node
// skills/deploy/scripts/test/ai-readability.test.mjs — the site secret in the AI-readability gate: neither
// ai-readability script sets it context-wide (extraHTTPHeaders); attachOriginAuth adds it only to requests for the
// exact site origin (look-alike hosts, userinfo URLs, other ports and schemes get nothing); scorePage refuses a path
// that resolves off the origin before any request; with playwright in the project, a real page's third-party
// request carries no secret. Redirect scoping of the raw requests: ai-readability-redirect.test.mjs.
// And setup errors of the deploy gates whose exit 1 means a failed check (render-harness, ai-readability,
// qa-gate): a missing browser.mjs or a missing playwright is one line and exit 2, never exit 1.
// Run: node plugins/stardust/skills/deploy/scripts/test/ai-readability.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scorePage } from '../ai-readability.mjs';

// the front door (browser.mjs) in either layout (plugin tree / project copy)
const { attachOriginAuth } = await import(['../../../stardust/scripts/browser.mjs', '../../stardust/browser.mjs'].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u)).href);

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

// ---- setup errors exit 2: in these three gates exit 1 is the failed-check code ----
const GATES = [
  ['render-harness.mjs', 'content.html', 'out.png'],
  ['ai-readability.mjs', '--origin', 'http://localhost:9', '/'],
  ['qa-gate.mjs', 'http://localhost:9/'],
];
const FRONT_DOOR_DIR = dirname(fileURLToPath(['../../../stardust/scripts/browser.mjs', '../../stardust/browser.mjs'].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u))));
const copyDeploy = (to) => cpSync(join(HERE, '..'), to, { recursive: true, filter: (src) => !src.endsWith('/test') });
const runGate = (dir, cwd, [script, ...args]) => spawnSync(process.execPath, [join(dir, script), ...args], { cwd, encoding: 'utf8' });

await checkAsync('a copy without the master scripts: the three gates stop with the copy instruction, exit 2, no stack trace', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-no-master-'))); // real path: ai-readability compares argv[1] with import.meta.url
  try {
    const dir = join(root, 'a', 'b'); copyDeploy(dir); // no stardust/ beside or above it
    for (const gate of GATES) {
      const r = runGate(dir, dir, gate);
      assert.equal(r.status, 2, `${gate[0]}: exit ${r.status}\n${r.stderr}`);
      assert.ok(r.stderr.includes('browser.mjs not found') && r.stderr.includes('stardust/scripts/stardust/'), `${gate[0]}: ${r.stderr}`);
      assert.ok(!/^\s+at /m.test(r.stderr), `${gate[0]} printed a stack trace:\n${r.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

await checkAsync('master scripts present, playwright missing: ai-readability and qa-gate stop with the install line, exit 2, no stack trace', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-no-playwright-')));
  try {
    const dir = join(root, 'deploy'); copyDeploy(dir);
    mkdirSync(join(root, 'stardust'));
    for (const f of ['browser.mjs', 'live-session.mjs']) cpSync(join(FRONT_DOOR_DIR, f), join(root, 'stardust', f));
    for (const gate of GATES.slice(1)) {
      const r = runGate(dir, root, gate);
      assert.equal(r.status, 2, `${gate[0]}: exit ${r.status}\n${r.stderr}`);
      assert.ok(r.stderr.includes('npm i -D playwright'), `${gate[0]}: ${r.stderr}`);
      assert.ok(!/^\s+at /m.test(r.stderr), `${gate[0]} printed a stack trace:\n${r.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nai-readability: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
