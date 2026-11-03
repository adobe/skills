import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '#src/cli.mjs';
import { CliError } from '#src/errors.mjs';
import { CHECK_FAILED, pixelsVerdict } from './header.mjs';

/**
 * runCli with a fake driver and captured output. `runAsync(session, code, timeoutMs)` answers the
 * driver's runAsync (the text check's parallel sizes); `deps` adds or replaces CLI deps.
 */
async function cli(args, driver, runAsync, deps = {}) {
  let out = '';
  let err = '';
  if (runAsync) driver.runAsyncWith = runAsync;
  const code = await runCli(['node', 'web', ...args], {
    driverFactory: () => driver,
    stdout: {
      write: (c) => {
        out += c;
      },
    },
    stderr: {
      write: (c) => {
        err += c;
      },
    },
    ...deps,
  });
  return { code, out, err };
}

function fakeDriver(answer) {
  const calls = [];
  const widths = {};
  return {
    calls,
    widths,
    ensureAvailable() {},
    open: (o) => {
      widths[o.session] = o.config.contextOptions.viewport.width;
      calls.push(['open', o.session, o.config.contextOptions.viewport.width]);
    },
    run: (s, o) => {
      calls.push(['run', s, o.timeoutMs]);
      return typeof answer === 'function' ? answer(o.code) : answer;
    },
    async runAsync(s, o) {
      calls.push(['runAsync', s, o.timeoutMs]);
      if (this.runAsyncWith) return this.runAsyncWith(s, o.code, o.timeoutMs);
      return typeof answer === 'function' ? answer(o.code) : answer;
    },
    close: (s) => calls.push(['close', s]),
    list: () => [],
  };
}

test('check cls: one session per width, closed after; the bar threshold decides clean', async () => {
  // the page function returns String(cls): the driver hands back its JSON
  const d = fakeDriver((code) => (code.includes('layout-shift') ? '"0.012"' : undefined));
  const r = await cli(['header', 'check', 'cls', 'http://localhost:3000/', '1200,992'], d);
  assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(r.out);
  assert.deepEqual(doc.cls, { 1200: 0.012, 992: 0.012 });
  assert.equal(doc.clean, true);
  assert.deepEqual(
    d.calls.filter((c) => c[0] === 'open').map((c) => c[2]),
    [1200, 992],
  );
  const opened = d.calls.filter((c) => c[0] === 'open').map((c) => c[1]);
  assert.deepEqual(
    d.calls.filter((c) => c[0] === 'close').map((c) => c[1]),
    opened,
  );
  assert.ok(
    opened.every((s) => /^web-[0-9a-f]{6}$/.test(s)),
    opened.join(),
  );
});

test('check cls --max: over the threshold is not clean, exit 0; --format text gives the lines', async () => {
  const r = await cli(
    [
      'header',
      'check',
      'cls',
      'http://localhost:3000/',
      '1440,992',
      '--max',
      '0.01',
      '--format',
      'text',
    ],
    fakeDriver('"0.012"'),
  );
  assert.equal(r.code, 0);
  // in the order asked, not the object's (992 would come first)
  assert.equal(r.out.trim(), 'FAIL CLS at 1440: 0.012\nFAIL CLS at 992: 0.012');
});

test('a check that fails is CHECK_FAILED, exit 1, whatever the driver threw; its session is closed', async () => {
  // the real driver throws CliError: PLAYWRIGHT_CLI (exit 2 by the CLI's table) for a page that does not load
  for (const thrown of [
    new CliError('PLAYWRIGHT_CLI', 'page.goto: net::ERR_CONNECTION_REFUSED'),
    new CliError('TIMEOUT', 'run timed out'),
    new Error('boom'),
  ]) {
    const d = fakeDriver(() => {
      throw thrown;
    });
    const r = await cli(['header', 'check', 'cls', 'http://localhost:3000/', '1440'], d);
    assert.equal(r.code, 1, thrown.message);
    const { error } = JSON.parse(r.out);
    assert.equal(error.code, CHECK_FAILED);
    assert.ok(error.message.includes(thrown.message), error.message);
    if (thrown.code) assert.ok(error.message.startsWith(`${thrown.code}: `), error.message);
    assert.equal(d.calls.filter((c) => c[0] === 'close').length, 1);
  }
});

/** collect()'s answer for one size, as the page function returns it: one state, no text. */
const noText = JSON.stringify([{ y: 0, panelBottom: null, mainTop: null, texts: [] }]);

test('check text: a bad --parallel or --sizes is a usage error before any browser starts', async () => {
  for (const args of [
    ['--parallel', '0'],
    ['--parallel', '-1'],
    ['--parallel', '1.5'],
    ['--parallel', 'abc'],
    ['--sizes', '10x'],
    ['--scale', '0'],
  ]) {
    const d = fakeDriver();
    const r = await cli(
      ['header', 'check', 'text', 'http://a/', 'http://b/', ...args],
      d,
      async () => noText,
    );
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(JSON.parse(r.out).error.code, 'USAGE');
    assert.equal(d.calls.length, 0);
  }
});

