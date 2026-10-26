#!/usr/bin/env node
// skills/reskin/scripts/test/figma-exact.test.mjs — exact fidelity for Figma-only sites (M4, gates.md § (f)):
// figma/renders.mjs (renderTargets, textsOf, runRenders against a stub client), figma-gate/exact.mjs's pure
// verdict / similarity / gateRow, and both CLIs' argument handling.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTargets, runRenders, textsOf } from '../figma/renders.mjs';
import { gateRow, libraryTarget, similarity, verdict } from '../figma-gate/exact.mjs';
import { main as gateMain } from '../figma-gate.mjs';
import { main as donorMain } from '../figma-donor.mjs';

let failures = 0;
let passes = 0;
async function test(name, fn) {
  try { await fn(); passes += 1; console.log(`ok   ${name}`); } catch (e) { failures += 1; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); }
}

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const URL = `https://www.figma.com/design/${KEY}/Kit?node-id=1-1`;
const B = (x, y, width, height) => ({ x, y, width, height });
const T = (id, characters, x, y, extra = {}) => ({ id, type: 'TEXT', name: characters, characters, absoluteBoundingBox: B(x, y, 50, 20), ...extra });
const C = (id, name, w, h, children = []) => ({ id, type: 'COMPONENT', name, absoluteBoundingBox: B(0, 0, w, h), children });
const SETS = {
  BTN: { id: 'BTN', type: 'COMPONENT_SET', name: 'Button', children: [C('b1', 'Size=Medium, Type=Primary', 120, 48, [T('b1t', 'Button', 10, 10)]), C('b2', 'Size=Small, Type=Link', 80, 32, [T('b2t', 'Link', 10, 10)]), { ...C('b3', 'Size=Hidden, Type=X', 1, 1), visible: false }] },
  H: { id: 'H', type: 'COMPONENT_SET', name: 'Header', children: [C('h1', 'Type=Full, Breakpoint=Desktop', 1440, 96, [T('h1b', 'Log in', 1300, 30), T('h1a', 'Home', 200, 30), T('h1c', 'Hidden', 0, 0, { visible: false })]), C('h2', 'Type=Full, Breakpoint=Mobile', 375, 64)] },
  foot: C('foot', 'Footer', 1440, 300, [T('ft', '© AZ', 20, 250)]),
  TS: { id: 'TS', type: 'COMPONENT_SET', name: 'Toggle switches', children: [C('t1', 'On=True', 40, 24)] },
};
const MANIFEST = {
  _provenance: { source: { fileKeyHash: 'abc', fileVersion: '7' } },
  pages: [
    { slug: 'login-landing', frame: 'p1', variants: { desktop: { id: 'p1' }, mobile: { id: 'p1m' } } },
    { slug: 'inactivity', frame: 'p2', variants: {} },
  ],
  kit: { blocks: [
    { block: 'button', module: 'M1', used: true, set: { id: 'BTN' }, sets: [{ id: 'BTN', name: 'Button', class: null }] },
    { block: 'header', module: 'M2', used: true, set: { id: 'H' }, sets: [{ id: 'H', name: 'Header', class: null }] },
    { block: 'footer', module: 'M3', used: true, set: { id: 'foot' }, sets: [{ id: 'foot', name: 'Footer', class: null }] },
    { block: 'toggle', module: 'M4', used: false, set: { id: 'TS' }, sets: [{ id: 'TS', name: 'Toggle switches', class: 'switches' }, { id: 'GONE', name: 'Toggle group', class: 'group' }] },
  ] },
};

await test('textsOf: visible text in reading order (rows by top, then left)', () => {
  assert.deepEqual(textsOf(SETS.H.children[0]), ['Home', 'Log in']);
  assert.deepEqual(textsOf({ ...SETS.foot, visible: false }), []);
});

