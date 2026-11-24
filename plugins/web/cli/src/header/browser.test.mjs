import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeSession,
  decode,
  launchConfig,
  openSession,
  runCode,
  useBrowser,
  webBrowser,
} from './browser.mjs';

/** A driver that records its calls; `run` answers from `answers` in turn. */
function fakeDriver({ answers = [], exists = new Set(), failClose = 0, failOpen = null } = {}) {
  const calls = [];
  return {
    calls,
    open(opts) {
      calls.push(['open', opts]);
      if (exists.has(opts.session))
        throw Object.assign(new Error('exists'), { code: 'SESSION_EXISTS' });
      // the CLI's answer can fail after Chromium started (a timeout, a broken response)
      if (failOpen) throw Object.assign(new Error('open timed out'), { code: failOpen });
    },
    run(session, opts) {
      calls.push(['run', session, opts]);
      return answers.shift();
    },
    async runAsync(session, opts) {
      calls.push(['runAsync', session, opts]);
      return answers.shift();
    },
    close(session) {
      calls.push(['close', session]);
      // closing a session that is not open does not throw (playwright-cli): a throw is a real failure
      if (failClose > 0) {
        failClose -= 1;
        throw Object.assign(new Error('close timed out'), { code: 'TIMEOUT' });
      }
    },
  };
}

const names =
  (...list) =>
  () =>
    list.shift();

test('decode reads results as pw.mjs does: a JSON string, encoded once more by the driver', () => {
  assert.deepEqual(decode('{"a":1,"s":"x\\ny"}'), { a: 1, s: 'x\ny' });
  assert.equal(decode('"plain"'), 'plain');
  assert.equal(decode(undefined), undefined);
  assert.equal(decode(0.25), 0.25);
  assert.equal(decode('not json'), 'not json');
});

test('a session per logical name, with a generated name and the size in its launch config', () => {
  const d = fakeDriver();
  const b = webBrowser(d, { newName: names('web-aaaaaa', 'web-bbbbbb') });
  assert.equal(b.openSession('plg-src-o', { width: 390, height: 844, scale: 2 }), 'web-aaaaaa');
  assert.deepEqual(d.calls[0], [
    'open',
    { session: 'web-aaaaaa', config: launchConfig({ width: 390, height: 844, scale: 2 }) },
  ]);
  assert.deepEqual(launchConfig({ width: 390, height: 844, scale: 2 }).contextOptions, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    bypassCSP: true,
  });
  // opening a name again closes its earlier session first, as pw.mjs does
  b.openSession('plg-src-o');
  assert.deepEqual(
    d.calls.slice(1).map((c) => (c[0] === 'open' ? ['open', c[1].session] : c)),
    [
      ['close', 'web-aaaaaa'],
      ['open', 'web-bbbbbb'],
    ],
  );
  assert.deepEqual(d.calls[2][1].config.contextOptions.viewport, { width: 1440, height: 900 });
});

test('a generated name another process holds is retried; after 3 tries the error stands', () => {
  const d = fakeDriver({ exists: new Set(['web-111111', 'web-222222']) });
  const b = webBrowser(d, { newName: names('web-111111', 'web-222222', 'web-333333') });
  assert.equal(b.openSession('s'), 'web-333333');
  const d2 = fakeDriver({ exists: new Set(['a', 'b', 'c']) });
  assert.throws(() => webBrowser(d2, { newName: names('a', 'b', 'c') }).openSession('s'), /exists/);
  // another process's browser is never closed
  assert.equal([...d.calls, ...d2.calls].filter((c) => c[0] === 'close').length, 0);
});

test('a launch that fails may have started its browser: it is closed, and the error stands', () => {
  const d = fakeDriver({ failOpen: 'TIMEOUT' });
  const b = webBrowser(d, { newName: names('web-eeeeee') });
  assert.throws(() => b.openSession('s'), /open timed out/);
  assert.deepEqual(
    d.calls.filter((c) => c[0] === 'close').map((c) => c[1]),
    ['web-eeeeee'],
  );
  assert.deepEqual(b.sessions(), []);
  assert.deepEqual(b.closeAll(), []);
});

