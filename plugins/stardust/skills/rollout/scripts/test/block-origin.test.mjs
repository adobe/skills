#!/usr/bin/env node
// skills/rollout/scripts/test/block-origin.test.mjs — the delivered walker block-origin.mjs builds on
// (lib.mjs walkDelivered: parseDelivered's records with their nodes, parseDelivered unchanged) and
// block-origin.mjs's primitives: text normalisation, the source DOM index, the selector engine (every
// grammar piece; unsupported syntax throws, countMatches 0), stable selectors (precedence, generated
// ids and state classes rejected, every derived selector resolving exactly once), the delivered
// fragments (roles, keyed duplicates), text alignment (a content container beats a nav repeating one
// of its texts; a delivered-only text lowers confidence), lca and coveredShare; importing runs nothing,
// --help writes nothing, unit-geometry resolves in both layouts and its absence fails only on use.
// Scratch copies live next to this file (removed at exit). All HTML is synthetic and inline.
// Run: node plugins/stardust/skills/rollout/scripts/test/block-origin.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const SCRIPT = join(SCRIPTS, 'block-origin.mjs');
const DIFF = join(SCRIPTS, '..', '..', 'diff', 'scripts');
const SCRATCH = mkdtempSync(join(HERE, '.scratch-block-origin-'));
process.on('exit', () => rmSync(SCRATCH, { recursive: true, force: true }));

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e && e.message).split('\n').join('\n  ')}`); } };
// Imported as namespaces so a missing export fails its own checks, not the whole file.
const lib = await import('../lib.mjs').catch((e) => { console.log(`(../lib.mjs did not load: ${e.message})`); return {}; });
const bo = await import('../block-origin.mjs').catch((e) => { console.log(`(../block-origin.mjs did not load: ${e.message})`); return {}; });
const node = (cwd, args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
const ok = (r, code = 0) => assert.equal(r.status, code, `exit ${r.status}, want ${code}\n  stdout: ${(r.stdout || '').trim().slice(0, 600)}\n  stderr: ${(r.stderr || '').trim().slice(0, 600)}`);
const scratch = (name) => { const d = join(SCRATCH, name); mkdirSync(d, { recursive: true }); return d; };

// A hub page as delivered: a styled section (default content, a teaser grid, default content, chrome-free),
// a metadata-only section (no record), a section with a hero, a chrome div and a separator.
const DELIVERED = `<html><head><title>A hub page</title></head><body><header></header><main>
<div>
  <h1>A hub page</h1>
  <p>Intro text for the hub.</p>
  <div class="teaser grid"><div><div><p>First teaser</p></div><div>Second teaser</div></div><div><div>Third teaser</div></div></div>
  <p><a href="/more">More</a></p>
  <ul><li><a href="/a">A link</a></li></ul>
  <div class="section-metadata"><div><div>style</div><div>dark</div></div></div>
</div>
<div><div class="metadata"><div><div>title</div><div>Hub</div></div></div></div>
<div>
  <div class="hero"><div><div><h2>Welcome</h2></div></div></div>
  <div class="nav"><div><div>chrome</div></div></div>
  <hr>
</div>
</main><footer></footer></body></html>`;

check('walkDelivered: { records, sections, metadata, nodes }; nodes line up with records', () => {
  const w = lib.walkDelivered(DELIVERED);
  assert.deepEqual(Object.keys(w), ['records', 'sections', 'metadata', 'nodes']);
  assert.deepEqual(w.records.map((r) => [r.pos, r.kind, r.block, r.variant]), [
    [0, 'default', 'default-content', 'heading+text'],
    [1, 'block', 'teaser', 'grid'],
    [2, 'default', 'default-content', 'button+link-list'],
    [3, 'block', 'hero', null],
    [4, 'default', 'default-content', 'separator'],
  ]);
  assert.equal(w.nodes.length, w.records.length);
  for (const r of w.records) {
    const n = w.nodes[r.pos];
    if (r.kind === 'block') {
      assert.ok(!Array.isArray(n), `record ${r.pos}: a block's node is its div`);
      assert.equal(n.tag, 'div');
      assert.equal(lib.classList(n)[0], r.block);
    } else {
      assert.ok(Array.isArray(n), `record ${r.pos}: a default record's nodes are an array`);
    }
  }
  assert.deepEqual(w.nodes[0].map((n) => [n.tag, lib.textOf(n)]), [['h1', 'A hub page'], ['p', 'Intro text for the hub.']]);
  assert.deepEqual(w.nodes[2].map((n) => [n.tag, lib.textOf(n)]), [['p', 'More'], ['ul', 'A link']]);
  assert.deepEqual(w.nodes[4].map((n) => n.tag), ['hr']);
  assert.deepEqual(lib.classList(w.nodes[1]), ['teaser', 'grid']);
  assert.equal(lib.elements(w.nodes[1]).length, 2, 'the teaser grid div keeps its two rows');
  assert.match(lib.textOf(w.nodes[3]), /Welcome/);
});

