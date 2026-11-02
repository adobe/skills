#!/usr/bin/env node
// skills/diff/scripts/test/chrome-explore.test.mjs — the header explorer. Pure: names, control families, the summary
// line, option parsing with its pacing / budget defaults, the per-width request budget. Browser (run from a project with
// playwright, pngjs and pixelmatch installed; skipped otherwise): the fixture headers of chrome-fixtures.mjs explored at
// 1440 and 390 — the rich one records the hover mega menu and its tabs, the click dropdown's close paths, the search
// typeahead and submit, the cart drawer, the mobile drawer's scroll lock, motion and drill-down; an identical copy compares
// clean, the stock header fails. Between controls the header is closed in place (the stock drawer ignores Escape and still
// costs no reload; the stubborn header's dropdowns close on nothing and reload every time); a GET search submit is recorded
// without leaving the page, a POST one is followed; a width whose request budget is spent is cut short and says so; an
// input past the typeahead cap is listed, not typed into.
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-explore.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlKind, exploreWidth, normName, parseArgs, requestBudget, sameSite, summarize } from '../chrome-explore.mjs';
import { compareDocs, visualFindings } from '../chrome-compare.mjs';
import { serve } from './chrome-fixtures.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

await check('normName / controlKind', () => {
  assert.equal(normName('  Shop — Men’s  '), 'shop mens');
  assert.equal(controlKind({ name: 'Open menu', role: 'toggle' }), 'drawer');
  assert.equal(controlKind({ name: 'Warenkorb', role: 'toggle' }), 'cart');
  assert.equal(controlKind({ name: '', role: 'input', type: 'search' }), 'search');
  assert.equal(controlKind({ name: 'Contact', role: 'link' }), 'link');
  assert.equal(controlKind({ name: 'Products', role: 'toggle' }), 'menu');
});
await check('summarize: controls, states, distinct links, depth, truncation', () => {
  const s = { opened: true, panel: { links: [{ text: 'A', href: '/a' }, { text: 'B', href: '/b' }] } };
  const lines = summarize({ widths: { 1440: { controls: [{ role: 'toggle', kind: 'menu', actions: { hover: s, click: s }, children: [{ role: 'toggle', kind: 'menu', actions: { hover: { opened: true, panel: { links: [{ text: 'C', href: '/c' }] } } } }] }, { role: 'link', kind: 'link', actions: {} }], truncated: 'depth 4 at Shop' } } });
  assert.equal(lines[0], '1440: 1 controls (1 menu), 3 states, 3 links, depth 2, TRUNCATED at depth 4 at Shop');
});
await check('summarize: the requests spent, the typeahead cap and the request-budget stop are on the line', () => {
  const [line] = summarize({ widths: { 390: { controls: [], requests: 250, maxRequests: 250, inputsSkipped: 1, truncated: 'request-budget' } } });
  assert.equal(line, '390: 0 controls (none), 0 states, 0 links, depth 0, 250/250 requests, 1 input(s) past --max-typeahead, TRUNCATED at request-budget');
  assert.equal(summarize({ widths: { 1440: { controls: [], requests: 12, maxRequests: 0 } } })[0], '1440: 0 controls (none), 0 states, 0 links, depth 0, 12 requests');
});
await check('parseArgs: pacing, budget and typeahead defaults; the rest as before', () => {
  const o = parseArgs(['https://source.test/', 'out.json']);
  assert.deepEqual([o.url, o.out, o.help, o.plain], ['https://source.test/', 'out.json', false, false]);
  assert.deepEqual([o.paceMs, o.reloadPauseMs, o.maxRequests, o.maxTypeahead], [400, 1500, 600, 2], 'the request budget counts subresources too: 600 leaves room after an image-heavy first load');
  assert.deepEqual([o.widths, o.maxStates, o.maxDepth, o.locale, o.rootSel, o.probe, o.shots, o.warmup], [[1440, 390], 400, 4, 'en-US', null, null, null, null]);
});
await check('parseArgs: explicit values, 0 accepted, a non-number or negative falls back, positionals survive flags around them', () => {
  const o = parseArgs(['--pace-ms', '0', 'https://source.test/', '--max-requests', '40', 'out.json', '--plain', '--reload-pause-ms', 'soon', '--max-typeahead', '-1', '--width', '1024', '--probe', 'boots']);
  assert.deepEqual([o.url, o.out, o.plain, o.probe], ['https://source.test/', 'out.json', true, 'boots']);
  assert.deepEqual([o.paceMs, o.reloadPauseMs, o.maxRequests, o.maxTypeahead, o.widths], [0, 1500, 40, 2, [1024]]);
  assert.equal(parseArgs(['--max-requests', '0']).maxRequests, 0);
  assert.equal(parseArgs(['-h']).help, true); assert.equal(parseArgs(['a', 'b', '--help']).help, true);
  assert.deepEqual([parseArgs(['-h', 'a', 'b']).url, parseArgs(['-h', 'a', 'b']).out], ['a', 'b']);
});
await check('sameSite / requestBudget: the site and its subdomains count, www. aside; exhausted at max; 0 = unlimited; rebase follows a redirect', () => {
  assert.equal(sameSite('source.test', 'https://www.source.test/a'), true);
  assert.equal(sameSite('source.test', 'https://api.source.test/suggest?q=x'), true);
  assert.equal(sameSite('source.test', 'https://cdn.elsewhere.test/x.js'), false);
  assert.equal(sameSite('source.test', 'https://notsource.test/'), false);
  assert.equal(sameSite('source.test', 'data:text/plain,x'), false);
  assert.equal(sameSite('', 'https://source.test/'), false);
  const b = requestBudget('https://www.source.test/', 3);
  assert.equal(b.host, 'source.test');
  assert.equal(b.spend('https://cdn.elsewhere.test/x.js'), false); assert.equal(b.count, 0);
  assert.equal(b.spend('https://www.source.test/'), true); b.spend('https://www.source.test/a.css'); assert.equal(b.exhausted(), false);
  b.spend('https://api.source.test/suggest'); assert.deepEqual([b.count, b.exhausted()], [3, true]);
  b.spend('https://www.source.test/late.js'); assert.deepEqual([b.count, b.exhausted()], [4, true]);
  const open = requestBudget('https://source.test/', 0); for (let i = 0; i < 500; i += 1) open.spend('https://source.test/x'); assert.equal(open.exhausted(), false);
  const moved = requestBudget('https://source.test/', 5); moved.spend('https://source.test/'); moved.rebase('https://moved.test/home'); moved.spend('https://moved.test/a.js');
  assert.deepEqual([moved.host, moved.count], ['moved.test', 2]);
  const same = requestBudget('https://source.test/', 5); same.rebase('https://www.source.test/en/'); assert.equal(same.host, 'source.test');
});

