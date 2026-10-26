#!/usr/bin/env node
// skills/reskin/scripts/test/stream-render.test.mjs — stream-render (pure part, no browser, no network):
// token sheet → path-named custom properties, every content-model string and href interpolated, the
// renderer contract (site-header/main/footer, data-slot, data-slot-body, data-module, .btn / .btn-secondary),
// heading alignment from type.display.textAlign (default left), resolveImg → data-source-src, localSubpath,
// and an unknown stream node kind throws instead of dropping content. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSmells, chromeTextMissing, contrast, findRepeat, localSubpath, modelHasButton, render, rendersButton, tokenVars } from '../stream-render.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'stream-render.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const tokens = {
  _provenance: { writtenBy: 'test' }, donor: 'x', nodeRefs: { a: 'b' },
  palette: { pageBg: 'rgb(255, 255, 255)', accent: 'rgb(0, 80, 160)' },
  type: { family: 'Inter', familyNote: 'skip me', display: { fontWeight: '700' } },
  buttons: { primary: { background: 'rgb(0, 80, 160)' } },
};
const model = {
  metadata: { title: 'Sign in', lang: 'en', description: 'Sign in & go', canonical: 'https://example.test/login' },
  sections: [{
    slot: 's01',
    ordered: [
      { kind: 'heading', level: 'h1', text: 'Welcome <back>' },
      { kind: 'paragraph', text: 'Use your account.' },
      { kind: 'text', parentTag: 'label', text: 'Email *' },
      { kind: 'formControl', control: 'input', inputType: 'email', name: 'email' },
      { kind: 'cta', text: 'Sign in', absHref: 'https://example.test/go', classes: 'btn' },
      { kind: 'cta', text: 'Register', absHref: 'https://example.test/reg', classes: 'button' },
      { kind: 'image', currentSrc: 'https://cdn.example.test/a/b.png?v=1', alt: 'A' },
    ],
  }],
};
const mapping = { pages: { login: { template: 'login', slots: { s01: { module: 'M2', layout: 'stack', width: 'narrow' } } } } };
const base = { slug: 'login', model, tokens, mapping, now: '2026-01-01T00:00:00Z' };

