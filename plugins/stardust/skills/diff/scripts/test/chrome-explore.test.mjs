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
// Source cache, paired form, parallel explores (pure): the cache key (16 hex, stable, changed by every shaping input),
// the hit/miss decision (unreadable, other inputs, a crop or the crops dir gone), the record composed from per-width
// records (the single form's fields and order, the earliest `at`, stability and hide records in --width order),
// exploreArgs (--build's two values, --build-only needs --build and not --fresh), browsersPerSlot, exploreAll (every
// explore started before any ends, min(tasks, perSlot) browsers, results in task order, a failure closes them all),
// the paired form's usage errors before any browser or file. Browser: a one-menu header served under two counted paths
// — a paired run explores both sides with one page-read probe, the single form writes the same shape and no cache, a
// second paired run prints `cached` for both source widths and opens no source page (the contract byte-identical), a
// lost crops dir re-explores that width only, --fresh re-explores the source, --build-only keeps the contract's bytes.
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-explore.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browsersPerSlot, cacheMiss, composeDoc, controlKind, cropDeps, cropRatio, cropsOf, effectiveHide, exploreAll, exploreArgs, exploreWidth, hideArgs, normName, readSourceCache, sampleDelta, sourceCachePath, sourceInputs, sourceKey, stabilityLine, summarize, unstableAsWarn } from '../chrome-explore.mjs';
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
const shaping = { url: 'https://x.test/', width: 1440, root: null, hide: [{ sel: '.geo-bar', source: '--hide' }], maxStates: 400, maxDepth: 4, probe: null, locale: 'en-US', tier: 'stealth', bar: 0.02, repeat: true, warmup: null };
await check('sourceKey: 16 hex, the same for the same inputs in any key order, another for every shaping input changed', () => {
  const k = sourceKey(sourceInputs(shaping));
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(sourceKey(sourceInputs({ ...shaping })), k);
  assert.equal(sourceKey(Object.fromEntries(Object.entries(sourceInputs(shaping)).reverse())), k, 'canonical JSON: key order does not count');
  const other = { url: 'https://x.test/b', width: 390, root: 'header', maxStates: 50, maxDepth: 2, probe: 'shoes', locale: 'de-DE', tier: 'plain', bar: 0.05, repeat: false, warmup: 'https://x.test/w' };
  const seen = new Set([k]);
  for (const [field, v] of [...Object.entries(other), ['hide', []], ['hide', [{ sel: '.geo-bar', source: 'presence.json' }]], ['hide', [{ sel: '.promo', source: '--hide' }]]]) {
    const k2 = sourceKey(sourceInputs({ ...shaping, [field]: v }));
    assert.ok(!seen.has(k2), `${field} ${JSON.stringify(v)} changes the key`); seen.add(k2);
  }
  assert.equal(sourceCachePath(k), join('stardust', '.work', 'chrome', `source-${k}.json`));
});
await check('cacheMiss / readSourceCache: a hit needs a parsable file, equal inputs, its crops dir and every crop it names', () => {
  const crops = join(pure, 'source-crops'); mkdirSync(crops);
  writeFileSync(join(crops, '1440-001-Shop-click.png'), 'png');
  const inputs = sourceInputs(shaping);
  const result = { root: 'header', controls: [{ name: 'Shop', actions: { click: { opened: true, shot: '1440-001-Shop-click.png' }, hover: null }, children: [{ name: 'Tab', actions: { hover: { opened: true, shot: null } } }] }], scroll: [], states: 2, truncated: null, loads: 2 };
  const entry = { tool: 'chrome-explore source', key: sourceKey(inputs), at: '2026-10-18T10:00:00.000Z', inputs, crops, probe: 'shop', result };
  assert.deepEqual(cropsOf(result), ['1440-001-Shop-click.png']);
  assert.equal(cacheMiss(entry, inputs), null);
  const file = join(pure, 'source.json'); writeFileSync(file, JSON.stringify(entry));
  assert.deepEqual(readSourceCache(file, inputs), { entry, miss: null });
  assert.equal(cacheMiss(entry, sourceInputs({ ...shaping, maxDepth: 3 })), 'other inputs');
  assert.equal(cacheMiss({ ...entry, probe: null }, inputs), 'unreadable', 'a hit names the term it typed');
  assert.deepEqual(readSourceCache(join(pure, 'none.json'), inputs), { entry: null, miss: 'none' });
  writeFileSync(file, '{"tool": "chrome-explore source", ');
  assert.deepEqual(readSourceCache(file, inputs), { entry: null, miss: 'unreadable' });
  rmSync(join(crops, '1440-001-Shop-click.png'));
  assert.equal(cacheMiss(entry, inputs), 'crop 1440-001-Shop-click.png gone');
  rmSync(crops, { recursive: true });
  assert.equal(cacheMiss(entry, inputs), `crops dir ${crops} gone`);
});
await check('composeDoc: the single form\'s fields in its order; `at` the earliest width\'s; hide records and stability folded in --width order', () => {
  const rec = (states, extra = {}) => ({ root: 'header', controls: [], scroll: [], states, truncated: null, loads: 1, ...extra });
  const hide = { entries: [{ sel: '.geo-bar', source: '--hide' }], presence: null, found: null, note: null };
  const records = [
    { at: '2026-10-18T12:00:00.000Z', result: rec(3, { hidden: [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }], stability: { checked: 2, unstable: ['1440 Shop [click]'], crops: 'skipped: no crops' } }) },
    { at: '2026-10-18T09:00:00.000Z', result: rec(1, { hidden: [], stability: { checked: 1, unstable: ['390 Menu [key]'] } }) },
  ];
  const before = JSON.stringify(records);
  const base = { url: 'https://x.test/', shots: 'stardust/.work/chrome/header-contract', hide, repeat: true, bar: 0.02, probe: 'shop', at: '2026-10-18T13:00:00.000Z' };
  const doc = composeDoc({ ...base, widths: [1440, 390], records });
  assert.equal(JSON.stringify(records), before, 'the records are not changed');
  assert.deepEqual(Object.keys(doc), ['tool', 'url', 'at', 'shots', 'hide', 'stability', 'widths', 'probe']);
  assert.deepEqual([doc.tool, doc.at, doc.probe], ['chrome-explore', '2026-10-18T09:00:00.000Z', 'shop']);
  assert.deepEqual(doc.stability, { bar: 0.02, checked: 3, unstable: ['1440 Shop [click]', '390 Menu [key]'], crops: 'skipped: no crops' });
  assert.deepEqual(doc.hide, { list: ['.geo-bar'], presence: null, perWidth: { 390: [], 1440: [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }] } });
  assert.deepEqual([doc.widths[1440], doc.widths[390]], [rec(3), rec(1)]);
  assert.deepEqual(composeDoc({ ...base, widths: [390, 1440], records: [records[1], records[0]] }).stability.unstable, ['390 Menu [key]', '1440 Shop [click]'], '--width order, whatever the explores finished in');
  assert.equal(JSON.stringify(composeDoc({ ...base, widths: [1440, 390], records })), JSON.stringify(doc), 'deterministic');
  assert.deepEqual(composeDoc({ ...base, hide: { entries: [] }, repeat: false, widths: [], records: [] }), { tool: 'chrome-explore', url: base.url, at: base.at, shots: base.shots, stability: 'skipped: --no-repeat', widths: {} });
});
await check('exploreArgs: the positional pair, --build <url> <out> (two values), --fresh; --build-only needs --build and not --fresh', () => {
  assert.deepEqual(exploreArgs(['https://s/', 'c.json', '--width', '1440', '--plain']), { url: 'https://s/', out: 'c.json', build: null, buildOnly: false, fresh: false });
  assert.deepEqual(exploreArgs(['--fresh', 'https://s/', 'c.json', '--build', 'https://b/', 'b.json', '--no-repeat']), { url: 'https://s/', out: 'c.json', build: { url: 'https://b/', out: 'b.json' }, buildOnly: false, fresh: true });
  assert.deepEqual(exploreArgs(['--build', 'https://b/', 'b.json', '--build-only', 'https://s/', 'c.json', '--probe', 'x']), { url: 'https://s/', out: 'c.json', build: { url: 'https://b/', out: 'b.json' }, buildOnly: true, fresh: false });
  assert.deepEqual(exploreArgs(['https://s/', 'c.json', '--fresh']), { url: 'https://s/', out: 'c.json', build: null, buildOnly: false, fresh: true }, 'the single form takes --fresh (it never reads the cache)');
  assert.throws(() => exploreArgs(['u', 'o', '--build-only']), /--build-only needs --build <build-url> <build\.json>/);
  assert.throws(() => exploreArgs(['u', 'o', '--build', 'https://b/']), /--build needs two values/);
  assert.throws(() => exploreArgs(['u', 'o', '--build', 'https://b/', '--plain']), /--build needs two values/);
  assert.throws(() => exploreArgs(['u', 'o', '--build', 'b', 'b.json', '--build', 'c', 'c.json']), /--build is given once/);
  assert.throws(() => exploreArgs(['u', 'o', '--build', 'b', 'b.json', '--build-only', '--fresh']), /pass one of them/);
});
await check('browsersPerSlot: STARDUST_BROWSERS_PER_SLOT, unset or not a positive integer → 1', () => {
  assert.deepEqual(['3', '1', undefined, '', '0', '2.5', 'x', '-2'].map((v) => browsersPerSlot(v === undefined ? {} : { STARDUST_BROWSERS_PER_SLOT: v })), [3, 1, 1, 1, 1, 1, 1, 1]);
});
await check('exploreAll: every explore starts before any ends, over min(tasks, perSlot) browsers (task i in browser i mod n); results in task order; a failure closes every browser', async () => {
  const run = async (tasks, perSlot, failAt = -1) => {
    const log = []; const browsers = [];
    const launch = async () => { const b = { id: browsers.length + 1, closed: false, close: async () => { b.closed = true; } }; browsers.push(b); return b; };
    const gates = tasks.map(() => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; });
    const done = exploreAll(tasks, {
      perSlot, launch,
      before: async (bs) => { log.push(`before ${bs.length}`); return 'pre'; },
      explore: async (t, b, i, pre) => { log.push(`start ${t}@${b.id}`); await gates[i].p; if (i === failAt) throw new Error(`${t} failed`); log.push(`end ${t}`); return `${t}@${b.id} ${pre}`; },
    });
    await new Promise((r) => { setImmediate(r); });
    const started = log.filter((l) => l.startsWith('start')).length;
    [...gates].reverse().forEach((g) => g.open());
    let result = null; let error = null;
    try { result = await done; } catch (e) { error = e; }
    return { log, started, browsers, result, error };
  };
  const one = await run(['1440', '390'], 1);
  assert.equal(one.started, 2, 'both widths started before either finished');
  assert.deepEqual(one.log, ['before 1', 'start 1440@1', 'start 390@1', 'end 390', 'end 1440']);
  assert.deepEqual(one.result, ['1440@1 pre', '390@1 pre'], 'task order, not completion order');
  assert.deepEqual(one.browsers.map((b) => b.closed), [true]);
  const four = await run(['s1440', 's390', 'b1440', 'b390'], 2);
  assert.equal(four.started, 4);
  assert.deepEqual(four.result, ['s1440@1 pre', 's390@2 pre', 'b1440@1 pre', 'b390@2 pre']);
  assert.deepEqual(four.browsers.map((b) => b.closed), [true, true]);
  assert.equal((await run(['1440', '390'], 3)).browsers.length, 2, 'never more browsers than explores');
  const bad = await run(['1440', '390'], 2, 1);
  assert.match(bad.error.message, /^390 failed$/);
  assert.deepEqual(bad.browsers.map((b) => b.closed), [true, true]);
  assert.deepEqual(await exploreAll([], { perSlot: 2, launch: async () => assert.fail('no browser without an explore'), explore: async () => null }), []);
});
await check('CLI paired form: --build-only without --build, --build with one value, --build-only without the contract (named) or with an unreadable one, one file for both sides, shared crops: exit 1 before any browser or file', () => {
  const run = (args) => spawnSync(process.execPath, [EXPLORE, 'http://127.0.0.1:9/', 'c.json', ...args], { cwd: pure, encoding: 'utf8' });
  const cases = [
    [['--build-only'], /^chrome-explore: --build-only needs --build <build-url> <build\.json>/m],
    [['--build', 'http://127.0.0.1:9/b'], /^chrome-explore: --build needs two values/m],
    [['--build', 'http://127.0.0.1:9/b', 'b.json', '--build-only'], /^chrome-explore: --build-only keeps the source contract c\.json, which does not exist/m],
    [['--build', 'http://127.0.0.1:9/b', './c.json'], /^chrome-explore: the source contract and the build record are one file \(c\.json\)/m],
    [['--build', 'http://127.0.0.1:9/b', 'b.json', '--shots', 'stardust/.work/chrome/b'], /^chrome-explore: the source and build crops would share stardust\/\.work\/chrome\/b/m],
  ];
  for (const [args, re] of cases) { const r = run(args); assert.equal(r.status, 1, args.join(' ')); assert.match(r.stderr, re); }
  writeFileSync(join(pure, 'c.json'), '{"tool": "chrome-explore", ');
  const r = run(['--build', 'http://127.0.0.1:9/b', 'b.json', '--build-only']);
  assert.equal(r.status, 1); assert.match(r.stderr, /^chrome-explore: --build-only: the source contract c\.json is unreadable \(/m);
  assert.equal(readFileSync(join(pure, 'c.json'), 'utf8'), '{"tool": "chrome-explore", ', 'the contract is left as it was');
  assert.ok(!existsSync(join(pure, 'stardust')) && !existsSync(join(pure, 'b.json')), 'nothing written');
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
  // the paired form on a one-menu header served under two paths, every request counted per path: a source width
  // taken from the cache opens no source page
  const MINI = `<!doctype html><html><head><style>body{margin:0;font:16px/1.4 sans-serif} header{height:64px;background:#123;color:#fff} header button,header a{color:inherit;font:inherit;background:none;border:0;padding:8px} main{height:600px}</style></head>
<body><header><nav><button aria-expanded="false" aria-controls="m">Products</button><div id="m" hidden><a href="/p/1">One</a> <a href="/p/2">Two</a></div></nav></header><main>Body</main>
<script>const b = document.querySelector('header button'); const m = document.getElementById('m');
const set = (o) => { m.hidden = !o; b.setAttribute('aria-expanded', String(o)); };
b.addEventListener('click', () => set(m.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) { set(false); b.focus(); } });</script></body></html>`;
  const hits = new Map();
  const mini = createServer((req, res) => {
    const p = req.url.split('?')[0]; hits.set(p, (hits.get(p) || 0) + 1);
    const ok = p === '/src' || p === '/build';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/html' }); res.end(ok ? MINI : 'not here');
  });
  await new Promise((r) => { mini.listen(0, '127.0.0.1', r); });
  const mo = `http://127.0.0.1:${mini.address().port}`;
  const proj = join(dir, 'paired'); mkdirSync(proj);
  const C = join(proj, 'stardust', 'chrome', 'header-contract.json'); const B = join(proj, 'stardust', 'chrome', 'header-build.json');
  const cacheDir = join(proj, 'stardust', '.work', 'chrome');
  const cacheFiles = () => (existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => /^source-[0-9a-f]{16}\.json$/.test(f)).sort() : []);
  const pairedRun = (extra = [], env = {}) => new Promise((resolve) => {
    const before = { src: hits.get('/src') || 0, build: hits.get('/build') || 0 };
    const e = { ...process.env, ...env }; if (!('STARDUST_BROWSERS_PER_SLOT' in env)) delete e.STARDUST_BROWSERS_PER_SLOT;
    const p = spawn(process.execPath, [EXPLORE, `${mo}/src`, 'stardust/chrome/header-contract.json', '--build', `${mo}/build`, 'stardust/chrome/header-build.json', '--width', '1440,390', '--plain', '--no-repeat', ...extra], { cwd: proj, env: e });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err, src: (hits.get('/src') || 0) - before.src, build: (hits.get('/build') || 0) - before.build }));
  });
  const sourceLines = (out) => out.split('\n').filter((l) => l.startsWith('chrome-explore source ') && /: (cached|explored) /.test(l));
  const shotsOf = (d) => { const out = []; const walk = (cs) => { for (const c of cs || []) { for (const s of Object.values(c.actions || {})) if (s && s.shot) out.push(s.shot); walk(c.children); } }; for (const w of Object.values(d.widths)) walk(w.controls); return out; };
  // 2 browsers for 4 explores (a run-bg slot holding two)
  const p1 = await pairedRun([], { STARDUST_BROWSERS_PER_SLOT: '2' });
  const c1 = existsSync(C) ? readFileSync(C, 'utf8') : '';
  await check('paired, cold: both sides explored at both widths, one page-read probe for both, the source widths stored per URL + width, lines in --width order', () => {
    assert.equal(p1.code, 0, p1.err);
    assert.ok(p1.src >= 2 && p1.build >= 2, `requests: source ${p1.src}, build ${p1.build}`);
    const lines = sourceLines(p1.out);
    assert.equal(lines.length, 2, p1.out);
    assert.match(lines[0], /^chrome-explore source 1440: explored → stardust\/\.work\/chrome\/source-[0-9a-f]{16}\.json$/);
    assert.match(lines[1], /^chrome-explore source 390: explored → stardust\/\.work\/chrome\/source-[0-9a-f]{16}\.json$/);
    assert.equal(cacheFiles().length, 2);
    const src = JSON.parse(c1); const bld = JSON.parse(readFileSync(B, 'utf8'));
    assert.deepEqual([src.url, src.shots, bld.url, bld.shots], [`${mo}/src`, 'stardust/.work/chrome/header-contract', `${mo}/build`, 'stardust/.work/chrome/header-build']);
    assert.deepEqual([src.probe, bld.probe], ['products', 'products'], 'the probe is read from the source once and typed on both sides');
    assert.deepEqual(Object.keys(src.widths), ['390', '1440']);
    const products = src.widths[1440].controls.find((c) => c.name === 'Products');
    assert.ok(products && products.actions.click.opened && products.actions.click.panel.links.length === 2, JSON.stringify(src.widths[1440].controls.map((c) => c.name)));
    assert.ok(shotsOf(src).length > 0 && shotsOf(src).every((f) => existsSync(join(proj, src.shots, f))), 'the source crops are in the contract\'s crops dir');
    assert.ok(shotsOf(bld).every((f) => existsSync(join(proj, bld.shots, f))), 'the build crops are in its own');
    assert.match(p1.out, /^chrome-explore source 1440: 1 controls \(1 menu\), 2 states, 2 links, depth 1$/m);
    assert.match(p1.out, /^chrome-explore build 390: 1 controls \(1 menu\), 2 states, 2 links, depth 1$/m);
    assert.match(p1.out, /^→ stardust\/chrome\/header-contract\.json \(crops in stardust\/\.work\/chrome\/header-contract\)$/m);
    assert.match(p1.out, /^→ stardust\/chrome\/header-build\.json \(crops in stardust\/\.work\/chrome\/header-build\)$/m);
  });
  const single = await new Promise((resolve) => {
    const p = spawn(process.execPath, [EXPLORE, `${mo}/src`, 'stardust/chrome/single.json', '--width', '1440,390', '--plain', '--no-repeat'], { cwd: proj });
    let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
  await check('the single form on the same source writes the same record shape and the same widths, unprefixed lines, and no cache', () => {
    assert.equal(single.code, 0, single.err);
    const skeleton = (v) => (Array.isArray(v) ? v.map(skeleton) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skeleton(x)])) : typeof v);
    const a = JSON.parse(readFileSync(join(proj, 'stardust', 'chrome', 'single.json'), 'utf8')); const b = JSON.parse(c1);
    assert.equal(JSON.stringify(skeleton(a)), JSON.stringify(skeleton(b)));
    assert.deepEqual([a.probe, a.widths], [b.probe, b.widths]);
    assert.match(single.out, /^chrome-explore 1440: 1 controls \(1 menu\), 2 states, 2 links, depth 1$/m);
    assert.doesNotMatch(single.out, /chrome-explore (source|build) /);
    assert.equal(cacheFiles().length, 2, 'no cache file of its own');
  });
  const p2 = await pairedRun();
  await check('paired, warm: both source widths cached (no source page opened), the build explored again, the contract byte-identical', () => {
    assert.equal(p2.code, 0, p2.err);
    assert.deepEqual([p2.src, p2.build > 0], [0, true], `requests: source ${p2.src}, build ${p2.build}`);
    const { at } = JSON.parse(c1);
    const lines = sourceLines(p2.out);
    assert.equal(lines.length, 2, p2.out);
    lines.forEach((l, i) => assert.match(l, new RegExp(`^chrome-explore source ${[1440, 390][i]}: cached stardust/\\.work/chrome/source-[0-9a-f]{16}\\.json \\(explored ${at.replace(/\./g, '\\.')}\\) — --fresh re-explores$`)));
    assert.equal(readFileSync(C, 'utf8'), c1);
    assert.ok(JSON.parse(readFileSync(B, 'utf8')).at > at, 'a new build record');
  });
  // the 390 width's crops dir is lost: that width only is explored again
  const k390 = cacheFiles().find((f) => JSON.parse(readFileSync(join(cacheDir, f), 'utf8')).inputs.width === 390);
  rmSync(join(cacheDir, k390.replace(/\.json$/, '')), { recursive: true, force: true });
  const p3 = await pairedRun();
  await check('paired, one width\'s crops dir gone: that width re-explored, the other cached; `at` stays the earliest width\'s', () => {
    assert.equal(p3.code, 0, p3.err);
    const lines = sourceLines(p3.out);
    assert.match(lines[0], /^chrome-explore source 1440: cached /); assert.match(lines[1], /^chrome-explore source 390: explored → /);
    assert.ok(p3.src > 0, 'the source page was opened for 390');
    assert.equal(JSON.parse(readFileSync(C, 'utf8')).at, JSON.parse(c1).at);
  });
  const p4 = await pairedRun(['--fresh']);
  await check('paired --fresh: every source width explored again and its cache overwritten', () => {
    assert.equal(p4.code, 0, p4.err);
    assert.deepEqual(sourceLines(p4.out).map((l) => l.replace(/ → .*/, '')), ['chrome-explore source 1440: explored', 'chrome-explore source 390: explored']);
    assert.ok(p4.src >= 2, `source requests ${p4.src}`);
    assert.equal(cacheFiles().length, 2);
    const at = JSON.parse(readFileSync(C, 'utf8')).at;
    assert.ok(at > JSON.parse(c1).at, 'a new contract');
    assert.ok(cacheFiles().every((f) => JSON.parse(readFileSync(join(cacheDir, f), 'utf8')).at === at), 'both cache entries rewritten');
  });
  const kept = readFileSync(C, 'utf8'); const keptMtime = statSync(C).mtimeMs;
  const p5 = await pairedRun(['--build-only']);
  await check('paired --build-only: the contract kept byte for byte, no source page, the build explored; the kept line names its `at`', () => {
    assert.equal(p5.code, 0, p5.err);
    assert.deepEqual([p5.src, p5.build > 0], [0, true]);
    assert.equal(readFileSync(C, 'utf8'), kept); assert.equal(statSync(C).mtimeMs, keptMtime);
    assert.match(p5.out, new RegExp(`^chrome-explore build-only: source contract stardust/chrome/header-contract\\.json kept \\(explored ${JSON.parse(kept).at.replace(/\./g, '\\.')}\\)$`, 'm'));
    assert.deepEqual(sourceLines(p5.out), []);
    assert.equal(JSON.parse(readFileSync(B, 'utf8')).probe, 'products', 'the contract\'s probe term');
  });
  mini.close();
  await browser.close(); srv.close(); rmSync(dir, { recursive: true });
}
process.exit(failed ? 1 : 0);
