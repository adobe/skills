#!/usr/bin/env node
// skills/rollout/scripts/test/done-check.test.mjs — the completion verdict of done-check.mjs: each gap fires
// on its own condition and only then (unfinished rows, failed rows and failed gate rows, delivered rows the
// live host does not serve, open P1 findings the optimize gate would count, a rollout whose last I-dashboard
// line is not an `end`, delivered pages without a published DA library); a clean run is complete; the live probe keeps input order and treats non-200 and
// network errors as not live; a migration project's header must be proven (header_parity: contract, comparison,
// profile by flow, widths, live host, undecided errors); the CLI exits 0 / 1 / 2 and --offline says the probe was skipped. Offline: the
// probe runs against a stub fetch. --help writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/done-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doneGaps, deliveredPaths, headerGap, openP1, probeLive, readGateTables, readWideTables, rolloutEnded, unitsAdvisories, wideAdvisories } from '../done-check.mjs';
import { SOURCE_PARITY_PREFIX, libraryGap, publicUrl } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'done-check.mjs');
let failed = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

// --- fixtures -------------------------------------------------------------------------------------
const row = (slug, path, status, gate) => ({ slug, path, delivery: { status, ...(gate === undefined ? {} : { gate: { pass: gate } }) } });
const CLEAN_PAGES = [row('home', '/', 'verified', true), row('about', '/about', 'verified', true)];
const ENDED = [
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'start' },
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'end' },
];
const finding = (severity, status, evidence = 'x') => ({ id: `${severity}-${status}-${evidence}`, severity, status, fixability: evidence.startsWith(SOURCE_PARITY_PREFIX) ? 'out-of-scope' : 'platform-migration', evidence });

// --- pure verdict ---------------------------------------------------------------------------------
check('publicUrl: a folder index is served at /a/ (its migrated file is …/index.html); leaves, the root and --new rows keep their path', () => {
  assert.equal(publicUrl({ path: '/en/news', source: { migratedHtml: 'stardust/migrated/en/news/index.html' } }), '/en/news/');
  assert.equal(publicUrl({ path: '/en/news/story', source: { migratedHtml: 'stardust/migrated/en/news/story.html' } }), '/en/news/story');
  assert.equal(publicUrl({ path: '/', source: { migratedHtml: 'stardust/migrated/index.html' } }), '/');
  assert.equal(publicUrl({ path: '/search', source: { migratedHtml: 'https://example.com:search' } }), '/search');
});
check('deliveredPaths probes a folder index at /a/, which a 200-only HEAD accepts (/a 404s)', async () => {
  const pages = [{ path: '/en/news', source: { migratedHtml: 'm/en/news/index.html' }, delivery: { status: 'verified' } }];
  assert.deepEqual(deliveredPaths(pages), ['/en/news/']);
  const served = { '/en/news/': 200, '/en/news': 404 };
  assert.deepEqual(await probeLive('https://example.com', deliveredPaths(pages), { fetchImpl: async (u) => ({ status: served[new URL(u).pathname] }) }), []);
});
check('a clean run is complete, with the live probe recorded as run', () => {
  const v = doneGaps({ pages: CLEAN_PAGES, findings: [], ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(v, { complete: true, gaps: [], liveChecked: true });
});

check('unfinished counts every not-yet-verified status, and only those', () => {
  const pages = ['pending', 'content-pending', 'converting', 'deployed', 'stale', 'verified', 'failed'].map((s, i) => row(`p${i}`, `/p${i}`, s));
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.ok(v.gaps.includes('pages_unfinished:5'), v.gaps.join(' | '));
});

check('failed lists failed rows and rows whose gate failed, by path', () => {
  const pages = [row('a', '/a', 'failed'), row('b', '/b', 'verified', false), row('c', '/c', 'verified', true)];
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.ok(v.gaps.includes('pages_failed:2: /a, /b'), v.gaps.join(' | '));
});

check('not-live lists the probe misses; an offline run neither reports it nor claims it checked', () => {
  const live = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: ['/about'] });
  assert.ok(live.gaps.includes('pages_not_live:1: /about'));
  const offline = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: null });
  assert.equal(offline.complete, true);
  assert.equal(offline.liveChecked, false);
});

check('open P1 counts open and in-progress P1s, never source parity, accepted, fixed or P2', () => {
  const findings = [finding('P1', 'open'), finding('P1', 'in-progress'), finding('P1', 'open', `${SOURCE_PARITY_PREFIX}same on source`),
    finding('P1', 'accepted'), finding('P1', 'fixed'), finding('P2', 'open')];
  assert.equal(openP1(findings).length, 2);
  assert.ok(doneGaps({ pages: CLEAN_PAGES, findings, ledgerLines: ENDED, notLive: [] }).gaps.includes('open_p1:2'));
});

