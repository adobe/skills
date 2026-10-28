import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harFileName } from '#src/cache/har.mjs';
import { recordPage } from '#src/cache/record.mjs';

const URL_ = 'https://www.example.com/page';
const HEALTHY = {
  title: 'Example',
  url: URL_,
  bodyLength: 5000,
  status: 200,
  hasMainContent: true,
};
const entry = (url, status) => ({
  request: { method: 'GET', url },
  response: { status, headers: [], content: { _file: 'body.bin' } },
});

function fixture({ health = HEALTHY, failOn, writeHar = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'record-'));
  const calls = [];
  const driver = {
    open(opts) {
      calls.push(['open', opts]);
      this.harPath = opts.config.contextOptions.recordHar.path;
    },
    pageHealth(session) {
      calls.push(['pageHealth', session]);
      return health;
    },
    run(session, { code, timeoutMs }) {
      calls.push(['run', code, timeoutMs]);
      if (failOn && code.includes(failOn)) throw new Error('boom');
      if (writeHar && code.includes('context().close()')) {
        const har = { log: { entries: [entry(URL_, 200), entry(`${URL_}/x`, -1)] } };
        writeFileSync(this.harPath, JSON.stringify(har));
        writeFileSync(path.join(path.dirname(this.harPath), 'body.bin'), 'x'.repeat(100));
      }
    },
    close(session) {
      calls.push(['close', session]);
    },
  };
  return { dir, calls, driver };
}

const names = (calls) => calls.map(([name]) => name);

test('opens with recordHar attach at the absolute har path and keeps recipe options', async () => {
  const { dir, calls, driver } = fixture();
  const recipe = path.join(dir, 'recipe.json');
  const probe = { config: { contextOptions: { locale: 'de-DE' } }, persistent: true };
  writeFileSync(recipe, JSON.stringify({ probe: [probe] }));
  const cwd = process.cwd();
  const relDir = path.relative(cwd, dir);
  recordPage(driver, { url: URL_, cacheDir: relDir, headed: true, recipe });
  const open = calls.find(([name]) => name === 'open')[1];
  assert.deepEqual(open.config.contextOptions.recordHar, {
    path: path.join(dir, harFileName(URL_)),
    content: 'attach',
  });
  assert.equal(open.config.contextOptions.locale, 'de-DE');
  assert.equal(open.url, URL_);
  assert.equal(open.headed, true);
  assert.equal(open.persistent, true);
});

test('loads, scrolls, flushes the HAR and never closes the session on success', () => {
  const { dir, calls, driver } = fixture();
  recordPage(driver, { url: URL_, cacheDir: dir });
  assert.deepEqual(names(calls), ['open', 'pageHealth', 'run', 'run']);
  const [scroll, flush] = calls.filter(([name]) => name === 'run').map(([, code]) => code);
  assert.match(scroll, /waitForLoadState\('networkidle', \{ timeout: 8000 \}\)/);
  assert.match(scroll, /i < 150/);
  assert.match(scroll, /wheel\(0, 300\)/);
  assert.match(scroll, /waitForTimeout\(600\)/);
  assert.match(flush, /page\.context\(\)\.close\(\)/);
  const [scrollRun] = calls.filter(([name]) => name === 'run');
  assert.equal(scrollRun[2], 180_000);
});

test('returns cleaned entry counts and the byte size of the HAR plus its body files', () => {
  const { dir, driver } = fixture();
  const result = recordPage(driver, { url: URL_, cacheDir: dir });
  assert.equal(result.url, URL_);
  assert.equal(result.har, path.join(dir, harFileName(URL_)));
  assert.equal(result.entries, 1);
  assert.equal(result.dropped, 1);
  assert.ok(result.bytes > 100);
});

test('closes the session and rethrows when scrolling fails', () => {
  const { dir, calls, driver } = fixture({ failOn: 'scrollHeight' });
  assert.throws(() => recordPage(driver, { url: URL_, cacheDir: dir }), /boom/);
  assert.equal(calls.filter(([name]) => name === 'close').length, 1);
});

test('closes the session and throws BLOCKED when the page is blocked', () => {
  const { dir, calls, driver } = fixture({ health: { ...HEALTHY, status: 403 } });
  assert.throws(
    () => recordPage(driver, { url: URL_, cacheDir: dir }),
    (err) => err.code === 'BLOCKED',
  );
  assert.equal(calls.filter(([name]) => name === 'close').length, 1);
  assert.ok(!calls.some(([name]) => name === 'run'));
});

test('throws INTERNAL when the context closed but no HAR was written', () => {
  const { dir, driver } = fixture({ writeHar: false });
  const har = path.join(dir, harFileName(URL_));
  assert.throws(
    () => recordPage(driver, { url: URL_, cacheDir: dir }),
    (err) => err.code === 'INTERNAL' && err.message === `HAR not written: ${har}`,
  );
  assert.ok(!existsSync(har));
});
