#!/usr/bin/env node
// skills/diff/scripts/test/chrome-explore.test.mjs — the header explorer. Pure: names, control families, the summary
// line. Browser (run from a project with playwright, pngjs and pixelmatch installed; skipped otherwise): the fixture
// headers of chrome-fixtures.mjs explored at 1440 and 390 — the rich one records the hover mega menu and its tabs,
// the click dropdown's close paths, the search typeahead and submit, the cart drawer, the mobile drawer's scroll lock,
// motion and drill-down; an identical copy compares clean, the stock header fails. Hide: --hide / --presence --slug
// parsing and the effective list (pure); the CLI on a header with an in-flow location bar (its own button inside the
// header root) records `hide`, prints the hidden line and never records the bar's button (browser).
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-explore.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { controlKind, effectiveHide, exploreWidth, hideArgs, normName, summarize } from '../chrome-explore.mjs';
import { compareDocs, visualFindings } from '../chrome-compare.mjs';
import { serve } from './chrome-fixtures.mjs';

const EXPLORE = fileURLToPath(new URL('../chrome-explore.mjs', import.meta.url));
const pure = mkdtempSync(join(tmpdir(), 'chrome-explore-pure-'));

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
await check('hideArgs: --hide repeatable comma lists; --presence needs --slug; a flag without its value is a usage error', () => {
  assert.deepEqual(hideArgs(['https://x/', 'o.json', '--hide', '.geo-bar, .promo-strip', '--plain', '--hide', '.geo-bar,,.x']), { hide: ['.geo-bar', '.promo-strip', '.x'], presence: null, slug: null });
  assert.deepEqual(hideArgs(['u', 'o', '--presence', 'p.json', '--slug', 'home']), { hide: [], presence: 'p.json', slug: 'home' });
  assert.deepEqual(hideArgs(['u', 'o', '--width', '1440']), { hide: [], presence: null, slug: null });
  assert.throws(() => hideArgs(['u', 'o', '--presence', 'p.json']), /--presence needs --slug <slug>/);
  assert.throws(() => hideArgs(['u', 'o', '--hide', '--plain']), /--hide needs a selector list/);
  assert.throws(() => hideArgs(['u', 'o', '--hide']), /--hide needs a selector list/);
});
await check('effectiveHide: --hide first, then presence.json "*" and the slug (hide only, not variable), de-duplicated', () => {
  const f = join(pure, 'presence.json');
  writeFileSync(f, JSON.stringify({ '*': { hide: ['.geo-bar'] }, home: { main: 'main', variable: ['.greeting'], hide: ['.promo-strip', '.geo-bar'] } }));
  const e = effectiveHide({ hide: ['.cookie-strip', '.geo-bar'], presence: f, slug: 'home' });
  assert.deepEqual(e.entries, [{ sel: '.cookie-strip', source: '--hide' }, { sel: '.geo-bar', source: '--hide' }, { sel: '.promo-strip', source: 'presence.json' }]);
  assert.equal(e.presence, f); assert.equal(e.found, true);
  assert.deepEqual(effectiveHide({ presence: f, slug: 'other' }).entries, [{ sel: '.geo-bar', source: 'presence.json' }]);
  const none = effectiveHide({ presence: join(pure, 'none.json'), slug: 'home' });
  assert.deepEqual([none.entries, none.found], [[], false]); assert.match(none.note, /not found/);
  assert.deepEqual(effectiveHide({ hide: [] }), { entries: [], presence: null, found: null, note: null });
});
await check('CLI: --presence without --slug exits 1 before any browser or file', () => {
  const r = spawnSync(process.execPath, [EXPLORE, 'http://127.0.0.1:9/', join(pure, 'x.json'), '--presence', join(pure, 'presence.json')], { cwd: pure, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /--presence needs --slug/);
  assert.ok(!existsSync(join(pure, 'x.json')) && !existsSync(join(pure, 'stardust')), 'nothing written');
});
rmSync(pure, { recursive: true });

let pw = null;
// the project's playwright (cwd), else the one beside this copy of the scripts
try { pw = await import(pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('playwright')).href); } catch { try { pw = await import('playwright'); } catch { /* no browser here */ } }
if (pw) pw = pw.chromium ? pw : pw.default;
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
  // the CLI in its own process (async: this process serves the fixture)
  const cli = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [EXPLORE, ...args], { cwd: dir });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
  const names = (d, w) => d.widths[w].controls.map((c) => c.name);
  const geoUrl = `${srv.origin}/geo`;
  await check('geo fixture without a hide: the location bar\'s button is recorded as a header control (what --hide removes)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const gotoFn = async (p, u) => { await p.goto(u, { waitUntil: 'load' }); await p.waitForTimeout(200); };
    const w = await exploreWidth(page, { url: geoUrl, width: 1440, rootSel: null, maxStates: 50, maxDepth: 2, probe: 'shoes', shotsDir: null, settleMs: 150, gotoFn });
    await ctx.close();
    assert.ok(w.controls.some((c) => c.name === 'Change location'), `controls: ${w.controls.map((c) => c.name).join(', ')}`);
    assert.equal('hidden' in w, false);
  });
  const viaFlag = join(dir, 'geo-hide.json');
  const byFlag = await cli([geoUrl, viaFlag, '--hide', '.geo-bar', '--width', '1440,360', '--plain', '--shots', join(dir, 'geo-hide')]);
  await check('CLI --hide .geo-bar: `hide` recorded, the bar\'s button is no header control, About opens in a 72 px header — after reloads too, hidden line per width', () => {
    assert.equal(byFlag.code, 0, byFlag.err);
    const d = JSON.parse(readFileSync(viaFlag, 'utf8'));
    assert.deepEqual(d.hide, { list: ['.geo-bar'], presence: null, perWidth: { 1440: [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }], 360: [{ sel: '.geo-bar', source: '--hide', n: 1, h: 268 }] } });
    assert.equal(d.probe, 'brand', 'the probe term is read from the header with the bar hidden');
    for (const w of [1440, 360]) {
      assert.ok(!names(d, w).includes('Change location'), `${w}: ${names(d, w).join(', ')}`);
      const about = d.widths[w].controls.find((c) => c.name === 'About');
      assert.ok(about && about.actions.click.opened && about.actions.click.panel.links.length === 2, `${w}: About opens on click with 2 links`);
      assert.ok(about.rect[1] < 72, `${w}: About sits in the 72 px header (y ${about.rect[1]})`);
      assert.ok(d.widths[w].loads > 1, `${w}: the page was reloaded (${d.widths[w].loads} loads)`);
      assert.equal(d.widths[w].scroll[0].height, 72, `${w}: the header is 72 px without the bar, after the last reload too`);
      assert.equal('hidden' in d.widths[w], false);
    }
    assert.match(byFlag.out, /^chrome-explore 1440: hidden \.geo-bar ×1 \(88px\) \[--hide\]$/m);
    assert.match(byFlag.out, /^chrome-explore 360: hidden \.geo-bar ×1 \(268px\) \[--hide\]$/m);
  });
  const pf = join(dir, 'presence.json');
  writeFileSync(pf, JSON.stringify({ '*': { hide: ['.geo-bar'] } }));
  const viaPresence = join(dir, 'geo-presence.json');
  const byPresence = await cli([geoUrl, viaPresence, '--presence', pf, '--slug', 'home', '--width', '360', '--probe', 'shoes', '--plain', '--shots', join(dir, 'geo-presence')]);
  await check('CLI --presence {"*": {"hide": [".geo-bar"]}} --slug home: the same at 360, source presence.json; its list matches the --hide record', () => {
    assert.equal(byPresence.code, 0, byPresence.err);
    const d = JSON.parse(readFileSync(viaPresence, 'utf8'));
    assert.deepEqual(d.hide, { list: ['.geo-bar'], presence: pf, perWidth: { 360: [{ sel: '.geo-bar', source: 'presence.json', n: 1, h: 268 }] } });
    assert.ok(!names(d, 360).includes('Change location') && names(d, 360).includes('About'), names(d, 360).join(', '));
    assert.match(byPresence.out, /^chrome-explore 360: hidden \.geo-bar ×1 \(268px\) \[presence\.json\]$/m);
    assert.deepEqual(d.hide.list, JSON.parse(readFileSync(viaFlag, 'utf8')).hide.list);
  });
  await browser.close(); srv.close(); rmSync(dir, { recursive: true });
}
process.exit(failed ? 1 : 0);
