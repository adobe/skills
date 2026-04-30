# Brand surface

The shape of `stardust/current/_brand-extraction.json` and the
procedure that produces it. Run once per `extract` invocation, **after
Phase 2 has finished** so cross-page aggregation has data to work with.

Some fields are sourced from the home page only (logo, voice samples,
hero-specific copy). Others must be aggregated across **all extracted
pages** to avoid the home-page bias documented in § Aggregation scope.

The brand surface is the descriptive ground truth for **what the
existing site looks and feels like at the brand level**. It is the
input both to direct authoring of `stardust/current/PRODUCT.md` and
`DESIGN.md` (Phase 4 of `extract`) and to the `direct` sub-command
when it later reasons about how far to move from the current brand.

Stardust **does not invent** brand-surface values. Every value is
either captured directly from the page or aggregated from captured
values, and carries a source citation.

---

## File shape

```json
{
  "_provenance": {
    "writtenBy": "stardust:extract",
    "writtenAt": "2026-04-25T13:50:00Z",
    "readArtifacts": [
      "https://example.com/",
      "stardust/current/pages/home.json"
    ],
    "synthesizedInputs": [],
    "stardustVersion": "0.2.0"
  },
  "site": {
    "name": "Example",
    "tagline": "...",
    "originUrl": "https://example.com"
  },
  "logo": { /* see § Logo */ },
  "palette": [ /* see § Palette */ ],
  "type": { /* see § Type */ },
  "spacing": { /* see § Spacing */ },
  "motifs": { /* see § Motifs */ },
  "componentStyle": { /* see § Component style */ },
  "systemComponents": [ /* see § System components */ ],
  "voice": { /* see § Voice */ },
  "voiceTable": { /* see § Voice table */ },
  "crossPromo": { /* see § Cross-promo */ },
  "register": "brand"             // "brand" | "product" | "ambiguous"
}
```

---

## § Aggregation scope

Each field below is sourced from one of two scopes:

| scope | fields | rationale |
|---|---|---|
| home-only | `logo`, `voice.heroHeadline`, `voice.heroSubcopy`, `voice.primaryCTALabel`, `voice.firstParagraph`, `register` | These are the landing surface; aggregating across pages would dilute, not clarify |
| cross-page | `palette`, `type` (sizes, weights, families used), `spacing`, `motifs.borderRadius`, `motifs.shadows`, `motifs.gradients`, `componentStyle`, `voice.ctaSamples`, `voice.navItems`, `voice.footerHeadings` | Home-only readings are biased by hero/CTA-heavy markup; the dominant motif on the site as a whole is what `direct` needs |

Cross-page aggregation rules:

1. Read every `stardust/current/pages/<slug>.json` produced in Phase 2.
2. For each numeric/categorical value (border-radius, shadow string,
   font-size, padding, etc.), build a frequency table weighted by
   element count, **not** page count — so a page with 30 cards
   contributes 30 radii, not 1.
3. Pick the mode (most frequent) as the `primary` value; second mode
   as `secondary`; pill-radius (≥9999px or ≥50% on a square element)
   captured separately as `pill` if present.
4. For each captured value, record the top 3 source pages in
   `sources` so the agent can verify and `direct` can reason about
   "where this motif lives."

If a field's mode-on-home and mode-cross-page disagree, prefer the
cross-page value and surface the divergence in `_provenance.notes`
(e.g. `"home suggested borderRadius=150px (pill, buttons-only); cross-page mode is 3px (cards/inputs/chips, 122 occurrences)"`).
This divergence note is the single most important hint for `direct`
when deciding whether to keep, soften, or replace the existing motif.

## § Logo

```json
{
  "source": "inline-svg",          // one of: inline-svg | img | apple-touch-icon | og-image | favicon | synthesized
  "sourceSelector": "header svg",  // CSS selector or URL — null only for synthesized
  "localPath": "stardust/current/assets/logo.svg",
  "format": "svg",                 // svg | png | jpg | ico
  "intrinsicWidth": 180,
  "intrinsicHeight": 32,
  "synthesized": false,
  "synthesizedBasis": null         // e.g. "Brand initials EX, derived from page title"
}
```

