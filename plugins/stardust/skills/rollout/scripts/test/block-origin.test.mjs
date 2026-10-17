#!/usr/bin/env node
// skills/rollout/scripts/test/block-origin.test.mjs — the delivered walker block-origin.mjs builds on
// (lib.mjs walkDelivered: parseDelivered's records with their nodes, parseDelivered unchanged) and
// block-origin.mjs's primitives: text normalisation, the source DOM index, the selector engine (every
// grammar piece; unsupported syntax throws, countMatches 0), stable selectors (precedence, generated
// ids and state classes rejected, every derived selector resolving exactly once), the delivered
// fragments (roles, keyed duplicates), text alignment (a content container beats a nav repeating one
// of its texts; a delivered-only text lowers confidence), lca and coveredShare; importing runs nothing,
// --help writes nothing, unit-geometry resolves in both layouts and its absence fails only on use.
// The mapping run (CLI): instance selectors and confidences by text alignment, sections (anchor,
// confidence, default-content roles), the position fallback, sections aligned across a template's pages
// and their generalised selector, an encoder map's precedence, --verify (and its fresh re-read), skipped
// pages and records, exit codes, determinism, the schema and the project-copy layout.
// Scratch copies live next to this file (removed at exit). All HTML is synthetic and inline.
// Run: node plugins/stardust/skills/rollout/scripts/test/block-origin.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSchema, unsupported, validate } from './schema-validate.mjs';

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

// --- the mapping run (CLI) -------------------------------------------------------------------------
const GENERATED_AT = '2026-01-02T03:04:05.000Z';
const MAPPING = join('stardust', 'rollout', 'workspace', 'mapping.json');
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const variantOf = (block, classes = []) => lib.variantId(block, classes);
/** A coverage row as inventory.mjs writes it: delivered parsed from `content` (or `delivered` as given). */
function rowFor({ slug, path, templateId = null, content, delivered }) {
  if (delivered !== undefined) return { slug, path, templateId, delivered };
  const { records, sections } = lib.parseDelivered(content);
  const blocks = records.map((r) => ({ ...r, variantId: r.kind === 'block' ? variantOf(r.block, r.classes) : null }));
  return { slug, path, templateId, delivered: { blocks, sections, lang: null, sourceSnapshot: null, contentHash: lib.sha256(content) } };
}
/**
 * A project in a scratch dir: coverage pages.json from `pages`, each page's content file (`document` when
 * the file on disk differs from what coverage was built from; `file: null` writes none) and capture,
 * encoder maps (`encode`: templateId → map object or raw text) and eds-schema files (`eds`: slug → doc).
 */
function project(name, pages, { encode = {}, eds = {}, coverage } = {}) {
  const dir = scratch(name);
  mkdirSync(join(dir, 'content'), { recursive: true });
  mkdirSync(join(dir, 'stardust', 'current', 'pages'), { recursive: true });
  put(join(dir, 'stardust', 'rollout', 'coverage', 'pages.json'),
    JSON.stringify(coverage || { formatVersion: '0.1.0', generatedAt: GENERATED_AT, pages: pages.map(rowFor) }, null, 2));
  for (const p of pages) {
    const text = p.document ?? p.content;
    if (p.file !== null && text != null) put(join(dir, 'content', p.file || `${p.path.replace(/^\/+/, '')}.html`), text);
    if (p.capture != null) put(join(dir, 'stardust', 'current', 'pages', `${p.slug}.html`), p.capture);
  }
  for (const [id, map] of Object.entries(encode)) put(join(dir, 'stardust', 'migrate', 'encode', id, 'vocabulary.json'), typeof map === 'string' ? map : JSON.stringify(map));
  for (const [slug, doc] of Object.entries(eds)) put(join(dir, 'stardust', 'eds-schema', `${slug}.json`), JSON.stringify(doc));
  return dir;
}
const runMap = (dir, args = []) => node(dir, [SCRIPT, ...args]);
const readMapping = (dir) => JSON.parse(readFileSync(join(dir, MAPPING), 'utf8'));
const lines = (r) => r.stdout.trimEnd().split('\n');
const sortedKeys = (v) => (Array.isArray(v) ? v.map(sortedKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])])) : v);
const instance = (slug, selector, confidence, source, verified = null) => ({ slug, selector, confidence, source, verified });

