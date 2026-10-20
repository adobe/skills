import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDriver } from './playwright-cli.mjs';

function setup(responder = () => '{}', { debug = false } = {}) {
  const calls = [];
  const outputDir = mkdtempSync(join(tmpdir(), 'web-driver-test-'));
  const exec = (args) => {
    calls.push(args);
    const out = responder(args);
    return typeof out === 'string' ? { stdout: out, stderr: '', status: 0 } : out;
  };
  return { calls, outputDir, driver: createDriver({ exec, outputDir, debug }) };
}

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return undefined;
};

test('evaluate double-parses the result envelope', () => {
  const { driver } = setup(() => '{"result":"{\\"a\\":1}"}');
  assert.deepEqual(driver.evaluate('s', 'x'), { a: 1 });
});

test('evaluate falls back to the raw string when not JSON', () => {
  const { driver } = setup(() => '{"result":"plain text"}');
  assert.equal(driver.evaluate('s', 'x'), 'plain text');
});

test('evaluate wraps statements in an IIFE', () => {
  const { driver, calls } = setup(() => '{"result":"1"}');
  driver.evaluate('s', 'const a = 1; return a');
  assert.equal(calls[0][1], 'eval');
  assert.ok(calls[0][2].startsWith('(() => {'));
  assert.equal(calls[0][0], '-s=s');
});

test('evaluate wraps plain expressions as a returned value', () => {
  const { driver, calls } = setup(() => '{"result":"1"}');
  driver.evaluate('s', 'document.title');
  assert.equal(calls[0][2], 'document.title');
});

test('evaluate passes an expression with nested semicolons through unwrapped', () => {
  const { driver, calls } = setup(() => '{"result":"1"}');
  const expr =
    "[...document.querySelectorAll('*')].filter(el => " +
    "{ var s = getComputedStyle(el); return s.position === 'fixed'; }).length";
  driver.evaluate('s', expr);
  assert.equal(calls[0][2], expr);
});

test('evaluate wraps statements with return in an IIFE', () => {
  const { driver, calls } = setup(() => '{"result":"2"}');
  driver.evaluate('s', 'const a = 1; return a + 1');
  assert.equal(calls[0][2], '(() => { const a = 1; return a + 1 })()');
});

test('not-open error becomes NO_SESSION with open hint', () => {
  const { driver } = setup(() => ({
    stdout: JSON.stringify({
      isError: true,
      error: "The browser 'x' is not open, please run open first",
    }),
    stderr: '',
    status: 1,
  }));
  assert.throws(
    () => driver.evaluate('x', '1'),
    (e) => e.code === 'NO_SESSION' && /web browser open/.test(e.hint),
  );
});

test('other error documents become PLAYWRIGHT_CLI', () => {
  const { driver } = setup(() => ({
    stdout: JSON.stringify({ isError: true, error: 'boom' }),
    stderr: '',
    status: 1,
  }));
  assert.throws(
    () => driver.goto('x', 'http://a'),
    (e) => e.code === 'PLAYWRIGHT_CLI' && e.message === 'boom',
  );
});

test('spawn errors map to TIMEOUT, install hint, or PLAYWRIGHT_CLI', () => {
  const fail = (errCode) =>
    setup(() => ({
      stdout: '',
      stderr: '',
      status: null,
      error: Object.assign(new Error('m'), { code: errCode }),
    })).driver;
  assert.equal(
    code(() => fail('ETIMEDOUT').goto('x', 'http://a')),
    'TIMEOUT',
  );
  assert.throws(
    () => fail('ENOENT').goto('x', 'http://a'),
    (e) => e.code === 'PLAYWRIGHT_CLI' && /npm install -g/.test(e.hint),
  );
  assert.throws(
    () => fail('ENOBUFS').goto('x', 'http://a'),
    (e) => e.code === 'PLAYWRIGHT_CLI' && /ENOBUFS: m/.test(e.message),
  );
});

test('open refuses an already open session name', () => {
  const { driver } = setup(() => JSON.stringify({ browsers: [{ name: 'a', status: 'open' }] }));
  assert.equal(
    code(() => driver.open({ session: 'a', url: 'http://x' })),
    'SESSION_EXISTS',
  );
});

