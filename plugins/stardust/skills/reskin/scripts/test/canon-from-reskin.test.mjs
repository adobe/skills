#!/usr/bin/env node
// skills/reskin/scripts/test/canon-from-reskin.test.mjs — the reskin → migrate bridge. Pure part: CSS lift
// (every :root block merged into one, kept separately; class-based rules and @media lifted, element rules left), module skeletons
// (slot body emptied, band image blanked), compositional moves, canon delta and content-aware stale
// flags. CLI part (temp dir; pins are skipped when playwright is absent): --help before any I/O,
// refusals, a full run writes canon/ + DESIGN.* with :root first and a first-approval history entry
// (capture or a skip finding), an unchanged --force re-run keeps
// every file and flags nothing, a changed archetype flags the approved sibling. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonDelta, compositionalMoves, liftCss, mappingModuleIssues, moduleSkeletons, otherArchetypes, previousShot, siblingsToDirect, staleFlags, withoutStamp } from '../canon-from-reskin.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'canon-from-reskin.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const STYLE = `:root { --a: red; }
body:has(> .site-main) { margin: 0; }
.site-main .btn { color: var(--a); }
h1 { font-size: 2em; }
@media (max-width: 640px) { .site-main .btn { width: 100%; } main p { margin: 0; } }
@font-face { font-family: X; }`;
const page = (accent = 'red') => `<!doctype html><html><head><style>${STYLE.replace('red', accent)}</style></head><body>
<header class="site-header" data-canon="header"><a href="/">Home</a></header>
<main class="site-main" data-template="login">
  <section class="band layout-media-band" data-slot="s01" data-module="M2">
    <img class="band-img" src="https://x.test/a.jpg" alt="bg">
    <div class="container"><div class="panel"><div class="flow" data-slot-body>
        <h1 class="heading">Login</h1>
    </div></div></div>
  </section>
