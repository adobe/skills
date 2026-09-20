#!/usr/bin/env node
// Fixture test: importer-skeleton.mjs (T26.1) + the unmapped/flattened hard stop and early-stop aggregate (T26.3).
//
//   pass page     sections, block DOM, _meta.modules[] == emitted blocks, metadata block with a lang row, manifest
//                 written, generators[] recorded, exit 0, davids-model-lint over the output exits 0;
//   rule 3        `<h2 data-tpl="hea01">` marked on the element → heading kept (never a descendant match);
//   rule 4/5      a card grid reached only through a declared wrapper is a block; an undeclared wrapper's grid is prose;
//   rule 10       three adjacent same-emitter widgets → one block with three rows;
//   rule 6/7      <noscript>/<template>/<style> bodies, `{{ binding }}`, the empty heading, empty <p> and
//                 `javascript:` hrefs are gone; tracking params + .html stripped per transform.json;
//   0 sections    → exit 2, no file written (the sixty-six empty pages);
//   unmapped      visible module with no emitter → exit 2 + audit.import.unmapped[]; flattened[] when a block:
//                 kind cannot be shaped; drop:/dynamics: emitters recorded, never failures;
//   early stop    one kind unmapped on ≥ 3 pages of a template stops that template under --continue;
//   writer rules  patches applied last; a hand-edited output → exit 2 naming the path; --force overwrites;
//                 second run → zero writes; --report-only writes _meta.json only; --dry-run writes nothing;
//   hidden-live   stamped capture: [data-hidden-live] skipped + recorded, <details> kept; unstamped → "unstamped";
//   root guard    a root selector resolving to <body> → exit 2; invalid map → exit 1; missing capture → exit 1;
//   h1 is a DOM fact  `<h1><strong>Bold</strong> start</h1>` and an image-only <h1> pass; `<h1><em></em></h1>` is `h1 0`;
//   bulk flush    a missing capture mid-bulk exits 1 AFTER writing the manifest + summary for the pages already processed;
//   ledger block  (plan time) a lift-ledger kind with no emitter blocks its template under --template: every page `blocked`,
//                 nothing rendered, exit 2; the ledger selector identifies the module on a --slug run (unmapped[] under its kind);
//                 mapping the kind unblocks the template.
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/importer-skeleton.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHTML, qsa, matches, textOf } from '../importer-skeleton.mjs';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', 'importer-skeleton.mjs');
const LINT = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'davids-model-lint.mjs');
const FX = join(HERE, 'fixtures', 'importer-skeleton');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'importer-skeleton-'));
cpSync(FX, T, { recursive: true });
const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--root', T, ...args], { encoding: 'utf8' });
const M = (...p) => join(T, 'stardust', 'migrated', ...p);
const files = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).filter((f) => !f.endsWith('summary.json') && !f.endsWith('summary.md')) : []);

// --- mini DOM sanity ---------------------------------------------------------------------------------------
{
  const d = parseHTML('<div id="a" class="x y"><p>one<b>two</b></p><ul><li>1<li>2</ul><img src=i.png><span data-k="v w">s</span></div>');
  assert.equal(qsa(d, 'li').length, 2, 'implicit li close');
  assert.equal(textOf(qsa(d, 'p')[0]), 'onetwo');
  assert.ok(matches(qsa(d, 'span')[0], 'div.x > span[data-k~="w"]:last-child'));
  assert.ok(matches(qsa(d, 'p')[0], '#a p:first-child, nothing'));
  assert.ok(!matches(qsa(d, 'p')[0], 'p:not(:first-child)'));
  assert.equal(qsa(d, 'div:has(img)').length, 1);
}