check('parseDelivered: exactly { records, sections, metadata } of walkDelivered', () => {
  const p = lib.parseDelivered(DELIVERED);
  const w = lib.walkDelivered(DELIVERED);
  assert.deepEqual(Object.keys(p), ['records', 'sections', 'metadata']);
  assert.deepEqual(p, { records: w.records, sections: w.sections, metadata: w.metadata });
  assert.deepEqual(p.sections, [{ pos: 0, style: 'dark', blocks: [0, 1, 2] }, { pos: 1, style: null, blocks: [3, 4] }]);
  assert.deepEqual(p.metadata, { title: 'Hub' });
});

// --- block-origin.mjs primitives -----------------------------------------------------------------
const flat = (n) => lib.textOf(n).replace(/\s+/g, ' ').trim();
const summary = (els) => els.map((e) => `${e.tag}:${flat(e).slice(0, 24)}`);
const el = (index, tag, text) => index.els.find((e) => e.tag === tag && flat(e) === text);
const byClass = (index, cls) => index.els.find((e) => lib.classList(e).includes(cls));
const isUnsupported = (e) => e && e.name === 'UnsupportedSelector';

check('normText / squash: NFKC, lower case, typographic quotes, dashes, ellipsis, NBSP, whitespace', () => {
  assert.equal(bo.normText('  Ｈello\u00a0“World” — it’s… '), 'hello "world" - it\'s...');
  assert.equal(bo.normText('5′ − 3‐4 ‚x‛ „y‟ a―b'), '5\' - 3-4 \'x\' "y" a-b');
  assert.equal(bo.normText('a\t\n  b'), 'a b');
  assert.equal(bo.normText(null), '');
  assert.equal(bo.normText(undefined), '');
  assert.equal(bo.squash(' A b\n c '), 'abc');
  assert.equal(bo.squash('It’s — fine'), 'it\'s-fine');
});

// A hub page as captured: chrome with a nav, a hero section and a teaser section with three cards.
const ENGINE_SRC = `<!doctype html><html><head><title>Ignored head text</title></head><body>
<header id="top" class="site-header"><nav class="main-nav"><ul><li><a href="/news">News</a></li><li><a href="/about">About us</a></li></ul></nav></header>
<main id="content">
<section class="hero banner" data-kind="lead hero" data-x="alpha-beta"><h1>Welcome to the hub</h1><p>Intro paragraph text.</p></section>
<section class="teasers"><div class="card"><h3>First card</h3><p>Card one body.</p></div><div class="card"><h3>News</h3><p>Card two body.</p></div><div class="card is-active"><h3>Third card</h3><p>Card three body.</p><p>Card three more.</p></div></section>
</main>
<footer><p>Footer text</p><span class="md:flex">Flex</span></footer>
</body></html>`;

