#!/usr/bin/env node
// skills/rollout/scripts/test/done-check.test.mjs — the completion verdict of done-check.mjs: each gap fires
// on its own condition and only then (unfinished rows, failed rows and failed gate rows, delivered rows the
// live host does not serve, open P1 findings the optimize gate would count, a rollout whose last I-dashboard
// line is not an `end`); a clean run is complete; the live probe keeps input order and treats non-200 and
// network errors as not live; a migration project's header must be proven (header_parity: contract, comparison,
// profile by flow, widths, live host, undecided errors); the CLI exits 0 / 1 / 2 and --offline says the probe was skipped. Offline: the
// probe runs against a stub fetch. --help writes nothing. Delivery is proven: override rows are capped at 10 % and
// each cites a `## R-<nn>` register entry (either override shape, the recorded gate table for a bare verdict);
// every done unit's pages passed the gate at each width (delivery.gate.passByWidth; a row gated before it is proven
// on its last width's pass, counted as skipped); every delivered row has its schema, both gate widths (in a
// flow with a gate table — replica, or any gated row; else skipped) and, when its path changed, a redirects line (in
// the sheet or the redirects-cdn.tsv beside it); every ledger `end` is paired or re-recorded; the checks that did not
// run are listed as skipped; ledger.mjs resolves in the project-copy layout too, and its absence is a gap. A row
// whose gate failed at any recorded width (passByWidth[w] === false) is pages_failed though its last width passed;
// a gate with no verdict is gates_inconclusive (and pages_failed only when the row failed for another reason); an object
// override counts only with gate-all's `valid: true`; header_parity_errors counts the undecided errors of
// header-parity.json in any project (its findings decide; counts.error alone without them), and is left
// out when header_parity already names those errors (one finding set, one gap). export_stale (judged only when
// rollout.json exports lists migration-workspace, never after handover) names a missing manifest, manifest hashes
// that differ from the tree, a mapping.json missing while captures exist, unreadable or with another generatedAt
// than pages.json, with inventory → block-origin → manifest as the remedy. pages.json excluded[] rows and module
// blocks delivered without a conversion record are info lines (pages_excluded, blocks_pending), never gaps; so are
// the export_quality figures the manifest carries (zero_confidence, null_selector_sections, judgement_to_fill,
// encode_unrecorded), hidden after handover.
// Run: node plugins/stardust/skills/rollout/scripts/test/done-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as doneCheck from '../done-check.mjs';
import { doneGaps, deliveredPaths, headerGap, headerParityErrors, inferredLiveHost, ledgerGap, OFFLINE_SKIP, openP1, overrideGap, overrideRef, probeLive, registerEntries, rolloutEnded, sidecarGap, unitGaps, widthsJudged, WIDTHS_SKIP } from '../done-check.mjs';
import { SOURCE_PARITY_PREFIX, publicUrl } from '../lib.mjs';
import { blockOriginInputDirs, inputHashes } from '../workspace-manifest.mjs';
import { pathKey } from '../../../deploy/scripts/eds-path.mjs';
import { unpairedEnds } from '../../../stardust/scripts/ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'done-check.mjs');
let failed = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

// --- fixtures -------------------------------------------------------------------------------------
const row = (slug, path, status, gate) => ({ slug, path, delivery: { status, ...(gate === undefined ? {} : { gate: { pass: gate } }) } });
const AT = { 1440: '2026-10-09T10:00:00Z', 360: '2026-10-09T10:05:00Z' };
// a delivered row with everything delivery needs: a passing gate at both widths, its source URL on the same path
const proven = (r, gate = {}) => ({ ...r, source: { sourceUrl: `https://example.com${r.path}` }, delivery: { ...r.delivery, gate: { pass: true, reasons: [], atByWidth: { ...AT }, passByWidth: { 1440: true, 360: true }, ...gate } } });
const CLEAN_PAGES = [proven(row('home', '/', 'verified', true)), proven(row('about', '/about', 'verified', true))];
const ENDED = [
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'start' },
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'end' },
];
const finding = (severity, status, evidence = 'x') => ({ id: `${severity}-${status}-${evidence}`, severity, status, fixability: evidence.startsWith(SOURCE_PARITY_PREFIX) ? 'out-of-scope' : 'platform-migration', evidence });

