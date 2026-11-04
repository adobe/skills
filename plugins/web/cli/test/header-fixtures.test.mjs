// `web header capture` and `web header check` on real renders of the fixture pages (the checks'
// cases ported from migration-lab's web-header.test.sh, phase 0 of adobe/skills#533): a capture
// that finds a promo bar above the header and the menus, the checks clean on the captured page
// itself, the verdicts on known-good and known-bad pages, CHECK_FAILED (exit 1) for a page that
// does not load, USAGE (exit 2) before any browser starts, the source cache at 2x, and no browser
// session left open. Skipped without playwright-cli or the image libraries (sharp, pngjs,
// pixelmatch: optional dependencies). About 1.5 min.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture, startFixtureDir } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const menusDir = new URL('./fixtures/header-menus/', import.meta.url);
const textDir = new URL('./fixtures/header-text/', import.meta.url);
const captureHtml = readFileSync(
  new URL('./fixtures/header-capture/page.html', import.meta.url),
  'utf8',
);
const customHtml = readFileSync(
  new URL('./fixtures/header-capture/custom.html', import.meta.url),
  'utf8',
);
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
let site;
let custom;
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
  const origins = [menus.url, text.url, site.url, custom.url, refused];
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
  site = await startFixture(captureHtml);
  custom = await startFixture(customHtml);
  refused = await closedPort();
});

