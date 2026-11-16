# OpTel Interpreter: reference

Sources: [Operational Telemetry](https://www.aem.live/docs/operational-telemetry), [Developing Operational Telemetry](https://www.aem.live/developer/rum) and the open data of `emigrationbrewing.com`, read in November 2026. The library that reads bundles is in `rum-distiller.md`.

## What a bundle is

A bundle is one sampled page view. The bundle API returns `{ "rumBundles": [...] }` for a slot.

| Field | Meaning |
|---|---|
| `url` | The page, without query parameters. |
| `userAgent` | Device class, operating system and engine, for example `mobile:ios:webkit` or `desktop:windows:blink`. Bots are `bot:…`. |
| `weight` | How many page views this bundle stands for. 100 at the default sampling rate. |
| `time`, `timeSlot` | UTC. Minutes are rounded down to the hour. |
| `events` | Checkpoints of the page view, each with `checkpoint`, `timeDelta`, and often `source` and `target`. The `cwv-lcp`, `cwv-cls`, `cwv-inp` and `cwv-ttfb` events have the measurement in `value`. |

What `source` and `target` hold depends on the checkpoint:

| Checkpoint | `source` | `target` |
|---|---|---|
| `cwv-lcp` | Selector of the LCP element | URL of the LCP image |
| `cwv-cls` | Selector of an element that shifted | |
| `click` | Selector of the clicked element | Link target, if it was a link |
| `viewblock` | Class name of the block | |
| `viewmedia` | Selector of the element | URL of the image or video |
| `enter` | Referrer, empty for a direct visit | `visible` or `hidden`: whether the page opened in the foreground |
| `navigate` | The page of this site the visitor came from | `visible` or `hidden` |
| `reload`, `back_forward` | The page | `visible` or `hidden` |
| `paid` | The vendor, for example `google` | The click id parameter, for example `gclid` |
| `utm` | The parameter, for example `utm_source` | Its value |
| `error` | Where the unhandled JavaScript error came from | The error message |
| `missingresource` | URL that failed to load | HTTP status |
| `formsubmit` | The form | Form action |

A site can send checkpoints of its own. The `checkpoints` of the report list what a site sends. Look at the `source` and `target` of a checkpoint in the data before you interpret it.

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
Domain, period, device filter, page views with their margin, and one sentence on the state of the site. Name the slots that failed to load.

### Core Web Vitals

| Metric | p75 | Samples | Rating | Good share | Baseline p75 | Baseline samples | Changed |
|---|---|---|---|---|---|---|---|
| LCP | | | | | | | yes or not shown, with the p-value |
| LCP, page views with a click | | | | | | | |
| CLS (Chromium only) | | | | | | | |
| INP | | | | | | | |

Leave the baseline columns out when there is no baseline period.

### Pages that got worse
The entries of `change.pagesWorse`, when there is a baseline period.

### Pages to fix first
For each of the top entries of `pagesToFix`: the URL pattern, page views, the failing metric with p75 and samples, the likely cause, and the fix to try with `cwv-optimizer`.

### Devices and LCP elements
What differs between `mobile` and `desktop`, and which elements are the LCP.

### What the data can't say
Numbers with too few samples, slots that failed, metrics a browser doesn't report, and the pages that are not in the sample (`pagesEstimated` against `pagesSeen`).

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `HTTP 403` for every slot | The key is not valid for this domain. | Ask the user for the domain exactly as the Explorer shows it, and for the key of that domain. |
| `HTTP 404` | The path is not a month, day or hour. | Use `YYYY/MM`, `YYYY/MM/DD` or `YYYY/MM/DD/HH`. |
| Zero bundles | No sampled page view in that slot. | Try a month slot. |
| Every Core Web Vitals value is missing in a script of your own | `addCalculatedProps` did not run. | Run it on each bundle before `load()`. |
| `cls.samples` is far below `lcp.samples` | WebKit sends no CLS. | Report CLS as Chromium data. |