// --- pure verdict ---------------------------------------------------------------------------------
check('publicUrl: the URL the page was deployed at (delivery.deployedUrl by the delivered-path contract), else its path — the migrated file name never adds a slash', () => {
  const news = { path: '/en/news', source: { migratedHtml: 'stardust/migrated/en/news/index.html' } };
  assert.equal(publicUrl(news), '/en/news');
  assert.equal(publicUrl({ ...news, delivery: { deployedUrl: 'https://h/en/news/' } }), '/en/news/');
  assert.equal(publicUrl({ ...news, delivery: { deployedUrl: 'https://h/en/news' } }), '/en/news');
  assert.equal(publicUrl({ ...news, delivery: { deployedUrl: 'https://h/en/news.html?x=1#top' } }), '/en/news');
  assert.equal(publicUrl({ path: '/a', delivery: { deployedUrl: '/a/index' } }), '/a/');
  assert.equal(publicUrl({ path: '/en/news/story', source: { migratedHtml: 'stardust/migrated/en/news/story.html' } }), '/en/news/story');
  assert.equal(publicUrl({ path: '/', source: { migratedHtml: 'stardust/migrated/index.html' } }), '/');
  for (const deployedUrl of ['https://h/', 'https://h', 'https://h/index', '/index.html']) assert.equal(publicUrl({ path: '/', delivery: { deployedUrl } }), '/', deployedUrl);
  assert.equal(publicUrl({ slug: 'search', delivery: { deployedUrl: '' } }), '/search');
  assert.equal(publicUrl({ path: '/search', source: { migratedHtml: 'https://example.com:search' } }), '/search');
});
check('deliveredPaths probes each row where it was deployed — a folder index at /a/ only when its document went there', async () => {
  const pages = [
    { path: '/en/news', source: { migratedHtml: 'm/en/news/index.html' }, delivery: { status: 'verified', deployedUrl: 'https://example.com/en/news/' } },
    { path: '/en/about', source: { migratedHtml: 'm/en/about/index.html' }, delivery: { status: 'verified', deployedUrl: 'https://example.com/en/about' } },
    { path: '/en/team', source: { migratedHtml: 'm/en/team/index.html' }, delivery: { status: 'verified' } },
  ];
  assert.deepEqual(deliveredPaths(pages), ['/en/news/', '/en/about', '/en/team']);
  const served = { '/en/news/': 200, '/en/news': 404, '/en/about': 200, '/en/about/': 404, '/en/team': 200, '/en/team/': 404 };
  assert.deepEqual(await probeLive('https://example.com', deliveredPaths(pages), { fetchImpl: async (u) => ({ status: served[new URL(u).pathname] }) }), []);
});
check('a clean run is complete, with the live probe recorded as run', () => {
  const v = doneGaps({ pages: CLEAN_PAGES, findings: [], ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(v, { complete: true, gaps: [], liveChecked: true, skipped: [], info: [] });
});
check('pages_excluded: excluded[] rows of pages.json are info, never a gap — the run stays complete', () => {
  const excluded = [{ slug: 'news', path: '/news', status: 'excluded', reason: 'r' }, { slug: 'old', path: null, status: 'excluded', reason: 'r' }];
  const v = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], excluded });
  assert.deepEqual(v, { complete: true, gaps: [], liveChecked: true, skipped: [], info: ['pages_excluded:2: /news, /old'] });
});
check('blocks_pending: blocks delivered without a conversion record are info naming the remedy, never a gap — after pages_excluded', () => {
  const v = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], excluded: [{ slug: 'news', path: '/news' }], pendingBlocks: ['hero', 'teaser'] });
  assert.equal(v.complete, true);
  assert.deepEqual(v.info, ['pages_excluded:1: /news', 'blocks_pending:2: hero, teaser — record each: update-coverage.mjs --block <name|id> --status converted']);
  assert.deepEqual(doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], pendingBlocks: [] }).info, []);
});
check('export_quality: the manifest zero-confidence count is an info line above the threshold (default 0), never a gap; at/below it nothing; null is silent; completeness never flips', () => {
  const base = { pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [] };
  const some = doneGaps({ ...base, zeroConfidence: 48 });
  assert.deepEqual([some.complete, some.gaps, some.info], [true, [], ['export_quality:zero_confidence:48']]);
  assert.deepEqual(doneGaps({ ...base, zeroConfidence: 0 }).info, [], 'at the default threshold 0: no line');
  assert.deepEqual(doneGaps({ ...base }).info, [], 'null (no manifest / not listed): no line');
  assert.deepEqual(doneGaps({ ...base, zeroConfidence: 3, zeroConfidenceThreshold: 3 }).info, [], 'at the threshold: no line');
  assert.deepEqual(doneGaps({ ...base, zeroConfidence: 4, zeroConfidenceThreshold: 3 }).info, ['export_quality:zero_confidence:4'], 'above a raised threshold: a line');
  // it leads the info lines and never flips completeness, even beside a real gap
  const withGap = doneGaps({ ...base, ledgerLines: [], excluded: [{ slug: 'news', path: '/news' }], zeroConfidence: 5 });
  assert.ok(withGap.gaps.includes('rollout_incomplete') && !withGap.complete);
  assert.deepEqual(withGap.info, ['export_quality:zero_confidence:5', 'pages_excluded:1: /news']);
});
check('export_quality: the manifest null-selector section count is an info line when > 0, never a gap; 0 and null are silent; it rides beside zero_confidence and completeness never flips', () => {
  const base = { pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [] };
  assert.deepEqual(doneGaps({ ...base, nullSelectorSections: 9 }).info, ['export_quality:null_selector_sections:9']);
  assert.deepEqual(doneGaps({ ...base, nullSelectorSections: 0 }).info, [], '0: no line');
  assert.deepEqual(doneGaps({ ...base }).info, [], 'null (no manifest / not listed): no line');
  // both quality lines together, zero_confidence first; completeness stays true
  const both = doneGaps({ ...base, zeroConfidence: 2, nullSelectorSections: 9 });
  assert.deepEqual([both.complete, both.gaps, both.info], [true, [], ['export_quality:zero_confidence:2', 'export_quality:null_selector_sections:9']]);
});
check('export_quality: the manifest judgement.toFill count is an info line when > 0, never a gap; 0 and null are silent; it rides after the other two quality lines and completeness never flips', () => {
  const base = { pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [] };
  assert.deepEqual(doneGaps({ ...base, judgementToFill: 23 }).info, ['export_quality:judgement_to_fill:23']);
  assert.deepEqual(doneGaps({ ...base, judgementToFill: 0 }).info, [], '0: no line');
  assert.deepEqual(doneGaps({ ...base }).info, [], 'null (no manifest / not listed): no line');
  // all three quality lines together, in order; completeness stays true
  const all3 = doneGaps({ ...base, zeroConfidence: 2, nullSelectorSections: 9, judgementToFill: 14 });
  assert.deepEqual([all3.complete, all3.gaps, all3.info], [true, [], ['export_quality:zero_confidence:2', 'export_quality:null_selector_sections:9', 'export_quality:judgement_to_fill:14']]);
});
check('export_quality: the manifest selectorQuality.encode.unrecorded count (multi-page templates without an encode decision) is an info line when > 0, never a gap; 0 and null are silent; it rides last among the quality lines and completeness never flips', () => {
  const base = { pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [] };
  assert.deepEqual(doneGaps({ ...base, encodeUnrecorded: 2 }).info, ['export_quality:encode_unrecorded:2']);
  assert.deepEqual(doneGaps({ ...base, encodeUnrecorded: 0 }).info, [], '0: no line');
  assert.deepEqual(doneGaps({ ...base }).info, [], 'null (no manifest / not listed / a manifest from before the field): no line');
  const all4 = doneGaps({ ...base, zeroConfidence: 2, nullSelectorSections: 9, judgementToFill: 14, encodeUnrecorded: 2, excluded: [{ slug: 'news', path: '/news' }] });
  assert.deepEqual([all4.complete, all4.gaps, all4.info], [true, [], ['export_quality:zero_confidence:2', 'export_quality:null_selector_sections:9', 'export_quality:judgement_to_fill:14', 'export_quality:encode_unrecorded:2', 'pages_excluded:1: /news']]);
  const withGap = doneGaps({ ...base, ledgerLines: [], encodeUnrecorded: 1 });
  assert.ok(withGap.gaps.includes('rollout_incomplete') && !withGap.complete);
  assert.deepEqual(withGap.info, ['export_quality:encode_unrecorded:1']);
});
check('CLI: coverage blocks.json rows delivered without a conversion record print the blocks_pending info line; exit 0', () => {
  const blocks = { blocks: [
    { id: 'hero-banner', kind: 'module', delivery: { status: 'pending', edsBlockName: 'hero' }, variants: [{ id: 'v_1', classes: [], pages: 1, instances: 2 }] },
    { id: 'three-up', kind: 'module', delivery: { status: 'converted', edsBlockName: 'columns' }, variants: [{ id: 'v_2', classes: [], pages: 1, instances: 1 }] },
  ] };
  const proj = project({ files: { 'stardust/rollout/coverage/blocks.json': blocks } });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.split('\n').includes('info: blocks_pending:1: hero — record each: update-coverage.mjs --block <name|id> --status converted'), r.stdout);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: blocks_unjudged — a migration-workspace export with delivered blocks whose base type is not judged (unknown or missing) is a gap; a judged base type clears it; not an export → not judged here', () => {
  const blocks = (bt) => ({ blocks: [
    { id: 'hero-banner', kind: 'module', delivery: { status: 'converted', edsBlockName: 'hero' }, ...(bt.hero !== undefined ? { baseType: bt.hero } : {}), variants: [{ id: 'v1', classes: [], pages: 1, instances: 1 }] },
    { id: 'link-list', kind: 'module', delivery: { status: 'converted', edsBlockName: 'teaser' }, ...(bt.teaser !== undefined ? { baseType: bt.teaser } : {}), variants: [{ id: 'v2', classes: [], pages: 1, instances: 1 }] },
  ] });
  const unjudged = (listed, bt) => {
    const proj = project({ files: { 'stardust/rollout/rollout.json': listed ? { exports: ['migration-workspace'] } : {}, 'stardust/rollout/coverage/blocks.json': blocks(bt) } });
    const g = JSON.parse(run(proj, ['--offline', '--json']).stdout).gaps.filter((x) => x.startsWith('blocks_unjudged'));
    rmSync(proj, { recursive: true, force: true });
    return g;
  };
  assert.deepEqual(unjudged(true, { hero: 'unknown', teaser: 'cards' }), ['blocks_unjudged:1'], 'unknown is not a judged value; cards is');
  assert.deepEqual(unjudged(true, {}), ['blocks_unjudged:2'], 'both missing a base type');
  assert.deepEqual(unjudged(true, { hero: 'hero', teaser: 'cards' }), [], 'both judged → no gap');
  assert.deepEqual(unjudged(false, {}), [], 'not a migration-workspace export: base types are not judged here');
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

// an inconclusive gate (a polluted capture): recorded pass false, reasons in `inconclusive`, status never flipped
const inconclusive = (r, why = 'capture polluted: consent banner over the fold at 360', delivery = {}) => ({ ...r, delivery: { ...r.delivery, ...delivery, gate: { ...(r.delivery.gate || {}), pass: false, inconclusive: why } } });
check('gates_inconclusive: a gate with no verdict is named apart from pages_failed; a row failed for another reason stays failed too', () => {
  const pages = [
    row('ok', '/ok', 'verified', true),
    inconclusive(row('a', '/a', 'verified')),
    inconclusive(row('b', '/b', 'failed'), undefined, { error: 'gate: pixel 14.2 > 10' }),
    inconclusive(row('c', '/c', 'failed'), undefined, { error: 'deploy: 401 on preview' }),
    inconclusive(row('d', '/d', 'verified'), true),
    row('e', '/e', 'verified', false),
    inconclusive(row('f', '/f', 'verified'), ''),
    { ...row('g', '/g', 'verified'), delivery: { status: 'verified', gate: { pass: false, inconclusive: null } } },
  ];
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(v.gaps, ['pages_failed:4: /c, /e, /f, /g', 'gates_inconclusive:4: /a, /b, /c, /d']);
  assert.equal(v.complete, false);
  const only = doneGaps({ pages: [...CLEAN_PAGES, inconclusive(proven(row('x', '/x', 'verified')))], ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(only.gaps, ['gates_inconclusive:1: /x'], 'never complete, never failed');
});

check('pages_failed: any recorded width whose verdict is false fails the row, whichever width passed last; a null width (no verdict) does not', () => {
  const widths = (r, passByWidth, extra = {}) => proven(r, { pass: true, passByWidth, ...extra });
  const pages = [
    ...CLEAN_PAGES,
    widths(row('a', '/a', 'verified'), { 1440: false, 360: true }),
    widths(row('b', '/b', 'failed'), { 1440: false, 360: true }),
    widths(row('c', '/c', 'verified'), { 1440: true, 360: null }),
    widths(row('d', '/d', 'verified'), { 1440: false, 360: null }, { inconclusive: 'capture polluted at 360' }),
    widths(row('e', '/e', 'verified'), { 1440: true, 360: null }, { inconclusive: 'capture polluted at 360' }),
    widths(row('f', '/f', 'verified'), 'no'),
  ];
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(v.gaps, ['pages_failed:3: /a, /b, /d', 'gates_inconclusive:2: /d, /e']);
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

check('gaps come in a fixed order and long path lists are capped', () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`f${i}`, `/f${i}`, 'failed'));
  const v = doneGaps({ pages: [row('u', '/u', 'pending'), ...many], findings: [finding('P1', 'open')], ledgerLines: [], notLive: ['/x'] });
  assert.deepEqual(v.gaps.map((g) => g.split(':')[0]), ['pages_unfinished', 'pages_failed', 'pages_not_live', 'open_p1', 'rollout_incomplete']);
  assert.match(v.gaps[1], /, … \(\+5\)$/);
});

check('only deployed and verified rows are probed', () => {
  assert.deepEqual(deliveredPaths([row('a', '/a', 'deployed'), row('b', '/b', 'verified'), row('c', '/c', 'pending'), row('d', '/d', 'failed')]), ['/a', '/b']);
});

// --- delivery proof: overrides, units, sidecars, ledger -------------------------------------------
const REGISTER = '# Inconsistency register\n\n## R-07 — the hero shifts a tier on a site with a consent manager\n\nwhy, scope, owner\n';
const TABLE = 'stardust/replica/gates/all-1440/summary.json';
const plain = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => proven(row(`${prefix}${i}`, `/${prefix}${i}`, 'verified')));
// an override row whose own measurements failed (reasons non-empty) unless `reasons` says otherwise
const overridden = (slug, override, gate = {}) => proven(row(slug, `/${slug}`, 'verified'), { reasons: ['pixel 14.2 > 10'], override, ...gate });
// gate-all's validated object override (a table with gate-all's override check); a bare string is the older verdict form
const CITED = { verdict: 'tier-shift', reason: 'tier shift above the fold (R-07)', valid: true };
const NOT_VALIDATED = (paths) => `${paths.length} not validated by gate-all (override.valid is not true): ${paths.join(', ')}`;

check('pages_overridden: rows passing by override above 10 % of delivered rows are a gap; exactly 10 % is not', () => {
  const at10 = [...plain(18), overridden('o1', CITED), overridden('o2', CITED), { ...overridden('n1', CITED), delivery: { status: 'pending', gate: { pass: true, override: CITED } } }];
  assert.equal(overrideGap({ pages: at10, register: REGISTER }), null);
  const above = [...plain(17), overridden('o1', CITED), overridden('o2', CITED), overridden('o3', CITED)];
  assert.equal(overrideGap({ pages: above, register: REGISTER }), 'pages_overridden:3: 3/20 delivered pages pass by override (cap 10 %)');
});

check('pages_overridden: an override under the cap needs a `## R-<nn>` heading in the register', () => {
  const pages = [...plain(19), overridden('o1', CITED)];
  assert.equal(overrideGap({ pages, register: '' }), 'pages_overridden:1: no register entry for /o1');
  assert.equal(overrideGap({ pages, register: '## R-08 — another trait\n\nsee R-07\n### R-07 — not an entry heading\n' }), 'pages_overridden:1: no register entry for /o1');
  assert.equal(overrideGap({ pages, register: REGISTER }), null);
  assert.equal(overrideGap({ pages: [...plain(19), overridden('o1', { verdict: 'tier-shift', reason: 'banner', valid: true })], register: REGISTER }), 'pages_overridden:1: no register entry for /o1');
  assert.deepEqual([...registerEntries(`${REGISTER}## R-12 — second\n## R-3x — malformed\n`)], ['R-07', 'R-12']);
});

check('pages_overridden: an object override is earned only with valid: true — valid false or absent (a table older than the check) is named apart from the register, even with its entry', () => {
  const unvalidated = (valid) => { const o = { ...CITED, valid }; if (valid === undefined) delete o.valid; return [...plain(19), overridden('o1', o)]; };
  assert.equal(overrideGap({ pages: unvalidated(false), register: REGISTER }), `pages_overridden:1: ${NOT_VALIDATED(['/o1'])}`);
  assert.equal(overrideGap({ pages: unvalidated(undefined), register: REGISTER }), `pages_overridden:1: ${NOT_VALIDATED(['/o1'])}`);
  assert.equal(overrideGap({ pages: unvalidated('true'), register: REGISTER }), `pages_overridden:1: ${NOT_VALIDATED(['/o1'])}`, 'only the boolean true');
  assert.equal(overrideGap({ pages: unvalidated(true), register: REGISTER }), null);
  assert.equal(overrideGap({ pages: [...plain(19), overridden('o1', { verdict: 'tier-shift', reason: 'banner' })], register: REGISTER }), `pages_overridden:1: ${NOT_VALIDATED(['/o1'])}; no register entry for /o1`);
  assert.deepEqual(overrideRef(overridden('o1', { verdict: 'tier-shift', note: 'R-07', valid: true })), { ref: 'R-07', invalid: false });
  assert.deepEqual(overrideRef(overridden('o1', { verdict: 'tier-shift', note: 'R-07' })), { ref: 'R-07', invalid: true });
});

check('pages_overridden: only earned overrides count against the cap — an unvalidated object override is not passing by override, it is a gap of its own', () => {
  const objects = (valid) => [...plain(17), ...['o1', 'o2', 'o3'].map((s) => overridden(s, { ...CITED, valid }))];
  assert.equal(overrideGap({ pages: objects(true), register: REGISTER }), 'pages_overridden:3: 3/20 delivered pages pass by override (cap 10 %)');
  assert.equal(overrideGap({ pages: objects(false), register: REGISTER }), `pages_overridden:3: ${NOT_VALIDATED(['/o1', '/o2', '/o3'])}`);
  const strings = [...plain(17), ...['o1', 'o2', 'o3'].map((s) => overridden(s, 'tier-shift per R-07'))];
  assert.equal(overrideGap({ pages: strings, register: REGISTER }), 'pages_overridden:3: 3/20 delivered pages pass by override (cap 10 %)', 'the string form with gate.pass true counts as before');
  const failing = strings.map((p) => (p.slug.startsWith('o') ? { ...p, delivery: { ...p.delivery, gate: { ...p.delivery.gate, pass: false } } } : p));
  assert.equal(overrideGap({ pages: failing, register: REGISTER }), null, 'a string override on a failing gate passes nothing');
});

check('pages_overridden: a bare verdict string cites the recorded gate table row\'s override.reason (by slug, then path)', () => {
  const tableRow = (slug, path, override) => ({ slug, path, pass: false, override, reasons: ['pixel 14.2 > 10'] });
  const tables = { [TABLE]: { rows: [tableRow('other', '/x', null), tableRow('o1', '/o1', CITED), tableRow('renamed', '/o2', CITED), tableRow('o3', '/o3', { ...CITED, valid: false })] } };
  const readTable = (f) => tables[f] || null;
  const pages = (slug) => [...plain(19), overridden(slug, 'tier-shift', { table: TABLE })];
  assert.equal(overrideGap({ pages: pages('o1'), register: REGISTER, readTable }), null);
  assert.equal(overrideGap({ pages: pages('o2'), register: REGISTER, readTable }), null);
  assert.equal(overrideGap({ pages: pages('o3'), register: REGISTER, readTable }), 'pages_overridden:1: no register entry for /o3');
  assert.equal(overrideGap({ pages: pages('o1'), register: REGISTER, readTable: () => null }), 'pages_overridden:1: no register entry for /o1');
  assert.equal(overrideGap({ pages: [...plain(19), overridden('o9', 'tier-shift per R-07')], register: REGISTER }), null);
});

check('pages_overridden: a row that passed on its own measurements (reasons: []) is not counted against the cap, yet needs its entry', () => {
  const own = (slug, override = CITED) => overridden(slug, override, { reasons: [] });
  const pages = [...plain(15), own('a'), own('b'), own('c'), overridden('o1', CITED), overridden('o2', CITED)];
  assert.equal(overrideGap({ pages, register: REGISTER }), null);
  const absent = { ...overridden('o3', CITED) }; delete absent.delivery.gate.reasons;
  assert.equal(overrideGap({ pages: [...plain(14), own('a'), own('b'), own('c'), overridden('o1', CITED), overridden('o2', CITED), absent], register: REGISTER }), 'pages_overridden:6: 3/20 delivered pages pass by override (cap 10 %)');
  assert.equal(overrideGap({ pages: [...plain(19), own('a', 'tier-shift')], register: REGISTER }), 'pages_overridden:1: no register entry for /a');
  const both = [...plain(17), overridden('o1', CITED), overridden('o2', 'tier-shift'), overridden('o3', CITED)];
  assert.equal(overrideGap({ pages: both, register: REGISTER }), 'pages_overridden:3: 3/20 delivered pages pass by override (cap 10 %); no register entry for /o2');
});

const PROGRESS = { units: {
  'cluster-news': { status: 'done', kind: 'cluster', templates: ['article'], pages: 2 },
  'archetype-article': { status: 'done', kind: 'archetype', templates: ['article'], pages: 1 },
  foundation: { status: 'done', kind: 'foundation', templates: [], pages: 0 },
  final: { status: 'done', kind: 'final', templates: [], pages: 0 },
  'cluster-shop': { status: 'running', kind: 'cluster', templates: ['product'], pages: 4 },
} };
const UNIT_PAGES = [proven(row('news-a', '/news/a', 'verified')), proven(row('news-b', '/news/b', 'verified')), proven(row('story', '/story', 'verified'))];
const UNIT_PATHS = { 'cluster-news': '# the news cluster\n/news/a.html\n\n/news/b/\n', 'archetype-article': '/story\n' };
const units = (over = {}) => unitGaps({ progress: PROGRESS, unitPaths: UNIT_PATHS, pages: UNIT_PAGES, widths: ['1440', '360'], pathKey, ...over });

check('unit_unproven: a done unit whose pages all pass at 1440 and 360 is proven; running, foundation and final units are not judged', () => {
  assert.deepEqual(units(), { gaps: [], skipped: [] });
});

check('unit_unproven: one page short of the 360 gate, failing, or without a coverage row → one gap for its unit', () => {
  const short = UNIT_PAGES.map((p) => (p.slug === 'news-b' ? { ...p, delivery: { ...p.delivery, gate: { ...p.delivery.gate, atByWidth: { 1440: AT[1440] } } } } : p));
  assert.deepEqual(units({ pages: short }).gaps, ['unit_unproven:cluster-news: 1/2 pages without a passing gate at 1440 and 360: /news/b/']);
  const failing = UNIT_PAGES.map((p) => (p.slug === 'story' ? { ...p, delivery: { ...p.delivery, gate: { ...p.delivery.gate, pass: false } } } : p));
  assert.deepEqual(units({ pages: failing }).gaps, ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story']);
  assert.deepEqual(units({ pages: UNIT_PAGES.slice(1) }).gaps, ['unit_unproven:cluster-news: 1/2 pages without a passing gate at 1440 and 360: /news/a.html']);
  assert.deepEqual(units({ pages: short, widths: ['1440'] }).gaps, []);
});

check('unit_unproven: a unit page excluded since (coverage excluded[] by path, no row in pages[]) leaves the unit\'s count; a unit of excluded pages only is no gap', () => {
  const excluded = [{ slug: 'news-a', path: '/news/a', status: 'excluded' }];
  assert.deepEqual(units({ pages: UNIT_PAGES.slice(1), excluded }).gaps, []);
  const short = UNIT_PAGES.slice(1).map(withGate('news-b', { atByWidth: { 1440: AT[1440] } }));
  assert.deepEqual(units({ pages: short, excluded }).gaps, ['unit_unproven:cluster-news: 1/1 pages without a passing gate at 1440 and 360: /news/b/']);
  assert.deepEqual(units({ pages: UNIT_PAGES.slice(0, 2), excluded: [{ slug: 'story', path: '/story', status: 'excluded' }] }).gaps, []);
  const story = UNIT_PAGES.map(withGate('story', { pass: false }));
  assert.deepEqual(units({ pages: story, excluded: [{ slug: 'old-story', path: '/Story', status: 'excluded' }] }).gaps,
    ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story'], 'an excluded path never hides a row still in pages[]');
});

check('unit_unproven: a unit flipped with progress.mjs unit done --unproven "<reason>" carries the reason on its gap', () => {
  const reason = 'preview host 500 during the gate window; re-gate next session';
  const progress = { units: { ...PROGRESS.units, 'cluster-news': { ...PROGRESS.units['cluster-news'], unproven: reason } } };
  const short = UNIT_PAGES.map(withGate('news-b', { atByWidth: { 1440: AT[1440] } }));
  assert.deepEqual(units({ progress, pages: short }).gaps,
    [`unit_unproven:cluster-news: 1/2 pages without a passing gate at 1440 and 360: /news/b/ — declared unproven: ${reason}`]);
  // the reason shows only beside a real gap: once every page is proven the unit is proven, reason or not
  assert.deepEqual(units({ progress }).gaps, []);
});

const LEGACY_SKIP = (n) => `unit_unproven: ${n} row(s) without per-width verdicts — proven on the last width's pass`;
const withGate = (slug, gate) => (p) => (p.slug === slug ? { ...p, delivery: { ...p.delivery, gate: { ...p.delivery.gate, ...gate } } } : p);
const legacy = (p) => { const gate = { ...p.delivery.gate }; delete gate.passByWidth; return { ...p, delivery: { ...p.delivery, gate } }; };

check('unit_unproven: a page passing at 1440 (the width gated last) but failing at 360 is not proven — every width must have passed', () => {
  const mobileFails = UNIT_PAGES.map(withGate('story', { pass: true, passByWidth: { 1440: true, 360: false } }));
  assert.deepEqual(units({ pages: mobileFails }), { gaps: ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story'], skipped: [] });
  const noMobileVerdict = UNIT_PAGES.map(withGate('story', { passByWidth: { 1440: true } }));
  assert.deepEqual(units({ pages: noMobileVerdict }).gaps, ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story']);
  assert.deepEqual(units({ pages: mobileFails, widths: ['1440'] }), { gaps: [], skipped: [] }, 'only the --widths widths are judged');
  // the last width's verdict still counts: a later failure at a width outside --widths (or without one) is no proof
  assert.deepEqual(units({ pages: UNIT_PAGES.map(withGate('story', { pass: false })) }).gaps, ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story']);
  for (const passByWidth of [[true, true], 'yes', true]) {
    assert.deepEqual(units({ pages: UNIT_PAGES.map(withGate('story', { passByWidth })) }).gaps, ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story'], JSON.stringify(passByWidth));
  }
});

check('unit_unproven: a row gated before per-width verdicts is proven on its last width\'s pass, counted in a skipped line — never silent', () => {
  const old = UNIT_PAGES.map((p) => (p.slug === 'story' ? legacy(p) : p));
  assert.deepEqual(units({ pages: old }), { gaps: [], skipped: [LEGACY_SKIP(1)] });
  assert.deepEqual(units({ pages: UNIT_PAGES.map(legacy) }), { gaps: [], skipped: [LEGACY_SKIP(3)] });
  // one row behind the paths of two done units counts once
  const twice = { ...UNIT_PATHS, 'archetype-article': '/story\n/news/a\n' };
  assert.deepEqual(units({ pages: UNIT_PAGES.map(legacy), unitPaths: twice }).skipped, [LEGACY_SKIP(3)]);
  // the fallback proves nothing more than before: a failing or short legacy row is a gap, not a skipped proof
  const oldFailing = old.map(withGate('story', { pass: false }));
  assert.deepEqual(units({ pages: oldFailing }), { gaps: ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story'], skipped: [] });
  const oldShort = old.map(withGate('story', { atByWidth: { 1440: AT[1440] } }));
  assert.deepEqual(units({ pages: oldShort }).gaps, ['unit_unproven:archetype-article: 1/1 pages without a passing gate at 1440 and 360: /story']);
  assert.deepEqual(units({ pages: old.map(withGate('story', { passByWidth: null })) }), { gaps: [], skipped: [LEGACY_SKIP(1)] }, 'a null map is no map');
});

check('unit_unproven: a done unit without its .paths (or with no page in it) is a gap; gaps come by unit name', () => {
  assert.deepEqual(units({ unitPaths: {} }).gaps, ['unit_unproven:archetype-article: no stardust/rollout/units/archetype-article.paths', 'unit_unproven:cluster-news: no stardust/rollout/units/cluster-news.paths']);
  assert.deepEqual(units({ unitPaths: { ...UNIT_PATHS, 'archetype-article': '# nothing yet\n\n' } }).gaps, ['unit_unproven:archetype-article: no pages in stardust/rollout/units/archetype-article.paths']);
});

check('unit_unproven: without progress.json no unit is judged and the check is listed as skipped', () => {
  assert.deepEqual(units({ progress: null, out: 'x/rollout' }), { gaps: [], skipped: ['unit_unproven: no x/rollout/progress.json'] });
});

check('unit_unproven: a progress.json without a units map is listed as skipped, never passed silently', () => {
  const noMap = { gaps: [], skipped: ['unit_unproven: x/rollout/progress.json has no units map'] };
  for (const progress of [{ status: 'done', kind: 'archetype', templates: ['article'], pages: 2 }, { units: null }, { units: 'x' }, { units: [PROGRESS.units['cluster-news']] }, [PROGRESS], 'done']) {
    assert.deepEqual(units({ progress, out: 'x/rollout' }), noMap, JSON.stringify(progress));
  }
  assert.deepEqual(units({ progress: { units: {} } }), { gaps: [], skipped: [] });
});

// news is a folder index whose document went to /news/index — deployed at /news/, the source's own path
const NEWS = proven(row('news', '/news', 'deployed'));
const SIDE_PAGES = [proven(row('home', '/', 'verified')), proven(row('about', '/about', 'verified')), { ...NEWS, delivery: { ...NEWS.delivery, deployedUrl: 'https://main--site--org.aem.live/news/' }, source: { sourceUrl: 'https://example.com/news/', migratedHtml: 'stardust/migrated/news/index.html' } }, row('draft', '/draft', 'pending')];
const withSource = (r, sourceUrl) => ({ ...r, source: { ...r.source, sourceUrl } });
const sidecars = (pages, over = {}) => sidecarGap({ pages, widths: ['1440', '360'], schemaExists: () => true, redirects: '', ...over });

check('sidecars_missing: every delivered row has its schema, both gate widths and an unchanged path — no gap', () => {
  assert.deepEqual(sidecars(SIDE_PAGES), { gap: null, skipped: [] });
});

check('sidecars_missing: a missing schema and a missing gate width are counted per kind', () => {
  assert.deepEqual(sidecars(SIDE_PAGES, { schemaExists: (s) => s !== 'about' }), { gap: 'sidecars_missing:1: schema 1, gate widths 0, redirects 0: /about', skipped: [] });
  const short = SIDE_PAGES.map((p) => (p.slug === 'home' ? { ...p, delivery: { ...p.delivery, gate: { ...p.delivery.gate, atByWidth: { 1440: AT[1440] } } } } : p));
  assert.equal(sidecars(short).gap, 'sidecars_missing:1: schema 0, gate widths 1, redirects 0: /');
  assert.equal(sidecars(short, { schemaExists: (s) => s !== 'home' }).gap, 'sidecars_missing:1: schema 1, gate widths 1, redirects 0: /');
});

check('sidecars_missing: a changed path needs a redirects line for its source path (tab or 2+ spaces, decodeURI forms)', () => {
  const moved = [...SIDE_PAGES, withSource(proven(row('about-us', '/about-us', 'verified')), 'https://example.com/About_Us.html?ref=nav')];
  assert.equal(sidecars(moved).gap, 'sidecars_missing:1: schema 0, gate widths 0, redirects 1: /about-us');
  assert.equal(sidecars(moved, { redirects: '/About_Us\t/about-us\n' }).gap, 'sidecars_missing:1: schema 0, gate widths 0, redirects 1: /about-us');
  assert.equal(sidecars(moved, { redirects: '# source\tdestination\n/About_Us.html\t/about-us\n' }).gap, null);
  assert.equal(sidecars(moved, { redirects: '/About_Us.html   /about-us\n' }).gap, null);
  const accented = [withSource(proven(row('cafe', '/cafe', 'verified')), 'https://example.com/caf%C3%A9')];
  assert.equal(sidecars(accented, { redirects: '/café\t/cafe\n' }).gap, null);
  assert.equal(sidecars(accented).gap, 'sidecars_missing:1: schema 0, gate widths 0, redirects 1: /cafe');
  // a folder-index source (/news/) whose document went to /news is served without the slash: that is a changed path
  const flat = SIDE_PAGES.map((p) => (p.slug === 'news' ? { ...p, delivery: { ...p.delivery, deployedUrl: 'https://main--site--org.aem.live/news' } } : p));
  assert.equal(sidecars(flat).gap, 'sidecars_missing:1: schema 0, gate widths 0, redirects 1: /news');
  assert.equal(sidecars(flat, { redirects: '/news/\t/news\n' }).gap, null);
});

check('sidecars_missing: delivered rows without source.sourceUrl are not judged for redirects — counted as skipped', () => {
  const bare = [...SIDE_PAGES, { ...row('x', '/x', 'verified'), delivery: SIDE_PAGES[0].delivery }, { ...row('y', '/y', 'pending') }];
  assert.deepEqual(sidecars(bare), { gap: null, skipped: ['sidecars_missing redirects: 1 delivered rows without source.sourceUrl'] });
});

check('sidecars_missing: gate widths are judged only in a flow with a gate table (replica, or any gated row); otherwise skipped, never a gap', () => {
  const ungated = SIDE_PAGES.map((p) => ({ ...p, delivery: { status: p.delivery.status, deployedUrl: p.delivery.deployedUrl } }));
  assert.equal(widthsJudged({ flow: 'redesign', pages: ungated }), false);
  assert.equal(widthsJudged({ flow: null, pages: ungated }), false);
  assert.equal(widthsJudged({ flow: 'replica', pages: ungated }), true);
  assert.equal(widthsJudged({ flow: 'redesign', pages: [...ungated, proven(row('g', '/g', 'pending'))] }), true);
  assert.deepEqual(sidecars(ungated, { judgeWidths: false }), { gap: null, skipped: [WIDTHS_SKIP] });
  assert.deepEqual(sidecars(ungated, { judgeWidths: false, schemaExists: (s) => s !== 'about' }), { gap: 'sidecars_missing:1: schema 1, gate widths -, redirects 0: /about', skipped: [WIDTHS_SKIP] });
  assert.equal(sidecars(ungated).gap, 'sidecars_missing:3: schema 0, gate widths 3, redirects 0: /, /about, /news');
  assert.deepEqual(sidecars([row('draft', '/draft', 'pending')], { judgeWidths: false }), { gap: null, skipped: [] }, 'nothing delivered, nothing skipped');
});

const LEDGER_END = { ts: '2026-10-09T11:00:00Z', skill: 'stardust:replica', phase: 'recreate', event: 'end' };
check('ledger_unpaired: an end without an open start is a gap until a later start and end re-record the phase', () => {
  const lines = [...ENDED, LEDGER_END];
  assert.equal(ledgerGap(unpairedEnds(lines)), 'ledger_unpaired:1: stardust:replica recreate 2026-10-09T11:00:00Z');
  const reRecorded = [...lines, { ...LEDGER_END, ts: '2026-10-09T12:00:00Z', event: 'start' }, { ...LEDGER_END, ts: '2026-10-09T12:30:00Z' }];
  assert.equal(ledgerGap(unpairedEnds(reRecorded)), null);
  assert.equal(ledgerGap(unpairedEnds(ENDED)), null);
  assert.equal(ledgerGap(null), 'ledger_unpaired:unchecked (ledger.mjs not found beside the rollout scripts)');
});

check('the new gaps take their places in the fixed order', () => {
  const v = doneGaps({ pages: [row('u', '/u', 'pending'), row('f', '/f', 'failed'), inconclusive(row('i', '/i', 'verified'))], findings: [finding('P1', 'open')], ledgerLines: [], notLive: ['/x'],
    header: 'header_parity:no contract', headerErrors: 'header_parity_errors:2', overridden: 'pages_overridden:1: x', sidecars: 'sidecars_missing:1: x', units: ['unit_unproven:a: x', 'unit_unproven:b: x'], ledger: 'ledger_unpaired:1: x', skipped: ['s1'] });
  assert.deepEqual(v.gaps.map((g) => g.split(':').slice(0, g.startsWith('unit_') ? 2 : 1).join(':')),
    ['pages_unfinished', 'pages_failed', 'gates_inconclusive', 'pages_overridden', 'pages_not_live', 'sidecars_missing', 'unit_unproven:a', 'unit_unproven:b', 'open_p1', 'header_parity', 'header_parity_errors', 'ledger_unpaired', 'rollout_incomplete']);
  assert.deepEqual(v.skipped, ['s1']);
  assert.deepEqual(doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: null, skipped: ['s1'] }).skipped, [OFFLINE_SKIP, 's1']);
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
// every page gets its stardust/eds-schema/<slug>.json unless named in `noSchema`; `files` = { <relative path>: text or JSON }
function project({ pages = CLEAN_PAGES, ledger = ENDED, liveHost, noSchema = [], files = {} } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'done-check-'));
  const put = (f, body) => { mkdirSync(dirname(join(proj, f)), { recursive: true }); writeFileSync(join(proj, f), typeof body === 'string' ? body : JSON.stringify(body)); };
  const out = join(proj, 'stardust', 'rollout');
  mkdirSync(join(out, 'coverage'), { recursive: true });
  if (pages) writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages }));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify(liveHost ? { site: { liveHost } } : {}));
  writeFileSync(join(proj, 'stardust', 'status.jsonl'), ledger.map((l) => JSON.stringify(l)).join('\n'));
  for (const pg of pages || []) if (pg.slug && !noSchema.includes(pg.slug)) put(`stardust/eds-schema/${pg.slug}.json`, { slug: pg.slug, sections: [] });
  for (const [f, body] of Object.entries(files)) put(f, body);
  return proj;
}
const run = (proj, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' });

check('CLI: --help prints the usage header and writes nothing', () => {
  const proj = project();
  const before = readdirSync(join(proj, 'stardust')).join();
  const r = run(proj, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pages_not_live/);
  assert.match(r.stdout, /^rollout\/done-check\.mjs/, 'its own header, never the lazily imported workspace-manifest.mjs\'s');
  assert.equal(readdirSync(join(proj, 'stardust')).join(), before);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a clean offline run exits 0 and the JSON says the probe was skipped', () => {
  const proj = project();
  const r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { complete: true, gaps: [], liveChecked: false, skipped: [OFFLINE_SKIP, 'unit_unproven: no stardust/rollout/progress.json'], info: [] });
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: gaps exit 1, one line each, then the summary line', () => {
  const proj = project({ pages: [row('a', '/a', 'pending')], ledger: [] });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split('\n'), ['pages_unfinished:1', 'rollout_incomplete', `skipped: ${OFFLINE_SKIP}`, 'skipped: unit_unproven: no stardust/rollout/progress.json', '✗ 2 gap(s) (live probe skipped: --offline)']);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: pages.json excluded[] rows print as an info line after the skipped ones and keep a clean run complete (exit 0)', () => {
  const proj = project({ files: { 'stardust/rollout/coverage/pages.json': { pages: CLEAN_PAGES, excluded: [{ slug: 'news', path: '/news', sourceUrl: 'https://example.com/news', status: 'excluded', reason: 'the source answers 404', at: AT[1440] }] } } });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.stdout.trim().split('\n').slice(-2), ['info: pages_excluded:1: /news', '✓ complete (live probe skipped: --offline)']);
  assert.deepEqual(JSON.parse(run(proj, ['--offline', '--json']).stdout).info, ['pages_excluded:1: /news']);
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
});

check('inferredLiveHost: the most common delivered deployedUrl host; a non-URL or no deployed row → null', () => {
  const dep = (slug, url) => ({ slug, delivery: { status: 'verified', deployedUrl: url } });
  assert.equal(inferredLiveHost([dep('a', 'https://main--site--org.aem.live/a'), dep('b', 'https://main--site--org.aem.live/b'), dep('c', 'https://other.example/c')]), 'main--site--org.aem.live');
  assert.equal(inferredLiveHost([row('p', '/p', 'pending')]), null, 'pending rows are not delivered');
  assert.equal(inferredLiveHost([{ slug: 'x', delivery: { status: 'verified', deployedUrl: '/x' } }]), null, 'a path, not a host');
  assert.equal(inferredLiveHost([]), null);
  // delivery.gate.host (the host the published gates ran on) is the live host, not the preview deployedUrl.
  const gp = (slug, dep, gateHost) => ({ slug, delivery: { status: 'verified', deployedUrl: `https://${dep}/${slug}`, gate: { pass: true, host: `https://${gateHost}` } } });
  assert.equal(inferredLiveHost([gp('a', 'main--site--org.aem.page', 'main--site--org.aem.live'), gp('b', 'main--site--org.aem.page', 'main--site--org.aem.live')]), 'main--site--org.aem.live');
  assert.equal(inferredLiveHost([{ slug: 'a', delivery: { status: 'verified', deployedUrl: 'https://main--site--org.aem.page/a' } }], { previewHost: 'main--site--org.aem.page' }), null, 'the preview host is not inferred as the live host');
});

check('CLI: --offline infers the live host from the coverage — header parity measured on the preview host while the gates ran on the live host is a gap (the rule applies by default, no --live-host)', () => {
  const live = 'main--site--org.aem.live';
  const pages = [
    { ...proven(row('home', '/', 'verified')), delivery: { ...proven(row('home', '/', 'verified')).delivery, deployedUrl: `https://${live}/` } },
    { ...proven(row('about', '/about', 'verified')), delivery: { ...proven(row('about', '/about', 'verified')).delivery, deployedUrl: `https://${live}/about` } },
  ];
  const contract = { url: 'https://example.com/', at: '2026-10-09T10:00:00Z', widths: { 1440: {}, 360: {} } };
  const parity = { source: 'https://example.com/', build: 'https://main--site--org.aem.page/', at: '2026-10-09T12:00:00Z', profile: 'replica', widths: [1440, 360], findings: [] };
  const proj = project({ pages, files: {
    'stardust/state.json': { flow: 'replica' },
    'stardust/chrome/header-contract.json': contract,
    'stardust/chrome/header-parity.json': parity,
  } });
  const r = run(proj, ['--offline', '--json']);
  const header = JSON.parse(r.stdout).gaps.filter((g) => g.startsWith('header_parity'));
  assert.deepEqual(header, [`header_parity:measured on main--site--org.aem.page, not the live host the gates ran on (${live})`], r.stdout);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: --offline infers the live host from the gates (delivery.gate.host), not the preview deployedUrl — header parity on the preview host is a gap even when the pages were deployed to preview (the run-16 case)', () => {
  const live = 'main--site--org.aem.live', prev = 'main--site--org.aem.page';
  const mk = (slug, path) => { const p = proven(row(slug, path, 'verified'), { host: `https://${live}` }); return { ...p, delivery: { ...p.delivery, deployedUrl: `https://${prev}${path}` } }; };
  const pages = [mk('home', '/'), mk('about', '/about')];
  const contract = { url: 'https://example.com/', at: '2026-10-09T10:00:00Z', widths: { 1440: {}, 360: {} } };
  const parity = { source: 'https://example.com/', build: `https://${prev}/`, at: '2026-10-09T12:00:00Z', profile: 'replica', widths: [1440, 360], findings: [] };
  const proj = project({ pages, files: {
    'stardust/state.json': { flow: 'replica' },
    'stardust/chrome/header-contract.json': contract,
    'stardust/chrome/header-parity.json': parity,
  } });
  const r = run(proj, ['--offline', '--json']);
  const header = JSON.parse(r.stdout).gaps.filter((x) => x.startsWith('header_parity'));
  assert.deepEqual(header, [`header_parity:measured on ${prev}, not the live host the gates ran on (${live})`], r.stdout);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a replica project without a header contract is not complete', () => {
  const proj = project();
  writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ flow: 'replica' }));
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1); assert.match(r.stdout, /^header_parity:no contract/m);
  rmSync(proj, { recursive: true, force: true });
});

