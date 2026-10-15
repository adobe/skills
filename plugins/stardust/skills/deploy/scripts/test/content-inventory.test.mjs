#!/usr/bin/env node
// skills/deploy/scripts/test/content-inventory.test.mjs — the offline half of the shared inventory engine (the L5
// content count): the offline `norm` equals the in-page one (the serialised `inventory` source runs in a stub, no
// browser); sanitise.js's named references decode; a pass/fail pair per role; each tolerant rule; the exclusions.
// Run: node plugins/stardust/skills/deploy/scripts/test/content-inventory.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { inventory, norm, offlineInventory, diffOffline } from '../content-inventory.mjs';
import { parseHTML } from '../../../migrate/scripts/encode/dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.example.com/en/guides/trail-running.html';
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const inv = (html, opts = {}) => offlineInventory(parseHTML(html), { base: BASE, ...opts });
const run = (cap, doc, o = {}) => diffOffline(inv(cap, o.cap), inv(doc, o.doc));
const missing = (r) => r.missing.map((m) => `${m.role}:${m.key}`);
const rules = (r) => r.tolerated.map((t) => `${t.rule}:${t.role}:${t.key}`);

// ------------------------------------------------------------------ norm: offline === in-page
// `inventory` is serialised into the page (Playwright passes fn.toString()), so it cannot import the exported `norm`;
// run that same source in a stub DOM and compare the keys it computes with the offline function.
function inPageKeys(texts) {
  const els = texts.map((t) => ({ tagName: 'P', textContent: t, childNodes: [{ nodeType: 3, textContent: t }], closest: () => null, querySelector: () => null, getAttribute: () => null }));
  const probe = { style: {}, set textContent(v) { this.t = v; }, getBoundingClientRect: () => ({ width: 100 }), remove() {} };
  const sandbox = {
    document: { querySelector: () => ({ querySelectorAll: () => els }), createElement: () => probe, body: { appendChild() {} } },
    getComputedStyle: () => ({ fontFamily: 'serif', fontWeight: '400', textTransform: 'none', fontSize: '16px' }),
  };
  return Array.from(vm.runInNewContext(`(${inventory.toString()})(${JSON.stringify(['main', { maxFontPx: 14, maxLen: 30 }])})`, sandbox).items, (i) => i.key);
}
check('offline norm equals the in-page norm on a corpus (typographic folds, arrows, case, whitespace, fixtures)', () => {
  const corpus = ['Hello World', '  Mixed   case\tand\nnew lines  ', 'Read more →', 'Next ›', 'Go ➔ now', 'A > B >> C', '“Quoted” and ‘single’ — em – en',
    'Wait…', 'Wait… then go', 'Dots... mid', 'It’s 5′ 9″ tall', 'Trailing punctuation!?', 'Dots...', 'Bullet •', 'Middle · dot·', 'NBSP\u00a0inside\u00a0text', 'Straße İSTANBUL ÉCOLE',
    'emoji 🏃‍♀️ run', 'e\u0301 combining', '→', '...', 'ﬁ ligature', 'Ǆ titlecase', '0', '  .,;:!?  ', 'a.b.c.', 'Ünïcödé — “mixed” …'];
  for (const f of ['capture.html', 'doc.html']) {
    for (const it of inv(readFileSync(join(HERE, 'fixtures', 'content-count', f), 'utf8')).items) if (it.text) corpus.push(it.text);
  }
  const texts = corpus.filter((t) => /\S/.test(t)); // a whitespace-only element yields no in-page item
  assert.ok(texts.length > 40, `corpus too small (${texts.length})`);
  assert.deepEqual(texts.map(norm), inPageKeys(texts));
  assert.equal(norm(''), ''); assert.equal(norm(null), ''); assert.equal(norm(' \u00a0 '), '');
});

check('every named reference sanitise.js emits decodes (a sanitised document keys like its source)', () => {
  const table = [...readFileSync(join(HERE, '..', 'sanitise.js'), 'utf8').matchAll(/\[0x([0-9A-F]+), '&([A-Za-z0-9]+);'\]/g)].map((m) => [String.fromCodePoint(parseInt(m[1], 16)), m[2]]);
  assert.ok(table.length > 50, `sanitise table not found (${table.length})`);
  const { items } = inv(`<main>${table.map(([, name]) => `<p>x&${name};y</p>`).join('')}<p>n&#233;&#x2014;&amp;&lt;</p></main>`);
  assert.deepEqual(items.map((i) => i.key), [...table.map(([ch]) => norm(`x${ch}y`)), norm('né—&<')]);
});

