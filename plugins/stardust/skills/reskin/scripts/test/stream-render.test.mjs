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
import { captureSmells, findRepeat, localSubpath, modelHasButton, render, rendersButton, tokenVars } from '../stream-render.mjs';

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
check('findRepeat: intro, repeating items and tail; a shifted run loses the coverage tie; null when nothing repeats', () => {
  const h = (level, text = 'x') => ({ kind: 'heading', level, text });
  const p = { kind: 'paragraph', text: 'p' }; const im = { kind: 'image', src: 'i' }; const a = { kind: 'cta', text: 'c', href: '#' };
  assert.deepEqual(findRepeat([h('h2'), p, im, h('h3'), p, im, h('h3'), p, im, h('h3'), p, a]), { start: 2, period: 3, count: 3 });
  const t = (cls) => ({ kind: 'text', text: 't', parentClass: cls });
  // intro (h2, p) then [num, title, p] x3: the run starting at the subtitle covers as many nodes but is shifted.
  assert.deepEqual(findRepeat([h('h2'), p, t('n'), t('t'), p, t('n'), t('t'), p, t('n'), t('t'), p]), { start: 2, period: 3, count: 3 });
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
  assert.deepEqual(r.warnings, []); assert.match(r.notes[0], /s02 .*repeating run \(4 × 2 nodes\)/);
  const wrapper = { ...grid, ordered: [{ kind: 'heading', level: 'h2' }, { kind: 'paragraph' }, { kind: 'image' }, { kind: 'listItem' }, { kind: 'cta' }] };
  r = captureSmells({ ...base, sections: [small('s01'), wrapper, small('s03')] });
  assert.match(r.warnings[0], /wrapper-scope smell/);
  r = captureSmells({ ...base, sections: [small('s01')], coverage: { h1InScope: false } });
  assert.equal(r.warnings.length, 2);
  r = captureSmells({ ...base, scope: [{ sel: '.nav', whole: true }, { sel: '.footer', whole: true }], sections: [small('s01')], coverage: { h1InScope: false } });
  assert.deepEqual(r.warnings, []); assert.equal(r.notes.length, 2);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