check('querySelectorAll: tag, *, #id, .class, compounds, attributes, combinators, pseudo-classes, lists, escapes', () => {
  const idx = bo.indexSource(ENGINE_SRC);
  const q = (s) => summary(bo.querySelectorAll(idx, s));
  assert.deepEqual(q('h3'), ['h3:First card', 'h3:News', 'h3:Third card']);
  assert.equal(bo.querySelectorAll(idx, '*').length, idx.els.length);
  assert.deepEqual(q('title'), ['title:Ignored head text']);
  assert.deepEqual(bo.querySelectorAll(idx, '#content').map((e) => e.tag), ['main']);
  assert.equal(q('.card').length, 3);
  assert.deepEqual(bo.querySelectorAll(idx, 'div.card.is-active').map((e) => e.attrs.class), ['card is-active']);
  assert.equal(q('[data-kind]').length, 1);
  assert.equal(q('[data-kind="lead hero"]').length, 1);
  assert.equal(q("[data-kind='lead hero']").length, 1);
  assert.equal(q('[data-kind=lead]').length, 0);
  assert.equal(q('[data-kind~=hero]').length, 1);
  assert.equal(q('[data-kind~="lead hero"]').length, 0);
  assert.equal(q('[data-x^=alpha]').length, 1);
  assert.equal(q("[data-x$='beta']").length, 1);
  assert.equal(q('[data-x*="ha-b"]').length, 1);
  assert.equal(q('[data-x^=""]').length, 0);
  assert.deepEqual(q('section > h1'), ['h1:Welcome to the hub']);
  assert.equal(q('main h3').length, 3);
  assert.equal(q('main > h3').length, 0);
  assert.deepEqual(q('body > main > section > div > p'), ['p:Card one body.', 'p:Card two body.', 'p:Card three body.', 'p:Card three more.']);
  assert.deepEqual(q('.card:nth-of-type(2) h3'), ['h3:News']);
  assert.deepEqual(bo.querySelectorAll(idx, 'section:nth-child(2)').map((e) => e.attrs.class), ['teasers']);
  assert.deepEqual(q('li:first-child a'), ['a:News']);
  assert.deepEqual(q('li:last-child a'), ['a:About us']);
  assert.deepEqual(q('div.card > p:first-of-type'), ['p:Card one body.', 'p:Card two body.', 'p:Card three body.']);
  assert.deepEqual(q('div.card > p:last-of-type'), ['p:Card one body.', 'p:Card two body.', 'p:Card three more.']);
  assert.deepEqual(q('p:nth-child(3)'), ['p:Card three more.']);
  assert.deepEqual(q('h1, #top').map((s) => s.split(':')[0]), ['header', 'h1'], 'a list returns document order');
  assert.equal(q('h1, h1').length, 1, 'a list never returns an element twice');
  assert.deepEqual(q('  section>h1 ,main > section:nth-of-type(2)  ').map((s) => s.split(':')[0]), ['h1', 'section']);
  assert.deepEqual(bo.querySelectorAll(idx, '#con\\74 ent').map((e) => e.tag), ['main']);
  assert.equal(q('.\\63 ard').length, 3);
  assert.deepEqual(q('.md\\:flex'), ['span:Flex']);
  assert.equal(q('H3').length, 3, 'tag names are case-insensitive');
  assert.equal(q('[DATA-KIND]').length, 1, 'attribute names are case-insensitive');
  assert.equal(bo.countMatches(idx, 'h3'), 3);
});

check('querySelectorAll throws UnsupportedSelector on anything else; countMatches is 0 for it', () => {
  const idx = bo.indexSource(ENGINE_SRC);
  for (const s of ['h3 + p', 'h3 ~ p', 'a:hover', 'p::before', ':not(p)', '[data-x|=alpha]', '[data-x=alpha i]', 'svg|a', '', '   ', 'h3,', 'h3 >', ':nth-child(2n+1)', '.', '#', '[data-x', 'p)']) {
    assert.throws(() => bo.querySelectorAll(idx, s), isUnsupported, `${JSON.stringify(s)} should throw UnsupportedSelector`);
    assert.equal(bo.countMatches(idx, s), 0, `countMatches(${JSON.stringify(s)})`);
  }
});

// Stable selectors: a stable id, generated ids, a state class, duplicated classes and ids, unanchored content.
const STABLE_SRC = `<html><body>
<div id="page"><div class="wrap">
<section id="story"><h2>Story</h2></section>
<section id="ember1234"><h2>Generated one</h2></section>
<section id="a1b2c3d4e5"><h2>Generated two</h2></section>
<div class="promo-strip active"><p>Promo</p></div>
<div class="tile"><p class="lede">One</p></div>
<div class="tile js-tile"><p class="lede">Two</p></div>
<div class="panel"><p class="lede">Three</p></div>
<ul><li>A</li></ul>
<ul><li>B</li><li>C</li></ul>
</div></div>
<div class="wrap"><p>Outside</p></div>
<aside><p id="dup">D1</p><p id="dup">D2</p></aside>
</body></html>`;

