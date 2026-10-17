import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';

const HINT = 'run: web browser open <url> --session <name>';
const OPEN = [{ name: 's', status: 'open' }];
const call = (calls, n) => calls.find((c) => c[0] === n);
const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

function run(args, { sessions = [], evalThrows = false } = {}) {
  const calls = [];
  const rec =
    (n, ret) =>
    (...a) => (calls.push([n, ...a]), ret);
  const driver = {
    ensureAvailable: rec('ensureAvailable'),
    open: rec('open'),
    list: () => sessions,
    attach: rec('attach'),
    close: rec('close'),
    closeAll: rec('closeAll'),
    run: rec('run', 'ran'),
    screenshot: rec('screenshot'),
    evaluate: evalThrows
      ? () => {
          throw new Error('dead');
        }
      : rec('evaluate', 'http://x/'),
    cdp: rec('cdp', { ok: 1 }),
  };
  const stdout = sink();
  const stderr = sink();
  const deps = { stdout, stderr, env: {}, driverFactory: () => driver };
  return runCli(['node', 'web', ...args], deps).then((code) => ({ code, calls, stdout }));
}

test('browser eval without session exits 2 NO_SESSION', async () => {
  const { code, stdout } = await run(['browser', 'eval', '1']);
  assert.equal(code, 2);
  const { error } = JSON.parse(stdout.buf);
  assert.equal(error.code, 'NO_SESSION');
  assert.equal(error.hint, HINT);
});

test('browser open prints { session, url, headed }', async () => {
  const { code, stdout, calls } = await run(['browser', 'open', 'http://x', '--session', 's']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.buf), { session: 's', url: 'http://x', headed: false });
  assert.equal(calls.find((c) => c[0] === 'open')[1].session, 's');
});

test('browser cdp parses params json and forwards', async () => {
  const sessions = [{ name: 's', status: 'open' }];
  const { stdout, calls } = await run(['browser', 'cdp', 'Page.x', '{"a":1}', '--session', 's'], {
    sessions,
  });
  assert.deepEqual(
    calls.find((c) => c[0] === 'cdp'),
    ['cdp', 's', 'Page.x', { a: 1 }],
  );
  assert.deepEqual(JSON.parse(stdout.buf), { result: { ok: 1 } });
});

test('browser cdp with invalid json exits 2 USAGE', async () => {
  const sessions = [{ name: 's', status: 'open' }];
  const { code } = await run(['browser', 'cdp', 'M', '{bad', '--session', 's'], { sessions });
  assert.equal(code, 2);
});

test('browser list adds url for open sessions only', async () => {
  const sessions = [
    { name: 'a', status: 'open', headed: false },
    { name: 'b', status: 'closed', headed: false },
  ];
  const { stdout } = await run(['browser', 'list'], { sessions });
  assert.deepEqual(
    JSON.parse(stdout.buf).sessions.map((s) => s.url),
    ['http://x/', null],
  );
});

test('browser attach prints { session, attached } and forwards cdpUrl', async () => {
  const { stdout, calls } = await run(['browser', 'attach', 'http://h:9222', '--session', 's']);
  assert.deepEqual(JSON.parse(stdout.buf), { session: 's', attached: true });
  assert.deepEqual(call(calls, 'attach')[1], { session: 's', cdpUrl: 'http://h:9222' });
});

test('browser close prints closed; NO_SESSION with hint when not open', async () => {
  const ok = await run(['browser', 'close', '--session', 's'], { sessions: OPEN });
  assert.deepEqual(JSON.parse(ok.stdout.buf), { session: 's', status: 'closed' });
  assert.deepEqual(call(ok.calls, 'close'), ['close', 's']);
  const bad = await run(['browser', 'close', '--session', 's']);
  const { error } = JSON.parse(bad.stdout.buf);
  assert.equal(error.code, 'NO_SESSION');
  assert.equal(error.hint, HINT);
});

test('browser close-all prints closed names', async () => {
  const sessions = [
    { name: 'a', status: 'open' },
    { name: 'b', status: 'closed' },
  ];
  const { stdout, calls } = await run(['browser', 'close-all'], { sessions });
  assert.deepEqual(JSON.parse(stdout.buf), { closed: ['a', 'b'] });
  assert.ok(call(calls, 'closeAll'));
});

test('browser eval prints { result }', async () => {
  const { stdout, calls } = await run(['browser', 'eval', '1+1', '--session', 's'], {
    sessions: OPEN,
  });
  assert.deepEqual(JSON.parse(stdout.buf), { result: 'http://x/' });
  assert.deepEqual(call(calls, 'evaluate'), ['evaluate', 's', '1+1']);
});

test('browser run passes { file } for existing file and { code } otherwise', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'run-')), 's.mjs');
  writeFileSync(file, '');
  const f = await run(['browser', 'run', file, '--session', 's'], { sessions: OPEN });
  assert.deepEqual(call(f.calls, 'run'), ['run', 's', { file }]);
  assert.deepEqual(JSON.parse(f.stdout.buf), { result: 'ran' });
  const c = await run(['browser', 'run', 'return 1', '--session', 's'], { sessions: OPEN });
  assert.deepEqual(call(c.calls, 'run'), ['run', 's', { code: 'return 1' }]);
});

test('browser screenshot prints timestamped path and forwards flags', async () => {
  const { stdout, calls } = await run(
    ['browser', 'screenshot', '--full-page', '--selector', 'h1', '--session', 's'],
    { sessions: OPEN },
  );
  const { path } = JSON.parse(stdout.buf);
  assert.match(path, /s-screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.png$/);
  assert.deepEqual(call(calls, 'screenshot'), [
    'screenshot',
    's',
    { path, fullPage: true, selector: 'h1' },
  ]);
});

test('browser open: --cdp-port is a number, no --session generates a name', async () => {
  const { stdout, calls } = await run(['browser', 'open', 'http://x', '--cdp-port', '9222']);
  const out = JSON.parse(stdout.buf);
  assert.equal(out.cdpPort, 9222);
  assert.match(out.session, /^web-[0-9a-f]{4}$/);
  assert.strictEqual(call(calls, 'open')[1].cdpPort, 9222);
});

test('browser open --recipe passes config and persistent', async () => {
  const rf = join(mkdtempSync(join(tmpdir(), 'rec-')), 'r.json');
  writeFileSync(rf, JSON.stringify({ cliConfig: { browser: { a: 1 } }, persistent: true }));
  const { calls } = await run(['browser', 'open', 'http://x', '--session', 's', '--recipe', rf]);
  const o = call(calls, 'open')[1];
  assert.deepEqual(o.config, { a: 1 });
  assert.equal(o.persistent, true);
});

test('browser list gives url null when evaluate throws', async () => {
  const { stdout } = await run(['browser', 'list'], { sessions: OPEN, evalThrows: true });
  assert.equal(JSON.parse(stdout.buf).sessions[0].url, null);
});
