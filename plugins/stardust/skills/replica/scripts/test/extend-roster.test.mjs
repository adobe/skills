#!/usr/bin/env node
// skills/replica/scripts/test/extend-roster.test.mjs — the extend-roster.mjs contract: `select` keeps the candidates
// whose EDS destination is new (not captured, not a coverage path, not a document a deploy ledger records live, not
// an existing content document — nav and fragments included), one slot per destination with a query-less url
// preferred so the roster replays exactly, --max, --named refusals (query, delivered, document) that write nothing,
// --slugs-out and --reserved-out written before the roster; `output` (a unit's exact files, per-unit records that
// only grow); `publish` (the guard <content>/.deploy-allow: outputs and also.paths only — never a document that
// existed at the opening; drafts held); and the composition with the real deploy-batch.mjs and localize-links.mjs:
// an older document is neither sent nor rewritten while the guard exists. Usage errors exit 2.
// Run: node plugins/stardust/skills/replica/scripts/test/extend-roster.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinationOf, selectRoster } from '../extend-roster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'extend-roster.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-test-')));
let failed = 0; let checks = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
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

await check('destinationOf: the contracts.mjs destination — case, `.html`, `/index`, slash, query and `_` folded', () => {
  for (const [a, b] of [['https://ex.test/Visit/index.html?x=1', 'https://ex.test/visit/'], ['https://ex.test/Shop_Now', 'https://ex.test/shop-now'], ['https://ex.test/index.html', 'https://ex.test/']]) assert.equal(destinationOf(a), destinationOf(b), `${a} ${b}`);
});

