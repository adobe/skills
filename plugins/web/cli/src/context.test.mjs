import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { createContext, stepTimeout } from './context.mjs';

function contextWith(env, driverOpts) {
  let seen;
  const driverFactory = (o) => {
    seen = o;
    return { ensureAvailable() {} };
  };
  const command = new Command('x').option('--output <dir>', '', './.web');
  command.parse([], { from: 'user' });
  createContext(command, { env, driverFactory }, driverOpts);
  return seen;
}

test('without WEB_TIMEOUT the driver keeps its defaults and the command timeout', () => {
  assert.deepEqual(contextWith({}), { outputDir: './.web' });
  assert.deepEqual(contextWith({}, { timeoutMs: 30_000 }), {
    outputDir: './.web',
    timeoutMs: 30_000,
  });
});

test('WEB_TIMEOUT sets the navigation timeout and a call timeout just above it', () => {
  const opts = contextWith({ WEB_TIMEOUT: '120000' }, { timeoutMs: 30_000 });
  assert.equal(opts.navigationTimeoutMs, 120_000);
  assert.equal(opts.timeoutMs, 125_000);
});

test('an invalid WEB_TIMEOUT is a USAGE error', () => {
  for (const bad of ['0', '-5', 'abc', '1.5']) {
    assert.throws(
      () => stepTimeout({ WEB_TIMEOUT: bad }),
      (e) => e.code === 'USAGE',
    );
  }
  assert.equal(stepTimeout({ WEB_TIMEOUT: '' }), undefined);
});
