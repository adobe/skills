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
const BUNDLE = {
  textFormat: 'r @0 root',
  data: { a: 1 },
  nodeMap: { 0: 'x' },
  rootBackground: '#fff',
};
const OK = {
  title: 'T',
  url: 'http://x/final',
  bodyLength: 5000,
  status: 200,
  hasMainContent: true,
};

function run(args, { health = OK, sessions = [] } = {}) {
  const calls = [];
  const rec =
    (n, ret) =>
    (...a) => (calls.push([n, ...a]), ret);
  const driver = {
    ensureAvailable: () => {},
    open: rec('open'),
    close: rec('close'),
    list: () => sessions,
    goto: rec('goto'),
    run: rec('run'),
    inject: rec('inject'),
    pageHealth: () => health,
    evaluate: (s, e) => (calls.push(['evaluate', s, e]), JSON.stringify(BUNDLE)),
  };
  const stdout = sink();
  const deps = { stdout, stderr: sink(), env: {}, driverFactory: () => driver };
  return runCli(['node', 'web', ...args], deps).then((code) => ({ code, calls, stdout }));
}

test('captureTree injects bundle then evaluates captureVisualTree(900)', async () => {
  const { code, calls } = await run(['page', 'tree', 'http://x']);
  assert.equal(code, 0);
  const names = calls.map((c) => c[0]);
  assert.ok(names.indexOf('run') < names.indexOf('inject'));
  assert.ok(names.indexOf('inject') < names.lastIndexOf('evaluate'));
  assert.match(calls.find((c) => c[0] === 'evaluate')[2], /captureVisualTree\(900\)/);
});

test('captureTree maps textFormat→text and data→tree, with metadata', async () => {
  const { stdout } = await run(['page', 'tree', 'http://x', '--min-width', '500']);
  const doc = JSON.parse(stdout.buf);
  assert.equal(doc.text, 'r @0 root');
  assert.deepEqual(doc.tree, { a: 1 });
  assert.equal(doc.rootBackground, '#fff');
  assert.equal(doc.url, 'http://x/final');
  assert.match(doc.session, /^web-[0-9a-f]{4}$/);
  assert.equal(typeof doc.durationMs, 'number');
});

test('--format text prints the text member only', async () => {
  const { stdout } = await run(['page', 'tree', 'http://x', '--format', 'text']);
  assert.equal(stdout.buf.trim(), 'r @0 root');
});

test('page tree without url and without session exits 2 USAGE', async () => {
  const { code, stdout } = await run(['page', 'tree']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
});

test('blocked page exits 3 BLOCKED', async () => {
  const { code, stdout } = await run(['page', 'tree', 'http://x'], {
    health: {
      title: 'Access Denied',
      url: 'http://x',
      bodyLength: 10,
      status: 403,
      hasMainContent: false,
    },
  });
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout.buf).error.code, 'BLOCKED');
});
