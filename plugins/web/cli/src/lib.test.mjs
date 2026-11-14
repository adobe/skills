import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError, EXIT, runCli, runPageCommand } from './lib.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});
const OK = { url: 'http://x/final', title: 'T', status: 200, bodyText: 'ok '.repeat(200) };
const driver = {
  ensureAvailable: () => {},
  open: () => {},
  close: () => {},
  list: () => [],
  goto: () => {},
  pageHealth: () => OK,
  run: () => ({ headings: 3 }),
};

// A consumer adds `acme audit [url]` on top of the stock program.
const extend = (program, deps) =>
  program
    .command('acme')
    .command('audit [url]')
    .option('--strict')
    .action((url, _o, command) =>
      runPageCommand(command, deps, {
        url,
        fn: (drv, session, opts) => {
          if (opts.strict) throw new CliError('EMPTY_RESULT', 'nothing to audit', { hint: 'h' });
          return drv.run(session, { code: 'audit()' });
        },
      }),
    );

async function acme(...args) {
  const stdout = sink();
  const stderr = sink();
  const deps = { stdout, stderr, env: {}, driverFactory: () => driver, extend };
  const code = await runCli(['node', 'web', 'acme', 'audit', ...args], deps);
  return { code, doc: JSON.parse(stdout.buf), stderr: stderr.buf };
}

test('an extension command gets the page contract: session, url, durationMs, JSON', async () => {
  const { code, doc } = await acme('http://x');
  assert.equal(code, EXIT.OK);
  assert.equal(doc.headings, 3);
  assert.equal(doc.url, 'http://x/final');
  assert.ok(doc.session);
  assert.equal(typeof doc.durationMs, 'number');
});

test('an extension command gets the error contract and exit codes', async () => {
  const { code, doc } = await acme('http://x', '--strict');
  assert.equal(code, EXIT.FAILURE);
  assert.deepEqual(doc.error, { code: 'EMPTY_RESULT', message: 'nothing to audit', hint: 'h' });
  const usage = await acme();
  assert.equal(usage.code, EXIT.USAGE);
  assert.equal(usage.doc.error.code, 'USAGE');
});

test('stock commands stay available next to the extension', async () => {
  const stdout = sink();
  const deps = { stdout, stderr: sink(), env: {}, extend };
  const code = await runCli(['node', 'web', '--help'], deps);
  assert.equal(code, 0);
  for (const g of ['browser', 'page', 'probe', 'acme']) assert.match(stdout.buf, new RegExp(g));
});