check('the rollout is ended only when its LAST I-dashboard line is an end', () => {
  assert.equal(rolloutEnded([]), false);
  assert.equal(rolloutEnded(ENDED), true);
  assert.equal(rolloutEnded([...ENDED, { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'start' }]), false);
  assert.equal(rolloutEnded([{ skill: 'stardust:replica', phase: 'I-dashboard', event: 'end' }]), false);
  assert.ok(doneGaps({ pages: CLEAN_PAGES, ledgerLines: [], notLive: [] }).gaps.includes('rollout_incomplete'));
});

check('library_missing fires only when a page was delivered and the library is not published', () => {
  assert.deepEqual(doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], library: 'library_missing' }).gaps, ['library_missing']);
  assert.deepEqual(doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], library: null }).gaps, []);
  assert.deepEqual(doneGaps({ pages: [row('a', '/a', 'pending')], ledgerLines: ENDED, notLive: [], library: 'library_missing' }).gaps, ['pages_unfinished:1']);
});

check('libraryGap: absent marker, another DA site, and delivered pages the library never read', () => {
  const da = { org: 'o', site: 's' };
  assert.equal(libraryGap(null, { da, delivered: ['/'] }), 'library_missing');
  assert.equal(libraryGap({ org: 'o', site: 's', pages: ['/', '/about'] }, { da, delivered: ['/', '/about'] }), null);
  assert.match(libraryGap({ org: 'o', site: 'old', pages: ['/'] }, { da, delivered: ['/'] }), /^library_missing:published to o\/old, site\.da is o\/s/);
  assert.match(libraryGap({ org: 'o', site: 's', pages: ['/'] }, { da, delivered: ['/', '/about'] }), /^library_missing:stale: 1 delivered page\(s\) not in the library: \/about — re-run da-library\.mjs$/);
  assert.equal(libraryGap({ pages: ['/'] }, { delivered: ['/'] }), null, 'no site.da: only staleness is checked');
  const many = Array.from({ length: 23 }, (_, i) => `/p${i}`);
  assert.match(libraryGap({ org: 'o', site: 's', pages: [] }, { da, delivered: many }), /stale: 23 .*, … \(\+3\) — re-run/);
});

check('libraryGap: a page re-delivered after the library ran is stale even though the library read it', () => {
  const marker = { org: 'o', site: 's', pages: ['/', '/about'], at: '2026-05-01T10:00:00.000Z' };
  const da = { org: 'o', site: 's' };
  const at = (path, deployedAt) => ({ path, deployedAt });
  assert.equal(libraryGap(marker, { da, delivered: [at('/', '2026-05-01T09:00:00.000Z'), at('/about', null)] }), null, 'delivered before the run, or no deployedAt');
  assert.match(libraryGap(marker, { da, delivered: [at('/', '2026-05-01T09:00:00.000Z'), at('/about', '2026-05-01T11:00:00.000Z')] }), /^library_missing:stale: 1 page\(s\) re-delivered after it ran: \/about — re-run da-library\.mjs$/);
  assert.match(libraryGap(marker, { da, delivered: [at('/about', '2026-05-01T11:00:00.000Z'), at('/new', null)] }), /^library_missing:stale: 1 delivered page\(s\) not in the library: \/new; 1 page\(s\) re-delivered after it ran: \/about — re-run/);
  assert.equal(libraryGap({ pages: ['/'] }, { delivered: [at('/', '2026-05-01T11:00:00.000Z')] }), null, 'a marker without `at` cannot be dated');
});

check('gaps come in a fixed order and long path lists are capped', () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`f${i}`, `/f${i}`, 'failed'));
  const v = doneGaps({ pages: [row('u', '/u', 'pending'), row('d', '/d', 'deployed'), ...many], findings: [finding('P1', 'open')], ledgerLines: [], notLive: ['/x'], library: 'library_missing' });
  assert.deepEqual(v.gaps.map((g) => g.split(':')[0]), ['pages_unfinished', 'pages_failed', 'pages_not_live', 'open_p1', 'library_missing', 'rollout_incomplete']);
  assert.match(v.gaps[1], /, … \(\+5\)$/);
});

check('only deployed and verified rows are probed', () => {
  assert.deepEqual(deliveredPaths([row('a', '/a', 'deployed'), row('b', '/b', 'verified'), row('c', '/c', 'pending'), row('d', '/d', 'failed')]), ['/a', '/b']);
});

