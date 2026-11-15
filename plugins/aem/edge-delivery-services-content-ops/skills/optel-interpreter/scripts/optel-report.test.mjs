// Tests for optel-report.mjs. Run: node --test optel-report.test.mjs
//
// The script runs as a child process in a temporary directory, with fetch replaced by a stub
// that serves bundles from a scenario and records every URL that was requested. It needs
// @adobe/rum-distiller there: the tests install it with npm, or link the node_modules
// directory that RUM_DISTILLER_NODE_MODULES names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEY = 'secret-domain-key';
const HOME = 'https://www.example.com/';
let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'optel-report-'));
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'optel-report.mjs'), join(dir, 'optel-report.mjs'));
  if (process.env.RUM_DISTILLER_NODE_MODULES) {
    symlinkSync(process.env.RUM_DISTILLER_NODE_MODULES, join(dir, 'node_modules'));
  } else {
    // renovate: datasource=npm depName=@adobe/rum-distiller
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--prefix', dir, '@adobe/rum-distiller@1.24.0'], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
  }
  writeFileSync(join(dir, 'stub.mjs'), `
import { appendFileSync, readFileSync } from 'node:fs';
const scenario = JSON.parse(readFileSync(process.env.SCENARIO, 'utf8'));
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  appendFileSync(process.env.REQUESTS, url.href + '\\n');
  const slot = url.pathname.split('/').slice(3).join('/');
  const answer = scenario[slot] ?? [];
  if (typeof answer === 'number') return { ok: false, status: answer };
  return { ok: true, status: 200, json: async () => ({ rumBundles: answer }) };
};
`);
});
after(() => rmSync(dir, { recursive: true, force: true }));

let count = 0;
// One sampled page view. Core Web Vitals become cwv-* events, as the bundle API delivers them.
function bundle(url, { lcp, cls, inp, ttfb, weight = 100, userAgent = 'mobile:ios:webkit', click = false, enter = true, selector = '.hero img' } = {}) {
  count += 1;
  const events = [{ checkpoint: 'top', timeDelta: 1 }];
  if (enter) events.push({ checkpoint: 'enter', source: 'https://www.google.com/', target: 'visible', timeDelta: 2 });
  if (click) events.push({ checkpoint: 'click', source: '.button', timeDelta: 3 });
  if (lcp !== undefined) events.push({ checkpoint: 'cwv-lcp', value: lcp, source: selector, timeDelta: 4 });
  if (cls !== undefined) events.push({ checkpoint: 'cwv-cls', value: cls, timeDelta: 5 });
  if (inp !== undefined) events.push({ checkpoint: 'cwv-inp', value: inp, timeDelta: 6 });
  if (ttfb !== undefined) events.push({ checkpoint: 'cwv-ttfb', value: ttfb, timeDelta: 7 });
  return { id: `b${count}`, host: 'www.example.com', url, userAgent, weight, time: '2026-10-15T05:00:00.000Z', timeSlot: '2026-10-15T05:00:00.000Z', events };
}
const many = (n, url, values) => Array.from({ length: n }, () => bundle(url, values));

function run(scenario, ...args) {
  const files = { scenario: join(dir, `scenario-${count}.json`), requests: join(dir, `requests-${count}.txt`) };
  count += 1;
  writeFileSync(files.scenario, JSON.stringify(scenario));
  writeFileSync(files.requests, '');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(dir, 'stub.mjs')).href, 'optel-report.mjs', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, RUM_DOMAIN_KEY: KEY, SCENARIO: files.scenario, REQUESTS: files.requests },
  });
  const requests = readFileSync(files.requests, 'utf8').split('\n').filter(Boolean);
  return { ...result, requests, report: result.status === 0 ? JSON.parse(result.stdout) : null };
}
const slotsOf = (requests) => requests.map((line) => new URL(line).pathname.split('/').slice(3).join('/'));

