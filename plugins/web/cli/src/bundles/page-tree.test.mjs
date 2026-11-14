// The bundle is browser code; its pure functions are tested by loading it into a vm with a
// bare `window`. Real renders are covered by test/page-tree-fixtures.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./page-tree.js', import.meta.url), 'utf8');
const document = { body: { tagName: 'BODY' }, documentElement: { tagName: 'HTML' } };
const window = { scrollX: 0, scrollY: 0 };
vm.runInNewContext(source, { window, document });
const { collapseSingleChildren, processTree } = window.__visualTree;

const node = (tag, selector, bounds, children = [], extra = {}) => ({
  tag,
  selector,
  bounds,
  children,
  ...extra,
});
const box = (x, y, width, height) => ({ x, y, width, height });
// Values born in the vm realm compare by value once copied into this one.
const plain = (n) => JSON.parse(JSON.stringify(n));
const page = (children, height = 4000) => node('BODY', 'body', box(0, 0, 1280, height), children);
const utility = () => node('DIV', '#utility', box(0, 0, 1280, 53), [], { id: 'utility' });
const content = (y, h) =>
  node('DIV', 'div.content', box(0, y, 1280, h), [], { className: 'content' });
const footer = (height) =>
  node('DIV', 'div.footer', box(0, height - 600, 1280, 600), [], { className: 'footer' });

test('processTree: a hairline stays a node (consumers decide what is structure)', () => {
  const bar = node('DIV', 'div.pb', box(0, 128, 1280, 5), [], { className: 'pb' });
  const nav = node('DIV', 'div.nav', box(0, 53, 1280, 80), [], { className: 'nav' });
  const wrapper = node('DIV', 'div.wrap', box(0, 53, 1280, 80), [nav, bar], { className: 'wrap' });
  const { root } = processTree(page([utility(), wrapper, content(133, 3000), footer(4000)]));
  assert.deepEqual(
    plain(root.children[1].children).map((c) => c.bounds.height),
    [80, 5],
  );
});

test('processTree: zero-area leaves go; a zero-area shell with two children hands them up', () => {
  const empty = node('DIV', 'div.empty', box(0, 133, 1280, 0), [], { className: 'empty' });
  const shell = node(
    'DIV',
    'div.shell',
    box(0, 133, 0, 0),
    [
      node('DIV', 'div.x', box(0, 133, 1280, 100), [], { className: 'x' }),
      node('DIV', 'div.y', box(0, 233, 1280, 100), [], { className: 'y' }),
    ],
    { className: 'shell' },
  );
  const { root, promotedToRoot } = processTree(page([utility(), empty, shell, footer(4000)]));
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['#utility', 'div.footer', 'div.x', 'div.y'],
  );
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['div.x', 'div.y'],
  );
});

test('processTree: an escaped child lands on the nearest ancestor that contains it', () => {
  const inner = node('DIV', 'div.inner', box(0, 400, 1280, 100), [], { className: 'inner' });
  const s1 = node('DIV', 'div.s1', box(0, 133, 1280, 50), [], { className: 's1' });
  const small = node('DIV', 'div.small', box(0, 133, 1280, 50), [s1, inner], {
    className: 'small',
  });
  const s2 = node('DIV', 'div.s2', box(0, 600, 1280, 100), [], { className: 's2' });
  const section = node('DIV', 'div.section', box(0, 133, 1280, 1000), [small, s2], {
    className: 'section',
  });
  const { root, promotedToRoot } = processTree(page([utility(), section, footer(4000)]));
  assert.equal(promotedToRoot.size, 0, 'not promoted to the root');
  assert.deepEqual(
    plain(root.children[1].children).map((c) => c.selector),
    ['div.small', 'div.s2', 'div.inner'],
  );
});

test('layoutChildren walks through display: contents elements to the boxes they hold', () => {
  const { layoutChildren } = window.__visualTree;
  const el = (name, display, children = []) => ({ name, display, children });
  const styles = (e) => ({ display: e.display });
  const main = el('main', 'contents', [el('article', 'block'), el('aside', 'block')]);
  const wrapper = el('div', 'block', [el('nav', 'block'), main, el('footer', 'block')]);
  assert.deepEqual(
    plain(layoutChildren(wrapper, styles).map((e) => e.name)),
    ['nav', 'article', 'aside', 'footer'],
  );
  const nested = el('div', 'block', [el('a', 'contents', [el('b', 'contents', [el('c', 'block')])])]);
  assert.deepEqual(plain(layoutChildren(nested, styles).map((e) => e.name)), ['c']);
});

