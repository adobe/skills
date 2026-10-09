#!/usr/bin/env node
// skills/diff/scripts/test/chrome-explore.test.mjs — the header explorer. Pure: names, control families, the summary
// line. Browser (run from a project with playwright, pngjs and pixelmatch installed; skipped otherwise): the fixture
// headers of chrome-fixtures.mjs explored at 1440 and 390 — the rich one records the hover mega menu and its tabs,
// the click dropdown's close paths, the search typeahead and submit, the cart drawer, the mobile drawer's scroll lock,
// motion and drill-down; an identical copy compares clean, the stock header fails.
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-explore.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlKind, exploreWidth, normName, summarize } from '../chrome-explore.mjs';
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

let pw = null;
try { pw = await import(pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')).href); pw = pw.chromium ? pw : pw.default; } catch { /* no browser here */ }
if (!pw) console.log('- browser fixtures skipped: no playwright in this project (run from a project copy)');
else {
  const srv = await serve();
  const dir = mkdtempSync(join(tmpdir(), 'chrome-explore-'));
  const browser = await pw.chromium.launch();
  const record = async (name) => {
    const doc = { url: `${srv.origin}/${name}`, shots: join(dir, name), widths: {} };
    mkdirSync(doc.shots);
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 } });
      const page = await ctx.newPage();
      const gotoFn = async (p, u) => { await p.goto(u, { waitUntil: 'load' }); await p.waitForTimeout(200); };
      doc.widths[width] = await exploreWidth(page, { url: doc.url, width, rootSel: null, maxStates: 400, maxDepth: 4, probe: 'shoes', shotsDir: doc.shots, settleMs: 150, gotoFn });
      await ctx.close();
    }
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(doc));
    return doc;
  };
  const [rich, rich2, stock] = [await record('rich'), await record('rich2'), await record('stock')];
  const top = (d, w, n) => d.widths[w].controls.find((c) => c.name === n);
  await check('rich desktop: hover mega menu with a tab level, click dropdown with its close paths, search, cart', () => {
    const shop = top(rich, 1440, 'Shop');
    assert.ok(shop.actions.hover.opened && shop.actions.hover.panel.links.length === 7, 'Shop opens on hover with 7 links');
    assert.ok(shop.actions.hover.motion.some((m) => m.prop === 'opacity' && m.ms === 200), 'the 200 ms fade is recorded');
    assert.ok((shop.children || []).some((c) => c.name === 'Women' && c.actions.hover && c.actions.hover.opened), 'the Women tab reveals its pane');
    const about = top(rich, 1440, 'About');
    assert.equal(about.actions.click.expanded, 'true');
    assert.deepEqual([about.close.escape, about.close.focusReturn, about.close.outside, about.close.toggle], [true, true, true, true]);
    const search = top(rich, 1440, 'Search').children.find((c) => c.search).search;
    assert.equal(search.typeahead.options, 3); assert.match(search.submit, /\/search\?q=\{q\}$/);
    const bag = top(rich, 1440, 'Bag'); assert.ok(bag.actions.click.opened && bag.kind === 'cart', 'the cart button, named by its visible label');
  });
  await check('rich mobile: the drawer locks scroll, slides in, drills down; Back is recorded as a return', () => {
    const burger = top(rich, 390, 'Open menu');
    assert.ok(burger.actions.click.scrollLock); assert.ok(burger.actions.click.motion.some((m) => m.prop === 'transform'));
    const shop = burger.children.find((c) => c.name === 'Shop');
    assert.ok(shop.actions.click.opened); assert.ok(shop.children.some((c) => c.name === 'Back' && c.returns));
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
