#!/usr/bin/env node
// skills/extract/scripts/test/crawl.test.mjs — the crawl.mjs pure helpers, on fixture HTML and without a
// browser or network: locale-root detection by path shape, the first-level capture-gap listing per root
// (same-origin links on the root page under its own path, minus what the crawl captured; query, hash and
// trailing slash folded; assets, mailto:/tel: and other hosts dropped; www. folded), the ready ledger
// detail string, both link-list shapes, the entry-locale scope (the entry URL's leading two-letter locale
// segments — a second one only when locale-codes.json knows its head — and whether fewer than half of the
// captured pages lie under them), the locale table itself — and that importing the module or asking --help
// starts no crawl and writes nothing. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capDiscovered, captureGaps, discoveryLog, entryLocalePrefix, localeCodes, localeRootPath, maxPages } from '../crawl.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'crawl.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// The fixture's links the way the browser hands them to capture(): every a[href], resolved against the page.
const hrefs = (html, base) => [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1], base).href; } catch { return null; } }).filter(Boolean);

const ROOT_HTML = `<!doctype html><html lang="en-CA"><body>
<nav>
  <a href="/ca/en/">Home</a>
  <a href="/ca/en/about">About us</a>
  <a href="https://www.example.com/ca/en/products/">Products</a>
  <a href="/ca/en/products/widget?ref=nav">Widget</a>
  <a href="/ca/en/news#latest">News</a>
  <a href="/ca/en/news/">News (again)</a>
  <a href="/ca/fr/">Français</a>
  <a href="/">Global</a>
  <a href="/ca/en/brochure.pdf">Brochure</a>
  <a href="/ca/en/hero.jpg">Image</a>
  <a href="mailto:hello@example.com">Mail</a>
  <a href="tel:+15550100">Call</a>
  <a href="https://other.example.org/ca/en/x">Partner</a>
  <a href="#top">Top</a>
</nav></body></html>`;

check('localeRootPath: one or two segments of locale codes are roots (trailing slash, query, hash ignored; case kept); anything else is not', () => {
  for (const [u, want] of [
    ['https://x.example/en', '/en'], ['https://x.example/en/', '/en'], ['https://x.example/fr-ca', '/fr-ca'], ['https://x.example/de_DE/', '/de_DE'],
    ['https://x.example/ca/en', '/ca/en'], ['https://x.example/ca/en/?q=1#x', '/ca/en'], ['https://x.example/zh-hant', '/zh-hant'], ['https://x.example/it', '/it'],
    ['https://x.example/', null], ['https://x.example/about', null], ['https://x.example/ca/en/about', null], ['https://x.example/en/products', null],
    ['https://x.example/pricing', null], ['https://x.example/en-us-west', null], ['not a url', null], [undefined, null],
  ]) assert.equal(localeRootPath(u), want, String(u));
});
check('captureGaps: first-level targets under a captured locale root minus the captured ones — query/hash/slash and www. folded; assets, mailto:, tel:, other hosts, other subtrees and the root itself dropped; a root whose targets are all captured lists 0; the ledger detail is ready', () => {
  const records = [
    { slug: 'index', url: 'https://example.com/', finalUrl: 'https://example.com/', links: ['https://example.com/ca/en/', 'https://example.com/about'] },
    { slug: 'ca-en', url: 'https://example.com/ca/en', finalUrl: 'https://example.com/ca/en/', links: hrefs(ROOT_HTML, 'https://example.com/ca/en/') },
    { slug: 'ca-en-about', url: 'https://example.com/ca/en/about', finalUrl: 'https://example.com/ca/en/about', links: [] },
    { slug: 'fr-fr', url: 'https://example.com/fr/fr/', finalUrl: 'https://example.com/fr/fr/', links: { internal: ['/fr/fr/a-propos', 'https://example.com/fr/fr/produits/'], external: ['https://other.example.org/'] } },
    { slug: 'fr-fr-a-propos', url: 'https://example.com/fr/fr/a-propos/', finalUrl: 'https://example.com/fr/fr/a-propos/', links: [] },
    { slug: 'fr-fr-produits', url: 'https://example.com/fr/fr/produits', finalUrl: 'https://www.example.com/fr/fr/produits/', links: [] },
  ];
  const { roots, detail } = captureGaps(records);
  assert.deepEqual(roots, [
    { root: '/ca/en', slug: 'ca-en', linked: 4, uncaptured: ['/ca/en/news', '/ca/en/products', '/ca/en/products/widget'] },
    { root: '/fr/fr', slug: 'fr-fr', linked: 2, uncaptured: [] },
  ]);
  assert.equal(detail, 'uncaptured first-level targets: ca/en 3, fr/fr 0');
});
check('captureGaps: no locale root captured → no roots and a detail that says so; a root page without links lists 0 of 0; records without links or with an unparsable url survive', () => {
  assert.deepEqual(captureGaps([{ slug: 'index', url: 'https://example.com/', links: ['https://example.com/en/x'] }, { slug: 'about', url: 'https://example.com/about' }]), { roots: [], detail: 'uncaptured first-level targets: none (no locale root captured)' });
  assert.deepEqual(captureGaps([{ slug: 'en', url: 'https://example.com/en' }, { slug: 'junk', url: 'nope' }]).roots, [{ root: '/en', slug: 'en', linked: 0, uncaptured: [] }]);
  assert.deepEqual(captureGaps([]).roots, []);
});