// A hub page. Delivered: [heading+text, teaser-grid] · dark [cards with a delivered-only sentence] ·
// [heading, an image-only media block, cards] · [an image-only hero]. Captured: the header nav repeats a
// teaser title; a header note and a footer paragraph carry the class `intro` (outside main).
const HUB_CONTENT = `<html><head><title>A hub page</title></head><body><header></header><main>
<div>
<h1>Welcome to the hub</h1>
<p>Intro paragraph for the hub.</p>
<div class="teaser-grid"><div><div><h3>First teaser</h3><p>Opening card body.</p></div></div><div><div><h3>Second teaser</h3><p>Closing card body.</p></div></div></div>
</div>
<div>
<div class="cards"><div><div><h3>Card heading</h3><p>A card about the harbour.</p><p>Only delivered sentence.</p></div></div></div>
<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>
</div>
<div>
<h2>Gallery heading</h2>
<div class="media"><div><div><picture><img src="a.jpg" alt="A view of the gallery"></picture></div></div></div>
<div class="cards"><div><div><p>Gallery caption text.</p></div></div></div>
</div>
<div>
<div class="hero wide"><div><div><picture><img src="b.jpg" alt=""></picture></div></div></div>
</div>
</main><footer></footer></body></html>`;
const HUB_CAPTURE = `<!doctype html><html><head><title>A hub page</title></head><body>
<header class="site-header"><p class="intro">Header note</p><nav><a href="/">Home</a><a href="/teasers">First teaser</a></nav></header>
<main id="main">
<section class="intro"><h1>Welcome to the hub</h1><p>Intro paragraph for the hub.</p>
<div class="teaser-list"><article class="teaser"><h3>First teaser</h3><p>Opening card body.</p></article><article class="teaser"><h3>Second teaser</h3><p>Closing card body.</p></article></div>
</section>
<section class="cards-band"><div class="card"><h3>Card heading</h3><p>A card about the harbour.</p></div></section>
<section class="gallery"><h2>Gallery heading</h2><figure class="frame"><img src="a.jpg" alt="A view of the gallery"></figure><div class="caption"><p>Gallery caption text.</p></div></section>
<section class="banner"><img src="b.jpg" alt=""></section>
</main>
<footer><p class="intro">Footer text</p></footer>
</body></html>`;
const HUB_EDS = { sections: [{ section: 'intro', items: [{ role: 'heading', order: 0, text: 'Welcome to the hub' }, { role: 'body', order: 1, text: 'Intro paragraph for the hub.' }] }] };
const HUB_PAGE = { slug: 'hub', path: '/hub', templateId: 'hub', content: HUB_CONTENT, capture: HUB_CAPTURE };
const hubProject = (name, opts = {}) => project(name, [HUB_PAGE], { eds: { hub: HUB_EDS }, ...opts });

// Three story pages of one template (none named after it: the first slug represents it). Delivered:
// [heading] · [quote] (two and three only) · [story-body]. Captured: the story body sits in the only
// section.band of main (another one is in the footer) at a varying ordinal; page two's quote carries a
// class, page three's does not.
const storyContent = (n, quote) => `<html><body><main>
<div><h1>Story ${n}</h1></div>
${quote ? `<div><div class="quote"><div><div><p>A quote for story ${n}.</p></div></div></div></div>` : ''}
<div><div class="story-body"><div><div><p>Story ${n} body text.</p><p>More of story ${n}.</p></div></div></div></div>
</main></body></html>`;
const storyCapture = (n, quote) => `<html><body><main><section><h1>Story ${n}</h1></section>${quote
  ? `<section><blockquote${quote === 'classed' ? ' class="pull-quote"' : ''}><p>A quote for story ${n}.</p></blockquote></section>` : ''}<section class="band"><p>Story ${n} body text.</p><p>More of story ${n}.</p></section></main>
<footer><section class="band"><p>Footer band</p></section></footer></body></html>`;
const STORY_PAGES = [
  { slug: 'story-one', path: '/stories/story-one', templateId: 'story', content: storyContent('one', false), capture: storyCapture('one', false) },
  { slug: 'story-two', path: '/stories/story-two', file: 'stories/story-two/index.html', templateId: 'story', content: storyContent('two', true), capture: storyCapture('two', 'classed') },
  { slug: 'story-three', path: '/stories/story-three', templateId: 'story', content: storyContent('three', true), capture: storyCapture('three', 'plain') },
];