test('clippedAway: a clip-path that leaves no width or no height hides the element', () => {
  const { clippedAway } = window.__visualTree;
  const rect = { width: 1280, height: 370 };
  const hidden = (clipPath) => clippedAway({ clipPath }, rect);
  assert.equal(hidden('inset(0px 0px 100%)'), true, 'a closed mega menu');
  assert.equal(hidden('inset(50%)'), true, 'one value for all four sides');
  assert.equal(hidden('inset(0px 640px 0px 640px)'), true, 'no width left');
  assert.equal(hidden('circle(0px at 50% 50%)'), true);
  assert.equal(hidden('inset(10px)'), false, 'a small inset leaves a box');
  assert.equal(hidden('inset(0px 0px 50%)'), false);
  assert.equal(hidden('circle(50% at 50% 50%)'), false);
  assert.equal(hidden('polygon(0px 0px, 100% 0px, 100% 100%)'), false);
  assert.equal(hidden('none'), false);
  assert.equal(clippedAway({}, rect), false, 'no clip-path at all');
  assert.equal(hidden('inset(0px round 999px)'), false, 'corner radii are not offsets');
  assert.equal(hidden('inset(0px 0px 100% round 8px)'), true, 'a rounded closed menu');
  assert.equal(hidden('inset(calc(50% + 0px))'), false, 'unread values: not clipped');
});

test('processTree: a fixed element is never absorbed by a collapse; it floats to root', () => {
  const banner = node('DIV', '#cmp', box(0, 520, 1280, 200), [], { id: 'cmp', fixed: true });
  const deeper = node('DIV', 'div.deeper', box(0, 133, 1280, 0), [banner], {
    className: 'deeper',
  });
  const main = node('DIV', 'div.content', box(0, 53, 1280, 3000), [deeper], {
    className: 'content',
  });
  const { root, nodeMap, promotedToRoot } = processTree(page([utility(), main, footer(4000)]));
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['#cmp'],
  );
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['#utility', 'div.content', 'div.footer', '#cmp'],
  );
  assert.deepEqual(plain(nodeMap.rc4.overlay), { occluding: ['rc2'] });
});

test('processTree: a fixed element goes to the root even when an ancestor contains it', () => {
  const chat = node('DIV', '#chat', box(960, 400, 300, 60), [], { id: 'chat', fixed: true });
  const card = node('DIV', 'div.card', box(0, 300, 1280, 50), [], { className: 'card' });
  const inner = node('DIV', 'div.inner', box(0, 300, 1280, 50), [card, chat], {
    className: 'inner',
  });
  const section = node('DIV', 'div.section', box(0, 53, 1280, 1000), [inner], {
    className: 'section',
  });
  const { root } = processTree(page([section, footer(4000)]));
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['div.section', 'div.footer', '#chat'],
  );
});

test('processTree: a row overhanging its container by a gutter stays in it', () => {
  // Grid rows have negative margins: 878 px inside an 848 px container.
  const col = (x) => node('DIV', `div.col${x}`, box(x, 150, 439, 400), [], { className: 'col' });
  const row = node('DIV', 'div.row', box(348, 150, 878, 400), [col(348), col(787)], {
    className: 'row',
  });
  const title = node('H2', 'h2', box(363, 100, 848, 50));
  const container = node('DIV', 'div.container', box(363, 100, 848, 450), [title, row], {
    className: 'container',
  });
  const { root, promotedToRoot } = processTree(page([utility(), container, footer(4000)]));
  assert.equal(promotedToRoot.size, 0, 'nothing escaped');
  assert.deepEqual(
    plain(root.children[1].children).map((c) => c.selector),
    ['h2', 'div.row'],
  );
});

test('processTree: a child three quarters outside its parent still escapes', () => {
  const half = node('DIV', 'div.half', box(0, 300, 1280, 400), [], { className: 'half' });
  const bar = node('DIV', 'div.bar', box(0, 0, 1280, 100), [], { className: 'bar' });
  const host = node('DIV', 'div.host', box(0, 0, 1280, 400), [bar, half], { className: 'host' });
  const { promotedToRoot } = processTree(page([host, content(700, 2000)]));
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['div.half'],
  );
});

