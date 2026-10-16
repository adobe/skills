#!/usr/bin/env node
// skills/replica/scripts/test/cap-probe.test.mjs — the cap-probe.mjs contract. Part (a): the pure
// classification (capped vs fluid, cap origins, kinds, the content cap, the derived probe width, the
// cross-archetype aggregate and register items, the live-vs-build rows, module pairing and the
// verdict), argument parsing and the DESIGN.json merge — no browser. Part (b): end-to-end against
// fixture pages served from this process (a live-like page with a 1920 shell + 1600 article + 1180
// module, a fluid build, a fixed build, a build ending in a pagination list) —
// runs only where playwright is importable, prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCapped, capVia, classifyCaps, deriveProbeWidth, groupPx, aggregateCaps, compareCaps, formatCompare, formatCapture,
  parseArgs, UsageError, mergeDesign, readDesignSizing, MIN_PROBE_WIDTH, pairPlausible, PAIR_WIDTH_RATIO,
} from '../cap-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'cap-probe.mjs');
const root = mkdtempSync(join(tmpdir(), 'cap-probe-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd = root) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd }); return { code: r.status, out: r.stdout, err: r.stderr }; };
// The e2e runs must not block the event loop — the fixture server answers from THIS process.
const runAsync = (args, cwd = root) => new Promise((done) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => done({ code, out, err }));
});

// ---- fixture pass (the shape probePassInPage returns) -----------------------------------------------
// w3 (the 0.9 × probe read) defaults to a scaled width for a full-width box and to w2 for anything narrower — i.e. capped.
const box = (i, o) => { const b = { i, selector: `b${i}`, tag: 'div', w1: 1440, w2: 2560, h2: 500, maxWidth: 'none', boxSizing: 'border-box', padL: 0, padR: 0, parent: null, share: 0, contentBearing: true, inRoot: true, aboveRoot: false, isRoot: false, tier: 1, section: -1, chrome: false, ...o }; if (b.w3 === undefined) b.w3 = b.w2 >= 2552 ? 2304 : b.w2; return b; };
const parent = (i, w2, pad = 0) => ({ i, w2, padL: pad, padR: pad });
// live-like: body(0) > main(1, root) > shell(2, 1920) > article(3, 1600) > inner(4, 1600 inherited) > section container(5, 1180 fixed) ;
// carousel list(6) inset by margins inside a capped parent ; header inner(7) capped chrome ; a 50% column(8)
const livePass = () => ({
  viewport: 2560,
  root: { selector: 'main', isBody: false, leaves: 100, w2: 2560 },
  sections: [{ selector: 'main > div.shell', w: 1920, h: 6000 }],
  boxes: [
    box(0, { selector: 'body', w1: 1440, w2: 2560, tier: -1, aboveRoot: true, inRoot: false, share: 1 }),
    box(1, { selector: 'main', w1: 1440, w2: 2560, tier: 0, isRoot: true, share: 1, parent: parent(0, 2560) }),
    box(2, { selector: 'main > div.shell', w1: 1440, w2: 1920, maxWidth: '1920px', tier: 1, section: 0, share: 0.98, parent: parent(1, 2560) }),
    box(3, { selector: 'main > div.shell > article', w1: 1440, w2: 1600, maxWidth: '1600px', tier: 2, section: 0, share: 0.98, parent: parent(2, 1920) }),
    box(4, { selector: 'article > div.inner', w1: 1440, w2: 1600, tier: 3, section: 0, share: 0.98, parent: parent(3, 1600) }),
    box(5, { selector: 'div.inner > div.container', w1: 1180, w2: 1180, tier: 4, section: 0, share: 0.3, parent: parent(4, 1600) }),
    box(6, { selector: 'div.inner > div.carousel', w1: 1316, w2: 1476, tier: 4, section: 0, share: 0.2, parent: parent(4, 1600) }),
    box(7, { selector: 'header > div.nav', w1: 1200, w2: 1200, maxWidth: '1200px', tier: 1, inRoot: false, chrome: true, share: 0, parent: parent(0, 2560) }),
    box(8, { selector: 'div.inner > div.half', w1: 720, w2: 800, tier: 4, section: 0, share: 0.1, parent: parent(4, 1600) }),
  ],
});
// module-only site: fluid main, four sections, three with a 1280 container, one full-bleed band
const modulePass = () => ({
  viewport: 2560,
  root: { selector: 'main', isBody: false, leaves: 100, w2: 2560 },
  sections: [0, 1, 2, 3].map((k) => ({ selector: `main > section:nth-of-type(${k + 1})`, w: 2560, h: 600 })),
  boxes: [
    box(0, { selector: 'main', w2: 2560, tier: 0, isRoot: true, share: 1 }),
    ...[0, 1, 2].flatMap((k) => [
      box(10 + k, { selector: `main > section:nth-of-type(${k + 1})`, w2: 2560, tier: 1, section: k, share: 0.25, parent: parent(0, 2560) }),
      box(20 + k, { selector: `section:nth-of-type(${k + 1}) > div.container`, w1: 1280, w2: 1280, maxWidth: '1280px', tier: 2, section: k, share: 0.25, parent: parent(10 + k, 2560) }),
    ]),
    box(13, { selector: 'main > section:nth-of-type(4)', w2: 2560, tier: 1, section: 3, share: 0.25, parent: parent(0, 2560) }),
  ],
});
const fluidPass = () => ({ viewport: 2560, root: { selector: 'main', isBody: false, leaves: 50, w2: 2560 }, sections: [{ selector: 'main > div', w: 2560, h: 900 }], boxes: [box(0, { selector: 'main', tier: 0, isRoot: true, share: 1 }), box(1, { selector: 'main > div', tier: 1, section: 0, share: 1, parent: parent(0, 2560) })] });