const herr = (key, decided) => ({ key, severity: 'error', ...(decided ? { decided: { decision: 'accepted', by: 'Site owner', at: '2026-10-09T12:00:00Z', reason: 'r' } } : {}) });
check('headerParityErrors: the undecided error findings of header-parity.json; without findings[], counts.error alone (chrome-compare already leaves the decided out of it)', () => {
  assert.equal(headerParityErrors({ findings: ['a', 'b', 'c', 'd'].map((k) => herr(k)) }), 'header_parity_errors:4');
  assert.equal(headerParityErrors({ findings: [herr('a', true), herr('b', true), herr('c'), { key: 'w', severity: 'warn' }] }), 'header_parity_errors:1');
  // chrome-compare writes counts.error without the decided findings: the findings decide whenever they are there
  assert.equal(headerParityErrors({ counts: { error: 3, warn: 0, decided: 2 }, findings: [herr('a'), herr('b'), herr('c'), herr('d', true), herr('e', true)] }), 'header_parity_errors:3');
  assert.equal(headerParityErrors({ counts: { error: 5, warn: 1, decided: 2 } }), 'header_parity_errors:5', 'the same reading as with findings[]: decided ones are not in counts.error');
  assert.equal(headerParityErrors({ counts: { error: 1, decided: 3 } }), 'header_parity_errors:1');
  assert.equal(headerParityErrors({ counts: { error: 0, decided: 3 } }), null);
  assert.equal(headerParityErrors({ counts: { error: 2, decided: 0 }, findings: [] }), null);
  for (const parity of [null, undefined, 'x', [], {}, { counts: null }, { counts: { error: 'many' } }]) assert.equal(headerParityErrors(parity), null, JSON.stringify(parity));
});

