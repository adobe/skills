#!/usr/bin/env node
// chrome-states.mjs contract test — pure halves always; browser cases when
// Playwright resolves (STARDUST_PW_ROOT=<dir with node_modules>, or the cwd).
//
// Pure (no browser):
//   --help exits 0 and names --from-state / --live-cache / --tolerance; an unknown
//     flag exits 1; a trailing value flag is refused ("needs a value", exit 1);
//   pairStates: a live cell with a panel and no build trigger of that text is
//     MISSING, a build-only panel is EXTRA, a live plain link is neither;
//   clusterVariants: two identities differing in nav background are two variants;
//   linkSetCheck: model ⊇ flat links → panel-only list, a flat link outside the
//     model is reported (enumeration gap); samplesFromState: one URL per type;
//   compareCells (B30 defect fixture): live opens on hover, build on click →
//     the cell PASSES with a WARN and a `trigger` field — never `delta`; a panel
//     rect delta still is a delta; cacheKey ignores the sample list (superset
//     cache — the documented second command without --from-state hits the cache);
//   --json <url>: a URL after --json stays the build positional (only *.json
//     is the report path).
// Browser (fixtures/chrome-states: two hover mega-menus whose panels live
// OUTSIDE the <li> paired by aria-controls, a click toggle, a search dialog,
// a 360-px drawer with one drill level + Back bar, footer details/summary; the
// build lacks one panel and sets a 12/18 item font where live has 16/24):
//   live-only  → exit 0; ≥ 4 triggers; both hover panels associated via
//                aria-controls; the search control is a `search` cell; the
//                nav model reports the panel links as panel-only and no flat
//                nav link is missing from it; the mobile pass records the
//                drawer, the drilled level (back bar) and a footer accordion;
//   live+build → exit 2 (the BLOCKING branch): `menu:Claims` is `missing on
//                build`, `menu:Insurance` is a delta (fontSize / CROP), the
//                live side comes from the cache written by the first run
//                (one live navigation per breakpoint — hit minimisation);
//   hash toggles (fixtures/chrome-states/hash: two `<a href="#" aria-expanded>`
//                triggers whose click adds a hash — a same-document navigation)
//                → BOTH probed with a panel, the `scrolled` row recorded, no
//                `navigated` flag and no loop-abort warning (defect fixture:
//                `framenavigated` on the first click dropped the rest); the
//                relative header is not pinnedScrolled; PNG paths are absolute
//                even with a relative --out;
//   --panel      the override names the panel, the trigger is still hovered:
//                Insurance = how 'override' on #mega-insurance, opensOn hover;
//                My account (override hidden) falls through to aria-controls on
//                click; no trigger records `main` (defect fixture: the trigger was
//                never opened and every cell recorded `main` as its panel).
// Usage: node plugins/stardust/evals/lint/chrome-states-smoke.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pwRoot, skipBrowser, stageProjectCopy, serveDir } from './lib/_browser.mjs';

const HERE = import.meta.dirname;
const SCRIPT = resolve(HERE, '..', '..', 'skills', 'replica', 'scripts', 'chrome-states.mjs');
const FIXTURE = join(HERE, 'fixtures', 'chrome-states');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const T0 = Date.now(); const lap = (m) => process.env.CS_TEST_TRACE && console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
const ENV = { ...process.env, STARDUST_CRAWL_LOG: '/nonexistent/_crawl-log.json' };
const run = (args, cwd) => { const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd, env: ENV }); return { status: r.status, out: `${r.stdout}\n${r.stderr}` }; };
// ASYNC for the browser runs: this process serves the fixture, so a blocking
// spawnSync would starve the server and the child's page.goto (recorded: 60 s → exit 1).
const runAsync = (args, cwd) => new Promise((res) => { lap(`run ${args.slice(-6).join(' ')}`); const ch = spawn(process.execPath, args, { cwd, env: ENV }); let out = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { out += d; }); ch.on('close', (status) => { lap(`exit ${status}`); res({ status, out }); }); });