Locator priority chain in `playwright-recipe.md` § Logo locator chain.
First hit wins.

## § Palette

Aggregated computed colors from across **all extracted pages** (see
§ Aggregation scope). Frequency-sorted, near-duplicates clustered,
role-named.

```json
[
  {
    "role": "background",
    "value": "#ffffff",
    "occurrences": 3421,           // pixels weighted by element area
    "sourceSelectors": ["body", ".container", ".hero"]
  },
  {
    "role": "text-primary",
    "value": "#0f1217",
    "occurrences": 894,
    "sourceSelectors": ["h1", "h2", "p"]
  },
  {
    "role": "primary",
    "value": "#147aff",
    "occurrences": 412,
    "sourceSelectors": [".btn-primary", "a"],
    "sources": ["home", "pricing", "donate"],
    "usedAs": ["background", "border", "fill"]
  },
  {
    "role": "surface",
    "value": "#f7f8fa",
    "occurrences": 280,
    "sourceSelectors": [".card", "section.alt"]
  },
  {
    "role": "border",
    "value": "#e5e7eb",
    "occurrences": 156,
    "sourceSelectors": [".card", "input"]
  }
]
```

Aggregation rules:

- **Discard non-colors before aggregation.** `rgba(*, 0)`,
  `rgba(0, 0, 0, 0)`, the literal string `transparent`, and any
  CSS color whose alpha channel is 0 are not colors — they are
  "no color." If a section's `background-color` resolves to one
  of these, the section inherits its parent's effective background;
  the transparent value must not enter the palette aggregation.
  Picking up `rgba(255, 255, 255, 0)` as a `surface` role with high
  occurrence count (because most elements default to transparent
  backgrounds in CSS) is a real bug observed on
  theroadhome.org (`STARDUST-FEEDBACK.md F-003`).
- Cluster colors within `ΔE < 5` (CIE76 in Lab space) and pick the
  most frequent member as the cluster representative.
- Pure `#000` and `#fff` are kept verbatim — do **not** silently tint
  them. Stardust's job here is descriptive, not corrective. The
  divergence toolkit (in `direct`) will flag pure black/white when
  the redesign target rejects them.
- Role names are heuristic: most-frequent background-color → `background`;
  most-frequent text color → `text-primary`; most-frequent
  background-color on `[role="button"]` and `.btn-*` → `primary`; etc.
  When a role can't be assigned, use `accent-N` with `N` ascending.
- Cap the palette at 8 entries. If the site uses more, keep the top 8
  by occurrences and record the dropped colors in `_provenance.notes`.
- Track **usage context** per color in `usedAs`: a deduped list drawn
  from `{ "background", "text", "border", "fill", "stroke", "outline" }`
  reflecting which CSS properties this color appeared as across the
  crawl. A color that appears only as `text` and never as
  `background`/`border`/`fill` is the signal the Tensions detector
  uses for color-imbalance flagging
  (`brand-review-template.md` § Detectors).

## § Type

```json
{
  "headingFamily": {
    "name": "Söhne",
    "stack": "\"Söhne\", system-ui, sans-serif",
    "weights": [400, 600, 700],
    "sizes": ["clamp(2rem, 5vw, 3.5rem)", "2.25rem", "1.75rem"],
    "lineHeights": [1.1, 1.15, 1.2],
    "letterSpacing": ["-0.02em", "-0.015em", "-0.01em"],
    "sourceSelectors": ["h1", "h2"]
  },
  "bodyFamily": {
    "name": "Inter",
    "stack": "\"Inter\", system-ui, sans-serif",
    "weights": [400, 500],
    "sizes": ["1rem", "0.9375rem", "0.8125rem"],
    "lineHeights": [1.5, 1.55, 1.4],
    "letterSpacing": ["normal"],
    "sourceSelectors": ["p", "li", "label"]
  },
  "monoFamily": null,
  "scaleRatio": 1.25,              // see § Modular-scale audit below; null if ad-hoc
  "scaleAudit": {
    "kind": "modular",             // "modular" | "ad-hoc"
    "ratios": [1.25, 1.25, 1.20],
    "matchedScale": "major-third"  // null when kind == "ad-hoc"
  },
  "loadStrategy": "swap"            // detected from font-display in @font-face rules
}
```

