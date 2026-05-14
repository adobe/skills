# Migrate output format

The contract `stardust:migrate` produces and **every downstream
consumer can rely on**. Authoring it as a separate reference (vs.
folding it into `artifact-map.md`) is deliberate: this is the
external interface — what changes here is a breaking change for
downstream tooling (AEM EDS conversion, CMS payload emit,
deploy-helper plugins, the user's own pipeline).

---

## Headline guarantee

The contents of `<project>/stardust/migrated/` are a **complete,
zip-and-deploy static site**.

Concretely:

1. `cd <project>/stardust/migrated && zip -r out.zip .` produces a
   zip that renders identically in three contexts: extracted
   onto a static host at the host root, extracted onto a host
   that serves it from any subpath, or opened directly via
   `file://`. No rewriting at deploy time.
2. The only external runtime dependencies are CDN-hosted URLs
   that are deliberately external — Google Fonts CSS + woff2,
   jsDelivr-hosted vendor JS libraries. These keep the bundle
   lightweight; the migrated site is network-dependent at view
   time for them.
3. No `../` segment in any `src`/`href`/`url()` reference
   escapes the migrated tree. Every internal reference is a
   depth-aware relative path that resolves either inside
   `migrated/` (static asset, internal page) or to an external
   scheme-bearing URL.

The `selfContained: true` field in `state.json.migrate` (§
State.json contract below) is the forward-compat signal —
downstream consumers test for it and refuse to operate on
bundles that pre-date this guarantee.

## Directory shape

```
stardust/migrated/
├── index.html                  # source / (home)
├── _meta.json                  # home's sidecar
├── beers/                      # source /beers/  -> beers/index.html
│   ├── index.html
│   └── _meta.json
├── about-us/                   # source /about-us/history.html -> about-us/history.html
│   ├── history.html            # (preserve .html leaf — no extra index.html)
│   ├── history._meta.json
│   └── team/                   # source /about-us/team/ -> about-us/team/index.html
│       ├── index.html
│       └── _meta.json
├── assets/
│   ├── logo.<ext>
│   ├── favicon.<ext>           # plus variants per metadata-and-jsonld.md § Favicon
│   ├── fonts/                  # font files (when --self-host-fonts ran via prepare-migration)
│   ├── media/                  # bundled media subpaths preserved verbatim
│   └── ...                     # arbitrary subpaths preserved (per asset-bundling.md)
├── robots.txt
└── sitemap.xml
```

Per-page output paths follow the URL-literal rule in
`skills/migrate/reference/migration-procedure.md` § Output path
mapping — the file lands at the source URL's literal path
(`/about-us/history.html` → `about-us/history.html`;
`/beers/` → `beers/index.html`). Asset subpaths preserve the
source structure verbatim per
`skills/migrate/reference/asset-bundling.md` § Copy.

## Asset reference shape

Every asset and internal-page reference in migrated HTML and
migrated CSS uses a **depth-aware relative path** computed per
`skills/migrate/reference/migration-procedure.md` § Reference
shape. The prefix is `./` for depth-0 pages (the root
`index.html`) and `../`.repeat(depth) for nested pages.

| Reference shape                                | Example (from `beers/index.html`, depth 1)        |
|------------------------------------------------|---------------------------------------------------|
| `<img src>` / `<img srcset>`                    | `src="../assets/hero.jpg"`                       |
| `<picture><source src>` / `<source srcset>`     | `srcset="../assets/hero-2x.jpg 2x"`              |
| `<link rel="icon">` / `<link rel="apple-touch-icon">` | `href="../assets/favicon.svg"`             |
| `<link rel="stylesheet" href="...">`            | `href="../assets/styles.css"`                    |
| Inline `style="background-image: url(...)"`     | `url('../assets/parallax-bg.jpg')`               |
| `@font-face src: url(...)` inside `<style>`     | `url('../assets/fonts/inter-var.woff2')`         |
| Internal page link `<a href>`                   | `href="../the-brewery/index.html"`               |

JSON-LD and OG-image `<meta content="...">` references are
**absolute URLs**, not relative, because search engines fetch
them by URL. They are composed per
`skills/migrate/reference/metadata-and-jsonld.md` § OG image
using `state.json.site.deployUrl`. The `<link rel="canonical">`
and `og:url <meta>` are likewise absolute (they identify the
page on the deploy host). Asset bundling and link rewriting
skip these.

Depth-aware relative was chosen so the bundle works **in three
contexts without rewriting at deploy time**:

- `file://`, opening `index.html` directly. Every link resolves
  because the prefix is computed from the file's own depth.
- Host root (`example.com/`). Relative paths work like
  webserver-served HTML.
- Subpath (`example.com/preview/`, `example.com/v2/`). Same.

The contract is **one shape, works everywhere**. There is no
alternative mode.

## `_meta.json` sidecar contract

Schema in `skills/migrate/reference/migration-procedure.md` §
`_meta.json` sidecar. The asset-bundling phase extends the
sidecar with one field:

```json
{
  "assetsBundled": 11
}
```

`assetsBundled` is the count of **unique asset references on
this page** — not the count of unique bundled files on disk
(which is a project-wide number, recorded under
`state.json.migrate.totalAssetsBundled`). A page that references
the same logo 5 times reports `assetsBundled: 1` plus the rest
of the page's references.

Missing-asset references are recorded as
`migrationDecisions[]` entries with
`kind: "asset-missing"` so downstream tools can surface the gap
without parsing the run report.

## State.json contract

`migrate` adds a top-level `migrate` block to `state.json` on
every successful run:

```json
{
  "_provenance": { "...": "..." },
  "site":        { "...": "..." },
  "direction":   { "...": "..." },
  "pages":       [ "..." ],
  "migrate": {
    "at":                  "2026-05-13T22:30:00Z",
    "outputDir":           "stardust/migrated/",
    "selfContained":       true,
    "pageMap": [
      { "sourceUrl": "/",                       "outputPath": "index.html",                 "slug": "home" },
      { "sourceUrl": "/about-us/history.html",  "outputPath": "about-us/history.html",      "slug": "about-us__history" },
      { "sourceUrl": "/beers/",                 "outputPath": "beers/index.html",           "slug": "beers" }
    ],
    "totalAssetsBundled":  14,
    "bundledAssets":       [
      "favicon.svg",
      "generated/hero-4x5.jpg",
      "..."
    ],
    "pages": [
      { "slug": "home",        "file": "stardust/migrated/index.html",                  "assetsBundled": 11 },
      { "slug": "about-us__history", "file": "stardust/migrated/about-us/history.html", "assetsBundled":  3 }
    ],
    "missingAssets": [
      {
        "subpath":      "generated/missing.jpg",
        "referencedBy": ["home"]
      }
    ],
    "cleanedAssets": []
  }
}
```

Field-by-field:

| Field                  | Type      | Meaning                                                               |
|------------------------|-----------|-----------------------------------------------------------------------|
| `at`                   | ISO 8601  | Run end timestamp.                                                    |
| `outputDir`            | string    | Project-relative path to the bundle root.                             |
| `selfContained`        | boolean   | Forward-compat signal. Always `true` after the 0.7.0 bundle PR; `false` (or absent) on older bundles. |
| `pageMap[]`            | object[]  | Source-URL-to-output-path map built once per run. Consumed by per-page rendering AND internal-link rewriting. Per `migration-procedure.md` § Page map. Each entry: `{ sourceUrl, outputPath, slug }`. |
| `totalAssetsBundled`   | integer   | Count of unique subpaths bundled into `<outputDir>/assets/`.          |
| `bundledAssets`        | string[]  | The unique subpath set. Used by re-runs to seed the dedup set and by `--clean` to compute stale assets. |
| `pages[].slug`         | string    | Slug from `state.json.pages[]`.                                       |
| `pages[].file`         | string    | Project-relative path to the migrated HTML file.                      |
| `pages[].assetsBundled`| integer   | Count of asset references on this page (per `_meta.json#assetsBundled`). |
| `missingAssets[]`      | object[]  | Subpaths the page referenced but were not present in `current/assets/`. Each entry lists the referencing page slugs. |
| `cleanedAssets[]`      | string[]  | Subpaths the `--clean` flag removed from the bundle in this run.      |

### Backwards compatibility

The `migrate` block is **net-new** — no prior stardust release
wrote it. Adding it is safe for every existing consumer:

- Consumers reading `state.json.pages[].migratedPath` continue to
  work (that field is untouched).
- Consumers reading `state.json.lastRun.failures[]` continue to
  work (that path is untouched).
- The `migrate` block sits at the top level alongside `site` /
  `direction` / `pages`; ordering convention is `_provenance`,
  `site`, `direction`, `pages`, `migrate`.

A consumer that depends on `selfContained: true` should also
test for the field's presence — older `state.json` files won't
have it.

**Provenance schema change.** This PR renames the
`contentDeviations[]` / `migrationDecisions[]` kind from
`"media-missing"` (used by pre-PR runs for image/video assets
not on disk) to `"asset-missing"` (used by post-PR runs for any
asset type). Consumers reading `_meta.json#migrationDecisions[]`
or per-page `contentDeviations[]` should accept either string
until they migrate; the union shape is `"media-missing" |
"asset-missing"`. The new name reflects the broader scope —
fonts, CSS-referenced URLs, srcset entries, and other non-media
references can now be flagged missing too, not just `<img>` /
`<video>` / `<source>`.

## Idempotency and incremental behaviour

The bundle is incremental — running migrate on a 5-page site
today and re-running it tomorrow after edits affects only the
pages whose source actually changed.

- The idempotent skip check (`migration-procedure.md` §
  Idempotent skip) gates per-page re-renders.
- A skipped page does NOT participate in asset bundling. Its
  prior HTML and prior bundled assets are left in place.
- The cross-page dedup set is **seeded** from
  `state.json.migrate.bundledAssets[]` at the start of each run.
  A re-run that re-renders only the home page still knows the
  shared logo is on disk and skips the copy.

## Stale asset cleanup

By default migrate is purely additive — assets that were once
referenced but aren't anymore remain in the bundle. The
`--clean` flag explicitly removes them. See
`skills/migrate/reference/asset-bundling.md` § Stale asset
cleanup for the algorithm.

`state.json.migrate.cleanedAssets[]` records what was deleted on
the most recent run.

## What this contract does NOT cover

- **HTML-level structure**, JSON-LD shape, canonical strategy —
  see `skills/migrate/reference/metadata-and-jsonld.md`.
- **Per-page provenance** — see
  `skills/migrate/reference/migration-procedure.md` § Provenance.
- **Data-attribute vocabulary** —
  `skills/stardust/reference/data-attributes.md`.
- **Validation contracts** —
  `skills/migrate/reference/template-and-module-rendering.md` §
  Validation contracts.
- **Deploy mechanics** — stardust ends at the migrated tree. A
  separate plugin/skill takes over for uploading.

## References

- `skills/migrate/reference/asset-bundling.md` — the bundling
  phase's detection/copy/rewrite contract; the source of truth
  for the asset reference shape this contract guarantees.
- `skills/migrate/reference/migration-procedure.md` — per-page
  render procedure, output path mapping, sidecar schema,
  idempotent skip.
- `skills/migrate/reference/metadata-and-jsonld.md` — head
  composition, OG/JSON-LD asset references.
- `skills/stardust/reference/artifact-map.md` — the project's
  full file inventory; this reference describes the contract for
  the `migrated/` subtree.
