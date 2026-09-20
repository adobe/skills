#!/usr/bin/env node
/**
 * Fixture test: deploy/scripts/localize-links.mjs — the URL map and the rewrite rules.
 * Run: node skills/deploy/scripts/test/localize-links.test.mjs   (exit 1 on failure)
 *
 *   - canonicalPath folds through stardust/scripts/da-path.mjs (T27.3): `/Über_uns.html` → `/uber-uns`,
 *     `/x/index.html` → `/x`, root stays `/`; a tree with unsafe FILE names still maps hrefs to the
 *     path DA serves (the same fold deploy-batch applies before the PUT), so the rewrite target is the
 *     delivered path, never the on-disk one;
 *   - source-host / delivery-host / root-relative hrefs resolve; query + fragment survive; mailto/tel/
 *     anchors/assets untouched; a source-host href with no local page is kept absolute and reported;
 *   - `--check` exits 2 while a link would change, 0 after the write pass; the write pass is idempotent;
 *   - T27.8: `--locale-alias en` maps `/x` → `/en/x` (both href kinds, action `aliased`) and
 *     `--append-redirects` appends the resolved aliases to the sheet once; `--unmigrated bounce`
 *     (default) rewrites a dead root-relative href to the first source host and fails `--check` until
 *     written; `--unmigrated list` leaves it, writes stardust/link-gaps.tsv and `--check` passes;
 *     a dead href with a legacy page extension (`.php`, `.aspx`) is a gap, not an asset skip.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPath, localizeHref, buildMap } from '../localize-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'localize-links.mjs');

// pure: canonicalPath = query/ext/slash/index fold, then the delivery-safe fold
assert.equal(canonicalPath('/Über_uns.html'), '/uber-uns');
assert.equal(canonicalPath('/x/index.html'), '/x');
assert.equal(canonicalPath('/x.html.html'), '/x', 'loop-strip: doubled extension (T27.6)');
assert.equal(canonicalPath('/x.htm.html?y'), '/x');
assert.equal(canonicalPath('/'), '/');
assert.equal(canonicalPath('index.html'), '/');
assert.equal(canonicalPath('/a/b/'), '/a/b');
assert.equal(canonicalPath('/A.HTML?q=1#f'), '/a');
assert.equal(canonicalPath('/日本語'), '/日本語', 'no safe form → lower-cased shape kept, never a guess');
{
  const map = new Map([['/uber-uns', '/uber-uns'], ['/old', '/new']]);
  const hosts = ['src.example'];
  assert.deepEqual(localizeHref('https://www.src.example/Über_uns.html?x=1#top', { map, hosts }), { href: '/uber-uns?x=1#top', action: 'localized', key: '/uber-uns' });
  assert.deepEqual(localizeHref('/Über_uns/', { map, hosts }), { href: '/uber-uns', action: 'normalized', key: '/uber-uns' });
  assert.equal(localizeHref('/old', { map, hosts }).href, '/new', 'a redirect pair rewrites to its destination');
  assert.equal(localizeHref('https://src.example/nowhere', { map, hosts }).action, 'kept-absolute');
  assert.equal(localizeHref('mailto:a@b.c', { map, hosts }).action, 'skip');
  assert.equal(localizeHref('/uber-uns', { map, hosts }).action, 'already');
  // a dead root-relative href with a legacy PAGE extension is a gap (bounced / listed), never an asset skip;
  // real assets and the root stay skipped
  const inv = { map, hosts, bounceHost: 'www.src.example' };
  assert.deepEqual(localizeHref('/old-page.php', inv), { href: 'https://www.src.example/old-page.php', action: 'bounced', key: '/old-page' });
  assert.equal(localizeHref('/legacy/Default.aspx?id=3', { ...inv, unmigrated: 'list' }).action, 'gap');
  assert.equal(localizeHref('/uber-uns.php', inv).action, 'normalized', 'a legacy extension on a page that exists folds to the served path');
  assert.equal(localizeHref('/img/x.png', inv).action, 'skip');
  assert.equal(localizeHref('/docs/brochure.pdf', inv).action, 'skip');
  assert.equal(localizeHref('/fonts/brand.woff2', inv).action, 'skip');
  assert.equal(localizeHref('/', inv).action, 'skip');
  // negative: a dotted PAGE path (the class Gate 3 folds) is not an asset — dead, it is bounced or listed,
  // never shipped as a silent 404 on the new origin
  assert.deepEqual(localizeHref('/about.us', inv), { href: 'https://www.src.example/about.us', action: 'bounced', key: '/about-us' });
  assert.equal(localizeHref('/news/2024.09', { ...inv, unmigrated: 'list' }).action, 'gap');
  assert.equal(localizeHref('/news/2024.09', inv).action, 'bounced');
  assert.equal(localizeHref('/about.us', { map: new Map([...map, ['/about-us', '/about-us']]), hosts, bounceHost: 'www.src.example' }).action, 'normalized', 'a dotted path whose folded page exists rewrites to the served path');
}

const dir = mkdtempSync(join(tmpdir(), 'localize-links-'));
const content = join(dir, 'content');
mkdirSync(join(content, 'en'), { recursive: true });
const w = (rel, body) => writeFileSync(join(content, rel), body);
const doc = (links) => `<body><header></header><main><div><h1>T</h1>${links.map((h) => `<p><a href="${h}">l</a></p>`).join('')}</div></main><footer></footer></body>\n`;
w('en/Über_uns.html', doc(['https://www.src.example/en/Über_uns.html', '/en/b/', '/en/index.html', 'https://src.example/en/gone', 'mailto:x@y.z', '/img/x.png']));
w('en/b.html', doc(['/en/%C3%9Cber_uns?x=1#f']));
w('en/index.html', doc(['/en/b.html']));
const run = (args) => spawnSync(process.execPath, [CLI, '--source-host', 'www.src.example', '--content', content, ...args], { encoding: 'utf8', cwd: dir });

try {
  let r = run(['--check']);
  assert.equal(r.status, 2, `links still localizable → exit 2: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /CHECK FAIL — 5 link\(s\) still localizable/);
  r = run([]);
  assert.equal(r.status, 0, r.stderr);
  const a = readFileSync(join(content, 'en/Über_uns.html'), 'utf8');
  assert.match(a, /href="\/en\/uber-uns"/, 'source-host href → the delivered (safe) path, not the on-disk name');
  assert.match(a, /href="\/en\/b"/, 'trailing slash normalized');
  assert.match(a, /href="\/en"/, '/en/index.html → /en');
  assert.match(a, /href="https:\/\/src\.example\/en\/gone"/, 'no local page → kept absolute (honest boundary)');
  assert.match(a, /href="mailto:x@y\.z"/); assert.match(a, /href="\/img\/x\.png"/, 'assets untouched');
  assert.match(r.stdout, /\/en\/gone/, 'kept-absolute target reported');
  assert.match(readFileSync(join(content, 'en/b.html'), 'utf8'), /href="\/en\/uber-uns\?x=1#f"/, 'percent-encoded root-relative href → safe path, query + fragment kept');
  r = run(['--check']);
  assert.equal(r.status, 0, `after the write pass --check is clean: ${r.stdout}`);
  assert.match(r.stdout, /CHECK PASS — 0 link\(s\) still localizable/);
  const before = readFileSync(join(content, 'en/Über_uns.html'), 'utf8');
  run([]);
  assert.equal(readFileSync(join(content, 'en/Über_uns.html'), 'utf8'), before, 'idempotent');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---- T27.8: --locale-alias / --append-redirects / --unmigrated bounce|list -------------------
const d2 = mkdtempSync(join(tmpdir(), 'localize-links-alias-'));
const c2 = join(d2, 'content');
mkdirSync(join(c2, 'en'), { recursive: true });
mkdirSync(join(d2, 'stardust'), { recursive: true });
const w2 = (rel, body) => writeFileSync(join(c2, rel), body);
const seed = () => {
  w2('en/a.html', doc(['/b', '/en/B.html', 'https://www.src.example/c', '/missing?x=1#y', '/FAQs', '/img/x.png', 'mailto:x@y.z', '#top', '/']));
  w2('en/b.html', doc([])); w2('en/faqs.html', doc([])); w2('en/c.html', doc([]));
  w2('nav.html', doc(['/a']));
};
seed();
const tsv = join(d2, 'stardust', 'redirects.tsv');
writeFileSync(tsv, '/legacy\t/en/b\n');
const gaps = join(d2, 'stardust', 'link-gaps.tsv');
const run2 = (args) => spawnSync(process.execPath, [CLI, '--source-host', 'www.src.example', '--content', c2, '--redirects', tsv, '--gaps', gaps, ...args], { encoding: 'utf8', cwd: d2 });
const read2 = (rel) => readFileSync(join(c2, rel), 'utf8');
try {
  // pure: the alias map and the inverse pass
  {
    const { map, aliases } = buildMap([join(c2, 'en/a.html'), join(c2, 'en/b.html'), join(c2, 'en/index.html'), join(c2, 'nav.html')], c2, null, ['en']);
    assert.equal(map.get('/a'), '/en/a', '/a aliases to /en/a'); assert.equal(aliases.get('/a'), '/en/a');
    assert.equal(map.get('/nav'), '/nav', 'a bare page that exists is never aliased away');
    assert.equal(map.get('/'), '/en', 'the locale home aliases the root');
    const ctx = { map, hosts: ['src.example'], aliases, unmigrated: 'bounce', bounceHost: 'www.src.example' };
    assert.equal(localizeHref('/a', ctx).action, 'aliased');
    assert.deepEqual(localizeHref('/missing?x=1#y', ctx), { href: 'https://www.src.example/missing?x=1#y', action: 'bounced', key: '/missing' });
    assert.equal(localizeHref('/missing', { ...ctx, unmigrated: 'list' }).action, 'gap');
    assert.equal(localizeHref('/img/x.png', ctx).action, 'skip', 'assets are never gaps');
    assert.equal(localizeHref('/sitemap.xml', ctx).action, 'skip');
    assert.equal(localizeHref('/query-index.json', ctx).action, 'skip');
  }
  // usage
  assert.equal(run2(['--unmigrated', 'maybe']).status, 1, 'bad --unmigrated value → exit 1');
  assert.equal(spawnSync(process.execPath, [CLI, '--source-host', 'x', '--content', c2, '--append-redirects'], { encoding: 'utf8' }).status, 1, '--append-redirects without --redirects → exit 1');
  const noHost = spawnSync(process.execPath, [CLI, '--content', c2], { encoding: 'utf8' });
  assert.equal(noHost.status, 1, 'no host at all → exit 1'); assert.match(noHost.stderr, /--source-host \(or --prod-host\) is required/, 'the refusal names both host flags');

  // (6) --prod-host only under the default bounce: dead root-relative links bounce to the prod host
  // (defect: bounceHost came from --source-host alone → every dead link booked `gap` silently, residue said "BOUNCED to https://null")
  const runProd = (args) => spawnSync(process.execPath, [CLI, '--prod-host', 'www.new.example', '--locale-alias', 'en', '--content', c2, '--redirects', tsv, '--gaps', gaps, ...args], { encoding: 'utf8', cwd: d2 });
  let rp = runProd(['--check']);
  assert.equal(rp.status, 2, `prod-host-only --check names the bounce: ${rp.stdout}`);
  assert.match(rp.stdout, /that would bounce to https:\/\/www\.new\.example/, `the residue names the prod host as the bounce target: ${rp.stdout}`);
  assert.doesNotMatch(rp.stdout, /https:\/\/null/, 'never "https://null"');
  rp = runProd([]);
  assert.equal(rp.status, 0, rp.stderr);
  assert.match(read2('en/a.html'), /href="https:\/\/www\.new\.example\/missing\?x=1#y"/, 'the dead link is bounced to the prod host, query + fragment kept');
  assert.match(rp.stdout, /BOUNCED to https:\/\/www\.new\.example/); assert.match(rp.stdout, /bounced 1 unmigrated/);
  assert.ok(!existsSync(gaps) || !/\/missing/.test(readFileSync(gaps, 'utf8')), 'bounce mode records no planned gap for the bounced link');
  seed(); // back to the seeded content for the --source-host cases below

  // (2) default bounce: pre-write --check names /missing; write pass bounces it; post-write --check clean
  let r = run2(['--locale-alias', 'en', '--check']);
  assert.equal(r.status, 2, `pre-write --check exit 2: ${r.stdout}`);
  assert.match(r.stdout, /unmigrated root-relative targets that would bounce[\s\S]*\/missing {2}\(first in \/en\/a\.html\)/, `residue names /missing under unmigrated: ${r.stdout}`);
  assert.match(r.stdout, /CHECK FAIL — \d+ link\(s\) still localizable \(1 unmigrated\)/);
  assert.equal(readFileSync(tsv, 'utf8'), '/legacy\t/en/b\n', '--check writes nothing');
  // (1) alias + append; (4) untouched shapes
  r = run2(['--locale-alias', 'en', '--append-redirects']);
  assert.equal(r.status, 0, r.stderr);
  const a = read2('en/a.html');
  assert.match(a, /href="\/en\/b"/, '/b → /en/b (aliased)');
  assert.match(a, /href="\/en\/faqs"/, '/FAQs → /en/faqs (alias + case fold)');
  assert.match(a, /href="\/en\/c"/, 'source-host /c → /en/c through the alias');
  assert.match(a, /href="https:\/\/www\.src\.example\/missing\?x=1#y"/, 'bounced to the first --source-host, query + fragment kept, never probed');
  assert.match(a, /href="\/img\/x\.png"/); assert.match(a, /href="mailto:x@y\.z"/); assert.match(a, /href="#top"/); assert.match(a, /href="\/"/, 'the root is never a gap');
  assert.match(read2('nav.html'), /href="\/en\/a"/, 'nav /a → /en/a');
  assert.match(r.stdout, /aliased 4/); assert.match(r.stdout, /bounced 1 unmigrated/);
  const rows = readFileSync(tsv, 'utf8').trim().split('\n');
  assert.deepEqual(rows, ['/legacy\t/en/b', '/a\t/en/a', '/b\t/en/b', '/c\t/en/c', '/faqs\t/en/faqs'], `resolved aliases appended once, existing row kept: ${rows}`);
  assert.match(r.stdout, /appended 4 alias row\(s\)/);
  r = run2(['--locale-alias', 'en', '--check']);
  assert.equal(r.status, 0, `post-write --check exit 0: ${r.stdout}`);
  // (5) second write run: 0 files changed, 0 rows appended
  const before = read2('en/a.html');
  r = run2(['--locale-alias', 'en', '--append-redirects']);
  assert.equal(read2('en/a.html'), before, 'idempotent');
  assert.match(r.stdout, /across 0 file\(s\)/);
  assert.equal(readFileSync(tsv, 'utf8').trim().split('\n').length, 5, 'no duplicate alias rows');

  // (3) --unmigrated list: href untouched, link-gaps.tsv written, --check passes and counts the planned gap
  seed();
  r = run2(['--locale-alias', 'en', '--unmigrated', 'list', '--check']);
  assert.equal(r.status, 2, 'aliases still pending → 2 (the gap is not what fails it)');
  r = run2(['--locale-alias', 'en', '--unmigrated', 'list']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read2('en/a.html'), /href="\/missing\?x=1#y"/, 'list: the href is left in place');
  assert.equal(readFileSync(gaps, 'utf8').split('\n')[1], '/missing\t1\t/en/a.html', 'link-gaps.tsv row: path, refs, first referrer');
  r = run2(['--locale-alias', 'en', '--unmigrated', 'list', '--check']);
  assert.equal(r.status, 0, `list: --check passes on planned gaps: ${r.stdout}`);
  assert.match(r.stdout, /1 planned gap\(s\)/);
  assert.match(r.stdout, /CHECK PASS — 0 link\(s\) still localizable · 1 planned gap\(s\)/);
  r = run2(['--locale-alias', 'en', '--unmigrated', 'list', '--json']);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.aliased, j.bounced, j.gaps, j.unmigrated, j.gapList], [0, 0, 1, 'list', [{ path: '/missing', refs: 1, first: '/en/a.html' }]], '--json carries aliased/bounced/gaps');
  console.log('localize-links test: ok (canonicalPath via da-path.mjs, safe-path targets, kept-absolute, --check 2→0, idempotent; --locale-alias, --append-redirects dedupe, --unmigrated bounce/list, gaps TSV, --json)');
} finally {
  rmSync(d2, { recursive: true, force: true });
}
