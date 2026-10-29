import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';
import { CACHE_STATS_CODE } from '#src/cache/hooks.mjs';

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

function run(args, { sessions = [], evalThrows = false, env = {}, keeper, openThrows } = {}) {
  const calls = [];
  const rec =
    (n, ret) =>
    (...a) => (calls.push([n, ...a]), ret);
  const driver = {
    ensureAvailable: rec('ensureAvailable'),
    open: openThrows
      ? (...a) => {
          calls.push(['open', ...a]);
          throw new Error('launch failed');
        }
      : rec('open'),
    goto: rec('goto'),
    list: () => sessions,
    attach: rec('attach'),
    close: rec('close'),
    closeAll: rec('closeAll'),
    run: (...a) => (calls.push(['run', ...a]), a[1]?.code === CACHE_STATS_CODE ? 3 : 'ran'),
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
  const deps = { stdout, stderr, env, driverFactory: () => driver };
  if (keeper) {
    deps.keeper = {
      start: async (opts) => (calls.push(['keeperStart', opts]), keeper.started),
      stop: async (opts) => (calls.push(['keeperStop', opts]), keeper.stopped),
    };
  }
  return runCli(['node', 'web', ...args], deps).then((code) => ({ code, calls, stdout, stderr }));
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

const recipeFile = () => {
  const file = join(mkdtempSync(join(tmpdir(), 'rec-')), 'r.json');
  const probe = [{ config: { a: 1 }, persistent: true, stealth: true }];
  const overlays = [{ rules: ['#b { display:none!important }'] }];
  writeFileSync(file, JSON.stringify({ probe, overlays }));
  return file;
};

function assertRecipeApplied(calls) {
  const o = call(calls, 'open')[1];
  assert.deepEqual(o.config, { a: 1 });
  assert.equal(o.persistent, true);
  assert.equal(o.initSources.length, 2);
}

test('browser open --recipe passes config, persistent and init scripts', async () => {
  const { calls } = await run([
    'browser',
    'open',
    'http://x',
    '--session',
    's',
    '--recipe',
    recipeFile(),
  ]);
  assertRecipeApplied(calls);
});

test('WEB_RECIPE is the default for --recipe', async () => {
  const env = { WEB_RECIPE: recipeFile() };
  const { calls } = await run(['browser', 'open', 'http://x', '--session', 's'], { env });
  assertRecipeApplied(calls);
});

test('./recipe.json is used when it exists and --recipe is not given', async () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'rec-cwd-'));
  writeFileSync(join(dir, 'recipe.json'), readFileSync(recipeFile()));
  process.chdir(dir);
  try {
    const { calls } = await run(['browser', 'open', 'http://x', '--session', 's']);
    assertRecipeApplied(calls);
  } finally {
    process.chdir(cwd);
  }
});

test('a missing --recipe file exits 2 USAGE', async () => {
  const { code } = await run(['browser', 'open', 'http://x', '--recipe', '/no/such.json']);
  assert.equal(code, 2);
});

test('browser list gives url null when evaluate throws', async () => {
  const { stdout } = await run(['browser', 'list'], { sessions: OPEN, evalThrows: true });
  assert.equal(JSON.parse(stdout.buf).sessions[0].url, null);
});

test('browser open --proxy sets proxy and ignoreHTTPSErrors and prints proxy', async () => {
  const proxy = 'http://127.0.0.1:3002';
  const { code, stdout, calls } = await run([
    'browser',
    'open',
    'https://a.test',
    '--proxy',
    proxy,
  ]);
  assert.equal(code, 0);
  const { config } = call(calls, 'open')[1];
  assert.equal(config.launchOptions.proxy.server, proxy);
  assert.equal(config.contextOptions.ignoreHTTPSErrors, true);
  assert.equal(JSON.parse(stdout.buf).proxy, proxy);
});

test('browser open --proxy keeps the recipe probe config', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'rec-')), 'recipe.json');
  const probe = [{ config: { contextOptions: { locale: 'fr' } } }];
  writeFileSync(file, JSON.stringify({ probe }));
  const { calls } = await run([
    'browser',
    'open',
    'https://a.test',
    '--proxy',
    'http://127.0.0.1:3002',
    '--recipe',
    file,
  ]);
  const { config } = call(calls, 'open')[1];
  assert.deepEqual(config.contextOptions, { locale: 'fr', ignoreHTTPSErrors: true });
  assert.equal(config.launchOptions.proxy.server, 'http://127.0.0.1:3002');
});

