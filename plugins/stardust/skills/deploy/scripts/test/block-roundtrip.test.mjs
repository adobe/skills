#!/usr/bin/env node
// skills/deploy/scripts/test/block-roundtrip.test.mjs — the pure part of block-roundtrip.mjs: EDS widget
// recognition (a <p> holding only a /widgets/ link or an a[data-widget] is a widget named by its file
// stem, listed as widget:<name>, never a block whose heading/CTA could report MISSING), the --blocks
// split, and --help answering without playwright. No browser, no node_modules.
// Run: node plugins/stardust/skills/deploy/scripts/test/block-roundtrip.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { widgetStem, widgetLinks, splitWidgets } from '../block-roundtrip.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'block-roundtrip.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('widgetStem: file stem of a /widgets/ href, query/hash and extension dropped, nested paths ok', () => {
  assert.equal(widgetStem('/widgets/search/site-search.html?q=docs'), 'site-search');
  assert.equal(widgetStem('/widgets/site-search.html#top'), 'site-search');
  assert.equal(widgetStem('/widgets/a/b/c/store-locator.html'), 'store-locator');
  assert.equal(widgetStem('https://main--site--org.aem.page/widgets/forms/contact.html?lang=en'), 'contact');
  assert.equal(widgetStem('/widgets/search/site-search'), 'site-search');
});
check('widgetStem: non-widget hrefs are null', () => {
  for (const h of ['/about', '/search.html', 'https://example.org/x', '', null, undefined]) assert.equal(widgetStem(h), null, String(h));
});
check('widgetLinks: a lone /widgets/ link in its <p> is a widget named by the stem; blocks and prose are not', () => {
  const main = `
    <div><div class="hero"><div><div><h1>Hi</h1></div></div></div></div>
    <div><h2>Find a store</h2><p><a href="/widgets/locator/store-locator.html?radius=25">Store locator</a></p></div>
    <div><p><a data-widget="search/site-search" href="/widgets/search/site-search.html?q=docs">Search</a></p></div>
    <div><p>Read <a href="/widgets/not/a-mount.html">this</a> later</p></div>
    <div><p><a href="/about">About</a></p></div>`;
  assert.deepEqual(widgetLinks(main), [
    { name: 'store-locator', href: '/widgets/locator/store-locator.html?radius=25' },
    { name: 'site-search', href: '/widgets/search/site-search.html?q=docs' },
  ]);
});
check('widgetLinks: a[data-widget] without a /widgets/ href still counts, named by the data-widget tail', () => {
  assert.deepEqual(widgetLinks('<div><p><a data-widget="chat/support-chat" href="/support">Chat</a></p></div>'), [{ name: 'support-chat', href: '/support' }]);
});
check('widgetLinks: the same href twice lists once; empty input lists nothing', () => {
  const p = '<p><a href="/widgets/search/site-search.html">S</a></p>';
  assert.equal(widgetLinks(`<div>${p}</div><div>${p}</div>`).length, 1);
  assert.deepEqual(widgetLinks(''), []);
  assert.deepEqual(widgetLinks(undefined), []);
});
check('widgetLinks: a /widgets/ link sharing its <p> with another link is NOT a mount (the stock auto-block keeps it a plain link)', () => {
  assert.deepEqual(widgetLinks('<div><p><a href="/widgets/a/x.html">X</a> <a href="/b">B</a></p></div>'), []);
  assert.deepEqual(widgetLinks('<div><p><a href="/b">B</a> <a href="/widgets/a/x.html">X</a></p></div>'), []);
});
check('splitWidgets: --blocks may name a widget; it leaves the block list', () => {
  const widgets = [{ name: 'site-search', href: '/widgets/search/site-search.html' }];
  assert.deepEqual(splitWidgets(['hero', 'site-search', 'cards'], widgets), { blocks: ['hero', 'cards'], widgets: ['site-search'] });
  assert.deepEqual(splitWidgets(['site-search'], widgets), { blocks: [], widgets: ['site-search'] });
  assert.deepEqual(splitWidgets(['hero'], []), { blocks: ['hero'], widgets: [] });
});
check('--help answers before any I/O (no playwright, no browser) and names the widget rule', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /widget:<name>/);
});
process.exit(failed ? 1 : 0);
