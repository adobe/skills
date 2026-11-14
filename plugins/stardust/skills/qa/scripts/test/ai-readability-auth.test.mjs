import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import * as readability from '../checks/ai-readability.mjs';
import { setOriginAuth } from '../lib.mjs';

const credential = 'token test-only-placeholder';
let playwrightAvailable = false;
try { playwrightAvailable = Boolean(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')); } catch {}

test('readability targets must resolve to the base origin', () => {
  for (const [base, path] of [
    ['https://example.test', '/page'],
    ['https://EXAMPLE.test:443', '/page'],
    ['http://example.test:80', '/page'],
  ]) assert.equal(readability.isPageOnOrigin(base, path), true, `${base}${path}`);
  for (const [base, path] of [
    ['https://example.test', '.attacker.test/page'],
    ['https://example.test', '@attacker.test/page'],
    ['https://example.test', ':444/page'],
    ['https://example.test', ':invalid/page'],
    ['not a URL', '/page'],
    ['file:///tmp/site', '/page'],
  ]) assert.equal(readability.isPageOnOrigin(base, path), false, `${base}${path}`);
});

async function withServers(fn) {
  const outsideHits = []; const siteHits = [];
  const outside = createServer((req, res) => {
    outsideHits.push({ path: req.url, authorized: req.headers.authorization === credential });
    res.setHeader('content-type', 'text/html');
    res.end('<html><body>outside</body></html>');
  });
  await new Promise((resolve) => outside.listen(0, '127.0.0.1', resolve));
  const outsideOrigin = `http://127.0.0.1:${outside.address().port}`;
  const site = createServer((req, res) => {
    const authorized = req.headers.authorization === credential;
    if (req.url === '/page') siteHits.push(authorized);
    if (!authorized) { res.writeHead(401); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<html><head><title>Page</title></head><body><main><p>Content</p><iframe src="${outsideOrigin}/iframe"></iframe></main></body></html>`);
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  try { await fn({ site, outside, siteHits, outsideHits }); } finally {
    setOriginAuth(null, null);
    await Promise.all([
      new Promise((resolve) => site.close(resolve)),
      new Promise((resolve) => outside.close(resolve)),
    ]);
  }
}

const browserTest = { skip: playwrightAvailable ? false : 'Playwright is not available from the project', timeout: 30000 };

test('normalized base authenticates the site but not a third-party iframe', browserTest, async () => {
  await withServers(async ({ site, siteHits, outsideHits }) => {
    const base = `HTTP://127.0.0.1:${site.address().port}`;
    setOriginAuth(base, credential);
    const findings = await readability.run({ base, inventory: { pages: [{ path: '/page' }] }, shared: {} });
    assert.ok(!findings.some((f) => f.id === 'ai-readability-unmeasured'));
    assert.ok(siteHits.length >= 2 && siteHits.every(Boolean));
    assert.ok(outsideHits.some((hit) => hit.path === '/iframe'));
    assert.ok(outsideHits.every((hit) => !hit.authorized));
  });
});

test('crafted inventory path is not fetched with site credentials', browserTest, async () => {
  await withServers(async ({ outside, outsideHits }) => {
    const base = 'HTTP://127.0.0.1';
    const path = `:${outside.address().port}/spoof`;
    setOriginAuth(base, credential);
    const findings = await readability.run({ base, inventory: { pages: [{ path }] }, shared: {} });
    assert.deepEqual(outsideHits, []);
    assert.ok(findings.some((f) => f.id === 'ai-readability-unmeasured' && /origin/i.test(f.message)));
  });
});
