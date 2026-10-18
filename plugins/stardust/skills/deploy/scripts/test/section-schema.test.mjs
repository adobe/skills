#!/usr/bin/env node
// skills/deploy/scripts/test/section-schema.test.mjs — the --split grouping rule (groupSections) on a tiny
// { tag, attrs, children } tree: sibling containers are one section each, a lone wrapper is unwrapped and its
// prose merged, runs of non-containers between containers are one section each, a marked non-container stands
// alone, script/style are skipped; the in-page copy is groupSections' own source and runs standalone; the exact
// page.evaluate expression, run on a fake DOM, puts every node of an inferred section inside its tagged root
// (a lone content node is wrapped, a lone container is tagged in place), never gathers a section across two
// parents, keeps the old path for real sections, and on a page without <main> suggests --split 'body > *';
// importing the module resolves no inventory, profile or browser module and runs no CLI; --help names --split;
// a --split without a selector is a usage error before any browser work. No browser.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTAINER_TAGS, GROUP_SECTIONS_PAGE_SRC, MARK_ATTRS, groupSections, mapSectionsExpr, splitSummary } from '../section-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'section-schema.mjs');
const run = (args) => spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', timeout: 15000 });

const el = (tag, attrs = {}, children = []) => ({ tag, attrs, children });
const adapter = {
  tagOf: (n) => n.tag,
  childrenOf: (n) => n.children,
  isMarked: (n) => MARK_ATTRS.some((a) => a in n.attrs),
};
const ids = (groups) => groups.map((g) => g.map((n) => n.attrs.id));
const split = (nodes) => ids(groupSections(nodes, adapter));

test('main > three div.band: each container is a section of its own', () => {
  const main = el('main', {}, ['a', 'b', 'c'].map((id) => el('div', { id, class: 'band' }, [el('p')])));
  assert.deepEqual(split(main.children), [['a'], ['b'], ['c']]);
});

test('an article without sections: the lone article is unwrapped and its prose is ONE section', () => {
  const article = el('article', { id: 'art' }, [
    el('h1', { id: 'h1' }), el('p', { id: 'p1' }), el('p', { id: 'p2' }), el('figure', { id: 'fig' }, [el('img')]),
    el('h2', { id: 'h2' }), el('p', { id: 'p3' }), el('ul', { id: 'ul' }, [el('li')]),
  ]);
  assert.deepEqual(split([article]), [['h1', 'p1', 'p2', 'fig', 'h2', 'p3', 'ul']]);
});

test('a run of non-containers on each side of a container: three sections', () => {
  const nodes = [el('h1', { id: 'h1' }), el('p', { id: 'p1' }), el('div', { id: 'band', class: 'band' }, [el('p')]), el('p', { id: 'p2' }), el('p', { id: 'p3' })];
  assert.deepEqual(split(nodes), [['h1', 'p1'], ['band'], ['p2', 'p3']]);
});

test('a marked non-container (figure[data-block]) between paragraphs is its own section', () => {
  const nodes = [el('p', { id: 'p1' }), el('figure', { id: 'fig', 'data-block': 'x' }, [el('img')]), el('p', { id: 'p2' })];
  assert.deepEqual(split(nodes), [['p1'], ['fig'], ['p2']]);
});

test('script and style are skipped — they neither split a run nor stop an unwrap', () => {
  const top = [el('script', { id: 's' }), el('h1', { id: 'h1' }), el('style', { id: 'st' }), el('p', { id: 'p1' }), el('div', { id: 'band' }, [el('p')])];
  assert.deepEqual(split(top), [['h1', 'p1'], ['band']]);
  const wrapped = [el('script'), el('div', { id: 'wrap' }, [el('style'), el('h1', { id: 'h1' }), el('p', { id: 'p1' })]), el('noscript')];
  assert.deepEqual(split(wrapped), [['h1', 'p1']]);
});

test('the unwrap stops at a marked container and at one without element children', () => {
  assert.deepEqual(split([el('div', { id: 'marked', 'data-section': 'hero' }, [el('h1'), el('p')])]), [['marked']]);
  assert.deepEqual(split([el('div', { id: 'empty' }, [])]), [['empty']]);
});

