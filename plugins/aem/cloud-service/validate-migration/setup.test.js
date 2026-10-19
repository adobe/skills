'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readSetup, writeSetup, resolveInstances } = require('./setup.js');
const { ensureInstance } = require('./sdk.js');

function runSetup(context, pattern, responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-init-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preload = path.join(dir, 'http-fixture.cjs');
  fs.writeFileSync(preload, `
    const childProcess = require('node:child_process');
    const execFileSync = childProcess.execFileSync;
    childProcess.execFileSync = (command, args, options) => {
      if (command === 'sh' && args[0] === '-c' && /^command -v (mvn|unzip)$/.test(args[1])) return '';
      return execFileSync(command, args, options);
    };
    const responses = ${JSON.stringify(responses)};
    global.fetch = async (url) => {
      const fixture = responses[new URL(url).hostname];
      if (!fixture) throw new Error('connection refused');
      return { status: 200, text: async () => fixture };
    };
  `);
  const execution = spawnSync(process.execPath, [
    '--require', preload, path.join(__dirname, 'init.js'), '--project', dir,
    '--pattern', pattern, '--no-start', '--sdk', 'http://sdk.invalid:4602',
    '--quickstart', 'http://source.invalid:4502',
  ], { encoding: 'utf8', env: { ...process.env, AEM_TARGET_AUTH: '', AEM_SOURCE_AUTH: '' } });
  return { execution, saved: readSetup(dir) };
}

test('offline setup succeeds without either AEM instance or saved instance URLs', (context) => {
  const { execution, saved } = runSetup(context, 'legacy-ui,cdw', {});
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.deepStrictEqual(saved, {});
});

test('scheduler setup succeeds without AEM 6.5 and saves only the verified SDK URL', (context) => {
  const { execution, saved } = runSetup(context, 'scheduler', {
    'sdk.invalid': 'Adobe Experience Manager 2026.8.123',
  });
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.strictEqual(saved.sdk_url, 'http://sdk.invalid:4602');
  assert.strictEqual(saved.quickstart_url, undefined);
});

test('template comparison setup requires AEM 6.5 as well as the SDK', (context) => {
  const { execution, saved } = runSetup(context, 'custom-templates', {
    'sdk.invalid': 'Adobe Experience Manager 2026.8.123',
  });
  assert.strictEqual(execution.status, 1);
  assert.match(execution.stderr, /setup not ready/);
  assert.deepStrictEqual(saved, {});
});

test('mixed offline and runtime setup keeps the runtime prerequisites', (context) => {
  const { execution } = runSetup(context, 'legacy-ui,scheduler', {});
  assert.strictEqual(execution.status, 1);
  assert.match(execution.stderr, /setup not ready/);
});

test('setup rejects swapped source and SDK roles instead of saving reachable URLs', (context) => {
  const { execution, saved } = runSetup(context, 'custom-templates', {
    'sdk.invalid': 'Adobe Experience Manager 6.5.0',
    'source.invalid': 'Adobe Experience Manager 2026.8.123',
  });
  assert.strictEqual(execution.status, 1);
  assert.deepStrictEqual(saved, {});
});

test('setup rejects an unknown pattern rather than reporting readiness', (context) => {
  const { execution } = runSetup(context, 'typo', {
    'sdk.invalid': 'Adobe Experience Manager 2026.8.123',
    'source.invalid': 'Adobe Experience Manager 6.5.0',
  });
  assert.strictEqual(execution.status, 1);
  assert.match(execution.stderr, /unknown.*pattern/i);
});

test('SDK readiness rejects AEM 6.5 even when the HTTP endpoint answers', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({
    status: 200, text: async () => 'Adobe Experience Manager 6.5.0',
  }));
  assert.strictEqual(await ensureInstance('http://sdk.invalid:4602', { noStart: true }), false);
});

test('SDK readiness rejects an unrelated HTTP service', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({
    status: 200, text: async () => '<html>Unrelated service</html>',
  }));
  assert.strictEqual(await ensureInstance('http://sdk.invalid:4602', { noStart: true }), false);
});

test('SDK readiness rejects a login redirect instead of treating it as product evidence', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({
    status: 302, text: async () => '',
  }));
  assert.strictEqual(await ensureInstance('http://sdk.invalid:4602', { noStart: true }), false);
});

test('SDK readiness uses the About page with existing credentials and never includes them in diagnostics', async (context) => {
  const auth = process.env.AEM_TARGET_AUTH;
  process.env.AEM_TARGET_AUTH = 'test-user:test-password';
  context.after(() => {
    if (auth === undefined) delete process.env.AEM_TARGET_AUTH;
    else process.env.AEM_TARGET_AUTH = auth;
  });
  const diagnostics = [];
  context.mock.method(console, 'error', (...args) => diagnostics.push(args.join(' ')));
  context.mock.method(globalThis, 'fetch', async (url, options) => ({
    status: url.endsWith('/mnt/overlay/granite/ui/content/shell/about.html')
      && options.headers?.Authorization === 'Basic ' + Buffer.from('test-user:test-password').toString('base64') ? 200 : 401,
    text: async () => 'Adobe Experience Manager 2026.8.123',
  }));
  assert.strictEqual(await ensureInstance('http://sdk.invalid:4602', { noStart: true }), true);
  assert.ok(!diagnostics.join('\n').includes('test-password'));
});

test('writeSetup saves only instance URLs, never credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-setup-'));
  try {
    assert.deepStrictEqual(readSetup(dir), {});
    writeSetup(dir, { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502', auth: 'u:p', AEM_TARGET_AUTH: 'u:p' });
    const file = path.join(dir, '.validate-migration', 'setup.json');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('u:p'));
    const saved = readSetup(dir);
    assert.strictEqual(saved.sdk_url, 'http://localhost:4602');
    assert.strictEqual(saved.quickstart_url, 'http://localhost:4502');
    assert.ok(saved.confirmed_at);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveInstances defaults to SDK on 4602 and AEM 6.5 on 4502', () => {
  assert.deepStrictEqual(resolveInstances({}, {}),
    { sdk_url: 'http://localhost:4602', quickstart_url: 'http://localhost:4502' });
});

test('resolveInstances prefers explicit flags, then the saved setup, then the fixed ports', () => {
  assert.deepStrictEqual(resolveInstances({ sdk: 'http://h:1/', quickstart: 'http://h:2' }, { sdk_url: 'x' }),
    { sdk_url: 'http://h:1', quickstart_url: 'http://h:2' });
  assert.deepStrictEqual(resolveInstances({}, { sdk_url: 'http://s:9', quickstart_url: 'http://q:9' }),
    { sdk_url: 'http://s:9', quickstart_url: 'http://q:9' });
  assert.deepStrictEqual(resolveInstances({ sdk: 'http://h:1' }, {}),
    { sdk_url: 'http://h:1', quickstart_url: 'http://localhost:4502' });
});