let hubDir = null;
let hubRun = null;
check('mapping: one page — instance selectors and confidences by text alignment; sections with anchor, confidence, roles', () => {
  hubDir = hubProject('map-hub');
  hubRun = runMap(hubDir);
  ok(hubRun);
  assert.equal(hubRun.stderr, '');
  const m = readMapping(hubDir);
  assert.equal(m.formatVersion, '0.1.0');
  assert.deepEqual(m.skipped, []);
  assert.deepEqual(m.templates.map((t) => [t.templateId, t.pages]), [['hub', ['hub']]]);
  const [t] = m.templates;
  assert.deepEqual(t.sections, [
    { id: 's1', selector: 'section.intro', pages: ['hub'], style: null, blocks: ['teaser-grid'], defaultContent: ['heading', 'body'], confidence: 1 },
    { id: 's2', selector: 'div.card', pages: ['hub'], style: 'dark', blocks: ['cards'], defaultContent: [], confidence: 0.593 },
    { id: 's3', selector: 'section.gallery', pages: ['hub'], style: null, blocks: ['media', 'cards'], defaultContent: ['heading'], confidence: 1 },
    { id: 's4', selector: null, pages: [], style: null, blocks: ['hero'], defaultContent: [], confidence: 0 },
  ]);
  const text = t.blocks.filter((b) => b.instances.some((i) => i.source === 'text-alignment'));
  assert.deepEqual(text, [
    // the teaser list beats the header nav that repeats its first title
    { block: 'teaser-grid', variant: null, variantId: variantOf('teaser-grid'), section: 's1', instances: [instance('hub', 'div.teaser-list', 1, 'text-alignment')] },
    // cardheading (11) + acardabouttheharbour. (21) of 54: onlydeliveredsentence. (22) is delivered only
    { block: 'cards', variant: null, variantId: variantOf('cards'), section: 's2', instances: [instance('hub', 'div.card', 0.593, 'text-alignment')] },
    { block: 'cards', variant: null, variantId: variantOf('cards'), section: 's3', instances: [instance('hub', 'div.caption p', 1, 'text-alignment')] },
  ]);
  assert.deepEqual(t.blocks.map((b) => `${b.section}:${b.block}`), ['s1:teaser-grid', 's2:cards', 's3:media', 's3:cards', 's4:hero'], 'section order, then first appearance');
});

check('mapping: an image-only block takes its position — the free child after its neighbour, else the next sibling', () => {
  assert.ok(hubDir, 'the one-page run did not happen');
  const t = readMapping(hubDir).templates[0];
  const pos = t.blocks.filter((b) => b.instances.some((i) => i.source === 'position'));
  assert.deepEqual(pos, [
    // section.gallery's children: h2 (the heading's anchor), figure (free), div.caption (the cards' anchor)
    { block: 'media', variant: null, variantId: variantOf('media'), section: 's3', instances: [instance('hub', 'figure.frame', 0, 'position')] },
    // a section without any anchor: the previous anchor's next element sibling, walking up (p → div.caption → section.gallery)
    { block: 'hero', variant: 'wide', variantId: variantOf('hero', ['wide']), section: 's4', instances: [instance('hub', 'section.banner', 0, 'position')] },
  ]);
});

check('mapping: status lines — counts, verified skipped, sources, confidence bands, position fallback, → out (written)', () => {
  assert.ok(hubRun, 'the one-page run did not happen');
  assert.deepEqual(lines(hubRun), [
    'templates 1 · blocks 5 · instances 5 · verified skipped',
    'sources encoder-map 0 · text-alignment 3 · position 2',
    'confidence ≥0.9 2 · 0.5–<0.9 1 · >0–<0.5 0 · 0 2',
    'position fallback: hero ×1, media ×1',
    `→ ${MAPPING} (written)`,
  ]);
});

