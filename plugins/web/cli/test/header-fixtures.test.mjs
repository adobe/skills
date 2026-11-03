// `web header check` on real renders of the fixture pages (ported from migration-lab's
// web-header.test.sh, phase 0 of adobe/skills#533): the verdicts on known-good and known-bad pages,
// CHECK_FAILED (exit 1) for a page that does not load, USAGE (exit 2) before any browser starts,
// the source cache at 2x, and no browser session left open. Skipped without playwright-cli or the
// image libraries (sharp, pngjs, pixelmatch: optional dependencies). About 1 min.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureDir } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const menusDir = new URL('./fixtures/header-menus/', import.meta.url);
const textDir = new URL('./fixtures/header-text/', import.meta.url);
const probe = spawnSync('playwright-cli', ['--version']);
const hasBrowser = !probe.error && probe.status === 0;
const hasImaging = await Promise.all(['sharp', 'pngjs', 'pixelmatch'].map((m) => import(m))).then(
  () => true,
  () => false,
);
const skip = !hasBrowser
  ? 'playwright-cli not installed'
  : !hasImaging && 'sharp, pngjs or pixelmatch not installed (npm install)';
let cwd;
let menus;
let text;
let refused;

// Async spawn: spawnSync would block the event loop that serves the in-process fixtures.
function web(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      let doc = null;
      try {
        doc = JSON.parse(stdout);
      } catch {
        // not a JSON document: --format text, or a crash (the assertions print stdout)
      }
      resolve({ status: err ? err.code : 0, doc, stdout });
    });
  });
}

/**
 * The sessions open on this file's fixtures. Only those: node --test runs the other test files at
 * the same time, with generated session names too.
 */
async function sessionsOnFixtures() {
  const res = await web('browser', 'list');
  const origins = [menus.url, text.url, refused];
  return (res.doc?.sessions ?? []).filter((s) => origins.some((o) => s.url?.startsWith(o)));
}

/** A local URL nothing listens on: a page that does not load. */
async function closedPort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return `http://127.0.0.1:${port}/`;
}

before(async () => {
  if (skip) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-header-'));
  menus = await startFixtureDir(menusDir);
  text = await startFixtureDir(textDir);
  refused = await closedPort();
});

after(async () => {
  if (skip) return;
  await menus?.close();
  await text?.close();
  rmSync(cwd, { recursive: true, force: true });
});

/** Exit 0 with a document whose `clean` is `want`. */
async function clean(want, ...args) {
  const res = await web('header', 'check', ...args);
  assert.equal(res.status, 0, res.stdout);
  assert.equal(res.doc?.clean, want, res.stdout);
  return res.doc;
}

/** An error document with `code`, and exit `status`. */
async function fails(status, code, ...args) {
  const res = await web('header', 'check', ...args);
  assert.equal(res.status, status, res.stdout);
  assert.equal(res.doc?.error?.code, code, res.stdout);
  return res.doc;
}

const textFile = (name) => `${text.url}${name}`;

test('menus: hover menus that open as captured are clean', { skip }, async () => {
  const doc = await clean(
    true,
    'menus',
    `${menus.url}menus.html`,
    fileURLToPath(new URL('open.json', menusDir)),
  );
  assert.deepEqual(
    doc.menus.map((m) => [m.label, m.ok]),
    [
      ['Produits', true],
      ['Ressources', true],
    ],
  );
});

test('menus: a click menu covered by another element is not clean', { skip }, async () => {
  const doc = await clean(
    false,
    'menus',
    `${menus.url}click-cover.html`,
    fileURLToPath(new URL('click-cover.json', menusDir)),
  );
  assert.equal(doc.menus[0].ok, false, doc.text);
});

test('text: the same header is clean', { skip }, async () => {
  const doc = await clean(
    true,
    'text',
    textFile('src.html'),
    textFile('same.html'),
    '--sizes',
    '1000',
  );
  assert.match(doc.text, /0 differ of 4 matched texts/);
});

test('text: an icon 20 px out of place is not clean', { skip }, async () => {
  const doc = await clean(
    false,
    'text',
    textFile('src.html'),
    textFile('icon-moved.html'),
    '--sizes',
    '1000',
  );
  assert.match(doc.text, /icon "Close"/);
  assert.deepEqual(doc.notCleanAt, ['1000x900']);
});

test('text: a label on one side only is not clean', { skip }, async () => {
  const doc = await clean(
    false,
    'text',
    textFile('src.html'),
    textFile('changed.html'),
    '--sizes',
    '1000',
  );
  assert.match(doc.text, /on one side only/);
});

test('text: three sizes in parallel give one row per size', { skip }, async () => {
  const doc = await clean(
    false,
    'text',
    textFile('src.html'),
    textFile('icon-moved.html'),
    '--sizes',
    '1000,900,800',
    '--parallel',
    '3',
  );
  assert.deepEqual(doc.sizes.map((s) => s.tag.split(' ')[0]).sort(), [
    '1000x900',
    '800x900',
    '900x900',
  ]);
});

test(
  'text --scale 2 with a source cache: pixels counted, the cache copied to a new folder',
  { skip },
  async () => {
    const cache = join(cwd, 'cache');
    const first = await clean(
      true,
      'text',
      textFile('src.html'),
      textFile('same.html'),
      '--sizes',
      '1000',
      '--scale',
      '2',
      '--source-cache',
      cache,
      '--shots',
      join(cwd, 'a', 'shot'),
    );
    assert.match(first.text, /0 differing pixels at 2x/);
    await clean(
      true,
      'text',
      textFile('src.html'),
      textFile('same.html'),
      '--sizes',
      '1000',
      '--scale',
      '2',
      '--source-cache',
      cache,
      '--shots',
      join(cwd, 'b', 'new', 'shot'),
    );
    assert.ok(
      existsSync(join(cwd, 'b', 'new', 'shot-1000x900-source.png')),
      'no copied source shot',
    );
  },
);

test('a page that does not load: CHECK_FAILED, exit 1 (not a difference)', { skip }, async () => {
  await fails(1, 'CHECK_FAILED', 'text', textFile('src.html'), refused, '--sizes', '1000');
  await fails(1, 'CHECK_FAILED', 'cls', refused, '1000');
});

test('a bad option: USAGE, exit 2', { skip }, async () => {
  await fails(2, 'USAGE', 'text', textFile('src.html'), textFile('same.html'), '--parallel', '0');
  await fails(2, 'USAGE', 'cls', textFile('src.html'), '1000,x');
});

test('no browser session left open', { skip }, async () => {
  assert.deepEqual(await sessionsOnFixtures(), []);
});