check('header decisions the agent took (decided.agent, else counts.decidedByAgent) are an info line for the owner\'s review, never a gap; none → no line', () => {
  const { headerDecidedByAgent } = doneCheck;
  const agent = (key) => ({ key, severity: 'error', decided: { decision: 'accept', by: 'agent', agent: true, reason: 'r'.repeat(40), at: '2026-10-09T12:00:00Z' } });
  assert.equal(headerDecidedByAgent({ findings: [agent('motion@390 Menu [click]'), herr('focus@1440 Search', true), agent('state-missing@1440 Shop [hover]'), herr('x')] }),
    'header_decided_by_agent:2: motion@390 Menu [click], state-missing@1440 Shop [hover] — for the owner\'s review');
  assert.equal(headerDecidedByAgent({ counts: { error: 0, decided: 3, decidedByAgent: 2 } }), 'header_decided_by_agent:2 — for the owner\'s review');
  for (const parity of [null, {}, { findings: [herr('a', true)] }, { counts: { decidedByAgent: 0 } }]) assert.equal(headerDecidedByAgent(parity), null, JSON.stringify(parity));
  const v = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [], headerAgent: 'header_decided_by_agent:1 — for the owner\'s review' });
  assert.deepEqual([v.complete, v.info], [true, ['header_decided_by_agent:1 — for the owner\'s review']]);
  const proj = project({ files: { 'stardust/chrome/header-parity.json': { counts: { error: 0, decided: 1, decidedByAgent: 1 }, findings: [agent('motion@390 Menu [click]')] } } });
  const r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).info, ['header_decided_by_agent:1: motion@390 Menu [click] — for the owner\'s review']);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: header_parity_errors fires whenever chrome/header-parity.json has undecided errors — any project, right after header_parity; absent or unreadable → no gap', () => {
  const parity = { tool: 'chrome-compare', source: 'https://example.com/', build: 'https://main--site--org.aem.live/', at: '2026-10-09T12:00:00Z', profile: 'replica', widths: [1440, 390],
    counts: { error: 2, warn: 0, decided: 1 }, findings: [herr('state-missing@1440 Shop [hover]'), herr('motion@390 Open menu [click]'), herr('focus@1440 Search', true)] };
  const gaps = (files) => { const proj = project({ files }); const r = run(proj, ['--offline', '--json']); rmSync(proj, { recursive: true, force: true }); return { status: r.status, gaps: JSON.parse(r.stdout).gaps }; };
  assert.deepEqual(gaps({ 'stardust/chrome/header-parity.json': parity }), { status: 1, gaps: ['header_parity_errors:2'] });
  assert.deepEqual(gaps({ 'stardust/chrome/header-parity.json': '{"counts": ' }), { status: 0, gaps: [] });
  const contract = { url: 'https://example.com/', at: '2026-10-09T10:00:00Z', widths: { 1440: {}, 390: {} } };
  assert.deepEqual(gaps({ 'stardust/state.json': { flow: 'replica' }, 'stardust/chrome/header-contract.json': contract, 'stardust/chrome/header-parity.json': parity }).gaps,
    ['header_parity:2: state-missing@1440 Shop [hover], motion@390 Open menu [click]'], 'one finding set, one gap: header_parity already lists the undecided errors');
  assert.deepEqual(gaps({ 'stardust/state.json': { flow: 'replica' }, 'stardust/chrome/header-contract.json': { ...contract, at: '2026-10-10T00:00:00Z' }, 'stardust/chrome/header-parity.json': parity }).gaps,
    ['header_parity:stale: the contract is newer than the comparison', 'header_parity_errors:2'], 'another cause: both lines');
});

