#!/usr/bin/env node
// skills/replica/scripts/test/extend-roster.test.mjs — the extend-roster.mjs contract: `select` keeps the candidates
// whose EDS destination is new (not captured, not a coverage path, not an existing content document — nav and
// fragments included), one slot per destination with a query-less url preferred so the roster replays exactly,
// --max, --named refusals (query, delivered, document) that write nothing, --slugs-out written before the roster;
// in a git project: `inventory` (tracked or ignored; the ledgers' word on each document), `publish` (new documents of
// the roster only — an owner's draft held, two claimants of one page refused, held.paths), the real localizer's
// receipts and their classes (candidate, conflict — an owner edit before or after its run —, held), restore and
// approve on candidates only, a landed revision as the last published bytes, reconcile, a resume from a shallow
// checkpoint clone, and the next pass's inventory; usage errors exit 2.
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
  for (const args of [['nope'], ['select', '--out', 'x'], ['select', '--candidates', '--out'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--max', 'two'], ['select', '--candidates', 'missing.txt', '--out', 'x'], ['publish', '--pass', 'nowhere'], ['relink-approve', '--pass', 'p'], ['reconcile', '--pass', 'nowhere'], ['relink-before', '--pass', 'p'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--state', 'missing.json']]) {
    const r = run(...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /^skills\/replica\/scripts\/extend-roster\.mjs/);
});

