#!/usr/bin/env node
// skills/replica/scripts/test/extend-roster.test.mjs — the extend-roster.mjs contract: `select` keeps the candidates
// whose EDS destination is new (not captured, not a coverage path, not an existing content document — nav and
// fragments included), one slot per destination with a query-less url preferred so the roster replays exactly,
// --max, --named refusals (query, delivered, document) that write nothing, --slugs-out written before the roster;
// in a git project: `inventory` (tracked or ignored; the ledgers' word on each document), `output` (a unit's exact
// files), `publish` (outputs and also.paths only — a draft at a failed roster page, a competing leaf and an owner draft
// held; targets.paths), the real localizer's receipts and their classes (candidate, conflict, held — a pre-digest row
// included), an interrupted run's record, guarded restore, approve on candidates only, a landed revision as the last
// published bytes, reconcile, the library's `published` tree, a resume from a shallow checkpoint clone, and the next
// pass's inventory; /library destinations; usage errors exit 2.
// Run: node plugins/stardust/skills/replica/scripts/test/extend-roster.test.mjs   (under 1 s)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinationOf, guardedRestore, selectRoster } from '../extend-roster.mjs';

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

await check('usage: unknown command, missing or flag-shaped value, bad --max, unreadable input exit 2 with one line; --help exits 0', () => {
  for (const args of [['nope'], ['select', '--out', 'x'], ['select', '--candidates', '--out'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--max', 'two'], ['select', '--candidates', 'missing.txt', '--out', 'x'], ['publish', '--pass', 'nowhere'], ['relink-approve', '--pass', 'p'], ['reconcile', '--pass', 'nowhere'], ['relink-before', '--pass', 'p'], ['output', '--pass', 'p'], ['published', '--pass', 'p'], ['select', '--candidates', 'cand.txt', '--out', 'x', '--state', 'missing.json']]) {
    const r = run(...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /^skills\/replica\/scripts\/extend-roster\.mjs/);
});

// ---- a pass in a git project: inventory, output, publish, reconcile, relink, published ---------------------------
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'extend-roster-pass-')));
const git = (...a) => spawnSync('git', a, { cwd: proj, encoding: 'utf8' });
const pw = (rel, text) => { mkdirSync(dirname(join(proj, rel)), { recursive: true }); writeFileSync(join(proj, rel), text); };
const pr = (rel) => readFileSync(join(proj, rel), 'utf8');
const prun = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const hash = (t) => createHash('sha256').update(t).digest('hex');
const LOCALIZE = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'localize-links.mjs');
let n = 0;
// the real localizer, with a receipt per run (the extend pass's rule) and --targets the pass's targets.paths
const localize = ({ targets = true } = {}) => {
  n += 1;
  const t = join(proj, X, 'targets.paths');
  const r = spawnSync(process.execPath, [LOCALIZE, '--source-host', 'src.test', '--content', 'content', '--receipt', `${X}/receipts/run-${String(n).padStart(2, '0')}.json`, ...(targets && existsSync(t) ? ['--targets', `${X}/targets.paths`] : [])], { cwd: proj, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const X = 'stardust/replica/extend/x1';
const ABOUT = '<main><p>About us.</p><a href="https://src.test/visit/">Visit</a> <a href="https://src.test/contact/">Contact</a></main>\n';
const INDEX = '<main><a href="https://src.test/visit/">Visit</a> <a href="https://src.test/draft">Draft</a></main>\n';
const TEAM = '<main><p>Team.</p><a href="https://src.test/visit/">Visit</a></main>\n';
const NAV = '<nav><a href="https://src.test/visit/">Visit</a> the delivered nav</nav>\n';
pw('.gitignore', '/content/private-draft.html\n');
pw('content/index.html', INDEX);
pw('content/about.html', ABOUT);
pw('content/team.html', TEAM);
pw('content/nav.htm.html', NAV);
pw('content/old-draft.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');   // committed, never published
pw('content/private-draft.html', '<main><a href="https://src.test/visit/">Visit</a></main>\n');
// the first pass's deploy ledgers: verified digests for the pages, a pre-digest row for the nav, nothing for the drafts
pw('stardust/deploy/ledger-c1.json', JSON.stringify({
  '/index': { status: 'live', sha256: hash(INDEX), ts: '2026-11-01T00:00:00Z' },
  '/about': { status: 'live', sha256: hash(ABOUT), ts: '2026-11-01T00:00:00Z' },
  '/team': { status: 'live', sha256: hash(TEAM), ts: '2026-11-01T00:00:00Z' },
  '/nav.htm': { status: 'live', ts: '2026-11-01T00:00:00Z' },
  '/private-draft': { status: 'live', sha256: hash('an older version'), ts: '2026-11-01T00:00:00Z' },
  '/nav': { status: 'live', sha256: hash('<nav>live, its file git-ignored</nav>'), ts: '2026-11-01T00:00:00Z' },   // no file in this checkout
}));
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'delivered');
pw(`${X}/base.txt`, `${git('rev-parse', 'HEAD').stdout.trim()}\n`);
pw(`${X}/urls.txt`, 'https://src.test/visit/\nhttps://src.test/missing/\nhttps://src.test/nav/\n');

await check('inventory: every document as deploy-batch enumerates them, tracked or git-ignored, with what the ledgers say of its bytes; written once', () => {
  const r = prun('inventory', '--pass', X);
  assert.equal(r.code, 0, r.err);
  const rows = pr(`${X}/inventory.tsv`).trim().split('\n').map((l) => l.split('\t').slice(1));
  assert.deepEqual(rows, [['about.html', 'tracked', 'live'], ['index.html', 'tracked', 'live'], ['nav.htm.html', 'tracked', 'live-unverified'], ['old-draft.html', 'tracked', 'unpublished'], ['private-draft.html', 'ignored', 'differs'], ['team.html', 'tracked', 'live']]);
  assert.equal(pr(`${X}/reserved.paths`), '/about\n/index\n/nav\n/nav.htm\n/private-draft\n/team\n', 'every live DA document, its file here or not');
  assert.equal(prun('inventory', '--pass', X).code, 2, 'never rewritten');
});

await check('a DA document a ledger records live is reserved though its file is not in the checkout (an ignored nav): select --named refuses it; output and publish refuse a new file there', () => {
  pw('cand-nav.txt', 'https://src.test/nav.html\n');
  pw('stardust/state.json', JSON.stringify({ site: { originUrl: 'https://src.test/' }, pages: [] }));
  pw('stardust/rollout/coverage/pages.json', JSON.stringify({ pages: [] }));
  const sel = prun('select', '--candidates', 'cand-nav.txt', '--out', 'roster-nav.txt', '--named');
  assert.equal(sel.code, 2, sel.err); assert.match(sel.err, /refused https:\/\/src\.test\/nav\.html — delivered at \/nav/);
  pw('content/nav.html', '<nav>a pass render over the live nav</nav>\n');
  const out = prun('output', '--pass', X, '--unit', 'c-nav', '--files', 'nav.html');
  assert.equal(out.code, 2); assert.match(out.err, /refused \/nav\.html — a deploy ledger records \/nav or its destination live/);
  pw(`${X}/also.paths`, '/nav.html\n');
  const pub = prun('publish', '--pass', X);
  assert.equal(pub.code, 2); assert.match(pub.err, /refused \/nav\.html — a deploy ledger records \/nav/);
  rmSync(join(proj, `${X}/also.paths`)); rmSync(join(proj, 'content', 'nav.html'));
  for (const f of ['cand-nav.txt', 'stardust/state.json', 'stardust/rollout/coverage/pages.json']) rmSync(join(proj, f));
});

await check('output: a unit records the exact file of a roster page; an opening document, a non-roster file, a second file for one page are refused (exit 2, nothing written)', () => {
  pw('content/visit/index.html', '<main>new visit page</main>\n');
  pw('content/visit.html', '<main>a competing leaf draft</main>\n');
  pw('content/fragments/visit-hours.html', '<div>hours</div>\n');
  assert.equal(prun('output', '--pass', X, '--unit', 'c-visit', '--files', 'visit/index.html').code, 0);
  assert.equal(pr(`${X}/outputs/c-visit.paths`), '/visit/index.html\n');
  for (const [f, why] of [['visit.html', /roster page \/visit already has its output \/visit\/index\.html \(unit c-visit\)/], ['about.html', /existed at the opening/], ['fragments/visit-hours.html', /not a roster page \(a fragment the pages need goes in also\.paths\)/], ['visit/Index.HTML', /not a document/]]) {
    const r = prun('output', '--pass', X, '--unit', 'c-other', '--files', f);
    assert.equal(r.code, 2, f); assert.match(r.err, why);
  }
  assert.equal(existsSync(join(proj, X, 'outputs', 'c-other.paths')), false);
  assert.equal(prun('output', '--pass', X, '--unit', '../escape', '--files', 'visit/index.html').code, 2, 'a unit name is a file name, never a path');
});

await check('output: concurrent units never lose each other\'s records — 12 writers at once, every page published', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://src.test/many-${i}/`);
  pw(`${X}/urls.txt`, `${pr(`${X}/urls.txt`)}${urls.join('\n')}\n`);
  for (let i = 0; i < 12; i += 1) pw(`content/many-${i}/index.html`, `<main>${i}</main>\n`);
  const runs = Array.from({ length: 12 }, (_, i) => new Promise((done) => {
    const c = spawn(process.execPath, [SCRIPT, 'output', '--pass', X, '--unit', `c-many-${i}`, '--files', `many-${i}/index.html`], { cwd: proj });
    c.on('close', done);
  }));
  assert.deepEqual(await Promise.all(runs), Array(12).fill(0));
  assert.equal(prun('publish', '--pass', X).code, 0);
  const listed = pr(`${X}/publish.paths`).split('\n').filter((l) => l.startsWith('/many-'));
  assert.equal(listed.length, 12);
  for (let i = 0; i < 12; i += 1) { rmSync(join(proj, 'content', `many-${i}`), { recursive: true }); rmSync(join(proj, X, 'outputs', `c-many-${i}.paths`)); }
  pw(`${X}/urls.txt`, 'https://src.test/visit/\nhttps://src.test/missing/\nhttps://src.test/nav/\n');
});

await check('publish: the recorded outputs and also.paths only — a draft at a roster page whose capture failed, a competing leaf and an owner draft are held; targets.paths = documents with a live row + the publish list', () => {
  pw('content/missing.html', '<main>an owner draft at a roster page nothing rendered</main>\n');
  pw('content/draft.html', '<main>an owner draft, made during the pass</main>\n');
  pw('content/nav.htm', '<nav>not a document for deploy-batch</nav>\n');
  let r = prun('publish', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/publish.paths`), '/visit/index.html\n');
  assert.match(r.err, /held \/missing\.html — no unit recorded it as the output of roster page \/missing/);
  assert.match(r.err, /held \/visit\.html — roster page \/visit has its output \/visit\/index\.html/);
  assert.match(r.err, /held \/draft\.html — new, neither a unit's output nor in also\.paths/);
  assert.equal(pr(`${X}/targets.paths`), '/about.html\n/index.html\n/nav.htm.html\n/private-draft.html\n/team.html\n/visit/index.html\n');
  pw(`${X}/also.paths`, '/fragments/visit-hours.html\n');
  r = prun('publish', '--pass', X);
  assert.equal(pr(`${X}/publish.paths`), '/fragments/visit-hours.html\n/visit/index.html\n');
  pw(`${X}/also.paths`, '/fragments/visit-hours.html\n/about.html\n');
  r = prun('publish', '--pass', X);
  assert.equal(r.code, 2); assert.match(r.err, /refused \/about\.html — existed at the opening/);
  assert.equal(pr(`${X}/publish.paths`), '/fragments/visit-hours.html\n/visit/index.html\n', 'nothing written');
  pw(`${X}/also.paths`, '/fragments/visit-hours.html\n');
  rmSync(join(proj, 'content', 'visit.html')); rmSync(join(proj, 'content', 'nav.htm')); rmSync(join(proj, 'content', 'missing.html'));
  assert.equal(prun('publish', '--pass', X).code, 0);
});

await check('relink: the localizer\'s receipt is the evidence — its own edit is a candidate; an owner edit before or after it a conflict; a held draft is no link target; never published, a pre-digest live row, git-ignored are held', () => {
  pw('content/about.html', ABOUT.replace('https://src.test/contact/', 'https://src.test/contact-us/'));
  localize();
  pw('content/team.html', pr('content/team.html').replace('/visit/', '/visit/#owner'));
  const r = prun('relink-status', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^candidate +\/index\.html — links only/m);
  assert.match(r.out, /^conflict +\/about\.html — edited before the localizer ran/m);
  assert.match(r.out, /^conflict +\/team\.html — edited after the localizer ran/m);
  assert.match(r.out, /^held +\/old-draft\.html — no deploy ledger records it live: never published/m);
  assert.match(r.out, /^held +\/nav\.htm\.html — its newest live row has no digest/m);
  assert.match(r.out, /^held +\/private-draft\.html — git-ignored/m);
  assert.match(pr('content/index.html'), /href="https:\/\/src\.test\/draft"/, 'a held draft stays a source link');
  assert.match(pr('content/index.html'), /href="\/visit\/"/);
});

await check('relink-restore: a candidate gets its last published bytes back; a conflict is refused (exit 1) and kept exactly as it is', () => {
  const aboutNow = pr('content/about.html');
  const r = prun('relink-restore', '--pass', X, '--files', '/index.html,/about.html');
  assert.equal(r.code, 1, r.err);
  assert.equal(pr('content/index.html'), INDEX, 'the opening commit\'s bytes');
  assert.equal(pr('content/about.html'), aboutNow, 'the owner\'s edit stays');
  assert.match(r.err, /refused \/about\.html — conflict: edited before the localizer ran/);
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m);
});

await check('guardedRestore: a file saved after it was classified is never overwritten — the newer bytes stay and the reason is returned', () => {
  const f = join(proj, 'scratch.html');
  writeFileSync(f, 'classified');
  writeFileSync(f, 'saved by the owner since');
  assert.match(guardedRestore(f, hash('classified'), Buffer.from('published')), /changed since it was classified — left as it is/);
  assert.equal(readFileSync(f, 'utf8'), 'saved by the owner since');
  assert.equal(guardedRestore(f, hash('saved by the owner since'), Buffer.from('published')), null);
  assert.equal(readFileSync(f, 'utf8'), 'published');
  rmSync(f);
});

await check('guardedRestore: a failure other than a concurrent save (EPERM on the link) puts the original back and names the error — never an empty directory', () => {
  const f = join(proj, 'scratch2.html');
  writeFileSync(f, 'classified');
  const fsx = { renameSync, rmSync, writeFileSync, readFileSync, linkSync: (a, b) => { if (a.includes('.restore-')) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); return linkSync(a, b); } };
  const why = guardedRestore(f, hash('classified'), Buffer.from('published'), fsx);
  assert.match(why, /restoring failed \(EPERM\)/);
  assert.equal(readFileSync(f, 'utf8'), 'classified', 'the original is back in place');
  assert.deepEqual(readdirSync(proj).filter((n) => n.startsWith('scratch2.html.')), [], 'no temporary left');
  rmSync(f);
});

await check('a receipt whose run was interrupted before reaching a file does not count for it', () => {
  mkdirSync(join(proj, X, 'receipts'), { recursive: true });
  pw(`${X}/receipts/run-00-interrupted.json`, JSON.stringify({ tool: 'localize-links', at: '2026-11-25T23:59:59Z', files: { '/index.html': { input: hash(INDEX), output: hash('never written') } } }));
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m);
  rmSync(join(proj, X, 'receipts', 'run-00-interrupted.json'));
});

await check('relink-approve: the bytes classified are frozen; once its ledger records them live they are the last published bytes; a later run of the localizer is a candidate again', () => {
  localize();
  const a = prun('relink-approve', '--pass', X, '--files', 'index.html');
  assert.equal(a.code, 0, a.err);
  assert.match(pr(`${X}/approved/r1/index.html`), /href="\/visit\/"/);
  assert.equal(pr(`${X}/approved/r1.paths`), '/index.html\n');
  assert.match(pr(`${X}/approved/r1.sha256`), /^[0-9a-f]{64} {2}index\.html$/m);
  assert.match(prun('relink-status', '--pass', X).out, /^candidate +\/index\.html/m, 'not landed yet');
  pw(`${X}/approved/r1/.deploy-ledger.json`, JSON.stringify({ '/index': { status: 'live', sha256: hash(pr(`${X}/approved/r1/index.html`)), ts: '2026-11-25T00:00:00Z' } }));
  assert.match(prun('relink-status', '--pass', X).out, /^unchanged +\/index\.html/m, 'r1 is now the last published bytes');
  localize({ targets: false });   // a later run in which the draft is a target: its own edit from r1's bytes is a candidate
  assert.match(pr('content/index.html'), /href="\/draft"/);
  assert.match(prun('relink-status', '--pass', X).out, /^candidate +\/index\.html/m);
  assert.equal(prun('relink-restore', '--pass', X, '--files', 'index.html').code, 0);
  assert.equal(pr('content/index.html'), pr(`${X}/approved/r1/index.html`));
});

await check('reconcile: every pass document whose bytes are not its newest verified delivery is listed for a re-drive (a page relinked after its PUT, a fragment never sent); one delivered as it is, is not', () => {
  pw('stardust/deploy/ledger-visit-x1.json', JSON.stringify({ '/visit/index': { status: 'live', sha256: hash(pr('content/visit/index.html')), ts: '2026-11-25T00:00:00Z' } }));
  let r = prun('reconcile', '--pass', X);
  assert.equal(r.code, 0, r.err);
  assert.equal(pr(`${X}/redrive.paths`), '/fragments/visit-hours.html\n', 'the fragment: no verified delivery');
  pw('content/visit/index.html', '<main>new visit page, relinked by a later cluster</main>\n');
  r = prun('reconcile', '--pass', X);
  assert.equal(pr(`${X}/redrive.paths`), '/fragments/visit-hours.html\n/visit/index.html\n');
  assert.match(r.err, /redrive \/visit\/index\.html — changed since its last verified delivery/);
});

await check('published: the library\'s input holds each document at bytes known delivered — a conflicted page at its published bytes, never its working file; the rest withheld and named', () => {
  const out = join(proj, X, 'library-src');
  const r = prun('published', '--pass', X, '--out', `${X}/library-src`);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(out, 'about.html'), 'utf8'), ABOUT, 'the opening (published) bytes, not the owner\'s withheld edit');
  assert.equal(readFileSync(join(out, 'team.html'), 'utf8'), TEAM);
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), pr(`${X}/approved/r1/index.html`), 'the landed revision');
  for (const f of ['nav.htm.html', 'old-draft.html', 'draft.html', 'visit/index.html', 'fragments/visit-hours.html']) assert.ok(!existsSync(join(out, f)), f);
  assert.match(r.err, /withheld \/nav\.htm\.html — its newest live row has no digest/);
  assert.match(r.err, /withheld \/visit\/index\.html — DA holds the version [0-9a-f]{12}, whose bytes are in no commit here/);
  assert.equal(prun('published', '--pass', X, '--out', `${X}/library-src`).code, 2, 'a new dir per refresh');
  rmSync(out, { recursive: true });
  // a newer live row without a digest outranks an older verified one: the version live is unknown, so team is withheld
  pw('stardust/deploy/ledger-legacy-redeploy.json', JSON.stringify({ '/team': { status: 'live', ts: '2026-11-20T00:00:00Z' } }));
  const r2 = prun('published', '--pass', X, '--out', `${X}/library-src`);
  assert.ok(!existsSync(join(out, 'team.html'))); assert.match(r2.err, /withheld \/team\.html — its newest live row has no digest/);
  rmSync(out, { recursive: true }); rmSync(join(proj, 'stardust/deploy/ledger-legacy-redeploy.json'));
});

await check('a shallow clone of the last checkpoint resumes: publish and reconcile need only tracked files; a document whose opening blob is missing is held with the fetch that brings it', () => {
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

await check('the next pass: a published document the last pass ended with as a conflict is `differs` — held, never a fresh baseline; a draft it held is still `unpublished`', () => {
  prun('relink-status', '--pass', X);
  const X2 = 'stardust/replica/extend/x2';
  pw(`${X2}/base.txt`, `${git('rev-parse', 'HEAD').stdout.trim()}\n`);
  assert.equal(prun('inventory', '--pass', X2).code, 0);
  const row = (f) => pr(`${X2}/inventory.tsv`).split('\n').find((l) => l.includes(`\t${f}\t`));
  assert.match(row('about.html'), /\ttracked\tdiffers$/);
  assert.match(row('old-draft.html'), /\tunpublished$/, 'held in x1 and never published: still a draft, not `differs`');
  assert.match(row('draft.html'), /\tunpublished$/);
  // x1's landed approved revision is the live version in x2 too, though the working file moved on
  pw('content/index.html', '<main>an owner edit after x1</main>\n');
  const out = join(proj, X2, 'library-src');
  assert.equal(prun('published', '--pass', X2, '--out', `${X2}/library-src`).code, 0);
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), pr(`${X}/approved/r1/index.html`), 'found under x1/approved/');
  assert.equal(readFileSync(join(out, 'about.html'), 'utf8'), ABOUT, 'x1\'s opening blob is what DA holds');
});

rmSync(proj, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\nextend-roster: ${failed} of ${checks} checks failed` : `\nextend-roster: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
