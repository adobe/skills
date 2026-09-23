#!/usr/bin/env node
// skills/replica/scripts/test/gate-evidence.test.mjs — the gate-evidence.mjs contract: sidecar discovery, job
// attribution from run-bg state (never log prose, never mtime), latest-round selection, the derived gates and their
// FAIL:/OPEN: evidence, the sidecar merge (existing first, indent preserved, nothing else touched), the progress
// ledger, --dry-run, --check against the width-aware acceptance set (a pixel gate per --widths entry) and against
// stale gates, --slug, --json, --help, the delivery-lint fallback, the pixel regime (prototype vs published), deadline
// and no-verdict jobs recorded OPEN, variance-probe only from the page's own ■ line, the name-fallback attribution
// rule, a malformed progress.json aborting before any sidecar write.
// Run: node plugins/stardust/skills/replica/scripts/test/gate-evidence.test.mjs   (about 2 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE, acceptanceFor, attribute, daPath, deadline, detectIndent, nameOwner, pagePaths, parseCounts, parseFindings, parseLint, parseVariance, parseVerdict, regimeOf } from '../gate-evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-evidence.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-evidence-test-')));
const MIG = join(root, 'stardust/migrated');
const BG = join(root, 'stardust/.work/replica/bg');
const PROGRESS = join(root, 'stardust/replica/progress.json');
const LINT = join(root, 'lint-stub.mjs');
for (const d of [join(MIG, 'tours/north'), join(MIG, 'about'), BG, dirname(PROGRESS)]) mkdirSync(d, { recursive: true });
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
const pixelLog = (h, n, m, pct, v) => `stitched stardust/replica/gates/x/build.png: 1440x${3690 + h} from 8 chunks\nA 1440x3690  B 1440x${3690 + h}  → compare 1440x3690, height delta ${h}px\ndiffering pixels: ${n} / ${m} = ${pct}%  (threshold 10%) → ${v}\ndiff image: stardust/replica/gates/x/diff.png\n  y      0–500: 0.4%`;
// tours-north @1440: iter1 FAIL (older by endedAt, but given the NEWEST mtime below), iter2 PASS, iter3 still running with a wild FAIL.
job('tours-north-1440-iter2', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter2'], { start: 30, end: 35, exit: 0, log: pixelLog(2, 6960, 5313600, '0.13', 'PASS') });
job('tours-north-1440-iter1', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter1'], { start: 10, end: 15, exit: 2, log: pixelLog(64, 637632, 5313600, '12.00', 'FAIL') });
job('tours-north-1440-iter3', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '1440', 'iter3', '--full'], { start: 40, end: null, log: pixelLog(0, 4780000, 5313600, '90.00', 'FAIL') });
job('tours-north-360-iter1', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PROTO}/tours-north-proposed.html`, '360', 'iter1'], { start: 12, end: 17, exit: 0, log: pixelLog(12, 4700, 522000, '0.90', 'PASS') });
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
  assert.deepEqual(parseVerdict(`${pixelLog(-9, 12, 100, '12.00', 'FAIL')}\n`), { px: 12, total: 100, pct: 12, threshold: 10, verdict: 'FAIL', heightDelta: -9 });
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
  const log = read(join(BG, 'about-variance.log'));
  const vl = parseVariance(log, pagePaths('about/history.html')); assert.equal(vl.deltas, 2); assert.match(vl.line, /^■ .*history\.html: 2 delta\(s\)$/); assert.match(vl.summary, /^✗ 1 of 2 sibling/);
  assert.equal(parseVariance(log, pagePaths('about/team.html')).deltas, 0);
  const vn = parseVariance(log, pagePaths('other.html')); assert.equal(vn.deltas, null); assert.match(vn.line, /^✗ 1 of 2/); assert.equal(vn.own, false); assert.equal(vl.own, true);
  assert.equal(parseVariance('sibling-variance error: boom'), null);
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
  assert.equal(e['pixel-gate-1440'], '0.13% (6960 px, threshold 10%), height delta 2px, round iter2 @1440 (tours-north-1440-iter2.log) [prototype regime]');
  assert.match(e['pixel-gate-360'], /^FAIL: \|height delta\| > 8px tolerance — 0\.90% .*height delta 12px, round iter1 @360 \(tours-north-360-iter1\.log\) \[prototype regime\]$/);
  assert.equal(e['content-count'], 'content-diff: none — content + roles match (cd-tours-north.log)');
  assert.equal(e['media-reconcile'], '4 keep · 1 optimize · 0 omit (media-tours-north.log)');
  assert.equal(e['delivery-lint'], '0 P0 · 0 P1 · 1 P2 (delivery-lint --path /tours/north)');
  assert.doesNotMatch(JSON.stringify(e), /iter3|90\.00/, 'the still-running round left no trace');
  for (const g of ['content-count', 'media-reconcile']) assert.match(e[g], /\([a-z0-9-]+\.log\)$/, g);
  for (const g of ['pixel-gate-1440', 'pixel-gate-360']) assert.match(e[g], /\([a-z0-9-]+\.log\) \[prototype regime\]$/, g);
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
check('home (archetype): its own pixel round, lint FAIL at path /, no variance-probe at all', () => {
  const m = json(side.home);
  assert.deepEqual(m.gatesPassed, ['pixel-gate-1440']);
  assert.match(m.gateEvidence['pixel-gate-1440'], /height delta -3px, round iter @1440 \(home-1440-iter1\.log\) \[prototype regime\]$/);
  assert.equal(m.gateEvidence['delivery-lint'], 'FAIL: 1 P0 · 0 P1 · 0 P2 (delivery-lint --path /)');
  assert.equal('variance-probe' in m.gateEvidence, false);
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
  assert.deepEqual(s.pixel['360'], { pct: 0.9, px: 4700, heightDelta: 12, verdict: 'PASS', label: 'iter1', regime: 'prototype' });
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
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /usage/i); assert.match(r.stdout, /content-fidelity\s+NEVER added here/); assert.match(r.stdout, /--height-tolerance 8/);
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
  job('tours-north-360-pub', GATE, ['tours-north', `${LIVE}/tours/north/`, `${PUBLISHED}/tours/north/`, '360', 'pub1', '--marker', 'north'], { start: 80, end: 84, exit: 0, log: pixelLog(0, 2600, 522000, '0.50', 'PASS') });
  const r = run('--slug', 'tours-north'); assert.equal(r.code, 0, r.err);
  const m = json(side.north);
  assert.equal(m.gateEvidence['pixel-gate-360'], '0.50% (2600 px, threshold 10%), height delta 0px, round pub1 @360 (tours-north-360-pub.log) [published regime]');
  assert.ok(m.gatesPassed.includes('pixel-gate-360'), 'the published round passes the gate the prototype round failed');
  assert.equal(m.gateEvidence['pixel-gate-1440'].endsWith('[prototype regime]'), true, 'the 1440 gate still reads prototype');
  const p = json(PROGRESS).siblings['tours-north'].pixel; assert.equal(p['360'].regime, 'published'); assert.equal(p['1440'].regime, 'prototype'); assert.equal(p['360'].label, 'pub1');
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

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${checks} checks failing` : `\ngate-evidence: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
