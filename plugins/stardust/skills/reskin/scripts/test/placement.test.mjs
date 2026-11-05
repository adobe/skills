#!/usr/bin/env node
// skills/reskin/scripts/test/placement.test.mjs — a section sidebar is placed beside the content, never stacked after
// it (two recorded migrations rendered the source's left section-nav above the footer: the sidebar follows <main> in the
// source DOM and is moved left by CSS, and every stage read DOM order only). Pure cases: placement.mjs on the recorded
// geometry, stream-render's rail grid and --check, source-coverage S4. Page cases (playwright; skip line otherwise):
// capture marks the sidebar rail-start and hidden on mobile, and S4 fails a target that stacks it, passes one that
// sets it beside the content.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentColumn, placements, railSide, regionOf } from '../placement.mjs';
import { checkMapping, render } from '../stream-render.mjs';
import { judge, railItems, targetRegion } from '../source-coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, '..', 'capture-content.mjs');
const GATE = join(HERE, '..', 'source-coverage.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'placement-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// The recorded source geometry at 1440 (an NSW school content page): breadcrumb over both columns, the content column
// with the h1, a 400px section sidebar on the left that follows <main> in the DOM.
const CRUMB = { rect: { x: 136, y: 196, w: 1168, h: 51 }, kind: 'breadcrumb', textLen: 30 };
const H1 = { rect: { x: 520, y: 247, w: 800, h: 900 }, hasH1: true, textLen: 1600 };
const BODY = { rect: { x: 520, y: 1147, w: 800, h: 3000 }, textLen: 17000 };
const SIDE = { rect: { x: 120, y: 247, w: 400, h: 350 }, textLen: 140 };

await check('placement: the recorded page — breadcrumb band, content main, sidebar rail-start', () => {
  const p = placements([CRUMB, H1, BODY, SIDE]).map((x) => x.region);
  assert.deepEqual(p, ['band', 'main', 'main', 'rail-start']);
  assert.equal(railSide('rail-start'), 'start');
  assert.equal(railSide('main'), null);
});

await check('placement: a rail on the end side, and a page with no rail is all main', () => {
  const col = contentColumn([H1, BODY]);
  assert.equal(regionOf({ x: 1340, y: 300, w: 300, h: 400 }, col), 'rail-end');
  // a single-column page: full-width bands and a narrow centred statement are the column, not rails
  const p = placements([{ rect: { x: 0, y: 100, w: 1440, h: 400 }, textLen: 900 }, { rect: { x: 445, y: 500, w: 550, h: 300 }, textLen: 200 }, { rect: { x: 0, y: 800, w: 1440, h: 300 }, textLen: 300 }]);
  assert.deepEqual(p.map((x) => x.region), ['main', 'main', 'main']);
});

await check('placement: a box below the content column is not a rail', () => {
  const col = contentColumn([H1, BODY]);
  assert.equal(regionOf({ x: 16, y: 4500, w: 1408, h: 300 }, col), 'band');
  assert.equal(regionOf({ x: 120, y: 4500, w: 400, h: 300 }, col), 'main', 'below the column (no vertical overlap) is in stream order');
});

const TOKENS = { palette: { pageBg: 'rgb(255, 255, 255)', bodyFg: 'rgb(0, 0, 0)' }, type: { family: 'Arial' }, layout: { containerMaxWidth: '1200px', sectionPaddingY: '40px' } };
const sec = (slot, extra = {}) => ({ slot, rootTag: 'div', visibleText: `${slot} text`, headings: [], ctas: [], images: [], ordered: [{ kind: 'paragraph', text: `${slot} text` }], ...extra });
const MODEL = {
  metadata: { title: 'Learning' },
  sections: [
    sec('s01', { rootTag: 'nav', rootClass: 'breadcrumbs', rect: CRUMB.rect, placement: { region: 'band' } }),
    sec('s02', { rect: H1.rect, placement: { region: 'main' }, ordered: [{ kind: 'heading', level: 'h1', text: 'Learning' }] }),
    sec('s03', { rect: BODY.rect, placement: { region: 'main' } }),
    sec('s04', { rootTag: 'aside', rect: SIDE.rect, placement: { region: 'rail-start', hiddenMobile: true }, ctas: [{ text: 'Careers', href: '/careers' }] }),
  ],
};
const mapping = (rail) => ({ pages: { learning: { slots: { s01: {}, s02: {}, s03: {}, s04: rail ? { rail } : {} } } } });

await check('stream-render: rail start → main grid, the rail beside the content rows, the breadcrumb spanning both', () => {
  const { html, warnings } = render({ slug: 'learning', model: MODEL, tokens: TOKENS, mapping: mapping('start') });
  assert.match(html, /<main class="site-main has-rail rail-start" style="--rail-width: 400px"/);
  const tag = (slot) => html.match(new RegExp(`<section class="([^"]*)"(?: style="([^"]*)")? data-slot="${slot}"`));
  assert.match(tag('s01')[1], /\bin-band\b/);
  assert.match(tag('s01')[2], /grid-row: 1/);
  assert.match(tag('s04')[1], /\bin-rail\b.*\brail-mobile-hidden\b/);
  assert.match(tag('s04')[2], /grid-row: 2 \/ 4/, 'the rail spans the content rows after the band');
  assert.match(tag('s03')[2], /grid-row: 3/);
  assert.match(html, /\.site-main\.has-rail > section\.in-rail \{ grid-column: 1; \}/);
  assert.match(html, /\.site-main\.has-rail > section\.rail-mobile-hidden \{ display: none; \}/);
  assert.doesNotMatch(html, /<main class="[^"]*rail-reorder/, 'a hidden rail keeps normal flow on a phone (a flex column would stop margins collapsing)');
  const top = render({ slug: 'learning', model: MODEL, tokens: TOKENS, mapping: { pages: { learning: { slots: { s04: { rail: 'start', railMobile: 'top' } } } } } });
  assert.match(top.html, /<main class="site-main has-rail rail-start rail-reorder"/);
  assert.deepEqual(warnings.filter((w) => /rail/.test(w)), []);
});

