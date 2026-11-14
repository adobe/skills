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
const OK = {
  title: 'T',
  url: 'http://x/final',
  bodyLength: 5000,
  status: 200,
  hasMainContent: true,
};
const SECTION = { id: 's1' };
const PHASE1 = {
  url: 'http://x/p1',
  title: 'T',
  viewport: { w: 1, h: 2 },
  templateHash: 'abc',
  sections: [SECTION],
};

function run(args, results) {
  const calls = [];
  const queue = [...results];
  const rec =
    (n) =>
    (...a) => (calls.push([n, ...a]), undefined);
  const driver = {
    ensureAvailable: () => {},
    open: rec('open'),
    close: rec('close'),
    list: () => [],
    goto: rec('goto'),
    run: rec('run'),
    inject: rec('inject'),
    pageHealth: () => OK,
    evaluate: (s, e) => {
      calls.push(['evaluate', s, e]);
      return e.includes('detectSections')
        ? JSON.stringify(queue.length > 1 ? queue.shift() : queue[0])
        : undefined;
    },
  };
  const stdout = sink();
  const deps = { stdout, stderr: sink(), env: {}, driverFactory: () => driver };
  return runCli(['node', 'web', ...args], deps).then((code) => ({ code, calls, stdout }));
}

const detects = (calls) => calls.filter((c) => c[0] === 'evaluate' && /detectSections/.test(c[2]));
const scrolls = (calls) => calls.filter((c) => c[0] === 'run' && /scrollTo/.test(c[2].code));

test('retries scroll when sections empty', async () => {
  const { code, calls, stdout } = await run(
    ['page', 'reduce', 'http://x'],
    [{ sections: [] }, { sections: [SECTION] }],
  );
  assert.equal(code, 0);
  assert.equal(detects(calls).length, 2);
  assert.equal(scrolls(calls).length, 2);
  assert.deepEqual(JSON.parse(stdout.buf).sections, [SECTION]);
});

test('throws EMPTY_RESULT after retries', async () => {
  const { code, calls, stdout } = await run(
    ['page', 'reduce', 'http://x', '--retries', '1'],
    [{ sections: [] }],
  );
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout.buf).error.code, 'EMPTY_RESULT');
  assert.equal(detects(calls).length, 2);
});

test('returns phase1 unchanged on success', async () => {
  const { code, stdout, calls } = await run(['page', 'reduce', 'http://x'], [PHASE1]);
  assert.equal(code, 0);
  const doc = JSON.parse(stdout.buf);
  assert.equal(doc.templateHash, 'abc');
  assert.deepEqual(doc.viewport, { w: 1, h: 2 });
  assert.equal(doc.title, 'T');
  assert.equal(detects(calls).length, 1);
  assert.match(detects(calls)[0][2], /autoDetect: true, highlightBoxes: false/);
});

test('unpin evaluate is issued before inject', async () => {
  const { calls } = await run(['page', 'reduce', 'http://x'], [PHASE1]);
  const names = calls.map((c) => c[0]);
  const unpin = calls.findIndex((c) => c[0] === 'evaluate' && /position/.test(c[2]));
  assert.ok(unpin >= 0 && unpin < names.indexOf('inject'));
});
