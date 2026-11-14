import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bands, bandsText, cut, fixedLayers, siblings } from '#src/page/bands.mjs';

const box = (x, y, width, height) => ({ x, y, width, height });
const node = (tag, selector, bounds, children = []) => ({ tag, selector, bounds, children });

// A page: header, then a main with four siblings — a hero image, a breadcrumb, an article
// beside a sidebar (two siblings sharing a vertical range) — then a footer.
const TREE = node('BODY', 'body', box(0, 0, 1280, 4000), [
  node('HEADER', 'body > header', box(0, 0, 1280, 100)),
  node('MAIN', 'body > main', box(0, 100, 1280, 3700), [
    node('DIV', 'main > div.wrap', box(0, 100, 1280, 3700), [
      node('DIV', 'div.hero', box(0, 100, 1280, 600)),
      node('DIV', 'div.breadcrumb', box(0, 700, 1280, 60)),
      node('DIV', 'div.article', box(60, 800, 760, 3000), [
        node('H1', 'div.article > h1', box(60, 820, 700, 40)),
        ...Array.from({ length: 6 }, (_, i) =>
          node('P', `div.article > p:nth-of-type(${i + 1})`, box(60, 900 + i * 300, 700, 200)),
        ),
      ]),
      node('ASIDE', 'aside.side', box(900, 800, 320, 900), [
        node('H3', 'aside.side > h3', box(900, 820, 300, 30)),
        node('UL', 'aside.side > ul', box(900, 860, 300, 60)),
      ]),
    ]),
  ]),
  node('FOOTER', 'body > footer', box(0, 3800, 1280, 200)),
]);
const BODY = { top: 100, bottom: 3800 };
const slice = (n, top, bottom) => ({
  top,
  bottom,
  left: 0,
  right: 1280,
  nodes: [n],
  parts: [{ x: 0, w: 1280, selector: n.selector }],
});

test('siblings: wrappers are walked through to the first level with several children', () => {
  assert.deepEqual(
    siblings(TREE, BODY).map((n) => n.selector),
    ['div.hero', 'div.breadcrumb', 'div.article', 'aside.side'],
  );
});

test('bands: siblings stacked, side-by-side siblings one band, gaps to the band above', () => {
  const out = bands(TREE, { range: BODY });
  assert.deepEqual(
    out.map((b) => [b.id, b.top, b.bottom, b.left, b.right, b.side]),
    [
      ['B1', 100, 700, 0, 1280, false],
      ['B2', 700, 800, 0, 1280, false],
      ['B3', 800, 3800, 0, 1280, true],
    ],
  );
  assert.deepEqual(out[2].selectors, ['div.article', 'aside.side']);
  assert.ok(
    out.every((b) => b.children === undefined),
    'level 1 only by default',
  );
});

test('bands: the whole page by default, header and footer are bands like any other', () => {
  const out = bands(TREE);
  assert.deepEqual(
    out.map((b) => [b.top, b.bottom, b.selectors[0]]),
    [
      [0, 100, 'body > header'],
      [100, 3800, 'body > main'],
      [3800, 4000, 'body > footer'],
    ],
  );
});

test('bands: fixed elements float over the page, they are listed apart, not sliced', () => {
  // aem.live: a fixed header over the top of a main that starts at 0, and a fixed curtain.
  const page = node('BODY', 'body', box(0, 0, 1280, 9235), [
    { ...node('HEADER', 'body > header', box(0, 0, 1280, 65)), fixed: true },
    node('MAIN', 'body > main', box(0, 0, 1280, 8708)),
    node('FOOTER', 'body > footer', box(0, 8708, 1280, 527)),
    { ...node('DIV', 'div.curtain', box(0, 0, 1280, 720)), fixed: true },
  ]);
  assert.deepEqual(
    bands(page).map((b) => [b.top, b.bottom, b.selectors[0]]),
    [
      [0, 8708, 'body > main'],
      [8708, 9235, 'body > footer'],
    ],
  );
  assert.deepEqual(fixedLayers(page), [
    { selector: 'body > header', top: 0, bottom: 65, left: 0, right: 1280 },
    { selector: 'div.curtain', top: 0, bottom: 720, left: 0, right: 1280 },
  ]);
});

test('bands: siblings above or below a tall child are kept, not passed through', () => {
  // A long article: main is over 95 % of the page, header and footer are thin.
  const long = node('BODY', 'body', box(0, 0, 1280, 10000), [
    node('HEADER', 'header', box(0, 0, 1280, 100)),
    node('MAIN', 'main', box(0, 100, 1280, 9800), [
      node('DIV', 'div.a', box(0, 100, 1280, 4900)),
      node('DIV', 'div.b', box(0, 5000, 1280, 4900)),
    ]),
    node('FOOTER', 'footer', box(0, 9900, 1280, 100)),
  ]);
  assert.deepEqual(
    bands(long).map((b) => [b.top, b.bottom, b.selectors[0]]),
    [
      [0, 100, 'header'],
      [100, 9900, 'main'],
      [9900, 10000, 'footer'],
    ],
  );
});