// --- pass page: about ------------------------------------------------------------------------------------------
let r = run('--slug', 'about');
assert.equal(r.status, 0, `about imports\n${r.stderr}\n${r.stdout}`);
const aboutHtml = readFileSync(M('about', 'index.html'), 'utf8');
const doc = parseHTML(aboutHtml);
const main = qsa(doc, 'main')[0];
const sections = qsa(main, 'main > div');
assert.ok(sections.length >= 3, `sections: intro, cards/stats, highlight (${sections.length})`);
assert.equal(qsa(doc, 'main > div:last-child > .metadata').length, 1, 'metadata block rides in the last content section (lint META)');
assert.match(aboutHtml, /src="https:\/\/www\.larkspurmutual\.example\/i\/a\.png"/, 'img src fully qualified against the capture URL (lint D4)');
assert.match(aboutHtml, /<h1>About us \(patched\)<\/h1>/, 'patch `replace` applied last');
assert.equal(qsa(doc, '.cards.patched').length, 1, 'patch `attr` applied last');
assert.equal(qsa(doc, '.cards > div').length, 2, 'card grid reached through .container/.row wrappers → 2 rows');
assert.equal(qsa(doc, '.cards > div:first-child > div').length, 2, 'a card row has a media cell and a text cell');
assert.equal(qsa(doc, '.stats.compact').length, 1, 'rule 10: three adjacent .stat → ONE block');
assert.equal(qsa(doc, '.stats.compact > div').length, 3, '… with three rows');
assert.equal(qsa(doc, '.section-metadata').length, 1, 'section-style emitter → its own section with section-metadata');
assert.equal(textOf(qsa(doc, '.section-metadata > div > div:last-child')[0]), 'highlight');
assert.match(aboutHtml, /<h2>Members first<\/h2>/, 'transform.headings: .title-lg → h2');
assert.doesNotMatch(aboutHtml, /Enable JavaScript|tpl<|color:red|\{\{|javascript:|utm_source|history\.html|<h2><\/h2>|<p><\/p>/, 'rule 6/7 strip + transform.links');
assert.match(aboutHtml, /href="\/history\?ref=2"/, 'tracking param stripped, .html stripped, other params kept');
assert.doesNotMatch(aboutHtml, /Join<|Chat with us/, 'drop: and dynamics: emitters emit nothing');
assert.match(aboutHtml, /<details><summary>Fine print<\/summary>/, '<details> kept');
assert.doesNotMatch(aboutHtml, /site-header|Privacy|breadcrumb/, 'chrome removed');
const metaRows = Object.fromEntries(qsa(doc, '.metadata > div').map((row) => [textOf(row.children.filter((c) => c.type === 'element')[0]), textOf(row.children.filter((c) => c.type === 'element')[1])]));
assert.equal(metaRows.title, 'About — Larkspur Mutual'); assert.equal(metaRows.lang, 'en', 'metadata block carries the lang row'); assert.equal(metaRows.template, 'static');
const meta = json(M('about', '_meta.json'));
assert.deepEqual(meta.modules, ['cards', 'stats'], '_meta.modules[] == emitted block names');
assert.equal(meta.renderBranch, "A'"); assert.equal(meta.fidelityTier, 'sibling'); assert.equal(meta.template, 'static'); assert.equal(meta.archetypeSource, 'home');
assert.deepEqual(meta.contentDeviations, [{ kind: 'dynamic-dependency', row: 'DYN-7', module: 'chat', selector: '.chat-widget' }], 'dynamics: emitter → contentDeviations[]');
assert.equal(meta.audit.import.dropped.length, 1); assert.match(meta.audit.import.dropped[0].reason, /runtime form/);
assert.deepEqual(meta.audit.import.unmapped, []); assert.deepEqual(meta.audit.import.flattened, []);
assert.equal(meta.audit.import.hiddenLive, 'unstamped'); assert.match(meta.audit.import.captureSha, /^sha256:/); assert.match(meta.audit.import.vocabularySha, /^sha256:/);
assert.deepEqual(meta.audit.import.patchesApplied.map((p) => [p.op, p.matched]), [['attr', 1], ['replace', 1]]);
const manifest = json(join(T, 'stardust', 'import-manifest.json'));
assert.ok(manifest['stardust/migrated/about/index.html'] && manifest['stardust/migrated/about/_meta.json'], 'manifest path → sha');
assert.deepEqual(json(join(T, 'stardust', 'state.json')).migrate.generators.static.script, 'skills/migrate/scripts/importer-skeleton.mjs', 'generators[] recorded');
const lint = spawnSync(process.execPath, [LINT, M('about', 'index.html')], { encoding: 'utf8' });
assert.equal(lint.status, 0, `davids-model-lint over the emitted page exits 0\n${lint.stdout}\n${lint.stderr}`);

// --- second run → zero writes; --dry-run; --report-only ---------------------------------------------------------------
r = run('--slug', 'about'); assert.equal(r.status, 0); assert.match(r.stdout, /1 ok · 0 failed · 0 writes/, 'second run → zero writes');
r = run('--slug', 'hea', '--dry-run'); assert.equal(r.status, 0); assert.ok(!existsSync(M('careers', 'hea.html')), '--dry-run writes nothing'); assert.match(r.stdout, /\(dry run\)/);
r = run('--slug', 'hea', '--report-only'); assert.equal(r.status, 0); assert.ok(!existsSync(M('careers', 'hea.html')) && existsSync(M('careers', 'hea._meta.json')), '--report-only writes the sidecar only');

// --- rule 3: marker on the element → heading kept; .html leaf preserved (URL-literal rule) ------------------------------
r = run('--slug', 'hea'); assert.equal(r.status, 0, r.stderr);
const hea = readFileSync(M('careers', 'hea.html'), 'utf8');
assert.match(hea, /<h2>Offene Stellen<\/h2>/, 'data-tpl marker classified on the element keeps the heading');
assert.match(hea, /<em>kursiv<\/em>/, 'transform.inline: i → em'); assert.match(hea, /<html lang="de">/); assert.match(hea, /<div>lang<\/div>\s*<div>de<\/div>/);

// --- rule 4/5: declared wrapper recursion only --------------------------------------------------------------------------
r = run('--slug', 'grid'); assert.equal(r.status, 0, r.stderr);
const grid = parseHTML(readFileSync(M('grid', 'index.html'), 'utf8'));
assert.equal(qsa(grid, '.cards').length, 1, 'the grid under .container is a block');
assert.equal(qsa(grid, '.cards > div').length, 3, '… with the three cards as rows, not swallowed into prose');
assert.match(readFileSync(M('grid', 'index.html'), 'utf8'), /<h3>Swallowed\?<\/h3>/, 'an undeclared wrapper is default content (visible, in order)');
assert.equal(json(M('grid', '_meta.json')).outputPathDefault, 'trailing-slash', 'bare /grid → grid/index.html recorded as the default choice');

// --- 0 sections / no h1 → exit 2, nothing written --------------------------------------------------------------------------
r = run('--slug', 'empty'); assert.equal(r.status, 2); assert.match(r.stderr, /0 sections, h1 0 — an empty page is never written/); assert.ok(!existsSync(M('empty')), 'no file for an empty page');

// --- h1 presence is a DOM fact (inline-first and image-only headings pass; an empty inline heading fails) ------------------
r = run('--slug', 'inlineh1'); assert.equal(r.status, 0, `inline-first <h1> is a heading\n${r.stderr}`); assert.match(readFileSync(M('inline-h1', 'index.html'), 'utf8'), /<h1><strong>Bold<\/strong> start<\/h1>/);
r = run('--slug', 'imgh1'); assert.equal(r.status, 0, `image-only <h1> is a heading\n${r.stderr}`);
r = run('--slug', 'blankh1'); assert.equal(r.status, 2); assert.match(r.stderr, /h1 0 — an empty page is never written/); assert.ok(!existsSync(M('blank-h1')), 'an <h1> with no text or image is not a heading');

// --- bulk: a missing capture stops the run (exit 1) but the manifest + summary flush for the pages already processed -----
r = run('--template', 'bulk', '--continue', '--json'); assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /b2: no capture/);
assert.ok(json(join(T, 'stardust', 'import-manifest.json'))['stardust/migrated/bulk/b1/index.html'], 'b1 landed in the manifest before the stop');
assert.deepEqual(json(M('_import', 'summary.json')).records.map((x) => [x.slug, x.status]), [['b1', 'ok'], ['b2', 'missing']], 'summary carries the processed page and the missing one');
r = run('--template', 'bulk', '--continue'); assert.equal(r.status, 1); assert.match(r.stdout, /1 ok · 0 failed · 0 writes/, 'b1 is not rewritten on the retry');

// --- plan-time module-map precondition (T26.3 Gate A): an unmapped lift-ledger kind blocks its template -------------
r = run('--template', 'ledgered', '--json'); assert.equal(r.status, 2, r.stdout);
assert.match(r.stderr, /template ledgered blocked — lift-ledger kinds without an emitter: "plan-compare"/);
assert.deepEqual(r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).map((x) => [x.slug, x.status]), [['l1', 'blocked']]);
assert.ok(!existsSync(M('ledgered')), 'nothing rendered for a blocked template');
assert.deepEqual(json(M('_import', 'summary.json')).blockedTemplates, ['ledgered']);
r = run('--slug', 'l1', '--json'); assert.equal(r.status, 2, 'the ledger selector identifies the module on a single page');
{ const lrec = JSON.parse(r.stdout.split("\n")[0]); assert.equal(lrec.status, "failed"); assert.deepEqual(lrec.audit.unmapped.map((u) => [u.kind, u.selector, u.ledger]), [["plan-compare", ".plan-compare", true]]); }
{ const v = json(join(T, 'stardust', 'import', 'vocabulary.json')); v.markers['.plan-compare'] = { kind: 'plan-compare', emitter: 'block:plan-compare' }; writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify(v, null, 2)); }
r = run('--template', 'ledgered'); assert.equal(r.status, 0, `mapping the kind unblocks the template\n${r.stderr}`); assert.deepEqual(json(M('ledgered', 'l1', '_meta.json')).modules, ['plan-compare']);
r = run('--template', 'program', '--dry-run'); assert.doesNotMatch(r.stderr, /blocked/, 'a template with no ledger kinds is never blocked by the ledger');

