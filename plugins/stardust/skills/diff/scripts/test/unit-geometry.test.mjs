#!/usr/bin/env node
// skills/diff/scripts/test/unit-geometry.test.mjs — the unit-geometry.mjs alignment (#125 D3), no browser:
// keyed() stable keys (role:text, role:selector#ordinal, #2 for duplicates), alignUnit pairs by key, by text
// prefix, across relaxed roles (link ↔ button), images by order whatever their alt, leftover text by position
// (the session-variable badge), reports Δx/Δy/Δw/Δh relative to the unit, flags off / hidden / missing / extra
// and the unit size; verdictOf totals; parseArgs (--unit-pair, --unit split outside brackets and quotes, --stage);
// the origin cache identity (slug, width, URL, n, locale, selector set; the pre-identity file is ignored); exit
// codes (0 / 2 FAIL / 1 ERROR / 3 bot challenge); --help in an empty cwd. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignUnit, cacheHit, cacheIdentity, cacheKeyOf, compareUnits, errorExitCode, exitCodeOf, formatUnits, keyed, parseArgs, servedSelector, splitUnitPair, unitsFor, verdictOf } from '../unit-geometry.mjs';
import { cachePath } from '../measure-live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'unit-geometry.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const el = (role, text, x, y, w, h, extra = {}) => ({ role, tag: role === 'image' ? 'img' : 'p', sel: role === 'image' ? 'img' : 'p.x', text, x, y, w, h, fs: 16, lh: 22, fw: '400', ...extra });