test('isContainedIn: no overlap, or a zero-area child outside, is not contained', () => {
  const { isContainedIn } = window.__visualTree;
  const parent = box(0, 0, 1000, 100);
  assert.equal(isContainedIn(box(0, 100, 1000, 300), parent), false, 'a dropdown below');
  assert.equal(isContainedIn(box(1100, 0, 200, 100), parent), false, 'a banner beside it');
  assert.equal(isContainedIn(box(0, 500, 1000, 0), parent), false);
  assert.equal(isContainedIn(box(1, 1, 998, 98), parent), true);
});

test('processTree: content overflowing a parent that clips it does not escape', () => {
  // A logo marquee: the track is 6000 px wide inside a 1280 px strip with overflow hidden.
  const track = node('UL', 'ul.track', box(-500, 200, 6000, 72), [], { className: 'track' });
  const title = node('H2', 'h2', box(0, 133, 1280, 60));
  track.clip = box(0, 133, 1280, 140);
  const strip = node('DIV', 'div.strip', box(0, 133, 1280, 140), [title, track], {
    className: 'strip',
  });
  const { root, promotedToRoot } = processTree(page([utility(), strip, footer(4000)]));
  assert.equal(promotedToRoot.size, 0);
  assert.deepEqual(
    plain(root.children[1].children).map((c) => c.selector),
    ['h2', 'ul.track'],
  );
});

test('processTree: clipping one axis does not hold a child escaping along the other', () => {
  const menu = node('DIV', 'div.menu', box(0, 133, 1280, 400), [], { className: 'menu' });
  const bar = node('DIV', 'div.bar', box(0, 53, 1280, 80), [], { className: 'bar' });
  menu.clip = { x: 0, width: 1280 };
  const nav = node('NAV', 'nav', box(0, 53, 1280, 80), [bar, menu]);
  const { promotedToRoot } = processTree(page([utility(), nav, content(133, 3000)]));
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['div.menu'],
  );
});

test('processTree: a carousel slide clipped out of view is not an overlay', () => {
  const clip = box(17, 200, 1246, 256);
  const slide = (x) => node('DIV', `div.s${x}`, box(x, 200, 1246, 256), [], { className: 's', clip });
  const track = node('DIV', 'div.track', box(17, 200, 1246, 256), [slide(17), slide(1263)]);
  const wrap = node('DIV', 'div.wrap', box(17, 200, 1246, 256), [track], { className: 'wrap' });
  const { root, promotedToRoot } = processTree(page([utility(), wrap, footer(4000)]));
  assert.equal(promotedToRoot.size, 0);
  assert.equal(root.children[1].children.length, 2);
});

// A fake DOM chain for overflowClip: el(style, rect, parent).
const el = (style, rect, parentElement = document.body) => ({
  parentElement,
  style: {
    position: 'static',
    display: 'block',
    overflowX: 'visible',
    overflowY: 'visible',
    transform: 'none',
    perspective: 'none',
    filter: 'none',
    contain: 'none',
    ...style,
  },
  getBoundingClientRect: () => ({ left: rect.x, top: rect.y }),
  clientLeft: 0,
  clientTop: 0,
  clientWidth: rect.width,
  clientHeight: rect.height,
});
const clipOf = (element) =>
  plain(window.__visualTree.overflowClip(element, (e) => e.style) ?? null);
const hidden = { overflowX: 'hidden', overflowY: 'hidden' };

test('overflowClip: an ancestor clips an element in flow', () => {
  const strip = el(hidden, box(0, 133, 1280, 140));
  assert.deepEqual(clipOf(el({}, box(-500, 200, 6000, 72), strip)), box(0, 133, 1280, 140));
  const xOnly = el({ overflowX: 'clip' }, box(0, 0, 1000, 50));
  assert.deepEqual(clipOf(el({}, box(0, 0, 2000, 50), xOnly)), { x: 0, width: 1000 });
});

test('overflowClip: an absolute element escapes a clipper below its containing block', () => {
  const positioned = el({ position: 'relative' }, box(0, 0, 1280, 4000));
  const trigger = el(hidden, box(0, 53, 1280, 80), positioned);
  assert.equal(clipOf(el({ position: 'absolute' }, box(0, 133, 1280, 400), trigger)), null);
  const clippingBlock = el({ ...hidden, position: 'relative' }, box(0, 53, 1280, 80));
  const menu = el({ position: 'absolute' }, box(0, 133, 1280, 400), clippingBlock);
  assert.deepEqual(clipOf(menu), box(0, 53, 1280, 80));
});

