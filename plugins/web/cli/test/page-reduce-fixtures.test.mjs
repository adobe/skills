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
const page = (name) =>
  readFileSync(new URL(`./fixtures/page-reduce/${name}.html`, import.meta.url), 'utf8');
const CONTENT = /\{(?:TEXT|HEADING:|IMAGE:|LINK:|CTA:|INPUT:|SELECT:|VIDEO)/;
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `page-reduce-fixtures-${process.pid}`;
let cwd;
let sections;
let html;
let oneBlock;
let hiddenMain;
let hiddenOnly;

// Async spawn: spawnSync blocks the event loop that serves the in-process fixture.
function web(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, stdout });
    });
  });
}

async function reduceFixture(name, ...extra) {
  const fixture = await startFixture(page(name));
  try {
    const args = ['page', 'reduce', fixture.url, '--session', session, '--settle-ms', '0'];
    const res = await web(...args, ...extra);
    return { status: res.status, doc: JSON.parse(res.stdout) };
  } finally {
    await fixture.close();
  }
}

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-page-reduce-'));
  const cases = await reduceFixture('cases');
  assert.equal(cases.status, 0, JSON.stringify(cases.doc));
  ({ sections } = cases.doc);
  html = sections.map((s) => s.tokenizedHtml).join('\n');
  oneBlock = await reduceFixture('one-block');
  hiddenMain = await reduceFixture('hidden-main');
  hiddenOnly = await reduceFixture('hidden-only', '--retries', '0');
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

fixtureTest('no section is left without content (dots, backdrop, empty dialog)', () => {
  const empty = sections.filter((s) => !CONTENT.test(s.tokenizedHtml));
  assert.deepEqual(
    empty.map((s) => s.xpath),
    [],
  );
  assert.deepEqual(
    sections.map((s) => s.index),
    sections.map((_, i) => i),
  );
});

fixtureTest('a page with one block gives one fallback section', () => {
  assert.equal(oneBlock.status, 0, JSON.stringify(oneBlock.doc));
  assert.equal(oneBlock.doc.sections.length, 1);
  assert.equal(oneBlock.doc.sections[0].fallback, true);
  assert.match(oneBlock.doc.sections[0].tokenizedHtml, /\{HEADING:1\}/);
});

fixtureTest('a standalone image survives next to other sections', () => {
  assert.match(html, /\{IMAGE:800x200\}/);
  assert.match(html, /\{HEADING:2\}/);
});

fixtureTest('a hidden main falls through to the visible body, without event handlers', () => {
  assert.equal(hiddenMain.status, 0, JSON.stringify(hiddenMain.doc));
  const [section, ...rest] = hiddenMain.doc.sections;
  assert.equal(rest.length, 0);
  assert.equal(section.fallback, true);
  assert.match(section.xpath, /body/);
  assert.match(section.tokenizedHtml, /\{HEADING:2\}/);
  assert.doesNotMatch(section.tokenizedHtml, /\{HEADING:1\}|<main/);
  assert.match(section.tokenizedHtml, /class="page"/);
  assert.doesNotMatch(section.tokenizedHtml, /onload/);
});

fixtureTest('a page whose only content is hidden gives EMPTY_RESULT', () => {
  assert.equal(hiddenOnly.status, 1);
  assert.equal(hiddenOnly.doc.error.code, 'EMPTY_RESULT');
});
