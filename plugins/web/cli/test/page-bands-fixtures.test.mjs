// `web page bands` on a real render. Skipped when playwright-cli is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const html = readFileSync(new URL('./fixtures/page-bands/page.html', import.meta.url), 'utf8');
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `page-bands-fixtures-${process.pid}`;
let cwd;
let fixture;

// Async spawn: spawnSync would block the event loop that serves the in-process fixture.
function web(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, stdout });
    });
  });
}

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-page-bands-'));
  fixture = await startFixture(html);
});

after(async () => {
  if (!available) return;
  await web('browser', 'close', '--session', session);
  await fixture?.close();
  rmSync(cwd, { recursive: true, force: true });
});

async function bands(...args) {
  const res = await web(
    'page',
    'bands',
    fixture.url,
    '--session',
    session,
    '--settle-ms',
    '0',
    ...args,
  );
  assert.equal(res.status, 0, res.stdout);
  return JSON.parse(res.stdout);
}

test('level 1: main and footer; the fixed header floats apart', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const doc = await bands();
  assert.deepEqual(
    doc.bands.map((b) => [b.selectors[0], b.children]),
    [
      ['body > main', undefined],
      ['body > footer', undefined],
    ],
    doc.text,
  );
  assert.equal(doc.bands[1].bottom, doc.bands[0].bottom + 400, doc.text);
  assert.deepEqual(
    doc.fixed.map((f) => [f.selector, f.top, f.bottom]),
    [['body > header', 0, 64]],
  );
});

test('--depth all: hero, one text run, a side-by-side band, the cards side by side', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const doc = await bands('--depth', 'all');
  const kids = doc.bands[0].children;
  assert.deepEqual(
    kids.map((k) => [k.text, k.side]),
    [
      [false, false],
      [true, false],
      [false, true],
      [false, true],
    ],
    doc.text,
  );
  assert.equal(kids[1].selectors.length, 3, 'the heading and both paragraphs are one run');
  assert.deepEqual(
    kids[2].children.map((k) => [k.left, k.right]),
    [
      [40, 840],
      [880, 1240],
    ],
    doc.text,
  );
  assert.equal(kids[3].children.length, 3, doc.text);
});
