'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectRole, requiredChecks, readSetup, writeSetup, resolveInstances } = require('./setup.js');

const about = (version) => ({ status: 200, text: async () => `<title>About</title><p>Adobe Experience Manager ${version}</p>` });

test('detectRole tells the Cloud SDK from AEM 6.5 using the About page', async (context) => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return url.includes(':4502') ? about('6.5.0') : about('2026.8.27673.20260811T193135Z-260800');
  });
  assert.deepStrictEqual(await detectRole('http://localhost:4502/', 'u:p'), { role: 'aem65', version: '6.5.0' });
  assert.deepStrictEqual(await detectRole('http://localhost:4602', 'u:p'), { role: 'cloud-sdk', version: '2026.8.27673.20260811T193135Z-260800' });
  assert.strictEqual(calls[0].url, 'http://localhost:4502/mnt/overlay/granite/ui/content/shell/about.html');
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
  context.mock.restoreAll();

  context.mock.method(globalThis, 'fetch', async () => ({ status: 401, text: async () => '' }));
  assert.deepStrictEqual(await detectRole('http://localhost:4602', 'u:bad'), { role: 'unknown', reason: 'login_rejected' });
  assert.deepStrictEqual(await detectRole('http://localhost:4602', undefined), { role: 'unknown', reason: 'login_missing' });
});

test('requiredChecks only blocks on what the patterns in scope need', () => {
  assert.deepStrictEqual(requiredChecks(['scheduler', 'replication']), ['sdk', 'mcp']);
  assert.deepStrictEqual(requiredChecks(['custom-templates']), ['sdk', 'mcp', 'quickstart']);
  assert.deepStrictEqual(requiredChecks(['legacy-ui', 'cdw']), []);
  assert.deepStrictEqual(requiredChecks([]), ['sdk', 'mcp']);
});

test('writeSetup saves only instance URLs and versions, never credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-setup-'));
  try {
    assert.deepStrictEqual(readSetup(dir), {});
    writeSetup(dir, { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502', sdk_version: '2026.8', auth: 'u:p', AEM_TARGET_AUTH: 'u:p' });
    const file = path.join(dir, '.validate-migration', 'setup.json');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('u:p'));
    const saved = readSetup(dir);
    assert.strictEqual(saved.sdk_url, 'http://localhost:4602');
    assert.strictEqual(saved.quickstart_url, 'http://localhost:4502');
    assert.ok(saved.confirmed_at);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveInstances prefers explicit flags, then the saved setup, then detection', () => {
  const detected = { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502' };
  assert.deepStrictEqual(resolveInstances({ sdk: 'http://h:1/', quickstart: 'http://h:2' }, { sdk_url: 'x' }, detected),
    { sdk_url: 'http://h:1', quickstart_url: 'http://h:2', source: 'flags' });
  assert.deepStrictEqual(resolveInstances({}, { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502' }, {}),
    { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502', source: 'saved' });
  assert.deepStrictEqual(resolveInstances({}, {}, detected), { ...detected, source: 'detected' });
  assert.deepStrictEqual(resolveInstances({}, {}, {}), { sdk_url: null, quickstart_url: null, source: 'none' });
});