// --- live probe (stub fetch) ----------------------------------------------------------------------
check('the probe HEADs each path on the host, keeps input order, and counts non-200 and errors as missing', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push([url, opts.method]);
    if (url.endsWith('/gone')) return { status: 404 };
    if (url.endsWith('/moved')) return { status: 301 };
    if (url.endsWith('/boom')) throw new Error('network');
    return { status: 200 };
  };
  const missing = await probeLive('main--site--org.aem.live', ['/', '/boom', '/ok', '/gone', '/moved'], { fetchImpl, concurrency: 2 });
  assert.deepEqual(missing, ['/boom', '/gone', '/moved']);
  assert.ok(seen.every(([u, m]) => u.startsWith('https://main--site--org.aem.live/') && m === 'HEAD'));
});

// --- CLI ------------------------------------------------------------------------------------------
function project({ pages = CLEAN_PAGES, ledger = ENDED, liveHost, library = true, libraryAt } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'done-check-'));
  const out = join(proj, 'stardust', 'rollout');
  mkdirSync(join(out, 'coverage'), { recursive: true });
  if (library) { mkdirSync(join(out, 'library'), { recursive: true }); writeFileSync(join(out, 'library', 'published.json'), JSON.stringify({ pages: (pages || []).map((p) => p.path), at: libraryAt })); }
  if (pages) writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages }));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify(liveHost ? { site: { liveHost } } : {}));
  writeFileSync(join(proj, 'stardust', 'status.jsonl'), ledger.map((l) => JSON.stringify(l)).join('\n'));
  return proj;
}
const run = (proj, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' });

check('CLI: --help prints the usage header and writes nothing', () => {
  const proj = project();
  const before = readdirSync(join(proj, 'stardust')).join();
  const r = run(proj, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pages_not_live/);
  assert.equal(readdirSync(join(proj, 'stardust')).join(), before);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a clean offline run exits 0 and the JSON says the probe was skipped', () => {
  const proj = project();
  const r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { complete: true, gaps: [], liveChecked: false });
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: delivered pages without library/published.json are not complete (library-rows.json alone is a dry run)', () => {
  const proj = project({ library: false });
  mkdirSync(join(proj, 'stardust', 'rollout', 'library'), { recursive: true });
  writeFileSync(join(proj, 'stardust', 'rollout', 'library', 'library-rows.json'), '[]');
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split('\n'), ['library_missing', '✗ 1 gap(s) (live probe skipped: --offline)']);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a page re-delivered (coverage deployedAt) after the library ran is a library gap', () => {
  const pages = [{ ...row('a', '/a', 'deployed'), delivery: { status: 'deployed', deployedAt: '2026-05-01T11:00:00.000Z' } }];
  const proj = project({ pages, libraryAt: '2026-05-01T10:00:00.000Z' });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^library_missing:stale: 1 page\(s\) re-delivered after it ran: \/a — re-run da-library\.mjs$/m);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: gaps exit 1, one line each, then the summary line', () => {
  const proj = project({ pages: [row('a', '/a', 'pending')], ledger: [] });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split('\n'), ['pages_unfinished:1', 'rollout_incomplete', '✗ 2 gap(s) (live probe skipped: --offline)']);
  rmSync(proj, { recursive: true, force: true });
});

