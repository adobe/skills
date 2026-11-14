// `web page tree` on real renders: each fixture distils a layout met on a real site. Assertions
// are on geometry and structure, not golden trees. Skipped when playwright-cli is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const fixtures = new URL('./fixtures/page-tree/', import.meta.url);
const baseCss = readFileSync(new URL('_base.css', fixtures), 'utf8');
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `page-tree-fixtures-${process.pid}`;
let cwd;

before(() => {
  if (available) cwd = mkdtempSync(join(tmpdir(), 'web-page-tree-'));
});

after(async () => {
  if (!available) return;
  await web('browser', 'close', '--session', session);
  rmSync(cwd, { recursive: true, force: true });
});

// Async spawn: spawnSync would block the event loop that serves the in-process fixture.
function web(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, stdout });
    });
  });
}

/** Capture the tree of a fixture page, its shared stylesheet inlined. */
async function capture(name) {
  const html = readFileSync(new URL(`${name}.html`, fixtures), 'utf8').replace(
    /<link rel="stylesheet" href="_base.css"\s*\/?>/,
    `<style>${baseCss}</style>`,
  );
  const fixture = await startFixture(html);
  try {
    const res = await web('page', 'tree', fixture.url, '--session', session, '--settle-ms', '0');
    assert.equal(res.status, 0, res.stdout);
    return JSON.parse(res.stdout);
  } finally {
    await fixture.close();
  }
}

const all = (node) => [node, ...node.children.flatMap(all)];
const find = (tree, pred) => all(tree).find(pred);
const idOf = (nodeMap, node) =>
  Object.keys(nodeMap).find((id) => nodeMap[id].selector === node.selector);
const roots = (tree) => tree.children.map((n) => n.selector).join(', ');

function fixtureTest(name, fn) {
  test(name, async (t) => {
    if (!available) return t.skip('playwright-cli not installed');
    await fn();
  });
}

fixtureTest('display: contents wrapper: its sections are nodes', async () => {
  const { tree } = await capture('display-contents');
  const sections = all(tree).filter((n) => n.bounds.height === 300);
  assert.equal(sections.length, 3, roots(tree));
});

fixtureTest('a mega menu clipped to nothing is not a node', async () => {
  const { tree, text } = await capture('clip-path-menu');
  assert.equal(
    find(tree, (n) => n.bounds.height === 370),
    undefined,
    text,
  );
  assert.doesNotMatch(text, /Menu panel/);
  assert.ok(
    find(tree, (n) => n.className === 'pill'),
    'a rounded inset clips nothing',
  );
});

fixtureTest('transparent header over a hero: the nav is a node with its own box', async () => {
  const { tree } = await capture('transparent-header-over-hero');
  const nav = find(tree, (n) => n.id === 'topNav');
  assert.ok(nav, roots(tree));
  assert.deepEqual([nav.bounds.y, nav.bounds.height, nav.bounds.width], [53, 80, 1280]);
  assert.match(nav.collapsed[0].selector, /sticky-wrap/, 'the chain starts at the wrapper');
  assert.equal(nav.collapsed.at(-1).id, 'topNav');
  assert.ok(
    find(tree, (n) => n.bounds.height === 700),
    'the hero is there too',
  );
});

fixtureTest('a 0 px header at the page origin keeps its nav and progress bar', async () => {
  const { tree } = await capture('header-at-origin');
  const nav = find(tree, (n) => n.id === 'topNav');
  assert.deepEqual([nav?.bounds.y, nav?.bounds.height], [0, 80], roots(tree));
  assert.ok(find(tree, (n) => n.className === 'pb' && n.bounds.height === 5));
});

fixtureTest('sticky nav whose wrapper has area: the wrapper keeps its identity', async () => {
  const { tree } = await capture('sticky-nav');
  const band = find(tree, (n) => n.bounds.y === 53 && n.bounds.height === 80);
  assert.ok(band, roots(tree));
  assert.equal(band.className, 'sticky-wrap');
  assert.equal(band.collapsed.at(-1).id, 'topNav');
});

