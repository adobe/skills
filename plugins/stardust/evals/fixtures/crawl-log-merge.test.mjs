#!/usr/bin/env node
// Fixture test: crawl.mjs `_crawl-log.json` merge (ia-extraction.md
// § _crawl-log.json shape is the rule): append-only across runs —
//   one runs[] entry per invocation;
//   crawl.failures = union minus slugs that later succeeded;
//   discovery never shrinks on a narrower re-run (only the ladder fields refresh);
//   #dynamicSurface roll-up counts pages per reach-signal family (T34.7).
// Runs without playwright: crawl.mjs imports it lazily inside main().
// Usage: node plugins/stardust/evals/fixtures/crawl-log-merge.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import {
  mergeCrawlLog, newDynamicRollup, rollupDynamic, finalizeDynamic,
} from '../../skills/extract/scripts/crawl.mjs';

const fail = (slug, errorClass = 'TimeoutError') => ({ slug, url: `https://example.com/${slug}`, errorClass, message: 'x', at: 't' });
const run = (over) => ({ at: 't', args: { url: 'https://example.com', pages: null, cap: 25 }, technique: 'headless', discovered: 38, skipped: 0, captured: 0, failed: [], ...over });

// run 1: full crawl, one page failed
const log1 = { discovery: { fetchTechnique: 'headless', count: 38, concurrency: 4 }, consent: { method: 'auto' }, favicon: null, crawl: { startedAt: 't', finishedAt: 't', successes: 37, failures: [fail('contact')] } };
const m1 = mergeCrawlLog({}, log1, run({ captured: 37, failed: ['contact'] }), ['index', 'about']);
assert.equal(m1.runs.length, 1, 'first invocation → one runs[] entry');
assert.deepEqual(m1.crawl.failures.map((f) => f.slug), ['contact']);
assert.equal(m1.discovery.count, 38);

// run 2: narrower --pages re-run that does NOT touch the failed page
const log2 = { discovery: { fetchTechnique: 'chrome-headless', count: 1, concurrency: 4, botBlock: 'fingerprint', escalations: [{ tier: 'headless', block: 'fingerprint' }] }, consent: { method: 'auto' }, favicon: null, crawl: { startedAt: 't', finishedAt: 't', successes: 1, failures: [] } };
const m2 = mergeCrawlLog(m1, log2, run({ args: { url: 'https://example.com', pages: ['/pricing'], cap: 25 }, technique: 'chrome-headless', discovered: 1, captured: 1 }), ['pricing']);
assert.equal(m2.runs.length, 2, 'second invocation appends');
assert.equal(m2.discovery.count, 38, 'discovery never shrinks on a narrower re-run');
assert.equal(m2.discovery.fetchTechnique, 'chrome-headless', 'ladder field refreshes');
assert.equal(m2.discovery.botBlock, 'fingerprint', 'ladder evidence refreshes');
assert.deepEqual(m2.crawl.failures.map((f) => f.slug), ['contact'], 'failure retained until the slug succeeds');

// run 3: the failed page succeeds → its failure entry leaves
const log3 = { ...log2, discovery: { ...log2.discovery, botBlock: undefined, escalations: undefined }, crawl: { startedAt: 't', finishedAt: 't', successes: 1, failures: [] } };
const m3 = mergeCrawlLog(m2, log3, run({ args: { url: 'https://example.com', pages: ['/contact'], cap: 25 }, discovered: 1, captured: 1 }), ['contact']);
assert.equal(m3.runs.length, 3);
assert.deepEqual(m3.crawl.failures, [], 'a later success clears the failure');
assert.equal(m3.discovery.count, 38);
assert.equal(m3.discovery.botBlock, 'fingerprint', 'earlier ladder evidence is kept when the re-run had none');

// a failure that recurs is recorded once (this run's record wins)
const log4 = { ...log1, crawl: { ...log1.crawl, failures: [fail('contact', 'BotChallengeError')] } };
const m4 = mergeCrawlLog(m1, log4, run({ failed: ['contact'] }), []);
assert.deepEqual(m4.crawl.failures.map((f) => f.errorClass), ['BotChallengeError'], 'recurring failure is not duplicated');

// _crawl-log.json#dynamicSurface roll-up: the per-page summary counts for the reach-signal families
// (tabs, players, controlGroups, chatLoaders, federated, quiz, searchShell) become site-level page counts
const dyn = (summary) => ({ truncated: false, summary: { sameSiteEndpoints: 0, searchForms: 0, hydrated: false, tabs: 0, players: 0, controlGroups: 0, chatLoaders: 0, federated: 0, quiz: 0, searchShell: false, ...summary }, endpoints: [], thirdPartyScriptHosts: [], frameworkHints: [], globalState: [], forms: [] });
const acc = newDynamicRollup();
rollupDynamic(acc, dyn({ tabs: 3, players: 1, searchShell: true }), 'plans');
rollupDynamic(acc, dyn({ tabs: 1, controlGroups: 2, chatLoaders: 1, federated: 2, quiz: 4 }), 'help');
rollupDynamic(acc, dyn({}), 'about');
const surface = finalizeDynamic(acc);
assert.deepEqual(
  [surface.pages, surface.pagesWithTabs, surface.pagesWithPlayers, surface.pagesWithLooseControls, surface.pagesWithChat, surface.pagesWithFederated, surface.pagesWithQuiz, surface.searchShellPages],
  [3, 2, 1, 1, 1, 1, 1, 1],
  'dynamicSurface counts pages per reach-signal family',
);

console.log('crawl-log-merge test: ok');
