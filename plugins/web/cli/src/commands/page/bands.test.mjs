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
const box = (x, y, width, height) => ({ x, y, width, height });
const TREE = {
  tag: 'BODY',
  selector: 'body',
  bounds: box(0, 0, 1280, 1000),
  children: [
    { tag: 'HEADER', selector: 'header', bounds: box(0, 0, 1280, 100), children: [] },
    {
      tag: 'MAIN',
      selector: 'main',
      bounds: box(0, 100, 1280, 900),
      children: [
        { tag: 'DIV', selector: 'div.a', bounds: box(0, 100, 600, 900), children: [] },
        { tag: 'DIV', selector: 'div.b', bounds: box(680, 100, 600, 900), children: [] },
      ],
    },
  ],
};
const OK = { title: 'T', url: 'http://x/', bodyLength: 5000, status: 200, hasMainContent: true };

function run(args) {
  const calls = [];
  const rec =
    (n) =>
    (...a) =>
      calls.push([n, ...a]);
  const driver = {
    ensureAvailable: () => {},
    open: rec('open'),
    close: rec('close'),
    list: () => [],
    goto: rec('goto'),
    run: rec('run'),
    inject: rec('inject'),
    pageHealth: () => OK,
    evaluate: (s, e) => (
      calls.push(['evaluate', s, e]),
      JSON.stringify({ textFormat: '', data: TREE, nodeMap: {}, rootBackground: '' })
    ),
  };
  const stdout = sink();
  const deps = { stdout, stderr: sink(), env: {}, driverFactory: () => driver };
  return runCli(['node', 'web', ...args], deps).then((code) => ({ code, calls, stdout }));
}

test('page bands captures the tree at min width 250 and prints level-1 bands', async () => {
  const { code, calls, stdout } = await run(['page', 'bands', 'http://x']);
  assert.equal(code, 0);
  assert.match(calls.find((c) => c[0] === 'evaluate')[2], /captureVisualTree\(250\)/);
  const doc = JSON.parse(stdout.buf);
  assert.deepEqual(
    doc.bands.map((b) => [b.id, b.top, b.bottom, b.side, b.children]),
    [
      ['B1', 0, 100, false, undefined],
      ['B2', 100, 1000, true, undefined],
    ],
  );
  assert.equal(doc.depth, '1');
  assert.deepEqual(doc.fixed, []);
  assert.equal(doc.url, 'http://x/');
  assert.equal(doc.tree, undefined, 'the tree is not repeated');
});

test('page bands --depth all slices inside each band', async () => {
  const { stdout } = await run(['page', 'bands', 'http://x', '--depth', 'all']);
  const [, main] = JSON.parse(stdout.buf).bands;
  assert.deepEqual(
    main.children.map((k) => k.id),
    ['B2.1', 'B2.2'],
  );
});

test('page bands --format text prints one line per band', async () => {
  const { stdout } = await run(['page', 'bands', 'http://x', '--format', 'text']);
  assert.equal(stdout.buf.trim(), 'B1  0-100  header\nB2  100-1000  side  main');
});

test('page bands rejects an unknown --depth with exit 2', async () => {
  const { code } = await run(['page', 'bands', 'http://x', '--depth', '3']);
  assert.equal(code, 2);
});
