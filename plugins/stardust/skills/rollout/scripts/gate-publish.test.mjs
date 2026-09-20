#!/usr/bin/env node
// Fixture test: rollout/scripts/gate-publish.mjs — the published-origin page gate as a
// report writer (T15.1) and the seeded coverage-regime sample (T15.2). No browser: the
// round records and crop files are synthetic (the shapes gate.sh / crop-compare write).
//
//   statuses  5 % / Δh 9 → FAIL (height bar); 9 % both bps + one crop 97 % → FAIL (chrome);
//             an exit-124 record → unmeasured, never FAIL; a prototype-regime record is never
//             read (page stays ungated); a page with no record → ungated; wasLive (ledger
//             `live` row) + FAIL → published-failing; a PASS record without crop files →
//             unmeasured (the gate is incomplete, not passed); pass = every configured bp.
//   history   bestOfLast3 = min pixelPct of the last three counted rounds of the regime.
//   KPI       neutralDiff per template × bp from pixelPctUnmasked (median / p90 / share < 10).
//   coverage  line text `published-gated P of M · PASS p · FAIL f · unmeasured u · ungated r`;
//             delivery.gate merged into coverage/pages.json only for the selected rows;
//             gate-report.md written; a second --report run keeps history, no duplicate row.
//   exit      2 when any page FAILs; 0 when the only non-PASS pages are unmeasured/ungated
//             (124 is not a FAIL); 3 on a blocked record; 1 usage (no selection / no coverage).
//   sample    --sample n --seed s is deterministic across two runs, excludes --exclude slugs,
//             differs from the delivery-order head, always includes the archetype, never a
//             non-delivered row; --dry-run prints one sequential gate.sh command per page × bp
//             with --regime published-origin and pub<k> labels, runs nothing, exit 0.
//   never     the script contains no POST /live/ call, no --bar / --threshold flag and no restated crop bar
//             (a crop record without `pass` is no verdict; B29); the footer names no unshipped deploy flag.
//   run       a non-default --gates-dir is refused for a RUN (gate.sh writes the default dir); runPool caps
//             in-flight rounds at --concurrency (2 only for live-cached pages) and keeps item order.
//   label     a RUN reads only its own label's record: no record for the label → unmeasured (exit 3 →
//             blocked), never the previous round's verdict; an explicit label picks that round.
//   residual  the residual door: a valid published-origin residual (named class, artifacts[], acceptedBy —
//             judged by replica's judgeResiduals) turns an over-bar breakpoint into PASS with reason
//             `residual <class>`; one without artifacts[] keeps FAIL and names the defect; a sibling row
//             needs `page: <slug>`; prototype-regime residuals (breakpoints.<W>.residuals) are never read.
//   anchor    the live anchor probe is READ from gates/<slug>-<W>/anchor-live.json (any key) — never
//             re-probed by the driver; a malformed cache → null (the one --cache probe then runs).
//
// Usage: node plugins/stardust/skills/rollout/scripts/gate-publish.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { drawSample, breakpointVerdict, pageStatus, bestOfLast3, coverageLine, runPool, residualsFor, readAnchorCache, RESIDUAL_JUDGE } from './gate-publish.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, 'gate-publish.mjs');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'gate-publish-test-'));
const OUT = join(T, 'stardust', 'rollout');
const GATES = join(T, 'stardust', 'replica', 'gates');
mkdirSync(join(OUT, 'coverage'), { recursive: true });
mkdirSync(join(T, 'content'), { recursive: true });
mkdirSync(GATES, { recursive: true });
const run = (...a) => spawnSync(process.execPath, [CLI, ...a, '--out', OUT, '--gates-dir', GATES, '--ledger', join(T, 'content', '.deploy-ledger.json'), '--state', join(T, 'stardust', 'state.json')], { encoding: 'utf8', cwd: T });

