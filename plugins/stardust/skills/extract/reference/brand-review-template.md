# Brand-review template

The contract for `stardust/current/brand-review.html` — the
self-contained visual artifact emitted at the end of `extract`. The
review is the **first surface a human can eyeball** to verify the
extraction before committing to a redesign direction. It exists to
catch misreads cheaply (re-extract is fast; re-direct + re-prototype
is not).

The review is **descriptive, not prescriptive**. It describes what
the existing site is. The prescriptive equivalent — Do's / Don'ts on
the *target* — lives on the brand board emitted later in the pipeline
by `direct`. The two have the same shape, different mode.

---

## Output

```
stardust/current/brand-review.html
```

Self-contained: embedded CSS, no external JavaScript, no analytics, no
external font loads (use the brand's own captured `font-family` stacks
with system fallbacks; if the brand font is hosted on a CDN the
proposal already references, link to it directly — the review may be
viewed offline). Sticky section nav so reviewers can jump.

The page **renders in the brand's own captured colors and fonts**,
not in a generic shell. The reviewer should feel like they're looking
at *this site's* brand-review, not a stardust template applied to it.

---

## Source artifacts

The template reads from:

| input | role |
|---|---|
| `stardust/current/PRODUCT.md` | Voice, personas, content pillars, register, brand personality |
| `stardust/current/DESIGN.md` | Frontmatter tokens (colors, typography, rounded, spacing) |
| `stardust/current/DESIGN.json` | `extensions` block — motifs, voice, componentStyle, systemComponents, scaleAudit |
| `stardust/current/_brand-extraction.json` | Palette, type, motifs, system components, voice, voiceTable (CTA + heading frequency, tone metrics), crossPromo, register, embed-dominated pages |
| `stardust/current/pages/<slug>.json` | Per-page data: heading outlines, CTAs, components inventory, embedDominance, cssCustomProperties |
| `stardust/current/_crawl-log.json` | Coverage data: pages crawled, filtered, wait summary |
| `stardust/current/assets/screenshots/<slug>.png` | Thumbnails strip |
| `stardust/current/assets/logo.<ext>` | Masthead logo |

**Never invent.** Every value rendered must trace back to one of
these files. When data is missing for a section, omit the section —
do not fabricate placeholders. Empty sections are themselves a signal
worth surfacing in the coverage callout.

---

## Section contract

What each section **contains**. Section **order** and **styling** are
mandated by § Styling rules → § Section ordering (canonical) below.
Sections marked `*` are current-state additions absent from the v1
target board. Sections marked `?` render only when the source data
exists.

- **Masthead** — site name, hero line (`brand.voice.heroHeadline`,
  rendered as `p.hero-line` in `var(--accent)`), tagline
  (`og:description` or `metaDescription`), origin URL.
- **Coverage callout `*`** — three stat boxes: pages extracted,
  wait strategy + avg ms, brand-surface summary. List failures in
  accent color if `_crawl-log.json#crawl.failures[]` is non-empty.
- **Pages `*`** — viewport screenshot grid. Each thumbnail labelled
  with page title + slug pathname in monospace.
- **Color palette** — swatch grid. Each swatch shows value, role,
  occurrences, `usedAs` list, top-3 source pages. Pure black/white
  kept verbatim (per `brand-surface.md` § Palette aggregation rules).
- **Typography** — real specimens at each captured heading size +
  weight + line-height + letter-spacing. Body specimen uses real
  captured first-paragraph text. `scaleAudit.kind` shown as a badge
  (`modular {name}` or `No modular scale`).
- **Voice** — three voice cards (hero headline, tagline, first
  paragraph). Then **CTA frequency table** from
  `voiceTable.ctaFrequency` (top 8, pill-rendered labels). Then
  **repeated-heading list** from `voiceTable.headingFrequency`
  (≥3 pages, two-column layout). Then **tone metrics** in three stat
  boxes (`headingsUppercasePercent`, `distinctHeadings`,
  `distinctCtaLabels`). Tone guess shown as a tag in the section
  header, not a claim.
