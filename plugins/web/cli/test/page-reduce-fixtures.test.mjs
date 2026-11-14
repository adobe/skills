// `web page reduce` on a real render. The bundle tokenizes a detached clone of each section, so
// sizes and styles must come from the live page. Unit tests on attached DOM cannot catch that.
// Skipped when playwright-cli is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const casesHtml = readFileSync(
  new URL('./fixtures/page-reduce/cases.html', import.meta.url),
  'utf8',
);
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `page-reduce-fixtures-${process.pid}`;
let cwd;
let html;

// Async spawn: spawnSync blocks the event loop that serves the in-process fixture.
function web(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, stdout });
    });
  });
}

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-page-reduce-'));
  const fixture = await startFixture(casesHtml);
  try {
    const res = await web('page', 'reduce', fixture.url, '--session', session, '--settle-ms', '0');
    assert.equal(res.status, 0, res.stdout);
    html = JSON.parse(res.stdout)
      .sections.map((s) => s.tokenizedHtml)
      .join('\n');
  } finally {
    await fixture.close();
  }
});

after(async () => {
  if (!available) return;
  await web('browser', 'close', '--session', session);
  rmSync(cwd, { recursive: true, force: true });
});

function fixtureTest(name, fn) {
  test(name, (t) => {
    if (!available) return t.skip('playwright-cli not installed');
    fn();
  });
}

fixtureTest('an image gets its rendered size', () => {
  assert.match(html, /\{IMAGE:600x300\}/);
  assert.doesNotMatch(html, /\{IMAGE:0x0\}/);
});

fixtureTest('a plain link is a LINK, a button-styled link a CTA', () => {
  assert.match(html, /\{LINK:Home\}/);
  assert.match(html, /\{CTA:Get started\}/);
});

fixtureTest('hidden and off-page content is not tokenized', () => {
  assert.doesNotMatch(html, /Hidden menu item|Drawer item|Drawer above/);
});

fixtureTest('a display: contents wrapper keeps its content', () => {
  assert.match(html, /\{HEADING:1\}/);
});

fixtureTest('a link around a large SVG keeps it as a sized image', () => {
  assert.match(html, /<a[^>]*>\s*\{IMAGE:200x80\}\s*<\/a>/);
});

fixtureTest('a card link keeps its heading and image', () => {
  assert.equal(html.match(/\{HEADING:3\}/g)?.length, 4, html);
  assert.match(html, /<a[^>]*class="card"[^>]*>\s*\{IMAGE:\d+x120\}/);
});
