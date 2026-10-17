#!/usr/bin/env node
// skills/replica/scripts/test/gate-evidence.test.mjs — the gate-evidence.mjs contract: sidecar discovery, job
// attribution from run-bg state (never log prose, never mtime), latest-round selection, the derived gates and their
// FAIL:/OPEN: evidence, the sidecar merge (existing first, indent preserved, nothing else touched), the progress
// ledger, --dry-run, --check against the width-aware acceptance set (a pixel gate per --widths entry) and against
// stale gates, --slug, --json, --help, the delivery-lint fallback, the pixel regime (prototype vs published), deadline
// and no-verdict jobs recorded OPEN, variance-probe only from the page's own ■ line, the name-fallback attribution
// rule, a malformed progress.json aborting before any sidecar write, a progress.json that is one archetype's residual
// record at its top level wrapped under types.<archetype> and refused only when it names no archetype (a ledger with
// a `types` map is never second-guessed), the overflow assert line outranking a PASS pixel
// line (FAIL: horizontal overflow, `/ovf+<px>` on the row, `overflowX` in the ledger), media-reconcile `n/a:` and
// dropped from the acceptance set until the page's delivered content file exists (`--content`; an encoded page's at its
// eds-path, a non-canonical source URL included), an INCONCLUSIVE
// pixel-table row read as OPEN (never FAIL, never a pass, a null pct tolerated), a table row without a pixel measurement
// (a stitch error) read as OPEN with its error text and `—` for the null pct / Δh, one height bar per regime in the log
// rule (prototype 8px, published 5 % of the origin height, --height-tolerance ≤ 1 a fraction / > 1 pixels, no origin
// height under a fraction bar → OPEN); an encoded page (its
// sidecar's encode.output.path, no clone needed) linted on its delivered content file, else on its current encoded
// document — never on a migrated HTML — and its jobs attributed by those files; an encoded sibling's local harness gates
// (C14: section-schema, block-roundtrip --ew, qa-gate) from its own runs, else inherited only while its archetype's
// passedOn under the current harness key covers its shape — a key change or a new shape re-arms them; its content-count
// from the encoder's own L5 count while its encode is current and clean (a content-diff FAIL/OPEN wins).
// Run: node plugins/stardust/skills/replica/scripts/test/gate-evidence.test.mjs   (about 2 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE, acceptanceFor, attribute, contentFileFor, daPath, deadline, detectIndent, heightBar, loadTables, nameOwner, pagePaths, parseCounts, parseElements, parseFindings, parseLint, parseOverflow, parseVariance, parseVerdict, regimeOf } from '../gate-evidence.mjs';
import { encoderKey, mapKey } from '../../../migrate/scripts/encode/provenance.mjs';
import { harnessKey, shapeOf } from '../../../migrate/scripts/encode/shape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-evidence.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-evidence-test-')));
const MIG = join(root, 'stardust/migrated');
const BG = join(root, 'stardust/.work/replica/bg');
const PROGRESS = join(root, 'stardust/replica/progress.json');
const LINT = join(root, 'lint-stub.mjs');
const CONTENT = join(root, 'content');
for (const d of [join(MIG, 'tours/north'), join(MIG, 'about'), BG, dirname(PROGRESS), join(CONTENT, 'tours'), join(CONTENT, 'about')]) mkdirSync(d, { recursive: true });
// The delivered content tree (the deploy driver's): both siblings are delivered, the home archetype is not yet.
writeFileSync(join(CONTENT, 'tours/north.html'), '<main><h1>North</h1></main>\n');
writeFileSync(join(CONTENT, 'about/history.html'), '<main><p>History</p></main>\n');
const PUBLISHED = 'https://main--site--org.aem.page';

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, '--lint', LINT, ...args], { cwd: root, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const side = { home: join(MIG, '_meta.json'), north: join(MIG, 'tours/north/_meta.json'), history: join(MIG, 'about/history._meta.json') };

// Pages: an archetype (indent 2), a sibling with a prior declaration (indent 1, trailing newline), a sibling with no
// gates yet (indent 2, no trailing newline). A stray non-sidecar JSON must be ignored.
writeFileSync(join(MIG, 'index.html'), '<html><body><main><h1>Home</h1></main></body></html>\n');
writeFileSync(side.home, `${JSON.stringify({ slug: 'home', type: 'home', fidelityTier: 'archetype', template: null, modules: ['hero'], gatesPassed: [], migratedAt: '2026-09-01T00:00:00.000Z' }, null, 2)}\n`);
writeFileSync(join(MIG, 'tours/north/index.html'), '<html><body><main><h1>North</h1></main></body></html>\n');
const NORTH0 = { slug: 'tours-north', type: 'tour', fidelityTier: 'sibling', archetypeSource: 'tours', template: 'tours', variants: ['tours--wide'], gatesPassed: ['content-fidelity'], gateEvidence: { 'content-fidelity': 'verbatim lift, declared by the agent' }, contentDeviations: [], migratedAt: '2026-09-02T00:00:00.000Z' };
writeFileSync(side.north, `${JSON.stringify(NORTH0, null, 1)}\n`);
writeFileSync(join(MIG, 'about/history.html'), '<html><body><main><p>History</p></main></body></html>\n');
const HISTORY0 = { slug: 'about-history', type: 'article', fidelityTier: 'sibling', archetypeSource: 'about', template: 'about', variants: ['about--compact'], migratedAt: '2026-09-03T00:00:00.000Z' };
writeFileSync(side.history, JSON.stringify(HISTORY0, null, 2));
writeFileSync(join(MIG, '_bundle.json'), '{"assets": []}\n');
// A prior ledger with its own keys, indent 1 — they must survive.
writeFileSync(PROGRESS, `${JSON.stringify({ pages: { tour: { archetype: 'tours', iterations: 2 } } }, null, 1)}\n`);

// The lint stub: clean (one P2) for a file under tours/, a P0 with exit 1 otherwise; echoes --path like the real one echoes --file.
writeFileSync(LINT, `const a = process.argv; const file = a[a.indexOf('--file') + 1]; const p = a[a.indexOf('--path') + 1];
console.log(\`delivery-lint \${file} (type:page) path=\${p}\`); console.log('='.repeat(20));
if (file.includes('/tours/')) { console.log('  P2 metadata  no metadata block'); console.log('\\n0 P0 · 0 P1 · 1 P2'); process.exit(0); }
console.log('  P0 h1  no <h1>'); console.log('\\n1 P0 · 0 P1 · 0 P2'); process.exit(1);\n`);

// run-bg state exactly as run-bg's start() + runWrapper() leave it (indent 1); `end: null` = still running (no endedAt).
const T0 = Date.parse('2026-09-18T10:00:00.000Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
function job(name, cmd, args, { start, end, exit = 0, log, timedOut = false }) {
  const st = { name, cmd, args, cwd: root, timeoutSec: 900, slots: 3, queuedAt: iso(start), wrapperPid: 4242, launchedAt: iso(start + 0.1), endedAt: end === null ? null : iso(end), exit: end === null ? null : exit, timedOut };
  writeFileSync(join(BG, `${name}.json`), JSON.stringify(st, null, 1));
  writeFileSync(join(BG, `${name}.log`), `run-bg: ${name} launched ${st.launchedAt} (timeout 900s): ${[cmd, ...args].join(' ')}\n${log}\n${end === null ? '' : `run-bg: ${name} ended exit=${exit}\n`}`);
}
const GATE = 'stardust/scripts/replica/gate.sh';
const LIVE = 'https://example.test'; const PROTO = 'http://localhost:8791';
// pixel-compare's own lines: A = the live origin (`w`x`H`), B = the build; height delta h = A − B, the overlap is the shorter.
const pixelLog = (h, n, m, pct, v, { w = 1440, H = 3690 } = {}) => `stitched stardust/replica/gates/x/build.png: ${w}x${H - h} from 8 chunks\nA ${w}x${H}  B ${w}x${H - h}  → compare ${w}x${Math.min(H, H - h)}, height delta ${h}px\ndiffering pixels: ${n} / ${m} = ${pct}%  (threshold 10%) → ${v}\ndiff image: stardust/replica/gates/x/diff.png\n  y      0–500: 0.4%`;
const AT360 = { w: 360, H: 1450 };
// tours-north @1440: iter1 FAIL (older by endedAt, but given the NEWEST mtime below), iter2 PASS, iter3 still running with a wild FAIL.
job('tours-north-1440-iter2', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter2'], { start: 30, end: 35, exit: 0, log: pixelLog(2, 6960, 5313600, '0.13', 'PASS') });
job('tours-north-1440-iter1', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter1'], { start: 10, end: 15, exit: 2, log: pixelLog(64, 637632, 5313600, '12.00', 'FAIL') });
job('tours-north-1440-iter3', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter3', '--full'], { start: 40, end: null, log: pixelLog(0, 4780000, 5313600, '90.00', 'FAIL') });
job('tours-north-360-iter1', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '360', 'iter1'], { start: 12, end: 17, exit: 0, log: pixelLog(12, 4700, 522000, '0.90', 'PASS', AT360) });
job('home-1440-iter1', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '1440'], { start: 20, end: 26, exit: 0, log: pixelLog(-3, 69600, 5313600, '1.31', 'PASS') });
for (const f of readdirSync(BG)) utimesSync(join(BG, f), new Date(T0), new Date(f.includes('iter1') ? Date.now() : T0)); // mtime lies: iter1 newest
job('cd-tours-north', 'node', ['stardust/scripts/diff/content-diff.mjs', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '--profile', 'generic'], { start: 50, end: 52, log: 'content-diff generic @1280\n  live: 12 headings\n\nFindings: none — content + roles match' });
job('cd-about-history', 'node', ['stardust/scripts/diff/content-diff.mjs', `${LIVE}/about/history.html`, `${PROTO}/about-history-proposed.html`, '--profile', 'generic'], { start: 50, end: 53, log: 'content-diff generic @1280\n\nFindings: 3 (1 structural 🔴)\n  🔴 MISSING: h2 "Timeline"' });
job('media-tours-north', 'node', ['stardust/scripts/rollout/media-reconcile.mjs', '--file', 'stardust/migrated/tours/north/index.html', '--deploy-host', 'main--site--org.example.test'], { start: 60, end: 61, log: 'media-reconcile stardust/migrated/tours/north/index.html\n====\n  ✓ keep     [200] https://cdn.example.test/a.jpg\n\n4 keep · 1 optimize · 0 omit' });
job('media-about-history', 'node', ['stardust/scripts/rollout/media-reconcile.mjs', '--file', 'stardust/migrated/about/history.html', '--deploy-host', 'main--site--org.example.test'], { start: 60, end: 62, exit: 1, log: 'media-reconcile stardust/migrated/about/history.html\n====\n  ✗ omit     [404] https://cdn.example.test/gone.jpg\n\n2 keep · 1 omit' });
job('about-variance', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/history.html`, `${LIVE}/about/team.html`, '--probe', 'hero=.hero', '--width', '1440'], { start: 1, end: 3, exit: 2, log: `sibling-variance @ 1440px, tolerance 2px\n  archetype: ${LIVE}/about/\n\n■ ${LIVE}/about/history.html: 2 delta(s)\n  height          hero: 441 vs 528\n  bg-layers       hero: scrim inverted\n\n■ ${LIVE}/about/team.html: ✓ matches the archetype\n\n✗ 1 of 2 sibling(s) vary from the archetype in: hero — budget variant classes for these before cloning; do not assume template constancy.` });
job('serve', 'python3', ['-m', 'http.server', '8791'], { start: 0, end: 90, log: 'Serving HTTP on :: port 8791' });

// ---- pure helpers ------------------------------------------------------------------------------
check('parsers read the instruments\' verdict lines and nothing else', () => {
  assert.deepEqual(parseVerdict(`${pixelLog(-9, 12, 100, '12.00', 'FAIL')}\n`), { px: 12, total: 100, pct: 12, threshold: 10, verdict: 'FAIL', heightDelta: -9, originH: 3690, buildH: 3699 });
  assert.deepEqual(parseVerdict(pixelLog(100, 1, 100, '1.00', 'PASS').replace(/^A \S+ {2}B \S+ {2}/m, '')), { px: 1, total: 100, pct: 1, threshold: 10, verdict: 'PASS', heightDelta: 100, originH: null, buildH: null }, 'no A/B sizes on the line → no origin height');
  assert.equal(parseVerdict('differing pixels: 1 / 100 = 1.00%  (threshold 10%) → PASS  [MASKED 40 rows: 0:40 — authored-volatile, excluded]').verdict, 'PASS');
  assert.equal(parseVerdict('run-bg: x launched: gate.sh a b c 1440'), null);
  assert.deepEqual(parseFindings('x\nFindings: none — content + roles match\n'), { total: 0, structural: 0, text: 'none — content + roles match' });
  assert.deepEqual(parseFindings('Findings: 3 (1 structural 🔴)\n  🔴 MISSING'), { total: 3, structural: 1, text: '3 (1 structural 🔴)' });
  assert.equal(parseFindings('content-diff: 2 (0 structural 🔴)').structural, 0);
  assert.equal(parseFindings('content-diff: DEADLINE (exit 124) — re-run, not a verdict'), null);
  assert.deepEqual(parseCounts('  ✓ keep [200] x\n\n4 keep · 1 optimize · 0 omit\n').counts, { keep: 4, optimize: 1, omit: 0 });
  assert.deepEqual(parseCounts('3 optimize · 2 unresolved').counts, { optimize: 3, unresolved: 2 });
  assert.equal(parseCounts('  live: 12 headings\n0 P0 · 0 P1 · 1 P2'), null);
  assert.deepEqual(parseLint('delivery-lint x\n\n1 P0 · 0 P1 · 2 P2\n'), { p0: 1, p1: 0, p2: 2, line: '1 P0 · 0 P1 · 2 P2' });
  assert.deepEqual(parseOverflow(`${pixelLog(0, 1, 100, '0.01', 'PASS')}\ngate.sh: OVERFLOW at 360 — build scrollWidth 373 > viewport 360 (+13px) → FAIL (hard assert: no iteration cap waives horizontal overflow; evidence x/overflow-iter1.txt)\n`), { width: 360, px: 13, scrollWidth: 373, viewport: 360 });
  assert.deepEqual(parseOverflow('gate.sh: overflow assert at 1440 — build scrollWidth 1440 = viewport → ok'), { width: 1440, px: 0, scrollWidth: null, viewport: null });
  assert.equal(parseOverflow(pixelLog(0, 1, 100, '0.01', 'PASS')), null, 'a round that predates the assert has no overflow fact');
  assert.equal(parseOverflow('measure: x @360: horizontal overflow +13px (scrollWidth 373 > viewport 360)'), null, 'measure\'s own warning is not gate.sh\'s verdict line');
  const log = read(join(BG, 'about-variance.log'));
  const vl = parseVariance(log, pagePaths('about/history.html')); assert.equal(vl.deltas, 2); assert.match(vl.line, /^■ .*history\.html: 2 delta\(s\)$/); assert.match(vl.summary, /^✗ 1 of 2 sibling/);
  assert.equal(parseVariance(log, pagePaths('about/team.html')).deltas, 0);
  const vn = parseVariance(log, pagePaths('other.html')); assert.equal(vn.deltas, null); assert.match(vn.line, /^✗ 1 of 2/); assert.equal(vn.own, false); assert.equal(vl.own, true);
  assert.equal(parseVariance('sibling-variance error: boom'), null);
});
check('heightBar: each regime\'s default bar (prototype 8px, published 5 % of the origin height); a given tolerance ≤ 1 is a fraction, > 1 pixels, for both regimes; a fraction without an origin height has no bar', () => {
  assert.deepEqual(heightBar('prototype', null, 3000), { px: 8, text: '8px' });
  assert.deepEqual(heightBar('published', null, 3000), { px: 150, text: '5 % of origin 3000px = 150px' });
  assert.deepEqual(heightBar('published', null, null), { px: null, text: '5 % of origin height' });
  assert.deepEqual(heightBar('prototype', 1, 3000), { px: 3000, text: '100 % of origin 3000px = 3000px' }, '1 is still a fraction');
  assert.deepEqual(heightBar('published', 1.5, null), { px: 1.5, text: '1.5px' }, 'above 1 is pixels — no origin height needed');
  assert.deepEqual(heightBar('prototype', 0.02, null), { px: null, text: '2 % of origin height' });
});
check('regimeOf: localhost / 127.0.0.1 / file: build URLs are the prototype regime, anything else published; deadline() reads run-bg state', () => {
  const px = (build) => ({ instArgs: ['home', `${LIVE}/`, build, '1440'] });
  for (const u of [`${PROTO}/home-proposed.html`, 'http://127.0.0.1:8080/x.html', 'http://localhost/x', 'file:///tmp/home-proposed.html', 'HTTP://LOCALHOST:1/x']) assert.equal(regimeOf(px(u)), 'prototype', u);
  for (const u of [`${PUBLISHED}/`, 'https://localhost.example.test/', 'https://www.example.test/127.0.0.1/', 'http://localhostx:80/', '']) assert.equal(regimeOf(px(u)), 'published', u);
  assert.equal(deadline({ timedOut: true, exit: 0 }), true); assert.equal(deadline({ timedOut: false, exit: 124 }), true); assert.equal(deadline({ timedOut: false, exit: 2 }), false);
});
check('page identity helpers: URL paths, the DA path, the indent', () => {
  assert.deepEqual(pagePaths('index.html'), ['/index.html', '/']);
  assert.deepEqual(pagePaths('tours/north/index.html'), ['/tours/north/index.html', '/tours/north/', '/tours/north']);
  assert.deepEqual(pagePaths('about/history.html'), ['/about/history.html', '/about/history']);
  assert.equal(daPath('index.html'), '/'); assert.equal(daPath('tours/north/index.html'), '/tours/north'); assert.equal(daPath('about/history.html'), '/about/history');
  assert.deepEqual(contentFileFor(CONTENT, 'tours/north/index.html'), { file: join(CONTENT, 'tours/north.html'), exists: true });
  assert.deepEqual(contentFileFor(CONTENT, 'about/history.html'), { file: join(CONTENT, 'about/history.html'), exists: true });
  assert.deepEqual(contentFileFor(CONTENT, 'index.html'), { file: join(CONTENT, 'index.html'), exists: false }, 'the root page is <content>/index.html; absent → the first candidate is named');
  mkdirSync(join(CONTENT, 'tours/east'), { recursive: true }); writeFileSync(join(CONTENT, 'tours/east/index.html'), '<main></main>');
  assert.deepEqual(contentFileFor(CONTENT, 'tours/east/index.html'), { file: join(CONTENT, 'tours/east/index.html'), exists: true }, 'a folder index is the second candidate');
  rmSync(join(CONTENT, 'tours/east'), { recursive: true, force: true });
  assert.equal(detectIndent('{\n "a": 1\n}'), ' '); assert.equal(detectIndent('{\n  "a": 1\n}'), '  '); assert.equal(detectIndent('{"a":1}'), 2);
});
check('attribute: gate.sh by its slug argument; URLs by path; files by cwd; slug word boundary; longest name prefix wins', () => {
  const north = { slug: 'tours-north', outputPath: 'tours/north/index.html' }; const tours = { slug: 'tours', outputPath: 'tours/index.html' }; const bare = { slug: 'north', outputPath: 'north/index.html' };
  const ctx = { migrated: MIG, slugs: ['tours', 'tours-north', 'north'] };
  const px = { kind: 'pixel', name: 'x', instArgs: ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440'], cwd: root };
  assert.equal(attribute(px, north, ctx), true); assert.equal(attribute(px, tours, ctx), false);
  const cd = { kind: 'content-diff', name: 'cd-7', instArgs: [`${LIVE}/tours/north`, `${PROTO}/tours-north-proposed.html`], cwd: root };
  assert.equal(attribute(cd, north, ctx), true); assert.equal(attribute(cd, tours, ctx), false); assert.equal(attribute(cd, bare, ctx), false, '`north` must not claim tours-north-proposed.html');
  const md = { kind: 'media-reconcile', name: 'media-7', instArgs: ['--file', 'stardust/migrated/tours/north/index.html'], cwd: root };
  assert.equal(attribute(md, north, ctx), true); assert.equal(attribute(md, tours, ctx), false);
  const byName = { kind: 'delivery-lint', name: 'tours-north-lint', instArgs: ['--file', 'elsewhere.html'], cwd: root };
  assert.equal(attribute(byName, north, ctx), true); assert.equal(attribute(byName, tours, ctx), false);
  // The name fallback only when no argument names ANY known page: a job called tours-north-… whose --file is another page's is that page's.
  const history = { slug: 'about-history', outputPath: 'about/history.html' };
  const misnamed = { kind: 'delivery-lint', name: 'tours-north-lint2', instArgs: ['--file', 'stardust/migrated/about/history.html'], cwd: root };
  const ctxPages = { ...ctx, pages: [north, tours, bare, history], slugs: [...ctx.slugs, 'about-history'] };
  assert.equal(attribute(misnamed, history, ctxPages), true); assert.equal(attribute(misnamed, north, ctxPages), false, 'named after tours-north, but its argument names about-history');
  assert.equal(attribute(byName, north, ctxPages), true, 'no argument names any known page → the name still decides');
  assert.equal(nameOwner('tours-north-1440-iter2', ctx.slugs), 'tours-north'); assert.equal(nameOwner('tours-1440', ctx.slugs), 'tours'); assert.equal(nameOwner('cd-1', ctx.slugs), null);
});

// ---- the CLI over the fixture ------------------------------------------------------------------
const before = { north: read(side.north), history: read(side.history), home: read(side.home), progress: read(PROGRESS) };
check('--dry-run computes and prints but writes nothing', () => {
  const r = run('--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^tours-north {2}sibling {2}1440=0\.13%\/Δ2 {2}360=0\.90%\/Δ12 {2}cd=none {2}lint=0P0·0P1·1P2 {2}media=4keep·1optimize·0omit {2}gates=5$/m);
  assert.match(r.out, /3 pages, 3 sidecars would be updated \(dry-run: nothing written\)/);
  assert.equal(read(side.north), before.north); assert.equal(read(side.history), before.history); assert.equal(read(side.home), before.home); assert.equal(read(PROGRESS), before.progress);
});
check('a run: one row per page (walk order), the missing lines, the summary, no notes', () => {
  const r = run(); assert.equal(r.code, 0, r.err);
  const rows = r.out.trim().split('\n');
  assert.match(rows[0], /^home {2}archetype {2}1440=1\.31%\/Δ-3 {2}360=— {2}cd=— {2}lint=1P0·0P1·0P2 {2}media=— {2}gates=1$/);
  assert.match(rows[1], /^about-history {2}sibling {2}1440=— {2}360=— {2}cd=3\(1🔴\) {2}lint=1P0·0P1·0P2 {2}media=2keep·1omit {2}gates=1$/);
  assert.match(rows[2], /^tours-north {2}sibling /);
  assert.match(r.out, /^about-history: missing pixel-gate-1440, pixel-gate-360, delivery-lint, media-reconcile, content-fidelity, content-count$/m);
  assert.match(r.out, /^tours-north: missing variance-probe, pixel-gate-360$/m);
  assert.match(r.out, /^gate-evidence: 3 pages, 3 sidecars updated$/m);
  assert.equal(r.err, '');
});
check('tours-north: the declaration stays first, then the derived gates in order; no pixel-gate-360 — and the set reports it missing', () => {
  const m = json(side.north);
  assert.deepEqual(m.gatesPassed, ['content-fidelity', 'pixel-gate-1440', 'content-count', 'media-reconcile', 'delivery-lint']);
  assert.equal(m.gateEvidence['content-fidelity'], NORTH0.gateEvidence['content-fidelity']);
  assert.deepEqual(json(PROGRESS).migrate.missing['tours-north'], ['variance-probe', 'pixel-gate-360'], 'a FAIL round at 360 leaves the pixel gate missing from the acceptance set');
});
check('tours-north evidence: latest round by endedAt (not mtime), the running round ignored, every job line ends with its log pointer', () => {
  const e = json(side.north).gateEvidence;
  assert.equal(e['pixel-gate-1440'], '0.13% (6960 px, threshold 10%), height delta 2px, round iter2 @1440 (tours-north-1440-iter2.log) [prototype regime: |Δh| ≤ 8px]');
  assert.match(e['pixel-gate-360'], /^FAIL: \|height delta\| 12px > 8px \(prototype regime\) — 0\.90% .*height delta 12px, round iter1 @360 \(tours-north-360-iter1\.log\) \[prototype regime: \|Δh\| ≤ 8px\]$/);
  assert.equal(e['content-count'], 'content-diff: none — content + roles match (cd-tours-north.log)');
  assert.equal(e['media-reconcile'], '4 keep · 1 optimize · 0 omit (media-tours-north.log)');
  assert.equal(e['delivery-lint'], '0 P0 · 0 P1 · 1 P2 (delivery-lint --path /tours/north)');
  assert.doesNotMatch(JSON.stringify(e), /iter3|90\.00/, 'the still-running round left no trace');
  for (const g of ['content-count', 'media-reconcile']) assert.match(e[g], /\([a-z0-9-]+\.log\)$/, g);
  for (const g of ['pixel-gate-1440', 'pixel-gate-360']) assert.match(e[g], /\([a-z0-9-]+\.log\) \[prototype regime: \|Δh\| ≤ 8px\]$/, g);
});
check('about-history: only variance-probe passes; the others are recorded OPEN:/FAIL: with their pointers', () => {
  const m = json(side.history);
  assert.deepEqual(m.gatesPassed, ['variance-probe']);
  assert.equal(m.gateEvidence['variance-probe'], `■ ${LIVE}/about/history.html: 2 delta(s) — variants [about--compact] (about-variance.log)`);
  assert.equal(m.gateEvidence['content-count'], 'OPEN: content-diff: 3 (1 structural 🔴) (cd-about-history.log)');
  assert.equal(m.gateEvidence['media-reconcile'], 'OPEN: 1 omit hold the gate — 2 keep · 1 omit (media-about-history.log)');
  assert.equal(m.gateEvidence['delivery-lint'], 'FAIL: 1 P0 · 0 P1 · 0 P2 (delivery-lint --path /about/history)');
  assert.equal('pixel-gate-1440' in m.gateEvidence, false);
});
check('home (archetype): its own pixel round, lint FAIL at path /, no variance-probe at all; not delivered → media-reconcile reads n/a, never OPEN', () => {
  const m = json(side.home);
  assert.deepEqual(m.gatesPassed, ['pixel-gate-1440']);
  assert.match(m.gateEvidence['pixel-gate-1440'], /height delta -3px, round iter @1440 \(home-1440-iter1\.log\) \[prototype regime: \|Δh\| ≤ 8px\]$/);
  assert.equal(m.gateEvidence['delivery-lint'], 'FAIL: 1 P0 · 0 P1 · 0 P2 (delivery-lint --path /)');
  assert.equal('variance-probe' in m.gateEvidence, false);
  assert.equal(m.gateEvidence['media-reconcile'], 'n/a: no delivered content file yet (content/index.html) — media-reconcile runs in the delivery chain (row C)');
});
check('sidecars: every other key untouched, key order kept, indent + trailing newline preserved, stray JSON ignored', () => {
  const n = json(side.north); const { gatesPassed: g1, gateEvidence: e1, ...restN } = n; const { gatesPassed: g0, gateEvidence: e0, ...rest0 } = NORTH0;
  assert.deepEqual(restN, rest0); assert.deepEqual(Object.keys(n), Object.keys(NORTH0)); assert.ok(g1 && e1 && g0 && e0);
  assert.ok(read(side.north).startsWith('{\n "slug"') && read(side.north).endsWith('}\n'), 'indent 1 + trailing newline kept');
  const h = json(side.history); const { gatesPassed: gh, gateEvidence: eh, ...restH } = h; assert.deepEqual(restH, HISTORY0); assert.ok(gh && eh);
  assert.deepEqual(Object.keys(h), [...Object.keys(HISTORY0), 'gatesPassed', 'gateEvidence']);
  assert.ok(read(side.history).startsWith('{\n  "slug"') && read(side.history).endsWith('}'), 'indent 2, no trailing newline kept');
  assert.equal(read(join(MIG, '_bundle.json')), '{"assets": []}\n');
});
check('progress.json: migrate totals, per-gate counts, missing sets, siblings block; prior keys and indent kept', () => {
  const p = json(PROGRESS);
  assert.deepEqual(p.pages, { tour: { archetype: 'tours', iterations: 2 } }); assert.ok(read(PROGRESS).startsWith('{\n "pages"'), 'indent 1 kept');
  assert.equal(p.migrate.pages, 3); assert.equal(p.migrate.archetypes, 1); assert.equal(p.migrate.siblings, 2); assert.equal(p.migrate.thin, 0);
  assert.ok(Date.now() - Date.parse(p.migrate.at) < 60000, p.migrate.at);
  assert.deepEqual(p.migrate.gates, { 'pixel-gate-1440': 2, 'delivery-lint': 1, 'variance-probe': 1, 'content-fidelity': 1, 'content-count': 1, 'media-reconcile': 1 });
  assert.deepEqual(p.migrate.missing, { 'about-history': ['pixel-gate-1440', 'pixel-gate-360', 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count'], 'tours-north': ['variance-probe', 'pixel-gate-360'] });
  const s = p.siblings['tours-north'];
  assert.equal(s.archetype, 'tours'); assert.deepEqual(s.variants, ['tours--wide']); assert.equal(s.pixel['1440'].pct, 0.13); assert.equal(s.pixel['1440'].label, 'iter2');
  assert.deepEqual(s.pixel['360'], { pct: 0.9, px: 4700, heightDelta: 12, overflowX: null, verdict: 'PASS', label: 'iter1', regime: 'prototype' }, 'overflowX null: the round predates the assert');
  assert.equal(s.contentDiff, 'none — content + roles match'); assert.equal(s.deliveryLint, '0 P0 · 0 P1 · 1 P2'); assert.equal(s.media, '4 keep · 1 optimize · 0 omit');
  assert.equal(s.migrated, 'stardust/migrated/tours/north/index.html'); assert.deepEqual(s.gatesPassed, json(side.north).gatesPassed);
  assert.equal(p.siblings['about-history'].archetype, 'about'); assert.equal('home' in p.siblings, false);
});
check('a second run is idempotent: sidecars byte-identical, ledger identical but for migrate.at, 0 sidecars updated', () => {
  const snap = { north: read(side.north), history: read(side.history), home: read(side.home), progress: json(PROGRESS) };
  const r = run(); assert.equal(r.code, 0, r.err); assert.match(r.out, /3 pages, 0 sidecars updated/);
  assert.equal(read(side.north), snap.north); assert.equal(read(side.history), snap.history); assert.equal(read(side.home), snap.home);
  const again = json(PROGRESS); delete again.migrate.at; delete snap.progress.migrate.at; assert.deepEqual(again, snap.progress);
});
check('--check exits 2 and names every sibling short of the acceptance set, pixel gates included; the archetype is never listed', () => {
  const r = run('--check'); assert.equal(r.code, 2);
  assert.match(r.out, /^about-history: missing pixel-gate-1440, pixel-gate-360, delivery-lint, media-reconcile, content-fidelity, content-count$/m); assert.match(r.out, /^tours-north: missing variance-probe, pixel-gate-360$/m);
  assert.doesNotMatch(r.out, /^home: missing/m, 'the archetype (no 360 round, lint FAIL) is not held to the sibling set');
  assert.deepEqual(ACCEPTANCE, ['variance-probe', 'pixel-gate-1440', 'pixel-gate-360', 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count']);
  assert.deepEqual(acceptanceFor([1440, 360]), ACCEPTANCE); assert.deepEqual(acceptanceFor([360, 1440]).slice(1, 3), ['pixel-gate-360', 'pixel-gate-1440'], 'pixel gates follow the --widths order');
});
check('--widths 1440 alone drops pixel-gate-360 from the acceptance set: rows, --check lines, the table column', () => {
  assert.deepEqual(acceptanceFor([1440]), ['variance-probe', 'pixel-gate-1440', 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count']);
  const r = run('--widths', '1440', '--check', '--dry-run', '--json'); assert.equal(r.code, 2, r.err);
  const rows = JSON.parse(r.out); const missing = (slug) => rows.find((x) => x.slug === slug).missing;
  assert.deepEqual(missing('tours-north'), ['variance-probe']); assert.deepEqual(missing('about-history'), ['pixel-gate-1440', 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count']); assert.deepEqual(missing('home'), []);
  const t = run('--widths', '1440', '--check', '--dry-run'); assert.equal(t.code, 2, t.err);
  assert.match(t.out, /^tours-north: missing variance-probe$/m); assert.doesNotMatch(t.out, /pixel-gate-360/); assert.match(t.out, /^tours-north {2}sibling {2}1440=0\.13%\/Δ2 {2}cd=/m, 'no 360 column');
});
check('--slug limits the rows and never rewrites the ledger totals; an unknown slug is a usage error', () => {
  const { at } = json(PROGRESS).migrate;
  const r = run('--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim().split('\n').filter((l) => /^\S+ {2}(sibling|archetype|thin) /.test(l)).length, 1); assert.match(r.out, /1 page, 0 sidecars updated/);
  const p = json(PROGRESS); assert.equal(p.migrate.at, at); assert.equal(p.migrate.pages, 3); assert.ok(p.siblings['about-history']);
  const bad = run('--slug', 'nope'); assert.equal(bad.code, 1); assert.match(bad.err, /no sidecar with slug nope/); assert.doesNotMatch(bad.err, /\n\s+at /);
});
check('--json prints the rows as a JSON array', () => {
  const r = run('--json'); assert.equal(r.code, 0, r.err);
  const rows = JSON.parse(r.out); assert.equal(rows.length, 3);
  const n = rows.find((x) => x.slug === 'tours-north');
  assert.equal(n.tier, 'sibling'); assert.equal(n.pixel['1440'].pct, 0.13); assert.deepEqual(n.missing, ['variance-probe', 'pixel-gate-360']); assert.equal(n.outputPath, 'tours/north/index.html'); assert.ok(n.gateEvidence['content-count']);
});
check('--help in an empty cwd: exit 0, usage on stdout, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-evidence-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /usage/i); assert.match(r.stdout, /content-fidelity\s+NEVER added here/); assert.match(r.stdout, /--height-tolerance <v>/); assert.match(r.stdout, /\[published regime: \|Δh\| ≤ 5 % of origin 3000px = 150px\]/); assert.match(r.stdout, /no origin height in the round's log — re-run/);
  assert.match(r.stdout, /--content <dir>/); assert.match(r.stdout, /n\/a: no delivered content file yet/); assert.match(r.stdout, /FAIL: horizontal overflow/); assert.match(r.stdout, /\[\/ovf\+<px>\]/);
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true, force: true });
});
check('usage errors exit 1 with a message and no stack trace; an absent --migrated dir is not an error', () => {
  for (const args of [['--widths', 'abc'], ['--height-tolerance', '-1'], ['--bogus'], ['--slug']]) { const r = run(...args); assert.equal(r.code, 1, args.join(' ')); assert.match(r.err, /^gate-evidence: /); assert.doesNotMatch(r.err, /\n\s+at /); }
  const r = run('--migrated', 'nowhere'); assert.equal(r.code, 0); assert.match(r.out, /no _meta\.json sidecars under nowhere/);
});
check('without a resolvable --lint the latest delivery-lint job stands in, and one note says how to fix it', () => {
  job('lint-tours-north', 'node', ['stardust/scripts/rollout/delivery-lint.mjs', '--file', 'stardust/migrated/tours/north/index.html', '--path', '/tours/north'], { start: 70, end: 71, log: 'delivery-lint stardust/migrated/tours/north/index.html (type:page)\n  clean\n\n0 P0 · 0 P1 · 0 P2' });
  const r = run('--lint', join(root, 'missing-lint.mjs'), '--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^gate-evidence: delivery-lint: .*missing-lint\.mjs not found — pass --lint/m);
  assert.equal(json(side.north).gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (lint-tours-north.log)');
});


// ---- hardening: regime, deadline, no verdict, stale, not-in-probe, malformed ledger ----------------
check('a published-origin round is the published regime: evidence suffix and the progress.json regime field', () => {
  job('tours-north-360-pub', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PUBLISHED}/tours/north/`, '360', 'pub1', '--marker', 'north'], { start: 80, end: 84, exit: 0, log: pixelLog(0, 2600, 522000, '0.50', 'PASS', AT360) });
  const r = run('--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  const m = json(side.north);
  assert.equal(m.gateEvidence['pixel-gate-360'], '0.50% (2600 px, threshold 10%), height delta 0px, round pub1 @360 (tours-north-360-pub.log) [published regime: |Δh| ≤ 5 % of origin 1450px = 72.5px]');
  assert.ok(m.gatesPassed.includes('pixel-gate-360'), 'the published round passes the gate the prototype round failed');
  assert.equal(m.gateEvidence['pixel-gate-1440'].endsWith('[prototype regime: |Δh| ≤ 8px]'), true, 'the 1440 gate still reads prototype');
  const p = json(PROGRESS).siblings['tours-north'].pixel; assert.equal(p['360'].regime, 'published'); assert.equal(p['1440'].regime, 'prototype'); assert.equal(p['360'].label, 'pub1');
});
check('the overflow assert outranks the pixel line: a PASS round whose log carries gate.sh\'s OVERFLOW line is FAIL: horizontal overflow — row /ovf+<px>, ledger overflowX; a later clean-assert round passes with overflowX 0', () => {
  job('tours-north-360-ovf1', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PUBLISHED}/tours/north/`, '360', 'ovf1', '--marker', 'north'], { start: 85, end: 86, exit: 2, log: `${pixelLog(0, 2100, 522000, '0.40', 'PASS', AT360)}\ngate.sh: OVERFLOW at 360 — build scrollWidth 373 > viewport 360 (+13px) → FAIL (hard assert: no iteration cap waives horizontal overflow; evidence stardust/replica/gates/tours-north-360/overflow-ovf1.txt)` });
  let r = run('--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  let m = json(side.north);
  assert.equal(m.gateEvidence['pixel-gate-360'], 'FAIL: horizontal overflow +13px at 360 (scrollWidth 373 > viewport 360) — 0.40% (2100 px, threshold 10%), height delta 0px, round ovf1 @360 (tours-north-360-ovf1.log) [published regime: |Δh| ≤ 5 % of origin 1450px = 72.5px]');
  assert.match(r.err, /tours-north: pixel-gate-360 stays in gatesPassed, but the latest evidence reads "FAIL: horizontal overflow/);
  assert.match(r.out, /^tours-north {2}sibling {2}1440=0\.13%\/Δ2 {2}360=0\.40%\/Δ0\/ovf\+13 {2}cd=/m, r.out);
  let p = json(PROGRESS).siblings['tours-north'].pixel['360']; assert.equal(p.overflowX, 13); assert.equal(p.verdict, 'PASS', 'the pixel verdict is reported as printed; the gate is what the overflow withholds'); assert.equal(p.label, 'ovf1');
  const c = run('--check', '--slug', 'tours-north', '--dry-run'); assert.equal(c.code, 2); assert.match(c.out, /^tours-north: stale pixel-gate-360/m);
  job('tours-north-360-ovf2', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PUBLISHED}/tours/north/`, '360', 'ovf2', '--marker', 'north'], { start: 87, end: 88, exit: 0, log: `${pixelLog(0, 2600, 522000, '0.50', 'PASS', AT360)}\ngate.sh: overflow assert at 360 — build scrollWidth 360 = viewport → ok` });
  r = run('--slug', 'tours-north'); assert.equal(r.code, 0, r.err); m = json(side.north);
  assert.equal(m.gateEvidence['pixel-gate-360'], '0.50% (2600 px, threshold 10%), height delta 0px, round ovf2 @360 (tours-north-360-ovf2.log) [published regime: |Δh| ≤ 5 % of origin 1450px = 72.5px]');
  assert.match(r.out, /^tours-north {2}sibling {2}1440=0\.13%\/Δ2 {2}360=0\.50%\/Δ0 {2}cd=/m, 'no /ovf suffix on a clean assert');
  p = json(PROGRESS).siblings['tours-north'].pixel['360']; assert.equal(p.overflowX, 0);
});
check('one height bar in the log rule: a published round at 5 % of its origin height (A on pixel-compare\'s line), a prototype round at 8px; --height-tolerance ≤ 1 a fraction, > 1 pixels, for both regimes; a fraction bar on a log without the A size is OPEN, never a pass', () => {
  const sideC = join(MIG, 'contact._meta.json'); const made = [];
  writeFileSync(join(MIG, 'contact.html'), '<html><body><main><h1>Contact</h1></main></body></html>\n');
  writeFileSync(sideC, `${JSON.stringify({ slug: 'contact', type: 'contact', fidelityTier: 'archetype', template: null, gatesPassed: [] }, null, 2)}\n`);
  const round = (name, build, width, start, log) => { made.push(name); job(name, GATE, ['contact', `${LIVE}/contact.html`, build, String(width), name.split('-').pop()], { start, end: start + 1, exit: 0, log }); };
  const rowOf = (...args) => { const r = run('--slug', 'contact', '--dry-run', '--json', ...args); assert.equal(r.code, 0, r.err); return JSON.parse(r.out)[0]; };
  const ev = (...args) => rowOf(...args).gateEvidence;
  try {
    round('contact-1440-pub1', `${PUBLISHED}/contact`, 1440, 300, pixelLog(100, 21000, 4176000, '0.50', 'PASS', { H: 3000 }));
    round('contact-360-proto1', `${PROTO}/contact-proposed.html`, 360, 300, pixelLog(10, 1000, 1076400, '0.09', 'PASS', { w: 360, H: 3000 }));
    const row = rowOf();
    assert.equal(row.gateEvidence['pixel-gate-1440'], '0.50% (21000 px, threshold 10%), height delta 100px, round pub1 @1440 (contact-1440-pub1.log) [published regime: |Δh| ≤ 5 % of origin 3000px = 150px]');
    assert.equal(row.gateEvidence['pixel-gate-360'], 'FAIL: |height delta| 10px > 8px (prototype regime) — 0.09% (1000 px, threshold 10%), height delta 10px, round proto1 @360 (contact-360-proto1.log) [prototype regime: |Δh| ≤ 8px]');
    assert.deepEqual(row.gatesPassed, ['pixel-gate-1440']);
    let e = ev('--height-tolerance', '0.02');
    assert.equal(e['pixel-gate-1440'], 'FAIL: |height delta| 100px > 2 % of origin 3000px = 60px (published regime) — 0.50% (21000 px, threshold 10%), height delta 100px, round pub1 @1440 (contact-1440-pub1.log) [published regime: |Δh| ≤ 2 % of origin 3000px = 60px]');
    assert.equal(e['pixel-gate-360'], '0.09% (1000 px, threshold 10%), height delta 10px, round proto1 @360 (contact-360-proto1.log) [prototype regime: |Δh| ≤ 2 % of origin 3000px = 60px]', 'a given fraction is the prototype regime\'s bar too');
    e = ev('--height-tolerance', '12');
    assert.match(e['pixel-gate-1440'], /^FAIL: \|height delta\| 100px > 12px \(published regime\) — .* \[published regime: \|Δh\| ≤ 12px\]$/, 'a given pixel bar is the published regime\'s bar too');
    assert.match(e['pixel-gate-360'], /^0\.09% .* \[prototype regime: \|Δh\| ≤ 12px\]$/);
    assert.match(ev('--height-tolerance', '100')['pixel-gate-1440'], /^0\.50% .* \[published regime: \|Δh\| ≤ 100px\]$/, '|Δh| equal to the bar passes, as in gate-all');
    round('contact-1440-pub2', `${PUBLISHED}/contact`, 1440, 302, pixelLog(160, 20000, 4089600, '0.49', 'PASS', { H: 3000 }));
    assert.equal(ev()['pixel-gate-1440'], 'FAIL: |height delta| 160px > 5 % of origin 3000px = 150px (published regime) — 0.49% (20000 px, threshold 10%), height delta 160px, round pub2 @1440 (contact-1440-pub2.log) [published regime: |Δh| ≤ 5 % of origin 3000px = 150px]');
    const noOrigin = (h, n, pct, v) => pixelLog(h, n, 4176000, pct, v, { H: 3000 }).replace(/^A \S+ {2}B \S+ {2}/m, '');
    round('contact-1440-pub3', `${PUBLISHED}/contact`, 1440, 304, noOrigin(100, 21000, '0.50', 'PASS'));
    const open = rowOf();
    assert.equal(open.gateEvidence['pixel-gate-1440'], 'OPEN: no origin height in the round\'s log — re-run — 0.50% (21000 px, threshold 10%), height delta 100px, round pub3 @1440 (contact-1440-pub3.log) [published regime: |Δh| ≤ 5 % of origin height]');
    assert.equal(open.gatesPassed.includes('pixel-gate-1440'), false);
    assert.match(ev('--height-tolerance', '0.5')['pixel-gate-1440'], /^OPEN: no origin height in the round's log — re-run — .* \[published regime: \|Δh\| ≤ 50 % of origin height\]$/, 'any fraction bar needs the origin height');
    assert.match(ev('--height-tolerance', '120')['pixel-gate-1440'], /^0\.50% .* \[published regime: \|Δh\| ≤ 120px\]$/, 'a pixel bar does not');
    round('contact-1440-pub4', `${PUBLISHED}/contact`, 1440, 306, noOrigin(100, 600000, '14.37', 'FAIL'));
    assert.match(ev()['pixel-gate-1440'], /^FAIL: 14\.37% .* \[published regime: \|Δh\| ≤ 5 % of origin height\]$/, 'a pixel FAIL is a verdict without the origin height');
  } finally {
    for (const n of made) { rmSync(join(BG, `${n}.json`)); rmSync(join(BG, `${n}.log`)); }
    rmSync(sideC); rmSync(join(MIG, 'contact.html'));
  }
});
check('media-reconcile is required only once the delivered content file exists: absent → `n/a:` (latest run cited as advisory), dropped from the acceptance set and --check; present → OPEN and required again; --content moves the tree', () => {
  const file = join(CONTENT, 'about/history.html'); const keep = read(file);
  let m = json(side.history); assert.equal(m.gateEvidence['media-reconcile'], 'OPEN: 1 omit hold the gate — 2 keep · 1 omit (media-about-history.log)');
  rmSync(file);
  let r = run('--slug', 'about-history'); assert.equal(r.code, 0, r.err); m = json(side.history);
  assert.equal(m.gateEvidence['media-reconcile'], 'n/a: no delivered content file yet (content/about/history.html) — media-reconcile runs in the delivery chain (row C) — latest run 2 keep · 1 omit (media-about-history.log) is advisory until then');
  assert.equal(m.gatesPassed.includes('media-reconcile'), false);
  let j = JSON.parse(run('--slug', 'about-history', '--check', '--dry-run', '--json').out)[0];
  assert.deepEqual(j.missing, ['pixel-gate-1440', 'pixel-gate-360', 'delivery-lint', 'content-fidelity', 'content-count'], 'media-reconcile is not demanded before delivery'); assert.equal(j.delivered, false); assert.deepEqual(j.stale, []);
  assert.match(run('--slug', 'about-history', '--check', '--dry-run').out, /^about-history: missing pixel-gate-1440, pixel-gate-360, delivery-lint, content-fidelity, content-count$/m);
  writeFileSync(file, keep);
  r = run('--slug', 'about-history'); assert.equal(r.code, 0, r.err); m = json(side.history);
  assert.equal(m.gateEvidence['media-reconcile'], 'OPEN: 1 omit hold the gate — 2 keep · 1 omit (media-about-history.log)', 'the file exists again: the gate is required and its OPEN is back');
  j = JSON.parse(run('--slug', 'about-history', '--check', '--dry-run', '--json').out)[0]; assert.ok(j.missing.includes('media-reconcile')); assert.equal(j.delivered, true);
  // --content: a tree where nothing is delivered
  j = JSON.parse(run('--content', 'nowhere', '--slug', 'tours-north', '--dry-run', '--json').out)[0];
  assert.equal(j.delivered, false); assert.equal(j.missing.includes('media-reconcile'), false);
  assert.ok(j.gatesPassed.includes('media-reconcile'), 'a pass earned earlier stays a pass');
  assert.equal(j.gateEvidence['media-reconcile'], '4 keep · 1 optimize · 0 omit (media-tours-north.log)', 'a passing job passes whether or not the file exists');
  const bad = run('--content'); assert.equal(bad.code, 1); assert.match(bad.err, /--content needs a value/);
});
check('the newest round on a deadline (timedOut / exit 124) is OPEN: deadline — an older pass is not resurrected; --full deadlines hit content-count too', () => {
  job('home-360-iter1', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '360', 'iter1'], { start: 85, end: 86, exit: 124, timedOut: true, log: 'stitched … live.png\nrun-bg: home-360-iter1 deadline 900s exceeded' });
  job('tours-north-1440-iter4', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter4', '--full'], { start: 87, end: 88, exit: 124, timedOut: true, log: `${pixelLog(1, 100, 5313600, '0.01', 'PASS')}\ncontent-diff: DEADLINE (exit 124) — re-run, not a verdict` });
  job('cd-tours-north-2', 'node', ['stardust/scripts/diff/content-diff.mjs', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`], { start: 89, end: 90, exit: 124, log: 'content-diff generic @1280\n(deadline)' });
  const r = run('--slug', 'home', '--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  const h = json(side.home);
  assert.equal(h.gateEvidence['pixel-gate-360'], 'OPEN: deadline (home-360-iter1.log) — re-run'); assert.equal(h.gatesPassed.includes('pixel-gate-360'), false);
  const n = json(side.north);
  assert.equal(n.gateEvidence['pixel-gate-1440'], 'OPEN: deadline (tours-north-1440-iter4.log) — re-run', 'the iter2 PASS is not resurrected');
  assert.equal(n.gateEvidence['content-count'], 'OPEN: deadline (cd-tours-north-2.log) — re-run', 'exit 124 without the timedOut flag counts as a deadline too');
  assert.ok(n.gatesPassed.includes('pixel-gate-1440') && n.gatesPassed.includes('content-count'), 'gates are never removed');
  assert.match(r.err, /tours-north: pixel-gate-1440 stays in gatesPassed, but the latest evidence reads "OPEN: deadline/);
  assert.match(r.out, /^tours-north {2}sibling {2}1440=— {2}360=0\.50%\/Δ0 /m, 'no pixel fact at 1440 from a deadline');
  const t = run('--slug', 'tours-north', '--json'); assert.equal(JSON.parse(t.out)[0].pixel['1440'], undefined);
});
check('a pixel round whose exit is not 0/2 (bot challenge 3, error 1, identity 4) is OPEN: no verdict, whatever its log says', () => {
  job('home-1440-iter2', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '1440', 'iter2'], { start: 91, end: 92, exit: 3, log: `${pixelLog(0, 10, 5313600, '0.00', 'PASS')}\nstitch-shot: bot challenge on the live side` });
  const r = run('--slug', 'home'); assert.equal(r.code, 0, r.err);
  const h = json(side.home);
  assert.equal(h.gateEvidence['pixel-gate-1440'], 'OPEN: no verdict (exit 3) (home-1440-iter2.log)');
  assert.equal(h.gatesPassed.includes('pixel-gate-1440'), true, 'the earlier pass stays listed (never removed) — and is now stale');
  job('home-1440-iter3', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '1440', 'iter3'], { start: 93, end: 94, exit: 4, log: pixelLog(0, 10, 5313600, '0.00', 'PASS') });
  run('--slug', 'home'); assert.equal(json(side.home).gateEvidence['pixel-gate-1440'], 'OPEN: no verdict (exit 4) (home-1440-iter3.log)');
  job('home-1440-iter4', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '1440', 'iter4'], { start: 95, end: 96, exit: 1, log: 'stitch-shot: ECONNREFUSED' });
  run('--slug', 'home'); assert.equal(json(side.home).gateEvidence['pixel-gate-1440'], 'OPEN: no verdict (exit 1) (home-1440-iter4.log)');
});
check('--check exits 2 on a stale gate (in gatesPassed, latest evidence FAIL/OPEN) and names it — for an archetype too', () => {
  const r = run('--check', '--slug', 'home', '--dry-run'); assert.equal(r.code, 2, r.err);
  assert.match(r.out, /^home: stale pixel-gate-1440 — in gatesPassed, but the latest evidence reads FAIL\/OPEN/m);
  assert.doesNotMatch(r.out, /^home: missing/m, 'the archetype is still not held to the sibling set');
  const j = run('--check', '--slug', 'home', '--dry-run', '--json'); assert.equal(j.code, 2); assert.deepEqual(JSON.parse(j.out)[0].stale, ['pixel-gate-1440']);
  const n = run('--check', '--slug', 'tours-north', '--dry-run'); assert.equal(n.code, 2); assert.match(n.out, /^tours-north: stale pixel-gate-1440, content-count — /m);
  // a real FAIL while listed: about-history gets a FAIL round at 1440 after a hand-declared pixel-gate-1440
  const hm = json(side.history); hm.gatesPassed.push('pixel-gate-1440'); hm.gateEvidence['pixel-gate-1440'] = 'declared by hand'; writeFileSync(side.history, JSON.stringify(hm, null, 2));
  job('about-history-1440-iter1', GATE, ['about-history', `${LIVE}/about/history.html`, `${PROTO}/about-history-proposed.html`, '1440', 'iter1'], { start: 97, end: 98, exit: 2, log: pixelLog(0, 1000000, 5313600, '18.82', 'FAIL') });
  const f = run('--check', '--slug', 'about-history', '--dry-run'); assert.equal(f.code, 2);
  assert.match(f.out, /^about-history: stale pixel-gate-1440 — /m); assert.match(f.out, /^about-history: missing pixel-gate-360, delivery-lint, media-reconcile, content-fidelity, content-count$/m);
  writeFileSync(side.history, JSON.stringify(HISTORY0, null, 2)); rmSync(join(BG, 'about-history-1440-iter1.json')); rmSync(join(BG, 'about-history-1440-iter1.log'));
});
check('variance-probe: a probe that never printed the page\'s ■ line is OPEN: not in the probe — under a ✗ and under a ✓ summary alike', () => {
  mkdirSync(join(MIG, 'about'), { recursive: true });
  writeFileSync(join(MIG, 'about/press.html'), '<html><body><main><p>Press</p></main></body></html>\n');
  const PRESS0 = { slug: 'about-press', type: 'article', fidelityTier: 'sibling', archetypeSource: 'about', template: 'about', variants: [], migratedAt: '2026-09-04T00:00:00.000Z' };
  const sidePress = join(MIG, 'about/press._meta.json'); writeFileSync(sidePress, `${JSON.stringify(PRESS0, null, 2)}\n`);
  job('about-variance-2', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/press.html`, `${LIVE}/about/team.html`, '--probe', 'hero=.hero'], { start: 100, end: 101, exit: 2, log: `sibling-variance @ 1440px\n\n■ ${LIVE}/about/team.html: 1 delta(s)\n  height  hero: 1 vs 2\n\n✗ 1 of 2 sibling(s) vary from the archetype in: hero — budget variant classes.` });
  let r = run('--slug', 'about-press'); assert.equal(r.code, 0, r.err);
  let m = json(sidePress);
  assert.equal(m.gateEvidence['variance-probe'], `OPEN: not in the probe — ✗ 1 of 2 sibling(s) vary from the archetype in: hero — budget variant classes. (about-variance-2.log)`);
  assert.equal(m.gatesPassed.includes('variance-probe'), false);
  job('about-variance-3', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/press.html`, '--probe', 'hero=.hero'], { start: 102, end: 103, exit: 0, log: `sibling-variance @ 1440px\n\n✓ 1 sibling(s) match the archetype` });
  r = run('--slug', 'about-press'); assert.equal(r.code, 0, r.err); m = json(sidePress);
  assert.equal(m.gateEvidence['variance-probe'], 'OPEN: not in the probe — ✓ 1 sibling(s) match the archetype (about-variance-3.log)', 'a ✓ summary without the page\'s own line never passes');
  assert.equal(m.gatesPassed.includes('variance-probe'), false);
  job('about-variance-4', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/press.html`, '--probe', 'hero=.hero'], { start: 104, end: 105, exit: 0, log: `sibling-variance @ 1440px\n\n■ ${LIVE}/about/press.html: ✓ matches the archetype\n\n✓ 1 sibling(s) match the archetype` });
  r = run('--slug', 'about-press'); assert.equal(r.code, 0, r.err); m = json(sidePress);
  assert.equal(m.gateEvidence['variance-probe'], `■ ${LIVE}/about/press.html: ✓ matches the archetype (about-variance-4.log)`); assert.deepEqual(m.gatesPassed, ['variance-probe']);
  job('about-variance-5', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/press.html`], { start: 106, end: 107, exit: 124, timedOut: true, log: 'sibling-variance @ 1440px' });
  r = run('--slug', 'about-press'); assert.equal(r.code, 0, r.err); assert.equal(json(sidePress).gateEvidence['variance-probe'], 'OPEN: deadline (about-variance-5.log) — re-run');
  job('about-variance-6', 'node', ['stardust/scripts/replica/sibling-variance.mjs', `${LIVE}/about/`, `${LIVE}/about/press.html`], { start: 108, end: 109, exit: 1, log: 'sibling-variance error: boom' });
  r = run('--slug', 'about-press'); assert.equal(r.code, 0, r.err); assert.equal(json(sidePress).gateEvidence['variance-probe'], 'OPEN: no verdict (exit 1) (about-variance-6.log)');
  for (const n of [2, 3, 4, 5, 6]) { rmSync(join(BG, `about-variance-${n}.json`)); rmSync(join(BG, `about-variance-${n}.log`)); }
  rmSync(sidePress); rmSync(join(MIG, 'about/press.html'));
});
// ---- #125: element lines outrank a pixel PASS; the pixel table is the source of record ----------------
check('parseElements reads the --full element lines', () => {
  const t = 'clip-probe: Clipped: 379 (text clipped 95, …)\ncontent-presence: Content: MISSING 0 (headings 0, links 0) / HIDDEN 284 (headings 0, links 284) / control-state 2 [published regime]\n';
  assert.deepEqual(parseElements(t), { clipped: 379, missing: 0, hidden: 284 });
  assert.deepEqual(parseElements('nothing'), { clipped: null, missing: null, hidden: null });
});
check('a --full round whose clip line counts > 0 is FAIL: clipped — over a PASS pixel line', () => {
  job('home-1440-clip', GATE, ['home', `${LIVE}/`, `${PROTO}/home-proposed.html`, '1440', 'clip1', '--full'], { start: 200, end: 202, exit: 2, log: `${pixelLog(0, 69600, 5313600, '1.31', 'PASS')}\nclip-probe: Clipped: 7 (text clipped 0, text hidden 0, controls hidden 7, controls clipped 0)\n` });
  const r = run('--dry-run', '--json', '--slug', 'home');
  const home = JSON.parse(r.out)[0];
  assert.match(home.gateEvidence['pixel-gate-1440'], /^FAIL: clipped 7 on the build \(clip-probe\)/);
  rmSync(join(BG, 'home-1440-clip.json')); rmSync(join(BG, 'home-1440-clip.log'));
});
check('with a pixel table for the width, the row decides and a page without a row is OPEN: no table row', () => {
  const dir = join(root, 'stardust/replica/gates/all-1440'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ rows: [{ slug: 'tours-north', pct: 2.1, heightDelta: 3, clipped: 0, content: { missing: 0, hidden: 0 }, pass: true, reasons: [] }, { slug: 'about-history', pct: 6.7, heightDelta: 69, clipped: 379, content: { missing: 0, hidden: 284 }, pass: false, reasons: ['clipped 379', 'content MISSING 0 / HIDDEN 284'] }] }));
  const rows = JSON.parse(run('--dry-run', '--json').out);
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.ok(by['tours-north'].gatesPassed.includes('pixel-gate-1440'));
  assert.match(by['tours-north'].gateEvidence['pixel-gate-1440'], /2\.1.*clipped 0.*all-1440\/summary\.md\) \[published regime\]/);
  assert.match(by['about-history'].gateEvidence['pixel-gate-1440'], /^FAIL: clipped 379; content MISSING 0 \/ HIDDEN 284 — /);
  assert.match(by.home.gateEvidence['pixel-gate-1440'], /^OPEN: no row in the pixel table \(all-1440\)/);
  assert.ok(by.home.stale.includes('pixel-gate-1440'), 'the declared gate is kept but reported stale');
  assert.ok(loadTables(join(root, 'stardust/replica/gates'), [1440, 360])[360].any === false);
  rmSync(join(root, 'stardust/replica/gates'), { recursive: true, force: true });
});
check('an INCONCLUSIVE table row (a polluted capture) is OPEN — never FAIL, never a pass; a null pct does not throw', () => {
  const dir = join(root, 'stardust/replica/gates/all-1440'); mkdirSync(dir, { recursive: true });
  const reasons = ['origin capture polluted: overlay left — div#consent (fixed, 92 % of the viewport)', 'font-not-loaded:Brand Sans'];
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ rows: [
    { slug: 'tours-north', inconclusive: true, pass: false, passWithOverride: false, pct: null, heightDelta: null, clipped: null, content: null, reasons, override: null, fontsNotLoaded: ['Brand Sans'] },
    { slug: 'about-history', inconclusive: true, pass: false, passWithOverride: false, pct: 3.1, heightDelta: 2, clipped: 0, content: { missing: 0, hidden: 0 }, reasons: ['build capture polluted: crawl-fullpage fallback'], override: null, fontsNotLoaded: [] },
  ] }));
  try {
    const r = run('--dry-run', '--json'); assert.equal(r.code, 0, r.err);
    const by = Object.fromEntries(JSON.parse(r.out).map((x) => [x.slug, x]));
    assert.equal(by['tours-north'].gateEvidence['pixel-gate-1440'], `OPEN: INCONCLUSIVE — ${reasons.join('; ')} — fix the capture (--hide / presence.json), not the page (stardust/replica/gates/all-1440/summary.md) [published regime]`);
    assert.match(by['about-history'].gateEvidence['pixel-gate-1440'], /^OPEN: INCONCLUSIVE — build capture polluted: crawl-fullpage fallback — fix the capture \(--hide \/ presence\.json\), not the page \(/);
    for (const s of ['tours-north', 'about-history']) assert.equal(by[s].pixel['1440'].verdict, 'INCONCLUSIVE', s);
    assert.ok(by['tours-north'].stale.includes('pixel-gate-1440'), 'a declared pass is kept but reported stale — an inconclusive row never earns it');
    assert.ok(by['about-history'].missing.includes('pixel-gate-1440'), 'a measured pct on an inconclusive row is no pass');
    const t = run('--dry-run', '--check'); assert.equal(t.code, 2, t.err);
    assert.match(t.out, /^tours-north {2}sibling {2}1440=INCONCLUSIVE {2}360=\d/m);
    assert.match(t.out, /^tours-north: stale pixel-gate-1440\b/m);
  } finally { rmSync(join(root, 'stardust/replica/gates'), { recursive: true, force: true }); }
});
check('a table row without a pixel measurement (pct null: a stitch error, a missing capture) is OPEN with its error text, `—` for the null pct and Δh — never FAIL, never a pass, no throw', () => {
  const dir = join(root, 'stardust/replica/gates/all-1440'); mkdirSync(dir, { recursive: true });
  const error = 'stitch exit 1: page.goto: net::ERR_CONNECTION_RESET';
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ rows: [
    { slug: 'tours-north', inconclusive: false, pass: false, passWithOverride: false, pixelPass: false, heightPass: false, pct: null, textPct: null, heightDelta: null, clipped: null, content: null, contentNA: 'not probed', reasons: [`pixel error: ${error}`], error },
    { slug: 'about-history', inconclusive: false, pass: false, passWithOverride: false, pct: null, heightDelta: null, clipped: 0, content: { missing: 0, hidden: 0 }, contentNA: null, reasons: ['missing capture'], error: null },
    { slug: 'home', inconclusive: false, pass: true, pct: null, heightDelta: null, clipped: null, content: null, reasons: [], error: null },
  ] }));
  const md = '(stardust/replica/gates/all-1440/summary.md) [published regime]';
  try {
    const r = run('--dry-run', '--json'); assert.equal(r.code, 0, r.err);
    const by = Object.fromEntries(JSON.parse(r.out).map((x) => [x.slug, x]));
    assert.equal(by['tours-north'].gateEvidence['pixel-gate-1440'], `OPEN: no pixel measurement — ${error} — —, height delta —, clipped n/a, content n/a ${md}`, 'row.error first');
    assert.equal(by['about-history'].gateEvidence['pixel-gate-1440'], `OPEN: no pixel measurement — missing capture — —, height delta —, clipped 0, content MISSING 0 / HIDDEN 0 ${md}`, 'no error: its reasons');
    assert.equal(by.home.gateEvidence['pixel-gate-1440'], `OPEN: no pixel measurement — —, height delta —, clipped n/a, content n/a ${md}`, 'neither: no pixel measurement — and a pass flag without a pct is no pass');
    assert.deepEqual(by['tours-north'].pixel['1440'], { pct: null, px: null, heightDelta: null, overflowX: null, clipped: null, content: null, verdict: 'OPEN', label: 'table', regime: 'published' });
    for (const s of ['tours-north', 'home']) assert.ok(by[s].stale.includes('pixel-gate-1440'), `${s}: a declared pass is kept but reported stale`);
    assert.ok(by['about-history'].missing.includes('pixel-gate-1440'), 'never earns the gate');
    const t = run('--dry-run', '--check'); assert.equal(t.code, 2, t.err); assert.doesNotMatch(t.err, /TypeError|\n\s+at /);
    assert.match(t.out, /^tours-north {2}sibling {2}1440=—\/Δ— {2}360=\d/m);
    assert.match(t.out, /^home {2}archetype {2}1440=—\/Δ— {2}360=—/m);
  } finally { rmSync(join(root, 'stardust/replica/gates'), { recursive: true, force: true }); }
});
check('without any table the log rule stands and --check notes the missing table', () => {
  const r = run('--dry-run', '--check');
  assert.match(r.out + r.err, /no pixel table for 1440 under stardust\/replica\/gates\//);
});

check('a malformed progress.json aborts (exit 1, named) before any sidecar is written; writes go through temp + rename', () => {
  const good = read(PROGRESS); writeFileSync(PROGRESS, '{ "pages": ');
  job('media-home', 'node', ['stardust/scripts/rollout/media-reconcile.mjs', '--file', 'stardust/migrated/index.html'], { start: 110, end: 111, log: 'media-reconcile\n\n3 keep' });
  const before = read(side.home);
  const r = run('--slug', 'home'); assert.equal(r.code, 1); assert.match(r.err, /^gate-evidence: .*progress\.json: /); assert.doesNotMatch(r.err, /\n\s+at /);
  assert.equal(read(side.home), before, 'the sidecar that would have gained media-reconcile is untouched');
  assert.equal(read(PROGRESS), '{ "pages": ', 'the malformed ledger is left for the human');
  writeFileSync(PROGRESS, good);
  const ok = run('--slug', 'home'); assert.equal(ok.code, 0, ok.err); assert.equal(json(side.home).gateEvidence['media-reconcile'], '3 keep (media-home.log)');
  assert.equal(readdirSync(dirname(side.home)).some((f) => f.endsWith('.tmp')), false); assert.equal(readdirSync(dirname(PROGRESS)).some((f) => f.endsWith('.tmp')), false);
});

check('a progress.json that is one archetype\'s residual record (the old documented example written as the whole file) is wrapped under types.<archetype> and the run proceeds', () => {
  const good = read(PROGRESS);
  const record = { pageType: 'landing', archetype: 'home', breakpoints: { 1440: { iterations: 3 } } };
  const bare = `${JSON.stringify(record, null, 2)}\n`;
  const wrapNote = /^gate-evidence: .*progress\.json: one archetype's record at the top level was wrapped under types\.home \(source-fidelity-gate\.md § Residual logging format\)$/m;
  // --dry-run: the wrap happens in memory only — the note is printed, the file is untouched
  writeFileSync(PROGRESS, bare);
  let r = run('--dry-run', '--slug', 'home'); assert.equal(r.code, 0, r.out + r.err); assert.match(r.err, wrapNote); assert.equal(read(PROGRESS), bare, 'dry-run writes nothing');
  // (a) a real unfiltered run: the record survives verbatim under types.home, this script's blocks are appended, the sidecar is written
  const h = json(side.home); delete h.gateEvidence['media-reconcile']; h.gatesPassed = h.gatesPassed.filter((g) => g !== 'media-reconcile'); writeFileSync(side.home, `${JSON.stringify(h, null, 2)}\n`);
  r = run(); assert.equal(r.code, 0, r.out + r.err); assert.match(r.err, wrapNote); assert.doesNotMatch(r.err, /\n\s+at /);
  let after = json(PROGRESS);
  assert.deepEqual(after.types, { home: record }, 'the record is wrapped losslessly under its own slug');
  assert.deepEqual(Object.keys(after), ['types', 'siblings', 'migrate'], 'this script appends siblings and migrate; it never writes _provenance');
  assert.equal(after.migrate.pages, 3); assert.ok('tours-north' in after.siblings);
  assert.equal(json(side.home).gateEvidence['media-reconcile'], '3 keep (media-home.log)', 'the sidecar is written as in a normal run');
  assert.equal(readdirSync(dirname(PROGRESS)).some((f) => f.endsWith('.tmp')), false);
  // (b) a record that names no archetype is refused (exit 1, named, no stack), nothing written
  writeFileSync(PROGRESS, '{ "breakpoints": {} }\n');
  const before = read(side.home);
  r = run('--slug', 'home'); assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^gate-evidence: .*progress\.json is one archetype's residual record at the top level \(breakpoints\) and names no archetype — move it under types\.<archetype> \(source-fidelity-gate\.md § Residual logging format\)$/m);
  assert.match(r.err, /names no archetype/); assert.match(r.err, /types\.<archetype>/); assert.doesNotMatch(r.err, /\n\s+at /);
  assert.equal(read(PROGRESS), '{ "breakpoints": {} }\n', 'the record is left for the human'); assert.equal(read(side.home), before, 'no sidecar written');
  // (c) `pageType` + `archetype` without `breakpoints` is a record too, and a --slug run wraps it as well
  writeFileSync(PROGRESS, '{ "pageType": "landing", "archetype": "home" }\n');
  r = run('--slug', 'home'); assert.equal(r.code, 0, r.out + r.err); assert.match(r.err, wrapNote);
  after = json(PROGRESS); assert.deepEqual(after.types, { home: { pageType: 'landing', archetype: 'home' } }); assert.deepEqual(Object.keys(after), ['types', 'siblings']);
  // (d) `pageType` alone is not a record: unchanged behaviour, the key stays at the top level
  writeFileSync(PROGRESS, '{ "pageType": "landing" }\n');
  r = run('--slug', 'home'); assert.equal(r.code, 0, r.out + r.err); assert.doesNotMatch(r.err, /wrapped under/);
  after = json(PROGRESS); assert.equal(after.pageType, 'landing'); assert.equal('types' in after, false);
  // (e) a ledger with a `types` map is never second-guessed: a top-level `breakpoints` key beside it is preserved
  const map = { _provenance: { writtenBy: 'x' }, types: { home: { pageType: 'landing', archetype: 'home', breakpoints: { 1440: { iterations: 3 } } } }, breakpoints: { 1440: {} } };
  writeFileSync(PROGRESS, `${JSON.stringify(map, null, 2)}\n`);
  r = run('--slug', 'home'); assert.equal(r.code, 0, r.out + r.err); assert.doesNotMatch(r.err, /wrapped under|names no archetype/);
  after = json(PROGRESS); assert.deepEqual(after.types, map.types); assert.deepEqual(after._provenance, map._provenance); assert.deepEqual(after.breakpoints, map.breakpoints); assert.deepEqual(after.siblings, {});
  assert.deepEqual(Object.keys(after), ['_provenance', 'types', 'breakpoints', 'siblings'], 'the map keys stay first; this script appends its own');
  writeFileSync(PROGRESS, good);
});

// ---- encoded pages (B6): the encoder's sidecar names stardust/encoded/<da-path>.html ----------------------------
// A project of one template: the archetype (its migrated HTML is the A render; the encoder placed it too), siblings the
// encoder placed with no clone (delivered, not yet delivered), one over a leftover clone, a clone page whose sidecar a
// migrate render left with `encode: null`, a stopped page, a hand-edited document (delivered) and a document gone.
const root2 = realpathSync(mkdtempSync(join(tmpdir(), 'gate-evidence-encoded-')));
const M2 = join(root2, 'stardust/migrated'); const BG2 = join(root2, 'stardust/.work/replica/bg'); const LINT2 = join(root2, 'lint-stub.mjs');
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const sib = (slug) => ({ slug, type: 'tour', renderBranch: "A'", template: 'tours', fidelityTier: 'sibling', archetypeSource: 'tours', variants: [] });
const manifest = {}; // stardust/import/tours/manifest.json: what the encoder last wrote at each path
const enc = (sidecarRel, meta, doc, { body = '<main><h1>x</h1></main>', onDisk = body, status = 'clean' } = {}) => {
  const output = { path: `stardust/encoded/${doc}`, sha: sha(body) };
  manifest[output.path] = output.sha;
  put(join(M2, sidecarRel), `${JSON.stringify({ ...meta, encode: { map: { template: 'tours' }, output }, audit: { encode: { status } } }, null, 2)}\n`);
  if (onDisk !== null) put(join(root2, output.path), onDisk);
};
put(join(M2, 'tours/index.html'), '<html><body><main><p>A render</p></main></body></html>\n');
enc('tours/_meta.json', { slug: 'tours', type: 'tour', renderBranch: 'A', template: null, fidelityTier: 'archetype' }, 'tours/index.html');
put(join(root2, 'content/tours/index.html'), '<main><h1>Tours</h1></main>\n');
enc('tours/north/_meta.json', sib('tours-north'), 'tours/north.html');
put(join(root2, 'content/tours/north.html'), '<main><h1>North</h1></main>\n');
enc('tours/south/_meta.json', sib('tours-south'), 'tours/south/index.html');
put(join(M2, 'tours/east/index.html'), '<html><body><main><p>clone</p></main></body></html>\n');
enc('tours/east/_meta.json', sib('tours-east'), 'tours/east.html');
put(join(root2, 'content/tours/east.html'), '<main><h1>East</h1></main>\n');
put(join(M2, 'tours/west/index.html'), '<html><body><main><p>clone</p></main></body></html>\n');
put(join(M2, 'tours/west/_meta.json'), `${JSON.stringify({ ...sib('tours-west'), encode: null, audit: null }, null, 2)}\n`);
enc('tours/held/_meta.json', sib('tours-held'), 'tours/held.html', { status: 'variance' });
enc('tours/edited/_meta.json', sib('tours-edited'), 'tours/edited.html', { onDisk: '<main><h1>edited by hand</h1></main>' });
put(join(root2, 'content/tours/edited.html'), '<main><h1>Edited</h1></main>\n');
enc('tours/gone/_meta.json', sib('tours-gone'), 'tours/gone.html', { onDisk: null });
// a source URL with unsanitised segments: migrate keeps About_Us/_meta.json, the encoder and stage-content use the eds-path form
enc('About_Us/_meta.json', sib('about-us'), 'about-us.html', { status: 'variance' });
put(join(root2, 'content/about-us.html'), '<main><h1>About</h1></main>\n');
put(join(root2, 'stardust/import/tours/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// The lint stub: a P0 for a file under stardust/migrated/ (a clone has no <h1>), clean for anything else.
put(LINT2, `const a = process.argv; const file = a[a.indexOf('--file') + 1];
console.log(\`delivery-lint \${file}\`);
if (file.includes('stardust/migrated/')) { console.log('  P0 h1  expected exactly one <h1>, found 0'); console.log('\\n1 P0 · 0 P1 · 1 P2'); process.exit(1); }
console.log('\\n0 P0 · 0 P1 · 0 P2');\n`);
mkdirSync(BG2, { recursive: true });
const job2 = (name, args, log, min) => {
  writeFileSync(join(BG2, `${name}.json`), JSON.stringify({ name, cmd: 'node', args, cwd: root2, timeoutSec: 900, slots: 3, queuedAt: iso(min), wrapperPid: 4242, launchedAt: iso(min + 0.1), endedAt: iso(min + 1), exit: 0, timedOut: false }, null, 1));
  writeFileSync(join(BG2, `${name}.log`), `${log}\n`);
};
job2('media-7', ['stardust/scripts/rollout/media-reconcile.mjs', '--file', 'content/tours/north.html'], 'media-reconcile content/tours/north.html\n\n3 keep', 1);
job2('media-8', ['stardust/scripts/rollout/media-reconcile.mjs', '--file', 'stardust/encoded/tours/south/index.html'], 'media-reconcile\n\n2 keep · 1 omit', 2);
const run2 = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, '--lint', LINT2, ...args], { cwd: root2, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const meta2 = (rel) => json(join(M2, rel));
const enc1 = run2();
check('an encoded page is linted on its delivered content file, else on its encoded document — never on a clone (a sibling over a leftover clone included); the evidence names the file', () => {
  assert.equal(enc1.code, 0, enc1.err);
  const north = meta2('tours/north/_meta.json'); const south = meta2('tours/south/_meta.json'); const east = meta2('tours/east/_meta.json');
  assert.equal(north.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (delivery-lint --file content/tours/north.html --path /tours/north)');
  assert.equal(south.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (delivery-lint --file stardust/encoded/tours/south/index.html --path /tours/south)');
  assert.equal(east.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (delivery-lint --file content/tours/east.html --path /tours/east)', 'the clone beside it would fail P0');
  for (const m of [north, south, east]) assert.ok(m.gatesPassed.includes('delivery-lint'), m.slug);
  assert.equal(meta2('tours/edited/_meta.json').gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (delivery-lint --file content/tours/edited.html --path /tours/edited)', 'the delivered file decides, whatever the encode');
  const about = meta2('About_Us/_meta.json');
  assert.equal(about.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 0 P2 (delivery-lint --file content/about-us.html --path /about-us)', 'the staged file (content/<encoded path>), though the page stopped');
  assert.equal('media-reconcile' in about.gateEvidence, false, 'delivered as content/about-us.html (never content/About_Us.html): media-reconcile is no n/a');
});
check('the archetype and a clone page (sidecar encode: null) keep today\'s subject, the migrated HTML', () => {
  assert.equal(meta2('tours/_meta.json').gateEvidence['delivery-lint'], 'FAIL: 1 P0 · 0 P1 · 1 P2 (delivery-lint --path /tours)', 'deploy converts the archetype from its migrated HTML; it is never staged');
  assert.equal(meta2('tours/west/_meta.json').gateEvidence['delivery-lint'], 'FAIL: 1 P0 · 0 P1 · 1 P2 (delivery-lint --path /tours/west)');
});
check('an encoded page with no delivered file and no current encoded document is not linted: a stopped page, a document gone — one note each', () => {
  for (const s of ['held', 'gone']) assert.equal('delivery-lint' in meta2(`tours/${s}/_meta.json`).gateEvidence, false, s);
  assert.match(enc1.err, /^gate-evidence: tours-held: delivery-lint skipped — no delivered content file \(content\/tours\/held\.html\) and stardust\/encoded\/tours\/held\.html is not a current encode \(stopped: .+\)$/m, enc1.err);
  assert.match(enc1.err, /^gate-evidence: tours-gone: delivery-lint skipped — no delivered content file \(content\/tours\/gone\.html\) and stardust\/encoded\/tours\/gone\.html is not a current encode \(missing: .+\)$/m, enc1.err);
  assert.equal(enc1.err.split('\n').filter(Boolean).length, 2, enc1.err);
});
check('the delivered signal is unchanged (media-reconcile n/a until the content file exists); a job on the content file or the encoded document is the encoded page\'s', () => {
  assert.equal(meta2('tours/north/_meta.json').gateEvidence['media-reconcile'], '3 keep (media-7.log)');
  assert.equal(meta2('tours/south/_meta.json').gateEvidence['media-reconcile'], 'n/a: no delivered content file yet (content/tours/south.html) — media-reconcile runs in the delivery chain (row C) — latest run 2 keep · 1 omit (media-8.log) is advisory until then');
  const rows = Object.fromEntries(JSON.parse(run2('--dry-run', '--json').out).map((r) => [r.slug, r]));
  assert.equal(rows['tours-south'].delivered, false); assert.equal(rows['tours-south'].missing.includes('media-reconcile'), false);
  assert.equal(rows['tours-north'].delivered, true); assert.equal(rows['tours-north'].missing.includes('media-reconcile'), false, 'passed');
  assert.equal(rows['tours-west'].missing.includes('media-reconcile'), false, 'not delivered either');
  assert.equal(rows['about-us'].delivered, true, 'an encoded page is delivered at its eds-path content file (stage-content\'s), not at the source URL\'s literal path');
  assert.ok(rows['about-us'].missing.includes('media-reconcile'), 'so --check requires media-reconcile on it');
  const north = { slug: 'tours-north', outputPath: 'tours/north/index.html', encoded: { files: [join(root2, 'stardust/encoded/tours/north.html'), join(root2, 'content/tours/north.html')] } };
  const west = { slug: 'tours-west', outputPath: 'tours/west/index.html' };
  const lj = (file) => ({ kind: 'delivery-lint', name: 'lint-1', instArgs: ['--file', file], cwd: root2 });
  assert.equal(attribute(lj('content/tours/north.html'), north, { migrated: M2 }), true);
  assert.equal(attribute(lj('stardust/encoded/tours/north.html'), north, { migrated: M2 }), true);
  assert.equal(attribute(lj('stardust/migrated/tours/west/index.html'), west, { migrated: M2 }), true, 'a clone page by its migrated file, as before');
  assert.equal(attribute(lj('stardust/migrated/tours/north/index.html'), north, { migrated: M2 }), false, 'an encoded page has no clone for a job to name');
  assert.equal(attribute(lj('content/tours/north.html'), west, { migrated: M2, pages: [north, west] }), false);
});
check('progress.json: an encoded sibling records its encoded document (migrated null); a clone sibling as before', () => {
  const s = json(join(root2, 'stardust/replica/progress.json')).siblings;
  assert.equal(s['tours-north'].migrated, null); assert.equal(s['tours-north'].encoded, 'stardust/encoded/tours/north.html');
  assert.equal(s['tours-west'].migrated, 'stardust/migrated/tours/west/index.html'); assert.equal('encoded' in s['tours-west'], false);
  assert.equal(json(join(root2, 'stardust/replica/progress.json')).migrate.pages, 9);
});
check('without a resolvable --lint an encoded page takes delivery-lint jobs on its own files only — a job on its would-be clone path is no one\'s', () => {
  const missing = ['--lint', join(root2, 'missing-lint.mjs'), '--slug', 'tours-north', '--dry-run', '--json'];
  job2('lint-c', ['stardust/scripts/rollout/delivery-lint.mjs', '--file', 'stardust/migrated/tours/north/index.html'], 'delivery-lint stardust/migrated/tours/north/index.html\n\n1 P0 · 0 P1 · 0 P2', 10);
  let row = JSON.parse(run2(...missing).out)[0];
  assert.equal(row.deliveryLint, null);
  job2('lint-d', ['stardust/scripts/rollout/delivery-lint.mjs', '--file', 'content/tours/north.html'], 'delivery-lint content/tours/north.html\n\n0 P0 · 0 P1 · 1 P2', 11);
  row = JSON.parse(run2(...missing).out)[0];
  assert.equal(row.deliveryLint, '0 P0 · 0 P1 · 1 P2'); assert.equal(row.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 1 P2 (lint-d.log)');
  // named after the page, but run on its would-be clone: the name fallback must not hand it over
  job2('tours-north-lint', ['stardust/scripts/rollout/delivery-lint.mjs', '--file', 'stardust/migrated/tours/north/index.html'], 'delivery-lint stardust/migrated/tours/north/index.html\n\n1 P0 · 0 P1 · 0 P2', 12);
  row = JSON.parse(run2(...missing).out)[0];
  assert.equal(row.gateEvidence['delivery-lint'], '0 P0 · 0 P1 · 1 P2 (lint-d.log)', 'the newer clone-path job is no one\'s');
  const north = { slug: 'tours-north', outputPath: 'tours/north/index.html', encoded: { files: [join(root2, 'stardust/encoded/tours/north.html'), join(root2, 'content/tours/north.html')] } };
  const ctx = { migrated: M2, pages: [north], slugs: ['tours-north'] };
  const named = (file) => ({ kind: 'delivery-lint', name: 'tours-north-lint', instArgs: ['--file', file], cwd: root2 });
  assert.equal(attribute(named('stardust/migrated/tours/north/index.html'), north, ctx), false);
  assert.equal(attribute(named('elsewhere.html'), north, ctx), true, 'the name fallback still serves an encoded page when no argument names a page file');
});
rmSync(root2, { recursive: true, force: true });

// ---- C14 (B12): an encoded sibling's local harness launches ------------------------------------------------------
// One encoded template (a map emitting block:cards, its block code, the archetype's passedOn under the current harness
// key): a sibling the archetype's shape covers (no runs), one with a new shape (cards ×4, no runs), one with the same
// new shape and its own runs, a covered one whose own qa-gate run failed, a stopped one, a hand-edited one, a clone
// sibling, and three delivered content files (identical to the encode, never staged and differing, differing with a
// passing content-diff run). Pages built with migrate's provenance and shape readers; the audit carries the encoder's
// L5 counts where given.
const root3 = realpathSync(mkdtempSync(join(tmpdir(), 'gate-evidence-c14-')));
const M3 = join(root3, 'stardust/migrated'); const BG3 = join(root3, 'stardust/.work/replica/bg'); const A3 = 'trip-a';
const html3 = (n) => `<body><header></header><main><div><h1>Trip</h1><div class="cards">${'<div><div><img src="/x.jpg" alt=""></div><div><p>Card</p></div></div>'.repeat(n)}</div></div></main><footer></footer></body>\n`;
put(join(root3, `stardust/import/${A3}/vocabulary.json`), JSON.stringify({ root: 'main', markers: [{ sel: '.mod-cards', kind: 'cards', emitter: 'block:cards' }] }));
put(join(root3, 'blocks/cards/cards.js'), 'export default function decorate() {}\n');
put(join(root3, 'lint-stub.mjs'), "console.log('\\n0 P0 · 0 P1 · 0 P2');\n");
const keys3 = { encoder: encoderKey(), map: mapKey(root3, A3) }; const manifest3 = {};
const counts3 = { heading: { capture: 1, missing: 0 }, link: { capture: 0, missing: 0 }, image: { capture: 2, missing: 0 }, text: { capture: 3, missing: 0 } };
const page3 = (slug, rows, archetype = false, audit = { incomplete: [], count: { counts: counts3, extra: 0, tolerated: 0 } }) => {
  const doc = `stardust/encoded/trips/${slug}.html`; manifest3[doc] = sha(html3(rows)); put(join(root3, doc), html3(rows));
  if (archetype) put(join(M3, `trips/${slug}.html`), '<html><body><main><h1>Trip</h1></main></body></html>\n');
  put(join(M3, `trips/${slug}._meta.json`), `${JSON.stringify({ slug, renderBranch: archetype ? 'A' : "A'", fidelityTier: archetype ? 'archetype' : 'sibling', template: archetype ? null : A3, archetypeSource: archetype ? null : A3, variants: [],
    encode: { encoder: keys3.encoder, map: keys3.map, inputs: {}, output: { path: doc, sha: sha(html3(rows)) }, encodedAt: '2026-10-01T00:00:00Z' }, audit: { encode: { status: 'clean', ...audit, shape: shapeOf(html3(rows)) } } }, null, 2)}\n`);
};
page3(A3, 2, true); page3('trip-b', 2); page3('trip-c', 4, false, { incomplete: [] }); page3('trip-d', 4); page3('trip-f', 2); page3('trip-g', 2, false, { status: 'incomplete', incomplete: [{ role: 'text', text: 'Lost' }] }); page3('trip-h', 2);
// delivered content files — one byte-identical to the encode (staged or adopted), one that lost a paragraph and
// was never staged, one that differs but has a passing content-diff run
for (const slug of ['trip-i', 'trip-j', 'trip-k']) page3(slug, 2);
put(join(root3, 'content/trips/trip-i.html'), html3(2));
for (const slug of ['trip-j', 'trip-k']) put(join(root3, `content/trips/${slug}.html`), html3(2).replace('<h1>Trip</h1>', '<h1>Trip</h1><p>Only on the delivered page</p>').replace('<p>Card</p>', ''));
put(join(root3, 'stardust/encoded/trips/trip-h.html'), html3(2).replace('<p>Card</p>', '<p>Edited by hand</p>'));
put(join(M3, 'trips/trip-e.html'), '<html><body><main><h1>Clone</h1></main></body></html>\n');
put(join(M3, 'trips/trip-e._meta.json'), `${JSON.stringify({ slug: 'trip-e', renderBranch: "A'", fidelityTier: 'sibling', template: A3, archetypeSource: A3, variants: [], encode: null, audit: null }, null, 2)}\n`);
put(join(root3, `stardust/import/${A3}/manifest.json`), `${JSON.stringify(manifest3, null, 2)}\n`);
const archSide = join(M3, `trips/${A3}._meta.json`);
const passOn = (key) => put(archSide, `${JSON.stringify({ ...json(archSide), passedOn: { key, shapes: [{ slug: A3, shape: shapeOf(html3(2)) }] } }, null, 2)}\n`);
const k3 = (await harnessKey(root3, A3)).key; passOn(k3);
mkdirSync(BG3, { recursive: true });
const job3 = (name, args, min, exit = 0, log = `exit ${exit}`) => {
  writeFileSync(join(BG3, `${name}.json`), JSON.stringify({ name, cmd: 'node', args, cwd: root3, timeoutSec: 900, slots: 3, queuedAt: iso(min), wrapperPid: 4242, launchedAt: iso(min + 0.1), endedAt: iso(min + 1), exit, timedOut: false }, null, 1));
  writeFileSync(join(BG3, `${name}.log`), `${log}\n`);
};
job3('d-schema', ['stardust/scripts/deploy/section-schema.mjs', `${PUBLISHED}/trips/trip-d`, '--out', 'stardust/eds-schema/trip-d.json'], 1);
job3('d-rt', ['stardust/scripts/deploy/block-roundtrip.mjs', `${PUBLISHED}/trips/trip-d`, 'content/trips/trip-d.html', '--ew'], 2);
job3('d-rt-cards', ['stardust/scripts/deploy/block-roundtrip.mjs', `${PUBLISHED}/trips/trip-d`, 'content/trips/trip-d.html', '--blocks', 'cards'], 3, 2);
job3('d-qa', ['stardust/scripts/deploy/qa-gate.mjs', 'http://localhost:3000/stardust/.work/harness/page.html', '--schema', 'stardust/eds-schema/trip-d.json'], 4, 1);
job3('f-qa', ['stardust/scripts/deploy/qa-gate.mjs', 'http://localhost:3000/stardust/.work/harness/page.html', '--schema', 'stardust/eds-schema/trip-f.json'], 5, 1);
job3('d-cd', ['stardust/scripts/diff/content-diff.mjs', `${PUBLISHED}/trips/trip-d`], 6, 0, 'Findings: 2 (1 structural 🔴)');
job3('f-cd', ['stardust/scripts/diff/content-diff.mjs', `${PUBLISHED}/trips/trip-f`], 7, 0, 'Findings: none — content + roles match');
job3('k-cd', ['stardust/scripts/diff/content-diff.mjs', `${PUBLISHED}/trips/trip-k`], 8, 0, 'Findings: none — content + roles match');
const run3 = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, '--lint', join(root3, 'lint-stub.mjs'), ...args], { cwd: root3, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const meta3 = (slug) => json(join(M3, `trips/${slug}._meta.json`));
const HARNESS3 = ['section-schema', 'block-roundtrip', 'qa-gate'];
const ev3 = (slug) => HARNESS3.map((g) => meta3(slug).gateEvidence[g]);
const c14a = run3('--check');
check('C14 skip rule: a sibling with no local runs inherits the launches when passedOn under the current key covers its shape', () => {
  assert.equal(c14a.code, 2, c14a.err);
  const line = `inherited from ${A3} (C14): covered by passedOn under ${k3.slice(0, 19)}… (${A3})`;
  assert.deepEqual(ev3('trip-b'), [line, line, line]);
  assert.ok(HARNESS3.every((g) => meta3('trip-b').gatesPassed.includes(g)));
  assert.doesNotMatch(c14a.out, /^trip-b: missing [^\n]*(section-schema|block-roundtrip|qa-gate)/m, 'required, and not missing');
});
check('C14: a new shape with no local runs stays OPEN, required, naming the shape gap; the page\'s own runs decide where they exist (a failing one is never covered)', () => {
  const gap = 'no local section-schema run, and C14 does not cover it — shape not covered: "cards" has 4 rows (exercised 2)';
  assert.equal(meta3('trip-c').gateEvidence['section-schema'], `OPEN: ${gap}`);
  assert.equal(meta3('trip-c').gateEvidence['block-roundtrip'], `OPEN: ${gap.replace('section-schema', 'block-roundtrip --ew')}`);
  assert.match(c14a.out, /^trip-c: missing (.*, )?section-schema, block-roundtrip, qa-gate$/m);
  assert.deepEqual(ev3('trip-d'), ['ran: section-schema exit 0 (d-schema.log)', 'ran: block-roundtrip --ew exit 0 (d-rt.log)', 'FAIL: qa-gate exit 1 (d-qa.log)'], 'the per-block round-trip (--blocks) is no whole-page evidence');
  assert.match(c14a.out, /^trip-d: missing (.*, )?qa-gate$/m);
  assert.deepEqual(ev3('trip-f').map((e) => e.split(':')[0]), ['inherited from trip-a (C14)', 'inherited from trip-a (C14)', 'FAIL'], 'a covered page whose own qa-gate failed keeps the FAIL');
});
check('C14: the archetype and a clone sibling behave as before — no harness gate derived or required', () => {
  for (const s of [A3, 'trip-e']) assert.deepEqual(HARNESS3.filter((g) => g in meta3(s).gateEvidence), [], s);
  const rows = Object.fromEntries(JSON.parse(run3('--dry-run', '--json').out).map((r) => [r.slug, r]));
  assert.deepEqual(rows['trip-e'].missing.filter((g) => HARNESS3.includes(g)), []);
  assert.deepEqual(rows[A3].missing, []);
});
check('an encoded sibling\'s current clean encode passes content-count on the encoder\'s L5 count; a content-diff run shows beside it and its OPEN wins; a stopped encode and a clone as before', () => {
  const doc = (slug) => `audit.encode (stardust/encoded/trips/${slug}.html)`;
  assert.equal(meta3('trip-b').gateEvidence['content-count'], `encoder L5: 0 MISSING (h 1/1 · links 0/0 · images 2/2 · text 3/3) — ${doc('trip-b')}`);
  assert.ok(meta3('trip-b').gatesPassed.includes('content-count'));
  assert.equal(meta3('trip-c').gateEvidence['content-count'], `encoder L5: 0 MISSING — ${doc('trip-c')}`, 'no counts recorded: the shorter line');
  assert.equal(meta3('trip-f').gateEvidence['content-count'], `encoder L5: 0 MISSING (h 1/1 · links 0/0 · images 2/2 · text 3/3) — ${doc('trip-f')}; content-diff: none — content + roles match (f-cd.log)`);
  assert.equal(meta3('trip-d').gateEvidence['content-count'], 'OPEN: content-diff: 2 (1 structural 🔴) (d-cd.log)', 'the content-diff OPEN wins');
  assert.match(c14a.out, /^trip-d: missing [^\n]*content-count/m);
  assert.equal('content-count' in meta3('trip-g').gateEvidence, false, 'a stopped encode earns nothing from the encoder');
  assert.match(c14a.out, /^trip-g: missing [^\n]*content-count/m);
  assert.equal('content-count' in meta3('trip-h').gateEvidence, false, 'nor does a hand-edited document under a clean status (not the current encode)');
  for (const s of [A3, 'trip-e']) assert.equal('content-count' in meta3(s).gateEvidence, false, `${s}: as before`);
});
check('the encoder\'s count stands for the delivered document only while it is absent or byte-identical to the encode; a differing one is OPEN, a content-diff pass still stands', () => {
  assert.equal(meta3('trip-i').gateEvidence['content-count'], 'encoder L5: 0 MISSING (h 1/1 · links 0/0 · images 2/2 · text 3/3) — audit.encode (stardust/encoded/trips/trip-i.html)', 'identical: staged or adopted');
  assert.equal(meta3('trip-j').gateEvidence['content-count'], 'OPEN: content/trips/trip-j.html is not the current encode (stardust/encoded/trips/trip-j.html) — re-stage it, or run content-diff on the delivered page');
  assert.equal(meta3('trip-j').gatesPassed.includes('content-count'), false);
  assert.match(c14a.out, /^trip-j: missing [^\n]*content-count/m);
  assert.equal(meta3('trip-k').gateEvidence['content-count'], 'content-diff: none — content + roles match (k-cd.log)', 'the content-diff run on the delivered page decides, without the encoder\'s line');
  assert.equal(meta3('trip-b').gateEvidence['content-count'].startsWith('encoder L5: 0 MISSING'), true, 'no content file yet: the encoder\'s count stands');
});
put(join(root3, 'blocks/cards/cards.css'), '.cards { display: grid; }\n');
const k3b = (await harnessKey(root3, A3)).key;
check('C14: a block edit moves the harness key — the inherited gates turn OPEN naming the keys, read stale, and come back only under a pass recorded with the new key', () => {
  assert.notEqual(k3b, k3);
  const r = run3('--check');
  assert.equal(r.code, 2);
  assert.equal(meta3('trip-b').gateEvidence['qa-gate'], `OPEN: no local qa-gate run, and C14 does not cover it — the harness key moved since the recorded pass (${k3.slice(0, 19)}… → ${k3b.slice(0, 19)}…)`);
  assert.match(r.out, /^trip-b: stale section-schema, block-roundtrip, qa-gate — /m);
  passOn(k3b);
  const again = run3('--check');
  assert.equal(meta3('trip-b').gateEvidence['qa-gate'], `inherited from ${A3} (C14): covered by passedOn under ${k3b.slice(0, 19)}… (${A3})`);
  assert.doesNotMatch(again.out, /^trip-b: stale/m); assert.doesNotMatch(again.out, /^trip-b: missing [^\n]*(section-schema|block-roundtrip|qa-gate)/m);
});
rmSync(root3, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\ngate-evidence: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