test('the in-page copy is groupSections\' own source and runs with no module scope', () => {
  assert.ok(GROUP_SECTIONS_PAGE_SRC.includes(groupSections.toString()), 'the page must get groupSections itself, not a second copy');
  // eslint-disable-next-line no-new-func
  const inPage = new Function(`return ${GROUP_SECTIONS_PAGE_SRC};`)();
  const nodes = [el('h1', { id: 'h1' }), el('script'), el('p', { id: 'p1' }), el('section', { id: 'sec' }), el('figure', { id: 'fig', 'data-module': 'm' }), el('p', { id: 'p2' })];
  assert.deepEqual(ids(inPage(nodes, adapter)), split(nodes));
  assert.deepEqual(split(nodes), [['h1', 'p1'], ['sec'], ['fig'], ['p2']]);
});

// A minimal DOM: only what mapSections touches, and only the selector forms these tests use.
class FakeText { constructor(text) { this.nodeType = 3; this.textContent = text; this.parent = null; } }
const detach = (n) => { if (n.parent) n.parent.childNodes.splice(n.parent.childNodes.indexOf(n), 1); };
const matchOne = (e, s) => {
  if (s === '*') return true;
  const child = s.match(/^([\w-]+) > \*$/);
  if (child) return !!e.parent && matchOne(e.parent, child[1]);
  if (/^\[[\w-]+\]$/.test(s)) return e.hasAttribute(s.slice(1, -1));
  if (/^\.[\w-]+$/.test(s)) return e.classList.includes(s.slice(1));
  if (/^[\w-]+$/.test(s)) return e.tagName === s.toUpperCase();
  throw new Error(`fake DOM: unsupported selector ${s}`);
};
class FakeEl {
  constructor(tag, attrs, kids) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = new Map(Object.entries(attrs)); this.style = {}; this.parent = null; this.childNodes = []; this.append(...kids); }
  append(...nodes) { for (const n of nodes) { const k = typeof n === 'string' ? new FakeText(n) : n; detach(k); k.parent = this; this.childNodes.push(k); } }
  before(n) { detach(n); n.parent = this.parent; this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 0, n); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get parentElement() { return this.parent; }
  get className() { return this.attrs.get('class') || ''; }
  get classList() { return this.className.split(/\s+/).filter(Boolean); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  hasAttribute(k) { return this.attrs.has(k); }
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
  matches(sel) { return sel.split(',').some((s) => matchOne(this, s.trim())); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return this.children.flatMap((c) => [...(c.matches(sel) ? [c] : []), ...c.querySelectorAll(sel)]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const h = (tag, attrs = {}, ...kids) => new FakeEl(tag, attrs, kids);
// Runs the exact expression main() hands page.evaluate, against a fake document whose <body> holds bodyKids.
const inPage = (bodyKids, splitSel = null) => {
  const html = h('html', {}, h('body', {}, ...bodyKids));
  const [body] = html.children;
  globalThis.document = { body, querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s), createElement: (t) => h(t) };
  // eslint-disable-next-line no-new-func
  try { return { result: new Function(`return ${mapSectionsExpr(splitSel)};`)(), html }; } finally { delete globalThis.document; }
};
// inventory()/editableInventory() scan only the DESCENDANTS of the tagged root, so every node of a section must sit
// strictly inside a <div data-ss-split> wrapper — except a lone container or marked element, tagged in place.
const assertInside = (html, groups) => groups.forEach((g, idx) => {
  const root = html.querySelectorAll('*').find((e) => e.getAttribute('data-ss-idx') === String(idx));
  const [first] = g;
  if (g.length === 1 && (CONTAINER_TAGS.includes(first.tagName.toLowerCase()) || MARK_ATTRS.some((a) => first.hasAttribute(a)))) {
    assert.equal(root, first, `section ${idx}: a lone container is tagged in place`);
    return;
  }
  assert.ok(root && root.hasAttribute('data-ss-split') && root.style.display === 'contents', `section ${idx}: tagged root is not a data-ss-split wrapper`);
  for (const n of g) assert.ok(root !== n && root.contains(n), `section ${idx}: <${n.tagName.toLowerCase()}> is not inside its tagged root`);
});

test('in the page, every node of an inferred section is inside its tagged root: a lone <p> is wrapped, a lone container is tagged in place', () => {
  const [h1, p1, band, fig, p2] = [h('h1', {}, 'Title'), h('p', {}, 'Intro'), h('div', { class: 'band' }, h('p', {}, 'Band')), h('figure', { 'data-block': 'x' }, h('img')), h('p', {}, 'Closing')];
  const { result, html } = inPage([h('main', {}, h('script'), h1, p1, band, fig, p2)]);
  assert.deepEqual(result.split, { selector: 'main > *', inferred: 4 });
  assert.deepEqual(result.sections.map((s) => s.section), ['h1', 'band', 'figure', 'p']);
  assertInside(html, [[h1, p1], [band], [fig], [p2]]);
});

test('in the page, --split given: only the outermost matches inside the root, and a section never spans two parents', () => {
  const [a, b, c, card] = [h('p', {}, 'A'), h('p', {}, 'B'), h('p', {}, 'C'), h('div', { class: 'card' }, h('p', {}, 'inner'))];
  const one = h('div', { class: 'one' }, a, b);
  const two = h('div', { class: 'two' }, c, card);
  const { result, html } = inPage([h('header', {}, h('p', {}, 'outside')), h('main', {}, one, two)], 'p, .card');
  assert.deepEqual(result.split, { selector: 'p, .card', inferred: 3 });
  assert.deepEqual(result.sections.map((s) => s.section), ['p', 'p', 'card']);
  assertInside(html, [[a, b], [c], [card]]);
  assert.ok(one.contains(a) && one.contains(b) && two.contains(c), 'a node was moved to another parent');
});

test('in the page, real sections and no --split: the old path — split null, sections tagged in place', () => {
  const hero = h('section', { class: 'hero' }, h('h1', {}, 'T'));
  const cards = h('div', { 'data-section': 'cards' }, h('p', {}, 'x'));
  const { result, html } = inPage([h('main', {}, hero, cards, h('p', {}, 'tail'))]);
  assert.equal(result.split, null);
  assert.deepEqual(result.sections.map((s) => [s.idx, s.section]), [[0, 'hero'], [1, 'cards']]);
  assert.deepEqual([hero.getAttribute('data-ss-idx'), cards.getAttribute('data-ss-idx')], ['0', '1']);
  assert.equal(html.querySelectorAll('[data-ss-split]').length, 0);
});

test('a page without <main>: the default split infers 0 sections and the summary suggests --split \'body > *\'', () => {
  const { result } = inPage([h('h1', {}, 'T'), h('p', {}, 'x')]);
  assert.deepEqual(result.split, { selector: 'main > *', inferred: 0 });
  assert.equal(splitSummary(result.split, { given: false, root: result.root }), 'inferred 0 section(s) from --split \'main > *\' (no <main> in the page — try --split \'body > *\')');
  assert.equal(splitSummary({ selector: 'main > *', inferred: 3 }, { given: false, root: 'main' }), 'inferred 3 section(s) from --split \'main > *\' (no <section> in <main>)');
  assert.equal(splitSummary({ selector: 'p', inferred: 2 }, { given: true, root: 'main' }), 'inferred 2 section(s) from --split \'p\' (--split given)');
  assert.equal(splitSummary(null, { given: false, root: 'main' }), null);
});

test('importing the module resolves only node builtins: no inventory, profile or browser module', async (t) => {
  const { registerHooks } = await import('node:module');
  if (typeof registerHooks !== 'function') { t.skip('module.registerHooks needs Node >= 22.15'); return; }
  const url = pathToFileURL(SCRIPT).href;
  const probe = `import { registerHooks } from 'node:module';
const seen = [];
registerHooks({ resolve(s, c, next) { seen.push(s); return next(s, c); } });
await import(${JSON.stringify(url)});
console.log(JSON.stringify(seen));`;
  const r = run(['--input-type=module', '-e', probe]);
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout).filter((s) => s !== url);
  assert.deepEqual(seen.filter((s) => !/^(node:)?(fs|path|url)$/.test(s)), []);
});

test('importing the module loads no browser and runs no CLI: a bare import exits 0 silently', () => {
  const r = run(['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout + r.stderr, '');
});

test('--help / -h: exit 0, usage names --split and its default', () => {
  for (const flag of ['--help', '-h']) {
    const r = run([SCRIPT, flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--split <sel>/);
    assert.match(r.stdout, /main > \*/);
  }
});

test('--split without a selector is a usage error (exit 1) before any browser work', () => {
  const r = run([SCRIPT, 'http://example.com/', '--split']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /--split/);
  assert.doesNotMatch(r.stderr, /playwright/i);
});