- **Tensions `*`** — 2-column grid; see § Tensions below for
  detector rules and § Section ordering for layout requirements.
- **Motifs** — radius card grid (one per distinct radius value,
  sorted by occurrence count) plus a shadow demo card. Each card
  renders the actual motif at the captured value using
  `var(--primary)`.
- **Components** — left-bordered list of detected component types
  with cross-page counts and pattern names from `motifs.patterns`.
- **Cross-promo reproduction `*` `?`** — render only when
  `brand.crossPromo.detected === true`. A near-actual reproduction
  of the site-wide block: anchor heading + cluster headings as tiles,
  rendered close-to-source colors. **Mandatory when detected** — it
  is the most load-bearing repeated block; missing it means `direct`
  decides its fate blind.
- **System components `*` `?`** — landmark fingerprint matches
  (header / footer / nav). Listed with kind tag, occurrence count,
  heading sequence, CTA labels.
- **Logo & favicons** — flex row with `<img>` and a `<dl>` of
  metadata. Required dt/dd: Source, File (format + intrinsic size),
  Variants captured, Variants not captured. Flag with a tension if
  only one variant captured (`brand-surface.md`'s logo locator stops
  at first hit).
- **Spacing & shape** — `baseUnit`, observed scale visualized as a
  bar row (height proportional to value), then a "Radii revisited"
  pill row showing each captured radius value as a labeled pill.
- **Embed-dominated pages `*` `?`** — render only when one or more
  pages have `embedDominance.dominated: true`. Screenshot + iframe
  src + a callout: "primary content lives in a third-party embed —
  visual style not captured."
- **Footer** — provenance paragraph (which artifacts the review
  read), "What's next" line pointing at `/stardust:direct`, and a
  badge legend.

Optional sections from PRODUCT.md (Photography / imagery, Content
pillars, Personas) render only when source data is available; they
are not core to the current-state review.

For each section, render only if the source data exists. Missing
sections do **not** error — they're omitted, and the Coverage callout
reflects what's missing.

---

## Badges

Every section header carries one or more badges signalling provenance:

| badge | meaning |
|---|---|
| `observed` | Frequency-counted from CSS across ≥3 pages. High confidence. |
| `home-only` | Sourced from a single page (the home page). Lower confidence; biased toward hero/CTA-heavy markup. |
| `cross-page` | Aggregated across all extracted pages. High confidence. |
| `inferred` | The agent read raw data and made a judgment call (e.g. tone guess, persona). Lowest confidence; reviewer should challenge. |
| `synthesized` | The data was constructed from extracted inputs into a higher-level claim (e.g. `register: brand`, `scaleAudit.kind: ad-hoc`). |

Badges drive the reviewer's trust. The masthead carries no badge.
Sections sourced from `_brand-extraction.json` carry the badge that
field's aggregation scope dictates (per
`brand-surface.md` § Aggregation scope).

---

## Tensions

Descriptive observations of where the existing site internally
contradicts itself. **These are not prescriptions.** They are the
explicit decision agenda for `direct`. The naming is deliberate:

- **Target board** (post-`direct`) → "Do's and Don'ts" — prescriptive.
- **Current-state review** (this artifact) → "Tensions" — descriptive.

Same shape, different mode.

### Detector rules

Each rule produces zero or more tension cards. Detection is
**mechanical** — no LLM reasoning required for the baseline. The agent
may add nuanced tensions on top, but the review never ships without
the mechanical baseline.

