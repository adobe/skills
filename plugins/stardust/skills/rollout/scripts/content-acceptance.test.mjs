#!/usr/bin/env node
// Fixture test: rollout/scripts/content-acceptance.mjs — the offline content-count gate.
//
//   pass          same inventory inside <main> → exit 0, record verdict pass, `content-count`
//                 appended to _meta.json#gatesPassed[] once (idempotent)
//   dropped       a dropped h2 / a dropped link / a lost image / fewer list items → 🔴, exit 2,
//                 _meta.json untouched; nav/footer links OUTSIDE main never count
//   words         ratio < 0.9 → 🔴 (the one new class); ratio > 1.1 → 🟡 advisory, exit 0
//   covered       a contentDeviations[] entry whose source matches the dropped item → covered,
//                 exit 0, record lists it under covered[] (never a silent pass)
//   tolerance     --tolerance links=0.5 lets the drop through and is echoed in the record + stdout;
//                 an unknown class / out-of-range value is exit 2 (usage)
//   report-only   --report-only: record written, exit 0 on a 🔴, gatesPassed NOT written
//   zero-row      an empty target <main> → every class dropped + words ratio 0 → 🔴
//   skipped       a compiler record with skipped[] fails on a class not in --skipped-allow
//   unmeasured    missing source sidecar → exit 1, verdict unmeasured (never pass, never FAIL);
//                 --help exit 0; no --slug/--all exit 2 (usage, USAGE on stderr)
//   usage         exit 2 is the rollout-family usage code (open-review-pairs, query-index, verify): a swallowed value flag
//                 (`--slug --all`), a bad --class / --tolerance, no --slug/--all → 2 + USAGE, so a driver mapping exit 1
//                 to "unmeasured, re-run" (wave.mjs Gate 7) parks a misconfigured command instead of looping (NEGATIVE: 1 before)
//   scoping       --source-main / --source-exclude scope the source side and are recorded
//   normKey       identical to content-inventory.mjs norm(): quotes, dashes, arrows, case, trailing punctuation
//   structure     (T26.3 Gate B) fail-list-depth: same li count, a 3-level list flattened to one → 🔴 listDepth +
//                 nestedLists; fail-table-count: two source tables, one emitted → 🔴 tables (tr count kept);
//                 pass-nested: depth preserved → exit 0; --class notes=<src>=<tgt> pairs an admonition
//                 selector with the target shape (recorded; a bad value is exit 2)
//   contact       a dropped mailto:/tel: link is a links drop (keyed by scheme + value); a bare `#` anchor is not
//
// Usage: node plugins/stardust/skills/rollout/scripts/content-acceptance.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normKey, inventory, compare, judge } from './content-acceptance.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, 'content-acceptance.mjs');
const T = mkdtempSync(join(tmpdir(), 'content-acceptance-test-'));
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', cwd: T });

// normKey parity with content-inventory.mjs norm() — both copies' `norm` bodies are lifted from the source files and
// evaluated over a corpus (the copies are not exported; a drift in either fails here, not silently in the gate)
{
  const corpus = ['“Read more” → Plans…', 'Auto – Home — Life!', '  Get a Quote › ', 'FAQs: what’s covered?', 'Save 20%·', 'Storm » Fire ⇒ Theft', 'Life  insurance;', 'Contact  us…  ', 'Renters’ cover', '"Quoted" — “curly”'];
  for (const copy of ['diff', 'deploy']) {
    const src = readFileSync(join(HERE, '..', '..', copy, 'scripts', 'content-inventory.mjs'), 'utf8');
    const start = src.indexOf('const ARROWS = '); const normAt = src.indexOf('const norm = (s) =>', start); const end = src.indexOf('.trim();', normAt) + '.trim();'.length;
    assert.ok(start !== -1 && normAt !== -1 && end > normAt, `${copy}/content-inventory.mjs: norm() body found`);
    const arrows = src.slice(start, src.indexOf('\n', start));
    const body = src.slice(normAt, end);
    const norm = new Function(`${arrows} const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim(); ${body} return norm;`)();
    for (const t of corpus) assert.equal(norm(t), normKey(t), `${copy} norm("${t}") === normKey`);
  }
}
// normKey parity with content-inventory.mjs norm()
assert.equal(normKey('“Read more” → Plans…'), '"read more" plans', 'trailing punctuation (incl. the … → ... expansion) is stripped, as in content-inventory norm()');
assert.equal(normKey('Auto – Home — Life!'), 'auto - home - life');
assert.equal(normKey('  Get a Quote › '), 'get a quote');