await test('renderTargets: every page breakpoint, every visible variant of every block (used or not), set class + variant classes', () => {
  const t = renderTargets(MANIFEST, SETS);
  assert.deepEqual(t.pages, [{ slug: 'login-landing', breakpoint: 'desktop', id: 'p1' }, { slug: 'login-landing', breakpoint: 'mobile', id: 'p1m' }]);
  assert.deepEqual(t.library.map((v) => `${v.block}:${v.id}:${v.classes.join(' ')}:${v.breakpoint}`), ['button:b1:medium primary:null', 'button:b2:small link:null', 'header:h1:full:desktop', 'header:h2:full:mobile', 'footer:foot::null', 'toggle:t1:switches true:null']);
  assert.equal(t.library.find((v) => v.id === 't1').used, false);
  assert.deepEqual(t.library.find((v) => v.id === 'b1').texts, ['Button']);
  assert.deepEqual([t.library[0].w, t.library[0].h], [120, 48]);
  assert.deepEqual(t.missing, [{ block: 'toggle', set: 'Toggle group', id: 'GONE' }]);
  assert.deepEqual(t.library.find((v) => v.id === 't1').eds, { block: 'form', variant: null, page: 'form' }, 'deploy Step 2: Toggle → form (a field type row, not a variant)');
  assert.deepEqual(t.library[0].eds, { block: null, variant: null, page: 'button' }, 'Button → default content, shown on its own page');
  assert.deepEqual(renderTargets({ ...MANIFEST, pages: [{ slug: 'x', frame: 'f', variants: {} }] }, SETS).pages, [{ slug: 'x', breakpoint: 'desktop', id: 'f' }]);
});