| ID | Rule | Source field | Trigger | Card copy template |
|---|---|---|---|---|
| `T-scale` | Type scale is non-modular | `_brand-extraction.json#type.scaleAudit.kind` | `=== "ad-hoc"` | "Type scale is ad-hoc ({sizes joined by →}, no consistent ratio). Direct will need to decide whether the target adopts a modular scale." |
| `T-radius-vocab` | Multiple small radii in use | `_brand-extraction.json#motifs.borderRadius.occurrences` | More than 2 distinct values < 16px each with ≥10 occurrences | "Radius vocabulary is fragmented: {list of radii with counts}. Direct will need to pick a single small-radius value or accept the variance." |
| `T-cta-vocab` | CTA copy fragmented across semantic siblings | aggregated `pages/*.json#ctas[].label` | ≥2 distinct labels from the same CTA-equivalence bucket appear (see § CTA equivalence buckets) | "CTA voice is fragmented: {labels with counts}. Direct will need to pick a canonical voice for see-more / read-more / learn-more affordances." |
| `T-link-content-free` | Content-free link labels in use | aggregated `pages/*.json#links.internal[].text` and `external` | Any of `{ "here", "click here", "read this", "more", "this" }` appears as link text ≥1× | "Content-free link labels found: {labels with counts and example pages}. Accessibility issue — screen readers and crawlers cannot tell what these point to." |
| `T-logo-variants` | Single logo variant captured | `_brand-extraction.json#logo` | Always emits — current locator chain only captures first hit | "Only one logo variant captured ({source}). The redesign will need a monochrome / inverted / SVG variant set; direct should plan that." |
| `T-color-imbalance` | Palette color used for text only or fill only | `_brand-extraction.json#palette[].usedAs` | Any color (excluding pure black, pure white, and `text-primary`/`text-secondary` roles) where `usedAs` contains only `["text"]` or only `["background"]` | "Color {value} ({role}) appears as {usedAs[0]} only — never as {missing contexts}. Direct will need to decide: drop, expand, or keep as accent." |
| `T-no-tokens` | Site ships no design tokens | aggregated `pages/*.json#cssCustomProperties` | Empty across every page | "No CSS custom properties defined. The current site has no design-token layer; the migration target will introduce tokens, which is a structural change worth calling out to the user." |
| `T-tokens-unused` | Tokens defined but visually unapplied | aggregated `pages/*.json#cssCustomProperties` + `_brand-extraction.json#palette[role="primary"].value` | A `--primary` / `--secondary` / `--success` / `--info` / `--warning` / `--danger` custom property exists with a value matching a known framework default (Bootstrap 4/5: `#007bff`, `#6c757d`, `#28a745`, `#17a2b8`, `#ffc107`, `#dc3545`; Tailwind `slate-500`/`gray-500`; Material defaults) AND the brand's actual computed primary palette differs from that token value | "Design tokens defined but unused: `--primary` ships as `<token-value>` (likely a {framework} default) while the brand's actual primary is `<palette-primary>`. The token layer exists in name only — the migration target will need to either rewire components to consume tokens or replace the token values to match the brand." |
| `T-img-alt-generic` | Generic alt-text widespread | aggregated `pages/*.json#media.images[].alt` | ≥1 image with alt text matching one of `{ "logo", "image", "picture", "photo", "img", "icon" }` exactly (case-insensitive, trimmed) | "Generic alt text found: {N} image(s) carry alt text equal to a stock placeholder ({matched values}). Distinct from empty alt — these images claim a label but the label is content-free. WordPress / page-builder default; failing screen readers." |
| `T-embed-dominance` | Embed-dominated page exists | `pages/*.json#embedDominance.dominated` | True on ≥1 page | "Page(s) {slug list} have primary content inside a cross-origin embed ({src host}); brand-surface tokens for those pages were not captured. Direct will need to decide whether the redesign targets the host page or the embed surface." |
| `T-img-alt-empty` | Empty `alt` text widespread | aggregated `pages/*.json#media.images[].alt` | ≥30% of images have empty or whitespace-only `alt` | "{N}% of images carry empty alt text. Accessibility issue and a content-sourcing decision for direct." |
| `T-nav-conflict` | Two top-nav items compete for the same audience action | aggregated `pages/*.json#landmarks[?role==banner|navigation]` heading-sequence | ≥2 nav items whose labels match an action-conflict pair (see § Action-conflict pairs) | "Top-nav contains both {label A} and {label B}; these typically compete for the same user moment. Direct should resolve which is primary." |
| `T-temporal-mark` | Logo or visible site element references a time-bound campaign | `_brand-extraction.json#logo.sourceSelector` + alt + `voice.heroHeadline` | Substring match against `{ "anniversary", "centennial", "20XX edition", "year-in-review" }` (case-insensitive) | "A temporal mark was detected ({matched substring}). Direct will need to decide whether the redesign carries the temporal flag forward or returns to an evergreen brand." |