// ------------------------------------------------------------------ one pass/fail pair per role
check('heading: matched by text — level, case and typographic quotes ignored; an absent heading is MISSING', () => {
  const cap = '<main><h2>Why “trails”?</h2></main>';
  const pass = run(cap, '<main><h3>WHY "TRAILS"</h3></main>');
  assert.equal(pass.pass, true); assert.equal(pass.counts.heading.found, 1);
  const fail = run(cap, '<main><p>Something else entirely</p></main>');
  assert.equal(fail.pass, false); assert.deepEqual(missing(fail), ['heading:why "trails"']);
});

check('link: text + href identity — same-site path vs delivered form, mailto by value, documents by file name', () => {
  const cap = '<main><p><a href="https://www.example.com/en/guides/Gear_List.html?tab=2#top">Gear list</a> <a href="mailto:Guides@Example.com">Email us</a> '
    + '<a href="https://cdn.example.com/files/Trail%20Safety_Checklist.v2.pdf">Safety checklist</a> <a href="https://maps.example.org/trailhead/">Trailhead map</a></p></main>';
  const doc = '<main><p><a href="/en/guides/gear-list?tab=2">Gear list</a> <a href="mailto:guides@example.com">Email us</a> '
    + '<a href="/docs/trail-safety-checklist.pdf">Safety checklist</a> <a href="https://maps.example.org/trailhead">Trailhead map</a></p></main>';
  const pass = run(cap, doc);
  assert.deepEqual(missing(pass), []); assert.equal(pass.counts.link.found, 4); assert.equal(pass.counts.text.capture, 0, 'a run made only of link text is the links\' item');
  const fail = run(cap, doc.replace('/en/guides/gear-list?tab=2', '/en/guides/other'));
  assert.deepEqual(missing(fail), ['link:gear list']); assert.match(fail.missing[0].reason, /href differs/);
  const lost = run(cap, doc.replace('<a href="/en/guides/gear-list?tab=2">Gear list</a>', 'Gear list'));
  assert.deepEqual(missing(lost), ['link:gear list']); assert.match(lost.missing[0].reason, /text kept, link lost/);
});

check('link: opts.linkKey keys internal links (a redirected path), the default keys the rest', () => {
  const redirects = (u) => (new URL(u).pathname === '/en/old-gear.html' ? '/en/guides/gear' : null);
  const cap = '<main><p><a href="/en/old-gear.html">Gear</a></p></main>'; const doc = '<main><p><a href="/en/guides/gear">Gear</a></p></main>';
  assert.equal(run(cap, doc, { cap: { linkKey: redirects }, doc: { linkKey: redirects } }).pass, true);
  assert.deepEqual(missing(run(cap, doc)), ['link:gear']);
});

check('image: identity by mediaKey, then file stem (fetcher -<sha8> dropped), then alt; an absent image is MISSING', () => {
  const contentUrl = 'https://content.da.live/example-org/example-site/media/guides/forest-loop-0a1b2c3d.jpg';
  const mediaKey = (u) => (u === 'https://www.example.com/assets/IMG_2041.jpg' ? contentUrl : null);
  const byMedia = run('<main><img src="/assets/IMG_2041.jpg"></main>', `<main><img src="${contentUrl}"></main>`, { cap: { mediaKey } });
  assert.equal(byMedia.pass, true);
  assert.deepEqual(missing(run('<main><img src="/assets/IMG_2041.jpg"></main>', `<main><img src="${contentUrl}"></main>`)), ['image:img_2041'], 'renamed, no alt, no ledger: MISSING');
  assert.equal(run('<main><img src="https://www.example.com/assets/Hero-Trail.jpg?w=1200"></main>', '<main><img src="https://content.da.live/o/s/media/g/hero-trail-1a2b3c4d.jpg"></main>').pass, true);
  assert.equal(run('<main><img src="/a.jpg" alt="Runner at dawn"></main>', '<main><img src="/b.png" alt="Runner at dawn"></main>').pass, true);
  const lazy = run('<main><picture><source srcset="/assets/coast.webp 1x, /assets/coast@2x.webp 2x"><img src="data:image/gif;base64,R0lGOD" data-src="/assets/coast.jpg"></picture></main>', '<main><img src="https://content.da.live/o/s/media/g/coast-9f8e7d6c.jpg"></main>');
  assert.equal(lazy.pass, true, 'data: placeholders are no identity; data-*src and <source srcset> are');
  const gone = run('<main><img src="/a.jpg" alt="Runner at dawn"><p>Caption text stays</p></main>', '<main><p>Caption text stays</p></main>');
  assert.deepEqual(missing(gone), ['image:runner at dawn']); assert.equal(gone.missing[0].src, 'https://www.example.com/a.jpg');
});

