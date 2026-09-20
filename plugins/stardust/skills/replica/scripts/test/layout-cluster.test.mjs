#!/usr/bin/env node
// Deterministic test: skills/replica/scripts/layout-cluster.mjs — the pure
// halves (signature, clustering, exemplar pick, gate status, the BLOCKING
// report, --cover refusal rules) without a browser, plus the CLI contract.
// The browser half (file:// extraction over the eval fixture's sidecar pages)
// runs when playwright resolves from the repo or STARDUST_GATE_DEPS names a
// node_modules that has it; otherwise one SKIP line.
//
// Usage: node plugins/stardust/skills/replica/scripts/test/layout-cluster.test.mjs  (exit 1 on findings)
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', 'layout-cluster.mjs');
const EVALS = join(HERE, '..', '..', '..', '..', 'evals');
const FIXTURE = join(EVALS, 'replica-layout-clusters', 'fixture', 'stardust');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (args, opts = {}) => { const { script = SCRIPT, ...spawn } = opts; const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...spawn }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };

const { DEFAULT_K, mergeReport, urlsFromClusters, signatureOf, tokenOf, editDistance, signatureDiff, clusterSignatures, pickExemplar, gateStatus, isGated, clusterType, renderType, applyCover, defaultMinCluster } = await import(SCRIPT);

// --- signature tokens
const hero = { tag: 'section', firstClass: 'program-hero', groups: [], interactive: false, columns: 1 };
const tiles = { tag: 'section', firstClass: 'coverage-tiles', groups: [{ count: 3, unit: { headings: 1, ctas: 1, imgs: 0, textRuns: 3 } }], interactive: false, columns: 3 };
const cols = { tag: 'section', firstClass: 'compare-columns', groups: [{ count: 2, unit: { headings: 1, ctas: 0, imgs: 0, textRuns: 4 } }], interactive: false, columns: 2 };
const faq = { tag: 'section', firstClass: 'faq', groups: [{ count: 2, unit: { headings: 0, ctas: 0, imgs: 0, textRuns: 2 } }], interactive: true, columns: 1 };
const cta = { tag: 'section', firstClass: 'cta-band', groups: [], interactive: false, columns: 1 };
check(tokenOf(hero) === 'program-hero', `bare section token is its first class, got ${tokenOf(hero)}`);
check(tokenOf(tiles) === 'coverage-tiles|g:3xhct|c3', `repeat group + columns token, got ${tokenOf(tiles)}`);
check(tokenOf(faq) === 'faq|g:2xt|i', `interactive token, got ${tokenOf(faq)}`);
check(tokenOf({ tag: 'div', firstClass: '', groups: [{ count: 17, unit: { headings: 0, ctas: 1, imgs: 1, textRuns: 1 } }], interactive: false, columns: 1 }) === 'div|g:nxcit', 'counts above 6 collapse to n (a list of 17 vs 24 is the same layout)');
const A = signatureOf([hero, tiles, faq, cta]); const B = signatureOf([hero, tiles, cols, faq, cta]);
check(A.length === 4 && B.length === 5, 'signatureOf yields one token per section');
check(editDistance(A, B) === 1 && editDistance(A, A) === 0 && editDistance([], B) === 5, 'token-level edit distance');
check(JSON.stringify(signatureDiff(A, B)) === JSON.stringify(['faq|g:2xt|i → compare-columns|g:2xht|c2 @2', 'cta-band → faq|g:2xt|i @3', '+cta-band @4']), `signature diff names positions, got ${JSON.stringify(signatureDiff(A, B))}`);