Identify heading vs body by which family appears in the heading
outline (`pages/<slug>.json` § Headings) most often. If only one
family is in use, set both `headingFamily` and `bodyFamily` to it
with disjoint weights.

### Type-size aggregation

Per-level heading sizes are picked by **weighted score**, not
mode-of-frequency:

`score = pixelSize × (fontWeight / 400) × √count`

For each heading level present in the crawl, group captured headings
by `(fontSize, fontWeight)` tuple, compute the score per group, and
emit the top-scoring group's `fontSize` and `fontWeight` as that
level's representative.

Rationale: WordPress / SEO-plugin patterns ship hidden semantic H1s
on every page (e.g. `position: absolute; clip: rect(0 0 0 0)`).
Mode-of-size lets 20 hidden 18px H1s outweigh 2 visible 60px hero H1s
by raw count. The pixel-and-weight scoring biases toward the
visually-dominant variant — the display H1 is large *and* heavy *and*
repeated visibly across the site, so it always outranks accessibility
scaffolding under this rule.

This rule applies to per-level size selection in
`type.headingFamily.sizes[]`. Mode-of-frequency continues to apply
to motif aggregation (border-radius, shadow) per the rules in
§ Aggregation scope.

### Modular-scale audit

After heading sizes are collected, compute the ratio between every
consecutive pair (largest → smallest, in px). Compare each ratio to
the canonical scale set:

| name | ratio |
|---|---|
| minor-second | 1.067 |
| major-second | 1.125 |
| minor-third | 1.200 |
| major-third | 1.250 |
| perfect-fourth | 1.333 |
| augmented-fourth | 1.414 |
| perfect-fifth | 1.500 |
| golden | 1.618 |

If **every** observed ratio is within ±0.025 of the same canonical
ratio, set `scaleAudit.kind = "modular"`, `matchedScale = <name>`, and
`scaleRatio = <ratio>`.

Otherwise set `scaleAudit.kind = "ad-hoc"`, `matchedScale = null`,
`scaleRatio = null`, and list the observed ratios verbatim in
`scaleAudit.ratios`. Page-builder sites (Elementor, Webflow, Squarespace)
frequently end up here — large uneven jumps like 14 → 18 → 20 → 32 → 45 → 60.

`direct` reads `scaleAudit.kind` to decide whether the redesign target
should adopt a modular scale by default.

## § Spacing

```json
{
  "baseUnit": 4,                   // 4 | 8 — inferred from mode of paddings/gaps
  "scale": [4, 8, 12, 16, 24, 32, 48, 64, 96],
  "sectionPadding": "96px",
  "containerMaxWidth": "1280px",
  "gridGap": "24px"
}
```

If the existing site lacks rhythm (paddings are arbitrary, no
detectable scale), set `scale: []` and `baseUnit: null` — the
divergence toolkit will flag this in `direct`.

## § Motifs

Signature visual moves the existing site uses repeatedly.
`borderRadius`, `shadows`, and `gradients` are aggregated cross-page
per § Aggregation scope; `patterns` is observed where it occurs and
labelled with the page list in `evidence`.

```json
{
  "borderRadius": {
    "primary": "8px",              // mode of non-zero border-radii across all pages, weighted by element count
    "secondary": "16px",
    "pill": "9999px",
    "primarySources": ["home", "about", "stories"],
    "occurrences": { "8px": 122, "16px": 53, "9999px": 38, "2px": 30 }
  },
  "shadows": [
    { "value": "0 1px 2px rgba(0,0,0,0.06)", "uses": "buttons" },
    { "value": "0 4px 16px rgba(0,0,0,0.08)", "uses": "cards" },
    { "value": "0 24px 48px rgba(0,0,0,0.12)", "uses": "modals" }
  ],
  "gradients": [
    { "value": "linear-gradient(135deg, #147aff 0%, #6b21ff 100%)", "uses": "hero-background" }
  ],
  "patterns": [
    { "name": "card-grid",         "evidence": "3 sections use 3-column repeat-cards" },
    { "name": "hero-with-image",   "evidence": "home hero uses split-half image+copy" },
    { "name": "social-proof-strip", "evidence": "logo strip after hero" }
  ]
}
```

