#!/usr/bin/env node
// skills/diff/scripts/test/chrome-explore.test.mjs — the header explorer. Pure: names, control families, the summary
// line. Browser (run from a project with playwright, pngjs and pixelmatch installed; skipped otherwise): the fixture
// headers of chrome-fixtures.mjs explored at 1440 and 390 — the rich one records the hover mega menu and its tabs,
// the click dropdown's close paths, the search typeahead and submit, the cart drawer, the mobile drawer's scroll lock,
// motion and drill-down; an identical copy compares clean, the stock header fails. Hide: --hide / --presence --slug
// parsing and the effective list, with the site-wide stardust/replica/presence.json read by default and merged under
// --presence (pure; a malformed one exits 1 before any browser); the CLI on a header with an in-flow location bar (its
// own button inside the header root) records `hide`, prints the hidden line and never records the bar's button — by
// --hide, by --presence and by the site file alone (browser). Pollution guard: sampleDelta (identical 0, a changed link
// set or image count over the bar, one side closed 1, the crop part skipped without crops), unstableAsWarn (an error on
// an unstable source state, its close paths and its children becomes a warning; stable states, other widths and warnings
// untouched), the `, <n> unstable` summary and the stability line, --bar / --no-repeat parsing (pure); cropRatio as
// chrome-compare counts it, the rich fixture's top-level states repeated on a fresh page and all stable, a header whose
// panel holds hydration placeholder content on its first load only: unstable, re-sampled, settled on the real links,
// named in the header and on stdout; one hydrating 1.8 s after every load: the repeat is visited as the first sample was
// (a quick reload would click before hydration), nothing unstable — and with --no-repeat the skip recorded (browser).
// The --presence and site-file CLI runs pass --no-repeat: they check hide sourcing, the --hide run covers the guard.
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-explore.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { controlKind, cropDeps, cropRatio, effectiveHide, exploreWidth, hideArgs, normName, sampleDelta, stabilityLine, summarize, unstableAsWarn } from '../chrome-explore.mjs';
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
const sample = (links, extra = {}) => ({ opened: true, panel: { links: links.map((h) => ({ text: h.toUpperCase(), href: `/${h}` })), headings: ['Menu'], images: 0, inputs: [], ...extra } });
await check('sampleDelta: identical 0, a changed link set over the bar, a changed image count, one side closed 1; the crop part skipped without crops', () => {
  assert.deepEqual(sampleDelta(sample(['a', 'b', 'c']), sample(['a', 'b', 'c'])), { delta: 0, structural: 0, crop: 'skipped: no crops' });
  // {menu, a, b, c, d}: c and d differ
  assert.deepEqual(sampleDelta(sample(['a', 'b', 'c']), sample(['a', 'b', 'd'])), { delta: 0.4, structural: 0.4, crop: 'skipped: no crops' });
  assert.equal(sampleDelta(sample(['a']), sample(['a'], { images: 1 })).delta, 0.3333);
  assert.equal(sampleDelta(sample(['a']), sample(['a'], { inputs: ['search'] })).delta, 0.3333);
  assert.deepEqual(sampleDelta(sample(['a']), sample(['a']), { cropRatio: 0.05 }), { delta: 0.05, structural: 0, crop: 0.05 });
  assert.deepEqual(sampleDelta(sample(['a']), sample(['a']), { cropRatio: 'pngjs + pixelmatch not installed in this project' }).crop, 'skipped: pngjs + pixelmatch not installed in this project');
  assert.equal(sampleDelta(sample(['a']), null).delta, 1);
  assert.equal(sampleDelta(sample(['a']), { opened: false, navigates: 'http://x/a' }).delta, 1);
});
const open = { opened: true, panel: { links: [], headings: [], images: 0, inputs: [] } };
const marked = { ...open, unstable: { delta: 1, resample: 'agrees', resampleDelta: 0 } };
const srcDoc = { widths: { 1440: { controls: [
  { name: 'Products', kind: 'menu', role: 'toggle', actions: { hover: null, click: marked, key: open }, children: [{ name: 'Tab', kind: 'menu', role: 'toggle', actions: { hover: open } }] },
  { name: 'Help', kind: 'menu', role: 'toggle', actions: { hover: marked, click: open }, children: [{ name: 'Topic', kind: 'menu', role: 'toggle', actions: { click: open } }] },
  { name: '', kind: 'cart', role: 'toggle', actions: { click: marked } },
] }, 390: { controls: [{ name: 'Products', kind: 'menu', role: 'toggle', actions: { click: open } }] } } };
await check('unstableAsWarn: an error on an unstable source state, its close paths and its children becomes a warning; stable states, other widths and warnings untouched', () => {
  const f = (path, action, id, severity = 'error', width = 1440) => ({ width, path, ...(action ? { action } : {}), id, severity, detail: 'd' });
  const findings = [f('Products', 'click', 'panel-content'), f('Products', null, 'close-path'), f('Products > Tab', 'hover', 'state-missing'), f('Products', 'key', 'keyboard'),
    f('Products', 'click', 'panel-content', 'error', 390), f('Products', 'click', 'link-href', 'warn'), f('Help', 'hover', 'motion'), f('Help', null, 'close-path'), f('Help > Topic', 'click', 'state-missing'), f('cart', 'click', 'state-missing')];
  const before = JSON.stringify(findings);
  const out = unstableAsWarn(findings, srcDoc);
  assert.equal(JSON.stringify(findings), before, 'the input is not changed');
  const warned = out.map((x) => (x.unstable ? `${x.width} ${x.path} ${x.action || '-'} ${x.id}` : null)).filter(Boolean);
  // Help's opener (click before hover, as chrome-compare's) is stable: its close paths and children are not the hover state's
  assert.deepEqual(warned, ['1440 Products click panel-content', '1440 Products - close-path', '1440 Products > Tab hover state-missing', '1440 Help hover motion', '1440 cart click state-missing']);
  assert.deepEqual(out[0], { width: 1440, path: 'Products', action: 'click', id: 'panel-content', severity: 'warn', unstable: true, detail: 'd (source state unstable: sampled differently on a fresh page)' });
  assert.deepEqual([out[3], out[4], out[5], out[7], out[8]], [findings[3], findings[4], findings[5], findings[7], findings[8]]);
  assert.deepEqual(unstableAsWarn(findings, { widths: {} }), findings);
});
await check('summarize counts unstable states; stabilityLine names them, the clean check, a crop skip and a guard skip', () => {
  assert.match(summarize(srcDoc).find((l) => l.startsWith('1440:')), /^1440: .*, 3 unstable$/);
  assert.match(summarize(srcDoc).find((l) => l.startsWith('390:')), /depth 1$/);
  assert.equal(stabilityLine({ stability: { bar: 0.02, checked: 3, unstable: ['1440 Products [click]', '390 Menu [key]'] } }), 'UNSTABLE: 2 state(s) sampled differently on a fresh page (1440 Products [click], 390 Menu [key]) — contract findings on them are warnings');
  assert.equal(stabilityLine({ stability: { bar: 0.02, checked: 3, unstable: [] } }), 'stability: 3 top-level state(s) repeated on a fresh page, all within the bar 0.02');
  assert.equal(stabilityLine({ stability: { bar: 0.05, checked: 3, unstable: [], crops: 'skipped: pngjs + pixelmatch not installed in this project' } }), 'stability: 3 top-level state(s) repeated on a fresh page, all within the bar 0.05 (crops skipped: pngjs + pixelmatch not installed in this project)');
  assert.equal(stabilityLine({ stability: 'skipped: --no-repeat' }), 'stability skipped: --no-repeat — first samples were not repeated on a fresh page');
  assert.equal(stabilityLine({ widths: {} }), null);
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
  // site: null — no site-wide file, whatever presence.json the cwd's project carries
  const e = effectiveHide({ hide: ['.cookie-strip', '.geo-bar'], presence: f, slug: 'home', site: null });
  assert.deepEqual(e.entries, [{ sel: '.cookie-strip', source: '--hide' }, { sel: '.geo-bar', source: '--hide' }, { sel: '.promo-strip', source: 'presence.json' }]);
  assert.equal(e.presence, f); assert.equal(e.found, true);
  assert.deepEqual(effectiveHide({ presence: f, slug: 'other', site: null }).entries, [{ sel: '.geo-bar', source: 'presence.json' }]);
  const none = effectiveHide({ presence: join(pure, 'none.json'), slug: 'home', site: null });
  assert.deepEqual([none.entries, none.found], [[], false]); assert.match(none.note, /not found/);
  assert.deepEqual(effectiveHide({ hide: [], site: null }), { entries: [], presence: null, found: null, note: null });
});
await check('CLI: --no-repeat takes no value (the URL after it is read); --bar outside [0, 1] exits 1 before any browser or file', () => {
  const r = spawnSync(process.execPath, [EXPLORE, '--no-repeat', 'http://127.0.0.1:9/', join(pure, 'x.json'), '--bar', '2'], { cwd: pure, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /--bar needs a ratio in \[0, 1\]/);
  assert.ok(!existsSync(join(pure, 'x.json')) && !existsSync(join(pure, 'stardust')), 'nothing written');
});
await check('CLI: --presence without --slug exits 1 before any browser or file', () => {
  const r = spawnSync(process.execPath, [EXPLORE, 'http://127.0.0.1:9/', join(pure, 'x.json'), '--presence', join(pure, 'presence.json')], { cwd: pure, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /--presence needs --slug/);
  assert.ok(!existsSync(join(pure, 'x.json')) && !existsSync(join(pure, 'stardust')), 'nothing written');
});
// a project with the site-wide stardust/replica/presence.json (its own dir: the checks above need a project without one)
const project = join(pure, 'project');
mkdirSync(join(project, 'stardust', 'replica'), { recursive: true });
const siteFile = join(project, 'stardust', 'replica', 'presence.json');
writeFileSync(siteFile, JSON.stringify({ '*': { hide: ['.geo-bar'], reasons: { '.geo-bar': 'location bar' } }, home: { hide: ['.site-strip'], variable: ['.greeting'] } }));
await check('effectiveHide: the site-wide presence.json with no flag ("*"), with --slug (its entry too), under --presence (the gate field wins)', () => {
  assert.deepEqual(hideArgs(['u', 'o', '--slug', 'home']), { hide: [], presence: null, slug: 'home' }, '--slug without --presence');
  const bare = effectiveHide({ site: siteFile });
  assert.deepEqual(bare.entries, [{ sel: '.geo-bar', source: 'site presence.json' }]);
  assert.deepEqual([bare.presence, bare.found, bare.site], [null, true, siteFile]);
  assert.deepEqual(effectiveHide({ slug: 'home', site: siteFile }).entries, [{ sel: '.geo-bar', source: 'site presence.json' }, { sel: '.site-strip', source: 'site presence.json' }]);
  const gate = join(pure, 'gate-presence.json');
  writeFileSync(gate, JSON.stringify({ home: { hide: ['.promo-strip'] } }));
  const merged = effectiveHide({ hide: ['.cookie-strip'], presence: gate, slug: 'home', site: siteFile });
  assert.deepEqual(merged.entries, [{ sel: '.cookie-strip', source: '--hide' }, { sel: '.geo-bar', source: 'site presence.json' }, { sel: '.promo-strip', source: 'presence.json' }]);
  assert.deepEqual([merged.presence, merged.found, merged.site], [gate, true, siteFile]);
  assert.match(merged.note, / over .*→ home: /);
  assert.deepEqual(effectiveHide({ hide: ['.a'], site: join(pure, 'no-site.json') }), { entries: [{ sel: '.a', source: '--hide' }], presence: null, found: null, note: null }, 'no site file: as before');
});
await check('effectiveHide reads stardust/replica/presence.json from the project (cwd) by default', () => {
  const cwd = process.cwd();
  try {
    process.chdir(project);
    const e = effectiveHide(hideArgs(['u', 'o']));
    assert.deepEqual([e.entries, e.site], [[{ sel: '.geo-bar', source: 'site presence.json' }], 'stardust/replica/presence.json']);
  } finally { process.chdir(cwd); }
});
await check('CLI: a malformed site-wide presence.json exits 1 naming it, before any browser or file', () => {
  const broken = join(pure, 'broken');
  mkdirSync(join(broken, 'stardust', 'replica'), { recursive: true });
  writeFileSync(join(broken, 'stardust', 'replica', 'presence.json'), '{"*": {');
  const r = spawnSync(process.execPath, [EXPLORE, 'http://127.0.0.1:9/', join(broken, 'x.json')], { cwd: broken, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /^chrome-explore: presence\.json stardust\/replica\/presence\.json unreadable \(/m);
  assert.ok(!existsSync(join(broken, 'x.json')) && !existsSync(join(broken, 'stardust', '.work')), 'nothing written');
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
      // the pollution guard on the rich record only (it proves the states stable; the copies need not pay for it again)
      doc.widths[width] = await exploreWidth(page, { url: doc.url, width, rootSel: null, maxStates: 400, maxDepth: 4, probe: 'shoes', shotsDir: doc.shots, settleMs: 150, gotoFn, repeat: name === 'rich' });
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
  await check('rich: every top-level open state repeated on a fresh page agrees with its first sample, crops compared — nothing unstable', () => {
    for (const w of [1440, 390]) {
      const st = rich.widths[w].stability;
      const opened = rich.widths[w].controls.reduce((n, c) => n + Object.values(c.actions || {}).filter((x) => x && x.opened).length, 0);
      assert.ok(opened > 3, `${w}: ${opened} top-level states`);
      assert.deepEqual(st, { checked: opened, unstable: [] }, `${w}: crops compared, nothing unstable`);
      const flagged = []; const walk = (cs) => { for (const c of cs || []) { for (const [a, x] of Object.entries(c.actions || {})) if (x && x.unstable) flagged.push(`${c.name} [${a}]`); walk(c.children); } };
      walk(rich.widths[w].controls); assert.deepEqual(flagged, [], `${w}: no state marked`);
    }
    assert.equal('stability' in rich2.widths[1440], false, 'repeat: false runs no guard');
  });
  const deps = await cropDeps();
  if (!deps) console.log('- cropRatio skipped: no pngjs + pixelmatch in this project');
  else {
    await check('cropRatio counts as chrome-compare does: identical 0, half the pixels 0.5, a size difference over the union box', () => {
      const png = (w, h, paint) => { const p = new deps.PNG({ width: w, height: h }); for (let i = 0; i < w * h; i += 1) p.data.set([...paint(i % w), 255], i * 4); return deps.PNG.sync.write(p); };
      const red = png(10, 10, () => [200, 0, 0]);
      assert.equal(cropRatio(red, png(10, 10, () => [200, 0, 0]), deps), 0);
      assert.equal(cropRatio(red, png(10, 10, (x) => (x < 5 ? [200, 0, 0] : [0, 0, 200])), deps), 0.5);
      assert.equal(cropRatio(red, png(10, 20, () => [200, 0, 0]), deps), 0.5);
    });
  }
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
  const byPresence = await cli([geoUrl, viaPresence, '--presence', pf, '--slug', 'home', '--width', '360', '--probe', 'shoes', '--plain', '--no-repeat', '--shots', join(dir, 'geo-presence')]);
  await check('CLI --presence {"*": {"hide": [".geo-bar"]}} --slug home: the same at 360, source presence.json; its list matches the --hide record', () => {
    assert.equal(byPresence.code, 0, byPresence.err);
    const d = JSON.parse(readFileSync(viaPresence, 'utf8'));
    assert.deepEqual(d.hide, { list: ['.geo-bar'], presence: pf, perWidth: { 360: [{ sel: '.geo-bar', source: 'presence.json', n: 1, h: 268 }] } });
    assert.ok(!names(d, 360).includes('Change location') && names(d, 360).includes('About'), names(d, 360).join(', '));
    assert.match(byPresence.out, /^chrome-explore 360: hidden \.geo-bar ×1 \(268px\) \[presence\.json\]$/m);
    assert.deepEqual(d.hide.list, JSON.parse(readFileSync(viaFlag, 'utf8')).hide.list);
  });
  // the same project gains the site-wide presence file: no flag needed any more
  mkdirSync(join(dir, 'stardust', 'replica'), { recursive: true });
  writeFileSync(join(dir, 'stardust', 'replica', 'presence.json'), JSON.stringify({ '*': { hide: ['.geo-bar'] } }));
  const viaSite = join(dir, 'geo-site.json');
  const bySite = await cli([geoUrl, viaSite, '--width', '360', '--probe', 'shoes', '--plain', '--no-repeat', '--shots', join(dir, 'geo-site')]);
  await check('CLI, no hide flag, stardust/replica/presence.json {"*": {"hide": [".geo-bar"]}}: hidden at 360, source site presence.json, the site file recorded', () => {
    assert.equal(bySite.code, 0, bySite.err);
    const d = JSON.parse(readFileSync(viaSite, 'utf8'));
    assert.deepEqual(d.hide, { list: ['.geo-bar'], presence: null, site: 'stardust/replica/presence.json', perWidth: { 360: [{ sel: '.geo-bar', source: 'site presence.json', n: 1, h: 268 }] } });
    assert.ok(!names(d, 360).includes('Change location') && names(d, 360).includes('About'), names(d, 360).join(', '));
    assert.match(bySite.out, /^chrome-explore 360: hidden \.geo-bar ×1 \(268px\) \[site presence\.json\]$/m);
  });
  // the server counts loads per URL: the placeholder panel is on each query's first load only
  const hydrateOut = join(dir, 'hydrate.json');
  const byGuard = await cli([`${srv.origin}/hydrate?run=guard`, hydrateOut, '--width', '1440', '--probe', 'shoes', '--plain', '--shots', join(dir, 'hydrate')]);
  await check('CLI on a header whose panel holds placeholder content on the first load: both states unstable, re-sampled, settled on the real links; the header and stdout name them', () => {
    assert.equal(byGuard.code, 0, byGuard.err);
    const d = JSON.parse(readFileSync(hydrateOut, 'utf8'));
    const products = d.widths[1440].controls.find((c) => c.name === 'Products');
    for (const a of ['click', 'key']) {
      const s = products.actions[a];
      assert.ok(s.unstable && s.unstable.delta > 0.02 && s.unstable.resample === 'agrees' && s.unstable.resampleDelta <= 0.02, `${a}: ${JSON.stringify(s.unstable)}`);
      assert.deepEqual(s.panel.links.map((l) => new URL(l.href).pathname), ['/products/0', '/products/1', '/products/2', '/products/3'], `${a}: the settled sample's links`);
      assert.deepEqual(s.panel.headings, ['Products']);
      assert.ok(s.shot && existsSync(join(dir, 'hydrate', s.shot)), `${a}: the settled crop ${s.shot}`);
    }
    assert.deepEqual(d.stability, { bar: 0.02, checked: 2, unstable: ['1440 Products [click]', '1440 Products [key]'] });
    assert.match(byGuard.out, /^chrome-explore 1440: 1 controls \(1 menu\), 2 states, 4 links, depth 1, 2 unstable$/m);
    assert.match(byGuard.out, /^chrome-explore UNSTABLE: 2 state\(s\) sampled differently on a fresh page \(1440 Products \[click\], 1440 Products \[key\]\) — contract findings on them are warnings$/m);
  });
  const lateOut = join(dir, 'late.json');
  const byLate = await cli([`${srv.origin}/late`, lateOut, '--width', '1440', '--probe', 'shoes', '--plain', '--shots', join(dir, 'late')]);
  await check('CLI on a header hydrating 1.8 s after every load: the repeat\'s fresh page is visited as the first sample\'s was, sees the hydrated panel too — nothing unstable', () => {
    assert.equal(byLate.code, 0, byLate.err);
    const d = JSON.parse(readFileSync(lateOut, 'utf8'));
    const products = d.widths[1440].controls.find((c) => c.name === 'Products');
    for (const a of ['click', 'key']) {
      assert.deepEqual(products.actions[a].panel.headings, ['Products'], `${a}: the hydrated panel`);
      assert.equal('unstable' in products.actions[a], false, `${a}: ${JSON.stringify(products.actions[a].unstable)}`);
    }
    assert.deepEqual(d.stability, { bar: 0.02, checked: 2, unstable: [] });
    assert.match(byLate.out, /^chrome-explore stability: 2 top-level state\(s\) repeated on a fresh page, all within the bar 0\.02$/m);
  });
  const offOut = join(dir, 'hydrate-off.json');
  const byOff = await cli([`${srv.origin}/hydrate?run=off`, offOut, '--no-repeat', '--width', '1440', '--probe', 'shoes', '--plain', '--shots', join(dir, 'hydrate-off')]);
  await check('CLI --no-repeat: the skip is recorded in the header and printed; the placeholder panel stays in the contract, unmarked', () => {
    assert.equal(byOff.code, 0, byOff.err);
    const d = JSON.parse(readFileSync(offOut, 'utf8'));
    assert.equal(d.stability, 'skipped: --no-repeat');
    const s = d.widths[1440].controls.find((c) => c.name === 'Products').actions.click;
    assert.deepEqual([s.panel.headings, 'unstable' in s], [['Loading'], false]);
    assert.match(byOff.out, /^chrome-explore stability skipped: --no-repeat — first samples were not repeated on a fresh page$/m);
  });
  await browser.close(); srv.close(); rmSync(dir, { recursive: true });
}
process.exit(failed ? 1 : 0);