check('stableSelector: #id, then own compound, then ancestor anchor + own, then the structural path', () => {
  const idx = bo.indexSource(STABLE_SRC);
  const sel = (tag, text) => bo.stableSelector(idx, el(idx, tag, text));
  assert.equal(sel('section', 'Story'), '#story', 'a stable unique id');
  assert.equal(sel('section', 'Generated one'), '#page > div.wrap > section:nth-of-type(2)', 'an id with a digit run is generated');
  assert.equal(sel('section', 'Generated two'), '#page > div.wrap > section:nth-of-type(3)', 'a hex-like id is generated');
  assert.equal(sel('div', 'Promo'), 'div.promo-strip', 'a unique class compound; the state class is dropped');
  assert.equal(sel('h2', 'Story'), '#story h2', 'ancestor anchor + bare tag');
  assert.equal(sel('p', 'Three'), 'div.panel p.lede', 'ancestor compound anchor + own compound');
  assert.equal(sel('p', 'One'), '#page > div.wrap > div.tile:nth-of-type(2) > p.lede');
  assert.equal(sel('p', 'Two'), '#page > div.wrap > div.tile:nth-of-type(3) > p.lede', 'js- state class dropped from the step');
  assert.equal(sel('li', 'C'), '#page > div.wrap > ul:nth-of-type(2) > li:nth-of-type(2)');
  assert.equal(sel('p', 'Outside'), 'body > div.wrap:nth-of-type(2) > p', 'no anchor: the path starts at body');
  assert.equal(sel('p', 'D2'), 'body > aside > p:nth-of-type(2)', 'a duplicated id is not used');
  assert.equal(bo.stableSelector(idx, null), null);
});

// Alignment: the nav repeats the teaser section's heading; a noscript repeats a delivered-only text.
const ALIGN_SRC = `<html><head><title>A hub page</title></head><body>
<header><nav class="main-nav"><a href="/">Home</a><a href="/teasers">Explore the teaser grid</a></nav></header>
<main>
<section class="intro"><h1>A hub page</h1><noscript><p>Shipping note</p></noscript></section>
<section class="grid"><h2>Explore the teaser grid</h2>
<article class="card"><h3>First teaser</h3><p>Opening <b>card</b> body.</p></article>
<article class="card"><h3>Second teaser</h3><p>Closing card body.</p></article>
</section>
</main></body></html>`;
const blockNode = (inner) => lib.walkDelivered(`<main><div>${inner}</div></main>`).nodes[0];
const TEASER = blockNode('<div class="teaser"><div><div><h2>Explore the teaser grid</h2></div></div><div><div><h3>First teaser</h3><p>Opening card body.</p></div><div><h3>Second teaser</h3><p>Closing card body.</p></div></div></div>');
const PARTIAL = blockNode('<div class="teaser"><div><div><h3>First teaser</h3><p>Opening card body.</p><p>Shipping note</p></div></div></div>');
const IMAGE_ONLY = blockNode('<div class="hero"><div><div><picture><img src="hero.jpg" alt=""></picture></div></div></div>');

check('stableSelector: every element of every fixture gets a selector that resolves to exactly it', () => {
  for (const html of [STABLE_SRC, ENGINE_SRC, ALIGN_SRC]) {
    const idx = bo.indexSource(html);
    for (const e of idx.els) {
      const s = bo.stableSelector(idx, e);
      assert.ok(s, `${e.tag} "${flat(e).slice(0, 20)}" has no selector`);
      const hits = bo.querySelectorAll(idx, s);
      assert.ok(hits.length === 1 && hits[0] === e, `${s} resolves to ${hits.length} element(s), not exactly its own`);
    }
  }
});

check('indexSource: root, body, elements in document order with parent/depth/order, squashed text, id counts', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  assert.equal(idx.root.tag, '#root');
  assert.equal(idx.body.tag, 'body');
  assert.deepEqual(idx.els.slice(0, 9).map((e) => e.tag), ['html', 'head', 'title', 'body', 'header', 'nav', 'a', 'a', 'main']);
  const h1 = el(idx, 'h1', 'A hub page');
  const m = idx.meta.get(h1);
  assert.equal(m.parent, byClass(idx, 'intro'));
  assert.equal(m.depth, 4);
  assert.equal(m.order, idx.els.indexOf(h1));
  assert.equal(m.text, 'ahubpage');
  assert.equal(idx.meta.get(idx.els[1]).text, '', 'head text does not count');
  assert.equal(idx.meta.get(m.parent).text, 'ahubpage', 'noscript text does not count');
  assert.ok(!idx.meta.get(idx.body).text.includes('shippingnote'));
  assert.equal(idx.meta.get(el(idx, 'p', 'Opening card body.')).text, 'openingcardbody.', 'inline splits squash away');
  const ids = bo.indexSource(STABLE_SRC).ids;
  assert.equal(ids.get('dup'), 2);
  assert.equal(ids.get('page'), 1);
});

