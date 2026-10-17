#!/usr/bin/env node
// skills/extract/scripts/test/crawl.test.mjs — the crawl.mjs pure helpers, on fixture HTML and without a
// browser or network: locale-root detection by path shape, the first-level capture-gap listing per root
// (same-origin links on the root page under its own path, minus what the crawl captured; query, hash and
// trailing slash folded; assets, mailto:/tel: and other hosts dropped; www. folded), the ready ledger
// detail string, both link-list shapes, the entry-locale scope (the entry URL's leading two-letter locale
// segments, and whether fewer than half of the captured pages lie under them) — and that importing the module or
// asking --help starts no crawl and writes nothing. Run: node <this file>.
// Also navMsSummary (pure: the crawl figure { n, p50, p95, max }, nearest-rank) and, where playwright is importable,
// e2e crawls of a local fixture origin: navMs on every record and crawl.navMs in _crawl-log.json; the page goto
// timeout and its source on one stderr line and in crawl.navTimeout (default, env, a previous crawl's figure in the
// same --out); env STARDUST_NAV_TIMEOUT_MS bounds each page's goto (not the entry probe's); a copy without
// live-session.mjs keeps 45 s and says so once on stderr. Prints a skip line otherwise.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureGaps, entryLocalePrefix, localeRootPath, maxPages } from '../crawl.mjs';
import { navMsSummary } from '../crawl.mjs';

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

check('navMsSummary: nearest-rank p50/p95 (the value at rank ⌈p/100 × n⌉), max, integers; n 0 → nulls; non-numbers and negatives are not samples; the input is not reordered', () => {
  const none = { n: 0, p50: null, p95: null, max: null };
  assert.deepEqual(navMsSummary([]), none); assert.deepEqual(navMsSummary(undefined), none); assert.deepEqual(navMsSummary([NaN, null, undefined, '900', -5, Infinity]), none);
  assert.deepEqual(navMsSummary([1200]), { n: 1, p50: 1200, p95: 1200, max: 1200 });
  const twenty = Array.from({ length: 20 }, (_, i) => (20 - i) * 100); // 2000 … 100, unsorted on purpose
  assert.deepEqual(navMsSummary(twenty), { n: 20, p50: 1000, p95: 1900, max: 2000 });
  assert.equal(twenty[0], 2000, 'the caller\'s list keeps its order');
  assert.deepEqual(navMsSummary(Array.from({ length: 21 }, (_, i) => i + 1)), { n: 21, p50: 11, p95: 20, max: 21 });
  assert.deepEqual(navMsSummary([300.6, 100.2, 200.5, -1, 'x']), { n: 3, p50: 201, p95: 301, max: 301 });
});
check('--help names the goto timeout\'s env and crawl figure, its stderr line, navMs on the page record (the slash retry\'s after a rescue), crawl.navMs and crawl.navTimeout in the log', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /goto timeout: env STARDUST_NAV_TIMEOUT_MS/); assert.match(r.stdout, /2 × crawl\.navMs\.p95 from the previous <out>\/_crawl-log\.json/);
  assert.match(r.stdout, /`\[crawl\] page goto timeout <ms> ms \(env\|crawl\|default\) — <detail>`/);
  assert.match(r.stdout, /navMs \(ms the page's own goto took/); assert.match(r.stdout, /after a\s+slash-retry rescue, the retry's — capped by its 15 s timeout/);
  assert.match(r.stdout, /`crawl\.navMs` \{ n, p50, p95, max \}/); assert.match(r.stdout, /`crawl\.navTimeout` \{ ms, source \}/);
});