// the script never publishes and exposes no bar flag
const src = readFileSync(CLI, 'utf8');
assert.ok(!/POST[^\n]*\/live\/|fetch\(/.test(src), 'gate-publish must not POST /live/ (it measures and writes; deploy-batch --publish reads the report)');
assert.ok(!/--bar\b|--threshold\b/.test(src), 'no --bar / --threshold flag (B29)');
assert.ok(!/\b98\b/.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')), 'no crop bar restated in code — crop-compare\'s own pass is copied (B29)');
assert.ok(!/publish-ungated|publish-no-regression/.test(src), 'the report footer names no unshipped deploy flag');

// ---- coverage: 3 templates, 7 delivered pages + 1 content-pending + 1 pending ----
const row = (slug, path, templateId, status) => ({ slug, path, templateId, source: { sourceHash: 'h' }, blocks: [], delivery: { status } });
const pages = [
  row('home', '/', 'landing', 'deployed'), row('business', '/business', 'landing', 'deployed'),
  row('news__a', '/news/a', 'article', 'deployed'), row('news__b', '/news/b', 'article', 'deployed'), row('news__c', '/news/c', 'article', 'verified'),
  row('prog__home', '/insurance/home', 'program', 'deployed'), row('prog__auto', '/insurance/auto', 'program', 'deployed'),
  row('prog__life', '/insurance/life', 'program', 'content-pending'), row('prog__boat', '/insurance/boat', 'program', 'pending'),
];
writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', pages }, null, 2));
writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { sourceUrl: 'https://www.example.example', liveHost: 'main--site--org.aem.live' }, lastRun: {} }));
writeFileSync(join(T, 'stardust', 'replica', 'progress.json'), JSON.stringify({ breakpointsConfigured: [1440, 360], archetypes: [{ pageType: 'landing', archetype: 'home' }, { pageType: 'article', archetype: 'news__a' }, { pageType: 'program', archetype: 'prog__home' }] }));
writeFileSync(join(T, 'stardust', 'state.json'), JSON.stringify({ pages: pages.map((p) => ({ slug: p.slug, url: `https://www.example.example${p.path}` })) }));
writeFileSync(join(T, 'content', '.deploy-ledger.json'), JSON.stringify({ '/news/b': { status: 'live' }, '/': { status: 'previewed' } }));