// --- clustering: exact groups, then k-merge
const sigs = [...['a1', 'a2', 'a3', 'a4', 'a5'].map((s) => ({ slug: s, signature: A })), ...['b1', 'b2', 'b3'].map((s) => ({ slug: s, signature: B })), { slug: 'a6', signature: signatureOf([hero, tiles, faq, { ...cta, firstClass: 'cta-band-alt' }]) }];
let fam = clusterSignatures(sigs, { k: 0 });
check(fam.length === 3 && fam[0].count === 5 && fam[1].count === 3 && fam[2].count === 1, `k=0 keeps exact groups (5/3/1), got ${fam.map((f) => f.count)}`);
fam = clusterSignatures(sigs, { k: 1 });
check(fam.length === 1 && fam[0].count === 9 && fam[0].variants.length === 2, `k=1 merges BOTH one-edit signatures (a renamed CTA and an extra section) into one family — which is why the default is k=0, got ${JSON.stringify(fam.map((f) => [f.count, f.variants.length]))}`);
fam = clusterSignatures(sigs);
check(fam.length === 3 && DEFAULT_K === 0, 'default k=0: exact signatures — a one-section difference is a different layout');
check(clusterSignatures([], {}).length === 0, 'empty input → no families');

// --- exemplar pick
const weights = { a1: 900, a2: 1200, a3: 1000, a4: 1100, a5: 950 };
check(JSON.stringify(pickExemplar(['a1', 'a2', 'a3', 'a4', 'a5'], weights, 'a3')) === JSON.stringify({ exemplar: 'a3', exemplarSource: 'archetype' }), 'archetype in the cluster → exemplar');
check(JSON.stringify(pickExemplar(['a1', 'a2', 'a3', 'a4', 'a5'], weights, 'zz')) === JSON.stringify({ exemplar: 'a3', exemplarSource: 'median' }), `archetype absent → median-weight page (a3 @1000), got ${JSON.stringify(pickExemplar(['a1', 'a2', 'a3', 'a4', 'a5'], weights, 'zz'))}`);
check(defaultMinCluster(8) === 5 && defaultMinCluster(1411) === 29, 'T default = max(5, ceil(2 %))');

// --- gate status from the ledger, via gate-ledger-lint's judges (bars restated, never re-tuned)
const ledger = { breakpointsConfigured: [1440, 360], archetypes: [
  { pageType: 'program', archetype: 'a3', prototype: 'x.html', motion: { observed: [], implemented: [], dead: [] }, breakpoints: { 1440: { result: { pixelPct: 3, heightDelta: 1, structuralRed: 0, pass: true } }, 360: { result: { pixelPct: 4, heightDelta: -2, structuralRed: 0, pass: true } } } },
  { pageType: 'program-b', archetype: 'b2', prototype: 'y.html', motion: { observed: [], implemented: [], dead: [] }, breakpoints: { 1440: { result: { pixelPct: 12, heightDelta: 1, structuralRed: 0, pass: false }, residuals: [{ cause: 'glyph-antialiasing', artifacts: ['g.png'], acceptedBy: 'user' }] } } },
  { pageType: 'program-c', archetype: 'c1', prototype: 'z.html', breakpoints: { 1440: { result: { pixelPct: 2, heightDelta: 28, structuralRed: 0, pass: true } }, 360: { result: { pixelPct: 2, heightDelta: 0, structuralRed: 0, pass: true } } } },
] };
const classes = new Map([['glyph-antialiasing', { permanent: true }]]);
let gs = gateStatus(ledger, 'a3', [1440, 360], classes);
check(gs[1440] === 'pass' && gs[360] === 'pass' && isGated(gs), `gated at both bps, got ${JSON.stringify(gs)}`);
gs = gateStatus(ledger, 'b2', [1440, 360], classes);
check(gs[1440] === 'accepted' && gs[360] === 'ungated' && !isGated(gs), `over the bar with a valid residual = accepted; missing bp = ungated (never FAIL), got ${JSON.stringify(gs)}`);
gs = gateStatus(ledger, 'c1', [1440, 360], classes);
check(gs[1440] === 'fail' && !isGated(gs), `pass:true typed next to Δh 28 reads fail (the bar is applied, not read), got ${JSON.stringify(gs)}`);
check(!isGated(gateStatus(ledger, 'nobody', [1440, 360], classes)) && gateStatus(null, 'a3', [1440], classes)[1440] === 'ungated', 'no ledger entry / no ledger → ungated');

