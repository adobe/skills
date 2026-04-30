# Metadata and JSON-LD

How `migrate` composes each migrated page's `<head>`. Five
categories of metadata, each with a defined source and treatment.
JSON-LD emission per page-type. Canonical strategy.

## Categories

| Category                     | Source                                          | Treatment                          |
|------------------------------|-------------------------------------------------|------------------------------------|
| **System-fixed**             | Migrate emits identically                       | Stamped on every page              |
| **Brand-level**              | `DESIGN.json.extensions.metadata`               | Composed once; reused              |
| **Page-specific, preserved** | `current/pages/<slug>.json § metadata`          | Preserved verbatim                 |
| **Page-specific, derived**   | Computed from page type + slot content          | Generated at migrate time          |
| **Stripped**                 | Drop list                                       | Removed regardless of source       |

## System-fixed

Identical on every migrated page:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="/site.webmanifest">
```

The viewport and charset are baseline. The manifest link assumes a
manifest file exists; if `prepare-migration` Phase 4 didn't
generate one, omit the manifest link.

## Brand-level (from DESIGN.json.extensions.metadata)

Captured during `direct --prep`:

```json
"metadata": {
  "siteName":       "The Road Home",
  "defaultOgImage": "/assets/og-default.jpg",
  "themeColor":     "#008192",
  "organization":   { "@type": "Organization", "name": "The Road Home", "...": "..." },
  "locale":         "en-US"
}
```

Migrate emits:

```html
<meta name="theme-color" content="#008192">
<meta property="og:site_name" content="The Road Home">
<meta property="og:locale" content="en-US">

<!-- Organization JSON-LD on every page -->
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"The Road Home","url":"https://theroadhome.org","..." :"..."}</script>
```

## Page-specific, preserved

From `current/pages/<slug>.json § metadata`. Preserved verbatim —
the redesign restyles, doesn't rewrite copy:

```html
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{og.title}">
<meta property="og:description" content="{og.description}">
<meta property="og:image" content="{og.image || brand.defaultOgImage}">
<meta property="og:type" content="{og.type || 'website'}">
<meta name="twitter:card" content="{twitter.card}">
<meta name="twitter:title" content="{twitter.title}">
<meta name="twitter:description" content="{twitter.description}">
<meta name="twitter:image" content="{twitter.image || og.image}">
<meta name="robots" content="{robots || 'index,follow'}">
```

Plus on the `<html>` element:

```html
<html lang="{lang || 'en'}" dir="{dir || 'ltr'}">
```

## Page-specific, derived

### Canonical

```html
<link rel="canonical" href="{canonical}">
```

Strategy:

- If `state.json.site.deployUrl` is set → rewrite canonical to
  the deploy URL space:
  `https://{deployUrl}/{slug-path}/`
- If `deployUrl` is unset → preserve the original canonical from
  `current/pages/<slug>.json § metadata.canonical` (typically
  pointing back to the live origin). For presales/staging
  contexts where the migrated tree isn't deployed, this
  attributes search-engine signals back to the live site
  correctly.

### Favicon

```html
<link rel="icon" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/favicon-512.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
```

Variants generated during `prepare-migration` Phase 4 from the
canonical favicon at `stardust/current/assets/favicon.<ext>`.

### JSON-LD by page-type

Always emit when page-type is known. Composition rules:

| Page type | JSON-LD `@type`        | Source of properties                                                         |
|-----------|------------------------|------------------------------------------------------------------------------|
| `landing` | `WebSite` (optional)   | DESIGN.json.extensions.metadata + page slots                                 |
| `article` | `Article`              | Page slots: headline, byline (author), datePublished, image, articleBody     |
| `listing` | `ItemList`             | Card-grid slot content                                                       |
| `program` | `Service` or custom    | Program-specific slots                                                       |
| `static`  | Extends `Organization` | Brand-level org schema + page-specific properties                            |
| `form`    | `Action` (optional)    | Form schema                                                                  |
| `unique`  | None (or fallback)     | Skip JSON-LD by default                                                      |

