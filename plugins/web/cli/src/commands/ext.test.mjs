import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';
import { extensionIdForPath } from '#src/commands/ext.mjs';

const MANIFEST = {
  manifest_version: 3,
  name: 'X',
  version: '1.0',
  side_panel: { default_path: 'panel.html' },
  action: { default_popup: 'popup.html' },
};
const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

function setup({ manifest = MANIFEST, sessions = [], run } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ext-test-'));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  if (manifest) writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest));
  const calls = [];
  const rec =
    (n, ret) =>
    (...a) => (calls.push([n, ...a]), ret);
  const driver = {
    ensureAvailable: rec('ensureAvailable'),
    open: rec('open'),
    list: () => sessions,
    close: rec('close'),
    run: (...a) => (calls.push(['run', ...a]), run ? run(a[1].code) : 'X'),
    cdp: rec('cdp', {}),
  };
  const stdout = sink();
  const deps = { stdout, stderr: sink(), env: {}, driverFactory: () => driver };
  const exec = (args) =>
    runCli(['node', 'web', '--output', root, ...args], deps).then((code) => ({
      code,
      calls,
      stdout,
    }));
  return { root, dist, exec, stdout };
}

test('ext launch prints { session, cdpPort, extensionId, surfaces }', async () => {
  const { dist, exec, stdout, root } = setup();
  const args = ['ext', 'launch', dist, '--session', 's', '--cdp-port', '9333'];
  const { code, calls } = await exec(args);
  assert.equal(code, 0);
  const out = JSON.parse(stdout.buf);
  assert.deepEqual(out.surfaces, ['sidepanel', 'popup']);
  assert.match(out.extensionId, /^[a-p]{32}$/);
  assert.equal(out.cdpPort, 9333);
  const opened = calls.find((c) => c[0] === 'open')[1];
  assert.equal(opened.headed, false);
  assert.equal(opened.config.launchOptions.channel, 'chromium');
  assert.equal(opened.persistent, true);
  assert.deepEqual(opened.config.launchOptions.args, [
    `--load-extension=${dist}`,
    `--disable-extensions-except=${dist}`,
  ]);
  assert.ok(existsSync(join(root, 's-ext-session.json')));
});

test('ext launch with missing manifest exits 2 without opening', async () => {
  const { dist, exec } = setup({ manifest: null });
  const { code, calls } = await exec(['ext', 'launch', dist]);
  assert.equal(code, 2);
  assert.equal(
    calls.find((c) => c[0] === 'open'),
    undefined,
  );
});

async function launched(opts) {
  const ctx = setup({ ...opts, sessions: [{ name: 's', status: 'open' }] });
  await ctx.exec(['ext', 'launch', ctx.dist, '--session', 's']);
  ctx.stdout.buf = '';
  return ctx;
}

test('ext open rejects a surface not in the manifest (USAGE)', async () => {
  const { exec, stdout } = await launched();
  const { code } = await exec(['ext', 'open', 'options', '--session', 's']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'USAGE');
});

test('ext open popup runs code containing the popup path', async () => {
  const { exec, stdout } = await launched();
  const { code, calls } = await exec(['ext', 'open', 'popup', '--session', 's']);
  assert.equal(code, 0);
  const runs = calls.filter((c) => c[0] === 'run');
  assert.match(runs.at(-1)[2].code, /chrome-extension:\/\/[a-p]{32}\/popup\.html/);
  assert.deepEqual(JSON.parse(stdout.buf), {
    surface: 'popup',
    url: 'X',
  });
});

test('ext open without a session file exits NO_SESSION', async () => {
  const { exec, stdout } = setup({ sessions: [{ name: 's', status: 'open' }] });
  const { code } = await exec(['ext', 'open', 'popup', '--session', 's']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.buf).error.code, 'NO_SESSION');
});

test('ext launch --headed shows the window', async () => {
  const { dist, exec } = setup();
  const { calls } = await exec(['ext', 'launch', dist, '--session', 's', '--headed']);
  assert.equal(calls.find((c) => c[0] === 'open')[1].headed, true);
});

test('ext status reports open:false when the session is gone', async () => {
  const { exec, stdout } = setup();
  const { code } = await exec(['ext', 'status', '--session', 's']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.buf), {
    session: 's',
    open: false,
    extensionId: null,
    surfaces: null,
  });
});

test('ext close removes the session file', async () => {
  const { exec, stdout, root } = await launched();
  const { code } = await exec(['ext', 'close', '--session', 's']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.buf), { session: 's', status: 'closed' });
  assert.equal(existsSync(join(root, 's-ext-session.json')), false);
});