// ---- (a) pure ------------------------------------------------------------------------------------------
await check('isCapped: full width and a constant share are fluid; max-width and fixed boxes are capped', () => {
  assert.equal(isCapped({ w1: 1296, w2: 2304, w3: 2074 }, 1440, 2560), false, 'a 90% container scales between the wide reads');
  assert.equal(isCapped({ w1: 1440, w2: 1600, w3: 1600 }, 1440, 2560), true, 'same width at both wide reads = capped');
  assert.equal(isCapped({ w1: 1440, w2: 2560 }, 1440, 2560), false);
  assert.equal(isCapped({ w1: 720, w2: 1280 }, 1440, 2560), false, 'width: 50%');
  assert.equal(isCapped({ w1: 1440, w2: 1600 }, 1440, 2560), true, 'max-width 1600');
  assert.equal(isCapped({ w1: 1180, w2: 1180 }, 1440, 2560), true, 'fixed 1180');
  assert.equal(isCapped({ w1: 1440, w2: 1920 }, 1440, 1920), false, 'a probe AT the cap width cannot see it');
});
await check('capVia: max-width (border-box and content-box), fixed, other', () => {
  assert.equal(capVia({ w1: 1440, w2: 1600, maxWidth: '1600px', boxSizing: 'border-box', padL: 0, padR: 0 }), 'max-width');
  assert.equal(capVia({ w1: 1440, w2: 1220, maxWidth: '1180px', boxSizing: 'content-box', padL: 20, padR: 20 }), 'max-width');
  assert.equal(capVia({ w1: 1180, w2: 1180, maxWidth: 'none' }), 'fixed');
  assert.equal(capVia({ w1: 1316, w2: 1476, maxWidth: 'none' }), 'other');
});
await check('classifyCaps: nested shell + content, module column, inherited/inset/chrome/proportional boxes ignored', () => {
  const m = classifyCaps(livePass(), { baseWidth: 1440, probeWidth: 2560 });
  assert.deepEqual(m.origins.map((o) => [o.kind, o.px, o.via]), [['shell', 1920, 'max-width'], ['content', 1600, 'max-width'], ['module', 1180, 'fixed']]);
  assert.equal(m.shellMaxWidth, 1920);
  assert.equal(m.contentMaxWidth, 1600);
  assert.equal(m.contentFrom, 'content');
  assert.equal(m.maxCap, 1920);
  assert.deepEqual(m.modules, [{ index: 0, selector: 'main > div.shell', px: 1180, capSelector: 'div.inner > div.container', capTag: 'div', capRole: null }]);
});
await check('classifyCaps: a module-only site takes the shared module cap; a fluid page has none', () => {
  const m = classifyCaps(modulePass(), { baseWidth: 1440, probeWidth: 2560 });
  assert.equal(m.shellMaxWidth, null);
  assert.equal(m.contentMaxWidth, 1280);
  assert.equal(m.contentFrom, 'module');
  assert.deepEqual(m.modules.map((x) => x.px), [1280, 1280, 1280, null]);
  const f = classifyCaps(fluidPass(), { baseWidth: 1440, probeWidth: 2560 });
  assert.equal(f.contentMaxWidth, null); assert.equal(f.fluid, true);
});
await check('classifyCaps: each module carries its cap element\'s tag and role (null when full-bleed)', () => {
  const pass = modulePass(); Object.assign(pass.boxes.find((b) => b.i === 20), { tag: 'ul', role: 'list' });
  const m = classifyCaps(pass, { baseWidth: 1440, probeWidth: 2560 });
  assert.deepEqual(m.modules.map((x) => [x.capTag, x.capRole]), [['ul', 'list'], ['div', null], ['div', null], [null, null]]);
  assert.deepEqual([m.origins[0].tag, m.origins[0].role], ['ul', 'list']);
});
await check('deriveProbeWidth: max(2560, cap × 1.25); groupPx groups within the tolerance', () => {
  assert.equal(deriveProbeWidth(0), MIN_PROBE_WIDTH);
  assert.equal(deriveProbeWidth(1920), 2560);
  assert.equal(deriveProbeWidth(2400), 3000);
  assert.deepEqual(groupPx([1280, 1290, 944, 1275]), [{ px: 1290, count: 3 }, { px: 944, count: 1 }]);
});
await check('aggregateCaps: agreeing archetypes are consistent; a differing content cap and a single-section module cap are register items', () => {
  const a = classifyCaps(livePass(), { probeWidth: 2560 }); const b = classifyCaps(livePass(), { probeWidth: 2560 });
  const agg = aggregateCaps({ 'https://s/': a, 'https://s/p': b });
  assert.equal(agg.containerMaxWidth, '1600px'); assert.equal(agg.shellMaxWidth, 1920); assert.equal(agg.probeWidth, 2560);
  assert.equal(agg.consistent, true); assert.deepEqual(agg.register, []);
  assert.deepEqual(agg.caps.map((c) => [c.kind, c.px, c.pages.length]), [['shell', 1920, 2], ['content', 1600, 2], ['module', 1180, 2]]);
  const c = classifyCaps(modulePass(), { probeWidth: 2560 });
  const mixed = aggregateCaps({ 'https://s/': a, 'https://s/p': c });
  assert.equal(mixed.consistent, false);
  assert.match(mixed.register[0], /contentMaxWidth differs between archetypes: 1600 \(https:\/\/s\/\), 1280 \(https:\/\/s\/p\)/);
  assert.ok(mixed.register.some((r) => /module cap 1180px on a single section/.test(r)), mixed.register.join(' | '));
  assert.equal(mixed.modules.length, 5);
});
await check('compareCaps: a live cap missing on the build fails and names the sizing rule; matched caps pass', () => {
  const live = classifyCaps(livePass(), { probeWidth: 2560 });
  const fluid = classifyCaps(fluidPass(), { probeWidth: 2560 });
  const r = compareCaps(live, fluid);
  assert.equal(r.pass, false); assert.equal(r.fails, 2, 'the wrapper cap AND the one module row (section counts match)');
  assert.equal(r.rows[0].label, 'wrapper cap');
  assert.match(r.rows[0].detail, /live 1600px \(content, main > div.shell > article\) → build NONE: content runs 2560px wide at 2560 \(no cap at all\)/);
  assert.match(r.rows.find((x) => x.label === 'module 1/1').detail, /live 1180px \(div.inner > div.container\) → build full-bleed/);
  assert.match(r.rows[0].detail, /main \{ max-width: 1600px; margin: 0 auto \}/);
  assert.ok(r.rows.some((x) => x.label === 'outer shell' && x.advisory && x.ok), 'the 1920 shell is informational');
  const fixed = { ...fluid, contentMaxWidth: 1605, contentFrom: 'shell', origins: [{ kind: 'shell', px: 1605, selector: 'main' }], modules: [{ index: 0, selector: 'main > div', px: 1180, capSelector: 'main > div > .wrap' }] };
  const ok = compareCaps(live, fixed);
  assert.equal(ok.pass, true, JSON.stringify(ok.rows));
  assert.match(ok.rows[0].detail, /live 1600px = build 1605px/);
  assert.deepEqual(ok.rows.filter((x) => x.label.startsWith('module')).map((x) => [x.ok, x.advisory]), [[true, false]]);
});
await check('compareCaps: a build cap over a fluid live fails; module mismatches fail when sections match and warn when they do not', () => {
  const live = classifyCaps(modulePass(), { probeWidth: 2560 });
  const built = classifyCaps(livePass(), { probeWidth: 2560 });
  const r = compareCaps(live, built);
  assert.equal(r.rows[0].ok, false); assert.match(r.rows[0].detail, /build 1600px \(main > div.shell > article\) but live has no wrapper cap \(module caps only: 1280px ×3/);
  assert.ok(r.rows.some((x) => x.label === 'sections' && x.advisory));
  assert.ok(r.rows.filter((x) => x.label.startsWith('module')).every((x) => x.ok), 'module rows are advisory when the counts differ');
  const same = { ...live, modules: live.modules.map((m, i) => (i === 3 ? { ...m, px: 900, capSelector: 'x' } : m)) };
  const r2 = compareCaps(live, same);
  assert.equal(r2.pass, false); assert.match(r2.rows.find((x) => !x.ok).detail, /live full-bleed .* → build 900px/);
  assert.match(compareCaps(fluidPass() && classifyCaps(fluidPass(), { probeWidth: 2560 }), classifyCaps(fluidPass(), { probeWidth: 2560 })).rows[0].detail, /fluid on both sides/);
});
// Plain models for the pairing rule: a 1600 wrapper (null = none) and module caps [px, tag, role] (px null = full-bleed).
const capModel = (mods, wrapper = 1600) => ({
  probeWidth: 2560, root: { selector: 'main', w2: 2560 }, contentMaxWidth: wrapper, contentFrom: wrapper ? 'shell' : null, shellMaxWidth: wrapper,
  origins: wrapper ? [{ kind: 'shell', px: wrapper, via: 'max-width', selector: 'main', tier: 0, share: 1 }] : [],
  modules: mods.map(([px, capTag, capRole = null], index) => ({ index, selector: `main > div:nth-child(${index + 1})`, px, capSelector: px === null ? null : `${capTag}.cap${index + 1}`, capTag: px === null ? null : capTag, capRole })),
});
const cols = [[1180, 'div'], [1180, 'div'], [1180, 'div']];
await check('pairPlausible: implausible only when both are capped, widths differ by > 40 % AND the tag or role differs', () => {
  const m = (px, capTag, capRole) => ({ px, capTag, capRole });
  assert.equal(PAIR_WIDTH_RATIO, 0.4);
  assert.equal(pairPlausible(m(552, 'ul'), m(280, 'div')), false);
  assert.equal(pairPlausible(m(552, 'div', 'list'), m(280, 'div')), false, 'same tag, different role');
  assert.equal(pairPlausible(m(552, 'div', null), m(280, 'div')), true, 'missing role compares as null');
  assert.equal(pairPlausible(m(1000, 'ul'), m(600, 'div')), true, 'exactly 40 % is not more than 40 %');
  assert.equal(pairPlausible(m(552, 'ul'), m(null, null)), true, 'a full-bleed side is not subject to the rule');
  assert.equal(pairPlausible(m(552, 'ul'), { px: 280 }), true, 'no capTag (older data): cannot compare');
});
await check('compareCaps: an implausible module pair is listed unpaired, not scored — the verdict counts the scored modules', () => {
  const r = compareCaps(capModel([...cols, [552, 'ul']]), capModel([...cols, [280, 'div']]));
  assert.deepEqual([r.verdict, r.pass, r.fails, r.modules, r.note], ['PASS', true, 0, { total: 4, scored: 3, unpaired: 1 }, null]);
  const row4 = r.rows.find((x) => x.label === 'module 4/4');
  assert.deepEqual([row4.ok, row4.advisory, row4.unpaired], [true, true, true]);
  assert.match(row4.detail, /^unpaired — live 552px <ul> \(ul\.cap4\) vs build 280px <div> \(div\.cap4\): widths differ by 49% and the elements differ — listed, not scored$/);
  const same = compareCaps(capModel([...cols, [552, 'div']]), capModel([...cols, [280, 'div']]));
  assert.deepEqual([same.verdict, same.pass, same.fails, same.modules], ['FAIL', false, 1, { total: 4, scored: 4, unpaired: 0 }], 'the same element at another width is a real cap mismatch');
  const old = capModel([...cols, [280, 'div']]); delete old.modules[3].capTag;
  const legacy = compareCaps(capModel([...cols, [552, 'ul']]), old);
  assert.deepEqual([legacy.verdict, legacy.fails, legacy.modules.scored], ['FAIL', 1, 4], 'without capTag on one side the pair is scored as before');
});
await check('compareCaps: fewer than half the modules pair → INCONCLUSIVE (no module row scored, exit 0); a failing wrapper row still FAILs', () => {
  const live = capModel([[1180, 'div'], [552, 'ul'], [552, 'ul'], [552, 'ul']]);
  const build = capModel([[900, 'div'], [280, 'div'], [280, 'div'], [280, 'div']]);
  const r = compareCaps(live, build);
  assert.deepEqual([r.verdict, r.pass, r.fails, r.modules], ['INCONCLUSIVE', true, 0, { total: 4, scored: 0, unpaired: 3 }]);
  assert.match(r.note, /fewer than half the modules paired \(1 of 4\): module rows not scored; check that --main \/ --build-main name matching content roots/);
  const m1 = r.rows.find((x) => x.label === 'module 1/4');
  assert.deepEqual([m1.ok, m1.advisory], [true, true], 'the paired 1180 → 900 row cannot fail');
  const w = compareCaps(live, capModel([[900, 'div'], [280, 'div'], [280, 'div'], [280, 'div']], 1200));
  assert.deepEqual([w.verdict, w.pass, w.fails, w.rows.find((x) => !x.ok).label], ['FAIL', false, 1, 'wrapper cap']);
  assert.match(w.note, /fewer than half the modules paired/);
  const half = compareCaps(capModel([[1180, 'div'], [1180, 'div'], [552, 'ul'], [552, 'ul']]), capModel([[900, 'div'], [1180, 'div'], [280, 'div'], [280, 'div']]));
  assert.deepEqual([half.verdict, half.fails, half.modules], ['FAIL', 1, { total: 4, scored: 2, unpaired: 2 }], 'exactly half paired: scored as today');
});
await check('formatCompare / formatCapture: verdict line, evidence pointer, consistency line', () => {
  const live = classifyCaps(livePass(), { probeWidth: 2560 }); const build = classifyCaps(fluidPass(), { probeWidth: 2560 });
  const text = formatCompare({ urls: ['https://s/', 'http://localhost:1/'], probeNote: 'derived', live: { ...live, baseWidth: 1440 }, build, compare: compareCaps(live, build), evidence: 'stardust/replica/gates/home-2560/cap-iter1.json' });
  assert.match(text, /^cap-probe {2}base 1440 → probe 2560 \(derived\)/);
  assert.match(text, /✗ wrapper cap: live 1600px/);
  assert.match(text, /cap-probe: FAIL at 2560 — \d+ of \d+ rows failed; modules scored 1 of 1 \(evidence stardust\/replica\/gates\/home-2560\/cap-iter1.json\)$/);
  const cap = formatCapture({ pages: { 'https://s/': { ...live, baseWidth: 1440, probeNote: 'derived: max(2560, largest cap × 1.25)' } }, aggregate: aggregateCaps({ 'https://s/': live }) });
  assert.match(cap, /shell {5}1920px {2}max-width/); assert.match(cap, /contentMaxWidth: 1600px {2}shellMaxWidth: 1920px {2}probeWidth: 2560 {2}consistent: yes/);
});
await check('formatCompare: unpaired rows get ○, the verdict line names the scored modules and the INCONCLUSIVE note; older compare JSON still prints', () => {
  const fmt = (live, build, compare = compareCaps(live, build)) => formatCompare({ urls: ['https://s/', 'http://localhost:1/'], probeNote: 'derived', live: { ...live, baseWidth: 1440 }, build, compare });
  const t = fmt(capModel([...cols, [552, 'ul']]), capModel([...cols, [280, 'div']]));
  assert.match(t, /\n {2}○ module 4\/4: unpaired — live 552px <ul>/);
  assert.match(t, /\ncap-probe: PASS at 2560 — 0 of 5 rows failed; modules scored 3 of 4, 1 unpaired$/);
  const i = fmt(capModel([[1180, 'div'], [552, 'ul'], [552, 'ul'], [552, 'ul', 'list']]), capModel([[1180, 'div'], [280, 'div'], [280, 'div'], [280, 'div']]));
  assert.match(i, /○ module 4\/4: unpaired — live 552px <ul role="list"> \(ul\.cap4\)/);
  assert.match(i, /\ncap-probe: INCONCLUSIVE at 2560 — 0 of 5 rows failed; modules scored 0 of 4, 3 unpaired — fewer than half the modules paired \(1 of 4\): module rows not scored; check that --main \/ --build-main name matching content roots$/);
  const m = capModel(cols);
  assert.match(fmt(m, m, { rows: [{ ok: true, label: 'wrapper cap', detail: 'x' }], fails: 0, pass: true }), /\ncap-probe: PASS at 2560 — 0 of 1 rows failed$/);
});
await check('parseArgs: defaults and the usage errors (exit 125)', () => {
  const o = parseArgs(['https://s/', 'https://s/p', '--write-design', 'D.json']);
  assert.deepEqual([o.urls, o.width, o.probeWidth, o.tolerance, o.buildMain, o.writeDesign, o.label], [['https://s/', 'https://s/p'], 1440, null, 20, 'main', 'D.json', 'iter']);
  const c = parseArgs(['https://s/', '--against', 'http://localhost:8791/x.html', '--design', 'D.json', '--slug', 'home', '--label', 'iter2', '--probe-width', '3000', '--main', 'article']);
  assert.deepEqual([c.against, c.design, c.slug, c.label, c.probeWidth, c.main], ['http://localhost:8791/x.html', 'D.json', 'home', 'iter2', 3000, 'article']);
  for (const [argv, re] of [
    [[], /need <url>/], [['a', 'b', '--against', 'c'], /ONE live url/], [['a', '--against', 'b', '--write-design', 'D'], /capture flag/],
    [['a', '--slug', 's'], /needs --against/], [['a', '--probe-width', '1200'], /must exceed the base width/], [['a', '--bogus'], /unknown flag --bogus/], [['a', '--width'], /--width needs a value/],
  ]) assert.throws(() => parseArgs(argv), (e) => e instanceof UsageError && e.code === 125 && re.test(e.message), argv.join(' '));
});
await check('mergeDesign / readDesignSizing: fields land under extensions.breakpoints, indent and siblings kept', () => {
  const before = '{\n    "colors": { "a": "#000" },\n    "extensions": { "breakpoints": { "mobile": "360px" }, "voice": [] }\n}\n';
  const agg = aggregateCaps({ 'https://s/': classifyCaps(livePass(), { probeWidth: 2560 }) });
  const after = mergeDesign(before, agg, { writtenBy: 't' });
  const d = JSON.parse(after);
  assert.equal(d.colors.a, '#000'); assert.equal(d.extensions.breakpoints.mobile, '360px'); assert.deepEqual(d.extensions.voice, []);
  assert.equal(d.extensions.breakpoints.containerMaxWidth, '1600px'); assert.equal(d.extensions.breakpoints.probeWidth, 2560); assert.equal(d.extensions.breakpoints.shellMaxWidth, '1920px');
  assert.equal(d.extensions.breakpoints.caps.length, 3); assert.equal(d.extensions.breakpoints.modules.length, 1); assert.equal(d.extensions.breakpoints.capProvenance.writtenBy, 't');
  assert.ok(after.startsWith('{\n    "colors"') && after.endsWith('\n'), 'indent and trailing newline kept');
  const f = join(root, 'D.json'); writeFileSync(f, after);
  assert.deepEqual(readDesignSizing(f), { probeWidth: 2560, containerMaxWidth: 1600 });
  assert.equal(readDesignSizing(join(root, 'missing.json')), null);
  writeFileSync(f, '{"extensions":{"breakpoints":{"containerMaxWidth":null}}}');
  assert.deepEqual(readDesignSizing(f), { probeWidth: null, containerMaxWidth: null });
});
await check('CLI: --help answers without a browser; a usage error exits 125', () => {
  const h = run(['--help']); assert.equal(h.code, 0); assert.match(h.out, /Usage:/); assert.match(h.out, /--probe-width/);
  const u = run([]); assert.equal(u.code, 125); assert.match(u.err, /need <url>/);
});

// ---- (b) end-to-end, where playwright resolves from the script's location ---------------------------
const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "import('playwright').then(() => process.exit(0), () => process.exit(1))"], { cwd: dirname(SCRIPT) });
if (pwProbe.status !== 0) {
  console.log('- e2e: playwright not importable from the scripts dir — skipped (run the copy inside a project with playwright installed)');
} else {
  const page = (title, main) => `<!doctype html><html><head><title>${title}</title><style>body{margin:0}header,footer{padding:20px}header>div{max-width:1200px;margin:0 auto}${main.css}</style></head><body><header><div>Nav <a href="#">One</a> <a href="#">Two</a></div></header><main>${main.html}</main><footer>Footer text</footer></body></html>`;
  const sectionHtml = (n) => `<section class="s${n}"><div class="container"><h2>Section ${n}</h2><p>${'Body copy. '.repeat(30)}</p></div></section>`;
  const liveLike = page('live', { css: '.shell{max-width:1920px;margin:0 auto;background:#eee}article{max-width:1600px;margin:0 auto}.container{width:1180px;margin:0 auto}', html: `<div class="shell"><article>${[1, 2, 3].map(sectionHtml).join('')}</article></div>` });
  const fluidBuild = page('fluid', { css: '.container{width:1180px;margin:0 auto}', html: [1, 2, 3].map((n) => `<div class="section">${sectionHtml(n)}</div>`).join('') });
  const percentBuild = page('percent', { css: '.container{max-width:90%;margin:0 auto}', html: `<div class="wrap"><div class="inner">${[1, 2, 3].map((n) => `<div class="section">${sectionHtml(n)}</div>`).join('')}</div></div>` });
  const fixedBuild = page('fixed', { css: 'main{max-width:1600px;margin:0 auto}.container{width:1180px;margin:0 auto}', html: [1, 2, 3].map((n) => `<div class="section">${sectionHtml(n)}</div>`).join('') });
  // The third section's widest cap is a 280 px pagination list — not the live 1180 column at the same index.
  const pagerBuild = page('pager', { css: 'main{max-width:1600px;margin:0 auto}.container{width:1180px;margin:0 auto}.pager{width:280px;box-sizing:border-box;margin:0 auto}', html: `${[1, 2].map((n) => `<div class="section">${sectionHtml(n)}</div>`).join('')}<div class="section"><section class="s3"><ul class="pager" role="list">${[1, 2, 3, 4, 5].map((k) => `<li>Page ${k}</li>`).join('')}</ul></section></div>` });
  const pages = { '/live': liveLike, '/fluid': fluidBuild, '/fixed': fixedBuild, '/percent': percentBuild, '/pager': pagerBuild };
  const server = createServer((req, res) => { const body = pages[req.url.split('?')[0]]; if (!body) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await check('e2e capture: shell 1920 + content 1600 + module 1180, probe width derived to 2560, DESIGN.json written', async () => {
      const d = join(root, 'DESIGN.json'); writeFileSync(d, '{\n "extensions": {}\n}\n');
      const r = await runAsync([`${base}/live`, '--write-design', d]);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /shell {5}1920px {2}max-width/); assert.match(r.out, /content {3}1600px {2}max-width/); assert.match(r.out, /modules {2}3 sections: capped 1180 ×3/, "sections found through the shell > article wrappers");
      assert.match(r.out, /contentMaxWidth: 1600px {2}shellMaxWidth: 1920px {2}probeWidth: 2560 {2}consistent: yes/);
      const bp = JSON.parse(readFileSync(d, 'utf8')).extensions.breakpoints;
      assert.equal(bp.containerMaxWidth, '1600px'); assert.equal(bp.probeWidth, 2560); assert.equal(bp.shellMaxWidth, '1920px');
    });
    await check('e2e capture: percentage containers are fluid, sections found through single-child wrappers', async () => {
      const r = await runAsync([`${base}/percent`]);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /modules {2}3 sections: none capped · full-bleed ×3/); assert.match(r.out, /contentMaxWidth fluid · shellMaxWidth fluid/);
    });
    await check('e2e capture pinned at 1920: the 1920 shell is invisible (a probe at the cap width cannot see the cap)', async () => {
      const r = await runAsync([`${base}/live`, '--probe-width', '1920']);
      assert.equal(r.code, 0, r.err);
      assert.doesNotMatch(r.out, /1920px/); assert.match(r.out, /shell {5}1600px/); assert.match(r.out, /probe 1920 \(pinned\)/);
    });
    await check('e2e compare: fluid build fails naming the missing 1600 cap, evidence in the gate dir; fixed build passes at the DESIGN.json width', async () => {
      const r = await runAsync([`${base}/live`, '--against', `${base}/fluid`, '--slug', 'home', '--label', 'iter1']);
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.out, /✗ wrapper cap: live 1600px \(content, .*article\) → build NONE: content runs 2560px wide at 2560 \(module caps only: 1180px ×3\)/);
      assert.match(r.out, /cap-probe: FAIL at 2560 — 1 of \d+ rows failed; modules scored 3 of 3 \(evidence stardust\/replica\/gates\/home-2560\/cap-iter1.json\)/);
      assert.ok(existsSync(join(root, 'stardust/replica/gates/home-2560/cap-iter1.json')) && existsSync(join(root, 'stardust/replica/gates/home-2560/cap-iter1.txt')));
      const ok = await runAsync([`${base}/live`, '--against', `${base}/fixed`, '--design', join(root, 'DESIGN.json')]);
      assert.equal(ok.code, 0, ok.out + ok.err);
      assert.match(ok.out, /probe 2560 \(from .*DESIGN.json\)/); assert.match(ok.out, /✓ wrapper cap: live 1600px = build 1600px/); assert.match(ok.out, /cap-probe: PASS at 2560/);
    });
    await check('e2e compare: a pagination list paired by index with a content column is listed unpaired, not failed (exit 0)', async () => {
      const out = join(root, 'pager.json');
      const r = await runAsync([`${base}/live`, '--against', `${base}/pager`, '--out', out]);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /○ module 3\/3: unpaired — live 1180px <div> \(.*container\) vs build 280px <ul role="list"> \(.*ul\.pager\): widths differ by 76% and the elements differ — listed, not scored/);
      assert.match(r.out, /cap-probe: PASS at 2560 — 0 of \d+ rows failed; modules scored 2 of 3, 1 unpaired/);
      const j = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual([j.compare.verdict, j.compare.modules, j.build.modules[2].capTag, j.build.modules[2].capRole], ['PASS', { total: 3, scored: 2, unpaired: 1 }, 'ul', 'list']);
    });
  } finally {
    server.close();
  }
}

rmSync(root, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('cap-probe.test: all checks passed');