check('headerGap: none without a flow; otherwise the contract, a fresh comparison of the right profile at every width on the live host, no undecided error', () => {
  const contract = { url: 'https://example.com/', at: '2026-10-09T10:00:00Z', widths: { 1440: {}, 390: {} } };
  const parity = { source: 'https://example.com/', build: 'https://main--site--org.aem.live/', at: '2026-10-09T12:00:00Z', profile: 'replica', widths: [1440, 390], findings: [] };
  const live = 'main--site--org.aem.live';
  assert.equal(headerGap({ flow: null, contract: null }), null);
  assert.match(headerGap({ flow: 'replica' }), /^header_parity:no contract/);
  assert.match(headerGap({ flow: 'replica', contract }), /^header_parity:unchecked: .*--profile replica/);
  assert.equal(headerGap({ flow: 'replica', contract, parity, liveHost: live }), null);
  assert.match(headerGap({ flow: 'reskin', contract, parity, liveHost: live }), /profile replica; the reskin flow needs functional/);
  assert.match(headerGap({ flow: 'replica', contract, parity: { ...parity, at: '2026-10-08T00:00:00Z' } }), /stale/);
  assert.match(headerGap({ flow: 'replica', contract, parity: { ...parity, widths: [1440] } }), /not compared at 390/);
  assert.match(headerGap({ flow: 'replica', contract, parity: { ...parity, build: 'https://main--site--org.aem.page/' }, liveHost: live }), /not the live host/);
  const findings = [{ key: 'state-missing@1440 Shop [hover]', severity: 'error' }, { key: 'motion@390 Open menu [click]', severity: 'error', decided: { by: 'Site owner' } }, { key: 'link-href@1440 Shop', severity: 'warn' }];
  assert.equal(headerGap({ flow: 'replica', contract, parity: { ...parity, findings }, liveHost: live }), 'header_parity:1: state-missing@1440 Shop [hover]');
  // classes written at the comparison's round cap: printed with the gap, which stays a gap
  const classed = [{ ...findings[0], classed: { class: 'owner', reason: 'the menu service' } }, { key: 'panel-visual@390 Menu [click]', severity: 'error', classed: { class: 'instrument' } }, { key: 'keyboard@1440 Shop', severity: 'error', classed: { class: 'owner' } }, { key: 'motion@1440 Shop [hover]', severity: 'error' }, findings[1]];
  const held = classed.filter((f) => f.classed).map((f) => ({ finding: f.key, class: f.classed.class, reason: 'why' }));
  assert.equal(headerGap({ flow: 'replica', contract, parity: { ...parity, findings: classed }, liveHost: live }), 'header_parity:4: state-missing@1440 Shop [hover], panel-visual@390 Menu [click], keyboard@1440 Shop, motion@1440 Shop [hover]', 'a class the decisions file does not hold is not printed');
  assert.equal(headerGap({ flow: 'replica', contract, parity: { ...parity, findings: classed }, liveHost: live, decisions: [held[0], { ...held[1], reason: '' }, { ...held[2], class: 'instrument' }] }), 'header_parity:4 — 1 owner, 3 no class: state-missing@1440 Shop [hover] (owner), panel-visual@390 Menu [click], keyboard@1440 Shop, motion@1440 Shop [hover]');
  assert.equal(headerGap({ flow: 'replica', contract, parity: { ...parity, findings: classed }, liveHost: live, decisions: held }), 'header_parity:4 — 2 owner, 1 instrument, 1 no class: state-missing@1440 Shop [hover] (owner), panel-visual@390 Menu [click] (instrument), keyboard@1440 Shop (owner), motion@1440 Shop [hover]');
  assert.equal(headerGap({ flow: 'replica', contract, parity: { ...parity, findings: classed.slice(0, 1) }, liveHost: live, decisions: held }), 'header_parity:1 — 1 owner: state-missing@1440 Shop [hover] (owner)');
});

check('CLI: a replica project with no header contract → the never-recorded gap keeps it incomplete; a project with no flow in state.json → no header gap', () => {
  const proj = project();
  let r = run(proj, ['--offline']);
  assert.equal(r.status, 0, r.stdout); assert.doesNotMatch(r.stdout, /header_parity/);
  writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ flow: 'replica' }));
  r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^header_parity:no contract — the header contract was never recorded, so the header's behaviour was never compared: node stardust\/scripts\/diff\/chrome-explore\.mjs <source home> stardust\/chrome\/header-contract\.json/m);
  assert.match(r.stdout, /^✗ 1 gap\(s\)/m);
  writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ flow: 'redesign' }));
  assert.match(run(proj, ['--offline']).stdout, /^header_parity:no contract/m, 'a redesign migration has a header contract too (as before)');
  rmSync(proj, { recursive: true, force: true });
});
check('CLI: a replica project without a header contract is not complete', () => {
  const proj = project();
  writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ flow: 'replica' }));
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1); assert.match(r.stdout, /^header_parity:no contract/m);
  rmSync(proj, { recursive: true, force: true });
});