check('mapping: determinism — a second run is unchanged, bytes identical; keys sorted; generatedAt from coverage', () => {
  assert.ok(hubDir, 'the one-page run did not happen');
  const before = readFileSync(join(hubDir, MAPPING), 'utf8');
  const r = runMap(hubDir);
  ok(r);
  assert.equal(lines(r).at(-1), `→ ${MAPPING} (unchanged)`);
  assert.equal(readFileSync(join(hubDir, MAPPING), 'utf8'), before);
  assert.ok(before.endsWith('}\n'));
  const m = JSON.parse(before);
  assert.equal(before, `${JSON.stringify(sortedKeys(m), null, 2)}\n`, 'object keys sorted at every level, 2-space indent');
  assert.equal(m.generatedAt, GENERATED_AT);
  assert.deepEqual(Object.keys(m), ['formatVersion', 'generatedAt', 'skipped', 'templates']);
  assert.ok(!readdirSync(join(hubDir, 'stardust', 'rollout', 'workspace')).some((f) => f.endsWith('.tmp')), 'no temp file left');
});

check('mapping: --json — one object { status, out, counts, skipped }, verified null without --verify', () => {
  const dir = hubProject('map-json');
  const r = runMap(dir, ['--json']);
  ok(r);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o, {
    status: 'written',
    out: MAPPING,
    counts: {
      templates: 1, blocks: 5, instances: 5, verified: null, verifiedPct: null,
      sources: { 'encoder-map': 0, 'text-alignment': 3, position: 2 },
      confidence: { high: 2, medium: 1, low: 0, none: 2 },
      positionBlocks: { hero: 1, media: 1 },
    },
    skipped: [],
  });
  assert.ok(existsSync(join(dir, MAPPING)), 'the mapping is still written');
});

let storyDir = null;
check('mapping: a template of three pages — sections aligned by signature; the generalised selector drops a varying ordinal', () => {
  storyDir = project('map-story', STORY_PAGES);
  ok(runMap(storyDir));
  const m = readMapping(storyDir);
  assert.deepEqual(m.templates.map((t) => [t.templateId, t.pages]), [['story', ['story-one', 'story-three', 'story-two']]]);
  const [t] = m.templates;
  assert.deepEqual(t.sections, [
    { id: 's1', selector: 'body > main > section:nth-of-type(1) > h1', pages: ['story-one', 'story-three', 'story-two'], style: null, blocks: [], defaultContent: ['heading'], confidence: 1 },
    // the quote section, missing on the representative, goes after the section its predecessor matched
    { id: 's3', selector: 'body > main > section:nth-of-type(2) > blockquote > p', pages: ['story-three', 'story-two'], style: null, blocks: ['quote'], defaultContent: [], confidence: 1 },
    // :nth-of-type(2) on one page, (3) on the others: the ordinal is dropped, the class kept
    { id: 's2', selector: 'body > main > section.band', pages: ['story-one', 'story-three', 'story-two'], style: null, blocks: ['story-body'], defaultContent: [], confidence: 1 },
  ]);
  assert.deepEqual(t.blocks.map((b) => [b.section, b.block]), [['s3', 'quote'], ['s2', 'story-body']]);
  assert.deepEqual(t.blocks[0].instances, [
    instance('story-three', 'body > main > section:nth-of-type(2) > blockquote > p', 1, 'text-alignment'),
    instance('story-two', 'blockquote.pull-quote p', 1, 'text-alignment'),
  ]);
  assert.deepEqual(t.blocks[1].instances, [
    instance('story-one', 'body > main > section.band:nth-of-type(2)', 1, 'text-alignment'),
    instance('story-three', 'body > main > section.band:nth-of-type(3)', 1, 'text-alignment'),
    instance('story-two', 'body > main > section.band:nth-of-type(3)', 1, 'text-alignment'),
  ]);
});

