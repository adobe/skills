# Performance budget: rules and a measurement without Chrome

Source for every rule here: [Keeping it 100](https://www.aem.live/developer/keeping-it-100) and the [AEM boilerplate](https://github.com/adobe/aem-boilerplate), read in November 2026. Check them again before you rely on a detail.

## The budget

- The rule of thumb is that the aggregate payload before the LCP is displayed stays below 100 KB. On the bandwidth that PageSpeed Insights simulates for mobile, that usually gives an LCP under 1560 ms, which is what scores 100.
- It is one budget for one host. A request to a second origin before LCP pays for a new connection as well.
- Early hints, HTTP/2 push, preconnect and preload are part of the budget: they download things that the LCP doesn't need.
- Lab results leave out redirects by default, but real visitors pay for each one. Report a redirect chain (`/` to `/en` to `/en/home`) as a separate finding.

## The three phases

| Phase | What loads | Counts against the budget |
|---|---|---|
| Eager | The HTML, `styles.css`, `aem.js`, `scripts.js`, then the whole first section: its blocks' CSS and JS, and its first image, which is the LCP candidate. | Yes |
| Lazy | Starts when the first section is shown: `fonts.css`, the other sections and their blocks, header and footer, `lazy-styles.css`, images as they scroll into view. Code the project controls, from the same origin. | No |
| Delayed | Third-party code: tag managers, analytics, consent, chat. The guideline is to start it at least three seconds after the LCP. | No |

The boilerplate takes the first `<img>` of the first section as the LCP candidate. When the real LCP element is not in the delivered HTML (it comes from a fragment, a JSON lookup or a service), the first block has to finish its changes to the DOM before the candidate is chosen. That lookup is then part of the budget.

## For comparison: the boilerplate

Measured with Lighthouse 13.6.0 on `https://main--aem-boilerplate--adobe.aem.live/` in November 2026, transfer bytes:

| Request | Bytes |
|---|---|
| LCP image (`width=750`, WebP) | 11,091 |
| `scripts/aem.js` | 6,751 |
| `favicon.ico` | 3,568 |
| HTML | 2,725 |
| `scripts/scripts.js` | 2,307 |
| `styles/styles.css` | 1,917 |
| CSS and JS of the two blocks in the first section | 2,335 |
| **Total** | **30,694** |

A project starts with about 70 KB of headroom. What a page has on top of these numbers is what the project added.

## Measuring with curl

Use this only when Lighthouse can't run. It gives sizes, not the LCP element and not the order of requests.

```bash
BASE="https://<branch>--<repo>--<owner>.aem.live"
for p in "<path>" /styles/styles.css /scripts/aem.js /scripts/scripts.js \
  /blocks/<block>/<block>.css /blocks/<block>/<block>.js "<lcp-image-path-and-query>"; do
  printf '%s\t%s\n' "$(curl -s --compressed -o /dev/null -w '%{size_download}' "$BASE$p")" "$p"
done
```

The LCP image comes from the user (DevTools or RUM). Take its URL with the query string from the `<source>` that matches a mobile viewport: the media pipeline sizes the image by `width`.