test('open surfaces an error nested in the result', () => {
  const { driver } = setup((args) =>
    args.includes('open')
      ? JSON.stringify({ session: 'a', result: { isError: true, error: 'launch failed' } })
      : '{"browsers":[]}',
  );
  assert.throws(() => driver.open({ session: 'a' }), /launch failed/);
});

test('open writes config under outputDir, passes --config, removes it after', () => {
  let seen;
  const ctx = setup((args) => {
    const flag = args.find((a) => a.startsWith('--config='));
    if (flag) seen = { path: flag.slice(9), body: JSON.parse(readFileSync(flag.slice(9), 'utf8')) };
    return '{"browsers":[]}';
  });
  const res = ctx.driver.open({
    session: 'a',
    url: 'http://x',
    headed: true,
    persistent: true,
    config: {
      browserName: 'chromium',
      initScript: ['/own.js'],
      launchOptions: { channel: 'chrome' },
    },
    initScripts: ['/abs/init.js'],
  });
  assert.equal(seen.path, join(ctx.outputDir, 'a-cli-config.json'));
  assert.deepEqual(seen.body.browser.initScript, ['/own.js', '/abs/init.js']);
  assert.equal(seen.body.browser.launchOptions.channel, 'chrome');
  assert.equal(existsSync(seen.path), false);
  const openArgs = ctx.calls.find((c) => c.includes('open'));
  assert.deepEqual(
    openArgs.filter((a) => !a.startsWith('--config=')),
    ['-s=a', 'open', 'http://x', '--headed', '--persistent'],
  );
  assert.deepEqual(res, { session: 'a', url: 'http://x', headed: true, cdpPort: undefined });
});

test('open adds --remote-debugging-port to launchOptions.args when cdpPort set', () => {
  let body;
  const { driver } = setup((args) => {
    const flag = args.find((a) => a.startsWith('--config='));
    if (flag) body = JSON.parse(readFileSync(flag.slice(9), 'utf8'));
    return '{"browsers":[]}';
  });
  driver.open({
    session: 'a',
    cdpPort: 9333,
    config: { launchOptions: { args: ['--foo'] } },
  });
  assert.deepEqual(body.browser.launchOptions.args, ['--foo', '--remote-debugging-port=9333']);
});

test('cdp builds run-code with newCDPSession and method, then cleans up', () => {
  let src;
  const { driver, calls, outputDir } = setup((args) => {
    src = readFileSync(args[2].slice('--filename='.length), 'utf8');
    return '{"result":"{\\"ok\\":true}"}';
  });
  assert.deepEqual(driver.cdp('s', 'Page.enable', { a: 1 }), { ok: true });
  assert.match(src, /newCDPSession\(page\)/);
  assert.match(src, /s\.send\("Page\.enable", \{"a":1\}\)/);
  assert.equal(calls[0][2], `--filename=${join(outputDir, 's-run-1.mjs')}`);
  assert.equal(existsSync(join(outputDir, 's-run-1.mjs')), false);
});

test('inject sends the bundle source JSON-stringified', () => {
  let src;
  const { driver } = setup((args) => {
    src = readFileSync(args[2].slice('--filename='.length), 'utf8');
    return '{}';
  });
  driver.inject('s', 'window.x = "q";');
  assert.ok(src.includes(JSON.stringify('window.x = "q";')));
});

test('run with file passes it through untouched', () => {
  const { driver, calls } = setup(() => '{"result":"2"}');
  assert.equal(driver.run('s', { file: '/p/f.mjs' }), 2);
  assert.deepEqual(calls[0], ['-s=s', 'run-code', '--filename=/p/f.mjs']);
});

test('attach uses --session and no -s', () => {
  const { driver, calls } = setup();
  assert.deepEqual(driver.attach({ session: 'a', cdpUrl: 'http://127.0.0.1:9222' }), {
    session: 'a',
    attached: true,
  });
  assert.deepEqual(calls[0], ['attach', '--cdp=http://127.0.0.1:9222', '--session=a']);
});