fixtureTest('every class is recorded, on HTML and SVG elements', async () => {
  const { tree } = await capture('svg-class');
  const classes = tree.children.map((n) => n.className);
  assert.deepEqual(classes, ['hero main-hero', 'wave big']);
});

fixtureTest('an open dropdown overflowing its trigger is promoted and occludes', async () => {
  const { tree, nodeMap } = await capture('dropdown-escapes-trigger');
  const trigger = find(tree, (n) => n.className === 'trigger');
  assert.equal(trigger?.bounds.height, 80, 'the trigger keeps its own node');
  const menu = tree.children.find((n) => n.className === 'menu');
  assert.ok(menu, `the menu is a root child: ${roots(tree)}`);
  assert.ok(nodeMap[idOf(nodeMap, menu)].overlay?.occluding?.length >= 1);
});

fixtureTest('fixed elements: the wide banner and the narrow button are root nodes', async () => {
  const { tree, nodeMap } = await capture('fixed-cookie-banner');
  for (const id of ['cmp', 'chat', 'cmp-close']) {
    const el = tree.children.find((n) => n.id === id);
    assert.ok(el, `#${id} is a root child: ${roots(tree)}`);
    assert.equal(el.fixed, true);
  }
  const cmp = tree.children.find((n) => n.id === 'cmp');
  assert.ok(nodeMap[idOf(nodeMap, cmp)].overlay?.occluding?.length >= 1);
});

fixtureTest('a row overhanging its container by a gutter stays in it', async () => {
  const { tree } = await capture('gutter-row');
  const container = find(tree, (n) => n.className === 'container');
  assert.ok(container, roots(tree));
  assert.ok(
    container.children.some((n) => n.className === 'row'),
    `row under the container: ${roots(tree)}`,
  );
});

fixtureTest('clipped overflow: a marquee stays put, a closed accordion is hidden', async () => {
  const { tree, nodeMap, text } = await capture('clipped-overflow');
  const strip = find(tree, (n) => n.className === 'strip');
  assert.ok(strip, roots(tree));
  assert.ok(
    all(strip).some((n) => n.className === 'track'),
    'the track is under the strip',
  );
  assert.deepEqual(
    Object.values(nodeMap).filter((n) => n.overlay),
    [],
  );
  assert.doesNotMatch(text, /Hidden answer/);
});

fixtureTest('an absolute menu escapes a static clipper, not a positioned one', async () => {
  const { tree, nodeMap } = await capture('absolute-escapes-clip');
  const menu = tree.children.find((n) => n.className === 'menu');
  assert.ok(menu, `the free menu is a root child: ${roots(tree)}`);
  assert.equal(menu.bounds.y, 133);
  assert.ok(nodeMap[idOf(nodeMap, menu)].overlay?.occluding?.length >= 1);
  const menus = all(tree).filter((n) => n.className === 'menu');
  assert.equal(menus.length, 1, 'the menu clipped by its positioned trigger is not a node');
});

fixtureTest('skip links above the page are dropped; a box partly on it stays', async () => {
  const { tree } = await capture('skip-links');
  assert.equal(
    find(tree, (n) => n.bounds.y === -320),
    undefined,
    roots(tree),
  );
  assert.ok(find(tree, (n) => n.className === 'peek'));
});

fixtureTest('a 5 px progress bar is its own node next to the nav', async () => {
  const { tree } = await capture('progress-bar-hairline');
  const wrap = find(tree, (n) => n.className === 'wrap' && n.bounds.height === 85);
  assert.ok(wrap, roots(tree));
  assert.deepEqual(
    wrap.children.map((c) => c.bounds.height),
    [80, 5],
  );
});

fixtureTest('children narrower than the minimum fold into their parent', async () => {
  const { tree } = await capture('narrow-children-folded');
  const cards = find(tree, (n) => n.className === 'cards');
  assert.ok(cards, roots(tree));
  assert.deepEqual(cards.children, []);
  assert.ok(cards.layout, 'a row layout is detected');
  assert.match(cards.text ?? '', /One/);
});
