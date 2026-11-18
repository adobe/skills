#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — chrome-parity.mjs. Pure (no browser): region choice by landmark
// (a nested card <header> is never the page header; unresolved / implausible → input error, exit 4, never 2), text
// channels and rest state (aria-label ↔ visually-hidden text is one advisory NAMES line, a name in no channel stays
// MISSING; closed-panel text left out on both sides, an open panel's kept; --strict-names restores), a declared font
// substitution (within the bound → one advisory GLYPH WIDTH line, beyond → failing, undeclared → unchanged),
// region-relative geometry (a region moved by the body height → one advisory REGION OFFSET, an internal delta keeps its
// PAIR lines; --strict-region-offset fails), icons paired by pixels, the accepted list, the live cache (probe version,
// overlay state, the --live-only record a comparison reads), --help with no browser. Then end to end where playwright
// is importable (a skip line otherwise), on local fixtures only: the auto-detected header page, and a live page with a
// pre-header promo bar, an aria-label icon link, a closed mega-menu panel, against a build that authors the name as
// hidden text, has no promo bar, renders wider glyphs under a declared substitution and is 20 px taller — exit 0 with
// advisory groups only; one real defect per variant → exit 2 with exactly that finding.
// Run: node <this file>.   Serve the fixtures only: node <this file> --serve [port] [host].
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_INPUT, PROBE_VERSION, briefRegion, cacheKey, chooseRegion, compareRegion, findingLine, inventoryRegion, markAccepted, pairNames, parseArgs,
  parseFontSubst, readLiveCache, regionLine, regionPlausibility, relRect, restInventory, substitutionFor, summaryLine, tally, writeLiveCache,
} from '../chrome-parity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'chrome-parity.mjs');
const SERVE = process.argv.includes('--serve');
let failed = 0;
const check = async (name, fn) => { if (SERVE) return; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// ---- pure ------------------------------------------------------------------------------------------
const atom = (text, y, o = {}) => ({ key: text.toLowerCase(), text, tag: 'a', boxTag: 'a', rect: { x: 24, y, w: 60, h: 24 }, box: { x: 24, y, w: 60, h: 24 }, style: { color: 'rgb(0, 0, 0)' }, boxStyle: null, ...o });
const nav = (y) => ['Pricing', 'Login', 'Docs'].map((t) => atom(t, y));
const logo = Array.from({ length: 12 * 12 * 3 }, (_, i) => (Math.floor(i / 3) % 3 ? 40 : 230)); // a 12×12 RGB grid, grey
const probe = (o = {}) => ({ found: true, sel: 'footer', rect: { x: 0, y: 1000, w: 800, h: 200 }, position: 'static', backgroundColor: 'rgb(18, 23, 55)', atoms: [], icons: [], ...o });
const kinds = (r) => r.findings.map((f) => [f.kind, Boolean(f.advisory)]);

// H1 — region resolution
const cand = (ref, o = {}) => ({ ref, order: Number(ref.split('-')[1]), source: 'tag', hint: `header.${ref}`, path: `body > header:nth-of-type(${Number(ref.split('-')[1]) + 1})`, rect: { x: 0, y: 0, w: 1440, h: 80 }, visible: true, position: 'static', links: 6, hasNav: true, nestedIn: null, ancestors: [], ...o });
const VP = { width: 1440, contentBottom: 5000 };
await check('chooseRegion (header): a pre-header promo bar and a card <header> nested in an article are never chosen — the outermost full-width <header> with the nav is; [role=banner] wins over the tag', () => {
  const promo = cand('header-0', { hint: 'header.promo', rect: { x: 0, y: 0, w: 1440, h: 40 }, links: 1, hasNav: false });
  const site = cand('header-1', { hint: 'header.site', rect: { x: 0, y: 40, w: 1440, h: 96 } });
  const card = cand('header-2', { hint: 'header.card__head', rect: { x: 120, y: 700, w: 380, h: 60 }, links: 1, hasNav: false, nestedIn: 'article.card' });
  const pick = chooseRegion('header', [promo, site, card], VP);
  assert.equal(pick.chosen.ref, 'header-1'); assert.match(pick.how, /^outermost <header>, the one with the nav \/ most links of 2$/);
  assert.deepEqual(pick.rejected.map((r) => r.why), ['nested in article.card', 'another candidate ranks first']);
  const banner = cand('header-3', { source: 'role', hint: 'div.masthead[role=banner]', rect: { x: 0, y: 40, w: 1440, h: 96 }, links: 2, hasNav: false });
  assert.equal(chooseRegion('header', [promo, site, card, banner], VP).chosen.ref, 'header-3');
  assert.match(chooseRegion('header', [promo, site, card, banner], VP).how, /^\[role=banner\] landmark/);
});
await check('chooseRegion: "outermost" never crosses tiers upward — a banner landmark inside an auto-detected full-width wrapper is still the landmark; a <header> inside the banner is not chosen', () => {
  const wrap = cand('header-0', { source: 'auto', hint: 'div.wrap', rect: { x: 0, y: 0, w: 1440, h: 120 } });
  const banner = cand('header-1', { source: 'role', hint: 'header[role=banner]', rect: { x: 0, y: 0, w: 1440, h: 96 }, ancestors: ['header-0'] });
  const pick = chooseRegion('header', [wrap, banner], VP);
  assert.equal(pick.chosen.ref, 'header-1'); assert.match(pick.how, /^\[role=banner\] landmark/);
  const inner = cand('header-2', { source: 'tag', hint: 'header.inner', ancestors: ['header-1'] });
  assert.equal(chooseRegion('header', [banner, inner], VP).chosen.ref, 'header-1');
  assert.match(chooseRegion('header', [banner, inner], VP).rejected.find((r) => r.hint === 'header.inner').why, /not the outermost/);
});
await check('chooseRegion: only a nested card <header>, a 240 px wide <header>, a hidden one or one far from the top → unresolved with the reasons (the auto-detected bar is the last resort); the inner of two nested <header>s is not the outermost', () => {
  const card = cand('header-0', { nestedIn: 'main', rect: { x: 0, y: 300, w: 1440, h: 60 } });
  const narrow = cand('header-1', { rect: { x: 0, y: 0, w: 240, h: 900 } });
  const hidden = cand('header-2', { visible: false });
  const low = cand('header-3', { rect: { x: 0, y: 2400, w: 1440, h: 80 } });
  const none = chooseRegion('header', [card, narrow, hidden, low], VP);
  assert.equal(none.chosen, null);
  assert.match(none.reason, /^no header resolved \(4 candidate\(s\): header\.header-0 nested in main; header\.header-1 240px wide, under 60% of the 1440px viewport; header\.header-2 not rendered; header\.header-3 starts at y 2400, not at the top\)$/);
  assert.match(chooseRegion('header', [], VP).reason, /no landmark, no <header>, nothing auto-detected/);
  const auto = cand('header-4', { source: 'auto', hint: 'div.bar' });
  const pick = chooseRegion('header', [card, narrow, auto], VP);
  assert.equal(pick.chosen.ref, 'header-4'); assert.match(pick.how, /^auto-detected/);
  const outer = cand('header-5'); const inner = cand('header-6', { ancestors: ['header-5'], links: 9 });
  assert.equal(chooseRegion('header', [inner, outer], VP).chosen.ref, 'header-5');
});
await check('chooseRegion (footer): the <footer> at the document end with the most links — never an article\'s <footer> or one ending far above the end', () => {
  const quote = cand('footer-0', { hint: 'footer.quote', nestedIn: 'article.post', rect: { x: 0, y: 900, w: 1440, h: 80 } });
  const mid = cand('footer-1', { hint: 'footer.band', rect: { x: 0, y: 2000, w: 1440, h: 200 }, links: 40 });
  const site = cand('footer-2', { hint: 'footer.site', rect: { x: 0, y: 4500, w: 1440, h: 440 }, links: 30 });
  const legal = cand('footer-3', { hint: 'footer.legal', rect: { x: 0, y: 4940, w: 1440, h: 60 }, links: 3 });
  const pick = chooseRegion('footer', [quote, mid, site, legal], VP);
  assert.equal(pick.chosen.ref, 'footer-2');
  assert.deepEqual(pick.rejected.map((r) => r.why), ['nested in article.post', 'ends 2800px before the document end', 'another candidate ranks first']);
});
await check('an unresolved or implausible region is an INPUT error — exit 4, never 2 — and the summary line says so; a --region selector pair is taken as given', () => {
  const none = compareRegion('header', { found: false, sel: 'header landmark', unresolved: 'no header resolved (1 candidate(s): header.card nested in main)' }, probe({ sel: 'header' }), 1, { width: 1440 });
  assert.match(none.inputError, /^live: no header resolved/);
  assert.equal(tally([none]).exit, EXIT_INPUT); assert.equal(EXIT_INPUT, 4); assert.equal(tally([none]).deltas, 0);
  assert.match(summaryLine(tally([none])), /^⚠ input error \(exit 4\) — no parity verdict: header \(live: no header resolved/);
  const res = { how: 'outermost <header>', hint: 'header', selector: 'body > header' };
  const side = (rect, resolved = res) => probe({ sel: 'body > header', rect, ...(resolved ? { resolved } : {}) });
  assert.match(regionPlausibility(side({ x: 0, y: 0, w: 240, h: 900 }), side({ x: 0, y: 0, w: 1440, h: 80 }), 1440), /^live region is 240px wide, under a third of the 1440px viewport/);
  assert.match(regionPlausibility(side({ x: 0, y: 0, w: 1440, h: 80 }), side({ x: 0, y: 0, w: 1440, h: 400 }), 1440), /^region heights differ by more than ×4 \(live 80px, build 400px\)/);
  assert.equal(regionPlausibility(side({ x: 0, y: 0, w: 1440, h: 80 }), side({ x: 0, y: 0, w: 1440, h: 300 }), 1440), null, '×3.75 is a delta, not an input error');
  assert.equal(regionPlausibility(side({ x: 0, y: 0, w: 240, h: 900 }, null), side({ x: 0, y: 0, w: 1440, h: 80 }, null), 1440), null, 'explicit selectors are not second-guessed');
  const odd = compareRegion('header', side({ x: 0, y: 0, w: 240, h: 900 }), side({ x: 0, y: 0, w: 1440, h: 80 }), 1, { width: 1440 });
  const gone = { found: false, sel: 'footer landmark', unresolved: 'no footer resolved' };
  const buildLacks = compareRegion('footer', probe({ atoms: nav(1020) }), gone, 1, { width: 1440 });
  assert.equal(buildLacks.inputError, undefined); assert.equal(buildLacks.findings.length, 1); assert.equal(buildLacks.findings[0].kind, 'MISSING'); assert.ok(!buildLacks.findings[0].advisory, 'the source has it, the build does not: a failing finding');
  const liveLacks = compareRegion('footer', gone, probe({ atoms: nav(1020) }), 1, { width: 1440 });
  assert.match(liveLacks.inputError, /live: no footer resolved/, 'unresolved on the live side stays an input error');
  const real = compareRegion('footer', probe({ atoms: nav(1020) }), probe({ atoms: nav(1020).slice(1) }), 1, { width: 1440 });
  assert.deepEqual([tally([odd]).exit, tally([real]).exit, tally([odd, real]).exit], [4, 2, 4]);
  assert.match(summaryLine(tally([odd, real])), /the other region\(s\): 1 delta\(s\)$/);
  assert.match(regionLine('live', odd.inputError ? { found: false, sel: 'header landmark', unresolved: 'no header resolved' } : null), /region live:\s+unresolved — no header resolved/);
  assert.match(regionLine('build', side({ x: 0, y: 40, w: 1440, h: 96 })), /^ {2}region build: header — outermost <header>, box 0,40 1440×96; selector body > header$/);
});

// H3 — channels, names, rest state
const srOnly = (text, o = {}) => atom(text, 20, { tag: 'span', channel: 'hidden-name', rect: { x: 0, y: 0, w: 1, h: 1 }, box: { x: 700, y: 20, w: 24, h: 24 }, ...o });
const attrName = (text, attr = 'aria-label') => ({ key: text.toLowerCase(), text, channel: 'attr-name', attr, tag: 'a', href: `/${text.toLowerCase()}` });
await check('names pair across channels: live aria-label ↔ build visually-hidden text (and the reverse) → ONE advisory NAMES line with the count, no EXTRA/MISSING; a name in no channel of the other side stays MISSING / EXTRA', () => {
  const L = probe({ atoms: [...nav(1020), srOnly('Instagram')], names: [attrName('Facebook'), attrName('Search'), attrName('Cart', 'title')] });
  const B = probe({ atoms: [...nav(1020), srOnly('Facebook'), srOnly('Search'), srOnly('Toggle Pricing submenu')], names: [attrName('Instagram', 'title')] });
  const r = compareRegion('footer', L, B, 1);
  assert.deepEqual(kinds(r), [['NAMES', true], ['MISSING', false], ['EXTRA', false]]);
  assert.match(r.findings[0].msg, /^3 carried by another channel \(hidden text ↔ title, aria-label ↔ hidden text\)$/);
  assert.match(findingLine(r.findings[0]), /^ {2}advisory {5}NAMES: 3 carried by another channel/);
  assert.match(r.findings[1].msg, /^live title "Cart" on <a> is in no channel of the build .* an accessible name was lost$/);
  assert.match(r.findings[2].msg, /^build hidden text "Toggle Pricing submenu" on <span> has no live source in any channel$/);
  assert.equal(tally([r]).deltas, 2); assert.equal(tally([r]).advisory, 1);
  const same = pairNames([attrName('Facebook'), attrName('X', 'title')], [attrName('Facebook', 'alt'), attrName('X')]);
  assert.deepEqual([same.carried.length, same.missing.length, same.extra.length], [0, 0, 0], 'attribute ↔ attribute is the same channel: quiet');
  const viaVisible = pairNames([attrName('Search')], [], [], ['search']);
  assert.deepEqual(viaVisible.carried.map((c) => `${c.live} ↔ ${c.build}`), ['aria-label ↔ visible text']);
});
await check('rest state: text inside a panel not shown at rest is left out on BOTH sides (count printed, advisory); an OPEN panel\'s text is kept — and missing on the build it is MISSING', () => {
  const panel = (rest) => ['Mega one', 'Mega two'].map((t) => atom(t, 1100, rest ? { rest } : {}));
  const closed = compareRegion('header', probe({ atoms: [...nav(1020), ...panel('opacity:0')] }), probe({ atoms: [...nav(1020), ...panel('off-canvas'), atom('Mega three', 1100, { rest: 'aria-hidden' })] }), 1);
  assert.deepEqual(kinds(closed), [['REST STATE', true]]);
  assert.match(closed.findings[0].msg, /^2 live \/ 3 build text\(s\) inside panels not shown at rest left out \(live: opacity:0 2; build: off-canvas 2, aria-hidden 1\) — --strict-names counts them$/);
  assert.equal(closed.inventory.live.atoms, 3);
  const oneSide = compareRegion('header', probe({ atoms: [...nav(1020), ...panel('opacity:0')] }), probe({ atoms: nav(1020) }), 1);
  assert.deepEqual(kinds(oneSide), [['REST STATE', true]], 'a closed panel captured on one side only is no delta');
  const open = compareRegion('header', probe({ atoms: [...nav(1020), ...panel(null)] }), probe({ atoms: nav(1020) }), 1);
  assert.deepEqual(kinds(open), [['MISSING', false], ['MISSING', false]]);
  const inv = restInventory(probe({ atoms: [...nav(0), srOnly('Search'), ...panel('opacity:0')], names: [attrName('Cart')], icons: [{ rect: {} }, { rect: {}, rest: 'opacity:0' }] }));
  assert.deepEqual([inv.visible.length, inv.names.length, inv.icons.length, inv.excluded], [3, 2, 1, 2]);
});
await check('--strict-names restores the earlier behaviour: hidden text and closed-panel text are visible text again (EXTRA / MISSING), attributes are not read', () => {
  const L = probe({ atoms: [...nav(1020), atom('Mega one', 1100, { rest: 'opacity:0' })], names: [attrName('Search')] });
  const B = probe({ atoms: [...nav(1020), srOnly('Search')] });
  assert.deepEqual(kinds(compareRegion('header', L, B, 1)), [['NAMES', true], ['REST STATE', true]]);
  const strict = compareRegion('header', L, B, 1, { strictNames: true });
  assert.deepEqual(strict.findings.map((f) => [f.kind, f.text]), [['MISSING', 'Mega one'], ['EXTRA', 'Search']]);
  assert.equal(tally([strict]).exit, 2);
});

// H4 — declared font substitution
const text = (t, x, w, family, o = {}) => atom(t, 1020, { rect: { x, y: 1020, w, h: 24 }, box: { x, y: 1020, w, h: 24 }, style: { fontFamily: family, fontSize: '16px', color: 'rgb(0, 0, 0)' }, ...o });
await check('font substitution: Δw/Δx within the bound (6 % of the live width, min 2 px) and Δh ≤ 2 px under a DECLARED substitution → ONE advisory GLYPH WIDTH line; beyond the bound, on another face, or with no declaration → failing PAIR lines as before', () => {
  const decl = parseFontSubst('"Brand Sans" = Arimo, Brand Serif=Tinos');
  assert.deepEqual(decl, [{ live: 'brand sans', build: 'arimo' }, { live: 'brand serif', build: 'tinos' }]);
  const L = probe({ atoms: [text('Products', 24, 100, 'brand sans'), text('Pricing', 200, 50, 'brand sans'), text('Docs', 300, 20, 'brand sans'), text('Legal', 400, 50, 'system-ui')] });
  const B = probe({ atoms: [text('Products', 24, 105, 'brand sans'), text('Pricing', 198, 53, 'arimo', { rect: { x: 198, y: 1020, w: 53, h: 26 }, box: { x: 198, y: 1020, w: 53, h: 26 } }), text('Docs', 300, 22, 'brand sans'), text('Legal', 400, 50, 'system-ui')] });
  const r = compareRegion('footer', L, B, 1, { fontSubst: decl });
  assert.deepEqual(r.findings, [{ kind: 'GLYPH WIDTH', advisory: true, msg: '3 pair(s) within 6% under the declared substitution brand sans→arimo' }]);
  assert.match(findingLine(r.findings[0]), /^ {2}advisory {5}GLYPH WIDTH: 3 pair\(s\) within 6% under the declared substitution brand sans→arimo$/);
  const none = compareRegion('footer', L, B, 1);
  assert.deepEqual(kinds(none), [['PAIR', false], ['PAIR', false], ['PAIR', false]], 'no declaration → unchanged');
  assert.match(none.findings[0].msg, /^Δw \+5px \(100→105\)$/);
  const wide = compareRegion('footer', probe({ atoms: [text('Products', 24, 100, 'brand sans'), text('Legal', 400, 50, 'system-ui')] }), probe({ atoms: [text('Products', 24, 109, 'brand sans'), text('Legal', 400, 53, 'system-ui')] }), 1, { fontSubst: decl });
  assert.deepEqual(wide.findings.map((f) => [f.kind, f.text, Boolean(f.advisory)]), [['PAIR', 'Products', false], ['PAIR', 'Legal', false]], '9 % wider is beyond the bound; another face is never collapsed');
  const tight = compareRegion('footer', L, B, 1, { fontSubst: decl, fontSubstTol: 3 });
  assert.deepEqual(tight.findings.map((f) => f.kind).sort(), ['GLYPH WIDTH', 'PAIR', 'PAIR'], '--font-subst-tol 3: 5 % and 6 % are beyond, the 2 px minimum still covers the short text');
  const alsoSmaller = compareRegion('footer', probe({ atoms: [text('Products', 24, 100, 'brand sans')] }), probe({ atoms: [text('Products', 24, 103, 'brand sans', { style: { fontFamily: 'brand sans', fontSize: '14px', color: 'rgb(0, 0, 0)' } })] }), 1, { fontSubst: decl });
  assert.deepEqual(alsoSmaller.findings.map((f) => f.msg), ['fontSize 16px → 14px; Δw +3px (100→103)'], 'a pair with any other delta keeps its whole line');
  assert.equal(substitutionFor(text('a', 0, 10, 'brand sans'), text('a', 0, 10, 'verdana'), decl), null, 'an undeclared build face');
});
await check('font substitution: the declared pairs of one mapping are ONE line (the count), with the substitute as the build\'s first family too', () => {
  const decl = parseFontSubst('Brand Sans=Arimo');
  const L = probe({ atoms: [text('Products', 24, 100, 'brand sans'), text('Pricing', 200, 50, 'brand sans')] });
  const B = probe({ atoms: [text('Products', 24, 104, 'arimo'), text('Pricing', 201, 52, 'brand sans')] });
  const r = compareRegion('footer', L, B, 1, { fontSubst: decl });
  assert.deepEqual(r.findings, [{ kind: 'GLYPH WIDTH', advisory: true, msg: '2 pair(s) within 6% under the declared substitution brand sans→arimo' }]);
  assert.equal(summaryLine(tally([r])), '✓ chrome parity within tolerance, 1 advisory group(s) — run crop-compare (pass bar item 5) to confirm in pixels.');
});

// H5 — region-relative geometry
await check('a footer displaced by the body height → ONE advisory REGION OFFSET line and no PAIR line; a footer with an internal delta keeps its per-pair lines (region-relative); --strict-region-offset fails the offset', () => {
  const foot = (y, links) => probe({ rect: { x: 0, y, w: 800, h: 200 }, atoms: nav(links) });
  const moved = compareRegion('footer', foot(1000, 1020), foot(986, 1006), 1);
  assert.deepEqual(kinds(moved), [['REGION OFFSET', true]]);
  assert.match(moved.findings[0].msg, /^page Δy -14px \(1000→986\) — the region sits at another page y as one block .*; the main content gate owns that height \(--strict-region-offset fails it here\)$/);
  assert.equal(tally([moved]).exit, 0);
  const B = foot(986, 1006); B.atoms[1] = atom('Login', 1014); B.rect.h = 208;
  const internal = compareRegion('footer', foot(1000, 1020), B, 1);
  assert.deepEqual(internal.findings.map((f) => [f.kind, f.text || null, f.msg.replace(/ — .*/, '')]), [['REGION BOX', null, 'Δh +8px (200→208)'], ['REGION OFFSET', null, 'page Δy -14px (1000→986)'], ['PAIR', 'Login', 'Δy +8px (20→28)']]);
  assert.equal(tally([internal]).deltas, 2);
  const strict = compareRegion('footer', foot(1000, 1020), foot(986, 1006), 1, { strictRegionOffset: true });
  assert.deepEqual(kinds(strict), [['REGION OFFSET', false]]); assert.equal(tally([strict]).exit, 2);
  assert.deepEqual(relRect({ x: 30, y: 1020, w: 60, h: 24 }, { x: 10, y: 1000, w: 800, h: 200 }), { x: 20, y: 20, w: 60, h: 24 });
});
await check('compareRegion: a fixed-height header whose links all sit 8 px low → 3 counted PAIR deltas (exit 2); the header and its links all 8 px low → one advisory REGION OFFSET (exit 0)', () => {
  const hdr = (y, links) => probe({ sel: 'header', rect: { x: 0, y, w: 800, h: 64 }, atoms: nav(links) });
  const low = compareRegion('header', hdr(0, 20), hdr(0, 28), 1);
  assert.deepEqual(kinds(low), [['PAIR', false], ['PAIR', false], ['PAIR', false]]);
  const block = compareRegion('header', hdr(0, 20), hdr(8, 28), 1);
  assert.deepEqual(kinds(block), [['REGION OFFSET', true]]);
});

await check('compareRegion: icons with other file names but the same pixels are no delta; different pixels with another name are', () => {
  const icon = (sig, px) => ({ tag: 'img', rect: { x: 10, y: 1010, w: 80, h: 80 }, sig, px, near: 'case study' });
  const same = compareRegion('footer', probe({ icons: [icon('thumb.webp', logo)] }), probe({ icons: [icon('media_1a2b.webp', logo)] }), 1);
  assert.deepEqual(same.findings, []);
  const other = compareRegion('footer', probe({ icons: [icon('thumb.webp', logo)] }), probe({ icons: [icon('media_9z.webp', logo.map((v) => 255 - v))] }), 1);
  assert.deepEqual(other.findings.map((f) => f.kind), ['ICON']);
});
await check('markAccepted: an accepted-list entry (probe chrome-parity or none, kind, text, region) marks the delta accepted + advisory with its reason; a content-diff entry or another region does not', () => {
  const region = () => ({ name: 'footer', findings: [{ kind: 'REGION STYLE', msg: 'backgroundColor rgb(18, 23, 55) → rgba(0, 0, 0, 0)' }, { kind: 'MISSING', text: 'Careers', msg: 'live <a> "Careers" has no build element with the same text' }] });
  const r = markAccepted(region(), [{ probe: 'chrome-parity', kind: 'MISSING', text: 'careers', reason: 'page retired, link dropped by the owner' }, { probe: 'content-diff', kind: 'REGION STYLE', reason: 'x' }, { kind: 'REGION STYLE', root: 'header', reason: 'y' }]);
  assert.deepEqual(r.findings.map((f) => [f.kind, f.accepted || null, Boolean(f.advisory)]), [['REGION STYLE', null, false], ['MISSING', 'page retired, link dropped by the owner', true]]);
  assert.deepEqual([tally([r]).deltas, tally([r]).advisory, tally([r]).accepted], [1, 0, 1], 'an accepted delta is counted as accepted, not as an advisory group');
  assert.match(summaryLine(tally([r])), /^✗ 1 delta\(s\), 1 accepted — /);
  assert.match(findingLine(r.findings[1]), /^ {2}🟢 MISSING .* — accepted: page retired/);
});
await check('markAccepted matches text inside the delta\'s own text, never its message wording; a text entry never matches a text-less delta; a kind-only entry accepts every delta of the kind', () => {
  const region = () => ({ name: 'header', findings: [{ kind: 'MISSING', text: 'Careers', msg: 'live <a> "Careers" has no build element with the same text' }, { kind: 'MISSING', text: 'Blog', msg: 'live <a> "Blog" has no build element with the same text' }, { kind: 'REGION STYLE', msg: 'position sticky → static' }] });
  const acc = (list) => markAccepted(region(), list).findings.filter((f) => f.accepted).map((f) => f.text || f.kind);
  assert.deepEqual(acc([{ kind: 'MISSING', text: 'element', reason: 'x' }]), [], 'message wording is not the subject');
  assert.deepEqual(acc([{ kind: 'REGION STYLE', text: 'sticky', reason: 'x' }]), [], 'no text on the delta → no text match');
  assert.deepEqual(acc([{ kind: 'MISSING', text: 'blog', reason: 'x' }]), ['Blog']);
  assert.deepEqual(acc([{ kind: 'MISSING', reason: 'kind-only' }]), ['Careers', 'Blog']);
});
await check('--live-cache: a cache from another probe version (or none recorded), another overlay state or locale is ignored and re-probed; the current one is reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-parity-'));
  const opts = { width: 1440, regions: [{ name: 'header', live: 'header' }] };
  const file = join(dir, 'chrome-live.json');
  try {
    const oldKey = cacheKey('https://x.test/', opts); delete oldKey.probe;
    writeFileSync(file, JSON.stringify({ key: oldKey, probedAt: 'then', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts), null, 'a pre-version cache');
    writeFileSync(file, JSON.stringify({ key: { ...oldKey, probe: PROBE_VERSION - 1 }, probedAt: 'then', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts), null, 'an older probe version');
    writeFileSync(file, JSON.stringify({ key: cacheKey('https://x.test/', opts), probedAt: 'now', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts).probedAt, 'now');
    assert.equal(readLiveCache(file, 'https://x.test/', { ...opts, noDismiss: true }), null, 'another overlay state');
    assert.equal(readLiveCache(file, 'https://x.test/', { ...opts, locale: 'en-GB' }), null, 'another locale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('--live-only: the argument shape, the cache record a comparison then reads (resolved selectors on top), the inventory and the brief', () => {
  const bad = []; const fail = (m) => { bad.push(m); return null; };
  const lo = parseArgs(['node', 'x', 'https://x.test/', '--live-only', '--width', '390', '--json', 'out/inv.json', '--live-cache', 'g/chrome-live.json', '--locale', 'en-GB'], fail);
  assert.deepEqual([lo.opts.liveOnly, lo.opts.width, lo.opts.jsonFile, lo.build, lo.opts.regions.map((r) => `${r.name}=${r.live}`)], [true, 390, 'out/inv.json', undefined, ['header=@landmark', 'footer=@landmark']]);
  parseArgs(['node', 'x', 'https://x.test/', 'http://b/', '--live-only'], fail); parseArgs(['node', 'x', 'https://x.test/'], fail); parseArgs(['node', 'x', 'a', 'b', '--font-subst', 'nope'], fail);
  assert.deepEqual(bad, ['--live-only takes <liveURL> alone', 'need <liveURL> and <buildURL>', 'bad --font-subst "nope" — expected "<live family>=<build family>[,…]"']);
  const cmp = parseArgs(['node', 'x', 'https://x.test/', 'http://b/', '--width', '390', '--live-cache', 'g/chrome-live.json', '--locale', 'en-GB', '--json', '--font-subst', 'Brand Sans=Arimo', '--region', 'header=#top|header.site'], fail);
  assert.deepEqual([cmp.opts.json, cmp.opts.jsonFile, cmp.opts.fontSubst, cmp.opts.regions.map((r) => `${r.name}=${r.live}`)], [true, null, [{ live: 'brand sans', build: 'arimo' }], ['header=#top', 'footer=@landmark']]);
  const data = {
    header: probe({ sel: 'body > header:nth-of-type(2)', rect: { x: 0, y: 40, w: 390, h: 64 }, backgroundColor: 'rgb(255, 255, 255)', backgroundImage: 'none', position: 'sticky', resolved: { how: 'outermost <header>', hint: 'header.site', selector: 'body > header:nth-of-type(2)' }, atoms: [atom('Pricing', 60, { href: '/pricing', style: { fontFamily: 'brand sans', fontSize: '16px', lineHeight: '24px', fontWeight: '400', color: 'rgb(0, 0, 0)' } }), srOnly('Menu'), atom('Mega one', 200, { rest: 'opacity:0' })], names: [attrName('Search')], notShown: { 'display:none': 4 }, icons: [{ tag: 'svg', kind: 'inline svg', rect: { x: 0, y: 0, w: 24, h: 24 }, sig: 'viewBox=0 0 24 24 paths=1', near: 'Search' }], bgIcons: [], triggers: [{ tag: 'button', name: 'Menu', expanded: 'false' }] }),
    footer: { found: false, sel: 'footer landmark', unresolved: 'no footer resolved (no landmark, no <footer>, nothing auto-detected)' },
  };
  const dir = mkdtempSync(join(tmpdir(), 'chrome-parity-'));
  try {
    const file = join(dir, 'g', 'chrome-live.json');
    writeLiveCache(file, 'https://x.test/', lo.opts, data, 'then');
    const hit = readLiveCache(file, 'https://x.test/', { ...cmp.opts, regions: lo.opts.regions });
    assert.equal(hit.probedAt, 'then', 'a comparison at the same url, width, regions, overlay settings and locale reads the --live-only capture');
    assert.deepEqual(hit.regions, { header: { selector: 'body > header:nth-of-type(2)', how: 'outermost <header>', box: { x: 0, y: 40, w: 390, h: 64 } }, footer: { unresolved: 'no footer resolved (no landmark, no <footer>, nothing auto-detected)' } });
    assert.deepEqual(hit.data.header.rect, { x: 0, y: 40, w: 390, h: 64 });
    assert.equal(readLiveCache(file, 'https://x.test/', cmp.opts), null, 'another region selector re-probes');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const inv = inventoryRegion(data.header);
  assert.deepEqual(inv.counts, { visible: 1, hiddenName: 1, attrName: 1, notAtRest: 1, icons: 1 });
  assert.deepEqual(inv.links, [{ name: 'Pricing', href: '/pricing', channel: 'visible' }, { name: 'Search', href: '/search', channel: 'attr-name' }]);
  const brief = briefRegion('header', data.header).join('\n');
  assert.match(brief, /^■ header: box 0,40 390×64, position sticky, background rgb\(255, 255, 255\)\n {2}region live: +header\.site — outermost <header>/);
  assert.match(brief, /texts: 1 visible, 1 hidden-name, 1 attr-name; 1 inside panels not shown at rest, 4 with no box; icons: 1 \(svg\/img\); panel triggers: 1/);
  assert.match(brief, /<a> "Pricing" → \/pricing {2}24,20 60×24 {2}brand sans 16px\/24px 400 rgb\(0, 0, 0\)/);
  assert.match(brief, /inline svg 24×24 viewBox=0 0 24 24 paths=1 near "Search"/);
  assert.match(brief, /<a> aria-label="Search" → \/search/);
  assert.match(brief, /panel triggers: <button> "Menu" \[aria-expanded=false\]/);
  assert.deepEqual(briefRegion('footer', data.footer), ['■ footer: UNRESOLVED — no footer resolved (no landmark, no <footer>, nothing auto-detected)']);
});
await check('--help answers with no browser and documents the input-error exit code and the new flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^chrome-parity — /);
  for (const flag of ['--live-only', '--font-subst ', '--font-subst-tol', '--strict-names', '--strict-region-offset', '4 input error']) assert.ok(r.stdout.includes(flag), flag);
});

// ---- fixtures (local pages only) -------------------------------------------------------------------
const mark = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#fff"/><circle cx="12" cy="12" r="10" fill="#e33"/></svg>';
const glass = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="none" stroke="#123" stroke-width="2"/><path d="M15 15l6 6" stroke="#123" stroke-width="2"/></svg>';
function fixturePages() {
  // 1 — a page with no <header> (auto-detected), display:contents titles, the footer background on a wrapper
  const css = '<style>body{margin:0;font:16px/24px Arial}.bar{position:fixed;top:0;left:0;right:0;height:64px;background:#fff;display:flex;gap:24px;align-items:center;padding:0 24px}.bar a{color:#123;text-decoration:none}main{padding-top:64px}.fill{height:900px}footer{color:#fff}h3{margin:0;font-size:14px}.cols{display:flex;gap:40px;padding:32px}.cols>div{display:flex;flex-direction:column}</style>';
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${body}</body></html>`;
  const footerCols = (titleTag) => `<div class="cols"><div><${titleTag}>Trending</${titleTag}><a href="/t">Topics</a></div><div><${titleTag}>Company</${titleTag}><a href="/a">About</a></div></div>`;
  const pages = {
    '/live.html': page(`<div class="bar megaMenuWrapper"><a href="/">${mark}</a><a href="/p">Pricing</a><a href="/l">Login</a></div><main><div class="fill"></div></main>`
      + `<footer style="background:#121737">${footerCols('div')}</footer>`),
    '/build.html': page(`<header class="bar"><a href="/"><img src="data:image/svg+xml,${encodeURIComponent(mark)}" width="40" height="24" alt=""></a><a href="/p">Pricing</a><a href="/l">Login</a></header><main><div class="fill"></div><div style="height:200px"></div></main>`
      + `<footer><div style="background:#121737">${footerCols('h3').replace(/<h3>/g, '<h3 style="display:contents">')}</div></footer>`),
  };
  // the live side's footer titles are divs with the same look as the build's h3
  pages['/live.html'] = pages['/live.html'].replace('</style>', '.cols div>div{font-size:14px;font-weight:700}</style>');

  // 2 — the chrome a migration meets: a pre-header promo bar (a <header> too), a card <header> in main, an icon link
  // named by aria-label, a closed mega-menu panel, a licensed face. The build: no promo bar, the name as hidden text,
  // the panel closed another way, the substitute face (4 % wider glyphs), 20 px more main content.
  const faces = 'local("Arial"), local("Liberation Sans"), local("Helvetica"), local("DejaVu Sans")';
  const chrome = (o = {}) => chromeHtml(o).split(glass).join(o.aria ? glass.replace('<svg ', '<svg aria-hidden="true" ') : glass);
  const chromeHtml = (o = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Brand Sans";src:${faces}${o.build ? ';size-adjust:104%' : ''}}
body{margin:0;font:16px/24px "Brand Sans",sans-serif;color:#123}a{color:#123;text-decoration:none;display:block;line-height:24px}
.promo{background:#123;height:40px}.promo p{margin:0;color:#fff;line-height:40px;text-align:center}
.site{position:relative;height:72px;background:${o.headerBg || '#fff'};display:grid;grid-template-columns:160px repeat(3,130px) 1fr 40px;align-items:center;justify-items:start;padding:0 24px}
.site nav{display:contents}.site nav a{font-size:${o.navSize || '16px'}}
.mega{position:absolute;left:0;top:72px;width:100%;background:#eee;${o.build ? '' : 'opacity:0;pointer-events:none'}}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
main{padding:24px}.card{width:320px;border:1px solid #ccc}.fill{height:${o.build ? 920 : 900}px}
.foot{background:#121737;height:160px;display:grid;grid-template-columns:repeat(3,200px) 1fr 40px 40px;align-items:center;justify-items:start;padding:0 24px}.foot a{color:#fff}
</style></head><body>
${o.build ? '' : '<header class="promo"><p>Free delivery this week</p></header>'}
<header class="site"><a href="/">Brand</a><nav><a href="/products">Products</a><a href="/pricing">Pricing</a>${o.dropLink ? '' : '<a href="/docs">Docs</a>'}</nav><span></span>
${o.build ? `<a href="/search"><span class="sr-only">Search</span>${o.dropIcon ? '' : glass}</a>` : `<a href="/search" aria-label="Search">${glass}</a>`}
<div class="mega"${o.build ? ' hidden' : ''}><a href="/m1">Mega one</a><a href="/m2">Mega two</a></div></header>
<main><article class="card"><header><h3>Card title</h3><a href="/c">Read more</a></header></article><div class="fill"></div></main>
${o.noFooter ? '' : `<footer class="foot"><a href="/about">About</a><a href="/careers">Careers</a><a href="/contact">Contact</a><span></span>
${o.build ? `<a href="/fb" aria-label="Facebook">${glass}</a><a href="/ig" title="Instagram">${glass}</a>` : `<a href="/fb" title="Facebook">${glass}</a><a href="/ig"><span class="sr-only">Instagram</span>${glass}</a>`}</footer>`}
</body></html>`;
  pages['/chrome-live.html'] = chrome();
  pages['/chrome-build.html'] = chrome({ build: true });
  pages['/chrome-live-aria.html'] = chrome({ aria: true });
  pages['/chrome-build-aria.html'] = chrome({ build: true, aria: true });
  pages['/chrome-build-aria-no-icon.html'] = chrome({ build: true, aria: true, dropIcon: true });
  pages['/chrome-build-missing-link.html'] = chrome({ build: true, dropLink: true });
  pages['/chrome-build-header-bg.html'] = chrome({ build: true, headerBg: '#f4f4f4' });
  pages['/chrome-build-nav-size.html'] = chrome({ build: true, navSize: '14px' });
  pages['/chrome-build-no-footer.html'] = chrome({ build: true, noFooter: true });
  return pages;
}
const serve = (host, port) => new Promise((done) => {
  const pages = fixturePages();
  const server = createServer((req, res) => {
    const body = pages[req.url.split('?')[0]];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body);
  });
  server.listen(port, host, () => done(server));
});
if (SERVE) {
  const [port, host] = process.argv.slice(process.argv.indexOf('--serve') + 1);
  const server = await serve(host || '127.0.0.1', Number(port) || 0);
  console.log(`chrome-parity fixtures on http://${host || '127.0.0.1'}:${server.address().port} — ${Object.keys(fixturePages()).join(' ')}`);
  await new Promise(() => {});
}

// ---- end to end (needs playwright) -----------------------------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end chrome-parity (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const host = process.env.SD_FIXTURE_HOST || '127.0.0.1';
  const server = await serve(host, 0);
  const base = `http://${host}:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), 'chrome-parity-e2e-'));
  const run = (args) => new Promise((resolveRun) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
  const failing = (out) => out.split('\n').filter((l) => /^ {2}(PAIR|MISSING|EXTRA|ICONS?|REGION( BOX| STYLE| OFFSET)?) /.test(l));
  const advisory = (out) => out.split('\n').filter((l) => /^ {2}advisory /.test(l)).map((l) => l.trim().replace(/^advisory\s+/, '').replace(/:.*/, ''));
  const SUBST = ['--font-subst', 'Brand Sans=Arimo'];
  const live = `${base}/chrome-live.html`; const W = ['--width', '1200'];

  const r = await run([`${base}/live.html`, `${base}/build.html`, '--width', '800']);
  await check('e2e: the live header is auto-detected; display:contents titles pair; the painted footer background matches; the svg logo and its <img> are the same icon; the 200 px shift is one advisory REGION OFFSET — exit 0', () => {
    assert.match(r.stdout, /region live: +div\.bar\.megaMenuWrapper — auto-detected \(no usable <header> landmark\)/, r.stdout);
    assert.match(r.stdout, /region build: +header\.bar — outermost <header>/, r.stdout);
    assert.match(r.stdout, /■ header: ✓ parity — 2 paired of 2\/2 texts/, r.stdout);
    assert.match(r.stdout, /■ footer: ✓ parity — 4 paired of 4\/4 texts/, r.stdout);
    assert.match(r.stdout, /advisory +REGION OFFSET: page Δy \+200px/, r.stdout);
    assert.deepEqual(failing(r.stdout), [], r.stdout);
    assert.match(r.stdout, /\n✓ chrome parity within tolerance, 1 advisory group\(s\) — /, r.stdout);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  const ok = await run([live, `${base}/chrome-build.html`, ...W, ...SUBST]);
  await check('e2e: promo bar, aria-label ↔ hidden text, closed mega menu, substituted face, 20 px taller body — with the declaration: exit 0, advisory groups only; the real header (not the promo bar, not the card header) on both sides', () => {
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /region live: +header\.site — outermost <header>, the one with the nav \/ most links of 2, box 0,40 1200×72; selector body > header:nth-of-type\(2\)/, ok.stdout);
    assert.match(ok.stdout, /region build: +header\.site — outermost <header>, box 0,0 1200×72; selector body > header/, ok.stdout);
    assert.deepEqual(failing(ok.stdout), [], ok.stdout);
    assert.deepEqual(advisory(ok.stdout), ['REGION OFFSET', 'GLYPH WIDTH', 'NAMES', 'REST STATE', 'REGION OFFSET', 'GLYPH WIDTH', 'NAMES'], ok.stdout);
    assert.match(ok.stdout, /REGION OFFSET: page Δy -40px \(40→0\)/, ok.stdout);
    assert.match(ok.stdout, /REGION OFFSET: page Δy -20px/, ok.stdout);
    assert.match(ok.stdout, /NAMES: 1 carried by another channel \(aria-label ↔ hidden text\)/, ok.stdout);
    assert.match(ok.stdout, /NAMES: 1 carried by another channel \(hidden text ↔ title\)/, ok.stdout);
    assert.match(ok.stdout, /REST STATE: 2 live \/ 0 build text\(s\) inside panels not shown at rest left out \(live: opacity:0 2; build: none\)/, ok.stdout);
    assert.match(ok.stdout, /GLYPH WIDTH: \d+ pair\(s\) within 6% under the declared substitution brand sans→arimo/, ok.stdout);
    assert.match(ok.stdout, /\n✓ chrome parity within tolerance, 7 advisory group\(s\) — /, ok.stdout);
  });
  const undeclared = await run([live, `${base}/chrome-build.html`, ...W]);
  await check('e2e: the same pair WITHOUT the declaration → exit 2, only glyph-width PAIR lines (Δw), nothing collapsed', () => {
    assert.equal(undeclared.status, 2, undeclared.stdout + undeclared.stderr);
    assert.ok(failing(undeclared.stdout).length >= 4 && failing(undeclared.stdout).every((l) => /^ {2}PAIR .*Δw \+\d+px/.test(l)), undeclared.stdout);
    assert.ok(!advisory(undeclared.stdout).includes('GLYPH WIDTH'), undeclared.stdout);
  });
  const variants = [
    ['a missing nav link', 'chrome-build-missing-link.html', (lines) => { assert.equal(lines.length, 1); assert.match(lines[0], /^ {2}MISSING +"Docs" {2}live <a> "Docs" has no build element with the same text$/); }],
    ['a wrong header background', 'chrome-build-header-bg.html', (lines) => { assert.equal(lines.length, 1); assert.match(lines[0], /^ {2}REGION STYLE backgroundColor rgb\(255, 255, 255\) → rgb\(244, 244, 244\)$/); }],
    ['a nav font-size 2 px smaller', 'chrome-build-nav-size.html', (lines) => { assert.deepEqual(lines.map((l) => (l.match(/^ {2}PAIR +"(\w+)" {2}fontSize 16px → 14px/) || [])[1]), ['Products', 'Pricing', 'Docs']); }],
  ];
  for (const [what, file, expect] of variants) {
    const v = await run([live, `${base}/${file}`, ...W, ...SUBST]);
    await check(`e2e: ${what} → exit 2 with exactly that finding`, () => { assert.equal(v.status, 2, v.stdout + v.stderr); expect(failing(v.stdout)); });
  }
  const strictNames = await run([live, `${base}/chrome-build.html`, ...W, ...SUBST, '--strict-names']);
  await check('e2e: --strict-names → exit 2: the closed panel\'s texts are MISSING and the hidden texts unpaired again', () => {
    assert.equal(strictNames.status, 2, strictNames.stdout + strictNames.stderr);
    assert.deepEqual(failing(strictNames.stdout).map((l) => l.trim().split(/\s+/).slice(0, 2).join(' ')).sort(), ['EXTRA "Search"', 'MISSING "Instagram"', 'MISSING "Mega', 'MISSING "Mega'], strictNames.stdout);
  });
  const strictOffset = await run([live, `${base}/chrome-build.html`, ...W, ...SUBST, '--strict-region-offset']);
  await check('e2e: --strict-region-offset → exit 2: the two region offsets fail', () => {
    assert.equal(strictOffset.status, 2, strictOffset.stdout + strictOffset.stderr);
    assert.deepEqual(failing(strictOffset.stdout).map((l) => l.trim().slice(0, 13)), ['REGION OFFSET', 'REGION OFFSET'], strictOffset.stdout);
  });
  const noFooter = await run([live, `${base}/chrome-build-no-footer.html`, ...W, ...SUBST]);
  await check('e2e: a footer the source has and the build lacks is a failing MISSING finding (exit 2) — a defect of the build, not an input error', () => {
    assert.equal(noFooter.status, 2, noFooter.stdout + noFooter.stderr);
    assert.match(noFooter.stdout, /MISSING +REGION footer: on the live page .*not on the build — no footer resolved/, noFooter.stdout);
    assert.doesNotMatch(noFooter.stdout, /input error/);
  });
  const ariaOk = await run([`${base}/chrome-live-aria.html`, `${base}/chrome-build-aria.html`, ...W, ...SUBST]);
  const ariaGone = await run([`${base}/chrome-live-aria.html`, `${base}/chrome-build-aria-no-icon.html`, ...W, ...SUBST]);
  await check('e2e: a decorative icon marked aria-hidden is still an icon — kept on both sides it pairs (exit 0), dropped on the build it is an ICONS delta (exit 2)', () => {
    assert.equal(ariaOk.status, 0, ariaOk.stdout + ariaOk.stderr);
    assert.equal(ariaGone.status, 2, ariaGone.stdout + ariaGone.stderr);
    assert.match(ariaGone.stdout, /ICONS .*1 live vs 0 build/, ariaGone.stdout);
  });
  const liveOnlyBad = await run([`${base}/chrome-build-no-footer.html`, '--live-only', ...W]);
  await check('e2e: --live-only with an unresolved region exits 4, so the caller\'s warning fires', () => {
    assert.equal(liveOnlyBad.status, 4, liveOnlyBad.stdout + liveOnlyBad.stderr); assert.match(liveOnlyBad.stdout, /input error \(exit 4\) — unresolved: footer/);
  });
  const cache = join(dir, 'gates', 'chrome-live.json'); const invFile = join(dir, 'gates', 'chrome-inventory.json');
  const only = await run([live, '--live-only', ...W, '--live-cache', cache, '--json', invFile]);
  const after = await run([live, `${base}/chrome-build.html`, ...W, ...SUBST, '--live-cache', cache]);
  await check('e2e: --live-only prints the brief, writes the inventory and the live cache; the comparison then reads that cache (no second live probe) — exit 0', () => {
    assert.equal(only.status, 0, only.stdout + only.stderr);
    assert.match(only.stdout, /■ header: box 0,40 1200×72, position relative, background rgb\(255, 255, 255\)/, only.stdout);
    assert.match(only.stdout, /texts: 4 visible, 0 hidden-name, 1 attr-name; 2 inside panels not shown at rest; icons: 1 \(svg\/img\)/, only.stdout);
    assert.match(only.stdout, /<a> "Products" → \/products {2}\d+,24 \d+×24 {2}brand sans 16px\/24px 400 rgb\(17, 34, 51\)/, only.stdout);
    assert.match(only.stdout, /<a> aria-label="Search" → \/search/, only.stdout);
    assert.match(only.stdout, /■ footer: box 0,\d+ 1200×160, position static, background rgb\(18, 23, 55\)/, only.stdout);
    assert.match(only.stdout, /<span> "Instagram" → \/ig/, only.stdout);
    const inv = JSON.parse(readFileSync(invFile, 'utf8'));
    assert.deepEqual(inv.regions.header.counts, { visible: 4, hiddenName: 0, attrName: 1, notAtRest: 2, icons: 1 });
    assert.deepEqual(inv.regions.header.links.map((l) => l.href), ['/', '/products', '/pricing', '/docs', '/search']);
    assert.ok(existsSync(cache)); assert.equal(JSON.parse(readFileSync(cache, 'utf8')).regions.header.selector, 'body > header:nth-of-type(2)');
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.match(after.stdout, /live side from cache .*chrome-live\.json, probed /, after.stdout);
    assert.match(after.stdout, /\n✓ chrome parity within tolerance, 7 advisory group\(s\)/, after.stdout);
  });
  rmSync(dir, { recursive: true, force: true });
  server.close();
}

if (!SERVE) console.log(failed ? `\n${failed} failing` : '\nchrome-parity: all checks passed');
process.exit(failed ? 1 : 0);