test('screenshot builds selector, filename and full-page args', () => {
  const { driver, calls } = setup();
  assert.deepEqual(driver.screenshot('s', { path: '/o/a.png', fullPage: true, selector: 'h1' }), {
    path: '/o/a.png',
  });
  assert.deepEqual(calls[0], ['-s=s', 'screenshot', 'h1', '--filename=/o/a.png', '--full-page']);
});

test('pageHealth returns title, bodyLength, url, status and hasMainContent', () => {
  const health = { title: 'T', bodyLength: 5, url: 'u', status: 200, hasMainContent: true };
  const { driver, calls } = setup(() => JSON.stringify({ result: JSON.stringify(health) }));
  assert.deepEqual(driver.pageHealth('s'), health);
  assert.match(calls[0][2], /responseStatus/);
  assert.match(calls[0][2], /main, article, \[role=main\]/);
});

test('requests returns the static request listing text', () => {
  const { driver, calls } = setup(() => '{"result":"1. [GET] http://x/ => [200] OK"}');
  assert.equal(driver.requests('s'), '1. [GET] http://x/ => [200] OK');
  assert.deepEqual(calls[0], ['-s=s', 'requests', '--static']);
});

test('responseHeaders returns header text for a request index', () => {
  const { driver, calls } = setup(() => '{"result":"server: nginx\\ncf-ray: abc"}');
  assert.equal(driver.responseHeaders('s', '2'), 'server: nginx\ncf-ray: abc');
  assert.deepEqual(calls[0], ['-s=s', 'response-headers', '2']);
});

test('list maps browsers', () => {
  const { driver } = setup(() =>
    JSON.stringify({
      browsers: [
        {
          name: 'a',
          status: 'open',
          browserType: 'chromium',
          headed: false,
          attached: true,
          pid: 1,
        },
      ],
    }),
  );
  assert.deepEqual(driver.list(), [
    { name: 'a', status: 'open', browserType: 'chromium', headed: false, attached: true },
  ]);
});

test('ensureAvailable rejects 0.1.19 and missing binary, accepts 0.1.20', () => {
  const old = setup(() => '0.1.19\n').driver;
  assert.equal(
    code(() => old.ensureAvailable()),
    'PLAYWRIGHT_CLI',
  );
  const missing = setup(() => ({ stdout: '', stderr: '', status: null })).driver;
  assert.equal(
    code(() => missing.ensureAvailable()),
    'PLAYWRIGHT_CLI',
  );
  assert.doesNotThrow(() => setup(() => '0.1.20\n').driver.ensureAvailable());
  assert.doesNotThrow(() => setup(() => '0.2.0\n').driver.ensureAvailable());
});

test('debug echoes argv to stderr', (t) => {
  const write = t.mock.method(process.stderr, 'write', () => true);
  const { driver } = setup(() => '{}', { debug: true });
  driver.goto('s', 'http://a');
  assert.equal(write.mock.calls[0].arguments[0], 'playwright-cli -s=s goto http://a\n');
});

test('open writes absolute initScript paths even when given relative ones', () => {
  let body;
  const { driver } = setup((args) => {
    const flag = args.find((a) => a.startsWith('--config='));
    if (flag) body = JSON.parse(readFileSync(flag.slice(9), 'utf8'));
    return '{"browsers":[]}';
  });
  driver.open({
    session: 'a',
    config: { initScript: ['.web/own.js'] },
    initScripts: ['.web/init.js'],
  });
  assert.deepEqual(body.browser.initScript, [resolve('.web/own.js'), resolve('.web/init.js')]);
});

test('exec receives the driver-level timeoutMs on every call', () => {
  const seen = [];
  const exec = (args, opts) => {
    seen.push(opts.timeoutMs);
    return { stdout: '{}', stderr: '', status: 0 };
  };
  const outputDir = mkdtempSync(join(tmpdir(), 'web-driver-test-'));
  const driver = createDriver({ exec, outputDir, debug: false, timeoutMs: 30_000 });
  driver.evaluate('s', 'x');
  assert.deepEqual(seen, [30000]);
});