Each page-type's emission rule lives here; future expansion
(FAQPage, Event, BreadcrumbList, HowTo) is additive.

#### Article schema example

For an `article`-typed page with filled slots:

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{slot:article-headline}",
  "datePublished": "{slot:article-meta.date}",
  "author": {
    "@type": "Person",
    "name": "{slot:article-byline}"
  },
  "image": "{slot:article-lead-image.src}",
  "publisher": {
    "@type": "Organization",
    "name": "{brand.metadata.organization.name}",
    "logo": "{brand.metadata.organization.logo}"
  },
  "articleBody": "{slot:article-body — text-only excerpt}"
}
```

Emit as `<script type="application/ld+json">` in `<head>`.

#### Listing schema example

For a `listing`-typed page:

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "...", "url": "..." },
    { "@type": "ListItem", "position": 2, "name": "...", "url": "..." }
  ]
}
```

URL fields use the migrated tree paths (root-relative).

### Sitemap entry

Each migrated page contributes one entry to
`stardust/migrated/sitemap.xml`:

- `<loc>` — the page's canonical migrated path
- `<lastmod>` — the page's `_meta.json.migratedAt`
- `<priority>` — derived from page type
  (`landing`: 1.0; `static`/`program`: 0.7; `listing`: 0.6;
   `article`: 0.5; `form`: 0.4; `unique`: 0.3)

## Stripped

Always removed regardless of presence in current page metadata:

- All Google Tag Manager tags (`gtag`, `dataLayer`, GTM container)
- Facebook Pixel, LinkedIn Insight, Twitter Pixel
- Hotjar, FullStory, LogRocket, Mixpanel, Segment
- OneTrust, Cookiebot, TrustArc, Iubenda — all consent banner
  scripts and configuration
- Intercom, Drift, Zendesk Chat — all chat widget loaders
- A/B test SDKs (Optimizely, Google Optimize, LaunchDarkly)
- `<meta name="generator">` if it identifies WordPress, Webflow,
  Wix, etc. (the migrated page is not those)

The drop list is comprehensive but not exhaustive. The principle:
**if it's a runtime third-party script or tag, drop it**. Re-wire
at deploy time as a separate concern.

## Voice/tone for metadata copy

Same rule as microcopy: **default preserve**. A description tag is
content; the redesign restyles, doesn't rewrite. Only refine if
`DESIGN.json.narrative.dos` explicitly authorises tone-driven
metadata refinement, and log every refinement in
`migrationDecisions[]` as a `metadata-override` entry.

## Per-page overrides

When the user wants a per-page override (e.g., "the about page
gets a different OG image than the brand default"), they edit
`current/pages/<slug>.json § metadata.override`:

```json
"metadata": {
  "...": "...",
  "override": {
    "og.image": "/assets/about-og.jpg"
  }
}
```

Migrate respects overrides; logs each as a `metadata-override`
decision. The override mechanism is lazy — only added when the
user explicitly requests it; no UI prompts proactively.

## Validation

Strict (refuse-on-fail):

- `<title>` present and non-empty
- `<meta name="description">` present (if current page had one)
- Canonical resolves to a valid URL or path
- Required JSON-LD properties present per page-type (e.g.,
  `article` requires `headline` and `datePublished`)

Soft (log):

- Missing OG image (falls back to brand default; logged)
- Missing favicon variants (uses canonical; logged)
- JSON-LD properties whose source slots are empty (omit the
  property; log)

## References

- `skills/migrate/SKILL.md` — top-level migrate procedure
- `skills/migrate/reference/template-and-module-rendering.md` —
  render path selection (where this metadata gets emitted)
- `skills/migrate/reference/content-preservation.md` — content
  rules (this doc handles head; that doc handles body)
- `skills/direct/SKILL.md` § Prep mode — where brand-level
  metadata is captured
- `skills/stardust/reference/state-machine.md` — `deployUrl`
  configuration on `state.json.site`
