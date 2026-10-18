#!/usr/bin/env node
// skills/deploy/scripts/test/section-schema.test.mjs — the --split grouping rule (groupSections) on a tiny
// { tag, attrs, children } tree: sibling containers are one section each, a lone wrapper is unwrapped and its
// prose merged, runs of non-containers between containers are one section each, a marked non-container stands
// alone, script/style are skipped; the in-page copy is groupSections' own source and runs standalone; importing
// the module resolves no inventory, profile or browser module and runs no CLI; --help names --split; a --split without a selector is a usage
// error before any browser work. No browser.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GROUP_SECTIONS_PAGE_SRC, groupSections } from '../section-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'section-schema.mjs');
const run = (args) => spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', timeout: 15000 });

const el = (tag, attrs = {}, children = []) => ({ tag, attrs, children });
const adapter = {
  tagOf: (n) => n.tag,
  childrenOf: (n) => n.children,
  isMarked: (n) => ['data-section', 'data-block', 'data-module'].some((a) => a in n.attrs),
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