let pw = null;
try { pw = await import(pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')).href); pw = pw.chromium ? pw : pw.default; } catch { /* no browser here */ }
if (!pw) console.log('- browser fixtures skipped: no playwright in this project (run from a project copy)');
else {
  const srv = await serve();
  const dir = mkdtempSync(join(tmpdir(), 'chrome-explore-'));
  const browser = await pw.chromium.launch();
  const gotoFn = async (p, u) => { await p.goto(u, { waitUntil: 'load' }); await p.waitForTimeout(200); };
  // unpaced: the fixtures are local; the pacing itself is a wait, exercised by the defaults test above
  const explore = async (page, url, width, extra = {}) => exploreWidth(page, { url, width, rootSel: null, maxStates: 400, maxDepth: 4, probe: 'shoes', shotsDir: null, settleMs: 150, gotoFn, paceMs: 0, reloadPauseMs: 0, ...extra });
  const withPage = async (width, fn) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 } });
    const page = await ctx.newPage();
    let upstream = 0; page.on('response', (res) => { if (res.url().startsWith(srv.origin) && res.status() !== 204) upstream += 1; });
    const r = await fn(page);
    await ctx.close();
    return { ...r, upstream };
  };
  const record = async (name) => {
    const doc = { url: `${srv.origin}/${name}`, shots: join(dir, name), widths: {} };
    mkdirSync(doc.shots);
    for (const width of [1440, 390]) doc.widths[width] = await withPage(width, (page) => explore(page, doc.url, width, { shotsDir: doc.shots }));
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(doc));
    return doc;
  };
  const [rich, rich2, stock] = [await record('rich'), await record('rich2'), await record('stock')];
  const top = (d, w, n) => d.widths[w].controls.find((c) => c.name === n);
  await check('rich desktop: hover mega menu with a tab level, click dropdown with its close paths, search, cart', () => {
    const shop = top(rich, 1440, 'Shop');
    assert.ok(shop.actions.hover.opened && shop.actions.hover.panel.links.length === 7, 'Shop opens on hover with 7 links');
    assert.ok(shop.actions.hover.motion.some((m) => m.prop === 'opacity' && m.ms === 200), 'the 200 ms fade is recorded');
    const women = (shop.children || []).find((c) => c.name === 'Women');
    assert.ok(women && women.actions.hover.opened && women.actions.click.opened && women.actions.key.opened, 'the Women tab reveals its pane on hover, click and Enter');
    // a tab does not close on a second click: recorded from a page where Men is selected again, not from a left-behind Women
    assert.deepEqual([women.close.outside, women.close.toggle], [true, false]);
    const about = top(rich, 1440, 'About');
    assert.equal(about.actions.click.expanded, 'true');
    assert.deepEqual([about.close.escape, about.close.focusReturn, about.close.outside, about.close.toggle], [true, true, true, true]);
    const search = top(rich, 1440, 'Search').children.find((c) => c.search).search;
    assert.equal(search.typeahead.options, 3); assert.match(search.submit, /\/search\?q=\{q\}$/);
    assert.equal(search.probe, 'shoes');
    const bag = top(rich, 1440, 'Bag'); assert.ok(bag.actions.click.opened && bag.kind === 'cart', 'the cart button, named by its visible label');
  });
  await check('rich mobile: the drawer locks scroll, slides in, drills down; Back is recorded as a return', () => {
    const burger = top(rich, 390, 'Open menu');
    assert.ok(burger.actions.click.scrollLock); assert.ok(burger.actions.click.motion.some((m) => m.prop === 'transform'));
    const shop = burger.children.find((c) => c.name === 'Shop');
    assert.ok(shop.actions.click.opened); assert.ok(shop.children.some((c) => c.name === 'Back' && c.returns));
  });
  await check('the header is closed in place between controls (the stock drawer ignores Escape, its trigger closes it); a GET search submit is answered 204; a left-behind tab selection still reloads', () => {
    for (const w of [1440, 390]) {
      const r = rich.widths[w];
      // every upstream request is a page load (the submit never leaves); the explorer that reloaded per action made 26 here and 24 at 390
      assert.ok(r.loads <= 13, `rich@${w}: ${r.loads} loads`);
      assert.deepEqual([r.requests, r.upstream, r.truncated, r.inputsSkipped], [r.loads, r.loads, null, 0], `rich@${w}`);
      assert.deepEqual([stock.widths[w].loads, stock.widths[w].requests, stock.widths[w].upstream], [1, 1, 1], `stock@${w}`);
    }
    assert.equal(rich.widths[390].loads, 1, 'the drawer resets its own levels on close: the mobile width never reloads');
    assert.ok(rich.widths[1440].loads > 1, 'the mega menu keeps its selected tab (aria-selected) after Escape: the desktop width reloads before the next probe');
    assert.equal(top(stock, 390, 'Open menu').close.escape, false, 'the stock drawer does not close on Escape');
    assert.equal(top(stock, 390, 'Open menu').close.toggle, true, 'and does close on its trigger');
  });
  await check('stubborn header: closing in place fails, so every reset reloads; the record is complete; a POST submit is followed to where it lands', async () => {
    const r = await withPage(1440, (page) => explore(page, `${srv.origin}/stubborn`, 1440, { maxRequests: 0 }));
    const offers = r.controls.find((c) => c.name === 'Offers'); const help = r.controls.find((c) => c.name === 'Help');
    assert.ok(offers.actions.click.opened && offers.actions.key.opened && help.actions.click.opened, 'both dropdowns open');
    assert.deepEqual([offers.close.escape, offers.close.outside, offers.close.toggle, help.close.escape, help.close.toggle], [false, false, false, false, false]);
    assert.deepEqual(offers.actions.click.panel.links.map((l) => l.text), ['New', 'Top']);
    assert.ok(offers.children.some((c) => c.name === 'Close'), 'the Close button inside the list is a child control');
    const find = r.controls.find((c) => c.role === 'input').search;
    assert.equal(find.probe, 'shoes'); assert.match(find.submit, /\/find$/);
    assert.ok(r.loads >= 4, `reloads happened (${r.loads} loads)`);
    // the loads plus the followed POST: every upstream request counted, none truncating at max 0
    assert.deepEqual([r.requests, r.upstream, r.truncated, r.maxRequests], [r.loads + 1, r.loads + 1, null, 0]);
  });
  await check('request budget: the width stops once the count reaches --max-requests and says so; the count stays honest', async () => {
    const r = await withPage(1440, (page) => explore(page, `${srv.origin}/stubborn`, 1440, { maxRequests: 3 }));
    // the first load (1), the reloads before Offers' Enter (2) and before its Escape probe (3) spend the budget: the close
    // paths after Escape and the children are skipped, Help is never explored; the closing reset reloads once more (4)
    assert.equal(r.truncated, 'request-budget');
    assert.deepEqual(r.controls.map((c) => c.name), ['Brand', 'Offers']);
    const offers = r.controls[1];
    assert.deepEqual([offers.close.escape, offers.close.outside, offers.close.toggle, offers.children], [false, undefined, undefined, undefined]);
    assert.deepEqual([r.requests, r.upstream, r.loads, r.maxRequests], [4, 4, 4, 3]);
    assert.match(summarize({ widths: { 1440: r } })[0], /, 4\/3 requests, TRUNCATED at request-budget$/);
    const none = await withPage(1440, (page) => explore(page, `${srv.origin}/rich`, 1440, { maxRequests: 1 }));
    assert.deepEqual([none.truncated, none.controls.length, none.requests, none.loads], ['request-budget', 0, 1, 1]);
    assert.equal(none.scroll.length, 4, 'the header is still sampled scrolled');
  });
  await check('typeahead cap: an input past --max-typeahead is listed, not typed into; nothing is asserted about it', async () => {
    const r = await withPage(1440, (page) => explore(page, `${srv.origin}/rich`, 1440, { maxTypeahead: 0 }));
    const input = r.controls.find((c) => c.name === 'Search').children.find((c) => c.role === 'input');
    assert.deepEqual([input.search, input.skipped, r.inputsSkipped, r.truncated], [null, 'typeahead-cap', 1, null]);
    assert.deepEqual([r.requests, r.upstream], [r.loads, r.loads], 'nothing was typed or submitted: every upstream request is a page load');
    assert.match(summarize({ widths: { 1440: r } })[0], /, 1 input\(s\) past --max-typeahead$/);
  });
  await check('identical copy compares clean, crops included; the stock header fails on behaviour, content, motion, crops', async () => {
    const same = compareDocs(rich, rich2);
    assert.deepEqual(same.findings, []);
    assert.deepEqual(await visualFindings(same.visual, { srcDir: rich.shots, buildDir: rich2.shots, bar: 0.02 }), []);
    const bad = compareDocs(rich, stock);
    const ids = new Set(bad.findings.filter((f) => f.severity === 'error').map((f) => f.id));
    for (const id of ['state-missing', 'panel-content', 'keyboard', 'close-path', 'scroll-lock', 'motion', 'control-missing']) assert.ok(ids.has(id), `no ${id}`);
    assert.ok((await visualFindings(bad.visual, { srcDir: rich.shots, buildDir: stock.shots, bar: 0.02 })).length > 0, 'open-state crops differ');
  });
  await browser.close(); srv.close(); rmSync(dir, { recursive: true });
}
process.exit(failed ? 1 : 0);
