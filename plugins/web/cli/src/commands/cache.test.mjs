import { test } from 'node:test';
import assert from 'node:assert/strict';
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