check('header gaps counted once: header_parity_errors is dropped when header_parity lists the same undecided errors, kept for another header_parity cause or none', () => {
  const base = { pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: [] };
  assert.deepEqual(doneGaps({ ...base, header: 'header_parity:2: a, b', headerErrors: 'header_parity_errors:2' }).gaps, ['header_parity:2: a, b']);
  assert.deepEqual(doneGaps({ ...base, header: 'header_parity:unchecked: x', headerErrors: 'header_parity_errors:2' }).gaps, ['header_parity:unchecked: x', 'header_parity_errors:2']);
  assert.deepEqual(doneGaps({ ...base, headerErrors: 'header_parity_errors:2' }).gaps, ['header_parity_errors:2']);
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

// a project where each new gap fires once: a bare-verdict override whose recorded table reason cites no entry,
// a page without its schema, a page gated at 1440 only, a moved page without a redirects line, a row without its
// source URL, a done unit with a short page, a done unit without .paths, a running unit, an unpaired end
const short360 = (r) => ({ ...r, delivery: { ...r.delivery, gate: { ...r.delivery.gate, atByWidth: { 1440: AT[1440] } } } });
const PROOF_PAGES = [...CLEAN_PAGES, overridden('o1', 'tier-shift', { table: TABLE }), proven(row('news-a', '/news/a', 'verified')), short360(proven(row('news-b', '/news/b', 'verified'))),
  withSource(proven(row('about-us', '/about-us', 'verified')), 'https://example.com/About_Us.html'), { ...proven(row('bare', '/bare', 'verified')), source: {} }];
const PROOF_FILES = {
  'stardust/replica/inconsistency-register.md': REGISTER,
  [TABLE]: { rows: [{ slug: 'o1', path: '/o1', pass: false, override: { verdict: 'tier-shift', reason: 'banner offsets the hero' }, reasons: ['pixel 14.2 > 10'] }] },
  'stardust/rollout/progress.json': { units: { 'cluster-news': { status: 'done', kind: 'cluster' }, 'archetype-x': { status: 'done', kind: 'archetype' }, 'cluster-y': { status: 'running', kind: 'cluster' }, foundation: { status: 'done', kind: 'foundation' } } },
  'stardust/rollout/units/cluster-news.paths': '/news/a\n/news/b\n',
};
const PROOF_GAPS = [
  'pages_overridden:1: 1/7 delivered pages pass by override (cap 10 %); no register entry for /o1',
  'sidecars_missing:3: schema 1, gate widths 1, redirects 1: /news/a, /news/b, /about-us',
  'unit_unproven:archetype-x: no stardust/rollout/units/archetype-x.paths',
  'unit_unproven:cluster-news: 1/2 pages without a passing gate at 1440 and 360: /news/b',
  'ledger_unpaired:1: stardust:replica recreate 2026-10-09T11:00:00Z',
];
const proofProject = () => project({ pages: PROOF_PAGES, ledger: [...ENDED, LEDGER_END], noSchema: ['news-a'], files: PROOF_FILES });

check('CLI: --json lists every new gap in order and every check that did not run as skipped', () => {
  const proj = proofProject();
  const r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { complete: false, gaps: PROOF_GAPS, liveChecked: false, skipped: [OFFLINE_SKIP, 'sidecars_missing redirects: 1 delivered rows without source.sourceUrl'], info: [] });
  const text = run(proj, ['--offline']).stdout.trim().split('\n');
  assert.deepEqual(text.slice(-3), [`skipped: ${OFFLINE_SKIP}`, 'skipped: sidecars_missing redirects: 1 delivered rows without source.sourceUrl', '✗ 5 gap(s) (live probe skipped: --offline)']);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a done unit\'s page gated before per-width verdicts prints its skipped line; one failing at 360 after passing at 1440 is unit_unproven', () => {
  const unitGap = (v) => v.gaps.filter((g) => g.startsWith('unit_unproven:cluster-news'));
  const withNewsA = (f) => project({ pages: PROOF_PAGES.map((p) => (p.slug === 'news-a' ? f(p) : p)), ledger: [...ENDED, LEDGER_END], noSchema: ['news-a'], files: PROOF_FILES });
  const old = withNewsA(legacy);
  const r = run(old, ['--offline']);
  assert.ok(r.stdout.split('\n').includes(`skipped: ${LEGACY_SKIP(1)}`), r.stdout);
  assert.deepEqual(unitGap(JSON.parse(run(old, ['--offline', '--json']).stdout)), ['unit_unproven:cluster-news: 1/2 pages without a passing gate at 1440 and 360: /news/b']);
  const mobile = withNewsA(withGate('news-a', { pass: true, passByWidth: { 1440: true, 360: false } }));
  const v = JSON.parse(run(mobile, ['--offline', '--json']).stdout);
  assert.deepEqual(unitGap(v), ['unit_unproven:cluster-news: 2/2 pages without a passing gate at 1440 and 360: /news/a, /news/b']);
  assert.ok(!v.skipped.some((s) => s.includes('per-width')), JSON.stringify(v.skipped));
  [old, mobile].forEach((p) => rmSync(p, { recursive: true, force: true }));
});

check('CLI: --widths, --register, --schemas and --redirects point the checks elsewhere; a bad --widths is a usage error', () => {
  const proj = proofProject();
  const gaps = (...args) => JSON.parse(run(proj, ['--offline', '--json', ...args]).stdout).gaps;
  assert.deepEqual(gaps('--widths', '1440').filter((g) => /^(sidecars|unit)_/.test(g)), ['sidecars_missing:2: schema 1, gate widths 0, redirects 1: /news/a, /about-us', 'unit_unproven:archetype-x: no stardust/rollout/units/archetype-x.paths']);
  const put = (f, body) => { mkdirSync(dirname(join(proj, f)), { recursive: true }); writeFileSync(join(proj, f), typeof body === 'string' ? body : JSON.stringify(body)); };
  put(TABLE, { rows: [{ ...PROOF_FILES[TABLE].rows[0], override: { verdict: 'tier-shift', reason: 'R-01 banner offsets the hero' } }] });
  put('elsewhere/register.md', '## R-01 — the banner offsets the hero\n');
  put('elsewhere/schemas/news-a.json', '{}');
  put('elsewhere/redirects.tsv', '/About_Us.html\t/about-us\n');
  assert.equal(gaps()[0], 'pages_overridden:1: 1/7 delivered pages pass by override (cap 10 %); no register entry for /o1');
  assert.deepEqual(gaps('--register', 'elsewhere/register.md', '--schemas', 'elsewhere/schemas', '--redirects', 'elsewhere/redirects.tsv').slice(0, 2),
    ['pages_overridden:1: 1/7 delivered pages pass by override (cap 10 %)', 'sidecars_missing:6: schema 6, gate widths 1, redirects 0: /, /about, /o1, /news/b, /about-us, /bare']);
  const bad = run(proj, ['--offline', '--widths', '1440,wide']);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /--widths/);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: an unreadable progress.json, or one without a units map, is named as skipped; a done unit whose name is not a unit name has no .paths to read', () => {
  const broken = project({ files: { 'stardust/rollout/progress.json': '{"units": ' } });
  assert.deepEqual(JSON.parse(run(broken, ['--offline', '--json']).stdout).skipped, [OFFLINE_SKIP, 'unit_unproven: stardust/rollout/progress.json is not JSON']);
  for (const body of [{ status: 'done', kind: 'archetype' }, 'null']) {
    const bare = project({ files: { 'stardust/rollout/progress.json': body } });
    assert.deepEqual(JSON.parse(run(bare, ['--offline', '--json']).stdout).skipped, [OFFLINE_SKIP, 'unit_unproven: stardust/rollout/progress.json has no units map'], JSON.stringify(body));
    rmSync(bare, { recursive: true, force: true });
  }
  const odd = project({ files: { 'stardust/rollout/progress.json': { units: { '../x': { status: 'done', kind: 'cluster' } } }, 'stardust/rollout/x.paths': '/\n' } });
  assert.deepEqual(JSON.parse(run(odd, ['--offline', '--json']).stdout).gaps, ['unit_unproven:../x: no stardust/rollout/units/../x.paths']);
  [broken, odd].forEach((p) => rmSync(p, { recursive: true, force: true }));
});

check('CLI: ledger.mjs resolves in the project copy (stardust/scripts/stardust/); without it the ledger is an unchecked gap', () => {
  const proj = project();
  const copy = (from, to) => { mkdirSync(dirname(join(proj, to)), { recursive: true }); copyFileSync(from, join(proj, to)); };
  copy(SCRIPT, 'stardust/scripts/rollout/done-check.mjs');
  copy(join(HERE, '..', 'lib.mjs'), 'stardust/scripts/rollout/lib.mjs');
  copy(join(HERE, '..', '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), 'stardust/scripts/deploy/eds-path.mjs');
  const runCopy = () => spawnSync(process.execPath, [join(proj, 'stardust', 'scripts', 'rollout', 'done-check.mjs'), '--offline', '--json'], { cwd: proj, encoding: 'utf8' });
  const without = runCopy();
  assert.equal(without.status, 1, without.stderr);
  assert.deepEqual(JSON.parse(without.stdout).gaps, ['ledger_unpaired:unchecked (ledger.mjs not found beside the rollout scripts)']);
  copy(join(HERE, '..', '..', '..', 'stardust', 'scripts', 'ledger.mjs'), 'stardust/scripts/stardust/ledger.mjs');
  const withLedger = runCopy();
  assert.equal(withLedger.status, 0, withLedger.stdout + withLedger.stderr);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a changed path whose line sits only in redirects-cdn.tsv beside the sheet is not a gap', () => {
  const pages = [...CLEAN_PAGES, withSource(proven(row('glossary-a-b', '/glossary-a-b', 'verified')), 'https://example.com/Glossary:A%20B')];
  const sidecarGaps = (proj) => JSON.parse(run(proj, ['--offline', '--json']).stdout).gaps.filter((g) => g.startsWith('sidecars_missing'));
  const without = project({ pages });
  assert.deepEqual(sidecarGaps(without), ['sidecars_missing:1: schema 0, gate widths 0, redirects 1: /glossary-a-b']);
  const withCdn = project({ pages, files: { 'stardust/redirects-cdn.tsv': '# sources the sheet never matches\n/Glossary:A%20B\t/glossary-a-b\n' } });
  assert.deepEqual(sidecarGaps(withCdn), []);
  [without, withCdn].forEach((p) => rmSync(p, { recursive: true, force: true }));
});

check('CLI: a redesign flow with no gate on any row skips the sidecar gate widths; a replica flow without gate rows still has the gap', () => {
  const ungated = CLEAN_PAGES.map((p) => ({ ...p, delivery: { status: p.delivery.status } }));
  const verdict = (flow) => {
    const proj = project({ pages: ungated, files: { 'stardust/state.json': { flow } } });
    const v = JSON.parse(run(proj, ['--offline', '--json']).stdout);
    rmSync(proj, { recursive: true, force: true });
    return { sidecars: v.gaps.filter((g) => g.startsWith('sidecars_missing')), skipped: v.skipped };
  };
  const redesign = verdict('redesign');
  assert.deepEqual(redesign.sidecars, []);
  assert.ok(redesign.skipped.includes(WIDTHS_SKIP), JSON.stringify(redesign.skipped));
  const replica = verdict('replica');
  assert.deepEqual(replica.sidecars, ['sidecars_missing:2: schema 0, gate widths 2, redirects 0: /, /about']);
  assert.ok(!replica.skipped.includes(WIDTHS_SKIP));
});

// --- export_stale -------------------------------------------------------------------------------
const WS = 'stardust/rollout/workspace';
const REMEDY = 're-run inventory.mjs + blocks.mjs, then block-origin.mjs --verify, then workspace-manifest.mjs';
const REHASH = 'workspace-manifest.mjs --rehash-only';
// The export_stale line carries the drift classification + its command, and the adopter sentence when pages.json drifted.
const gap = (why, cls, adopter = false) => `export_stale:${why} — ${cls === 'rehash-safe' ? `rehash-safe: ${REHASH}` : `rebuild: ${REMEDY}`}${adopter ? '; the adopter refuses this export until coverage/pages.json is refreshed' : ''}`;
const H = (c) => `sha256:${c.repeat(64)}`;
const TREE = {
  inputs: { 'blocks/hero/hero.css': H('a'), 'blocks/hero/hero.js': H('b'), content: { files: 3, sha256: H('c') } },
  outputs: { 'stardust/rollout/coverage/blocks.json': H('d'), 'stardust/rollout/coverage/pages.json': H('e'), 'stardust/rollout/coverage/templates.json': H('f'), [`${WS}/mapping.json`]: H('1') },
};
const MANIFEST = { inputs: { ...TREE.inputs, content: { ...TREE.inputs.content, tracked: true } }, outputs: { ...TREE.outputs }, handover: null };
const FRESH = { listed: true, manifest: MANIFEST, tree: TREE, mapping: { generatedAt: 'T1' }, pagesGeneratedAt: 'T1', captures: true };
const withoutMapping = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.endsWith('/mapping.json')));

check('export_stale: judged only when rollout.json exports lists migration-workspace; a fresh export (same hashes, mapping present with pages.json\'s generatedAt) is no gap', () => {
  const { exportGap } = doneCheck;
  assert.deepEqual(exportGap({ ...FRESH, listed: false, manifest: null }), { gap: null, skipped: [] });
  assert.deepEqual(exportGap(FRESH), { gap: null, skipped: [] });
  const noMap = { ...TREE, outputs: withoutMapping(TREE.outputs) };
  assert.deepEqual(exportGap({ ...FRESH, captures: false, mapping: null, tree: noMap, manifest: { ...MANIFEST, outputs: noMap.outputs } }), { gap: null, skipped: [] }, 'no captures: no mapping needed');
});

check('export_stale: names each cause — no manifest, hashes that differ from the tree (content, block code, coverage, mapping), mapping.json missing while captures exist, unreadable, or with another generatedAt — each with its classification + command, and the adopter sentence when pages.json drifted', () => {
  const { exportGap } = doneCheck;
  assert.equal(exportGap({ ...FRESH, manifest: null }).gap, gap(`no ${WS}/manifest.json`, 'rebuild'));
  // content + a block's JS feed selectors/templates → rebuild; pages.json drifted too → the adopter line
  const tree = { inputs: { ...TREE.inputs, 'blocks/hero/hero.css': H('9'), 'blocks/new/new.js': H('8'), content: { files: 4, sha256: H('7') } }, outputs: { ...TREE.outputs, 'stardust/rollout/coverage/pages.json': H('6') } };
  assert.equal(exportGap({ ...FRESH, tree }).gap, gap('manifest hashes differ from the tree: blocks/hero/hero.css, blocks/new/new.js, content, stardust/rollout/coverage/pages.json', 'rebuild', true));
  const tracked = { ...TREE, inputs: { ...TREE.inputs, content: { ...TREE.inputs.content, tracked: false } } };
  assert.equal(exportGap({ ...FRESH, tree: tracked }).gap, null, 'git tracking is not a hash');
  // only a block's CSS drifted → rehash-safe; no coverage drift → no adopter line
  const cssOnly = { ...TREE, inputs: { ...TREE.inputs, 'blocks/hero/hero.css': H('9') } };
  assert.equal(exportGap({ ...FRESH, tree: cssOnly }).gap, gap('manifest hashes differ from the tree: blocks/hero/hero.css', 'rehash-safe'));
  // only a regenerated coverage file drifted → rehash-safe, and pages.json among them → the adopter line
  const covOnly = { ...TREE, outputs: { ...TREE.outputs, 'stardust/rollout/coverage/pages.json': H('6'), 'stardust/rollout/coverage/templates.json': H('5') } };
  assert.equal(exportGap({ ...FRESH, tree: covOnly }).gap, gap('manifest hashes differ from the tree: stardust/rollout/coverage/pages.json, stardust/rollout/coverage/templates.json', 'rehash-safe', true));
  const noMap = { ...TREE, outputs: withoutMapping(TREE.outputs) };
  assert.equal(exportGap({ ...FRESH, mapping: null, tree: noMap, manifest: { ...MANIFEST, outputs: noMap.outputs } }).gap, gap(`no ${WS}/mapping.json while captures exist`, 'rebuild'));
  assert.equal(exportGap({ ...FRESH, mapping: 'not json' }).gap, gap(`${WS}/mapping.json unreadable`, 'rebuild'));
  assert.equal(exportGap({ ...FRESH, mapping: { generatedAt: 'T0' } }).gap, gap(`${WS}/mapping.json generatedAt T0 ≠ pages.json T1`, 'rehash-safe'), 'a lone generatedAt drift is reconciled by a re-hash');
  assert.equal(exportGap({ ...FRESH, tree: null }).gap, gap('unchecked (workspace-manifest.mjs not found beside done-check.mjs)', 'rebuild'));
  assert.equal(exportGap({ ...FRESH, tree: null, treeError: 'EACCES: permission denied, open \'content/index.html\'' }).gap, gap("unchecked (EACCES: permission denied, open 'content/index.html')", 'rebuild'));
  assert.equal(exportGap({ ...FRESH, manifest: null, mapping: { generatedAt: 'T0' } }).gap, gap(`no ${WS}/manifest.json; ${WS}/mapping.json generatedAt T0 ≠ pages.json T1`, 'rebuild'), 'causes joined in one line');
});

check('export_stale: a handed-over export is not judged — stardust no longer writes it — and the skipped line says so', () => {
  const { exportGap } = doneCheck;
  assert.deepEqual(exportGap({ ...FRESH, manifest: null, handedOver: `${WS}/handover.json` }), { gap: null, skipped: [`export_stale: handed over (${WS}/handover.json) — stardust no longer writes the export`] });
});

check('export_stale takes its place after ledger_unpaired, before rollout_incomplete', () => {
  const v = doneGaps({ pages: CLEAN_PAGES, ledgerLines: [], notLive: [], ledger: 'ledger_unpaired:1: x', exported: 'export_stale:x' });
  assert.deepEqual(v.gaps, ['ledger_unpaired:1: x', 'export_stale:x', 'rollout_incomplete']);
});

check('CLI: export_stale reads the project — fresh after the three commands, stale once a block file changes after the manifest, or the mapping goes; not judged without the export listed or after handover', () => {
  const pagesDoc = { generatedAt: '2026-10-09T10:00:00Z', pages: CLEAN_PAGES };
  const files = {
    'stardust/rollout/rollout.json': { exports: ['migration-workspace'] },
    'stardust/rollout/coverage/pages.json': pagesDoc,
    'stardust/rollout/coverage/templates.json': { templates: [] },
    'stardust/rollout/coverage/blocks.json': { blocks: [] },
    'stardust/current/pages/home.html': '<main><h1>Home</h1></main>',
    'content/index.html': '<main><div><h1>Home</h1></div></main>',
    'blocks/hero/hero.css': '.hero { margin: 0; }',
    'blocks/hero/hero.js': 'export default function decorate() {}',
    [`${WS}/mapping.json`]: { formatVersion: '0.1.0', generatedAt: pagesDoc.generatedAt, skipped: [], templates: [] },
  };
  const proj = project({ files });
  const sha = (f) => `sha256:${createHash('sha256').update(readFileSync(join(proj, f))).digest('hex')}`;
  const writeManifest = () => {
    const { inputs } = inputHashes({ project: proj, contentDir: join(proj, 'content'), blocksDir: join(proj, 'blocks'), judgementFile: join(proj, WS, 'judgement.json'), ...blockOriginInputDirs(proj) });
    const outputs = Object.fromEntries(['stardust/rollout/coverage/blocks.json', 'stardust/rollout/coverage/pages.json', 'stardust/rollout/coverage/templates.json', `${WS}/mapping.json`].filter((f) => existsSync(join(proj, f))).map((f) => [f, sha(f)]));
    writeFileSync(join(proj, WS, 'manifest.json'), JSON.stringify({ inputs: { ...inputs, content: { ...inputs.content, tracked: null } }, outputs, placeholders: [], handover: null }));
  };
  const stale = () => JSON.parse(run(proj, ['--offline', '--json']).stdout).gaps.filter((g) => g.startsWith('export_stale'));
  writeManifest();
  assert.deepEqual(stale(), []);
  writeFileSync(join(proj, 'blocks/hero/hero.css'), '.hero { margin: 1px; }');
  assert.deepEqual(stale(), [gap('manifest hashes differ from the tree: blocks/hero/hero.css', 'rehash-safe')]);
  writeManifest();
  assert.deepEqual(stale(), []);
  // coverage/pages.json regenerated after the manifest (the evidence case): rehash-safe, and because the adopter
  // hard-rejects a pages.json sha mismatch the line names it; the mapping's generatedAt drifts with the coverage
  writeFileSync(join(proj, 'stardust/rollout/coverage/pages.json'), JSON.stringify({ ...pagesDoc, generatedAt: '2026-10-09T11:00:00Z' }));
  assert.deepEqual(stale(), [gap(`manifest hashes differ from the tree: stardust/rollout/coverage/pages.json; ${WS}/mapping.json generatedAt 2026-10-09T10:00:00Z ≠ pages.json 2026-10-09T11:00:00Z`, 'rehash-safe', true)]);
  writeFileSync(join(proj, 'stardust/rollout/coverage/pages.json'), JSON.stringify(pagesDoc));
  writeManifest();
  assert.deepEqual(stale(), []);
  rmSync(join(proj, WS, 'mapping.json'));
  assert.deepEqual(stale(), [gap(`manifest hashes differ from the tree: ${WS}/mapping.json; no ${WS}/mapping.json while captures exist`, 'rebuild')]);
  writeFileSync(join(proj, WS, 'handover.json'), JSON.stringify({ at: '2026-10-10T00:00:00Z', by: 'a migration tool' }));
  const handed = JSON.parse(run(proj, ['--offline', '--json']).stdout);
  assert.deepEqual(handed.gaps.filter((g) => g.startsWith('export_stale')), []);
  assert.ok(handed.skipped.includes(`export_stale: handed over (${WS}/handover.json) — stardust no longer writes the export`), JSON.stringify(handed.skipped));
  rmSync(join(proj, WS, 'handover.json'));
  writeFileSync(join(proj, 'stardust/rollout/rollout.json'), JSON.stringify({ exports: [] }));
  assert.deepEqual(stale(), [], 'not listed: not judged');
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: export_stale on block-origin\'s own inputs — an eds-schema sidecar (or a capture) changed after the mapping is a differing hash, named, with the remedy', () => {
  const pagesDoc = { generatedAt: '2026-10-09T10:00:00Z', pages: CLEAN_PAGES };
  const files = {
    'stardust/rollout/rollout.json': { exports: ['migration-workspace'] },
    'stardust/rollout/coverage/pages.json': pagesDoc,
    'stardust/rollout/coverage/templates.json': { templates: [] },
    'stardust/rollout/coverage/blocks.json': { blocks: [] },
    'stardust/current/pages/home.html': '<main><h1>Home</h1></main>',
    'stardust/eds-schema/home.json': { slug: 'home', sections: [{ items: [{ role: 'heading', text: 'Home' }] }] },
    'content/index.html': '<main><div><h1>Home</h1></div></main>',
    'blocks/hero/hero.css': '.hero { margin: 0; }',
    'blocks/hero/hero.js': 'export default function decorate() {}',
    [`${WS}/mapping.json`]: { formatVersion: '0.1.0', generatedAt: pagesDoc.generatedAt, skipped: [], templates: [] },
  };
  const proj = project({ files });
  const sha = (f) => `sha256:${createHash('sha256').update(readFileSync(join(proj, f))).digest('hex')}`;
  const writeManifest = () => {
    const { inputs } = inputHashes({ project: proj, contentDir: join(proj, 'content'), blocksDir: join(proj, 'blocks'), judgementFile: join(proj, WS, 'judgement.json'), ...blockOriginInputDirs(proj) });
    const outputs = Object.fromEntries(['stardust/rollout/coverage/blocks.json', 'stardust/rollout/coverage/pages.json', 'stardust/rollout/coverage/templates.json', `${WS}/mapping.json`].map((f) => [f, sha(f)]));
    writeFileSync(join(proj, WS, 'manifest.json'), JSON.stringify({ inputs: { ...inputs, content: { ...inputs.content, tracked: null } }, outputs, placeholders: [], handover: null }));
  };
  const stale = () => JSON.parse(run(proj, ['--offline', '--json']).stdout).gaps.filter((g) => g.startsWith('export_stale'));
  writeManifest();
  assert.deepEqual(stale(), [], 'the sidecar and capture are hashed into the manifest; a fresh export is no gap');
  // a gap-closure that rewrites a sidecar AFTER the mapping is the stale case the export must catch
  writeFileSync(join(proj, 'stardust/eds-schema/home.json'), JSON.stringify({ slug: 'home', sections: [{ items: [{ role: 'eyebrow', text: 'Welcome' }] }] }));
  assert.deepEqual(stale(), [gap('manifest hashes differ from the tree: stardust/eds-schema/home.json', 'rebuild')]);
  writeManifest();
  assert.deepEqual(stale(), []);
  writeFileSync(join(proj, 'stardust/current/pages/home.html'), '<main><h1>Home v2</h1></main>');
  assert.deepEqual(stale(), [gap('manifest hashes differ from the tree: stardust/current/pages/home.html', 'rebuild')]);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: export_quality — a fresh migration-workspace manifest carrying selectorQuality.zeroConfidence, sectionGaps and judgement.toFill prints all three info lines and stays complete (exit 0); handed over, they are silent', () => {
  const pagesDoc = { generatedAt: '2026-10-09T10:00:00Z', pages: CLEAN_PAGES };
  const files = {
    'stardust/rollout/rollout.json': { exports: ['migration-workspace'] },
    'stardust/rollout/coverage/pages.json': pagesDoc,
    'stardust/rollout/coverage/templates.json': { templates: [] },
    'stardust/rollout/coverage/blocks.json': { blocks: [] },
    'stardust/current/pages/home.html': '<main><h1>Home</h1></main>',
    'content/index.html': '<main><div><h1>Home</h1></div></main>',
    'blocks/hero/hero.css': '.hero { margin: 0; }',
    'blocks/hero/hero.js': 'export default function decorate() {}',
    [`${WS}/mapping.json`]: { formatVersion: '0.1.0', generatedAt: pagesDoc.generatedAt, skipped: [], templates: [] },
  };
  const proj = project({ files });
  const sha = (f) => `sha256:${createHash('sha256').update(readFileSync(join(proj, f))).digest('hex')}`;
  const { inputs } = inputHashes({ project: proj, contentDir: join(proj, 'content'), blocksDir: join(proj, 'blocks'), judgementFile: join(proj, WS, 'judgement.json'), ...blockOriginInputDirs(proj) });
  const outputs = Object.fromEntries(['stardust/rollout/coverage/blocks.json', 'stardust/rollout/coverage/pages.json', 'stardust/rollout/coverage/templates.json', `${WS}/mapping.json`].map((f) => [f, sha(f)]));
  const selectorQuality = { instances: 2, sources: { encoderMap: 0, textAlignment: 0, position: 2 }, encoderCoverage: 0, zeroConfidence: 2, zeroConfidenceBlocks: [{ block: 'carousel', instances: 2 }], encode: { encoded: 0, noRoundtrip: 0, handAuthored: 1, notAttempted: 0, notApplicable: 1, unrecorded: 2 } };
  const sectionGaps = [{ page: 'home', template: 'home', section: 's2', reason: 'no-selector', blocks: ['carousel'] }];
  const judgement = { toFill: 23, byKind: { baseType: 3, purpose: 10, reuseGuidance: 10 } };
  writeFileSync(join(proj, WS, 'manifest.json'), JSON.stringify({ inputs: { ...inputs, content: { ...inputs.content, tracked: null } }, outputs, placeholders: [], selectorQuality, sectionGaps, judgement, handover: null }));
  const v = JSON.parse(run(proj, ['--offline', '--json']).stdout);
  assert.deepEqual(v.gaps.filter((g) => g.startsWith('export')), [], 'the export is fresh: no export_stale');
  assert.ok(v.info.includes('export_quality:zero_confidence:2'), JSON.stringify(v.info));
  assert.ok(v.info.includes('export_quality:null_selector_sections:1'), JSON.stringify(v.info));
  assert.ok(v.info.includes('export_quality:judgement_to_fill:23'), JSON.stringify(v.info));
  assert.ok(v.info.includes('export_quality:encode_unrecorded:2'), JSON.stringify(v.info));
  assert.equal(v.complete, true, 'the info lines never flip completeness');
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.split('\n').includes('info: export_quality:zero_confidence:2'), r.stdout);
  assert.ok(r.stdout.split('\n').includes('info: export_quality:null_selector_sections:1'), r.stdout);
  assert.ok(r.stdout.split('\n').includes('info: export_quality:judgement_to_fill:23'), r.stdout);
  assert.ok(r.stdout.split('\n').includes('info: export_quality:encode_unrecorded:2'), r.stdout);
  // without the counts, the byTemplate rows that carry a decision are counted; a manifest from before the field is silent
  const manifestWith = (sq) => writeFileSync(join(proj, WS, 'manifest.json'), JSON.stringify({ inputs: { ...inputs, content: { ...inputs.content, tracked: null } }, outputs, placeholders: [], selectorQuality: sq, sectionGaps, judgement, handover: null }));
  const row = (template, decision) => ({ template, instances: 1, encoderMap: 0, textAlignment: 1, position: 0, encoderCoverage: 0, encode: { decision, vocabulary: null, recordedAt: null } });
  const { encode, ...noCounts } = selectorQuality;
  manifestWith({ ...noCounts, byTemplate: [row('a', 'unrecorded'), row('b', 'hand-authored'), row('c', 'unrecorded'), row('d', 'unrecorded')] });
  assert.ok(JSON.parse(run(proj, ['--offline', '--json']).stdout).info.includes('export_quality:encode_unrecorded:3'), 'counted from the rows');
  manifestWith({ ...noCounts, byTemplate: [{ template: 'a', instances: 1, encoderMap: 0, textAlignment: 1, position: 0, encoderCoverage: 0 }] });
  assert.ok(!JSON.parse(run(proj, ['--offline', '--json']).stdout).info.some((i) => i.startsWith('export_quality:encode')), 'rows without a decision: silent');
  manifestWith(selectorQuality);
  // once handed over, the export is the client's: neither figure is surfaced
  writeFileSync(join(proj, WS, 'handover.json'), JSON.stringify({ at: '2026-10-10T00:00:00Z', by: 'a migration tool' }));
  const handed = JSON.parse(run(proj, ['--offline', '--json']).stdout);
  assert.ok(!handed.info.some((i) => i.startsWith('export_quality')), JSON.stringify(handed.info));
  rmSync(proj, { recursive: true, force: true });
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