test('runCode: the session behind the name, decoded, 20 min unless the tool bounds it', () => {
  const d = fakeDriver({ answers: ['{"n":2}', '"0.012"'] });
  const b = webBrowser(d, { newName: names('web-cccccc') });
  b.openSession('cls');
  assert.deepEqual(b.runCode('cls', 'async page => 1'), { n: 2 });
  assert.equal(Number(b.runCode('cls', 'async page => 2', { timeout: 5000 })), 0.012);
  const runs = d.calls.filter((c) => c[0] === 'run');
  assert.deepEqual(
    runs.map((c) => [c[1], c[2].timeoutMs]),
    [
      ['web-cccccc', 20 * 60_000],
      ['web-cccccc', 5000],
    ],
  );
  assert.throws(() => b.runCode('never-opened', 'x'), /not open/);
});

test("runCodeAsync is the driver's runAsync, decoded, 20 min unless the check bounds it", async () => {
  const d = fakeDriver({ answers: ['[1,2]', '3'] });
  const b = webBrowser(d, { newName: names('web-dddddd') });
  b.openSession('t-1000x900-s');
  assert.deepEqual(
    await b.runCodeAsync('t-1000x900-s', 'async page => 3', { timeout: 180000 }),
    [1, 2],
  );
  assert.equal(await b.runCodeAsync('t-1000x900-s', 'async page => 4'), 3);
  const runs = d.calls.filter((c) => c[0] === 'runAsync');
  assert.deepEqual(
    runs.map((c) => [c[1], c[2].code, c[2].timeoutMs]),
    [
      ['web-dddddd', 'async page => 3', 180000],
      ['web-dddddd', 'async page => 4', 20 * 60_000],
    ],
  );
  assert.equal(d.calls.filter((c) => c[0] === 'run').length, 0);
});

test('useBrowser: the checks call the browser of the command running, and none outside one', () => {
  const d = fakeDriver({ answers: ['"ok"'] });
  assert.throws(() => openSession('x'), /inside a `web header` command/);
  useBrowser(webBrowser(d, { newName: names('web-ffffff') }));
  try {
    openSession('x');
    assert.equal(runCode('x', 'async page => 1'), 'ok');
    closeSession('x');
  } finally {
    useBrowser(null);
  }
  assert.deepEqual(
    d.calls.map((c) => c[0]),
    ['open', 'run', 'close'],
  );
  assert.throws(() => runCode('x', 'y'), /inside a `web header` command/);
});

test('closeAll closes every open session', () => {
  const d = fakeDriver();
  const b = webBrowser(d, { newName: names('web-1', 'web-2') });
  b.openSession('a');
  b.openSession('b');
  assert.deepEqual(b.closeAll(), []);
  assert.deepEqual(
    d.calls.filter((c) => c[0] === 'close').map((c) => c[1]),
    ['web-1', 'web-2'],
  );
  assert.deepEqual(b.sessions(), []);
  b.closeSession('a'); // already closed: nothing to do
  assert.equal(d.calls.filter((c) => c[0] === 'close').length, 2);
});

test('a close that fails is kept: closeAll retries it, and reports by name one that still fails', () => {
  const warned = [];
  // web-1 fails once (closed on the retry); web-2 fails at closeSession and on the retry
  const d = fakeDriver({ failClose: 1 });
  const b = webBrowser(d, { newName: names('web-1', 'web-2'), warn: (l) => warned.push(l) });
  b.openSession('a');
  b.closeSession('a'); // fails
  assert.deepEqual(b.closeAll(), []); // retried: closed
  assert.deepEqual(warned, []);
  const d2 = fakeDriver({ failClose: 2 });
  const b2 = webBrowser(d2, { newName: names('web-2'), warn: (l) => warned.push(l) });
  b2.openSession('a');
  assert.deepEqual(b2.closeAll(), ['web-2']);
  assert.deepEqual(
    d2.calls.filter((c) => c[0] === 'close').map((c) => c[1]),
    ['web-2', 'web-2'],
  );
  assert.equal(warned.length, 1);
  assert.match(
    warned[0],
    /web-2 could not be closed \(close timed out\): playwright-cli -s=web-2 close/,
  );
});