const SRC_BODY = `
<header><nav><a href="/">Home</a><a href="/claims/">Claims</a><a href="/members/login/">Log in</a></nav></header>
<main>
  <h1>Home insurance</h1>
  <p>Cover for the house, the garage and everything in them. Storm, fire, theft and liability, one policy, ${'plain words '.repeat(40)}</p>
  <h2>What is covered</h2>
  <ul><li>Storm damage</li><li>Fire</li><li>Theft</li></ul>
  <img src="https://cdn.example/img/house-hero.jpg?wid=1200" alt="">
  <img src="/img/agent.png" alt="">
  <h2>Get a quote</h2>
  <p><a href="/quote/">Start your quote</a> or <a href="https://www.example.example/agents/">find an agent</a></p>
  <table><tr><td>a</td></tr><tr><td>b</td></tr></table>
</main>
<footer><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></footer>`;
const SRC = `<html><body>${SRC_BODY}</body></html>`;
const TGT_OK = `<html><body><main>
  <div class="hero"><div><div><h1>Home insurance</h1><p>Cover for the house, the garage and everything in them. Storm, fire, theft and liability, one policy, ${'plain words '.repeat(40)}</p></div></div></div>
  <div class="section-metadata"><div><div>style</div><div>tinted</div></div></div>
  <h2>What is covered</h2><ul><li>Storm damage</li><li>Fire</li><li>Theft</li></ul>
  <p><picture><img src="./media_abc.jpg#house-hero.jpg" alt=""></picture></p><p><img src="/img/agent.png"></p>
  <h2>Get a quote</h2><p><a href="/quote">Start your quote</a> or <a href="/agents">find an agent</a></p>
  <table><tr><td>a</td></tr><tr><td>b</td></tr></table>
  <div class="metadata"><div><div>title</div><div>Home insurance</div></div></div>
</main></body></html>`;

// pure inventory: chrome outside main is not counted; metadata blocks are excluded on the target
const si = inventory(SRC); const ti = inventory(TGT_OK, { exclude: ['.metadata', '.section-metadata'] });
assert.equal(Object.keys(si.links).length, 2, 'nav + footer links outside <main> never count');
assert.equal(si.listItems, 3); assert.equal(si.tableRows, 2); assert.equal(Object.keys(si.images).length, 2);
assert.deepEqual(si.headingLevels, { h1: 1, h2: 2 });
assert.equal(ti.headings['h2:what is covered'], 1);
assert.ok(!Object.keys(ti.headings).some((k) => /style|title/.test(k)), 'metadata cells are not headings/words');
const cmpOk = compare(si, ti);
assert.equal(cmpOk.links.dropped.length, 0, 'link keys are text + path: host and trailing slash never differ');
assert.equal(cmpOk.images.dropped.length, 0, 'images compare by count — the media_<hash> rename is not a drop');