check('text: block runs across inline markup and entity encoding; a dropped or truncated run is MISSING', () => {
  const cap = '<main><div><p>Soft ground is <strong>kinder</strong> to your joints, and the view’s better.</p><div>Start slowly &amp; build time on feet. Pace comes later.</div></div></main>';
  const doc = '<main><div><p>Soft ground is kinder to your joints, and the view&rsquo;s better.</p><p>Start slowly &amp; build time on feet. Pace comes later.</p></div></main>';
  const pass = run(cap, doc);
  assert.deepEqual(missing(pass), []); assert.equal(pass.counts.text.found, 2);
  assert.deepEqual(missing(run(cap, doc.replace(/<p>Start[^<]*<\/p>/, ''))), ['text:start slowly & build time on feet. pace comes later']);
  assert.deepEqual(missing(run(cap, doc.replace(' Pace comes later.', ''))), ['text:start slowly & build time on feet. pace comes later'], 'truncated after the first sentence');
});

// ------------------------------------------------------------------ the tolerant rules (exact same-role matches first)
check('merged: runs split differently are found word-bounded in the block-joined text', () => {
  const r = run('<main><div><div>Pack light,</div><div>move fast and stay warm</div></div></main>', '<main><p>Pack light, move fast and stay warm</p></main>');
  assert.deepEqual(missing(r), []); assert.deepEqual(rules(r), ['merged:text:pack light', 'merged:text:move fast and stay warm']); assert.deepEqual(r.extra, []);
  const partial = run('<main><div><div>Pack light,</div><div>move fast and stay warm</div></div></main>', '<main><p>Move fast and stay warm</p></main>');
  assert.deepEqual(missing(partial), ['text:pack light']);
});

check('merged: a short run (≤ 3 words) found only inside other text must occur as often as in the capture', () => {
  const r = run('<main><dl><dt>Format</dt><dd>PDF</dd><dt>Size</dt><dd>2 MB</dd></dl><p>Choose the format that suits your device.</p></main>',
    '<main><p>PDF</p><p>2 MB</p><p>Choose the format that suits your device.</p></main>');
  assert.deepEqual(missing(r), ['text:format', 'text:size']); assert.match(r.missing[0].reason, /1 of 2/);
});

check('promoted / demoted: a run that became a heading or a link, a heading that became a run', () => {
  const p = run('<main><p>Plan your first run</p></main>', '<main><h2>Plan your first run</h2></main>');
  assert.deepEqual(rules(p), ['promoted:text:plan your first run']); assert.deepEqual(p.extra, []);
  const d = run('<main><h3>How long is the loop?</h3></main>', '<main><div><div><p>How long is the loop?</p></div></div></main>');
  assert.deepEqual(rules(d), ['demoted:heading:how long is the loop']); assert.equal(d.pass, true);
  assert.deepEqual(missing(run('<main><h3>How long is the loop?</h3></main>', '<main><p>How far is the loop?</p></main>')), ['heading:how long is the loop']);
});