// --- flattened: a block: kind the walk cannot shape → exit 2 + flattened[] ----------------------------------------------------------
r = run('--slug', 'flat', '--json'); assert.equal(r.status, 2, r.stdout);
let rec = JSON.parse(r.stdout.split('\n')[0]);
assert.equal(rec.status, 'failed'); assert.equal(rec.audit.flattened.length, 1); assert.equal(rec.audit.flattened[0].emitter, 'block:tiles'); assert.match(rec.reason, /flattened to prose/);
assert.ok(!existsSync(M('flat')), 'nothing written for the page');

// --- unmapped + early stop (T26.3): one kind on ≥ 3 pages stops the template; summary line --------------------------------------
r = run('--template', 'program', '--continue', '--json');
assert.equal(r.status, 2);
const recs = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
assert.deepEqual(recs.map((x) => [x.slug, x.status]), [['u1', 'failed'], ['u2', 'failed'], ['u3', 'failed'], ['u4', 'skipped']], 'three failures, then the template stops early');
assert.equal(recs[0].audit.unmapped[0].kind, 'legacy-box'); assert.match(recs[0].reason, /unmapped modules "legacy-box"/);
assert.match(r.stdout, /unmapped modules: 1 kinds on 3 pages — map or drop with reason \(stopped early: program\)/);
assert.ok(!existsSync(M('programs')), 'no program page written');
r = run('--template', 'program'); assert.equal(r.status, 2); assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('✗')).length, 1, 'without --continue the first failure stops the run');
const summary = json(M('_import', 'summary.json')); assert.equal(summary.failed, 1); assert.equal(summary.records[0].slug, 'u1');
// mapping the kind makes the template importable
const vocab = json(join(T, 'stardust', 'import', 'vocabulary.json')); vocab.markers['.legacy-box'] = { kind: 'legacy-box', emitter: 'block:legacy-box' };
writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify(vocab, null, 2));
r = run('--template', 'program'); assert.equal(r.status, 0, r.stderr); assert.deepEqual(json(M('programs', 'u1', '_meta.json')).modules, ['legacy-box']);
assert.ok(json(join(T, 'stardust', 'state.json')).migrate.generators.program, 'a second template records its generator');