// ---- synthetic round records ----
const rec = (slug, W, label, { verdict, pixelPct, unmasked = pixelPct, dh = 0, exit = verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 2 : 124, regime = 'published-origin', at }) => {
  const dir = join(GATES, `${slug}-${W}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `gate-${label}.json`), JSON.stringify({ slug, label, width: W, regime, at, verdict, exit, pixelPct, pixelPctUnmasked: unmasked, heightDelta: dh, pass: verdict === 'PASS', ref: { url: 'x', width: W, capturedAt: '2026-09-01T00:00:00Z' } }));
  return dir;
};
const crop = (dir, kind, label, matchPct) => writeFileSync(join(dir, `crop-${kind}-${label}.json`), JSON.stringify({ matchPct, diffPct: 100 - matchPct, pass: matchPct >= 98 }));
const crops = (dir, label, h = 99.5, f = 99.1) => { crop(dir, 'header', label, h); crop(dir, 'footer', label, f); };
// home: PASS both bps, three rounds at 1440 (history)
for (const [l, pct, at] of [['pub1', 12.4, '2026-09-10T00:00:00Z'], ['pub2', 6.1, '2026-09-11T00:00:00Z'], ['pub3', 6.9, '2026-09-12T00:00:00Z']]) crops(rec('home', 1440, l, { verdict: pct > 10 ? 'FAIL' : 'PASS', pixelPct: pct, unmasked: pct + 1, at }), l);
crops(rec('home', 360, 'pub1', { verdict: 'PASS', pixelPct: 4.2, at: '2026-09-12T00:01:00Z' }), 'pub1');
// business: 5 % but Δh 9 at 360 → FAIL (height bar)
crops(rec('business', 1440, 'pub1', { verdict: 'PASS', pixelPct: 3.0, at: '2026-09-12T00:00:00Z' }), 'pub1');
crops(rec('business', 360, 'pub1', { verdict: 'PASS', pixelPct: 5.0, dh: 9, at: '2026-09-12T00:00:00Z' }), 'pub1');
// news__a: 9 % both bps, footer crop 97 % at 1440 → FAIL (chrome)
crops(rec('news__a', 1440, 'pub1', { verdict: 'PASS', pixelPct: 9.0, at: '2026-09-12T00:00:00Z' }), 'pub1', 99.0, 97.0);
crops(rec('news__a', 360, 'pub1', { verdict: 'PASS', pixelPct: 9.0, at: '2026-09-12T00:00:00Z' }), 'pub1');
// news__b: already live + FAIL 12.4 at 360 → published-failing
crops(rec('news__b', 1440, 'pub1', { verdict: 'PASS', pixelPct: 7.0, at: '2026-09-12T00:00:00Z' }), 'pub1');
crops(rec('news__b', 360, 'pub1', { verdict: 'FAIL', pixelPct: 12.4, dh: -112, at: '2026-09-12T00:00:00Z' }), 'pub1');
// news__c: exit-124 record at 1440 → unmeasured; PASS at 360
rec('news__c', 1440, 'pub1', { verdict: 'no-verdict', pixelPct: undefined, exit: 124, at: '2026-09-12T00:00:00Z' });
crops(rec('news__c', 360, 'pub1', { verdict: 'PASS', pixelPct: 2.0, at: '2026-09-12T00:00:00Z' }), 'pub1');
// prog__home: only PROTOTYPE records → ungated
rec('prog__home', 1440, 'iter1', { verdict: 'PASS', pixelPct: 1.0, regime: 'prototype', at: '2026-09-12T00:00:00Z' });
// prog__auto: PASS records, crops never run → unmeasured
rec('prog__auto', 1440, 'pub1', { verdict: 'PASS', pixelPct: 4.0, at: '2026-09-12T00:00:00Z' });
rec('prog__auto', 360, 'pub1', { verdict: 'PASS', pixelPct: 4.0, at: '2026-09-12T00:00:00Z' });
// probe (not a coverage row): PASS record + crop files WITHOUT a pass field → no verdict, never re-judged from matchPct (B29)
{ const d = rec('probe', 1440, 'pub1', { verdict: 'PASS', pixelPct: 1.0, at: '2026-09-12T00:00:00Z' }); for (const k of ['header', 'footer']) writeFileSync(join(d, `crop-${k}-pub1.json`), JSON.stringify({ matchPct: 99.9, diffPct: 0.1 })); }

// pure helpers
assert.equal(breakpointVerdict(join(GATES, 'business-360')).status, 'fail');
assert.match(breakpointVerdict(join(GATES, 'business-360')).reason, /Δh.*9 px > 8/);
assert.equal(breakpointVerdict(join(GATES, 'news__a-1440')).status, 'fail');
assert.match(breakpointVerdict(join(GATES, 'news__a-1440')).reason, /footer match 97 % — crop-compare FAIL/);
assert.equal(breakpointVerdict(join(GATES, 'news__c-1440')).status, 'unmeasured');
assert.equal(breakpointVerdict(join(GATES, 'prog__home-1440')).status, 'ungated', 'prototype records are not read');
assert.equal(breakpointVerdict(join(GATES, 'prog__auto-1440')).status, 'unmeasured', 'PASS without crops is incomplete, not a pass');
assert.equal(breakpointVerdict(join(GATES, 'probe-1440')).status, 'unmeasured', 'a crop record without pass is no verdict (matchPct 99.9 is not re-judged against a bar)');
assert.match(breakpointVerdict(join(GATES, 'probe-1440')).reason, /no pass verdict/);
assert.doesNotMatch(breakpointVerdict(join(GATES, 'news__a-1440')).reason, /< 98/, 'the FAIL reason quotes crop-compare, not a restated bar');
assert.equal(breakpointVerdict(join(GATES, 'nowhere-1440')).status, 'ungated');
assert.equal(pageStatus({ 1440: { status: 'fail' }, 360: { status: 'pass' } }, true), 'published-failing');
assert.equal(pageStatus({ 1440: { status: 'unmeasured' }, 360: { status: 'ungated' } }, false), 'unmeasured');
assert.equal(pageStatus({ 1440: { status: 'pass' }, 360: { status: 'ungated' } }, false), 'ungated', 'pass needs every configured breakpoint');
assert.equal(bestOfLast3(breakpointVerdict(join(GATES, 'home-1440')).history), 6.1);
assert.equal(coverageLine({ gated: 3, delivered: 7, pass: 1, fail: 1, unmeasured: 2, ungated: 1, publishedFailing: 1 }), 'published-gated 3 of 7 · PASS 1 · FAIL 1 · unmeasured 2 · ungated 1 · published-failing 1');

// ---- --report over all delivered rows ----
let r = run('--all-delivered', '--report');
assert.equal(r.status, 2, `FAIL pages → exit 2\n${r.stdout}\n${r.stderr}`);
const report = json(join(OUT, 'gate-report.json'));
assert.deepEqual(report.breakpoints, [1440, 360]);
const st = Object.fromEntries(Object.values(report.pages).map((p) => [p.slug, p.latest.status]));
assert.deepEqual(st, { home: 'pass', business: 'fail', news__a: 'fail', news__b: 'published-failing', news__c: 'unmeasured', prog__home: 'ungated', prog__auto: 'unmeasured' });
assert.equal(report.pages['/'].latest.pass, true);
assert.equal(report.pages['/'].bestOfLast3['1440'], 6.1);
assert.equal(report.pages['/news/b'].wasLive, true);
assert.equal(report.pages['/news/c'].latest.breakpoints['1440'].verdict, 'no-verdict');
assert.deepEqual(report.coverage, { delivered: 7, gated: 4, pass: 1, fail: 2, publishedFailing: 1, unmeasured: 2, ungated: 1, blocked: 0 });
assert.match(r.stdout, /published-gated 4 of 7 · PASS 1 · FAIL 2 · unmeasured 2 · ungated 1 · published-failing 1/);
assert.match(r.stdout.trim().split('\n').pop(), /^SUMMARY gate-publish ok=1 failed=3 noverdict=3 exit=2 details=.*gate-report\.json ungated=1 regime=published-origin$/);
assert.equal(report.neutralDiff.landing['1440'].n, 2); // home 7.9 unmasked, business 3.0
assert.equal(report.neutralDiff.landing['1440'].median, 5.45);
assert.equal(report.neutralDiff.landing['1440'].under10, 1);
assert.equal(report._provenance.bars.heightDeltaPx, 8);
// coverage regime: a template is at the bar only when every selected page PASSes
assert.deepEqual(report.templates.landing, { pages: 2, pass: 1, fail: 1, unmeasured: 0, ungated: 0, atBar: false });
assert.deepEqual(report.templates.program, { pages: 2, pass: 0, fail: 0, unmeasured: 1, ungated: 1, atBar: false });
assert.match(r.stdout, /templates not at the bar \(not published\): article \(0\/3 PASS\) · landing \(1\/2 PASS\) · program \(0\/2 PASS\)/);
assert.match(readFileSync(join(OUT, 'gate-report.md'), 'utf8'), /\| landing \| 2 \| 1 \| 1 \| 0 \| 0 \| no — not published \|/);
assert.ok(existsSync(join(OUT, 'gate-report.md')));
assert.match(readFileSync(join(OUT, 'gate-report.md'), 'utf8'), /\| \/news\/b \| published-failing \|/);
// NEGATIVE: the rendered report names the shipped hold, never "pending the deploy hunk"
assert.doesNotMatch(readFileSync(join(OUT, 'gate-report.md'), 'utf8'), /pending the deploy hunk|until then read the held rows/);
assert.match(readFileSync(join(OUT, 'gate-report.md'), 'utf8'), /`deploy-batch --publish` reads this report's JSON and holds them; `--plan` prints the held reasons offline/);
// delivery.gate merged on the selected rows only
const cov = json(join(OUT, 'coverage', 'pages.json')).pages;
assert.equal(cov.find((p) => p.slug === 'home').delivery.gate.status, 'pass');
assert.equal(cov.find((p) => p.slug === 'business').delivery.gate.breakpoints['360'].pass, false);
assert.equal(cov.find((p) => p.slug === 'prog__life').delivery.gate, undefined, 'content-pending rows are not gated');
assert.equal(cov.find((p) => p.slug === 'prog__boat').delivery.gate, undefined, 'undelivered rows are not gated');
// idempotent history: a second run adds no row — for pages with records AND for record-less (ungated) pages
assert.equal(report.pages['/insurance/home'].history.length, 1);
r = run('--all-delivered', '--report');
assert.equal(json(join(OUT, 'gate-report.json')).pages['/'].history.length, 1);
assert.equal(json(join(OUT, 'gate-report.json')).pages['/insurance/home'].history.length, 1, 'an ungated page (no record, `at` = now) gets no new history row per re-run');
assert.equal(json(join(OUT, 'gate-report.json')).pages['/insurance/auto'].history.length, 1, 'an unmeasured page keeps one row too');

// exit 0 when the only non-PASS pages are unmeasured / ungated (B32)
r = run('--paths', '/,/news/c,/insurance/home', '--report');
assert.equal(r.status, 0, `unmeasured/ungated never fail the run\n${r.stdout}`);
assert.match(r.stdout, /published-gated 1 of 3 · PASS 1 · FAIL 0 · unmeasured 1 · ungated 1/);
assert.equal(json(join(OUT, 'gate-report.json')).templates.landing.atBar, true, 'a template whose every selected page passes is at the bar');
// exit 3 on a blocked record
rec('prog__home', 1440, 'pub1', { verdict: 'no-verdict', pixelPct: undefined, exit: 3, at: '2026-09-13T00:00:00Z' });
r = run('--slug', 'prog__home', '--report');
assert.equal(r.status, 3);
// usage
assert.equal(run('--report').status, 1);
assert.equal(spawnSync(process.execPath, [CLI, '--all-delivered', '--report', '--out', join(T, 'nope')], { encoding: 'utf8' }).status, 1);
assert.equal(run('--all-delivered').status, 1, '--origin required to run');
// a RUN with a non-default --gates-dir is refused while gate.sh writes stardust/replica/gates only (records would land elsewhere)
r = run('--slug', 'home', '--origin', 'https://main--site--org.aem.page');
assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, /--gates-dir .* cannot be used for a RUN .*GATE_DIR_ROOT/);
assert.ok(!existsSync(join(GATES, 'home-1440', 'gate-pub4.json')), 'nothing ran');
// --concurrency: runPool caps in-flight work (2 for cached pages, 1 = sequential) and keeps item order
{ let inFlight = 0; let peak = 0; const job = (ms) => async (x) => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((res) => setTimeout(res, ms)); inFlight -= 1; return x * 2; };
  assert.deepEqual(await runPool([1, 2, 3, 4], 2, job(15)), [2, 4, 6, 8]); assert.equal(peak, 2, 'concurrency 2 = two rounds in flight');
  peak = 0; await runPool([1, 2, 3], 1, job(5)); assert.equal(peak, 1, 'sequential by default');
  assert.deepEqual(await runPool([], 2, job(1)), []); }
assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);

// ---- seeded sample (T15.2) ----
const delivered = pages.filter((p) => ['deployed', 'verified', 'stale', 'failed'].includes(p.delivery.status));
const many = [...delivered, ...Array.from({ length: 30 }, (_, i) => row(`news__x${String(i).padStart(2, '0')}`, `/news/x${i}`, 'article', 'deployed'))];
const a = drawSample(many, { n: 3, seed: 7, archetypes: new Set(['news__a']) }).map((p) => p.slug);
const b = drawSample(many, { n: 3, seed: 7, archetypes: new Set(['news__a']) }).map((p) => p.slug);
assert.deepEqual(a, b, 'deterministic for a fixed seed');
assert.notDeepEqual(a, drawSample(many, { n: 3, seed: 8, archetypes: new Set(['news__a']) }).map((p) => p.slug));
const art = a.filter((s) => s.startsWith('news__'));
assert.equal(art[0], 'news__a', 'archetype first, always in');
assert.equal(art.length, 4);
const head = many.filter((p) => p.templateId === 'article').slice(0, 4).map((p) => p.slug);
assert.notDeepEqual(art, head, 'not the delivery-order head');
const ex = drawSample(many, { n: 3, seed: 7, exclude: new Set(art.slice(1)), archetypes: new Set(['news__a']) }).map((p) => p.slug);
assert.ok(art.slice(1).every((s) => !ex.includes(s)), '--exclude slugs are never drawn');
// CLI: --dry-run prints one sequential gate.sh command per page × bp, pub<k> labels, no run
r = run('--sample', '1', '--seed', '7', '--exclude', 'news__b', '--dry-run', '--origin', 'https://main--site--org.aem.page');
assert.equal(r.status, 0, r.stderr);
const cmds = r.stdout.split('\n').filter((l) => /^bash .*gate\.sh/.test(l));
assert.ok(cmds.length >= 6 && cmds.length % 2 === 0, `one command per page × bp: ${cmds.length}`);
assert.ok(cmds.every((c) => /--regime published-origin/.test(c) && / pub\d+ /.test(c) && /aem\.page/.test(c)), cmds[0]);
assert.ok(cmds.some((c) => / home /.test(c)) && cmds.some((c) => / news__a /.test(c)) && cmds.some((c) => / prog__home /.test(c)), 'every archetype drawn');
assert.ok(!cmds.some((c) => / news__b /.test(c)), 'excluded slug not drawn');
// Correction 3: an archetype round carries --record so gate.sh upserts progress.json published.<bp>; sibling rows never do
assert.ok(cmds.filter((c) => / (home|news__a|prog__home) /.test(c)).every((c) => / --record( |$)/.test(c)), `archetype rounds carry --record: ${cmds.join('\n')}`);
assert.ok(cmds.filter((c) => !/ (home|news__a|prog__home) /.test(c)).every((c) => !/ --record( |$)/.test(c)), 'sibling rounds never write the archetype slot');
assert.ok(!cmds.some((c) => / prog__life | prog__boat /.test(c)), 'non-delivered rows never drawn');
assert.match(cmds.find((c) => / home /.test(c) && / 1440 /.test(c)), / pub4 /, 'label continues after the three existing rounds');
assert.match(r.stdout, /nothing ran/);
assert.ok(!existsSync(join(OUT, 'gate-report.json.tmp')));
const beforeDry = readFileSync(join(OUT, 'gate-report.json'), 'utf8');
assert.equal(readFileSync(join(OUT, 'gate-report.json'), 'utf8'), beforeDry, '--dry-run writes nothing');

// ---- label-scoped verdict: a RUN never reads an older round when its own wrote no record ----
assert.equal(breakpointVerdict(join(GATES, 'home-1440')).label, 'pub3', 'newest by default');
assert.equal(breakpointVerdict(join(GATES, 'home-1440'), { label: 'pub2' }).pixelPct, 6.1, 'an explicit label picks that round');
{ const v = breakpointVerdict(join(GATES, 'home-1440'), { label: 'pub9', exit: 125 });
  assert.equal(v.status, 'unmeasured', 'no record for the label → unmeasured, not the previous PASS'); assert.match(v.reason, /wrote no record for pub9 \(exit 125\)/); assert.equal(v.history.length, 3, 'history still carried');
  assert.equal(breakpointVerdict(join(GATES, 'home-1440'), { label: 'pub9', exit: 3 }).status, 'blocked');
  assert.equal(breakpointVerdict(join(GATES, 'nowhere-360'), { label: 'pub1', exit: 1 }).status, 'unmeasured', 'usage exit + empty dir is unmeasured for a RUN, ungated only for --report'); }

// ---- residual door (publish-gate.md § Gate 8, escape hatch c) ----
assert.ok(RESIDUAL_JUDGE && typeof RESIDUAL_JUDGE.judge === 'function' && RESIDUAL_JUDGE.classes.size > 0, 'replica judge + class table loaded beside the skill');
const valid = { band: 'y 0–96', pct: 2.1, cause: 'glyph-antialiasing: footer link column', artifacts: ['gates/news__a-1440/crop-footer-pub1.json'], acceptedBy: 'hands-off-policy:glyph-antialiasing' };
{ const v = breakpointVerdict(join(GATES, 'news__a-1440'), { residuals: [valid] });
  assert.equal(v.status, 'pass'); assert.equal(v.pass, true); assert.match(v.reason, /^residual glyph-antialiasing accepted by hands-off-policy:glyph-antialiasing \(was: chrome crop footer/); assert.deepEqual(v.residual.class, 'glyph-antialiasing');
  const noArt = breakpointVerdict(join(GATES, 'business-360'), { residuals: [{ ...valid, artifacts: [] }] });
  assert.equal(noArt.status, 'fail', 'a residual without artifacts[] opens nothing'); assert.match(noArt.reason, /residual door closed: residuals without artifacts\[\]/);
  assert.equal(breakpointVerdict(join(GATES, 'business-360'), { residuals: [{ ...valid, cause: 'looks fine' }] }).status, 'fail', 'an unnamed class opens nothing');
  assert.equal(breakpointVerdict(join(GATES, 'business-360'), { residuals: [{ ...valid, cause: 'live-drift: x', acceptedBy: 'hands-off-policy:live-drift' }] }).status, 'fail', 'hands-off-policy on a non-permanent class opens nothing');
  assert.equal(breakpointVerdict(join(GATES, 'business-360'), { residuals: [{ ...valid, cause: 'register:R-01 footer colour', acceptedBy: 'register:R-01' }] }).residual.class, 'register:R-01');
  assert.equal(breakpointVerdict(join(GATES, 'business-360'), { residuals: [valid], judge: null }).status, 'fail', 'no judge available → door closed');
  assert.equal(breakpointVerdict(join(GATES, 'news__c-1440'), { residuals: [valid] }).status, 'unmeasured', 'a residual never turns no-verdict into PASS'); }
// residualsFor: published-origin regime only, archetype row or a sibling row naming page
{ const prog = { archetypes: [{ pageType: 'landing', archetype: 'home', breakpoints: { 360: { residuals: [{ ...valid, cause: 'third-party-in-flow: chat' }] } }, published: { 360: { residuals: [valid, { ...valid, page: 'business', cause: 'nondeterministic-live: ticker', acceptedBy: 'user' }] } } }] };
  assert.deepEqual(residualsFor(prog, { slug: 'home', template: 'landing', W: 360 }), [valid], 'the archetype gets its own rows (no page field)');
  assert.equal(residualsFor(prog, { slug: 'business', template: 'landing', W: 360 })[0].cause, 'nondeterministic-live: ticker', 'a sibling gets only rows naming it');
  assert.deepEqual(residualsFor(prog, { slug: 'home', template: 'landing', W: 1440 }), [], 'per width');
  assert.deepEqual(residualsFor({ archetypes: [{ pageType: 'landing', archetype: 'home', breakpoints: { 360: { residuals: [valid] } } }] }, { slug: 'home', template: 'landing', W: 360 }), [], 'prototype-regime residuals are never read'); }
// CLI: the door through --report (business 360 FAIL by Δh 9 → PASS with a sibling residual), the md names the class
writeFileSync(join(T, 'stardust', 'replica', 'progress.json'), JSON.stringify({ breakpointsConfigured: [1440, 360], archetypes: [{ pageType: 'landing', archetype: 'home', published: { 360: { residuals: [{ ...valid, page: 'business', cause: 'tag-injected-tail: consent footer', acceptedBy: 'user' }] } } }, { pageType: 'article', archetype: 'news__a' }, { pageType: 'program', archetype: 'prog__home' }] }));
r = run('--paths', '/business', '--report');
assert.equal(r.status, 0, `residual-door PASS → exit 0\n${r.stdout}`);
assert.match(r.stdout, /published-gated 1 of 1 · PASS 1 · FAIL 0/);
assert.equal(json(join(OUT, 'gate-report.json')).pages['/business'].latest.breakpoints['360'].residual.class, 'tag-injected-tail');
assert.match(readFileSync(join(OUT, 'gate-report.md'), 'utf8'), /\| \/business \| pass \| PASS 3 % Δh 0 \| PASS 5 % Δh 9 \(residual tag-injected-tail\) \|/);
writeFileSync(join(T, 'stardust', 'replica', 'progress.json'), JSON.stringify({ breakpointsConfigured: [1440, 360], archetypes: [{ pageType: 'landing', archetype: 'home', published: { 360: { residuals: [{ ...valid, page: 'business', cause: 'tag-injected-tail: consent footer', artifacts: [], acceptedBy: 'user' }] } } }] }));
r = run('--paths', '/business', '--report');
assert.equal(r.status, 2, 'an invalid residual keeps the FAIL');
assert.match(json(join(OUT, 'gate-report.json')).pages['/business'].latest.breakpoints['360'].reason, /residual door closed: residuals without artifacts/);

// ---- anchor cache read, never re-probed ----
{ const f = join(T, 'anchor-live.json'); const data = { url: 'https://www.example.example/', sections: [{ label: 'hero', box: [96, 520] }], footer: [3100, 420], doc: 3520 };
  writeFileSync(f, JSON.stringify({ key: { url: data.url, width: 1440, main: '#content' }, probedAt: '2026-09-12T00:00:00Z', data }));
  assert.deepEqual(readAnchorCache(f), data, 'the cached probe is read whatever options (--main) it was probed with');
  writeFileSync(f, '{not json'); assert.equal(readAnchorCache(f), null); assert.equal(readAnchorCache(join(T, 'missing.json')), null);
  assert.match(src, /readAnchorCache\(join\(dir, 'anchor-live\.json'\)\) \|\| anchor\(live/, 'the live probe runs only when no cache file exists'); }

rmSync(T, { recursive: true, force: true });
console.log('gate-publish.test: ok (statuses, history, KPI, coverage, exits, sample, label-scoped verdict, residual door, anchor cache)');