test('overflowClip: a fixed element is clipped only under a containing transform', () => {
  const clipper = el({ ...hidden, position: 'relative' }, box(0, 0, 1280, 100));
  assert.equal(clipOf(el({ position: 'fixed' }, box(0, 700, 1280, 200), clipper)), null);
  const transformed = el({ ...hidden, transform: 'matrix(1, 0, 0, 1, 0, 0)' }, box(0, 0, 1280, 100));
  assert.deepEqual(
    clipOf(el({ position: 'fixed' }, box(0, 700, 1280, 200), transformed)),
    box(0, 0, 1280, 100),
  );
});

test('overflowClip: display: contents ancestors are skipped; nested clips intersect', () => {
  const outer = el(hidden, box(0, 0, 1000, 500));
  const contents = el({ ...hidden, display: 'contents' }, box(0, 0, 0, 0), outer);
  const inner = el(hidden, box(200, 100, 1000, 100), contents);
  assert.deepEqual(clipOf(el({}, box(0, 0, 3000, 3000), inner)), box(200, 100, 800, 100));
  const accordion = el(hidden, box(0, 300, 1280, 0));
  assert.deepEqual(clipOf(el({}, box(0, 300, 1280, 400), accordion)), box(0, 300, 1280, 0));
});

test('an empty wrapper collapsing onto its child takes the child\'s box and identity', () => {
  // A transparent header: the sticky wrapper is 0 px high, the nav inside it 1280x80.
  const nav = node('DIV', '#topNav', box(0, 53, 1280, 80), [], { id: 'topNav', text: 'Why us' });
  const wrapper = node('DIV', 'div.sticky-nav', box(0, 53, 1280, 0), [nav], {
    className: 'experiencefragment sticky-nav',
  });
  const body = page([wrapper, node('DIV', 'div.hero', box(0, 53, 1280, 700))]);
  collapseSingleChildren(body);
  const [first] = body.children;
  assert.deepEqual(plain(first.bounds), box(0, 53, 1280, 80));
  assert.equal(first.selector, '#topNav');
  assert.equal(first.id, 'topNav');
  assert.equal(first.className, undefined, 'the wrapper\'s classes go with its box');
  assert.equal(first.text, 'Why us');
});

test('a wrapper that contains its single child keeps its own box and identity', () => {
  const inner = node('DIV', 'div.inner', box(10, 10, 1260, 60), [], { className: 'inner' });
  const outer = node('DIV', 'div.outer', box(0, 0, 1280, 80), [inner], { className: 'outer' });
  const body = page([outer, node('DIV', 'x', box(0, 80, 1280, 900))]);
  collapseSingleChildren(body);
  const [first] = body.children;
  assert.deepEqual(plain(first.bounds), box(0, 0, 1280, 80));
  assert.equal(first.selector, 'div.outer');
  assert.equal(first.className, 'outer');
});

test('a collapse onto a child overflowing a parent that clips it goes ahead', () => {
  const track = node('UL', 'ul.track', box(-500, 150, 6000, 72), [], { className: 'track' });
  track.clip = box(0, 133, 1280, 100);
  const strip = node('DIV', 'div.strip', box(0, 133, 1280, 100), [track], {
    className: 'strip',
  });
  const { root, promotedToRoot } = processTree(page([utility(), strip, footer(4000)]));
  assert.equal(promotedToRoot.size, 0);
  assert.equal(root.children[1].selector, 'div.strip');
  assert.deepEqual(plain(root.children[1].bounds), box(0, 133, 1280, 100));
});

test('a collapsed node lists every element it absorbed, whichever one owns the box', () => {
  for (const height of [80, 0]) {
    const nav = node('DIV', '#topNav', box(0, 53, 1280, 80), [], { id: 'topNav' });
    const wrapper = node('DIV', 'div.wrap', box(0, 53, 1280, height), [nav], {
      className: 'wrap',
    });
    const body = page([wrapper, node('DIV', 'z', box(0, 133, 1280, 800))]);
    collapseSingleChildren(body);
    assert.deepEqual(plain(body.children[0].collapsed), [
      { tag: 'DIV', selector: 'div.wrap', className: 'wrap' },
      { tag: 'DIV', selector: '#topNav', id: 'topNav' },
    ]);
    assert.equal(body.children[0].selector, height ? 'div.wrap' : '#topNav');
  }
});