check('fragmentsOf: roles (heading, text, link, image), outermost container once, div cell text, keyed duplicates', () => {
  const cards = blockNode(`<div class="cards">
<div><div><picture><img src="a.jpg" alt="Team photo"></picture></div><div><h3>Card title</h3><p>Body <strong>bold</strong> text</p><p><a href="/x">Read more</a></p><p><strong><a href="/y">Read more</a></strong></p></div></div>
<div><div>Cell own text <em>inline</em></div><div><ul><li>Item <p>nested container</p></li></ul></div><div><img src="b.jpg"></div></div>
</div>`);
  const f = bo.fragmentsOf(cards);
  assert.deepEqual(f.map((x) => [x.role, x.text]), [
    ['image', 'Team photo'], ['heading', 'Card title'], ['text', 'Body bold text'], ['link', 'Read more'], ['link', 'Read more'],
    ['text', 'Cell own text inline'], ['text', 'Item nested container'], ['image', ''],
  ]);
  assert.deepEqual(f.slice(0, 7).map((x) => x.key), ['image:team photo', 'heading:card title', 'text:body bold text', 'link:read more',
    'link:read more #2', 'text:cell own text inline', 'text:item nested container']);
  assert.match(f[7].key, /^image:.+#1$/);
  assert.deepEqual(Object.keys(f[0]), ['role', 'sel', 'text', 'key']);
  assert.equal(new Set(f.map((x) => x.sel)).size, f.length, 'sel is a distinct path per fragment');
  assert.deepEqual(bo.fragmentsOf([cards]), f, 'one node or an array of nodes');
  const w = lib.walkDelivered(DELIVERED);
  assert.deepEqual(bo.fragmentsOf(w.nodes[0]).map((x) => [x.role, x.text]), [['heading', 'A hub page'], ['text', 'Intro text for the hub.']]);
  assert.deepEqual(bo.fragmentsOf(w.nodes[2]).map((x) => [x.role, x.text]), [['link', 'More'], ['link', 'A link']]);
});

check('alignBlock: the content container wins over a nav that repeats one of its texts', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const a = bo.alignBlock(idx, bo.fragmentsOf(TEASER));
  assert.equal(a.anchor, byClass(idx, 'grid'));
  assert.deepEqual({ ...a, anchor: undefined }, { anchor: undefined, confidence: 1, covered: 75, total: 75, unmatched: [] });
  assert.equal(bo.stableSelector(idx, a.anchor), 'section.grid');
});

check('alignBlock: a delivered-only text lowers confidence to its share; the deepest full container is the anchor', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const a = bo.alignBlock(idx, bo.fragmentsOf(PARTIAL));
  const card = el(idx, 'h3', 'First teaser');
  assert.equal(a.anchor, idx.meta.get(card).parent);
  assert.equal(a.anchor.tag, 'article');
  // firstteaser (11) + openingcardbody. (16) of 39 with shippingnote (12), found only inside a noscript
  assert.deepEqual({ ...a, anchor: undefined }, { anchor: undefined, confidence: 0.692, covered: 27, total: 39, unmatched: ['text:shipping note'] });
  assert.equal(bo.stableSelector(idx, a.anchor), 'body > main > section.grid:nth-of-type(2) > article.card:nth-of-type(1)');
});

check('alignBlock: a block without text has no anchor', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  assert.deepEqual(bo.alignBlock(idx, bo.fragmentsOf(IMAGE_ONLY)), { anchor: null, confidence: 0, covered: 0, total: 0, unmatched: [] });
  assert.deepEqual(bo.alignBlock(idx, []), { anchor: null, confidence: 0, covered: 0, total: 0, unmatched: [] });
});

// Image alt is an attribute, never source text: it neither aligns a block nor counts toward its confidence (R17).
const WITH_ALT = blockNode('<div class="teaser"><div><div><picture><img src="a.jpg" alt="Smiling crew at the opening"></picture></div><div><h3>First teaser</h3><p>Opening card body.</p></div></div></div>');
const ALT_ONLY = blockNode('<div class="hero"><div><div><picture><img src="hero.jpg" alt="Explore the teaser grid"></picture></div></div></div>');

check('alignBlock: image alt text does not count — a perfect text match with an alt-carrying image scores 1', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const f = bo.fragmentsOf(WITH_ALT);
  assert.deepEqual(f.map((x) => [x.role, x.text]), [['image', 'Smiling crew at the opening'], ['heading', 'First teaser'], ['text', 'Opening card body.']], 'fragmentsOf keeps the image');
  const a = bo.alignBlock(idx, f);
  assert.equal(a.anchor, idx.meta.get(el(idx, 'h3', 'First teaser')).parent);
  assert.deepEqual({ ...a, anchor: undefined }, { anchor: undefined, confidence: 1, covered: 27, total: 27, unmatched: [] });
});

