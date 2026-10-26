'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readSetup, writeSetup, resolveInstances, sameInstance } = require('./setup.js');

// Runs init.js with fetch and child-process spawning instrumented: setup must
// never contact AEM or start an instance.
function runSetup(context, pattern, { sdk = 'http://sdk.invalid:4602', quickstart = 'http://source.invalid:4502' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-init-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'aem-sdk-quickstart-2026.8.0.jar'), '');
  const calls = path.join(dir, 'calls.log');
  const preload = path.join(dir, 'fixture.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const childProcess = require('node:child_process');
    const execFileSync = childProcess.execFileSync;
    childProcess.execFileSync = (command, args, options) => {
      if (command === 'sh' && args[0] === '-c' && /^command -v (mvn|unzip)$/.test(args[1])) return '';
      return execFileSync(command, args, options);
    };
    childProcess.spawn = (command) => { fs.appendFileSync(${JSON.stringify(calls)}, 'spawn ' + command + '\\n'); return { unref() {} }; };
    global.fetch = async (url) => { fs.appendFileSync(${JSON.stringify(calls)}, 'fetch ' + url + '\\n'); throw new Error('unexpected'); };
  `);
  const execution = spawnSync(process.execPath, [
    '--require', preload, path.join(__dirname, 'init.js'), '--project', dir,
    '--pattern', pattern, '--sdk', sdk, '--quickstart', quickstart,
  ], { encoding: 'utf8' });
  const external = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  assert.strictEqual(external, '', 'setup never contacts AEM or starts an instance');
  const { confirmed_at: _confirmedAt, ...saved } = readSetup(dir);
  return { execution, saved };
}

test('offline setup succeeds without either AEM instance or saved instance URLs', (context) => {
  const { execution, saved } = runSetup(context, 'legacy-ui,cdw');
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.deepStrictEqual(saved, {});
});

test('scheduler setup saves only the SDK URL, without contacting it', (context) => {
  const { execution, saved } = runSetup(context, 'scheduler');
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.deepStrictEqual(saved, { sdk_url: 'http://sdk.invalid:4602' });
  assert.match(execution.stdout, /diagnose-osgi-bundle on http:\/\/sdk\.invalid:4602\/bin\/mcp/);
  assert.match(execution.stdout, /does not contact them/);
});

test('template comparison setup saves both the source and SDK URLs', (context) => {
  const { execution, saved } = runSetup(context, 'custom-templates');
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.deepStrictEqual(saved, { sdk_url: 'http://sdk.invalid:4602', quickstart_url: 'http://source.invalid:4502' });
});

test('template comparison setup rejects a source URL that is the SDK URL', (context) => {
  const { execution, saved } = runSetup(context, 'custom-templates',
    { sdk: 'http://localhost:4502', quickstart: 'http://127.0.0.1:4502/' });
  assert.strictEqual(execution.status, 1);
  assert.match(execution.stderr, /setup not ready/);
  assert.deepStrictEqual(saved, {});
});

test('mixed offline and runtime setup keeps the runtime prerequisites', (context) => {
  const { execution, saved } = runSetup(context, 'legacy-ui,scheduler');
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.deepStrictEqual(saved, { sdk_url: 'http://sdk.invalid:4602' });
  assert.match(execution.stdout, /MCP: your coding assistant must confirm diagnose-osgi-bundle/);
});

test('setup rejects an invalid SDK URL', (context) => {
  const { execution, saved } = runSetup(context, 'scheduler', { sdk: 'not a url' });
  assert.strictEqual(execution.status, 1);
  assert.deepStrictEqual(saved, {});
});

test('setup rejects an unknown pattern rather than reporting readiness', (context) => {
  const { execution } = runSetup(context, 'typo');
  assert.strictEqual(execution.status, 1);
  assert.match(execution.stderr, /unknown.*pattern/i);
});

test('sameInstance compares host and port, treating loopback aliases as one host', () => {
  assert.strictEqual(sameInstance('http://localhost:4502', 'http://127.0.0.1:4502/'), true);
  assert.strictEqual(sameInstance('http://localhost', 'http://localhost:80'), true);
  assert.strictEqual(sameInstance('http://localhost:4602', 'http://localhost:4502'), false);
  assert.strictEqual(sameInstance('http://sdk.example:4502', 'http://localhost:4502'), false);
  assert.strictEqual(sameInstance('not a url', 'http://localhost:4502'), false);
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