check('relabelled: a card link split into a titled link plus a cell keeps its href and its full text', () => {
  const cap = '<main><a href="/en/trips/ridge-run.html"><h3>Ridge run weekend</h3><span>12 May 2026</span></a></main>';
  const r = run(cap, '<main><h3><a href="/en/trips/ridge-run">Ridge run weekend</a></h3><p>12 May 2026</p></main>');
  assert.deepEqual(missing(r), []); assert.deepEqual(rules(r), ['relabelled:link:ridge run weekend 12 may 2026']);
  const lost = run(cap, '<main><h3><a href="/en/trips/ridge-run">Ridge run weekend</a></h3></main>');
  assert.deepEqual(missing(lost).sort(), ['link:ridge run weekend 12 may 2026', 'text:12 may 2026']);
});

check('duplicate: repeated copy (alternate tab panels) encoded once — set semantics per role', () => {
  const panel = '<div class="panel"><h4>Ridge run</h4><a href="/en/trips/ridge-run.html">Book now</a><img src="/assets/ridge.jpg" alt="Ridge"><p>Two days</p></div>';
  const r = run(`<main>${panel}${panel}</main>`, '<main><h4>Ridge run</h4><p><a href="/en/trips/ridge-run">Book now</a></p><p><img src="https://content.da.live/o/s/media/g/ridge-1a2b3c4d.jpg" alt="Ridge"></p><p>Two days</p></main>');
  assert.equal(r.pass, true); assert.deepEqual(rules(r).sort(), ['duplicate:heading:ridge run', 'duplicate:image:ridge', 'duplicate:link:book now', 'duplicate:text:two days']);
  const none = run(`<main>${panel}${panel}</main>`, '<main><h4>Ridge run</h4><p><a href="/en/trips/ridge-run">Book now</a></p></main>');
  assert.deepEqual(missing(none).sort(), ['image:ridge', 'image:ridge', 'text:two days', 'text:two days'], 'a duplicate needs one exact match first');
});

check('unlinked: a link without a destination (#…) is matched by its text only', () => {
  assert.deepEqual(rules(run('<main><p><a href="#top">Back to top</a></p></main>', '<main><p>Back to top</p></main>')), ['unlinked:link:back to top']);
  assert.deepEqual(missing(run('<main><p><a href="#top">Back to top</a></p></main>', '<main><p>Elsewhere</p></main>')), ['link:back to top']);
});

// ------------------------------------------------------------------ exclusions, EXTRA, the result shape
check('exclusions: non-content tags, UI controls, hidden-live (not <details>), the document\'s metadata blocks, opts.exclude reasons', () => {
  const cap = '<main><script>var t = "<p>not content</p>";</script><style>p{}</style><svg><text>icon</text></svg><button>Next slide</button>'
    + '<h2><button>Toggle</button> Questions</h2><div data-hidden-live="display:none"><p>Modal copy</p></div><details data-hidden-live="closed"><summary>More</summary><p>Folded answer</p></details>'
    + '<ol class="indicators"><li>Slide 1</li></ol><p>Body copy</p></main>';
  const capInv = inv(cap, { exclude: (n) => (n.attrs.class === 'indicators' ? 'chrome' : false) });
  assert.deepEqual(capInv.items.map((i) => `${i.role}:${i.key}`), ['heading:toggle questions', 'text:more', 'text:folded answer', 'text:body copy']);
  assert.deepEqual(capInv.excluded, { chrome: { n: 1, sample: ['Slide 1'] }, control: { n: 1, sample: ['Next slide'] }, 'hidden-live': { n: 1, sample: ['Modal copy'] } });
  const doc = '<main><div><h2>Toggle Questions</h2><p>More</p><p>Folded answer</p><p>Body copy</p></div><div class="metadata"><div><div>Title</div><div>Trail running</div></div></div></main>';
  const r = diffOffline(capInv, inv(doc));
  assert.equal(r.pass, true); assert.deepEqual(r.extra, [], 'the metadata block is not content');
  assert.deepEqual(Object.keys(r.counts), ['heading', 'link', 'image', 'text']);
});

check('EXTRA document content is reported, never failed', () => {
  const r = run('<main><p>Body copy</p></main>', '<main><p>Body copy</p><p>Invented copy</p><p><a href="/en/new">New link</a></p></main>');
  assert.equal(r.pass, true); assert.deepEqual(r.extra.map((e) => `${e.role}:${e.key}`), ['link:new link', 'text:invented copy']);
  assert.equal(r.counts.text.extra, 1);
});

process.exit(failed ? 1 : 0);