test('bands: text elements side by side are columns, not a text run', () => {
  const page = node('BODY', 'body', box(0, 0, 1280, 1000), [
    node('DIV', 'div.top', box(0, 0, 1280, 400)),
    node('IMG', 'img.l', box(0, 400, 600, 400)),
    node('IMG', 'img.r', box(680, 400, 600, 400)),
    node('P', 'p', box(0, 800, 1280, 200)),
  ]);
  const out = bands(page, { depth: 'all' });
  assert.deepEqual(
    out.map((b) => [b.top, b.bottom, b.text, b.side]),
    [
      [0, 400, false, false],
      [400, 800, false, true],
      [800, 1000, true, false],
    ],
  );
  assert.deepEqual(
    out[1].children.map((k) => [k.left, k.right]),
    [
      [0, 600],
      [680, 1280],
    ],
  );
});

// The contract: a stack of bands covers its range with no gap and no overlap; columns lie
// within their parent and do not overlap each other across.
function assertContract(list, range, where) {
  const ctx = `${where} ${list.map((b) => b.id).join(',')}`;
  list.forEach((b) => {
    assert.ok(b.top < b.bottom, `${ctx}: ${b.id} is empty`);
    assert.ok(b.top >= range.top && b.bottom <= range.bottom, `${ctx}: ${b.id} is outside`);
  });
  for (let i = 1; i < list.length; i += 1) {
    assert.equal(list[i].top, list[i - 1].bottom, `${ctx}: gap or overlap at ${list[i].id}`);
  }
  assert.equal(list[0].top, range.top, `${ctx}: starts below its range`);
  assert.equal(list.at(-1).bottom, range.bottom, `${ctx}: ends above its range`);
  for (const b of list.filter((x) => x.children)) {
    if (!b.side) {
      assertContract(b.children, b, where);
      continue;
    }
    b.children.forEach((k, i) => {
      assert.ok(k.top >= b.top && k.bottom <= b.bottom, `${ctx}: ${k.id} is outside`);
      if (i > 0) assert.ok(k.left >= b.children[i - 1].left, `${ctx}: ${k.id} out of order`);
      if (k.children) assertContract(k.children, k, where);
    });
  }
}

test('contract: bands tile their range at every depth', () => {
  assertContract(bands(TREE, { depth: 'all' }), { top: 0, bottom: 4000 }, 'TREE');
  for (const site of ['wknd', 'govuk', 'mdn']) {
    const { tree } = JSON.parse(
      readFileSync(new URL(`../../test/fixtures/bands/${site}.json`, import.meta.url), 'utf8'),
    );
    const out = bands(tree, { depth: 'all' });
    assertContract(out, { top: out[0].top, bottom: out.at(-1).bottom }, site);
  }
});

test('bands: a page with nothing to slice is one band', () => {
  const empty = node('BODY', 'body', box(0, 0, 1280, 900));
  assert.deepEqual(
    bands(empty, { depth: 'all' }).map((b) => [b.id, b.top, b.bottom, b.children]),
    [['B1', 0, 900, undefined]],
  );
  const onlyFixed = node('BODY', 'body', box(0, 0, 1280, 900), [
    { ...node('DIV', 'div.modal', box(0, 0, 1280, 900)), fixed: true },
  ]);
  assert.deepEqual(
    bands(onlyFixed).map((b) => [b.top, b.bottom, b.selectors]),
    [[0, 900, ['body']]],
  );
  assert.deepEqual(bandsText([]), '');
});

test('bands: consecutive text elements are one run', () => {
  const article = node('MAIN', 'main', box(0, 100, 1280, 900), [
    node('H1', 'main > h1', box(0, 100, 1280, 60)),
    ...Array.from({ length: 4 }, (_, i) =>
      node('P', `main > p:nth-of-type(${i + 1})`, box(0, 160 + i * 100, 1280, 100)),
    ),
    node('DIV', 'main > div.cards', box(0, 560, 1280, 440)),
  ]);
  const out = bands(article, { range: { top: 100, bottom: 1000 } });
  assert.deepEqual(
    out.map((b) => [b.top, b.bottom, b.text]),
    [
      [100, 560, true],
      [560, 1000, false],
    ],
  );
  assert.equal(out[0].selectors.length, 5, 'a run lists every element in it');
});