test('nested collapses keep the whole chain, and the chain does not depend on heights', () => {
  const build = (h) => {
    const nav = node('DIV', '#topNav', box(0, 53, 1280, 80), [], { id: 'topNav' });
    const grid = node('DIV', 'div.grid', box(0, 53, 1280, h), [nav], { className: 'grid' });
    const cmp = node('DIV', 'div.cmp', box(0, 53, 1280, h), [grid], { className: 'cmp' });
    const wrap = node('DIV', 'div.wrap', box(0, 53, 1280, h), [cmp], { className: 'wrap' });
    const body = page([wrap, node('DIV', 'z', box(0, 133, 1280, 800))]);
    collapseSingleChildren(body);
    return body.children[0];
  };
  const names = (n) => plain(n.collapsed.map((c) => c.selector));
  assert.deepEqual(names(build(80)), ['div.wrap', 'div.cmp', 'div.grid', '#topNav']);
  assert.deepEqual(names(build(0)), names(build(80)));
});

test('processTree: a transparent header over a hero keeps the nav next to the hero', () => {
  const nav = node('DIV', '#topNav', box(0, 53, 1280, 80), [], { id: 'topNav' });
  const grid = node('DIV', 'div.grid', box(0, 53, 1280, 0), [nav], { className: 'grid' });
  const wrapper = node('DIV', 'div.sticky-nav', box(0, 53, 1280, 0), [grid], {
    className: 'experiencefragment sticky-nav',
  });
  const hero = node('DIV', 'div.hero', box(0, 53, 1280, 700), [], { className: 'hero' });
  const { root, nodeMap } = processTree(page([utility(), wrapper, hero, footer(4000)]));
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['#utility', '#topNav', 'div.hero', 'div.footer'],
  );
  assert.deepEqual(plain(root.children[1].bounds), box(0, 53, 1280, 80));
  assert.deepEqual(Object.keys(nodeMap), ['r', 'rc1', 'rc2', 'rc3', 'rc4']);
});

test('processTree: a dropdown overflowing its trigger is promoted and marked as occluding', () => {
  const menu = node('DIV', 'div.menu', box(0, 133, 1280, 400), [], { className: 'menu' });
  const trigger = node('DIV', 'div.trigger', box(0, 53, 1280, 80), [menu], {
    className: 'trigger',
  });
  const { root, nodeMap, promotedToRoot } = processTree(
    page([utility(), trigger, content(133, 3000), footer(4000)]),
  );
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['#utility', 'div.trigger', 'div.content', 'div.footer', 'div.menu'],
  );
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['div.menu'],
  );
  assert.deepEqual(plain(nodeMap.rc5.overlay), { occluding: ['rc3'] });
  assert.equal(nodeMap.rc2.overlay, undefined);
});

test('processTree: a fixed element inside a promoted fixed element reaches the root too', () => {
  const chat = node('DIV', '#chat', box(960, 20, 300, 60), [], { id: 'chat', fixed: true });
  const cmp = node('DIV', '#cmp', box(0, 700, 1280, 200), [chat], { id: 'cmp', fixed: true });
  const wrap = node('DIV', 'div.wrap', box(0, 53, 1280, 100), [
    node('DIV', 'div.a', box(0, 53, 1280, 50), [], { className: 'a' }),
    cmp,
  ]);
  const { root, nodeMap } = processTree(page([utility(), wrap, footer(4000)]));
  assert.deepEqual(
    Array.from(root.children, (c) => c.selector),
    ['#utility', 'div.wrap', 'div.footer', '#cmp', '#chat'],
  );
  assert.deepEqual(plain(root.children[3].children), []);
  assert.deepEqual(plain(nodeMap.rc5.overlay), { occluding: ['rc1', 'rc2'] });
});

test('processTree: a child escaping a promoted node is promoted in turn', () => {
  const sub = node('DIV', 'div.sub', box(0, 600, 1280, 300), [], { className: 'sub' });
  const item = node('DIV', 'div.item', box(0, 133, 1280, 40), [], { className: 'item' });
  const menu = node('DIV', 'div.menu', box(0, 133, 1280, 400), [item, sub], {
    className: 'menu',
  });
  const bar = node('DIV', 'div.bar', box(0, 53, 1280, 80), [], { className: 'bar' });
  const trigger = node('DIV', 'div.trigger', box(0, 53, 1280, 80), [bar, menu], {
    className: 'trigger',
  });
  const { root, promotedToRoot } = processTree(page([utility(), trigger, content(133, 3000)]));
  assert.deepEqual(
    [...promotedToRoot].map((n) => n.selector),
    ['div.menu', 'div.sub'],
  );
  assert.deepEqual(
    plain(root.children.find((c) => c.selector === 'div.menu').children).map((c) => c.selector),
    ['div.item'],
  );
});