test('browser open --proxy with an invalid URL exits 2 USAGE', async () => {
  const { code, stdout } = await run(['browser', 'open', 'https://a.test', '--proxy', 'notaurl']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
});

const KEEPER = {
  started: { pid: 1, port: 4321, entries: 7, dir: '/abs/cache' },
  stopped: { hits: 5, misses: 2, stored: 2, errors: 1 },
};
const names = (calls) => calls.map((c) => c[0]);

test('open --cache starts keeper, installs hooks before navigating', async () => {
  const { code, calls, stdout } = await run(
    ['browser', 'open', 'http://x', '--session', 's', '--cache', 'c'],
    { keeper: KEEPER },
  );
  assert.equal(code, 0);
  assert.deepEqual(
    names(calls).filter((n) => n !== 'ensureAvailable'),
    ['keeperStart', 'open', 'run', 'goto'],
  );
  assert.equal(call(calls, 'keeperStart')[1].session, 's');
  assert.equal(call(calls, 'keeperStart')[1].cacheDir, 'c');
  assert.equal(call(calls, 'open')[1].url, undefined);
  assert.match(call(calls, 'run')[2].code, /127\.0\.0\.1:4321/);
  assert.deepEqual(call(calls, 'goto'), ['goto', 's', 'http://x']);
  assert.deepEqual(JSON.parse(stdout.buf), {
    session: 's',
    url: 'http://x',
    headed: false,
    cache: { dir: '/abs/cache', entries: 7 },
  });
});

test('open --cache without url does not navigate', async () => {
  const { code, calls } = await run(['browser', 'open', '--session', 's', '--cache', 'c'], {
    keeper: KEEPER,
  });
  assert.equal(code, 0);
  assert.equal(call(calls, 'goto'), undefined);
  assert.ok(call(calls, 'run'));
});

test('open --cache --proxy is USAGE', async () => {
  const { code, calls, stdout } = await run(
    ['browser', 'open', 'http://x', '--cache', 'c', '--proxy', 'http://127.0.0.1:3002'],
    { keeper: KEEPER },
  );
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
  assert.equal(call(calls, 'keeperStart'), undefined);
  assert.equal(call(calls, 'open'), undefined);
});

test('open --cache stops keeper when the browser fails to open', async () => {
  const { code, calls } = await run(
    ['browser', 'open', 'http://x', '--session', 's', '--cache', 'c'],
    {
      keeper: KEEPER,
      openThrows: true,
    },
  );
  assert.notEqual(code, 0);
  assert.ok(call(calls, 'keeperStop'));
  assert.ok(call(calls, 'close'));
});

test('close reports cache stats', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-close-'));
  writeFileSync(join(dir, 's-cache-keeper.json'), '{}');
  const { code, calls, stdout } = await run(
    ['browser', 'close', '--session', 's', '--output', dir],
    { sessions: OPEN, keeper: KEEPER },
  );
  assert.equal(code, 0);
  assert.ok(names(calls).indexOf('run') < names(calls).indexOf('close'));
  assert.deepEqual(JSON.parse(stdout.buf), {
    session: 's',
    status: 'closed',
    cache: { hits: 5, misses: 2, stored: 2, errors: 4 },
  });
});

test('close with dead keeper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-close-'));
  writeFileSync(join(dir, 's-cache-keeper.json'), '{}');
  const { code, calls, stdout, stderr } = await run(
    ['browser', 'close', '--session', 's', '--output', dir],
    { sessions: OPEN, keeper: { ...KEEPER, stopped: null } },
  );
  assert.equal(code, 0);
  assert.ok(call(calls, 'close'));
  assert.deepEqual(JSON.parse(stdout.buf), { session: 's', status: 'closed', cache: null });
  assert.match(stderr.buf, /cache keeper for s was not running/);
});

test('close without cache keeps the old output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-close-'));
  const { stdout } = await run(['browser', 'close', '--session', 's', '--output', dir], {
    sessions: OPEN,
    keeper: { ...KEEPER, stopped: null },
  });
  assert.deepEqual(JSON.parse(stdout.buf), { session: 's', status: 'closed' });
});

test('close-all stops every keeper', async () => {
  const sessions = [
    { name: 'a', status: 'open' },
    { name: 'b', status: 'open' },
  ];
  const { calls, stdout } = await run(['browser', 'close-all'], { sessions, keeper: KEEPER });
  assert.deepEqual(
    calls.filter((c) => c[0] === 'keeperStop').map((c) => c[1].session),
    ['a', 'b'],
  );
  assert.deepEqual(JSON.parse(stdout.buf), { closed: ['a', 'b'] });
});

test('open --cache on an open session is SESSION_EXISTS and keeps its keeper', async () => {
  const { code, calls, stdout } = await run(
    ['browser', 'open', 'http://x', '--session', 's', '--cache', 'c'],
    { sessions: OPEN, keeper: KEEPER },
  );
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'SESSION_EXISTS');
  assert.equal(call(calls, 'keeperStart'), undefined);
  assert.equal(call(calls, 'keeperStop'), undefined);
  assert.equal(call(calls, 'close'), undefined);
});
