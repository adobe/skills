#!/usr/bin/env node
// skills/replica/scripts/test/extend-roster.test.mjs — the extend-roster.mjs contract: `select` keeps the candidates
// whose EDS destination is new (not captured, not a coverage path, not an existing content document — nav and
// fragments included), one slot per destination with a query-less url preferred so the roster replays exactly,
// --max, --named refusals (query, delivered, document) that write nothing, --slugs-out; `publish` lists the DA
// document of every content file absent from the opening snapshot; usage errors exit 2.
// Run: node plugins/stardust/skills/replica/scripts/test/extend-roster.test.mjs   (under 1 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinationOf, selectRoster } from '../extend-roster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'extend-roster.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-test-')));
let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// a delivered project: home captured and delivered; a search page built outside the capture (coverage only); the
// site's nav, footer and a fragment as content documents no coverage row names
write('stardust/state.json', JSON.stringify({ site: { originUrl: 'https://ex.test' }, pages: [{ slug: 'index', url: '/' }, { slug: 'p', url: '/p?id=1' }] }));
write('stardust/rollout/coverage/pages.json', JSON.stringify({ pages: [{ slug: 'index', path: '/' }, { slug: 'search-results', path: '/Search-Results/' }] }));
for (const f of ['index.html', 'nav.html', 'footer.html', 'fragments/promo.html', 'search-results.html']) write(`content/${f}`, '<main></main>');
const candidates = [
  'https://ex.test/?utm_source=mail', 'https://ex.test/nav.html', 'https://ex.test/visit/?campaign=mail', 'https://ex.test/visit/',
  'https://ex.test/visit/index.html', 'https://ex.test/search-results', 'https://ex.test/p?id=2', 'https://ex.test/fragments/promo',
  'https://ex.test/Shop_Now', 'https://ex.test/about',
].join('\n');
write('cand.txt', `${candidates}\n`);

check('destinationOf: the contracts.mjs destination — case, `.html`, `/index`, slash, query and `_` folded', () => {
  for (const [a, b] of [['https://ex.test/Visit/index.html?x=1', 'https://ex.test/visit/'], ['https://ex.test/Shop_Now', 'https://ex.test/shop-now'], ['https://ex.test/index.html', 'https://ex.test/']]) assert.equal(destinationOf(a), destinationOf(b), `${a} ${b}`);
});