test('page views are the sum of the weights, and every p75 comes with its samples and the share of good values', () => {
  const { report } = run({
    '2026/10': [
      ...many(12, HOME, { lcp: 1000, cls: 0.01, inp: 100, ttfb: 300 }),
      ...many(4, HOME, { lcp: 5000, inp: 100, weight: 1000, enter: false }),
      bundle(`${HOME}quiet`, { lcp: 9000 }),
    ],
  }, 'www.example.com', '2026/10');
  assert.equal(report.bundles, 17);
  assert.equal(report.site.pageViews, 12 * 100 + 4 * 1000 + 100);
  assert.equal(report.site.visits, 1300);
  assert.deepEqual(report.site.lcp, { p75: 5000, samples: 17, rating: 'poor', goodShare: 0.706 });
  assert.deepEqual(report.site.cls, { p75: 0.01, samples: 12, rating: 'good', goodShare: 1 });
  assert.equal(report.site.ttfb.samples, 12);
  assert.ok(report.site.pageViewsMargin > 0);
  assert.deepEqual(report.checkpoints.map((entry) => entry.checkpoint).sort(), ['cwv-cls', 'cwv-inp', 'cwv-lcp', 'cwv-ttfb', 'enter', 'top']);
  assert.deepEqual(report.lcpElements[0], { selector: '.hero img', pageViews: 5300, lcp: { p75: 5000, samples: 17, rating: 'poor', goodShare: 0.706 } });
});

test('a p75 from fewer than 10 values is marked, and its page is not ranked', () => {
  const { report } = run({
    '2026/10': [...many(10, `${HOME}slow`, { lcp: 3000 }), ...many(9, `${HOME}few`, { lcp: 9000, weight: 1000 })],
  }, 'www.example.com', '2026/10');
  assert.deepEqual(report.pagesToFix.map((page) => page.url), [`${HOME}slow`]);
  assert.deepEqual(report.topPages.map((page) => page.url), [`${HOME}few`, `${HOME}slow`]);
  assert.equal(report.topPages[0].lcp.lowSample, true);
  assert.equal(report.pagesWithTooFewSamples, 1);
  assert.equal(report.pagesSeen, 2);
});

test('pages to fix are ranked by page views times severity', () => {
  const { report } = run({
    '2026/10': [
      ...many(10, `${HOME}poor-quiet`, { lcp: 5000 }),
      ...many(10, `${HOME}ni-busy`, { lcp: 3000, weight: 200 }),
      ...many(10, `${HOME}inp`, { lcp: 1000, inp: 600, weight: 50 }),
      ...many(10, `${HOME}fine`, { lcp: 1000, weight: 5000 }),
    ],
  }, 'www.example.com', '2026/10');
  assert.deepEqual(report.pagesToFix.map((page) => [page.url, page.failing, page.impact]), [
    [`${HOME}ni-busy`, ['lcp'], 2000 * 2],
    [`${HOME}poor-quiet`, ['lcp'], 1000 * 3],
    [`${HOME}inp`, ['inp'], 500 * 3],
  ]);
});

test('--from and --to stand for one day slot each, both ends included, across a month', () => {
  const { report, requests } = run({}, 'www.example.com', '--from=2026-09-29', '--to=2026-10-02');
  assert.deepEqual(slotsOf(requests).sort(), ['2026/09/29', '2026/09/30', '2026/10/01', '2026/10/02']);
  assert.deepEqual(report.slots, ['2026/09/29', '2026/09/30', '2026/10/01', '2026/10/02']);
  assert.equal(report.bundles, 0);
  assert.ok(requests.every((line) => new URL(line).origin === 'https://bundles.aem.page'));
});

test('a slot that fails is named and the others count; the key is in no output', () => {
  const some = run({ '2026/09': 403, '2026/10': many(10, HOME, { lcp: 1000 }) }, 'www.example.com', '2026/09', '2026/10');
  assert.equal(some.status, 0);
  assert.deepEqual(some.report.failedSlots, [{ slot: '2026/09', error: 'HTTP 403' }]);
  assert.deepEqual(some.report.slots, ['2026/10']);
  const none = run({ '2026/10': 403 }, 'www.example.com', '2026/10');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /"error": "HTTP 403"/);
  for (const output of [some.stdout, some.stderr, none.stdout, none.stderr]) assert.ok(!output.includes(KEY));
});

test('--device narrows the report to one device class, --url to one page', () => {
  const scenario = {
    '2026/10': [
      ...many(10, HOME, { lcp: 1000 }),
      ...many(10, HOME, { lcp: 5000, userAgent: 'desktop:windows:blink' }),
      ...many(10, `${HOME}other`, { lcp: 3000, userAgent: 'desktop:mac:webkit' }),
    ],
  };
  const all = run(scenario, 'www.example.com', '2026/10').report;
  assert.deepEqual(all.devices.map((entry) => [entry.device, entry.pageViews]), [['desktop', 2000], ['mobile', 1000]]);
  const desktop = run(scenario, 'www.example.com', '2026/10', '--device=desktop').report;
  assert.equal(desktop.site.pageViews, 2000);
  assert.equal(desktop.devices, undefined);
  assert.deepEqual(desktop.topPages.map((page) => [page.url, page.pageViews]), [[HOME, 1000], [`${HOME}other`, 1000]]);
  const page = run(scenario, 'www.example.com', '2026/10', `--url=${HOME}other`).report;
  assert.equal(page.site.pageViews, 1000);
  assert.equal(page.site.lcp.p75, 3000);
  assert.equal(page.topPages, undefined);
  const missing = run(scenario, 'www.example.com', '2026/10', `--url=${HOME}nowhere`);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No page view of/);
});