check('alignBlock: an image-only block whose alt equals a page heading has no anchor (position fallback)', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const f = bo.fragmentsOf(ALT_ONLY);
  assert.deepEqual(f.map((x) => [x.role, x.text, x.key]), [['image', 'Explore the teaser grid', 'image:explore the teaser grid']]);
  assert.deepEqual(bo.alignBlock(idx, f), { anchor: null, confidence: 0, covered: 0, total: 0, unmatched: [] });
});

check('coveredShare: image alt text does not count', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  assert.equal(bo.coveredShare(idx, idx.meta.get(el(idx, 'h3', 'First teaser')).parent, bo.fragmentsOf(WITH_ALT)), 1);
  assert.equal(bo.coveredShare(idx, el(idx, 'h2', 'Explore the teaser grid'), bo.fragmentsOf(ALT_ONLY)), 0);
});

check('lca: the lowest common ancestor element; the element itself for one; null for none', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const h3 = el(idx, 'h3', 'First teaser');
  const p2 = el(idx, 'p', 'Closing card body.');
  const grid = idx.meta.get(idx.meta.get(h3).parent).parent;
  assert.equal(bo.lca(idx, [h3, p2]), grid);
  assert.equal(bo.lca(idx, [h3]), h3);
  assert.equal(bo.lca(idx, [null, h3, h3]), h3);
  assert.equal(bo.lca(idx, [grid, h3]), grid);
  assert.equal(bo.lca(idx, [el(idx, 'a', 'Home'), p2]), idx.body);
  assert.equal(bo.lca(idx, []), null);
  assert.equal(bo.lca(idx, [null]), null);
});

check('coveredShare: share of the fragments\' text an element contains (0 without text or element)', () => {
  const idx = bo.indexSource(ALIGN_SRC);
  const f = bo.fragmentsOf(PARTIAL);
  const h3 = el(idx, 'h3', 'First teaser');
  assert.equal(bo.coveredShare(idx, idx.meta.get(h3).parent, f), 0.692);
  assert.equal(bo.coveredShare(idx, h3, f), 0.282);
  assert.equal(bo.coveredShare(idx, byClass(idx, 'grid'), bo.fragmentsOf(TEASER)), 1);
  assert.equal(bo.coveredShare(idx, null, f), 0);
  assert.equal(bo.coveredShare(idx, h3, []), 0);
  assert.equal(bo.coveredShare(idx, h3, bo.fragmentsOf(IMAGE_ONLY)), 0);
});

check('importing block-origin.mjs runs nothing (no output, exit 0)', () => {
  const r = node(SCRATCH, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`]);
  ok(r);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

check('--help / -h: exit 0, usage on stdout, nothing written', () => {
  const dir = scratch('help');
  for (const flag of ['--help', '-h']) {
    const r = node(dir, [SCRIPT, flag]);
    ok(r);
    assert.match(r.stdout, /Usage:/);
    assert.match(r.stdout, /Exit:/);
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(dir), [], `${flag} wrote into the cwd`);
  }
});

check('unit-geometry: a project copy without it imports and answers --help; fragmentsOf names it; with it, keys', () => {
  const copy = scratch('copy');
  const rollout = join(copy, 'stardust', 'scripts', 'rollout');
  mkdirSync(rollout, { recursive: true });
  for (const f of ['block-origin.mjs', 'lib.mjs']) copyFileSync(join(SCRIPTS, f), join(rollout, f));
  const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(rollout, 'block-origin.mjs')).href)});
try { console.log(m.fragmentsOf({ tag: 'p', attrs: {}, children: [{ tag: '#text', text: 'Hi there' }] }).map((f) => f.key).join(',')); }
catch (e) { console.log(\`error: \${e.message}\`); }`;
  let r = node(copy, ['--input-type=module', '-e', probe]);
  ok(r);
  assert.match(r.stdout, /^error: .*unit-geometry\.mjs/);
  ok(node(copy, [join(rollout, 'block-origin.mjs'), '--help']));
  const diff = join(copy, 'stardust', 'scripts', 'diff');
  mkdirSync(diff, { recursive: true });
  for (const f of readdirSync(DIFF).filter((x) => x.endsWith('.mjs'))) copyFileSync(join(DIFF, f), join(diff, f));
  r = node(copy, ['--input-type=module', '-e', probe]);
  ok(r);
  assert.equal(r.stdout.trim(), 'text:hi there');
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