// An encoder map for the hub template: `.intro` also matches outside main#main (header first), cards has
// two occurrences (the k-th block takes the k-th match), media's marker matches nothing.
const HUB_MAP = {
  root: 'main#main',
  markers: [
    { sel: '.intro', kind: 'dark', emitter: 'section-style:dark' },
    { sel: '.intro', kind: 'teaser', emitter: 'block:teaser-grid' },
    { sel: '.teaser-list', kind: 'teaser', emitter: 'block:teaser-grid' },
    { sel: '.card, .caption', kind: 'cards', emitter: 'block:cards' },
    { sel: 'video, audio', kind: 'media', emitter: 'block:media' },
  ],
};

check('mapping: an encoder map marker wins over text alignment (confidence 1): its k-th match under the root, else its raw selector (confidence 0)', () => {
  const dir = hubProject('map-encode', { encode: { hub: HUB_MAP } });
  const r = runMap(dir);
  ok(r);
  const t = readMapping(dir).templates[0];
  assert.deepEqual(t.blocks.map((b) => [b.section, b.block, b.instances.map((i) => [i.selector, i.confidence, i.source])]), [
    ['s1', 'teaser-grid', [['section.intro', 1, 'encoder-map']]],
    ['s2', 'cards', [['div.card', 1, 'encoder-map']]],
    // no match: the raw selector (the root before each alternative) matches nothing on the page, so it is kept
    ['s3', 'media', [['main#main video, main#main audio', 0, 'encoder-map']]],
    ['s3', 'cards', [['div.caption', 1, 'encoder-map']]],
    ['s4', 'hero', [['section.banner', 0, 'position']]],
  ]);
  assert.deepEqual(t.sections.map((s) => [s.id, s.selector, s.confidence]), [['s1', 'section.intro', 1], ['s2', 'div.card', 0.593], ['s3', 'section.gallery', 1], ['s4', null, 0]]);
  assert.equal(lines(r)[1], 'sources encoder-map 4 · text-alignment 0 · position 1');
  assert.equal(lines(r)[2], 'confidence ≥0.9 3 · 0.5–<0.9 0 · >0–<0.5 0 · 0 2');
});

check('mapping: an encoder-map instance without its k-th match never points at another block\'s element (selector null, confidence 0)', () => {
  // two cards blocks, one `.card` under the roots: the second block's raw selector would hit the first's element
  const map = { root: '#main, footer', markers: [{ sel: '.card', emitter: 'block:cards' }, { sel: 'video, audio', emitter: 'block:media' }] };
  const dir = hubProject('map-encode-kth', { encode: { hub: map } });
  const r = runMap(dir, ['--verify']);
  ok(r);
  const t = readMapping(dir).templates[0];
  assert.deepEqual(t.blocks.filter((b) => b.block === 'cards' || b.block === 'media').map((b) => [b.section, b.block, b.instances.map((i) => [i.selector, i.confidence, i.source, i.verified])]), [
    ['s2', 'cards', [['div.card', 1, 'encoder-map', true]]],
    ['s3', 'media', [['#main video, #main audio, footer video, footer audio', 0, 'encoder-map', false]]],
    ['s3', 'cards', [[null, 0, 'encoder-map', false]]],
  ]);
});

check('mapping: --encode <dir>; an unreadable encoder map is ignored with one line (stderr under --json)', () => {
  const dir = project('map-encode-bad', STORY_PAGES);
  put(join(dir, 'stardust', 'import', 'story', 'vocabulary.json'), '{ "root": "main", "markers": ');
  const plain = project('map-encode-none', STORY_PAGES);
  ok(runMap(plain));
  const note = `encoder map ${join('stardust', 'import', 'story', 'vocabulary.json')} is unreadable or has no markers[] — ignored`;
  let r = runMap(dir, ['--encode', 'stardust/import']);
  ok(r);
  assert.equal(lines(r).filter((l) => l === note).length, 1, r.stdout);
  assert.match(lines(r)[0], /^templates 1 · /);
  assert.equal(lines(r).at(-1), `→ ${MAPPING} (written)`);
  assert.equal(readFileSync(join(dir, MAPPING), 'utf8'), readFileSync(join(plain, MAPPING), 'utf8'), 'as without a map');
  put(join(dir, 'stardust', 'import', 'story', 'vocabulary.json'), JSON.stringify({ root: 'main', markers: {} }));
  r = runMap(dir, ['--encode', 'stardust/import', '--json']);
  ok(r);
  assert.equal(JSON.parse(r.stdout).status, 'unchanged');
  assert.equal(r.stderr.trim(), `block-origin: ${note}`);
});

