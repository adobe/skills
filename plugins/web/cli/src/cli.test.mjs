import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from './errors.mjs';
import { createProgram, runCli } from './cli.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

test('unknown option exits 2 and prints help to stderr', async () => {
  const stdout = sink();
  const stderr = sink();
  const argv = ['node', 'web', 'browser', 'list', '--headless'];
  const code = await runCli(argv, { stdout, stderr, env: {} });
  assert.equal(code, 2);
  assert.match(stderr.buf, /Usage:/);
});

test('--help exits 0 and lists groups browser, page, probe, ext, mask', async () => {
  const stdout = sink();
  const code = await runCli(['node', 'web', '--help'], { stdout, stderr: sink(), env: {} });
  assert.equal(code, 0);
  for (const g of ['browser', 'page', 'probe', 'ext', 'mask']) {
    assert.match(stdout.buf, new RegExp(g));
  }
});

test('WEB_SESSION env fills --session default', () => {
  const program = createProgram({ env: { WEB_SESSION: 'from-env' } });
  assert.equal(program.opts().session, 'from-env');
});

test('PLAYWRIGHT_CLI_SESSION is the fallback; WEB_SESSION wins', () => {
  const only = createProgram({ env: { PLAYWRIGHT_CLI_SESSION: 'pw' } });
  assert.equal(only.opts().session, 'pw');
  const both = createProgram({ env: { WEB_SESSION: 'web', PLAYWRIGHT_CLI_SESSION: 'pw' } });
  assert.equal(both.opts().session, 'web');
});

test('mask --help prints usage and exit 0', async () => {
  const stdout = sink();
  const code = await runCli(['node', 'web', 'mask', '--help'], { stdout, stderr: sink(), env: {} });
  assert.equal(code, 0);
  assert.match(stdout.buf, /Usage:/);
});

const thrower = (err) => (program) =>
  program.command('boom').action(() => {
    throw err;
  });

test('a CliError thrown by a command yields its error document and exit code', async () => {
  const stdout = sink();
  const extend = thrower(new CliError('BLOCKED', 'm', { hint: 'h' }));
  const code = await runCli(['node', 'web', 'boom'], {
    stdout,
    stderr: sink(),
    env: {},
    extend,
  });
  assert.equal(code, 3);
  assert.deepEqual(JSON.parse(stdout.buf), { error: { code: 'BLOCKED', message: 'm', hint: 'h' } });
});

test('a plain Error is wrapped as INTERNAL with exit 1', async () => {
  const stdout = sink();
  const extend = thrower(new Error('boom'));
  const code = await runCli(['node', 'web', 'boom'], {
    stdout,
    stderr: sink(),
    env: {},
    extend,
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout.buf).error.code, 'INTERNAL');
});

const LEAVES = [
  ['browser', 'open'],
  ['browser', 'attach'],
  ['browser', 'list'],
  ['browser', 'close'],
  ['browser', 'close-all'],
  ['browser', 'eval'],
  ['browser', 'run'],
  ['browser', 'cdp'],
  ['browser', 'screenshot'],
  ['probe'],
  ['page', 'tree'],
  ['page', 'reduce'],
  ['page', 'collect'],
  ['page', 'langs'],
  ['page', 'overlays'],
  ['ext', 'launch'],
  ['ext', 'open'],
  ['ext', 'status'],
  ['ext', 'close'],
  ['mask'],
];

test('--help works for root, groups and every leaf, with Example and Output', async () => {
  const help = async (path) => {
    const stdout = sink();
    const code = await runCli(['node', 'web', ...path, '--help'], {
      stdout,
      stderr: sink(),
      env: {},
    });
    assert.equal(code, 0, path.join(' '));
    return stdout.buf;
  };
  assert.match(await help([]), /Exit codes/);
  for (const group of ['browser', 'page', 'ext']) assert.match(await help([group]), /session/);
  for (const path of LEAVES) {
    const text = await help(path);
    assert.match(text, /Example:/, path.join(' '));
    assert.match(text, /Output:/, path.join(' '));
  }
});

for (const [label, argv] of [
  ['unknown option', ['browser', 'list', '--headless']],
  ['missing argument', ['browser', 'eval']],
  ['unknown command', ['nope']],
  ['global option missing value', ['browser', 'list', '--output']],
  ['session option missing value', ['browser', 'list', '--session']],
  ['leaf option missing value', ['page', 'tree', '--min-width']],
]) {
  test(`${label} prints a USAGE error document on stdout`, async () => {
    const stdout = sink();
    const code = await runCli(['node', 'web', ...argv], { stdout, stderr: sink(), env: {} });
    assert.equal(code, 2);
    const { error } = JSON.parse(stdout.buf);
    assert.equal(error.code, 'USAGE');
    assert.ok(error.message);
  });
}

test('non-integer --cdp-port exits 2 with a USAGE document and opens nothing', async () => {
  const stdout = sink();
  const calls = [];
  const driverFactory = () => ({ open: () => calls.push('open'), list: () => [] });
  const argv = ['node', 'web', 'browser', 'open', 'http://x', '--cdp-port', 'abc'];
  const code = await runCli(argv, { stdout, stderr: sink(), env: {}, driverFactory });
  assert.equal(code, 2);
  const { error } = JSON.parse(stdout.buf);
  assert.equal(error.code, 'USAGE');
  assert.match(error.message, /integer/);
  assert.deepEqual(calls, []);
});

test('non-integer --retries exits 2', async () => {
  const stdout = sink();
  const argv = ['node', 'web', 'page', 'reduce', 'http://x', '--retries', 'x'];
  const code = await runCli(argv, { stdout, stderr: sink(), env: {} });
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
});

test('--format yaml exits 2 with a USAGE document', async () => {
  const stdout = sink();
  const argv = ['node', 'web', 'browser', 'list', '--format', 'yaml'];
  const code = await runCli(argv, { stdout, stderr: sink(), env: {} });
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
});