await check('stream-render: no rail key → stream order, no grid (the recorded failure shape)', () => {
  const { html } = render({ slug: 'learning', model: MODEL, tokens: TOKENS, mapping: mapping(null) });
  assert.match(html, /<main class="site-main" data-template/);
  assert.doesNotMatch(html, /class="[^"]*in-rail/);
});

await check('--check: a source rail slot the mapping does not place is a problem; rail start | none pass', () => {
  const miss = checkMapping(mapping(null), { models: { learning: MODEL } });
  assert.equal(miss.length, 1);
  assert.match(miss[0], /pages\.learning\.slots\.s04: the source sets this slot as a start rail beside the content \(placement rail-start, 400px, hidden on mobile\) — set "rail": "start"/);
  assert.deepEqual(checkMapping(mapping('start'), { models: { learning: MODEL } }), []);
  assert.deepEqual(checkMapping(mapping('none'), { models: { learning: MODEL } }), []);
  const bad = checkMapping({ pages: { learning: { slots: { s04: { rail: 'left', railMobile: 'side', railWidth: 'wide', band: 'yes' } } } } });
  assert.equal(bad.length, 4);
});

await check('source-coverage S4: beside → carried, stacked → FAIL, declared move → declared', () => {
  const items = railItems(MODEL);
  assert.deepEqual(items.map((i) => [i.key, i.region]), [['s04', 'rail-start']]);
  const beside = { rect: SIDE.rect, items: [H1, BODY].map((x) => ({ rect: x.rect, hasH1: !!x.hasH1, textLen: x.textLen })) };
  const stacked = { rect: { x: 0, y: 4200, w: 1440, h: 350 }, items: beside.items };
  assert.equal(targetRegion(beside), 'rail-start');
  assert.equal(targetRegion(stacked), 'band');
  const none = { residue: [], tones: [], placement: [], blocking: true };
  const t = (m) => ({ regions: [], slotTones: {}, rails: { s04: m } });
  const s4 = (res) => res.rows.find((r) => r.check === 'S4');
  assert.equal(s4(judge(MODEL, t(beside), none, 20)).verdict, 'carried');
  const fail = judge(MODEL, t(stacked), none, 20);
  assert.equal(s4(fail).verdict, 'FAIL');
  assert.match(fail.verdict, /^FAIL/);
  const declared = { ...none, placement: [{ slot: 's04', to: 'band', why: 'the donor has no rail; section nav as a band' }] };
  assert.equal(s4(judge(MODEL, t(stacked), declared, 20)).verdict, 'declared');
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  placement page cases (playwright not importable here; run this test where it is)'); }

if (playwrightOk) {
  const SOURCE = `<!doctype html><html><head><title>Learning</title><style>
    body{margin:0;font:16px Arial} .crumbs{padding:20px 120px} .layout{display:flex;padding:0 120px}
    main{width:800px;order:2} aside{width:400px;order:1}
    @media (max-width: 900px){ aside{display:none} main{width:auto} }
  </style></head><body><header>Site</header><div class="crumbs"><nav class="breadcrumbs"><a href="/">Home</a> <a href="/l">Learning</a></nav></div>
  <div class="layout"><main><section><h1>Learning</h1><p>${'Body copy. '.repeat(80)}</p></section><section><h2>More</h2><p>${'More copy. '.repeat(80)}</p></section></main>
  <aside class="sidebar"><h2>Section navigation</h2><ul><li><a href="/a">Careers</a></li><li><a href="/b">Wellbeing</a></li></ul></aside></div><footer>Footer</footer></body></html>`;
  const src = join(scratch, 'source.html');
  writeFileSync(src, SOURCE);
  const out = join(scratch, 'model');
  const cap = spawnSync(process.execPath, [CAPTURE, '--url', pathToFileURL(src).href, '--scope', 'nav.breadcrumbs!,main,aside.sidebar!', '--out', out], { encoding: 'utf8' });
  const model = cap.status === 0 ? JSON.parse(readFileSync(join(out, 'content-model.json'), 'utf8')) : null;

  await check('capture: the sidebar after <main> in the DOM is placed rail-start and hidden on mobile', () => {
    assert.equal(cap.status, 0, cap.stderr);
    const bySlot = Object.fromEntries(model.sections.map((s) => [s.slot, s.placement]));
    assert.equal(bySlot.s01.region, 'band');
    assert.equal(bySlot.s02.region, 'main');
    assert.deepEqual(bySlot.s04, { region: 'rail-start', hiddenMobile: true });
    assert.match(cap.stdout, /placement: s04 rail-start \(400px, hidden on mobile\)/);
  });

  const gate = (name, body) => {
    const t = join(scratch, `${name}.html`);
    writeFileSync(t, `<!doctype html><html><head><style>body{margin:0;font:16px Arial} ${body.css}</style></head><body><main class="m">${body.html}</main></body></html>`);
    return spawnSync(process.execPath, [GATE, '--model', join(out, 'content-model.json'), '--target', t], { encoding: 'utf8' });
  };
  const CRUMBS = '<section data-slot="s01"><a href="/">Home</a> <a href="/l">Learning</a></section>';
  const CONTENT = `<section data-slot="s02"><h1>Learning</h1><p>${'Body copy. '.repeat(80)}</p></section><section data-slot="s03"><h2>More</h2><p>${'More copy. '.repeat(80)}</p></section>`;
  const RAIL = '<section data-slot="s04"><h2>Section navigation</h2><ul><li><a href="/a">Careers</a></li><li><a href="/b">Wellbeing</a></li></ul></section>';

  await check('source-coverage S4: a target that stacks the sidebar after the content FAILs', () => {
    if (!model) throw new Error('capture failed');
    const r = gate('stacked', { css: '', html: CRUMBS + CONTENT + RAIL });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /S4 FAIL\s+s04 rail-start → /);
  });

  await check('source-coverage S4: a target that sets it beside the content passes', () => {
    if (!model) throw new Error('capture failed');
    const css = '.m{display:grid;grid-template-columns:400px 800px;padding:0 120px} .m>section{grid-column:2} .m>[data-slot=s01]{grid-column:1/-1;grid-row:1} .m>[data-slot=s02]{grid-row:2} .m>[data-slot=s03]{grid-row:3} .m>[data-slot=s04]{grid-column:1;grid-row:2/4;align-self:start}';
    const r = gate('beside', { css, html: CRUMBS + CONTENT + RAIL });
    assert.match(r.stdout, /S4 carried\s+s04 rail-start → rail-start/);
    assert.equal(r.status, 0, r.stdout);
  });
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
