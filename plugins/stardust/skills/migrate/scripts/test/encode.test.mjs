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
//   hard stops    unmapped · flattened · variance (fingerprint + census, one visibility rule; ignoreAncestors; accepts
//                 per direction) · incomplete (L5) · error —
//                 each exits 2 and writes nothing for the page; missing capture / invalid map → exit 1
//   patches       the skeleton's stardust/patches/<slug>.json ops on the rendered document (engine level): replace,
//                 attr, remove; a patch deleting counted content → incomplete; a no-match patch → recorded, no stop;
//                 the h1 check judges the patched document; variance never moves; sanitise stays last
//   writes        second run → zero writes (unchanged); --dry-run writes nothing; --lint on the fixture exits per its
//                 findings (the fixture map is lint-clean); --sweep from a CLI process settles
//   validation    unknown keys fail at every level ($comment allowed), every key the engine reads is type-checked,
//                 --lint's own keys pass through; the walk's traversal is exported and is the engine's own
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
import { encodePage, tidy, validateVocabulary, validateTransform, validatePatches, varianceDelta, prepareCapture, contentTops, markerMatches, moduleLevel, walkModules, GENERATED_TOKEN, LANDMARK_STOP, KEYS, COMMENT_KEY, LINT_KEYS, dropPredicate, rowGroups, rowNodes, PLAIN_CONTENT } from '../encode/engine.mjs';
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
function addPage(slug, html, record = {}) {
  writeFileSync(P('stardust', 'current', 'pages', `${slug}.html`), html);
  writeFileSync(P('stardust', 'current', 'pages', `${slug}.json`), JSON.stringify({ slug, url: `https://www.example.com/trips/${slug}.html`, title: slug, description: 'A sibling.', ...record }));
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

  // --- --lint dispatches to encode/lint.mjs (its checks are tested there): on the fixture it exits per its findings ----
  r = await run('--lint', '--template', A);
  const lintVerdict = /^lint trips-river-walk: (\d+) findings? · (\d+) notes?$/.exec(r.last);
  assert.ok(lintVerdict, `--lint prints its verdict last\n${r.out}\n${r.err}`);
  assert.equal(r.code, Number(lintVerdict[1]) ? 1 : 0, '--lint exits per its findings');
  assert.equal(Number(lintVerdict[1]), 0, `the fixture map is lint-clean\n${r.out}`);

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
  assert.deepEqual(rep0.dropped, [{ kind: 'newsletter', reason: 'runtime form, delivered by a dynamics row', visible: true }, { kind: '.ui-sr-only', reason: 'selector drop (transform)', visible: true, at: 'span.ui-sr-only' }], 'drop: recorded, and the visible text a transform drop removed');
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
  assert.deepEqual(validateVocabulary({ root: 'main', markers: [{ sel: '.known', kind: 'known' }, { sel: '.k2', emitter: null }] }), [], 'no emitter (absent or null) = a known kind not mapped yet');
  assert.match(validateVocabulary({ root: 'main', markers: [{ sel: '.x', emitter: 'none' }] })[0], /emitter "none": use block:/, 'there is no "none" emitter');

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
  const v = await stopCase('stop-variance', mutate('mod-teaser mod-teaser--featured', 'mod-teaser'), 'variance', /"change":"extra","print":"\.mod-teaser \| div\.mod-teaser \| mod-container>ui-container"/);
  assert.deepEqual(v.report.variance.map((x) => x.change), ['extra', 'missing'], 'a SET difference both ways');
  await stopCase('stop-census', mutate('<div class="mod-image"', '<div class="promo-strip"><p>Members ride free on Sundays.</p></div><div class="mod-image"'), 'variance', /UNMARKED \| div\.promo-strip \| mod-container>ui-container/);
  await stopCase('stop-incomplete', mutate('<h3 class="ui-teaser__title">River Walk</h3>', '<h3 class="ui-teaser__title">River Walk</h3><p class="ui-teaser__desc">Two hours along the water, café at the bridge.</p>'), 'incomplete', /"role":"text","key":"two hours along the water, caf/);
  await stopCase('stop-noroot', mutate('<main id="main" class="page-main">', '<div id="main-x">').replace('</main>', '</div>'), 'error', /root selector \\"main#main\\" matched nothing/);
  await stopCase('stop-noh1', mutate('<h1 class="ui-hero__title">Forest Loop</h1>', ''), 'error', /no <h1>/);
  // a showing <video> reached by rich text has no delivered form: unmapped, never a silent src-less element (R18)
  await stopCase('stop-video', mutate('<p>Benches and a view over three villages.</p>', '<p>Benches and a view over three villages.</p><video src="/media/lookout.mp4" poster="/media/lookout-poster.jpg" controls></video>'), 'unmapped', /"kind":"video","selector":"video","at":"video","remedy":"map it as a block \(e\.g\. an embed block with a link cell: as link, attr src\) or drop: it/);
  // … and so are a player wrapped in a container that holds nothing else, and an embedded frame (R22)
  await stopCase('stop-audio', mutate('<p>Benches and a view over three villages.</p>', '<p>Benches and a view over three villages.</p><div class="player"><audio controls src="/media/birdsong.mp3"></audio></div>'), 'unmapped', /"kind":"audio","selector":"audio","at":"audio"/);
  await stopCase('stop-iframe', mutate('<p>A steady climb on a wide forest road.</p>', '<p>A steady climb on a wide forest road.</p><iframe src="https://player.example.net/embed/42" width="560" height="315" title="The climb"></iframe>'), 'unmapped', /"kind":"iframe","selector":"iframe","at":"iframe"/);
  // an accepted print never stops a page
  writeFileSync(vocabFile, JSON.stringify({ ...vocab, variance: { accept: v.report.variance.map((x) => ({ print: x.print, on: x.change, reason: 'the teaser variant is an editorial choice' })) } }));
  r = await run('--template', A, '--slug', 'stop-variance');
  assert.equal(r.code, 0, `accepted prints → clean\n${r.out}`); assert.equal(r.last, 'encoded 1 · unchanged 0 · stopped 0');
  writeFileSync(vocabFile, vocabRaw);
  assert.deepEqual(varianceDelta(['a', 'b'], ['b', 'c'], [{ print: 'c', on: 'missing', reason: 'r' }]), [{ change: 'extra', print: 'a' }], 'varianceDelta: symmetric difference minus accepted');
  assert.deepEqual(varianceDelta(['a', 'b'], ['b', 'c'], [{ print: 'c', on: 'extra', reason: 'r' }, { print: 'a', on: 'missing', reason: 'r' }]), [{ change: 'extra', print: 'a' }, { change: 'missing', print: 'c' }], 'an accept covers one direction only: extra never hides missing');
  for (const [va, re] of [[{ accept: [{ print: 'p', reason: 'r' }] }, /on: "extra"\|"missing"/], [{ accept: [{ print: 'p', on: 'extra', reason: ' ' }] }, /non-empty reason/], [{ ignoreAncestors: [{ class: '(', reason: 'r' }] }, /ignoreAncestors\[0\]\.class/], [{ ignoreAncestors: [{ class: 'x' }] }, /non-empty reason/]]) {
    assert.match(validateVocabulary({ root: 'main', variance: va }).join(' '), re, JSON.stringify(va));
  }

  // --- a whole run with stopped pages exits 2 and still writes the clean ones; missing input exits 1 ----------------------
  rmSync(P('stardust', 'encoded'), { recursive: true });
  r = await run('--template', A);
  assert.equal(r.code, 2); assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 12', 'the archetype and the sibling written; twelve stops');
  assert.match(r.out, /✗ stop-incomplete incomplete\n {4}incomplete MISSING text "Two hours along the water/, 'per-page status line + findings');
  // drop:/dynamics: hold at any depth: inside a block, where no cell reaches them, they are left out and recorded
  const withMarkers = (extra, edit = (m) => m) => writeFileSync(vocabFile, JSON.stringify({ ...vocab, ...extra, markers: [{ sel: '.mod-promo', kind: 'promo', emitter: 'drop:members-only offer, not migrated' }, { sel: '.mod-live', kind: 'live', emitter: 'dynamics:DYN-2' }, ...vocab.markers.map(edit)] }));
  withMarkers({});
  addPage('nested-drops', mutate('<div class="ui-teaser__content">', '<div class="mod-promo"><p>Members save 10% this month.</p></div><div class="ui-teaser__content">').replace('<ol class="ui-tabs__list" role="tablist">', '<div class="mod-live"><p>Trail status: open</p></div><ol class="ui-tabs__list" role="tablist">'));
  r = await run('--template', A, '--slug', 'nested-drops', '--json', '--dry-run');
  const nd = pageOf(r)[0];
  assert.deepEqual(nd.report.incomplete, [], 'a drop:/dynamics: match no cell reaches is never missing content');
  assert.deepEqual(nd.report.dropped, [{ kind: 'newsletter', reason: 'runtime form, delivered by a dynamics row', visible: true }, { kind: 'promo', reason: 'members-only offer, not migrated', visible: true, nested: true, at: 'div.mod-promo' }], 'the nested drop: is recorded, in document order');
  assert.deepEqual(nd.report.deviations, [{ kind: 'dynamic-dependency', row: 'DYN-2', module: 'live', nested: true, at: 'div.mod-live' }, { kind: 'dynamic-dependency', row: 'DYN-1', module: 'chat' }], 'the nested dynamics: is recorded');
  assert.deepEqual(nd.report.variance.map((x) => x.print.split(' | ')[0]), ['.mod-live', '.mod-promo'], 'the new modules still move the print set');
  withMarkers({ variance: { accept: nd.report.variance.map((x) => ({ print: x.print, on: x.change, reason: 'a promo and a live widget, both declared' })) } });
  r = await run('--template', A, '--slug', 'nested-drops');
  assert.equal(r.code, 0, `accepted → clean\n${r.out}`);
  assert.doesNotMatch(read('stardust', 'encoded', 'trips', 'nested-drops.html'), /Members save|Trail status/, 'neither reaches the document');
  // a nested default-content marker keeps its own drop and retag inside a rich cell
  withMarkers({}, (m) => (m.sel === '.mod-text' ? { ...m, drop: ['.ui-text__note'], retag: { b: 'b' } } : m));
  addPage('nested-scope', mutate('<p>Benches and a view over three villages.</p>', '<p>Benches and a <b>view</b> over three villages<span class="ui-text__note"> (seasonal)</span>.</p>'));
  r = await run('--template', A, '--slug', 'nested-scope');
  assert.equal(r.code, 0, `nested scope encodes clean\n${r.out}`);
  assert.match(read('stardust', 'encoded', 'trips', 'nested-scope.html'), /<p>Benches and a <b>view<\/b> over three villages\.<\/p>/, 'the panel text component applies its own retag and drop');
  writeFileSync(vocabFile, vocabRaw);
  // relative URLs resolve against the URL the capture was taken at (finalUrl), never the requested one (R15)
  addPage('redirected', mutate('<img src="/media/forest-loop-hero.jpg"', '<img src="../media/forest-loop-hero.jpg"').replace('<a href="/trips/river-walk.html">River Walk</a>', '<a href="river-walk.html">River Walk</a>'), { url: 'https://www.example.com/go/to/forest.html', finalUrl: 'https://www.example.com/trips/forest-loop.html' });
  r = await run('--template', A, '--slug', 'redirected');
  assert.equal(r.code, 0, `redirected page encodes clean\n${r.out}`);
  const redirected = read('stardust', 'encoded', 'go', 'to', 'forest.html');
  assert.match(redirected, /<img src="https:\/\/content\.da\.live\/example-org\/example-site\/media\/trips\/forest-loop-hero-0c4d9e12\.jpg"/, 'a relative image resolves against finalUrl');
  assert.match(redirected, /<a href="\/trips\/river-walk">River Walk<\/a>/, 'a relative link resolves against finalUrl');

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
  // --sweep from a CLI process settles (encode/lint.mjs imports nothing back from encode.mjs's evaluation)
  const sweepCli = spawnSync(process.execPath, [SCRIPT, '--root', T, '--sweep', '--template', A], { encoding: 'utf8', timeout: 15000 });
  assert.ok([0, 1, 2].includes(sweepCli.status) && !/unsettled top-level await/.test(sweepCli.stderr), `--sweep dispatches from a CLI process and settles (${sweepCli.status})\n${sweepCli.stderr}`);

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

  // --- patches: the skeleton's ops on the rendered document, before the h1 check and the count; sanitise stays last ---
  const keysFor = (b) => ({ mediaKey: (u) => site.resolveMedia(u), linkKey: (u) => { const x = site.localizeHref(u, b); if (!x.internal || x.kind === 'doc') return null; const v = new URL(x.href, 'https://doc.invalid/'); return `${deps.pathKey(v.pathname)}${v.search}`; } });
  const encodeSlug = (slug, patches, archetypePrints = null) => {
    const b = site.baseUrlFor(slug);
    return encodePage({ html: read('stardust', 'current', 'pages', `${slug}.html`), page: { ...site.pageJson(slug), url: site.page(slug).url }, base: b, vocab: map.vocab, tf: map.tf, site, archetypePrints, inventory: deps.inventory, countKeys: keysFor(b), patches, finalise: deps.finalise });
  };
  const plain = encodeSlug(A, null);
  assert.equal(plain.html, arch, 'the engine called directly gives the CLI\'s bytes'); assert.deepEqual(plain.report.patchesApplied, []);
  const noMatch = encodeSlug(A, [{ selector: '.no-such-block', op: 'remove' }]);
  assert.equal(noMatch.status, 'clean', 'a patch that matches nothing stops nothing (the skeleton warned and went on)');
  assert.deepEqual(noMatch.report.patchesApplied, [{ selector: '.no-such-block', op: 'remove', matched: 0 }], '… and is recorded with matched 0');
  assert.equal(noMatch.html, arch, 'a patched render that changed nothing keeps every byte');
  const patched = encodeSlug(A, [{ selector: '.hero > div > div:last-child > p:first-child', op: 'replace', value: '  <strong> Day   trip </strong> ' }, { selector: '.teaser', op: 'attr', name: 'class', value: 'teaser featured wide' }]);
  assert.equal(patched.status, 'clean', JSON.stringify(patched.report.incomplete));
  assert.match(patched.html, /<p><strong>Day trip<\/strong><\/p>\n<h1>River Walk<\/h1>/, 'replace sets the inner HTML, normalised like the engine\'s own');
  assert.match(patched.html, /<div class="teaser featured wide">/, 'attr sets an attribute');
  assert.deepEqual(patched.report.patchesApplied.map((x) => [x.op, x.matched]), [['replace', 1], ['attr', 1]]);
  assert.ok(!/[^\x00-\x7f]/.test(patched.html) && sanitise(patched.html).output === patched.html, 'sanitise still runs last');
  const removed = encodeSlug(A, [{ selector: '.facts', op: 'remove' }]);
  assert.equal(removed.status, 'incomplete', 'a patch that deletes counted content is caught by the content count');
  assert.ok(removed.report.incomplete.some((m) => /^Distance/.test(m.text)), JSON.stringify(removed.report.incomplete));
  const noH1 = encodeSlug(A, [{ selector: 'h1', op: 'remove' }]);
  assert.equal(noH1.status, 'error'); assert.match(noH1.report.errors.join(' '), /no <h1>/, 'the h1 check judges the patched document');
  const badPatch = encodeSlug(A, [{ selector: '.teaser', op: 'rename' }]);
  assert.equal(badPatch.status, 'error'); assert.match(badPatch.report.errors[0], /op "rename": use replace\|attr\|remove/); assert.equal(badPatch.html, null, 'an invalid patch file renders nothing');
  for (const notArray of [{}, 3, 'x']) assert.equal(encodeSlug(A, notArray).status, 'error', `a patch file holding ${JSON.stringify(notArray)} is an error, never ignored`);
  assert.equal(encodeSlug(A, []).html, arch, '[] means no patches');
  const sibPatched = encodeSlug(S1, [{ selector: '.teaser', op: 'remove' }], plain.prints);
  assert.deepEqual(sibPatched.report.variance, [], 'variance is decided on the capture: patches never move it');
  assert.deepEqual(sibPatched.prints, encodeSlug(S1, null, plain.prints).prints);
  assert.equal(sibPatched.status, 'incomplete', '… while the count still sees the removed teaser');

  // --- hidden-live: a stamped capture skips marked nodes (recorded), keeps <details>; an unstamped one says so -------
  const stub = { resolveMedia: () => null, resolveDoc: () => null, localizeHref: (h) => ({ href: h, internal: false }), chromeFor: () => ({ nav: '/nav', footer: '/footer' }) };
  const hl = encodePage({ html: '<html data-hidden-live-stamp="1"><body><main><h1>Hi</h1><div data-hidden-live="collapsed"><p>Gone</p></div><details data-hidden-live="closed"><summary>More</summary><p>Kept</p></details></main></body></html>', page: { url: 'https://www.example.com/h' }, vocab: { root: 'main' }, site: stub });
  assert.equal(hl.report.hiddenLive, 'stamped'); assert.deepEqual(hl.report.hidden, [{ at: 'div', reason: 'collapsed' }]);
  assert.doesNotMatch(hl.html, /Gone/); assert.match(hl.html, /<h1>Hi<\/h1>\n<details><summary>More<\/summary><p>Kept<\/p><\/details>\n<\/div>/, 'a leading block is never wrapped in <p>');

  // --- blank-container drop inside blocks the walk keeps (li, blockquote); a blank span inside a line keeps its space ----
  const blank = encodePage({ html: '<main><h1>T</h1><ul><li>One<span> </span>two</li><li><div>&#160;</div>Three</li></ul><blockquote><p>Q</p><p>&nbsp;</p></blockquote></main>', page: { url: 'https://www.example.com/b' }, vocab: { root: 'main' }, site: stub });
  assert.match(blank.html, /<ul><li>One two<\/li><li>Three<\/li><\/ul>\n<blockquote><p>Q<\/p><\/blockquote>/);

  // --- embedded players: a showing one reached by rich text stops (unmapped); a non-showing one is stripped ----------
  const one = (html, v = { root: 'main' }) => encodePage({ html: `<main><h1>T</h1>${html}</main>`, page: { url: 'https://www.example.com/p' }, vocab: v, site: stub });
  for (const [html, kind] of [['<p><audio controls src="/a.mp3"></audio></p>', 'audio'], ['<div class="player"><audio controls src="/a.mp3"></audio></div>', 'audio'], ['<p>See <object data="/m.swf" width="300" height="200"></object></p>', 'object'], ['<embed src="/m.swf" width="300" height="200">', 'embed'], ['<iframe src="https://player.example.net/embed/1"></iframe>', 'iframe']]) {
    const x = one(html);
    assert.equal(x.status, 'unmapped', `${html} → unmapped`); assert.equal(x.report.unmapped[0].kind, kind);
  }
  assert.ok(one('<div class="player"><audio controls src="/a.mp3"></audio></div>').prints.includes('UNMARKED | div.player | '), 'a container holding only a player is visible to the census');
  for (const html of ['<iframe hidden src="https://t.example.net/p"></iframe>', '<iframe width="0" height="0" src="https://t.example.net/p"></iframe>', '<iframe style="display: none" src="https://t.example.net/p"></iframe>', '<p><audio src="/a.mp3"></audio></p>', '<embed style="visibility:hidden" src="/x">', '<video hidden src="/v.mp4"></video>']) {
    const x = one(html);
    assert.equal(x.status, 'clean', `${html} is not shown → stripped`); assert.doesNotMatch(x.html, /iframe|audio|embed|video|<p><\/p>/);
  }
  // the remedy is expressible: an embed block whose link cell takes its URL from the frame's src
  const embed = one('<div class="mod-video"><iframe src="https://player.example.net/embed/42" title="The climb"></iframe></div>', { root: 'main', markers: [{ sel: '.mod-video', kind: 'video', emitter: 'block:embed', cells: [{ sel: 'iframe', as: 'link', attr: 'src' }] }] });
  assert.equal(embed.status, 'clean'); assert.match(embed.html, /<div class="embed">\n<div><div><a href="https:\/\/player\.example\.net\/embed\/42">https:\/\/player\.example\.net\/embed\/42<\/a><\/div><\/div>\n<\/div>/);

  // --- a default-content marker that IS a cell's own node keeps its own retag/drop too ------------------------------
  const rootScope = one('<div class="blk"><div class="mod-text"><p>A <b>bold</b> word<span class="note"> (aside)</span>.</p></div></div>', { root: 'main', markers: [{ sel: '.blk', kind: 'blk', emitter: 'block:blk', cells: [{ sel: '.mod-text', as: 'rich' }] }, { sel: '.mod-text', kind: 'text', emitter: 'default-content', drop: ['.note'], retag: { b: 'b' } }] });
  assert.equal(rootScope.status, 'clean'); assert.match(rootScope.html, /<div class="blk">\n<div><div><p>A <b>bold<\/b> word\.<\/p><\/div><\/div>/);

  // --- the fingerprint: one visibility rule, ancestors ignored per class ---------------------------------------------
  const pair = (archHtml, sibHtml, v) => { const a = one(archHtml, v); return [a, encodePage({ html: `<main><h1>T</h1>${sibHtml}</main>`, page: { url: 'https://www.example.com/s' }, vocab: v, site: stub, archetypePrints: a.prints })]; };
  const cardMap = { root: 'main', wrappers: ['.page'], markers: [{ sel: 'div.mod-card', kind: 'card', emitter: 'block:card' }, { sel: 'div.mod-download', kind: 'download', emitter: 'wrapper' }, { sel: 'div.mod-sep', kind: 'separator', emitter: 'section-break:rule' }] };
  let [, sibR] = pair('<div class="page"><div class="mod-card"><p>Card text</p></div></div>', '<div class="page"><div class="mod-card"><p>Card text</p></div><div class="mod-download">  </div></div>', cardMap);
  assert.equal(sibR.status, 'clean', 'an empty marked placeholder adds no print, as an empty unmarked node adds no census entry'); assert.deepEqual(sibR.report.variance, []);
  [, sibR] = pair('<div class="page"><div class="mod-card"><p>Card text</p></div><div class="mod-sep"><hr></div><p>After</p></div>', '<div class="page"><div class="mod-card"><p>Card text</p></div><p>After</p></div>', cardMap);
  assert.deepEqual(sibR.report.variance, [{ change: 'missing', print: 'div.mod-sep | div.mod-sep | page' }], 'a section-break emits structure on its own: it keeps its print');
  const gridMap = (extra) => ({ root: 'main', wrappers: ['.grid', '.col', '.box'], markers: [{ sel: 'div.mod-card', kind: 'card', emitter: 'block:card' }], ...extra });
  const gridArch = '<div class="box"><div class="grid grid--12"><div class="col col--6 box-inner"><div class="mod-card"><p>A</p></div></div></div></div>';
  const gridSib = '<div class="box"><div class="mod-card"><p>A</p></div></div>';
  [, sibR] = pair(gridArch, gridSib, gridMap({}));
  assert.deepEqual(sibR.report.variance.map((x) => x.change), ['extra', 'missing'], 'a missing layout layer moves the chain');
  [, sibR] = pair(gridArch, gridSib, gridMap({ variance: { ignoreAncestors: [{ class: '^(grid|col)(--|$)', reason: 'the layout grid is not structure' }] } }));
  assert.deepEqual(sibR.report.variance, [{ change: 'extra', print: 'div.mod-card | div.mod-card | box' }, { change: 'missing', print: 'div.mod-card | div.mod-card | box>box-inner' }], 'an ancestor keeping another class stays in the chain under it');
  [, sibR] = pair(gridArch.replace(' box-inner', ''), gridSib, gridMap({ variance: { ignoreAncestors: [{ class: '^(grid|col)(--|$)', reason: 'the layout grid is not structure' }] } }));
  assert.equal(sibR.status, 'clean', 'one ignoreAncestors entry accepts the whole chain-level class, archetype and sibling alike');

  // an empty match that still changes the document keeps its print: section flags, an attr cell
  const sectMap = { root: 'main', markers: [{ sel: '.mod-div', kind: 'div', emitter: 'wrapper', sectionBefore: true }] };
  const [sectArch, sectSib] = pair('<p>A</p><div class="mod-div"></div><p>B</p>', '<p>A</p><p>B</p>', sectMap);
  assert.equal(sectArch.sections, 2, 'the empty marker opens a section');
  assert.deepEqual(sectSib.report.variance, [{ change: 'missing', print: '.mod-div | div.mod-div | ' }], 'so the sibling without it is variance, not clean');
  const embedMap = { root: 'main', markers: [{ sel: '.mod-embed', kind: 'embed', emitter: 'block:embed', cells: [{ as: 'attr', attr: 'data-video-id' }] }] };
  const [embedArch, embedSib] = pair('<p>A</p><div class="mod-embed" data-video-id="v-42"></div>', '<p>A</p>', embedMap);
  assert.match(embedArch.html, /<div class="embed">\n<div><div>v-42<\/div><\/div>/, 'an empty placeholder emits through its attr cell');
  assert.deepEqual(embedSib.report.variance, [{ change: 'missing', print: '.mod-embed | div.mod-embed | ' }]);

  // a text-less rule that styles and closes the section before it keeps its print (sample-run defect 3)
  const rulePage = (rule) => `<div class="page"><div class="mod-text"><p>First part</p></div>${rule ? '<div class="mod-rule"><hr></div>' : ''}<div class="mod-text"><p>Second part</p></div></div>`;
  const ruleMap = { root: 'main', wrappers: ['.page'], moduleSelectors: [{ class: '^mod-[a-z]+$' }], markers: [{ sel: 'div.mod-rule', emitter: 'drop:visual rule', sectionStyle: 'intro', sectionAfter: true }, { sel: 'div.mod-text', emitter: 'default-content' }] };
  const [ruleArch, ruleSib] = pair(rulePage(true), rulePage(false), ruleMap);
  assert.match(ruleArch.html, /<div><div>style<\/div><div>intro<\/div><\/div>/, 'the rule styles a section');
  assert.equal(ruleSib.status, 'variance'); assert.deepEqual(ruleSib.report.variance, [{ change: 'missing', print: 'div.mod-rule | div.mod-rule | page' }]);

  // --- a marker's drop holds through wrapper and section recursion: document, audit and count agree ------------------
  const nested = '<p>Keep</p><p class="note">Gone</p><div class="inner"><p>Deep keep</p><p class="note">Deep gone</p></div>';
  for (const [emitter, label] of [['wrapper', 'wrapper'], ['section-style:dark', 'section-style']]) {
    const x = one(`<div class="wrap">${nested}</div>`, { root: 'main', markers: [{ sel: '.wrap', kind: 'wrap', emitter, drop: ['.note'] }] });
    assert.equal(x.status, 'clean'); assert.match(x.html, /Keep[\s\S]*Deep keep/); assert.doesNotMatch(x.html, /Gone|Deep gone/, `${label}: the drop applies at every depth`);
    assert.ok(!x.prints.some((pr) => pr.includes('p.note')), `${label}: a dropped node is no shape either (the walk skips it)`);
    assert.deepEqual(x.report.dropped.map((d) => [d.kind, d.reason, d.at]), [['.note', 'selector drop (marker .wrap)', 'p.note'], ['.note', 'selector drop (marker .wrap)', 'p.note']], `${label}: and the audit says so`);
  }

  // --- selector drops that remove visible content are recorded (marker, transform, cell); invisible ones need not be ---
  const fileDoc = '<div class="mod-file"><p class="label">Visible label text</p><p class="label"> </p><p class="value">Visible value text</p></div>';
  const fileMap = (marker, extra = {}) => ({ root: 'main', markers: [{ sel: '.mod-file', kind: 'file', emitter: 'block:file', cells: [{ sel: '.value', as: 'text' }], ...marker }], ...extra });
  const dropsOf = (v, tf = {}) => { const x = encodePage({ html: `<main><h1>T</h1>${fileDoc}</main>`, page: { url: 'https://www.example.com/f' }, vocab: v, tf, site: stub }); assert.equal(x.status, 'clean'); assert.doesNotMatch(x.html, /label/); return x.report.dropped; };
  assert.deepEqual(dropsOf(fileMap({ drop: ['.label'] })), [{ kind: '.label', reason: 'selector drop (marker .mod-file)', visible: true, at: 'p.label' }], 'a marker drop');
  assert.deepEqual(dropsOf(fileMap({}), { drop: ['.label'] }), [{ kind: '.label', reason: 'selector drop (transform)', visible: true, at: 'p.label' }], 'a transform drop');
  assert.deepEqual(dropsOf(fileMap({ cells: [{ as: 'rich', drop: ['.label'] }] })), [{ kind: '.label', reason: 'selector drop (cell)', visible: true, at: 'p.label' }], 'a cell drop');
  assert.deepEqual(dropsOf(fileMap({ drop: ['.label', 'p.label'] }), { drop: ['.label'] }), [{ kind: '.label', reason: 'selector drop (transform)', visible: true, at: 'p.label' }], 'one entry per node, whoever claims it first');

  // --- R29: unknown keys fail at every level; `$comment` is free text everywhere; every key the engine reads is typed ---
  const base = { root: 'main', markers: [{ sel: '.a', emitter: 'block:a' }] };
  const mk = (x) => ({ ...base, markers: [{ sel: '.a', emitter: 'block:a', ...x }] });
  const cell = (x) => mk({ cells: [x] });
  for (const [v, re] of [
    [{ ...base, markerz: [] }, /^markerz: unknown key/], [mk({ varaints: [] }), /markers\[0\]\.varaints: unknown key/],
    [mk({ variants: [{ whn: '.x', when: '.x', add: 'x' }] }), /variants\[0\]\.whn: unknown key/], [mk({ rows: [{ selector: '.r' }] }), /rows\[0\]\.selector: unknown key/],
    [cell({ wrapp: 'p' }), /cells\[0\]\.wrapp: unknown key/], [mk({ cells: { each: '.x', ass: 'text' } }), /cells\.ass: unknown key/],
    [cell({ parts: [{ sell: '.x' }] }), /parts\[0\]\.sell: unknown key/], [{ ...base, variance: { acept: [] } }, /variance\.acept: unknown key/],
    [{ ...base, variance: { accept: [{ print: 'p', on: 'extra', reason: 'r', onn: 'x' }] } }, /accept\[0\]\.onn: unknown key/],
    [{ ...base, variance: { ignoreAncestors: [{ class: 'g', reason: 'r', klass: 'g' }] } }, /ignoreAncestors\[0\]\.klass: unknown key/],
    [{ ...base, moduleSelectors: [{ childClass: '^a', class: '^b' }] }, /moduleSelectors\[0\]: .*one key/],
    [{ ...base, walkSiblings: 'yes' }, /^walkSiblings: true\|false/], [{ ...base, requireH1: 0 }, /^requireH1: true\|false/],
    [mk({ kind: 7 }), /kind: a string/], [mk({ sectionBefore: 'yes' }), /sectionBefore: true\|false/], [mk({ sectionAfter: 1 }), /sectionAfter: true\|false/],
    [mk({ merge: 'no' }), /merge: true\|false/], [mk({ retag: { b: 'Strong!' } }), /retag: an object tag → tag name/], [mk({ rows: [{ sel: '.r', optional: 'yes' }] }), /rows\[0\]\.optional: true\|false/],
    [cell({ all: 'yes' }), /cells\[0\]\.all: true\|false/], [cell({ selfOk: 1 }), /cells\[0\]\.selfOk: true\|false/], [cell({ $comment: 3 }), /\$comment: free text/],
    [mk({ emitter: ['wrapper'] }), /markers\[0\]\.emitter \["wrapper"\] is not a string/], [mk({ emitter: 7 }), /markers\[0\]\.emitter 7 is not a string/], [mk({ emitter: { block: 'a' } }), /markers\[0\]\.emitter \{"block":"a"\} is not a string/],
  ]) assert.match(validateVocabulary(v).join('\n'), re, JSON.stringify(v));
  const commented = { $comment: 'the trip template', ...base, markers: [{ $comment: 'one block', sel: '.a', emitter: 'block:a', variants: [{ $comment: 'c', when: '.x', add: 'x' }], rows: [{ $comment: 'c', sel: '.r', cells: [{ $comment: 'c', parts: [{ $comment: 'c', sel: '.p' }] }] }] }, { sel: '.b', emitter: 'block:b', cells: { $comment: 'c', each: '.c' } }], moduleSelectors: [{ $comment: 'c', childClass: '^x-' }], variance: { $comment: 'c', accept: [{ $comment: 'c', print: 'p', on: 'missing', reason: 'r' }], ignoreAncestors: [{ $comment: 'c', class: 'g', reason: 'r' }] } };
  assert.deepEqual(validateVocabulary(commented), [], '$comment is accepted on every object');
  // what passes validation never crashes the walk: an array emitter used to coerce to "wrapper" and throw at startsWith
  const arrayEmitter = { root: 'main', markers: [{ sel: '.w', emitter: ['wrapper'] }] };
  assert.ok(validateVocabulary(arrayEmitter).length, 'rejected before any page is encoded');
  assert.deepEqual(validateVocabulary({ ...base, $schema: 7, archetype: 7, inputs: 7, markers: [{ sel: '.a', emitter: 'block:a', evidence: 7, unique: 'yes' }] }), [], '--lint\'s own keys pass through unread');
  assert.match(validateTransform({ dorp: ['.x'] }).join(), /^dorp: unknown key/); assert.deepEqual(validateTransform({ $comment: 'c', drop: ['.x'] }), []);
  assert.match(validatePatches([{ selector: 'h1', op: 'replace', vaule: 'x' }]).join(), /\[0\]\.vaule: unknown key/);
  assert.deepEqual(validateVocabulary(JSON.parse(vocabRaw)), [], 'the fixture map stays valid');

  // --- the walk's traversal is exported (what --lint enumerates is what the encoder walks) -----------------------------
  const prep = prepareCapture(read('stardust', 'current', 'pages', `${A}.html`), vocab);
  assert.deepEqual(contentTops(prep, vocab), [prep.rootEl]);
  assert.deepEqual(moduleLevel(prep, vocab).map((x) => x.marker && x.marker.kind), ['hero', 'text', 'facts', 'tags', 'separator', 'title', 'tabs', 'image', 'newsletter', 'chat', 'highlight-container', 'title', 'text', 'links', 'teaser'], 'module-level nodes in walk order, through wrappers and the section-style container');
  assert.equal(markerMatches(prep, vocab).filter((x) => x.marker.kind === 'text').length, 4, 'every first-marker match at any depth (the two text components inside the tab panels too)');
  const seen = []; walkModules(prep, vocab, { marker: (n, m) => seen.push(m.kind) });
  assert.deepEqual(seen, ['hero', 'text', 'facts', 'tags', 'separator', 'title', 'tabs', 'image', 'newsletter', 'chat', 'highlight-container'], 'a marker hook that does not descend stops the recursion there');
  assert.ok(GENERATED_TOKEN.test('container-4f1c2a9e7b') && !GENERATED_TOKEN.test('ui-teaser')); assert.match(LANDMARK_STOP, /footer/);

  // --- KEYS is exactly what the validators enforce, per object kind ($comment on all, in none) -------------------------
  const at = { // place an object with the given extra keys at each kind's level
    vocabulary: (x) => validateVocabulary({ ...base, ...x }), marker: (x) => validateVocabulary(mk(x)),
    variant: (x) => validateVocabulary(mk({ variants: [{ when: '.x', add: 'x', ...x }] })), rowGroup: (x) => validateVocabulary(mk({ rows: [{ sel: '.r', ...x }] })),
    cellSpec: (x) => validateVocabulary(cell(x)), cellsEach: (x) => validateVocabulary(mk({ cells: { each: '.x', ...x } })),
    variance: (x) => validateVocabulary({ ...base, variance: { ...x } }), accept: (x) => validateVocabulary({ ...base, variance: { accept: [{ print: 'p', on: 'extra', reason: 'r', ...x }] } }),
    ignoreAncestors: (x) => validateVocabulary({ ...base, variance: { ignoreAncestors: [{ class: 'g', reason: 'r', ...x }] } }),
    childClass: (x) => validateVocabulary({ ...base, moduleSelectors: [{ childClass: '^a', ...x }] }), class: (x) => validateVocabulary({ ...base, moduleSelectors: [{ class: '^a', ...x }] }),
    transform: (x) => validateTransform({ ...x }), patch: (x) => validatePatches([{ selector: 'h1', op: 'remove', ...x }]),
  };
  assert.deepEqual(Object.keys(at).sort(), Object.keys(KEYS).sort(), 'one probe per kind');
  for (const [kind, probe] of Object.entries(at)) {
    assert.ok(Object.isFrozen(KEYS) && Object.isFrozen(KEYS[kind]), `KEYS.${kind} is frozen`);
    const every = Object.fromEntries(KEYS[kind].map((k) => [k, undefined]));
    assert.ok(!probe(every).some((e) => /unknown key/.test(e)), `${kind}: every key KEYS lists is accepted`);
    assert.ok(!probe({ [COMMENT_KEY]: 'a note' }).some((e) => /unknown key|\$comment/.test(e)), `${kind}: ${COMMENT_KEY} is accepted`);
    assert.ok(probe({ zzz: 1 }).some((e) => /zzz/.test(e)), `${kind}: a key KEYS does not list is rejected`);
  }
  for (const [kind, keys] of Object.entries(LINT_KEYS)) for (const k of keys) assert.ok(KEYS[kind].includes(k) && !at[kind]({ [k]: { any: 'value' } }).some((e) => e.includes(k)), `${kind}.${k}: --lint's key, accepted unread`);

  // --- PLAIN_CONTENT is the census rule: a class-less plain-content node is no shape; a classed one, or another tag, is --
  const census = (html) => one(html).prints.filter((x) => x.startsWith('UNMARKED'));
  assert.ok(PLAIN_CONTENT.has('blockquote') && !PLAIN_CONTENT.has('aside'));
  assert.deepEqual(census('<blockquote>q</blockquote><aside>a</aside><blockquote class="pull">q2</blockquote>'), ['UNMARKED | aside. | ', 'UNMARKED | blockquote.pull | ']);
  for (const tag of ['p', 'ul', 'span', 'a', 'pre', 'table']) assert.ok(PLAIN_CONTENT.has(tag) && census(`<${tag}>x</${tag}>`).length === 0, `${tag}: plain content`);

  // --- dropPredicate: the walk's skip — marker drops (whole subtree) and transform drops; .within adds drop:/dynamics: ---
  const dropHtml = '<main><h1>T</h1><div class="wrap"><div class="promo-strip"><p>Promo</p></div><div class="keep-strip"><p>Keep</p></div><div class="tf-strip"><p>TF</p></div><div class="mod-ad"><p>Ad <span class="x">y</span></p></div></div></main>';
  const dropMap = { root: 'main', markers: [{ sel: '.wrap', kind: 'wrap', emitter: 'wrapper', drop: ['.promo-strip'] }, { sel: '.mod-ad', kind: 'ad', emitter: 'drop:an ad slot' }] };
  const dropTf = { drop: ['.tf-strip'] };
  const dprep = prepareCapture(dropHtml, dropMap); const dq = (sel) => dprep.doc && qsa(dprep.doc, sel)[0];
  const skip = dropPredicate(dprep, dropMap, dropTf);
  assert.deepEqual(['.promo-strip', '.tf-strip', '.keep-strip', '.mod-ad'].map((x) => skip(dq(x))), [true, true, false, false], 'skip: marker and transform selector drops, not a drop: match (the walk visits it)');
  assert.deepEqual(['.promo-strip p', '.mod-ad .x', '.keep-strip p'].map((x) => skip.within(dq(x))), [true, true, false], 'within: inside a selector drop or a drop: match');
  const kindsOf = (opts) => moduleLevel(dprep, dropMap, opts).map((x) => (x.marker ? x.marker.kind : String(x.node.attrs.class || x.node.tag).split(/\s+/)[0]));
  assert.deepEqual(kindsOf({ skip }), ['h1', 'wrap', 'keep-strip', 'ad'], 'moduleLevel with the skip walks what the encoder walks');
  assert.deepEqual(kindsOf({}), ['h1', 'wrap', 'promo-strip', 'keep-strip', 'tf-strip', 'ad'], '… and without it the dropped nodes come back');
  const dropEnc = encodePage({ html: dropHtml, page: { url: 'https://www.example.com/d' }, vocab: dropMap, tf: dropTf, site: stub });
  assert.deepEqual(dropEnc.prints.filter((x) => x.startsWith('UNMARKED')), ['UNMARKED | div.keep-strip | wrap'], 'the encoder\'s census sees the same unmarked modules');

  // --- rowGroups / rowNodes: the encoder's row selection — groups, the drop filter, max ---------------------------------
  const listHtml = '<main><h1>T</h1><div class="list"><p class="head">Heading</p><div class="item">i1</div><div class="item ad">ad</div><div class="item">i2</div><div class="item">i3</div><div class="item">i4</div></div></main>';
  const listMap = { root: 'main', markers: [{ sel: '.list', kind: 'list', emitter: 'block:list', drop: ['.item.ad'], rows: [{ sel: '.head', cells: [{ as: 'text' }] }, { sel: '.item', max: 3, cells: [{ as: 'text' }] }] }] };
  const lprep = prepareCapture(listHtml, listMap); const listMod = qsa(lprep.doc, '.list')[0]; const listSkip = dropPredicate(lprep, listMap, {});
  const lg = rowGroups(listMod, listMap.markers[0], listSkip.within);
  assert.deepEqual(lg.map((g) => [g.index, g.group.sel, g.nodes.map(textOf)]), [[0, '.head', ['Heading']], [1, '.item', ['i1', 'i2', 'i3']]], 'per group: the matches minus dropped nodes, then max');
  assert.deepEqual(rowNodes(listMod, listMap.markers[0]).map(textOf), ['Heading', 'i1', 'ad', 'i2'], 'without a drop filter the ad is a row (max counts it)');
  const listEnc = encodePage({ html: listHtml, page: { url: 'https://www.example.com/l' }, vocab: listMap, site: stub });
  assert.deepEqual(qsa(docOf(listEnc.html), '.list > div').map(textOf), rowNodes(listMod, listMap.markers[0], listSkip.within).map(textOf), 'the encoder emits exactly those rows');
  assert.deepEqual(rowGroups(listMod, { rows: '.item', cells: [{ as: 'text' }] }).map((g) => [g.group.cells.length, g.nodes.length]), [[1, 5]], 'rows as a selector: one group carrying the marker\'s cells');
  assert.deepEqual(rowNodes(listMod, { cells: [{}] }), [listMod], 'no rows: the module is its one row');

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
