#!/usr/bin/env node
// skills/replica/scripts/test/extend-roster.test.mjs — the extend-roster.mjs contract: `select` keeps the candidates
// whose EDS destination is new (not captured, not a coverage path, not an existing content document — nav and
// fragments included), one slot per destination with a query-less url preferred so the roster replays exactly,
// --max, --named refusals (query, delivered, document) that write nothing, --slugs-out written before the roster;
// in a git project: `inventory` (tracked or ignored), `publish` (new documents of the roster only — an owner's draft
// and a `.htm` file held), the relink records and their classes (candidate, conflict — an owner edit before, after
// or beside the localizer's —, held), restore and approve on candidates only, a landed revision as the last
// published bytes, and a resume from a shallow checkpoint clone; usage errors exit 2.
// Run: node plugins/stardust/skills/replica/scripts/test/extend-roster.test.mjs   (under 1 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

check('usage: unknown command, missing or flag-shaped value, bad --max, unreadable input exit 2 with one line; --help exits 0', () => {
  for (const args of [['nope'], ['select', '--out', 'x'], ['select', '--candidates', '--out'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--max', 'two'], ['select', '--candidates', 'missing.txt', '--out', 'x'], ['publish', '--pass', 'nowhere'], ['relink-approve', '--pass', 'p'], ['relink-after', '--pass', 'nowhere'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--state', 'missing.json']]) {
    const r = run(...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /^skills\/replica\/scripts\/extend-roster\.mjs/);
});

// ---- a pass in a git project: inventory, publish, relink ----------------------------------------------------------
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-pass-')));
const git = (...a) => spawnSync('git', a, { cwd: proj, encoding: 'utf8' });
const pw = (rel, text) => { mkdirSync(dirname(join(proj, rel)), { recursive: true }); writeFileSync(join(proj, rel), text); };
const pr = (rel) => readFileSync(join(proj, rel), 'utf8');
const prun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const X = 'stardust/replica/extend/x1';
const ABOUT = '<main><p>About us.</p><a href="https://src.test/visit/">Visit</a> <a href="https://src.test/contact/">Contact</a></main>\n';
pw('.gitignore', '/content/private-draft.html\n');
pw('content/index.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');
pw('content/about.html', ABOUT);
pw('content/team.html', '<main><p>Team.</p><a href="https://src.test/visit/">Visit</a></main>\n');
pw('content/nav.htm.html', '<nav>the delivered nav</nav>\n');
pw('content/private-draft.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'delivered');
pw(`${X}/base.txt`, `${git('rev-parse', 'HEAD').stdout.trim()}\n`);
pw(`${X}/urls.txt`, 'https://src.test/visit/\n');
// the localizer's stand-in: what localize-links does — repoint the source /visit/ link to the new local page
const localize = () => {
  for (const f of ['index.html', 'about.html', 'team.html', 'private-draft.html', 'visit/index.html']) {
    const p = join(proj, 'content', f);
    if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('https://src.test/visit/', '/visit/'));
  }
};

check('inventory: every document as deploy-batch enumerates them (`.html` names), tracked or git-ignored; written once', () => {
  const r = prun('inventory', '--pass', X);
  assert.equal(r.code, 0, r.err);
  const rows = pr(`${X}/inventory.tsv`).trim().split('\n').map((l) => l.split('\t').slice(1));
  assert.deepEqual(rows, [['about.html', 'tracked'], ['index.html', 'tracked'], ['nav.htm.html', 'tracked'], ['private-draft.html', 'ignored'], ['team.html', 'tracked']]);
  assert.equal(prun('inventory', '--pass', X).code, 2, 'never rewritten');
});

check('publish: only new documents whose destination is a roster page (or also.paths); an owner\'s new draft and a new `.htm` file are held; `/visit/index.html` round-trips', () => {
  pw('content/visit/index.html', '<main>new visit page</main>\n');
  pw('content/draft.html', '<main>an owner draft, made during the pass</main>\n');
  pw('content/nav.htm', '<nav>not a document for deploy-batch</nav>\n');
  pw('content/fragments/visit-hours.html', '<div>hours</div>\n');
  let r = prun('publish', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/publish.paths`), '/visit/index.html\n');
  assert.match(r.err, /held \/draft\.html — new, but not a page of the roster/);
  assert.match(r.err, /held \/fragments\/visit-hours\.html/);
  assert.doesNotMatch(r.err + pr(`${X}/publish.paths`), /nav\.htm\b(?!\.html)/, 'nav.htm is no document: neither listed nor held');
  pw(`${X}/also.paths`, '/fragments/visit-hours.html\n');
  r = prun('publish', '--pass', X);
  assert.equal(pr(`${X}/publish.paths`), '/fragments/visit-hours.html\n/visit/index.html\n');
  rmSync(join(proj, 'content', 'draft.html')); rmSync(join(proj, 'content', 'nav.htm'));
});

check('relink: the localizer\'s own edit is a candidate; an owner link edit made BEFORE it is a conflict (href-only diff, checksum after the run fine); an edit after, or a paragraph edit, is a conflict; an ignored document is held', () => {
  // the owner changed one contact link on about.html before the pass's localizer rewrote the visit link
  pw('content/about.html', ABOUT.replace('https://src.test/contact/', 'https://src.test/contact-us/'));
  assert.equal(prun('relink-after', '--pass', X).code, 2, 'no pending record: relink-before first');
  assert.equal(prun('relink-before', '--pass', X).code, 0);
  localize();
  assert.equal(prun('relink-after', '--pass', X).code, 0);
  assert.equal(existsSync(join(proj, X, 'relink-pending.json')), false);
  pw('content/team.html', pr('content/team.html').replace('Team.', 'Our team.'));   // edited after the run
  const r = prun('relink-status', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^candidate +\/index\.html — links only/m);
  assert.match(r.out, /^conflict +\/about\.html — edited before the localizer ran/m);
  assert.match(r.out, /^conflict +\/team\.html — edited after the localizer ran/m);
  assert.match(r.out, /^held +\/private-draft\.html — git-ignored/m);
  assert.doesNotMatch(r.out, /nav\.htm/, 'unchanged by the localizer: not listed');
});

check('relink-restore: a candidate gets its last published bytes back; a conflict is refused (exit 1) and kept exactly as it is', () => {
  const aboutNow = pr('content/about.html');
  const r = prun('relink-restore', '--pass', X, '--files', '/index.html,/about.html');
  assert.equal(r.code, 1, r.err);
  assert.equal(pr('content/index.html'), '<main><a href="https://src.test/visit/">Visit</a></main>\n', 'the opening commit\'s bytes');
  assert.equal(pr('content/about.html'), aboutNow, 'the owner\'s edit stays');
  assert.match(r.err, /refused \/about\.html — conflict: edited before the localizer ran/);
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m);
});

check('relink-approve: a frozen revision with .sha256 and .paths; once its ledger records those bytes live they are the last published bytes; a later localizer run on top is a candidate again', () => {
  prun('relink-before', '--pass', X); localize(); prun('relink-after', '--pass', X);
  const a = prun('relink-approve', '--pass', X, '--files', 'index.html');
  assert.equal(a.code, 0, a.err);
  assert.equal(pr(`${X}/approved/r1/index.html`), '<main><a href="/visit/">Visit</a></main>\n');
  assert.equal(pr(`${X}/approved/r1.paths`), '/index.html\n');
  assert.match(pr(`${X}/approved/r1.sha256`), /^[0-9a-f]{64} {2}index\.html$/m);
  // not landed yet: still a candidate against the opening bytes
  assert.match(prun('relink-status', '--pass', X).out, /^candidate +\/index\.html/m);
  const landed = createHash('sha256').update(readFileSync(join(proj, X, 'approved/r1/index.html'))).digest('hex');
  pw(`${X}/approved/r1/.deploy-ledger.json`, JSON.stringify({ '/index': { status: 'live', sha256: landed } }));
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m, 'r1 is now the last published bytes');
  // a declined later change goes back to r1, not to the opening bytes
  prun('relink-before', '--pass', X);
  writeFileSync(join(proj, 'content', 'index.html'), pr('content/index.html').replace('/visit/', '/visit/#top'));
  prun('relink-after', '--pass', X);
  assert.equal(prun('relink-restore', '--pass', X, '--files', 'index.html').code, 0);
  assert.equal(pr('content/index.html'), '<main><a href="/visit/">Visit</a></main>\n');
});

check('a shallow clone of the last checkpoint resumes: publish needs only the tracked inventory; a document whose opening blob is missing is held with the fetch that brings it', () => {
  git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'checkpoint');
  const clone = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-clone-')));
  try {
    assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${proj}`, clone]).status, 0);
    const crun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: clone, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
    assert.equal(existsSync(join(clone, X, 'opening')), false, 'no snapshot dir to need');
    const p = crun('publish', '--pass', X);
    assert.equal(p.code, 0, p.err);
    assert.equal(readFileSync(join(clone, X, 'publish.paths'), 'utf8'), '/fragments/visit-hours.html\n/visit/index.html\n');
    const st = crun('relink-status', '--pass', X);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /^held +\/team\.html — the opening commit [0-9a-f]{12} is not in this clone — `git fetch --depth 1 origin [0-9a-f]{40}`/m);
    assert.match(st.out, /^unchanged +\/index\.html/m, `a landed revision is committed with its ledger: readable from the clone\n${st.out}${st.err}`);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

rmSync(proj, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\nextend-roster: ${failed} of ${checks} checks failed` : `\nextend-roster: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
