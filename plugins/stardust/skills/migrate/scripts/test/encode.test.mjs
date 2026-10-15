#!/usr/bin/env node
// Fixture test: encode.mjs + encode/engine.mjs — the shipped sibling encoder on a synthetic project (fixtures/encode:
// one template "trip", archetype trips-river-walk with its gated content/ document, sibling trips-forest-loop, media
// ledger with sources, asset ledger, redirects.tsv, chrome map, the map under stardust/import/trips-river-walk/).
//
//   round-trip    the archetype encodes to its gated delivered document at `strict` (and a changed alt fails strict only)
//   output form   body fragment; metadata block alone in the first section (Title/Description/nav/footer, no lang row);
//                 section-metadata styles; blocks as rows × cells; media → contentUrl, unresolved media kept absolute and
//                 recorded; documents → asset-ledger path; internal links localised (roster + redirects); nav/footer from
//                 the chrome map; whitespace normalised (pre/code byte-exact, NBSP kept)
//   sanitise last non-ASCII in the capture → entities; the output is a fixed point of sanitise's encode()
//   grammar v2    compound cell (parts), itemWrap + link → plain-text fallback (+ titleAttr), id-reference cell, one
//                 cell per match, blank-container drop, metadata from a selector with fallback, markers as an array,
//                 section-break, a module nested in rich content → flattened, a component pattern → unmapped
//   hard stops    unmapped · flattened · variance (fingerprint + census; accepted prints) · incomplete (L5) · error —
//                 each exits 2 and writes nothing for the page; missing capture / invalid map → exit 1
//   writes        second run → zero writes (unchanged); --dry-run writes nothing; --lint/--sweep stub → exit 1
//   determinism   two in-process runs + a child process with another TZ/LANG → identical sha256
//   --help        in an empty dir: exit 0, usage on stdout, nothing written
//
// The hard-stop cases follow the importer skeleton's test on the `stardust/next` branch
// (`skills/migrate/scripts/test/importer-skeleton.test.mjs`, commit 9aaeff4f), rewritten for the encoder.
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, encodeTemplate, loadMap, loadEncoderDeps } from '../encode.mjs';
import { encodePage, tidy, validateVocabulary, varianceDelta } from '../encode/engine.mjs';
import { parseHTML, qs, qsa, textOf, kids } from '../encode/dom.mjs';
import { loadSite } from '../encode/site.mjs';
import { encode as sanitise } from '../../../deploy/scripts/sanitise.js';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', 'encode.mjs');
const FX = join(HERE, 'fixtures', 'encode');
const A = 'trips-river-walk'; const S1 = 'trips-forest-loop';
const T = mkdtempSync(join(tmpdir(), 'encode-test-'));
cpSync(FX, T, { recursive: true });
const P = (...p) => join(T, ...p);
const read = (...p) => readFileSync(P(...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const run = async (...args) => { const out = []; const err = []; const code = await main(['--root', T, ...args], { out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join('\n'), err: err.join('\n'), last: out[out.length - 1] }; };
const cells = (row) => kids(row).map((c) => c);
const docOf = (html) => parseHTML(html);
const SIB = read('stardust', 'current', 'pages', `${S1}.html`);
// a mutated sibling: its capture + page record, a member of the template
function addPage(slug, html) {
  writeFileSync(P('stardust', 'current', 'pages', `${slug}.html`), html);
  writeFileSync(P('stardust', 'current', 'pages', `${slug}.json`), JSON.stringify({ slug, url: `https://www.example.com/trips/${slug}.html`, title: slug, description: 'A sibling.' }));
  const t = json('stardust', 'rollout', 'coverage', 'templates.json');
  if (!t.templates[0].pages.includes(slug)) t.templates[0].pages.push(slug);
  writeFileSync(P('stardust', 'rollout', 'coverage', 'templates.json'), JSON.stringify(t));
}
const mutate = (from, to) => { assert.ok(SIB.includes(from), `fixture holds ${from}`); return SIB.replace(from, to); };
const pageOf = (r) => JSON.parse(r.out.split('\n')[0]).pages;

try {
  // --- encode the template: both pages clean, written, verdict last --------------------------------------------------
  let r = await run('--template', A);
  assert.equal(r.code, 0, `template encodes\n${r.err}\n${r.out}`);
  assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 0', 'verdict line is the last line');
  assert.ok(existsSync(P('stardust', 'encoded', 'trips', 'river-walk.html')) && existsSync(P('stardust', 'encoded', 'trips', 'forest-loop.html')), 'stardust/encoded/<da-path>.html per page');
  const arch = read('stardust', 'encoded', 'trips', 'river-walk.html');
  const sib = read('stardust', 'encoded', 'trips', 'forest-loop.html');

  // --- second run: zero writes; --dry-run writes nothing ------------------------------------------------------------
  r = await run('--template', A);
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0', 'unchanged inputs → zero writes');
  rmSync(P('stardust', 'encoded'), { recursive: true });
  r = await run('--template', A, '--dry-run');
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 0'); assert.ok(!existsSync(P('stardust', 'encoded')), '--dry-run writes nothing');
  r = await run('--template', A, '--slug', S1);
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 1 · unchanged 0 · stopped 0', '--slug encodes only the named page');
  assert.ok(!existsSync(P('stardust', 'encoded', 'trips', 'river-walk.html')), 'the archetype is encoded for its prints but not written');
  assert.equal(read('stardust', 'encoded', 'trips', 'forest-loop.html'), sib, 'the same bytes whether or not the archetype is selected');

  // --- delivered form ---------------------------------------------------------------------------------------------
  const d = docOf(arch); const mainEl = qs(d, 'main'); const secs = kids(mainEl);
  assert.match(arch, /^<body>\n<header><\/header>\n<main>\n/, 'a body fragment: header, main');
  assert.match(arch, /<\/main>\n<footer><\/footer>\n<\/body>\n$/, '… footer, trailing newline');
  assert.equal(kids(secs[0]).length, 1, 'the metadata block is alone in the first section');
  const meta = Object.fromEntries(qsa(secs[0], '.metadata > div').map((row) => kids(row).map((c) => textOf(c))));
  assert.deepEqual(Object.keys(meta), ['Title', 'Description', 'nav', 'footer'], 'Title/Description/nav/footer rows, no lang row');
  assert.equal(meta.nav, '/trips/nav'); assert.equal(meta.footer, '/trips/footer', 'nav/footer from the chrome map');
  assert.equal(meta.Description, 'An easy morning loop along the water &mdash; caf&eacute; stop included.', 'empty page description → text(<selector>) fallback');
  assert.equal(Object.fromEntries(qsa(docOf(sib), '.metadata > div').map((row) => kids(row).map((c) => textOf(c)))).Description, 'A shaded loop through the pines, with a lookout over the valley.', 'the page description wins when present');
  assert.deepEqual(qsa(d, '.section-metadata').map((s) => textOf(kids(kids(s)[0])[1])), ['rule', 'highlight'], 'section-break:rule and section-style:highlight');
  assert.equal(kids(secs[2]).length, 1, 'section-break emits an empty styled section');
  assert.deepEqual(qsa(mainEl, 'main > div > div[class]').map((b) => b.attrs.class).filter((c) => !/metadata/.test(c)), ['hero', 'facts', 'tags', 'tabs', 'links', 'teaser featured'], 'blocks and their variants, in document order');
  assert.match(arch, /<img src="https:\/\/content\.da\.live\/example-org\/example-site\/media\/trips\/river-walk-hero-3e9a1f04\.jpg" alt="A river bend at dawn" title="River bend">/, 'media → the ledger contentUrl (picture/source candidates)');
  assert.match(arch, /<p><img src="https:\/\/www\.example\.com\/media\/old-bridge\.jpg" alt="The old stone bridge"><\/p>/, 'an image with no ledger entry stays absolute');
  assert.match(arch, /<a href="\/docs\/trail-map\.pdf">/, 'a document link → the asset-ledger path');
  assert.match(arch, /<a href="\/trips\/forest-loop">Forest Loop<\/a>, the <a href="\/trips\/river-walk">old river page<\/a>/, 'roster page and redirect localised');
  assert.match(arch, /<a href="https:\/\/www\.example\.com\/shop\/boots\.html">boots<\/a> and <a href="https:\/\/maps\.example\.org\/river">/, 'unknown source page and external host stay absolute');
  assert.doesNotMatch(arch, /site-header|Privacy|breadcrumb|dataLayer|Sign up|Chat with|for River Walk|grid-col/, 'chrome, scripts, drop:, dynamics: and transform drops are gone');
  assert.match(arch, /<p>The trail follows the north bank&nbsp;for 6&nbsp;km\. Bring water; the kiosk at the bridge opens at <strong>9 am<\/strong>\.<\/p>/, 'whitespace runs collapse, NBSP kept, b → strong');
  assert.match(arch, /<code>47\.1 {2}N, {2}8\.5 {2}E<\/code> &mdash; <em>follow the blue markers<\/em>\.<br>Dogs/, 'code byte-exact; no whitespace after <br>');
  assert.match(arch, /<h1>River Walk<\/h1>/, 'heading indentation trimmed');

  // --- the audit records what the walk dropped, deferred or could not resolve ---------------------------------------
  r = await run('--template', A, '--slug', A, '--json', '--dry-run');
  const rep0 = pageOf(r)[0].report;
  assert.deepEqual(rep0.dropped.map((x) => [x.kind, x.reason]), [['newsletter', 'runtime form, delivered by a dynamics row']], 'drop: recorded');
  assert.deepEqual(rep0.deviations, [{ kind: 'dynamic-dependency', row: 'DYN-1', module: 'chat' }], 'dynamics: recorded');
  assert.deepEqual(rep0.mediaUnresolved, ['https://www.example.com/media/old-bridge.jpg'], 'an image with no ledger entry is recorded, never invented');
  assert.deepEqual(rep0.linksUnresolved, ['https://www.example.com/trips/river-walk/book.html', 'https://www.example.com/shop/boots.html'], 'source-host links outside the roster are recorded');
  assert.equal(rep0.hiddenLive, 'unstamped'); assert.deepEqual(rep0.incomplete, []); assert.equal(rep0.count.counts.link.missing, 0);

  // --- sanitise applied last ------------------------------------------------------------------------------------------
  assert.ok(/[^\x00-\x7f]/.test(read('stardust', 'current', 'pages', `${A}.html`)), 'the capture carries raw non-ASCII');
  assert.ok(!/[^\x00-\x7f]/.test(arch), 'the encoded document is pure ASCII');
  assert.match(arch, /caf&eacute;/); assert.equal(sanitise(arch).output, arch, 'a fixed point of sanitise: finalisation is a byte copy');

  // --- grammar v2 -------------------------------------------------------------------------------------------------------
  const hero = qsa(d, '.hero > div > div');
  assert.equal(hero.length, 2, 'hero: image cell + compound cell');
  assert.deepEqual(kids(hero[1]).map((c) => c.tag), ['p', 'h1', 'p', 'p'], 'parts: kicker, title, lede, CTA — each with its own mode and wrap');
  assert.match(arch, /<p><strong><a href="https:\/\/www\.example\.com\/trips\/river-walk\/book\.html">Book a guide<\/a><\/strong><\/p>/, 'a link part wrapped p > strong');
  assert.doesNotMatch(sib.match(/<div class="hero">[\s\S]*?\n<\/div>/)[0], /<strong>/, 'an optional part that is absent is omitted');
  assert.match(arch, /<ul><li><a href="https:\/\/social\.example\.net\/share\?u=river" title="Share on the social network">Social<\/a><\/li><li><a href="mailto:\?subject=River%20Walk">Email<\/a><\/li><li>Print<\/li><\/ul>/, 'itemWrap per item before join; titleAttr unless equal to the text; no anchor → plain text');
  assert.deepEqual(qsa(d, '.tabs > div').map((row) => textOf(kids(row)[0])), ['Morning', 'Afternoon'], 'id-reference cell: aria-labelledby → the tab label');
  assert.deepEqual(qsa(docOf(sib), '.tabs > div').map((row) => textOf(kids(row)[0])), ['Gate to lookout', 'Lookout', 'Back to the gate'], '… one row per panel on the sibling');
  assert.deepEqual(qsa(d, '.tags > div > div').map(textOf), ['Spring', 'Summer', 'Autumn'], 'one cell per match');
  assert.deepEqual(qsa(docOf(sib), '.tags > div > div').map(textOf), ['Summer', 'Autumn'], '… a variable-width row');
  assert.doesNotMatch(arch, /<p>&nbsp;<\/p>|&#160;|<p><\/p>/, 'blank-container drop: <p>&nbsp;</p> and <div>&#160;</div> are gone');
  assert.deepEqual(qsa(d, '.facts > div').map((row) => cells(row).map(textOf)), [['Distance', '6 km'], ['Climb', '120 m'], ['Grade', 'easy']], 'rows × cells');

  // --- markers must be an array; invalid maps exit 1 ---------------------------------------------------------------------
  const vocabFile = P('stardust', 'import', A, 'vocabulary.json'); const vocabRaw = read('stardust', 'import', A, 'vocabulary.json');
  const vocab = JSON.parse(vocabRaw);
  writeFileSync(vocabFile, JSON.stringify({ ...vocab, markers: Object.fromEntries(vocab.markers.map((m) => [m.sel, m])) }));
  r = await run('--template', A);
  assert.equal(r.code, 1); assert.match(r.err, /markers: an ARRAY/, 'an object keyed by selector is rejected (JSON key order is never precedence)');
  writeFileSync(vocabFile, JSON.stringify({ ...vocab, markers: [...vocab.markers, { sel: '.x', emitter: 'block:x', cells: [{ as: 'derived' }] }] }));
  r = await run('--template', A);
  assert.equal(r.code, 1); assert.match(r.err, /as "derived": use rich\|inline/, 'a cell mode the grammar lacks is invalid, never an extension');
  writeFileSync(vocabFile, vocabRaw);
  assert.deepEqual(validateVocabulary({ root: 'main', metadata: [['Title', '$nope']] }), ['metadata "Title": unknown variable $nope ($title $description $nav $footer $h1 $ogtitle)']);

  // --- hard stops: each exits 2, the page is not written ------------------------------------------------------------------
  const stopCase = async (slug, html, status, re) => {
    addPage(slug, html);
    const res = await run('--template', A, '--slug', slug, '--json');
    assert.equal(res.code, 2, `${slug}: exit 2\n${res.err}\n${res.out}`);
    const [rec] = pageOf(res);
    assert.equal(rec.status, status, `${slug}: status ${status} (${JSON.stringify(rec.report)})`);
    if (re) assert.match(JSON.stringify(rec.report), re);
    assert.equal(res.last, 'encoded 0 · unchanged 0 · stopped 1');
    assert.ok(!existsSync(P('stardust', 'encoded', 'trips', `${slug}.html`)), `${slug}: nothing written`);
    return rec;
  };
  await stopCase('stop-unmapped', mutate('<div class="mod-image"', '<div class="mod-poll"><div class="ui-poll"><p>Which trail next?</p></div></div><div class="mod-image"'), 'unmapped', /"selector":"childClass/);
  await stopCase('stop-flattened', mutate('<span class="ui-facts__value">310 m</span>', ''), 'flattened', /cell 1 \(\.ui-facts__value\) empty/);
  await stopCase('stop-nested', mutate('<p>Benches and a view over three villages.</p>', '<p>Benches.</p></div></div><div class="mod-tags"><div class="ui-tags"><span class="ui-tags__item">Views</span></div></div><div class="mod-text"><div class="ui-text"><p>More.</p>'), 'flattened', /a module nested inside rich content/);
  await stopCase('stop-nested-unknown', mutate('<p>A steady climb on a wide forest road.</p>', '<p>A steady climb.</p></div></div><div class="mod-quiz"><div class="ui-quiz"><p>Q?</p></div></div><div><div><p>x</p>'), 'flattened', /"selector":"childClass/);
  const v = await stopCase('stop-variance', mutate('mod-teaser mod-teaser--featured', 'mod-teaser'), 'variance', /"change":"added","print":"\.mod-teaser \| div\.mod-teaser \| mod-container>ui-container"/);
  assert.deepEqual(v.report.variance.map((x) => x.change), ['added', 'removed'], 'a SET difference both ways');
  await stopCase('stop-census', mutate('<div class="mod-image"', '<div class="promo-strip"><p>Members ride free on Sundays.</p></div><div class="mod-image"'), 'variance', /UNMARKED \| div\.promo-strip \| mod-container>ui-container/);
  await stopCase('stop-incomplete', mutate('<h3 class="ui-teaser__title">River Walk</h3>', '<h3 class="ui-teaser__title">River Walk</h3><p class="ui-teaser__desc">Two hours along the water, café at the bridge.</p>'), 'incomplete', /"role":"text","key":"two hours along the water, caf/);
  await stopCase('stop-noroot', mutate('<main id="main" class="page-main">', '<div id="main-x">').replace('</main>', '</div>'), 'error', /root selector \\"main#main\\" matched nothing/);
  await stopCase('stop-noh1', mutate('<h1 class="ui-hero__title">Forest Loop</h1>', ''), 'error', /no <h1>/);
  // an accepted print never stops a page
  writeFileSync(vocabFile, JSON.stringify({ ...vocab, variance: { accept: v.report.variance.map((x) => ({ print: x.print, reason: 'the teaser variant is an editorial choice' })) } }));
  r = await run('--template', A, '--slug', 'stop-variance');
  assert.equal(r.code, 0, `accepted prints → clean\n${r.out}`); assert.equal(r.last, 'encoded 1 · unchanged 0 · stopped 0');
  writeFileSync(vocabFile, vocabRaw);
  assert.deepEqual(varianceDelta(['a', 'b'], ['b', 'c'], [{ print: 'c', reason: 'r' }]), [{ change: 'added', print: 'a' }], 'varianceDelta: symmetric difference minus accepted');

  // --- a whole run with stopped pages exits 2 and still writes the clean ones; missing input exits 1 ----------------------
  rmSync(P('stardust', 'encoded'), { recursive: true });
  r = await run('--template', A);
  assert.equal(r.code, 2); assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 9', 'the archetype and the sibling written; nine stops');
  assert.match(r.out, /✗ stop-incomplete incomplete\n {4}incomplete MISSING text "Two hours along the water/, 'per-page status line + findings');
  // a declared drop no cell reaches is not content either (the count never asks for what the map dropped)
  addPage('drop-unreached', mutate('<a class="ui-teaser__link"', '<span class="ui-sr-only">Opens the trip page</span><a class="ui-teaser__link"'));
  r = await run('--template', A, '--slug', 'drop-unreached', '--dry-run');
  assert.equal(r.code, 0, `a transform drop outside every cell is excluded from the count\n${r.out}`);
  addPage('no-capture', '');
  rmSync(P('stardust', 'current', 'pages', 'no-capture.html'));
  r = await run('--template', A, '--slug', 'no-capture');
  assert.equal(r.code, 1, 'a missing capture is missing input'); assert.match(r.out, /no capture stardust\/current\/pages\/no-capture\.html/);
  r = await run('--template', A, '--slug', 'no-capture,stop-noh1');
  assert.equal(r.code, 2, 'a stopped page wins over missing input');
  r = await run('--template', 'no-such-template'); assert.equal(r.code, 1); assert.match(r.err, /no template/);
  r = await run('--template', A, '--slug', 'not-a-member'); assert.equal(r.code, 1); assert.match(r.err, /not a page of template/);
  r = await run('--bogus'); assert.equal(r.code, 1); assert.match(r.err, /unknown flag --bogus/);
  r = await run('--lint', '--template', A); assert.equal(r.code, 1); assert.match(r.err, /--lint: not implemented/);
  r = await run('--sweep', '--template', A); assert.equal(r.code, 1); assert.match(r.err, /--sweep: not implemented/);

  // --- round-trip: the archetype reproduces its gated document at strict ------------------------------------------------
  r = await run('--roundtrip', '--template', A, '--level', 'strict');
  assert.equal(r.code, 0, `round-trip at strict\n${r.out}`); assert.match(r.last, /roundtrip trips-river-walk at strict: equal/);
  const gated = read('content', 'trips', 'river-walk.html');
  writeFileSync(P('content', 'trips', 'river-walk.html'), gated.replace('alt="Pines in fog"', 'alt="Pines"'));
  r = await run('--roundtrip', '--template', A, '--level', 'strict'); assert.equal(r.code, 2, 'an alt change fails strict');
  r = await run('--roundtrip', '--template', A); assert.equal(r.code, 0, '… but not text (the default level)');
  writeFileSync(P('content', 'trips', 'river-walk.html'), gated);
  assert.ok(!existsSync(P('stardust', 'encoded', 'trips', 'stop-noroot.html')), 'round-trip writes nothing');

  // --- engine units: whitespace, NBSP, pre ----------------------------------------------------------------------------
  assert.equal(tidy('<p>  a <strong> b </strong>  c </p>\n\n<p>x <br>\n  y</p><pre>  keep   me\n</pre>'), '<p>a <strong>b </strong>c</p>\n<p>x<br>y</p>\n<pre>  keep   me\n</pre>');
  assert.equal(tidy('<p>\u00a0a\u00a0 </p>'), '<p>\u00a0a\u00a0</p>', 'NBSP is content, never trimmed');

  // --- determinism: two in-process runs, then a child process with another TZ and locale -----------------------------
  const site = await loadSite(T); const template = site.templateOf(A); const map = loadMap(T, A); const deps = await loadEncoderDeps();
  const once = async () => (await encodeTemplate({ root: T, site, template, map, deps, slugs: [A, S1] })).records.map((x) => sha(x.html)).join(',');
  const first = await once(); assert.equal(await once(), first, 'two in-process runs: identical bytes');
  rmSync(P('stardust', 'encoded'), { recursive: true });
  const child = spawnSync(process.execPath, [SCRIPT, '--root', T, '--template', A, '--slug', `${A},${S1}`], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal([read('stardust', 'encoded', 'trips', 'river-walk.html'), read('stardust', 'encoded', 'trips', 'forest-loop.html')].map(sha).join(','), first, 'a child process with another TZ/LANG: identical bytes');
  assert.equal(read('stardust', 'encoded', 'trips', 'river-walk.html'), arch, '… and equal to the first run');

  // --- hidden-live: a stamped capture skips marked nodes (recorded), keeps <details>; an unstamped one says so -------
  const stub = { resolveMedia: () => null, resolveDoc: () => null, localizeHref: (h) => ({ href: h, internal: false }), chromeFor: () => ({ nav: '/nav', footer: '/footer' }) };
  const hl = encodePage({ html: '<html data-hidden-live-stamp="1"><body><main><h1>Hi</h1><div data-hidden-live="collapsed"><p>Gone</p></div><details data-hidden-live="closed"><summary>More</summary><p>Kept</p></details></main></body></html>', page: { url: 'https://www.example.com/h' }, vocab: { root: 'main' }, site: stub });
  assert.equal(hl.report.hiddenLive, 'stamped'); assert.deepEqual(hl.report.hidden, [{ at: 'div', reason: 'collapsed' }]);
  assert.doesNotMatch(hl.html, /Gone/); assert.match(hl.html, /<h1>Hi<\/h1>\n<details><summary>More<\/summary><p>Kept<\/p><\/details>\n<\/div>/, 'a leading block is never wrapped in <p>');

  // --- blank-container drop inside blocks the walk keeps (li, blockquote); a blank span inside a line keeps its space ----
  const blank = encodePage({ html: '<main><h1>T</h1><ul><li>One<span> </span>two</li><li><div>&#160;</div>Three</li></ul><blockquote><p>Q</p><p>&nbsp;</p></blockquote></main>', page: { url: 'https://www.example.com/b' }, vocab: { root: 'main' }, site: stub });
  assert.match(blank.html, /<ul><li>One two<\/li><li>Three<\/li><\/ul>\n<blockquote><p>Q<\/p><\/blockquote>/);

  // --- the engine on its own: a site context is all it needs ---------------------------------------------------------
  const bare = encodePage({ html: '<main><h1>Hi</h1><p>One\n  two</p></main>', page: { url: 'https://www.example.com/a', title: 'A' }, vocab: { root: 'main' }, site: stub });
  assert.equal(bare.status, 'clean'); assert.match(bare.html, /<div>\n<h1>Hi<\/h1>\n<p>One two<\/p>\n<\/div>/);

  // --- --help in an empty dir: exit 0, usage on stdout, nothing written ------------------------------------------------
  const empty = mkdtempSync(join(tmpdir(), 'encode-help-'));
  const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
  assert.equal(h.status, 0); assert.match(h.stdout, /^Usage:/); assert.deepEqual(readdirSync(empty), [], '--help writes nothing');
  rmSync(empty, { recursive: true, force: true });
} finally {
  rmSync(T, { recursive: true, force: true });
}
console.log('encode: ok');