// --- the BLOCKING report: 5 A pages (archetype gated) + 3 B pages (exemplar ungated)
const pagesA = ['a1', 'a2', 'a3', 'a4', 'a5'].map((s) => ({ slug: s, facts: [hero, tiles, faq, cta], weight: weights[s] }));
const pagesB = ['b1', 'b2', 'b3'].map((s, i) => ({ slug: s, facts: [hero, tiles, cols, faq, cta], weight: 1000 + i }));
let r = clusterType({ type: 'program', pages: [...pagesA, ...pagesB, { slug: 'nosidecar', facts: null, weight: 0 }], ledger, bps: [1440, 360], classes, minCluster: 3, k: 0 });
check(r.clusters.length === 2 && r.tail.length === 0 && r.unclustered[0] === 'nosidecar', `two clusters ≥ 3 + one unclustered page, got ${JSON.stringify({ c: r.clusters.length, t: r.tail.length, u: r.unclustered })}`);
check(r.clusters[0].id === 'c1' && r.clusters[0].exemplar === 'a3' && r.clusters[0].exemplarSource === 'archetype' && isGated(r.clusters[0].gated), 'c1 = the archetype\'s cluster, gated');
check(r.clusters[1].id === 'c2' && r.clusters[1].exemplar === 'b2' && r.clusters[1].exemplarSource === 'median' && !isGated(r.clusters[1].gated), `c2 exemplar = median page b2, ungated, got ${JSON.stringify(r.clusters[1])}`);
check(JSON.stringify(r.ungated) === JSON.stringify(['c2']) && r.archetypeCluster === 'c1', 'the blocking fact names c2 only');
check(r.clusters[1].diffVsArchetype.length === 3 && r.clusters[1].diffVsArchetype[0].includes('compare-columns'), 'per-cluster signature diff vs the archetype\'s cluster');
let text = renderType(r, [1440, 360]);
check(/type program: 9 pages, 2 cluster\(s\) ≥ 3 \(gated 1\), tail 0 page\(s\), unclustered 1/.test(text), `summary line, got:\n${text}`);
check(/c2 {5}3 pages {2}exemplar b2 \(median\) {2}ungated 1440 ✓\* 360 — → \$stardust replica b2/.test(text), `ungated cluster row carries the command to gate the exemplar, got:\n${text}`);
check(/✗ 1 ungated cluster\(s\) ≥ 3 in type program — under flow: replica nothing in c2 renders or publishes \(coverage gap: ungated cluster\)/.test(text), 'the block line uses the coverage-gap vocabulary');
check(!/--allow-ungated/.test(text) && !/--allow-ungated/.test(readFileSync(SCRIPT, 'utf8')), 'no --allow-ungated anywhere — a flag that weakens a gate does not exist');

// tail: with the default T (max(5, 2 %) = 5) the 3 B pages are tail — reported, never blocking
r = clusterType({ type: 'program', pages: [...pagesA, ...pagesB], ledger, bps: [1440, 360], classes, k: 0 });
check(r.minCluster === 5 && r.clusters.length === 1 && r.tail.length === 1 && r.tail[0].count === 3 && r.ungated.length === 0, `default T=5: B is tail, nothing blocks, got ${JSON.stringify({ T: r.minCluster, c: r.clusters.length, t: r.tail.length, u: r.ungated })}`);
text = renderType(r, [1440, 360]);
check(/tail {3}3 page\(s\) {2}b1, b2, b3/.test(text) && /layoutCluster: tail — never blocked, never silently passed/.test(text) && /✓ every cluster ≥ 5/.test(text), `tail is printed and sampled, exit fact is ok, got:\n${text}`);