// --- hidden-live: stamped capture skips stamped nodes, keeps <details> -------------------------------------------------------------
r = run('--slug', 'stamped'); assert.equal(r.status, 0, r.stderr);
const stamped = readFileSync(M('stamped', 'index.html'), 'utf8');
assert.doesNotMatch(stamped, /Hidden modal|Never shown/, '[data-hidden-live] skipped');
assert.match(stamped, /<details><summary>Terms<\/summary><p>Kept as a row\.<\/p><\/details>/, '<details> exempt from the skip');
const smeta = json(M('stamped', '_meta.json'));
assert.equal(smeta.audit.import.hiddenLive, 'stamped'); assert.deepEqual(smeta.audit.import.hidden, [{ selector: 'div.modal', reason: 'display:none' }]);

// --- hand-edit guard: edited output → exit 2 naming the path; --force overwrites --------------------------------------------------
writeFileSync(M('about', 'index.html'), aboutHtml.replace('About us (patched)', 'About us (hand edit)'));
r = run('--slug', 'about'); assert.equal(r.status, 2); assert.match(r.stderr, /stardust\/migrated\/about\/index\.html was edited by hand .* stardust\/patches\/about\.json or pass --force/);
assert.match(readFileSync(M('about', 'index.html'), 'utf8'), /hand edit/, 'the hand edit is not overwritten');
r = run('--slug', 'about', '--force'); assert.equal(r.status, 0); assert.match(r.stderr, /--force overwrites hand-edited/); assert.equal(readFileSync(M('about', 'index.html'), 'utf8'), aboutHtml, 'regenerated byte-identical');

// --- root guard, invalid map, missing capture ---------------------------------------------------------------------------------------
const badRoot = { ...vocab, root: 'body' }; writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify(badRoot));
r = run('--slug', 'hea'); assert.equal(r.status, 2); assert.match(r.stderr, /resolves to <body> — a chrome landmark or the whole body/);
writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify({ ...vocab, root: 'main#nope' }));
r = run('--slug', 'hea'); assert.equal(r.status, 2); assert.match(r.stderr, /matched nothing \(rule 5/);
writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify({ ...vocab, markers: { '.x': { emitter: 'table:foo' } } }));
r = run('--slug', 'hea'); assert.equal(r.status, 1); assert.match(r.stderr, /emitter "table:foo"/);
writeFileSync(join(T, 'stardust', 'import', 'vocabulary.json'), JSON.stringify(vocab));
r = run('--slug', 'nowhere'); assert.equal(r.status, 1); assert.match(r.stderr, /no capture .* never fetches the live page/);
assert.equal(run().status, 1); assert.equal(spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' }).status, 0);

rmSync(T, { recursive: true, force: true });
console.log('importer-skeleton.test: ok (walk rules 3/4/5/6/7/10, 0-sections exit, DOM h1, ledger plan-time block, unmapped/flattened hard stop + early stop, bulk flush, writer rules, hidden-live, root guard, exits)');