check('mapping: an image-only first block — the next anchor\'s previous element sibling, walking up the ancestors', () => {
  const dir = project('map-first', [{
    slug: 'landing', path: '/landing', templateId: 'landing',
    content: '<main><div><div class="hero"><div><div><picture><img src="h.jpg" alt=""></picture></div></div></div></div><div><h1>Landing title</h1><p>Landing intro text.</p></div></main>',
    capture: '<html><body><main><div class="stage"><img src="h.jpg" alt=""></div><section class="lead"><div class="inner"><h1>Landing title</h1><p>Landing intro text.</p></div></section></main></body></html>',
  }]);
  ok(runMap(dir));
  // the heading+text anchors on div.inner, the first child of its section: up one level, section.lead's previous sibling
  assert.deepEqual(readMapping(dir).templates[0].blocks[0].instances, [instance('landing', 'div.stage', 0, 'position')]);
  // the walk stops at body: head is never a block's origin
  put(join(dir, 'stardust', 'current', 'pages', 'landing.html'), '<html><head><title>Landing</title></head><body><main><h1>Landing title</h1><p>Landing intro text.</p></main></body></html>');
  ok(runMap(dir));
  assert.deepEqual(readMapping(dir).templates[0].blocks[0].instances, [instance('landing', null, 0, 'position')]);
});

// Pages that cannot be mapped, and a coverage block the delivered document no longer has.
const STORY_MAP = { root: 'main', markers: [{ sel: '.pull-quote', kind: 'quote', emitter: 'block:quote' }] };

check('mapping: --verify — one hit true, else false (a marker without its match on one page); without it null and skipped', () => {
  const dir = project('map-verify', STORY_PAGES, { encode: { story: STORY_MAP } });
  let r = runMap(dir);
  ok(r);
  assert.equal(lines(r)[0], 'templates 1 · blocks 2 · instances 5 · verified skipped');
  assert.ok(readMapping(dir).templates[0].blocks.every((b) => b.instances.every((i) => i.verified === null)), 'verified null without --verify');
  r = runMap(dir, ['--verify']);
  ok(r);
  assert.equal(lines(r)[0], 'templates 1 · blocks 2 · instances 5 · verified 80.0 %');
  assert.equal(lines(r).at(-1), `→ ${MAPPING} (written)`);
  const t = readMapping(dir).templates[0];
  assert.deepEqual(t.blocks.map((b) => [b.block, b.instances.map((i) => [i.slug, i.selector, i.source, i.verified, i.confidence])]), [
    ['quote', [['story-three', 'main .pull-quote', 'encoder-map', false, 0], ['story-two', 'blockquote.pull-quote', 'encoder-map', true, 1]]],
    ['story-body', [
      ['story-one', 'body > main > section.band:nth-of-type(2)', 'text-alignment', true, 1],
      ['story-three', 'body > main > section.band:nth-of-type(3)', 'text-alignment', true, 1],
      ['story-two', 'body > main > section.band:nth-of-type(3)', 'text-alignment', true, 1],
    ]],
  ]);
  assert.deepEqual(t.sections.map((s) => [s.id, s.selector, s.pages]), [
    ['s1', 'body > main > section:nth-of-type(1) > h1', ['story-one', 'story-three', 'story-two']],
    ['s3', 'blockquote.pull-quote', ['story-two']],
    ['s2', 'body > main > section.band', ['story-one', 'story-three', 'story-two']],
  ]);
  r = runMap(dir, ['--verify', '--json']);
  ok(r);
  const o = JSON.parse(r.stdout);
  assert.deepEqual([o.status, o.counts.verified, o.counts.verifiedPct, o.counts.sources], ['unchanged', 4, 80, { 'encoder-map': 2, 'text-alignment': 3, position: 0 }]);
  const none = project('map-verify-none', [{ slug: 'plain', path: '/plain', templateId: 'plain', content: '<main><div><h1>Only a heading</h1></div></main>', capture: '<main><h1>Only a heading</h1></main>' }]);
  r = runMap(none, ['--verify']);
  ok(r);
  assert.equal(lines(r)[0], 'templates 1 · blocks 0 · instances 0 · verified n/a');
});