after(async () => {
  if (skip) return;
  await menus?.close();
  await text?.close();
  await site?.close();
  await custom?.close();
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

test(
  'capture: the promo bar above the header (not its empty spacer), the menus, the breakpoint; the checks clean on the page itself',
  { skip },
  async () => {
    const dir = join(cwd, 'capture');
    const res = await web('header', 'capture', site.url, dir);
    assert.equal(res.status, 0, res.stdout);
    const { page, open } = res.doc;
    assert.deepEqual(
      page.regions.map((r) => [r.id, r.selector, r.rect.y]),
      [
        ['header', 'body > div:nth-of-type(2)', 0],
        ['header-2', 'body > header', 48],
      ],
    );
    assert.deepEqual(
      open.states.map((s) => [s.label, s.trigger, s.newLinks]),
      [
        ['Products', 'hover', 2],
        ['Resources', 'hover', 3],
      ],
    );
    assert.deepEqual(
      open.states[0].panel.items.map((i) => i.href),
      [`${site.url}products/a`, `${site.url}products/b`],
    );
    // the second menu opened by its visible label, not by the first panel's hidden title
    assert.deepEqual(res.doc.incomplete, []);
    // the breakpoint to the pixel (1000), not the probed 1024
    assert.deepEqual(open.header.breakpoint, { shownAt: 1000, hiddenAt: 999 });
    assert.equal(open.mobileMenu.revealed, true);
    for (const f of [
      'page.json',
      'overlays.json',
      'desktop.png',
      'regions/header-2.styles.txt',
      'open/0.png',
      'open/mobile-menu.png',
    ])
      assert.ok(existsSync(join(dir, f)), `no ${f}`);
    await clean(true, 'menus', site.url, join(dir, 'open', 'open.json'));
    await clean(true, 'panels', site.url, dir, join(cwd, 'panels'));
  },
);

test('capture --header: a header that is a div has its menus found', { skip }, async () => {
  const dir = join(cwd, 'capture-custom');
  const res = await web('header', 'capture', custom.url, dir, '--header', '#custom');
  assert.equal(res.status, 0, res.stdout);
  assert.deepEqual(
    res.doc.page.regions.map((r) => r.selector),
    ['#custom'],
  );
  assert.deepEqual(
    res.doc.open.states.map((s) => [s.label, s.trigger, s.newLinks]),
    [['Shop', 'click', 2]],
  );
  assert.deepEqual(res.doc.incomplete, []);
});

test(
  'menus and panels: a menu the capture could not open is not checked, and not clean',
  { skip },
  async () => {
    const dir = join(cwd, 'capture-incomplete');
    mkdirSync(join(dir, 'open'), { recursive: true });
    const open = {
      closedLinks: 0,
      states: [{ label: 'Produits', error: 'not clickable' }],
    };
    writeFileSync(join(dir, 'open', 'open.json'), JSON.stringify(open));
    writeFileSync(join(dir, 'page.json'), JSON.stringify({ url: `${menus.url}menus.html` }));
    writeFileSync(join(dir, 'overlays.json'), JSON.stringify({ hideCss: '' }));
    const m = await clean(false, 'menus', `${menus.url}menus.html`, join(dir, 'open', 'open.json'));
    assert.deepEqual(m.notChecked, ['Produits: not clickable']);
    assert.match(m.text, /NOT CHECKED Produits: not clickable/);
    const p = await clean(
      false,
      'panels',
      `${menus.url}menus.html`,
      dir,
      join(cwd, 'panels-incomplete'),
    );
    assert.deepEqual(p.notChecked, ['Produits: not clickable']);
  },
);

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

test(
  'text --scroll at 2x on a page with a body of its own: the pixels in its header told apart',
  { skip },
  async () => {
    const doc = await clean(
      false,
      'text',
      textFile('src.html'),
      textFile('body.html'),
      '--sizes',
      '1000',
      '--scroll',
      '300',
      '--scale',
      '2',
      '--shots',
      join(cwd, 'scroll', 'shot'),
    );
    // as loaded: the same header, another body; scrolled 300 px: an empty body on both sides (no
    // pixel, no split)
    const [loaded, scrolled] = doc.sizes;
    assert.ok(loaded.px > 0, doc.text);
    assert.equal(loaded.pxHeader, 0, doc.text);
    assert.equal(scrolled.px, 0, doc.text);
    assert.equal(scrolled.pxHeader, null, doc.text);
    assert.match(
      doc.text,
      /1000x900 y0 .*; \d+ differing pixels at 2x \(0 in the header, \d+ below it\)/,
    );
  },
);

test(
  "text --scroll at 2x: a band the page lacks at the bottom of a sticky header is the header's",
  { skip },
  async () => {
    const doc = await clean(
      false,
      'text',
      textFile('sticky.html'),
      textFile('sticky-flat.html'),
      '--sizes',
      '1000',
      '--scroll',
      '300',
      '--scale',
      '2',
      '--shots',
      join(cwd, 'band', 'shot'),
    );
    // the same 80 px bar on both sides; the source's ends 8 px lower (a red band the page lacks):
    // the header's rows go down to the source's bottom, at load and scrolled
    for (const step of doc.sizes) assert.ok(step.pxHeader > 0, doc.text);
  },
);

test(
  'text --mobile-menu on a page without one: CHECK_FAILED, not a clean closed header',
  { skip },
  async () => {
    // its only header button (Close) reveals nothing: no mobile menu was compared
    const doc = await fails(
      1,
      'CHECK_FAILED',
      'text',
      textFile('src.html'),
      textFile('src.html'),
      '--sizes',
      '390x844',
      '--mobile-menu',
    );
    assert.match(doc.error.message, /the mobile menu did not open/);
  },
);

test('text --open on a label that opens nothing: CHECK_FAILED', { skip }, async () => {
  const doc = await fails(
    1,
    'CHECK_FAILED',
    'text',
    textFile('src.html'),
    textFile('src.html'),
    '--sizes',
    '1000',
    '--open',
    'About',
  );
  assert.match(doc.error.message, /"About" did not open/);
});

test(
  'text --baseline: a header icon the page kept wrong from the baseline is still a difference',
  { skip },
  async () => {
    const doc = await clean(
      false,
      'text',
      textFile('src.html'),
      textFile('icon-moved.html'),
      '--sizes',
      '1000',
      '--baseline',
      textFile('icon-moved.html'),
      '--scale',
      '2',
      '--shots',
      join(cwd, 'icon-kept', 'shot'),
    );
    assert.match(doc.text, /"icon "Close"": x 907 -> 927/);
    assert.ok(doc.sizes[0].px > 0, doc.text);
  },
);

test(
  'text --baseline: a label the page kept from its old header is still a difference',
  { skip },
  async () => {
    const doc = await clean(
      false,
      'text',
      textFile('src.html'),
      textFile('leftover.html'),
      '--sizes',
      '1000',
      '--baseline',
      textFile('leftover.html'),
    );
    assert.match(doc.text, /only on the page: "Old"/);
  },
);

test(
  'text --open --baseline without the menu: a panel link missing on the page is still a difference',
  { skip },
  async () => {
    const doc = await clean(
      false,
      'text',
      `${menus.url}menus.html`,
      `${menus.url}menus-missing.html`,
      '--sizes',
      '1000',
      '--open',
      'Produits',
      '--baseline',
      textFile('src.html'),
    );
    assert.match(doc.text, /only on the source: "P2"/);
  },
);

test(
  'text --open with a baseline that has no such menu: the baseline is used as loaded',
  { skip },
  async () => {
    // the page before the work (its old header) has no "Produits" menu to open: not a failure
    await clean(
      true,
      'text',
      `${menus.url}menus.html`,
      `${menus.url}menus.html`,
      '--sizes',
      '1000',
      '--open',
      'Produits',
      '--trigger',
      'hover',
      '--baseline',
      textFile('src.html'),
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