const page = (p, extra = {}) => ({ slug: p.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'index', url: `https://example.test${p}`, finalUrl: `https://example.test${p}`, links: [], ...extra });
// a recorded hands-off run: entered at /de/, its site plan captured nine English pages
const DE_ENTRY_EN_PLAN = [page('/de/'), ...['/en/', '/en/about', '/en/products', '/en/products/a', '/en/products/b', '/en/news', '/en/contact', '/en/careers', '/en/legal'].map((p) => page(p))];

check('entryLocalePrefix: the leading two-letter locale segments, at most two (case kept; trailing slash, query, hash ignored); three-letter, non-locale or no segments → null', () => {
  for (const [u, want] of [
    ['https://x.example/de/produkte', '/de'], ['https://x.example/ca/en/x', '/ca/en'], ['https://x.example/fr-ca/', '/fr-ca'], ['https://x.example/de', '/de'],
    ['https://x.example/DE_de/x?q=1#y', '/DE_de'], ['https://x.example/zh-hant/a', '/zh-hant'], ['https://x.example/en/de/fr/x', '/en/de'], ['https://x.example/de/faq', '/de'],
    ['https://x.example/faq/x', null], ['https://x.example/', null], ['https://x.example', null], ['https://x.example/eng/x', null], ['https://x.example/products/de', null],
    ['https://x.example/en-us-west/x', null], ['not a url', null], [undefined, null],
  ]) assert.equal(entryLocalePrefix(u), want, String(u));
});
check('captureGaps scope: a /de/ entry whose capture holds 9 of 10 pages under /en → scope { entryLocale, inside, outside } and the detail names it; roots unchanged', () => {
  const plain = captureGaps(DE_ENTRY_EN_PLAN);
  const scoped = captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://www.example.test/de/' });
  assert.deepEqual(scoped.scope, { entryLocale: '/de', inside: 1, outside: 9 });
  assert.equal(scoped.detail, `${plain.detail}; entry locale /de but 9 of 10 captured pages outside it`);
  assert.equal(scoped.detail, 'uncaptured first-level targets: de 0, en 0; entry locale /de but 9 of 10 captured pages outside it');
  assert.deepEqual(scoped.roots, plain.roots);
});
check('captureGaps scope: half or more of the captured pages under the entry locale → no scope key, detail unchanged', () => {
  const majority = [page('/de/'), page('/de/produkte'), page('/de/ueber-uns'), page('/de/kontakt/'), page('/en/'), page('/en/about')];
  const half = [page('/de/'), page('/de/produkte'), page('/en/'), page('/en/about')];
  for (const records of [majority, half]) {
    const r = captureGaps(records, { entryUrl: 'https://example.test/de/' });
    assert.equal('scope' in r, false); assert.deepEqual(r, captureGaps(records));
  }
});
check('captureGaps scope: a / entry, a /faq/… entry (not a locale) and an unparsable entry → no scope, even when no page lies under it', () => {
  for (const entryUrl of ['https://example.test/', 'https://example.test/faq/shipping', 'not a url', undefined]) {
    const r = captureGaps(DE_ENTRY_EN_PLAN, { entryUrl });
    assert.equal('scope' in r, false, String(entryUrl)); assert.deepEqual(r, captureGaps(DE_ENTRY_EN_PLAN), String(entryUrl));
  }
});
check('captureGaps scope: a /ca/en entry counts only /ca/en and below on the entry host (www. and trailing slash folded; url, else finalUrl); other hosts and pages without a parseable URL are outside / not counted', () => {
  const records = [
    page('/ca/en/'), { slug: 'ca-en-about', url: 'https://www.example.test/ca/en/about/', links: [] }, { slug: 'ca-en-x', url: 'nope', finalUrl: 'https://example.test/ca/en/x' },
    page('/ca/fr/'), page('/ca/fr/a-propos'), page('/us/en/'), page('/us/en/about'), page('/ca/'), page('/ca/enterprise'),
    { slug: 'mirror', url: 'https://other.example.test/ca/en/about', links: [] }, { slug: 'junk', url: 'nope', links: [] },
  ];
  const r = captureGaps(records, { entryUrl: 'https://example.test/ca/en/' });
  assert.deepEqual(r.scope, { entryLocale: '/ca/en', inside: 3, outside: 7 });
  assert.match(r.detail, /; entry locale \/ca\/en but 7 of 10 captured pages outside it$/);
});
check('captureGaps scope: /de vs /de-ch is a segment boundary, not a string prefix — either way round', () => {
  const chPlan = [page('/de/'), page('/de-ch/'), page('/de-ch/produkte'), page('/de-ch/kontakt')];
  assert.deepEqual(captureGaps(chPlan, { entryUrl: 'https://example.test/de/' }).scope, { entryLocale: '/de', inside: 1, outside: 3 });
  assert.equal('scope' in captureGaps(chPlan, { entryUrl: 'https://example.test/de-ch/' }), false);
  const dePlan = [page('/de-ch/'), page('/de/'), page('/de/produkte'), page('/de/kontakt')];
  assert.deepEqual(captureGaps(dePlan, { entryUrl: 'https://example.test/de-ch/produkte' }).scope, { entryLocale: '/de-ch', inside: 1, outside: 3 });
});
check('captureGaps: the one-argument call keeps its exact result — no scope key, no detail suffix — on the very capture that scopes with an entry URL', () => {
  assert.deepEqual(captureGaps(DE_ENTRY_EN_PLAN), {
    roots: [{ root: '/de', slug: 'de', linked: 0, uncaptured: [] }, { root: '/en', slug: 'en', linked: 0, uncaptured: [] }],
    detail: 'uncaptured first-level targets: de 0, en 0',
  });
  assert.deepEqual(captureGaps(DE_ENTRY_EN_PLAN, {}), captureGaps(DE_ENTRY_EN_PLAN));
  assert.equal(captureGaps([], { entryUrl: 'https://example.test/de/' }).scope, undefined);
});
check('--help prints the usage header (naming captureGaps) and exits 0 without playwright, writing nothing; importing this module started no crawl', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'crawl-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^crawl\.mjs — reference Playwright crawler/); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /_crawl-log\.json#captureGaps/); assert.equal(r.stderr, '');
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
  // this file imported ../crawl.mjs above: a module that ran main() on import would have exited 2 on the missing browser
});

