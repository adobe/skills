#!/usr/bin/env node
// skills/extract/scripts/test/crawl.test.mjs — the crawl.mjs pure helpers, on fixture HTML and without a
// browser or network: locale-root detection by path shape, the first-level capture-gap listing per root
// (same-origin links on the root page under its own path, minus what the crawl captured; query, hash and
// trailing slash folded; assets, mailto:/tel: and other hosts dropped; www. folded), the ready ledger
// detail string, both link-list shapes — and that importing the module or asking --help starts no crawl
// and writes nothing. One consent table: consentTable() hands back live-session's CONSENT_CANDIDATES (the
// same array object, resolved in the plugin tree and in the project-copy layouts — scripts/extract ↔ scripts/diff,
// flat, and a crawl.mjs in stardust/scripts/ beside replica's stardust/scripts/diff/), crawl.mjs keeps no
// selector list of its own, and a copy without live-session beside it still imports and answers --help while
// consentTable() rejects naming the four looked-in paths and the copy step; a stale live-session copy without
// the export is refused the same way. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureGaps, consentTable, localeRootPath, maxPages } from '../crawl.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'crawl.mjs');
const LIVE_SESSION = join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

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

await checkAsync('consentTable(): live-session\'s CONSENT_CANDIDATES itself (identity, not a copy) — one consent list for every instrument', async () => {
  const live = await import(pathToFileURL(LIVE_SESSION).href);
  assert.ok(Array.isArray(live.CONSENT_CANDIDATES) && live.CONSENT_CANDIDATES.length > 0, 'live-session exports a non-empty CONSENT_CANDIDATES');
  assert.equal(await consentTable(), live.CONSENT_CANDIDATES);
});
check('crawl.mjs keeps no consent selector list of its own', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  for (const lit of [`'#onetrust-accept-btn-handler'`, `'.truste-button2'`, `'button[id*="accept" i]'`]) assert.ok(!src.includes(lit), `crawl.mjs still carries ${lit}`);
});
await checkAsync('project copies: consentTable() resolves live-session beside the extract scripts (scripts/extract ↔ scripts/diff, flat, scripts/ ↔ scripts/diff); without it the copy still imports and answers --help, and consentTable() rejects naming the four looked-in paths and the copy step; a stale copy without the export is refused', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crawl-consent-'))); // the module URL is the real path
  try {
    const want = (await import(pathToFileURL(LIVE_SESSION).href)).CONSENT_CANDIDATES;
    for (const [crawlRel, liveRel] of [['scripts/extract/crawl.mjs', 'scripts/diff/live-session.mjs'], ['flat/crawl.mjs', 'flat/live-session.mjs'],
      ['stardust/scripts/crawl.mjs', 'stardust/scripts/diff/live-session.mjs']]) { // the last: replica's copy of the diff scripts
      for (const [from, rel] of [[SCRIPT, crawlRel], [LIVE_SESSION, liveRel]]) { mkdirSync(dirname(join(root, rel)), { recursive: true }); copyFileSync(from, join(root, rel)); }
      const copy = await import(pathToFileURL(join(root, crawlRel)).href);
      assert.deepEqual(await copy.consentTable(), want, `${crawlRel} reads ${liveRel}`);
    }
    const alone = join(root, 'a', 'b', 'extract', 'crawl.mjs');
    mkdirSync(dirname(alone), { recursive: true }); copyFileSync(SCRIPT, alone);
    const help = spawnSync(process.execPath, [alone, '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Usage:/);
    const copy = await import(pathToFileURL(alone).href);
    await assert.rejects(copy.consentTable(), (e) => {
      for (const p of [join(root, 'a', 'diff', 'scripts', 'live-session.mjs'), join(root, 'a', 'b', 'diff', 'live-session.mjs'), join(root, 'a', 'b', 'extract', 'diff', 'live-session.mjs'), join(root, 'a', 'b', 'extract', 'live-session.mjs')]) assert.ok(e.message.includes(p), `names ${p}: ${e.message}`);
      assert.match(e.message, /copy live-session\.mjs beside the extract scripts \(extract\/SKILL\.md § Setup\)/);
      assert.equal(e.message.split('\n').length, 1, 'one line');
      return true;
    });
    mkdirSync(join(root, 'stale'), { recursive: true }); copyFileSync(SCRIPT, join(root, 'stale', 'crawl.mjs'));
    writeFileSync(join(root, 'stale', 'live-session.mjs'), "export const REAL_CHROME_UA = 'x';\n");
    const stale = await import(pathToFileURL(join(root, 'stale', 'crawl.mjs')).href);
    await assert.rejects(stale.consentTable(), /stale\/live-session\.mjs exports no CONSENT_CANDIDATES — copy live-session\.mjs beside the extract scripts again \(extract\/SKILL\.md § Setup\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} failing` : '\ncrawl: all checks passed');
process.exit(failed ? 1 : 0);
