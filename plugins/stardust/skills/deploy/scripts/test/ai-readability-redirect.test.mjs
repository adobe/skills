import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { scorePage } from '../ai-readability.mjs';

let chromium;
try {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const mod = await import(pathToFileURL(require.resolve('playwright')).href);
  chromium = mod.chromium || mod.default?.chromium;
} catch {}
const credential = 'token test-only-placeholder';
const browserTest = { skip: chromium ? false : 'Playwright is not available from the project', timeout: 30000 };

function mockContext(routes) {
  const hits = [];
  const page = {
    on: () => {}, goto: async () => {}, waitForFunction: async () => {},
    waitForTimeout: async () => {}, evaluate: async () => ({}), close: async () => {},
  };
  const context = {
    newPage: async () => page,
    request: { get: async (start, options) => {
      let url = start;
      for (let i = 0; i < 21; i += 1) {
        const authorized = Object.entries(options.headers || {}).some(([name, value]) => name.toLowerCase() === 'authorization' && value === credential);
        hits.push({ url, authorized, maxRedirects: options.maxRedirects });
        const entry = routes[url] || { status: 401 };
        if (entry.location && options.maxRedirects !== 0) { url = new URL(entry.location, url).href; continue; }
        return {
          status: () => entry.status,
          headers: () => (entry.location ? { location: entry.location } : {}),
          ok: () => entry.status >= 200 && entry.status < 300,
          text: async () => entry.body || '',
          dispose: async () => {},
        };
      }
      throw new Error('Too many redirects');
    } },
  };
  return { context, hits };
}

test('scored-page redirects retain auth only until leaving the site origin', async () => {
  const origin = 'https://site.test';
  const routes = {
    [`${origin}/start`]: { status: 302, location: '/same' },
    [`${origin}/same`]: { status: 302, location: 'https://outside.test/back' },
    'https://outside.test/back': { status: 302, location: `${origin}/end` },
    [`${origin}/end`]: { status: 401 },
  };
  const { context, hits } = mockContext(routes);
  const result = await scorePage(context, origin, '/start', { headers: { Authorization: credential } });
  assert.ok(result.error);
  assert.deepEqual(hits, [
    { url: `${origin}/start`, authorized: true, maxRedirects: 0 },
    { url: `${origin}/same`, authorized: true, maxRedirects: 0 },
    { url: 'https://outside.test/back', authorized: false, maxRedirects: 0 },
    { url: `${origin}/end`, authorized: false, maxRedirects: 0 },
  ]);
});

test('fragment redirects strip auth before visiting another origin', async () => {
  const origin = 'https://site.test';
  const routes = {
    [`${origin}/page`]: { status: 200, body: '<a href="/fragments/sample">fragment</a>' },
    [`${origin}/fragments/sample.plain.html`]: { status: 302, location: 'https://outside.test/fragment' },
    'https://outside.test/fragment': { status: 401 },
  };
  const { context, hits } = mockContext(routes);
  const result = await scorePage(context, origin, '/page', { headers: { authorization: credential } });
  assert.ok(!result.error);
  assert.deepEqual(hits, [
    { url: `${origin}/page`, authorized: true, maxRedirects: 0 },
    { url: `${origin}/fragments/sample.plain.html`, authorized: true, maxRedirects: 0 },
    { url: 'https://outside.test/fragment', authorized: false, maxRedirects: 0 },
  ]);
});

async function withContext(fn) {
  const hits = [];
  const outside = createServer((req, res) => {
    hits.push({ path: req.url, authorized: req.headers.authorization === credential });
    res.writeHead(req.url === '/page-target' ? 401 : 200, { 'content-type': 'text/html' });
    res.end('<html><body>outside</body></html>');
  });
  await new Promise((resolve) => outside.listen(0, '127.0.0.1', resolve));
  const originB = `http://127.0.0.1:${outside.address().port}`;
  const site = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: `${originB}/page-target` }); res.end(); return; }
    if (req.url === '/fragments/sample.plain.html') { res.writeHead(302, { location: `${originB}/fragment-target` }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Page</title></head><body><main><p>Content</p><a href="/fragments/sample">fragment</a></main></body></html>');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${site.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    try { await fn({ origin, context, hits }); } finally { await context.close(); }
  } finally {
    if (browser) await browser.close();
    await Promise.all([
      new Promise((resolve) => site.close(resolve)),
      new Promise((resolve) => outside.close(resolve)),
    ]);
  }
}

test('scored-page redirects never forward site credentials to another origin', browserTest, async () => {
  await withContext(async ({ origin, context, hits }) => {
    const result = await scorePage(context, origin, '/redirect', { headers: { authorization: credential } });
    assert.ok(result.error);
    assert.ok(hits.some((hit) => hit.path === '/page-target'));
    assert.ok(hits.every((hit) => !hit.authorized));
  });
});

test('fragment redirects never forward site credentials to another origin', browserTest, async () => {
  await withContext(async ({ origin, context, hits }) => {
    const result = await scorePage(context, origin, '/page', { headers: { authorization: credential } });
    assert.ok(!result.error);
    assert.ok(hits.some((hit) => hit.path === '/fragment-target'));
    assert.ok(hits.every((hit) => !hit.authorized));
  });
});
