# spec.config.json

One file at the project root. Paths in the spec stages resolve against it; outputs go under `dir`. Keys not listed
here are ignored, so a consumer (for example a viewer's deploy script) may keep its own settings in the same file.

| key | required | meaning |
|---|---|---|
| `site` | yes | display name, written to `meta.site_name` |
| `origin` | yes | `https://<host>` after redirects (S1 stops and names the final origin otherwise), no trailing slash |
| `scopePath` | yes | path prefix of the scope, e.g. `/en/` or `/<country>/<lang>/` |
| `dir` | no | output folder, default `stardust/spec` |
| `sitemaps` | no | sitemap URLs; default: robots.txt `Sitemap:` lines, else `/sitemap.xml`; none in scope → a link crawl from scopePath |
| `maxPages` | no | cap on the URLs every stage covers; above it S1 keeps an even sample per section and the spec says so |
| `workers` | no | parallel requests for fetch, default 4 (be polite: the source is production); `--headed` runs one page at a time, `--archive` two |
| `template` | yes | how a page names its template: `{ "bodyAttr": "data-template" }`, `{ "bodyClass": "^editable-(.+)$" }` (one capture group), or `{ "meta": "<name>" }`; `"pathSegments": N` appends the first N path segments under scopePath (alone, it is the whole template name) |
| `parser` | yes | `{ "profile": "aem-classic" \| "aem-core" \| "generic", "main": "<selector>", "chrome": { "header": "<selector>", "footer": "<selector>" }, "nameAttrs": [], "stripPrefix": "<regex>" }`; the last two only for generic |
| `rum` | no | `{ "keyEnv": "RUM_DOMAIN_KEY", "domain": "<host>", "days": 90 }`; omit or null when no key exists |
| `referenceBlocks` | no | `{ "name": "<library>", "count": <n>, "source": "<where the blocks live>" }` — what reuse verdicts compare against |

## Choosing the template rule
Open two pages of different kinds and read `<body>`. Classic AEM pages often carry `data-template`; editable-template
sites carry the template in a body class; other CMSs expose a meta tag or a body class prefix. When nothing names the
template, use `{ "pathSegments": 1 }` and let S8 variants do the grouping.

## Choosing the parser profile and main selector
- `aem-classic`: custom components with a `c-` class prefix inside `div.main.content`, column controls (`colctrl`).
- `aem-core`: Core Components / editable templates — components are responsive-grid members (`aem-GridColumn`);
  main is usually the page's main container (`#mainContent`, `main`, `.root > .aem-Grid`).
- `generic`: any other site. Below main, single-child wrappers are skipped and the children are the components,
  named from a component attribute, a block-style class (`wp-block-*`, `elementor-widget-*`, `paragraph--type--*`),
  the block of a BEM or CSS-module class, else a shape label (`section.h2.list`, `div.media`) where classes are only
  utilities. Without `main`, the chain `main`, `[role=main]`, `#main`, `#content`, `#main-content`, `article`, then
  the body without header/footer/nav. Tune with `nameAttrs` (attributes the site uses for component names) and
  `stripPrefix` (a hash prefix that makes the same component look different per page).
- Check with `spec-parse.mjs --fetch <40 rows>` and `spec-profile.mjs`: the vocabulary must be component types, not
  style classes, and `has_main` true on every page. A new CMS family is a new profile in `lib.mjs` `profileRules` (a root
  rule or structural roots, optional columns and row widths): spec-parse and the spec-capture tagger both run it through
  `componentLayout`, so path ids cannot drift; the node contract in spec-parse's header does not change.
