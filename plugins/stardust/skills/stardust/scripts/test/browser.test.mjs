#!/usr/bin/env node
// skills/stardust/scripts/test/browser.test.mjs — the browser front door (browser.mjs), no real browser: the exports
// (live-session's names arrive through `export *`); openBrowser per mode on a stub chromium (chrome, the Chrome-missing
// fallback, headed, plain with its options and tier passed through, the refusals); newContext / newPage / goto as thin
// pass-throughs; loadPlaywright from a project at the working directory and its one install error when Playwright is
// installed nowhere.
// Run: node plugins/stardust/skills/stardust/scripts/test/browser.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as browser from '../browser.mjs';
import * as session from '../live-session.mjs';

const { openBrowser, newContext, newPage, goto } = browser;
const { browserTier } = session;
const HERE = dirname(fileURLToPath(import.meta.url));
const roots = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'browser-test-')); roots.push(d); return d; };
process.once('exit', () => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

let checks = 0; let failed = 0;
const check = async (name, fn) => {
  checks += 1;
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
};
const stderrOf = async (fn) => {
  const lines = []; const saved = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = saved; }
  return lines;
};
const stubChromium = ({ chromeMissing = false } = {}) => {
  const calls = [];
  const chromium = { launch: async (o) => { calls.push(o); if (chromeMissing && o && o.channel) throw new Error('Chrome is not installed\nsecond line'); return {}; } };
  return { calls, playwright: { chromium } };
};

await check('exports: the front door functions, and live-session\'s names through export *', () => {
  for (const name of ['loadPlaywright', 'openBrowser', 'newContext', 'newPage', 'goto']) assert.equal(typeof browser[name], 'function', name);
  for (const name of ['gotoLive', 'newLiveContext', 'dismissOverlays', 'defaultWaitUntil', 'isLiveHttpUrl', 'browserTier', 'attachOriginAuth']) assert.equal(browser[name], session[name], name);
});

await check('openBrowser chrome: real Chrome headless, tier chrome', async () => {
  const { calls, playwright } = stubChromium();
  const b = await openBrowser({ mode: 'chrome', playwright });
  assert.deepEqual(calls, [{ headless: true, channel: 'chrome' }]);
  assert.equal(browserTier(b), 'chrome');
});

await check('openBrowser chrome, Chrome missing: bundled Chromium, tier chromium-fallback, one stderr line', async () => {
  const { calls, playwright } = stubChromium({ chromeMissing: true });
  let b; const lines = await stderrOf(async () => { b = await openBrowser({ playwright }); });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { headless: true });
  assert.equal(browserTier(b), 'chromium-fallback');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARNING: real Chrome/);
});