check('keyed: role:text keys, selector#ordinal for text-less, #2 for duplicates', () => {
  const k = keyed([el('text', 'Expires', 0, 0, 10, 10), el('image', '', 0, 0, 10, 10), el('image', '', 0, 0, 10, 10), el('text', 'Expires', 0, 0, 10, 10)]);
  assert.deepEqual(k.map((x) => x.key), ['text:expires', 'image:img#1', 'image:img#2', 'text:expires #2']);
});
check('alignUnit: the recorded card — body 28 px low, details link hidden, badge paired by position, image by order', () => {
  const o = { rect: { x: 165, y: 500, w: 350, h: 260 }, elements: [el('text', '1 day left', -10, -10, 70, 70), el('image', '', 17, 76, 70, 70), el('text', 'Expires 09/26/26', 112, 12, 202, 15), el('text', 'Earn $5 W Cash rewards when you spend', 112, 27, 202, 54), el('link', 'View details', 112, 176, 91, 24), el('button', 'Clip', 12, 204, 326, 44)] };
  const e = { rect: { x: 165, y: 522, w: 355, h: 238 }, elements: [el('text', '2 days left', -27, -30, 64, 64), el('image', 'coupon', 11, 46, 65, 65), el('text', 'Expires 09/26/26', 101, 16, 242, 20), el('text', 'Earn $5 W Cash rewards when yo…', 101, 55, 215, 48), el('link', 'View details', 101, 204, 91, 20, { hidden: true }), el('link', 'Clip', 12, 182, 331, 44)] };
  const r = alignUnit(o, e, 4);
  assert.equal(r.summary.missing, 0, JSON.stringify(r.missing)); assert.equal(r.summary.extra, 0);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by['text:1 day left'].byPosition, true); assert.equal(by['text:1 day left'].dy, -20);
  assert.equal(by['image:img#1'].dy, -30);
  assert.equal(by['text:earn $5 w cash rewards when you spend'].dy, 28, 'prefix-matched summary line is 28 px low');
  assert.equal(by['link:view details'].hidden, true); assert.equal(by['link:view details'].dy, 28);
  assert.equal(by['button:clip'].eds.role, 'link', 'relaxed role pairing'); assert.equal(by['button:clip'].dy, -22);
  assert.equal(r.unit.dh, -22); assert.equal(r.summary.unitOff, true);
  assert.equal(r.summary.within, 0); assert.equal(r.summary.hidden, 1);
});
check('alignUnit: identical units read all within, nothing off', () => {
  const u = { rect: { x: 0, y: 0, w: 100, h: 100 }, elements: [el('heading', 'Title', 0, 0, 100, 20), el('text', 'Body', 0, 30, 100, 20)] };
  const r = alignUnit(u, { ...u, rect: { x: 300, y: 0, w: 100, h: 100 } }, 4);
  assert.equal(r.summary.within, 2); assert.equal(r.summary.off, 0); assert.equal(r.unit.dx, 300); assert.equal(r.summary.unitOff, false);
});
check('missing + extra when nothing pairs; verdictOf totals; formatUnits marks rows', () => {
  const o = { rect: { x: 0, y: 0, w: 10, h: 10 }, elements: [el('link', 'Only here', 0, 0, 10, 10)] };
  const e = { rect: { x: 0, y: 0, w: 10, h: 10 }, elements: [el('button', 'Something else', 0, 0, 10, 10)] };
  const r = alignUnit(o, e, 4);
  assert.equal(r.summary.missing, 1); assert.equal(r.summary.extra, 1);
  const res = [{ sel: 'a=b', units: [{ index: 0, ...r }] }, { sel: 'x=y', units: [], error: 'no visible unit' }];
  assert.deepEqual(verdictOf(res), { units: 1, within: 0, off: 0, hidden: 0, missing: 1, errors: 1, requiredOff: 1 });
  assert.equal(verdictOf([{ sel: 'a=b', required: false, units: [{ index: 0, ...r }] }]).requiredOff, 0, 'an advisory family never feeds the exit code');
  const s = formatUnits(res, 4); assert.match(s, /✗ missing/); assert.match(s, /🟡 extra/); assert.match(s, /no visible unit/);
});
check('compareUnits pairs units by index and reports a side without visible units', () => {
  const inv = (n) => ({ bySel: { '.c': { matches: n, units: Array.from({ length: n }, (_, i) => ({ index: i, path: 'div', rect: { x: 0, y: i * 100, w: 10, h: 10 }, elements: [] })) } } });
  assert.equal(compareUnits(inv(2), inv(2), { origin: '.c', eds: '.c' }, 4).units.length, 2);
  assert.match(compareUnits(inv(2), inv(0), { origin: '.c', eds: '.c' }, 4).error, /served side/);
});
check('parseArgs: repeatable --unit with and without the served selector', () => {
  const o = parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit', '.a=.b', '--unit', '.c', '--n', '3', '--tol', '2', '--slug', 's']);
  assert.deepEqual(o.units, [{ origin: '.a', eds: '.b' }, { origin: '.c', eds: '.c' }]); assert.equal(o.n, 3); assert.equal(o.tol, 2); assert.equal(o.slug, 's');
});
// ---- selectors with "=" ------------------------------------------------------------------------------------
const TRICKY = ['[data-kind="card"]', 'a[href*="x=y"]', "li[data-a='1'][data-b=two]", 'ul > li:not([hidden=until-found])', 'div[title="a]=b"]', '[data-x="\\"=q"]'];
check('splitUnitPair: "=" inside [...], (...) and quotes is part of the selector; one outside splits; none = same selector twice', () => {
  for (const sel of TRICKY) {
    assert.deepEqual(splitUnitPair(sel), { origin: sel, eds: sel }, sel);
    assert.deepEqual(splitUnitPair(`${sel} = .cards > li`), { origin: sel, eds: '.cards > li' }, sel);
    assert.deepEqual(splitUnitPair(`.grid .item=${sel}`), { origin: '.grid .item', eds: sel }, sel);
    assert.deepEqual(splitUnitPair(`${sel}=${sel}`), { origin: sel, eds: sel }, sel);
  }
  assert.deepEqual(splitUnitPair('.a=.b'), { origin: '.a', eds: '.b' });
});
check('splitUnitPair: ambiguous, unclosed or empty forms throw and name --unit-pair, never truncate', () => {
  for (const bad of ['.a=.b=.c', '[data-kind="card"]=.b=.c', '[data-kind="card=.b', '.a[x=1=.b', '.a]=.b', '.a=', '=.b', '']) {
    assert.throws(() => splitUnitPair(bad), /--unit-pair <origin-selector> <eds-selector>/, bad);
  }
  assert.throws(() => splitUnitPair('.a=.b=.c'), /ambiguous, 2 "="/);
});
check('parseArgs: --unit-pair takes two arguments verbatim; --unit and --unit-pair mix; both keep "=" selectors', () => {
  const argv = ['node', 'x', 'https://o/', 'https://e/'];
  for (const sel of TRICKY) argv.push('--unit-pair', sel, `.block ${sel}`, '--unit', `${sel}=.served`);
  const o = parseArgs([...argv, '--width', '390']);
  assert.deepEqual(o.units, TRICKY.flatMap((sel) => [{ origin: sel, eds: `.block ${sel}` }, { origin: sel, eds: '.served' }]));
  assert.equal(o.width, 390); assert.equal(o.origin, 'https://o/'); assert.equal(o.eds, 'https://e/');
  assert.throws(() => parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit-pair', '.a']), /--unit-pair needs two arguments/);
  assert.throws(() => parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit-pair', '.a', '--n', '2']), /--unit-pair needs two arguments/);
  assert.throws(() => parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit', '.a=.b=.c']), /ambiguous/);
  assert.throws(() => parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit']), /--unit needs a value/);
});

// ---- stage-aware family selectors --------------------------------------------------------------------------
const FAMILIES = {
  cards: { origin: '.o-card', build: '.proto-card', eds: '.cards > ul > li', n: 2, pages: ['home'] },
  rows: { origin: '.o-row', build: '.proto-row', required: false, pages: ['home'] },
  tiles: { origin: '.o-tile', eds: '.tiles > div', templates: ['listing'] },
  bare: { origin: '.o-bare', pages: ['home'] },
};
check('servedSelector / unitsFor: published reads eds → build → origin; prototype and no stage read build → eds → origin', () => {
  const served = (stage, slug = 'home', tpl = null) => Object.fromEntries(unitsFor(FAMILIES, slug, tpl, stage).map((u) => [u.family, u.eds]));
  assert.deepEqual(served('published'), { cards: '.cards > ul > li', rows: '.proto-row', bare: '.o-bare' });
  assert.deepEqual(served('prototype'), { cards: '.proto-card', rows: '.proto-row', bare: '.o-bare' });
  assert.deepEqual(served(null), served('prototype'), 'no stage = the order before --stage existed');
  assert.deepEqual(served(undefined), served('prototype'));
  assert.deepEqual(served('prototype', 'other', 'listing'), { tiles: '.tiles > div' }, 'prototype falls back to eds when build is absent');
  assert.deepEqual(unitsFor(FAMILIES, 'home', null, 'published').map((u) => u.origin), ['.o-card', '.o-row', '.o-bare'], 'the origin side never depends on the stage');
  assert.deepEqual(unitsFor(FAMILIES, 'home', null, 'published')[0], { family: 'cards', origin: '.o-card', eds: '.cards > ul > li', n: 2, required: true });
  assert.equal(servedSelector({ origin: '.o', build: '.b', eds: '.e' }, 'published'), '.e');
  assert.equal(servedSelector({ origin: '.o', build: '.b', eds: '.e' }, 'prototype'), '.b');
  assert.throws(() => servedSelector({ origin: '.o' }, 'live'), /prototype or published/);
});
check('parseArgs: --families + --stage resolves the stage selector from the file; a bad stage throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unit-geometry-fam-'));
  const file = join(dir, 'units.json'); writeFileSync(file, JSON.stringify(FAMILIES));
  const base = ['node', 'x', 'https://o/', 'https://e/', '--families', file, '--slug', 'home', '--template', 'page'];
  assert.equal(parseArgs([...base, '--stage', 'published']).units[0].eds, '.cards > ul > li');
  assert.equal(parseArgs([...base, '--stage', 'prototype']).units[0].eds, '.proto-card');
  assert.equal(parseArgs(base).units[0].eds, '.proto-card');
  assert.equal(parseArgs([...base, '--stage', 'published']).n, 2, 'n is the largest family n');
  assert.throws(() => parseArgs([...base, '--stage', 'live']), /--stage must be prototype or published/);
  assert.throws(() => parseArgs([...base, '--stage']), /--stage must be/);
  rmSync(dir, { recursive: true, force: true });
});

// ---- origin cache identity ---------------------------------------------------------------------------------
const RUN = { slug: 'home', width: 1440, origin: 'https://o/', n: 2, locale: 'en-US', units: [{ origin: '.b', eds: '.x' }, { origin: '.a', eds: '.y' }, { origin: '.b', eds: '.z' }] };
const invFor = (id) => ({ url: id.url, at: 't', bySel: Object.fromEntries(id.selectors.map((s) => [s, { matches: 1, units: [] }])), _cache: id });
check('cache: identity = slug + width + URL + n + locale + selector set; two widths are two identities and two files', () => {
  const wide = cacheIdentity(RUN); const narrow = cacheIdentity({ ...RUN, width: 390 });
  assert.deepEqual(wide, { v: 2, slug: 'home', width: 1440, url: 'https://o/', n: 2, locale: 'en-US', selectors: ['.a', '.b'] });
  assert.notDeepEqual(wide, narrow);
  assert.equal(cacheKeyOf(wide), 'home-units-w1440'); assert.equal(cacheKeyOf(narrow), 'home-units-w390');
  assert.notEqual(cachePath(cacheKeyOf(wide)), cachePath(cacheKeyOf(narrow)));
  assert.equal(cacheHit(invFor(wide), wide), true);
  assert.equal(cacheHit(invFor(wide), narrow), false, 'the 1440 rects never answer a 390 gate');
  assert.equal(cacheHit(invFor(narrow), narrow), true);
  assert.equal(cacheHit(invFor(wide), cacheIdentity({ ...RUN, width: '1440', n: '2' })), true, 'numbers are normalised');
  assert.equal(cacheHit(invFor(wide), cacheIdentity({ ...RUN, units: [...RUN.units].reverse() })), true, 'selector order and duplicates do not matter');
  assert.equal(cacheIdentity({ ...RUN, slug: null }), null); assert.equal(cacheKeyOf(null), null); assert.equal(cacheHit(invFor(wide), null), false);
});
check('cache: a changed URL, n, locale, slug or selector set is a miss', () => {
  const id = cacheIdentity(RUN); const hit = (over) => cacheHit(invFor(id), cacheIdentity({ ...RUN, ...over }));
  assert.equal(hit({}), true);
  assert.equal(hit({ origin: 'https://o/other' }), false, 'URL');
  assert.equal(hit({ origin: 'https://o/?v=2' }), false, 'query string');
  assert.equal(hit({ n: 3 }), false, 'n'); assert.equal(hit({ n: 1 }), false, 'a smaller n is still another measurement');
  assert.equal(hit({ locale: 'de-DE' }), false, 'locale');
  assert.equal(hit({ slug: 'home-2' }), false, 'slug');
  assert.equal(hit({ units: [{ origin: '.a' }] }), false, 'a subset of the selectors');
  assert.equal(hit({ units: [...RUN.units, { origin: '.c' }] }), false, 'an added selector');
  const partial = invFor(id); delete partial.bySel['.a'];
  assert.equal(cacheHit(partial, id), false, 'identity matches but a selector was never measured');
});
check('cache: the pre-identity format is ignored — under its old key, and when found under the new one', () => {
  const id = cacheIdentity(RUN);
  const old = { url: 'https://o/', at: 't', status: 200, docH: 4000, bySel: { '.a': { matches: 3, units: [] }, '.b': { matches: 3, units: [] } } };
  assert.notEqual(cacheKeyOf(id), 'home-units', 'the old file name is never read');
  assert.equal(cacheHit(old, id), false, 'selectors present, no identity → miss');
  assert.equal(cacheHit({ ...old, _cache: { ...id, v: 1 } }, id), false);
  assert.equal(cacheHit({ ...old, _cache: { slug: 'home' } }, id), false);
  for (const junk of [null, undefined, {}, [], 'x', { _cache: id }]) assert.equal(cacheHit(junk, id), false);
});

// ---- exit codes --------------------------------------------------------------------------------------------
check('exit codes: 0 pass / advisory, 2 FAIL, 1 ERROR, 3 bot challenge — an error is never 2', () => {
  const v = (over) => ({ units: 1, within: 1, off: 0, hidden: 0, missing: 0, errors: 0, requiredOff: 0, ...over });
  assert.equal(exitCodeOf(v({})), 0);
  assert.equal(exitCodeOf(v({ off: 3 })), 0, 'advisory-family deltas do not fail');
  assert.equal(exitCodeOf(v({ off: 1, requiredOff: 1 })), 2);
  assert.equal(exitCodeOf(v({ errors: 1 })), 2, 'a selector with no visible unit');
  assert.equal(exitCodeOf(v({ requiredOff: 4, errors: 1 }), { advisory: true }), 0);
  assert.equal(errorExitCode(new Error('boom')), 1); assert.equal(errorExitCode(new TypeError('x')), 1); assert.equal(errorExitCode(undefined), 1);
  assert.equal(errorExitCode(Object.assign(new Error('challenge'), { name: 'BotChallengeError' })), 3);
});
check('CLI: usage and file errors exit 1 with one "unit-geometry error:" line on stderr, before any browser or write', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'unit-geometry-err-'));
  mkdirSync(join(cwd, 'stardust', 'current', 'measure'), { recursive: true });
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, 'https://o.invalid/', 'https://e.invalid/', ...args], { cwd, encoding: 'utf8' });
  const cases = [
    [['--unit', '.a=.b=.c'], /ambiguous.*--unit-pair/],
    [['--unit', '[data-kind="card'], /unclosed.*--unit-pair/],
    [['--unit-pair', '.a'], /--unit-pair needs two arguments/],
    [['--families', 'missing.json', '--slug', 'home'], /ENOENT/],
    [['--families', 'missing.json', '--slug', 'home', '--stage', 'live'], /--stage must be prototype or published/],
  ];
  for (const [args, re] of cases) {
    const r = run(...args);
    assert.equal(r.status, 1, `${args.join(' ')} → ${r.status} ${r.stderr}`);
    const lines = r.stderr.trim().split('\n');
    assert.equal(lines.length, 1, r.stderr); assert.match(lines[0], /^unit-geometry error: /); assert.match(lines[0], re);
    assert.equal(r.stdout, '');
  }
  writeFileSync(join(cwd, 'units.json'), JSON.stringify(FAMILIES));
  const none = run('--families', 'units.json', '--slug', 'elsewhere', '--stage', 'published');
  assert.equal(none.status, 0); assert.match(none.stdout, /none declared for elsewhere/);
  assert.deepEqual(readdirSync(join(cwd, 'stardust', 'current', 'measure')), []);
  rmSync(cwd, { recursive: true, force: true });
});
check('--help names --unit-pair, --stage with both orders, the cache identity and the exit codes', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const re of [/--unit-pair <selO> <selE>/, /--stage <stage>\s+prototype \| published/, /published: eds, else build, else origin/, /build, else eds, else origin/, /<s>-units-w<width>\.json/, /2 FAIL/, /1 ERROR/, /3 bot challenge/]) assert.match(r.stdout, re);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'unit-geometry-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node unit-geometry\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
const copyWithoutMaster = () => {
  const root = mkdtempSync(join(tmpdir(), 'diff-nomaster-'));
  const copy = join(root, 'a', 'b');
  cpSync(join(HERE, '..'), copy, { recursive: true, filter: (src) => !src.endsWith('/test') });
  return { root, copy };
};
await check('a copy without the master scripts answers --help, no stack trace', () => {
  const { root, copy } = copyWithoutMaster();
  try {
    const r = spawnSync(process.execPath, [join(copy, 'unit-geometry.mjs'), '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes('    at '), r.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
