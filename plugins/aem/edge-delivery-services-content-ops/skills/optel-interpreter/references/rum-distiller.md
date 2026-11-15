# @adobe/rum-distiller

The library behind the OpTel Explorer. Checked against version 1.24.0 and the open data of `emigrationbrewing.com` (`domainkey=open`) in November 2026. Its `API.md` has every signature.

## Load

```javascript
import { DataChunks, series, facets, facetFns, stats, utils } from '@adobe/rum-distiller';

const response = await fetch(`https://bundles.aem.page/bundles/${domain}/2026/10?domainkey=${process.env.RUM_DOMAIN_KEY}`);
const { rumBundles } = await response.json();
rumBundles.forEach((bundle) => utils.addCalculatedProps(bundle));

const data = new DataChunks();
data.load([{ date: '2026/10', rumBundles }]); // one chunk per slot; addData(chunks) adds more
data.addSeries('pageViews', series.pageViews);
data.addSeries('lcp', series.lcp);
data.addFacet('url', facets.url);
console.log(data.totals.pageViews.sum, data.totals.lcp.percentile(75), data.totals.lcp.count);
for (const entry of data.facets.url) console.log(entry.value, entry.metrics.pageViews.sum);
```

`utils.addCalculatedProps(bundle)` must run on every bundle before `load()`. It sets `visit`, `cwvLCP` and `cwvCLS` (the largest value of the page view), `cwvINP` and `cwvTTFB` (the last), and names an empty `enter` source `(direct)`. Without it, visits are 0 and every Core Web Vitals series is empty, with no error.

## Series

A series is a function from a bundle to a number. `data.addSeries(name, fn)` registers one.

| Series | Value for a bundle |
|---|---|
| `pageViews` | Its weight. 0 for a prerendered page that was never shown. |
| `visits` | Its weight, if it has an `enter` checkpoint: the page view came from outside the site. |
| `bounces` | Its weight, if it is a visit without a `click`. |
| `engagement` | Its weight, if it has a `click` or more than three `viewblock` and `viewmedia` events. |
| `organic` | Its weight, if it is a visit without paid acquisition. |
| `earned` | Its weight, if it is a visit that is neither paid nor owned (email, for example). |
| `lcp`, `cls`, `inp`, `ttfb` | The value, not weighted. |

A series of your own counts anything, for example page views with an error:

```javascript
data.addSeries('errors', (bundle) => (bundle.events.some((event) => event.checkpoint === 'error') ? bundle.weight : 0));
```

## Facets

A facet is a function from a bundle to an array of strings. `data.addFacet(name, fn)` registers one.

| Facet | Values |
|---|---|
| `url` | The page, with ids, hashes and UUIDs in the path replaced. |
| `plainURL` | The page as it is, without query and hash. |
| `userAgent` | Cumulative: `mobile`, `mobile:ios` and `mobile:ios:webkit` for one bundle. |
| `checkpoint` | The checkpoints of the page view. Paid, email and UTM tags appear as `acquisition`. |
| `vitals` | `goodLCP`, `niINP`, `poorCLS` and so on, one per metric the bundle has. |
| `lcpSource`, `lcpTarget` | Selector and URL of the LCP element. |
| `acquisitionSource` | Cumulative: `paid`, `paid:search`, `paid:search:google`. AI assistants are `earned:ai:chatgpt` and the like. |
| `enterSource` | The referrer, and its class: `search:google`, `search`, `*:google`. |
| `mediaTarget` | URLs of the images and videos that were seen. |
| `facetFns.checkpointSource(name)`, `facetFns.checkpointTarget(name)` | The `source` or `target` of one checkpoint, for example `facetFns.checkpointTarget('error')` for error messages. |

Each entry of `data.facets.<name>` has `value`, `count` (bundles), `weight` (page views) and `metrics.<series>`. The entries are sorted, busiest first.

## Aggregates

`data.totals.<series>` and `entry.metrics.<series>` are aggregates:

- `sum` is the weighted total. Read it for `pageViews`, `visits` and the other counting series.
- `count` is the number of bundles for which the series returned a number, 0 included. For `lcp`, `cls`, `inp` and `ttfb` that is the sample size, because a bundle without the metric returns nothing. For a counting series it is every bundle, not the ones that were counted: `visits.count` is not the number of visits.
- `percentile(p)`, `median`, `min`, `max`, `mean`, `stddev` and `stderr` are over the values, each bundle counted once whatever its weight. `values` is the array.

## Filters

```javascript
data.filter = { userAgent: ['mobile'], url: ['https://www.example.com/', 'https://www.example.com/pricing'] };
data.filter = {}; // no filter
```

- `data.addFacet(name, fn, 'every')` makes a filter require all its values on a bundle.
- A fourth argument adds a negative facet with `!` after its name. Use `'never'`, which leaves out a bundle that has any of the values. `'none'` leaves out only the bundles that have all of them.

  ```javascript
  data.addFacet('device', (bundle) => [bundle.userAgent.split(':')[0]], 'some', 'never');
  data.filter = { 'device!': ['bot'] }; // no bots
  ```

- A facet is not narrowed by the filter on itself: with `{ userAgent: ['desktop'] }` set, `data.facets.userAgent` still lists `mobile`. Totals and the other facets are narrowed.

## Over time

```javascript
data.group((bundle) => bundle.timeSlot.slice(0, 10)); // one group per UTC day
const perDay = Object.entries(data.aggregates).sort(([a], [b]) => a.localeCompare(b));
const { slope } = stats.linearRegression(perDay.map(([, metrics]) => metrics.pageViews.sum)); // change per day
```

`data.aggregates[group][series]` is an aggregate as above. Call `group()` again after a change of the filter.

## Distributions and estimates

```javascript
data.addFacet('lcpValue', (bundle) => (bundle.cwvLCP === undefined ? [] : [bundle.cwvLCP]));
data.addHistogramFacet('lcpHistogram', 'lcpValue', { count: 4, steps: 'quantiles' }); // or 'linear', 'logarithmic'
```

- A histogram facet needs a base facet with numeric values. Its values are labels such as `<530` and `>=2,100`.
- `data.addClusterFacet('section', 'url', { count: 5 })` adds the most common path prefixes as values.
- `data.estimators.<facet>.chao1` estimates how many values a facet has beyond the ones in the sample: `sObs` seen, `sHat` estimated, `ci` its 95% interval. For `url` that is the number of pages with at least one page view.

## Statistics and helpers

| Function | Returns |
|---|---|
| `stats.samplingError(total, samples)` | The 95% margin of a weighted total: `stats.samplingError(pv.sum, pv.count)`. |
| `stats.roundToConfidenceInterval(total, samples)` | The total as text, rounded to the digits its margin supports: `16k`. |
| `stats.zTestTwoProportions(n1, hits1, n2, hits2)` | The two-sided p-value for a difference between two shares. |
| `stats.tTest(left, right)` | A one-sided p-value: near 0 when the mean of `left` is larger, near 1 when it is smaller, 0.5 when they are equal. |
| `stats.linearRegression(values)` | `slope` and `intercept`, with the array index as x. |
| `utils.scoreCWV(value, 'lcp')` | `good`, `ni` or `poor`; also for `cls`, `inp` and `ttfb`. `null` without a value. |
| `utils.scoreBundle(bundle)` | The worst rating among the metrics the bundle has. |
| `utils.computeConversionRate(hits, visits)` | A percentage, capped at 100. It is also 100 when `visits` is 0: check for that yourself. |
| `utils.toHumanReadable(16300)` | `16k`. |
| `data.hasConversion(bundle, { checkpoint: ['click'] })` | Whether one bundle matches a filter. Use it inside a series to count such page views. |

## A conversion rate

```javascript
// The visits of a period and those with a form submit: weighted, for the rate, and as
// numbers of bundles, for a test.
function conversion(rumBundles) {
  const data = new DataChunks();
  data.load([{ date: 'period', rumBundles }]);
  data.addFacet('checkpoint', facets.checkpoint);
  const submitted = (bundle) => bundle.visit && data.hasConversion(bundle, { checkpoint: ['formsubmit'] });
  data.addSeries('visits', series.visits);
  data.addSeries('submits', (bundle) => (submitted(bundle) ? bundle.weight : 0));
  data.addSeries('visitBundles', (bundle) => (bundle.visit ? 1 : 0));
  data.addSeries('submitBundles', (bundle) => (submitted(bundle) ? 1 : 0));
  const { visits, submits, visitBundles, submitBundles } = data.totals;
  return { rate: visits.sum ? submits.sum / visits.sum : null, visits: visitBundles.sum, submits: submitBundles.sum };
}

const [before, after] = [conversion(bundlesBefore), conversion(bundlesAfter)];
const pValue = stats.zTestTwoProportions(before.visits, before.submits, after.visits, after.submits);
```

The test takes numbers of bundles, so count them with a series that returns 1. The `count` of the weighted series is the same in every period and gives a p-value of 1 whatever changed.

The library has no test for a percentile. To test whether a p75 differs between two sets of values, take the p75 of both sets together, count the values above it in each set, and pass the four counts to `stats.zTestTwoProportions`. `scripts/optel-report.mjs` does that for two periods.