test('bands --depth all: every band sliced until nothing is left to cut', () => {
  const [, , article] = bands(TREE, { range: BODY, depth: 'all' });
  assert.deepEqual(
    article.children.map((k) => [k.id, k.left, k.right, k.top, k.bottom]),
    [
      ['B3.1', 60, 820, 800, 3800],
      ['B3.2', 900, 1220, 800, 1700],
    ],
    'columns, each at its own extent',
  );
  const [text] = article.children[0].children;
  assert.deepEqual([text.id, text.text, text.selectors.length], ['B3.1.1', true, 7]);
  assert.equal(text.children, undefined, 'a text run is not cut');
});

test('bandsText: one indented line per band', () => {
  const lines = bandsText(bands(TREE, { range: BODY, depth: 'all' })).split('\n');
  assert.equal(lines[0], 'B1  100-700  div.hero');
  assert.equal(lines[2], 'B3  800-3800  side  div.article, aside.side');
  assert.equal(lines[3], '  B3.1  800-3800  div.article');
  assert.equal(
    lines[4],
    '    B3.1.1  800-3800  text  div.article > h1, div.article > p:nth-of-type(1), …',
  );
});

test('cut: siblings side by side under wrappers make columns', () => {
  const wrapped = node('DIV', 'div.outer', box(0, 0, 1280, 800), [
    node('DIV', 'div.inner', box(0, 0, 1280, 800), [
      node('DIV', 'div.text', box(40, 0, 700, 800), [node('P', 'p', box(40, 0, 700, 100))]),
      node('DIV', 'div.cards', box(780, 0, 460, 800), [node('UL', 'ul', box(780, 0, 460, 400))]),
    ]),
  ]);
  const lifted = cut(slice(wrapped, 0, 800));
  assert.deepEqual(
    [lifted.side, lifted.kids.map((k) => k.parts[0].selector)],
    [true, ['div.text', 'div.cards']],
  );
  const margin = node('DIV', 'div.grid', box(0, 0, 1280, 800), [
    node('DIV', 'div.side', box(58, 0, 332, 800), [node('P', 'p', box(60, 0, 300, 100))]),
    node('DIV', 'div.main', box(349, 0, 873, 800), [node('P', 'p', box(360, 0, 800, 100))]),
  ]);
  assert.equal(cut(slice(margin, 0, 800)).side, true, 'columns overlapping by a margin');
});

test('cut: a background layer is passed through; a layer over the top is carried along', () => {
  const layered = node('DIV', 'div.hero', box(0, 0, 1280, 600), [
    node('DIV', 'div.bg', box(0, 0, 1280, 600)),
    node('DIV', 'div.fg', box(20, 0, 1240, 600), [
      node('H2', 'h2', box(40, 100, 600, 60)),
      node('DIV', 'div.cta', box(40, 300, 600, 80)),
    ]),
  ]);
  assert.deepEqual(
    cut(slice(layered, 0, 600)).kids.map((k) => [k.parts[0].selector, Boolean(k.text)]),
    [
      ['h2', true],
      ['div.cta', false],
    ],
  );
  const crumb = node('DIV', 'div.crumb', box(0, 0, 1280, 50), [
    node('A', 'a', box(20, 10, 200, 20)),
  ]);
  const section = node('DIV', 'div.article', box(0, 25, 1280, 900), [
    node('DIV', 'div.part1', box(0, 60, 1280, 400)),
    node('DIV', 'div.part2', box(0, 460, 1280, 465)),
  ]);
  const overlapping = cut({ ...slice(crumb, 0, 925), nodes: [crumb, section] });
  assert.deepEqual(
    overlapping.kids.map((k) => k.parts[0].selector),
    ['div.crumb', 'div.part1', 'div.part2'],
  );
  assert.deepEqual(cut(slice(node('DIV', 'div.leaf', box(0, 0, 1280, 600)), 0, 600)).kids, []);
});

// Stored trees of the migration pipeline's bench: the same level-1 slices as its
// `candidates()` gave on them. They differ only where the pipeline passed through a tall child
// and dropped the siblings above or below it (23 of 130 bench pages); these three are not such.
for (const site of ['wknd', 'govuk', 'mdn']) {
  test(`parity with the pipeline's level 1: ${site}`, () => {
    const fixture = JSON.parse(
      readFileSync(new URL(`../../test/fixtures/bands/${site}.json`, import.meta.url), 'utf8'),
    );
    const out = bands(fixture.tree, { range: fixture.range });
    assert.deepEqual(
      out.map((b) => [b.top, b.bottom]),
      fixture.expected,
    );
  });
}