check('select: captured, delivered and existing-document destinations dropped (nav, fragments, a coverage-only page), one slot per destination with the query-less url kept, --max, --slugs-out', () => {
  const r = run('select', '--candidates', 'cand.txt', '--out', 'roster.txt', '--max', '2', '--slugs-out', 'slugs.txt');
  assert.equal(r.code, 0, r.err);
  assert.equal(read('roster.txt'), 'https://ex.test/visit/\nhttps://ex.test/Shop_Now\n', 'the query url gave way to /visit/ at its place; /p is captured; then the cap');
  assert.equal(read('slugs.txt'), 'index\nsearch-results\n');
  for (const re of [/dropped https:\/\/ex\.test\/\?utm_source=mail — already captured \(\/\)/, /dropped https:\/\/ex\.test\/nav\.html — an existing content document holds \/nav/, /dropped https:\/\/ex\.test\/search-results — delivered at \/search-results \(coverage\)/, /dropped https:\/\/ex\.test\/fragments\/promo — an existing content document/, /dropped https:\/\/ex\.test\/visit\/\?campaign=mail — one destination with https:\/\/ex\.test\/visit\//, /dropped https:\/\/ex\.test\/visit\/index\.html — one destination with/, /dropped https:\/\/ex\.test\/p\?id=2 — already captured \(\/p\)/]) assert.match(r.err, re);
  assert.match(r.err, /^roster: 2 page\(s\) → roster\.txt/m);
  assert.equal(run('select', '--candidates', 'cand.txt', '--out', 'all.txt').code, 0);
  assert.equal(read('all.txt'), 'https://ex.test/visit/\nhttps://ex.test/Shop_Now\nhttps://ex.test/about\n', 'no --max: all');
});

check('select: a query url alone for its destination is kept as the crawler gave it (the roster replays exactly)', () => {
  const r = selectRoster({ candidates: ['https://ex.test/q?id=42'], captured: new Set(), delivered: new Set(), documents: new Set() });
  assert.deepEqual(r.urls, ['https://ex.test/q?id=42']);
});

check('select --named: a query url, a delivered or document destination exits 2 and writes nothing; a captured one is dropped and named', () => {
  for (const [url, why] of [['https://ex.test/visit/?x=1', /has a query string/], ['https://ex.test/Search-Results', /delivered at \/search-results/], ['https://ex.test/nav', /existing content document holds \/nav/]]) {
    write('named.txt', `https://ex.test/about\n${url}\n`);
    const r = run('select', '--named', '--candidates', 'named.txt', '--out', 'named-roster.txt');
    assert.equal(r.code, 2, r.err); assert.match(r.err, why); assert.match(r.err, /nothing written/);
    assert.equal(existsSync(join(root, 'named-roster.txt')), false);
  }
  write('named.txt', 'https://ex.test/\n');
  const home = run('select', '--named', '--candidates', 'named.txt', '--out', 'named-roster.txt');
  assert.equal(home.code, 2, home.err); assert.match(home.err, /refused https:\/\/ex\.test\/ — delivered at \/ \(coverage\)/, 'captured AND delivered: refused, not dropped');
  write('named.txt', 'https://ex.test/p?id=1\nhttps://ex.test/about\n');
  const ok = run('select', '--named', '--candidates', 'named.txt', '--out', 'deep/new/named-roster.txt');
  assert.equal(ok.code, 2, 'a query url is refused first');
  write('named.txt', 'https://ex.test/p\nhttps://ex.test/about\n');
  const ok2 = run('select', '--named', '--candidates', 'named.txt', '--out', 'deep/new/named-roster.txt');
  assert.equal(ok2.code, 0, ok2.err); assert.equal(read('deep/new/named-roster.txt'), 'https://ex.test/about\n', 'the output\'s folder is created');
  assert.match(ok2.err, /dropped https:\/\/ex\.test\/p — already captured \(\/p\)/, 'captured, not delivered (an interrupted capture): dropped');
});

check('select: the slug reservations are written before the roster — a failure writing them leaves no roster (resume selects again)', () => {
  mkdirSync(join(root, 'slugs-dir'), { recursive: true }); write('slugs-dir/x', '');   // a directory where the file goes: its rename fails
  const r = run('select', '--candidates', 'cand.txt', '--out', 'late-roster.txt', '--slugs-out', 'slugs-dir');
  assert.equal(r.code, 2, r.err);
  assert.equal(existsSync(join(root, 'late-roster.txt')), false, 'no roster without its reservations');
});
check('select: an empty roster is written and exits 0 (discovery found nothing new)', () => {
  write('none.txt', 'https://ex.test/nav.html\n');
  const r = run('select', '--candidates', 'none.txt', '--out', 'empty.txt');
  assert.equal(r.code, 0, r.err); assert.equal(read('empty.txt'), '');
});

check('publish: the content file path of every file absent from the opening snapshot — `/visit/index.html`, `/nav.html.html` (deploy-batch drops one `.html`); nav and older pages never listed', () => {
  mkdirSync(join(root, 'opening'), { recursive: true });
  spawnSync('cp', ['-Rp', join(root, 'content'), join(root, 'opening', 'content')]);
  write('content/visit/index.html', '<main>new</main>'); write('content/shop-now.html', '<main>new</main>');
  write('content/nav.html', '<nav>relinked</nav>'); write('content/nav.html.html', '<main>an exporter\'s new page</main>');
  const r = run('publish', '--before', 'opening/content', '--out', 'publish.paths');
  assert.equal(r.code, 0, r.err);
  assert.equal(read('publish.paths'), '/nav.html.html\n/shop-now.html\n/visit/index.html\n');
});

check('usage: unknown command, missing or flag-shaped value, bad --max, unreadable input exit 2 with one line; --help exits 0', () => {
  for (const args of [['nope'], ['select', '--out', 'x'], ['select', '--candidates', '--out'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--max', 'two'], ['select', '--candidates', 'missing.txt', '--out', 'x'], ['publish', '--before', 'nowhere', '--out', 'x'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--state', 'missing.json']]) {
    const r = run(...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /^skills\/replica\/scripts\/extend-roster\.mjs/);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\nextend-roster: ${failed} of ${checks} checks failed` : `\nextend-roster: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