await check('select: captured, delivered and existing-document destinations dropped (nav, fragments, a coverage-only page), one slot per destination with the query-less url kept, --max, --slugs-out', () => {
  const r = run('select', '--candidates', 'cand.txt', '--out', 'roster.txt', '--max', '2', '--slugs-out', 'slugs.txt');
  assert.equal(r.code, 0, r.err);
  assert.equal(read('roster.txt'), 'https://ex.test/visit/\nhttps://ex.test/Shop_Now\n', 'the query url gave way to /visit/ at its place; /p is captured; then the cap');
  assert.equal(read('slugs.txt'), 'index\nsearch-results\n');
  for (const re of [/dropped https:\/\/ex\.test\/\?utm_source=mail — already captured \(\/\)/, /dropped https:\/\/ex\.test\/nav\.html — an existing content document holds \/nav/, /dropped https:\/\/ex\.test\/search-results — delivered at \/search-results \(coverage\)/, /dropped https:\/\/ex\.test\/fragments\/promo — an existing content document/, /dropped https:\/\/ex\.test\/visit\/\?campaign=mail — one destination with https:\/\/ex\.test\/visit\//, /dropped https:\/\/ex\.test\/visit\/index\.html — one destination with/, /dropped https:\/\/ex\.test\/p\?id=2 — already captured \(\/p\)/]) assert.match(r.err, re);
  assert.match(r.err, /^roster: 2 page\(s\) → roster\.txt/m);
  assert.equal(run('select', '--candidates', 'cand.txt', '--out', 'all.txt').code, 0);
  assert.equal(read('all.txt'), 'https://ex.test/visit/\nhttps://ex.test/Shop_Now\nhttps://ex.test/about\n', 'no --max: all');
});

await check('select: a destination under /library (the DA authoring library da-library writes) is dropped, and refused when named', () => {
  const r = selectRoster({ candidates: ['https://ex.test/library/blocks/hero', 'https://ex.test/Library', 'https://ex.test/libraries'], captured: new Set(), delivered: new Set(), documents: new Set() });
  assert.deepEqual(r.urls, ['https://ex.test/libraries']);
  assert.match(r.dropped[0].why, /\/library\/blocks\/hero is the DA authoring library's folder/);
  assert.equal(selectRoster({ candidates: ['https://ex.test/library/blocks/hero'], captured: new Set(), delivered: new Set(), documents: new Set(), named: true }).refused.length, 1);
});
await check('select: a query url alone for its destination is kept as the crawler gave it (the roster replays exactly)', () => {
  const r = selectRoster({ candidates: ['https://ex.test/q?id=42'], captured: new Set(), delivered: new Set(), documents: new Set() });
  assert.deepEqual(r.urls, ['https://ex.test/q?id=42']);
});

await check('select --named: a query url, a delivered or document destination exits 2 and writes nothing; a captured one is dropped and named', () => {
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

await check('select: the slug reservations are written before the roster — a failure writing them leaves no roster (resume selects again)', () => {
  mkdirSync(join(root, 'slugs-dir'), { recursive: true }); write('slugs-dir/x', '');   // a directory where the file goes: its rename fails
  const r = run('select', '--candidates', 'cand.txt', '--out', 'late-roster.txt', '--slugs-out', 'slugs-dir');
  assert.equal(r.code, 2, r.err);
  assert.equal(existsSync(join(root, 'late-roster.txt')), false, 'no roster without its reservations');
});
await check('select: an empty roster is written and exits 0 (discovery found nothing new)', () => {
  write('none.txt', 'https://ex.test/nav.html\n');
  const r = run('select', '--candidates', 'none.txt', '--out', 'empty.txt');
  assert.equal(r.code, 0, r.err); assert.equal(read('empty.txt'), '');
});

await check('usage: unknown command, missing or flag-shaped value, bad --max, unreadable input, a missing pass record exit 2 with one line; --help exits 0', () => {
  for (const args of [['nope'], ['relink-status', '--pass', 'p'], ['select', '--out', 'x'], ['select', '--candidates', '--out'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--max', 'two'], ['select', '--candidates', 'missing.txt', '--out', 'x'], ['publish', '--pass', 'nowhere'], ['output', '--pass', 'p'], ['output', '--pass', 'nowhere', '--unit', 'u', '--files', 'a.html'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--state', 'missing.json']]) {
    const r = run(...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /^skills\/replica\/scripts\/extend-roster\.mjs/);
});

// ---- a pass: the roster's reservations, a unit's outputs, the publish guard ---------------------------------------
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-pass-')));
const pw = (rel, text) => { mkdirSync(dirname(join(proj, rel)), { recursive: true }); writeFileSync(join(proj, rel), text); };
const pr = (rel) => readFileSync(join(proj, rel), 'utf8');
const prun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const X = 'stardust/replica/extend/x1';
const INDEX = '<main><a href="https://src.test/visit/">Visit</a></main>\n';
const NAV = '<nav><a href="https://src.test/visit/">Visit</a></nav>\n';
// a delivered site: home and about (coverage), a nav no coverage row names, a ledger-only footer whose file is
// git-ignored and so not in this checkout, an owner's draft
pw('stardust/state.json', JSON.stringify({ site: { originUrl: 'https://src.test/' }, pages: [{ slug: 'index', url: '/' }, { slug: 'seen', url: '/seen' }] }));
pw('stardust/rollout/coverage/pages.json', JSON.stringify({ pages: [{ slug: 'index', path: '/' }, { slug: 'about', path: '/about' }] }));
pw('content/index.html', INDEX); pw('content/about.html', '<main>About</main>\n'); pw('content/nav.html', NAV);
pw('content/old-draft.html', '<main>an owner draft from before the pass</main>\n');
pw('stardust/deploy/ledger-c1.json', JSON.stringify({ '/index': { status: 'live' }, '/footer': { status: 'live' }, '/gone': { status: 'put-fail', put: 500 }, '/staged': { status: 'preview-fail', put: 201 } }));
pw('stardust/deploy/media-ledger.json', 'not a deploy ledger, never read');
pw('cand.txt', ['https://src.test/', 'https://src.test/footer', 'https://src.test/staged', 'https://src.test/gone', 'https://src.test/visit/', 'https://src.test/team'].join('\n'));

await check('select --reserved-out: every destination taken at the opening — a captured page not delivered yet, coverage, a ledger row whose PUT landed (live, or stopped at preview) though its file is not in the checkout, every content document — written before the roster; a failed PUT reserves nothing', () => {
  const r = prun('select', '--candidates', 'cand.txt', '--out', `${X}/urls.txt`, '--reserved-out', `${X}/reserved.paths`, '--slugs-out', `${X}/reserved-slugs.txt`);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/urls.txt`), 'https://src.test/gone\nhttps://src.test/visit/\nhttps://src.test/team\n', '/gone was never delivered (put-fail): a page may take it');
  assert.equal(pr(`${X}/reserved.paths`), '/\n/about\n/footer\n/nav\n/old-draft\n/seen\n/staged\n');
  assert.match(r.err, /dropped https:\/\/src\.test\/footer — delivered at \/footer/);
  pw('named.txt', 'https://src.test/footer\n');
  const named = prun('select', '--named', '--candidates', 'named.txt', '--out', 'named-roster.txt');
  assert.equal(named.code, 2); assert.match(named.err, /refused https:\/\/src\.test\/footer — delivered at \/footer/);
});

await check('a deploy ledger that cannot be read stops select (exit 2, named, no roster): a reservation is never dropped silently', () => {
  pw('stardust/deploy/ledger-broken.json', '{ "/nav": { "status": "li');
  const r = prun('select', '--candidates', 'cand.txt', '--out', 'broken-roster.txt');
  assert.equal(r.code, 2, r.err); assert.match(r.err, /deploy ledger stardust\/deploy\/ledger-broken\.json/);
  assert.equal(existsSync(join(proj, 'broken-roster.txt')), false);
  rmSync(join(proj, 'stardust/deploy/ledger-broken.json'));
});

await check('output: a unit records the exact file of a roster page; a file at an opening destination, a non-roster file, a second file for one page, a non-document are refused (exit 2, nothing written)', () => {
  pw('content/visit/index.html', '<main>new visit page <a href="https://src.test/index.html">home</a></main>\n');
  pw('content/visit.html', '<main>a competing leaf</main>\n');
  pw('content/fragments/hours.html', '<div>hours</div>\n');
  pw('content/footer.html', '<footer>a pass render over the live footer</footer>\n');
  assert.equal(prun('output', '--pass', X, '--unit', 'c-visit', '--files', 'visit/index.html').code, 0);
  assert.equal(pr(`${X}/outputs/c-visit.paths`), '/visit/index.html\n');
  for (const [f, why] of [['visit.html', /roster page \/visit already has its output \/visit\/index\.html \(unit c-visit\)/], ['about.html', /\/about was taken when the pass opened/], ['footer.html', /\/footer was taken when the pass opened/], ['fragments/hours.html', /not a roster page \(a fragment the pages need goes in also\.paths\)/], ['visit/Index.HTML', /not a document/]]) {
    const r = prun('output', '--pass', X, '--unit', 'c-other', '--files', f);
    assert.equal(r.code, 2, f); assert.match(r.err, why);
  }
  assert.equal(existsSync(join(proj, X, 'outputs', 'c-other.paths')), false);
  assert.equal(prun('output', '--pass', X, '--unit', '../escape', '--files', 'visit/index.html').code, 2, 'a unit name is a file name, never a path');
});

await check('output: a record only grows — a resumed unit that reports a subset keeps its earlier claims', () => {
  pw('content/team.html', '<main>Team</main>\n');
  assert.equal(prun('output', '--pass', X, '--unit', 'c-visit', '--files', 'team.html').code, 0);
  assert.equal(pr(`${X}/outputs/c-visit.paths`), '/team.html\n/visit/index.html\n');
});

await check('output: concurrent units never lose each other\'s records — 12 writers at once, every page on the guard', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://src.test/many-${i}/`);
  const roster = pr(`${X}/urls.txt`);
  pw(`${X}/urls.txt`, `${roster}${urls.join('\n')}\n`);
  for (let i = 0; i < 12; i += 1) pw(`content/many-${i}/index.html`, `<main>${i}</main>\n`);
  const runs = Array.from({ length: 12 }, (_, i) => new Promise((done) => {
    spawn(process.execPath, [SCRIPT, 'output', '--pass', X, '--unit', `c-many-${i}`, '--files', `many-${i}/index.html`], { cwd: proj }).on('close', done);
  }));
  assert.deepEqual(await Promise.all(runs), Array(12).fill(0));
  assert.equal(prun('publish', '--pass', X).code, 0);
  assert.equal(pr('content/.deploy-allow').split('\n').filter((l) => l.startsWith('/many-')).length, 12);
  for (let i = 0; i < 12; i += 1) { rmSync(join(proj, 'content', `many-${i}`), { recursive: true }); rmSync(join(proj, X, 'outputs', `c-many-${i}.paths`)); }
  pw(`${X}/urls.txt`, roster);
});

await check('a document reached through a symbolic link — the file, or a folder above it — is refused by output and by publish: the link can name an older document', () => {
  const roster = pr(`${X}/urls.txt`);
  pw(`${X}/urls.txt`, `${roster}https://src.test/linked\nhttps://src.test/dir/page\n`);
  symlinkSync('index.html', join(proj, 'content', 'linked.html'));
  mkdirSync(join(proj, 'real-dir')); pw('real-dir/page.html', '<main>outside content</main>\n');
  symlinkSync(join(proj, 'real-dir'), join(proj, 'content', 'dir'));
  for (const f of ['linked.html', 'dir/page.html']) {
    const r = prun('output', '--pass', X, '--unit', 'c-link', '--files', f);
    assert.equal(r.code, 2, f); assert.match(r.err, /reached through a symbolic link: never a pass output/);
    pw(`${X}/also.paths`, `/${f}\n`);
    const p = prun('publish', '--pass', X);
    assert.equal(p.code, 2, f); assert.match(p.err, /reached through a symbolic link/);
  }
  rmSync(join(proj, X, 'also.paths')); rmSync(join(proj, 'content', 'linked.html')); rmSync(join(proj, 'content', 'dir')); rmSync(join(proj, 'real-dir'), { recursive: true });
  pw(`${X}/urls.txt`, roster);
});

await check('publish: units that record and publish at the same time never lose each other — 12 units each run output then publish, three rounds, and the guard lists every unit with no final publish', async () => {
  const roster = pr(`${X}/urls.txt`); const N = 12; const ROUNDS = 3;
  const names = Array.from({ length: N * ROUNDS }, (_, i) => `par-${i}`);
  pw(`${X}/urls.txt`, `${roster}${names.map((n) => `https://src.test/${n}/`).join('\n')}\n`);
  for (const n of names) pw(`content/${n}/index.html`, `<main>${n}</main>\n`);
  const step = (args) => new Promise((done) => { spawn(process.execPath, [SCRIPT, ...args], { cwd: proj }).on('close', done); });
  for (let r = 0; r < ROUNDS; r += 1) {
    const codes = await Promise.all(names.slice(r * N, (r + 1) * N).map(async (n) => {
      const a = await step(['output', '--pass', X, '--unit', `c-${n}`, '--files', `${n}/index.html`]);
      return a || step(['publish', '--pass', X]);
    }));
    assert.deepEqual(codes, Array(N).fill(0));
    assert.equal(pr('content/.deploy-allow').split('\n').filter((l) => l.startsWith('/par-')).length, N * (r + 1), `round ${r + 1}`);
  }
  assert.equal(existsSync(join(proj, X, 'guard.lock')), false, 'the lock is released, and it never lived in content/');
  for (const n of names) { rmSync(join(proj, 'content', n), { recursive: true }); rmSync(join(proj, X, 'outputs', `c-${n}.paths`)); }
  pw(`${X}/urls.txt`, roster);
});

await check('publish takes the pass lock: while another publish holds <pass>/guard.lock it writes nothing and waits; it finishes once the lock is released', async () => {
  rmSync(join(proj, 'content', '.deploy-allow'));
  mkdirSync(join(proj, X, 'guard.lock'));
  let code = null;
  const child = spawn(process.execPath, [SCRIPT, 'publish', '--pass', X], { cwd: proj });
  const closed = new Promise((done) => { child.on('close', (c) => { code = c; done(); }); });
  await new Promise((r) => { setTimeout(r, 500); });
  assert.equal(code, null, 'still waiting for the lock');
  assert.equal(existsSync(join(proj, 'content', '.deploy-allow')), false, 'nothing written while the lock is held');
  rmSync(join(proj, X, 'guard.lock'), { recursive: true });
  await closed;
  assert.equal(code, 0); assert.equal(existsSync(join(proj, 'content', '.deploy-allow')), true);
});

await check('publish: the guard lists the recorded outputs and also.paths as DA paths — never an opening document; a draft, a competing leaf and a file at a roster page no unit recorded are held and named; a refused entry writes nothing', () => {
  pw('content/gone.html', '<main>a file at a roster page no unit recorded</main>\n');
  pw('content/draft.html', '<main>an owner draft, made during the pass</main>\n');
  let r = prun('publish', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr('content/.deploy-allow'), '/team\n/visit/index\n');
  for (const re of [/held \/gone\.html — no unit recorded it as the output of roster page \/gone/, /held \/visit\.html — roster page \/visit has its output \/visit\/index\.html/, /held \/draft\.html — new, neither a unit's output nor in also\.paths/]) assert.match(r.err, re);
  // a file at a destination a document held at the opening (the footer render, the nav) is never listed, new or not
  assert.doesNotMatch(r.err, /held \/(index|about|nav|old-draft|footer)\.html/);
  pw(`${X}/also.paths`, '/fragments/hours.html\n');
  assert.equal(prun('publish', '--pass', X).code, 0);
  assert.equal(pr('content/.deploy-allow'), '/fragments/hours\n/team\n/visit/index\n');
  pw('content/seen.html', '<main>a fragment at a captured page\'s destination</main>\n');
  for (const [entry, why] of [['/nav.html', /\/nav was taken when the pass opened/], ['/footer.html', /\/footer was taken when the pass opened/], ['/seen.html', /\/seen was taken when the pass opened/], ['/library/blocks/hero.html', /no such document/], ['/nope.html', /no such document/]]) {
    pw(`${X}/also.paths`, `/fragments/hours.html\n${entry}\n`);
    r = prun('publish', '--pass', X);
    assert.equal(r.code, 2, entry); assert.match(r.err, why);
    assert.equal(pr('content/.deploy-allow'), '/fragments/hours\n/team\n/visit/index\n', 'nothing written');
  }
  pw(`${X}/also.paths`, '/fragments/hours.html\n');
});

// ---- composition: the guard, read by the real localizer and the real deployer ------------------------------------
const DEPLOY = join(HERE, '..', '..', '..', 'deploy', 'scripts');
const puts = [];
const da = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'PUT') puts.push(decodeURIComponent(req.url));
    res.writeHead(req.method === 'PUT' ? 201 : 200, { 'content-type': 'text/html' }); res.end('<div><p>ok</p></div>');
  });
});
await new Promise((r) => { da.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${da.address().port}`;
const deploy = (...args) => new Promise((done) => {
  const env = { ...process.env, DA_TOKEN: 'test-token', DA_SOURCE_BASE: `${BASE}/source`, AEM_ADMIN_BASE: BASE, DEPLOY_VERIFY_ORIGIN: BASE };
  delete env.ADOBE_IMS_TOKEN_FILE;
  const c = spawn(process.execPath, [join(DEPLOY, 'deploy-batch.mjs'), '--org', 'o', '--repo', 'r', '--branch', 'main', '--content', 'content', '--backoff-ms', '1', ...args], { cwd: proj, env });
  let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => done({ code, err }));
});

await check('composition: with the guard `publish` wrote, the real localizer rewrites the pass\'s documents only — home and nav keep their bytes and their links to the source — and its --check passes', () => {
  const loc = (...a) => spawnSync(process.execPath, [join(DEPLOY, 'localize-links.mjs'), '--source-host', 'src.test', '--content', 'content', ...a], { cwd: proj, encoding: 'utf8' });
  const r = loc('--json');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).held, ['/index.html', '/nav.html'], 'the older documents whose links would change: named for the report');
  assert.equal(pr('content/index.html'), INDEX); assert.equal(pr('content/nav.html'), NAV);
  assert.match(pr('content/visit/index.html'), /<a href="\/">home<\/a>/, 'the pass page links to the delivered home');
  assert.equal(loc('--check').status, 0);
});

await check('composition: a held draft never takes the URL of a pass page — a third document\'s link to /visit/ resolves to the recorded output (the folder index), not the competing leaf', () => {
  pw('content/team.html', '<main>Team <a href="https://src.test/visit/">Visit</a></main>\n');
  const r = spawnSync(process.execPath, [join(DEPLOY, 'localize-links.mjs'), '--source-host', 'src.test', '--content', 'content'], { cwd: proj, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(pr('content/team.html'), '<main>Team <a href="/visit/">Visit</a></main>\n', 'content/visit.html (held) and content/visit/index.html (listed) share one lookup key');
});

await check('composition: the real deployer sends the guard\'s documents only, with --force and without --paths; naming an older page in --paths exits 2 with no request', async () => {
  const all = await deploy('--force');
  assert.equal(all.code, 0, all.err);
  assert.deepEqual([...puts].sort(), ['/source/o/r/fragments/hours.html', '/source/o/r/team.html', '/source/o/r/visit/index.html'], 'the actual PUT paths');
  puts.length = 0;
  pw('older.paths', '/index\n/visit/index\n');
  const named = await deploy('--force', '--paths', 'older.paths');
  assert.equal(named.code, 2, named.err); assert.match(named.err, /does not list \/index \(named in --paths\) — nothing was sent/);
  assert.deepEqual(puts, []);
});

await check('composition: recovery with the guard gone — while the ledger shows the pass open, the real deployer and the real localizer refuse (no PUT, no byte changed); once `extend end` is written they run as on main', async () => {
  rmSync(join(proj, 'content', '.deploy-allow'));
  pw('stardust/status.jsonl', `${JSON.stringify({ skill: 'stardust:replica', phase: 'handoff', event: 'end' })}\n${JSON.stringify({ skill: 'stardust:replica', phase: 'extend', event: 'start', track: 'x1' })}\n`);
  puts.length = 0;
  const forced = await deploy('--force');
  assert.equal(forced.code, 2, forced.err); assert.match(forced.err, /extend pass x1 is open .* and content\/\.deploy-allow is missing — nothing was sent or written/);
  assert.deepEqual(puts, [], 'a forced recovery batch sends nothing: not the home, not the nav, not the owner draft');
  const loc = spawnSync(process.execPath, [join(DEPLOY, 'localize-links.mjs'), '--source-host', 'src.test', '--content', 'content'], { cwd: proj, encoding: 'utf8' });
  assert.equal(loc.status, 1, loc.stderr); assert.match(loc.stderr, /extend pass x1 is open/);
  assert.equal(pr('content/index.html'), INDEX); assert.equal(pr('content/nav.html'), NAV);
  assert.equal(prun('publish', '--pass', X).code, 0, 'publish puts the guard back');
  assert.equal((await deploy('--force')).code, 0);
  assert.deepEqual([...puts].sort(), ['/source/o/r/fragments/hours.html', '/source/o/r/team.html', '/source/o/r/visit/index.html'], 'after recovery: the pass\'s documents only');
  assert.equal(pr('content/index.html'), INDEX, 'the older files\' bytes after recovery');
  pw('stardust/status.jsonl', `${pr('stardust/status.jsonl')}${JSON.stringify({ skill: 'stardust:replica', phase: 'extend', event: 'end', track: 'x1' })}\n`);
  rmSync(join(proj, 'content', '.deploy-allow')); puts.length = 0;
  assert.equal((await deploy('--force')).code, 0);
  assert.ok(puts.includes('/source/o/r/index.html'), 'no open pass and no guard: main\'s behaviour');
});

da.close();
rmSync(proj, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\nextend-roster: ${failed} of ${checks} checks failed` : `\nextend-roster: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
