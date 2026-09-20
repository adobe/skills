#!/usr/bin/env node
// Fixture test: crawl.mjs capture() emits the documented per-page schema
// (extract/reference/current-state-schema.md) — run under Playwright against
// the local static page evals/lint/fixtures/crawl-capture/page.html, served by
// a node:http server in this process (images and fonts included, one 404).
// Zero external requests. Playwright is resolved the way crawl-assets.test.mjs
// does — STARDUST_GATE_DEPS=<dir>/node_modules, else STARDUST_PW_ROOT/node_modules,
// else the repo root's — never installed by this test (the plugin tree ships no
// node_modules; a project's preflight-runtime.mjs install is the documented
// source). SKIPS with one line (exit 0) when none resolves it.
// Wrap in run-capped when driving it by hand: the browser launch is the only cost.
// Usage: node plugins/stardust/evals/fixtures/crawl-capture.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture, serializeDom, stampHiddenLive, validateRecord, SCHEMA_VERSION } from '../../skills/extract/scripts/crawl.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const deps = process.env.STARDUST_GATE_DEPS || (process.env.STARDUST_PW_ROOT && join(process.env.STARDUST_PW_ROOT, 'node_modules')) || join(REPO_ROOT, 'node_modules');
let chromium;
try { const pw = await import(pathToFileURL(createRequire(join(deps, 'x.js')).resolve('playwright')).href); chromium = (pw.chromium ?? pw.default?.chromium); if (!chromium) throw new Error('no chromium export'); } catch { console.log(`crawl-capture test: SKIP — playwright not resolvable from ${deps} (set STARDUST_GATE_DEPS=<dir>/node_modules, e.g. a project's stardust/node_modules after preflight-runtime.mjs)`); process.exit(0); }