When a rule's data is unavailable (e.g. crawl too small for
cross-page detection), skip the rule silently. The Tensions section
is allowed to be empty — that itself is a signal about either the
site or the crawl scope.

### Card consolidation

When a single rule (matched by `id`) fires more than 3 times,
render a **single consolidated card** instead of N individual
cards. The body lists the matching items in a comma-separated
phrase or a small inline table, depending on data shape.

Concrete rule: if `tensions.filter(t => t.id === '<rule-id>').length > 3`,
collapse to one card with:

- `tag` — the rule id (unchanged).
- `title` — the rule's plural framing (e.g. "Multiple palette
  colors used in only one context" instead of the per-color
  "Color {value} ({role}) appears as {usedAs[0]} only").
- `body` — a short summary line + an inline `<ul>` or comma-list
  of the matching items, each with the relevant data.
- `source` — citation unchanged.

Apply consolidation to per-element rules: `T-color-imbalance`,
`T-link-content-free`, `T-img-alt-empty`, `T-img-alt-generic`,
`T-tokens-unused`, and any future rule whose trigger fires once
per element rather than once per site.

Per-site rules (`T-scale`, `T-no-tokens`, `T-logo-variants`,
`T-temporal-mark`, `T-nav-conflict`) cannot fire more than once
by construction; consolidation is a no-op for them.

Without consolidation a single noisy rule swamps the Tensions
section — observed on theroadhome.org where `T-color-imbalance`
fired 8 times and pushed every other tension below the fold
(`STARDUST-FEEDBACK.md F-004`).

### Card layout

Each tension card renders as:

```
[badge: T-scale | observed]
Type scale is ad-hoc

14 → 18 → 20 → 32 → 45 → 60, no consistent ratio.
Direct will need to decide whether the target adopts a modular scale.

Source: _brand-extraction.json § type.scaleAudit
```

Three lines maximum: the rule title, the data + decision-prompt, the
source citation. No fluff.

### CTA equivalence buckets

Closed list (v0.2). If a CTA label matches one of these buckets and
≥2 distinct labels in the same bucket appear, emit `T-cta-vocab`.

| bucket | members |
|---|---|
| `see-more` | `see more`, `learn more`, `more info`, `more`, `read more`, `view more`, `discover more`, `explore` |
| `start` | `get started`, `start now`, `start free`, `try it`, `try now`, `try free`, `try for free`, `begin` |
| `contact` | `contact`, `contact us`, `get in touch`, `talk to us`, `reach out`, `say hello` |
| `buy` | `buy now`, `purchase`, `order now`, `order`, `add to cart`, `checkout` |
| `signup` | `sign up`, `signup`, `create account`, `register`, `join`, `subscribe` |
| `donate` | `donate`, `donate now`, `give`, `give now`, `support us`, `contribute` |
| `vague-here` | `here`, `click here`, `read this`, `this`, `more` (also flagged by `T-link-content-free` as content-free) |

Match is case-insensitive, leading/trailing whitespace stripped.
Fuzzy matching (edit-distance, embeddings) is **out of scope for v0.2**
— the closed list catches the obvious cases without producing
false-positive tensions.

### Action-conflict pairs

Closed list. If both labels in a pair appear in the site's top
navigation, emit `T-nav-conflict`. The pairs encode a known UX
tension where two CTAs compete for the same user moment.