test('ext launch without --session generates web-xxxx', async () => {
  const { dist, exec, stdout } = setup();
  await exec(['ext', 'launch', dist]);
  assert.match(JSON.parse(stdout.buf).session, /^web-[0-9a-f]{4}$/);
});

test('ext open sidepanel prints url and targetId from the gesture path', async () => {
  const side = { url: 'chrome-extension://id/panel.html', targetId: 't1' };
  const { exec, stdout } = await launched({
    run: (code) => (code.includes('Runtime.enable') ? side : 'X'),
  });
  const { code, calls } = await exec(['ext', 'open', 'sidepanel', '--session', 's']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.buf), { surface: 'sidepanel', ...side });
  assert.equal(calls.filter((c) => c[0] === 'run').length, 2);
});

test('ext open sidepanel falls back to a tab with a note', async () => {
  const { exec, stdout } = await launched({
    run: (code) =>
      code.includes('Runtime.enable')
        ? { fallback: 'no-content-script' }
        : code.includes('manifest.json')
          ? 'X'
          : 'chrome-extension://abcdef/panel.html',
  });
  const { calls } = await exec(['ext', 'open', 'sidepanel', '--session', 's']);
  const doc = JSON.parse(stdout.buf);
  assert.equal(doc.url, 'chrome-extension://abcdef/panel.html');
  assert.match(doc.note, /^no content-script context/);
  assert.equal(calls.filter((c) => c[0] === 'run').length, 3);
});

test('ext status with a corrupt session file exits FAILURE', async () => {
  const { exec, stdout, root } = setup();
  writeFileSync(join(root, 's-ext-session.json'), '{oops');
  const { code } = await exec(['ext', 'status', '--session', 's']);
  assert.equal(code, 1);
  assert.match(JSON.parse(stdout.buf).error.message, /corrupt ext session file/);
});

test('extensionIdForPath maps sha256 of the path to the a-p alphabet', () => {
  assert.equal(
    extensionIdForPath('/private/tmp/ext-spike/ext'),
    'haofcfdfpdgjbjabnplaomcjcoggcnld',
  );
});

test('ext launch works for a popup-only manifest with no service worker', async () => {
  const manifest = {
    manifest_version: 3,
    name: 'P',
    version: '1',
    action: { default_popup: 'p.html' },
  };
  const { dist, exec, stdout } = setup({ manifest, run: () => 'P' });
  assert.equal((await exec(['ext', 'launch', dist, '--session', 's'])).code, 0);
  assert.deepEqual(JSON.parse(stdout.buf).surfaces, ['popup']);
});

test('ext launch works for a worker-backed manifest', async () => {
  const manifest = {
    manifest_version: 3,
    name: 'W',
    version: '1',
    background: { service_worker: 'b.js' },
  };
  const { dist, exec } = setup({ manifest, run: () => 'W' });
  assert.equal((await exec(['ext', 'launch', dist, '--session', 's'])).code, 0);
});

test('ext launch with a name mismatch exits FAILURE and closes the session', async () => {
  const { dist, exec, stdout } = setup({ run: () => 'Other' });
  const { code, calls } = await exec(['ext', 'launch', dist, '--session', 's']);
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout.buf).error.message, 'extension did not load');
  assert.deepEqual(calls.at(-1), ['close', 's']);
});

test('ext launch when navigation throws exits FAILURE and closes the session', async () => {
  const run = () => {
    throw new Error('ERR_BLOCKED_BY_CLIENT');
  };
  const { dist, exec } = setup({ run });
  const { code, calls } = await exec(['ext', 'launch', dist, '--session', 's']);
  assert.equal(code, 1);
  assert.deepEqual(calls.at(-1), ['close', 's']);
});

test('ext launch applies the recipe init scripts but keeps its own browser config', async () => {
  const { dist, exec, root } = setup();
  const recipe = join(root, 'recipe.json');
  const probe = [{ config: { browserName: 'firefox' }, persistent: false }];
  writeFileSync(recipe, JSON.stringify({ probe, overlays: [{ rules: ['#a{}'] }] }));
  const { calls } = await exec(['ext', 'launch', dist, '--session', 's', '--recipe', recipe]);
  const opened = calls.find((c) => c[0] === 'open')[1];
  assert.equal(opened.config.browserName, 'chromium');
  assert.equal(opened.persistent, true);
  assert.equal(opened.initSources.length, 1);
});