// --- --cover: operator only, gated target only, same type only, previous cover survives a re-run
const file = { types: [clusterType({ type: 'program', pages: [...pagesA, ...pagesB], ledger, bps: [1440, 360], classes, minCluster: 3, k: 0 })] };
let threw = null; try { applyCover(file, { id: 'c2', gatedId: 'c1', reason: 'columns are a two-up variant of the tiles block', handsOff: true }); } catch (e) { threw = e.message; }
check(/refused: state.json.handsOff is true/.test(threw || ''), `hands-off never covers, got ${threw}`);
threw = null; try { applyCover(file, { id: 'c1', gatedId: 'c2', reason: 'x' }); } catch (e) { threw = e.message; }
check(/cover target c2 is not gated/.test(threw || ''), `covering by an ungated cluster is refused, got ${threw}`);
threw = null; try { applyCover(file, { id: 'c9', gatedId: 'c1', reason: 'x' }); } catch (e) { threw = e.message; }
check(/cluster c9 not in the cluster file/.test(threw || ''), 'unknown cluster id is an error');
const hit = applyCover(file, { id: 'c2', gatedId: 'c1', reason: 'columns are a two-up variant of the tiles block' });
check(hit.c.coveredBy?.cluster === 'c1' && hit.c.coveredBy.by === 'operator' && hit.c.coveredBy.signatureDiff.length === 3 && file.types[0].ungated.length === 0, `coveredBy recorded with reason, by, diff; the type no longer blocks, got ${JSON.stringify(hit.c.coveredBy)}`);
r = clusterType({ type: 'program', pages: [...pagesA, ...pagesB], ledger, bps: [1440, 360], classes, minCluster: 3, k: 0, previous: file.types[0] });
check(r.clusters[1].coveredBy?.cluster === 'c1' && r.ungated.length === 0 && /covered by c1 \(columns are a two-up variant/.test(renderType(r, [1440, 360])), 're-clustering keeps a recorded coveredBy keyed by signature');
check(r.clusters[1].gated[360] === 'ungated' && r.clusters[1].gated[1440] === 'accepted', 'coveredBy never rewrites the gate status — the exemplar record keeps 360 ungated');

// --- eval hygiene: everything under an eval's fixture/ is visible to the agent under test; the shared
// fixture README (rule 3) must not be copied there. fixture-notes.md beside fixture/ documents the deltas.
const sharedTitle = readFileSync(join(EVALS, '_shared', 'fixture-post-migrate', 'README.md'), 'utf8').split('\n')[0];
for (const ev of readdirSync(EVALS)) {
  const readme = join(EVALS, ev, 'fixture', 'README.md');
  if (existsSync(readme)) check(readFileSync(readme, 'utf8').split('\n')[0] !== sharedTitle, `evals/${ev}/fixture/README.md is a copy of the shared fixture README (visible to the agent under test) — delete it, document deltas in fixture-notes.md`);
}
check(existsSync(join(EVALS, 'replica-layout-clusters', 'fixture-notes.md')), 'replica-layout-clusters documents its fixture deltas in fixture-notes.md');

// --- CLI contract
const help = run(['--help']);
check(help.status === 0 && /Usage:/.test(help.out) && /--cover/.test(help.out) && /--min-cluster/.test(help.out) && /--write-state/.test(help.out), 'layout-cluster --help exits 0 and names the flags');
check(run(['--bogus']).status === 1, 'an unknown flag exits 1');
check(run(['--cover', 'c2=c1']).status === 1 && /--reason/.test(run(['--cover', 'c2=c1']).out), '--cover without --reason exits 1');
check(run(['--min-cluster', '1']).status === 1, '--min-cluster below 2 exits 1');
check(run(['--root', join(tmpdir(), 'no-such-stardust-dir')]).status === 1, 'a missing state.json exits 1');
// --cover over a real cluster file in a temp copy of the eval fixture (no browser: the file is written by the test)
const tmp = mkdtempSync(join(tmpdir(), 'layout-cluster-'));
try {
  cpSync(FIXTURE, join(tmp, 'stardust'), { recursive: true });
  const written = { generatedAt: 'test', minCluster: 3, k: 0, breakpoints: [1440, 360], types: [clusterType({ type: 'program', pages: [...pagesA, ...pagesB], ledger, bps: [1440, 360], classes, minCluster: 3, k: 0 })] };
  writeFileSync(join(tmp, 'stardust', 'current', 'layout-clusters.json'), JSON.stringify(written, null, 2));
  let c = run(['--root', join(tmp, 'stardust'), '--cover', 'c2=c1', '--reason', 'two-up columns are a tiles variant']);
  check(c.status === 0 && /covered: c2 \(3 pages, exemplar b2\) by c1/.test(c.out) && /journal line:/.test(c.out) && /sibling-variance.mjs --from-clusters/.test(c.out), `--cover writes and prints the journal line + the verification command, got ${c.status}\n${c.out}`);
  const after = JSON.parse(readFileSync(join(tmp, 'stardust', 'current', 'layout-clusters.json'), 'utf8'));
  check(after.types[0].clusters[1].coveredBy?.reason === 'two-up columns are a tiles variant', 'coveredBy persisted in the cluster file');
  // --from-clusters (sibling-variance.mjs): archetype = archetype cluster's exemplar, siblings = other clusters' exemplars, URLs from state.json
  const realA = ['insurance__home', 'insurance__auto', 'insurance__life', 'insurance__renters', 'insurance__boat'].map((s) => ({ slug: s, facts: [hero, tiles, faq, cta], weight: 1000 }));
  const realB = ['insurance__business-owners', 'insurance__landlord', 'insurance__umbrella'].map((s, i) => ({ slug: s, facts: [hero, tiles, cols, faq, cta], weight: 1000 + i }));
  const fixtureLedger = JSON.parse(readFileSync(join(tmp, 'stardust', 'replica', 'progress.json'), 'utf8'));
  const realFile = { types: [clusterType({ type: 'program', pages: [...realA, ...realB], ledger: fixtureLedger, bps: [1440, 360], classes, minCluster: 3, k: 0 })] };
  writeFileSync(join(tmp, 'stardust', 'current', 'layout-clusters.json'), JSON.stringify(realFile, null, 2));
  const pair = urlsFromClusters(join(tmp, 'stardust', 'current', 'layout-clusters.json'));
  check(pair?.archetypeSlug === 'insurance__home' && pair.archetype === 'https://www.larkspurmutual.example/insurance/home/' && pair.siblings.length === 1 && pair.siblings[0] === 'https://www.larkspurmutual.example/insurance/landlord/' && pair.type === 'program', `--from-clusters derives archetype + one exemplar per other cluster, got ${JSON.stringify(pair)}`);
  check(urlsFromClusters(join(tmp, 'stardust', 'current', 'layout-clusters.json'), 'landing') === null, '--from-clusters with a type that has no clusters → null (usage error in the CLI)');
  const st = JSON.parse(readFileSync(join(tmp, 'stardust', 'state.json'), 'utf8')); st.handsOff = true; writeFileSync(join(tmp, 'stardust', 'state.json'), JSON.stringify(st));
  c = run(['--root', join(tmp, 'stardust'), '--cover', 'c1=c1', '--reason', 'x']);
  check(c.status === 1 && /handsOff is true/.test(c.out), `--cover under handsOff exits 1, got ${c.status}\n${c.out}`);
  // defect: `--type <typo>` used to rewrite layout-clusters.json with `types: []` and exit 0 (no browser is reached — the check precedes extraction)
  const before = readFileSync(join(tmp, 'stardust', 'current', 'layout-clusters.json'), 'utf8');
  c = run(['--root', join(tmp, 'stardust'), '--type', 'no-such-type']);
  check(c.status === 1 && /no pages of type no-such-type/.test(c.out) && /types: .*program/.test(c.out), `--type matching no page exits 1 and names the known types, got ${c.status}\n${c.out}`);
  check(readFileSync(join(tmp, 'stardust', 'current', 'layout-clusters.json'), 'utf8') === before, 'a --type run that matches nothing leaves layout-clusters.json untouched');
} finally { rmSync(tmp, { recursive: true, force: true }); }

// --- mergeReport: a --type run replaces only its own type; other types + coveredBy survive
const prevFile = { generatedAt: 'old', types: [{ type: 'program', clusters: [{ id: 'c1', signature: ['x'], coveredBy: null }], tail: [], ungated: [] }, { type: 'landing', clusters: [{ id: 'c1', signature: ['l'], coveredBy: { cluster: 'c2', reason: 'kept' } }], tail: [], ungated: [] }] };
const freshProgram = { type: 'program', clusters: [{ id: 'c1', signature: ['y'] }], tail: [], ungated: ['c1'] };
let merged = mergeReport(prevFile, { generatedAt: 'new', types: [freshProgram] });
check(merged.types.length === 2 && merged.types[0] === freshProgram && merged.types[1].type === 'landing' && merged.types[1].clusters[0].coveredBy?.reason === 'kept' && merged.generatedAt === 'new', `a --type run replaces its own type in place and keeps the others (with coveredBy), got ${JSON.stringify(merged.types.map((t) => [t.type, t.clusters[0].signature]))}`);
merged = mergeReport(prevFile, { types: [{ type: 'article', clusters: [], tail: [], ungated: [] }] });
check(merged.types.map((t) => t.type).join() === 'program,landing,article', 'a new type is appended after the previous ones');
check(mergeReport(null, { types: [freshProgram] }).types.length === 1 && mergeReport({ types: 'garbage' }, { types: [freshProgram] }).types.length === 1, 'no / malformed previous file → the report as is');

// --- browser half: when playwright resolves from the repo, or STARDUST_GATE_DEPS names a node_modules with it
// (the scripts dir is copied beside a node_modules symlink — the same resolve-or-symlink pattern as variant-census-fixtures.mjs)
let pw = null; try { await import('playwright'); pw = 'repo'; } catch { /* not at the repo root */ }
if (!pw && process.env.STARDUST_GATE_DEPS && existsSync(join(process.env.STARDUST_GATE_DEPS, 'playwright'))) pw = process.env.STARDUST_GATE_DEPS;
if (!pw) console.log('layout-cluster.test: SKIP browser half — playwright not resolvable (set STARDUST_GATE_DEPS=<dir>/node_modules); the pure halves above ran');
else {
  const tmp2 = mkdtempSync(join(tmpdir(), 'layout-cluster-b-'));
  try {
    let script = SCRIPT;
    if (pw !== 'repo') {
      cpSync(join(HERE, '..'), join(tmp2, 'skills', 'replica', 'scripts'), { recursive: true });
      symlinkSync(resolve(pw), join(tmp2, 'node_modules'));
      script = join(tmp2, 'skills', 'replica', 'scripts', 'layout-cluster.mjs');
    }
    cpSync(FIXTURE, join(tmp2, 'stardust'), { recursive: true });
    const b = run(['--root', join(tmp2, 'stardust'), '--type', 'program', '--min-cluster', '3', '--write-state'], { timeout: 90000, script });
    check(b.status === 2 && /type program: 8 pages, 2 cluster\(s\) ≥ 3 \(gated 1\)/.test(b.out) && /ungated .*→ \$stardust replica insurance__/.test(b.out), `browser run over the fixture sidecars: 2 clusters, B ungated, exit 2, got ${b.status}\n${b.out}`);
    const st = JSON.parse(readFileSync(join(tmp2, 'stardust', 'state.json'), 'utf8'));
    check(st.pages.find((p) => p.slug === 'insurance__home')?.layoutCluster === 'c1' && st.pages.find((p) => p.slug === 'insurance__umbrella')?.layoutCluster === 'c2', '--write-state stamps layoutCluster per page');
    const d = run(['--root', join(tmp2, 'stardust'), '--type', 'program'], { timeout: 90000, script });
    check(d.status === 0 && /tail {3}3 page\(s\)/.test(d.out), `default T=5 → the 3 B pages are tail, exit 0, got ${d.status}\n${d.out}`);
  } finally { rmSync(tmp2, { recursive: true, force: true }); }
}

if (failures.length) { console.error(`layout-cluster.test: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log(`layout-cluster.test: ok${pw ? ' (browser half ran)' : ''}`);