// ---- project layout: state.json + current/pages + migrated ----
const w = (p, s) => { mkdirSync(join(T, p, '..'), { recursive: true }); writeFileSync(join(T, p), s); };
const page = (slug, out) => ({ slug, url: `https://www.example.example/${slug}/`, type: 'program', status: 'migrated', currentStatePath: `stardust/current/pages/${slug}.json` });
const state = { flow: 'replica', pages: ['ok', 'drop-h2', 'drop-link', 'drop-img', 'drop-li', 'words-low', 'words-high', 'covered', 'zero', 'nosource', 'skipped', 'fail-list-depth', 'fail-table-count', 'pass-nested', 'drop-note', 'drop-mailto'].map((s) => page(s)), migrate: { outputDir: 'stardust/migrated/', pageMap: [] } };
const addPage = (slug, srcHtml, tgtHtml, meta = {}) => {
  state.migrate.pageMap.push({ sourceUrl: `/${slug}/`, outputPath: `${slug}/index.html`, slug });
  w(`stardust/current/pages/${slug}.json`, JSON.stringify({ slug, renderedHtml: `pages/${slug}.html` }));
  if (srcHtml !== null) w(`stardust/current/pages/${slug}.html`, srcHtml);
  w(`stardust/migrated/${slug}/index.html`, tgtHtml);
  w(`stardust/migrated/${slug}/_meta.json`, JSON.stringify({ slug, type: 'program', fidelityTier: 'sibling', gatesPassed: ['delivery-lint'], deviations: [], ...meta }, null, 2));
};
addPage('ok', SRC, TGT_OK);
addPage('drop-h2', SRC, TGT_OK.replace('<h2>Get a quote</h2>', ''));
addPage('drop-link', SRC, TGT_OK.replace('<a href="/quote">Start your quote</a> or ', ''));
addPage('drop-img', SRC, TGT_OK.replace('<p><img src="/img/agent.png"></p>', ''));
addPage('drop-li', SRC, TGT_OK.replace('<li>Theft</li>', ''));
addPage('words-low', SRC, TGT_OK.replace(`${'plain words '.repeat(40)}`, ''));
addPage('words-high', SRC, TGT_OK.replace('</main>', `<p>${'extra copy '.repeat(60)}</p></main>`));
addPage('covered', SRC, TGT_OK.replace('<a href="/quote">Start your quote</a> or ', ''), { contentDeviations: [{ kind: 'dynamic-dependency', source: 'Start your quote', target: null, reason: 'quote CTA is the dynamics form (owner decision D-03)' }] });
addPage('zero', SRC, '<html><body><main><div class="cards"><div><div></div></div></div></main></body></html>');
addPage('nosource', null, TGT_OK);
// structure (T26.3 Gate B): a 3-level list + 2 tables + 2 admonitions on the source
const NESTED = '<ul><li>Cover<ul><li>Storm<ul><li>Hail</li></ul></li><li>Fire</li></ul></li><li>Theft</li></ul>';
const FLAT = '<ul><li>Cover</li><li>Storm</li><li>Hail</li><li>Fire</li><li>Theft</li></ul>';
const SRC_STRUCT = SRC.replace('<ul><li>Storm damage</li><li>Fire</li><li>Theft</li></ul>', `${NESTED}<div class="callout"><p>Note one</p></div><div class="callout"><p>Note two</p></div>`).replace('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>', '<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>');
const TGT_STRUCT = (list, tables, notes) => TGT_OK.replace('<ul><li>Storm damage</li><li>Fire</li><li>Theft</li></ul>', `${list}${notes}`).replace('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>', tables);
const TWO_TABLES = '<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>';
const TWO_NOTES = '<div class="note"><div><div>Note one</div></div></div><div class="note"><div><div>Note two</div></div></div>';
addPage('fail-list-depth', SRC_STRUCT, TGT_STRUCT(FLAT, TWO_TABLES, TWO_NOTES));
addPage('fail-table-count', SRC_STRUCT, TGT_STRUCT(NESTED, '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>', TWO_NOTES));
addPage('pass-nested', SRC_STRUCT, TGT_STRUCT(NESTED, TWO_TABLES, TWO_NOTES));
addPage('drop-note', SRC_STRUCT, TGT_STRUCT(NESTED, TWO_TABLES, '<div class="note"><div><div>Note one</div></div></div>'));
// contact links: mailto/tel count; a bare # anchor never does
addPage('drop-mailto', SRC.replace('<h2>Get a quote</h2>', '<h2>Get a quote</h2><p><a href="mailto:hello@example.example">Email us</a> <a href="tel:+1 (800) 555-0100">Call</a> <a href="#top">Top</a></p>'), TGT_OK.replace('<h2>Get a quote</h2>', '<h2>Get a quote</h2><p><a href="tel:+18005550100">Call</a></p>'));
addPage('skipped', SRC, TGT_OK);
w('stardust/state.json', JSON.stringify(state, null, 2));
mkdirSync(join(T, 'stardust', 'migrated', '_acceptance'), { recursive: true });
writeFileSync(join(T, 'stardust', 'migrated', '_acceptance', 'skipped.json'), JSON.stringify({ slug: 'skipped', skipped: ['tableRows'], writtenBy: 'compiler' }));