// ---- pure
const help = run([SCRIPT, '--help']);
check(help.status === 0 && /--from-state/.test(help.out) && /--live-cache/.test(help.out) && /--tolerance/.test(help.out) && /124/.test(help.out), 'chrome-states --help must exit 0 and name --from-state, --live-cache, --tolerance and the 124 no-verdict rule');
check(run([SCRIPT, 'https://example.invalid/', '--bogus']).status === 1, 'an unknown flag must exit 1');
const trailing = run([SCRIPT, 'https://example.invalid/', '--width']);
check(trailing.status === 1 && /--width needs a value/.test(trailing.out), 'a trailing value flag is refused with "needs a value" (never swallows the next flag)');
const swallow = run([SCRIPT, 'https://example.invalid/', '--out', '--no-mobile']);
check(swallow.status === 1 && /--out needs a value/.test(swallow.out), 'a value flag followed by another flag is refused, not consumed');
check(run([SCRIPT]).status === 1, 'no <liveURL> must exit 1');

const { pairStates, clusterVariants, linkSetCheck, samplesFromState, cacheKey, variantKeyOf, compareCells, parseArgs } = await import(SCRIPT);
{
  // B30 — hover-vs-click is trigger EVIDENCE (motion pass), never a chrome-cell delta (defect: TRIGGER finding → status delta → exit 2)
  const st = (opensOn) => ({ name: 'menu:Insurance', kind: 'menu', text: 'Insurance', opensOn, panel: { rect: { w: 900, h: 400 }, how: 'aria-controls' }, region: null, png: null });
  const cells = compareCells({ states: [st('hover')] }, { states: [st('click')] }, { tolerance: 1 }, '/nonexistent', 1440);
  check(cells.length === 1 && cells[0].status === 'pass', `hover-vs-click cell must PASS (got ${JSON.stringify(cells[0] && { s: cells[0].status, f: cells[0].findings })})`);
  check(cells[0].findings.every((f) => f.kind === 'WARN') && cells[0].findings.some((f) => /hover.*click/.test(f.msg)), 'the mismatch is said as a WARN naming both triggers');
  check(cells[0].trigger && cells[0].trigger.live === 'hover' && cells[0].trigger.build === 'click', 'the cell records trigger {live, build} for motion-assert');
  // a panel-rect delta is still a delta (crop-compare on absent PNGs is `skipped` → WARN; the PANEL finding gates)
  const withPng = (o, w) => ({ ...st(o), png: '/nonexistent/live.png', clip: { width: w, height: 400 } });
  const d = compareCells({ states: [withPng('hover', 900)] }, { states: [withPng('hover', 700)] }, { tolerance: 1 }, '/nonexistent', 1440);
  check(d[0].status === 'delta' && d[0].findings.some((f) => f.kind === 'PANEL'), `a panel rect delta is still a delta (got ${JSON.stringify(d[0] && { s: d[0].status, f: d[0].findings.map((f) => f.kind) })})`);
  // --json <buildURL>: the URL is the build positional, not the report path
  const a = parseArgs(['node', 'x', 'https://l/', '--json', 'http://127.0.0.1:8801/home.html']);
  check(a.build === 'http://127.0.0.1:8801/home.html' && a.opts.json && a.opts.jsonFile === null, `--json followed by a URL keeps the URL as the build side (got ${JSON.stringify({ b: a.build, f: a.opts.jsonFile })})`);
  const b = parseArgs(['node', 'x', 'https://l/', '--json', 'out/report.json']);
  check(b.opts.jsonFile === 'out/report.json' && !b.build, '--json <file.json> is the report path');
}
{
  const live = [{ name: 'menu:Insurance', text: 'Insurance', panel: { rect: {} }, opensOn: 'hover' }, { name: 'menu:Claims', text: 'Claims', panel: { rect: {} }, opensOn: 'hover' }, { name: 'menu:About us', text: 'About us', panel: null, opensOn: 'none' }];
  const build = [{ name: 'menu:Insurance', text: 'insurance', panel: { rect: {} }, opensOn: 'hover' }, { name: 'menu:Offers', text: 'Offers', panel: { rect: {} }, opensOn: 'click' }];
  const p = pairStates(live, build);
  check(p.paired.length === 1 && p.paired[0].name === 'menu:Insurance', 'pairStates pairs by normalised text (case-insensitive)');
  check(p.missing.length === 1 && p.missing[0].text === 'Claims', 'pairStates: a live panel with no build trigger is MISSING');
  check(p.extra.length === 1 && p.extra[0].text === 'Offers', 'pairStates: a build-only panel is EXTRA');
  check(!p.missing.some((m) => m.text === 'About us'), 'pairStates: a live plain link (no panel) is never MISSING');
}
{
  const id = (bg) => ({ position: 'relative', background: bg, color: 'rgb(0, 0, 0)', logoFill: 'rgb(11, 61, 145)', height: 72, hasSubnavBand: false, footerHeight: 200 });
  const v = clusterVariants([{ url: 'a', identity: id('rgb(255, 255, 255)') }, { url: 'b', identity: id('rgb(255, 255, 255)') }, { url: 'c', identity: id('rgba(0, 0, 0, 0)') }]);
  check(v.length === 2 && v[0].urls.length === 2, 'clusterVariants groups identical nav identities and splits a transparent header into its own variant');
  const k = variantKeyOf(id('x'));
  check(k && 'navPosition' in k && 'headerHeightScrolled' in k && 'hasSubnavBand' in k && 'footerHeight' in k, 'variantKeyOf carries the T18.1 fields');
}
{
  const model = { groups: [{ label: 'Insurance', href: '/insurance/', items: [{ href: '/insurance/home/' }], action: { href: '/insurance/all/' } }], promos: [{ cta: { href: '/news/x/' } }], footerLinks: [] };
  const lc = linkSetCheck(model, [{ href: '/insurance/' }, { href: '/about/' }]);
  check(lc.missingFromModel.length === 1 && lc.missingFromModel[0] === '/about/', 'linkSetCheck reports a flat link absent from the model');
  check(lc.panelOnly.includes('/insurance/home/') && lc.panelOnly.includes('/news/x/'), 'linkSetCheck reports panel-only links (off-DOM at rest)');
}
{
  const s = samplesFromState({ pages: [{ url: 'https://s/', type: 'landing' }, { url: 'https://s/a', type: 'article' }, { url: 'https://s/b', type: 'article' }, { url: 'https://s/c' }] }, 'https://s/');
  check(s.length === 2 && s[0].url === 'https://s/a' && s[1].type === 'untyped', 'samplesFromState: one URL per type, the archetype URL itself excluded');
  const k1 = cacheKey('https://s/', { width: 1440, mobile: 360, noMobile: false }, s); const k2 = cacheKey('https://s/', { width: 1440, mobile: 360, noMobile: true }, s);
  check(JSON.stringify(k1) !== JSON.stringify(k2), 'cacheKey changes with the mobile pass on/off');
  check(JSON.stringify(k1) === JSON.stringify(cacheKey('https://s/', { width: 1440, mobile: 360, noMobile: false }, [])), 'cacheKey ignores the sample list — the --from-state cache serves the gate rounds run without it (defect: key mismatch → 2 live hits per round)');
}
if (failures.length) { console.error(`chrome-states-smoke: ${failures.length} pure failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('chrome-states-smoke: pure cases passed');

// ---- browser
const root = pwRoot();
if (!root) skipBrowser('chrome-states-smoke');
const staged = stageProjectCopy(root, ['chrome-states.mjs', 'chrome-parity.mjs', 'motion-observe.mjs', 'capture-sidecar.mjs', 'crop-compare.mjs', 'run-capped.mjs']);
const work = mkdtempSync(join(tmpdir(), 'chrome-states-test-'));
const srv = await serveDir(FIXTURE);
try {
  const live = `${srv.url}/live/`; const build = `${srv.url}/build/`;
  const out = join(work, 'out'); const cache = join(work, 'chrome-live-states.json'); const json1 = join(work, 'live.json'); const json2 = join(work, 'build.json');
  const r1 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '85', '--', process.execPath, staged.script('chrome-states.mjs'), live, '--out', out, '--live-cache', cache, '--json', json1], staged.dir);
  check(r1.status === 0, `live-only run must exit 0 (got ${r1.status}): ${r1.out.slice(-800)}`);
  const j1 = existsSync(json1) ? JSON.parse(readFileSync(json1, 'utf8')) : null;
  check(j1 && j1.schema === 1 && Array.isArray(j1.cells) && j1.desktop && Array.isArray(j1.variants), 'live-only report has schema 1, cells[], desktop, variants[]');
  if (j1) {
    const kinds = j1.desktop.triggers.map((t) => `${t.kind}:${t.text}`);
    check(j1.desktop.triggers.length >= 4, `≥ 4 triggers enumerated (got ${kinds.join(', ')})`);
    const st = Object.fromEntries(j1.desktop.states.map((s) => [s.name, s]));
    check(st['menu:Insurance'] && st['menu:Insurance'].panel && st['menu:Insurance'].panel.how === 'aria-controls' && st['menu:Insurance'].opensOn === 'hover', `Insurance opens on hover with an aria-controls panel (got ${JSON.stringify(st['menu:Insurance'] && { how: st['menu:Insurance'].panel && st['menu:Insurance'].panel.how, on: st['menu:Insurance'].opensOn })})`);
    check(st['menu:Claims'] && st['menu:Claims'].panel && st['menu:Claims'].panel.how === 'aria-controls', 'Claims panel associated via aria-controls');
    check(st.search && st.search.panel, `the search control is a search cell with a panel (got ${JSON.stringify(st.search && { on: st.search.opensOn, warn: st.search.warn })})`);
    check(st['menu:My account'] && st['menu:My account'].opensOn === 'click', `the click toggle opens on click (got ${JSON.stringify(st['menu:My account'] && st['menu:My account'].opensOn)})`);
    check(st.scrolled && st.scrolled.identity, 'a scrolled identity state is recorded');
    check(j1.linkCheck.panelOnly.includes('/insurance/home/') && j1.linkCheck.panelOnly.includes('/claims/track/'), `panel-only links reported (got ${j1.linkCheck.panelOnly.slice(0, 6).join(', ')})`);
    check(j1.linkCheck.missingFromModel.length === 0, `no flat nav link missing from the model (got ${j1.linkCheck.missingFromModel.join(', ')})`);
    const m = st['menu:Insurance'] && st['menu:Insurance'].model;
    check(m && m.groups.length >= 2 && m.groups.some((g) => g.items.some((it) => it.description)) && m.promos.length === 1 && m.groups.some((g) => g.action), `nav model has ≥ 2 groups with descriptions, an action link and one promo (got ${JSON.stringify(m && { g: m.groups.length, p: m.promos.length })})`);
    check(m && m.groups.some((g) => g.items.some((it) => it.external)), 'nav model flags the external partner link');
    check(j1.navModel && j1.navModel.groups.some((g) => g.label === 'About us' && g.href === '/about/' && !g.items.length) && j1.navModel.groups.some((g) => g.label === 'Insurance' && g.items.length >= 2), 'the merged nav model carries plain top-level items and hangs panel groups under their trigger');
    const ms = Object.fromEntries((j1.mobileSide ? j1.mobileSide.states : []).map((s) => [s.name, s]));
    check(ms.drawer && ms.drawer.panel, `mobile pass records the open drawer (got ${JSON.stringify(Object.keys(ms))})`);
    check(ms['drawer-drilled'] && ms['drawer-drilled'].drawer && ms['drawer-drilled'].drawer.backBar === true, `drilled level detected with a back bar (got ${JSON.stringify(ms['drawer-drilled'] && ms['drawer-drilled'].drawer)})`);
    check(Object.keys(ms).some((k) => k.startsWith('footer-accordion:')), 'a footer accordion cell is recorded at the mobile width');
    check(existsSync(cache), 'the live cache file is written');
    check(st['menu:Insurance'] && st['menu:Insurance'].png && existsSync(st['menu:Insurance'].png) && existsSync(`${st['menu:Insurance'].png}.json`), 'panel PNG + sidecar written for the open state');
  }
  // BLOCKING branch: build lacks the Claims panel + shrinks the item font
  const r2 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '85', '--', process.execPath, staged.script('chrome-states.mjs'), live, build, '--out', out, '--live-cache', cache, '--json', json2], staged.dir);
  check(r2.status === 2, `live+build run must exit 2 (got ${r2.status}): ${r2.out.slice(-800)}`);
  const j2 = existsSync(json2) ? JSON.parse(readFileSync(json2, 'utf8')) : null;
  if (j2) {
    check(j2.liveCache && j2.liveCache.file === cache, 'the second run took the live side from the cache (no second live navigation)');
    const cells = Object.fromEntries(j2.cells.map((c) => [`${c.name}@${c.width}`, c]));
    check(cells['menu:Claims@1440'] && cells['menu:Claims@1440'].status === 'missing', `menu:Claims is missing on build (got ${JSON.stringify(cells['menu:Claims@1440'] && cells['menu:Claims@1440'].status)})`);
    const ins = cells['menu:Insurance@1440'];
    check(ins && ins.status === 'delta' && ins.findings.some((f) => /fontSize|CROP|lineHeight/.test(`${f.kind} ${f.msg}`)), `menu:Insurance is a delta naming fontSize or the crop (got ${JSON.stringify(ins && ins.findings.map((f) => f.kind))})`);
    check(cells['search@1440'] && cells['search@1440'].status === 'pass', `the unchanged search cell passes (got ${JSON.stringify(cells['search@1440'] && { s: cells['search@1440'].status, f: cells['search@1440'].findings })})`);
  }
  // run-capped deadline = no verdict: exit 124 propagates, never 2
  writeFileSync(join(work, 'sleep.mjs'), 'setTimeout(() => {}, 5000);');
  const r3 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '1', '--', process.execPath, join(work, 'sleep.mjs')], staged.dir);
  check(r3.status === 124, `run-capped returns 124 on the deadline (got ${r3.status})`);
  // D1 — hash toggles: a same-document navigation never aborts the trigger loop
  const json3 = join(work, 'hash.json');
  const r4 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '85', '--', process.execPath, staged.script('chrome-states.mjs'), `${srv.url}/hash/`, '--no-mobile', '--out', 'out-hash', '--json', json3], staged.dir);
  check(r4.status === 0, `hash-toggle run must exit 0 (got ${r4.status}): ${r4.out.slice(-600)}`);
  const j3 = existsSync(json3) ? JSON.parse(readFileSync(json3, 'utf8')) : null;
  if (j3) {
    const hs = Object.fromEntries(j3.desktop.states.map((s) => [s.name, s]));
    check(hs['menu:Products'] && hs['menu:Products'].panel && hs['menu:Products'].opensOn === 'click' && !hs['menu:Products'].navigated, `first hash toggle opens on click with a panel and is not flagged navigated (got ${JSON.stringify(hs['menu:Products'] && { on: hs['menu:Products'].opensOn, nav: hs['menu:Products'].navigated, warn: hs['menu:Products'].warn })})`);
    check(hs['menu:Support'] && hs['menu:Support'].panel && hs['menu:Support'].panel.how === 'aria-controls', `the SECOND hash toggle is still probed and paired via aria-controls (got ${JSON.stringify(Object.keys(hs))})`);
    check(hs.scrolled && hs.scrolled.identity, 'the scrolled row is recorded after hash toggles');
    check(!j3.desktop.warnings.some((w) => /navigated/.test(w)), `no loop-abort warning on hash navigation (got ${JSON.stringify(j3.desktop.warnings)})`);
    check(j3.desktop.identity && j3.desktop.identity.pinnedScrolled === false, `a position:relative header scrolled out of view is not pinnedScrolled (got ${JSON.stringify(j3.desktop.identity && j3.desktop.identity.pinnedScrolled)})`);
    check(hs['menu:Products'] && hs['menu:Products'].png && isAbsolute(hs['menu:Products'].png) && existsSync(hs['menu:Products'].png), `PNG paths are absolute with a relative --out (got ${hs['menu:Products'] && hs['menu:Products'].png})`);
  }
  // D2 — --panel override: the trigger is still opened; how:'override' only when that element became visible
  const json4 = join(work, 'override.json');
  const r5 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '85', '--', process.execPath, staged.script('chrome-states.mjs'), live, '--no-mobile', '--panel', '.mega.is-open', '--out', join(work, 'out-override'), '--json', json4], staged.dir);
  check(r5.status === 0, `--panel run must exit 0 (got ${r5.status}): ${r5.out.slice(-600)}`);
  const j4 = existsSync(json4) ? JSON.parse(readFileSync(json4, 'utf8')) : null;
  if (j4) {
    const os = Object.fromEntries(j4.desktop.states.map((s) => [s.name, s]));
    const ins = os['menu:Insurance'];
    check(ins && ins.panel && ins.panel.how === 'override' && ins.panel.id === 'mega-insurance' && ins.opensOn === 'hover', `--panel: Insurance is hovered open and the override panel is recorded as how 'override' (got ${JSON.stringify(ins && { how: ins.panel && ins.panel.how, id: ins.panel && ins.panel.id, on: ins.opensOn })})`);
    const acc = os['menu:My account'];
    check(acc && acc.panel && acc.panel.how === 'aria-controls' && acc.opensOn === 'click', `--panel: a trigger whose override stays hidden falls through the association chain (got ${JSON.stringify(acc && { how: acc.panel && acc.panel.how, on: acc.opensOn })})`);
    check(!j4.desktop.states.some((s) => s.panel && s.panel.tag === 'main'), 'no trigger records <main> as its panel under --panel');
  }
} finally {
  await srv.close();
  staged.cleanup();
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`chrome-states-smoke: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('chrome-states-smoke: browser cases passed');