test("check text: a size that could not be compared fails the command, with the other sizes' lines", async () => {
  const d = fakeDriver();
  const runAsync = async (session) => {
    if (d.widths[session] === 1000)
      throw new CliError('PLAYWRIGHT_CLI', 'Error: page.goto: net::ERR_CONNECTION_REFUSED');
    return noText;
  };
  const r = await cli(
    ['header', 'check', 'text', 'http://a/', 'http://b/', '--sizes', '1440,1000'],
    d,
    runAsync,
  );
  assert.equal(r.code, 1);
  const { error } = JSON.parse(r.out);
  assert.equal(error.code, CHECK_FAILED);
  assert.match(error.message, /^1 of 2 sizes could not be compared \(1000x900\)/);
  assert.match(error.message, /1440x900/);
  assert.match(error.hint, /--sizes 1000x900/);
  // every browser closed
  assert.equal(
    d.calls.filter((c) => c[0] === 'close').length,
    d.calls.filter((c) => c[0] === 'open').length,
  );
  // all of them compared: clean, exit 0
  const ok = await cli(
    ['header', 'check', 'text', 'http://a/', 'http://b/', '--sizes', '1440,1000'],
    fakeDriver(),
    async () => noText,
  );
  assert.equal(ok.code, 0, ok.out);
  const doc = JSON.parse(ok.out);
  assert.equal(doc.clean, true);
  assert.equal(doc.sizes.length, 2);
});

test('check text --parallel: that many sizes at a time, each a source and a page browser', async () => {
  const peak = async (parallel) => {
    let now = 0;
    let max = 0;
    const runAsync = async () => {
      now += 1;
      max = Math.max(max, now);
      await new Promise((r) => {
        setTimeout(r, 20);
      });
      now -= 1;
      return noText;
    };
    const r = await cli(
      [
        'header',
        'check',
        'text',
        'http://a/',
        'http://b/',
        '--sizes',
        '1440,1200,1000',
        '--parallel',
        String(parallel),
      ],
      fakeDriver(),
      runAsync,
    );
    assert.equal(r.code, 0, r.out);
    return max;
  };
  assert.equal(await peak(3), 6);
  assert.equal(await peak(1), 2);
});

test('check pixels: a map key naming no region of the capture is a usage error, before any browser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-test-'));
  try {
    writeFileSync(
      join(dir, 'page.json'),
      JSON.stringify({ regions: [{ id: 'r1' }, { id: 'r2' }] }),
    );
    writeFileSync(join(dir, 'map.json'), JSON.stringify({ rTypo: 'header' }));
    const d = fakeDriver();
    const r = await cli(
      [
        'header',
        'check',
        'pixels',
        'http://b/',
        dir,
        join(dir, 'out'),
        '--map',
        join(dir, 'map.json'),
      ],
      d,
    );
    assert.equal(r.code, 2);
    const { error } = JSON.parse(r.out);
    assert.equal(error.code, 'USAGE');
    assert.match(error.message, /no region rTypo .*\(its regions: r1, r2\)/);
    assert.equal(d.calls.length, 0);
    const noCapture = await cli(
      [
        'header',
        'check',
        'pixels',
        'http://b/',
        join(dir, 'none'),
        join(dir, 'out'),
        '--map',
        join(dir, 'map.json'),
      ],
      fakeDriver(),
    );
    assert.equal(noCapture.code, 2);
    assert.match(JSON.parse(noCapture.out).error.message, /not a capture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pixels verdict: clean only when a region was compared and every requested one accounted for', () => {
  const same = { srcH: 64, edsH: 64, mismatch: 0 };
  assert.deepEqual(pixelsVerdict({ regions: { r1: same } }), { clean: true, compared: ['r1'] });
  assert.equal(pixelsVerdict({ regions: { r1: { ...same, mismatch: 0.2 } } }).clean, false);
  assert.equal(pixelsVerdict({ regions: { r1: { ...same, edsH: 63 } } }).clean, false);
  // a requested region the page lacks, or the capture does not know, is not clean
  assert.equal(pixelsVerdict({ regions: { r1: same }, missing: ['r2'] }).clean, false);
  assert.equal(pixelsVerdict({ regions: {}, missing: ['r1'] }).clean, false);
  assert.equal(pixelsVerdict({ regions: {}, unknown: ['rTypo'] }).clean, false);
  // a region the source does not show at this width is not compared, the others decide
  assert.equal(pixelsVerdict({ regions: { r1: same }, notShown: ['r9'] }).clean, true);
  // nothing compared at all: a failed check, not a clean one
  assert.throws(
    () => pixelsVerdict({ regions: {}, notShown: ['r9'], viewport: 'mobile' }),
    (e) => e.code === CHECK_FAILED && /nothing compared at mobile/.test(e.message),
  );
  assert.throws(
    () => pixelsVerdict({ regions: {} }),
    (e) => e.code === CHECK_FAILED,
  );
});

test('usage errors exit 2; the stock commands are still there', async () => {
  const r = await cli(['header', 'check', 'menus'], fakeDriver());
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.out).error.code, 'USAGE');
  const help = await cli(['--help'], fakeDriver());
  assert.match(help.out, /page\s+analyze a page/);
  assert.match(help.out, /header\s+capture a site header/);
});

test('the image libraries missing: UNSUPPORTED, exit 2, before any browser starts', async () => {
  const loadImaging = async () => {
    throw new CliError('UNSUPPORTED', 'the header commands need sharp: Cannot find package', {
      hint: 'install',
    });
  };
  for (const args of [
    ['header', 'capture', 'http://a/', '/tmp/x'],
    ['header', 'check', 'text', 'http://a/', 'http://b/'],
    ['header', 'check', 'panels', 'http://b/', '/tmp/src', '/tmp/out'],
  ]) {
    const d = fakeDriver();
    const r = await cli(args, d, null, { loadImaging });
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(JSON.parse(r.out).error.code, 'UNSUPPORTED');
    assert.equal(d.calls.length, 0);
  }
  // the checks without images run without them
  const cls = await cli(
    ['header', 'check', 'cls', 'http://a/', '1440'],
    fakeDriver('"0.01"'),
    null,
    { loadImaging },
  );
  assert.equal(cls.code, 0, cls.out);
});