| pair | rationale |
|---|---|
| `donate` ↔ `crisis` / `get help` / `find help` | nonprofit: giver vs receiver overlap on the home nav |
| `pricing` ↔ `contact sales` | self-serve vs assisted-sales path competing |
| `sign up` ↔ `start free trial` | semantic redundancy (one signal, two phrasings) |
| `book a demo` ↔ `talk to sales` | redundancy as above |
| `sign in` ↔ `log in` | label inconsistency on the same auth action |

This list is **explicitly small** in v0.2. Add to it when a real run
surfaces another pair worth catching.

---

## Styling rules

The review is a single HTML file. The previous (v0.1) spec said only
"render in the brand's own colors and typography" and let the renderer
choose its layout — the result was a generic shell with the brand's
palette dropped in. The brand's own visual language has to be the
**chrome**, not just the **content**. The rules below are prescriptive
on layout moves that materially affect whether the review feels like
the site.

### Hard constraints

- **Single HTML file.** Embedded CSS in a `<style>` block in `<head>`.
  No external stylesheets.
- **No external JavaScript.** Anchor-link navigation only. Sticky nav
  uses CSS `position: sticky`.
- **No external font loads** unless the brand already loads them on
  the live site — in which case use the same `<link>` the live site
  uses (read from a representative page). Otherwise, use the captured
  font stacks with system fallbacks.
- **Print-friendly.** A reviewer must be able to print to PDF and have
  all sections paginate cleanly.

### Visual language: brand-faithful chrome

- **CSS custom properties at `:root`.** Define `--primary`,
  `--primary-dark`, `--accent`, `--secondary`, `--text`, `--text-muted`,
  `--surface`, `--surface-alt`, `--border`, `--display`, `--body`. All
  values come from `_brand-extraction.json`. Never inject brand-external
  tokens (no AI-default cyan/purple, no `#7B997C` greens, no
  `#faf9f6`-family creams unless extracted).
- **Bare-stack fallback augmentation.** If the captured
  `type.headingFamily.stack` or `type.bodyFamily.stack` is a single
  family with no generic terminator (`sans-serif`, `serif`, or
  `monospace`), the renderer must append a system fallback chain
  before assigning to `--display` / `--body`. Use:

  `<captured>, -apple-system, BlinkMacSystemFont, "Segoe UI",
  "Helvetica Neue", Arial, sans-serif`

  for sans families (default), or the equivalent serif chain when
  the captured family is a known serif. Without this, sites that
  declare `font-family: 'BrandFont'` bare (no `@font-face`, no
  fallback — common on legacy CMS themes that assume the brand
  font is system-installed via Adobe / Office) cause the review
  to fall through to the browser-default serif on machines without
  the brand font, which misrepresents what most visitors see on
  the live site.

  When the captured stack already includes a generic terminator,
  pass through unchanged.
- **Color resolution.** The review's `--primary` is the most-frequent
  *saturated* palette color (skip pure black/white and pale tints —
  saturation = max-min channel difference > 30 and max < 240). The
  literal `palette[role="primary"]` may not be the visual anchor; the
  most-saturated frequent color usually is.

  **Fallback chain** when no palette entry qualifies as saturated
  (monochromatic / desaturated / earth-tone brands):

  1. `palette[role="primary"]` — the role-tagged primary, even if
     pale.
  2. If still empty, a generic neutral primary (`#147aff` is the
     renderer-reference default; choose any accessible blue — the
     review will surface a `_provenance.notes` line explaining no
     saturated brand color was found).

  The fallback is part of the spec, not a renderer-private fail-safe:
  a fresh agent reading this section must produce the same result as
  the reference renderer on a fully-desaturated brand.
- **`--primary-dark` must share `--primary`'s hue family**, not just
  rank second by occurrence. Pick the saturated palette entry whose
  hue distance to `--primary` is ≤ 30° **and** whose luminance is
  lower; if none exists, derive `--primary-dark` by darkening
  `--primary` ~30% algorithmically. Picking the second-most-frequent
  saturated color blindly will land on a different hue family on
  multi-accent palettes (e.g. teal-and-purple) and the top nav +
  headings will read as the wrong brand color. This is the single
  most common rendering miss — it must be hue-anchored, not
  occurrence-anchored.