// ---- e2e: navMs per record, crawl.navMs in the log, the shared goto timeout (needs playwright) -------------------
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  e2e crawl (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const html = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><h2>Section of ${title}</h2><p>${`Body copy of ${title}, long enough to count as page content. `.repeat(4)}</p></main></body></html>`;
  const pages = { '/': html('Home'), '/a': html('Page A'), '/b': html('Page B'), '/slow': html('Slow page') };
  const server = createServer((req, res) => {
    const p = req.url.split('?')[0];
    const send = () => { if (res.destroyed) return; const body = pages[p]; res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body || 'nope'); };
    // /slow answers after 4 s: past a 1500 ms goto timeout, well inside 45 s
    if (p === '/slow') setTimeout(send, 4000); else send();
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'crawl-e2e-'));
  const cleanEnv = { ...process.env }; delete cleanEnv.STARDUST_NAV_TIMEOUT_MS;
  // asynchronous spawn: the fixture origin lives in this process, so the event loop must keep running
  const crawl = (script, args, env) => new Promise((done) => {
    const child = spawn(process.execPath, [script, '--url', `${base}/`, '--wait', 'fast', ...args], { cwd: work, env });
    let stderr = ''; child.stderr.on('data', (d) => { stderr += d; }); child.stdout.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', (status) => { clearTimeout(timer); done({ status, stderr }); });
  });
  const readOut = (out) => ({
    log: JSON.parse(readFileSync(join(out, '_crawl-log.json'), 'utf8')),
    records: readdirSync(join(out, 'pages')).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(out, 'pages', f), 'utf8'))),
  });
  const gotoLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('[crawl] page goto timeout '));
  // a re-crawl into an --out whose previous log holds a fast figure (p95 3000 → 6000, clamped up to 20000)
  mkdirSync(join(work, 'again'), { recursive: true });
  writeFileSync(join(work, 'again', '_crawl-log.json'), JSON.stringify({ crawl: { failures: [], navMs: { n: 9, p50: 1200, p95: 3000, max: 3400 } } }));
  // a copy of crawl.mjs with no live-session.mjs in any layout (extract copied alone); playwright still resolves
  let alone = null;
  try {
    const nodeModules = fileURLToPath(import.meta.resolve('playwright')).replace(/([\\/]node_modules)[\\/].*$/, '$1');
    alone = join(work, 'alone', 'scripts', 'crawl.mjs');
    mkdirSync(dirname(alone), { recursive: true }); copyFileSync(SCRIPT, alone); symlinkSync(nodeModules, join(work, 'alone', 'node_modules'), 'dir');
  } catch (e) { alone = null; console.log(`skip  e2e crawl without live-session.mjs (${e.message})`); }
  try {
    const [plain, byEnv, bare, again] = await Promise.all([
      crawl(SCRIPT, ['--pages', '/a,/b', '--out', join(work, 'plain')], cleanEnv),
      crawl(SCRIPT, ['--pages', '/slow', '--out', join(work, 'env')], { ...cleanEnv, STARDUST_NAV_TIMEOUT_MS: '1500' }),
      alone ? crawl(alone, ['--pages', '/slow', '--out', join(work, 'bare')], { ...cleanEnv, STARDUST_NAV_TIMEOUT_MS: '1500' }) : null,
      crawl(SCRIPT, ['--pages', '/a', '--out', join(work, 'again')], cleanEnv),
    ]);
    await checkAsync('e2e: every page record carries navMs (integer ms); _crawl-log.json crawl.navMs is navMsSummary of them, beside crawl.failures', () => {
      assert.equal(plain.status, 0, plain.stderr);
      const { log, records } = readOut(join(work, 'plain'));
      assert.deepEqual(records.map((r) => r.slug), ['a', 'b', 'index']);
      for (const r of records) assert.ok(Number.isInteger(r.navMs) && r.navMs >= 0 && r.navMs < 45000, `${r.slug} navMs ${r.navMs}`);
      assert.deepEqual(log.crawl.navMs, navMsSummary(records.map((r) => r.navMs)));
      assert.equal(log.crawl.navMs.n, 3); assert.deepEqual(log.crawl.failures, []);
      assert.doesNotMatch(plain.stderr, /live-session\.mjs/);
    });
    await checkAsync('e2e: the page goto timeout and its source — one stderr line and crawl.navTimeout { ms, source }: 45000 default, 1500 env, 20000 from a previous fast figure in the same --out', () => {
      const cases = [[plain, 'plain', 45000, 'default', /no STARDUST_NAV_TIMEOUT_MS/], [byEnv, 'env', 1500, 'env', /STARDUST_NAV_TIMEOUT_MS=1500/], [again, 'again', 20000, 'crawl', /crawl\.navMs\.p95 3000 ms/]];
      for (const [r, out, ms, source, detail] of cases) {
        assert.equal(r.status, 0, r.stderr);
        const lines = gotoLines(r.stderr);
        assert.equal(lines.length, 1, `${out}: ${r.stderr}`); assert.ok(lines[0].startsWith(`[crawl] page goto timeout ${ms} ms (${source}) — `), lines[0]); assert.match(lines[0], detail);
        assert.deepEqual(readOut(join(work, out)).log.crawl.navTimeout, { ms, source }, out);
      }
      assert.equal(readOut(join(work, 'again')).log.crawl.navMs.n, 2, 'the re-crawl wrote its own figure');
    });
    await checkAsync('e2e: env STARDUST_NAV_TIMEOUT_MS bounds each page\'s goto — a 4 s page fails at 1500 ms, the entry (probe and page) is still captured', () => {
      assert.equal(byEnv.status, 0, byEnv.stderr);
      const { log } = readOut(join(work, 'env'));
      assert.equal(log.crawl.failures.length, 1, JSON.stringify(log.crawl.failures)); assert.equal(log.crawl.failures[0].slug, 'slow'); assert.match(log.crawl.failures[0].message, /Timeout 1500ms exceeded/);
      assert.equal(log.crawl.navMs.n, 1, 'only captured pages are samples');
    });
    if (alone) {
      await checkAsync('e2e: without live-session.mjs the crawl keeps 45 s (the env is not read: the 4 s page is captured) and says so on ONE stderr line; navMs still recorded', () => {
        assert.equal(bare.status, 0, bare.stderr);
        const lines = bare.stderr.split('\n').filter((l) => /live-session\.mjs/.test(l));
        assert.equal(lines.length, 1, bare.stderr); assert.match(lines[0], /no usable live-session\.mjs .* 45000 ms/);
        assert.deepEqual(gotoLines(bare.stderr), [], 'that line is the only timeout report');
        const { log, records } = readOut(join(work, 'bare'));
        assert.deepEqual(log.crawl.failures, []); assert.equal(log.crawl.navMs.n, 2); assert.deepEqual(log.crawl.navTimeout, { ms: 45000, source: 'default' });
        assert.ok(records.find((r) => r.slug === 'slow').navMs >= 3900, 'navMs times the goto: the 4 s answer is in it');
      });
    }
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} failing` : '\ncrawl: all checks passed');
process.exit(failed ? 1 : 0);
