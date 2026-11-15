# OpTel Interpreter: reference

Sources: [Operational Telemetry](https://www.aem.live/docs/operational-telemetry), [Developing Operational Telemetry](https://www.aem.live/developer/rum) and `@adobe/rum-distiller` 1.24.0, read in November 2026.

## What a bundle is

A bundle is one sampled page view. The bundle API returns `{ "rumBundles": [...] }` for a slot.

| Field | Meaning |
|---|---|
| `url` | The page, without query parameters. |
| `userAgent` | Device class, operating system and engine, for example `mobile:ios:webkit` or `desktop:windows:blink`. Bots are `bot:…`. |
| `weight` | How many page views this bundle stands for. 100 at the default sampling rate. |
| `time`, `timeSlot` | UTC. Minutes are rounded down to the hour. |
| `events` | Checkpoints of the page view, each with `checkpoint`, `timeDelta`, and often `source` and `target`. |

What `source` and `target` hold depends on the checkpoint:

| Checkpoint | `source` | `target` |
|---|---|---|
| `cwv-lcp` | Selector of the LCP element | URL of the LCP image |
| `click` | Selector of the clicked element | Link target, if it was a link |
| `viewblock` | Class name of the block | |
| `viewmedia` | Selector of the element | URL of the image or video |
| `enter` | Referrer, empty for a direct visit | `visible` or `hidden`: whether the page opened in the foreground |
| `navigate` | The page of this site the visitor came from | `visible` or `hidden` |
| `error` | Where the unhandled JavaScript error came from | The error message |
| `missingresource` | URL that failed to load | HTTP status |
| `formsubmit` | The form | Form action |

A site can send checkpoints of its own. List what a site sends with `facets.checkpoint` before you interpret one.

## The library

`utils.addCalculatedProps(bundle)` must run on every bundle before it is loaded. It sets `cwvLCP`, `cwvCLS`, `cwvINP`, `cwvTTFB` and `visit`. Without it every Core Web Vitals series is empty.

```javascript
import { DataChunks, series, facets, utils } from '@adobe/rum-distiller';

const data = new DataChunks();
data.load([{ date: '2026/10', rumBundles }]); // after addCalculatedProps
data.addSeries('pageViews', series.pageViews);
data.addSeries('lcp', series.lcp);
data.addFacet('url', facets.url);
data.filter = { url: ['https://www.example.com/'] }; // values of one facet are ORed, facets are ANDed
console.log(data.totals.lcp.percentile(75), data.totals.lcp.count);
for (const facet of data.facets.url) console.log(facet.value, facet.metrics.pageViews.sum);
```

- Series: `pageViews`, `visits`, `bounces`, `engagement`, `organic`, `earned`, `lcp`, `cls`, `inp`, `ttfb`.
- Facets: `url`, `plainURL`, `userAgent`, `checkpoint`, `vitals`, `lcpSource`, `lcpTarget`, `acquisitionSource`, `enterSource`, `mediaTarget`. A facet can also be a function from a bundle to an array of strings.
- An aggregate (`data.totals.<series>` or `facet.metrics.<series>`) has `sum` (weighted, for page views and visits), `count` (number of values, the sample size), `percentile(p)`, `min`, `max`, `median` and `mean`.
- `utils.scoreCWV(value, 'lcp' | 'cls' | 'inp' | 'ttfb')` returns `good`, `ni` or `poor`.
- `userAgent` facet values are cumulative: a bundle from `mobile:ios:webkit` counts under `mobile`, `mobile:ios` and `mobile:ios:webkit`.

## Causes by metric

Typical causes on Edge Delivery Services for LCP and INP. For CLS this file has none: go to `cwv-optimizer`. Confirm each one on the page before you report it as the cause.

### LCP

- The LCP element is not what the page loads first. The boilerplate treats the first image of the first section as the LCP candidate. Compare with `lcpElements`.
- The first section holds many blocks. All of them load before LCP.
- Third-party scripts or fonts load before LCP instead of in the lazy or delayed phase.
- A redirect or a slow CDN in front of the site. Compare LCP on the production host with the `.aem.live` host.
- An LCP that is much worse on `mobile` than on `desktop` points at the bytes before LCP, because mobile has less bandwidth.

### INP

- Observation and mutation listeners (`MutationObserver`, `IntersectionObserver`, `ResizeObserver`) that do work on every change during decoration. This is common and easy to overlook.

## Report template

### Summary
Domain, slots, device filter, page views, and one sentence on the state of the site. Name the slots that failed to load.

### Core Web Vitals

| Metric | p75 | Samples | Rating | Compared with the other period |
|---|---|---|---|---|
| LCP | | | | |
| LCP, page views with a click | | | | |
| CLS (Chromium only) | | | | |
| INP | | | | |

### Pages to fix first
For each of the top entries of `pagesToFix`: the URL pattern, page views, the failing metric with p75 and samples, the likely cause, and the fix to try with `cwv-optimizer`.

### Devices and LCP elements
What differs between `mobile` and `desktop`, and which elements are the LCP.

### What the data can't say
Numbers with too few samples, slots that failed, and metrics a browser doesn't report.

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `HTTP 403` for every slot | The key is not valid for this domain. | Ask the user for the domain exactly as the Explorer shows it, and for the key of that domain. |
| `HTTP 404` | The path is not a month, day or hour. | Use `YYYY/MM`, `YYYY/MM/DD` or `YYYY/MM/DD/HH`. |
| Zero bundles | No sampled page view in that slot. | Try a month slot. |
| Every Core Web Vitals value is missing | `addCalculatedProps` did not run. | Run it on each bundle before `load()`. |
| `cls.samples` is far below `lcp.samples` | WebKit sends no CLS. | Report CLS as Chromium data. |