check('verifyMapping: re-reads and re-indexes the captures — a selector gone since mapping is false, section pages recomputed', () => {
  const dir = project('map-verify-fresh', STORY_PAGES);
  const coverage = JSON.parse(readFileSync(join(dir, 'stardust', 'rollout', 'coverage', 'pages.json'), 'utf8'));
  const captures = join(dir, 'stardust', 'current', 'pages');
  const { mapping, have } = bo.buildMapping(coverage, { content: join(dir, 'content'), captures });
  put(join(captures, 'story-two.html'), storyCapture('two', 'classed').replace('<section class="band">', '<section class="band"><h1>Moved</h1></section><section class="band">'));
  bo.verifyMapping(mapping, have, captures);
  const t = mapping.templates[0];
  const body = t.blocks.find((b) => b.block === 'story-body').instances;
  assert.deepEqual(body.map((i) => [i.slug, i.verified]), [['story-one', true], ['story-three', true], ['story-two', true]], 'story-two: :nth-of-type(3) is still one element');
  assert.deepEqual(t.sections.find((s) => s.id === 's2').pages, ['story-one', 'story-three'], 'two section.band in main on story-two now');
  assert.deepEqual(t.sections.find((s) => s.id === 's3').pages, ['story-three', 'story-two']);
  rmSync(join(captures, 'story-three.html'));
  bo.verifyMapping(mapping, have, captures);
  assert.deepEqual(t.blocks.flatMap((b) => b.instances.filter((i) => i.slug === 'story-three').map((i) => i.verified)), [false, false], 'a capture gone: false');
  assert.deepEqual(t.sections.find((s) => s.id === 's3').pages, ['story-two']);
});
const DRIFT_COVERED = '<main><div><div class="hero"><div><div><p>Drift hero text.</p></div></div></div><div class="cards"><div><div><p>Drift card text.</p></div></div></div></div></main>';
const DRIFT_DOCUMENT = '<main><div><div class="hero"><div><div><p>Drift hero text.</p></div></div></div></div></main>';
const SIMPLE = (t) => `<main><div><div class="hero"><div><div><p>${t}</p></div></div></div></div></main>`;
const SKIP_PAGES = [
  { slug: 'no-delivered', path: '/no-delivered', templateId: 'misc', delivered: null, capture: '<p>x</p>' },
  { slug: 'no-content', path: '/no-content', templateId: 'misc', content: SIMPLE('No content'), file: null, capture: '<p>No content</p>' },
  { slug: 'no-capture', path: '/no-capture', templateId: 'misc', content: SIMPLE('No capture') },
  { slug: 'deep', path: '/deep', templateId: 'misc', content: SIMPLE('Deep text'), capture: `<html><body>${'<div>'.repeat(60000)}Deep text</body></html>` },
  { slug: 'drift', path: '/drift', templateId: 'drift', content: DRIFT_COVERED, document: DRIFT_DOCUMENT, capture: '<html><body><main><section class="lead"><p>Drift hero text.</p></section></main></body></html>' },
];

check('mapping: skipped pages and records are recorded; a template left without pages is omitted', () => {
  const dir = project('map-skipped', SKIP_PAGES);
  const r = runMap(dir);
  ok(r);
  const m = readMapping(dir);
  assert.deepEqual(m.skipped, [
    { slug: 'deep', reason: 'capture could not be indexed' },
    { slug: 'drift', block: 'cards', pos: 1, reason: 'not in the delivered document' },
    { slug: 'no-capture', reason: 'no capture' },
    { slug: 'no-content', reason: 'no content file' },
    { slug: 'no-delivered', reason: 'no delivered structure' },
  ]);
  assert.deepEqual(m.templates.map((t) => [t.templateId, t.pages]), [['drift', ['drift']]]);
  assert.deepEqual(m.templates[0].blocks.map((b) => [b.block, b.instances.map((i) => i.selector)]), [['hero', ['section.lead p']]]);
  assert.ok(lines(r).includes('skipped: 5 (capture could not be indexed ×1, no capture ×1, no content file ×1, no delivered structure ×1, not in the delivered document ×1)'), r.stdout);
});

