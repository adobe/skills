#!/usr/bin/env node
// Reads Operational Telemetry (RUM) bundles of a domain and prints a JSON report: the site's
// Core Web Vitals, device classes, the LCP elements visitors saw, and the pages to fix first.
//
//   RUM_DOMAIN_KEY=… node optel-report.mjs <domain> <slot> [<slot>…] [--device=mobile] [--top=10]
//
// A slot is a UTC date path: 2026/10 (month), 2026/10/15 (day) or 2026/10/15/05 (hour).
// Needs @adobe/rum-distiller next to this file (npm install). The domain key is read from the
// environment and is never printed.
import { DataChunks, series, facets, utils } from '@adobe/rum-distiller';

// A p75 from fewer values than this is marked lowSample and is not used for ranking.
const MIN_SAMPLES = 10;
const METRICS = ['lcp', 'cls', 'inp'];
const SEVERITY = { poor: 3, ni: 2 };

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const [domain, ...slots] = args.filter((arg) => !arg.startsWith('--'));
const key = process.env.RUM_DOMAIN_KEY;
const top = Number(option('top', '10'));
const device = option('device');

const usage = (message) => {
  console.error(`${message}\nusage: RUM_DOMAIN_KEY=… node optel-report.mjs <domain> <slot> [<slot>…] [--device=mobile|desktop|bot] [--top=10]`);
  process.exit(2);
};
if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) usage('The first argument is the domain, for example www.example.com.');
if (slots.length === 0) usage('Name at least one slot, for example 2026/10.');
const badSlot = slots.find((slot) => !/^\d{4}\/\d{2}(\/\d{2}(\/\d{2})?)?$/.test(slot));
if (badSlot) usage(`${badSlot} is not a slot. Use YYYY/MM, YYYY/MM/DD or YYYY/MM/DD/HH (UTC).`);
if (!key) usage('Set RUM_DOMAIN_KEY to the domain key.');
if (!Number.isInteger(top) || top < 1) usage('--top takes a positive number.');

const chunks = [];
const failedSlots = [];
for (const slot of slots) {
  try {
    const response = await fetch(`https://bundles.aem.page/bundles/${domain}/${slot}?domainkey=${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { rumBundles = [] } = await response.json();
    rumBundles.forEach((bundle) => utils.addCalculatedProps(bundle));
    chunks.push({ date: slot, rumBundles });
  } catch (error) {
    failedSlots.push({ slot, error: String(error.message).replaceAll(key, '<domain key>') });
  }
}
if (chunks.length === 0) {
  console.error(JSON.stringify({ domain, failedSlots }, null, 2));
  process.exit(1);
}

const data = new DataChunks();
data.load(chunks);
data.addSeries('pageViews', series.pageViews);
METRICS.forEach((name) => data.addSeries(name, series[name]));
data.addFacet('url', facets.url);
data.addFacet('device', (bundle) => [bundle.userAgent.split(':')[0]]);
data.addFacet('lcpSource', facets.lcpSource);
data.addFacet('interacted', (bundle) => [bundle.events.some((event) => event.checkpoint === 'click') ? 'yes' : 'no']);
if (device) data.filter = { device: [device] };

const metric = (aggregate, name) => {
  const samples = aggregate.count;
  if (samples === 0) return { samples };
  const p75 = aggregate.percentile(75);
  return { p75, samples, rating: utils.scoreCWV(p75, name), ...(samples < MIN_SAMPLES ? { lowSample: true } : {}) };
};
const row = (metrics) => ({
  pageViews: metrics.pageViews.sum,
  ...Object.fromEntries(METRICS.map((name) => [name, metric(metrics[name], name)])),
});

const pages = data.facets.url.map((facet) => {
  const page = { url: facet.value, ...row(facet.metrics) };
  const failing = METRICS.filter((name) => !page[name].lowSample && SEVERITY[page[name].rating]);
  const severity = Math.max(0, ...failing.map((name) => SEVERITY[page[name].rating]));
  return { ...page, failing, impact: page.pageViews * severity };
});
const report = {
  domain,
  slots: chunks.map((chunk) => chunk.date),
  failedSlots,
  ...(device ? { device } : {}),
  bundles: data.bundles.length,
  site: row(data.totals),
  ...(device ? {} : { devices: data.facets.device.map((facet) => ({ device: facet.value, ...row(facet.metrics) })) }),
  lcpElements: data.facets.lcpSource.slice(0, 5).map((facet) => ({
    selector: facet.value,
    pageViews: facet.metrics.pageViews.sum,
    lcp: metric(facet.metrics.lcp, 'lcp'),
  })),
  pagesSeen: pages.length,
  pagesToFix: pages
    .filter((page) => page.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, top),
  pagesWithTooFewSamples: pages.filter((page) => METRICS.every((name) => page[name].samples < MIN_SAMPLES)).length,
};
// LCP of page views with a click only: page views that sat idle can report a paint long after the load.
data.filter = { ...(device ? { device: [device] } : {}), interacted: ['yes'] };
report.site.lcpInteracted = metric(data.totals.lcp, 'lcp');

console.log(JSON.stringify(report, null, 2));