function stub(log) {
  return {
    hasToken: true,
    async getJson(path, params) {
      log.push([path, params]);
      if (/\/nodes$/.test(path)) return { nodes: Object.fromEntries(params.ids.split(',').map((id) => [id, SETS[id] ? { document: SETS[id] } : null])) };
      if (/\/v1\/images\//.test(path)) return { images: Object.fromEntries(params.ids.split(',').filter((id) => id !== 'h2').map((id) => [id, `https://img/${id}`])) };
      throw new Error(`unexpected ${path}`);
    },
    async getBytes(u) { return Buffer.from(`png:${u}`); },
  };
}

await test('runRenders: one PNG per id, cached; figma-renders.json indexes pages and the whole library; a Figma miss is listed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  try {
    mkdirSync(join(dir, 'reskin'), { recursive: true });
    writeFileSync(join(dir, 'reskin', 'figma-pages.json'), JSON.stringify(MANIFEST));
    const log = [];
    const r = await runRenders({ dir, url: URL, client: stub(log), at: 'T' });
    assert.deepEqual(r.counts, { pages: 2, variants: 6, blocks: 4 });
    assert.deepEqual(r.failed, ['h2']);
    const out = JSON.parse(readFileSync(join(dir, 'reskin', 'figma-renders.json'), 'utf8'));
    assert.deepEqual(Object.keys(out.library), ['button', 'header', 'footer', 'toggle']);
    assert.equal(out.library.toggle.used, false);
    assert.deepEqual([out.library.toggle.eds, out.library.header.eds], [{ block: 'form', variant: null, page: 'form' }, { block: 'header', variant: null, page: 'header' }]);
    assert.equal(out.library.toggle.variants[0].eds, undefined);
    assert.match(out.pages['login-landing'][0].png, /_pages\/7\/png\/.*@1x\.frame\.png$/, 'a page frame is rendered at its own bounds');
    assert.ok(existsSync(join(dir, out.library.button.variants[0].png)));
    assert.equal(out.library.header.variants.find((v) => v.id === 'h2').png, null);
    const imageCalls = log.filter(([p]) => /images/.test(p));
    assert.ok(imageCalls.length <= 2, 'one images call per kind (frames, components) for ≤ 40 ids');
    const frameCall = imageCalls.find(([, q]) => q.use_absolute_bounds);
    assert.ok(frameCall && frameCall[1].ids.split(',').includes(out.pages['login-landing'][0].id), 'frames ask use_absolute_bounds');
    assert.ok(imageCalls.every(([, q]) => !q.use_absolute_bounds || !q.ids.split(',').includes('t1')), 'a component variant keeps its render bounds');
    const again = [];
    const r2 = await runRenders({ dir, url: URL, client: stub(again), at: 'T' });
    assert.deepEqual([r2.fetched, again.filter(([p]) => /nodes/.test(p)).length], [0, 0], 'cached: only the missing PNG is asked again');
    await runRenders({ dir, url: URL, client: stub([]), at: 'T', only: ['toggle'] });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'reskin', 'figma-renders.json'), 'utf8')).library), ['button', 'header', 'footer', 'toggle'], '--only merges');
    await assert.rejects(runRenders({ dir, url: URL, client: null, at: 'T' }), /FIGMA_TOKEN/);
    await assert.rejects(runRenders({ dir: join(dir, 'none'), url: URL, client: stub([]), at: 'T' }), /figma-pages\.json is missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('exact verdict: share over the bar, height or width outside tolerance fail with the reason; similarity is 100 − mean share', () => {
  assert.deepEqual(verdict({ pct: 2.5, heightDelta: 4 }), { verdict: 'PASS', why: [] });
  assert.deepEqual(verdict({ pct: 3.2, heightDelta: -12 }, { bar: 3, heightTol: 8 }).why, ['3.2% > 3%', 'height Δ -12px > ±8']);
  assert.equal(verdict({ pct: 0, widthDelta: 5 }, { widthTol: 2 }).verdict, 'FAIL');
  assert.equal(similarity([{ pct: 2 }, { pct: 4 }, { verdict: 'FAIL' }]), 97);
  assert.equal(similarity([]), null);
  assert.equal(gateRow({ verdict: 'FAIL', key: 'a@mobile', pct: 5, heightDelta: 3, why: ['5% > 3%'] }), 'FAIL  a@mobile 5% Δh 3 — 5% > 3%');
});

await test('CLIs: exact / library / renders argument handling', async () => {
  const lines = [];
  const log = (m) => lines.push(m);
  assert.equal(await gateMain(['--help'], { log }), 0);
  assert.match(lines.join('\n'), /figma-gate\.mjs exact --page/);
  assert.match(lines.join('\n'), /library --url-pattern/);
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  try {
    await assert.rejects(gateMain(['exact', '--url', 'x.html', '--dir', dir], { log }), /exact needs --page/);
    await assert.rejects(gateMain(['library', '--url-pattern', 'http://h/library', '--dir', dir], { log }), /needs \{block\} or \{page\}/);
    await assert.rejects(gateMain(['library', '--url-pattern', 'http://h/{page}', '--bar', 'x', '--dir', dir], { log }), /--bar is a non-negative number/, '{page} is a valid pattern');
    await assert.rejects(gateMain(['library', '--url-pattern', 'http://h/{block}', '--bar', 'x', '--dir', dir], { log }), /--bar is a non-negative number/);
    await assert.rejects(gateMain(['exact', '--page', 'a', '--url', 'x.html', '--dir', dir], { log }), /figma-renders\.json is missing/);
    lines.length = 0;
    assert.equal(await donorMain(['--help'], { log }), 0);
    assert.match(lines.join('\n'), /renders <figma-url>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('libraryTarget: {page} is the EDS library page, the EDS block the measured class; default content the whole element', () => {
  const p = 'http://h/library/{page}';
  assert.deepEqual(libraryTarget(p, 'teaser', { eds: { block: 'cards', variant: 'teaser', page: 'cards' } }), { url: 'http://h/library/cards', cls: 'cards' });
  assert.deepEqual(libraryTarget(p, 'button', { eds: { block: null, variant: null, page: 'button' } }), { url: 'http://h/library/button', cls: null });
  assert.deepEqual(libraryTarget('http://h/{block}', 'chips', {}), { url: 'http://h/chips', cls: 'chips' }, 'no eds (an older renders file): the kit key');
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