Patterns is the open-ended one. Common values to watch for: `card-grid`,
`hero-with-image`, `hero-with-illustration`, `feature-3up`, `feature-list`,
`stat-row`, `pricing-3up`, `social-proof-logos`, `testimonial-carousel`,
`cta-band`, `footer-mega`, `nav-mega`. Add new pattern names freely;
this is descriptive.

## § Component style

The v1 fields, preserved so nothing is lost when DESIGN.json's
`extensions` block carries them forward.

```json
{
  "buttons": {
    "primary": {
      "background": "#147aff",
      "color": "#ffffff",
      "borderRadius": "8px",
      "padding": "12px 24px",
      "fontWeight": 600,
      "shadow": "0 1px 2px rgba(0,0,0,0.06)",
      "hoverDelta": "lighten 6%"
    },
    "secondary": { /* ... */ },
    "ghost": { /* ... */ }
  },
  "dualCTAPattern": "primary-then-secondary-link",  // observed if both appear together; null otherwise
  "cards": { "background": "#f7f8fa", "borderRadius": "12px", "padding": "24px", "shadow": null, "border": "1px solid #e5e7eb" },
  "inputs": { "borderRadius": "8px", "padding": "10px 12px", "border": "1px solid #d1d5db", "focusRing": "0 0 0 3px rgba(20,122,255,0.2)" }
}
```

## § System components

Cross-page repeated DOM blocks. These are almost always the most
load-bearing surfaces of the site (site header, site footer,
cross-promo strips, persistent CTAs, breadcrumbs). Missing them at
the brand-surface stage means `direct` cannot decide deliberately
whether to keep, move, or kill them — they silently disappear from
the redesign target.

```json
[
  {
    "name": "site-header",
    "kind": "header",                // header | footer | cross-promo | nav-secondary | sidebar | cta-band | breadcrumb | background-motif | other
    "occurrences": 12,                // pages where it appears (out of pages crawled)
    "headingSequence": ["About", "Stories", "Donate"],
    "ctaLabels": ["Donate now"],
    "domFingerprintHash": "sha256:...",
    "exampleSlug": "home",            // representative page; the verbatim block lives on this slug
    "exampleSelector": "header > nav.primary",
    "examplePages": ["home", "about", "stories"]
  }
]
```

Detection algorithm (heading-sequence diff, the cheap version that
captures ~80% of the value):

1. For each extracted page, build a fingerprint from each landmark:
   `(landmark tag, ordered list of immediate-child heading texts +
   CTA labels)`.
2. Group fingerprints across pages. Any fingerprint that appears on
   **≥ 3 pages** (or ≥ 50% of pages crawled, whichever is smaller — so
   small crawls still surface obvious system blocks) is a system
   component.
3. Classify with the `kind` heuristic:
   - landmark `header` / `[role="banner"]` → `header`
   - landmark `footer` / `[role="contentinfo"]` → `footer`
   - sequence contains 3+ navigation links + 1+ CTA on interior pages
     but not home → `cross-promo`
   - landmark `nav` not in header/footer → `nav-secondary`
   - landmark `aside` / `[role="complementary"]` → `sidebar`
   - large CTA-only block repeated above the footer → `cta-band`
   - ordered links matching `Home > Section > Page` → `breadcrumb`
   - else → `other`
4. Capture one verbatim example block (HTML serialised from
   `exampleSlug` at `exampleSelector`) so `direct` and `prototype` can
   reason about the actual content, not just the structure.

### Cross-page CSS-background reuse

Beyond DOM-fingerprint repeats, also detect **shared CSS background
images** across pages. A background image used on home AND on
about-us is almost always a system motif (a recurring banner, a
brand-photo treatment, a section ground) — not page-specific
content.