test('LCP of page views with a click is reported next to LCP of all', () => {
  const { report } = run({
    '2026/10': [...many(10, HOME, { lcp: 1000, click: true }), ...many(10, HOME, { lcp: 60000 })],
  }, 'www.example.com', '2026/10');
  assert.equal(report.site.lcp.p75, 60000);
  assert.deepEqual(report.site.lcpInteracted, { p75: 1000, samples: 10, rating: 'good', goodShare: 1 });
  assert.equal(report.site.engagementRate, 0.5);
  assert.equal(report.site.bounceRate, 0.5);
});

test('a baseline period shows what changed: the share of good values with its p-value, the device mix, new LCP elements and pages that got worse', () => {
  const { report, requests } = run({
    '2026/10/01': [...many(20, HOME, { lcp: 1000 }), ...many(10, `${HOME}stable`, { lcp: 3000 })],
    '2026/10/08': [
      ...many(20, HOME, { lcp: 5000, selector: '.carousel img' }),
      ...many(10, `${HOME}stable`, { lcp: 3000, userAgent: 'desktop:mac:blink' }),
      ...many(5, `${HOME}few`, { lcp: 9000 }),
    ],
  }, 'www.example.com', '--from=2026-10-08', '--to=2026-10-08', '--baseline-from=2026-10-01', '--baseline-to=2026-10-01');
  assert.deepEqual(slotsOf(requests).sort(), ['2026/10/01', '2026/10/08']);
  assert.deepEqual(report.baseline.slots, ['2026/10/01']);
  assert.equal(report.baseline.site.pageViews, 3000);
  const { lcp, cls, deviceShare, lcpElementsNew, pagesWorse, pageViews } = report.change;
  assert.deepEqual(lcp.baseline, { p75: 3000, samples: 30, rating: 'ni', goodShare: 0.667 });
  assert.deepEqual(lcp.now, { p75: 5000, samples: 35, rating: 'poor', goodShare: 0 });
  // the p75 of both periods together is 5000: none of the baseline reaches it, 25 of 35 now do
  assert.deepEqual(lcp.aboveCommonP75, { baseline: 0, now: 0.714 });
  assert.equal(lcp.significant, true);
  assert.ok(lcp.pValue < 0.001);
  assert.equal(cls.pValue, undefined); // no samples, nothing to compare
  assert.deepEqual(deviceShare, [{ device: 'mobile', baseline: 1, now: 0.714 }, { device: 'desktop', baseline: 0, now: 0.286 }]);
  assert.deepEqual(lcpElementsNew, ['.carousel img']);
  assert.deepEqual(pagesWorse.map((page) => [page.url, page.metric, page.baseline.rating, page.now.rating, page.significant]), [[HOME, 'lcp', 'good', 'poor', true]]);
  assert.deepEqual(pagesWorse[0].baseline, { p75: 1000, samples: 20, rating: 'good' });
  assert.deepEqual([pageViews.baseline, pageViews.now], [3000, 3500]);
});

// LCP values around a centre, the same spread every time
const spread = (n, url, centre) => Array.from({ length: n }, (_, i) => bundle(url, { lcp: centre + (i % 20) * 10 }));
const weeks = (baseline, now) => run({ '2026/10/01': baseline, '2026/10/08': now }, 'www.example.com', '--from=2026-10-08', '--to=2026-10-08', '--baseline-from=2026-10-01', '--baseline-to=2026-10-01').report.change.lcp;