</main>
<footer class="site-footer" data-canon="footer"><p>Footer</p></footer></body></html>`;

check('liftCss: :root separate; class-based rules and @media inner rules lifted; element and @font-face rules left', () => {
  const r = liftCss(STYLE);
  assert.equal(r.rootBlock, ':root { --a: red; }');
  assert.ok(r.lifted.some((l) => l.startsWith('body:has(> .site-main)')));
  assert.ok(r.lifted.some((l) => l.startsWith('.site-main .btn')));
  assert.ok(r.lifted.some((l) => /^@media \(max-width: 640px\) \{\n {2}\.site-main \.btn/.test(l) && !l.includes('main p')));
  assert.deepEqual(r.leftBehind, ['h1', '@media (max-width: 640px) main p', '@font-face']);
});
check('liftCss: every :root block is merged into the one rootBlock (stream-render emits two); a later name wins in place', () => {
  const r = liftCss(`:root {
  --max-width: 1200px;
  /* absent in donor-tokens.json: --radius */
}
:root {
  --palette-accent: #c00;
  --max-width: 1140px;
  --type-family: "A; B", sans-serif;
  --bg: url(data:image/png;base64,AA==);
}
.site-main .btn { color: var(--palette-accent); max-width: var(--max-width); }`);
  assert.equal(r.rootBlock, ':root {\n  --max-width: 1140px;\n  --palette-accent: #c00;\n  --type-family: "A; B", sans-serif;\n  --bg: url(data:image/png;base64,AA==);\n}');
  assert.deepEqual(r.lifted, ['.site-main .btn { color: var(--palette-accent); max-width: var(--max-width); }']);
  assert.equal(liftCss('.x { color: red; }').rootBlock, null);
});
check('moduleSkeletons: slot body emptied, band image blanked, per-page content gone', () => {
  const { modules, findings } = moduleSkeletons(page());
  assert.deepEqual(findings, []);
  const m2 = modules.get('M2');
  assert.match(m2, /<div class="flow" data-slot-body><\/div><\/div><\/div>\s*<\/section>$/);
  assert.match(m2, /<img class="band-img" data-slot="media" alt="" src="">/);
  assert.ok(!m2.includes('Login') && !m2.includes('a.jpg'));
});
check('moduleSkeletons: a module without [data-slot-body] is a finding', () => {
  const { findings } = moduleSkeletons('<section data-module="M9"><p>x</p></section>');
  assert.match(findings[0], /module M9: no \[data-slot-body\]/);
});
check('moduleSkeletons: split layout (media after the body) is emptied and its image blanked', () => {
  const { modules, findings } = moduleSkeletons(`<section class="band layout-split" data-slot="s01" data-module="M1">
      <div class="container"><div class="panel"><div class="flow" data-slot-body>
          <h1 class="heading">Hero</h1>
      </div><img class="split-img" src="https://x.test/h.svg" alt="hero"></div></div>
    </section>`);
  assert.deepEqual(findings, []);
  const m1 = modules.get('M1');
  assert.match(m1, /<div class="flow" data-slot-body><\/div><img class="split-img" data-slot="media" alt="" src=""><\/div><\/div>\s*<\/section>$/);
  assert.ok(!m1.includes('Hero') && !m1.includes('h.svg'));
});
check('otherArchetypes: first approved/migrated page per other type, own type and unapproved pages skipped', () => {
  const pages = [
    { slug: 'home', type: 'landing', status: 'approved', prototypePath: 'h.html' },
    { slug: 'about', type: 'landing', status: 'approved', prototypePath: 'a.html' },
    { slug: 'blog', type: 'listing', status: 'prototyped', prototypePath: 'b0.html' },
    { slug: 'news', type: 'listing', status: 'migrated', prototypePath: 'n.html' },
    { slug: 'faq', type: 'faq', status: 'approved' },
    { slug: 'misc', status: 'approved', prototypePath: 'm.html' },
  ];
  assert.deepEqual(otherArchetypes(pages, 'home'), [{ slug: 'news', type: 'listing', prototypePath: 'n.html' }]);
  // first page of a type has no prototype: the next one with a prototype stands in, never the type dropped
  const gap = [{ slug: 'about', type: 'landing', status: 'migrated' }, { slug: 'blog', type: 'listing', status: 'migrated', prototypePath: 'b.html' }, { slug: 'index', type: 'landing', status: 'migrated', prototypePath: 'i.html' }];
  assert.deepEqual(otherArchetypes(gap, 'blog'), [{ slug: 'index', type: 'landing', prototypePath: 'i.html' }]);
  // the ledger's handoff archetype wins over list order
  assert.deepEqual(otherArchetypes(pages, 'news', { landing: { archetype: 'about' } }), [{ slug: 'about', type: 'landing', prototypePath: 'a.html' }]);
  assert.deepEqual(otherArchetypes(pages, 'news', { landing: { archetype: 'nope' } }), [{ slug: 'home', type: 'landing', prototypePath: 'h.html' }]);
});
check('mappingModuleIssues: modules without a skeleton and modules composed more than one way', () => {
  const mapping = { pages: {
    home: { slots: { s01: { module: 'M1', layout: 'split', width: 'wide' }, s02: { module: 'M1', layout: 'split', width: 'wide' }, s03: { module: 'M3', layout: 'cards', columns: 2 } } },
    blog: { slots: { s01: { module: 'M2' }, s02: { module: 'M3', layout: 'stack' }, s03: { module: 'M1', layout: 'split', width: 'wide', columns: 3 } } },
  } };
  const r = mappingModuleIssues(mapping, ['M1', 'M3']);
  assert.deepEqual(r.missing, ['M2']);
  assert.deepEqual(r.mixed.map((m) => m.id), ['M3']);
  assert.deepEqual(r.mixed[0].compositions.map((c) => c.at), [['home:s03'], ['blog:s02']]);
});
check('compositionalMoves: chrome line, one line per distinct module composition, button rule; at most 7', () => {
  const moves = compositionalMoves({ chrome: { header: ['s01'], footer: ['s02'] }, pages: { a: { slots: { s01: { module: 'M2', layout: 'media-band', width: 'narrow' } } }, b: { slots: { s01: { module: 'M2', layout: 'media-band', width: 'narrow' } } } } });
  assert.equal(moves.length, 3);
  assert.match(moves[1], /Module M2 composes as a media-band section at narrow width/);
});
check('withoutStamp drops HTML and CSS provenance stamps only', () => {
  assert.equal(withoutStamp('<!-- stardust:canon\n  writtenAt: x\n-->\n<header></header>'), '<header></header>');
  assert.equal(withoutStamp(':root{}\n/* stardust:canon writtenAt y */\n.a{}'), ':root{}\n.a{}');
});
check('canonDelta: null on first approval; lists changed, added and removed files and modules', () => {
  assert.equal(canonDelta(null, { files: {} }), null);
  const prev = { files: { header: { sha: 'h' }, css: { sha: 'c' } }, modules: { M1: '1', M2: '2' } };
  assert.deepEqual(canonDelta(prev, { files: { header: { sha: 'h' }, css: { sha: 'c2' }, footer: { sha: 'f' } }, modules: { M2: '2', M3: '3' } }), ['css', 'footer', 'module:M1', 'module:M3']);
  assert.deepEqual(canonDelta(prev, prev), []);
});
check('previousShot: the latest history entry with a capture, else null', () => {
  assert.equal(previousShot([]), null); assert.equal(previousShot(undefined), null);
  const h = [{ at: '1', shot: 'a.png' }, { at: '2', shot: 'b.png' }, { at: '3' }];
  assert.equal(previousShot(h).shot, 'b.png');
  // multi-archetype canon: compare an archetype only with its own previous capture
  const m = [{ from: 'home', shot: 'h1.png' }, { from: 'news', shot: 'n1.png' }];
  assert.equal(previousShot(m, 'home').shot, 'h1.png'); assert.equal(previousShot(m, 'faq'), null);
});
check('staleFlags: approved non-archetype pages on any change; migrated pages only when their sidecar no longer matches', () => {
  const next = { files: { header: { sha: 'h' }, footer: { sha: 'f' }, css: { sha: 'c2' } }, archetypeSha: 'a2' };
  const pages = [
    { slug: 'arch', status: 'approved' }, { slug: 'sib', status: 'approved' }, { slug: 'dir', status: 'directed' },
    { slug: 'm-old', status: 'migrated' }, { slug: 'm-new', status: 'migrated' }, { slug: 'm-mod', status: 'migrated' }, { slug: 'm-noside', status: 'migrated' },
  ];
  const sidecars = {
    'm-old': { canonShas: { header: 'h', footer: 'f', css: 'c1' }, archetypeSha: 'a1' },
    'm-new': { canonShas: { header: 'h', footer: 'f', css: 'c2' }, archetypeSha: 'a2' },
    'm-mod': { canonShas: { header: 'h', footer: 'f', css: 'c2' }, modules: ['M2'] },
  };
  const out = staleFlags({ pages, archetype: 'arch', changed: ['css', 'module:M2'], sidecars, next });
  assert.deepEqual(out, [
    { slug: 'sib', affected: ['css', 'module:M2'] },
    { slug: 'm-old', affected: ['css', 'archetype'] },
    { slug: 'm-mod', affected: ['module:M2'] },
    { slug: 'm-noside', affected: ['css', 'module:M2'] },
  ]);
  assert.deepEqual(staleFlags({ pages, archetype: 'arch', changed: null, sidecars, next }), []);
  assert.deepEqual(staleFlags({ pages, archetype: 'arch', changed: [], sidecars, next }).map((f) => f.slug), ['m-old']);
});

// ---- CLI ----------------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'cfr-'));
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: tmp, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const write = (rel, data) => { const f = join(tmp, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
const read = (rel) => readFileSync(join(tmp, rel), 'utf8');
const state = (archStatus = 'approved') => ({ flow: 'reskin', designSource: { kind: 'figma', url: 'https://www.figma.com/design/k' }, pages: [
  { slug: 'login', status: archStatus, prototypePath: 'stardust/prototypes/login-proposed.html', history: [{ status: 'approved', at: '2026-01-01T00:00:00Z' }] },
  { slug: 'reg', status: 'approved', prototypePath: 'stardust/prototypes/reg-proposed.html' },
] });

check('--help in an empty cwd: exit 0, nothing written; no slug: exit 2', () => {
  const h = run(['--help']); assert.equal(h.status, 0); assert.match(h.out, /^usage: node canon-from-reskin\.mjs/);
  assert.equal(run([]).status, 2);
  assert.equal(run(['login', '--visual-threshold', 'x']).status, 2); assert.equal(run(['login', '--visual-threshold']).status, 2);
});
write('stardust/state.json', JSON.stringify(state('directed')));
write('stardust/reskin/donor-tokens.json', JSON.stringify({ palette: { accent: 'red' }, layout: { sectionPaddingY: '64px' } }));
write('stardust/reskin/mapping.json', JSON.stringify({ chrome: { header: ['s01'] }, pages: { login: { template: 'login', slots: { s01: { module: 'M2', layout: 'media-band', width: 'narrow' } } } } }));
write('stardust/reskin/donor-modules.md', '| # | Module | EDS block | Where seen | Description |\n|---|---|---|---|---|\n| M2 | Login | form (login) | a | d |\n');
write('stardust/prototypes/login-proposed.html', page());
check('refuses an archetype that is not approved (exit 1)', () => {
  const r = run(['login']); assert.equal(r.status, 1); assert.match(r.err, /refused: login is directed/);
});
check('full run: canon files, :root first in canon.css, DESIGN.json canon + modules; re-run refuses without --force', () => {
  write('stardust/state.json', JSON.stringify(state()));
  const r = run(['login']); assert.equal(r.status, 0, r.err);
  assert.match(read('stardust/canon/canon.css'), /^:root \{ --a: red; \}/);
  assert.match(read('stardust/canon/header.html'), /<header class="site-header" data-canon="header">/);
  const d = JSON.parse(read('DESIGN.json'));
  assert.equal(d.source.kind, 'donor'); assert.equal(d.extensions.canon.sourceSlug, 'login');
  assert.deepEqual(Object.keys(d.extensions.canon.files), ['header', 'footer', 'css']);
  assert.equal(d.extensions.modules.find((m) => m.id === 'M2').canonicalRendering.path, 'stardust/canon/modules/M2.html');
  assert.deepEqual(d.extensions.modules.find((m) => m.id === 'M2').eds, { block: 'form', variant: 'login' }, 'the EDS block of deploy Step 2, from donor-modules.md');
  const first = d.extensions.canon.history.at(-1); assert.equal(first.kind, 'first-approval');
  // captured when playwright and the replica scripts resolve; otherwise a finding, never a failure
  if (first.shot) assert.match(first.shot, /^stardust\/reskin\/approvals\/login\..*\.png$/); else assert.match(r.out, /FINDING visual record skipped/);
  assert.equal(run(['login']).status, 1);
});
check('--force with identical content: files byte-identical, no delta, nothing stale', () => {
  const before = read('stardust/canon/canon.css');
  const r = run(['login', '--force']); assert.equal(r.status, 0, r.err);
  assert.equal(read('stardust/canon/canon.css'), before);
  assert.match(r.out, /canon delta: none; stale flagged: none/);
  assert.ok(!JSON.parse(read('stardust/state.json')).pages.some((p) => p.stale));
});
check('--force after the archetype changed: delta named, approved sibling flagged stale with the reason; archetype not flagged', () => {
  write('stardust/prototypes/login-proposed.html', page('blue'));
  const r = run(['login', '--force']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /canon delta: css; stale flagged: reg/);
  const s = JSON.parse(read('stardust/state.json'));
  assert.equal(s.pages[1].stale, true); assert.match(s.pages[1].staleReason, /^canon changed at .*; affected: css$/);
  assert.equal(s.pages[0].stale, undefined); assert.equal(s.pages[1].status, 'approved');
  assert.equal(JSON.parse(read('DESIGN.json')).extensions.canon.history.at(-1).kind, 're-approval');
});


// ---- siblings → directed (flow reskin) -----------------------------------------------------------
const P = (slug, type, status, extra = {}) => ({ slug, type, status, history: [{ status, at: 'T0' }], ...extra });
check('siblingsToDirect: extracted pages of an approved type advance; other types, stale, prototyped and later are not', () => {
  const pages = [P('arch', 'article', 'approved'), P('a1', 'article', 'extracted'), P('a2', 'article', 'extracted', { source: 'figma' }),
    P('a3', 'article', 'directed'), P('a4', 'article', 'migrated'), P('a5', 'article', 'extracted', { stale: true, staleReason: 'flow-switch' }),
    P('a6', 'article', 'prototyped'), P('l1', 'listing', 'extracted'), P('u1', null, 'extracted'), P('m0', 'form', 'migrated'), P('f1', 'form', 'extracted')];
  const r = siblingsToDirect(pages);
  assert.deepEqual(r.advance, [{ slug: 'a1', type: 'article' }, { slug: 'a2', type: 'article' }, { slug: 'f1', type: 'form' }]);
  assert.deepEqual(r.left.map((x) => x.slug), ['a5', 'a6']);
  assert.match(r.left[0].why, /^stale \(flow-switch\)/); assert.match(r.left[1].why, /migrate render --all skips it/);
  assert.deepEqual(siblingsToDirect([P('l1', 'listing', 'extracted')]), { advance: [], left: [] }, 'no approved archetype: nothing');
});
const sibTmp = mkdtempSync(join(tmpdir(), 'cfr-sib-'));
const sibRun = (cwd, args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const sibProject = (dir, flow) => {
  const w = (rel, data) => { const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
  w('stardust/state.json', JSON.stringify({ _provenance: { writtenBy: 'stardust:extract' }, flow, pages: [
    P('login', 'form', 'approved', { prototypePath: 'stardust/reskin/pages/login.html' }), P('contact', 'form', 'extracted'), P('apply', 'form', 'extracted', { source: 'figma' }),
    P('news', 'article', 'extracted'), P('old', 'form', 'extracted', { stale: true, staleReason: 'flow-switch' })] }, null, 2));
  w('stardust/reskin/donor-tokens.json', JSON.stringify({ palette: { accent: 'red' }, layout: { sectionPaddingY: '64px' } }));
  w('stardust/reskin/mapping.json', JSON.stringify({ pages: { login: { template: 'login', slots: { s01: { module: 'M2', layout: 'media-band' } } } } }));
  w('stardust/reskin/pages/login.html', page());
};
check('bridge under flow reskin: approved type\'s extracted siblings → directed via state.mjs; others untouched; idempotent', () => {
  sibProject(sibTmp, 'reskin');
  const r = sibRun(sibTmp, ['login']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /siblings → directed: contact, apply \(form\)/);
  assert.match(r.out, /sibling old \(form\) not advanced: stale \(flow-switch\)/);
  const s = JSON.parse(readFileSync(join(sibTmp, 'stardust', 'state.json'), 'utf8'));
  const by = Object.fromEntries(s.pages.map((p) => [p.slug, p]));
  assert.equal(by.contact.status, 'directed'); assert.equal(by.apply.status, 'directed');
  assert.deepEqual(by.contact.history.at(-1).status, 'directed');
  assert.equal(by.news.status, 'extracted'); assert.equal(by.old.status, 'extracted'); assert.equal(by.login.status, 'approved');
  assert.equal(s._provenance.writtenBy, 'stardust:reskin');
  const again = sibRun(sibTmp, ['login', '--force']); assert.equal(again.status, 0, again.err);
  assert.match(again.out, /siblings → directed: none \(already directed or later\)/);
  assert.equal(JSON.parse(readFileSync(join(sibTmp, 'stardust', 'state.json'), 'utf8')).pages.find((p) => p.slug === 'contact').history.length, 2);
});
check('bridge outside flow reskin: siblings not advanced, said so', () => {
  const d = mkdtempSync(join(tmpdir(), 'cfr-sib-')); sibProject(d, 'redesign');
  const before = readFileSync(join(d, 'stardust', 'state.json'), 'utf8');
  const r = sibRun(d, ['login']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /siblings: not advanced — state\.json flow is "redesign", not reskin/);
  assert.equal(readFileSync(join(d, 'stardust', 'state.json'), 'utf8'), before);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