check('maxPages: 0 is no cap (--all / --prep); missing or bad values fall back to 25; others are floored and at least 1', () => {
  assert.equal(maxPages('0'), Infinity); assert.equal(maxPages(undefined), 25); assert.equal(maxPages('abc'), 25); assert.equal(maxPages('40'), 40); assert.equal(maxPages('2.7'), 2);
});

// 30 discovered pages, one of them the entry again (trailing slash) and one a hash variant: 29 distinct with the entry
const FOUND = [...Array.from({ length: 28 }, (_, i) => `https://example.test/p${i}`), 'https://example.test', 'https://example.test/p3/#team'];
check('capDiscovered: the entry first, slash- and hash-insensitive dedupe, then the --max cap; total is the count BEFORE the cap — the cap bites: count 25 of total 29; no cap or a cap that does not bite: total === count', () => {
  const capped = capDiscovered('https://example.test/', FOUND, 25);
  assert.equal(capped.urls.length, 25); assert.equal(capped.total, 29);
  assert.equal(capped.urls[0], 'https://example.test/'); assert.equal(capped.urls[24], 'https://example.test/p23');
  for (const max of [Infinity, 29, 40]) { const r = capDiscovered('https://example.test/', FOUND, max); assert.equal(r.urls.length, 29, String(max)); assert.equal(r.total, r.urls.length, String(max)); }
  assert.deepEqual(capDiscovered('https://example.test/', [], 25), { urls: ['https://example.test/'], total: 1 });
});
check('discoveryLog: _crawl-log.json#discovery carries count (after the --max cap) and total (before it) side by side; botBlock and originRedirect only when set', () => {
  const { urls, total } = capDiscovered('https://example.test/', FOUND, 25);
  assert.deepEqual(discoveryLog({ technique: 'headless', count: urls.length, total, concurrency: 4 }), { fetchTechnique: 'headless', count: 25, total: 29, concurrency: 4 });
  const redirect = { from: 'https://example.test', to: 'https://www.example.test' };
  const r = discoveryLog({ technique: 'headed-chrome-stealth', count: 3, total: 3, concurrency: 2, botBlock: 'challenge', originRedirect: redirect });
  assert.deepEqual(Object.keys(r), ['fetchTechnique', 'count', 'total', 'concurrency', 'botBlock', 'originRedirect']);
  assert.equal(r.total, r.count); assert.deepEqual(r.originRedirect, redirect);
});
check('captureGaps scope: carries totalDiscovered (= discovery.total) when the crawl passes it; no scope → no totalDiscovered anywhere; not passed → no key', () => {
  const r = captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/de/', totalDiscovered: 31 });
  assert.deepEqual(r.scope, { entryLocale: '/de', inside: 1, outside: 9, totalDiscovered: 31 });
  assert.equal(r.detail, 'uncaptured first-level targets: de 0, en 0; entry locale /de but 9 of 10 captured pages outside it');
  const none = captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/', totalDiscovered: 31 });
  assert.deepEqual(none, captureGaps(DE_ENTRY_EN_PLAN));
  assert.equal('totalDiscovered' in captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/de/' }).scope, false);
});
check('captureGaps scope: an entry that redirected to another origin is scoped at the LANDED URL — scope.landedFrom names the requested URL and the detail names both; a same-origin, unparsable or absent landedFrom changes nothing', () => {
  // requested at another origin's /en/, landed on /de/: the landed /de decides (the requested /en would hold 9 of 10 inside)
  const r = captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/de/', landedFrom: 'https://example.org/en/', totalDiscovered: 12 });
  assert.deepEqual(r.scope, { entryLocale: '/de', inside: 1, outside: 9, totalDiscovered: 12, landedFrom: 'https://example.org/en/' });
  assert.equal(r.detail, 'uncaptured first-level targets: de 0, en 0; entry locale /de (from the landed URL https://example.test/de/, redirected from https://example.org/en/) but 9 of 10 captured pages outside it');
  assert.deepEqual(r.roots, captureGaps(DE_ENTRY_EN_PLAN).roots);
  for (const landedFrom of ['https://example.test/en/', 'not a url', undefined, null]) {
    assert.deepEqual(captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/de/', landedFrom }), captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/de/' }), String(landedFrom));
  }
  // the landed URL has no locale: no scope, whatever the requested URL said
  assert.equal('scope' in captureGaps(DE_ENTRY_EN_PLAN, { entryUrl: 'https://example.test/', landedFrom: 'https://example.org/de/' }), false);
});

