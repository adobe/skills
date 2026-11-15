#!/usr/bin/env node
// Reads Operational Telemetry (RUM) bundles of a domain and prints a JSON report: traffic and
// Core Web Vitals of the site, device classes, the LCP elements visitors saw, the busiest
// pages, and the pages to fix first. With a baseline period, it also says what changed.
//
//   RUM_DOMAIN_KEY=… node optel-report.mjs <domain> <slot> [<slot>…] [options]
//   RUM_DOMAIN_KEY=… node optel-report.mjs <domain> --from=2026-10-08 --to=2026-10-14 [options]
//
// A slot is a UTC date path: 2026/10 (month), 2026/10/15 (day) or 2026/10/15/05 (hour).
// --from and --to are UTC dates, both included, and stand for one day slot each.
//
//   --baseline-from=… --baseline-to=…   a second period to compare with, as dates
//   --device=mobile|desktop|bot         only this device class
//   --url=<value>                       only this page, as a report without --url names it in
//                                       "url". The report then has no lists of pages.
//   --top=10                            how many pages to list
//
// Needs @adobe/rum-distiller next to this file (npm install). The domain key is read from the
// environment and is never printed. Only sends GET requests to https://bundles.aem.page.
import { DataChunks, series, facets, stats, utils } from '@adobe/rum-distiller';

// A p75 from fewer values than this is marked lowSample, and nothing is ranked or compared by it.
const MIN_SAMPLES = 10;
// Two periods are tested against each other when each has this many values. The test expects
// a quarter of them above the common p75, and a z-test needs about five in each cell.
const MIN_TEST_SAMPLES = 20;
const MAX_DAYS = 92;
const METRICS = ['lcp', 'cls', 'inp'];
const SEVERITY = { good: 1, ni: 2, poor: 3 };
const DAY = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const option = (name) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
};
const usage = (message) => {
  console.error(`${message}
usage: RUM_DOMAIN_KEY=… node optel-report.mjs <domain> (<slot>… | --from=YYYY-MM-DD --to=YYYY-MM-DD)
       [--baseline-from=YYYY-MM-DD --baseline-to=YYYY-MM-DD] [--device=mobile|desktop|bot] [--url=<value>] [--top=10]`);
  process.exit(2);
};
const KNOWN = ['from', 'to', 'baseline-from', 'baseline-to', 'device', 'url', 'top'];
const unknown = args.find((arg) => arg.startsWith('--') && !KNOWN.some((name) => arg.startsWith(`--${name}=`)));
if (unknown) usage(`${unknown} is not an option.`);

// The day slots from one UTC date to another, both included.
const days = (from, to, what) => {
  const parse = (value) => {
    const time = /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? Date.parse(`${value}T00:00:00Z`) : NaN;
    if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) usage(`${what}: ${value} is not a date. Use YYYY-MM-DD.`);
    return time;
  };
  const [start, end] = [parse(from), parse(to)];
  if (end < start) usage(`${what}: ${to} is before ${from}.`);
  if ((end - start) / DAY >= MAX_DAYS) usage(`${what}: more than ${MAX_DAYS} days. Use month slots (YYYY/MM) for a longer period.`);
  const slots = [];
  for (let time = start; time <= end; time += DAY) slots.push(new Date(time).toISOString().slice(0, 10).replaceAll('-', '/'));
  return slots;
};

const [domain, ...named] = args.filter((arg) => !arg.startsWith('--'));
const key = process.env.RUM_DOMAIN_KEY;
const top = Number(option('top') ?? '10');
const device = option('device');
const url = option('url');
if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) usage('The first argument is the domain, for example www.example.com.');
const badSlot = named.find((slot) => !/^\d{4}\/\d{2}(\/\d{2}(\/\d{2})?)?$/.test(slot));
if (badSlot) usage(`${badSlot} is not a slot. Use YYYY/MM, YYYY/MM/DD or YYYY/MM/DD/HH (UTC).`);
if ((option('from') === undefined) !== (option('to') === undefined)) usage('--from and --to go together.');
if ((option('baseline-from') === undefined) !== (option('baseline-to') === undefined)) usage('--baseline-from and --baseline-to go together.');
if (option('from') && named.length > 0) usage('Name slots, or give --from and --to, not both.');
const slots = option('from') ? days(option('from'), option('to'), '--from and --to') : named;
const baselineSlots = option('baseline-from') ? days(option('baseline-from'), option('baseline-to'), '--baseline-from and --baseline-to') : null;
if (slots.length === 0) usage('Name at least one slot, for example 2026/10, or give --from and --to.');
if (!key) usage('Set RUM_DOMAIN_KEY to the domain key.');
if (!Number.isInteger(top) || top < 1) usage('--top takes a positive number.');