const html = readFileSync(new URL('../lint/fixtures/crawl-capture/page.html', import.meta.url), 'utf8');
const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#147aff"/></svg>`;
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(60, 1)]);
const hits = [];
const server = createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/' || req.url === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  if (req.url === '/img/does-not-exist.png') { res.writeHead(404); return res.end('nope'); }
  if (req.url.startsWith('/img/')) { const big = /hero|wide|fallback/.test(req.url); res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(svg(big ? 600 : 180, big ? 300 : 32)); }
  if (req.url.startsWith('/fonts/')) { res.writeHead(200, { 'content-type': 'font/woff2' }); return res.end(WOFF2); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const rec = await page.evaluate(capture);
  const sidecar = await page.evaluate(serializeDom);
  // hidden-live stamp (importer-skeleton reads it) on the same settled page — no second navigation
  const stamped = await page.evaluate(`(${stampHiddenLive})(document, window, '2026-01-01T00:00:00Z')`);
  const sidecar2 = await page.evaluate(serializeDom);
  await page.close();

  // headings: real + inferred display head (once) + the shadow heading, document order
  const texts = rec.headings.map((h) => h.text);
  assert.equal(texts.filter((t) => t === 'Designed for the way you actually work').length, 1, 'the 32 px <div> display head is inferred exactly once');
  const inferred = rec.headings.find((h) => h.inferred);
  assert.ok(inferred && inferred.tag === 'div' && inferred.level === 1 && inferred.style.fontSize === '32px' && inferred.domPath.includes('section#hero'), `inferred head carries tag/level/style/domPath: ${JSON.stringify(inferred)}`);
  assert.ok(rec.headings.some((h) => h.text === 'Island heading' && h.shadow && h.tag === 'h2'), 'heading inside the open shadow root is captured');
  assert.equal(rec._signals.inferredHeadings, 1); assert.equal(rec._signals.shadowRoots, 1); assert.ok(rec._signals.shadowTextLen > 40);
  assert.ok(texts.indexOf('What you get') < texts.indexOf('Island heading') && texts.indexOf('Island heading') < texts.indexOf('Media'), 'shadow content keeps document order via its host');
  assert.ok(rec.headings.every((h) => h.style && h.style.fontFamily && h.domPath && 'id' in h), 'every heading has style + domPath + id');
  assert.equal(rec.headings.find((h) => h.text === 'What you get').id, 'features-title');

  // hero
  assert.equal(rec.heroHeadline, 'Designed for the way you actually work'); assert.match(rec.heroLede, /^One platform for your whole team/); assert.equal(rec._heroSource, 'dom');
  assert.equal(rec.metaDescription, rec.description, 'description is the 0.24.x alias of metaDescription');
  assert.deepEqual(rec.themeColor, { light: '#ffffff', dark: '#0a0a0a' }); assert.equal(rec.language, 'en');

  // landmarks + children (heading-bounded, structured)
  const mainLm = rec.landmarks.find((l) => l.tag === 'main');
  assert.ok(mainLm && mainLm.role === 'main' && mainLm.innerText.length > 200, 'main landmark with full innerText');
  assert.ok(rec.landmarks.some((l) => l.role === 'banner') && rec.landmarks.some((l) => l.role === 'navigation') && rec.landmarks.some((l) => l.role === 'contentinfo'), 'header/nav/footer roles');
  const features = mainLm.children.find((c) => c.id === 'features');
  assert.ok(features, 'sections are the children of main');
  assert.equal(features.headlineRef, texts.indexOf('What you get'), 'headlineRef indexes headings[]');
  assert.deepEqual(features.lists[0].items, ['Item one has a nested paragraph.', 'Item two also has one.', 'Item three is plain.'], 'li text in lists[]');
  assert.ok(!features.body.some((b) => /Item one has a nested paragraph/.test(b)), 'li > p is not doubled into body[]');
  assert.deepEqual(features.body, ['Alpha.', 'Beta.', 'Gamma.'], 'card paragraphs in body[]');
  assert.ok(features.purpose === 'feature-list', `purpose heuristic: ${features.purpose}`);
  assert.match(features.richtext, /^<h2>What you get<\/h2><ul><li><p>Item one/); assert.ok(!/class=|<div|<script/.test(features.richtext), 'richtext is sanitised to the prose tags');
  const media = mainLm.children.find((c) => c.id === 'media');
  assert.deepEqual(media.qa, [{ q: 'How do I cancel?', a: 'From settings, then billing, then cancel.' }]);
  assert.equal(media.quotes.length, 1); assert.equal(media.quotes[0].text, 'Best tool we ship.'); assert.equal(media.quotes[0].attribution, 'Jane Doe, Acme');
  const hero = mainLm.children.find((c) => c.id === 'hero');
  assert.equal(hero.purpose, 'hero'); assert.equal(hero.headlineRef, texts.indexOf('Designed for the way you actually work'));
  assert.ok(hero.rect.width > 1000 && hero.rect.height >= 400, 'per-module live rect');
  const island = mainLm.children.find((c) => c.id === 'island');
  assert.ok(island && /Shadow paragraph copy/.test(island.innerTextSummary), 'shadow copy reaches the section summary');
  const contact = mainLm.children.find((c) => c.id === 'contact');
  assert.equal(contact.purpose, 'form');
  assert.deepEqual(rec.codeBlocks, ['npm install fixture']);
  assert.deepEqual(rec.alternates, [], 'no hreflang alternates on the fixture → empty list, key present');

  // hidden-live stamp: the settled document is stamped before the sidecar is serialised
  assert.equal(stamped, 1, 'one topmost hidden node (the display:none modal); the closed <details> panel is not hidden-live');
  assert.match(sidecar2, /<body[^>]* data-hidden-live-stamp="2026-01-01T00:00:00Z"/, 'the stamp marker sits on <body> (the sidecar serialises document content — the <html> tag itself is not in it)');
  assert.match(sidecar2, /^<!DOCTYPE html>\n<head>/, 'sidecar shape unchanged: doctype + document content');
  assert.match(sidecar2, /<div class="modal" style="display:none" data-hidden-live="display:none">/, 'the modal carries the reason');
  assert.ok(!/<span data-hidden-live/.test(sidecar2), 'descendants of a stamped node are not stamped again');
  assert.ok(!/<details[^>]*data-hidden-live|<summary[^>]*data-hidden-live|cancel\.<\/p><\/details>[\s\S]*data-hidden-live="visibility/.test(sidecar2), '<details> is never stamped');

  // CTAs
  const trial = rec.ctas.find((c) => c.label === 'Start free trial');
  assert.ok(trial && trial.tag === 'a' && trial.buttonLike && trial.appearsAbove === 'fold' && trial.style.backgroundColor === 'rgb(20, 122, 255)' && trial.style.borderRadius === '8px', JSON.stringify(trial));
  assert.ok(rec.ctas.some((c) => c.label === 'Choose Pro' && c.shadow), 'shadow CTA present');
  assert.ok(rec.ctas.some((c) => c.label === 'Send' && c.tag === 'button'));

  // links split + de-dupe
  assert.deepEqual(rec.links.external, [{ href: 'https://external.example/partner', text: 'Partner', domPath: rec.links.external[0].domPath }]);
  assert.equal(rec.links.internal.filter((l) => l.href === '/pricing').length, 1, 'duplicate nav link de-duplicated by (href, text)');
  assert.ok(rec.links.internal.some((l) => l.href === '/plans/pro' && l.text === 'Choose Pro'), 'shadow link counted');
  assert.ok(rec.links.internal.some((l) => l.href === '/about' && l.domPath.startsWith('header')), 'first occurrence keeps its domPath');
  assert.equal(rec.links.internal.filter((l) => l.href === '/about').length, 1);

  // media
  const fallback = rec.media.images.find((im) => /fallback\.png/.test(im.src));
  assert.ok(fallback, 'the <picture> image is recorded by its src');
  assert.match(fallback.currentSrc, /\/img\/wide\.png$/, 'currentSrc is the <source media> candidate the 1440 render chose');
  assert.equal(fallback.sources.length, 2); assert.equal(fallback.sources[0].media, '(min-width: 1200px)');
  assert.ok(fallback.naturalWidth === 600 && fallback.resolves === true && fallback.rect.width === 600 && fallback.localPath === null, JSON.stringify(fallback));
  const broken = rec.media.images.find((im) => /does-not-exist/.test(im.src));
  assert.ok(broken && broken.resolves === false && broken.naturalWidth === 0, 'a 404 image is resolves:false from the rendered state — no extra request');
  assert.equal(rec._signals.brokenImages, 1);
  assert.ok(rec.media.imgs.every((i) => 'w' in i && 'h' in i && !('rect' in i)), 'media.imgs keeps the 0.24.x alias shape');
  assert.ok(!rec.media.imgs.some((i) => /does-not-exist/.test(i.src)), 'alias lists loaded images only (legacy meaning)');
  const wm = rec.media.images.find((im) => /wordmark/.test(im.src));
  assert.ok(wm && wm.rect.width === 180 && wm.rect.height === 32 && wm.domPath.startsWith('header'), 'banner wordmark rect (brand-surface logo step 1b input)');
  const bgs = rec.media.cssBackgrounds;
  assert.ok(bgs.some((b) => /hero-bg\.png/.test(b.url) && b.pseudo === null && b.backgroundSize === 'cover' && b.boundingClientRect.width > 1000), 'section background object');
  assert.ok(bgs.some((b) => /hero-overlay\.png/.test(b.url) && b.pseudo === '::before' && /::before$/.test(b.domPath)), 'pseudo-element background walked');
  assert.equal(rec.media.inlineSvgs.length, 1); assert.equal(rec.media.inlineSvgs[0].viewBox, '0 0 24 24'); assert.match(rec.media.inlineSvgs[0].markupHash, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(rec.media.iframes.length, 1); assert.ok(rec.media.iframes[0].crossOrigin && rec.media.iframes[0].rect.width === 600);
  assert.equal(rec.embedDominance.dominated, false, 'a 600×400 embed does not dominate a 1440×900 viewport');
  assert.ok(rec.embedDominance.viewportCoveragePct >= 0 && rec.embedDominance.iframeSrc.includes('embed.example'));

  // forms (schema shape, always) + dynamic reach shape from the same walk
  assert.equal(rec.forms.length, 1);
  assert.deepEqual(rec.forms[0].fields[0], { type: 'email', name: 'email', label: 'Your email', required: true });
  assert.equal(rec.forms[0].fields[1].type, 'textarea'); assert.equal(rec.forms[0].action, '/api/contact'); assert.equal(rec.forms[0].method, 'post'); assert.equal(rec.forms[0].thirdParty, null);
  assert.deepEqual(rec.dynamicDom.forms[0].fieldNames, ['email', 'message']); assert.equal(rec.dynamicDom.forms[0].search, false);

  // widgets, components, per-section style, stats
  assert.equal(rec.widgets.accordions.length, 1); assert.equal(rec.widgets.accordions[0].itemCount, 1); assert.deepEqual(rec.widgets.tabs, []);
  assert.equal(rec.components.cards.count, 3); assert.equal(rec.components.grids.count, 1); assert.equal(rec.components.iframes.count, 1); assert.equal(rec.components.formFields.count, 2); assert.equal(rec.components.accordions.count, 1);
  assert.ok(Object.keys(rec.components).length === 20 && Array.isArray(rec.components.other), 'closed list');
  const heroStyle = rec.perSectionStyle.find((s) => s.sectionRef.includes('section#hero'));
  assert.ok(heroStyle && heroStyle.purpose === 'hero' && heroStyle.background.color === 'rgb(8, 12, 20)' && heroStyle.background.hasImage && heroStyle.text.dominantColor === 'rgb(255, 255, 255)', JSON.stringify(heroStyle));
  assert.equal(heroStyle.spacing.paddingInline, '48px');
  const featStyle = rec.perSectionStyle.find((s) => s.sectionRef.includes('section#features'));
  assert.equal(featStyle.borderRadius, '12px'); assert.equal(featStyle.spacing.gap, '24px'); assert.ok(featStyle.shadowsUsed.length === 1);
  assert.equal(rec.stats.motifs.radii['12px'], 3); assert.equal(rec.stats.motifs.radii['8px'], 1); assert.ok(rec.stats.ctaCount > 5 && rec.stats.internalLinkCount >= 8 && rec.stats.externalLinkCount === 1 && rec.stats.wordCount > 40);
  assert.deepEqual(rec.cssCustomProperties, [{ name: '--color-primary', value: '#147aff' }, { name: '--space-md', value: '16px' }]);
  assert.deepEqual(rec.customProps, { '--color-primary': '#147aff', '--space-md': '16px' }, 'customProps alias kept for 0.24.x');

  // icon fonts: family-first, class-agnostic (an `ecs-glyph` class is found without any `icon-` prefix)
  const fams = rec._signals.iconFont.map((f) => f.family).sort();
  assert.deepEqual(fams, ['atlas-icon', 'fixture-icons'], JSON.stringify(rec._signals.iconFont));
  assert.ok(rec._signals.iconFont.find((f) => f.family === 'atlas-icon').classes.includes('ecs-glyph'));
  assert.ok(rec._fontFaces.length === 2 && rec._fontFaces.some((f) => f.family === 'Fixture Sans' && f.weight === '700' && /fixture-sans-700\.woff2$/.test(f.urls[0])), '@font-face descriptors collected for the fonts manifest');

  // sidecar serialises the open shadow root
  assert.match(sidecar, /^<!DOCTYPE html>/);
  assert.match(sidecar, /<template shadowrootmode="open">[\s\S]*Shadow paragraph copy that page\.content\(\) never serialises/, 'declarative shadow DOM in the sidecar');

  // the record + writer fields passes the schema gate
  const written = { _provenance: { renderedBy: 'playwright', fetchedAt: new Date().toISOString(), waitMode: 'medium', waitMs: 2500, httpStatus: 200, schemaVersion: SCHEMA_VERSION, heroSource: rec._heroSource }, slug: 'index', url: `${origin}/`, ...rec, screenshot: null };
  delete written._heroSource; delete written._fontFaces; delete written._contentHash; delete written._compatMode; delete written.dynamicDom;
  const v = validateRecord(written);
  assert.ok(v.ok, `capture() output satisfies validateRecord: ${v.fail.join(', ')}`);
  assert.deepEqual(v.warn, [], `no warnings on the fixture: ${v.warn}`);

  // hit minimisation: the fixture's own sub-resources only; nothing fetched twice by the capture
  const pageHits = hits.filter((u) => u === '/');
  assert.equal(pageHits.length, 1, 'one navigation');
} finally {
  await browser.close();
  server.close();
}
console.log('crawl-capture test: ok');