await check('openBrowser headed: window-free real Chrome with the automation-signal flags', async () => {
  const saved = { s: process.env.STARDUST_STEALTH, w: process.env.STARDUST_HEADED_WINDOW };
  delete process.env.STARDUST_STEALTH; delete process.env.STARDUST_HEADED_WINDOW;
  try {
    const { calls, playwright } = stubChromium();
    await openBrowser({ mode: 'headed', playwright });
    assert.deepEqual(calls[0], { headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
  } finally {
    for (const [k, v] of [['STARDUST_STEALTH', saved.s], ['STARDUST_HEADED_WINDOW', saved.w]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

await check('openBrowser plain: the options go through unchanged, the tier defaults to chromium', async () => {
  let s = stubChromium();
  let b = await openBrowser({ mode: 'plain', playwright: s.playwright });
  assert.deepEqual(s.calls, [{}]);
  assert.equal(browserTier(b), 'chromium');
  s = stubChromium();
  const launchOptions = { headless: true, args: ['--x'] };
  await openBrowser({ mode: 'plain', launchOptions, playwright: s.playwright });
  assert.deepEqual(s.calls[0], { headless: true, args: ['--x'] });
  s = stubChromium();
  b = await openBrowser({ mode: 'plain', tier: 'chrome-escalated', playwright: s.playwright });
  assert.equal(browserTier(b), 'chrome-escalated');
});

await check('openBrowser refuses an unknown mode, and launchOptions or tier outside plain', async () => {
  const { playwright } = stubChromium();
  await assert.rejects(openBrowser({ mode: 'nope', playwright }), /mode/);
  await assert.rejects(openBrowser({ mode: 'chrome', launchOptions: { args: [] }, playwright }), /plain/);
  await assert.rejects(openBrowser({ mode: 'headed', tier: 'x', playwright }), /plain/);
});

await check('newContext, newPage, goto: one call with the same arguments, the result returned', async () => {
  const seen = [];
  const target = { newContext: async (...a) => { seen.push(['newContext', a]); return 'ctx'; }, newPage: async (...a) => { seen.push(['newPage', a]); return 'pg'; }, goto: async (...a) => { seen.push(['goto', a]); return 'resp'; } };
  const opts = { viewport: { width: 1, height: 2 } };
  assert.equal(await newContext(target, opts), 'ctx');
  assert.equal(await newPage(target, opts), 'pg');
  assert.equal(await goto(target, 'https://a.test/', { timeout: 5 }), 'resp');
  assert.deepEqual(seen, [['newContext', [opts]], ['newPage', [opts]], ['goto', ['https://a.test/', { timeout: 5 }]]]);
});

const childLoad = (cwd, copyDir) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { loadPlaywright } from ${JSON.stringify(join(copyDir, 'browser.mjs'))};
  try { console.log((await loadPlaywright()).chromium.fake); } catch (e) { console.log(JSON.stringify({ code: e.code, message: e.message, cause: e.cause && e.cause.message })); process.exit(1); }
`], { cwd, encoding: 'utf8' });
const copyFront = () => {
  const dir = tempDir();
  for (const f of ['browser.mjs', 'live-session.mjs']) copyFileSync(join(HERE, '..', f), join(dir, f));
  return dir;
};

await check('loadPlaywright, project at cwd: found through the working directory\'s package.json', () => {
  const copy = copyFront(); const project = tempDir();
  writeFileSync(join(project, 'package.json'), '{"name":"p","type":"module"}');
  const pkg = join(project, 'node_modules', 'playwright'); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"name":"playwright","type":"module","main":"index.js"}');
  writeFileSync(join(pkg, 'index.js'), 'export const chromium = { fake: 1 };\n');
  const r = childLoad(project, copy);
  assert.equal(r.stdout.trim(), '1', r.stderr);
});

await check('loadPlaywright, both resolve: the project at the working directory wins over the bare import', () => {
  const copy = copyFront(); const project = tempDir();
  const fake = (root, from) => {
    writeFileSync(join(root, 'package.json'), '{"name":"p","type":"module"}');
    const pkg = join(root, 'node_modules', 'playwright'); mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{"name":"playwright","type":"module","main":"index.js"}');
    writeFileSync(join(pkg, 'index.js'), `export const chromium = { fake: '${from}' };\n`);
  };
  fake(copy, 'bare'); fake(project, 'cwd');
  const r = childLoad(project, copy);
  assert.equal(r.stdout.trim(), 'cwd', r.stderr);
});

await check('loadPlaywright, nowhere: PLAYWRIGHT_MISSING with the one install line', () => {
  const copy = copyFront(); const empty = tempDir();
  const r = childLoad(empty, copy);
  assert.equal(r.status, 1);
  const { code, message } = JSON.parse(r.stdout);
  assert.equal(code, 'PLAYWRIGHT_MISSING');
  assert.ok(message.includes('npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps'), message);
  assert.ok(message.includes(copy) && message.includes(empty), message);
});

await check('loadPlaywright, installed but failing to load: PLAYWRIGHT_BROKEN names the cause, not the install line', () => {
  const copy = copyFront(); const project = tempDir();
  writeFileSync(join(project, 'package.json'), '{"name":"p","type":"module"}');
  const pkg = join(project, 'node_modules', 'playwright'); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"name":"playwright","type":"module","main":"index.js"}');
  writeFileSync(join(pkg, 'index.js'), 'throw new Error("boom at init");\n');
  const r = childLoad(project, copy);
  assert.equal(r.status, 1);
  const { code, message, cause } = JSON.parse(r.stdout);
  assert.equal(code, 'PLAYWRIGHT_BROKEN');
  assert.ok(message.includes('boom at init'), message);
  assert.ok(!message.includes('npm i -D'), message);
  assert.equal(cause, 'boom at init');
});

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nbrowser: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