// Counts checked against the ISO 639-2 registration authority's code list (its alpha-2 column) and the IANA
// language subtag registry for languages, and three ISO 3166-1 alpha-2 country lists plus the IANA registry for
// regions. The 184 languages keep `bh`, which IANA deprecated in 2026; `BH` is also a region (Bahrain), so a
// second segment reads the same either way.
const TABLE_FILE = join(HERE, '..', 'locale-codes.json');
check('locale-codes.json: 184 ISO 639-1 languages and 249 ISO 3166-1 alpha-2 regions — sorted, unique, lower-case two-letter; de, en, fr, ch, us, gb in; the deprecated iw/in/ji/jw/mo/sh and reserved region codes out', () => {
  const table = JSON.parse(readFileSync(TABLE_FILE, 'utf8'));
  assert.deepEqual(Object.keys(table), ['_source', 'languages', 'regions']);
  assert.equal(table._source, 'ISO 639-1 language codes and ISO 3166-1 alpha-2 region codes, lower case');
  for (const [key, n] of [['languages', 184], ['regions', 249]]) {
    const list = table[key];
    assert.equal(list.length, n, key); assert.equal(new Set(list).size, n, key);
    assert.ok(list.every((c) => /^[a-z]{2}$/.test(c)), key); assert.deepEqual(list, [...list].sort(), key);
  }
  for (const c of ['de', 'en', 'fr', 'ch', 'uk', 'eu', 'zh']) assert.ok(table.languages.includes(c), `language ${c}`);
  for (const c of ['de', 'fr', 'ch', 'us', 'gb', 'ai', 'in']) assert.ok(table.regions.includes(c), `region ${c}`);
  for (const c of ['iw', 'in', 'ji', 'jw', 'mo', 'sh']) assert.equal(table.languages.includes(c), false, `deprecated language ${c}`);
  // UK, EU, CQ: exceptionally reserved, not assigned; XK, ZZ: user-assigned; AN, YU: withdrawn
  for (const c of ['uk', 'eu', 'cq', 'xk', 'zz', 'an', 'yu']) assert.equal(table.regions.includes(c), false, `region ${c}`);
  for (const c of ['zz', 'xk', 'qq']) assert.equal(table.languages.includes(c), false, `language ${c}`);
});
check('entryLocalePrefix: a second segment joins the locale only when its two-letter head is a known language or region code — /de/ai (Anguilla) narrows, /de/zz stops at /de; the first segment keeps its rule (case kept)', () => {
  for (const [u, want] of [
    ['https://x.example/de/ai/produkte', '/de/ai'], ['https://x.example/de/zz/produkte', '/de'], ['https://x.example/en-us/x', '/en-us'], ['https://x.example/en-us/zz/x', '/en-us'],
    ['https://x.example/de/ch/x', '/de/ch'], ['https://x.example/de/CH/', '/de/CH'], ['https://x.example/ca/en-gb/x', '/ca/en-gb'], ['https://x.example/ca/zh_hant/x', '/ca/zh_hant'],
    ['https://x.example/de/zz-yy/x', '/de'], ['https://x.example/de/QQ_hant', '/de'], ['https://x.example/zz/ai/x', '/zz/ai'], ['https://x.example/zz/qq/x', '/zz'],
  ]) assert.equal(entryLocalePrefix(u), want, u);
});
check('captureGaps scope: a /de/zz/… entry scopes at /de, so a /de capture raises no warning; a /de/ai/… entry still narrows to /de/ai', () => {
  const dePlan = [page('/de/'), page('/de/produkte'), page('/de/zz/x'), page('/de/ai/x')];
  assert.equal('scope' in captureGaps(dePlan, { entryUrl: 'https://example.test/de/zz/x' }), false);
  assert.deepEqual(captureGaps(dePlan, { entryUrl: 'https://example.test/de/ai/x' }).scope, { entryLocale: '/de/ai', inside: 1, outside: 3 });
});
check('localeCodes: the shipped table loads from beside crawl.mjs; a missing table → null and ONE stderr note however often asked, and entryLocalePrefix without a table (null) never narrows past the first segment', () => {
  const table = JSON.parse(readFileSync(TABLE_FILE, 'utf8'));
  assert.deepEqual([...localeCodes()].sort(), [...new Set([...table.languages, ...table.regions])].sort());
  const missing = new URL('./no-such-locale-codes.json', pathToFileURL(SCRIPT));
  const notes = []; const stderr = console.error; console.error = (...a) => notes.push(a.join(' '));
  try { for (let i = 0; i < 3; i += 1) assert.equal(localeCodes(missing), null); } finally { console.error = stderr; }
  assert.equal(notes.length, 1, notes.join('\n')); assert.match(notes[0], /^\[crawl\] note: .*no-such-locale-codes\.json.* second path segment/);
  for (const [u, want] of [['https://x.example/de/ai/x', '/de'], ['https://x.example/ca/en/x', '/ca'], ['https://x.example/en-us/x', '/en-us'], ['https://x.example/faq', null]]) assert.equal(entryLocalePrefix(u, null), want, u);
});

console.log(failed ? `\n${failed} failing` : '\ncrawl: all checks passed');
process.exit(failed ? 1 : 0);