- **`--accent` should differ from `--primary` in hue by ≥60°** when
  possible. **Fallback chain:**

  1. Saturated palette entry with `hueDistance(palette, --primary) > 60°`
     and not equal to `--primary` or `--primary-dark`.
  2. `palette[role="secondary"]` if present.
  3. `--primary` itself (the chrome will read as monochromatic — that
     matches a monochromatic brand and is the correct outcome).

  Same rule as `--primary`'s fallback: the spec must be self-sufficient
  so monochromatic brands produce a correct review without renderer-
  side guesswork.
- **Heading uppercase rule.** If
  `voiceTable.toneMetrics.headingsUppercasePercent ≥ 25`, apply
  `text-transform: uppercase` to H1/H2/H3/H4 in the review and to
  badges and pill labels. Otherwise leave mixed-case. The review
  inherits the site's heading convention.
- **Display font for all headings + UI chrome.** H1, H2, H3, H4,
  badges, pills, labels, table headers, nav links — all use
  `var(--display)`. Body prose uses `var(--body)`.

### Top sticky nav (mandatory)

A horizontal top sticky nav, **not** a left-side sidebar. The brand's
own header is almost always horizontal; matching that is part of "feels
like the site." Specifically:

- `position: sticky; top: 0;` with `background: var(--primary-dark);`
  and white text.
- Display font, uppercase, letter-spacing 1.5px, font-size 12px.
- Strong site-name label on the left (`{brand.site.name} · Current state`).
- Anchor links to every visible section; pill-shaped on hover
  (`border-radius: 150px; background: rgba(255,255,255,0.18);`).
- Collapses via `flex-wrap: wrap;` on narrow viewports — no separate
  mobile menu.

### Section ordering (canonical)

Render in this order. Sections marked `?` render only when source data
exists.

1. **Masthead** — site name, hero line (`voice.heroHeadline`),
   tagline (`og:description` or `metaDescription`), origin URL.
2. **Coverage callout** — three stat boxes in a row: pages
   extracted, wait strategy + avg ms, brand-surface summary.
   Failures listed in accent color if any.
3. **Pages** — viewport screenshot grid, 4-column at ≥1024px wide.
   Each thumbnail labelled with page title + slug-as-monospace.
4. **Palette** — swatch grid, ≥4 columns. Each swatch ≥200×200px
   with a 96px chip, role label (display font uppercase),
   monospace hex, occurrence count + `usedAs` chips, top-3 source
   pages.
5. **Typography** — real specimens at every captured heading size,
   weight, line-height, letter-spacing. Each row labelled
   `H1 · {family} {weight} / {size} / {line-height}` in monospace.
   Body specimen uses real captured first-paragraph text. Scale
   audit shown as a badge (`modular {name}` or `No modular scale`).
6. **Voice** — three voice cards (hero headline · tagline · first
   paragraph). Then **CTA frequency table** (`voiceTable.ctaFrequency`,
   top 8) with pill-rendered labels. Then **repeated-heading list**
   (`voiceTable.headingFrequency`, ≥3 pages, two-column layout).
   Then **tone metrics** in three stat boxes
   (`headingsUppercasePercent`, `distinctHeadings`,
   `distinctCtaLabels`).
7. **Tensions** — 2-column grid. Each tension card has
   `border-left: 4px solid var(--accent)`. Three lines max per card:
   `<tag>` (e.g. `T-scale`), `<h4>` title, `<p>` body, source citation
   in the footer. The accent border-left is mandatory — it visually
   marks tensions as decisions for `direct`, distinct from descriptive
   sections elsewhere.
8. **Motifs** — radius card grid (one card per distinct radius value,
   sorted by occurrence count descending), plus a shadow demo card.
   Each card renders the actual motif (a colored box at the captured
   border-radius, a sample shadow on a surface) using `var(--primary)`.
9. **Components** — left-bordered list (`border-left: 3px solid
   var(--primary)`) of detected component types with cross-page
   counts and pattern names from `motifs.patterns`.