// Loads the slots, five at a time. A slot that fails is named, and the others still count.
async function load(wanted) {
  const chunks = [];
  const failedSlots = [];
  const one = async (slot) => {
    try {
      const response = await fetch(`https://bundles.aem.page/bundles/${domain}/${slot}?domainkey=${encodeURIComponent(key)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { rumBundles = [] } = await response.json();
      rumBundles.forEach((bundle) => utils.addCalculatedProps(bundle));
      chunks.push({ date: slot, rumBundles });
    } catch (error) {
      failedSlots.push({ slot, error: String(error.message).replaceAll(key, '<domain key>') });
    }
  };
  for (let index = 0; index < wanted.length; index += 5) await Promise.all(wanted.slice(index, index + 5).map(one));
  const order = (a, b) => wanted.indexOf(a) - wanted.indexOf(b);
  return { chunks: chunks.sort((a, b) => order(a.date, b.date)), failedSlots: failedSlots.sort((a, b) => order(a.slot, b.slot)) };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const metric = (aggregate, name) => {
  const samples = aggregate.count;
  if (samples === 0) return { samples };
  // milliseconds without decimals; CLS has no unit and is small
  const p75 = round(aggregate.percentile(75), name === 'cls' ? 3 : 0);
  const good = aggregate.values.filter((value) => utils.scoreCWV(value, name) === 'good').length;
  return { p75, samples, rating: utils.scoreCWV(p75, name), goodShare: round(good / samples, 3), ...(samples < MIN_SAMPLES ? { lowSample: true } : {}) };
};
const row = (metrics) => ({
  pageViews: metrics.pageViews.sum,
  ...Object.fromEntries(METRICS.map((name) => [name, metric(metrics[name], name)])),
});
const usable = (value) => value.samples >= MIN_SAMPLES;

// Everything the report says about one period.
function analyse({ chunks, failedSlots }) {
  const data = new DataChunks();
  data.load(chunks);
  for (const name of ['pageViews', 'visits', 'bounces', 'engagement', 'ttfb', ...METRICS]) data.addSeries(name, series[name]);
  data.addFacet('url', facets.url);
  data.addFacet('device', (bundle) => [bundle.userAgent.split(':')[0]]);
  data.addFacet('lcpSource', facets.lcpSource);
  data.addFacet('checkpoint', facets.checkpoint);
  data.addFacet('interacted', (bundle) => [bundle.events.some((event) => event.checkpoint === 'click') ? 'yes' : 'no']);
  const filter = { ...(device ? { device: [device] } : {}), ...(url ? { url: [url] } : {}) };
  data.filter = filter;

  const totals = data.totals;
  const pages = data.facets.url.map((facet) => {
    const page = { url: facet.value, ...row(facet.metrics) };
    const failing = METRICS.filter((name) => usable(page[name]) && page[name].rating !== 'good');
    const severity = Math.max(0, ...failing.map((name) => SEVERITY[page[name].rating]));
    return { ...page, failing, impact: page.pageViews * severity };
  });
  // the measurements themselves, for the comparison of two periods; they are not printed
  const values = {
    site: Object.fromEntries(METRICS.map((name) => [name, [...totals[name].values]])),
    pages: new Map(data.facets.url.map((facet) => [facet.value, Object.fromEntries(METRICS.map((name) => [name, [...facet.metrics[name].values]]))])),
  };
  const unseen = data.estimators.url.chao1;
  const period = {
    slots: chunks.map((chunk) => chunk.date),
    failedSlots,
    bundles: data.bundles.length,
    site: {
      ...row(totals),
      // 95%: the true number of page views is within this distance of pageViews
      pageViewsMargin: stats.samplingError(totals.pageViews.sum, totals.pageViews.count),
      visits: totals.visits.sum,
      bounceRate: totals.visits.sum ? round(totals.bounces.sum / totals.visits.sum, 3) : null,
      engagementRate: totals.pageViews.sum ? round(totals.engagement.sum / totals.pageViews.sum, 3) : null,
      ttfb: metric(totals.ttfb, 'ttfb'),
    },
    devices: data.facets.device.map((facet) => ({ device: facet.value, ...row(facet.metrics) })),
    lcpElements: data.facets.lcpSource.slice(0, 5).map((facet) => ({
      selector: facet.value,
      pageViews: facet.metrics.pageViews.sum,
      lcp: metric(facet.metrics.lcp, 'lcp'),
    })),
    checkpoints: data.facets.checkpoint.map((facet) => ({ checkpoint: facet.value, pageViews: facet.metrics.pageViews.sum })),
    pagesSeen: pages.length,
    // Chao1: how many pages had a page view at all, seen or not. Sampling hides the quiet ones.
    pagesEstimated: { pages: Math.round(unseen.sHat), low: Math.floor(unseen.ci[0]), high: Math.ceil(unseen.ci[1]) },
    topPages: pages.slice(0, top).map(({ impact, ...page }) => page),
    pagesToFix: pages
      .filter((page) => page.impact > 0)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, top),
    pagesWithTooFewSamples: pages.filter((page) => METRICS.every((name) => !usable(page[name]))).length,
  };
  // LCP of page views with a click only: a page view that sat idle can report a paint long after the load.
  data.filter = { ...filter, interacted: ['yes'] };
  period.site.lcpInteracted = metric(data.totals.lcp, 'lcp');
  return { period, pages, values };
}

// Whether the p75 of two sets of measurements differs. The threshold is the p75 of both sets
// together; the test is whether the two have the same share of values above it (a z-test of
// two proportions). It is about the p75 itself, so it also sees a change within one rating.
// Returns nothing when a set is too small for the test.
function quantileTest(was, is) {
  if (was.length < MIN_TEST_SAMPLES || is.length < MIN_TEST_SAMPLES) return {};
  const all = [...was, ...is].sort((a, b) => a - b);
  const threshold = all[Math.ceil(all.length * 0.75) - 1];
  const over = (values) => values.filter((value) => value > threshold).length;
  const reach = (values) => values.filter((value) => value >= threshold).length;
  // Many values can equal the threshold. Count them as above it when that brings the share
  // of all values above the threshold closer to a quarter, or when nothing lies over it.
  const off = (count) => Math.abs(count / all.length - 0.25);
  const above = over(all) === 0 || off(reach(all)) < off(over(all)) ? reach : over;
  const pValue = stats.zTestTwoProportions(was.length, above(was), is.length, above(is));
  return {
    aboveCommonP75: { baseline: round(above(was) / was.length, 3), now: round(above(is) / is.length, 3) },
    pValue: round(pValue, 4),
    significant: pValue < 0.05,
  };
}

// What differs between the baseline and the period: per metric the p75 of both with a test
// of the difference, the pages whose rating got worse, the device mix and new LCP elements.
function compare(baseline, now) {
  const change = {};
  for (const name of METRICS) {
    const [was, is] = [baseline.period.site[name], now.period.site[name]];
    const pick = ({ p75, samples, rating, goodShare }) => ({ p75, samples, rating, goodShare });
    change[name] = { baseline: pick(was), now: pick(is) };
    Object.assign(change[name], quantileTest(baseline.values.site[name], now.values.site[name]));
  }
  const share = ({ period }, name) => {
    const found = period.devices.find((entry) => entry.device === name);
    return found && period.site.pageViews ? round(found.pageViews / period.site.pageViews, 3) : 0;
  };
  const before = new Map(baseline.pages.map((page) => [page.url, page]));
  const pagesWorse = [];
  for (const page of now.pages) {
    const was = before.get(page.url);
    if (!was) continue;
    for (const name of METRICS) {
      if (usable(was[name]) && usable(page[name]) && SEVERITY[page[name].rating] > SEVERITY[was[name].rating]) {
        const { pValue, significant } = quantileTest(baseline.values.pages.get(page.url)[name], now.values.pages.get(page.url)[name]);
        pagesWorse.push({ url: page.url, metric: name, pageViews: page.pageViews, baseline: { p75: was[name].p75, samples: was[name].samples, rating: was[name].rating }, now: { p75: page[name].p75, samples: page[name].samples, rating: page[name].rating }, pValue, significant });
      }
    }
  }
  const selectors = (side) => side.period.lcpElements.filter((entry) => usable(entry.lcp)).map((entry) => entry.selector);
  return {
    ...change,
    pageViews: {
      baseline: baseline.period.site.pageViews,
      baselineMargin: baseline.period.site.pageViewsMargin,
      now: now.period.site.pageViews,
      nowMargin: now.period.site.pageViewsMargin,
    },
    deviceShare: [...new Set([...baseline.period.devices, ...now.period.devices].map((entry) => entry.device))]
      .map((name) => ({ device: name, baseline: share(baseline, name), now: share(now, name) })),
    lcpElementsNew: selectors(now).filter((selector) => !selectors(baseline).includes(selector)),
    pagesWorse: pagesWorse.sort((a, b) => b.pageViews - a.pageViews).slice(0, top),
  };
}

const loaded = await load(slots);
if (loaded.chunks.length === 0) {
  console.error(JSON.stringify({ domain, failedSlots: loaded.failedSlots }, null, 2));
  process.exit(1);
}
const now = analyse(loaded);
if (url && now.period.site.pageViews === 0) {
  console.error(`No page view of ${url} in these slots. Take the value from "url" in a report without --url.`);
  process.exit(1);
}
const report = { domain, ...(device ? { device } : {}), ...(url ? { url } : {}), ...now.period };
if (device) delete report.devices;
// a facet is not narrowed by a filter on itself, so the lists of pages would name every page
const PAGE_LISTS = ['pagesSeen', 'pagesEstimated', 'topPages', 'pagesToFix', 'pagesWithTooFewSamples'];
if (url) PAGE_LISTS.forEach((name) => delete report[name]);
if (baselineSlots) {
  const loadedBaseline = await load(baselineSlots);
  if (loadedBaseline.chunks.length === 0) {
    console.error(JSON.stringify({ domain, baseline: { failedSlots: loadedBaseline.failedSlots } }, null, 2));
    process.exit(1);
  }
  const baseline = analyse(loadedBaseline);
  const { slots: baselineLoaded, failedSlots, bundles, site } = baseline.period;
  report.baseline = { slots: baselineLoaded, failedSlots, bundles, site };
  report.change = compare(baseline, now);
  if (device) delete report.change.deviceShare;
  if (url) delete report.change.pagesWorse;
}
console.log(JSON.stringify(report, null, 2));