check('mapping: exit 2 on usage, exit 1 on a missing input — nothing written either way', () => {
  const dir = hubProject('map-exit');
  const out = join(dir, MAPPING);
  for (const args of [['--bogus'], ['--out'], ['--coverage', '--json'], ['extra']]) {
    const r = runMap(dir, args);
    ok(r, 2);
    assert.match(r.stderr, /usage: block-origin\.mjs/);
    assert.ok(!existsSync(out), `${args.join(' ')} wrote the mapping`);
  }
  const empty = scratch('map-empty');
  let r = runMap(empty);
  ok(r, 1);
  assert.match(r.stderr, /coverage/);
  assert.deepEqual(readdirSync(empty), [], 'nothing written into an empty project');
  r = runMap(dir, ['--captures', 'nowhere']);
  ok(r, 1);
  assert.match(r.stderr, /--captures nowhere/);
  r = runMap(dir, ['--content', 'nowhere']);
  ok(r, 1);
  const stale = project('map-stale', [HUB_PAGE], { coverage: { formatVersion: '0.0.9', generatedAt: GENERATED_AT, pages: [] } });
  r = runMap(stale);
  ok(r, 1);
  assert.match(r.stderr, /formatVersion/);
  const bare = project('map-bare', [HUB_PAGE], { coverage: { generatedAt: GENERATED_AT, pages: [] } });
  ok(runMap(bare), 1);
  put(join(bare, 'stardust', 'rollout', 'coverage', 'pages.json'), '{ not json');
  ok(runMap(bare), 1);
  assert.ok(!existsSync(out) && !existsSync(join(stale, MAPPING)) && !existsSync(join(bare, MAPPING)));
});

check('mapping: the output validates against schemas/rollout-workspace-mapping.schema.json', () => {
  const schema = loadSchema('rollout-workspace-mapping.schema.json');
  assert.deepEqual(unsupported(schema), [], 'only keywords schema-validate.mjs checks');
  const dirs = [hubDir, storyDir].filter(Boolean);
  assert.equal(dirs.length, 2, 'the one-page and three-page runs did not happen');
  const skippedDir = join(SCRATCH, 'map-skipped');
  for (const d of [...dirs, skippedDir, join(SCRATCH, 'map-encode')]) assert.deepEqual(validate(schema, readMapping(d)), [], d);
  const bad = readMapping(hubDir);
  bad.templates[0].blocks[0].instances[0].source = 'guess';
  bad.templates[0].sections[0].extra = 1;
  assert.equal(validate(schema, bad).length, 2, 'an unknown source and an unknown field are refused');
});

check('mapping: runs from a project copy (stardust/scripts/rollout + stardust/scripts/diff); without diff/ exit 1', () => {
  const dir = hubProject('map-copy');
  const rollout = join(dir, 'stardust', 'scripts', 'rollout');
  mkdirSync(rollout, { recursive: true });
  for (const f of ['block-origin.mjs', 'lib.mjs']) copyFileSync(join(SCRIPTS, f), join(rollout, f));
  let r = node(dir, [join('stardust', 'scripts', 'rollout', 'block-origin.mjs')]);
  ok(r, 1);
  assert.match(r.stderr, /unit-geometry\.mjs/);
  assert.ok(!existsSync(join(dir, MAPPING)), 'nothing written without unit-geometry');
  const diff = join(dir, 'stardust', 'scripts', 'diff');
  mkdirSync(diff, { recursive: true });
  for (const f of readdirSync(DIFF).filter((x) => x.endsWith('.mjs'))) copyFileSync(join(DIFF, f), join(diff, f));
  r = node(dir, [join('stardust', 'scripts', 'rollout', 'block-origin.mjs')]);
  ok(r);
  assert.ok(hubDir, 'the one-page run did not happen');
  assert.equal(readFileSync(join(dir, MAPPING), 'utf8'), readFileSync(join(hubDir, MAPPING), 'utf8'), 'the same mapping as from the plugin tree');
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
