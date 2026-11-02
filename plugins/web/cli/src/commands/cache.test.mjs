import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harFileName } from '#src/cache/har.mjs';
import { runCli } from '#src/cli.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

test('cache serve rejects a bad --also, --port and --timeout with exit 2', async () => {
  for (const args of [
    ['--also', 'not a url'],
    ['--port', 'x'],
    ['--port', '-1'],
    ['--timeout', '0'],
  ]) {
    const stdout = sink();
    const code = await runCli(['node', 'web', 'cache', 'serve', ...args], {
      stdout,
      stderr: sink(),
      env: {},
    });
    assert.equal(code, 2, args.join(' '));
    assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
  }
});

function recordDriver() {
  const calls = [];
  const driver = {
    ensureAvailable: () => {},
    open(opts) {
      calls.push(['open', opts]);
      this.harPath = opts.config.contextOptions.recordHar.path;
    },
    pageHealth: () => ({
      title: 'A',
      url: 'https://a.test/',
      bodyLength: 5000,
      status: 200,
      hasMainContent: true,
    }),
    run(session, { code }) {
      if (!code.includes('context().close()')) return;
      const entry = (status) => ({
        request: { method: 'GET', url: 'https://a.test/' },
        response: { status, headers: [], content: {} },
      });
      writeFileSync(this.harPath, JSON.stringify({ log: { entries: [entry(200), entry(0)] } }));
    },
    close: (session) => calls.push(['close', session]),
  };
  return { calls, driver };
}

test('cache record prints { url, har, entries, dropped, bytes }', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-record-'));
  const { calls, driver } = recordDriver();
  const stdout = sink();
  const code = await runCli(['node', 'web', 'cache', 'record', 'https://a.test', '--cache', dir], {
    stdout,
    stderr: sink(),
    env: {},
    driverFactory: () => driver,
  });
  assert.equal(code, 0, stdout.buf);
  const out = JSON.parse(stdout.buf);
  assert.deepEqual(Object.keys(out), ['url', 'har', 'entries', 'dropped', 'bytes']);
  assert.equal(out.url, 'https://a.test');
  assert.equal(out.har, join(dir, harFileName('https://a.test')));
  assert.equal(out.entries, 1);
  assert.equal(out.dropped, 1);
  assert.equal(out.bytes, statSync(out.har).size);
  assert.equal(calls.find(([n]) => n === 'open')[1].url, 'https://a.test');
});

test('cache record rejects a non-URL with exit 2 USAGE before opening a browser', async () => {
  const { calls, driver } = recordDriver();
  const stdout = sink();
  const code = await runCli(['node', 'web', 'cache', 'record', 'notaurl'], {
    stdout,
    stderr: sink(),
    env: {},
    driverFactory: () => driver,
  });
  assert.equal(code, 2);
  const { error } = JSON.parse(stdout.buf);
  assert.equal(error.code, 'USAGE');
  assert.match(error.message, /notaurl/);
  assert.deepEqual(calls, []);
});

test('cache proxy rejects a bad --port and --timeout with exit 2', async () => {
  for (const args of [
    ['--port', 'x'],
    ['--timeout', '0'],
  ]) {
    const stdout = sink();
    const code = await runCli(['node', 'web', 'cache', 'proxy', ...args], {
      stdout,
      stderr: sink(),
      env: {},
    });
    assert.equal(code, 2, args.join(' '));
    const { error } = JSON.parse(stdout.buf);
    assert.equal(error.code, 'USAGE');
    assert.match(error.message, new RegExp(args[0]));
  }
});

test('cache proxy reports an unreadable HAR as USAGE, not a listen failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-proxy-'));
  writeFileSync(join(dir, 'bad.har'), '{not json');
  const stdout = sink();
  const code = await runCli(['node', 'web', 'cache', 'proxy', '--cache', dir, '--port', '0'], {
    stdout,
    stderr: sink(),
    env: {},
  });
  assert.equal(code, 2);
  const { error } = JSON.parse(stdout.buf);
  assert.equal(error.code, 'USAGE');
  assert.match(error.message, /bad\.har/);
});
