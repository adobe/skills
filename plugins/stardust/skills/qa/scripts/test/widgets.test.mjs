#!/usr/bin/env node
/**
 * Fixture test for widget counting in the content/templates checks (no network).
 * Run: node skills/qa/scripts/test/widgets.test.mjs
 *
 * An EDS widget is one `/widgets/<path>/<name>.html?<params>` link; the loader
 * renders it as a block named by the file stem. A widget-only page must count as
 * blocked, each link must map to the code file to HEAD, and an ordinary .html or
 * non-widget link must not.
 */
import assert from 'node:assert/strict';
import { parseSections, blockNames, widgetLinks } from '../checks/content.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.log(`FAIL  ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const WIDGET_ONLY = '<div><h1>Search</h1><p><a href="/widgets/search/site-search.html?q=docs&amp;scope=all">Search</a></p></div>';
const MIXED = '<div><div class="hero"><div><h1>Tours</h1></div></div></div><div><p><a href="https://main--site--org.aem.page/widgets/tours/tour-finder.html">Find a tour</a></p>'
  + '<p><a href="/widgets/tours/tour-finder.html?region=eu">Find (EU)</a></p><p><a href="/en/news/story.html">story</a> <a href="/widgets/tours/">folder</a> <a href="/img/widgets/x.png">img</a></p></div>';

check('a widget-only page yields one block named by the file stem; query params ride along on href, not on path', () => {
  const [w] = widgetLinks(WIDGET_ONLY);
  assert.deepEqual(w, { name: 'site-search', href: '/widgets/search/site-search.html?q=docs&scope=all', path: '/widgets/search/site-search.html' });
  assert.equal(blockNames(parseSections(WIDGET_ONLY)).size, 0, 'the markup itself carries no block');
  const names = new Set([...blockNames(parseSections(WIDGET_ONLY)), ...widgetLinks(WIDGET_ONLY).map((x) => x.name)]);
  assert.deepEqual([...names], ['site-search'], 'so the templates check sees a blocked page');
});
check('absolute and relative mounts of one widget dedupe to one code path; plain .html, folder and image links are not widgets', () => {
  assert.deepEqual(widgetLinks(MIXED), [{ name: 'tour-finder', href: 'https://main--site--org.aem.page/widgets/tours/tour-finder.html', path: '/widgets/tours/tour-finder.html' }]);
  assert.deepEqual([...blockNames(parseSections(MIXED))], ['hero']);
});
check('with the site under test known, a widget on another origin is skipped; the same host (any case) is kept', () => {
  const base = 'https://main--site--org.aem.page';
  assert.deepEqual(widgetLinks(MIXED, base).map((w) => w.name), ['tour-finder']);
  assert.deepEqual(widgetLinks('<div><p><a href="https://partner.example/widgets/map/finder.html">Map</a></p></div>', base), []);
  assert.equal(widgetLinks('<div><p><a href="HTTPS://MAIN--SITE--ORG.AEM.PAGE/widgets/map/finder.html">Map</a></p></div>', base).length, 1);
});
check('no widget links: an empty list', () => assert.deepEqual(widgetLinks('<div><p><a href="/about">x</a></p></div>'), []));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