10. **Cross-promo reproduction `?`** — render only when
    `brand.crossPromo.detected === true`. A near-actual reproduction
    of the site-wide block: `var(--primary-dark)` background,
    `border: 4px dashed var(--primary)`, "Reproduction · approximate"
    tag in `var(--accent)`, anchor heading + cluster headings as
    tiles. This is mandatory when detected — it is the single most
    load-bearing page block; missing it from the review means
    `direct` makes a decision blind.
11. **System components `?`** — landmark fingerprint matches
    (header/footer/nav). Listed with kind tag, occurrence count,
    heading sequence, CTA labels. Render only if
    `systemComponents.length > 0`.
12. **Logo** — flex row with `<img>` on the left (≤280px wide) and a
    `<dl>` of metadata on the right. Required dt/dd pairs: Source,
    File (with format and intrinsic size), Variants captured,
    Variants not captured.
13. **Spacing & shape** — base unit, scale visualized as a row of
    bars (height proportional to value), then a "Radii revisited"
    pill row showing each captured radius value as a labeled pill.
14. **Embed-dominated pages `?`** — render only when one or more
    pages have `embedDominance.dominated: true`.
15. **Footer** — provenance paragraph (which artifacts the review
    read), "What's next" line pointing at `/stardust:direct`, badge
    legend.

### Component dimensions and density

- **Color swatches** ≥80×80px chip minimum (96px recommended). Role,
  hex, `usedAs`, top-3 source pages all visible without hover.
- **Page thumbnails** at 16/10 aspect ratio, ≥220px wide.
- **Tension cards** 2-column grid at ≥720px viewport, single column
  below.
- **Motif demo boxes** ≥60×60px, larger for pill radii.
- **Voice cards** full-width, padded 20–24px, surface-alt background.
- **Coverage callout** 3-column row, each box flex-1 with min-width
  220px.

### Color contrast

If captured `text-primary` on `background` fails WCAG AA (contrast
< 4.5:1), the template overrides with `#0f1217` on `#ffffff` for the
review's body copy and surfaces a tension card (`T-contrast`, not in
the rule table above — the template adds this contextually because it
directly affects the review's own readability).

### What "feels like the site" means in practice

If a reviewer who knows the live site looks at the review and the
chrome reads as a different brand, the renderer has failed regardless
of the content accuracy. Concrete checks:

- Top nav uses brand color. ✓ if filled with `--primary-dark`,
  ✗ if neutral gray or white.
- H2s use the brand's display font, not the review's body font. ✓
- Tension borders, pill backgrounds, badge fills draw from the
  captured palette. ✓
- The cross-promo reproduction (if applicable) approximates the site's
  actual block, not a generic CTA card. ✓

---

## What this artifact is not

- A **target brand board.** That's `direct`'s output later in the
  pipeline. The current-state review describes; the target board
  prescribes.
- A **critique.** The Tensions are forced decisions for `direct`,
  not value judgments. "Type scale is ad-hoc" is not "type scale is
  bad" — it's "the redesign target must take a position on this."
- A **migration spec.** The review describes the existing surface; it
  does not propose how to change it.
- An **interactive tool.** No JS, no live editing. The review is read,
  reasoned about, and used as the basis for a conversation with
  `direct`.

---

## Open issues for v0.3

Tracked here so we don't lose them:

- **Fuzzy CTA clustering.** Edit-distance or embedding-based — would
  catch `start your trial today` ↔ `try it free` which the closed
  list misses.
- **Cross-locale tensions.** Multi-locale sites currently extract
  one locale only; tensions across locales are out of scope until
  multi-locale crawl is in.
- **DOM-fingerprint cross-page detection.** The current heading-sequence
  diff (`brand-surface.md` § System components) misses repeated blocks
  that share structure but vary in copy. Full DOM-fingerprint diff
  would catch them.
- **Animation/motion capture.** Animations are disabled during
  extraction (`reducedMotion: reduce`); the review can't surface
  motion tensions until animation capture is in scope.
