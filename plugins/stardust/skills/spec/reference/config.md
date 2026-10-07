# spec.config.json

One file at the project root. Paths in the spec stages resolve against it; outputs go under `dir`.

| key | required | meaning |
|---|---|---|
| `site` | yes | display name shown in the viewer and the spec |
| `origin` | yes | `https://<host>` of the site under scope, no trailing slash |
| `scopePath` | yes | path prefix of the scope, e.g. `/en/` or `/<country>/<lang>/` |
| `dir` | no | output folder, default `stardust/spec` |
| `sitemaps` | no | sitemap URLs; default: robots.txt `Sitemap:` lines, else `/sitemap.xml` |
| `workers` | no | parallel requests for fetch, default 4 (be polite: the source is production) |
| `template` | yes | how a page names its template: `{ "bodyAttr": "data-template" }`, `{ "bodyClass": "^editable-(.+)$" }` (one capture group), or `{ "meta": "<name>" }`; add `"pathSegments": N` to append the first N path segments under scopePath when every page shares one template |
| `parser` | yes | `{ "profile": "aem-classic" \| "aem-core", "main": "<selector>", "chrome": { "header": "<selector>", "footer": "<selector>" } }` |
| `rum` | no | `{ "keyEnv": "RUM_DOMAIN_KEY", "domain": "<host>", "days": 90 }`; omit or null when no key exists |
| `referenceBlocks` | no | `{ "name": "<library>", "count": <n>, "source": "<where the blocks live>" }` — what reuse verdicts compare against |
| `viewer` | for S11 | `{ "worker", "d1", "r2", "url", "foundryEndpoint", "chatModel" }` |

## Choosing the template rule
Open two pages of different kinds and read `<body>`. Classic AEM pages often carry `data-template`; editable-template
sites carry the template in a body class; other CMSs expose a meta tag or a body class prefix. When nothing names the
template, use `{ "bodyClass": "^(.+)$" }` on a stable class, and let S8 variants do the grouping.

## Choosing the parser profile and main selector
- `aem-classic`: custom components with a `c-` class prefix inside `div.main.content`, column controls (`colctrl`).
- `aem-core`: Core Components / editable templates — components are responsive-grid members (`aem-GridColumn`);
  main is usually the page's main container (`#mainContent`, `main`, `.root > .aem-Grid`).
- Check with `spec-parse.mjs --fetch <40 rows>` and `spec-profile.mjs`: the vocabulary must be component types, not
  style classes, and `has_main` true on every page. A new CMS family is a new profile in `spec-parse.mjs` (root
  rule + column rule) and the same rule in `spec-capture.mjs`'s tagger; the contract (reference/parsers in
  spec-parse's header) does not change.