check('wide_report: an advisory line per wide table that flags a page — printed after the verdict, never a gap; complete and the exit code unchanged', () => {
  const wide = (w, pages, extra = {}) => ({ _provenance: { wide: true, breakpoint: w }, totals: { overThreshold: pages.length }, wide: { line: 'x', pages: pages.map((slug) => ({ slug })) }, ...extra });
  assert.deepEqual(wideAdvisories([wide(2560, ['home', 'about']), wide(1920, [])]), ['wide_report:2: 2560px — home, about']);
  assert.deepEqual(wideAdvisories([{ _provenance: { wide: true, breakpoint: 2560 }, totals: { overThreshold: 3 } }]), ['wide_report:3: 2560px'], 'a table from before the flagged list: its count');
  assert.deepEqual(wideAdvisories([{ _provenance: { breakpoint: 1440 }, totals: { overThreshold: 3 } }, null]), [], 'not a wide table');
  assert.deepEqual(wideAdvisories(), []);
  const proj = project();
  let r = run(proj, ['--offline']);
  assert.equal(r.status, 0); assert.doesNotMatch(r.stdout, /wide_report/, 'no wide report: no line');
  assert.deepEqual(readWideTables(join(proj, 'stardust/replica/gates')), []);
  mkdirSync(join(proj, 'stardust/replica/gates/wide-2560'), { recursive: true });
  writeFileSync(join(proj, 'stardust/replica/gates/wide-2560/summary.json'), JSON.stringify(wide(2560, ['home', 'about'])));
  r = run(proj, ['--offline']);
  assert.equal(r.status, 0, 'the advisory does not change the verdict');
  assert.match(r.stdout, /^✓ complete \(live probe skipped: --offline\)\nwide_report:2: 2560px — home, about$/m);
  const j = JSON.parse(run(proj, ['--offline', '--json']).stdout);
  assert.deepEqual([j.complete, j.gaps, j.advisories], [true, [], ['wide_report:2: 2560px — home, about']]);
  writeFileSync(join(proj, 'stardust/replica/gates/wide-2560/summary.json'), JSON.stringify(wide(2560, [])));
  r = run(proj, ['--offline', '--json']);
  assert.equal('advisories' in JSON.parse(r.stdout), false, 'nothing flagged: the JSON is as it was');
  assert.match(run(proj, ['--help']).stdout, /wide_report:N/);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: usage errors exit 2 — no pages.json; no live host without --offline', () => {
  const noPages = project({ pages: null });
  assert.equal(run(noPages, ['--offline']).status, 2);
  const noHost = project();
  const r = run(noHost, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--live-host/);
  [noPages, noHost].forEach((p) => rmSync(p, { recursive: true, force: true }));
});

check('units_not_declared: an advisory line per published table with pages that took no repeated-unit check — after the verdict, never a gap; complete and the exit code unchanged', () => {
  const table = (w, rows, extra = {}) => ({ _provenance: { breakpoint: w, ...extra }, totals: {}, rows });
  const none = (slug, unitsRecorded = null) => ({ slug, unitsDeclared: 0, unitsRecorded });
  assert.deepEqual(unitsAdvisories([table(1440, [none('home', 2), none('about'), { slug: 'faq', unitsDeclared: 2 }]), table(360, [{ slug: 'faq', unitsDeclared: 1 }])]), ['units_not_declared:2: 1440px — home, about (1 with repeated modules recorded)']);
  assert.deepEqual(unitsAdvisories([table(1440, [none('home')])]), ['units_not_declared:1: 1440px — home']);
  assert.deepEqual(unitsAdvisories([table(1440, [{ slug: 'old', unitPass: null }]), table(2560, [none('home')], { wide: true }), { _provenance: { breakpoint: 1440 } }, null]), [], 'a table from before the count, a wide report, a table without rows: no line');
  assert.deepEqual(unitsAdvisories(), []);
  const proj = project();
  assert.deepEqual(readGateTables(join(proj, 'stardust/replica/gates')), []);
  mkdirSync(join(proj, 'stardust/replica/gates/all-1440'), { recursive: true });
  writeFileSync(join(proj, 'stardust/replica/gates/all-1440/summary.json'), JSON.stringify(table(1440, [none('home', 2), none('about')])));
  let r = run(proj, ['--offline']);
  assert.equal(r.status, 0, 'a page without a unit family does not block the handoff');
  assert.match(r.stdout, /^✓ complete \(live probe skipped: --offline\)\nunits_not_declared:2: 1440px — home, about \(1 with repeated modules recorded\)$/m);
  const j = JSON.parse(run(proj, ['--offline', '--json']).stdout);
  assert.deepEqual([j.complete, j.gaps, j.advisories], [true, [], ['units_not_declared:2: 1440px — home, about (1 with repeated modules recorded)']]);
  writeFileSync(join(proj, 'stardust/replica/gates/all-1440/summary.json'), JSON.stringify(table(1440, [{ slug: 'home', unitsDeclared: 3 }])));
  r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 0); assert.equal('advisories' in JSON.parse(r.stdout), false, 'every page declared: the JSON is as it was');
  assert.match(run(proj, ['--help']).stdout, /units_not_declared:N/);
  rmSync(proj, { recursive: true, force: true });
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