Algorithm:

1. Read every `pages/<slug>.json#media.cssBackgrounds[].url` across
   the crawl (after `playwright-recipe.md` capture step 11).
2. Group by URL (case-sensitive, full URL match).
3. For each URL appearing on **≥ 2 pages**, emit a system-component
   entry with `kind: "background-motif"`, `occurrences` = page
   count, `examplePages` = the page slugs.
4. The `exampleBlock` for a background-motif entry is the
   `domPath` + `boundingClientRect` + `backgroundSize` /
   `backgroundPosition` of one representative occurrence — enough
   for `direct` and `prototype` to reason about how the brand
   deploys the image.

This catches the case where a hero photo applied via
`background-image` is shared across multiple pages but invisible
to `<img>`-based capture. Without this aggregation, prototype
routinely places brand photos at the wrong section position
because it never saw them in the first place.

### Detection thresholds

When `pages crawled < 3`, skip detection and emit
`systemComponents: []` with a `_provenance.notes` line ("system
component detection requires ≥ 3 pages; crawl too small").

DOM-fingerprint diff (the thorough version) is out of scope for v0.2 —
file an issue if the heading-sequence version misses important blocks.

## § Voice

Sampled copy from the home page. Used by `direct` to reason about
tone moves and to seed the `voice.examples.do/dont` arrays in
DESIGN.json.

```json
{
  "heroHeadline": "Build, ship, and own your work",
  "heroSubcopy": "...",
  "primaryCTALabel": "Start free trial",
  "ctaSamples": ["Start free trial", "Talk to sales", "See pricing", "Read the docs"],
  "navItems": ["Product", "Pricing", "Customers", "Docs", "Sign in"],
  "footerHeadings": ["Product", "Company", "Resources", "Legal"],
  "firstParagraph": "...",
  "tone": {
    "guess": "professional-warm",  // descriptive guess; one of: professional-warm | professional-formal | playful-bright | playful-dry | technical-precise | aspirational | bold-direct | other
    "evidence": "short sentences, second-person address, no jargon"
  }
}
```

The `tone.guess` is a heuristic — never present it as ground truth in
the user report. `direct` will use it as one of several signals, not
as a fact.

## § Voice table

Cross-page aggregations that fuel the brand-review's data tables. The
`voice` block above samples the home page; `voiceTable` aggregates
across **all extracted pages** so the review can show frequency, not
just examples.

```json
{
  "ctaFrequency": [
    { "label": "Donate", "total": 35, "pageCount": 10, "pages": ["home", "about-us", ...] },
    { "label": "Read More", "total": 56, "pageCount": 5, "pages": [...] }
  ],
  "headingFrequency": [
    { "text": "Looking for immediate shelter?", "total": 22, "pageCount": 10, "level": 2 },
    { "text": "Get Involved",                   "total": 11, "pageCount": 9,  "level": 3 }
  ],
  "toneMetrics": {
    "headingsTotal": 312,
    "headingsUppercasePercent": 44,
    "distinctHeadings": 153,
    "distinctCtaLabels": 40
  }
}
```

Aggregation rules:

- `ctaFrequency` — built from every `pages/*.json#ctas[].label`. To
  catch styled `<a>` links the visual-button heuristic missed (e.g.
  WordPress sites that style links as buttons via classes), also
  include link texts that match the closed list below. Match is
  case-insensitive after trimming whitespace; full-string equality
  only (no partial / fuzzy matching).

  ```
  donate, donate now, give, give now, support us, contribute,
  read more, learn more, more info, see more, view more, view, more,
  discover more, explore, overview,
  sign up, signup, subscribe, register, join, create account,
  contact, contact us, get in touch, talk to us, reach out, say hello,
  get help, get involved, find help,
  volunteer, share, download, submit,
  here, click here, read this, this
  ```

  These mirror and slightly expand the CTA equivalence buckets in
  `brand-review-template.md § CTA equivalence buckets`; the buckets
  drive the `T-cta-vocab` Tensions detector, while this list drives
  the `voiceTable.ctaFrequency` aggregation.

  Sort by `total` descending; on ties, sort by `pageCount` descending.
  Cap retained list at 8 entries; the rest are dropped (the
  brand-review table renders the top 8).

  **Closed list.** The list is exhaustive for v0.2; do not extend at
  runtime. When a real run surfaces a missing CTA verb worth
  catching, add it here in spec, not in the renderer. Fuzzy /
  edit-distance matching is tracked as a v0.3 issue
  (`brand-review-template.md § Open issues for v0.3`).
- `headingFrequency` — built from every `pages/*.json#headings[].text`.
  Filter to entries with `pageCount >= 3`. Sort by `total`, then
  `pageCount`. This is the strongest signal of repeated site-wide
  blocks (e.g. a "Looking for immediate shelter?" cross-promo).
- `toneMetrics.headingsUppercasePercent` — fraction of headings whose
  text equals its uppercase form. The brand-review uses
  `≥ 25` as the threshold to apply `text-transform: uppercase` to
  H1/H2/H3 in the review chrome.
- `toneMetrics.distinctHeadings` and `distinctCtaLabels` — set sizes
  across all pages. High distinct-CTA counts (>20) often signal
  vocabulary fragmentation; the Tensions detector
  (`brand-review-template.md § Detectors`, `T-cta-vocab`) consumes
  this.

## § Cross-promo

A cluster of repeated headings + CTAs that appears on most interior
pages. Almost always the most load-bearing site-wide repeated block
(call-to-action band, footer cross-promo, "looking for X?" panel).
Detection runs **after** `headingFrequency` is built.

```json
{
  "detected": true,
  "anchorHeading": "Looking for immediate shelter?",
  "cluster": [
    { "text": "Looking for immediate shelter?",  "total": 22, "pageCount": 10, "overlap": 10 },
    { "text": "Experiencing a housing crisis?",  "total": 12, "pageCount": 10, "overlap": 9  },
    { "text": "Please call: 211",                "total": 11, "pageCount": 10, "overlap": 9  }
  ],
  "pages": ["about-us", "donate", "events", ...],
  "pageCount": 10,
  "totalPages": 24
}
```

Detection algorithm:

1. Take the most-frequent entry in `headingFrequency` as the anchor.
2. Find all pages whose headings include the anchor text — call this
   the anchor-page set.
3. For each top-12 entry in `headingFrequency`, count how many
   anchor-pages also contain it (`overlap`). Keep entries where
   `overlap / anchorPages.size >= 0.6`.
4. If the resulting cluster has ≥ 2 entries, emit a cross-promo
   record.

When detected, the brand-review **must** render a cross-promo
reproduction section (`brand-review-template.md § Section ordering →
Cross-promo reproduction`). Set `detected: false` and emit `null` for
the rest when no cluster meets the threshold.

## § Embed-dominated pages

After Phase 2, scan each page's `embedDominance` field
(`current-state-schema.md` § Embed dominance). If any page has
`dominated: true`, add a section to the generated DESIGN.md (and
mention in the user report) labeled "Third-party embeds (opaque to
extraction)" that lists the affected slugs and embed sources. The
brand-surface tokens for those pages are not captured in computed
styles — the screenshot is the only artifact `direct` and `prototype`
can reason from.

Do **not** attempt recursive extraction of the iframe `src` URL in
v0.2; that's tracked as a separate feature.

## § Register

```json
"register": "brand"
```

One of `brand`, `product`, `ambiguous`. Heuristic:

- `brand` if landing-page indicators dominate: hero with marketing
  copy, social proof, pricing, signup CTA above the fold, no
  authentication required to see the page.
- `product` if tool indicators dominate: data tables, navigation
  optimized for known features, requires auth, contains widgets like
  filters and sort.
- `ambiguous` if both appear or neither dominates. Stardust will ask
  the user in `direct` rather than guess.

---

## What this file is **not**

- A definition of what the brand should be. That's the *target*
  PRODUCT.md and DESIGN.md, written by `direct`.
- A critique. No judgement, no scores. `critique` belongs to
  impeccable.
- A migration spec. The brand surface describes; it does not
  prescribe.