// ---- a pass in a git project: inventory, publish, reconcile, relink ----------------------------------------------
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-pass-')));
const git = (...a) => spawnSync('git', a, { cwd: proj, encoding: 'utf8' });
const pw = (rel, text) => { mkdirSync(dirname(join(proj, rel)), { recursive: true }); writeFileSync(join(proj, rel), text); };
const pr = (rel) => readFileSync(join(proj, rel), 'utf8');
const prun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const hash = (t) => createHash('sha256').update(t).digest('hex');
const LOCALIZE = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'localize-links.mjs');
let n = 0;
// the real localizer, with a receipt per run (the extend pass's rule); --exclude-targets the pass's held list
const localize = ({ exclude = true } = {}) => {
  n += 1;
  mkdirSync(join(proj, X, 'receipts'), { recursive: true });
  const held = join(proj, X, 'held.paths');
  const r = spawnSync(process.execPath, [LOCALIZE, '--source-host', 'src.test', '--content', 'content', '--receipt', `${X}/receipts/run-${String(n).padStart(2, '0')}.json`, ...(exclude && existsSync(held) ? ['--exclude-targets', `${X}/held.paths`] : [])], { cwd: proj, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const X = 'stardust/replica/extend/x1';
const ABOUT = '<main><p>About us.</p><a href="https://src.test/visit/">Visit</a> <a href="https://src.test/contact/">Contact</a></main>\n';
const INDEX = '<main><a href="https://src.test/visit/">Visit</a> <a href="https://src.test/draft">Draft</a></main>\n';
const TEAM = '<main><p>Team.</p><a href="https://src.test/visit/">Visit</a></main>\n';
pw('.gitignore', '/content/private-draft.html\n');
pw('content/index.html', INDEX);
pw('content/about.html', ABOUT);
pw('content/team.html', TEAM);
pw('content/nav.htm.html', '<nav>the delivered nav</nav>\n');
pw('content/old-draft.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');   // committed, never published
pw('content/private-draft.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');
// the first pass's deploy ledgers: verified digests for the pages, a pre-digest row for the nav, nothing for the drafts
pw('stardust/deploy/ledger-c1.json', JSON.stringify({
  '/index': { status: 'live', sha256: hash(INDEX), ts: '2026-11-01T00:00:00Z' },
  '/about': { status: 'live', sha256: hash(ABOUT), ts: '2026-11-01T00:00:00Z' },
  '/team': { status: 'live', sha256: hash(TEAM), ts: '2026-11-01T00:00:00Z' },
  '/nav.htm': { status: 'live', ts: '2026-11-01T00:00:00Z' },
  '/private-draft': { status: 'live', sha256: hash('an older version'), ts: '2026-11-01T00:00:00Z' },
}));
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'delivered');
pw(`${X}/base.txt`, `${git('rev-parse', 'HEAD').stdout.trim()}\n`);
pw(`${X}/urls.txt`, 'https://src.test/visit/\n');

check('inventory: every document as deploy-batch enumerates them, tracked or git-ignored, with what the ledgers say of its bytes; written once', () => {
  const r = prun('inventory', '--pass', X);
  assert.equal(r.code, 0, r.err);
  const rows = pr(`${X}/inventory.tsv`).trim().split('\n').map((l) => l.split('\t').slice(1));
  assert.deepEqual(rows, [['about.html', 'tracked', 'live'], ['index.html', 'tracked', 'live'], ['nav.htm.html', 'tracked', 'live-unverified'], ['old-draft.html', 'tracked', 'unpublished'], ['private-draft.html', 'ignored', 'differs'], ['team.html', 'tracked', 'live']]);
  assert.equal(prun('inventory', '--pass', X).code, 2, 'never rewritten');
});

check('publish: only new documents of roster pages (or also.paths); an owner\'s draft held; held.paths names every no-link-target (new drafts, never-published existing ones); two new documents for one roster page exit 2', () => {
  pw('content/visit/index.html', '<main>new visit page</main>\n');
  pw('content/draft.html', '<main>an owner draft, made during the pass</main>\n');
  pw('content/nav.htm', '<nav>not a document for deploy-batch</nav>\n');
  pw('content/fragments/visit-hours.html', '<div>hours</div>\n');
  let r = prun('publish', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/publish.paths`), '/visit/index.html\n');
  assert.equal(pr(`${X}/held.paths`), '/draft.html\n/fragments/visit-hours.html\n/old-draft.html\n/private-draft.html\n');
  assert.match(r.err, /held \/draft\.html — new, but not a page of the roster/);
  pw(`${X}/also.paths`, '/fragments/visit-hours.html\n');
  r = prun('publish', '--pass', X);
  assert.equal(pr(`${X}/publish.paths`), '/fragments/visit-hours.html\n/visit/index.html\n');
  pw('content/visit.html', '<main>a competing leaf draft</main>\n');
  const before = pr(`${X}/publish.paths`);
  r = prun('publish', '--pass', X);
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /collision \/visit — \/visit\.html and \/visit\/index\.html both claim this roster page/);
  assert.equal(pr(`${X}/publish.paths`), before, 'nothing written');
  rmSync(join(proj, 'content', 'visit.html')); rmSync(join(proj, 'content', 'nav.htm'));
  assert.equal(prun('publish', '--pass', X).code, 0);
});

check('relink: the localizer\'s receipt is the evidence — its own edit is a candidate; an owner link edit before it, or made between another run\'s read and the check, is a conflict; a held draft is no link target; a never-published or differing document is held', () => {
  // the owner changed one contact link on about.html before the pass's localizer rewrote the visit link
  pw('content/about.html', ABOUT.replace('https://src.test/contact/', 'https://src.test/contact-us/'));
  localize();
  // a concurrent cluster's localizer receipt does not cover an edit no run made: the owner edits team.html's href now
  pw('content/team.html', pr('content/team.html').replace('/visit/', '/visit/#owner'));
  const r = prun('relink-status', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^candidate +\/index\.html — links only/m);
  assert.match(r.out, /^conflict +\/about\.html — edited before the localizer ran/m);
  assert.match(r.out, /^conflict +\/team\.html — edited after the localizer ran/m);
  assert.match(r.out, /^held +\/old-draft\.html — no deploy ledger records it live: never published/m);
  assert.match(r.out, /^held +\/private-draft\.html — git-ignored/m);
  assert.match(pr('content/index.html'), /href="https:\/\/src\.test\/draft"/, 'a held draft stays a source link');
  assert.match(pr('content/index.html'), /href="\/visit\/"/);
});

check('relink-restore: a candidate gets its last published bytes back; a conflict is refused (exit 1) and kept exactly as it is', () => {
  const aboutNow = pr('content/about.html');
  const r = prun('relink-restore', '--pass', X, '--files', '/index.html,/about.html');
  assert.equal(r.code, 1, r.err);
  assert.equal(pr('content/index.html'), INDEX, 'the opening commit\'s bytes');
  assert.equal(pr('content/about.html'), aboutNow, 'the owner\'s edit stays');
  assert.match(r.err, /refused \/about\.html — conflict: edited before the localizer ran/);
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m);
});

check('relink-approve: a frozen revision; once its ledger records those bytes live they are the last published bytes; a declined later change goes back to the revision', () => {
  localize();
  const a = prun('relink-approve', '--pass', X, '--files', 'index.html');
  assert.equal(a.code, 0, `${a.err}\n${prun('relink-status', '--pass', X).out}`);
  assert.match(pr(`${X}/approved/r1/index.html`), /href="\/visit\/"/);
  assert.equal(pr(`${X}/approved/r1.paths`), '/index.html\n');
  assert.match(pr(`${X}/approved/r1.sha256`), /^[0-9a-f]{64} {2}index\.html$/m);
  assert.match(prun('relink-status', '--pass', X).out, /^candidate +\/index\.html/m, 'not landed yet');
  pw(`${X}/approved/r1/.deploy-ledger.json`, JSON.stringify({ '/index': { status: 'live', sha256: hash(pr(`${X}/approved/r1/index.html`)), ts: '2026-11-25T00:00:00Z' } }));
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m, 'r1 is now the last published bytes');
  localize({ exclude: false });   // a later run in which the draft is a target: its own edit from r1's bytes is a candidate
  assert.match(pr('content/index.html'), /href="\/draft"/);
  assert.match(prun('relink-status', '--pass', X).out, /^candidate +\/index\.html/m);
  assert.equal(prun('relink-restore', '--pass', X, '--files', 'index.html').code, 0);
  assert.equal(pr('content/index.html'), pr(`${X}/approved/r1/index.html`));
});

check('reconcile: every pass document whose bytes are not its newest verified delivery is listed for a re-drive (a page relinked after its PUT, a fragment never sent); one delivered as it is, is not', () => {
  pw('stardust/deploy/ledger-visit-x1.json', JSON.stringify({ '/visit/index': { status: 'live', sha256: hash(pr('content/visit/index.html')), ts: '2026-11-25T00:00:00Z' } }));
  let r = prun('reconcile', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/redrive.paths`), '/fragments/visit-hours.html\n', 'the fragment: no verified delivery');
  pw('content/visit/index.html', '<main>new visit page, relinked by a later cluster</main>\n');
  r = prun('reconcile', '--pass', X);
  assert.equal(pr(`${X}/redrive.paths`), '/fragments/visit-hours.html\n/visit/index.html\n');
  assert.match(r.err, /redrive \/visit\/index\.html — changed since its last verified delivery/);
});

check('a shallow clone of the last checkpoint resumes: publish and reconcile need only tracked files; a document whose opening blob is missing is held with the fetch that brings it', () => {
  git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'checkpoint');
  const clone = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-clone-')));
  try {
    assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${proj}`, clone]).status, 0);
    const crun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: clone, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
    assert.equal(crun('publish', '--pass', X).code, 0);
    assert.equal(readFileSync(join(clone, X, 'publish.paths'), 'utf8'), '/fragments/visit-hours.html\n/visit/index.html\n');
    assert.equal(crun('reconcile', '--pass', X).code, 0);
    const st = crun('relink-status', '--pass', X);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /^held +\/about\.html — the opening commit [0-9a-f]{12} is not in this clone — `git fetch --depth 1 origin [0-9a-f]{40}`/m);
    assert.match(st.out, /^unchanged +\/index\.html/m, 'a landed revision is committed with its ledger: readable from the clone');
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

check('the next pass: a document the last pass ended with as a conflict is `differs` in the new inventory — held, never a fresh baseline', () => {
  prun('relink-status', '--pass', X);   // x1's final status, kept in its relink-status.json
  const X2 = 'stardust/replica/extend/x2';
  pw(`${X2}/base.txt`, `${git('rev-parse', 'HEAD').stdout.trim()}\n`);
  assert.equal(prun('inventory', '--pass', X2).code, 0);
  const about = pr(`${X2}/inventory.tsv`).split('\n').find((l) => l.includes('\tabout.html\t'));
  assert.match(about, /\ttracked\tdiffers$/);
  const draft = pr(`${X2}/inventory.tsv`).split('\n').find((l) => l.includes('\tdraft.html\t'));
  assert.match(draft, /\tunpublished$/, 'x1\'s held draft: still never published');
});

rmSync(proj, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\nextend-roster: ${failed} of ${checks} checks failed` : `\nextend-roster: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