// pass → gatesPassed written once
let r = run('--slug', 'ok');
assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
assert.match(r.stdout, /✓ ok: pass — gatesPassed \+= content-count/);
let meta = json(join(T, 'stardust', 'migrated', 'ok', '_meta.json'));
assert.deepEqual(meta.gatesPassed, ['delivery-lint', 'content-count']);
run('--slug', 'ok'); assert.deepEqual(json(join(T, 'stardust', 'migrated', 'ok', '_meta.json')).gatesPassed, ['delivery-lint', 'content-count'], 'idempotent');
let rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'ok.json'));
assert.equal(rec.verdict, 'pass'); assert.equal(rec.class.links.source, 2); assert.equal(rec.words.ratio >= 0.9 && rec.words.ratio <= 1.1, true); assert.equal(rec.sourceScoped, true);
// drops → 🔴 exit 2, _meta untouched
for (const [slug, cls] of [['drop-h2', 'headings'], ['drop-link', 'links'], ['drop-img', 'images'], ['drop-li', 'listItems']]) {
  r = run('--slug', slug);
  assert.equal(r.status, 2, `${slug}: ${r.stdout}`);
  assert.match(r.stdout, new RegExp(`🔴 ${slug}: fail — ${cls}:`));
  assert.deepEqual(json(join(T, 'stardust', 'migrated', slug, '_meta.json')).gatesPassed, ['delivery-lint'], `${slug}: gatesPassed untouched on a FAIL`);
  assert.equal(json(join(T, 'stardust', 'migrated', '_acceptance', `${slug}.json`)).red[0].class, cls);
}
// structure (T26.3 Gate B) — NEGATIVE: before the counters the flattened list passed on its li count alone
{ const si2 = inventory(SRC_STRUCT); assert.equal(si2.listDepth, 3); assert.equal(si2.nestedLists, 2); assert.equal(si2.tables, 2); assert.equal(si2.listItems, 5, 'the li count is the same on both sides of fail-list-depth'); }
r = run('--slug', 'fail-list-depth'); assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, /listDepth: 3 → 1 \(2 dropped\)/); assert.match(r.stdout, /nestedLists: 2 → 0/);
rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'fail-list-depth.json')); assert.equal(rec.class.listItems.dropped.length, 0, 'li count kept'); assert.deepEqual(rec.red.map((x) => x.class), ['listDepth', 'nestedLists']);
r = run('--slug', 'fail-table-count'); assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, /tables: 2 → 1 \(1 dropped\)/); assert.equal(json(join(T, 'stardust', 'migrated', '_acceptance', 'fail-table-count.json')).class.tableRows.dropped.length, 0, 'tr count kept');
r = run('--slug', 'pass-nested'); assert.equal(r.status, 0, r.stdout); rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'pass-nested.json')); assert.equal(rec.class.listDepth.emitted, 3); assert.equal(rec.class.tables.emitted, 2); assert.equal(rec.class.notes, undefined, 'notes is opt-in');
r = run('--slug', 'drop-note', '--class', 'notes=.callout=.note'); assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, /notes: 2 → 1/); rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'drop-note.json')); assert.deepEqual(rec.classes, { notes: { source: '.callout', target: '.note' } }); assert.equal(rec.class.notes.source, 2);
r = run('--slug', 'pass-nested', '--class', 'notes=.callout=.note'); assert.equal(r.status, 0, r.stdout); assert.equal(json(join(T, 'stardust', 'migrated', '_acceptance', 'pass-nested.json')).class.notes.emitted, 2);
r = run('--slug', 'pass-nested', '--class', 'admonitions=.a=.b'); assert.equal(r.status, 2, '--class takes notes=<src>=<tgt> only'); assert.match(r.stderr, /usage: content-acceptance\.mjs/);
assert.equal(run('--slug', 'fail-list-depth', '--tolerance', 'listDepth=1,nestedLists=1').status, 0, 'structure classes take the explicit, recorded tolerance');
// contact links — NEGATIVE: mailto/tel were excluded from the links class before
r = run('--slug', 'drop-mailto'); assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, /links: 4 → 3/); rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'drop-mailto.json')); assert.deepEqual(rec.class.links.dropped.map((d) => d.key), ['email us|mailto:hello@example.example']);
assert.equal(Object.keys(inventory('<main><a href="tel:+1 (800) 555-0100">Call</a><a href="#top">Top</a></main>').links).join(), 'call|tel:+18005550100', 'tel keyed by digits; # anchors excluded');
// words
r = run('--slug', 'words-low'); assert.equal(r.status, 2); assert.match(r.stdout, /words: ratio 0\.\d+ < 0\.90/);
r = run('--slug', 'words-high'); assert.equal(r.status, 0); assert.match(r.stdout, /🟡 words: ratio \d\.\d+ > 1\.10/);
// covered by a deviation → pass with covered[]
r = run('--slug', 'covered'); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /covered: 1 item\(s\) by contentDeviations\[\]/);
rec = json(join(T, 'stardust', 'migrated', '_acceptance', 'covered.json')); assert.equal(rec.covered[0].class, 'links'); assert.equal(rec.covered[0].deviation, 'dynamic-dependency');
// explicit tolerance lets the drop through and is echoed
r = run('--slug', 'drop-link', '--tolerance', 'links=0.5'); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /tolerances links=0\.5/);
assert.deepEqual(json(join(T, 'stardust', 'migrated', '_acceptance', 'drop-link.json')).tolerances, { links: 0.5 });
assert.equal(run('--slug', 'ok', '--tolerance', 'ctas=0.1').status, 2); assert.equal(run('--slug', 'ok', '--tolerance', 'links=2').status, 2);
// report-only: record written, exit 0, gatesPassed NOT written
r = run('--slug', 'drop-h2', '--report-only'); assert.equal(r.status, 0); assert.equal(json(join(T, 'stardust', 'migrated', '_acceptance', 'drop-h2.json')).verdict, 'fail');
{ const mp = join(T, 'stardust', 'migrated', 'covered', '_meta.json'); const m = json(mp); m.gatesPassed = ['delivery-lint']; writeFileSync(mp, JSON.stringify(m)); }
r = run('--slug', 'covered', '--report-only'); assert.equal(r.status, 0); assert.match(r.stdout, /report-only \(gatesPassed not written\)/);
assert.deepEqual(json(join(T, 'stardust', 'migrated', 'covered', '_meta.json')).gatesPassed, ['delivery-lint']);
// zero-row target
r = run('--slug', 'zero'); assert.equal(r.status, 2); assert.match(r.stdout, /headings: 3 → 0/); assert.match(r.stdout, /words: ratio 0 </);
// compiler skipped[]
r = run('--slug', 'skipped'); assert.equal(r.status, 2); assert.match(r.stdout, /tableRows: skipped by the compiler/);
r = run('--slug', 'skipped', '--skipped-allow', 'tableRows'); assert.equal(r.status, 0, r.stdout);
// unmeasured
r = run('--slug', 'nosource'); assert.equal(r.status, 1); assert.match(r.stdout, /\? nosource: unmeasured — source sidecar missing/);
assert.equal(json(join(T, 'stardust', 'migrated', '_acceptance', 'nosource.json')).verdict, 'unmeasured');
// --all: summary.md + line; exit 2 (fails present)
r = run('--all'); assert.equal(r.status, 2);
assert.match(r.stdout, /content-count: \d+ passed · \d+ covered · \d+ failed · 1 unmeasured — .*summary\.md/);
const md = readFileSync(join(T, 'stardust', 'migrated', '_acceptance', 'summary.md'), 'utf8');
assert.match(md, /\| headings \| \d+ \|/); assert.match(md, /- nosource: unmeasured/);
// --json + --trace
r = run('--slug', 'drop-h2', '--trace', 'Get a quote', '--json'); const j = JSON.parse(r.stdout);
assert.equal(j.failed, 1); assert.deepEqual(j.records[0].trace, { text: 'Get a quote', inSource: true, inTarget: false });
// source scoping flags recorded
const scoped = inventory(SRC, { mainSel: 'body', exclude: ['header', 'footer'] });
assert.equal(Object.keys(scoped.links).length, 2); assert.equal(scoped.excluded, 2);
r = run('--slug', 'ok', '--source-main', 'body', '--source-exclude', 'header,footer'); assert.equal(r.status, 0, r.stdout);
assert.deepEqual(json(join(T, 'stardust', 'migrated', '_acceptance', 'ok.json')).scope, { main: 'body', exclude: ['header', 'footer'] });
// judge: covered items never silently pass; deviations without a match do nothing
const jd = judge({ headings: { source: 2, emitted: 1, dropped: [{ key: 'h2:get a quote', source: 1, emitted: 0 }], extra: [] }, links: { source: 0, emitted: 0, dropped: [], extra: [] }, images: { source: 0, emitted: 0, dropped: [], extra: [] }, listItems: { source: 0, emitted: 0, dropped: [], extra: [] }, tableRows: { source: 0, emitted: 0, dropped: [], extra: [] }, words: { source: 100, emitted: 100, ratio: 1 } }, { deviations: [{ source: 'Something else' }] });
assert.equal(jd.verdict, 'fail'); assert.equal(jd.covered.length, 0);
// usage
r = run(); assert.equal(r.status, 2, 'no --slug/--all is usage'); assert.match(r.stderr, /--slug <s> or --all is required[\s\S]*usage: content-acceptance\.mjs/);
r = run('--slug', '--all'); assert.equal(r.status, 2, 'a value flag swallowing the next flag is usage, never unmeasured'); assert.match(r.stderr, /--slug needs a value \(got --all\)/);
assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
// zero source hits: the script never fetches unless --target-url is given
const src = readFileSync(CLI, 'utf8');
assert.equal((src.match(/fetch\(/g) || []).length, 1, 'one fetch — the --target-url delivery-origin hit only');

rmSync(T, { recursive: true, force: true });
console.log('content-acceptance.test: ok');