check('tokenVars: every string leaf, path-named in kebab case; metadata keys skipped', () => {
  const v = Object.fromEntries(tokenVars(tokens));
  assert.equal(v['--palette-page-bg'], 'rgb(255, 255, 255)');
  assert.equal(v['--type-display-font-weight'], '700');
  assert.equal(v['--buttons-primary-background'], 'rgb(0, 80, 160)');
  for (const k of Object.keys(v)) assert.ok(!/provenance|donor|node-refs|family-note/.test(k), k);
});
check('header nav keeps link-less menu triggers in source order (never drops chrome text)', () => {
  const chromeModel = { sections: [{
    slot: 'h1', images: [], ctas: [{ text: 'Contact us', absHref: 'https://example.test/contact' }],
    ordered: [
      { kind: 'cta', text: '', absHref: 'https://example.test/', children: [{ kind: 'image', currentSrc: 'https://example.test/logo.svg' }] },
      { kind: 'listItem', text: 'Our medicines' },
      { kind: 'listItem', text: 'Contact us', children: [{ kind: 'cta', text: 'Contact us', absHref: 'https://example.test/contact' }] },
    ],
  }] };
  const { html } = render({ ...base, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'] } } });
  assert.match(html, /<nav><button class="nav-menu" type="button" aria-expanded="false">Our medicines<\/button><a href="https:\/\/example\.test\/contact">Contact us<\/a><\/nav>/);
});
check('chrome guard: chromeTextMissing lists dropped text leaves; punctuation fragments and images aside', () => {
  const s = { ordered: [
    { kind: 'listItem', text: 'Menu', children: [{ kind: 'cta', text: 'Menu' }] },
    { kind: 'text', text: 'Stray span' }, { kind: 'text', text: ',' }, { kind: 'image', text: 'alt only' },
  ] };
  assert.deepEqual(chromeTextMissing(s, '<nav><a>Menu</a></nav>'), ['Stray span']);
  assert.deepEqual(chromeTextMissing(s, '<a>Menu</a><p>Stray span</p>'), []);
});
check('footer keeps headings and text runs in order; header keeps a Figma-only capture (text nodes + ctas)', () => {
  const footer = { slot: 'f1', images: [], paragraphs: [], ctas: [{ text: 'Licence', absHref: 'https://example.test/l' }],
    ordered: [{ kind: 'heading', level: 'h3', text: 'Contact us' }, { kind: 'text', text: 'Email: a@b.test' }, { kind: 'text', text: ')' }, { kind: 'cta', text: 'Licence', absHref: 'https://example.test/l' }] };
  const header = { slot: 'h1', images: [], ctas: [{ text: 'Contact Us', absHref: 'https://example.test/c' }],
    ordered: [{ kind: 'paragraph', text: 'Contact Us' }, { kind: 'paragraph', text: 'DE' }] };
  const { html } = render({ ...base, chromeModel: { sections: [footer, header] }, mapping: { ...mapping, chrome: { header: ['h1'], footer: ['f1'] } } });
  assert.match(html, /<p>Contact us<\/p><p>Email: a@b\.test<\/p><\/div>/);
  assert.match(html, /<nav><a href="https:\/\/example\.test\/c">Contact Us<\/a><span class="nav-text">DE<\/span><\/nav>/);
});
check('branded header row: brand | menu | actions zones; navAlign centres the menu, default end', () => {
  const chromeModel = { sections: [{
    slot: 'h1', images: [{ currentSrc: 'https://example.test/logo.svg', alt: 'Logo' }], ctas: [{ text: 'Login', absHref: 'https://example.test/login' }],
    ordered: [
      { kind: 'cta', text: '', absHref: 'https://example.test/', children: [{ kind: 'image', currentSrc: 'https://example.test/logo.svg' }] },
      { kind: 'listItem', text: 'Our medicines' },
      { kind: 'listItem', text: 'Contact us', children: [{ kind: 'cta', text: 'Contact us', absHref: 'https://example.test/contact' }] },
      { kind: 'cta', text: 'Login', absHref: 'https://example.test/login', buttonLike: true },
    ],
  }] };
  const run = (chrome) => render({ ...base, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'], ...chrome } } }).html;
  const centred = run({ navAlign: 'center' });
  assert.match(centred, /<div class="chrome-row nav-align-center">[\s\S]*<div class="brand"><img class="logo"[^>]*><\/div>\s*<nav id="site-nav"><button class="nav-menu"[^>]*>Our medicines<\/button><a href="https:\/\/example\.test\/contact">Contact us<\/a><\/nav>\s*<div class="nav-actions"><a href="https:\/\/example\.test\/login">Login<\/a><button class="icon-btn nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">/);
  assert.match(centred, /\.nav-align-center \.container \{ display: grid; grid-template-columns: 1fr auto 1fr; \}/);
  assert.match(run({}), /<div class="chrome-row nav-align-end">/);
  assert.match(run({ navAlign: 'bogus' }), /<div class="chrome-row nav-align-end">/);
  const fromDonor = render({ ...base, tokens: { ...tokens, layout: { navAlign: 'center' } }, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'] } } }).html;
  assert.match(fromDonor, /<div class="chrome-row nav-align-center">/);
  const overridden = render({ ...base, tokens: { ...tokens, layout: { navAlign: 'center' } }, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'], navAlign: 'start' } } }).html;
  assert.match(overridden, /<div class="chrome-row nav-align-start">/);
});
check('header row without a menu list: plain entries are the menu, source buttons are styled actions', () => {
  const chromeModel = { sections: [{
    slot: 'h1', images: [{ currentSrc: 'https://example.test/logo.svg', alt: 'Logo' }], ctas: [{ text: 'Login', absHref: 'https://example.test/login' }],
    ordered: [
      { kind: 'image', currentSrc: 'https://example.test/logo.svg' },
      { kind: 'paragraph', text: 'Products' },
      { kind: 'text', text: 'Login', inButton: true },
      { kind: 'text', text: 'Start free', inButton: true },
    ],
  }] };
  const html = render({ ...base, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'], navAlign: 'center' } } }).html;
  assert.match(html, /<nav><span class="nav-text">Products<\/span><\/nav>\s*<div class="nav-actions"><a class="btn btn-secondary" href="https:\/\/example\.test\/login">Login<\/a><button class="btn" type="button">Start free<\/button><button class="icon-btn nav-toggle"/);
  assert.match(html, /:is\(\.site-main, \.site-header\) \.btn \{/);
});
check('slot options: bleed paints the band, align centres, a leading image goes first, heading roles size sub-headings', () => {
  const m2 = { sections: [{ slot: 's01', ordered: [
    { kind: 'image', currentSrc: 'https://example.test/a.png', alt: '' },
    { kind: 'heading', level: 'h2', text: 'Title' },
    { kind: 'heading', level: 'h5', role: 'h4', text: 'Sub' },
    { kind: 'paragraph', text: 'Body' },
  ] }] };
  const t2 = { ...tokens, type: { ...tokens.type, h4: { fontSize: '24px' } } };
  const run = (slot) => render({ ...base, model: m2, tokens: t2, mapping: { pages: { login: { template: 'login', slots: { s01: slot } } } } }).html;
  const html = run({ module: 'M2', layout: 'split', tone: 'dark', bleed: true, align: 'center' });
  assert.match(html, /<section class="band layout-split width-narrow tone-dark bleed align-center media-first"/);
  assert.match(html, /<h5 class="heading role-h4">Sub<\/h5>/);
  assert.match(html, /\.heading\.role-h4 \{ font-size: var\(--type-h4-font-size\)/);
  assert.doesNotMatch(run({ module: 'M2', layout: 'split', bleed: true }), /<section class="[^"]*\bbleed\b/, 'bleed needs a tone');
});
check('renderer contract: chrome/main classes, data-slot, data-module, data-slot-body, template', () => {
  const { html, slots } = render(base);
  assert.equal(slots, 1);
  assert.match(html, /<header class="site-header" data-canon="header">/);
  assert.match(html, /<main class="site-main" data-template="login">/);
  assert.match(html, /<footer class="site-footer" data-canon="footer">/);
  assert.match(html, /<section class="band layout-stack width-narrow" data-slot="s01" data-module="M2">/);
  assert.match(html, /data-slot-body/);
});
check('content interpolated and escaped; labels keep the required marker; hrefs absolute', () => {
  const { html } = render(base);
  assert.match(html, /<h1 class="heading">Welcome &lt;back&gt;<\/h1>/);
  assert.match(html, /<label for="f1">Email <span class="req">\*<\/span><\/label><input id="f1" type="email" name="email">/);
  assert.match(html, /<meta name="description" content="Sign in &amp; go">/);
  assert.match(html, /href="https:\/\/example\.test\/go"/);
});
check('first button of a slot is .btn, later ones .btn btn-secondary', () => {
  const { html } = render(base);
  assert.match(html, /<a class="btn" href="https:\/\/example\.test\/go">Sign in<\/a>/);
  assert.match(html, /<a class="btn btn-secondary" href="https:\/\/example\.test\/reg">Register<\/a>/);
});
check('optional contract tokens: card, button height and mobile padding/gutter use the :root names; absent, the literals stay', () => {
  const plain = render({ ...base }).html;
  assert.match(plain, /min-height: 40px;/);
  assert.match(plain, /\.site-main \.card \{ background: [^;]+; border-radius: [^;]+; box-shadow: [^;]+; padding: 40px; \}/);
  assert.match(plain, /\.site-main section \{ padding-top: 24px; padding-bottom: 24px; \}/);
  assert.doesNotMatch(plain, /--card-|--button-height|--gutter-mobile|--section-padding-mobile/);
  const t2 = { ...tokens, cards: { primary: { background: '#fafafa', borderRadius: '12px', padding: '32px', titleColor: '#123456' } }, buttons: { ...(tokens.buttons || {}), primary: { ...(tokens.buttons?.primary || {}), height: '48px' } }, layout: { ...(tokens.layout || {}), mobile: { sectionPaddingY: '40px', gutter: '16px' } } };
  const { html } = render({ ...base, tokens: t2 });
  for (const [name, value] of [['--card-bg', '#fafafa'], ['--card-radius', '12px'], ['--card-padding', '32px'], ['--card-title-color', '#123456'], ['--button-height', '48px'], ['--section-padding-mobile', '40px'], ['--gutter-mobile', '16px']]) assert.ok(html.includes(`${name}: ${value};`), `${name} in :root`);
  assert.match(html, /min-height: var\(--button-height\);/);
  assert.match(html, /\.site-main \.card \{ background: var\(--card-bg\); border-radius: var\(--card-radius\);[^}]*padding: var\(--card-padding\); \}/);
  assert.match(html, /\.site-main \.card :is\(h2, h3, h4, \.heading\) \{ color: var\(--card-title-color\); \}/);
  assert.match(html, /\.site-main section \{ padding-top: var\(--section-padding-mobile\); padding-bottom: var\(--section-padding-mobile\); \}/);
  assert.match(html, /\.container \{ padding-left: var\(--gutter-mobile\); padding-right: var\(--gutter-mobile\); \}/);
});
check('heading alignment: type.display.textAlign token when present, else left', () => {
  assert.match(render(base).html, /\.site-main \.heading \{[^}]*text-align: left;/);
  const t2 = structuredClone(tokens); t2.type.display.textAlign = 'center';
  const { html } = render({ ...base, tokens: t2 });
  assert.match(html, /--type-display-text-align: center;/);
  assert.match(html, /\.site-main \.heading \{[^}]*text-align: var\(--type-display-text-align\);/);
});
check('images: hot-linked by default; resolveImg localizes and keeps data-source-src; images listed once', () => {
  const a = render(base);
  assert.deepEqual(a.images, ['https://cdn.example.test/a/b.png?v=1']);
  assert.match(a.html, /<img src="https:\/\/cdn\.example\.test\/a\/b\.png\?v=1" alt="A">/);
  const b = render({ ...base, resolveImg: (u) => ({ src: 'assets/img/x.png', source: u }) });
  assert.match(b.html, /<img src="assets\/img\/x\.png" data-source-src="https:\/\/cdn\.example\.test\/a\/b\.png\?v=1" alt="A">/);
});
check('deterministic: two renders are byte-identical; uid restarts per render', () => {
  assert.equal(render(base).html, render(base).html);
});
check('unknown stream node kind throws; a page missing from mapping throws', () => {
  const m2 = structuredClone(model); m2.sections[0].ordered.push({ kind: 'video' });
  assert.throws(() => render({ ...base, model: m2 }), /unhandled stream node kind "video"/);
  assert.throws(() => render({ ...base, slug: 'nope' }), /mapping\.json has no pages\.nope/);
});
check('the style opens with the token-contract :root block (M2b D10); heading and inset slot options', () => {
  const r = render({ slug: 'login', model, tokens, mapping, now: 'T' });
  const css = r.html.slice(r.html.indexOf('<style>') + 8);
  assert.ok(css.startsWith(':root {\n'), 'root-tokens block first');
  assert.ok(css.indexOf('/* absent in donor-tokens.json') < css.indexOf(':root {', 5), 'contract block before the flattened variables');
  const t2 = { ...tokens, type: { ...tokens.type, h3: { fontSize: '36px', lineHeight: '40px' } } };
  const m2 = { pages: { login: { template: 'login', slots: { s01: { module: 'M2', heading: 'h3', inset: '80px' } } } } };
  const h = render({ slug: 'login', model, tokens: t2, mapping: m2, now: 'T' });
  assert.match(h.html, /<section class="[^"]*heading-h3[^"]*\binset\b[^"]*" style="--band-inset: 80px"/);
  assert.match(h.html, /\.site-main \.heading-h3 \.heading \{ font-size: var\(--type-h3-font-size\)/);
  const bad = render({ slug: 'login', model, tokens, mapping: { pages: { login: { slots: { s01: { heading: 'h9', inset: '80;}' } } } } }, now: 'T' });
  assert.doesNotMatch(bad.html.match(/<section[^>]*>/)[0], /--band-inset|heading-h9|\binset\b/);
  assert.equal(bad.warnings.filter((w) => /unknown heading|not a length/.test(w)).length, 2);
});
check('split columns, content-box container, shared column gap, card titles and the label follow the h2 role', () => {
  const t2 = structuredClone(tokens); t2.type.h3 = { fontSize: '30px' }; t2.radii = { label: '7px' };
  const m2 = { pages: { login: { template: 'login', slots: { s01: { module: 'M1', layout: 'split', split: '531px 1fr', heading: 'display' } } } } };
  const h = render({ slug: 'login', model, tokens: t2, mapping: m2, now: 'T' });
  assert.match(h.html, /<section class="[^"]*heading-display[^"]*" style="--split-columns: 531px 1fr"/);
  assert.match(h.html, /\.layout-split \.panel \{ display: grid; grid-template-columns: var\(--split-columns, 1fr 1fr\);/);
  assert.match(h.html, /\.container \{ box-sizing: content-box;/);
  assert.match(h.html, /\.layout-grid-2 \.flow \{[^}]*column-gap: 40px; \}/);
  assert.match(h.html, /\.site-main \.card \.heading \{ font-size: var\(--type-h3-font-size\)/);
  assert.match(h.html, /\.band:not\(\[class\*="heading-"\]\) \.flow > h2\.heading:first-child, \.site-main \.heading-h2 \.flow > \.heading:first-child \{/);
  const bad = render({ slug: 'login', model, tokens, mapping: { pages: { login: { slots: { s01: { split: '1fr; color:red' } } } } }, now: 'T' });
  assert.doesNotMatch(bad.html.match(/<section[^>]*>/)[0], /--split-columns/);
  assert.equal(bad.warnings.filter((w) => /not two column tracks/.test(w)).length, 1);
});
check('findRepeat: intro, repeating items and tail; a shifted run loses the coverage tie; null when nothing repeats', () => {
  const h = (level, text = 'x') => ({ kind: 'heading', level, text });
  const p = { kind: 'paragraph', text: 'p' }; const im = { kind: 'image', src: 'i' }; const a = { kind: 'cta', text: 'c', href: '#' };
  assert.deepEqual(findRepeat([h('h2'), p, im, h('h3'), p, im, h('h3'), p, im, h('h3'), p, a]), { start: 2, period: 3, count: 3, bounds: [2, 5, 8, 11] });
  assert.deepEqual(findRepeat([h('h2'), p, h('h3'), p, p, h('h5'), p, p, h('h4'), p, p]), { start: 2, period: 3, count: 3, bounds: [2, 5, 8, 11] }, 'drifting card heading levels still repeat');
  const t = (cls) => ({ kind: 'text', text: 't', parentClass: cls });
  // intro (h2, p) then [num, title, p] x3: the run starting at the subtitle covers as many nodes but is shifted.
  assert.deepEqual(findRepeat([h('h2'), p, t('n'), t('t'), p, t('n'), t('t'), p, t('n'), t('t'), p]), { start: 2, period: 3, count: 3, bounds: [2, 5, 8, 11] });
  assert.equal(findRepeat([h('h2'), p, a, im]), null);
});
check('cards layout: items wrapped in .card inside .cards with columns; intro and tail outside; no repeat warns', () => {
  const p = { kind: 'paragraph', text: 'Bio' };
  const ordered = [{ kind: 'heading', level: 'h2', text: 'Team' }];
  for (const n of ['Ann', 'Bo', 'Cy']) ordered.push({ kind: 'image', currentSrc: `https://cdn.example.test/${n}.png`, alt: n }, { kind: 'heading', level: 'h3', text: n }, p);
  ordered.push({ kind: 'cta', text: 'All', absHref: 'https://example.test/all', classes: 'btn' });
  const m2 = { metadata: {}, sections: [{ slot: 's01', ordered }] };
  const map = { pages: { t: { slots: { s01: { layout: 'cards', tone: 'dark' } } } } };
  const { html, warnings } = render({ ...base, slug: 't', model: m2, mapping: map });
  assert.match(html, /class="band layout-cards width-narrow tone-dark"/);
  assert.match(html, /<div class="cards" style="--cards-columns: 3">(<div class="card">[\s\S]*?<\/div>){3}<\/div>/);
  assert.equal((html.match(/<div class="card">/g) || []).length, 3);
  assert.ok(html.indexOf('>Team</h2>') < html.indexOf('class="cards"') && html.indexOf('>All</a>') > html.lastIndexOf('class="card"'));
  assert.deepEqual(warnings, []);
  const flat = render({ ...base, mapping: { pages: { login: { slots: { s01: { layout: 'cards', tone: 'neon' } } } } } });
  assert.equal(flat.warnings.length, 2);
  assert.doesNotMatch(flat.html, /class="cards"/);
});
check('cards layout: a list of structured items (image, link, text per li) is one card per item, not a bullet list', () => {
  const li = (n) => ({ kind: 'listItem', text: n, children: [
    { kind: 'image', currentSrc: `https://cdn.example.test/${n}.jpg`, alt: '' },
    { kind: 'cta', text: n, href: `/${n}`, absHref: `https://example.test/${n}` },
    { kind: 'paragraph', text: `About ${n}` }] });
  const h2 = { kind: 'heading', level: 'h2', text: 'Why us' };
  assert.deepEqual(findRepeat([h2, li('a'), li('b'), li('c')]), { start: 1, period: 1, count: 3, bounds: [1, 2, 3, 4] }, 'three single-node items');
  assert.deepEqual(findRepeat([h2, ...'abcdef'.split('').map(li)]), { start: 1, period: 1, count: 6, bounds: [1, 2, 3, 4, 5, 6, 7] }, 'six items beat a false 2-node run');
  const plain = { kind: 'listItem', text: 'x' };
  assert.equal(findRepeat([h2, plain, plain, plain]), null, 'a bare bullet list is not cards');
  const m2 = { metadata: {}, sections: [{ slot: 's01', ordered: [h2, li('a'), li('b'), li('c')] }] };
  const { html, warnings } = render({ ...base, slug: 't', model: m2, mapping: { pages: { t: { slots: { s01: { layout: 'cards' } } } } } });
  assert.equal((html.match(/<div class="card">/g) || []).length, 3);
  assert.doesNotMatch(html, /<ul class="list">/);
  assert.match(html, /<div class="card"><figure class="media"><img [^>]+><\/figure>/);
  assert.deepEqual(warnings, []);
});
check('content-driven: 3+ consecutive images are one logo row; split puts the first image beside the text', () => {
  const ordered = ['a', 'b', 'c'].map((n) => ({ kind: 'image', currentSrc: `https://cdn.example.test/${n}.svg`, alt: n }));
  const m2 = { metadata: {}, sections: [{ slot: 's01', ordered: [{ kind: 'heading', level: 'h1', text: 'Hi' }, ...ordered] }] };
  const logos = render({ ...base, slug: 't', model: m2, mapping: { pages: { t: { slots: {} } } } }).html;
  assert.match(logos, /<div class="logos">(<img [^>]+>){3}<\/div>/);
  const split = render({ ...base, mapping: { pages: { login: { slots: { s01: { layout: 'split' } } } } } }).html;
  assert.match(split, /<\/div><img class="split-img" src="https:\/\/cdn\.example\.test\/a\/b\.png\?v=1" alt="A"><\/div><\/div>/);
});
check('donor-conditional CSS: h2-h4 sizes and the label pill only when the tokens carry them; footerTone', () => {
  assert.doesNotMatch(render(base).html, /h3\.heading|var\(--radii-label\)/);
  const t2 = structuredClone(tokens); t2.type.h3 = { fontSize: '30px' }; t2.radii = { label: '7px' };
  const { html } = render({ ...base, tokens: t2, mapping: { ...mapping, chrome: { footerTone: 'dark' } } });
  assert.match(html, /\.site-main h3\.heading \{ font-size: var\(--type-h3-font-size\);/);
  assert.match(html, /border-radius: var\(--radii-label\)/);
  assert.match(html, /<footer class="site-footer tone-dark" data-canon="footer">/);
});
check('required marker: inherits the label weight unless the donor has a type.required role', () => {
  assert.match(render(base).html, /\.site-main \.req \{[^}]*font-weight: inherit;/);
  const t2 = structuredClone(tokens); t2.type.required = { fontWeight: '400' };
  assert.match(render({ ...base, tokens: t2 }).html, /\.site-main \.req \{[^}]*font-weight: var\(--type-required-font-weight\);/);
});
check('an image inside a link is kept inline (icon), alongside the link text', () => {
  const ordered = [{ kind: 'cta', text: 'More', absHref: 'https://example.test/m', children: [
    { kind: 'image', currentSrc: 'https://cdn.example.test/arrow.svg', alt: 'arrow' }, { kind: 'text', text: 'More', sep: '' }] }];
  const { html, images } = render({ ...base, model: { metadata: {}, sections: [{ slot: 's01', ordered }] } });
  assert.match(html, /<a class="link" href="https:\/\/example\.test\/m"><img class="icon" src="https:\/\/cdn\.example\.test\/arrow\.svg" alt="arrow">More<\/a>/);
  assert.deepEqual(images, ['https://cdn.example.test/arrow.svg']);
});
check('text inside a button (inButton, e.g. an sr-only label of an icon button) renders as the slot button', () => {
  const ordered = [{ kind: 'text', text: 'Search', parentTag: 'span', parentClass: 'sr-only', inButton: true }];
  assert.match(render({ ...base, model: { metadata: {}, sections: [{ slot: 's01', ordered }] } }).html, /<button class="btn" type="submit">Search<\/button>/);
});
check('localSubpath: host + path under img/, query hashed into the name, unsafe characters folded, extension from content type', () => {
  assert.match(localSubpath('https://cdn.example.test/a/b.png?v=1'), /^img\/cdn\.example\.test\/a\/b-[0-9a-f]{8}\.png$/);
  assert.equal(localSubpath('https://cdn.example.test/a/b.png'), 'img/cdn.example.test/a/b.png');
  const p1 = localSubpath('https://site.test/_image?href=%2Fa.svg&w=34', 'image/svg+xml');
  const p2 = localSubpath('https://site.test/_image?href=%2Fb.svg&w=34', 'image/svg+xml');
  assert.notEqual(p1, p2); assert.match(p1, /^img\/site\.test\/_image-[0-9a-f]{8}\.svg$/);
  assert.equal(localSubpath('https://site.test/_image?href=%2Fa.svg&w=34', 'image/svg+xml'), p1);
  assert.equal(localSubpath('https://cdn.example.test/x%20y/img', 'image/webp'), 'img/cdn.example.test/x-y/img.webp');
  assert.equal(localSubpath('https://cdn.example.test/'), 'img/cdn.example.test/index');
});
check('--help in an empty cwd: exit 0, usage on stdout; no slug: exit 2', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sr-'));
  const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(h.status, 0); assert.match(h.stdout, /^usage: node stream-render\.mjs/);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' }).status, 2);
  const m = spawnSync(process.execPath, [SCRIPT, 'login'], { cwd, encoding: 'utf8' });
  assert.equal(m.status, 2); assert.match(m.stderr, /missing mapping\.json/);
});
check('rendersButton / modelHasButton: button ctas, submit controls, text in a <button>; links are not', () => {
  assert.ok(rendersButton({ kind: 'cta', classes: 'btn btn-lg', text: 'Go' }));
  assert.ok(rendersButton({ kind: 'cta', classes: 'bg-green px-5 py-2.5 rounded-lg', buttonLike: true, text: 'Get Started' }));
  assert.ok(!rendersButton({ kind: 'cta', classes: 'link', text: 'Read more' }));
  assert.ok(rendersButton({ kind: 'formControl', inputType: 'submit' }));
  assert.ok(!rendersButton({ kind: 'formControl', inputType: 'email' }));
  assert.ok(rendersButton({ kind: 'text', parentTag: 'span', inButton: true, text: 'Search' }));
  assert.ok(!rendersButton({ kind: 'text', parentTag: 'span', text: 'x' }));
  assert.equal(modelHasButton({ sections: [{ ordered: [{ kind: 'heading' }, { kind: 'cta', classes: '' }] }] }), false);
  assert.equal(modelHasButton({ sections: [{ ordered: [{ kind: 'heading' }] }, { ordered: [{ kind: 'formControl', inputType: 'button' }] }] }), true);
  assert.equal(modelHasButton(null), false);
});
check('captureSmells: all-whole scopes and card-grid mega-slots are notes; a wrapper mega-slot and an h1 outside a normal scope warn', () => {
  const card = [{ kind: 'heading', level: 'h3', text: 'a' }, { kind: 'paragraph', text: 'b' }];
  const grid = { slot: 's02', visibleText: 'x'.repeat(80), ordered: [{ kind: 'heading', level: 'h2', text: 'T' }, ...card, ...card, ...card, ...card] };
  const small = (slot) => ({ slot, visibleText: 'y'.repeat(10), ordered: [{ kind: 'paragraph', text: 'p' }] });
  const base = { visibleTextNormalized: 'z'.repeat(100), coverage: { h1InScope: true }, scope: [{ sel: 'main', whole: false }] };
  let r = captureSmells({ ...base, sections: [small('s01'), grid, small('s03')] });
  assert.deepEqual(r.warnings, []); assert.match(r.notes[0], /s02 .*repeating run \(4 items\)/);
  const wrapper = { ...grid, ordered: [{ kind: 'heading', level: 'h2' }, { kind: 'paragraph' }, { kind: 'image' }, { kind: 'listItem' }, { kind: 'cta' }] };
  r = captureSmells({ ...base, sections: [small('s01'), wrapper, small('s03')] });
  assert.match(r.warnings[0], /wrapper-scope smell/);
  r = captureSmells({ ...base, sections: [small('s01')], coverage: { h1InScope: false } });
  assert.equal(r.warnings.length, 2);
  r = captureSmells({ ...base, scope: [{ sel: '.nav', whole: true }, { sel: '.footer', whole: true }], sections: [small('s01')], coverage: { h1InScope: false } });
  assert.deepEqual(r.warnings, []); assert.equal(r.notes.length, 2);
});

check('contrast: WCAG ratio; a low-contrast accent stays an underline, never link or required-marker text', () => {
  assert.equal(Math.round(contrast('#000', '#fff')), 21);
  assert.equal(contrast('rgb(255, 0, 0)', 'nope'), null);
  assert.ok(contrast('rgb(185, 255, 102)', 'rgb(255, 255, 255)') < 1.5);
  const sheet = (accent) => ({ palette: { pageBg: '#ffffff', bodyFg: '#000000', accent } });
  const mk = (accent) => render({ slug: 'p', tokens: sheet(accent), mapping: { pages: { p: { sections: {} } } }, model: { sections: [{ slot: 's01', ordered: [{ kind: 'paragraph', text: 'x' }] }] } }).html;
  assert.match(mk('#b9ff66'), /\.link \{ color: inherit;[^}]*text-decoration-color: var\(--palette-accent\)/);
  assert.match(mk('#b9ff66'), /\.req \{ color: inherit; font-weight: inherit; \}/);
  assert.match(mk('#1a4d8f'), /\.link \{ color: var\(--palette-accent\)/);
});

check('0.41 structure: tables, disclosures at their rest state, glyphs, sr-only, content-sized images, cardTone', () => {
  const ordered = [
    { kind: 'text', text: 'Skip note', srOnly: true },
    { kind: 'table', text: 'Year Count 2024 12', rows: [[{ text: 'Year', header: true }, { text: 'Count', header: true }], [{ text: '2024' }, { text: '12', children: [{ kind: 'cta', text: '12', absHref: 'https://example.test/c' }] }]] },
    { kind: 'heading', level: 'h3', text: 'Closed one keyboard_arrow_down', children: [{ kind: 'text', text: 'Closed one', toggle: 'p1' }, { kind: 'text', text: 'keyboard_arrow_down', glyph: true, toggle: 'p1', sep: ' ' }] },
    { kind: 'paragraph', text: 'Closed body', panels: ['p1'] },
    { kind: 'text', text: 'Open one', toggle: 'p2', toggleOpen: true },
    { kind: 'paragraph', text: 'Open body', panels: ['p2'] },
    { kind: 'text', text: 'Show filters', toggle: 'p3' },
    { kind: 'paragraph', text: '', children: [{ kind: 'image', currentSrc: 'https://example.test/hero.jpg', alt: 'Hero', rw: 768 }] },
    { kind: 'paragraph', text: '', children: [{ kind: 'image', currentSrc: 'https://example.test/old.png', alt: 'Old' }] },
    { kind: 'paragraph', text: 'Badge', children: [{ kind: 'image', currentSrc: 'https://example.test/b.png', alt: 'B', rw: 24 }, { kind: 'text', text: 'Badge', sep: ' ' }] },
  ];
  const m = { pages: { p: { slots: { s01: { module: 'M2', layout: 'cards', cardTone: 'dark' } } } } };
  const { html, warnings } = render({ ...base, slug: 'p', mapping: m, model: { sections: [{ slot: 's01', ordered }] } });
  assert.match(html, /<span class="sr-only">Skip note<\/span>/);
  assert.match(html, /<table class="table"><tbody><tr><th>Year<\/th><th>Count<\/th><\/tr><tr><td>2024<\/td><td><p class="aux"><a class="link" href="https:\/\/example\.test\/c">12<\/a><\/p><\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<button class="disclosure-toggle" type="button" aria-expanded="false" aria-controls="(disclosure-\d+)">Closed one <span class="glyph glyph-down" aria-hidden="true">keyboard_arrow_down<\/span><\/button><div class="disclosure-panel" id="\1" hidden="until-found"><p class="lead">Closed body<\/p><\/div>/);
  assert.match(html, /aria-expanded="true" aria-controls="(disclosure-\d+)">Open one<\/button><div class="disclosure-panel" id="\1"><p class="lead">Open body<\/p>/);
  assert.match(html, /<p class="text">Show filters<\/p>/, 'a toggle with no panel in the stream stays plain text');
  assert.match(html, /<figure class="media media-wide"><img src="https:\/\/example\.test\/hero\.jpg" alt="Hero"><\/figure>/);
  assert.match(html, /<img class="icon" src="https:\/\/example\.test\/old\.png" alt="Old">/, 'a pre-0.41 model (no rw) keeps the inline icon');
  assert.match(html, /<img class="icon" src="https:\/\/example\.test\/b\.png" alt="B"> Badge/);
  assert.match(html, /class="band layout-cards cards-dark /);
  assert.match(html, /\.disclosure-toggle'\); if \(!b\) return;/, 'the toggle script ships with a disclosure');
  assert.deepEqual(warnings.filter((w) => /cardTone/.test(w)), []);
  const bad = render({ ...base, slug: 'p', mapping: { pages: { p: { slots: { s01: { module: 'M2', cardTone: 'neon' } } } } }, model: { sections: [{ slot: 's01', ordered: [{ kind: 'paragraph', text: 'x' }] }] } });
  assert.ok(bad.warnings.some((w) => /unknown cardTone "neon"/.test(w)));
  assert.ok(!/disclosure-toggle'\)/.test(bad.html), 'no script without a disclosure');
});
check('0.41 header: a glyph or sr-only action is an icon button; nav link text keeps glyph/sr-only runs, never the link image', () => {
  const chromeModel = { sections: [{
    slot: 'h1', images: [], ctas: [{ text: 'Skip to content', absHref: 'https://example.test/#main' }, { text: 'About', absHref: 'https://example.test/about' }],
    ordered: [
      { kind: 'cta', text: 'Skip to content', absHref: 'https://example.test/#main', srOnly: true },
      { kind: 'listItem', text: 'About', children: [{ kind: 'cta', text: 'About', absHref: 'https://example.test/about', children: [{ kind: 'image', currentSrc: 'https://example.test/crest.png', alt: '' }, { kind: 'text', text: 'About', sep: '' }] }] },
      { kind: 'text', text: 'search', glyph: true, parentTag: 'span' },
    ],
  }] };
  const { html } = render({ ...base, chromeModel, mapping: { ...mapping, chrome: { header: ['h1'] } } });
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /<a class="sr-only" href="https:\/\/example\.test\/#main">Skip to content<\/a>/);
  assert.match(header, /<a href="https:\/\/example\.test\/about">About<\/a>/);
  assert.ok(!header.includes('crest.png'), 'a nav link image is not repeated as an inline image');
  assert.match(header, /<span class="glyph glyph-search" aria-hidden="true">search<\/span>/);
});
check('0.42 chrome: a link with only sr-only text is the utility bar; a footer with headings is laid out in zones', () => {
  const header = { slot: 'h1', images: [{ currentSrc: 'https://example.test/crest.svg', alt: 'Crest' }], ctas: [],
    ordered: [
      { kind: 'image', currentSrc: 'https://example.test/crest.svg' },
      { kind: 'cta', text: 'NSW Government', absHref: 'https://example.test/gov', children: [{ kind: 'text', text: 'NSW Government', srOnly: true }] },
      { kind: 'listItem', text: 'About', children: [{ kind: 'cta', text: 'About', absHref: 'https://example.test/about' }] },
    ] };
  const footer = { slot: 'f1', images: [], paragraphs: [], ctas: [], iconLinks: [{ label: 'Facebook', absHref: 'https://example.test/fb' }],
    ordered: [
      { kind: 'heading', level: 'h2', text: 'Hill School' },
      { kind: 'paragraph', text: 'We acknowledge the land.' },
      { kind: 'heading', level: 'h3', text: 'Contact' },
      { kind: 'listItem', text: '1 Hill St' }, { kind: 'listItem', text: '02 1234' },
      { kind: 'heading', level: 'h3', text: 'Follow us' },
    ] };
  const { html } = render({ ...base, chromeModel: { sections: [header, footer] }, mapping: { ...mapping, chrome: { header: ['h1'], footer: ['f1'] } } });
  assert.match(html, /<div class="utility-bar"><div class="container"><a href="https:\/\/example\.test\/gov">NSW Government<\/a><\/div><\/div><div class="chrome-row/);
  assert.doesNotMatch(html.match(/<div class="nav-actions">[\s\S]*?<\/div>/)[0], /NSW Government/);
  assert.match(html, /<div class="footer-brand"><p class="footer-name">Hill School<\/p><p class="footer-prose">We acknowledge the land\.<\/p><\/div>/);
  assert.match(html, /<div class="footer-col"><p class="footer-col-title">Contact<\/p><ul><li>1 Hill St<\/li><li>02 1234<\/li><\/ul><\/div>/);
  assert.match(html, /<div class="footer-social"><p class="footer-social-label">Follow us<\/p><ul class="icon-links"><li><a href="https:\/\/example\.test\/fb" aria-label="Facebook">Facebook<\/a><\/li><\/ul><\/div>/);
});
const BRANDED = { sections: [{
  slot: 'h1', images: [{ currentSrc: 'https://example.test/logo.svg', alt: 'Logo' }], ctas: [],
  ordered: [
    { kind: 'image', currentSrc: 'https://example.test/logo.svg' },
    { kind: 'listItem', text: 'About', children: [{ kind: 'cta', text: 'About', absHref: 'https://example.test/about' }] },
    { kind: 'listItem', text: 'Contact', children: [{ kind: 'cta', text: 'Contact', absHref: 'https://example.test/contact' }] },
  ],
}, {
  slot: 'f1', images: [], paragraphs: [], ctas: [],
  ordered: [
    { kind: 'heading', level: 'h2', text: 'Hill School' },
    { kind: 'heading', level: 'h3', text: 'Contact' },
    { kind: 'listItem', text: '1 Hill St' },
    { kind: 'cta', text: 'Privacy', absHref: 'https://example.test/privacy' },
    { kind: 'cta', text: 'Terms', absHref: 'https://example.test/terms', children: [{ kind: 'text', text: 'Terms' }] },
  ],
}] };
const brandedHtml = () => render({ ...base, chromeModel: BRANDED, mapping: { ...mapping, chrome: { header: ['h1'], footer: ['f1'] } } }).html;
check('mobile menu toggle: aria-expanded/aria-controls on the toggle, the nav it controls, the page script and the open-state CSS', () => {
  const html = brandedHtml();
  assert.match(html, /<button class="icon-btn nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">/);
  assert.match(html, /<nav id="site-nav">/);
  assert.match(html, /<script>document\.addEventListener\('click', \(e\) => \{ const b = e\.target\.closest\('\.nav-toggle'\)/);
  assert.match(html, /\.site-header\.nav-open nav \{ display: flex;/);
  const plain = render(base).html;
  assert.doesNotMatch(plain, /nav-toggle"|closest\('\.nav-toggle'\)/);
});
check('zoned footer: a top-level link keeps its destination (text-only and text-children CTAs)', () => {
  const html = brandedHtml();
  assert.match(html, /<li><a href="https:\/\/example\.test\/privacy">Privacy<\/a><\/li>/);
  assert.match(html, /<li><a href="https:\/\/example\.test\/terms">Terms<\/a><\/li>/);
});
check('0.42 main: an icon-font word is a glyph without the flag; a ledgered embed keeps its space after its section', () => {
  const ordered = [
    { kind: 'heading', level: 'h2', text: 'Find us' },
    { kind: 'paragraph', text: 'Visit', children: [{ kind: 'text', text: 'Visit' }, { kind: 'text', text: 'east', parentClass: 'material-icons', sep: ' ' }] },
  ];
  const ledger = [{ what: 'map embed under "Find us"', why: 'dynamics disposition: embed' }];
  const { html } = render({ ...base, slug: 'login', model: { _provenance: { normalize: { ledger } }, sections: [{ slot: 's01', ordered }] } });
  assert.match(html, /<span class="glyph glyph-[a-z-]+" aria-hidden="true">east<\/span>/);
  assert.match(html, /<div class="embed-placeholder" aria-hidden="true"><\/div>/);
  const plain = render({ ...base, slug: 'login', model: { sections: [{ slot: 's01', ordered }] } }).html;
  assert.doesNotMatch(plain, /<div class="embed-placeholder"/);
});

// In a browser at 390px: the menu is folded, the toggle opens and closes it.
await (async () => {
  const name = 'mobile menu toggle in a browser at 390px: folded, opens on click, closes again';
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.setContent(brandedHtml(), { waitUntil: 'domcontentloaded' });
    const nav = page.locator('#site-nav');
    const toggle = page.locator('.nav-toggle');
    assert.equal(await nav.isVisible(), false, 'nav folded at 390px');
    await toggle.click();
    assert.equal(await nav.isVisible(), true, 'nav open after a click');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#site-nav a[href="https://example.test/about"]').isVisible(), true, 'menu links visible');
    await toggle.click();
    assert.equal(await nav.isVisible(), false, 'nav folded after a second click');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.setViewportSize({ width: 1440, height: 800 });
    assert.equal(await toggle.isVisible(), false, 'no toggle at 1440px');
    assert.equal(await nav.isVisible(), true, 'nav shown at 1440px');
    console.log(`✓ ${name}`);
  } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } finally { await browser?.close(); }
})();

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