test('a p75 that doubles within one rating is a significant change, in either direction', () => {
  // poor before and after: the share of good values is 0 in both periods and says nothing
  const worse = weeks(spread(100, HOME, 4500), spread(100, HOME, 9000));
  assert.deepEqual([worse.baseline.rating, worse.now.rating, worse.baseline.goodShare, worse.now.goodShare], ['poor', 'poor', 0, 0]);
  assert.deepEqual(worse.aboveCommonP75, { baseline: 0, now: 0.5 });
  assert.equal(worse.significant, true);
  const better = weeks(spread(100, HOME, 9000), spread(100, HOME, 4500));
  assert.deepEqual(better.aboveCommonP75, { baseline: 0.5, now: 0 });
  assert.equal(better.significant, true);
  // every value the same in each period: nothing lies over the common p75, so the values
  // that equal it count as above
  const flat = weeks(many(100, HOME, { lcp: 4500 }), many(100, HOME, { lcp: 9000 }));
  assert.deepEqual(flat.aboveCommonP75, { baseline: 0, now: 1 });
  assert.equal(flat.significant, true);
});

test('two periods with the same values are not a change; fewer than 20 values in a period are not tested', () => {
  const same = weeks(spread(100, HOME, 3000), spread(100, HOME, 3000));
  assert.deepEqual(same.aboveCommonP75, { baseline: 0.25, now: 0.25 });
  assert.equal(same.pValue, 1);
  assert.equal(same.significant, false);
  // values drawn from the same range in another order, and a few more of them
  const shuffled = weeks(spread(100, HOME, 3000), spread(120, HOME, 3000).reverse());
  assert.equal(shuffled.significant, false);
  const few = weeks(spread(19, HOME, 3000), spread(100, HOME, 9000));
  assert.deepEqual([few.baseline.samples, few.now.samples], [19, 100]);
  assert.equal(few.pValue, undefined);
  assert.equal(few.significant, undefined);
  assert.equal(few.aboveCommonP75, undefined);
});

// references/rum-distiller.md has an example for a conversion rate and its test. It runs here
// as it is written there, so that it can't go wrong unnoticed.
test('the conversion example of the reference finds a rate that rose from 10% to 50%, and none that stayed', async () => {
  const reference = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'rum-distiller.md'), 'utf8');
  const [, example] = reference.match(/## A conversion rate\n\n```javascript\n([\s\S]*?)```/);
  const visits = (n, submits) => Array.from({ length: n }, (_, i) => {
    const visit = bundle(HOME);
    if (i < submits) visit.events.push({ checkpoint: 'formsubmit', source: 'form', timeDelta: 9 });
    return visit;
  });
  writeFileSync(join(dir, 'conversion.mjs'), `
import { DataChunks, series, facets, stats, utils } from '@adobe/rum-distiller';
const [bundlesBefore, bundlesAfter] = JSON.parse(process.env.PERIODS);
[...bundlesBefore, ...bundlesAfter].forEach((bundle) => utils.addCalculatedProps(bundle));
${example}
console.log(JSON.stringify({ before, after, pValue }));
`);
  const example1 = (before, after) => {
    const result = spawnSync(process.execPath, ['conversion.mjs'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PERIODS: JSON.stringify([before, after]) } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const rose = example1(visits(1000, 100), visits(1000, 500));
  assert.deepEqual(rose.before, { rate: 0.1, visits: 1000, submits: 100 });
  assert.deepEqual(rose.after, { rate: 0.5, visits: 1000, submits: 500 });
  assert.ok(rose.pValue < 0.001);
  const stayed = example1(visits(1000, 100), visits(500, 50));
  assert.equal(stayed.pValue, 1);
});

test('arguments that make no sense are refused with the usage', () => {
  const refused = (...args) => {
    const result = run({}, ...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /usage:/);
    assert.equal(result.requests.length, 0);
    return result.stderr;
  };
  assert.match(refused('www.example.com/x?', '2026/10'), /The first argument is the domain/);
  assert.match(refused('www.example.com', '2026'), /2026 is not a slot/);
  assert.match(refused('www.example.com'), /Name at least one slot/);
  assert.match(refused('www.example.com', '--from=2026-10-01'), /--from and --to go together/);
  assert.match(refused('www.example.com', '--from=2026-02-30', '--to=2026-03-01'), /is not a date/);
  assert.match(refused('www.example.com', '--from=2026-10-02', '--to=2026-10-01'), /is before/);
  assert.match(refused('www.example.com', '--from=2026-01-01', '--to=2026-06-01'), /more than 92 days/);
  assert.match(refused('www.example.com', '2026/10', '--from=2026-10-01', '--to=2026-10-02'), /not both/);
  assert.match(refused('www.example.com', '2026/10', '--divice=mobile'), /is not an option/);
});
